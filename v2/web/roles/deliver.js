// ═══════════════════════════════════════════════════════════════════════
//  ส่งของ — หน้าแรก "เส้นทาง": เลยกำหนด → วันนี้ → พรุ่งนี้ → วันถัดไป → ยังไม่กำหนดวัน · ในวันแยกสายส่ง · การ์ดเล็ก (ชื่อร้าน + จำนวน) แตะแล้วเปิดแผ่นรายละเอียด
//  แท็บ: เส้นทาง · บนรถ (มองเป็นรถก่อน) · ส่งแล้ว (+ ใบส่งของ ดู/พิมพ์/ส่งรูปเข้าไลน์)                v2/web/roles/deliver.js
//  งาน: ขึ้นรถ (เต็ม/บางส่วน · เลือกคันเอง ไม่เดาให้) · ส่งแล้ว (เต็ม/บางส่วน — ที่เหลือยังอยู่บนรถ) · ส่งไม่ได้ + เหตุผล · เอาลงจากรถ · ย้ายคัน
//  ทุกปุ่มบันทึกมีแถบ "ย้อน" · ขึ้นเกิน/ขึ้นก่อนสกรีนเสร็จ = หลังบ้านขอเหตุผล → ถามแล้วไปต่อได้ (ไม่มีทางตัน)
//  เงิน: ยังไม่เก็บเงินในหน้านี้ (รอคุณปาล์มตอบว่าคนขับเก็บเงินสดไหม)
// ═══════════════════════════════════════════════════════════════════════
import * as ui from "../assets/ui.js";
import * as api from "../assets/api.js";
import { save, duePill, qtyOf, qtyWords, fullName, sizeName, askQty, choice, docSheet, useCss, put } from "./sdkit.js";
const { h, icon } = ui;

const TH_WD = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
const wd = day => TH_WD[new Date(day + "T12:00:00Z").getUTCDay()];
const vname = (d, id) => { const v = (d.vehicles || []).find(x => x.id === id); return v ? v.name || "รถ " + id : "รถ " + id; };

// ── สถานะการ์ดร้าน: สี + คำ + สัญลักษณ์ ──
function stopState(ctx, s) {
  if (s.failed) return ["s-fail", ui.pill("ส่งไม่ได้: " + s.failed, "bad", "x-circle")];
  if (s.onboard_pcs) return ["s-truck", ui.pill("บนรถ " + s.vehicles.join(", ") + (s.left_pcs ? " · ขึ้นบางส่วน" : ""), "brand", "truck")];
  if (s.ready) return ["s-ready", ui.pill(s.status === "ส่งบางส่วน" ? "ส่งบางส่วน · พร้อมส่งต่อ" : "พร้อมส่ง", "ok")];
  return ["s-wait", s.screen_pending ? ui.pill(s.screen_team ? "กำลังสกรีน" : "รอสกรีน", "warn", "clock") : ui.statusPill(ctx.vocab, "orders.status", s.status)];
}
/** จำนวนหลักบนการ์ดเล็ก: รายการแรก (ที่ยังต้องส่ง + บนรถ) + "อีก n รายการ" */
function stopQty(s) {
  const its = s.items.filter(i => i.left_pcs + i.onboard_pcs > 0);
  if (!its.length) return null;
  return [qtyOf(its[0], its[0].left_pcs + its[0].onboard_pcs), its.length > 1 ? h("span.muted.small", "อีก " + (its.length - 1) + " รายการ") : null];
}
function stopCard(ctx, s, d) {
  const [cls, pill] = stopState(ctx, s);
  return h("button.card.stop." + cls, { type: "button", onclick: () => stopSheet(ctx, s, d) },
    h("div.row", h("span.name.grow", s.customer), s.urgent ? ui.pill("ด่วน", "bad", "bolt") : null),
    h("div.row", stopQty(s)), h("div.row", pill));
}

// ── เส้นทาง: กลุ่มวันส่ง → สาย ──
function buckets(d) {
  const out = new Map([["late", []], [d.today, []], [d.tomorrow, []]]);
  const later = new Map(), nodate = [];
  for (const s of d.stops) {
    if (!s.due_day) nodate.push(s);
    else if (s.due_day < d.today) out.get("late").push(s);
    else if (out.has(s.due_day)) out.get(s.due_day).push(s);
    else { if (!later.has(s.due_day)) later.set(s.due_day, []); later.get(s.due_day).push(s); }
  }
  const list = [];
  if (out.get("late").length) list.push({ key: "late", cls: ".late", title: "เลยกำหนด", sub: "", stops: out.get("late") });
  list.push({ key: "today", cls: ".today", title: "วันนี้", sub: wd(d.today) + " " + ui.thDay(d.today), stops: out.get(d.today) });
  list.push({ key: "tomorrow", cls: "", title: "พรุ่งนี้", sub: wd(d.tomorrow) + " " + ui.thDay(d.tomorrow), stops: out.get(d.tomorrow) });
  [...later.keys()].sort().forEach(k => list.push({ key: k, cls: "", title: wd(k) + " " + ui.thDay(k), sub: "", stops: later.get(k) }));
  if (nodate.length) list.push({ key: "nodate", cls: ".nodate", title: "ยังไม่กำหนดวันส่ง", sub: "", stops: nodate });
  return list;
}
function routeGroups(ctx, stops, d) {
  const by = new Map();
  for (const s of stops) { const k = s.route_code || ""; if (!by.has(k)) by.set(k, []); by.get(k).push(s); }
  const keys = [...by.keys()].sort((a, b) => (a === "") - (b === "") || a.localeCompare(b, "th", { numeric: true }));
  return h("div.daybody", keys.map(k => h("div.routeblk", h("div.lbl", icon("route", "sm"), (k ? "สาย " + k : "ยังไม่มีสาย") + " · " + by.get(k).length + " ร้าน"),
    h("div.stops", by.get(k).map(s => stopCard(ctx, s, d))))));
}

// ── แผ่นรายละเอียดร้าน (แบบ Google Maps) ──
function stopSheet(ctx, s, d) {
  const sh = ui.sheet({ title: s.customer, foot: true });
  const [, pill] = stopState(ctx, s);
  put(sh.body, 
    h("div.row", pill, s.urgent ? ui.pill("ด่วน", "bad", "bolt") : null, duePill(s.due_day, d.today)),
    h("div.row.small.muted", [s.route_code ? "สาย " + s.route_code : "ยังไม่มีสาย", s.district, s.brand ? "งาน " + s.brand : ""].filter(Boolean).join(" · ")),
    s.phone || s.map_url ? h("div.btns", s.phone ? h("a.btn", { href: "tel:" + s.phone.replace(/[^\d+]/g, "") }, "โทร " + s.phone) : null, s.map_url ? h("a.btn", { href: s.map_url, target: "_blank", rel: "noopener" }, icon("map", "sm"), "แผนที่") : null) : null,
    h("div.card.flat", h("div.lbl", "รายการ"), s.items.map(it => h("div.itemrow", h("b", fullName(it) + (it.screen_color ? " สกรีน" + it.screen_color : "")), qtyOf(it, it.qty_pcs, ""),
      h("span.sub", [it.delivered_pcs ? "ส่งแล้ว " + qtyWords(it, it.delivered_pcs) : "", it.onboard_pcs ? "บนรถ " + qtyWords(it, it.onboard_pcs) : "",
        it.left_pcs ? "ยังไม่ได้ขึ้นรถ " + qtyWords(it, it.left_pcs) : it.onboard_pcs ? "ขึ้นรถครบแล้ว" : "ส่งครบแล้ว"].filter(Boolean).join(" · "))))));
  if (s.loads.length) put(sh.body, h("div.stack", h("div.lbl", "ของบนรถ"), s.loads.map(l => {
    const it = s.items.find(i => i.id === l.order_item_id) || {};
    return h("div.loadrow", ui.pill(l.vehicle_id ? vname(d, l.vehicle_id) : "ไม่ระบุคัน", "brand", "truck"), qtyOf(it, l.qty_pcs), h("span.muted.small", "ขึ้นโดย " + (l.loaded_nick || "—") + " " + ui.thTime(l.loaded_at)),
      l.status === "ส่งไม่ได้" ? ui.pill("ส่งไม่ได้: " + l.fail_reason, "bad", "x-circle") : null);
  })));
  if (s.screen_pending) put(sh.body, h("div.banner.t-warn", icon("clock"), h("span", "ยังสกรีนไม่เสร็จ " + s.screen_pending + " งาน" + (s.screen_team ? " (" + s.screen_team + " กำลังทำ)" : ""))));
  if (s.customer_note || s.note) put(sh.body, h("p", h("span.lbl", "หมายเหตุ "), [s.customer_note, s.note].filter(Boolean).join(" · ")));
  put(sh.body, h("p.ref", "รหัสอ้างอิง " + s.id));
  const main = [];
  if (s.onboard_pcs) main.push(h("button.btn", { type: "button", onclick: () => { sh.close(); failStop(ctx, s, d); } }, icon("x-circle", "sm"), "ส่งไม่ได้"),
    h("button.btn.ok", { type: "button", onclick: () => { sh.close(); doneSheet(ctx, s, d); } }, icon("check", "sm"), "ส่งแล้ว"));
  if (s.left_pcs) main.push(h("button.btn" + (s.onboard_pcs ? "" : ".pri"), { type: "button", onclick: () => { sh.close(); loadSheet(ctx, s, d); } }, icon("truck", "sm"), s.onboard_pcs ? "ขึ้นเพิ่ม" : "ขึ้นรถ"));
  if (main.length) put(sh.foot, h("div.btns", main));
  if (s.onboard_pcs) {
    const onb = s.loads.map(l => ({ id: l.id, version: l.version }));
    put(sh.foot, h("details.more", h("summary.btn.ghost.block", "ตัวเลือกเพิ่มเติม"), h("div.stack",
      h("button.btn.block", { type: "button", onclick: () => docSheet(ctx, { order: s.id }) }, "ใบส่งของ (ของบนรถ)"),
      h("button.btn.block", { type: "button", onclick: () => { sh.close(); retruckSheet(ctx, s, d); } }, icon("swap", "sm"), "ย้ายคัน"),
      h("button.btn.block", { type: "button", onclick: () => { sh.close(); unload(ctx, onb, s.customer); } }, icon("undo", "sm"), "เอาของลงจากรถ (คืนคลัง)"))));
  }
  if (!sh.foot.children.length) sh.foot.remove();
  return sh;
}

/** หลังบ้านขอเหตุผล (ขึ้นเกิน / ขึ้นก่อนสกรีนเสร็จ) → ถามด้วยแผ่นยืนยัน + ชิป แล้วส่งใหม่พร้อมธงนั้น */
async function askReason(ctx, e) {
  const need = e.info && e.info.need;
  const c = await ui.confirmSheet({
    title: need === "early" ? "ยังสกรีนไม่เสร็จ — ขึ้นรถเลยไหม" : "ขึ้นเกินที่ต้องส่ง — ขึ้นเลยไหม",
    detail: h("div.stack", (e.info && e.info.detail || [e.message]).map(t => h("p", t)), h("p.muted.small", "ขึ้นได้ แต่ต้องมีเหตุผล — ประธานจะเห็นรายการนี้ในเรื่องที่ต้องตรวจ")),
    reasons: ctx.reasons(need === "early" ? "load_early" : "load_over"), need: "required", okText: "ขึ้นรถต่อ",
  });
  return c ? { need, reason: c.reason } : null;
}

// ── ขึ้นรถ: เลือกคัน (ไม่เดาให้ — คันล่าสุดขึ้นก่อน) · ทั้งหมดที่เหลือ / บางส่วน ──
function loadSheet(ctx, s, d) {
  const items = s.items.filter(i => i.left_pcs > 0);
  const want = new Map(items.map(i => [i.id, i.left_pcs]));
  const last = api.store.get("lastVehicle");
  const vlist = [...d.vehicles].sort((a, b) => (b.id === last) - (a.id === last));
  const sh = ui.sheet({ title: "ขึ้นรถ · " + s.customer, foot: true });
  const msg = h("p.err", { role: "alert" });
  const sum = h("p.summary");
  const btn = h("button.btn.pri.block", { type: "button" }, icon("truck", "sm"), "ขึ้นรถ");
  const veh = choice(vlist.map(v => ({ value: v.id, text: v.name || "รถ " + v.id, sub: v.id === last ? "ล่าสุด" : v.plate || "" })), { label: "เลือกคัน", onChange: () => { msg.textContent = ""; drawSum(); } });
  veh.el.classList.add("vchips");
  const mode = choice([{ value: "all", text: "ทั้งหมดที่เหลือ" }, { value: "part", text: "บางส่วน" }], { value: "all", label: "ขึ้นเท่าไร", onChange: () => drawItems() });
  const list = h("div.card.flat");
  const drawItems = () => {
    list.replaceChildren(h("div.lbl", "ของที่จะขึ้น"), ...items.map(it => {
      const n = mode.value === "all" ? it.left_pcs : want.get(it.id);
      return h("div.itemrow", h("b", fullName(it) + (it.screen_color ? " สกรีน" + it.screen_color : "")), qtyOf(it, n, ""),
        h("span.sub", "ยังไม่ได้ขึ้นรถ " + qtyWords(it, it.left_pcs)),
        mode.value === "part" ? h("button.btn", { type: "button", style: { gridColumn: "1 / -1" }, onclick: async () => {
          const v = await askQty(it, "ขึ้นรถ " + sizeName(it), it.left_pcs, want.get(it.id));
          if (v !== null) { want.set(it.id, v); drawItems(); }
        } }, "แก้จำนวน") : null);
    }));
    drawSum();
  };
  const lines = () => items.map(it => ({ item: it.id, qty: mode.value === "all" ? it.left_pcs : want.get(it.id) })).filter(l => l.qty > 0);
  const drawSum = () => {
    const n = lines().length;
    sum.textContent = veh.value ? "ขึ้น" + vname(d, veh.value) + " · " + n + " รายการ" : "เลือกคันก่อน";
    btn.lastChild.textContent = veh.value ? "ขึ้น" + vname(d, veh.value) : "ขึ้นรถ";
  };
  put(sh.body, h("div.step", h("div.lbl", "คันไหน"), veh.el), h("div.step", h("div.lbl", "ขึ้นเท่าไร"), mode.el), list);
  put(sh.foot, sum, msg, btn);
  drawItems();
  btn.addEventListener("click", () => {
    if (!veh.value) { msg.textContent = "เลือกคันก่อน (ระบบไม่เลือกให้)"; return; }
    const ls = lines();
    if (!ls.length) { msg.textContent = "ยังไม่มีของที่จะขึ้น"; return; }
    const flags = {}; let reasons = [];
    const attempt = () => save(ctx, "deliver.load", Object.assign({ order: s.id, vehicle: veh.value, lines: ls }, flags), {
      reason: reasons.join(" · "), label: "ขึ้นรถ " + s.customer,
      done: () => { api.store.set("lastVehicle", veh.value); sh.close(); },
      onNeed: async e => {
        const r = await askReason(ctx, e);
        if (!r) return null;
        flags[r.need === "early" ? "early" : "over"] = true; reasons.push(r.reason);
        return attempt();
      },
    });
    ui.busy(btn, attempt);
  });
}

// ── ส่งแล้ว: ของบนรถของร้านนี้ (เลือกคันถ้าอยู่หลายคัน) · ครบที่อยู่บนรถ / บางส่วน ──
function doneSheet(ctx, s, d, onlyVehicle) {
  const vehicles = [...new Set(s.loads.map(l => l.vehicle_id || ""))];
  const sh = ui.sheet({ title: "ส่งแล้ว · " + s.customer, foot: true });
  const msg = h("p.err", { role: "alert" });
  const want = new Map(s.loads.map(l => [l.id, l.qty_pcs]));
  const veh = vehicles.length > 1 ? choice(vehicles.map(v => ({ value: v, text: v ? vname(d, v) : "ไม่ระบุคัน" })), { value: onlyVehicle === undefined ? null : onlyVehicle, label: "ส่งจากคันไหน", onChange: () => draw() }) : null;
  const mode = choice([{ value: "all", text: "ส่งครบที่อยู่บนรถ" }, { value: "part", text: "ส่งบางส่วน" }], { value: "all", label: "ส่งเท่าไร", onChange: () => draw() });
  const list = h("div.card.flat");
  const loads = () => s.loads.filter(l => !veh || (veh.value !== null && (l.vehicle_id || "") === veh.value));
  const draw = () => {
    const ls = loads();
    list.replaceChildren(h("div.lbl", "ของที่ส่ง"), ...(ls.length ? ls.map(l => {
      const it = s.items.find(i => i.id === l.order_item_id) || {};
      const n = mode.value === "all" ? l.qty_pcs : want.get(l.id);
      return h("div.itemrow", h("b", fullName(it)), qtyOf(it, n, ""), h("span.sub", "บนรถ " + qtyWords(it, l.qty_pcs) + (l.vehicle_id ? " · " + vname(d, l.vehicle_id) : "")),
        mode.value === "part" ? h("button.btn", { type: "button", style: { gridColumn: "1 / -1" }, onclick: async () => {
          const v = await askQty(it, "ส่ง " + sizeName(it), l.qty_pcs, want.get(l.id));
          if (v !== null) { want.set(l.id, Math.min(v, l.qty_pcs)); draw(); }
        } }, "แก้จำนวน") : null);
    }) : [h("p.muted", "เลือกคันก่อน")]));
  };
  const btn = h("button.btn.ok.block", { type: "button" }, icon("check", "sm"), "ส่งแล้ว");
  if (veh) put(sh.body, h("div.step", h("div.lbl", "ส่งจากคันไหน"), veh.el));
  put(sh.body, h("div.step", h("div.lbl", "ส่งเท่าไร"), mode.el), list, h("p.muted.small", "ส่งบางส่วน: ที่เหลือยังอยู่บนรถ · ที่ร้านยังไม่ได้ครบจะค้างเป็นงวดถัดไป"));
  put(sh.foot, msg, btn);
  draw();
  btn.addEventListener("click", () => {
    const ls = loads();
    if (!ls.length) { msg.textContent = "เลือกคันก่อน"; return; }
    const refs = ls.map(l => ({ id: l.id, version: l.version, qty: mode.value === "all" ? l.qty_pcs : want.get(l.id) })).filter(r => r.qty > 0);
    if (!refs.length) { msg.textContent = "จำนวนเป็น 0 ทั้งหมด — ถ้าร้านไม่รับเลย ให้กด \"ส่งไม่ได้\""; return; }
    ui.busy(btn, () => save(ctx, "deliver.done", { order: s.id, loads: refs }, { label: "ส่งแล้ว " + s.customer, done: () => sh.close() }));
  });
}

function failStop(ctx, s, d, onlyVehicle) {
  const ls = s.loads.filter(l => onlyVehicle === undefined || (l.vehicle_id || "") === onlyVehicle);
  return save(ctx, "deliver.fail", { order: s.id, loads: ls.map(l => ({ id: l.id, version: l.version })) }, {
    label: "ส่งไม่ได้ " + s.customer,
    confirm: { title: "ส่งไม่ได้ · " + s.customer, detail: "ของยังอยู่บนรถ (ส่งใหม่หรือเอาลงทีหลังได้) · ออฟฟิศจะเห็นเรื่องนี้เพื่อนัดใหม่", reasons: ctx.reasons("delivery_fail"), need: "required", okText: "บันทึกว่าส่งไม่ได้" },
  });
}
function unload(ctx, refs, who) {
  return save(ctx, "deliver.unload", { loads: refs }, {
    label: "เอาลงจากรถ " + who,
    confirm: { title: "เอาของลงจากรถ · " + who, detail: "ของกลับเข้าคลัง (ขึ้นใหม่ได้ภายหลัง)", reasons: ctx.reasons("unload"), need: "optional", okText: "เอาลงคืนคลัง" },
  });
}
function retruckSheet(ctx, s, d) {
  const cur = new Set(s.loads.map(l => l.vehicle_id || ""));
  const sh = ui.sheet({ title: "ย้ายคัน · " + s.customer, modal: true, foot: true });
  const msg = h("p.err", { role: "alert" });
  const veh = choice(d.vehicles.filter(v => !(cur.size === 1 && cur.has(v.id))).map(v => ({ value: v.id, text: v.name || "รถ " + v.id })), { label: "ย้ายไปคันไหน" });
  veh.el.classList.add("vchips");
  const btn = h("button.btn.pri.block", { type: "button" }, "ย้ายคัน");
  put(sh.body, h("p.muted", "ตอนนี้อยู่บน " + [...cur].map(v => (v ? vname(d, v) : "ไม่ระบุคัน")).join(", ")), veh.el);
  put(sh.foot, msg, btn);
  btn.addEventListener("click", () => {
    if (!veh.value) { msg.textContent = "เลือกคันก่อน"; return; }
    const refs = s.loads.filter(l => (l.vehicle_id || "") !== veh.value).map(l => ({ id: l.id, version: l.version }));
    if (!refs.length) { msg.textContent = "ของอยู่บนคันนี้อยู่แล้ว"; return; }
    ui.busy(btn, () => save(ctx, "deliver.retruck", { loads: refs, vehicle: veh.value }, { label: "ย้ายไป" + vname(d, veh.value), done: () => sh.close() }));
  });
}

// ═══════════════════ หน้า ═══════════════════
export const views = {
  route(ctx, view) {
    useCss();
    return ctx.load(view, "route", "deliver.board", (box, d, st) => {
      if (!box.dataset.built) { box.dataset.built = "1"; box.append(h("div.card.sum"), h("div.tl")); }
      const due = d.stops.filter(s => s.due_day && s.due_day <= d.today).length;
      const onTruck = d.stops.filter(s => s.onboard_pcs).length;
      box.querySelector(".sum").replaceChildren(h("div.row", h("span.big", ui.fmt(due)), h("span.muted.grow", "ร้านต้องส่งวันนี้ (รวมเลยกำหนด)"),
        h("span.muted", "บนรถ " + ui.fmt(onTruck) + " · ส่งแล้ววันนี้ " + ui.fmt(d.deliveredToday))), st.fresh ? "" : ui.stamp(st.at, st.updating));
      const tl = box.querySelector(".tl");
      tl.replaceChildren(...buckets(d).map(b => h("section" + b.cls, { "aria-label": b.title },
        h("div.dayhead", h("b", b.title), b.sub ? h("span.muted", b.sub) : null, h("span.muted", b.stops.length ? b.stops.length + " ร้าน" : "")),
        b.stops.length ? routeGroups(ctx, b.stops, d) : h("p.muted", b.key === "today" ? "ไม่มีงานค้างวันนี้" : "ไม่มีร้านต้องส่ง"))));
    });
  },

  truck(ctx, view) {
    useCss();
    return ctx.load(view, "truck", "deliver.board", (box, d, st) => {
      if (!box.dataset.built) { box.dataset.built = "1"; box.append(h("div.stamp-slot"), h("div.stack.trucks")); }
      box.querySelector(".stamp-slot").replaceChildren(st.fresh ? "" : ui.stamp(st.at, st.updating));
      const byV = new Map();
      for (const s of d.stops) for (const l of s.loads) {
        const k = l.vehicle_id || "";
        if (!byV.has(k)) byV.set(k, new Map());
        const m = byV.get(k);
        if (!m.has(s.id)) m.set(s.id, { s, loads: [] });
        m.get(s.id).loads.push(l);
      }
      const keys = [...byV.keys()].sort((a, b) => (a === "") - (b === "") || a.localeCompare(b));
      if (!keys.length) { box.querySelector(".trucks").replaceChildren(ui.empty("ไม่มีของบนรถ", "กด \"ขึ้นรถ\" จากหน้าเส้นทาง แล้วของจะมาอยู่ที่นี่ แยกตามคัน")); return; }
      box.querySelector(".trucks").replaceChildren(...keys.map(k => {
        const stops = [...byV.get(k).values()];
        const all = stops.flatMap(x => x.loads.map(l => ({ id: l.id, version: l.version })));
        return h("section.truckblk", { "aria-label": k ? vname(d, k) : "ไม่ระบุคัน" },
          h("div.truckhead", icon("truck"), h("b", k ? vname(d, k) : "ไม่ระบุคัน"), h("span", stops.length + " ร้าน"),
            h("button.btn", { type: "button", onclick: () => unload(ctx, all, (k ? vname(d, k) : "ไม่ระบุคัน") + " ทั้งคัน") }, "เอาลงทั้งคัน")),
          h("div.truckstops", stops.map(({ s, loads }) => {
            const failed = loads.find(l => l.status === "ส่งไม่ได้");
            const view1 = Object.assign({}, s, { loads });
            return h("div.card.job" + (failed ? ".late" : ""),
              h("button.cardhead", { type: "button", onclick: () => stopSheet(ctx, s, d) },
                h("div.row", h("span.name.grow", s.customer), s.urgent ? ui.pill("ด่วน", "bad", "bolt") : null, duePill(s.due_day, d.today)),
                h("div.row", loads.map(l => qtyOf(s.items.find(i => i.id === l.order_item_id) || {}, l.qty_pcs))),
                h("div.row.small.muted", [s.route_code ? "สาย " + s.route_code : "", s.district].filter(Boolean).join(" · ")),
                failed ? h("div.row", ui.pill("ส่งไม่ได้: " + failed.fail_reason, "bad", "x-circle")) : null),
              h("div.btns", h("button.btn", { type: "button", onclick: () => failStop(ctx, view1, d, k) }, icon("x-circle", "sm"), "ส่งไม่ได้"),
                h("button.btn.ok", { type: "button", onclick: () => doneSheet(ctx, view1, d, k) }, icon("check", "sm"), "ส่งแล้ว")));
          })));
      }));
    });
  },

  done(ctx, view) {
    useCss();
    let day = "";
    const render = (box, d, st) => {
      if (!box.dataset.built) { box.dataset.built = "1"; box.append(h("div.daynav"), h("div.card.sum"), h("div.stack.stopsdone")); }
      const isToday = d.day === d.today;
      const step = n => { day = addDay(d.day, n); reload(box); };
      box.querySelector(".daynav").replaceChildren(h("button.iconbtn", { type: "button", "aria-label": "วันก่อน", onclick: () => step(-1) }, icon("back")),
        h("div.t", isToday ? "วันนี้ · " + ui.thDay(d.day) : wd(d.day) + " " + ui.thDay(d.day)),
        h("button.iconbtn", { type: "button", "aria-label": "วันถัดไป", disabled: isToday, onclick: () => step(1) }, h("span", { style: { display: "inline-flex", transform: "scaleX(-1)" } }, icon("back"))));
      box.querySelector(".sum").replaceChildren(h("div.row", h("span.big", ui.fmt(d.stops.length)), h("span.muted.grow", "ร้านที่ส่งแล้ว"), ui.qty("รวม", d.pcs, "ใบ")), st && !st.fresh ? ui.stamp(st.at, st.updating) : "");
      ui.renderList(box.querySelector(".stopsdone"), d.stops, s => s.stop_id + (s.undo_id ? "u" : ""), s => h("button.card", { type: "button", onclick: () => doneStopSheet(ctx, s) },
        h("div.row", h("span.name.grow", s.customer), h("span.muted", ui.thTime(s.done_at))),
        h("div.items", s.lines.map(l => qtyOf(l, l.qty_pcs))),
        h("div.row.small.muted", [s.vehicle_id ? "รถ " + s.vehicle_id : "", s.done_nick ? "ส่งโดย " + s.done_nick : "", s.order_status === "ส่งบางส่วน" ? "ยังค้างงวดถัดไป" : ""].filter(Boolean).join(" · "))),
        ui.empty(isToday ? "ยังไม่มีร้านที่ส่งแล้ววันนี้" : "วันนี้ไม่มีการส่ง", isToday ? "กด \"ส่งแล้ว\" ในหน้าบนรถ แล้วจะขึ้นที่นี่ พร้อมใบส่งของ" : ""));
    };
    const reload = async box => {
      try { const d = await ctx.api.read("deliver.done_list", { day }); render(box, d, { fresh: true }); }
      catch (e) { ui.toast(e.message, "bad"); }
    };
    return ctx.load(view, "done", "deliver.done_list", render, {});
  },
};
const addDay = (day, n) => { const t = new Date(day + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

/** การส่งที่เสร็จแล้ว: ใบส่งของ + ส่งรูป/ไลน์ + พิมพ์ · ย้อน (คนส่งเองหรือประธาน ภายในเวลาย้อน) */
function doneStopSheet(ctx, s) {
  const undoBtn = s.undo_id && s.undo_mine ? h("button.btn.ghost.block", { type: "button", style: { marginTop: "8px" }, onclick: async e => {
    const b = e.currentTarget;
    const c = await ui.confirmSheet({ title: "ย้อนการส่ง · " + s.customer, detail: "ของกลับไปอยู่บนรถตามเดิม · จำนวนส่งแล้วของออเดอร์ลดลง", reasons: ctx.reasons("undo"), need: "optional", okText: "ย้อนการส่ง" });
    if (!c) return;
    await ui.busy(b, async () => {
      try { await api.write("undo.run", { id: s.undo_id }, { reason: c.reason }); ui.toast("ย้อนแล้ว — " + s.customer + " กลับไปอยู่บนรถ"); sh.close(); }
      catch (er) { ui.toast(er.message, "bad"); }
      ctx.refresh();
    });
  } }, icon("undo", "sm"), "ย้อนการส่งนี้ (กดผิด)") : null;
  let sh = null;
  docSheet(ctx, { stop: s.stop_id }, undoBtn).then(x => { sh = x; });
}

export default {
  code: "deliver", title: "ส่งของ",
  nav: [
    { key: "route", label: "เส้นทาง", icon: "route", title: "เส้นทางส่งของ" },
    { key: "truck", label: "บนรถ", icon: "truck", title: "ของบนรถ" },
    { key: "done", label: "ส่งแล้ว", icon: "check", title: "ส่งแล้ว" },
  ],
  views,
};
