module.exports = {
  outDir: process.env.ELECTRON_OUT_DIR || 'out/desktop',
  packagerConfig: {
    asar: true,
    executableName: 'nisar-surface-change',
    appBundleId: 'org.nisar.surfacechange',
    ignore: [
      // The renderer is bundled already; package only the Electron runtime and web/dist.
      /^\/(?!(?:package\.json$|electron(?:\/|$)|web(?:\/dist(?:\/|$)|$))).*/,
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
