// ============================================================
//  D1 บน sql.js (SQLite ที่รันในเบราว์เซอร์) — หน้าตาเดียวกับ tests/helpers/d1.mjs ทุกอย่างที่ server/ ใช้   v2/tools/demo/d1-sqljs.mjs
//    db.prepare(sql).bind(...).first() / .all() → { results, meta } / .run() → { meta: { changes, last_row_id } }
//    db.batch([stmt…]) = ชุดเดียว สำเร็จทั้งชุด/ล้มทั้งชุด · q()/one() = อ่านตรงแบบ sync (ตัว seed ใช้)
//  ใช้เฉพาะเดโมในเบราว์เซอร์ (tools/build-demo.mjs) — ของจริงใช้ D1 · เครื่องนักพัฒนาใช้ node:sqlite
//  บังคับข้อจำกัดของ D1 จริงชุดเดียวกับ tests/helpers/d1.mjs (LIKE ≤ 50 ไบต์ · ตัวแปร ≤ 100 · ห้าม DELETE)
// ============================================================
const enc = new TextEncoder();

function limits(sql, args) {
  if (args.length > 100) throw new Error("D1_ERROR: too many SQL variables (" + args.length + " > 100)");
  if (/\bLIKE\s+\?/i.test(sql)) throw new Error("D1_ERROR: ห้ามใช้ LIKE ? (D1 จำกัดรูปแบบ 50 ไบต์ — ใช้ instr() แทน)");
  for (const m of sql.matchAll(/\b(?:LIKE|GLOB)\s+'([^']*)'/gi)) {
    if (enc.encode(m[1]).length > 50) throw new Error("D1_ERROR: LIKE or GLOB pattern too complex (" + m[1] + ")");
  }
  if (/^\s*DELETE\b/i.test(sql)) throw new Error("ห้ามใช้ DELETE ในระบบนี้ (พลิกสถานะแทน)");
}

/** SQL = ผลของ initSqlJs() · bytes = ไฟล์ฐานเดิม (Uint8Array) หรือไม่ใส่ = ฐานใหม่ · onWrite = เรียกเมื่อมีการเขียน (ไว้บันทึกลงเครื่อง) */
export function makeD1(SQL, bytes, onWrite) {
  let db = bytes ? new SQL.Database(bytes) : new SQL.Database();
  const pragma = () => db.exec("PRAGMA foreign_keys = ON");   // D1 เปิด foreign key เป็นค่าเริ่มต้น (export() ของ sql.js รีเซ็ต pragma — ตั้งใหม่ทุกครั้ง)
  pragma();
  const stats = { rounds: 0, queries: 0, batches: 0 };
  const clean = a => a.map(v => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : typeof v === "bigint" ? Number(v) : v));
  const rowsOf = (sql, args) => {
    const st = db.prepare(sql);
    try {
      if (args.length) st.bind(args);
      const out = [];
      while (st.step()) out.push(st.getAsObject());
      return out;
    } finally { st.free(); }
  };
  const isRead = sql => /^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql);
  const exec = (sql, args) => {
    stats.queries++;
    limits(sql, args);
    if (isRead(sql) && !/\bRETURNING\b/i.test(sql)) return { success: true, results: rowsOf(sql, args), meta: { changes: 0 } };
    if (/\bRETURNING\b/i.test(sql)) {
      const rows = rowsOf(sql, args);
      if (!isRead(sql) && onWrite) onWrite();
      return { success: true, results: rows, meta: { changes: rows.length } };
    }
    const st = db.prepare(sql);
    try { if (args.length) st.bind(args); st.step(); } finally { st.free(); }
    const changes = db.getRowsModified();
    let last = 0;
    if (/^\s*(INSERT|REPLACE)\b/i.test(sql)) { const r = db.exec("SELECT last_insert_rowid() AS id"); last = r.length ? Number(r[0].values[0][0]) || 0 : 0; }
    if (onWrite) onWrite();
    return { success: true, results: [], meta: { changes, last_row_id: last } };
  };
  const wrapErr = e => { const x = new Error("D1_ERROR: " + (e && e.message || e)); x.cause = e; return x; };
  const stmt = (sql, args) => ({
    sql, args,
    bind: (...a) => stmt(sql, clean(a)),
    first: async col => { stats.rounds++; try { const r = exec(sql, args).results[0] || null; return col && r ? r[col] : r; } catch (e) { throw wrapErr(e); } },
    all: async () => { stats.rounds++; try { return exec(sql, args); } catch (e) { throw wrapErr(e); } },
    run: async () => { stats.rounds++; try { return exec(sql, args); } catch (e) { throw wrapErr(e); } },
  });
  const api = {
    stats,
    prepare: sql => stmt(sql, []),
    batch: async list => {
      stats.rounds++; stats.batches++;
      db.exec("BEGIN");
      try { const out = list.map(s => exec(s.sql, clean(s.args || []))); db.exec("COMMIT"); return out; }
      catch (e) { try { db.exec("ROLLBACK"); } catch (e2) { /* ไม่มีชุดค้าง */ } throw wrapErr(e); }
    },
    exec: async sql => { db.exec(sql); if (onWrite) onWrite(); return { count: 1 }; },
    /** อ่านตรง ๆ ไม่นับรอบ (ตัว seed ใช้) */
    q: (sql, ...args) => rowsOf(sql, clean(args)),
    one: (sql, ...args) => rowsOf(sql, clean(args))[0] || null,
    /** รันหลายคำสั่งในชุดเดียว (migration) */
    script: sql => db.exec(sql),
    /** ไฟล์ฐานทั้งก้อน (เก็บลงเครื่อง) */
    export: () => { const b = db.export(); pragma(); return b; },
    close: () => db.close(),
  };
  return api;
}

/** ใส่ migration ตามลำดับชื่อ (จดใน d1_migrations แบบ wrangler) — files = [[ชื่อ, sql], …] · รันซ้ำได้ ข้ามไฟล์ที่ใส่แล้ว */
export function migrate(d1, files) {
  d1.script("CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)");
  const done = new Set(d1.q("SELECT name FROM d1_migrations").map(r => r.name));
  const applied = [];
  for (const [name, sql] of files.slice().sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (done.has(name)) continue;
    d1.script("BEGIN");
    try { d1.script(sql); d1.script("INSERT INTO d1_migrations(name) VALUES ('" + name.replace(/'/g, "''") + "')"); d1.script("COMMIT"); }
    catch (e) { try { d1.script("ROLLBACK"); } catch (e2) { /* */ } throw new Error("migration " + name + " ล้ม: " + e.message); }
    applied.push(name);
  }
  return applied;
}
