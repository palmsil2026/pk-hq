// ============================================================
//  ทีมสกรีนสี — คิวสกรีน · จ่ายทีม · เสร็จแล้ว · ลงจำนวน (ไม่บังคับ)                     v2/server/actions/screen.mjs
//  ของเดิม (AppSheet): แตะทีม → แตะเสร็จ จบในสองแตะ ไม่กรอกจำนวน — ของใหม่ห้ามยากกว่า (PALM-WAY §3 §8)
//  สถานะ: รอดำเนินการ → เตรียมการสกรีน (จ่ายทีมแล้ว) → เสร็จแล้ว · ยกเลิก = ออฟฟิศ
//  สต๊อก: ขยับตอน "เสร็จแล้ว" ครั้งเดียว (ขวดเปล่าออก ดี+เสีย · ขวดสกรีนแล้วเข้า ดี) — เหตุผลใน docs/app-v2/STATUS.md
//  ทุกปุ่มย้อนได้ (ของกลาง undo.run) จนกว่าขั้นถัดไปแตะ · สองทีมกดงานเดียวกัน = คนหลังได้ 409 พร้อมบอกว่าใครรับไปแล้ว
//  ทำบางส่วน (0320 · งานหลายวัน): "ทำวันนี้ … ถุง" (screen.part · ไม่บังคับ) = ตัดสต๊อกเท่าที่ทำ งานยังอยู่ในคิว
//    → "เสร็จ" ทีหลัง = ส่วนที่เหลือ (สต๊อกขยับเฉพาะส่วนต่างจากที่ทำไปแล้ว) · งานวันเดียวไม่มีช่วง = เหมือนเดิมเป๊ะ
//    ย้อนได้ทีละช่วง (ช่วงล่าสุด — ทุกช่วงขยับรุ่นของงาน กติกาย้อนกลางจึงย้อนได้เฉพาะอันล่าสุด)
// ============================================================
import { bad, conflict, notFound, need, int, text, iso, thaiDay, thaiHm } from "../core.mjs";
import { stockGuard } from "./prodRun.mjs";
const screenUndoGuard = stockGuard((have, n) => "ขวดสกรีนจากงานนี้ขึ้นรถ/ส่งไปแล้ว (คงเหลือ " + have + " น้อยกว่า " + n + ") — ย้อนไม่ได้ · ถ้าจำนวนผิด ให้กด \"ลงจำนวน\" แก้แทน");
import { plainKey, screenKey, itemName, negativeStockFlags, orderStatusOp, patchRows, gradeFor, B_COLORS_SQL } from "./deliver_common.mjs";
import { registerTable } from "../db.mjs";
import { amountText } from "./screen-progress.mjs";
registerTable("screen_parts", { pk: "id", void: { status: "ยกเลิก" } });

const ROLES = ["screen", "office"];

// ---- อ่านงาน + ของที่ต้องใช้ตัดสิน (1 รอบคุยกับฐาน) ----
async function loadJob(X, id, teamCode) {
  const sub = "(SELECT order_id FROM screen_jobs WHERE id = ?)";
  const itemSub = "(SELECT spec_key FROM order_items WHERE id = (SELECT order_item_id FROM screen_jobs WHERE id = ?))";
  const [jobs, orders, siblings, prods, teams, last, items, bal, loads, bColors] = await X.db.reads([
    ["SELECT * FROM screen_jobs WHERE id = ?", id],
    [`SELECT o.*, c.name AS customer_name FROM orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.id = ${sub}`, id],
    [`SELECT * FROM screen_jobs WHERE order_id = ${sub}`, id],
    [`SELECT * FROM production_jobs WHERE order_id = ${sub}`, id],
    ["SELECT code, active FROM screen_teams WHERE code = ?", teamCode || ""],
    ["SELECT staff_name, at, action FROM audit_log WHERE entity = 'screen_jobs' AND entity_id = ? ORDER BY id DESC LIMIT 1", id],
    [`SELECT i.*, t.piece_unit FROM order_items i LEFT JOIN product_types t ON t.code = i.type WHERE i.order_id = ${sub}`, id],
    [`SELECT item_key, grade, qty_pcs FROM stock_balance WHERE substr(item_key, 1, length('spec:' || ${itemSub})) = 'spec:' || ${itemSub}`, id, id],
    [`SELECT * FROM delivery_loads WHERE order_id = ${sub}`, id],
    [B_COLORS_SQL],
  ]);
  const job = jobs[0];
  if (!job) throw notFound("ไม่พบงานสกรีนนี้ (อาจถูกเปลี่ยนไปแล้ว — โหลดใหม่)");
  return { job, order: orders[0], siblings, prods, team: teams[0] || null, last: last[0] || null, items, item: items.find(i => i.id === job.order_item_id) || null,
    balances: bal, loads, bColors: bColors.map(b => b.value) };
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

/** ออเดอร์: สถานะไหลตามงานจริง (กติกาเดียวกับออฟฟิศ) — op เฉพาะเมื่อเปลี่ยนจริง */
function orderOps(X, ctx, jobAfter) {
  return orderStatusOp(X, ctx.order, ctx.items, ctx.prods, patchRows(ctx.siblings, [{ ...ctx.job, ...jobAfter }]), ctx.loads);
}

/** จำนวนงาน (ใบ) — งานไม่มีจำนวน = ใช้จำนวนของรายการออเดอร์ */
const plannedOf = (job, item) => job.qty_pcs || (item ? item.qty_pcs : 0) || 0;
/** จำนวนที่ใช้จริงของงาน: ดี (ไม่ลง = จำนวนงาน − เสีย · ไม่น้อยกว่าที่ทำบางส่วนไปแล้ว) · ใช้ขวดเปล่า = ดี + เสีย */
function usage(job, item, good, waste) {
  const planned = plannedOf(job, item);
  const w = waste === null || waste === undefined ? 0 : waste;
  const g = good === null || good === undefined ? Math.max(0, planned - w, job.done_pcs || 0) : good;
  return { good: g, waste: w, used: g + w };
}

/** ลงสมุดสต๊อกตามส่วนต่างของ "ใช้ขวดเปล่า" และ "ได้ขวดสกรีน" */
function stockOps(X, ctx, dUsed, dGood) {
  const item = ctx.item;
  if (!item) return [];
  const label = itemName(item), plain = plainKey(item), g = gradeFor(plain, item, ctx.bColors);
  const moves = [];
  if (dUsed) moves.push({ op: "move", item_key: plain, label, grade: g, qty_pcs: -dUsed, move_type: "เบิกสกรีน", ref_entity: "screen_jobs", ref_id: ctx.job.id });
  if (dGood) moves.push({ op: "move", item_key: screenKey(item, ctx.job), label: label + " สกรีน" + (item.screen_color || ctx.job.colors ? " " + (item.screen_color || ctx.job.colors) : ""), grade: "A", qty_pcs: dGood, move_type: "สกรีนเข้า", ref_entity: "screen_jobs", ref_id: ctx.job.id });
  const flags = [];
  for (const gr of ["A", "B"]) flags.push(...negativeStockFlags(ctx.balances.filter(b => b.grade === gr), moves.filter(m => m.grade === gr), X.role));
  return [...moves, ...flags];
}

export function defineScreen(R) {
  // ---- คิว / เสร็จวันนี้ / ประวัติ ----
  R.define({
    name: "screen.list", roles: ROLES,
    input: raw => ({ tab: ["queue", "today", "history"].indexOf(raw.tab) >= 0 ? raw.tab : "queue", before: text(raw.before, 24) }),
    async run(X, input) {
      const today = thaiDay(X.now), now = iso(X.now);
      const cols = `j.id, j.version, j.status, j.team, j.colors, j.qty_pcs, j.good_pcs, j.waste_pcs, j.done_pcs,
        (SELECT count(*) FROM screen_parts p WHERE p.job_id = j.id AND p.status = 'ใช้งาน') AS parts_n,
        (SELECT max(p.job_ver) FROM screen_parts p WHERE p.job_id = j.id AND p.status = 'ใช้งาน') AS last_part_ver,
        (SELECT u.id FROM undo_log u WHERE u.entity = 'screen_jobs' AND u.entity_id = j.id AND u.action = 'screen.part' AND u.status = 'พร้อมย้อน' AND u.until_at > ? ORDER BY u.created_at DESC LIMIT 1) AS part_undo, j.due_day AS job_due, j.done_at, j.done_day, j.note, j.updated_at, j.created_at,
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
      const [rows, todayRows, teams, parts, mstops] = await X.db.reads([
        input.tab === "queue"
          ? [`SELECT ${cols} ${from} WHERE j.status IN ('รอดำเนินการ','เตรียมการสกรีน') ORDER BY o.urgent DESC, CASE WHEN ${due} = '' THEN '9999' ELSE ${due} END, j.created_at LIMIT 200`, now, now, now]
          : input.tab === "today"
            ? [`SELECT ${cols} ${from} WHERE j.status = 'เสร็จแล้ว' AND j.done_day = ? ORDER BY j.done_at DESC LIMIT 200`, now, now, now, today]
            : [`SELECT ${cols} ${from} WHERE j.status = 'เสร็จแล้ว' AND j.done_at < ? ORDER BY j.done_at DESC LIMIT 60`, now, now, now, input.before || "9999"],
        // เสร็จวันนี้ต่อทีม = งานที่กดเสร็จวันนี้ (นับเฉพาะส่วนที่เหลือถ้าเคยทำบางส่วน) + ช่วงที่ "ทำวันนี้" ของทุกงาน
        [`SELECT team, sum(jobs) AS jobs, sum(parts) AS parts, coalesce(sum(pcs), 0) AS pcs FROM (
            SELECT team, 1 AS jobs, 0 AS parts, max(0, coalesce(good_pcs, qty_pcs) - done_pcs) AS pcs FROM screen_jobs WHERE status = 'เสร็จแล้ว' AND done_day = ?
            UNION ALL SELECT team, 0, 1, qty_pcs FROM screen_parts WHERE status = 'ใช้งาน' AND day = ?) GROUP BY team ORDER BY team`, today, today],
        ["SELECT code FROM screen_teams WHERE active = 1 ORDER BY pos, code"],
        input.tab === "today"
          ? [`SELECT ${cols}, p.id AS part_id, p.team AS part_team, p.qty_pcs AS part_pcs, p.at AS part_at, p.job_ver AS part_ver, p.by AS part_by, ps.nick AS part_nick
             ${from} JOIN screen_parts p ON p.job_id = j.id LEFT JOIN staff ps ON ps.id = p.by WHERE p.status = 'ใช้งาน' AND p.day = ? ORDER BY p.at DESC, p.job_ver DESC LIMIT 200`, now, now, now, today]
          : ["SELECT 1 WHERE 0"],
        // เครื่องสกรีนที่จอดอยู่ (แถบ "เครื่องสกรีน" บนหน้าคิว — แตะแล้วเปิดแผ่นจอด/เดินต่อ)
        ["SELECT m.name, e.reason, e.part, e.started_at FROM machine_events e JOIN machines m ON m.id = e.machine_id WHERE m.kind = 'สกรีน' AND m.status = 'ใช้งาน' AND e.kind = 'จอดเครื่อง' AND e.ended_at = '' AND e.status = 'ใช้งาน' ORDER BY m.name"],
      ]);
      const jobs = rows.map(r => {
        const due = r.job_due || r.order_due || "";
        return { ...r, due_day: due, late: !!due && due < today && r.status !== "เสร็จแล้ว", urgent: !!r.urgent };
      });
      return {
        asOf: now, today, tab: input.tab, jobs, teams: teams.map(t => t.code),
        doneToday: todayRows.map(t => ({ team: t.team || "", jobs: t.jobs, parts: t.parts, pcs: t.pcs })),
        // ช่วง "ทำวันนี้" (งานหลายวัน) — ช่วงล่าสุดของงานที่ยังไม่มีอะไรต่อจากนั้น (รุ่นตรง) ย้อนได้
        parts: parts.map(r => ({ ...r, due_day: r.job_due || r.order_due || "", urgent: !!r.urgent, latest: r.part_ver === r.version })),
        machinesStopped: mstops.map(r => ({ name: r.name, reason: r.reason, part: r.part, started_at: r.started_at })),
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
        ops: [{ op: "update", table: "screen_jobs", id: j.id, expect: j.version, before: j, set: after }, ...orderOps(X, ctx, after)],
      };
    },
  });

  // ---- เสร็จแล้ว (ลงดี/เสียได้ ไม่บังคับ) ----
  R.define({
    name: "screen.done", roles: ROLES, write: true, label: "งานสกรีนเสร็จ",
    undo: { guard: screenUndoGuard },   // ขวดสกรีนขึ้นรถ/ส่งไปแล้ว = ย้อนไม่ได้ (ไม่งั้นสต๊อกติดลบทั้งที่ของอยู่บนรถ) — ด่านเดียวกับย้อนปิดรอบ
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
      const prior = j.done_pcs || 0;   // ทำบางส่วนไปแล้ว (ตัดสต๊อกไปแล้วตอนนั้น) → "เสร็จ" = ส่วนที่เหลือ
      ops.push(...stockOps(X, ctx, u.used - prior, u.good - prior));
      if (!ctx.item) ops.push({ op: "flag", kind: "ทำนอกขั้นตอน", team: X.role, entity: "screen_jobs", entity_id: j.id, title: "งานสกรีนไม่ผูกรายการสินค้า — สต๊อกไม่ขยับ", detail: "ให้ออฟฟิศผูกงานนี้กับรายการในออเดอร์", dedupe_key: "screen-noitem:" + j.id });
      ops.push(...orderOps(X, ctx, set));
      const cust = ctx.order ? ctx.order.customer_name || "" : "";
      const rest = prior ? " · ส่วนที่เหลือ " + amountText(Math.max(0, u.good - prior), ctx.item) : "";
      return { result: { id: j.id, team, good: u.good, waste: u.waste, used: u.used, prior }, label: "สกรีนเสร็จ" + (cust ? " " + cust : "") + (team ? " · " + team : "") + rest, ops };
    },
  });

  // ---- ทำบางส่วน "ทำวันนี้ … ถุง" (งานหลายวัน · ไม่บังคับ) — ตัดสต๊อกเท่าที่ทำ · งานยังอยู่ในคิว ----
  R.define({
    name: "screen.part", roles: ROLES, write: true, label: "สกรีนบางส่วน",
    undo: { guard: screenUndoGuard },   // ขวดสกรีนจากช่วงนี้ขึ้นรถไปแล้ว = ย้อนไม่ได้ · มีช่วงใหม่/กดเสร็จต่อแล้ว = รุ่นงานไม่ตรง (ย้อนได้เฉพาะช่วงล่าสุด)
    input: raw => ({ id: need(raw.id, "งานสกรีน", 40), version: int(raw.version, "รุ่นของงาน", { min: 1 }), team: text(raw.team, 40), pcs: int(raw.pcs, "จำนวนที่ทำ", { min: 1, max: 10000000 }) }),
    load: (X, input) => loadJob(X, input.id, input.team),
    async run(X, input, ctx) {
      const j = ctx.job;
      if (j.version !== input.version) throw staleConflict(ctx);
      if (j.status === "เสร็จแล้ว") throw conflict("งานนี้กดเสร็จไปแล้ว");
      if (j.status === "ยกเลิก") throw conflict("งานนี้ถูกยกเลิกแล้ว");
      if (ctx.order && ctx.order.status === "ยกเลิก") throw conflict("ออเดอร์นี้ถูกยกเลิกแล้ว — ไม่ต้องสกรีน");
      if (input.team && (!ctx.team || !ctx.team.active)) throw bad("ไม่มีทีมชื่อ " + input.team);
      const planned = plannedOf(j, ctx.item), prior = j.done_pcs || 0;
      if (planned && prior + input.pcs >= planned) throw bad("ทำครบที่เหลือแล้ว (เหลือ " + amountText(planned - prior, ctx.item) + ") — กด \"เสร็จ\" แทน");
      const team = input.team || j.team || null;
      const set = { done_pcs: prior + input.pcs, status: "เตรียมการสกรีน", team };
      const id = "SP" + X.newId();
      const ops = [
        { op: "update", table: "screen_jobs", id: j.id, expect: j.version, before: j, set },
        { op: "insert", table: "screen_parts", row: { id, job_id: j.id, order_id: j.order_id, team, qty_pcs: input.pcs, at: iso(X.now), day: thaiDay(X.now), by: X.staff.id, job_ver: j.version + 1 } },
        ...stockOps(X, ctx, input.pcs, input.pcs),
      ];
      if (!ctx.item) ops.push({ op: "flag", kind: "ทำนอกขั้นตอน", team: X.role, entity: "screen_jobs", entity_id: j.id, title: "งานสกรีนไม่ผูกรายการสินค้า — สต๊อกไม่ขยับ", detail: "ให้ออฟฟิศผูกงานนี้กับรายการในออเดอร์", dedupe_key: "screen-noitem:" + j.id });
      ops.push(...orderOps(X, ctx, set));
      const cust = ctx.order ? ctx.order.customer_name || "" : "";
      const did = amountText(input.pcs, ctx.item), left = planned ? amountText(planned - prior - input.pcs, ctx.item) : "";
      return { result: { id: j.id, part: id, team, pcs: input.pcs, done_pcs: prior + input.pcs, planned, left_pcs: planned ? planned - prior - input.pcs : null },
        label: (team ? team + " " : "") + "ทำวันนี้ " + did + (cust ? " · " + cust : "") + (left ? " · ค้าง " + left : ""), ops };
    },
  });

  // ---- ลงจำนวนดี/เสีย ภายหลัง (งานที่เสร็จแล้ว) — ปรับสต๊อกตามส่วนต่าง ----
  R.define({
    name: "screen.count", roles: ROLES, write: true, label: "ลงจำนวนงานสกรีน",
    undo: { guard: screenUndoGuard },   // ขวดสกรีนขึ้นรถ/ส่งไปแล้ว = ย้อนไม่ได้ (ไม่งั้นสต๊อกติดลบทั้งที่ของอยู่บนรถ) — ด่านเดียวกับย้อนปิดรอบ
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

