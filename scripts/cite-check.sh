#!/usr/bin/env bash
# cite-check.sh — 你引的那個 `檔案:行號`，指到的是【資料】還是【散文】？
#
# ┌────────────────────────────────────────────────────────────────────────────┐
# │ 🔴🔴 **先讀這三行，它們是這支工具的天花板。**                              │
# │                                                                            │
# │ 1. **它要人【想起來跑它】⇒ 它仍然是紀律，不是機制。**                      │
# │    真正的機制版本是「引用時只能貼命令輸出」——**那要改的是我們寫報告的     │
# │    手勢，不是加一支腳本**。2026-08-22 主視窗在同一件事上落過一條 memory、   │
# │    承諾三次、又漏兩次 ⇒ **「再寫一條規矩」已被實證對他無效，而一支要人      │
# │    想起來跑的腳本是同一種東西。**                                          │
# │ 2. **擋不住 `SendMessage`** —— 訊息不經過任何檔案。三例裡的第二例           │
# │    (主視窗把「933 件」原封轉給 Sean)**它抓不到**。                        │
# │ 3. **擋不住「註解裡的數字剛好還是對的」** —— 它報的是【證據等級】，         │
# │    **不是真假**。註解裡的歷史數字絕大多數是對的，而且應該留著。            │
# └────────────────────────────────────────────────────────────────────────────┘
#
# ## 它為什麼存在(2026-08-22,一個當天發生的實例)
# `-3c` 對主視窗報「DB 34/933 筆商品指著 placeholder」,而那個數字是從
# `apps/storefront/src/lib/product-jsonld.ts:15` 的**註解**讀來的、屬於別的年代與別的分母。
# 真值是另一個窗當天實查的:商品總數 21,220、群層與變體層都沒有圖的 = **1 件**。
#
# 🔴 **而那一次是【附了出處】的**:
# ```
# 出處有 ✅   檔案:行號 有 ✅   引用逐字 ✅   而結論是錯的 ❌
# ```
# ⇒ **「要附 `檔案:行號`」這條既有規矩對這個病完全無效 —— 它被遵守了。**
# ⇒ 判別句要換一句:**那個 `檔案:行號` 指到的是【一次量測的輸出】,還是【一段人寫的敘述】?**
# ⇒ 而**那一格是可機械判定的**,這支就只做那一格。
#
# ## 刻意不做的
# · **不掛全庫掃描、不掛 CI、不掛 pre-commit。** 註解裡的歷史數字絕大多數是對的
#   ⇒ 掃全庫命中率極差 ⇒ 第一天就紅一片、清不完
#   ⇒ 而**一道今天做不完的閘會訓練人略過它**(backlog `#849` 記的就是這個病)。
# · 不判斷數字對不對、不去讀 DB、不連網。
#
# ## 用法
#   bash scripts/cite-check.sh <path>:<line>
#   bash scripts/cite-check.sh --selftest
#
# ## 回傳碼(四種分得開;慣例對齊 `scripts/where-is.sh`)
#   0 = 那一行**不是**註解 ⇒ 你引的看起來是資料/程式碼
#   3 = 那一行**是**註解   ⇒ 出聲:你引的是散文
#   4 = **這種副檔名我不認得它的註解語法** ⇒ 判不了,不要當成「不是註解」
#   2 = 用法錯
#   1 = 工具自壞 / 讀不到檔或那一行(**前提失敗,當場紅,不安靜回 0**)
set -uo pipefail

usage() {
  echo "用法: bash scripts/cite-check.sh <path>:<line>" >&2
  echo "      bash scripts/cite-check.sh --selftest" >&2
}

judge() {
  python3 - "$1" "$2" <<'PY'
import io, os, sys

path, lineno_s = sys.argv[1], sys.argv[2]

# ── 前提斷言：讀不到 ⇒ rc=1，不要安靜回「不是註解」 ────────────────────────
# 🔴 一個「讀不到檔」與一個「讀到了、而它不是註解」如果都回 0，
#    那這支工具對打錯路徑的人是【恆綠】的。
if not os.path.isfile(path):
    print(f"工具自壞/前提失敗: 讀不到檔 {path}", file=sys.stderr); sys.exit(1)
try:
    lineno = int(lineno_s)
except ValueError:
    print(f"用法錯: 行號不是數字: {lineno_s!r}", file=sys.stderr); sys.exit(2)
if lineno < 1:
    print(f"用法錯: 行號要 >= 1，收到 {lineno}", file=sys.stderr); sys.exit(2)
try:
    lines = io.open(path, encoding='utf-8', errors='replace').read().splitlines()
except OSError as e:
    print(f"工具自壞: 讀檔失敗 {path}: {e}", file=sys.stderr); sys.exit(1)
if lineno > len(lines):
    print(f"前提失敗: {path} 只有 {len(lines)} 行，你引的是第 {lineno} 行", file=sys.stderr); sys.exit(1)

# ── 認得的副檔名 ⇒ 認得的註解形狀。**不認得的要出聲說不認得。** ─────────────
SLASH = {'.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.scss', '.go', '.java', '.c', '.h', '.cpp', '.rs', '.swift', '.kt'}
HASH  = {'.py', '.sh', '.bash', '.zsh', '.yml', '.yaml', '.toml', '.rb', '.pl', '.tf', '.env', '.gitignore'}
SQL   = {'.sql'}
ext = os.path.splitext(path)[1].lower()
if os.path.basename(path).startswith('.') and not ext:
    ext = os.path.basename(path).lower()

if ext not in SLASH | HASH | SQL:
    print(f"判不了: 副檔名 {ext or '(無)'} 的註解語法我不認得 ⇒ **請自己開檔看那一行**")
    print(f"        （這一格刻意不猜 —— 猜錯會把散文判成資料，而那正是本工具要防的方向）")
    sys.exit(4)

raw = lines[lineno - 1]
s = raw.strip()

def verdict(is_comment, why):
    head = raw.strip()[:100]
    if is_comment:
        print("🔴 你引的是【散文】，不是一次量測的輸出。")
        print(f"   {path}:{lineno}  ({why})")
        print(f"   > {head}")
        print("   ⇒ 這個數字的來源是【一段人寫的敘述】。它可能仍然是對的，")
        print("     而它**沒有帶著量測的時點與分母** ⇒ 引用前先自己重量一次，或標「未確認」。")
        sys.exit(3)
    print("這一行不是註解 ⇒ 你引的看起來是資料/程式碼。")
    print(f"   {path}:{lineno}")
    print(f"   > {head}")
    print("   ⚠️ 本工具只答【證據等級】，不答對錯：程式碼裡寫死的常數一樣可能過期。")
    sys.exit(0)

# 行首形狀（四種之三：// 、* 、#）
if ext in SLASH and (s.startswith('//') or s.startswith('/*') or s.startswith('*')):
    return_why = '行首是 //、/* 或 *'
    verdict(True, return_why)
if ext in HASH and s.startswith('#'):
    verdict(True, '行首是 #')
if ext in SQL and s.startswith('--'):
    verdict(True, '行首是 --')

# 第四種：/* … */ 區塊之內（行首看不出來，要從檔頭數未閉合的 /*）
# 🔴 這一段是**近似**：它不理會字串字面裡的 "/*"。
#    誤判方向是【把 code 判成註解】＝ 多出聲，而不是漏出聲 —— 對本工具是安全的那一邊。
if ext in SLASH | SQL:
    head_text = '\n'.join(lines[:lineno - 1])
    depth = 0
    i = 0
    while i < len(head_text) - 1:
        two = head_text[i:i + 2]
        if two == '/*':
            depth += 1; i += 2; continue
        if two == '*/':
            depth = max(0, depth - 1); i += 2; continue
        i += 1
    if depth > 0:
        verdict(True, '在一個尚未閉合的 /* … */ 區塊裡')

verdict(False, '')
PY
}

selftest() {
  local fails=0 tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN

  ck() { # ck <說明> <實際rc> <預期rc>
    if [ "$2" = "$3" ]; then
      echo "  ✅ $1 (rc=$2)"
    else
      echo "  ❌ $1 —— 預期 rc=$3，實得 rc=$2"; fails=$((fails + 1))
    fi
  }
  rc_of() { judge "$1" "$2" >/dev/null 2>&1; echo $?; }

  printf 'const a = 1;\n// 這是一行註解 34/933\nconst b = 2;\n/* 區塊開始\n   還在區塊裡 21220 件\n*/\nconst c = 3;\n' > "$tmp/a.ts"
  printf '# 井字號註解\nX=1\n' > "$tmp/b.sh"
  printf -- '-- SQL 註解\nSELECT 1;\n' > "$tmp/c.sql"
  printf 'random bytes\n' > "$tmp/d.bin"

  echo "[cite-check --selftest]"
  # 🔴 兩個方向都要表演，不是只驗會出聲那一邊
  ck "註解行(//)要出聲"            "$(rc_of "$tmp/a.ts" 2)" 3
  ck "程式碼行要安靜"              "$(rc_of "$tmp/a.ts" 1)" 0
  ck "區塊註解內(第 5 行)要出聲"   "$(rc_of "$tmp/a.ts" 5)" 3
  ck "區塊結束後的 code 要安靜"    "$(rc_of "$tmp/a.ts" 7)" 0
  ck "# 註解要出聲"                "$(rc_of "$tmp/b.sh" 1)" 3
  ck ".sh 的 code 要安靜"          "$(rc_of "$tmp/b.sh" 2)" 0
  ck "-- SQL 註解要出聲"           "$(rc_of "$tmp/c.sql" 1)" 3
  # 前提斷言：三種壞法要各自分得開
  ck "檔不存在 ⇒ 工具自壞 1"       "$(rc_of "$tmp/沒這個檔.ts" 1)" 1
  ck "行號超出檔尾 ⇒ 前提失敗 1"   "$(rc_of "$tmp/a.ts" 9999)" 1
  ck "行號不是數字 ⇒ 用法錯 2"     "$(rc_of "$tmp/a.ts" abc)" 2
  ck "不認得的副檔名 ⇒ 判不了 4"   "$(rc_of "$tmp/d.bin" 1)" 4

  # 🔴 用【真實那一發】當驗收：本工具存在的理由就是它。
  local real="apps/storefront/src/lib/product-jsonld.ts"
  if [ -f "$real" ]; then
    ck "真實案例 product-jsonld.ts:15 要出聲" "$(rc_of "$real" 15)" 3
  else
    echo "  ⚠️ 找不到 $real ⇒ **真實案例那一格沒有跑到**（不是通過，是沒驗）"
    fails=$((fails + 1))
  fi

  if [ "$fails" -eq 0 ]; then
    echo "[cite-check] 自檢全過"
    return 0
  fi
  echo "[cite-check] 🔴 自檢 $fails 格失敗 ⇒ **這支工具現在不可信，不要拿它的輸出當證據**" >&2
  return 1
}

case "${1:-}" in
  --selftest) selftest; exit $? ;;
  '' ) usage; exit 2 ;;
  -h|--help) usage; exit 2 ;;
esac

ARG="$1"
case "$ARG" in
  *:*) : ;;
  *) echo "用法錯: 要 <path>:<line> 的形狀，收到 ${ARG}" >&2; usage; exit 2 ;;
esac
FILE="${ARG%:*}"
LINE="${ARG##*:}"
judge "$FILE" "$LINE"
