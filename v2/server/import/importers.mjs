// ============================================================
//  ตัวนำเข้า (รันซ้ำได้ ไม่เบิ้ล) — แปลงหนึ่งหน้าของชีตเดิม → ops ของท่อเขียนกลาง          v2/server/import/importers.mjs
//  หลัก: import_map(source, source_key) จำว่าแถวต้นทางไหนกลายเป็นแถวไหน + ลายนิ้วมือเนื้อแถว (ไม่เปลี่ยน = ข้าม)
//        ลูกค้า/สินค้า/เครื่อง = เติมช่องที่ว่าง ไม่ทับของเดิม (PALM-WAY §5) · พนักงาน = ชีต Staff เป็นตัวจริง (ทับได้)
//        บิลจากชีทบัญชี = ชีทบัญชีเป็นตัวจริง → แถวที่มาจากชีทบัญชีอัปเดตตามได้ · แถวที่ v2 ลงเองไม่แตะเด็ดขาด
//        ออเดอร์/รอบผลิตเก่า = ประวัติ ติดป้าย src · ไม่สร้างงานผลิต/สกรีน ไม่แตะสต๊อก
// ============================================================
import { iso, thaiDay, specKey, specLabel, newId } from "../core.mjs";
import { sha256Hex } from "../ticket.mjs";
import { nameKey, splitCustomerText, matchCustomer, thaiDate, thaiTime, parseLegacyNote, intOf, satangOf, colOf } from "./legacy.mjs";
import { PRODUCTS, MACHINES } from "./reference.generated.mjs";

const DEPT_ROLE = { "ออฟฟิศ": "office", "ผลิต": "prod", "สกรีน": "screen", "ส่งของ": "deliver", "บัญชี": "account", "บริหาร": "exec" };
export const rolesOfDept = d => [...new Set(String(d || "").split(/[,/\s]+/).map(x => DEPT_ROLE[x.trim()]).filter(Boolean))];
const chunk = (a, n) => { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };
const rowHash = async r => (await sha256Hex(JSON.stringify(r))).slice(0, 24);
const fill = (cur, inc) => { const set = {}; for (const [k, v] of Object.entries(inc)) if (v !== "" && v !== null && v !== undefined && (cur[k] === "" || cur[k] === null || cur[k] === undefined)) set[k] = v; return set; };
const mapSql = (X, source, key, entity, id, hash) => ({ op: "raw", sql: `INSERT INTO import_map(source, source_key, entity, entity_id, hash, first_at, last_at) VALUES (?,?,?,?,?,?,?)
  ON CONFLICT(source, source_key) DO UPDATE SET entity = excluded.entity, entity_id = excluded.entity_id, hash = excluded.hash, last_at = excluded.last_at`, args: [source, key, entity, id, hash, iso(X.now), iso(X.now)] });

async function loadMap(X, source, keys) {
  const m = new Map();
  for (const part of chunk([...new Set(keys)], 90)) {
    if (!part.length) continue;
    (await X.db.all(`SELECT source_key, entity_id, hash FROM import_map WHERE source = ? AND source_key IN (${part.map(() => "?").join(",")})`, source, ...part)).forEach(r => m.set(r.source_key, r));
  }
  return m;
}
async function byIds(X, table, pk, ids) {
  const m = new Map();
  for (const part of chunk([...new Set(ids.filter(Boolean))], 90)) {
    (await X.db.all(`SELECT * FROM ${table} WHERE ${pk} IN (${part.map(() => "?").join(",")})`, ...part)).forEach(r => m.set(String(r[pk]), r));
  }
  return m;
}
async function customerIndex(X) {
  const [cs, al] = await X.db.reads([["SELECT id, name_key FROM customers WHERE merged_into IS NULL"], ["SELECT alias_key, customer_id FROM customer_aliases"]]);
  return { byKey: new Map(cs.map(c => [c.name_key, c.id])), alias: new Map(al.map(a => [a.alias_key, a.customer_id])) };
}
const S = () => ({ inserted: 0, updated: 0, skipped: 0 });

// ── พนักงาน (ชีต Staff ผ่านสะพาน — ไม่มี PIN มีแต่ลายนิ้วมือ) ─────────────────────────
export async function importStaff(X, page) {
  const st = S(), ops = [], problems = [];
  const h = page.head;
  const at = { id: h.indexOf("Staff_ID"), name: h.indexOf("ชื่อ"), nick: h.indexOf("ชื่อเล่น"), dept: h.indexOf("แผนก"), status: h.indexOf("สถานะ"), pf: h.indexOf("pf") };
  const rows = page.rows.filter(r => String(r[at.id] || "").trim() && String(r[at.nick] || "").trim());
  const cur = await byIds(X, "staff", "id", rows.map(r => String(r[at.id]).trim()));
  const roleRows = await X.db.all("SELECT staff_id, role, active FROM staff_roles");
  const pfAt = Number(page.pfAt) || X.now;
  for (const r of rows) {
    const id = String(r[at.id]).trim();
    const status = ["ทำงาน", "พัก", "ลาออก"].includes(String(r[at.status]).trim()) ? String(r[at.status]).trim() : "พัก";   // สถานะว่าง/แปลก = เข้าไม่ได้ (กันแอบเพิ่มคนผ่านชีต)
    const row = { name: String(r[at.name] || "").trim(), nick: String(r[at.nick]).trim(), dept_th: String(r[at.dept] || "").trim(), status };
    const pf = String(r[at.pf] || "").trim();
    const c = cur.get(id);
    if (!c) {
      ops.push({ op: "insert", table: "staff", row: { id, ...row, pin_fp: pf, pf_at: pf ? pfAt : 0, src: "pk:Staff" } });
      st.inserted++;
    } else {
      const set = {};
      for (const k of Object.keys(row)) if (c[k] !== row[k]) set[k] = row[k];
      if (pf !== c.pin_fp && pfAt > Number(c.pf_at)) { set.pin_fp = pf; set.pf_at = pfAt; }   // PIN ในชีตเปลี่ยนหลังตั๋วล่าสุด = ตั๋วเก่าตาย
      if (Object.keys(set).length) { ops.push({ op: "update", table: "staff", id, expect: c.version, before: c, set }); st.updated++; } else st.skipped++;
    }
    const want = rolesOfDept(row.dept_th);
    for (const role of want) if (!roleRows.some(x => x.staff_id === id && x.role === role && x.active === 1)) ops.push({ op: "raw", sql: "INSERT INTO staff_roles(staff_id, role, active) VALUES (?,?,1) ON CONFLICT(staff_id, role) DO UPDATE SET active = 1", args: [id, role] });
    for (const x of roleRows) if (x.staff_id === id && x.active === 1 && !want.includes(x.role)) ops.push({ op: "raw", sql: "UPDATE staff_roles SET active = 0 WHERE staff_id = ? AND role = ?", args: [id, x.role] });
    if (!want.length && status === "ทำงาน") problems.push(row.nick + ": แผนก \"" + row.dept_th + "\" ไม่ตรงบทบาทใน v2 — เข้าแอป v2 ไม่ได้จนกว่าจะแก้แผนก");
  }
  return { ops, stats: st, problems };
}

// ── ลูกค้า: P&K_ลูกค้า (มีสาย/อำเภอ) · PKSystem Customers (มีรหัส) · ชื่อในชีทบัญชี ─────────────
export async function importCustomers(X, page, source) {
  const st = S(), ops = [], problems = [];
  const h = page.head;
  const isPk = source === "pk:Customers";
  const at = isPk
    ? { id: h.indexOf("Customer_ID"), name: h.indexOf("ชื่อลูกค้า"), phone: h.indexOf("เบอร์โทร"), address: h.indexOf("ที่อยู่"), credit: h.indexOf("เครดิต(วัน)"), note: h.indexOf("หมายเหตุ"), route: h.indexOf("เส้นทาง"), district: h.indexOf("อำเภอ"), sub: h.indexOf("ตำบล"), map: h.indexOf("พิกัด") }
    : { id: -1, name: h.indexOf("ลูกค้า") >= 0 ? h.indexOf("ลูกค้า") : h.indexOf("รายชื่อลูกค้า"), phone: h.indexOf("เบอร์"), address: h.indexOf("ที่อยู่"), credit: -1, note: h.indexOf("หมายเหตุ"), route: h.indexOf("เส้นทาง-2"), district: h.indexOf("อำเภอ"), sub: h.indexOf("ตำบล"), map: h.indexOf("โลเคชั่นลิงก์") };
  const g = (r, i) => (i >= 0 ? String(r[i] == null ? "" : r[i]).trim() : "");
  const idx = await customerIndex(X);
  const rows = page.rows.filter(r => g(r, at.name));
  const keys = rows.map(r => (isPk ? g(r, at.id) || nameKey(g(r, at.name)) : nameKey(g(r, at.name))));
  const map = await loadMap(X, source, keys);
  const routes = new Set((await X.db.all("SELECT code FROM routes")).map(r => r.code));
  const hashes = await Promise.all(rows.map(rowHash));
  const touched = [];
  rows.forEach((r, i) => { const m = map.get(keys[i]); const hit = m ? m.entity_id : (matchCustomer(g(r, at.name), idx) || {}).id; if (hit) touched.push(hit); });
  const cur = await byIds(X, "customers", "id", touched);
  const seenNew = new Map();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], key = keys[i];
    const m = map.get(key);
    if (m && m.hash === hashes[i]) { st.skipped++; continue; }
    const name = g(r, at.name);
    const route = g(r, at.route).replace(/\.0$/, "");
    if (route && !routes.has(route)) { routes.add(route); ops.push({ op: "raw", sql: "INSERT INTO routes(code, name, area, pos, src, created_at, updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(code) DO NOTHING", args: [route, "สาย " + route, /^2/.test(route) ? "ไกล" : /^1/.test(route) ? "ใกล้" : "", Number(route) || 0, source, iso(X.now), iso(X.now)] }); }
    const credit = intOf(g(r, at.credit));
    const inc = { phone: g(r, at.phone), address: g(r, at.address), district: g(r, at.district), subdistrict: g(r, at.sub), route_code: route || null, map_url: g(r, at.map), note: g(r, at.note), credit_days: credit && credit > 0 && credit <= 365 ? credit : null };
    let id = m ? m.entity_id : null;
    if (!id) { const hit = matchCustomer(name, idx); if (hit) id = hit.id; }
    if (!id && isPk && g(r, at.id) && !cur.has(g(r, at.id))) {
      const ex = await X.db.first("SELECT id FROM customers WHERE id = ?", g(r, at.id));
      if (ex) id = ex.id;
    }
    if (id && cur.has(id)) {
      const set = fill(cur.get(id), inc);
      if (set.credit_days === null) delete set.credit_days;
      if (Object.keys(set).length) { ops.push({ op: "update", table: "customers", id, expect: cur.get(id).version, before: cur.get(id), set, undo: false }); cur.get(id).version++; Object.assign(cur.get(id), set); st.updated++; } else st.skipped++;
    } else if (id && seenNew.has(id)) {
      st.skipped++;
    } else {
      id = id || (isPk && g(r, at.id)) || "C" + newId("", X.now);
      const row = { id, name, name_key: nameKey(name), src: source, ...Object.fromEntries(Object.entries(inc).filter(([, v]) => v !== "" && v !== null)) };
      ops.push({ op: "insert", table: "customers", row, undo: false });
      idx.byKey.set(row.name_key, id); seenNew.set(id, true); st.inserted++;
    }
    ops.push(mapSql(X, source, key, "customers", id, hashes[i]));
  }
  return { ops, stats: st, problems };
}

// ── สินค้า/SKU จากทะเบียนใน repo (docs/products/products-master.csv) ───────────────
const CAT_TYPE = { BOT: "ขวด", TNK: "ถัง", CAP: "ฝา" };
export async function importProducts(X) {
  const st = S(), ops = [];
  const cur = await byIds(X, "products", "id", PRODUCTS.map(p => p.SKU));
  for (const p of PRODUCTS) {
    const type = /PREFORM/.test(p.SKU) ? "พรีฟอร์ม" : /^PK-FLM-NECK/.test(p.SKU) ? "ฟิล์มหุ้มคอ" : /^PK-FLM-PACK/.test(p.SKU) ? "ฟิล์มแพ็คโหล" : CAT_TYPE[p["หมวด"]] || null;
    const shape = ["เรียบ", "เพชร", "MK", "เหลี่ยม"].includes(p["ทรง/แบบ"]) ? p["ทรง/แบบ"] : "";
    const it = { type: type || "", size: type === "ขวด" ? p["ขนาด"] : "", neck: "", shape, color: p["สี"] === "ตามแบรนด์" ? "" : p["สี"] };
    const perPack = intOf((/^(\d[\d,]*)/.exec(p["จำนวนต่อหน่วยใหญ่"] || "") || [])[1]) || 0;
    const row = {
      id: p.SKU, category: p["หมวด"], name: p["ชื่อสินค้า"], type, size: it.size, neck: "", shape, color: it.color, spec_key: type ? specKey(it) : "",
      sale_unit: p["หน่วยขาย"] || "ชิ้น", per_pack: perPack, data_status: p["สถานะข้อมูล"] === "ยืนยันแล้ว" ? "ยืนยันแล้ว" : "รอยืนยัน",
      note: [p["หมายเหตุ"], p["ราคาอ้างอิง(บาท)"] ? "ราคาอ้างอิงจากบิลจริง " + p["ราคาอ้างอิง(บาท)"] + " บ. (ไม่ใช่ราคาตั้ง — ราคาตั้งโดยประธานเท่านั้น)" : "", p["ที่มา"] ? "ที่มา: " + p["ที่มา"] : ""].filter(Boolean).join(" · "),
      src: "ref:products",
    };
    const c = cur.get(p.SKU);
    if (!c) { ops.push({ op: "insert", table: "products", row, undo: false }); st.inserted++; continue; }
    const set = fill(c, row);
    if (c.src === "ref:products" && c.data_status !== row.data_status) set.data_status = row.data_status;   // ทะเบียนยืนยันเพิ่ม = ตามได้
    if (Object.keys(set).length) { ops.push({ op: "update", table: "products", id: p.SKU, expect: c.version, before: c, set, undo: false }); st.updated++; } else st.skipped++;
  }
  return { ops, stats: st, problems: [] };
}

// ── เครื่องจักร + ตำแหน่งในผัง (v2/db/reference/factory.json) ────────────────────────
export async function importMachines(X) {
  const st = S(), ops = [];
  const cur = await byIds(X, "machines", "id", MACHINES.map(m => m.id));
  for (const m of MACHINES) {
    const row = { id: m.id, name: m.name, kind: m.kind, plant: m.plant, pos_x: m.pos_x, pos_y: m.pos_y, w: m.w, h: m.h, makes: m.makes, rating: m.rating, legacy_name: m.legacy_name, note: m.note, src: "ref:factory" };
    const c = cur.get(m.id);
    if (!c) { ops.push({ op: "insert", table: "machines", row, undo: false }); st.inserted++; continue; }
    const set = fill(c, row);
    // ตำแหน่งในผังของเครื่องที่ยังไม่มีใครย้ายในแอป (src ยังเป็นทะเบียน) = ตามทะเบียน
    if (c.src === "ref:factory") for (const k of ["pos_x", "pos_y", "w", "h", "plant"]) if (c[k] !== row[k]) set[k] = row[k];
    if (Object.keys(set).length) { ops.push({ op: "update", table: "machines", id: m.id, expect: c.version, before: c, set, undo: false }); st.updated++; } else st.skipped++;
  }
  return { ops, stats: st, problems: [] };
}

// ── ออเดอร์เก่า (ชีต "Order" ของ AppSheet) — ประวัติ ────────────────────────────────
export async function importLegacyOrders(X, page) {
  const st = S(), ops = [], problems = [];
  const h = page.head, c = n => h.indexOf(n);
  const g = (r, n) => { const i = c(n); return i < 0 ? "" : String(r[i] == null ? "" : r[i]).trim(); };
  const rows = page.rows.filter(r => g(r, "ID") && g(r, "ลูกค้า"));
  const ids = rows.map(r => "เก่า-" + g(r, "ID"));
  const map = await loadMap(X, "legacy:order", ids);
  const cur = await byIds(X, "orders", "id", ids);
  const idx = await customerIndex(X);
  const sizes = new Map((await X.db.all("SELECT type, size, per_bag FROM type_sizes")).map(s => [s.type + "|" + s.size, s.per_bag]));
  const types = new Map((await X.db.all("SELECT code, axes FROM product_types")).map(t => [t.code, t.axes]));
  const staffByNick = new Map((await X.db.all("SELECT id, nick FROM staff")).map(s => [s.nick, s.id]));
  const hashes = await Promise.all(rows.map(rowHash));
  let unmatched = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], id = ids[i];
    const m = map.get(id);
    if (m && m.hash === hashes[i]) { st.skipped++; continue; }
    const day = thaiDate(g(r, "วันที่สั่งซื้อ"));
    if (!day) { problems.push("ออเดอร์ " + g(r, "ID") + ": วันที่สั่งซื้ออ่านไม่ได้ (\"" + g(r, "วันที่สั่งซื้อ") + "\") — ข้าม"); st.skipped++; continue; }
    const n = parseLegacyNote(g(r, "หมายเหตุ"));
    const status = g(r, "สถานะ") === "ยกเลิก" ? "ยกเลิก" : "ส่งแล้ว";   // แบบเดียวกับ importLegacyOrders ใน gas/Code.gs (ประวัติ)
    const o = cur.get(id);
    if (o) {
      // ต้นทางเปลี่ยน (แอปเดิมยังใช้ทุกวัน) — อัปเดตเฉพาะออเดอร์ที่ยังเป็นของนำเข้า ไม่มีใครแก้ใน v2
      if (o.src === "legacy:order" && o.status !== status) { ops.push({ op: "update", table: "orders", id, expect: o.version, before: o, set: { status, note: n.rest }, undo: false }); st.updated++; } else st.skipped++;
      ops.push(mapSql(X, "legacy:order", id, "orders", id, hashes[i]));
      continue;
    }
    const sp = splitCustomerText(g(r, "ลูกค้า"));
    let hit = matchCustomer(sp.name, idx);
    let custId = hit && hit.id;
    if (!custId) {
      custId = "C" + newId("", X.now);
      ops.push({ op: "insert", table: "customers", row: { id: custId, name: sp.name, name_key: nameKey(sp.name), needs_review: 1, src: "legacy:order" }, undo: false });
      idx.byKey.set(nameKey(sp.name), custId);
      unmatched++;
    } else if (hit.how !== "ตรงตัว" || nameKey(g(r, "ลูกค้า")) !== nameKey(sp.name)) {
      ops.push({ op: "raw", sql: "INSERT INTO customer_aliases(alias_key, alias, customer_id, src, created_at) VALUES (?,?,?,?,?) ON CONFLICT(alias_key) DO NOTHING", args: [nameKey(g(r, "ลูกค้า")), g(r, "ลูกค้า"), custId, "legacy:order", iso(X.now)] });
    }
    const type = g(r, "ประเภทสินค้า"), size = g(r, "ขนาด");
    const it = { type, size, neck: g(r, "คอขวด"), shape: g(r, "รูปทรง"), color: g(r, "สี") };
    const bags = intOf(g(r, "จำนวน (ถุง)")) || 0, extra = intOf(g(r, "และซื้อย่อย (ใบ)")) || 0, piece = intOf(g(r, "จำนวน (ชิ้น)")) || 0;
    let total = intOf(g(r, "รวมทั้งหมด (ใบ)")) || 0;
    let per = sizes.get(type + "|" + size) || 0;
    if (!total) total = piece || (bags && per ? bags * per + extra : extra);
    // ตัวเลขต้นทางไม่ลงตัว (ถุง × ใบต่อถุง ≠ รวม) = เก็บรวมตามจริง ไม่เดา · ถุงไปอยู่ในหมายเหตุรายการ
    let itBags = bags, itNote = "";
    if (bags && per && total !== bags * per + extra) { itNote = "ต้นทาง: " + bags + " ถุง + " + extra + " ใบ (รวมที่จดไว้ " + total + ")"; itBags = 0; per = 0; }
    if (bags && !per) { itNote = "ต้นทาง: " + bags + " ถุง (ไม่รู้ใบต่อถุง)"; itBags = 0; }
    const priceSatang = satangOf(g(r, "ราคาต่อหน่วย"));
    ops.push({ op: "insert", table: "orders", undo: false, row: {
      id, order_day: day, customer_id: custId, customer_text: g(r, "ลูกค้า"), brand: g(r, "แบรนด์") || sp.brand,
      taker_staff_id: staffByNick.get(g(r, "ผู้รับออเดอร์")) || null, taker_text: g(r, "ผู้รับออเดอร์"),
      due_day: thaiDate(g(r, "ส่งภายในวันที่")), status, purchase_type: ["ขายราคาโรงงาน", "ขายหน้าร้าน"].includes(g(r, "ประเภทการซื้อ")) ? g(r, "ประเภทการซื้อ") : "",
      pay_status: n.pay || "", design_status: n.design || "", block_fee_satang: n.blockFeeBaht ? n.blockFeeBaht * 100 : null, urgent: n.urgent ? 1 : 0,
      has_screen: g(r, "สีสกรีน") ? 1 : 0, screen_team: g(r, "ทีมสกรีน"), done_bags: n.doneBags || null, pending_bags: n.pendingBags || null,
      pending_reason: n.pendingReason || "", finished_day: n.finished || "", delivered_day: status === "ส่งแล้ว" ? n.finished || "" : "",
      total_satang: priceSatang !== null && total ? Math.round(priceSatang * total) : null,
      note: [n.rest, sp.note].filter(Boolean).join(" · "), src: "legacy:order",
    } });
    ops.push({ op: "insert", table: "order_items", undo: false, row: {
      id: id + "-1", order_id: id, line_no: 1, ...it, screen_color: g(r, "สีสกรีน"), cap_color: g(r, "พร้อมฝาสี"),
      spec_key: specKey(it, types.get(type)), label: specLabel(it), bags: itBags, per_bag: itBags ? per : 0, extra_pcs: itBags ? extra : 0, qty_pcs: total,
      price_satang: priceSatang, note: itNote, src: "legacy:order",
    } });
    ops.push(mapSql(X, "legacy:order", id, "orders", id, hashes[i]));
    st.inserted++;
  }
  if (unmatched) ops.push({ op: "flag", kind: "ลูกค้าจับคู่ไม่ได้", team: "office", title: "ลูกค้าจากออเดอร์เก่าจับคู่ทะเบียนไม่ได้", detail: "สร้างเป็นลูกค้า \"รอตรวจ\" ไว้ก่อน — ต้องรวมกับรายเดิม/ยืนยันเป็นรายใหม่", dedupe_key: "import:legacy:order:unmatched" });
  if (unmatched) problems.push("ลูกค้าจับคู่ไม่ได้ " + unmatched + " ราย (สร้างเป็น \"รอตรวจ\")");
  return { ops, stats: st, problems };
}

// ── รอบผลิตเก่า (Stock Management › ProductionLog) — ประวัติ ไม่แตะสต๊อก ─────────────────────
export async function importLegacyRuns(X, page) {
  const st = S(), ops = [], problems = [];
  const h = page.head;
  const col = { id: colOf(h, "ID"), day: colOf(h, "วันที่"), start: colOf(h, "เวลาเริ่มเครื่อง"), end: colOf(h, "เวลาเปลี่ยนสี/ปิดเครื่อง", "เวลาปิดเครื่อง"), status: colOf(h, "สถานะ"),
    ops: colOf(h, "ผู้ปฏิบัติงาน"), machine: colOf(h, "เครื่อง"), type: colOf(h, "ประเภทสินค้า"), size: colOf(h, "ขนาด"), neck: colOf(h, "คอขวด"), shape: colOf(h, "รูปทรง"), color: colOf(h, "สี"),
    good: colOf(h, "ผลิตได้"), b: colOf(h, "เกรด B", "เกรดB"), waste: colOf(h, "ของเสีย"), note: colOf(h, "หมายเหตุ") };
  const missing = ["day", "start", "machine", "type", "good"].filter(k => col[k] < 0);
  if (missing.length) return { ops, stats: st, problems: ["หัวคอลัมน์ไม่ครบ (" + missing.join(", ") + ") — ตรวจหัวชีต ProductionLog จริงก่อน ระบบไม่เดา"], fatal: true };
  const g = (r, k) => (col[k] < 0 ? "" : String(r[col[k]] == null ? "" : r[col[k]]).trim());
  const rows = page.rows.filter(r => g(r, "day") && g(r, "machine"));
  const hashes = await Promise.all(rows.map(rowHash));
  const keys = rows.map((r, i) => (g(r, "id") || "h" + hashes[i]));
  const map = await loadMap(X, "legacy:stock:ProductionLog", keys);
  const machines = await X.db.all("SELECT id, name, legacy_name FROM machines");
  const mByName = new Map(); machines.forEach(m => { mByName.set(m.name, m.id); if (m.legacy_name) mByName.set(m.legacy_name, m.id); });
  const types = new Map((await X.db.all("SELECT code, axes FROM product_types")).map(t => [t.code, t.axes]));
  const staffByNick = new Map((await X.db.all("SELECT id, nick FROM staff")).map(s => [s.nick, s.id]));
  let stuck = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], key = keys[i];
    if (map.has(key)) { st.skipped++; continue; }   // ประวัติ: นำเข้าแล้วไม่ทับ (แก้ในชีตเดิมหลังนำเข้า = ไม่ตาม · ดูหมายเหตุใน SCHEMA.md)
    const day = thaiDate(g(r, "day"));
    const startAt = thaiTime(day, g(r, "start"));
    if (!day || !startAt) { problems.push("รอบ " + key + ": วันที่/เวลาเริ่มอ่านไม่ได้ — ข้าม"); st.skipped++; continue; }
    let endAt = thaiTime(day, g(r, "end"));
    if (endAt && endAt < startAt) endAt = new Date(Date.parse(endAt) + 864e5).toISOString();   // ปิดหลังเที่ยงคืน
    let mid = mByName.get(g(r, "machine"));
    if (!mid) {
      mid = "LM" + (await sha256Hex(g(r, "machine"))).slice(0, 8).toUpperCase();
      if (!mByName.has("#" + mid)) { ops.push({ op: "raw", sql: "INSERT INTO machines(id, name, kind, legacy_name, note, src, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING", args: [mid, g(r, "machine"), "อื่น", g(r, "machine"), "เจอในประวัติแอปเดิม ไม่อยู่ในทะเบียน — รอจับคู่", "legacy:stock", iso(X.now), iso(X.now)] }); mByName.set("#" + mid, mid); }
      mByName.set(g(r, "machine"), mid);
    }
    const open = !endAt;
    if (open) stuck++;
    const it = { type: g(r, "type"), size: g(r, "size"), neck: g(r, "neck"), shape: g(r, "shape"), color: g(r, "color") };
    const id = "L-" + key;
    ops.push({ op: "insert", table: "machine_runs", undo: false, row: {
      id, machine_id: mid, ...it, spec_key: specKey(it, types.get(it.type)), started_at: startAt, started_day: day,
      ended_at: endAt, ended_day: endAt ? thaiDay(Date.parse(endAt)) : "", end_kind: endAt ? "ปิดรอบ" : "",
      good_pcs: intOf(g(r, "good")), grade_b_pcs: intOf(g(r, "b")), waste_pcs: intOf(g(r, "waste")),
      status: open ? "ค้างจากระบบเดิม" : "ปิดแล้ว", note: g(r, "note"), src: "legacy:stock",
    } });
    for (const nm of g(r, "ops").split(/\s*[,،、]\s*|\s+และ\s+/).map(x => x.trim()).filter(Boolean)) {
      ops.push({ op: "raw", sql: "INSERT INTO run_operators(run_id, name_text, staff_id) VALUES (?,?,?) ON CONFLICT DO NOTHING", args: [id, nm, staffByNick.get(nm) || null] });
    }
    ops.push(mapSql(X, "legacy:stock:ProductionLog", key, "machine_runs", id, hashes[i]));
    st.inserted++;
  }
  if (stuck) ops.push({ op: "flag", kind: "รอบค้าง", team: "prod", title: "รอบเครื่องค้าง \"กำลังผลิต\" จากแอปเดิม", detail: "นำเข้าเป็นสถานะ \"ค้างจากระบบเดิม\" (ไม่นับว่าเครื่องเดินอยู่) — ไล่ปิดในแอปเดิมหรือในหน้าทีมผลิต", dedupe_key: "import:legacy:runs:stuck" });
  return { ops, stats: st, problems };
}

// ── บิลจากชีท "ระบบบัญชี" (อ่านอย่างเดียว · ชีทบัญชีเป็นตัวจริง) ─────────────────────────
//   เหมือน importLegacyAccounting() ใน gas/Code.gs: Bill_No = 'เก่า-<แท็บ>-<เลข>' · แท็บลูกหนี้ใช้ "ยอดค้าง"+"สถานะ" · ระวัง "ค้างจ่าย" มีคำว่า "จ่าย"
const SYNC_FIELDS = ["bill_day", "customer_name", "total_satang", "kind", "status", "pay_channel", "paid_day", "note"];
export async function importAcct(X, page) {
  const st = S(), ops = [], problems = [];
  const h = page.head, tab = page.tab;
  if (h.indexOf("รายชื่อลูกค้า") >= 0) return importCustomers(X, page, "acct:customers");
  const c = n => h.indexOf(n);
  const isAR = c("ยอดค้าง") >= 0;
  const yHint = (/(\d{4})/.exec(tab) || [])[1];
  const g = (r, n) => { const i = c(n); return i < 0 ? "" : String(r[i] == null ? "" : r[i]).trim(); };
  const rows = page.rows.filter(r => g(r, "เลขที่บิล") && g(r, "ชื่อลูกค้า") && g(r, "เลขที่บิล") !== "เลขที่บิล");
  const ids = rows.map(r => "เก่า-" + tab + "-" + g(r, "เลขที่บิล"));
  const cur = await byIds(X, "bills", "bill_no", ids);
  const idx = await customerIndex(X);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], id = ids[i];
    const day = thaiDate(g(r, c("วันที่") >= 0 ? "วันที่" : h[0]), yHint);
    if (!day) { problems.push(tab + " บิล " + g(r, "เลขที่บิล") + ": วันที่อ่านไม่ได้ (\"" + g(r, "วันที่") + "\") — ข้าม"); st.skipped++; continue; }
    let row;
    if (isAR) {
      const owe = satangOf(g(r, "ยอดค้าง"));
      if (!owe) { st.skipped++; continue; }
      const s = g(r, "สถานะ");
      const paid = s.indexOf("ค้าง") < 0 && (s.indexOf("จ่าย") >= 0 || s.indexOf("ชำระ") >= 0 || s.indexOf("เก็บ") >= 0);
      row = { bill_day: day, customer_name: g(r, "ชื่อลูกค้า"), total_satang: owe, kind: "เครดิต", status: paid ? "ชำระแล้ว" : "ค้างชำระ", pay_channel: g(r, "ช่องทางชำระ"),
        paid_day: paid ? day : "", note: [g(r, "หมายเหตุ"), paid ? "วันที่ชำระจริงไม่มีในชีท (ใช้วันที่บิล)" : ""].filter(Boolean).join(" · ") };
    } else {
      const cash = satangOf(g(r, "เงินสด")) || 0, credit = satangOf(g(r, "เครดิต")) || 0;
      if (!cash && !credit) { st.skipped++; continue; }
      row = { bill_day: day, customer_name: g(r, "ชื่อลูกค้า"), total_satang: cash + credit, kind: credit ? "เครดิต" : "เงินสด", status: credit ? "ค้างชำระ" : "ชำระแล้ว",
        pay_channel: g(r, "ช่องทางชำระ"), paid_day: credit ? "" : day, note: g(r, "หมายเหตุ") };
    }
    const b = cur.get(id);
    if (!b) {
      const name = row.customer_name;
      const hit = name === "สด" || name === "สดเซล" ? null : matchCustomer(name, idx);
      ops.push({ op: "insert", table: "bills", undo: false, row: { bill_no: id, ...row, customer_id: hit ? hit.id : null, paid_satang: row.status === "ชำระแล้ว" ? row.total_satang : 0, src: "acct:" + tab } });
      st.inserted++;
    } else if (String(b.src).indexOf("acct:") === 0) {
      const set = {};
      for (const f of SYNC_FIELDS) if (String(b[f] ?? "") !== String(row[f] ?? "")) set[f] = row[f];
      if (set.status) set.paid_satang = set.status === "ชำระแล้ว" ? row.total_satang : 0;
      if (Object.keys(set).length) { ops.push({ op: "update", table: "bills", id, expect: b.version, before: b, set, undo: false }); st.updated++; } else st.skipped++;
    } else st.skipped++;   // บิลที่ v2 ลงเอง — ไม่แตะเด็ดขาด
  }
  return { ops, stats: st, problems };
}

export const SOURCES = {
  "ref:products": { label: "ทะเบียนสินค้า (ใน repo)", local: true, run: importProducts },
  "ref:machines": { label: "ทะเบียนเครื่องจักร + ผัง (ใน repo)", local: true, run: importMachines },
  "staff": { label: "พนักงาน (ชีต Staff — ไม่มี PIN)", run: importStaff },
  "legacy:customer": { label: "ทะเบียนลูกค้าเดิม (P&K_ลูกค้า)", run: (X, p) => importCustomers(X, p, "legacy:customer") },
  "pk:Customers": { label: "ลูกค้าในระบบปัจจุบัน (PKSystem)", run: (X, p) => importCustomers(X, p, "pk:Customers") },
  "legacy:order": { label: "ออเดอร์เก่า (AppSheet Order)", run: importLegacyOrders },
  "legacy:stock:ProductionLog": { label: "รอบผลิตเก่า (Stock Management)", run: importLegacyRuns },
  "acct": { label: "บิลจากชีทระบบบัญชี (อ่านอย่างเดียว)", run: importAcct },
};
