// ============================================================
//  หน้าแรกของแต่ละบทบาท — "งานที่รอ" (โครงที่ใช้ API จริง · แชทโมดูลเติมเนื้อหา/ปุ่มงานต่อ)     v2/server/actions/home.mjs
//  กติกา: ทุกหน้า 1 รอบคุยกับฐาน (X.db.reads) · ไม่ส่งรหัสระบบไปโชว์ (ส่งได้ใน ref สำหรับรายละเอียด)
//         เงินส่งเป็นสตางค์ · จำนวนเป็นใบ/ชิ้น + ถุง (bags/per_bag) ให้หน้าเว็บทำป้าย [ขนาด | ตัวเลขหนา หน่วย]
// ============================================================
import { addDays, iso, thaiDay } from "../core.mjs";

const OPEN_ORDER = "('รอผลิต','กำลังผลิต','รอสกรีน','กำลังสกรีน','พร้อมส่ง','ส่งบางส่วน')";

/** รายการของออเดอร์ (หลายใบในรอบเดียว) → { orderId: [ {label,size,bags,per_bag,qty_pcs,unit,screen} ] } */
async function itemsOf(X, ids) {
  const out = {};
  if (!ids.length) return out;
  for (let i = 0; i < ids.length; i += 90) {   // D1 รับตัวแปร ≤ 100 ต่อคำสั่ง
    const part = ids.slice(i, i + 90);
    const rows = await X.db.all(`SELECT i.order_id, i.type, i.size, i.neck, i.shape, i.color, i.screen_color, i.cap_color, i.label, i.bags, i.per_bag, i.extra_pcs, i.qty_pcs, t.piece_unit
      FROM order_items i LEFT JOIN product_types t ON t.code = i.type WHERE i.status = 'ใช้งาน' AND i.order_id IN (${part.map(() => "?").join(",")}) ORDER BY i.order_id, i.line_no`, ...part);
    rows.forEach(r => { (out[r.order_id] = out[r.order_id] || []).push(r); });
  }
  return out;
}

export function defineHomes(R) {
  R.define({
    name: "home.office", roles: ["office", "exec"],
    async run(X) {
      const today = thaiDay(X.now);
      const [counts, list, owe] = await X.db.reads([
        [`SELECT status, count(*) AS n FROM orders WHERE status IN ${OPEN_ORDER} GROUP BY status`],
        [`SELECT o.id, o.order_day, o.due_day, o.status, o.urgent, o.brand, o.has_screen, o.pay_status, o.version, c.name AS customer, c.route_code, c.district
           FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.status IN ${OPEN_ORDER}
           ORDER BY o.urgent DESC, CASE WHEN o.due_day = '' THEN '9999' ELSE o.due_day END, o.order_day LIMIT 60`],
        ["SELECT count(*) AS n FROM bills WHERE status = 'ค้างชำระ'"],
      ]);
      const c = {};
      counts.forEach(r => { c[r.status] = r.n; });
      const items = await itemsOf(X, list.map(o => o.id));
      const newToday = list.filter(o => o.order_day === today).length;
      return {
        asOf: iso(X.now), today,
        queues: [
          { key: "new", label: "ออเดอร์ใหม่วันนี้", n: newToday },
          { key: "prod", label: "รอผลิต", n: (c["รอผลิต"] || 0) + (c["กำลังผลิต"] || 0) },
          { key: "screen", label: "รอสกรีน", n: (c["รอสกรีน"] || 0) + (c["กำลังสกรีน"] || 0) },
          { key: "deliver", label: "รอส่ง", n: (c["พร้อมส่ง"] || 0) + (c["ส่งบางส่วน"] || 0) },
          { key: "money", label: "ค้างเงิน", n: owe[0] ? owe[0].n : 0, tone: "warn" },
        ],
        orders: list.map(o => ({ ...o, items: items[o.id] || [], late: !!o.due_day && o.due_day < today })),
      };
    },
  });

  R.define({
    name: "home.prod", roles: ["prod", "exec"],
    async run(X) {
      const [machines, runs, stops, jobs] = await X.db.reads([
        ["SELECT id, name, kind, plant, pos_x, pos_y, w, h, makes, status FROM machines WHERE status <> 'เลิกใช้' ORDER BY plant, pos_y, pos_x"],
        ["SELECT id, machine_id, type, size, neck, shape, color, started_at, started_day, version FROM machine_runs WHERE status = 'กำลังผลิต'"],
        ["SELECT id, machine_id, kind, reason, started_at FROM machine_events WHERE ended_at = '' AND status = 'ใช้งาน' AND kind = 'จอดเครื่อง'"],
        ["SELECT count(*) AS n FROM production_jobs WHERE status IN ('รอผลิต','กำลังผลิต')"],
      ]);
      const staleMs = Number(X.settings.RUN_STALE_HOURS || 14) * 3600000;
      const runBy = {}, stopBy = {};
      runs.forEach(r => { runBy[r.machine_id] = r; });
      stops.forEach(s => { stopBy[s.machine_id] = s; });
      const list = machines.map(m => {
        const r = runBy[m.id] || null, s = stopBy[m.id] || null;
        const stale = !!r && X.now - Date.parse(r.started_at) > staleMs;
        return { ...m, run: r, stop: s, state: s ? "จอด" : r ? (stale ? "ค้างปิด" : "เดิน") : "ว่าง" };
      });
      const prodMachines = list.filter(m => m.kind === "เป่า" || m.kind === "ฉีด");
      return {
        asOf: iso(X.now),
        running: prodMachines.filter(m => m.state === "เดิน" || m.state === "ค้างปิด").length,
        total: prodMachines.length,
        stale: list.filter(m => m.state === "ค้างปิด").length,
        jobsWaiting: jobs[0] ? jobs[0].n : 0,
        machines: list,
      };
    },
  });

  R.define({
    name: "home.screen", roles: ["screen", "exec"],
    async run(X) {
      const today = thaiDay(X.now);
      const [rows, done] = await X.db.reads([
        [`SELECT j.id, j.team, j.colors, j.qty_pcs, j.status, j.due_day, j.version, o.brand, c.name AS customer, i.type, i.size, i.color, i.label, i.bags, i.per_bag
           FROM screen_jobs j JOIN orders o ON o.id = j.order_id JOIN customers c ON c.id = o.customer_id LEFT JOIN order_items i ON i.id = j.order_item_id
           WHERE j.status IN ('รอดำเนินการ','เตรียมการสกรีน') ORDER BY CASE WHEN j.due_day = '' THEN '9999' ELSE j.due_day END, j.created_at LIMIT 100`],
        ["SELECT count(*) AS n FROM screen_jobs WHERE done_day = ? AND status = 'เสร็จแล้ว'", today],
      ]);
      return { asOf: iso(X.now), today, doneToday: done[0] ? done[0].n : 0, jobs: rows.map(r => ({ ...r, late: !!r.due_day && r.due_day < today })) };
    },
  });

  R.define({
    name: "home.deliver", roles: ["deliver", "exec"],
    async run(X) {
      const today = thaiDay(X.now), tomorrow = addDays(today, 1);
      const [orders, loads] = await X.db.reads([
        [`SELECT o.id, o.due_day, o.status, o.urgent, o.version, c.name AS customer, c.route_code, c.district FROM orders o JOIN customers c ON c.id = o.customer_id
           WHERE o.status IN ('พร้อมส่ง','ส่งบางส่วน','รอสกรีน','กำลังสกรีน','รอผลิต','กำลังผลิต') AND (o.due_day <> '' AND o.due_day <= ?) ORDER BY o.due_day, c.route_code LIMIT 150`, addDays(today, 2)],
        ["SELECT order_id, sum(qty_pcs) AS pcs FROM delivery_loads WHERE status = 'บนรถ' GROUP BY order_id"],
      ]);
      const onTruck = {};
      loads.forEach(l => { onTruck[l.order_id] = l.pcs; });
      const items = await itemsOf(X, orders.map(o => o.id));
      const bucket = d => (d < today ? "late" : d === today ? "today" : d === tomorrow ? "tomorrow" : "later");
      const groups = { late: [], today: [], tomorrow: [], later: [] };
      orders.forEach(o => groups[bucket(o.due_day)].push({ ...o, ready: o.status === "พร้อมส่ง" || o.status === "ส่งบางส่วน", on_truck_pcs: onTruck[o.id] || 0, items: items[o.id] || [] }));
      return { asOf: iso(X.now), today, tomorrow, groups, stops: orders.length, onTruck: Object.keys(onTruck).length };
    },
  });

  // home.account → server/actions/account.mjs · home.exec → server/actions/exec.mjs (โมดูลประธาน+บัญชีดูแล — งานที่รอตรวจ/เรื่องที่ต้องตัดสินใจ)
}
