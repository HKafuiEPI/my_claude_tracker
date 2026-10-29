#!/usr/bin/env node
'use strict';
// Claude Code statusLine command: stores the real `rate_limits` for the widget and prints them. Never fails.
const fs = require('fs');
const path = require('path');
const { limitsFile, mergeLimits, readLimits } = require('./usage');

try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const l = mergeLimits(readLimits(), input.rate_limits);
  const file = limitsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(l));
  fs.renameSync(file + '.tmp', file); // atomic: the widget reads this file concurrently
  const parts = [l.five_hour && `5h ${Math.round(l.five_hour.pct)} %`, l.seven_day && `7j ${Math.round(l.seven_day.pct)} %`].filter(Boolean);
  process.stdout.write(parts.join(' · '));
} catch {}
