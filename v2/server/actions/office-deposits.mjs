// ============================================================
//  ออฟฟิศ — มัดจำต่อออเดอร์ (บันทึกได้หลายครั้ง)                                                    v2/server/actions/office-deposits.mjs
//  · เงิน = สตางค์ · ช่องทางต้องเลือกเอง (ไม่มีค่าตั้งต้น — "อะไรที่เกี่ยวกับการเก็บเงิน ไม่ตั้งต้นเป็นเงินสดหรือโอน")
//  · เห็น/ลงได้เฉพาะบทบาทที่เห็นเงินอยู่แล้ว (ออฟฟิศ · บัญชี · ประธาน) — ทีมผลิต/สกรีน/ส่งของ = 403
//  · ไม่หักยอดบิลเอง (เรื่องเงินห้ามเดา) — แค่โชว์ "มัดจำแล้ว X" ในหน้าบิล + ธงตอนออกบิลให้บัญชีตัดสิน
//  · ยกเลิก = สถานะ + เหตุผล (ไม่ลบ) · ย้อนได้ตามกติกากลาง
// ============================================================
import { Fail, bad, conflict, notFound, need, text, int, day, thaiDay } from "../core.mjs";
import { registerTable } from "../db.mjs";

registerTable("order_deposits", { pk: "id", void: { status: "ยกเลิก" } });
export const ROLES_MONEY = ["office", "account", "exec"];
const baht = s => (Number(s) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
export const depositSum = rows => (rows || []).filter(r => r.status === "ใช้งาน").reduce((s, r) => s + r.amount_satang, 0);
export const DEPOSIT_SQL = "SELECT d.id, d.order_id, d.amount_satang, d.channel, d.paid_day, d.note, d.status, d.cancel_reason, d.version, d.created_at, s.nick AS by_nick FROM order_deposits d LEFT JOIN staff s ON s.id = d.by_staff WHERE d.order_id = ? ORDER BY d.paid_day, d.created_at";

/** ธงตอนออกบิลเมื่อออเดอร์มีมัดจำ (office-bills เรียก) — คนตัดสินว่าจะหักยังไง ระบบไม่หักเอง */
export function depositBillFlag(orderId, custName, deposits, billNo, billSatang) {
  const sum = depositSum(deposits);
  if (!sum) return null;
  return { op: "flag", kind: "มีมัดจำ ตรวจตอนออกบิล", team: "account", entity: "orders", entity_id: orderId, dedupe_key: "deposit-bill:" + orderId,
    title: custName + ": ออกบิล ฿" + baht(billSatang) + " — ออเดอร์นี้มีมัดจำแล้ว ฿" + baht(sum),
    detail: "ระบบไม่หักมัดจำออกจากบิลเอง · บิล " + billNo + " · ตรวจว่าต้องหักมัดจำ/ออกใบรับเงินแยกไหม" };
}
/** เตือนตอนส่งเข้าคิวว่ายังไม่มีมัดจำ — ตามค่าตั้ง DEPOSIT_REMIND (ไม่เตือน / งานสกรีน / ทุกออเดอร์) · ธง ไม่บล็อก */
export function depositRemindFlag(X, order, custName, deposits) {
  const mode = String(X.settings.DEPOSIT_REMIND || "ไม่เตือน");
  if (mode !== "ทุกออเดอร์" && !(mode === "งานสกรีน" && order.has_screen)) return null;
  if (depositSum(deposits) > 0) return null;
  return { op: "flag", kind: "ยังไม่มีมัดจำ", team: "office", entity: "orders", entity_id: order.id, dedupe_key: "deposit-none:" + order.id,
    title: custName + ": ส่งเข้าคิวแล้วแต่ยังไม่มีมัดจำ", detail: "ค่าตั้งตอนนี้: เตือน" + (mode === "งานสกรีน" ? "งานสกรีน" : "ทุกออเดอร์") + " · ไม่บล็อกงาน ให้ตรวจ/โทรตาม" };
}

export function defineOfficeDeposits(R) {
  R.define({
    name: "office.deposits", roles: ROLES_MONEY,
    input: raw => ({ order: need(raw.order, "ออเดอร์", 40) }),
    async run(X, input) {
      const rows = await X.db.all(DEPOSIT_SQL, input.order);
      return { order: input.order, deposits: rows, sum_satang: depositSum(rows), period: "มัดจำทั้งหมดของออเดอร์นี้ (ที่ยังไม่ยกเลิก)" };
    },
  });

  R.define({
    name: "office.deposit_add", roles: ROLES_MONEY, write: true,
    input: raw => ({
      order: need(raw.order, "ออเดอร์", 40),
      amount_satang: int(raw.amount_satang, "ยอดมัดจำ (สตางค์)", { min: 1, max: 10000000000 }),
      channel: need(raw.channel, "ช่องทางรับเงิน (กดเลือกเอง)", 40),
      paid_day: day(raw.paid_day, "วันที่รับมัดจำ"),
      note: text(raw.note, 200, "หมายเหตุ"),
    }),
    async load(X, input) {
      const [o, ch] = await X.db.reads([["SELECT id, status, customer_text, version FROM orders WHERE id = ?", input.order], ["SELECT value FROM vocab WHERE kind = 'pay.channel'"]]);
      if (!o[0]) throw notFound("ไม่พบออเดอร์นี้");
      return { o: o[0], channels: ch.map(r => r.value) };
    },
    async run(X, input, ctx) {
      if (ctx.o.status === "ยกเลิก") throw new Fail(409, "locked", "ออเดอร์นี้ยกเลิกแล้ว — ลงมัดจำไม่ได้ (ถ้าต้องคืนเงินลูกค้า ให้บัญชีลงจ่ายคืน)");
      if (ctx.channels.indexOf(input.channel) < 0) throw bad("ช่องทางรับเงินต้องเป็นหนึ่งใน: " + ctx.channels.join(" / "));
      if (input.paid_day > thaiDay(X.now)) throw bad("วันที่รับมัดจำเป็นวันในอนาคต");
      const id = "DP" + X.newId();
      return {
        label: "มัดจำ ฿" + baht(input.amount_satang) + " · " + ctx.o.customer_text,
        ops: [{ op: "insert", table: "order_deposits", row: { id, order_id: input.order, amount_satang: input.amount_satang, channel: input.channel, paid_day: input.paid_day, note: input.note, status: "ใช้งาน", by_staff: X.staff.id, src: "v2" } }],
        result: { id, order: input.order },
      };
    },
  });

  R.define({
    name: "office.deposit_cancel", roles: ROLES_MONEY, write: true, reason: "required",
    input: raw => ({ id: need(raw.id, "มัดจำ", 40), version: int(raw.version, "รุ่นของรายการ", { min: 1 }) }),
    async load(X, input) { const d = await X.db.first("SELECT * FROM order_deposits WHERE id = ?", input.id); if (!d) throw notFound("ไม่พบรายการมัดจำนี้"); return { d }; },
    async run(X, input, ctx) {
      if (ctx.d.version !== input.version) throw conflict();
      if (ctx.d.status === "ยกเลิก") throw new Fail(409, "already", "รายการนี้ยกเลิกไปแล้ว");
      return { label: "ยกเลิกมัดจำ ฿" + baht(ctx.d.amount_satang), result: { id: input.id },
        ops: [{ op: "update", table: "order_deposits", id: input.id, expect: input.version, before: ctx.d, set: { status: "ยกเลิก", cancel_reason: X.reason } }] };
    },
  });
}
