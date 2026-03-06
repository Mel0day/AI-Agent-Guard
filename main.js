'use strict';

const { app, Tray, Menu, BrowserWindow, Notification, dialog, nativeImage, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const zlib = require('zlib');
const { getLang } = require('./renderer/i18n-main.js');

// ─── 常量 ──────────────────────────────────────────────────────────────────────

const APP_PORT = 47821;
const CONFIG_FILE = path.join(os.homedir(), '.aisec', 'config.json');
const CLAUDE_SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');

// ─── PNG 生成（盾牌托盘图标）──────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const tb = Buffer.from(type, 'ascii');
  const lb = Buffer.alloc(4); lb.writeUInt32BE(data.length);
  const cb = Buffer.alloc(4); cb.writeUInt32BE(crc32(Buffer.concat([tb, data])));
  return Buffer.concat([lb, tb, data, cb]);
}

function makeShieldPNG(scale = 1) {
  // 18×18 base shield: outlined style for clear menu bar recognition
  const rowDefs = [
    [3, 14], [1, 16], [0, 17], [0, 17], [0, 17],
    [0, 17], [0, 17], [0, 17], [0, 17], [1, 16],
    [2, 15], [3, 14], [4, 13], [5, 12], [6, 11],
    [7, 10], [8, 9],
  ];
  const T = 2; // outline thickness in base pixels
  const W = 18 * scale, H = 18 * scale;
  const pixels = Buffer.alloc(W * H * 4, 0);

  function setPixel(bx, by) {
    for (let dy = 0; dy < scale; dy++)
      for (let dx = 0; dx < scale; dx++) {
        const off = ((by * scale + dy) * W + bx * scale + dx) * 4;
        pixels[off + 3] = 255;
      }
  }

  for (let row = 0; row < rowDefs.length; row++) {
    const [sc, ec] = rowDefs[row];
    const w = ec - sc + 1;
    // Top arch rows: fill completely to form the curved crown
    if (row < T) {
      for (let col = sc; col <= ec; col++) setPixel(col, row);
      continue;
    }
    // Rows too narrow to hollow (≤ 2*T+2): fill completely (forms the point)
    if (w <= T * 2 + 2) {
      for (let col = sc; col <= ec; col++) setPixel(col, row);
      continue;
    }
    // All other rows: draw left and right border only (hollow interior)
    for (let i = 0; i < T; i++) {
      setPixel(sc + i, row);
      setPixel(ec - i, row);
    }
  }

  const rows = [];
  for (let y = 0; y < H; y++) {
    const sl = Buffer.alloc(1 + W * 4);
    sl[0] = 0; // filter: None
    pixels.copy(sl, 1, y * W * 4, (y + 1) * W * 4);
    rows.push(sl);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6; // RGBA

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(Buffer.concat(rows), { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ─── 状态 ──────────────────────────────────────────────────────────────────────

let tray = null;
let settingsWindow = null;
let isPaused = false;
let lang = null;
let protectedTools = [];
let recentEvents = [];
let todayBlockedCount = 0;
let todayDate = new Date().toDateString();

function T() { return getLang(lang || 'zh'); }

// ─── 应用生命周期 ───────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  app.dock.hide();
  loadConfig();
  createTray();
  startAuditServer();

  const tools = detectProtectedTools();
  if (tools.length > 0 && protectedTools.length === 0) {
    protectedTools = tools;
    saveConfig();
    setTimeout(() => showWelcomeNotification(), 1500);
  }
  updateTrayMenu();

  if (!lang) setTimeout(openSettings, 500);

  // 每分钟检测跨天，自动重置计数
  setInterval(() => {
    if (new Date().toDateString() !== todayDate) {
      todayBlockedCount = 0;
      todayDate = new Date().toDateString();
      saveConfig();
      updateTrayMenu();
      pushStateUpdate();
    }
  }, 60000);
});

app.on('window-all-closed', (e) => e.preventDefault());

// ─── 配置持久化 ────────────────────────────────────────────────────────────────

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const cfg = JSON.parse(raw);
    isPaused = cfg.isPaused ?? false;
    lang = cfg.lang ?? null;
    protectedTools = cfg.protectedTools ?? [];
    todayDate = cfg.todayDate ?? new Date().toDateString();
    todayBlockedCount = cfg.todayDate === new Date().toDateString()
      ? (cfg.todayBlockedCount ?? 0) : 0;
    recentEvents = cfg.recentEvents ?? [];
  } catch {
    // 首次启动，使用默认值
  }
}

function saveConfig() {
  try {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({
      isPaused, lang, protectedTools,
      todayBlockedCount, todayDate: new Date().toDateString(),
      recentEvents: recentEvents.slice(0, 20),
    }, null, 2));
  } catch (e) {
    console.error('saveConfig error:', e.message);
  }
}

// ─── 菜单栏托盘 ────────────────────────────────────────────────────────────────

function createTray() {
  const png1x = makeShieldPNG(1);
  const png2x = makeShieldPNG(2);
  const img = nativeImage.createEmpty();
  img.addRepresentation({ scaleFactor: 1.0, buffer: png1x });
  img.addRepresentation({ scaleFactor: 2.0, buffer: png2x });
  img.setTemplateImage(true);
  tray = new Tray(img);
  if (isPaused) tray.setTitle('⏸');
  tray.setToolTip(T().appName);
}

function updateTrayMenu() {
  const t = T();
  const statusLine = isPaused
    ? t.trayStatusPaused
    : todayBlockedCount > 0
      ? t.trayStatusBlocked(todayBlockedCount)
      : t.trayStatusSafe;

  const recentItems = recentEvents.slice(0, 3).map(e => ({
    label: `  ${e.icon}  ${truncate(e.summary, 26)}`,
    enabled: false,
  }));

  const template = [
    { label: statusLine, enabled: false },
    { type: 'separator' },
    ...(recentItems.length > 0 ? recentItems : []),
    { type: 'separator' },
    { label: isPaused ? t.trayToggleOn : t.trayToggleOff, click: togglePause },
    { label: t.trayOpenSettings, click: openSettings },
    { type: 'separator' },
    { label: t.trayQuit, click: () => app.quit() },
  ];

  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function togglePause() {
  isPaused = !isPaused;
  tray.setTitle(isPaused ? '⏸' : '');
  saveConfig();
  updateTrayMenu();
  pushStateUpdate();
}

// ─── 设置窗口 ──────────────────────────────────────────────────────────────────

function openSettings() {
  if (settingsWindow) { settingsWindow.focus(); return; }

  settingsWindow = new BrowserWindow({
    width: 460,
    height: 600,
    resizable: false,
    title: T().appName,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  settingsWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

function pushStateUpdate() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('state-updated');
  }
}

// ─── HTTP 审计服务器 ────────────────────────────────────────────────────────────

function startAuditServer() {
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST') { res.writeHead(405); res.end('{}'); return; }
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      let event;
      try { event = JSON.parse(Buffer.concat(chunks).toString()); }
      catch { res.writeHead(400); res.end('{}'); return; }
      try {
        const result = await handleAuditEvent(event);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        console.error('handleAuditEvent error:', err);
        res.writeHead(500); res.end(JSON.stringify({ allow: true }));
      }
    });
    req.on('error', () => res.end('{}'));
  });

  server.listen(APP_PORT, '127.0.0.1', () => {
    console.log(`AI 守卫已就绪，监听端口 ${APP_PORT}`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE')
      console.error(`端口 ${APP_PORT} 已被占用，可能已有一个 AI 守卫在运行`);
  });
}

async function handleAuditEvent(event) {
  const { risk, aiDecision, explanation, reason, toolName, params } = event;

  if (isPaused) return { allow: true };

  const t = T();
  const displayReason = explanation || reason || (lang === 'en' ? 'AI attempted an action' : 'AI 想执行一个操作');
  const icon = (risk === 'CRITICAL' || aiDecision === 'BLOCK') ? '🚨' : aiDecision === 'WARN' ? '⚠️' : '💡';

  addRecentEvent({ icon, summary: displayReason, risk, aiDecision, toolName, toolInput: params });

  if (risk === 'CRITICAL' || aiDecision === 'BLOCK') {
    todayBlockedCount++;
    saveConfig();
    updateTrayMenu();
    showBlockedNotification(displayReason);
    pushStateUpdate();
    return { allow: false };
  }

  if (aiDecision === 'WARN') {
    const allowed = await showConfirmDialog(displayReason);
    if (!allowed) todayBlockedCount++;
    saveConfig();
    updateTrayMenu();
    pushStateUpdate();
    return { allow: allowed };
  }

  updateTrayMenu();
  pushStateUpdate();
  return { allow: true };
}

// ─── 通知与弹窗 ────────────────────────────────────────────────────────────────

function showWelcomeNotification() {
  if (!Notification.isSupported()) return;
  const t = T();
  new Notification({ title: t.notifWelcomeTitle, body: t.notifWelcomeBody, silent: true }).show();
}

function showBlockedNotification(reason) {
  if (!Notification.isSupported()) return;
  const t = T();
  new Notification({ title: t.notifBlockedTitle, body: t.notifBlockedBody(reason) }).show();
}

async function showConfirmDialog(reason) {
  const t = T();
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: t.dialogTitle,
    message: t.dialogMessage(reason),
    detail: t.dialogDetail,
    buttons: [t.dialogBtnReject, t.dialogBtnAllow],
    defaultId: 0, cancelId: 0,
  });
  return response === 1;
}

// ─── 工具检测 ──────────────────────────────────────────────────────────────────

function detectProtectedTools() {
  const tools = [];
  if (fs.existsSync(CLAUDE_SETTINGS)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8'));
      const hooks = cfg.hooks?.PreToolUse ?? [];
      const hasAuditor = hooks.some(h => h.hooks?.some(hh => hh.command?.includes('ai-auditor')));
      if (hasAuditor) tools.push('Claude Code');
    } catch {}
  }
  return tools;
}

// ─── IPC 接口 ──────────────────────────────────────────────────────────────────

ipcMain.handle('get-state', () => ({
  isPaused, lang, protectedTools, todayBlockedCount,
  recentEvents: recentEvents.slice(0, 10).map(e => ({
    icon: e.icon, summary: e.summary, risk: e.risk,
    aiDecision: e.aiDecision, time: e.time,
    toolName: e.toolName || null,
    toolInput: e.toolInput || null,
  })),
}));

ipcMain.handle('toggle-pause', () => { togglePause(); return isPaused; });

ipcMain.handle('set-lang', (_e, code) => {
  lang = code; saveConfig(); updateTrayMenu(); return lang;
});

ipcMain.handle('re-detect', () => {
  const tools = detectProtectedTools();
  protectedTools = [...new Set([...protectedTools, ...tools])];
  saveConfig(); updateTrayMenu(); return protectedTools;
});

// ─── 工具函数 ──────────────────────────────────────────────────────────────────

function addRecentEvent(event) {
  const locale = lang === 'en' ? 'en-US' : 'zh-CN';
  const time = new Date().toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  // Truncate long string values in toolInput to keep config file small
  let toolInput = null;
  if (event.toolInput && typeof event.toolInput === 'object') {
    toolInput = {};
    for (const [k, v] of Object.entries(event.toolInput)) {
      toolInput[k] = (typeof v === 'string' && v.length > 150) ? v.slice(0, 150) + '…' : v;
    }
  }
  recentEvents.unshift({ ...event, toolInput, time });
  if (recentEvents.length > 20) recentEvents.pop();
}

function truncate(str, max) {
  return str.length > max ? str.slice(0, max) + '…' : str;
}
