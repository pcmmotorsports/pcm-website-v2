#!/usr/bin/env bash
# b1a-acceptance-harness.sh — B1-a(A 庫 · 停用 test_01 + 指派 staff_2)的驗收,可重跑
#
# 用法:bash scripts/b1a-acceptance-harness.sh [port]
#
# 🔴 為什麼這支檔今天才出現(2026-08-17 B 窗):
#    E8-B 這條線橫跨兩庫。報價單庫那半(B1-b / B2)有 41 格 + 六發突變;
#    **A 庫這半(B1-a)在今天之前【零格】** —— 而它是【會 UPDATE 真實資料】的那一支,
#    跑在有經銷價與會員資料的網站庫上。
#    📎 「唯一沒被掃過的那個」永遠是最該掃的。
#
# 🔴 本檔沿用 B1-b harness 今天付過學費的三條做法,不重新發明:
#    ① 每一格的世界要能被【單獨打紅】—— 不能單獨打紅的格子是裝飾格
#       ⚠️ **本檔有兩格【不符合】這條,已具名:`A0b` / `A0d` 是 backstop 格,需要兩發突變才紅**
#       (code-reviewer 2026-08-17 實測抓到)。它們不是裝飾格,但也不是單發可判別格 —— 見該兩行。
#    ② 突變前先 assert 錨點唯一(命中數 ≠ 1 ⇒ 那一發的結論不可信)
#    ③ psql 一律 `-X`(不讀 ~/.psqlrc;`\set ECHO all` 會把 SQL 原文回印進輸出
#       ⇒ 任何掃輸出的 grep 都可能自命中。B1-b 那邊已經真的踩過一次假綠)
#
# ⚠️ 樁與正式庫的落差(照實寫,不要讀成「已驗」):
#    · 樁沒有 `updated_at` 自動維護 trigger(正式庫有,見
#      supabase/migrations/20260726120000_m4b_e8a1_staff_table.sql)。
#      B1-a 自己明文寫 `updated_at = now()`,而**本檔沒有任何一格斷言 updated_at**
#      ⇒ 這一塊是**零覆蓋**,不是「驗過了」。
#    · 樁沒有 `admin_audit_log`。B1-a 的 SQL **不查它**(只有註解提到)⇒ 不影響本檔任何一格。
#    · 🔴 **樁沒有任何指向 `public.staff(id)` 的 FK,而正式庫有**(code-reviewer 2026-08-17 抓):
#        `grep -rn 'REFERENCES public\.staff' supabase/migrations/*.sql`
#        ⇒ **3 個檔 / 6 處,全部 `ON DELETE RESTRICT`**
#          (`…a7_order_cancellations.sql:112`、`…a7b_m_refund_jobs.sql:184-186`、
#           `…op1_order_payments_m.sql:243,246`)
#        ⚠️ **這條直接影響 `M3` 怎麼被讀**:M3 把 UPDATE 換成 DELETE,
#          在**樁上**紅在落地斷言的 `IS NULL`;在**正式庫**很可能**先紅在 FK 的 23503**
#          ⇒ **同樣是紅,但不是同一個紅。** M3 證的是「樁上這道斷言會叫」,
#          **不證**「正式庫上會紅在這道斷言」。
#        📎 (reviewer 報 9 處;我用上面那支 grep 自己數是 **6** 處 / 3 檔。
#           數字以本行的命令為準,兩者差異未進一步追。)
set -uo pipefail

PORT="${1:-55699}"
D="/tmp/pgprobe_b1a_$$"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
B1A="$REPO/docs/specs/2026-08-16-m4b-e8b-b1a-migration-draft.sql"
PASS=0; FAIL=0

[ -f "$B1A" ] || { echo "🔴 找不到 $B1A" >&2; exit 2; }

psqlq()        { psql -X -h 127.0.0.1 -p "$PORT" -U postgres -tA "$@" 2>&1; }
run_sql_file() { psql -X -h 127.0.0.1 -p "$PORT" -U postgres -tA -v ON_ERROR_STOP=1 -f "$1" > /dev/null 2>&1; }
run_sql()      { psql -X -h 127.0.0.1 -p "$PORT" -U postgres -tA -v ON_ERROR_STOP=1 -c "$1" > /dev/null 2>&1; }

cell() { # cell <名稱> <預期 red|green> <命令...>
  local name="$1" expect="$2"; shift 2
  local out rc
  out="$("$@" 2>&1)"; rc=$?
  local got; if [ "$rc" -eq 0 ]; then got=green; else got=red; fi
  if [ "$got" = "$expect" ]; then
    PASS=$((PASS+1)); printf "  ✅ %-46s 預期 %-5s 實際 %-5s\n" "$name" "$expect" "$got"
  else
    FAIL=$((FAIL+1)); printf "  🔴 %-46s 預期 %-5s 實際 %-5s\n" "$name" "$expect" "$got"
    echo "$out" | tail -2 | sed 's/^/       /'
  fi
}

# 🔴🔴 `red_because` —— 紅了還要【紅對地方】。
#    2026-08-17 本線兩次實錘:一個紅得理直氣壯但紅在別的原因的格子,
#    與一個真正有判別力的格子,**在 `cell` 的眼裡長得一模一樣**(它只看 exit code)。
#    ⇒ 凡是預期紅的格,都要指名它該紅在哪一句。
# ⚠️ pattern 錨到 `ERROR:` 但**不要用 `^ERROR:`** —— psql 的錯誤行是
#    `psql:<檔>:<行>: ERROR:  …`,前面有前綴,`^` 會讓它永遠不命中
#    (B1-b harness 今天真的踩過這個,是正向對照抓出來的)。
red_because() { # red_because <名稱> <期望訊息片段> <sql 檔>
  local name="$1" want="$2" f="$3" out rc
  out=$(psql -X -h 127.0.0.1 -p "$PORT" -U postgres -tA -v ON_ERROR_STOP=1 -f "$f" 2>&1); rc=$?
  if [ "$rc" -eq 0 ]; then
    FAIL=$((FAIL+1)); printf "  🔴 %-46s 預期紅、實際【綠】\n" "$name"
  # 🔴 `$want` 用 `grep -F`(固定字串)不當 ERE —— 例如 `找不到 public.staff` 裡的 `.`
  #    在 ERE 下是「任意字元」。實務上本檔 12 個 want 各自唯一撞不到,但**判別力不該靠運氣**
  #    (code-reviewer 2026-08-17 `F8`)。先取 ERROR 行,再用固定字串比對。
  elif echo "$out" | grep "ERROR:" | grep -qF "$want"; then
    PASS=$((PASS+1)); printf "  ✅ %-46s 紅,且訊息含「%s」\n" "$name" "$want"
  else
    FAIL=$((FAIL+1)); printf "  🔴 %-46s 紅了但【紅錯地方】(訊息不含「%s」)\n" "$name" "$want"
    echo "$out" | grep 'ERROR:' | head -1 | sed 's/^/       實際:/'
  fi
}

cleanup() { pg_ctl -D "$D/data" stop -m fast > /dev/null 2>&1; rm -rf "$D"; }
trap cleanup EXIT

echo "══ 起拋棄式 PG(port $PORT)══"
mkdir -p "$D"
initdb -U postgres -A trust "$D/data" > "$D/initdb.log" 2>&1 || { echo "🔴 initdb 失敗"; exit 2; }
# 🔴 macOS 上不加 LC_ALL=C 會報 postmaster became multithreaded during startup
LC_ALL=C pg_ctl -D "$D/data" -o "-p $PORT -k $D -c listen_addresses=127.0.0.1" -l "$D/pg.log" start > /dev/null 2>&1
sleep 3
psqlq -c "select 1" > /dev/null || { echo "🔴 叢集起不來,看 $D/pg.log"; exit 2; }

# ── 樁 ────────────────────────────────────────────────────────────────────
# 🔴 欄位定義逐字對齊正式庫建表 migration
#    (supabase/migrations/20260726120000_m4b_e8a1_staff_table.sql:12-24)——
#    **CHECK 少一條,樁就會接受正式庫會拒絕的資料**,而那種格子是綠的。
# 🔴 列的內容對齊 2026-08-16 Sean 實查的現況:
#    啟用 = sean / staff_1 / staff_2 / test_01(4 列);停用 = op4_backfill / payment_confirmer
#    ⇒ 停用 test_01 之後啟用中應為 **3 列**,那正是 B1-a 落地斷言寫死的那個 3。
#
# 🔴 **各列 label 的來源逐一標明(2026-08-17 更正,adversarial-reviewer `F7` 抓)**:
#    原本這裡的註解寫「逐字對齊」,而 `op4_backfill` / `payment_confirmer` 兩列**是我自己編的**
#    (`'O4 回填'` / `'收款確認'`),與 repo 的 seed 不同 ⇒ 那句「逐字對齊」站不住。現已改成真值:
#      · sean / staff_1 / staff_2 ← 建表 seed(`…20260726120000_m4b_e8a1_staff_table.sql:34-36`)
#      · op4_backfill            ← `…20260811050000_m4b_e10_op4_backfill_card_ledger.sql:76`
#      · payment_confirmer       ← `…20260810160000_m4b_e10_op3_confirm_card_leg.sql:330`
#      · 🔴 **test_01 ← 無 repo 來源**(`grep -rl test_01 supabase/migrations/` ⇒ **零命中**)
#        ⇒ 它是**手抄自 Sean 2026-08-16 口述的現況**,只有一個來源、無法在 repo 內複驗。
#        **這是本樁最脆的一列,而 B1-a 整支就是在動它。**
# ⚠️ 這幾個 label 不影響任何一格的判定(所有斷言只讀 `is_active` 與 staff_1/staff_2 的 label),
#    但**註解宣稱「對齊」就必須真的對齊** —— 不然下一個人會拿它當 repo 事實引用。
mk_stub() {
  run_sql "drop table if exists public.staff cascade;
           drop table if exists public.auth_state cascade;
           create table public.staff (
             id          text        primary key,
             label       text        not null,
             is_manager  boolean     not null default false,
             is_active   boolean     not null default true,
             created_at  timestamptz not null default now(),
             updated_at  timestamptz not null default now(),
             constraint staff_id_nonempty    check (id <> ''),
             constraint staff_id_format      check (id ~ '^[a-z0-9_]{1,64}\$'),
             constraint staff_label_nonempty check (pg_catalog.btrim(label) <> '')
           );
           insert into public.staff (id, label, is_manager, is_active) values
             ('sean',              'Sean(老闆)',   true,  true),
             ('staff_1',           '員工 1(占位)', false, true),
             ('staff_2',           '員工 2(占位)', false, true),
             ('test_01',           '測試帳號',      true,  true),
             ('op4_backfill',      'OP4 歷史回填(系統)',   false, false),
             ('payment_confirmer', 'TapPay 付款確認(系統)', false, false);"
}

# 🔴 前提自檢:樁建對了嗎。這一段【不是格子】,是「量具自己先過關」——
#    樁建錯的話下面每一格都在量別的世界,而它們可能全綠。
mk_stub
STUB_ACTIVE=$(psqlq -c "select count(*) from public.staff where is_active")
STUB_T01=$(psqlq -c "select is_active from public.staff where id='test_01'")
if [ "$STUB_ACTIVE" != "4" ] || [ "$STUB_T01" != "t" ]; then
  echo "🔴 樁不對:啟用中 $STUB_ACTIVE 列(要 4)、test_01 is_active=$STUB_T01(要 t)⇒ 停,不要用它量任何東西"
  exit 2
fi
echo "  ℹ️  樁自檢通過:啟用中 4 列、test_01 啟用中 ⇒ 停用後應為 3(= B1-a 寫死的那個數)"

echo ""
echo "══ 第一段:主路徑 ══"
cell "A0 原檔跑(乾淨世界)" green run_sql_file "$B1A"

# 落地結果逐項核 —— cell 只看 exit code,這裡核的是【資料真的變成什麼】
T01=$(psqlq -c "select is_active from public.staff where id='test_01'")
T01_EXISTS=$(psqlq -c "select count(*) from public.staff where id='test_01'")
S2=$(psqlq -c "select label from public.staff where id='staff_2'")
S1=$(psqlq -c "select label from public.staff where id='staff_1'")
ACT=$(psqlq -c "select count(*) from public.staff where is_active")
chk() { # chk <名稱> <實際> <預期>
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); printf "  ✅ %-46s %s\n" "$1" "$2"
  else FAIL=$((FAIL+1)); printf "  🔴 %-46s 實際「%s」預期「%s」\n" "$1" "$2" "$3"; fi
}
chk "A0a test_01 已停用"            "$T01"        "f"
# 🔴 **A0b 是 backstop 格,不是單發可判別格**(code-reviewer 2026-08-17 實測):
#    單發 M3(UPDATE→DELETE)⇒ 整支 rc=3 回滾 ⇒ `count(test_01)` 仍是 1 ⇒ **A0b 照樣綠**。
#    要它紅,得【再】拿掉落地斷言的 `IS NULL` 與 `NOT v_still` 兩道(共兩發)⇒ rc=0、count=0。
#    ⇒ 它守的是「那兩道守門被拔掉之後」的世界,價值在防退化,**不能當成 M3 的判別依據**。
chk "A0b test_01 那一列仍在(非 DELETE;backstop 格)" "$T01_EXISTS" "1"
chk "A0c staff_2 label 已指派"      "$S2"         "Sean 測試帳號(一般員工權限,非真員工)"
# 🔴 **A0d 同型 backstop**:單發 M4(連 staff_1 一起改)⇒ 落地斷言紅 ⇒ 整支回滾
#    ⇒ staff_1 的 label 根本沒被改到 ⇒ A0d 照樣綠。**單發打不紅它。**
chk "A0d staff_1 label 未被動到(backstop 格)"    "$S1"         "員工 1(占位)"
chk "A0e 啟用中剩 3 列"             "$ACT"        "3"

echo ""
echo "══ 第二段:重跑(idempotency)══"
# 🔴 B1-a 明文把「已經是停用狀態」當【紅】而不是「沒事可做所以成功」——
#    檔內原話:「沒事可做卻回報成功」是本 repo 反覆踩過的形狀。這一格證那道斷言真的會叫。
red_because "A1 重跑(test_01 已停用)" "已經是停用狀態" "$B1A"

echo ""
echo "══ 第三段:跑錯庫要當場紅 ══"
# 🔴 這兩格的世界【已由 E 窗 production 盤點佐證是真實存在的】,不是想像:
#    報價單庫 **有** public.auth_state(inventory:48,RLS=true、欄數 8)、**沒有** public.staff
#    ⇒ 兩道守門在真實的「跑錯庫」情境下都會叫。
#    A 庫這側:supabase/migrations 全樹 grep 'auth_state' ⇒ 0 檔
#    (正向對照:grep 'public.staff' ⇒ 15 檔 ⇒ grep 是活的)
mk_stub
run_sql "drop table public.staff;"
red_because "A2 沒有 public.staff(疑似連到報價單庫)" "找不到 public.staff" "$B1A"

mk_stub
run_sql "create table public.auth_state (id boolean primary key default true);"
red_because "A3 有 public.auth_state(確定是報價單庫)" "報價單庫" "$B1A"

echo ""
echo "══ 第四段:前提斷言各自的世界 ══"
mk_stub
run_sql "delete from public.staff where id='test_01';"
red_because "A4 test_01 不存在(可能被違規 DELETE 過)" "沒有 test_01" "$B1A"

# ⛔⛔ **我在這裡下過一個【錯的】斷言,留痕不刪:**
#    我原本寫「`0.3 分母閘` 永遠不會叫、表空且 test_01 存在**邏輯上不可能**、
#    **構造不出來** = noop guard」,並且把它印進本檔輸出、寫進註解、回報給主視窗。
#    🔴 **那是錯的。adversarial-reviewer 2026-08-17 構造出來了,我複驗確認:**
#      單執行緒下確實走不到(0.2 先紅);**但 `0.2` 與 `0.3` 是【兩條獨立的 statement】,
#      READ COMMITTED 下 plpgsql 每條 statement 取【新的 snapshot】**
#      ⇒ 兩者看到的不是同一個世界,不矛盾。
#      複驗(判定式一字未動,只在 0.2 與 0.3 之間插 `pg_sleep(2)`,並發 `delete from public.staff`):
#        ⇒ `ERROR:  B1-a 前提斷言:staff 表是空的 ⇒ 這個庫的狀態不對,拒繼續。`
#        正向對照(同檔、無並發 delete)⇒ rc=0 ⇒ **量具分得出兩個世界。**
#    ⇒ **它不是 noop guard,是【窗口極窄的 TOCTOU 偵測器】。**
#    ⇒ 🔴 **修法方向也因此相反**:不是「把 0.3 移到 0.2 前面」,
#      而是承認 **0.2/0.3 讀不同 snapshot** —— 要原子的前提檢查得走
#      `REPEATABLE READ` 或把兩件事併成單一 SELECT。
#    📎 我錯在哪:宣告「構造不出來」之前**沒有窮舉維度** —— 我只想了「單一 session 的邏輯世界」,
#      **沒有想到時間/並發**。本 repo `feedback_absence-read-as-verified` 記的正是這條。
#
# ⇒ 下面這一格斷言的是**單執行緒下的現況**(紅在 0.2),**不是**「0.3 不可達」。
#    ⚠️ 這一格若哪天改成紅在「staff 表是空的」,代表有人動了順序 ⇒ 那是**預期中的變更**,
#      連同下面那行註解一起更新,不要只改期望值。
mk_stub
run_sql "delete from public.staff;"
red_because "A5 staff 空表(單執行緒下紅在 0.2)" "staff 表裡沒有 test_01" "$B1A"
echo "     ↑ 單執行緒下 0.2 先紅。⚠️ **這【不】代表 0.3 分母閘是 noop** ——"
echo "       0.2/0.3 是兩條 statement、READ COMMITTED 下各取新 snapshot,並發刪表時 0.3 會叫"
echo "       (已複驗;我原本寫成「構造不出來」是錯的,留痕在上方註解)。"
echo "       ⇒ 本 harness【沒有】覆蓋那個並發世界:它需要 pg_sleep + 第二連線,"
echo "         不是單執行緒腳本測得出來的。**認列為未覆蓋,不是不存在。**"

# 🔴 落地斷言那個寫死的 3:多一個啟用中的人就要紅。
#    這一格證它【不是恆真】—— 而它同時也是這支 migration 最會過期的一個字面:
#    正式庫只要有人新增或停用員工,apply 當天它就會紅。**那是刻意的 fail-closed。**
mk_stub
run_sql "insert into public.staff (id,label,is_manager,is_active) values ('staff_3','員工 3',false,true);"
red_because "A6 多一個啟用中的人 ⇒ 落地斷言的 3 必須紅" "啟用中的 staff 是" "$B1A"

echo ""
echo "══ 第四段之二:A7 —— 缺列時斷言必須叫(舊寫法在這裡靜默放行)══"
# 🔴🔴 本片抓到的第二個 B1-a finding,**已於同一顆 commit 修掉**(`<>` → `IS DISTINCT FROM`)。
#
# 舊病:`SELECT label INTO v_label … WHERE id='staff_2'` 之後判 `IF v_label <> '…'`。
#   `SELECT … INTO` **沒有 `STRICT`** ⇒ 零列不報錯、只把變數設成 NULL
#   ⇒ `NULL <> '…'` 是 **NULL** ⇒ `IF NULL` 走 false 分支 ⇒ **斷言不會叫。**
#   平常看不到,是因為「啟用中 = 3」那道閘通常先紅;**只要有別人補上那個名額,閘就過了。**
#
# ⚠️🔴 **這兩格【曾經】是預期綠的「洞的紀錄」,2026-08-17 修完後翻面成真正的守門格。**
#    主視窗的理由值得留:一格**預期綠、而綠的理由寫在註解裡**的測試,
#    在洞被修好之後**會繼續綠,但綠的意思已經反過來了**,而**沒有任何東西會提醒下一個人去翻面**。
#    ⇒ 「要記得翻面」不是機制。**能翻面就翻面,不要留一個靠人記得的格子。**
#
# 下面兩格用的就是當初抓到這個洞的那兩個世界,直接變成負測 + 正向對照:
mk_stub
run_sql "delete from public.staff where id='staff_2';
         insert into public.staff (id,label,is_manager,is_active) values ('staff_9','另一個人',false,true);"
A7_S2=$(psqlq -c "select count(*) from public.staff where id='staff_2'")
A7_ACT=$(psqlq -c "select count(*) from public.staff where is_active")
if [ "$A7_S2" != "0" ]; then
  FAIL=$((FAIL+1)); printf "  🔴 %-46s 前提①沒成立:staff_2 還在(%s)⇒ 測不到缺列\n" "A7 前提" "$A7_S2"
elif [ "$A7_ACT" != "4" ]; then
  # 🔴 前提②:啟用中必須【剛好】能讓那道寫死的閘通過(停用 test_01 後 = 3),
  #    否則這一格會紅在「啟用中的 staff 是 N」而不是紅在缺列 ⇒ 紅錯地方。
  FAIL=$((FAIL+1)); printf "  🔴 %-46s 前提②沒成立:啟用中 %s 列(要 4)⇒ 會紅在人數閘,證不了缺列\n" "A7 前提" "$A7_ACT"
else
  red_because "A7 staff_2 缺列 ⇒ 指派斷言必須叫" "指派沒有生效" "$B1A"
fi
# 🔴 正向對照:同一形狀但 staff_2 在 ⇒ 必須綠,且 label 真的被改。
#    少了它,A7 的紅可能來自「這支 migration 在任何缺人的世界都紅」而不是那道斷言。
mk_stub
cell "A7b 正向對照:staff_2 在 ⇒ 綠" green run_sql_file "$B1A"
A7B_LABEL=$(psqlq -c "select label from public.staff where id='staff_2'")
chk "A7c 且 label 真的被改到" "$A7B_LABEL" "Sean 測試帳號(一般員工權限,非真員工)"

# 🔴 同一個病的第二處:staff_1 的【對照組】斷言。整列不見時舊寫法一樣靜默放行
#    ⇒ 「有人把 staff_1 刪掉」與「staff_1 好好的」在舊斷言眼裡一模一樣。
mk_stub
run_sql "delete from public.staff where id='staff_1';
         insert into public.staff (id,label,is_manager,is_active) values ('staff_8','補位',false,true);"
A7D_S1=$(psqlq -c "select count(*) from public.staff where id='staff_1'")
if [ "$A7D_S1" != "0" ]; then
  FAIL=$((FAIL+1)); printf "  🔴 %-46s 前提沒成立:staff_1 還在 ⇒ 測不到缺列\n" "A7d 前提"
else
  red_because "A7d staff_1 缺列 ⇒ 對照組斷言必須叫" "本支不該碰它" "$B1A"
fi

echo ""
echo "══ 第四段之三:COMMENT ON TABLE 是【整段覆蓋】,而它原本零覆蓋 ══"
# 🔴 adversarial-reviewer 2026-08-17 `F6`:B1-a 用 `COMMENT ON TABLE public.staff IS '…'`
#    **覆蓋**既有註解(原文在 `…20260726120000_m4b_e8a1_staff_table.sql:26-27`),
#    而 20 格裡**沒有一格讀 `obj_description`** ⇒ 覆蓋成不成功、內容對不對,都在量測之外。
# ⇒ 補兩格:新註解真的寫進去了、且**舊註解那句關鍵字面確實被換掉**(這是覆蓋不是附加的證據)。
# ⚠️ 這兩格**不評價「該不該覆蓋」** —— 那是設計決定。它們只確保「覆蓋這件事是被看見的」。
mk_stub
run_sql "comment on table public.staff is 'M-4b E8-A1 後台 staff 名單。id 是寫入 admin_audit_log.actor 的穩定 slug;停用走 is_active=false、不物理刪除。本表只提供名單,不驗證目前操作者身分。';"
BEFORE_C=$(psqlq -c "select obj_description(to_regclass('public.staff'),'pg_class') like '%不驗證目前操作者身分%'")
# 🔴 這一發的 rc 要接住(code-reviewer 2026-08-17 `F7`):B1-a 若因**無關原因**失敗,
#    下面兩格仍會紅(fail-closed、不是假綠),但**訊息會指向錯的地方** ——
#    讀的人會以為「COMMENT 沒寫進去」,而真因是整支根本沒跑完。
if ! run_sql_file "$B1A" > /dev/null 2>&1; then
  FAIL=$((FAIL+1)); printf "  🔴 %-46s B1-a 在本世界跑失敗 ⇒ 下面兩格的紅【不是】COMMENT 的問題\n" "A8 前置"
fi
AFTER_NEW=$(psqlq -c "select obj_description(to_regclass('public.staff'),'pg_class') like '%永不重用%'")
AFTER_OLD=$(psqlq -c "select obj_description(to_regclass('public.staff'),'pg_class') like '%不驗證目前操作者身分%'")
if [ "$BEFORE_C" != "t" ]; then
  FAIL=$((FAIL+1)); printf "  🔴 %-46s 前提沒成立:樁的舊註解沒設好 ⇒ 證不了覆蓋\n" "A8 前提"
else
  chk "A8 新註解已寫入(含「永不重用」)"        "$AFTER_NEW" "t"
  chk "A8b 舊註解關鍵字面已被覆蓋掉(證明是覆蓋)" "$AFTER_OLD" "f"
fi

echo ""
echo "══ 第五段:突變 —— 每一道落地斷言都要能被單獨打紅 ══"
# 🔴 錨點唯一性逐發現數。命中數 ≠ 1 ⇒ 那一發沒有判別力,不是通過。
mut() { # mut <名稱> <sed 表達式> <驗證用 grep pattern> <期望訊息片段>
  local name="$1" expr="$2" pat="$3" want="$4"
  mk_stub
  sed "$expr" "$B1A" > "$D/mut.sql"
  local n; n=$(grep -c "$pat" "$D/mut.sql")
  if [ "$n" != "1" ]; then
    FAIL=$((FAIL+1)); printf "  🔴 %-46s 突變沒生效(pattern 命中 %s 次,要 1)⇒ 無判別力\n" "$name" "$n"
  else
    red_because "$name" "$want" "$D/mut.sql"
  fi
}

# M1:把停用那道 UPDATE 拿掉 ⇒ 落地斷言「test_01 仍是 is_active=true」必須叫
mut "M1 拿掉停用 UPDATE ⇒ 停用斷言要紅" \
    "s/^   SET is_active  = false,\$/   SET is_active  = is_active,/" \
    'SET is_active  = is_active,' \
    '停用沒有生效'

# M2:把 staff_2 的 label 指派拿掉 ⇒ 「指派沒有生效」必須叫
mut "M2 拿掉 staff_2 指派 ⇒ 指派斷言要紅" \
    "s/^   SET label      = 'Sean 測試帳號(一般員工權限,非真員工)',\$/   SET label      = label,/" \
    'SET label      = label,' \
    '指派沒有生效'

# M3:把 UPDATE 改成 DELETE ⇒ 「那一列不見了」必須叫
#    🔴 這一格守的是本片最核心的設計決定:is_active 可逆、DELETE 不可逆,
#      而 admin_audit_log.actor 是 text 欄不是 FK ⇒ 刪掉會製造孤兒。
# ⚠️🔴 錨點用 `WHERE id = 'test_01';` **不是** `^UPDATE public.staff$` ——
#    後者在本檔命中 **2 次**(test_01 一次、staff_2 一次)。
#    第一版就是那樣寫的,而**上面那道唯一性檢查當場把它擋下來**(印「命中 2 次,要 1」)。
#    📎 這正是這道檢查存在的理由:沒有它,sed 會改到**兩個** UPDATE,
#      而那一格照樣紅 ⇒ 紅得理直氣壯,卻不是我要測的那件事。
# ⚠️🔴 **`want` 從 `不見了` 收緊成 `本支只該 UPDATE`**(adversarial-reviewer 2026-08-17 `F3`):
#    `不見了` 這三個字在落地斷言裡**有兩句都含**:
#      · `test_01 不見了 —— 本支只該 UPDATE,不該讓它消失。`  ← IS NULL 那道(實際叫的是它)
#      · `test_01 那一列不見了。`                              ← EXISTS 那道
#    ⇒ 舊的 `want` **分不出 M3 紅在哪一道** = 本檔 `red_because` 存在就是為了擋的那件事,
#      而我自己在第一版犯了它。收緊後 M3 綠,證明它紅在 IS NULL 那道。
mut "M3 改成 DELETE ⇒ IS NULL 那道要紅" \
    "s|^ WHERE id = 'test_01';\$| WHERE id = 'test_01';\nDELETE FROM public.staff WHERE id = 'test_01';|" \
    "^DELETE FROM public.staff WHERE id = 'test_01';\$" \
    '本支只該 UPDATE'
# 🔴🔴 **而 `EXISTS` 那道(「那一列不見了」)是【真的不可達】—— 但理由不是 reviewer 說的那個。**
#    reviewer 說「`IS NULL` 先擋 ⇒ 走到 EXISTS 時列必定在」。**結論對,理由不完整。**
#    B 窗複驗(在 is_active 讀取之後、EXISTS 之前插 pg_sleep(2),並發 `delete … where id='test_01'`):
#      ⇒ B1-a **rc=0**,EXISTS 那道**沒有叫**
#      ⇒ 量具自檢:並發那句印 **`DELETE 1`**、事後 `count(*)`=**0**
#        ⇒ **DELETE 真的執行了,只是被擋到 COMMIT 之後才落地。**
#    ⇒ 真正的理由是:**本交易自己的 `UPDATE` 已經把那一列寫鎖住**
#      ⇒ 落地斷言期間**沒有任何併發 session 刪得掉它**。
#    📎 **與 `0.3` 的差別正好在這裡**:0.3 在 **precheck**、UPDATE 還沒發生 ⇒ 無鎖 ⇒ 並發刪得掉 ⇒ 可達;
#      EXISTS 在 UPDATE **之後** ⇒ 有鎖 ⇒ 不可達。
#    ⚠️ 理由寫準的用處:有人若照 reviewer 的理由去「調 IS NULL 的順序」,**什麼都不會改變**。
#    ⚠️🔴 **而這句「不可達」本身要帶限定** —— 我三十行前才剛撤回一次同款句形。
#      **限本 schema 的現況**:`staff` 沒有 DELETE 路徑的 trigger、指向它的 FK 全是
#      `ON DELETE RESTRICT`(3 檔 6 處)、且落地斷言在本交易自己的 UPDATE 之後。
#      我列舉過的維度只有【並發 DELETE】一種;**其他維度未窮舉,不是「已證明不可能」。**

echo ""
echo "══ 第六段:對照組 —— staff_1 不得被動到 ══"
# 🔴 這一格與 M2 不同:M2 證「該改的沒改會紅」,這一格證「不該改的被改了也會紅」。
#    少了它,一支「把所有人的 label 都改成同一句」的 migration 會全綠。
mk_stub
sed "s|^ WHERE id = 'staff_2';\$| WHERE id IN ('staff_2','staff_1');|" "$B1A" > "$D/mut_s1.sql"
if [ "$(grep -c "WHERE id IN ('staff_2','staff_1');" "$D/mut_s1.sql")" != "1" ]; then
  FAIL=$((FAIL+1)); printf "  🔴 %-46s 突變沒生效 ⇒ 無判別力\n" "M4 連 staff_1 一起改"
else
  red_because "M4 連 staff_1 一起改 ⇒ 對照組要紅" "本支不該碰它" "$D/mut_s1.sql"
fi

echo ""
echo "══════════════════════════════════════════════════════════"
printf "通過 %s 格 / 失敗 %s 格\n" "$PASS" "$FAIL"
echo "⚠️ 這些綠只證『SQL 與斷言邏輯對』——【樁與正式 A 庫有落差】:"
echo "   · 樁沒有 updated_at trigger ⇒ **updated_at 零覆蓋**(不是驗過了)"
echo "   · 樁的 staff 六列是照 2026-08-16 實查【手抄】的;正式庫現況若已改變,"
echo "     A0e 那格的 3 會在 apply 當天紅 —— 那是 fail-closed,不是這支 harness 錯。"
echo "🔴 本檔【未】對正式 A 庫實跑,Supabase 端未確認。"
[ "$FAIL" = "0" ] || exit 1
exit 0
