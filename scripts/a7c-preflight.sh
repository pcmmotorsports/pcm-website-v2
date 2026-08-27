#!/usr/bin/env bash
# A7c 夜跑前置自檢 —— 無人監督的整晚工作開跑前,先證明環境是乾淨可用的。
#
#   bash scripts/a7c-preflight.sh
#
# 任一項紅 → 退出碼非 0、印出「該怎麼修」。全綠才准開工。
# 🔴 本腳本**唯讀 repo**:只會停掉暫存目錄下的殘留 postmaster,不改任何 repo 檔案、
#    不碰 .env*、不碰正式站。
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
PORT="${PORT:-54329}"
FAIL=0

ok()   { printf '  ✅ %s\n' "$1"; }
bad()  { printf '  ❌ %s\n     ↳ 修法:%s\n' "$1" "$2"; FAIL=$((FAIL+1)); }
note() { printf '  ℹ️  %s\n' "$1"; }

echo "══ A7c 夜跑前置自檢 ══"
cd "$REPO" || { echo "❌ 進不去 repo:$REPO"; exit 1; }

# ── 1. repo 位置與分支 ───────────────────────────────────────────
echo "1) repo 與分支"
[ -f CLAUDE.md ] && [ -d supabase/migrations ] \
  && ok "repo 根 = $REPO" \
  || bad "這不像 pcm-website-v2 的根目錄" "確認 cd 到 /Users/sean_1/pcm-website-v2"

BR="$(git branch --show-current 2>/dev/null)"
[ "$BR" = dev ] && ok "branch = dev" \
  || bad "branch = ${BR:-?}(預期 dev)" "git checkout dev(先確認沒有未 commit 的東西)"

# ── 2. 工作樹乾淨(只允許別線那兩個 untracked 目錄)──────────────
echo "2) 工作樹"
ALLOW='^\?\? (apps/storefront/src/app/dev-preview/mobile-catalog-ux/|docs/superpowers/)$'
DIRTY="$(git status --porcelain | grep -vE "$ALLOW" || true)"
if [ -z "$DIRTY" ]; then
  ok "無非預期改動(別線的 mobile-catalog-ux / superpowers 已排除)"
else
  bad "工作樹有非預期改動:$(printf '%s' "$DIRTY" | tr '\n' ' ')" \
      "先弄清楚是誰的。🔴 另一個 session 並行在同一個工作目錄 —— 不要 reset/stash/清理"
fi

# ── 3. 工具鏈 ────────────────────────────────────────────────────
echo "3) 工具鏈"
if command -v initdb >/dev/null 2>&1; then
  V="$(initdb --version 2>/dev/null)"
  case "$V" in
    *' 17.'*) ok "initdb = $V" ;;
    *) bad "initdb 非 PG17($V)" "正式站是 PG17;PATH 指到別版會讓測試結論不可移植" ;;
  esac
else
  bad "PATH 找不到 initdb" "brew install postgresql@17 並把 bin 加進 PATH"
fi
for t in psql pg_ctl python3; do
  command -v "$t" >/dev/null 2>&1 && ok "$t = $(command -v "$t")" \
    || bad "PATH 找不到 $t" "裝好再開工(harness 全靠它)"
done

# ── 4. 測試埠 54329 ─────────────────────────────────────────────
# 🔴 實錘:d1t2-rehearsal.sh 的 `provision` 子命令**不會**自己清殘留 postmaster
#    (只有 `all` 模式會)⇒ 前一輪沒 teardown 乾淨,下一輪 initdb 直接起不來。
#    這裡先幫它清掉,但**只清 pgdata 在暫存目錄樹下的**,別的一律停手回報。
echo "4) 測試埠 $PORT"
PIDS="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true)"
if [ -z "$PIDS" ]; then
  ok "$PORT 沒人佔用"
else
  for p in $PIDS; do
    DATA="$(ps -o command= -p "$p" 2>/dev/null | sed -n 's/.*-D \([^ ]*\).*/\1/p')"
    case "$DATA" in
      /tmp/*|/private/tmp/*|/var/folders/*|/private/var/folders/*)
        kill -TERM "$p" 2>/dev/null
        for _ in 1 2 3 4 5 6 7 8 9 10; do
          lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1 || break
          command sleep 1
        done
        if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
          bad "殘留 postmaster pid=$p 停不掉(pgdata=$DATA)" "手動 pg_ctl -D $DATA stop -m immediate"
        else
          ok "清掉暫存目錄的殘留 postmaster pid=$p(pgdata=$DATA)"
        fi
        ;;
      *)
        bad "$PORT 被非暫存目錄的行程佔住 pid=$p pgdata=${DATA:-未知}" \
            "🔴 這可能是真的資料庫,不要亂殺。自己確認後手動處理"
        ;;
    esac
  done
fi

# ── 5. 敏感檔沒被動到 ────────────────────────────────────────────
echo "5) 敏感檔"
ENVD="$(git status --porcelain -- '.env*' 2>/dev/null || true)"
[ -z "$ENVD" ] && ok ".env* 無改動" \
  || bad ".env* 出現在 git status" "🔴 絕不提交;先弄清楚為什麼"

# ── 6. 未登記 migration(A7b-T 地雷)──────────────────────────────
# 任何**未 apply** 的 migration 都會在下一次 `supabase db push` 被套上正式站。
# 🔴 2026-08-11(部署 gate 片)改法:原本這裡把「正式站 ledger 最後一筆」**寫死成
#    `20260731120000`**,而實際早已 apply 到 `20260811110000` ⇒ 那個判斷過期了三個月,
#    在那之後落的每一支 migration 都會被它列成「未 apply」= 訊號被自己的雜訊淹掉。
#    改成讀 `supabase/APPLIED.tsv`(部署 gate 片建的可查帳,由 apply 停點的人維護)——
#    **同一本帳只留一份**,不再有第二個會過期的字面。
echo "6) supabase/migrations 未 apply 檔"
PEND="$(for f in supabase/migrations/*.sql; do
          [ -e "$f" ] || continue
          v="${f##*/}"; v="${v%%_*}"
          grep -v '^#' supabase/APPLIED.tsv 2>/dev/null | cut -f1 | grep -qx "$v" || echo "${f##*/}"
        done)"
if [ -z "$PEND" ]; then
  ok "supabase/APPLIED.tsv 已涵蓋所有 migration(零未 apply)"
else
  note "以下檔案未 apply,下次 db push 會一起上正式站:"
  printf '       %s\n' $PEND
  note "這是刻意的就忽略。⚠️ 本檔只比版本號在不在帳上;sha 漂移那一面由 scripts/deploy-order-gate.sh 管"
fi

echo "══ 結果 ══"
if [ "$FAIL" -eq 0 ]; then
  echo "🎉 前置全綠,可以開工。"
  echo "   建庫:bash scripts/d1t2-rehearsal.sh provision /tmp/a7c-\$(date +%H%M%S)"
  exit 0
fi
echo "🛑 $FAIL 項未過 —— 修完再開工,不要繞過。"
exit 1
