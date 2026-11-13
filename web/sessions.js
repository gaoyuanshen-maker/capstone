const STALE_MS = 15000;
const run = (db, sql, args = []) => new Promise((resolve, reject) => db.run(sql, args, function(err) { err ? reject(err) : resolve(this); }));
const all = (db, sql, args = []) => new Promise((resolve, reject) => db.all(sql, args, (err, rows) => err ? reject(err) : resolve(rows)));

function createSessions(db) {
  let active = null;
  let queue = (async () => {
    await run(db, `CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY, started_at INTEGER NOT NULL,
      ended_at INTEGER, last_seen_at INTEGER NOT NULL,
      end_reason TEXT
    )`);
    await run(db, 'CREATE INDEX IF NOT EXISTS sessions_start ON sessions(started_at)');
    // An interrupted process cannot establish presence during its downtime.
    await run(db, "UPDATE sessions SET ended_at = last_seen_at, end_reason = 'interrupted' WHERE ended_at IS NULL");
  })();
  function ingest(status, now) {
    queue = queue.then(async () => {
      if (active && now - active.last > STALE_MS) {
        await run(db, "UPDATE sessions SET ended_at = last_seen_at, end_reason = 'signal_lost' WHERE id = ?", [active.id]);
        active = null;
      }
      if (status === 'VACANT') {
        if (active) {
          await run(db, "UPDATE sessions SET ended_at = ?, end_reason = 'vacant' WHERE id = ?", [now, active.id]);
          active = null;
        }
      } else if (!active) {
        const result = await run(db, 'INSERT INTO sessions(started_at, last_seen_at) VALUES (?, ?)', [now, now]);
        active = {id: result.lastID, last: now};
      } else {
        await run(db, 'UPDATE sessions SET last_seen_at = ? WHERE id = ?', [now, active.id]);
        active.last = now;
      }
    });
    return queue;
  }
  async function report(period, zone, now = Date.now()) {
    await queue;
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
    const date = (t) => {
      const p = Object.fromEntries(fmt.formatToParts(t).map(p => [p.type, p.value]));
      return `${p.year}-${p.month}-${p.day}`;
    };
    const midnight = (day) => {
      const target = Date.parse(day + 'T00:00:00Z');
      const full = new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
      let t = target;
      for (let i = 0; i < 4; i++) {
        const p = Object.fromEntries(full.formatToParts(t).map(p => [p.type, p.value]));
        t += target - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
      }
      return t;
    };
    const today = Date.parse(date(now) + 'T00:00:00Z');
    const startDay = period === 'week' ? today - ((new Date(today).getUTCDay() + 6) % 7) * 86400000 : today;
    const count = period === 'week' ? 7 : 1;
    const days = Array.from({length: count + 1}, (_, i) => new Date(startDay + i * 86400000).toISOString().slice(0, 10));
    const bounds = days.map(midnight);
    const rows = await all(db, 'SELECT * FROM sessions WHERE started_at < ? AND COALESCE(ended_at, last_seen_at + ?) >= ? ORDER BY started_at DESC', [bounds.at(-1), STALE_MS, bounds[0]]);
    const endOf = r => r.ended_at ?? (now - r.last_seen_at <= STALE_MS ? now : r.last_seen_at);
    const clips = (a, b) => rows.flatMap(r => {
      const start = Math.max(a, r.started_at), end = Math.min(b, now, endOf(r));
      // A single observed presence still counts, even if its measured duration is zero.
      const startsHere = r.started_at >= a && r.started_at < b && r.started_at <= now;
      if (end < start || (end === start && !startsHere)) return [];
      return [{id: r.id, started_at: start, ended_at: end,
        ongoing: r.ended_at === null && now - r.last_seen_at <= STALE_MS,
        end_reason: r.end_reason ?? (now - r.last_seen_at > STALE_MS ? 'signal_lost' : null)}];
    });
    const summarize = entries => ({total_seconds: entries.reduce((n, r) => n + (r.ended_at - r.started_at) / 1000, 0), session_count: entries.length, longest_seconds: Math.max(0, ...entries.map(r => (r.ended_at - r.started_at) / 1000))});
    const entries = clips(bounds[0], bounds.at(-1));
    return {period, time_zone: zone, generated_at: now, ...summarize(entries), sessions: entries, days: days.slice(0, -1).map((date, i) => ({date, ...summarize(clips(bounds[i], bounds[i + 1]))}))};
  }
  return {ingest, report, ready: () => queue};
}
module.exports = {createSessions};
