module.exports = {
  packagerConfig: {
    name: 'MediPharm Prototype',
    executableName: 'medipharm-prototype',
    appBundleId: 'com.fructum.medipharm.prototype',
    asar: true,
    prune: true,
    download: { checksums: require('electron/checksums.json') },
    // Forge's Vite default keeps only bundles. The service also needs native
    // runtime dependencies; packager's pruning removes the development packages.
    ignore: (file) =>
      Boolean(file) && !/^\/(?:\.vite|node_modules)(?:\/|$)/.test(file) && file !== '/package.json',
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      platforms: ['win32'],
      config: { name: 'MediPharmPrototype', setupExe: 'MediPharm-Prototype-Setup.exe' },
    },
  ],
  plugins: [
    { name: '@electron-forge/plugin-auto-unpack-natives', config: {} },
    {
      name: '@electron-forge/plugin-vite',
      config: {
        build: [
          { entry: 'src/main/main.ts', config: 'vite.main.config.mts', target: 'main' },
          { entry: 'src/preload/preload.ts', config: 'vite.preload.config.mts', target: 'preload' },
          { entry: 'src/service/service.ts', config: 'vite.service.config.mts', target: 'main' },
        ],
        renderer: [{ name: 'main_window', config: 'vite.renderer.config.mts' }],
      },
    },
  ],
};
