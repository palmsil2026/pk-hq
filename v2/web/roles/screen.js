// ═══════════════════════════════════════════════════════════════════════
//  ทีมสกรีนสี — หน้าแรก "คิวสกรีน" เรียงตามวันส่ง (ด่วนขึ้นก่อน)                         v2/web/roles/screen.js
//  ของเดิม: แตะทีม → แตะเสร็จ จบในสองแตะ ไม่กรอกจำนวน (ของใหม่ห้ามยากกว่า) · ลงดี/เสียได้แต่ไม่บังคับ (ตัวเลือกเพิ่มเติม)
//  กดแล้วบันทึกทันที + แถบ "ย้อน" (ไม่มีแผ่นถามยืนยัน — ของเดิมก็ไม่มี) · สองคนกดงานเดียวกัน = คนหลังเห็นว่าใครรับไปแล้ว
//  งานหลายวัน: ปุ่มรอง "ทำวันนี้ … ถุง" (แป้นของแอป ถุง + เศษใบ · ไม่บังคับ) → งานยังอยู่ในคิว โชว์ "ทำแล้ว 5/20 ถุง"
//    · "เสร็จ" ทีหลัง = ส่วนที่เหลือ · ย้อนได้ทีละช่วง (ช่วงล่าสุด) · งานวันเดียว = ทีม → เสร็จ สองแตะเหมือนเดิม
// ═══════════════════════════════════════════════════════════════════════
import * as ui from "../assets/ui.js";
import { save, duePill, qtyOf, fullName, useCss, put } from "./sdkit.js";
import { stopSheet, resumeSheet, shareBtn, stopStats, eventRow, durWords } from "./repair.js";   // 0321 จอด/เดินต่อเครื่องสกรีน
import { routePlanner } from "./route-planner.js";
const { h, icon } = ui;

const teamsOf = (ctx, d) => (d && d.teams && d.teams.length ? d.teams : (ctx.me && ctx.me.screenTeams) || ["ทีม 1", "ทีม 2", "ทีม 3"]);
const amount = j => qtyOf(j, j.qty_pcs || j.item_pcs || 0);
const colorOf = j => j.colors || j.screen_color || "";
const plannedOf = j => j.qty_pcs || j.item_pcs || 0;
const isMe = (ctx, staffId) => staffId && (staffId === (ctx.me && ctx.me.staff && ctx.me.staff.id) || (ctx.me && (ctx.me.roles || []).includes("exec")));
/** จำนวนเป็นคำ ถุง + เศษใบ ("5 ถุง" · "5 ถุง 20 ใบ") */
function amountWords(j, pcs) {
  const per = j.per_bag > 0 ? j.per_bag : 0, unit = j.piece_unit || "ใบ";
  if (!per) return ui.fmt(pcs) + " " + unit;
  const b = Math.floor(pcs / per), r = pcs - b * per;
  return (b ? ui.fmt(b) + " ถุง" : "") + (b && r ? " " : "") + (r || !b ? ui.fmt(r) + " " + unit : "");
}
/** "ทำแล้ว 5/20 ถุง" (ถุงไม่ลงตัว = ใบ) */
function progWords(j) {
  const per = j.per_bag > 0 ? j.per_bag : 0, made = j.done_pcs || 0, all = plannedOf(j);
  if (per && made % per === 0 && all % per === 0) return "ทำแล้ว " + ui.fmt(made / per) + "/" + ui.fmt(all / per) + " ถุง";
  return "ทำแล้ว " + ui.fmt(made) + "/" + ui.fmt(all) + " " + (j.piece_unit || "ใบ");
}
/** แถบความคืบหน้า + คำ (งานที่ทำบางส่วนแล้ว) */
function progress(j) {
  const all = plannedOf(j), made = j.done_pcs || 0;
  if (!made) return null;
  const pct = all ? Math.min(100, Math.round(made / all * 100)) : 0;
  return h("div.prog", h("div.bar", { role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(pct), "aria-label": progWords(j) }, h("i", { style: { width: pct + "%" } })),
    h("span.small", h("b", progWords(j)), all > made ? " · ค้าง " + amountWords(j, all - made) : ""));
}

/** จ่ายทีม (แตะเดียว) */
function assign(ctx, j, team, btn) {
  if (j.team === team && j.status === "เตรียมการสกรีน") { ui.toast(team + " รับงานนี้อยู่แล้ว"); return; }
  return ui.busy(btn, () => save(ctx, "screen.assign", { id: j.id, version: j.version, team }, { label: team + " รับงาน " + j.customer }));
}
/** มีทีมแล้ว = ทำต่อเลย · ยังไม่มีทีม = ถามทีมไหนทำ (แตะชื่อทีม = บันทึกเลย) */
function withTeam(j, teams, go, skipText, note) {
  if (j.team) return go(j.team);
  const sh = ui.sheet({ title: "ทีมไหนทำงานนี้?", modal: true });
  put(sh.body, h("p.muted", j.customer + " · สกรีน " + (colorOf(j) || "—") + (note ? " · " + note : "")),
    h("div.btns.teamgrid", teams.map(t => h("button.btn.pri", { type: "button", onclick: e => { sh.close(); go(t, e.currentTarget); } }, t))),
    h("button.btn.ghost.block", { type: "button", onclick: e => { sh.close(); go("", e.currentTarget); } }, skipText));
}
/** เสร็จแล้ว: มีทีมแล้ว = แตะเดียวจบ · ยังไม่มีทีม = ถามทีมไหนทำ */
function done(ctx, j, teams, btn, counts) {
  const go = (team, b) => ui.busy(b || btn, () => save(ctx, "screen.done", Object.assign({ id: j.id, version: j.version, team: team || "" }, counts || {}), { label: "สกรีนเสร็จ " + j.customer }));
  return withTeam(j, teams, go, "ไม่ระบุทีม — เสร็จเลย");
}

/** แป้น "ทำวันนี้": ถุง + เศษใบ (แป้นของแอป) → จำนวนใบ หรือ null */
function bagPad(j) {
  return new Promise(resolve => {
    const per = j.per_bag > 0 ? j.per_bag : 0, unit = j.piece_unit || "ใบ";
    const all = plannedOf(j), made = j.done_pcs || 0;
    const v = { bags: "", loose: "" };
    let field = per ? "bags" : "loose", result = null;
    const S = ui.sheet({ title: "ทำวันนี้ · " + j.customer, modal: true, onClose: () => resolve(result) });
    const msg = h("p.err", { role: "alert" });
    const total = h("p.muted.small", { "aria-live": "polite" });
    const pcs = () => (Number(v.bags) || 0) * per + (Number(v.loose) || 0);
    const box = (k, label, u) => h("button.numdisp.pick", { type: "button", dataset: { f: k }, onclick: () => { field = k; draw(); } }, h("span.k", label), h("span.v"), h("span.k", u));
    const fields = h("div.bagfields", per ? box("bags", "ถุง", "ถุงละ " + ui.fmt(per)) : null, box("loose", per ? "เศษ" : "จำนวน", unit));
    const draw = () => {
      fields.querySelectorAll(".pick").forEach(b => { b.setAttribute("aria-pressed", String(b.dataset.f === field)); b.querySelector(".v").textContent = v[b.dataset.f] === "" ? "0" : ui.fmt(Number(v[b.dataset.f])); });
      const n = pcs();
      total.textContent = n ? "= " + ui.fmt(n) + " " + unit + (all ? (made + n >= all ? " · ครบที่เหลือ = กดเสร็จให้เลย" : " · ค้างอีก " + amountWords(j, all - made - n)) : "") : (all ? "เหลือ " + amountWords(j, all - made) : "");
    };
    const pad = ui.numpad(k => {
      if (k === "del") v[field] = v[field].slice(0, -1);
      else if (k === "ok") { const n = pcs(); if (!n) { msg.textContent = "ใส่จำนวนที่ทำวันนี้ก่อน"; return; } result = n; S.close("ok"); return; }
      else if (v[field].length < 7) v[field] = (v[field] === "0" ? "" : v[field]) + k;
      msg.textContent = "";
      draw();
    }, { ok: "บันทึก" });
    put(S.body, made ? h("p", h("b", progWords(j))) : h("p.muted", "ทำไม่หมดวันนี้ ลงเท่าที่ทำ — งานยังอยู่ในคิว"), fields, total, msg, pad);
    draw();
  });
}
/** ทำวันนี้บางส่วน → ครบที่เหลือ = กดเสร็จให้ (ส่วนที่เหลือ) */
async function partDone(ctx, j, teams, btn) {
  const n = await bagPad(j);
  if (!n) return;
  const all = plannedOf(j), made = j.done_pcs || 0;
  if (all && made + n >= all) return done(ctx, j, teams, btn, made + n > all ? { good: made + n } : null);
  const go = (team, b) => ui.busy(b || btn, () => save(ctx, "screen.part", { id: j.id, version: j.version, team: team || "", pcs: n }, { label: "ทำวันนี้ " + amountWords(j, n) + " " + j.customer }));
  return withTeam(j, teams, go, "ไม่ระบุทีม — บันทึกเลย", "ทำวันนี้ " + amountWords(j, n));
}
/** ย้อนช่วงล่าสุด */
async function undoPart(ctx, undoId, label, btn) {
  await ui.busy(btn, async () => { try { await ctx.api.write("undo.run", { id: undoId }); ui.toast("ย้อนแล้ว — " + label); } catch (er) { ui.toast(er.message, "bad"); } ctx.refresh(); });
}
const partUnit = j => (j.per_bag > 0 ? "ถุง" : (j.piece_unit || "ใบ"));
/** ประวัติทุกช่วงของงาน (โหลดเมื่อเปิดแผ่น) */
function partsBox(ctx, j) {
  const box = h("div.stack", ui.skeleton(1));
  ctx.api.read("screen.progress", { job: j.id }).then(d => {
    const p = d.jobs[0];
    if (!p || (!p.parts.length && !p.done)) { box.replaceChildren(); return; }
    const row = (at, team, text, by, tag) => h("div.partrow", h("span.tm", ui.thDayOf(at) + " " + ui.thTime(at)),
      h("span", h("b", text), tag ? " · " + tag : ""), h("span.muted.small", [team || "ไม่ระบุทีม", by].filter(Boolean).join(" · ")));
    box.replaceChildren();
    put(box, h("div.lbl", "ทำไปแล้ว " + p.parts.length + " ช่วง"),
      p.parts.map(x => row(x.at, x.team, x.text, x.by)),
      p.done && p.parts.length ? row(p.done.at, p.done.team, p.done.text, p.done.by, "ส่วนที่เหลือ (กดเสร็จ)") : null);
  }).catch(e => box.replaceChildren(ui.errorBox("โหลดประวัติช่วงไม่สำเร็จ: " + e.message)));
  return box;
}
/** ลงจำนวนดี/เสีย ด้วยแป้นของแอป (ไม่บังคับ) → { good, waste } หรือ null */
async function askCounts(j) {
  const planned = j.qty_pcs || j.item_pcs || 0;
  const good = await ui.numpadSheet({ title: "สกรีนได้ (ดี)", label: "ดี", unit: j.piece_unit || "ใบ", value: j.good_pcs === null || j.good_pcs === undefined ? planned : j.good_pcs });
  if (good === null) return null;
  const waste = await ui.numpadSheet({ title: "เสีย", label: "เสีย", unit: j.piece_unit || "ใบ", value: j.waste_pcs || 0 });
  if (waste === null) return null;
  return { good, waste };
}

function jobCard(ctx, j, d, teams) {
  const head = h("button.cardhead", { type: "button", "aria-label": "รายละเอียด " + j.customer, onclick: () => jobSheet(ctx, j, d, teams) },
    h("div.row", h("span.name.grow", j.customer), j.urgent ? ui.pill("ด่วน", "bad", "bolt") : null, j.prio ? ui.pill(j.prio > 0 ? "ออฟฟิศดันขึ้นก่อน" : "ออฟฟิศเลื่อนลง", j.prio > 0 ? "warn" : "mute", "flag") : null, duePill(j.due_day, d.today)),
    h("div.row", amount(j), colorOf(j) ? h("span.scr", icon("brush", "sm"), "สกรีน " + colorOf(j)) : null, j.brand ? h("span.muted.small", "งาน " + j.brand) : null),
    h("div.row", j.team ? ui.pill(j.team + " กำลังทำ", "brand", "users") : ui.pill("รอจ่ายทีม", "warn")), progress(j));
  const btns = h("div.btns.jobbtns", teams.map(t => h("button.btn" + (j.team === t ? ".pri" : ""), { type: "button", "aria-pressed": String(j.team === t), onclick: e => assign(ctx, j, t, e.currentTarget) }, t)),
    h("button.btn.ok", { type: "button", onclick: e => done(ctx, j, teams, e.currentTarget) }, icon("check", "sm"), "เสร็จ"));
  const partBtn = h("button.btn.ghost.block.partbtn", { type: "button", onclick: e => partDone(ctx, j, teams, e.currentTarget) }, icon("plus", "sm"), "ทำวันนี้ … " + partUnit(j));
  return h("div.card.job" + (j.late ? ".late" : ""), head, btns, h("div.partline", partBtn));
}

function jobSheet(ctx, j, d, teams) {
  const live = j.status === "รอดำเนินการ" || j.status === "เตรียมการสกรีน";
  const sh = ui.sheet({ title: j.customer, foot: true });
  put(sh.body, 
    h("div.row", ui.statusPill(ctx.vocab, "screen_jobs.status", j.status), j.team ? ui.pill(j.team, "brand", "users") : null, j.urgent ? ui.pill("ด่วน", "bad", "bolt") : null, duePill(j.due_day, d.today, !live)),
    h("div.card.flat", h("div.row", h("b.grow", fullName(j)), amount(j)),
      h("div.row", colorOf(j) ? h("span.scr", icon("brush", "sm"), "สกรีน " + colorOf(j)) : null, j.cap_color ? h("span.muted", "ฝา " + j.cap_color) : null)),
    h("div.kv",
      h("div", h("div.lbl", "สั่งเมื่อ"), ui.thDay(j.order_day)),
      h("div", h("div.lbl", "กำหนดส่ง"), j.due_day ? ui.thDay(j.due_day) : "ยังไม่กำหนด"),
      j.taker ? h("div", h("div.lbl", "ผู้รับออเดอร์"), j.taker) : null,
      j.purchase_type ? h("div", h("div.lbl", "ประเภทการซื้อ"), j.purchase_type) : null,
      j.brand ? h("div", h("div.lbl", "งาน/แบรนด์"), j.brand) : null,
      j.design_status ? h("div", h("div.lbl", "แบบ"), j.design_status) : null,
      j.route_code ? h("div", h("div.lbl", "สาย"), j.route_code + (j.district ? " · " + j.district : "")) : null),
    j.order_note || j.note ? h("p", h("span.lbl", "หมายเหตุ "), [j.order_note, j.note].filter(Boolean).join(" · ")) : null,
    progress(j), j.parts_n ? partsBox(ctx, j) : null);
  if (!live) {
    put(sh.body, h("div.kv",
      h("div", h("div.lbl", "เสร็จเมื่อ"), ui.thDayOf(j.done_at) + " " + ui.thTime(j.done_at)),
      h("div", h("div.lbl", "กดโดย"), j.done_nick || "—"),
      h("div", h("div.lbl", "ดี"), j.good_pcs === null || j.good_pcs === undefined ? "ไม่ได้ลง" : ui.fmt(j.good_pcs)),
      h("div", h("div.lbl", "เสีย"), j.waste_pcs === null || j.waste_pcs === undefined ? "ไม่ได้ลง" : ui.fmt(j.waste_pcs))));
  }
  put(sh.body, h("p.ref", "รหัสอ้างอิง " + j.id));
  if (live) {
    put(sh.foot, h("div.btns.jobbtns", teams.map(t => h("button.btn" + (j.team === t ? ".pri" : ""), { type: "button", "aria-pressed": String(j.team === t), onclick: e => { sh.close(); assign(ctx, j, t, e.currentTarget); } }, t)),
      h("button.btn.ok", { type: "button", onclick: e => { sh.close(); done(ctx, j, teams, e.currentTarget); } }, icon("check", "sm"), "เสร็จ")),
      h("button.btn.block", { type: "button", onclick: e => { const b = e.currentTarget; sh.close(); partDone(ctx, j, teams, b); } }, icon("plus", "sm"), "ทำวันนี้ … " + partUnit(j) + " (ยังไม่เสร็จทั้งงาน)"),
      j.parts_n && j.last_part_ver === j.version && j.part_undo && isMe(ctx, j.undo_staff)
        ? h("button.btn.ghost.block", { type: "button", onclick: e => { const b = e.currentTarget; sh.close(); undoPart(ctx, j.part_undo, "ช่วงล่าสุดของ " + j.customer, b); } }, icon("undo", "sm"), "ย้อนช่วงล่าสุด (ลงผิด)") : null,
      h("details.more", h("summary.btn.ghost.block", "ตัวเลือกเพิ่มเติม"),
        h("button.btn.block", { type: "button", onclick: async e => { const b = e.currentTarget, c = await askCounts(j); if (c) { sh.close(); done(ctx, j, teams, b, c); } } }, "ลงจำนวนดี/เสีย แล้วกดเสร็จ")));
  } else if (j.status === "เสร็จแล้ว") {
    const mineUndo = j.undo_id && (j.undo_staff === (ctx.me && ctx.me.staff && ctx.me.staff.id) || (ctx.me && (ctx.me.roles || []).includes("exec")));
    put(sh.foot, h("div.btns",
      h("button.btn", { type: "button", onclick: async e => { const b = e.currentTarget, c = await askCounts(j); if (!c) return; sh.close(); ui.busy(b, () => save(ctx, "screen.count", { id: j.id, version: j.version, good: c.good, waste: c.waste }, { label: "ลงจำนวน " + j.customer })); } }, "ลงจำนวนดี/เสีย"),
      mineUndo ? h("button.btn", { type: "button", onclick: async e => { sh.close(); await ui.busy(e.currentTarget, async () => { try { await ctx.api.write("undo.run", { id: j.undo_id }); ui.toast("ย้อนแล้ว — " + j.customer + " กลับไปอยู่ในคิว"); } catch (er) { ui.toast(er.message, "bad"); } ctx.refresh(); }); } }, icon("undo", "sm"), "ย้อน (กดเสร็จผิด)") : null));
  } else sh.foot.remove();
}

// ── เครื่องสกรีน S1–S8: สถานะ + จอด / ซ่อมเสร็จ · เดินต่อ + แชร์ลงไลน์ (ไม่มีรอบเครื่อง) ──────────────────
function machineBar(ctx, d) {
  const st = d.machinesStopped || [];
  const open = () => machinesSheet(ctx);
  if (!st.length) return h("button.smbar", { type: "button", onclick: open }, icon("gear", "sm"), h("span.grow", "เครื่องสกรีน · ใช้ได้ทุกเครื่อง"), h("span.muted.small", "จอด/แจ้งเสีย"), icon("chev", "sm"));
  return h("button.smbar.stopped", { type: "button", onclick: open }, icon("pause", "sm"),
    h("span.grow", h("b", "จอดอยู่ " + st.length + " เครื่อง: "), st.map(m => m.name + " (" + (m.part || m.reason || "ไม่ระบุ") + " · " + durWords(Date.now() - Date.parse(m.started_at)) + ")").join(" · ")), icon("chev", "sm"));
}
function machinesSheet(ctx) {
  const sh = ui.sheet({ title: "เครื่องสกรีน" });
  const draw = async () => {
    sh.body.replaceChildren(ui.skeleton(3));
    let d;
    try { d = await ctx.api.read("smachine.list", {}); } catch (e) { sh.body.replaceChildren(ui.errorBox("โหลดเครื่องสกรีนไม่สำเร็จ: " + e.message, draw)); return; }
    const after = () => { draw(); ctx.refresh(); };
    sh.body.replaceChildren(h("p.muted.small", d.stopped ? "จอดอยู่ " + d.stopped + " เครื่อง" : "ใช้ได้ทุกเครื่อง"), h("div.smlist", d.machines.map(m => {
      const s = m.stop;
      return h("div.smrow" + (s ? ".stopped" : ""),
        h("div.row", h("b.grow", m.name), m.makes ? h("span.muted.small", m.makes) : null, s ? ui.pill("จอด", "warn", "pause") : ui.pill("ใช้ได้", "ok", "check")),
        s ? h("div.small", "จอดมา " + durWords(Date.now() - Date.parse(s.started_at)) + " · " + [s.reason, s.part].filter(Boolean).join(" · ") + (s.by ? " · แจ้งโดย " + s.by : "")) : null,
        !s && m.last ? h("div.small.muted", "ล่าสุด " + ui.thDayOf(m.last.started_at) + " · " + (m.last.part || m.last.reason) + " · หยุด " + durWords(m.last.minutes * 60000) + (m.last.fixed_by ? " · แก้โดย " + m.last.fixed_by : "")) : null,
        h("div.btns", s
          ? [h("button.btn.pri", { type: "button", onclick: () => resumeSheet(ctx, { action: "smachine.resume", name: m.name, stop: s, partKind: "screen_machine", after }) }, icon("play", "sm"), "ซ่อมเสร็จ"), shareBtn(s.share)]
          : [h("button.btn", { type: "button", onclick: () => stopSheet(ctx, { action: "smachine.stop", machine: m.id, name: m.name, reasonKind: "screen_stop", partKind: "screen_machine", after }) }, icon("pause", "sm"), "จอดเครื่อง")]),
        m.stats.t30.n ? h("details.more", h("summary.btn.ghost.block", "หยุดบ่อยเพราะอะไร · 7 วัน " + m.stats.t7.n + " ครั้ง"),
          stopStats(m.stats, { title: "หยุดบ่อยเพราะอะไร · " + m.name }), h("div.stack", m.recent.map(eventRow))) : null);
    })), h("p.ref", "เครื่องสกรีนในผังโรงงานเห็นไฟจอดด้วย (ประธาน/ทีมผลิต)"));
  };
  draw();
  return sh;
}

export default {
  code: "screen", title: "ทีมสกรีนสี",
  nav: [
    { key: "queue", label: "คิว", icon: "list", title: "คิวสกรีน" },
    { key: "plan", label: "จัดสายส่ง", icon: "calendar" },
    { key: "done", label: "เสร็จวันนี้", icon: "check" },
    { key: "history", label: "ประวัติ", icon: "clock", title: "ประวัติงานสกรีน" },
  ],
  views: {
    plan: routePlanner,
    queue(ctx, view) {
      useCss();
      let filter = "";
      return ctx.load(view, "queue", "screen.list", (box, d, st) => {
        if (!box.dataset.built) { box.dataset.built = "1"; box.append(h("div.card.sum"), h("div.smbox"), h("div.chips.teamfilter", { role: "group", "aria-label": "ดูงานของทีม" }), h("div.stack.jobs")); }
        box.querySelector(".smbox").replaceChildren(machineBar(ctx, d));
        const teams = teamsOf(ctx, d);
        const first = d.jobs.find(j => j.due_day);
        const doneN = d.doneToday.reduce((s, t) => s + t.jobs, 0);
        box.querySelector(".sum").replaceChildren(h("div.row", h("span.big", ui.fmt(d.jobs.length)), h("span.muted.grow", "งานรอสกรีน" + (first ? " · ส่งเร็วสุด " + ui.thDay(first.due_day) : "")),
          h("span.muted", "เสร็จวันนี้ " + ui.fmt(doneN))), st.fresh ? "" : ui.stamp(st.at, st.updating));
        const draw = () => {
          const opts = [["", "ทั้งหมด", d.jobs.length], ...teams.map(t => [t, t, d.jobs.filter(j => j.team === t).length]), ["-", "รอจ่ายทีม", d.jobs.filter(j => !j.team).length]];
          box.querySelector(".teamfilter").replaceChildren(...opts.map(([k, l, n]) => h("button.chip", { type: "button", "aria-pressed": String(filter === k), onclick: () => { filter = k; draw(); } }, n ? l + " · " + n : l)));
          const list = d.jobs.filter(j => !filter || (filter === "-" ? !j.team : j.team === filter));
          ui.renderList(box.querySelector(".jobs"), list, j => j.id + ":" + j.version, j => jobCard(ctx, j, d, teams), ui.empty("ไม่มีงานค้าง", filter ? "ไม่มีงานของ " + (filter === "-" ? "ที่รอจ่ายทีม" : filter) : "งานสกรีนใหม่จะขึ้นที่นี่เมื่อออฟฟิศลงออเดอร์ที่มีสกรีน"));
        };
        draw();
      }, { tab: "queue" });
    },

    done(ctx, view) {
      useCss();
      return ctx.load(view, "done", "screen.list", (box, d, st) => {
        if (!box.dataset.built) { box.dataset.built = "1"; box.append(h("div.card.sum"), h("div.teamsum"), h("div.stack.jobs"), h("section.stack.partsec")); }
        const pcs = d.doneToday.reduce((s, t) => s + t.pcs, 0);
        const parts = d.parts || [];
        box.querySelector(".sum").replaceChildren(h("div.row", h("span.big", ui.fmt(d.jobs.length)), h("span.muted.grow", "งานเสร็จวันนี้ · " + ui.thDay(d.today) + (parts.length ? " · ทำบางส่วน " + parts.length + " ครั้ง" : "")), ui.qty("รวม", pcs, "ใบ")), st.fresh ? "" : ui.stamp(st.at, st.updating));
        box.querySelector(".teamsum").replaceChildren(...d.doneToday.map(t => h("div.card.tsum", h("b", t.team || "ไม่ระบุทีม"), h("span.muted", ui.fmt(t.jobs) + " งาน" + (t.parts ? " · บางส่วน " + ui.fmt(t.parts) : "")), ui.qty("", t.pcs, "ใบ"))));
        const teams = teamsOf(ctx, d);
        // ช่วง "ทำวันนี้" ของงานหลายวัน (งานยังอยู่ในคิว) — ช่วงล่าสุดของงานย้อนได้
        const sec = box.querySelector(".partsec");
        if (parts.length) {
          sec.replaceChildren(h("div.lbl", "ทำบางส่วนวันนี้ (งานยังอยู่ในคิว)"));
          ui.renderList(sec.appendChild(h("div.stack.partlist")), parts, p => p.part_id + ":" + p.version, p => {
            const canUndo = p.latest && p.part_undo && p.status !== "เสร็จแล้ว" && isMe(ctx, p.part_by);
            return h("div.card.partcard", h("div.row", h("span.name.grow", p.customer), ui.pill(p.part_team || "ไม่ระบุทีม", p.part_team ? "brand" : "mute", "users")),
              h("div.row", qtyOf(p, p.part_pcs), colorOf(p) ? h("span.scr", icon("brush", "sm"), "สกรีน " + colorOf(p)) : null),
              h("div.row.small.muted", "ทำ " + ui.thTime(p.part_at) + (p.part_nick ? " · " + p.part_nick : "") + " · " + (p.status === "เสร็จแล้ว" ? "งานนี้เสร็จแล้ว" : progWords(p))),
              canUndo ? h("button.btn.ghost", { type: "button", onclick: e => undoPart(ctx, p.part_undo, "ทำวันนี้ " + amountWords(p, p.part_pcs) + " " + p.customer, e.currentTarget) }, icon("undo", "sm"), "ย้อนช่วงนี้") : null);
          });
        } else sec.replaceChildren();
        ui.renderList(box.querySelector(".jobs"), d.jobs, j => j.id + ":" + j.version, j => h("button.card", { type: "button", onclick: () => jobSheet(ctx, j, d, teams) },
          h("div.row", h("span.name.grow", j.customer), ui.pill(j.team || "ไม่ระบุทีม", j.team ? "brand" : "mute", "users")),
          h("div.row", amount(j), colorOf(j) ? h("span.scr", icon("brush", "sm"), "สกรีน " + colorOf(j)) : null),
          h("div.row.small.muted", "เสร็จ " + ui.thTime(j.done_at) + (j.done_nick ? " · " + j.done_nick : "") + (j.good_pcs !== null && j.good_pcs !== undefined ? " · ดี " + ui.fmt(j.good_pcs) + " เสีย " + ui.fmt(j.waste_pcs || 0) : ""))),
          parts.length ? null : ui.empty("ยังไม่มีงานเสร็จวันนี้", "กด \"เสร็จ\" ในคิวแล้วงานจะมาอยู่ที่นี่"));
      }, { tab: "today" });
    },

    history(ctx, view) {
      useCss();
      return ctx.load(view, "history", "screen.list", (box, d, st) => {
        if (!box.dataset.built) { box.dataset.built = "1"; box.append(h("div.stack.days"), h("div.morebox")); }
        let rows = d.jobs.slice(), cursor = d.more;
        const teams = teamsOf(ctx, d);
        const draw = () => {
          const days = new Map();
          rows.forEach(j => { const k = j.done_day || ""; if (!days.has(k)) days.set(k, []); days.get(k).push(j); });
          box.querySelector(".days").replaceChildren(...(rows.length ? [...days].map(([day, list]) => h("section.stack", h("div.lbl", ui.thDay(day) + " · " + list.length + " งาน"),
            list.map(j => h("button.card", { type: "button", onclick: () => jobSheet(ctx, j, d, teams) },
              h("div.row", h("span.name.grow", j.customer), ui.pill(j.team || "ไม่ระบุทีม", j.team ? "brand" : "mute", "users")),
              h("div.row", amount(j), colorOf(j) ? h("span.scr", icon("brush", "sm"), "สกรีน " + colorOf(j)) : null, h("span.muted.small.r", ui.thTime(j.done_at))))))) : [ui.empty("ยังไม่มีประวัติ", "งานที่เสร็จแล้วจะเก็บไว้ที่นี่")]));
          const more = box.querySelector(".morebox");
          more.replaceChildren(cursor ? h("button.btn.block", { type: "button", onclick: e => ui.busy(e.currentTarget, async () => {
            try { const n = await ctx.api.read("screen.list", { tab: "history", before: cursor }); rows = rows.concat(n.jobs); cursor = n.more; draw(); }
            catch (er) { ui.toast(er.message, "bad"); }
          }) }, "โหลดเพิ่ม") : "");
        };
        draw();
        if (!st.fresh) box.querySelector(".days").prepend(ui.stamp(st.at, st.updating));
      }, { tab: "history" });
    },
  },
};
