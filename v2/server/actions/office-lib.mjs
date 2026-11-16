// ============================================================
//  ของกลางของโมดูลออฟฟิศ (ฟังก์ชันล้วน + ตัวอ่านฐาน) — โมดูลอื่น import ได้                  v2/server/actions/office-lib.mjs
//
//  ให้โมดูลอื่นใช้:
//    deriveOrder(order, items, jobs, screenJobs, loads) → { status, items[…ความคืบหน้า], qty, delivered }   ← ฟังก์ชันล้วน
//    orderStatusOps(X, orderIds) → ops สำหรับใส่ใน batch ของตัวเอง ให้สถานะออเดอร์ "ไหลตามงานจริง"
//       (ทีมผลิตปิดงาน · ทีมสกรีนกดเสร็จ · ส่งของกดส่งแล้ว → เรียกตัวนี้แล้วต่อท้าย ops) — ออเดอร์ที่ไม่ใช่ของ v2 ไม่แตะ
//    nextBillNo(X, day) → เลขบิลถัดไปของ v2 ('PK2-2026-0001') — ชนกัน = UNIQUE ล้ม → ผู้ใช้กดอีกครั้ง
//
//  กติกาสถานะ (ยกจาก recomputeOrder_ ใน gas/Code.gs + ขั้น "ยังไม่ส่งเข้าคิว"):
//    ยกเลิก → ยกเลิก · ส่งครบ → ส่งแล้ว · ส่งบ้าง → ส่งบางส่วน · ยังไม่ส่งเข้าคิว → ออเดอร์ใหม่
//    งานผลิตเสร็จหมด + งานสกรีนเสร็จหมด → พร้อมส่ง · ผลิตเสร็จ สกรีนยัง → รอสกรีน (สกรีนจ่ายทีมแล้ว = กำลังสกรีน)
//    มีงานผลิตเริ่มแล้ว → กำลังผลิต · ที่เหลือ → รอผลิต
//    "ส่งแล้ว" ต่อรายการ = max(order_items.delivered_pcs, ผลรวมของขึ้นรถที่ "ส่งแล้ว") · "บนรถ" = max(onboard_pcs, บนรถ+ส่งไม่ได้) — นับถูกไม่ว่าโมดูลไหนขยับช่องไหน ไม่นับซ้ำ
// ============================================================
import { bad, text, int, specKey, specLabel, thaiDay } from "../core.mjs";

// ของบนรถ = บนรถ + ส่งไม่ได้ (ยังอยู่บนรถจนกว่าจะส่งใหม่/เอาลง — กติกาโมดูลส่งของ deliver_common.mjs)
export const ON_TRUCK = ["บนรถ", "ส่งไม่ได้"];
export const OPEN_STATUSES = ["ออเดอร์ใหม่", "รอผลิต", "กำลังผลิต", "รอสกรีน", "กำลังสกรีน", "พร้อมส่ง", "ส่งบางส่วน"];
export const AXIS_FIELD = [["ขนาด", "size"], ["คอขวด", "neck"], ["รูปทรง", "shape"], ["สี", "color"], ["สีสกรีน", "screen_color"], ["พร้อมฝาสี", "cap_color"]];
export const PRICE_KIND = { "ขายราคาโรงงาน": "ราคาโรงงาน", "ขายหน้าร้าน": "ราคาหน้าร้าน" };
const SQL_IN = n => "(" + Array.from({ length: n }, () => "?").join(",") + ")";
export const chunk = (a, n) => { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };

// ── ทะเบียนสเปก (ประเภท · ขนาด/ใบต่อถุง/ขั้นต่ำ · ค่าแกน) ─────────────────────────────
export const CATALOG_READS = [
  ["SELECT code, axes, count_unit, piece_unit, pos, active FROM product_types ORDER BY pos"],
  ["SELECT type, size, per_bag, min_order_pcs, pos, active FROM type_sizes ORDER BY pos"],
  ["SELECT axis, value, pos, active, grade FROM spec_values ORDER BY axis, pos"],
];
export function catalogOf([types, sizes, values]) {
  const T = new Map(types.map(t => [t.code, { ...t, axisList: String(t.axes || "").split(",").filter(Boolean), sizes: [] }]));
  sizes.forEach(s => { const t = T.get(s.type); if (t) t.sizes.push(s); });
  const V = {};
  values.forEach(v => { (V[v.axis] = V[v.axis] || []).push(v); });
  return { types: T, values: V, list: { types, sizes, values } };
}

/** สีเกรด B (ดำ เกรด B) → สต๊อกเกรด B */
export const gradeOf = (cat, color) => ((cat.values["สี"] || []).find(v => v.value === color) || {}).grade === "B" ? "B" : "A";

/**
 * รายการจากหน้าเว็บ → แถว order_items ที่ตรวจแล้ว (ไม่เชื่ออะไรจากหน้าเว็บ — คิดจำนวน/ใบต่อถุงใหม่ที่นี่)
 *   แกนที่ประเภทนั้นไม่ใช้ = ล้างทิ้ง (ฟิล์มไม่มีคอขวด) · ค่านอกทะเบียน = ใช้ได้ แต่ติดรายชื่อ offList ไว้ขึ้นธง
 *   นับเป็นถุง: qty = ถุง × ใบต่อถุง (ณ ตอนลง) + เศษใบ · นับเป็นชิ้น: qty = จำนวนชิ้นตรง ๆ
 */
export function normalizeItem(raw, cat, n) {
  const r = raw || {};
  const where = "รายการที่ " + n + ": ";
  const type = text(r.type, 40, "ประเภทสินค้า");
  if (!type) throw bad(where + "ต้องเลือกประเภทสินค้า");
  const t = cat.types.get(type);
  if (!t) throw bad(where + "ไม่รู้จักประเภทสินค้า \"" + type + "\"");
  const it = { type, size: "", neck: "", shape: "", color: "", screen_color: "", cap_color: "" };
  const offList = [];
  for (const [axis, f] of AXIS_FIELD) {
    if (t.axisList.indexOf(axis) < 0) continue;
    let v = text(r[f], 80, axis);
    if (!v) continue;
    if (axis === "สีสกรีน") {   // หลายสีได้: "น้ำเงิน + ขาว"
      const parts = [...new Set(v.split(/\s*[+,]\s*/).map(x => x.trim()).filter(Boolean))];
      v = parts.join(" + ");
      parts.forEach(p => { if (!(cat.values[axis] || []).some(x => x.value === p)) offList.push(axis + " " + p); });
    } else if (axis === "ขนาด") {
      if (!t.sizes.some(s => s.size === v)) offList.push("ขนาด " + v);
    } else if (!(cat.values[axis] || []).some(x => x.value === v)) offList.push(axis + " " + v);
    it[f] = v;
  }
  if (t.axisList.indexOf("ขนาด") >= 0 && t.sizes.length && !it.size) throw bad(where + "ต้องเลือกขนาด (" + type + ")");
  const sz = t.sizes.find(s => s.size === it.size) || null;
  const per = t.count_unit === "ถุง" && sz ? sz.per_bag : 0;
  let bags = 0, extra = 0, qty;
  if (per > 0) {
    bags = int(r.bags === undefined || r.bags === "" ? 0 : r.bags, where + "จำนวนถุง", { min: 0, max: 100000 });
    extra = int(r.extra_pcs === undefined || r.extra_pcs === "" ? 0 : r.extra_pcs, where + "เศษ (ใบ)", { min: 0, max: 10000000 });
    qty = bags * per + extra;
  } else {
    qty = int(r.qty_pcs === undefined || r.qty_pcs === "" ? (r.extra_pcs || 0) : r.qty_pcs, where + "จำนวน", { min: 0, max: 10000000 });
  }
  if (qty < 1) throw bad(where + "ต้องใส่จำนวน");
  const price = r.price_satang === null || r.price_satang === undefined || r.price_satang === "" ? null : int(r.price_satang, where + "ราคาต่อหน่วย (สตางค์)", { min: 0, max: 10000000 });
  const label = specLabel(it);
  return {
    ...it, spec_key: specKey(it, t.axes), label, bags: per > 0 ? bags : 0, per_bag: per > 0 ? per : 0, extra_pcs: per > 0 ? extra : 0, qty_pcs: qty,
    price_satang: price, price_reason: text(r.price_reason, 120, "เหตุผลราคา"), unit: t.piece_unit, min_order_pcs: sz ? sz.min_order_pcs : 0, offList,
  };
}
/** ใบ → ถุง + เศษ (ตอนตัดจำนวนให้เหลือเท่าที่ส่ง) — คงกติกา qty = ถุง × ใบต่อถุง + เศษ */
export function splitBags(qty, per) {
  if (!per) return { bags: 0, per_bag: 0, extra_pcs: 0, qty_pcs: qty };
  return { bags: Math.floor(qty / per), per_bag: per, extra_pcs: qty % per, qty_pcs: qty };
}

// ── สถานะออเดอร์จากงานจริง ─────────────────────────────────────────────────
const sum = (a, f) => a.reduce((s, x) => s + (Number(f(x)) || 0), 0);
export function deriveOrder(order, items, jobs, screenJobs, loads) {
  const act = (items || []).filter(i => i.status !== "ยกเลิก");
  const J = (jobs || []).filter(j => j.status !== "ยกเลิก");
  const SJ = (screenJobs || []).filter(j => j.status !== "ยกเลิก");
  const L = (loads || []).filter(l => l.status === "ส่งแล้ว" || ON_TRUCK.indexOf(l.status) >= 0);
  const out = act.map(i => {
    const ij = J.filter(j => j.order_item_id === i.id), isj = SJ.filter(j => j.order_item_id === i.id);
    const il = L.filter(l => l.order_item_id === i.id);
    const delivered = Math.max(Number(i.delivered_pcs) || 0, sum(il.filter(l => l.status === "ส่งแล้ว"), l => l.qty_pcs));
    return {
      ...i, made: Math.max(Number(i.made_pcs) || 0, sum(ij, j => j.good_pcs)), delivered,
      on_truck: Math.max(Number(i.onboard_pcs) || 0, sum(il.filter(l => ON_TRUCK.indexOf(l.status) >= 0), l => l.qty_pcs)),
      job: ij[0] ? { id: ij[0].id, status: ij[0].status, target_pcs: ij[0].target_pcs, good_pcs: ij[0].good_pcs, version: ij[0].version } : null,
      screen: isj[0] ? { id: isj[0].id, status: isj[0].status, team: isj[0].team, qty_pcs: isj[0].qty_pcs, version: isj[0].version } : null,
    };
  });
  const qty = sum(out, i => i.qty_pcs), delivered = sum(out, i => Math.min(i.delivered, i.qty_pcs));
  let status = order.status;
  if (order.src === "v2" && status !== "ยกเลิก") {
    if (qty > 0 && delivered >= qty) status = "ส่งแล้ว";
    else if (delivered > 0) status = "ส่งบางส่วน";
    else if (status === "ออเดอร์ใหม่") status = "ออเดอร์ใหม่";
    else {
      const prodDone = J.every(j => j.status === "เสร็จ");
      const scrDone = SJ.every(j => j.status === "เสร็จแล้ว");
      if (prodDone && scrDone) status = "พร้อมส่ง";
      else if (prodDone) status = SJ.some(j => j.status === "เตรียมการสกรีน") ? "กำลังสกรีน" : "รอสกรีน";
      else status = J.some(j => j.status === "กำลังผลิต" || (j.status !== "เสร็จ" && Number(j.good_pcs) > 0)) ? "กำลังผลิต" : "รอผลิต";
    }
  }
  return { status, items: out, qty, delivered };
}

/** อ่านทุกอย่างที่ต้องใช้คิดสถานะของออเดอร์หลายใบ (รอบเดียว · แบ่งทีละ 90 รหัส) */
export async function loadOrderParts(X, ids) {
  const by = { orders: new Map(), items: {}, jobs: {}, sjobs: {}, loads: {} };
  const reads = [];
  for (const part of chunk([...new Set(ids)], 90)) {
    reads.push(["SELECT * FROM orders WHERE id IN " + SQL_IN(part.length), ...part]);
    reads.push(["SELECT * FROM order_items WHERE order_id IN " + SQL_IN(part.length) + " ORDER BY order_id, line_no", ...part]);
    reads.push(["SELECT * FROM production_jobs WHERE order_id IN " + SQL_IN(part.length), ...part]);
    reads.push(["SELECT * FROM screen_jobs WHERE order_id IN " + SQL_IN(part.length), ...part]);
    reads.push(["SELECT * FROM delivery_loads WHERE order_id IN " + SQL_IN(part.length), ...part]);
  }
  if (!reads.length) return by;
  const res = await X.db.reads(reads);
  for (let i = 0; i < res.length; i += 5) {
    res[i].forEach(o => by.orders.set(o.id, o));
    [["items", 1], ["jobs", 2], ["sjobs", 3], ["loads", 4]].forEach(([k, off]) => res[i + off].forEach(r => { (by[k][r.order_id] = by[k][r.order_id] || []).push(r); }));
  }
  return by;
}

/** ops ปรับสถานะที่เก็บไว้ให้ตรงงานจริง — โมดูลอื่นเรียกแล้วต่อท้าย ops ของตัวเอง (ออเดอร์ที่ไม่ใช่ v2 / ไม่เปลี่ยน = ไม่มี op)
 *  overrides = { jobs: [แถวงานผลิตหลังแก้], sjobs: [...], loads: [...], items: [...] } — ส่งแถวที่ตัวเองกำลังจะเขียนในคำขอนี้ ให้คิดจากสภาพหลังบันทึก */
export async function orderStatusOps(X, orderIds, overrides) {
  const P = await loadOrderParts(X, orderIds);
  const ov = overrides || {};
  const ops = [];
  for (const id of new Set(orderIds)) {
    const o = P.orders.get(id);
    if (!o || o.src !== "v2") continue;
    const merge = (base, extra) => { const m = new Map((base || []).map(r => [r.id, r])); (extra || []).filter(r => r.order_id === id).forEach(r => m.set(r.id, { ...m.get(r.id), ...r })); return [...m.values()]; };
    const d = deriveOrder(o, merge(P.items[id], ov.items), merge(P.jobs[id], ov.jobs), merge(P.sjobs[id], ov.sjobs), merge(P.loads[id], ov.loads));
    const set = statusSet(o, d, X);
    if (set) ops.push({ op: "update", table: "orders", id, expect: o.version, before: o, set });
  }
  return ops;
}
/** ช่องที่ต้องเปลี่ยนเมื่อสถานะใหม่ (null = ไม่ต้องเขียน) */
export function statusSet(o, d, X) {
  const set = {};
  if (d.status !== o.status) set.status = d.status;
  if (d.status === "ส่งแล้ว" && !o.delivered_day) set.delivered_day = thaiDay(X.now);
  if (d.status !== "ส่งแล้ว" && o.delivered_day && o.status === "ส่งแล้ว") set.delivered_day = "";
  return Object.keys(set).length ? set : null;
}

/** เลขบิลถัดไปของ v2 ต่อปี (ค.ศ.) — 'PK2-2026-0001' (นำหน้า PK2 กันชนกับเลขบิลของระบบเดิม 'PK-2026-xxxx') */
export async function nextBillNo(X, day) {
  const prefix = "PK2-" + String(day || thaiDay(X.now)).slice(0, 4) + "-";
  const r = await X.db.first("SELECT max(CAST(substr(bill_no, ?) AS INTEGER)) AS n FROM bills WHERE substr(bill_no, 1, ?) = ?", prefix.length + 1, prefix.length, prefix);
  return prefix + String((Number(r && r.n) || 0) + 1).padStart(4, "0");
}
