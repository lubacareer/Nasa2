const { app, BrowserWindow, shell, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createAssetServer, isAllowedExternalUrl } = require('./static-server.cjs');

let assetServer;
let rendererOrigin;
const smokeResultPath = process.env.NISAR_DESKTOP_SMOKE_RESULT_FILE;
const smokeRun = process.env.CI === 'true' && process.env.NISAR_DESKTOP_SMOKE === '1' && Boolean(smokeResultPath);
const assetRequests = smokeRun ? [] : null;

function validateDevelopmentUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port !== '5180') {
    throw new Error('The development renderer must use http://127.0.0.1:5180.');
  }
  return url.toString();
}

function isTrustedRendererUrl(value) {
  try {
    return new URL(value).origin === rendererOrigin;
  } catch {
    return false;
  }
}

function installSmokeReporter(window) {
  if (!smokeRun || !smokeResultPath) return;
  const consoleMessages = [];
  const consoleErrors = [];
  const loadFailures = [];
  window.webContents.on('console-message', (...args) => {
    const details = args.find((value) => value && typeof value === 'object' && typeof value.message === 'string');
    const text = details?.message || args.filter((value) => typeof value === 'string').join(' ');
    if (text) consoleMessages.push(text.slice(0, 500));
    if (details?.level === 'error' || args[1] === 3) consoleErrors.push(text.slice(0, 500));
  });
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    loadFailures.push({ code, description, url });
  });

  window.webContents.once('did-finish-load', async () => {
    try {
      const result = await window.webContents.executeJavaScript(`new Promise((resolve) => {
        let attempts = 0;
        const inspect = () => {
          const value = {
            title: document.querySelector('h1')?.textContent?.trim() || '',
            provenance: document.querySelector('.preview-banner strong')?.textContent?.trim() || '',
            timeSeries: Boolean(document.querySelector('[data-testid="time-series"]')),
            coverage: Boolean(document.querySelector('[data-testid="coverage-strip"]')),
            histogram: Boolean(document.querySelector('[data-testid="change-histogram"]')),
            spatial: Boolean(document.querySelector('[data-testid="spatial-grid"]')),
            pairedCount: document.querySelector('[data-testid="paired-count"]')?.textContent?.trim() || '',
            nodeIntegrationDisabled: typeof require === 'undefined' && typeof process === 'undefined',
          };
          if ((value.timeSeries && value.coverage && value.histogram && value.spatial) || attempts >= 400) {
            resolve(value);
          } else {
            attempts += 1;
            setTimeout(inspect, 50);
          }
        };
        inspect();
      })`);
      fs.writeFileSync(smokeResultPath, JSON.stringify({
        ...result,
        rendererSandboxed: window.webContents.getLastWebPreferences()?.sandbox === true,
        consoleMessages,
        consoleErrors,
        loadFailures,
        assetRequests,
      }));
    } catch (error) {
      fs.writeFileSync(smokeResultPath, JSON.stringify({ error: String(error), consoleMessages, loadFailures, assetRequests }));
    }
  });
}

async function startRenderer() {
  const developmentUrl = process.env.ELECTRON_RENDERER_URL;
  if (developmentUrl) {
    const url = validateDevelopmentUrl(developmentUrl);
    rendererOrigin = new URL(url).origin;
    return url;
  }

  if (assetServer?.listening && rendererOrigin) return `${rendererOrigin}/`;

  const assetDirectory = path.join(app.getAppPath(), 'web', 'dist');
  assetServer = createAssetServer(assetDirectory, assetRequests ? (request) => assetRequests.push(request) : undefined);
  await new Promise((resolve, reject) => {
    assetServer.once('error', reject);
    assetServer.listen(0, '127.0.0.1', resolve);
  });
  const address = assetServer.address();
  rendererOrigin = `http://127.0.0.1:${address.port}`;
  return `${rendererOrigin}/`;
}

async function createWindow() {
  const rendererUrl = await startRenderer();
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 760,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    title: 'NISAR Surface Change',
    webPreferences: {
      contextIsolation: true,
      devTools: !app.isPackaged,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault();
  });
  window.webContents.on('will-redirect', (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault();
  });
  installSmokeReporter(window);
  window.once('ready-to-show', () => window.show());
  await window.loadURL(rendererUrl);
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  return createWindow();
}).catch((error) => {
  console.error('The desktop workbench could not start:', error);
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});

app.on('before-quit', () => {
  if (assetServer?.listening) assetServer.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
