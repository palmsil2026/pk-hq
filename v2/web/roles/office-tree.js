// ═══════════════════════════════════════════════════════════════════════
//  ออฟฟิศ › ออเดอร์ — มุมมอง "รวมตามสินค้า" + "ซื้อหน้าร้าน"                                       v2/web/roles/office-tree.js
//  รวมตามสินค้า (แบบหน้า "ออเดอร์" ของแอป Office เดิม — ทีมดูของเป็น "รวมกี่ใบ" ตลอด):
//    ต้นไม้ ประเภท → ขนาด → คอ/ทรง → สี → ใบสั่งของใคร · ยอดใบ + ถุงทุกชั้น · นับเฉพาะที่ยังต้องส่ง (สั่ง − ส่งแล้ว)
//    ชั้นที่มีแค่ "ไม่ระบุ" ชั้นเดียว (เช่น ฝาไม่มีคอ/ทรง) ข้ามไปเลย · แตะใบสั่ง = เปิดรายละเอียด · กิ่งที่กางจำไว้ (โหลดใหม่ไม่หุบเอง)
//  ซื้อหน้าร้าน (แทนเมนู "รายการซื้อหน้าร้าน" เดิม): ออเดอร์ "ขายหน้าร้าน" ตามวัน + ยอดรวมใบ/ถุงต่อสินค้า + เงินตามราคาที่ลง (ไม่ลงราคา = บอกว่ายังไม่ใส่ ไม่เดา)
// ═══════════════════════════════════════════════════════════════════════
import * as ui from "../assets/ui.js";
import { put, add, n0, baht, thDayLong, todayTh, addDay, seg, itemBadge, dueWords } from "../parts/kit.js";
const { h, icon } = ui;

const OPEN = new Set();   // กิ่งที่กางไว้ (อยู่ข้ามการโหลดใหม่ในหน้าเดียวกัน)
const LEVELS = [
  ["type", l => l.type || "ไม่ระบุประเภท"],
  ["size", l => l.size || "ไม่ระบุขนาด"],
  ["form", l => [l.neck, l.shape].filter(Boolean).join(" ") || ""],
  ["color", l => l.color || "ไม่ระบุสี"],
];
const bagsOf = l => (l.per_bag ? Math.floor(l.left_pcs / l.per_bag) : 0);

/** แถวแบน → ต้นไม้ (ฟังก์ชันล้วน · export ให้เทสต์) */
export function buildTree(lines) {
  const mk = (key, depth) => ({ key, depth, pcs: 0, bags: 0, unit: "", orders: new Set(), kids: new Map(), rows: [] });
  const root = mk("", -1);
  for (const l of lines) {
    let node = root;
    const path = [];
    root.pcs += l.left_pcs;
    for (const [k, f] of LEVELS) {
      const v = f(l);
      path.push(v);
      const id = path.join("›");
      if (!node.kids.has(v)) node.kids.set(v, Object.assign(mk(v, node.depth + 1), { id, level: k }));
      node = node.kids.get(v);
      node.pcs += l.left_pcs; node.bags += bagsOf(l); node.orders.add(l.order_id);
      node.unit = node.unit && node.unit !== l.piece_unit ? "ชิ้น" : l.piece_unit;
    }
    node.rows.push(l);
  }
  const sortKids = n => {
    n.list = [...n.kids.values()].sort((a, b) => b.pcs - a.pcs);
    // ชั้นคอ/ทรงที่ว่างอย่างเดียว = ข้าม (ไม่ให้เห็นแถว "ไม่ระบุ" ที่ไม่มีความหมาย)
    n.list = n.list.flatMap(k => (k.level === "form" && !k.key && n.list.length === 1 ? (sortKids(k), k.list) : [k]));
    n.list.forEach(k => { if (k.kids.size) sortKids(k); else k.rows.sort((a, b) => (a.due_day || "9999").localeCompare(b.due_day || "9999") || b.urgent - a.urgent); });
    return n;
  };
  return sortKids(root);
}

const amt = (pcs, bags, unit) => h("span.tamt", h("b", n0(pcs)), " " + (unit || "ใบ"), bags ? h("small", " ≈ " + n0(bags) + " ถุง") : null);

export function treeView(ctx, box, M) {
  let data = null, only = "";
  const sum = h("div.row"), chips = seg([["", "ทั้งหมด"], ["booked", "นัดส่งแล้ว"], ["reserve", "จอง / รอยืนยัน"]], only, v => { only = v || ""; draw(); }, { label: "กรองรวมตามสินค้า" });
  const list = h("div.tree", { role: "tree", "aria-label": "ของที่ยังต้องส่ง รวมตามสินค้า" });
  put(box, sum, chips, list);
  const filtered = () => (data.lines || []).filter(l => !only || (only === "reserve" ? l.reserve || l.hold : !l.reserve && !l.hold));
  function node(n) {
    const open = OPEN.has(n.id);
    const sub = n.kids.size ? (n.level === "type" ? n.list.length + " ขนาด" : n.list.length + " กลุ่ม") : n.orders.size + " ใบสั่ง";
    const row = h("button.tnode.d" + n.depth, { type: "button", role: "treeitem", "aria-expanded": String(open), onclick: () => { if (open) OPEN.delete(n.id); else OPEN.add(n.id); draw(); } },
      h("span.car", icon("chev", "sm")), h("span.tlab", h("b", n.key), h("small", sub)), amt(n.pcs, n.bags, n.unit));
    if (!open) return [row];
    const kids = n.kids.size ? n.list.flatMap(node) : n.rows.map(r => h("button.tnode.ord.d" + (n.depth + 1), { type: "button", onclick: () => M.open(r.order_id, list), dataset: { id: r.order_id } },
      h("span.car"), h("span.tlab", h("b", r.customer), h("small", [r.brand ? "งาน " + r.brand : "", r.screen_color ? "สกรีน" + r.screen_color : "", r.cap_color ? "ฝา" + r.cap_color : "",
        r.hold ? "รอยืนยัน" : r.reserve ? "จอง (ยังไม่นัด)" : dueWords(r.due_day, data.today), r.on_truck ? "บนรถ " + n0(r.on_truck) : ""].filter(Boolean).join(" · ")),
      h("span.row", r.urgent ? ui.pill("ด่วน", "bad", "bolt") : null, ui.statusPill(ctx.vocab, "orders.status", r.status))),
      amt(r.left_pcs, bagsOf(r), r.piece_unit)));
    return [row, ...kids];
  }
  function draw() {
    const T = buildTree(filtered());
    put(sum, h("span.grow", "ยังต้องส่ง ", h("b", n0(T.pcs)), " ใบ/ชิ้น · ", h("b", n0(new Set(filtered().map(l => l.order_id)).size)), " ใบสั่ง", h("small.muted", " — แตะเพื่อกางทีละชั้น")));
    put(list, ...(T.list.length ? T.list.flatMap(node) : [ui.empty("ไม่มีของค้างส่ง")]));
  }
  return ctx.load(box, "tree", "office.tree", (b, d, st) => { data = d; draw(); if (!st.fresh) add(sum, ui.stamp(st.at, st.updating)); }, {});
}

export function walkinView(ctx, box, M) {
  const today = todayTh();
  let range = "7";
  const R = { today: [today, today], "7": [addDay(today, -6), today], "30": [addDay(today, -29), today] };
  const chips = seg([["today", "วันนี้"], ["7", "7 วัน"], ["30", "30 วัน"]], range, v => { range = v || "7"; load(); }, { label: "ช่วงวัน" });
  const head = h("div.stack"), list = h("div.stack");
  put(box, chips, head, list);
  async function load() {
    put(list, ui.skeleton(2));
    let d;
    try { d = await ctx.api.read("office.walkin", { from: R[range][0], to: R[range][1] }); }
    catch (e) { put(list, ui.errorBox("โหลดไม่สำเร็จ: " + e.message, load)); return; }
    const t = d.total;
    put(head, h("div.card", h("div.row", h("span.big.md", n0(t.orders)), h("span.grow.muted", "ใบ ขายหน้าร้าน · " + (range === "today" ? "วันนี้" : thDayLong(d.from) + " – " + thDayLong(d.to)))),
      h("div.row.small", h("span.grow", "ยอดตามราคาที่ลง ", h("b", "฿" + baht(t.money_satang))), t.unpriced ? ui.pill("ยังไม่ใส่ราคา " + n0(t.unpriced) + " รายการ", "warn", "alert") : null)));
    put(list, ...(d.days.length ? d.days.map(g => h("section.card.wday", h("div.row", h("b.grow", g.day === today ? "วันนี้ " + thDayLong(g.day) : thDayLong(g.day)), h("span.muted", n0(g.orders.length) + " ใบ"),
      h("b", "฿" + baht(g.money_satang))), g.unpriced ? h("p.hint", "ยังไม่ใส่ราคา " + g.unpriced + " รายการ — ยอดนี้นับเฉพาะที่ลงราคา") : null,
      h("div.lbl", "รวมตามสินค้า"), h("div.ilines", g.products.map(p => h("div.iline", itemBadge({ ...p, bags: p.bags, extra_pcs: p.per_bag ? p.qty_pcs - p.bags * p.per_bag : 0 }), h("span", [String(p.label).replace(p.size, "").replace(/\s+/g, " ").trim(), p.screen_color ? "สกรีน" + p.screen_color : "", p.cap_color ? "ฝา" + p.cap_color : ""].filter(Boolean).join(" · "))))),
      h("details.more", h("summary.btn.ghost", icon("chev", "sm"), "ใบสั่ง (" + g.orders.length + ")"),
        h("div.stack", g.orders.map(o => h("button.icard", { type: "button", style: { textAlign: "left" }, onclick: () => M.open(o.id, list) },
          h("div.row", h("b.grow", o.customer), ui.statusPill(ctx.vocab, "orders.status", o.status), o.total_satang !== null ? h("b", "฿" + baht(o.total_satang)) : h("span.small.muted", "ไม่ใส่ราคา")),
          h("div.small.muted", o.items.map(i => i.label + " " + (i.per_bag && i.bags ? n0(i.bags) + " ถุง" : n0(i.qty_pcs) + " " + i.piece_unit)).join(" · ")))))))) : [ui.empty("ไม่มีรายการซื้อหน้าร้าน", "ช่วงนี้ยังไม่มีออเดอร์ประเภท \"ขายหน้าร้าน\"")]));
  }
  load();
}
