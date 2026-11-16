// ============================================================
//  ออฟฟิศ — ทะเบียนลูกค้า: เพิ่ม (กันชื่อซ้ำแบบหลวม) · แก้ (มีประวัติ) · ยืนยันรายที่นำเข้ามา · รวมรายซ้ำ (ไม่ลบแถว)   v2/server/actions/office-customers.mjs
//  PALM-WAY §5: ลูกค้าต้องไม่เพี้ยน — ชื่อจับคู่หลวม (nameKey ชุดเดียวกับ GAS normName_) · ชื่องานไม่ปนชื่อลูกค้า · รวม = merged_into ไม่ลบ
// ============================================================
import { bad, conflict, notFound, need, text, int, oneOf, iso } from "../core.mjs";
import { registerTable } from "../db.mjs";
import { nameKey } from "../import/legacy.mjs";
import { ROLES_OFFICE } from "./office-orders.mjs";

registerTable("customer_aliases", { pk: "alias_key", stamp: false });

const STATUS = ["ใช้งาน", "พัก", "เลิกกิจการ"];
function fields(raw, partial) {
  const f = {};
  const put = (k, v) => { if (!partial || raw[k] !== undefined) f[k] = v; };
  if (!partial || raw.name !== undefined) { f.name = need(raw.name, "ชื่อลูกค้า", 120); f.name_key = nameKey(f.name); if (/^.+?\s+งาน\S/.test(f.name)) throw bad("ชื่อลูกค้ามีชื่องานปนอยู่ — ใส่ชื่องานในช่อง \"ชื่องาน/แบรนด์\" ของออเดอร์แทน"); }
  put("phone", text(raw.phone, 40, "เบอร์"));
  put("district", text(raw.district, 60, "อำเภอ"));
  put("subdistrict", text(raw.subdistrict, 60, "ตำบล"));
  put("address", text(raw.address, 300, "ที่อยู่"));
  put("map_url", text(raw.map_url, 400, "ลิงก์แผนที่"));
  put("note", text(raw.note, 300, "หมายเหตุการค้า"));
  put("route_code", text(raw.route_code, 10) || null);
  put("credit_days", raw.credit_days === undefined || raw.credit_days === "" || raw.credit_days === null ? 0 : int(raw.credit_days, "เครดิต (วัน)", { min: 0, max: 365 }));
  if (raw.status !== undefined) f.status = oneOf(raw.status, STATUS, "สถานะลูกค้า");
  return f;
}

export function defineOfficeCustomers(R) {
  R.define({
    name: "office.customer_create", roles: ROLES_OFFICE, write: true,
    input: raw => fields(raw, false),
    async load(X, input) {
      const [dup, route] = await X.db.reads([["SELECT id, name FROM customers WHERE name_key = ? AND merged_into IS NULL LIMIT 1", input.name_key], ["SELECT code FROM routes WHERE code = ?", input.route_code || "-"]]);
      return { dup: dup[0], route: route[0] };
    },
    async run(X, input, ctx) {
      if (ctx.dup) throw conflict("มี \"" + ctx.dup.name + "\" ในทะเบียนแล้ว — ใช้รายเดิม", { customer_id: ctx.dup.id });
      if (input.route_code && !ctx.route) throw bad("ไม่รู้จักสาย " + input.route_code);
      const id = "C" + X.newId();
      return { label: "เพิ่มลูกค้า " + input.name, result: { id, name: input.name }, ops: [{ op: "insert", table: "customers", row: { id, ...input, src: "v2" } }] };
    },
  });

  R.define({
    name: "office.customer_update", roles: ROLES_OFFICE, write: true,
    input: raw => ({ id: need(raw.id, "ลูกค้า", 40), version: int(raw.version, "รุ่นของรายการ", { min: 1 }), f: fields(raw, true) }),
    async load(X, input) {
      const [c, dup, route] = await X.db.reads([["SELECT * FROM customers WHERE id = ?", input.id],
        ["SELECT id, name FROM customers WHERE name_key = ? AND merged_into IS NULL AND id <> ? LIMIT 1", input.f.name_key || "-", input.id],
        ["SELECT code FROM routes WHERE code = ?", input.f.route_code || "-"]]);
      if (!c[0]) throw notFound("ไม่พบลูกค้านี้");
      return { c: c[0], dup: dup[0], route: route[0] };
    },
    async run(X, input, ctx) {
      if (ctx.c.version !== input.version) throw conflict();
      if (ctx.c.merged_into) throw conflict("ลูกค้ารายนี้ถูกรวมเข้ากับรายอื่นแล้ว — แก้ที่รายหลัก");
      if (ctx.dup) throw conflict("ชื่อนี้ซ้ำกับ \"" + ctx.dup.name + "\" ในทะเบียน — ถ้าเป็นเจ้าเดียวกันให้กด \"รวมกับรายอื่น\"", { customer_id: ctx.dup.id });
      if (input.f.route_code && !ctx.route) throw bad("ไม่รู้จักสาย " + input.f.route_code);
      const set = {};
      for (const [k, v] of Object.entries(input.f)) if (String(v ?? "") !== String(ctx.c[k] ?? "")) set[k] = v;
      if (!Object.keys(set).length) throw bad("ไม่มีอะไรเปลี่ยน");
      return { label: "แก้ข้อมูลลูกค้า " + ctx.c.name, result: { id: input.id }, ops: [{ op: "update", table: "customers", id: input.id, expect: input.version, before: ctx.c, set }] };
    },
  });

  // รายที่ตัวนำเข้าสร้างไว้ "รอตรวจ" (จับคู่ไม่ติด) → ยืนยันว่าเป็นลูกค้าใหม่จริง
  R.define({
    name: "office.customer_confirm", roles: ROLES_OFFICE, write: true,
    input: raw => ({ id: need(raw.id, "ลูกค้า", 40), version: int(raw.version, "รุ่นของรายการ", { min: 1 }) }),
    async load(X, input) { const c = await X.db.first("SELECT * FROM customers WHERE id = ?", input.id); if (!c) throw notFound("ไม่พบลูกค้านี้"); return { c }; },
    async run(X, input, ctx) {
      if (ctx.c.version !== input.version) throw conflict();
      if (!ctx.c.needs_review) throw bad("ลูกค้ารายนี้ยืนยันแล้ว");
      return { label: "ยืนยันลูกค้า " + ctx.c.name, result: { id: input.id }, ops: [{ op: "update", table: "customers", id: input.id, expect: input.version, before: ctx.c, set: { needs_review: 0 } }] };
    },
  });

  // รวมรายซ้ำ: ออเดอร์/บิลย้ายไปรายหลัก · ชื่อเดิมเป็น "ชื่ออื่น" ของรายหลัก (นำเข้ารอบหน้าจับคู่ตรง) · แถวเดิมคงอยู่ (merged_into)
  R.define({
    name: "office.customer_merge", roles: ROLES_OFFICE, write: true, reason: "optional",
    input: raw => ({ id: need(raw.id, "ลูกค้าที่จะรวม", 40), version: int(raw.version, "รุ่นของรายการ", { min: 1 }), into: need(raw.into, "ลูกค้ารายหลัก", 40) }),
    async load(X, input) {
      const [c, t, orders, bills, al] = await X.db.reads([["SELECT * FROM customers WHERE id = ?", input.id], ["SELECT * FROM customers WHERE id = ?", input.into],
        ["SELECT * FROM orders WHERE customer_id = ?", input.id], ["SELECT * FROM bills WHERE customer_id = ?", input.id],
        ["SELECT a.alias_key FROM customer_aliases a JOIN customers c ON c.id = ? AND a.alias_key = c.name_key", input.id]]);
      if (!c[0] || !t[0]) throw notFound("ไม่พบลูกค้า");
      return { c: c[0], t: t[0], orders, bills, aliased: al.length > 0 };
    },
    async run(X, input, ctx) {
      const { c, t } = ctx;
      if (c.version !== input.version) throw conflict();
      if (c.id === t.id) throw bad("เลือกรายหลักเป็นคนละรายกัน");
      if (c.merged_into) throw conflict("รายนี้ถูกรวมไปแล้ว");
      if (t.merged_into) throw bad("รายหลักที่เลือกถูกรวมเข้ารายอื่นแล้ว — เลือกรายที่ยังใช้งาน");
      if (ctx.orders.length + ctx.bills.length > 300) throw bad("รายนี้มีออเดอร์/บิลเกิน 300 ใบ — ให้ผู้ดูแลรวมให้");
      const ops = [{ op: "update", table: "customers", id: c.id, expect: c.version, before: c, set: { merged_into: t.id, needs_review: 0, status: "พัก" } }];
      ctx.orders.forEach(o => ops.push({ op: "update", table: "orders", id: o.id, expect: o.version, before: o, set: { customer_id: t.id } }));
      ctx.bills.forEach(b => ops.push({ op: "update", table: "bills", id: b.bill_no, expect: b.version, before: b, set: { customer_id: t.id } }));
      if (c.name_key !== t.name_key && !ctx.aliased) ops.push({ op: "insert", table: "customer_aliases", undo: false, row: { alias_key: c.name_key, alias: c.name, customer_id: t.id, src: "v2", created_at: iso(X.now) } });
      // ช่องที่รายหลักยังว่าง เติมจากรายที่รวม (ไม่ทับของเดิม)
      const fill = {};
      for (const k of ["phone", "district", "subdistrict", "address", "map_url", "note", "route_code"]) if (!t[k] && c[k]) fill[k] = c[k];
      if (Object.keys(fill).length) ops.push({ op: "update", table: "customers", id: t.id, expect: t.version, before: t, set: fill });
      return { label: "รวม " + c.name + " เข้ากับ " + t.name, result: { id: t.id, moved: { orders: ctx.orders.length, bills: ctx.bills.length } }, ops,
        conflictMessage: "มีคนแก้ลูกค้า/ออเดอร์ของรายนี้ไปพร้อมกัน — โหลดใหม่แล้วลองอีกครั้ง" };
    },
    onUnique: () => conflict("ชื่อนี้เป็นชื่ออื่นของลูกค้ารายอื่นอยู่แล้ว"),
  });
}
