// ============================================================
//  ซิงก์บิลจากชีท "ระบบบัญชี" (อ่านอย่างเดียว · ชีทบัญชีเป็นตัวจริง) — โมดูลบัญชีดูแล          v2/server/import/acct.mjs
//  (ย้ายมาจาก importers.mjs › importAcct ของ Foundation — พฤติกรรมเดิมคงไว้ทุกข้อ + เพิ่ม 4 อย่างด้านล่าง)
//
//  เดิม: Bill_No = 'เก่า-<แท็บ>-<เลข>' · แท็บที่มี "ยอดค้าง" = ลูกหนี้ (สถานะตามชีท · ระวัง "ค้างจ่าย" มีคำว่า "จ่าย")
//        แถวที่มาจากชีท (src acct:*) อัปเดตตามชีทได้ · บิลที่ v2 ลงเองไม่แตะเด็ดขาด · ไม่มีทางเขียนกลับชีท
//  เพิ่ม:
//   ① paper_no = เลขที่บิลในชีท · acct_kind = 'รายวัน' / 'ลูกหนี้' (ลูกหนี้ของชีทนับจากแท็บลูกหนี้ — แบบที่ฝ่ายบัญชีนับเอง)
//   ② บิลใบเดียวกับบิลในแอป (เลขกระดาษ + วันที่ ตรงกับบิล v2 ที่ผูกเลขแล้ว) → same_as = บิลในแอป · ไม่นับยอดซ้ำ
//      ยอดไม่ตรงกัน → ธง "ชีทบัญชีไม่ตรงแอป" (คนตัดสิน ไม่เดาว่าใครถูก)
//   ③ จดว่าเห็นบิลไหนในชีทรอบนี้ (acct_seen — ไม่ขยับ version ของบิล)
//   ④ จบรอบครบทุกหน้า: บิลที่หายจากชีท → ยกเลิก (พลิกสถานะ ไม่ลบ) + ธง · หายเยอะผิดปกติ (> 20% หรือไม่เห็นบิลเลย) = ไม่ยกเลิก ขึ้นธงให้คนดู
//
//  รันซ้ำกี่รอบก็ไม่เบิ้ล (คีย์ = เลขบิลเดิม · ค่าไม่เปลี่ยน = ข้าม) · หน้าเดียว = batch เดียว (ล้มทั้งหน้า ไม่ครึ่ง ๆ กลาง ๆ)
// ============================================================
import { moneyMatch, netOf } from "../actions/account-lib.mjs";
import { iso, thaiDay, thDate } from "../core.mjs";
import { thaiDate, satangOf, matchCustomer } from "./legacy.mjs";
import { importCustomers } from "./importers.mjs";

const SYNC_FIELDS = ["bill_day", "customer_name", "total_satang", "kind", "status", "pay_channel", "paid_day", "note"];
const RUN_WINDOW_MS = 6 * 3600000;    // รอบที่ค้าง "กำลังทำ" นานกว่านี้ = ทิ้งแล้ว ไม่ใช้เป็นจุดเริ่มรอบ
const VOID_MAX_SHARE = 0.2;           // หายเกินสัดส่วนนี้ = ผิดปกติ (เช่นเปลี่ยนชื่อแท็บ) → ไม่ยกเลิกให้
const VOID_MIN_SAFE = 5;              // หายไม่เกินกี่ใบ ยกเลิกได้เสมอ (ชีทเล็ก ๆ)
const chunk = (a, n) => { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };
const S = () => ({ inserted: 0, updated: 0, skipped: 0 });

async function byIds(X, ids) {
  const m = new Map();
  for (const part of chunk([...new Set(ids)], 90)) (await X.db.all(`SELECT * FROM bills WHERE bill_no IN (${part.map(() => "?").join(",")})`, ...part)).forEach(r => m.set(r.bill_no, r));
  return m;
}
/** บิลในแอป (v2) ที่ผูกเลขกระดาษแล้ว — หาเฉพาะเลขที่อยู่ในหน้านี้ → { เลข: [บิล…] } */
async function v2ByPaper(X, nos) {
  const m = new Map();
  for (const part of chunk([...new Set(nos.filter(Boolean))], 90)) {
    (await X.db.all(`SELECT bill_no, bill_day, paper_no, total_satang, deposit_satang, status FROM bills WHERE src = 'v2' AND status <> 'ยกเลิก' AND paper_no IN (${part.map(() => "?").join(",")})`, ...part))
      .forEach(r => { if (!m.has(r.paper_no)) m.set(r.paper_no, []); m.get(r.paper_no).push(r); });
  }
  return m;
}
const gap = (a, b) => Math.round(Math.abs(Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 864e5);
/** ใบเดียวกัน = เลขกระดาษเดียวกัน + วันห่างไม่เกิน 7 วัน (ใกล้สุด) — กติกาเดียวกับ account.link › pickTwin */
const twinOf = (list, day) => (list || []).filter(v => gap(v.bill_day, day) <= 7).sort((x, y) => gap(x.bill_day, day) - gap(y.bill_day, day))[0] || null;
async function customerIndex(X) {
  const [cs, al] = await X.db.reads([["SELECT id, name_key FROM customers WHERE merged_into IS NULL"], ["SELECT alias_key, customer_id FROM customer_aliases"]]);
  return { byKey: new Map(cs.map(c => [c.name_key, c.id])), alias: new Map(al.map(a => [a.alias_key, a.customer_id])) };
}
const seenSql = (rows, at) => chunk(rows, 45).map(part => ({ op: "raw",
  sql: `INSERT INTO acct_seen(bill_no, seen_at) VALUES ${part.map(() => "(?,?)").join(",")} ON CONFLICT(bill_no) DO UPDATE SET seen_at = excluded.seen_at`,
  args: part.flatMap(no => [no, at]) }));

/** หนึ่งหน้าของชีทบัญชี → ops (ท่อเขียนกลาง) */
export async function importAcct(X, page) {
  const h = page.head || [], tab = page.tab || "";
  if (h.indexOf("รายชื่อลูกค้า") >= 0) {   // แท็บรายชื่อลูกค้า = ทะเบียนลูกค้า (เติมช่องว่าง ไม่ทับ)
    const out = await importCustomers(X, page, "acct:customers");
    if (isLast(page)) await finishRun(X, out, [], page);
    return out;
  }
  const st = S(), ops = [], problems = [];
  const c = n => h.indexOf(n);
  const isAR = c("ยอดค้าง") >= 0;
  const yHint = (/(\d{4})/.exec(tab) || [])[1];
  const g = (r, n) => { const i = c(n); return i < 0 ? "" : String(r[i] == null ? "" : r[i]).trim(); };
  const rows = (page.rows || []).filter(r => g(r, "เลขที่บิล") && g(r, "ชื่อลูกค้า") && g(r, "เลขที่บิล") !== "เลขที่บิล");
  const ids = rows.map(r => "เก่า-" + tab + "-" + g(r, "เลขที่บิล"));
  const [cur, v2, idx] = await Promise.all([byIds(X, ids), v2ByPaper(X, rows.map(r => g(r, "เลขที่บิล"))), customerIndex(X)]);
  const seen = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], id = ids[i], paper = g(r, "เลขที่บิล");
    const b = cur.get(id);
    if (b) seen.push(id);   // แถวยังอยู่ในชีท (แม้รอบนี้อ่านค่าไม่ได้) = ไม่นับว่าหาย
    const day = thaiDate(g(r, c("วันที่") >= 0 ? "วันที่" : h[0]), yHint);
    if (!day) { problems.push(tab + " บิล " + paper + ": วันที่อ่านไม่ได้ (\"" + g(r, "วันที่") + "\") — ข้าม"); st.skipped++; continue; }
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
    const meta = { paper_no: paper, acct_kind: isAR ? "ลูกหนี้" : "รายวัน" };
    const twin = twinOf(v2.get(paper), day);   // บิลใบเดียวกันที่ลงในแอปแล้ว
    if (!b) {
      const name = row.customer_name;
      const hit = name === "สด" || name === "สดเซล" ? null : matchCustomer(name, idx);
      ops.push({ op: "insert", table: "bills", undo: false, row: { bill_no: id, ...row, ...meta, same_as: twin ? twin.bill_no : "", customer_id: hit ? hit.id : null, paid_satang: row.status === "ชำระแล้ว" ? row.total_satang : 0, src: "acct:" + tab } });
      st.inserted++;
      seen.push(id);
      if (twin && !moneyMatch(row.total_satang, twin)) ops.push(diffFlag(id, row, twin));   // ชีทลงยอดเต็มของบิลที่หักมัดจำ = ต่างเพราะมัดจำ ไม่ใช่ยอดไม่ตรง
    } else if (String(b.src).indexOf("acct:") === 0) {
      const set = {};
      for (const f of SYNC_FIELDS) if (String(b[f] ?? "") !== String(row[f] ?? "")) set[f] = row[f];
      if (set.status) set.paid_satang = set.status === "ชำระแล้ว" ? row.total_satang : 0;
      else if (set.total_satang !== undefined && b.status === "ชำระแล้ว") set.paid_satang = row.total_satang;
      for (const k of Object.keys(meta)) if (b[k] !== meta[k]) set[k] = meta[k];   // ข้อมูลกำกับ (แถวที่นำเข้าก่อนรุ่นนี้)
      if (!b.same_as && twin) set.same_as = twin.bill_no;
      if (b.status === "ยกเลิก" && set.status) set.cancel_reason = "";   // กลับมาในชีทแล้ว (เคยหาย)
      if (Object.keys(set).length) { ops.push({ op: "update", table: "bills", id, expect: b.version, before: b, set, undo: false }); st.updated++; } else st.skipped++;
      const total = set.total_satang !== undefined ? set.total_satang : b.total_satang;
      if (twin && !moneyMatch(total, twin) && (set.same_as || set.total_satang !== undefined)) ops.push(diffFlag(id, { ...b, ...set }, twin));   // เตือนครั้งเดียวตอนเพิ่งเจอคู่/ยอดเพิ่งเปลี่ยน (ไม่ทวงทุกวัน)
    } else st.skipped++;   // บิลที่ v2 ลงเอง — ไม่แตะเด็ดขาด
  }
  ops.push(...seenSql([...new Set(seen)], iso(X.now)));
  const out = { ops, stats: st, problems };
  if (isLast(page)) await finishRun(X, out, seen, page);
  return out;
}

const isLast = page => page.next === null || page.next === undefined;
const money = s => (Number(s) / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
function diffFlag(acctId, row, twin) {
  return { op: "flag", kind: "ชีทบัญชีไม่ตรงแอป", team: "account", severity: "ดู", entity: "bills", entity_id: twin.bill_no,
    title: "ยอดในชีทบัญชีไม่ตรงกับบิลในแอป: " + row.customer_name + " เลข " + (row.paper_no || "") ,
    detail: "ชีทบัญชี " + money(row.total_satang) + " บ. · ในแอป " + money(netOf(twin)) + " บ." + (twin.deposit_satang ? " (หลังหักมัดจำ " + money(twin.deposit_satang) + " บ.)" : "") + " (บิลวันที่ " + thDate(row.bill_day) + ") — ตรวจว่าตัวไหนถูก แล้วแก้ที่ต้นทาง",
    dedupe_key: "acctdiff:" + acctId };
}

/** หน้าสุดท้ายของรอบ: หาบิลที่หายจากชีท → ยกเลิก (หรือขึ้นธงถ้าผิดปกติ) */
async function finishRun(X, out, seenThisPage, page) {
  const now = iso(X.now);
  const firstPage = /^0(:0)?$/.test(String(page.cursor === undefined || page.cursor === null ? "0" : page.cursor));
  const [runs, active, seenCount] = await X.db.reads([
    ["SELECT started_at FROM sync_runs WHERE source = 'acct' AND status = 'กำลังทำ' AND started_at >= ? ORDER BY started_at LIMIT 1", iso(X.now - RUN_WINDOW_MS)],
    ["SELECT b.bill_no, b.customer_name, b.total_satang, b.bill_day, b.version, b.status, s.seen_at FROM bills b LEFT JOIN acct_seen s ON s.bill_no = b.bill_no WHERE substr(b.src, 1, 5) = 'acct:' AND b.status <> 'ยกเลิก'"],
    ["SELECT count(*) AS n FROM acct_seen WHERE seen_at >= (SELECT coalesce(min(started_at), ?) FROM sync_runs WHERE source = 'acct' AND status = 'กำลังทำ' AND started_at >= ?)", now, iso(X.now - RUN_WINDOW_MS)],
  ]);
  if (!runs[0] && !firstPage) { out.problems.push("รอบนี้ไม่ได้เริ่มจากหน้าแรก (หรือค้างนานเกิน 6 ชม.) — ข้ามการหาบิลที่หายจากชีท รอบหน้าจะตรวจให้"); return; }
  const start = runs[0] ? runs[0].started_at : now;   // รอบหน้าเดียว = เริ่มตอนนี้
  const thisPage = new Set(seenThisPage);
  const missing = active.filter(b => !thisPage.has(b.bill_no) && (!b.seen_at || b.seen_at < start));
  if (!missing.length) return;
  const seenTotal = Number(seenCount[0].n) + thisPage.size;
  const limit = Math.max(VOID_MIN_SAFE, Math.floor(active.length * VOID_MAX_SHARE));
  const day = thaiDay(X.now);
  const sample = missing.slice(0, 6).map(b => b.customer_name + " " + money(b.total_satang) + " บ. (" + thDate(b.bill_day) + ")").join(" · ");
  if (!seenTotal || missing.length > limit) {
    out.problems.push("บิลหายจากชีทบัญชี " + missing.length + " ใบ — มากผิดปกติ ระบบไม่ยกเลิกให้ (ตรวจว่าแท็บถูกเปลี่ยนชื่อ/ย้ายหรือเปล่า)");
    out.ops.push({ op: "flag", kind: "นำเข้ามีปัญหา", team: "account", severity: "ด่วน", title: "บิลหายจากชีทบัญชี " + missing.length + " ใบ — มากผิดปกติ ยังไม่ได้ยกเลิก",
      detail: "เห็นในชีทรอบนี้ " + seenTotal + " ใบ · หาย " + missing.length + " ใบ เช่น " + sample + " — ถ้าเปลี่ยนชื่อแท็บ บิลจะกลับมาเป็นชื่อใหม่ ให้ตรวจก่อน", dedupe_key: "acctmissing:big" });
    return;
  }
  for (const b of missing) {
    out.ops.push({ op: "update", table: "bills", id: b.bill_no, expect: b.version, before: b, undo: false,
      set: { status: "ยกเลิก", cancel_reason: "ไม่พบในชีทบัญชีแล้ว (ซิงก์ " + day + ")" } });
    out.stats.updated++;
  }
  out.ops.push({ op: "flag", kind: "บิลหายจากชีทบัญชี", team: "account", severity: "ดู", title: "บิลหายจากชีทบัญชี " + missing.length + " ใบ — ยกเลิกในแอปตามชีทแล้ว",
    detail: sample + (missing.length > 6 ? " · และอีก " + (missing.length - 6) + " ใบ" : "") + " — ถ้าลบในชีทโดยไม่ตั้งใจ ให้ใส่กลับในชีท รอบซิงก์ถัดไปจะกลับมาเอง", dedupe_key: "acctmissing:" + day });
}
