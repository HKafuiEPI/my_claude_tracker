'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const HOUR = 3600e3;
const SESSION_MS = 5 * HOUR;
const WEEK_MS = 7 * 24 * HOUR;
const HISTORY_DAYS = 60;

const DEFAULTS = {
  limit5h: null, // tokens per 5 h session; null = estimate from your own history
  limitWeek: null, // tokens per week; null = estimate from your own history
  weeklyReset: { day: 1, hour: 0 }, // 0 = Sunday ... 6 = Saturday, local time
  countCacheRead: false, // cache reads are cheap and not counted by default
  refreshSec: 30,
  startHidden: false,
};

const configDir = (home = os.homedir()) => path.join(home, '.config', 'claude-tracker');
const cacheFile = (home = os.homedir()) => path.join(home, '.cache', 'claude-tracker', 'snapshot.json');
const limitsFile = (home = os.homedir()) => path.join(home, '.cache', 'claude-tracker', 'limits.json');

// Real quota from Claude Code's statusLine `rate_limits` (Pro/Max only), stored by src/statusline.js.
// Windows are {pct: 0-100, resetsAt: ms}; a window is dropped once it has reset.
function mergeLimits(prev, rateLimits, now = Date.now()) {
  const out = { ts: now };
  for (const k of ['five_hour', 'seven_day']) {
    const w = rateLimits && rateLimits[k];
    if (w && typeof w.used_percentage === 'number' && w.resets_at > 0) out[k] = { pct: w.used_percentage, resetsAt: w.resets_at * 1000 };
    else if (prev && prev[k] && prev[k].resetsAt > now) out[k] = prev[k];
  }
  return out;
}

function readLimits(home = os.homedir()) {
  try {
    return JSON.parse(fs.readFileSync(limitsFile(home), 'utf8'));
  } catch {
    return null;
  }
}

function loadConfig(home = os.homedir()) {
  const file = path.join(configDir(home), 'config.json');
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (e) {
    if (e.code === 'ENOENT') {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(DEFAULTS, null, 2) + '\n');
    } else {
      console.error(`claude-tracker: invalid ${file}, using defaults (${e.message})`);
    }
    return { ...DEFAULTS };
  }
}

const tokensOf = (e, withCacheRead) => e.in + e.out + e.cc + (withCacheRead ? e.cr : 0);

function transcriptFiles(home = os.homedir(), env = process.env, now = Date.now()) {
  const roots = new Set([path.join(home, '.claude', 'projects'), path.join(home, '.config', 'claude', 'projects')]);
  if (env.CLAUDE_CONFIG_DIR) roots.add(path.join(env.CLAUDE_CONFIG_DIR, 'projects'));
  const out = [];
  const walk = (dir) => {
    let items;
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const it of items) {
      const p = path.join(dir, it.name);
      if (it.isDirectory()) walk(p);
      else if (it.name.endsWith('.jsonl')) {
        try {
          const st = fs.statSync(p);
          if (now - st.mtimeMs < HISTORY_DAYS * 24 * HOUR) out.push([p, st]);
        } catch {}
      }
    }
  };
  roots.forEach(walk);
  return out;
}

async function parseFile(file) {
  const entries = [];
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.includes('"usage"')) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    const u = d.message && d.message.usage;
    const ts = Date.parse(d.timestamp);
    if (!u || !ts) continue;
    entries.push({
      key: `${d.message.id || d.uuid}:${d.requestId || ''}`,
      ts,
      in: u.input_tokens || 0,
      out: u.output_tokens || 0,
      cc: u.cache_creation_input_tokens || 0,
      cr: u.cache_read_input_tokens || 0,
    });
  }
  return entries;
}

// Resumed sessions copy old lines into new files, so entries are de-duplicated across files.
function dedupe(lists) {
  const byKey = new Map();
  for (const e of lists.flat()) {
    const prev = byKey.get(e.key);
    if (!prev || tokensOf(e, true) > tokensOf(prev, true)) byKey.set(e.key, e);
  }
  return [...byKey.values()].sort((a, b) => a.ts - b.ts);
}

const fileCache = new Map();
async function loadEntries(home = os.homedir(), env = process.env, now = Date.now()) {
  const files = transcriptFiles(home, env, now);
  for (const [f, st] of files) {
    const c = fileCache.get(f);
    if (!c || c.mtimeMs !== st.mtimeMs || c.size !== st.size) {
      fileCache.set(f, { mtimeMs: st.mtimeMs, size: st.size, entries: await parseFile(f) });
    }
  }
  const live = new Set(files.map(([f]) => f));
  for (const f of fileCache.keys()) if (!live.has(f)) fileCache.delete(f);
  return dedupe([...fileCache.values()].map((c) => c.entries));
}

// Same block rule as ccusage: a block starts at the hour of its first message and lasts 5 h.
function sessionBlocks(entries, withCacheRead) {
  const blocks = [];
  let cur = null;
  for (const e of entries) {
    if (!cur || e.ts >= cur.end || e.ts - cur.last >= SESSION_MS) {
      const start = e.ts - (e.ts % HOUR);
      cur = { start, end: start + SESSION_MS, last: e.ts, tokens: 0 };
      blocks.push(cur);
    }
    cur.tokens += tokensOf(e, withCacheRead);
    cur.last = e.ts;
  }
  return blocks;
}

function weekStart(now, { day, hour }) {
  const d = new Date(now);
  d.setHours(hour, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() - day + 7) % 7));
  if (d.getTime() > now) d.setDate(d.getDate() - 7);
  return d.getTime();
}

// delta = share of the quota used minus share of the window elapsed.
// < 0: behind (under-using, quota will go to waste); > 0: ahead (limit may hit early).
function gauge({ used, start, end, limit, estimated, realPct = null, now }) {
  const elapsed = Math.min(1, Math.max(0, (now - start) / (end - start)));
  const usedFrac = realPct !== null ? realPct / 100 : limit ? used / limit : null;
  const deltaPts = usedFrac === null ? null : (usedFrac - elapsed) * 100;
  return {
    active: true,
    used,
    limit,
    estimated,
    real: realPct !== null,
    start,
    end,
    resetsInMs: Math.max(0, end - now),
    elapsedPct: elapsed * 100,
    usedPct: usedFrac === null ? null : usedFrac * 100,
    deltaPts,
    projectedPct: usedFrac !== null && elapsed >= 0.03 ? (usedFrac / elapsed) * 100 : null,
    status: deltaPts === null ? 'unknown' : Math.abs(deltaPts) <= 5 ? 'ontrack' : deltaPts < 0 ? 'behind' : 'ahead',
  };
}

function snapshot(entries, cfg, now = Date.now(), real = null) {
  const cr = cfg.countCacheRead;
  const live = (k) => (real && real[k] && real[k].resetsAt > now ? real[k] : null);
  const r5 = live('five_hour');
  const r7 = live('seven_day');
  const blocks = sessionBlocks(entries, cr);
  const active = blocks.length && now < blocks[blocks.length - 1].end ? blocks[blocks.length - 1] : null;
  const done = active ? blocks.slice(0, -1) : blocks;

  const maxDone = Math.max(0, ...done.map((b) => b.tokens));
  const limit5h = cfg.limit5h || maxDone || null;
  const est5h = !cfg.limit5h;

  const wStart = r7 ? r7.resetsAt - WEEK_MS : weekStart(now, cfg.weeklyReset);
  const weeks = new Map();
  let weekUsed = 0;
  for (const e of entries) {
    const t = tokensOf(e, cr);
    if (e.ts >= wStart) weekUsed += t;
    else {
      const i = Math.ceil((wStart - e.ts) / WEEK_MS);
      weeks.set(i, (weeks.get(i) || 0) + t);
    }
  }
  const maxWeek = Math.max(0, ...weeks.values());
  const limitWeek = cfg.limitWeek || maxWeek || null;

  return {
    now,
    realAt: real && real.ts,
    session: r5
      ? gauge({ used: active ? active.tokens : 0, start: r5.resetsAt - SESSION_MS, end: r5.resetsAt, limit: limit5h, estimated: false, realPct: r5.pct, now })
      : active
        ? gauge({ used: active.tokens, start: active.start, end: active.end, limit: limit5h, estimated: est5h, now })
        : { active: false, limit: limit5h, estimated: est5h },
    week: gauge({ used: weekUsed, start: wStart, end: wStart + WEEK_MS, limit: limitWeek, estimated: !cfg.limitWeek && !r7, realPct: r7 && r7.pct, now }),
  };
}

const signed = (n) => (n < 0 ? '−' : '+') + Math.abs(Math.round(n));
const LABEL = { behind: 'en retard', ahead: 'en avance', ontrack: 'dans le rythme' };

function describe(snap) {
  const part = (name, g) => {
    if (!g.active) return `${name} : inactive`;
    if (g.usedPct === null) return `${name} : ${g.used.toLocaleString('fr-FR')} tokens`;
    return `${name} : ${Math.round(g.usedPct)} % (Δ ${signed(g.deltaPts)} pts, ${LABEL[g.status]})`;
  };
  return `${part('Session 5 h', snap.session)} · ${part('Semaine', snap.week)}`;
}

module.exports = { DEFAULTS, loadConfig, configDir, cacheFile, limitsFile, mergeLimits, readLimits, loadEntries, parseFile, dedupe, tokensOf, sessionBlocks, weekStart, snapshot, describe };
