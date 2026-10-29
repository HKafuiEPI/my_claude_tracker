'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const script = path.join(__dirname, '..', 'scripts', 'install.js');
const run = (home, ...args) => spawnSync(process.execPath, [script, ...args], { env: { ...process.env, HOME: home }, encoding: 'utf8' });

test('install merges hooks idempotently, keeps existing settings, uninstall reverts', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-home-'));
  const sf = path.join(home, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(sf));
  const mine = { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] }, model: 'sonnet' };
  fs.writeFileSync(sf, JSON.stringify(mine));

  assert.strictEqual(run(home).status, 0);
  assert.strictEqual(run(home).status, 0); // second run must not duplicate
  const s = JSON.parse(fs.readFileSync(sf, 'utf8'));
  assert.strictEqual(s.model, 'sonnet');
  assert.strictEqual(s.hooks.SessionStart.length, 2);
  assert.strictEqual(s.hooks.SessionEnd.length, 1);
  assert.ok(s.statusLine.command.includes('statusline.js'));
  assert.ok(fs.existsSync(path.join(home, '.config', 'autostart', 'claude-tracker.desktop')));

  assert.strictEqual(run(home, 'uninstall').status, 0);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(sf, 'utf8')), mine);
  assert.ok(!fs.existsSync(path.join(home, '.config', 'autostart', 'claude-tracker.desktop')));
});

test('refuses to rewrite invalid settings.json', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-home-'));
  fs.mkdirSync(path.join(home, '.claude'));
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), '{ nope');
  assert.notStrictEqual(run(home).status, 0);
  assert.strictEqual(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'), '{ nope');
});

test('statusLine: pipes real rate_limits to the cache; a foreign statusLine is never replaced', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-home-'));
  const sf = path.join(home, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(sf));
  const mine = { statusLine: { type: 'command', command: 'echo mine' } };
  fs.writeFileSync(sf, JSON.stringify(mine));
  assert.strictEqual(run(home).status, 0);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(sf, 'utf8')).statusLine, mine.statusLine);
  assert.strictEqual(run(home, 'uninstall').status, 0);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(sf, 'utf8')), mine);

  const input = JSON.stringify({ rate_limits: { five_hour: { used_percentage: 23.5, resets_at: 4102444800 } } });
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'src', 'statusline.js')], { input, env: { ...process.env, HOME: home }, encoding: 'utf8' });
  assert.strictEqual(r.stdout, '5h 24 %');
  const saved = JSON.parse(fs.readFileSync(path.join(home, '.cache', 'claude-tracker', 'limits.json'), 'utf8'));
  assert.strictEqual(saved.five_hour.pct, 23.5);
});
