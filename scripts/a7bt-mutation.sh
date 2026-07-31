#!/usr/bin/env bash
# ============================================================
# A7b-T · T4-1「突變證明」harness
# ============================================================
# 對應 = docs/specs/2026-07-31-e10-a7b-refund-jobs-plan.md v7 §7.2.1 / §7.2.1b 的「對應 mutant」欄
# 用法:scripts/a7bt-mutation.sh all /tmp/a7btmut   (從零 provision)
#      scripts/a7bt-mutation.sh run /tmp/a7btmut   (重用既有拋棄式 cluster)
#
# ── 這支腳本在回答哪一個問題 ────────────────────────────────────────────
#   T3a(111 案例)與 T3b(29 案例)證明的是「**這些壞資料現在進不去**」。
#   它們**證明不了**「拿掉守門就會進得去」—— 一條永遠不會被執行到的死碼,
#   在負測裡看起來與一條承重的守門**一模一樣**(兩者都讓那筆壞資料被擋)。
#   ⇒ 本檔對每一條具名守門做一次**破壞性突變**,然後重跑**它專屬的那條負測**,
#     斷言那條負測**不再紅在該 ID**。紅還在 = 那條守門對那個案例沒有承重。
#
# ── 突變的形狀(逐類定義,不是「隨便改一下」)──────────────────────────
#   ① 函式內的具名 `RAISE`(絕大多數 `a7bt_*`)⇒ 把**那一整句 RAISE 換成 `NULL;`**
#      後 `CREATE OR REPLACE`。等價於「這條守門不存在」,其餘守門原封不動。
#   ② 共用 `pcm_a7bt_block_write/truncate` 的三支 + 兩支(具名 ID 走 `TG_ARGV`)
#      ⇒ 不能改函式(會一次殺掉三支)⇒ 改成 **DROP 那一支 trigger**。
#   ③ CHECK / UNIQUE 約束 ⇒ `ALTER TABLE … DROP CONSTRAINT`。
#   ④ partial unique **索引** ⇒ `DROP INDEX`。
#
# 🔴 **突變必須被證明「真的套用了」**(#306 的教訓:sed 樣式失配 ⇒ 突變沒套上卻報
#    「沒抓到」)。每一個突變後面都跟一句自檢:函式指紋必須改變 / 物件必須消失,
#    否則**當場 RAISE**、該格判 FAIL,不會靜靜變成「看起來有跑」。
#
# 🔴 **全程零留痕**:突變與負測**在同一個交易裡**,而那個交易的最後一行是 `ROLLBACK`
#    (負測檔本來就是這個形狀)⇒ catalog 與資料都回到原狀。收尾另有結構指紋比對。
#
# ── 🔴 不證明什麼 ───────────────────────────────────────────────────
#   · 一格「突變後轉綠」只證明**該守門對該案例承重**,不證明它對所有壞資料承重。
#   · 本檔**不做** ACL 32 格 / barrier lock probe / rollback 六步 —— 那是 T4 其餘三塊。
#   · 本機 PG17.10 非 Supabase。
# ============================================================
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# shellcheck source=scripts/a7bt-fixtures.sh
. scripts/a7bt-fixtures.sh

MODE="${1:?用法: a7bt-mutation.sh all|run <workdir>}"
WORK="${2:?缺 workdir(必須是短路徑,例 /tmp/a7btmut)}"
export LC_ALL=C
guard_workdir "$WORK"

MIG="supabase/migrations/20260731120100_m4b_e10_a7b_t_refund_job_guards.sql"

if [ "$MODE" = "all" ]; then
  log "0/4 provision 拋棄式 PG17"
  stop_stale_cluster "$WORK"
  rm -rf "$WORK"; mkdir -p "$WORK"
  scripts/d1t2-rehearsal.sh provision "$WORK" > "$WORK/provision.log" 2>&1 \
    || { echo "🔴 provision 失敗,見 $WORK/provision.log"; exit 1; }
  ok "provision 完成"
else
  mkdir -p "$WORK"
fi

[ -f "$WORK/.d1t2-harness" ] \
  || die "身分閘:$WORK 沒有 .d1t2-harness 標記,拒絕執行"
[ "$(runsql "SELECT current_setting('port') || '|' || current_database()")" = "54329|postgres" ] \
  || die "身分閘:連到的不是本機 54329 拋棄式 cluster,拒絕執行"
ok "身分閘通過"

snapshot "$STRUCT_SQL" "$WORK/struct-before.snap" "突變前結構快照"

# ══════════════════════════════════════════════════════════════
# 1. 先讓兩支負測 harness 產生「案例檔 + 矩陣」
# ══════════════════════════════════════════════════════════════
# 🔴 不複製它們的案例:直接跑它們、拿它們產生的 `neg-###.sql` 當突變的輸入
#    ⇒ 突變測的永遠是**當下真正在跑的那些負測**,不是一份會漂移的副本。
log "1/4 產生案例檔(實跑 T3a 與 T3b,拿它們的 neg-*.sql 當輸入)"

for pair in "t3a scripts/a7bt-negative-state.sh" "t3b scripts/a7bt-negative-money.sh"; do
  set -- $pair
  tag="$1"; script="$2"
  if ! "$script" run "$WORK" > "$WORK/gen-$tag.log" 2>&1; then
    die "產生案例檔失敗:$script 自己就是紅的(見 $WORK/gen-$tag.log)⇒ 突變測試沒有可信的基準"
  fi
  rm -rf "$WORK/$tag"; mkdir -p "$WORK/$tag"
  cp "$WORK"/neg-*.sql "$WORK/$tag/" 2>/dev/null
  cp "$WORK/matrix.tsv" "$WORK/$tag/matrix.tsv"
  ok "$tag:$(wc -l < "$WORK/$tag/matrix.tsv" | tr -d ' ') 條行為負測的案例檔已備妥(基準 0 FAIL)"
done

# ══════════════════════════════════════════════════════════════
# 2. 突變
# ══════════════════════════════════════════════════════════════
log "2/4 逐條突變(每個具名守門一次,只跑它專屬的那條負測)"

MUT_OK=0; MUT_OTHER=0; MUT_DEAD=0
: > "$WORK/mutation-report.tsv"

# 判斷某個 ID 屬於哪一類突變
mut_kind() {  # $1=ID -> function|trigger|constraint|index
  case "$1" in
    a7bt_jobs_delete_blocked|a7bt_jobs_truncate_blocked|a7bt_items_update_blocked \
      |a7bt_items_delete_blocked|a7bt_items_truncate_blocked) echo trigger; return ;;
  esac
  local n
  n="$(runsql "SELECT count(*) FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid WHERE con.conname='$1' AND c.relname IN ('order_refund_jobs','order_refund_job_items')")"
  [ "$n" = "1" ] && { echo constraint; return; }
  n="$(runsql "SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname='$1'")"
  [ "$n" = "1" ] && { echo index; return; }
  echo function
}

trigger_table() {  # $1=trigger 名
  case "$1" in a7bt_jobs_*) echo order_refund_jobs ;; *) echo order_refund_job_items ;; esac
}
trigger_of_id() {  # 具名 ID -> trigger 名(TG_ARGV 那五支)
  case "$1" in
    a7bt_jobs_delete_blocked)    echo a7bt_jobs_block_delete ;;
    a7bt_jobs_truncate_blocked)  echo a7bt_jobs_block_truncate ;;
    a7bt_items_update_blocked)   echo a7bt_items_block_update ;;
    a7bt_items_delete_blocked)   echo a7bt_items_block_delete_guard ;;
    a7bt_items_truncate_blocked) echo a7bt_items_block_truncate ;;
  esac
}
constraint_table() {  # $1=約束名
  runsql "SELECT c.relname FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid WHERE con.conname='$1' LIMIT 1"
}

# 產生「函式類」突變 SQL:把指定 ID 的那一整句 RAISE 換成 NULL;,並自檢指紋真的變了
gen_fn_mutation() {  # $1=ID
  python3 - "$MIG" "$1" <<'PY'
import re, sys
mig, cid = sys.argv[1], sys.argv[2]
src = open(mig).read()
needle = "CONSTRAINT = '%s';" % cid
pos = src.find(needle)
if pos < 0:
    sys.stderr.write("找不到 CONSTRAINT = '%s';\n" % cid); sys.exit(3)
# 往回找最近的 RAISE EXCEPTION;往前找該 RAISE 所屬的函式
rs = src.rfind("RAISE EXCEPTION", 0, pos)
if rs < 0:
    sys.stderr.write("找不到對應的 RAISE EXCEPTION\n"); sys.exit(3)
re_end = pos + len(needle)
fs = src.rfind("CREATE FUNCTION public.", 0, rs)
fe = src.find("\n$$;\n", fs)
if fs < 0 or fe < 0:
    sys.stderr.write("找不到所屬函式\n"); sys.exit(3)
fe += len("\n$$;\n")
fname = re.search(r"CREATE FUNCTION public\.([a-z0-9_]+)\(", src[fs:]).group(1)
body = src[fs:fe]
mutated = body[: rs - fs] + "NULL;" + body[re_end - fs :]
if mutated == body:
    sys.stderr.write("突變沒有改到任何字元\n"); sys.exit(3)
mutated = mutated.replace("CREATE FUNCTION public.", "CREATE OR REPLACE FUNCTION public.", 1)
print(mutated)
print("""DO $mut$
DECLARE v_now text;
BEGIN
  SELECT md5(prosrc) INTO v_now FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = '%s';
  IF v_now = '%s' THEN
    RAISE EXCEPTION 'MUTATION-NOOP:%s 的突變沒有改到函式本體(指紋未變)';
  END IF;
END
$mut$;""" % (fname, "__ORIG__", cid))
PY
}

# 跑一個突變:把突變 SQL 插在案例檔第一行 BEGIN; 之後,整包在同一交易裡 ROLLBACK
run_mutant() {  # $1=ID $2=案例檔 $3=標籤
  local cid="$1" case_file="$2" label="$3" kind mut f out actual fname orig
  kind="$(mut_kind "$cid")"
  mut="$WORK/mut.sql"
  case "$kind" in
    function)
      fname="$(python3 - "$MIG" "$cid" <<'PY'
import re,sys
src=open(sys.argv[1]).read(); cid=sys.argv[2]
pos=src.find("CONSTRAINT = '%s';"%cid); rs=src.rfind("RAISE EXCEPTION",0,pos)
fs=src.rfind("CREATE FUNCTION public.",0,rs)
print(re.search(r"CREATE FUNCTION public\.([a-z0-9_]+)\(",src[fs:]).group(1))
PY
)" || { bad "突變 $cid:抽不出所屬函式"; return; }
      orig="$(runsql "SELECT md5(prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='$fname'")"
      gen_fn_mutation "$cid" | sed "s/__ORIG__/$orig/" > "$mut" \
        || { bad "突變 $cid:產生突變 SQL 失敗"; return; }
      ;;
    trigger)
      local tg tbl; tg="$(trigger_of_id "$cid")"; tbl="$(trigger_table "$tg")"
      cat > "$mut" <<SQL
DROP TRIGGER $tg ON public.$tbl;
DO \$mut\$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
              WHERE t.tgname = '$tg' AND c.relname = '$tbl') THEN
    RAISE EXCEPTION 'MUTATION-NOOP:$cid 的 trigger 沒有被刪掉';
  END IF;
END \$mut\$;
SQL
      ;;
    constraint)
      local tbl; tbl="$(constraint_table "$cid")"
      cat > "$mut" <<SQL
ALTER TABLE public.$tbl DROP CONSTRAINT $cid;
DO \$mut\$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '$cid') THEN
    RAISE EXCEPTION 'MUTATION-NOOP:$cid 的約束沒有被刪掉';
  END IF;
END \$mut\$;
SQL
      ;;
    index)
      cat > "$mut" <<SQL
DROP INDEX public.$cid;
DO \$mut\$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname = '$cid') THEN
    RAISE EXCEPTION 'MUTATION-NOOP:$cid 的索引沒有被刪掉';
  END IF;
END \$mut\$;
SQL
      ;;
  esac

  f="$WORK/mutated.sql"
  { head -1 "$case_file"; cat "$mut"; tail -n +2 "$case_file"; } > "$f"
  out="$(psql "$URL" -v ON_ERROR_STOP=1 -qtA -f "$f" 2>&1)"
  if printf '%s\n' "$out" | grep -q 'MUTATION-NOOP'; then
    bad "突變 $cid($kind)**沒有真的套用**⇒ 這一格什麼都沒證明"
    printf '%s\t%s\tNOOP\t%s\n' "$cid" "$kind" "$label" >> "$WORK/mutation-report.tsv"
    return
  fi
  actual="$(printf '%s\n' "$out" | sed -n 's/.*T2-RED|//p' | tail -1)"
  if [ "$actual" = "$cid" ]; then
    bad "🔴 $cid($kind)突變後**仍然紅在自己** ⇒ 該守門對「$label」沒有承重(或突變形狀不對)"
    printf '%s\t%s\tSTILL-RED\t%s\n' "$cid" "$kind" "$label" >> "$WORK/mutation-report.tsv"
    MUT_DEAD=$((MUT_DEAD + 1))
  elif [ "$actual" = "(未觸發:竟然成功)" ]; then
    MUT_OK=$((MUT_OK + 1))
    printf '%s\t%s\tGREEN\t%s\n' "$cid" "$kind" "$label" >> "$WORK/mutation-report.tsv"
  elif [ -z "$actual" ]; then
    bad "突變 $cid($kind)之後案例檔沒有跑完(可能死在別的地方)— $(printf '%s\n' "$out" | grep -m1 ERROR | cut -c1-140)"
    printf '%s\t%s\tBROKEN\t%s\n' "$cid" "$kind" "$label" >> "$WORK/mutation-report.tsv"
  else
    # 轉紅到別的守門 = 該案例有第二層接住。仍算「原守門承重」(它不再是第一失敗點),
    # 但必須逐條列出來,不能混進乾淨的那堆。
    MUT_OTHER=$((MUT_OTHER + 1))
    printf '%s\t%s\tOTHER:%s\t%s\n' "$cid" "$kind" "$actual" "$label" >> "$WORK/mutation-report.tsv"
  fi
}

# 每個具名 ID 只跑**第一條**指到它的負測(同一 ID 多條案例時,一條就足以證明承重)
for tag in t3a t3b; do
  seen=""
  while IFS=$'\t' read -r n cid state prefix label; do
    case " $seen " in *" $cid "*) continue ;; esac
    seen="$seen $cid"
    run_mutant "$cid" "$WORK/$tag/neg-$n.sql" "$tag-$n $label"
  done < "$WORK/$tag/matrix.tsv"
done

# ══════════════════════════════════════════════════════════════
# 3. 結果
# ══════════════════════════════════════════════════════════════
log "3/4 突變結果"
n_total="$(wc -l < "$WORK/mutation-report.tsv" | tr -d ' ')"
printf '  突變 %s 個具名守門:乾淨轉綠 %d / 被第二層接住 %d / 仍紅在自己 %d\n' \
  "$n_total" "$MUT_OK" "$MUT_OTHER" "$MUT_DEAD"
if [ "$MUT_OTHER" -gt 0 ]; then
  printf '  ── 被第二層接住的(逐條列出,不混進乾淨那堆)──\n'
  grep -F "	OTHER:" "$WORK/mutation-report.tsv" | awk -F'\t' '{printf "      · %s → %s(%s)\n", $1, $3, $4}'
fi
[ "$MUT_DEAD" -eq 0 ] \
  && ok "沒有任何守門在突變後仍紅在自己(= 沒有「刪掉也照樣紅」的死規則)" \
  || bad "有 $MUT_DEAD 個守門突變後仍紅在自己 ⇒ 逐條看 $WORK/mutation-report.tsv"

# ══════════════════════════════════════════════════════════════
# 4. 零留痕 / 結構零漂移
# ══════════════════════════════════════════════════════════════
log "4/4 零留痕 / 結構零漂移"
for t in order_refund_jobs order_refund_job_items order_cancellations \
         order_cancellation_items order_refunds order_refund_items; do
  [ "$(runsql "SELECT count(*) FROM public.$t")" = "0" ] \
    && ok "零留痕:$t 仍為 0 列" || bad "零留痕失敗:$t 不是 0 列"
done
snapshot "$STRUCT_SQL" "$WORK/struct-after.snap" "突變後結構快照"
cmp -s "$WORK/struct-before.snap" "$WORK/struct-after.snap" \
  && ok "結構零漂移:$n_total 次破壞性突變(改函式 / DROP trigger / DROP 約束 / DROP 索引)之後 catalog 一個 byte 都沒變" \
  || bad "結構漂移:突變沒有被 ROLLBACK 乾淨"

printf '  報告:%s\n' "$WORK/mutation-report.tsv"
printf '  PASS=%d  FAIL=%d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
