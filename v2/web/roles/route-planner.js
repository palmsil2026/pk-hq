import * as ui from "../assets/ui.js";
import { addDay, dowOf, put, shareText, TH_DOW, thDayLong, useCss } from "../parts/kit.js";

const { h, icon } = ui;
const state = { panel: "calendar", mode: "day", day: "" };
const toneText = { ok: "พร้อมส่ง", warn: "มีงานต้องทำ", bad: "เสี่ยงไม่ทัน" };
const labelOf = line => line.label + [line.screen && "สกรีน " + line.screen, line.cap_color && "ฝา " + line.cap_color].filter(Boolean).map(s => " · " + s).join("");
const stopKey = stop => stop.order + ":" + stop.round;
const btn = (style, label, onclick, attrs = {}) => h("button." + style, { type: "button", onclick, ...attrs }, label);
const number = n => ui.fmt(n);

function amount(line, pcs = line.pcs, size = "") {
  const per = line.per_bag, unit = line.piece_unit || "ใบ";
  const bags = per ? Math.floor(pcs / per) : 0;
  const remainder = per ? pcs % per : pcs;
  return bags ? ui.qty(size, bags, "ถุง" + (remainder ? " + " + number(remainder) + " " + unit : ""), number(pcs) + " " + unit)
    : ui.qty(size, pcs, unit);
}

function inPublished(board, day) {
  const p = board.publication;
  return p && day && day >= p.start_day && day <= p.end_day;
}

function hasPin(day, area) {
  return area.daily || day.pins.includes(area.code);
}

function saveChange(ctx, button, action, input, confirm, after) {
  return ui.busy(button, async () => {
    try {
      const result = await ctx.save(action, input, { confirm, after: ctx.refresh });
      if (result) after?.(result.data);
    } catch (e) {
      if (e.code === "conflict" || e.code === "need_reason") ctx.refresh();
    }
  });
}

function reasonSheet(ctx, title, detail) {
  return { title, detail, need: "required", reasons: ctx.reasons("reschedule").filter(s => s !== "แก้ในหน้าออเดอร์" && s !== "อื่น ๆ") };
}

function moveStop(ctx, board, stop, day, button, close) {
  const to = day?.day || "";
  const outside = day && !hasPin(day, stop.area);
  const post = inPublished(board, stop.bookedDay) || inPublished(board, to);
  const confirm = stop.bookedDay || outside || post
    ? reasonSheet(ctx, to ? "นัดส่ง " + thDayLong(to) : "ย้ายกลับไปรอลงวัน", [
      stop.customer,
      stop.bookedDay && "วันเดิม " + thDayLong(stop.bookedDay),
      outside && "วันนี้ยังไม่มีหมุด " + stop.area.name,
      post && "บันทึกเป็นการแก้หลังประกาศ",
    ].filter(Boolean).join(" · "))
    : undefined;
  return saveChange(ctx, button, "route_plan.move", {
    id: stop.order, version: stop.version, round: stop.round, round_version: stop.roundVersion, to_day: to,
  }, confirm, () => {
    state.mode = day ? "day" : "tray";
    if (day) state.day = day.day;
    close?.();
  });
}

function stopSheet(ctx, board, stop) {
  const sh = ui.sheet({ title: stop.customer, modal: true });
  const actions = board.days.map(d => btn("btn.rp-choice",
    [h("b", thDayLong(d.day)), h("small", stop.day === d.day ? "วันนัดเดิม" : hasPin(d, stop.area) ? "ส่งสายนี้" : "ยังไม่หมุดสาย")],
    e => moveStop(ctx, board, stop, d, e.currentTarget, sh.close), {
      disabled: d.day === stop.bookedDay,
      class: hasPin(d, stop.area) ? "rp-match" : null,
      "aria-current": stop.day === d.day ? "date" : null,
    }));
  if (stop.day) actions.push(btn("btn.rp-choice", "รอลงวัน", e => moveStop(ctx, board, stop, null, e.currentTarget, sh.close)));
  put(sh.body,
    h("p.muted", [stop.area.name, stop.area.suggested && "สายแนะนำ", stop.totalRounds > 1 && ("งวด " + stop.seq + "/" + stop.totalRounds),
      stop.day && ("นัด " + thDayLong(stop.day))].filter(Boolean).join(" · ")),
    h("div.stack", stop.lines.map(line => h("div.rp-detail",
      h("div.rp-line", h("span", labelOf(line)), amount(line)),
      line.ready ? ui.pill("พร้อม " + number(line.ready) + " " + line.piece_unit, "ok") : null,
      line.needsScreen ? ui.pill("ต้องสกรีน " + number(line.needsScreen) + " " + line.piece_unit, "warn") : null,
      line.running ? ui.pill("รอรอบผลิต " + number(line.running) + " " + line.piece_unit, "warn") : null,
      line.short ? ui.pill("ยังขาด " + number(line.short) + " " + line.piece_unit, "bad") : null,
    ))),
    h("h3", "เลือกวันส่ง"), h("div.rp-choices", actions));
}

function pinsSheet(ctx, board, day) {
  const sh = ui.sheet({ title: "หมุดสาย " + thDayLong(day.day), modal: true, foot: true });
  const selected = new Set(day.pins);
  const save = btn("btn.pri.block", "บันทึกหมุดสาย", e => saveChange(ctx, e.currentTarget, "route_plan.pins",
    { day: day.day, version: day.pinVersion, routes: [...selected] },
    inPublished(board, day.day) ? reasonSheet(ctx, "แก้หมุดหลังประกาศ", thDayLong(day.day)) : undefined, sh.close),
  { disabled: true });
  put(sh.body, h("p.muted", "อำเภอเมืองส่งได้ทุกวัน"),
    board.areas.length ? h("div.chips", { role: "group", "aria-label": "เลือกสายส่ง" }, board.areas.map(a => btn("chip", a.name, e => {
      if (selected.has(a.code)) selected.delete(a.code);
      else selected.add(a.code);
      e.currentTarget.setAttribute("aria-pressed", String(selected.has(a.code)));
      save.disabled = selected.size === day.pins.length && day.pins.every(code => selected.has(code));
    }, { "aria-pressed": String(selected.has(a.code)) }))) : ui.empty("ยังไม่มีชื่อสายให้เลือก"));
  put(sh.foot, save);
}

function publicationSheet(share) {
  const sh = ui.sheet({ title: "แชร์แผนลงไลน์", modal: true, foot: true });
  const preview = h("textarea.rp-share", { readonly: true, "aria-label": "ข้อความแผนสายส่ง" }, share);
  put(sh.body, preview);
  put(sh.foot, btn("btn.pri.block", [icon("share"), "แชร์ข้อความ"], async () => {
    if (await shareText(share) === "fail") { preview.focus(); preview.select(); }
  }));
}

function publish(ctx, board, button) {
  const confirm = {
    title: "ประกาศแผนสายส่ง",
    detail: thDayLong(board.start) + " ถึง " + thDayLong(board.end) + (board.tray.length ? " · รอลงวัน " + board.tray.length + " นัด" : ""),
    okText: "ประกาศแผน",
  };
  return saveChange(ctx, button, "route_plan.publish", { revision: board.revision, start: board.start }, confirm, data => publicationSheet(data.share));
}

function stopCard(stop, open, drag) {
  const card = btn("card.rp-stop", [
    h("b.rp-customer", stop.customer),
    stop.lines.map(line => h("span.rp-line", h("span", labelOf(line)), amount(line))),
  ], () => open(stop), { draggable: "true", "aria-label": stop.customer + (stop.tone ? " · " + toneText[stop.tone] : "") });
  card.dataset.tone = stop.tone || "";
  card.addEventListener("dragstart", e => {
    drag.stop = stop;
    e.dataTransfer.setData("text/plain", stopKey(stop));
    e.dataTransfer.effectAllowed = "move";
  });
  card.addEventListener("dragend", () => { drag.stop = null; });
  return card;
}

function groupStops(stops, start) {
  const groups = new Map();
  for (const s of stops) {
    const late = s.day && s.day < start;
    const name = (late ? "เลยนัด · " : "") + s.area.name;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(s);
  }
  return [...groups];
}

function stopGroups(stops, start, open, drag, noWork) {
  return stops.length ? groupStops(stops, start).map(([name, grouped]) =>
    h("section.rp-group", h("h4", name), grouped.map(s => stopCard(s, open, drag)))) : ui.empty(noWork);
}

function dropZone(box, drag, handler) {
  box.addEventListener("dragover", e => {
    if (drag.stop) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }
  });
  box.addEventListener("drop", e => {
    if (!drag.stop) return;
    e.preventDefault();
    handler(drag.stop);
  });
  return box;
}

function readiness(stops) {
  const counts = { ok: 0, warn: 0, bad: 0 };
  for (const s of stops) counts[s.tone]++;
  return counts;
}

function readinessBar(stops) {
  const counts = readiness(stops);
  return h("div.rp-bar", {
    role: "img", "aria-label": Object.keys(toneText).map(k => toneText[k] + " " + counts[k] + " นัด").join(" · "),
  }, Object.keys(toneText).map(k => counts[k] ? h("i", { class: "rp-tone-" + k, style: { flexGrow: String(counts[k]) } }) : null));
}

function dayColumn(ctx, board, day, open, drag) {
  const edit = btn("chip.rp-pin-edit", [icon(day.pins.length ? "pin" : "plus", "sm"), day.pins.length ? "แก้หมุด" : "หมุดสาย"],
    () => pinsSheet(ctx, board, day), { "aria-label": "หมุดสาย " + thDayLong(day.day) });
  const col = h("section.rp-column", { "aria-label": thDayLong(day.day) },
    h("header.rp-day-head",
      h("h3", thDayLong(day.day)), h("span.rp-count", number(day.stops.length) + " นัด"),
      h("div.rp-pins", day.pins.map(code => h("span.rp-pin", board.areas.find(a => a.code === code)?.name)), edit),
      readinessBar(day.stops)),
    h("div.rp-day-body", stopGroups(day.stops, board.start, open, drag, "ไม่มีนัดส่ง")));
  return dropZone(col, drag, stop => {
    if (stop.bookedDay !== day.day) moveStop(ctx, board, stop, day, edit);
  });
}

function trayColumn(ctx, board, open, drag) {
  const tray = h("aside.rp-tray", { "aria-label": "รอลงวัน" },
    h("h3", "รอลงวัน ", h("span.rp-count", number(board.tray.length) + " นัด")),
    stopGroups(board.tray, board.start, open, drag, "ลงวันครบแล้ว"));
  return dropZone(tray, drag, stop => {
    if (stop.day) moveStop(ctx, board, stop, null, tray);
  });
}

function calendar(ctx, board, repaint) {
  const drag = { stop: null }, open = stop => stopSheet(ctx, board, stop);
  const day = board.days.find(d => d.day === state.day) || board.days[0];
  const selectDay = d => { state.day = d.day; state.mode = "day"; repaint(); };
  const mobile = h("div.rp-mobile",
    h("div.rp-strip", { role: "group", "aria-label": "เลือกวันส่ง" },
      board.days.map(d => {
        const counts = readiness(d.stops);
        const tone = counts.bad ? "bad" : counts.warn ? "warn" : counts.ok ? "ok" : "none";
        return btn("rp-date", [h("span", TH_DOW[dowOf(d.day)]), h("b", Number(d.day.slice(-2))), h("i", { class: "rp-tone-" + tone })],
          () => selectDay(d), { "aria-pressed": String(state.mode === "day" && day.day === d.day), "aria-label": thDayLong(d.day) + (toneText[tone] ? " · " + toneText[tone] : " · ไม่มีนัดส่ง"), dataset: { rpFocus: d.day } });
      })),
    h("div.rp-modes", { role: "group", "aria-label": "รายการส่ง" },
      btn("btn", "นัดส่ง", () => selectDay(day), { "aria-pressed": String(state.mode === "day"), dataset: { rpFocus: "day-mode" } }),
      btn("btn", "รอลงวัน " + number(board.tray.length), () => { state.mode = "tray"; repaint(); }, { "aria-pressed": String(state.mode === "tray"), dataset: { rpFocus: "tray-mode" } })),
    state.mode === "day" ? dayColumn(ctx, board, day, open, drag) : trayColumn(ctx, board, open, drag));
  return h("div",
    h("div.rp-desktop", trayColumn(ctx, board, open, drag),
      h("div.rp-days", board.days.map(d => dayColumn(ctx, board, d, open, drag)))),
    mobile);
}

function deadline(row, today) {
  if (row.day === today) return "ด่วน · ส่งวันนี้";
  return row.before < today ? "เลยกำหนด · ส่ง " + thDayLong(row.day) : "ทำให้พร้อม " + thDayLong(row.before) + " · ส่ง " + thDayLong(row.day);
}

function needsView(board) {
  if (!board.needs.length) return ui.empty("ยังไม่มีนัดส่งในแผน");
  const panels = [
    ["blow", "ต้องเป่าเพิ่ม", "bad", "ขวดเปล่าพอตามแผน"],
    ["needsScreen", "ต้องสกรีน", "warn", "ไม่มีงานสกรีนในแผน"],
    ["running", "รอรอบผลิต", "warn", ""],
    ["check", "ต้องเช็กของ", "bad", ""],
  ];
  const tasks = panels.map(([field, title, tone, empty]) => {
    const rows = board.needs.filter(line => line[field]);
    if (!rows.length && !empty) return null;
    return h("section.card.rp-work",
      h("h3", title), rows.length ? rows.map(row => h("div.rp-task", { class: "t-" + tone },
        h("div", h("b", field === "needsScreen" ? labelOf(row) : row.label), h("small", deadline(row, board.start))),
        amount(row, row[field]))) : h("p.muted", empty));
  });
  const dates = [...new Set(board.needs.map(n => n.day))];
  return h("div.stack.rp-needs",
    h("div.rp-work-grid", tasks),
    h("section.card.rp-work", h("h3", "ยอดตามวันส่ง"),
      dates.map(day => h("details.rp-need-day", { open: day <= addDay(board.start, 1) },
        h("summary", thDayLong(day)),
        board.needs.filter(n => n.day === day).map(row => h("div.rp-task",
          h("div", h("b", labelOf(row)), h("small", row.short ? "ยังขาด " + number(row.short) + " " + row.piece_unit
            : row.needsScreen ? "ต้องสกรีน " + number(row.needsScreen) + " " + row.piece_unit : row.running ? "รอรอบผลิต" : "พร้อมส่ง")),
          amount(row)))))));
}

function planner(ctx, board, st, repaint) {
  const counts = readiness(board.days.flatMap(d => d.stops));
  const pubs = board.publication;
  return h("div.rp.stack",
    h("section.card.rp-overview",
      h("div.rp-toolbar",
        h("div.rp-range", h("b", thDayLong(board.start) + " ถึง " + thDayLong(board.end)), h("small", "อำเภอเมืองส่งได้ทุกวัน")),
        h("div.rp-modes", { role: "group", "aria-label": "มุมมองแผนส่ง" },
          ...[["calendar", "ปฏิทิน"], ["needs", "ขวดที่ต้องมี"]].map(([k, label]) => btn("btn", label, () => { state.panel = k; repaint(); },
            { "aria-pressed": String(state.panel === k), dataset: { rpFocus: k } }))),
        btn("btn.pri", [icon("share"), "ประกาศแผน"], e => publish(ctx, board, e.currentTarget), { disabled: !st.fresh })),
      h("div.rp-status",
        h("div.rp-legend", ["ok", "warn", "bad"].map(k => ui.pill(toneText[k] + " " + number(counts[k]), k))),
        pubs ? h("div.rp-publication",
          h("span", "ประกาศ " + ui.thDayOf(pubs.created_at) + " " + ui.thTime(pubs.created_at) + (pubs.changes ? " · แก้หลังประกาศ " + number(pubs.changes) + " ครั้ง" : "")),
          btn("btn", "แชร์ฉบับประกาศ", () => publicationSheet(pubs.share_text))) : h("small.muted", "ยังไม่ประกาศ")),
      st.fresh ? null : ui.stamp(st.at, st.updating)),
    state.panel === "calendar" ? calendar(ctx, board, repaint) : needsView(board));
}

export function routePlanner(ctx, view) {
  useCss("../roles/route-planner.css");
  return ctx.load(view, "route-plan", "route_plan.board", (box, board, st) => {
    const paint = () => {
      const signature = { board: { ...board, asOf: undefined, revision: undefined }, st: st.fresh ? null : st, state };
      // ตัวเลขรุ่นอาจเปลี่ยนจากงานอื่นได้ ปุ่มประกาศต้องใช้รุ่นล่าสุดเสมอ
      const focus = document.activeElement?.dataset.rpFocus;
      ui.renderList(box, [{ ...signature, revision: board.revision }], () => "planner", () => planner(ctx, board, st, paint));
      if (focus) [...box.querySelectorAll("[data-rp-focus]")].find(el => el.dataset.rpFocus === focus)?.focus({ preventScroll: true });
    };
    paint();
  });
}
