import { bad, conflict, day, Fail, int, text } from "../core.mjs";
import { registerTable } from "../db.mjs";
import { OPEN_ORDER_STATUSES } from "./deliver_common.mjs";
import { learnRoutes } from "./geo-lib.mjs";
import { roundMoveAction } from "./office-plan.mjs";
import { areaFor, areaOptions, areaQuery, learnedQuery, namedAreas, pinCodes, planShare, publishedSql, readRoutePlan, revisionSql, weekOf } from "./route-plan-board.mjs";

const roles = ["screen"];
for (const table of ["weekly_plans", "plan_lines"]) registerTable(table, { void: { status: "ยกเลิก" } });
registerTable("route_day_pins", { pk: "day", void: { status: "ยกเลิก" } });

const pinRead = d => ["SELECT * FROM route_day_pins WHERE day = ?", d];
function inside(d, start, end) { return !!d && d >= start && d <= end; }

function changeOps(X, week, latest, dates) {
  const { start, end } = week;
  const ops = [{
    op: "guard",
    sql: `SELECT 1 WHERE COALESCE((SELECT id ${publishedSql}), '') = ?`,
    args: [start, end, latest?.id || ""],
  }];
  if (!latest || !dates.some(d => inside(d, latest.start_day, latest.end_day))) return ops;
  if (!X.reason) throw new Fail(400, "need_reason", "แผนประกาศแล้ว ต้องใส่เหตุผลที่แก้", { kind: "reschedule" });
  ops.push({ op: "update", table: "weekly_plans", id: latest.id, expect: latest.version, before: latest, set: { changes: latest.changes + 1 } });
  return ops;
}

const undoBeforeNextPublication = {
  async guard(X, undo) {
    const { start, end } = weekOf(X);
    const latest = await X.db.first(`SELECT base_revision ${publishedSql}`, start, end);
    if (latest && latest.base_revision >= undo.audit_id) {
      throw conflict("มีฉบับประกาศใหม่แล้ว — แก้จากปฏิทินพร้อมเหตุผล");
    }
  },
};

async function validateMove(X, input, ctx, round, from) {
  const week = weekOf(X), { start, end } = week;
  const to = input.to_day;
  if (to && !inside(to, start, end)) throw bad("เลือกวันส่งในปฏิทิน 7 วัน");
  if (!OPEN_ORDER_STATUSES.includes(ctx.o.status) || ctx.o.hold || ctx.o.purchase_type === "ขายหน้าร้าน" || !ctx.plan.current) {
    throw conflict("งานนี้ออกจากปฏิทินแล้ว — โหลดใหม่");
  }
  const state = ctx.plan.rounds.find(r => r.id === input.round)?.state;
  if (input.round_version !== (round?.version || 0) || (round ? !["ถึงคิว", "รอ"].includes(state) : input.round !== "")) {
    throw conflict("งวดนี้เปลี่ยนไปแล้ว — โหลดใหม่");
  }
  if (from > end) throw conflict("งวดนี้อยู่นอกปฏิทิน 7 วัน — โหลดใหม่");
  if (input.round === ctx.plan.current.id && ctx.plan.current.wait_next && (!to || to <= ctx.plan.last_day)) {
    throw bad("เที่ยวนี้ส่งไปแล้ว เลือกวันหลังเที่ยวล่าสุด");
  }
  const [[latest], rawAreas, known, [pin]] = await X.db.reads([
    [`SELECT * ${publishedSql}`, start, end], [areaQuery], [learnedQuery], pinRead(to),
  ]);
  const ops = changeOps(X, week, latest, [from, to]);
  if (!to) return ops;
  const areas = namedAreas(rawAreas, known);
  const area = areaFor(ctx.cust || {}, areas, learnRoutes(known));
  ops.push({
    op: "guard",
    sql: "SELECT 1 WHERE COALESCE((SELECT version FROM route_day_pins WHERE day = ?), 0) = ?",
    args: [to, pin?.version || 0],
  });
  if (!area.daily && !pinCodes(pin, areas).includes(area.code)) {
    if (!X.reason) throw new Fail(400, "need_reason", "ยังไม่มีหมุดสายสำหรับร้านนี้ในวันนี้ ต้องใส่เหตุผล", { kind: "reschedule" });
    ops.push({
      op: "flag", kind: "จัดส่งนอกสาย", severity: "ดู", team: "screen", entity: "orders", entity_id: ctx.o.id,
      title: "จัดส่งนอกสาย: " + (ctx.cust?.name || "ลูกค้า"), detail: area.name + " · " + X.reason,
      dedupe_key: "route-outside:" + ctx.o.id + ":" + input.round + ":" + to,
    });
  }
  return ops;
}

export function defineRoutePlan(R) {
  R.define({ name: "route_plan.board", roles, run: readRoutePlan });
  R.define({ ...roundMoveAction({ name: "route_plan.move", roles, planner: validateMove }), undo: undoBeforeNextPublication });
  R.define({
    name: "route_plan.pins", roles, write: true, undo: undoBeforeNextPublication,
    input(raw) {
      if (!Array.isArray(raw.routes) || raw.routes.length > 60) throw bad("ตรวจรายการสายส่งอีกครั้ง");
      return { day: day(raw.day, "วันส่ง"), version: int(raw.version, "รุ่นของหมุด", { min: 0 }),
        routes: [...new Set(raw.routes.map(code => text(code, 40)))].sort() };
    },
    async run(X, input) {
      const week = weekOf(X), { start, end } = week;
      if (!inside(input.day, start, end)) throw bad("เลือกวันในปฏิทิน 7 วัน");
      const [[pin], rawAreas, known, [latest]] = await X.db.reads([pinRead(input.day), [areaQuery], [learnedQuery], [`SELECT * ${publishedSql}`, start, end]]);
      const areas = namedAreas(rawAreas, known);
      if ((pin?.version || 0) !== input.version) throw conflict();
      const allowed = new Set(areaOptions(areas).map(a => a.code));
      if (input.routes.some(code => !allowed.has(code))) throw bad("มีสายที่ใช้ไม่ได้แล้ว — โหลดใหม่แล้วเลือกอีกครั้ง");
      const before = pinCodes(pin, areas).sort();
      if (JSON.stringify(before) === JSON.stringify(input.routes)) throw bad("หมุดสายยังเหมือนเดิม");
      const ops = changeOps(X, week, latest, [input.day]);
      const set = { routes_json: JSON.stringify(input.routes), status: "ใช้งาน" };
      if (pin) ops.push({ op: "update", table: "route_day_pins", id: input.day, expect: pin.version, before: pin, set });
      else ops.push({
        op: "guard", sql: "SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM route_day_pins WHERE day = ?)", args: [input.day],
      }, { op: "insert", table: "route_day_pins", row: { day: input.day, ...set } });
      return { label: "บันทึกหมุดสาย", ops, result: { day: input.day } };
    },
  });
  R.define({
    name: "route_plan.publish", roles, write: true, undo: undoBeforeNextPublication,
    input: raw => ({ revision: int(raw.revision, "รุ่นของแผน", { min: 0 }), start: day(raw.start, "วันแรกของแผน") }),
    load: readRoutePlan,
    run(X, input, board) {
      if (board.revision !== input.revision || board.start !== input.start) throw conflict("แผนหรือสต๊อกเปลี่ยนแล้ว — โหลดใหม่ก่อนประกาศ");
      const id = "WP" + X.newId();
      const share = planShare(board);
      const ops = [
        { op: "guard", sql: `SELECT 1 WHERE (${revisionSql}) = ?`, args: [board.revision] },
        { op: "insert", table: "weekly_plans", row: { id, start_day: board.start, end_day: board.end,
          by_staff: X.staff.id, share_text: share, base_revision: board.revision } },
      ];
      for (const d of board.days) {
        const snapshot = {
          routes: board.areas.filter(area => d.pins.includes(area.code)),
          stops: d.stops.map(s => ({ order: s.order, round: s.round, due: s.day, route: s.area, items: s.lines })),
          needs: board.needs.filter(n => n.day === d.day || (d.day === board.start && n.day < board.start)),
        };
        ops.push({ op: "insert", table: "plan_lines", row: { id: id + ":" + d.day, plan_id: id, day: d.day, snapshot_json: JSON.stringify(snapshot) } });
      }
      return { label: "ประกาศแผนสายส่ง", ops, result: { share } };
    },
  });
}
