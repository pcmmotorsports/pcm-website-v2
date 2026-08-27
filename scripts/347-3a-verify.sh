#!/usr/bin/env bash
# ============================================================
# scripts/347-3a-verify.sh — #347-3a `admin_search_orders` 日期範圍的**行為層**驗證。
#
# 🔴 **為什麼需要它**(codex 關卡1 2026-08-10 must-fix):migration 自己的斷言只驗
#    catalog 與 ACL —— **把日期述詞整段刪掉、把 `>=` 改成 `<=`、或把八個 OR 的括號漏掉,
#    那些斷言一條都不會紅**。日期範圍是本片存在的全部理由,不能只有結構證據。
#
# 用法:
#   scripts/d1t2-rehearsal.sh provision /tmp/347-3a-work   # 先建庫(印 D1_DB_URL)
#   PORT=54342 scripts/347-3a-verify.sh
#
# ── ⚠️ 它擋不住什麼(誠實邊界,照 347-1-verify.sh 的既有寫法)────────────────────
# · 本機是 **vanilla PG17,不是 Supabase**:沒有 PostgREST ⇒ 「省略參數呼叫得通嗎」
#   「service_role 走 HTTP 打得通嗎」**一格都測不到**。那半只有 apply 當下的斷言 + 收割端真站 smoke。
# · 沒有測時區換算(那在 3b adapter,不在 DB 函式裡)。
# · 沒有測效能。
#
# ── 🔴 突變測試怎麼還原(本檔與 347-1-verify.sh 不同,別照抄那邊的作法)────────────
# 347-1 的 harness 靠「重跑 migration」還原,因為那支是 `CREATE OR REPLACE`。
# **#347-3a 不可重跑** —— 它開頭是 `DROP FUNCTION public.admin_search_orders(text, integer)`
# 且**刻意沒有 `IF EXISTS`**(舊簽章必須存在,不存在代表前提被推翻、該停下來看)。
# ⇒ 在已套用 3a 的庫上重跑會 42883。還原路徑:
#     DROP FUNCTION public.admin_search_orders(text,integer,timestamptz,timestamptz);
#     psql -f supabase/migrations/20260809180000_…347_1_….sql      # 回填兩參數版
#     psql -f supabase/migrations/20260810120000_…347_3a_….sql     # 再套 3a
# (2026-08-10 實測走過這條;最保險還是重跑 provision。)
#
# ── 已跑過的突變(2026-08-10,每發都紅在對的格子)──────────────────────────────
# A. 日期兩條述詞改成 `(TRUE)` ⇒ FAIL=4(§2 兩格 + §3 一格 + §5 料號那格)
# B. `o.created_at < p_to` 改成 `<=` ⇒ FAIL=1,**只紅** §3 的「p_to 正好等於錨 ⇒ 錨被排除」
#    —— 半開/全閉這一軸有獨立判別力,不是被別的格子順帶蓋住。
# ============================================================
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

URL="postgresql://postgres@127.0.0.1:${PORT:-54342}/postgres"
FN4="public.admin_search_orders(text, integer, timestamptz, timestamptz)"
MIGFILE="supabase/migrations/20260810120000_m4b_347_3a_admin_search_orders_date_range.sql"
PASS=0; FAIL=0; SKIP=0
# 🔴 **期望格數釘死**(codex 關卡1 R2 must-fix 2):退出狀態原本只看 FAIL
#    ⇒ 把任何一格 `check` 刪掉會得到 PASS=11 FAIL=0、**exit 0**,「12 格」就只是註解不是守門。
#    改一格就要動這個數字 —— 那正是重點:守門的規模本身要被守。
EXPECT_CHECKS=12

q() { psql "$URL" -qtA -v ON_ERROR_STOP=1 -c "$1" 2>&1; }

# 🔴 **布林一律期望 `t` 不是 `true`**(memory `reference_psql-ta-boolean-cast-renders-true-not-t`):
#    `psql -qtA` 印**裸 bool** 是 `t`,只有 `::text` 轉型後才是 `true`。
#    我第一版寫 `true`,五格當場「紅」而程式其實是對的 —— 比錯不報錯,
#    同一支腳本裡兩種寫法混用就是這條的觸發條件,所以本檔**全部用裸 bool + 期望 `t`**。
check() { # check <名稱> <期望> <實得>
  if [ "$2" = "$3" ]; then
    PASS=$((PASS+1)); echo "  ✅ $1"
  else
    FAIL=$((FAIL+1)); echo "  ❌ $1 — 期望 [$2]、實得 [$3]"
  fi
}

echo "── #347-3a 行為層驗證 @ $URL ──"

# ── 🔴 身分閘(codex 關卡1 R2 must-fix 1/4):三件事都要對,錯一件就停 ──────────
#    ① 連得上 ② 是**拋棄庫**(data_directory 在 /tmp 底下)③ 庫裡真的是本片的**精確四參數簽章**
#    為什麼:沒有這道閘,連到別窗的相容叢集**照樣印出一片綠**——而那是在測別人的東西。
#    (347-1-verify 的撞庫事故就是這個形狀;`$FN4`/`$MIGFILE` 原本宣告了卻沒用到,現在用上。)
DATADIR=$(q "SHOW data_directory;")
case "$DATADIR" in
  /tmp/*) : ;;
  *) echo "⛔ data_directory=[$DATADIR] 不在 /tmp 底下 —— 這不像拋棄庫,拒跑(別在真庫上測)。" >&2; exit 2 ;;
esac
if [ "$(q "SELECT count(*) FROM pg_catalog.pg_proc WHERE oid = '${FN4}'::regprocedure;" 2>/dev/null)" != "1" ]; then
  echo "⛔ 這個庫沒有 ${FN4} —— 先 apply ${MIGFILE}(或重跑 provision)。" >&2
  exit 2
fi
echo "  庫:${DATADIR}"

# 準備:找一張已知的單,用它的 display_id 當搜尋詞、created_at 當時間錨。
ANCHOR_ID=$(q "SELECT id FROM public.orders ORDER BY created_at DESC, id DESC LIMIT 1;")
ANCHOR_DISPLAY=$(q "SELECT display_id FROM public.orders WHERE id='${ANCHOR_ID}';")
ANCHOR_TS=$(q "SELECT created_at FROM public.orders WHERE id='${ANCHOR_ID}';")
if [ -z "$ANCHOR_ID" ]; then
  echo "🔴 假資料沒有訂單,無法驗行為層(先跑 d1t2-rehearsal.sh provision)"; exit 2
fi
echo "  錨:${ANCHOR_DISPLAY} @ ${ANCHOR_TS}"

# ── 1. 向後相容:兩個日期皆 NULL ⇒ 回傳與「只給兩參數」逐字相同 ──────────────────
# 🔴 這條擋的是「日期述詞寫成恆假」之類把功能整個弄壞的改法。
A=$(q "SELECT public.admin_search_orders('${ANCHOR_DISPLAY}', 100, NULL, NULL)::text;")
B=$(q "SELECT public.admin_search_orders('${ANCHOR_DISPLAY}', 100)::text;")
check "皆 NULL 與省略參數結果相同" "$A" "$B"
check "皆 NULL 時找得到錨那張單" "t" "$(q "SELECT (public.admin_search_orders('${ANCHOR_DISPLAY}', 100, NULL, NULL) -> 'ids') @> to_jsonb(ARRAY['${ANCHOR_ID}']::text[]);")"

# ── 2. 🔴 日期述詞真的在篩(這是刪掉它會紅的那一格)──────────────────────────
# 錨之後的那一刻當起點 ⇒ 錨必須被排除。
check "p_from 在錨之後 ⇒ 錨被排除" "0" \
  "$(q "SELECT jsonb_array_length(public.admin_search_orders('${ANCHOR_DISPLAY}', 100, '${ANCHOR_TS}'::timestamptz + interval '1 microsecond', NULL) -> 'ids');")"
check "p_from 正好等於錨 ⇒ 錨仍在(>= 是含下界)" "t" \
  "$(q "SELECT (public.admin_search_orders('${ANCHOR_DISPLAY}', 100, '${ANCHOR_TS}'::timestamptz, NULL) -> 'ids') @> to_jsonb(ARRAY['${ANCHOR_ID}']::text[]);")"

# ── 3. 🔴 半開區間:p_to 是**排除**的那一端 ────────────────────────────────────
# 這兩格一起釘住 `<` 而不是 `<=`;把 `<` 改成 `<=` ⇒ 第一格紅。
check "p_to 正好等於錨 ⇒ 錨被排除(< 是不含上界)" "0" \
  "$(q "SELECT jsonb_array_length(public.admin_search_orders('${ANCHOR_DISPLAY}', 100, NULL, '${ANCHOR_TS}'::timestamptz) -> 'ids');")"
check "p_to 在錨之後一微秒 ⇒ 錨在" "t" \
  "$(q "SELECT (public.admin_search_orders('${ANCHOR_DISPLAY}', 100, NULL, '${ANCHOR_TS}'::timestamptz + interval '1 microsecond') -> 'ids') @> to_jsonb(ARRAY['${ANCHOR_ID}']::text[]);")"

# ── 4. 反向範圍:回零筆、**不擲例外** ─────────────────────────────────────────
check "p_from > p_to ⇒ 零筆不擲例外" "0" \
  "$(q "SELECT jsonb_array_length(public.admin_search_orders('${ANCHOR_DISPLAY}', 100, now(), now() - interval '1 day') -> 'ids');")"

# ── 5. 🔴 日期述詞套在**深路徑維度**上(括號有沒有把八個 OR 全包住)────────────
# 🔴 **範圍誠實**(codex 關卡1 R2 must-fix 2 打回我的第一版):我原本寫「全部八維度」,
#    實際只驗了料號一條 ⇒ 把**供應商單號**那個 `OR EXISTS` 搬到日期括號外,原本那版照樣全綠。
#    現在驗**兩條**最深的路徑:料號(orders→order_items)與供應商單號
#    (orders→order_items→order_item_procurement,巢狀最深、也是 codex 點名的那條)。
#    ⚠️ 仍**不是**八維度全覆蓋:①訂單編號由 §1-4 各格順帶驗到,②③會員姓名/電話與 ④ 收件快照
#    在現行 fixture 裡沒有可用資料 ⇒ **那四條沒有行為證據**,只有 migration 的括號結構在守。
#    要補就得讓 harness 自己建那些 fixture,那是下一片的事,不在這裡假裝已覆蓋。
SKU=$(q "SELECT oi.variant_sku FROM public.order_items oi JOIN public.orders o ON o.id=oi.order_id WHERE oi.variant_sku IS NOT NULL AND oi.variant_sku <> '' ORDER BY o.created_at DESC LIMIT 1;")
if [ -n "$SKU" ]; then
  check "料號維度也吃日期(未來起點 ⇒ 零筆)" "0" \
    "$(q "SELECT jsonb_array_length(public.admin_search_orders('${SKU}', 100, now() + interval '1 day', NULL) -> 'ids');")"
  check "料號維度不給日期時找得到" "t" \
    "$(q "SELECT jsonb_array_length(public.admin_search_orders('${SKU}', 100, NULL, NULL) -> 'ids') > 0;")"
else
  # 🔴 跳過**不是通過**(codex 關卡1 R2 must-fix 3):畫面上印得再誠實,自動流程只看退出狀態
  #    ⇒ 沒有這行 SKIP 累加,缺 fixture 會被當成「全綠」。
  SKIP=$((SKIP+1))
  echo "  ⚠️ 假資料沒有 variant_sku ⇒ 料號維度那兩格**跳過**(不是通過)"
fi

# 供應商單號維度:fixture 沒有 ⇒ **自己建一筆**(冪等;值取一個真實資料不可能撞的字面)。
SUP_NO="ZZ-347-3A-PROBE"
ITEM_ID=$(q "SELECT oi.id FROM public.order_items oi JOIN public.orders o ON o.id=oi.order_id ORDER BY o.created_at DESC LIMIT 1;")
if [ -n "$ITEM_ID" ]; then
  # `supplier_id` 是 NOT NULL(2026-08-10 實測踩到:第一版沒給它,INSERT 靜默失敗
  # ⇒ 「不給日期找得到」那格紅、而「吃日期回零筆」那格**恆真假綠**(沒資料當然回 0)。
  # 這正是 fixture 缺值把整軸變成裝飾品的形狀 —— 兩格一起看才戳得破。)
  SUP_ID=$(q "SELECT id FROM public.suppliers LIMIT 1;")
  if [ -z "$SUP_ID" ]; then
    SKIP=$((SKIP+1)); echo "  ⚠️ 沒有 suppliers ⇒ 供應商單號那兩格**跳過**(不是通過)"; ITEM_ID=""
  else
    q "INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity, supplier_order_no)
       VALUES ('${ITEM_ID}', '${SUP_ID}', 1, '${SUP_NO}');" >/dev/null
  fi
fi
if [ -n "$ITEM_ID" ]; then
  check "供應商單號維度不給日期時找得到" "t" \
    "$(q "SELECT jsonb_array_length(public.admin_search_orders('${SUP_NO}', 100, NULL, NULL) -> 'ids') > 0;")"
  # 🔴 這一格就是 codex 點名的逃逸路徑:把那個 OR EXISTS 搬到日期括號外 ⇒ 只有這格會紅。
  check "供應商單號維度也吃日期(未來起點 ⇒ 零筆)" "0" \
    "$(q "SELECT jsonb_array_length(public.admin_search_orders('${SUP_NO}', 100, now() + interval '1 day', NULL) -> 'ids');")"
else
  SKIP=$((SKIP+1))
  echo "  ⚠️ 沒有 order_items ⇒ 供應商單號那兩格**跳過**(不是通過)"
fi

# ── 6. 截斷語意不受日期影響 ───────────────────────────────────────────────────
check "p_limit=1 且命中多筆 ⇒ truncated=true" "t" \
  "$(q "SELECT (public.admin_search_orders('PCM', 1, NULL, NULL) ->> 'truncated')::boolean;")"

echo
echo "── 結果:PASS=${PASS} FAIL=${FAIL} SKIP=${SKIP}(期望格數 ${EXPECT_CHECKS})──"
if [ "$SKIP" -ne 0 ]; then
  echo "⛔ 有 ${SKIP} 組被跳過 —— 跳過不是通過,fixture 不齊就別把它當綠。" >&2
  exit 2
fi
if [ $((PASS+FAIL)) -ne "$EXPECT_CHECKS" ]; then
  echo "⛔ 實跑 $((PASS+FAIL)) 格、期望 ${EXPECT_CHECKS} 格 —— 有人加/刪了格子沒同步 EXPECT_CHECKS。" >&2
  exit 2
fi
[ "$FAIL" -eq 0 ] || exit 1
