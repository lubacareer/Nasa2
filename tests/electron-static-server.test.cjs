const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');
const { createAssetServer, isAllowedExternalUrl } = require('../electron/static-server.cjs');

let temporaryDirectory;
let server;
let origin;

before(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'nisar-desktop-'));
  const assets = path.join(temporaryDirectory, 'assets');
  fs.mkdirSync(path.join(assets, 'data'), { recursive: true });
  fs.writeFileSync(path.join(assets, 'index.html'), '<main>desktop fixture</main>');
  fs.writeFileSync(path.join(assets, 'data', 'preview.json'), '{"synthetic":true}');
  fs.writeFileSync(path.join(temporaryDirectory, 'outside.txt'), 'outside');
  server = createAssetServer(assets);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

test('serves the packaged page and local JSON with a restrictive content policy', async () => {
  const page = await fetch(`${origin}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(page.headers.get('content-security-policy'), /object-src 'none'/);
  assert.doesNotMatch(page.headers.get('content-security-policy'), /unsafe-eval/);
  assert.match(await page.text(), /desktop fixture/);

  const data = await fetch(`${origin}/data/preview.json`);
  assert.equal(data.status, 200);
  assert.deepEqual(await data.json(), { synthetic: true });
});

test('rejects traversal, missing assets, and methods other than GET or HEAD', async () => {
  const traversal = await fetch(`${origin}/%2e%2e%2foutside.txt`);
  assert.equal(traversal.status, 404);
  const missing = await fetch(`${origin}/missing.js`);
  assert.equal(missing.status, 404);
  const post = await fetch(origin, { method: 'POST' });
  assert.equal(post.status, 405);
});

test('allows only HTTPS ASF NISAR documentation links in the system browser', () => {
  assert.equal(isAllowedExternalUrl('https://nisar-docs.asf.alaska.edu/gcov/'), true);
  assert.equal(isAllowedExternalUrl('http://nisar-docs.asf.alaska.edu/gcov/'), false);
  assert.equal(isAllowedExternalUrl('https://example.org/'), false);
  assert.equal(isAllowedExternalUrl('https://user@nisar-docs.asf.alaska.edu/'), false);
  assert.equal(isAllowedExternalUrl('not a url'), false);
});
