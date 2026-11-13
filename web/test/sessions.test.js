const {test} = require('node:test');
const assert = require('node:assert/strict');
const sqlite = require('sqlite3');
const {createSessions} = require('../sessions');
test('presence transitions, interruption, gap and timezone clipping', async () => {
 const db = new sqlite.Database(':memory:');
 const s = createSessions(db);
 const t = Date.parse('2026-11-12T14:59:50Z'); // Tokyo midnight in ten seconds
 await s.ingest('NORMAL', t);
 await s.ingest('VIOLATION', t + 10000);
 await s.ingest('NORMAL', t + 20000);
 await s.ingest('VACANT', t + 25000);
 let r = await s.report('day', 'Asia/Tokyo', t + 30000);
 assert.equal(r.total_seconds, 15); assert.equal(r.session_count, 1);
 r = await s.report('week', 'Asia/Tokyo', t + 30000);
 assert.equal(r.total_seconds, 25); assert.equal(r.days.length, 7);
 await s.ingest('NORMAL', t + 30000);
 r = await s.report('day', 'Asia/Tokyo', t + 35000);
 assert.equal(r.total_seconds, 20); assert.equal(r.session_count, 2);
 r = await s.report('day', 'Asia/Tokyo', t + 60000);
 assert.equal(r.total_seconds, 15); // stale session cannot grow
 await s.ingest('NORMAL', t + 60000);
 await s.ingest('NORMAL', t + 65000);
 const restarted = createSessions(db); await restarted.ready();
 r = await restarted.report('day', 'Asia/Tokyo', t + 120000);
 assert.equal(r.total_seconds, 20);
 assert.equal(r.session_count, 3); // includes a zero-duration observed session
 assert.equal(r.sessions.filter(x => x.ongoing).length, 0);
 await assert.rejects(s.report('day', 'Invalid/Zone'));
 await new Promise(resolve => db.close(resolve));
});
test('DST days use calendar boundaries rather than 24 hour offsets', async () => {
 const db = new sqlite.Database(':memory:'); const s = createSessions(db);
 const start = Date.parse('2026-03-08T05:00:00Z');
 await s.ready();
 await new Promise((resolve,reject) => db.run('INSERT INTO sessions(started_at, ended_at, last_seen_at) VALUES (?, ?, ?)', [start,start+23*3600000,start+23*3600000], e=>e?reject(e):resolve()));
 const r = await s.report('day','America/New_York',start+23*3600000-1);
 assert.equal(Math.round(r.total_seconds),23*3600);
 await new Promise(resolve=>db.close(resolve));
});
