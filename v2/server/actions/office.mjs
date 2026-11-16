// ============================================================
//  โมดูลออฟฟิศ — ทางเข้า (defineOffice) + action อ่านทั้งหมด                                v2/server/actions/office.mjs
//
//  อ่าน (ออฟฟิศ + ประธาน):
//    office.home       หน้าแรก "งานที่รอ": คิว ออเดอร์ใหม่ · รอผลิต · รอสกรีน · รอส่ง · ค้างเงิน + ออเดอร์ที่ยังไม่จบทั้งหมด (สถานะจากงานจริง)
//    office.orders     ค้น/กรองออเดอร์ทุกใบ (รวมที่จบแล้ว + ประวัติจากแอปเดิม) ทีละหน้า
//    office.order      รายละเอียดใบเดียว: รายการ + ความคืบหน้า (ผลิต/สกรีน/ส่ง) + บิล + ประวัติการแก้ + ปุ่มไหนกดได้/เพราะอะไร
//    office.form       ของที่ฟอร์มลงออเดอร์ต้องใช้: ประเภท/แกน/ขนาด/ใบต่อถุง/ขั้นต่ำ/ค่าแกน · ราคาตั้ง · สาย · อำเภอ · ที่สั่งบ่อย
//    office.customers  ทะเบียนลูกค้า (ค้างส่ง/ค้างเงิน/สั่งล่าสุด) — ตัวเลือกลูกค้า + หน้าลูกค้า
//    office.customer   ลูกค้ารายเดียว: ข้อมูล · ออเดอร์ · "เคยสั่ง" · บิล/ค้างเงิน
//    office.stock      สต๊อก (ดูอย่างเดียว) เกรด A แยก B เทียบของที่ต้องส่ง
//    office.bill       เอกสารบิล (พิมพ์/รูป/แชร์)
//  เขียน: office-orders.mjs · office-customers.mjs · office-bills.mjs
//  ไม่ส่งยอดเงินในรายการออเดอร์ (PALM-WAY §3) — เงินอยู่ในรายละเอียด/บิลเท่านั้น
// ============================================================
import { Fail, notFound, need, text, int, oneOf, iso, thaiDay, addDays } from "../core.mjs";
import { nameKey } from "../import/legacy.mjs";
import { OPEN_STATUSES, CATALOG_READS, catalogOf, deriveOrder, loadOrderParts, chunk } from "./office-lib.mjs";
import { defineOfficeOrders, loadOrder, ROLES_OFFICE } from "./office-orders.mjs";
import { defineOfficeCustomers } from "./office-customers.mjs";
import { defineOfficeBills, suggestDue } from "./office-bills.mjs";

const IN = n => "(" + Array.from({ length: n }, () => "?").join(",") + ")";
const OPEN_SQL = "('" + OPEN_STATUSES.join("','") + "')";
const ITEM_KEYS = ["id", "line_no", "label", "type", "size", "neck", "shape", "color", "screen_color", "cap_color", "bags", "per_bag", "extra_pcs", "qty_pcs", "made", "delivered", "on_truck", "source"];
const pick = (o, ks) => { const r = {}; ks.forEach(k => { r[k] = o[k] === undefined ? null : o[k]; }); return r; };

async function customersOf(X, ids) {
  const m = new Map();
  for (const part of chunk([...new Set(ids)], 90)) (await X.db.all("SELECT id, name, route_code, district, note FROM customers WHERE id IN " + IN(part.length), ...part)).forEach(c => m.set(c.id, c));
  return m;
}
async function unitsOf(X) { return new Map((await X.db.all("SELECT code, piece_unit FROM product_types")).map(t => [t.code, t.piece_unit])); }

/** แถวออเดอร์สำหรับรายการ (ไม่มียอดเงิน · ไม่มีรหัสบนจอ — id ไว้เปิดรายละเอียดเท่านั้น) */
function rowOf(o, d, cust, units, today, bill) {
  const status = d.status;
  let money = null;
  if (bill && bill.status === "ค้างชำระ") money = bill.due_day && bill.due_day < today ? "overdue" : "owing";
  else if (!bill && o.src === "v2" && o.status !== "ยกเลิก" && d.delivered > 0) money = "unbilled";
  return {
    id: o.id, version: o.version, order_day: o.order_day, due_day: o.due_day, status, urgent: o.urgent, brand: o.brand, pay_status: o.pay_status, design_status: o.design_status,
    src: o.src, customer_id: o.customer_id, customer: cust ? cust.name : o.customer_text, route_code: cust ? cust.route_code : null, district: cust ? cust.district : "",
    late: !!o.due_day && o.due_day < today && OPEN_STATUSES.indexOf(status) >= 0, money, bill: bill ? { bill_no: bill.bill_no, status: bill.status, due_day: bill.due_day, kind: bill.kind } : null,
    qty: d.qty, delivered: d.delivered,
    items: d.items.map(i => ({ ...pick(i, ITEM_KEYS), piece_unit: units.get(i.type) || "ชิ้น" })),
  };
}
async function rowsFor(X, ids, today) {
  if (!ids.length) return [];
  const [P, units] = await Promise.all([loadOrderParts(X, ids), unitsOf(X)]);
  const custs = await customersOf(X, [...P.orders.values()].map(o => o.customer_id));
  const bills = new Map();
  for (const part of chunk(ids, 90)) (await X.db.all("SELECT bill_no, order_id, status, due_day, kind FROM bills WHERE status <> 'ยกเลิก' AND order_id IN " + IN(part.length), ...part)).forEach(b => bills.set(b.order_id, b));
  return ids.filter(id => P.orders.has(id)).map(id => {
    const o = P.orders.get(id);
    const d = deriveOrder(o, P.items[id], P.jobs[id], P.sjobs[id], P.loads[id]);
    return rowOf(o, d, custs.get(o.customer_id), units, today, bills.get(id));
  });
}

// ── ประวัติการแก้ (จาก audit_log) → บรรทัดที่คนอ่านรู้เรื่อง ──────────────────────────────
const ACT_TH = {
  "office.order_create": "ลงออเดอร์", "office.order_update": "แก้ออเดอร์", "office.order_queue": "ส่งเข้าคิว", "office.order_cancel": "ยกเลิก/ปิดออเดอร์",
  "office.order_pickup": "ลูกค้ารับของที่โรงงาน", "office.bill_create": "ออกบิล", "office.bill_cancel": "ยกเลิกบิล", "office.customer_merge": "รวมลูกค้า",
  "undo.run": "ย้อนรายการ", "import.run": "นำเข้าจากแอปเดิม",
};
const ROLE_TH = { office: "ออฟฟิศ", prod: "ทีมผลิต", screen: "ทีมสกรีน", deliver: "ส่งของ", account: "บัญชี", exec: "ประธาน" };
const FIELD_TH = { due_day: "วันส่ง", urgent: "ด่วน", brand: "ชื่องาน", note: "หมายเหตุ", pay_status: "สถานะเงิน", design_status: "สถานะแบบ", purchase_type: "ประเภทซื้อ", price_mode: "ราคา",
  block_fee_satang: "ค่าบล็อก", customer_id: "ลูกค้า", qty_pcs: "จำนวน", bags: "ถุง", extra_pcs: "เศษ", price_satang: "ราคา/หน่วย", label: "สินค้า", screen_color: "สีสกรีน", cap_color: "ฝาสี",
  status: "สถานะ", target_pcs: "เป้าผลิต", colors: "สีสกรีน", delivered_pcs: "ส่งแล้ว", paper_no: "เลขบิลกระดาษ", team: "ทีมสกรีน" };
function historyOf(rows) {
  const groups = [];
  for (const r of rows) {
    let g = groups[groups.length - 1];
    if (!g || g.key !== (r.req_key || "a" + r.id)) { g = { key: r.req_key || "a" + r.id, at: r.at, who: r.staff_name, role: ROLE_TH[r.role] || "", what: ACT_TH[r.action] || (ROLE_TH[r.role] ? ROLE_TH[r.role] + " บันทึกงาน" : "ระบบ"), reason: r.reason, undo: !!r.undo_of, changes: [] }; groups.push(g); }
    let b = {}, a = {};
    try { b = r.before_json ? JSON.parse(r.before_json) : {}; } catch (e) { /* ตัดยาว */ }
    try { a = r.after_json ? JSON.parse(r.after_json) : {}; } catch (e) { /* ตัดยาว */ }
    if (!r.before_json) continue;   // แถวใหม่ — "ลงออเดอร์" พูดแทนแล้ว
    for (const k of Object.keys(a)) if (FIELD_TH[k] && String(b[k] ?? "") !== String(a[k] ?? "")) g.changes.push({ field: FIELD_TH[k], key: k, from: b[k] ?? "", to: a[k] ?? "", entity: r.entity });
  }
  return groups.map(({ key, ...g }) => g).reverse();
}

export function defineOffice(R) {
  defineOfficeOrders(R);
  defineOfficeCustomers(R);
  defineOfficeBills(R);

  R.define({
    name: "office.home", roles: ROLES_OFFICE,
    async run(X) {
      const today = thaiDay(X.now);
      const [open, unbilled, owing, acct] = await X.db.reads([
        [`SELECT id FROM orders WHERE status IN ${OPEN_SQL} ORDER BY urgent DESC, CASE WHEN due_day = '' THEN '9999' ELSE due_day END, order_day LIMIT 400`],
        [`SELECT o.id FROM orders o WHERE o.src = 'v2' AND o.status <> 'ยกเลิก' AND NOT EXISTS (SELECT 1 FROM bills b WHERE b.order_id = o.id AND b.status <> 'ยกเลิก')
           AND (EXISTS (SELECT 1 FROM delivery_loads l WHERE l.order_id = o.id AND l.status = 'ส่งแล้ว') OR EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id AND i.delivered_pcs > 0)) LIMIT 200`],
        ["SELECT order_id AS id FROM bills WHERE status = 'ค้างชำระ' AND order_id IS NOT NULL ORDER BY due_day LIMIT 300"],
        ["SELECT count(*) AS n FROM bills WHERE status = 'ค้างชำระ' AND order_id IS NULL"],
      ]);
      const ids = [...new Set([...open, ...unbilled, ...owing].map(r => r.id))];
      const rows = await rowsFor(X, ids, today);
      const Q = {
        new: r => r.status === "ออเดอร์ใหม่", prod: r => r.status === "รอผลิต" || r.status === "กำลังผลิต", screen: r => r.status === "รอสกรีน" || r.status === "กำลังสกรีน",
        deliver: r => r.status === "พร้อมส่ง" || r.status === "ส่งบางส่วน", money: r => !!r.money,
      };
      const count = k => rows.filter(Q[k]).length;
      return {
        asOf: iso(X.now), today, takenToday: rows.filter(r => r.order_day === today).length,
        queues: [
          { key: "new", label: "ออเดอร์ใหม่", hint: "ยังไม่ส่งเข้าคิว", n: count("new"), tone: "warn" },
          { key: "prod", label: "รอผลิต", n: count("prod") },
          { key: "screen", label: "รอสกรีน", n: count("screen") },
          { key: "deliver", label: "รอส่ง", n: count("deliver") },
          { key: "money", label: "ค้างเงิน", hint: "ยังไม่ออกบิล/บิลค้าง", n: count("money"), tone: "warn" },
        ],
        acctOwing: acct[0] ? acct[0].n : 0,
        orders: rows,
      };
    },
  });

  R.define({
    name: "office.orders", roles: ROLES_OFFICE,
    input: raw => ({ q: text(raw.q, 60), group: oneOf(raw.group || "all", ["all", "open", "done", "cancel"], "กลุ่ม"), customer_id: text(raw.customer_id, 40),
      before: text(raw.before, 80), limit: int(raw.limit === undefined ? 40 : raw.limit, "จำนวน", { min: 1, max: 100 }) }),
    async run(X, input) {
      const today = thaiDay(X.now);
      const where = [], args = [];
      if (input.q) {
        const k = nameKey(input.q), q = input.q.toLowerCase();
        where.push(`(instr(c.name_key, ?) > 0 OR instr(lower(o.customer_text), ?) > 0 OR instr(lower(o.brand), ?) > 0 OR instr(lower(o.note), ?) > 0
          OR EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id AND (instr(lower(i.label), ?) > 0 OR instr(lower(i.screen_color), ?) > 0)))`);
        args.push(k || q, q, q, q, q, q);
      }
      if (input.group === "open") where.push("o.status IN " + OPEN_SQL);
      if (input.group === "done") where.push("o.status = 'ส่งแล้ว'");
      if (input.group === "cancel") where.push("o.status = 'ยกเลิก'");
      if (input.customer_id) { where.push("o.customer_id = ?"); args.push(input.customer_id); }
      if (input.before) { const [d, id] = input.before.split("|"); where.push("(o.order_day < ? OR (o.order_day = ? AND o.id < ?))"); args.push(d, d, id || ""); }
      const ids = await X.db.all(`SELECT o.id, o.order_day FROM orders o JOIN customers c ON c.id = o.customer_id ${where.length ? "WHERE " + where.join(" AND ") : ""}
        ORDER BY o.order_day DESC, o.id DESC LIMIT ?`, ...args, input.limit + 1);
      const more = ids.length > input.limit;
      const page = ids.slice(0, input.limit);
      const rows = await rowsFor(X, page.map(r => r.id), today);
      const last = page[page.length - 1];
      return { asOf: iso(X.now), today, orders: rows, next: more && last ? last.order_day + "|" + last.id : null };
    },
  });

  R.define({
    name: "office.order", roles: ROLES_OFFICE,
    input: raw => ({ id: need(raw.id, "ออเดอร์", 40) }),
    async run(X, input) {
      const today = thaiDay(X.now);
      const id = input.id;
      const c = await loadOrder(X, id, [
        [`SELECT id, at, staff_name, role, action, entity, entity_id, before_json, after_json, reason, req_key, undo_of FROM audit_log WHERE
           (entity = 'orders' AND entity_id = ?) OR (entity = 'order_items' AND entity_id IN (SELECT id FROM order_items WHERE order_id = ?))
           OR (entity = 'production_jobs' AND entity_id IN (SELECT id FROM production_jobs WHERE order_id = ?)) OR (entity = 'screen_jobs' AND entity_id IN (SELECT id FROM screen_jobs WHERE order_id = ?))
           OR (entity = 'bills' AND entity_id IN (SELECT bill_no FROM bills WHERE order_id = ?)) OR (entity = 'delivery_loads' AND entity_id IN (SELECT id FROM delivery_loads WHERE order_id = ?))
           ORDER BY id LIMIT 400`, id, id, id, id, id, id],
        ["SELECT bill_no, bill_day, kind, status, total_satang, paid_satang, due_day, paper_no, src, by_name, cancel_reason, version FROM bills WHERE order_id = ? ORDER BY created_at DESC", id],
        ["SELECT code, piece_unit FROM product_types"],
        ["SELECT s.nick, s.id FROM staff s JOIN orders o ON o.taker_staff_id = s.id WHERE o.id = ?", id],
        ["SELECT b.item_key, b.grade, b.qty_pcs FROM stock_balance b WHERE b.item_key IN (SELECT 'spec:' || spec_key FROM order_items WHERE order_id = ?)", id],
        // รายการล่าสุดของออเดอร์นี้ที่ "ฉัน" ยังย้อนได้ (ลงออเดอร์พร้อมลูกค้าใหม่ = แถวย้อนผูกกับลูกค้า → หาผ่านรหัสคำขอเดียวกัน)
        [`SELECT u.id, u.label FROM undo_log u WHERE u.status = 'พร้อมย้อน' AND u.until_at > ? AND u.staff_id = ? AND u.audit_id IN
           (SELECT min(a2.id) FROM audit_log a1 JOIN audit_log a2 ON a2.req_key = a1.req_key WHERE a1.entity = 'orders' AND a1.entity_id = ? AND a1.req_key <> '' GROUP BY a1.req_key)
           ORDER BY u.created_at DESC LIMIT 1`, iso(X.now), X.staff.id, id],
      ]);
      const [hist, bills, units, taker, stock, undo] = c.more;
      const o = c.o;
      const d = deriveOrder(o, c.items, c.jobs, c.sjobs, c.loads);
      const U = new Map(units.map(u => [u.code, u.piece_unit]));
      const activeBill = bills.find(b => b.status !== "ยกเลิก") || null;
      const started = d.items.some(i => (i.job && (i.job.status !== "รอผลิต" || i.job.good_pcs > 0)) || (i.screen && (i.screen.status !== "รอดำเนินการ" || i.screen.team)));
      const onTruck = d.items.some(i => i.on_truck > 0), delivered = d.items.some(i => i.delivered > 0);
      const can = {
        queue: o.status === "ออเดอร์ใหม่",
        edit: o.status !== "ยกเลิก" && !(d.status === "ส่งแล้ว" && !!activeBill),
        editItems: o.status !== "ยกเลิก" && !activeBill && d.status !== "ส่งแล้ว",
        editWhy: o.status === "ยกเลิก" ? "ยกเลิกแล้ว" : activeBill ? "มีบิลแล้ว — แก้รายการไม่ได้ (ยกเลิกบิลก่อน)" : d.status === "ส่งแล้ว" ? "ส่งครบแล้ว" : started ? "ทีมผลิต/สกรีนเริ่มงานแล้ว — แก้ได้แต่ต้องใส่เหตุผล" : "",
        cancel: o.status !== "ยกเลิก" && d.status !== "ส่งแล้ว" && !activeBill && !onTruck,
        cancelWhy: activeBill ? "มีบิลแล้ว — ยกเลิกบิลก่อน" : onTruck ? "มีของอยู่บนรถ — รอทีมส่งของบันทึกก่อน" : delivered ? "ส่งไปบางส่วนแล้ว — ยกเลิก = ปิดออเดอร์ที่จำนวนเท่าที่ส่ง" : "",
        pickup: o.status !== "ยกเลิก" && d.status !== "ส่งแล้ว",
        bill: o.status !== "ยกเลิก" && !activeBill,
        partialCancel: delivered,
      };
      return {
        asOf: iso(X.now), today,
        order: { ...o, status: d.status, stored_status: o.status, taker: taker[0] ? taker[0].nick : o.taker_text, late: !!o.due_day && o.due_day < today && OPEN_STATUSES.indexOf(d.status) >= 0 },
        customer: c.cust ? pick(c.cust, ["id", "name", "phone", "district", "subdistrict", "route_code", "address", "map_url", "note", "credit_days", "status", "version"]) : null,
        items: d.items.map(i => ({ ...i, piece_unit: U.get(i.type) || "ชิ้น", stock_a: (stock.find(s => s.item_key === "spec:" + i.spec_key && s.grade === "A") || {}).qty_pcs || 0,
          stock_b: (stock.find(s => s.item_key === "spec:" + i.spec_key && s.grade === "B") || {}).qty_pcs || 0 })),
        cancelled_items: c.items.filter(i => i.status === "ยกเลิก").map(i => ({ id: i.id, label: i.label, qty_pcs: i.qty_pcs })),
        loads: c.loads.filter(l => l.status !== "ยกเลิก").map(l => ({ id: l.id, order_item_id: l.order_item_id, qty_pcs: l.qty_pcs, status: l.status, done_day: l.done_day, trip: !!l.trip_id, note: l.note, fail_reason: l.fail_reason })),
        bill: activeBill, bills, can, history: historyOf(hist), undo: undo[0] || null,
        suggest_due: suggestDue(X, c.cust),
      };
    },
  });

  R.define({
    name: "office.form", roles: ROLES_OFFICE,
    async run(X) {
      const res = await X.db.reads([...CATALOG_READS,
        ["SELECT item_key, kind, price_satang, label FROM prices"],
        ["SELECT id, name, spec_key FROM products WHERE status = 'ขาย' AND spec_key <> ''"],
        ["SELECT code, name, area FROM routes WHERE active = 1 ORDER BY pos, code"],
        ["SELECT district, count(*) AS n FROM customers WHERE district <> '' AND merged_into IS NULL GROUP BY district ORDER BY n DESC LIMIT 24"],
        [`SELECT i.type, i.size, i.neck, i.shape, i.color, i.screen_color, i.cap_color, i.spec_key, count(*) AS n FROM order_items i JOIN orders o ON o.id = i.order_id
           WHERE o.status <> 'ยกเลิก' AND i.status = 'ใช้งาน' AND o.order_day >= ? GROUP BY i.spec_key, i.screen_color, i.cap_color ORDER BY n DESC LIMIT 8`, addDays(thaiDay(X.now), -365)],
      ]);
      const cat = catalogOf(res.slice(0, 3));
      return {
        asOf: iso(X.now), today: thaiDay(X.now),
        types: [...cat.types.values()].filter(t => t.active).map(t => ({ code: t.code, axes: t.axisList, count_unit: t.count_unit, piece_unit: t.piece_unit,
          sizes: t.sizes.filter(s => s.active).map(s => ({ size: s.size, per_bag: s.per_bag, min: s.min_order_pcs })) })),
        values: Object.fromEntries(Object.entries(cat.values).map(([k, v]) => [k, v.filter(x => x.active).map(x => ({ value: x.value, grade: x.grade }))])),
        prices: res[3], products: res[4], routes: res[5], districts: res[6].map(r => r.district), top: res[7],
        creditDays: Number(X.settings.CREDIT_DAYS_DEFAULT || 30),
      };
    },
  });

  R.define({
    name: "office.customers", roles: ROLES_OFFICE,
    async run(X) {
      const rows = await X.db.all(`SELECT c.id, c.name, c.route_code, c.district, c.phone, c.note, c.status, c.needs_review, c.credit_days,
          (SELECT max(o.order_day) FROM orders o WHERE o.customer_id = c.id AND o.status <> 'ยกเลิก') AS last_day,
          (SELECT count(*) FROM orders o WHERE o.customer_id = c.id AND o.status IN ${OPEN_SQL}) AS open_n,
          (SELECT count(*) FROM bills b WHERE b.customer_id = c.id AND b.status = 'ค้างชำระ') AS owe_n,
          (SELECT count(*) FROM bills b WHERE b.customer_id = c.id AND b.status = 'ค้างชำระ' AND b.due_day <> '' AND b.due_day < ?) AS overdue_n
        FROM customers c WHERE c.merged_into IS NULL ORDER BY c.name`, thaiDay(X.now));
      return { asOf: iso(X.now), customers: rows };
    },
  });

  R.define({
    name: "office.customer", roles: ROLES_OFFICE,
    input: raw => ({ id: need(raw.id, "ลูกค้า", 40) }),
    async run(X, input) {
      const today = thaiDay(X.now);
      const [c, aliases, items, orderIds, bills, merged] = await X.db.reads([
        ["SELECT * FROM customers WHERE id = ?", input.id],
        ["SELECT alias FROM customer_aliases WHERE customer_id = ? LIMIT 20", input.id],
        [`SELECT i.type, i.size, i.neck, i.shape, i.color, i.screen_color, i.cap_color, i.spec_key, i.label, i.bags, i.per_bag, i.extra_pcs, i.qty_pcs, i.price_satang, o.order_day, o.purchase_type
           FROM order_items i JOIN orders o ON o.id = i.order_id WHERE o.customer_id = ? AND o.status <> 'ยกเลิก' AND i.status = 'ใช้งาน' ORDER BY o.order_day DESC, o.id DESC LIMIT 400`, input.id],
        ["SELECT id FROM orders WHERE customer_id = ? ORDER BY order_day DESC, id DESC LIMIT 60", input.id],
        ["SELECT bill_no, bill_day, kind, status, total_satang, paid_satang, due_day, order_id, src, paper_no FROM bills WHERE customer_id = ? AND status <> 'ยกเลิก' ORDER BY bill_day DESC LIMIT 60", input.id],
        ["SELECT id, name FROM customers WHERE merged_into = ?", input.id],
      ]);
      if (!c[0]) throw notFound("ไม่พบลูกค้านี้");
      // "เคยสั่ง": สเปกเดียวกัน (รวมสีสกรีน/ฝา) นับครั้ง · ค่าครั้งล่าสุด (ถุง/เศษ/ราคา) ไว้เติมฟอร์มทีเดียวทั้งไลน์
      const g = new Map();
      for (const i of items) {
        const k = i.spec_key + "|" + i.screen_color + "|" + i.cap_color;
        const cur = g.get(k);
        if (!cur) g.set(k, { ...i, n: 1, last_day: i.order_day });
        else cur.n++;
      }
      const usual = [...g.values()].sort((a, b) => b.n - a.n || (a.last_day < b.last_day ? 1 : -1)).slice(0, 8);
      const owe = bills.filter(b => b.status === "ค้างชำระ");
      return {
        asOf: iso(X.now), today, customer: c[0], aliases: aliases.map(a => a.alias), merged,
        usual, orders: await rowsFor(X, orderIds.map(r => r.id), today), bills,
        owing: { n: owe.length, satang: owe.reduce((s, b) => s + b.total_satang - b.paid_satang, 0), overdue: owe.filter(b => b.due_day && b.due_day < today).length, period: "บิลที่ยังค้าง ณ " + today },
      };
    },
  });

  R.define({
    name: "office.stock", roles: ROLES_OFFICE,
    async run(X) {
      const today = thaiDay(X.now);
      const [bal, open] = await X.db.reads([
        ["SELECT item_key, grade, label, qty_pcs, updated_at FROM stock_balance WHERE substr(item_key, 1, 5) = 'spec:' ORDER BY label"],
        [`SELECT id FROM orders WHERE status IN ${OPEN_SQL}`],
      ]);
      const P = await loadOrderParts(X, open.map(r => r.id));
      const need = new Map();
      for (const [id, o] of P.orders) {
        const d = deriveOrder(o, P.items[id], P.jobs[id], P.sjobs[id], P.loads[id]);
        for (const i of d.items) {
          const left = Math.max(0, i.qty_pcs - i.delivered - i.on_truck);
          if (!left) continue;
          const k = "spec:" + i.spec_key;
          const n = need.get(k) || { label: i.label, type: i.type, size: i.size, need: 0, orders: 0, soonest: "" };
          n.need += left; n.orders++;
          if (o.due_day && (!n.soonest || o.due_day < n.soonest)) n.soonest = o.due_day;
          need.set(k, n);
        }
      }
      const by = new Map();
      for (const b of bal) {
        const r = by.get(b.item_key) || { item_key: b.item_key, label: b.label, a: 0, b: 0, updated_at: b.updated_at };
        r[b.grade === "B" ? "b" : "a"] += b.qty_pcs;
        if (b.updated_at > r.updated_at) r.updated_at = b.updated_at;
        by.set(b.item_key, r);
      }
      for (const [k, n] of need) { const r = by.get(k) || { item_key: k, label: n.label, a: 0, b: 0, updated_at: "" }; Object.assign(r, { need: n.need, orders: n.orders, soonest: n.soonest, type: n.type, size: n.size }); by.set(k, r); }
      const rows = [...by.values()].map(r => {
        const [type, size] = r.item_key.slice(5).split("|");
        return { ...r, type: r.type || type, size: r.size || size, need: r.need || 0, orders: r.orders || 0, short: Math.max(0, (r.need || 0) - Math.max(0, r.a)) };
      }).sort((a, b) => (b.short > 0) - (a.short > 0) || b.need - a.need || String(a.label).localeCompare(String(b.label), "th"));
      return { asOf: iso(X.now), today, rows, started: bal.length > 0 };
    },
  });

  R.define({
    name: "office.bill", roles: ROLES_OFFICE,
    input: raw => ({ bill_no: need(raw.bill_no, "เลขบิล", 40) }),
    async run(X, input) {
      const [b, cust, ord] = await X.db.reads([
        ["SELECT * FROM bills WHERE bill_no = ?", input.bill_no],
        ["SELECT c.name, c.phone, c.address, c.district, c.subdistrict FROM customers c JOIN bills b ON b.customer_id = c.id WHERE b.bill_no = ?", input.bill_no],
        ["SELECT o.id, o.order_day, o.brand, o.due_day FROM orders o JOIN bills b ON b.order_id = o.id WHERE b.bill_no = ?", input.bill_no],
      ]);
      if (!b[0]) throw new Fail(404, "not_found", "ไม่พบบิลนี้");
      let lines = [];
      try { lines = JSON.parse(b[0].items_json || "[]"); } catch (e) { lines = []; }
      return { bill: { ...b[0], lines }, customer: cust[0] || null, order: ord[0] || null,
        company: { name: X.settings.COMPANY_LEGAL_NAME || X.settings.COMPANY_NAME || "โรงขวด P&K", short: X.settings.COMPANY_NAME || "", phone: X.settings.COMPANY_PHONE || "" } };
    },
  });
}
