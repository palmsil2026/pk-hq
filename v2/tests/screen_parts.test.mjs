// เทสต์ทีมสกรีน "ทำบางส่วน" (งานหลายวัน · 0320): ตัดสต๊อกเท่าที่ทำ · เสร็จ = ส่วนที่เหลือ · ย้อนทีละช่วง (ล่าสุด) · สรุปเสร็จวันนี้รวมบางส่วน
//   · สิทธิ์ · กดซ้ำ · ชนกัน · งานวันเดียว (ทีม → เสร็จ) เหมือนเดิมเป๊ะ · ออฟฟิศอ่านความคืบหน้าได้ (ไม่มีเงิน)
import { test } from "node:test";
import assert from "node:assert/strict";
import { world, T0 } from "./helpers/world.mjs";
import { specKey, specLabel } from "../server/core.mjs";
import { amountText, progressText } from "../server/actions/screen-progress.mjs";

const AT = new Date(T0).toISOString();
const BOTTLE = { type: "ขวด", size: "600 ml", neck: "คอยาว", shape: "MK", color: "ใส" };
const PLAIN = "spec:" + specKey(BOTTLE);
const SCREENED = PLAIN + "|สกรีน น้ำเงิน";
const DAY = 864e5;

async function setup() {
  const W = world();
  const T = {
    screen: await W.staff("S1", "จอย", ["screen"]), screen2: await W.staff("S2", "แจน", ["screen"]),
    office: await W.staff("S5", "แอน", ["office"]), prod: await W.staff("S6", "บอส", ["prod"]), deliver: await W.staff("S3", "ต่อ", ["deliver"]),
    exec: await W.staff("S9", "หัวหน้า", ["exec"]),
  };
  const ins = (sql, ...a) => W.d1.raw.prepare(sql).run(...a);
  ins("INSERT INTO customers(id,name,name_key,created_at,updated_at) VALUES ('CB','ร้านทดสอบ ข','ร้านทดสอบ ข',?,?)", AT, AT);
  ins("INSERT INTO orders(id,order_day,customer_id,due_day,status,taker_staff_id,created_at,updated_at) VALUES ('OB','2026-11-15','CB','2026-11-20','รอสกรีน','S5',?,?)", AT, AT);
  ins("INSERT INTO order_items(id,order_id,line_no,type,size,neck,shape,color,screen_color,spec_key,label,bags,per_bag,qty_pcs,created_at,updated_at) VALUES ('IB1','OB',1,?,?,?,?,?,'น้ำเงิน',?,?,20,200,4000,?,?)",
    BOTTLE.type, BOTTLE.size, BOTTLE.neck, BOTTLE.shape, BOTTLE.color, specKey(BOTTLE), specLabel(BOTTLE), AT, AT);
  ins("INSERT INTO screen_jobs(id,order_id,order_item_id,colors,qty_pcs,due_day,status,created_at,updated_at) VALUES ('J1','OB','IB1','น้ำเงิน',4000,'2026-11-20','รอดำเนินการ',?,?)", AT, AT);
  ins("INSERT INTO stock_moves(at,day,item_key,label,grade,qty_pcs,move_type) VALUES (?,?,?,?,?,?,?)", AT, "2026-11-16", PLAIN, "ทดสอบ", "A", 10000, "ยอดยกมา");
  return { W, T };
}
const bal = (W, k) => (W.one("SELECT qty_pcs FROM stock_balance WHERE item_key = ? AND grade = 'A'", k) || { qty_pcs: 0 }).qty_pcs;
const job = W => W.one("SELECT * FROM screen_jobs WHERE id = 'J1'");
const part = (W, T, pcs, team, more) => W.call(T.screen, "screen.part", { id: "J1", version: job(W).version, team: team === undefined ? "ทีม 1" : team, pcs }, more);

test("ตัวช่วยข้อความ: ถุง + เศษใบ · ทำแล้ว x/y ถุง", () => {
  assert.equal(amountText(4000, { per_bag: 200 }), "20 ถุง");
  assert.equal(amountText(4050, { per_bag: 200 }), "20 ถุง 50 ใบ");
  assert.equal(amountText(50, { per_bag: 200 }), "50 ใบ");
  assert.equal(amountText(30, { per_bag: 0, piece_unit: "ชิ้น" }), "30 ชิ้น");
  assert.equal(progressText(1200, 4000, 200), "ทำแล้ว 6/20 ถุง");
  assert.equal(progressText(1250, 4000, 200), "ทำแล้ว 1,250/4,000 ใบ");
});

test("ทำบางส่วน: ตัดขวดเปล่า/เพิ่มขวดสกรีนเท่าที่ทำ · งานยังอยู่ในคิว · ทีม+คน+เวลาในช่วง · ออเดอร์กำลังสกรีน · audit", async () => {
  const { W, T } = await setup();
  const r = await part(W, T, 1000);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.undo.label, /ทีม 1 ทำวันนี้ 5 ถุง · ร้านทดสอบ ข · ค้าง 15 ถุง/);
  const j = job(W);
  assert.equal(j.status, "เตรียมการสกรีน"); assert.equal(j.team, "ทีม 1"); assert.equal(j.done_pcs, 1000);
  assert.equal(bal(W, PLAIN), 9000); assert.equal(bal(W, SCREENED), 1000);
  const p = W.one("SELECT * FROM screen_parts WHERE job_id = 'J1'");
  assert.deepEqual([p.team, p.qty_pcs, p.by, p.day, p.at, p.status, p.job_ver], ["ทีม 1", 1000, "S1", "2026-11-16", AT, "ใช้งาน", j.version]);
  assert.equal(W.one("SELECT status FROM orders WHERE id = 'OB'").status, "กำลังสกรีน");
  assert.equal(W.one("SELECT staff_name FROM audit_log WHERE action = 'screen.part' AND entity = 'screen_parts'").staff_name, "จอย");
  const q = (await W.call(T.screen, "screen.list", { tab: "queue" })).data;
  assert.equal(q.jobs[0].done_pcs, 1000); assert.equal(q.jobs[0].parts_n, 1);
  const t = (await W.call(T.screen, "screen.list", { tab: "today" })).data;
  assert.deepEqual(t.doneToday, [{ team: "ทีม 1", jobs: 0, parts: 1, pcs: 1000 }], "เสร็จวันนี้ต่อทีมนับยอดบางส่วน");
  assert.equal(t.parts.length, 1); assert.equal(t.parts[0].part_pcs, 1000); assert.equal(t.parts[0].latest, true); assert.ok(t.parts[0].part_undo);
  assert.equal(t.jobs.length, 0, "งานยังไม่เสร็จ ไม่อยู่ในรายการเสร็จแล้ว");
});

test("หลายวัน: วันละช่วง → เสร็จทีหลัง = ส่วนที่เหลือ (สต๊อกรวมตรงจำนวนงาน ไม่ตัดซ้ำ) · สรุปแต่ละวันถูกวัน · ประวัติเห็นทุกช่วง", async () => {
  const { W, T } = await setup();
  assert.equal((await part(W, T, 1000)).ok, true);
  W.tick(DAY);
  assert.equal((await part(W, T, 1200, "ทีม 2")).ok, true);   // วันที่สอง ทีมอื่นทำต่อ
  assert.equal(job(W).team, "ทีม 2");
  W.tick(DAY);
  const d = await W.call(T.screen, "screen.done", { id: "J1", version: job(W).version });
  assert.equal(d.ok, true, JSON.stringify(d));
  assert.match(d.undo.label, /ส่วนที่เหลือ 9 ถุง/);
  assert.equal(bal(W, PLAIN), 6000, "ตัดขวดเปล่ารวม = 4,000 (ไม่ใช่ 3 × 4,000)");
  assert.equal(bal(W, SCREENED), 4000);
  const day3 = (await W.call(T.screen, "screen.list", { tab: "today" })).data;
  assert.deepEqual(day3.doneToday, [{ team: "ทีม 2", jobs: 1, parts: 0, pcs: 1800 }], "วันที่กดเสร็จ = ส่วนที่เหลือเท่านั้น");
  const pr = (await W.call(T.office, "screen.progress", { order: "OB" })).data.jobs[0];
  assert.equal(pr.status, "เสร็จแล้ว"); assert.equal(pr.made_pcs, 4000); assert.equal(pr.text, "เสร็จแล้ว 20 ถุง");
  assert.deepEqual(pr.parts.map(x => [x.day, x.team, x.text, x.by]), [["2026-11-16", "ทีม 1", "5 ถุง", "จอย"], ["2026-11-17", "ทีม 2", "6 ถุง", "จอย"]]);
  assert.deepEqual([pr.done.day, pr.done.team, pr.done.text, pr.done.by], ["2026-11-18", "ทีม 2", "9 ถุง", "จอย"]);
  // ย้อนเสร็จ → กลับไปค้าง 2,200 ในคิว (ช่วงเดิมยังอยู่)
  assert.equal((await W.call(T.screen, "undo.run", { id: d.undo.id })).ok, true);
  assert.equal(job(W).status, "เตรียมการสกรีน"); assert.equal(job(W).done_pcs, 2200);
  assert.equal(bal(W, PLAIN), 7800); assert.equal(bal(W, SCREENED), 2200);
  // เสร็จอีกครั้ง แล้วลงจำนวนภายหลัง (งานที่มีช่วง) = ปรับสต๊อกตามส่วนต่างของทั้งงาน
  assert.equal((await W.call(T.screen, "screen.done", { id: "J1", version: job(W).version })).ok, true);
  const c = await W.call(T.screen, "screen.count", { id: "J1", version: job(W).version, good: 3800, waste: 100 });
  assert.equal(c.ok, true);
  assert.equal(bal(W, PLAIN), 6100); assert.equal(bal(W, SCREENED), 3800);
});

test("ย้อนได้ทีละช่วง (ล่าสุด) · ช่วงเก่าย้อนไม่ได้จนกว่าย้อนช่วงหลัง · ย้อนแล้วสต๊อก/ยอดกลับ · ขวดสกรีนขึ้นรถแล้ว = ย้อนไม่ได้", async () => {
  const { W, T } = await setup();
  const a = await part(W, T, 1000), b = await part(W, T, 600);
  const old = await W.call(T.screen, "undo.run", { id: a.undo.id });
  assert.equal(old.status, 409, "ช่วงเก่าย้อนไม่ได้เมื่อมีช่วงใหม่ต่อจากนั้น");
  const t = (await W.call(T.screen, "screen.list", { tab: "today" })).data;
  assert.deepEqual(t.parts.map(p => [p.part_pcs, p.latest]), [[600, true], [1000, false]]);
  assert.equal((await W.call(T.screen, "undo.run", { id: b.undo.id })).ok, true);
  assert.equal(job(W).done_pcs, 1000); assert.equal(bal(W, SCREENED), 1000); assert.equal(bal(W, PLAIN), 9000);
  assert.equal(W.one("SELECT count(*) n FROM screen_parts WHERE status = 'ยกเลิก'").n, 1, "ย้อน = พลิกสถานะ ไม่ลบแถว");
  // ขวดสกรีนจากช่วงแรกถูกเอาขึ้นรถไปแล้ว
  W.d1.raw.prepare("INSERT INTO stock_moves(at,day,item_key,label,grade,qty_pcs,move_type) VALUES (?,?,?,?,?,?,?)").run(AT, "2026-11-16", SCREENED, "ทดสอบ", "A", -900, "ขึ้นรถ");
  const blocked = await W.call(T.screen, "undo.run", { id: a.undo.id });
  assert.equal(blocked.status, 409); assert.match(blocked.error.message, /ขึ้นรถ\/ส่งไปแล้ว/);
  assert.equal(job(W).done_pcs, 1000);
});

test("ทำบางส่วน: ครบ/เกินที่เหลือ = บอกให้กดเสร็จ · สิทธิ์ · กดซ้ำไม่เบิ้ล · สองเครื่องกดพร้อมกัน = คนหลัง 409 · งานเสร็จ/ยกเลิกแล้วทำไม่ได้", async () => {
  const { W, T } = await setup();
  const over = await part(W, T, 4000);
  assert.equal(over.status, 400); assert.match(over.error.message, /กด "เสร็จ" แทน/);
  for (const tk of [T.prod, T.deliver]) assert.equal((await W.call(tk, "screen.part", { id: "J1", version: 1, pcs: 200 })).status, 403);
  assert.equal((await W.call(T.office, "screen.part", { id: "J1", version: 1, team: "ทีม 3", pcs: 200 })).ok, true, "ออฟฟิศทำแทนได้ (มีประวัติ)");
  const key = W.key();
  const r1 = await part(W, T, 400, "ทีม 1", { key }), r2 = await W.call(T.screen, "screen.part", { id: "J1", version: 2, team: "ทีม 1", pcs: 400 }, { key });
  assert.equal(r1.ok, true); assert.equal(r2.replayed, true);
  assert.equal(job(W).done_pcs, 600); assert.equal(bal(W, SCREENED), 600, "กดซ้ำ (เน็ตหลุดส่งซ้ำ) ไม่ตัดสต๊อกซ้ำ");
  const v = job(W).version;
  const x = await W.call(T.screen, "screen.part", { id: "J1", version: v, team: "ทีม 1", pcs: 200 });
  const y = await W.call(T.screen2, "screen.part", { id: "J1", version: v, team: "ทีม 2", pcs: 200 });
  assert.equal(x.ok, true); assert.equal(y.status, 409, "สองเครื่องกดรุ่นเดียวกัน = คนหลังโหลดใหม่");
  assert.equal(job(W).done_pcs, 800);
  assert.equal((await W.call(T.screen, "screen.part", { id: "J1", version: job(W).version, team: "ทีมผี", pcs: 200 })).status, 400);
  assert.equal((await W.call(T.screen, "screen.done", { id: "J1", version: job(W).version })).ok, true);
  assert.equal((await part(W, T, 200)).status, 409, "เสร็จแล้วทำบางส่วนต่อไม่ได้");
  assert.equal(bal(W, PLAIN), 6000); assert.equal(bal(W, SCREENED), 4000);
});

test("งานวันเดียว: ทีม → เสร็จ เหมือนเดิมเป๊ะ (ไม่มีแถวช่วง · สต๊อกเต็มจำนวนครั้งเดียว · ป้ายเดิม)", async () => {
  const { W, T } = await setup();
  assert.equal((await W.call(T.screen, "screen.assign", { id: "J1", version: 1, team: "ทีม 2" })).ok, true);
  const d = await W.call(T.screen, "screen.done", { id: "J1", version: 2 });
  assert.equal(d.ok, true);
  assert.equal(d.undo.label, "สกรีนเสร็จ ร้านทดสอบ ข · ทีม 2");
  assert.equal(W.one("SELECT count(*) n FROM screen_parts").n, 0);
  assert.equal(job(W).done_pcs, 0);
  assert.equal(bal(W, PLAIN), 6000); assert.equal(bal(W, SCREENED), 4000);
  assert.equal(W.q("SELECT * FROM stock_moves WHERE ref_entity = 'screen_jobs'").length, 2, "ลงสมุด 2 แถวเหมือนเดิม");
  const t = (await W.call(T.screen, "screen.list", { tab: "today" })).data;
  assert.deepEqual(t.doneToday, [{ team: "ทีม 2", jobs: 1, parts: 0, pcs: 4000 }]);
});

test("ความคืบหน้าสำหรับออฟฟิศ: ทำแล้ว x/y ถุง · ไม่มีตัวเลขเงิน · ส่งของ/ทีมผลิตอ่านไม่ได้ · ต้องระบุออเดอร์", async () => {
  const { W, T } = await setup();
  await part(W, T, 1200);
  const r = await W.call(T.office, "screen.progress", { order: "OB" });
  assert.equal(r.ok, true);
  const j = r.data.jobs[0];
  assert.equal(j.text, "ทำแล้ว 6/20 ถุง"); assert.equal(j.partial_pcs, 1200); assert.equal(j.planned_pcs, 4000); assert.equal(j.order_item_id, "IB1");
  assert.ok(!/satang|price|total/i.test(JSON.stringify(r.data)));
  assert.equal((await W.call(T.exec, "screen.progress", { job: "J1" })).data.jobs.length, 1);
  assert.equal((await W.call(T.deliver, "screen.progress", { order: "OB" })).status, 403);
  assert.equal((await W.call(T.prod, "screen.progress", { order: "OB" })).status, 403);
  assert.equal((await W.call(T.office, "screen.progress", {})).status, 400);
});
