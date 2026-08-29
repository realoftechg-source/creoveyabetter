const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');

// Point this at your real, live Render URL before building the installer.
// Using the same hosted site means desktop users log in with the exact
// same account/credentials as the website — there is no separate
// desktop-only backend or account system.
const APP_URL = process.env.CREOVEYA_APP_URL || 'https://creoveya.onrender.com';

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1000,
    minHeight: 640,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      // The app needs real camera/mic access for AI streaming, same as
      // in a browser tab — Electron's permission handler below approves
      // exactly those two, and nothing else, per session.
    },
  });

  mainWindow.loadURL(APP_URL);

  // Camera/mic prompts (needed for the Studio's getUserMedia calls) are
  // auto-approved once, matching what a browser would ask the user
  // anyway — everything else stays default (denied).
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(['media', 'camera', 'microphone'].includes(permission));
  });

  // Any link that isn't the app itself (e.g. Telegram support link,
  // legal pages opened in a new tab) opens in the user's real browser
  // instead of a second Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_URL)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  Menu.setApplicationMenu(null);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
