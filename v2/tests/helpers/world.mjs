// ============================================================
//  โลกจำลองสำหรับเทสต์: ฐาน D1 จำลอง (migration จริงทุกไฟล์) + แอปจริง + นาฬิกาที่คุมได้ + ตั๋วแบบที่ GAS ออก
// ============================================================
import { freshDb } from "./d1.mjs";
import { createApp } from "../../server/app.mjs";
import { buildRegistry } from "../../server/actions/index.mjs";
import { issueTicket, pinPrint } from "../../server/ticket.mjs";

export const KEYS = { ticket: "test-ticket-key-0123456789", sync: "test-sync-key-0123456789", pin: "test-pin-secret-gas-only" };
export const T0 = Date.UTC(2026, 10, 16, 2, 0, 0);   // 16 พ.ย. 2569 09:00 เวลาไทย

export function world(opt) {
  const o = opt || {};
  const d1 = freshDb();
  const clock = { now: o.now || T0 };
  const env = Object.assign({ DB: d1, PK_TICKET_KEY: KEYS.ticket, PK_SYNC_KEY: KEYS.sync }, o.env || {});
  const registry = buildRegistry(o.extra);
  const app = createApp({ registry, now: () => clock.now, fetch: o.fetch });
  let seq = 0;
  const W = {
    d1, env, app, clock, registry,
    tick(ms) { clock.now += ms; },
    /** เพิ่มพนักงาน (แบบที่นำเข้าจากชีต — มีลายนิ้วมือ PIN ไม่มี PIN) */
    async staff(id, nick, roles, pin, status) {
      const at = new Date(clock.now).toISOString();
      const pf = await pinPrint(KEYS.pin, id, pin || "1234");
      d1.raw.prepare("INSERT INTO staff(id, name, nick, dept_th, status, pin_fp, pf_at, src, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .run(id, nick, nick, "", status || "ทำงาน", pf, clock.now - 1000, "test", at, at);
      for (const r of roles) d1.raw.prepare("INSERT INTO staff_roles(staff_id, role) VALUES (?,?)").run(id, r);
      return W.ticket(id, nick, roles, pin);
    },
    async ticket(id, nick, roles, pin, extra) {
      const pf = await pinPrint(KEYS.pin, id, pin || "1234");
      return issueTicket(KEYS.ticket, Object.assign({ k: "s", sid: id, n: nick, r: roles, pf, iat: clock.now, exp: clock.now + 30 * 864e5 }, extra || {}));
    },
    key() { return "k" + String(++seq).padStart(6, "0") + "-" + Math.random().toString(36).slice(2, 8); },
    async call(token, action, input, more) {
      const m = more || {};
      const body = { action, input: input || {}, as: m.as, key: m.key === undefined ? W.key() : m.key, reason: m.reason };
      const res = await app.handle(new Request("https://pk.test/api/call", {
        method: "POST", headers: Object.assign({ "content-type": "application/json" }, token ? { authorization: "Bearer " + token } : {}), body: JSON.stringify(body),
      }), env, "call");
      const j = await res.json();
      j.status = res.status;
      return j;
    },
    async get(path) {
      const res = await app.handle(new Request("https://pk.test/api/" + path), env, path.split("?")[0]);
      const j = await res.json(); j.status = res.status; return j;
    },
    q: (sql, ...a) => d1.q(sql, ...a),
    one: (sql, ...a) => d1.one(sql, ...a),
  };
  return W;
}
