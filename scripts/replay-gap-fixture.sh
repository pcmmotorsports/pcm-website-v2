#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# 🔴🔴 **這是【replay 失敗的補丁】, 不是 bootstrap。**
#
#   bootstrap(`docs/runbooks/throwaway-postgres-for-migration-verification.md` §2)
#   只放**平台給的**東西:角色 / `auth` schema / extension / `cron.job`。
#   而本支產出的東西是【migration 自己會建的】—— 它們在拋棄式庫裡不見,
#   **不是因為 bootstrap 少列了它們, 是因為那些 migration 在 replay 時失敗了。**
#
#   🔬 量到的(2026-09-07 線【資料】`-db`, 唯讀對正式庫):
#     · `pcm_noncard_settle_recompute(p_order_id uuid)` 由 **20260904230000** 建(帳本已記)
#     · 194 支函式有 `proconfig`、72 支非內部 trigger —— **全部來自各自的 migration**
#     · 而 replay 今晚的讀數是 **364 支 / 68 支失敗**(線【出貨】`-ship` 量, 我未複驗)
#
#   🛑 **⇒ 把這些寫進 bootstrap 會製造假綠** —— 補完之後閘會變綠, 而綠的原因是
#     我們手動塞了它本來該自己長出來的東西。那正是
#     runbook §0 第 5 條寫的那個不對稱:「環境缺東西 ⇒ 擋住了 ⇒ 我記成產品擋的 ⇒ **假綠**
#     ⇒ **沒有人會去查一個通過的檢查**」。
#
#   ✅ **本支的定位**:讓被擋住的人**今天**跑得動, 而**留下它是補丁的證據**。
#     · 產出的 .sql 第一行就寫「這是 replay 失敗的補丁, 不是 bootstrap」
#     · **不寫進 runbook §2**(主視窗 `-f1` 2026-09-07 裁「丙」)
#     · 真正的修法是 `#907` / `⟦b4-REPLAY1⟧`(從零重建通不通)或改用 schema dump(Q41 待 Sean)
#
#   ⚠️ **它答不出什麼**:它只產出**你點名的那幾個物件**(「只列不猜」)——
#     它**不知道**拋棄式庫還缺什麼。少了哪個, 要由跑的人撞到再加。
#
# 用法:
#   bash scripts/replay-gap-fixture.sh <輸出.sql> <物件名> [物件名 ...]
#   bash scripts/replay-gap-fixture.sh --selftest
# ══════════════════════════════════════════════════════════════════════════════
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"

if [ "${1:-}" = "--selftest" ]; then
  fail=0; n=0
  cell() { n=$((n+1)); if [ "$2" = "$3" ]; then printf '  PASS %s (rc=%s)\n' "$1" "$2"; else printf '  🔴 FAIL %s —— rc=%s 但宣稱是 %s\n' "$1" "$2" "$3"; fail=1; fi; }
  # ① 零參數 ⇒ 用法 + 非零(而不是靜靜產一個空檔)
  bash "$0" >/dev/null 2>&1; cell "零參數 ⇒ 印用法並非零" "$?" "2"
  # ② 只給輸出檔而沒給物件名 ⇒ 也要非零
  bash "$0" /dev/null >/dev/null 2>&1; cell "只有輸出檔、零物件名 ⇒ 非零" "$?" "2"
  # ③ 🔴 判別力:輸出路徑不可寫 ⇒ 必須非零(而不是「產了 0 個物件」那種綠)
  bash "$0" /zzz-no-such-dir/out.sql pcm_noncard_settle_recompute >/dev/null 2>&1
  cell "輸出路徑不可寫 ⇒ 非零(不是靜靜成功)" "$?" "3"
  [ "$fail" = "0" ] && printf '✅ replay-gap-fixture --selftest %s/%s(三格都在問「它會不會靜靜給我一個空檔」)\n' "$n" "$n"
  exit "$fail"
fi

OUT="${1:-}"; shift 2>/dev/null || true
if [ -z "${OUT:-}" ] || [ "$#" -eq 0 ]; then
  printf '用法:bash scripts/replay-gap-fixture.sh <輸出.sql> <物件名> [物件名 ...]\n' >&2
  printf '🔴 一個物件名都沒給 ⇒ **不產空檔** —— 空檔會被讀成「正式庫沒有這些東西」。\n' >&2
  exit 2
fi
# 🔴 下面會 `cd` 去主樹 ⇒ **相對路徑會跑掉** ⇒ 先絕對化(這一行少了會寫到別棵樹去)
OUT="$(cd "$(dirname "$OUT")" 2>/dev/null && pwd)/$(basename "$OUT")"
OUTDIR="$(dirname "$OUT")"
[ -d "$OUTDIR" ] && [ -w "$OUTDIR" ] || { printf '🔴 輸出目錄不存在或不可寫:%s ⇒ 這是【路徑錯】不是【查無】\n' "$OUTDIR" >&2; exit 3; }

# 🔴 只印變數名, 不印值(CLAUDE.md Git 紀律)
# 🔴🔴 **`.env.local` 只在【主樹】** —— worktree 裡沒有它(memory:「worktree 沒有 .env.local,
#    錯誤長得像資料庫掛了」)。⇒ 照 `scripts/readonly-prod-sql.sh:20` 同一個做法, 去主樹載。
#    🔬 這是實撞出來的:第一版寫 `cd "$REPO"`(= 呼叫者所在的那棵樹)⇒ 在 worktree 跑就
#      「沒載到」⇒ 而它**印得夠大聲**(「沒有產, 不是查無」)所以沒有變成一個空檔。
MAIN_TREE=/Users/sean_1/pcm-website-v2
cd "$MAIN_TREE" || exit 3
set -a ; . ./.env.local > /dev/null 2>&1 ; set +a
if [ -z "${PCM_READONLY_DATABASE_URL:-}" ]; then
  printf '🔴 沒載到 PCM_READONLY_DATABASE_URL ⇒ **沒有產, 不是查無**(只印變數名)\n' >&2
  printf '   主樹有沒有 .env.local:%s\n' "$(test -f "$MAIN_TREE/.env.local" && echo 有 || echo 沒有)" >&2
  exit 3
fi

NOW="$(date '+%Y-%m-%d %H:%M:%S %Z')"
TMP="$(mktemp)" || exit 3
{
  printf -- '-- 🔴🔴 這是【replay 失敗的補丁】, 不是 bootstrap;來源 = 正式庫唯讀 catalog 於 %s\n' "$NOW"
  printf -- '--    產生指令:bash scripts/replay-gap-fixture.sh <本檔> %s\n' "$*"
  printf -- '--    🛑 **不要把本檔的內容搬進 runbook §2 的 bootstrap** —— 這裡每一個物件都是\n'
  printf -- '--      【某一支 migration 自己會建的】, 而它們不見是因為那支 migration replay 失敗了。\n'
  printf -- '--    ⚠️ 它只含你點名的那幾個, **不知道還缺什麼**。\n\n'
} > "$TMP"

CNT=0
for OBJ in "$@"; do
  DEF=$(/opt/homebrew/bin/psql "$PCM_READONLY_DATABASE_URL" -X -A -t -c \
    "SELECT string_agg(pg_get_functiondef(p.oid), E';\n\n') FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname='public' AND p.proname = '$OBJ';" 2>/dev/null)
  if [ -z "$DEF" ]; then
    printf -- '-- 🔴 %s:正式庫【查無】⇒ 本檔沒有它(這不是「它不需要」, 是「我找不到」)\n\n' "$OBJ" >> "$TMP"
  else
    printf -- '-- ── %s(逐字取自正式庫 pg_get_functiondef)──────────────────────\n' "$OBJ" >> "$TMP"
    printf '%s;\n\n' "$DEF" >> "$TMP"
    CNT=$((CNT+1))
  fi
done

mv "$TMP" "$OUT" || exit 3
printf '✅ 產出 %s —— 點名 %s 個, 取到 %s 個\n' "$OUT" "$#" "$CNT"
printf '🔵 取到數 < 點名數 ⇒ 差額那幾個在正式庫查無, 檔內逐個標了 🔴。\n'
[ "$CNT" -gt 0 ] || { printf '🔴 一個都沒取到 ⇒ 這個檔沒有用, 不要拿去跑\n' >&2; exit 4; }
