#!/usr/bin/env node
'use strict';
// node scripts/install.js [uninstall]: autostart entry + Claude Code SessionStart/SessionEnd hooks.
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const home = os.homedir();
const hookJs = path.join(root, 'src', 'hook.js');
const statuslineJs = path.join(root, 'src', 'statusline.js');
const uninstall = process.argv[2] === 'uninstall';

const entry = `[Desktop Entry]
Type=Application
Name=Claude Tracker
Comment=Claude usage per 5 h session and per week, with pace delta
Exec="${path.join(root, 'bin', 'claude-tracker')}"
Icon=claude-tracker
StartupWMClass=claude-tracker
Terminal=false
Categories=Utility;
X-GNOME-Autostart-enabled=true
`;
const desktopFiles = [path.join(home, '.config', 'autostart', 'claude-tracker.desktop'), path.join(home, '.local', 'share', 'applications', 'claude-tracker.desktop')];

// Themed icon: the shell/dock resolve `Icon=claude-tracker` here and ignore a stale file path cache.
const iconFile = path.join(home, '.local', 'share', 'icons', 'hicolor', '256x256', 'apps', 'claude-tracker.png');
if (uninstall) fs.rmSync(iconFile, { force: true });
else {
  fs.mkdirSync(path.dirname(iconFile), { recursive: true });
  fs.copyFileSync(path.join(root, 'assets', 'icon.png'), iconFile);
}

for (const f of desktopFiles) {
  if (uninstall) fs.rmSync(f, { force: true });
  else {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, entry);
  }
}

const settingsFile = path.join(home, '.claude', 'settings.json');
let settings = {};
if (fs.existsSync(settingsFile)) {
  try {
    settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  } catch (e) {
    console.error(`Refusing to touch ${settingsFile}: invalid JSON (${e.message}). Autostart entry was written; hooks were not.`);
    process.exit(1);
  }
  try {
    fs.copyFileSync(settingsFile, settingsFile + '.bak-claude-tracker', fs.constants.COPYFILE_EXCL); // keep the first backup only
  } catch {}
} else if (uninstall) process.exit(0);

settings.hooks = settings.hooks || {};
for (const [event, mode] of [['SessionStart', 'start'], ['SessionEnd', 'end']]) {
  const others = (settings.hooks[event] || []).filter((g) => !(g.hooks || []).some((h) => (h.command || '').includes(hookJs)));
  if (!uninstall) others.push({ hooks: [{ type: 'command', command: `"${process.execPath}" "${hookJs}" ${mode}`, timeout: 10 }] });
  if (others.length) settings.hooks[event] = others;
  else delete settings.hooks[event];
}
if (!Object.keys(settings.hooks).length) delete settings.hooks;

// Real quota %: only take the statusLine slot if it is free (or already ours).
const ours = (settings.statusLine?.command || '').includes(statuslineJs);
if (uninstall) {
  if (ours) delete settings.statusLine;
} else if (!settings.statusLine || ours) {
  settings.statusLine = { type: 'command', command: `"${process.execPath}" "${statuslineJs}"` };
} else console.warn('A statusLine is already configured: left untouched, so the widget keeps estimating limits. Pipe its stdin through src/statusline.js to get real percentages.');

fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
console.log(uninstall ? 'Claude Tracker removed (autostart + hooks).' : 'Claude Tracker installed: starts at login, hooks added to ~/.claude/settings.json (backup: settings.json.bak-claude-tracker).');
