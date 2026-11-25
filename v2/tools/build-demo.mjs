// ============================================================
//  สร้างเดโมทั้งระบบเป็นไฟล์ HTML เดียว (หน้าเว็บจริง + หลังบ้านจริงรันในเบราว์เซอร์ · ข้อมูลสมมติ)
//    node v2/tools/build-demo.mjs [--out v2/dist/demo/pk-v2-demo.html]
//  ผลลัพธ์อยู่ v2/dist/ (ไม่ commit) · เครื่องมือ build (esbuild · sql.js) ลงเองที่ v2/.dev/demo-deps (ไม่ commit · ไม่ใช่ dependency ของแอปจริง)
//  ชั้นเดโม = tools/demo/ (ฐาน sql.js · ดัก fetch · สะพาน PIN จำลอง · หน้าเลือกแอป)
//  หน้าเว็บจริงไม่ถูกแก้ — ตอน bundle แทนข้อความไม่กี่จุด (ลิงก์ ?app= · location.reload · ไฟล์ css/ไอคอน) ดู PATCHES ข้างล่าง
//  ถ้าโค้ดหน้าเว็บเปลี่ยนจนจุดที่แทนหาไม่เจอ → build ล้มพร้อมบอกจุด (ไม่ปล่อยเดโมที่พังเงียบ)
// ============================================================
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const V2 = path.join(HERE, "..");
const WEB = path.join(V2, "web");
const DEPS = path.join(V2, ".dev", "demo-deps");
const PINS = { esbuild: "0.25.12", "sql.js": "1.13.0" };
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(arg("--out", path.join(V2, "dist", "demo", "pk-v2-demo.html")));
const read = p => fs.readFileSync(p, "utf8");

// ── เครื่องมือ build (ลงครั้งแรกครั้งเดียว · รุ่นตายตัว) ──────────────────────────────
function ensureDeps() {
  const ok = Object.entries(PINS).every(([n, v]) => { try { return JSON.parse(read(path.join(DEPS, "node_modules", n, "package.json"))).version === v; } catch (e) { return false; } });
  if (ok) return;
  fs.mkdirSync(DEPS, { recursive: true });
  fs.writeFileSync(path.join(DEPS, "package.json"), JSON.stringify({ private: true, description: "เครื่องมือ build เดโม (tools/build-demo.mjs) — ไม่ commit" }, null, 2));
  console.log("ลงเครื่องมือ build: " + Object.entries(PINS).map(([n, v]) => n + "@" + v).join(" "));
  execSync("npm install --no-audit --no-fund --no-save " + Object.entries(PINS).map(([n, v]) => n + "@" + v).join(" "), { cwd: DEPS, stdio: "inherit" });
}
ensureDeps();
const require = createRequire(path.join(DEPS, "package.json"));
const esbuild = require("esbuild");
const SQLJS = path.join(path.dirname(require.resolve("sql.js/package.json")), "dist");

// ── ข้อมูลที่ฝังในหน้า ────────────────────────────────────────────────────
const WEB_VERSION = JSON.parse(read(path.join(WEB, "version.json"))).web;
if (!read(path.join(WEB, "assets", "app.js")).includes('WEB_VERSION = "' + WEB_VERSION + '"')) throw new Error("WEB_VERSION ใน app.js ไม่ตรง version.json — แก้ให้ตรงก่อน (tools/check.mjs)");
const MIG_DIR = path.join(V2, "db", "migrations");
const MIGRATIONS = fs.readdirSync(MIG_DIR).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort().map(f => [f, read(path.join(MIG_DIR, f))]);
const ROLE_CSS = {};
for (const dir of ["roles", "parts"]) for (const f of fs.readdirSync(path.join(WEB, dir)).filter(f => f.endsWith(".css"))) {
  if (ROLE_CSS[f]) throw new Error("ชื่อไฟล์ css ซ้ำ: " + f);
  ROLE_CSS[f] = read(path.join(WEB, dir, f));
}
const seedFiles = fs.readdirSync(path.join(V2, "tools")).filter(f => /^seed-.*\.mjs$/.test(f)).sort();
const DEMO_BUILD = crypto.createHash("sha256").update(JSON.stringify([MIGRATIONS, seedFiles.map(f => read(path.join(V2, "tools", f)))])).digest("hex").slice(0, 16);
const APP_CSS = read(path.join(WEB, "assets", "tokens.css")) + "\n" + read(path.join(WEB, "assets", "app.css")).replace(/@import url\("tokens\.css"\);\s*/, "");
const ICONS_SVG = read(path.join(WEB, "assets", "icons.svg")).replace(/<!--[\s\S]*?-->/g, "");

// ── จุดที่แทนตอน bundle หน้าเว็บ (ไฟล์ · ข้อความเดิม · ข้อความใหม่ · ต้องเจอกี่ครั้ง (null = กี่ครั้งก็ได้)) ─────────
const PATCHES = [
  ["assets/app.js", "new URLSearchParams(location.search)", "new URLSearchParams(__pkDemo.search())", 1],                 // แอปที่เลือก (?app= ส่งผ่าน Artifact ไม่ได้)
  ["assets/app.js", 'location.pathname + location.search + "#/" + S.mod.nav[0].key', '"#/" + S.mod.nav[0].key', 1],       // เปลี่ยนแค่ # (ในกรอบ Artifact เปลี่ยน path/query ไม่ได้)
  ["assets/ui.js", 'export const ICONS = "assets/icons.svg";', 'export const ICONS = "";', 1],                             // ไอคอน sprite ฝังในหน้าแล้ว
  ["parts/kit.js", "const url = new URL(href, import.meta.url).href;", 'const url = href.split("/").pop();', 1],
  ["parts/kit.js", 'document.head.append(h("link", { rel: "stylesheet", href: url }));', "__pkDemo.css(url);", 1],     // css ของบทบาท = <style> ฝังในหน้า
  ["roles/sdkit.js", 'document.head.append(h("link#sd-css", { rel: "stylesheet", href: "roles/sd.css" }));', '__pkDemo.css("sd.css");', 1],
  ["roles/floor.js", 'add(document.head, h("link", { id: "prod-css", rel: "stylesheet", href: "roles/prod.css" }));', '__pkDemo.css("prod.css");', 1],
  ["roles/exec.js", 'location.href = "?app=" + r;', "__pkDemo.open(r);", 1],                                               // ประธานสลับแอป
  ["assets/app.js", "else delete document.documentElement.dataset.theme;", "else __pkDemo.hostTheme();", 1],                // ไม่ได้เลือกธีมในแอป = ตามธีมที่ผู้ดูเลือกใน Claude (ไม่ลบทิ้ง)
  ["*", "location.reload()", "__pkDemo.reload()", null],                                                                     // โหลดใหม่ = เปิดแอปเดิมใหม่ในหน้านี้
];
const MUST_NOT = [/location\.href\s*=/, /import\.meta/, /rel:\s*"stylesheet"/, /location\.search/];
const hits = new Map();
const webPatch = {
  name: "pk-demo-web-patch",
  setup(b) {
    b.onLoad({ filter: /[\\/]v2[\\/]web[\\/].*\.js$/ }, args => {
      const rel = path.relative(WEB, args.path).split(path.sep).join("/");
      let src = read(args.path);
      for (const [file, from, to] of PATCHES) {
        if (file !== "*" && file !== rel) continue;
        const n = src.split(from).length - 1;
        hits.set(file + "|" + from, (hits.get(file + "|" + from) || 0) + n);
        src = src.split(from).join(to);
      }
      for (const re of MUST_NOT) {
        const code = src.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
        if (re.test(code)) throw new Error("web/" + rel + " มี " + re + " ที่เดโมยังไม่รองรับ — เพิ่มจุดแทนใน PATCHES ของ tools/build-demo.mjs");
      }
      return { contents: src, loader: "js" };
    });
  },
};
const dataModule = {
  name: "pk-demo-data",
  setup(b) {
    b.onResolve({ filter: /^pk-demo-data$/ }, () => ({ path: "pk-demo-data", namespace: "pk-demo" }));
    b.onLoad({ filter: /.*/, namespace: "pk-demo" }, () => ({
      contents: "export const MIGRATIONS = " + JSON.stringify(MIGRATIONS) + ";\nexport const ROLE_CSS = " + JSON.stringify(ROLE_CSS) + ";\nexport const WEB_VERSION = " + JSON.stringify(WEB_VERSION) + ";\nexport const DEMO_BUILD = " + JSON.stringify(DEMO_BUILD) + ";\n",
      loader: "js",
    }));
  },
};
const common = { bundle: true, write: false, format: "iife", platform: "browser", target: "es2020", charset: "utf8", minify: true, legalComments: "none", logLevel: "warning" };

const front = await esbuild.build({ ...common, entryPoints: [path.join(WEB, "assets", "app.js")], plugins: [webPatch] });
for (const [file, from, , want] of PATCHES) {
  const n = hits.get(file + "|" + from) || 0;
  if (want === null ? n < 1 : n !== want) throw new Error("จุดแทน " + file + " «" + from + "» เจอ " + n + " ครั้ง (ต้อง " + (want === null ? "≥1" : want) + ") — โค้ดหน้าเว็บเปลี่ยน แก้ PATCHES ใน tools/build-demo.mjs");
}
const frontJs = front.outputFiles[0].text;
for (const role of ["office", "prod", "screen", "deliver", "account", "exec"]) if (!frontJs.includes("roles/" + role + ".js")) throw new Error("bundle หน้าเว็บไม่มี roles/" + role + ".js (import แบบ glob ไม่ทำงาน)");
const back = await esbuild.build({ ...common, entryPoints: [path.join(HERE, "demo", "demo-main.mjs")], plugins: [dataModule] });
const backJs = back.outputFiles[0].text;

// ── ประกอบหน้า (Artifact ห่อ doctype/head/body ให้เอง — ไฟล์นี้เริ่มที่ <title>) ───────────────────────
const safe = js => {
  if (/<!--/.test(js)) js = js.replace(/<!--/g, "<\\!--");
  return js.replace(/<\/script/gi, "<\\/script");
};
const wasmB64 = fs.readFileSync(path.join(SQLJS, "sql-wasm.wasm")).toString("base64");
const SHELL_CSS = `
/* แถบโหมดตัวอย่าง + หน้าเลือกแอป (ใช้ token ของแอปทั้งหมด — สว่าง/มืดตามแอป) */
#demo-bar { display: flex; align-items: center; gap: 8px; min-height: 48px; padding-block: 6px; padding-left: max(12px, env(safe-area-inset-left, 0px)); padding-right: max(12px, env(safe-area-inset-right, 0px)); background: var(--warn-soft); color: var(--warn-ink); border-bottom: 1px solid var(--line); font: 600 13px/1.3 var(--font-display); }
#demo-bar .demo-tag { padding: 3px 10px; border-radius: var(--r-full); background: var(--warn); color: var(--bg); font-weight: 700; letter-spacing: .02em; white-space: nowrap; }
#demo-bar .demo-id { flex: 1 1 auto; min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; }
#demo-bar .demo-msg { min-width: 0; }
#demo-bar .demo-act { flex: none; display: flex; align-items: center; gap: 6px; }
@media (max-width: 420px) { #demo-bar { font-size: 12px; } .demo-btn { padding: 0 11px; } }
#demo-bar .demo-ask { font-weight: 700; }
.demo-btn { min-height: 36px; padding: 0 14px; border-radius: var(--r-full); border: 1.5px solid currentColor; background: transparent; color: inherit; font: 700 13px var(--font-display); cursor: pointer; }
.demo-btn:hover { background: var(--surface); }
.demo-btn.strong { background: var(--warn); border-color: var(--warn); color: var(--bg); }
.demo-pick { max-width: 760px; }
.demo-head { display: grid; gap: var(--sp-2); }
.demo-apps { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: var(--sp-3); }
.demo-app { display: grid; align-content: start; gap: 2px; min-height: 104px; padding: var(--sp-3) var(--sp-4); border: 1.5px solid var(--line); border-radius: var(--r-lg); background: var(--surface); color: var(--ink); text-decoration: none; box-shadow: var(--elev-1); }
.demo-app:hover { border-color: var(--brand); }
.demo-app b { font: 700 19px/1.35 var(--font-display); }
.demo-app .demo-who { margin-top: auto; padding-top: var(--sp-2); font: 600 13px var(--font-display); color: var(--brand-ink); }
.demo-how p b { font-size: 18px; letter-spacing: .08em; }
.demo-limits summary { cursor: pointer; min-height: 28px; display: flex; align-items: center; }
.demo-limits ul { margin: 0; padding-left: 20px; display: grid; gap: 4px; color: var(--ink-2); }
`;
const html = `<title>แอปโรงขวด v2 ตัวอย่าง</title>
<meta name="robots" content="noindex">
<meta name="theme-color" content="#B24A4F">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anuphan:wght@500;600;700;800&family=Sarabun:wght@400;500;600&display=swap">
<!-- เดโมแอปโรงขวด P&K v2 · build ${DEMO_BUILD} · หน้าเว็บ ${WEB_VERSION} · สร้างจาก v2/tools/build-demo.mjs (branch pk-app-v2) · ข้อมูลสมมติทั้งหมด -->
<style>
${APP_CSS}
${SHELL_CSS}
</style>
<div id="demo-bar" role="note" aria-label="โหมดตัวอย่าง"><span class="demo-id"><span class="demo-tag">โหมดตัวอย่าง</span><span class="demo-msg">ข้อมูลสมมติ · ไม่ต่อระบบจริง</span></span><span class="demo-act"></span></div>
<div aria-hidden="true" style="display:none">${ICONS_SVG}</div>
<div id="app" aria-live="polite"><p style="padding:24px">กำลังเปิดแอป…</p></div>
<noscript>ต้องเปิด JavaScript ถึงจะใช้แอปได้</noscript>
<script type="application/octet-stream" id="pk-sqljs-wasm">${wasmB64}</script>
<script>(function () {
${safe(read(path.join(SQLJS, "sql-wasm.js")))}
;window.pkInitSqlWasm = initSqlJs; })();</script>
<script>(function () {
${safe(read(path.join(SQLJS, "sql-asm.js")))}
;window.pkInitSqlAsm = initSqlJs; })();</script>
<script>window.__pkFront = function () {
${safe(frontJs)}
};</script>
<script>${safe(backJs)}</script>
`;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
const mb = Buffer.byteLength(html) / 1048576;
if (mb > 15.5) throw new Error("ไฟล์ใหญ่เกิน (" + mb.toFixed(1) + " MB > 16 MB ของ Artifact)");
console.log("เดโม → " + path.relative(process.cwd(), OUT) + " · " + mb.toFixed(2) + " MB · หน้าเว็บ " + WEB_VERSION + " · build " + DEMO_BUILD + " · หน้าเว็บ " + (frontJs.length / 1024).toFixed(0) + " KB · หลังบ้าน " + (backJs.length / 1024).toFixed(0) + " KB");
