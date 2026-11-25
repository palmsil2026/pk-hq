// ============================================================
//  action ของกลาง (Foundation): ตัวฉัน · ย้อน · ธง · ค่าตั้ง                       v2/server/actions/foundation.mjs
// ============================================================
import { ALL_ROLES } from "../app.mjs";
import { API_VERSION, Fail, denied, notFound, conflict, need, text, int, iso, oneOf, thaiDay } from "../core.mjs";

export function defineFoundation(R) {
  // ---- ตัวฉัน + ของที่หน้าเว็บต้องใช้ตอนเปิด (ค่าที่ชิป/ป้ายสถานะใช้ · รุ่นขั้นต่ำ) — 1 รอบ ----
  R.define({
    name: "system.me", roles: ALL_ROLES,
    async run(X) {
      const [vocab, routes, teams] = await X.db.reads([
        ["SELECT kind, value, label, tone, pos FROM vocab ORDER BY kind, pos"],
        ["SELECT code, name FROM routes WHERE active = 1 ORDER BY pos, code"],
        ["SELECT code FROM screen_teams WHERE active = 1 ORDER BY pos"],
      ]);
      const v = {};
      vocab.forEach(r => { (v[r.kind] = v[r.kind] || []).push({ value: r.value, label: r.label || r.value, tone: r.tone }); });
      return {
        staff: X.staff, roles: X.roles, role: X.role, api: API_VERSION,
        minWeb: X.settings.MIN_WEB_VERSION || "", undoHours: Number(X.settings.UNDO_HOURS || 24),
        vocab: v, routes, screenTeams: teams.map(t => t.code),
      };
    },
  });

  // ---- ย้อน (ของกลางทุก action) ----
  //   ได้เมื่อ: ยังไม่เคยย้อน · ยังไม่เลยเวลา · คนเดิม (หรือประธาน) · ทุกแถวที่บันทึกไว้ยังไม่ถูกขั้นถัดไปแตะ (version เดิม) · ด่านเฉพาะ action ผ่าน
  R.define({
    name: "undo.run", roles: ALL_ROLES, write: true, undo: false,
    input: raw => ({ id: need(raw.id, "รหัสรายการที่จะย้อน", 40) }),
    async load(X, input) {
      const [u] = await X.db.reads([["SELECT u.*, a.req_key AS orig_key FROM undo_log u LEFT JOIN audit_log a ON a.id = u.audit_id WHERE u.id = ?", input.id]]);
      const row = u[0];
      if (!row) throw notFound("ไม่พบรายการที่จะย้อน");
      const flags = await X.db.all("SELECT id, version, status FROM flags WHERE req_key = ? AND status = 'เปิด'", row.orig_key || "-");
      return { row, flags };
    },
    async run(X, input, ctx) {
      const u = ctx.row;
      if (u.status === "ย้อนแล้ว") throw new Fail(409, "already", "รายการนี้ย้อนไปแล้ว");
      if (u.status !== "พร้อมย้อน") throw new Fail(410, "gone", "รายการนี้ย้อนไม่ได้แล้ว — ถ้าต้องแก้ ให้ทำรายการแก้ไข/ยกเลิกพร้อมเหตุผล");
      if (iso(X.now) > u.until_at) throw new Fail(410, "gone", "เลยเวลาย้อนแล้ว — ถ้าต้องแก้ ให้ทำรายการแก้ไข/ยกเลิกพร้อมเหตุผล");
      if (u.staff_id !== X.staff.id && X.roles.indexOf("exec") < 0) throw denied("ย้อนได้เฉพาะคนที่บันทึกรายการนี้ (หรือประธาน)");
      const orig = X.registry.get(u.action);
      if (orig && orig.undo && typeof orig.undo.guard === "function") await orig.undo.guard(X, u);
      X.undoOf = u.audit_id;
      const ops = JSON.parse(u.ops_json);
      ops.push({ op: "update", table: "undo_log", id: u.id, expect: u.version, set: { status: "ย้อนแล้ว", undone_at: iso(X.now), undone_by: X.staff.id }, before: u, undo: false });
      const covered = new Set(ops.filter(o => o.table === "flags").map(o => String(o.id)));
      for (const f of ctx.flags.filter(f => !covered.has(String(f.id)))) ops.push({ op: "update", table: "flags", id: f.id, expect: f.version, set: { status: "ปิด", resolution: "ย้อนรายการที่ทำให้เกิดธงแล้ว", resolved_by: X.staff.id, resolved_at: iso(X.now) }, before: f, undo: false });
      return {
        ops, undo: false, result: { undone: true, label: u.label },
        conflictMessage: "ขั้นถัดไปรับงานไปแล้ว หรือมีคนแก้หลังจากนั้น — ย้อนไม่ได้ ให้ทำรายการแก้ไข/ยกเลิกพร้อมเหตุผลแทน",
      };
    },
  });
  R.define({
    name: "undo.mine", roles: ALL_ROLES,
    async run(X) {
      return { items: await X.db.all("SELECT id, label, action, until_at, created_at FROM undo_log WHERE staff_id = ? AND status = 'พร้อมย้อน' AND until_at > ? ORDER BY created_at DESC LIMIT 20", X.staff.id, iso(X.now)) };
    },
  });

  // ---- ธง: ใครก็ยกธงได้ (เหตุผลบังคับ) · ประธานปิด/รับทราบ ----
  R.define({
    name: "flag.raise", roles: ALL_ROLES, write: true, reason: "required", label: "ยกธงให้ตรวจ",
    input: raw => ({
      kind: text(raw.kind, 40) || "อื่น ๆ", title: need(raw.title, "หัวข้อ", 120), detail: text(raw.detail, 500),
      entity: text(raw.entity, 40), entity_id: text(raw.entity_id, 60), severity: raw.severity === "ด่วน" ? "ด่วน" : "ดู",
    }),
    async run(X, input) {
      const id = "F" + X.newId();
      return {
        result: { id }, label: "ยกธง: " + input.title,
        ops: [{ op: "insert", table: "flags", row: { id, at: iso(X.now), day: thaiDay(X.now), kind: input.kind, severity: input.severity, team: X.role, entity: input.entity, entity_id: input.entity_id, title: input.title, detail: input.detail || X.reason, raised_by: X.staff.id, req_key: X.reqKey } }],
      };
    },
  });
  R.define({
    name: "flag.list", roles: ALL_ROLES,
    input: raw => ({ status: raw.status === "ทั้งหมด" ? "" : "เปิด", limit: int(raw.limit === undefined ? 50 : raw.limit, "จำนวน", { min: 1, max: 200 }) }),
    async run(X, input) {
      const mine = X.role === "exec" ? "" : " AND team IN ('', ?)";
      const args = X.role === "exec" ? [] : [X.role];
      const rows = input.status
        ? await X.db.all("SELECT id, at, day, kind, severity, team, entity, entity_id, title, detail, status, version FROM flags WHERE status = 'เปิด'" + mine + " ORDER BY severity = 'ด่วน' DESC, at DESC LIMIT ?", ...args, input.limit)
        : await X.db.all("SELECT id, at, day, kind, severity, team, entity, entity_id, title, detail, status, resolution, version FROM flags WHERE 1=1" + mine + " ORDER BY at DESC LIMIT ?", ...args, input.limit);
      return { items: rows };
    },
  });
  R.define({
    name: "flag.resolve", roles: ["exec"], write: true, label: "ตัดสินธง",
    input: raw => ({ id: need(raw.id, "ธง", 40), version: int(raw.version, "รุ่นของรายการ", { min: 1 }), status: oneOf(raw.status || "ปิด", ["รับทราบ", "ปิด"], "สถานะ"), resolution: text(raw.resolution, 300) }),
    async load(X, input) {
      const f = await X.db.first("SELECT * FROM flags WHERE id = ?", input.id);
      if (!f) throw notFound("ไม่พบธงนี้");
      return { f };
    },
    async run(X, input, ctx) {
      if (ctx.f.version !== input.version) throw conflict("ธงนี้มีคนจัดการไปก่อนแล้ว — โหลดใหม่");
      return {
        result: { id: input.id }, label: (input.status === "ปิด" ? "ปิดธง: " : "รับทราบธง: ") + ctx.f.title,
        ops: [{ op: "update", table: "flags", id: input.id, expect: input.version, before: ctx.f,
          set: { status: input.status, resolution: input.resolution || X.reason, resolved_by: X.staff.id, resolved_at: iso(X.now) } }],
      };
    },
  });

  // ---- ค่าตั้ง (ประธาน) ----
  R.define({
    name: "setting.set", roles: ["exec"], write: true, label: "แก้ค่าตั้ง",
    input: raw => ({ key: need(raw.key, "ชื่อค่าตั้ง", 60), value: text(raw.value, 500), version: int(raw.version, "รุ่นของรายการ", { min: 1 }) }),
    async load(X, input) {
      const s = await X.db.first("SELECT * FROM settings WHERE key = ?", input.key);
      if (!s) throw notFound("ไม่มีค่าตั้งชื่อ " + input.key);
      return { s };
    },
    async run(X, input, ctx) {
      if (ctx.s.version !== input.version) throw conflict("ค่าตั้งนี้มีคนแก้ไปก่อนแล้ว — โหลดใหม่");
      return { result: { key: input.key }, label: "แก้ค่าตั้ง " + input.key,
        ops: [{ op: "update", table: "settings", id: input.key, expect: input.version, before: ctx.s, set: { value: input.value, updated_by: X.staff.id } }] };
    },
  });
  R.define({
    name: "setting.list", roles: ["exec"],
    async run(X) { return { items: await X.db.all("SELECT key, value, note, updated_at, updated_by, version FROM settings ORDER BY key") }; },
  });
}
