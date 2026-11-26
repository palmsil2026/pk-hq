// ============================================================
//  เทสต์ข้ามโมดูลทั้งวง (รวมระบบ) — ออฟฟิศ → ทีมผลิต → สกรีน → ส่งของ → บิล → บัญชี → ประธาน          v2/tests/e2e.test.mjs
//  ไล่เส้นทางจริงแบบที่คนในโรงงานกดตามลำดับ ผ่านประตู API เดียว (ตั๋ว · สิทธิ์ · ท่อเขียนกลาง) บน D1 จำลอง — ข้อมูลสมมติล้วน
//  เช็คทุกขั้น: สถานะออเดอร์ · สต๊อก A/B (ขวดเปล่า/ขวดสกรีน) · ของบนรถ · บิล/รับชำระ/เงินเข้า · ธง → หน้า "เรื่องที่ต้องตัดสินใจ"
//  + เคสย้อน · สิทธิ์ข้ามบทบาท · ซิงก์ชีตเดิมซ้ำแล้วไม่เบิ้ล/ไม่ทับของที่แก้ใน v2
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { world, T0 } from "./helpers/world.mjs";
import { specKey } from "../server/core.mjs";
import { loadGas } from "./gas/harness.mjs";
import { seedGas, IDS } from "./fixtures/sheets.mjs";
import { issueTicket } from "../server/ticket.mjs";

const H = 3600000, D = 24 * H;
const AX = "ขนาด,คอขวด,รูปทรง,สี,สีสกรีน,พร้อมฝาสี";
const CLEAR = { type: "ขวด", size: "600 ml", neck: "คอยาว", shape: "MK", color: "ใส" };
const BLUE = { ...CLEAR, color: "น้ำเงิน" };
const CAP = { type: "ฝา", size: "PET น้ำลัง ปากแคบ", color: "" };
const K_CLEAR = "spec:" + specKey(CLEAR, AX), K_BLUE = "spec:" + specKey(BLUE, AX), K_CAP = "spec:" + specKey(CAP, "ขนาด,สี");
const screenedKeyOf = id => K_CLEAR + "|งานสกรีน:" + id + "|สกรีน น้ำเงิน";

/** โลกเดียวทั้งโรงงาน: พนักงานทุกบทบาท (ตั๋วจริง) · ทะเบียนสินค้า+เครื่อง · ราคาตั้งโดยประธาน */
async function factory(opt) {
  const W = world(opt);
  const T = {
    boss: await W.staff("S9", "หัวหน้า", ["exec"]), office: await W.staff("S1", "แอน", ["office"]),
    screen: await W.staff("S4", "จอย", ["screen"]), deliver: await W.staff("S5", "ต่อ", ["deliver"]), acc: await W.staff("S6", "ฝ้าย", ["account"]),
  };
  T.prodDevice = await W.staff("S2", "เปา", ["prod"]);   // มือถือหน้าเครื่อง (ตั๋วประจำเครื่อง — ดูได้ บันทึกไม่ได้)
  await W.staff("S3", "เอ็ม", ["prod"]);
  for (const s of ["ref:products", "ref:machines"]) assert.equal((await W.call(T.boss, "import.run", { source: s })).ok, true, s);
  const gate = (id, nick) => W.ticket(id, nick, ["prod"], "1234", { k: "g", exp: W.clock.now + 5 * 60000 });   // PIN ตอนกดบันทึก
  const F = {
    W, T,
    call: async (who, action, input, more) => W.call(T[who], action, input, more),
    ok: async (who, action, input, more) => {
      const r = await W.call(T[who], action, input, more);
      assert.equal(r.status, 200, action + " → " + JSON.stringify(r.error));
      return r;
    },
    /** ทีมผลิต: ทุกปุ่มบันทึกใส่ PIN (ตั๋ว 5 นาที) — คนบันทึก = คนใส่ PIN */
    prod: async (action, input, more, who) => W.call(await gate(...(who || ["S2", "เปา"])), action, input, Object.assign({ as: "prod" }, more || {})),
    order: id => W.one("SELECT * FROM orders WHERE id = ?", id),
    items: id => W.q("SELECT * FROM order_items WHERE order_id = ? ORDER BY line_no", id),
    jobs: id => W.q("SELECT j.* FROM production_jobs j JOIN order_items i ON i.id = j.order_item_id WHERE j.order_id = ? ORDER BY i.line_no, j.rowid", id),
    sjobs: id => W.q("SELECT * FROM screen_jobs WHERE order_id = ?", id),
    bal: (key, g) => (W.one("SELECT qty_pcs FROM stock_balance WHERE item_key = ? AND grade = ?", key, g || "A") || { qty_pcs: 0 }).qty_pcs,
    openFlags: kind => W.q("SELECT * FROM flags WHERE status = 'เปิด'" + (kind ? " AND kind = ?" : "") + " ORDER BY at, id", ...(kind ? [kind] : [])),
  };
  // ราคาตั้ง: ประธานตั้งผ่านบอร์ด (ลงประวัติราคาทุกครั้ง) — ออฟฟิศอ่านตอนลงออเดอร์
  for (const [it, satang] of [[CLEAR, 150], [BLUE, 150]]) await F.ok("boss", "price.set", { item_key: "spec:" + [it.type, it.size, it.neck, it.shape, it.color].join("|"), kind: "ราคาโรงงาน", satang }, { reason: "ตั้งราคาเริ่มต้น" });
  return F;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
test("ทั้งวง: ลูกค้าใหม่สั่ง ขวดสกรีน + ขวดเปล่า + ฝา → ผลิต → สกรีน → ส่ง (บางส่วน/ไม่ได้/ครบ) → บิล → ผูกเลข → รับเงิน → ธงถึงประธาน", async () => {
  const F = await factory();
  const { W } = F;

  // ── 1) ออฟฟิศลงออเดอร์ลูกค้าใหม่ (ส่งเข้าคิวเลย) ─────────────────────────────────────
  const cr = await F.ok("office", "office.order_create", {
    new_customer: { name: "ร้านน้ำดื่มสมมติ ทดลอง", district: "เมือง", phone: "080-000-0000" }, brand: "น้ำใสทดลอง",
    due_day: "2026-11-18", purchase_type: "ขายราคาโรงงาน", pay_status: "ทำได้เลย", design_status: "แบบผ่านแล้ว", queue: true,
    items: [
      { ...CLEAR, screen_color: "น้ำเงิน", bags: 10, price_satang: 150 },   // 2,000 ใบ สกรีนน้ำเงิน
      { ...BLUE, bags: 5, price_satang: 150 },                              // 1,000 ใบ ขวดเปล่าสีน้ำเงิน
      { ...CAP, qty_pcs: 3000, price_satang: 40 },                          // ฝา 3,000 ชิ้น (ซื้อมาขาย — โรงงานไม่ได้ผลิต)
    ],
  });
  const OID = cr.data.id;
  const [I1, I2, I3] = F.items(OID);
  const K_SCREEN = screenedKeyOf(I1.id);
  assert.deepEqual([I1.qty_pcs, I2.qty_pcs, I3.qty_pcs], [2000, 1000, 3000]);
  assert.equal(F.order(OID).customer_text, "ร้านน้ำดื่มสมมติ ทดลอง");
  assert.equal(F.order(OID).total_satang, 2000 * 150 + 1000 * 150 + 3000 * 40);
  // ฝาไม่มีเครื่องผลิต → ไม่เข้าคิวผลิต (ใช้ของในสต๊อก) · ขวด = งานผลิต · ขวดสกรีน = งานสกรีนด้วย
  assert.deepEqual(F.jobs(OID).map(j => j.order_item_id), [I1.id, I2.id], "งานผลิตเฉพาะของที่โรงงานผลิตได้");
  assert.equal(I3.source === "สต๊อก" || F.items(OID)[2].source === "สต๊อก", true, "ฝา = ใช้ของในสต๊อก");
  assert.equal(F.sjobs(OID).length, 1);
  assert.equal(F.order(OID).status, "รอผลิต");
  const pj = (await F.ok("office", "prod.jobs", {})).data.jobs.filter(j => j.order === OID);
  assert.deepEqual(pj.map(j => j.type), ["ขวด", "ขวด"], "คิวทีมผลิตไม่มีฝา");
  const [J1, J2] = F.jobs(OID);

  // ── 2) ทีมผลิต: เปิดรอบ (ผูกงานขวดใส) · จอด → เดินต่อ · เปลี่ยนสี (ใส → น้ำเงิน) · ปิดรอบ ──────────────
  const viaDevice = await W.call(F.T.prodDevice, "run.open", { machine: "PET1", ...CLEAR, crew: ["เปา"], job: J1.id }, { as: "prod" });
  assert.equal(viaDevice.status, 401, "ตั๋วประจำเครื่องบันทึกไม่ได้ ต้องใส่ PIN");
  const op = await F.prod("run.open", { machine: "PET1", ...CLEAR, crew: ["เปา", "เอ็ม"], job: J1.id });
  assert.equal(op.status, 200, JSON.stringify(op.error));
  assert.equal(F.order(OID).status, "กำลังผลิต");
  assert.equal(W.one("SELECT opened_by FROM machine_runs WHERE id = ?", op.data.id).opened_by, "S2");
  // เครื่องเดิน: หน้าประธานกับแผนผังทีมผลิตต้องเป็นเลขเดียวกัน (12 เครื่องที่นับ)
  const fsum = (await F.ok("office", "prod.floor", {})).data.summary, em = (await F.ok("boss", "home.exec", {})).data.machines;
  assert.deepEqual([em.running, em.total], [fsum.running, fsum.total]); assert.deepEqual([em.running, em.total], [1, 12]);
  W.tick(H);
  const st = await F.prod("run.stop", { machine: "PET1" }, { reason: "ไฟดับ" }, ["S3", "เอ็ม"]);
  assert.equal(st.status, 200, JSON.stringify(st.error));
  assert.equal((await F.ok("office", "prod.floor", {})).data.machines.find(m => m.id === "PET1").state, "จอด");
  W.tick(H / 2);
  const ev = W.one("SELECT * FROM machine_events WHERE id = ?", st.data.id);
  assert.equal((await F.prod("run.resume", { event: ev.id, version: ev.version })).status, 200);
  W.tick(3 * H);
  let run = W.one("SELECT * FROM machine_runs WHERE id = ?", op.data.id);
  const col = await F.prod("run.color", { run: run.id, version: run.version, color: "น้ำเงิน", good: 2000, b: 0, waste: 15 });
  assert.equal(col.status, 200, JSON.stringify(col.error));
  // ช่วงสีใหม่ (ขวดน้ำเงิน) ต้องไม่นับเข้างานขวดใส — สเปกต่างกัน
  const seg2 = W.one("SELECT * FROM machine_runs WHERE id = ?", col.data.id);
  assert.equal(seg2.spec_key, specKey(BLUE, AX));
  assert.notEqual(seg2.job_id, J1.id, "เปลี่ยนสีแล้วรอบใหม่ไม่ผูกงานสีเดิม");
  assert.equal(F.bal(K_CLEAR), 2000);
  // ผูกช่วงสีน้ำเงินกับงานขวดน้ำเงินของออเดอร์เดียวกัน
  const ln = await F.prod("run.link", { run: seg2.id, version: seg2.version, job: J2.id });
  assert.equal(ln.status, 200, JSON.stringify(ln.error));
  W.tick(2 * H);
  run = W.one("SELECT * FROM machine_runs WHERE id = ?", seg2.id);
  const cl = await F.prod("run.close", { run: run.id, version: run.version, good: 1000, b: 60, waste: 8 }, {}, ["S3", "เอ็ม"]);
  assert.equal(cl.status, 200, JSON.stringify(cl.error));
  assert.equal(W.one("SELECT closed_by FROM machine_runs WHERE id = ?", run.id).closed_by, "S3", "คนปิด = คนใส่ PIN");
  assert.deepEqual([F.bal(K_CLEAR), F.bal(K_BLUE), F.bal(K_BLUE, "B")], [2000, 1000, 60], "สต๊อก A/B ขยับตามรอบ");
  assert.deepEqual(F.jobs(OID).map(j => j.good_pcs), [2000, 1000], "ยอดทำแล้วของงานตามรอบที่ผูก");
  for (const j of F.jobs(OID)) assert.equal((await F.prod("job.done", { job: j.id, version: j.version })).status, 200);
  assert.equal(F.order(OID).status, "รอสกรีน");

  // ── 3) สกรีน: จ่ายทีม → เสร็จ (ขวดเปล่าออก ดี+เสีย · ขวดสกรีนเข้า) ─────────────────────────────
  let sj = F.sjobs(OID)[0];
  const sq = (await F.ok("screen", "screen.list", { tab: "queue" })).data.jobs;
  assert.ok(sq.some(j => j.id === sj.id), "งานสกรีนขึ้นคิวทีมสกรีน");
  assert.equal((await F.call("screen", "screen.assign", { id: sj.id, version: sj.version, team: "ทีม 1" })).status, 200);
  assert.equal(F.order(OID).status, "กำลังสกรีน");
  sj = F.sjobs(OID)[0];
  assert.equal((await F.call("screen", "screen.done", { id: sj.id, version: sj.version, good: 1980, waste: 20 })).status, 200);
  assert.deepEqual([F.bal(K_CLEAR), F.bal(K_SCREEN)], [0, 1980], "สกรีนเสร็จ: ขวดเปล่าออก 2,000 · ขวดสกรีนเข้า 1,980");
  assert.equal(F.order(OID).status, "พร้อมส่ง");
  // หน้าสต๊อกออฟฟิศ: ขวดสกรีนเทียบกับกุญแจขวดสกรีน (ไม่ใช่ขวดเปล่า) — ขาดจริง 20 ใบ ไม่ใช่ขาด 2,000
  const ost = (await F.ok("office", "office.stock", {})).data.rows;
  const rs = ost.find(r => r.item_key === K_SCREEN), rp = ost.find(r => r.item_key === K_CLEAR), rb = ost.find(r => r.item_key === K_BLUE);
  assert.deepEqual([rs.a, rs.need, rs.short], [1980, 2000, 20]);
  assert.equal(rp ? rp.need : 0, 0, "ขวดเปล่าไม่ถูกนับว่าต้องส่งซ้ำ");
  assert.deepEqual([rb.a, rb.need, rb.short], [1000, 1000, 0]);

  // ฝาเข้าคลัง (ทีมผลิตรับเข้า — ใส่ PIN + เหตุผล)
  assert.equal((await F.prod("stock.receive", { kind: "spec", ...CAP, qty: 5000 }, { reason: "รับฝาจากผู้ขาย" })).status, 200);
  assert.equal(F.bal(K_CAP), 5000);

  // ── 4) ส่งของ: ขึ้นรถ (ขวดสกรีนได้แค่ 1,980) → ส่งบางส่วน → ส่งไม่ได้ → ส่งครบวันถัดไป ────────────────
  const board = (await F.ok("deliver", "deliver.board", {})).data;
  const stop = board.stops.find(s => s.id === OID);
  assert.ok(stop && stop.ready, "ออเดอร์พร้อมส่งขึ้นหน้าเส้นทาง");
  assert.ok(!JSON.stringify(board).match(/satang|total_|price/), "หน้าเส้นทางไม่มีตัวเลขเงิน");
  const ld = await F.call("deliver", "deliver.load", { order: OID, vehicle: "04", lines: [{ item: I1.id, qty: 1980 }, { item: I2.id, qty: 1000 }, { item: I3.id, qty: 3000 }] });
  assert.equal(ld.status, 200, JSON.stringify(ld.error));
  assert.deepEqual([F.bal(K_SCREEN), F.bal(K_BLUE), F.bal(K_CAP)], [0, 0, 2000], "ขึ้นรถ = ออกจากคลัง (กุญแจตามรายการ)");
  assert.equal(F.order(OID).status, "พร้อมส่ง", "ของบนรถยังไม่นับว่าส่ง");
  W.tick(2 * H);
  const loads = W.q("SELECT * FROM delivery_loads WHERE order_id = ? AND status = 'บนรถ' ORDER BY order_item_id", OID);
  const L = Object.fromEntries(loads.map(l => [l.order_item_id, l]));
  const dn = await F.call("deliver", "deliver.done", { order: OID, loads: [{ id: L[I1.id].id, version: L[I1.id].version }, { id: L[I2.id].id, version: L[I2.id].version, qty: 600 }, { id: L[I3.id].id, version: L[I3.id].version }] });
  assert.equal(dn.status, 200, JSON.stringify(dn.error));
  assert.equal(F.order(OID).status, "ส่งบางส่วน");
  const rest = W.one("SELECT * FROM delivery_loads WHERE order_id = ? AND status = 'บนรถ'", OID);
  assert.equal(rest.qty_pcs, 400, "ที่เหลือ 400 ยังอยู่บนรถ");
  const fl = await F.call("deliver", "deliver.fail", { order: OID, loads: [{ id: rest.id, version: rest.version }] }, { reason: "ร้านปิด" });
  assert.equal(fl.status, 200, JSON.stringify(fl.error));
  assert.equal(F.openFlags("ส่งไม่ได้").length, 1, "ส่งไม่ได้ = ธงทุกทีมเห็น");
  W.tick(D);
  const r2 = W.one("SELECT * FROM delivery_loads WHERE order_id = ? AND status = 'ส่งไม่ได้'", OID);
  assert.equal((await F.call("deliver", "deliver.done", { order: OID, loads: [{ id: r2.id, version: r2.version }] })).status, 200);
  let o = F.order(OID);
  assert.equal(o.status, "ส่งบางส่วน", "ขวดสกรีนยังขาด 20 ใบ");
  assert.deepEqual(F.items(OID).map(i => i.delivered_pcs), [1980, 1000, 3000]);
  // ออฟฟิศคุยลูกค้าแล้ว: ลดขวดสกรีนเหลือ 1,980 (งานผลิตเสร็จแล้ว = ต้องมีเหตุผล + ธงถึงทีมผลิต)
  const its = F.items(OID);
  const upd = { id: OID, version: o.version, customer_id: o.customer_id, brand: o.brand, due_day: o.due_day, purchase_type: o.purchase_type, pay_status: o.pay_status, design_status: o.design_status,
    items: [{ id: its[0].id, ...CLEAR, screen_color: "น้ำเงิน", bags: 9, extra_pcs: 180, price_satang: 150 }, { id: its[1].id, ...BLUE, bags: 5, price_satang: 150 }, { id: its[2].id, ...CAP, qty_pcs: 3000, price_satang: 40 }] };
  const noWhy = await F.call("office", "office.order_update", upd);
  assert.equal(noWhy.status, 400); assert.equal(noWhy.error.code, "need_reason");
  assert.equal((await F.call("office", "office.order_update", upd, { reason: "สกรีนเสีย 20 ลูกค้ารับเท่าที่มี" })).status, 200);
  o = F.order(OID);
  assert.equal(o.status, "ส่งแล้ว"); assert.equal(o.delivered_day, "2026-11-17");
  assert.equal(o.total_satang, 1980 * 150 + 1000 * 150 + 3000 * 40);

  // ── 5) ออฟฟิศออกบิลเครดิต → บัญชีผูกเลขกระดาษ (ไม่ตรง → ส่งออฟฟิศ · ตรง · ซ้ำ) ─────────────────────
  const bl = await F.call("office", "office.bill_create", { order_id: OID, version: o.version, kind: "เครดิต", due_day: "2026-12-17",
    lines: F.items(OID).map(i => ({ item_id: i.id, qty_pcs: i.qty_pcs, price_satang: i.price_satang })) });
  assert.equal(bl.status, 200, JSON.stringify(bl.error));
  const BILL = bl.data.bill_no, TOTAL = bl.data.total_satang;
  assert.equal(TOTAL, o.total_satang, "ยอดบิล = ยอดออเดอร์");
  const todo = (await F.ok("acc", "home.account", {})).data;
  assert.ok(JSON.stringify(todo).includes(BILL), "บิลใหม่ขึ้นงานที่รอตรวจของบัญชี");
  let b = W.one("SELECT * FROM bills WHERE bill_no = ?", BILL);
  const mm = await F.call("acc", "account.link", { bill_no: BILL, version: b.version, paper_no: "5501", paper_satang: TOTAL + 1000 });
  assert.equal(mm.status, 409); assert.equal(mm.error.code, "mismatch");
  assert.equal(W.one("SELECT paper_no FROM bills WHERE bill_no = ?", BILL).paper_no, "", "ยอดไม่ตรง = ไม่ผูก");
  assert.equal((await F.call("acc", "account.mismatch_report", { bill_no: BILL, paper_satang: TOTAL + 1000, paper_no: "5501" })).status, 200);
  assert.equal(F.openFlags("ยอดไม่ตรง").filter(f => f.team === "office").length, 1, "ยอดไม่ตรงส่งถึงออฟฟิศ");
  const lk = await F.call("acc", "account.link", { bill_no: BILL, version: b.version, paper_no: "5501", paper_satang: TOTAL });
  assert.equal(lk.status, 200, JSON.stringify(lk.error));
  assert.equal(W.one("SELECT status FROM bills WHERE bill_no = ?", BILL).status, "ค้างชำระ", "บิลเครดิตผูกเลขแล้วยังค้าง");
  // ออเดอร์ที่สองวันเดียวกัน (ลูกค้ามารับเอง เงินสด) ผูกเลขกระดาษซ้ำ → บอกว่าซ้ำกับใคร · ยืนยันคนละใบ + เหตุผล = ธง
  const c2 = await F.ok("office", "office.order_create", { customer_id: o.customer_id, purchase_type: "ขายราคาโรงงาน", queue: true, sources: ["สต๊อก"], items: [{ ...CAP, qty_pcs: 500, price_satang: 40 }] });
  const O2 = c2.data.id;
  assert.equal(F.order(O2).status, "พร้อมส่ง", "ใช้ของในสต๊อกทั้งใบ = พร้อมส่งทันที");
  const pk = await F.call("office", "office.order_pickup", { id: O2, version: F.order(O2).version, lines: [{ item_id: F.items(O2)[0].id, qty_pcs: 500 }] });
  assert.equal(pk.status, 200, JSON.stringify(pk.error));
  assert.equal(F.order(O2).status, "ส่งแล้ว"); assert.equal(F.bal(K_CAP), 1500);
  const b2 = await F.call("office", "office.bill_create", { order_id: O2, version: F.order(O2).version, kind: "เงินสด", lines: [{ item_id: F.items(O2)[0].id, qty_pcs: 500, price_satang: 40 }] });
  assert.equal(b2.status, 200, JSON.stringify(b2.error));
  const bb2 = W.one("SELECT * FROM bills WHERE bill_no = ?", b2.data.bill_no);
  const dup = await F.call("acc", "account.link", { bill_no: bb2.bill_no, version: bb2.version, paper_no: "5501", paper_satang: 20000, channel: "เงินสด" });
  assert.equal(dup.status, 409); assert.match(dup.error.message, /ร้านน้ำดื่มสมมติ ทดลอง/);
  const noCh = await F.call("acc", "account.link", { bill_no: bb2.bill_no, version: bb2.version, paper_no: "5502", paper_satang: 20000 });
  assert.equal(noCh.status, 400, "บิลเงินสด: ช่องทางรับเงินต้องกดเอง ไม่มีค่าตั้งต้น");
  const dupOk = await F.call("acc", "account.link", { bill_no: bb2.bill_no, version: bb2.version, paper_no: "5501", paper_satang: 20000, channel: "เงินสด", force_dup: true }, { reason: "คนละเล่ม" });
  assert.equal(dupOk.status, 200, JSON.stringify(dupOk.error));
  assert.equal(F.openFlags("เลขบิลซ้ำ").length, 1);
  assert.equal(W.one("SELECT status FROM bills WHERE bill_no = ?", bb2.bill_no).status, "ชำระแล้ว", "บิลเงินสด = รับเงินในตัว");

  // ── 6) รับชำระบิลเครดิต: บางส่วน (เมื่อวาน) → เกิน (บล็อก → รับเท่ายอดค้าง + แจ้งส่วนเกิน) ───────────────────
  b = W.one("SELECT * FROM bills WHERE bill_no = ?", BILL);
  const p1 = await F.call("acc", "account.pay", { items: [{ bill_no: BILL, version: b.version, satang: 200000 }], channel: "โอน KBank", day: "2026-11-16" });
  assert.equal(p1.status, 200, JSON.stringify(p1.error));
  b = W.one("SELECT * FROM bills WHERE bill_no = ?", BILL);
  assert.equal(b.status, "ค้างชำระ"); assert.equal(b.paid_satang, 200000);
  const due = TOTAL - 200000;
  const over = await F.call("acc", "account.pay", { items: [{ bill_no: BILL, version: b.version, satang: due + 5000 }], channel: "โอน KTB", day: "2026-11-17" });
  assert.equal(over.status, 400); assert.equal(over.error.code, "over"); assert.equal(over.error.due_satang, due);
  const full = await F.call("acc", "account.pay", { items: [{ bill_no: BILL, version: b.version, satang: due }], channel: "โอน KTB", day: "2026-11-17", excess_satang: 5000 }, { reason: "ลูกค้าโอนเกิน" });
  assert.equal(full.status, 200, JSON.stringify(full.error));
  b = W.one("SELECT * FROM bills WHERE bill_no = ?", BILL);
  assert.equal(b.status, "ชำระแล้ว"); assert.equal(b.paid_satang, TOTAL); assert.equal(b.paid_day, "2026-11-17");
  // เงินเข้าบัญชีไหน: นับตามวันที่ชำระ (ไม่ใช่วันที่บิล/วันที่กด)
  const m16 = (await F.ok("acc", "account.money", { day: "2026-11-16" })).data;
  assert.deepEqual(m16.byChannel, [{ channel: "โอน KBank", satang: 200000 }]);
  const m17 = (await F.ok("acc", "account.money", { day: "2026-11-17" })).data;
  assert.deepEqual(m17.byChannel, [{ channel: "เงินสด", satang: 20000 }, { channel: "โอน KTB", satang: due }]);
  const mon = (await F.ok("acc", "account.money", { day: "2026-11-17", period: "month" })).data;
  assert.equal(mon.total, TOTAL + 20000, "เดือนนี้ = ทุกการรับ ไม่นับซ้ำ");
  assert.equal((await F.ok("acc", "account.owing", {})).data.total.satang, 0, "ลูกหนี้หมด");
  const sameBoss = (await F.ok("boss", "home.exec", {})).data;
  assert.ok(JSON.stringify(sameBoss).length > 0);

  // ── 7) ประธาน: ธงทุกแบบที่เกิดในวงนี้อยู่ใน "เรื่องที่ต้องตัดสินใจ" และปิดได้ ─────────────────────────────
  const home = (await F.ok("boss", "home.exec", {})).data;
  const kinds = new Set(home.flags.map(f => f.kind));
  for (const k of ["ส่งไม่ได้", "ยอดไม่ตรง", "เลขบิลซ้ำ", "แก้ออเดอร์หลังเริ่มงาน"]) assert.ok(kinds.has(k), "ประธานเห็นธง " + k + " (มี: " + [...kinds].join(", ") + ")");
  assert.equal(home.flags.length, F.openFlags().length, "ทุกธงที่เปิดอยู่ขึ้นหน้าประธาน");
  for (const f of home.flags) {
    const d = await F.ok("boss", "exec.flag_detail", { id: f.id });
    assert.ok(d.data.flag.title);
    assert.equal((await F.call("boss", "flag.resolve", { id: f.id, version: f.version, status: "ปิด", resolution: "ตรวจแล้ว" })).status, 200);
  }
  assert.equal((await F.ok("boss", "home.exec", {})).data.flags.length, 0, "ปิดครบ = ไม่มีเรื่องต้องตัดสินใจ");
  // สต๊อกไม่มีติดลบที่ไม่รู้ตัว
  assert.equal(W.q("SELECT * FROM stock_balance WHERE qty_pcs < 0").length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  เคสย้อน — ย้อนได้จนกว่าขั้นถัดไปรับไป · รับไปแล้ว = บอกตรง ๆ + มีทางแก้ (ไม่มีทางตัน)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
/** ออเดอร์ขวดสกรีน 10 ถุง (2,000 ใบ) ผลิตครบ + จบงานผลิต → รอสกรีน */
async function screenedReady(F, opt) {
  const o = opt || {};
  const cr = await F.ok("office", "office.order_create", { new_customer: { name: o.name || "ร้านทดสอบย้อน" }, purchase_type: "ขายราคาโรงงาน", queue: true, items: [{ ...CLEAR, screen_color: "น้ำเงิน", bags: 10, price_satang: 150 }] });
  const OID = cr.data.id, [J] = F.jobs(OID);
  const op = await F.prod("run.open", { machine: o.machine || "PET2", ...CLEAR, crew: ["เปา"], job: J.id });
  assert.equal(op.status, 200, JSON.stringify(op.error));
  F.W.tick(H);
  const run = F.W.one("SELECT * FROM machine_runs WHERE id = ?", op.data.id);
  const cl = await F.prod("run.close", { run: run.id, version: run.version, good: o.good || 2000 });
  assert.equal(cl.status, 200, JSON.stringify(cl.error));
  return { OID, J, run, close: cl };
}

test("ย้อน: ปิดรอบแล้วของถูกใช้ (สกรีน) = ย้อนไม่ได้ บอกเหตุ → แก้ยอดพร้อมเหตุผลแทน · ย้อนสกรีนเสร็จหลังของขึ้นรถแล้ว = ไม่ได้", async () => {
  const F = await factory();
  const { W } = F;
  const { OID, J, run, close } = await screenedReady(F);
  const K_SCREEN = screenedKeyOf(F.items(OID)[0].id);
  assert.equal(F.bal(K_CLEAR), 2000);
  assert.equal((await F.prod("job.done", { job: J.id, version: F.jobs(OID)[0].version })).status, 200);
  let sj = F.sjobs(OID)[0];
  const sd = await F.call("screen", "screen.done", { id: sj.id, version: sj.version, team: "ทีม 2" });
  assert.equal(sd.status, 200, JSON.stringify(sd.error));
  assert.deepEqual([F.bal(K_CLEAR), F.bal(K_SCREEN)], [0, 2000]);
  // ทีมผลิตกดย้อนการปิดรอบ — ขวดเปล่าถูกเบิกไปสกรีนแล้ว
  const u1 = await F.prod("undo.run", { id: close.undo.id });
  assert.equal(u1.status, 409); assert.match(u1.error.message, /ย้อนไม่ได้/); assert.match(u1.error.message, /แก้ยอด/);
  assert.equal(F.bal(K_CLEAR), 0, "ย้อนไม่ผ่าน = สต๊อกไม่ขยับ");
  // ทางแก้: แก้ยอดรอบ (เหตุผลบังคับ) → ส่วนต่างลงสต๊อก + ยอดงานตาม + ติดลบ = ธง
  const r = W.one("SELECT * FROM machine_runs WHERE id = ?", run.id);
  const fx = await F.prod("run.fix", { run: r.id, version: r.version, good: 1900, b: 0, waste: 100 }, { reason: "นับใหม่ได้ 1,900" });
  assert.equal(fx.status, 200, JSON.stringify(fx.error));
  assert.equal(F.bal(K_CLEAR), -100); assert.equal(F.openFlags("สต๊อกติดลบ").length, 1);
  assert.equal(F.jobs(OID)[0].good_pcs, 1900);
  // ขวดสกรีนขึ้นรถแล้ว → ย้อน "สกรีนเสร็จ" ต้องไม่ได้ (ไม่งั้นสต๊อกขวดสกรีนติดลบทั้งที่ของอยู่บนรถ)
  const ld = await F.call("deliver", "deliver.load", { order: OID, vehicle: "05", lines: [{ item: F.items(OID)[0].id, qty: 2000 }] });
  assert.equal(ld.status, 200, JSON.stringify(ld.error));
  assert.equal(F.bal(K_SCREEN), 0);
  const u2 = await F.call("screen", "undo.run", { id: sd.undo.id });
  assert.equal(u2.status, 409, "ขวดสกรีนถูกใช้ไปแล้ว ย้อนสกรีนไม่ได้: " + JSON.stringify(u2.error));
  assert.match(u2.error.message, /ลงจำนวน/, "บอกทางแก้ของทีมสกรีน");
  assert.equal(F.bal(K_SCREEN), 0); assert.equal(F.sjobs(OID)[0].status, "เสร็จแล้ว");
  // ของยังไม่ถูกใช้ = ย้อนได้ตามปกติ (ย้อนขึ้นรถก่อน แล้วค่อยย้อนสกรีน)
  assert.equal((await F.call("deliver", "undo.run", { id: ld.undo.id })).status, 200);
  assert.equal(F.bal(K_SCREEN), 2000);
  const u3 = await F.call("screen", "undo.run", { id: sd.undo.id });
  assert.equal(u3.status, 200, JSON.stringify(u3.error));
  assert.deepEqual([F.bal(K_CLEAR), F.bal(K_SCREEN)], [1900, 0]);
  assert.equal(F.order(OID).status, "รอสกรีน");
});

test("ย้อน: ส่งแล้ว (บางส่วน/ครบ) → ของกลับขึ้นรถ · ตัวนับรายการ · สถานะออเดอร์ · วันส่งแล้ว ถอยครบ · ส่งแล้วออกบิลแล้ว = ยังย้อนส่งได้ไหม (ต้องไม่ทำให้บิลค้างลอย)", async () => {
  const F = await factory();
  const { W } = F;
  const { OID, J } = await screenedReady(F, { machine: "PET3" });
  await F.prod("job.done", { job: J.id, version: F.jobs(OID)[0].version });
  let sj = F.sjobs(OID)[0];
  await F.call("screen", "screen.assign", { id: sj.id, version: sj.version, team: "ทีม 1" });
  sj = F.sjobs(OID)[0];
  await F.call("screen", "screen.done", { id: sj.id, version: sj.version });
  const [it] = F.items(OID);
  await F.ok("deliver", "deliver.load", { order: OID, vehicle: "04", lines: [{ item: it.id, qty: 2000 }] });
  const l = W.one("SELECT * FROM delivery_loads WHERE order_id = ? AND status = 'บนรถ'", OID);
  const before = JSON.stringify([F.order(OID).status, F.items(OID).map(i => [i.delivered_pcs, i.onboard_pcs])]);
  const part = await F.ok("deliver", "deliver.done", { order: OID, loads: [{ id: l.id, version: l.version, qty: 1200 }] });
  assert.equal(F.order(OID).status, "ส่งบางส่วน");
  assert.equal((await F.call("deliver", "undo.run", { id: part.undo.id })).status, 200);
  assert.equal(JSON.stringify([F.order(OID).status, F.items(OID).map(i => [i.delivered_pcs, i.onboard_pcs])]), before, "ย้อนส่งบางส่วน = กลับเหมือนก่อนส่ง");
  assert.equal(W.q("SELECT * FROM delivery_loads WHERE order_id = ? AND status = 'บนรถ'", OID).reduce((s, x) => s + x.qty_pcs, 0), 2000, "ของกลับขึ้นรถครบ ไม่มีแถวลอย");
  const l2 = W.one("SELECT * FROM delivery_loads WHERE order_id = ? AND status = 'บนรถ'", OID);
  const fullDone = await F.ok("deliver", "deliver.done", { order: OID, loads: [{ id: l2.id, version: l2.version }] });
  let o = F.order(OID);
  assert.equal(o.status, "ส่งแล้ว"); assert.equal(o.delivered_day, "2026-11-16");
  assert.equal((await F.call("deliver", "undo.run", { id: fullDone.undo.id })).status, 200);
  o = F.order(OID);
  assert.equal(o.status, "พร้อมส่ง"); assert.equal(o.delivered_day, "", "ย้อนส่งแล้ว = ล้างวันส่งแล้ว");
  assert.equal(F.bal(screenedKeyOf(F.items(OID)[0].id)), 0, "ย้อนส่ง ≠ คืนคลัง (ของยังอยู่บนรถ)");
  // ส่งใหม่ → ออฟฟิศออกบิล → ย้อนการส่งต้องไม่ได้ (ขั้นถัดไปรับไปแล้ว) — ไม่งั้นมีบิลของที่ระบบบอกว่ายังไม่ได้ส่ง
  const l3 = W.one("SELECT * FROM delivery_loads WHERE order_id = ? AND status = 'บนรถ'", OID);
  const again = await F.ok("deliver", "deliver.done", { order: OID, loads: [{ id: l3.id, version: l3.version }] });
  o = F.order(OID);
  await F.ok("office", "office.bill_create", { order_id: OID, version: o.version, kind: "เงินสด", lines: [{ item_id: it.id, qty_pcs: 2000, price_satang: 150 }] });
  const late = await F.call("deliver", "undo.run", { id: again.undo.id });
  assert.equal(late.status, 409, "ออกบิลแล้ว ย้อนส่งไม่ได้: " + JSON.stringify(late.error));
  assert.match(late.error.message, /บิล/);
  assert.equal(F.order(OID).status, "ส่งแล้ว");
});

test("ยกเลิกออเดอร์หลังผลิตไปบางส่วน: งานผลิต/สกรีนปิด · ของที่ผลิตแล้วอยู่ในสต๊อก · ธงถึงทีมผลิต · หายจากคิวทุกทีม · รอบที่ยังเดินปิดได้ไม่พัง", async () => {
  const F = await factory();
  const { W } = F;
  const cr = await F.ok("office", "office.order_create", { new_customer: { name: "ร้านยกเลิกทดสอบ" }, purchase_type: "ขายราคาโรงงาน", queue: true, due_day: "2026-11-17",
    items: [{ ...CLEAR, screen_color: "แดง", bags: 10, price_satang: 150 }, { ...BLUE, bags: 5, price_satang: 150 }] });
  const OID = cr.data.id;
  const [J1, J2] = F.jobs(OID);
  const op1 = await F.prod("run.open", { machine: "PET4", ...CLEAR, crew: ["เปา"], job: J1.id });
  W.tick(H);
  let r1 = W.one("SELECT * FROM machine_runs WHERE id = ?", op1.data.id);
  assert.equal((await F.prod("run.close", { run: r1.id, version: r1.version, good: 800 })).status, 200);
  const op2 = await F.prod("run.open", { machine: "PET5", ...BLUE, crew: ["เอ็ม"], job: J2.id }, {}, ["S3", "เอ็ม"]);
  assert.equal(op2.status, 200, JSON.stringify(op2.error));
  assert.equal(F.order(OID).status, "กำลังผลิต");
  const o = F.order(OID);
  const noWhy = await F.call("office", "office.order_cancel", { id: OID, version: o.version });
  assert.equal(noWhy.status, 400, "ยกเลิกต้องมีเหตุผล");
  assert.equal((await F.call("office", "office.order_cancel", { id: OID, version: o.version }, { reason: "ลูกค้ายกเลิก" })).status, 200);
  assert.equal(F.order(OID).status, "ยกเลิก");
  assert.deepEqual(F.jobs(OID).map(j => j.status), ["ยกเลิก", "ยกเลิก"]);
  assert.equal(F.sjobs(OID)[0].status, "ยกเลิก");
  assert.equal(F.bal(K_CLEAR), 800, "ของที่ผลิตแล้วอยู่ในสต๊อก");
  const fl = F.openFlags("แก้ออเดอร์หลังเริ่มงาน");
  assert.equal(fl.length, 1); assert.equal(fl[0].team, "prod");
  assert.ok(!(await F.ok("office", "prod.jobs", {})).data.jobs.some(j => j.order === OID && j.status !== "เสร็จ"), "ไม่อยู่ในคิวทีมผลิต");
  assert.ok(!(await F.ok("screen", "screen.list", { tab: "queue" })).data.jobs.some(j => j.order_id === OID), "ไม่อยู่ในคิวสกรีน");
  assert.ok(!(await F.ok("deliver", "deliver.board", {})).data.stops.some(s => s.id === OID), "ไม่อยู่ในหน้าเส้นทาง");
  // เครื่องที่ยังเดินงานของออเดอร์ที่ยกเลิก: ปิดรอบได้ ของเข้าสต๊อก · สถานะออเดอร์ยังยกเลิก · แผนผังไม่บอกว่ายังผูกงาน
  const floor = (await F.ok("office", "prod.floor", {})).data.machines.find(m => m.id === "PET5");
  assert.equal(floor.run.job_id, null, "งานถูกยกเลิก = แผนผังไม่โชว์ว่าผูกงาน");
  W.tick(H);
  const r2 = W.one("SELECT * FROM machine_runs WHERE id = ?", op2.data.id);
  const c2 = await F.prod("run.close", { run: r2.id, version: r2.version, good: 400 });
  assert.equal(c2.status, 200, JSON.stringify(c2.error));
  assert.equal(F.bal(K_BLUE), 400);
  assert.equal(F.order(OID).status, "ยกเลิก");
  // ออเดอร์ยกเลิกแล้ว: สกรีน/ขึ้นรถ/ออกบิล ไม่ได้ (บอกเหตุ)
  const sj = F.sjobs(OID)[0];
  assert.equal((await F.call("screen", "screen.done", { id: sj.id, version: sj.version })).status, 409);
  assert.equal((await F.call("deliver", "deliver.load", { order: OID, vehicle: "04", lines: [{ item: F.items(OID)[0].id, qty: 100 }] })).status, 409);
  assert.equal((await F.call("office", "office.bill_create", { order_id: OID, version: F.order(OID).version, kind: "เงินสด", lines: [{ item_id: F.items(OID)[0].id, qty_pcs: 1, price_satang: 1 }] })).status, 409);
});

test("ลูกค้ามารับเอง แล้วออฟฟิศออกบิล → ย้อนการรับไม่ได้ (บอกให้ยกเลิกบิลก่อน) · ยกเลิกบิลแล้วย้อนได้ สต๊อกคืน", async () => {
  const F = await factory();
  await F.prod("stock.receive", { kind: "spec", ...CAP, qty: 1000 }, { reason: "รับฝาจากผู้ขาย" });
  const c = await F.ok("office", "office.order_create", { new_customer: { name: "ร้านมารับเอง" }, purchase_type: "ขายราคาโรงงาน", queue: true, items: [{ ...CAP, qty_pcs: 600, price_satang: 40 }] });
  const OID = c.data.id, [it] = F.items(OID);
  const pk = await F.ok("office", "office.order_pickup", { id: OID, version: F.order(OID).version, lines: [{ item_id: it.id, qty_pcs: 600 }] });
  assert.equal(F.bal(K_CAP), 400);
  const bl = await F.ok("office", "office.bill_create", { order_id: OID, version: F.order(OID).version, kind: "เงินสด", lines: [{ item_id: it.id, qty_pcs: 600, price_satang: 40 }] });
  const u = await F.call("office", "undo.run", { id: pk.undo.id });
  assert.equal(u.status, 409); assert.match(u.error.message, /ยกเลิกบิลก่อน/);
  const b = F.W.one("SELECT * FROM bills WHERE bill_no = ?", bl.data.bill_no);
  await F.ok("office", "office.bill_cancel", { bill_no: b.bill_no, version: b.version }, { reason: "ออกบิลผิด" });
  assert.equal((await F.call("office", "undo.run", { id: pk.undo.id })).status, 200);
  assert.equal(F.bal(K_CAP), 1000); assert.equal(F.order(OID).status, "พร้อมส่ง");
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  สิทธิ์ข้ามบทบาท — กรองที่เซิร์ฟเวอร์ (หน้าจอซ่อนอย่างเดียวไม่พอ)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
test("สิทธิ์: ทีมที่ไม่เกี่ยวกับเงินไม่เห็นตัวเลขเงินในทุกหน้าที่เปิดได้ · ทำงานของทีมอื่นไม่ได้ · ทีมผลิตทุกปุ่มบันทึกต้อง PIN · ประธานทำแทนได้มีชื่อจริง", async () => {
  const F = await factory();
  const { W, T } = F;
  // มีของจริงในระบบทุกขั้น: ออเดอร์มีราคา + บิล + รับเงิน
  const { OID, J } = await screenedReady(F, { machine: "PET6" });
  await F.prod("job.done", { job: J.id, version: F.jobs(OID)[0].version });
  const o = F.order(OID);
  const bl = await F.ok("office", "office.bill_create", { order_id: OID, version: o.version, kind: "เครดิต", due_day: "2026-12-01", lines: [{ item_id: F.items(OID)[0].id, qty_pcs: 2000, price_satang: 150 }] });
  const bb = W.one("SELECT * FROM bills WHERE bill_no = ?", bl.data.bill_no);
  await F.ok("acc", "account.pay", { items: [{ bill_no: bb.bill_no, version: bb.version, satang: 100000 }], channel: "เงินสด", day: "2026-11-16" });
  // เงิน = ช่องตัวเลขที่ชื่อเป็นเงิน หรือข้อความมี "฿ตัวเลข" (ชื่อหมวดคำอย่าง prices.kind ในคลังค่าไม่ใช่ตัวเลขเงิน)
  const moneyIn = data => { const hit = []; const walk = (v, k) => { if (Array.isArray(v)) v.forEach(x => walk(x, k)); else if (v && typeof v === "object") Object.entries(v).forEach(([kk, x]) => walk(x, kk));
    else if (typeof v === "number" && /satang|amount|^paid|price/i.test(k || "")) hit.push(k + "=" + v); else if (typeof v === "string" && /฿\s?\d/.test(v)) hit.push(k + ":" + v); }; walk(data, ""); return hit; };
  // ทุก action อ่านที่ทีมผลิต/สกรีน/ส่งของเปิดได้ → ไม่มีตัวเลขเงินหลุด
  const reads = W.registry.list().filter(d => !d.write && !d.public);
  for (const role of ["prod", "screen", "deliver"]) {
    const tk = role === "prod" ? T.prodDevice : T[role];
    for (const d of reads.filter(x => x.roles.indexOf(role) >= 0)) {
      const input = { "prod.machine": { id: "PET6" }, "prod.run": { id: W.one("SELECT id FROM machine_runs LIMIT 1").id }, "deliver.doc": { order: OID }, "prod.specs": { machine: "PET6" } }[d.name] || {};
      const r = await W.call(tk, d.name, input, { as: role });
      if (r.status !== 200) { assert.ok([400, 404].indexOf(r.status) >= 0, role + " " + d.name + " → " + r.status + " " + JSON.stringify(r.error)); continue; }
      assert.deepEqual(moneyIn(r.data), [], role + " เห็นเงินใน " + d.name);
    }
  }
  // action เงินทุกตัว (บัญชี+ประธานเท่านั้น) = 403 สำหรับทุกทีมอื่น แม้แอบส่ง as=account
  const moneyActs = W.registry.list().filter(d => d.roles && d.roles.every(r => r === "account" || r === "exec") && d.roles.indexOf("account") >= 0);
  assert.ok(moneyActs.length >= 15);
  for (const who of ["office", "screen", "deliver", "prodDevice"]) for (const d of moneyActs) {
    const r1 = await W.call(T[who], d.name, {}, d.write ? {} : {});
    const r2 = await W.call(T[who], d.name, {}, { as: "account" });
    assert.equal(r1.status, 403, who + " เรียก " + d.name); assert.equal(r2.status, 403, who + " ปลอม as=account เรียก " + d.name);
  }
  // ทีมทำงานข้ามทีมไม่ได้ (เขียน)
  const sj = F.sjobs(OID)[0];
  for (const [who, action, input] of [
    ["deliver", "screen.done", { id: sj.id, version: sj.version }], ["screen", "deliver.load", { order: OID, vehicle: "04", lines: [{ item: "x", qty: 1 }] }],
    ["acc", "office.order_create", { customer_id: "x", items: [{ ...CLEAR, bags: 1 }] }], ["office", "run.open", { machine: "PET1", ...CLEAR, crew: ["เปา"] }],
    ["screen", "price.set", { item_key: K_CLEAR, kind: "ราคาโรงงาน", satang: 1 }], ["office", "flag.resolve", { id: "x", version: 1 }], ["deliver", "account.pay", {}],
    ["acc", "run.close", { run: "x", version: 1, good: 1 }], ["prodDevice", "office.bill_create", { order_id: OID, version: 1, kind: "เงินสด", lines: [{ item_id: "x", qty_pcs: 1, price_satang: 1 }] }],
  ]) assert.equal((await W.call(T[who], action, input)).status, 403, who + " ทำ " + action + " ไม่ได้");
  // ทีมผลิต: ทุก action ที่มี gate ต้องใช้ตั๋วจาก PIN ตอนกด — ตั๋วประจำเครื่องได้ 401 need_pin ก่อนจะถึงเนื้องาน
  const gated = W.registry.list().filter(d => d.gate && d.roles.includes("prod"));   // ทีมอื่นที่ติด gate (ประกาศแผนสายส่ง) ตรวจใน route-plan.test.mjs
  assert.ok(gated.length >= 12, "ปุ่มบันทึกของทีมผลิตติด gate ครบ");
  for (const d of gated) {
    const r = await W.call(T.prodDevice, d.name, {}, { as: "prod" });
    assert.equal(r.status, 401, d.name); assert.equal(r.error.code, "need_pin", d.name);
  }
  assert.ok(W.registry.list().filter(d => d.write && d.roles.length === 1 && d.roles[0] === "prod").every(d => d.gate), "เขียนของทีมผลิตทุกตัวต้อง PIN");
  // ประธานทำแทนทีมผลิตได้ (ใส่ PIN ของตัวเอง) — คนทำ = ประธานจากตั๋ว · audit จดบทบาทที่ใช้
  const bossGate = await W.ticket("S9", "หัวหน้า", ["exec"], "1234", { k: "g", exp: W.clock.now + 60000 });
  const op = await W.call(bossGate, "run.open", { machine: "PET7", ...BLUE, crew: ["เปา"], opened_by: "S2" }, { as: "prod" });
  assert.equal(op.status, 200, JSON.stringify(op.error));
  assert.equal(W.one("SELECT opened_by FROM machine_runs WHERE id = ?", op.data.id).opened_by, "S9", "ชื่อคนทำมาจากตั๋ว ไม่เชื่อหน้าเว็บ");
  assert.equal(W.one("SELECT role FROM audit_log WHERE action = 'run.open' ORDER BY id DESC LIMIT 1").role, "prod");
  // คนที่ถูกพักงาน: ตั๋วเดิมใช้ไม่ได้ทันทีที่ฐานรู้
  W.d1.raw.prepare("UPDATE staff SET status = 'พัก' WHERE id = 'S5'").run();
  assert.equal((await W.call(T.deliver, "deliver.board", {})).status, 401);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  ซิงก์ชีตเดิมซ้ำ (ช่วงเปลี่ยนผ่าน) — ทุกแหล่งพร้อมกัน ผ่านสะพาน GAS ตัวจริง (ชีตจำลองตั้งอ่านอย่างเดียว เขียน = เทสต์ล้ม)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
test("ซิงก์ทุกแหล่งซ้ำ 3 รอบ (วันละครั้ง): ไม่เบิ้ล · ไม่ทับของที่แก้ใน v2 (ลูกค้า · ออเดอร์เก่า · รอบค้างที่ปิดใน v2 · บิลในแอป) · ไม่เขียนกลับชีต", async () => {
  const SRC = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "gas", "Code.gs"), "utf8");
  const G = loadGas(SRC, { now: T0 });
  seedGas(G);
  const gasFetch = async url => { const p = Object.fromEntries(new URL(url).searchParams.entries()); G.setNow(W.clock.now); return new Response(JSON.stringify(G.call(p.action, p)), { headers: { "content-type": "application/json" } }); };
  const W = world({ now: T0, fetch: gasFetch, env: { PK_TICKET_KEY: G.ctx.v2Key_("ticket"), PK_SYNC_KEY: G.ctx.v2Key_("sync"), PK_GAS_URL: "https://gas.test/exec" } });
  const boss = G.call("pkV2Ticket", {}, { sid: "S004", pin: "4444" }).ticket;
  const office = G.call("pkV2Ticket", {}, { sid: "S001", pin: "1111" }).ticket;
  const SOURCES = ["ref:products", "ref:machines", "staff", "legacy:customer", "pk:Customers", "legacy:order", "legacy:stock:ProductionLog", "acct"];
  const syncAll = async () => {
    const out = {};
    for (const source of SOURCES) {
      let cursor = "0", run = "", last, pages = 0;
      const agg = { inserted: 0, updated: 0, problems: [] };
      do {
        last = await W.call(boss, "import.run", { source, cursor, run, limit: 3 });
        assert.equal(last.status, 200, source + ": " + JSON.stringify(last.error));
        run = last.data.run; cursor = last.data.next; pages++;
        agg.inserted += last.data.page.inserted || 0; agg.updated += last.data.page.updated || 0; agg.problems.push(...(last.data.problems || []));
      } while (cursor !== null && pages < 60);
      out[source] = agg;
    }
    return out;
  };
  const counts = () => Object.fromEntries(["customers", "orders", "order_items", "machine_runs", "run_crew", "bills", "stock_moves", "staff", "production_jobs", "screen_jobs"].map(t => [t, W.one("SELECT count(*) AS n FROM " + t).n]));
  const first = await syncAll();
  assert.ok(first["legacy:order"].inserted > 0 && first.acct.inserted > 0 && first["legacy:stock:ProductionLog"].inserted > 0, JSON.stringify(first));
  const c1 = counts();
  assert.equal(c1.stock_moves, 0, "นำเข้าประวัติไม่แตะสต๊อก"); assert.equal(c1.production_jobs + c1.screen_jobs, 0, "ไม่สร้างงานจากออเดอร์เก่า");

  // ── แก้ใน v2 ระหว่างทาง ──
  const custB = W.one("SELECT * FROM customers WHERE name = 'ร้านตัวอย่าง ข'");
  const cu = await W.call(office, "office.customer_update", { id: custB.id, version: custB.version, name: custB.name, route_code: custB.route_code, district: custB.district, phone: "089-999-9999", note: "แก้ในแอปใหม่" });
  assert.equal(cu.status, 200, JSON.stringify(cu.error));
  const lo = W.one("SELECT * FROM orders WHERE src LIKE 'legacy%' AND status NOT IN ('ส่งแล้ว','ยกเลิก') ORDER BY order_day LIMIT 1") || W.one("SELECT * FROM orders WHERE src LIKE 'legacy%' LIMIT 1");
  const loItems = W.q("SELECT * FROM order_items WHERE order_id = ? ORDER BY line_no", lo.id);
  const lu = await W.call(office, "office.order_update", { id: lo.id, version: lo.version, customer_id: lo.customer_id, brand: "แก้ในแอปใหม่", due_day: "", urgent: lo.urgent, purchase_type: lo.purchase_type,
    price_mode: lo.price_mode, pay_status: lo.pay_status, design_status: lo.design_status, note: lo.note,
    items: loItems.map(i => ({ id: i.id, type: i.type, size: i.size, neck: i.neck, shape: i.shape, color: i.color, screen_color: i.screen_color, cap_color: i.cap_color, bags: i.bags, extra_pcs: i.extra_pcs, qty_pcs: i.qty_pcs, price_satang: i.price_satang, price_reason: i.price_reason })) });
  assert.equal(lu.status, 200, JSON.stringify(lu.error));
  const stuck = W.one("SELECT * FROM machine_runs WHERE status = 'ค้างจากระบบเดิม' LIMIT 1");
  assert.ok(stuck, "มีรอบค้างจากแอปเดิม");
  const prodPf = W.one("SELECT pin_fp FROM staff WHERE id = 'S002'").pin_fp;
  const gate = await issueTicket(G.ctx.v2Key_("ticket"), { k: "g", sid: "S002", n: "บี", r: ["prod"], pf: prodPf, iat: W.clock.now, exp: W.clock.now + 5 * 60000 });
  const rc = await W.call(gate, "run.close", { run: stuck.id, version: stuck.version, good: 7777, ended_at: new Date(Date.parse(stuck.started_at) + 8 * H).toISOString() }, { as: "prod", reason: "ลืมปิดในแอปเดิม" });
  assert.equal(rc.status, 200, JSON.stringify(rc.error));
  const cA = W.one("SELECT * FROM customers WHERE name LIKE 'ร้านตัวอย่าง ก%'");
  const vo = await W.call(office, "office.order_create", { customer_id: cA.id, purchase_type: "ขายราคาโรงงาน", queue: true, sources: ["สต๊อก"], items: [{ ...CAP, qty_pcs: 100, price_satang: 40 }] });
  assert.equal(vo.status, 200, JSON.stringify(vo.error));
  const vb = await W.call(office, "office.bill_create", { order_id: vo.data.id, version: W.one("SELECT version FROM orders WHERE id = ?", vo.data.id).version, kind: "เงินสด", lines: [{ item_id: vo.data.id + "-1", qty_pcs: 100, price_satang: 40 }] });
  assert.equal(vb.status, 200, JSON.stringify(vb.error));
  const keep = () => JSON.stringify({
    cust: W.one("SELECT phone, note, version FROM customers WHERE id = ?", custB.id), legacyOrder: W.one("SELECT brand, due_day, version FROM orders WHERE id = ?", lo.id),
    run: W.one("SELECT status, good_pcs, version FROM machine_runs WHERE id = ?", stuck.id), bill: W.one("SELECT total_satang, status, src, version FROM bills WHERE bill_no = ?", vb.data.bill_no),
    vorder: W.one("SELECT status, version FROM orders WHERE id = ?", vo.data.id),
  });
  const kept = keep(), c2 = counts();

  // ── ซิงก์ซ้ำ 2 รอบ (วันละครั้ง) ──
  for (let d = 1; d <= 2; d++) {
    W.tick(D);
    const again = await syncAll();
    for (const s of SOURCES) assert.equal(again[s].inserted, 0, "รอบ " + d + " " + s + " ไม่ควรเพิ่มแถวใหม่: " + JSON.stringify(again[s]));
    assert.deepEqual(counts(), c2, "รอบ " + d + ": จำนวนแถวทุกตารางเท่าเดิม");
    assert.equal(keep(), kept, "รอบ " + d + ": ของที่แก้ใน v2 ไม่ถูกทับ");
  }
  assert.equal(W.one("SELECT phone FROM customers WHERE id = ?", custB.id).phone, "089-999-9999");
  assert.equal(W.one("SELECT status FROM machine_runs WHERE id = ?", stuck.id).status, "ปิดแล้ว");
  assert.equal(W.one("SELECT count(*) AS n FROM stock_moves WHERE ref_id = ?", stuck.id).n, 0, "ปิดรอบค้างจากแอปเดิม = ประวัติ ไม่แตะสต๊อก");
  // ชีตเดิมทุกเล่มเป็นอ่านอย่างเดียวในโลกจำลอง — ถ้าโค้ดเขียนกลับจะโยนข้อผิดพลาดตั้งแต่รอบแรก
  for (const id of [IDS.acct, IDS.order, IDS.customer, IDS.stock]) { const bk = G.books.get(id); assert.equal(bk.readonly, true, "เล่ม " + id + " ต้องตั้งอ่านอย่างเดียว"); assert.equal(bk.writes, 0, "ไม่เคยเขียนเล่ม " + bk.name); }
});

test("รอยต่อหน้าเว็บ–หลังบ้าน: ชุด \"ของที่โรงงานผลิตได้\" ตรงกัน · แผนผังของประธานใช้ผังจริงของทีมผลิต (ไม่ใช่ผังตารางเก่า)", async () => {
  const { PROD_TYPES } = await import("../server/actions/prodLib.mjs");
  const web = p => fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "web", "roles", p), "utf8");
  const m = /const MADE_HERE = (\[[^\]]*\])/.exec(web("office-order-detail.js"));
  assert.ok(m, "หน้าส่งเข้าคิวมีรายการของที่ผลิตได้");
  assert.deepEqual(JSON.parse(m[1]), PROD_TYPES);
  assert.match(web("exec.js"), /import \{ floorView \} from "\.\/floor\.js"/);
});
