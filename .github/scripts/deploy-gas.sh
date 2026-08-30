#!/usr/bin/env bash
# ============================================================
#  deploy-gas.sh — ส่งโค้ด .gs ขึ้น Google Apps Script อัตโนมัติ (รันโดย GitHub Actions)
#  ใช้ token ของเจ้าของบัญชีที่เก็บใน GitHub Secret ชื่อ CLASPRC_JSON
#  ชุดเดียวกับ repo origin-hq (โรงน้ำ) — ที่นั่นใช้มาตั้งแต่ 24 ส.ค. ไม่ต้องก๊อปวางมือแล้ว
# ============================================================
set -euo pipefail

# <โฟลเดอร์>|<Script ID>|<deployment id ที่ทีมใช้ คั่นด้วยช่องว่าง>
#  Script ID ที่ขึ้นต้น __ = ยังไม่เติมของจริง → ระบบข้ามให้เฉย ๆ ไม่ถือว่า fail
#  หา Script ID: เปิดโปรเจกต์ใน script.google.com → ⚙️ Project Settings → คัดลอก "Script ID"
APPS=(
# P&K System — แอปทีมงาน + บอร์ดบริหาร (ชีต PKSystem)
"gas|1ARJwDhIahovJ7rxCNyY93Ey7LH2LbQEXK5NZGLLARujLhkzup_ON61yr|AKfycbw8guY7h7Q_BCfl_RwlD6PQn5fmhXmsu1myjr60OGwbEiAwB_PVE59iAsZmgY9meWH-"
# Bottle Finance — แอปการเงิน (ยังไม่ได้สร้างโปรเจกต์ · ดู finance/README.md)
"finance/gas|__BOTTLE_FINANCE_SCRIPT_ID__|"
)
ALL_DIRS="gas finance/gas"
CODE_RE='(Code\.gs|appsscript\.json)$'

say()   { echo "$@"; }
sumry() { if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "$@" >> "$GITHUB_STEP_SUMMARY"; fi; }

# ---------- 1) เลือกว่าจะ deploy โปรเจกต์ไหน ----------
pick_targets() {
  local mode="${INPUT_APPS:-}"
  if [ -n "$mode" ] && [ "$mode" != "all" ]; then echo "$mode"; return; fi
  if [ "$mode" = "all" ]; then echo "$ALL_DIRS"; return; fi

  local before="${EVENT_BEFORE:-}" changed out="" app
  if [ -z "$before" ] || [ "$before" = "0000000000000000000000000000000000000000" ] \
     || ! git cat-file -e "${before}^{commit}" 2>/dev/null; then
    echo "$ALL_DIRS"; return   # ไม่รู้คอมมิตก่อนหน้า → ทำให้ครบ ปลอดภัยกว่า
  fi
  changed="$(git diff --name-only "$before" "${GITHUB_SHA:-HEAD}" || true)"
  for app in $ALL_DIRS; do
    if echo "$changed" | grep -Eq "^${app}/${CODE_RE}"; then out="$out $app"; fi
  done
  echo "$out"
}

# ---------- 2) manifest: ดึงของจริงจากโปรเจกต์ก่อนเสมอ ----------
# appsscript.json คุมสิทธิ์ web app (Execute as / Who has access) — เดาผิด = ทีมเปิดแอปไม่ได้
# จึงดึงตัวจริงลงมาทับไฟล์สำรองใน repo ก่อน push ทุกครั้ง (ดึงในโฟลเดอร์ทิ้ง ไม่แตะ Code.gs ของเรา)
sync_manifest() {
  local dir="$1" scriptid="$2" tmp
  tmp="$(mktemp -d)"
  printf '{"scriptId":"%s","rootDir":"."}\n' "$scriptid" > "$tmp/.clasp.json"
  if ( cd "$tmp" && clasp pull >/dev/null 2>&1 ) && [ -f "$tmp/appsscript.json" ]; then
    cp "$tmp/appsscript.json" "$dir/appsscript.json"
    say "manifest: ใช้ของจริงจากโปรเจกต์ (clasp pull)"
  else
    say "manifest: ดึงไม่ได้ — ใช้ไฟล์สำรองใน repo ($dir/appsscript.json)"
  fi
  rm -rf "$tmp"
}

deploy_one() {   # $1 โฟลเดอร์ · $2 Script ID · $3 deployment ids
  local dir="$1" scriptid="$2" deps="$3" out ver rc dep body want

  say "→ โปรเจกต์ ...${scriptid: -8}"
  sync_manifest "$dir" "$scriptid"
  # .clasp.json ไม่ขึ้น repo (gitignore) — สร้างชั่วคราวตอนรัน
  printf '{"scriptId":"%s","rootDir":"."}\n' "$scriptid" > "$dir/.clasp.json"

  rc=0
  out="$( cd "$dir" && { clasp push -f 2>&1 || clasp push </dev/null 2>&1; } )" || rc=1
  say "$out"
  if [ $rc -ne 0 ]; then say "::error::clasp push ล้มเหลวที่ $dir (...${scriptid: -8})"; return 1; fi
  # กับดัก: Google ปฏิเสธไฟล์แล้วพิมพ์ "Skipping push." แต่ clasp คืน exit 0
  # → ต้องจับจากข้อความ ไม่ใช่จาก exit code (เจอจริงใน origin-hq run #42)
  if grep -qE "Skipping push\.|Syntax error:" <<<"$out"; then
    say "::error::Google ไม่รับไฟล์ — โค้ดไม่ได้ขึ้นจริง ($dir / ...${scriptid: -8})"
    return 1
  fi

  if [ -z "$deps" ]; then
    say "ยังไม่มี deployment ของโปรเจกต์นี้ — push ขึ้นแล้วแต่ยังไม่ได้เปิดเป็น web app"
    sumry "| \`$dir\` | (ยังไม่มี deployment) | push แล้ว |"
    return 0
  fi

  # ต้องเจอเลขเวอร์ชันของโค้ดที่เพิ่ง push ในคำตอบจริง ไม่ใช่แค่ HTTP 200
  # (หน้า Error ของ GAS ก็ตอบ 200 — เช็คสถานะอย่างเดียวไม่พอ)
  want="$(grep -oE "^const CODE_VERSION = '[^']+'" "$dir/Code.gs" | head -1 | cut -d"'" -f2 || true)"

  for dep in $deps; do
    rc=0
    out="$( cd "$dir" && clasp redeploy "$dep" -d "auto ${GITHUB_SHA:0:7}" 2>&1 )" || rc=1
    if [ $rc -ne 0 ]; then
      rc=0
      out="$( cd "$dir" && clasp redeploy "$dep" 2>&1 )" || rc=1   # clasp บางเวอร์ชันไม่รับ -d
    fi
    say "$out"
    if [ $rc -ne 0 ]; then say "::error::clasp redeploy ล้มเหลว ($dir / $dep)"; return 1; fi
    ver="$(echo "$out" | grep -oE '@[0-9]+' | tail -1)"
    sumry "| \`$dir\` | \`...${dep: -12}\` | **${ver:-?}** |"

    # ---- smoke test: ยิง pkHealth จริง แล้วต้องได้เวอร์ชันที่เพิ่งวาง ----
    if [ -n "$want" ]; then
      body="$( curl -sSL --max-time 45 "https://script.google.com/macros/s/$dep/exec?action=pkHealth" 2>/dev/null || true )"
      if grep -qF "$want" <<<"$body"; then
        say "smoke test ผ่าน — pkHealth ตอบ $want"
      else
        say "::error::smoke test ไม่ผ่าน ($dir) — pkHealth ไม่ตอบ $want"
        say "คำตอบที่ได้: $(printf '%s' "$body" | head -c 300)"
        if grep -qF "Access Denied" <<<"$body"; then
          say "::error::โค้ดขึ้นแล้ว แต่ deployment ไม่เปิดสาธารณะ — GAS: Deploy › Manage deployments › ✏️ › Who has access = Anyone"
        elif grep -qF "Script function not found" <<<"$body"; then
          say "::error::ไม่เจอ doGet — deployment อาจชี้เวอร์ชันเก่า"
        fi
        return 1
      fi
    fi
  done
  return 0
}

deploy_app() {
  local dir="$1" r found=0 fail=0 scriptid deps
  say ""
  say "=============================================="
  say "  $dir"
  say "=============================================="
  for r in "${APPS[@]}"; do
    [ "${r%%|*}" = "$dir" ] || continue
    found=1
    scriptid="$(echo "$r" | cut -d'|' -f2)"
    deps="$(echo "$r" | cut -d'|' -f3)"
    if [ "${scriptid#__}" != "$scriptid" ]; then
      say "⏭ ข้าม $dir — ยังไม่เติม Script ID จริง ($scriptid ใน .github/scripts/deploy-gas.sh)"
      sumry "| \`$dir\` | ยังไม่เติม Script ID | — |"
      continue
    fi
    if ! deploy_one "$dir" "$scriptid" "$deps"; then fail=1; fi
  done
  if [ $found -eq 0 ]; then say "::error::ไม่รู้จักโปรเจกต์ $dir"; return 1; fi
  return $fail
}

# ---------- main ----------
TARGETS="$(pick_targets | tr -s ' ')"
TARGETS="${TARGETS# }"
if [ -z "$TARGETS" ]; then
  say "ไม่มีโค้ด .gs ที่เปลี่ยน — ไม่ต้อง deploy"
  sumry "ไม่มีโค้ด .gs ที่เปลี่ยน — ข้ามการ deploy"
  exit 0
fi
say "จะ deploy: $TARGETS"
say "clasp version: $(clasp --version 2>&1 | tail -1)"
sumry "## 🚀 deploy ขึ้น Apps Script"
sumry ""
sumry "| โปรเจกต์ | deployment | เวอร์ชันใหม่ |"
sumry "|---|---|---|"

FAILED=""
for app in $TARGETS; do
  if ! deploy_app "$app"; then FAILED="$FAILED $app"; fi
done

if [ -n "$FAILED" ]; then
  sumry ""
  sumry "❌ ล้มเหลว:$FAILED"
  say "::error::deploy ล้มเหลว:$FAILED"
  exit 1
fi
sumry ""
sumry "✅ เสร็จเรียบร้อย"
say ""
say "✅ deploy เสร็จทั้งหมด:$TARGETS"
