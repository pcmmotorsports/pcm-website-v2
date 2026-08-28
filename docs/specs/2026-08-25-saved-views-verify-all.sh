#!/bin/bash
# ============================================================================
# 片1 全套驗收 —— 一發跑完【三層】量具  🛑 拋棄式 PG, 絕不碰正式庫
# 🔴 ~~原字面「一發跑完六層量具」~~ 作廢(codex R4 nit, 2026-08-28)——
#    檔尾第 150 行早就誠實寫著「本檔只跑三層」, **而檔頭還在說六層**。
#    📌 **一份檔可以同時對自己說兩句話, 而讀的人只會讀到最上面那句。**
#    另三層(並發 / 合約 / 定義)各自外跑, 清單在檔尾。
# ============================================================================
# 🔴 為什麼要有這一支:六把尺是分批做出來的, 而草稿【一直在長】(597 ⇒ 703 行)。
#    每一把尺各自綠過, 而**沒有人在同一個版本上把六把一起跑過**。
#    📌 六個「上次跑是綠的」加起來, 不等於「現在是綠的」。
# 用法  bash docs/specs/2026-08-25-saved-views-verify-all.sh
# ============================================================================
set -u
export LC_ALL=C LANG=C
PGBIN=${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}
SOCK=/tmp/pgVA; DATA=${TMPDIR:-/tmp}/pgVA-data
HERE=${VAHERE:-$(cd "$(dirname "$0")" && pwd)}
# 🔴 可指定另一支 SQL(給突變用)。沒有這個, 這支腳本【沒辦法被突變殺】——
#    而一支殺不了的尺與一支在守著的尺, 都印 ok。
D="${VADRAFT:-$HERE/../../supabase/migrations/20260828080000_m4b_b4views1_saved_order_views.sql}"
# 🔴 片1a(修 request_id 的那支)——【兩支都要套】, 順序不可換。
#    可用 VAFIX="" 關掉它(給突變用:拿掉這道閘 ⇒ 39 格必須掛回第 1 格)。
FIX="${VAFIX-$HERE/../../supabase/migrations/20260828090000_m4b_b4views1a_request_id_gate.sql}"
T="$HERE/2026-08-25-saved-views-tests.sql"
FAILED=0
Q() { "$PGBIN/psql" -h "$SOCK" -U postgres -d postgres -Atq "$@"; }
say() { printf '%-46s %s\n' "$1" "$2"; }
cleanup() { "$PGBIN/pg_ctl" -D "$DATA" stop -m immediate > /dev/null 2>&1; rm -rf "$SOCK" "$DATA"; }
trap cleanup EXIT

rm -rf "$SOCK" "$DATA"; mkdir -p "$SOCK"
"$PGBIN/initdb" -D "$DATA" -U postgres --encoding=UTF8 --locale=C > /dev/null 2>&1 || { echo "initdb 失敗"; exit 1; }
"$PGBIN/pg_ctl" -D "$DATA" -o "-k $SOCK -h ''" -l "$DATA/pg.log" start > /dev/null 2>&1 || { echo "pg_ctl 失敗"; exit 1; }
for i in 1 2 3 4 5 6 7 8 9 10; do Q -c "select 1" > /dev/null 2>&1 && break; done
# 🔴 共用 fixture(照真表逐字抄)—— 各自手寫的那幾份比真表【寬】,
#    而寬的 fixture 會讓所有「防止髒東西」的守門同時恆綠(2026-08-28 實錘)。
"$PGBIN/psql" -h "$SOCK" -U postgres -d postgres -q -f "$HERE/2026-08-25-saved-views-fixture.sql" > /dev/null 2>&1

echo "── ① apply(草稿 $(wc -l < "$D" | tr -d ' ') 行)──"
"$PGBIN/psql" -h "$SOCK" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f "$D" > "$DATA/up.log" 2>&1
RC=$?
if [ $RC -eq 0 ] && [ -n "$FIX" ]; then
  "$PGBIN/psql" -h "$SOCK" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f "$FIX" >> "$DATA/up.log" 2>&1
  RC=$?
fi
# 🔴 失敗時要印出【是哪一道斷言】—— 第一版只印 rc, 而 rc 只答得出「哪一層紅」,
#    答不出「哪一格紅」。而突變測試的整個價值就在後面那個。
#    📌 一支把多層收成一個總結的腳本, 會把「紅在哪一格」壓成「哪一層紅」。
if [ $RC -eq 0 ]; then say "apply(含 22+ 道碼錨與斷言)" "rc=0 ✅"
else say "apply" "rc=$RC 🔴"; grep -m1 "ERROR:" "$DATA/up.log" | sed 's/^/    /'; exit 2; fi

# 🔴 「四格」是 2026-08-28 之前的事;補了負對照與三格 end-state 之後是九格。
echo "── ② apply 後的九格(每格寫死期望)──"
chk() { local got; got=$(Q -c "$2"); [ "$got" = "$3" ] && say "$1 期望 $3" "實得 $got ✅" || { say "$1 期望 $3" "實得 $got 🔴"; FAILED=1; }; }
chk "to_regclass" "SELECT coalesce(to_regclass('public.admin_saved_order_views')::text,'不存在');" "admin_saved_order_views"
chk "函式支數" "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'admin_%saved_order_view%';" "5"
chk "RLS 開著" "SELECT relrowsecurity FROM pg_class WHERE oid='public.admin_saved_order_views'::regclass;" "t"
chk "policy 條數" "SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='admin_saved_order_views';" "0"
chk "service_role EXECUTE" "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'admin_%saved_order_view%' AND has_function_privilege('service_role', p.oid, 'EXECUTE');" "4"
chk "🔴 負對照 不存在的表" "SELECT coalesce(to_regclass('public.zzz_never_a_table')::text,'不存在');" "不存在"

# 🔴🔴 **seqACL 的【時間射程】**(codex R2-1, 2026-08-28)——
#    片1a 裡的斷言 E 只在**它自己被 apply 的那一刻**量一次。
#    ⇒ 之後任何一支 migration 重建那顆 sequence, 新的那顆套回寬鬆 default ACL,
#      **而斷言 E 不會再跑** ⇒ 全綠。
#    📌 **我原本把它的限制寫成「這道尺只保護這一顆」—— 而真正的限制多一維:**
#       **「這一顆, 而且只在那一刻」。一個空間上的射程, 被我漏掉了時間那一半。**
#    ⇒ 這一格把同樣的檢查搬到 **end-state**(所有 migration 都 apply 完之後)再量一次。
#    ⚠️ 誠實邊界:它涵蓋「本 harness 跑過的那些 migration 之後」, **不涵蓋正式庫上未來的手動變更** ——
#       那一半仍是板列上的 open 項, 沒有被這一行關掉。
# 🔴 而這三格第一次跑就【紅】, 原因不是它們抓到東西 —— 是我寫錯了期望值的形狀:
#    psql 對 boolean 印 `t` / `f`, 而我加了 `::text` ⇒ 它印 `true` / `false` ⇒ 三格全紅。
#    📌 **一個因為【尺自己壞掉】而紅的格, 與一個抓到問題的格, 在畫面上長得一樣** ——
#       而這一次它紅得很吵、當場就發現;真正危險的是同一個錯讓它變【綠】的那個方向。
# 🔴🔴 **這三格在 2026-08-28 之前【紅不可達】**(R3 格3)——
#    任何 seqACL 腐化都先被片1a 的斷言 E 在 apply 時抓掉、rc=2 退場
#    ⇒ 跑得到本段的世界裡它們必綠, 而 MG6/MG7 的紅**全記在斷言 E 頭上**。
#    📌 **它們存在的理由是【時間射程】, 而在此之前沒有任何世界考過那個射程** ——
#       三格從來沒有被看過分辨兩個世界, 而它們每次都印綠。
#    ✅ 已補突變 MH11(GRANT 塞在 `COMMIT;` 之後 ⇒ 斷言 E 已跑完 ⇒ 只有這裡抓得到)。
chk "🔴 end-state seqACL:anon 對 sequence 無權" \
  "SELECT has_sequence_privilege('anon', pg_get_serial_sequence('public.admin_saved_order_views','id'), 'USAGE');" "f"
chk "🔴 end-state seqACL:relacl 不是 NULL(分得開「乾淨」與「沒設定過」)" \
  "SELECT (relacl IS NOT NULL) FROM pg_class WHERE oid = pg_get_serial_sequence('public.admin_saved_order_views','id')::regclass;" "t"
chk "🔴 正對照 一顆沒被 REVOKE 過的 sequence 會印 t" \
  "CREATE SEQUENCE IF NOT EXISTS public.zzz_probe_seq; SELECT has_sequence_privilege('anon','public.zzz_probe_seq','USAGE');" "t"

echo "── ③ 52 格行為測試 ──"   # 🔴 這個數字與下面的 EXPECT_OK 是【同一個宣稱】,
                              #    而它們曾經一個寫 34 一個寫 41、對不上而沒有人叫
                              #    ⇒ 📌 標籤不是註解, 它是給人看的那把尺;改一個就要改另一個。
"$PGBIN/psql" -h "$SOCK" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f "$T" > "$DATA/t.log" 2>&1
RC=$?; N=$(grep -c "NOTICE:  ok" "$DATA/t.log")
# 🔴 **只印不比 = 沒有比**(code-reviewer 2026-08-28)。一發讓 DO 區塊提早結束的世界
#    ⇒ rc=0 + 少印幾行 ok ⇒ 判成 ✅。對齊鐵則 11:要比【測項總數】, 不是只比「有沒有紅」。
# 🔴 52 ⇒ 50:R3 格1 判定 T26b / T26e **構造上恆真**(要紅的那個世界裡, 上一格先紅
#    ⇒ 它們永遠輪不到)⇒ 已從 tests.sql 刪除, 原處留字說明。
#    📌 **刪掉兩格假綠, 分母就要跟著降** —— 不降的話, 這一行會在下一次全綠時印
#       「少跑了 2 格」, 而那是本檔自己造出來的假紅。
# 🔴 50 ⇒ 52:R5 抓到 `名稱必填` 兩道 RAISE 零覆蓋 ⇒ 補了 T27a / T27b。
EXPECT_OK=52
if [ $RC -eq 0 ] && [ "$N" != "$EXPECT_OK" ]; then
  say "行為測試 rc=0 而 ok 格數" "$N ≠ 期望 $EXPECT_OK 🔴 少跑了幾格"; FAILED=1
elif [ $RC -eq 0 ]; then say "行為測試 rc=0 · ok 格數" "$N ✅"
else say "行為測試 rc=$RC · ok" "$N 🔴"
     grep -m1 "ERROR:" "$DATA/t.log" | sed 's/^/    /'      # ← 哪一格紅, 不是哪一層紅
     FAILED=1; fi

echo "── ④ 帶資料的 down(有資料那半)──"
Q -c "INSERT INTO public.admin_saved_order_views (staff_id,label,query,idempotency_key)
      SELECT 'clerk','vv'||i,'q='||i,'kk'||i FROM generate_series(1,5000) i;" > /dev/null
GOT=$(Q -c "SELECT count(*) FROM public.admin_saved_order_views;")
# 灌完當場數, 不相信 INSERT 的回傳(表裡本來有測試留下的列 ⇒ 只驗它 >= 5000)
[ "$GOT" -ge 5000 ] && say "灌資料 當場 count(*)" "$GOT(>=5000)✅" || { say "灌資料" "$GOT 🔴"; FAILED=1; }
"$PGBIN/psql" -h "$SOCK" -U postgres -d postgres -Atq -v ON_ERROR_STOP=1 > "$DATA/down.log" 2>&1 <<'DOWN'
SET lock_timeout = '5s';
BEGIN;
  DROP FUNCTION IF EXISTS public.admin_list_saved_order_views(text);
  DROP FUNCTION IF EXISTS public.admin_create_saved_order_view(text, text, text, text, boolean, text, text);
  DROP FUNCTION IF EXISTS public.admin_update_saved_order_view(text, bigint, text, text, text, timestamptz, text);
  DROP FUNCTION IF EXISTS public.admin_delete_saved_order_view(text, bigint, text);
  DROP TRIGGER  IF EXISTS admin_saved_order_views_set_updated_at ON public.admin_saved_order_views;
  DROP FUNCTION IF EXISTS public.admin_saved_order_views_touch_updated_at();
  DROP TABLE    IF EXISTS public.admin_saved_order_views;
COMMIT;
DOWN
RC=$?; [ $RC -eq 0 ] && say "down(帶 $GOT 列 · lock_timeout 5s)" "rc=0 ✅" || { say "down" "rc=$RC 🔴"; tail -2 "$DATA/down.log"; FAILED=1; }
chk "down 後 to_regclass" "SELECT coalesce(to_regclass('public.admin_saved_order_views')::text,'不存在');" "不存在"
chk "down 後 函式支數" "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'admin_%saved_order_view%';" "0"

echo "── ⑤ 🔴 撞名世界:先放一個同名的孤兒 sequence, 再 apply(codex 複審 R2-1)──"
# 我原本寫死 `admin_saved_order_views_id_seq`。若 schema 裡已有同名孤兒,
# PostgreSQL 會給 identity 那支【帶尾碼的新名字】⇒ 寫死的版本會去查錯的那個物件。
# ⇒ 本段造出那個世界, 並驗:真正掛在 id 上的那支【真的被 REVOKE 到了】。
cleanup; rm -rf "$SOCK" "$DATA"; mkdir -p "$SOCK"
"$PGBIN/initdb" -D "$DATA" -U postgres --encoding=UTF8 --locale=C > /dev/null 2>&1
"$PGBIN/pg_ctl" -D "$DATA" -o "-k $SOCK -h ''" -l "$DATA/pg.log" start > /dev/null 2>&1
for i in 1 2 3 4 5 6 7 8 9 10; do Q -c "select 1" > /dev/null 2>&1 && break; done
# 🔴 共用 fixture(照真表逐字抄)—— 各自手寫的那幾份比真表【寬】,
#    而寬的 fixture 會讓所有「防止髒東西」的守門同時恆綠(2026-08-28 實錘)。
"$PGBIN/psql" -h "$SOCK" -U postgres -d postgres -q -f "$HERE/2026-08-25-saved-views-fixture.sql" > /dev/null 2>&1
# 孤兒, 佔住那個名字, 而且【給 anon 權限】⇒ 查錯物件的版本會在這裡露餡
Q -c "CREATE SEQUENCE public.admin_saved_order_views_id_seq; GRANT USAGE ON SEQUENCE public.admin_saved_order_views_id_seq TO anon;" > /dev/null
"$PGBIN/psql" -h "$SOCK" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f "$D" > "$DATA/up2.log" 2>&1
RC=$?
# 🔴 這一段原本【只 apply $D, 從不套 $FIX】(R5 nit, 2026-08-28)——
#    而片1a 的斷言 E 是**動態**查 pg_get_serial_sequence 的那一道
#    ⇒ **在唯一一個真的有撞名的世界裡, 它從來沒有跑過。**
#    📌 一道專門為了「名字可能不是你以為的那個」而寫的斷言,
#       卻沒有在【名字真的不是那個】的世界裡被執行過一次。
if [ $RC -eq 0 ] && [ -n "$FIX" ]; then
  "$PGBIN/psql" -h "$SOCK" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f "$FIX" >> "$DATA/up2.log" 2>&1
  RC=$?
fi
REAL=$(Q -c "SELECT pg_get_serial_sequence('public.admin_saved_order_views','id');")
if [ $RC -ne 0 ]; then say "撞名世界 apply" "rc=$RC 🔴"; grep -m1 "ERROR:" "$DATA/up2.log" | sed 's/^/    /'; FAILED=1
else say "撞名世界 apply(真正那支 = $REAL)" "rc=0 ✅"; fi
# 🔴 判別力在這裡:孤兒【有】 anon USAGE, 而真正那支必須【沒有】
A_ORPH=$(Q -c "SELECT has_sequence_privilege('anon','public.admin_saved_order_views_id_seq','USAGE');")
A_REAL=$(Q -c "SELECT has_sequence_privilege('anon','$REAL','USAGE');" 2>/dev/null)
[ "$A_ORPH" = "t" ] && say "  孤兒仍有 anon USAGE(正對照: 這個世界真的造出來了)" "t ✅" || { say "  孤兒的 anon USAGE" "$A_ORPH 🔴 這個世界沒造出來"; FAILED=1; }
[ "$A_REAL" = "f" ] && say "  真正那支 anon USAGE" "f ✅ REVOKE 打對了物件" || { say "  真正那支 anon USAGE" "$A_REAL 🔴 REVOKE 打錯物件"; FAILED=1; }
[ "$REAL" = "public.admin_saved_order_views_id_seq" ] && { say "  🔴 名字沒有被改" "撞名沒發生 ⇒ 這一段零判別力"; FAILED=1; } || say "  名字確實被改掉了" "$REAL ✅"

# 🔴 這支腳本【只跑三層】:apply+斷言 / 52 格行為 / 帶資料的 down。
#    另外三層要各自跑, 不在本檔:
#      並發   bash docs/specs/2026-08-25-saved-views-concurrency-test.sh
#      合約   python3 docs/specs/2026-08-25-saved-views-contract-check.py
#      定義   python3 docs/specs/2026-08-25-saved-views-manager-def-check.py
#      突變   bash docs/specs/2026-08-25-saved-views-run-mutants.sh
#             ~~原本這裡寫「/tmp 那支(未進 repo)」~~ 作廢 —— 它 2026-08-28 已收進 repo。
#             📌 一條指向「不存在的東西」的註解, 與一個真的缺口, 在讀的人眼裡一樣。
#    📌 本檔第一版印的是「六層一起綠」—— **而它只跑了三層。**
#       那正是它自己要治的病:一個看起來完整的結論, 而分母比它宣稱的窄。
[ $FAILED -eq 0 ] && echo "=== 本檔三層在同一個版本上一起綠(另外三層另跑, 見檔尾註)===" || echo "=== 有紅 ==="
exit $FAILED
