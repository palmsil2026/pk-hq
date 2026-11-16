// ═══════════════════════════════════════════════════════════════════════
//  ทีมสกรีนสี — หน้าแรก "คิวสกรีน" เรียงตามวันส่ง (ด่วนขึ้นก่อน)                         v2/web/roles/screen.js
//  ของเดิม: แตะทีม → แตะเสร็จ จบในสองแตะ ไม่กรอกจำนวน (ของใหม่ห้ามยากกว่า) · ลงดี/เสียได้แต่ไม่บังคับ (ตัวเลือกเพิ่มเติม)
//  กดแล้วบันทึกทันที + แถบ "ย้อน" (ไม่มีแผ่นถามยืนยัน — ของเดิมก็ไม่มี) · สองคนกดงานเดียวกัน = คนหลังเห็นว่าใครรับไปแล้ว
// ═══════════════════════════════════════════════════════════════════════
import * as ui from "../assets/ui.js";
import { save, duePill, qtyOf, fullName, useCss, put } from "./sdkit.js";
const { h, icon } = ui;

const teamsOf = (ctx, d) => (d && d.teams && d.teams.length ? d.teams : (ctx.me && ctx.me.screenTeams) || ["ทีม 1", "ทีม 2", "ทีม 3"]);
const amount = j => qtyOf(j, j.qty_pcs || j.item_pcs || 0);
const colorOf = j => j.colors || j.screen_color || "";

/** จ่ายทีม (แตะเดียว) */
function assign(ctx, j, team, btn) {
  if (j.team === team && j.status === "เตรียมการสกรีน") { ui.toast(team + " รับงานนี้อยู่แล้ว"); return; }
  return ui.busy(btn, () => save(ctx, "screen.assign", { id: j.id, version: j.version, team }, { label: team + " รับงาน " + j.customer }));
}
/** เสร็จแล้ว: มีทีมแล้ว = แตะเดียวจบ · ยังไม่มีทีม = ถามทีมไหนทำ (แตะชื่อทีม = บันทึกเลย) */
function done(ctx, j, teams, btn, counts) {
  const go = (team, b) => ui.busy(b || btn, () => save(ctx, "screen.done", Object.assign({ id: j.id, version: j.version, team: team || "" }, counts || {}), { label: "สกรีนเสร็จ " + j.customer }));
  if (j.team) return go(j.team);
  const sh = ui.sheet({ title: "ทีมไหนทำงานนี้?", modal: true });
  put(sh.body, h("p.muted", j.customer + " · สกรีน " + (colorOf(j) || "—")),
    h("div.btns.teamgrid", teams.map(t => h("button.btn.pri", { type: "button", onclick: e => { sh.close(); go(t, e.currentTarget); } }, t))),
    h("button.btn.ghost.block", { type: "button", onclick: e => { sh.close(); go("", e.currentTarget); } }, "ไม่ระบุทีม — เสร็จเลย"));
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
    h("div.row", h("span.name.grow", j.customer), j.urgent ? ui.pill("ด่วน", "bad", "bolt") : null, duePill(j.due_day, d.today)),
    h("div.row", amount(j), colorOf(j) ? h("span.scr", icon("brush", "sm"), "สกรีน " + colorOf(j)) : null, j.brand ? h("span.muted.small", "งาน " + j.brand) : null),
    h("div.row", j.team ? ui.pill(j.team + " กำลังทำ", "brand", "users") : ui.pill("รอจ่ายทีม", "warn")));
  const btns = h("div.btns.jobbtns", teams.map(t => h("button.btn" + (j.team === t ? ".pri" : ""), { type: "button", "aria-pressed": String(j.team === t), onclick: e => assign(ctx, j, t, e.currentTarget) }, t)),
    h("button.btn.ok", { type: "button", onclick: e => done(ctx, j, teams, e.currentTarget) }, icon("check", "sm"), "เสร็จ"));
  return h("div.card.job" + (j.late ? ".late" : ""), head, btns);
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
    j.order_note || j.note ? h("p", h("span.lbl", "หมายเหตุ "), [j.order_note, j.note].filter(Boolean).join(" · ")) : null);
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
      h("details.more", h("summary.btn.ghost.block", "ตัวเลือกเพิ่มเติม"),
        h("button.btn.block", { type: "button", onclick: async e => { const b = e.currentTarget, c = await askCounts(j); if (c) { sh.close(); done(ctx, j, teams, b, c); } } }, "ลงจำนวนดี/เสีย แล้วกดเสร็จ")));
  } else if (j.status === "เสร็จแล้ว") {
    const mineUndo = j.undo_id && (j.undo_staff === (ctx.me && ctx.me.staff && ctx.me.staff.id) || (ctx.me && (ctx.me.roles || []).includes("exec")));
    put(sh.foot, h("div.btns",
      h("button.btn", { type: "button", onclick: async e => { const b = e.currentTarget, c = await askCounts(j); if (!c) return; sh.close(); ui.busy(b, () => save(ctx, "screen.count", { id: j.id, version: j.version, good: c.good, waste: c.waste }, { label: "ลงจำนวน " + j.customer })); } }, "ลงจำนวนดี/เสีย"),
      mineUndo ? h("button.btn", { type: "button", onclick: async e => { sh.close(); await ui.busy(e.currentTarget, async () => { try { await ctx.api.write("undo.run", { id: j.undo_id }); ui.toast("ย้อนแล้ว — " + j.customer + " กลับไปอยู่ในคิว"); } catch (er) { ui.toast(er.message, "bad"); } ctx.refresh(); }); } }, icon("undo", "sm"), "ย้อน (กดเสร็จผิด)") : null));
  } else sh.foot.remove();
}

export default {
  code: "screen", title: "ทีมสกรีนสี",
  nav: [
    { key: "queue", label: "คิว", icon: "list", title: "คิวสกรีน" },
    { key: "done", label: "เสร็จวันนี้", icon: "check" },
    { key: "history", label: "ประวัติ", icon: "clock", title: "ประวัติงานสกรีน" },
  ],
  views: {
    queue(ctx, view) {
      useCss();
      let filter = "";
      return ctx.load(view, "queue", "screen.list", (box, d, st) => {
        if (!box.dataset.built) { box.dataset.built = "1"; box.append(h("div.card.sum"), h("div.chips.teamfilter", { role: "group", "aria-label": "ดูงานของทีม" }), h("div.stack.jobs")); }
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
        if (!box.dataset.built) { box.dataset.built = "1"; box.append(h("div.card.sum"), h("div.teamsum"), h("div.stack.jobs")); }
        const pcs = d.doneToday.reduce((s, t) => s + t.pcs, 0);
        box.querySelector(".sum").replaceChildren(h("div.row", h("span.big", ui.fmt(d.jobs.length)), h("span.muted.grow", "งานเสร็จวันนี้ · " + ui.thDay(d.today)), ui.qty("รวม", pcs, "ใบ")), st.fresh ? "" : ui.stamp(st.at, st.updating));
        box.querySelector(".teamsum").replaceChildren(...d.doneToday.map(t => h("div.card.tsum", h("b", t.team || "ไม่ระบุทีม"), h("span.muted", ui.fmt(t.jobs) + " งาน"), ui.qty("", t.pcs, "ใบ"))));
        const teams = teamsOf(ctx, d);
        ui.renderList(box.querySelector(".jobs"), d.jobs, j => j.id + ":" + j.version, j => h("button.card", { type: "button", onclick: () => jobSheet(ctx, j, d, teams) },
          h("div.row", h("span.name.grow", j.customer), ui.pill(j.team || "ไม่ระบุทีม", j.team ? "brand" : "mute", "users")),
          h("div.row", amount(j), colorOf(j) ? h("span.scr", icon("brush", "sm"), "สกรีน " + colorOf(j)) : null),
          h("div.row.small.muted", "เสร็จ " + ui.thTime(j.done_at) + (j.done_nick ? " · " + j.done_nick : "") + (j.good_pcs !== null && j.good_pcs !== undefined ? " · ดี " + ui.fmt(j.good_pcs) + " เสีย " + ui.fmt(j.waste_pcs || 0) : ""))),
          ui.empty("ยังไม่มีงานเสร็จวันนี้", "กด \"เสร็จ\" ในคิวแล้วงานจะมาอยู่ที่นี่"));
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
