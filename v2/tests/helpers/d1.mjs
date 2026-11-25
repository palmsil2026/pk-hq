// ============================================================
//  D1 จำลองสำหรับเทสต์/รันในเครื่อง (node:sqlite) — หน้าตาเดียวกับ D1 ของ Cloudflare เท่าที่ server/ ใช้:
//    db.prepare(sql).bind(...).first() / .all() → { results, meta } / .run() → { meta: { changes, last_row_id } }
//    db.batch([stmt…]) = ชุดเดียว สำเร็จทั้งชุด/ล้มทั้งชุด (เหมือน D1 จริง)
//  บังคับข้อจำกัดของ D1 จริงที่ sqlite ในเครื่องไม่มี (บทเรียนจากโรงน้ำ): LIKE ≤ 50 ไบต์ · ตัวแปร ≤ 100 ตัว/คำสั่ง
//  + นับรอบคุยกับฐาน (stats) ไว้เทสต์ "ปุ่มเดียวคุยกับฐานกี่รอบ"
//  ใช้ไฟล์จริงได้ (dev server) หรือในหน่วยความจำ (เทสต์)
// ============================================================
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.join(HERE, "..", "..", "db", "migrations");

function limits(sql, args) {
  if (args.length > 100) throw new Error("D1_ERROR: too many SQL variables (" + args.length + " > 100)");
  if (/\bLIKE\s+\?/i.test(sql)) throw new Error("D1_ERROR: ห้ามใช้ LIKE ? (D1 จำกัดรูปแบบ 50 ไบต์ — ใช้ instr() แทน)");
  for (const m of sql.matchAll(/\b(?:LIKE|GLOB)\s+'([^']*)'/gi)) {
    if (Buffer.byteLength(m[1], "utf8") > 50) throw new Error("D1_ERROR: LIKE or GLOB pattern too complex (" + m[1] + ")");
  }
  if (/^\s*DELETE\b/i.test(sql)) throw new Error("ห้ามใช้ DELETE ในระบบนี้ (พลิกสถานะแทน)");
}

export function makeD1(file) {
  const db = new DatabaseSync(file || ":memory:");
  db.exec("PRAGMA foreign_keys = ON");   // D1 เปิด foreign key เป็นค่าเริ่มต้น
  const stats = { rounds: 0, queries: 0, batches: 0 };
  const clean = a => a.map(v => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v));
  const exec = (sql, args) => {
    stats.queries++;
    limits(sql, args);
    const st = db.prepare(sql);
    if (/^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql) || /\bRETURNING\b/i.test(sql)) {
      const rows = st.all(...args).map(r => ({ ...r }));
      return { success: true, results: rows, meta: { changes: /^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql) ? 0 : rows.length } };
    }
    const r = st.run(...args);
    return { success: true, results: [], meta: { changes: Number(r.changes) || 0, last_row_id: Number(r.lastInsertRowid) || 0 } };
  };
  const wrapErr = e => { const x = new Error("D1_ERROR: " + (e && e.message || e)); x.cause = e; return x; };
  const stmt = (sql, args) => ({
    sql, args,
    bind: (...a) => stmt(sql, clean(a)),
    first: async col => { stats.rounds++; try { const r = exec(sql, args).results[0] || null; return col && r ? r[col] : r; } catch (e) { throw wrapErr(e); } },
    all: async () => { stats.rounds++; try { return exec(sql, args); } catch (e) { throw wrapErr(e); } },
    run: async () => { stats.rounds++; try { return exec(sql, args); } catch (e) { throw wrapErr(e); } },
  });
  return {
    stats, raw: db,
    prepare: sql => stmt(sql, []),
    batch: async list => {
      stats.rounds++; stats.batches++;
      db.exec("BEGIN");
      try { const out = list.map(s => exec(s.sql, s.args || [])); db.exec("COMMIT"); return out; }
      catch (e) { db.exec("ROLLBACK"); throw wrapErr(e); }
    },
    exec: async sql => { db.exec(sql); return { count: 1 }; },
    /** ตัวช่วยเทสต์: อ่านตรง ๆ ไม่นับรอบ */
    q: (sql, ...args) => db.prepare(sql).all(...args).map(r => ({ ...r })),
    one: (sql, ...args) => { const r = db.prepare(sql).get(...args); return r ? { ...r } : null; },
    close: () => db.close(),
  };
}

/** ใส่ migration ทุกไฟล์ตามลำดับ (จดในตาราง d1_migrations แบบเดียวกับ wrangler) — รันซ้ำได้ ข้ามไฟล์ที่ใส่แล้ว */
export function migrate(d1, dir) {
  const raw = d1.raw;
  raw.exec("CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)");
  const done = new Set(raw.prepare("SELECT name FROM d1_migrations").all().map(r => r.name));
  const files = fs.readdirSync(dir || MIGRATIONS_DIR).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort();
  const applied = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir || MIGRATIONS_DIR, f), "utf8");
    raw.exec("BEGIN");
    try { raw.exec(sql); raw.prepare("INSERT INTO d1_migrations(name) VALUES (?)").run(f); raw.exec("COMMIT"); }
    catch (e) { raw.exec("ROLLBACK"); throw new Error("migration " + f + " ล้ม: " + e.message); }
    applied.push(f);
  }
  return applied;
}

export function freshDb(file) {
  const d1 = makeD1(file);
  migrate(d1);
  return d1;
}
