// เทสต์แอปบัญชี: สิทธิ์ (ตัวเลขเงินกรองที่เซิร์ฟเวอร์) · ผูกเลขกระดาษ · ยอดไม่ตรง · เลขซ้ำ · รับชำระ (เกินยอด/ซ้ำ/ชนกัน/ย้อน)
//   · ลงบิล/แก้/ยกเลิก (เฉพาะที่ลงจากแอปบัญชี) · ใบวางบิล · ลูกหนี้ · เงินเข้าบัญชีไหน (ตามวันที่ชำระ · ไม่นับซ้ำกับชีทบัญชี)
import { test } from "node:test";
import assert from "node:assert/strict";
import { moneyWorld, TODAY } from "./helpers/money.mjs";
import { addDays } from "../server/core.mjs";
import { translateDbError } from "../server/db.mjs";

const MONEY_ACTIONS = R => R.list().filter(d => /^(account\.|home\.account$|home\.exec$|price\.|exec\.)/.test(d.name)).map(d => d.name);
const ok = (r, msg) => assert.equal(r.status, 200, (msg || "") + " " + JSON.stringify(r.error));

test("สิทธิ์: ทีมที่ไม่ใช่บัญชี/ประธาน เรียก action เงินไม่ได้เลย (403 ที่เซิร์ฟเวอร์) · บัญชีเรียกของประธานไม่ได้", async () => {
  const { W, t } = await moneyWorld();
  const names = MONEY_ACTIONS(W.registry);
  assert.ok(names.length >= 25, "ต้องมี action เงิน/ประธานครบ (ได้ " + names.length + ")");
  for (const who of ["office", "prod", "screen", "deliver"]) {
    for (const a of names) {
      const r = await W.call(t[who], a, { bill_no: "x", id: "x", version: 1, items: [{ bill_no: "x", version: 1, satang: 1 }] });
      assert.equal(r.status, 403, who + " เรียก " + a + " ได้ (" + r.status + ")");
      const r2 = await W.call(t[who], a, {}, { as: "account" });
      assert.equal(r2.status, 403, who + " ส่ง as=account แล้วเรียก " + a + " ได้");
    }
  }
  for (const a of names.filter(n => /^(price\.|exec\.|home\.exec$)/.test(n))) assert.equal((await W.call(t.acct, a, {})).status, 403, "บัญชีเรียก " + a + " ได้");
  ok(await W.call(t.acct, "home.account"));
  ok(await W.call(t.boss, "home.account", {}, { as: "account" }), "ประธานเปิดแอปบัญชีได้");
});

test("สิทธิ์: หน้าแรกทีมอื่นและข้อมูลตัวฉัน ไม่มีตัวเลขเงินหลุด", async () => {
  const { W, t } = await moneyWorld();
  W.orderBill("PB1", "C1", 123456, "เครดิต");
  for (const [who, a] of [["prod", "home.prod"], ["screen", "home.screen"], ["deliver", "home.deliver"], ["office", "home.office"], ["office", "system.me"], ["prod", "system.me"]]) {
    const r = await W.call(t[who], a);
    ok(r, a);
    const s = JSON.stringify(r.data);
    assert.ok(!/_satang"\s*:\s*\d/.test(s) && !s.includes("123456") && !s.includes("1234.56"), who + " › " + a + " มีตัวเลขเงิน: " + s.slice(0, 200));
  }
});

test("หน้าแรกบัญชี: งานที่รอตรวจครบ · ไม่มีงาน = รายการว่าง · ยอดบอกช่วงเวลา · 1 รอบคุยกับฐาน", async () => {
  const { W, t } = await moneyWorld();
  let h = (await W.call(t.acct, "home.account")).data;
  assert.deepEqual([h.unlinked.length, h.issues.length, h.sheetPaid.length, h.due.length], [0, 0, 0, 0]);
  assert.equal(h.owing.satang, 0); assert.match(h.owing.period, new RegExp(TODAY)); assert.match(h.moneyIn.period, /วันที่ชำระ/);
  W.orderBill("PB1", "C1", 500000, "เครดิต", { due: addDays(TODAY, 2) });
  W.orderBill("PB2", "C2", 120000, "เงินสด");
  W.orderBill("PB3", "C3", 90000, "เครดิต", { due: addDays(TODAY, 30) });
  const before = W.d1.stats.rounds;
  h = (await W.call(t.acct, "home.account")).data;
  assert.ok(W.d1.stats.rounds - before <= 4, "หน้าแรกคุยกับฐาน " + (W.d1.stats.rounds - before) + " รอบ");
  assert.deepEqual(h.unlinked.map(b => b.bill_no), ["PB1", "PB2", "PB3"]);
  assert.deepEqual(h.due.map(b => b.bill_no), ["PB1"], "ครบกำหนดภายใน 7 วัน");
  assert.equal(h.owing.n, 3); assert.equal(h.owing.satang, 710000);
  assert.equal(h.unlinked[0].src_label, "จากออเดอร์"); assert.equal(h.unlinked[0].editable, false); assert.equal(h.unlinked[0].payable, true);
});

test("ผูกเลขบิลกระดาษ: ใบเดิม ไม่สร้างซ้ำ · audit · ย้อนได้ (ไม่ลบ) · รุ่นเก่า = 409 · ยกเลิกแล้ว = 410 · บิลจากชีท = ไม่ได้", async () => {
  const { W, t } = await moneyWorld();
  const b = W.orderBill("PB1", "C1", 500000, "เครดิต");
  const r = await W.call(t.acct, "account.link", { bill_no: "PB1", version: b.version, paper_no: "1234", paper_satang: 500000 });
  ok(r);
  assert.equal(W.bill("PB1").paper_no, "1234"); assert.equal(W.bill("PB1").status, "ค้างชำระ");
  assert.equal(W.one("SELECT count(*) n FROM bills").n, 1, "ไม่สร้างบิลใหม่");
  const a = W.one("SELECT * FROM audit_log WHERE action='account.link'");
  assert.equal(a.staff_name, "ฝ้าย"); assert.equal(a.role, "account"); assert.match(a.after_json, /1234/);
  assert.equal((await W.call(t.acct, "account.link", { bill_no: "PB1", version: b.version, paper_no: "1235", paper_satang: 500000 })).status, 409, "รุ่นเก่า");
  ok(await W.call(t.acct, "undo.run", { id: r.undo.id }));
  assert.equal(W.bill("PB1").paper_no, ""); assert.equal(W.one("SELECT count(*) n FROM bills").n, 1);
  W.d1.raw.prepare("UPDATE bills SET status='ยกเลิก', version=version+1 WHERE bill_no='PB1'").run();
  assert.equal((await W.call(t.acct, "account.link", { bill_no: "PB1", version: W.bill("PB1").version, paper_no: "1", paper_satang: 500000 })).status, 410);
  W.acctBill("เก่า-ลูกหนี้-9", "9", "ร้านในชีท", 1000, "ค้างชำระ");
  const s = await W.call(t.acct, "account.link", { bill_no: "เก่า-ลูกหนี้-9", version: 1, paper_no: "9", paper_satang: 1000 });
  assert.equal(s.status, 400); assert.match(s.error.message, /ชีทบัญชี/);
});

test("ยอดกระดาษ ≠ ออเดอร์: ไม่ให้ผูก · บอกทั้งสองเลข · ส่งให้ออฟฟิศเช็ค = ธง (ไม่ซ้ำ) · ทีมออฟฟิศเห็นธง", async () => {
  const { W, t } = await moneyWorld();
  const b = W.orderBill("PB1", "C1", 1200000, "เครดิต");
  const r = await W.call(t.acct, "account.link", { bill_no: "PB1", version: b.version, paper_no: "77", paper_satang: 1240000 });
  assert.equal(r.status, 409); assert.equal(r.error.code, "mismatch");
  assert.match(r.error.message, /12,400/); assert.match(r.error.message, /12,000/);
  assert.equal(r.error.paper_satang, 1240000); assert.equal(r.error.bill_satang, 1200000);
  assert.equal(W.bill("PB1").paper_no, "", "ห้ามผูก");
  ok(await W.call(t.acct, "account.mismatch_report", { bill_no: "PB1", paper_satang: 1240000, paper_no: "77" }));
  ok(await W.call(t.acct, "account.mismatch_report", { bill_no: "PB1", paper_satang: 1240000, paper_no: "77" }));
  const f = W.q("SELECT * FROM flags WHERE kind='ยอดไม่ตรง' AND status='เปิด'");
  assert.equal(f.length, 1, "แจ้งซ้ำไม่เกิดธงซ้ำ"); assert.equal(f[0].team, "office"); assert.match(f[0].detail, /12,400/);
  const seen = await W.call(t.office, "flag.list");
  assert.ok(seen.data.items.some(x => x.id === f[0].id), "ออฟฟิศต้องเห็นเรื่องที่ต้องเช็ค");
  const h = (await W.call(t.acct, "home.account")).data;
  assert.equal(h.issues.length, 1); assert.equal(h.issues[0].waiting, "ออฟฟิศ");
  assert.equal((await W.call(t.acct, "account.mismatch_report", { bill_no: "PB1", paper_satang: 1200000 })).status, 400, "ยอดตรงไม่ต้องแจ้ง");
});

test("เลขกระดาษซ้ำวันเดียวกัน: บอกว่าซ้ำกับใคร · ยืนยันต้องมีเหตุผล → ได้ + ธง · ต่างวัน = ไม่ซ้ำ · ฐานกันซ้ำอีกชั้น", async () => {
  const { W, t } = await moneyWorld();
  W.orderBill("PB1", "C1", 50000);
  W.orderBill("PB2", "C2", 70000);
  W.orderBill("PB3", "C3", 80000, "เครดิต", { day: addDays(TODAY, -1) });
  ok(await W.call(t.acct, "account.link", { bill_no: "PB1", version: 1, paper_no: "500", paper_satang: 50000 }));
  const d = await W.call(t.acct, "account.link", { bill_no: "PB2", version: 1, paper_no: "500", paper_satang: 70000 });
  assert.equal(d.status, 409); assert.equal(d.error.code, "dup_paper"); assert.match(d.error.message, /ร้านทดสอบ หนึ่ง/); assert.match(d.error.message, /500/);
  assert.equal((await W.call(t.acct, "account.link", { bill_no: "PB2", version: 1, paper_no: "500", paper_satang: 70000, force_dup: true })).status, 400, "ยืนยันซ้ำไม่มีเหตุผล");
  ok(await W.call(t.acct, "account.link", { bill_no: "PB2", version: 1, paper_no: "500", paper_satang: 70000, force_dup: true }, { reason: "คนละเล่ม" }));
  assert.equal(W.bill("PB2").paper_dup_ok, 1);
  assert.equal(W.q("SELECT * FROM flags WHERE kind='เลขบิลซ้ำ'").length, 1);
  ok(await W.call(t.acct, "account.link", { bill_no: "PB3", version: 1, paper_no: "500", paper_satang: 80000 }), "ต่างวัน ไม่ใช่เลขซ้ำ");
  // สองคนกดพร้อมกัน (ด่านอ่านผ่านทั้งคู่) — ฐานกันอีกชั้นด้วย unique บางส่วน
  assert.throws(() => W.d1.raw.prepare("UPDATE bills SET paper_no='500', paper_dup_ok=0 WHERE bill_no='PB2'").run(), /UNIQUE/);
  const f = translateDbError(new Error("D1_ERROR: UNIQUE constraint failed: bills.paper_no, bills.bill_day"), W.registry.get("account.link"));
  assert.equal(f.status, 409); assert.match(f.message, /เลขบิลกระดาษ/);
});

test("ผูกเลขบิลเงินสด: ต้องเลือกช่องทางเอง (ไม่มีค่าตั้งต้น) → รับเงินในตัว · เงินเข้านับครั้งเดียว · ย้อนแล้วเงินหาย", async () => {
  const { W, t } = await moneyWorld();
  W.orderBill("PB1", "C1", 245050, "เงินสด");
  const no = await W.call(t.acct, "account.link", { bill_no: "PB1", version: 1, paper_no: "88", paper_satang: 245050 });
  assert.equal(no.status, 400); assert.match(no.error.message, /เงินเข้าทางไหน/);
  assert.equal((await W.call(t.acct, "account.link", { bill_no: "PB1", version: 1, paper_no: "88", paper_satang: 245050, channel: "โอนเข้าบัญชีลับ" })).status, 400);
  const r = await W.call(t.acct, "account.link", { bill_no: "PB1", version: 1, paper_no: "88", paper_satang: 245050, channel: "โอน KTB" });
  ok(r);
  const b = W.bill("PB1");
  assert.equal(b.status, "ชำระแล้ว"); assert.equal(b.paid_satang, 245050); assert.equal(b.pay_channel, "โอน KTB"); assert.equal(b.paid_day, TODAY);
  const m = (await W.call(t.acct, "account.money", { day: TODAY })).data;
  assert.deepEqual(m.byChannel, [{ channel: "โอน KTB", satang: 245050 }]); assert.equal(m.total, 245050); assert.match(m.label, /วันที่ชำระ/);
  ok(await W.call(t.acct, "undo.run", { id: r.undo.id }));
  assert.equal(W.bill("PB1").status, "ค้างชำระ"); assert.equal(W.one("SELECT status FROM bill_payments").status, "ยกเลิก");
  assert.equal((await W.call(t.acct, "account.money", { day: TODAY })).data.total, 0);
});

test("ผูกเลขแล้วชีทบัญชีมีใบเดียวกัน: จับคู่ → นับครั้งเดียว · ยอดในชีทไม่ตรง = ไม่ให้ผูก · ย้อนแล้วใบในชีทกลับมานับ", async () => {
  const { W, t } = await moneyWorld();
  W.orderBill("PB1", "C1", 300000, "เครดิต");
  W.acctBill("เก่า-บิลรายวัน-41", "41", "ร้านทดสอบ หนึ่ง", 300000, "ค้างชำระ", { tab: "บิลรายวัน", acct_kind: "รายวัน" });
  W.acctBill("เก่า-ลูกหนี้-41", "41", "ร้านทดสอบ หนึ่ง", 300000, "ค้างชำระ", { day: addDays(TODAY, 1) });
  W.acctBill("เก่า-ลูกหนี้-42", "42", "ร้านทดสอบ สอง", 99900, "ค้างชำระ");
  let o = (await W.call(t.acct, "account.owing")).data;
  assert.equal(o.total.satang, 300000 + 300000 + 99900, "ก่อนผูก: บิลในแอป + ลูกหนี้ในชีท (แท็บรายวันไม่นับ)");
  assert.equal(o.sheetDailyCredit.n, 1);
  const r = await W.call(t.acct, "account.link", { bill_no: "PB1", version: 1, paper_no: "41", paper_satang: 300000 });
  ok(r); assert.equal(r.data.twin, true);
  o = (await W.call(t.acct, "account.owing")).data;
  assert.equal(o.total.satang, 300000 + 99900, "หลังผูก: ใบเดียวกันนับครั้งเดียว");
  W.orderBill("PB2", "C2", 100000);
  const mm = await W.call(t.acct, "account.link", { bill_no: "PB2", version: 1, paper_no: "42", paper_satang: 100000 });
  assert.equal(mm.status, 409); assert.equal(mm.error.code, "mismatch_sheet"); assert.match(mm.error.message, /999/);
  ok(await W.call(t.acct, "undo.run", { id: r.undo.id }));
  assert.equal((await W.call(t.acct, "account.owing")).data.total.satang, 300000 + 300000 + 99900 + 100000, "ย้อนแล้วใบในชีทกลับมานับ (+ บิล PB2 ที่ยังไม่ผูก)");
});

test("รับชำระ: ช่องทางบังคับ · เกินยอดค้าง = ไม่ได้ (บอกยอดที่รับได้) · ทีละงวดจนครบ · กดซ้ำไม่เบิ้ล · สองคนชนกัน = 409", async () => {
  const { W, t } = await moneyWorld();
  W.orderBill("PB1", "C1", 100000);
  const noCh = await W.call(t.acct, "account.pay", { day: TODAY, items: [{ bill_no: "PB1", version: 1, satang: 40000 }] });
  assert.equal(noCh.status, 400); assert.match(noCh.error.message, /เงินเข้าทางไหน/);
  const over = await W.call(t.acct, "account.pay", { day: TODAY, channel: "เงินสด", items: [{ bill_no: "PB1", version: 1, satang: 100001 }] });
  assert.equal(over.status, 400); assert.equal(over.error.code, "over"); assert.equal(over.error.due_satang, 100000); assert.match(over.error.message, /1,000/);
  assert.equal((await W.call(t.acct, "account.pay", { day: addDays(TODAY, 1), channel: "เงินสด", items: [{ bill_no: "PB1", version: 1, satang: 1 }] })).status, 400, "วันในอนาคต");
  const key = W.key();
  const p1 = await W.call(t.acct, "account.pay", { day: TODAY, channel: "เงินสด", items: [{ bill_no: "PB1", version: 1, satang: 40000 }] }, { key });
  ok(p1);
  const again = await W.call(t.acct, "account.pay", { day: TODAY, channel: "เงินสด", items: [{ bill_no: "PB1", version: 1, satang: 40000 }] }, { key });
  ok(again); assert.equal(again.replayed, true);
  assert.equal(W.one("SELECT count(*) n FROM bill_payments").n, 1, "กดซ้ำ = รายการเดียว");
  assert.equal(W.bill("PB1").paid_satang, 40000); assert.equal(W.bill("PB1").status, "ค้างชำระ");
  const v = W.bill("PB1").version;
  ok(await W.call(t.acct, "account.pay", { day: TODAY, channel: "โอน KBank", items: [{ bill_no: "PB1", version: v, satang: 60000 }] }));
  const clash = await W.call(t.acct2, "account.pay", { day: TODAY, channel: "โอน BBL", items: [{ bill_no: "PB1", version: v, satang: 10000 }] });
  assert.equal(clash.status, 409, "อีกคนกดด้วยรุ่นเดียวกัน");
  const b = W.bill("PB1");
  assert.equal(b.status, "ชำระแล้ว"); assert.equal(b.paid_satang, 100000); assert.equal(b.pay_channel, "โอน KBank");
  const m = (await W.call(t.acct, "account.money", { day: TODAY })).data;
  assert.deepEqual(m.byChannel, [{ channel: "เงินสด", satang: 40000 }, { channel: "โอน KBank", satang: 60000 }]);
  assert.equal((await W.call(t.acct, "account.pay", { day: TODAY, channel: "เงินสด", items: [{ bill_no: "PB1", version: b.version, satang: 1 }] })).status, 409, "ครบแล้วรับอีกไม่ได้");
});

test("รับชำระเกินจริง: รับเท่ายอดค้าง + แจ้งส่วนเกิน (เหตุผลบังคับ) = ธงให้ตรวจ · หลายใบทีเดียว · บิลจากชีทรับในแอปไม่ได้", async () => {
  const { W, t } = await moneyWorld();
  W.orderBill("PB1", "C1", 100000); W.orderBill("PB2", "C1", 50000);
  assert.equal((await W.call(t.acct, "account.pay", { day: TODAY, channel: "โอน KTB", excess_satang: 500, items: [{ bill_no: "PB1", version: 1, satang: 100000 }] })).status, 400);
  ok(await W.call(t.acct, "account.pay", { day: TODAY, channel: "โอน KTB", excess_satang: 500, items: [{ bill_no: "PB1", version: 1, satang: 100000 }] }, { reason: "ลูกค้าโอนเกิน" }));
  const f = W.one("SELECT * FROM flags WHERE kind='ยอดไม่ตรง'");
  assert.match(f.title, /จ่ายเกินยอด ฿5/); assert.equal(f.status, "เปิด");
  ok(await W.call(t.acct, "account.pay", { day: TODAY, channel: "เช็ค", items: [{ bill_no: "PB2", version: 1, satang: 50000 }] }));
  W.acctBill("เก่า-ลูกหนี้-1", "1", "ร้านในชีท", 1000, "ค้างชำระ");
  const s = await W.call(t.acct, "account.pay", { day: TODAY, channel: "เงินสด", items: [{ bill_no: "เก่า-ลูกหนี้-1", version: 1, satang: 1000 }] });
  assert.equal(s.status, 400); assert.match(s.error.message, /รับชำระ\/แก้ในชีท/);
  W.orderBill("PB3", "C2", 3000); W.orderBill("PB4", "C3", 4000);
  const multi = await W.call(t.acct, "account.pay", { day: TODAY, channel: "เงินสด", items: [{ bill_no: "PB3", version: 1, satang: 3000 }, { bill_no: "PB4", version: 1, satang: 4000 }] });
  ok(multi); assert.equal(multi.data.total_satang, 7000);
  assert.equal(W.bill("PB3").status, "ชำระแล้ว"); assert.equal(W.bill("PB4").status, "ชำระแล้ว");
  assert.equal((await W.call(t.acct, "account.pay", { day: TODAY, channel: "เงินสด", items: [{ bill_no: "PB3", version: 2, satang: 1 }, { bill_no: "PB3", version: 2, satang: 1 }] })).status, 400, "บิลซ้ำในคำขอเดียว");
});

test("ยกเลิกการรับชำระ: เหตุผลบังคับ · บิลกลับเป็นค้าง · ใบวางบิลกลับไปรอเก็บ · ยกเลิกซ้ำ = 410", async () => {
  const { W, t } = await moneyWorld();
  W.orderBill("PB1", "C1", 100000);
  ok(await W.call(t.acct, "account.stmt_create", { bill_nos: ["PB1"] }));
  ok(await W.call(t.acct, "account.pay", { day: TODAY, channel: "เงินสด", items: [{ bill_no: "PB1", version: W.bill("PB1").version, satang: 100000 }] }));
  assert.equal(W.one("SELECT status FROM statements").status, "เก็บแล้ว");
  const p = W.one("SELECT * FROM bill_payments");
  assert.equal((await W.call(t.acct, "account.pay_cancel", { id: p.id, version: p.version })).status, 400, "ต้องมีเหตุผล");
  ok(await W.call(t.acct, "account.pay_cancel", { id: p.id, version: p.version }, { reason: "ลงผิดบิล" }));
  assert.equal(W.bill("PB1").status, "ค้างชำระ"); assert.equal(W.bill("PB1").paid_satang, 0);
  assert.equal(W.one("SELECT status FROM statements").status, "วางบิลแล้ว");
  assert.equal(W.one("SELECT count(*) n FROM bill_payments").n, 1, "ไม่ลบแถว");
  assert.equal((await W.call(t.acct, "account.pay_cancel", { id: p.id, version: p.version + 1 }, { reason: "x" })).status, 410);
});

test("ลงบิลในแอปบัญชี: เงินสด=รับเงินในตัว · เครดิต=ลูกหนี้ · เลขซ้ำวันเดียวกันบอกใคร · มีในชีทแล้ว = ไม่ต้องลงซ้ำ · จับคู่ลูกค้าจากชื่อ", async () => {
  const { W, t } = await moneyWorld();
  const c1 = await W.call(t.acct, "account.bill_create", { paper_no: "301", customer_name: "ร้านทดสอบ หนึ่ง", amount_satang: 90000, kind: "เงินสด", channel: "เงินสด" });
  ok(c1);
  const b1 = W.bill(c1.data.bill_no);
  assert.equal(b1.customer_id, "C1", "ชื่อตรงทะเบียน = ผูกลูกค้า"); assert.equal(b1.origin, "บัญชี"); assert.equal(b1.status, "ชำระแล้ว"); assert.equal(b1.by_name, "ฝ้าย");
  assert.equal(W.one("SELECT amount_satang, channel, day FROM bill_payments WHERE bill_no=?", b1.bill_no).amount_satang, 90000);
  assert.equal((await W.call(t.acct, "account.bill_create", { customer_name: "ร้านใหม่", amount_satang: 1000, kind: "เงินสด" })).status, 400, "เงินสดไม่เลือกช่องทาง");
  assert.equal((await W.call(t.acct, "account.bill_create", { customer_name: "ร้านใหม่", amount_satang: 1000 })).status, 400, "ไม่เลือกประเภท");
  const c2 = await W.call(t.acct, "account.bill_create", { paper_no: "302", customer_name: "ร้านใหม่ ไม่มีในทะเบียน", amount_satang: 50000, kind: "เครดิต", due_day: addDays(TODAY, 15) });
  ok(c2);
  assert.equal(W.bill(c2.data.bill_no).customer_id, null); assert.equal(W.bill(c2.data.bill_no).status, "ค้างชำระ");
  const dup = await W.call(t.acct, "account.bill_create", { paper_no: "301", customer_name: "ร้านอื่น", amount_satang: 1, kind: "เครดิต" });
  assert.equal(dup.status, 409); assert.match(dup.error.message, /ร้านทดสอบ หนึ่ง/);
  W.acctBill("เก่า-บิลรายวัน-555", "555", "ร้านในชีท", 7000, "ชำระแล้ว", { tab: "บิลรายวัน", acct_kind: "รายวัน", kind: "เงินสด", channel: "เงินสด" });
  const sh = await W.call(t.acct, "account.bill_create", { paper_no: "555", customer_name: "ร้านในชีท", amount_satang: 7000, kind: "เงินสด", channel: "เงินสด" });
  assert.equal(sh.status, 409); assert.equal(sh.error.code, "in_sheet"); assert.match(sh.error.message, /ไม่ต้องลงซ้ำ/);
  assert.equal((await W.call(t.acct, "account.bill_create", { customer_name: "x", amount_satang: 1, kind: "เครดิต", bill_day: addDays(TODAY, 1) })).status, 400, "วันอนาคต");
  ok(await W.call(t.acct, "undo.run", { id: c1.undo.id }));
  assert.equal(W.bill(b1.bill_no).status, "ยกเลิก"); assert.equal(W.one("SELECT status FROM bill_payments WHERE bill_no=?", b1.bill_no).status, "ยกเลิก");
});

test("แก้/ยกเลิกบิล: ได้เฉพาะที่ลงจากแอปบัญชี · บิลจากออเดอร์/ชีท = ไม่ได้ (บอกเหตุผล) · ยอดตามไปที่รายการรับเงิน · อยู่ในใบวางบิล = ต้องยกเลิกใบวางบิลก่อน", async () => {
  const { W, t } = await moneyWorld();
  W.orderBill("PB1", "C1", 100000);
  const e1 = await W.call(t.acct, "account.bill_edit", { bill_no: "PB1", version: 1, note: "x" });
  assert.equal(e1.status, 400); assert.match(e1.error.message, /ออฟฟิศ/);
  assert.equal((await W.call(t.acct, "account.bill_cancel", { bill_no: "PB1", version: 1 }, { reason: "ลงผิด" })).status, 400);
  W.acctBill("เก่า-ลูกหนี้-1", "1", "ร้านในชีท", 1000, "ค้างชำระ");
  assert.match((await W.call(t.acct, "account.bill_edit", { bill_no: "เก่า-ลูกหนี้-1", version: 1, note: "x" })).error.message, /ชีท/);
  const c = await W.call(t.acct, "account.bill_create", { paper_no: "9", customer_id: "C2", amount_satang: 50000, kind: "เงินสด", channel: "เงินสด" });
  const no = c.data.bill_no;
  ok(await W.call(t.acct, "account.bill_edit", { bill_no: no, version: 1, amount_satang: 55000, channel: "โอน BBL" }));
  assert.equal(W.bill(no).total_satang, 55000); assert.equal(W.bill(no).paid_satang, 55000);
  const p = W.one("SELECT * FROM bill_payments WHERE bill_no=?", no);
  assert.equal(p.amount_satang, 55000); assert.equal(p.channel, "โอน BBL");
  assert.equal((await W.call(t.acct, "account.bill_edit", { bill_no: no, version: 1, note: "เก่า" })).status, 409, "รุ่นเก่า");
  assert.equal((await W.call(t.acct, "account.bill_edit", { bill_no: no, version: W.bill(no).version })).status, 400, "ไม่มีอะไรเปลี่ยน");
  const cr = await W.call(t.acct, "account.bill_create", { customer_id: "C3", amount_satang: 80000, kind: "เครดิต" });
  ok(await W.call(t.acct, "account.pay", { day: TODAY, channel: "เงินสด", items: [{ bill_no: cr.data.bill_no, version: 1, satang: 30000 }] }));
  const low = await W.call(t.acct, "account.bill_edit", { bill_no: cr.data.bill_no, version: W.bill(cr.data.bill_no).version, amount_satang: 20000 });
  assert.equal(low.status, 400); assert.match(low.error.message, /น้อยกว่าที่รับชำระแล้ว/);
  ok(await W.call(t.acct, "account.bill_edit", { bill_no: cr.data.bill_no, version: W.bill(cr.data.bill_no).version, amount_satang: 30000 }));
  assert.equal(W.bill(cr.data.bill_no).status, "ชำระแล้ว", "แก้ยอดลงเท่าที่จ่ายแล้ว = ครบ");
  const cr2 = await W.call(t.acct, "account.bill_create", { customer_id: "C3", amount_satang: 1000, kind: "เครดิต" });
  ok(await W.call(t.acct, "account.stmt_create", { bill_nos: [cr2.data.bill_no] }));
  assert.match((await W.call(t.acct, "account.bill_edit", { bill_no: cr2.data.bill_no, version: W.bill(cr2.data.bill_no).version, note: "y" })).error.message, /ใบวางบิล/);
  assert.equal((await W.call(t.acct, "account.bill_cancel", { bill_no: no, version: W.bill(no).version })).status, 400, "ยกเลิกต้องมีเหตุผล");
  ok(await W.call(t.acct, "account.bill_cancel", { bill_no: no, version: W.bill(no).version }, { reason: "ลงซ้ำ" }));
  assert.equal(W.bill(no).status, "ยกเลิก"); assert.equal(W.bill(no).cancel_reason, "ลงซ้ำ");
  assert.equal(W.one("SELECT status FROM bill_payments WHERE bill_no=?", no).status, "ยกเลิก");
  assert.equal((await W.call(t.acct, "account.bill_cancel", { bill_no: no, version: W.bill(no).version }, { reason: "x" })).status, 410);
});

test("ใบวางบิล: ลูกค้าเดียวกันเท่านั้น · เลขเรียงต่อกัน (ย้อนแล้วไม่ใช้เลขซ้ำ) · เก็บครบ = ปิดเอง · ยกเลิกแล้วบิลว่างให้วางใหม่", async () => {
  const { W, t } = await moneyWorld();
  W.orderBill("PB1", "C1", 10000); W.orderBill("PB2", "C1", 20000); W.orderBill("PB3", "C2", 30000);
  assert.match((await W.call(t.acct, "account.stmt_create", { bill_nos: ["PB1", "PB3"] })).error.message, /ลูกค้ารายเดียวกัน/);
  const s1 = await W.call(t.acct, "account.stmt_create", { bill_nos: ["PB1", "PB2"], collect_day: addDays(TODAY, 7) });
  ok(s1);
  const yy = TODAY.slice(2, 4);
  assert.equal(s1.data.stmt_no, "ST" + yy + "-0001"); assert.equal(s1.data.total_satang, 30000);
  assert.equal(W.bill("PB1").stmt_no, s1.data.stmt_no);
  assert.equal((await W.call(t.acct, "account.stmt_create", { bill_nos: ["PB1"] })).status, 409, "อยู่ในใบวางบิลแล้ว");
  ok(await W.call(t.acct, "undo.run", { id: s1.undo.id }));
  assert.equal(W.bill("PB1").stmt_no, ""); assert.equal(W.one("SELECT status FROM statements").status, "ยกเลิก");
  const s2 = await W.call(t.acct, "account.stmt_create", { bill_nos: ["PB1", "PB2"] });
  assert.equal(s2.data.stmt_no, "ST" + yy + "-0002", "เลขที่ย้อนไปแล้วไม่ใช้ซ้ำ");
  ok(await W.call(t.acct, "account.pay", { day: TODAY, channel: "โอน KBank", items: [{ bill_no: "PB1", version: W.bill("PB1").version, satang: 10000 }] }));
  assert.equal(W.one("SELECT status FROM statements WHERE stmt_no=?", s2.data.stmt_no).status, "วางบิลแล้ว");
  ok(await W.call(t.acct, "account.pay", { day: TODAY, channel: "โอน KBank", items: [{ bill_no: "PB2", version: W.bill("PB2").version, satang: 20000 }] }));
  assert.equal(W.one("SELECT status FROM statements WHERE stmt_no=?", s2.data.stmt_no).status, "เก็บแล้ว");
  const s3 = await W.call(t.acct, "account.stmt_create", { bill_nos: ["PB3"] });
  const st = W.one("SELECT * FROM statements WHERE stmt_no=?", s3.data.stmt_no);
  assert.equal((await W.call(t.acct, "account.stmt_cancel", { stmt_no: st.stmt_no, version: st.version })).status, 400, "ยกเลิกต้องมีเหตุผล");
  ok(await W.call(t.acct, "account.stmt_cancel", { stmt_no: st.stmt_no, version: st.version }, { reason: "ออกซ้ำ" }));
  assert.equal(W.bill("PB3").stmt_no, "");
  ok(await W.call(t.acct, "account.stmt_create", { bill_nos: ["PB3"] }), "วางใหม่ได้");
});

test("เงินเข้าบัญชีไหน: ตามวันที่ชำระ (ไม่ใช่วันที่บิล) · วัน/เดือน · รวมชีทบัญชี (ไม่ซ้ำ) · ช่องทางว่าง = ไม่ระบุ (ไม่เดา)", async () => {
  const { W, t } = await moneyWorld();
  W.orderBill("PB1", "C1", 100000, "เครดิต", { day: addDays(TODAY, -20) });
  ok(await W.call(t.acct, "account.pay", { day: TODAY, channel: "โอน KBank", items: [{ bill_no: "PB1", version: 1, satang: 100000 }] }));
  W.orderBill("PB2", "C2", 5000, "เครดิต");
  ok(await W.call(t.acct, "account.pay", { day: addDays(TODAY, -1), channel: "เงินสด", items: [{ bill_no: "PB2", version: 1, satang: 5000 }] }));
  W.acctBill("เก่า-บิลรายวัน-1", "1", "ร้านชีท", 7700, "ชำระแล้ว", { tab: "บิลรายวัน", acct_kind: "รายวัน", kind: "เงินสด", channel: "" });
  W.acctBill("เก่า-ลูกหนี้-2", "2", "ร้านชีท", 3300, "ชำระแล้ว", { channel: "โอน BBL" });
  W.acctBill("เก่า-ลูกหนี้-3", "3", "ร้านชีทซ้ำ", 100000, "ชำระแล้ว", { channel: "โอน KBank" });
  W.d1.raw.prepare("UPDATE bills SET same_as='PB1' WHERE bill_no='เก่า-ลูกหนี้-3'").run();
  const d = (await W.call(t.acct, "account.money", { day: TODAY })).data;
  assert.deepEqual(d.byChannel, [{ channel: "โอน KBank", satang: 100000 }, { channel: "โอน BBL", satang: 3300 }, { channel: "ไม่ระบุช่องทาง", satang: 7700 }]);
  assert.equal(d.total, 111000); assert.equal(d.from, TODAY);
  assert.ok(d.entries.some(e => e.src_label === "ชีทบัญชี") && d.entries.some(e => e.src_label === "ในแอป"));
  const m = (await W.call(t.acct, "account.money", { period: "month", day: TODAY })).data;
  assert.equal(m.from, TODAY.slice(0, 8) + "01"); assert.match(m.label, /^เดือน/);
  const yest = addDays(TODAY, -1);
  assert.equal(m.total, 111000 + (yest.slice(0, 7) === TODAY.slice(0, 7) ? 5000 : 0));
  const h = (await W.call(t.boss, "home.exec")).data;
  assert.equal(h.moneyIn.total, 111000, "ประธานเห็นเงินเข้าวันนี้ตัวเดียวกับบัญชี"); assert.match(h.moneyIn.period, /วันที่ชำระ/);
});

test("รายการบิล: ใหม่สุดบน · ค้นชื่อ/เลขกระดาษ · แบ่งหน้า · รายละเอียดมีประวัติ+การรับเงิน+ที่มา", async () => {
  const { W, t } = await moneyWorld();
  for (let i = 1; i <= 7; i++) W.orderBill("PB" + i, i % 2 ? "C1" : "C2", 1000 * i, "เครดิต", { day: addDays(TODAY, -i) });
  ok(await W.call(t.acct, "account.link", { bill_no: "PB3", version: 1, paper_no: "4321", paper_satang: 3000 }));
  const p1 = (await W.call(t.acct, "account.bills", { limit: 3 })).data;
  assert.deepEqual(p1.items.map(b => b.bill_no), ["PB1", "PB2", "PB3"]); assert.ok(p1.next);
  const p2 = (await W.call(t.acct, "account.bills", { limit: 3, before: p1.next })).data;
  assert.deepEqual(p2.items.map(b => b.bill_no), ["PB4", "PB5", "PB6"]);
  assert.deepEqual((await W.call(t.acct, "account.bills", { q: "4321" })).data.items.map(b => b.bill_no), ["PB3"]);
  assert.equal((await W.call(t.acct, "account.bills", { q: "สอง" })).data.items.length, 3);
  const d = (await W.call(t.acct, "account.bill", { bill_no: "PB3" })).data;
  assert.equal(d.bill.paper_no, "4321"); assert.equal(d.bill.src_label, "จากออเดอร์"); assert.ok(d.history.some(x => x.action === "account.link"));
  assert.equal(d.order.id, "O-PB3");
});
