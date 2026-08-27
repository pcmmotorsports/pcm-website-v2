#!/usr/bin/env bash
# ============================================================
# `#628` REVOKE MAINTAIN verify harness —— **可重跑的行為證據**
# ============================================================
# 對象 = supabase/migrations/20260817080000_m4b_628_revoke_maintain_brands_categories.sql
#
# 🔴🔴 **這支存在的唯一理由**:那支 migration 的負測只在 REVOKE **之後**跑,
#    ⇒ 它只看得到「無 MAINTAIN」那個世界。**「該紅的會紅」沒有被表演過。**
#    ⇒ 本檔把 REVOKE 那一行**拿掉**再 apply(突變),要求負測**轉紅**。
#    **在 M1 跑綠之前,那支 migration 的「負測」只是「一格程式碼」。**
#
# 🔴 另一半同樣重要:`probe` 模式印出「同一個動作在兩個世界各印什麼」。
#    2026-08-17 實測發現 **`ANALYZE` 在兩個世界都不炸**(只有 WARNING)。
#    🔴 而它造成的症狀**與直覺相反**:負測的判定是「動作成功 ⇒ 還做得到 ⇒ RAISE」
#    ⇒ 拿 ANALYZE 當動作會讓那一格 **恆紅**(連收乾淨的世界都 apply 不了),**不是恆綠**。
#    ⇒ 那不是推論,是 `probe` 與 M3 印出來的。
#
# ── 用法 ────────────────────────────────────────────────────
#   ./scripts/628-verify.sh probe   # 兩個世界對照表(選 REINDEX 的依據)
#   ./scripts/628-verify.sh run     # 基線 + apply + 冪等 + 6 發突變(M1-M6)
#   PGURI=... ./scripts/628-verify.sh drift   # 🔴 可重跑的漂移偵測
#                                             #    (migration 的 §0 做不到這件事,見該檔冪等段)
#   ./scripts/628-verify.sh stop    # 收掉叢集
#
# ⚠️ **基線是照 repo 的建表 migration 重建的,不是正式庫實況** —— 全檔結論以此為界。
# 🔴 `anon` / `authenticated` 由本檔自己 CREATE(Supabase 平台角色,`supabase/migrations/`
#    底下沒有它們的 CREATE ROLE)。**那不是 migration 有問題。**
# ============================================================
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

MODE="${1:-run}"
WORK="${WORK:-/tmp/628-verify-work}"
PORT="${PORT:-54628}"
MIG="supabase/migrations/20260817080000_m4b_628_revoke_maintain_brands_categories.sql"

# 🔴 走 TCP 不走 unix socket:socket 路徑上限 103 bytes,深目錄會 FATAL。
# 🔴 LC_ALL=C:不設會 "postmaster became multithreaded during startup"(macOS)。
pg() { LC_ALL=C pg_ctl -D "$WORK/pgdata" "$@"; }
pq() { psql -h 127.0.0.1 -p "$PORT" -U postgres -v ON_ERROR_STOP=1 "$@"; }
val() { psql -h 127.0.0.1 -p "$PORT" -U postgres -tAq -c "$1" 2>/dev/null | tr -d '[:space:]'; }

PASS=0; FAIL=0
# 每格都印「期望 vs 實得」——只印 OK/NG 的話,量具自己壞掉時看不出來。
chk() {
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); printf '  ✅ %-52s %s\n' "$1" "$3"
  else FAIL=$((FAIL+1)); printf '  ❌ %-52s 期望[%s] 實得[%s]\n' "$1" "$2" "$3"; fi
}

start_cluster() {
  export LC_ALL=C LANG=C
  # 🔴 先收掉上一輪的叢集再砍目錄 —— 否則 postmaster 還佔著 port,
  #    下一輪會死在 "Address already in use",而那個錯訊看起來跟本片無關。
  [ -d "$WORK/pgdata" ] && pg stop -m immediate > /dev/null 2>&1
  # 🔴 而且要能收掉【資料目錄已被砍掉的孤兒】—— 上一輪失敗時 rm -rf 先跑了、
  #    postmaster 還活著,這時 pg_ctl 找不到 pgdata 就無能為力,只能照 port 收。
  #    (2026-08-17 實際卡住兩輪才發現。)
  lsof -ti tcp:"$PORT" 2>/dev/null | xargs -r kill -9 2>/dev/null
  sleep 1
  rm -rf "$WORK" && mkdir -p "$WORK"
  initdb -U postgres -A trust "$WORK/pgdata" > "$WORK/initdb.log" 2>&1 || {
    echo "initdb 失敗,最後 6 行:"; tail -6 "$WORK/initdb.log"; exit 1; }
  pg -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" \
     -l "$WORK/pg.log" start > /dev/null 2>&1
  sleep 3
  if ! val "select 1" > /dev/null 2>&1; then
    echo "叢集起不來,pg.log 最後 6 行:"; tail -6 "$WORK/pg.log"; exit 1; fi
}

# 基線 = 有 MAINTAIN 的世界(＝ Sean B2 實測到的正式庫狀態)
baseline() {
  pq -q <<'SQL'
DROP SCHEMA public CASCADE; CREATE SCHEMA public;
DROP ROLE IF EXISTS anon; DROP ROLE IF EXISTS authenticated;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;

-- 建表 DDL 逐字取自 supabase/migrations/20260505130758_init_brands_categories.sql:23-47
-- （只取本片會碰到的欄位;⚠️ 這是節錄,不是那支 migration 的全部）
CREATE TABLE public.brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE
);
CREATE TABLE public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  raw_path text NOT NULL UNIQUE
);
INSERT INTO public.brands(name,slug) VALUES ('CNC RACING','cnc-racing');
INSERT INTO public.categories(name,raw_path) VALUES ('排氣管','引擎部品 · 排氣管');

-- 🔴🔴 這一行是 2026-08-17 第一次跑本檔時【漏掉的前置】,而漏掉它會讓整支 harness 說謊:
--   `DROP SCHEMA public CASCADE; CREATE SCHEMA public` 會把 initdb 給的
--   `GRANT USAGE ON SCHEMA public TO PUBLIC` 一起丟掉
--   ⇒ anon 連 schema 都碰不到 ⇒ REINDEX 回 42501(**碰不到 schema**,不是**沒有 MAINTAIN**)
--   ⇒ migration 的行為負測在【沒收權】的世界也綠。**同一個 SQLSTATE,不同的原因。**
--   ⚠️ 正式 Supabase 的 anon 有這個 USAGE ⇒ 這是【我的環境缺前置】,不是 migration 的 bug;
--      但它逼出了 migration 少的那道歸因正控(見該檔 2a-2)。M5 把這個情境釘死。
--   ⚠️ 授給 `PUBLIC` 而不是只授給 anon/authenticated —— 那才是 initdb / Supabase 的預設。
--      只授給那兩個角色的話,`pg_maintain` 自己就沒有 USAGE,
--      M6 的提權鏈會死在「permission denied for schema public」而**看起來像攻擊不成立**。
--      🔴 同一個 42501、不同的原因,本檔今天已經被它騙過四次。
GRANT USAGE ON SCHEMA public TO PUBLIC;

-- 🔴 這一行就是 #628 要修掉的東西(重建 Sean B2 量到的狀態)
GRANT SELECT, MAINTAIN ON TABLE public.brands, public.categories TO anon, authenticated;
SQL
}

# 以某角色跑一段 SQL,回傳 'OK' 或 SQLSTATE
# 🔴 codex R1-MF5:本函式原本【先跑一次丟掉、再跑一次取值】,每個動作實際執行兩遍。
#    後果不是慢,是**量錯東西** —— 有 MAINTAIN 時第一次 REINDEX 已經改過索引,
#    probe 表印的是第二次的結果,而檔頭宣稱那是「單次對照」。已改成只跑一次。
as_role() {
  psql -h 127.0.0.1 -p "$PORT" -U postgres -tAq 2>&1 <<SQL | grep -o '^NOTICE:.*' | sed 's/NOTICE:  //' | tr -d '[:space:]'
DO \$\$ DECLARE s text; BEGIN
  EXECUTE format('SET LOCAL ROLE %I', '$1');
  BEGIN EXECUTE \$q\$$2\$q\$; s := 'OK';
  EXCEPTION WHEN OTHERS THEN s := SQLSTATE; END;
  RESET ROLE;
  RAISE NOTICE '%', s;
END \$\$;
SQL
}

# 以 $1 的身分先 SET ROLE 到 $2,再跑 $3 —— 用來演「提權之後做得到」
# 🔴🔴 **必須用 SET SESSION AUTHORIZATION,不能用 SET LOCAL ROLE**(codex R2 擊破)。
#   `SET ROLE` 的授權是拿 **session_user** 去驗的,不是 current_user。
#   ⇒ 從 postgres 連線 `SET LOCAL ROLE anon` 之後再 `SET ROLE pg_maintain`,
#      **不管 anon 有沒有那個權限都會成功**(session_user 還是 superuser)
#   ⇒ 那樣量出來的「攻擊鏈成立」**是假證據**。本檔第一版就是這樣量的。
#   ⚠️ `SET SESSION AUTHORIZATION` **不能在 function / DO 裡跑** ⇒ 只能下在 psql 敘述層。
# 🔴 codex R3-MF3:加 ON_ERROR_STOP=1,並把 session_user 一起印出來。
#   少了它:`SET SESSION AUTHORIZATION` 若失敗,psql 會繼續往下跑,
#   後面那發 REINDEX 就是以 **postgres** 的身分做的,而我們照樣擷取到 'OK'
#   ⇒ 又一次「拿假證據當攻擊鏈成立」。**回傳值改成帶 session_user,騙不過去。**
as_role_escalated() {
  psql -h 127.0.0.1 -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -tAq 2>&1 <<SQL | grep -o 'NOTICE:.*' | sed 's/NOTICE:  //' | tr -d '[:space:]'
SET SESSION AUTHORIZATION $1;
DO \$x\$ DECLARE s text; BEGIN
  IF session_user <> '$1' THEN
    RAISE NOTICE 'BADSETUP session_user=%', session_user; RETURN;
  END IF;
  BEGIN
    EXECUTE 'SET ROLE $2';
    IF current_user <> '$2' THEN
      RAISE NOTICE 'BADSETUP current_user=%', current_user; RETURN;
    END IF;
    EXECUTE \$q\$$3\$q\$;
    s := 'OK';
  EXCEPTION WHEN OTHERS THEN s := SQLSTATE; END;
  RAISE NOTICE '%', s;
END \$x\$;
RESET ROLE;
RESET SESSION AUTHORIZATION;
SQL
}

case "$MODE" in

probe)
  echo "▶ probe:同一個動作在兩個世界各印什麼(選 REINDEX 的依據)"
  start_cluster; baseline
  printf '\n  %-22s %-16s %s\n' "動作" "有 MAINTAIN" "無 MAINTAIN"
  printf '  %s\n' "------------------------------------------------------"
  declare -a ACTS=(
    "REINDEX TABLE public.brands"
    "LOCK TABLE public.brands IN SHARE MODE"
    "CLUSTER public.brands"
    "ANALYZE public.brands"
  )
  declare -a A_RES=()
  for a in "${ACTS[@]}"; do A_RES+=("$(as_role anon "$a")"); done
  pq -q -c "REVOKE MAINTAIN ON TABLE public.brands, public.categories FROM anon, authenticated"
  for i in "${!ACTS[@]}"; do
    b=$(as_role anon "${ACTS[$i]}")
    printf '  %-22s %-16s %s\n' "${ACTS[$i]%% *}" "${A_RES[$i]}" "$b"
  done
  echo
  echo "  🔴 兩欄【相同】的那一列不能當負測 —— 它在兩個世界印一樣的東西。"
  ;;

run)
  echo "▶ #628 verify:基線 + apply + 突變 + 冪等"
  start_cluster

  echo
  echo "── 0. 基線(重建 Sean B2 量到的狀態:anon/authenticated 有 MAINTAIN)"
  baseline
  chk "基線 anon 對 brands 有 MAINTAIN" "t" "$(val "select has_table_privilege('anon','public.brands','MAINTAIN')")"
  chk "基線 authenticated 對 categories 有 MAINTAIN" "t" "$(val "select has_table_privilege('authenticated','public.categories','MAINTAIN')")"
  chk "基線 anon 真的做得到 REINDEX(該綠要綠)" "OK" "$(as_role anon 'REINDEX TABLE public.brands')"

  echo
  echo "── 1. apply 本支 migration ⇒ 必須 COMMIT"
  if pq -q -f "$MIG" > "$WORK/apply.log" 2>&1; then A=0; else A=1; fi
  chk "apply exit code" "0" "$A"
  [ "$A" -ne 0 ] && { echo "     apply.log 最後 6 行:"; tail -6 "$WORK/apply.log"; }

  echo
  echo "── 2. apply 後的終態"
  chk "anon 對 brands MAINTAIN 已收" "f" "$(val "select has_table_privilege('anon','public.brands','MAINTAIN')")"
  chk "authenticated 對 categories MAINTAIN 已收" "f" "$(val "select has_table_privilege('authenticated','public.categories','MAINTAIN')")"
  chk "🔴 誤殺正控:anon 的 SELECT 還在" "t" "$(val "select has_table_privilege('anon','public.brands','SELECT')")"
  chk "行為:anon 的 REINDEX 現在被拒(42501)" "42501" "$(as_role anon 'REINDEX TABLE public.brands')"
  chk "行為:categories 同樣被拒" "42501" "$(as_role anon 'REINDEX TABLE public.categories')"

  echo
  echo "── 3. 冪等(同一支再 apply 一次)⇒ 仍須 COMMIT"
  if pq -q -f "$MIG" > "$WORK/apply2.log" 2>&1; then A=0; else A=1; fi
  chk "第二次 apply exit code" "0" "$A"

  echo
  echo "── 4. 🔴 突變(每一發都是「拿掉一個前提,那一格必須紅」)"

  # M1:拿掉 REVOKE ⇒ 行為負測必須紅。這一發是整支 harness 的重點。
  baseline
  sed "s/^    EXECUTE 'REVOKE MAINTAIN/    EXECUTE 'SELECT 1 -- REVOKE MAINTAIN/" "$MIG" > "$WORK/m1.sql"
  chk "M1 突變體確實改到了那一行" "1" "$(grep -c "SELECT 1 -- REVOKE MAINTAIN" "$WORK/m1.sql")"
  if pq -q -f "$WORK/m1.sql" > "$WORK/m1.log" 2>&1; then A=0; else A=1; fi
  chk "M1 拿掉 REVOKE ⇒ apply 必須失敗" "1" "$A"
  # 🔴 codex R1-MF3 重排 §2/§3 之後,這一發改由【元資料層】先接住(那正是重排的目的:
  #    在真的去跑 REINDEX 之前就擋下來)。原本斷言的是行為層訊息 ⇒ 已隨重排更新。
  chk "M1 紅在【元資料層】brands 那一格" "1" \
      "$(grep -c 'anon 對 public.brands 的有效 MAINTAIN 仍為 true' "$WORK/m1.log")"

  # M2:REVOKE 只收一半(漏 categories)⇒ 必須紅,且紅在 categories
  baseline
  sed "s/REVOKE MAINTAIN ON TABLE public.brands, public.categories/REVOKE MAINTAIN ON TABLE public.brands/" "$MIG" > "$WORK/m2.sql"
  if pq -q -f "$WORK/m2.sql" > "$WORK/m2.log" 2>&1; then A=0; else A=1; fi
  chk "M2 漏收 categories ⇒ apply 必須失敗" "1" "$A"
  chk "M2 紅的是 categories 不是 brands" "1" \
      "$(grep -c 'public.categories 的有效 MAINTAIN 仍為 true' "$WORK/m2.log")"
  chk "M2 brands 那半沒有被誤報" "0" \
      "$(grep -c 'public.brands 的有效 MAINTAIN 仍為 true' "$WORK/m2.log")"

  # M3:🔴🔴 把負測動作換成 ANALYZE,**REVOKE 照常保留**(＝完全正確的世界)。
  #   ⇒ apply **必須仍然失敗**。這證明 ANALYZE 讓這一格變成【永遠過不了的守門】。
  #
  #   ⚠️ **我對這一格猜錯過兩次,兩次都被實跑打回**(留著,因為錯的方向本身是教訓):
  #     猜①「ANALYZE ⇒ 負測恆綠,apply 會成功」 ❌
  #     猜②「ANALYZE ⇒ 行為層啞掉,由元資料層接住」 ❌
  #     實際:`ANALYZE` 對沒權限的表是 **WARNING + 跳過,不拋例外**
  #          ⇒ 本格的判定是「動作成功 = 還做得到」⇒ v_ok 永遠 true
  #          ⇒ **在【已經收乾淨】的世界也照樣 RAISE** ⇒ 恆紅,不是恆綠。
  #   🔴 恆綠與恆紅都是「這一格沒有判別力」,但**症狀相反**:
  #      恆綠 = 永遠不擋(看起來很順);恆紅 = 永遠擋(看起來很嚴)。
  #      **兩種我都猜過一次,而它們長得完全不像。⇒ 猜沒有用,要跑。**
  baseline
  sed "s/REINDEX TABLE %s/ANALYZE %s/" "$MIG" > "$WORK/m3.sql"
  chk "M3 突變體確實把動作換成 ANALYZE" "1" "$(grep -c 'ANALYZE %s' "$WORK/m3.sql")"
  chk "M3 突變體保留了 REVOKE(這是正確的世界)" "1" \
      "$(grep -c "EXECUTE 'REVOKE MAINTAIN" "$WORK/m3.sql")"
  if pq -q -f "$WORK/m3.sql" > "$WORK/m3.log" 2>&1; then A=0; else A=1; fi
  chk "🔴 M3 ANALYZE ⇒ 連正確的世界都 apply 不了(恆紅)" "1" "$A"
  chk "🔴 M3 恆紅在行為層那一格" "1" "$(grep -c '仍能對 public' "$WORK/m3.log")"

  # M4:角色不存在 ⇒ 必須失敗,而且要說得出【是誰擋的】。
  #   🔴 codex R1-MF4:原本這一格宣稱「證明 2-pre 角色存在檢查有效」——**那是假的**。
  #      角色不存在時 §0 的 has_table_privilege 自己就先炸了,`2-pre` 整段刪掉這格照樣綠
  #      ⇒ 它對那道守門**零判別力**,而那道守門因此被認定為死碼、**已從 migration 刪除**。
  #   ⇒ 現在這格只宣稱它真正證得到的事:角色不存在時 fail-closed,且紅在 §0。
  baseline
  pq -q -c "DROP OWNED BY authenticated; DROP ROLE authenticated" > /dev/null 2>&1
  if pq -q -f "$MIG" > "$WORK/m4.log" 2>&1; then A=0; else A=1; fi
  chk "M4 角色不存在 ⇒ apply 必須失敗" "1" "$A"
  chk "M4 紅在角色不存在(不是別的原因)" "1" \
      "$(grep -ci 'does not exist\|不存在' "$WORK/m4.log")"
  # 🔴 codex R2:上一格**分不出是 §0 還是 REVOKE 先炸的**(兩者印同類訊息)。
  #    所以這裡**不宣稱是哪一層** —— 只宣稱它在走到我們自己的斷言【之前】就死了,
  #    那一點是分得出來的(我們的 RAISE 一律帶「#628 異常」前綴)。
  chk "M4 死在原生 SQL,沒走到 #628 自訂斷言" "0" \
      "$(grep -c '#628 異常' "$WORK/m4.log")"

  # M5:🔴🔴 歸因正控的回歸格 —— 這一發是本 harness 自己踩過的坑做成的。
  #   拿掉 schema USAGE ⇒ REINDEX 仍回 42501,但原因【不是 MAINTAIN】。
  #   舊版沒有 2a-2 時,這個情境會讓行為負測**在沒收權的世界照樣綠**。
  #   ⇒ 現在必須紅,而且要紅在「連 SELECT 都做不到」那一格。
  baseline
  # 🔴 要連 PUBLIC 一起收 —— baseline 是授給 PUBLIC 的,
  #    只收 anon/authenticated 的話 PUBLIC 那份還在,USAGE 根本沒被抽掉,這一發會恆綠。
  pq -q -c "REVOKE USAGE ON SCHEMA public FROM PUBLIC, anon, authenticated" > /dev/null 2>&1
  chk "M5 前置:USAGE 真的被抽掉了" "f" \
      "$(val "select has_schema_privilege('anon','public','USAGE')")"
  if pq -q -f "$MIG" > "$WORK/m5.log" 2>&1; then A=0; else A=1; fi
  chk "M5 抽掉 schema USAGE ⇒ apply 必須失敗" "1" "$A"
  chk "M5 紅在【歸因不到 MAINTAIN】那一格" "1" \
      "$(grep -c '歸因不到 MAINTAIN' "$WORK/m5.log")"

  # M6:🔴🔴 codex R1-MF1 的回歸格 —— **前兩層都綠而能力還在**的那個世界。
  #   `INHERIT FALSE, SET TRUE` 加入 pg_maintain:
  #     · has_table_privilege(...,'MAINTAIN') = false   ← 元資料層看不到
  #     · 以 anon 身分直接 REINDEX 仍回 42501            ← 行為層也看不到
  #     · 而 anon 只要 `SET ROLE pg_maintain` 就照樣做得到
  #   ⇒ 舊版(沒有 §2a)在這個世界會 **apply 成功**,而收權等於白收。
  baseline
  # 🔴 必須先把【直接授權】收掉,否則量到的是 baseline 自己那一份 MAINTAIN,
  #    而不是「經由成員資格」那條路 —— 第一版就是這樣誤判成「元資料看得到」。
  pq -q -c "REVOKE MAINTAIN ON TABLE public.brands, public.categories FROM anon, authenticated" > /dev/null 2>&1
  pq -q -c "GRANT pg_maintain TO anon WITH INHERIT FALSE, SET TRUE" > /dev/null 2>&1
  chk "M6 前置:成員資格建起來了" "t" "$(val "select pg_has_role('anon','pg_maintain','MEMBER')")"
  chk "M6 前置:元資料層【看不到】(這是重點)" "f" \
      "$(val "select has_table_privilege('anon','public.brands','MAINTAIN')")"
  chk "M6 前置:行為層也【看不到】(直接 REINDEX 仍 42501)" "42501" \
      "$(as_role anon 'REINDEX TABLE public.brands')"
  # 🔴🔴 而能力是真的在:session=anon ⇒ SET ROLE pg_maintain ⇒ REINDEX 成功。
  #    這一格是整份 harness 唯一直接證明「前兩層都綠而攻擊成立」的地方。
  chk "🔴 M6 攻擊鏈真的成立(SET ROLE 後 REINDEX 成功)" "OK" \
      "$(as_role_escalated anon pg_maintain 'REINDEX TABLE public.brands')"
  if pq -q -f "$MIG" > "$WORK/m6.log" 2>&1; then A=0; else A=1; fi
  chk "🔴 M6 可 SET ROLE 到 pg_maintain ⇒ apply 必須失敗" "1" "$A"
  chk "M6 紅在 pg_maintain 成員資格那一格" "1" \
      "$(grep -c 'pg_maintain 的成員' "$WORK/m6.log")"
  pq -q -c "REVOKE pg_maintain FROM anon" > /dev/null 2>&1

  echo
  echo "──────────────────────────────────────────────"
  printf '  PASS=%d  FAIL=%d\n' "$PASS" "$FAIL"
  echo "  🔴 M3 期望的是【連正確的世界都 apply 不了】—— 那是刻意的:"
  echo "     ANALYZE 對沒權限的表只 WARNING 不拋例外 ⇒ 這一格會【恆紅】,不是恆綠。"
  echo "     M3 綠 = 我們選 REINDEX 的理由成立。"
  [ "$FAIL" -eq 0 ] || exit 1
  ;;

drift)
  # 🔴🔴 codex R3-MF1:migration 的 §0 **只會在 apply 那一次執行**
  #   (`supabase db push` 不會重跑已套用的 migration)⇒ 它偵測不到日後漂移。
  #   ⇒ 漂移偵測必須是**外部、可重跑**的東西,就是這個模式。
  # 用法:PGURI='postgres://...' ./scripts/628-verify.sh drift
  #   ⚠️ 唯讀,零寫入。**要對哪個庫跑由呼叫者決定,本檔不內建任何正式庫連線字串。**
  : "${PGURI:?請設 PGURI,例:PGURI='postgres://user:pw@host:5432/postgres' $0 drift}"
  psql "$PGURI" -v ON_ERROR_STOP=1 -tAq <<'SQL'
SELECT CASE WHEN count(*) = 0
            THEN '✅ #628 無漂移:anon/authenticated 對 brands/categories 皆無 MAINTAIN'
            ELSE '🔴 #628 漂移:' || string_agg(r || '@' || t, ', ' ORDER BY r, t)
       END
  FROM (SELECT r, t FROM unnest(ARRAY['anon','authenticated']) r
          CROSS JOIN unnest(ARRAY['public.brands','public.categories']) t
         WHERE has_table_privilege(r, t, 'MAINTAIN')) x;
-- 🔴 同時看 SET ROLE 那條路(元資料的 MAINTAIN 看不到它)
SELECT CASE WHEN count(*) = 0
            THEN '✅ #628 無提權路徑:兩個 client 角色都 SET 不成 pg_maintain / 表 owner'
            ELSE '🔴 #628 提權路徑仍在:' || string_agg(d, ', ')
       END
  FROM (SELECT r || ' → pg_maintain' AS d FROM unnest(ARRAY['anon','authenticated']) r
         WHERE pg_has_role(r, 'pg_maintain', 'SET')
         UNION ALL
        SELECT r || ' → owner of ' || t
          FROM unnest(ARRAY['anon','authenticated']) r
          CROSS JOIN unnest(ARRAY['public.brands','public.categories']) t
          JOIN pg_class c ON c.oid = t::regclass
         WHERE pg_has_role(r, c.relowner, 'SET')) y;
SQL
  ;;

stop)
  pg stop > /dev/null 2>&1; echo "已收掉 $WORK"
  ;;

*) echo "用法: $0 {probe|run|stop}"; exit 2 ;;
esac
