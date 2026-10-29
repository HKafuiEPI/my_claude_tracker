'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ensureDoc, appendLog, sessionContext, DOC_NAME, OPT_OUT } = require('../src/doc');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ct-doc-'));

test('creates the doc once and never overwrites it', () => {
  const dir = tmp();
  const f = ensureDoc(dir, '/nonexistent-home');
  assert.strictEqual(f, path.join(dir, DOC_NAME));
  fs.appendFileSync(f, '\nmy notes\n');
  ensureDoc(dir, '/nonexistent-home');
  assert.match(fs.readFileSync(f, 'utf8'), /my notes/);
});

test('skips $HOME, ~/.claude, opted-out dirs and missing dirs', () => {
  const home = tmp();
  fs.mkdirSync(path.join(home, '.claude'));
  const opted = tmp();
  fs.writeFileSync(path.join(opted, OPT_OUT), '');
  for (const d of [home, path.join(home, '.claude'), opted, '/does/not/exist', undefined]) assert.strictEqual(ensureDoc(d, home), null);
});

test('log lines append after the marker and stay capped', () => {
  const f = ensureDoc(tmp(), '/nonexistent-home');
  for (let i = 0; i < 105; i++) appendLog(f, `- entry ${i}`);
  const lines = fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.startsWith('- entry'));
  assert.strictEqual(lines.length, 100);
  assert.strictEqual(lines.at(-1), '- entry 104');
  assert.match(sessionContext(f, 'usage line'), /au fur et à mesure/);
});
