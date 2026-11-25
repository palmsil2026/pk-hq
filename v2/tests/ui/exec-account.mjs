// ============================================================
//  เทสต์หน้าจอโมดูลประธาน + บัญชี (Playwright · หลังบ้านจริง + สะพาน GAS จริงในเครื่อง · ข้อมูลสมมติ PIN 1234)
//    node --no-warnings --test v2/tests/ui/exec-account.mjs
//  ผูกเลขกระดาษ (ยอดไม่ตรง = ไม่ผูก โชว์สองเลข → ส่งออฟฟิศ → เปิดใบถัดไปเอง) · ช่องทางรับเงินไม่มีค่าตั้งต้น · รับชำระ
//  · เงินโหลดไม่สำเร็จ = "—" · ราคา + ประวัติ · ทีม: เพิ่มคน/PIN/พักงาน ผ่าน Google → มีผลทันที · ที่ 390 และ 1366
// ============================================================
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { startDev } from "../../tools/dev-server.mjs";

const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node-tools/node_modules/playwright"); }
let S, browser;
before(async () => { S = await startDev({ mem: true }); browser = await pw.chromium.launch(); });
after(async () => { await browser.close(); await S.close(); });

async function open(role, nick, vp) {
  const ctx = await browser.newContext({ viewport: vp || { width: 390, height: 844 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const p = await ctx.newPage();
  p.errors = [];
  p.on("pageerror", e => p.errors.push(e.message));
  p.on("console", m => { if (m.type() === "error" && !/net::ERR_FAILED|fonts\.g|status of 4\d\d/.test(m.text())) p.errors.push(m.text()); });
  await p.goto(S.url + "?app=" + role);
  await p.locator(".person", { hasText: nick }).first().click();
  for (const d of "1234") await p.locator(".numpad button", { hasText: new RegExp("^" + d + "$") }).click();
  await p.waitForSelector(".main .card, .main .empty");
  return p;
}
const pad = async (p, s) => { for (const k of s) await p.locator(".sheet.on .numpad button", { hasText: new RegExp("^" + (k === "." ? "\\." : k) + "$") }).last().click(); };
const goto = async (p, key) => { await p.locator("nav.nav a[data-key='" + key + "']").click(); await p.waitForTimeout(400); };

for (const vp of [{ width: 390, height: 844 }, { width: 1366, height: 768 }]) {
  test("บัญชี " + vp.width + ": ยอดกระดาษไม่ตรง = ไม่ผูก โชว์สองเลข → ส่งให้ออฟฟิศ → ใบถัดไปเปิดเอง → ผูกได้ + แถบย้อน", async () => {
    const p = await open("account", "ฝ้าย", vp);
    assert.equal(await p.locator("h1").innerText(), "งานที่รอตรวจ");
    const q = p.locator("section[aria-label='บิลจากออเดอร์ รอใส่เลขบิลกระดาษ'] button.card");
    const n0 = await q.count();
    assert.ok(n0 >= 2, "ต้องมีงานรอผูกเลข");
    const first = await q.first().locator(".name").innerText();
    await q.first().click();
    await p.waitForSelector(".sheet.on .numpad");
    assert.equal(await p.locator(".sheet.on h2").innerText(), first);
    assert.match(await p.locator(".sheet.on").innerText(), /฿ —/, "ยอดบนกระดาษต้องว่าง (ไม่เติมให้)");
    await pad(p, "7001");
    await p.locator(".sheet.on .numdisp[aria-label='ยอดบนบิลกระดาษ']").click();
    await pad(p, "1");
    await p.locator(".sheet.on .sheet-foot .btn.pri").click();
    await p.waitForSelector(".sheet.on .banner.t-bad");
    const t = await p.locator(".sheet.on .banner.t-bad").innerText();
    assert.match(t, /ยอดไม่ตรง/); assert.match(t, /฿1\b/); assert.match(t, /บนบิลกระดาษ/);
    assert.equal(S.d1.one("SELECT paper_no FROM bills WHERE customer_name = ? AND order_id IS NOT NULL AND src='v2' ORDER BY bill_day LIMIT 1", first).paper_no, "", "ห้ามผูก");
    await p.locator(".sheet.on button", { hasText: "ส่งให้ออฟฟิศเช็ค" }).click();
    await p.waitForFunction(t => { const h = document.querySelector(".sheet.on h2"); return h && h.textContent !== t; }, first);
    assert.ok(S.d1.one("SELECT count(*) n FROM flags WHERE kind='ยอดไม่ตรง' AND team='office' AND status='เปิด'").n >= 1);
    // ใบถัดไป: ผูกให้ถูก
    const name2 = await p.locator(".sheet.on h2").innerText();
    const b2 = S.d1.one("SELECT * FROM bills WHERE customer_name = ? AND src='v2' AND paper_no='' AND order_id IS NOT NULL", name2);
    await pad(p, String(8000 + vp.width));
    await p.locator(".sheet.on .numdisp[aria-label='ยอดบนบิลกระดาษ']").click();
    await pad(p, String(b2.total_satang / 100));
    if (b2.kind === "เงินสด") {
      await p.locator(".sheet.on .sheet-foot .btn.pri").click();
      assert.match(await p.locator(".sheet.on p.err").innerText(), /เงินเข้าทางไหน/, "บิลเงินสดต้องเลือกช่องทางเอง");
      await p.locator(".sheet.on .chip", { hasText: "KBank" }).click();
    }
    await p.locator(".sheet.on .sheet-foot .btn.pri").click();
    await p.waitForSelector(".snack.on button:has-text('ย้อน')");
    assert.equal(S.d1.one("SELECT paper_no FROM bills WHERE bill_no=?", b2.bill_no).paper_no, String(8000 + vp.width));
    assert.deepEqual(p.errors, []);
    await p.context().close();
  });
}

test("บัญชี: ลูกหนี้ → แตะร้าน → เลือกบิล → รับชำระ (ไม่เลือกช่องทาง = บอก) → บันทึก · บิลจากชีทรับในแอปไม่ได้", async () => {
  const p = await open("account", "ฝ้าย");
  await goto(p, "owing");
  await p.locator(".main button.card", { hasText: "ร้านตัวอย่าง H" }).first().click();
  await p.waitForSelector(".sheet.on");
  const bills = p.locator(".sheet.on .sheet-body button.card");
  await bills.first().click();
  assert.equal(await bills.first().getAttribute("aria-pressed"), "true");
  await p.locator(".sheet.on button", { hasText: "รับชำระที่เลือก" }).click();
  await p.waitForSelector(".sheet.on h2:has-text('รับชำระ')");
  await p.locator(".sheet.on .sheet-foot .btn.pri").click();
  assert.match(await p.locator(".sheet.on p.err").innerText(), /เลือกว่าเงินเข้าทางไหน/);
  assert.equal(await p.locator(".sheet.on .chip[aria-pressed='true']", { hasText: "KTB" }).count(), 0, "ช่องทางไม่มีค่าตั้งต้น");
  const n0 = S.d1.one("SELECT count(*) n FROM bill_payments").n;
  await p.locator(".sheet.on .chip", { hasText: "KTB" }).click();
  await p.locator(".sheet.on .sheet-foot .btn.pri").click();
  await p.waitForSelector(".snack.on button:has-text('ย้อน')");
  assert.equal(S.d1.one("SELECT count(*) n FROM bill_payments").n, n0 + 1);
  assert.equal(S.d1.one("SELECT channel FROM bill_payments ORDER BY created_at DESC LIMIT 1").channel, "โอน KTB");
  // บิลจากชีทบัญชี: แตะ = ดูรายละเอียด บอกว่ารับชำระในชีท
  await goto(p, "owing");
  await p.locator(".main button.card", { hasText: "ร้านตัวอย่าง D" }).first().click();
  await p.locator(".sheet.on .sheet-body button.card", { hasText: "ชีทบัญชี" }).first().click();
  await p.waitForSelector(".sheet.on h2:has-text('ร้านตัวอย่าง D')");
  await p.waitForSelector(".sheet.on .sheet-foot");
  assert.match(await p.locator(".sheet.on").last().innerText(), /รับชำระ\/แก้ในชีท/);
  assert.deepEqual(p.errors, []);
});

test("บัญชี: เงินเข้าโหลดไม่สำเร็จ = ไม่โชว์ยอด (—) · ลงบิลเงินสดต้องเลือกช่องทาง → ลงได้ → คงประเภท/ช่องทางไว้ลงใบต่อไป", async () => {
  const p = await open("account", "ฝ้าย", { width: 1366, height: 768 });
  await goto(p, "money");
  await p.waitForSelector(".main .card:has-text('เงินเข้ารวม')");
  assert.match(await p.locator(".main").innerText(), /฿/);
  await p.route("**/api/call", r => r.request().postData().includes("account.money") ? r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false, error: { code: "server", message: "หลังบ้านทำงานผิดพลาด" } }) }) : r.continue());
  await p.locator(".main .chip", { hasText: "วันนี้" }).click();
  await p.waitForSelector(".banner.t-bad");
  assert.ok(!/฿/.test(await p.locator(".main").innerText()), "โหลดไม่สำเร็จแล้วยังโชว์ยอดเงิน");
  await p.unroute("**/api/call");
  p.errors = p.errors.filter(e => !/status of 500/.test(e));   // 500 ที่จำลองเองข้างบน
  await goto(p, "bills");
  await p.locator(".main input[aria-label='ลูกค้า']").fill("ร้านหน้าโรงงาน");
  await p.locator(".main .numdisp[aria-label='ยอดเงิน']").click();
  await p.keyboard.type("350");
  await p.locator(".main .chip", { hasText: "เงินสด" }).first().click();
  await p.locator(".main button.btn.pri", { hasText: "ลงบิล" }).click();
  assert.match(await p.locator(".main p.err").innerText(), /เงินเข้าทางไหน/);
  await p.locator(".main .chips[aria-label='เงินเข้าทางไหน'] .chip", { hasText: "เงินสด" }).click();
  await p.locator(".main button.btn.pri", { hasText: "ลงบิล" }).click();
  await p.waitForSelector(".snack.on button:has-text('ย้อน')");
  const b = S.d1.one("SELECT * FROM bills WHERE customer_name='ร้านหน้าโรงงาน'");
  assert.equal(b.total_satang, 35000); assert.equal(b.status, "ชำระแล้ว"); assert.equal(b.origin, "บัญชี");
  assert.equal(await p.locator(".main input[aria-label='ลูกค้า']").inputValue(), "", "ล้างชื่อ");
  assert.equal(await p.locator(".main .chips[aria-label='ประเภทบิล'] .chip[aria-pressed='true']").innerText(), "เงินสด", "คงประเภทไว้");
  assert.deepEqual(p.errors, []);
});

test("ประธาน: แตะเรื่อง = รายละเอียด + พาไปถึงของที่อ้างถึง · ราคา: ตั้งด้วยแป้น → ยืนยัน (เดิม→ใหม่) → ประวัติราคา", async () => {
  const p = await open("exec", "หัวหน้า");
  assert.equal(await p.locator("h1").innerText(), "เรื่องที่ต้องตัดสินใจ");
  await p.locator(".flags .card .tap").first().click();
  await p.waitForSelector(".sheet.on .ref");
  assert.match(await p.locator(".sheet.on").innerText(), /รหัสอ้างอิง/);
  await p.keyboard.press("Escape");
  await p.waitForSelector(".sheet", { state: "detached" });
  await goto(p, "price");
  await p.waitForSelector(".main button.card");
  await p.locator(".main input[type=search]").fill("250ml เรียบ ใส");
  await p.locator(".main button.card", { hasText: "ขวด PET 250ml เรียบ ใส" }).click();
  await p.waitForSelector(".sheet.on");
  assert.match(await p.locator(".sheet.on").innerText(), /อ้างอิงจากบิลจริง/);
  await p.locator(".sheet.on .card", { hasText: "โรงงาน" }).locator("button").click();
  await p.waitForSelector(".sheet.on.modal .numpad");
  await p.keyboard.press("Backspace"); await p.keyboard.press("Backspace"); await p.keyboard.press("Backspace"); await p.keyboard.press("Backspace");
  await pad(p, "1.42");
  await p.locator(".sheet.on.modal .sheet-foot .btn.pri").click();
  await p.waitForSelector(".sheet.on.modal .chip:has-text('ต้นทุนขึ้น')");
  assert.match(await p.locator(".sheet.on.modal").innerText(), /฿1\.35 → ฿1\.42/);
  await p.locator(".sheet.on.modal .chip", { hasText: "ต้นทุนขึ้น" }).click();
  await p.locator(".sheet.on.modal .btn.pri", { hasText: "บันทึกราคา" }).click();
  await p.waitForSelector(".snack.on");
  const h = S.d1.one("SELECT * FROM price_history ORDER BY id DESC LIMIT 1");
  assert.deepEqual([h.old_satang, h.new_satang, h.reason], [135, 142, "ต้นทุนขึ้น"]);
  assert.deepEqual(p.errors, []);
});

test("ประธาน · ทีม: เพิ่มพนักงาน (PIN สองครั้ง → Google) → เข้าแอปได้ทันที · พักงาน → เข้าไม่ได้ทันที", async () => {
  const p = await open("exec", "หัวหน้า", { width: 1366, height: 768 });
  await goto(p, "team");
  await p.locator(".main button", { hasText: "เพิ่มพนักงาน" }).click();
  await p.locator(".sheet.on input[aria-label='ชื่อ-สกุล']").fill("ทดลอง เพิ่มใหม่");
  await p.locator(".sheet.on input[aria-label='ชื่อเล่น']").fill("ใหม่");
  await p.locator(".sheet.on .chip", { hasText: "บัญชี" }).click();
  await p.locator(".sheet.on .btn.pri", { hasText: "ตั้ง PIN" }).click();
  await p.waitForSelector(".sheet.on.modal .numpad");
  await pad(p, "2468"); await p.waitForTimeout(150); await pad(p, "2468");
  await p.waitForSelector(".snack.on:has-text('เพิ่ม ใหม่ แล้ว')");
  const s = S.d1.one("SELECT * FROM staff WHERE nick='ใหม่'");
  assert.ok(s && s.status === "ทำงาน" && s.pin_fp.length === 22 && s.exec_ok_at, JSON.stringify(s));
  // คนใหม่เข้าแอปบัญชีได้เลย (PIN ที่ประธานตั้ง)
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p2 = await ctx2.newPage();
  await p2.goto(S.url + "?app=account");
  await p2.locator(".person", { hasText: "ใหม่" }).click();
  for (const d of "2468") await p2.locator(".numpad button", { hasText: new RegExp("^" + d + "$") }).click();
  await p2.waitForSelector("nav.nav");
  // พักงาน → คนนั้นเข้าไม่ได้ทันที
  await p.reload(); await goto(p, "team");
  await p.locator(".main button.card", { hasText: "ใหม่" }).first().click();
  await p.locator(".sheet.on summary", { hasText: "ตัวเลือกเพิ่มเติม" }).click();
  await p.locator(".sheet.on button", { hasText: "พักงาน" }).click();
  await p.locator(".sheet.on.modal .btn.pri", { hasText: "พักงาน" }).click();
  await p.waitForSelector(".snack.on:has-text('พักงาน')");
  assert.equal(S.d1.one("SELECT status FROM staff WHERE nick='ใหม่'").status, "พัก");
  await p2.reload();
  await p2.waitForSelector(".login");
  assert.match(await p2.locator(".login").innerText(), /พัก/);
  await ctx2.close();
  assert.deepEqual(p.errors, []);
});
