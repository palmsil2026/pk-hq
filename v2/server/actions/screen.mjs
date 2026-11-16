// ============================================================
//  ทีมสกรีนสี — คิวสกรีน · จ่ายทีม · เสร็จแล้ว · ลงจำนวน (ไม่บังคับ)                     v2/server/actions/screen.mjs
//  ของเดิม (AppSheet): แตะทีม → แตะเสร็จ จบในสองแตะ ไม่กรอกจำนวน — ของใหม่ห้ามยากกว่า (PALM-WAY §3 §8)
//  สถานะ: รอดำเนินการ → เตรียมการสกรีน (จ่ายทีมแล้ว) → เสร็จแล้ว · ยกเลิก = ออฟฟิศ
//  สต๊อก: ขยับตอน "เสร็จแล้ว" ครั้งเดียว (ขวดเปล่าออก ดี+เสีย · ขวดสกรีนแล้วเข้า ดี) — เหตุผลใน docs/app-v2/STATUS.md
//  ทุกปุ่มย้อนได้ (ของกลาง undo.run) จนกว่าขั้นถัดไปแตะ · สองทีมกดงานเดียวกัน = คนหลังได้ 409 พร้อมบอกว่าใครรับไปแล้ว
// ============================================================
import { bad, conflict, notFound, need, int, text, iso, thaiDay, thaiHm } from "../core.mjs";
import { plainKey, screenKey, itemName, negativeStockFlags, orderStatusAfterScreen } from "./deliver_common.mjs";

const ROLES = ["screen", "office"];
const LIVE = ["รอดำเนินการ", "เตรียมการสกรีน"];

// ---- อ่านงาน + ของที่ต้องใช้ตัดสิน (1 รอบคุยกับฐาน) ----
async function loadJob(X, id, teamCode) {
  const sub = "(SELECT order_id FROM screen_jobs WHERE id = ?)";
  const itemSub = "(SELECT spec_key FROM order_items WHERE id = (SELECT order_item_id FROM screen_jobs WHERE id = ?))";
  const [jobs, orders, siblings, prods, teams, last, items, bal] = await X.db.reads([
    ["SELECT * FROM screen_jobs WHERE id = ?", id],
    [`SELECT o.*, c.name AS customer_name FROM orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.id = ${sub}`, id],
    [`SELECT id, status FROM screen_jobs WHERE order_id = ${sub}`, id],
    [`SELECT id, status FROM production_jobs WHERE order_id = ${sub} AND status <> 'ยกเลิก'`, id],
    ["SELECT code, active FROM screen_teams WHERE code = ?", teamCode || ""],
    ["SELECT staff_name, at, action FROM audit_log WHERE entity = 'screen_jobs' AND entity_id = ? ORDER BY id DESC LIMIT 1", id],
    ["SELECT i.*, t.piece_unit FROM order_items i LEFT JOIN product_types t ON t.code = i.type WHERE i.id = (SELECT order_item_id FROM screen_jobs WHERE id = ?)", id],
    [`SELECT item_key, qty_pcs FROM stock_balance WHERE grade = 'A' AND substr(item_key, 1, length('spec:' || ${itemSub})) = 'spec:' || ${itemSub}`, id, id],
  ]);
  const job = jobs[0];
  if (!job) throw notFound("ไม่พบงานสกรีนนี้ (อาจถูกเปลี่ยนไปแล้ว — โหลดใหม่)");
  return { job, order: orders[0], siblings, prods, team: teams[0] || null, last: last[0] || null, item: items[0] || null, balances: bal };
}

/** version ไม่ตรง = มีคนกดก่อน → บอกว่าใคร/ทีมไหน/เมื่อไร (คนหลังไม่ทับของคนแรก) */
function staleConflict(ctx) {
  const j = ctx.job, who = ctx.last ? " (" + ctx.last.staff_name + " " + thaiHm(Date.parse(ctx.last.at)) + ")" : "";
  const cur = { status: j.status, team: j.team, version: j.version };
  if (j.status === "เสร็จแล้ว") return conflict("งานนี้กดเสร็จไปแล้ว" + who + " — โหลดใหม่", { current: cur });
  if (j.status === "ยกเลิก") return conflict("งานนี้ถูกยกเลิกแล้ว" + who, { current: cur });
  if (j.team) return conflict(j.team + " รับงานนี้ไปแล้ว" + who + " — ถ้าจะเปลี่ยนทีม กดอีกครั้ง", { current: cur });
  return conflict("งานนี้มีคนแก้ไปก่อนแล้ว" + who + " — โหลดใหม่", { current: cur });
}

/** ออเดอร์: op เปลี่ยนสถานะเฉพาะเมื่อเปลี่ยนจริง (ไม่แตะ = ไม่ทำให้ "ย้อน" ของคนอื่นติด) */
function orderOps(ctx, jobAfter) {
  const o = ctx.order;
  if (!o) return [];
  const jobs = ctx.siblings.map(s => (s.id === ctx.job.id ? { id: s.id, status: jobAfter.status } : s));
  const next = orderStatusAfterScreen(o, jobs, ctx.prods);
  return next === o.status ? [] : [{ op: "update", table: "orders", id: o.id, expect: o.version, before: o, set: { status: next } }];
}

/** จำนวนที่ใช้จริงของงาน: ดี (ไม่ลง = จำนวนงาน − เสีย) · ใช้ขวดเปล่า = ดี + เสีย */
function usage(job, item, good, waste) {
  const planned = job.qty_pcs || (item ? item.qty_pcs : 0) || 0;
  const w = waste === null || waste === undefined ? 0 : waste;
  const g = good === null || good === undefined ? Math.max(0, planned - w) : good;
  return { good: g, waste: w, used: g + w };
}

/** ลงสมุดสต๊อกตามส่วนต่างของ "ใช้ขวดเปล่า" และ "ได้ขวดสกรีน" */
function stockOps(X, ctx, dUsed, dGood) {
  const item = ctx.item;
  if (!item) return [];
  const label = itemName(item);
  const moves = [];
  if (dUsed) moves.push({ op: "move", item_key: plainKey(item), label, grade: "A", qty_pcs: -dUsed, move_type: "เบิกสกรีน", ref_entity: "screen_jobs", ref_id: ctx.job.id });
  if (dGood) moves.push({ op: "move", item_key: screenKey(item, ctx.job), label: label + " สกรีน" + (item.screen_color || ctx.job.colors ? " " + (item.screen_color || ctx.job.colors) : ""), grade: "A", qty_pcs: dGood, move_type: "สกรีนเข้า", ref_entity: "screen_jobs", ref_id: ctx.job.id });
  return [...moves, ...negativeStockFlags(ctx.balances, moves, X.role)];
}

export function defineScreen(R) {
  // ---- คิว / เสร็จวันนี้ / ประวัติ ----
  R.define({
    name: "screen.list", roles: ROLES,
    input: raw => ({ tab: ["queue", "today", "history"].indexOf(raw.tab) >= 0 ? raw.tab : "queue", before: text(raw.before, 24) }),
    async run(X, input) {
      const today = thaiDay(X.now), now = iso(X.now);
      const cols = `j.id, j.version, j.status, j.team, j.colors, j.qty_pcs, j.good_pcs, j.waste_pcs, j.due_day AS job_due, j.done_at, j.done_day, j.note, j.updated_at, j.created_at,
        o.id AS order_id, o.order_day, o.due_day AS order_due, o.urgent, o.brand, o.status AS order_status, o.purchase_type, o.design_status, o.note AS order_note,
        c.name AS customer, c.route_code, c.district,
        i.type, i.size, i.neck, i.shape, i.color, i.screen_color, i.cap_color, i.label, i.bags, i.per_bag, i.extra_pcs, i.qty_pcs AS item_pcs, t.piece_unit,
        ts.nick AS taker, ds.nick AS done_nick,
        (SELECT u.id FROM undo_log u WHERE u.entity = 'screen_jobs' AND u.entity_id = j.id AND u.status = 'พร้อมย้อน' AND u.until_at > ? ORDER BY u.created_at DESC LIMIT 1) AS undo_id,
        (SELECT u.staff_id FROM undo_log u WHERE u.entity = 'screen_jobs' AND u.entity_id = j.id AND u.status = 'พร้อมย้อน' AND u.until_at > ? ORDER BY u.created_at DESC LIMIT 1) AS undo_staff`;
      const from = `FROM screen_jobs j JOIN orders o ON o.id = j.order_id JOIN customers c ON c.id = o.customer_id
        LEFT JOIN order_items i ON i.id = j.order_item_id LEFT JOIN product_types t ON t.code = i.type
        LEFT JOIN staff ts ON ts.id = o.taker_staff_id LEFT JOIN staff ds ON ds.id = j.done_by`;
      const due = "coalesce(nullif(j.due_day, ''), o.due_day)";
      const [rows, todayRows, teams] = await X.db.reads([
        input.tab === "queue"
          ? [`SELECT ${cols} ${from} WHERE j.status IN ('รอดำเนินการ','เตรียมการสกรีน') ORDER BY o.urgent DESC, CASE WHEN ${due} = '' THEN '9999' ELSE ${due} END, j.created_at LIMIT 200`, now, now]
          : input.tab === "today"
            ? [`SELECT ${cols} ${from} WHERE j.status = 'เสร็จแล้ว' AND j.done_day = ? ORDER BY j.done_at DESC LIMIT 200`, now, now, today]
            : [`SELECT ${cols} ${from} WHERE j.status = 'เสร็จแล้ว' AND j.done_at < ? ORDER BY j.done_at DESC LIMIT 60`, now, now, input.before || "9999"],
        ["SELECT team, count(*) AS jobs, coalesce(sum(coalesce(good_pcs, qty_pcs)), 0) AS pcs FROM screen_jobs WHERE status = 'เสร็จแล้ว' AND done_day = ? GROUP BY team", today],
        ["SELECT code FROM screen_teams WHERE active = 1 ORDER BY pos, code"],
      ]);
      const jobs = rows.map(r => {
        const due = r.job_due || r.order_due || "";
        return { ...r, due_day: due, late: !!due && due < today && r.status !== "เสร็จแล้ว", urgent: !!r.urgent };
      });
      return {
        asOf: now, today, tab: input.tab, jobs, teams: teams.map(t => t.code),
        doneToday: todayRows.map(t => ({ team: t.team || "", jobs: t.jobs, pcs: t.pcs })),
        more: input.tab === "history" && rows.length === 60 ? rows[rows.length - 1].done_at : "",
      };
    },
  });

  // ---- จ่ายทีม (แตะ "ทีม 1/2/3") ----
  R.define({
    name: "screen.assign", roles: ROLES, write: true, label: "จ่ายทีมสกรีน",
    input: raw => ({ id: need(raw.id, "งานสกรีน", 40), version: int(raw.version, "รุ่นของงาน", { min: 1 }), team: need(raw.team, "ทีม", 40) }),
    load: (X, input) => loadJob(X, input.id, input.team),
    async run(X, input, ctx) {
      const j = ctx.job;
      if (j.version !== input.version) throw staleConflict(ctx);
      if (!ctx.team || !ctx.team.active) throw bad("ไม่มีทีมชื่อ " + input.team + " (ทีมที่ใช้งานอยู่ดูได้ในค่าตั้ง)");
      if (j.status === "เสร็จแล้ว") throw conflict("งานนี้เสร็จแล้ว — ถ้ากดผิดให้ย้อนจากแท็บ \"เสร็จวันนี้\"", { current: { status: j.status, team: j.team, version: j.version } });
      if (j.status === "ยกเลิก") throw conflict("งานนี้ถูกยกเลิกแล้ว");
      if (ctx.order && ctx.order.status === "ยกเลิก") throw conflict("ออเดอร์นี้ถูกยกเลิกแล้ว — ไม่ต้องสกรีน");
      if (j.team === input.team && j.status === "เตรียมการสกรีน") throw bad(input.team + " รับงานนี้อยู่แล้ว");
      const after = { team: input.team, status: "เตรียมการสกรีน" };
      const cust = ctx.order ? ctx.order.customer_name || "" : "";
      return {
        result: { id: j.id, team: input.team, from: j.team || "" },
        label: input.team + " รับงาน" + (cust ? " " + cust : "") + (j.team ? " (แทน " + j.team + ")" : ""),
        ops: [{ op: "update", table: "screen_jobs", id: j.id, expect: j.version, before: j, set: after }, ...orderOps(ctx, after)],
      };
    },
  });

  // ---- เสร็จแล้ว (ลงดี/เสียได้ ไม่บังคับ) ----
  R.define({
    name: "screen.done", roles: ROLES, write: true, label: "งานสกรีนเสร็จ",
    input: raw => ({
      id: need(raw.id, "งานสกรีน", 40), version: int(raw.version, "รุ่นของงาน", { min: 1 }), team: text(raw.team, 40),
      good: int(raw.good, "จำนวนดี", { min: 0, max: 10000000, optional: true }), waste: int(raw.waste, "จำนวนเสีย", { min: 0, max: 10000000, optional: true }),
    }),
    load: (X, input) => loadJob(X, input.id, input.team),
    async run(X, input, ctx) {
      const j = ctx.job;
      if (j.version !== input.version) throw staleConflict(ctx);
      if (j.status === "เสร็จแล้ว") throw conflict("งานนี้กดเสร็จไปแล้ว");
      if (j.status === "ยกเลิก") throw conflict("งานนี้ถูกยกเลิกแล้ว");
      if (ctx.order && ctx.order.status === "ยกเลิก") throw conflict("ออเดอร์นี้ถูกยกเลิกแล้ว — ถ้าสกรีนไปแล้วจริง ให้แจ้งออฟฟิศ");
      if (input.team && (!ctx.team || !ctx.team.active)) throw bad("ไม่มีทีมชื่อ " + input.team);
      const team = input.team || j.team || null;
      const u = usage(j, ctx.item, input.good, input.waste);
      const set = { status: "เสร็จแล้ว", team, done_at: iso(X.now), done_day: thaiDay(X.now), done_by: X.staff.id, good_pcs: input.good, waste_pcs: input.waste };
      const ops = [{ op: "update", table: "screen_jobs", id: j.id, expect: j.version, before: j, set }];
      ops.push(...stockOps(X, ctx, u.used, u.good));
      if (!ctx.item) ops.push({ op: "flag", kind: "ทำนอกขั้นตอน", team: X.role, entity: "screen_jobs", entity_id: j.id, title: "งานสกรีนไม่ผูกรายการสินค้า — สต๊อกไม่ขยับ", detail: "ให้ออฟฟิศผูกงานนี้กับรายการในออเดอร์", dedupe_key: "screen-noitem:" + j.id });
      ops.push(...orderOps(ctx, set));
      const cust = ctx.order ? ctx.order.customer_name || "" : "";
      return { result: { id: j.id, team, good: u.good, waste: u.waste, used: u.used }, label: "สกรีนเสร็จ" + (cust ? " " + cust : "") + (team ? " · " + team : ""), ops };
    },
  });

  // ---- ลงจำนวนดี/เสีย ภายหลัง (งานที่เสร็จแล้ว) — ปรับสต๊อกตามส่วนต่าง ----
  R.define({
    name: "screen.count", roles: ROLES, write: true, label: "ลงจำนวนงานสกรีน",
    input: raw => ({ id: need(raw.id, "งานสกรีน", 40), version: int(raw.version, "รุ่นของงาน", { min: 1 }), good: int(raw.good, "จำนวนดี", { min: 0, max: 10000000 }), waste: int(raw.waste, "จำนวนเสีย", { min: 0, max: 10000000 }) }),
    load: (X, input) => loadJob(X, input.id, ""),
    async run(X, input, ctx) {
      const j = ctx.job;
      if (j.version !== input.version) throw staleConflict(ctx);
      if (j.status !== "เสร็จแล้ว") throw bad("ลงจำนวนได้หลังกดเสร็จแล้ว");
      if (j.good_pcs === input.good && j.waste_pcs === input.waste) throw bad("จำนวนเท่าเดิม ไม่มีอะไรเปลี่ยน");
      const was = usage(j, ctx.item, j.good_pcs, j.waste_pcs), now = usage(j, ctx.item, input.good, input.waste);
      const ops = [{ op: "update", table: "screen_jobs", id: j.id, expect: j.version, before: j, set: { good_pcs: input.good, waste_pcs: input.waste } }];
      ops.push(...stockOps(X, ctx, now.used - was.used, now.good - was.good));
      return { result: { id: j.id, good: input.good, waste: input.waste }, label: "ลงจำนวนสกรีน ดี " + input.good.toLocaleString("en-US") + " เสีย " + input.waste.toLocaleString("en-US"), ops };
    },
  });
}

