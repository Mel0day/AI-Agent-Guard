'use strict';

window.LANGS = {
  zh: {
    // Header
    appName: 'AI 守卫',
    statusSafe: '今天一切安全 ✓',
    statusBlocked: (n) => `今天帮你挡掉了 ${n} 次危险操作`,
    statusPaused: '守卫已关闭，AI 操作不再被监控',
    btnPause: '暂停',
    btnResume: '重新开启',

    // Stats
    statBlockedLabel: '今天帮你挡掉的危险操作',
    statToolsLabel: '正在守护的 AI',

    // Tools section
    sectionTools: '正在守护的 AI 助手',
    btnRescan: '重新扫描',
    emptyTools: '还没找到正在使用的 AI 助手\n点击右上角「重新扫描」试试',
    badgeActive: '守护中',

    // Events section
    sectionEvents: '今天发生了什么',
    emptyEvents: '今天还没有任何拦截记录\nAI 一直在乖乖工作',
    actionBlocked: '帮你挡掉了',
    actionWarned: '请你确认了',
    actionAllowed: '自动放行了',

    // Lang overlay
    langOverlayTitle: '选择语言',
    langOverlaySubtitle: '你想用哪种语言？',

    // Tray menu (used in main.js via i18n-main.js)
    trayStatusSafe: '🛡️  今天一切安全',
    trayStatusBlocked: (n) => `🛡️  今天帮你挡掉了 ${n} 次危险操作`,
    trayStatusPaused: '⏸  守卫已关闭',
    trayToggleOff: '⏸  暂时关闭守卫',
    trayToggleOn: '▶  重新开启守卫',
    trayOpenSettings: '📋  查看详情',
    trayQuit: '退出',

    // Notifications
    notifWelcomeTitle: '🛡️ AI 守卫已就位',
    notifWelcomeBody: '从现在开始，我会帮你盯着 AI 的操作。有危险的我直接帮你挡，不会动不动打扰你。',
    notifBlockedTitle: '🛡️ 我帮你挡住了一个危险操作',
    notifBlockedBody: (reason) => `${reason}\n\n你不需要做任何事，已经帮你处理好了。`,

    // Dialog
    dialogTitle: '有个操作，你来确认一下',
    dialogMessage: (reason) => `AI 刚才想做这件事：\n\n${reason}`,
    dialogDetail: '这件事是你安排的吗？不确定的话，选「不是，帮我拒绝」就好。',
    dialogBtnReject: '不是，帮我拒绝',
    dialogBtnAllow: '是的，让它继续',
  },

  en: {
    // Header
    appName: 'AI Guard',
    statusSafe: 'All clear today ✓',
    statusBlocked: (n) => `Blocked ${n} dangerous ${n === 1 ? 'action' : 'actions'} today`,
    statusPaused: 'Guard is off — AI actions are no longer monitored',
    btnPause: 'Pause',
    btnResume: 'Resume',

    // Stats
    statBlockedLabel: 'Dangerous actions blocked today',
    statToolsLabel: 'AI tools protected',

    // Tools section
    sectionTools: 'Protected AI Assistants',
    btnRescan: 'Rescan',
    emptyTools: 'No AI assistants detected yet\nTry clicking "Rescan" above',
    badgeActive: 'Protected',

    // Events section
    sectionEvents: "What happened today",
    emptyEvents: 'No blocked actions today\nYour AI is behaving well',
    actionBlocked: 'Blocked:',
    actionWarned: 'Confirmed:',
    actionAllowed: 'Allowed:',

    // Lang overlay
    langOverlayTitle: 'Choose Language',
    langOverlaySubtitle: 'Which language do you prefer?',

    // Tray menu
    trayStatusSafe: '🛡️  All clear today',
    trayStatusBlocked: (n) => `🛡️  Blocked ${n} dangerous ${n === 1 ? 'action' : 'actions'} today`,
    trayStatusPaused: '⏸  Guard is off',
    trayToggleOff: '⏸  Pause guard',
    trayToggleOn: '▶  Resume guard',
    trayOpenSettings: '📋  Open details',
    trayQuit: 'Quit',

    // Notifications
    notifWelcomeTitle: '🛡️ AI Guard is active',
    notifWelcomeBody: "I'm now watching your AI's actions. I'll silently block dangerous ones without bothering you.",
    notifBlockedTitle: '🛡️ Blocked a dangerous action',
    notifBlockedBody: (reason) => `${reason}\n\nNo action needed — already handled.`,

    // Dialog
    dialogTitle: 'Please confirm this action',
    dialogMessage: (reason) => `Your AI just tried to do this:\n\n${reason}`,
    dialogDetail: "Did you ask it to do this? If you're not sure, click \"No, block it\".",
    dialogBtnReject: 'No, block it',
    dialogBtnAllow: 'Yes, allow it',
  },
};
