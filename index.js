const path = require('path');
const fs = require('fs');
const https = require('https');
const { app, BrowserWindow, ipcMain, Notification, Tray, Menu, dialog, shell } = require('electron');

const APP_ICON_PATH = path.join(__dirname, 'assets', 'icon.png');
const PRELOAD_PATH = path.join(__dirname, 'preload.js');
const APP_URL = 'https://talk.shapes.inc';
const appName = 'Shapes';
const UPDATE_CHECK_URL = 'https://api.github.com/repos/JulerGT/Shapes/releases/latest';
const DOWNLOAD_URL = 'https://github.com/JulerGT/Shapes/releases/latest';
const DEFAULT_SETTINGS = {
    launchOnStartup: false,
    startMinimized: false
};

let mainWindow;
let splashWindow;
let tray;
let isQuitting = false;
let isAppActivated = false;
let settingsPath = '';
let appSettings = { ...DEFAULT_SETTINGS };
let launchMinimizedThisRun = false;
let audioCheckInterval = null;
let audioNotificationSent = false;

function loadAppSettings() {
    if (!settingsPath || !fs.existsSync(settingsPath)) {
        return { ...DEFAULT_SETTINGS };
    }

    try {
        const raw = fs.readFileSync(settingsPath, 'utf8');
        const parsed = JSON.parse(raw);
        return {
            launchOnStartup: Boolean(parsed.launchOnStartup),
            startMinimized: Boolean(parsed.startMinimized)
        };
    } catch (error) {
        console.warn('Failed to read settings, using defaults.', error);
        return { ...DEFAULT_SETTINGS };
    }
}

function saveAppSettings() {
    if (!settingsPath) {
        return;
    }

    try {
        fs.writeFileSync(settingsPath, JSON.stringify(appSettings, null, 2), 'utf8');
    } catch (error) {
        console.warn('Failed to save settings.', error);
    }
}

function applyLoginItemSettings() {
    const loginArgs = ['--startup-launch'];
    if (appSettings.startMinimized) {
        loginArgs.push('--start-minimized');
    }

    app.setLoginItemSettings({
        openAtLogin: appSettings.launchOnStartup,
        openAsHidden: appSettings.startMinimized,
        args: appSettings.launchOnStartup ? loginArgs : []
    });
}

function checkForUpdates() {
    const currentVersion = app.getVersion();

    const request = https.request(
        UPDATE_CHECK_URL,
        { method: 'GET', timeout: 7000, headers: { 'User-Agent': appName } },
        (response) => {
            let data = '';
            response.on('data', (chunk) => { data += chunk; });
            response.on('end', () => {
                try {
                    const release = JSON.parse(data);
                    const latestVersion = (release.tag_name || '').replace(/^v/, '');
                    if (latestVersion && latestVersion !== currentVersion) {
                        dialog.showMessageBox(mainWindow, {
                            type: 'info',
                            title: 'Update Available',
                            message: `A new version of ${appName} is available!`,
                            detail: `Current: v${currentVersion}\nLatest: v${latestVersion}\n\nWould you like to download it?`,
                            buttons: ['Download', 'Later'],
                            defaultId: 0
                        }).then(({ response: btn }) => {
                            if (btn === 0) {
                                shell.openExternal(DOWNLOAD_URL);
                            }
                        });
                    }
                } catch (_) {}
            });
        }
    );

    request.on('error', () => {});
    request.on('timeout', () => { request.destroy(); });
    request.end();
}

function checkInternetConnection() {
    return new Promise((resolve) => {
        const request = https.request(APP_URL, { method: 'HEAD', timeout: 7000 }, (response) => {
            const isConnected = response.statusCode >= 200 && response.statusCode < 500;
            response.resume();
            resolve(isConnected);
        });

        request.on('timeout', () => {
            request.destroy();
            resolve(false);
        });

        request.on('error', () => {
            resolve(false);
        });

        request.end();
    });
}

function setupWebNotificationBridge() {
    ipcMain.removeAllListeners('web-notification');
    ipcMain.on('web-notification', (_event, payload = {}) => {
        const title = typeof payload.title === 'string' && payload.title.trim()
            ? payload.title.trim()
            : 'Notification';
        const body = typeof payload.body === 'string' ? payload.body : '';
        const silent = Boolean(payload.silent);
        const urgency = typeof payload.urgency === 'string' ? payload.urgency : undefined;

        if (!Notification.isSupported()) {
            console.warn('Notifications are not supported on this system.');
            return;
        }

        const notification = new Notification({
            title,
            body,
            silent,
            urgency,
            icon: APP_ICON_PATH
        });

        notification.on('click', () => {
            showMainWindow();
        });

        notification.show();
    });
}

function createSplashWindow() {
    splashWindow = new BrowserWindow({
        width: 360,
        height: 220,
        frame: false,
        resizable: false,
        movable: true,
        minimizable: false,
        maximizable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        icon: APP_ICON_PATH,
        backgroundColor: '#101418',
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
        <!doctype html>
        <html>
        <head>
            <meta charset="UTF-8" />
            <style>
                body {
                    margin: 0;
                    height: 100vh;
                    display: grid;
                    place-items: center;
                    background: radial-gradient(circle at top, #1a2430, #101418 70%);
                    color: #ffffff;
                    font-family: Segoe UI, sans-serif;
                }
                .box {
                    text-align: center;
                    letter-spacing: 0.3px;
                }
                .title {
                    font-size: 24px;
                    font-weight: 600;
                    margin-bottom: 8px;
                }
                .subtitle {
                    font-size: 13px;
                    opacity: 0.75;
                }
            </style>
        </head>
        <body>
            <div class="box">
                <div class="title">${appName}</div>
                <div class="subtitle">Loading app...</div>
            </div>
        </body>
        </html>
    `)}`);
}

function activateApp() {
    if (!mainWindow) {
        return;
    }

    if (!isAppActivated) {
        isAppActivated = true;

        if (splashWindow && !splashWindow.isDestroyed()) {
            splashWindow.close();
            splashWindow = null;
        }
    }

    if (mainWindow.isMinimized()) {
        mainWindow.restore();
    }

    mainWindow.show();
    mainWindow.focus();
}

function showMainWindow() {
    if (!mainWindow) {
        createWindow();
        return;
    }

    launchMinimizedThisRun = false;
    activateApp();
}

function refreshTrayMenu() {
    if (!tray) {
        return;
    }

    tray.setContextMenu(
        Menu.buildFromTemplate([
            { label: `Show ${appName}`, click: showMainWindow },
            { type: 'separator' },
            {
                label: 'Launch on startup',
                type: 'checkbox',
                checked: appSettings.launchOnStartup,
                click: (menuItem) => {
                    appSettings.launchOnStartup = menuItem.checked;
                    saveAppSettings();
                    applyLoginItemSettings();
                    refreshTrayMenu();
                }
            },
            {
                label: 'Start minimized',
                type: 'checkbox',
                checked: appSettings.startMinimized,
                click: (menuItem) => {
                    if (menuItem.checked && !appSettings.launchOnStartup) {
                        if (Notification.isSupported()) {
                            new Notification({
                                title: `${appName}`,
                                body: 'You can\'\'t start the app minimized without enabling "Launch on startup". Please enable "Launch on startup" to use this feature.',
                                icon: APP_ICON_PATH
                            }).show();
                        }

                        appSettings.startMinimized = false;
                        refreshTrayMenu();
                        return;
                    }

                    appSettings.startMinimized = menuItem.checked;
                    saveAppSettings();
                    applyLoginItemSettings();
                    refreshTrayMenu();
                }
            },
            { type: 'separator' },
            {
                label: 'Quit',
                click: () => {
                    isQuitting = true;
                    app.quit();
                }
            }
        ])
    );
}

function createTray() {
    tray = new Tray(APP_ICON_PATH);
    tray.setToolTip(appName);
    refreshTrayMenu();

    tray.on('double-click', showMainWindow);
    tray.on('click', showMainWindow);
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        title: appName,
        show: false,
        autoHideMenuBar: true,
        icon: APP_ICON_PATH,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: PRELOAD_PATH
        }
    });

    mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
        const allowed = ['notifications', 'media', 'microphone'];
        callback(allowed.includes(permission));
    });

    mainWindow.webContents.session.setPermissionCheckHandler((_wc, permission) => {
        const allowed = ['notifications', 'media', 'microphone'];
        return allowed.includes(permission);
    });

    mainWindow.webContents.setWindowOpenHandler(() => {
        return {
            action: 'allow',
            overrideBrowserWindowOptions: {
                width: 440,
                height: 720,
                autoHideMenuBar: true,
                minimizable: false,
                maximizable: false,
                resizable: false,
                icon: APP_ICON_PATH,
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true
                }
            }
        };
    });

    mainWindow.webContents.once('did-finish-load', () => {
        if (launchMinimizedThisRun) {
            return;
        }

        activateApp();
    });

    mainWindow.webContents.once('did-fail-load', () => {
        if (launchMinimizedThisRun) {
            return;
        }

        activateApp();
    });

    mainWindow.on('page-title-updated', (event) => {
        event.preventDefault();
        mainWindow.setTitle(appName);
    });

    mainWindow.setTitle(appName);
    mainWindow.loadURL(APP_URL);

    mainWindow.on('hide', () => {
        if (audioCheckInterval) return;
        audioNotificationSent = false;
        audioCheckInterval = setInterval(() => {
            if (!mainWindow || mainWindow.isDestroyed()) {
                clearInterval(audioCheckInterval);
                audioCheckInterval = null;
                return;
            }
            if (!audioNotificationSent && mainWindow.webContents.isCurrentlyAudible()) {
                audioNotificationSent = true;
                if (Notification.isSupported()) {
                    const n = new Notification({
                        title: "Audio Info",
                        body: 'Audio is still playing. The app is running in the system tray.',
                    });
                    n.on('click', showMainWindow);
                    n.show();
                }
            }
        }, 2000);
    });

    mainWindow.on('show', () => {
        if (audioCheckInterval) {
            clearInterval(audioCheckInterval);
            audioCheckInterval = null;
        }
        audioNotificationSent = false;
    });

    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });
}

app.setName(appName);
app.setAppUserModelId('com.shapes.desktop');

app.whenReady().then(async () => {
    app.on('before-quit', () => {
        isQuitting = true;
    });
    settingsPath = path.join(app.getPath('userData'), 'settings.json');
    appSettings = loadAppSettings();
    const loginItemSettings = app.getLoginItemSettings();
    const startedAsStartupApp = Boolean(loginItemSettings.wasOpenedAtLogin) || process.argv.includes('--startup-launch');
    launchMinimizedThisRun = startedAsStartupApp && appSettings.startMinimized;
    applyLoginItemSettings();

    const hasInternetConnection = await checkInternetConnection();
    if (!hasInternetConnection) {
        dialog.showMessageBoxSync({
            type: 'error',
            title: 'No Internet Connection',
            message: `You cannot use ${appName} without an active internet connection.`
        });
        app.quit();
        return;
    }

    setupWebNotificationBridge();
    if (!launchMinimizedThisRun) {
        createSplashWindow();
    }

    createWindow();
    createTray();
    checkForUpdates();

    app.on('activate', () => {
        showMainWindow();
    });
});
