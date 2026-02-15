// src/preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    loadServers: () => ipcRenderer.invoke('load-servers'),
    saveServers: (rows) => ipcRenderer.invoke('save-servers', rows),
    deleteServers: (hostnames) => ipcRenderer.invoke('delete-servers', hostnames),
    confirm: (msg) => ipcRenderer.invoke('confirm', msg),
    error: (msg) => ipcRenderer.invoke('error', msg),
    isDev: () => ipcRenderer.invoke('is-dev'),
    onSetInitialTheme: (callback) => ipcRenderer.on('set-initial-theme', (e, theme) => callback(theme)),
    updateCurrentTheme: (theme) => ipcRenderer.send('update-current-theme', theme)
});