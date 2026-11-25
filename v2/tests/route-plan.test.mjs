import { test } from "node:test";
import assert from "node:assert/strict";
import { world, T0 } from "./helpers/world.mjs";
import { addDays, specKey } from "../server/core.mjs";

const TODAY = "2026-11-16";
const day = offset => addDays(TODAY, offset);
const AT = new Date(T0).toISOString();
const BOTTLE = { type: "ขวด", size: "600 ml", neck: "คอยาว", shape: "MK", color: "ใส" };
const SPEC = specKey(BOTTLE);
const KEY = "spec:" + SPEC;

async function setup() {
  const W = world();
  const office = await W.staff("S1", "ออฟฟิศทดสอบ", ["office"]);
  const screen = await W.staff("S2", "สกรีนทดสอบ", ["screen"]);
  const helper = await W.staff("S3", "ผู้ช่วยทดสอบ", ["screen"]);
  const exec = await W.staff("S4", "ประธานทดสอบ", ["exec"]);
  const put = (sql, ...args) => W.d1.raw.prepare(sql).run(...args);
  put("INSERT INTO routes(code,name,created_at,updated_at) VALUES ('test-route','สายทดสอบ',?,?)", AT, AT);
  put("INSERT INTO route_areas(route_code,name,confirmed,created_at,updated_at) VALUES ('test-route','เถิน',1,?,?)", AT, AT);
  for (const [id, district, route] of [["CA", "อ.เมืองลำปาง", null], ["CB", "เถิน", "test-route"], ["CC", "เถิน", "test-route"], ["CD", "เถิน", null]]) {
    put("INSERT INTO customers(id,name,name_key,district,route_code,created_at,updated_at) VALUES (?,?,?,?,?,?,?)", id, "ร้านทดสอบ " + id, id, district, route, AT, AT);
  }
  const ok = async (token, action, input, more) => {
    const out = await W.call(token, action, input, more);
    assert.equal(out.status, 200, action + " " + JSON.stringify(out.error));
    return out;
  };
  const order = async (customer, opts = {}) => (await ok(office, "office.order_create", {
    customer_id: customer, purchase_type: "ขายราคาโรงงาน",
    items: [{ ...BOTTLE, bags: 3 }], ...opts,
  })).data.id;
  const board = async () => (await ok(screen, "route_plan.board")).data;
  const moveInput = (stop, to) => ({ id: stop.order, version: stop.version, round: stop.round, round_version: stop.roundVersion, to_day: to });
  const stock = (key, grade, qty) => put(`INSERT INTO stock_moves(item_key,grade,qty_pcs,move_type,at,day)
    VALUES (?,?,?, 'ยอดยกมา',?,?)`, key, grade, qty, AT, TODAY);
  return { W, office, screen, helper, exec, put, ok, order, board, moveInput, stock };
}

test("ปฏิทิน 7 วัน: งวดส่งจริงทุกวันที่นัด · ส่วนขาดจากงวดก่อน · ของบนรถ · สายจากทะเบียน · รอลงวัน · กรองสิทธิ์และข้อมูลเงิน", async () => {
  const { W, office, screen, exec, put, order, board } = await setup();
  const fixed = await order("CD", { items: [{ ...BOTTLE, bags: 6, price_satang: 321 }],
    plan: { mode: "กำหนดจำนวน", first_day: TODAY, times: 3, every_days: 2 } });
  const held = await order("CB", { hold: true, plan: { first_day: day(1) } });
  const city = await order("CA", { plan: { first_day: day(1) } });
  const reserve = await order("CB");
  const item = W.one("SELECT id FROM order_items WHERE order_id = ?", fixed).id;
  put(`INSERT INTO delivery_loads(id,order_id,order_item_id,qty_pcs,status,loaded_at,done_at,done_day,created_at,updated_at)
    VALUES ('sent',?,?,200,'ส่งแล้ว',?,?,?,?,?)`, fixed, item, AT, AT, TODAY, AT, AT);
  put(`INSERT INTO delivery_loads(id,order_id,order_item_id,qty_pcs,status,loaded_at,created_at,updated_at)
    VALUES ('ontruck',?,?,200,'บนรถ',?,?,?)`, fixed, item, AT, AT, AT);
  const d = await board();
  assert.deepEqual(d.days.map(d => d.day), Array.from({ length: 7 }, (_, i) => day(i)));
  assert.equal(d.days[1].stops.find(s => s.order === city).area.daily, true);
  const rounds = d.days.flatMap(day => day.stops).filter(s => s.order === fixed);
  assert.deepEqual(rounds.map(s => [s.seq, s.day, s.lines[0].pcs, s.lines[0].ready]), [[2, day(2), 600, 200], [3, day(4), 400, 0]]);
  assert.deepEqual(rounds[0].area, { code: "test-route", name: "เถิน", daily: false, suggested: true });
  assert.deepEqual(d.tray.map(s => s.order), [reserve]);
  assert.ok(!JSON.stringify(d).includes(held));
  assert.doesNotMatch(JSON.stringify(d), /satang|phone|address|map_url/);
  assert.equal((await W.call(office, "route_plan.board")).status, 403);
  assert.equal((await W.call(exec, "route_plan.board", {}, { as: "screen" })).status, 200);
  assert.equal((await W.call(screen, "office.round_move", {})).status, 403);
});

test("ขวดที่ต้องมี: ดันคิวกลางชนะวัน · สต๊อกเปล่าและสกรีนใช้ครั้งเดียว · เกรด B ไม่ปน A · รอบเดินหักได้แต่ยังไม่พร้อม", async () => {
  const { W, office, put, ok, order, board, stock } = await setup();
  const early = await order("CA", { plan: { first_day: TODAY } });
  const screened = await order("CB", { plan: { first_day: day(3) }, items: [{ ...BOTTLE, bags: 3, screen_color: "แดง" }] });
  const late = await order("CC", { plan: { first_day: day(4) } });
  await ok(office, "office.prio_move", { id: screened, version: W.one("SELECT version FROM orders WHERE id = ?", screened).version, dir: "up" }, { reason: "ทดสอบคิว" });
  stock(KEY, "A", 500);
  stock(KEY, "B", 900);
  stock(KEY + "|สกรีน แดง", "A", 200);
  stock(KEY + "|สกรีน ขาว", "A", 600);
  put("INSERT INTO production_jobs(id,type,spec_key,target_pcs,status,created_at,updated_at) VALUES ('job','ขวด',?,300,'กำลังผลิต',?,?)", SPEC, AT, AT);
  const machine = "test-machine";
  put("INSERT INTO machines(id,name,kind,created_at,updated_at) VALUES (?,'เครื่องทดสอบ','เป่า',?,?)", machine, AT, AT);
  put("INSERT INTO machine_runs(id,machine_id,job_id,type,spec_key,started_at,started_day,created_at,updated_at) VALUES ('run',?,'job','ขวด',?,?,?,?,?)", machine, SPEC, AT, TODAY, AT, AT);
  const d = await board();
  const line = id => d.days.flatMap(d => d.stops).find(s => s.order === id).lines[0];
  assert.deepEqual([line(screened).ready, line(screened).needsScreen, line(screened).short], [200, 400, 0]);
  assert.deepEqual([line(early).ready, line(early).running, line(early).blow], [100, 300, 200]);
  assert.equal(line(late).blow, 600);
  assert.equal(d.needs.find(n => n.day === day(4)).before, day(3));
  put("INSERT INTO machine_events(id,machine_id,kind,started_at,started_day,created_at,updated_at) VALUES ('stop',?,'จอดเครื่อง',?,?,?,?)", machine, AT, TODAY, AT, AT);
  assert.equal((await board()).needs.find(n => n.day === TODAY).blow, 500);
});

test("หมุดและย้ายวัน: สิทธิ์ · ชนกัน · ส่งซ้ำ · นอกสายมีเหตุผลและธง · ย้อนแล้วคืนวันเดิม", async () => {
  const { W, office, screen, helper, ok, order, board, moveInput } = await setup();
  const target = { day: day(1), routes: ["test-route"], version: 0 };
  assert.equal((await W.call(office, "route_plan.pins", target)).status, 403);
  assert.equal((await W.call(screen, "route_plan.pins", { ...target, routes: ["other"] })).status, 400);
  const key = W.key();
  const first = await ok(screen, "route_plan.pins", target, { key });
  assert.equal((await ok(screen, "route_plan.pins", target, { key })).undo.id, first.undo.id);
  assert.equal((await W.call(helper, "route_plan.pins", target)).status, 409);
  const city = await order("CA");
  const area = await order("CB", { plan: { mode: "ครั้งเดียว" } });
  let d = await board();
  const cityMove = moveInput(d.tray.find(s => s.order === city), day(2));
  assert.equal((await W.call(office, "route_plan.move", cityMove)).status, 403);
  await ok(screen, "route_plan.move", cityMove);
  const areaMove = moveInput(d.tray.find(s => s.order === area), day(2));
  assert.equal((await W.call(screen, "route_plan.move", areaMove)).error.code, "need_reason");
  const moveKey = W.key();
  const moved = await ok(screen, "route_plan.move", areaMove, { reason: "รถว่างทดสอบ", key: moveKey });
  assert.equal((await ok(screen, "route_plan.move", areaMove, { reason: "รถว่างทดสอบ", key: moveKey })).undo.id, moved.undo.id);
  assert.equal(W.one("SELECT count(*) AS n FROM flags WHERE kind = 'จัดส่งนอกสาย'").n, 1);
  assert.equal((await W.call(helper, "route_plan.move", { ...areaMove, to_day: day(1) })).status, 409);
  d = await board();
  const moveBack = moveInput(d.days[2].stops.find(s => s.order === area), day(1));
  await ok(helper, "route_plan.move", moveBack, { reason: "ลูกค้าขอเลื่อน" });
  assert.equal(W.one("SELECT cause FROM reschedule_events WHERE order_id = ?", area).cause, "ลูกค้าขอเลื่อน");
  assert.equal((await W.call(screen, "undo.run", { id: moved.undo.id })).status, 409);
  const active = (await board()).days[1].pinVersion;
  assert.equal(active, 1);
  await ok(screen, "undo.run", { id: first.undo.id });
  assert.deepEqual((await board()).days[1].pins, []);
});

test("ประกาศแผน: เก็บ 7 วัน · แชร์ข้อความ · สิทธิ์/ชนกัน/ซ้ำ · แก้หลังประกาศนับและย้อนได้", async () => {
  const { W, office, screen, helper, ok, order, board, moveInput } = await setup();
  await order("CA", { plan: { first_day: day(1) } });
  const following = await order("CA");
  const pinnedBefore = await ok(screen, "route_plan.pins", { day: day(1), version: 0, routes: ["test-route"] });
  let d = await board();
  const publish = { start: d.start, revision: d.revision };
  assert.equal((await W.call(office, "route_plan.publish", publish)).status, 403);
  assert.equal((await W.call(screen, "route_plan.publish", { ...publish, revision: publish.revision + 1 })).status, 409);
  const key = W.key();
  const published = await ok(screen, "route_plan.publish", publish, { key });
  assert.equal((await ok(screen, "route_plan.publish", publish, { key })).data.share, published.data.share);
  assert.equal((await W.call(helper, "route_plan.publish", publish)).status, 409);
  assert.match(published.data.share, /แผนสายส่ง.*\n.*\n.*อำเภอเมือง/s);
  assert.doesNotMatch(published.data.share, /ร้านทดสอบ|2026-11/);
  assert.equal(W.one("SELECT count(*) AS n FROM plan_lines WHERE status = 'ใช้งาน'").n, 7);
  d = await board();
  assert.equal((await W.call(screen, "undo.run", { id: pinnedBefore.undo.id })).status, 409);
  const pins = { day: TODAY, version: 0, routes: ["test-route"] };
  assert.equal((await W.call(screen, "route_plan.pins", pins)).error.code, "need_reason");
  const pinnedAfter = await ok(screen, "route_plan.pins", pins, { reason: "ปรับแผนสายส่ง" });
  assert.equal((await board()).publication.changes, 1);
  await ok(screen, "undo.run", { id: pinnedAfter.undo.id });
  const move = moveInput(d.tray.find(s => s.order === following), day(1));
  assert.equal((await W.call(screen, "route_plan.move", move)).error.code, "need_reason");
  const saved = await ok(screen, "route_plan.move", move, { reason: "ปรับแผนสายส่ง" });
  assert.equal((await board()).publication.changes, 1);
  assert.equal((await W.call(screen, "undo.run", { id: published.undo.id })).status, 409);
  await ok(screen, "undo.run", { id: saved.undo.id });
  assert.equal((await board()).publication.changes, 0);
  assert.equal(W.one("SELECT reason FROM audit_log WHERE action = 'route_plan.move' LIMIT 1").reason, "ปรับแผนสายส่ง");
  const next = await board();
  const again = await ok(screen, "route_plan.publish", { start: next.start, revision: next.revision });
  await ok(screen, "undo.run", { id: again.undo.id });
  assert.equal(W.one("SELECT count(*) AS n FROM plan_lines WHERE status = 'ใช้งาน'").n, 7);
});
