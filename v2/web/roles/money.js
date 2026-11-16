// ═══════════════════════════════════════════════════════════════════════
//  ส่วนประกอบเงิน (แอปบัญชี + หน้าเงินของประธาน) — ใช้ชิ้นส่วนกลางจาก ui.js เท่านั้น              v2/web/roles/money.js
//  · แป้นตัวเลขของแอป (ช่องที่แตะ = ช่องที่กำลังใส่ · คีย์บอร์ดจริงพิมพ์ได้ด้วย) · ไม่มี alert/confirm/prompt
//  · เงิน: ไม่มีค่าตั้งต้นเดา (ช่องทางรับเงินต้องกดเอง · ยอดบนกระดาษต้องใส่เอง) · ทุกยอดบอกช่วงเวลา · โหลดไม่สำเร็จ = "—"
//  · ไม่โชว์รหัสระบบ (อ้างด้วย ร้าน · วันที่ · ยอด · เลขบนบิลกระดาษ) · รหัสอยู่บรรทัด "รหัสอ้างอิง" ในรายละเอียดที่เดียว
// ═══════════════════════════════════════════════════════════════════════
import * as ui from "../assets/ui.js";
const { h, icon } = ui;

// สไตล์เฉพาะส่วนนี้ (ช่องที่กำลังใส่ · การ์ดที่เลือก · แถบสัดส่วน) — ใช้ token ของระบบดีไซน์เท่านั้น
const CSS = `.numdisp[aria-pressed="false"]{border-color:var(--edge);box-shadow:none}
.numdisp[aria-pressed="true"]{border-color:var(--focus);box-shadow:0 0 0 3px var(--brand-soft)}
button.card[aria-pressed="true"]{border-color:var(--brand);box-shadow:0 0 0 1.5px var(--brand)}
.mbar{height:6px;border-radius:3px;background:var(--surface-2);overflow:hidden}.mbar>i{display:block;height:100%;background:var(--brand)}
.tap{display:grid;gap:4px;width:100%;min-height:44px;padding:0;border:0;background:none;color:inherit;text-align:left;font:inherit;cursor:pointer}
.sec-h{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 8px}.sec-h b{flex:none;font:700 17px/1.35 var(--font-display)}.sec-h .n{margin-left:auto;font:800 22px/1 var(--font-display);font-variant-numeric:tabular-nums}`;
if (typeof document !== "undefined" && !document.getElementById("pk-money-css")) document.head.append(h("style#pk-money-css", CSS));

const CH_FALLBACK = [{ value: "เงินสด", label: "เงินสด" }, { value: "โอน KBank", label: "KBank" }, { value: "โอน KTB", label: "KTB" }, { value: "โอน BBL", label: "BBL" }, { value: "เช็ค", label: "เช็ค" }];
export const channels = ctx => ((ctx.vocab || {})["pay.channel"] || CH_FALLBACK);
export const chLabel = (ctx, v) => (channels(ctx).find(c => c.value === v) || { label: v || "ไม่ระบุช่องทาง" }).label;
const TH_DAY = d => ui.thDay(d);
/** ข้อความช่วงเวลาจากหลังบ้าน ("… ณ 2026-11-17") → วันที่แบบไทยบนจอ */
export const thText = t => String(t || "").replace(/\d{4}-\d{2}-\d{2}/g, d => ui.thDay(d)).replace(/เดือน (\d{4})-(\d{2}) /, (m, y, mo) => "เดือน " + ui.thDay(y + "-" + mo + "-01").replace(/^1 /, "") + " ");
const todayTh = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const addDay = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const money = (s, fresh) => ui.money(s, fresh);
/** "1,250.50" → 125050 · ว่าง/ผิดรูป = null */
export function toSatang(s) {
  const m = /^(\d{1,10})(?:\.(\d{0,2}))?$/.exec(String(s || "").replace(/,/g, ""));
  return m ? Number(m[1]) * 100 + Number((m[2] || "").padEnd(2, "0") || 0) : null;
}
const fmtTyped = s => { if (!s) return ""; const [a, b] = s.split("."); return Number(a || 0).toLocaleString("th-TH") + (b !== undefined ? "." + b : ""); };
const srcPill = b => b.src === "acct" ? ui.pill("ชีทบัญชี", "mute", "list") : b.src === "order" ? ui.pill("จากออเดอร์", "brand", "list") : ui.pill(b.src_label || "ในแอป", "mute");
export const statusPill = (ctx, b) => ui.statusPill(ctx.vocab, "bills.status", b.status);

// ── ช่องตัวเลข + แป้นของแอป (แตะช่องเพื่อเลือก · คีย์บอร์ดจริงใช้ได้) ───────────────────────────
//   fields: [{ key, label, kind: 'money'|'digits', unit? }] → { el, get(key), set(key,v), focus(key), destroy() }
export function fieldsPad(fields, opt) {
  const o = opt || {};
  const vals = {}, btns = {};
  let cur = fields[0].key;
  const show = k => {
    const f = fields.find(x => x.key === k), v = vals[k] || "";
    btns[k].querySelector(".v").textContent = f.kind === "money" ? (v ? "฿" + fmtTyped(v) : "฿ —") : (v || "—");
    btns[k].setAttribute("aria-pressed", String(k === cur));
  };
  const box = h("div.stack", { style: { gap: "8px" } });
  for (const f of fields) {
    vals[f.key] = "";
    btns[f.key] = h("button.numdisp", { type: "button", "aria-label": f.label, style: { width: "100%", cursor: "pointer", boxShadow: "none", borderWidth: "1.5px" }, onclick: () => focus(f.key) },
      h("span.k", f.label), h("span.v"), f.unit ? h("span.k", f.unit) : null);
    box.append(btns[f.key]);
  }
  const press = k => {
    const f = fields.find(x => x.key === cur);
    let v = vals[cur] || "";
    if (k === "del") v = v.slice(0, -1);
    else if (k === ".") { if (f.kind === "money" && !v.includes(".")) v = (v || "0") + "."; }
    else if (/^[0-9]$/.test(k)) {
      if (f.kind === "money") { if (/\.\d\d$/.test(v) || v.replace(".", "").length >= 10) return; v = v === "0" ? k : v + k; }
      else if (v.length < 20) v += k;
    } else if (f.kind === "digits" && /^[A-Za-zก-๙/_.-]$/.test(k) && v.length < 20) v += k;
    else return;
    vals[cur] = v; show(cur);
    if (o.onChange) o.onChange(cur, v);
  };
  const keyBtn = (label, k, aria) => h("button", { type: "button", "aria-label": aria || null, onclick: () => press(k) }, label);
  const pad = h("div.numpad", ["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(d => keyBtn(d, d)), keyBtn(".", ".", "จุดทศนิยม"), keyBtn("0", "0"), keyBtn(icon("del"), "del", "ลบ"));
  box.append(pad);
  function focus(k) { cur = k; fields.forEach(f => show(f.key)); }
  const onKey = e => {
    if (!box.isConnected) return document.removeEventListener("keydown", onKey, true);
    if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    const top = [...document.querySelectorAll(".sheet.on")].pop();   // มีแผ่นเปิดอยู่ = แป้นในแผ่นบนสุดเท่านั้นที่รับคีย์
    if (top ? !top.contains(box) : false) return;
    if (e.key === "Backspace") { e.preventDefault(); press("del"); }
    else if (e.key === "Tab" && !e.shiftKey && fields.length > 1 && fields.findIndex(f => f.key === cur) < fields.length - 1) { e.preventDefault(); focus(fields[fields.findIndex(f => f.key === cur) + 1].key); }
    else if (e.key === "Enter" && o.onEnter) { e.preventDefault(); o.onEnter(); }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) { if (/[0-9.]/.test(e.key) || fields.find(x => x.key === cur).kind === "digits") { e.preventDefault(); press(e.key === "," ? "" : e.key); } }
  };
  document.addEventListener("keydown", onKey, true);
  fields.forEach(f => show(f.key));
  return { el: box, get: k => vals[k] || "", set(k, v) { vals[k] = String(v || ""); show(k); }, focus, destroy: () => document.removeEventListener("keydown", onKey, true) };
}
/** แผ่นใส่ยอดเงิน (บาท+สตางค์) → สตางค์ หรือ null */
export function moneyPad(opt) {
  const o = opt || {};
  return new Promise(resolve => {
    let out = null;
    const sh = ui.sheet({ title: o.title || "ใส่ยอดเงิน", modal: true, foot: true, onClose: () => { pad.destroy(); resolve(out); } });
    const err = h("p.err", { role: "alert" });
    const ok = () => { const s = toSatang(pad.get("v")); if (s === null || s < (o.min === undefined ? 1 : o.min)) { err.textContent = "ใส่ยอดเงินก่อน"; return; } out = s; sh.close("ok"); };
    const pad = fieldsPad([{ key: "v", label: o.label || "ยอด", kind: "money" }], { onEnter: ok });
    if (o.value) pad.set("v", (o.value / 100).toFixed(o.value % 100 ? 2 : 0));
    if (o.detail) sh.body.append(typeof o.detail === "string" ? h("p.muted", o.detail) : o.detail);
    sh.body.append(pad.el, err);
    sh.foot.append(h("button.btn.pri.block", { type: "button", onclick: ok }, o.okText || "ตกลง"));
  });
}

/** เขียนแบบรับข้อผิดพลาดกลับมาเป็นค่า (ไม่ toast ทิ้ง) — หน้าจอบอกในแผ่นเดียวว่าเห็นอะไร ต้องกดอะไร */
export async function tryWrite(ctx, action, input, opt) {
  try {
    const r = await ctx.api.write(action, input, opt || {});
    return { ok: true, r };
  } catch (e) {
    if (e.needLogin) { ctx.ui.toast(e.message, "bad"); setTimeout(() => location.reload(), 1200); }
    return { ok: false, e, code: e.code, detail: e.info || e.detail || {} };
  }
}
export function undoBar(ctx, r, label, after) {
  if (r.undo) ui.undoBar(r.undo.label || label, async () => { await ctx.api.write("undo.run", { id: r.undo.id }); if (after) after(); });
  else ui.toast("บันทึกแล้ว · " + label);
}
const alertBox = (tone, title, ...kids) => h("div.banner.t-" + tone, { role: "alert", style: { display: "grid", gap: "8px" } }, h("b", icon(tone === "bad" ? "alert" : "clock", "sm"), " ", title), ...kids);

// ── ผูกเลขบิลกระดาษ (งานเดียว: ยอดในระบบใหญ่สุด · ปุ่มหลักปุ่มเดียวท้ายแผ่น · เสร็จแล้วเปิดใบถัดไปเอง) ─────────────
export function linkSheet(ctx, b, opt) {
  const o = opt || {};
  const cash = b.kind === "เงินสด" && b.status === "ค้างชำระ";
  let channel = "", force = false, reason = "";
  const sh = ui.sheet({ title: b.customer_name, foot: true, onClose: () => pad.destroy() });
  const msg = h("div");
  const submit = () => save();
  const pad = fieldsPad([{ key: "paper", label: "เลขบนบิลกระดาษ", kind: "digits" }, { key: "amt", label: "ยอดบนบิลกระดาษ", kind: "money" }], { onEnter: submit, onChange: () => { msg.replaceChildren(); force = false; } });
  sh.body.append(
    h("div.row", srcPill(b), ui.pill(b.kind, "mute"), h("span.muted.small", "บิลวันที่ " + TH_DAY(b.bill_day) + (b.brand ? " · งาน " + b.brand : ""))),
    h("div.row", h("span.muted.grow", "ยอดในระบบ (ออฟฟิศลงจากออเดอร์)"), h("span.big.md", money(b.total_satang))),
    h("p.small.muted", "ใส่เลขและยอดตามบิลกระดาษ — ระบบเทียบกับยอดในระบบให้ (ไม่ตรง = ไม่ผูก)"),
    msg, pad.el);   // ข้อความ/ทางแก้อยู่เหนือแป้น — เห็นในจอเดียวโดยไม่ต้องเลื่อน
  const chips = h("div.chips", { role: "group", "aria-label": "เงินเข้าทางไหน" }, channels(ctx).map(c => h("button.chip", { type: "button", "aria-pressed": "false", onclick: e => {
    channel = c.value; chips.querySelectorAll(".chip").forEach(x => x.setAttribute("aria-pressed", String(x === e.currentTarget))); msg.replaceChildren(); } }, c.label)));
  if (cash) sh.body.append(h("div.lbl", "บิลเงินสด — เงินเข้าทางไหน (ต้องเลือก)"), chips);
  sh.body.append(h("p.ref", "รหัสอ้างอิง " + b.bill_no));
  new MutationObserver(() => { if (msg.firstChild) msg.scrollIntoView({ block: "nearest" }); }).observe(msg, { childList: true });
  const btn = h("button.btn.pri.block", { type: "button", onclick: () => ui.busy(btn, save) }, cash ? "ผูกเลข + รับเงิน" : "ผูกเลขบิล");
  sh.foot.append(btn);
  if (o.next) sh.foot.append(h("button.btn.ghost.block", { type: "button", style: { marginTop: "8px" }, onclick: () => { sh.close("skip"); o.next(); } }, "ข้ามไปใบถัดไป"));
  pad.focus("paper");
  async function save() {
    const paper = pad.get("paper").trim(), amt = toSatang(pad.get("amt"));
    if (!paper) { pad.focus("paper"); msg.replaceChildren(h("p.err", "ใส่เลขบนบิลกระดาษก่อน")); return; }
    if (!amt) { pad.focus("amt"); msg.replaceChildren(h("p.err", "ใส่ยอดตามบิลกระดาษก่อน")); return; }
    if (cash && !channel) { msg.replaceChildren(h("p.err", "เลือกว่าเงินเข้าทางไหนก่อน")); return; }
    const res = await tryWrite(ctx, "account.link", { bill_no: b.bill_no, version: b.version, paper_no: paper, paper_satang: amt, channel: channel || undefined, force_dup: force || undefined }, { reason: reason || undefined });
    if (res.ok) {
      sh.close("ok");
      undoBar(ctx, res.r, "ผูกเลข #" + paper + " · " + b.customer_name, o.after);
      if (o.after) o.after();
      if (o.next) o.next();
      return;
    }
    const d = res.detail;
    if (res.code === "mismatch") {
      msg.replaceChildren(alertBox("bad", "ยอดไม่ตรง — ยังไม่ผูก",
        h("div.kv", h("div", h("div.lbl", "บนบิลกระดาษ"), h("b.big.md", money(d.paper_satang))), h("div", h("div.lbl", "ในระบบ (ออฟฟิศลง)"), h("b.big.md", money(d.bill_satang)))),
        h("span", "บัญชีไม่ต้องแก้บิลจากออเดอร์ — ส่งให้ออฟฟิศเช็ค แล้วค่อยผูกใหม่"),
        h("div.btns", h("button.btn", { type: "button", onclick: () => { msg.replaceChildren(); pad.focus("amt"); } }, "แก้ยอดที่ใส่"),
          h("button.btn.pri", { type: "button", onclick: e => ui.busy(e.currentTarget, async () => {
            const r2 = await tryWrite(ctx, "account.mismatch_report", { bill_no: b.bill_no, paper_satang: d.paper_satang, paper_no: paper });
            if (!r2.ok) { msg.append(h("p.err", r2.e.message)); return; }
            sh.close("reported"); ui.toast("ส่งให้ออฟฟิศเช็คแล้ว · " + b.customer_name);
            if (o.after) o.after();
            if (o.next) o.next();
          }) }, "ส่งให้ออฟฟิศเช็ค"))));
    } else if (res.code === "dup_paper") {
      const who = d.dup || {};
      msg.replaceChildren(alertBox("warn", "เลข #" + paper + " ใช้ไปแล้ววันเดียวกัน",
        h("span", "ซ้ำกับ " + (who.customer_name || "") + " " + money(who.total_satang) + " (บิลวันที่ " + TH_DAY(who.bill_day) + ")"),
        h("div.btns", h("button.btn", { type: "button", onclick: () => { msg.replaceChildren(); pad.set("paper", ""); pad.focus("paper"); } }, "แก้เลข"),
          h("button.btn.pri", { type: "button", onclick: async () => {
            const c = await ui.confirmSheet({ title: "ยืนยันว่าเป็นคนละใบ", detail: "เลข #" + paper + " ซ้ำวันเดียวกัน — ระบบจะบันทึกพร้อมเหตุผลและขึ้นเรื่องให้ประธานดู", reasons: ctx.reasons("dup_paper"), need: "required", okText: "ยืนยันคนละใบ" });
            if (!c) return;
            force = true; reason = c.reason; ui.busy(btn, save);
          } }, "ยืนยันว่าคนละใบ"))));
    } else if (res.code === "mismatch_sheet") {
      msg.replaceChildren(alertBox("bad", "ยอดไม่ตรงกับชีทบัญชี", h("span", res.e.message)));
    } else if (res.code === "conflict" || res.code === "gone") {
      msg.replaceChildren(alertBox("warn", res.e.message, h("button.btn", { type: "button", onclick: () => { sh.close(); if (o.after) o.after(); } }, "โหลดใหม่")));
    } else msg.replaceChildren(h("p.err", res.e.message));
  }
  return sh;
}

// ── รับชำระ (หนึ่งใบหรือหลายใบของลูกค้าเดียวกัน) ─────────────────────────────────────────────
export function paySheet(ctx, bills, opt) {
  const o = opt || {};
  const due = bills.reduce((s, b) => s + b.due_satang, 0);
  let channel = "", day = todayTh(), partial = null;
  const sh = ui.sheet({ title: "รับชำระ · " + bills[0].customer_name, foot: true });
  const msg = h("div");
  const amtBig = h("span.big.md");
  const draw = () => { amtBig.textContent = money(partial === null ? due : partial); btn.textContent = "รับเงิน " + money(partial === null ? due : partial) + (channel ? " · " + chLabel(ctx, channel) : ""); };
  sh.body.append(
    h("div.stack", { style: { gap: "6px" } }, bills.map(b => h("div.row", h("span.grow", TH_DAY(b.bill_day) + (b.paper_no ? " · บิล #" + b.paper_no : "")), b.paid_satang ? h("span.small.muted", "จ่ายแล้ว " + money(b.paid_satang)) : null, h("b", money(b.due_satang))))),
    h("div.row", h("span.muted.grow", bills.length > 1 ? "รวม " + bills.length + " บิล" : "ยอดที่รับ"), amtBig));
  if (bills.length === 1) {
    sh.body.append(h("button.btn.ghost", { type: "button", onclick: async () => {
      const v = await moneyPad({ title: "รับไม่เต็ม — ใส่ยอดที่ได้รับจริง", label: "ได้รับ", value: partial || undefined, detail: "ค้างอยู่ " + money(due) });
      if (v === null) return;
      partial = v === due ? null : v; draw(); msg.replaceChildren();
    } }, icon("coin", "sm"), "รับไม่เต็มยอด"));
  }
  const dayChips = h("div.chips", { role: "group", "aria-label": "วันที่ได้รับเงิน" });
  const dateIn = h("input", { type: "date", max: todayTh(), "aria-label": "เลือกวันที่ได้รับเงิน", hidden: true, style: { minHeight: "44px", padding: "0 12px", border: "1.5px solid var(--edge)", borderRadius: "12px" }, onchange: e => { day = e.target.value || todayTh(); } });
  [["วันนี้", 0], ["เมื่อวาน", -1], ["เลือกวัน", null]].forEach(([l, n], i) => dayChips.append(h("button.chip", { type: "button", "aria-pressed": String(i === 0), onclick: e => {
    dayChips.querySelectorAll(".chip").forEach(x => x.setAttribute("aria-pressed", String(x === e.currentTarget)));
    if (n === null) { dateIn.hidden = false; dateIn.value = day; dateIn.focus(); } else { dateIn.hidden = true; day = addDay(todayTh(), n); }
  } }, l)));
  sh.body.append(h("div.lbl", "ได้รับเงินวันที่"), dayChips, dateIn);
  const chips = h("div.chips", { role: "group", "aria-label": "เงินเข้าทางไหน" }, channels(ctx).map(c => h("button.chip", { type: "button", "aria-pressed": "false", onclick: e => {
    channel = c.value; chips.querySelectorAll(".chip").forEach(x => x.setAttribute("aria-pressed", String(x === e.currentTarget))); msg.replaceChildren(); draw(); } }, c.label)));
  sh.body.append(h("div.lbl", "เงินเข้าทางไหน (ต้องเลือก)"), chips, o.hint ? h("p.small.muted", o.hint) : "", msg);
  const btn = h("button.btn.pri.block", { type: "button", onclick: () => ui.busy(btn, () => save()) });
  sh.foot.append(btn);
  new MutationObserver(() => { if (msg.firstChild) msg.scrollIntoView({ block: "nearest" }); }).observe(msg, { childList: true });
  draw();
  async function save(excess, reason) {
    if (!channel) { msg.replaceChildren(h("p.err", "เลือกว่าเงินเข้าทางไหนก่อน")); return; }
    const amount = partial === null ? null : partial;
    const items = bills.map(b => ({ bill_no: b.bill_no, version: b.version, satang: bills.length === 1 && amount !== null ? amount : b.due_satang }));
    const res = await tryWrite(ctx, "account.pay", { day, channel, items, excess_satang: excess || undefined }, { reason: reason || undefined });
    if (res.ok) {
      sh.close("ok");
      undoBar(ctx, res.r, "รับชำระ " + money(res.r.data.total_satang) + " · " + bills[0].customer_name, o.after);
      if (o.after) o.after();
      return;
    }
    if (res.code === "over") {
      const d = res.detail, over = amount - d.due_satang;
      msg.replaceChildren(alertBox("warn", "ยอดที่รับเกินยอดค้าง " + money(over),
        h("span", "รับได้สูงสุด " + money(d.due_satang) + " — ถ้าลูกค้าจ่ายเกินจริง ให้รับเท่ายอดค้าง แล้วแจ้งส่วนเกินให้ประธานดู"),
        h("div.btns", h("button.btn", { type: "button", onclick: () => { partial = null; draw(); msg.replaceChildren(); } }, "รับเท่ายอดค้าง"),
          h("button.btn.pri", { type: "button", onclick: async () => {
            const c = await ui.confirmSheet({ title: "รับ " + money(d.due_satang) + " + แจ้งเกิน " + money(over), reasons: ctx.reasons("excess"), need: "required", okText: "บันทึก" });
            if (!c) return;
            partial = null; draw();
            await ui.busy(btn, () => save(over, c.reason));
          } }, "รับเท่ายอดค้าง + แจ้งส่วนเกิน"))));
    } else msg.replaceChildren(h("p.err", res.e.message));
  }
  return sh;
}

// ── รายละเอียดบิล (แผ่นล่าง) ─────────────────────────────────────────────────────────
const ACTION_TH = { "account.link": "ผูกเลขบิลกระดาษ", "account.pay": "รับชำระ", "account.pay_cancel": "ยกเลิกการรับชำระ", "account.bill_create": "ลงบิล", "account.bill_edit": "แก้บิล", "account.bill_cancel": "ยกเลิกบิล",
  "account.stmt_create": "ออกใบวางบิล", "account.stmt_cancel": "ยกเลิกใบวางบิล", "account.unlink": "ปลดเลขบิลกระดาษ", "account.mismatch_report": "ส่งให้ออฟฟิศเช็คยอด", "undo.run": "ย้อนรายการ",
  "import.run": "ซิงก์ชีทบัญชี", "account.sync": "ซิงก์ชีทบัญชี", "acct.sync.cron": "ซิงก์ชีทบัญชีอัตโนมัติ" };
export async function billSheet(ctx, billNo, opt) {
  const o = opt || {};
  const sh = ui.sheet({ title: "บิล", foot: true });
  sh.body.append(ui.skeleton(3));
  let d;
  try { d = await ctx.api.read("account.bill", { bill_no: billNo }); }
  catch (e) { sh.body.replaceChildren(ui.errorBox(e.message)); return sh; }
  const b = d.bill, refresh = () => { sh.close(); if (o.after) o.after(); };
  sh.title = b.customer_name;
  const kv = (l, v) => v === null || v === undefined || v === "" ? null : h("div", h("div.lbl", l), typeof v === "string" ? h("span", v) : v);
  sh.body.replaceChildren(
    h("div.row", statusPill(ctx, b), srcPill(b), ui.pill(b.kind, "mute"), b.stmt_no ? ui.pill("ใบวางบิล " + b.stmt_no, "brand") : null),
    h("div.row", h("span.muted.grow", b.status === "ค้างชำระ" ? "ค้างชำระ" : "ยอดบิล"), h("span.big.md", money(b.status === "ค้างชำระ" ? b.due_satang : b.total_satang))),
    h("div.kv", kv("ยอดบิล", money(b.total_satang)), b.paid_satang ? kv("รับแล้ว", money(b.paid_satang)) : null, kv("วันที่บิล", TH_DAY(b.bill_day)), kv("เลขบิลกระดาษ", b.paper_no ? "#" + b.paper_no : "ยังไม่ผูก"),
      kv("กำหนดชำระ", b.due_day ? TH_DAY(b.due_day) : ""), kv("ชำระเมื่อ", b.paid_day ? TH_DAY(b.paid_day) : ""), kv("ช่องทาง", b.pay_channel ? chLabel(ctx, b.pay_channel) : "")),
    b.why ? h("p.small.muted", b.why) : "",
    b.note ? h("p.small", b.note) : "");
  if (d.order) sh.body.append(h("div.card", h("div.lbl", "ออเดอร์ " + TH_DAY(d.order.order_day) + (d.order.brand ? " · งาน " + d.order.brand : "")), h("div.items", (d.order.items || []).map(ui.itemQty))));
  for (const t of d.twins) sh.body.append(h("div.banner.t-brand", icon("list", "sm"), h("span", (b.src === "acct" ? "ใบเดียวกับบิลในแอป: " : "ใบเดียวกันในชีทบัญชี (" + (t.acct_kind === "รายวัน" ? "แท็บรายวัน" : "แท็บลูกหนี้") + "): ") + t.customer_name + " " + money(t.total_satang) + " · " + t.status + " — นับครั้งเดียว")));
  if (d.payments.length) {
    sh.body.append(h("div.lbl", "การรับชำระ"), h("div.stack", { style: { gap: "6px" } }, d.payments.map(p => h("div.row",
      h("span.grow", TH_DAY(p.day) + " · " + chLabel(ctx, p.channel) + (p.by_nick ? " · " + p.by_nick : "")), p.status === "ยกเลิก" ? ui.pill("ยกเลิก", "mute") : null, h("b", money(p.amount_satang)),
      p.status === "ใช้ได้" && p.src === "v2" ? h("button.btn.ghost", { type: "button", "aria-label": "ยกเลิกการรับชำระ " + money(p.amount_satang), onclick: async () => {
        await ctx.save("account.pay_cancel", { id: p.id, version: p.version }, { label: "ยกเลิกการรับชำระ " + money(p.amount_satang),
          confirm: { title: "ยกเลิกการรับชำระ " + money(p.amount_satang), detail: "บิลจะกลับเป็นค้างชำระ · รายการเดิมยังอยู่ในประวัติ", reasons: ctx.reasons("pay_cancel"), need: "required", okText: "ยกเลิกการรับชำระ" }, after: refresh }).catch(() => {});
      } }, "ยกเลิก") : null))));
  }
  if (d.history.length) sh.body.append(h("details", h("summary.btn.ghost", "ประวัติ " + d.history.length + " รายการ"),
    h("div.stack", { style: { gap: "4px", marginTop: "8px" } }, d.history.map(a => h("div.small", h("span.muted", ui.thDayOf(a.at) + " " + ui.thTime(a.at) + " · " + (a.staff_name || "ระบบ") + " · "), (ACTION_TH[a.action] || a.action) + (a.undo_of ? " (ย้อน)" : "") + (a.reason ? " — " + a.reason : ""))))));
  sh.body.append(h("p.ref", "รหัสอ้างอิง " + b.bill_no + (b.order_id ? " · ออเดอร์ " + b.order_id : "")));
  const btns = [], more = [];
  if (b.payable) btns.push(h("button.btn.pri", { type: "button", onclick: () => { sh.close(); paySheet(ctx, [b], { after: o.after }); } }, icon("coin", "sm"), "รับชำระ"));
  if (b.src !== "acct" && b.src !== "other" && !b.paper_no && b.status !== "ยกเลิก") btns.push(h("button.btn" + (b.payable ? "" : ".pri"), { type: "button", onclick: () => { sh.close(); linkSheet(ctx, b, { after: o.after }); } }, "ผูกเลขบิลกระดาษ"));
  if (b.src !== "acct" && b.paper_no && b.status !== "ยกเลิก") more.push(h("button.btn", { type: "button", onclick: () => ctx.save("account.unlink", { bill_no: b.bill_no, version: b.version }, { label: "ปลดเลข #" + b.paper_no,
    confirm: { title: "ปลดเลขบิลกระดาษ #" + b.paper_no, detail: "ใช้เมื่อผูกผิดใบ หรือออฟฟิศต้องยกเลิกบิลนี้ — ถ้ามีการรับชำระ ต้องยกเลิกการรับชำระก่อน", reasons: ctx.reasons("relink"), need: "required", okText: "ปลดเลข" }, after: refresh }).catch(() => {}) }, "ปลดเลขบิลกระดาษ"));
  if (b.editable) {
    more.push(h("button.btn", { type: "button", onclick: () => { sh.close(); billForm(ctx, { bill: b, after: o.after }); } }, "แก้บิล"));
    more.push(h("button.btn", { type: "button", onclick: () => ctx.save("account.bill_cancel", { bill_no: b.bill_no, version: b.version }, { label: "ยกเลิกบิล " + b.customer_name,
      confirm: { title: "ยกเลิกบิล " + money(b.total_satang), detail: "บิลยังอยู่ในประวัติ (ไม่ลบ) · การรับชำระของบิลนี้ถูกยกเลิกตาม", reasons: ctx.reasons("bill_cancel"), need: "required", okText: "ยกเลิกบิล" }, after: refresh }).catch(() => {}) }, "ยกเลิกบิล"));
  }
  if (btns.length) sh.foot.append(h("div.btns", btns));
  if (more.length) sh.foot.append(h("details", { style: { marginTop: btns.length ? "8px" : "0" } }, h("summary.btn.ghost.block", "ตัวเลือกเพิ่มเติม"), h("div.btns", { style: { marginTop: "8px", gridAutoFlow: "row" } }, more)));
  if (!btns.length && !more.length) sh.foot.append(h("p.small.muted", b.why || "ดูได้อย่างเดียว"));
  return sh;
}

// ── ลงบิล / แก้บิล (ฟอร์มอยู่บนสุด · พิมพ์จริงแค่ยอด · บันทึกแล้วคงประเภท/ช่องทางไว้ ลงติดกันได้เร็ว) ─────────────────
const FORM_KEEP = { kind: "", channel: "" };
export function billForm(ctx, opt) {
  const o = opt || {};
  const edit = o.bill || null;
  const host = o.into || null;
  const st = { kind: edit ? edit.kind : FORM_KEEP.kind, channel: edit ? edit.pay_channel : FORM_KEEP.channel, day: edit ? edit.bill_day : todayTh(), customer: edit ? { id: edit.customer_id, name: edit.customer_name } : null, due: edit ? edit.due_day : "" };
  const box = h("div.stack");
  const msg = h("div");
  const pad = fieldsPad([{ key: "paper", label: "เลขบิลกระดาษ", kind: "digits" }, { key: "amt", label: "ยอดเงิน", kind: "money" }], { onEnter: () => ui.busy(btn, save), onChange: () => msg.replaceChildren() });
  if (edit) { pad.set("paper", edit.paper_no || ""); pad.set("amt", (edit.total_satang / 100).toFixed(edit.total_satang % 100 ? 2 : 0)); }
  else if (o.nextPaper) pad.set("paper", o.nextPaper);
  // ลูกค้า: พิมพ์แล้วเด้งแนะนำ (ร้านที่มีบิลล่าสุดขึ้นก่อน) · ไม่มีในรายการ = ใช้ชื่อที่พิมพ์
  const cIn = h("input", { type: "text", maxlength: 120, placeholder: "พิมพ์ชื่อลูกค้า", "aria-label": "ลูกค้า", autocomplete: "off", value: st.customer ? st.customer.name : "" });
  const sug = h("div.chips", { role: "listbox", "aria-label": "ลูกค้าที่ตรงกัน" });
  let qT = 0, qN = 0;
  const pick = c => { st.customer = c; cIn.value = c.name; sug.replaceChildren(); msg.replaceChildren(); };
  const suggest = async () => {
    const q = cIn.value.trim(), n = ++qN;
    st.customer = null;
    let r;
    try { r = await ctx.api.read("account.customers", { q }); } catch (e) { return; }
    if (n !== qN) return;
    sug.replaceChildren(...r.items.slice(0, 8).map(c => h("button.chip", { type: "button", onclick: () => pick(c) }, c.name, c.route_code ? h("small.muted", " สาย " + c.route_code) : null)),
      q ? h("button.chip", { type: "button", onclick: () => pick({ id: null, name: q }) }, "อื่น ๆ (ใช้ชื่อ \"" + q + "\")") : "");
  };
  cIn.addEventListener("input", () => { clearTimeout(qT); qT = setTimeout(suggest, 200); });
  cIn.addEventListener("focus", () => { if (!sug.children.length) suggest(); });
  const chipRow = (label, items, get, set) => {
    const row = h("div.chips", { role: "group", "aria-label": label }, items.map(([v, l]) => h("button.chip", { type: "button", "aria-pressed": String(get() === v), onclick: e => {
      set(v); row.querySelectorAll(".chip").forEach(x => x.setAttribute("aria-pressed", String(x === e.currentTarget))); draw(); msg.replaceChildren(); } }, l)));
    return row;
  };
  const kindRow = chipRow("ประเภทบิล", [["เงินสด", "เงินสด"], ["เครดิต", "เครดิต"]], () => st.kind, v => { st.kind = v; });
  const chanRow = chipRow("เงินเข้าทางไหน", channels(ctx).map(c => [c.value, c.label]), () => st.channel, v => { st.channel = v; });
  const chanBox = h("div.stack", { style: { gap: "6px" } }, h("div.lbl", "เงินเข้าทางไหน (ต้องเลือก)"), chanRow);
  const dueRow = chipRow("กำหนดชำระ", [["", "ไม่กำหนด"], ["7", "7 วัน"], ["15", "15 วัน"], ["30", "30 วัน"]], () => st.dueN || "", v => { st.dueN = v; st.due = v ? addDay(st.day, Number(v)) : ""; });
  const dueBox = h("div.stack", { style: { gap: "6px" } }, h("div.lbl", "กำหนดชำระ"), dueRow);
  const dayRow = chipRow("วันที่บิล", [[todayTh(), "วันนี้"], [addDay(todayTh(), -1), "เมื่อวาน"]].concat(st.day !== todayTh() && st.day !== addDay(todayTh(), -1) ? [[st.day, TH_DAY(st.day)]] : []), () => st.day, v => { st.day = v; if (st.dueN) st.due = addDay(v, Number(st.dueN)); });
  function draw() { chanBox.hidden = st.kind !== "เงินสด"; dueBox.hidden = st.kind !== "เครดิต"; }
  new MutationObserver(() => { if (msg.firstChild) msg.scrollIntoView({ block: "nearest" }); }).observe(msg, { childList: true });
  box.append(h("div.field", h("div.lbl", "ลูกค้า"), cIn), sug, pad.el, h("div.lbl", "ประเภทบิล (ต้องเลือก)"), kindRow, chanBox, dueBox, h("div.lbl", "วันที่บิล"), dayRow, msg);
  const btn = h("button.btn.pri.block", { type: "button", onclick: () => ui.busy(btn, save) }, edit ? "บันทึกการแก้" : "ลงบิล");
  draw();
  let sh = null;
  if (host) host.append(box, btn);
  else { sh = ui.sheet({ title: edit ? "แก้บิล · " + edit.customer_name : "ลงบิล", foot: true, onClose: () => pad.destroy() }); sh.body.append(box); sh.foot.append(btn); }
  async function save(force, reason) {
    const amt = toSatang(pad.get("amt")), name = (st.customer && st.customer.name) || cIn.value.trim();
    if (!name) { msg.replaceChildren(h("p.err", "ใส่ชื่อลูกค้าก่อน")); cIn.focus(); return; }
    if (!amt) { msg.replaceChildren(h("p.err", "ใส่ยอดเงินก่อน")); pad.focus("amt"); return; }
    if (!st.kind) { msg.replaceChildren(h("p.err", "เลือกประเภทบิล: เงินสด / เครดิต")); return; }
    if (st.kind === "เงินสด" && !st.channel) { msg.replaceChildren(h("p.err", "เลือกว่าเงินเข้าทางไหนก่อน")); return; }
    const base = { paper_no: pad.get("paper").trim(), customer_id: st.customer && st.customer.id || "", customer_name: name, amount_satang: amt, bill_day: st.day, force_dup: force || undefined };
    const res = edit
      ? await tryWrite(ctx, "account.bill_edit", Object.assign({ bill_no: edit.bill_no, version: edit.version }, base, st.kind === "เงินสด" && st.channel !== edit.pay_channel ? { channel: st.channel } : {}, st.kind === "เครดิต" ? { due_day: st.due } : {}), { reason })
      : await tryWrite(ctx, "account.bill_create", Object.assign(base, { kind: st.kind, channel: st.kind === "เงินสด" ? st.channel : "", due_day: st.kind === "เครดิต" ? st.due : "" }), { reason });
    if (res.ok) {
      FORM_KEEP.kind = st.kind; FORM_KEEP.channel = st.channel;
      undoBar(ctx, res.r, (edit ? "แก้บิล " : "ลงบิล ") + name + " " + money(amt), o.after);
      if (sh) sh.close("ok");
      else {   // ฟอร์มบนหน้า: ล้างชื่อ/ยอด คงประเภท/ช่องทาง · เลขกระดาษ +1
        const p = base.paper_no;
        pad.set("paper", /^\d+$/.test(p) ? String(Number(p) + 1).padStart(p.length, "0") : "");
        pad.set("amt", ""); cIn.value = ""; st.customer = null; sug.replaceChildren(); cIn.focus();
      }
      if (o.after) o.after();
      return;
    }
    const d = res.detail;
    if (res.code === "dup_paper") {
      msg.replaceChildren(alertBox("warn", "เลข #" + base.paper_no + " ใช้ไปแล้ววันเดียวกัน", h("span", "ซ้ำกับ " + d.dup.customer_name + " " + money(d.dup.total_satang)),
        h("div.btns", h("button.btn", { type: "button", onclick: () => { msg.replaceChildren(); pad.focus("paper"); } }, "แก้เลข"),
          h("button.btn.pri", { type: "button", onclick: async () => {
            const c = await ui.confirmSheet({ title: "ยืนยันว่าเป็นคนละใบ", reasons: ctx.reasons("dup_paper"), need: "required", okText: "ยืนยันคนละใบ" });
            if (c) await ui.busy(btn, () => save(true, c.reason));
          } }, "ยืนยันว่าคนละใบ"))));
    } else if (res.code === "in_sheet") {
      msg.replaceChildren(alertBox("warn", "บิลนี้มีในชีทบัญชีแล้ว", h("span", res.e.message)));
    } else msg.replaceChildren(h("p.err", res.e.message));
  }
  return { box, btn, sheet: sh };
}

// ── ซิงก์ชีทบัญชีตอนนี้ (อ่านอย่างเดียว · วนทีละหน้า) ───────────────────────────────────────────
export function syncButton(ctx, after) {
  const st = h("span.small.muted");
  const btn = h("button.btn", { type: "button" }, icon("refresh", "sm"), "ซิงก์ชีทบัญชีตอนนี้");
  btn.addEventListener("click", () => ui.busy(btn, async () => {
    let cursor = "0", run = "", n = 0, last;
    try {
      do {
        last = (await ctx.api.write("account.sync", { cursor, run })).data;
        run = last.run; cursor = last.next; n++;
        st.textContent = "กำลังอ่านชีทบัญชี… หน้า " + n;
      } while (cursor !== null && n < 100);
      st.textContent = "ซิงก์เสร็จ · ใหม่ " + ui.fmt(last.page.inserted) + (last.problems.length ? " · " + last.problems[0] : "");
      ui.toast("ซิงก์ชีทบัญชีแล้ว");
      if (after) after();
    } catch (e) { st.textContent = "ไม่สำเร็จ: " + e.message; }
  }));
  return h("div.stack", { style: { gap: "4px" } }, btn, st);
}
export function syncLine(s, auto) {
  if (!s) return h("span.small.muted", "ยังไม่เคยซิงก์ชีทบัญชี");
  const when = ui.thDayOf(s.started_at) + " " + ui.thTime(s.started_at);
  return h("span.small.muted", "ชีทบัญชีซิงก์ล่าสุด " + when + " · " + s.status + (auto ? " · อัตโนมัติทุกวัน ~20:00" : " · ปิดซิงก์อัตโนมัติอยู่"));
}

// ── ลูกหนี้ (รายลูกค้า → แตะ = บิลของร้าน · เลือกหลายใบรับชำระ/ออกใบวางบิล) ─────────────────────────
export function owingView(ctx, view) {
  return ctx.load(view, "owing", "account.owing", (box, d, st) => {
    const f = st.fresh;
    box.replaceChildren(
      h("div.card", h("div.row", h("b.grow", "ลูกหนี้ทั้งหมด"), h("span.big.md", money(d.total.satang, f))), h("span.small.muted", ui.fmt(d.total.n) + " บิล · " + thText(d.period)), st.fresh ? null : ui.stamp(st.at, st.updating)),
      d.sheetDailyCredit.n ? h("p.small.muted", "บิลเครดิตในแท็บบิลรายวันของชีทบัญชี " + ui.fmt(d.sheetDailyCredit.n) + " ใบ ไม่นับซ้ำ — ลูกหนี้จากชีทนับจากแท็บลูกหนี้ (แบบที่ฝ่ายบัญชีนับ)") : "");
    const list = h("div.stack.flags");
    ui.renderList(list, d.customers, g => g.key, g => h("button.card", { type: "button", onclick: () => customerSheet(ctx, g, d.statements.filter(s => (s.customer_id || "n:" + s.customer_name) === g.key || s.customer_name === g.customer_name), () => ctx.refresh()) },
      h("div.row", h("span.name.grow", g.customer_name), h("b", money(g.due_satang, f))),
      h("div.row.small.muted", ui.fmt(g.n) + " บิล", g.late ? ui.pill("เลยกำหนด " + g.late, "bad", "alert") : null, g.bills.some(b => b.src === "acct") ? ui.pill("มีบิลจากชีทบัญชี", "mute") : null)), ui.empty("ไม่มีลูกหนี้ค้าง"));
    box.append(h("div.lbl", "รายลูกค้า · " + d.customers.length + " ร้าน"), list);
    if (d.statements.length) {
      box.append(h("div.lbl", "ใบวางบิลที่ยังเก็บไม่ครบ · " + d.statements.length),
        h("div.stack", d.statements.map(s => h("button.card", { type: "button", onclick: () => stmtSheet(ctx, s.stmt_no, () => ctx.refresh()) },
          h("div.row", h("b.grow", s.customer_name), h("b", money(s.total_satang, f))),
          h("div.row.small.muted", "ใบวางบิล " + s.stmt_no + " · " + ui.fmt(s.bill_count) + " บิล · วาง " + TH_DAY(s.stmt_day), s.collect_day ? ui.pill("นัดเก็บ " + TH_DAY(s.collect_day), s.collect_day < todayTh() ? "bad" : "warn", "calendar") : null)))));
    }
  });
}
function customerSheet(ctx, g, stmts, after) {
  const sh = ui.sheet({ title: g.customer_name, foot: true });
  const picked = new Set();
  const sum = h("b.big.md");
  const payBtn = h("button.btn.pri", { type: "button" }, "รับชำระที่เลือก");
  const stBtn = h("button.btn", { type: "button" }, "ออกใบวางบิล");
  const draw = () => {
    const sel = g.bills.filter(b => picked.has(b.bill_no));
    sum.textContent = money(sel.reduce((s, b) => s + b.due_satang, 0));
    payBtn.setAttribute("aria-disabled", String(!sel.length)); stBtn.setAttribute("aria-disabled", String(!sel.length || sel.some(b => b.stmt_no)));
  };
  sh.body.append(h("p.small.muted", "แตะเลือกบิลที่ลูกค้าจ่าย/จะวางบิล · บิลจากชีทบัญชีรับชำระในชีท"));
  for (const b of g.bills) {
    const can = b.payable;
    const el = h("button.card", { type: "button", "aria-pressed": "false", onclick: () => {
      if (!can) { billSheet(ctx, b.bill_no, { after }); return; }
      if (picked.has(b.bill_no)) picked.delete(b.bill_no); else picked.add(b.bill_no);
      el.setAttribute("aria-pressed", String(picked.has(b.bill_no))); draw();
    } },
      h("div.row", h("span.grow", TH_DAY(b.bill_day) + (b.paper_no ? " · บิล #" + b.paper_no : "")), h("b", money(b.due_satang))),
      h("div.row.small", srcPill(b), b.late ? ui.pill("เลยกำหนด " + TH_DAY(b.due_day), "bad", "alert") : b.due_day ? ui.pill("กำหนด " + TH_DAY(b.due_day), "mute", "calendar") : null, b.stmt_no ? ui.pill("ใบวางบิล " + b.stmt_no, "brand") : null, can ? null : h("span.muted", "แตะดู")));
    sh.body.append(el);
  }
  for (const s of stmts) sh.body.append(h("button.btn.ghost", { type: "button", onclick: () => { sh.close(); stmtSheet(ctx, s.stmt_no, after); } }, "ใบวางบิล " + s.stmt_no + " · " + money(s.total_satang)));
  payBtn.addEventListener("click", () => { const sel = g.bills.filter(b => picked.has(b.bill_no)); if (!sel.length) return ui.toast("แตะเลือกบิลก่อน", "warn"); sh.close(); paySheet(ctx, sel, { after }); });
  stBtn.addEventListener("click", async () => {
    const sel = g.bills.filter(b => picked.has(b.bill_no));
    if (!sel.length) return ui.toast("แตะเลือกบิลก่อน", "warn");
    if (sel.some(b => b.stmt_no)) return ui.toast("มีบิลที่อยู่ในใบวางบิลแล้ว", "warn");
    const pick = await collectDaySheet(ctx, sel);
    if (pick === null) return;
    const res = await tryWrite(ctx, "account.stmt_create", { bill_nos: sel.map(b => b.bill_no), collect_day: pick });
    if (!res.ok) return ui.toast(res.e.message, "bad");
    sh.close(); undoBar(ctx, res.r, "ออกใบวางบิล " + res.r.data.stmt_no, after); if (after) after();
  });
  sh.foot.append(h("div.row", h("span.muted.grow", "ที่เลือก"), sum), h("div.btns", { style: { marginTop: "8px" } }, stBtn, payBtn));
  draw();
  return sh;
}
function collectDaySheet(ctx, bills) {
  return new Promise(resolve => {
    let out = null;
    const sh = ui.sheet({ title: "ออกใบวางบิล · " + bills.length + " บิล", modal: true, onClose: () => resolve(out) });
    sh.body.append(h("div.row", h("span.muted.grow", "ยอดเก็บ"), h("b.big.md", money(bills.reduce((s, b) => s + b.due_satang, 0)))), h("div.lbl", "นัดเก็บเงิน"),
      h("div.chips", [["", "ยังไม่นัด"], [addDay(todayTh(), 7), "7 วัน"], [addDay(todayTh(), 15), "15 วัน"], [addDay(todayTh(), 30), "30 วัน"]].map(([v, l]) => h("button.chip", { type: "button", onclick: () => { out = v; sh.close("ok"); } }, l))));
  });
}
async function stmtSheet(ctx, no, after) {
  const sh = ui.sheet({ title: "ใบวางบิล " + no, foot: true });
  let d;
  try { d = await ctx.api.read("account.stmt", { stmt_no: no }); } catch (e) { sh.body.append(ui.errorBox(e.message)); return; }
  const s = d.statement;
  sh.body.append(h("div.row", ui.statusPill(ctx.vocab, "statements.status", s.status), h("span.muted", s.customer_name)),
    h("div.row", h("span.muted.grow", "ยอดเก็บ"), h("span.big.md", money(s.total_satang))),
    h("div.kv", h("div", h("div.lbl", "วันที่วาง"), TH_DAY(s.stmt_day)), h("div", h("div.lbl", "นัดเก็บ"), s.collect_day ? TH_DAY(s.collect_day) : "ยังไม่นัด")),
    h("div.stack", { style: { gap: "6px" } }, d.bills.map(b => h("div.row", h("span.grow", TH_DAY(b.bill_day) + (b.paper_no ? " · บิล #" + b.paper_no : "")), statusPill(ctx, b), h("b", money(b.due_satang || b.total_satang))))),
    h("p.ref", "รหัสอ้างอิง " + s.stmt_no));
  const pay = d.bills.filter(b => b.payable);
  if (pay.length) sh.foot.append(h("button.btn.pri.block", { type: "button", onclick: () => { sh.close(); paySheet(ctx, pay, { after }); } }, "รับชำระทั้งใบ " + money(pay.reduce((x, b) => x + b.due_satang, 0))));
  if (s.status !== "ยกเลิก" && s.status !== "เก็บแล้ว") sh.foot.append(h("button.btn.ghost.block", { type: "button", style: { marginTop: "8px" }, onclick: () => ctx.save("account.stmt_cancel", { stmt_no: s.stmt_no, version: s.version }, { label: "ยกเลิกใบวางบิล " + s.stmt_no,
    confirm: { title: "ยกเลิกใบวางบิล " + s.stmt_no, detail: "บิลในใบนี้กลับไปวางใหม่ได้ · ใบเดิมยังอยู่ในประวัติ", reasons: ctx.reasons("stmt_cancel"), need: "required", okText: "ยกเลิกใบวางบิล" }, after: () => { sh.close(); if (after) after(); } }).catch(() => {}) }, "ยกเลิกใบวางบิล"));
}

// ── เงินเข้าบัญชีไหน (นับตามวันที่ชำระ · วัน/เดือน) ─────────────────────────────────────────
export function moneyInView(ctx, view) {
  let period = "day", day = todayTh();
  const chips = h("div.chips", { role: "group", "aria-label": "ช่วงเวลา" });
  const body = h("div.stack");
  const opts = () => {
    const t = todayTh(), lastMonth = addDay(t.slice(0, 8) + "01", -1);
    return [["วันนี้", "day", t], ["เมื่อวาน", "day", addDay(t, -1)], ["เดือนนี้", "month", t], ["เดือนก่อน", "month", lastMonth]];
  };
  const draw = () => {
    chips.replaceChildren(...opts().map(([l, p, d]) => h("button.chip", { type: "button", "aria-pressed": String(p === period && d === day), onclick: () => { period = p; day = d; draw(); } }, l)));
    body.replaceChildren();
    return ctx.load(body, "money:" + period + ":" + day, "account.money", (box, d, st) => {
      const f = st.fresh;
      const max = Math.max(1, ...d.byChannel.map(c => c.satang));
      box.replaceChildren(
        h("div.card", h("div.row", h("b.grow", "เงินเข้ารวม"), h("span.big.md", money(d.total, f))), h("span.small.muted", thText(d.label)), st.fresh ? null : ui.stamp(st.at, st.updating)),
        h("div.card", h("div.lbl", "แยกบัญชี/ช่องทาง"), d.byChannel.length ? h("div.stack", { style: { gap: "8px" } }, d.byChannel.map(c => h("div",
          h("div.row", h("span.grow", chLabel(ctx, c.channel)), h("b", money(c.satang, f))),
          h("div.mbar", { "aria-hidden": "true" }, h("i", { style: { width: (f ? Math.round(c.satang / max * 100) : 0) + "%" } }))))) : h("span.muted", f ? "ยังไม่มีเงินเข้าในช่วงนี้" : "—")));
      if (d.period === "month" && d.byDay.length) box.append(h("div.card", h("div.lbl", "รายวัน"), h("div.stack", { style: { gap: "4px" } }, d.byDay.map(x => h("div.row", h("span.grow", TH_DAY(x.day)), h("b", money(x.satang, f)))))));
      box.append(h("div.lbl", "รายการ · " + d.entries.length));
      const list = h("div.stack");
      ui.renderList(list, d.entries, e => e.kind + e.id, e => h("button.card", { type: "button", onclick: () => billSheet(ctx, e.bill_no, { after: () => ctx.refresh() }) },
        h("div.row", h("span.name.grow", e.customer_name), h("b", money(e.satang, f))),
        h("div.row.small.muted", (d.period === "month" ? TH_DAY(e.day) + " · " : "") + chLabel(ctx, e.channel) + (e.paper_no ? " · บิล #" + e.paper_no : "") + (e.by_nick ? " · " + e.by_nick : ""), ui.pill(e.src_label, e.src_label === "ชีทบัญชี" ? "mute" : "brand"))), ui.empty("ไม่มีรายการในช่วงนี้"));
      box.append(list);
    }, { period, day });
  };
  view.append(chips, body);
  return draw();
}
