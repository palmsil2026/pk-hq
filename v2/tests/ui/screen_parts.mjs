// ============================================================
//  เทสต์หน้าจอจริง: ทีมสกรีน "ทำวันนี้ … ถุง" (งานหลายวัน) + เครื่องสกรีน (จอด/เดินต่อ/แชร์)
//  รันเดี่ยว: node --no-warnings --test v2/tests/ui/screen_parts.mjs (CI รันทุกไฟล์ใน tests/ui/)
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

async function open(role, nick, vp, opt) {
  const ctx = await browser.newContext(Object.assign({ viewport: vp || { width: 390, height: 844 } }, opt || {}));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const p = await ctx.newPage();
  p.errors = [];
  p.on("pageerror", e => p.errors.push(e.message));
  p.on("console", m => { if (m.type() === "error" && !/net::ERR_FAILED|fonts\.g|status of 409|status of 400/.test(m.text())) p.errors.push(m.text()); });
  await p.goto(S.url + "?app=" + role);
  await p.locator(".person", { hasText: nick }).first().click();
  for (const d of "1234") await p.locator(".numpad button", { hasText: new RegExp("^" + d + "$") }).click();
  await p.waitForSelector(".main .card, .main .empty", { timeout: 8000 });
  return p;
}
const one = (sql, ...a) => S.d1.one(sql, ...a);
const jobOf = cust => one("SELECT j.* FROM screen_jobs j JOIN orders o ON o.id = j.order_id JOIN customers c ON c.id = o.customer_id WHERE c.name = ? AND j.status <> 'ยกเลิก' ORDER BY j.created_at LIMIT 1", cust);
const card = (p, cust) => p.locator(".jobs .card.job", { has: p.locator(".name", { hasText: new RegExp("^" + cust + "$") }) });
const keys = async (p, s) => { for (const d of s) await p.locator(".sheet.on .numpad button", { hasText: new RegExp("^" + d + "$") }).last().click(); };
const noHScroll = p => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const smallBtns = (p, sel) => p.$$eval(sel, els => els.filter(e => e.offsetParent !== null && !e.closest("details:not([open])")).map(e => { const r = e.getBoundingClientRect(); return { t: (e.innerText || "").slice(0, 24), h: r.height, w: r.width }; }).filter(x => x.h < 43.5 || x.w < 43.5));

test("สกรีน ทำวันนี้: แป้นถุง+เศษ → ถามทีม (แตะเดียว) → งานยังอยู่ในคิว 'ทำแล้ว 12/60 ถุง' · เสร็จวันนี้รวมยอด · ย้อนช่วงนี้ได้", async () => {
  const p = await open("screen", "จอย");
  const before = jobOf("ร้านตัวอย่าง C");
  await card(p, "ร้านตัวอย่าง C").locator(".partbtn").click();
  await p.waitForSelector(".sheet.on .bagfields");
  await p.locator(".sheet.on .numpad button.ok").click();
  await p.waitForSelector(".sheet.on p.err:has-text('ใส่จำนวน')");   // ว่าง = บอก ไม่บันทึก
  await keys(p, "12");
  assert.match(await p.locator(".sheet.on").innerText(), /ค้างอีก 48 ถุง/);
  await p.locator(".sheet.on .pick", { hasText: "เศษ" }).click();
  await keys(p, "0");
  await p.locator(".sheet.on .numpad button.ok").click();
  await p.waitForSelector(".sheet.on .teamgrid");   // งานยังไม่มีทีม → ถามทีมไหนทำ
  await p.locator(".sheet.on .teamgrid button", { hasText: "ทีม 3" }).click();
  await p.waitForSelector(".snack.on:has-text('ทำวันนี้ 12 ถุง')");
  await p.waitForSelector(".jobs .card.job:has-text('ทำแล้ว 12/60 ถุง')");
  const j = jobOf("ร้านตัวอย่าง C");
  assert.equal(j.done_pcs, 2400); assert.equal(j.team, "ทีม 3"); assert.equal(j.status, "เตรียมการสกรีน");
  assert.equal(j.version, before.version + 1);
  // เสร็จวันนี้: ทีม 3 บางส่วน 1 · การ์ดช่วงมีปุ่มย้อน
  await p.evaluate(() => { location.hash = "#/done"; });
  await p.waitForSelector(".partsec .partcard:has-text('ร้านตัวอย่าง C')");
  assert.match(await p.locator(".teamsum").innerText(), /ทีม 3[\s\S]*บางส่วน 1[\s\S]*2,400/);
  await p.locator(".partcard:has-text('ร้านตัวอย่าง C') button", { hasText: "ย้อนช่วงนี้" }).click();
  await p.waitForSelector(".snack.on:has-text('ย้อนแล้ว')");
  assert.equal(jobOf("ร้านตัวอย่าง C").done_pcs, 0);
  await p.waitForFunction(() => !document.querySelector(".partsec .partcard") || !/ร้านตัวอย่าง C/.test(document.querySelector(".partsec").innerText));
  assert.deepEqual(p.errors, []);
});

test("สกรีน ทำวันนี้: ใส่ครบที่เหลือ = กดเสร็จให้ (ส่วนที่เหลือ) · ทางเดิมทีม → เสร็จ ยังสองแตะ · แผ่นงานโชว์ทุกช่วง", async () => {
  const p = await open("screen", "จอย");
  // งานหลายวัน (ข้อมูลตัวอย่าง): ร้าน B ทำแล้ว 30/100 → แผ่นงานโชว์ 2 ช่วง
  await card(p, "ร้านตัวอย่าง B").locator(".cardhead").click();
  await p.waitForSelector(".sheet.on .partrow");
  assert.equal(await p.locator(".sheet.on .partrow").count(), 2);
  assert.match(await p.locator(".sheet.on").innerText(), /ทำแล้ว 30\/100 ถุง/);
  await p.locator(".sheet.on .sheet-head button[aria-label='ปิด']").click();
  // ใส่ 70 ถุง = ครบที่เหลือ → เสร็จทั้งงาน (มีทีมแล้ว ไม่ถาม)
  await card(p, "ร้านตัวอย่าง B").locator(".partbtn").click();
  await keys(p, "70");
  assert.match(await p.locator(".sheet.on").innerText(), /ครบที่เหลือ/);
  await p.locator(".sheet.on .numpad button.ok").click();
  await p.waitForSelector(".snack.on:has-text('ส่วนที่เหลือ 70 ถุง')");
  const b = jobOf("ร้านตัวอย่าง B");
  assert.equal(b.status, "เสร็จแล้ว"); assert.equal(b.done_pcs, 6000);
  // ทางเดิม: ทีม → เสร็จ (งาน G) = สองแตะ ไม่มีแผ่นอะไรเพิ่ม
  await card(p, "ร้านตัวอย่าง G").locator("button", { hasText: "ทีม 2" }).click();
  await p.waitForSelector(".jobs .card.job:has-text('ร้านตัวอย่าง G'):has-text('ทีม 2 กำลังทำ')");
  await card(p, "ร้านตัวอย่าง G").locator("button", { hasText: "เสร็จ" }).click();
  await p.waitForSelector(".snack.on:has-text('สกรีนเสร็จ')");
  assert.equal(await p.locator(".sheet.on").count(), 0, "ไม่มีแผ่นถามเพิ่มในทางเดิม");
  assert.equal(jobOf("ร้านตัวอย่าง G").status, "เสร็จแล้ว");
  assert.equal(one("SELECT count(*) n FROM screen_parts WHERE job_id = ?", jobOf("ร้านตัวอย่าง G").id).n, 0);
  assert.deepEqual(p.errors, []);
});

test("สกรีน ทำวันนี้: จอ 320 · 1366 · โหมดมืด — ไม่เลื่อนข้าง ปุ่ม ≥ 44px แป้นใช้ได้", async () => {
  for (const [vp, opt] of [[{ width: 320, height: 640 }], [{ width: 1366, height: 768 }], [{ width: 390, height: 844 }, { colorScheme: "dark" }]]) {
    const p = await open("screen", "จอย", vp, opt);
    assert.ok(await noHScroll(p), "เลื่อนข้างที่ " + vp.width);
    assert.deepEqual(await smallBtns(p, ".main .jobs button"), [], "ปุ่มเล็กเกินที่ " + vp.width);
    await p.locator(".jobs .card.job .partbtn").first().click();
    await p.waitForSelector(".sheet.on .bagfields");
    assert.deepEqual(await smallBtns(p, ".sheet.on button"), [], "ปุ่มในแป้นเล็กเกินที่ " + vp.width);
    assert.ok(await noHScroll(p));
    assert.deepEqual(p.errors, []);
    await p.context().close();
  }
});

test("เครื่องสกรีน: แถบบนคิว → แผ่นเครื่อง → จอด (สาเหตุ + ชิ้นส่วน) → แชร์ลงไลน์ (คัดลอก) → ซ่อมเสร็จ · หยุดบ่อยเพราะอะไร", async () => {
  const p = await open("screen", "จอย", { width: 390, height: 844 }, { permissions: ["clipboard-read", "clipboard-write"] });
  await p.locator(".smbar").click();
  await p.waitForSelector(".smrow");
  assert.equal(await p.locator(".smrow").count(), 8);
  await p.locator(".smrow", { hasText: "S1" }).first().locator("button", { hasText: "จอดเครื่อง" }).click();
  await p.locator(".sheet.on.modal .btn.pri").click();
  await p.waitForSelector(".sheet.on.modal p.err:has-text('เลือกสาเหตุก่อน')");   // สาเหตุบังคับ
  await p.locator(".sheet.on.modal .chip", { hasText: "เครื่องเสีย/ซ่อม" }).click();
  await p.locator(".sheet.on.modal .chip", { hasText: "โซ่" }).click();
  await p.locator(".sheet.on.modal .btn.pri").click();
  await p.waitForSelector(".snack.on .share");
  const ev = one("SELECT * FROM machine_events WHERE machine_id = 'S1' AND ended_at = ''");
  assert.deepEqual([ev.reason, ev.part, ev.by], ["เครื่องเสีย/ซ่อม", "โซ่", "S121"]);
  await p.evaluate(() => { Object.defineProperty(navigator, "share", { value: undefined, configurable: true }); });
  await p.locator(".snack.on .share").click();
  await p.waitForSelector(".snack.on .msg:has-text('คัดลอกแล้ว')");
  const txt = await p.evaluate(() => navigator.clipboard.readText());
  assert.match(txt, /^S1 จอด \d\d:\d\d · เครื่องเสีย\/ซ่อม · โซ่$/);
  await p.waitForSelector(".smrow.stopped:has-text('S1')");
  await p.locator(".smrow.stopped", { hasText: "S1" }).locator("button", { hasText: "ซ่อมเสร็จ" }).click();
  await p.locator(".sheet.on.modal .chip", { hasText: "สปริง" }).click();
  await p.locator(".sheet.on.modal .btn.pri", { hasText: "เดินเครื่องต่อ" }).click();
  await p.waitForSelector(".snack.on .share");
  const e2 = one("SELECT * FROM machine_events WHERE id = ?", ev.id);
  assert.notEqual(e2.ended_at, ""); assert.equal(e2.fixed_by, "S121"); assert.equal(e2.part, "สปริง");
  await p.waitForSelector(".smrow:has-text('S1') details.more");
  await p.locator(".smrow", { hasText: "S1" }).first().locator("details.more summary").click();
  assert.match(await p.locator(".smrow", { hasText: "S1" }).first().locator(".stopstats").innerText(), /สปริง[\s\S]*1 ครั้ง/);
  assert.deepEqual(p.errors, []);
});

test("ทีมผลิต: แผ่นเครื่องมี 'หยุดบ่อยเพราะอะไร' + แถวจอดบอกคนแก้/ปุ่มแชร์ · จอ 320 ไม่ล้น", async () => {
  // เตรียมประวัติจอดของ PET 4 (ซ่อมเสร็จแล้ว) ผ่านหลังบ้านจริง
  const at = new Date(Date.now() - 50 * 60000).toISOString(), end = new Date(Date.now() - 20 * 60000).toISOString(), day = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  S.d1.raw.prepare("INSERT INTO machine_events(id,machine_id,kind,reason,part,started_at,started_day,ended_at,by,fixed_by,status,created_at,updated_at) VALUES ('EUI1','PET4','จอดเครื่อง','หลอด/ฮีตเตอร์','ก้ามปู',?,?,?,'S111','S111','ใช้งาน',?,?)").run(at, day, end, at, at);
  for (const vp of [{ width: 390, height: 844 }, { width: 320, height: 640 }]) {
    const ctx = await browser.newContext({ viewport: vp });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    const p = await ctx.newPage();
    const errs = []; p.on("pageerror", e => errs.push(e.message));
    await p.goto(S.url + "?app=prod");
    await p.waitForSelector(".pf-tiles .pf-tile, .person");
    if (await p.locator(".person").count()) { await p.locator(".person").first().click(); for (const d of "1234") await p.locator(".numpad button", { hasText: new RegExp("^" + d + "$") }).click(); }
    await p.waitForSelector(".pf-tiles .pf-tile");
    await p.locator(".pf-tile", { has: p.locator(".nm", { hasText: /^PET 4$/ }) }).click();
    await p.waitForSelector(".sheet.on .stopstats");
    assert.match(await p.locator(".sheet.on .stopstats").innerText(), /ก้ามปู[\s\S]*1 ครั้ง · 0.5 ชม./);
    assert.match(await p.locator(".sheet.on .evrow").first().innerText(), /แก้โดย/);
    assert.ok(await p.locator(".sheet.on .evrow button[aria-label^='แชร์ลงไลน์']").count() >= 1);
    assert.ok(await noHScroll(p));
    assert.deepEqual(errs, []);
    await ctx.close();
  }
});
