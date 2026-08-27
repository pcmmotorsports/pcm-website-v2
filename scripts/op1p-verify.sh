#!/usr/bin/env bash
# ============================================================
# OP1 補丁片(A10 拍板落地)行為驗證 harness
#
# 驗的是**這一顆 commit 改了什麼**,不是整支 OP1 migration 的結構(那由 migration
# 自己的檔尾 fail-closed 斷言在 apply 當下驗)。
#
# 本片的改動只有一句:`order_payments_reversal_shape` 的沖銷分支
#   `amount < 0` → `amount <> 0`(Sean 2026-08-10 晨拍 Q1=A,允許沖銷之沖銷)。
# ⇒ 六格(G0 自我測試 + G1 對照組 + 兩發真探針 + G5 突變 + G6 收尾):
#   G2 正測  誤沖的恢復路**走得通**:P(+500) → R1(-500) → R2(+500) 三列都寫得進,且 SUM=500。
#   G3 負測  「負數的收款」**仍然**被 `order_payments_reversal_shape` 擋(逐字比 conname,
#            不是「反正紅了就算擋住」——放寬如果寫壞成整條恆真,這格會綠不了)。
#   G5 突變  把 CHECK 換回舊版 `amount < 0`(先斷言定義**真的變了**)⇒ **只有 G2 轉紅**、
#            G3 照樣紅在同一個 conname ⇒ 證明 G2 的綠是這一句放寬換來的,不是恆真。
#   G6 收尾  G5 動過的**約束定義**回到原狀 + gate 仍不在 + A9 三支仍在崗(只數資料列看不到這一層)。
#   ~~G4 邊界(自環:gate 在時紅在 gate、拿掉就寫得進)~~ **2026-08-11 #396 退役**,理由見該段原位註解。
#
# 🏁 **2026-08-11 #396:本檔解除退役,改寫成「OP2b 之後」版。**
#    ~~2026-08-10 的處置:本檔已退役、後繼者 = `scripts/op2b-verify.sh`;理由是「本檔證的三件事
#    在 OP2b 之後由更強的守門接手」~~ —— 🔴 **那句話只對了一半,實查為證**:
#    `grep -rn 'reversal_shape' scripts/*.sh` **只命中本檔** ⇒ OP1 的交付物
#    `order_payments_reversal_shape`(A10 放寬後的那條 CHECK)在 OP2b 之後**沒有第二個 harness 在看**。
#    A9 的反號律管的是「沖銷列的金額對不對」,**管不到**「非沖銷的收款列不得為負」(本檔 G3),
#    也不會在有人把 CHECK 改回舊版時指名道姓(本檔 G1/G5)。
#    ⇒ 保留退役決定裡**正確**的那一半(擋環不在這裡重寫,見 G4 原位註解),
#      收回**過寬**的那一半(本檔不是只剩歷史證據,它還有唯一的活職責)。
#
# ⚠️ 保鮮期(這次寫成可執行的,不是承諾):前置閘 `gate_precondition` 要求
#    「dormant gate 不在 + A9 三支 trigger 在崗**且是活的**」,不成立就 `exit 2` **拒跑**
#    —— 不給會被誤讀成「OP1 壞了」的紅,也不給假綠。
#
# 🔴 零留痕:每個 case 在自己的交易裡跑完 `ROLLBACK`(每格結束驗一次資料列數 = 0);
#    **約束層**由收尾的 G6 驗 —— G5 動的是 DDL,只數資料列看不到「約束被改掉沒回來」,
#    那是 code-reviewer 當初打回的缺口。
#
# 🔴 判定紀律(照 a7bm-verify.sh 檔頭那四條,不重蹈):
#   ① 突變必須紅在**指定的那條斷言**,不是「反正紅了就算抓到」⇒ 每個 case 自己比 conname。
#   ② 突變要驗「真的改到東西」⇒ G5 先比 `pg_get_constraintdef` 含 `< 0` 才往下跑。
#   ③ 對照組必跑 ⇒ G1 先證庫裡的定義就是新版(含 `<> 0`),否則後面全部無意義。
#   ④ 判定一律 fail-closed:psql 退出碼 + 每個 case 自己的 sentinel 都要在,少一個就算紅。
#
# 用法:
#   bash scripts/op1p-verify.sh all <workdir>     # provision 拋棄式 PG → 跑 → teardown
#   bash scripts/op1p-verify.sh run <workdir>     # 對已經起好的庫跑(PORT 要對得上)
#   PORT=54372 bash scripts/op1p-verify.sh all /tmp/op1p
# ============================================================
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

MODE="${1:?用法: op1p-verify.sh all|run <workdir>}"
WORK="${2:?缺 workdir(必須是 /tmp 底下的短路徑,例 /tmp/op1p)}"
PORT="${PORT:-54372}"
URL="postgresql://postgres@127.0.0.1:${PORT}/postgres"
export LC_ALL=C

PASS=0; FAIL=0
ok()  { printf '  ✅ %s\n' "$1"; PASS=$((PASS+1)); }
bad() { printf '  🔴 %s\n' "$1"; FAIL=$((FAIL+1)); }
log() { echo "== $* =="; }

# workdir 身分閘(all 模式會對它跑 `rm -rf`)
# 🔴🔴 codex 關卡2 R2 打回我第一版:`case "$WORK" in /tmp/?*)` 這種寫法**放行 `/tmp//`**
#    (`?` 吃掉第二個斜線)⇒ 後面那句就變成 `rm -rf /tmp//` = 清掉整個 /tmp。
#    repo 既有的 a7bm-verify.sh 用的是同一個寫法(同款風險,已回報主視窗、不在本片範圍內動它)。
# ⇒ 現在逐條擋:必須是 /tmp/<非斜線開頭的名字>、不得有尾斜線、不得有連續斜線、不得含 ..、
#    且本身不得是 symlink(否則 rm -rf 會照著連結刪到別的地方)。
case "$WORK" in
  /tmp/[!/]*) : ;;
  *) echo "🔴 workdir 必須是 /tmp/<名字>(收到:$WORK)"; exit 2 ;;
esac
case "$WORK" in
  */)    echo "🔴 workdir 不得以斜線結尾(收到:$WORK)"; exit 2 ;;
  *//*)  echo "🔴 workdir 不得含連續斜線(收到:$WORK)"; exit 2 ;;
  *..*)  echo "🔴 workdir 不得含 ..(收到:$WORK)"; exit 2 ;;
esac
if [ -L "$WORK" ]; then
  echo "🔴 workdir 是 symlink(收到:$WORK)⇒ rm -rf 會刪到它指向的地方"; exit 2
fi

# 🔴 埠賭注是 B-357-NOTE 殘項 C 點名的坑:埠被別的視窗佔住時,initdb/pg_ctl 失敗而
#    後續 psql 會**靜默連到別人的庫** ⇒ 整輪的紅綠都不是在講我這支 migration。
require_free_port() {
  local pids
  # 🔴 code-reviewer nit:`lsof … || true` 在 lsof 不存在時**靜默放行**(fail-open)⇒ 先確認工具在。
  command -v lsof >/dev/null 2>&1 || {
    echo "🔴 找不到 lsof ⇒ 埠檢查做不到,拒絕往下跑(fail-closed;不是「檢查過了沒問題」)"; exit 2; }
  pids="$(lsof -nP -iTCP:${PORT} -sTCP:LISTEN -t 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "🔴 port ${PORT} 已被佔用(pid: $(echo "$pids" | tr '\n' ' '))⇒ 換一個埠重跑:
    PORT=54373 bash scripts/op1p-verify.sh all $WORK"
    exit 2
  fi
}

# run_case <名稱> <期望 sentinel> <SQL>
#   SQL 自己負責 RAISE EXCEPTION(壞掉時)與 RAISE NOTICE '<sentinel>'(通過時)。
#   判定三道:psql 退出碼 = 0、sentinel 在輸出裡、探測交易跑完本表零殘列。
run_case() {
  local name="$1" sentinel="$2" sql="$3" out rc rows
  out="$(printf '%s' "$sql" | psql "$URL" -v ON_ERROR_STOP=1 -qtA -f - 2>&1)"; rc=$?
  if [ "$rc" -ne 0 ]; then
    bad "$name:psql rc=$rc ⇒ $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-300)"; return 1
  fi
  if ! printf '%s' "$out" | grep -Fq "$sentinel"; then
    bad "$name:退出碼 0 但 sentinel「$sentinel」不在輸出裡 ⇒ 判定無效(可能整段被跳過)
       實得:$(printf '%s' "$out" | tr '\n' ' ' | cut -c1-300)"; return 1
  fi
  rows="$(psql "$URL" -qtA -c 'SELECT count(*) FROM public.order_payments' 2>/dev/null)"
  if [ "$rows" != "0" ]; then
    bad "$name:探測交易結束後 order_payments 有 $rows 列 ⇒ 沒 ROLLBACK 乾淨,錢帳被污染"; return 1
  fi
  ok "$name"
}

# ── 🔴🔴 前置閘:本 harness 綁在「OP2b 之前」那個狀態 ────────────────────────
# codex 關卡2 R2 打回我第一版的宣稱(「G4 在 A9 落地後不會變成假警報」)—— **那句是錯的**:
#   OP2b 落地後 dormant gate 被 DROP,①每個 case 前置那句 `DROP CONSTRAINT` 會直接報錯
#   ②G4 期待的 conname 也不再是 gate ⇒ 整支會**全紅**,而紅的原因與它要驗的事情無關 = 誤導。
# ⇒ 改成 fail-closed 的**拒跑**:gate 不在就當場 exit 2 並說清楚要怎麼處理,
#    不給出會被誤讀成「OP1 壞了」的紅,也不給假綠。
# 🔴 身分閘(照 d1t2 provision 的作法):確認「我連到的就是這個 workdir 的那台」。
#    code-reviewer nit:`run` 模式沒有埠閘 ⇒ 埠被別的視窗佔住時會靜默連到別人的庫,
#    而那台庫上什麼都可能是綠的。data_directory 是唯一不會說謊的識別。
cluster_identity() {
  local dd
  dd="$(psql "$URL" -qtA -c "SELECT current_setting('data_directory')" 2>/dev/null || true)"
  if [ "$dd" != "$WORK/pgdata" ]; then
    echo "🔴 身分閘:PORT=${PORT} 連到的 data_directory=${dd:-<查不到>},期望 ${WORK}/pgdata
    ⇒ 你連到的不是這個 workdir 的 cluster(很可能是別的視窗的),拒繼續。"
    exit 2
  fi
}

# 🔴 2026-08-11 #396 反轉:前置由「dormant gate 必須**在**」改成「gate 必須**不在** + A9 三支 trigger
#    必須在**且是活的**」。理由見檔頭;OP2b 已把 gate 與 A9 同交易處理掉,舊前置永遠不成立。
# 🔴 **不只驗存在**(關卡1 codex MF2):存在性斷言對「還在但失效」全盲 ——
#    disabled / 綁到別的函式 / 掛了 WHEN 條件,三種都會讓後面每一格在「沒有 A9」的世界裡跑而不自知。
#    ⇒ 逐支綁 `(tgrelid, tgname)` 並釘 `tgenabled='O'` + `tgfoid`(對 regprocedure)+ `tgtype`
#      (7 / 19 / 11,值抄自 `20260810130000_…op2b….sql:497-501`,那裡逐字寫明「寫死才擋得住
#      『被改成 AFTER』或『多掛一個事件』」)+ WHEN:**無 WHEN 兩支釘 `tgqual IS NULL`、
#      帶 WHEN 那支逐字比 `pg_get_triggerdef`**(三支的 WHEN 不一樣,見下方 A9 那段)。
# 🔴 **本檔沒有 `set -e`**(關卡1 codex MF3):psql 失敗會回空字串,而 `"" != "1"` 與 `"0" != "1"` 在
#    字串比較下**看起來一樣**。⇒ 這裡分開看 rc 與空值,兩種都 exit 2,絕不當成「查到 0」往下跑。
gate_precondition() {
  local n rc
  n="$(psql "$URL" -qtA -c "SELECT count(*) FROM pg_catalog.pg_constraint
        WHERE conname = 'order_payments_dormant_until_triggers'
          AND conrelid = 'public.order_payments'::regclass" 2>/dev/null)"; rc=$?
  if [ "$rc" -ne 0 ] || [ -z "$n" ]; then
    echo "🔴 查 dormant gate 的那句 psql 失敗(rc=$rc、輸出=${n:-<空>})⇒ 拒跑(fail-closed)。
    這不是「查到 0」—— 連不上或查詢壞掉時繼續跑,後面每一格的紅綠都不是在講被測物。"
    exit 2
  fi
  if [ "$n" != "0" ]; then
    echo "🔴 dormant gate 還在(查得 count=$n)。
    本 harness 現在驗的是 **OP2b 之後**的世界(gate 已 DROP、A9 三支 trigger 在崗)。
    · 若這是因為這個庫**還沒套到 OP2b**:換一個套滿全套 migration 的拋棄式庫再跑。
    · 若這是因為連錯庫:先確認 PORT=${PORT} 這個 cluster 是不是你剛建的那個(身分閘已在上一步跑過)。"
    exit 2
  fi

  # A9 三支 trigger:存在 + 啟用中 + 綁對函式 + **WHEN 條件逐支釘死**。任一不成立 = 這個庫沒有 A9,拒跑。
  # 🔴 三支的 WHEN 不一樣,不能一律要求 `tgqual IS NULL`(我第一版就這樣寫,實跑當場得 2/3):
  #    `..._reversal_amount_bi` **本來就帶** `WHEN ((new.reverses_payment_id IS NOT NULL))`
  #    (OP2b 建它時就寫了,設計如此);另外兩支無 WHEN。
  #    ⇒ 帶 WHEN 那支改成**逐字比對它的定義**(`WHEN (false)` 這種掏空手法一樣抓得到);
  #      無 WHEN 那兩支維持 `tgqual IS NULL`。
  local a9 rc9
  a9="$(psql "$URL" -qtA -c "SELECT count(*) FROM pg_trigger t
        WHERE NOT t.tgisinternal
          AND t.tgrelid = 'public.order_payments'::regclass
          AND t.tgenabled = 'O'
          AND (
               (t.tgname = 'order_payments_reversal_amount_bi'
                AND t.tgfoid = 'public.pcm_op2b_reversal_amount()'::regprocedure
                AND t.tgtype = 7
                AND pg_get_triggerdef(t.oid) LIKE '%WHEN ((new.reverses_payment_id IS NOT NULL))%')
            OR (t.tgname = 'order_payments_immutable_bu'
                AND t.tgfoid = 'public.pcm_op2b_immutable_columns()'::regprocedure
                AND t.tgtype = 19 AND t.tgqual IS NULL)
            OR (t.tgname = 'order_payments_no_delete_bd'
                AND t.tgfoid = 'public.pcm_op2b_no_delete()'::regprocedure
                AND t.tgtype = 11 AND t.tgqual IS NULL))" 2>/dev/null)"; rc9=$?
  if [ "$rc9" -ne 0 ] || [ -z "$a9" ]; then
    echo "🔴 查 A9 三支 trigger 的那句 psql 失敗(rc=$rc9、輸出=${a9:-<空>})⇒ 拒跑(fail-closed)。"
    exit 2
  fi
  if [ "$a9" != "3" ]; then
    echo "🔴 A9 三支 trigger 不是三支都在崗(實得 $a9 / 期望 3)。
    判準含「啟用中(tgenabled='O')、綁對函式(tgfoid)、**事件/時機(tgtype 7/19/11)**、WHEN 條件逐支對」——
    **只是名字還在不算數**:disabled、改綁別的函式、把 BEFORE 改成 AFTER 或多掛一個事件、
    把 WHEN 換成 (false),每一種都讓它什麼都不擋(tgtype 這條實測有牙:把 no_delete_bd
    改成 BEFORE INSERT、其餘全不動 ⇒ 這裡當場 2/3)。
    這個庫沒有(完整的)A9 ⇒ 後面每一格會在「沒有反號律」的世界裡跑,紅綠都不算數,拒跑。"
    exit 2
  fi
}

# 每個 case 共用的前置:抓真的 order / staff 當 fixture(FK 是 RESTRICT,假 id 過不了)
# 🔴 2026-08-11 #396:尾端那句 `EXECUTE 'ALTER TABLE … DROP CONSTRAINT …dormant…'` **已刪** ——
#    gate 早被 OP2b DROP 掉了,再 DROP 一次會直接紅在「約束不存在」,而那與被測物無關。
FIXTURE_PRELUDE=$'  SELECT id INTO v_o FROM public.orders ORDER BY created_at LIMIT 1;\n  SELECT id INTO v_s FROM public.staff ORDER BY id LIMIT 1;\n  IF v_o IS NULL OR v_s IS NULL THEN\n    RAISE EXCEPTION \'fixture 不足(orders=% staff=%)⇒ 這輪沒有證據,不是通過\', v_o, v_s;\n  END IF;'

if [ "$MODE" = "all" ]; then
  log "0/6 provision 拋棄式 PG17(重用 d1t2 的 provision,不複製貼上)"
  require_free_port
  rm -rf "$WORK"; mkdir -p "$WORK"
  PORT="$PORT" scripts/d1t2-rehearsal.sh provision "$WORK" > "$WORK/provision.log" 2>&1 \
    || { echo "🔴 provision 失敗,見 $WORK/provision.log"; tail -20 "$WORK/provision.log"; exit 1; }
  ok "provision 完成(全部既有 migration 依序套用,含 OP1 與 OP2a)"
fi

# 🔴 兩道前置閘都要在庫起來之後才問得到(all 模式:provision 之後;run 模式:立刻)
cluster_identity
gate_precondition

# ── G0 harness 自我測試:壞掉的 SQL 必須讓 run_case 判紅 ──────────────────
log "1/6 G0 harness 自我測試"
if run_case "G0-selftest(這格應該紅)" "NEVER" "SELECT this_column_does_not_exist;" >/dev/null 2>&1; then
  bad "G0:壞掉的 SQL 竟然被判成通過 ⇒ 本 harness 的判定失效,後面全部不算數"
  echo "════ PASS=$PASS FAIL=$FAIL ════"; exit 1
fi
FAIL=$((FAIL-1))   # G0 預期紅,把它從 FAIL 帳裡扣回來(上一版還有一句 `PASS=$PASS` 的 no-op,已刪)
ok "G0:壞掉的 SQL 會被判紅(判定不是恆真)"

# ── G1 對照組:庫裡的定義就是**放寬後**的新版 ──────────────────────────────
log "2/6 G1 對照組(不是新版就別往下跑)"
run_case "G1 reversal_shape 定義含 <> 0(= A10 拍板後的版本)" "OP1P-G1-OK" "
DO \$g1\$
DECLARE v_def text;
BEGIN
  SELECT pg_catalog.pg_get_constraintdef(oid) INTO v_def
    FROM pg_catalog.pg_constraint
   WHERE conname = 'order_payments_reversal_shape'
     AND conrelid = 'public.order_payments'::regclass;
  IF v_def IS NULL THEN RAISE EXCEPTION 'reversal_shape 不在'; END IF;
  IF v_def NOT LIKE '%<> 0%' THEN
    RAISE EXCEPTION '庫裡的 reversal_shape 還是舊版(定義=%)⇒ 這個 workdir 套的不是本片改後的 migration', v_def;
  END IF;
  RAISE NOTICE 'OP1P-G1-OK';
END
\$g1\$;"

# ── G2 正測:沖銷之沖銷鏈走得通(本片存在的理由)────────────────────────────
log "3/6 G2 正測:P(+500) → R1(-500) → R2(+500)"
run_case "G2 誤沖恢復鏈三列都寫得進且 SUM=500" "OP1P-G2-OK" "
BEGIN;
DO \$g2\$
DECLARE v_o uuid; v_s text; v_p uuid; v_r1 uuid; v_sum integer;
BEGIN
$FIXTURE_PRELUDE
  INSERT INTO public.order_payments (order_id, rail, amount, received_at, rec_trade_id, actor)
  VALUES (v_o, 'card', 500, now(), 'OP1P-PROBE-TRADE', v_s) RETURNING id INTO v_p;

  INSERT INTO public.order_payments (order_id, rail, amount, received_at,
                                     reverses_payment_id, reversal_reason, actor)
  VALUES (v_o, 'card', -500, now(), v_p, '誤沖:登錯了', v_s) RETURNING id INTO v_r1;

  -- 🔴 這一列在放寬前**物理上構造不出來**(舊 CHECK 強制沖銷列 < 0)
  INSERT INTO public.order_payments (order_id, rail, amount, received_at,
                                     reverses_payment_id, reversal_reason, actor)
  VALUES (v_o, 'card', 500, now(), v_r1, '沖銷之沖銷:把誤沖救回來', v_s);

  SELECT sum(amount)::integer INTO v_sum FROM public.order_payments WHERE order_id = v_o;
  IF v_sum <> 500 THEN
    RAISE EXCEPTION '鏈寫進去了但「已收」不是 500(實得 %)⇒ SUM(amount) 不變式破了', v_sum;
  END IF;
  RAISE NOTICE 'OP1P-G2-OK';
END
\$g2\$;
ROLLBACK;"

# ── G3 負測:負數的收款仍被同一條 CHECK 擋(逐字比 conname)───────────────
log "4/6 G3 負測:負數收款"
run_case "G3 負數收款被 order_payments_reversal_shape 擋下" "OP1P-G3-OK" "
BEGIN;
DO \$g3\$
DECLARE v_o uuid; v_s text; v_con text;
BEGIN
$FIXTURE_PRELUDE
  BEGIN
    INSERT INTO public.order_payments (order_id, rail, amount, received_at, rec_trade_id, actor)
    VALUES (v_o, 'card', -500, now(), 'OP1P-PROBE-NEG', v_s);
    RAISE EXCEPTION '負數的收款竟然寫得進去 ⇒ 放寬時把收款那半也一起放掉了';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con IS DISTINCT FROM 'order_payments_reversal_shape' THEN
      RAISE EXCEPTION '負數收款是被 % 擋的,不是 reversal_shape ⇒ 這格證不到本條還在守',
                      coalesce(v_con, '(conname 為 NULL)');
    END IF;
  END;
  RAISE NOTICE 'OP1P-G3-OK';
END
\$g3\$;
ROLLBACK;"

# ── G4 已退役(2026-08-11 #396)────────────────────────────────────────────
# ~~原 G4:自環在 gate 還在時紅在 gate、gate 拿掉就寫得進去(雙態,用來證明「唯一防線是 gate」)~~
# 🔴 **這一格是刻意退役的歷史斷言,不是「搬到別處」** —— 它描述的世界(dormant gate 還在)
#    已被 OP2b 同交易 DROP 掉,那個雙態現在物理上構造不出來,任何人都接不了手。
# ✅ 仍然被守住的是「**環寫不進去**」這件事,而且守得比這裡強(逐字比 SQLSTATE):
#    · `supabase/migrations/20260810130000_…op2b….sql:294`(說明)、`:318-378`(N1/N2/N3 實碼)
#      —— apply 當下三發負向探針:N1(parent 不存在)/ N2(**自環**)/ N3(multi-row 互指環),皆斷言 `P2B32`。
#      ⚠️ 這三發只在**套到 OP2b 那一刻**跑;對「全套 migration 套完的最終狀態」,自環的覆蓋在下一條。
#    · `scripts/op2b-verify.sh:251-269` —— sibling CTE 互指環仍被擋,亦斷言 `P2B32`。
# ⇒ 這裡**不重寫一份 A9 擋環測試**:那會變成兩套講同一件事的守門,而且新寫的那份沒有
#    上面那組完整的 SQLSTATE 矩陣 = 比較弱的第二把。要加深 A9 覆蓋請加在 `op2b-verify.sh`。
# ⇒ 本檔改為**只守 OP1 自己的交付物**(`order_payments_reversal_shape` 那條放寬後的 CHECK),
#    它在全 repo 的 harness 裡沒有第二個人在看(`grep -rn reversal_shape scripts/*.sh` 只命中本檔)。

# ── G5 突變:換回舊版 CHECK ⇒ 只有 G2 轉紅、G3 不動 ──────────────────────
log "5/6 G5 突變(把 CHECK 換回 amount < 0)"
run_case "G5 舊版 CHECK 下沖銷之沖銷當場紅在 reversal_shape、負數收款照樣紅(方向可觀測)" "OP1P-G5-OK" "
BEGIN;
DO \$g5\$
DECLARE v_o uuid; v_s text; v_p uuid; v_r1 uuid; v_con text; v_def text;
BEGIN
$FIXTURE_PRELUDE
  EXECUTE 'ALTER TABLE public.order_payments DROP CONSTRAINT order_payments_reversal_shape';
  EXECUTE 'ALTER TABLE public.order_payments ADD CONSTRAINT order_payments_reversal_shape
           CHECK ((reverses_payment_id IS NULL AND amount > 0)
                  OR (reverses_payment_id IS NOT NULL AND amount < 0))';
  -- ② 突變要先證「真的改到東西」,否則下面的紅是別的原因
  SELECT pg_catalog.pg_get_constraintdef(oid) INTO v_def
    FROM pg_catalog.pg_constraint
   WHERE conname = 'order_payments_reversal_shape'
     AND conrelid = 'public.order_payments'::regclass;
  IF v_def IS NULL OR v_def NOT LIKE '%< 0%' OR v_def LIKE '%<> 0%' THEN
    RAISE EXCEPTION '突變沒套上(定義=%)⇒ 這一輪沒有證據', coalesce(v_def, '(NULL)');
  END IF;

  INSERT INTO public.order_payments (order_id, rail, amount, received_at, rec_trade_id, actor)
  VALUES (v_o, 'card', 500, now(), 'OP1P-PROBE-TRADE', v_s) RETURNING id INTO v_p;
  INSERT INTO public.order_payments (order_id, rail, amount, received_at,
                                     reverses_payment_id, reversal_reason, actor)
  VALUES (v_o, 'card', -500, now(), v_p, '誤沖:登錯了', v_s) RETURNING id INTO v_r1;

  BEGIN
    INSERT INTO public.order_payments (order_id, rail, amount, received_at,
                                       reverses_payment_id, reversal_reason, actor)
    VALUES (v_o, 'card', 500, now(), v_r1, '沖銷之沖銷', v_s);
    RAISE EXCEPTION '舊版 CHECK 下沖銷之沖銷竟然寫得進去 ⇒ G2 的綠不是這句放寬換來的(恆真)';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con IS DISTINCT FROM 'order_payments_reversal_shape' THEN
      RAISE EXCEPTION '舊版下擋住 R2 的是 %,不是 reversal_shape', coalesce(v_con, '(NULL)');
    END IF;
  END;

  -- 對照:同一個突變下,G3 的負數收款仍舊紅在同一條 ⇒ 突變只動了沖銷那半、不是整條掏空
  BEGIN
    INSERT INTO public.order_payments (order_id, rail, amount, received_at, rec_trade_id, actor)
    VALUES (v_o, 'card', -500, now(), 'OP1P-PROBE-NEG', v_s);
    RAISE EXCEPTION '突變下負數收款竟然寫得進去 ⇒ 這個突變不只換掉沖銷那半';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con IS DISTINCT FROM 'order_payments_reversal_shape' THEN
      RAISE EXCEPTION '突變下負數收款是被 % 擋的', coalesce(v_con, '(NULL)');
    END IF;
  END;
  RAISE NOTICE 'OP1P-G5-OK';
END
\$g5\$;
ROLLBACK;"

# ── G6 收尾:約束層也要驗零留痕 ────────────────────────────────────────────
# 🔴 code-reviewer nit:每格結束只驗了「資料列數 = 0」,而 G5 動的是**約束定義**(DROP/ADD),
#    那一層完全沒被驗過 —— 交易真的沒回滾的話,後面每一格都會在一張被改過的表上跑。
#    最便宜的補法就是把 G1 再跑一次:定義回不到放寬版就當場紅。
log "6/6 G6 收尾:G5 動過的約束回到原狀 + A9 三支仍在崗"
run_case "G6 收尾對照:reversal_shape 回到放寬版(零留痕)+ 世界仍是 OP2b 之後(gate 不在、A9 三支在崗)" "OP1P-G6-OK" "
DO \$g6\$
DECLARE v_def text; v_n integer;
BEGIN
  SELECT pg_catalog.pg_get_constraintdef(oid) INTO v_def
    FROM pg_catalog.pg_constraint
   WHERE conname = 'order_payments_reversal_shape'
     AND conrelid = 'public.order_payments'::regclass;
  IF v_def IS NULL OR v_def NOT LIKE '%<> 0%' OR v_def NOT LIKE '%amount > 0%' THEN
    RAISE EXCEPTION 'G5 的突變沒回滾乾淨(定義=%)⇒ 前面幾格是在一張被改過的表上跑的', coalesce(v_def, '(NULL)');
  END IF;
  -- 🔴 2026-08-11 #396:原本這裡驗「dormant gate 仍在(count=1)」——gate 已被 OP2b DROP,
  --    那條斷言現在恆假。改成驗**它仍然不在**(有人偷偷把它加回來,這張表就整個寫不進去)。
  SELECT pg_catalog.count(*)::integer INTO v_n FROM pg_catalog.pg_constraint
   WHERE conname = 'order_payments_dormant_until_triggers'
     AND conrelid = 'public.order_payments'::regclass;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'dormant gate 又出現了(count=%)⇒ 本表所有寫入都會被 CHECK (false) 擋死', v_n;
  END IF;
  -- A9 三支 trigger 仍在崗(前置閘只在開跑那一刻看過;這裡是收尾複驗,判準與前置閘同一套)。
  -- ⚠️ 誠實:gate 與 A9 這兩半**本 harness 內沒有任何動作會改變它們**(G5 只動 reversal_shape、
  --    FIXTURE_PRELUDE 已不再 DROP gate)⇒ 對「本檔自己有沒有留痕」零判別力,
  --    它們擋的是**外部行為者**(別的視窗/別支腳本跑到一半改了世界)。真正的零留痕證據是
  --    上面那條 reversal_shape 定義比對 + 每格結束的資料列數 = 0。
  -- 判準與前置閘同一套(含 WHEN 逐支釘:reversal_amount_bi 本來就帶 WHEN,另兩支無 WHEN)。
  SELECT pg_catalog.count(*)::integer INTO v_n FROM pg_trigger t
   WHERE NOT t.tgisinternal
     AND t.tgrelid = 'public.order_payments'::regclass
     AND t.tgenabled = 'O'
     AND ((t.tgname = 'order_payments_reversal_amount_bi'
           AND t.tgfoid = 'public.pcm_op2b_reversal_amount()'::regprocedure
           AND t.tgtype = 7
           AND pg_get_triggerdef(t.oid) LIKE '%WHEN ((new.reverses_payment_id IS NOT NULL))%')
       OR (t.tgname = 'order_payments_immutable_bu'
           AND t.tgfoid = 'public.pcm_op2b_immutable_columns()'::regprocedure
           AND t.tgtype = 19 AND t.tgqual IS NULL)
       OR (t.tgname = 'order_payments_no_delete_bd'
           AND t.tgfoid = 'public.pcm_op2b_no_delete()'::regprocedure
           AND t.tgtype = 11 AND t.tgqual IS NULL));
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'A9 三支 trigger 收尾複驗只剩 %(期望 3:啟用中、綁對函式、事件時機 tgtype、WHEN 逐支對)', v_n;
  END IF;
  RAISE NOTICE 'OP1P-G6-OK';
END
\$g6\$;"

if [ "$MODE" = "all" ]; then
  scripts/d1t2-rehearsal.sh teardown "$WORK" >/dev/null 2>&1 || true
fi

echo "════ PASS=$PASS FAIL=$FAIL ════"
[ "$FAIL" -eq 0 ] || exit 1
