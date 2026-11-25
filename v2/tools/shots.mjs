// ============================================================
//  ถ่ายภาพหน้าจอทุกบทบาท (ข้อมูลสมมติ) — หน้าที่สำคัญของแต่ละบทบาท มือถือ 390×844 + คอม 1366×768 + สถานะชิ้นส่วนกลาง
//    node --no-warnings v2/tools/shots.mjs [โฟลเดอร์ปลายทาง]   (ค่าตั้งต้น v2/docs/shots)
//  ได้ index.json = [{ file, role, page, vp, caption }] (ใช้ทำพรีวิวรวมให้คุณปาล์ม) · ภาพไหนถ่ายไม่ได้ = จบด้วยรหัสผิดพลาด (CI แดง)
//  ใช้ Chromium ที่ติดตั้งในเครื่องแล้ว (ห้ามติดตั้ง playwright ใหม่)
// ============================================================
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { startDev } from "./dev-server.mjs";

const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node-tools/node_modules/playwright"); }
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(process.argv[2] || path.join(HERE, "..", "docs", "shots"));
const MOBILE = { width: 390, height: 844 }, DESK = { width: 1366, height: 768 };

fs.mkdirSync(OUT, { recursive: true });
const S = await startDev({ mem: true });
const browser = await pw.chromium.launch();
const shots = [], failed = [];

async function open(role, nick, vp, extra) {
  const ctx = await browser.newContext(Object.assign({ viewport: vp, deviceScaleFactor: vp.width < 500 ? 2 : 1 }, extra || {}));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());   // ไม่ยิงเน็ตจริง (ฟอนต์สำรองของเครื่อง)
  const p = await ctx.newPage();
  await p.goto(S.url + "?app=" + role);
  await p.locator(".person", { hasText: nick }).first().click();
  for (const d of "1234") await p.locator(".numpad button", { hasText: new RegExp("^" + d + "$") }).click();
  await p.waitForSelector("nav.nav");
  await p.waitForSelector(".main .card, .main .empty");
  await settle(p);
  return p;
}
async function settle(p) { await p.evaluate(() => document.fonts && document.fonts.ready); await p.waitForTimeout(700); }
async function go(p, key) { await p.locator("nav.nav a[data-key='" + key + "']").click(); await p.waitForSelector(".main .card, .main .empty", { timeout: 8000 }); await settle(p); }
async function snap(p, meta) {
  const name = [meta.role, meta.page, meta.vp].join("-");
  const file = path.join(OUT, name + ".jpg");
  await p.screenshot({ path: file, type: "jpeg", quality: meta.vp === "390" ? 78 : 74 });
  shots.push({ file: path.basename(file), ...meta });
}
/** หน้าเดียว: ทำ steps แล้วถ่าย — พลาด = จดไว้ (ถ่ายต่อหน้าอื่น) แล้วจบด้วยรหัสผิดพลาด */
async function shot(role, nick, vp, page, caption, steps, extra) {
  let p;
  try {
    p = await open(role, nick, vp, extra);
    if (steps) await steps(p);
    await snap(p, { role, page, vp: String(vp.width), caption });
  } catch (e) {
    failed.push(role + "/" + page + "/" + vp.width + ": " + String(e.message).split("\n")[0]);
  } finally { if (p) await p.context().close(); }
}

// ── หน้าที่สำคัญของแต่ละบทบาท (ทั้งมือถือ + คอม) ──
const PAGES = [
  ["office", "แอน", "home", "งานที่รอวันนี้: ตัวเลขใหญ่ = ออเดอร์ใหม่ · รอผลิต · รอสกรีน · รอส่ง · ค้างเงิน · แตะออเดอร์ดูรายละเอียด · ปุ่ม ลงออเดอร์", null],
  ["office", "แอน", "detail", "แตะออเดอร์: รายละเอียด + ความคืบหน้าทีละรายการ (ผลิต/สกรีน/ส่ง) + ปุ่มที่กดได้ตอนนี้ (ส่งเข้าคิว · แก้ · ออกบิล · ลูกค้ามารับ · ยกเลิก)", async p => {
    await p.locator(".main button.card.ocard").first().click(); await p.waitForTimeout(900); }],
  ["office", "แอน", "new", "ลงออเดอร์ทีละขั้น: เลือกลูกค้า (ค้น/ลูกค้าใหม่) → สเปกทีละแกน → จำนวนเป็นถุง → วันส่ง → ยืนยัน", async p => {
    await p.locator(".fab, a, button", { hasText: "ลงออเดอร์" }).first().click(); await p.waitForTimeout(900); }],
  ["office", "แอน", "stock", "สต๊อก (ดูอย่างเดียว): เกรด A / B เทียบกับที่ออเดอร์ค้างต้องส่ง บอกตัวที่ขาด", async p => go(p, "stock")],
  ["prod", "บอส", "floor", "แผนผังโรงงานจริง: เครื่องเดิน X/12 · ไฟสถานะทุกเครื่อง · แตะเครื่อง = ปุ่มงาน", null],
  ["prod", "บอส", "machine", "แตะเครื่อง: รอบที่เดินอยู่ + ปุ่มหลัก ปิดรอบ · เปลี่ยนสี · จอดเครื่อง · เปลี่ยนโมลด์ (บันทึกต้องใส่ PIN คนกด)", async p => {
    const t = p.locator(".pf-tile.s-run, .pf-tile").first(); await t.click(); await p.waitForTimeout(900); }],
  ["prod", "บอส", "jobs", "งานรอผลิต: ด่วนก่อน → วันส่ง · ทำแล้วกี่ถุง · เริ่มผลิตงานนี้ · ทำครบแล้ว / แจ้งค้าง", async p => go(p, "jobs")],
  ["prod", "บอส", "stock", "สต๊อก: ถุง + ใบ · เกรด A/B แยก · รับเข้า (พรีฟอร์ม/วัตถุดิบ) · นับปรับ", async p => go(p, "stock")],
  ["screen", "จอย", "queue", "คิวสกรีน: แตะ ทีม 1/2/3 แล้วแตะ เสร็จ — สองแตะจบ (ไม่ต้องกรอกจำนวน)", null],
  ["screen", "จอย", "done", "เสร็จวันนี้: รวมต่อทีม · ลงจำนวนดี/เสียภายหลังได้ · ย้อนได้", async p => go(p, "done")],
  ["deliver", "ต่อ", "route", "เส้นทาง: เลยกำหนด → วันนี้ → พรุ่งนี้ แยกสาย · แตะร้าน = ขึ้นรถ (เลือกคันเอง)", null],
  ["deliver", "ต่อ", "truck", "บนรถ: มองเป็นคันรถ · ปุ่ม ส่งแล้ว / ส่งไม่ได้ บนการ์ด · เอาลงทั้งคัน", async p => go(p, "truck")],
  ["deliver", "ต่อ", "done", "ส่งแล้ว: รายวัน · ใบส่งของ (รูปส่งไลน์ / พิมพ์) · ไม่มียอดเงิน", async p => go(p, "done")],
  ["account", "ฝ้าย", "check", "งานที่รอตรวจ: บิลจากออเดอร์รอใส่เลขกระดาษ · ยอดไม่ตรง (รอออฟฟิศ) · ชีทบัญชีจ่ายแล้วแต่แอปค้าง", null],
  ["account", "ฝ้าย", "link", "ผูกเลขบิลกระดาษ: ใส่เลข + ยอดตามกระดาษด้วยแป้น — ยอดไม่ตรง = ไม่ผูก โชว์ทั้งสองเลข · เสร็จแล้วเปิดใบถัดไปเอง", async p => {
    await p.locator(".main button.card").first().click(); await p.waitForTimeout(900); }],
  ["account", "ฝ้าย", "owing", "ลูกหนี้รายร้าน: แตะร้าน → เลือกบิล → รับชำระ (ช่องทางต้องกดเอง) / ออกใบวางบิล", async p => go(p, "owing")],
  ["account", "ฝ้าย", "money", "เงินเข้าบัญชีไหน: วันนี้/เมื่อวาน/เดือน · แยกช่องทาง · นับตามวันที่ชำระ", async p => go(p, "money")],
  ["exec", "หัวหน้า", "today", "เรื่องที่ต้องตัดสินใจ: ธงทุกทีมจัดกลุ่ม ด่วนขึ้นก่อน · รับทราบ / ปิดเรื่อง · คอม = ภาพรวมวันนี้ด้านขวา", null],
  ["exec", "หัวหน้า", "floor", "แผนผัง (ดูอย่างเดียว) — ผังเดียวกับทีมผลิต เลขเครื่องเดินตรงกัน", async p => go(p, "floor")],
  ["exec", "หัวหน้า", "money", "เงิน: เงินเข้าแยกบัญชี + ลูกหนี้ (ชุดเดียวกับแอปบัญชี)", async p => go(p, "money")],
  ["exec", "หัวหน้า", "price", "ราคา: ต่อ SKU / ต่อสเปก · ตั้งด้วยแป้น → ยืนยันเดิม→ใหม่ + เหตุผล · ลงประวัติทุกครั้ง", async p => go(p, "price")],
  ["exec", "หัวหน้า", "team", "ทีม: ตั้ง/รีเซ็ต PIN · พักงาน · ย้ายแผนก · นำเข้าข้อมูลเดิม · ค่าตั้ง", async p => go(p, "team")],
];
for (const [role, nick, page, caption, steps] of PAGES) for (const vp of [MOBILE, DESK]) await shot(role, nick, vp, page, caption, steps);

// ── สถานะชิ้นส่วนกลาง (มือถือ) ──
await shot("prod", "บอส", MOBILE, "pin", "ทีมผลิตกดบันทึก: ถามใครบันทึก + PIN ทุกครั้ง (มือถือหน้าเครื่องใช้ร่วมกันได้)", async p => {
  await p.locator(".pf-tile.s-run").first().click(); await p.waitForTimeout(700);
  await p.locator(".sheet button", { hasText: "จอดเครื่อง" }).first().click(); await p.waitForTimeout(600);
  await p.locator(".sheet.modal .chip").first().click();
  await p.locator(".sheet.modal .btn.pri").last().click(); await p.waitForTimeout(700);
});
await shot("office", "แอน", MOBILE, "dark", "โหมดมืด (ตามเครื่อง)", null, { colorScheme: "dark" });
{
  const ctx = await browser.newContext({ viewport: MOBILE, deviceScaleFactor: 2 });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const p = await ctx.newPage();
  await p.goto(S.url + "?app=office"); await p.waitForSelector(".person"); await settle(p);
  await snap(p, { role: "office", page: "login", vp: "390", caption: "เข้าระบบ: แตะการ์ดชื่อ → PIN 4 หลัก (ทีมผลิตไม่ต้องเข้าระบบ ใส่ PIN ตอนกดบันทึก)" });
  await ctx.close();
}
fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(shots, null, 1));
await browser.close(); await S.close();
console.log("ถ่ายแล้ว " + shots.length + " ภาพ → " + OUT);
if (failed.length) { console.error("ถ่ายไม่ได้ " + failed.length + " ภาพ:\n" + failed.join("\n")); process.exit(1); }
