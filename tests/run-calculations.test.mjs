import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { MAX_RUN_MS, runPhases } from './run-calculations.mjs';

const phase = (name, source, timeoutMs = 5000) => ({
  name,
  command: process.execPath,
  args: ['-e', source],
  timeoutMs,
});

test('reports a missing protected fixture as a failed run with a summary', async () => {
  const artifactDir = await mkdtemp(join(tmpdir(), 'nisar-runner-test-'));
  const result = await runPhases({
    phases: [],
    artifactDir,
    protectedFixture: join(artifactDir, 'missing.json'),
    quiet: true,
  });
  assert.equal(result.status, 'failed');
  assert.match(result.error, /ENOENT/);
  assert.equal(
    JSON.parse(await readFile(join(artifactDir, 'summary.json'), 'utf8'))
      .status,
    'failed',
  );
});

test('fails if a successful subprocess changes the protected input fixture', async () => {
  const artifactDir = await mkdtemp(join(tmpdir(), 'nisar-runner-test-'));
  const protectedFixture = join(artifactDir, 'fixture.json');
  await writeFile(protectedFixture, '{}');
  const result = await runPhases({
    phases: [
      phase(
        'mutate',
        'require("node:fs").writeFileSync(process.argv[1], "changed")',
      ),
    ].map((item) => ({ ...item, args: [...item.args, protectedFixture] })),
    artifactDir,
    protectedFixture,
    quiet: true,
  });
  assert.equal(result.phases[0].status, 'passed');
  assert.equal(result.fixtureUnchanged, false);
  assert.equal(result.status, 'failed');
});

test('records nonzero exits and unexecuted phases instead of reporting success', async () => {
  const artifactDir = await mkdtemp(join(tmpdir(), 'nisar-runner-test-'));
  const result = await runPhases({
    phases: [
      phase('failure', 'process.exit(7)'),
      phase('never', 'process.exit(0)'),
    ],
    artifactDir,
    quiet: true,
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.phases[0].exitCode, 7);
  assert.deepEqual(result.unexecutedPhases, ['never']);
  assert.equal(
    JSON.parse(await readFile(join(artifactDir, 'summary.json'), 'utf8'))
      .status,
    'failed',
  );
});

test('enforces the overall deadline and retains failure logs', async () => {
  const artifactDir = await mkdtemp(join(tmpdir(), 'nisar-runner-test-'));
  const result = await runPhases({
    phases: [
      phase('hang', 'console.log("started"); setInterval(() => {}, 1000)'),
    ],
    budgetMs: 250,
    artifactDir,
    quiet: true,
  });
  assert.equal(result.status, 'timed-out');
  assert.ok(result.elapsedMs < 10000);
  assert.equal(result.phases[0].status, 'timed-out');
});

test('rejects a budget above the promised 50-minute maximum', async () => {
  await assert.rejects(
    runPhases({
      phases: [],
      artifactDir: tmpdir(),
      budgetMs: MAX_RUN_MS + 1,
      quiet: true,
    }),
    /at most 50 minutes/,
  );
});
