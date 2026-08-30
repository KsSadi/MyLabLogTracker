// Run: node test_daymap.js
// Pulls live logic out of app.js so this fails if that logic breaks.
const assert = require('assert');
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, 'app.js'), 'utf8');

// ── buildDayMap must query timelogs BY USER ──
// The original bug: it walked issues where ME was the *assignee*, so time logged
// on someone else's issue vanished (Aug 2026 read 0h when 16h existed).
assert.ok(/timelogs\(username:/.test(src),
  'buildDayMap must query timelogs by username, not by issue assignee');
assert.ok(!/assignee_username=\$\{ME\.username\}&state=all&scope=all&updated_after/.test(src),
  'the old assignee-scoped worklog query must be gone');
assert.ok(/const c = new Date\(n\.spentAt\)/.test(src),
  'spentAt must become a LOCAL date, not a sliced UTC string');
assert.ok(/const iid = Number\(n\.issue\.iid\)/.test(src),
  'GraphQL returns iid as a string; it must be cast before the dedup compare');

// ── the dedup key must match what gets stored ──
// Entries are pushed with `pid`, so the lookup must read `pid`, not `project_id`.
assert.ok(/find\(e => e\.iid === iid && e\.pid === pid\)/.test(src), 'dedup must compare pid');
assert.ok(!/\$\{e\.project_id\}/.test(src), 'e.project_id is always undefined — must use e.pid');

// ── local-date helper: the actual arithmetic, run ──
const pad2 = n => String(n).padStart(2, '0');
const local = ts => { const c = new Date(ts); return `${c.getFullYear()}-${pad2(c.getMonth()+1)}-${pad2(c.getDate())}`; };

// GitLab returns spentAt with a real offset. Slicing "2026-08-24T00:00:00+06:00"
// to 10 chars happens to work; parsing it and reading UTC would give Aug 23.
assert.strictEqual(local('2026-08-24T00:00:00+06:00'), '2026-08-24', 'midnight +06:00 must stay on its own day');
assert.strictEqual(local('2026-08-12T12:00:00+06:00'), '2026-08-12');

// ── month range covers the last day (28/29/30/31) ──
const endOf = (y, m) => pad2(new Date(y, m + 1, 0).getDate());
assert.strictEqual(endOf(2026, 7), '31', 'August has 31 days');
assert.strictEqual(endOf(2026, 1), '28', 'Feb 2026 has 28');
assert.strictEqual(endOf(2028, 1), '29', 'Feb 2028 is a leap year');

// ── week chart must not drop days across a month boundary ──
assert.ok(!/if \(d\.getMonth\(\) !== month \|\| d\.getDate\(\) > todayDate\) continue;/.test(src),
  'the week chart must not skip days that fall in the previous month');
assert.ok(/const prevMap =/.test(src), 'the week chart must load the previous month for boundary days');

// On Aug 3, the trailing 7 days reach back into July — all 7 must survive.
const now = new Date(2026, 7, 3);
let days = 0;
for (let back = 6; back >= 0; back--) { const d = new Date(now); d.setDate(now.getDate() - back); days++; }
assert.strictEqual(days, 7, 'a 7-day window must always yield 7 bars');

console.log('daymap: all checks passed');

// ── duration parser ──
// Guards every logged entry: a string it misreads as 0 silently logs nothing.
const ps = src.indexOf('function parseDurToSecs');
const parseDurToSecs = new Function(src.slice(ps, src.indexOf('\n}', ps) + 2) + '; return parseDurToSecs;')();
const H = 3600;
[['4h', 4*H], ['2h30m', 2*H + 30*60], ['45m', 45*60], ['1d', 8*H],
 ['0.5h', 1800], ['  8h  ', 8*H],
 ['4', 4*H],      // bare number = hours, else it parses to 0 and logs nothing
 ['1.5', 5400],
 ['', 0], ['abc', 0]
].forEach(([input, want]) =>
  assert.strictEqual(parseDurToSecs(input), want, `parseDurToSecs(${JSON.stringify(input)})`));

// Only one parser may exist — a second copy drifts out of sync with this one.
assert.ok(!/function parseSecsFromStr/.test(src), 'the duplicate duration parser must stay deleted');

console.log('duration parser: all checks passed');

// ── public holidays are not missing days ──
// isWeekend gates the "— missing —" row and the daily target. A gazetted holiday
// falling on a weekday must count as off, or Eid reads as a day you skipped work.
assert.ok(/if \(BD_HOLIDAYS\[dateKey\(year, month, d\)\]\) return true;/.test(src),
  'isWeekend must treat a gazetted holiday as a non-working day');
assert.ok((src.match(/await loadHolidays\(\)/g) || []).length >= 2,
  'the log and dashboard must await loadHolidays() — otherwise BD_HOLIDAYS is empty on a direct page load');

const holidays = require('./holidays.json').holidays;
assert.ok(Object.keys(holidays).length > 0, 'holidays.json must not be empty');
// Every key must be a real YYYY-MM-DD, since dateKey() builds the same shape.
for (const k of Object.keys(holidays)) {
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(k), `bad holiday key: ${k}`);
  const [y, m, d] = k.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  assert.strictEqual(dt.getDate(), d, `not a real date: ${k}`);
}

// Aug 2026 carries two weekday holidays — the case that surfaced this bug.
assert.strictEqual(holidays['2026-08-05'], 'July Mass-uprising Day');
assert.strictEqual(holidays['2026-08-26'], 'Eid-e-Milad-un-Nabi');

console.log('holidays: all checks passed');

// ── cached HTML must never be the only render ──
// The bug: loadMonthlyLogIfNeeded painted sessionStorage HTML and returned, so a
// logic change (holidays) never reached anyone with a warm cache. Each *IfNeeded
// may paint from cache, but must still call its loader to refresh behind it.
for (const [fn, loader] of [
  ['loadMonthlyLogIfNeeded', 'loadMonthlyLog'],
  ['loadTimeReportIfNeeded', 'loadTimeReport'],
  ['loadActivityIfNeeded',   'loadActivity'],
]) {
  const i = src.indexOf('function ' + fn);
  assert.ok(i > 0, `${fn} not found`);
  const body = src.slice(i, src.indexOf('\n}', i));
  assert.ok(body.includes(loader + '('), fn + ' must call ' + loader + '() to refresh');
  // The loader call must be REACHABLE: an early return inside the cache-hit
  // branch is the exact shape of the bug and still 'contains' the call.
  const callAt = body.indexOf(loader + '(');
  const retAt  = body.indexOf('return;');
  assert.ok(retAt === -1 || retAt > callAt,
    fn + ' must not early-return before calling ' + loader + '()');
}

console.log('cache refresh: all checks passed');
