// src/main.js
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const db   = require('./db/database');
const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const { encrypt, decrypt }                          = require('./db/crypto');

const isDev     = process.argv.includes('--dev');
const stateFile = path.join(app.getPath('userData'), 'window-state.json');

let currentTheme = null;

function loadWindowState() {
    try {
        const data = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        return {
            width     : data.width || 1000,
            height    : data.height || 700,
            x         : data.x,
            y         : data.y,
            maximized : data.maximized || false,
            theme     : data.theme || null
        };
    }
    catch {
        return {
            width     : 1000,
            height    : 700,
            maximized : false,
            theme     : null };
    }
}

function saveWindowState(win) {
    const maximized = win.isMaximized();
    const state     = {
        maximized,
        theme: currentTheme
    };
    if (!maximized) {
        const [width, height] = win.getContentSize();
        const bounds          = win.getBounds();
        state.width  = width;
        state.height = height;
        state.x      = bounds.x;
        state.y      = bounds.y;
    }
    else {
        try {
            const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
            state.width  = saved.width  || 1000;
            state.height = saved.height || 700;
            state.x      = saved.x;
            state.y      = saved.y;
        }
        catch {
            state.width  = 1000;
            state.height = 700;
        }
    }
    fs.writeFileSync(stateFile, JSON.stringify(state));
}

function createWindow() {
    const state = loadWindowState();
    currentTheme = state.theme;
    const win   = new BrowserWindow({
        width          : state.width,
        height         : state.height,
        x              : state.x,
        y              : state.y,
        useContentSize : true,
        icon           : path.join(__dirname, 'assets/nopify.ico'),
        webPreferences : {
            preload          : path.join(__dirname, 'preload.js'),
            contextIsolation : true,
            nodeIntegration  : false
        }
    });
    if (state.maximized) {
        win.maximize();
    }
    win.loadFile(path.join(__dirname, 'renderer/index.html'));
    if (isDev) {
        win.webContents.openDevTools();
    }
    win.on('close', (e) => {
        const dirty = win.webContents.getURL().includes('#dirty');
        if (dirty) {
            const choice  = dialog.showMessageBoxSync(win, {
                type      : 'question',
                buttons   : ['Cancel', 'Exit'],
                defaultId : 0,
                message   : 'You have unsaved changes. Exit anyway?'
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
            if (input.control && input.shift && input.key.toLowerCase() === 'i') {
                event.preventDefault();
            }
        });
    }
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'fileMenu' }]));
    win.webContents.on('did-finish-load', () => { win.webContents.send('set-initial-theme', currentTheme); });
}

ipcMain.handle('load-servers', () => {
    return db.loadAll().map(r => ({ ...r, password: decrypt(r.password) }));
});

ipcMain.handle('save-servers', (event, rows) => {
    try {
        db.replaceAll(rows.map(r => ({ ...r, password: encrypt(r.password) })));
    }
    catch (e) {
        const msg      = e.message || '';
        const lowerMsg = msg.toLowerCase();
        let friendly = 'Save failed: ' + msg;
        if (lowerMsg.includes('unique') && lowerMsg.includes('hostname')) {
            friendly = 'A server with this hostname already exists.';
        }
        else if (lowerMsg.includes('unique') && lowerMsg.includes('nickname')) {
            friendly = 'A server with this nickname already exists.';
        }
        else if (lowerMsg.includes('constraint failed')) {
            friendly = 'Invalid data: a database rule was violated.';
        }
        throw new Error(friendly);
    }
});

ipcMain.handle('delete-servers', (event, hostnames) => db.deleteByHostnames(hostnames));

ipcMain.handle('confirm', async (event, message) => {
    const win          = BrowserWindow.fromWebContents(event.sender);
    const { response } = await dialog.showMessageBox(win, {
        type      : 'question',
        buttons   : ['Cancel', 'OK'],
        defaultId : 1,
        cancelId  : 0,
        message
    });
    return response === 1;
});

ipcMain.handle('warn-confirm', async (event, message) => {
    const win          = BrowserWindow.fromWebContents(event.sender);
    const { response } = await dialog.showMessageBox(win, {
        type      : 'warning',
        buttons   : ['Cancel', 'Proceed'],
        defaultId : 0,
        cancelId  : 0,
        message
    });
    return response === 1;
});

ipcMain.handle('error', (event, message) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    dialog.showMessageBox(win, {
        type : 'error',
        message
    });
});

ipcMain.handle('is-dev', () => isDev);

ipcMain.handle('get-src-path', () => {
    // Returns the file:// URL base for the src folder, used in dev mode
    // to load manifests and scripts from the local filesystem instead of the repo.
    return 'file:///' + __dirname.replace(/\\/g, '/');
});

ipcMain.handle('read-local-file', async (event, relativePath) => {
    // Used in dev mode to read scripts/manifest directly from src folder.
    // fetch() on file:// URLs is unreliable in Electron on Windows.
    const fullPath = path.join(__dirname, relativePath);
    return fs.promises.readFile(fullPath, 'utf8');
});

ipcMain.on('update-current-theme', (event, newTheme) => { currentTheme = newTheme; });

ipcMain.handle('spawn-pwsh', async (event, pwshCode) => {
    const tempDir  = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'nsm-'));
    const tempFile = path.join(tempDir, 'script.ps1');
    try {
        await fs.promises.writeFile(tempFile, pwshCode, 'utf8');
        return new Promise((resolve, reject) => {
            const { spawn } = require('child_process');
            const child     = spawn('powershell', ['-ExecutionPolicy', 'Bypass', '-File', tempFile], { shell: true });
            let stdout = '';
            let stderr = '';
            child.stdout.on('data', data => stdout += data);
            child.stderr.on('data', data => stderr += data);
            child.on('close', code => {
                fs.rm(tempDir, {
                    recursive : true,
                    force     : true
                }, () => {});
                if (code === 0) {
                    resolve({ success: true, output: stdout, stderr });
                }
                else {
                    reject(new Error(`Exit ${code}: ${stdout}${stderr}`));
                }
            });
            child.on('error', err => {
                fs.rm(tempDir, {
                    recursive : true,
                    force     : true
                }, () => {});
                reject(err);
            });
        });
    }
    catch (err) {
        fs.rm(tempDir, {
            recursive : true,
            force     : true
        }, () => {});
        throw err;
    }
});

app.whenReady().then(createWindow);