const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getUserData: () => ipcRenderer.invoke('get-user-data'),
  logout: () => ipcRenderer.invoke('logout'),
  launchGame: (options) => ipcRenderer.invoke('launch-game', options || {}),
  loginOffline: (username) => ipcRenderer.invoke('login-offline', username),
  loginMicrosoft: () => ipcRenderer.invoke('microsoft-login'),
  checkModpackUpdate: () => ipcRenderer.invoke('check-modpack-update'),
  checkAppUpdate: () => ipcRenderer.invoke('check-app-update'),
  installAppUpdate: () => ipcRenderer.invoke('install-app-update'),
  onLaunchStatus: (cb) => ipcRenderer.on('launch-status', (_event, data) => cb(data)),
  onLaunchLog: (cb) => ipcRenderer.on('launch-log', (_event, data) => cb(data)),
  onAppUpdate: (cb) => ipcRenderer.on('app-update', (_event, data) => cb(data)),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings)
});
