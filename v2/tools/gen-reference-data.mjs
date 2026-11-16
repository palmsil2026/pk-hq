// สร้าง v2/server/import/reference.generated.mjs จากทะเบียนใน repo (หลังบ้านบน Cloudflare อ่านไฟล์ใน repo ตอนรันไม่ได้ จึงฝังเป็นโมดูล)
//   ที่มา: docs/products/products-master.csv (SKU 29 รายการ) · v2/db/reference/factory.json (ทะเบียนเครื่อง + ผังร่าง)
//   node v2/tools/gen-reference-data.mjs [--check]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");
const OUT = path.join(HERE, "..", "server", "import", "reference.generated.mjs");

export function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ""));
}

function build() {
  const csv = parseCsv(fs.readFileSync(path.join(ROOT, "docs", "products", "products-master.csv"), "utf8").replace(/^﻿/, ""));
  const head = csv[0];
  const products = csv.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || "").trim()])));
  const factory = JSON.parse(fs.readFileSync(path.join(HERE, "..", "db", "reference", "factory.json"), "utf8"));
  return "// ⚠️ สร้างโดย v2/tools/gen-reference-data.mjs — ห้ามแก้มือ (แก้ต้นทางแล้วรันใหม่ · CI ตรวจว่าตรง)\n" +
    "// ที่มา: docs/products/products-master.csv · v2/db/reference/factory.json\n" +
    "export const PRODUCTS = " + JSON.stringify(products, null, 1) + ";\n" +
    "export const MACHINES = " + JSON.stringify(factory.machines, null, 1) + ";\n" +
    "export const FLOOR = " + JSON.stringify({ canvas: factory.canvas, buildings: factory.buildings, views: factory.views, areas: factory.areas }, null, 1) + ";\n";   // ผัง: อาคาร · มุมมอง · ห้อง (โมดูลผลิต)
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const body = build();
  if (process.argv.includes("--check")) {
    if (!fs.existsSync(OUT) || fs.readFileSync(OUT, "utf8") !== body) { console.error("✗ reference.generated.mjs ไม่ตรงกับต้นทาง — รัน node v2/tools/gen-reference-data.mjs"); process.exit(1); }
  } else { fs.writeFileSync(OUT, body); console.log("เขียน " + path.relative(ROOT, OUT)); }
}
