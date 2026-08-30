/**
 * ════════════════════════════════════════════════════════════
 *  P&K System v2 — ระบบโรงขวด P&K (Google Apps Script)
 *  ครบวงจร: พนักงานล็อกอิน PIN · ลงเวลา · ออเดอร์ → ผลิต(รายสินค้า)
 *  → สกรีน → ส่งเป็นงวด(หักสต๊อกอัตโนมัติ) → ออกบิล → ใบวางบิล
 *  + สต๊อกสินค้า/วัตถุดิบ · ประวัติทุกการกระทำ (ActivityLog)
 *  + บอร์ดบริหาร: แจ้งเตือน/ผลิต/ของเสีย/พนักงาน/ราคา(ประธาน)
 *  ⚠️ คนละบริษัทกับโรงน้ำละกอน — ห้ามชี้ชีตนี้ไปที่ OriginSystem
 * ════════════════════════════════════════════════════════════
 *
 *  ติดตั้งครั้งแรก (ล็อกอิน palm.work2026@gmail.com):
 *  1) script.new → ตั้งชื่อ "P&K System" → วางไฟล์นี้ทั้งไฟล์
 *  2) รัน setupPkSystem() (รันซ้ำได้ ปลอดภัย — เพิ่มแท็บ/คอลัมน์ที่ขาดให้)
 *  3) Script properties: PK_KEY (รหัส API สำรอง/สคริปต์อื่น)
 *     และ PK_EXEC_KEY (รหัสผู้บริหาร — ตั้งยาว ๆ เดายาก)
 *  4) รัน importLegacyAccounting() → ดึงบิล/ลูกหนี้/ลูกค้าเก่า
 *  5) Deploy → New deployment → Web app (Execute as: Me / Anyone)
 *     → เอา URL วางใน pk/index.html + pk/exec/index.html (GAS_URL)
 *  6) เพิ่มพนักงานคนแรกจากบอร์ดบริหาร (ชื่อเล่น+PIN) แล้วให้ทีมล็อกอิน
 *     แก้โค้ดครั้งถัดไป: Manage deployments → ✏️ → New version + bump CODE_VERSION
 *
 *  ข้อตกลงกับแชท "แอพการเงินโรงขวด":
 *  - แท็บ Bills/Statements: ห้ามเปลี่ยนชื่อ/ความหมายคอลัมน์เดิม
 *    (v2 เพิ่มคอลัมน์ "ผู้ทำ" ต่อท้าย Bills และเพิ่มค่าสถานะ "ยกเลิก")
 *  - เงินรับจริง/ลูกหนี้ อ่านจาก Bills โดยข้ามแถวสถานะ "ยกเลิก" เสมอ
 *  - ⚠️ ห้ามเรียก rowsToObjs('Staff') ตรง ๆ — ใช้ staffPublic() เท่านั้น (กัน PIN หลุด)
 */

const CODE_VERSION = '2026-08-30d';
const LEGACY_SNAPSHOT_ID = '13BkMrh9sckRf3lCVW_Kze61zpcLNhGB2ERy1AFSJVhU'; // PK_ระบบบัญชี_snapshot_2026-08-30
const TZ = 'Asia/Bangkok';
const TOKEN_DAYS = 7;          // อายุ token หลังล็อกอิน
const WASTE_REASONS = ['ก้นบาง', 'ปากเบี้ยว', 'สีเพี้ยน', 'แตก/รั่ว', 'สกรีนเพี้ยน', 'อื่นๆ'];

function prop(k) { return PropertiesService.getScriptProperties().getProperty(k) || ''; }
function setProp(k, v) { PropertiesService.getScriptProperties().setProperty(k, v); }

// ─────────────────────────────────────────────
// โครงสร้างชีต PKSystem (setupPkSystem รันซ้ำได้ — เพิ่มเฉพาะที่ขาด)
// ─────────────────────────────────────────────
const TABS = {
  Customers:  ['Customer_ID', 'ชื่อลูกค้า', 'เบอร์โทร', 'ที่อยู่', 'เครดิต(วัน)', 'หมายเหตุ', 'สร้างเมื่อ'],
  Products:   ['Product_ID', 'ชื่อสินค้า', 'หน่วย', 'ราคา/หน่วย', 'หมายเหตุ', 'คงเหลือ', 'จุดเตือน', 'สถานะ'],
  Materials:  ['Material_ID', 'ชื่อวัตถุดิบ', 'หน่วย', 'คงเหลือ', 'จุดสั่งซื้อ', 'หมายเหตุ'],
  Orders:     ['Order_ID', 'วันที่รับ', 'ลูกค้า', 'กำหนดส่ง', 'สถานะ', 'มีสกรีน', 'ยอดรวม', 'รายการ', 'หมายเหตุ', 'ผู้รับออเดอร์', 'Bill_No', 'อัปเดตล่าสุด', 'Customer_ID', 'ส่งครบเมื่อ'],
  Production: ['Job_ID', 'Order_ID', 'วันที่เข้าคิว', 'งาน', 'จำนวนรวม', 'สถานะ', 'เริ่มเมื่อ', 'เสร็จเมื่อ', 'ผู้ทำ', 'หมายเหตุ', 'Product_ID', 'สินค้า', 'จำนวนสั่ง', 'ดีสะสม', 'เสียสะสม'],
  ScreenJobs: ['Job_ID', 'Order_ID', 'วันที่เข้าคิว', 'ลาย/สี', 'จำนวน', 'สถานะ', 'เริ่มเมื่อ', 'เสร็จเมื่อ', 'ผู้ทำ', 'หมายเหตุ', 'Product_ID', 'สินค้า', 'จำนวนสั่ง', 'ดีสะสม', 'เสียสะสม'],
  Deliveries: ['Delivery_ID', 'เมื่อ', 'Order_ID', 'ลูกค้า', 'รายการ', 'ผู้ส่ง', 'หมายเหตุ'],
  Bills:      ['Bill_No', 'วันที่', 'ลูกค้า', 'Order_ID', 'ยอดรวม', 'ประเภท', 'ช่องทางชำระ', 'สถานะ', 'กำหนดชำระ', 'ชำระเมื่อ', 'Stmt_No', 'รายการ', 'หมายเหตุ', 'ที่มา', 'ผู้ทำ'],
  Statements: ['Stmt_No', 'วันที่วาง', 'ลูกค้า', 'จำนวนบิล', 'ยอดรวม', 'กำหนดเก็บเงิน', 'สถานะ', 'บิลที่รวม', 'หมายเหตุ'],
  Staff:      ['Staff_ID', 'ชื่อ', 'ชื่อเล่น', 'แผนก', 'PIN', 'สถานะ', 'เริ่มงาน', 'Token', 'TokenExp', 'หมายเหตุ'],
  Attendance: ['วันที่', 'Staff_ID', 'ชื่อ', 'เข้า', 'ออก', 'ชั่วโมง', 'แก้โดย', 'หมายเหตุ'],
  StockMoves: ['Move_ID', 'เมื่อ', 'ประเภท', 'ชนิด', 'Item_ID', 'ชื่อ', 'จำนวน', 'คงเหลือหลัง', 'ผู้ทำ', 'อ้างอิง', 'หมายเหตุ'],
  ProductionLogs: ['เมื่อ', 'Job_ID', 'Order_ID', 'Product_ID', 'สินค้า', 'ประเภทงาน', 'ดี', 'เสีย', 'สาเหตุเสีย', 'เครื่อง', 'กะ', 'ผู้ลง', 'หมายเหตุ'],
  ActivityLog: ['เมื่อ', 'ใคร', 'ช่องทาง', 'การกระทำ', 'อ้างอิง', 'รายละเอียด'],
  PriceHistory: ['วันที่', 'Product_ID', 'ชื่อสินค้า', 'ราคาเดิม', 'ราคาใหม่', 'ผู้ปรับ', 'หมายเหตุ'],
  Settings:   ['key', 'value'],
};

const SETTINGS_SEED = [
  ['COMPANY_NAME', 'โรงขวด P&K'], ['COMPANY_ADDR', ''], ['COMPANY_TEL', ''], ['TAX_ID', ''],
  ['BILL_PREFIX', 'PK'], ['BILL_NEXT', '1'], ['STMT_PREFIX', 'PKS'], ['STMT_NEXT', '1'],
];

function setupPkSystem() {
  let ss;
  const id = prop('PK_SHEET_ID');
  if (id) { ss = SpreadsheetApp.openById(id); }
  else { ss = SpreadsheetApp.create('PKSystem'); setProp('PK_SHEET_ID', ss.getId()); }
  Object.keys(TABS).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) { sh.appendRow(TABS[name]); sh.setFrozenRows(1); }
    else {
      // เพิ่มเฉพาะคอลัมน์ที่ขาด "ต่อท้าย" เท่านั้น — ไม่แทรกกลาง ไม่เรียงใหม่ ไม่ลบของที่มี
      const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
      TABS[name].forEach(function (label) {
        if (head.indexOf(label) < 0) sh.getRange(1, sh.getLastColumn() + 1).setValue(label);
      });
    }
  });
  // PIN/Token เก็บเป็นข้อความ กัน 0 นำหน้าหาย
  const stf = ss.getSheetByName('Staff');
  const stfHead = stf.getRange(1, 1, 1, stf.getLastColumn()).getValues()[0].map(String);
  ['PIN', 'Token'].forEach(function (c) {
    const i = stfHead.indexOf(c);
    if (i >= 0) stf.getRange(1, i + 1, stf.getMaxRows(), 1).setNumberFormat('@');
  });
  // เวลาเข้า/ออก เก็บเป็นข้อความ กันชีตแปลง 'HH:mm' เป็นวันที่ปี 1899
  const att = ss.getSheetByName('Attendance');
  const attHead = att.getRange(1, 1, 1, att.getLastColumn()).getValues()[0].map(String);
  ['เข้า', 'ออก'].forEach(function (c) {
    const i = attHead.indexOf(c);
    if (i >= 0) att.getRange(1, i + 1, att.getMaxRows(), 1).setNumberFormat('@');
  });
  const st = ss.getSheetByName('Settings');
  if (st.getLastRow() <= 1) SETTINGS_SEED.forEach(function (r) { st.appendRow(r); });
  const s1 = ss.getSheetByName('Sheet1') || ss.getSheetByName('ชีต1');
  if (s1 && ss.getSheets().length > 1) ss.deleteSheet(s1);
  Logger.log('PKSystem พร้อมใช้: ' + ss.getUrl());
}

// ─── ตัวช่วยชีต (หาคอลัมน์จากหัวตารางเสมอ) ───
let _SS = null;
function book() { if (!_SS) _SS = SpreadsheetApp.openById(prop('PK_SHEET_ID')); return _SS; }
function tab(name) {
  const sh = book().getSheetByName(name);
  if (!sh) throw new Error('ไม่พบแท็บ ' + name + ' — รัน setupPkSystem() ก่อน');
  return sh;
}
// Sheets คืนวันที่เป็น Date object — แปลงเป็นข้อความรูปแบบเดียวเสมอก่อนใช้เทียบ
function fmtCell(v) {
  if (v instanceof Date) {
    if (v.getFullYear() < 1900) return Utilities.formatDate(v, TZ, 'HH:mm'); // Sheets เก็บ 'เวลาอย่างเดียว' เป็นฐานปี 1899
    const hasTime = v.getHours() || v.getMinutes();
    return Utilities.formatDate(v, TZ, hasTime ? 'yyyy-MM-dd HH:mm' : 'yyyy-MM-dd');
  }
  return v;
}
function readTab(name) {
  const v = tab(name).getDataRange().getValues();
  const head = (v[0] || []).map(String);
  return { head: head, rows: v.slice(1).filter(function (r) { return r.join('') !== ''; }).map(function (r) { return r.map(fmtCell); }) };
}
function toObjs(head, rows) {
  return rows.map(function (r) { const o = {}; head.forEach(function (h, i) { o[h] = r[i] !== undefined ? r[i] : ''; }); return o; });
}
function rowsToObjs(name) { const d = readTab(name); return toObjs(d.head, d.rows); }
// อ่านเฉพาะหางแท็บ log ใหญ่ ๆ (ประหยัดเวลา — อย่าอ่านทั้งแท็บ)
function tailObjs(name, n) {
  const sh = tab(name);
  const last = sh.getLastRow();
  if (last <= 1) return [];
  const cols = sh.getLastColumn();
  const head = sh.getRange(1, 1, 1, cols).getValues()[0].map(String);
  const from = Math.max(2, last - n + 1);
  const rows = sh.getRange(from, 1, last - from + 1, cols).getValues()
    .filter(function (r) { return r.join('') !== ''; })
    .map(function (r) { return r.map(fmtCell); });
  return toObjs(head, rows);
}
// อ่านหางแท็บจนครอบช่วงวันที่ที่ต้องใช้ — กันข้อมูล 30 วันเกินโควตาแถวแล้วโดนตัดเงียบ ๆ
function tailSince_(name, dateLabel, since, n) {
  let rows = tailObjs(name, n);
  const total = tab(name).getLastRow() - 1;
  while (rows.length >= n && n < total && rows[0] && String(rows[0][dateLabel]).slice(0, 10) >= since) {
    n *= 2;
    rows = tailObjs(name, n);
  }
  return rows;
}
function col(head, label) {
  const i = head.indexOf(label);
  if (i < 0) throw new Error('ไม่พบคอลัมน์ "' + label + '"');
  return i;
}
function appendObj(name, obj) {
  const sh = tab(name);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  sh.appendRow(head.map(function (h) { return obj[h] !== undefined ? obj[h] : ''; }));
}
// เขียนหลายแถวรวดเดียว — ใช้กับงานก้อนใหญ่ (import) เพราะ appendObj ทีละแถว = อ่านหัวตาราง+เขียน
// อย่างละ 1 เรียก API ต่อ 1 แถว หลักพันแถวจะชนเพดานรัน 6 นาทีของ Apps Script แน่นอน
function appendObjs(name, objs) {
  if (!objs || !objs.length) return 0;
  const sh = tab(name);
  const cols = sh.getLastColumn();
  const head = sh.getRange(1, 1, 1, cols).getValues()[0].map(String);
  const rows = objs.map(function (o) {
    return head.map(function (h) { return o[h] !== undefined ? o[h] : ''; });
  });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, cols).setValues(rows);
  return rows.length;
}
function updateWhere(name, idLabel, idValue, patch) {
  const sh = tab(name);
  const v = sh.getDataRange().getValues();
  const head = v[0].map(String);
  const idc = col(head, idLabel);
  for (let i = 1; i < v.length; i++) {
    if (String(v[i][idc]) === String(idValue)) {
      const row = v[i].slice();
      Object.keys(patch).forEach(function (label) { row[col(head, label)] = patch[label]; });
      sh.getRange(i + 1, 1, 1, head.length).setValues([row]);
      return true;
    }
  }
  return false;
}
function now() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'); }
function today() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function daysFromNow(d) { return Utilities.formatDate(new Date(Date.now() + d * 86400000), TZ, 'yyyy-MM-dd'); }
function num(x) { return Number(String(x).replace(/,/g, '')) || 0; }
function padN(n, pad) { const s2 = String(n); return s2.length >= pad ? s2 : ('000000' + s2).slice(-pad); }
function yy_() { return Utilities.formatDate(new Date(), TZ, 'yy'); }
function settingsMap() {
  const st = readTab('Settings'); const m = {};
  const kc = col(st.head, 'key'), vc = col(st.head, 'value');
  st.rows.forEach(function (r) { m[r[kc]] = r[vc]; });
  return m;
}
// เลขรัน (เรียกได้เฉพาะใน mutation ที่ถือ lock อยู่แล้ว — ห้ามใส่ lock ซ้อน)
function seq(counterKey, prefix, pad) {
  const st = tab('Settings');
  const v = st.getDataRange().getValues();
  const head = v[0].map(String);
  const kc = col(head, 'key'), vc = col(head, 'value');
  for (let i = 1; i < v.length; i++) {
    if (String(v[i][kc]) === counterKey) {
      const n = Number(v[i][vc]) || 1;
      st.getRange(i + 1, vc + 1).setValue(n + 1);
      return prefix + padN(n, pad || 4);
    }
  }
  st.appendRow([counterKey, 2]);
  return prefix + padN(1, pad || 4);
}
// ตัวนับแบบระบุ key ตรง ๆ (ใช้กับ BILL_NEXT / STMT_NEXT เดิมของ v1)
function nextCounter(counterKey, pad, prefix) {
  const st = tab('Settings');
  const v = st.getDataRange().getValues();
  const head = v[0].map(String);
  const kc = col(head, 'key'), vc = col(head, 'value');
  for (let i = 1; i < v.length; i++) {
    if (String(v[i][kc]) === counterKey) {
      const n = Number(v[i][vc]) || 1;
      st.getRange(i + 1, vc + 1).setValue(n + 1);
      return prefix + padN(n, pad);
    }
  }
  st.appendRow([counterKey, 2]);
  return prefix + padN(1, pad);
}

// ─────────────────────────────────────────────
// พนักงาน + ล็อกอิน (PIN → token) — PIN ห้ามหลุดออก API เด็ดขาด
// ─────────────────────────────────────────────
function staffPublic() {
  return rowsToObjs('Staff').map(function (s) {
    return { 'Staff_ID': s['Staff_ID'], 'ชื่อ': s['ชื่อ'], 'ชื่อเล่น': s['ชื่อเล่น'], 'แผนก': s['แผนก'], 'สถานะ': s['สถานะ'], 'เริ่มงาน': s['เริ่มงาน'], 'หมายเหตุ': s['หมายเหตุ'] };
  });
}
function login(pay) {
  const nick = String(pay.nick || '').trim();
  const pin = String(pay.pin || '').trim();
  if (!nick || !pin) return { ok: false, error: 'ใส่ชื่อเล่นและ PIN' };
  const cache = CacheService.getScriptCache();
  const fkey = 'lf:' + nick;
  const fails = Number(cache.get(fkey) || 0);
  if (fails >= 5) return { ok: false, error: 'ผิดเกิน 5 ครั้ง — ล็อก 10 นาที' };
  const st = readTab('Staff');
  const o = toObjs(st.head, st.rows).filter(function (s) {
    return String(s['ชื่อเล่น']).trim() === nick && s['สถานะ'] === 'ทำงาน';
  })[0];
  if (!o || String(o['PIN']).trim() !== pin) {
    cache.put(fkey, String(fails + 1), 600);
    return { ok: false, error: 'ชื่อเล่นหรือ PIN ไม่ถูกต้อง' };
  }
  cache.remove(fkey);
  const token = Utilities.getUuid();
  const exp = Utilities.formatDate(new Date(Date.now() + TOKEN_DAYS * 86400000), TZ, 'yyyy-MM-dd HH:mm');
  updateWhere('Staff', 'Staff_ID', o['Staff_ID'], { 'Token': token, 'TokenExp': exp });
  return { ok: true, token: token, me: { id: o['Staff_ID'], name: o['ชื่อ'], nick: o['ชื่อเล่น'], dept: o['แผนก'] }, _log: { ref: o['Staff_ID'], detail: nick } };
}
function who(p) {
  if (p.token) {
    const st = readTab('Staff');
    const o = toObjs(st.head, st.rows).filter(function (s) {
      return String(s['Token']) === String(p.token) && s['สถานะ'] === 'ทำงาน' && String(s['TokenExp']) >= now();
    })[0];
    if (o) return { id: o['Staff_ID'], name: o['ชื่อ'], nick: o['ชื่อเล่น'], dept: o['แผนก'], via: 'pin' };
    return null;
  }
  if (p.key && p.key === prop('PK_EXEC_KEY')) return { id: 'EXEC', name: 'ผู้บริหาร', nick: 'ผู้บริหาร', dept: 'บริหาร', via: 'exec' };
  if (p.key && p.key === prop('PK_KEY')) return { id: 'KEY', name: 'ทีม(รหัสร่วม)' + (p.user ? ':' + p.user : ''), nick: p.user || 'รหัสร่วม', dept: 'ออฟฟิศ', via: 'key' };
  return null;
}
function staffSave(pay, me) { // exec เท่านั้น: {id?, name, nick, dept, pin?, status?, start?, note?}
  const nick = String(pay.nick || '').trim();
  if (!pay.name || !nick) return { ok: false, error: 'ต้องมีชื่อและชื่อเล่น' };
  const all = rowsToObjs('Staff');
  const dup = all.filter(function (s) { return String(s['ชื่อเล่น']).trim() === nick && s['Staff_ID'] !== pay.id; })[0];
  if (dup) return { ok: false, error: 'ชื่อเล่น "' + nick + '" ถูกใช้แล้ว (' + dup['ชื่อ'] + ')' };
  if (pay.pin && !/^\d{4,6}$/.test(String(pay.pin))) return { ok: false, error: 'PIN ต้องเป็นตัวเลข 4-6 หลัก' };
  if (pay.id) {
    const patch = { 'ชื่อ': pay.name, 'ชื่อเล่น': nick, 'แผนก': pay.dept || '', 'สถานะ': pay.status || 'ทำงาน', 'หมายเหตุ': pay.note || '' };
    if (pay.pin) patch['PIN'] = String(pay.pin);
    if (pay.status && pay.status !== 'ทำงาน') { patch['Token'] = ''; patch['TokenExp'] = ''; }  // พ้นสภาพ = หลุดจากระบบทันที
    if (!updateWhere('Staff', 'Staff_ID', pay.id, patch)) return { ok: false, error: 'ไม่พบ ' + pay.id };
    return { ok: true, id: pay.id, _log: { ref: pay.id, detail: pay.name + (pay.pin ? ' (ตั้ง PIN ใหม่)' : '') } };
  }
  if (!pay.pin) return { ok: false, error: 'พนักงานใหม่ต้องตั้ง PIN' };
  const id = seq('STAFF_NEXT', 'S', 3);
  appendObj('Staff', { 'Staff_ID': id, 'ชื่อ': pay.name, 'ชื่อเล่น': nick, 'แผนก': pay.dept || '', 'PIN': String(pay.pin), 'สถานะ': 'ทำงาน', 'เริ่มงาน': pay.start || today() });
  return { ok: true, id: id, _log: { ref: id, detail: pay.name } };
}

// ─── ลงเวลา ───
function clock(pay, me) {
  if (me.via !== 'pin') return { ok: false, error: 'ลงเวลาต้องล็อกอินด้วย PIN ของตัวเอง' };
  // ใช้เวลาที่ "กดจริง" จากเครื่อง (คิวออฟไลน์ replay ทีหลังได้เวลาถูก) — เพี้ยนเกิน 3 วันใช้เวลา server
  let base = new Date();
  const at = Number(pay.at);
  if (at && !isNaN(at) && Math.abs(Date.now() - at) < 3 * 86400000) base = new Date(at);
  const td = Utilities.formatDate(base, TZ, 'yyyy-MM-dd');
  const att = rowsToObjs('Attendance');
  const mine = att.filter(function (a) { return a['Staff_ID'] === me.id; });
  const todayRow = mine.filter(function (a) { return String(a['วันที่']) === td; })[0];
  const t = Utilities.formatDate(base, TZ, 'HH:mm');
  if (pay.do === 'in') {
    if (todayRow && todayRow['เข้า']) return { ok: true, already: true, in: todayRow['เข้า'], out: todayRow['ออก'] };
    if (todayRow) { updateAtt_(td, me.id, { 'เข้า': t }); }
    else appendObj('Attendance', { 'วันที่': td, 'Staff_ID': me.id, 'ชื่อ': me.name, 'เข้า': t });
    return { ok: true, in: t, _log: { ref: me.id, detail: 'เข้า ' + t } };
  }
  // ออก: วันนี้ก่อน ไม่มีก็หาแถวค้างออกของเมื่อวาน (กะข้ามคืน)
  let target = todayRow && todayRow['เข้า'] ? todayRow : null;
  let targetDate = td;
  if (!target) {
    const yd = Utilities.formatDate(new Date(base.getTime() - 86400000), TZ, 'yyyy-MM-dd');
    const yRow = mine.filter(function (a) { return String(a['วันที่']) === yd && a['เข้า'] && !a['ออก']; })[0];
    if (yRow) { target = yRow; targetDate = yd; }
  }
  if (!target) {
    if (todayRow) { updateAtt_(td, me.id, { 'ออก': t }); return { ok: true, out: t, warn: 'ไม่พบเวลาเข้า — อัปเดตเวลาออกให้แล้ว', _log: { ref: me.id, detail: 'ออก ' + t + ' (ไม่มีเวลาเข้า)' } }; }
    appendObj('Attendance', { 'วันที่': td, 'Staff_ID': me.id, 'ชื่อ': me.name, 'ออก': t, 'หมายเหตุ': 'ไม่มีเวลาเข้า' });
    return { ok: true, out: t, warn: 'ไม่พบเวลาเข้า — บันทึกออกไว้ให้ผู้บริหารตรวจ', _log: { ref: me.id, detail: 'ออก ' + t + ' (ไม่มีเวลาเข้า)' } };
  }
  const hrs = hoursBetween_(String(target['เข้า']), t);
  updateAtt_(targetDate, me.id, { 'ออก': t, 'ชั่วโมง': hrs });
  return { ok: true, in: target['เข้า'], out: t, hours: hrs, _log: { ref: me.id, detail: 'ออก ' + t + ' (' + hrs + ' ชม.)' } };
}
function hoursBetween_(tin, tout) {
  const p = function (s) { const m = String(s).split(':'); return (Number(m[0]) || 0) * 60 + (Number(m[1]) || 0); };
  let mins = p(tout) - p(tin);
  if (mins < 0) mins += 24 * 60;   // กะข้ามเที่ยงคืน
  return Math.round(mins / 6) / 10;
}
function updateAtt_(date, staffId, patch) {
  const sh = tab('Attendance');
  const v = sh.getDataRange().getValues();
  const head = v[0].map(String);
  for (let i = 1; i < v.length; i++) {
    if (String(fmtCell(v[i][col(head, 'วันที่')])) === date && String(v[i][col(head, 'Staff_ID')]) === staffId) {
      const row = v[i].slice();
      Object.keys(patch).forEach(function (l) { row[col(head, l)] = patch[l]; });
      sh.getRange(i + 1, 1, 1, head.length).setValues([row]);
      return true;
    }
  }
  return false;
}
function attFix(pay, me) { // exec: {date, staffId, in?, out?, note?}
  const patch = { 'แก้โดย': me.name };
  if (pay.in !== undefined) patch['เข้า'] = pay.in;
  if (pay.out !== undefined) patch['ออก'] = pay.out;
  if (pay.note) patch['หมายเหตุ'] = pay.note;
  let okA = updateAtt_(pay.date, pay.staffId, patch);
  if (!okA) {
    const s = staffPublic().filter(function (x) { return x['Staff_ID'] === pay.staffId; })[0] || {};
    appendObj('Attendance', { 'วันที่': pay.date, 'Staff_ID': pay.staffId, 'ชื่อ': s['ชื่อ'] || '', 'เข้า': pay.in || '', 'ออก': pay.out || '', 'แก้โดย': me.name, 'หมายเหตุ': pay.note || '' });
  }
  // คำนวณชั่วโมงใหม่ถ้าครบเข้า-ออก
  const row = rowsToObjs('Attendance').filter(function (a) { return String(a['วันที่']) === pay.date && a['Staff_ID'] === pay.staffId; })[0];
  if (row && row['เข้า'] && row['ออก']) updateAtt_(pay.date, pay.staffId, { 'ชั่วโมง': hoursBetween_(String(row['เข้า']), String(row['ออก'])) });
  return { ok: true, _log: { ref: pay.staffId, detail: pay.date + ' เข้า=' + (pay.in || '-') + ' ออก=' + (pay.out || '-') } };
}

// ─────────────────────────────────────────────
// สต๊อก — Products.คงเหลือ / Materials.คงเหลือ คือยอดจริง, StockMoves คือประวัติ
// ทุกตัวที่แตะยอดถูกเรียกภายใน lock ของ dispatch เท่านั้น
// ─────────────────────────────────────────────
function stockShift_(kind, itemId, name, qty, moveType, refId, byName, note) {
  const tabName = kind === 'วัตถุดิบ' ? 'Materials' : 'Products';
  const idLabel = kind === 'วัตถุดิบ' ? 'Material_ID' : 'Product_ID';
  const balLabel = 'คงเหลือ';
  const d = readTab(tabName);
  const o = toObjs(d.head, d.rows).filter(function (x) { return itemId ? String(x[idLabel]) === String(itemId) : String(x[kind === 'วัตถุดิบ' ? 'ชื่อวัตถุดิบ' : 'ชื่อสินค้า']).trim() === String(name).trim(); })[0];
  if (!o) return { moved: false, name: name };
  const bal = num(o[balLabel]) + qty;
  updateWhere(tabName, idLabel, o[idLabel], (function () { const pt = {}; pt[balLabel] = bal; return pt; })());
  appendObj('StockMoves', {
    'Move_ID': seq('MOVE_NEXT', 'MV', 6), 'เมื่อ': now(), 'ประเภท': moveType, 'ชนิด': kind,
    'Item_ID': o[idLabel], 'ชื่อ': o[kind === 'วัตถุดิบ' ? 'ชื่อวัตถุดิบ' : 'ชื่อสินค้า'], 'จำนวน': qty, 'คงเหลือหลัง': bal,
    'ผู้ทำ': byName, 'อ้างอิง': refId || '', 'หมายเหตุ': note || '',
  });
  return { moved: true, id: o[idLabel], bal: bal };
}
function stockIn(pay, me) { // {kind, id?, name, qty, note} รับของเข้า (ของใหม่ = สร้างรายการวัตถุดิบให้)
  const qty = Number(pay.qty);
  if (!qty || qty <= 0) return { ok: false, error: 'จำนวนต้องมากกว่า 0' };
  let r = stockShift_(pay.kind, pay.id, pay.name, qty, 'รับเข้า', '', me.name, pay.note);
  if (!r.moved && pay.kind === 'วัตถุดิบ' && pay.name) {
    const id = seq('MAT_NEXT', 'M', 3);
    appendObj('Materials', { 'Material_ID': id, 'ชื่อวัตถุดิบ': String(pay.name).trim(), 'หน่วย': pay.unit || '', 'คงเหลือ': 0, 'จุดสั่งซื้อ': pay.reorder || '' });
    r = stockShift_(pay.kind, id, pay.name, qty, 'รับเข้า', '', me.name, pay.note);
  }
  if (!r.moved) return { ok: false, error: 'ไม่พบ "' + pay.name + '" ในระบบ (สินค้าใหม่ให้ประธานเพิ่มจากบอร์ด)' };
  return { ok: true, bal: r.bal, _log: { ref: r.id, detail: pay.name + ' +' + qty } };
}
function stockCount(pay, me) { // {kind, id, counted, note} นับจริง-ปรับยอด
  const tabName = pay.kind === 'วัตถุดิบ' ? 'Materials' : 'Products';
  const idLabel = pay.kind === 'วัตถุดิบ' ? 'Material_ID' : 'Product_ID';
  const o = rowsToObjs(tabName).filter(function (x) { return String(x[idLabel]) === String(pay.id); })[0];
  if (!o) return { ok: false, error: 'ไม่พบรายการ' };
  const counted = Number(pay.counted);
  if (isNaN(counted) || counted < 0) return { ok: false, error: 'จำนวนนับไม่ถูกต้อง' };
  const diff = counted - num(o['คงเหลือ']);
  if (diff !== 0 && !pay.note) return { ok: false, error: 'ยอดต่างจากระบบ ' + diff + ' — ต้องใส่เหตุผล' };
  if (diff === 0) return { ok: true, diff: 0 };
  const r = stockShift_(pay.kind, pay.id, '', diff, 'ปรับยอด', '', me.name, pay.note);
  return { ok: true, diff: diff, bal: r.bal, _log: { ref: pay.id, detail: (o['ชื่อสินค้า'] || o['ชื่อวัตถุดิบ']) + ' ปรับ ' + (diff > 0 ? '+' : '') + diff + ' (' + pay.note + ')' } };
}

// ─────────────────────────────────────────────
// ออเดอร์ → งานผลิต/สกรีน "รายสินค้า" → ส่งเป็นงวด
// ─────────────────────────────────────────────
function resolveItems_(items) {
  const prods = rowsToObjs('Products');
  const unmapped = [];
  const out = (items || []).map(function (it) {
    const p = prods.filter(function (x) { return String(x['ชื่อสินค้า']).trim() === String(it.name).trim(); })[0];
    if (!p) unmapped.push(it.name);
    return { pid: p ? p['Product_ID'] : '', name: String(it.name).trim(), qty: Number(it.qty) || 0, price: Number(it.price) || 0, screen: !!it.screen, screenNote: it.screenNote || '' };
  }).filter(function (it) { return it.name && it.qty > 0; });
  return { items: out, unmapped: unmapped };
}
function orderSave(pay, me) {
  const rs = resolveItems_(pay.items);
  const items = rs.items;
  const customer = String(pay.customer || '').trim();
  if (!customer || !items.length) return { ok: false, error: 'ต้องมีลูกค้าและรายการ' };
  const total = items.reduce(function (s, it) { return s + it.qty * it.price; }, 0);
  const hasScreen = items.some(function (it) { return it.screen; });
  const id = seq('ORD_NEXT', 'PO' + yy_() + '-', 4);
  const cust = custSave({ name: customer }, me);
  appendObj('Orders', {
    'Order_ID': id, 'วันที่รับ': today(), 'ลูกค้า': customer, 'Customer_ID': cust.id || '',
    'กำหนดส่ง': pay.due || '', 'สถานะ': 'รอผลิต', 'มีสกรีน': hasScreen ? 'มี' : '', 'ยอดรวม': total,
    'รายการ': JSON.stringify(items), 'หมายเหตุ': pay.note || '', 'ผู้รับออเดอร์': me.name, 'อัปเดตล่าสุด': now(),
  });
  items.forEach(function (it) {
    appendObj('Production', {
      'Job_ID': seq('JOB_NEXT', 'PJ' + yy_() + '-', 4), 'Order_ID': id, 'วันที่เข้าคิว': today(),
      'งาน': it.name + ' ×' + it.qty, 'จำนวนรวม': it.qty,
      'Product_ID': it.pid, 'สินค้า': it.name, 'จำนวนสั่ง': it.qty, 'ดีสะสม': 0, 'เสียสะสม': 0, 'สถานะ': 'รอผลิต',
    });
    if (it.screen) {
      appendObj('ScreenJobs', {
        'Job_ID': seq('SJOB_NEXT', 'SJ' + yy_() + '-', 4), 'Order_ID': id, 'วันที่เข้าคิว': today(),
        'ลาย/สี': it.name + (it.screenNote ? ' (' + it.screenNote + ')' : ''), 'จำนวน': it.qty,
        'Product_ID': it.pid, 'สินค้า': it.name, 'จำนวนสั่ง': it.qty, 'ดีสะสม': 0, 'เสียสะสม': 0, 'สถานะ': 'รอสกรีน',
      });
    }
  });
  return { ok: true, id: id, total: total, unmapped: rs.unmapped, _log: { ref: id, detail: customer + ' ' + items.length + ' รายการ ' + total + ' บ.' + (rs.unmapped.length ? ' (นอกระบบ: ' + rs.unmapped.join(',') + ')' : '') } };
}
function jobsOf_(orderId) {
  return {
    prod: rowsToObjs('Production').filter(function (j) { return j['Order_ID'] === orderId; }),
    scr: rowsToObjs('ScreenJobs').filter(function (j) { return j['Order_ID'] === orderId; }),
  };
}
function deliveredMapAll_() { // อ่าน Deliveries รอบเดียว → { orderId: { pid|ชื่อ: ยอดส่งสะสม } }
  const by = {};
  rowsToObjs('Deliveries').forEach(function (d) {
    let its = []; try { its = JSON.parse(d['รายการ'] || '[]'); } catch (e) {}
    const m = by[d['Order_ID']] = by[d['Order_ID']] || {};
    its.forEach(function (it) { const k = it.pid || it.name; m[k] = (m[k] || 0) + (Number(it.qty) || 0); });
  });
  return by;
}
function deliveredOf_(orderId) { return deliveredMapAll_()[orderId] || {}; }
function orderEdit(pay, me) { // แก้ได้เฉพาะออเดอร์ที่ยังไม่เริ่มอะไรเลย
  const ord = rowsToObjs('Orders').filter(function (o) { return o['Order_ID'] === pay.id; })[0];
  if (!ord) return { ok: false, error: 'ไม่พบออเดอร์' };
  if (ord['สถานะ'] === 'ยกเลิก') return { ok: false, error: 'ออเดอร์ถูกยกเลิกแล้ว — เปิดออเดอร์ใหม่แทน' };
  const j = jobsOf_(pay.id);
  const started = j.prod.concat(j.scr).some(function (x) { return x['สถานะ'] !== 'รอผลิต' && x['สถานะ'] !== 'รอสกรีน' && x['สถานะ'] !== 'ยกเลิก'; });
  if (started || ord['Bill_No'] || Object.keys(deliveredOf_(pay.id)).length) return { ok: false, error: 'งานเริ่มแล้ว/มีบิลหรือการส่งแล้ว — แก้ไม่ได้ ให้ยกเลิกแล้วเปิดใหม่ หรือติดต่อผู้บริหาร' };
  j.prod.concat(j.scr).forEach(function (x) {
    updateWhere(x['Job_ID'].indexOf('SJ') === 0 ? 'ScreenJobs' : 'Production', 'Job_ID', x['Job_ID'], { 'สถานะ': 'ยกเลิก', 'หมายเหตุ': 'แก้ออเดอร์' });
  });
  const rs = resolveItems_(pay.items);
  if (!rs.items.length) return { ok: false, error: 'ต้องมีรายการอย่างน้อย 1 รายการ' };
  const total = rs.items.reduce(function (s, it) { return s + it.qty * it.price; }, 0);
  const customer2 = String(pay.customer || ord['ลูกค้า']).trim();
  const cust2 = custSave({ name: customer2 }, me);
  updateWhere('Orders', 'Order_ID', pay.id, {
    'ลูกค้า': customer2, 'Customer_ID': cust2.id || '', 'กำหนดส่ง': pay.due || '', 'ยอดรวม': total,
    'มีสกรีน': rs.items.some(function (it) { return it.screen; }) ? 'มี' : '', 'รายการ': JSON.stringify(rs.items),
    'หมายเหตุ': pay.note || '', 'อัปเดตล่าสุด': now(),
  });
  rs.items.forEach(function (it) {
    appendObj('Production', { 'Job_ID': seq('JOB_NEXT', 'PJ' + yy_() + '-', 4), 'Order_ID': pay.id, 'วันที่เข้าคิว': today(), 'งาน': it.name + ' ×' + it.qty, 'จำนวนรวม': it.qty, 'Product_ID': it.pid, 'สินค้า': it.name, 'จำนวนสั่ง': it.qty, 'ดีสะสม': 0, 'เสียสะสม': 0, 'สถานะ': 'รอผลิต' });
    if (it.screen) appendObj('ScreenJobs', { 'Job_ID': seq('SJOB_NEXT', 'SJ' + yy_() + '-', 4), 'Order_ID': pay.id, 'วันที่เข้าคิว': today(), 'ลาย/สี': it.name + (it.screenNote ? ' (' + it.screenNote + ')' : ''), 'จำนวน': it.qty, 'Product_ID': it.pid, 'สินค้า': it.name, 'จำนวนสั่ง': it.qty, 'ดีสะสม': 0, 'เสียสะสม': 0, 'สถานะ': 'รอสกรีน' });
  });
  return { ok: true, unmapped: rs.unmapped, _log: { ref: pay.id, detail: 'แก้รายการ (' + rs.items.length + ' รายการ ' + total + ' บ.)' } };
}
function orderCancel(pay, me) {
  const ord = rowsToObjs('Orders').filter(function (o) { return o['Order_ID'] === pay.id; })[0];
  if (!ord) return { ok: false, error: 'ไม่พบออเดอร์' };
  if (Object.keys(deliveredOf_(pay.id)).length) return { ok: false, error: 'มีการส่งของไปแล้ว — ยกเลิกไม่ได้ ต้องทำรับคืนก่อน (แจ้งผู้บริหาร)' };
  if (ord['Bill_No']) return { ok: false, error: 'มีบิลแล้ว (' + ord['Bill_No'] + ') — ยกเลิกบิลก่อน' };
  const j = jobsOf_(pay.id);
  j.prod.forEach(function (x) { if (x['สถานะ'] !== 'เสร็จ') updateWhere('Production', 'Job_ID', x['Job_ID'], { 'สถานะ': 'ยกเลิก' }); });
  j.scr.forEach(function (x) { if (x['สถานะ'] !== 'เสร็จ') updateWhere('ScreenJobs', 'Job_ID', x['Job_ID'], { 'สถานะ': 'ยกเลิก' }); });
  updateWhere('Orders', 'Order_ID', pay.id, { 'สถานะ': 'ยกเลิก', 'หมายเหตุ': (ord['หมายเหตุ'] ? ord['หมายเหตุ'] + ' | ' : '') + 'ยกเลิก: ' + (pay.note || '-'), 'อัปเดตล่าสุด': now() });
  return { ok: true, _log: { ref: pay.id, detail: ord['ลูกค้า'] + (pay.note ? ' — เหตุผล: ' + pay.note : '') } };
}
function recomputeOrder_(orderId) {
  const ord = rowsToObjs('Orders').filter(function (o) { return o['Order_ID'] === orderId; })[0];
  if (!ord || ord['สถานะ'] === 'ยกเลิก') return;
  let items = []; try { items = JSON.parse(ord['รายการ'] || '[]'); } catch (e) {}
  const delivered = deliveredOf_(orderId);
  const orderedByKey = {};
  items.forEach(function (it) { const k = it.pid || it.name; orderedByKey[k] = (orderedByKey[k] || 0) + it.qty; });
  const totalOrdered = items.reduce(function (s, it) { return s + it.qty; }, 0);
  const totalDelivered = Object.keys(orderedByKey).reduce(function (s, k) { return s + Math.min(delivered[k] || 0, orderedByKey[k]); }, 0);
  let status;
  if (totalOrdered > 0 && totalDelivered >= totalOrdered) status = 'ส่งแล้ว';
  else if (totalDelivered > 0) status = 'ส่งบางส่วน';
  else {
    const j = jobsOf_(orderId);
    const active = function (list) { return list.filter(function (x) { return x['สถานะ'] !== 'ยกเลิก'; }); };
    const prod = active(j.prod), scr = active(j.scr);
    const prodDone = prod.every(function (x) { return x['สถานะ'] === 'เสร็จ'; });
    const scrDone = scr.every(function (x) { return x['สถานะ'] === 'เสร็จ'; });
    if (prodDone && scrDone) status = 'พร้อมส่ง';
    else if (scr.some(function (x) { return x['สถานะ'] === 'กำลังสกรีน'; })) status = 'กำลังสกรีน';
    else if (prodDone && !scrDone) status = 'รอสกรีน';
    else if (prod.some(function (x) { return x['สถานะ'] === 'กำลังผลิต'; })) status = 'กำลังผลิต';
    else status = 'รอผลิต';
  }
  const patch = { 'สถานะ': status, 'อัปเดตล่าสุด': now() };
  if (status === 'ส่งแล้ว' && !ord['ส่งครบเมื่อ']) patch['ส่งครบเมื่อ'] = today();
  updateWhere('Orders', 'Order_ID', orderId, patch);
  return status;
}

// ─── งานผลิต/สกรีน: เริ่ม → ลงผลผลิต (ดี/เสีย) → ปิดงาน ───
function jobTab_(type) { return type === 'screen' ? 'ScreenJobs' : 'Production'; }
function jobStart(pay, me) {
  const t = jobTab_(pay.type);
  const job = rowsToObjs(t).filter(function (j) { return j['Job_ID'] === pay.id; })[0];
  if (!job) return { ok: false, error: 'ไม่พบงาน' };
  if (job['สถานะ'] === 'ยกเลิก' || job['สถานะ'] === 'เสร็จ') return { ok: false, error: 'งานนี้' + job['สถานะ'] + 'แล้ว' };
  updateWhere(t, 'Job_ID', pay.id, { 'สถานะ': pay.type === 'screen' ? 'กำลังสกรีน' : 'กำลังผลิต', 'เริ่มเมื่อ': now(), 'ผู้ทำ': me.name });
  recomputeOrder_(job['Order_ID']);
  return { ok: true, _log: { ref: pay.id, detail: job['สินค้า'] || job['งาน'] } };
}
function prodLog(pay, me) { // {type:'prod'|'screen', id, good, waste, reason?, machine?, shift?, note?}
  const t = jobTab_(pay.type);
  const job = rowsToObjs(t).filter(function (j) { return j['Job_ID'] === pay.id; })[0];
  if (!job) return { ok: false, error: 'ไม่พบงาน' };
  if (job['สถานะ'] === 'ยกเลิก') return { ok: false, error: 'งานนี้ถูกยกเลิกแล้ว — ลงผลผลิตไม่ได้' };
  if (job['สถานะ'] === 'เสร็จ') return { ok: false, error: 'งานนี้ปิดแล้ว' };
  const good = Number(pay.good) || 0, waste = Number(pay.waste) || 0;
  if (good <= 0 && waste <= 0) return { ok: false, error: 'ใส่จำนวนดีหรือของเสียอย่างน้อยหนึ่งช่อง' };
  if (waste > 0 && !pay.reason) return { ok: false, error: 'มีของเสียต้องเลือกสาเหตุ' };
  const patch = { 'ดีสะสม': num(job['ดีสะสม']) + good, 'เสียสะสม': num(job['เสียสะสม']) + waste, 'ผู้ทำ': me.name };
  if (job['สถานะ'].indexOf('รอ') === 0) { patch['สถานะ'] = pay.type === 'screen' ? 'กำลังสกรีน' : 'กำลังผลิต'; patch['เริ่มเมื่อ'] = now(); }
  updateWhere(t, 'Job_ID', pay.id, patch);
  appendObj('ProductionLogs', {
    'เมื่อ': now(), 'Job_ID': pay.id, 'Order_ID': job['Order_ID'], 'Product_ID': job['Product_ID'], 'สินค้า': job['สินค้า'],
    'ประเภทงาน': pay.type === 'screen' ? 'สกรีน' : 'ผลิต', 'ดี': good, 'เสีย': waste, 'สาเหตุเสีย': pay.reason || '',
    'เครื่อง': pay.machine || '', 'กะ': pay.shift || '', 'ผู้ลง': me.name, 'หมายเหตุ': pay.note || '',
  });
  // ผลิต: ของดีเข้าสต๊อกสินค้า | สกรีน: ของเสียหักสต๊อก (ขวดที่ผลิตเข้าแล้วถูกทำเสีย)
  if (pay.type !== 'screen' && good > 0 && job['Product_ID']) stockShift_('สินค้า', job['Product_ID'], '', good, 'ผลิตเข้า', pay.id, me.name, '');
  if (pay.type === 'screen' && waste > 0 && job['Product_ID']) stockShift_('สินค้า', job['Product_ID'], '', -waste, 'ของเสีย', pay.id, me.name, pay.reason || '');
  recomputeOrder_(job['Order_ID']);
  return { ok: true, done: num(job['ดีสะสม']) + good, target: num(job['จำนวนสั่ง']), _log: { ref: pay.id, detail: (job['สินค้า'] || '') + ' ดี+' + good + (waste ? ' เสีย+' + waste + '(' + (pay.reason || '') + ')' : '') } };
}
function jobClose(pay, me) {
  const t = jobTab_(pay.type);
  const job = rowsToObjs(t).filter(function (j) { return j['Job_ID'] === pay.id; })[0];
  if (!job) return { ok: false, error: 'ไม่พบงาน' };
  if (job['สถานะ'] === 'เสร็จ' || job['สถานะ'] === 'ยกเลิก') return { ok: true, already: true };
  updateWhere(t, 'Job_ID', pay.id, { 'สถานะ': 'เสร็จ', 'เสร็จเมื่อ': now(), 'ผู้ทำ': me.name });
  const st = recomputeOrder_(job['Order_ID']);
  return { ok: true, orderStatus: st, _log: { ref: pay.id, detail: (job['สินค้า'] || job['งาน']) + ' (ดี ' + job['ดีสะสม'] + '/' + job['จำนวนสั่ง'] + ')' } };
}

// ─── ส่งของเป็นงวด — จุดเดียวที่หักสต๊อกสินค้าออก (ฝั่งมีออเดอร์) ───
function deliver(pay, me) { // {orderId, items:[{pid?, name, qty}], note}
  const ord = rowsToObjs('Orders').filter(function (o) { return o['Order_ID'] === pay.orderId; })[0];
  if (!ord) return { ok: false, error: 'ไม่พบออเดอร์' };
  if (ord['สถานะ'] === 'ยกเลิก') return { ok: false, error: 'ออเดอร์ถูกยกเลิกแล้ว' };
  let ordered = []; try { ordered = JSON.parse(ord['รายการ'] || '[]'); } catch (e) {}
  const delivered = deliveredOf_(pay.orderId);
  const sending = (pay.items || []).map(function (it) { return { pid: it.pid || '', name: String(it.name).trim(), qty: Number(it.qty) || 0 }; }).filter(function (it) { return it.qty > 0; });
  if (!sending.length) return { ok: false, error: 'ไม่ได้ระบุจำนวนที่ส่ง' };
  // คิดเป็น pool ต่อสินค้า — สินค้าเดียวกันหลายบรรทัด (ทั้งในออเดอร์และใน payload) ไม่หลุด/ไม่เบิ้ล
  const orderedByKey = {};
  ordered.forEach(function (x) { const k = x.pid || x.name; orderedByKey[k] = (orderedByKey[k] || 0) + (Number(x.qty) || 0); });
  const sendByKey = {};
  sending.forEach(function (it) { const k = it.pid || it.name; sendByKey[k] = (sendByKey[k] || 0) + it.qty; });
  const keys = Object.keys(sendByKey);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const nameOf = sending.filter(function (x) { return (x.pid || x.name) === k; })[0].name;
    if (!(k in orderedByKey)) return { ok: false, error: '"' + nameOf + '" ไม่อยู่ในออเดอร์นี้' };
    const remain = orderedByKey[k] - (delivered[k] || 0);
    if (sendByKey[k] > remain) return { ok: false, error: '"' + nameOf + '" เหลือให้ส่งแค่ ' + remain + ' (สั่ง ' + orderedByKey[k] + ')' };
  }
  const id = seq('DLV_NEXT', 'DL' + yy_() + '-', 4);
  appendObj('Deliveries', { 'Delivery_ID': id, 'เมื่อ': now(), 'Order_ID': pay.orderId, 'ลูกค้า': ord['ลูกค้า'], 'รายการ': JSON.stringify(sending), 'ผู้ส่ง': me.name, 'หมายเหตุ': pay.note || '' });
  const unmapped = [], negatives = [];
  sending.forEach(function (it) {
    if (it.pid) {
      const r = stockShift_('สินค้า', it.pid, '', -it.qty, 'ส่งออก', id, me.name, 'ออเดอร์ ' + pay.orderId);
      if (r.moved && r.bal < 0) negatives.push(it.name + ' เหลือ ' + r.bal);
    } else unmapped.push(it.name);
  });
  const st = recomputeOrder_(pay.orderId);
  return { ok: true, id: id, status: st, unmapped: unmapped, negatives: negatives, _log: { ref: pay.orderId, detail: ord['ลูกค้า'] + ' ส่ง ' + sending.map(function (i) { return i.name + '×' + i.qty; }).join(', ') + (unmapped.length ? ' (ไม่หักสต๊อก: ' + unmapped.join(',') + ')' : '') } };
}

// ─────────────────────────────────────────────
// บิล / ใบวางบิล (สัญญากับแชทการเงิน: คอลัมน์เดิมห้ามเปลี่ยน)
// ─────────────────────────────────────────────
function activeBills_() { return rowsToObjs('Bills').filter(function (b) { return b['สถานะ'] !== 'ยกเลิก'; }); }
function billList(p) {
  let bills = activeBills_();
  if (p.customer) bills = bills.filter(function (b) { return String(b['ลูกค้า']).trim() === String(p.customer).trim(); });
  if (p.status) bills = bills.filter(function (b) { return b['สถานะ'] === p.status; });
  return bills.reverse().slice(0, Number(p.limit) || 80);
}
function billCreate(pay, me) {
  let items = [], customer = String(pay.customer || '').trim(), orderId = pay.orderId || '', unmapped = [];
  if (orderId) {
    const ord = rowsToObjs('Orders').filter(function (x) { return x['Order_ID'] === orderId; })[0];
    if (!ord) return { ok: false, error: 'ไม่พบออเดอร์ ' + orderId };
    if (ord['สถานะ'] === 'ยกเลิก') return { ok: false, error: 'ออเดอร์นี้ถูกยกเลิกแล้ว — ออกบิลไม่ได้' };
    if (ord['Bill_No']) return { ok: false, error: 'ออเดอร์นี้ออกบิลแล้ว: ' + ord['Bill_No'] };
    try { items = JSON.parse(ord['รายการ'] || '[]'); } catch (e) {}
    customer = ord['ลูกค้า'];
  } else {
    const rs = resolveItems_(pay.items);
    items = rs.items;
    unmapped = rs.unmapped;
    if (!customer || !items.length) return { ok: false, error: 'ต้องมีลูกค้าและรายการ' };
  }
  const total = items.reduce(function (s, it) { return s + (Number(it.qty) || 0) * (Number(it.price) || 0); }, 0);
  const m = settingsMap();
  const no = nextCounter('BILL_NEXT', 4, (m.BILL_PREFIX || 'PK') + '-' + Utilities.formatDate(new Date(), TZ, 'yyyy') + '-');
  const isCredit = pay.type === 'เครดิต';
  let due = '';
  if (isCredit) due = daysFromNow(Number(pay.dueDays) || 30);
  appendObj('Bills', {
    'Bill_No': no, 'วันที่': today(), 'ลูกค้า': customer, 'Order_ID': orderId, 'ยอดรวม': total,
    'ประเภท': pay.type || 'เงินสด', 'ช่องทางชำระ': pay.channel || '', 'สถานะ': isCredit ? 'ค้างชำระ' : 'ชำระแล้ว',
    'กำหนดชำระ': due, 'ชำระเมื่อ': isCredit ? '' : today(), 'รายการ': JSON.stringify(items),
    'หมายเหตุ': pay.note || '', 'ที่มา': 'ระบบใหม่', 'ผู้ทำ': me.name,
  });
  if (orderId) updateWhere('Orders', 'Order_ID', orderId, { 'Bill_No': no, 'อัปเดตล่าสุด': now() });
  else items.forEach(function (it) { if (it.pid) stockShift_('สินค้า', it.pid, '', -(Number(it.qty) || 0), 'ส่งออก', no, me.name, 'บิลอิสระ'); }); // ขายไม่ผ่านออเดอร์ = หักสต๊อกที่บิล
  return { ok: true, no: no, total: total, due: due, customer: customer, items: items, date: today(), settings: m, unmapped: unmapped, _log: { ref: no, detail: customer + ' ' + total + ' บ. (' + (pay.type || 'เงินสด') + ')' + (unmapped.length ? ' (ไม่หักสต๊อก: ' + unmapped.join(',') + ')' : '') } };
}
function billPay(pay, me) {
  const b = rowsToObjs('Bills').filter(function (x) { return String(x['Bill_No']) === String(pay.no); })[0];
  if (!b) return { ok: false, error: 'ไม่พบบิล ' + pay.no };
  if (b['สถานะ'] === 'ยกเลิก') return { ok: false, error: 'บิลนี้ถูกยกเลิกไปแล้ว' };
  if (b['สถานะ'] === 'ชำระแล้ว') return { ok: true, already: true };
  updateWhere('Bills', 'Bill_No', pay.no, { 'สถานะ': 'ชำระแล้ว', 'ชำระเมื่อ': today(), 'ช่องทางชำระ': pay.channel || '', 'ผู้ทำ': me.name });
  return { ok: true, _log: { ref: pay.no, detail: 'รับชำระ ' + b['ยอดรวม'] + ' บ. (' + (pay.channel || '') + ')' } };
}
function billCancel(pay, me) { // {no, note}
  if (!pay.note) return { ok: false, error: 'ยกเลิกบิลต้องใส่เหตุผล' };
  const b = rowsToObjs('Bills').filter(function (x) { return String(x['Bill_No']) === String(pay.no); })[0];
  if (!b) return { ok: false, error: 'ไม่พบบิล' };
  if (b['สถานะ'] === 'ยกเลิก') return { ok: true, already: true };
  if (b['Stmt_No']) return { ok: false, error: 'บิลอยู่ในใบวางบิล ' + b['Stmt_No'] + ' — จัดการใบวางบิลก่อน' };
  updateWhere('Bills', 'Bill_No', pay.no, { 'สถานะ': 'ยกเลิก', 'หมายเหตุ': (b['หมายเหตุ'] ? b['หมายเหตุ'] + ' | ' : '') + 'ยกเลิก: ' + pay.note, 'ผู้ทำ': me.name });
  if (b['Order_ID']) updateWhere('Orders', 'Order_ID', b['Order_ID'], { 'Bill_No': '', 'อัปเดตล่าสุด': now() });
  else if (b['ที่มา'] === 'ระบบใหม่') { // บิลอิสระเคยหักสต๊อก → คืน
    let its = []; try { its = JSON.parse(b['รายการ'] || '[]'); } catch (e) {}
    its.forEach(function (it) { if (it.pid) stockShift_('สินค้า', it.pid, '', Number(it.qty) || 0, 'รับคืน', pay.no, me.name, 'ยกเลิกบิล'); });
  }
  return { ok: true, _log: { ref: pay.no, detail: 'ยกเลิก: ' + pay.note } };
}
function stmtCreate(pay, me) {
  const want = (pay.billNos || []).map(String);
  const cust = String(pay.customer || '').trim();
  const bills = activeBills_().filter(function (b) { return want.indexOf(String(b['Bill_No'])) >= 0 && b['สถานะ'] === 'ค้างชำระ' && !b['Stmt_No']; });
  if (!bills.length) return { ok: false, error: 'ไม่ได้เลือกบิล หรือบิลถูกวางบิล/ชำระไปแล้ว — กดดึงบิลค้างใหม่' };
  if (bills.length !== want.length) return { ok: false, error: 'บางบิลวางบิล/ชำระไปแล้ว — กดดึงบิลค้างใหม่' };
  const wrong = bills.filter(function (b) { return String(b['ลูกค้า']).trim() !== cust; });
  if (wrong.length) return { ok: false, error: 'บิล ' + wrong.map(function (b) { return b['Bill_No']; }).join(', ') + ' ไม่ใช่ของลูกค้า "' + cust + '" — กดดึงบิลค้างใหม่' };
  const total = bills.reduce(function (s, b) { return s + num(b['ยอดรวม']); }, 0);
  const no = nextCounter('STMT_NEXT', 4, (settingsMap().STMT_PREFIX || 'PKS') + '-' + Utilities.formatDate(new Date(), TZ, 'yyyy') + '-');
  appendObj('Statements', {
    'Stmt_No': no, 'วันที่วาง': today(), 'ลูกค้า': pay.customer, 'จำนวนบิล': bills.length,
    'ยอดรวม': total, 'กำหนดเก็บเงิน': pay.due || '', 'สถานะ': 'รอเก็บ', 'บิลที่รวม': bills.map(function (b) { return b['Bill_No']; }).join(', '), 'หมายเหตุ': pay.note || '',
  });
  bills.forEach(function (b) { updateWhere('Bills', 'Bill_No', b['Bill_No'], { 'สถานะ': 'วางบิลแล้ว', 'Stmt_No': no }); });
  return { ok: true, no: no, total: total, bills: bills, date: today(), due: pay.due || '', customer: pay.customer, settings: settingsMap(), _log: { ref: no, detail: pay.customer + ' ' + bills.length + ' บิล ' + total + ' บ.' } };
}
function stmtDone(pay, me) {
  const st = rowsToObjs('Statements').filter(function (s) { return s['Stmt_No'] === pay.no; })[0];
  if (!st) return { ok: false, error: 'ไม่พบใบวางบิล ' + pay.no };
  if (st['สถานะ'] === 'เก็บแล้ว') return { ok: true, already: true };
  updateWhere('Statements', 'Stmt_No', pay.no, { 'สถานะ': 'เก็บแล้ว' });
  String(st['บิลที่รวม']).split(',').map(function (s) { return s.trim(); }).forEach(function (bn) {
    if (bn) updateWhere('Bills', 'Bill_No', bn, { 'สถานะ': 'ชำระแล้ว', 'ชำระเมื่อ': today(), 'ช่องทางชำระ': pay.channel || '', 'ผู้ทำ': me.name });
  });
  return { ok: true, _log: { ref: pay.no, detail: st['ลูกค้า'] + ' ' + st['ยอดรวม'] + ' บ.' } };
}

// ─── ลูกค้า / ราคา ───
function custSave(pay, me) {
  const name = String(pay.name || '').trim();
  if (!name) return { ok: false, error: 'ไม่มีชื่อ' };
  const all = rowsToObjs('Customers');
  const exist = all.filter(function (c) { return String(c['ชื่อลูกค้า']).trim() === name; })[0];
  if (exist) {
    if (pay.tel || pay.addr || pay.creditDays) updateWhere('Customers', 'Customer_ID', exist['Customer_ID'], { 'เบอร์โทร': pay.tel || exist['เบอร์โทร'], 'ที่อยู่': pay.addr || exist['ที่อยู่'], 'เครดิต(วัน)': pay.creditDays || exist['เครดิต(วัน)'] });
    return { ok: true, id: exist['Customer_ID'] };
  }
  const id = seq('CUST_NEXT', 'C', 4);
  appendObj('Customers', { 'Customer_ID': id, 'ชื่อลูกค้า': name, 'เบอร์โทร': pay.tel || '', 'ที่อยู่': pay.addr || '', 'เครดิต(วัน)': pay.creditDays || '', 'สร้างเมื่อ': now() });
  return { ok: true, id: id, _log: { ref: id, detail: name } };
}
function priceSet(pay, me) {
  const all = rowsToObjs('Products');
  const exist = all.filter(function (x) { return String(x['ชื่อสินค้า']).trim() === String(pay.name).trim(); })[0];
  const newPrice = Number(pay.price);
  if (!pay.name || isNaN(newPrice)) return { ok: false, error: 'ต้องมีชื่อสินค้าและราคา' };
  let id, oldPrice = '';
  if (exist) {
    id = exist['Product_ID'];
    oldPrice = exist['ราคา/หน่วย'];
    updateWhere('Products', 'Product_ID', id, { 'ราคา/หน่วย': newPrice, 'หน่วย': pay.unit || exist['หน่วย'], 'สถานะ': pay.status || exist['สถานะ'] || 'ใช้งาน', 'จุดเตือน': pay.alert !== undefined ? pay.alert : exist['จุดเตือน'] });
  } else {
    id = seq('PROD_NEXT', 'P', 4);
    appendObj('Products', { 'Product_ID': id, 'ชื่อสินค้า': String(pay.name).trim(), 'หน่วย': pay.unit || '', 'ราคา/หน่วย': newPrice, 'หมายเหตุ': pay.note || '', 'คงเหลือ': 0, 'จุดเตือน': pay.alert || '', 'สถานะ': 'ใช้งาน' });
  }
  appendObj('PriceHistory', { 'วันที่': now(), 'Product_ID': id, 'ชื่อสินค้า': String(pay.name).trim(), 'ราคาเดิม': oldPrice, 'ราคาใหม่': newPrice, 'ผู้ปรับ': me.name, 'หมายเหตุ': pay.note || '' });
  return { ok: true, id: id, oldPrice: oldPrice, newPrice: newPrice, _log: { ref: id, detail: pay.name + ' ' + (oldPrice !== '' ? oldPrice + '→' : 'ตั้ง ') + newPrice } };
}

// ─────────────────────────────────────────────
// ข้อมูลรวมสำหรับแอปทีม (เรียกครั้งเดียวได้ทุกอย่าง)
// ─────────────────────────────────────────────
function teamData(p, me) {
  const orders = rowsToObjs('Orders');
  const active = orders.filter(function (o) { return ['ส่งแล้ว', 'ยกเลิก'].indexOf(o['สถานะ']) < 0; });
  const recentDone = orders.filter(function (o) { return o['สถานะ'] === 'ส่งแล้ว'; }).slice(-10).reverse();
  const notJob = function (j) { return j['สถานะ'] !== 'เสร็จ' && j['สถานะ'] !== 'ยกเลิก'; };
  const billable = orders.filter(function (o) { return ['พร้อมส่ง', 'ส่งบางส่วน', 'ส่งแล้ว'].indexOf(o['สถานะ']) >= 0 && !o['Bill_No']; });
  // คิวส่ง: ออเดอร์ที่ยังมีของค้างส่ง
  const custs = rowsToObjs('Customers');
  const custBy = {}; custs.forEach(function (c) { custBy[String(c['ชื่อลูกค้า']).trim()] = c; });
  const dAll = deliveredMapAll_();
  const deliverQueue = active.map(function (o) {
    let items = []; try { items = JSON.parse(o['รายการ'] || '[]'); } catch (e) {}
    const d = dAll[o['Order_ID']] || {};
    const pool = {};
    items.forEach(function (it) {
      const k = it.pid || it.name;
      pool[k] = pool[k] || { pid: it.pid, name: it.name, ordered: 0 };
      pool[k].ordered += it.qty;
    });
    const remain = Object.keys(pool).map(function (k) {
      const sent = d[k] || 0;
      return { pid: pool[k].pid, name: pool[k].name, ordered: pool[k].ordered, sent: sent, remain: pool[k].ordered - sent };
    }).filter(function (r) { return r.remain > 0; });
    const c = custBy[String(o['ลูกค้า']).trim()] || {};
    return remain.length ? { id: o['Order_ID'], customer: o['ลูกค้า'], tel: c['เบอร์โทร'] || '', addr: c['ที่อยู่'] || '', due: o['กำหนดส่ง'], status: o['สถานะ'], remain: remain } : null;
  }).filter(Boolean).sort(function (a, b) { return String(a.due || '9999').localeCompare(String(b.due || '9999')); });
  let myAtt = null;
  if (me.via === 'pin') myAtt = rowsToObjs('Attendance').filter(function (a) { return String(a['วันที่']) === today() && a['Staff_ID'] === me.id; })[0] || null;
  return {
    ok: true, version: CODE_VERSION, me: { id: me.id, name: me.name, nick: me.nick, dept: me.dept, via: me.via },
    customers: custs, products: rowsToObjs('Products').filter(function (p2) { return (p2['สถานะ'] || 'ใช้งาน') !== 'เลิกขาย'; }),
    settings: settingsMap(),
    orders: active.reverse().concat(recentDone),
    production: rowsToObjs('Production').filter(notJob).reverse(),
    screens: rowsToObjs('ScreenJobs').filter(notJob).reverse(),
    billable: billable.map(function (o) { return { id: o['Order_ID'], customer: o['ลูกค้า'], total: o['ยอดรวม'] }; }),
    deliverQueue: deliverQueue,
    bills: activeBills_().reverse().slice(0, 25),
    stmts: rowsToObjs('Statements').filter(function (s) { return s['สถานะ'] === 'รอเก็บ'; }).reverse(),
    materials: rowsToObjs('Materials'),
    myAtt: myAtt,
    wasteReasons: WASTE_REASONS,
  };
}

// ─────────────────────────────────────────────
// บอร์ดบริหาร
// ─────────────────────────────────────────────
function dueOf_(b, creditBy) {
  if (b['กำหนดชำระ']) return String(b['กำหนดชำระ']);
  const days = Number(creditBy[String(b['ลูกค้า']).trim()]) || 30;
  const d = String(b['วันที่']);
  if (!/^\d{4}-\d{2}-\d{2}/.test(d)) return '';   // บิลนำเข้าเก่าวันที่รูปแบบอื่น = ไม่นับเลยกำหนด (ดีกว่าบอร์ดล่ม)
  const t = new Date(d.slice(0, 10) + 'T00:00:00+07:00').getTime() + days * 86400000;
  if (isNaN(t)) return '';
  return Utilities.formatDate(new Date(t), TZ, 'yyyy-MM-dd');
}
function execData() {
  const bills = activeBills_();
  const orders = rowsToObjs('Orders');
  const prod = rowsToObjs('Production');
  const scr = rowsToObjs('ScreenJobs');
  const stmts = rowsToObjs('Statements');
  const products = rowsToObjs('Products');
  const materials = rowsToObjs('Materials');
  const staff = staffPublic();
  const custs = rowsToObjs('Customers');
  const month = Utilities.formatDate(new Date(), TZ, 'yyyy-MM');
  const td = today();
  const d30 = daysFromNow(-30);
  const creditBy = {}; custs.forEach(function (c) { creditBy[String(c['ชื่อลูกค้า']).trim()] = c['เครดิต(วัน)']; });

  let mCash = 0, mCredit = 0, tSales = 0, arTotal = 0, overdueSum = 0, overdueCount = 0;
  const arByCust = {}, daily = {}, custMonth = {}, cashToday = {};
  bills.forEach(function (b) {
    const d = String(b['วันที่']);
    const amt = num(b['ยอดรวม']);
    if (d.slice(0, 7) === month) {
      if (b['ประเภท'] === 'เครดิต') mCredit += amt; else mCash += amt;
      custMonth[b['ลูกค้า']] = (custMonth[b['ลูกค้า']] || 0) + amt;
    }
    if (d === td) tSales += amt;
    if (b['สถานะ'] === 'ค้างชำระ' || b['สถานะ'] === 'วางบิลแล้ว') {
      arTotal += amt;
      arByCust[b['ลูกค้า']] = (arByCust[b['ลูกค้า']] || 0) + amt;
      const due = dueOf_(b, creditBy);
      if (due && due < td) { overdueSum += amt; overdueCount++; }
    }
    const chan = String(b['ช่องทางชำระ'] || '').trim();
    if (String(b['ชำระเมื่อ']) === td && (chan === 'เงินสด' || (!chan && b['ประเภท'] === 'เงินสด'))) cashToday[b['ผู้ทำ'] || '(ไม่ระบุ)'] = (cashToday[b['ผู้ทำ'] || '(ไม่ระบุ)'] || 0) + amt;
    if (d.length >= 10 && d >= d30) daily[d.slice(0, 10)] = (daily[d.slice(0, 10)] || 0) + amt;
  });
  const top = function (m2) { return Object.keys(m2).map(function (k) { return { name: k, amt: m2[k] }; }).sort(function (a, b) { return b.amt - a.amt; }).slice(0, 10); };
  const last30 = [];
  for (let i = 29; i >= 0; i--) {
    const dd = daysFromNow(-i);
    last30.push({ d: dd.slice(5), amt: daily[dd] || 0 });
  }

  // แจ้งเตือน
  const lateOrders = orders.filter(function (o) { return ['ส่งแล้ว', 'ยกเลิก'].indexOf(o['สถานะ']) < 0 && o['กำหนดส่ง'] && String(o['กำหนดส่ง']) < td; })
    .map(function (o) { return { id: o['Order_ID'], customer: o['ลูกค้า'], due: o['กำหนดส่ง'], status: o['สถานะ'] }; });
  const lateStmts = stmts.filter(function (s) { return s['สถานะ'] === 'รอเก็บ' && s['กำหนดเก็บเงิน'] && String(s['กำหนดเก็บเงิน']) < td; })
    .map(function (s) { return { no: s['Stmt_No'], customer: s['ลูกค้า'], due: s['กำหนดเก็บเงิน'], amt: num(s['ยอดรวม']) }; });
  const lowStock = products.filter(function (p2) { return (p2['สถานะ'] || 'ใช้งาน') !== 'เลิกขาย' && (num(p2['คงเหลือ']) < 0 || (p2['จุดเตือน'] !== '' && num(p2['คงเหลือ']) <= num(p2['จุดเตือน']))); })
    .map(function (p2) { return { name: p2['ชื่อสินค้า'], bal: num(p2['คงเหลือ']), min: num(p2['จุดเตือน']), kind: 'สินค้า' }; })
    .concat(materials.filter(function (m2) { return m2['จุดสั่งซื้อ'] !== '' && num(m2['คงเหลือ']) <= num(m2['จุดสั่งซื้อ']); })
      .map(function (m2) { return { name: m2['ชื่อวัตถุดิบ'], bal: num(m2['คงเหลือ']), min: num(m2['จุดสั่งซื้อ']), kind: 'วัตถุดิบ' }; }));
  const att = tailSince_('Attendance', 'วันที่', d30, 400);
  const attToday = att.filter(function (a) { return String(a['วันที่']) === td; });
  const attOpen = att.filter(function (a) { return a['เข้า'] && !a['ออก'] && String(a['วันที่']) < td; }).slice(-15);

  // ผลิต 30 วัน + ของเสียตามสาเหตุ + ผลงานรายคน
  const plogs = tailSince_('ProductionLogs', 'เมื่อ', d30, 800).filter(function (l) { return String(l['เมื่อ']).slice(0, 10) >= d30; });
  let good30 = 0, waste30 = 0;
  const wasteBy = {}, byStaff = {};
  plogs.forEach(function (l) {
    good30 += num(l['ดี']); waste30 += num(l['เสีย']);
    if (num(l['เสีย'])) wasteBy[l['สาเหตุเสีย'] || 'ไม่ระบุ'] = (wasteBy[l['สาเหตุเสีย'] || 'ไม่ระบุ'] || 0) + num(l['เสีย']);
    const k = l['ผู้ลง'] || '(ไม่ระบุ)';
    byStaff[k] = byStaff[k] || { good: 0, waste: 0, logs: 0 };
    byStaff[k].good += num(l['ดี']); byStaff[k].waste += num(l['เสีย']); byStaff[k].logs++;
  });
  const attByStaff = {};
  att.filter(function (a) { return String(a['วันที่']) >= d30 && a['เข้า']; }).forEach(function (a) {
    attByStaff[a['ชื่อ']] = (attByStaff[a['ชื่อ']] || 0) + 1;
  });
  const staff30 = staff.filter(function (s) { return s['สถานะ'] === 'ทำงาน'; }).map(function (s) {
    const w = byStaff[s['ชื่อ']] || { good: 0, waste: 0, logs: 0 };
    return { name: s['ชื่อ'], dept: s['แผนก'], days: attByStaff[s['ชื่อ']] || 0, logs: w.logs, good: w.good, waste: w.waste };
  });
  const adjust30 = tailSince_('StockMoves', 'เมื่อ', d30, 500).filter(function (m2) { return (m2['ประเภท'] === 'ปรับยอด' || m2['ประเภท'] === 'ของเสีย') && String(m2['เมื่อ']).slice(0, 10) >= d30; }).slice(-30).reverse();

  const orderCounts = {};
  orders.forEach(function (o) { orderCounts[o['สถานะ']] = (orderCounts[o['สถานะ']] || 0) + 1; });

  return {
    ok: true, version: CODE_VERSION, month: month,
    kpi: { monthTotal: mCash + mCredit, monthCash: mCash, monthCredit: mCredit, todaySales: tSales, arTotal: arTotal, overdueSum: overdueSum, overdueCount: overdueCount },
    arTop: top(arByCust), custTop: top(custMonth), orderCounts: orderCounts,
    queues: {
      prodWait: prod.filter(function (j) { return j['สถานะ'] === 'รอผลิต'; }).length,
      prodDoing: prod.filter(function (j) { return j['สถานะ'] === 'กำลังผลิต'; }).length,
      scrWait: scr.filter(function (j) { return j['สถานะ'] === 'รอสกรีน'; }).length,
      scrDoing: scr.filter(function (j) { return j['สถานะ'] === 'กำลังสกรีน'; }).length,
    },
    stmtsWait: stmts.filter(function (s) { return s['สถานะ'] === 'รอเก็บ'; }).length,
    daily30: last30,
    alerts: { lateOrders: lateOrders, lateStmts: lateStmts, lowStock: lowStock, attOpen: attOpen },
    prod30: { good: good30, waste: waste30, wasteBy: Object.keys(wasteBy).map(function (k) { return { reason: k, qty: wasteBy[k] }; }).sort(function (a, b) { return b.qty - a.qty; }) },
    staffToday: attToday, staff30: staff30, staffList: staff,
    cashToday: Object.keys(cashToday).map(function (k) { return { name: k, amt: cashToday[k] }; }),
    stock: { products: products.filter(function (p2) { return (p2['สถานะ'] || 'ใช้งาน') !== 'เลิกขาย'; }), materials: materials },
    adjust30: adjust30,
    activity: tailObjs('ActivityLog', 25).reverse(),
    recentOrders: orders.slice(-8).reverse(),
    products: products, priceHistory: tailObjs('PriceHistory', 30).reverse(),
  };
}

// ─────────────────────────────────────────────
// Web API — GET: ?action=...&token=... (หรือ &key=...)[&payload=JSON]
// mutating ทุกตัวอยู่ใน lock เดียว + ลง ActivityLog อัตโนมัติ
// ─────────────────────────────────────────────
function jsonOut(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
const ACT_LABEL = {
  pkLogin: 'เข้าสู่ระบบ', pkOrderSave: 'ลงออเดอร์', pkOrderEdit: 'แก้ออเดอร์', pkOrderCancel: 'ยกเลิกออเดอร์',
  pkJobStart: 'เริ่มงาน', pkProdLog: 'ลงผลผลิต', pkJobClose: 'ปิดงาน', pkDeliver: 'ส่งของ',
  pkBillCreate: 'ออกบิล', pkBillPay: 'รับชำระ', pkBillCancel: 'ยกเลิกบิล', pkStmtCreate: 'สร้างใบวางบิล', pkStmtDone: 'ปิดใบวางบิล',
  pkCustSave: 'บันทึกลูกค้า', pkStockIn: 'รับของเข้า', pkStockCount: 'นับ/ปรับสต๊อก', pkClock: 'ลงเวลา',
  pkPriceSet: 'ปรับราคา', pkStaffSave: 'บันทึกพนักงาน', pkAttFix: 'แก้เวลาเข้าออก',
};
function ACTIONS() {
  return {
    pkHealth: { auth: 'none', fn: function () { return { ok: true, version: CODE_VERSION, sheet: !!prop('PK_SHEET_ID') }; } },
    pkLogin: { auth: 'none', mut: true, fn: function (pay) { return login(pay); } },
    pkTeamData: { auth: 'team', fn: function (pay, me, p) { return teamData(p, me); } },
    pkBills: { auth: 'team', fn: function (pay, me, p) { return { ok: true, bills: billList(p) }; } },
    pkOrderSave: { auth: 'team', mut: true, fn: orderSave },
    pkOrderEdit: { auth: 'team', mut: true, fn: orderEdit },
    pkOrderCancel: { auth: 'team', mut: true, fn: orderCancel },
    pkJobStart: { auth: 'team', mut: true, fn: jobStart },
    pkProdLog: { auth: 'team', mut: true, fn: prodLog },
    pkJobClose: { auth: 'team', mut: true, fn: jobClose },
    pkDeliver: { auth: 'team', mut: true, fn: deliver },
    pkBillCreate: { auth: 'team', mut: true, depts: ['ออฟฟิศ', 'บริหาร'], fn: billCreate },
    pkBillPay: { auth: 'team', mut: true, depts: ['ออฟฟิศ', 'บริหาร'], fn: billPay },
    pkBillCancel: { auth: 'team', mut: true, depts: ['ออฟฟิศ', 'บริหาร'], fn: billCancel },
    pkStmtCreate: { auth: 'team', mut: true, depts: ['ออฟฟิศ', 'บริหาร'], fn: stmtCreate },
    pkStmtDone: { auth: 'team', mut: true, depts: ['ออฟฟิศ', 'บริหาร'], fn: stmtDone },
    pkCustSave: { auth: 'team', mut: true, fn: custSave },
    pkStockIn: { auth: 'team', mut: true, fn: stockIn },
    pkStockCount: { auth: 'team', mut: true, depts: ['ผลิต', 'ออฟฟิศ', 'บริหาร'], fn: stockCount },
    pkClock: { auth: 'team', mut: true, fn: clock },
    pkExec: { auth: 'exec', fn: function () { return execData(); } },
    pkPriceSet: { auth: 'exec', mut: true, fn: priceSet },
    pkPriceHistory: { auth: 'exec', fn: function (pay, me, p) { return { ok: true, history: tailObjs('PriceHistory', Number(p.limit) || 100).reverse() }; } },
    pkStaffSave: { auth: 'exec', mut: true, fn: staffSave },
    pkAttFix: { auth: 'exec', mut: true, fn: attFix },
  };
}
function doGet(e) {
  const p = (e && e.parameter) || {};
  const a = p.action || '';
  try {
    const spec = ACTIONS()[a];
    if (!spec) return jsonOut({ ok: false, error: 'ไม่รู้จัก action: ' + a });
    let me = null;
    if (spec.auth !== 'none') {
      me = who(p);
      if (!me) return jsonOut({ ok: false, error: 'ยังไม่ได้ล็อกอิน หรือรหัส/token หมดอายุ', needLogin: true });
      if (spec.auth === 'exec' && me.via !== 'exec') return jsonOut({ ok: false, error: 'เฉพาะผู้บริหาร' });
      if (spec.depts && me.via === 'pin' && spec.depts.indexOf(String(me.dept).trim()) < 0) return jsonOut({ ok: false, error: 'สิทธิ์ไม่พอ (แผนก ' + me.dept + ') — ให้ออฟฟิศ/ผู้บริหารทำรายการนี้' });
    }
    const pay = p.payload ? JSON.parse(p.payload) : {};
    let result;
    if (spec.mut) {
      const lock = LockService.getScriptLock();
      if (!lock.tryLock(20000)) return jsonOut({ ok: false, error: 'ระบบคิวแน่น — ลองใหม่อีกครั้ง', retry: true });
      try {
        // idempotency: request เดิม (กดซ้ำ/คิว replay/response หลุด) คืนผลเดิม ไม่ทำซ้ำ
        const rid = pay && pay._rid ? 'rid:' + a + ':' + pay._rid : '';
        const cache = rid ? CacheService.getScriptCache() : null;
        if (rid) {
          const hit = cache.get(rid);
          if (hit) return jsonOut(JSON.parse(hit));
        }
        result = spec.fn(pay, me, p);
        if (result && result.ok && a !== 'pkHealth') {
          const idn = (a === 'pkLogin' && result.me) ? { name: result.me.name, via: 'pin' } : (me || {});
          appendObj('ActivityLog', {
            'เมื่อ': now(), 'ใคร': idn.name || '', 'ช่องทาง': idn.via || '',
            'การกระทำ': ACT_LABEL[a] || a, 'อ้างอิง': (result._log && result._log.ref) || '',
            'รายละเอียด': (result._log && result._log.detail) || '',
          });
        }
        if (rid && result && result.ok) {
          const copy = JSON.parse(JSON.stringify(result));
          delete copy._log;
          try { cache.put(rid, JSON.stringify(copy), 21600); } catch (e2) {}
        }
      } finally { lock.releaseLock(); }
    } else {
      result = spec.fn(pay, me, p);
    }
    if (result && result._log) delete result._log;
    return jsonOut(result);
  } catch (err) {
    return jsonOut({ ok: false, error: String(err && err.message || err) });
  }
}

// ─────────────────────────────────────────────
// นำเข้าข้อมูลเก่าจาก "ระบบบัญชี" (รันครั้งเดียวใน editor — อ่านอย่างเดียว)
// ─────────────────────────────────────────────
function importLegacyAccounting(srcId) {
  srcId = srcId || LEGACY_SNAPSHOT_ID;
  const src = SpreadsheetApp.openById(srcId);
  let bills = 0, ar = 0, customers = 0;
  const outBills = [], outCust = [];   // สะสมไว้เขียนทีเดียวตอนจบ (ดู appendObjs)
  const seenCust = {};
  rowsToObjs('Customers').forEach(function (c) { seenCust[String(c['ชื่อลูกค้า']).trim()] = true; });
  let custCount = Object.keys(seenCust).length;
  const seenBill = {};
  rowsToObjs('Bills').forEach(function (b) { seenBill[String(b['Bill_No'])] = true; });   // รันซ้ำได้ ไม่เบิ้ล
  src.getSheets().forEach(function (sh) {
    const v = sh.getDataRange().getValues();
    if (v.length < 2) return;
    let h = -1;
    for (let i = 0; i < Math.min(v.length, 10); i++) {
      if (v[i].map(String).indexOf('เลขที่บิล') >= 0 || v[i].map(String).indexOf('รายชื่อลูกค้า') >= 0) { h = i; break; }
    }
    if (h < 0) return;
    const head = v[h].map(String);
    const tabName = sh.getName();
    if (head.indexOf('รายชื่อลูกค้า') >= 0) {
      const nc = head.indexOf('รายชื่อลูกค้า');
      for (let i = h + 1; i < v.length; i++) {
        const name = String(v[i][nc]).trim();
        if (!name || seenCust[name]) continue;
        seenCust[name] = true; custCount++;
        outCust.push({ 'Customer_ID': 'C' + ('000' + custCount).slice(-4), 'ชื่อลูกค้า': name, 'สร้างเมื่อ': now() });
        customers++;
      }
      return;
    }
    const isAR = head.indexOf('ยอดค้าง') >= 0;
    const iDate = head.indexOf('วันที่') >= 0 ? head.indexOf('วันที่') : 0;
    const iNo = head.indexOf('เลขที่บิล');
    const iName = head.indexOf('ชื่อลูกค้า');
    for (let i = h + 1; i < v.length; i++) {
      const r = v[i];
      const name = String(r[iName] || '').trim();
      const no = String(r[iNo] || '').trim();
      if (!name || !no || no === 'เลขที่บิล') continue;
      if (seenBill['เก่า-' + tabName + '-' + no]) continue;
      seenBill['เก่า-' + tabName + '-' + no] = true;
      const rawDate = r[iDate] instanceof Date ? Utilities.formatDate(r[iDate], TZ, 'yyyy-MM-dd') : String(r[iDate] || '').trim();
      if (isAR) {
        const owe = num(r[head.indexOf('ยอดค้าง')]);
        const status = String(r[head.indexOf('สถานะ')] || '').trim();
        if (!owe) continue;
        outBills.push({
          'Bill_No': 'เก่า-' + tabName + '-' + no, 'วันที่': rawDate, 'ลูกค้า': name, 'ยอดรวม': owe, 'ประเภท': 'เครดิต',
          'สถานะ': (status.indexOf('จ่าย') >= 0 || status.indexOf('ชำระ') >= 0 || status.indexOf('เก็บ') >= 0) ? 'ชำระแล้ว' : 'ค้างชำระ',
          'ช่องทางชำระ': String(r[head.indexOf('ช่องทางชำระ')] || ''), 'หมายเหตุ': String(r[head.indexOf('หมายเหตุ')] || ''), 'ที่มา': 'นำเข้า:' + tabName,
        });
        ar++;
      } else {
        const cash = num(r[head.indexOf('เงินสด')]);
        const credit = num(r[head.indexOf('เครดิต')]);
        if (!cash && !credit) continue;
        outBills.push({
          'Bill_No': 'เก่า-' + tabName + '-' + no, 'วันที่': rawDate, 'ลูกค้า': name, 'ยอดรวม': cash + credit,
          'ประเภท': credit ? 'เครดิต' : 'เงินสด', 'ช่องทางชำระ': String(r[head.indexOf('ช่องทางชำระ')] || ''),
          'สถานะ': credit ? 'ค้างชำระ' : 'ชำระแล้ว', 'ชำระเมื่อ': credit ? '' : rawDate,
          'หมายเหตุ': String(r[head.indexOf('หมายเหตุ')] || ''), 'ที่มา': 'นำเข้า:' + tabName,
        });
        bills++;
        if (name !== 'สด' && name !== 'สดเซล' && !seenCust[name]) {
          seenCust[name] = true; custCount++;
          outCust.push({ 'Customer_ID': 'C' + ('000' + custCount).slice(-4), 'ชื่อลูกค้า': name, 'สร้างเมื่อ': now() });
          customers++;
        }
      }
    }
  });
  // เขียนลงชีตทีเดียวจบ (2 เรียก API แทนหลักพัน) — ตายกลางทางแล้วรันซ้ำได้ ไม่เบิ้ล เพราะ seenBill/seenCust กรองของเดิมไว้แล้ว
  appendObjs('Customers', outCust);
  appendObjs('Bills', outBills);

  // seed ตัวนับลูกค้า กัน custSave ออก Customer_ID ชนกับที่ import มา
  const stg = tab('Settings');
  const sv = stg.getDataRange().getValues();
  let seeded = false;
  for (let i = 1; i < sv.length; i++) {
    if (String(sv[i][0]) === 'CUST_NEXT') { stg.getRange(i + 1, 2).setValue(Math.max(Number(sv[i][1]) || 1, custCount + 1)); seeded = true; break; }
  }
  if (!seeded) stg.appendRow(['CUST_NEXT', custCount + 1]);
  Logger.log('นำเข้าเสร็จ: บิล ' + bills + ' · ลูกหนี้เครดิต ' + ar + ' · ลูกค้าใหม่ ' + customers);
  Logger.log('⚠️ แท็บเครดิตกับแท็บบิลรายวันอาจมีบิลซ้ำกัน — เช็คก่อนใช้ยอดย้อนหลังจริงจัง');
}

function doPost(e) { return doGet(e); }
// รันจาก editor เมื่อสงสัยว่ารหัสผู้บริหารหลุด — ได้รหัสใหม่ทันที (แจ้งผู้บริหารทุกคน)
function rotateExecKey() {
  const k = Utilities.getUuid().replace(/-/g, '');
  setProp('PK_EXEC_KEY', k);
  Logger.log('PK_EXEC_KEY ใหม่: ' + k);
}
function healthCheck() {
  Logger.log('P&K System ' + CODE_VERSION + ' · PK_SHEET_ID=' + (prop('PK_SHEET_ID') ? 'ตั้งแล้ว' : 'ยังไม่ตั้ง — รัน setupPkSystem()'));
  Logger.log('PK_KEY=' + (prop('PK_KEY') ? 'ตั้งแล้ว' : 'ยังไม่ตั้ง') + ' · PK_EXEC_KEY=' + (prop('PK_EXEC_KEY') ? 'ตั้งแล้ว' : 'ยังไม่ตั้ง'));
}
