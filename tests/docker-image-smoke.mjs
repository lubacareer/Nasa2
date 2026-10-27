import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const image = 'nisar-surface-change:ci';
const containerName = `nisar-docker-image-smoke-${process.pid}-${randomBytes(4).toString('hex')}`;
const resultPath = '/tmp/desktop-smoke-result.json';
const seccompProfilePath = path.resolve('docker/seccomp-profile.json');
const port = 6080;
const vncPassword = randomBytes(4).toString('hex');
let containerId = null;
const seccompProfile = JSON.parse(fs.readFileSync(seccompProfilePath, 'utf8'));

assert.equal(seccompProfile.defaultAction, 'SCMP_ACT_ERRNO');
const chromiumNamespaceRules = seccompProfile.syscalls.filter((rule) => rule.comment?.startsWith('Chromium sandbox'));
const allowedCloneNamespaces = chromiumNamespaceRules
  .filter((rule) => rule.names.includes('clone'))
  .map((rule) => rule.args[0].valueTwo)
  .sort((left, right) => left - right);
assert.deepEqual(allowedCloneNamespaces, [268435456, 268435456, 536870912, 536870912, 1879048192, 1879048192]);
assert.ok(chromiumNamespaceRules
  .filter((rule) => rule.names.includes('clone'))
  .every((rule) => rule.args[0].value === 2114060288 && rule.excludes?.caps?.includes('CAP_SYS_ADMIN')));
assert.ok(chromiumNamespaceRules
  .filter((rule) => rule.names.includes('clone') && rule.args[0].index === 0)
  .every((rule) => rule.excludes?.arches?.includes('s390') && rule.excludes?.arches?.includes('s390x')));
assert.ok(chromiumNamespaceRules.some((rule) =>
  rule.names.includes('unshare')
  && rule.args[0].index === 0
  && rule.args[0].value === 2114060288
  && rule.args[0].valueTwo === 268435456
  && rule.excludes?.caps?.includes('CAP_SYS_ADMIN'),
));
assert.ok(!seccompProfile.syscalls.some((rule) =>
  rule.action === 'SCMP_ACT_ALLOW'
  && rule.names.some((name) => ['clone', 'unshare'].includes(name))
  && !rule.args?.length
  && !rule.includes?.caps?.length,
), 'Namespace creation must retain the upstream capability and flag restrictions.');
assert.ok(!seccompProfile.syscalls.some((rule) => rule.action === 'SCMP_ACT_ALLOW' && rule.names.includes('socketcall')));

function docker(args, { allowFailure = false } = {}) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    timeout: 120_000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    throw new Error(`docker ${args.join(' ')} failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return result;
}

function readSmokeResult() {
  const probe = docker(['exec', containerId, 'test', '-s', resultPath], { allowFailure: true });
  if (probe.status !== 0) return null;
  try {
    return JSON.parse(docker(['exec', containerId, 'cat', resultPath]).stdout);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

async function verifyNoVnc() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_000);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/vnc.html`, {
      signal: controller.signal,
    });
    return response.status === 200 && (await response.text()).toLowerCase().includes('novnc');
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

try {
  const noPassword = docker(['run', '--rm', image], { allowFailure: true });
  assert.equal(noPassword.status, 64, `Missing VNC password should exit 64. ${noPassword.stderr}`);

  const shortPassword = docker(['run', '--rm', '--env', 'VNC_PASSWORD=short', image], { allowFailure: true });
  assert.equal(shortPassword.status, 64, `Short VNC password should exit 64. ${shortPassword.stderr}`);
  for (const invalidPassword of ['#Abc1234', '__SKIP__', '__COMM__']) {
    const invalid = docker(['run', '--rm', '--env', `VNC_PASSWORD=${invalidPassword}`, image], { allowFailure: true });
    assert.equal(invalid.status, 64, `x11vnc directive password ${invalidPassword} should exit 64. ${invalid.stderr}`);
  }

  const started = docker([
    'run', '--detach', '--name', containerName,
    '--security-opt', `seccomp=${seccompProfilePath}`,
    '--publish', `127.0.0.1:${port}:6080`,
    '--env', `VNC_PASSWORD=${vncPassword}`,
    '--env', 'CI=true',
    '--env', 'NISAR_DESKTOP_SMOKE=1',
    '--env', `NISAR_DESKTOP_SMOKE_RESULT_FILE=${resultPath}`,
    image,
  ]);
  containerId = started.stdout.trim();
  assert.match(containerId, /^[\da-f]{12,64}$/i, 'docker run should report the started container ID.');

  let smokeResult = null;
  let noVncReady = false;
  for (let attempt = 0; attempt < 75; attempt += 1) {
    const running = docker(['inspect', '--format', '{{.State.Running}}', containerId], { allowFailure: true });
    if (running.status !== 0 || running.stdout.trim() !== 'true') {
      throw new Error(`The container exited before the app was ready:\n${docker(['logs', containerId], { allowFailure: true }).stdout}`);
    }
    smokeResult ??= readSmokeResult();
    noVncReady ||= await verifyNoVnc();
    if (smokeResult && noVncReady) break;
    await delay(1_000);
  }

  assert.ok(smokeResult, 'Electron did not write its packaged-app smoke result within 75 seconds.');
  assert.equal(smokeResult.title, 'NISAR Surface Change');
  assert.equal(smokeResult.provenance, 'Synthetic preview — no satellite measurements');
  assert.ok(smokeResult.timeSeries && smokeResult.coverage && smokeResult.histogram && smokeResult.spatial,
    `Expected all four plots to load. ${JSON.stringify(smokeResult)}`);
  assert.match(smokeResult.pairedCount, /^\d+ paired valid pixels$/);
  assert.equal(smokeResult.rendererSandboxed, true, 'The Linux Electron renderer should run sandboxed.');
  assert.equal(smokeResult.nodeIntegrationDisabled, true, 'Node.js globals should not be available in the Linux renderer.');
  assert.ok(noVncReady, 'noVNC did not return its page on the loopback port.');

  const vncPid = docker(['exec', containerId, 'cat', '/tmp/nisar-x11vnc.pid']).stdout.trim();
  assert.match(vncPid, /^\d+$/, 'The smoke entrypoint should report the x11vnc PID.');
  docker(['exec', containerId, '/bin/sh', '-c', `kill -TERM ${vncPid}`]);
  let containerExitCode = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const running = docker(['inspect', '--format', '{{.State.Running}}', containerId], { allowFailure: true });
    if (running.status === 0 && running.stdout.trim() === 'false') {
      containerExitCode = Number(docker(['inspect', '--format', '{{.State.ExitCode}}', containerId]).stdout.trim());
      break;
    }
    await delay(500);
  }
  assert.equal(containerExitCode, 1, 'The container should stop unsuccessfully when x11vnc exits.');

  console.log(`Linux ${process.env.NISAR_CONTAINER_ARCH} container loaded all plots and synthetic provenance (${smokeResult.pairedCount}); noVNC returned HTTP 200.`);
} catch (error) {
  if (containerId) {
    const logs = docker(['logs', containerId], { allowFailure: true });
    if (logs.stdout || logs.stderr) console.error(`${logs.stdout}${logs.stderr}`);
  }
  throw error;
} finally {
  if (containerId) docker(['rm', '--force', containerId], { allowFailure: true });
}
