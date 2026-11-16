// ============================================================
//  ห่อ D1 + ตัวแปลง "แผนการเขียน" (ops) → คำสั่ง SQL ชุดเดียว             v2/server/db.mjs
//  action ไม่เขียน SQL เขียนข้อมูลเอง — คืน ops ให้ตัวกลางแปลง จึงได้ของเหล่านี้ทุก action โดยไม่ต้องจำ:
//    · optimistic version (ด่าน _guard ใน batch เดียวกัน — สองคนกดพร้อมกัน คนหลังล้มทั้งชุด)
//    · แถว audit_log ต่อทุก op (ค่าก่อน/หลัง) · คำสั่งพลิกกลับสำหรับปุ่ม "ย้อน" (คิดตอนบันทึก)
//    · ไม่มี DELETE เด็ดขาด (ตัวแปลงไม่มีทางสร้าง · D1 จำลองในเทสต์ปฏิเสธ · trigger ในฐานกันอีกชั้น)
// ============================================================
import { Fail, bad, conflict, iso, thaiDay } from "./core.mjs";

export function wrapDb(d1) {
  const prep = (sql, args) => d1.prepare(sql).bind(...(args || []));
  return {
    raw: d1,
    all: async (sql, ...a) => (await prep(sql, a).all()).results || [],
    first: async (sql, ...a) => (await prep(sql, a).first()) || null,
    /** หลายคำสั่งอ่านในรอบเดียว (D1 batch) → [[แถว…], [แถว…]] */
    reads: async list => (await d1.batch(list.map(([sql, ...a]) => prep(sql, a)))).map(r => r.results || []),
    /** ชุดคำสั่งเขียน — สำเร็จทั้งชุดหรือไม่มีอะไรเกิดขึ้นเลย */
    batch: async list => d1.batch(list.map(([sql, ...a]) => prep(sql, a))),
  };
}

// ---- ทะเบียนตาราง: คีย์หลัก · ค่าที่ "ย้อนการเพิ่มแถว" (พลิกสถานะ) · มี updated_at ไหม ----
//   โมดูลที่เพิ่มตารางใหม่: registerTable('ชื่อ', {...}) ในไฟล์ action ของตัวเอง
export const TABLES = {
  settings: { pk: "key", created: false },
  staff: { pk: "id", void: { status: "พัก" } },
  customers: { pk: "id", void: { status: "พัก" } },
  routes: { pk: "code", void: { active: 0 } },
  products: { pk: "id", void: { status: "เลิกขาย" } },
  orders: { pk: "id", void: { status: "ยกเลิก" } },
  order_items: { pk: "id", void: { status: "ยกเลิก" } },
  machines: { pk: "id", void: { status: "เลิกใช้" } },
  production_jobs: { pk: "id", void: { status: "ยกเลิก" } },
  machine_runs: { pk: "id", void: { status: "ยกเลิก" } },
  machine_events: { pk: "id", void: { status: "ยกเลิก" } },
  screen_jobs: { pk: "id", void: { status: "ยกเลิก" } },
  vehicles: { pk: "id", void: { active: 0 } },
  delivery_trips: { pk: "id", void: { status: "ยกเลิก" } },
  delivery_loads: { pk: "id", void: { status: "ยกเลิก" } },
  bills: { pk: "bill_no", void: { status: "ยกเลิก" } },
  bill_payments: { pk: "id", void: { status: "ยกเลิก" } },
  statements: { pk: "stmt_no", void: { status: "ยกเลิก" } },
  flags: { pk: "id", void: { status: "ปิด" } },
  undo_log: { pk: "id" },
  sync_runs: { pk: "id", stamp: false },
  devices: { pk: "id", void: { status: "เลิกใช้" } },
};
export function registerTable(name, meta) { TABLES[name] = Object.assign({ pk: "id" }, meta); }
const meta = t => { const m = TABLES[t]; if (!m) throw new Error("ตาราง " + t + " ยังไม่ได้ลงทะเบียนใน TABLES (server/db.mjs)"); return m; };
const IDENT = /^[a-z_][a-z0-9_]*$/;
const ident = s => { if (!IDENT.test(s)) throw new Error("ชื่อคอลัมน์/ตารางไม่ถูกต้อง: " + s); return s; };
const GUARD_MARK = "CHECK constraint failed: code = ''";

/** ด่านในชุดคำสั่ง: ถ้า "ไม่มีแถว ... ตามเงื่อนไข" = ล้มทั้งชุด (ใช้ตอน optimistic version / ของต้องยังอยู่สถานะเดิม) */
export function guardSql(existsSql, args, tag) {
  return [`INSERT INTO _guard(code) SELECT ? WHERE NOT EXISTS (${existsSql})`, tag || "g", ...args];
}

/**
 * แปลง ops → { stmts, inverse, audits }
 *   insert  {op, table, row, undo?:false}
 *   update  {op, table, id, set, expect(version ที่ผู้ใช้เห็น), before(แถวเดิม — ใช้ทำ audit/ย้อน)}
 *   move    {op, item_key, label, grade, qty_pcs, move_type, ref_entity, ref_id, reason}   ← ลงสมุดสต๊อก (ยอดคงเหลือขยับเองด้วย trigger)
 *   unmove  {op, item_key, grade, qty_pcs, ref_entity, ref_id}                          ← กลับทิศแถวสมุดที่ตรงกัน (ใช้ตอนย้อน)
 *   flag    {op, kind, title, detail, entity, entity_id, team, severity, dedupe_key}    ← ธงให้คนตรวจ (ไม่บล็อกงาน)
 */
export function compileOps(X, ops) {
  const at = iso(X.now), day = thaiDay(X.now), by = X.staff ? X.staff.id : "system";
  const stmts = [], inverse = [], audits = [];
  let undoable = true;
  for (const o of ops) {
    if (o.op === "insert") {
      const m = meta(o.table);
      const row = Object.assign({}, o.row);
      if (m.stamp !== false) {
        if (m.created !== false && !("created_at" in row)) row.created_at = at;
        const sc = m.stamp || "updated_at";
        if (!(sc in row)) row[sc] = at;
      }
      const cols = Object.keys(row).map(ident);
      stmts.push([`INSERT INTO ${ident(o.table)}(${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, ...cols.map(c => row[c])]);
      audits.push({ entity: o.table, entity_id: String(row[m.pk]), before: "", after: row });
      if (o.undo === false) continue;
      if (!m.void) { undoable = false; continue; }
      inverse.push({ op: "update", table: o.table, id: row[m.pk], set: m.void, expect: 1, before: pick(row, Object.keys(m.void)) });
    } else if (o.op === "update") {
      const m = meta(o.table);
      if (!Number.isInteger(o.expect) || o.expect < 1) throw new Error("update " + o.table + " ต้องมี expect (version)");
      const set = Object.assign({}, o.set);
      const keys = Object.keys(set).map(ident);
      if (!keys.length) continue;
      const stampCol = m.stamp === false ? null : (m.stamp || "updated_at");
      const pk = ident(m.pk);
      stmts.push(guardSql(`SELECT 1 FROM ${ident(o.table)} WHERE ${pk} = ? AND version = ?`, [o.id, o.expect], "v"));
      stmts.push([`UPDATE ${ident(o.table)} SET ${keys.map(k => k + " = ?").join(", ")}, version = version + 1` + (stampCol ? `, ${stampCol} = ?` : "") + ` WHERE ${pk} = ? AND version = ?`,
        ...keys.map(k => set[k]), ...(stampCol ? [at] : []), o.id, o.expect]);
      const before = o.before ? pick(o.before, keys) : null;
      audits.push({ entity: o.table, entity_id: String(o.id), before: before || "", after: set });
      if (o.undo === false) continue;
      if (!before) { undoable = false; continue; }
      inverse.push({ op: "update", table: o.table, id: o.id, set: before, expect: o.expect + 1, before: set });
    } else if (o.op === "move") {
      const q = o.qty_pcs;
      if (!Number.isInteger(q) || q === 0) throw new Error("move ต้องมี qty_pcs เป็นจำนวนเต็มไม่ใช่ 0");
      stmts.push([`INSERT INTO stock_moves(at, day, item_key, label, grade, qty_pcs, move_type, ref_entity, ref_id, by, reason, src) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        at, day, o.item_key, o.label || "", o.grade || "A", q, o.move_type, o.ref_entity || "", o.ref_id || "", by, o.reason || "", o.src || "v2"]);
      audits.push({ entity: "stock_moves", entity_id: o.ref_entity + ":" + o.ref_id, before: "", after: { item_key: o.item_key, grade: o.grade || "A", qty_pcs: q, move_type: o.move_type } });
      if (o.undo !== false) inverse.push({ op: "unmove", item_key: o.item_key, grade: o.grade || "A", qty_pcs: q, ref_entity: o.ref_entity || "", ref_id: o.ref_id || "" });
    } else if (o.op === "unmove") {
      const match = `SELECT id FROM stock_moves WHERE ref_entity = ? AND ref_id = ? AND item_key = ? AND grade = ? AND qty_pcs = ? AND reverses IS NULL AND move_type <> 'ย้อน'
        AND id NOT IN (SELECT reverses FROM stock_moves WHERE reverses IS NOT NULL) ORDER BY id DESC LIMIT 1`;
      const margs = [o.ref_entity, o.ref_id, o.item_key, o.grade, o.qty_pcs];
      stmts.push(guardSql(match, margs, "m"));
      stmts.push([`INSERT INTO stock_moves(at, day, item_key, label, grade, qty_pcs, move_type, ref_entity, ref_id, by, reason, reverses, src)
        SELECT ?, ?, item_key, label, grade, -qty_pcs, 'ย้อน', ref_entity, ref_id, ?, ?, id, 'v2' FROM stock_moves WHERE id = (${match})`, at, day, by, X.reason || "ย้อนรายการ", ...margs]);
      audits.push({ entity: "stock_moves", entity_id: o.ref_entity + ":" + o.ref_id, before: { qty_pcs: o.qty_pcs }, after: { qty_pcs: -o.qty_pcs, move_type: "ย้อน" } });
    } else if (o.op === "flag") {
      const id = o.id || ("F" + X.newId());
      const args = [id, at, day, o.kind, o.severity || "ดู", o.team || "", o.entity || "", String(o.entity_id || ""), o.title, o.detail || "", by, o.dedupe_key || null, X.reqKey || "", at, at];
      const sql = `INSERT INTO flags(id, at, day, kind, severity, team, entity, entity_id, title, detail, raised_by, dedupe_key, req_key, created_at, updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?`;
      stmts.push(o.dedupe_key ? [sql + ` WHERE NOT EXISTS (SELECT 1 FROM flags WHERE dedupe_key = ? AND status = 'เปิด')`, ...args, o.dedupe_key] : [sql, ...args]);
    } else {
      throw new Error("ไม่รู้จัก op: " + o.op);
    }
  }
  return { stmts, inverse: undoable ? inverse.reverse() : null, audits };
}
const pick = (o, keys) => { const r = {}; for (const k of keys) r[k] = o[k] === undefined ? null : o[k]; return r; };

/** แปลง error ของ D1 → ข้อความที่ผู้ใช้อ่านรู้เรื่อง (บอกสาเหตุจริง ไม่ใช่ "เน็ตมีปัญหา") */
export function translateDbError(e, def) {
  if (e instanceof Fail) return e;
  const msg = String((e && e.message) || e);
  if (msg.indexOf(GUARD_MARK) >= 0) return conflict();
  const raise = /(?:D1_ERROR: )+(.*)$/.exec(msg);
  const inner = raise ? raise[1] : msg;
  if (/[฀-๿]/.test(inner) && !/constraint failed/i.test(inner)) return bad(inner.replace(/^Error: /, ""));   // ข้อความไทยจาก trigger (ห้ามลบ · ค่าไม่อยู่ในรายการ)
  const uq = /UNIQUE constraint failed: ([\w., ]+)/.exec(msg);
  if (uq) {
    if (def && def.onUnique) { const f = def.onUnique(uq[1]); if (f) return f; }
    return conflict("รายการนี้มีอยู่แล้ว (ซ้ำกับ " + uq[1] + ") — โหลดใหม่แล้วดูอีกครั้ง");
  }
  if (/FOREIGN KEY constraint failed/i.test(msg)) return bad("อ้างถึงรายการที่ไม่มีในระบบ (อาจถูกเปลี่ยนไปแล้ว) — โหลดใหม่");
  if (/CHECK constraint failed/i.test(msg)) return bad("ข้อมูลไม่ผ่านเงื่อนไขของระบบ: " + msg.replace(/^.*CHECK constraint failed: /, "").slice(0, 160));
  if (/NOT NULL constraint failed: ([\w.]+)/.test(msg)) return bad("ข้อมูลขาดช่องที่จำเป็น: " + /NOT NULL constraint failed: ([\w.]+)/.exec(msg)[1]);
  return null;   // ไม่รู้จัก = ข้อผิดพลาดของระบบจริง (ชั้นบนตอบ 500 พร้อมบอกว่าเป็นที่หลังบ้าน)
}
export const isIdemDup = e => /UNIQUE constraint failed: idempotency\.key/.test(String((e && e.message) || e));
