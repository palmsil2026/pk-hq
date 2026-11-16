// เทสต์โมดูลทีมผลิต: รอบเครื่องทั้งวงจร · จอด/เดินต่อ · เปลี่ยนโมลด์ · งานรอผลิต · สต๊อก A/B · รอบค้าง · ทะเบียนเครื่อง · หน้าอ่าน
//   ทุก action: ถูก · ผิดสิทธิ์ · ซ้ำ · ย้อน · ชนกัน · ข้ามเที่ยงคืน · สองคนกดเครื่องเดียวกัน
import { test } from "node:test";
import assert from "node:assert/strict";
import { world, T0 } from "./helpers/world.mjs";
import { thaiDay, specKey } from "../server/core.mjs";

const H = 3600000;
const SPEC = { type: "ขวด", size: "600 ml", neck: "คอยาว", shape: "MK", color: "ใส" };
const KEY = "spec:" + specKey(SPEC, "ขนาด,คอขวด,รูปทรง,สี,สีสกรีน,พร้อมฝาสี");

async function setup(opt) {
  const W = world(opt);
  const ex = await W.staff("S9", "หัวหน้า", ["exec"]);
  for (const s of ["ref:products", "ref:machines"]) assert.equal((await W.call(ex, "import.run", { source: s })).ok, true);
  await W.staff("S1", "เปา", ["prod"]);
  await W.staff("S2", "เอ็ม", ["prod"]);
  await W.staff("S5", "ออย", ["office"]);
  const g = (id, nick) => W.ticket(id, nick, ["prod"], "1234", { k: "g", exp: W.clock.now + 5 * 60000 });
  W.T = { ex, ofc: await W.ticket("S5", "ออย", ["office"]), dev: await W.ticket("S1", "เปา", ["prod"]), pao: () => g("S1", "เปา"), em: () => g("S2", "เอ็ม"),
    exg: () => W.ticket("S9", "หัวหน้า", ["exec"], "1234", { k: "g", exp: W.clock.now + 5 * 60000 }) };
  W.p = async (action, input, more) => W.call(await W.T.pao(), action, input, Object.assign({ as: "prod" }, more || {}));
  W.e = async (action, input, more) => W.call(await W.T.em(), action, input, Object.assign({ as: "prod" }, more || {}));
  return W;
}
function order(W, id, items, o) {
  const at = new Date(W.clock.now).toISOString(), x = o || {};
  W.d1.raw.prepare("INSERT OR IGNORE INTO customers(id,name,name_key,created_at,updated_at) VALUES ('CX','ร้านทดสอบ','ร้านทดสอบ',?,?)").run(at, at);
  W.d1.raw.prepare("INSERT INTO orders(id,order_day,customer_id,due_day,status,urgent,brand,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run(id, thaiDay(W.clock.now), "CX", x.due || "", x.status || "รอผลิต", x.urgent || 0, x.brand || "", at, at);
  items.forEach((it, i) => W.d1.raw.prepare("INSERT INTO order_items(id,order_id,line_no,type,size,neck,shape,color,spec_key,bags,per_bag,qty_pcs,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(id + "-" + (i + 1), id, i + 1, it.type, it.size, it.neck || "", it.shape || "", it.color || "", specKey(it, it.type === "ขวด" ? "ขนาด,คอขวด,รูปทรง,สี" : "ขนาด,สี"), it.bags || 0, it.bags ? it.per : 0, it.bags ? it.bags * it.per : it.qty, at, at));
}
const bal = (W, g) => (W.one("SELECT qty_pcs FROM stock_balance WHERE item_key = ? AND grade = ?", KEY, g || "A") || { qty_pcs: 0 }).qty_pcs;
const open = (W, m, more) => W.p("run.open", Object.assign({ machine: m || "PET1", ...SPEC, crew: ["เปา", "เอ็ม"] }, more || {}));

test("ทะเบียน + ผังจริง: 12 เครื่องนับ · ฉีดในแอปเดิมอยู่ถาด · ห้อง/อาคารอยู่ในผัง · ไม่ระบุเครื่องไม่ขึ้นผัง", async () => {
  const W = await setup();
  const f = await W.call(W.T.dev, "prod.floor", {}, { as: "prod" });
  assert.equal(f.ok, true);
  assert.equal(f.data.summary.total, 12);
  assert.equal(f.data.summary.running, 0);
  const tray = f.data.machines.filter(m => !m.plant).map(m => m.id).sort();
  assert.deepEqual(tray, ["LG17228", "SHE230G"]);
  const k4 = f.data.machines.find(m => m.id === "K4");
  assert.deepEqual([k4.x, k4.y, k4.w, k4.h, k4.plant, k4.tracked], [1268, 413, 335, 55, "โรง 1", 0]);
  assert.equal(f.data.machines.find(m => m.id === "PET9").plant, "โรง 2");
  assert.ok(f.data.layout.areas.some(a => a.kind === "ext" && a.name === "ร้านกาแฟ"));
  assert.equal(f.data.layout.buildings.length, 2);
  assert.ok(!f.data.machines.some(m => m.id === "NOMACHINE"));
  assert.equal(new Set(f.data.machines.map(m => m.name)).size, f.data.machines.length);
  // ออฟฟิศอ่านผังได้ · ทำรอบไม่ได้
  assert.equal((await W.call(W.T.ofc, "prod.floor", {})).ok, true);
});

test("เปิดรอบ: PIN ตอนกด (ตั๋วประจำเครื่องไม่พอ) · สิทธิ์ · ผู้ปฏิบัติงานหลายคน · ไม่เกิน 4 รอบคุยกับฐาน · แผนผังเห็นเดิน", async () => {
  const W = await setup();
  const viaDevice = await W.call(W.T.dev, "run.open", { machine: "PET1", ...SPEC, crew: ["เปา"] }, { as: "prod" });
  assert.equal(viaDevice.status, 401); assert.equal(viaDevice.error.code, "need_pin");
  const ofc = await W.call(await W.ticket("S5", "ออย", ["office"], "1234", { k: "g", exp: W.clock.now + 60000 }), "run.open", { machine: "PET1", ...SPEC, crew: ["เปา"] });
  assert.equal(ofc.status, 403);
  W.d1.stats.rounds = 0;
  const r = await open(W);
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.ok(W.d1.stats.rounds <= 4, "คุยกับฐาน " + W.d1.stats.rounds + " รอบ");
  const run = W.one("SELECT * FROM machine_runs WHERE id = ?", r.data.id);
  assert.equal(run.status, "กำลังผลิต"); assert.equal(run.opened_by, "S1"); assert.equal(run.spec_key, KEY.slice(5)); assert.equal(run.chain_id, run.id);
  assert.deepEqual(W.q("SELECT name_text, staff_id FROM run_crew WHERE run_id = ? ORDER BY name_text", r.data.id).map(x => x.name_text + ":" + x.staff_id), ["เปา:S1", "เอ็ม:S2"]);
  assert.ok(W.one("SELECT count(*) n FROM audit_log WHERE action = 'run.open' AND staff_id = 'S1'").n >= 3);
  const f = (await W.call(W.T.dev, "prod.floor", {}, { as: "prod" })).data;
  const m = f.machines.find(x => x.id === "PET1");
  assert.equal(m.state, "เดิน"); assert.equal(m.run.crew, "เปา , เอ็ม"); assert.equal(f.summary.running, 1);
  // ประธานใช้แอปทีมผลิตได้ (ต้องใส่ PIN ตอนกดเหมือนกัน)
  const e = await W.call(await W.T.exg(), "run.open", { machine: "PET2", type: "ขวด", size: "250 ml", neck: "คอยาว", shape: "เพชร", color: "ใส", crew: ["หัวหน้า"] }, { as: "prod" });
  assert.equal(e.ok, true, JSON.stringify(e.error));
  // ตรวจค่าเข้า
  assert.equal((await W.p("run.open", { machine: "PET3", ...SPEC, crew: [] })).status, 400);
  assert.match((await W.p("run.open", { machine: "PET3", ...SPEC, type: "จาน", crew: ["เปา"] })).error.message, /ไม่รู้จักประเภท/);
  assert.match((await W.p("run.open", { machine: "AIR1", ...SPEC, crew: ["เปา"] })).error.message, /เปิดรอบผลิตได้เฉพาะ/);
  assert.match((await W.p("run.open", { machine: "PET3", ...SPEC, crew: ["เปา"], started_at: new Date(W.clock.now + 2 * H).toISOString() })).error.message, /อนาคต/);
  assert.match((await W.p("run.open", { machine: "PET3", ...SPEC, crew: ["เปา"], started_at: new Date(W.clock.now - 13 * H).toISOString() })).error.message, /ย้อนไปเกิน/);
});

test("เปิดซ้ำบนเครื่องที่มีรอบ = 409 พร้อมรอบนั้น · สองคนกดเครื่องเดียวกันพร้อมกัน = ได้รอบเดียว · กดซ้ำด้วยกุญแจเดิม = ผลเดิม", async () => {
  const W = await setup();
  const key = W.key();
  const a = await open(W, "PET1", {});
  const again = await open(W);
  assert.equal(again.status, 409);
  assert.match(again.error.message, /มีรอบเปิดอยู่แล้ว.*ปิดรอบนั้นก่อน/);
  assert.equal(again.error.open.id, a.data.id); assert.equal(again.error.open.crew, "เปา , เอ็ม");
  // สองคนกดพร้อมกันบนอีกเครื่อง
  const [x, y] = await Promise.all([open(W, "PET4"), W.e("run.open", { machine: "PET4", ...SPEC, crew: ["เอ็ม"] })]);
  assert.equal([x, y].filter(r => r.ok).length, 1);
  assert.equal([x, y].find(r => !r.ok).status, 409);
  assert.equal(W.one("SELECT count(*) n FROM machine_runs WHERE machine_id = 'PET4' AND status = 'กำลังผลิต'").n, 1);
  // กุญแจเดิม = ผลเดิม ไม่เปิดซ้ำ
  const t = await W.T.pao();
  const k1 = await W.call(t, "run.open", { machine: "PET5", ...SPEC, crew: ["เปา"] }, { as: "prod", key });
  const k2 = await W.call(t, "run.open", { machine: "PET5", ...SPEC, crew: ["เปา"] }, { as: "prod", key });
  assert.equal(k2.replayed, true); assert.equal(k2.data.id, k1.data.id);
  assert.equal(W.one("SELECT count(*) n FROM machine_runs WHERE machine_id = 'PET5'").n, 1);
});

test("ปิดรอบ: ดี = เกรด A · เกรด B แยกบัญชี · เสียไม่เข้าสต๊อก · ข้ามเที่ยงคืน · ย้อนได้ (ไม่ลบแถว) · ของถูกใช้ไปแล้ว = ย้อนไม่ได้", async () => {
  const W = await setup({ now: Date.UTC(2026, 10, 16, 15, 0) });   // 22:00 ไทย
  const r = await open(W);
  W.tick(8.5 * H);   // 06:30 วันถัดไป
  const run = W.one("SELECT * FROM machine_runs WHERE id = ?", r.data.id);
  const c = await W.e("run.close", { run: r.data.id, version: run.version, good: 20000, b: 120, waste: 30, waste_reason: "ก้นบาง" });
  assert.equal(c.ok, true, JSON.stringify(c.error));
  const done = W.one("SELECT * FROM machine_runs WHERE id = ?", r.data.id);
  assert.equal(done.status, "ปิดแล้ว"); assert.equal(done.started_day, "2026-11-16"); assert.equal(done.ended_day, "2026-11-17");
  assert.equal(done.closed_by, "S2"); assert.equal(done.stocked, 1); assert.equal(done.late_close, 0);
  assert.equal(bal(W, "A"), 20000); assert.equal(bal(W, "B"), 120);
  // ประวัติวันปิดนับยอด
  const h = (await W.call(W.T.dev, "prod.history", { day: "2026-11-17" }, { as: "prod" })).data;
  assert.equal(h.totals.good, 20000); assert.equal(h.runs.length, 1);
  // ปิดซ้ำ = 409
  assert.equal((await W.e("run.close", { run: r.data.id, version: done.version, good: 1 })).status, 409);
  // ย้อน
  const u = await W.call(await W.T.em(), "undo.run", { id: c.undo.id }, { as: "prod" });
  assert.equal(u.ok, true, JSON.stringify(u.error));
  assert.equal(W.one("SELECT status FROM machine_runs WHERE id = ?", r.data.id).status, "กำลังผลิต");
  assert.equal(bal(W, "A"), 0); assert.equal(bal(W, "B"), 0);
  assert.equal(W.one("SELECT count(*) n FROM stock_moves").n, 4, "ย้อน = ลงแถวกลับทิศ ไม่ลบ");
  // ปิดใหม่ → ส่งของออกไป → ย้อนไม่ได้ ต้องแก้ยอด
  const v = W.one("SELECT version FROM machine_runs WHERE id = ?", r.data.id).version;
  const c2 = await W.e("run.close", { run: r.data.id, version: v, good: 1000, b: 0, waste: 0 });
  W.d1.raw.prepare("INSERT INTO stock_moves(at,day,item_key,grade,qty_pcs,move_type,ref_entity,ref_id) VALUES (?,?,?,?,?,?,?,?)").run(new Date(W.clock.now).toISOString(), "2026-11-17", KEY, "A", -600, "ส่งออก", "delivery_loads", "L1");
  const u2 = await W.call(await W.T.em(), "undo.run", { id: c2.undo.id }, { as: "prod" });
  assert.equal(u2.status, 409); assert.match(u2.error.message, /แก้ยอด/);
});

test("เปลี่ยนสี: ปิดช่วงเดิมพร้อมยอด + เปิดช่วงสีใหม่ (คนเดิม · สายเดียวกัน) · ย้อนแล้วกลับเป็นรอบเดิม", async () => {
  const W = await setup();
  const r = await open(W);
  W.tick(2 * H);
  const v = W.one("SELECT version FROM machine_runs WHERE id = ?", r.data.id).version;
  assert.match((await W.p("run.color", { run: r.data.id, version: v, color: "ใส", good: 1 })).error.message, /เหมือนสีเดิม/);
  const c = await W.p("run.color", { run: r.data.id, version: v, color: "น้ำเงิน", good: 5000, b: 20 });
  assert.equal(c.ok, true, JSON.stringify(c.error));
  const old = W.one("SELECT * FROM machine_runs WHERE id = ?", r.data.id), nu = W.one("SELECT * FROM machine_runs WHERE id = ?", c.data.id);
  assert.equal(old.end_kind, "เปลี่ยนสี"); assert.equal(old.good_pcs, 5000); assert.equal(nu.status, "กำลังผลิต"); assert.equal(nu.color, "น้ำเงิน");
  assert.equal(nu.chain_id, r.data.id); assert.equal(nu.prev_run_id, r.data.id); assert.equal(nu.started_at, old.ended_at);
  assert.ok(nu.spec_key.endsWith("|น้ำเงิน"));
  assert.equal(W.q("SELECT name_text FROM run_crew WHERE run_id = ?", c.data.id).length, 2);
  assert.equal(bal(W), 5000);
  const u = await W.call(await W.T.pao(), "undo.run", { id: c.undo.id }, { as: "prod" });
  assert.equal(u.ok, true, JSON.stringify(u.error));
  assert.equal(W.one("SELECT status FROM machine_runs WHERE id = ?", r.data.id).status, "กำลังผลิต");
  assert.equal(W.one("SELECT status FROM machine_runs WHERE id = ?", c.data.id).status, "ยกเลิก");
  assert.equal(bal(W), 0);
  // สองคนกดเปลี่ยนสีพร้อมกัน = ตัวหลังชน
  const v2 = W.one("SELECT version FROM machine_runs WHERE id = ?", r.data.id).version;
  const [a, b] = await Promise.all([W.p("run.color", { run: r.data.id, version: v2, color: "เขียว", good: 1 }), W.e("run.color", { run: r.data.id, version: v2, color: "ฟ้า", good: 2 })]);
  assert.equal([a, b].filter(x => x.ok).length, 1);
  assert.equal(W.one("SELECT count(*) n FROM machine_runs WHERE machine_id = 'PET1' AND status = 'กำลังผลิต'").n, 1);
});

test("จอดเครื่อง + สาเหตุ → เดินต่อ · จอดซ้ำ = 409 · ไม่มีเหตุผล = 400 · เปิดรอบตอนจอด = เดินต่อให้เอง · ย้อน", async () => {
  const W = await setup();
  await open(W);
  assert.equal((await W.p("run.stop", { machine: "PET1" })).status, 400);
  const s = await W.p("run.stop", { machine: "PET1" }, { reason: "หลอด/ฮีตเตอร์" });
  assert.equal(s.ok, true, JSON.stringify(s.error));
  let f = (await W.call(W.T.dev, "prod.floor", {}, { as: "prod" })).data;
  assert.equal(f.machines.find(m => m.id === "PET1").state, "จอด");
  assert.equal(f.machines.find(m => m.id === "PET1").stop.reason, "หลอด/ฮีตเตอร์");
  const again = await W.e("run.stop", { machine: "PET1" }, { reason: "ไฟดับ" });
  assert.equal(again.status, 409); assert.match(again.error.message, /จอดอยู่แล้ว/);
  W.tick(30 * 60000);
  const ev = W.one("SELECT * FROM machine_events WHERE id = ?", s.data.id);
  const res = await W.e("run.resume", { event: ev.id, version: ev.version });
  assert.equal(res.ok, true);
  assert.notEqual(W.one("SELECT ended_at FROM machine_events WHERE id = ?", ev.id).ended_at, "");
  assert.equal((await W.e("run.resume", { event: ev.id, version: ev.version + 1 })).status, 409);
  // ย้อนเดินต่อ = กลับไปจอด
  assert.equal((await W.call(await W.T.em(), "undo.run", { id: res.undo.id }, { as: "prod" })).ok, true);
  assert.equal(W.one("SELECT ended_at FROM machine_events WHERE id = ?", ev.id).ended_at, "");
  // เครื่องจอด (ไม่มีรอบ) แล้วเปิดรอบใหม่ = ปิดเรื่องจอดให้เอง
  await W.p("run.stop", { machine: "PET2" }, { reason: "ซ่อมบำรุง" });
  const o = await W.p("run.open", { machine: "PET2", type: "ขวด", size: "250 ml", neck: "คอยาว", shape: "เพชร", color: "ใส", crew: ["เปา"] });
  assert.equal(o.ok, true, JSON.stringify(o.error));
  assert.equal(W.one("SELECT count(*) n FROM machine_events WHERE machine_id = 'PET2' AND ended_at = ''").n, 0);
  f = (await W.call(W.T.dev, "prod.floor", {}, { as: "prod" })).data;
  assert.equal(f.machines.find(m => m.id === "PET2").state, "เดิน");
});

test("เปลี่ยนโมลด์: จะเปลี่ยน → กำลังเปลี่ยน (ต้องปิดรอบก่อน) → เสร็จ (ขยับโมลด์ที่ติดอยู่) · ถอยขั้นไม่ได้ · เปิดรอบระหว่างเปลี่ยนไม่ได้", async () => {
  const W = await setup();
  const r = await open(W);
  const plan = await W.p("mold.step", { machine: "PET1", stage: "จะเปลี่ยน", mold_to: "600 ml เรียบ" });
  assert.equal(plan.ok, true, JSON.stringify(plan.error));
  let ev = W.one("SELECT * FROM machine_events WHERE id = ?", plan.data.id);
  const busy = await W.p("mold.step", { machine: "PET1", stage: "กำลังเปลี่ยน", event: ev.id, version: ev.version });
  assert.equal(busy.status, 409); assert.equal(busy.error.open.id, r.data.id);
  const run = W.one("SELECT * FROM machine_runs WHERE id = ?", r.data.id);
  await W.p("run.close", { run: run.id, version: run.version, good: 100 });
  const go = await W.p("mold.step", { machine: "PET1", stage: "กำลังเปลี่ยน", event: ev.id, version: ev.version });
  assert.equal(go.ok, true, JSON.stringify(go.error));
  const f = (await W.call(W.T.dev, "prod.floor", {}, { as: "prod" })).data.machines.find(m => m.id === "PET1");
  assert.equal(f.state, "โมลด์"); assert.equal(f.moldEv.stage, "กำลังเปลี่ยน");
  assert.match((await open(W)).error.message, /กำลังเปลี่ยนโมลด์/);
  ev = W.one("SELECT * FROM machine_events WHERE id = ?", plan.data.id);
  assert.equal((await W.p("mold.step", { machine: "PET1", stage: "จะเปลี่ยน", event: ev.id, version: ev.version })).status, 409);
  const done = await W.p("mold.step", { machine: "PET1", stage: "เสร็จ", event: ev.id, version: ev.version });
  assert.equal(done.ok, true, JSON.stringify(done.error));
  assert.equal(W.one("SELECT mold FROM machines WHERE id = 'PET1'").mold, "600 ml เรียบ");
  assert.equal((await open(W)).ok, true);
  // ไม่มีเรื่องค้าง แล้วกดเสร็จ = 409
  assert.equal((await W.p("mold.step", { machine: "PET2", stage: "เสร็จ" })).status, 409);
});

test("รอบค้าง: ตรวจแล้วยกธง (ไม่ซ้ำ) · ปิดย้อนหลังต้องมีเหตุผล → ธงปิดรอบย้อนหลัง + ธงรอบค้างปิดเอง · รอบจากแอปเดิมปิดได้ ไม่แตะสต๊อก", async () => {
  const W = await setup();
  const r = await open(W);
  W.tick(16 * H);
  let f = (await W.call(W.T.dev, "prod.floor", {}, { as: "prod" })).data;
  assert.equal(f.machines.find(m => m.id === "PET1").state, "ค้างปิด");
  assert.equal(f.summary.running, 0); assert.equal(f.summary.stale, 1); assert.equal(f.sweep, true);
  const sw = await W.call(W.T.dev, "prod.sweep", {}, { as: "prod" });   // ไม่ต้องใส่ PIN
  assert.equal(sw.ok, true, JSON.stringify(sw.error)); assert.equal(sw.data.flagged, 1);
  assert.equal((await W.call(W.T.dev, "prod.sweep", {}, { as: "prod" })).data.flagged, 0);
  assert.equal(W.one("SELECT count(*) n FROM flags WHERE dedupe_key = ? AND status = 'เปิด'", "stale:" + r.data.id).n, 1);
  f = (await W.call(W.T.dev, "prod.floor", {}, { as: "prod" })).data;
  assert.equal(f.sweep, false);
  const run = W.one("SELECT * FROM machine_runs WHERE id = ?", r.data.id);
  const endAt = new Date(Date.parse(run.started_at) + 8 * H).toISOString();
  const no = await W.p("run.close", { run: run.id, version: run.version, good: 9000, ended_at: endAt });
  assert.equal(no.status, 400); assert.equal(no.error.needReason, "late_close");
  const ok = await W.p("run.close", { run: run.id, version: run.version, good: 9000, ended_at: endAt }, { reason: "ลืมกดปิด" });
  assert.equal(ok.ok, true, JSON.stringify(ok.error));
  const done = W.one("SELECT * FROM machine_runs WHERE id = ?", run.id);
  assert.equal(done.late_close, 1); assert.equal(done.ended_at, endAt);
  assert.equal(W.one("SELECT status FROM flags WHERE dedupe_key = ?", "stale:" + run.id).status, "ปิด");
  assert.equal(W.one("SELECT count(*) n FROM flags WHERE dedupe_key = ? AND status = 'เปิด'", "late:" + run.id).n, 1);
  assert.equal(bal(W), 9000);
  // รอบค้างจากแอปเดิม
  const at = new Date(W.clock.now - 30 * H).toISOString();
  W.d1.raw.prepare("INSERT INTO machine_runs(id,machine_id,type,size,neck,shape,color,spec_key,started_at,started_day,status,src,created_at,updated_at) VALUES ('L-x1','PET2','ขวด','250 ml','คอยาว','เพชร','ใส','ขวด|250 ml|คอยาว|เพชร|ใส',?,?,'ค้างจากระบบเดิม','legacy:stock',?,?)").run(at, thaiDay(Date.parse(at)), at, at);
  const lg = await W.p("run.close", { run: "L-x1", version: 1, good: 4000 }, { reason: "ปิดในแอปเดิมแล้ว" });
  assert.equal(lg.ok, true, JSON.stringify(lg.error));
  assert.equal(W.one("SELECT stocked FROM machine_runs WHERE id = 'L-x1'").stocked, 0);
  assert.equal(W.one("SELECT count(*) n FROM stock_moves WHERE ref_id = 'L-x1'").n, 0);
  // ยอด 0 ทั้งหมดต้องมีเหตุผล/หมายเหตุ
  const r2 = await open(W, "PET3");
  assert.equal((await W.p("run.close", { run: r2.data.id, version: 1, good: 0 })).error.needReason, "zero");
  assert.equal((await W.p("run.close", { run: r2.data.id, version: 1, good: 0, note: "เปิดผิดเครื่อง" })).ok, true);
});

test("แก้ยอดรอบที่ปิดแล้ว: เหตุผลบังคับ · ลงส่วนต่าง · สต๊อกติดลบ = ธง ไม่บล็อก", async () => {
  const W = await setup();
  const r = await open(W);
  await W.p("run.close", { run: r.data.id, version: 1, good: 1000, b: 10 });
  W.d1.raw.prepare("INSERT INTO stock_moves(at,day,item_key,grade,qty_pcs,move_type,ref_entity,ref_id) VALUES (?,?,?,?,?,?,?,?)").run(new Date(W.clock.now).toISOString(), "2026-11-16", KEY, "A", -900, "ส่งออก", "delivery_loads", "L1");
  const v = W.one("SELECT version FROM machine_runs WHERE id = ?", r.data.id).version;
  assert.equal((await W.p("run.fix", { run: r.data.id, version: v, good: 800, b: 10, waste: 0 })).status, 400);
  const fx = await W.p("run.fix", { run: r.data.id, version: v, good: 50, b: 10, waste: 0 }, { reason: "ลงจำนวนผิด" });
  assert.equal(fx.ok, true, JSON.stringify(fx.error));
  assert.equal(bal(W), -850);
  assert.equal(W.one("SELECT count(*) n FROM flags WHERE kind = 'สต๊อกติดลบ' AND status = 'เปิด'").n, 1);
  assert.equal(W.one("SELECT move_type FROM stock_moves ORDER BY id DESC LIMIT 1").move_type, "แก้ยอดผลิต");
});

test("งานรอผลิต: รายการออเดอร์ขึ้นคิวเรียงวันส่ง · ผูกรอบสร้างงาน · ยอดทำแล้วคิดจากรอบ · ค้าง+สาเหตุ · ทำครบ (ขาดต้องมีเหตุผล) · ผูกพร้อมกันไม่เกิดงานซ้ำ", async () => {
  const W = await setup();
  order(W, "O1", [{ ...SPEC, bags: 10, per: 200 }, { type: "ฝา", size: "ถังใส", color: "น้ำเงิน", qty: 50 }], { due: "2026-11-20" });
  order(W, "O2", [{ type: "ขวด", size: "250 ml", neck: "คอยาว", shape: "เพชร", color: "ใส", bags: 4, per: 252 }], { due: "2026-11-18", urgent: 1 });
  let j = (await W.call(W.T.dev, "prod.jobs", {}, { as: "prod" })).data.jobs;
  assert.deepEqual(j.map(x => x.item), ["O2-1", "O1-1"], "ด่วนก่อน แล้วเรียงวันส่ง · ฝาไม่ต้องผลิต");
  assert.equal(j[1].target_pcs, 2000); assert.equal(j[1].per_bag, 200);
  // ผูกตอนเปิดรอบ (สเปกต้องตรง)
  assert.match((await W.p("run.open", { machine: "PET1", ...SPEC, color: "ฟ้า", crew: ["เปา"], item: "O1-1" })).error.message, /ไม่ตรง/);
  const r = await W.p("run.open", { machine: "PET1", ...SPEC, crew: ["เปา"], item: "O1-1" });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const job = W.one("SELECT * FROM production_jobs WHERE order_item_id = 'O1-1'");
  assert.equal(job.status, "กำลังผลิต"); assert.equal(job.target_pcs, 2000);
  // เครื่องที่สองผูกงานเดียวกัน = ใช้งานเดิม ไม่เกิดงานใหม่
  const r2 = await W.e("run.open", { machine: "PET10", ...SPEC, crew: ["เอ็ม"], item: "O1-1" });
  assert.equal(r2.ok, true); assert.equal(r2.data.job, job.id);
  j = (await W.call(W.T.dev, "prod.jobs", {}, { as: "prod" })).data.jobs;
  assert.deepEqual(j.find(x => x.job === job.id).running.sort(), ["PET 1", "PET 10"]);
  // ปิดงานตอนเครื่องยังเดิน = 409 บอกเครื่อง
  assert.match((await W.p("job.done", { job: job.id })).error.message, /PET 1/);
  await W.p("run.close", { run: r.data.id, version: 1, good: 1200 });
  await W.e("run.close", { run: r2.data.id, version: 1, good: 300 });
  j = (await W.call(W.T.dev, "prod.jobs", {}, { as: "prod" })).data.jobs;
  assert.equal(j.find(x => x.job === job.id).made_pcs, 1500);
  // ค้าง + สาเหตุ
  const pend = await W.p("job.pending", { job: job.id, version: W.one("SELECT version FROM production_jobs WHERE id = ?", job.id).version, bags: 3 }, { reason: "วัตถุดิบหมด" });
  assert.equal(pend.ok, true, JSON.stringify(pend.error));
  assert.equal(W.one("SELECT pending_reason FROM production_jobs WHERE id = ?", job.id).pending_reason, "วัตถุดิบหมด · ค้าง 3 ถุง");
  // ทำครบ: ยังขาด → ต้องมีเหตุผล
  const jv = W.one("SELECT version FROM production_jobs WHERE id = ?", job.id).version;
  assert.equal((await W.p("job.done", { job: job.id, version: jv })).error.needReason, "job_done");
  assert.equal((await W.p("job.done", { job: job.id, version: jv }, { reason: "ใช้ของในสต๊อก" })).ok, true);
  assert.equal(W.one("SELECT status FROM production_jobs WHERE id = ?", job.id).status, "เสร็จ");
  // รายการที่ยังไม่มีงาน: ค้างได้เลย (สร้างงาน) · สองคนกดพร้อมกัน = งานเดียว
  const [a, b] = await Promise.all([W.p("job.pending", { item: "O2-1" }, { reason: "ขวดหมด" }), W.e("job.pending", { item: "O2-1" }, { reason: "ขวดหมด" })]);
  assert.equal([a, b].filter(x => x.ok).length, 1);
  assert.equal(W.one("SELECT count(*) n FROM production_jobs WHERE order_item_id = 'O2-1'").n, 1);
  // ออฟฟิศอ่านคิวได้ แต่กดไม่ได้
  assert.equal((await W.call(W.T.ofc, "prod.jobs", {})).ok, true);
  assert.equal((await W.call(await W.ticket("S5", "ออย", ["office"], "1234", { k: "g", exp: W.clock.now + 60000 }), "job.done", { item: "O2-1" })).status, 403);
});

test("สต๊อก: รับพรีฟอร์ม/วัตถุดิบเข้า (เหตุผลบังคับ + audit) · วัตถุดิบใหม่ · นับปรับ (ตัวเลขที่เห็นต้องตรง) · แยก A/B · ย้อน", async () => {
  const W = await setup();
  const pre = { kind: "spec", type: "พรีฟอร์ม", size: "13.3 กรัม", color: "ใส", qty: 48000 };
  assert.equal((await W.p("stock.receive", pre)).status, 400);
  const r1 = await W.p("stock.receive", pre, { reason: "ซื้อเข้า" });
  assert.equal(r1.ok, true, JSON.stringify(r1.error));
  assert.equal(r1.data.key, "spec:พรีฟอร์ม|13.3 กรัม|||ใส");
  const r2 = await W.p("stock.receive", { kind: "mat", material: "RESIN-PET", qty: 750 }, { reason: "ซื้อเข้า" });
  assert.equal(r2.ok, true);
  const r3 = await W.p("stock.receive", { kind: "mat", new_name: "ฟิล์มยืด", new_unit: "ม้วน", qty: 12 }, { reason: "ยอดยกมา" });
  assert.equal(r3.ok, true, JSON.stringify(r3.error));
  assert.equal(W.one("SELECT move_type FROM stock_moves ORDER BY id DESC LIMIT 1").move_type, "ยอดยกมา");
  assert.equal((await W.p("stock.receive", { kind: "mat", new_name: "ฟิล์มยืด", new_unit: "ม้วน", qty: 1 }, { reason: "ซื้อเข้า" })).status, 409);
  const s = (await W.call(W.T.dev, "prod.stock", {}, { as: "prod" })).data;
  const p = s.items.find(x => x.key === "spec:พรีฟอร์ม|13.3 กรัม|||ใส");
  assert.equal(p.a, 48000); assert.equal(p.label, "พรีฟอร์ม 13.3 กรัม ใส");
  assert.equal(s.items.find(x => x.label === "เม็ดพลาสติก PET").unit, "กก.");
  assert.ok(s.items.find(x => x.label === "สีผสมเม็ด"), "วัตถุดิบที่ยังไม่มียอดก็โชว์ (0)");
  assert.ok(W.one("SELECT count(*) n FROM audit_log WHERE action = 'stock.receive' AND reason = 'ซื้อเข้า'").n >= 2);
  // นับปรับ
  const bad = await W.p("stock.count", { item_key: p.key, grade: "A", counted: 47000, seen: 40000 }, { reason: "นับจริงไม่ตรง" });
  assert.equal(bad.status, 409); assert.equal(bad.error.now, 48000);
  const ok = await W.p("stock.count", { item_key: p.key, grade: "A", counted: 47000, seen: 48000 }, { reason: "นับจริงไม่ตรง" });
  assert.equal(ok.ok, true, JSON.stringify(ok.error)); assert.equal(ok.data.delta, -1000);
  // ย้อนรับเข้า
  assert.equal((await W.call(await W.T.pao(), "undo.run", { id: r2.undo.id }, { as: "prod" })).ok, true);
  assert.equal(W.one("SELECT qty_pcs FROM stock_balance WHERE item_key = 'mat:RESIN-PET'").qty_pcs, 0);
  // ผลิต: เกรด B ไม่บวกเข้า A
  const r = await open(W);
  await W.p("run.close", { run: r.data.id, version: 1, good: 100, b: 7 });
  const s2 = (await W.call(W.T.dev, "prod.stock", {}, { as: "prod" })).data.items.find(x => x.key === KEY);
  assert.equal(s2.a, 100); assert.equal(s2.b, 7); assert.equal(s2.per_bag, 200);
});

test("ทะเบียนเครื่อง (ประธาน): วางเครื่องฉีดจากถาดลงช่อง K → ช่องเดิมเลิกใช้ · ประวัติอยู่ครบ · ทีมผลิตทำไม่ได้", async () => {
  const W = await setup();
  const m = W.one("SELECT * FROM machines WHERE id = 'SHE230G'");
  assert.equal((await W.p("machine.set", { id: "SHE230G", version: m.version, take_slot: "K4" })).status, 403);
  const det = (await W.call(W.T.ex, "prod.machine", { id: "SHE230G" })).data;
  assert.ok(det.slots.some(s => s.id === "K4"), "ช่อง K ที่ยังไม่ผูกต้องเป็นตัวเลือก");
  const r = await W.call(W.T.ex, "machine.set", { id: "SHE230G", version: m.version, take_slot: "K4", model: "SHE230G" });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const f = (await W.call(W.T.dev, "prod.floor", {}, { as: "prod" })).data;
  assert.ok(!f.machines.some(x => x.id === "K4"));
  const she = f.machines.find(x => x.id === "SHE230G");
  assert.deepEqual([she.x, she.y, she.plant, she.label], [1268, 413, "โรง 1", "K4"]);
  assert.equal(f.summary.total, 12);
  // นำเข้าทะเบียนซ้ำไม่ทับที่ประธานแก้
  await W.call(W.T.ex, "import.run", { source: "ref:machines" });
  assert.equal(W.one("SELECT plant FROM machines WHERE id = 'SHE230G'").plant, "โรง 1");
  assert.equal(W.one("SELECT status FROM machines WHERE id = 'K4'").status, "เลิกใช้");
  assert.equal((await W.call(W.T.ex, "machine.set", { id: "PET1", version: 1, name: "PET 2" })).status, 400);
});

test("รายละเอียดเครื่อง + ตัวเลือกเปิดรอบ: ไทม์ไลน์วันนี้ · ยอดวัน/เดือน/ทั้งหมด · ใบ/ชม. · คนใช้บ่อย · ยังไม่มีในระบบ · สเปกที่ทำบ่อยขึ้นก่อน", async () => {
  const W = await setup();
  for (let i = 0; i < 3; i++) {
    const r = await W.p("run.open", { machine: "PET4", type: "ขวด", size: "250 ml", neck: "คอสั้น", shape: "เพชร", color: i ? "น้ำเงิน" : "ใส", crew: ["เอ็ม"] });
    W.tick(3 * H);
    await W.p("run.close", { run: r.data.id, version: 1, good: 30000, b: 100, waste: 100 });
    W.tick(H / 2);
  }
  await W.p("run.stop", { machine: "PET4" }, { reason: "ไฟดับ" });
  const d = (await W.call(W.T.dev, "prod.machine", { id: "PET4" }, { as: "prod" })).data;
  assert.equal(d.runs.length, 3); assert.equal(d.events.length, 1);
  assert.equal(d.info.per_hour.pcs, 10000); assert.equal(d.info.hours, 9);
  assert.deepEqual(d.info.crew, ["เอ็ม"]);
  assert.ok(d.info.missing.includes("รุ่น/ยี่ห้อ"));
  assert.equal(d.totals.all.reduce((a, x) => a + x.good, 0), 90000);
  assert.equal(d.totals.day.length, 2, "แยกตามสี"); assert.equal(d.totals.month.length, 2);
  assert.equal(d.totals.all[0].per_bag, 252);
  assert.ok(Math.abs(d.info.waste_rate - 300 / 90600) < 1e-9);
  const sp = (await W.call(W.T.dev, "prod.specs", { machine: "PET4" }, { as: "prod" })).data;
  assert.equal(sp.types[0].code, "ขวด");
  assert.equal(sp.sizes["ขวด"][0].size, "250 ml");
  assert.equal(sp.values["คอขวด"][0].value, "คอสั้น");
  assert.equal(sp.values["สี"][0].value, "น้ำเงิน");
  assert.equal(sp.people[0].nick, "เอ็ม");
  const inj = (await W.call(W.T.dev, "prod.specs", { machine: "K1" }, { as: "prod" })).data;
  assert.equal(inj.types[0].code, "พรีฟอร์ม");
  const run = (await W.call(W.T.dev, "prod.run", { id: d.runs[0].id }, { as: "prod" })).data;
  assert.equal(run.run.hours, 3); assert.equal(run.moves.length, 2); assert.equal(run.run.opened_by, "เปา");
});
