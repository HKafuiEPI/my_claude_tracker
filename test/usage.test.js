'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseFile, dedupe, sessionBlocks, snapshot, mergeLimits, DEFAULTS } = require('../src/usage');

const H = 3600e3;
const line = (id, ts, out) =>
  JSON.stringify({ timestamp: new Date(ts).toISOString(), requestId: 'r' + id, message: { id: 'm' + id, usage: { input_tokens: 0, output_tokens: out, cache_creation_input_tokens: 0, cache_read_input_tokens: 99999 } } });

test('parses usage lines and dedupes copies across files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-'));
  const t = Date.UTC(2026, 9, 29, 10, 0);
  fs.writeFileSync(path.join(dir, 'a.jsonl'), [line(1, t, 100), '{"type":"user"}', 'not json', line(2, t + 1000, 50)].join('\n'));
  fs.writeFileSync(path.join(dir, 'b.jsonl'), line(1, t, 100)); // resumed session copy
  const all = dedupe([await parseFile(path.join(dir, 'a.jsonl')), await parseFile(path.join(dir, 'b.jsonl'))]);
  assert.strictEqual(all.length, 2);
});

test('5h blocks split on window end and gaps', async () => {
  const t = Date.UTC(2026, 9, 29, 10, 30);
  const e = (ts, out) => ({ key: String(ts), ts, in: 0, out, cc: 0, cr: 0 });
  const blocks = sessionBlocks([e(t, 10), e(t + 4 * H, 5), e(t + 5 * H, 7)], false);
  assert.deepStrictEqual(blocks.map((b) => b.tokens), [15, 7]);
  assert.strictEqual(blocks[0].start, Date.UTC(2026, 9, 29, 10, 0));
});

test('delta: behind when usage trails elapsed time, ahead when it leads', () => {
  const now = Date.UTC(2026, 9, 29, 12, 30); // 2.5 h into a 10:00 block = 50 % elapsed
  const e = (ts, out) => ({ key: String(ts), ts, in: 0, out, cc: 0, cr: 0 });
  const past = Date.UTC(2026, 9, 28, 10, 0);
  const base = [e(past, 1000), e(Date.UTC(2026, 9, 29, 10, 0), 200)];
  const cfg = { ...DEFAULTS, limit5h: 1000, limitWeek: 5000 };
  let s = snapshot(base, cfg, now);
  assert.strictEqual(Math.round(s.session.deltaPts), -30); // 20 % used, 50 % elapsed
  assert.strictEqual(s.session.status, 'behind');
  s = snapshot([e(past, 1000), e(Date.UTC(2026, 9, 29, 10, 0), 800)], cfg, now);
  assert.strictEqual(s.session.status, 'ahead');
  assert.strictEqual(Math.round(s.session.projectedPct), 160);
});

test('limits fall back to history max (flagged estimated); no history means unknown', () => {
  const now = Date.UTC(2026, 9, 29, 12, 30);
  const e = (ts, out) => ({ key: String(ts), ts, in: 0, out, cc: 0, cr: 0 });
  const s = snapshot([e(Date.UTC(2026, 9, 20, 10, 0), 4000), e(Date.UTC(2026, 9, 29, 10, 0), 100)], DEFAULTS, now);
  assert.strictEqual(s.session.limit, 4000);
  assert.ok(s.session.estimated);
  const none = snapshot([e(Date.UTC(2026, 9, 29, 10, 0), 100)], DEFAULTS, now);
  assert.strictEqual(none.session.status, 'unknown');
});

test('inactive when the last block has ended', () => {
  const e = { key: 'k', ts: Date.UTC(2026, 9, 29, 1, 0), in: 0, out: 5, cc: 0, cr: 0 };
  assert.strictEqual(snapshot([e], DEFAULTS, Date.UTC(2026, 9, 29, 12, 0)).session.active, false);
});

test('real statusLine percentages override the estimate and re-anchor the windows', () => {
  const now = Date.UTC(2026, 9, 29, 12, 30);
  const rl = { five_hour: { used_percentage: 20, resets_at: (now + 2.5 * H) / 1000 }, seven_day: { used_percentage: 60, resets_at: (now + 3.5 * 24 * H) / 1000 } };
  const real = mergeLimits(null, rl, now);
  const s = snapshot([], DEFAULTS, now, real); // no local history at all: still active thanks to the real data
  assert.ok(s.session.real && s.week.real);
  assert.strictEqual(Math.round(s.session.usedPct), 20);
  assert.strictEqual(Math.round(s.session.elapsedPct), 50);
  assert.strictEqual(Math.round(s.week.deltaPts), 10); // 60 % used, 50 % of the week elapsed
  // an absent window keeps the previous one only until its reset
  assert.ok(mergeLimits(real, {}, now + H).five_hour);
  assert.ok(!mergeLimits(real, {}, now + 3 * H).five_hour);
});
