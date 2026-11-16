// ============================================================
//  ทีมผลิต: งานรอผลิต (คิวจากรายการออเดอร์) · สต๊อก (อ่าน + รับเข้า + นับปรับ)               v2/server/actions/prodStock.mjs
//  งาน: รายการออเดอร์ที่ต้องผลิต (ขวด/ถัง/พรีฟอร์ม) ที่ยังไม่มีงานผลิต ก็ขึ้นคิวด้วย — งานผลิตเกิดเองตอนผูกรอบ/กดทำครบ/กดค้าง
//       ยอดทำแล้ว = ผลรวมรอบที่ผูก (view job_made) ไม่เก็บตัวนับซ้ำ · ผูกรอบไม่บังคับ (ผลิตเข้าสต๊อกได้แบบแอปเดิม)
//  สต๊อก: สมุด stock_moves (เขียนเพิ่มอย่างเดียว) · เกรด A/B แยก · ติดลบไม่บล็อก แต่ขึ้นธง
// ============================================================
import { bad, conflict, notFound, need, text, int, oneOf, iso, thaiDay, specLabel } from "../core.mjs";
import { readSpec, negativeFlag, stockKey, PROD_TYPES } from "./prodLib.mjs";

const IN_PT = "(" + PROD_TYPES.map(t => "'" + t + "'").join(",") + ")";
const fmt = n => Number(n || 0).toLocaleString("en-US");

/** คิวงานรอผลิต (ใช้ทั้งหน้า "งานรอผลิต" และตัวเลือกตอนเปิดรอบ) — 1 รอบคุยกับฐาน */
export async function loadJobs(X, opt) {
  const o = opt || {};
  const since = iso(X.now - 3 * 864e5);
  const [jobs, items, running] = await X.db.reads([
    [`SELECT j.*, coalesce(jm.good_pcs, 0) AS made_pcs, coalesce(jm.grade_b_pcs, 0) AS made_b, o.brand, o.order_day, c.name AS customer, ts.per_bag AS ts_per_bag, i.bags AS item_bags, i.per_bag AS item_per_bag
       FROM production_jobs j LEFT JOIN job_made jm ON jm.job_id = j.id LEFT JOIN orders o ON o.id = j.order_id LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN order_items i ON i.id = j.order_item_id LEFT JOIN type_sizes ts ON ts.type = j.type AND ts.size = j.size
       WHERE j.status IN ('รอผลิต','กำลังผลิต')${o.open ? "" : " OR (j.status = 'เสร็จ' AND j.updated_at >= ?)"} LIMIT 300`, ...(o.open ? [] : [since])],
    [`SELECT i.id, i.order_id, i.type, i.size, i.neck, i.shape, i.color, i.spec_key, i.qty_pcs, i.bags, i.per_bag, o.due_day, o.urgent, o.brand, o.order_day, c.name AS customer, ts.per_bag AS ts_per_bag
       FROM order_items i JOIN orders o ON o.id = i.order_id JOIN customers c ON c.id = o.customer_id LEFT JOIN type_sizes ts ON ts.type = i.type AND ts.size = i.size
       WHERE i.status = 'ใช้งาน' AND o.status IN ('รอผลิต','กำลังผลิต') AND i.type IN ${IN_PT}
         AND NOT EXISTS (SELECT 1 FROM production_jobs j WHERE j.order_item_id = i.id AND j.status <> 'ยกเลิก') LIMIT 300`],
    ["SELECT r.job_id, m.name FROM machine_runs r JOIN machines m ON m.id = r.machine_id WHERE r.status = 'กำลังผลิต' AND r.job_id IS NOT NULL"],
  ]);
  const runBy = {};
  running.forEach(r => { (runBy[r.job_id] = runBy[r.job_id] || []).push(r.name); });
  const today = thaiDay(X.now);
  const list = [
    ...jobs.map(j => ({ key: "job:" + j.id, job: j.id, item: j.order_item_id || "", order: j.order_id || "", customer: j.customer || "", brand: j.brand || "",
      type: j.type, size: j.size, neck: j.neck, shape: j.shape, color: j.color, spec_key: j.spec_key, label: specLabel(j), target_pcs: j.target_pcs,
      per_bag: j.item_per_bag || j.ts_per_bag || 0, made_pcs: j.made_pcs, made_b: j.made_b, running: runBy[j.id] || [], due_day: j.due_day, urgent: j.urgent, status: j.status,
      pending_reason: j.pending_reason, note: j.note, version: j.version, done_at: j.status === "เสร็จ" ? j.updated_at : "" })),
    ...items.map(i => ({ key: "item:" + i.id, job: "", item: i.id, order: i.order_id, customer: i.customer, brand: i.brand || "",
      type: i.type, size: i.size, neck: i.neck, shape: i.shape, color: i.color, spec_key: i.spec_key, label: specLabel(i), target_pcs: i.qty_pcs,
      per_bag: i.per_bag || i.ts_per_bag || 0, made_pcs: 0, made_b: 0, running: [], due_day: i.due_day, urgent: i.urgent, status: "รอผลิต", pending_reason: "", note: "", version: 0, done_at: "" })),
  ].map(x => ({ ...x, late: !!x.due_day && x.due_day < today && x.status !== "เสร็จ" }));
  const rank = s => (s === "เสร็จ" ? 1 : 0);
  list.sort((a, b) => rank(a.status) - rank(b.status) || (b.urgent - a.urgent) || ((a.due_day || "9999") < (b.due_day || "9999") ? -1 : (a.due_day || "9999") > (b.due_day || "9999") ? 1 : 0) || (a.customer < b.customer ? -1 : 1));
  return list;
}

/** รายการออเดอร์ที่ยังไม่มีงาน → แถวงานผลิตใหม่ */
const jobFromItem = (X, it, status, extra) => ({ id: "J" + X.newId(), order_id: it.order_id, order_item_id: it.id, type: it.type, size: it.size, neck: it.neck, shape: it.shape, color: it.color,
  spec_key: it.spec_key, target_pcs: it.qty_pcs, status, due_day: it.due_day || "", urgent: it.urgent ? 1 : 0, ...(extra || {}) });

async function loadJobTarget(X, input) {
  const [j, it, ij, made, runs] = await X.db.reads([
    ["SELECT * FROM production_jobs WHERE id = ?", input.job || "-"],
    ["SELECT i.*, o.due_day, o.urgent FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.id = ?", input.item || "-"],
    ["SELECT * FROM production_jobs WHERE order_item_id = ? AND status <> 'ยกเลิก'", input.item || "-"],
    ["SELECT good_pcs FROM job_made WHERE job_id = ?", input.job || "-"],
    ["SELECT m.name FROM machine_runs r JOIN machines m ON m.id = r.machine_id WHERE r.job_id = ? AND r.status = 'กำลังผลิต'", input.job || "-"],
  ]);
  return { j: j[0], it: it[0], ij: ij[0], made: made[0] ? made[0].good_pcs : 0, runs: runs.map(r => r.name) };
}
const jobInput = raw => {
  const o = { job: text(raw.job, 40), item: text(raw.item, 60), version: raw.version === undefined || raw.version === "" || raw.version === 0 ? null : int(raw.version, "รุ่นของรายการ", { min: 1 }) };
  if (!o.job && !o.item) throw bad("ต้องเลือกงาน");
  return o;
};
function checkJob(ctx, input) {
  if (input.job) {
    const j = ctx.j;
    if (!j) throw notFound("ไม่พบงานนี้");
    if (input.version !== null && j.version !== input.version) throw conflict();
    return j;
  }
  if (ctx.ij) throw conflict("รายการนี้มีงานผลิตแล้ว (อาจมีคนเพิ่งเริ่ม) — โหลดใหม่");
  if (!ctx.it || ctx.it.status !== "ใช้งาน") throw notFound("ไม่พบรายการออเดอร์นี้ (อาจถูกยกเลิก)");
  return null;
}

export function defineProdStock(R) {
  // ── งานรอผลิต ──
  R.define({
    name: "prod.jobs", roles: ["prod", "exec", "office"],
    async run(X) { return { asOf: iso(X.now), today: thaiDay(X.now), jobs: await loadJobs(X) }; },
  });

  R.define({
    name: "job.done", roles: ["prod"], write: true, gate: true, label: "ทำครบแล้ว",
    input: raw => jobInput(raw),
    load: loadJobTarget,
    onUnique: () => conflict("มีคนเริ่มงานนี้พร้อมกัน — โหลดใหม่"),
    async run(X, input, ctx) {
      const j = checkJob(ctx, input);
      const src = j || ctx.it;
      const made = j ? ctx.made : 0, target = j ? j.target_pcs : ctx.it.qty_pcs;
      if (j && j.status !== "รอผลิต" && j.status !== "กำลังผลิต") throw conflict("งานนี้ " + j.status + " แล้ว");
      if (ctx.runs.length) throw conflict("ยังมีรอบเดินอยู่สำหรับงานนี้ (" + ctx.runs.join(", ") + ") — ปิดรอบก่อน", { running: ctx.runs });
      if (made < target && !X.reason) throw bad("ทำได้ " + fmt(made) + " จาก " + fmt(target) + " ใบ — เลือกเหตุผลที่ปิดงานก่อนครบ", { needReason: "job_done" });
      const ops = j
        ? [{ op: "update", table: "production_jobs", id: j.id, expect: j.version, before: j, set: { status: "เสร็จ", pending_reason: "", note: X.reason ? (j.note ? j.note + " · " : "") + X.reason : j.note } }]
        : [{ op: "insert", table: "production_jobs", row: jobFromItem(X, ctx.it, "เสร็จ", { note: X.reason }) }];
      return { result: { key: input.job ? "job:" + input.job : "item:" + input.item }, label: "ทำครบแล้ว · " + specLabel(src), ops };
    },
  });

  R.define({
    name: "job.pending", roles: ["prod"], write: true, gate: true, label: "แจ้งงานค้าง",
    input: raw => Object.assign(jobInput(raw), { clear: !!raw.clear, bags: raw.bags === undefined || raw.bags === "" ? null : int(raw.bags, "ค้าง (ถุง)", { min: 0, max: 100000 }) }),
    load: loadJobTarget,
    onUnique: () => conflict("มีคนเริ่มงานนี้พร้อมกัน — โหลดใหม่"),
    async run(X, input, ctx) {
      const j = checkJob(ctx, input);
      if (!input.clear && !X.reason) throw bad("ต้องเลือกสาเหตุที่ค้าง", { needReason: "pending" });
      const why = input.clear ? "" : X.reason + (input.bags !== null ? " · ค้าง " + fmt(input.bags) + " ถุง" : "");
      if (j && j.status === "เสร็จ") throw conflict("งานนี้ทำครบแล้ว");
      const ops = j
        ? [{ op: "update", table: "production_jobs", id: j.id, expect: j.version, before: j, set: { pending_reason: why } }]
        : [{ op: "insert", table: "production_jobs", row: jobFromItem(X, ctx.it, "รอผลิต", { pending_reason: why }) }];
      return { result: { pending: why }, label: (input.clear ? "เลิกค้าง · " : "ค้าง: " + why + " · ") + specLabel(j || ctx.it), ops };
    },
  });

  // ── สต๊อก ──
  R.define({
    name: "prod.stock", roles: ["prod", "exec", "office"],
    async run(X) {
      const [bal, mats, sizes, moves, types] = await X.db.reads([
        ["SELECT item_key, grade, label, qty_pcs, updated_at FROM stock_balance ORDER BY item_key, grade"],
        ["SELECT id, name, unit, pack_unit, per_pack, version FROM materials WHERE status = 'ใช้งาน' ORDER BY pos, name"],
        ["SELECT type, size, per_bag FROM type_sizes"],
        ["SELECT m.id, m.at, m.day, m.item_key, m.label, m.grade, m.qty_pcs, m.move_type, m.reason, m.ref_entity, s.nick AS by_nick FROM stock_moves m LEFT JOIN staff s ON s.id = m.by ORDER BY m.id DESC LIMIT 40"],
        ["SELECT code, piece_unit, pos FROM product_types ORDER BY pos"],
      ]);
      const pb = new Map(sizes.map(s => [s.type + "|" + s.size, s.per_bag]));
      const unit = new Map(types.map(t => [t.code, t.piece_unit]));
      const tpos = new Map(types.map(t => [t.code, t.pos]));
      const matBy = new Map(mats.map(m => [m.id, m]));
      const items = new Map();
      for (const b of bal) {
        let it = items.get(b.item_key);
        if (!it) {
          if (b.item_key.startsWith("spec:")) {
            const [type, size, neck, shape, color] = b.item_key.slice(5).split("|");
            it = { key: b.item_key, kind: "spec", type, size, neck, shape, color, label: b.label || specLabel({ type, size, neck, shape, color }), per_bag: pb.get(type + "|" + size) || 0, unit: unit.get(type) || "ใบ", a: 0, b: 0, at: b.updated_at };
          } else {
            const m = matBy.get(b.item_key.slice(4));
            it = { key: b.item_key, kind: "mat", label: m ? m.name : b.label || b.item_key.slice(4), unit: m ? m.unit : "", per_bag: m ? m.per_pack : 0, pack_unit: m ? m.pack_unit : "", a: 0, b: 0, at: b.updated_at };
          }
          items.set(b.item_key, it);
        }
        it[b.grade === "B" ? "b" : "a"] = b.qty_pcs;
        if (b.updated_at > it.at) it.at = b.updated_at;
      }
      for (const m of mats) if (!items.has("mat:" + m.id)) items.set("mat:" + m.id, { key: "mat:" + m.id, kind: "mat", label: m.name, unit: m.unit, per_bag: m.per_pack, pack_unit: m.pack_unit, a: 0, b: 0, at: "" });
      const list = [...items.values()].map(x => ({ ...x, neg: x.a < 0 || x.b < 0 }));
      list.sort((x, y) => (x.kind === y.kind ? 0 : x.kind === "spec" ? -1 : 1) || (tpos.get(x.type) || 99) - (tpos.get(y.type) || 99) || x.label.localeCompare(y.label, "th"));
      return { asOf: iso(X.now), items: list, materials: mats, moves };
    },
  });

  R.define({
    name: "stock.receive", roles: ["prod"], write: true, gate: true, reason: "required", label: "รับเข้าคลัง",
    input: raw => ({ kind: oneOf(raw.kind || "spec", ["spec", "mat"], "ชนิดของ"), raw, material: text(raw.material, 40), new_name: text(raw.new_name, 80, "ชื่อวัตถุดิบ"), new_unit: text(raw.new_unit, 20, "หน่วย"),
      qty: int(raw.qty, "จำนวน", { min: 1, max: 50000000 }), note: text(raw.note, 300) }),
    async load(X, input) {
      const [types, mat] = await X.db.reads([
        ["SELECT code, axes FROM product_types"],
        ["SELECT * FROM materials WHERE id = ? OR name = ?", input.material || "-", input.new_name || "-"],
      ]);
      return { types: new Map(types.map(t => [t.code, t.axes])), mat };
    },
    onUnique: () => conflict("มีวัตถุดิบชื่อนี้แล้ว — เลือกจากรายการ"),
    async run(X, input, ctx) {
      const ops = [];
      let key, label, unit;
      if (input.kind === "spec") {
        const s = readSpec(input.raw, ctx.types);
        key = stockKey(s.spec_key); label = s.label; unit = "";
      } else if (input.material) {
        const m = ctx.mat.find(x => x.id === input.material);
        if (!m || m.status !== "ใช้งาน") throw notFound("ไม่พบวัตถุดิบนี้");
        key = "mat:" + m.id; label = m.name; unit = m.unit;
      } else {
        if (!input.new_name) throw bad("ต้องเลือกวัตถุดิบ หรือพิมพ์ชื่อใหม่");
        if (!input.new_unit) throw bad("ต้องเลือกหน่วยของวัตถุดิบใหม่");
        if (ctx.mat.find(x => x.name === input.new_name)) throw conflict("มีวัตถุดิบชื่อนี้แล้ว — เลือกจากรายการ");
        const id = "M" + X.newId();
        ops.push({ op: "insert", table: "materials", row: { id, name: input.new_name, unit: input.new_unit, pos: 50, note: "เพิ่มตอนรับเข้า", src: "v2" } });
        key = "mat:" + id; label = input.new_name; unit = input.new_unit;
      }
      const type = /^ยอดยกมา/.test(X.reason) ? "ยอดยกมา" : "รับเข้า";
      ops.push({ op: "move", item_key: key, label, grade: "A", qty_pcs: input.qty, move_type: type, ref_entity: "stock_receive", ref_id: "SR" + X.newId(), reason: [X.reason, input.note].filter(Boolean).join(" · ") });
      return { result: { key }, label: type + " " + label + " " + fmt(input.qty) + (unit ? " " + unit : ""), ops };
    },
  });

  R.define({
    name: "stock.count", roles: ["prod"], write: true, gate: true, reason: "required", label: "นับปรับสต๊อก",
    input: raw => {
      const key = need(raw.item_key, "รายการ", 300);
      if (!/^(spec:|mat:)/.test(key)) throw bad("รายการสต๊อกไม่ถูกต้อง");
      return { key, grade: oneOf(raw.grade || "A", ["A", "B"], "เกรด"), counted: int(raw.counted, "ยอดที่นับได้", { min: 0, max: 50000000 }), seen: int(raw.seen, "ยอดที่เห็นบนจอ", { min: -50000000, max: 50000000 }) };
    },
    async load(X, input) {
      const [b, m] = await X.db.reads([["SELECT * FROM stock_balance WHERE item_key = ? AND grade = ?", input.key, input.grade], ["SELECT name FROM materials WHERE id = ?", input.key.slice(4)]]);
      return { b: b[0], mat: m[0] };
    },
    async run(X, input, ctx) {
      const cur = ctx.b ? ctx.b.qty_pcs : 0;
      if (cur !== input.seen) throw conflict("ยอดในระบบเปลี่ยนระหว่างนับ (ตอนนี้ " + fmt(cur) + " ไม่ใช่ " + fmt(input.seen) + ") — โหลดใหม่แล้วนับเทียบอีกครั้ง", { now: cur });
      const d = input.counted - cur;
      if (!d) throw bad("ยอดที่นับตรงกับในระบบอยู่แล้ว");
      const label = ctx.b ? ctx.b.label : ctx.mat ? ctx.mat.name : input.key.slice(5).split("|").filter(Boolean).join(" ");
      const ops = [{ op: "move", item_key: input.key, label, grade: input.grade, qty_pcs: d, move_type: /^ยอดยกมา/.test(X.reason) ? "ยอดยกมา" : "นับปรับ", ref_entity: "stock_count", ref_id: "SC" + X.newId(), reason: X.reason }];
      return { result: { delta: d }, label: "นับปรับ " + label + (input.grade === "B" ? " (B)" : "") + " " + fmt(cur) + " → " + fmt(input.counted), ops };
    },
  });
}
export { negativeFlag };
