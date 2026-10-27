import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, appendFileSync, mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkPullRequest, verifyArchive, verifyImageInspect, verifyManifest, verifyIndex, promoteIndex } from './publish-guards.mjs';

const repo = 'lubani27/nisar-surface-change';

function realDocker(...args) {
  return execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] }).trim();
}

// An untagged docker-save archive must load exactly one image. The ID is local
// to the destination image store; it can differ from the build host's ID.
export function loadedImageId(output) {
  const ids = [...output.matchAll(/^Loaded image ID: (sha256:[a-f0-9]{64})\s*$/gm)];
  if (ids.length !== 1 || output.trim().split(/\r?\n/).length !== 1) throw new Error('Expected exactly one untagged loaded image ID.');
  return ids[0][1];
}

function loadedConfigDigest(imageId, docker) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'nisar-publish-'));
  const archive = path.join(directory, 'image.tar');
  try {
    docker('save', '--output', archive, imageId);
    const entries = JSON.parse(execFileSync('tar', ['-xOf', archive, 'manifest.json'], { encoding: 'utf8', maxBuffer: 1024 * 1024 }));
    if (!Array.isArray(entries) || entries.length !== 1 || typeof entries[0].Config !== 'string') throw new Error('Expected one re-exported image configuration.');
    const config = execFileSync('tar', ['-xOf', archive, entries[0].Config], { maxBuffer: 8 * 1024 * 1024 });
    return `sha256:${createHash('sha256').update(config).digest('hex')}`;
  } finally {
    rmSync(archive, { force: true });
    rmdirSync(directory);
  }
}

export async function publishTestedImages({ request, runId, attempt, artifactDir, docker = realDocker, recheck = checkPullRequest, readMetadata = (file) => JSON.parse(readFileSync(file, 'utf8')), verifyArtifact = verifyArchive, getLoadedConfigDigest = loadedConfigDigest }) {
  if (!/^[0-9]+$/.test(runId ?? '') || !/^[0-9]+$/.test(attempt ?? '') || !artifactDir) throw new Error('Missing run or artifact context.');

  function registryDigest(reference) {
    const result = docker('buildx', 'imagetools', 'inspect', reference);
    const digest = result.match(/^Digest:\s+(sha256:[a-f0-9]{64})\s*$/m)?.[1];
    if (!digest) throw new Error(`Could not read registry digest for ${reference}.`);
    return digest;
  }

  function rawManifest(reference) {
    return JSON.parse(docker('buildx', 'imagetools', 'inspect', '--raw', reference));
  }

  // Verify both archives and their loaded configurations before any public push.
  const images = {};
  for (const arch of ['amd64', 'arm64']) {
    const directory = path.join(artifactDir, `tested-container-${arch}-${runId}-${attempt}`);
    const archive = path.join(directory, 'image.tar');
    const metadata = readMetadata(path.join(directory, 'metadata.json'));
    await verifyArtifact(archive, metadata, { arch, sha: request.sha, runId, attempt });
    const localId = loadedImageId(docker('load', '--input', archive));
    const inspect = JSON.parse(docker('image', 'inspect', localId));
    verifyImageInspect(inspect[0], { imageId: localId }, arch);
    if (getLoadedConfigDigest(localId, docker) !== metadata.configDigest) throw new Error(`Loaded image config digest mismatch for ${arch}.`);
    images[arch] = { ...metadata, localId };
  }

  recheck(request);
  const manifests = {};
  for (const arch of ['amd64', 'arm64']) {
    const image = images[arch];
    const staging = `${repo}:staging-${runId}-${attempt}-${arch}`;
    docker('tag', image.localId, staging);
    docker('push', staging);
    const stagingDigest = registryDigest(staging);
    let manifest = rawManifest(`${repo}@${stagingDigest}`);
    let digest = stagingDigest;
    if (Array.isArray(manifest.manifests)) {
      const matching = manifest.manifests.filter((entry) => entry.platform?.os === 'linux' && entry.platform?.architecture === arch);
      if (matching.length !== 1 || !/^sha256:[a-f0-9]{64}$/.test(matching[0].digest)) throw new Error(`Unexpected ${arch} registry index.`);
      digest = matching[0].digest;
      manifest = rawManifest(`${repo}@${digest}`);
    }
    verifyManifest(manifest, image.configDigest);
    manifests[arch] = digest;
  }

  const indexTag = `${repo}:staging-${runId}-${attempt}-index`;
  docker('buildx', 'imagetools', 'create', '--tag', indexTag, `${repo}@${manifests.amd64}`, `${repo}@${manifests.arm64}`);
  const indexDigest = registryDigest(indexTag);
  verifyIndex(rawManifest(`${repo}@${indexDigest}`), manifests);
  const immutableIndex = `${repo}@${indexDigest}`;
  const shaTag = `${repo}:sha-${request.sha}`;
  const prTag = `${repo}:pr-${request.number}`;
  promoteIndex({
    shaTag, prTag, indexDigest,
    recheck: () => recheck(request),
    resolveTag: registryDigest,
    createTag: (tag) => docker('buildx', 'imagetools', 'create', '--tag', tag, immutableIndex),
  });
  return `Published ${prTag} and ${shaTag} as ${immutableIndex}.\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const request = { number: process.env.PR_NUMBER, sha: process.env.WORKFLOW_SHA, repository: process.env.REPOSITORY };
  const summary = await publishTestedImages({ request, runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT, artifactDir: process.env.ARTIFACT_DIR });
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}
