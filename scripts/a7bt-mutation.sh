#!/usr/bin/env bash
# ============================================================
# A7b-T · T4-1「突變證明」harness
# ============================================================
# 對應 = docs/specs/2026-07-31-e10-a7b-refund-jobs-plan.md v7 §7.2.1 / §7.2.1b 的「對應 mutant」欄
# 用法:scripts/a7bt-mutation.sh all /tmp/a7btmut   (從零 provision)
#      scripts/a7bt-mutation.sh run /tmp/a7btmut   (重用既有拋棄式 cluster)
#
# ── 這支腳本在回答哪一個問題 ────────────────────────────────────────────
#   T3a(118 案例)與 T3b(29 案例)證明的是「**這些壞資料現在進不去**」。
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
#   · 本檔**不做** ACL 64 格 / barrier lock probe / rollback 八步 —— 那是 T4-2。
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
  mstate="$(printf '%s\n' "$out" | sed -n 's/.*T2-REDSTATE|//p' | tail -1)"
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
    #
    # 🔴🔴 **關卡2 #1**:本分支原本只要「紅在別的東西」就算第二層接住 ——
    #    `CONSTRAINT_NAME=(空)`、權限錯 42501、TRUNCATE 撞 55006、relation not found 42P01
    #    全都會被算成「有第二層」⇒ 突變其實沒被任何守門接住,報表卻寫著被接住 = 直接假綠。
    #    ⇒ 兩道機器斷言:①名字必須是**本套件真的存在的具名守門**(不得為空、不得是隨便的字串)
    #                     ②SQLSTATE 必須落在本套件的 oracle 白名單內(權限/鎖/語法錯一律不算)。
    case " $ALL_NAMED " in
      *" $actual "*) : ;;
      *) bad "突變 $cid($kind)之後紅在 [$actual] —— **不是本套件的具名守門**(空值/權限錯/鎖錯都會長這樣)⇒ 不算第二層接住"
         printf '%s\t%s\tBOGUS-OTHER:%s\t%s\n' "$cid" "$kind" "$actual" "$label" >> "$WORK/mutation-report.tsv"
         return ;;
    esac
    # 🔴🔴 關卡2 R2：名字與 SQLSTATE 原本**各驗各的** ⇒ 任一 catalog 名稱配任一白名單碼都算數。
    #    改成**配對**：由第二層那個物件在 catalog 裡的真實種類推導它「應該」回哪個碼，
    #    對不上就不算第二層（例如一個 CHECK 約束回 23505 = 有人在騙）。
    exp_state="$(runsql "SELECT CASE
        WHEN '$actual' LIKE 'a7bt\\_%' THEN 'P7B01'
        WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname='$actual' AND contype='c') THEN '23514'
        WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname='$actual' AND contype='f') THEN '23503'
        WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname='$actual' AND contype IN ('u','p')) THEN '23505'
        WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='$actual') THEN '23505'
        ELSE '(未知種類)' END")"
    if [ "$mstate" != "$exp_state" ]; then
      bad "突變 $cid($kind)之後紅在 $actual、SQLSTATE=[$mstate],但該物件在 catalog 裡的種類應該回 [$exp_state] ⇒ 不算第二層接住"
      printf '%s\t%s\tBOGUS-STATE:%s|%s|want=%s\t%s\n' "$cid" "$kind" "$actual" "$mstate" "$exp_state" "$label" >> "$WORK/mutation-report.tsv"
      return
    fi
    MUT_OTHER=$((MUT_OTHER + 1))
    printf '%s\t%s\tOTHER:%s|%s\t%s\n' "$cid" "$kind" "$actual" "$mstate" "$label" >> "$WORK/mutation-report.tsv"
  fi
}

# 每個具名 ID 只跑**第一條**指到它的負測(同一 ID 多條案例時,一條就足以證明承重)
# 🔴 `seen` 必須在**兩張矩陣之外**累積(code-reviewer M4):放在 tag 迴圈裡的話,
#    同時出現在 T3a 與 T3b 的 ID 會被突變兩次 ⇒ 「96 個具名守門」其實是 96 次突變、95 個 ID。
# ══ 🔴🔴 關卡2 #6:plan 的 §7.2.1 / §7.2.1b 矩陣 vs 實跑 matrix.tsv ═══════════
#    plan §7.2.1 自己寫著「這道 gate 歸 T4」,而 T4 從來只消費 runtime matrix、沒有回比 plan
#    ⇒ 文件與程式之間**沒有任何東西在看**。漂移方向永遠是「文件比程式樂觀」。
#    比對的三欄全部是機器產生的:案例編號 / SQLSTATE / CONSTRAINT_NAME。
log "1b/4 plan 矩陣 vs 實跑矩陣(逐列相等)"
PLAN="docs/specs/2026-07-31-e10-a7b-refund-jobs-plan.md"
for tag in T3a T3b; do
  lc="$(printf '%s' "$tag" | tr 'A-Z' 'a-z')"
  sed -n "s/^| \`$tag-\([0-9]*\)\` | [^|]* | [^|]* | \`\([A-Z0-9]*\)\` | \`\([a-z0-9_]*\)\`.*/\1|\2|\3/p" "$PLAN" \
    | sort > "$WORK/plan-$lc.txt"
  awk -F'\t' '{print $1 "|" $3 "|" $2}' "$WORK/$lc/matrix.tsv" | sort > "$WORK/run-$lc.txt"
  pn="$(wc -l < "$WORK/plan-$lc.txt" | tr -d ' ')"
  rn="$(wc -l < "$WORK/run-$lc.txt" | tr -d ' ')"
  [ "$pn" -gt 0 ] || die "plan 裡抽不到任何 $tag 矩陣列 ⇒ 抽取式壞了(不是「文件相符」)"
  # 🔴🔴 關卡2 R2：逐列 diff 擋不住「plan 與實跑**同時**刪掉同一列」。
  #    ⇒ 再釘死列數。這個數字與各 harness 自己的 count_gate 是**兩個獨立的地方**，
  #    要騙過去必須同時改三處，而三處都在 review 的視野裡。
  case "$tag" in
    T3a) want_rows=112 ;;
    T3b) want_rows=27  ;;
  esac
  [ "$rn" = "$want_rows" ] \
    && ok "$tag 實跑矩陣列數 = $want_rows(釘死值;與 harness 自己的 count_gate 互為第二個來源)" \
    || bad "$tag 實跑矩陣 $rn 列,釘死值 $want_rows ⇒ 有案例被刪掉,而 plan 也被同步刪了" 
  if diff -q "$WORK/plan-$lc.txt" "$WORK/run-$lc.txt" >/dev/null; then
    ok "plan §7.2.1${lc#t3} 矩陣與實跑逐列相等($pn 列:案例編號 / SQLSTATE / CONSTRAINT_NAME 三欄)"
  else
    bad "plan $tag 矩陣與實跑不符(plan $pn 列 / 實跑 $rn 列)— 前三筆差異:$(diff "$WORK/plan-$lc.txt" "$WORK/run-$lc.txt" | head -6 | tr '\n' ' ')"
  fi
done

# 🔴 OTHER 分支的名字白名單 = **catalog 裡真的存在的具名物件**:
#    兩張表的所有約束名 + 索引名(A7b-M 那一側)+ migration 裡所有 `a7bt_*` 具名 ID(T1 那一側)。
#    🔴 **不能用兩張矩陣的期望值集合**(第一版就是這樣寫的、當場 40 條誤判):
#       `orj_shape_*` 這類約束是真的守門,只是**沒有任何負測以它為預期值**
#       ⇒ 用矩陣建白名單會把合法的第二層全部打成 BOGUS。
#    誤判方向仍是 fail-closed:白名單漏收 ⇒ 轉紅、看得見;不會反過來放行空值或權限錯。
ALL_NAMED="$( { runsql "SELECT conname FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('order_refund_jobs','order_refund_job_items')"
                runsql "SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename IN ('order_refund_jobs','order_refund_job_items')"
                sed -n "s/.*CONSTRAINT = '\(a7bt_[a-z0-9_]*\)'.*/\1/p" "$MIG"
                grep -oE "pcm_a7bt_block_(write|truncate)\('a7bt_[a-z0-9_]*'\)" "$MIG" | sed -E "s/.*'(a7bt_[a-z0-9_]*)'.*/\1/"
              } | grep -v '^$' | sort -u | tr '\n' ' ')"
[ -n "$(printf '%s' "$ALL_NAMED" | tr -d ' ')" ] \
  || die "白名單建構失敗:兩張矩陣抽不出任何具名守門 ⇒ OTHER 判定會全部誤判"
# 自我測試:白名單真的擋得掉不存在的名字(否則它只是一段永遠成立的字串比對)
case " $ALL_NAMED " in
  *" a7bt_this_guard_does_not_exist "*) die "自我測試失敗:白名單竟然收錄了一個不存在的守門名" ;;
esac
case " $ALL_NAMED " in
  *" a7bt_c1_job_has_no_items "*) ok "OTHER 白名單自我測試:收錄真守門、擋掉假名字(共 $(printf '%s' "$ALL_NAMED" | wc -w | tr -d ' ') 個)" ;;
  *) die "自我測試失敗:白名單裡找不到 a7bt_c1_job_has_no_items ⇒ 抽取式壞了" ;;
esac

seen=""
for tag in t3a t3b; do
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
# 🔴 突變到的不全是 T1 的守門:`orj_*` 那些是 **A7b-M** 的約束與索引(code-reviewer M5)。
#    混在一起報會讓「T1 守門覆蓋率」看起來比實際高。
n_t1="$(awk -F'\t' '$1 ~ /^a7bt_/' "$WORK/mutation-report.tsv" | wc -l | tr -d ' ')"
n_m="$(awk -F'\t' '$1 !~ /^a7bt_/' "$WORK/mutation-report.tsv" | wc -l | tr -d ' ')"
printf '  突變 %s 個具名物件(T1 守門 %s + A7b-M 約束/索引 %s):乾淨轉綠 %d / 被第二層接住 %d / 仍紅在自己 %d\n' \
  "$n_total" "$n_t1" "$n_m" "$MUT_OK" "$MUT_OTHER" "$MUT_DEAD"
# T1 具名守門總數(兩條抽取式,與 T3a 的覆蓋率同一份口徑)
all_t1="$( { sed -n "s/.*CONSTRAINT = '\(a7bt_[a-z0-9_]*\)'.*/\1/p" "$MIG"
             grep -oE "pcm_a7bt_block_(write|truncate)\('a7bt_[a-z0-9_]*'\)" "$MIG" \
               | sed -E "s/.*'(a7bt_[a-z0-9_]*)'.*/\1/"
           } | grep -v '^a7bt_selftest_marker$' | sort -u | wc -l | tr -d ' ')"
printf '  T1 具名守門 %s 個,本檔突變過 %s 個;其餘 %s 個沒有突變(= §7.2.2 的被支配 7 個 + T2 已關的 5 個等待型閘門,兩者都**沒有承重證明**)\n' \
  "$all_t1" "$n_t1" "$((all_t1 - n_t1))"

# ══ 🔴🔴 關卡2 #2:上面六個數字原本**只列印、不斷言** ═══════════════════════
#    少跑一批 mutant、矩陣少一列、或分布從「乾淨轉綠」漂到「被第二層接住」,
#    退出碼照樣 0、`FAIL=0` 照樣印出來 ⇒ 覆蓋面縮水完全無感。
#    ⇒ 六個數字全部釘死。**改動守門數量時本區必須跟著改**,那正是要它擋的事。
EXPECT_MUT_TOTAL=100   # 突變過的具名物件總數
EXPECT_MUT_T1=90      # 其中 a7bt_*(T1 守門)
EXPECT_MUT_M=10       # 其中 orj_* / order_refund*(A7b-M 的約束與索引)
EXPECT_ALL_T1=102      # T1 具名守門總數(= T3a 覆蓋率的同一份口徑)
EXPECT_GREEN=55       # 突變後乾淨轉綠(= 該守門是唯一失敗點)
EXPECT_OTHER=45       # 突變後被第二層接住(名字與 SQLSTATE 都已驗)
EXPECT_DEAD=0         # 突變後仍紅在自己(死規則)—— 永遠必須是 0
# 🔴 分隔符用 `:` 不用空白 —— 標籤含中文空白時 `set -- $chk` 會多切一刀,
#    導致比對的是標籤片段而不是數字(T4-2 的 `case "$2|$3"` 同型錯誤,同一份 harness 犯第二次)。
for chk in "突變總數:$n_total:$EXPECT_MUT_TOTAL" \
           "T1 守門突變數:$n_t1:$EXPECT_MUT_T1" \
           "A7b-M 物件突變數:$n_m:$EXPECT_MUT_M" \
           "T1 具名守門總數:$all_t1:$EXPECT_ALL_T1" \
           "乾淨轉綠:$MUT_OK:$EXPECT_GREEN" \
           "被第二層接住:$MUT_OTHER:$EXPECT_OTHER" \
           "仍紅在自己:$MUT_DEAD:$EXPECT_DEAD"; do
  lbl="${chk%%:*}"; rest="${chk#*:}"; got="${rest%%:*}"; want="${rest##*:}"
  [ "$got" = "$want" ] && ok "數量閘:$lbl = $want" \
                       || bad "數量閘:$lbl = $got,預期 $want ⇒ 覆蓋面或分布漂移了,不是「照樣全綠」"
done
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
# 🔴 關卡2 R2：本檔原本沒呼叫共用的 count_gate ——
#    七個分布常數擋得住「分布漂移」，擋不住「刪掉一條與分布無關的斷言」。
[ "$MODE" = "all" ] && count_gate - 24 || count_gate - 23

printf '  PASS=%d  FAIL=%d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
