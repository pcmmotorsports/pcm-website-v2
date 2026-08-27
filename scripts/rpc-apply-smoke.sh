#!/bin/sh
# rpc-apply-smoke.sh — apply 之後確認「那支 RPC 真的在正式庫裡」的三向 smoke。
#
# 🔴🔴 本腳本存在的理由(2026-08-18 V 窗實測撞出來的):
#   `docs/lessons-learned.md:1065` 的判準逐字是
#     「回 P0001 之類的守門錯誤 = 函式在;回 PGRST202 = 函式不在」
#   **而那個判準漏了一個世界**:
#     ① 函式在 + 具名參數【給全】   ⇒ HTTP 200(業務碼,如 "NOOP")
#     ② 函式在 + 具名參數【給不全】 ⇒ HTTP 404 PGRST202   ← 🔴 函式明明在,卻印出「不在」的碼
#     ③ 函式【不在】                ⇒ HTTP 404 PGRST202   ← 與 ② 連 details 句型都同款,只差函式名
#   ⇒ **PGRST202 說的是「schema cache 裡找不到【這個簽章】」,不是「找不到這個函式」。**
#      參數少一個、型別不對、名字拼錯 —— 全部回同一個碼。
#
# ✅ 2026-08-18 G1 收割時查證補一行:**`lessons-learned.md` 那條【已經改了】,就在 `:1067`**
#    (`grep -n '2026-08-18 修正上一句的判準' docs/lessons-learned.md` ⇒ 1067;落在 commit `4a78574d`)。
#    `:1065` 的舊句子照本 repo 慣例**留痕不刪**,而更正緊接在它下面。
#    🔴 **所以讀到本檔上面那段的人,不要以為那個洞還開著** —— 上面那段記的是【本腳本為什麼被寫出來】,
#    不是【現在的狀態】。**一段解釋自己來歷的文字,會被讀成現況。**
#
# 🔴 誤報方向特別貴:它是【在成功之後說失敗】——
#   apply 真的成功了,而 smoke 因參數沒給全回報「沒 apply」
#   ⇒ 下一個動作會是「重跑 apply / 懷疑資料庫」,而那是在深夜、對著正式庫、動一個沒壞的東西。
#
# 用法:
#   sh scripts/rpc-apply-smoke.sh <函式名> '<完整具名參數 JSON>'
# 例(參數名一律【從呼叫端 grep 出來】,不要猜 —— 我自己猜錯過一次):
#   grep -n -A8 "rpc('admin_update_order_workflow'" packages/adapters/src/supabase/SupabaseOrderAdapter.ts
#   sh scripts/rpc-apply-smoke.sh admin_update_order_workflow \
#     '{"p_order_id":"00000000-0000-0000-0000-000000000000","p_expected_version":1,
#       "p_patch":{},"p_actor":"smoke","p_request_id":"00000000-0000-0000-0000-000000000001"}'
#
# 🔴 為什麼在正式站跑不會動到資料:`p_order_id` 用**全 0 UUID** ⇒ 那筆單不存在 ⇒ 函式走到
#    「找不到 ⇒ NOOP」那條路、零寫入。**這個選 id 的方式是這道 smoke 能在正式站跑的前提**,
#    換函式時要自己想一遍「我給的這組值會不會真的改到東西」。
#
# 憑據:apps/admin/.env.local 的 SUPABASE_SERVICE_ROLE_KEY(唯讀用途)。

set -u
FN="${1:-}"
ARGS="${2:-}"
[ -n "$FN" ] && [ -n "$ARGS" ] || { echo "用法: sh $0 <函式名> '<完整具名參數 JSON>'"; exit 2; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENVF="$ROOT/apps/admin/.env.local"
[ -f "$ENVF" ] || { echo "找不到 $ENVF"; exit 1; }
U="$(grep -m1 '^NEXT_PUBLIC_SUPABASE_URL=' "$ENVF" | cut -d= -f2- | tr -d '"')"
K="$(grep -m1 '^SUPABASE_SERVICE_ROLE_KEY=' "$ENVF" | cut -d= -f2- | tr -d '"')"
[ -n "$U" ] && [ -n "$K" ] || { echo "env 缺 URL 或 service_role key"; exit 1; }

# 🔴 金鑰【不進 argv】(2026-08-18 G1 收割時修;與 G4 同日在三支 ops 腳本修的是同一件事)
#   ~~-H "apikey: $K" -H "Authorization: Bearer $K"~~ ⇒ service_role key 會出現在 process table,
#   同一台機器上任何人 `ps -ww` 就看得到。**走 env 只擋住 shell history,擋不住 argv 這一半。**
#   改成用 `curl --config -`:兩個 header 從 **stdin** 進去,argv 裡只剩 URL 與 JSON 參數。
#   自證(不必連正式站,本機 nc 就做得到,我跑過):
#     ( nc -l 8799 > /tmp/cap.txt & sleep 1
#       printf 'header = "apikey: TESTKEY"\n' | curl -s -m 3 --config - -X POST http://127.0.0.1:8799/x >/dev/null
#       sleep 1; kill %1 )
#     grep -c apikey /tmp/cap.txt   ⇒ 1   (給 --config)
#     🔴 負向對照(不給 --config,其餘一樣)⇒ 0   ← 沒有這一發,上面那個 1 證不了是 --config 帶進去的
#   ⚠️ 限度:這只擋住 argv。金鑰仍在**本行程的記憶體**與 `$K` 變數裡,core dump / 同使用者的偵錯仍看得到。
call() {
  printf 'header = "apikey: %s"\nheader = "Authorization: Bearer %s"\n' "$K" "$K" | \
  curl -s -o /tmp/rpc-smoke-body.$$ -w '%{http_code}' -X POST "$U/rest/v1/rpc/$1" \
    --config - -H 'Content-Type: application/json' -d "$2"
}

# 🔴 印出「我送了哪幾個參數」—— 讓讀的人【自己看得到那一格】,而不是相信腳本說它給全了。
echo "函式    : $FN"
echo "送出參數: $(printf '%s' "$ARGS" | tr -d '\n' | sed 's/:[^,}]*/:…/g')"
echo

C1="$(call "$FN" "$ARGS")";                    B1="$(cat /tmp/rpc-smoke-body.$$)"
C2="$(call "$FN" '{}')";                       # 同函式、參數全空 ⇒ 應命中 ② 那個世界
C3="$(call "zz_bogus_fn_$$" '{}')";            # 保證不存在的名字 ⇒ ③
rm -f /tmp/rpc-smoke-body.$$

echo "① 本函式 + 你給的完整參數 ⇒ HTTP $C1  $(printf '%.60s' "$B1")"
echo "② 本函式 + 空參數(對照)   ⇒ HTTP $C2"
echo "③ 不存在的函式名(對照)     ⇒ HTTP $C3"
echo

if [ "$C1" = "200" ]; then
  echo "✅ 函式【在】—— 而且執行到了業務邏輯(①回 200)。"
  [ "$C2" = "$C3" ] && echo "   (②③ 同碼 = 預期內:那兩個世界本來就分不開,所以判準只看 ①)"
  exit 0
fi

if [ "$C1" = "404" ]; then
  echo "🔴 ① 回 404/PGRST202 —— **只能讀成「這個【簽章】不在 schema cache」**。"
  echo "   判『函式不在』之前,先自證兩件:"
  echo "     a) 參數名是不是【從呼叫端 grep 出來的】(不是猜的)?少一個就會長成這樣"
  echo "     b) 型別對不對(數字 vs 字串、jsonb vs 文字)"
  echo "   兩件都確認過才升級成「migration 沒 apply」。"
  exit 3
fi

echo "⚠️ ① 回了非 200/404 的 $C1 —— 這是本腳本沒預期的世界,不要自行歸因,把整段輸出貼出來。"
exit 4
