// ============================================================
//  ส่งของ — เส้นทาง (timeline วันส่ง → สาย) · ขึ้นรถ (เต็ม/บางส่วน · เลือกคัน) · ส่งแล้ว (เต็ม/บางส่วน) · ส่งไม่ได้ + เหตุผล
//           · เอาลงจากรถ (คืนคลัง) · ย้ายคัน · ใบส่งของ                                          v2/server/actions/deliver.mjs
//
//  ของบนรถ = แถว delivery_loads สถานะ บนรถ / ส่งไม่ได้ (ส่งไม่ได้ = ยังอยู่บนรถ จนกว่าจะส่งใหม่หรือเอาลง)
//  ตัวนับ order_items.onboard_pcs (บนรถตอนนี้) + delivered_pcs (ส่งแล้ว) — ทุกการขยับแตะ version ของรายการ
//    → สองคนขึ้นรถรายการเดียวกันพร้อมกัน / ขึ้นสองคัน = คนหลังชนกัน (409) ไม่มีทางขึ้นเกินโดยไม่รู้ตัว
//  ขึ้นเกินที่เหลือ / ขึ้นก่อนสกรีนเสร็จ = ทำได้ แต่ต้องมีเหตุผล + ธง (ไม่มีทางตัน — PALM-WAY §2 ข้อ 5)
//  ย้อน "ส่งแล้ว" = ย้อนครบทุกชิ้นที่การส่งนั้นสร้าง (สถานะของบนรถ · แถวส่วนที่เหลือ · ตัวนับรายการ · สถานะออเดอร์) ใน batch เดียว
//  เงิน: ยังไม่เก็บเงินในหน้าส่งของ (รอคุณปาล์มตอบว่าคนขับเก็บเงินสดไหม) — การส่ง 1 ครั้งมี stop_id ไว้ผูกการรับเงินภายหลัง
// ============================================================
import { bad, conflict, notFound, need, int, text, iso, thaiDay, thaiHm, Fail, addDays, day as dayIn } from "../core.mjs";
import { planState } from "./office-plan-lib.mjs";   // 0310: วันส่ง = วันของงวดที่ถึงคิว (งวดส่งของออฟฟิศ)
import { mapsUrl } from "./geo-lib.mjs";
import { OPEN_ORDER_SQL, ON_TRUCK, ON_TRUCK_SQL, plainKey, screenKey, screenedStockLabel, itemName, qtyText, negativeStockFlags, orderStatusOp, patchRows, gradeFor, B_COLORS_SQL, billAfterGuard } from "./deliver_common.mjs";

const ROLES = ["deliver", "office"];
const MAX_LINES = 60;
const tripId = (day, vehicle) => "T" + day + "-" + vehicle;
const ph = n => Array.from({ length: n }, () => "?").join(",");
const needReason = (msg, extra) => new Fail(409, "need_reason", msg, extra);

/** [{id, version, qty?}] จากหน้าเว็บ — ไม่เชื่อเลขอื่นนอกจากรหัส/รุ่น/จำนวน */
function loadRefs(raw, withQty) {
  const list = Array.isArray(raw) ? raw : [];
  if (!list.length) throw bad("ยังไม่ได้เลือกของบนรถ");
  if (list.length > MAX_LINES) throw bad("เลือกได้ครั้งละไม่เกิน " + MAX_LINES + " รายการ");
  const seen = new Set();
  return list.map(r => {
    const id = need(r && r.id, "ของบนรถ", 40);
    if (seen.has(id)) throw bad("เลือกของบนรถซ้ำกัน");
    seen.add(id);
    return { id, version: int(r.version, "รุ่นของรายการ", { min: 1 }), qty: withQty ? int(r.qty, "จำนวน", { min: 0, max: 100000000, optional: true }) : null };
  });
}

/** version ไม่ตรง = มีคนทำไปก่อน → บอกว่าเกิดอะไร (ส่งแล้ว/เอาลง/ย้ายคัน) */
function loadConflict(l) {
  const when = l.done_at ? " " + thaiHm(Date.parse(l.done_at)) : "";
  if (l.status === "ส่งแล้ว") return conflict("ของนี้กดส่งแล้วไปก่อน" + (l.done_nick ? " (" + l.done_nick + when + ")" : "") + " — โหลดใหม่");
  if (l.status === "คืนคลัง") return conflict("ของนี้เอาลงจากรถไปแล้ว" + (l.done_nick ? " (" + l.done_nick + when + ")" : "") + " — โหลดใหม่");
  if (l.status === "ยกเลิก") return conflict("การขึ้นรถนี้ถูกย้อนไปแล้ว — โหลดใหม่");
  return conflict("ของบนรถนี้มีคนแก้ไปก่อนแล้ว (ส่ง/ย้ายคัน) — โหลดใหม่");
}

async function readLoads(X, refs, extra) {
  const ids = refs.map(r => r.id);
  const [loads, ...more] = await X.db.reads([
    [`SELECT l.*, t.vehicle_id, s.nick AS done_nick,
        (SELECT b.label FROM stock_balance b WHERE b.item_key = l.stock_key ORDER BY b.grade LIMIT 1) AS stock_label
      FROM delivery_loads l LEFT JOIN delivery_trips t ON t.id = l.trip_id LEFT JOIN staff s ON s.id = l.done_by WHERE l.id IN (${ph(ids.length)})`, ...ids],
    [`SELECT i.*, t.piece_unit FROM order_items i LEFT JOIN product_types t ON t.code = i.type WHERE i.id IN (SELECT order_item_id FROM delivery_loads WHERE id IN (${ph(ids.length)}))`, ...ids],
    [`SELECT o.*, c.name AS customer_name FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id IN (SELECT order_id FROM delivery_loads WHERE id IN (${ph(ids.length)}))`, ...ids],
    ...(extra || []),
  ]);
  const byId = new Map(loads.map(l => [l.id, l]));
  const picked = refs.map(r => {
    const l = byId.get(r.id);
    if (!l) throw notFound("ไม่พบของบนรถรายการนี้ (อาจถูกย้อนไปแล้ว — โหลดใหม่)");
    if (l.version !== r.version) throw loadConflict(l);
    return { ...l, want: r.qty };
  });
  return { picked, items: new Map(more[0].map(i => [i.id, i])), orders: new Map(more[1].map(o => [o.id, o])), extra: more.slice(2) };
}

/** อัปเดตตัวนับต่อรายการ (รวมหลายแถวของรายการเดียวกันเป็น op เดียว — กัน version ชนในคำขอเดียว) */
function itemOps(items, deltas) {
  const ops = [];
  for (const [id, d] of deltas) {
    const it = items.get(id);
    if (!it) continue;
    const set = {};
    if (d.onboard) set.onboard_pcs = Math.max(0, it.onboard_pcs + d.onboard);
    if (d.delivered) set.delivered_pcs = Math.max(0, it.delivered_pcs + d.delivered);
    if (Object.keys(set).length) ops.push({ op: "update", table: "order_items", id, expect: it.version, before: it, set });
  }
  return ops;
}
const addDelta = (m, id, k, n) => { if (!id) return; const d = m.get(id) || {}; d[k] = (d[k] || 0) + n; m.set(id, d); };

function tripOps(X, ctx, vehicleId) {
  const id = tripId(thaiDay(X.now), vehicleId);
  return { id, ops: ctx.trip ? [] : [{ op: "insert", table: "delivery_trips", undo: false, row: { id, day: thaiDay(X.now), vehicle_id: vehicleId, status: "จัดของ" } }] };
}

export function defineDeliver(R) {
  // ---- เส้นทาง + บนรถ (ข้อมูลชุดเดียว 1 รอบคุยกับฐาน) ----
  R.define({
    name: "deliver.board", roles: ROLES,
    async run(X) {
      const today = thaiDay(X.now);
      const onTruckOrders = `SELECT order_id FROM delivery_loads WHERE status IN ${ON_TRUCK_SQL}`;
      const [orders, items, jobs, loads, vehicles, done, rounds, sent] = await X.db.reads([
        [`SELECT o.id, o.version, o.order_day, o.due_day, o.status, o.urgent, o.brand, o.note, o.pay_status, o.has_screen, o.plan_mode, o.plan_cap_pcs,
            c.name AS customer, c.route_code, c.district, c.phone, c.address, c.map_url, c.note AS customer_note, r.name AS route_name, r.pos AS route_pos,
            c.id AS customer_id, c.version AS customer_version, c.geo_lat_e6, c.geo_lng_e6, c.geo_src, a.name AS area_name
          FROM orders o JOIN customers c ON c.id = o.customer_id LEFT JOIN routes r ON r.code = c.route_code LEFT JOIN route_areas a ON a.route_code = c.route_code AND a.status = 'ใช้งาน'
          WHERE o.status IN ${OPEN_ORDER_SQL} OR o.id IN (${onTruckOrders})
          ORDER BY CASE WHEN o.due_day = '' THEN '9999' ELSE o.due_day END, o.urgent DESC, c.route_code, c.name LIMIT 400`],
        [`SELECT i.id, i.version, i.order_id, i.line_no, i.type, i.size, i.neck, i.shape, i.color, i.screen_color, i.cap_color, i.label, i.bags, i.per_bag, i.extra_pcs, i.qty_pcs,
            i.delivered_pcs, i.onboard_pcs, t.piece_unit
          FROM order_items i JOIN orders o ON o.id = i.order_id LEFT JOIN product_types t ON t.code = i.type
          WHERE i.status = 'ใช้งาน' AND (o.status IN ${OPEN_ORDER_SQL} OR o.id IN (${onTruckOrders})) ORDER BY i.order_id, i.line_no`],
        [`SELECT j.order_id, j.order_item_id, j.status, j.team FROM screen_jobs j JOIN orders o ON o.id = j.order_id WHERE j.status <> 'ยกเลิก' AND o.status IN ${OPEN_ORDER_SQL}`],
        [`SELECT l.id, l.version, l.order_id, l.order_item_id, l.qty_pcs, l.status, l.fail_reason, l.loaded_at, l.done_at, t.vehicle_id, s.nick AS loaded_nick, d.nick AS done_nick
          FROM delivery_loads l LEFT JOIN delivery_trips t ON t.id = l.trip_id LEFT JOIN staff s ON s.id = l.loaded_by LEFT JOIN staff d ON d.id = l.done_by
          WHERE l.status IN ${ON_TRUCK_SQL} ORDER BY l.loaded_at`],
        ["SELECT id, name, plate FROM vehicles WHERE active = 1 ORDER BY id"],
        ["SELECT count(DISTINCT stop_id) AS stops FROM delivery_loads WHERE status = 'ส่งแล้ว' AND done_day = ? AND stop_id <> ''", today],
        [`SELECT d.* FROM order_rounds d JOIN orders o ON o.id = d.order_id WHERE d.status = 'ใช้งาน' AND o.status IN ${OPEN_ORDER_SQL}`],
        [`SELECT l.order_id, l.order_item_id, l.qty_pcs, l.done_day FROM delivery_loads l JOIN orders o ON o.id = l.order_id WHERE l.status = 'ส่งแล้ว' AND o.status IN ${OPEN_ORDER_SQL}`],
      ]);
      const roundsBy = {}, sentBy = {};
      rounds.forEach(r => { (roundsBy[r.order_id] = roundsBy[r.order_id] || []).push(r); });
      sent.forEach(l => { (sentBy[l.order_id] = sentBy[l.order_id] || []).push(l); });
      const itemsBy = {}, jobsBy = {}, loadsBy = {};
      items.forEach(i => { (itemsBy[i.order_id] = itemsBy[i.order_id] || []).push({ ...i, left_pcs: Math.max(0, i.qty_pcs - i.delivered_pcs - i.onboard_pcs) }); });
      jobs.forEach(j => { (jobsBy[j.order_id] = jobsBy[j.order_id] || []).push(j); });
      loads.forEach(l => { (loadsBy[l.order_id] = loadsBy[l.order_id] || []).push(l); });
      const stops = orders.map(o => {
        const its = itemsBy[o.id] || [], ld = loadsBy[o.id] || [], sj = jobsBy[o.id] || [];
        const left = its.reduce((s, i) => s + i.left_pcs, 0), onboard = ld.reduce((s, l) => s + l.qty_pcs, 0);
        const screenPending = sj.filter(j => j.status !== "เสร็จแล้ว");
        // งวดส่ง: วันในเส้นทาง = วันนัดของงวดที่ถึงคิว (ส่งไม่ครบงวดก่อน = ส่วนขาดรวมมางวดนี้) · ต้องส่งงวดนี้ต่อรายการ
        const plan = planState(o, roundsBy[o.id], its.map(i => ({ ...i, delivered: i.delivered_pcs })), sentBy[o.id]);
        const cur = plan.current;
        if (cur) its.forEach(i => { const n = cur.need.find(x => x.item_id === i.id); i.round_pcs = n ? Math.min(n.pcs, i.left_pcs + i.onboard_pcs) : i.left_pcs; });
        const { plan_mode, plan_cap_pcs, geo_lat_e6, geo_lng_e6, ...row } = o;
        return {
          ...row, due_day: plan.due, order_due: o.due_day, reserve: plan.reserve,
          round: cur && plan.n > 1 ? { seq: cur.seq, n: plan.n, carried: cur.carried } : null, plan_mode: plan_mode || "", wait_next: cur ? cur.wait_next : false,
          has_geo: geo_lat_e6 !== null && geo_lat_e6 !== undefined, map_open: geo_lat_e6 !== null && geo_lat_e6 !== undefined ? mapsUrl(geo_lat_e6, geo_lng_e6) : "",
          urgent: !!o.urgent, items: its, loads: ld, left_pcs: left, onboard_pcs: onboard,
          vehicles: [...new Set(ld.map(l => l.vehicle_id || ""))].filter(Boolean),
          failed: ld.filter(l => l.status === "ส่งไม่ได้").map(l => l.fail_reason)[0] || "",
          screen_pending: screenPending.length, screen_team: (screenPending.find(j => j.team) || {}).team || "",
          ready: o.status === "พร้อมส่ง" || o.status === "ส่งบางส่วน",
          late: !!plan.due && plan.due < today,
        };
      }).filter(s => s.left_pcs > 0 || s.onboard_pcs > 0);
      return { asOf: iso(X.now), today, tomorrow: addDays(today, 1), stops, vehicles, deliveredToday: done[0] ? done[0].stops : 0 };
    },
  });

  // ---- ส่งแล้ว (วันนี้ / วันก่อน) จัดตามการส่งแต่ละครั้ง ----
  R.define({
    name: "deliver.done_list", roles: ROLES,
    input: raw => ({ day: dayIn(raw.day, "วันที่", true) }),
    async run(X, input) {
      const d = input.day || thaiDay(X.now), now = iso(X.now);
      const [rows, undos] = await X.db.reads([
        [`SELECT l.id, l.stop_id, l.order_id, l.order_item_id, l.qty_pcs, l.done_at, l.fail_reason, t.vehicle_id, s.nick AS done_nick, l.done_by,
            c.name AS customer, c.route_code, c.district, o.brand, o.status AS order_status,
            i.type, i.size, i.neck, i.shape, i.color, i.screen_color, i.label, i.per_bag, i.bags, i.qty_pcs AS item_pcs, i.delivered_pcs, pt.piece_unit
          FROM delivery_loads l JOIN orders o ON o.id = l.order_id JOIN customers c ON c.id = o.customer_id
          LEFT JOIN order_items i ON i.id = l.order_item_id LEFT JOIN product_types pt ON pt.code = i.type
          LEFT JOIN delivery_trips t ON t.id = l.trip_id LEFT JOIN staff s ON s.id = l.done_by
          WHERE l.status = 'ส่งแล้ว' AND l.done_day = ? ORDER BY l.done_at DESC, i.line_no LIMIT 400`, d],
        ["SELECT id, entity_id, staff_id FROM undo_log WHERE entity = 'delivery_stops' AND status = 'พร้อมย้อน' AND until_at > ? AND created_at >= ?", now, iso(X.now - 3 * 864e5)],
      ]);
      const undoBy = new Map(undos.map(u => [u.entity_id, u]));
      const stops = [], byStop = new Map();
      for (const r of rows) {
        const k = r.stop_id || r.id;
        let s = byStop.get(k);
        if (!s) {
          const u = undoBy.get(r.stop_id);
          s = { stop_id: r.stop_id, order_id: r.order_id, customer: r.customer, route_code: r.route_code, district: r.district, brand: r.brand, order_status: r.order_status,
            done_at: r.done_at, done_nick: r.done_nick, vehicle_id: r.vehicle_id, lines: [], undo_id: u ? u.id : "", undo_mine: !!u && (u.staff_id === X.staff.id || X.roles.indexOf("exec") >= 0) };
          byStop.set(k, s); stops.push(s);
        }
        s.lines.push({ type: r.type, size: r.size, neck: r.neck, shape: r.shape, color: r.color, screen_color: r.screen_color, label: r.label, per_bag: r.per_bag, piece_unit: r.piece_unit,
          qty_pcs: r.qty_pcs, bags: r.per_bag > 0 && r.qty_pcs % r.per_bag === 0 ? r.qty_pcs / r.per_bag : 0, fail_reason: r.fail_reason });
      }
      return { asOf: now, day: d, today: thaiDay(X.now), stops, pcs: rows.reduce((s, r) => s + r.qty_pcs, 0) };
    },
  });

  // ---- ใบส่งของ (การส่งครั้งนี้ หรือของบนรถของออเดอร์นี้) + บิลถ้ามี (ดูอย่างเดียว) ----
  R.define({
    name: "deliver.doc", roles: ROLES,
    input: raw => ({ stop: text(raw.stop, 40), order: text(raw.order, 40) }),
    async run(X, input) {
      if (!input.stop && !input.order) throw bad("ต้องระบุการส่งหรือออเดอร์");
      const where = input.stop ? "l.stop_id = ? AND l.status = 'ส่งแล้ว'" : `l.order_id = ? AND l.status IN ${ON_TRUCK_SQL}`;
      const [lines, settings] = await X.db.reads([
        [`SELECT l.qty_pcs, l.done_at, l.loaded_at, l.status, l.order_id, t.vehicle_id, v.name AS vehicle_name, v.plate, s.nick AS by_nick,
            i.type, i.size, i.neck, i.shape, i.color, i.screen_color, i.cap_color, i.label, i.per_bag, pt.piece_unit, i.line_no
          FROM delivery_loads l LEFT JOIN delivery_trips t ON t.id = l.trip_id LEFT JOIN vehicles v ON v.id = t.vehicle_id
          LEFT JOIN staff s ON s.id = CASE WHEN l.status = 'ส่งแล้ว' THEN l.done_by ELSE l.loaded_by END
          LEFT JOIN order_items i ON i.id = l.order_item_id LEFT JOIN product_types pt ON pt.code = i.type
          WHERE ${where} ORDER BY i.line_no`, input.stop || input.order],
        ["SELECT key, value FROM settings WHERE key IN ('COMPANY_NAME', 'COMPANY_PHONE', 'COMPANY_ADDRESS')"],
      ]);
      if (!lines.length) throw notFound(input.stop ? "ไม่พบการส่งนี้ (อาจถูกย้อนไปแล้ว)" : "ออเดอร์นี้ไม่มีของบนรถ");
      const orderId = lines[0].order_id;
      const [orders, bills] = await X.db.reads([
        ["SELECT o.id, o.order_day, o.due_day, o.brand, c.name, c.address, c.phone, c.district, c.route_code FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = ?", orderId],
        ["SELECT bill_no, bill_day, kind, status, due_day, paper_no FROM bills WHERE order_id = ? AND status <> 'ยกเลิก' ORDER BY bill_day DESC LIMIT 3", orderId],   // ไม่ส่งยอดเงิน — ทีมส่งของยังไม่ต้องเห็นเงิน (PALM-WAY §9: ขยายการเห็นเงินต้องถามก่อน)
      ]);
      const set = {};
      settings.forEach(s => { set[s.key] = s.value; });
      const o = orders[0];
      const merged = new Map();
      for (const l of lines) {
        const k = [l.type, l.size, l.neck, l.shape, l.color, l.screen_color, l.cap_color].join("|");
        const m = merged.get(k) || { name: itemName(l) + (l.screen_color ? " สกรีน" + l.screen_color : "") + (l.cap_color ? " ฝา" + l.cap_color : ""), per_bag: l.per_bag, unit: l.piece_unit || "ใบ", qty_pcs: 0 };
        m.qty_pcs += l.qty_pcs; merged.set(k, m);
      }
      const first = lines[0];
      return {
        title: input.stop ? "ใบส่งของ" : "ใบส่งของ (ของบนรถ ยังไม่ได้ส่ง)", company: set.COMPANY_NAME || "โรงขวด P&K", companyPhone: set.COMPANY_PHONE || "", companyAddress: set.COMPANY_ADDRESS || "",
        day: first.done_at ? thaiDay(Date.parse(first.done_at)) : thaiDay(X.now), time: first.done_at ? thaiHm(Date.parse(first.done_at)) : "",
        customer: { name: o.name, address: o.address, phone: o.phone, district: o.district, route: o.route_code, brand: o.brand },
        vehicle: first.vehicle_id ? (first.vehicle_name || "รถ " + first.vehicle_id) + (first.plate ? " · " + first.plate : "") : "",
        by: first.by_nick || "", lines: [...merged.values()].map(m => ({ ...m, text: qtyText({ per_bag: m.per_bag, piece_unit: m.unit }, m.qty_pcs) })),
        totalPcs: lines.reduce((s, l) => s + l.qty_pcs, 0), ref: input.stop || orderId, orderDay: o.order_day,
        bills: bills.map(b => ({ day: b.bill_day, kind: b.kind, status: b.status, due_day: b.due_day, paper_no: b.paper_no })),
      };
    },
  });

  // ---- ขึ้นรถ (เต็ม/บางส่วน · เลือกคัน) ----
  R.define({
    name: "deliver.load", roles: ROLES, write: true, label: "ขึ้นรถ",
    input: raw => {
      const lines = Array.isArray(raw.lines) ? raw.lines : [];
      if (!lines.length) throw bad("ยังไม่ได้เลือกของที่จะขึ้นรถ");
      if (lines.length > MAX_LINES) throw bad("ขึ้นได้ครั้งละไม่เกิน " + MAX_LINES + " รายการ");
      const seen = new Set();
      return {
        order: need(raw.order, "ออเดอร์", 40), vehicle: need(raw.vehicle, "คันรถ", 20), over: raw.over === true, early: raw.early === true,
        lines: lines.map(l => {
          const item = need(l && l.item, "รายการสินค้า", 40);
          if (seen.has(item)) throw bad("เลือกรายการซ้ำกัน");
          seen.add(item);
          return { item, qty: int(l.qty, "จำนวนที่ขึ้นรถ", { min: 1, max: 100000000 }) };
        }),
      };
    },
    async load(X, input) {
      const [orders, items, jobs, vehicles, trips, balances, loads, bColors] = await X.db.reads([
        ["SELECT o.*, c.name AS customer_name FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = ?", input.order],
        ["SELECT i.*, t.piece_unit FROM order_items i LEFT JOIN product_types t ON t.code = i.type WHERE i.order_id = ?", input.order],
        ["SELECT id, order_item_id, status, team, colors FROM screen_jobs WHERE order_id = ? AND status <> 'ยกเลิก'", input.order],
        ["SELECT * FROM vehicles WHERE id = ?", input.vehicle],
        ["SELECT * FROM delivery_trips WHERE id = ?", tripId(thaiDay(X.now), input.vehicle)],
        ["SELECT b.item_key, b.grade, b.qty_pcs FROM stock_balance b WHERE EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = ? AND substr(b.item_key, 1, length('spec:' || i.spec_key)) = 'spec:' || i.spec_key)", input.order],
        [`SELECT l.order_item_id, l.qty_pcs, l.loaded_at, t.vehicle_id, s.nick FROM delivery_loads l LEFT JOIN delivery_trips t ON t.id = l.trip_id LEFT JOIN staff s ON s.id = l.loaded_by WHERE l.order_id = ? AND l.status IN ${ON_TRUCK_SQL}`, input.order],
        [B_COLORS_SQL],
      ]);
      if (!orders[0]) throw notFound("ไม่พบออเดอร์นี้ (อาจถูกเปลี่ยนไปแล้ว — โหลดใหม่)");
      return { order: orders[0], items: new Map(items.map(i => [i.id, i])), jobs, vehicle: vehicles[0] || null, trip: trips[0] || null, balances, loads, bColors: bColors.map(b => b.value) };
    },
    async run(X, input, ctx) {
      const o = ctx.order;
      if (o.status === "ยกเลิก") throw conflict("ออเดอร์นี้ถูกยกเลิกแล้ว — ไม่ต้องขึ้นรถ");
      if (!ctx.vehicle || !ctx.vehicle.active) throw bad("ไม่มีรถคัน " + input.vehicle + " ในทะเบียน (หรือพักใช้อยู่)");
      const over = [], early = [];
      for (const l of input.lines) {
        const it = ctx.items.get(l.item);
        if (!it) throw bad("รายการนี้ไม่ได้อยู่ในออเดอร์นี้ — โหลดใหม่");
        if (it.status !== "ใช้งาน") throw conflict("รายการ " + itemName(it) + " ถูกยกเลิกแล้ว");
        const left = it.qty_pcs - it.delivered_pcs - it.onboard_pcs;
        if (l.qty > left) {
          const where = ctx.loads.filter(x => x.order_item_id === it.id).map(x => "รถ " + (x.vehicle_id || "?") + " " + qtyText(it, x.qty_pcs) + (x.nick ? " (" + x.nick + " " + thaiHm(Date.parse(x.loaded_at)) + ")" : ""));
          over.push(itemName(it) + ": เหลือให้ขึ้น " + qtyText(it, Math.max(0, left)) + (where.length ? " · บนรถแล้ว " + where.join(", ") : "") + (it.delivered_pcs ? " · ส่งแล้ว " + qtyText(it, it.delivered_pcs) : ""));
        }
        const job = ctx.jobs.find(j => j.order_item_id === it.id);
        if (job && job.status !== "เสร็จแล้ว") early.push(itemName(it) + " ยังสกรีนไม่เสร็จ" + (job.team ? " (" + job.team + " กำลังทำ)" : " (ยังไม่มีทีมรับ)"));
      }
      if (over.length && !input.over) throw needReason("ขึ้นเกินที่ต้องส่ง — " + over.join(" · "), { need: "over", detail: over });
      if (early.length && !input.early) throw needReason(early.join(" · ") + " — ถ้าจะขึ้นรถก่อน ต้องใส่เหตุผล", { need: "early", detail: early });
      if ((input.over && over.length || input.early && early.length) && !X.reason) throw bad("ต้องเลือกหรือพิมพ์เหตุผล");
      const trip = tripOps(X, ctx, ctx.vehicle.id);
      const loadRows = [], moves = [], deltas = new Map();
      let pcs = 0;
      for (const l of input.lines) {
        const it = ctx.items.get(l.item), id = "L" + X.newId();
        const job = ctx.jobs.find(j => j.order_item_id === it.id);
        const printed = job || it.screen_color;
        const key = printed ? screenKey(it, job) : plainKey(it);
        loadRows.push({ op: "insert", table: "delivery_loads", row: { id, trip_id: trip.id, order_id: o.id, order_item_id: it.id, qty_pcs: l.qty, status: "บนรถ", loaded_at: iso(X.now), loaded_by: X.staff.id, stock_key: key } });
        moves.push({ op: "move", item_key: key, label: printed ? screenedStockLabel(it, job, o.customer_name, o.brand) : itemName(it), grade: gradeFor(key, it, ctx.bColors), qty_pcs: -l.qty, move_type: "ขึ้นรถ", ref_entity: "delivery_loads", ref_id: id });
        addDelta(deltas, it.id, "onboard", l.qty);
        pcs += l.qty;
      }
      const flags = [];
      for (const g of ["A", "B"]) flags.push(...negativeStockFlags(ctx.balances.filter(b => b.grade === g), moves.filter(m => m.grade === g), X.role));
      if (input.over && over.length) flags.push({ op: "flag", kind: "ทำนอกขั้นตอน", team: X.role, entity: "orders", entity_id: o.id, title: "ขึ้นรถเกินออเดอร์: " + o.customer_name, detail: over.join(" · ") + " · เหตุผล: " + X.reason });
      if (input.early && early.length) flags.push({ op: "flag", kind: "ทำนอกขั้นตอน", team: X.role, entity: "orders", entity_id: o.id, title: "ขึ้นรถก่อนสกรีนเสร็จ: " + o.customer_name, detail: early.join(" · ") + " · เหตุผล: " + X.reason });
      const label = "ขึ้นรถ " + ctx.vehicle.id + " · " + o.customer_name;
      return {
        result: { order: o.id, vehicle: ctx.vehicle.id, loads: loadRows.map(r => r.row.id), pcs }, label,
        ops: [{ op: "note", entity: "orders", entity_id: o.id, after: { loaded: pcs, vehicle: ctx.vehicle.id } }, ...trip.ops, ...loadRows, ...itemOps(ctx.items, deltas), ...moves, ...flags],
        conflictMessage: "มีคนขึ้นรถ/ส่งรายการนี้พร้อมกัน — โหลดใหม่แล้วดูว่ายังเหลือเท่าไร",
      };
    },
  });

  // ---- ส่งแล้ว (เต็ม/บางส่วน) — ที่เหลือยังอยู่บนรถ · ออเดอร์ที่ยังไม่ครบค้างเป็นงวดถัดไป ----
  R.define({
    name: "deliver.done", roles: ROLES, write: true, label: "ส่งแล้ว",
    undo: { guard: billAfterGuard("SELECT order_id FROM delivery_loads WHERE stop_id = ?") },   // ออกบิลหลังส่งแล้ว = ย้อนส่งไม่ได้
    input: raw => ({ order: need(raw.order, "ออเดอร์", 40), loads: loadRefs(raw.loads, true) }),
    load: (X, input) => readLoads(X, input.loads, [
      ["SELECT i.*, t.piece_unit FROM order_items i LEFT JOIN product_types t ON t.code = i.type WHERE i.order_id = ?", input.order],
      ["SELECT * FROM production_jobs WHERE order_id = ?", input.order],
      ["SELECT * FROM screen_jobs WHERE order_id = ?", input.order],
      ["SELECT * FROM delivery_loads WHERE order_id = ?", input.order],
    ]),
    async run(X, input, ctx) {
      const all = new Map(ctx.extra[0].map(i => [i.id, i]));
      const [, prodJobs, screenJobs, orderLoads] = ctx.extra;
      const o = ctx.orders.get(input.order);
      if (!o) throw bad("ของที่เลือกไม่ใช่ของออเดอร์นี้ — โหลดใหม่");
      if (o.status === "ยกเลิก") throw conflict("ออเดอร์นี้ถูกยกเลิกแล้ว — เอาของลงคืนคลังแทน");
      const stop = "P" + X.newId(), at = iso(X.now), today = thaiDay(X.now);
      const ops = [{ op: "note", entity: "delivery_stops", entity_id: stop, after: { order: o.id, loads: ctx.picked.map(l => l.id) } }];
      const deltas = new Map(), rest = [], changed = [];
      let pcs = 0;
      for (const l of ctx.picked) {
        if (l.order_id !== o.id) throw bad("ของที่เลือกปนกันหลายออเดอร์ — กดส่งทีละร้าน");
        if (ON_TRUCK.indexOf(l.status) < 0) throw loadConflict(l);
        const q = l.want === null ? l.qty_pcs : l.want;
        if (q === 0) throw bad("จำนวนส่ง 0 — ถ้าร้านไม่รับเลย ให้กด \"ส่งไม่ได้\" แทน");
        if (q > l.qty_pcs) throw bad("ส่งได้ไม่เกินที่อยู่บนรถ (" + qtyText(all.get(l.order_item_id), l.qty_pcs) + ") — ถ้าส่งเกิน ให้ขึ้นรถเพิ่มก่อน");
        const set = { status: "ส่งแล้ว", done_at: at, done_day: today, done_by: X.staff.id, stop_id: stop };
        if (q < l.qty_pcs) {
          set.qty_pcs = q;
          const rid = "L" + X.newId();
          rest.push({ op: "insert", table: "delivery_loads", row: { id: rid, trip_id: l.trip_id, order_id: l.order_id, order_item_id: l.order_item_id, qty_pcs: l.qty_pcs - q, status: "บนรถ", loaded_at: l.loaded_at, loaded_by: l.loaded_by, stock_key: l.stock_key, split_from: l.id, note: "เหลือจากส่งบางส่วน" } });
        }
        ops.push({ op: "update", table: "delivery_loads", id: l.id, expect: l.version, before: l, set });
        changed.push({ id: l.id, order_id: l.order_id, order_item_id: l.order_item_id, ...set, qty_pcs: q });
        addDelta(deltas, l.order_item_id, "delivered", q);
        addDelta(deltas, l.order_item_id, "onboard", -q);
        pcs += q;
      }
      ops.push(...rest, ...itemOps(all, deltas));
      const after = [...all.values()].map(i => { const d = deltas.get(i.id) || {}; return { ...i, delivered_pcs: i.delivered_pcs + (d.delivered || 0), onboard_pcs: Math.max(0, i.onboard_pcs + (d.onboard || 0)) }; });
      const statusOps = orderStatusOp(X, o, after, prodJobs, screenJobs, patchRows(orderLoads, [...changed, ...rest.map(r => r.row)]));
      ops.push(...statusOps);
      const next = statusOps.length && statusOps[0].set.status ? statusOps[0].set.status : o.status;
      const restPcs = rest.reduce((s, r) => s + r.row.qty_pcs, 0);
      return {
        result: { stop, order: o.id, pcs, rest_pcs: restPcs, order_status: next }, label: "ส่งแล้ว · " + o.customer_name + (next === "ส่งบางส่วน" ? " (บางส่วน)" : ""), ops,
        conflictMessage: "มีคนส่ง/แก้รายการนี้พร้อมกัน — โหลดใหม่แล้วดูอีกครั้ง",
      };
    },
  });

  // ---- ส่งไม่ได้ + เหตุผล (ของยังอยู่บนรถ · แจ้งออฟฟิศด้วยธง) ----
  R.define({
    name: "deliver.fail", roles: ROLES, write: true, reason: "required", label: "ส่งไม่ได้",
    input: raw => ({ order: need(raw.order, "ออเดอร์", 40), loads: loadRefs(raw.loads, false) }),
    load: (X, input) => readLoads(X, input.loads),
    async run(X, input, ctx) {
      const o = ctx.orders.get(input.order);
      if (!o) throw bad("ของที่เลือกไม่ใช่ของออเดอร์นี้ — โหลดใหม่");
      const at = iso(X.now), today = thaiDay(X.now);
      const ops = [{ op: "note", entity: "orders", entity_id: o.id, after: { fail: X.reason } }];
      for (const l of ctx.picked) {
        if (l.order_id !== o.id) throw bad("ของที่เลือกปนกันหลายออเดอร์ — กดทีละร้าน");
        if (ON_TRUCK.indexOf(l.status) < 0) throw loadConflict(l);
        ops.push({ op: "update", table: "delivery_loads", id: l.id, expect: l.version, before: l, set: { status: "ส่งไม่ได้", fail_reason: X.reason, done_at: at, done_day: today, done_by: X.staff.id } });
      }
      ops.push({ op: "flag", kind: "ส่งไม่ได้", team: "", entity: "orders", entity_id: o.id, title: "ส่งไม่ได้: " + o.customer_name + " — " + X.reason,
        detail: "ของยังอยู่บนรถ " + [...new Set(ctx.picked.map(l => l.vehicle_id).filter(Boolean))].join(", ") + " · ถ้าต้องเลื่อนวันส่ง ให้ออฟฟิศแก้ในออเดอร์", dedupe_key: "fail:" + o.id + ":" + today });
      return { result: { order: o.id }, label: "ส่งไม่ได้ · " + o.customer_name, ops };
    },
  });

  // ---- เอาของลงจากรถ (คืนคลัง) — ทั้งคันได้ ----
  R.define({
    name: "deliver.unload", roles: ROLES, write: true, reason: "optional", label: "เอาของลงจากรถ",
    input: raw => ({ loads: loadRefs(raw.loads, false) }),
    load: (X, input) => readLoads(X, input.loads, [
      [B_COLORS_SQL],
    ]),
    async run(X, input, ctx) {
      const at = iso(X.now), today = thaiDay(X.now);
      const ops = [], moves = [], deltas = new Map(), names = new Set();
      let pcs = 0;
      for (const l of ctx.picked) {
        if (ON_TRUCK.indexOf(l.status) < 0) throw loadConflict(l);
        const it = ctx.items.get(l.order_item_id), o = ctx.orders.get(l.order_id);
        if (o) names.add(o.customer_name);
        ops.push({ op: "update", table: "delivery_loads", id: l.id, expect: l.version, before: l, set: { status: "คืนคลัง", done_at: at, done_day: today, done_by: X.staff.id, note: X.reason || l.note } });
        const key = l.stock_key || (it ? plainKey(it) : "");
        if (key) moves.push({ op: "move", item_key: key, label: l.stock_label || (it ? itemName(it) : ""), grade: it ? gradeFor(key, it, ctx.extra[0].map(b => b.value)) : "A", qty_pcs: l.qty_pcs, move_type: "คืนคลัง", ref_entity: "delivery_loads", ref_id: l.id, reason: X.reason });
        addDelta(deltas, l.order_item_id, "onboard", -l.qty_pcs);
        pcs += l.qty_pcs;
      }
      ops.push(...itemOps(ctx.items, deltas), ...moves);
      const who = [...names];
      return { result: { pcs, loads: ctx.picked.length }, label: "เอาลงจากรถ · " + (who.length > 2 ? who.slice(0, 2).join(", ") + " และอีก " + (who.length - 2) + " ร้าน" : who.join(", ")), ops };
    },
  });

  // ---- ย้ายคัน (ขึ้นผิดคัน / ถ่ายของข้ามรถ) — สต๊อกไม่ขยับ ----
  R.define({
    name: "deliver.retruck", roles: ROLES, write: true, label: "ย้ายคัน",
    input: raw => ({ loads: loadRefs(raw.loads, false), vehicle: need(raw.vehicle, "คันรถ", 20) }),
    load: (X, input) => readLoads(X, input.loads, [
      ["SELECT * FROM vehicles WHERE id = ?", input.vehicle],
      ["SELECT * FROM delivery_trips WHERE id = ?", tripId(thaiDay(X.now), input.vehicle)],
    ]),
    async run(X, input, ctx) {
      const v = ctx.extra[0][0];
      if (!v || !v.active) throw bad("ไม่มีรถคัน " + input.vehicle + " ในทะเบียน (หรือพักใช้อยู่)");
      const trip = tripOps(X, { trip: ctx.extra[1][0] || null }, v.id);
      const ops = [...trip.ops];
      for (const l of ctx.picked) {
        if (ON_TRUCK.indexOf(l.status) < 0) throw loadConflict(l);
        if (l.vehicle_id === v.id) throw bad("ของนี้อยู่บนรถ " + v.id + " อยู่แล้ว");
        ops.push({ op: "update", table: "delivery_loads", id: l.id, expect: l.version, before: l, set: { trip_id: trip.id } });
      }
      return { result: { vehicle: v.id }, label: "ย้ายไปรถ " + v.id, ops };
    },
  });
}
