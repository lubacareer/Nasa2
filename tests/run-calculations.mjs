import { spawn, execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

export const MAX_RUN_MS = 50 * 60 * 1000;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = join(root, 'web/public/data/preview.json');

/** Terminate only the subprocess tree this runner created, including its test preview. */
function terminate(child, force = false) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    // Kill the owned tree atomically before a parent exit can orphan a locked preview process.
    execFile(
      'taskkill',
      ['/PID', String(child.pid), '/T', '/F'],
      { windowsHide: true },
      () => {},
    );
  } else {
    try {
      process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
}

/** Run an argument-array command with bounded duration and an external cancellation signal. */
export async function runCommand(
  phase,
  { cwd = root, env = process.env, timeoutMs, signal, logPath, quiet = false },
) {
  await mkdir(dirname(logPath), { recursive: true });
  const started = performance.now();
  return new Promise((resolveResult) => {
    const log = createWriteStream(logPath);
    const child = spawn(phase.command, phase.args ?? [], {
      cwd,
      env,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let timedOut = false;
    let cancelled = false;
    let failure;
    let forceTimer;
    const stop = () => {
      terminate(child);
      forceTimer = setTimeout(() => terminate(child, true), 500);
      forceTimer.unref();
    };
    const onAbort = () => {
      cancelled = true;
      stop();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeoutMs);
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', (chunk) => {
        log.write(chunk);
        if (!quiet) process.stdout.write(chunk);
      });
    }
    child.on('error', (error) => {
      failure = error.message;
    });
    log.on('error', (error) => {
      failure = `Cannot write phase log: ${error.message}`;
      stop();
    });
    child.on('close', (code, exitSignal) => {
      clearTimeout(timer);
      clearTimeout(forceTimer);
      signal?.removeEventListener('abort', onAbort);
      // A timed-out npm parent can exit before its browser descendants. Finish tree cleanup.
      if ((timedOut || cancelled) && process.platform !== 'win32')
        terminate(child, true);
      const result = {
        name: phase.name,
        status: timedOut
          ? 'timed-out'
          : cancelled
            ? 'cancelled'
            : code === 0 && !failure
              ? 'passed'
              : 'failed',
        exitCode: code,
        signal: exitSignal,
        elapsedMs: Math.round(performance.now() - started),
        logPath,
        ...(failure ? { error: failure } : {}),
      };
      log.end(() => resolveResult(result));
    });
  });
}

const hashFile = async (path) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex');

/** Read standard test reports without turning absent, failed-phase reports into passing counts. */
async function readCounts(artifactDir) {
  const counts = {};
  const json = async (path) => {
    try {
      return JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  };
  const frontend = await json(join(artifactDir, 'frontend.json'));
  if (frontend)
    counts.frontend = {
      passed: frontend.numPassedTests,
      failed: frontend.numFailedTests,
      skipped: frontend.numPendingTests,
    };
  try {
    const xml = await readFile(join(artifactDir, 'python.xml'), 'utf8');
    const suites = [...xml.matchAll(/<testsuite\b[^>]*>/g)].map(
      (match) => match[0],
    );
    const sum = (field) =>
      suites.reduce(
        (total, suite) =>
          total +
          Number(suite.match(new RegExp(`\\b${field}="(\\d+)"`))?.[1] ?? 0),
        0,
      );
    counts.python = {
      passed: sum('tests') - sum('failures') - sum('errors') - sum('skipped'),
      failed: sum('failures') + sum('errors'),
      skipped: sum('skipped'),
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const name of ['functional', 'stability']) {
    const report = await json(join(artifactDir, name, 'report.json'));
    if (report)
      counts[name] = {
        passed: report.stats.expected,
        failed: report.stats.unexpected,
        flaky: report.stats.flaky,
        skipped: report.stats.skipped,
      };
  }
  return counts;
}

/** Execute calculation checks under one deadline and always publish an honest phase summary. */
export async function runPhases({
  phases,
  budgetMs = MAX_RUN_MS,
  artifactDir,
  env = process.env,
  protectedFixture,
  quiet = false,
  mode = 'custom',
  revision,
}) {
  if (!Number.isFinite(budgetMs) || budgetMs <= 0 || budgetMs > MAX_RUN_MS)
    throw new Error('The test budget must be positive and at most 50 minutes.');
  await mkdir(artifactDir, { recursive: true });
  const started = performance.now();
  let initialHash = null;
  const controller = new AbortController();
  let interrupted = false;
  const onInterrupt = () => {
    interrupted = true;
    controller.abort();
  };
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onInterrupt);
  const summary = {
    mode,
    startedAt: new Date().toISOString(),
    budgetMs,
    status: 'passed',
    phases: [],
    artifactDir,
    ...(revision ? { revision } : {}),
  };
  try {
    initialHash = protectedFixture ? await hashFile(protectedFixture) : null;
    for (const phase of phases) {
      const remaining = budgetMs - (performance.now() - started);
      if (remaining <= 0 || interrupted) {
        summary.status = interrupted ? 'cancelled' : 'timed-out';
        break;
      }
      if (!quiet) process.stdout.write(`\n[calculation tests] ${phase.name}\n`);
      const result = await runCommand(phase, {
        env,
        timeoutMs: Math.min(phase.timeoutMs, remaining),
        signal: controller.signal,
        quiet,
        logPath: join(artifactDir, 'logs', `${summary.phases.length + 1}.log`),
      });
      summary.phases.push(result);
      if (result.status !== 'passed') {
        summary.status = result.status;
        break;
      }
    }
    if (protectedFixture) {
      summary.fixtureUnchanged =
        initialHash === (await hashFile(protectedFixture));
      if (!summary.fixtureUnchanged) summary.status = 'failed';
    }
  } catch (error) {
    summary.status = 'failed';
    summary.error = error.message;
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onInterrupt);
    try {
      summary.counts = await readCounts(artifactDir);
      const required =
        mode === 'all'
          ? ['frontend', 'python', 'functional', 'stability']
          : mode === 'custom'
            ? []
            : [mode];
      summary.missingReports = required.filter((name) => !summary.counts[name]);
      const badReport = Object.values(summary.counts).some(
        (counts) => counts.failed > 0 || counts.skipped > 0 || counts.flaky > 0,
      );
      if (
        summary.status === 'passed' &&
        (summary.missingReports.length || badReport)
      )
        summary.status = 'failed';
    } catch (error) {
      summary.status = 'failed';
      summary.error = `Cannot read test reports: ${error.message}`;
    }
    summary.elapsedMs = Math.round(performance.now() - started);
    if (summary.status === 'passed' && summary.elapsedMs > budgetMs)
      summary.status = 'timed-out';
    summary.completedPhases = summary.phases.length;
    summary.unexecutedPhases = phases
      .slice(summary.phases.length)
      .map((p) => p.name);
    summary.finishedAt = new Date().toISOString();
    await writeFile(
      join(artifactDir, 'summary.json'),
      `${JSON.stringify(summary, null, 2)}\n`,
    );
    if (!quiet)
      process.stdout.write(
        `\nCalculation test run ${summary.status} in ${(summary.elapsedMs / 60000).toFixed(2)} minutes. Artifacts: ${artifactDir}\n`,
      );
  }
  return summary;
}

/** Build the prepared-data reference and test the actual production bundle, never the user's dev server. */
async function main() {
  const mode = process.argv[2] ?? 'all';
  if (!['all', 'functional', 'stability'].includes(mode))
    throw new Error('Use npm run test:all, test:e2e, or test:stability.');
  const npmCli = process.env.npm_execpath;
  if (!npmCli)
    throw new Error('Invoke this runner through the documented npm scripts.');
  const stamp = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
  const artifactDir = resolve(
    process.env.TEST_ARTIFACT_DIR ??
      join(tmpdir(), 'nisar-calculation-tests', stamp),
  );
  const oracle = join(artifactDir, 'calculation-oracle.json');
  const env = {
    ...process.env,
    PYTHONUTF8: '1',
    TEST_ARTIFACT_DIR: artifactDir,
    CALCULATION_ORACLE_PATH: oracle,
    ...(mode === 'all' ? { STABILITY_DURATION_MS: '600000' } : {}),
  };
  const npm = (name, args, timeoutMs = 180000) => ({
    name,
    command: process.execPath,
    args: [npmCli, ...args],
    timeoutMs,
  });
  const uv = (name, args, timeoutMs = 180000) => ({
    name,
    command: 'uv',
    args: ['run', '--project', 'processing', ...args],
    timeoutMs,
  });
  const phases = [
    ...(mode === 'all'
      ? [
          npm('Test runner deadline checks', ['run', 'test:runner']),
          npm('Frontend lint', ['run', 'lint']),
          npm('TypeScript check', ['run', 'typecheck']),
          npm('Frontend calculation and chart tests', [
            'run',
            'test',
            '--workspace',
            'web',
            '--',
            '--reporter=default',
            '--reporter=json',
            `--outputFile=${join(artifactDir, 'frontend.json')}`,
          ]),
          uv('Python lint', ['ruff', 'check', 'processing']),
          uv('Python calculations and CLI tests', [
            'pytest',
            'processing/tests',
            `--junitxml=${join(artifactDir, 'python.xml')}`,
          ]),
          uv('Validate the prepared fixture', [
            'python',
            '-m',
            'nisar_preview',
            'validate',
          ]),
          uv('Check fixture reproducibility without writing', [
            'python',
            '-m',
            'nisar_preview',
            'generate',
            '--check',
          ]),
        ]
      : []),
    npm('Production build', ['run', 'build']),
    uv('Independent numerical reference', [
      'python',
      'processing/tests/build_calculation_oracle.py',
      '--output',
      oracle,
    ]),
    ...(mode !== 'stability'
      ? [
          npm(
            'Six browser/viewport calculation projects',
            ['run', 'test:e2e', '--workspace', 'web'],
            17 * 60000,
          ),
        ]
      : []),
    ...(mode !== 'functional'
      ? [
          npm(
            'Three concurrent calculation stability sessions',
            ['run', 'test:stability', '--workspace', 'web'],
            14 * 60000,
          ),
        ]
      : []),
  ];
  const revision = {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 5000,
    }).trim(),
    dirty:
      execFileSync('git', ['status', '--porcelain'], {
        cwd: root,
        encoding: 'utf8',
        timeout: 5000,
      }).trim().length > 0,
  };
  const summary = await runPhases({
    phases,
    artifactDir,
    env,
    protectedFixture: fixturePath,
    mode,
    revision,
  });
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = Object.entries(summary.counts ?? {}).map(
      ([name, counts]) =>
        `| ${name} | ${counts.passed ?? 0} | ${counts.failed ?? 0} | ${counts.skipped ?? 0} | ${counts.flaky ?? 0} |`,
    );
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `## Calculation verification: ${summary.status}\n\nCommit: \`${revision.commit}\`\n\nElapsed: ${(summary.elapsedMs / 60000).toFixed(2)} minutes. Preview unchanged: ${summary.fixtureUnchanged ?? 'not checked'}.\n\n| Layer | Passed | Failed | Skipped | Flaky |\n| --- | ---: | ---: | ---: | ---: |\n${rows.join('\n')}\n\nUnexecuted phases: ${summary.unexecutedPhases.length}. Numerical references, phase logs and failure evidence are in the uploaded calculation artifact.\n`,
    );
  }
  process.exitCode = summary.status === 'passed' ? 0 : 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
