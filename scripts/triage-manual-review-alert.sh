#!/usr/bin/env bash
# scripts/triage-manual-review-alert.sh
#
# 告警「人工待確認(sweeper 放棄:pending 孤兒 / 被讓路轉人工)N 筆」進來時,分辨那 N 筆是哪一類。
#
# 🔴 為什麼需要這支:那個計數是【兩種事故的聯集】,而計數本身不帶 id、分辨不出是哪一種。
#    兩類的處置【相反】:
#      甲 pending 孤兒  ⇒ 走 Record 對帳補結算
#      乙 被讓路轉人工  ⇒ 錢屬於【舊單】,出口是退款(L5b-2)、**不要**去補結算
#    ⇒ 分錯類的代價不是「慢一點」,是「對一張錢已經讓給別人的單去補結算」。
#
# 述詞來源(權威 = migration COMMENT,不是 plan 轉述):
#   supabase/migrations/20260810220000_m4b_lifecycle_l5b0s_supersede_sweeper_ceiling.sql:398
#   get_payment_anomaly_alert_summary 的 attempt_manual_review_count 逐字:
#     needs_manual_review=true AND unpaid
#     AND ( status='pending'                                    <- 甲
#           OR (superseded_at 非 NULL AND status IN(charged,released)) )  <- 乙
#   值班查詢原文 = docs/specs/2026-08-10-l5b-0-supersede-charge-reject-plan.md §4(查詢 A / 查詢 B)
#
# 🔴 這個計數【沒有任何時間條件】—— 它是【盤點】不是【事件】:
#    數的是「現在有幾筆卡著」,不是「上次跑到現在新增幾筆」。
#    ⇒ ① 不要預設「這是新發生的」,它可以是很久以前卡住的(所以本腳本印 created_at 年齡)
#      ② cron 每跑一次就重報一次,直到有人處理掉為止 ⇒「今天又收到」≠「今天又出事」
#    📎 同檔設計者已處理過另一種永久假告警(`20260701120000:23-25` 逐字
#       「markFailed 不清 needs_manual_review、否則收斂成 failed 後仍永遠假告警」)
#       ⇒ 這是同一族的第二個坑,不是有人偷懶。
#
# 🔴🔴 述詞有兩個版本,用錯會【整類漏掉】:
#    ~~20260701120000:68-74~~ 舊版 = 只有 `status='pending'` ⇒ **漏掉整個乙類**
#    ✅ 20260810220000:346-362 改③ = 現行(本腳本用這版),union 兩族
#    該檔自己的註解逐字:「本計數的述詞要求 status='pending' ⇒ 它是 released、**算不進來**
#    ⇒ 改①② 做完仍然沒有任何告警會亮。這一改才是讓『轉人工』真的被看見的那一步。」
#
# 🔴 唯讀:只有 SELECT。不 refund、不 dismissed、不寫任何東西。
#    告警自己就寫「皆為候選、待查證,勿直接退款」。
#

# 🔴🔴 連線字串【不要當參數傳】(2026-08-18 adversarial-reviewer F16):
#    argv 會進【process table】(同機器其他程序 `ps` 看得到)與【shell history】(留在檔案裡)。
#    連線字串含正式庫密碼 ⇒ 那等於把密碼寫進兩個地方,而且都不會有人記得去清。
#    ✅ 正確用法(密碼不進 argv、不進 history):
#         read -rs PGURL && export PGURL      <- 輸入時螢幕不顯示
#         bash scripts/triage-manual-review-alert.sh [告警上的筆數]
#         unset PGURL                          <- 用完清掉
#    ⚠️ 仍然支援用參數傳(不擋),但會印警告 —— 擋掉會讓人在急的時候找不到路。
# 用法:  export PGURL='<postgres 連線字串>' 之後 bash scripts/triage-manual-review-alert.sh [告警上的筆數]
#        第二個參數給了就會對帳:查到的列數 vs 告警說的筆數,不一致會明講。
#
# exit: 0=查到列且已分類 / 3=查無列(與告警不符,要停下查為什麼) / 2=用法錯 / 1=工具自己壞了
set -uo pipefail

# 🔴 參數位置隨 PGURL 有沒有設而不同 —— 不然「export PGURL 之後跑 `… 1`」會把筆數當成連線字串。
if [ -n "${PGURL:-}" ]; then
  CONN="$PGURL"; CLAIMED="${1:-}"          # 建議路徑:連線字串走 env,$1 = 告警筆數
else
  CONN="${1:-}"; CLAIMED="${2:-}"          # 相容路徑:$1 = 連線字串,$2 = 告警筆數
fi
if [ -z "$CONN" ]; then
  echo "用法(建議): read -rs PGURL && export PGURL && bash scripts/triage-manual-review-alert.sh 1 && unset PGURL" >&2
  echo "  (也可以把連線字串當第一個參數傳,但那會留在 shell history)" >&2
  exit 2
fi
if [ -z "${PGURL:-}" ] && [ -n "${1:-}" ]; then
  echo "⚠️  你把連線字串當參數傳了 —— 它會留在 shell history 與 process table。" >&2
  echo "    下次請用:read -rs PGURL && export PGURL   然後不帶參數跑;用完 unset PGURL" >&2
fi
command -v psql > /dev/null 2>&1 || { echo "🔴 工具問題:找不到 psql,這不是查詢結果" >&2; exit 1; }

SQL="
SELECT CASE WHEN a.status = 'pending' THEN '甲' ELSE '乙' END
       || '|' || a.id::text
       || '|' || COALESCE(o.display_id, '(無單號)')
       || '|' || a.status::text
       || '|' || COALESCE(a.last_settle_error, '(無)')
       || '|' || COALESCE(a.rec_trade_id, '-')
       || '|' || COALESCE(a.bank_transaction_id, '-')
       || '|' || CASE WHEN a.released_manual_review_at IS NULL THEN 'n' ELSE 'y' END
       || '|' || (EXTRACT(EPOCH FROM (now() - a.created_at))/3600)::bigint::text
  FROM public.payment_charge_attempts a
  JOIN public.orders o ON o.id = a.order_id
 WHERE a.needs_manual_review = true
   AND o.payment_status = 'unpaid'::public.payment_status
   AND ( a.status = 'pending'
         OR (a.superseded_at IS NOT NULL AND a.status IN ('charged','released')) )
 ORDER BY 1;"

OUT=$(psql "$CONN" -X -A -t -v ON_ERROR_STOP=1 -c "$SQL" 2>&1)
if [ $? -ne 0 ]; then
  echo "🔴 工具問題:psql 沒跑起來或連不上 —— 這【不是】查詢結果,不要當成「查無」" >&2
  echo "$OUT" >&2
  exit 1
fi

N=$(printf '%s\n' "$OUT" | grep -c .)
if [ -z "$OUT" ]; then
  echo "🔴 用告警自己的述詞查,一列都沒查到。"
  echo "   ⇒ 告警說有,而現在查不到 —— 兩種可能:①它已經被處理掉了 ②我查的庫不是告警讀的那個庫。"
  echo "   ⇒ 先確認連線字串,不要當成「沒事了」。"
  exit 3
fi

echo "查到 $N 列(用告警自己的述詞,不是 plan 的轉述)"
if [ -n "$CLAIMED" ] && [ "$N" != "$CLAIMED" ]; then
  echo "🔴 對不上:告警說 $CLAIMED 筆,現在查到 $N 列 —— 中間有東西變了,先查為什麼再動手。"
fi
echo

printf '%s\n' "$OUT" | while IFS='|' read -r kind id disp st err rec bank relmr agehr; do
  if [ "$agehr" -ge 24 ] 2>/dev/null; then AGE="$((agehr / 24)) 天"; else AGE="${agehr} 小時"; fi
  if [ "$kind" = "甲" ]; then
    echo "── 甲類:pending 孤兒(sweeper 放棄)"
    echo "   訂單 $disp  attempt $id"
    echo "   卡了 $AGE(attempt 建立到現在)"
    echo "   ⇒ 處置:走 Record 對帳補結算。這張單的錢還是它自己的。"
  else
    echo "── 乙類:被讓路後轉人工"
    echo "   訂單 $disp  attempt $id  (status=$st)"
    echo "   卡了 $AGE(attempt 建立到現在)"
    echo "   🔴 處置:錢屬於【舊單】,出口是退款(L5b-2)。**不要**去補結算。"
    [ "$relmr" = "y" ] && echo "   ⚠️ 這一列同時被算進 released 死卡 ⇒ 它在兩個計數裡各出現一次,不是兩起事故。"
  fi
  echo "   TapPay 指標:rec_trade_id=$rec  bank_transaction_id=$bank"
  if [ "$rec" = "-" ] && [ "$bank" = "-" ]; then
    echo "   🔴 兩個指標都沒有 ⇒ 非 3DS 那條路。定位法:拿 orders.id 當 TapPay order_number 去 Record API 反查。"
  fi
  if [ "$err" = "record_unreachable" ]; then
    echo "   ⚠️ last_settle_error=record_unreachable 【不一定是連線故障】——"
    echo "      讓路閘的 RAISE 會被吞成同一個碼(plan §3.4),同碼不同因,勿誤判成網路問題。"
  else
    echo "   last_settle_error=$err"
  fi
  echo
done

echo "🔴 這支只查不動。refund / dismissed 都要另外走 plan + 對抗審查 + Sean 批(鐵則 12①)。"
exit 0
