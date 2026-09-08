#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# rollback-drill.sh —— 回滾演練:一支 migration 貼下去之後, **退得回來嗎**
#
# 🛑 **它為什麼不是 PASS / FAIL 兩格**(這一段決定了整支腳本的形狀, 先讀):
#   `supabase/migrations/20260829190000_m4b_d1restore_audit_source_ops.sql:22` 逐字:
#     「反向(把 CHECK 改回兩值)只在**一列 `source_app='ops'` 都還沒寫進去**時成立」
#   ⇒ 回滾對不對, **取決於正式庫裡有沒有資料**。
#   ⇒ 而演練跑在一台【空的】拋棄式 PG 上 ⇒ 那條反向**一定會成功**。
#   ⇒ 📌 **空庫上的回滾演練, 對【資料相依的回滾】天生全綠** ——
#     而那正是最危險的一類:它發一張綠票, 去做一件在正式庫上會炸的事。
#   ⇒ ✅ 所以判分多態(下面列的是**最常見那幾個**;完整清單以 `report()` 裡那一行為準,
#     2026-09-06 當下共 **11 種**), 而 DATA-DEPENDENT 那一格**就是這支腳本存在的理由**。
#
# ── 常見的幾態 ────────────────────────────────────────────────────────────
#   REVERSIBLE      反向跑得動, 且跑完 pg_catalog 回到 apply 之前那個樣子
#   DATA-DEPENDENT  空庫可逆, **而餵一列真實形狀的資料就炸** ⇒ 有反向 SQL ≠ 回得去
#   NO-ROLLBACK     這支根本沒有回退產物(五種來源都找不到)
#   ENV-BLOCKED     這支在拋棄式 PG 上 apply 不起來 ⇒ **演練不了, 不是「可逆」**
#   🔴 ENV-BLOCKED 非有不可:它與 REVERSIBLE 在「沒有紅」上長得一樣。
#
# ── 回退產物有五種來源(2026-09-06 量到三種, 2026-09-08 `-db` 補到五種)──────────
#   ⛔ ~~三種來源~~ ⇒ ✅ **五種** —— 舊字面留刪除線, 讓搜「三種來源」的人同一發撞到訂正。
#      2026-09-07 板列 `⟦db-NOROLLBACKARTIFACT⟧` 逐字記著「看得見 12 / 46 = 26%」, 說的就是這件事。
#   ① `scripts/<版本號>-down.sql`                        ← 真正可執行的那種
#      🔬 2026-09-06 當下 `scripts/*-down.sql` 共 **12** 支, 而**本路徑撈得到的只有 7 支** ——
#        `ver="${base%%_*}"` 取的是 14 位版本號, 而 `452 / 452a / 452b / 473b1 / 484a`
#        那 5 支是**片名**命名 ⇒ 結構上永遠對不起來。⇒ 📌 對來源①有意義的分母是 **7**, 不是 12。
#   ② migration 內 `-- ══ ROLLBACK` 區段裡的 ```sql 圍欄  ← 🔴 **整段是註解**, 要剝 `-- ` 才是 SQL
#   ③ 同區段裡單行反引號包起來的一句 SQL                  ← 同上
#   🔴🔴 **那 5 個區段全部是註解 ⇒ 內嵌的可執行反向 SQL = 0 支。**
#     ⚠️ **而【怎麼量的】要講清楚**:用本檔 `resolve_rollback_sql` 的 boundary 去數,
#       「區段內非註解行 = 0」是**量法的恆等式**(boundary 的定義就是到第一個非註解行為止)
#       ⇒ 那個 0 在兩個世界印同一個東西, **不是證據**。
#       ✅ 上面那句結論是用**獨立量法**複驗的:只用 `^-- ══ ` 當邊界重數一次, 5 段仍全是註解。
#     ⇒ 所以 ②③ **必須剝註解**, 直接餵 psql 會餵進去一坨註解而 rc=0 ——
#       那正是「沒有紅」與「什麼都沒做」印同一個東西的形狀。
#
# ── 🔴 它答不出什麼(先寫, 免得綠票被讀太寬)────────────────────────────────
#   · 拋棄式 PG 不是正式庫(沒有真資料、bootstrap 自陳不完整)⇒ 綠票射程只到「乾淨 PG 上回得去」。
#   · 資料相依那一關要餵測資, 而**測資是我造的** ⇒ 它是不是正式庫真正的形狀, 本支答不出。
#     ⇒ 每支 fixture 檔頭要寫「對應正式碼 <檔>:<行>」。沒有 fixture ⇒ 印【未測】, **未測不是通過**。
#   · 沒被掃到的那些支, **未演練 ≠ 可逆**。
#
# 用法:
#   bash scripts/rollback-drill.sh                 # 預設目標集(見 --help)
#   bash scripts/rollback-drill.sh --last 20
#   bash scripts/rollback-drill.sh --only 20260905380000
#   bash scripts/rollback-drill.sh --selftest
# ══════════════════════════════════════════════════════════════════════════════
set -u
export LC_ALL=C LANG=C

REPO="$(cd "$(dirname "$0")/.." && pwd)"
MDIR="$REPO/supabase/migrations"
FIXDIR="$REPO/supabase/rollback-drill-fixtures"
LAST=20; ONLY=""; SELFTEST=0; UNION_SECTIONS=1
while [ $# -gt 0 ]; do
  case "$1" in
    --last) LAST="${2:-}"; shift 2 ;;
    --only) ONLY="${2:-}"; shift 2 ;;
    --selftest) SELFTEST=1; shift ;;
    # 🔵 只跑 --last N 那一段, 不把「有回退產物的那幾支」聯集進來。
    #    預設【聯集】的理由是量到的:最近 20 支裡只有 1 支有區段, 另外 4 支落在 #310/#319/#322/#330
    #    ⇒ 純照 N=20 會得到 19 格 NO-ROLLBACK, 那張表沒有資訊量。
    --no-union) UNION_SECTIONS=0; shift ;;
    # 🔵 只印檔頭註解區(到第一個非註解行為止)—— 上一版寫死 1,60 會把 `set -u` 與參數解析一起印。
    --help) awk 'NR>1 && !/^#/{exit} {print}' "$0"; exit 0 ;;
    *) printf '🔴 不認得的參數: %s\n' "$1" >&2; exit 2 ;;
  esac
done

for c in initdb pg_ctl psql; do
  command -v "$c" >/dev/null || { printf '🔴 缺 %s ⇒ ENV-FAIL\n' "$c" >&2; exit 2; }
done
[ -d "$MDIR" ] || { printf '🔴 找不到 %s ⇒ ENV-FAIL\n' "$MDIR" >&2; exit 2; }

# ── 回退產物解析(五種來源;純文字, 不需要 DB ⇒ selftest 拿它單獨測)──────────
# 印出一段可以直接餵 psql 的 SQL;找不到 ⇒ 印空字串、rc=1。
# 🔴 檔案來源【三個位置】, 不是一個。2026-09-08 `-db` 量到的分母:
#    `scripts/*-down.sql` 共 12 支而**本路徑撈得到 7**(理由見上面 :26-28)· `supabase/rollbacks/` 15 · `~/pcm-mailbox/貼板-*/<NN>r_<ver>_*` 21
#    ⛔ ~~「8」~~ ⇒ ✅ **12 支 / 撈得到 7** —— 我第一版寫的 8 兩個都不是, 是 reviewer 對著目錄數出來的。
#    ⇒ 本支改前只認得第一個 ⇒ **覆蓋率被低估**, 而低估沒有症狀:
#    沒有人會去查一支被判成「缺回頭路」的 migration 是不是其實有(高估會有人抗議, 低估不會)。
# 🔴 而第三個位置在 **repo 外**(信箱)⇒ 換一台機器就不存在 ⇒ 它的綠與 repo 內的綠**不等值**。
#    ⇒ 所以 `RB_SRC` 一定要跟著判決印出去, 而不是只回一個 rc。**來源不同的綠不可以長一樣。**
RB_SRC=""
PASTE_ROOT="${ROLLBACK_PASTE_ROOT:-$HOME/pcm-mailbox}"
resolve_rollback_sql() {
  local file="$1" ver base c
  base="$(basename "$file")"; ver="${base%%_*}"
  RB_SRC=""
  # 依序:repo sidecar → repo rollbacks/ → 信箱貼板。**順序即優先權**, 先命中先贏。
  # ⚠️ glob 無命中時 bash 留下原字面 ⇒ 下一行的 `[ -f ]` 會把它濾掉, 不會誤判。
  for c in "$REPO/scripts/${ver}-down.sql" \
           "$REPO/supabase/rollbacks/${ver}"*.sql \
           "$PASTE_ROOT"/貼板-*/[0-9]*r_"${ver}"_*.sql ; do
    [ -f "$c" ] || continue
    case "$c" in
      "$PASTE_ROOT"/*) RB_SRC="repo外·信箱|$c" ;;
      *)               RB_SRC="repo|$c" ;;
    esac
    cat "$c"; return 0
  done
  # ②③ 都在同一個區段裡 ⇒ 先把區段切出來, 再從裡面剝 SQL。
  # 🔴 boundary 要收在【下一個 ══ 標題】或【第一個非註解行】——
  #    少了後者, 區段會一路吃到 migration 本體(我 2026-09-06 就這樣把 0 數成 28)。
  awk '
    /^-- ══ ROLLBACK/ { inseg=1; next }
    inseg && /^-- ══ / { exit }
    inseg && /^[[:space:]]*[^-[:space:]]/ { exit }
    inseg { print }
  ' "$file" > "$TMP/seg.txt"
  [ -s "$TMP/seg.txt" ] || return 1
  # ② ```sql 圍欄:剝掉行首的 `-- `, 取圍欄之間的行
  awk '
    { sub(/^-- ?/, "") }
    /^```/ { inf = !inf; next }
    inf { print }
  ' "$TMP/seg.txt" > "$TMP/fence.sql"
  if [ -s "$TMP/fence.sql" ]; then cat "$TMP/fence.sql"; return 0; fi
  # ③ 單行反引號:只收【看起來是一句 SQL】的(以 SQL 動詞開頭且以分號結尾)
  sed -e 's/^-- \{0,1\}//' "$TMP/seg.txt" \
    | grep -oE '`[^`]+`' | tr -d '`' \
    | grep -iE '^[[:space:]]*(DROP|ALTER|CREATE|REVOKE|GRANT|COMMENT|UPDATE|DELETE|INSERT)\b.*;[[:space:]]*$' \
    > "$TMP/tick.sql"
  [ -s "$TMP/tick.sql" ] && { cat "$TMP/tick.sql"; return 0; }
  return 1
}

# ── pg_catalog 快照:比「apply 之前」與「回退之後」是不是同一個世界 ──────────
snapshot_sql() {
  # 🔴🔴 **每一類查完都補一行 `end|<類>`** —— 這是「這一類查完了」與「這一類是空的」的分界。
  #   上一版的閘要求每一類至少 1 行 ⇒ 一個【真的沒有函式】的世界會被判成量具壞了(實測:selftest 的
  #   最小世界 public 底下零函式 ⇒ 少了 `pro|` ⇒ 三格假紅)。
  #   ⇒ 📌 **「查不到東西」與「沒查」不可以印同一個東西, 而兩邊都要有辦法說話。**
  cat <<'SQL'
\pset tuples_only on
\pset format unaligned
SELECT 'rel|'||c.relname||'|'||c.relkind::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' ORDER BY 1;
SELECT 'end|rel';
SELECT 'col|'||c.relname||'|'||a.attname||'|'||format_type(a.atttypid,a.atttypmod)||'|'||a.attnotnull::text
  FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped ORDER BY 1;
SELECT 'end|col';
SELECT 'con|'||conname||'|'||pg_get_constraintdef(oid) FROM pg_constraint
 WHERE connamespace='public'::regnamespace ORDER BY 1;
SELECT 'end|con';
SELECT 'pro|'||p.proname||'|'||pg_get_function_identity_arguments(p.oid)||'|'||COALESCE(md5(p.prosrc),'')
  FROM pg_proc p WHERE pronamespace='public'::regnamespace ORDER BY 1;
SELECT 'end|pro';
SELECT 'pol|'||polname||'|'||c.relname||'|'||polcmd::text FROM pg_policy pol JOIN pg_class c ON c.oid=pol.polrelid
 ORDER BY 1;
SELECT 'end|pol';
SELECT 'acl|'||c.relname||'|'||COALESCE(array_to_string(c.relacl,','),'') FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY 1;
SELECT 'end|acl';
-- 🔴 下面五類是 code-reviewer 2026-09-06 抓的 —— 少了它們, 「反向沒退乾淨」不會叫。
--   最硬的實例:20260829190000:36 逐字 `COMMENT ON COLUMN public.admin_audit_log.source_app IS`
--   覆蓋掉一份舊註解, 而它的 down 腳本零 COMMENT ⇒ 沒有 pg_description 這一條, NOT-CLEAN 永遠不叫。
SELECT 'com|'||COALESCE(c.relname,'')||'|'||d.objsubid||'|'||md5(d.description)
  FROM pg_description d LEFT JOIN pg_class c ON c.oid=d.objoid
  LEFT JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' ORDER BY 1;
SELECT 'end|com';
SELECT 'viw|'||c.relname||'|'||md5(pg_get_viewdef(c.oid)) FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('v','m') ORDER BY 1;
SELECT 'end|viw';
SELECT 'rls|'||c.relname||'|'||c.relrowsecurity::text||'|'||c.relforcerowsecurity::text FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' ORDER BY 1;
SELECT 'end|rls';
SELECT 'plq|'||polname||'|'||COALESCE(pg_get_expr(polqual,polrelid),'')||'|'
       ||COALESCE(pg_get_expr(polwithcheck,polrelid),'')||'|'||COALESCE(polroles::text,'')
  FROM pg_policy ORDER BY 1;
SELECT 'end|plq';
SELECT 'pac|'||p.proname||'|'||COALESCE(array_to_string(p.proacl,','),'') FROM pg_proc p
 WHERE pronamespace='public'::regnamespace ORDER BY 1;
SELECT 'end|pac';
SQL
}

TMP=$(mktemp -d "${TMPDIR:-/tmp}/rbdrill.XXXXXXXX") \
  || { echo "🔴 建不出暫存目錄 ⇒ ENV-FAIL"; exit 9; }
PGPORT_=$(( 55000 + ($$ % 900) ))
while lsof -nP -iTCP:"$PGPORT_" -sTCP:LISTEN >/dev/null 2>&1; do PGPORT_=$((PGPORT_+1)); done
cleanup(){ pg_ctl -D "$TMP/pg" stop -m immediate >/dev/null 2>&1; rm -rf "$TMP"; }
trap cleanup EXIT
Q(){ psql -h /tmp -p "$PGPORT_" -U postgres -d "$1" -v ON_ERROR_STOP=1 "${@:2}"; }

boot_pg(){
  initdb -D "$TMP/pg" -U postgres --auth=trust --encoding=UTF8 --locale=C >"$TMP/i.log" 2>&1 \
    || { echo "🔴 initdb 失敗 ⇒ ENV-FAIL"; return 2; }
  pg_ctl -D "$TMP/pg" -o "-p $PGPORT_ -k /tmp" -l "$TMP/pg.log" start >/dev/null 2>&1 \
    || { echo "🔴 PG 起不來 ⇒ ENV-FAIL"; return 2; }
  psql -h /tmp -p "$PGPORT_" -U postgres -d postgres -tAc 'select 1' >/dev/null 2>&1 \
    || { echo "🔴 PG 起了連不上 ⇒ ENV-FAIL"; return 2; }
  # 🔴 bootstrap 從 runbook 原樣抽, **不手抄** —— 手抄的兩份一起抄錯時 harness 全綠而真世界會炸。
  local RB="$REPO/docs/runbooks/throwaway-postgres-for-migration-verification.md"
  [ -f "$RB" ] || { echo "🔴 找不到 runbook ⇒ ENV-FAIL(bootstrap 沒有來源)"; return 2; }
  awk '/^## 2\. .*bootstrap/{s=1} s&&/^```sql$/{f=1;next} f&&/^```$/{exit} f' "$RB" > "$TMP/bs.raw"
  awk '/^-- 業務型別/{exit} {print}' "$TMP/bs.raw" > "$TMP/bs.sql"
  [ -s "$TMP/bs.sql" ] || { echo "🔴 從 runbook 抽不到 bootstrap ⇒ ENV-FAIL"; return 2; }
  grep -q 'service_role' "$TMP/bs.sql" || { echo "🔴 bootstrap 少了 service_role ⇒ ENV-FAIL"; return 2; }
  psql -h /tmp -p "$PGPORT_" -U postgres -d postgres -q -f "$TMP/bs.sql" >"$TMP/bs.log" 2>&1 \
    || { echo "🔴 bootstrap 跑不過 ⇒ ENV-FAIL(見 $TMP/bs.log)"; return 2; }
  psql -h /tmp -p "$PGPORT_" -U postgres -d postgres -q -c 'CREATE DATABASE base TEMPLATE template1' >/dev/null 2>&1
  # base 要帶 bootstrap ⇒ 直接在 base 上再跑一次(template1 沒有它)
  psql -h /tmp -p "$PGPORT_" -U postgres -d base -q -f "$TMP/bs.sql" >>"$TMP/bs.log" 2>&1 \
    || { echo "🔴 base 的 bootstrap 跑不過 ⇒ ENV-FAIL"; return 2; }
  return 0
}

# 🔴🔴 **單趟前進, 不是「先建 base 再一次跑完目標」**——
#   上一版把 base 只 apply 到【目標集第一支】之前, 而目標集聯集了舊的 down.sql
#   ⇒ 第一支目標是 2026-08-15 那一支 ⇒ 後面 20 天的 migration 全都沒進 base
#   ⇒ 六支目標被判 ENV-BLOCKED, **而它們在完整 replay 裡是好的** ——
#     📌 那個 ENV-BLOCKED 講的是「我的 base 沒建到那裡」, 不是「那支有問題」,
#       而兩者在畫面上印同一行字。
#   ✅ 改成:依序走過【每一支】migration;走到目標就當場演練, 演練完照樣把它 apply 進 base。
BASE_FAIL=0; BASE_OK=0
apply_to_base(){
  if psql -h /tmp -p "$PGPORT_" -U postgres -d base -q -v ON_ERROR_STOP=1 -f "$1" >/dev/null 2>&1
  then BASE_OK=$((BASE_OK+1)); else BASE_FAIL=$((BASE_FAIL+1)); fi
}

# 🔴 rc 一定要回出去 —— 建不出來時舊的 t0/t1 還在, 而**兩個都是上一支的殘留** ⇒ cmp 相等
#   ⇒ 判 NO-EFFECT, 而那句話講的是別支。
trial_db(){  # $1=db 名 —— 從 base 複製一份
  psql -h /tmp -p "$PGPORT_" -U postgres -d postgres -q -v ON_ERROR_STOP=1 \
    -c "DROP DATABASE IF EXISTS $1" -c "CREATE DATABASE $1 TEMPLATE base" >/dev/null 2>&1
}

CELLS=0; FAILS=0
cell(){ CELLS=$((CELLS+1)); if [ "$1" = 1 ]; then printf '  ✅ %s\n' "$2"; else FAILS=$((FAILS+1)); printf '  🔴 %s\n' "$2"; fi; }

# ── 一支的演練 ───────────────────────────────────────────────────────────
declare -a VERDICTS
declare -a RB_SRCS
drill_one(){
  local f="$1" base ver rbsql fx v
  base="$(basename "$f")"; ver="${base%%_*}"
  if ! resolve_rollback_sql "$f" > "$TMP/rb.sql"; then
    VERDICTS+=("NO-ROLLBACK|$ver|五種來源都找不到回退產物"); return
  fi
  # 🔴 來源要跟著走 —— 見 resolve_rollback_sql 檔頭:repo 外那種綠換一台機器就不存在。
  #    區段/單行那兩種來源 RB_SRC 是空的 ⇒ 記成 `區段`, 而不是留空(留空與沒記到長一樣)。
  RB_SRCS+=("$ver|${RB_SRC:-區段或單行(migration 檔內)}")
  trial_db t1 || { VERDICTS+=("ENV-BLOCKED|$ver|建不出演練用的 t1(TEMPLATE base 失敗)⇒ 沒演練到"); return; }
  if ! psql -h /tmp -p "$PGPORT_" -U postgres -d t1 -q -v ON_ERROR_STOP=1 -f "$f" >"$TMP/ap.log" 2>&1; then
    VERDICTS+=("ENV-BLOCKED|$ver|這支在拋棄式 PG 上 apply 不起來 ⇒ 演練不了, 不是可逆")
    return
  fi
  # W0 要的是【apply 之前】⇒ 另開一份沒 apply 的來拍
  trial_db t0 || { VERDICTS+=("ENV-BLOCKED|$ver|建不出 t0 ⇒ 沒有 apply 之前那個世界可以比"); return; }
  Q t0 -f "$TMP/snap.sql" > "$TMP/w0.txt" 2>"$TMP/snap.err"
  Q t1 -f "$TMP/snap.sql" > "$TMP/w1.txt" 2>>"$TMP/snap.err"
  # 🔴🔴 快照拍空 = **量具壞了**, 不是「兩個世界一樣」——
  #   而它們在 cmp 上長得一模一樣, 會被判成 NO-EFFECT 印一句聽起來很合理的話。
  #   (2026-09-06 實錘:relkind 是 "char" 型別, `||` 曖昧 ⇒ 整段 ERROR ⇒ 兩邊都 0 行 ⇒ 判 NO-EFFECT。)
  # 🔴🔴 只看「非空」擋不住【部分失敗】—— `ON_ERROR_STOP=1` 是在某一句斷掉,
  #   而斷之前那幾類的輸出**已經寫進檔案**了 ⇒ 檔案非空, 而 acl/pol/pro 那幾類從來沒被比較過,
  #   兩邊一起少同樣的東西 ⇒ `cmp` 說一樣 ⇒ 判 REVERSIBLE。
  #   ✅ 改成點名:七個前綴每一種都要至少 1 行, 少任何一種 ⇒ SNAPSHOT-BROKEN。
  # 問的是 `end|<類>` 這個**收尾記號**, 不是那一類有沒有資料 —— 見 snapshot_sql 檔頭。
  snap_ok(){ local f="$1" k; for k in rel col con pro pol acl com viw rls plq pac; do
      grep -qx "end|$k" "$f" || { printf '%s' "$k"; return 1; }; done; return 0; }
  local miss
  if ! miss=$(snap_ok "$TMP/w0.txt") || ! miss=$(snap_ok "$TMP/w1.txt"); then
    VERDICTS+=("SNAPSHOT-BROKEN|$ver|🔴 快照少了 '$miss' 那一類 ⇒ 量具壞了(部分失敗與全失敗要一起擋):$(sed -e 's|^psql:[^ ]*: ||' "$TMP/snap.err" | grep -m1 . | cut -c1-70)")
    return
  fi
  if cmp -s "$TMP/w0.txt" "$TMP/w1.txt"; then
    VERDICTS+=("NO-EFFECT|$ver|apply 前後 pg_catalog 一模一樣 ⇒ 這支沒有留下可觀察的結構改動, 演練無意義")
    return
  fi
  if ! psql -h /tmp -p "$PGPORT_" -U postgres -d t1 -q -v ON_ERROR_STOP=1 -f "$TMP/rb.sql" >"$TMP/rb.log" 2>&1; then
    # 🔴 兩種完全不同的失敗, 上一版印同一個判:
    #   ① psql 回 `invalid command \` ⇒ 我抽出來的那段**根本不是 SQL**(抽壞了)
    #      ⇒ 這一格答的是【我的抽取器】, 不是那支 migration 退不退得回去 ⇒ 判 EXTRACT-BAD。
    #   ② down 腳本自己的**前置閘擋下來**(例:逐字「回退前置閘:片 B 的碼退了嗎?」)
    #      ⇒ 那是它**正確地拒絕**, 不是壞掉 ⇒ 仍判 ROLLBACK-FAILS, 而訊息要把那句話帶出來讓人讀。
    if grep -q 'invalid command' "$TMP/rb.log"; then
      VERDICTS+=("EXTRACT-BAD|$ver|🔴 抽出來的不是可執行 SQL ⇒ 這一格答的是【抽取器】不是那支:$(sed -e 's|^psql:[^ ]*: ||' "$TMP/rb.log" | grep -m1 . | cut -c1-70)")
      return
    fi
    VERDICTS+=("ROLLBACK-FAILS|$ver|反向 SQL 自己就跑不過(可能是它的前置閘正確拒絕, 要人讀一眼):$(sed -e 's|^psql:[^ ]*: ||' "$TMP/rb.log" | grep -m1 . | cut -c1-90)")
    return
  fi
  Q t1 -f "$TMP/snap.sql" > "$TMP/w2.txt" 2>>"$TMP/snap.err"
  # 🔴 W0/W1 有這道閘而 W2 沒有 ⇒ W2 拍空會被講成「N 處不同」, 量具壞了被說成沒回乾淨。
  if ! miss=$(snap_ok "$TMP/w2.txt"); then
    VERDICTS+=("SNAPSHOT-BROKEN|$ver|🔴 回退【之後】那張快照少了 '$miss' 那一類 ⇒ 量具壞了")
    return
  fi
  if ! cmp -s "$TMP/w0.txt" "$TMP/w2.txt"; then
    # 🔴🔴 **把【是哪幾處】印出來, 不是只印【幾處】**(板列 ⟦db-ROLLBACKPROSE222⟧ 剩下那一格)。
    #    🎯 **成因**:本支算得出那個 diff(下面那個 `grep -c` 就是拿它數的), 而它**只把數字帶出去**
    #      ⇒ 📌 板列問的「**是那支的錯還是環境缺件**」, 讀報告的人**答不出來** ——
    #        他手上只有一個 `2`, 而那兩處是什麼決定了答案往哪邊倒。
    #    ⇒ ⇒ **一份只說「有 N 處不同」的報告, 與一份說「我不知道差在哪」的報告, 資訊量相同。**
    #    🔵 **上限 6 行**:catalog 快照一支可以差很多行, 而**判斷方向只需要看得到前幾條**;
    #      要全部就把下面那個 `head -6` 調大重跑 —— 🔴 **本支【沒有】保留 TMP 的旗標**,
    #      而我第一版在這裡寫了一個 `RBDRILL_KEEP=1`。**那個旗標不存在。**
    #      📌 那正是本片在治的同一個病:**一句指路的話, 指向一個不存在的東西。**
    #      (同夜實錘:客戶頁那句「要改請看下面那一欄」對 15 個客人裡的 11 個也不存在。)
    #    ⚠️ **只帶行首那兩個字元 `<` / `>` 的行** —— `diff` 的 `---` 分隔行不是差異本身,
    #      算進去會讓「幾處」與「印幾行」對不上, 而那正是本片在治的那種對不上。
    _nc_diff="$(diff "$TMP/w0.txt" "$TMP/w2.txt" | grep '^[<>]')"
    _nc_n="$(printf '%s\n' "$_nc_diff" | grep -c '^[<>]')"
    _nc_head="$(printf '%s\n' "$_nc_diff" | head -6 | tr '\n' ' ')"
    [ "$_nc_n" -gt 6 ] && _nc_head="$_nc_head …(另有 $((_nc_n - 6)) 處未印;要全部把本檔的 head -6 調大重跑)"
    VERDICTS+=("NOT-CLEAN|$ver|反向跑完了, 而 pg_catalog 沒回到原樣($_nc_n 處不同):$_nc_head")
    return
  fi
  # ── 🔴 資料相依那一關(本支存在的理由)───────────────────────────────
  fx="$FIXDIR/${ver}.sql"
  if [ ! -f "$fx" ]; then
    VERDICTS+=("REVERSIBLE(空庫)|$ver|🔴 **資料相依那一關【未測】** —— 沒有 $FIXDIR/${ver}.sql;未測不是通過")
    return
  fi
  trial_db t2 || { VERDICTS+=("ENV-BLOCKED|$ver|建不出 t2 ⇒ 資料相依那一關沒跑到"); return; }
  psql -h /tmp -p "$PGPORT_" -U postgres -d t2 -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1
  if ! psql -h /tmp -p "$PGPORT_" -U postgres -d t2 -q -v ON_ERROR_STOP=1 -f "$fx" >"$TMP/fx.log" 2>&1; then
    VERDICTS+=("FIXTURE-BAD|$ver|測資自己就插不進去 ⇒ 這一關沒有量到:$(sed -e 's|^psql:[^ ]*: ||' "$TMP/fx.log" | grep -m1 . | cut -c1-90)")
    return
  fi
  if psql -h /tmp -p "$PGPORT_" -U postgres -d t2 -q -v ON_ERROR_STOP=1 -f "$TMP/rb.sql" >/dev/null 2>&1; then
    VERDICTS+=("REVERSIBLE|$ver|空庫與有資料兩個世界都退得回去")
  else
    VERDICTS+=("DATA-DEPENDENT|$ver|🔴 空庫可逆, 而餵一列真實形狀的資料就退不回去 ⇒ 有反向 SQL ≠ 回得去")
  fi
}

# ══ 目標集 ═══════════════════════════════════════════════════════════════
pick_targets(){
  local all n
  all=$(ls "$MDIR"/*.sql)
  if [ -n "$ONLY" ]; then printf '%s\n' "$all" | grep -E "/${ONLY}_" ; return; fi
  { printf '%s\n' "$all" | tail -n "$LAST"
    # 🔵 聯集:有回退產物的那幾支(區段 或 sidecar down.sql)—— 理由見 --no-union 的註解
    if [ "$UNION_SECTIONS" = 1 ]; then
      grep -lE '^-- ══ ROLLBACK' "$MDIR"/*.sql 2>/dev/null
      local d v
      for d in "$REPO"/scripts/[0-9]*-down.sql; do
        [ -f "$d" ] || continue
        v=$(basename "$d"); v="${v%-down.sql}"
        ls "$MDIR/${v}_"*.sql 2>/dev/null
      done
    fi
  } | sort -u
}

report(){
  local line st ver why
  printf '\n══ 回滾演練結果 ═══════════════════════════════════════════════════\n'
  printf '   分母:目標 %s 支(migrations 全體 %s 支)\n' "${#VERDICTS[@]}" "$(ls "$MDIR"/*.sql | wc -l | tr -d ' ')"
  printf '   base 前置:apply 成功 %s ｜ 失敗 %s\n' "$BASE_OK" "$BASE_FAIL"
  [ "$BASE_FAIL" -gt 0 ] && printf '   🛑 base 有 %s 支沒進去 ⇒ 下面的 ENV-BLOCKED 有一部分是【環境缺件】不是那支的錯\n' "$BASE_FAIL"
  printf '\n'
  for line in "${VERDICTS[@]}"; do
    st="${line%%|*}"; ver="$(printf '%s' "$line" | cut -d'|' -f2)"; why="$(printf '%s' "$line" | cut -d'|' -f3-)"
    printf '   %-18s %s  %s\n' "$st" "$ver" "$why"
  done
  printf '\n   統計:'
  for st in REVERSIBLE 'REVERSIBLE(空庫)' DATA-DEPENDENT NO-ROLLBACK ENV-BLOCKED ROLLBACK-FAILS EXTRACT-BAD NOT-CLEAN NO-EFFECT FIXTURE-BAD SNAPSHOT-BROKEN; do
    local n; n=$(printf '%s\n' "${VERDICTS[@]}" | grep -c "^${st}|")
    [ "$n" -gt 0 ] && printf ' %s=%s' "$st" "$n"
  done
  # 🔴 有壞判時 rc 要非 0 —— 一支永遠 exit 0 的腳本進不了任何自動流程,
  #   而「它跑完了」與「它跑完而且都好」在 rc 上會是同一件事。
  BAD=0
  for st in ROLLBACK-FAILS EXTRACT-BAD NOT-CLEAN SNAPSHOT-BROKEN FIXTURE-BAD; do
    printf '%s\n' "${VERDICTS[@]}" | grep -q "^${st}|" && BAD=1
  done
  # ── repo 外來源要點名 ────────────────────────────────────────────────
  # 🔴 這一段存在的理由:`REVERSIBLE` 這四個字對【證據住在哪】完全失明。
  #    信箱那 21 支不在版控裡 ⇒ 換一台機器、或有人清了信箱, 同一支就變 NO-ROLLBACK。
  #    ⇒ 那是一個【會自己消失的綠】, 而消失的時候沒有人會收到通知。
  local ext; ext=$(printf '%s\n' "${RB_SRCS[@]:-}" | grep -c 'repo外' || true)
  if [ "${ext:-0}" -gt 0 ]; then
    printf '\n\n   🔴 其中 %s 支的回退產物在 **repo 外**(信箱貼板)⇒ 這幾支【換一台機器就找不到回退產物】:\n' "$ext"
    printf '%s\n' "${RB_SRCS[@]}" | grep 'repo外' | while IFS='|' read -r v _tag path; do
      printf '      %s  ← %s\n' "$v" "$path"
    done
    printf '      %s\n' "本清單記的是【找到了什麼】, 不是【判決是什麼】—— 它在演練之前就記了,"
    printf '      %s\n' "   上表判 NOT-CLEAN / ENV-BLOCKED 的那幾支也會出現在這裡。兩張表要對著看。"
    printf '      %s\n' "要讓這幾支不再依賴信箱, 那份回退產物得進 supabase/rollbacks/。"
  fi
  printf '\n\n🛑 射程:拋棄式 PG + runbook §2 bootstrap(runbook 自陳那份清單不完整)⇒ 綠票只到「乾淨 PG 上退得回去」。\n'
  printf '   資料相依那一關要 fixture, 沒有 fixture 的印【未測】—— **未測不是通過**。\n'
}

# ══ selftest ═════════════════════════════════════════════════════════════
# 🟢 **2026-09-08:本支的 `--selftest` 終於【被接上線了】**(`package.json` lint-staged,
#    與其餘 100+ 支同形)。在那之前它寫好了、11 格全過、而**沒有任何地方叫它**。
#    📌 `.husky/pre-commit:201` 逐字:「一道沒接線的閘, 與沒有那道閘, 對犯錯的人是同一件事。」
#    🔬 掛 lint-staged 而不是 pre-push, 是**量過**的:本支 selftest **2 秒**
#       (對照 `greenlight.sh --selftest` 34 秒, 量測當下 load 10.38 9.55 15.48)。
# 🔴 期望格數釘子(⟦db-SELFTESTCELLPIN⟧ 那一族)—— 少跑一格會靜默通過, 所以要釘。
# 🔬 11 ⇒ 19(2026-09-08 `-db`):新增檔案來源②③ 各自的正格 + 來源標籤格 + 形狀格
#    + 三位置同時存在時的優先權正/負 + 前綴誤撈負對照 = **8 格**。11+8=19。
EXPECT_TOTAL=20
run_selftest(){
  printf '══ rollback-drill.sh --selftest ═══════════════════════════════════\n'
  printf '\n── 第一層:回退產物解析(純文字, 不用 DB)──\n'
  local w="$TMP/w"; mkdir -p "$w"

  # 世界一:區段裡的 ```sql 圍欄, **整段是註解** ⇒ 必須剝 `-- ` 才是 SQL
  cat > "$w/a.sql" <<'EOF'
-- ══ ROLLBACK ══════════════════════════════════
-- 本支建一個 view ⇒ 回退一行:
-- ```sql
-- DROP VIEW IF EXISTS public.zzq_v;
-- ```
-- 🔵 零資料改動。

BEGIN;
CREATE VIEW public.zzq_v AS SELECT 1 AS x;
COMMIT;
EOF
  resolve_rollback_sql "$w/a.sql" > "$w/a.out" 2>/dev/null
  cell "$(grep -qx 'DROP VIEW IF EXISTS public.zzq_v;' "$w/a.out" && echo 1 || echo 0)" \
       "世界一 圍欄:剝出可執行 SQL(不含任何 -- 前綴)"
  cell "$(grep -qE '^--' "$w/a.out" && echo 0 || echo 1)" \
       "世界一 負向:輸出裡【沒有】殘留註解行(有殘留 ⇒ 餵 psql 會 rc=0 而什麼都沒做)"
  cell "$(grep -qE 'CREATE VIEW' "$w/a.out" && echo 0 || echo 1)" \
       "世界一 圍欄:圍欄【外】的說明文字沒有被當成 SQL 收進來"
  # 🛑 這一格**不是** boundary 的對照 —— code-reviewer 2026-09-06 實測:把 boundary 整條拔掉,
  #   本格照樣綠, 因為排除本體的是上面那個 ```` ``` ```` 開關。
  #   ✅ **真正殺得掉 boundary 突變的是世界二那格(該恰 1 行)** —— 標籤要指對它守的東西,
  #     否則下一個人會以為 boundary 有人看著。

  # 世界二:單行反引號
  cat > "$w/b.sql" <<'EOF'
-- ══ ROLLBACK ══════════════════════════════════
-- `ALTER TABLE public.zzq DROP CONSTRAINT IF EXISTS zzq_chk;`
-- 🔵 說明句裡也有反引號 `IF EXISTS` 而它不是一句 SQL, 不可以被收進去。
BEGIN;
-- 🔴 本體裡的這一句【長得完全像一句反向 SQL】: `DROP TABLE public.should_not_win;`
--   boundary 少了「第一個非註解行就停」那一條, 它會被一起收進去 ——
--   而收進去之後那份 rb.sql 仍然跑得動、仍然 rc=0 ⇒ **沒有紅**。
COMMIT;
EOF
  resolve_rollback_sql "$w/b.sql" > "$w/b.out" 2>/dev/null
  cell "$(grep -qx 'ALTER TABLE public.zzq DROP CONSTRAINT IF EXISTS zzq_chk;' "$w/b.out" && echo 1 || echo 0)" \
       "世界二 單行反引號:收到那一句"
  cell "$([ "$(wc -l < "$w/b.out" | tr -d ' ')" = 1 ] && echo 1 || echo 0)" \
       "世界二 負向:說明句裡的 \`IF EXISTS\` 沒被當 SQL、本體那句 should_not_win 也沒被吃進來(該恰 1 行)"

  # 世界三:完全沒有回退產物
  printf 'BEGIN;\nCOMMIT;\n' > "$w/c.sql"
  resolve_rollback_sql "$w/c.sql" > "$w/c.out" 2>/dev/null; local rc=$?
  cell "$([ "$rc" != 0 ] && echo 1 || echo 0)" "世界三 查無:rc 非 0(而不是印一個空字串當成找到了)"

  # 世界四:sidecar 優先於區段
  # 🔴 上一版把這支寫進【版控中的】 `scripts/`, 固定檔名, 而只有走完 happy path 才 rm。
  #   ⇒ 中途炸掉會留在工作樹;兩個窗同時 --selftest 會互刪對方的檔 ⇒ 世界四假紅。
  #   ✅ 把 $REPO 暫時指到自己的暫存樹 —— resolve_rollback_sql 讀的就是 "$REPO/scripts/"。
  local SAVE_REPO="$REPO"; REPO="$w"; mkdir -p "$w/scripts"
  printf 'DROP TABLE public.zzq_sidecar;\n' > "$w/scripts/29999999999999-down.sql"
  cat > "$w/29999999999999_x.sql" <<'EOF'
-- ══ ROLLBACK ══════════════════════════════════
-- ```sql
-- DROP VIEW public.should_not_win;
-- ```
EOF
  resolve_rollback_sql "$w/29999999999999_x.sql" > "$w/d.out" 2>/dev/null
  cell "$(grep -q 'zzq_sidecar' "$w/d.out" && echo 1 || echo 0)" "世界四 sidecar 優先於區段"
  cell "$(grep -q 'should_not_win' "$w/d.out" && echo 0 || echo 1)" "世界四 負向:區段那份沒有同時被收進來"

  # ── 世界五・六:2026-09-08 新增的兩個檔案來源 ────────────────────────────
  # 🔴 沒有這幾格, 新來源就是「改完沒有紅」—— 而那與「沒改」印同一個東西。
  mkdir -p "$w/supabase/rollbacks"
  printf 'DROP TABLE public.zzq_rbdir;\n'  > "$w/supabase/rollbacks/29999999999998-rollback.sql"
  # 真實形狀之二:`<ver>_<片名>-down.sql`(repo 內 20260907220000 那支就長這樣)
  printf 'DROP TABLE public.zzq_slug;\n'   > "$w/supabase/rollbacks/29999999999997_m4b_slug-down.sql"
  printf 'BEGIN;\nCOMMIT;\n' > "$w/29999999999998_x.sql"
  printf 'BEGIN;\nCOMMIT;\n' > "$w/29999999999997_x.sql"
  resolve_rollback_sql "$w/29999999999998_x.sql" > "$w/e.out" 2>/dev/null
  cell "$(grep -q 'zzq_rbdir' "$w/e.out" && echo 1 || echo 0)" "世界五 supabase/rollbacks/<ver>-rollback.sql 撈得到"
  cell "$([ "$RB_SRC" = "repo|$w/supabase/rollbacks/29999999999998-rollback.sql" ] && echo 1 || echo 0)" \
       "世界五 來源標成 repo(不是 repo外)"
  resolve_rollback_sql "$w/29999999999997_x.sql" > "$w/e2.out" 2>/dev/null
  cell "$(grep -q 'zzq_slug' "$w/e2.out" && echo 1 || echo 0)" "世界五b <ver>_<片名>-down.sql 那種形狀也撈得到"

  local SAVE_PASTE="$PASTE_ROOT"; PASTE_ROOT="$w/mbox"; mkdir -p "$w/mbox/貼板-0908"
  printf 'DROP TABLE public.zzq_mbox;\n' > "$w/mbox/貼板-0908/77r_29999999999996_還原_災難用.sql"
  printf 'BEGIN;\nCOMMIT;\n' > "$w/29999999999996_x.sql"
  resolve_rollback_sql "$w/29999999999996_x.sql" > "$w/f.out" 2>/dev/null
  cell "$(grep -q 'zzq_mbox' "$w/f.out" && echo 1 || echo 0)" "世界六 信箱貼板 <NN>r_<ver>_*.sql 撈得到"
  cell "$(printf '%s' "$RB_SRC" | grep -q '^repo外·信箱|' && echo 1 || echo 0)" \
       "世界六 來源標成 repo外(這一格就是「會自己消失的綠」的唯一訊號)"

  # 優先權:三個位置同時有 ⇒ scripts/ 贏, 而 rollbacks/ 贏信箱
  printf 'DROP TABLE public.zzq_p1;\n' > "$w/scripts/29999999999995-down.sql"
  printf 'DROP TABLE public.zzq_p2;\n' > "$w/supabase/rollbacks/29999999999995-rollback.sql"
  printf 'DROP TABLE public.zzq_p3;\n' > "$w/mbox/貼板-0908/78r_29999999999995_還原_災難用.sql"
  printf 'BEGIN;\nCOMMIT;\n' > "$w/29999999999995_x.sql"
  resolve_rollback_sql "$w/29999999999995_x.sql" > "$w/g.out" 2>/dev/null
  cell "$(grep -q 'zzq_p1' "$w/g.out" && echo 1 || echo 0)" "優先權 scripts/ 贏過另外兩個"
  cell "$(grep -qE 'zzq_p2|zzq_p3' "$w/g.out" && echo 0 || echo 1)" "優先權 負向:輸的那兩份沒有被一起收進來"

  # 🔴 負對照:glob 是前綴比對 ⇒ 要證明【別支的回退檔不會被誤撈】
  printf 'BEGIN;\nCOMMIT;\n' > "$w/29999999999994_x.sql"
  resolve_rollback_sql "$w/29999999999994_x.sql" > "$w/h.out" 2>/dev/null; local rc6=$?
  # 🔴 標籤要講它【實際】在測什麼:這一格的 fixture 與現場任何檔都沒有共同前綴,
  #    所以它測的是「三個位置都查無時不亂撈」, **不是**真的前綴放寬。舊標籤留刪除線。
  #    ⛔ ~~負對照 版本號不同的那幾支回退檔沒有被前綴誤撈~~
  cell "$([ "$rc6" != 0 ] && echo 1 || echo 0)" "負對照 三個位置都查無時 rc 非 0(不撈鄰居、不印空字串當找到)"
  # 🔴 RB_SRC 的【重置】要有格子守:少了它, 走區段來源那幾支會繼承上一支的檔案路徑,
  #    被錯誤點名進「repo 外」清單、印出別人的檔名。(reviewer 突變證實:刪掉重置那行 ⇒ 0 格紅。)
  #    做法:先讓一支命中信箱(RB_SRC 非空), 緊接著解析一支只有區段的 ⇒ RB_SRC 必須是空的。
  resolve_rollback_sql "$w/29999999999996_x.sql" > /dev/null 2>&1
  resolve_rollback_sql "$w/a.sql" > /dev/null 2>&1
  cell "$([ -z "$RB_SRC" ] && echo 1 || echo 0)" \
       "RB_SRC 重置:區段來源那一支不得繼承上一支的檔案路徑(否則會被誤點名成 repo外)"
  PASTE_ROOT="$SAVE_PASTE"
  REPO="$SAVE_REPO"

  printf '\n── 第二層:真的起一台 PG, 跑三態 ──\n'
  # 🔴 這裡的 `return` 一定要帶 1 —— 裸 return 回的是【上一個指令】的 rc,
  #   而上一個是 `FAILS=$((...))` 賦值 ⇒ rc=0 ⇒ 「這不是通過」印出來了而整支回綠。
  boot_pg || { printf '  🔴 PG 起不來 ⇒ 第二層整層沒跑(這【不是】通過)\n'; FAILS=$((FAILS+1)); return 1; }
  snapshot_sql > "$TMP/snap.sql"

  # 合成一組小 migration:一支可逆、一支資料相依
  local M2="$TMP/m"; mkdir -p "$M2"
  cat > "$M2/20990101000000_ok.sql" <<'EOF'
-- ══ ROLLBACK ══════════════════════════════════
-- ```sql
-- DROP TABLE public.drill_ok;
-- ```
CREATE TABLE public.drill_ok (id int);
EOF
  # 🔴 B 的形狀要**逐字鏡射** 20260829190000:表【已經在】base 裡, 而本支只是把 CHECK 放寬。
  #   ⇒ 反向 = 把 CHECK 收回去 ⇒ 空庫收得回去, 而**有一列新值時收不回去**。
  #   ⚠️ 上一版我把「建表」也寫進這支 ⇒ apply 前的世界根本沒有那張表
  #     ⇒ 反向再怎麼寫都回不到 W0 ⇒ 判 NOT-CLEAN。**那是我的測資造錯, 不是判定錯。**
  psql -h /tmp -p "$PGPORT_" -U postgres -d base -q -c \
    "CREATE TABLE public.drill_dep (k text); ALTER TABLE public.drill_dep ADD CONSTRAINT drill_dep_k_check CHECK (k IN ('a'));" \
    >/dev/null 2>&1 || { printf '  🔴 base 前置建不起來 ⇒ 第二層沒跑\n'; FAILS=$((FAILS+1)); return 1; }
  cat > "$M2/20990101010000_dep.sql" <<'EOF'
-- ══ ROLLBACK ══════════════════════════════════
-- ```sql
-- ALTER TABLE public.drill_dep DROP CONSTRAINT drill_dep_k_check;
-- ALTER TABLE public.drill_dep ADD CONSTRAINT drill_dep_k_check CHECK (k IN ('a'));
-- ```
ALTER TABLE public.drill_dep DROP CONSTRAINT drill_dep_k_check;
ALTER TABLE public.drill_dep ADD CONSTRAINT drill_dep_k_check CHECK (k IN ('a','b'));
EOF
  local SAVE_M="$MDIR" SAVE_F="$FIXDIR"
  MDIR="$M2"; FIXDIR="$TMP/fx"; mkdir -p "$FIXDIR"; local FIXDIR2="$FIXDIR"
  printf "INSERT INTO public.drill_dep (k) VALUES ('b');\n" > "$FIXDIR/20990101010000.sql"
  VERDICTS=()
  drill_one "$M2/20990101000000_ok.sql"
  drill_one "$M2/20990101010000_dep.sql"
  MDIR="$SAVE_M"; FIXDIR="$SAVE_F"
  [ -n "${RBDRILL_DEBUG:-}" ] && printf '  [debug] %s\n' "${VERDICTS[@]}"

  cell "$(printf '%s\n' "${VERDICTS[@]}" | grep -qE '^REVERSIBLE\(空庫\)\|20990101000000' && echo 1 || echo 0)" \
       "第二層 A:可逆那支 ⇒ REVERSIBLE(空庫)(沒 fixture ⇒ 資料那關印未測)"
  cell "$(printf '%s\n' "${VERDICTS[@]}" | grep -qE '^DATA-DEPENDENT\|20990101010000' && echo 1 || echo 0)" \
       "🔴 第二層 B:餵一列 k='b' ⇒ DATA-DEPENDENT(把資料那一關整段拔掉, 這格會掉成 REVERSIBLE)"
  # 🔴🔴 **真正的「把那一關拔掉」對照** —— 上一版這格寫成「沒有任何一支是 REVERSIBLE」,
  #   而那句在【兩支都 ENV-BLOCKED】的壞世界裡照樣是真 ⇒ 恆真, 零判別力。
  #   ✅ 改成:同一支、同一份反向, **只把 fixture 拿掉** ⇒ 它必須從 DATA-DEPENDENT 掉成 REVERSIBLE(空庫)。
  rm -f "$FIXDIR2/20990101010000.sql"
  local SAVE_F2="$FIXDIR"; FIXDIR="$TMP/fx-empty"; mkdir -p "$FIXDIR"
  local KEEP_V=("${VERDICTS[@]}"); VERDICTS=()
  MDIR="$M2"; drill_one "$M2/20990101010000_dep.sql"; MDIR="$SAVE_M"
  cell "$(printf '%s\n' "${VERDICTS[@]}" | grep -qE '^REVERSIBLE\(空庫\)\|20990101010000' && echo 1 || echo 0)" \
       "🔴 第二層 C:把 fixture 拿掉 ⇒ 同一支從 DATA-DEPENDENT 掉成 REVERSIBLE(空庫)(這格證明資料相依那一步真的在判)"
  FIXDIR="$SAVE_F2"; VERDICTS=("${KEEP_V[@]}")

  printf '\n── 收 ──\n'
  printf '   跑了 %s 格 · 紅 %s 格 · 期望 %s 格\n' "$CELLS" "$FAILS" "$EXPECT_TOTAL"
  if [ "$CELLS" != "$EXPECT_TOTAL" ]; then
    printf '   🔴 格數與期望不符(多或少)⇒ 有格子沒跑到, 而少跑一格在畫面上沒有形狀\n'
    printf '      改了格數 ⇒ 把 EXPECT_TOTAL 一起改, 並在 commit body 說明為什麼\n'
    return 1
  fi
  [ "$FAILS" = 0 ] || return 1
  printf '   ✅ %s 格全過\n' "$CELLS"
  return 0
}

# ══ main ═════════════════════════════════════════════════════════════════
if [ "$SELFTEST" = 1 ]; then run_selftest; exit $?; fi

boot_pg || exit 2
snapshot_sql > "$TMP/snap.sql"
TARGETS=$(pick_targets)
[ -n "$TARGETS" ] || { echo "🔴 目標集是空的 ⇒ 這是【參數錯】不是【沒事做】"; exit 2; }
printf '══ 回滾演練 ═══ 目標 %s 支(單趟前進:走到目標就當場演練, 演練完照樣進 base)\n' \
  "$(printf '%s\n' "$TARGETS" | wc -l | tr -d ' ')"
printf '%s\n' "$TARGETS" > "$TMP/targets.txt"
VERDICTS=()
for f in "$MDIR"/*.sql; do
  grep -qxF "$f" "$TMP/targets.txt" && drill_one "$f"
  apply_to_base "$f"
done
BAD=0
report
exit "$BAD"
