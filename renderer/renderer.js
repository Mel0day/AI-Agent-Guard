'use strict';

const TOOL_META = {
  'Claude Code': { icon: '🤖', desc: { zh: '正在监控 Claude Code 的操作', en: 'Monitoring Claude Code actions' } },
  'Cursor':      { icon: '🖱️', desc: { zh: '正在监控 Cursor 的操作',      en: 'Monitoring Cursor actions' } },
  'Codex':       { icon: '💻', desc: { zh: '正在监控 Codex 的操作',       en: 'Monitoring Codex actions' } },
};

let currentLang = 'zh';
let L = window.LANGS['zh'];
let cachedEvents = [];

// ── i18n ──────────────────────────────────────────────────────────

function applyLang(code) {
  currentLang = code;
  L = window.LANGS[code] || window.LANGS['zh'];
  document.documentElement.lang = code === 'zh' ? 'zh-CN' : 'en';
  document.title = L.appName;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (typeof L[key] === 'string') el.textContent = L[key];
  });
}

function initLangOverlay(hasLang) {
  document.getElementById('lang-overlay').classList.toggle('hidden', hasLang);
}

// ── State ─────────────────────────────────────────────────────────

async function loadState() {
  const state = await window.aisec.getState();
  if (state.lang) applyLang(state.lang);
  initLangOverlay(!!state.lang);
  renderHeader(state);
  renderStats(state);
  renderTools(state.protectedTools);
  renderEvents(state.recentEvents);
}

function renderHeader(state) {
  const logo    = document.getElementById('header-logo');
  const txt     = document.getElementById('status-text');
  const btn     = document.getElementById('pause-btn');
  const dot     = document.getElementById('status-dot');
  if (state.isPaused) {
    logo.textContent = '⏸';
    txt.textContent  = L.statusPaused;
    btn.textContent  = L.btnResume;
    btn.classList.add('paused');
    dot.classList.add('paused');
  } else if (state.todayBlockedCount > 0) {
    logo.textContent = '🛡️';
    txt.textContent  = L.statusBlocked(state.todayBlockedCount);
    btn.textContent  = L.btnPause;
    btn.classList.remove('paused');
    dot.classList.remove('paused');
  } else {
    logo.textContent = '🛡️';
    txt.textContent  = L.statusSafe;
    btn.textContent  = L.btnPause;
    btn.classList.remove('paused');
    dot.classList.remove('paused');
  }
}

function renderStats(state) {
  const el = document.getElementById('blocked-count');
  el.textContent = state.todayBlockedCount;
  el.classList.toggle('danger', state.todayBlockedCount > 0);
  document.getElementById('tools-count').textContent = state.protectedTools.length;
}

function renderTools(tools) {
  const el = document.getElementById('tools-list');
  if (!tools || tools.length === 0) {
    el.innerHTML = `<div class="empty-state">${L.emptyTools}</div>`;
    return;
  }
  el.innerHTML = tools.map(name => {
    const meta = TOOL_META[name] || { icon: '🔧', desc: { zh: '正在监控操作', en: 'Monitoring actions' } };
    const desc = meta.desc[currentLang] || meta.desc['zh'];
    return `<div class="tool-row">
      <div class="tool-icon">${meta.icon}</div>
      <div class="tool-info">
        <div class="tool-name">${name}</div>
        <div class="tool-path">${desc}</div>
      </div>
      <span class="badge active">${L.badgeActive}</span>
    </div>`;
  }).join('');
}

function renderEvents(events) {
  cachedEvents = events || [];
  const el = document.getElementById('events-list');
  if (cachedEvents.length === 0) {
    el.innerHTML = `<div class="empty-state">${L.emptyEvents}</div>`;
    return;
  }
  el.innerHTML = cachedEvents.map((e, i) => {
    let cls, label;
    if (e.aiDecision === 'BLOCK' || e.risk === 'CRITICAL') { cls = 'blocked'; label = L.actionBlocked; }
    else if (e.aiDecision === 'WARN')                       { cls = 'warned';  label = L.actionWarned;  }
    else                                                    { cls = 'allowed'; label = L.actionAllowed; }

    const summary = e.summary.length > 36 ? e.summary.slice(0, 36) + '…' : e.summary;
    return `<div class="event-row" data-idx="${i}">
      <div class="event-icon">${e.icon}</div>
      <div class="event-info">
        <div class="event-summary">
          <span class="event-action ${cls}">${label}</span>${summary}
        </div>
        <div class="event-meta">${e.time}</div>
      </div>
      <div class="event-chevron">›</div>
    </div>`;
  }).join('');

  el.querySelectorAll('.event-row').forEach(row => {
    row.addEventListener('click', () => showDetail(+row.dataset.idx));
  });
}

// ── Event detail drawer ────────────────────────────────────────────

function showDetail(idx) {
  const e = cachedEvents[idx];
  if (!e) return;

  let cls, label;
  if (e.aiDecision === 'BLOCK' || e.risk === 'CRITICAL') { cls = 'blocked'; label = L.actionBlocked; }
  else if (e.aiDecision === 'WARN')                       { cls = 'warned';  label = L.actionWarned;  }
  else                                                    { cls = 'allowed'; label = L.actionAllowed; }

  document.getElementById('detail-icon').textContent   = e.icon;
  document.getElementById('detail-action').textContent = label;
  document.getElementById('detail-action').className   = `detail-action ${cls}`;
  document.getElementById('detail-text').textContent   = e.summary;
  document.getElementById('detail-time').textContent   = e.time;

  // Show tool name chip
  const toolEl = document.getElementById('detail-tool');
  if (e.toolName) {
    toolEl.textContent = e.toolName;
    toolEl.classList.remove('hidden');
  } else {
    toolEl.classList.add('hidden');
  }

  // Show tool input (command / file path / JSON)
  const inputEl = document.getElementById('detail-input');
  if (e.toolInput && typeof e.toolInput === 'object' && Object.keys(e.toolInput).length > 0) {
    let text = '';
    if (e.toolInput.command)   text = '$ ' + e.toolInput.command;
    else if (e.toolInput.file_path) text = e.toolInput.file_path;
    else text = JSON.stringify(e.toolInput);
    inputEl.textContent = text;
    inputEl.classList.remove('hidden');
  } else {
    inputEl.classList.add('hidden');
  }

  document.getElementById('detail-drawer').classList.remove('hidden');
}

function hideDetail() {
  document.getElementById('detail-drawer').classList.add('hidden');
}

// ── Wire up all event listeners here (no inline onclick) ──────────

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('pause-btn').addEventListener('click', async () => {
    await window.aisec.togglePause();
    await loadState();
  });

  document.getElementById('btn-rescan').addEventListener('click', async () => {
    const tools = await window.aisec.reDetect();
    renderTools(tools);
    document.getElementById('tools-count').textContent = tools.length;
  });

  document.getElementById('btn-zh').addEventListener('click', () => selectLang('zh'));
  document.getElementById('btn-en').addEventListener('click', () => selectLang('en'));
  document.getElementById('detail-close').addEventListener('click', hideDetail);
  document.getElementById('detail-drawer').addEventListener('click', e => {
    if (e.target === e.currentTarget) hideDetail();
  });

  // Auto-refresh when main process pushes a state update (day rollover, new event, etc.)
  window.aisec.onStateUpdated(() => loadState());
});

async function selectLang(code) {
  await window.aisec.setLang(code);
  document.getElementById('lang-overlay').classList.add('hidden');
  applyLang(code);
  await loadState();
}

loadState();
