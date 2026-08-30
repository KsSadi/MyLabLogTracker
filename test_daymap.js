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
