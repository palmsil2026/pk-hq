import { addDays, iso, thaiDay, thDate } from "../core.mjs";
import { OPEN_ORDER_SQL, ON_TRUCK, itemName, plainKey, screenColorOf, screenKey, gradeFor, B_COLORS_SQL, qtyText } from "./deliver_common.mjs";
import { planState, targetOf } from "./office-plan-lib.mjs";
import { compareRank, rankOf, ranksFrom } from "./order-rank.mjs";
import { districtKey, guessAreaName, learnRoutes } from "./geo-lib.mjs";

const eligible = `o.status IN ${OPEN_ORDER_SQL} AND o.hold = 0 AND o.purchase_type <> 'ขายหน้าร้าน'`;
export const areaQuery = `SELECT r.code, COALESCE(a.name, r.name) AS name, a.confirmed, r.pos
  FROM routes r LEFT JOIN route_areas a ON a.route_code = r.code AND a.status = 'ใช้งาน'
  WHERE r.active = 1 ORDER BY r.pos, r.code`;
export const learnedQuery = `SELECT c.district, c.route_code FROM customers c JOIN routes r ON r.code = c.route_code
  WHERE c.status <> 'พัก' AND c.district <> '' AND r.active = 1`;
export const revisionSql = "SELECT COALESCE(max(id), 0) FROM audit_log";
export const publishedSql = `FROM weekly_plans WHERE status = 'ใช้งาน' AND end_day >= ? AND start_day <= ?
  ORDER BY base_revision DESC LIMIT 1`;
export const weekOf = X => {
  const start = thaiDay(X.now);
  return { start, end: addDays(start, 6) };
};

const city = s => ["เมือง", "เมืองลำปาง"].includes(districtKey(s));
const sameNumber = (code, name) => name === code || name === "สาย " + code;
export const areaOptions = rows => rows.filter(r => !city(r.name) && r.name && !sameNumber(r.code, r.name));
export function namedAreas(rows, customers) {
  return rows.map(r => {
    if (r.name && !sameNumber(r.code, r.name)) return r;
    const guess = guessAreaName(customers, r.code);
    return guess ? { ...r, name: guess.name, confirmed: 0 } : r;
  });
}
export function areaFor(customer, areas, learned) {
  if (city(customer.district)) return { code: "", name: "อำเภอเมือง", daily: true };
  const hint = learned.get(districtKey(customer.district));
  const code = customer.route_code || (hint?.ok ? hint.route : "");
  const route = areas.find(r => r.code === code);
  // ร้านที่ยังไม่รู้สาย = ลงวันไหนก็ได้ ไม่ถามเหตุผล ไม่ขึ้นธง (คุณปาล์มเคาะ 26 พ.ย. — ใช้ง่ายไว้ก่อน)
  const unknown = { code: "", name: "ยังไม่ทราบสาย", daily: false, unknown: true };
  if (route && city(route.name)) {
    if (!districtKey(customer.district) && route.confirmed) return { code: "", name: "อำเภอเมือง", daily: true };
    return unknown;
  }
  if (!route || !route.name || sameNumber(code, route.name)) return unknown;
  return { code, name: route.name, daily: false, suggested: !customer.route_code || route.confirmed === 0 };
}

// หัวหน้าทีมสกรีนจากค่าตั้ง SCREEN_LEADS (ชื่อเล่นหรือรหัส คั่นด้วย , หรือเว้นวรรค)
export const leadNames = settings => String(settings?.SCREEN_LEADS || "").split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
export const isLead = (X, names = leadNames(X.settings)) => (X.roles || []).includes("exec") || names.includes(X.staff.nick) || names.includes(X.staff.id);

export function pinCodes(row, areas) {
  if (!row || row.status !== "ใช้งาน") return [];
  const codes = new Set(areaOptions(areas).map(a => a.code));
  return JSON.parse(row.routes_json).filter(code => codes.has(code));
}

function group(rows) {
  const groups = Object.create(null);
  for (const row of rows) (groups[row.order_id] ||= []).push(row);
  return groups;
}

export async function readRoutePlan(X) {
  const { start, end } = weekOf(X);
  const [orders, items, rounds, loads, jobs, stock, running, rawAreas, known, pins, pub, revision, bColors, people] = await X.db.reads([
    [`SELECT o.id, o.version, o.status, o.priority, o.urgent, o.created_at, o.due_day, o.plan_mode, o.plan_cap_pcs,
         c.name AS customer, c.district, c.route_code
       FROM orders o JOIN customers c ON c.id = o.customer_id WHERE ${eligible}`],
    [`SELECT i.id, i.order_id, i.status, i.type, i.size, i.neck, i.shape, i.color, i.screen_color, i.cap_color, i.spec_key,
         i.label, i.per_bag, i.qty_pcs, i.delivered_pcs, i.onboard_pcs, t.piece_unit
       FROM order_items i JOIN orders o ON o.id = i.order_id LEFT JOIN product_types t ON t.code = i.type
       WHERE i.status = 'ใช้งาน' AND ${eligible} ORDER BY i.line_no`],
    [`SELECT d.* FROM order_rounds d JOIN orders o ON o.id = d.order_id WHERE d.status = 'ใช้งาน' AND ${eligible}`],
    [`SELECT l.order_id, l.order_item_id, l.qty_pcs, l.status, l.done_day FROM delivery_loads l JOIN orders o ON o.id = l.order_id
       WHERE l.status IN ('ส่งแล้ว','บนรถ','ส่งไม่ได้') AND ${eligible}`],
    [`SELECT j.order_item_id, j.colors FROM screen_jobs j JOIN orders o ON o.id = j.order_id
       WHERE j.status <> 'ยกเลิก' AND ${eligible} ORDER BY j.created_at, j.id`],
    ["SELECT item_key, grade, qty_pcs FROM stock_balance"],
    [`SELECT j.spec_key, max(0, j.target_pcs - COALESCE(m.good_pcs, 0)) AS qty_pcs
       FROM production_jobs j LEFT JOIN job_made m ON m.job_id = j.id
       WHERE j.status = 'กำลังผลิต' AND EXISTS (
         SELECT 1 FROM machine_runs r JOIN machines mc ON mc.id = r.machine_id
         WHERE r.job_id = j.id AND r.spec_key = j.spec_key AND r.status = 'กำลังผลิต' AND mc.status = 'ใช้งาน'
         AND NOT EXISTS (
           SELECT 1 FROM machine_events e WHERE e.machine_id = r.machine_id AND e.kind = 'จอดเครื่อง'
             AND e.status = 'ใช้งาน' AND e.ended_at = ''
         )
       )`],
    [areaQuery], [learnedQuery],
    ["SELECT * FROM route_day_pins WHERE day BETWEEN ? AND ?", start, end],
    [`SELECT id, start_day, end_day, created_at, changes, share_text ${publishedSql}`, start, end],
    [`SELECT (${revisionSql}) AS n`], [B_COLORS_SQL],
    ["SELECT s.id, s.nick FROM staff s WHERE s.status = 'ทำงาน' ORDER BY s.nick"],
  ]);

  const areas = namedAreas(rawAreas, known);
  const days = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(start, i), pin = pins.find(p => p.day === day);
    return { day, pins: pinCodes(pin, areas), pinVersion: pin?.version || 0, stops: [] };
  });
  const options = areaOptions(areas);
  const stops = collectStops({ orders, items, rounds, loads, jobs, areas, learned: learnRoutes(known), end });
  const tray = stops.filter(s => !s.day);
  const needs = allocate(stops.filter(s => s.day), stock, running, bColors.map(b => b.value));
  for (const stop of stops.filter(s => s.day)) {
    const column = days.find(d => d.day === (stop.day < start ? start : stop.day));
    column.stops.push(stop);
  }
  // คนที่ประกาศแผนได้ (โชว์ในแผ่น "ใครประกาศ") = หัวหน้าทีมสกรีนตามค่าตั้ง + ประธานที่เปิดอยู่
  const names = leadNames(X.settings);
  const leads = people.filter(p => names.includes(p.nick) || names.includes(p.id) || ((X.roles || []).includes("exec") && p.id === X.staff?.id));
  return { asOf: iso(X.now), start, end, days, areas: options, tray, needs, publication: pub[0] || null, revision: revision[0].n, leads };
}

// งวดถัดไปใช้ส่วนต่างของเป้าสะสม ส่วนค้างจริงจากงวดก่อนอยู่ในงวดที่ถึงคิวแล้ว
function collectStops({ orders, items, rounds, loads, jobs, areas, learned, end }) {
  const orderItems = group(items), orderRounds = group(rounds);
  const sent = group(loads.filter(l => l.status === "ส่งแล้ว"));
  const onTruck = group(loads.filter(l => ON_TRUCK.includes(l.status)));
  const screens = new Map(jobs.map(j => [j.order_item_id, j]));
  const ranks = ranksFrom(orders, orderRounds, orderItems, sent);
  const stops = [];
  for (const o of orders) {
    const delivered = sumByItem(sent[o.id]);
    const onboard = sumByItem(onTruck[o.id]);
    const its = (orderItems[o.id] || []).map(i => ({ ...i, delivered: Math.max(i.delivered_pcs, delivered.get(i.id) || 0) }));
    const plan = planState(o, orderRounds[o.id], its, sent[o.id]);
    if (!plan.current || !its.length) continue;

    const remainingOnTruck = new Map(its.map(i => [i.id, Math.max(i.onboard_pcs, onboard.get(i.id) || 0)]));
    const currentNeeds = new Map(plan.current.need.map(n => [n.item_id, n.pcs]));
    const area = areaFor(o, areas, learned);
    for (const r of plan.rounds) {
      if (r.seq < plan.current.seq) continue;
      const current = r.seq === plan.current.seq;
      const due = current ? plan.due : r.plan_day;
      const prev = plan.rounds.find(x => x.seq === r.seq - 1);
      const lines = its.map(i => {
        const job = screens.get(i.id);
        const screened = !!(job || i.screen_color);
        const prior = Math.max(i.delivered, prev ? targetOf(i, prev.cum_bp) : 0);
        const pcs = current ? currentNeeds.get(i.id) : Math.max(0, targetOf(i, r.cum_bp) - prior);
        const truck = Math.min(pcs, remainingOnTruck.get(i.id));
        remainingOnTruck.set(i.id, remainingOnTruck.get(i.id) - truck);
        return {
          spec_key: i.spec_key, label: itemName(i), type: i.type, size: i.size, neck: i.neck, shape: i.shape, color: i.color,
          cap_color: i.cap_color, per_bag: i.per_bag, piece_unit: i.piece_unit || "ใบ", screen: screened ? screenColorOf(i, job) : "", plainKey: plainKey(i),
          key: screened ? screenKey(i, job) : plainKey(i), pcs, truck,
        };
      }).filter(i => i.pcs);
      if ((!due && !current) || due > end || !lines.length) continue;
      stops.push({
        order: o.id, version: o.version, round: r.id, roundVersion: r.version, seq: r.seq, totalRounds: plan.n,
        customer: o.customer, area, day: due, bookedDay: r.plan_day, lines,
      });
    }
  }
  const rank = s => ({ ...rankOf(ranks, s.order), due: s.day, reserve: !s.day });
  // ให้การปรับคิวกลางชนะวันส่งเช่นเดียวกับคิวผลิตและสกรีน ส่วนงวดของออเดอร์เดียวกันเรียงตามงวด
  return stops.sort((a, b) => compareRank(rank(a), rank(b)) || a.seq - b.seq);
}

function sumByItem(loads = []) {
  const sums = new Map();
  for (const l of loads) sums.set(l.order_item_id, (sums.get(l.order_item_id) || 0) + l.qty_pcs);
  return sums;
}

function take(pool, key, amount) {
  const left = pool.get(key) || 0, n = Math.min(left, amount);
  pool.set(key, left - n);
  return n;
}

export function allocate(stops, stock, running, bColors) {
  const stockKey = (key, grade) => grade + ":" + key;
  const available = new Map(stock.map(b => [stockKey(b.item_key, b.grade), Math.max(0, b.qty_pcs)]));
  const forecast = new Map();
  for (const job of running) {
    const key = "spec:" + job.spec_key;
    forecast.set(key, (forecast.get(key) || 0) + job.qty_pcs);
  }
  const totals = new Map();
  for (const stop of stops) {
    for (const line of stop.lines) {
      const blankGrade = gradeFor(line.plainKey, line, bColors);
      const key = stockKey(line.key, line.screen ? "A" : blankGrade);
      const ready = line.truck + take(available, key, line.pcs - line.truck);
      const needsScreen = line.screen ? line.pcs - ready : 0;
      const blanks = line.screen ? take(available, stockKey(line.plainKey, blankGrade), needsScreen) : 0;
      const current = blankGrade === "A" ? take(forecast, line.plainKey, line.pcs - ready - blanks) : 0;
      const short = line.pcs - ready - blanks - current;
      const blow = ["ขวด", "ถัง"].includes(line.type) && blankGrade === "A" ? short : 0;
      Object.assign(line, { ready, needsScreen, running: current, short, blow, check: short - blow });
      const aggregate = JSON.stringify([stop.day, line.plainKey, line.screen, line.cap_color, blankGrade, line.per_bag]);
      if (!totals.has(aggregate)) totals.set(aggregate, {
        day: stop.day, before: addDays(stop.day, -1), label: line.label, size: line.size, screen: line.screen, cap_color: line.cap_color,
        per_bag: line.per_bag, piece_unit: line.piece_unit, pcs: 0, ready: 0, needsScreen: 0, running: 0, short: 0, blow: 0, check: 0,
      });
      const total = totals.get(aggregate);
      for (const field of ["pcs", "ready", "needsScreen", "running", "short", "blow", "check"]) total[field] += line[field];
    }
    stop.tone = stop.lines.some(l => l.short) ? "bad" : stop.lines.some(l => l.needsScreen || l.running) ? "warn" : "ok";
  }
  return [...totals.values()].sort((a, b) => a.day.localeCompare(b.day) || a.label.localeCompare(b.label, "th", { numeric: true }) || a.screen.localeCompare(b.screen, "th"));
}

export function planShare(board) {
  const format = thDate;
  const lines = ["แผนสายส่ง " + format(board.start) + " ถึง " + format(board.end)];
  for (const d of board.days) {
    const routes = new Set(d.pins.map(code => board.areas.find(a => a.code === code)?.name).filter(Boolean));
    for (const stop of d.stops) routes.add(stop.area.name);
    lines.push(format(d.day) + " · " + [routes.size ? [...routes].join(" / ") : "", d.stops.length ? d.stops.length + " นัดส่ง" : "ไม่มีนัดส่ง"].filter(Boolean).join(" · "));
  }
  for (const [title, field] of [["ต้องเป่าเพิ่ม", "blow"], ["ต้องสกรีน", "needsScreen"], ["รอรอบผลิต", "running"], ["ต้องเช็กของ", "check"]]) {
    const tasks = board.needs.filter(n => n[field]);
    if (tasks.length) lines.push("", title, ...tasks.map(n => "- " + n.label + (field === "needsScreen" ? " · สกรีน " + n.screen : "") + " · " + qtyText(n, n[field]) + " · ให้พร้อม " + format(n.before)));
  }
  if (board.tray.length) lines.push("", "รอลงวัน " + board.tray.length + " นัด");
  return lines.join("\n");
}
