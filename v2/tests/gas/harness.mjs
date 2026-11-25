// ============================================================
//  รัน gas/Code.gs จริงใน Node (vm) กับชีตจำลองในหน่วยความจำ — ไม่แตะ Google จริง ไม่ยิงเน็ต
//  จำลองเฉพาะบริการที่ Code.gs ใช้: SpreadsheetApp · PropertiesService · CacheService · LockService · Utilities · ContentService · Logger · ScriptApp
//  ชีตที่ตั้ง readonly = เขียนเมื่อไหร่ throw ทันที (ใช้พิสูจน์ "ห้ามเขียนกลับชีทบัญชี/ชีต AppSheet")
//  เวลา + UUID คุมได้ (เทียบผลสองรุ่นของโค้ดแบบตรงตัว)
// ============================================================
import vm from "node:vm";
import crypto from "node:crypto";

const TZ_MS = 7 * 3600000;
const pad = (n, w) => String(n).padStart(w || 2, "0");
function formatDate(d, tz, fmt) {
  const x = new Date(d.getTime() + TZ_MS);   // Asia/Bangkok คงที่
  return fmt.replace(/yyyy|yy|MM|dd|HH|mm|ss/g, t => ({
    yyyy: x.getUTCFullYear(), yy: pad(x.getUTCFullYear() % 100), MM: pad(x.getUTCMonth() + 1), dd: pad(x.getUTCDate()),
    HH: pad(x.getUTCHours()), mm: pad(x.getUTCMinutes()), ss: pad(x.getUTCSeconds()),
  })[t]);
}
const signed = buf => Array.from(buf, b => (b > 127 ? b - 256 : b));
const toBuf = x => (typeof x === "string" ? Buffer.from(x, "utf8") : Buffer.from(Array.from(x, b => b & 255)));

class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = this.sh.data[this.r - 1 + i] || [];
      const o = [];
      for (let j = 0; j < this.nc; j++) { const v = row[this.c - 1 + j]; o.push(v === undefined || v === null ? "" : v); }
      out.push(o);
    }
    return out;
  }
  getValue() { return this.getValues()[0][0]; }
  setValues(vals) {
    this.sh.write("setValues");
    for (let i = 0; i < vals.length; i++) for (let j = 0; j < vals[i].length; j++) this.sh.set(this.r + i, this.c + j, vals[i][j]);
    return this;
  }
  setValue(v) { this.sh.write("setValue"); this.sh.set(this.r, this.c, v); return this; }
  setNumberFormat() { this.sh.write("setNumberFormat"); return this; }
}
class Sheet {
  constructor(book, name, data) { this.book = book; this.name = name; this.data = (data || []).map(r => r.slice()); }
  write(what) { if (this.book.readonly) throw new Error("เขียนชีตอ่านอย่างเดียว! (" + this.book.id + " › " + this.name + " · " + what + ")"); this.book.writes++; }
  set(r, c, v) { while (this.data.length < r) this.data.push([]); const row = this.data[r - 1]; while (row.length < c) row.push(""); row[c - 1] = v; }
  getName() { return this.name; }
  getLastRow() { let n = this.data.length; while (n > 0 && this.data[n - 1].every(v => v === "" || v === null || v === undefined)) n--; return n; }
  getLastColumn() { return this.data.reduce((m, r) => { let n = r.length; while (n > 0 && (r[n - 1] === "" || r[n - 1] == null)) n--; return Math.max(m, n); }, 0); }
  getMaxRows() { return Math.max(1000, this.data.length); }
  getRange(r, c, nr, nc) { return new Range(this, r, c, nr || 1, nc || 1); }
  getDataRange() { return new Range(this, 1, 1, this.getLastRow(), this.getLastColumn()); }
  appendRow(row) { this.write("appendRow"); this.data.splice(this.getLastRow(), 0, row.slice()); }
  setFrozenRows() { this.write("setFrozenRows"); }
}
class Book {
  constructor(id, name, readonly) { Object.assign(this, { id, name, readonly: !!readonly, sheets: [], writes: 0 }); }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  getSheets() { return this.sheets.slice(); }
  insertSheet(n) { if (this.readonly) throw new Error("insertSheet บนชีตอ่านอย่างเดียว " + this.id); const s = new Sheet(this, n, []); this.sheets.push(s); this.writes++; return s; }
  deleteSheet(s) { if (this.readonly) throw new Error("deleteSheet บนชีตอ่านอย่างเดียว"); this.sheets = this.sheets.filter(x => x !== s); }
  getId() { return this.id; }
  getUrl() { return "https://docs.google.com/spreadsheets/d/" + this.id; }
  addSheet(name, data) { const s = new Sheet(this, name, data); this.sheets.push(s); return s; }
  dump() { return Object.fromEntries(this.sheets.map(s => [s.name, s.data.map(r => r.slice(0, s.getLastColumn()))])); }
}

/** โหลด Code.gs (ข้อความ) → { ctx, books, call(action, params, body), setNow, props, logs } */
export function loadGas(source, opt) {
  const o = opt || {};
  const books = new Map();
  let created = 0, uuid = 0;
  const props = Object.assign({}, o.props || {});
  const cache = new Map();
  const logs = [];
  const clock = { now: o.now || Date.UTC(2026, 10, 16, 2, 0, 0) };
  const sp = {
    getProperty: k => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = String(v); return sp; },
    deleteProperty: k => { delete props[k]; return sp; },
  };
  const ctx = {
    console, JSON, Math, Number, String, Object, Array, Error, RegExp, Boolean, isNaN, isFinite, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
    SpreadsheetApp: {
      openById: id => { const b = books.get(id); if (!b) throw new Error("ไม่พบสเปรดชีต " + id); return b; },
      create: name => { const b = new Book("created-" + (++created), name); books.set(b.id, b); b.addSheet("Sheet1", []); return b; },
    },
    PropertiesService: { getScriptProperties: () => sp },
    CacheService: { getScriptCache: () => ({ get: k => (cache.has(k) ? cache.get(k) : null), put: (k, v) => cache.set(k, String(v)), remove: k => cache.delete(k) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => true, releaseLock: () => {} }) },
    Utilities: {
      formatDate,
      getUuid: () => "00000000-0000-4000-8000-" + String(++uuid).padStart(12, "0"),
      Charset: { UTF_8: "UTF-8" },
      computeHmacSha256Signature: (value, key) => signed(crypto.createHmac("sha256", toBuf(key)).update(toBuf(value)).digest()),
      base64EncodeWebSafe: x => toBuf(x).toString("base64").replace(/\+/g, "-").replace(/\//g, "_"),
      base64DecodeWebSafe: s => signed(Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64")),
      newBlob: bytes => ({ getDataAsString: () => toBuf(bytes).toString("utf8") }),
    },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: s => ({ content: s, setMimeType() { return this; }, getContent() { return this.content; } }) },
    Logger: { log: m => logs.push(String(m)) },
    ScriptApp: { getScriptId: () => "script-test-id", getProjectTriggers: () => [], deleteTrigger: () => {}, newTrigger: () => ({ timeBased: () => ({ everyDays: () => ({ atHour: () => ({ create: () => {} }) }) }) }) },
  };
  vm.createContext(ctx);
  vm.runInContext(`(() => { const R = Date; globalThis.__clock = { now: ${clock.now} };
    class D extends R { constructor(...a) { if (a.length) super(...a); else super(globalThis.__clock.now); } static now() { return globalThis.__clock.now; } }
    globalThis.Date = D; })();`, ctx);
  vm.runInContext(source, ctx, { filename: "Code.gs" });
  const G = {
    ctx, books, props, logs, cache,
    setNow(ms) { ctx.__clock.now = ms; },
    tick(ms) { ctx.__clock.now += ms; },
    book(id, name, readonly) { const b = new Book(id, name || id, readonly); books.set(id, b); return b; },
    /** เรียก doGet/doPost เหมือนเว็บแอปจริง → JSON */
    call(action, params, body) {
      const e = { parameter: Object.assign({ action }, params || {}) };
      if (body !== undefined) e.postData = { contents: typeof body === "string" ? body : JSON.stringify(body), type: "text/plain" };
      const out = body !== undefined ? ctx.doPost(e) : ctx.doGet(e);
      return JSON.parse(out.getContent());
    },
    run(fnName, ...args) { return ctx[fnName](...args); },
  };
  return G;
}
