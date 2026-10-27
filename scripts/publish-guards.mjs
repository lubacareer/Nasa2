import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

const digestPattern = /^sha256:[a-f0-9]{64}$/;

export function validateRequest({ number, sha, repository }) {
  if (!/^[1-9][0-9]*$/.test(number ?? '')) throw new Error('A positive numeric PR number is required.');
  if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('A full workflow commit SHA is required.');
  if (!/^[a-zA-Z0-9][\w.-]*\/[a-zA-Z0-9][\w.-]*$/.test(repository ?? '')) throw new Error('A valid GitHub repository is required.');
}

export function validatePullRequest(pr, request) {
  validateRequest(request);
  if (pr?.state !== 'open') throw new Error('The pull request is not open.');
  if (pr?.head?.repo?.full_name?.toLowerCase() !== request.repository.toLowerCase()) throw new Error('The PR head is not in this repository.');
  if (pr?.head?.ref !== 'feat/electron-desktop-docker' || pr?.base?.ref !== 'main') throw new Error('The PR must target main from the trusted desktop branch.');
  if (pr?.head?.sha !== request.sha) throw new Error('The PR head no longer matches the selected workflow commit.');
}

export function checkPullRequest(request, fetchPullRequest = (repository, number) => execFileSync('gh', ['api', `repos/${repository}/pulls/${number}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })) {
  validateRequest(request);
  let pr;
  try {
    pr = JSON.parse(fetchPullRequest(request.repository, request.number));
  } catch {
    throw new Error('The pull request could not be fetched from this repository.');
  }
  validatePullRequest(pr, request);
}

export async function verifyArchive(file, metadata, { arch, sha, runId, attempt }) {
  if (metadata?.platform !== `linux/${arch}` || metadata?.commitSha !== sha || metadata?.runId !== runId || metadata?.attempt !== attempt) throw new Error(`Artifact metadata mismatch for ${arch}.`);
  if (!digestPattern.test(metadata.imageId ?? '') || !digestPattern.test(metadata.configDigest ?? '') || !/^[a-f0-9]{64}$/.test(metadata.archiveSha256 ?? '')) throw new Error(`Invalid artifact digests for ${arch}.`);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  if (hash.digest('hex') !== metadata.archiveSha256) throw new Error(`Archive checksum mismatch for ${arch}.`);
}

export function verifyImageInspect(image, metadata, arch) {
  if (image?.Id !== metadata.imageId || image?.Os !== 'linux' || image?.Architecture !== arch) throw new Error(`Loaded image ID or platform mismatch for ${arch}.`);
}

export function verifyManifest(manifest, imageId) {
  if (manifest?.config?.digest !== imageId) throw new Error('Registry manifest config does not match the tested image ID.');
}

export function verifyIndex(index, expected) {
  const manifests = index?.manifests;
  if (!Array.isArray(manifests) || manifests.length !== 2) throw new Error('Expected exactly two image manifests in the index.');
  for (const [arch, digest] of Object.entries(expected)) {
    const matches = manifests.filter((entry) => entry.platform?.os === 'linux' && entry.platform?.architecture === arch && entry.digest === digest);
    if (matches.length !== 1) throw new Error(`Index does not contain the tested ${arch} manifest.`);
  }
}

export function promoteIndex({ recheck, createTag, resolveTag, shaTag, prTag, indexDigest }) {
  recheck();
  createTag(shaTag, indexDigest);
  if (resolveTag(shaTag) !== indexDigest) throw new Error('The SHA tag does not reference the tested index digest.');
  recheck();
  createTag(prTag, indexDigest);
  if (resolveTag(prTag) !== indexDigest) throw new Error('The PR tag does not reference the tested index digest.');
  try {
    recheck();
  } catch (error) {
    throw new Error(`PR changed after its Docker tag was updated; ${prTag} currently points at ${indexDigest}. ${error.message}`);
  }
}
