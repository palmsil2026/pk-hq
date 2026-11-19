// ============================================================
//  ออฟฟิศ — ออเดอร์ทั้งวงจร: ลง · แก้ (มีประวัติ) · ส่งเข้าคิวผลิต/สกรีน · ยกเลิก · ลูกค้ามารับ          v2/server/actions/office-orders.mjs
//
//  หลัก (PALM-WAY §2 ข้อ 5–7 · docs/app-v2/README.md §2):
//   · ไม่มีทางตัน — เคสแปลก (แก้หลังทีมผลิตรับงาน · ราคาไม่ตรงราคาตั้ง · สเปกนอกทะเบียน · รับของเกินที่สั่ง) ทำต่อได้
//     แต่ต้องมีเหตุผล + ประวัติ + ธง · บล็อกเฉพาะที่ "ผิดแน่" (แก้สเปกของที่ส่งไปแล้ว/มีบิลแล้ว) และบอกในข้อความว่าต้องทำอะไรแทน
//   · ทุกการบันทึกย้อนได้ (ท่อกลาง) จนกว่าขั้นถัดไปแตะแถวนั้น (version เปลี่ยน = ย้อนไม่ได้ บอกให้ทำรายการแก้แทน)
//   · จำนวนคิดที่หลังบ้านเสมอ (ถุง × ใบต่อถุง ณ ตอนลง + เศษ) · เงิน = สตางค์ · ไม่มีราคา = NULL ไม่ใช่ 0
// ============================================================
import { Fail, bad, conflict, notFound, need, text, int, day, oneOf, iso, thaiDay } from "../core.mjs";
import { nameKey } from "../import/legacy.mjs";
import { CATALOG_READS, catalogOf, normalizeItem, deriveOrder, statusSet, splitBags, gradeOf, PRICE_KIND } from "./office-lib.mjs";
import { plainKey, screenKey, negativeStockFlags, billAfterGuard } from "./deliver_common.mjs";
import { PROD_TYPES } from "./prodLib.mjs";
import { planInput, wantInput, planState } from "./office-plan-lib.mjs";
import { roundRows, planCols } from "./office-plan.mjs";
import { depositRemindFlag } from "./office-deposits.mjs";

export const ROLES_OFFICE = ["office", "exec"];
const PURCHASE = ["", "ขายราคาโรงงาน", "ขายหน้าร้าน"], PRICE_MODE = ["", "มาตรฐาน", "พิเศษ"];
const PAY = ["", "รอโอนเงิน", "โอนแล้ว", "ทำได้เลย", "เก็บปลายทาง"], DESIGN = ["", "ไม่ต้องใช้แบบ", "รอแบบ", "แก้ไขแบบ", "แบบผ่านแล้ว"];
const HEADER = ["customer_id", "brand", "due_day", "urgent", "purchase_type", "price_mode", "pay_status", "design_status", "block_fee_satang", "note"];
const locked = (msg, extra) => new Fail(409, "locked", msg, extra);
/** ต้องมีเหตุผลก่อนบันทึก — หน้าเว็บเปิดแผ่นเหตุผลแล้วส่งซ้ำ (needReason + เหตุที่ต้องถาม) */
const needReason = why => new Fail(400, "need_reason", "ต้องใส่เหตุผล: " + why.join(" · "), { needReason: true, why });
const money = s => (Number(s) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });

// ── ช่องหัวออเดอร์จากหน้าเว็บ ─────────────────────────────────────────────
function headerInput(raw) {
  return {
    customer_id: text(raw.customer_id, 40), brand: text(raw.brand, 80, "ชื่องาน/แบรนด์"), due_day: day(raw.due_day, "วันส่ง", true),
    urgent: raw.urgent ? 1 : 0, purchase_type: oneOf(raw.purchase_type || "", PURCHASE, "ประเภทการซื้อ"), price_mode: oneOf(raw.price_mode || "", PRICE_MODE, "ราคา"),
    pay_status: oneOf(raw.pay_status || "", PAY, "สถานะเงิน"), design_status: oneOf(raw.design_status || "", DESIGN, "สถานะแบบ"),
    block_fee_satang: int(raw.block_fee_satang, "ค่าบล็อก (สตางค์)", { optional: true, min: 0, max: 100000000 }), note: text(raw.note, 500, "หมายเหตุ"),
  };
}
function itemsInput(raw) {
  if (!Array.isArray(raw.items) || !raw.items.length) throw bad("ต้องมีสินค้าอย่างน้อย 1 รายการ");
  if (raw.items.length > 30) throw bad("ออเดอร์หนึ่งใบใส่ได้ไม่เกิน 30 รายการ");
  return raw.items.map(x => Object.assign({}, x));
}
function newCustomerInput(nc) {
  if (!nc) return null;
  const name = need(nc.name, "ชื่อลูกค้าใหม่", 120);
  return { name, name_key: nameKey(name), district: text(nc.district, 60, "อำเภอ"), phone: text(nc.phone, 40, "เบอร์"), route_code: text(nc.route_code, 10) || null, note: text(nc.note, 300, "หมายเหตุลูกค้า") };
}

/** ราคาตั้ง (ประธานตั้ง) ของสเปก/สินค้านั้น ตามประเภทการซื้อ — ไม่มี = null (ไม่เดา) */
function listPrice(prices, it, purchaseType) {
  const kind = PRICE_KIND[purchaseType];
  if (!kind) return null;
  const p = prices.find(x => x.kind === kind && (x.item_key === "spec:" + it.spec_key || (it.product_id && x.item_key === "sku:" + it.product_id)));
  return p ? p.price_satang : null;
}
/** ตรวจราคา/สเปกนอกทะเบียน/ขั้นต่ำ ของรายการที่เปลี่ยน → ธง (ไม่บล็อก) · ราคาไม่ตรงต้องมีเหตุผลของรายการนั้น */
function itemChecks(it, ctx, head, custName, n) {
  const flags = [];
  const lp = listPrice(ctx.prices, it, head.purchase_type);
  if (it.price_satang !== null && lp !== null && it.price_satang !== lp) {
    if (!it.price_reason) throw bad("รายการที่ " + n + " (" + it.label + "): ราคา ฿" + money(it.price_satang) + " ไม่ตรงราคาตั้ง ฿" + money(lp) + " — เลือกเหตุผลของราคานี้ก่อน", { needPriceReason: n });
    flags.push({ op: "flag", kind: "ราคาไม่ตรงทะเบียน", team: "office", title: custName + ": " + it.label + " ลงราคา ฿" + money(it.price_satang) + " (ราคาตั้ง ฿" + money(lp) + ")", detail: "เหตุผล: " + it.price_reason });
  }
  if (it.offList.length) flags.push({ op: "flag", kind: "สเปกนอกทะเบียน", team: "office", title: custName + ": " + it.label + " มีค่านอกทะเบียน", detail: it.offList.join(" · ") + " — ถ้าใช้บ่อยให้เพิ่มในทะเบียนสเปก" });
  if (it.min_order_pcs && it.qty_pcs < it.min_order_pcs) flags.push({ op: "flag", kind: "ต่ำกว่าขั้นต่ำ", team: "office", title: custName + ": " + it.label + " " + it.qty_pcs.toLocaleString("en-US") + " " + it.unit + " (ขั้นต่ำ " + it.min_order_pcs.toLocaleString("en-US") + ")", detail: "ระบบเตือนแล้ว ออฟฟิศลงต่อ (ขั้นต่ำเตือนอย่างเดียว ไม่บล็อก)" });
  return flags;
}
const itemRow = (it, extra) => ({
  type: it.type, size: it.size, neck: it.neck, shape: it.shape, color: it.color, screen_color: it.screen_color, cap_color: it.cap_color,
  spec_key: it.spec_key, label: it.label, bags: it.bags, per_bag: it.per_bag, extra_pcs: it.extra_pcs, qty_pcs: it.qty_pcs,
  price_satang: it.price_satang, price_reason: it.price_reason, product_id: it.product_id || null, ...(extra || {}),
});
/** ที่มาของของในรายการ: ของที่โรงงานไม่มีเครื่องผลิต (ฝา ฟิล์ม ถุง ลัง — ซื้อมาขาย) = ใช้ของในสต๊อกเสมอ
 *  (ไม่งั้นงานผลิตฝาค้างในคิวทีมผลิตตลอดไป และออเดอร์ไม่ถึง "พร้อมส่ง") · ของที่ผลิตได้ = ตามที่ออฟฟิศเลือก (ตั้งต้น ผลิต) */
export const sourceOf = (type, want) => (PROD_TYPES.indexOf(type) < 0 || want === "สต๊อก" ? "สต๊อก" : "ผลิต");
/** งานผลิต (ถ้าผลิต) + งานสกรีน (ถ้ามีสีสกรีน) ของรายการหนึ่ง */
function jobRows(X, order, item, source) {
  const out = { jobs: [], sjobs: [] };
  if (source === "ผลิต") out.jobs.push({ id: "J" + X.newId(), order_id: order.id, order_item_id: item.id, type: item.type, size: item.size, neck: item.neck, shape: item.shape, color: item.color,
    spec_key: item.spec_key, target_pcs: item.qty_pcs, good_pcs: 0, status: "รอผลิต", due_day: order.due_day, urgent: order.urgent, src: "v2" });
  if (item.screen_color) out.sjobs.push({ id: "SJ" + X.newId(), order_id: order.id, order_item_id: item.id, team: null, colors: item.screen_color, qty_pcs: item.qty_pcs, status: "รอดำเนินการ", due_day: order.due_day, src: "v2" });
  return out;
}
const PRICE_READS = [["SELECT item_key, kind, price_satang FROM prices"], ["SELECT id, spec_key FROM products WHERE status = 'ขาย' AND spec_key <> ''"]];
const withProduct = (it, products) => { const p = products.find(x => x.spec_key === it.spec_key); it.product_id = p ? p.id : null; return it; };
/** งานผลิตเริ่มแล้ว (ทีมผลิตรับไป) = สถานะไม่ใช่รอผลิต · มีของดีแล้ว · หรือมีรอบเครื่องผูกงานนี้ */
const jobStarted = (j, runs) => !!j && (j.status !== "รอผลิต" || Number(j.good_pcs) > 0 || runs.some(r => r.job_id === j.id));
const sjobStarted = sj => !!sj && (sj.status !== "รอดำเนินการ" || !!sj.team);

/** อ่านทุกอย่างของออเดอร์ใบเดียว (รอบเดียว) */
export async function loadOrder(X, id, more) {
  const res = await X.db.reads([
    ["SELECT * FROM orders WHERE id = ?", id],
    ["SELECT * FROM order_items WHERE order_id = ? ORDER BY line_no", id],
    ["SELECT * FROM production_jobs WHERE order_id = ?", id],
    ["SELECT * FROM screen_jobs WHERE order_id = ?", id],
    ["SELECT * FROM delivery_loads WHERE order_id = ?", id],
    ["SELECT bill_no, status, src, total_satang, paid_satang, paper_no, version FROM bills WHERE order_id = ? AND status <> 'ยกเลิก'", id],
    ["SELECT r.id, r.job_id, r.status FROM machine_runs r JOIN production_jobs j ON j.id = r.job_id WHERE j.order_id = ?", id],
    ["SELECT c.* FROM customers c JOIN orders o ON o.customer_id = c.id WHERE o.id = ?", id],
    ...(more || []),
  ]);
  const o = res[0][0];
  if (!o) throw notFound("ไม่พบออเดอร์นี้ (อาจถูกเปลี่ยนไปแล้ว — โหลดใหม่)");
  return { o, items: res[1], jobs: res[2], sjobs: res[3], loads: res[4], bills: res[5], runs: res[6], cust: res[7][0], more: res.slice(8) };
}

export function defineOfficeOrders(R) {
  // ══ ลงออเดอร์ (ลูกค้าใหม่ลงพร้อมกันได้ · ส่งเข้าคิวผลิตเลยได้) ══════════════════════
  R.define({
    name: "office.order_create", roles: ROLES_OFFICE, write: true,
    onUnique: cols => (/customers/.test(cols) ? conflict("ชื่อลูกค้านี้มีในทะเบียนแล้ว — เลือกจากรายชื่อ") : null),
    input: raw => {
      const head = headerInput(raw);
      const nc = newCustomerInput(raw.new_customer);
      if (!nc && !head.customer_id) throw bad("ต้องเลือกลูกค้า");
      // งวดส่ง (ไม่ส่งมา = แบบเดิม: due_day เป็นงวดเดียว) · ต้องการเมื่อไร (ไม่บังคับ) · รอยืนยัน = ไม่ส่งเข้าคิว
      const plan = planInput(raw.plan);
      if (plan) head.due_day = plan.first_day;
      const hold = raw.hold ? 1 : 0;
      return { head, nc, items: itemsInput(raw), queue: !!raw.queue && !hold, hold, plan, want: wantInput(raw), sources: Array.isArray(raw.sources) ? raw.sources : [] };
    },
    async load(X, input) {
      const res = await X.db.reads([...CATALOG_READS, ...PRICE_READS,
        ["SELECT * FROM customers WHERE id = ?", input.head.customer_id || "-"],
        ["SELECT id, name FROM customers WHERE name_key = ? AND merged_into IS NULL LIMIT 1", input.nc ? input.nc.name_key : "-"],
        ["SELECT code FROM routes WHERE code = ?", input.nc && input.nc.route_code ? input.nc.route_code : "-"]]);
      return { cat: catalogOf(res.slice(0, 3)), prices: res[3], products: res[4], cust: res[5][0], dup: res[6][0], route: res[7][0] };
    },
    async run(X, input, ctx) {
      const today = thaiDay(X.now);
      const h = input.head;
      if (h.due_day && h.due_day < today) throw bad("วันส่งเป็นวันที่ผ่านมาแล้ว — เลือกวันนี้หรือหลังจากนี้");
      const ops = [];
      let cust = ctx.cust;
      if (input.nc) {
        if (ctx.dup) throw conflict("มี \"" + ctx.dup.name + "\" ในทะเบียนแล้ว — แตะเลือกจากรายชื่อแทน", { customer_id: ctx.dup.id });
        if (input.nc.route_code && !ctx.route) throw bad("ไม่รู้จักสาย " + input.nc.route_code);
        cust = { id: "C" + X.newId(), ...input.nc };
        ops.push({ op: "insert", table: "customers", row: { ...cust, src: "v2" } });
      } else {
        if (!cust) throw notFound("ไม่พบลูกค้านี้ในทะเบียน (อาจถูกรวม/เปลี่ยน — โหลดใหม่)");
        if (cust.merged_into) throw conflict("ลูกค้ารายนี้ถูกรวมเข้ากับรายอื่นแล้ว — เลือกใหม่จากรายชื่อ");
      }
      const items = input.items.map((r, i) => withProduct(normalizeItem(r, ctx.cat, i + 1), ctx.products));
      const id = "O" + X.newId();
      const order = { id, order_day: today, ...h, customer_id: cust.id, customer_text: cust.name, taker_staff_id: X.staff.id, taker_text: X.staff.nick,
        has_screen: items.some(i => i.screen_color) ? 1 : 0, total_satang: null, status: "ออเดอร์ใหม่", src: "v2", hold: input.hold, ...input.want, ...(input.plan ? planCols(input.plan) : {}) };
      const totalKnown = items.every(i => i.price_satang !== null);
      order.total_satang = totalKnown ? items.reduce((s, i) => s + i.price_satang * i.qty_pcs, 0) : null;
      const rows = items.map((it, i) => ({ id: id + "-" + (i + 1), order_id: id, line_no: i + 1, ...itemRow(it), status: "ใช้งาน", src: "v2" }));
      const jobs = [], sjobs = [];
      if (input.queue) rows.forEach((row, i) => {
        row.source = sourceOf(row.type, input.sources[i]);
        const j = jobRows(X, order, row, row.source);
        jobs.push(...j.jobs); sjobs.push(...j.sjobs);
      });
      if (input.queue) order.status = deriveOrder({ ...order, status: "รอผลิต" }, rows, jobs, sjobs, []).status;
      ops.push({ op: "insert", table: "orders", row: order });
      rows.forEach(r => ops.push({ op: "insert", table: "order_items", row: r }));
      if (input.plan) roundRows(X, id, input.plan, rows[0].qty_pcs).forEach(r => ops.push({ op: "insert", table: "order_rounds", row: r }));
      if (input.queue) { const f = depositRemindFlag(X, order, cust.name, []); if (f) ops.push(f); }
      jobs.forEach(r => ops.push({ op: "insert", table: "production_jobs", row: r }));
      sjobs.forEach(r => ops.push({ op: "insert", table: "screen_jobs", row: r }));
      items.forEach((it, i) => itemChecks(it, ctx, h, cust.name, i + 1).forEach(f => ops.push({ ...f, entity: "orders", entity_id: id })));
      return {
        label: "ลงออเดอร์ " + cust.name, ops,
        result: { id, customer_id: cust.id, customer: cust.name, status: order.status, queued: input.queue, hold: input.hold, jobs: jobs.length, screen_jobs: sjobs.length, order_day: today },
      };
    },
  });

  // ══ ส่งเข้าคิว: สร้างงานผลิต (หรือใช้ของในสต๊อก) + งานสกรีน ตามรายการ ══════════════════
  R.define({
    name: "office.order_queue", roles: ROLES_OFFICE, write: true,
    input: raw => ({ id: need(raw.id, "ออเดอร์", 40), version: int(raw.version, "รุ่นของออเดอร์", { min: 1 }),
      sources: raw.sources && typeof raw.sources === "object" ? raw.sources : {} }),
    load: (X, input) => loadOrder(X, input.id, [["SELECT amount_satang, status FROM order_deposits WHERE order_id = ?", input.id]]),
    async run(X, input, ctx) {
      const o = ctx.o;
      if (o.version !== input.version) throw conflict();
      if (o.status === "ยกเลิก") throw locked("ออเดอร์นี้ยกเลิกแล้ว");
      if (o.status !== "ออเดอร์ใหม่") throw locked("ออเดอร์นี้ส่งเข้าคิวไปแล้ว");
      const act = ctx.items.filter(i => i.status !== "ยกเลิก");
      const ops = [], jobs = [], sjobs = [], items = [];
      for (const it of act) {
        const source = sourceOf(it.type, input.sources[it.id]);
        const j = jobRows(X, o, it, source);
        jobs.push(...j.jobs); sjobs.push(...j.sjobs);
        items.push({ ...it, source });
        ops.push({ op: "update", table: "order_items", id: it.id, expect: it.version, before: it, set: { source } });
      }
      const d = deriveOrder({ ...o, status: "รอผลิต" }, items, jobs, sjobs, ctx.loads);
      ops.push({ op: "update", table: "orders", id: o.id, expect: o.version, before: o, set: o.hold ? { status: d.status, hold: 0 } : { status: d.status } });   // ส่งเข้าคิว = ลูกค้ายืนยันแล้ว
      jobs.forEach(r => ops.push({ op: "insert", table: "production_jobs", row: r }));
      sjobs.forEach(r => ops.push({ op: "insert", table: "screen_jobs", row: r }));
      const remind = depositRemindFlag(X, o, ctx.cust ? ctx.cust.name : "", ctx.more[0]);
      if (remind) ops.push(remind);
      return { label: "ส่งเข้าคิว " + (ctx.cust ? ctx.cust.name : ""), ops, result: { id: o.id, status: d.status, jobs: jobs.length, screen_jobs: sjobs.length } };
    },
  });

  // ══ แก้ไขออเดอร์ (ทั้งใบ: หัว + รายการ) ════════════════════════════════════════
  R.define({
    name: "office.order_update", roles: ROLES_OFFICE, write: true,
    input: raw => ({ id: need(raw.id, "ออเดอร์", 40), version: int(raw.version, "รุ่นของออเดอร์", { min: 1 }), head: headerInput(raw), keepDue: raw.due_day === undefined,
      items: itemsInput(raw).map(x => ({ ...x, id: text(x.id, 60) })) }),
    async load(X, input) {
      const c = await loadOrder(X, input.id, [...CATALOG_READS, ...PRICE_READS, ["SELECT * FROM customers WHERE id = ?", input.head.customer_id || "-"],
        ["SELECT id FROM order_rounds WHERE order_id = ? AND status = 'ใช้งาน'", input.id]]);
      c.cat = catalogOf(c.more.slice(0, 3)); c.prices = c.more[3]; c.products = c.more[4]; c.newCust = c.more[5][0]; c.hasRounds = c.more[6].length > 0;
      return c;
    },
    async run(X, input, ctx) {
      const o = ctx.o;
      if (o.version !== input.version) throw conflict();
      if (o.status === "ยกเลิก") throw locked("ออเดอร์นี้ยกเลิกแล้ว — ลงออเดอร์ใหม่แทน");
      const h = { ...input.head, customer_id: input.head.customer_id || o.customer_id };
      if (input.keepDue) h.due_day = o.due_day;   // ฟอร์มแก้ไม่ส่งวันส่ง = ไม่แตะ (เลื่อนวันทำที่งวดส่ง พร้อมสาเหตุ)
      const today = thaiDay(X.now);
      const billed = ctx.bills.length > 0;
      const queued = o.status !== "ออเดอร์ใหม่";
      const why = [], ops = [], flags = [];
      const flagTeams = new Set();
      const cur = deriveOrder(o, ctx.items, ctx.jobs, ctx.sjobs, ctx.loads);
      const byId = new Map(cur.items.map(i => [i.id, i]));
      const anyDelivered = cur.items.some(i => i.delivered > 0 || i.on_truck > 0);
      // ── หัวออเดอร์ ──
      const set = {};
      for (const k of HEADER) if (String(h[k] ?? "") !== String(o[k] ?? "")) set[k] = h[k];
      if ("due_day" in set && h.due_day && h.due_day < today) throw bad("วันส่งเป็นวันที่ผ่านมาแล้ว — เลือกวันนี้หรือหลังจากนี้");
      if ("due_day" in set && ctx.hasRounds) throw locked("ออเดอร์นี้วางงวดส่งไว้ — เลื่อนวันที่ \"งวดส่ง\" ในรายละเอียด (ต้องเลือกสาเหตุ)");
      // ออเดอร์ที่ไม่ได้วางงวด: ย้ายวันที่นัดไว้ = ลงสมุดเลื่อนด้วย (สาเหตุ "แก้ในหน้าออเดอร์" + เหตุผลถ้ามี)
      if ("due_day" in set && o.due_day) ops.push({ op: "insert", table: "reschedule_events", row: { id: "RS" + X.newId(), order_id: o.id, round_id: "", seq: 0, from_day: o.due_day, to_day: h.due_day, cause: "แก้ในหน้าออเดอร์", note: X.reason || "", by_staff: X.staff.id, src: "v2" } });
      if ("customer_id" in set) {
        if (!ctx.newCust || ctx.newCust.merged_into) throw notFound("ไม่พบลูกค้าที่เลือก (อาจถูกรวม/เปลี่ยน — โหลดใหม่)");
        if (anyDelivered || billed) throw locked("ส่งของ/ออกบิลให้ลูกค้าเดิมไปแล้ว — เปลี่ยนลูกค้าไม่ได้ ให้ยกเลิกแล้วลงใบใหม่");
        set.customer_text = ctx.newCust.name;
      }
      if (billed && "block_fee_satang" in set) throw locked("มีบิลแล้ว — แก้ค่าบล็อกไม่ได้ (ยกเลิกบิลก่อนถ้าจะแก้)");
      // ── รายการ ──
      const seen = new Set();
      const nextItems = [], nextJobs = ctx.jobs.map(j => ({ ...j })), nextSjobs = ctx.sjobs.map(j => ({ ...j }));
      let line = ctx.items.reduce((m, i) => Math.max(m, i.line_no), 0);
      let itemsChanged = false;
      const jobOf = id => nextJobs.find(j => j.order_item_id === id && j.status !== "ยกเลิก");
      const sjobOf = id => nextSjobs.find(j => j.order_item_id === id && j.status !== "ยกเลิก");
      const touchJob = (j, s) => { const b = ctx.jobs.find(x => x.id === j.id); Object.assign(j, s); ops.push({ op: "update", table: "production_jobs", id: j.id, expect: b.version, before: b, set: s }); };
      const touchSjob = (j, s) => { const b = ctx.sjobs.find(x => x.id === j.id); Object.assign(j, s); ops.push({ op: "update", table: "screen_jobs", id: j.id, expect: b.version, before: b, set: s }); };
      input.items.forEach((raw, n) => {
        const it = withProduct(normalizeItem(raw, ctx.cat, n + 1), ctx.products);
        const old = raw.id ? byId.get(raw.id) : null;
        if (raw.id && !old) throw conflict("รายการที่ " + (n + 1) + " ถูกเปลี่ยน/ยกเลิกไปก่อนแล้ว — โหลดใหม่");
        if (old && seen.has(old.id)) throw bad("รายการซ้ำกัน");
        if (!old) {   // รายการใหม่
          if (billed) throw locked("มีบิลแล้ว — เพิ่มรายการไม่ได้ (ยกเลิกบิลก่อน หรือลงออเดอร์ใหม่สำหรับของที่เพิ่ม)");
          itemsChanged = true;
          const row = { id: o.id + "-" + (++line), order_id: o.id, line_no: line, ...itemRow(it), status: "ใช้งาน", src: "v2", source: queued ? sourceOf(it.type, "ผลิต") : "" };
          ops.push({ op: "insert", table: "order_items", row });
          if (queued) { const j = jobRows(X, { ...o, ...h }, row, row.source); j.jobs.forEach(r => { nextJobs.push(r); ops.push({ op: "insert", table: "production_jobs", row: r }); }); j.sjobs.forEach(r => { nextSjobs.push(r); ops.push({ op: "insert", table: "screen_jobs", row: r }); }); }
          nextItems.push(row);
          flags.push(...itemChecks(it, ctx, h, ctx.cust.name, n + 1));
          return;
        }
        seen.add(old.id);
        const specChanged = it.spec_key !== old.spec_key;
        const qtyChanged = it.qty_pcs !== old.qty_pcs || it.bags !== old.bags || it.extra_pcs !== old.extra_pcs;
        const priceChanged = it.price_satang !== old.price_satang || it.price_reason !== old.price_reason;
        const screenChanged = it.screen_color !== old.screen_color;
        const capChanged = it.cap_color !== old.cap_color;
        if (!specChanged && !qtyChanged && !priceChanged && !screenChanged && !capChanged) { nextItems.push(old); return; }
        itemsChanged = true;
        const name = "รายการที่ " + (n + 1) + " (" + old.label + ")";
        if (billed) throw locked("มีบิลแล้ว — แก้รายการไม่ได้ (" + name + ") · ยกเลิกบิลก่อนถ้าจะแก้");
        if ((specChanged || screenChanged || capChanged) && (old.delivered > 0 || old.on_truck > 0)) throw locked(name + " ส่ง/ขึ้นรถไปแล้ว — แก้สเปกไม่ได้ · ให้ลดจำนวนเหลือเท่าที่ส่ง แล้วเพิ่มรายการใหม่");
        if (qtyChanged && it.qty_pcs < old.delivered + old.on_truck) throw locked(name + " ส่ง/ขึ้นรถไปแล้ว " + (old.delivered + old.on_truck).toLocaleString("en-US") + " " + it.unit + " — ลดให้ต่ำกว่านี้ไม่ได้");
        const job = jobOf(old.id), started = jobStarted(job, ctx.runs);
        if (specChanged && started) throw locked(name + " ทีมผลิตเริ่มทำแล้ว — แก้สเปกไม่ได้ · ให้ลบรายการนี้ (ของที่ผลิตแล้วเข้าสต๊อก) แล้วเพิ่มรายการใหม่");
        if (priceChanged) flags.push(...itemChecks({ ...it, offList: [], min_order_pcs: 0 }, ctx, h, ctx.cust.name, n + 1));
        if (specChanged || qtyChanged) flags.push(...itemChecks({ ...it, price_satang: null }, ctx, h, ctx.cust.name, n + 1));
        if (job && job.status === "เสร็จ" && qtyChanged) {
          // ทีมผลิตปิดงานไปแล้ว: เพิ่มจำนวน = งานผลิตใบใหม่เฉพาะส่วนที่เพิ่ม · ลดจำนวน = ไม่ต้องทำอะไร (ส่วนเกินอยู่ในสต๊อก)
          why.push(name + " ทีมผลิตทำเสร็จแล้ว (เปลี่ยนจำนวน)"); flagTeams.add("prod");
          const more = it.qty_pcs - old.qty_pcs - Math.max(0, Number(job.good_pcs) - Number(job.target_pcs));
          if (more > 0) { const r = jobRows(X, { ...o, ...h }, { ...old, ...it, id: old.id, qty_pcs: more }, "ผลิต").jobs[0]; r.note = "เพิ่มจำนวนหลังงานแรกเสร็จ"; nextJobs.push(r); ops.push({ op: "insert", table: "production_jobs", row: r }); }
        } else if (job && (specChanged || qtyChanged)) {
          if (started) { why.push(name + " ทีมผลิตเริ่มทำแล้ว (เปลี่ยนจำนวน)"); flagTeams.add("prod"); }
          touchJob(job, specChanged ? { type: it.type, size: it.size, neck: it.neck, shape: it.shape, color: it.color, spec_key: it.spec_key, target_pcs: it.qty_pcs } : { target_pcs: it.qty_pcs });
        }
        const sj = sjobOf(old.id);
        if (sj && (screenChanged || qtyChanged)) {
          if (sjobStarted(sj)) { why.push(name + " ทีมสกรีนรับงานแล้ว"); flagTeams.add("screen"); }
          if (!it.screen_color) touchSjob(sj, { status: "ยกเลิก", note: "ออฟฟิศเอาสกรีนออก" });
          else touchSjob(sj, { colors: it.screen_color, qty_pcs: it.qty_pcs });
        } else if (!sj && it.screen_color && queued) {
          const r = jobRows(X, { ...o, ...h }, { ...old, ...it, id: old.id }, "").sjobs[0];
          nextSjobs.push(r); ops.push({ op: "insert", table: "screen_jobs", row: r });
        }
        const s = {};
        const row = itemRow(it);
        for (const k of Object.keys(row)) if (String(row[k] ?? "") !== String(old[k] ?? "")) s[k] = row[k];
        const before = ctx.items.find(x => x.id === old.id);
        ops.push({ op: "update", table: "order_items", id: old.id, expect: before.version, before, set: s });
        nextItems.push({ ...old, ...s });
      });
      // ── รายการที่ถูกเอาออก ──
      for (const old of cur.items) {
        if (seen.has(old.id)) continue;
        itemsChanged = true;
        const name = "รายการ " + old.label;
        if (billed) throw locked("มีบิลแล้ว — เอารายการออกไม่ได้ (" + name + ") · ยกเลิกบิลก่อน");
        if (old.delivered > 0 || old.on_truck > 0) throw locked(name + " ส่ง/ขึ้นรถไปแล้ว — เอาออกไม่ได้ · ให้ลดจำนวนเหลือเท่าที่ส่งแทน");
        const job = jobOf(old.id), sj = sjobOf(old.id);
        if (jobStarted(job, ctx.runs)) { why.push(name + " ทีมผลิตเริ่มทำแล้ว (เอาออก — ของที่ผลิตแล้วอยู่ในสต๊อก)"); flagTeams.add("prod"); }
        if (sjobStarted(sj)) { why.push(name + " ทีมสกรีนรับงานแล้ว"); flagTeams.add("screen"); }
        if (job && job.status !== "เสร็จ") touchJob(job, { status: "ยกเลิก", note: "ออฟฟิศเอารายการออก" });
        if (sj && sj.status !== "เสร็จแล้ว") touchSjob(sj, { status: "ยกเลิก", note: "ออฟฟิศเอารายการออก" });
        const before = ctx.items.find(x => x.id === old.id);
        ops.push({ op: "update", table: "order_items", id: old.id, expect: before.version, before, set: { status: "ยกเลิก" } });
      }
      if (!nextItems.length) throw bad("ต้องเหลือสินค้าอย่างน้อย 1 รายการ — ถ้าไม่เอาทั้งใบให้กด \"ยกเลิกออเดอร์\"");
      // วันส่ง/ด่วน ไหลไปงานผลิต/สกรีนที่ยังไม่เสร็จ
      if ("due_day" in set || "urgent" in set) {
        for (const j of nextJobs) if (j.status !== "ยกเลิก" && j.status !== "เสร็จ" && ctx.jobs.some(x => x.id === j.id) && (j.due_day !== h.due_day || j.urgent !== h.urgent)) {
          const s = { due_day: h.due_day, urgent: h.urgent };
          const prior = ops.find(x => x.op === "update" && x.table === "production_jobs" && x.id === j.id);
          if (prior) Object.assign(prior.set, s); else touchJob(j, s);
        }
        for (const j of nextSjobs) if (j.status !== "ยกเลิก" && j.status !== "เสร็จแล้ว" && ctx.sjobs.some(x => x.id === j.id) && j.due_day !== h.due_day) {
          const prior = ops.find(x => x.op === "update" && x.table === "screen_jobs" && x.id === j.id);
          if (prior) Object.assign(prior.set, { due_day: h.due_day }); else touchSjob(j, { due_day: h.due_day });
        }
        for (const r of ops) if (r.op === "insert" && (r.table === "production_jobs" || r.table === "screen_jobs")) { r.row.due_day = h.due_day; if (r.table === "production_jobs") r.row.urgent = h.urgent; }
      }
      if (!itemsChanged && !Object.keys(set).length) throw bad("ไม่มีอะไรเปลี่ยน");
      if (why.length && !X.reason) throw needReason(why);
      if (itemsChanged) {
        set.has_screen = nextItems.some(i => i.screen_color) ? 1 : 0;
        set.total_satang = nextItems.every(i => i.price_satang !== null) ? nextItems.reduce((s, i) => s + i.price_satang * i.qty_pcs, 0) : null;
      }
      const d = deriveOrder({ ...o, ...set }, nextItems, nextJobs, nextSjobs, ctx.loads);
      Object.assign(set, statusSet(o, d, X) || {});
      for (const k of Object.keys(set)) if (String(set[k] ?? "") === String(o[k] ?? "")) delete set[k];
      if (Object.keys(set).length) ops.unshift({ op: "update", table: "orders", id: o.id, expect: o.version, before: o, set });
      else ops.unshift({ op: "guard", sql: "SELECT 1 FROM orders WHERE id = ? AND version = ?", args: [o.id, o.version] });
      for (const t of flagTeams) ops.push({ op: "flag", kind: "แก้ออเดอร์หลังเริ่มงาน", team: t, entity: "orders", entity_id: o.id, severity: "ดู",
        title: (ctx.cust ? ctx.cust.name : "") + ": ออฟฟิศแก้ออเดอร์หลัง" + (t === "prod" ? "ทีมผลิต" : "ทีมสกรีน") + "เริ่มงาน", detail: why.join(" · ") + " · เหตุผล: " + X.reason });
      flags.forEach(f => ops.push({ ...f, entity: "orders", entity_id: o.id }));
      return { label: "แก้ออเดอร์ " + (ctx.cust ? ctx.cust.name : ""), ops, result: { id: o.id, status: d.status }, conflictMessage: "มีคนแก้ออเดอร์นี้ หรือทีมผลิต/สกรีนรับงานไปพร้อมกัน — โหลดใหม่แล้วลองอีกครั้ง" };
    },
  });

  // ══ ยกเลิก (เหตุผลบังคับ) — ส่งไปบางส่วนแล้ว = ปิดออเดอร์ที่จำนวนเท่าที่ส่ง ════════════════════
  R.define({
    name: "office.order_cancel", roles: ROLES_OFFICE, write: true, reason: "required",
    input: raw => ({ id: need(raw.id, "ออเดอร์", 40), version: int(raw.version, "รุ่นของออเดอร์", { min: 1 }) }),
    load: (X, input) => loadOrder(X, input.id),
    async run(X, input, ctx) {
      const o = ctx.o;
      if (o.version !== input.version) throw conflict();
      if (o.status === "ยกเลิก") throw new Fail(409, "already", "ออเดอร์นี้ยกเลิกไปแล้ว");
      if (ctx.bills.length) throw locked("มีบิลแล้ว — ยกเลิกบิลก่อน (กด \"ยกเลิกบิล\" ในหน้าบิล) แล้วค่อยยกเลิกออเดอร์", { bill_no: ctx.bills[0].bill_no });
      const d = deriveOrder(o, ctx.items, ctx.jobs, ctx.sjobs, ctx.loads);
      if (d.items.some(i => i.on_truck > 0)) throw locked("มีของของออเดอร์นี้อยู่บนรถ — ให้ทีมส่งของบันทึกส่งแล้ว/คืนคลังก่อน แล้วค่อยยกเลิก");
      const partial = d.items.some(i => i.delivered > 0);
      if (o.src !== "v2" && partial) throw locked("ออเดอร์จากแอปเดิมที่ส่งไปแล้ว — ยกเลิกในแอปเดิม");
      const ops = [];
      const startedTeams = new Set();
      for (const j of ctx.jobs) if (j.status !== "ยกเลิก" && j.status !== "เสร็จ") {
        if (jobStarted(j, ctx.runs)) startedTeams.add("prod");
        ops.push({ op: "update", table: "production_jobs", id: j.id, expect: j.version, before: j, set: { status: "ยกเลิก", note: "ออเดอร์ถูกยกเลิก" } });
      }
      for (const j of ctx.sjobs) if (j.status !== "ยกเลิก" && j.status !== "เสร็จแล้ว") {
        if (sjobStarted(j)) startedTeams.add("screen");
        ops.push({ op: "update", table: "screen_jobs", id: j.id, expect: j.version, before: j, set: { status: "ยกเลิก", note: "ออเดอร์ถูกยกเลิก" } });
      }
      let set;
      if (partial) {   // รับแค่ที่ส่งไปแล้ว: ตัดจำนวนเหลือเท่าที่ส่ง · รายการที่ยังไม่ได้ส่งเลย = ยกเลิก
        for (const it of d.items) {
          const before = ctx.items.find(x => x.id === it.id);
          if (it.delivered >= it.qty_pcs) continue;
          if (it.delivered === 0) ops.push({ op: "update", table: "order_items", id: it.id, expect: before.version, before, set: { status: "ยกเลิก" } });
          else ops.push({ op: "update", table: "order_items", id: it.id, expect: before.version, before, set: { ...splitBags(it.delivered, before.per_bag), note: [before.note, "ตัดจาก " + before.qty_pcs.toLocaleString("en-US") + " เหลือเท่าที่ส่ง"].filter(Boolean).join(" · ") } });
        }
        const kept = d.items.filter(i => i.delivered > 0);
        set = { status: "ส่งแล้ว", cancel_reason: X.reason, delivered_day: o.delivered_day || thaiDay(X.now),
          total_satang: kept.every(i => i.price_satang !== null) ? kept.reduce((s, i) => s + i.price_satang * Math.min(i.delivered, i.qty_pcs), 0) : null };
      } else set = { status: "ยกเลิก", cancel_reason: X.reason };
      ops.unshift({ op: "update", table: "orders", id: o.id, expect: o.version, before: o, set });
      for (const t of startedTeams) ops.push({ op: "flag", kind: "แก้ออเดอร์หลังเริ่มงาน", team: t, entity: "orders", entity_id: o.id,
        title: (ctx.cust ? ctx.cust.name : "") + ": ออฟฟิศยกเลิกออเดอร์ที่" + (t === "prod" ? "ทีมผลิต" : "ทีมสกรีน") + "เริ่มทำแล้ว", detail: "เหตุผล: " + X.reason + (t === "prod" ? " · ของที่ผลิตแล้วอยู่ในสต๊อก" : "") });
      return { label: (partial ? "ปิดออเดอร์ (รับแค่ที่ส่ง) " : "ยกเลิกออเดอร์ ") + (ctx.cust ? ctx.cust.name : ""), ops, result: { id: o.id, status: set.status, partial } };
    },
  });

  // ══ ลูกค้ามารับเองที่โรงงาน (ส่งเป็นงวดได้) — ลงของออก + ตัดสต๊อก ════════════════════════
  R.define({
    name: "office.order_pickup", roles: ROLES_OFFICE, write: true,
    undo: { guard: billAfterGuard("SELECT ?") },   // ออกบิลหลังลูกค้ารับของแล้ว = ย้อนการรับไม่ได้ (undo_log.entity_id = ออเดอร์)
    input: raw => {
      if (!Array.isArray(raw.lines) || !raw.lines.length) throw bad("ต้องใส่จำนวนที่ลูกค้ารับอย่างน้อย 1 รายการ");
      const lines = raw.lines.map((l, i) => ({ item_id: need(l.item_id, "รายการ", 60), qty_pcs: int(l.qty_pcs, "จำนวนที่รับ (รายการที่ " + (i + 1) + ")", { min: 0, max: 10000000 }) })).filter(l => l.qty_pcs > 0);
      if (!lines.length) throw bad("ต้องใส่จำนวนที่ลูกค้ารับ");
      return { id: need(raw.id, "ออเดอร์", 40), version: int(raw.version, "รุ่นของออเดอร์", { min: 1 }), lines, note: text(raw.note, 200, "หมายเหตุ") };
    },
    async load(X, input) {
      const c = await loadOrder(X, input.id, [...CATALOG_READS]);
      c.cat = catalogOf(c.more.slice(0, 3));
      c.bal = await X.db.all("SELECT b.item_key, b.grade, b.qty_pcs FROM stock_balance b WHERE EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = ? AND substr(b.item_key, 1, length('spec:' || i.spec_key)) = 'spec:' || i.spec_key)", input.id);
      return c;
    },
    async run(X, input, ctx) {
      const o = ctx.o;
      if (o.version !== input.version) throw conflict();
      if (o.status === "ยกเลิก") throw locked("ออเดอร์นี้ยกเลิกแล้ว");
      const d = deriveOrder(o, ctx.items, ctx.jobs, ctx.sjobs, ctx.loads);
      if (new Set(input.lines.map(l => l.item_id)).size !== input.lines.length) throw bad("รายการซ้ำกัน");
      const ops = [], why = [], loads = [], items = [], moves = [];
      const at = iso(X.now), dd = thaiDay(X.now);
      for (const l of input.lines) {
        const it = d.items.find(i => i.id === l.item_id);
        if (!it) throw conflict("รายการนี้ถูกเปลี่ยน/ยกเลิกไปแล้ว — โหลดใหม่");
        const left = it.qty_pcs - it.delivered - it.on_truck;
        if (l.qty_pcs > left) why.push(it.label + " รับ " + l.qty_pcs.toLocaleString("en-US") + " เกินที่ค้าง " + Math.max(0, left).toLocaleString("en-US"));
        const id = "LD" + X.newId();
        // กุญแจสต๊อกแบบเดียวกับโมดูลส่งของ: มีสกรีน = ขวดสกรีนแล้ว (spec:…|สกรีน <สี>) · ไม่มี = ขวดเปล่า · สีเกรด B = สต๊อกเกรด B
        const sj = ctx.sjobs.find(j => j.order_item_id === it.id && j.status !== "ยกเลิก");
        const key = sj || it.screen_color ? screenKey(it, sj) : plainKey(it);
        const grade = key === plainKey(it) ? gradeOf(ctx.cat, it.color) : "A";
        const row = { id, trip_id: null, order_id: o.id, order_item_id: it.id, qty_pcs: l.qty_pcs, status: "ส่งแล้ว", loaded_at: at, loaded_by: X.staff.id, done_at: at, done_day: dd, done_by: X.staff.id,
          stock_key: key, note: ["ลูกค้ารับที่โรงงาน", input.note].filter(Boolean).join(" · "), src: "v2" };
        loads.push(row);
        ops.push({ op: "insert", table: "delivery_loads", row });
        const mv = { op: "move", item_key: key, label: it.label + (key !== plainKey(it) ? " สกรีน " + key.split("|สกรีน ")[1] : ""), grade, qty_pcs: -l.qty_pcs, move_type: "ส่งออก", ref_entity: "delivery_loads", ref_id: id, reason: "ลูกค้ารับที่โรงงาน" };
        ops.push(mv);
        moves.push(mv);
        const before = ctx.items.find(x => x.id === it.id);
        const nd = (Number(before.delivered_pcs) || 0) + l.qty_pcs;
        ops.push({ op: "update", table: "order_items", id: it.id, expect: before.version, before, set: { delivered_pcs: Math.max(nd, it.delivered + l.qty_pcs) } });
        items.push({ ...before, delivered_pcs: Math.max(nd, it.delivered + l.qty_pcs) });
      }
      if (why.length && !X.reason) throw needReason(why);
      for (const g of ["A", "B"]) negativeStockFlags(ctx.bal.filter(b => b.grade === g), moves.filter(m => m.grade === g), "office").forEach(f => ops.push(f));
      if (why.length) ops.push({ op: "flag", kind: "ทำนอกขั้นตอน", team: "office", entity: "orders", entity_id: o.id, title: (ctx.cust ? ctx.cust.name : "") + ": ลูกค้ารับเกินที่สั่ง", detail: why.join(" · ") + " · เหตุผล: " + X.reason });
      const nd = deriveOrder(o, ctx.items.map(i => items.find(x => x.id === i.id) || i), ctx.jobs, ctx.sjobs, [...ctx.loads, ...loads]);
      const set = statusSet(o, nd, X);
      ops.unshift(set ? { op: "update", table: "orders", id: o.id, expect: o.version, before: o, set } : { op: "guard", sql: "SELECT 1 FROM orders WHERE id = ? AND version = ?", args: [o.id, o.version] });
      return { label: "ลูกค้ารับของ " + (ctx.cust ? ctx.cust.name : ""), ops, result: { id: o.id, status: nd.status, loads: loads.map(l => l.id) } };
    },
  });
}
