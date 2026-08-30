/**
 * 💵 การเงินโรงขวด — GAS backend
 * =====================================================================
 * โปรเจกต์ GAS แยกของตัวเอง (ห้ามปนกับ GAS เลขา / โรงน้ำ / Old Days)
 * ชีทหลังบ้าน = ชีทเช็คเงินจ่ายบิลตัวเดิมของฝ่ายการเงิน (ไม่ย้ายไฟล์)
 *
 * Script Properties ที่ต้องตั้ง (File > Project Settings > Script Properties):
 *   SPREADSHEET_ID = 1OXqLgj4xUNJTXE6g5fPI4fPVRx599pLpzZU6EV9VDxE
 *   APP_KEY        = รหัสเข้าแอป (ตั้งเอง แล้วส่งลิงก์ ?key=รหัส ให้ฝ่ายการเงิน)
 *
 * หลักการซิงก์: บิล 1 ใบ = 1 แถวในแท็บ App_Bills (สร้างให้เองถ้ายังไม่มี)
 *   - ช่อง "เครดิต" มียอด → ขึ้นรายการเครดิตค้างอัตโนมัติ ไม่ต้องคัดลอกไปแท็บอื่น
 *   - กด "รับชำระ" ในแอป → อัปเดตสถานะในแถวเดิม จบในที่เดียว
 *   - แท็บเก่าทั้งหมด (บัญชีส่งเงิน / รายการเครดิต รายเดือน) อ่านอย่างเดียว ไม่แตะต้อง
 *   - นำเข้าข้อมูลเก่า: legacyScan (ดูก่อน) / legacyImport (นำเข้าจริง, รันซ้ำได้ไม่ซ้ำแถว)
 */

const CODE_VERSION = 'bottle-fin 2026-08-29a';
const TZ = 'Asia/Bangkok';
const BILLS_SHEET = 'App_Bills';
const HEADERS = ['ID', 'วันที่', 'เลขที่บิล', 'ชื่อลูกค้า', 'เงินสด', 'เครดิต', 'ช่องทางชำระ',
  'สถานะเครดิต', 'วันที่รับเครดิต', 'ช่องทางรับเครดิต', 'หมายเหตุ', 'ที่มา', 'บันทึกเมื่อ'];

// ───────────────────────── routing ─────────────────────────

function doGet(e) { return handle_(e); }
function doPost(e) { return handle_(e); }

function handle_(e) {
  try {
    const p = (e && e.parameter) || {};
    if (p.action === 'ping') return json_({ ok: true, version: CODE_VERSION });
    const key = String(PropertiesService.getScriptProperties().getProperty('APP_KEY') || '');
    if (!key || String(p.key || '') !== key) return json_({ ok: false, msg: 'รหัสเข้าแอปไม่ถูกต้อง' });

    switch (p.action) {
      case 'data':         return json_(getData_(p));
      case 'save':         return json_(saveBill_(p));
      case 'del':          return json_(deleteBill_(p));
      case 'pay':          return json_(payBills_(p));
      case 'legacyScan':   return json_(legacy_(false));
      case 'legacyImport': return json_(legacy_(true));
      default:             return json_({ ok: false, msg: 'ไม่รู้จัก action: ' + p.action });
    }
  } catch (err) {
    return json_({ ok: false, msg: String(err && err.message || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ───────────────────────── sheet access ─────────────────────────

function ss_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('ยังไม่ได้ตั้ง Script Property: SPREADSHEET_ID');
  return SpreadsheetApp.openById(id);
}

function billsSheet_() {
  const ss = ss_();
  let sh = ss.getSheetByName(BILLS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(BILLS_SHEET);
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

// หาคอลัมน์จากหัวตารางเสมอ — เผื่อมีคนเพิ่ม/สลับคอลัมน์ในชีทเอง
function colMap_(sh) {
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (c) { return String(c).trim(); });
  const m = {};
  HEADERS.forEach(function (h) {
    const i = head.indexOf(h);
    if (i < 0) throw new Error('แท็บ ' + BILLS_SHEET + ' ไม่มีคอลัมน์ "' + h + '" (อย่าลบ/เปลี่ยนชื่อหัวตาราง)');
    m[h] = i;
  });
  return m;
}

// อ่านบิลทั้งหมดเป็น object + จำเลขแถวไว้แก้กลับ
function readBills_() {
  const sh = billsSheet_();
  const m = colMap_(sh);
  const last = sh.getLastRow();
  if (last < 2) return { sh: sh, m: m, rows: [] };
  const vals = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  const rows = [];
  vals.forEach(function (v, i) {
    const id = String(v[m['ID']] || '').trim();
    if (!id) return;
    rows.push({
      row: i + 2, id: id,
      d: iso_(v[m['วันที่']]),
      no: String(v[m['เลขที่บิล']] === '' ? '' : v[m['เลขที่บิล']]).trim(),
      cus: String(v[m['ชื่อลูกค้า']] || '').trim(),
      cash: amt_(v[m['เงินสด']]),
      credit: amt_(v[m['เครดิต']]),
      ch: String(v[m['ช่องทางชำระ']] || '').trim(),
      st: String(v[m['สถานะเครดิต']] || '').trim(),
      payD: iso_(v[m['วันที่รับเครดิต']]),
      payCh: String(v[m['ช่องทางรับเครดิต']] || '').trim(),
      note: String(v[m['หมายเหตุ']] || '').trim(),
      src: String(v[m['ที่มา']] || '').trim()
    });
  });
  return { sh: sh, m: m, rows: rows };
}

function writeRow_(sh, m, rowNum, b) {
  const width = sh.getLastColumn();
  const arr = new Array(width).fill('');
  // แถวแก้ไข: อ่านค่าเดิมก่อน กันทับคอลัมน์อื่นที่คนเพิ่มเองในชีท
  if (rowNum > 0) arr.splice(0, width, ...sh.getRange(rowNum, 1, 1, width).getValues()[0]);
  arr[m['ID']] = b.id;
  arr[m['วันที่']] = b.d;
  arr[m['เลขที่บิล']] = b.no;
  arr[m['ชื่อลูกค้า']] = b.cus;
  arr[m['เงินสด']] = b.cash || '';
  arr[m['เครดิต']] = b.credit || '';
  arr[m['ช่องทางชำระ']] = b.ch;
  arr[m['สถานะเครดิต']] = b.st;
  arr[m['วันที่รับเครดิต']] = b.payD;
  arr[m['ช่องทางรับเครดิต']] = b.payCh;
  arr[m['หมายเหตุ']] = b.note;
  arr[m['ที่มา']] = b.src;
  arr[m['บันทึกเมื่อ']] = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
  if (rowNum > 0) sh.getRange(rowNum, 1, 1, width).setValues([arr]);
  else sh.appendRow(arr);
}

// ───────────────────────── helpers ─────────────────────────

function amt_(v) {
  if (v === '' || v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v).replace(/[,\s฿]/g, ''));
  return isNaN(n) ? 0 : n;
}

// คืนค่าวันที่เป็น 'YYYY-MM-DD' — รับได้ทั้ง Date จริงในเซลล์ และตัวหนังสือ
function iso_(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s; // เก็บดิบไว้ ดีกว่าเดาแล้วผิด
}

function pad2_(n) { return ('0' + n).slice(-2); }

// แปลง "2/04", "02/04/2025", "2/4/68" → {d, m, y|null}  (เลขปี พ.ศ. แปลงเป็น ค.ศ. ให้)
function parseThaiDate_(s) {
  const t = String(s).trim().replace(/\./g, '/');
  const mm = t.match(/^(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?$/);
  if (!mm) return null;
  const d = +mm[1], mo = +mm[2];
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  let y = mm[3] ? +mm[3] : null;
  if (y !== null) {
    if (y < 100) y += (y > 60 ? 1900 : 2000);
    if (y > 2400) y -= 543;
  }
  return { d: d, m: mo, y: y };
}

// ───────────────────────── action: data ─────────────────────────
// โหลดครั้งเดียวได้ครบทั้งแอป: บิลของเดือนที่ขอ + เครดิตค้างทั้งหมด + เครดิตที่รับในเดือน + ลูกค้า

function getData_(p) {
  const month = String(p.month || Utilities.formatDate(new Date(), TZ, 'yyyy-MM')).slice(0, 7);
  const all = readBills_().rows;

  const months = {};
  all.forEach(function (b) { if (/^\d{4}-\d{2}/.test(b.d)) months[b.d.slice(0, 7)] = 1; });

  const bills = all.filter(function (b) { return b.d.slice(0, 7) === month; })
    .map(pub_);
  const outstanding = all.filter(function (b) { return b.credit > 0 && b.st !== 'จ่ายแล้ว'; }).map(pub_);
  const paidInMonth = all.filter(function (b) { return b.st === 'จ่ายแล้ว' && b.payD.slice(0, 7) === month; }).map(pub_);

  return {
    ok: true, version: CODE_VERSION, month: month,
    months: Object.keys(months).sort().reverse(),
    bills: bills, outstanding: outstanding, paidInMonth: paidInMonth,
    customers: customers_(all),
    today: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd')
  };
}

function pub_(b) {
  return { id: b.id, d: b.d, no: b.no, cus: b.cus, cash: b.cash, credit: b.credit,
    ch: b.ch, st: b.st, payD: b.payD, payCh: b.payCh, note: b.note, src: b.src };
}

// รายชื่อลูกค้า = แท็บทะเบียนเดิม (คอลัมน์ "รายชื่อลูกค้า") + ชื่อที่เคยออกบิลในแอป
function customers_(allBills) {
  const set = {};
  try {
    ss_().getSheets().forEach(function (sh) {
      if (sh.getName() === BILLS_SHEET) return;
      const vals = sh.getDataRange().getValues();
      for (let r = 0; r < Math.min(vals.length, 8); r++) {
        const c = vals[r].map(function (x) { return String(x).trim(); }).indexOf('รายชื่อลูกค้า');
        if (c < 0) continue;
        for (let i = r + 1; i < vals.length; i++) {
          const name = String(vals[i][c] || '').trim();
          if (name) set[name] = 1;
        }
        return;
      }
    });
  } catch (e) { /* ทะเบียนอ่านไม่ได้ก็ยังใช้ชื่อจากบิลได้ */ }
  (allBills || []).forEach(function (b) { if (b.cus) set[b.cus] = 1; });
  return Object.keys(set).sort();
}

// ───────────────────────── action: save / del / pay ─────────────────────────

function saveBill_(p) {
  const cus = String(p.cus || '').trim();
  const d = String(p.d || '').trim();
  if (!cus) return { ok: false, msg: 'ยังไม่ได้ใส่ชื่อลูกค้า' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { ok: false, msg: 'รูปแบบวันที่ไม่ถูกต้อง' };
  const cash = amt_(p.cash), credit = amt_(p.credit);
  if (cash < 0 || credit < 0) return { ok: false, msg: 'ยอดเงินติดลบไม่ได้' };

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const data = readBills_();
    let b, rowNum = 0;
    if (p.id) {
      b = data.rows.find(function (x) { return x.id === p.id; });
      if (!b) return { ok: false, msg: 'ไม่พบบิลนี้แล้ว (อาจถูกลบไป)' };
      rowNum = b.row;
    } else {
      b = { id: 'B' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        st: '', payD: '', payCh: '', src: 'แอป' };
    }
    b.d = d; b.no = String(p.no || '').trim(); b.cus = cus;
    b.cash = cash; b.credit = credit;
    b.ch = String(p.ch || '').trim(); b.note = String(p.note || '').trim();
    // ซิงก์สถานะเครดิตจากยอด: มีเครดิตแต่ยังไม่เคยตั้งสถานะ → ค้างจ่าย / ไม่มีเครดิตแล้ว → ล้างสถานะ
    if (credit > 0 && !b.st) b.st = 'ค้างจ่าย';
    if (credit <= 0) { b.st = ''; b.payD = ''; b.payCh = ''; }
    writeRow_(data.sh, data.m, rowNum, b);
    return { ok: true, id: b.id, msg: rowNum ? 'แก้ไขบิลแล้ว' : 'บันทึกบิลแล้ว' };
  } finally { lock.releaseLock(); }
}

function deleteBill_(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const data = readBills_();
    const b = data.rows.find(function (x) { return x.id === p.id; });
    if (!b) return { ok: false, msg: 'ไม่พบบิลนี้แล้ว' };
    data.sh.deleteRow(b.row);
    return { ok: true, msg: 'ลบบิลแล้ว' };
  } finally { lock.releaseLock(); }
}

// รับชำระเครดิตทีละหลายบิล (เลือกหลายใบของลูกค้าเดียวกันแล้วกดครั้งเดียวได้)
// revert=1 → ดึงกลับเป็นค้างจ่าย (กดผิด)
function payBills_(p) {
  let ids;
  try { ids = JSON.parse(p.ids || '[]'); } catch (e) { ids = []; }
  if (!ids.length) return { ok: false, msg: 'ไม่ได้เลือกบิล' };
  const revert = String(p.revert || '') === '1';
  const payD = String(p.payD || '').trim();
  if (!revert && !/^\d{4}-\d{2}-\d{2}$/.test(payD)) return { ok: false, msg: 'รูปแบบวันที่รับชำระไม่ถูกต้อง' };

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const data = readBills_();
    let done = 0;
    ids.forEach(function (id) {
      const b = data.rows.find(function (x) { return x.id === id; });
      if (!b || b.credit <= 0) return;
      if (revert) { b.st = 'ค้างจ่าย'; b.payD = ''; b.payCh = ''; }
      else { b.st = 'จ่ายแล้ว'; b.payD = payD; b.payCh = String(p.payCh || '').trim(); }
      writeRow_(data.sh, data.m, b.row, b);
      done++;
    });
    return { ok: true, msg: (revert ? 'ดึงกลับเป็นค้างจ่าย ' : 'รับชำระแล้ว ') + done + ' บิล' };
  } finally { lock.releaseLock(); }
}

// ───────────────────────── นำเข้าข้อมูลเก่า ─────────────────────────
// อ่านแท็บเดิมทุกแท็บ (ไม่แก้ไขอะไรในแท็บเดิมเด็ดขาด):
//   แท็บบัญชีส่งเงิน  = หัวตารางมี เลขที่บิล/ชื่อลูกค้า/เงินสด/เครดิต   → สร้างบิล
//   แท็บรายการเครดิต = หัวตารางมี เลขที่บิล/ชื่อลูกค้า/ยอดค้าง/สถานะ → เติมสถานะจ่ายให้บิลเดิม
// จับคู่กันด้วย (เดือนของบิล + เลขที่บิล) — เครดิตที่หาคู่ไม่เจอ สร้างเป็นบิลเครดิตล้วน
// รันซ้ำได้: แถวที่นำเข้าแล้ว (ID เดิม) จะถูกข้าม

function legacy_(doImport) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const data = readBills_();
    const existing = {};
    data.rows.forEach(function (b) { existing[b.id] = true; });

    const report = [];
    const newBills = [];   // บิลใหม่จากแท็บบัญชีส่งเงิน
    const byKey = {};      // 'YYYY-MM#เลขบิล' → บิล (ทั้งของเดิมในแอปและที่กำลังจะนำเข้า)
    data.rows.forEach(function (b) {
      if (/^\d{4}-\d{2}/.test(b.d) && b.no) byKey[b.d.slice(0, 7) + '#' + b.no] = b;
    });

    const tabs = legacyTabs_();

    // รอบแรก: แท็บบัญชีส่งเงิน (สร้างบิล)
    tabs.filter(function (t) { return t.type === 'ledger'; }).forEach(function (t) {
      let made = 0, skipped = 0, dup = 0, badDate = 0;
      let year = t.year, lastMonth = 0;
      t.rows.forEach(function (r) {
        const no = String(r.no).trim();
        if (!/^\d+$/.test(no)) { skipped++; return; }
        let dISO = '';
        if (r.date instanceof Date && !isNaN(r.date)) {
          dISO = Utilities.formatDate(r.date, TZ, 'yyyy-MM-dd');
          year = r.date.getFullYear(); lastMonth = r.date.getMonth() + 1;
        } else {
          const pd = parseThaiDate_(r.date);
          if (pd) {
            if (pd.y) year = pd.y;
            else if (lastMonth && pd.m < lastMonth - 6) year++; // ข้ามปี (ธ.ค. → ม.ค.)
            lastMonth = pd.m;
            if (year) dISO = year + '-' + pad2_(pd.m) + '-' + pad2_(pd.d);
          }
        }
        if (!dISO) { badDate++; skipped++; return; }
        const id = 'L' + t.idx + 'r' + r.rowNum;
        if (existing[id]) { dup++; return; }
        const b = { id: id, d: dISO, no: no, cus: r.cus, cash: r.cash, credit: r.credit,
          ch: r.ch, st: r.credit > 0 ? 'ค้างจ่าย' : '', payD: '', payCh: '',
          note: r.note, src: 'นำเข้า:' + t.name };
        newBills.push(b);
        byKey[dISO.slice(0, 7) + '#' + no] = b;
        made++;
      });
      report.push({ tab: t.name, type: 'บัญชีส่งเงิน', rows: t.rows.length,
        import: made, already: dup, skip: skipped, badDate: badDate });
    });

    // รอบสอง: แท็บรายการเครดิต (เติมสถานะ / สร้างบิลเครดิตที่หาคู่ไม่เจอ)
    const updates = [];
    tabs.filter(function (t) { return t.type === 'credit'; }).forEach(function (t) {
      let matched = 0, created = 0, dup = 0, skipped = 0;
      let year = t.year, lastMonth = 0;
      t.rows.forEach(function (r) {
        const no = String(r.no).trim();
        if (!/^\d+$/.test(no) && !r.cus) { skipped++; return; }
        // วันที่บิลเดิม
        let dISO = '';
        if (r.date instanceof Date && !isNaN(r.date)) {
          dISO = Utilities.formatDate(r.date, TZ, 'yyyy-MM-dd');
          year = r.date.getFullYear(); lastMonth = r.date.getMonth() + 1;
        } else {
          const pd = parseThaiDate_(r.date);
          if (pd) {
            if (pd.y) year = pd.y;
            else if (lastMonth && pd.m < lastMonth - 6) year++;
            lastMonth = pd.m;
            if (year) dISO = year + '-' + pad2_(pd.m) + '-' + pad2_(pd.d);
          }
        }
        if (!dISO) { skipped++; return; }

        const paid = /จ่ายแล้ว/.test(String(r.status));
        // วันจ่าย: ปีเดาจากวันที่บิล — ถ้าออกมาก่อนวันบิล แปลว่าข้ามปี
        let payISO = '';
        if (paid) {
          if (r.payDate instanceof Date && !isNaN(r.payDate)) {
            payISO = Utilities.formatDate(r.payDate, TZ, 'yyyy-MM-dd');
          } else {
            const pp = parseThaiDate_(r.payDate);
            if (pp) {
              let py = pp.y || +dISO.slice(0, 4);
              let cand = py + '-' + pad2_(pp.m) + '-' + pad2_(pp.d);
              if (!pp.y && cand < dISO) cand = (py + 1) + '-' + pad2_(pp.m) + '-' + pad2_(pp.d);
              payISO = cand;
            }
          }
        }

        const key = dISO.slice(0, 7) + '#' + no;
        const hit = byKey[key];
        if (hit && (!hit.cus || !r.cus || hit.cus === r.cus || hit.credit === r.owe)) {
          // เจอบิลต้นทาง → เติมสถานะ (เฉพาะบิลที่ยังไม่เคยถูกตั้งเป็นจ่ายแล้วในแอป
          // และเขียนกลับเฉพาะเมื่อค่าเปลี่ยนจริง — รันซ้ำจะได้ไม่นับ/ไม่เขียนซ้ำ)
          const nSt = paid ? 'จ่ายแล้ว' : 'ค้างจ่าย';
          const nCh = paid ? String(r.ch || '').trim() : '';
          if (hit.st !== 'จ่ายแล้ว' && (hit.st !== nSt || hit.payD !== payISO || hit.payCh !== nCh)) {
            hit.st = nSt; hit.payD = payISO; hit.payCh = nCh;
            if (hit.row) updates.push(hit); // แถวเดิมในแอป ต้องเขียนกลับ
          }
          matched++;
        } else {
          const id = 'L' + t.idx + 'r' + r.rowNum;
          if (existing[id]) { dup++; return; }
          newBills.push({ id: id, d: dISO, no: no, cus: r.cus, cash: 0, credit: r.owe,
            ch: '', st: paid ? 'จ่ายแล้ว' : 'ค้างจ่าย', payD: payISO,
            payCh: paid ? String(r.ch || '').trim() : '', note: r.note,
            src: 'นำเข้า:' + t.name });
          created++;
        }
      });
      report.push({ tab: t.name, type: 'รายการเครดิต', rows: t.rows.length,
        matched: matched, created: created, already: dup, skip: skipped });
    });

    if (!doImport) {
      return { ok: true, preview: true, report: report, willAdd: newBills.length, willUpdate: updates.length };
    }

    // เขียนจริง: บิลใหม่ต่อท้ายเป็นชุดเดียว + อัปเดตแถวเดิมทีละแถว
    const sh = data.sh, m = data.m;
    if (newBills.length) {
      const width = sh.getLastColumn();
      const now = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
      const block = newBills.map(function (b) {
        const arr = new Array(width).fill('');
        arr[m['ID']] = b.id; arr[m['วันที่']] = b.d; arr[m['เลขที่บิล']] = b.no;
        arr[m['ชื่อลูกค้า']] = b.cus; arr[m['เงินสด']] = b.cash || ''; arr[m['เครดิต']] = b.credit || '';
        arr[m['ช่องทางชำระ']] = b.ch; arr[m['สถานะเครดิต']] = b.st;
        arr[m['วันที่รับเครดิต']] = b.payD; arr[m['ช่องทางรับเครดิต']] = b.payCh;
        arr[m['หมายเหตุ']] = b.note; arr[m['ที่มา']] = b.src; arr[m['บันทึกเมื่อ']] = now;
        return arr;
      });
      sh.getRange(sh.getLastRow() + 1, 1, block.length, width).setValues(block);
    }
    updates.forEach(function (b) { writeRow_(sh, m, b.row, b); });

    return { ok: true, report: report, added: newBills.length, updated: updates.length,
      msg: 'นำเข้าแล้ว ' + newBills.length + ' บิล / อัปเดตสถานะ ' + updates.length + ' บิล' };
  } finally { lock.releaseLock(); }
}

// สแกนทุกแท็บหา "หัวตาราง" ของสองแบบฟอร์มเดิม (หัวอาจไม่อยู่แถวแรก เพราะมีแถว merge คั่น)
function legacyTabs_() {
  const out = [];
  ss_().getSheets().forEach(function (sh, idx) {
    const name = sh.getName();
    if (name === BILLS_SHEET) return;
    const vals = sh.getDataRange().getValues();
    for (let r = 0; r < Math.min(vals.length, 8); r++) {
      const head = vals[r].map(function (c) { return String(c).trim(); });
      const iNo = head.indexOf('เลขที่บิล'), iCus = head.indexOf('ชื่อลูกค้า');
      if (iNo < 0 || iCus < 0) continue;
      const iCash = head.indexOf('เงินสด'), iCred = head.indexOf('เครดิต');
      const iOwe = head.indexOf('ยอดค้าง'), iSt = head.indexOf('สถานะ');
      const iCh = head.indexOf('ช่องทางชำระ'), iNote = head.indexOf('หมายเหตุ');
      let iDate = head.indexOf('วันที่');
      if (iDate < 0) iDate = Math.max(0, iNo - 1); // บางแท็บช่องวันที่ในหัวตารางเป็นค่าขยะ

      // เดาปีจากชื่อแท็บ เช่น "รายการเครดิต ก.ค. 2024" / "2568"
      let year = null;
      const ym = name.match(/(\d{4})/);
      if (ym) { year = +ym[1]; if (year > 2400) year -= 543; if (year < 2015 || year > 2100) year = null; }

      const rows = [];
      for (let i = r + 1; i < vals.length; i++) {
        const v = vals[i];
        const cus = String(v[iCus] || '').trim();
        const no = v[iNo] === '' || v[iNo] === null ? '' : String(v[iNo]).trim();
        if (!cus && !no) continue; // แถวว่างคั่นวัน / แถวสรุป
        rows.push({
          rowNum: i + 1, date: v[iDate], no: no, cus: cus,
          cash: iCash >= 0 ? amt_(v[iCash]) : 0,
          credit: iCred >= 0 ? amt_(v[iCred]) : 0,
          owe: iOwe >= 0 ? amt_(v[iOwe]) : 0,
          status: iSt >= 0 ? String(v[iSt] || '').trim() : '',
          payDate: (iSt >= 0 && iSt + 1 < v.length) ? v[iSt + 1] : '',
          ch: iCh >= 0 ? String(v[iCh] || '').trim() : '',
          note: iNote >= 0 ? String(v[iNote] || '').trim() : ''
        });
      }
      if (iCash >= 0 && iCred >= 0) out.push({ idx: idx, name: name, type: 'ledger', year: year, rows: rows });
      else if (iOwe >= 0 && iSt >= 0) out.push({ idx: idx, name: name, type: 'credit', year: year, rows: rows });
      break;
    }
  });
  return out;
}
