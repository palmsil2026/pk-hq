// ============================================================
//  แอปประธาน (?app=exec) — "ระบบหาข้อยกเว้น คนตัดสิน"                                              v2/server/actions/exec.mjs
//  หน้าแรก = เรื่องที่ต้องตัดสินใจ (ธงทุกทีม + คนใหม่ในรายชื่อ) → ภาพรวมวันนี้ (เครื่องเดิน · ผลิตได้ · ออเดอร์รอ · ส่งวันนี้ · เงินเข้าแยกบัญชี)
//  ราคา: ตั้งต่อ SKU / สเปก ได้คนเดียว (บทบาท exec) · ทุกครั้งมีแถวประวัติราคาใน batch เดียวกัน (เดิม→ใหม่ ใคร เมื่อ เหตุผล)
//        ราคาอ้างอิงจากบิลใน products-master.csv โชว์เป็น "อ้างอิง" เท่านั้น — ระบบไม่ตั้งเป็นราคาขายเอง (PALM-WAY §9)
//  ทุก action ในไฟล์นี้ = บทบาท exec เท่านั้น
// ============================================================
import { registerTable } from "../db.mjs";
import { Fail, bad, conflict, notFound, need, text, int, oneOf, iso, thaiDay, specKey, specLabel } from "../core.mjs";
import { PRODUCTS } from "../import/reference.generated.mjs";
import { MONEY_IN_SQL, moneyInArgs, byChannel, AR_WHERE, billOut } from "./account-lib.mjs";
import { defineExecStaff } from "./exec-staff.mjs";

registerTable("prices", { pk: "pid", created: false });
registerTable("price_history", { pk: "item_key", stamp: false });

const EXEC = ["exec"];
export const PRICE_KINDS = ["โรงงาน", "หน้าร้าน", "ไม่รวมฝา"];
const OPEN_ORDER = "('รอผลิต','กำลังผลิต','รอสกรีน','กำลังสกรีน','พร้อมส่ง','ส่งบางส่วน')";
const REF = new Map(PRODUCTS.map(p => [p.SKU, p]));
const satangOfBaht = s => { const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(s || "").trim()); return m ? Number(m[1]) * 100 + Number((m[2] || "").padEnd(2, "0") || 0) : null; };

export function defineExec(R) {
  defineExecStaff(R);

  // ── หน้าแรก (1 รอบคุยกับฐาน) ─────────────────────────────────────────────────────
  R.define({
    name: "home.exec", roles: EXEC,
    async run(X) {
      const today = thaiDay(X.now);
      const [flags, newStaff, made, mach, orders, dueToday, delivered, screen, inToday, owe, sync] = await X.db.reads([
        ["SELECT f.id, f.at, f.day, f.kind, f.severity, f.team, f.title, f.detail, f.entity, f.entity_id, f.status, f.version, s.nick AS raised_nick FROM flags f LEFT JOIN staff s ON s.id = f.raised_by WHERE f.status = 'เปิด' ORDER BY f.severity = 'ด่วน' DESC, f.at DESC LIMIT 100"],
        ["SELECT id, nick, name, dept_th, src, created_at, version FROM staff WHERE status = 'ทำงาน' AND exec_ok_at = '' ORDER BY created_at, nick LIMIT 60"],
        ["SELECT coalesce(sum(good_pcs), 0) AS good, coalesce(sum(grade_b_pcs), 0) AS b, coalesce(sum(waste_pcs), 0) AS waste, count(*) AS runs FROM machine_runs WHERE ended_day = ? AND status = 'ปิดแล้ว'", today],
        [`SELECT (SELECT count(*) FROM machine_runs WHERE status = 'กำลังผลิต') AS running, (SELECT count(*) FROM machines WHERE kind IN ('เป่า','ฉีด') AND status = 'ใช้งาน') AS total,
            (SELECT count(*) FROM machine_events WHERE ended_at = '' AND status = 'ใช้งาน' AND kind = 'จอดเครื่อง') AS stopped`],
        [`SELECT status, count(*) AS n, sum(urgent) AS urgent, sum(CASE WHEN due_day <> '' AND due_day < ? THEN 1 ELSE 0 END) AS late FROM orders WHERE status IN ${OPEN_ORDER} GROUP BY status`, today],
        [`SELECT count(*) AS n, sum(CASE WHEN status IN ('พร้อมส่ง','ส่งบางส่วน') THEN 1 ELSE 0 END) AS ready FROM orders WHERE due_day = ? AND status IN ${OPEN_ORDER}`, today],
        ["SELECT count(DISTINCT order_id) AS orders, coalesce(sum(qty_pcs), 0) AS pcs FROM delivery_loads WHERE status = 'ส่งแล้ว' AND done_day = ?", today],
        ["SELECT count(*) AS n FROM screen_jobs WHERE status IN ('รอดำเนินการ','เตรียมการสกรีน')"],
        [MONEY_IN_SQL, ...moneyInArgs(today, today)],
        [`SELECT count(*) AS n, coalesce(sum(b.total_satang - b.paid_satang), 0) AS satang FROM bills b WHERE ${AR_WHERE}`],
        ["SELECT status, started_at, finished_at FROM sync_runs WHERE source = 'acct' ORDER BY started_at DESC LIMIT 1"],
      ]);
      const os = {}; let urgent = 0, late = 0;
      orders.forEach(r => { os[r.status] = r.n; urgent += r.urgent || 0; late += r.late || 0; });
      const chans = byChannel(inToday);
      return {
        asOf: iso(X.now), today, flags, newStaff,
        made: Object.assign(made[0], { period: "รอบที่ปิดวันนี้ (" + today + ")" }),
        machines: mach[0],
        orders: { waitProd: (os["รอผลิต"] || 0) + (os["กำลังผลิต"] || 0), waitScreen: (os["รอสกรีน"] || 0) + (os["กำลังสกรีน"] || 0), waitSend: (os["พร้อมส่ง"] || 0) + (os["ส่งบางส่วน"] || 0), urgent, late },
        deliver: { dueToday: dueToday[0].n || 0, readyToday: dueToday[0].ready || 0, deliveredOrders: delivered[0].orders || 0, deliveredPcs: delivered[0].pcs || 0, period: "วันนี้ " + today },
        screenWaiting: screen[0].n,
        moneyIn: { day: today, byChannel: chans, total: chans.reduce((s, c) => s + c.satang, 0), period: "วันนี้ " + today + " · นับตามวันที่ชำระ" },
        owing: { n: owe[0].n, satang: owe[0].satang, period: "ค้างทั้งหมด ณ " + today },
        acctSync: sync[0] || null,
      };
    },
  });

  // ── รายละเอียดเรื่อง (ธง) + ของที่เรื่องนั้นอ้างถึง + ประวัติ ─────────────────────────────────
  R.define({
    name: "exec.flag_detail", roles: EXEC,
    input: raw => ({ id: need(raw.id, "เรื่อง", 40) }),
    async run(X, input) {
      const f = await X.db.first("SELECT f.*, a.nick AS raised_nick, b.nick AS resolved_nick FROM flags f LEFT JOIN staff a ON a.id = f.raised_by LEFT JOIN staff b ON b.id = f.resolved_by WHERE f.id = ?", input.id);
      if (!f) throw notFound("ไม่พบเรื่องนี้");
      const id = f.entity_id || "-";
      const q = {
        bills: ["SELECT * FROM bills WHERE bill_no = ?", id],
        machines: ["SELECT id, name, kind, plant, status, makes FROM machines WHERE id = ?", id],
        machine_runs: ["SELECT r.id, r.machine_id, m.name AS machine, r.type, r.size, r.neck, r.shape, r.color, r.started_at, r.ended_at, r.status, r.good_pcs FROM machine_runs r LEFT JOIN machines m ON m.id = r.machine_id WHERE r.id = ?", id],
        orders: ["SELECT o.id, o.order_day, o.due_day, o.status, o.brand, o.urgent, c.name AS customer FROM orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.id = ?", id],
        customers: ["SELECT id, name, route_code, district, status, needs_review FROM customers WHERE id = ?", id],
        staff: ["SELECT id, nick, name, dept_th, status FROM staff WHERE id = ?", id],
      }[f.entity];
      const reads = [["SELECT at, staff_name, role, action, before_json, after_json, reason FROM audit_log WHERE (entity = 'flags' AND entity_id = ?) OR (entity = ? AND entity_id = ? AND entity <> '') ORDER BY id DESC LIMIT 15", f.id, f.entity || "-", id]];
      if (q) reads.push(q);
      const [hist, ent] = await X.db.reads(reads);
      let entity = ent && ent[0] ? Object.assign({ table: f.entity }, ent[0]) : null;
      if (entity && f.entity === "bills") entity = Object.assign({ table: "bills" }, billOut(ent[0]));
      if (entity && f.entity === "machine_runs") entity.label = specLabel(entity);
      return { flag: f, entity, history: hist };
    },
  });

  // ── ราคา ────────────────────────────────────────────────────────────────────
  R.define({
    name: "price.list", roles: EXEC,
    async run(X) {
      const [products, prices, types, sizes, values, hist] = await X.db.reads([
        ["SELECT id, category, name, type, size, shape, color, spec_key, sale_unit, data_status, status FROM products WHERE status = 'ขาย' ORDER BY category, id"],
        ["SELECT pid, item_key, kind, price_satang, label, updated_at, updated_by, version FROM prices"],
        ["SELECT code, axes, count_unit, piece_unit FROM product_types WHERE active = 1 ORDER BY pos"],
        ["SELECT type, size FROM type_sizes WHERE active = 1 ORDER BY type, pos"],
        ["SELECT axis, value FROM spec_values WHERE active = 1 ORDER BY axis, pos"],
        ["SELECT h.id, h.at, h.item_key, h.kind, h.old_satang, h.new_satang, h.reason, h.by, s.nick AS by_nick FROM price_history h LEFT JOIN staff s ON s.id = h.by ORDER BY h.id DESC LIMIT 40"],
      ]);
      const cur = {};
      prices.forEach(p => { (cur[p.item_key] = cur[p.item_key] || {})[p.kind] = { satang: p.price_satang, version: p.version, at: p.updated_at }; });
      const items = products.map(p => {
        const r = REF.get(p.id);
        return { item_key: "sku:" + p.id, label: p.name, category: p.category, unit: p.sale_unit, data_status: p.data_status,
          ref_satang: r ? satangOfBaht(r["ราคาอ้างอิง(บาท)"]) : null, ref_note: r && r["ราคาอ้างอิง(บาท)"] ? "จากบิลจริง " + (r["ที่มา"] || "") : "", prices: cur["sku:" + p.id] || {} };
      });
      const labels = new Map(prices.map(p => [p.item_key, p.label]));
      const specs = [...new Set(prices.filter(p => p.item_key.indexOf("spec:") === 0).map(p => p.item_key))]
        .map(k => ({ item_key: k, label: labels.get(k) || k.slice(5).split("|").filter(Boolean).join(" "), prices: cur[k] || {} }));
      const lab = k => labels.get(k) || (REF.get(k.slice(4)) || {})["ชื่อสินค้า"] || k.slice(5).split("|").filter(Boolean).join(" ");
      return {
        asOf: iso(X.now), kinds: PRICE_KINDS, items, specs,
        spec: { types, sizes, values },
        history: hist.map(h => Object.assign(h, { label: lab(h.item_key) })),
      };
    },
  });
  R.define({
    name: "price.history", roles: EXEC,
    input: raw => ({ item_key: text(raw.item_key, 200), limit: int(raw.limit === undefined ? 50 : raw.limit, "จำนวน", { min: 1, max: 200 }) }),
    async run(X, input) {
      const rows = await X.db.all("SELECT h.id, h.at, h.item_key, h.kind, h.old_satang, h.new_satang, h.reason, s.nick AS by_nick FROM price_history h LEFT JOIN staff s ON s.id = h.by WHERE (? = '' OR h.item_key = ?) ORDER BY h.id DESC LIMIT ?", input.item_key, input.item_key, input.limit);
      return { items: rows };
    },
  });
  R.define({
    name: "price.set", roles: EXEC, write: true, undo: false, label: "ตั้งราคา",
    onUnique: cols => (/prices/.test(cols) ? conflict("มีคนตั้งราคานี้ไปพร้อมกัน — โหลดใหม่แล้วดูอีกครั้ง") : null),
    input: raw => ({
      item_key: need(raw.item_key, "สินค้า", 200), kind: oneOf(raw.kind, PRICE_KINDS, "ชนิดราคา"),
      satang: int(raw.satang, "ราคา (สตางค์)", { min: 1, max: 1e9 }), version: int(raw.version === undefined ? 0 : raw.version, "รุ่นของราคา", { min: 0 }),
    }),
    async load(X, input) {   // 1 รอบ: ทะเบียนที่ต้องใช้ตรวจ + ราคาปัจจุบันของสินค้านี้ทุกแบบ
      const raw = input.item_key;
      const isSku = raw.indexOf("sku:") === 0, isSpec = raw.indexOf("spec:") === 0;
      if (!isSku && !isSpec) throw bad("รหัสสินค้าต้องขึ้นต้นด้วย sku: หรือ spec:");
      const parts = raw.slice(5).split("|");
      const it = { type: parts[0] || "", size: parts[1] || "", neck: parts[2] || "", shape: parts[3] || "", color: parts[4] || "" };
      const pre = isSku ? raw : "spec:" + it.type + "|";
      const [p, t, s, v, cur] = await X.db.reads([
        ["SELECT id, name, status FROM products WHERE id = ?", isSku ? raw.slice(4) : "-"],
        ["SELECT code, axes FROM product_types WHERE code = ? AND active = 1", isSpec ? it.type : "-"],
        ["SELECT size FROM type_sizes WHERE type = ? AND size = ?", isSpec ? it.type : "-", isSpec ? it.size : "-"],
        ["SELECT axis, value FROM spec_values WHERE active = 1 AND ? = 1", isSpec ? 1 : 0],
        ["SELECT * FROM prices WHERE kind = ? AND substr(item_key, 1, ?) = ?", input.kind, pre.length, pre],
      ]);
      let key, label;
      if (isSku) {
        if (!p[0] || p[0].status !== "ขาย") throw notFound("ไม่พบสินค้านี้ในทะเบียน (หรือเลิกขายแล้ว)");
        key = raw; label = p[0].name;
      } else {
        if (!t[0]) throw bad("ไม่รู้จักประเภทสินค้า " + (it.type || "(ว่าง)"));
        if (!s[0]) throw bad("ประเภท " + it.type + " ไม่มีขนาด " + (it.size || "(ว่าง)") + " ในทะเบียน");
        for (const [k, axis] of [["neck", "คอขวด"], ["shape", "รูปทรง"], ["color", "สี"]]) if (it[k] && !v.some(x => x.axis === axis && x.value === it[k])) throw bad(axis + " \"" + it[k] + "\" ไม่อยู่ในทะเบียน");
        key = "spec:" + specKey(it, t[0].axes);
        label = specLabel(it);
      }
      const pid = input.kind + "|" + key;
      return { key, label, pid, cur: cur.find(r => r.item_key === key) || null };
    },
    async run(X, input, ctx) {
      const c = ctx.cur;
      if (c && !c.pid) throw new Fail(409, "conflict", "ราคานี้ตั้งจากที่อื่นก่อนรุ่นนี้ — ให้ผู้ดูแลตรวจ");
      if (c && c.version !== input.version) throw conflict("ราคานี้มีคนแก้ไปก่อนแล้ว — โหลดใหม่แล้วดูอีกครั้ง");
      if (!c && input.version !== 0) throw conflict("ราคานี้ยังไม่เคยตั้ง (หน้าจออาจเก่า) — โหลดใหม่");
      if (c && c.price_satang === input.satang) throw bad("ราคาเท่าเดิม — ไม่มีอะไรเปลี่ยน");
      const ops = [c
        ? { op: "update", table: "prices", id: ctx.pid, expect: c.version, before: c, set: { price_satang: input.satang, label: ctx.label, updated_by: X.staff.id } }
        : { op: "insert", table: "prices", row: { pid: ctx.pid, item_key: ctx.key, kind: input.kind, price_satang: input.satang, label: ctx.label, updated_by: X.staff.id } },
        { op: "insert", table: "price_history", undo: false, row: { at: iso(X.now), day: thaiDay(X.now), item_key: ctx.key, kind: input.kind, old_satang: c ? c.price_satang : null, new_satang: input.satang, by: X.staff.id, reason: X.reason || "", src: "v2" } }];
      const b = s => (s / 100).toLocaleString("en-US", { minimumFractionDigits: s % 100 ? 2 : 0, maximumFractionDigits: 2 });
      return { label: ctx.label + " " + input.kind + " " + (c ? b(c.price_satang) + " → " : "ตั้ง ") + b(input.satang) + " บ.", result: { item_key: ctx.key, kind: input.kind, old_satang: c ? c.price_satang : null, new_satang: input.satang }, ops };
    },
  });
}
