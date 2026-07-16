const { app, BrowserWindow, ipcMain, globalShortcut, screen, session, desktopCapturer, shell, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const os = require('os');
const store = require('./src/store');
const { captureScreenshot } = require('./src/screen');
const { createSTT } = require('./src/stt');
const { createLLM } = require('./src/llm');
const { MODES, ROLES } = require('./src/prompts');
const { rms16 } = require('./src/wav');

let win = null;
let tray = null;

// The OS-level window title. Note (honesty constraint): setContentProtection hides
// Socrates from screen-capture APIs, but the window handle stays fully enumerable — an
// EnumWindows sweep or proctoring agent reads this string instantly. We title it honestly
// rather than shipping a disguise; Socrates is a study tool, not an evasion tool. A user
// who wants a lower profile can change this one constant.
const WINDOW_TITLE = 'Socrates';

// Set SOCRATES_NO_PROTECT=1 to make the window visible to screen recorders while
// debugging. (CUE_NO_PROTECT still honored for anyone with the old muscle memory.)
const NO_PROTECT = !!(process.env.SOCRATES_NO_PROTECT || process.env.CUE_NO_PROTECT);

// -------- capture / transcript state --------
const state = { capturing: false, busy: false, transcribing: { you: false, them: false } };
let sttDisabled = false; // set when the key can't reach any speech model (stops retry spam)
const buffers = { you: [], them: [] };
const transcript = []; // { channel, text, ts }
const TRANSCRIPT_CAP = 600; // keep long sessions from growing the array without bound
const FLUSH_MS = 3500;
const MIN_BYTES = Math.floor(16000 * 2 * 0.6); // ~0.6s
const RMS_GATE = 240;
let flushTimer = null;

function send(channel, data) { if (win && !win.isDestroyed()) win.webContents.send(channel, data); }

// -------- window --------
function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const W = 700, H = 600;
  win = new BrowserWindow({
    width: W,
    height: H,
    x: Math.round(workArea.x + (workArea.width - W) / 2),
    y: workArea.y + 6,
    title: WINDOW_TITLE,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // Invisibility + overlay behavior. On Windows 10 2004+ setContentProtection becomes
  // SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE) and excludes the window from screen
  // capture. Set SOCRATES_NO_PROTECT=1 to disable for debugging.
  win.setContentProtection(!NO_PROTECT);
  win.setAlwaysOnTop(true, 'screen-saver', 1);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (typeof win.setHiddenInMissionControl === 'function') win.setHiddenInMissionControl(true);

  // Keep the OS window title fixed; the page's <title> would otherwise overwrite it.
  win.on('page-title-updated', (e) => { e.preventDefault(); win.setTitle(WINDOW_TITLE); });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.webContents.on('did-finish-load', () => { win.showInactive(); warnIfProtectionFallback(); });
  win.webContents.on('render-process-gone', (_e, d) => console.log('[socrates] renderer gone', JSON.stringify(d)));
}

// On Windows builds older than 10 version 2004 (build 19041), WDA_EXCLUDEFROMCAPTURE is
// unavailable and content protection falls back to WDA_MONITOR — which paints the window
// as a black rectangle to capturers. A visible black box is a worse failure than no
// protection, so warn deliberately rather than let it surprise the user.
let warnedFallback = false;
function warnIfProtectionFallback() {
  if (process.platform !== 'win32' || NO_PROTECT || warnedFallback) return;
  const build = parseInt((os.release().split('.')[2] || '0'), 10);
  if (build && build < 19041) {
    warnedFallback = true;
    console.log('[socrates] Windows build', build, '< 19041: capture protection falls back to a black box.');
    send('status', { message: 'Heads up: this Windows build is older than version 2004, so the hide-from-capture flag renders Socrates as a black box in shares instead of hiding it. Update Windows, or run with SOCRATES_NO_PROTECT=1.' });
  }
}

// -------- tray (the only handle once the overlay is hidden) --------
function trayImage() {
  const p = path.join(__dirname, 'build', 'tray.png');
  const img = nativeImage.createFromPath(p);
  if (!img.isEmpty()) return img;
  // Fallback so the tray is never invisible if the asset is missing: a 16px dot.
  const png = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAT0lEQVR4nGNgGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFIyCUTAKRsEoGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFAAAG4wAlQ2m2W0AAAAASUVORK5CYII=';
  return nativeImage.createFromBuffer(Buffer.from(png, 'base64'));
}

function setOverlayVisible(visible) {
  if (visible) {
    if (!win || win.isDestroyed()) createWindow();
    else { win.showInactive(); win.setAlwaysOnTop(true, 'screen-saver', 1); }
  } else if (win && !win.isDestroyed()) {
    win.hide();
  }
  rebuildTrayMenu();
}

function rebuildTrayMenu() {
  if (!tray) return;
  const shown = win && !win.isDestroyed() && win.isVisible();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: shown ? 'Hide overlay' : 'Show overlay', click: () => setOverlayVisible(!shown) },
    { type: 'separator' },
    { label: 'Quit Socrates', click: () => app.quit() }
  ]));
}

function createTray() {
  tray = new Tray(trayImage());
  tray.setToolTip('Socrates');
  tray.on('click', () => setOverlayVisible(!(win && win.isVisible())));
  rebuildTrayMenu();
}

// -------- STT flushing --------
async function flushChannel(channel) {
  if (state.transcribing[channel]) return;
  const chunks = buffers[channel];
  if (!chunks.length) return;
  const pcm = Buffer.concat(chunks);
  buffers[channel] = [];
  if (pcm.length < MIN_BYTES) return;
  if (rms16(pcm) < RMS_GATE) return; // silence gate

  state.transcribing[channel] = true;
  try {
    const settings = store.getSettings();
    const stt = createSTT(settings);
    if (!stt.available) {
      if (!sttDisabled) { sttDisabled = true; send('status', { message: 'No transcription key set. Add an OpenAI (Whisper) or Gemini key in Settings to enable listening. Screen features work without it.' }); }
      return;
    }
    const res = await stt.transcribe(pcm);
    if (res.error) {
      handleSttError(res.error, settings);
      return;
    }
    if (res.text && res.text.trim()) {
      const turn = { channel, text: res.text.trim(), ts: Date.now() };
      transcript.push(turn);
      if (transcript.length > TRANSCRIPT_CAP) transcript.splice(0, transcript.length - TRANSCRIPT_CAP);
      send('transcript', turn);
    }
  } catch (e) {
    console.log('[stt] error', e && e.message);
  } finally {
    state.transcribing[channel] = false;
  }
}

function handleSttError(err, settings) {
  console.log('[stt] error', err.provider, err.status, err.code, err.message);
  if (sttDisabled) return;
  const noAccess = err.status === 403 || err.status === 401 || err.code === 'model_not_found';
  sttDisabled = true; // stop hammering the API every few seconds
  if (noAccess) {
    send('status', { message: 'Transcription off: your ' + err.provider + ' key has no access to a speech-to-text model (403). Screen features still work. To enable listening: give the key Whisper/transcription access, or add a Gemini key in Settings and reopen.' });
  } else {
    send('status', { message: 'Transcription error (' + err.provider + '): ' + err.message });
  }
}

function startFlushLoop() {
  if (flushTimer) return;
  flushTimer = setInterval(() => { flushChannel('you'); flushChannel('them'); }, FLUSH_MS);
}
function stopFlushLoop() { if (flushTimer) { clearInterval(flushTimer); flushTimer = null; } }

// -------- capture toggle --------
// Mic + system audio are both captured in the RENDERER (getUserMedia for the mic,
// getDisplayMedia loopback for system audio) so they run inside Socrates' own process
// and use Socrates' own capture grant — no separate helper binary to authorize.
function setCapturing(active) {
  state.capturing = active;
  if (active) {
    startFlushLoop();
  } else {
    stopFlushLoop();
    buffers.you = []; buffers.them = [];
  }
  send('capture:state', { active });
  return active;
}

// -------- feature runner --------
function currentRole(settings) { return ROLES.includes(settings.role) ? settings.role : 'learning'; }

async function runFeature(mode, userText) {
  const def = MODES[mode];
  if (!def) return;
  if (state.busy) { send('status', { message: 'One moment — still finishing the last request.' }); return; }
  state.busy = true;
  try {
    const settings = store.getSettings();
    const role = currentRole(settings);
    const rdef = def[role];
    if (!rdef) return;
    const llm = createLLM(settings);
    const userBubble = rdef.userBubble !== null ? rdef.userBubble : (mode === 'ask' ? userText : null);
    send('llm:start', { userBubble, small: !!def.small });

    if (!llm.ready) {
      send('llm:error', { message: 'Add your ' + settings.provider + ' API key in Settings (gear icon) to start. Model: ' + (llm.model || 'unset') + '.' });
      return;
    }

    let imageDataUrl = null;
    if (def.needsScreen) {
      try { imageDataUrl = await captureScreenshot(); }
      catch (e) { send('status', { message: 'Screen capture failed — ' + (e && e.message ? e.message : 'no screen source available') + '.' }); }
    }

    const built = rdef.build({ transcript, userText: userText || '', role });
    await llm.stream({
      system: rdef.system,
      turns: [{ role: 'user', text: built }],
      imageDataUrl,
      onToken: (t) => send('llm:token', { text: t })
    });
    send('llm:done', {});
  } catch (e) {
    send('llm:error', { message: 'Error: ' + (e && e.message ? e.message : String(e)) });
  } finally {
    state.busy = false;
  }
}

// -------- IPC --------
ipcMain.handle('settings:get', () => store.getSettings());
ipcMain.handle('settings:set', (_e, patch) => { sttDisabled = false; return store.setSettings(patch); });
ipcMain.handle('capture:toggle', () => setCapturing(!state.capturing));
ipcMain.handle('capture:state', () => ({ active: state.capturing }));
ipcMain.on('ask', (_e, payload) => runFeature(payload.mode, payload.text));
ipcMain.on('mic:pcm', (_e, arrayBuffer) => { if (state.capturing) buffers.you.push(Buffer.from(arrayBuffer)); });
ipcMain.on('system:pcm', (_e, arrayBuffer) => { if (state.capturing) buffers.them.push(Buffer.from(arrayBuffer)); });
ipcMain.on('mouse:ignore', (_e, v) => { if (win) win.setIgnoreMouseEvents(!!v, { forward: true }); });
ipcMain.on('open-pane', (_e, url) => { shell.openExternal(url).catch(() => {}); });
ipcMain.on('log', (_e, msg) => console.log('[renderer]', msg));

// -------- shortcuts --------
function registerShortcuts() {
  globalShortcut.register('CommandOrControl+Return', () => runFeature('explain', ''));
  globalShortcut.register('CommandOrControl+H', () => runFeature('hint', ''));
  globalShortcut.register('CommandOrControl+Shift+X', () => app.quit());
}

// -------- lifecycle --------
app.whenReady().then(() => {
  if (app.dock) app.dock.hide(); // no-op on Windows; harmless

  const allowMedia = (permission) => permission === 'media' || permission === 'microphone' || permission === 'audioCapture' || permission === 'display-capture';
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowMedia(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowMedia(permission));

  // System-audio loopback for getDisplayMedia: hand back a screen source with 'loopback'
  // audio (WASAPI loopback on Windows) so the renderer can capture what's playing using
  // Socrates' own grant, with no system picker.
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      if (sources.length) callback({ video: sources[0], audio: 'loopback' });
      else callback();
    }).catch(() => callback());
  }, { useSystemPicker: false });

  createWindow(); // warnIfProtectionFallback fires from did-finish-load, once the renderer can receive it
  createTray();
  registerShortcuts();

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('will-quit', () => { globalShortcut.unregisterAll(); });
// The overlay hides via the tray, not by closing; only quit when the user asks (tray /
// Cmd+Shift+X). Keep the process alive if all windows happen to close.
app.on('window-all-closed', () => { /* stay resident; quit is explicit via tray */ });
