#!/usr/bin/env bash
# email-outbox-state-coverage.sh —— `email_outbox` 狀態空間 × dead-man 訊號的【覆蓋窮舉】
#
# 🔴 **為什麼有這支檔**(2026-08-30 M-4b E4 片3a):
#    `20260717020000:127-129` 逐字寫著「以 UNCOVERED probe 窮舉六態 × 生死 attempts,
#    證明三訊號 ∪ {sent, skipped_no_real_email, skipped_order_ineligible} 覆蓋全狀態空間」。
#    ⇒ 而 2026-08-30 實查:**那個 probe 沒有留下可重跑的產物**
#      (`grep -rn UNCOVERED supabase/migrations/*.sql scripts/*.sh` ⇒ 只有那句註解本身,
#       與 `b2s2b-verify.sh` 裡無關的 `UNCOVERED_CELLS`)。
#    ⇒ 📌 **一年後沒有人分得出「那個證明還成立」與「沒有人再驗過」。**
#
# 🛑 **它取代不了那份舊證明 —— 兩者的分母不同**:
#      舊證明:**三訊號** × 六態(E1a 時代)
#      本腳本:**今天的五訊號實作** × **七態**(片3a 加了 skipped_shipment_voided)
#    ⇒ 本腳本是一個【新的、可重跑的宣稱】,不是「重跑了那一發」。
#
# 🔴 **兩份權威都【從檔案抽出來】,不手打**:
#      · 七個狀態值 ⇒ 從 20260830060000 的 `ADD CONSTRAINT` 那一行抽
#      · 五個訊號述詞 ⇒ 把 20260829010000 的 `CREATE FUNCTION` 整段抽出來、原樣建在拋棄式庫上
#    ⇒ 手打的話,這支腳本驗的是【我的副本】,不是那兩份檔。
#
# 🔴🔴 **這支腳本的第一版有四個病,而它們是【同一個】** —— 寫在最前面,因為改它的人會重犯:
#      **我的驗收驗的是【自己重建的副本】,而負對照只涵蓋【我想到的那一種壞世界】。**
#    四個形狀(全部由 codex 對抗審查抓到,而它每一條都當場構造出反例):
#      ① 從 CHECK 抽 token 再自己重建一份 ⇒ 來源被改成 `CHECK ((TRUE OR ...))` 仍抽到 7 態
#      ② 只數 `signal*` 之外還數了 `total_count` ⇒ 每一格都「有訊號看著」⇒ 恆真
#      ③ 忽略每一發 SQL 的 rc ⇒ 「根本沒造出那一列」被判成「正確靜默」
#      ④ 負對照只打第七態 ⇒ `sent` 哪天意外開始告警, 這支腳本不會發現
#    ⇒ 📌 **判別句:這一格如果壞了, 是【我的副本】會紅, 還是【那支檔】會紅?**
#      副本會紅 ⇒ 它驗的是我自己。⇒ 現在的做法是:**種舊世界 → 跑真的 migration → 從 DB 讀回來**。
#
# 用法:bash scripts/email-outbox-state-coverage.sh
#   零參數、零 env、不碰任何 .env、不連任何遠端。它自己起一個拋棄式 PG、跑完自己收攤。
#
# ⚠️ **射程(它證不到什麼)**:
#   · 它建的是一張**最小 email_outbox**(只有函式會讀的七個欄 + status 的 CHECK),
#     不是真表 ⇒ 它證不了真表的 FK / 唯一鍵 / 索引 / RLS。
#   · 它驗的是**述詞的覆蓋**,不是「告警真的會寄出去」——那條路在 Resend 那一側。
#   · 它用 `LC_ALL=C` 起 PG(macOS 上少了它會 `postmaster became multithreaded during startup`)。

set -u

PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
PORT="${PORT:-54397}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"     # 從腳本自己的位置推(worktree 安全)
WORK="$(mktemp -d "${TMPDIR:-/tmp}/outbox-cov.XXXXXX")"
PGDATA="$WORK/pgdata"
RC=0

cleanup() {
  LC_ALL=C "$PGBIN/pg_ctl" -D "$PGDATA" stop -m immediate >/dev/null 2>&1
  rm -rf "$WORK"
}
trap cleanup EXIT

command -v "$PGBIN/initdb" >/dev/null 2>&1 || {
  printf 'ENV-FAIL: 找不到 %s/initdb —— 這不是你的碼壞了, 是這台機器沒有 postgresql@17\n' "$PGBIN"
  exit 2
}

# ── 建庫:**跑真的 migration**,不自己重建 CHECK ─────────────────────────────
# 🔴 codex R1 must-fix(3/8):前一版是「從 CHECK 那行抽字串 token,再自己重建一份正確的 CHECK」
#    ⇒ 它把來源改成 `CHECK ((TRUE OR status IN (...)))` **仍然抽到 7 態**
#    ⇒ 這支腳本**驗的是我重建的那份副本,不是 migration 真正的語意**。
#    ⇒ 正解:**種一個舊世界(六態),然後把那支 migration 原樣餵下去。**
#      CHECK 從此由 migration 自己產生 —— 本腳本沒有任何一份副本。
MIG_STATUS="$REPO/supabase/migrations/20260830060000_m4b_e4_outbox_shipment_voided_status.sql"
MIG_FN="$REPO/supabase/migrations/20260829010000_m4a_email_deadman_alert_counts.sql"
for f in "$MIG_STATUS" "$MIG_FN"; do
  [ -f "$f" ] || { printf 'ENV-FAIL: 找不到 %s\n' "$f"; exit 2; }
done

awk '/^CREATE FUNCTION public\.get_email_outbox_deadman_counts/{f=1} f{print} /^\$fn\$;|^\$\$;/{if(f) exit}' \
  "$MIG_FN" > "$WORK/fn.sql"
FN_BYTES="$(wc -c < "$WORK/fn.sql" | tr -d ' ')"
[ "$FN_BYTES" -gt 1000 ] && printf '✅ 抽到訊號函式 %s bytes(整段原樣, 不是我重寫的)\n' "$FN_BYTES" \
  || { printf '🔴 抽到的函式只有 %s bytes ⇒ 抽取失敗\n' "$FN_BYTES"; exit 1; }

LC_ALL=C "$PGBIN/initdb" -D "$PGDATA" -U probe --encoding=UTF8 --locale=C >"$WORK/initdb.log" 2>&1
LC_ALL=C "$PGBIN/pg_ctl" -D "$PGDATA" -o "-p $PORT -k $WORK -c listen_addresses=" \
  -l "$WORK/pg.log" start >"$WORK/start.log" 2>&1
PSQL="LC_ALL=C $PGBIN/psql -h $WORK -p $PORT -U probe -d postgres -v ON_ERROR_STOP=1 -tA"
eval "$PSQL -c 'select 1'" >/dev/null 2>&1 \
  || { printf 'ENV-FAIL: 拋棄式 PG 起不來, log ⇒ %s\n' "$WORK/pg.log"; tail -5 "$WORK/pg.log"; exit 2; }

# 🔴 codex R2 must-fix:種子的六態 CHECK 前一版是【手抄】的 ——
#    而 migration 的 `v_expect_old` 也是手抄的 ⇒ **兩份一起抄錯時 harness 全綠,
#    而正式的舊世界會部署失敗**(兩個錯互相對上了)。
#    ⇒ 改成**從建表那支 migration 把那一行原樣抽出來**。
MIG_TABLE="$REPO/supabase/migrations/20260717020000_m4a_email_outbox.sql"
[ -f "$MIG_TABLE" ] || { printf 'ENV-FAIL: 找不到 %s\n' "$MIG_TABLE"; exit 2; }
OLD_CHECK="$(grep -E 'CONSTRAINT email_outbox_status_check +CHECK' "$MIG_TABLE" | head -1 | sed 's/,[[:space:]]*$//')"
case "$OLD_CHECK" in
  *"CHECK (status IN ("*) : ;;
  *) printf '🔴 抽不到建表那支的 status CHECK(抽到:%s)⇒ 下面每一格作廢\n' "$OLD_CHECK"; exit 1 ;;
esac
printf '✅ 舊世界的 CHECK 從 20260717020000 原樣抽出(不是手抄)\n'
{
  printf 'CREATE TABLE public.email_outbox (\n'
  printf '  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n'
  printf '  status text NOT NULL,\n'
  printf '  attempts int NOT NULL DEFAULT 0,\n'
  printf '  max_attempts int NOT NULL DEFAULT 5,\n'
  printf '  next_retry_at timestamptz,\n'
  printf '  claimed_at timestamptz,\n'
  printf '  last_error_code text,\n'
  printf '%s\n' "$OLD_CHECK"
  printf ');\n'
  printf "COMMENT ON COLUMN public.email_outbox.status IS '6 態(種子;migration 會換掉它)';\n"
} > "$WORK/seed.sql"
eval "$PSQL -f $WORK/seed.sql" >"$WORK/seed.log" 2>&1 || { printf '🔴 種舊世界失敗\n'; tail -3 "$WORK/seed.log"; exit 1; }
eval "$PSQL -f $MIG_STATUS" >"$WORK/mig.log" 2>&1 \
  || { printf '🔴 **那支 migration 自己跑不起來** ⇒ 下面每一格作廢\n'; tail -5 "$WORK/mig.log"; exit 1; }
printf '✅ 真的那支 migration 跑過了(CHECK 由它產生, 本腳本沒有副本)\n'
eval "$PSQL -f $WORK/fn.sql" >"$WORK/fn-create.log" 2>&1 \
  || { printf '🔴 建訊號函式失敗\n'; tail -5 "$WORK/fn-create.log"; exit 1; }

# 🔴 七個狀態值【從 DB 裡真正生效的那個 CHECK 讀回來】—— 不是從檔案 grep
cat > "$WORK/statuses.sql" <<'EOST'
SELECT m[1] FROM pg_constraint c,
  LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') AS m
 WHERE c.conrelid = 'public.email_outbox'::regclass
   AND c.conname = 'email_outbox_status_check';
EOST
STATUSES="$(eval "$PSQL -f $WORK/statuses.sql" 2>/dev/null | sort -u)"
N_STATUS="$(printf '%s\n' "$STATUSES" | grep -c .)"
[ "$N_STATUS" -eq 7 ] && printf '✅ 從【DB 裡真正生效的 CHECK】讀回 %s 個狀態值\n' "$N_STATUS" \
  || { printf '🔴 讀回 %s 個, 預期 7 ⇒ 下面每一格作廢\n' "$N_STATUS"; exit 1; }

# ── 刻意不告警的終態補集(**這份名單是本腳本【唯一】手寫的東西, 所以它是被測的對象**)──
TERMINAL_SILENT="sent skipped_no_real_email skipped_order_ineligible skipped_shipment_voided"

# 🔴 codex R1 must-fix(4/8):每一發 SQL 的 rc 都要收 ——
#    前一版全部忽略 ⇒ **INSERT 失敗時 HITS 仍然是空的** ⇒「根本沒造出那一列」被判成「正確靜默」。
seed_one() {   # $1=status $2=attempts $3=last_error_code(空 = NULL)
  code_sql="NULL"; [ -n "${3:-}" ] && code_sql="'$3'"
  eval "$PSQL -c 'TRUNCATE public.email_outbox'" >/dev/null 2>&1 || return 1
  printf "INSERT INTO public.email_outbox(status, attempts, max_attempts, next_retry_at, claimed_at, last_error_code) VALUES ('%s', %s, 5, now() - interval '10 days', now() - interval '10 days', %s);\n" \
    "$1" "$2" "$code_sql" > "$WORK/ins.sql"
  eval "$PSQL -f $WORK/ins.sql" >/dev/null 2>&1 || return 1
  n="$(eval "$PSQL -c 'SELECT count(*) FROM public.email_outbox'" 2>/dev/null)"
  [ "$n" = "1" ] || return 1     # 🔴 正對照:rc=0 不等於那一列真的在
  return 0
}
cat > "$WORK/hits.sql" <<'EOH'
SELECT string_agg(k, ',' ORDER BY k)
  FROM jsonb_each_text(public.get_email_outbox_deadman_counts(3600, 3600)) AS t(k,v)
 WHERE v <> '0' AND k LIKE 'signal%';
EOH
# 🔴 codex R2 must-fix:前一版 `hits_of()` **不收 rc** ⇒ 查詢失敗會變成空字串
#    ⇒ 四個靜默態與它們的 8 格負對照**全部假綠**(空 = 「零命中」= ✅)。
#    ⇒ 現在:查失敗回一個【不可能是正常結果】的哨兵字串, 讓呼叫端一定看得見。
hits_of() {
  local out
  out="$(eval "$PSQL -f $WORK/hits.sql" 2>/dev/null)" || { printf 'QUERY-FAILED'; return 1; }
  printf '%s' "$out"
}

# 🔴 只數 `signal*`, 不數 `total_count` —— 第一版沒濾, 而 total_count 對【每一列】都非零
#    ⇒ 每一格都印「有訊號看著」⇒「刻意靜默」那條分支永遠不會跑 ⇒ 整個覆蓋宣稱恆真。
# 🔴🔴 **而下面那兩發負對照, 是這支腳本最容易被砍掉的東西 —— 它們看起來像多餘的格。**
#    **少了它們, 這支腳本會印一整排 ✅ 而我會把它交出去。**(第一版就是被負對照抓到的。)
#    要動它們之前, 先讀這一段。

printf '\n狀態 × attempts × 錯誤碼          訊號命中                         判定\n'
printf -- '-------------------------------------------------------------------------------\n'
UNCOVERED=""
for st in $STATUSES; do
  for kind in alive dead; do
    A=0; [ "$kind" = dead ] && A=5
    if ! seed_one "$st" "$A" ""; then printf '🔴 造不出 %s/%s 那一列 ⇒ 本格作廢\n' "$st" "$kind"; RC=1; continue; fi
    HITS="$(hits_of)"; [ -z "$HITS" ] && HITS="(無)"
    # 🔴 R3(Fable)must-fix:**主迴圈原本把查詢失敗判成 ✅**。
    #    R2 的哨兵讓失敗【看得見】(印 QUERY-FAILED), 而主迴圈丟掉 rc、
    #    且 QUERY-FAILED 非空 ⇒ 走「有訊號看著」那條 ⇒ ✅、RC 不動、exit 0。
    #    📌 **「看得見」與「會紅」是兩件事** —— signal5 那圈與負對照那圈都有判紅, 只有這裡漏。
    if [ "$HITS" = "QUERY-FAILED" ]; then
      printf '%-33s %-32s %s\n' "$st/$kind" "$HITS" "🔴 查詢失敗 ⇒ 本格作廢(不是綠)"
      RC=1; continue
    fi
    if [ "$HITS" = "(無)" ]; then
      case " $TERMINAL_SILENT " in
        *" $st "*) VERDICT="✅ 刻意靜默(在補集名單裡)" ;;
        *)         VERDICT="🔴 無人看管"; UNCOVERED="$UNCOVERED $st/$kind"; RC=1 ;;
      esac
    else
      VERDICT="✅ 有訊號看著"
    fi
    printf '%-33s %-32s %s\n' "$st/$kind" "$HITS" "$VERDICT"
  done
done

# 🔴 codex R1 must-fix(5/8):前一版 14 格【全部 last_error_code=NULL】
#    ⇒ signal5 兩支(只看 quota 碼)從來沒被觸發
#    ⇒ **把 signal5 整段刪掉, 腳本照樣全綠** ⇒ 不能宣稱「驗了五訊號」。
# 🔴 codex R2 must-fix:前一版只比對 `*signal5*` ⇒ **5a 與 5b 寫反、或其中一支失效, 照樣全綠**。
#    ⇒ 改成【逐支點名】:哪個碼該打中哪一支, 寫死在這張表裡。
for pair in "quota_daily_exceeded:signal5_quota_confirmed_count" "http_429:signal5_quota_suspected_count"; do
  code="${pair%%:*}"; want="${pair##*:}"
  if ! seed_one failed 0 "$code"; then printf '🔴 造不出 failed/%s 那一列\n' "$code"; RC=1; continue; fi
  HITS="$(hits_of)"; [ -z "$HITS" ] && HITS="(無)"
  case ",$HITS," in
    *",$want,"*) VERDICT="✅ 打中指名的那一支($want)" ;;
    *)           VERDICT="🔴 沒打中 $want ⇒ 5a/5b 可能寫反或失效"; RC=1 ;;
  esac
  # 🔴 對照:另一支【不可以】同時被打中(否則兩支的述詞是同一份 ⇒ 分不出確診與疑似)
  other="signal5_quota_confirmed_count"; [ "$want" = "$other" ] && other="signal5_quota_suspected_count"
  case ",$HITS," in
    *",$other,"*) VERDICT="$VERDICT 🔴 而 $other 也被打中 ⇒ 兩支述詞可能是同一份"; RC=1 ;;
  esac
  printf '%-33s %-32s %s\n' "failed/alive/$code" "$HITS" "$VERDICT"
done

printf -- '-------------------------------------------------------------------------------\n'
[ -n "$UNCOVERED" ] && printf '🔴 無人看管的格:%s\n' "$UNCOVERED" || printf '✅ 每一格都有歸屬(有訊號看著, 或在刻意靜默的補集裡)\n'

# ── 🔴 負對照 B(codex R1 must-fix 6/8):**每一個手寫靜默態都要零命中**, 不只第七態 ──
#    前一版只打第七態 ⇒ 若 `sent` 或既有 skipped 態哪天意外開始告警, 這支腳本【不會發現】。
#    📌 而它同時就是負對照 A:第七態零命中 ⇒ 把它拿出補集名單就會被判「無人看管」。
NEG_BAD=""
for st in $TERMINAL_SILENT; do
  for kind in alive dead; do
    A=0; [ "$kind" = dead ] && A=5
    if ! seed_one "$st" "$A" ""; then NEG_BAD="$NEG_BAD $st/$kind(造不出)"; continue; fi
    [ -n "$(hits_of)" ] && NEG_BAD="$NEG_BAD $st/$kind"
  done
done
[ -z "$NEG_BAD" ] \
  && printf '✅ 負對照:四個手寫靜默態 × 生死 = 8 格全部零訊號命中(⇒ 把任一個拿出補集就會被判無人看管)\n' \
  || { printf '🔴 負對照:這些「應該靜默」的格竟然有訊號命中 ⇒%s\n' "$NEG_BAD"; RC=1; }

printf '\n🛑 本發【證不到】什麼:\n'
printf '   · 用的是最小 email_outbox(只有函式會讀的七欄)⇒ 證不了真表的 FK / 唯一鍵 / 索引 / RLS\n'
printf '   · 驗的是【述詞的覆蓋】, 不是「告警真的寄得出去」—— 那條路在 Resend 那一側\n'
printf '   · 它【取代不了】20260717020000:127 那份舊證明 —— 分母不同(三訊號×六態 vs 五訊號×七態)\n'
printf '   · 🔴 種子表【沒有】真表的 (status=sending)=(claimed_at IS NOT NULL) 雙向 CHECK\n'
printf '     ⇒ 14 格全部帶 claimed_at = 用【真表禁止存在的列】餵訊號。今天無害(五訊號全錨在 status),\n'
printf '     而哪天有人寫一支只看 claimed_at 的訊號, 覆蓋綠可以由不可能的列撐出來。(R3 抓)\n'
printf '   · 🔴 它驗的是【檔案裡那份函式】—— 正式庫的 live 函式若被 SQL Editor hotfix 過, 本腳本零訊號。(R3 抓)\n'
exit "$RC"
