// เทสต์ช่าง "ซ่อมเสร็จ" + สาเหตุระดับชิ้นส่วน (0110) · ข้อความแชร์ลงไลน์ · หยุดบ่อยเพราะอะไร · จอด/เดินต่อเครื่องสกรีน (0321)
//   ถูก/ผิดสิทธิ์/ซ้ำ/ย้อน/ชนกัน · ชุดสาเหตุเดิมยังบังคับ · ชิ้นส่วนไม่บังคับ · ข้อความไม่มีรหัสระบบ
import { test } from "node:test";
import assert from "node:assert/strict";
import { world } from "./helpers/world.mjs";
import { durThai, stopSummary, stopText, resumeText, moldText } from "../server/actions/repair.mjs";

const MIN = 60000, H = 3600000, DAY = 864e5;

async function setup() {
  const W = world();
  const ex = await W.staff("S9", "หัวหน้า", ["exec"]);
  for (const s of ["ref:products", "ref:machines"]) assert.equal((await W.call(ex, "import.run", { source: s })).ok, true);
  await W.staff("S1", "เปา", ["prod"]);
  await W.staff("S2", "ช่างเอ็ม", ["prod"]);
  const scr = await W.staff("S3", "จอย", ["screen"]), scr2 = await W.staff("S4", "แจน", ["screen"]);
  const ofc = await W.staff("S5", "ออย", ["office"]);
  const g = (id, nick) => W.ticket(id, nick, ["prod"], "1234", { k: "g", exp: W.clock.now + 5 * 60000 });
  W.T = { ex, scr, scr2, ofc, dev: await W.ticket("S1", "เปา", ["prod"]) };
  W.p = async (action, input, more) => W.call(await g("S1", "เปา"), action, input, Object.assign({ as: "prod" }, more || {}));
  W.tech = async (action, input, more) => W.call(await g("S2", "ช่างเอ็ม"), action, input, Object.assign({ as: "prod" }, more || {}));
  return W;
}
const ev = (W, id) => W.one("SELECT * FROM machine_events WHERE id = ?", id);

test("ข้อความ/สรุป: ระยะเวลาเป็นคำ · ข้อความแชร์สั้น ไม่มีรหัส · สรุปครั้ง+ชม.ต่อชิ้นส่วน 7/30 วัน (ยังจอด = ถึงตอนนี้ · ตัดขอบช่วง)", () => {
  assert.equal(durThai(3 * MIN), "3 นาที"); assert.equal(durThai(80 * MIN), "1 ชม. 20 นาที"); assert.equal(durThai(2 * H), "2 ชม."); assert.equal(durThai(27 * H), "1 วัน 3 ชม.");
  const e = { started_at: "2026-11-16T03:58:00.000Z", reason: "หลอด/ฮีตเตอร์", part: "ก้ามปู", detail: "" };
  assert.equal(stopText("PET 4", e), "PET 4 จอด 10:58 · หลอด/ฮีตเตอร์ · ก้ามปู");
  assert.equal(resumeText("PET 4", e, "2026-11-16T04:01:00.000Z", "เอ็ม"), "PET 4 เดินต่อ 11:01 · หยุด 3 นาที · ก้ามปู · แก้โดย เอ็ม");
  assert.equal(moldText("PET 10", "เสร็จ", { work_at: "2026-11-16T02:00:00.000Z" }, "2026-11-16T04:20:00.000Z", "800 ml"), "PET 10 เปลี่ยนโมลด์เสร็จ 11:20 · 800 ml · ใช้เวลา 2 ชม. 20 นาที");
  const now = Date.UTC(2026, 10, 30, 5);
  const at = ms => new Date(ms).toISOString();
  const rows = [
    { started_at: at(now - 2 * DAY), ended_at: at(now - 2 * DAY + H), part: "ก้ามปู", reason: "เครื่องเสีย/ซ่อม" },
    { started_at: at(now - 3 * DAY), ended_at: at(now - 3 * DAY + 2 * H), part: "ก้ามปู", reason: "หลอด/ฮีตเตอร์" },
    { started_at: at(now - 20 * DAY), ended_at: at(now - 20 * DAY + 5 * H), part: "ลม", reason: "ลม/ปั๊มลม" },
    { started_at: at(now - 30 * MIN), ended_at: "", part: "", reason: "ไฟดับ" },
    { started_at: at(now - 7 * DAY - H), ended_at: at(now - 7 * DAY + H), part: "รางหลอด", reason: "" },   // คร่อมขอบ 7 วัน = นับ 1 ชม.
  ];
  const s = stopSummary(rows, now);
  assert.deepEqual(s.d7.map(x => [x.part, x.n, x.hours]), [["ก้ามปู", 2, 3], ["รางหลอด", 1, 1], ["ไม่ระบุชิ้นส่วน", 1, 0.5]]);
  assert.deepEqual(s.d30.map(x => [x.part, x.n, x.hours]), [["ลม", 1, 5], ["ก้ามปู", 2, 3], ["รางหลอด", 1, 2], ["ไม่ระบุชิ้นส่วน", 1, 0.5]]);
  assert.deepEqual(s.t7, { n: 4, hours: 4.5 });
});

test("ทีมผลิต จอด + ชิ้นส่วน (ไม่บังคับ) → ช่างซ่อมเสร็จ: จดคนแก้ + เวลาหยุดรวม + แก้ชิ้นส่วนตอนซ่อมได้ · ข้อความแชร์ · ย้อนได้", async () => {
  const W = await setup();
  assert.equal((await W.p("run.stop", { machine: "PET4", part: "ก้ามปู" })).status, 400, "สาเหตุเดิมยังบังคับ");
  const s = await W.p("run.stop", { machine: "PET4", part: "ก้ามปู", note: "หลอดติดหน้าโมลด์" }, { reason: "หลอด/ฮีตเตอร์" });
  assert.equal(s.ok, true, JSON.stringify(s));
  assert.equal(s.data.share, "PET 4 จอด 09:00 · หลอด/ฮีตเตอร์ · ก้ามปู · หลอดติดหน้าโมลด์");
  assert.ok(!/E\d|PET4\b|S\d/.test(s.data.share), "ไม่มีรหัสระบบในข้อความ");
  const e1 = ev(W, s.data.id);
  assert.deepEqual([e1.part, e1.reason, e1.by, e1.fixed_by], ["ก้ามปู", "หลอด/ฮีตเตอร์", "S1", ""]);
  // ไม่ใส่ชิ้นส่วนก็จอดได้ (ทางเดิม)
  const s2 = await W.p("run.stop", { machine: "PET1" }, { reason: "ไฟดับ" });
  assert.equal(s2.ok, true); assert.equal(ev(W, s2.data.id).part, "");
  // แผนผังบอกชิ้นส่วน + ข้อความแชร์ของเรื่องที่จอดอยู่
  const f = (await W.call(W.T.dev, "prod.floor", {}, { as: "prod" })).data.machines.find(m => m.id === "PET4");
  assert.equal(f.state, "จอด"); assert.equal(f.stop.part, "ก้ามปู"); assert.match(f.stop.share, /^PET 4 จอด/);
  W.tick(42 * MIN);
  const r = await W.tech("run.resume", { event: e1.id, version: e1.version, part: "รางหลอด", note: "เปลี่ยนสปริงรางหลอด" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.minutes, 42);
  assert.equal(r.data.share, "PET 4 เดินต่อ 09:42 · หยุด 42 นาที · รางหลอด · เปลี่ยนสปริงรางหลอด · แก้โดย ช่างเอ็ม");
  const e2 = ev(W, e1.id);
  assert.deepEqual([e2.fixed_by, e2.part, e2.fix_note, e2.ended_at], ["S2", "รางหลอด", "เปลี่ยนสปริงรางหลอด", new Date(W.clock.now).toISOString()]);
  // ประวัติเครื่อง: หยุดบ่อยเพราะอะไร + แถวเหตุการณ์มีคนแก้/ข้อความแชร์
  const m = (await W.call(W.T.dev, "prod.machine", { id: "PET4" }, { as: "prod" })).data;
  assert.deepEqual(m.stops.d7.map(x => [x.part, x.n, x.hours]), [["รางหลอด", 1, 0.7]]);
  const row = m.events.find(x => x.id === e1.id);
  assert.deepEqual([row.fixed_by, row.minutes, row.part], ["ช่างเอ็ม", 42, "รางหลอด"]);
  assert.match(row.share, /แก้โดย ช่างเอ็ม/);
  const hist = (await W.call(W.T.dev, "prod.history", {}, { as: "prod" })).data.events.find(x => x.id === e1.id);
  assert.equal(hist.fixed_by, "ช่างเอ็ม"); assert.equal(hist.machine, "PET 4");
  // ย้อน "ซ่อมเสร็จ" = กลับไปจอด (ชิ้นส่วนเดิมกลับมา)
  assert.equal((await W.tech("undo.run", { id: r.undo.id })).ok, true);
  const e3 = ev(W, e1.id);
  assert.deepEqual([e3.ended_at, e3.fixed_by, e3.part, e3.fix_note], ["", "", "ก้ามปู", ""]);
});

test("ซ่อมเสร็จ: กดซ้ำไม่เบิ้ล · สองคนกดพร้อมกัน = คนหลัง 409 · ทีมอื่นทำไม่ได้ · ต้อง PIN · เปลี่ยนโมลด์มีข้อความแชร์", async () => {
  const W = await setup();
  const s = await W.p("run.stop", { machine: "PET2" }, { reason: "ลม/ปั๊มลม" });
  const e = ev(W, s.data.id);
  W.tick(5 * MIN);
  assert.equal((await W.call(W.T.dev, "run.resume", { event: e.id, version: e.version }, { as: "prod" })).status, 401, "ตั๋วประจำเครื่อง = ต้องใส่ PIN");
  assert.equal((await W.call(W.T.scr, "run.resume", { event: e.id, version: e.version })).status, 403);
  const key = W.key();
  const a = await W.tech("run.resume", { event: e.id, version: e.version, part: "ลม" }, { key });
  const b = await W.tech("run.resume", { event: e.id, version: e.version, part: "ลม" }, { key });
  assert.equal(a.ok, true); assert.equal(b.replayed, true);
  const c = await W.p("run.resume", { event: e.id, version: e.version });
  assert.equal(c.status, 409);
  const m1 = await W.p("mold.step", { machine: "PET10", stage: "กำลังเปลี่ยน", mold_to: "800 ml" });
  assert.equal(m1.ok, true); assert.match(m1.data.share, /^PET 10 หยุดเปลี่ยนโมลด์ 09:05 · → 800 ml$/);
  W.tick(2 * H);
  const m2 = await W.p("mold.step", { machine: "PET10", stage: "เสร็จ" });
  assert.equal(m2.data.share, "PET 10 เปลี่ยนโมลด์เสร็จ 11:05 · 800 ml · ใช้เวลา 2 ชม.");
});

test("เครื่องสกรีน: รายการ S1–S8 · จอด (สาเหตุบังคับ + ชิ้นส่วนเสริม) → เดินต่อ · แจ้งในคิว · สิทธิ์ · ซ้ำ · ชน · ย้อน · เครื่องเป่าจอดจากแอปสกรีนไม่ได้", async () => {
  const W = await setup();
  const l = (await W.call(W.T.scr, "smachine.list", {})).data;
  assert.deepEqual(l.machines.map(m => m.name), ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"]);
  assert.equal(l.stopped, 0);
  assert.equal((await W.call(W.T.scr, "smachine.stop", { machine: "S1", part: "โซ่" })).status, 400, "ต้องมีสาเหตุ");
  const s = await W.call(W.T.scr, "smachine.stop", { machine: "S1", part: "โซ่" }, { reason: "เครื่องเสีย/ซ่อม" });
  assert.equal(s.ok, true, JSON.stringify(s));
  assert.equal(s.data.share, "S1 จอด 09:00 · เครื่องเสีย/ซ่อม · โซ่");
  const dup = await W.call(W.T.scr2, "smachine.stop", { machine: "S1" }, { reason: "พัก" });
  assert.equal(dup.status, 409); assert.match(dup.error.message, /S1 จอดอยู่แล้ว/);
  assert.equal((await W.call(W.T.scr, "smachine.stop", { machine: "PET4" }, { reason: "พัก" })).status, 400, "เครื่องเป่าไม่ใช่ของแอปสกรีน");
  for (const tk of [W.T.dev, W.T.ofc]) assert.equal((await W.call(tk, "smachine.stop", { machine: "S2" }, { reason: "พัก" })).status, 403);
  assert.equal((await W.call(W.T.ofc, "smachine.list", {})).ok, true, "ออฟฟิศดูสถานะเครื่องได้");
  const q = (await W.call(W.T.scr, "screen.list", { tab: "queue" })).data;
  assert.deepEqual(q.machinesStopped.map(m => [m.name, m.part]), [["S1", "โซ่"]]);
  const f = (await W.call(W.T.ex, "prod.floor", {})).data.machines.find(m => m.id === "S1");
  assert.equal(f.state, "จอด", "แผนผังประธานเห็นเครื่องสกรีนจอด");
  W.tick(25 * MIN);
  const e = ev(W, s.data.id);
  const r = await W.call(W.T.scr2, "smachine.resume", { event: e.id, version: e.version, part: "สปริง" });
  assert.equal(r.ok, true);
  assert.equal(r.data.share, "S1 เดินต่อ 09:25 · หยุด 25 นาที · สปริง · แก้โดย แจน");
  assert.equal((await W.call(W.T.scr, "smachine.resume", { event: e.id, version: e.version })).status, 409);
  const l2 = (await W.call(W.T.scr, "smachine.list", {})).data.machines.find(m => m.name === "S1");
  assert.equal(l2.stop, null); assert.equal(l2.last.fixed_by, "แจน"); assert.deepEqual(l2.stats.d7.map(x => [x.part, x.n]), [["สปริง", 1]]);
  assert.equal((await W.call(W.T.scr2, "undo.run", { id: r.undo.id })).ok, true);
  assert.equal(ev(W, e.id).ended_at, "");
  assert.equal((await W.call(W.T.scr, "undo.run", { id: s.undo.id })).status, 409, "ย้อนจอดไม่ได้หลังมีคนแก้ต่อ (รุ่นเปลี่ยน)");
  const ex = await W.call(W.T.ex, "smachine.resume", { event: e.id, version: ev(W, e.id).version }, { as: "screen" });
  assert.equal(ex.ok, true, "ประธานทำแทนได้");
});
