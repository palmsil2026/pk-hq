-- ═══════════════════════════════════════════════════════════════════════════
--  0320_screen_parts — ทีมสกรีน "ทำบางส่วน" (งานหลายวัน) · ช่วงเลขสกรีน 0320–0329
--
--  ที่มา (ข้อมูลจริงแอปเดิม 19 พ.ย.): 25% ของงานสกรีนทำหลายวัน ทีมแตะงานซ้ำทุกวัน แอปเดิมตัดสต๊อกเต็มจำนวนซ้ำทุกครั้ง
--        และพิมพ์ความคืบหน้าลงหมายเหตุ ("ทำ20ถุงค้างทำอีก40ถุง") → ทำเป็นช่องจริง
--  กติกา:
--    · "ทำวันนี้ … ถุง" (ไม่บังคับ) = 1 แถว screen_parts (ทีม · จำนวน · เวลา · คนกด) + ตัดขวดเปล่า/เพิ่มขวดสกรีนเท่าที่ทำ
--    · งานยังอยู่ในคิว (เตรียมการสกรีน) · screen_jobs.done_pcs = ยอดที่ทำไปแล้วรวม (ขยับ version ทุกครั้ง → ย้อนได้เฉพาะช่วงล่าสุด)
--    · กด "เสร็จ" ทีหลัง = ส่วนที่เหลือ (สต๊อกขยับเฉพาะส่วนต่าง) · งานวันเดียว (ไม่มีช่วง) = เหมือนเดิมทุกอย่าง
--    · ย้อนช่วง = พลิกสถานะแถวเป็น ยกเลิก (ไม่ลบ) + สมุดสต๊อกกลับทิศ
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE screen_jobs ADD COLUMN done_pcs INTEGER NOT NULL DEFAULT 0 CHECK (typeof(done_pcs) = 'integer' AND done_pcs >= 0);

CREATE TABLE screen_parts (
  id         TEXT PRIMARY KEY,
  job_id     TEXT NOT NULL REFERENCES screen_jobs(id),
  order_id   TEXT NOT NULL REFERENCES orders(id),
  team       TEXT REFERENCES screen_teams(code),                 -- NULL = ไม่ระบุทีม
  qty_pcs    INTEGER NOT NULL CHECK (typeof(qty_pcs) = 'integer' AND qty_pcs > 0),
  at         TEXT NOT NULL CHECK (length(at) = 24 AND substr(at, 24, 1) = 'Z'),
  day        TEXT NOT NULL,                                       -- วันไทยของช่วงนี้ (สรุป "เสร็จวันนี้")
  by         TEXT NOT NULL DEFAULT '',                            -- staff.id จากตั๋ว
  job_ver    INTEGER NOT NULL DEFAULT 0,                          -- รุ่นของงานหลังบันทึกช่วงนี้ (ตรงกับงานตอนนี้ = ช่วงล่าสุด ย้อนได้)
  status     TEXT NOT NULL DEFAULT 'ใช้งาน' CHECK (status IN ('ใช้งาน', 'ยกเลิก')),
  note       TEXT NOT NULL DEFAULT '',
  src        TEXT NOT NULL DEFAULT 'v2',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
);
CREATE INDEX screen_parts_job ON screen_parts(job_id, status);
CREATE INDEX screen_parts_day ON screen_parts(day, status, team);
CREATE INDEX screen_parts_order ON screen_parts(order_id);
CREATE TRIGGER no_delete_screen_parts BEFORE DELETE ON screen_parts BEGIN SELECT RAISE(ABORT, 'ห้ามลบข้อมูล (screen_parts) — ใช้การเปลี่ยนสถานะแทน'); END;

-- ความคืบหน้างานสกรีน (ออฟฟิศอ่านในรายละเอียดออเดอร์ได้ — ใช้คู่กับ server/actions/screen-progress.mjs)
--   planned_pcs = จำนวนงาน · made_pcs = ทำแล้ว (เสร็จแล้ว = ดีที่ลง หรือจำนวนงาน · ยังไม่เสร็จ = ผลรวมช่วงที่ทำ)
CREATE VIEW screen_progress AS
  SELECT j.id AS job_id, j.order_id, j.order_item_id, j.status, j.team, j.colors,
    coalesce(nullif(j.qty_pcs, 0), i.qty_pcs, 0) AS planned_pcs,
    j.done_pcs AS partial_pcs,
    CASE WHEN j.status = 'เสร็จแล้ว' THEN coalesce(j.good_pcs, max(coalesce(nullif(j.qty_pcs, 0), i.qty_pcs, 0) - coalesce(j.waste_pcs, 0), j.done_pcs)) ELSE j.done_pcs END AS made_pcs,
    (SELECT count(*) FROM screen_parts p WHERE p.job_id = j.id AND p.status = 'ใช้งาน') AS parts,
    (SELECT max(p.at) FROM screen_parts p WHERE p.job_id = j.id AND p.status = 'ใช้งาน') AS last_part_at,
    coalesce(i.per_bag, 0) AS per_bag, j.done_at, j.done_day
  FROM screen_jobs j LEFT JOIN order_items i ON i.id = j.order_item_id
  WHERE j.status <> 'ยกเลิก';

