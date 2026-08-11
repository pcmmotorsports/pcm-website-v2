#!/usr/bin/env bash
#
# A7-t 驗證 harness —— 讓「全綠 + 突變全紅」可被任何人重跑。
#
# 用法:
#   scripts/a7t-verify.sh all <workdir>    # provision -> 全部驗證 -> teardown
#   scripts/a7t-verify.sh run <workdir>    # 對已 provision 的庫只跑驗證
#
# 🔴 workdir 必須是**短路徑**(例 /tmp/a7tv):PG 的 Unix socket 路徑上限 103 bytes。
#
# ══ 判定紀律(關卡2 codex R1 五條 must-fix 全部折入)═══════════════════════════
# 初版的判別力比它宣稱的弱,五處都能造出假綠,逐條封死:
#   ①**s1 原本只看「成功 NOTICE 消失」** ⇒ SQL 語法錯、連線斷、或**紅在別的斷言上**
#     全都被計成「這條突變被抓到」。⇒ 現在要求 psql **非零退出** + 第一個 ERROR
#     **精確含該突變自己的預期訊息**;其他錯誤一律判 FAIL。
#   ②**probe_ok 原本不看 exit code、不看 ERROR、不看 marker 次數** ⇒ 在全部 NOTICE
#     之後追加一句 `SELECT 1/0`,輸出含錯誤仍判綠。⇒ 現在 `ON_ERROR_STOP=1` +
#     檢查 exit code + **拒絕輸出中出現任何 ERROR** + 12 個 marker **各恰好一次**。
#   ③**s2 原本對整份輸出做未錨定子字串搜尋** ⇒ 探針 2 的外層訊息若包住「探針 6 失敗」
#     字樣,want=6 就被誤判成功。⇒ 現在只取**第一個** ERROR 行,精確比對案例編號。
#   ④**5b 原本一次刪掉所有案例的復位** ⇒ 實際紅在探針 3(狀態由案例 1 留下),
#     而註解與報告都宣稱它守的是案例 11。⇒ 現在**只突變案例 11 那一行**、
#     斷言替換數恰為 1、且 root error 必須是探針 11。
#   ⑤**reapply 原本未 fail-closed、呼叫端也不看回傳值** ⇒ DROP 因鎖或權限失敗時,
#     後續突變跑在殘留物件上、紅點歸因全錯。⇒ 現在清理與重套都 `ON_ERROR_STOP=1`,
#     逐次檢查 exit code,並**驗終態物件集合**。
#
# 🔴 誠實邊界:本機 PG17 非 Supabase、auth.uid() 是 shim、C locale ≠ 正式站 en_US.UTF-8(#305)。
#    本 harness 證明「trigger 邏輯與觸發時機正確」,**不證明** Supabase ledger 原子性、
#    真實併發、正式站鎖競爭。**併發面本片刻意不防**(plan §2.0);併發證據另見
#    `scripts/a7t-concurrency-probe.sh`。
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

MODE="${1:?用法: a7t-verify.sh all|run <workdir>}"
WORK="${2:?缺 workdir(必須是短路徑,例 /tmp/a7tv)}"
MIG="supabase/migrations/20260730140000_m4b_e10_a7t_cancellation_consistency_triggers.sql"
PROBE="scripts/a7t-behavior-probe.sql"
PORT="${PORT:-54329}"
URL="postgresql://postgres@127.0.0.1:${PORT}/postgres"
export LC_ALL=C

PASS=0; FAIL=0
ok()  { printf '  ✅ %s\n' "$1"; PASS=$((PASS+1)); }
bad() { printf '  🔴 %s\n' "$1"; FAIL=$((FAIL+1)); }
log() { echo "== $* =="; }

# ══ workdir 與 cluster 身分閘(關卡2 R2 兩條 must-fix)═══════════════════════
# 🔴 原版 `rm -rf "$WORK"` **只檢查字串長度** ⇒ 誤傳 `/tmp`、repo 路徑或家目錄會直接刪資料。
# 🔴 原版 `run` 模式**不驗 cluster 身分**、還自己建「拋棄式」marker ⇒ 若 54329 上是
#    別的 PCM DB 或某條 tunnel,它會直接 DROP trigger 與函式。
#    (探針自己的白名單閘也因此形同虛設 —— 建 marker 的正是這支腳本。)
# ⇒ 三重把關:①路徑必須在 /tmp 底下且非 /tmp 本身 ②刪除前必須看到我們自己的 ownership marker
#            ③cluster 的 system_identifier 必須與 provision 當下存的那個相符。
MARK="$WORK/.a7t-throwaway"
CIDFILE="$WORK/cluster-id"

case "$(cd / && printf '%s' "$WORK")" in
  /tmp/?*) : ;;
  *) echo "🔴 workdir 必須在 /tmp 底下(收到:$WORK)—— 這支腳本會 rm -rf 它"; exit 2 ;;
esac
case "$WORK" in *..*) echo "🔴 workdir 不得含 ..(收到:$WORK)"; exit 2 ;; esac
[ ${#WORK} -le 40 ] || { echo "🔴 workdir 太長(${#WORK} 字元)—— socket 路徑上限 103 bytes"; exit 2; }

if [ "$MODE" = "all" ]; then
  if [ -e "$WORK" ] && [ ! -f "$MARK" ]; then
    echo "🔴 $WORK 已存在但**沒有本腳本的 ownership marker**($MARK)—— 拒絕 rm -rf,請換一個路徑"; exit 2
  fi
  log "0/7 provision 拋棄式 PG17(重用 d1t2 的 provision,不複製貼上)"
  rm -rf "$WORK"
  mkdir -p "$WORK" && : > "$MARK"
  scripts/d1t2-rehearsal.sh provision "$WORK" >/dev/null 2>&1 || { echo "🔴 provision 失敗"; exit 1; }
fi

[ -f "$MARK" ] || { echo "🔴 $WORK 不是本腳本建立的拋棄式 workdir(缺 $MARK);拒絕對它動任何 DDL"; exit 2; }

psql "$URL" -qtA -c 'SELECT 1' >/dev/null 2>&1 || { echo "🔴 連不上 $URL(先跑 all 模式)"; exit 1; }

# cluster 身分閘:provision 當下把 system_identifier 存起來,之後每次都必須相符。
CID="$(psql "$URL" -qtAc 'SELECT system_identifier FROM pg_control_system()' 2>/dev/null)"
[ -n "$CID" ] || { echo "🔴 讀不到 cluster system_identifier"; exit 1; }
if [ "$MODE" = "all" ]; then
  printf '%s' "$CID" > "$CIDFILE"
else
  [ -f "$CIDFILE" ] || { echo "🔴 缺 $CIDFILE —— 無法確認 $URL 是先前 provision 的那個拋棄式 cluster;拒絕繼續"; exit 2; }
  [ "$CID" = "$(cat "$CIDFILE")" ] || {
    echo "🔴 cluster 身分不符(實 $CID / 期望 $(cat "$CIDFILE"))—— port $PORT 上可能是別的資料庫;**零寫入退出**"; exit 2; }
fi

log "1/7 建拋棄式標記(探針的正向環境閘要求;身分閘已在上一步通過)"
psql "$URL" -v ON_ERROR_STOP=1 -q \
  -c "CREATE TABLE IF NOT EXISTS public.pcm_a7_probe_allowed (note text);" >/dev/null

# ── reapply:fail-closed 重置 + 終態物件集合複驗(判定紀律 ⑤)──────────────
reapply() {
  psql "$URL" -v ON_ERROR_STOP=1 -qtA > "$WORK/reset.log" 2>&1 <<'SQL'
DROP TRIGGER IF EXISTS order_cancellations_items_presence_ac ON public.order_cancellations;
DROP TRIGGER IF EXISTS order_cancellation_items_presence_ac ON public.order_cancellation_items;
DROP TRIGGER IF EXISTS order_cancellations_block_truncate_bt ON public.order_cancellations;
DROP TRIGGER IF EXISTS order_cancellation_items_block_truncate_bt ON public.order_cancellation_items;
DROP FUNCTION IF EXISTS public.pcm_assert_cancellation_has_items() CASCADE;
DROP FUNCTION IF EXISTS public.pcm_cancellation_ledger_block_truncate() CASCADE;
DROP FUNCTION IF EXISTS public.pgnoop() CASCADE;
SQL
  if [ $? -ne 0 ]; then
    echo "🔴 reapply 的清理階段失敗(fail-closed,不繼續):$(tail -2 "$WORK/reset.log")"; exit 1
  fi
  psql "$URL" -v ON_ERROR_STOP=1 -q -f "$MIG" > "$WORK/apply.log" 2>&1
  local rc=$?
  # 終態物件複驗(2026-08-11 #399 改寫;原版=「兩張表上的 user trigger 數 + 三支具名函式(含 pgnoop)= 6」,
  #                           其中 trigger 那半是**整張表的計數**、沒綁到本片自己那四支)
  # 🔴 原版與 migration 5.1 是同一種病:**精確集合**。A4a 後來在 order_cancellation_items 加了
  #    第三支 `..._summary_recompute_ac` ⇒ 在 HEAD 狀態它會數到 7 ⇒ migration 修好之後換這裡擋路。
  # 🔴 改法要**逐對綁 (relname, tgname)**,不能只 `tgname IN (…)`:只比名字的話,
  #    第三方在另一張目標表放同名誘餌會被算進來(關卡1 codex R1 MF2)。
  # 🔴 三個數字**分開比**、不加總:加總會讓「pgnoop 殘留 + 少一支函式」互相抵銷成同一個數。
  # ⚠️ 誠實代價(code-reviewer nit):改成只數具名四對之後,「兩張目標表上多出**非正規名**的殘留 trigger」
  #    不再讓 reapply 中止。今天沒有活的洩漏路徑(s1/3b 全在 BEGIN…ROLLBACK 內、s2 只重建正規名、
  #    reapply 清理階段會 DROP),但日後若有突變用非正規名建 trigger,它會靜默活到行為探針那段。
  local n
  n="$(psql "$URL" -qtA -c "SELECT (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace s ON s.oid=c.relnamespace WHERE s.nspname='public' AND NOT t.tgisinternal AND (c.relname, t.tgname) IN (('order_cancellations','order_cancellations_items_presence_ac'),('order_cancellations','order_cancellations_block_truncate_bt'),('order_cancellation_items','order_cancellation_items_presence_ac'),('order_cancellation_items','order_cancellation_items_block_truncate_bt'))) || '|' || (SELECT count(*) FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace WHERE s.nspname='public' AND p.proname IN ('pcm_assert_cancellation_has_items','pcm_cancellation_ledger_block_truncate')) || '|' || (SELECT count(*) FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace WHERE s.nspname='public' AND p.proname='pgnoop')" 2>/dev/null)"
  if [ "$rc" -eq 0 ] && [ "$n" != "4|2|0" ]; then
    echo "🔴 reapply 後終態 = $n(預期 4|2|0 = 四對具名 trigger|兩支函式|pgnoop 零殘留);中止"; exit 1
  fi
  cat "$WORK/apply.log"
  return $rc
}

log "2/7 A7-t apply + 結構驗收(零突變必須綠)"
OUT="$(reapply)"; RC=$?
if [ "$RC" -eq 0 ] && echo "$OUT" | grep -q 'A7-t 結構驗收全數通過'; then ok "apply + 結構驗收綠"
else bad "未通過(rc=$RC):$(echo "$OUT" | grep -m1 ERROR)"; fi
echo "$OUT" | grep -q 'A7-t 既有資料閘通過' && ok "既有資料閘有跑到" || bad "既有資料閘沒出現"

# 抽出結構驗收 DO block(第 2 個 `DO $$`)當突變靶
awk '/^DO \$\$$/{n++} n==2{print} n==2 && /^\$\$;$/{exit}' "$MIG" > "$WORK/a7t-assert.sql"
[ -s "$WORK/a7t-assert.sql" ] || { echo "🔴 抽不出驗收 DO block"; exit 1; }

# ── s1:結構突變 —— 必須非零退出 + 第一個 ERROR 精確含預期訊息(判定紀律 ①)──
s1() {
  local name="$1" ddl="$2" want="$3"
  { echo "BEGIN;"; echo "$ddl"; cat "$WORK/a7t-assert.sql"; echo "ROLLBACK;"; } > "$WORK/m.sql"
  psql "$URL" -v ON_ERROR_STOP=1 -qtA -f "$WORK/m.sql" > "$WORK/m.out" 2>&1
  local rc=$? first
  first="$(grep -m1 'ERROR:' "$WORK/m.out")"
  if [ "$rc" -eq 0 ] || grep -q 'A7-t 結構驗收全數通過' "$WORK/m.out"; then
    bad "S:$name —— 突變未被抓到(假綠)"
  elif [ -z "$first" ]; then
    bad "S:$name —— 非零退出但沒有 ERROR 行(harness 自身問題)"
  elif ! printf '%s' "$first" | grep -qF "$want"; then
    bad "S:$name —— 紅了但**第一個 ERROR 不是預期那條**(紅在錯的地方):$(printf '%s' "$first" | cut -c1-96)"
  else
    ok "S:$name → 命中預期斷言「$want」"
  fi
}

log "3/7 結構突變(必須非零退出、且第一個 ERROR 是自己那條斷言)"
s1 "DISABLE 一支 presence trigger" \
  "ALTER TABLE public.order_cancellations DISABLE TRIGGER order_cancellations_items_presence_ac;" "tgenabled"
s1 "ENABLE REPLICA(只在 replica 生效)" \
  "ALTER TABLE public.order_cancellations ENABLE REPLICA TRIGGER order_cancellations_items_presence_ac;" "tgenabled"
s1 "四支加 WHEN (false)" \
  "DROP TRIGGER order_cancellations_items_presence_ac ON public.order_cancellations; CREATE CONSTRAINT TRIGGER order_cancellations_items_presence_ac AFTER INSERT OR UPDATE ON public.order_cancellations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (false) EXECUTE FUNCTION public.pcm_assert_cancellation_has_items();" "WHEN 條件"
s1 "綁到同名異 schema 的 no-op" \
  "CREATE SCHEMA evil; CREATE FUNCTION evil.pcm_assert_cancellation_has_items() RETURNS trigger LANGUAGE plpgsql AS \$f\$ BEGIN RETURN NULL; END \$f\$; DROP TRIGGER order_cancellation_items_presence_ac ON public.order_cancellation_items; CREATE CONSTRAINT TRIGGER order_cancellation_items_presence_ac AFTER INSERT OR UPDATE OR DELETE ON public.order_cancellation_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION evil.pcm_assert_cancellation_has_items();" "綁的是"
s1 "改 INITIALLY IMMEDIATE + 別表同名誘餌" \
  "CREATE TABLE decoy (id int PRIMARY KEY); CREATE CONSTRAINT TRIGGER order_cancellations_items_presence_ac AFTER INSERT ON decoy DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.pcm_assert_cancellation_has_items(); DROP TRIGGER order_cancellations_items_presence_ac ON public.order_cancellations; CREATE CONSTRAINT TRIGGER order_cancellations_items_presence_ac AFTER INSERT OR UPDATE ON public.order_cancellations DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION public.pcm_assert_cancellation_has_items();" "deferrable/initdeferred"
s1 "子表 trigger 拿掉 DELETE" \
  "DROP TRIGGER order_cancellation_items_presence_ac ON public.order_cancellation_items; CREATE CONSTRAINT TRIGGER order_cancellation_items_presence_ac AFTER INSERT OR UPDATE ON public.order_cancellation_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.pcm_assert_cancellation_has_items();" "tgtype"
# 🔴 2026-08-11 #399:原本 want 是 5.1 的「user trigger 數」,而 5.1 已隨集合相等一起撤。
#    現在改由 5.2 的 NOT FOUND 抓。**want 必須帶完整 trigger 名** —— 5.2 那句
#    「表 % 上找不到 trigger %」是四支共用的模板,只寫「找不到 trigger」的話,
#    任何一支缺失都會命中 ⇒ 紅在別支也被判成命中(關卡1 codex R1 MF1)。
s1 "刪一支 TRUNCATE 攔截" \
  "DROP TRIGGER order_cancellation_items_block_truncate_bt ON public.order_cancellation_items;" \
  "上找不到 trigger order_cancellation_items_block_truncate_bt"
s1 "換成無害同名 trigger(名稱不變、由 tgtype 接住)" \
  "DROP TRIGGER order_cancellation_items_presence_ac ON public.order_cancellation_items; CREATE FUNCTION pgx1() RETURNS trigger LANGUAGE plpgsql AS \$f\$ BEGIN RETURN NULL; END \$f\$; CREATE TRIGGER order_cancellation_items_presence_ac AFTER INSERT ON public.order_cancellation_items FOR EACH ROW EXECUTE FUNCTION pgx1();" "tgtype"
s1 "EXECUTE 授權回 PUBLIC" \
  "GRANT EXECUTE ON FUNCTION public.pcm_assert_cancellation_has_items() TO PUBLIC;" "owner 以外的 grantee"
s1 "授權給自訂 grantee(非四個具名 role)" \
  "CREATE ROLE a7t_stranger; GRANT EXECUTE ON FUNCTION public.pcm_assert_cancellation_has_items() TO a7t_stranger;" "owner 以外的 grantee"
s1 "函式改非 SECURITY DEFINER" \
  "ALTER FUNCTION public.pcm_assert_cancellation_has_items() SECURITY INVOKER;" "不是 SECURITY DEFINER"
s1 "函式拿掉 search_path 釘死" \
  "ALTER FUNCTION public.pcm_assert_cancellation_has_items() RESET search_path;" "search_path 未釘死"
s1 "函式改無條件 RETURN NULL" \
  "CREATE OR REPLACE FUNCTION public.pcm_assert_cancellation_has_items() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS \$f\$ BEGIN RETURN NULL; END \$f\$;" "本體指紋"
s1 "保留兩段字面但邏輯反了" \
  "CREATE OR REPLACE FUNCTION public.pcm_assert_cancellation_has_items() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS \$f\$ DECLARE v_cnt integer; BEGIN IF false THEN SELECT count(*) INTO v_cnt FROM public.order_cancellation_items WHERE cancellation_id = v_x; RAISE EXCEPTION '沒有任何品項明細'; END IF; RETURN NULL; END \$f\$;" "本體指紋"
s1 "TRUNCATE 攔截函式被改成放行" \
  "CREATE OR REPLACE FUNCTION public.pcm_cancellation_ledger_block_truncate() RETURNS trigger LANGUAGE plpgsql AS \$f\$ BEGIN RETURN NULL; END \$f\$;" "本體指紋"

# ── 3b:#399 反轉後的**明示正向案例**(不是唯一判別器 —— 關卡2 codex nit 更正)────────────
# 上面 15 條全是「守門仍咬得住」;這一條反過來明寫**新語意生效**:第三方往同一張表加一支
# 無關 trigger(A4a 當初做的就是這件事)⇒ 結構驗收必須**放行**。
# ⚠️ 它不是唯一能分辨新舊語意的格:2/7 的零突變本來就跑在「A4a 第三支已在場」的庫上,
#    舊版集合相等在那裡就會紅。3b 的價值是把這件事**指名寫出來**(靶名自帶意圖),
#    免得日後有人把包含式又收緊回去時,只看到 2/7 紅而以為是環境問題。
log "3b/7 反轉驗證:同表多一支第三方 trigger,結構驗收必須放行(#399 包含式語意)"
{ echo "BEGIN;"
  echo "CREATE FUNCTION public.zz_a7t_third_party() RETURNS trigger LANGUAGE plpgsql AS \$f\$ BEGIN RETURN NULL; END \$f\$;"
  echo "CREATE TRIGGER zz_a7t_third_party_ac AFTER INSERT ON public.order_cancellation_items FOR EACH ROW EXECUTE FUNCTION public.zz_a7t_third_party();"
  cat "$WORK/a7t-assert.sql"; echo "ROLLBACK;"; } > "$WORK/allow.sql"
psql "$URL" -v ON_ERROR_STOP=1 -qtA -f "$WORK/allow.sql" > "$WORK/allow.out" 2>&1
ALLOW_RC=$?
if [ "$ALLOW_RC" -eq 0 ] && grep -q 'A7-t 結構驗收全數通過' "$WORK/allow.out"; then
  ok "A:第三方多一支 trigger → 結構驗收放行(集合相等已撤,合法演進不再被擋)"
else
  bad "A:第三方多一支 trigger 竟被擋(rc=$ALLOW_RC):$(grep -m1 'ERROR:' "$WORK/allow.out" | cut -c1-96)"
fi

log "4/7 行為探針(零突變必須綠)"
reapply >/dev/null || { echo '🔴 reapply 失敗(fail-closed)'; exit 1; }

# ── probe_ok:exit code + 零 ERROR + 12 個 marker 各恰一次(判定紀律 ②)──────
probe_run() {  # $1 = 先跑的 DDL(可空);$2 = 探針檔;輸出寫 $WORK/p.out,回傳 psql exit code
  local extra="${1:-}" pf="${2:-$PROBE}"
  if [ -n "$extra" ]; then
    psql "$URL" -v ON_ERROR_STOP=1 -qtA -c "$extra" > "$WORK/pre.out" 2>&1 || {
      echo "🔴 突變 DDL 本身失敗(harness 問題,不是被測物):$(tail -2 "$WORK/pre.out")"; exit 1; }
  fi
  psql "$URL" -v ON_ERROR_STOP=1 -qtA -f "$pf" > "$WORK/p.out" 2>&1
  return $?
}

probe_ok() {  # 回傳 0 = 綠
  local rc="$1" i c
  [ "$rc" -eq 0 ] || return 1
  grep -q 'ERROR:' "$WORK/p.out" && return 1
  for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
    c="$(grep -c "A7T-CASE-${i}-OK" "$WORK/p.out")"
    [ "$c" = "1" ] || return 1
  done
  grep -q '行為驗收全數通過(12 / 12)' "$WORK/p.out" || return 1
  grep -q '零殘留複驗通過' "$WORK/p.out" || return 1
  return 0
}

probe_run; RC=$?
if probe_ok "$RC"; then ok "探針 12/12 + 零殘留(exit 0、零 ERROR、12 marker 各恰一次)"
else bad "探針未全綠(rc=$RC):$(grep -m1 -E 'ERROR|失敗' "$WORK/p.out" | cut -c1-96)"; fi

# ── s2:突變必須紅在**指定案例**,且以「第一個 ERROR」為準(判定紀律 ③)──────
s2() {
  local name="$1" ddl="$2" want="$3"
  reapply >/dev/null || { echo '🔴 reapply 失敗(fail-closed)'; exit 1; }
  probe_run "$ddl"; local rc=$? first
  first="$(grep -m1 'ERROR:' "$WORK/p.out")"
  if probe_ok "$rc"; then
    bad "B:$name —— 突變未被任何探針抓到(假綠)"
  elif [ -z "$first" ]; then
    bad "B:$name —— 非零退出但沒有 ERROR 行(harness 自身問題)"
  elif ! printf '%s' "$first" | grep -qF "探針 ${want} 失敗"; then
    bad "B:$name —— 紅了但**第一個 ERROR 不是探針 ${want}**(紅在錯的地方):$(printf '%s' "$first" | cut -c1-96)"
  else
    ok "B:$name → 由探針 ${want} 抓到(如預期)"
  fi
}

NOOP="CREATE OR REPLACE FUNCTION public.pgnoop() RETURNS trigger LANGUAGE plpgsql AS \$f\$ BEGIN RETURN NULL; END \$f\$;"

log "5/7 行為突變(必須紅在指定案例)"
# 🔴 「只留一支」不能用 DROP TRIGGER —— 探針的 `SET CONSTRAINTS <具名>` 會因找不到名字而報錯,
#    那是紅在「名字不存在」、不是紅在「不變式逃脫」(初版就是這樣假紅的)。⇒ 保留名字換綁 no-op。
s2 "header presence 換綁 no-op(等於只留子表那支)" \
  "$NOOP DROP TRIGGER order_cancellations_items_presence_ac ON public.order_cancellations; CREATE CONSTRAINT TRIGGER order_cancellations_items_presence_ac AFTER INSERT OR UPDATE ON public.order_cancellations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.pgnoop();" 2
s2 "子表 presence 換綁 no-op(等於只留 header 那支)" \
  "$NOOP DROP TRIGGER order_cancellation_items_presence_ac ON public.order_cancellation_items; CREATE CONSTRAINT TRIGGER order_cancellation_items_presence_ac AFTER INSERT OR UPDATE OR DELETE ON public.order_cancellation_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.pgnoop();" 4
s2 "函式改無條件 RETURN NULL" \
  "CREATE OR REPLACE FUNCTION public.pcm_assert_cancellation_has_items() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS \$f\$ BEGIN RETURN NULL; END \$f\$;" 2
s2 "拿掉關聯條件(改算全表)" \
  "CREATE OR REPLACE FUNCTION public.pcm_assert_cancellation_has_items() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS \$f\$ DECLARE v_cnt integer; BEGIN SELECT count(*) INTO v_cnt FROM public.order_cancellation_items; IF v_cnt = 0 THEN RAISE EXCEPTION '沒有任何品項明細'; END IF; RETURN NULL; END \$f\$;" 2
s2 "UPDATE 只驗 NEW 不驗 OLD" \
  "CREATE OR REPLACE FUNCTION public.pcm_assert_cancellation_has_items() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS \$f\$ DECLARE v_ids uuid[]; v_x uuid; v_d uuid; v_cnt integer; BEGIN IF TG_TABLE_NAME = 'order_cancellations' THEN v_ids := ARRAY[NEW.id]; ELSIF TG_OP = 'DELETE' THEN v_ids := ARRAY[OLD.cancellation_id]; ELSE v_ids := ARRAY[NEW.cancellation_id]; END IF; FOREACH v_x IN ARRAY v_ids LOOP SELECT id INTO v_d FROM public.order_cancellations WHERE id = v_x; CONTINUE WHEN NOT FOUND; SELECT count(*) INTO v_cnt FROM public.order_cancellation_items WHERE cancellation_id = v_x; IF v_cnt = 0 THEN RAISE EXCEPTION '沒有任何品項明細'; END IF; END LOOP; RETURN NULL; END \$f\$;" 6
s2 "拿掉兩支 TRUNCATE 攔截" \
  "DROP TRIGGER order_cancellations_block_truncate_bt ON public.order_cancellations; DROP TRIGGER order_cancellation_items_block_truncate_bt ON public.order_cancellation_items;" 9
s2 "presence 改 INITIALLY IMMEDIATE" \
  "DROP TRIGGER order_cancellations_items_presence_ac ON public.order_cancellations; CREATE CONSTRAINT TRIGGER order_cancellations_items_presence_ac AFTER INSERT OR UPDATE ON public.order_cancellations DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION public.pcm_assert_cancellation_has_items();" 12

# ── 5b:探針自身突變 —— **只動案例 11 那一行**(判定紀律 ④)────────────────
log "6/7 探針自身突變:只拿掉案例 11 的開頭復位"
reapply >/dev/null || { echo '🔴 reapply 失敗(fail-closed)'; exit 1; }
python3 - "$PROBE" "$WORK/probe-noreset.sql" <<'PY'
import sys
src, dst = sys.argv[1], sys.argv[2]
s = open(src, encoding='utf-8').read()
RESET = "  SET CONSTRAINTS order_cancellations_items_presence_ac, order_cancellation_items_presence_ac DEFERRED;\n"
mark = "  -- ══ 案例 11(正向)"
i = s.index(mark)
j = s.index(RESET, i)
out = s[:j] + "  -- reset removed by mutation (案例 11 only)\n" + s[j+len(RESET):]
assert out.count(RESET) == s.count(RESET) - 1, "替換數不是恰好 1"
open(dst, 'w', encoding='utf-8').write(out)
print("OK")
PY
if [ $? -ne 0 ]; then
  bad "P:5b 突變產生失敗(anchor 失效)"
else
  probe_run "" "$WORK/probe-noreset.sql"; RC=$?
  FIRST="$(grep -m1 'ERROR:' "$WORK/p.out")"
  if probe_ok "$RC"; then bad "P:只拿掉案例 11 的復位 —— 竟然全綠(案例 11 沒守到)"
  elif printf '%s' "$FIRST" | grep -qF "探針 11 失敗"; then ok "P:只拿掉案例 11 的復位 → 由探針 11 抓到(如預期)"
  else bad "P:紅了但第一個 ERROR 不是探針 11:$(printf '%s' "$FIRST" | cut -c1-96)"; fi
fi

log "7/7 對照組:零突變(必須綠)—— 沒有這條,上面全紅毫無意義"
reapply >/dev/null || { echo '🔴 reapply 失敗(fail-closed)'; exit 1; }
probe_run; RC=$?
if probe_ok "$RC"; then ok "對照組綠(harness 會分辨,不是恆紅)"
else bad "對照組竟然紅 —— harness 本身壞了"; fi

if [ "$MODE" = "all" ]; then
  log "teardown"
  scripts/d1t2-rehearsal.sh teardown "$WORK" >/dev/null 2>&1 || true
fi

echo
# 🔴 2026-08-11 W-a:總結行加上 `PASS=n FAIL=n` 字面。理由是**機械的**,不是美觀:
#    w7-coverage 的 recorder 用 `sed -n 's/.*PASS=\([0-9]*\) FAIL=\([0-9]*\).*/…/p'` 取值,
#    舊字面「通過 N / 失敗 N」沒有 `PASS=` ⇒ 解析不到 ⇒ 收據記成 `PASS=0 FAIL=-1` 恆紅。
#    ⚠️ **只加輸出字面,判定邏輯與 exit code 一個字沒動**(下一行的 `[ "$FAIL" -eq 0 ] || exit 1` 原樣)。
echo "════ A7-t 驗證結果:PASS=$PASS FAIL=$FAIL ════"
[ "$FAIL" -eq 0 ] || exit 1
