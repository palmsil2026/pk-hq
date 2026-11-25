-- ชั้นวางแผน: หมุดต่อวันและฉบับประกาศ 7 วัน (งวดส่งยังอยู่ใน order_rounds)
CREATE TABLE route_day_pins (
  day         TEXT PRIMARY KEY CHECK (length(day) = 10),
  routes_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(routes_json) AND json_type(routes_json) = 'array'),
  status      TEXT NOT NULL DEFAULT 'ใช้งาน' CHECK (status IN ('ใช้งาน', 'ยกเลิก')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
);
CREATE TRIGGER no_delete_route_day_pins BEFORE DELETE ON route_day_pins
BEGIN SELECT RAISE(ABORT, 'ห้ามลบหมุดสายส่ง'); END;

CREATE TABLE weekly_plans (
  id            TEXT PRIMARY KEY,
  start_day     TEXT NOT NULL CHECK (length(start_day) = 10),
  end_day       TEXT NOT NULL CHECK (length(end_day) = 10 AND end_day >= start_day),
  by_staff      TEXT NOT NULL REFERENCES staff(id),
  share_text    TEXT NOT NULL,
  changes       INTEGER NOT NULL DEFAULT 0 CHECK (typeof(changes) = 'integer' AND changes >= 0),
  base_revision INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'ใช้งาน' CHECK (status IN ('ใช้งาน', 'ยกเลิก')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
);
CREATE INDEX weekly_plans_latest ON weekly_plans(status, base_revision DESC);
CREATE TRIGGER no_delete_weekly_plans BEFORE DELETE ON weekly_plans
BEGIN SELECT RAISE(ABORT, 'ห้ามลบแผนสายส่ง'); END;

CREATE TABLE plan_lines (
  id            TEXT PRIMARY KEY,
  plan_id       TEXT NOT NULL REFERENCES weekly_plans(id),
  day           TEXT NOT NULL CHECK (length(day) = 10),
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  status        TEXT NOT NULL DEFAULT 'ใช้งาน' CHECK (status IN ('ใช้งาน', 'ยกเลิก')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  UNIQUE(plan_id, day)
);
CREATE TRIGGER no_delete_plan_lines BEFORE DELETE ON plan_lines
BEGIN SELECT RAISE(ABORT, 'ห้ามลบรายการในแผนสายส่ง'); END;

INSERT INTO vocab(kind, value, pos, label, tone) VALUES
  ('flags.kind', 'จัดส่งนอกสาย', 40, '', 'warn'),
  ('reason.reschedule', 'ปรับแผนสายส่ง', 6, '', '');

-- หัวหน้าทีมสกรีนที่ประกาศแผนได้ (ชื่อเล่น คั่นด้วย , · ว่าง = ประธานเท่านั้น) · ประธานตั้งที่ ทีม › ค่าตั้ง
INSERT INTO settings(key, value, note, updated_at, updated_by) VALUES
  ('SCREEN_LEADS', '', 'หัวหน้าทีมสกรีนที่ประกาศแผนสายส่งได้ (ใส่ชื่อเล่น คั่นด้วย , · ตอนประกาศต้องใส่ PIN ของตัวเอง)', '2026-11-26T00:00:00.000Z', 'system');
