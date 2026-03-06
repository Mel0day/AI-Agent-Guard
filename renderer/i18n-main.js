'use strict';

const LANGS = {
  zh: {
    appName: 'AI 守卫',
    trayStatusSafe: '🛡️  今天一切安全',
    trayStatusBlocked: (n) => `🛡️  今天帮你挡掉了 ${n} 次危险操作`,
    trayStatusPaused: '⏸  守卫已关闭',
    trayToggleOff: '⏸  暂时关闭守卫',
    trayToggleOn: '▶  重新开启守卫',
    trayOpenSettings: '📋  查看详情',
    trayQuit: '退出',
    notifWelcomeTitle: '🛡️ AI 守卫已就位',
    notifWelcomeBody: '从现在开始，我会帮你盯着 AI 的操作。有危险的我直接帮你挡，不会动不动打扰你。',
    notifBlockedTitle: '🛡️ 我帮你挡住了一个危险操作',
    notifBlockedBody: (reason) => `${reason}\n\n你不需要做任何事，已经帮你处理好了。`,
    dialogTitle: '有个操作，你来确认一下',
    dialogMessage: (reason) => `AI 刚才想做这件事：\n\n${reason}`,
    dialogDetail: '这件事是你安排的吗？不确定的话，选「不是，帮我拒绝」就好。',
    dialogBtnReject: '不是，帮我拒绝',
    dialogBtnAllow: '是的，让它继续',
  },
  en: {
    appName: 'AI Guard',
    trayStatusSafe: '🛡️  All clear today',
    trayStatusBlocked: (n) => `🛡️  Blocked ${n} dangerous ${n === 1 ? 'action' : 'actions'} today`,
    trayStatusPaused: '⏸  Guard is off',
    trayToggleOff: '⏸  Pause guard',
    trayToggleOn: '▶  Resume guard',
    trayOpenSettings: '📋  Open details',
    trayQuit: 'Quit',
    notifWelcomeTitle: '🛡️ AI Guard is active',
    notifWelcomeBody: "I'm now watching your AI's actions. I'll silently block dangerous ones without bothering you.",
    notifBlockedTitle: '🛡️ Blocked a dangerous action',
    notifBlockedBody: (reason) => `${reason}\n\nNo action needed — already handled.`,
    dialogTitle: 'Please confirm this action',
    dialogMessage: (reason) => `Your AI just tried to do this:\n\n${reason}`,
    dialogDetail: "Did you ask it to do this? If you're not sure, click \"No, block it\".",
    dialogBtnReject: 'No, block it',
    dialogBtnAllow: 'Yes, allow it',
  },
};

function getLang(code) {
  return LANGS[code] || LANGS['zh'];
}

module.exports = { LANGS, getLang };
