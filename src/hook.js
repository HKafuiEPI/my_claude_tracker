#!/usr/bin/env node
'use strict';
// Claude Code hook: `hook.js start` (SessionStart) / `hook.js end` (SessionEnd). Never fails a session.
const fs = require('fs');
const { cacheFile, loadConfig, parseFile, dedupe, tokensOf, describe } = require('./usage');
const { ensureDoc, sessionContext, appendLog } = require('./doc');

const readSnapshot = () => {
  try {
    const s = JSON.parse(fs.readFileSync(cacheFile(), 'utf8'));
    return Date.now() - s.now < 10 * 60e3 ? s : null; // only trust a recent snapshot from the running app
  } catch {
    return null;
  }
};

async function main() {
  const mode = process.argv[2];
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const file = ensureDoc(input.cwd);
  if (!file) return;
  const snap = readSnapshot();

  if (mode === 'start') {
    const additionalContext = sessionContext(file, snap && describe(snap));
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } }));
  } else if (mode === 'end' && input.transcript_path) {
    const cfg = loadConfig();
    const tokens = dedupe([await parseFile(input.transcript_path)]).reduce((n, e) => n + tokensOf(e, cfg.countCacheRead), 0);
    if (!tokens) return;
    const d = new Date();
    const stamp = `${d.toLocaleDateString('fr-CA')} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
    const id = String(input.session_id || '').slice(0, 8);
    appendLog(file, `- ${stamp} · session ${id} · ${tokens.toLocaleString('fr-FR')} tokens${snap ? ` · ${describe(snap)}` : ''}`);
  }
}

main().catch(() => {});
