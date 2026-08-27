#!/usr/bin/env bash
# ============================================================
# L5b-2 片 2e 驗證 harness(close_released_attempt:advisory + order_id 復核 + 未結案退款否決)
# ============================================================
# plan = docs/specs/2026-08-12-l5b2-2e-close-advisory-plan.md(v2)§8 測試設計
# 標的 = supabase/migrations/20260812160000_m4b_lifecycle_l5b2_2e_close_advisory.sql
# 回退 = scripts/l5b2-2e-rollback.sql
#
# 用法:
#   scripts/l5b2-2e-verify.sh all <workdir>            自己 provision → 跑 → teardown
#   PORT=54741 scripts/l5b2-2e-verify.sh run <workdir> 叢集已在(開發用)
#   PORT=54741 scripts/l5b2-2e-verify.sh rb  <workdir> **回退專用**(叢集已在;見下 §RB)
#
# ── §RB:回退為什麼要有自己的模式(R1 important 5)──────────────────────────────
# v1 只 `test -f` + SHA 釘住 rollback 檔,36 格裡**零回退格** ⇒「回退雙向驗過」是一次性手跑、
# 交付物本身重現不了。`rb` 模式把那次手跑變成可重跑的 **10 格**:起點指紋 → **四種**假 2g writer
# 各自被閘①擋(FUNCTION / PROCEDURE / 未 schema-qualified / MERGE INTO = must-fix 1 放寬後的
# 四個分支各有紅綠證據)→ 擋下時**未還原** → 拆掉假 writer 後回退成功 →
# md5 / proconfig / COMMENT 世代三驗 → 重新 apply 回 post-image。
# 🔴 `rb` 會**真的改庫**(還原又 apply 回來),所以它獨立成一個模式、不混進 `run` 的 38 格。
#
# 🔴 本檔的紀律(全部是本線踩過的坑,不是格式潔癖):
#  · **期望值一律 SQLSTATE + 物件名兩件**。只比碼會把「別條擋下來」當成自己的功勞。
#    ⚠️ **本檔自己有四格不符這條紀律**(R1 nit 6,誠實記在這裡而不是假裝一致):
#      B4/B5/B6/D1 傳的 code 是字面 `"ERROR"` = 對**任何**錯誤恆真,實際判別力全靠中文子字串。
#      原因是那四格打的是**既有本體**的 RAISE,它們沒有 ERRCODE(本片不改既有本體 ⇒ 不補)。
#      ⇒ 這四格的紅只證明「有錯而且訊息對」,不證明「是那條守門擋的」。2e 新增的守門(C/L2b)
#      一律有 P2E01/P2E02 + 物件名兩件,不受此限。
#  · **正向格自己包 BEGIN/ROLLBACK**:`psql -c` 成功時是自動提交的。§E 的零留痕自檢就是為此存在。
#  · **布林一律 `::text` + 期望 `true`/`false`**:psql -qtA 下裸 bool 印 `t`、`bool::text` 印 `true`。
#  · 🔴 **L2/L4/L5 一律用 `bounded()` 跑**,不用裸 psql:本片的突變(拿掉 lock_timeout)的症狀是
#    **hang 不是紅**(postgres 角色無 statement_timeout 也無 lock_timeout=無限等)⇒ 沒有外層 timeout
#    的話 harness 自己會掛住,那不叫紅格,那叫沒有結果。(關卡1 nit N1)
#    ⚠️ macOS 無 GNU `timeout`,所以 `bounded()` 是自己寫的背景+有界輪詢,不依賴非內建 CLI。
#  · 🔴 **突變輪跑動期間不得編輯被 SHA 釘住的檔** —— 2026-08-12 沖銷片那輪我中途改了 migration,
#    SHA 閘讓後四靶直接 die、報表印成「紅格=[無]」;沒去看 `PASS=` 欄是空的就會讀成「守門恆真」
#    = **完全相反的結論**。
#
# ── 突變輪(plan §8;**紅格由實跑決定,不是預測**)────────────────────────────
# 做法:每個靶 → 乾淨叢集 → 只改**庫內物件**(不改檔案 ⇒ SHA 閘不會誤擋)→ 跑本檔 `run`。
# ⚠️ 格名由 `sed 's/^  FAIL \([A-Z][0-9]*\).*/\1/'` 抽出,會截掉後綴。
#
# 🔴 折疊後格數 36→38→**44**(R1 加 A12/C6;R2 加 A13/D2a/D2b/L5a/L5b/E6)
#    ⇒ **十三靶全部重跑**(不是把舊表的 PASS 欄減一減 —— 那是預測不是實測)。
# 🔴 跑法已進交付物:`scripts/l5b2-2e-verify.sh mut <workdir>`(R2 important 5;v3 的 driver 寫在
#    /tmp,那張表只能靠作者口頭回報)。每靶跑前先驗「突變真的落地」,CHECK 不過=**本靶無結論**、不讀紅格。
#
#   靶(改庫內物件)                                  實測紅格                        PASS/44
#   M0  對照組:不突變                                (無)                            44  ← 基線
#   M1  拿掉 SET search_path = ''                     A1                              43
#   M1b 拿掉 SECURITY DEFINER                         A3                              43
#   M2  拿掉無鎖預讀的 NOT FOUND RAISE                A10                             43   ← 見下 🔴
#   M3  拿掉 SET lock_timeout = '3s'                  A2 L1b L1c L5b E1 E2            38
#   M4  新增一支會 UPDATE attempts 的函式             A11                             43
#   M4b 拿掉步 C 的 order_id 復核                     A10 L2b E1 E2                   40
#   M5  advisory 移到鎖下重讀之後                     A8 A10 L2b **L5b**              40   ← 見下 🔴
#   M6  否決條件恆假                                  A10 C1 C3 E1 E2                 39
#   M7  否決條件移到冪等分支之前                      A10 C4                          42
#   M9  拿掉 order-paid guard                         A10 D1                          42
#   M10 payment_refunds 開 FORCE RLS                  A12                             43   ← 見下 🔴
#   M11 per-order 鎖 index 的 predicate 拿掉 released A13                             43
#
# 算術自洽:十三靶皆滿足 `44 − FAIL = PASS`(逐行機械核過)。**十三靶紅格欄皆非空**
# (M0 是基線,它的「無」正是要的:基線乾淨,其他靶的紅才歸得到突變頭上)。
# 要誠實講清楚的,別把上表讀成覆蓋率:
#  · 🔴 **M5 現在紅到 L5b,那是 R2 codex must-fix 4 的直接產物**:v3 的 M5 只紅 A8/A10/L2b,
#    **沒有任何一格觀察到環**,而 plan §8 的 M5 規格白紙黑字要求「必須構造得出 40P01」。
#    新增的 L5 就是那格:對手持 advisory 後才要 attempt 列鎖 ⇒ 基線 close 手上無列鎖=**不成環**
#    (只有 55P03);M5 下 close 先抓列鎖再等 advisory ⇒ **實得 40P01**。紅綠只由取鎖順序決定。
#    (M3 也紅 L5b,但形狀不同:沒有 lock_timeout ⇒ close 一路等到對手放手、**直接結案成功**。)
#  · 🔴 **M2 的行為層零紅,而那不是缺口** —— 拿掉步 A 的 RAISE 之後只有 A10(md5 釘)紅。
#    追下去實測(M2b:再讓預讀恆空 ⇒ v_order_id_pre=NULL 走到底)得到 **P2E02**:
#    `<uuid> IS DISTINCT FROM NULL` = TRUE ⇒ **步 C 的復核把這條路也擋住了**。
#    ⇒ 步 A 的 RAISE 在**安全性上被步 C 嚴格蘊含**,它剩下的價值是清楚的錯誤訊息 +
#      不做一次沒有意義的 NULL 鍵 advisory 呼叫。**真正承重的是步 C(關卡1 MF3 加的那道)**,
#      而它有 M4b 專屬突變。(同族=memory `feedback_unconstructible-negative-test-means-noop-guard`:
#      寫不出只紅它的負測 = 先懷疑那條守門被別條蘊含 —— 這次答案就是「被蘊含」。)
#  · **A10(md5 釘)對每個改本體的靶都會紅**,那是「有人動過這支函式」的格,不是各靶的判別力來源。
#    判別力看的是它以外那幾格。
#  · **E1/E2 在 M3/M4b/M5/M6 連帶紅是副作用,也是傷害本身**:守門沒了之後,本該被擋的 close
#    **真的寫進去了**(M4b 尤其明顯 —— 它在錯的隊伍上成功結案)。
#  · 🔴 **M10 只紅在 A12,行為層沒紅 —— 而原因不是守門好棒,是本機測不出來**(R2 codex important 1 同意此判讀):
#    本機拋棄式叢集的 `postgres` 是 **superuser + rolbypassrls**(實測),FORCE RLS 對它**完全無效**
#    (同一交易內造一列:FORCE 關讀到 1 列、FORCE 開**還是** 1 列)。
#    ⇒ R1 must-fix 2 描述的行為層災難(否決 SELECT 回 0 列、P2E01 恆假無聲)**在本機構造不出來**,
#      A12 與前置閘那道斷言目前是**結構型早期預警**(同 A11),不是被行為證明過的防線。
#    ⚠️ **正式庫的 `postgres` 角色屬性本片未量**(此 worktree 未配正式庫連線,不自行去別處撈 secret)
#      ⇒ 那道斷言在正式庫有沒有效力 = **未確認**。它是 fail-closed 且成本近零,所以保留;
#      但**不得**把它寫成「已擋住 FORCE RLS 災難」。
#  · **M5 在 R1 輪曾經連帶紅 E1/E2,R2 輪沒有** —— 那是我修 nit 7(L2 受控解鎖)的副作用:
#    舊編排下受測呼叫會成功結案並提交,新編排下它在 3s lock_timeout 死掉、沒有寫入。
#    「守門沒了真的會寫壞」這條證據由 **M4b** 提供(它的 E1/E2 現在仍紅)。
#  · **M8(順序錨不剝註解)沒有進上表**,因為它突變的是守門自己不是函式。單獨量過:
#    post-image 原樣 advisory=1030 / FOR UPDATE=1954、剝註解 815 / 1119 ⇒ **兩者判定相同**。
#    也就是說對 2e 現行文字,剝不剝註解都得到同一個答案;剝註解防的是**未來**有人把提到
#    `FOR UPDATE` 的註解搬到 advisory 之前(recon §3 說的「目前量對純屬運氣」)。
#  · **突變 driver 自己犯了兩次本檔警告過的錯,兩次都被它自己的 CHECK 擋下、標成「本靶無結論」**
#    (而不是印出假的紅格欄):① 對照組的 CHECK 寫 `SELECT true;` ⇒ psql -qtA 下印 `t` 不是 `true`
#    ② M5 的 CHECK 用 `strpos(prosrc,…)` **沒剝註解** ⇒ 命中的是步 A 註解裡的
#    `pg_advisory_xact_lock(NULL)` 字樣,判成「突變沒落地」。
#    後者正是 ④-8 那道守門存在的理由 —— 產品裡剝了,我在拋棄式 driver 裡忘了剝。
#
set -uo pipefail
export LC_ALL=C

MODE="run"
case "${1:-}" in all|run|rb|mut) MODE="$1"; shift ;; esac
WORK="${1:-/tmp/l5b2-2e-verify}"
PORT="${PORT:-54741}"
URL="postgresql://postgres@127.0.0.1:${PORT}/postgres"

MIG="supabase/migrations/20260812160000_m4b_lifecycle_l5b2_2e_close_advisory.sql"
ROLLBACK="scripts/l5b2-2e-rollback.sql"

# 🔴 依賴檔 SHA 釘死:改了 migration 或 rollback 而不動本檔,帳面照樣全綠。釘在這裡才閉合。
#    (只釘不檢查=裝飾 ⇒ 下面的迴圈真的比。)
# 🔴 **算法 = SHA-1**;量法逐字:`shasum <檔>`(macOS `shasum` 不帶參數即 SHA-1,等同 `shasum -a 1`)。
#    ⚠️ 覆驗請用同一個算法 —— 2026-08-12 主視窗改用 sha256 / md5 / `git hash-object` 三法覆驗,
#       三法都「對不上」,一度被判成檔案被動過;實際上那三法的值兩邊完全一致=**檔案逐位元組相同**,
#       差的只是算法。⇒ 指紋這種字面,**寫值就要寫算法**,否則覆驗者無從判斷是檔變了還是量法不同。
MIG_SHA_EXPECT="0ea9790445ae73893666a53c7eaf786b9196a119"
RB_SHA_EXPECT="ccf8bcfc234d3bd28917ae5abcdc19d1a9a976d7"

# 🔴 量出來的,不是估的(每加/刪一格必同步改)。數法=看腳本尾端印的 `PASS=`。
EXPECT_TOTAL=44

# 2e post-image prosrc md5(本機拋棄式叢集實測;🔴 2f 的 preflight 要釘正式庫 apply 後重量的那顆)
POST_MD5_EXPECT="f4e3aa5b5afb9e886b0b2820a4c4b34b"

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
log() { printf '\n── %s ──\n' "$1"; }
die() { echo "🔴 $*"; exit 1; }
q()   { psql "$URL" -qtAX -c "$1" 2>&1; }
# 🔴 `-X` 不可省(R1 nit 8):同檔的 q() 有、sqlx() 首版漏了 ⇒ 有 ~/.psqlrc 的機器上
#    fixture 與判定會跑在**不同**的 session 設定下(那正是「量錯東西」的溫床)。
sqlx(){ psql "$URL" -qtAX -v ON_ERROR_STOP=1 -c "$1" >/dev/null || die "fixture SQL 失敗:$1"; }

test -f "$MIG"      || die "找不到 $MIG(請在 repo 根目錄跑)"
test -f "$ROLLBACK" || die "找不到 $ROLLBACK"
for pair in "$MIG:$MIG_SHA_EXPECT" "$ROLLBACK:$RB_SHA_EXPECT"; do
  _f="${pair%%:*}"; _want="${pair##*:}"; _got="$(shasum "$_f" | cut -d' ' -f1)"
  [ "$_got" = "$_want" ] || die "$_f 的 SHA=[$_got] 與本檔釘住的 [$_want] 不符 ⇒ 依賴檔改過但本檔沒同步。
   改法:確認改動是預期的,更新本檔的 *_SHA_EXPECT,然後**重跑**(不要只改常數不重跑)。"
done

# ══════════════════════════════════════════════════════════════════════════
# MUT 模式:突變輪 driver(R2 codex important 5)
# ══════════════════════════════════════════════════════════════════════════
# v3 的突變輪是我在 /tmp 手寫的一次性 driver ⇒ 交付物**重現不了**那張表,只能信我回報。
# 本模式把它收進交付物:每靶=**乾淨叢集** → 只改庫內物件(不動檔案 ⇒ SHA 閘不誤擋)→ 跑 `run`。
# 🔴 每靶先驗「突變真的落地」(CHECK);CHECK 不過 = **本靶無結論**,不讀紅格
#    (v3 driver 這道救過兩次:一次裸 bool 印 `t`、一次 strpos 沒剝註解)。
# 用法:scripts/l5b2-2e-verify.sh mut <workdir>   (自己 teardown/provision,約 12 輪)
if [ "$MODE" = "mut" ]; then
  # 🔴 報表與抽出的本體**不能放 $WORK**:mut_run 每輪第一件事就是 teardown,而 teardown 會把整個
  #    workdir 砍掉(實測:第一輪之後 report 檔就不見了、後續 append 全部失敗)。放它旁邊。
  MUTDIR="${WORK%/}-mutwork"; rm -rf "$MUTDIR"; mkdir -p "$MUTDIR"
  MUTREPORT="$MUTDIR/mut-report.txt"; : > "$MUTREPORT"
  awk '/^CREATE OR REPLACE FUNCTION public\.close_released_attempt\(/,/^\$fn\$;$/' "$MIG" > "$MUTDIR/fn.sql"
  test -s "$MUTDIR/fn.sql" || die "抽不出函式本體(migration 結構變了?)"

  mut_body(){ python3 - "$1" "$MUTDIR" <<'PY'
import re,sys
mode,work=sys.argv[1],sys.argv[2]
s=open(work+'/fn.sql').read()
NF="""  IF NOT FOUND THEN
    RAISE EXCEPTION 'close_released_attempt:attempt % 不存在', p_attempt_id;
  END IF;
"""
if mode=='M2':
    i=s.index(NF); s=s[:i]+s[i+len(NF):]
elif mode=='M4b':
    s=s.replace(re.search(r"  IF v_order_id IS DISTINCT FROM v_order_id_pre THEN.*?\n  END IF;\n",s,re.S).group(0),'')
elif mode=='M5':
    adv=re.search(r"  PERFORM pg_catalog\.pg_advisory_xact_lock\(\n.*?bigint\);\n",s,re.S).group(0)
    s=s.replace(adv,''); s=s.replace("  -- 2e-C.",adv+"  -- 2e-C.",1)
elif mode=='M6':
    s=s.replace("  IF v_blocking IS NOT NULL THEN","  IF false THEN",1)
elif mode=='M7':
    blk=re.search(r"  SELECT pr\.id\n    INTO v_blocking.*?l5b2_2e_refund_in_flight';\n  END IF;\n",s,re.S).group(0)
    s=s.replace(blk,''); s=s.replace("  -- 冪等:已結案",blk+"  -- 冪等:已結案",1)
elif mode=='M9':
    s=s.replace("  IF NOT FOUND OR v_order_status <> 'unpaid'::public.payment_status THEN","  IF false THEN",1)
else: sys.exit("unknown "+mode)
open(work+'/fn-mut.sql','w').write(s)
PY
    psql "$URL" -qtAX -v ON_ERROR_STOP=1 -f "$MUTDIR/fn-mut.sql" >/dev/null; }

  FN='public.close_released_attempt(uuid, text)'
  PROSRC="FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='close_released_attempt'"
  # 🔴 CHECK 一律 `::text`(裸 bool 印 `t` 不是 `true`);比位置一律**先剝註解**
  #    (步 A 的註解裡就有 `pg_advisory_xact_lock(NULL)` 字樣 —— 不剝會判成「突變沒落地」)。
  BARE="WITH s AS (SELECT regexp_replace(prosrc,'--[^'||chr(10)||']*','','g') AS b $PROSRC)"

  mut_run(){ local name="$1" desc="$2" kind="$3" arg="$4" check="$5" got p f cells
    scripts/d1t2-rehearsal.sh teardown "$WORK" >/dev/null 2>&1
    PORT=$PORT scripts/d1t2-rehearsal.sh provision "$WORK" > "$MUTDIR/prov.log" 2>&1 \
      || { echo "$name | PROVISION-FAIL" >> "$MUTREPORT"; return 0; }
    if [ "$kind" = sql ]; then
      psql "$URL" -qtAX -v ON_ERROR_STOP=1 -c "$arg" >/dev/null 2>&1 \
        || { echo "$name | MUTATE-FAIL" >> "$MUTREPORT"; return 0; }
    else
      mut_body "$arg" || { echo "$name | MUTATE-FAIL" >> "$MUTREPORT"; return 0; }
    fi
    got="$(psql "$URL" -qtAX -c "$check" 2>&1)"
    [ "$got" = "true" ] || { echo "$name | CHECK-FAIL(突變沒落地 got=[$got])⇒ 本靶無結論" >> "$MUTREPORT"; return 0; }
    PORT=$PORT "$0" run "$WORK" > "$MUTDIR/out-$name.txt" 2>&1
    p="$(grep -o 'PASS=[0-9]*' "$MUTDIR/out-$name.txt" | head -1 | cut -d= -f2)"
    f="$(grep -o 'FAIL=[0-9]*' "$MUTDIR/out-$name.txt" | head -1 | cut -d= -f2)"
    cells="$(awk '/^  FAIL/{print $2}' "$MUTDIR/out-$name.txt" | tr '\n' ' ')"
    echo "$name | PASS=$p FAIL=$f | 紅格: ${cells:-(無)} | $desc" >> "$MUTREPORT"; return 0; }

  mut_run M0  "對照組:不突變(基線必須全綠,否則其他靶的紅歸不到突變頭上)" sql "SELECT 1;" "SELECT true::text;"
  mut_run M1  "拿掉 SET search_path=''" sql "ALTER FUNCTION $FN RESET search_path;" \
    "SELECT (NOT ('search_path=\"\"' = ANY(COALESCE(proconfig,ARRAY[]::text[]))))::text $PROSRC;"
  mut_run M1b "拿掉 SECURITY DEFINER" sql "ALTER FUNCTION $FN SECURITY INVOKER;" \
    "SELECT (NOT prosecdef)::text $PROSRC;"
  mut_run M3  "拿掉 SET lock_timeout='3s'" sql "ALTER FUNCTION $FN RESET lock_timeout;" \
    "SELECT (NOT ('lock_timeout=3s' = ANY(COALESCE(proconfig,ARRAY[]::text[]))))::text $PROSRC;"
  mut_run M4  "新增一支會 UPDATE attempts 的函式" sql \
    "CREATE FUNCTION public.mut_extra_writer() RETURNS void LANGUAGE plpgsql AS \$x\$ BEGIN UPDATE public.payment_charge_attempts SET updated_at=now() WHERE false; END \$x\$;" \
    "SELECT (to_regprocedure('public.mut_extra_writer()') IS NOT NULL)::text;"
  mut_run M10 "payment_refunds 開 FORCE RLS" sql "ALTER TABLE public.payment_refunds FORCE ROW LEVEL SECURITY;" \
    "SELECT relforcerowsecurity::text FROM pg_class WHERE oid='public.payment_refunds'::regclass;"
  mut_run M11 "per-order 鎖 index 的 predicate 拿掉 released" sql \
    "DROP INDEX public.payment_charge_attempts_order_lock_idx; CREATE UNIQUE INDEX payment_charge_attempts_order_lock_idx ON public.payment_charge_attempts (order_id) WHERE status IN ('pending','charged');" \
    "SELECT (pg_get_expr(i.indpred,i.indrelid) NOT LIKE '%released%')::text FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE c.relname='payment_charge_attempts_order_lock_idx';"
  mut_run M2  "拿掉無鎖預讀的 NOT FOUND RAISE" body M2 \
    "$BARE SELECT ((length(b)-length(replace(b,'IF NOT FOUND THEN','')))/length('IF NOT FOUND THEN')=1)::text FROM s;"
  mut_run M4b "拿掉步 C 的 order_id 復核" body M4b \
    "SELECT (strpos(prosrc,'l5b2_2e_order_id_drift')=0)::text $PROSRC;"
  mut_run M5  "advisory 移到鎖下重讀之後" body M5 \
    "$BARE SELECT (strpos(b,'pg_advisory_xact_lock')>strpos(b,'FOR UPDATE'))::text FROM s;"
  mut_run M6  "否決條件恆假" body M6 \
    "SELECT (strpos(prosrc,'IF false THEN')>0 AND strpos(prosrc,'IF v_blocking IS NOT NULL THEN')=0)::text $PROSRC;"
  mut_run M7  "否決移到冪等分支之前" body M7 \
    "SELECT (strpos(prosrc,'INTO v_blocking')<strpos(prosrc,'IF v_status = ''failed'''))::text $PROSRC;"
  mut_run M9  "拿掉 order-paid guard" body M9 \
    "SELECT (strpos(prosrc,'非 unpaid、fail-closed')>0 AND strpos(prosrc,'IF NOT FOUND OR v_order_status')=0)::text $PROSRC;"

  scripts/d1t2-rehearsal.sh teardown "$WORK" >/dev/null 2>&1
  echo; echo "── 突變輪報表(貼回本檔檔頭的表要用這份)──"; cat "$MUTREPORT"
  grep -q 'CHECK-FAIL\|MUTATE-FAIL\|PROVISION-FAIL' "$MUTREPORT" \
    && { echo "🔴 有靶無結論(見上),那幾靶不得寫進表"; exit 1; }
  exit 0
fi

RACEDIR=""
if [ "$MODE" = "all" ]; then
  # 🔴 trap 裝在 provision **之前**;且**全檔只有這一個 EXIT trap**
  #    (第二個 `trap … EXIT` 會**取代**第一個 —— 沖銷片 R2 must-fix A 就是這個)。
  teardown_and_verify() {
    local rc=$?
    rm -rf "${RACEDIR:-}" 2>/dev/null || true
    local bad_exit=0
    if ! scripts/d1t2-rehearsal.sh teardown "$WORK" >/dev/null 2>&1; then
      echo "🔴 teardown 失敗 ⇒ 可能留下活叢集(PORT=$PORT workdir=$WORK)"; bad_exit=1
    fi
    if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
      echo "🔴 PORT=$PORT 仍有人聽 ⇒ 零留痕不成立"; bad_exit=1
    fi
    [ "$bad_exit" = "0" ] || exit 2
    exit "$rc"
  }
  trap teardown_and_verify EXIT
  mkdir -p "$WORK"
  echo "── provision(全量 migration,含本片)──"
  PORT="$PORT" scripts/d1t2-rehearsal.sh provision "$WORK" > "$WORK/provision.log" 2>&1 \
    || { echo "🔴 provision 失敗,見 $WORK/provision.log"; tail -20 "$WORK/provision.log"; exit 1; }
  echo "  ok   provision 完成(PORT=$PORT)"
fi

# ── 叢集身分閘(在對任何東西下 ALTER 之前)────────────────────────────────────
[ -f "$WORK/cluster-id" ] || die "$WORK/cluster-id 不存在 ⇒ 無法確認 PORT=$PORT 上的叢集身分,拒跑。"
LIVE_ID="$(q "SELECT system_identifier FROM pg_control_system();")"
WANT_ID="$(cat "$WORK/cluster-id")"
[ -n "$LIVE_ID" ] && [ "$LIVE_ID" = "$WANT_ID" ] \
  || die "叢集身分不符:PORT=$PORT 上是 [$LIVE_ID],期望 [$WANT_ID]。拒跑。"
echo "  ok   叢集身分閘:PORT=$PORT 確認是本 workdir provision 的那個叢集"

RACEDIR="$(mktemp -d "${TMPDIR:-/tmp}/l5b2-2e-race.XXXXXX")"

# ── 判定工具 ────────────────────────────────────────────────────────────────
err(){ local label="$1" code="$2" name="$3" sql="$4" out rc
  out="$(psql "$URL" -qtAX -v VERBOSITY=verbose -v ON_ERROR_STOP=1 -c "$sql" 2>&1)"; rc=$?
  if [ $rc -eq 0 ]; then bad "$label —— 竟然成功(期望 $code/$name)"; return; fi
  if printf '%s' "$out" | grep -q "$code" && printf '%s' "$out" | grep -q "$name"; then
    ok "$label ($code/$name)"
  else bad "$label —— 期望 $code+$name,實得: $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-260)"; fi }

# 正向格自己包 BEGIN/ROLLBACK
pass(){ local label="$1" sql="$2" out rc
  out="$(psql "$URL" -qtAX -v ON_ERROR_STOP=1 -c "BEGIN; $sql ROLLBACK;" 2>&1)"; rc=$?
  [ $rc -eq 0 ] && ok "$label" || bad "$label —— 期望成功,實得: $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-260)"; }

val(){ local label="$1" want="$2" got
  got="$(q "$3")"
  [ "$got" = "$want" ] && ok "$label = $want" || bad "$label —— 期望 [$want] 實得 [$got]"; }

# 🔴 有界執行:背景跑 + 有界輪詢 + 逾時砍。macOS 無 GNU timeout ⇒ 不依賴它。
#    回傳 0=正常結束、124=逾時被砍。輸出寫進 $2。
bounded(){ local secs="$1" outf="$2" sql="$3" pid i
  psql "$URL" -qtAX -v VERBOSITY=verbose -c "$sql" > "$outf" 2>&1 &
  pid=$!
  for i in $(seq 1 $(( secs * 10 ))); do
    kill -0 "$pid" 2>/dev/null || { wait "$pid" 2>/dev/null; return 0; }
    sleep 0.1
  done
  kill -9 "$pid" 2>/dev/null; wait "$pid" 2>/dev/null || true; return 124; }

# 訂單的 advisory 鍵(與函式體內逐字同式)
advkey(){ q "SELECT (('x' || substr(replace('$1','-',''),1,16))::bit(64)::bigint)::text;"; }

# 🔴 advisory 鍵在 pg_locks 裡是**拆成兩欄**存的:classid=key>>32、objid=key&0xFFFFFFFF、objsubid=1。
#    首跑時我寫成 `granted AND (…)=key OR (… objid=key)` —— `A AND B OR C` 的優先序讓它退化成
#    「**任何**已授予的 advisory 鎖」⇒ 等到的是**上一格殘留的鎖**,L2 因此假紅(memory
#    `feedback_assertion-measures-the-wrong-thing`:量錯東西)。這裡把述詞收成單一條件。
nlock(){ q "SELECT count(*)::text FROM pg_locks
             WHERE locktype='advisory' AND objsubid=1
               AND ((classid::bigint << 32) | (objid::bigint)) = $1 AND granted IS $2;"; }
wait_granted(){ local i; for i in $(seq 1 80); do
    [ "$(nlock "$1" TRUE)"  != "0" ] && return 0; sleep 0.05; done; return 1; }
# 🔴 wait_blocked 的預算 = **2s**(100×0.02),不是 4s:唯一用它的 L2 後面還要在受測呼叫的
#    3s lock_timeout 內完成「注入漂移 + 解鎖」。預算開大只會把假紅變多(R1 nit 7)。
wait_blocked(){ local i; for i in $(seq 1 100); do
    [ "$(nlock "$1" FALSE)" != "0" ] && return 0; sleep 0.02; done; return 1; }
# 🔴 砍掉持有者之後**必須等後端真的釋放**才能進下一格:kill -9 砍的是 psql 客戶端,
#    伺服器端後端要收到 EOF 才回滾。首跑就是漏了這道 ⇒ 下一格的受測呼叫排在**舊**持有者後面,
#    等滿 3s 吐 55P03,看起來像「漂移沒被抓到」。
wait_released(){ local i; for i in $(seq 1 80); do
    [ "$(nlock "$1" TRUE)" = "0" ] && return 0; sleep 0.05; done; return 1; }

# ══════════════════════════════════════════════════════════════════════════
# RB 模式:回退實跑(R1 important 5)。🔴 真的改庫,結束時 apply 回 post-image。
# ══════════════════════════════════════════════════════════════════════════
if [ "$MODE" = "rb" ]; then
  RB_EXPECT_TOTAL=13
  PRE_MD5="fa8afcc2bf0f3c683e156a719fea80f0"
  MD5SQL="SELECT md5(prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND p.proname='close_released_attempt';"
  runrb(){ psql "$URL" -qtAX -v VERBOSITY=verbose -v ON_ERROR_STOP=1 -f "$ROLLBACK" 2>&1; }

  log "RB 回退實跑"
  val "RB1 起點=2e post-image" "$POST_MD5_EXPECT" "$MD5SQL"

  # 🔴 四種假 2g writer:v1 的閘①(prokind='f' + 逐字 public.payment_refunds)只擋得住第一種,
  #    另外三種會**靜默放行** —— 這四格就是 must-fix 1 的紅綠證據,不是形式。
  rb_blocked(){ local label="$1" ddl="$2" drop="$3" out
    sqlx "$ddl"
    out="$(runrb)"
    if printf '%s' "$out" | grep -q 'P2E20' && printf '%s' "$out" | grep -q 'l5b2_2e_rollback_group_blocked'
    then ok "$label"
    else bad "$label —— 期望 P2E20+l5b2_2e_rollback_group_blocked,實得: $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-220)"
    fi
    # 🔴 只在**最後一格**之前拆;RB3 要在假 writer 還在的狀態下量「有沒有被還原」
    [ -n "$drop" ] && sqlx "$drop"
    return 0; }

  rb_blocked "RB2 假 2g writer=FUNCTION + public.payment_refunds ⇒ 閘①擋" \
    'CREATE FUNCTION public.rb_fake_2g_f() RETURNS void LANGUAGE plpgsql AS $x$ BEGIN INSERT INTO public.payment_refunds(attempt_id) VALUES (NULL); END $x$;' ""
  val "RB3 被閘①擋下時**尚未還原任何東西**(md5 仍是 post-image)" "$POST_MD5_EXPECT" "$MD5SQL"
  sqlx 'DROP FUNCTION public.rb_fake_2g_f();'

  rb_blocked "RB4 假 2g writer=PROCEDURE ⇒ 閘①擋(v1 的 prokind='f' 會放行)" \
    'CREATE PROCEDURE public.rb_fake_2g_p() LANGUAGE plpgsql AS $x$ BEGIN INSERT INTO public.payment_refunds(attempt_id) VALUES (NULL); END $x$;' \
    'DROP PROCEDURE public.rb_fake_2g_p();'

  rb_blocked "RB5 假 2g writer=未 schema-qualified ⇒ 閘①擋(v1 逐字比對會放行)" \
    'CREATE FUNCTION public.rb_fake_2g_u() RETURNS void LANGUAGE plpgsql AS $x$ BEGIN INSERT INTO payment_refunds(attempt_id) VALUES (NULL); END $x$;' \
    'DROP FUNCTION public.rb_fake_2g_u();'

  rb_blocked "RB6 假 2g writer=MERGE INTO ⇒ 閘①擋(新增的 alternation 分支要有紅綠證據)" \
    'CREATE FUNCTION public.rb_fake_2g_m() RETURNS void LANGUAGE plpgsql AS $x$ BEGIN MERGE INTO public.payment_refunds t USING (SELECT 1) s ON false WHEN NOT MATCHED THEN DO NOTHING; END $x$;' \
    'DROP FUNCTION public.rb_fake_2g_m();'

  # 🔴 R2 codex must-fix 2 點名的另兩形。⚠️ **它舉的第一個例子是錯的**:`INSERT INTO ONLY <表>`
  #    在 PostgreSQL **不是合法語法**(吃 ONLY 的是 UPDATE/DELETE/SELECT/MERGE,INSERT 不吃)——
  #    實測 `syntax error at or near "ONLY"` ⇒ 那一形**造不出來,不構成漏洞**。
  #    但底層顧慮成立(MERGE 確實吃 ONLY)⇒ 本格改打 `MERGE INTO ONLY`,那才是真的存在的形狀。
  rb_blocked "RB6b 假 2g writer=MERGE INTO **ONLY** ⇒ 閘①擋(INSERT INTO ONLY 非合法語法、不在射程內)" \
    'CREATE FUNCTION public.rb_fake_2g_only() RETURNS void LANGUAGE plpgsql AS $x$ BEGIN MERGE INTO ONLY public.payment_refunds t USING (SELECT 1) s ON false WHEN NOT MATCHED THEN DO NOTHING; END $x$;' \
    'DROP FUNCTION public.rb_fake_2g_only();'
  rb_blocked "RB6c 假 2g writer=quoted identifier + 點號兩側空白 ⇒ 閘①擋" \
    'CREATE FUNCTION public.rb_fake_2g_q() RETURNS void LANGUAGE plpgsql AS $x$ BEGIN INSERT INTO "public" . "payment_refunds"(attempt_id) VALUES (NULL); END $x$;' \
    'DROP FUNCTION public.rb_fake_2g_q();'

  # 🔴 反向格(判別力來源):不相干的表**不得**被前綴誤擋。誤擋的症狀是「回退永遠跑不動」,
  #    比漏擋更難發現 —— v1 的判準真的中過(ab_arch 實測命中)。
  #    ⚠️ 本格會讓回退**真的執行成功**(沒有 writer 擋),所以量完要 apply 回 post-image 才能接 RB7。
  sqlx 'CREATE FUNCTION public.rb_fake_arch() RETURNS void LANGUAGE plpgsql AS $x$ BEGIN INSERT INTO public.payment_refunds_archive(id) VALUES (NULL); END $x$;'
  RBARCH="$(runrb)"
  if printf '%s' "$RBARCH" | grep -q 'l5b2_2e_rollback_group_blocked'; then
    bad "RB6d 反向:寫 payment_refunds_archive 的函式**被誤擋** ⇒ 詞尾邊界失效,回退路徑會永久卡死"
  else ok "RB6d 反向:payment_refunds_archive 不被誤判成 payment_refunds 的 writer(詞尾邊界有效)"; fi
  sqlx 'DROP FUNCTION public.rb_fake_arch();'
  psql "$URL" -qtAX -v ON_ERROR_STOP=1 -f "$MIG" > "$RACEDIR/rb-mid-reapply.log" 2>&1 \
    || echo "  🔴 RB6d 之後重新 apply 失敗,見 $RACEDIR/rb-mid-reapply.log"

  # ── 假 writer 全拆掉 ⇒ 這次要真的回退成功 ──
  RBOUT="$(runrb)"
  if [ -n "${RBOUT##*ERROR*}" ] || [ -z "$RBOUT" ]; then :; else
    echo "  (回退輸出) $(printf '%s' "$RBOUT" | tr '\n' ' ' | cut -c1-300)"
  fi
  val "RB7 回退後本體=pre-image" "$PRE_MD5" "$MD5SQL"
  val "RB8 proconfig 恰為 search_path=\"\"(2e 加的 lock_timeout 必須消失)" 'search_path=""' \
    "SELECT array_to_string(proconfig,' | ') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='close_released_attempt';"
  val "RB9 COMMENT 回到 A8c1 世代(有其專屬字面、且不含 2e 段落)" true \
    "SELECT (strpos(obj_description('public.close_released_attempt(uuid, text)'::regprocedure,'pg_proc'),
                    'E10-A8c1(2026-08-04)起 begin 持 orders 先鎖') > 0
             AND strpos(obj_description('public.close_released_attempt(uuid, text)'::regprocedure,'pg_proc'),
                    'L5b-2 片 2e') = 0)::text;"

  # ── 復原:重新 apply(讓叢集回到 post-image,rb 模式可重複跑)──
  psql "$URL" -qtAX -v ON_ERROR_STOP=1 -f "$MIG" > "$RACEDIR/rb-reapply.log" 2>&1 \
    || echo "  🔴 重新 apply 失敗,見 $RACEDIR/rb-reapply.log"
  val "RB10 重新 apply ⇒ 回到 post-image(叢集已復原)" "$POST_MD5_EXPECT" "$MD5SQL"

  echo
  rm -rf "${RACEDIR:-}" 2>/dev/null || true
  echo "PASS=$PASS FAIL=$FAIL(RB_EXPECT_TOTAL=$RB_EXPECT_TOTAL)"
  [ "$PASS" = "$RB_EXPECT_TOTAL" ] || { echo "🔴 格數 $PASS ≠ $RB_EXPECT_TOTAL"; exit 1; }
  [ "$FAIL" = "0" ] || exit 1
  exit 0
fi

# ── 共用 fixture ────────────────────────────────────────────────────────────
# 🔴 **逐段各用一顆 attempt,不共用**。首跑時 D1 與 L4 都因為共用而假紅:
#    D1 的標的身上還掛著 §C 造的在途退款(先撞 P2E01,根本走不到步 7);
#    L4 的標的已被 L3 **真的 commit** 結案(回 idempotent:true,構造不成環)。
#    ⇒ 這不是「守門壞了」,是**格與格之間互相汙染**。分開配置才量得到各自要量的東西。
pick_att(){ q "SELECT a.id::text FROM public.payment_charge_attempts a
                 JOIN public.orders o ON o.id = a.order_id
                WHERE a.status='released' AND o.payment_status='unpaid'
                ORDER BY a.id OFFSET $1 LIMIT 1;"; }
A1="$(pick_att 0)"     # §B 回歸 + §C 否決條件(會掛一顆在途退款上去)
A2="$(pick_att 1)"     # §C5「別人的退款不影響我」+ §L3 併發(🔴 L3 會真的 commit,跑完要還原)
A_D1="$(pick_att 2)"   # §D1 order-paid guard(必須乾淨:沒有在途退款)
A_L12="$(pick_att 3)"  # §L1/§L2 advisory 逾時與 order_id 漂移(兩格都不會結案成功)
A_L4="$(pick_att 4)"   # §L4 死結構造(🔴 可能 commit,跑完要還原)
A_L5="$(pick_att 5)"   # §L5 鎖序判別(對手持 advisory 再要列鎖;基線必須**不**成環)
O1="$(q "SELECT order_id::text FROM public.payment_charge_attempts WHERE id='$A1'::uuid;")"
O_D1="$(q "SELECT order_id::text FROM public.payment_charge_attempts WHERE id='$A_D1'::uuid;")"
O_L12="$(q "SELECT order_id::text FROM public.payment_charge_attempts WHERE id='$A_L12'::uuid;")"
O_L4="$(q "SELECT order_id::text FROM public.payment_charge_attempts WHERE id='$A_L4'::uuid;")"
# 一顆 charged(非 released 的拒絕路徑)
A_CH="$(q "SELECT id::text FROM public.payment_charge_attempts WHERE status='charged' ORDER BY id LIMIT 1;")"
# 一顆沒有任何 attempt 的 order(L2 漂移標的:搬過去不會撞 per-order partial unique)
O_SPARE="$(q "SELECT o.id::text FROM public.orders o
               WHERE NOT EXISTS (SELECT 1 FROM public.payment_charge_attempts a WHERE a.order_id=o.id)
               ORDER BY o.id LIMIT 1;")"
for _v in "$A1" "$A2" "$A_D1" "$A_L12" "$A_L4" "$A_L5" "$O1" "$O_D1" "$O_L12" "$O_L4" "$A_CH" "$O_SPARE"; do
  case "$_v" in ????????-????-*) : ;; *) die "FIXTURE_FAIL:取不到足夠的 fixture(得到 [$_v]);
   本檔需要 6 顆 released+unpaid 的 attempt、1 顆 charged、1 顆無 attempt 的 order。" ;; esac
done
O_L5="$(q "SELECT order_id::text FROM public.payment_charge_attempts WHERE id='$A_L5'::uuid;")"
KEY_L12="$(advkey "$O_L12")"
KEY_L4="$(advkey "$O_L4")"
KEY_L5="$(advkey "$O_L5")"

# 🔴 乾淨叢集閘(fail-fast,**不是**一格):本檔的 §B/§C 假設五顆 fixture attempt 身上**沒有**
#    在途退款。前一次 `run`(或 `rb`)造的退款是**真的 commit** 的(§E 只還原 attempt 狀態,
#    不刪退款),所以在同一個叢集上重跑 ⇒ B1/B2/B3/C2 會紅在「尚有未結案退款」。
#    那四個紅**是否決條件正確發火**,不是守門壞掉 —— 但看起來一模一樣。實測踩過一次,
#    所以在這裡就停,把話講白,而不是讓人去讀四行像 bug 的訊息。
DIRTY="$(q "SELECT count(*)::text FROM public.payment_refunds pr
             WHERE pr.attempt_id IN ('$A1'::uuid,'$A2'::uuid,'$A_D1'::uuid,'$A_L12'::uuid,'$A_L4'::uuid,'$A_L5'::uuid)
               AND NOT EXISTS (SELECT 1 FROM public.payment_refund_effective_terminal et
                                WHERE et.refund_id = pr.id);")"
[ "$DIRTY" = "0" ] || die "叢集不乾淨:fixture attempt 身上已有 $DIRTY 筆在途退款(= 前一次 run/rb 的殘留)。
   本檔要求**乾淨叢集**(突變輪也是每靶一個乾淨叢集)。請重新 provision:
     scripts/d1t2-rehearsal.sh teardown $WORK && PORT=$PORT scripts/d1t2-rehearsal.sh provision $WORK
   (不要改期望值去遷就殘留 —— 那會把「否決真的發火」洗成綠的。)"

BASE_ATT="$(q "SELECT count(*)::text FROM public.payment_charge_attempts WHERE status='failed';")"
BASE_RF="$(q "SELECT count(*)::text FROM public.payment_refunds;")"
BASE_EV="$(q "SELECT count(*)::text FROM public.payment_refund_events;")"
BASE_OR="$(q "SELECT count(*)::text FROM public.order_refunds;")"

# 造一筆掛在 $A1 上的**未結案**退款(父列存在、canonical view 無有效終局)
mk_refund(){ q "INSERT INTO public.payment_refunds(attempt_id,idempotency_key,amount,currency,strong_key,lease_token)
  VALUES ('$1'::uuid, substr(replace(gen_random_uuid()::text,'-',''),1,20), 100, 'TWD',
          'bank:'||replace(gen_random_uuid()::text,'-',''), 0) RETURNING id::text;"; }

# ══════════════════════════════════════════════════════════════════════════
log "A 結構(post-image 獨立重量)"
val "A1 proconfig 含 search_path=\"\"" true \
  "SELECT ('search_path=\"\"' = ANY(proconfig))::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='close_released_attempt';"
val "A2 proconfig 含 lock_timeout=3s" true \
  "SELECT ('lock_timeout=3s' = ANY(proconfig))::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='close_released_attempt';"
val "A3 prosecdef" true \
  "SELECT prosecdef::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='close_released_attempt';"
val "A4 owner" postgres \
  "SELECT pg_get_userbyid(proowner) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='close_released_attempt';"
val "A5 proacl 逐字(僅 owner)" "postgres=X/postgres" \
  "SELECT array_to_string(proacl,' | ') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='close_released_attempt';"
val "A6 負向 ACL:五角色皆無 EXECUTE" 0 \
  "SELECT count(*)::text FROM unnest(ARRAY['anon','authenticated','service_role','authenticator','payment_confirmer']) r
    WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r)
      AND has_function_privilege(r,'public.close_released_attempt(uuid, text)','EXECUTE');"
val "A7 prosrc 含 advisory 鍵式子逐字" true \
  "SELECT (strpos(prosrc, '(''x'' || pg_catalog.substr(pg_catalog.replace(v_order_id_pre::text, ''-'', ''''), 1, 16))::bit(64)::bigint') > 0)::text
     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='close_released_attempt';"
# 🔴 順序錨:**先剝 -- 註解**再比位置(不剝會量到註解;recon §3 實測)。本支找 'FOR UPDATE'
#    (② admin_initiate_order_refund 是 'FOR NO KEY UPDATE',兩支不共用字串)。
#    ⚠️ 廉價前哨,不是判別力來源;真判別力在 L5 的 M5 消融。
val "A8 順序錨(剝註解後 0 < advisory < FOR UPDATE)" true \
  "WITH s AS (SELECT regexp_replace(prosrc,'--[^'||chr(10)||']*','','g') AS b
                FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
               WHERE n.nspname='public' AND p.proname='close_released_attempt')
   SELECT (strpos(b,'pg_advisory_xact_lock') > 0
           AND strpos(b,'FOR UPDATE') > 0
           AND strpos(b,'pg_advisory_xact_lock') < strpos(b,'FOR UPDATE'))::text FROM s;"
val "A9 canonical view 在庫" true \
  "SELECT (to_regclass('public.payment_refund_effective_terminal') IS NOT NULL)::text;"
val "A10 post-image prosrc md5 釘死" "$POST_MD5_EXPECT" \
  "SELECT md5(prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='close_released_attempt';"
# A11 承重假設(`attempt.order_id` 不可變)的**早期預警**——母 plan :855-856 指定的那道。
# 🔴 **它釘的是「誰會寫這張表」的集合,不是「誰指派了 order_id」。** 為什麼換形狀:
#    我試過三次寫「SET 子句是否指派 order_id」的精確掃描,三次各自壞在不同的假陽性上
#    (① `[^;]*` 從 SET 吃過 WHERE ⇒ 把 `WHERE … order_id =` 算進來 ② `superseded_by_order_id`
#    的子字串命中 ③ 非貪婪終結子仍會跳到後面第二個 WHERE)。
#    **帶著已知假陽性基線的掃描是噪音產生器,不是守門** ⇒ 改用精確可算的集合式。
#    代價:任何人**新增**這張表的寫入者都會紅,即使他沒碰 order_id。那是**刻意的**
#    (形制同母 plan §5-12 第四方硬閘):它逼新寫入者回答「你有沒有動 order_id」。
# ⚠️ **誠實邊界**(R1 nit 9 補齊,逐條列而不是一句「只涵蓋函式本體」):
#    ✅ 涵蓋(R2 codex important 3 校正:原文寫 `[public.]` 暗示可選,**實際 regex 強制 `public.`**):
#       public 函式(prokind='f')本體裡**逐字** `UPDATE public.payment_charge_attempts`。
#       🔴 **trigger 函式也在涵蓋範圍內**(它的 prokind 同樣是 'f')—— 原文把它列進「不涵蓋」是**寫錯**。
#    ❌ 不涵蓋:①`INSERT … ON CONFLICT DO UPDATE SET order_id = …`(不含 UPDATE 表名字樣)
#       ②`MERGE INTO payment_charge_attempts … WHEN MATCHED THEN UPDATE`
#       ③**未 schema-qualified 的 `UPDATE payment_charge_attempts`**(regex 強制 public.)
#       ④動態 SQL(`EXECUTE format(...)`)⑤owner 在 psql 直接 UPDATE ⑥procedure(prokind='p')。
#    ⇒ 早期預警,**不是**防線。真防線是函式內的 P2E02 復核(L2b 那格,已突變證明)。
#    v1 曾把整個風險押在文字掃描上,關卡1 MF3 打掉了那個安排。
#    (這裡刻意**不**跟著回退閘①一起放寬:放寬會改動下面釘死的 15 支名單=另一件事,不順手做。)
val "A11 payment_charge_attempts 的寫入者集合未變(15 支;新寫入者=紅)" \
  "claim_expired_pending_attempts,claim_order_poll_settle,claim_stuck_unsettled_attempts,close_released_attempt,expire_stuck_attempts_at_ceiling,flag_non_unpaid_active_attempts,mark_attempt_settle_retry,mark_charge_attempt_charged,mark_charge_attempt_charged_fallback,mark_charge_attempt_failed,mark_charge_attempt_released_for_user,record_charge_bank_txn,record_charge_pending_rec,record_released_failure_observation,supersede_charge_attempt_for_user" \
  "SELECT string_agg(p.proname, ',' ORDER BY p.proname)
     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prokind='f'
      AND p.prosrc ~* 'UPDATE[[:space:]]+public\.payment_charge_attempts\y';"
# A12 否決條件的**讀得到**前提(R1 must-fix 2 的 harness 對應格):
#    payment_refunds / payment_refund_events 已 ENABLE RLS 零 policy;任一開 FORCE ⇒ SECDEF 被自己
#    擋死、否決 SELECT 回 0 列 ⇒ P2E01 恆假。C1/C3 會因此變紅,但紅在「行為」;本格紅在**病因**。
val "A12 payment_refunds/events 皆未開 FORCE RLS(開了則否決恆假無聲失效)" 0 \
  "SELECT count(*)::text FROM pg_class
    WHERE oid IN ('public.payment_refunds'::regclass,'public.payment_refund_events'::regclass)
      AND relforcerowsecurity;"
# A13 本體註解宣稱「released→failed 才離開 per-order 鎖 partial index」——這句依賴 index predicate 含
#    'released'。🔴 它**被 R2 codex 當成 nit 指為寫錯**,實查是 codex 讀到 20260612150000:103 的**舊**定義;
#    該索引在 20260624120000:62-64 已重新定義成 ('pending','charged','released')。
#    ⇒ 我沒折那條,改成把事實**從 catalog 釘住**(memory:數物件現況要問 catalog、不能數 CREATE 敘述):
#      將來有人把 'released' 從 predicate 拿掉,本格會紅,那句註解就不會靜靜地變成假話。
val "A13 per-order 鎖 index 的 predicate 仍含 released(本體註解那句的事實基礎)" true \
  "SELECT (pg_get_expr(i.indpred, i.indrelid) LIKE '%released%')::text
     FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
    WHERE c.relname='payment_charge_attempts_order_lock_idx';"

# ══════════════════════════════════════════════════════════════════════════
log "B 既有行為未破壞(回歸;本片宣稱「其餘逐字不動」的證據)"
pass "B1 released + order unpaid ⇒ close 成功" \
  "SELECT public.close_released_attempt('$A1'::uuid,'B1 測試');"
val "B2 close 回傳 idempotent=false(首次)" "false" \
  "BEGIN; SELECT (public.close_released_attempt('$A1'::uuid,'B2')->>'idempotent'); ROLLBACK;"
# 重複 close:同一交易內連呼兩次,第二次必須是 idempotent:true
# (⚠️ `PERFORM` 是 plpgsql 語法、不能出現在 SQL 批次裡 —— 首跑就是這樣紅的)
# (第一次呼叫的輸出要吃掉,否則 `-c` 會把兩個 SELECT 的結果一起回來、比對必不符)
val "B3 重複 close ⇒ idempotent=true" "true" \
  "BEGIN; CREATE TEMP TABLE b3 AS SELECT public.close_released_attempt('$A1'::uuid,'B3a');
   SELECT (public.close_released_attempt('$A1'::uuid,'B3b')->>'idempotent'); ROLLBACK;"
err "B4 不存在的 attempt ⇒ RAISE" "ERROR" "不存在" \
  "SELECT public.close_released_attempt('00000000-0000-0000-0000-000000000000'::uuid,'B4');"
err "B5 p_resolution 空白 ⇒ RAISE" "ERROR" "必填非空" \
  "SELECT public.close_released_attempt('$A1'::uuid,'   ');"
err "B6 status=charged ⇒ RAISE 非 released" "ERROR" "非 released" \
  "SELECT public.close_released_attempt('$A_CH'::uuid,'B6');"

# ══════════════════════════════════════════════════════════════════════════
log "C 未結案退款否決(2e-D;終局定義一律消費 canonical view)"
R1="$(mk_refund "$A1")"
case "$R1" in ????????-*) : ;; *) die "FIXTURE_FAIL: R1=[$R1]" ;; esac
err "C1 掛未結案退款 ⇒ P2E01" "P2E01" "l5b2_2e_refund_in_flight" \
  "SELECT public.close_released_attempt('$A1'::uuid,'C1');"
# C2 正向對照:補一顆 result_confirmed ⇒ view 有有效終局 ⇒ 放行
#    🔴 少了這格,本節會獎勵「把什麼都擋掉」的錯解。
pass "C2 該退款有 result_confirmed ⇒ close 放行" \
  "INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token)
     VALUES ('$R1'::uuid,'result_confirmed',1,0);
   SELECT public.close_released_attempt('$A1'::uuid,'C2');"
# C3 🔴 判別力關鍵格:終局存在**但已被沖銷** ⇒ view 認定為「無有效終局」⇒ 仍要擋。
#    這格是「真的消費 view」與「自己判斷有沒有 manual」的**唯一**可分辨處。
sqlx "INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token,record_snapshot,actor)
        VALUES ('$R1'::uuid,'manual',1,0,'{\"refunded\":false}'::jsonb,'harness');"
sqlx "INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token,reverses_event_id,reversal_reason,actor)
        SELECT '$R1'::uuid,'manual_reversal',2,0,e.id,'harness 沖銷','harness'
          FROM public.payment_refund_events e
         WHERE e.refund_id='$R1'::uuid AND e.event_type='manual';"
err "C3 終局已被沖銷 ⇒ view 判無有效終局 ⇒ 仍 P2E01" "P2E01" "l5b2_2e_refund_in_flight" \
  "SELECT public.close_released_attempt('$A1'::uuid,'C3');"
# C4 語意保護:已結案 attempt + 掛未結案退款 ⇒ 仍回 idempotent:true(否決不得搶在冪等之前)
val "C4 已結案 + 掛未結案退款 ⇒ 仍 idempotent=true" "true" \
  "BEGIN;
   UPDATE public.payment_charge_attempts
      SET status='failed', released_closed_at=now(), released_closed_by='harness',
          released_close_resolution='C4 前置' WHERE id='$A1'::uuid;
   SELECT (public.close_released_attempt('$A1'::uuid,'C4')->>'idempotent'); ROLLBACK;"
# C5 範圍正確:別顆 attempt 的未結案退款不得擋到本顆(防「問全域」)
pass "C5 別的 attempt 有未結案退款 ⇒ 不影響本顆" \
  "SELECT public.close_released_attempt('$A2'::uuid,'C5');"
# C6 另一半終局(R1 nit 11):canonical view 的終局集合含 `result_failed`(indicates_refund=false
#    =錢沒動)。本片的否決只問「有沒有有效終局」⇒ result_failed **應該放行**。
#    🔴 沒有這格的話,「終局」這個概念只被 result_confirmed 那一半觀察過。
#    🔴 順序:必須在 C5 之後(C5 要求 $A2 身上沒有在途退款)。
R2="$(mk_refund "$A2")"
case "$R2" in ????????-*) : ;; *) die "FIXTURE_FAIL: R2=[$R2]" ;; esac
sqlx "INSERT INTO public.payment_refund_events(refund_id,event_type,seq,lease_token)
        VALUES ('$R2'::uuid,'result_failed',1,0);"
pass "C6 退款終局=result_failed(錢沒動)⇒ 仍放行 close" \
  "SELECT public.close_released_attempt('$A2'::uuid,'C6');"

# ══════════════════════════════════════════════════════════════════════════
log "D order_refunds 那半:靠的是**既有** order-paid guard(關卡1 MF2 補的觀察格)"
# 🔴 誠實:本格驗的是**我拿來當論證的既有守門**真的在該情境發火,不是我新增的守門。
# 🔴 標的必須是**乾淨**的 attempt(身上沒有在途退款),否則會先撞 §C 的 P2E01、根本走不到步 7,
#    那樣量到的是「否決條件擋下來」不是「order-paid guard 擋下來」。
# 🔴 D1 改名(R2 codex must-fix 3):舊名叫「該單有 processing 的 order_refunds ⇒ 被擋」,但 SQL
#    **從頭到尾沒有建立也沒有檢查任何 order_refunds 列**,只把 orders 改成 paid。
#    ⇒ 舊名宣稱的是 order_refunds 連動,實際量的是 order-paid guard 本身。改成名副其實。
err "D1 order 非 unpaid ⇒ 被既有 order-paid guard 擋(不涉 order_refunds)" "ERROR" "非 unpaid" \
  "BEGIN;
   UPDATE public.orders SET payment_status='paid' WHERE id='$O_D1'::uuid;
   SELECT public.close_released_attempt('$A_D1'::uuid,'D1');"
# D2a §9-1 的論證(「有退款 ⇒ 該單曾經 paid」)其實**有 DB 層依據**,不只是業務推論:
#     a7c 的 INSERT guard 在登記時就要求 orders.payment_status ∈ {paid,partiallyRefunded,refunded}。
err "D2a 訂單 unpaid 時登記 processing 退款 ⇒ 被 a7c INSERT guard 擋(P7C02)" "P7C02" "a7c_insert_order_payment_not_captured" \
  "BEGIN;
   INSERT INTO public.order_refunds(order_id,bank_refund_id,refund_amount,status,reason,actor,request_id,rec_trade_id,kind,record_refunded_before)
   VALUES ('$O_D1'::uuid,'d2a',100,'processing','harness','harness','d2a-rq','d2a-rec','full',0);"
# 🔴🔴 D2b = **殘餘缺口的實測證據**(R2 codex must-fix 3 指出、本輪實跑確認為真)。
#     D2a 擋的是「登記當下」;但退款登記完之後把 orders 改回 unpaid,狀態就繞過了 D2a,
#     而本片的否決只查 payment_refunds(attempt 尺度)⇒ **close 會成功**,在途的 order_refunds 沒人擋。
#     期望值刻意釘成「缺口存在」:
#     ⚠️ **這格將來變紅 = 有人把缺口補起來了。那時候請改 plan §9-1 的誠實邊界,不要改本格的期望值。**
val "D2b 在途 order_refunds + 訂單被改回 unpaid ⇒ close 仍成功(**已知缺口**,非守門)" "false" \
  "BEGIN;
   UPDATE public.orders SET payment_status='paid', tappay_rec_trade_id='d2b-rec' WHERE id='$O_D1'::uuid;
   INSERT INTO public.order_refunds(order_id,bank_refund_id,refund_amount,status,reason,actor,request_id,rec_trade_id,kind,record_refunded_before)
   VALUES ('$O_D1'::uuid,'d2b',100,'processing','harness','harness','d2b-rq','d2b-rec','full',0);
   UPDATE public.orders SET payment_status='unpaid' WHERE id='$O_D1'::uuid;
   SELECT (public.close_released_attempt('$A_D1'::uuid,'D2b')->>'idempotent'); ROLLBACK;"

# ══════════════════════════════════════════════════════════════════════════
log "L 併發(真並發;有界執行,突變症狀是 hang 不是紅)"
# L1 對手持 advisory ⇒ 本呼叫必須在 lock_timeout 內吐 55P03,而不是無限等
psql "$URL" -qtAX -c "BEGIN; SELECT pg_advisory_xact_lock($KEY_L12); SELECT pg_sleep(9); COMMIT;" \
  > "$RACEDIR/holder1.log" 2>&1 &
HOLD1=$!
if wait_granted "$KEY_L12"; then ok "L1a 對手已取得 advisory(編排成立=下面的觀察才是併發證據)"
else bad "L1a 對手沒取到 advisory ⇒ 編排不成立"; fi
T0=$(date +%s)
bounded 8 "$RACEDIR/l1.out" "SELECT public.close_released_attempt('$A_L12'::uuid,'L1');"; RC1=$?
T1=$(date +%s); ELAPSED=$((T1-T0))
if [ "$RC1" = "124" ]; then
  bad "L1b —— **逾時被外層砍**(等了 8s 仍未回)⇒ lock_timeout 沒生效(這正是拿掉它的症狀)"
elif grep -q '55P03' "$RACEDIR/l1.out"; then
  ok "L1b 對手持 advisory ⇒ 55P03(等了 ${ELAPSED}s)"
else
  bad "L1b —— 期望 55P03,實得: $(tr '\n' ' ' < "$RACEDIR/l1.out" | cut -c1-200)"
fi
if [ "$ELAPSED" -le 5 ]; then ok "L1c 快速失敗:${ELAPSED}s ≤ 5s(3s 門檻 + 排程餘裕)"
else bad "L1c —— 等了 ${ELAPSED}s(期望 ≤5s)⇒ 不是 3s 那道在擋"; fi
# 🔴 收尾要砍的是**後端**不是客戶端:持有者卡在 `pg_sleep(9)` 裡,`kill -9` 砍掉 psql 之後
#    後端不會察覺 EOF(pg_sleep 不檢查連線),鎖照抱滿 9 秒 ⇒ 下一格排在殘留鎖後面、假紅。
#    這正是首跑 L2b 誤判的成因,所以這裡走 pg_terminate_backend 並**驗證真的釋放**。
q "SELECT pg_terminate_backend(pid) FROM pg_locks
    WHERE locktype='advisory' AND objsubid=1
      AND ((classid::bigint << 32) | (objid::bigint)) = $KEY_L12 AND granted;" >/dev/null 2>&1
kill -9 $HOLD1 2>/dev/null; wait $HOLD1 2>/dev/null || true
wait_released "$KEY_L12" || die "L1 收尾:advisory 未釋放,後續格會排在殘留鎖後面(首跑的假紅來源)"

# L2 order_id 漂移:利用「卡在 advisory」這個阻塞點,在兩次讀之間改掉 order_id
# 🔴 編排改成**受控解鎖**(R1 nit 7)。v1 讓對手 `pg_sleep(1.5)` 自己放手,而 wait_blocked 最長
#    等 4s ⇒ 編排一慢,對手先放手、受測呼叫**不帶漂移**就跑完 = L2b 假紅(方向安全但沒有結論)。
#    改成:對手抱住不放(30s)→ 確認受測呼叫真的卡上 → 注入漂移 → **主動 terminate 對手**。
#    ⚠️ 仍有一個時間預算是**改不掉**的:受測呼叫的 lock_timeout 由函式層 SET 釘死 3s,
#       所以「卡上→注入→解鎖」必須在 3s 內完成。超過 ⇒ 55P03,下面會**明說是編排太慢**,
#       不會混進「漂移沒被抓到」。wait_blocked 也因此收成 2s 預算(見其定義)。
psql "$URL" -qtAX -c "BEGIN; SELECT pg_advisory_xact_lock($KEY_L12); SELECT pg_sleep(30); COMMIT;" \
  > "$RACEDIR/holder2.log" 2>&1 &
HOLD2=$!
wait_granted "$KEY_L12" || bad "L2a 對手沒取到 advisory ⇒ 編排不成立"
psql "$URL" -qtAX -v VERBOSITY=verbose -c "SELECT public.close_released_attempt('$A_L12'::uuid,'L2');" \
  > "$RACEDIR/l2.out" 2>&1 &
VICTIM=$!
if wait_blocked "$KEY_L12"; then ok "L2a 受測呼叫已卡在 advisory 上(=已過無鎖預讀、尚未鎖下重讀)"
else bad "L2a 受測呼叫沒卡上 ⇒ 下面的觀察不是 TOCTOU 證據"; fi
# 🔴 注入要**計時**:若受測呼叫是在取 advisory **之前**就先鎖了 attempt 列(= 順序被改壞,靶 M5
#    那類突變的症狀),這句 UPDATE 會被它的列鎖擋住、一路等到它 55P03 才過。
#    沒有這個計時,下面只會看到「55P03」,而 55P03 有**兩個成因**(編排太慢 / 順序被改壞),
#    報成前者=把一個真紅寫成「本格無結論」。實測:M5 那輪原本就是這樣被誤標的。
INJ_T0=$(date +%s)
sqlx "UPDATE public.payment_charge_attempts SET order_id='$O_SPARE'::uuid WHERE id='$A_L12'::uuid;"
INJ_EL=$(( $(date +%s) - INJ_T0 ))
# 受控解鎖:砍**後端**(對手卡在 pg_sleep 裡,砍客戶端它不會察覺 —— L1 收尾同一個坑)
q "SELECT pg_terminate_backend(pid) FROM pg_locks
    WHERE locktype='advisory' AND objsubid=1
      AND ((classid::bigint << 32) | (objid::bigint)) = $KEY_L12 AND granted;" >/dev/null 2>&1
kill -9 $HOLD2 2>/dev/null; wait $HOLD2 2>/dev/null || true
wait $VICTIM 2>/dev/null || true
if grep -q 'P2E02' "$RACEDIR/l2.out" && grep -q 'l5b2_2e_order_id_drift' "$RACEDIR/l2.out"; then
  ok "L2b order_id 在兩次讀之間被改 ⇒ P2E02/l5b2_2e_order_id_drift(fail-closed,不是靜默鎖錯隊伍)"
elif grep -q '55P03' "$RACEDIR/l2.out" && [ "$INJ_EL" -ge 1 ]; then
  bad "L2b —— 55P03,而且漂移注入被擋了 ${INJ_EL}s ⇒ **受測呼叫在取 advisory 之前就先鎖了 attempt 列**
       = 取鎖順序被改壞(靶 M5 的症狀)。**這是真紅**,不是編排問題;對照 A8 那格"
elif grep -q '55P03' "$RACEDIR/l2.out"; then
  bad "L2b —— 受測呼叫吐 55P03、但注入沒被擋(${INJ_EL}s)⇒ **編排太慢**(卡上→注入→解鎖超過函式的 3s lock_timeout),本格無結論、不是守門失效"
else
  bad "L2b —— 期望 P2E02+l5b2_2e_order_id_drift,實得: $(tr '\n' ' ' < "$RACEDIR/l2.out" | cut -c1-200)"
fi
sqlx "UPDATE public.payment_charge_attempts SET order_id='$O_L12'::uuid WHERE id='$A_L12'::uuid;"

# L3 兩條同時 close 同一顆 ⇒ 恰一條真的結案(🔴 本格會**真的 commit**,結束時還原)
race_close(){ local tag="$1"
  PGAPPNAME="c2e_$tag" psql "$URL" -qtAX \
    -c "BEGIN; SELECT pg_advisory_xact_lock_shared(4242); SELECT (public.close_released_attempt('$A2'::uuid,'L3-$tag')->>'idempotent'); COMMIT;" \
    > "$RACEDIR/l3.$tag" 2>&1 & }
psql "$URL" -qtAX -c "SELECT pg_advisory_lock(4242); SELECT pg_sleep(1.2); SELECT pg_advisory_unlock(4242);" \
  > "$RACEDIR/ctl3.log" 2>&1 &
CTL3=$!
wait_granted 4242 >/dev/null 2>&1 || true
race_close a; race_close b
BARRIER=0
for _ in $(seq 1 60); do
  n="$(q "SELECT count(*)::text FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid
           WHERE l.locktype='advisory' AND NOT l.granted AND a.application_name IN ('c2e_a','c2e_b');")"
  [ "$n" = "2" ] && { BARRIER=1; break; }
  sleep 0.05
done
wait $CTL3 2>/dev/null || true
wait 2>/dev/null || true
[ "$BARRIER" = "1" ] && ok "L3a 兩條都真的卡在 barrier 上才被放行(=真併發)" \
                     || bad "L3a barrier 沒成立 ⇒ 下面不是併發證據"
NFALSE=$(cat "$RACEDIR/l3.a" "$RACEDIR/l3.b" 2>/dev/null | grep -c '^false$')
# 🔴 只數 false 的條數不夠(R2 codex important 2):另一條就算是**任意 ERROR、空輸出、或程序直接死掉**
#    也照樣讓「恰一條 false」成立 ⇒ 本格會在「併發把另一條打爆」的情況下全綠。
#    plan 寫的是「另一條只能是 idempotent=true 或 55P03」,所以就照那個驗。
NOTHER=$(cat "$RACEDIR/l3.a" "$RACEDIR/l3.b" 2>/dev/null | grep -c '^true$')
N55=$(cat "$RACEDIR/l3.a" "$RACEDIR/l3.b" 2>/dev/null | grep -c '55P03')
if [ "$NFALSE" = "1" ] && [ $((NOTHER + N55)) -ge 1 ]; then
  ok "L3b 兩條同時 close ⇒ 恰一條 idempotent=false,另一條是 true 或 55P03(不是被打爆)"
else
  bad "L3b —— false=[$NFALSE](期望 1)、另一條 true=[$NOTHER]/55P03=[$N55](期望至少一)。
       實得: $(cat "$RACEDIR/l3.a" "$RACEDIR/l3.b" 2>/dev/null | tr '\n' ' ' | cut -c1-200)"
fi
sqlx "UPDATE public.payment_charge_attempts
         SET status='released', released_closed_at=NULL, released_closed_by=NULL,
             released_close_resolution=NULL
       WHERE id='$A2'::uuid;"

# L4 §4 前提被違反 ⇒ 真的會 40P01(證明 COMMENT 那句警告不是空話)
# 🔴 它證的是「前提被違反時真的會爆」,**不是**「本片消滅了死結」。
# 🔴 兩邊必須是**同一張單**:S1 持 orders(Y) 列鎖後等 advisory(Y);S2 持 advisory(Y) 等 orders(Y)。
#    首跑我讓兩邊用不同單的 attempt ⇒ 根本不共用任何資源,當然構造不出環。
psql "$URL" -qtAX -v VERBOSITY=verbose \
  -c "BEGIN; SELECT id FROM public.orders WHERE id='$O_L4'::uuid FOR UPDATE; SELECT pg_sleep(1);
      SELECT public.close_released_attempt('$A_L4'::uuid,'L4-S1'); ROLLBACK;" \
  > "$RACEDIR/l4.s1" 2>&1 &
S1=$!
sleep 0.35
bounded 12 "$RACEDIR/l4.s2" "SELECT public.close_released_attempt('$A_L4'::uuid,'L4-S2');"; RC4=$?
wait $S1 2>/dev/null || true
if [ "$RC4" = "124" ]; then
  bad "L4 —— S2 逾時被砍 ⇒ 沒觀察到 40P01(也沒觀察到死結被解),本格無結論"
elif grep -q '40P01' "$RACEDIR/l4.s1" "$RACEDIR/l4.s2"; then
  ok "L4 呼叫端交易先前持該單列鎖 ⇒ 真的構造出 40P01(§4 前提不是紙上談兵)"
else
  bad "L4 —— 期望某一方 40P01,實得 S1=[$(tr '\n' ' ' < "$RACEDIR/l4.s1"|cut -c1-140)] S2=[$(tr '\n' ' ' < "$RACEDIR/l4.s2"|cut -c1-140)]"
fi
sqlx "UPDATE public.payment_charge_attempts
         SET status='released', released_closed_at=NULL, released_closed_by=NULL,
             released_close_resolution=NULL
       WHERE id='$A_L4'::uuid;"

# L5 🔴🔴 鎖序本身的判別力(R2 codex must-fix 4:plan §8 M5 要求「advisory 後移必須構造得出 40P01」,
#     v3 的 M5 只紅 A8/A10/L2b,**沒有任何一格觀察到環**)。本格補上,做法是**基線就構造一個
#     「差一點就成環」的編排**,靠取鎖順序化解:
#       S1: 先取 advisory(Y)、稍後才要 attempt 列鎖
#       S2: close(同一顆 attempt)
#     · 基線(advisory 在列鎖**之前**):S2 一進來就卡在 advisory ⇒ 手上**沒有**任何列鎖
#       ⇒ 等待圖上只有一條邊 ⇒ **不成環**,S2 在 3s 吐 55P03,S1 順利拿到列鎖。
#     · M5(advisory 移到列鎖**之後**):S2 先抓住 attempt 列鎖再去等 advisory,S1 持 advisory 等該列鎖
#       ⇒ **成環 ⇒ 40P01**。
#     ⇒ 這格的紅綠**只由取鎖順序決定**,是 M5 真正的判別力來源(A8 只是文字錨)。
psql "$URL" -qtAX -v VERBOSITY=verbose \
  -c "BEGIN; SELECT pg_advisory_xact_lock($KEY_L5); SELECT pg_sleep(0.6);
      SELECT id FROM public.payment_charge_attempts WHERE id='$A_L5'::uuid FOR UPDATE;
      SELECT pg_sleep(5); ROLLBACK;" > "$RACEDIR/l5.s1" 2>&1 &
S5=$!
if wait_granted "$KEY_L5"; then ok "L5a 對手已持 advisory(編排成立)"
else bad "L5a 對手沒取到 advisory ⇒ 下面不是鎖序證據"; fi
bounded 12 "$RACEDIR/l5.s2" "SELECT public.close_released_attempt('$A_L5'::uuid,'L5');"; RC5=$?
if [ "$RC5" = "124" ]; then
  bad "L5b —— S2 逾時被砍(12s 未回)⇒ 既沒 55P03 也沒 40P01,本格無結論"
elif grep -q '40P01' "$RACEDIR/l5.s1" "$RACEDIR/l5.s2"; then
  bad "L5b —— 觀察到 **40P01**:S2 在等 advisory 之前就抓了列鎖 ⇒ **取鎖順序已被改壞**(這正是 M5 的症狀)"
elif grep -q '55P03' "$RACEDIR/l5.s2"; then
  ok "L5b 對手持 advisory ⇒ S2 卡在 advisory(手上無列鎖)⇒ 只有 55P03、**不成環**(鎖序有效)"
else
  bad "L5b —— 期望 55P03 且無 40P01,實得 S2=[$(tr '\n' ' ' < "$RACEDIR/l5.s2" | cut -c1-160)]"
fi
q "SELECT pg_terminate_backend(pid) FROM pg_locks
    WHERE locktype='advisory' AND objsubid=1
      AND ((classid::bigint << 32) | (objid::bigint)) = $KEY_L5 AND granted;" >/dev/null 2>&1
kill -9 $S5 2>/dev/null; wait $S5 2>/dev/null || true
wait_released "$KEY_L5" || die "L5 收尾:advisory 未釋放"

log "E 零留痕自檢(psql -c 成功即 autocommit;沒有這段會出現「全綠但真的寫進去了」)"
# 🔴 誠實邊界:§L3 與 §L4 是**真併發格,必須真的 commit** 才有觀察值 ⇒ 它們動到的兩顆 attempt
#    由本檔在該格結束時**明確還原**。因此 E1 的職責**不是**「證明 L3/L4 沒寫」(它們寫了、又被還原),
#    而是抓「**除此之外**還有沒有別的東西偷偷寫進去」—— 例如某個本該 ROLLBACK 的正向格其實自動提交了。
val "E1 failed attempt 數回到基準(L3/L4 的刻意提交已明確還原)" "$BASE_ATT" \
  "SELECT count(*)::text FROM public.payment_charge_attempts WHERE status='failed';"
val "E2 六顆 fixture attempt 全部回到 released" 6 \
  "SELECT count(*)::text FROM public.payment_charge_attempts
    WHERE id IN ('$A1'::uuid,'$A2'::uuid,'$A_D1'::uuid,'$A_L12'::uuid,'$A_L4'::uuid,'$A_L5'::uuid)
      AND status='released' AND released_closed_at IS NULL;"
val "E6 order_refunds 零殘留(§D2 全在 BEGIN/ROLLBACK 內)" "$BASE_OR" \
  "SELECT count(*)::text FROM public.order_refunds;"
val "E3 payment_refunds 只多本檔造的 2 顆(§C 的 R1 + §C6 的 R2)" "$((BASE_RF+2))" \
  "SELECT count(*)::text FROM public.payment_refunds;"
val "E4 payment_refund_events 只多 3 筆(§C3 的 manual+manual_reversal、§C6 的 result_failed)" "$((BASE_EV+3))" \
  "SELECT count(*)::text FROM public.payment_refund_events;"
val "E5 L2 動過的 order_id 已還原" "$O_L12" \
  "SELECT order_id::text FROM public.payment_charge_attempts WHERE id='$A_L12'::uuid;"

echo
rm -rf "${RACEDIR:-}" 2>/dev/null || true
echo "PASS=$PASS FAIL=$FAIL(EXPECT_TOTAL=$EXPECT_TOTAL)"
if [ "$PASS" != "$EXPECT_TOTAL" ]; then
  echo "🔴 格數 $PASS ≠ 釘住的 $EXPECT_TOTAL ⇒ 有格被刪掉或沒跑到(全綠也不算數)"; exit 1
fi
[ "$FAIL" = "0" ] || exit 1
