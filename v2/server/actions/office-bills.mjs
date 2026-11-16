// ============================================================
//  ออฟฟิศ — ออกบิลจากออเดอร์ (เงินสด / เครดิต+กำหนดชำระ) · ยกเลิกบิลที่ยังไม่มีใครแตะ           v2/server/actions/office-bills.mjs
//  ความหมายเดียวกับแท็บ Bills ของ PKSystem (ตาราง map ใน v2/db/SCHEMA.md) · ห้ามเขียนชีทบัญชี (ที่นี่ไม่มีทางเขียนอยู่แล้ว)
//  กติกาเงิน (PALM-WAY §2 ข้อ 6 · §4):
//   · ประเภทบิลไม่มีค่าตั้งต้น ต้องกดเอง · บิลที่ออฟฟิศออก = "ค้างชำระ" เสมอ — รับเงินจริงเป็นงานของบัญชี (bill_payments + ช่องทางที่ต้องเลือกเอง)
//   · ออเดอร์หนึ่งใบมีบิลได้ใบเดียว (ดัชนี bills_one_per_order) — มีบิลแล้ว = พิมพ์ใบเดิม ไม่ออกใหม่
//   · ราคาในบิลต่างจากที่ลงในออเดอร์ / จำนวนเกินที่สั่ง = ทำได้ + เหตุผล + ธง
//   · ยกเลิกบิล: ได้เฉพาะบิลที่ยังไม่ผูกเลขบิลกระดาษและยังไม่มีรับชำระ (นอกนั้นเป็นเรื่องของบัญชี — ข้อความบอกตรง ๆ)
// ============================================================
import { Fail, bad, conflict, notFound, need, text, int, oneOf, day, thaiDay, addDays } from "../core.mjs";
import { loadOrder, ROLES_OFFICE } from "./office-orders.mjs";
import { deriveOrder } from "./office-lib.mjs";

const locked = (msg, extra) => new Fail(409, "locked", msg, extra);
const money = s => (Number(s) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });

export function defineOfficeBills(R) {
  R.define({
    name: "office.bill_create", roles: ROLES_OFFICE, write: true,
    onUnique: cols => (/bills\.order_id|order_id/.test(cols) ? conflict("ออเดอร์นี้มีบิลแล้ว (อีกเครื่องเพิ่งออก) — โหลดใหม่แล้วพิมพ์ใบเดิม")
      : /bill_no/.test(cols) ? conflict("เลขบิลชนกับอีกเครื่องที่ออกพร้อมกัน — กดออกบิลอีกครั้ง") : null),
    input: raw => {
      if (!Array.isArray(raw.lines) || !raw.lines.length) throw bad("ต้องมีรายการในบิล");
      return {
        order_id: need(raw.order_id, "ออเดอร์", 40), version: int(raw.version, "รุ่นของออเดอร์", { min: 1 }),
        kind: oneOf(raw.kind || "", ["เงินสด", "เครดิต"], "ประเภทบิล (กดเลือก เงินสด / เครดิต)"),
        due_day: day(raw.due_day, "กำหนดชำระ", true), block_fee: !!raw.block_fee, note: text(raw.note, 300, "หมายเหตุ"),
        lines: raw.lines.map((l, i) => ({ item_id: need(l.item_id, "รายการ", 60), qty_pcs: int(l.qty_pcs, "จำนวน (บรรทัด " + (i + 1) + ")", { min: 0, max: 10000000 }),
          price_satang: int(l.price_satang, "ราคาต่อหน่วย (บรรทัด " + (i + 1) + ")", { min: 0, max: 10000000 }) })),
      };
    },
    async load(X, input) {
      const prefix = "PK2-" + thaiDay(X.now).slice(0, 4) + "-";
      const c = await loadOrder(X, input.order_id, [["SELECT max(CAST(substr(bill_no, ?) AS INTEGER)) AS n FROM bills WHERE substr(bill_no, 1, ?) = ?", prefix.length + 1, prefix.length, prefix]]);
      c.billNo = prefix + String((Number(c.more[0][0] && c.more[0][0].n) || 0) + 1).padStart(4, "0");
      return c;
    },
    async run(X, input, ctx) {
      const o = ctx.o;
      if (o.version !== input.version) throw conflict("ออเดอร์นี้เพิ่งถูกแก้ — โหลดใหม่ แล้วเช็คจำนวน/ราคาในบิลอีกครั้ง");
      if (o.status === "ยกเลิก") throw locked("ออเดอร์นี้ยกเลิกแล้ว — ออกบิลไม่ได้");
      if (ctx.bills.length) throw new Fail(409, "has_bill", "ออเดอร์นี้มีบิลแล้ว — พิมพ์ใบเดิม ไม่ออกใหม่", { bill_no: ctx.bills[0].bill_no });
      const today = thaiDay(X.now);
      let due = "";
      if (input.kind === "เครดิต") {
        if (!input.due_day) throw bad("บิลเครดิตต้องมีกำหนดชำระ");
        if (input.due_day < today) throw bad("กำหนดชำระอยู่ก่อนวันนี้");
        due = input.due_day;
      }
      const d = deriveOrder(o, ctx.items, ctx.jobs, ctx.sjobs, ctx.loads);
      if (new Set(input.lines.map(l => l.item_id)).size !== input.lines.length) throw bad("รายการซ้ำกัน");
      const why = [], lines = [];
      for (const l of input.lines) {
        const it = d.items.find(i => i.id === l.item_id);
        if (!it) throw conflict("รายการในบิลไม่ตรงกับออเดอร์ (อาจถูกแก้) — โหลดใหม่");
        if (!l.qty_pcs) continue;
        if (l.qty_pcs > it.qty_pcs) why.push(it.label + " ในบิล " + l.qty_pcs.toLocaleString("en-US") + " เกินที่สั่ง " + it.qty_pcs.toLocaleString("en-US"));
        if (it.price_satang !== null && it.price_satang !== l.price_satang) why.push(it.label + " ราคาในบิล ฿" + money(l.price_satang) + " ต่างจากที่ลงในออเดอร์ ฿" + money(it.price_satang));
        lines.push({ item_id: it.id, label: it.label, screen: it.screen_color, cap: it.cap_color, qty_pcs: l.qty_pcs, bags: it.per_bag ? Math.floor(l.qty_pcs / it.per_bag) : 0, per_bag: it.per_bag,
          unit: it.type === "ขวด" || it.type === "ถัง" ? "ใบ" : "ชิ้น", price_satang: l.price_satang, amount_satang: l.qty_pcs * l.price_satang });
      }
      if (!lines.length) throw bad("ใส่จำนวนในบิลอย่างน้อย 1 รายการ");
      if (input.block_fee) {
        if (!o.block_fee_satang) throw bad("ออเดอร์นี้ไม่มีค่าบล็อก");
        lines.push({ label: "ค่าบล็อกสกรีน", qty_pcs: 1, unit: "งาน", price_satang: o.block_fee_satang, amount_satang: o.block_fee_satang });
      }
      const total = lines.reduce((s, l) => s + l.amount_satang, 0);
      if (total <= 0) throw bad("ยอดบิลเป็น 0 — ใส่ราคาต่อหน่วย");
      if (why.length && !X.reason) throw new Fail(400, "need_reason", "ต้องใส่เหตุผล: " + why.join(" · "), { needReason: true, why });
      const custName = (ctx.cust && ctx.cust.name) || o.customer_text;
      const row = { bill_no: ctx.billNo, bill_day: today, customer_id: o.customer_id, customer_name: custName, order_id: o.id, total_satang: total, kind: input.kind,
        pay_channel: "", status: "ค้างชำระ", due_day: due, paid_day: "", paid_satang: 0, items_json: JSON.stringify(lines), note: input.note, src: "v2", by_name: X.staff.nick };
      const ops = [
        { op: "guard", sql: "SELECT 1 FROM orders WHERE id = ? AND version = ?", args: [o.id, o.version] },
        { op: "insert", table: "bills", row },
      ];
      if (why.length) ops.push({ op: "flag", kind: "ยอดไม่ตรง", team: "office", entity: "bills", entity_id: row.bill_no, title: custName + ": บิลไม่ตรงกับออเดอร์", detail: why.join(" · ") + " · เหตุผล: " + X.reason });
      return { label: "ออกบิล " + custName + " ฿" + money(total), ops, result: { bill_no: row.bill_no, total_satang: total, kind: input.kind, due_day: due },
        conflictMessage: "ออเดอร์นี้เพิ่งถูกแก้ — โหลดใหม่ แล้วเช็คจำนวน/ราคาในบิลอีกครั้ง" };
    },
  });

  R.define({
    name: "office.bill_cancel", roles: ROLES_OFFICE, write: true, reason: "required",
    input: raw => ({ bill_no: need(raw.bill_no, "เลขบิล", 40), version: int(raw.version, "รุ่นของบิล", { min: 1 }) }),
    async load(X, input) {
      const [b, p] = await X.db.reads([["SELECT * FROM bills WHERE bill_no = ?", input.bill_no], ["SELECT count(*) AS n FROM bill_payments WHERE bill_no = ? AND status = 'ใช้ได้'", input.bill_no]]);
      if (!b[0]) throw notFound("ไม่พบบิลนี้");
      return { b: b[0], paid: p[0].n };
    },
    async run(X, input, ctx) {
      const b = ctx.b;
      if (b.version !== input.version) throw conflict();
      if (b.status === "ยกเลิก") throw new Fail(409, "already", "บิลนี้ยกเลิกไปแล้ว");
      if (b.src !== "v2") throw locked("บิลนี้มาจากชีทบัญชี/ระบบเดิม — ยกเลิกที่ต้นทาง");
      if (ctx.paid || b.paid_satang > 0 || b.status === "ชำระแล้ว") throw locked("บิลนี้มีรับชำระแล้ว — ให้ฝ่ายบัญชีจัดการ (ยกเลิกรับชำระก่อน)");
      if (b.paper_no) throw locked("ฝ่ายบัญชีผูกเลขบิลกระดาษ " + b.paper_no + " แล้ว — ให้ฝ่ายบัญชียกเลิก");
      if (b.stmt_no) throw locked("บิลอยู่ในใบวางบิล " + b.stmt_no + " — จัดการใบวางบิลก่อน");
      return { label: "ยกเลิกบิล " + b.customer_name, result: { bill_no: b.bill_no },
        ops: [{ op: "update", table: "bills", id: b.bill_no, expect: b.version, before: b, set: { status: "ยกเลิก", cancel_reason: X.reason } }] };
    },
  });
}

/** กำหนดชำระที่แนะนำ (หน้าเว็บตั้งให้ แก้ได้): เครดิตตามทะเบียนลูกค้า หรือค่าตั้ง CREDIT_DAYS_DEFAULT */
export const suggestDue = (X, cust) => addDays(thaiDay(X.now), Number(cust && cust.credit_days) || Number(X.settings.CREDIT_DAYS_DEFAULT || 30));
