module.exports = {
  outDir: process.env.ELECTRON_OUT_DIR || 'out/desktop',
  packagerConfig: {
    asar: true,
    executableName: 'nisar-surface-change',
    appBundleId: 'org.nisar.surfacechange',
    ignore: [
      /^\/\.git(?:\/|$)/,
      /^\/\.github(?:\/|$)/,
      /^\/\.artifacts(?:\/|$)/,
      /^\/\.ruff_cache(?:\/|$)/,
      /^\/out(?:\/|$)/,
      /^\/node_modules(?:\/|$)/,
      /^\/processing(?:\/|$)/,
      /^\/tests(?:\/|$)/,
      /^\/contracts(?:\/|$)/,
      /^\/docs(?:\/|$)/,
      /^\/web\/node_modules(?:\/|$)/,
      /^\/web\/src(?:\/|$)/,
      /^\/web\/e2e(?:\/|$)/,
      /^\/web\/playwright\..*$/,
      /^\/web\/playwright\.stability\..*$/,
      /^\/AGENTS\.md$/,
      /^\/CONTRIBUTING\.md$/,
      /^\/README\.md$/,
      /^\/package-lock\.json$/,
      /^\/eslint\.config\.js$/,
      /^\/\.coderabbit\.yaml$/,
    ],
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'nisar_surface_change',
        setupExe: 'NISAR-Surface-Change-Setup.exe',
      },
    },
    {
      name: '@electron-forge/maker-dmg',
      config: { format: 'ULFO' },
    },
    {
      name: '@electron-forge/maker-deb',
      config: {
        options: {
          categories: ['Science'],
          maintainer: 'NISAR Surface Change contributors',
          homepage: 'https://github.com/lubacareer/Nasa2',
        },
      },
    },
  ],
};
