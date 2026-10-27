import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateRequest, validatePullRequest, checkPullRequest, verifyArchive, verifyImageInspect, verifyManifest, verifyIndex, promoteIndex } from '../scripts/publish-guards.mjs';
import { loadedImageId, publishTestedImages } from '../scripts/publish-tested-images.mjs';

const sha = 'a'.repeat(40);
const request = { number: '3', sha, repository: 'lubacareer/Nasa2' };
const pr = { state: 'open', head: { sha, ref: 'feat/electron-desktop-docker', repo: { full_name: request.repository } }, base: { ref: 'main' } };
const digest = `sha256:${'b'.repeat(64)}`;

test('publish request rejects missing, nonnumeric, malformed and ambiguous identifiers', () => {
  validateRequest(request);
  for (const number of [undefined, '', '0', '03', '-1', '3/other']) {
    assert.throws(() => validateRequest({ ...request, number }));
  }
  assert.throws(() => validateRequest({ ...request, sha: 'abc' }));
  assert.throws(() => validateRequest({ ...request, repository: '../other' }));
});

test('only an open PR at the selected same-repository trusted branch commit is accepted', () => {
  validatePullRequest(pr, request);
  for (const changed of [
    null,
    { ...pr, state: 'closed' },
    { ...pr, head: { ...pr.head, sha: 'c'.repeat(40) } },
    { ...pr, head: { ...pr.head, ref: 'untrusted' } },
    { ...pr, head: { ...pr.head, repo: { full_name: 'someone/fork' } } },
    { ...pr, head: { ...pr.head, repo: null } },
    { ...pr, base: { ref: 'other' } },
  ]) assert.throws(() => validatePullRequest(changed, request));
});

test('failed PR lookup and invalid GitHub responses fail closed', () => {
  checkPullRequest(request, () => JSON.stringify(pr));
  assert.throws(() => checkPullRequest(request, () => { throw new Error('not found'); }), /could not be fetched/);
  assert.throws(() => checkPullRequest(request, () => 'invalid JSON'), /could not be fetched/);
});

test('transferred artifacts require the expected commit, platform, run, attempt, and checksum', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'nisar-image-test-'));
  try {
    const file = path.join(dir, 'image.tar');
    writeFileSync(file, 'tested image');
    const metadata = { platform: 'linux/amd64', imageId: digest, configDigest: digest, archiveSha256: createHash('sha256').update('tested image').digest('hex'), commitSha: sha, runId: '8', attempt: '2' };
    const context = { arch: 'amd64', sha, runId: '8', attempt: '2' };
    await verifyArchive(file, metadata, context);
    for (const changed of [
      { ...metadata, platform: 'linux/arm64' }, { ...metadata, imageId: 'bad' }, { ...metadata, configDigest: 'bad' },
      { ...metadata, commitSha: 'c'.repeat(40) }, { ...metadata, runId: '9' },
      { ...metadata, attempt: '1' }, { ...metadata, archiveSha256: '0'.repeat(64) },
    ]) await assert.rejects(verifyArchive(file, changed, context));
    writeFileSync(file, 'corrupted image');
    await assert.rejects(verifyArchive(file, metadata, context), /checksum/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loaded images and registry manifests must match the tested ID and architecture', () => {
  const metadata = { imageId: digest };
  const image = { Id: digest, Os: 'linux', Architecture: 'amd64' };
  verifyImageInspect(image, metadata, 'amd64');
  assert.throws(() => verifyImageInspect({ ...image, Id: `sha256:${'c'.repeat(64)}` }, metadata, 'amd64'));
  assert.throws(() => verifyImageInspect({ ...image, Architecture: 'arm64' }, metadata, 'amd64'));
  verifyManifest({ config: { digest } }, digest);
  assert.throws(() => verifyManifest({ config: { digest: `sha256:${'c'.repeat(64)}` } }, digest));
});

test('multi-platform index contains exactly both tested immutable manifests', () => {
  const other = `sha256:${'c'.repeat(64)}`;
  const expected = { amd64: digest, arm64: other };
  const index = { manifests: [
    { platform: { os: 'linux', architecture: 'amd64' }, digest },
    { platform: { os: 'linux', architecture: 'arm64' }, digest: other },
  ] };
  verifyIndex(index, expected);
  assert.throws(() => verifyIndex({ manifests: index.manifests.slice(0, 1) }, expected));
  assert.throws(() => verifyIndex({ manifests: [index.manifests[0], { ...index.manifests[1], digest }] }, expected));
  assert.throws(() => verifyIndex({ manifests: [...index.manifests, index.manifests[0]] }, expected));
});

test('promotion rechecks before the PR tag and reports a change detected afterwards', () => {
  const operations = [];
  let checkCount = 0;
  const options = {
    shaTag: 'sha-tag', prTag: 'pr-tag', indexDigest: digest,
    createTag: (tag) => operations.push(`create ${tag}`),
    resolveTag: (tag) => { operations.push(`resolve ${tag}`); return digest; },
    recheck: () => { operations.push('check'); checkCount += 1; },
  };
  promoteIndex(options);
  assert.deepEqual(operations, ['check', 'create sha-tag', 'resolve sha-tag', 'check', 'create pr-tag', 'resolve pr-tag', 'check']);
  operations.length = 0;
  checkCount = 0;
  assert.throws(() => promoteIndex({ ...options, recheck: () => { throw new Error('stale'); } }), /stale/);
  assert.ok(!operations.includes('create pr-tag'));
  operations.length = 0;
  assert.throws(() => promoteIndex({ ...options, recheck: () => { checkCount += 1; if (checkCount === 2) throw new Error('changed during staging'); } }), /changed during staging/);
  assert.ok(operations.includes('create sha-tag'));
  assert.ok(!operations.includes('create pr-tag'));
  operations.length = 0;
  checkCount = 0;
  assert.throws(() => promoteIndex({ ...options, recheck: () => { checkCount += 1; if (checkCount === 3) throw new Error('closed'); } }), /PR changed after/);
  assert.ok(operations.includes('create pr-tag'));
  assert.throws(() => promoteIndex({ ...options, resolveTag: () => 'wrong-digest' }), /SHA tag/);
});

test('publish job serializes runs per repository and PR without cancelling in-flight work', () => {
  const workflow = readFileSync(new URL('../.github/workflows/full-calculations.yml', import.meta.url), 'utf8');
  const publishJob = workflow.split(/\n  publish-docker:\s*\n/)[1];
  assert.ok(publishJob, 'publish job must exist');
  assert.match(publishJob, /\n    concurrency:\s*\n      group: dockerhub-publish-\$\{\{ github\.repository \}\}-pr-\$\{\{ inputs\.pr_number \}\}\s*\n      cancel-in-progress: false\s*\n/);
});

test('only one untagged image is accepted from docker load', () => {
  assert.equal(loadedImageId(`Loaded image ID: ${digest}\n`), digest);
  for (const output of ['', 'Loaded image: tag', `Loaded image ID: ${digest}\nLoaded image ID: ${digest}`, `Loaded image ID: ${digest}\nLoaded image: tag`]) {
    assert.throws(() => loadedImageId(output));
  }
});

function mockedPublish({ badConfig = false, staleCheck = 0, badManifest = false } = {}) {
  const operations = [];
  const ids = { amd64: `sha256:${'1'.repeat(64)}`, arm64: `sha256:${'2'.repeat(64)}` };
  const configs = { amd64: `sha256:${'3'.repeat(64)}`, arm64: `sha256:${'4'.repeat(64)}` };
  const manifests = { amd64: `sha256:${'5'.repeat(64)}`, arm64: `sha256:${'6'.repeat(64)}` };
  const index = `sha256:${'7'.repeat(64)}`;
  let checks = 0;
  const docker = (...args) => {
    operations.push(args.join(' '));
    if (args[0] === 'load') return `Loaded image ID: ${args[2].includes('amd64') ? ids.amd64 : ids.arm64}`;
    if (args[0] === 'image' && args[1] === 'inspect') {
      const arch = args[2] === ids.amd64 ? 'amd64' : 'arm64';
      return JSON.stringify([{ Id: ids[arch], Os: 'linux', Architecture: arch }]);
    }
    if (args[0] === 'buildx' && args[2] === 'inspect' && args[3] === '--raw') {
      if (args[4].endsWith(index)) return JSON.stringify({ manifests: Object.entries(manifests).map(([arch, value]) => ({ digest: value, platform: { os: 'linux', architecture: arch } })) });
      const arch = args[4].endsWith(manifests.amd64) ? 'amd64' : 'arm64';
      return JSON.stringify({ config: { digest: badManifest ? digest : configs[arch] } });
    }
    if (args[0] === 'buildx' && args[2] === 'inspect') {
      const ref = args[3];
      const result = ref.endsWith('-amd64') ? manifests.amd64 : ref.endsWith('-arm64') ? manifests.arm64 : index;
      return `Name: example\nDigest: ${result}\n`;
    }
    return '';
  };
  const options = {
    request, runId: '8', attempt: '2', artifactDir: '/tmp/test-artifacts', docker,
    readMetadata: (file) => {
      const arch = file.includes('amd64') ? 'amd64' : 'arm64';
      return { imageId: `sha256:${'9'.repeat(64)}`, configDigest: configs[arch] };
    },
    verifyArtifact: async (_file, _metadata, context) => { operations.push(`verify ${context.arch}`); },
    getLoadedConfigDigest: (id) => { operations.push(`config ${id}`); return badConfig && id === ids.arm64 ? digest : id === ids.amd64 ? configs.amd64 : configs.arm64; },
    recheck: () => { checks += 1; operations.push('check PR'); if (checks === staleCheck) throw new Error('stale PR'); },
  };
  return { operations, options, ids, index };
}

test('publishing promotes only verified loaded images and an index of their registry manifests', async () => {
  const { operations, options, ids, index } = mockedPublish();
  const summary = await publishTestedImages(options);
  assert.match(summary, new RegExp(index));
  assert.ok(operations.indexOf(`config ${ids.arm64}`) < operations.findIndex((item) => item.startsWith('push ')));
  assert.ok(operations.includes(`tag ${ids.amd64} lubani27/nisar-surface-change:staging-8-2-amd64`));
  assert.equal(operations.filter((item) => item === 'check PR').length, 4);
  assert.ok(operations.find((item) => item.includes('create --tag lubani27/nisar-surface-change:pr-3')));
});

test('loaded config mismatch, changed PR, or registry mismatch prevents unsafe promotion', async () => {
  for (const config of [{ badConfig: true }, { staleCheck: 1 }, { staleCheck: 2 }, { badManifest: true }]) {
    const { operations, options } = mockedPublish(config);
    await assert.rejects(publishTestedImages(options));
    assert.ok(!operations.some((item) => item.includes('create --tag lubani27/nisar-surface-change:pr-3')));
    if (config.badConfig || config.staleCheck === 1) assert.ok(!operations.some((item) => item.startsWith('push ')));
  }
});
