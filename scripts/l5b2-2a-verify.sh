#!/usr/bin/env bash
# ============================================================
# L5b-2 片 2a 驗證 harness:claim RPC DROP+重建加 superseded_at
# ============================================================
# plan   = docs/specs/2026-08-10-l5b-2-compensation-writer-plan.md(v8)§2 片表 2a / §2f-4
# 標的   = supabase/migrations/20260811060000_m4b_lifecycle_l5b2_2a_claim_returns_superseded_at.sql
# 回退   = scripts/l5b2-2a-rollback.sql(本檔每次 reset 都跑它 ⇒ 回退腳本被實跑十幾次)
#
# 用法(**workdir = d1t2 provision 的 workdir**,因為身分閘要讀它的 cluster-id):
#   scripts/l5b2-2a-verify.sh all <workdir>          自己 provision → 跑 → teardown(自足)
#   PORT=54402 scripts/l5b2-2a-verify.sh run <workdir>   叢集已在(開發用)
#
# 🔴 本片的守門**全是結構斷言**(回傳形狀 / prosrc / 語境 / owner / proacl / allowlist /
#    schema USAGE / 有效權 / 成員白名單)⇒ 驗收 = **逐道配一發突變、看它紅在哪一道**。
#    只跑正向 = 只證「這支能 apply」,證不了任何一道有效力。
#
# ── 反假綠的四道承重設計(對抗審查 R1 打出來的,不是原本就有的)────────────
#   ① **叢集身分閘**:run 模式先比對 `pg_control_system()` 與 provision 寫下的 cluster-id。
#      沒有它,PORT 指到別窗的叢集時,本腳本會**直接 DROP 掉人家的金流 RPC**。
#   ② **reset 的有效性斷言不只比 functiondef md5**:連 owner / proacl / SECDEF 一起比。
#      只比本體 ⇒ 「本體對但 ACL 已被前一發突變汙染」照樣算 reset 成功,後面每一格的紅都不算數。
#   ③ **每發突變之後回頭確認函式仍是 pre-image**:確認那次 apply 真的整片回滾了。
#      少了它,「錯的 post-image 落地 + 測試照樣報 killed」是可能的,而下一輪 reset 又把證據抹掉。
#   ④ **PASS 數必須等於 EXPECT_TOTAL**:否則刪掉任一格仍然 exit 0、仍然「全綠」。
# ============================================================
set -uo pipefail
export LC_ALL=C

MODE="run"
case "${1:-}" in all|run) MODE="$1"; shift ;; esac
WORK="${1:-/tmp/l5b2p}"
PORT="${PORT:-54402}"
URL="postgresql://postgres@127.0.0.1:${PORT}/postgres"

MIG="supabase/migrations/20260811060000_m4b_lifecycle_l5b2_2a_claim_returns_superseded_at.sql"
ROLLBACK="scripts/l5b2-2a-rollback.sql"
SIG="public.claim_stuck_unsettled_attempts(integer,integer)"
# pre-image functiondef 指紋:本機 PG17.10 與正式庫 17.6 兩邊量到同一顆(見 $MIG 檔頭)
PREIMG_MD5="98a064dabe40782b84a4450d959d3bd5"
PROBE_ROLE="l5b2_2a_probe_role"

# 🔴 依賴檔的 SHA 釘在這裡(對抗審查 R2 打中,成立)
#    w7 收據只記 **harness 自己的 SHA** 與 migration 目錄尾碼 ⇒ 在同一個 060000 之下改了 migration
#    或 rollback 而不動 harness,`w7-coverage.sh check` 照樣 40/0 —— 帳面「跑過」證明不了跑的是**現在這版**。
#    釘在 harness 裡 ⇒ 改了它們而沒重跑本檔 = 本檔紅;改了本檔 = harness SHA 變 = w7 收據判定過期。
#    兩邊接起來,迴圈才閉合。
MIG_SHA_EXPECT="2e462448270888b21e29ac1b76ee306ebbd2b955"
RB_SHA_EXPECT="a7c108bc14d72908b6580bf2f1bfd56ac4b8f649"

# 🔴 量出來的,不是估的(每加/刪一格必同步改;它就是「刪格會紅」那道守門)
EXPECT_TOTAL=25

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
q()   { psql "$URL" -qtAX -c "$1" 2>&1; }

test -f "$MIG"      || { echo "🔴 找不到 $MIG(請在 repo 根目錄跑)"; exit 1; }
test -f "$ROLLBACK" || { echo "🔴 找不到 $ROLLBACK"; exit 1; }
for pair in "$MIG:$MIG_SHA_EXPECT" "$ROLLBACK:$RB_SHA_EXPECT"; do
  _f="${pair%%:*}"; _want="${pair##*:}"; _got="$(shasum "$_f" | cut -d' ' -f1)"
  [ "$_got" = "$_want" ] || { echo "🔴 $_f 的 SHA=[$_got] 與本檔釘住的 [$_want] 不符 ⇒ 依賴檔改過但本檔沒同步。"; \
      echo "   改法:確認改動是預期的,更新本檔的 *_SHA_EXPECT,然後 record 重跑(不要只改常數不重跑)。"; exit 1; }
done
mkdir -p "$WORK"
MUTDIR="$(mktemp -d "${TMPDIR:-/tmp}/l5b2-2a-mut.XXXXXX")"   # 🔴 每次跑一個新目錄:固定檔名會沿用前次內容
trap 'rm -rf "$MUTDIR"' EXIT

if [ "$MODE" = "all" ]; then
  # 🔴 trap **裝在 provision 之前**(對抗審查 R2 打中):provision 若在 migration 重放途中失敗,
  #    叢集已經起來了,而舊寫法此時 trap 還沒裝 ⇒ 直接 exit 1 留下一座活叢集佔著埠。
  # 🔴 而且 teardown 失敗要 **fail-closed**:舊寫法只印一行字、腳本仍以 0 離場
  #    ⇒ 夜跑 `verify && next` 會照走,下一支撞埠或誤連舊庫報全綠。
  teardown_and_verify() {
    local rc=$?
    rm -rf "$MUTDIR"
    local bad_exit=0
    if ! scripts/d1t2-rehearsal.sh teardown "$WORK" >/dev/null 2>&1; then
      echo "🔴 teardown 失敗 ⇒ 可能留下活叢集(PORT=$PORT workdir=$WORK),請手動 pg_ctl stop"; bad_exit=1
    fi
    if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
      echo "🔴 PORT=$PORT 仍有人聽(pid=$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t | tr '\n' ' '))⇒ 零留痕不成立"; bad_exit=1
    fi
    [ "$bad_exit" = "0" ] || exit 2      # 🔴 覆蓋原本的退出碼:留痕就是不通過
    exit "$rc"
  }
  trap teardown_and_verify EXIT
  echo "── provision(全量 migration)──"
  PORT="$PORT" scripts/d1t2-rehearsal.sh provision "$WORK" > "$WORK/provision.log" 2>&1 \
    || { echo "🔴 provision 失敗,見 $WORK/provision.log"; tail -20 "$WORK/provision.log"; exit 1; }
  echo "  ok   provision 完成(PORT=$PORT)"
fi

# ── ① 叢集身分閘(在對任何東西下 DROP 之前)──────────────────────────────
# 🔴 本腳本會 DROP 並重建一支**正在收錢的 RPC**。若 PORT 指到的不是本次 provision 的拋棄式叢集
#    (別窗的驗證庫、某個殘留叢集,甚至有人把 PORT 指到別處),損害是真的且不可逆。
#    d1t2 provision 會把 system_identifier 寫進 $WORK/cluster-id ⇒ 拿它當身分證。
if [ ! -f "$WORK/cluster-id" ]; then
  echo "🔴 $WORK/cluster-id 不存在 ⇒ 無法確認 PORT=$PORT 上的叢集是不是本次 provision 的那個。"
  echo "   本腳本會 DROP 金流 RPC,**拒絕在身分不明的叢集上跑**。"
  echo "   請用 'scripts/l5b2-2a-verify.sh all <workdir>',或把 <workdir> 指向 provision 用的那個目錄。"
  exit 1
fi
LIVE_ID="$(q "SELECT system_identifier FROM pg_control_system();")"
WANT_ID="$(cat "$WORK/cluster-id")"
if [ -z "$LIVE_ID" ] || [ "$LIVE_ID" != "$WANT_ID" ]; then
  echo "🔴 叢集身分不符:PORT=$PORT 上是 [$LIVE_ID],$WORK/cluster-id 記的是 [$WANT_ID]。拒跑。"
  exit 1
fi
echo "  ok   叢集身分閘:PORT=$PORT 確認是本 workdir provision 的那個叢集"
PASS=$((PASS+1))

# ── reset:跑**真正的回退腳本**把 claim 還原成三欄版 ────────────────────────
reset_preimage() {
  if ! psql "$URL" -v ON_ERROR_STOP=1 -f "$ROLLBACK" > "$MUTDIR/reset.log" 2>&1; then
    echo "🔴🔴 reset 失敗(回退腳本自己紅了)⇒ 後面每一格都不算數,停止。log:"
    tail -5 "$MUTDIR/reset.log"; exit 1
  fi
  # 🔴 有效性斷言:**四個面一起比**,只比本體會讓「本體對、ACL 被前一發突變汙染」蒙混過去
  local st
  st="$(q "SELECT md5(pg_get_functiondef('$SIG'::regprocedure))
           || '|' || pg_catalog.pg_get_userbyid(p.proowner)
           || '|' || COALESCE(pg_catalog.array_to_string(p.proacl, ','), '(NULL)')
           || '|' || p.prosecdef::text
           || '|' || COALESCE(pg_catalog.array_to_string(p.proconfig, ','), '(none)')
             FROM pg_catalog.pg_proc p WHERE p.oid = '$SIG'::regprocedure;")"
  local want="${PREIMG_MD5}|postgres|postgres=X/postgres,payment_confirmer=X/postgres|true|search_path=\"\""
  if [ "$st" != "$want" ]; then
    echo "🔴🔴 reset 後基線不符 ⇒ 後續突變格全部無效,停止"
    echo "     實際=[$st]"
    echo "     期望=[$want]"
    exit 1
  fi
}

apply_mig() { psql "$URL" -qtAX -v ON_ERROR_STOP=1 -f "$1" 2>&1; }

# 🔴 消融會把函式改成**第三種狀態**(既非 pre-image 也非 2a post-image)⇒ 回退腳本的狀態閘會
#    正確地拒絕盲目回退(那是它該做的事,不是 bug)。所以消融完要先把本體推回 post-image,
#    再走正常的 reset。**這一步是 R2 加了狀態閘之後才需要的;漏了它,整支 harness 會停在 reset。**
restore_post_image() {
  python3 - "$MIG" "$MUTDIR/restore.sql" <<'RESTORE_PY'
import sys, re
src = open(sys.argv[1], encoding='utf-8').read()
m = re.search(r'^CREATE FUNCTION public\.claim_stuck_unsettled_attempts\(.*?^\$fn\$;$', src, re.S | re.M)
if not m: sys.exit('抓不到 CREATE FUNCTION 區塊')
open(sys.argv[2], 'w', encoding='utf-8').write(m.group(0).replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION', 1))
RESTORE_PY
  psql "$URL" -qtAX -v ON_ERROR_STOP=1 -f "$MUTDIR/restore.sql" >/dev/null 2>&1 \
    || { echo "🔴 restore_post_image 失敗 ⇒ 後續格不算數,停止"; exit 1; }
}


# 突變格:reset → 產突變檔(產不出來就停)→ 套 → 必須紅在預期那道 → 再確認整片真的回滾了
mutate() {
  local name="$1" expect="$2" sentinel="$3" pyexpr="$4"
  local f="$MUTDIR/mut-$(printf '%s' "$name" | tr -cd 'A-Za-z0-9').sql"
  reset_preimage
  if ! python3 - "$MIG" "$f" "$pyexpr" <<'PY'
import sys
src = open(sys.argv[1], encoding='utf-8').read()
out = eval(sys.argv[3], {'src': src, 're': __import__('re')})
if out == src:
    sys.exit('突變沒改到任何東西(字面對不上)')
open(sys.argv[2], 'w', encoding='utf-8').write(out)
PY
  then
    bad "$name(產突變檔失敗 ⇒ 這格什麼都沒證明)"; return
  fi
  if [ -n "$sentinel" ] && ! grep -qF "$sentinel" "$f"; then
    bad "$name(哨兵 [$sentinel] 不在產物裡 ⇒ 突變沒套上)"; return
  fi
  local out; out="$(apply_mig "$f")"
  if ! printf '%s' "$out" | grep -qF "$expect"; then
    bad "$name → 沒紅在 [$expect];實際:$(printf '%s' "$out" | tail -2 | tr '\n' ' ')"; return
  fi
  # 🔴 突變被擋下 ≠ 什麼都沒落地。確認函式仍是三欄 pre-image(= 整片真的回滾了)
  local now; now="$(q "SELECT md5(pg_get_functiondef('$SIG'::regprocedure));")"
  if [ "$now" != "$PREIMG_MD5" ]; then
    bad "$name → 紅對了,但**函式已被改動**(md5=$now)⇒ 失敗的 migration 有東西落地了"; return
  fi
  ok "$name → 紅在預期那道,且整片已回滾"
}

# 直接改**庫**(不是改檔)的突變:$1=名 $2=期望訊息 $3=下毒SQL $4=解毒SQL
mutate_db() {
  local name="$1" expect="$2" poison="$3" antidote="$4"
  reset_preimage
  if ! psql "$URL" -qtAX -v ON_ERROR_STOP=1 -c "$poison" >/dev/null 2>&1; then
    bad "$name(下毒 SQL 自己失敗 ⇒ 這格沒有靶)"; return
  fi
  local out ex
  out="$(apply_mig "$MIG")"; ex=$?
  # 🔴 R2 打中:原本只比錯誤字串,沒驗「apply 真的失敗」也沒驗「事後仍是 pre-image」。
  #    可構造的假綠:把目標的 RAISE EXCEPTION 弱化成**同字串的 NOTICE** ⇒ 訊息照樣命中、
  #    migration 卻 **commit 成功**,這格仍記 ok,而下一輪 reset 把證據抹掉。
  # 🔴 量指紋要在**解毒之後**:M6 的毒本身就是 `ALTER FUNCTION … SET statement_timeout`,
  #    它會改變 functiondef ⇒ 毒還在時量,量到的是毒,不是「migration 有沒有落地」。
  #    (我第一版就把量測放在解毒前,M6 因此假紅一次。)
  psql "$URL" -qtAX -c "$antidote" >/dev/null 2>&1
  local now; now="$(q "SELECT md5(pg_get_functiondef('$SIG'::regprocedure));")"
  if ! printf '%s' "$out" | grep -qF "$expect"; then
    bad "$name → 沒紅在 [$expect];實際:$(printf '%s' "$out" | tail -2 | tr '\n' ' ')"; return
  fi
  if [ "$ex" -eq 0 ]; then
    bad "$name → 訊息命中但 **apply 退出碼是 0** ⇒ 它只是印了訊息、沒有真的擋下來"; return
  fi
  if [ "$now" != "$PREIMG_MD5" ]; then
    bad "$name → 紅對了,但函式已被改動(md5=$now)⇒ 失敗的 migration 有東西落地了"; return
  fi
  ok "$name → 紅在預期那道,且 apply 非零退出、整片已回滾"
}

echo
echo "── 正向 ──────────────────────────────────────────────"
# 🔴 先無條件把本體推回 2a post-image:上一輪若在消融段夭折,函式會停在**第三種狀態**,
#    回退腳本的狀態閘會(正確地)拒絕動它 ⇒ 沒有這一行,一次中斷會讓之後每一次跑都卡在第一個 reset。
#    這裡敢這樣做的唯一理由是**上面的叢集身分閘已經確認這是本次 provision 的拋棄式叢集**。
restore_post_image
reset_preimage
OUT="$(apply_mig "$MIG")"
if [ -z "$OUT" ]; then ok "2a 套用成功(零輸出)"; else bad "2a 套用有輸出:$(printf '%s' "$OUT" | tail -2)"; fi

R="$(q "select pg_catalog.pg_get_function_result('$SIG'::regprocedure);")"
[ "$R" = "TABLE(attempt_id uuid, order_id uuid, settle_attempt_count integer, superseded_at timestamp with time zone)" ] \
  && ok "回傳=四欄、第四欄 superseded_at timestamptz" || bad "回傳形狀=[$R]"

A="$(q "select pg_catalog.array_to_string(p.proacl,',') from pg_catalog.pg_proc p where p.oid='$SIG'::regprocedure;")"
[ "$A" = "postgres=X/postgres,payment_confirmer=X/postgres" ] \
  && ok "ACL 終態 = owner + payment_confirmer(default privileges 給的三個前台角色已被 REVOKE 掉)" \
  || bad "ACL=[$A]"

O="$(q "select pg_catalog.pg_get_userbyid(proowner)||'|'||prosecdef::text||'|'||pg_catalog.array_to_string(proconfig,',') from pg_catalog.pg_proc where oid='$SIG'::regprocedure;")"
[ "$O" = 'postgres|true|search_path=""' ] && ok "owner 還原 + SECDEF + search_path 釘空" || bad "語境=[$O]"

T="$(q "select count(*) from pg_catalog.pg_class where relname='l5b2_2a_preimage_owner';")"
[ "$T" = "0" ] && ok "暫存表 ON COMMIT DROP 生效、零留痕" || bad "暫存表殘留 count=$T"

# 述詞零改變:本片只加回傳欄,claim 的**選取行為**必須逐字不變
B1SRC="$(q "select md5(pg_catalog.split_part(prosrc,'RETURNING',1)) from pg_catalog.pg_proc where oid='$SIG'::regprocedure;")"
reset_preimage
B0SRC="$(q "select md5(pg_catalog.split_part(prosrc,'RETURNING',1)) from pg_catalog.pg_proc where oid='$SIG'::regprocedure;")"
[ "$B1SRC" = "$B0SRC" ] && ok "述詞段(RETURNING 之前)與 pre-image 逐字相同 ⇒ 選取行為零改變" \
  || bad "述詞段被動到:新=[$B1SRC] 舊=[$B0SRC]"

echo
echo "── 行為格(結構斷言證不到的那一跳:值有沒有真的被吐出來)──"
# 🔴 上面全是**結構**斷言;沒有一個證明 `RETURNING a.superseded_at` 真的把那一列的值送出來。
#    管線每一跳都要有自己的守門(memory feedback_assertion-measures-the-wrong-thing 第四形狀)。
# 🔴 B1/B2 成對:只有 B1,「回傳寫死一個非 NULL 值」也會綠;B2 釘住 NULL 那一側。
reset_preimage; apply_mig "$MIG" >/dev/null
behaviour() { # $1=格名 $2=sup(y/n) $3=期望(notnull/null);EXPECT_FAIL=1 時本格必須紅
  local sup_at="NULL" want="$3"
  [ "$2" = "y" ] && sup_at="pg_catalog.now() - interval '1 hour'"
  local out
  out="$(psql "$URL" -qtAX <<SQL 2>&1
BEGIN;
DO \$b\$
DECLARE
  v_order uuid; v_user uuid; v_attempt uuid := gen_random_uuid();
  v_seeded timestamptz; v_returned timestamptz; v_rows integer;
BEGIN
  SELECT o.id, o.customer_user_id INTO v_order, v_user
    FROM public.orders o
   WHERE o.payment_status = 'unpaid'::public.payment_status
     AND NOT EXISTS (SELECT 1 FROM public.payment_charge_attempts a WHERE a.order_id = o.id)
   ORDER BY o.id LIMIT 1;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'SEED_BROKEN:找不到 unpaid 且無 attempt 的訂單(fixture 前提被打穿,不是本格的結論)';
  END IF;
  INSERT INTO public.payment_charge_attempts
    (id, order_id, customer_user_id, status, fallback_token_hash, created_at, updated_at,
     settle_attempt_count, next_settle_at, needs_manual_review, released_at, superseded_at, superseded_reason)
  VALUES
    (v_attempt, v_order, v_user, 'released', pg_catalog.repeat('a', 64),
     pg_catalog.now() - interval '2 days', pg_catalog.now() - interval '2 days',
     0, NULL, false, pg_catalog.now() - interval '2 hours', $sup_at,
     CASE WHEN $sup_at IS NULL THEN NULL ELSE 'record_not_found' END);

  SELECT a.superseded_at INTO v_seeded
    FROM public.payment_charge_attempts a WHERE a.id = v_attempt;

  SELECT count(*), pg_catalog.max(c.superseded_at) INTO v_rows, v_returned
    FROM public.claim_stuck_unsettled_attempts(0, 1000) c
   WHERE c.attempt_id = v_attempt;

  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'SEED_BROKEN:claim 沒撈到 seed 的那顆 attempt(rows=%)⇒ 下面的比對沒有意義', v_rows;
  END IF;
  IF v_returned IS DISTINCT FROM v_seeded THEN
    RAISE EXCEPTION 'MISMATCH:claim 回的 superseded_at=[%] 與該列實際值=[%] 不同', v_returned, v_seeded;
  END IF;
  RAISE NOTICE 'BEHAVIOUR_OK returned=%', COALESCE(v_returned::text, '(NULL)');
END
\$b\$;
ROLLBACK;
SQL
)"
  # 🔴 消融格:必須紅在 **MISMATCH**,不是「隨便紅」。
  #    否則連線失敗 / fixture 壞掉 / 無關 SQL 錯誤都會讓消融格恆綠(= 證不了原格有判別力)。
  if [ "${EXPECT_FAIL:-0}" = "1" ]; then
    if printf '%s' "$out" | grep -qF "MISMATCH:"; then ok "$1"
    elif printf '%s' "$out" | grep -qF "SEED_BROKEN:"; then
      bad "$1 → 紅在 fixture 前提而不是 MISMATCH ⇒ 這格證不了判別力"
    else
      bad "$1 → 消融之後沒有 MISMATCH:$(printf '%s' "$out" | tail -2 | tr '\n' ' ')"
    fi
    return
  fi
  if ! printf '%s' "$out" | grep -qF "BEHAVIOUR_OK"; then
    bad "$1 → $(printf '%s' "$out" | tail -2 | tr '\n' ' ')"; return
  fi
  if [ "$want" = "notnull" ] && printf '%s' "$out" | grep -qF "returned=(NULL)"; then
    bad "$1 → 兩邊都是 NULL,證不到透傳"; return
  fi
  if [ "$want" = "null" ] && ! printf '%s' "$out" | grep -qF "returned=(NULL)"; then
    bad "$1 → 期望 NULL 但拿到值"; return
  fi
  ok "$1"
}
behaviour "B1 讓路 attempt → 第四欄 == 該列實際 superseded_at(非 NULL)" y notnull
behaviour "B2 未讓路 attempt → 第四欄 == NULL(釘住另一側,防回傳寫死非 NULL)" n null

# 🔴 消融:B1/B2 一次就綠 ⇒ 先證它們**會紅**。兩發,因為它們的失效形狀不同:
#    B3a 接錯欄(released_at)⇒ 兩格都該紅,先驗 B1 那側;
#    B3b `COALESCE(superseded_at, released_at)` ⇒ **B1 照樣綠**(讓路那顆有值)、
#        只有 B2 會紅。少了 B3b,「用 COALESCE 補洞」這種改法完全抓不到(R1 打中)。
#    ⚠️ 兩發都不能走 migration(prosrc 指紋會先擋掉)⇒ 直接 REPLACE live 函式。
ablate() { # $1=描述 $2=RETURNING 換成什麼
  python3 - "$MIG" "$MUTDIR/ablate.sql" "$2" <<'PY'
import sys, re
src = open(sys.argv[1], encoding='utf-8').read()
m = re.search(r'^CREATE FUNCTION public\.claim_stuck_unsettled_attempts\(.*?^\$fn\$;$', src, re.S | re.M)
if not m: sys.exit('抓不到 CREATE FUNCTION 區塊')
blk = m.group(0).replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION', 1)
new = blk.replace('a.superseded_at       AS superseded_at', sys.argv[3] + ' AS superseded_at', 1)
if new == blk: sys.exit('消融沒套上:RETURNING 那一行的字面對不上')
open(sys.argv[2], 'w', encoding='utf-8').write(new)
PY
}
if ablate "released_at" "a.released_at" \
   && psql "$URL" -qtAX -v ON_ERROR_STOP=1 -f "$MUTDIR/ablate.sql" >/dev/null 2>&1; then
  EXPECT_FAIL=1 behaviour "B3a 消融:RETURNING 接成 released_at(同型別、同樣非 NULL)→ B1 必紅" y notnull
else
  bad "B3a 消融版本套不上去(這裡是直接 REPLACE、不該被擋)"
fi
if ablate "coalesce" "COALESCE(a.superseded_at, a.released_at)" \
   && psql "$URL" -qtAX -v ON_ERROR_STOP=1 -f "$MUTDIR/ablate.sql" >/dev/null 2>&1; then
  EXPECT_FAIL=1 behaviour "B3b 消融:COALESCE(superseded_at, released_at)→ **B2** 必紅(B1 抓不到這種)" n null
else
  bad "B3b 消融版本套不上去"
fi
restore_post_image                 # 先回到 2a post-image,回退腳本的狀態閘才收得下
reset_preimage; apply_mig "$MIG" >/dev/null

echo
echo "── 突變矩陣(每道斷言各一發;逐道對應,不重疊)────────"

mutate "M1 拿掉 REVOKE、留 GRANT(→ ⑥ allowlist)" \
  "期望恰 [payment_confirmer:EXECUTE]" "" \
  "re.sub(r'REVOKE ALL ON FUNCTION public\.claim_stuck_unsettled_attempts\(integer, integer\)\n  FROM [^;]*;', '', src)"

# 🔴 M1b 的期望值是**實測改過的**,原本我寫「→ ⑤ proacl 為 NULL」,跑出來不是。
#    實際:拿掉 REVOKE+GRANT 之後 proacl **不是 NULL**,而是
#      [PUBLIC:EXECUTE, anon:EXECUTE, authenticated:EXECUTE, service_role:EXECUTE]
#    ⇒ 因為本庫的 ALTER DEFAULT PRIVILEGES 會**主動塞具名授權**,proacl 從一開始就非空。
#    這格因此改成釘住**那個真實的災難終態**:一支金流 RPC 對 PUBLIC 與三個前台角色全開。
mutate "M1b REVOKE 與 GRANT 都拿掉(→ ⑥ 抓到 PUBLIC + 三前台角色全開)" \
  "[PUBLIC:EXECUTE,anon:EXECUTE,authenticated:EXECUTE,service_role:EXECUTE]" "" \
  "re.sub(r'(REVOKE ALL ON FUNCTION public\.claim_stuck_unsettled_attempts\(integer, integer\)\n  FROM [^;]*;|GRANT EXECUTE ON FUNCTION public\.claim_stuck_unsettled_attempts\(integer, integer\) TO payment_confirmer;)', '', src)"

mutate "M2 回傳第四欄改 timestamp(去 tz;prosrc 完全不動 → ① 回傳形狀)" \
  "assert:回傳形狀不是" "superseded_at timestamp)" \
  "src.replace('settle_attempt_count integer, superseded_at timestamptz)', 'settle_attempt_count integer, superseded_at timestamp)', 1)"

mutate "M3 owner 還原成 anon(→ ④ owner)" \
  "assert:owner 沒還原" "OWNER TO anon" \
  "src.replace('OWNER TO %I', 'OWNER TO anon', 1)"

mutate "M4 拿掉 SET search_path(本體不變 ⇒ prosrc 指紋照樣綠 → ③ 語境)" \
  "已非 SECURITY DEFINER、或 search_path 不再釘空" "" \
  "src.replace('LANGUAGE sql\nSECURITY DEFINER\nSET search_path = ' + chr(39)*2 + '\nAS \$fn\$', 'LANGUAGE sql\nSECURITY DEFINER\nAS \$fn\$', 1)"

mutate "M5 述詞加料(count++ 改 +2;回傳形狀與 ACL 全對 → ② prosrc)" \
  "post-image prosrc 指紋不符" "a.settle_attempt_count + 2" \
  "src.replace('SET settle_attempt_count = a.settle_attempt_count + 1', 'SET settle_attempt_count = a.settle_attempt_count + 2', 1)"

mutate "M5b 刪掉 COMMENT ON FUNCTION 整句(→ ⑧b COMMENT 那一件)" \
  "COMMENT 不見了、或不是本片這一份" "" \
  "re.sub(r'COMMENT ON FUNCTION public\.claim_stuck_unsettled_attempts\(integer, integer\) IS\n(  '+chr(39)+'.*'+chr(39)+'\n)*  '+chr(39)+'.*'+chr(39)+';', '', src)"

mutate_db "M6 live 定義漂移(多一個 SET → 前置閘,DROP 不該發生)" \
  "前置閘:claim_stuck_unsettled_attempts 的 live 定義與 pre-image 不符" \
  "ALTER FUNCTION $SIG SET statement_timeout = '31s';" \
  "ALTER FUNCTION $SIG RESET statement_timeout;"

mutate_db "M7 anon 繼承 payment_confirmer(proacl 逐字不變 → ⑧ 有效權負向)" \
  "有**有效** EXECUTE" \
  "GRANT payment_confirmer TO anon;" \
  "REVOKE payment_confirmer FROM anon;"

# 🔴 M8 的存在理由:M7 會**先**死在 ⑧,永遠到不了 ⑨ ⇒ 原本宣稱「⑨ 有突變證明」是假的(R1 打中)。
#    改用一個**不在三個前台角色清單裡**的探針角色 ⇒ ⑧ 全綠、只有 ⑨ 紅。
mutate_db "M8 探針角色繼承 payment_confirmer(⑧ 全綠 → 只紅 ⑨ 成員白名單)" \
  "有白名單外的成員" \
  "DO \$\$ BEGIN IF pg_catalog.to_regrole('$PROBE_ROLE') IS NULL THEN CREATE ROLE $PROBE_ROLE NOLOGIN; END IF; END \$\$; GRANT payment_confirmer TO $PROBE_ROLE;" \
  "REVOKE payment_confirmer FROM $PROBE_ROLE; DROP ROLE IF EXISTS $PROBE_ROLE;"

mutate_db "M9 拔掉 schema public 的 USAGE(EXECUTE 仍為真 → ⑦ schema USAGE)" \
  "對 schema public 沒有 USAGE" \
  "REVOKE USAGE ON SCHEMA public FROM PUBLIC, payment_confirmer;" \
  "GRANT USAGE ON SCHEMA public TO PUBLIC; GRANT USAGE ON SCHEMA public TO payment_confirmer;"

echo
echo "── 回退腳本(它本身也是產物,要驗)────────────────────"
reset_preimage; apply_mig "$MIG" >/dev/null
RB="$(psql "$URL" -v ON_ERROR_STOP=1 -f "$ROLLBACK" 2>&1)"
if printf '%s' "$RB" | grep -qF "rollback 完成"; then
  RBR="$(q "select pg_catalog.pg_get_function_result('$SIG'::regprocedure);")"
  RBM="$(q "select md5(pg_get_functiondef('$SIG'::regprocedure));")"
  [ "$RBR" = "TABLE(attempt_id uuid, order_id uuid, settle_attempt_count integer)" ] && [ "$RBM" = "$PREIMG_MD5" ] \
    && ok "回退腳本可執行且真的回到 pre-image(三欄 + functiondef md5 精確相符)" \
    || bad "回退後形狀/指紋不符:[$RBR] / [$RBM]"
else
  bad "回退腳本自驗沒過:$(printf '%s' "$RB" | tail -2 | tr '\n' ' ')"
fi

echo
echo "── 收尾:回到套用後的正確狀態 ────────────────────────"
reset_preimage
OUT="$(apply_mig "$MIG")"
[ -z "$OUT" ] && ok "最終狀態 = 2a 已套用" || bad "最終套用失敗:$(printf '%s' "$OUT" | tail -2)"
LEFT="$(q "select count(*) from pg_catalog.pg_roles where rolname='$PROBE_ROLE';")"
[ "$LEFT" = "0" ] && ok "探針角色零留痕" || bad "探針角色 $PROBE_ROLE 殘留"

echo
echo "── 誠實邊界(**沒有**被本矩陣證明的)────────────────"
cat <<'HONEST'
  ⚠️ ⑧ 的**正向**那半(payment_confirmer 必須有有效 EXECUTE)沒有獨立負測,**構造不出來**:
     它被 ⑥ allowlist 嚴格蘊含(⑥ 綠 ⇒ proacl 有 payment_confirmer=X ⇒ has_function_privilege 必真)。
     它的作用是**縱深**(⑥ 若被改寬時還在),不是本片的獨立判別力。不宣稱它「已驗證」。
  ⚠️ **間接可達不在射程**:owner 若持有別的 SECDEF 函式把本支包起來(或動態 SQL 轉呼),
     前台角色仍可間接觸發它,而 ⑥ / ⑧負向 / ⑨ **三道全綠**。本片不宣稱擋得住這條路。
  ⚠️ 只有 pre-image functiondef md5 在 **PG 17.6(正式庫)** 複核過。
     `pg_get_function_result` 的字串、proacl 的字面順序、owner=postgres 這些**只在本機 17.10 成立**,
     拿到 17.6 有誤紅的可能;誤紅時先比對版本再改常數。
  ⚠️ apply 當下的併發行為(sweeper 撞上 DROP)**已在本機兩連線實測**、結論寫在 migration 檔頭,
     但**沒有構造「commit 那一瞬間帶著快取計畫」**那個窗 ⇒ 那一種仍是未知。
  ⚠️ 本矩陣證的是**斷言的判別力**,不是「正式庫 apply 會成功」。後者的唯一證據是 apply 當下的 read-back。
HONEST

echo
echo "══ 結果:PASS=$PASS FAIL=$FAIL(期望 PASS=$EXPECT_TOTAL)══"
if [ "$FAIL" -eq 0 ] && [ "$PASS" -ne "$EXPECT_TOTAL" ]; then
  echo "🔴 零 FAIL 但格數不對(PASS=$PASS ≠ EXPECT_TOTAL=$EXPECT_TOTAL)⇒ 有格被刪/被跳過,判為未通過"
  exit 1
fi
[ "$FAIL" -eq 0 ] || exit 1
