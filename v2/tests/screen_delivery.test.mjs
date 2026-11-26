// เทสต์โมดูลทีมสกรีนสี + ส่งของ: ถูก/ผิดสิทธิ์ · กดซ้ำ · ย้อน · ชนกัน · สองทีมกดงานเดียวกัน · ขึ้นรถสองคัน · ส่งบางส่วนแล้วย้อน · สต๊อก
import { test } from "node:test";
import assert from "node:assert/strict";
import { world, T0 } from "./helpers/world.mjs";
import { specKey, specLabel } from "../server/core.mjs";
import { negativeStockFlags } from "../server/actions/deliver_common.mjs";

const AT = new Date(T0).toISOString();
const TODAY = "2026-11-16";
const BOTTLE = { type: "ขวด", size: "600 ml", neck: "คอยาว", shape: "MK", color: "ใส" };
const PLAIN = "spec:" + specKey(BOTTLE);
const SCREENED = PLAIN + "|งานสกรีน:IB1|สกรีน น้ำเงิน";

/** โลกทดสอบ: พนักงานทุกบทบาท · ลูกค้า 3 ราย · ออเดอร์ (ไม่สกรีน 40 ถุง · สกรีน 20 ถุง 2 รายการ · ยกเลิก) */
async function setup(opt) {
  const W = world();
  const T = {
    screen: await W.staff("S1", "จอย", ["screen"]), screen2: await W.staff("S2", "แจน", ["screen"]),
    deliver: await W.staff("S3", "ต่อ", ["deliver"]), deliver2: await W.staff("S4", "ตั้ม", ["deliver"]),
    office: await W.staff("S5", "แอน", ["office"]), prod: await W.staff("S6", "บอส", ["prod"]), account: await W.staff("S7", "ฝ้าย", ["account"]),
    exec: await W.staff("S9", "หัวหน้า", ["exec"]),
  };
  const ins = (sql, ...a) => W.d1.raw.prepare(sql).run(...a);
  ins("INSERT INTO routes(code,name,pos,created_at,updated_at) VALUES ('115','สาย 115',115,?,?)", AT, AT);
  for (const [id, name] of [["CA", "ร้านทดสอบ ก"], ["CB", "ร้านทดสอบ ข"], ["CC", "ร้านทดสอบ ค"]]) ins("INSERT INTO customers(id,name,name_key,route_code,district,created_at,updated_at) VALUES (?,?,?,?,?,?,?)", id, name, name, "115", "เมือง", AT, AT);
  const order = (id, cust, status, due, urgent) => ins("INSERT INTO orders(id,order_day,customer_id,due_day,status,urgent,taker_staff_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)", id, "2026-11-15", cust, due, status, urgent || 0, "S5", AT, AT);
  const item = (id, oid, line, bags, screen) => ins("INSERT INTO order_items(id,order_id,line_no,type,size,neck,shape,color,screen_color,spec_key,label,bags,per_bag,qty_pcs,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    id, oid, line, BOTTLE.type, BOTTLE.size, BOTTLE.neck, BOTTLE.shape, BOTTLE.color, screen || "", specKey(BOTTLE), specLabel(BOTTLE), bags, 200, bags * 200, AT, AT);
  order("OA", "CA", "พร้อมส่ง", TODAY);              item("IA1", "OA", 1, 40);
  order("OB", "CB", "รอสกรีน", "2026-11-17");         item("IB1", "OB", 1, 20, "น้ำเงิน"); item("IB2", "OB", 2, 10, "น้ำเงิน");
  order("OC", "CC", "รอสกรีน", "2026-11-18", 1);      item("IC1", "OC", 1, 5, "แดง");
  order("OX", "CC", "ยกเลิก", TODAY);                 item("IX1", "OX", 1, 5);
  const job = (id, oid, iid, pcs, due) => ins("INSERT INTO screen_jobs(id,order_id,order_item_id,colors,qty_pcs,due_day,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)", id, oid, iid, "น้ำเงิน", pcs, due, "รอดำเนินการ", AT, AT);
  job("J1", "OB", "IB1", 4000, "2026-11-17"); job("J2", "OB", "IB2", 2000, "2026-11-17"); job("J3", "OC", "IC1", 1000, "2026-11-18");
  if (opt && opt.stock) for (const [k, n] of Object.entries(opt.stock)) ins("INSERT INTO stock_moves(at,day,item_key,label,grade,qty_pcs,move_type) VALUES (?,?,?,?,?,?,?)", AT, TODAY, k, "ทดสอบ", "A", n, "ยอดยกมา");
  return { W, T };
}
const bal = (W, k) => (W.one("SELECT qty_pcs FROM stock_balance WHERE item_key = ? AND grade = 'A'", k) || { qty_pcs: 0 }).qty_pcs;
const job = (W, id) => W.one("SELECT * FROM screen_jobs WHERE id = ?", id);
const item = (W, id) => W.one("SELECT * FROM order_items WHERE id = ?", id);
const ord = (W, id) => W.one("SELECT * FROM orders WHERE id = ?", id);
const loadsOf = (W, oid) => W.q("SELECT * FROM delivery_loads WHERE order_id = ? ORDER BY created_at, id", oid);
const openFlags = (W, kind) => W.q("SELECT * FROM flags WHERE status = 'เปิด'" + (kind ? " AND kind = ?" : ""), ...(kind ? [kind] : []));
/** ภาพข้อมูลงาน (ไม่รวมสมุด/ประวัติ) — ไว้เทียบว่า "ย้อน" กลับครบทุกชิ้น */
function snap(W) {
  const strip = rows => rows.map(r => { const o = { ...r }; delete o.version; delete o.updated_at; return o; });
  return JSON.stringify({
    jobs: strip(W.q("SELECT * FROM screen_jobs ORDER BY id")), orders: strip(W.q("SELECT * FROM orders ORDER BY id")), items: strip(W.q("SELECT * FROM order_items ORDER BY id")),
    loads: strip(W.q("SELECT * FROM delivery_loads WHERE status <> 'ยกเลิก' ORDER BY id")), stock: W.q("SELECT item_key, grade, qty_pcs FROM stock_balance WHERE qty_pcs <> 0 ORDER BY item_key, grade"),
    flags: W.q("SELECT kind, title FROM flags WHERE status = 'เปิด' ORDER BY id"),
  });
}
const undo = (W, tk, r) => W.call(tk, "undo.run", { id: r.undo.id });

// ═══════════════════ ทีมสกรีนสี ═══════════════════

test("สกรีน · จ่ายทีม: งาน → เตรียมการสกรีน · ออเดอร์ → กำลังสกรีน · audit ชื่อจากตั๋ว · ย้อนกลับครบ", async () => {
  const { W, T } = await setup();
  const before = snap(W);
  const r = await W.call(T.screen, "screen.assign", { id: "J1", version: 1, team: "ทีม 2" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(job(W, "J1").status, "เตรียมการสกรีน"); assert.equal(job(W, "J1").team, "ทีม 2");
  assert.equal(ord(W, "OB").status, "กำลังสกรีน");
  assert.match(r.undo.label, /ทีม 2 รับงาน ร้านทดสอบ ข/);
  const a = W.one("SELECT * FROM audit_log WHERE action = 'screen.assign' AND entity = 'screen_jobs'");
  assert.equal(a.staff_name, "จอย"); assert.equal(a.role, "screen");
  assert.equal((await undo(W, T.screen, r)).ok, true);
  assert.equal(snap(W), before, "ย้อนแล้วต้องกลับเหมือนเดิมทุกช่อง");
});

test("สกรีน · สิทธิ์: ทีมผลิต/บัญชี/ส่งของ ทำไม่ได้ · ออฟฟิศทำแทนได้ · ประธานใช้บทบาทสกรีนได้ (audit จดบทบาท)", async () => {
  const { W, T } = await setup();
  for (const tk of [T.prod, T.account, T.deliver]) {
    assert.equal((await W.call(tk, "screen.assign", { id: "J1", version: 1, team: "ทีม 1" })).status, 403);
    assert.equal((await W.call(tk, "screen.list", {})).status, 403);
  }
  assert.equal((await W.call(T.screen, "screen.assign", { id: "J1", version: 1, team: "ทีม 1" }, { as: "deliver" })).status, 403, "ใช้บทบาทที่ตัวเองไม่มีไม่ได้");
  const r = await W.call(T.exec, "screen.assign", { id: "J1", version: 1, team: "ทีม 1" }, { as: "screen" });
  assert.equal(r.ok, true);
  assert.equal(W.one("SELECT role FROM audit_log WHERE action = 'screen.assign'").role, "screen");
  assert.equal((await W.call(T.office, "screen.assign", { id: "J2", version: 1, team: "ทีม 3" })).ok, true);
});

test("สกรีน · สองทีมกดงานเดียวกันพร้อมกัน: คนหลังได้ 409 บอกว่าทีมไหน/ใครรับ · กดอีกครั้ง = เปลี่ยนทีมได้", async () => {
  const { W, T } = await setup();
  const a = await W.call(T.screen, "screen.assign", { id: "J1", version: 1, team: "ทีม 1" });
  assert.equal(a.ok, true);
  const b = await W.call(T.screen2, "screen.assign", { id: "J1", version: 1, team: "ทีม 2" });
  assert.equal(b.status, 409);
  assert.match(b.error.message, /ทีม 1 รับงานนี้ไปแล้ว \(จอย \d\d:\d\d\)/);
  assert.equal(b.error.current.team, "ทีม 1");
  assert.equal(job(W, "J1").team, "ทีม 1", "คนหลังไม่ทับคนแรก");
  const c = await W.call(T.screen2, "screen.assign", { id: "J1", version: b.error.current.version, team: "ทีม 2" });
  assert.equal(c.ok, true); assert.equal(job(W, "J1").team, "ทีม 2");
  assert.match(c.undo.label, /แทน ทีม 1/);
  assert.equal((await W.call(T.screen2, "screen.assign", { id: "J1", version: 3, team: "ทีม 2" })).status, 400, "ทีมเดิมกดซ้ำ = บอกว่ารับอยู่แล้ว");
  assert.equal((await W.call(T.screen, "screen.assign", { id: "J1", version: 3, team: "ทีม 9" })).status, 400);
  // สองคำขอพร้อมกันจริง (แทรกกันระหว่างอ่าน/เขียน) — ชนะได้คนเดียว
  const [x, y] = await Promise.all([W.call(T.screen, "screen.assign", { id: "J2", version: 1, team: "ทีม 1" }), W.call(T.screen2, "screen.assign", { id: "J2", version: 1, team: "ทีม 3" })]);
  assert.deepEqual([x.ok, y.ok].filter(Boolean).length, 1, JSON.stringify([x, y]));
  assert.equal(job(W, "J2").version, 2);
});

test("สกรีน · กดซ้ำ (เน็ตหลุดส่งซ้ำ): ได้ผลเดิม ไม่บันทึกสองครั้ง", async () => {
  const { W, T } = await setup();
  const key = W.key();
  const r1 = await W.call(T.screen, "screen.done", { id: "J3", version: 1, team: "ทีม 1" }, { key });
  const r2 = await W.call(T.screen, "screen.done", { id: "J3", version: 1, team: "ทีม 1" }, { key });
  assert.equal(r1.ok, true); assert.equal(r2.replayed, true); assert.equal(r2.undo.id, r1.undo.id);
  assert.equal(W.one("SELECT count(*) n FROM stock_moves WHERE ref_id = 'J3'").n, 2, "ขวดเปล่าออก 1 + ขวดสกรีนเข้า 1 — ไม่เบิ้ล");
  assert.equal((await W.call(T.screen, "screen.done", { id: "J3", version: 1, team: "ทีม 2" }, { key })).status, 409, "กุญแจเดิมแต่เนื้อต่าง = ปฏิเสธ");
});

test("สกรีน · เสร็จแล้ว (ไม่ลงจำนวน): ขวดเปล่าออกเท่างาน · ขวดสกรีนเข้า · ติดลบ = ธง (ไม่บล็อก) · ออเดอร์พร้อมส่งเมื่อเสร็จครบ · ย้อนคืนครบ", async () => {
  const { W, T } = await setup({ stock: { [PLAIN]: 5000 } });
  const s0 = snap(W);
  const r1 = await W.call(T.screen, "screen.done", { id: "J1", version: 1 });   // ไม่มีทีม = ทำได้ (ของเดิมไม่บังคับ)
  assert.equal(r1.ok, true, JSON.stringify(r1));
  assert.equal(job(W, "J1").status, "เสร็จแล้ว"); assert.equal(job(W, "J1").team, null); assert.equal(job(W, "J1").done_by, "S1");
  assert.equal(bal(W, PLAIN), 1000); assert.equal(bal(W, SCREENED), 4000);
  assert.equal(ord(W, "OB").status, "รอสกรีน", "ยังเหลืออีกงาน");
  assert.equal(openFlags(W, "สต๊อกติดลบ").length, 0);
  const r2 = await W.call(T.screen, "screen.done", { id: "J2", version: 1, team: "ทีม 3" });
  assert.equal(bal(W, PLAIN), -1000);
  const f = openFlags(W, "สต๊อกติดลบ");
  assert.equal(f.length, 1); assert.match(f[0].detail, /คงเหลือ -1,000 \(ก่อนหน้า 1,000\)/); assert.equal(f[0].team, "screen");
  assert.equal(ord(W, "OB").status, "พร้อมส่ง");
  assert.equal((await undo(W, T.screen, r2)).ok, true);
  assert.equal(openFlags(W, "สต๊อกติดลบ").length, 0, "ย้อนแล้วธงที่ยกในคำขอนั้นปิดเอง");
  assert.equal((await undo(W, T.screen, r1)).ok, true);
  assert.equal(snap(W), s0);
  assert.equal(W.one("SELECT count(*) n FROM stock_moves WHERE move_type = 'ย้อน'").n, 4, "ย้อน = ลงสมุดกลับทิศ ไม่ลบแถว");
});

test("สกรีน · ลงจำนวนดี/เสีย ตอนเสร็จ และแก้ภายหลัง: สต๊อกขยับตามส่วนต่าง · ย้อนการแก้ได้", async () => {
  const { W, T } = await setup({ stock: { [PLAIN]: 10000 } });
  await W.call(T.screen, "screen.assign", { id: "J1", version: 1, team: "ทีม 1" });
  const r = await W.call(T.screen, "screen.done", { id: "J1", version: 2, good: 3900, waste: 60 });
  assert.equal(r.ok, true); assert.equal(job(W, "J1").team, "ทีม 1", "ไม่ส่งทีม = ใช้ทีมที่รับไว้");
  assert.equal(bal(W, PLAIN), 10000 - 3960); assert.equal(bal(W, SCREENED), 3900);
  const c = await W.call(T.screen, "screen.count", { id: "J1", version: 3, good: 3950, waste: 50 });
  assert.equal(c.ok, true, JSON.stringify(c));
  assert.equal(bal(W, PLAIN), 10000 - 4000); assert.equal(bal(W, SCREENED), 3950);
  assert.equal((await W.call(T.screen, "screen.count", { id: "J1", version: 4, good: 3950, waste: 50 })).status, 400, "จำนวนเท่าเดิม");
  assert.equal((await W.call(T.screen, "screen.count", { id: "J2", version: 1, good: 1, waste: 0 })).status, 400, "ยังไม่เสร็จ ลงจำนวนไม่ได้");
  assert.equal((await W.call(T.screen, "screen.count", { id: "J1", version: 4, good: -1, waste: 0 })).status, 400);
  assert.equal((await W.call(T.screen, "screen.count", { id: "J1", version: 4, good: 1.5, waste: 0 })).status, 400);
  assert.equal((await undo(W, T.screen, c)).ok, true);
  assert.equal(bal(W, PLAIN), 10000 - 3960); assert.equal(bal(W, SCREENED), 3900);
  // งานถูกแตะหลัง "เสร็จ" แล้ว (แก้จำนวน แม้ย้อนการแก้ไปแล้ว) → ย้อน "เสร็จ" ไม่ได้ (กติกากลาง: ทุกแถวต้องยังเป็นรุ่นเดิม) — ไม่แตะอะไรเลย
  const blocked = await undo(W, T.screen, r);
  assert.equal(blocked.status, 409);
  assert.equal(job(W, "J1").status, "เสร็จแล้ว"); assert.equal(bal(W, SCREENED), 3900);
});

test("สกรีน · กดเสร็จแล้วอีกคนกดทีม/เสร็จตาม: 409 บอกว่าเสร็จไปแล้วโดยใคร · ออเดอร์ยกเลิก = ไม่ให้จ่ายทีม", async () => {
  const { W, T } = await setup();
  assert.equal((await W.call(T.screen, "screen.done", { id: "J3", version: 1 })).ok, true);
  const b = await W.call(T.screen2, "screen.assign", { id: "J3", version: 1, team: "ทีม 2" });
  assert.equal(b.status, 409); assert.match(b.error.message, /กดเสร็จไปแล้ว \(จอย/);
  const c = await W.call(T.screen2, "screen.done", { id: "J3", version: 2 });
  assert.equal(c.status, 409);
  W.d1.raw.prepare("UPDATE orders SET status = 'ยกเลิก' WHERE id = 'OB'").run();
  const d = await W.call(T.screen, "screen.assign", { id: "J1", version: 1, team: "ทีม 1" });
  assert.equal(d.status, 409); assert.match(d.error.message, /ยกเลิก/);
  assert.equal((await W.call(T.screen, "screen.assign", { id: "ไม่มี", version: 1, team: "ทีม 1" })).status, 404);
});

test("สกรีน · รายการ: คิวตามวันนัด (ด่วนตัดสินเมื่อวันเท่ากัน) · ดันขึ้นได้ · เสร็จวันนี้รวมต่อทีม · ประวัติ · ปุ่มย้อนของคนทำ", async () => {
  const { W, T } = await setup({ stock: { [PLAIN]: 99999 } });
  const q = await W.call(T.screen, "screen.list", { tab: "queue" });
  // ลำดับคิวกลาง (คุณปาล์มเคาะ 19 พ.ย.): งวด/วันนัดใกล้สุดก่อน (ด่วนเป็นตัวตัดสินเมื่อวันเท่ากัน) → ลงคิวก่อน → ของจองท้าย · ออฟฟิศดันขึ้นได้
  assert.deepEqual(q.data.jobs.map(j => j.id), ["J1", "J2", "J3"], "วันนัด 17 (OB) ก่อน 18 (OC ด่วน)");
  assert.equal(q.data.jobs[0].customer, "ร้านทดสอบ ข"); assert.ok(q.data.jobs[0].rank_no > 0 && q.data.jobs[0].rank_no < q.data.jobs[2].rank_no, "ลำดับในคิวกลาง"); assert.deepEqual(q.data.teams, ["ทีม 1", "ทีม 2", "ทีม 3"]);
  const oc = W.one("SELECT version FROM orders WHERE id = 'OC'");
  const up = await W.call(T.office, "office.prio_move", { id: "OC", version: oc.version, dir: "up" }, { reason: "ลูกค้าขอด่วน" });
  assert.equal(up.status, 200, JSON.stringify(up.error));
  const q2 = await W.call(T.screen, "screen.list", { tab: "queue" });
  assert.deepEqual(q2.data.jobs.map(j => j.id), ["J3", "J1", "J2"], "ออฟฟิศดันขึ้น = ขึ้นก่อน");
  assert.equal(q2.data.jobs[0].prio, 1); assert.equal(q2.data.jobs[0].per_bag, 200);
  await W.call(T.office, "undo.run", { id: up.undo.id });
  await W.call(T.screen, "screen.done", { id: "J1", version: 1, team: "ทีม 2" });
  const t = await W.call(T.screen, "screen.list", { tab: "today" });
  assert.equal(t.data.jobs.length, 1); assert.equal(t.data.jobs[0].done_nick, "จอย"); assert.ok(t.data.jobs[0].undo_id);
  assert.deepEqual(t.data.doneToday, [{ team: "ทีม 2", jobs: 1, parts: 0, pcs: 4000 }]);
  W.tick(864e5);
  const h = await W.call(T.screen, "screen.list", { tab: "history" });
  assert.equal(h.data.jobs.length, 1);
  assert.equal((await W.call(T.screen, "screen.list", { tab: "today" })).data.jobs.length, 0, "ข้ามวันแล้วไม่อยู่ในเสร็จวันนี้");
});

// ═══════════════════ ส่งของ ═══════════════════

test("ส่งของ · ขึ้นรถเต็ม: แถวบนรถ + รอบรถวันนี้ (ใช้ซ้ำ) · ตัวนับบนรถ · คลังออก (ขวดเปล่า / ขวดสกรีน) · ย้อนครบ", async () => {
  const secondScreened = PLAIN + "|งานสกรีน:IB2|สกรีน น้ำเงิน";
  const { W, T } = await setup({ stock: { [PLAIN]: 9000, [SCREENED]: 4000, [secondScreened]: 2000 } });
  const s0 = snap(W);
  const r = await W.call(T.deliver, "deliver.load", { order: "OA", vehicle: "04", lines: [{ item: "IA1", qty: 8000 }] });
  assert.equal(r.ok, true, JSON.stringify(r));
  const L = loadsOf(W, "OA");
  assert.equal(L.length, 1); assert.equal(L[0].status, "บนรถ"); assert.equal(L[0].loaded_by, "S3"); assert.equal(L[0].stock_key, PLAIN);
  assert.equal(L[0].trip_id, "T" + TODAY + "-04");
  assert.equal(item(W, "IA1").onboard_pcs, 8000); assert.equal(bal(W, PLAIN), 1000);
  assert.equal(ord(W, "OA").status, "พร้อมส่ง", "ขึ้นรถไม่เปลี่ยนสถานะออเดอร์");
  assert.match(r.undo.label, /ขึ้นรถ 04 · ร้านทดสอบ ก/);
  W.d1.raw.prepare("UPDATE screen_jobs SET status = 'เสร็จแล้ว', done_at = ?, done_day = ? WHERE order_id = 'OB'").run(AT, TODAY);
  const r2 = await W.call(T.deliver, "deliver.load", { order: "OB", vehicle: "04", lines: [{ item: "IB1", qty: 4000 }, { item: "IB2", qty: 2000 }] });
  assert.equal(r2.ok, true, JSON.stringify(r2));
  assert.deepEqual([bal(W, SCREENED), bal(W, secondScreened)], [0, 0], "ขึ้นรถหักขวดสกรีนของแต่ละรายการ");
  assert.equal(W.one("SELECT count(*) n FROM delivery_trips").n, 1, "รถคันเดียววันเดียว = รอบเดียว");
  assert.equal((await undo(W, T.deliver, r2)).ok, true);
  assert.equal((await undo(W, T.deliver, r)).ok, true);
  W.d1.raw.prepare("UPDATE screen_jobs SET status = 'รอดำเนินการ', done_at = '', done_day = '' WHERE order_id = 'OB'").run();
  assert.equal(snap(W), s0, "ย้อนขึ้นรถ = แถวบนรถยกเลิก · ตัวนับ/คลังกลับ (รอบรถว่างเก็บไว้ ไม่เป็นไร)");
});

test("ส่งของ · สิทธิ์: สกรีน/ผลิต/บัญชี ทำไม่ได้ · ออฟฟิศกดแทนคนขับได้ · ย้อนได้เฉพาะคนทำหรือประธาน", async () => {
  const { W, T } = await setup();
  for (const tk of [T.screen, T.prod, T.account]) {
    assert.equal((await W.call(tk, "deliver.load", { order: "OA", vehicle: "04", lines: [{ item: "IA1", qty: 200 }] })).status, 403);
    assert.equal((await W.call(tk, "deliver.board", {})).status, 403);
  }
  const r = await W.call(T.office, "deliver.load", { order: "OA", vehicle: "04", lines: [{ item: "IA1", qty: 200 }] });
  assert.equal(r.ok, true);
  assert.equal((await undo(W, T.deliver, r)).status, 403, "คนอื่นย้อนแทนไม่ได้");
  assert.equal((await undo(W, T.exec, r)).ok, true, "ประธานย้อนได้");
});

test("ส่งของ · ขึ้นเกินที่เหลือ: ถามเหตุผล (บอกว่าขึ้นคันไหน ใคร) · ใส่เหตุผลแล้วทำได้ + ธง · ขึ้นก่อนสกรีนเสร็จ = ถามเหตุผลเหมือนกัน", async () => {
  const { W, T } = await setup();
  await W.call(T.deliver, "deliver.load", { order: "OA", vehicle: "04", lines: [{ item: "IA1", qty: 6000 }] });
  const over = await W.call(T.deliver2, "deliver.load", { order: "OA", vehicle: "05", lines: [{ item: "IA1", qty: 4000 }] });
  assert.equal(over.status, 409); assert.equal(over.error.code, "need_reason"); assert.equal(over.error.need, "over");
  assert.match(over.error.message, /เหลือให้ขึ้น 10 ถุง \(2,000 ใบ\) · บนรถแล้ว รถ 04 30 ถุง \(6,000 ใบ\) \(ต่อ \d\d:\d\d\)/);
  assert.equal((await W.call(T.deliver2, "deliver.load", { order: "OA", vehicle: "05", lines: [{ item: "IA1", qty: 4000 }], over: true })).status, 400, "ต้องมีเหตุผล");
  const ok = await W.call(T.deliver2, "deliver.load", { order: "OA", vehicle: "05", lines: [{ item: "IA1", qty: 4000 }], over: true }, { reason: "ลูกค้าขอเพิ่มหน้างาน" });
  assert.equal(ok.ok, true);
  assert.equal(item(W, "IA1").onboard_pcs, 10000);
  assert.match(openFlags(W, "ทำนอกขั้นตอน")[0].title, /ขึ้นรถเกินออเดอร์/);
  const early = await W.call(T.deliver, "deliver.load", { order: "OB", vehicle: "04", lines: [{ item: "IB1", qty: 200 }] });
  assert.equal(early.error.need, "early"); assert.match(early.error.message, /ยังสกรีนไม่เสร็จ \(ยังไม่มีทีมรับ\)/);
  const e2 = await W.call(T.deliver, "deliver.load", { order: "OB", vehicle: "04", lines: [{ item: "IB1", qty: 200 }], early: true }, { reason: "ลูกค้ารีบ ใช้ขวดเปล่าไปก่อน" });
  assert.equal(e2.ok, true);
  assert.equal(loadsOf(W, "OB")[0].stock_key, SCREENED);
  assert.equal(openFlags(W, "สต๊อกติดลบ").length >= 1, true, "ไม่มีของในคลังแต่ขึ้นรถ = ธง ไม่บล็อก");
});

test("ส่งของ · ขึ้นรถสองคัน: แบ่งได้ไม่เกินที่เหลือ · สองคนกดขึ้นรายการเดียวกันพร้อมกัน = ได้คนเดียว (ไม่ขึ้นเกินเงียบ)", async () => {
  const { W, T } = await setup();
  assert.equal((await W.call(T.deliver, "deliver.load", { order: "OA", vehicle: "04", lines: [{ item: "IA1", qty: 4000 }] })).ok, true);
  assert.equal((await W.call(T.deliver2, "deliver.load", { order: "OA", vehicle: "05", lines: [{ item: "IA1", qty: 4000 }] })).ok, true);
  const b = await W.call(T.deliver, "deliver.board", {});
  const s = b.data.stops.find(x => x.id === "OA");
  assert.deepEqual(s.vehicles.sort(), ["04", "05"]); assert.equal(s.left_pcs, 0); assert.equal(s.onboard_pcs, 8000);
  // พร้อมกันจริง: OC 1,000 ใบ — สองคันขึ้นเต็มพร้อมกัน
  W.d1.raw.prepare("UPDATE screen_jobs SET status = 'เสร็จแล้ว', done_at = ?, done_day = ? WHERE id = 'J3'").run(AT, TODAY);
  const [x, y] = await Promise.all([
    W.call(T.deliver, "deliver.load", { order: "OC", vehicle: "06", lines: [{ item: "IC1", qty: 1000 }] }),
    W.call(T.deliver2, "deliver.load", { order: "OC", vehicle: "07", lines: [{ item: "IC1", qty: 1000 }] }),
  ]);
  assert.equal([x, y].filter(r => r.ok).length, 1, JSON.stringify([x.error, y.error]));
  assert.equal([x, y].find(r => !r.ok).status, 409);
  assert.equal(item(W, "IC1").onboard_pcs, 1000);
  assert.equal(W.one("SELECT sum(qty_pcs) s FROM delivery_loads WHERE order_id = 'OC' AND status = 'บนรถ'").s, 1000);
});

test("ส่งของ · ส่งแล้วเต็ม: สถานะ + การส่ง 1 ครั้ง · นับส่งแล้ว · ออเดอร์ส่งแล้ว + วันส่งครบ · คลังไม่ขยับซ้ำ · ย้อนครบทุกชิ้น", async () => {
  const { W, T } = await setup({ stock: { [PLAIN]: 8000 } });
  await W.call(T.deliver, "deliver.load", { order: "OA", vehicle: "04", lines: [{ item: "IA1", qty: 8000 }] });
  const s0 = snap(W), stock0 = bal(W, PLAIN);
  const L = loadsOf(W, "OA")[0];
  const r = await W.call(T.deliver, "deliver.done", { order: "OA", loads: [{ id: L.id, version: L.version }] });
  assert.equal(r.ok, true, JSON.stringify(r));
  const L2 = loadsOf(W, "OA")[0];
  assert.equal(L2.status, "ส่งแล้ว"); assert.equal(L2.stop_id, r.data.stop); assert.equal(L2.done_by, "S3"); assert.equal(L2.done_day, TODAY);
  assert.equal(item(W, "IA1").delivered_pcs, 8000); assert.equal(item(W, "IA1").onboard_pcs, 0);
  assert.equal(ord(W, "OA").status, "ส่งแล้ว"); assert.equal(ord(W, "OA").delivered_day, TODAY);
  assert.equal(bal(W, PLAIN), stock0, "ส่งแล้วไม่ตัดคลังซ้ำ (ตัดไปตอนขึ้นรถ)");
  const dl = await W.call(T.deliver, "deliver.done_list", {});
  assert.equal(dl.data.stops.length, 1); assert.equal(dl.data.stops[0].undo_id, r.undo.id); assert.equal(dl.data.stops[0].undo_mine, true);
  const doc = await W.call(T.deliver, "deliver.doc", { stop: r.data.stop });
  assert.equal(doc.data.customer.name, "ร้านทดสอบ ก"); assert.equal(doc.data.lines[0].text, "40 ถุง (8,000 ใบ)"); assert.match(doc.data.vehicle, /รถ 04/);
  assert.equal((await undo(W, T.deliver, r)).ok, true);
  assert.equal(snap(W), s0, "ย้อนส่งแล้ว = กลับเป็นบนรถ · ตัวนับ · สถานะออเดอร์ ครบทุกชิ้น");
  assert.equal((await W.call(T.deliver, "deliver.doc", { stop: r.data.stop })).status, 404, "ใบส่งของของการส่งที่ย้อนแล้ว = ไม่มี");
});

test("ส่งของ · ส่งบางส่วน: ที่เหลือยังอยู่บนรถ (แถวใหม่) · ออเดอร์ส่งบางส่วน · ย้อนครบ (ไม่ย้อนครึ่ง ๆ) · ส่งต่อแล้วย้อนอันแรกไม่ได้", async () => {
  const { W, T } = await setup();
  await W.call(T.deliver, "deliver.load", { order: "OA", vehicle: "04", lines: [{ item: "IA1", qty: 8000 }] });
  const s0 = snap(W);
  const L = loadsOf(W, "OA")[0];
  const r = await W.call(T.deliver, "deliver.done", { order: "OA", loads: [{ id: L.id, version: L.version, qty: 6000 }] });
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.data.rest_pcs, 2000); assert.equal(r.data.order_status, "ส่งบางส่วน");
  const a = loadsOf(W, "OA").find(x => x.id === L.id), b = loadsOf(W, "OA").find(x => x.id !== L.id);
  assert.equal(a.status, "ส่งแล้ว"); assert.equal(a.qty_pcs, 6000);
  assert.equal(b.status, "บนรถ"); assert.equal(b.qty_pcs, 2000); assert.equal(b.split_from, a.id); assert.equal(b.trip_id, a.trip_id); assert.equal(b.stock_key, a.stock_key);
  assert.equal(item(W, "IA1").delivered_pcs, 6000); assert.equal(item(W, "IA1").onboard_pcs, 2000);
  assert.equal(ord(W, "OA").status, "ส่งบางส่วน");
  // ย้อนทันที = กลับ 8,000 บนรถ ทั้งก้อน
  assert.equal((await undo(W, T.deliver, r)).ok, true);
  assert.equal(snap(W), s0);
  // ส่งบางส่วนอีกรอบ แล้วส่งส่วนที่เหลือ → ย้อนอันแรกไม่ได้ (ขั้นถัดไปแตะแล้ว) · ย้อนอันหลังได้ (ล่าสุดก่อน)
  const L1 = loadsOf(W, "OA").find(x => x.status === "บนรถ");
  const p1 = await W.call(T.deliver, "deliver.done", { order: "OA", loads: [{ id: L1.id, version: L1.version, qty: 6000 }] });
  const rest = loadsOf(W, "OA").find(x => x.status === "บนรถ");
  const p2 = await W.call(T.deliver, "deliver.done", { order: "OA", loads: [{ id: rest.id, version: rest.version }] });
  assert.equal(p2.ok, true); assert.equal(ord(W, "OA").status, "ส่งแล้ว");
  const blocked = await undo(W, T.deliver, p1);
  assert.equal(blocked.status, 409); assert.match(blocked.error.message, /ขั้นถัดไปรับงานไปแล้ว/);
  assert.equal(ord(W, "OA").status, "ส่งแล้ว", "ย้อนไม่ได้ = ไม่แตะอะไรเลย (ไม่ครึ่ง ๆ)");
  assert.equal((await undo(W, T.deliver, p2)).ok, true);
  assert.equal(ord(W, "OA").status, "ส่งบางส่วน"); assert.equal(item(W, "IA1").delivered_pcs, 6000); assert.equal(item(W, "IA1").onboard_pcs, 2000);
});

test("ส่งของ · ส่งไม่ได้: เหตุผลบังคับ · ของยังอยู่บนรถ · ธงแจ้งออฟฟิศ · ส่งใหม่ได้ภายหลัง · ย้อนได้", async () => {
  const { W, T } = await setup();
  await W.call(T.deliver, "deliver.load", { order: "OA", vehicle: "04", lines: [{ item: "IA1", qty: 8000 }] });
  const L = loadsOf(W, "OA")[0];
  assert.equal((await W.call(T.deliver, "deliver.fail", { order: "OA", loads: [{ id: L.id, version: L.version }] })).status, 400);
  const s0 = snap(W);
  const f = await W.call(T.deliver, "deliver.fail", { order: "OA", loads: [{ id: L.id, version: L.version }] }, { reason: "ร้านปิด" });
  assert.equal(f.ok, true);
  const L2 = loadsOf(W, "OA")[0];
  assert.equal(L2.status, "ส่งไม่ได้"); assert.equal(L2.fail_reason, "ร้านปิด"); assert.equal(item(W, "IA1").onboard_pcs, 8000);
  const fl = openFlags(W, "ส่งไม่ได้");
  assert.equal(fl.length, 1); assert.match(fl[0].title, /ร้านทดสอบ ก — ร้านปิด/);
  const office = await W.call(T.office, "flag.list", {});
  assert.ok(office.data.items.some(x => x.kind === "ส่งไม่ได้"), "ออฟฟิศเห็นธงส่งไม่ได้");
  assert.equal((await undo(W, T.deliver, f)).ok, true);
  assert.equal(snap(W), s0);
  const f2 = await W.call(T.deliver, "deliver.fail", { order: "OA", loads: [{ id: L.id, version: L.version + 2 }] }, { reason: "ไม่มีคนรับ" });
  assert.equal(f2.ok, true);
  const L3 = loadsOf(W, "OA")[0];
  const d = await W.call(T.deliver, "deliver.done", { order: "OA", loads: [{ id: L3.id, version: L3.version }] });
  assert.equal(d.ok, true, JSON.stringify(d));
  assert.equal(loadsOf(W, "OA")[0].fail_reason, "ไม่มีคนรับ", "ประวัติส่งไม่ได้ยังอยู่ในแถว");
});

test("ส่งของ · เอาลงจากรถ (คืนคลัง) ทั้งคัน · ย้ายคัน: คลังกลับกุญแจเดิม · ตัวนับ · ย้อนได้", async () => {
  const { W, T } = await setup({ stock: { [PLAIN]: 9000 } });
  await W.call(T.deliver, "deliver.load", { order: "OA", vehicle: "04", lines: [{ item: "IA1", qty: 8000 }] });
  await W.call(T.deliver, "deliver.load", { order: "OX".replace("X", "A"), vehicle: "04", lines: [{ item: "IA1", qty: 1000 }], over: true }, { reason: "ของแถม/เผื่อแตก" });
  const loads = loadsOf(W, "OA");
  const mv = await W.call(T.deliver, "deliver.retruck", { loads: [{ id: loads[1].id, version: loads[1].version }], vehicle: "06" });
  assert.equal(mv.ok, true);
  assert.equal(W.one("SELECT trip_id FROM delivery_loads WHERE id = ?", loads[1].id).trip_id, "T" + TODAY + "-06");
  assert.equal(bal(W, PLAIN), 0, "ย้ายคันไม่ขยับคลัง");
  assert.equal((await W.call(T.deliver, "deliver.retruck", { loads: [{ id: loads[0].id, version: loads[0].version }], vehicle: "04" })).status, 400, "อยู่คันนั้นอยู่แล้ว");
  assert.equal((await W.call(T.deliver, "deliver.retruck", { loads: [{ id: loads[0].id, version: loads[0].version }], vehicle: "99" })).status, 400, "ไม่มีรถในทะเบียน");
  const s0 = snap(W);
  const cur = loadsOf(W, "OA");
  const u = await W.call(T.deliver, "deliver.unload", { loads: cur.map(l => ({ id: l.id, version: l.version })) }, { reason: "ส่งไม่ได้ เอากลับโรงงาน" });
  assert.equal(u.ok, true, JSON.stringify(u));
  assert.equal(bal(W, PLAIN), 9000); assert.equal(item(W, "IA1").onboard_pcs, 0);
  assert.ok(loadsOf(W, "OA").every(l => l.status === "คืนคลัง"));
  assert.equal(W.q("SELECT count(*) n FROM stock_moves WHERE move_type = 'คืนคลัง'")[0].n, 2);
  assert.equal((await undo(W, T.deliver, u)).ok, true);
  assert.equal(snap(W), s0);
});

test("ส่งของ · คืนขวดสกรีนเข้าสต๊อกของรายการเดิมพร้อมชื่อร้าน", async () => {
  const { W, T } = await setup({ stock: { [SCREENED]: 4000 } });
  W.d1.raw.prepare("UPDATE screen_jobs SET status = 'เสร็จแล้ว', done_at = ?, done_day = ? WHERE id = 'J1'").run(AT, TODAY);
  const loaded = await W.call(T.deliver, "deliver.load", { order: "OB", vehicle: "04", lines: [{ item: "IB1", qty: 4000 }] });
  assert.equal(loaded.ok, true, JSON.stringify(loaded));
  const [load] = loadsOf(W, "OB");
  const returned = await W.call(T.deliver, "deliver.unload", { loads: [{ id: load.id, version: load.version }] });
  assert.equal(returned.ok, true, JSON.stringify(returned));
  const move = W.one("SELECT item_key, label FROM stock_moves WHERE ref_id = ? AND move_type = 'คืนคลัง'", load.id);
  assert.equal(move.item_key, SCREENED);
  assert.match(move.label, /ร้านทดสอบ ข/);
  assert.equal(bal(W, SCREENED), 4000);
});

test("ส่งของ · ผิดทาง: ออเดอร์ยกเลิก · รายการไม่ใช่ของออเดอร์ · ปนหลายร้าน · ส่งเกินบนรถ · ส่ง 0 · รุ่นเก่า (คนอื่นส่งไปแล้ว) · รถพัก", async () => {
  const { W, T } = await setup();
  assert.equal((await W.call(T.deliver, "deliver.load", { order: "OX", vehicle: "04", lines: [{ item: "IX1", qty: 200 }] })).status, 409);
  assert.equal((await W.call(T.deliver, "deliver.load", { order: "OA", vehicle: "04", lines: [{ item: "IB1", qty: 200 }] })).status, 400);
  assert.equal((await W.call(T.deliver, "deliver.load", { order: "OA", vehicle: "04", lines: [] })).status, 400);
  assert.equal((await W.call(T.deliver, "deliver.load", { order: "OA", vehicle: "04", lines: [{ item: "IA1", qty: 0 }] })).status, 400);
  assert.equal((await W.call(T.deliver, "deliver.load", { order: "OA", vehicle: "04", lines: [{ item: "IA1", qty: 100 }, { item: "IA1", qty: 100 }] })).status, 400);
  W.d1.raw.prepare("UPDATE vehicles SET active = 0 WHERE id = '09'").run();
  assert.equal((await W.call(T.deliver, "deliver.load", { order: "OA", vehicle: "09", lines: [{ item: "IA1", qty: 100 }] })).status, 400);
  await W.call(T.deliver, "deliver.load", { order: "OA", vehicle: "04", lines: [{ item: "IA1", qty: 8000 }] });
  W.d1.raw.prepare("UPDATE screen_jobs SET status = 'เสร็จแล้ว', done_at = ?, done_day = ? WHERE order_id = 'OB'").run(AT, TODAY);
  await W.call(T.deliver, "deliver.load", { order: "OB", vehicle: "04", lines: [{ item: "IB1", qty: 4000 }] });
  const a = loadsOf(W, "OA")[0], b = loadsOf(W, "OB")[0];
  assert.equal((await W.call(T.deliver, "deliver.done", { order: "OA", loads: [{ id: a.id, version: 1 }, { id: b.id, version: 1 }] })).status, 400, "ปนสองร้าน");
  assert.equal((await W.call(T.deliver, "deliver.done", { order: "OA", loads: [{ id: a.id, version: 1, qty: 9000 }] })).status, 400, "ส่งเกินที่อยู่บนรถ");
  assert.equal((await W.call(T.deliver, "deliver.done", { order: "OA", loads: [{ id: a.id, version: 1, qty: 0 }] })).status, 400, "ส่ง 0 = ให้กดส่งไม่ได้");
  assert.equal((await W.call(T.deliver, "deliver.done", { order: "OB", loads: [{ id: a.id, version: 1 }] })).status, 400, "ไม่ใช่ของออเดอร์นี้");
  assert.equal((await W.call(T.deliver, "deliver.done", { order: "OA", loads: [{ id: a.id, version: 1 }] })).ok, true);
  const late = await W.call(T.deliver2, "deliver.done", { order: "OA", loads: [{ id: a.id, version: 1 }] });
  assert.equal(late.status, 409); assert.match(late.error.message, /กดส่งแล้วไปก่อน \(ต่อ \d\d:\d\d\)/);
  assert.equal((await W.call(T.deliver2, "deliver.unload", { loads: [{ id: a.id, version: 2 }] })).status, 409, "ส่งแล้วเอาลงไม่ได้");
  assert.equal((await W.call(T.deliver, "deliver.done", { order: "OA", loads: [{ id: "ไม่มี", version: 1 }] })).status, 404);
});

test("ส่งของ · กดซ้ำ (เน็ตหลุดส่งซ้ำ) ขึ้นรถ/ส่งแล้ว: ได้ผลเดิม ไม่นับสองครั้ง", async () => {
  const { W, T } = await setup();
  const k1 = W.key();
  const a1 = await W.call(T.deliver, "deliver.load", { order: "OA", vehicle: "04", lines: [{ item: "IA1", qty: 8000 }] }, { key: k1 });
  const a2 = await W.call(T.deliver, "deliver.load", { order: "OA", vehicle: "04", lines: [{ item: "IA1", qty: 8000 }] }, { key: k1 });
  assert.equal(a2.replayed, true); assert.deepEqual(a2.data, a1.data);
  assert.equal(loadsOf(W, "OA").length, 1); assert.equal(item(W, "IA1").onboard_pcs, 8000);
  const L = loadsOf(W, "OA")[0], k2 = W.key();
  const d1 = await W.call(T.deliver, "deliver.done", { order: "OA", loads: [{ id: L.id, version: 1 }] }, { key: k2 });
  const d2 = await W.call(T.deliver, "deliver.done", { order: "OA", loads: [{ id: L.id, version: 1 }] }, { key: k2 });
  assert.equal(d2.replayed, true); assert.equal(d2.data.stop, d1.data.stop);
  assert.equal(item(W, "IA1").delivered_pcs, 8000);
});

test("ส่งของ · หน้าเส้นทาง/บนรถ: ร้านที่ต้องส่ง (เหลือ/บนรถ) · พร้อม/ยังรอสกรีน · ส่งไม่ได้ขึ้นเหตุผล · ใบส่งของของบนรถ · ทะเบียนรถจากตาราง", async () => {
  const { W, T } = await setup();
  await W.call(T.deliver, "deliver.load", { order: "OA", vehicle: "05", lines: [{ item: "IA1", qty: 2000 }] });
  const L = loadsOf(W, "OA")[0];
  await W.call(T.deliver, "deliver.fail", { order: "OA", loads: [{ id: L.id, version: 1 }] }, { reason: "ร้านปิด" });
  const b = (await W.call(T.deliver, "deliver.board", {})).data;
  assert.deepEqual(b.stops.map(s => s.id).sort(), ["OA", "OB", "OC"], "ออเดอร์ยกเลิกไม่ขึ้น");
  const a = b.stops.find(s => s.id === "OA");
  assert.equal(a.left_pcs, 6000); assert.equal(a.onboard_pcs, 2000); assert.equal(a.failed, "ร้านปิด"); assert.equal(a.ready, true); assert.equal(a.route_code, "115");
  assert.equal(b.stops.find(s => s.id === "OB").screen_pending, 2);
  assert.deepEqual(b.vehicles.map(v => v.id), ["04", "05", "06", "07", "08", "09"]);
  const doc = await W.call(T.deliver, "deliver.doc", { order: "OA" });
  assert.match(doc.data.title, /ยังไม่ได้ส่ง/); assert.equal(doc.data.totalPcs, 2000); assert.deepEqual(doc.data.bills, []);
  assert.equal((await W.call(T.deliver, "deliver.doc", {})).status, 400);
});

test("ส่งของ/สกรีน · ทุกปุ่มบันทึกคุยกับฐาน ≤ 4 รอบ (ตั๋ว+กันซ้ำ · ค่าตั้ง · อ่านก่อนเขียน · เขียน)", async () => {
  const { W, T } = await setup();
  const rounds = async (tk, action, input, more) => { const r0 = W.d1.stats.rounds; const r = await W.call(tk, action, input, more); assert.equal(r.ok, true, action + " " + JSON.stringify(r.error)); return W.d1.stats.rounds - r0; };
  assert.ok(await rounds(T.screen, "screen.assign", { id: "J1", version: 1, team: "ทีม 1" }) <= 4);
  assert.ok(await rounds(T.screen, "screen.done", { id: "J1", version: 2 }) <= 4);
  assert.ok(await rounds(T.screen, "screen.count", { id: "J1", version: 3, good: 3000, waste: 10 }) <= 4);
  assert.ok(await rounds(T.deliver, "deliver.load", { order: "OA", vehicle: "04", lines: [{ item: "IA1", qty: 8000 }] }) <= 4);
  const L = loadsOf(W, "OA")[0];
  assert.ok(await rounds(T.deliver, "deliver.fail", { order: "OA", loads: [{ id: L.id, version: 1 }] }, { reason: "ร้านปิด" }) <= 4);
  assert.ok(await rounds(T.deliver, "deliver.retruck", { loads: [{ id: L.id, version: 2 }], vehicle: "05" }) <= 4);
  assert.ok(await rounds(T.deliver, "deliver.done", { order: "OA", loads: [{ id: L.id, version: 3, qty: 4000 }] }) <= 4);
  const R = loadsOf(W, "OA").find(l => l.status === "บนรถ");
  assert.ok(await rounds(T.deliver, "deliver.unload", { loads: [{ id: R.id, version: 1 }] }) <= 4);
});

test("ตัวช่วย: ธงสต๊อกติดลบ (ครั้งเดียวต่อกุญแจ · ของเข้าไม่ยกธง)", () => {
  const f = negativeStockFlags([{ item_key: "spec:a", qty_pcs: 5 }], [
    { item_key: "spec:a", qty_pcs: -3 }, { item_key: "spec:a", qty_pcs: -3 }, { item_key: "spec:a", qty_pcs: -3 }, { item_key: "spec:b", qty_pcs: 10 }], "deliver");
  assert.equal(f.length, 1); assert.equal(f[0].dedupe_key, "stockneg:spec:a"); assert.match(f[0].detail, /คงเหลือ -1 \(ก่อนหน้า 2\)/);
});

test("เงินไม่หลุดหน้าสกรีน/ส่งของ: คิว · เส้นทาง · ส่งแล้ว · ใบส่งของ (มีบิลแล้วบอกแค่ว่ามี ไม่บอกยอด)", async () => {
  const { W, T } = await setup();
  W.d1.raw.prepare("UPDATE order_items SET price_satang = 1234 WHERE order_id = 'OA'").run();
  W.d1.raw.prepare("UPDATE orders SET total_satang = 987654 WHERE id = 'OA'").run();
  W.d1.raw.prepare("INSERT INTO bills(bill_no,bill_day,customer_id,customer_name,order_id,total_satang,kind,status,created_at,updated_at) VALUES ('PB-T1',?,?,?,?,?,?,?,?,?)").run(TODAY, "CA", "ร้านทดสอบ ก", "OA", 987654, "เครดิต", "ค้างชำระ", AT, AT);
  await W.call(T.deliver, "deliver.load", { order: "OA", vehicle: "04", lines: [{ item: "IA1", qty: 8000 }] });
  const L = loadsOf(W, "OA")[0];
  const d = await W.call(T.deliver, "deliver.done", { order: "OA", loads: [{ id: L.id, version: 1 }] });
  for (const [tk, a, input] of [[T.screen, "screen.list", { tab: "queue" }], [T.deliver, "deliver.board", {}], [T.deliver, "deliver.done_list", {}], [T.deliver, "deliver.doc", { stop: d.data.stop }]]) {
    const r = await W.call(tk, a, input);
    assert.equal(r.ok, true, a);
    const s = JSON.stringify(r.data);
    assert.ok(!/_satang/.test(s) && !s.includes("987654") && !s.includes("9876.54") && !s.includes("1234"), a + " มีตัวเลขเงิน: " + s.slice(0, 160));
  }
  const doc = await W.call(T.deliver, "deliver.doc", { stop: d.data.stop });
  assert.equal(doc.data.bills.length, 1); assert.equal(doc.data.bills[0].kind, "เครดิต");
});

test("สต๊อกเกรด B: สีเกรด B ตัดจากสต๊อกเกรด B (ไม่ปนของดี) · สถานะออเดอร์ตามกติกาออฟฟิศ (งานผลิตยังไม่เสร็จ = ยังไม่พร้อมส่ง) · ออเดอร์ใหม่ขึ้นเส้นทาง", async () => {
  const { W, T } = await setup();
  const B = { type: "ขวด", size: "600 ml", neck: "คอยาว", shape: "MK", color: "ดำ (เกรด B)" };
  W.d1.raw.prepare("INSERT INTO spec_values(axis, value, pos, grade) VALUES ('สี', 'ดำ (เกรด B)', 99, 'B') ON CONFLICT DO NOTHING").run();
  W.d1.raw.prepare("UPDATE spec_values SET grade = 'B' WHERE axis = 'สี' AND value = 'ดำ (เกรด B)'").run();
  W.d1.raw.prepare("INSERT INTO orders(id,order_day,customer_id,due_day,status,created_at,updated_at) VALUES ('OG','2026-11-15','CA','','ออเดอร์ใหม่',?,?)").run(AT, AT);
  W.d1.raw.prepare("INSERT INTO order_items(id,order_id,line_no,type,size,neck,shape,color,spec_key,label,bags,per_bag,qty_pcs,created_at,updated_at) VALUES ('IG1','OG',1,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(B.type, B.size, B.neck, B.shape, B.color, specKey(B), specLabel(B), 2, 200, 400, AT, AT);
  const board = (await W.call(T.deliver, "deliver.board", {})).data;
  assert.ok(board.stops.some(s => s.id === "OG" && s.due_day === ""), "ออเดอร์ใหม่ (ยังไม่กำหนดวัน) ขึ้นในเส้นทาง");
  const r = await W.call(T.deliver, "deliver.load", { order: "OG", vehicle: "04", lines: [{ item: "IG1", qty: 400 }] });
  assert.equal(r.ok, true, JSON.stringify(r));
  const k = "spec:" + specKey(B);
  assert.equal(W.one("SELECT qty_pcs FROM stock_balance WHERE item_key = ? AND grade = 'B'", k).qty_pcs, -400);
  assert.equal(W.one("SELECT count(*) n FROM stock_balance WHERE item_key = ? AND grade = 'A'", k).n, 0, "เกรด B ไม่แตะของดี");
  // งานผลิตที่ผูกออเดอร์ยังไม่เสร็จ → สกรีนเสร็จแล้วออเดอร์ไม่ไป "พร้อมส่ง"
  W.d1.raw.prepare("INSERT INTO production_jobs(id,order_id,order_item_id,type,spec_key,status,created_at,updated_at) VALUES ('PJ1','OC','IC1','ขวด',?, 'กำลังผลิต',?,?)").run(specKey(BOTTLE), AT, AT);
  await W.call(T.screen, "screen.done", { id: "J3", version: 1, team: "ทีม 1" });
  assert.equal(ord(W, "OC").status, "กำลังผลิต");
});
