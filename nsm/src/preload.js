// src/preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    loadServers        : () => ipcRenderer.invoke('load-servers'),
    saveServers        : (rows) => ipcRenderer.invoke('save-servers', rows),
    deleteServers      : (hostnames) => ipcRenderer.invoke('delete-servers', hostnames),
    confirm            : (msg) => ipcRenderer.invoke('confirm', msg),
    error              : (msg) => ipcRenderer.invoke('error', msg),
    isDev              : () => ipcRenderer.invoke('is-dev'),
    getSrcPath         : () => ipcRenderer.invoke('get-src-path'),
    readLocalFile      : (p) => ipcRenderer.invoke('read-local-file', p),
    onSetInitialTheme  : (callback) => ipcRenderer.on('set-initial-theme', (e, theme) => callback(theme)),
    updateCurrentTheme : (theme) => ipcRenderer.send('update-current-theme', theme),
    spawnPwsh          : (code) => ipcRenderer.invoke('spawn-pwsh', code),
    warnConfirm        : (msg) => ipcRenderer.invoke('warn-confirm', msg)
});