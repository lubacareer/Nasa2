import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const appName = 'nisar-surface-change';
const development = process.argv.includes('--dev');
const appDirectory = `NISAR Surface Change-${process.platform}-${process.arch}`;
const outputDirectory = path.resolve(process.env.NISAR_DESKTOP_PACKAGE_DIR
  || path.join(process.env.ELECTRON_OUT_DIR || 'out/desktop', appDirectory));
const executable = process.platform === 'darwin'
  ? path.join(outputDirectory, 'NISAR Surface Change.app', 'Contents', 'MacOS', appName)
  : path.join(outputDirectory, process.platform === 'win32' ? `${appName}.exe` : appName);

if (!development && !fs.existsSync(executable)) {
  throw new Error(`Packaged desktop executable was not found at ${executable}`);
}

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'nisar-desktop-smoke-'));
const resultPath = path.join(temporaryDirectory, 'result.json');
const childEnvironment = { ...process.env };
delete childEnvironment.ELECTRON_RUN_AS_NODE;
childEnvironment.CI = 'true';
childEnvironment.NISAR_DESKTOP_SMOKE = '1';
childEnvironment.NISAR_DESKTOP_SMOKE_RESULT_FILE = resultPath;
let stderr = '';
const command = development ? process.execPath : executable;
const args = development ? [process.env.npm_execpath, 'run', 'desktop:dev'] : [];
if (development && !process.env.npm_execpath) throw new Error('Run this smoke test through npm run desktop:dev:smoke.');
const processHandle = spawn(command, args, {
  env: childEnvironment,
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: process.platform !== 'win32',
});
processHandle.stderr.setEncoding('utf8');
processHandle.stderr.on('data', (chunk) => {
  if (stderr.length < 8_000) stderr += chunk.slice(0, 8_000 - stderr.length);
});
processHandle.stdout.setEncoding('utf8');
processHandle.stdout.on('data', (chunk) => {
  if (stderr.length < 8_000) stderr += chunk.slice(0, 8_000 - stderr.length);
});

async function waitForSmokeResult() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) {
      throw new Error(`Packaged app exited before its window was ready (code ${processHandle.exitCode}). stderr: ${stderr}`);
    }
    if (fs.existsSync(resultPath)) {
      try {
        return JSON.parse(fs.readFileSync(resultPath, 'utf8'));
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Packaged app did not report its loaded preview and plots within 60 seconds. stderr: ${stderr}`);
}

try {
  const result = await waitForSmokeResult();
  if (result.error) throw new Error(`Packaged renderer smoke check failed: ${result.error}`);
  if (result.consoleErrors?.length || result.loadFailures?.length) {
    throw new Error(`Renderer reported errors: ${JSON.stringify({ consoleErrors: result.consoleErrors, loadFailures: result.loadFailures })}`);
  }
  if (result.title !== 'NISAR Surface Change') throw new Error(`Unexpected packaged app title: ${result.title}; result ${JSON.stringify(result)}`);
  if (result.provenance !== 'Synthetic preview — no satellite measurements') {
    throw new Error('The packaged app did not retain its synthetic-data provenance banner.');
  }
  if (!result.timeSeries || !result.coverage || !result.histogram || !result.spatial) {
    const diagnostics = {
      ...Object.fromEntries(['title', 'provenance', 'timeSeries', 'coverage', 'histogram', 'spatial', 'pairedCount'].map((key) => [key, result[key]])),
      consoleMessages: result.consoleMessages,
      loadFailures: result.loadFailures,
      assetRequests: result.assetRequests,
    };
    throw new Error(`Packaged app did not load every linked plot: ${JSON.stringify(diagnostics)}`);
  }
  if (!/^\d+ paired valid pixels$/.test(result.pairedCount)) {
    throw new Error(`Unexpected packaged comparison count: ${result.pairedCount}`);
  }
  if (!result.rendererSandboxed) {
    throw new Error('The packaged renderer did not report Electron sandbox mode as enabled.');
  }
  if (!result.nodeIntegrationDisabled) {
    throw new Error('Node.js globals were available in the packaged renderer.');
  }
  console.log(`${development ? 'Development' : 'Packaged'} ${process.platform}/${process.arch} app loaded all plots and the synthetic preview (${result.pairedCount}).`);
} finally {
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill.exe', ['/PID', String(processHandle.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // The app may already have exited; taskkill only targets this smoke-test process tree.
    }
  } else if (processHandle.exitCode === null) {
    try {
      process.kill(-processHandle.pid, 'SIGTERM');
    } catch {
      processHandle.kill('SIGTERM');
    }
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 5_000);
      processHandle.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    if (processHandle.exitCode === null) {
      try {
        process.kill(-processHandle.pid, 'SIGKILL');
      } catch {
        processHandle.kill('SIGKILL');
      }
    }
  }
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
