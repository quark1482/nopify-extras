// src/main.js
const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const db = require('./db/database');
const { encrypt, decrypt } = require('./db/crypto');
const isDev = process.argv.includes('--dev');
const stateFile = path.join(app.getPath('userData'), 'window-state.json');
let currentTheme = null;

function loadWindowState() {
    try {
        const data = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        return {
            width: data.width || 1000,
            height: data.height || 700,
            x: data.x,
            y: data.y,
            maximized: data.maximized || false,
            theme: data.theme || null
        };
    }
    catch {
        return {
            width: 1000,
            height: 700,
            maximized: false,
            theme: null
        };
    }
}

function saveWindowState(win) {
    const bounds = win.getBounds();
    const state = {
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        maximized: win.isMaximized(),
        theme: currentTheme
    };
    fs.writeFileSync(stateFile, JSON.stringify(state));
}

function createWindow() {
    const state = loadWindowState();
    currentTheme = state.theme;
    const win = new BrowserWindow({
        width: state.width,
        height: state.height,
        x: state.x,
        y: state.y,
        icon: path.join(__dirname, 'assets/nopify.ico'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            devTools: isDev
        }
    });
    if (state.maximized) {
        win.maximize();
    }
    win.loadFile(path.join(__dirname, 'renderer/index.html'));
    win.on('close', (e) => {
        const dirty = win.webContents.getURL().includes('#dirty');
        if (dirty) {
            const choice = dialog.showMessageBoxSync(win, {
                type: 'question',
                buttons: ['Cancel', 'Exit'],
                defaultId: 0,
                message: 'You have unsaved changes. Exit anyway?'
            });
            if (choice === 0) {
                e.preventDefault();
                return;
            }
        }
        saveWindowState(win);
    });
    if (!isDev) {
        win.webContents.on('before-input-event', (event, input) => {
            if (input.control && input.shift && input.key
                .toLowerCase() === 'i') {
                event.preventDefault();
            }
        });
    }
    setupMenu(win);
    // Send current theme to renderer after load
    win.webContents.on('did-finish-load', () => {
        win.webContents.send('set-initial-theme', currentTheme);
    });
}

function setupMenu(win) {
    const template = [{
        role: 'fileMenu'
    }];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle('load-servers', () => {
    return db.loadAll().map(r => ({
        ...r,
        password: decrypt(r.password)
    }));
});

ipcMain.handle('save-servers', (event, rows) => {
    try {
        const encrypted = rows.map(r => ({
            ...r,
            password: encrypt(r.password)
        }));
        db.replaceAll(encrypted);
    }
    catch (e) {
        const msg = e.message || '';
        let friendly = 'Save failed: ' + msg;
        const lowerMsg = msg.toLowerCase();
        if (lowerMsg.includes('unique') && lowerMsg.includes(
                'hostname')) {
            friendly = 'A server with this hostname already exists.';
        }
        else if (lowerMsg.includes('unique') && lowerMsg.includes(
                'nickname')) {
            friendly = 'A server with this nickname already exists.';
        }
        else if (lowerMsg.includes('constraint failed')) {
            // Catch other future constraints generically
            friendly = 'Invalid data: a database rule was violated.';
        }
        throw new Error(friendly);
    }
});

ipcMain.handle('delete-servers', (event, hostnames) => {
    db.deleteByHostnames(hostnames);
});

ipcMain.handle('confirm', async (event, message) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { response } = await dialog.showMessageBox(win, {
        type: 'question',
        buttons: ['Cancel', 'OK'],
        defaultId: 1,
        cancelId: 0,
        message
    });
    return response === 1;
});

ipcMain.handle('error', (event, message) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    dialog.showMessageBox(win, {
        type: 'error',
        message
    });
});

ipcMain.handle('is-dev', () => isDev);

ipcMain.on('update-current-theme', (event, newTheme) => {
    currentTheme = newTheme;
});

app.whenReady().then(createWindow);