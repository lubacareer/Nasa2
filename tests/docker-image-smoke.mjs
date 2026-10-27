import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const image = 'nisar-surface-change:ci';
const container = 'nisar-docker-image-smoke';
const resultPath = '/tmp/desktop-smoke-result.json';
const seccompProfilePath = path.resolve('docker/seccomp-profile.json');
const port = 6080;
const vncPassword = randomBytes(4).toString('hex');
const seccompProfile = JSON.parse(fs.readFileSync(seccompProfilePath, 'utf8'));

assert.equal(seccompProfile.defaultAction, 'SCMP_ACT_ERRNO');
assert.ok(seccompProfile.syscalls.some((rule) => rule.action === 'SCMP_ACT_ALLOW' && rule.names.includes('clone')));
assert.ok(seccompProfile.syscalls.some((rule) => rule.action === 'SCMP_ACT_ALLOW' && rule.names.includes('unshare')));
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
  const probe = docker(['exec', container, 'test', '-s', resultPath], { allowFailure: true });
  if (probe.status !== 0) return null;
  return JSON.parse(docker(['exec', container, 'cat', resultPath]).stdout);
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

  docker([
    'run', '--detach', '--name', container,
    '--security-opt', `seccomp=${seccompProfilePath}`,
    '--publish', `127.0.0.1:${port}:6080`,
    '--env', `VNC_PASSWORD=${vncPassword}`,
    '--env', 'CI=true',
    '--env', 'NISAR_DESKTOP_SMOKE=1',
    '--env', `NISAR_DESKTOP_SMOKE_RESULT_FILE=${resultPath}`,
    image,
  ]);

  let smokeResult = null;
  let noVncReady = false;
  for (let attempt = 0; attempt < 75; attempt += 1) {
    const running = docker(['inspect', '--format', '{{.State.Running}}', container], { allowFailure: true });
    if (running.status !== 0 || running.stdout.trim() !== 'true') {
      throw new Error(`The container exited before the app was ready:\n${docker(['logs', container], { allowFailure: true }).stdout}`);
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
  assert.ok(noVncReady, 'noVNC did not return its page on the loopback port.');

  const vncPid = docker(['exec', container, 'cat', '/tmp/nisar-x11vnc.pid']).stdout.trim();
  assert.match(vncPid, /^\d+$/, 'The smoke entrypoint should report the x11vnc PID.');
  docker(['exec', container, '/bin/sh', '-c', `kill -TERM ${vncPid}`]);
  let containerExitCode = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const running = docker(['inspect', '--format', '{{.State.Running}}', container], { allowFailure: true });
    if (running.status === 0 && running.stdout.trim() === 'false') {
      containerExitCode = Number(docker(['inspect', '--format', '{{.State.ExitCode}}', container]).stdout.trim());
      break;
    }
    await delay(500);
  }
  assert.equal(containerExitCode, 1, 'The container should stop unsuccessfully when x11vnc exits.');

  console.log(`Linux ${process.env.NISAR_CONTAINER_ARCH} container loaded all plots and synthetic provenance (${smokeResult.pairedCount}); noVNC returned HTTP 200.`);
} catch (error) {
  const logs = docker(['logs', container], { allowFailure: true });
  if (logs.stdout || logs.stderr) console.error(`${logs.stdout}${logs.stderr}`);
  throw error;
} finally {
  docker(['rm', '--force', container], { allowFailure: true });
}
