# shellcheck shell=bash
# 兩台本機鑽機(scripts/admin-probe/up.sh、scripts/storefront-probe/up.sh)共用:從正式庫 schema dump 起庫,
# 再補套 dump 之後貼的板,最後套「正式庫現行函式」補丁。用 `source` 載入, 不單獨執行。
#
# 🔴 為什麼要共用(2026-09-29 網站B, 主視窗派):顧客站鑽機原本從空庫重播全部 migration,
#    大量 migration 停在前置閘 ⇒ 函式 / view / 欄位停在舊版 ⇒ 畫面與正式站不符。
#    實撞:訂單頁取消量 RPC 不在、`customers.disabled_at` 不在(登不進去)、購物車頁缺 original_price。
#    後台鑽機 09-15 已改成 dump 模式(Sean Q41 甲), 這裡把那一段搬出來兩邊共用, 不再各抄一份。
#
# 呼叫前要有的變數:PG(埠)、S(資料目錄)、REPO(repo 根)、PGCRON(1 = 這台 postgres 掛了 pg_cron)。

# 🔴 DUMP_LAST = dump 已含的最後一支貼板 = 板 177(20260915210000):dump 內有 177 的註解、沒有 181 的
#    pcm_order_ship_blocked;板 178 = 20260915230000(~/pcm-mailbox/貼板-0912/178_*)。
# 🛑 補套照 APPLIED.tsv 的【列序】, 不照版本號 —— 板 184 = 20260828070000 版本號比 dump 舊, 而是 dump 之後才貼的。
# ⚠️ 換新 dump 時兩個一起改:PROBE_SCHEMA_DUMP(或下面的預設路徑)與 DUMP_LAST。
#    (舊名 ADMIN_PROBE_SCHEMA_DUMP 仍認得。)
DUMP_DIR="${PROBE_SCHEMA_DUMP:-${ADMIN_PROBE_SCHEMA_DUMP:-$HOME/pcm-mailbox/schema-dump-20260915}}"
DUMP_LAST=20260915210000

# 決定起庫方式:MODE=dump 或 replay(退回從空庫重播), _why = 退回的理由。
probe_pick_mode() {
  MODE=dump; _why=""
  if [ ! -f "$DUMP_DIR/bootstrap.sql" ] || [ ! -f "$DUMP_DIR/prod-schema.sql" ]; then
    MODE=replay; _why="找不到 $DUMP_DIR/bootstrap.sql 或 prod-schema.sql"
  elif [ "${PGCRON:-0}" != 1 ]; then
    MODE=replay; _why="這台沒有 pg_cron(dump 的 bootstrap.sql 要 CREATE EXTENSION pg_cron)"
  elif ! grep -q "^${DUMP_LAST}"$'\t' "$REPO/supabase/APPLIED.tsv"; then
    MODE=replay; _why="supabase/APPLIED.tsv 找不到 $DUMP_LAST 那一列 ⇒ 分不出 dump 之後貼了哪些"
  fi
  echo "SCHEMA : $MODE${_why:+($_why)}" >> "$S/owner.txt"
  if [ "$MODE" = replay ]; then
    echo "⚠️⚠️ **退回舊做法:從空庫重播全部 migration** —— $_why"
    echo "   ⇒ 大量 migration 會停在前置閘、函式 / view 停在舊版 ⇒ **畫面可能與正式站不符**。"
  fi
}

# ── dump 模式:dump 的平台替身 ⇒ 正式庫 schema ⇒ 鑽機要的補件 ⇒ 補套 dump 之後貼的板 ──────
# 結束時 ok / fail = 補套的成功 / 失敗支數。
probe_restore_dump() {
  psql -h 127.0.0.1 -p "$PG" -U postgres -v ON_ERROR_STOP=1 -q -f "$DUMP_DIR/bootstrap.sql" > "$S/bootstrap.log" 2>&1 \
    || { echo "🔴 dump 的 bootstrap.sql 失敗 ⇒ 看 $S/bootstrap.log" >&2; tail -5 "$S/bootstrap.log" >&2; exit 1; }
  psql -h 127.0.0.1 -p "$PG" -U postgres -q -f "$DUMP_DIR/prod-schema.sql" > "$S/restore.log" 2>&1 || true
  DUMP_ERR=$(grep -cE '^psql:.*ERROR|^ERROR:' "$S/restore.log" || true)
  echo "schema dump 還原 ERROR 行數 = $DUMP_ERR(log: $S/restore.log)"
  [ "$DUMP_ERR" = 0 ] || echo "  🔴 dump 還原有錯 ⇒ 結構不完整, 畫面不代表正式庫;grep ERROR $S/restore.log"
  # 🔴 dump 的 bootstrap.sql 是給「驗 migration」用的最小替身;鑽機另外要這幾件:
  #    authenticator 要能登入(PostgREST)· auth.users.email UNIQUE(手動建客人的冪等)·
  #    auth.uid() 要吃 request.jwt.claims(PostgREST 14)· auth.role() / auth.jwt() ·
  #    on_auth_user_created trigger(dump 只含 public / pcm_cron, auth.users 上的 trigger 不在裡面)。
  psql -h 127.0.0.1 -p "$PG" -U postgres -v ON_ERROR_STOP=1 -q <<'SQL'
ALTER ROLE authenticator LOGIN NOINHERIT;
GRANT anon, authenticated, service_role TO authenticator;
ALTER TABLE auth.users ADD CONSTRAINT users_email_key UNIQUE (email);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(coalesce(current_setting('request.jwt.claim.sub', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.role', true), '')::text $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();
SQL
  # 正式庫的品牌與分類(公開資料):dump 只有結構, 沒有這一份種子建不出商品, 帶資料型前置閘的 migration 也必然失敗。
  if psql -h 127.0.0.1 -p "$PG" -U postgres -v ON_ERROR_STOP=1 -q -f "$REPO/scripts/probe-prod-reference-data.sql" >> "$S/apply.log" 2>&1; then
    echo "正式庫品牌 / 分類:已載入(品牌 $(psql -h 127.0.0.1 -p "$PG" -U postgres -tAc 'select count(*) from public.brands') / 分類 $(psql -h 127.0.0.1 -p "$PG" -U postgres -tAc 'select count(*) from public.categories'))"
  else
    echo "🔴 正式庫品牌 / 分類載入失敗 ⇒ 種子可能建不出商品, 看 $S/apply.log"
  fi
  ok=0; fail=0
  local _after _pending v f
  # 帳本上 DUMP_LAST 那一列之後的每一列(= dump 之後貼的板, 照貼板順序)
  _after=$(awk -F'\t' -v last="$DUMP_LAST" 'hit && $1 ~ /^[0-9]{14}$/ {print $1} $1 == last {hit=1}' "$REPO/supabase/APPLIED.tsv")
  # 本分支才有、還沒記帳的(版本號比 dump 新而不在帳本上)⇒ 照版本號排在最後(施工窗驗自己那一片用)
  _pending=$(for f in "$REPO"/supabase/migrations/*.sql; do
    v=$(basename "$f"); v=${v%%_*}
    if [[ "$v" > "$DUMP_LAST" ]] && ! grep -q "^${v}"$'\t' "$REPO/supabase/APPLIED.tsv"; then echo "$v"; fi
  done)
  for v in $_after $_pending; do
    f=$(ls "$REPO"/supabase/migrations/${v}_*.sql 2>/dev/null | head -1 || true)
    if [ -z "$f" ]; then fail=$((fail+1)); echo "FAIL $v(帳本有這一列, repo 找不到檔)" >> "$S/apply.log"; continue; fi
    if psql -h 127.0.0.1 -p "$PG" -U postgres -v ON_ERROR_STOP=1 -q -f "$f" >> "$S/apply.log" 2>&1
    then ok=$((ok+1)); echo "OK   $(basename "$f")" >> "$S/apply.log"
    else fail=$((fail+1)); echo "FAIL $f" >> "$S/apply.log"; fi
  done
  echo "dump 之後補套:帳本 $(echo $_after | wc -w | tr -d ' ') 支 + 本分支未記帳 $(echo $_pending | wc -w | tr -d ' ') 支 ⇒ ok=$ok fail=$fail(清單 grep -E '^(OK|FAIL)' $S/apply.log)"
}

# ── dump 之後補套仍失敗的那幾支:直接換上正式庫【現行】函式本體 ──────────────────
# 🔴 2026-09-29 量到補套失敗 12 支, 多數是【資料型前置閘】(空庫沒有分類 / 車款 / cron job)或
#    「前一代不是預期版本」的連鎖;其中 20260928240000(卡片原價)被 search_catalog_by_vehicle 的連鎖擋住。
#    ⇒ 用 `scripts/replay-gap-fixture.sh` 從正式庫唯讀 catalog 取出那幾支函式的現行本體, 存成
#      `scripts/probe-prod-parity-fixture.sql`(產生指令與點名清單在該檔檔頭)。
# 🛑 套之前先刪掉鑽機上【同名的所有多載】再重建:只 CREATE OR REPLACE 的話, 鑽機裡正式庫已經沒有的舊多載
#    會留著, 呼叫端可能挑到它而安靜地成功(同 storefront-probe 的 create_order 教訓)。
# ⚠️ 它會過期:正式庫那幾支函式一改, 就重跑該檔檔頭那行指令重產。
probe_apply_parity_fixture() {
  local fx="$REPO/scripts/probe-prod-parity-fixture.sql" names
  if [ ! -f "$fx" ]; then
    echo "⚠️ 找不到 $fx ⇒ **沒有補**(這是路徑錯, 不是「不需要補」)"; return 0
  fi
  names=$(sed -n 's/^--    產生指令:bash scripts\/replay-gap-fixture.sh <本檔> //p' "$fx" | head -1)
  if [ -z "$names" ]; then echo "🔴 讀不到 $fx 檔頭的點名清單 ⇒ 沒有補"; return 0; fi
  if { echo 'BEGIN;'
       for n in $names; do
         printf "DO \$d\$ DECLARE r record; BEGIN FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname='%s' LOOP EXECUTE 'DROP FUNCTION '||r.sig; END LOOP; END \$d\$;\n" "$n"
       done
       cat "$fx"
       echo 'COMMIT;'
     } | psql -h 127.0.0.1 -p "$PG" -U postgres -v ON_ERROR_STOP=1 -q >> "$S/apply.log" 2>&1; then
    echo "正式庫現行函式補丁:已套($names)"
  else
    echo "🔴 正式庫現行函式補丁套失敗(整批回滾, 鑽機維持補丁前的樣子)⇒ 看 $S/apply.log"
  fi
}
