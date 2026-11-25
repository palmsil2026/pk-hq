// ============================================================
//  เทสต์หน้าจอข้ามบทบาท (รวมระบบ) — ทุกบทบาท × ทุกเมนู × จอ 320 · 360×640 · 390×844 · 1366×768 + โหมดมืด
//    node --no-warnings --test v2/tests/ui/cross-roles.mjs
//  หลักหน้าจอ (docs/app-v2/README.md §2) ที่เครื่องตรวจได้: ไม่เลื่อนข้าง · ข้อความไม่ล้นกล่อง · ปุ่มไม่ทับกัน · ปุ่ม ≥ 44px
//  · ไม่มีอีโมจิ · ไม่มีรหัสระบบ/วันที่แบบระบบบนจอ · ไม่มีศัพท์นักพัฒนา · เมนู ≤ 5 · ชิ้นสุดท้ายไม่จมใต้เมนูล่าง · ไม่มี error ในคอนโซล
//  · หน้าตาชุดเดียวกันทุกบทบาท (ปุ่มหลัก/การ์ด/ฟอนต์ ใช้ค่าเดียวกัน)
// ============================================================
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { startDev } from "../../tools/dev-server.mjs";

const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch (e) { pw = require("/opt/node-tools/node_modules/playwright"); }
const ROLES = [["office", "แอน"], ["prod", "บอส"], ["screen", "จอย"], ["deliver", "ต่อ"], ["account", "ฝ้าย"], ["exec", "หัวหน้า"]];
let S, browser;
before(async () => { S = await startDev({ mem: true }); browser = await pw.chromium.launch(); });
after(async () => { await browser.close(); await S.close(); });

/** ตรวจหน้าที่เปิดอยู่ (รันในหน้าเว็บ) → รายการปัญหา + สไตล์ชิ้นส่วนหลัก */
function audit() {
  const out = [], vw = window.innerWidth;
  const fixedOf = e => { for (let a = e; a; a = a.parentElement) { const p = getComputedStyle(a).position; if (p === "fixed" || p === "sticky") return true; } return false; };
  const scroller = e => { for (let a = e.parentElement; a; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if (o === "auto" || o === "scroll" || o === "hidden") return true; } return false; };
  if (document.documentElement.scrollWidth > vw + 1) out.push("เลื่อนข้าง " + document.documentElement.scrollWidth);
  const txt = document.body.innerText;
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(txt)) out.push("อีโมจิ");
  const ids = txt.match(/\b(?:[OJRLEFCMP]|SJ|LD|SR|SC|U)[0-9A-HJKMNP-TV-Z]{12,}\b|\bS\d{3}\b/g);
  if (ids) out.push("รหัสระบบบนจอ: " + [...new Set(ids)].slice(0, 4).join(", "));
  const isoD = txt.match(/\b20\d\d-\d\d-\d\d\b/g);
  if (isoD) out.push("วันที่แบบระบบ: " + [...new Set(isoD)].slice(0, 3).join(", "));
  const dev = txt.match(/\b(null|undefined|NaN|error|action|api|json|token|ticket|Error|ID)\b/g);
  if (dev) out.push("ศัพท์นักพัฒนา: " + [...new Set(dev)].join(","));
  for (const el of document.querySelectorAll(".main *, .top *, nav.nav *")) {
    if (!el.offsetParent || el.closest("details:not([open])") || el.closest(".pmap, svg, table")) continue;
    const cs = getComputedStyle(el);
    if (el.children.length === 0 && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2 && cs.overflow === "visible" && cs.display !== "inline") out.push("ข้อความล้น: " + (el.innerText || "").slice(0, 30));
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > vw + 1 && !scroller(el)) out.push("ออกนอกจอ: " + (el.innerText || el.tagName).slice(0, 30));
  }
  const btns = [...document.querySelectorAll(".main button, .main a.btn, .fab, nav.nav a, .top button")].filter(b => b.offsetParent && !b.closest("details:not([open])") && !b.closest(".pmap"));
  const flow = btns.filter(b => !fixedOf(b)).map(b => [b, b.getBoundingClientRect()]);
  for (let i = 0; i < flow.length; i++) for (let j = i + 1; j < flow.length; j++) {
    const [a, ra] = flow[i], [b, rb] = flow[j];
    if (a.contains(b) || b.contains(a)) continue;
    const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    if (ox > 4 && oy > 4) out.push("ปุ่มทับกัน: " + (a.innerText || a.getAttribute("aria-label") || "").slice(0, 16) + " × " + (b.innerText || b.getAttribute("aria-label") || "").slice(0, 16));
  }
  const small = btns.filter(b => { const r = b.getBoundingClientRect(); return r.height < 43.5 || r.width < 43.5; }).map(b => (b.innerText || b.getAttribute("aria-label") || "").slice(0, 14));
  if (small.length) out.push("ปุ่มเล็กกว่า 44px: " + small.slice(0, 5).join(", "));
  const navN = document.querySelectorAll("nav.nav a").length;
  if (navN > 5) out.push("เมนู " + navN + " ช่อง");
  window.scrollTo(0, 1e6);
  const nav = document.querySelector("nav.nav"), nr = nav && nav.getBoundingClientRect();
  if (nr && nr.top > 100) {
    const last = [...document.querySelectorAll(".main button, .main .card, .main a.btn")].filter(e => e.offsetParent && !fixedOf(e)).pop();
    if (last && last.getBoundingClientRect().bottom > nr.top + 2) out.push("ชิ้นสุดท้ายจมใต้เมนูล่าง: " + (last.innerText || "").slice(0, 20));
  }
  window.scrollTo(0, 0);
  const sty = e => { if (!e) return null; const c = getComputedStyle(e); return { radius: c.borderTopLeftRadius, bg: c.backgroundColor, font: c.fontFamily.split(",")[0] }; };
  return { out: [...new Set(out)], pri: sty(document.querySelector(".main .btn.pri")), card: sty(document.querySelector(".main .card")), body: getComputedStyle(document.body).fontFamily.split(",")[0] };
}

async function sweep(vp, dark) {
  const problems = [], looks = [];
  for (const [role, nick] of ROLES) {
    const ctx = await browser.newContext({ viewport: vp, colorScheme: dark ? "dark" : "light" });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    const p = await ctx.newPage();
    const errs = [];
    p.on("pageerror", e => errs.push(e.message));
    p.on("console", m => { if (m.type() === "error" && !/net::ERR_FAILED|fonts\.g/.test(m.text())) errs.push(m.text()); });
    await p.goto(S.url + "?app=" + role);
    await p.locator(".person", { hasText: nick }).first().click();
    for (const d of "1234") await p.locator(".numpad button", { hasText: new RegExp("^" + d + "$") }).click();
    await p.waitForSelector("nav.nav");
    for (const k of await p.$$eval("nav.nav a", as => as.map(a => a.dataset.key))) {
      await p.locator("nav.nav a[data-key='" + k + "']").click();
      await p.waitForSelector(".main .card, .main .empty", { timeout: 8000 });
      await p.waitForTimeout(500);
      const r = await p.evaluate(audit);
      if (errs.length) r.out.push("คอนโซล: " + errs.splice(0).slice(0, 2).join(" | "));
      r.out.forEach(x => problems.push(role + "/" + k + ": " + x));
      looks.push({ where: role + "/" + k, ...r });
    }
    await ctx.close();
  }
  return { problems, looks };
}

for (const [vp, dark] of [[{ width: 320, height: 640 }], [{ width: 360, height: 640 }], [{ width: 390, height: 844 }], [{ width: 1366, height: 768 }], [{ width: 390, height: 844 }, true]]) {
  test("ทุกบทบาท × ทุกเมนู ที่จอ " + vp.width + "×" + vp.height + (dark ? " โหมดมืด" : "") + ": หลักหน้าจอครบ + หน้าตาชุดเดียวกัน", async () => {
    const { problems, looks } = await sweep(vp, dark);
    assert.deepEqual(problems, [], "\n" + problems.join("\n"));
    // หน้าตาทุกบทบาทชุดเดียวกัน: ปุ่มหลัก/การ์ดใช้มุม สี ฟอนต์ เดียวกัน
    const same = (pick, what) => { const set = new Set(looks.map(pick).filter(Boolean).map(x => JSON.stringify(x))); assert.ok(set.size <= 1, what + " ต่างกันระหว่างบทบาท: " + [...set].join(" / ")); };
    same(l => l.pri, "ปุ่มหลัก"); same(l => l.card, "การ์ด"); same(l => l.body, "ฟอนต์");
  });
}
