#!/usr/bin/env bash
# ============================================================
# OP1 補丁片(A10 拍板落地)行為驗證 harness
#
# 驗的是**這一顆 commit 改了什麼**,不是整支 OP1 migration 的結構(那由 migration
# 自己的檔尾 fail-closed 斷言在 apply 當下驗)。
#
# 本片的改動只有一句:`order_payments_reversal_shape` 的沖銷分支
#   `amount < 0` → `amount <> 0`(Sean 2026-08-10 晨拍 Q1=A,允許沖銷之沖銷)。
# ⇒ 七格(G0 自我測試 + G1 對照組 + 四發真探針 + G6 收尾):
#   G2 正測  誤沖的恢復路現在**走得通**:P(+500) → R1(-500) → R2(+500) 三列都寫得進,且 SUM=500。
#   G3 負測  「負數的收款」**仍然**被 `order_payments_reversal_shape` 擋(逐字比 conname,
#            不是「反正紅了就算擋住」——放寬如果寫壞成整條恆真,這格會綠不了)。
#   G4 邊界  自環(沖銷指向自己)在 OP2b 之前**只有 dormant gate 擋得住** —— 兩半都量:
#            gate 在時紅在 gate、gate 拿掉後同一發**寫得進去**(後半才撐得起「唯一」這兩個字)。
#   G5 突變  把 CHECK 換回舊版 `amount < 0`(先斷言定義**真的變了**)⇒ **只有 G2 轉紅**、
#            G3 照樣紅在同一個 conname ⇒ 證明 G2 的綠是這一句放寬換來的,不是恆真。
#   G6 收尾  G4/G5 動過的**約束定義**都回到原狀(只數資料列看不到這一層)。
#
# ⚠️ **本 harness 有明確保鮮期:它綁在「OP2b 之前」那個狀態。** OP2b 落地(A9 建好 + gate DROP)之後
#    本檔就過期,前置閘會 exit 2 要求改寫,**不會**留下一片看起來像「OP1 壞了」的紅。
#    (第一版我在註解裡宣稱它不會變成假警報 —— 那是錯的,codex 關卡2 R2 打回。)
#
# 🏁 **2026-08-10:保鮮期到了 —— 本檔已退役,後繼者 = `scripts/op2b-verify.sh`。**
#    OP2b(`20260810130000_m4b_e10_op2b_reversal_invariants.sql`)落檔後 dormant gate 已 DROP
#    ⇒ 本檔的前置閘會 `exit 2` 拒跑(這是設計,不是壞掉)。
#    🔴 **當初承諾的是「同 commit 改寫本檔」,實際做的是「退役 + 指到後繼者」** —— 理由:
#      本檔證的三件事(合法鏈寫得進、負數收款仍被擋、放寬有判別力)在 OP2b 之後
#      **由更強的守門接手**(A9 反號涵蓋了「放寬後金額可以亂填」那一面),
#      改寫本檔等於把 `op2b-verify.sh` 的 G2/G4 再抄一份 ⇒ 兩套講同一件事的守門,
#      正是本 repo 反覆記過的形狀。**保留本檔是為了留住 OP1 那一輪的證據與理由,不是為了再跑它。**
#
# 🔴 為什麼要在交易裡 DROP dormant gate:OP1 的 `order_payments_dormant_until_triggers`
#    (`CHECK (false)`)擋住本表所有寫入,要到 OP2b 才與 A9 同交易 DROP。不拿掉它,
#    上面每一發探針都會紅在 gate、什麼都證不到。**只在交易內拿掉、跑完 ROLLBACK,零留痕**
#    (每個 case 結束都驗一次資料列數 = 0;**約束層**由收尾的 G6 驗 —— G4/G5 動的是 DDL,
#     只數資料列看不到「約束被改掉沒回來」,那是 code-reviewer 打回的缺口)。
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

gate_precondition() {
  local n
  n="$(psql "$URL" -qtA -c "SELECT count(*) FROM pg_catalog.pg_constraint
        WHERE conname = 'order_payments_dormant_until_triggers'
          AND conrelid = 'public.order_payments'::regclass" 2>/dev/null)"
  if [ "$n" != "1" ]; then
    echo "🔴 dormant gate 不在(查得 count=${n:-<查詢失敗>})。
    本 harness 驗的是 **OP1 補丁片**(A10 放寬)在 OP2b 之前的行為,前置就是「gate 還在」。
    · 若這是因為 **OP2b 已經落地**:本檔已過期,請改寫成 A9 版(正測改由 A9 守、G4 改驗 A9 擋環),不要硬跑。
    · 若這是因為連錯庫或 provision 沒跑完:先確認 PORT=${PORT} 這個 cluster 是不是你剛建的那個。"
    exit 2
  fi
}

# 每個 case 共用的前置:抓真的 order / staff 當 fixture(FK 是 RESTRICT,假 id 過不了)
FIXTURE_PRELUDE=$'  SELECT id INTO v_o FROM public.orders ORDER BY created_at LIMIT 1;\n  SELECT id INTO v_s FROM public.staff ORDER BY id LIMIT 1;\n  IF v_o IS NULL OR v_s IS NULL THEN\n    RAISE EXCEPTION \'fixture 不足(orders=% staff=%)⇒ 這輪沒有證據,不是通過\', v_o, v_s;\n  END IF;\n  EXECUTE \'ALTER TABLE public.order_payments DROP CONSTRAINT order_payments_dormant_until_triggers\';'

if [ "$MODE" = "all" ]; then
  log "0/7 provision 拋棄式 PG17(重用 d1t2 的 provision,不複製貼上)"
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
log "1/7 G0 harness 自我測試"
if run_case "G0-selftest(這格應該紅)" "NEVER" "SELECT this_column_does_not_exist;" >/dev/null 2>&1; then
  bad "G0:壞掉的 SQL 竟然被判成通過 ⇒ 本 harness 的判定失效,後面全部不算數"
  echo "════ PASS=$PASS FAIL=$FAIL ════"; exit 1
fi
FAIL=$((FAIL-1))   # G0 預期紅,把它從 FAIL 帳裡扣回來(上一版還有一句 `PASS=$PASS` 的 no-op,已刪)
ok "G0:壞掉的 SQL 會被判紅(判定不是恆真)"

# ── G1 對照組:庫裡的定義就是**放寬後**的新版 ──────────────────────────────
log "2/7 G1 對照組(不是新版就別往下跑)"
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
log "3/7 G2 正測:P(+500) → R1(-500) → R2(+500)"
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
log "4/7 G3 負測:負數收款"
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

# ── G4:環目前只有 dormant gate 擋得住(把檔頭那句話變成可跑的檢查)───────
# 🔴 codex 關卡2 MF1 + 我的實測:`one_reversal_uniq` 擋的只有「同一列被沖兩次」,**擋不住環**
#    (自環與雙列互指的 `reverses_payment_id` 彼此不同)。gate 拿掉後自環寫得進去、`SUM` 當場錯,
#    而且**放寬前的舊 CHECK 下同樣寫得進去** ⇒ 環是 OP1 既有的洞,不是這次放寬新增的。
#    擋環是 **A9(OP2b)的具名驗收條件**,見 migration 檔頭 A10。
# ⇒ 本格釘的是「在 OP2b 之前,擋住它的是 **dormant gate**」這句話。有人提早 DROP gate 就會紅在這裡。
#    ⚠️ 本格**不**斷言「環寫得進去」——那會在 A9 落地後變成假警報。
#    ⚠️ 本格自己在 OP2b 之後也不再成立(A9 會接手擋環)⇒ 由檔頭的前置閘負責拒跑,見 `gate_precondition`。
log "5/7 G4:自環 —— gate 在時紅在 gate、gate 拿掉就寫得進"
run_case "G4 自環:gate 在時紅在 gate、gate 拿掉就寫得進去(兩半都量,唯一性有據)" "OP1P-G4-OK" "
BEGIN;
DO \$g4\$
DECLARE v_o uuid; v_s text; v_con text; v_rows integer;
BEGIN
  SELECT id INTO v_o FROM public.orders ORDER BY created_at LIMIT 1;
  SELECT id INTO v_s FROM public.staff ORDER BY id LIMIT 1;
  IF v_o IS NULL OR v_s IS NULL THEN
    RAISE EXCEPTION 'fixture 不足(orders=% staff=%)⇒ 這輪沒有證據,不是通過', v_o, v_s;
  END IF;

  -- 前半:gate 還在 ⇒ 自環必須紅在 gate
  BEGIN
    INSERT INTO public.order_payments (id, order_id, rail, amount, received_at,
                                       reverses_payment_id, reversal_reason, actor)
    VALUES ('11111111-1111-1111-1111-111111111111', v_o, 'card', -500, now(),
            '11111111-1111-1111-1111-111111111111', '自環探針', v_s);
    RAISE EXCEPTION '自環在 gate 還在的情況下就寫進了錢帳 ⇒ gate 沒生效';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con IS DISTINCT FROM 'order_payments_dormant_until_triggers' THEN
      RAISE EXCEPTION '自環是被 % 擋的,不是 dormant gate', coalesce(v_con, '(conname 為 NULL)');
    END IF;
  END;

  -- 🔴 後半(code-reviewer MF4:格名不能大於斷言量到的東西):把 gate 拿掉,自環**必須寫得進去**。
  --    少了這一半,本格只證明「有東西擋住它」,證不到「擋住它的**只有** gate」——
  --    真要是別的約束也擋得住,前半照樣綠,而「OP2b 前唯一防線是 gate」那句話就是沒被驗過的斷言。
  EXECUTE 'ALTER TABLE public.order_payments DROP CONSTRAINT order_payments_dormant_until_triggers';
  INSERT INTO public.order_payments (id, order_id, rail, amount, received_at,
                                     reverses_payment_id, reversal_reason, actor)
  VALUES ('11111111-1111-1111-1111-111111111111', v_o, 'card', -500, now(),
          '11111111-1111-1111-1111-111111111111', '自環探針(gate 拿掉後)', v_s);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'gate 拿掉後自環沒寫進去(ROW_COUNT=%)⇒ 擋它的還有別的東西,唯一性不成立', v_rows;
  END IF;
  RAISE NOTICE 'OP1P-G4-OK';
END
\$g4\$;
ROLLBACK;"

# ── G5 突變:換回舊版 CHECK ⇒ 只有 G2 轉紅、G3 不動 ──────────────────────
log "6/7 G5 突變(把 CHECK 換回 amount < 0)"
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
# 🔴 code-reviewer nit:每格結束只驗了「資料列數 = 0」,而 G4/G5 動的是**約束定義**(DROP/ADD),
#    那一層完全沒被驗過 —— 交易真的沒回滾的話,後面每一格都會在一張被改過的表上跑。
#    最便宜的補法就是把 G1 再跑一次:定義回不到放寬版就當場紅。
log "7/7 G6 收尾:G4/G5 動過的約束都回到原狀"
run_case "G6 收尾對照:reversal_shape 定義仍是放寬版 + dormant gate 仍在(約束層零留痕)" "OP1P-G6-OK" "
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
  SELECT pg_catalog.count(*)::integer INTO v_n FROM pg_catalog.pg_constraint
   WHERE conname = 'order_payments_dormant_until_triggers'
     AND conrelid = 'public.order_payments'::regclass;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'G4 交易內 DROP 的 dormant gate 沒回來(count=%)⇒ 這張錢帳現在裸奔', v_n;
  END IF;
  RAISE NOTICE 'OP1P-G6-OK';
END
\$g6\$;"

if [ "$MODE" = "all" ]; then
  scripts/d1t2-rehearsal.sh teardown "$WORK" >/dev/null 2>&1 || true
fi

echo "════ PASS=$PASS FAIL=$FAIL ════"
[ "$FAIL" -eq 0 ] || exit 1
