require('dotenv').config();

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const electron = require('electron');
const launcher = require('minecraft-launcher-core');
const msmc = require('msmc');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');

// Limitar sockets simultÃ¡neos para evitar "too many open files" en descargas masivas
http.globalAgent.maxSockets = 96;
https.globalAgent.maxSockets = 96;
http.globalAgent.keepAlive = true;
https.globalAgent.keepAlive = true;

// Evitar crash por eventos error sin listeners en mclc
try {
  if (launcher?.event && launcher.event.listenerCount('error') === 0) {
    launcher.event.on('error', () => {});
  }
} catch (_) {}

// Evita ejecutar con "node main.js"
if (!electron || !electron.ipcMain) {
  console.error('Esta app debe ejecutarse con Electron (ej: "npx electron ." o "npm start"), no con "node main.js".');
  process.exit(1);
}

const { app, BrowserWindow, ipcMain, shell, screen } = electron;

let mainWindow;
let currentUser = null;
const tokenFile = () => path.join(app.getPath('userData'), 'ms_token.json');
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const banealandManifestUrls = [
  'https://raw.githubusercontent.com/AleeCrack31/banealand/main/manifest.json',
  'https://cdn.jsdelivr.net/gh/AleeCrack31/banealand@main/manifest.json'
];

function clearTokenFiles() {
  const candidates = new Set();
  candidates.add(tokenFile());
  const legacyBase = path.join(app.getPath('appData'), app.getName() || 'mclauncher');
  candidates.add(path.join(legacyBase, 'ms_token.json'));
  candidates.add(path.join(__dirname, 'ms_token.json'));
  for (const p of candidates) {
    try { fs.unlinkSync(p); } catch {}
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.removeMenu();

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.maximize();
  });

  // Redirigir ventanas externas
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Evitar que la app navegue fuera de los HTML locales
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  loadLoginPage();
}

function loadLoginPage() {
  currentUser = null;
  clearTokenFiles();
  mainWindow.loadFile(path.join(__dirname, 'public', 'index.html'));
}

function loadDashboardPage() {
  mainWindow.loadFile(path.join(__dirname, 'public', 'dashboard.html'));
}

const profileDefaults = () => ({
  ramMB: 4000,
  fullscreen: false,
  closeLauncher: false,
  enableVsync: false,
  windowWidth: 854,
  windowHeight: 480,
  keySneak: 'key.keyboard.left.shift',
  keySprint: 'key.keyboard.left.control',
  fov: 90,
  sensitivity: 0.5,
  gamma: 0.5,
  musicVol: 50,
  maxFps: 120,
  renderDistance: 12,
  simulationDistance: 12
});

function normalizeProfile(raw = {}) {
  const base = profileDefaults();
  const s = { ...base, ...raw };
  const clamp = (val, min, max, fallback) => {
    const n = Number(val);
    if (!Number.isFinite(n)) return fallback;
    if (n < min) return min;
    if (n > max) return max;
    return n;
  };

  // Sensibilidad: si viene en porcentaje (>2) la pasamos a escala 0-2
  let sens = Number(s.sensitivity ?? base.sensitivity);
  if (sens > 2) sens = sens / 100;
  s.sensitivity = clamp(sens, 0.1, 2, base.sensitivity);

  s.fov = clamp(s.fov ?? base.fov, 30, 120, base.fov);
  s.gamma = clamp(s.gamma ?? base.gamma, 0, 5, base.gamma);
  s.musicVol = clamp(s.musicVol ?? base.musicVol, 0, 100, base.musicVol);

  const fps = Number(s.maxFps ?? base.maxFps);
  s.maxFps = fps <= 0 ? 0 : clamp(fps, 30, 260, base.maxFps);

  s.renderDistance = clamp(s.renderDistance ?? base.renderDistance, 5, 32, base.renderDistance);
  s.simulationDistance = clamp(s.simulationDistance ?? base.simulationDistance, 5, 32, base.simulationDistance);

  s.windowWidth = clamp(s.windowWidth ?? base.windowWidth, 640, 5120, base.windowWidth);
  s.windowHeight = clamp(s.windowHeight ?? base.windowHeight, 480, 2880, base.windowHeight);
  s.ramMB = clamp(s.ramMB ?? base.ramMB, 1000, 20000, base.ramMB);

  s.fullscreen = !!s.fullscreen;
  s.closeLauncher = !!s.closeLauncher;
  s.enableVsync = !!s.enableVsync;

  return s;
}

function loadSettings() {
  const defaults = { vanilla: profileDefaults(), modpack: profileDefaults() };
  try {
    const raw = fs.readFileSync(settingsFile(), 'utf8');
    const parsed = JSON.parse(raw);
    // Compatibilidad con formato viejo plano
    if (parsed && parsed.ramMB !== undefined) {
      return {
        vanilla: normalizeProfile(parsed),
        modpack: profileDefaults()
      };
    }
    return {
      vanilla: normalizeProfile(parsed?.vanilla || {}),
      modpack: normalizeProfile(parsed?.modpack || {})
    };
  } catch {
    return defaults;
  }
}

function saveSettings(allSettings) {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(allSettings, null, 2), 'utf8');
}

function ensureGameDirs(root = defaultMcRoot) {
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(root), { recursive: true });
}

function sanitizeLog(line) {
  if (!line) return '';
  let s = line.toString();
  // Ocultar accessToken y posibles JWT largos
  s = s.replace(/(--accessToken\s+)[^\s]+/gi, '$1[OCULTO]');
  s = s.replace(/("accessToken"\s*:\s*")[^"]+(")/gi, '$1[OCULTO]$2');
  s = s.replace(/eyJ[A-Za-z0-9_\-.]+/g, '[TOKEN]');
  return s;
}

ipcMain.handle('get-settings', () => loadSettings());
ipcMain.handle('save-settings', async (_event, payload) => {
  const { profile = 'vanilla', values = {} } = payload || {};
  const allSettings = loadSettings();
  const currentProfile = allSettings[profile] || profileDefaults();
  const merged = normalizeProfile({ ...currentProfile, ...values });
  allSettings[profile] = merged;
  saveSettings(allSettings);
  const targetRoot = profile === 'modpack'
    ? path.join(__dirname, 'modpacks', 'banealand', 'minecraft')
    : defaultMcRoot;
  try {
    const snapshot = await applyUserOptions(merged, targetRoot, { reset: profile === 'modpack' });
    return { success: true, path: path.join(targetRoot, 'options.txt'), snapshot };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// Obtener datos usuario
ipcMain.handle('get-user-data', () => currentUser);

ipcMain.handle('check-modpack-update', async () => {
  try {
    const modpackRoot = path.join(__dirname, 'modpacks', 'banealand');
    await fsp.mkdir(modpackRoot, { recursive: true });
    const localManifestPath = path.join(modpackRoot, 'manifest.local.json');
    let localVersion = null;
    try {
      const local = JSON.parse(fs.readFileSync(localManifestPath, 'utf8'));
      localVersion = local.version;
    } catch (_) {}

    let remote = null;
    let lastErr = null;
    for (const url of banealandManifestUrls) {
      try {
        remote = await fetchJson(url);
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (!remote) throw lastErr || new Error('No se pudo obtener el manifest remoto');

    return {
      success: true,
      needsUpdate: remote.version !== localVersion,
      remoteVersion: remote.version || null,
      localVersion
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// Login offline (no premium)
ipcMain.handle('login-offline', async (_event, username) => {
  const name = (username || '').trim();
  if (!name) return { success: false, message: "Ingresa un nombre para jugar offline." };

  clearTokenFiles();
  currentUser = { game_name: name, role: 'Offline' };
  loadDashboardPage();
  return { success: true };
});

// Logout
ipcMain.handle('logout', () => {
  clearTokenFiles();
  currentUser = null;
  loadLoginPage();
  return { success: true };
});

// Carpeta de juego local (mantener en el launcher)
const defaultMcRoot = path.join(__dirname, 'minecraft');

// Lanzar juego (online/offline, versiones y modpack)
ipcMain.handle('launch-game', async (_event, opts = {}) => {
  try {
    const { offlineMode = false, version = '1.20.1', modpack } = opts;
    const hasMs = !!currentUser?.microsoft?.mclcAuth;
    const wantsOffline = !!(offlineMode || !hasMs);
    if (wantsOffline) {
      clearTokenFiles();
      if (currentUser) {
        delete currentUser.microsoft;
        currentUser.role = 'Offline';
      }
    }
    let authorization;
    let versionToUse = version;
    let rootToUse = defaultMcRoot;

    if (modpack === 'banealand') {
      rootToUse = path.join(__dirname, 'modpacks', 'banealand', 'minecraft');
      const modpackRoot = path.join(__dirname, 'modpacks', 'banealand');
      ensureGameDirs(rootToUse);
      versionToUse = '1.12.2-forge-14.23.5.2859';

      // Sincronizar desde manifest remoto
      let manifest = null;
      try {
        manifest = await syncModpackFromManifest(modpackRoot, banealandManifestUrls);
      } catch (err) {
        return { success: false, message: `No se pudo sincronizar el modpack: ${err.message}` };
      }

      // Asegurar vanilla 1.12.2 y sus bibliotecas base
      try {
        await ensureVanillaVersion('1.12.2', rootToUse);
      } catch (err) {
        return { success: false, message: `No se pudo preparar vanilla 1.12.2: ${err.message}` };
      }
// Instalar Forge (genera version json y libs). Si ya estÃ¡ o falla, seguimos intentando lanzar directo.
      const installerPath = path.join(modpackRoot, 'forge-1.12.2-14.23.5.2859-installer.jar');
      const universalPath = path.join(modpackRoot, 'forge-1.12.2-14.23.5.2859.jar');
      try {
        await ensureForgeClient(installerPath, rootToUse);
      } catch (err) {
        mainWindow.webContents.send('launch-log', { line: `Installer Forge fallÃ³ (se intenta igual): ${err.message}` });
      }

      // Reparar manifest por si faltan campos
      const forgeVersionJson = path.join(rootToUse, 'versions', '1.12.2-forge-14.23.5.2859', '1.12.2-forge-14.23.5.2859.json');
      await ensureForgeManifest(forgeVersionJson, universalPath);

      await syncModpackAssets(modpackRoot, rootToUse, manifest);
    }

    if (wantsOffline) {
      const name = currentUser?.game_name || 'OfflinePlayer';
      authorization = launcher.authenticator.getAuth(name);
    } else {
      if (!hasMs) throw new Error("Inicia sesion en Microsoft primero");
      authorization = currentUser.microsoft.mclcAuth;

      // Refuerzo de datos de perfil para versiones viejas (ej. 1.8.9)
      const profileId = (currentUser.microsoft.profile?.id || currentUser.microsoft.profile?.uuid || '').replace(/-/g, '');
      const profileName = currentUser.microsoft.profile?.name || currentUser.game_name || 'Jugador';
      authorization.name = authorization.name || profileName;
      authorization.uuid = authorization.uuid || profileId;
      authorization.selected_profile = authorization.selected_profile || { id: profileId, name: profileName };
      authorization.user_type = authorization.user_type || 'msa';
      if (typeof authorization.user_properties === 'string') {
        try {
          authorization.user_properties = JSON.parse(authorization.user_properties);
        } catch {
          authorization.user_properties = {};
        }
      }
      if (!authorization.user_properties || typeof authorization.user_properties !== 'object') {
        authorization.user_properties = {};
      }
    }

    // Aplicar opciones personalizadas (FOV, sensibilidad, teclas, fullscreen)
    const settingsBundle = loadSettings();
    let userSettings = normalizeProfile(modpack === 'banealand' ? profileDefaults() : settingsBundle.vanilla);
    if (modpack === 'banealand') {
      // Ignorar ajustes visuales del launcher para el modpack, pero permitir RAM personalizada
      const saved = normalizeProfile(settingsBundle.modpack);
      userSettings = normalizeProfile({ ...profileDefaults(), ramMB: saved.ramMB });
      await writeDefaultModpackOptions(rootToUse);
    } else {
      await applyUserOptions(userSettings, rootToUse, { reset: false });
    }
    const baseWidth = Number(userSettings.windowWidth) || 854;
    const baseHeight = Number(userSettings.windowHeight) || 480;

    // Ajustar auth para Forge si faltan datos (modpack banealand)
    if (modpack === 'banealand') {
      if (!authorization?.name) authorization.name = currentUser?.game_name || 'Jugador';
      if (!authorization?.uuid) {
        const pid = (currentUser?.microsoft?.profile?.id || currentUser?.microsoft?.profile?.uuid || '').replace(/-/g, '');
        authorization.uuid = pid || authorization.name || 'offline';
      }
    }

    // Ruta Java preferida (Java 8 solo para banealand, Java 21 para el resto)
  const java8 = path.join('C:\\', 'Program Files', 'Java', 'jre1.8.0_471', 'bin', modpack === 'banealand' ? 'java.exe' : 'javaw.exe');
  const gammaRuntime = path.join(defaultMcRoot, 'runtime', 'java-runtime-gamma', 'windows-x64', 'java-runtime-gamma', 'bin', modpack === 'banealand' ? 'java.exe' : 'javaw.exe');
  const legacyJava = path.join(defaultMcRoot, 'runtime', 'jre-x64', 'bin', modpack === 'banealand' ? 'java.exe' : 'javaw.exe');
  const legacyJavaAlt = path.join(defaultMcRoot, 'runtime', 'jre-legacy', 'windows-x64', modpack === 'banealand' ? 'java.exe' : 'javaw.exe');
  const java21Candidates = [
    path.join('C:\\', 'Program Files', 'Java', 'jdk-21', 'bin', 'javaw.exe'),
    path.join('C:\\', 'Program Files', 'Java', 'jdk-21.0.8', 'bin', 'javaw.exe'),
    path.join('C:\\', 'Program Files', 'Java', 'jdk-21.0.9', 'bin', 'javaw.exe'),
    path.join(process.env.JAVA_HOME || '', 'bin', 'javaw.exe')
  ].filter(Boolean);
  let javaPath = 'java';
  if (modpack === 'banealand') {
    if (fs.existsSync(java8)) javaPath = java8;
    else if (fs.existsSync(legacyJava)) javaPath = legacyJava;
    else if (fs.existsSync(legacyJavaAlt)) javaPath = legacyJavaAlt;
    else if (fs.existsSync(gammaRuntime)) javaPath = gammaRuntime;
  } else {
    const found21 = java21Candidates.find(p => p && fs.existsSync(p));
    if (found21) javaPath = found21;
    else if (fs.existsSync(gammaRuntime)) javaPath = gammaRuntime;
    else if (fs.existsSync(legacyJava)) javaPath = legacyJava;
    else if (fs.existsSync(legacyJavaAlt)) javaPath = legacyJavaAlt;
    else if (fs.existsSync(java8)) javaPath = java8;
  }

    // Lanzar banealand en modo directo (sin mclc) usando el classpath completo
    if (modpack === 'banealand') {
      const modpackRoot = path.join(__dirname, 'modpacks', 'banealand');
      const forgeUniversal = path.join(modpackRoot, 'forge-1.12.2-14.23.5.2859.jar');

      if (!fs.existsSync(forgeUniversal)) {
        const msg = 'Falta forge-1.12.2-14.23.5.2859.jar en modpacks/banealand/';
        mainWindow.webContents.send('launch-status', { type: 'error', message: msg });
        return { success: false, message: msg };
      }

      await syncModpackAssets(modpackRoot, rootToUse);

      mainWindow.webContents.send('launch-status', { type: 'status', message: 'Lanzando Forge 1.12.2 (banealand)...' });
      if (userSettings.closeLauncher) mainWindow.hide();
      await runForgeDirect(rootToUse, javaPath, authorization, userSettings, forgeUniversal);
      mainWindow.webContents.send('launch-status', { type: 'progress', message: 'Minecraft iniciado', progress: 100 });
      return { success: true };
    }

    // Adjuntamos listeners de error para evitar "Unhandled 'error'".
    const events = launcher.event;

    mainWindow.webContents.send('launch-status', { type: 'status', message: `Preparando ${versionToUse}${modpack ? ' (' + modpack + ')' : ''}...` });

    await new Promise((resolve, reject) => {
      let finished = false;

      const onError = (data) => {
        if (finished) return;
        finished = true;
        const msg = Buffer.isBuffer(data) ? data.toString() : (data?.message || String(data));
        reject(new Error(msg));
      };

      const onClose = (code) => {
        if (finished) return;
        finished = true;
        if (code === 0 || code === undefined) resolve();
        else reject(new Error(`Minecraft saliÃ³ con cÃ³digo ${code}`));
      };

      const onData = (data) => {
        if (finished) return;
        const msg = Buffer.isBuffer(data) ? data.toString() : String(data);
        mainWindow.webContents.send('launch-log', { line: sanitizeLog(msg) });
      };

      const onDownload = (info) => {
        if (finished) return;
        let pct = null;
        if (info?.total) pct = Math.floor((info.current / info.total) * 100);
        mainWindow.webContents.send('launch-status', {
          type: 'progress',
          message: info?.task || 'Descargando...',
          progress: pct
        });
      };

      const onDebug = (msg) => {
        if (finished) return;
        const line = Buffer.isBuffer(msg) ? msg.toString() : String(msg);
        mainWindow.webContents.send('launch-log', { line: sanitizeLog(line) });
      };

      const cleanup = () => {
        events.off('error', onError);
        events.off('close', onClose);
        events.off('download-status', onDownload);
        events.off('data', onData);
        events.off('debug', onDebug);
      };

      events.on('error', onError);
      events.on('close', onClose);
      events.on('download-status', onDownload);
      events.on('data', onData);
      events.on('debug', onDebug);

      const versionType = 'release';

      // Evitar que mclc agregue objetos como [object Object] en CLI: asegurar user_properties string
      if (authorization && authorization.user_properties && typeof authorization.user_properties !== 'string') {
        try {
          authorization.user_properties = JSON.stringify(authorization.user_properties);
        } catch {
          authorization.user_properties = "{}";
        }
      }
      if (authorization && !authorization.user_properties) {
        authorization.user_properties = "{}";
      }

      const resolutionOpt = userSettings.fullscreen
        ? undefined
        : { width: baseWidth, height: baseHeight };

      launcher.core({
        authorization,
        root: rootToUse,
        os: process.platform === 'win32' ? 'windows' : process.platform,
        version: { number: versionToUse, type: versionType },
        memory: { max: String(userSettings.ramMB || 4000), min: '1024' },
        javaPath,
        resolution: resolutionOpt,
        forge: undefined
      }).catch(onError).finally(cleanup);

      if (userSettings.closeLauncher) {
        mainWindow.hide();
      }
    });

    // Notificar barra al 100% tras lanzar
    mainWindow.webContents.send('launch-status', { type: 'progress', message: 'Minecraft iniciado', progress: 100 });

    return { success: true };
  } catch (err) {
    mainWindow.webContents.send('launch-status', { type: 'error', message: err.message });
    return { success: false, message: err.message };
  }
});

async function applyUserOptions(settings, root = defaultMcRoot, { reset = false } = {}) {
  const settingsNorm = normalizeProfile(settings);
  const optionsPath = path.join(root, 'options.txt');
  const map = {};
  const toNumString = (n) => {
    const num = Number(n);
    return Number.isFinite(num) ? num.toString() : '0';
  };

  // Valores base que conviene tener presentes si faltan
  const baseDefaults = {
    fullscreen: 'false',
    fov: '87',
    gamma: '0.5',
    fovEffectScale: '1.0',
    particles: '0',
    maxFps: '120',
    autoJump: 'false',
    rawMouseInput: 'true',
    mouseSensitivity: '1.0',
    enableVsync: 'true',
    soundCategory_music: '0.0',
    'key_key.sprint': 'key.keyboard.left.control',
    'key_key.sneak': 'key.keyboard.left.shift'
  };

  if (!reset) {
    try {
      const raw = fs.readFileSync(optionsPath, 'utf8').split(/\r?\n/);
      raw.forEach(line => {
        if (!line.trim()) return;
        const [k, ...rest] = line.split(':');
        if (k) map[k] = rest.join(':');
      });
    } catch {
      // ignore si no existe
    }
  }

  const set = (k, v) => { if (v !== undefined && v !== null) map[k] = v; };

  ensureGameDirs(root);
  fs.mkdirSync(path.dirname(optionsPath), { recursive: true });

  // Completar faltantes con defaults base
  Object.entries(baseDefaults).forEach(([k, v]) => {
    if (map[k] === undefined) map[k] = v;
  });

  // Sobrescribir con lo elegido en el launcher
  const wantsFullscreen = !!settings.fullscreen;
  set('fullscreen', wantsFullscreen ? 'true' : 'false');
  const overrideW = Math.max(0, Math.floor(Number(settingsNorm.windowWidth || 0)));
  const overrideH = Math.max(0, Math.floor(Number(settingsNorm.windowHeight || 0)));
  if (wantsFullscreen) {
    set('overrideWidth', '0');
    set('overrideHeight', '0');
  } else {
    set('overrideWidth', overrideW > 0 ? overrideW.toString() : '854');
    set('overrideHeight', overrideH > 0 ? overrideH.toString() : '480');
  }
  // 1.12.x usa rango similar a 30-110; mantenemos 30-120 para compatibilidad con nuevas versiones
  const fovVal = Math.max(30, Math.min(120, Math.round(Number(settingsNorm.fov ?? 90))));
  set('fov', fovVal.toString());
  const sensVal = Math.max(0.1, Math.min(2, Number(settingsNorm.sensitivity ?? 0.5)));
  set('mouseSensitivity', sensVal.toString());
  const gammaVal = Math.max(0, Math.min(5, Number(settingsNorm.gamma ?? 0.5)));
  set('gamma', gammaVal.toString());
  const musicPct = Math.max(0, Math.min(100, Number(settingsNorm.musicVol ?? 0)));
  set('soundCategory_music', (musicPct / 100).toFixed(2));
  const fpsInput = Number(settingsNorm.maxFps);
  const fpsVal = fpsInput <= 0 ? 0 : Math.max(30, Math.min(260, fpsInput));
  set('maxFps', fpsVal.toString());
  const rd = Math.max(5, Math.min(32, Math.round(Number(settingsNorm.renderDistance ?? 12))));
  set('renderDistance', rd.toString());
  const sd = Math.max(5, Math.min(32, Math.round(Number(settingsNorm.simulationDistance ?? 12))));
  set('simulationDistance', sd.toString());
  set('enableVsync', settingsNorm.enableVsync ? 'true' : 'false');
  // Opciones de teclas (formato de Minecraft options.txt)
  set('key_key.sprint', settingsNorm.keySprint || 'key.keyboard.left.control');
  set('key_key.sneak', settingsNorm.keySneak || 'key.keyboard.left.shift');

  const lines = Object.entries(map).map(([k, v]) => `${k}:${v}`);
  try {
    const content = lines.join('\r\n');
    fs.writeFileSync(optionsPath, content, 'utf8');
    // Releer para confirmar
    const verify = fs.readFileSync(optionsPath, 'utf8');
    return { map, written: optionsPath, verify };
  } catch (err) {
    console.error('No se pudo escribir options.txt', err);
    throw err;
  }
}

async function writeDefaultModpackOptions(root) {
  const optionsPath = path.join(root, 'options.txt');
  await fsp.mkdir(path.dirname(optionsPath), { recursive: true });
  const lines = [
    'version:1343',
    'invertYMouse:false',
    'mouseSensitivity:0.50',
    'fov:0',
    'gamma:0.50',
    'saturation:0.0',
    'renderDistance:12',
    'guiScale:0',
    'particles:0',
    'bobView:true',
    'anaglyph3d:false',
    'maxFps:120',
    'fboEnable:true',
    'difficulty:2',
    'fancyGraphics:true',
    'ao:2',
    'renderClouds:true',
    'resourcePacks:[]',
    'incompatibleResourcePacks:[]',
    'lastServer:',
    'lang:en_us',
    'chatVisibility:0',
    'chatColors:true',
    'chatLinks:true',
    'chatLinksPrompt:true',
    'chatOpacity:1.0',
    'snooperEnabled:true',
    'fullscreen:false',
    'enableVsync:false',
    'useVbo:true',
    'hideServerAddress:false',
    'advancedItemTooltips:false',
    'pauseOnLostFocus:true',
    'touchscreen:false',
    'overrideWidth:0',
    'overrideHeight:0',
    'heldItemTooltips:true',
    'chatHeightFocused:1.0',
    'chatHeightUnfocused:0.4375',
    'chatScale:1.0',
    'chatWidth:1.0',
    'mipmapLevels:4',
    'forceUnicodeFont:false',
    'reducedDebugInfo:false',
    'useNativeTransport:true',
    'entityShadows:true',
    'mainHand:right',
    'attackIndicator:1',
    'showSubtitles:false',
    'realmsNotifications:true',
    'enableWeakAttacks:false',
    'autoJump:false',
    'narrator:0',
    'tutorialStep:none',
    'fovEffectScale:1.0',
    'rawMouseInput:true',
    'soundCategory_master:1.0',
    'soundCategory_music:0.00',
    'soundCategory_record:1.0',
    'soundCategory_weather:1.0',
    'soundCategory_block:1.0',
    'soundCategory_hostile:1.0',
    'soundCategory_neutral:1.0',
    'soundCategory_player:1.0',
    'soundCategory_ambient:1.0',
    'soundCategory_voice:1.0',
    'soundCategory_ui:1.0',
    'modelPart_cape:true',
    'modelPart_jacket:true',
    'modelPart_left_sleeve:true',
    'modelPart_right_sleeve:true',
    'modelPart_left_pants_leg:true',
    'modelPart_right_pants_leg:true',
    'modelPart_hat:true',
    // Key bindings en formato numÃ©rico para 1.12
    'key_key.attack:-100',
    'key_key.use:-99',
    'key_key.forward:17',
    'key_key.left:30',
    'key_key.back:31',
    'key_key.right:32',
    'key_key.jump:57',
    'key_key.sneak:42',
    'key_key.sprint:29',
    'key_key.drop:16',
    'key_key.inventory:18',
    'key_key.chat:20',
    'key_key.playerlist:15',
    'key_key.pickItem:-98',
    'key_key.command:53',
    'key_key.screenshot:60',
    'key_key.togglePerspective:63',
    'key_key.smoothCamera:0',
    'key_key.fullscreen:87',
    'key_key.spectatorOutlines:0',
    'key_key.swapHands:33',
    'key_key.saveToolbarActivator:46',
    'key_key.loadToolbarActivator:45',
    'key_key.advancements:38',
    'key_key.hotbar.1:2',
    'key_key.hotbar.2:3',
    'key_key.hotbar.3:4',
    'key_key.hotbar.4:5',
    'key_key.hotbar.5:6',
    'key_key.hotbar.6:7',
    'key_key.hotbar.7:8',
    'key_key.hotbar.8:9',
    'key_key.hotbar.9:10'
  ];
  fs.writeFileSync(optionsPath, lines.join('\r\n'), 'utf8');
  return { written: optionsPath, count: lines.length };
}

async function syncModpackAssets(modpackRoot, targetRoot = defaultMcRoot, manifest = null) {
  const modsSrc = path.join(modpackRoot, 'mods');
  const cfgSrc = path.join(modpackRoot, 'config');
  const modsDest = path.join(targetRoot, 'mods');
  const cfgDest = path.join(targetRoot, 'config');

  const copyDir = async (src, dest) => {
    try {
      const stat = await fsp.stat(src);
      if (!stat.isDirectory()) return;
      await fsp.mkdir(dest, { recursive: true });
      await fsp.cp(src, dest, { recursive: true, force: true });
      mainWindow.webContents.send('launch-log', { line: `Sincronizado ${path.basename(src)} -> ${dest}` });
    } catch (err) {
      if (err.code !== 'ENOENT') {
        mainWindow.webContents.send('launch-log', { line: `Error copiando ${src}: ${err.message}` });
      }
    }
  };

  await copyDir(modsSrc, modsDest);
  await copyDir(cfgSrc, cfgDest);

  // Limpiar extras no listados en manifest
  const normalizeRel = (p) => p.replace(/^[\\/]+/, '').split(path.sep).join('/');
  let manifestData = manifest;
  if (!manifestData) {
    try {
      const localPath = path.join(modpackRoot, 'manifest.local.json');
      manifestData = JSON.parse(await fsp.readFile(localPath, 'utf8'));
    } catch (_) {
      manifestData = null;
    }
  }

  if (!manifestData) {
    mainWindow.webContents.send('launch-log', { line: 'No se pudo leer manifest para limpiar mods/config extras; se omite limpieza.' });
    return;
  }

  const allowedMods = new Set();
  const allowedCfg = new Set();
  (manifestData.mods || []).forEach((rel) => {
    const trimmed = normalizeRel(String(rel || ''));
    if (!trimmed) return;
    const inside = trimmed.startsWith('mods/') ? trimmed.slice('mods/'.length) : trimmed;
    if (inside) allowedMods.add(normalizeRel(inside));
  });
  (manifestData.config || []).forEach((rel) => {
    const trimmed = normalizeRel(String(rel || ''));
    if (!trimmed) return;
    const inside = trimmed.startsWith('config/') ? trimmed.slice('config/'.length) : trimmed;
    if (inside) allowedCfg.add(normalizeRel(inside));
  });

  const pruneDir = async (dir, allowedSet, label) => {
    if (!allowedSet || allowedSet.size === 0) return;
    try {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await pruneDir(full, allowedSet, label);
          try {
            const left = await fsp.readdir(full);
            if (left.length === 0) await fsp.rmdir(full);
          } catch (_) {}
          continue;
        }
        const rel = normalizeRel(path.relative(dir, full));
        if (!allowedSet.has(rel)) {
          try {
            await fsp.unlink(full);
            mainWindow.webContents.send('launch-log', { line: `Eliminado ${label} extra: ${rel}` });
          } catch (err) {
            mainWindow.webContents.send('launch-log', { line: `No se pudo borrar ${label} ${rel}: ${err.message}` });
          }
        }
      }
    } catch (_) {
      // ignore
    }
  };

  await pruneDir(modsDest, allowedMods, 'mod');
  await pruneDir(cfgDest, allowedCfg, 'config');
}

function collectJars(mcRoot, forgeUniversal) {
  const jars = [];
  const add = (p) => { if (p && fs.existsSync(p)) jars.push(p); };

  add(forgeUniversal);
  add(path.join(mcRoot, 'versions', '1.12.2-forge-14.23.5.2859', '1.12.2-forge-14.23.5.2859.jar'));
  add(path.join(mcRoot, 'versions', '1.12.2', '1.12.2.jar'));

  const walk = (dir) => {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && full.endsWith('.jar')) jars.push(full);
      }
    } catch {
      // ignore
    }
  };

  walk(path.join(mcRoot, 'libraries'));

  const seen = new Set();
  return jars.filter((p) => {
    if (seen.has(p)) return false;
    seen.add(p);
    return true;
  });
}

async function runForgeDirect(mcRoot, javaPath, auth, settings, forgeUniversal) {
  const settingsNorm = normalizeProfile(settings);
  const cpEntries = collectJars(mcRoot, forgeUniversal);
  if (!cpEntries.length) {
    throw new Error('No se pudo armar el classpath para Forge (banealand)');
  }

  const nativesA = path.join(mcRoot, 'natives', '1.12.2-forge-14.23.5.2859');
  const nativesB = path.join(mcRoot, 'natives', '1.12.2');
  const natives = fs.existsSync(nativesA) ? nativesA : nativesB;
  await ensureNatives(mcRoot, natives);

  const playerName = auth?.name || auth?.selected_profile?.name || auth?.profile?.name || 'OfflinePlayer';
  const playerUuid = (auth?.uuid || auth?.selected_profile?.id || auth?.profile?.id || playerName).replace(/-/g, '');
  const token = auth?.access_token || auth?.accessToken || '0';
  const userType = auth?.user_type || auth?.userType || 'msa';

  const width = Number(settingsNorm?.windowWidth) || 854;
  const height = Number(settingsNorm?.windowHeight) || 480;
  const fullscreenFlag = settingsNorm?.fullscreen ? 'true' : 'false';
  const startX = 0; // esquina superior izquierda para evitar offset raro
  const startY = 0;
  const args = [
    `-Xmx${settingsNorm?.ramMB || 4000}M`,
    '-Xms1024M',
    `-Djava.library.path=${natives}`,
    '-cp',
    cpEntries.join(';'),
    'net.minecraft.launchwrapper.Launch',
    '--username', playerName,
    '--version', '1.12.2-forge-14.23.5.2859',
    '--gameDir', mcRoot,
    '--assetsDir', path.join(mcRoot, 'assets'),
    '--assetIndex', '1.12',
    '--uuid', playerUuid,
    '--accessToken', token,
    '--userType', userType,
    '--tweakClass', 'net.minecraftforge.fml.common.launcher.FMLTweaker',
    '--versionType', 'Forge'
  ];

  if (fullscreenFlag === 'true') {
    args.push('--fullscreen', 'true');
  } else {
    // No forzamos ancho/alto para evitar escalados raros; dejamos que MC use su tamaÃ±o por defecto
    // ni pasamos x/y para que el SO decida la posiciÃ³n inicial
  }

  return new Promise((resolve, reject) => {
    const child = spawn(javaPath, args, { cwd: mcRoot });

    child.stdout.on('data', (d) => mainWindow.webContents.send('launch-log', { line: sanitizeLog(d.toString()) }));
    child.stderr.on('data', (d) => mainWindow.webContents.send('launch-log', { line: sanitizeLog(d.toString()) }));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Minecraft cerrÃ³ con cÃ³digo ${code}`));
    });
  });
}

async function ensureForgeClient(installerPath, gameRoot) {
  const forgeVersionJson = path.join(gameRoot, 'versions', '1.12.2-forge-14.23.5.2859', '1.12.2-forge-14.23.5.2859.json');
  if (fs.existsSync(forgeVersionJson)) {
    return;
  }

  await fsp.mkdir(gameRoot, { recursive: true });

  // Elegir Java disponible (preferir Java 8)
  const java8 = path.join('C:\\', 'Program Files', 'Java', 'jre1.8.0_471', 'bin', 'java.exe');
  const legacyJava = path.join(defaultMcRoot, 'runtime', 'jre-x64', 'bin', 'java.exe');
  const legacyJavaAlt = path.join(defaultMcRoot, 'runtime', 'jre-legacy', 'windows-x64', 'java.exe');
  const javaPath = fs.existsSync(java8) ? java8 : (fs.existsSync(legacyJava) ? legacyJava : (fs.existsSync(legacyJavaAlt) ? legacyJavaAlt : 'java'));

  // Crear launcher_profiles.json mÃ­nimo para que el installer no falle
  const profilesPath = path.join(gameRoot, 'launcher_profiles.json');
  if (!fs.existsSync(profilesPath)) {
    const stub = {
      profiles: {
        Default: {
          name: "Default",
          type: "custom",
          lastVersionId: "1.12.2"
        }
      },
      selectedProfile: "Default",
      clientToken: "mclauncher",
      authenticationDatabase: {},
      selectedUser: { account: "offline", uuid: "00000000000000000000000000000000" }
    };
    fs.writeFileSync(profilesPath, JSON.stringify(stub, null, 2), 'utf8');
  }

  return new Promise((resolve, reject) => {
    const args = ['-jar', installerPath, '--installClient'];
    mainWindow.webContents.send('launch-log', { line: `Instalando Forge client en ${gameRoot}...` });
    const child = spawn(javaPath, args, { cwd: gameRoot, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', d => mainWindow.webContents.send('launch-log', { line: d.toString() }));
    child.stderr.on('data', d => mainWindow.webContents.send('launch-log', { line: d.toString() }));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Installer Forge saliÃ³ con cÃ³digo ${code}`));
    });
  });
}

async function ensureForgeManifest(manifestPath, jarPath) {
  try {
    const raw = await fsp.readFile(manifestPath, 'utf8');
    const json = JSON.parse(raw);
    const isForge = manifestPath.includes('1.12.2-forge-14.23.5.2859');

    if (!json.downloads) json.downloads = {};
    if (!json.downloads.client) json.downloads.client = {};

    if (isForge) {
      json.downloads.client.sha1 = json.downloads.client.sha1 || "";
      json.downloads.client.size = json.downloads.client.size || (fs.existsSync(jarPath) ? (await fsp.stat(jarPath)).size : 4466108);
      json.downloads.client.path = "net/minecraftforge/forge/1.12.2-14.23.5.2859/forge-1.12.2-14.23.5.2859.jar";
      json.downloads.client.url = "https://maven.minecraftforge.net/net/minecraftforge/forge/1.12.2-14.23.5.2859/forge-1.12.2-14.23.5.2859.jar";
      json.inheritsFrom = '1.12.2';
      json.assetIndex = json.assetIndex || { id: '1.12', sha1: '', size: 0, totalSize: 0, url: '' };
    } else {
      json.downloads.client.sha1 = json.downloads.client.sha1 || "0f275bc1547d01fa5f56ba34bdc87d981ee12daf";
      json.downloads.client.size = json.downloads.client.size || (fs.existsSync(jarPath) ? (await fsp.stat(jarPath)).size : 10180113);
      json.downloads.client.path = json.downloads.client.path || "versions/1.12.2/1.12.2.jar";
      json.downloads.client.url = json.downloads.client.url || "https://launcher.mojang.com/mc/game/1.12.2/client/0f275bc1547d01fa5f56ba34bdc87d981ee12daf/client.jar";
      json.inheritsFrom = json.inheritsFrom || '1.12.2';
      json.assetIndex = json.assetIndex || { id: '1.12', sha1: '', size: 0, totalSize: 0, url: '' };
    }

    await fsp.writeFile(manifestPath, JSON.stringify(json, null, 2), 'utf8');
  } catch (err) {
    mainWindow.webContents.send('launch-log', { line: `No se pudo reparar manifest Forge: ${err.message}` });
  }
}

async function downloadFile(url, dest) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const getter = url.startsWith('https') ? https : http;
    const req = getter.get(url, (res) => {
      if (res.statusCode !== 200) {
        file.close(() => fs.unlink(dest, () => {}));
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    });
    req.on('error', (err) => {
      file.close(() => fs.unlink(dest, () => {}));
      reject(err);
    });
  });
}

async function downloadWithFallback(urls, dest) {
  let lastError = null;
  for (const url of urls) {
    try {
      await downloadFile(url, dest);
      return;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('No se pudo descargar archivo');
}

async function loadCachedMicrosoft(auth) {
  try {
    const raw = fs.readFileSync(tokenFile(), 'utf8');
    const parsed = JSON.parse(raw);
    const mc = await msmc.tokenUtils.fromMclcToken(auth, parsed, true);
    return mc;
  } catch {
    return null;
  }
}

// Construye una URL segura para rutas con espacios/caracteres especiales
function buildRemoteUrl(base, relativePath) {
  const safe = relativePath.split('/').map(encodeURIComponent).join('/');
  return base.endsWith('/') ? `${base}${safe}` : `${base}/${safe}`;
}

async function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const getter = url.startsWith('https') ? https : http;
    getter.get(url, res => {
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let data = '';
      res.on('data', d => { data += d.toString(); });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (err) { reject(err); }
      });
    }).on('error', reject);
  });
}

function isLibraryAllowed(lib) {
  if (!lib?.rules || !Array.isArray(lib.rules) || lib.rules.length === 0) return true;
  const osName = process.platform === 'win32' ? 'windows' : process.platform;
  let allowed = false;
  for (const rule of lib.rules) {
    let matches = true;
    if (rule.os?.name && rule.os.name !== osName) matches = false;
    if (rule.os?.arch && !process.arch.startsWith(rule.os.arch)) matches = false;
    if (matches) allowed = rule.action !== 'disallow';
  }
  return allowed;
}

async function ensureLibrariesFromManifest(manifest, gameRoot) {
  const libs = manifest?.libraries || [];
  const base = path.join(gameRoot, 'libraries');

  for (const lib of libs) {
    if (!isLibraryAllowed(lib)) continue;
    const downloads = lib.downloads || {};

    const downloadEntry = async (entry) => {
      if (!entry?.url || !entry?.path) return;
      const dest = path.join(base, entry.path);
      if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return;
      await downloadFile(entry.url, dest);
    };

    if (downloads.artifact) {
      await downloadEntry(downloads.artifact);
    }

    const classifiers = downloads.classifiers || {};
    const nativeWin = classifiers['natives-windows'] || classifiers['natives-windows-64'] || classifiers['natives-windows-x86'];
    if (nativeWin) {
      await downloadEntry(nativeWin);
    }
  }
}

async function ensureVanillaVersion(versionId, gameRoot = defaultMcRoot) {
  const versionDir = path.join(gameRoot, 'versions', versionId);
  const versionJsonPath = path.join(versionDir, `${versionId}.json`);
  await fsp.mkdir(versionDir, { recursive: true });

  let manifest = null;

  try {
    const raw = await fsp.readFile(versionJsonPath, 'utf8');
    manifest = JSON.parse(raw);
  } catch {
    // descargar manifest oficial
    const meta = await fetchJson('https://launchermeta.mojang.com/mc/game/version_manifest.json');
    const entry = meta?.versions?.find(v => v.id === versionId);
    if (!entry?.url) throw new Error('No se encontró manifest de la versión vanilla');
    manifest = await fetchJson(entry.url);
    await fsp.writeFile(versionJsonPath, JSON.stringify(manifest, null, 2), 'utf8');
  }

  const jarUrl = manifest?.downloads?.client?.url;
  if (!jarUrl) throw new Error('Manifest vanilla no tiene URL de jar');

  const jarPath = path.join(versionDir, `${versionId}.jar`);
  if (!fs.existsSync(jarPath) || fs.statSync(jarPath).size === 0) {
    await downloadFile(jarUrl, jarPath);
  }

  await ensureLibrariesFromManifest(manifest, gameRoot);
}

// Sincroniza los archivos del modpack desde un manifest remoto
async function syncModpackFromManifest(modpackRoot, manifestUrlOrList) {
  await fsp.mkdir(modpackRoot, { recursive: true });

  const localManifestPath = path.join(modpackRoot, 'manifest.local.json');
  const manifestUrls = Array.isArray(manifestUrlOrList) ? manifestUrlOrList : [manifestUrlOrList];

  let remote = null;
  let manifestBase = null;
  let lastErr = null;

  for (const url of manifestUrls) {
    try {
      mainWindow.webContents.send('launch-status', { type: 'status', message: `Obteniendo manifest del modpack... (${url})` });
      remote = await fetchJson(url);
      manifestBase = url.slice(0, url.lastIndexOf('/') + 1);
      break;
    } catch (err) {
      lastErr = err;
    }
  }

  if (!remote) {
    throw new Error(`No se pudo descargar manifest del modpack (${lastErr?.message || 'error desconocido'})`);
  }

  let localVersion = null;
  try {
    const local = JSON.parse(fs.readFileSync(localManifestPath, 'utf8'));
    localVersion = local.version;
  } catch (_) {}

  const needsUpdate = remote.version !== localVersion;
  const files = [];

  if (remote.forge) {
    if (remote.forge.installer) files.push(remote.forge.installer);
    if (remote.forge.universal) files.push(remote.forge.universal);
    if (remote.forge.vanillaJar) files.push(remote.forge.vanillaJar);
  }
  (remote.mods || []).forEach(f => files.push(f));
  (remote.config || []).forEach(f => files.push(f));

  for (const rel of files) {
    const dest = path.join(modpackRoot, rel);
    if (!needsUpdate && fs.existsSync(dest)) continue;
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const url = buildRemoteUrl(manifestBase, rel);
    mainWindow.webContents.send('launch-status', { type: 'status', message: `Descargando ${rel}...` });
    try {
      await downloadFile(url, dest);
    } catch (err) {
      throw new Error(`No se pudo descargar ${rel} (${url}): ${err.message || err}`);
    }
  }

  // Guardar manifest local
  await fsp.writeFile(localManifestPath, JSON.stringify(remote, null, 2), 'utf8');
  mainWindow.webContents.send('launch-status', { type: 'status', message: `Modpack sincronizado (versiИn ${remote.version})` });
  return remote;
}

async function ensureNatives(mcRoot, nativesPath) {
  try {
    const hasDll = fs.readdirSync(nativesPath).some(f => f.toLowerCase().endsWith('.dll'));
    if (hasDll) return;
  } catch {
    // seguimos y creamos la carpeta
  }

  await fsp.mkdir(nativesPath, { recursive: true });

  const candidates = [
    {
      path: path.join(mcRoot, 'libraries', 'org', 'lwjgl', 'lwjgl', 'lwjgl-platform', '2.9.4-nightly-20150209', 'lwjgl-platform-2.9.4-nightly-20150209-natives-windows.jar'),
      url: 'https://libraries.minecraft.net/org/lwjgl/lwjgl/lwjgl-platform/2.9.4-nightly-20150209/lwjgl-platform-2.9.4-nightly-20150209-natives-windows.jar'
    },
    {
      path: path.join(mcRoot, 'libraries', 'org', 'lwjgl', 'lwjgl', 'lwjgl-platform', '2.9.2-nightly-20140822', 'lwjgl-platform-2.9.2-nightly-20140822-natives-windows.jar'),
      url: 'https://libraries.minecraft.net/org/lwjgl/lwjgl/lwjgl-platform/2.9.2-nightly-20140822/lwjgl-platform-2.9.2-nightly-20140822-natives-windows.jar'
    },
  ];

  let jarPath = null;
  for (const candidate of candidates) {
    const dir = path.dirname(candidate.path);
    await fsp.mkdir(dir, { recursive: true }).catch(() => {});
    const ok = fs.existsSync(candidate.path) && fs.statSync(candidate.path).size > 1000;
    if (!ok) {
      try {
        await downloadFile(candidate.url, candidate.path);
      } catch (_) {
        // probar siguiente
      }
    }
    if (fs.existsSync(candidate.path) && fs.statSync(candidate.path).size > 1000) {
      jarPath = candidate.path;
      break;
    }
  }

  if (!jarPath) {
    mainWindow.webContents.send('launch-log', { line: 'No se encontrÃ³ el jar de natives LWJGL para extraer.' });
    return;
  }

  mainWindow.webContents.send('launch-status', { type: 'status', message: 'Extrayendo natives LWJGL...' });

  const runExtractor = (cmd, args, label) => new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'ignore' });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`${label} terminÃ³ con cÃ³digo ${code}`)));
  });

  const extractors = [
    {
      label: 'tar',
      run: () => runExtractor('tar', ['-xf', jarPath, '-C', nativesPath], 'tar'),
    },
    {
      label: 'Expand-Archive',
      run: () => runExtractor('powershell', ['-Command', `Expand-Archive -Force "${jarPath}" "${nativesPath}"`], 'Expand-Archive'),
    },
    {
      label: 'ZipFile ExtractToDirectory',
      run: () => {
        const script = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory("${jarPath}", "${nativesPath}", $true);`;
        return runExtractor('powershell', ['-Command', script], 'ZipFile ExtractToDirectory');
      },
    },
  ];

  let extracted = false;
  for (const extractor of extractors) {
    try {
      await extractor.run();
      extracted = true;
      break;
    } catch (err) {
      mainWindow.webContents.send('launch-log', { line: `${extractor.label} fallÃ³: ${err.message}` });
    }
  }

  if (!extracted) {
    throw new Error('No se pudieron extraer las natives LWJGL.');
  }
}

function saveMicrosoftToken(mclcAuth) {
  try {
    fs.mkdirSync(path.dirname(tokenFile()), { recursive: true });
    fs.writeFileSync(tokenFile(), JSON.stringify(mclcAuth, null, 2), 'utf8');
  } catch (err) {
    console.warn("No se pudo guardar el token Microsoft:", err.message);
  }
}

// Login con Microsoft usando MSMC (ventana integrada en Electron)
ipcMain.handle('microsoft-login', async () => {
  const auth = new msmc.Auth('select_account');

  try {
    // Reutilizar token si existe
    const cached = await loadCachedMicrosoft(auth);
    if (cached) {
      const mclcAuth = cached.mclc(true);
      currentUser = {
        game_name: cached.profile.name,
        microsoft: { profile: cached.profile, mclcAuth }
      };
      loadDashboardPage();
      return { success: true, cached: true };
    }

    const xbox = await auth.launch("electron", {
      width: 500,
      height: 650,
      resizable: false,
      title: "Inicia sesion en Microsoft"
    });

    const mc = await xbox.getMinecraft();
    const mclcAuth = mc.mclc(true);
    saveMicrosoftToken(mclcAuth);

    currentUser = {
      game_name: mc.profile.name,
      microsoft: { profile: mc.profile, mclcAuth }
    };

    loadDashboardPage();
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

app.whenReady().then(createWindow);

app.disableHardwareAcceleration();
app.setPath('userData', path.join(app.getPath('home'), 'ALELauncherData'));

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

