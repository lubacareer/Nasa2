import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const env = { ...process.env, ELECTRON_RENDERER_URL: 'http://127.0.0.1:5180' };
// Setting this to an empty string still enables Node mode on Windows.
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), ['.'], { env, stdio: 'inherit' });
child.on('error', (error) => { console.error(error); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
