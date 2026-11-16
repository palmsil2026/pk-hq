// ============================================================
//  แอปบัญชี (?app=account) — "ที่รวมและตรวจ" ไม่ใช่ที่กรอกแทนทีมอื่น                               v2/server/actions/account.mjs
//  หน้าแรก = งานที่รอตรวจ: บิลจากออเดอร์ที่ยังไม่ผูกเลขกระดาษ · ยอดไม่ตรง (รอออฟฟิศ) · ชีทบัญชีจ่ายแล้วแต่แอปยังค้าง · ลูกหนี้ใกล้ครบกำหนด
//  ทุก action ในไฟล์นี้: บทบาท บัญชี + ประธาน เท่านั้น (ตัวเลขเงินกรองที่เซิร์ฟเวอร์ — บทบาทอื่นเรียกได้ 403)
//  กติกา (PALM-WAY §4): ช่องทางรับเงินไม่มีค่าตั้งต้น · ยอดกระดาษ ≠ ออเดอร์ = ไม่ให้ผูก โชว์ทั้งสองเลข ส่งให้ออฟฟิศเช็ค
//    · เลขกระดาษซ้ำวันเดียวกัน = บอกว่าซ้ำกับใคร (ยืนยันว่าคนละใบได้ + เหตุผล + ธง) · แก้/ยกเลิกได้เฉพาะบิลที่ลงจากแอปบัญชี
//    · บิลจากชีทบัญชี = ดูได้ รับชำระ/แก้ในชีท (ไม่เขียนกลับ) · เงินเข้านับตามวันที่ชำระ · ทุกยอดบอกช่วงเวลา
// ============================================================
import { Fail, bad, conflict, notFound, need, text, int, day as dayOf, iso, thaiDay, addDays } from "../core.mjs";
import { nameKey } from "../import/legacy.mjs";
import {
  MONEY_ROLES, AR_WHERE, sourceOf, billOut, payDay, channelOf, MONEY_IN_SQL, moneyInArgs, byChannel, monthStart, monthEnd,
  nextDoc, paperNo, baht, dayGap, isAcct, NO_CHANNEL,
} from "./account-lib.mjs";
import { defineAccountSync } from "./account-sync.mjs";

const gone = msg => new Fail(410, "gone", msg);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k) && o[k] !== undefined;
const bool = v => v === true || v === 1 || v === "1" || v === "true";
const ISSUE_KINDS = "('ยอดไม่ตรง','ชีทบัญชีไม่ตรงแอป','เลขบิลซ้ำ','บิลหายจากชีทบัญชี','นำเข้ามีปัญหา')";
const paperUnique = cols => (/bills\.paper_no/.test(cols) ? conflict("เลขบิลกระดาษนี้เพิ่งถูกใช้กับบิลอื่นในวันเดียวกัน — โหลดใหม่แล้วดูอีกครั้ง") : null);

/** แถวชีทบัญชีที่เป็นบิลใบเดียวกัน: เลขกระดาษเดียวกัน · วันห่างไม่เกิน 7 วัน · ยังไม่ถูกจับคู่กับบิลอื่น
 *  → ใกล้สุด "แท็บละใบ" (บิลเครดิตใบเดียวอยู่ได้ทั้งแท็บรายวันและแท็บลูกหนี้) */
export function pickTwins(rows, billDay, billNo) {
  const best = new Map();
  for (const a of rows) {
    if ((a.same_as && a.same_as !== billNo) || dayGap(a.bill_day, billDay) > 7) continue;
    const k = a.acct_kind || a.src, cur = best.get(k);
    if (!cur || dayGap(a.bill_day, billDay) < dayGap(cur.bill_day, billDay)) best.set(k, a);
  }
  return [...best.values()];
}
/** เลขกระดาษซ้ำกับบิลในแอปใบอื่น วันเดียวกัน */
const dupOf = (rows, billDay, billNo) => rows.find(d => d.bill_day === billDay && d.bill_no !== billNo && d.status !== "ยกเลิก") || null;
const dupFail = (d, paper) => new Fail(409, "dup_paper", "เลขบิล #" + paper + " วันที่ " + d.bill_day + " ใช้กับ " + d.customer_name + " ฿" + baht(d.total_satang) + " ไปแล้ว — ถ้าเป็นคนละใบจริง กดยืนยันพร้อมเหตุผล",
  { dup: { customer_name: d.customer_name, total_satang: d.total_satang, bill_day: d.bill_day } });
const dupFlag = (b, paper, d, reason) => ({ op: "flag", kind: "เลขบิลซ้ำ", team: "account", entity: "bills", entity_id: b.bill_no,
  title: "เลขบิลกระดาษ #" + paper + " ซ้ำวันเดียวกัน: " + b.customer_name + " กับ " + d.customer_name,
  detail: "วันที่ " + b.bill_day + " · ยืนยันว่าคนละใบ เหตุผล: " + reason, dedupe_key: "duppaper:" + b.bill_no });
const payRow = (X, b, amount, channel, day, note) => ({ op: "insert", table: "bill_payments", row: {
  id: "P" + X.newId(), bill_no: b.bill_no, at: iso(X.now), day, amount_satang: amount, channel, status: "ใช้ได้", by: X.staff.id, note: note || "", src: "v2" } });

export function defineAccount(R) {
  defineAccountSync(R);

  // ── หน้าแรก: งานที่รอตรวจ (1 รอบคุยกับฐาน) ─────────────────────────────────────────
  R.define({
    name: "home.account", roles: MONEY_ROLES,
    async run(X) {
      const today = thaiDay(X.now);
      const dueDays = Math.max(0, Math.min(60, parseInt(X.settings.ACCT_DUE_DAYS, 10) >= 0 ? parseInt(X.settings.ACCT_DUE_DAYS, 10) : 7));
      const until = addDays(today, dueDays);
      const [unlinked, issues, sheetPaid, due, owe, inToday, sync] = await X.db.reads([
        [`SELECT b.*, o.order_day, o.brand FROM bills b LEFT JOIN orders o ON o.id = b.order_id
           WHERE b.src = 'v2' AND b.order_id IS NOT NULL AND b.paper_no = '' AND b.status <> 'ยกเลิก' ORDER BY b.bill_day, b.created_at LIMIT 100`],
        [`SELECT id, at, kind, severity, team, title, detail, entity, entity_id, version FROM flags
           WHERE status = 'เปิด' AND kind IN ${ISSUE_KINDS} AND (team IN ('account', '') OR (kind = 'ยอดไม่ตรง' AND entity = 'bills'))
           ORDER BY severity = 'ด่วน' DESC, at DESC LIMIT 50`],
        [`SELECT v.*, a.pay_channel AS sheet_channel, a.paid_day AS sheet_paid_day FROM bills a JOIN bills v ON v.bill_no = a.same_as
           WHERE substr(a.src, 1, 5) = 'acct:' AND a.status = 'ชำระแล้ว' AND v.status = 'ค้างชำระ' ORDER BY v.bill_day LIMIT 50`],
        [`SELECT b.* FROM bills b WHERE ${AR_WHERE} AND b.due_day <> '' AND b.due_day <= ? ORDER BY b.due_day, b.bill_day LIMIT 100`, until],
        [`SELECT count(*) AS n, coalesce(sum(b.total_satang - b.paid_satang), 0) AS satang FROM bills b WHERE ${AR_WHERE}`],
        [MONEY_IN_SQL, ...moneyInArgs(today, today)],
        ["SELECT id, status, started_at, finished_at, inserted, updated, skipped, error FROM sync_runs WHERE source = 'acct' ORDER BY started_at DESC LIMIT 1"],
      ]);
      const chans = byChannel(inToday);
      return {
        asOf: iso(X.now), today, dueDays,
        unlinked: unlinked.map(b => Object.assign(billOut(b), { order_day: b.order_day || "", brand: b.brand || "" })),
        issues: issues.map(f => Object.assign(f, { waiting: f.kind === "ยอดไม่ตรง" ? "ออฟฟิศ" : "" })),
        sheetPaid: sheetPaid.map(b => Object.assign(billOut(b), { sheet_channel: b.sheet_channel, sheet_paid_day: b.sheet_paid_day })),
        due: due.map(b => Object.assign(billOut(b), { late: b.due_day < today })),
        owing: { n: owe[0].n, satang: owe[0].satang, period: "ค้างทั้งหมด ณ " + today },
        moneyIn: { day: today, byChannel: chans, total: chans.reduce((s, c) => s + c.satang, 0), period: "วันนี้ " + today + " · นับตามวันที่ชำระ" },
        sync: sync[0] || null, syncAuto: String(X.settings.ACCT_SYNC_AUTO || "1") !== "0",
      };
    },
  });

  // ── รายการบิล (ใหม่สุดบน) · ค้นชื่อร้าน/เลขกระดาษ ────────────────────────────────────
  R.define({
    name: "account.bills", roles: MONEY_ROLES,
    input: raw => ({
      q: text(raw.q, 60), filter: ["all", "unpaid", "unlinked", "app", "cancelled"].includes(raw.filter) ? raw.filter : "all",
      before: Array.isArray(raw.before) && raw.before.length === 3 ? raw.before.map(x => text(x, 60)) : null,
      limit: int(raw.limit === undefined ? 50 : raw.limit, "จำนวน", { min: 1, max: 100 }),
    }),
    async run(X, input) {
      const w = [], a = [];
      if (input.filter === "unpaid") w.push(AR_WHERE);
      else if (input.filter === "unlinked") w.push("b.src = 'v2' AND b.paper_no = '' AND b.status <> 'ยกเลิก'");
      else if (input.filter === "app") w.push("b.src = 'v2' AND b.origin = 'บัญชี'");
      else if (input.filter === "cancelled") w.push("b.status = 'ยกเลิก'");
      else w.push("b.status <> 'ยกเลิก'");
      if (input.q) { w.push("(b.paper_no = ? OR instr(b.customer_name, ?) > 0)"); a.push(input.q, input.q); }
      else w.push("b.same_as = ''");
      if (input.before) { w.push("(b.bill_day, b.created_at, b.bill_no) < (?, ?, ?)"); a.push(...input.before); }
      const rows = await X.db.all(`SELECT b.* FROM bills b WHERE ${w.join(" AND ")} ORDER BY b.bill_day DESC, b.created_at DESC, b.bill_no DESC LIMIT ?`, ...a, input.limit + 1);
      const more = rows.length > input.limit;
      const list = rows.slice(0, input.limit);
      const last = list[list.length - 1];
      return { asOf: iso(X.now), items: list.map(billOut), next: more && last ? [last.bill_day, last.created_at, last.bill_no] : null };
    },
  });

  // ── รายละเอียดบิล: การรับชำระ · ใบคู่ในชีทบัญชี · ออเดอร์ · ใบวางบิล · ประวัติ ──────────────────
  R.define({
    name: "account.bill", roles: MONEY_ROLES,
    input: raw => ({ bill_no: need(raw.bill_no, "บิล", 80) }),
    async run(X, input) {
      const [[b], pays, twins, audit] = await X.db.reads([
        ["SELECT * FROM bills WHERE bill_no = ?", input.bill_no],
        ["SELECT p.id, p.at, p.day, p.amount_satang, p.channel, p.status, p.note, p.version, p.src, s.nick AS by_nick FROM bill_payments p LEFT JOIN staff s ON s.id = p.by WHERE p.bill_no = ? ORDER BY p.at", input.bill_no],
        ["SELECT * FROM bills WHERE same_as = ? OR bill_no = (SELECT same_as FROM bills WHERE bill_no = ?)", input.bill_no, input.bill_no],
        [`SELECT at, staff_name, action, before_json, after_json, reason, undo_of FROM audit_log WHERE (entity = 'bills' AND entity_id = ?)
           OR (entity = 'bill_payments' AND entity_id IN (SELECT id FROM bill_payments WHERE bill_no = ?)) ORDER BY id DESC LIMIT 20`, input.bill_no, input.bill_no],
      ]);
      if (!b) throw notFound("ไม่พบบิลนี้");
      const [order, items, stmt] = await X.db.reads([
        ["SELECT o.id, o.order_day, o.due_day, o.brand, o.status, o.total_satang FROM orders o WHERE o.id = ?", b.order_id || "-"],
        ["SELECT label, type, size, color, bags, per_bag, qty_pcs, price_satang FROM order_items WHERE order_id = ? AND status = 'ใช้งาน' ORDER BY line_no", b.order_id || "-"],
        ["SELECT stmt_no, stmt_day, status, collect_day, total_satang, version FROM statements WHERE stmt_no = ?", b.stmt_no || "-"],
      ]);
      return {
        asOf: iso(X.now), bill: billOut(b), payments: pays, twins: twins.map(billOut),
        order: order[0] ? Object.assign(order[0], { items }) : null, statement: stmt[0] || null, history: audit,
      };
    },
  });

  // ── ลูกค้าที่แนะนำตอนลงบิล (พิมพ์แล้วเด้ง — ร้านที่มีบิลล่าสุดขึ้นก่อน) ───────────────────────────
  R.define({
    name: "account.customers", roles: MONEY_ROLES,
    input: raw => ({ q: text(raw.q, 60) }),
    async run(X, input) {
      const k = nameKey(input.q);
      const rows = await X.db.all(`SELECT c.id, c.name, c.route_code, c.district, c.credit_days, (SELECT max(bill_day) FROM bills WHERE customer_id = c.id) AS last_day
        FROM customers c WHERE c.merged_into IS NULL AND c.status = 'ใช้งาน' AND (? = '' OR instr(c.name_key, ?) > 0)
        ORDER BY coalesce(last_day, '') DESC, c.name LIMIT 12`, k, k);
      return { items: rows };
    },
  });

  // ── ผูกเลขบิลกระดาษกับบิลจากออเดอร์ (ใบเดิม ไม่สร้างซ้ำ) ───────────────────────────────────
  R.define({
    name: "account.link", roles: MONEY_ROLES, write: true, label: "ผูกเลขบิลกระดาษ", onUnique: paperUnique,
    input: (raw, X) => ({
      bill_no: need(raw.bill_no, "บิล", 80), version: int(raw.version, "รุ่นของรายการ", { min: 1 }), paper_no: paperNo(raw.paper_no),
      paper_satang: int(raw.paper_satang, "ยอดบนบิลกระดาษ (สตางค์)", { min: 1 }), channel: channelOf(raw.channel, true),
      pay_day: raw.pay_day ? payDay(raw.pay_day, X) : thaiDay(X.now), force_dup: bool(raw.force_dup),
    }),
    async load(X, input) {
      const [[b], dups, sheet, oldTwins] = await X.db.reads([
        ["SELECT * FROM bills WHERE bill_no = ?", input.bill_no],
        ["SELECT bill_no, bill_day, customer_name, total_satang, status FROM bills WHERE src = 'v2' AND paper_no = ? AND status <> 'ยกเลิก' AND bill_no <> ?", input.paper_no, input.bill_no],
        ["SELECT * FROM bills WHERE substr(src, 1, 5) = 'acct:' AND paper_no = ? AND status <> 'ยกเลิก'", input.paper_no],
        ["SELECT * FROM bills WHERE same_as = ?", input.bill_no],
      ]);
      if (!b) throw notFound("ไม่พบบิลนี้");
      return { b, dups, sheet, oldTwins };
    },
    async run(X, input, ctx) {
      const b = ctx.b;
      if (isAcct(b)) throw bad("บิลนี้มาจากชีทบัญชี — เลขบิลอยู่ในชีทแล้ว");
      if (b.src !== "v2") throw bad(sourceOf(b).why);
      if (b.status === "ยกเลิก") throw gone("บิลนี้ถูกยกเลิกแล้ว");
      if (b.version !== input.version) throw conflict();
      const relink = !!b.paper_no;
      if (relink && b.paper_no === input.paper_no) throw conflict("บิลนี้ผูกเลข #" + b.paper_no + " ไว้แล้ว");
      if (relink && !X.reason) throw bad("บิลนี้ผูกเลข #" + b.paper_no + " ไว้แล้ว — เปลี่ยนเลขต้องมีเหตุผล");
      if (input.paper_satang !== b.total_satang) {
        throw new Fail(409, "mismatch", "ยอดไม่ตรง — บนบิลกระดาษ ฿" + baht(input.paper_satang) + " แต่ในระบบ ฿" + baht(b.total_satang) + " · บัญชีไม่ต้องแก้บิลจากออเดอร์ ส่งให้ออฟฟิศเช็ค",
          { paper_satang: input.paper_satang, bill_satang: b.total_satang, bill_no: b.bill_no });
      }
      const twins = pickTwins(ctx.sheet, b.bill_day, b.bill_no);
      const off = twins.find(a => a.total_satang !== b.total_satang);
      if (off) {
        throw new Fail(409, "mismatch_sheet", "ยอดไม่ตรงกับชีทบัญชี — บิลเลข #" + input.paper_no + " ในชีทลงไว้ ฿" + baht(off.total_satang) + " แต่บิลนี้ ฿" + baht(b.total_satang) + " — ตรวจที่ชีทบัญชีก่อน",
          { sheet_satang: off.total_satang, bill_satang: b.total_satang });
      }
      const dup = dupOf(ctx.dups, b.bill_day, b.bill_no);
      if (dup && !input.force_dup) throw dupFail(dup, input.paper_no);
      if (dup && !X.reason) throw bad("ยืนยันเลขซ้ำต้องมีเหตุผล");
      const set = { paper_no: input.paper_no, paper_dup_ok: dup ? 1 : 0 };
      const ops = [];
      let paid = false;
      if (b.kind === "เงินสด" && b.status === "ค้างชำระ") {   // บิลเงินสด = รับเงินไปในตัว (ต้องเลือกช่องทางเอง)
        if (!input.channel) throw bad("บิลเงินสด: เลือกว่าเงินเข้าทางไหน (" + "เงินสด / KBank / KTB / BBL / เช็ค" + ")");
        const amount = b.total_satang - b.paid_satang;
        if (amount > 0) ops.push(payRow(X, b, amount, input.channel, input.pay_day, "รับตอนผูกเลขบิล #" + input.paper_no));
        Object.assign(set, { status: "ชำระแล้ว", paid_satang: b.total_satang, paid_day: input.pay_day, pay_channel: input.channel });
        paid = true;
      }
      ops.unshift({ op: "update", table: "bills", id: b.bill_no, expect: b.version, before: b, set });
      const keep = new Set(twins.map(a => a.bill_no));
      for (const t of ctx.oldTwins) if (!keep.has(t.bill_no)) ops.push({ op: "update", table: "bills", id: t.bill_no, expect: t.version, before: t, set: { same_as: "" } });
      for (const a of twins) if (a.same_as !== b.bill_no) ops.push({ op: "update", table: "bills", id: a.bill_no, expect: a.version, before: a, set: { same_as: b.bill_no } });
      if (dup) ops.push(dupFlag(b, input.paper_no, dup, X.reason));
      return { label: "ผูกเลข #" + input.paper_no + " · " + b.customer_name + (paid ? " · รับเงิน " + (input.channel === "เงินสด" ? "เงินสด" : input.channel) : ""),
        result: { bill_no: b.bill_no, paid, twin: twins.length > 0 }, ops };
    },
  });

  // ── ยอดกระดาษไม่ตรง → ส่งให้ออฟฟิศเช็ค (ธง — ไม่บล็อกใคร) ─────────────────────────────────
  R.define({
    name: "account.mismatch_report", roles: MONEY_ROLES, write: true, label: "ส่งให้ออฟฟิศเช็คยอด",
    input: raw => ({ bill_no: need(raw.bill_no, "บิล", 80), paper_satang: int(raw.paper_satang, "ยอดบนบิลกระดาษ (สตางค์)", { min: 1 }), paper_no: paperNo(raw.paper_no, true) }),
    async load(X, input) {
      const b = await X.db.first("SELECT * FROM bills WHERE bill_no = ?", input.bill_no);
      if (!b) throw notFound("ไม่พบบิลนี้");
      return { b };
    },
    async run(X, input, ctx) {
      const b = ctx.b;
      if (b.src !== "v2") throw bad(sourceOf(b).why);
      if (input.paper_satang === b.total_satang) throw bad("ยอดตรงกันแล้ว — ผูกเลขได้เลย");
      return {
        label: "ส่งให้ออฟฟิศเช็คยอด " + b.customer_name, result: { bill_no: b.bill_no },
        ops: [
          { op: "note", entity: "bills", entity_id: b.bill_no, after: { paper_satang: input.paper_satang, bill_satang: b.total_satang, paper_no: input.paper_no } },
          { op: "flag", kind: "ยอดไม่ตรง", team: "office", severity: "ดู", entity: "bills", entity_id: b.bill_no,
            title: "ยอดบิลกระดาษไม่ตรงกับออเดอร์: " + b.customer_name,
            detail: "บนบิลกระดาษ" + (input.paper_no ? " #" + input.paper_no : "") + " ฿" + baht(input.paper_satang) + " · ในระบบ ฿" + baht(b.total_satang) + " (บิลวันที่ " + b.bill_day + ") — ออฟฟิศเช็คแล้วแก้ที่ออเดอร์ แล้วบัญชีผูกเลขใหม่",
            dedupe_key: "mismatch:" + b.bill_no },
        ],
      };
    },
  });

  // ── ลงบิลในแอปบัญชี (บิลที่ไม่ได้มาจากออเดอร์) ─────────────────────────────────────────
  R.define({
    name: "account.bill_create", roles: MONEY_ROLES, write: true, label: "ลงบิล", onUnique: paperUnique,
    input: (raw, X) => {
      const today = thaiDay(X.now);
      const bill_day = raw.bill_day ? dayOf(raw.bill_day, "วันที่บิล") : today;
      if (bill_day > today) throw bad("วันที่บิลเป็นวันในอนาคตไม่ได้");
      if (bill_day < addDays(today, -400)) throw bad("วันที่บิลย้อนหลังเกิน 1 ปี — ตรวจวันที่อีกครั้ง");
      const kind = raw.kind === "เงินสด" || raw.kind === "เครดิต" ? raw.kind : null;
      if (!kind) throw bad("เลือกประเภทบิล: เงินสด / เครดิต");
      const due_day = kind === "เครดิต" ? dayOf(raw.due_day, "กำหนดชำระ", true) : "";
      if (due_day && due_day < bill_day) throw bad("กำหนดชำระต้องไม่ก่อนวันที่บิล");
      const channel = kind === "เงินสด" ? channelOf(raw.channel) : "";
      const customer_id = text(raw.customer_id, 60);
      const customer_name = customer_id ? text(raw.customer_name, 120) : need(raw.customer_name, "ชื่อลูกค้า", 120);
      return { paper_no: paperNo(raw.paper_no, true), customer_id, customer_name, bill_day, kind, due_day, channel,
        amount: int(raw.amount_satang, "ยอดเงิน (สตางค์)", { min: 1, max: 1e11 }), note: text(raw.note, 300, "หมายเหตุ"), force_dup: bool(raw.force_dup) };
    },
    async load(X, input) {
      const [cust, dups, sheet] = await X.db.reads([
        input.customer_id ? ["SELECT id, name, merged_into, status FROM customers WHERE id = ?", input.customer_id] : ["SELECT id, name, merged_into, status FROM customers WHERE name_key = ? AND merged_into IS NULL LIMIT 2", nameKey(input.customer_name)],
        ["SELECT bill_no, bill_day, customer_name, total_satang, status FROM bills WHERE src = 'v2' AND paper_no = ? AND paper_no <> '' AND status <> 'ยกเลิก'", input.paper_no],
        ["SELECT * FROM bills WHERE substr(src, 1, 5) = 'acct:' AND paper_no = ? AND paper_no <> '' AND status <> 'ยกเลิก'", input.paper_no],
      ]);
      if (input.customer_id && !cust[0]) throw notFound("ไม่พบลูกค้ารายนี้ (อาจถูกรวมกับรายอื่นแล้ว) — เลือกใหม่");
      return { cust: input.customer_id ? cust[0] : (cust.length === 1 ? cust[0] : null), dups, sheet };
    },
    async run(X, input, ctx) {
      const c = ctx.cust;
      if (c && c.merged_into) throw bad("ลูกค้ารายนี้ถูกรวมกับรายอื่นแล้ว — เลือกชื่อใหม่");
      const name = c ? c.name : input.customer_name;
      const bill_no = "B" + X.newId();
      if (input.paper_no) {
        const inSheet = ctx.sheet.find(a => dayGap(a.bill_day, input.bill_day) <= 7);
        if (inSheet) {
          throw new Fail(409, "in_sheet", "บิล #" + input.paper_no + " มีในชีทบัญชีแล้ว (" + inSheet.customer_name + " ฿" + baht(inSheet.total_satang) + " วันที่ " + inSheet.bill_day + ") — ไม่ต้องลงซ้ำ ระบบนับจากชีทให้แล้ว",
            { sheet: { customer_name: inSheet.customer_name, total_satang: inSheet.total_satang, bill_day: inSheet.bill_day } });
        }
      }
      const dup = input.paper_no ? dupOf(ctx.dups, input.bill_day, bill_no) : null;
      if (dup && !input.force_dup) throw dupFail(dup, input.paper_no);
      if (dup && !X.reason) throw bad("ยืนยันเลขซ้ำต้องมีเหตุผล");
      const cash = input.kind === "เงินสด";
      const row = {
        bill_no, bill_day: input.bill_day, customer_id: c ? c.id : null, customer_name: name, order_id: null, total_satang: input.amount, kind: input.kind,
        pay_channel: cash ? input.channel : "", status: cash ? "ชำระแล้ว" : "ค้างชำระ", due_day: input.due_day, paid_day: cash ? input.bill_day : "", paid_satang: cash ? input.amount : 0,
        note: input.note, src: "v2", origin: "บัญชี", by_name: X.staff.nick, paper_no: input.paper_no, paper_dup_ok: dup ? 1 : 0,
      };
      const ops = [{ op: "insert", table: "bills", row }];
      if (cash) ops.push(payRow(X, row, input.amount, input.channel, input.bill_day, "บิลเงินสด"));
      if (dup) ops.push(dupFlag(row, input.paper_no, dup, X.reason));
      return { label: "ลงบิล " + (input.paper_no ? "#" + input.paper_no + " " : "") + name + " ฿" + baht(input.amount), result: { bill_no }, ops };
    },
  });

  // ── แก้บิล (เฉพาะที่ลงจากแอปบัญชี · ไม่อยู่ในใบวางบิล) ─────────────────────────────────────
  R.define({
    name: "account.bill_edit", roles: MONEY_ROLES, write: true, label: "แก้บิล", onUnique: paperUnique,
    input: (raw, X) => {
      const o = { bill_no: need(raw.bill_no, "บิล", 80), version: int(raw.version, "รุ่นของรายการ", { min: 1 }), force_dup: bool(raw.force_dup) };
      if (has(raw, "customer_id")) o.customer_id = text(raw.customer_id, 60);
      if (has(raw, "customer_name")) o.customer_name = text(raw.customer_name, 120);
      if (has(raw, "amount_satang")) o.amount = int(raw.amount_satang, "ยอดเงิน (สตางค์)", { min: 1, max: 1e11 });
      if (has(raw, "paper_no")) o.paper_no = paperNo(raw.paper_no, true);
      if (has(raw, "bill_day")) { o.bill_day = dayOf(raw.bill_day, "วันที่บิล"); if (o.bill_day > thaiDay(X.now)) throw bad("วันที่บิลเป็นวันในอนาคตไม่ได้"); }
      if (has(raw, "due_day")) o.due_day = dayOf(raw.due_day, "กำหนดชำระ", true);
      if (has(raw, "note")) o.note = text(raw.note, 300, "หมายเหตุ");
      if (has(raw, "channel")) o.channel = channelOf(raw.channel);
      return o;
    },
    async load(X, input) {   // 1 รอบ: เลขกระดาษที่จะใช้ = ที่ส่งมา หรือเลขเดิมของบิล
      const paperSql = "coalesce(?, (SELECT paper_no FROM bills WHERE bill_no = ?))";
      const pp = [input.paper_no === undefined ? null : input.paper_no, input.bill_no];
      const [[b], pays, cust, dups, sheet] = await X.db.reads([
        ["SELECT * FROM bills WHERE bill_no = ?", input.bill_no],
        ["SELECT * FROM bill_payments WHERE bill_no = ? AND status = 'ใช้ได้' ORDER BY at", input.bill_no],
        ["SELECT id, name, merged_into FROM customers WHERE id = ?", input.customer_id || "-"],
        [`SELECT bill_no, bill_day, customer_name, total_satang, status FROM bills WHERE src = 'v2' AND paper_no <> '' AND paper_no = ${paperSql} AND status <> 'ยกเลิก' AND bill_no <> ?`, ...pp, input.bill_no],
        [`SELECT * FROM bills WHERE substr(src, 1, 5) = 'acct:' AND paper_no <> '' AND paper_no = ${paperSql} AND status <> 'ยกเลิก'`, ...pp],
      ]);
      if (!b) throw notFound("ไม่พบบิลนี้");
      return { b, pays, cust: cust[0] || null, dups, sheet };
    },
    async run(X, input, ctx) {
      const b = ctx.b, s = sourceOf(b);
      if (!s.editable) throw bad(s.why || "บิลนี้แก้ในแอปบัญชีไม่ได้");
      if (b.status === "ยกเลิก") throw gone("บิลนี้ถูกยกเลิกแล้ว");
      if (b.version !== input.version) throw conflict();
      if (b.stmt_no) throw bad("บิลอยู่ในใบวางบิล " + b.stmt_no + " — ยกเลิกใบวางบิลก่อนแล้วค่อยแก้");
      const set = {}, ops = [];
      if (input.customer_id !== undefined && input.customer_id) {
        if (!ctx.cust || ctx.cust.merged_into) throw bad("ไม่พบลูกค้ารายนี้ (อาจถูกรวมแล้ว) — เลือกใหม่");
        if (ctx.cust.id !== b.customer_id) { set.customer_id = ctx.cust.id; set.customer_name = ctx.cust.name; }
      } else if (input.customer_name !== undefined && input.customer_name && input.customer_name !== b.customer_name) {
        set.customer_name = input.customer_name; set.customer_id = null;
      }
      const day = input.bill_day !== undefined ? input.bill_day : b.bill_day;
      if (input.bill_day !== undefined && input.bill_day !== b.bill_day) set.bill_day = input.bill_day;
      if (input.note !== undefined && input.note !== b.note) set.note = input.note;
      if (input.due_day !== undefined && input.due_day !== b.due_day) {
        if (b.kind !== "เครดิต") throw bad("บิลเงินสดไม่มีกำหนดชำระ");
        if (input.due_day && input.due_day < day) throw bad("กำหนดชำระต้องไม่ก่อนวันที่บิล");
        set.due_day = input.due_day;
      }
      const paper = input.paper_no !== undefined ? input.paper_no : b.paper_no;
      if (input.paper_no !== undefined && input.paper_no !== b.paper_no) set.paper_no = input.paper_no;
      if (paper && (set.paper_no !== undefined || set.bill_day !== undefined)) {
        const inSheet = ctx.sheet.find(a => dayGap(a.bill_day, day) <= 7 && (!a.same_as || a.same_as === b.bill_no));
        if (inSheet) throw new Fail(409, "in_sheet", "บิล #" + paper + " มีในชีทบัญชีแล้ว (" + inSheet.customer_name + " ฿" + baht(inSheet.total_satang) + ") — ใช้ใบในชีทแทน แล้วยกเลิกใบนี้", { sheet: { customer_name: inSheet.customer_name, total_satang: inSheet.total_satang, bill_day: inSheet.bill_day } });
        const dup = dupOf(ctx.dups, day, b.bill_no);
        if (dup && !input.force_dup) throw dupFail(dup, paper);
        if (dup && !X.reason) throw bad("ยืนยันเลขซ้ำต้องมีเหตุผล");
        set.paper_dup_ok = dup ? 1 : 0;
        if (dup) ops.push(dupFlag(Object.assign({}, b, set), paper, dup, X.reason));
      }
      const paid = ctx.pays.reduce((sum, p) => sum + p.amount_satang, 0);
      const single = ctx.pays.length === 1 && b.kind === "เงินสด" ? ctx.pays[0] : null;   // บิลเงินสดที่รับเงินครั้งเดียว: ยอด/ช่องทาง/วันที่ ตามไปด้วย
      const pset = {};
      if (input.amount !== undefined && input.amount !== b.total_satang) {
        set.total_satang = input.amount;
        if (single && paid === b.total_satang) { pset.amount_satang = input.amount; set.paid_satang = input.amount; }
        else {
          if (input.amount < paid) throw bad("ยอดใหม่ ฿" + baht(input.amount) + " น้อยกว่าที่รับชำระแล้ว ฿" + baht(paid) + " — ยกเลิกการรับชำระที่เกินก่อน");
          if (input.amount === paid && b.status === "ค้างชำระ") { const last = ctx.pays[ctx.pays.length - 1]; Object.assign(set, { status: "ชำระแล้ว", paid_day: last.day, pay_channel: last.channel }); }
          if (input.amount > paid && b.status === "ชำระแล้ว") Object.assign(set, { status: "ค้างชำระ", paid_day: "" });
        }
      }
      if (input.channel !== undefined && input.channel !== b.pay_channel) {
        if (!single) throw bad(b.kind === "เงินสด" ? "บิลนี้รับเงินหลายครั้ง — แก้ช่องทางที่รายการรับเงินแต่ละครั้ง (ยกเลิกแล้วรับใหม่)" : "บิลเครดิต: ช่องทางอยู่ที่รายการรับชำระแต่ละครั้ง");
        set.pay_channel = input.channel; pset.channel = input.channel;
      }
      if (single && set.bill_day !== undefined && single.day === b.bill_day) pset.day = set.bill_day;
      if (!Object.keys(set).length && !Object.keys(pset).length) throw bad("ไม่มีอะไรเปลี่ยน");
      if (Object.keys(set).length) ops.unshift({ op: "update", table: "bills", id: b.bill_no, expect: b.version, before: b, set });
      if (Object.keys(pset).length) ops.push({ op: "update", table: "bill_payments", id: single.id, expect: single.version, before: single, set: pset });
      return { label: "แก้บิล " + (b.paper_no ? "#" + b.paper_no + " " : "") + b.customer_name, result: { bill_no: b.bill_no }, ops };
    },
  });

  // ── ยกเลิกบิล (เฉพาะที่ลงจากแอปบัญชี · เหตุผลบังคับ · ไม่ลบ) ─────────────────────────────────
  R.define({
    name: "account.bill_cancel", roles: MONEY_ROLES, write: true, reason: "required", label: "ยกเลิกบิล",
    input: raw => ({ bill_no: need(raw.bill_no, "บิล", 80), version: int(raw.version, "รุ่นของรายการ", { min: 1 }) }),
    async load(X, input) {
      const [[b], pays, twins] = await X.db.reads([
        ["SELECT * FROM bills WHERE bill_no = ?", input.bill_no],
        ["SELECT * FROM bill_payments WHERE bill_no = ? AND status = 'ใช้ได้'", input.bill_no],
        ["SELECT * FROM bills WHERE same_as = ?", input.bill_no],
      ]);
      if (!b) throw notFound("ไม่พบบิลนี้");
      return { b, pays, twins };
    },
    async run(X, input, ctx) {
      const b = ctx.b, s = sourceOf(b);
      if (!s.editable) throw bad(s.why || "บิลนี้ยกเลิกในแอปบัญชีไม่ได้");
      if (b.status === "ยกเลิก") throw gone("บิลนี้ถูกยกเลิกไปแล้ว");
      if (b.version !== input.version) throw conflict();
      if (b.stmt_no) throw bad("บิลอยู่ในใบวางบิล " + b.stmt_no + " — ยกเลิกใบวางบิลก่อน");
      const ops = [{ op: "update", table: "bills", id: b.bill_no, expect: b.version, before: b, set: { status: "ยกเลิก", cancel_reason: X.reason } }];
      for (const p of ctx.pays) ops.push({ op: "update", table: "bill_payments", id: p.id, expect: p.version, before: p, set: { status: "ยกเลิก", note: (p.note ? p.note + " · " : "") + "ยกเลิกพร้อมบิล" } });
      for (const t of ctx.twins) ops.push({ op: "update", table: "bills", id: t.bill_no, expect: t.version, before: t, set: { same_as: "" } });   // ใบในชีทกลับมานับเอง
      return { label: "ยกเลิกบิล " + (b.paper_no ? "#" + b.paper_no + " " : "") + b.customer_name, result: { bill_no: b.bill_no }, ops };
    },
  });

  // ── รับชำระ (หลายใบทีเดียวได้ · ช่องทางต้องเลือกเอง · ห้ามเกินยอดค้าง) ──────────────────────────
  R.define({
    name: "account.pay", roles: MONEY_ROLES, write: true, label: "รับชำระ",
    input: (raw, X) => {
      const items = Array.isArray(raw.items) ? raw.items : [];
      if (!items.length) throw bad("เลือกบิลที่ลูกค้าจ่ายก่อน");
      if (items.length > 30) throw bad("รับชำระได้ครั้งละไม่เกิน 30 ใบ");
      const seen = new Set();
      const list = items.map(it => {
        const o = { bill_no: need(it && it.bill_no, "บิล", 80), version: int(it && it.version, "รุ่นของรายการ", { min: 1 }), satang: int(it && it.satang, "ยอดที่รับ (สตางค์)", { min: 1, max: 1e11 }) };
        if (seen.has(o.bill_no)) throw bad("เลือกบิลเดียวกันซ้ำ");
        seen.add(o.bill_no);
        return o;
      });
      return { items: list, day: payDay(raw.day, X), channel: channelOf(raw.channel), excess: int(raw.excess_satang, "ยอดที่เกิน (สตางค์)", { optional: true, min: 1, max: 1e11 }), note: text(raw.note, 300, "หมายเหตุ") };
    },
    async load(X, input) {   // 1 รอบ: บิล + ใบวางบิลของบิลเหล่านั้น + บิลทุกใบในใบวางบิลนั้น (ไว้ดูว่าเก็บครบหรือยัง)
      const nos = input.items.map(i => i.bill_no), qs = nos.map(() => "?").join(",");
      const sub = `SELECT stmt_no FROM bills WHERE bill_no IN (${qs}) AND stmt_no <> ''`;
      const [bills, stmts, sbills] = await X.db.reads([
        [`SELECT * FROM bills WHERE bill_no IN (${qs})`, ...nos],
        [`SELECT * FROM statements WHERE stmt_no IN (${sub})`, ...nos],
        [`SELECT bill_no, stmt_no, total_satang, paid_satang, status FROM bills WHERE stmt_no IN (${sub}) AND status <> 'ยกเลิก'`, ...nos],
      ]);
      return { bills: new Map(bills.map(b => [b.bill_no, b])), stmts, sbills };
    },
    async run(X, input, ctx) {
      if (input.excess && !X.reason) throw bad("รับเงินเกินยอดต้องมีเหตุผล");
      if (input.excess && input.items.length !== 1) throw bad("แจ้งเงินเกินได้ทีละบิล");
      const ops = [], after = new Map();
      let total = 0;
      for (const it of input.items) {
        const b = ctx.bills.get(it.bill_no);
        if (!b) throw notFound("ไม่พบบิลบางใบ (อาจถูกเปลี่ยนไปแล้ว) — โหลดใหม่");
        if (isAcct(b) || b.src !== "v2") throw bad(b.customer_name + ": " + sourceOf(b).why);
        if (b.status === "ยกเลิก") throw gone(b.customer_name + ": บิลนี้ถูกยกเลิกแล้ว");
        if (b.status === "ชำระแล้ว") throw conflict(b.customer_name + ": บิลนี้รับชำระครบไปแล้ว — โหลดใหม่");
        if (b.version !== it.version) throw conflict();
        const due = b.total_satang - b.paid_satang;
        if (it.satang > due) throw new Fail(400, "over", b.customer_name + ": ยอดที่รับ ฿" + baht(it.satang) + " เกินยอดค้าง ฿" + baht(due) + " — รับได้สูงสุด ฿" + baht(due) + " (ถ้าลูกค้าจ่ายเกินจริง ให้รับเท่ายอดค้าง แล้วแจ้งส่วนเกิน)", { due_satang: due, bill_no: b.bill_no });
        const paid = b.paid_satang + it.satang, full = paid === b.total_satang;
        ops.push(payRow(X, b, it.satang, input.channel, input.day, input.note));
        ops.push({ op: "update", table: "bills", id: b.bill_no, expect: b.version, before: b,
          set: Object.assign({ paid_satang: paid }, full ? { status: "ชำระแล้ว", paid_day: input.day, pay_channel: input.channel } : {}) });
        after.set(b.bill_no, paid);
        total += it.satang;
      }
      const closed = [];
      for (const s of ctx.stmts) {
        if (s.status === "ยกเลิก" || s.status === "เก็บแล้ว") continue;
        const all = ctx.sbills.filter(x => x.stmt_no === s.stmt_no);
        if (all.length && all.every(x => (after.has(x.bill_no) ? after.get(x.bill_no) : x.paid_satang) >= x.total_satang)) {
          ops.push({ op: "update", table: "statements", id: s.stmt_no, expect: s.version, before: s, set: { status: "เก็บแล้ว" } });
          closed.push(s.stmt_no);
        }
      }
      if (input.excess) {
        const b = ctx.bills.get(input.items[0].bill_no);
        ops.push({ op: "flag", kind: "ยอดไม่ตรง", team: "account", severity: "ดู", entity: "bills", entity_id: b.bill_no,
          title: "ลูกค้าจ่ายเกินยอด ฿" + baht(input.excess) + ": " + b.customer_name,
          detail: "รับเท่ายอดค้าง ฿" + baht(total) + " (" + input.channel + " วันที่ " + input.day + ") · ส่วนเกิน ฿" + baht(input.excess) + " ยังไม่ได้ลงที่ไหน · เหตุผล: " + X.reason });
      }
      const one = ctx.bills.get(input.items[0].bill_no);
      return {
        label: "รับชำระ ฿" + baht(total) + " (" + input.channel + ")" + (input.items.length === 1 ? " · " + one.customer_name : " · " + input.items.length + " ใบ"),
        result: { paid: input.items.length, total_satang: total, closed_stmts: closed }, ops,
      };
    },
  });

  // ── ยกเลิกการรับชำระ (เหตุผลบังคับ · ใช้เมื่อย้อนไม่ได้แล้ว) ─────────────────────────────────
  R.define({
    name: "account.pay_cancel", roles: MONEY_ROLES, write: true, reason: "required", label: "ยกเลิกการรับชำระ",
    input: raw => ({ id: need(raw.id, "รายการรับชำระ", 80), version: int(raw.version, "รุ่นของรายการ", { min: 1 }) }),
    async load(X, input) {
      const [[p], [b], st] = await X.db.reads([
        ["SELECT * FROM bill_payments WHERE id = ?", input.id],
        ["SELECT * FROM bills WHERE bill_no = (SELECT bill_no FROM bill_payments WHERE id = ?)", input.id],
        ["SELECT * FROM statements WHERE stmt_no = (SELECT b.stmt_no FROM bills b JOIN bill_payments p ON p.bill_no = b.bill_no WHERE p.id = ?)", input.id],
      ]);
      if (!p) throw notFound("ไม่พบรายการรับชำระนี้");
      return { p, b: b || null, st: st[0] || null };
    },
    async run(X, input, ctx) {
      const { p, b } = ctx;
      if (p.src !== "v2" || !b || b.src !== "v2") throw bad("รายการนี้ไม่ได้ลงในแอป — แก้ที่ต้นทาง");
      if (p.status === "ยกเลิก") throw gone("รายการรับชำระนี้ถูกยกเลิกไปแล้ว");
      if (p.version !== input.version) throw conflict();
      const ops = [{ op: "update", table: "bill_payments", id: p.id, expect: p.version, before: p, set: { status: "ยกเลิก" } }];
      if (b.status !== "ยกเลิก") {
        const paid = Math.max(0, b.paid_satang - p.amount_satang);
        ops.push({ op: "update", table: "bills", id: b.bill_no, expect: b.version, before: b, set: Object.assign({ paid_satang: paid }, b.status === "ชำระแล้ว" ? { status: "ค้างชำระ", paid_day: "" } : {}) });
        if (ctx.st && ctx.st.status === "เก็บแล้ว") ops.push({ op: "update", table: "statements", id: ctx.st.stmt_no, expect: ctx.st.version, before: ctx.st, set: { status: "วางบิลแล้ว" } });
      }
      return { label: "ยกเลิกการรับชำระ ฿" + baht(p.amount_satang) + " · " + b.customer_name, result: { id: p.id }, ops };
    },
  });

  // ── ลูกหนี้ (รายลูกค้า) ──────────────────────────────────────────────────────────
  R.define({
    name: "account.owing", roles: MONEY_ROLES,
    async run(X) {
      const today = thaiDay(X.now);
      const [rows, daily, stmts] = await X.db.reads([
        [`SELECT b.* FROM bills b WHERE ${AR_WHERE} ORDER BY b.customer_name, b.bill_day LIMIT 3000`],
        ["SELECT count(*) AS n, coalesce(sum(total_satang), 0) AS satang FROM bills WHERE status = 'ค้างชำระ' AND same_as = '' AND acct_kind = 'รายวัน'"],
        ["SELECT stmt_no, stmt_day, customer_id, customer_name, bill_count, total_satang, collect_day, status, bill_nos, version FROM statements WHERE status IN ('รอเก็บ', 'วางบิลแล้ว') ORDER BY stmt_day DESC LIMIT 200"],
      ]);
      const groups = new Map();
      for (const b of rows) {
        const k = b.customer_id || "n:" + b.customer_name;
        if (!groups.has(k)) groups.set(k, { key: k, customer_id: b.customer_id || null, customer_name: b.customer_name, due_satang: 0, n: 0, late: 0, bills: [] });
        const g = groups.get(k), o = billOut(b);
        g.bills.push(Object.assign(o, { late: !!b.due_day && b.due_day < today }));
        g.due_satang += o.due_satang; g.n++; if (o.late) g.late++;
      }
      const list = [...groups.values()].sort((a, b) => b.due_satang - a.due_satang);
      return {
        asOf: iso(X.now), today, period: "ค้างทั้งหมด ณ " + today,
        total: { n: rows.length, satang: list.reduce((s, g) => s + g.due_satang, 0) },
        customers: list, statements: stmts,
        sheetDailyCredit: { n: daily[0].n, satang: daily[0].satang, note: "บิลเครดิตในแท็บบิลรายวันของชีทบัญชี ไม่นับเป็นลูกหนี้ (นับจากแท็บลูกหนี้ แบบที่ฝ่ายบัญชีนับ)" },
      };
    },
  });

  // ── เงินเข้าบัญชีไหน (นับตามวันที่ชำระ · วัน / เดือน) ─────────────────────────────────────
  R.define({
    name: "account.money", roles: MONEY_ROLES,
    input: (raw, X) => ({ period: raw.period === "month" ? "month" : "day", day: raw.day ? dayOf(raw.day, "วันที่") : thaiDay(X.now) }),
    async run(X, input) {
      const from = input.period === "month" ? monthStart(input.day) : input.day;
      const to = input.period === "month" ? monthEnd(input.day) : input.day;
      const [rows, list] = await X.db.reads([
        [MONEY_IN_SQL, ...moneyInArgs(from, to)],
        [`SELECT * FROM (
            SELECT 'pay' AS kind, p.id AS id, p.day AS day, p.channel AS channel, p.amount_satang AS satang, b.customer_name, b.paper_no, b.bill_no, p.at AS at, s.nick AS by_nick, p.version AS version, b.src AS src
              FROM bill_payments p JOIN bills b ON b.bill_no = p.bill_no LEFT JOIN staff s ON s.id = p.by WHERE p.status = 'ใช้ได้' AND b.status <> 'ยกเลิก' AND p.day BETWEEN ? AND ?
            UNION ALL
            SELECT 'bill', b.bill_no, b.paid_day, CASE WHEN trim(b.pay_channel) = '' THEN '${NO_CHANNEL}' ELSE b.pay_channel END, b.total_satang, b.customer_name, b.paper_no, b.bill_no, b.updated_at, '', b.version, b.src
              FROM bills b WHERE b.status = 'ชำระแล้ว' AND b.same_as = '' AND b.paid_day BETWEEN ? AND ?
                AND (substr(b.src, 1, 5) = 'acct:' OR NOT EXISTS (SELECT 1 FROM bill_payments q WHERE q.bill_no = b.bill_no AND q.status = 'ใช้ได้'))
          ) ORDER BY day DESC, at DESC LIMIT 400`, from, to, from, to],
      ]);
      const chans = byChannel(rows);
      const days = new Map();
      for (const r of rows) days.set(r.day, (days.get(r.day) || 0) + Number(r.satang));
      return {
        asOf: iso(X.now), period: input.period, from, to,
        label: input.period === "month" ? "เดือน " + from.slice(0, 7) + " (" + from + " ถึง " + to + ") · นับตามวันที่ชำระ" : "วันที่ " + from + " · นับตามวันที่ชำระ",
        byChannel: chans, total: chans.reduce((s, c) => s + c.satang, 0),
        byDay: [...days.entries()].map(([d, satang]) => ({ day: d, satang })).sort((a, b) => (a.day < b.day ? 1 : -1)),
        entries: list.map(e => Object.assign(e, { src_label: String(e.src).indexOf("acct:") === 0 ? "ชีทบัญชี" : "ในแอป" })),
      };
    },
  });

  // ── ใบวางบิล ─────────────────────────────────────────────────────────────────
  R.define({
    name: "account.stmt_create", roles: MONEY_ROLES, write: true, label: "ออกใบวางบิล",
    input: (raw, X) => {
      const nos = Array.isArray(raw.bill_nos) ? [...new Set(raw.bill_nos.map(x => need(x, "บิล", 80)))] : [];
      if (!nos.length) throw bad("เลือกบิลที่จะวางก่อน");
      if (nos.length > 60) throw bad("ใบวางบิลหนึ่งใบรวมได้ไม่เกิน 60 บิล");
      const collect = dayOf(raw.collect_day, "วันนัดเก็บเงิน", true);
      if (collect && collect < thaiDay(X.now)) throw bad("วันนัดเก็บเงินต้องไม่ใช่วันที่ผ่านมาแล้ว");
      return { bill_nos: nos, collect_day: collect, note: text(raw.note, 300, "หมายเหตุ") };
    },
    async load(X, input) {
      const yy = thaiDay(X.now).slice(2, 4);
      const [bills, seq] = await X.db.reads([
        [`SELECT * FROM bills WHERE bill_no IN (${input.bill_nos.map(() => "?").join(",")})`, ...input.bill_nos],
        ["SELECT * FROM doc_seq WHERE key = ?", "stmt:" + yy],
      ]);
      return { bills, seq: seq[0] || null, yy };
    },
    async run(X, input, ctx) {
      if (ctx.bills.length !== input.bill_nos.length) throw notFound("ไม่พบบิลบางใบ — โหลดใหม่");
      const key = b => b.customer_id || "n:" + b.customer_name;
      const k0 = key(ctx.bills[0]);
      for (const b of ctx.bills) {
        if (isAcct(b) || b.src !== "v2") throw bad(b.customer_name + ": " + sourceOf(b).why);
        if (b.status !== "ค้างชำระ") throw conflict(b.customer_name + ": บิลนี้" + (b.status === "ยกเลิก" ? "ถูกยกเลิกแล้ว" : "ชำระครบแล้ว") + " — โหลดใหม่");
        if (b.stmt_no) throw conflict("บิลวันที่ " + b.bill_day + " อยู่ในใบวางบิล " + b.stmt_no + " แล้ว");
        if (key(b) !== k0) throw bad("ใบวางบิลหนึ่งใบต้องเป็นลูกค้ารายเดียวกัน");
      }
      const { no, op } = nextDoc(ctx.seq, "stmt:" + ctx.yy, "ST" + ctx.yy + "-");
      const sorted = ctx.bills.slice().sort((a, b) => (a.bill_day < b.bill_day ? -1 : 1));
      const total = sorted.reduce((s, b) => s + (b.total_satang - b.paid_satang), 0);
      const first = sorted[0];
      const ops = [op, { op: "insert", table: "statements", row: {
        stmt_no: no, stmt_day: thaiDay(X.now), customer_id: first.customer_id || null, customer_name: first.customer_name, bill_count: sorted.length, total_satang: total,
        collect_day: input.collect_day, status: "วางบิลแล้ว", bill_nos: sorted.map(b => b.bill_no).join(","), note: input.note, src: "v2" } }];
      for (const b of sorted) ops.push({ op: "update", table: "bills", id: b.bill_no, expect: b.version, before: b, set: { stmt_no: no } });
      return { label: "ออกใบวางบิล " + no + " · " + first.customer_name + " " + sorted.length + " บิล", result: { stmt_no: no, total_satang: total }, ops };
    },
  });
  R.define({
    name: "account.stmt_cancel", roles: MONEY_ROLES, write: true, reason: "required", label: "ยกเลิกใบวางบิล",
    input: raw => ({ stmt_no: need(raw.stmt_no, "ใบวางบิล", 40), version: int(raw.version, "รุ่นของรายการ", { min: 1 }) }),
    async load(X, input) {
      const [[s], bills] = await X.db.reads([["SELECT * FROM statements WHERE stmt_no = ?", input.stmt_no], ["SELECT * FROM bills WHERE stmt_no = ?", input.stmt_no]]);
      if (!s) throw notFound("ไม่พบใบวางบิลนี้");
      return { s, bills };
    },
    async run(X, input, ctx) {
      if (ctx.s.status === "ยกเลิก") throw gone("ใบวางบิลนี้ถูกยกเลิกไปแล้ว");
      if (ctx.s.version !== input.version) throw conflict();
      const ops = [{ op: "update", table: "statements", id: ctx.s.stmt_no, expect: ctx.s.version, before: ctx.s, set: { status: "ยกเลิก", note: [ctx.s.note, "ยกเลิก: " + X.reason].filter(Boolean).join(" · ") } }];
      for (const b of ctx.bills) ops.push({ op: "update", table: "bills", id: b.bill_no, expect: b.version, before: b, set: { stmt_no: "" } });
      return { label: "ยกเลิกใบวางบิล " + ctx.s.stmt_no, result: { stmt_no: ctx.s.stmt_no }, ops };
    },
  });
  R.define({
    name: "account.stmt", roles: MONEY_ROLES,
    input: raw => ({ stmt_no: need(raw.stmt_no, "ใบวางบิล", 40) }),
    async run(X, input) {
      const [[s], bills] = await X.db.reads([["SELECT * FROM statements WHERE stmt_no = ?", input.stmt_no], ["SELECT * FROM bills WHERE stmt_no = ? ORDER BY bill_day", input.stmt_no]]);
      if (!s) throw notFound("ไม่พบใบวางบิลนี้");
      return { statement: s, bills: bills.map(billOut) };
    },
  });
}
