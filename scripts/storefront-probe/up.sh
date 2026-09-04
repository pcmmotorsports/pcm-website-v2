#!/usr/bin/env bash
# 顧客站(storefront)拋棄式鑽機 —— `docs/runbooks/local-admin-with-real-data-probe.md` 的顧客站版。
# 2026-08-18 G3 建;那份 runbook 本體示範的是 admin,這裡是把同一條鏈接到 apps/storefront。
#
#   起  bash scripts/storefront-probe/up.sh
#   收  bash scripts/storefront-probe/down.sh     <- 逐項 pgrep + 逐埠 lsof 驗死,不看指令回傳
#
# 🔴 開瀏覽器一律 `http://localhost:3020`,**不要 `http://127.0.0.1:3020`** ——
#    Next 16 dev 只認 `localhost` 這個 Origin,用 127 會讓 4 支 chunk 回 403,
#    而畫面上 HTML/CSS 正常、**只有 client JS 靜靜地不見**(那跟「功能沒做」長得一樣)。
#    量測與限定見 runbook §9。
#
# 🔴🔴 **本鏈【不是】零 secret 的,而 runbook 檔頭那句「不需要任何 secret」對它不成立。**
#    ⚠️ ~~**而「換去施工窗工作樹」對這一支【沒有用】** —— `REPO` 在下面是**寫死的**~~
#       ~~(`REPO=/Users/sean_1/pcm-website-v2`),`next dev` 一律從**主樹**的 `apps/storefront` 起~~
#       ~~⇒ 不管你人在哪一棵樹呼叫它,**載入的都是主樹那份 `.env.local`**。~~
#    🔵 **2026-08-29 線I 改掉了**:`REPO` 現在從腳本位置推 ⇒ **換樹有用了**,
#       在哪棵樹呼叫就用哪棵樹。⇒ 而那也表示**載入的是那棵樹的 `.env.local`**(worktree 通常沒有)。
#    ⇒ 本腳本只把 Supabase 與 TapPay 那幾個變數用 inline 值蓋掉(指向拋棄式鑽機);
#      **`.env.local` 裡的其他東西,在那個 dev server 行程裡是活的。**
#    ⇒ 🔴 **所以不要對這條鏈打任何「會用到外部金鑰」的路徑** ——
#      例如 `/api/cron/*` 那幾條會建 notifier 的,打通了會**真的寄信出去(鐵則 12⑤,收不回來)**。
#    ✅ 起完之後本腳本會印一行 `next 載入的 env 檔:…` —— **那一行就是量到的答案,不要憑印象。**
#    📌 2026-08-21 實錘:一個窗照 runbook 檔頭那句「不需要任何 secret」在主樹起了 server
#       (已收掉、零請求),而**五分鐘後第二個窗正要跑本腳本**,被攔下。
#       ⇒ **一個帶條件的許可,要把條件寫在許可【裡面】,不是寫在它上面。**
#
# 🔴 效度限制照 runbook §5 / §8-f,一條都不放寬。最容易忘的兩條:
#    · GRANT 與 BYPASSRLS 是這支腳本自己下的 ⇒ **證不了正式站的權限設定**
#    · ~~`/auth/v1` 是替身、**不驗密碼**,任何字串都登得進去~~
#      🔵 **2026-08-29 線D 實測推翻**:`proxy.py:5` 只認 **`auth.users` 裡已存在的 email**;
#      不存在 ⇒ `400 invalid_grant`(它實測:不存在的 email ⇒ 400、`probe@example.com` ⇒ 200 拿到 token)。
#      ⚠️ **來源屬性:線D 量的,線I 未複驗** ⇒ 引用前自己再跑那兩發。
#      🔴 而線D 自陳**它被上面那句舊註解騙過** ⇒ 這不是文件瑕疵,是真的把人帶偏過。
#      ⇒ 仍然成立的那半:**不要拿它驗「擋不擋得住」** —— 它不是真的認證。
#
# 🔴 27 支 migration 套不上是常態(判準是「你要用的表在不在」,不是全綠)。
#    已知受害者:`vehicle_taxonomy_public` ⇒ **車款選擇那條路這套鑽機進不去。**
# 🔴 開瀏覽器一律 http://localhost:3020,不要 127.0.0.1(見 G3-004:Origin 決定 200/403)
#
# 🔴🔴 **`FORCE=1` 那條放行路徑【至今沒有人走完】** —— 寫死在這裡,免得下一個人以為它驗過。
#    每一次不驗它的理由都一樣、而且都成立:**走下去會真的 initdb + 起 server + 刪掉一個
#    可能屬於別窗的資料目錄** ⇒ 副作用落在別人身上,不該為了驗它去砸別人。
#    ⇒ 那不是拖延,而它的結果是:**這是一個永遠不會被驗的分支。**
#    ⇒ 要驗它,唯一乾淨的做法是**在一台沒有別窗的機器上**、或先把所有別窗的鑽機都收乾淨再跑。
set -euo pipefail
# 🔴 export，不是只給 initdb 加前綴：postmaster 啟動時也要看到它，
#    否則 FATAL: postmaster became multithreaded during startup（2026-08-18 實際踩到）
export LC_ALL=C
# 🔴 從【腳本自己的位置】推,不是寫死主樹(照 `admin-probe/up.sh` 的寫法)。
#    ~~`REPO=/Users/sean_1/pcm-website-v2`~~ 2026-08-29 線I 改。
#    成因:寫死主樹 ⇒ 從施工窗的 worktree 呼叫它,它會【安靜地】跑去主樹,
#    而畫面上完全正常 —— 那與「我在這棵樹上跑」長得一模一樣。
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
# ⚠️ **它跟的是【這支腳本檔在哪】,不是【你 cd 到哪】**(2026-08-29 線I 隔離實測):
#    cd <worktree> && bash /Users/sean_1/pcm-website-v2/scripts/storefront-probe/up.sh
#    ⇒ 仍然用**主樹**。⇒ 要用哪棵樹,就呼叫【那棵樹裡的這支檔】。
#    實測(把同一行放進三個位置各跑一次):假樹 ⇒ 假樹路徑 / /tmp/mainlike ⇒ /tmp/mainlike /
#    現造第三個位置 ⇒ 那個位置。而**寫死版在同樣三個位置都印主樹**(那是本次要修的東西)。
# 🔴 路徑可覆寫:多窗平行時各自帶一個 `STOREFRONT_PROBE_DIR`(down.sh 讀同一個變數)。
#    預設值仍是固定路徑 —— 那是為了讓 `up.sh` / `down.sh` 這一對在【不傳任何東西】時仍然配得上;
#    而固定路徑的代價由下面那道前置閘擋住,不是靠使用者記得。
SP="$(cd "$(dirname "$0")" && pwd)"
# 🔴 路徑**與埠**住在 `env.sh`,**up 與 down 讀同一份**(2026-08-19 W3;做法照 `admin-probe`)。
#    為什麼不能兩邊各寫一份:見那支檔的檔頭 —— 而**本專案就是活生生的例子**,
#    落檔前 `up.sh` 與 `down.sh` 的常數行**已經不一樣了**(CORS 只在 down 那行)。
# shellcheck source=./env.sh
. "$SP/env.sh"
SEC="pcm-g3-throwaway-jwt-secret-at-least-32-chars-long"

# 🔴🔴 **前置閘(2026-08-19 新增)—— 本來這裡是無條件 `rm -rf $S`。**
#    形狀:A 窗正在跑 probe,B 窗跑 `up.sh` ⇒ **B 當場把 A 的 datadir 砍掉**,
#    而 A **不會收到任何訊息**,它的 postgres 變成一個沒有資料目錄的孤兒。
#    ⇒ **一個被中途拆掉的量測,長得跟一個完成的量測一模一樣。**
#    ⇒ 所以:有人在跑就【停下來並指名是誰】,不要自作主張接管。
busy=""
if [ -f "$S/pg/postmaster.pid" ]; then
  _pid=$(head -1 "$S/pg/postmaster.pid" 2>/dev/null || true)
  # 🟡 PID 重用會誤判 busy(fail-closed,煩但不危險)——
  #    `postmaster.pid` **第 2 行就是 datadir 路徑**,比對它就去掉這個誤紅。
  _dd=$(sed -n '2p' "$S/pg/postmaster.pid" 2>/dev/null || true)
  if [ -n "${_pid:-}" ] && kill -0 "$_pid" 2>/dev/null && [ "${_dd:-}" = "$S/pg" ]; then
    busy="postgres pid $_pid(datadir $S/pg)"
  fi
fi
if [ -z "$busy" ]; then
  for _p in $WEB $PROXY $PREST $CORS $PG; do
    # 🔴 `|| true` 少不得:本檔是 `set -euo pipefail`,而**埠是空的時候 `lsof` 回 1**
    #    ⇒ 沒有它,這一行會在「第一個空著的埠」就把整支腳本【靜默】殺掉(exit 1、零輸出)。
    #    📌 2026-08-19 實測踩到:M1 那一格看起來通過(證據沒被刪),
    #       **而它是因為腳本死在這裡、根本沒走到下面那道閘** —— 對的結果、錯的原因。
    _o=$(lsof -nP -iTCP:$_p -sTCP:LISTEN 2>/dev/null | grep -v WARNING | awk 'NR==2 {print $2" "$1}' || true)
    if [ -n "$_o" ]; then busy="埠 $_p 已被佔用 —— pid/command = $_o"; break; fi
  done
fi
if [ -n "$busy" ]; then
  echo "🔴 已經有一份鑽機在跑,**這支腳本不會接管它**:" >&2
  echo "   $busy" >&2
  [ -f "$S/owner.txt" ] && { echo "   來歷:" >&2; sed 's/^/     /' "$S/owner.txt" >&2; }
  echo "" >&2
  echo "   要收掉它  ⇒ bash scripts/storefront-probe/down.sh" >&2
  echo "   要並行跑  ⇒ 換一組路徑與埠(2026-08-19 起埠也可覆寫,見 env.sh):" >&2
  echo "       STOREFRONT_PROBE_DIR=/tmp/pcm-g3-probe-b \\" >&2
  echo "       STOREFRONT_PROBE_PG=55543 STOREFRONT_PROBE_PREST=3979 STOREFRONT_PROBE_PROXY=3978 \\" >&2
  echo "       STOREFRONT_PROBE_WEB=3030 STOREFRONT_PROBE_CORS=3997 \\" >&2
  echo "         bash scripts/storefront-probe/up.sh" >&2
  echo "       🔴 收的時候要帶【同一組】—— 不帶的話 down.sh 會拿預設埠去查," >&2
  echo "          每一格都印綠而你的鑽機還活著。owner.txt 有記你當初用的那幾個埠。" >&2
  echo "" >&2
  echo "   ⚠️ 上面那份來歷【長得跟一份啟動摘要一模一樣】(起於 / datadir / 埠)" >&2
  echo "      ⇒ 用 tail 讀本檔的 log 會讀到它,而它讀起來像「我起好了,埠在這」。" >&2
  echo "      ⇒ 2026-08-29 線D 實撞:tail -12 一個【17 行全是拒絕】的 log,結論整個反了," >&2
  echo "        然後拿一台【80 分鐘前起的、停在舊 commit 的】站去驗一顆剛改好的鈕," >&2
  echo "        差點回報「那個修沒生效」——而那會叫人回去修一個已經修好的東西。" >&2
  echo "      📌 所以下面那句印在【最後】:會改變結果意義的訊息,必須是最後一行。" >&2
  echo "" >&2
  echo "🔴 本次【沒有起任何東西】(rc=1)。上面那些埠是【既有那一份】的,不是你的。" >&2
  exit 1
fi

# 🔴🔴 **M1(W6 抓,2026-08-19):前置閘只擋「還活著」,而 `$S` 存在【不等於】有東西活著。**
#    `down.sh` 判紅時會「⏸ 保留供你查」——**而那份證據會被下一次 `up.sh` 靜默刪掉,一個字都不提**
#    ⇒ **「保留供你查」的保存期,只到下一次有人跑 `up.sh` 為止。**
#    ⇒ 兩個各自正確的改動互相抵銷 ⇒ 這裡也要問一次。
#    📌 `down.sh` 已經在做一模一樣的事(拆之前先印 `owner.txt`),而**刪得更徹底的是這一支**。
if [ -e "$S" ]; then
  echo "🔴 $S 已經存在 —— **這支腳本不會靜默刪掉它**。" >&2
  [ -f "$S/owner.txt" ] && { echo "   來歷:" >&2; sed 's/^/     /' "$S/owner.txt" >&2; }
  echo "   它可能是:① 上一次 down.sh 判紅、**刻意保留下來給你查**的證據" >&2
  echo "             ② 有人跑完沒收攤" >&2
  echo "   看過、確定不要了 ⇒ FORCE=1 bash scripts/storefront-probe/up.sh" >&2
  [ "${FORCE:-0}" = "1" ] || exit 1
  echo "   (FORCE=1 ⇒ 照你的意思刪掉重來)" >&2
fi

rm -rf "$S" && mkdir -p "$S"   # 🔴 引號:`${STOREFRONT_PROBE_DIR:-…}` 只擋空字串,擋不了空白/glob
# 誰起的、什麼時候起的 —— down.sh 會在拆之前把它印出來。
{ echo "起於   : $(date '+%Y-%m-%d %H:%M:%S')"
  echo "shell  : pid $$  tty $(tty 2>/dev/null || echo '?')"
  echo "datadir: $S"
  echo "埠     : web $WEB / proxy $PROXY / prest $PREST / cors $CORS / pg $PG"
  echo "REPO   : $REPO"
  echo "HEAD   : $(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo unknown)"
} > $S/owner.txt
initdb -D $S/pg -U postgres --auth=trust --encoding=UTF8 --locale=C > $S/initdb.log 2>&1
pg_ctl -D $S/pg -o "-p $PG -k /tmp" -l $S/pg.log start > $S/pgctl.log 2>&1
sleep 2

# 🔴 **驗「我連上的那顆, 真的是我剛起的那顆」**(2026-08-30 線【客人帳戶區】`-08` 補;
#    與 `scripts/admin-probe/up.sh` **同一段, 逐字相同** —— 兩支的 `initdb`/`pg_ctl` 也是逐字相同,
#    所以洞也是同一個)。成因由哨兵 `-22` 轉來:`-eb` 的 codex 在另一支 probe 上抓到同型 ——
#    埠上若已經有【別的】postgres, 腳本會對**不是拋棄式的那顆**套 migration, **而且照樣全綠**。
# 🔴 為什麼不靠上面那道埠預檢就好:①它靠 `lsof`, 而 `lsof` 不存在時 `|| true` 讓它**安靜放行**
#    ②預檢與真正連上之間有時間差 ③**預檢答的是「埠上有沒有人」, 這一發答的是「那個人是不是我」**。
#    📌 **⇒ 兩個問句不同, 而它們在一切正常的日子裡印同一個結果。**
# ⚠️ 兩側都走 realpath:postgres 回的是 `-D` 當初拿到的字面(`/tmp/…`),
#    而 macOS 的 `/tmp` 是 `/private/tmp` 的 symlink ⇒ 不解析就會【永遠不相等】=一道恆紅的閘。
_want=$(python3 -c 'import os,sys;print(os.path.realpath(sys.argv[1]))' "$S/pg")
_got=$(psql -h 127.0.0.1 -p $PG -U postgres -tAc "SHOW data_directory" 2>/dev/null || true)
_got=$(python3 -c 'import os,sys;print(os.path.realpath(sys.argv[1]) if sys.argv[1] else "")' "$_got")
if [ "$_want" != "$_got" ]; then
  echo "🔴 埠 $PG 上的 postgres【不是】這支腳本剛起的那顆 —— 停止, 不對它套任何東西。" >&2
  echo "   我起的  : $_want" >&2
  echo "   實際連到: ${_got:-(連不上或回空)}" >&2
  echo "   ⇒ 若是連不上:看 $S/pg.log 與 $S/pgctl.log" >&2
  echo "   ⇒ 若是別人的 postgres:換一組埠(STOREFRONT_PROBE_PG=…),或收掉那一份" >&2
  exit 1
fi
echo "✅ pg 身分核對:$PG ⇒ $_got"

psql -h 127.0.0.1 -p $PG -U postgres -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE ROLE service_role NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticator LOGIN NOINHERIT;
GRANT anon, authenticated, service_role TO authenticator;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb DEFAULT '{}'::jsonb);
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA extensions;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(coalesce(current_setting('request.jwt.claim.sub', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.role', true), '')::text $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
SQL

ok=0; fail=0
for f in "$REPO"/supabase/migrations/*.sql; do   # 🔴 引號包在 glob 外:包住 `*` 會讓它不展開
  if psql -h 127.0.0.1 -p $PG -U postgres -v ON_ERROR_STOP=1 -q -f "$f" >> $S/apply.log 2>&1
  then ok=$((ok+1)); else fail=$((fail+1)); echo "FAIL $f" >> $S/apply.log; fi
done
echo "migration ok=$ok fail=$fail  (判準不是全綠,是你要用的表在不在)"

# == 重放後修補(2026-09-02 -0e)=========================================
# 從零重放會製造出兩個【正式庫上沒有】的問題, 而兩個都是安靜的。
#
# (1) search_catalog_by_vehicle 會有【兩個多載】
#     成因:較新那支 migration 加了 p_new_since 而沒 DROP 舊簽章
#           正式庫是依序 apply 所以只有 1 個;從零重放兩個都建起來。
#     症狀:呼叫時 ERROR: function ... is not unique
#     而前端把那個錯 catch 起來, fallback 成【未篩選】
#     ==> 畫面不論選什麼車都印全部件數, 連餵一個不存在的車款也一樣
#     ==> 「篩選壞了」與「這台車真的裝得上這麼多件」在畫面上是同一句話
#     正式庫實查 2026-09-02:多載數 = 1(正對照 search_products_by_vehicle 也 = 1)
psql -h 127.0.0.1 -p $PG -U postgres -q -c "
  DO \$fix\$
  DECLARE r record;
  BEGIN
    FOR r IN
      SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
      WHERE ns.nspname='public' AND p.proname='search_catalog_by_vehicle'
        AND pg_get_function_arguments(p.oid) NOT LIKE '%p_new_since%'
    LOOP EXECUTE 'DROP FUNCTION ' || r.sig; END LOOP;
  END \$fix\$;" >> $S/apply.log 2>&1 || true
NOV=$(psql -h 127.0.0.1 -p $PG -U postgres -tAc "SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname='search_catalog_by_vehicle';" 2>/dev/null || echo '')
if [ "$NOV" = "1" ]; then echo "重放修補1:search_catalog_by_vehicle 多載 = 1(與正式庫相同)"
else echo "重放修補1:多載 = ${NOV:-讀不到} <== 不是 1, 車款篩選會安靜失效, 去看 $S/apply.log"; fi

# (2) product_fitments_effective 由 20260901170000 建, 而第一個讀它的是 20260712183000
#     從零重放時那 4 支下游在建表之前就跑過了 ==> 全部 ERROR 而表最後才出現
#     所以這裡補跑一次。根治要改版號, 那是 Sean 的成本 ==> 板 b4-PFEREPLAY1
for M in 20260712183000_products_catalog_page_public \
         20260712193000_catalog_rpc_expose_fitments \
         20260811020000_m4b_storefront_277_vehicle_taxonomy_effective_view \
         20260811100000_m4b_storefront_277c_vehicle_taxonomy_direct_years; do
  psql -h 127.0.0.1 -p $PG -U postgres -q -f "$REPO/supabase/migrations/$M.sql" >> $S/apply.log 2>&1 || true
done
# 這裡【不量】vehicle_taxonomy_public 的列數 -- 種子還沒跑, 量到的必然是 0
# 而那個 0 會被讀成「修補失敗」。列數在種子之後才量(見下方「選車自檢」)。
VTEXISTS=$(psql -h 127.0.0.1 -p $PG -U postgres -tAc "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='vehicle_taxonomy_public';" 2>/dev/null || echo '')
if [ "$VTEXISTS" = "1" ]; then echo "重放修補2:vehicle_taxonomy_public 這個 view 建起來了(列數在種子之後才量)"
else echo "重放修補2:那個 view 沒建起來(VTEXISTS=${VTEXISTS:-讀不到}) <== 去看 $S/apply.log"; fi

# 這一段擋不住什麼, 印在這裡, 下一個人不必重推導:
echo "   限制:這兩個修補只在鑽機上做;正式庫沒有這兩個問題(2026-09-02 唯讀實查)"
echo "   限制:其餘 fail 的 migration 沒有被修 -- 判準仍然是「你要用的表在不在」"
# =======================================================================

psql -h 127.0.0.1 -p $PG -U postgres -v ON_ERROR_STOP=1 -q <<'SQL'
GRANT USAGE ON SCHEMA public TO service_role, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
ALTER ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA auth TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role(), auth.jwt() TO authenticated, anon, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON customers, customer_addresses, customer_vehicles TO authenticated;
SQL

psql -h 127.0.0.1 -p $PG -U postgres -v ON_ERROR_STOP=1 -q -f "$SP/seed.sql"
echo "seed 完成: $(psql -h 127.0.0.1 -p $PG -U postgres -t -c 'select count(*) from products' | tr -d ' ') 件商品"

# -- 選車自檢(2026-09-02 -0e):種子的車款有沒有真的流進那條路 --------------
# 為什麼要這一格:trigger sync_product_fitments 讀 elem->>'motoBrand',
#   而它逐字寫著「單一髒元素跳過、絕不 rollback products」
#   ==> 種子 key 寫錯時它【不會出錯】:商品照樣進去、商品頁照樣顯示「適用 XXX」
#       (那是直接讀 products.fitments)-- 只有【選車篩選】那條路空掉, 而沒有東西會叫
#   實錘 2026-09-02:種子寫 'brand' 而不是 'motoBrand' ==> product_fitments 恆 0
PFN=$(psql -h 127.0.0.1 -p $PG -U postgres -tAc "SELECT count(*) FROM public.product_fitments;" 2>/dev/null || echo '')
VTN=$(psql -h 127.0.0.1 -p $PG -U postgres -tAc "SELECT count(*) FROM public.vehicle_taxonomy_public;" 2>/dev/null || echo '')
if [ -n "$PFN" ] && [ "$PFN" -gt 0 ] 2>/dev/null; then echo "選車自檢:product_fitments = $PFN 列 / vehicle_taxonomy_public = ${VTN:-?} 列"
else echo "選車自檢 FAIL:product_fitments = ${PFN:-讀不到} <== 種子的車款沒流進那條路, 選車篩選會是空的(先看 seed.sql 的 key 是不是 motoBrand)"; fi

# ── 🔴 種子自檢:每一家品牌都要有商品(2026-08-27 `-ed` 線)──────────────────
#    為什麼要有這一格:`seed.sql` 沒有任何自動化測試依賴它(全 repo 唯一的呼叫端就是本檔)
#    ⇒ **改壞了不會有任何東西紅**,只會在下一個人用鑽機時給他一份看起來正常的假資料。
#    ⇒ 判準不是「seed 跑完沒報錯」(它現在也不報錯,而改之前每一家都是空的),
#      是**逐家數出來、對不上就非 0**。
#
# 🔴 這一格的第一版有【兩條恆綠路徑】(code-reviewer 抓到,兩條都補了):
#   ① `nbrand` 若是 0(brands 空表 ⇒ seed migration 沒套上,而那正是本檔頭寫「套不上是常態」的那件事)
#      ⇒ gap 一列都不回、`0 -ne 0` 也不成立 ⇒ 它會印「✅ 0 家品牌每家 ≥ 4 件」。**真空成立。**
#   ② psql 少了 `-v ON_ERROR_STOP=1` ⇒ SQL 錯誤時它「finished normally」rc=0、變數變【空字串】
#      ⇒ `[ "" -ne 0 ]` 在 bash **回 2**,`if` 讀成 false ⇒ **穿過去印 ✅**(`set -e` 對 if 條件不生效)。
#   📌 兩條都是「量具在該紅的世界印綠」,而不是「判斷寫錯」。
# 🔴 而第三條是【量具比宣稱窄】:第一版只數件數與變體數,不數形狀
#    ⇒ `k=4` 宣稱「有圖」而實際 `images='[]'` 的那個 bug **就是從這個縫掉出去的,而它印 ✅**。
MIN_PER_BRAND=4
q() { psql -h 127.0.0.1 -p $PG -U postgres -t -A -v ON_ERROR_STOP=1 -c "$1"; }
gap=$(q "
  SELECT b.slug || '(' || count(p.id) || ')'
  FROM brands b LEFT JOIN products p ON p.brand_id = b.id
  GROUP BY b.slug HAVING count(p.id) < $MIN_PER_BRAND ORDER BY b.slug;" | tr -d ' ')
nbrand=$(q 'select count(*) from brands' | tr -d ' ')
nvar=$(q "select count(*) from product_variants v join products p on p.id=v.product_id
          where p.handle like 'probe-%-3';" | tr -d ' ')
nimg=$(q "select count(*) from products
          where handle like 'probe-%' and jsonb_array_length(images) > 0;" | tr -d ' ')
nfit=$(q "select count(*) from products
          where handle like 'probe-%' and jsonb_array_length(fitments) > 0;" | tr -d ' ')
# ① 分母先自證非空 —— 沒有這一行,下面每一格都可以真空成立。
case "$nbrand" in
  ''|*[!0-9]*) echo "🔴 種子自檢 FAIL:品牌數讀不出來(值='$nbrand')⇒ 量具本身壞了,不是資料的問題" >&2; exit 1 ;;
esac
if [ "$nbrand" -lt 1 ]; then
  echo "🔴 種子自檢 FAIL:brands 表是空的 ⇒ seed migration 沒套上,底下每一格都會【真空成立】" >&2
  exit 1
fi
for v in nvar nimg nfit; do
  eval "val=\$$v"
  case "$val" in
    ''|*[!0-9]*) echo "🔴 種子自檢 FAIL:$v 讀不出來(值='$val')⇒ 量具壞了" >&2; exit 1 ;;
  esac
done
if [ -n "$gap" ]; then
  {
    echo "🔴 種子自檢 FAIL:下列品牌商品數 < $MIN_PER_BRAND(品牌總數 $nbrand)"
    echo "$gap" | tr '\n' ' '
    echo
    echo "   ⇒ 那幾家在這台鑽機上打不開商品頁,而它不會報錯、只會給你一頁空的。"
  } >&2
  exit 1
fi
# 七色變體:每家 k=3 那支各 7 個 ⇒ 期望 = 品牌數 × 7。少了就是 variants 那段沒跑到。
if [ "$nvar" -ne "$((nbrand * 7))" ]; then
  echo "🔴 種子自檢 FAIL:probe-%-3 的變體數 $nvar ≠ 品牌數 $nbrand × 7 = $((nbrand * 7))" >&2
  exit 1
fi
# ③ 數形狀,不只數件數:每家 k=3/k=4 兩支有圖、k=2/k=3/k=4 三支有車款。
#    形狀對不上 = 那一族的題目在鑽機上構造不出來,而件數那格看不出來。
if [ "$nimg" -ne "$((nbrand * 2))" ]; then
  echo "🔴 種子自檢 FAIL:有圖的 probe 商品 $nimg ≠ 品牌數 × 2 = $((nbrand * 2))(k=3/k=4 應各一支)" >&2
  exit 1
fi
if [ "$nfit" -ne "$((nbrand * 3))" ]; then
  echo "🔴 種子自檢 FAIL:有適用車款的 probe 商品 $nfit ≠ 品牌數 × 3 = $((nbrand * 3))(k=2/3/4)" >&2
  exit 1
fi
echo "✅ 種子自檢:$nbrand 家品牌每家 ≥ $MIN_PER_BRAND 件、多變體 $nvar(=×7)、有圖 $nimg(=×2)、有車款 $nfit(=×3)"
# ─────────────────────────────────────────────────────────────────────────────

cat > $S/prest.conf <<CONF
db-uri = "postgres://authenticator@127.0.0.1:$PG/postgres"
db-schemas = "public"
db-anon-role = "anon"
server-port = $PREST
jwt-secret = "$SEC"
db-max-rows = 2000
CONF
nohup postgrest $S/prest.conf > $S/prest.log 2>&1 &
sleep 3

python3 - "$SEC" > $S/jwts.txt <<'PY'
import base64, hmac, hashlib, json, sys
sec = sys.argv[1].encode()
b64 = lambda d: base64.urlsafe_b64encode(d).rstrip(b"=")
def tok(extra):
    h = b64(json.dumps({"alg":"HS256","typ":"JWT"},separators=(",",":")).encode())
    p = b64(json.dumps(dict(iss="pcm-g3", exp=4102444800, **extra),separators=(",",":")).encode())
    return (h+b"."+p+b"."+b64(hmac.new(sec,h+b"."+p,hashlib.sha256).digest())).decode()
print("ANON="+tok({"role":"anon"}))
print("SERVICE="+tok({"role":"service_role"}))
print("AUTH="+tok({"role":"authenticated","aud":"authenticated",
                   "sub":"11111111-1111-1111-1111-111111111111"}))
# 第二個客人的 JWT(換帳號那一類題目要用;見 seed.sql 的說明)
print("AUTH2="+tok({"role":"authenticated","aud":"authenticated",
                    "sub":"22222222-2222-2222-2222-222222222222"}))
PY
grep '^AUTH=' $S/jwts.txt | cut -d= -f2- > $S/authjwt.txt
grep '^AUTH2=' $S/jwts.txt | cut -d= -f2- > $S/authjwt2.txt

cp "$SP/proxy.py" "$S/proxy.py"
# 🔴 上游埠與監聽埠用 argv 傳進去 —— 那兩個原本寫死在 proxy.py 裡(見該檔那段註解)。
nohup python3 "$S/proxy.py" "$PREST" "$PROXY" "$SEC" "$PG" > "$S/proxy.log" 2>&1 &
# 🔴 埠用 argv 傳進去 —— 它原本**寫死在那支 py 裡面**,覆寫環境變數對它沒有用
#    (而 `down.sh` 的 `pkill -f "cors-server.py"` 也因此**抓不到自己那一個**,見下)。
nohup python3 "$SP/cors-server.py" "$CORS" > $S/cors.log 2>&1 &
sleep 2

A=$(grep ANON= $S/jwts.txt | cut -d= -f2-); SR=$(grep SERVICE= $S/jwts.txt | cut -d= -f2-)
cd "$REPO/apps/storefront"   # 🔴 加引號:worktree 路徑是誰建的就長什麼樣,可能含空白
# 🔴🔴 **不走 `npx`**(2026-08-21 `-04` SP-1 第二輪;本機實測,不是推的)。
#   `npx` 就是 `npm exec`,而 **`npm exec` 型的行程會把【整包環境變數】印進 `pgrep -fl` 的那一行** ——
#   一般行程只印 argv、乾淨;只有這一種會連環境一起印。
#   實測(macOS 14.6.1,用假 canary 值起一輪探針):
#     pgrep -fl 'npm exec' | grep -c '[H]OME='                    ⇒ 55   ← 尺有力(正對照)
#     pgrep -fl 'npm exec' | grep -c '[T]APPAY_APP_KEY='          ⇒ 1    🔴 在漏
#     pgrep -fl 'npm exec' | grep -c '[S]ERVICE_ROLE_KEY='        ⇒ 1    🔴 在漏
#     pgrep -fl 'npm exec' | grep -c '[C]ANARY…(那個假值本身)'     ⇒ 1    🔴 明文
#     負對照(編造字串)                                            ⇒ 0
#   ⇒ 改成**直接呼叫解析後的 next binary**,繞開 npm exec 那層包裝。
#   ⚠️ **前一版的修法(把 set -a 換成單行前綴)沒有關掉這條路** —— 縮小了爆炸半徑,而管道是同一條。
#      **那一版我也「驗過」,只是驗錯了面**(我量的是 `ps -Eww` 與 `ps -ww -o command=`,
#      而洩漏發生在 `pgrep -fl` 對 `npm exec` 那一行)⇒ **量了 A、答了 B。**
#   🔴 沒有就報錯,不落回 npx —— 落回去等於把「有沒有在漏」變成一件安靜的事。
NEXT_BIN="$REPO/apps/storefront/node_modules/.bin/next"
if [ ! -x "$NEXT_BIN" ]; then
  echo "找不到可執行的 $NEXT_BIN ——【不會】落回 npx(那條路會把環境變數印進 pgrep)。先跑 pnpm install。" >&2
  exit 1
fi
# ─────────────────────────────────────────────────────────────────────────────
# 🔴 TapPay 金鑰:從【repo 外的一個檔】讀,不從參數、不從訊息、不從 .env*
#
# 為什麼是檔不是參數:參數會進 shell history、進 ps 的命令列、進交接訊息、進 transcript。
# 檔案路徑可以在任何地方被講出來而不洩漏任何東西 —— **講路徑是安全的,講值不是。**
#
# 這支腳本對這個檔只做三件事:讀它、用它、印出「讀到沒 + 長度」。
# 🔴 **永遠不印值、不印前綴後綴** —— 前四碼也是值的一部分。
# ⚠️ 這個檔在 repo 之外 ⇒ 不會被 git 追蹤、不會進 commit、不會被我們的 grep 掃到。
# ─────────────────────────────────────────────────────────────────────────────
TAPPAY_ENV_FILE="${TAPPAY_ENV_FILE:-$HOME/pcm-secrets/tappay-sandbox.env}"
# 🔴 `-04` SP-1(2026-08-21):原本這裡是 `set -a; . "$TAPPAY_ENV_FILE"; set +a`
#    ⇒ 匯出到【整個 up.sh 的 shell】,之後每一個子行程都繼承它,而它只有一個消費者。
#    改成:讀進**普通 shell 變數**(不 export),只在 `next dev` 那一行以前綴帶進【那一個行程】。
#
# ⚠️ 這【不是】把它藏起來,而射程要講清楚(本機當場量的,2026-08-21 macOS 14.6.1):
#    · 環境變數:`ps -Eww -p <pid>` 在本機**讀不到任何一個** —— 連自己剛起的行程也讀不到
#      (正對照:同一發抓得到 `sleep` / `next` 字樣 ⇒ 在看對的 pid;負對照:編造字串 0)。
#    · 命令列:`ps -ww -A -o command=` **讀得到**。而 `VAR=val cmd` 這種前綴**不會**進 cmd 的 argv
#      —— 實測:up.sh 用這個形式傳 `SUPABASE_SERVICE_ROLE_KEY`,而
#        `ps -ww -A -o command= | grep -c '[S]UPABASE_SERVICE_ROLE_KEY='` ⇒ **0**
#        (正對照 `[n]ext dev` ⇒ 5;🔴 負對照沒用 `[]` 時回 2 —— **grep 會抓到自己**,那一版的數字全是假的)。
#    🔴 **不同 shell 看得到的範圍不同** ⇒ 下一個人在別的 shell 裡跑同一發 canary,可能得到不一樣的答案。
#       **要斷言「沒有在漏」,先讓你的 ps 對一個【你自己種的 canary】表演一次命中**;
#       表演不出來 ⇒ 你的結論只能寫「我看不到」,不能寫「沒有在漏」。
if [ -f "$TAPPAY_ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$TAPPAY_ENV_FILE"
  TP_APP_ID="${NEXT_PUBLIC_TAPPAY_APP_ID:-}"; TP_APP_KEY="${NEXT_PUBLIC_TAPPAY_APP_KEY:-}"; TP_ENV="${NEXT_PUBLIC_TAPPAY_ENV:-sandbox}"
  unset NEXT_PUBLIC_TAPPAY_APP_ID NEXT_PUBLIC_TAPPAY_APP_KEY NEXT_PUBLIC_TAPPAY_ENV
  # 🔴 `-04` SP-3:原本這行印 APP_ID 的【全值】,而上面那句寫著「永遠不印值」⇒ 那句話是假的。
  #    改成只印「有沒有」與長度 —— 兩個世界仍然分得開,而一個字元的值都沒有離開這台機器。
  echo "tappay: 讀到 $TAPPAY_ENV_FILE  APP_ID 長度=${#TP_APP_ID}  APP_KEY 長度=${#TP_APP_KEY}  ENV 長度=${#TP_ENV}"
else
  TP_APP_ID=""; TP_APP_KEY=""; TP_ENV=""
  echo "tappay: 找不到 $TAPPAY_ENV_FILE ⇒ 用假金鑰,結帳第④步會顯示「付款模組暫時無法使用」(那是預期的,不是壞掉)"
fi

# TapPay:預設 00000 = 【故意無效】(Number('00000')=0 ⇒ readClientEnv 回 null ⇒ ready='error'
#   ⇒ 卡欄不掛、SDK 一次都不載,結帳第④步顯示「付款模組暫時無法使用」。這是探針的設計不是產品缺陷。
#   要驗第④⑤步:先 export 真的 sandbox 金鑰再跑本腳本(下面三個都吃外部值)。
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:$PROXY NEXT_PUBLIC_SUPABASE_ANON_KEY="$A" \
SUPABASE_SERVICE_ROLE_KEY="$SR" NEXT_PUBLIC_SITE_URL=http://localhost:$WEB \
NEXT_PUBLIC_TAPPAY_APP_ID="${TP_APP_ID:-00000}" \
NEXT_PUBLIC_TAPPAY_APP_KEY="${TP_APP_KEY:-probe_app_key}" \
NEXT_PUBLIC_TAPPAY_ENV="${TP_ENV:-sandbox}" \
nohup "$NEXT_BIN" dev -p $WEB -H 127.0.0.1 > $S/next.log 2>&1 &
sleep 15
# 🔴 把「Next 載入了哪些 env 檔」印出來 —— **這是機制,不是提醒。**
#    Next 自己會在啟動第一段印 `- Environments: .env.local`,而那行埋在 next.log 裡沒有人會去開。
#    ⇒ 撈上來放在使用者一定看得到的位置。查無時明說查無,不要靜靜地不印(那與「沒載入」長得一樣)。
echo "next 載入的 env 檔:$(grep -m1 'Environments:' $S/next.log 2>/dev/null || echo '(next.log 裡沒有 Environments 這一行 —— 未確認,不等於沒載入)')"
echo "  ⚠️ 上面若出現 .env.local ⇒ 真金鑰在這個 dev server 的環境裡 ⇒ **不要打任何 /api/cron/* 之類會建 notifier 的路徑**"
# 🔴 `|| true` 少不得(2026-08-27 實測踩到):連不上時 curl **回 7**,而本檔是 `set -euo pipefail`
#    ⇒ 「獨立的指派」會讓整支腳本【當場死掉】,`web:` 那一行一個字都不會印、rc=7。
#    ⚠️ 原本寫成 `echo "web: $(curl …)"` 反而沒事 —— 命令替換在**參數位置**時,
#       決定 rc 的是 `echo` 不是 curl。**我把它拆成變數,就把一個不會死的地方變成會死的地方。**
WEB_CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$WEB/" || true)
echo "web: ${WEB_CODE:-000}  <- 開這個,不要開 127.0.0.1"
# 🔴 `000` = curl 連不上 = dev server 根本沒起來,**不是還沒暖機** —— 而這兩件事印同一個數字。
#    最常見的成因不是壞掉,是**被一道擋得對的閘停掉**:REPO 寫死主樹 ⇒ next dev 一定載入
#    主樹的 `.env.local` ⇒ 裡面有指向正式庫的變數 ⇒ dev-db-guard-gate 當場停掉它,
#    而那段話印在 `$S/next.log` 裡、**不在使用者的畫面上**。
#    ⇒ 指路要指到【正解】,不要只留一個數字讓人自己猜(猜的人很可能去走
#      錯誤訊息裡那條 `PCM_ALLOW_PROD_DB_DEV=1` —— 那等於起一台握著正式庫憑證的 dev server)。
#    🔴 而【000 有兩個成因,而它們印同一個數字】:上面只 `sleep 15`,next 冷啟超過 15 秒時
#       curl 也回 000。⇒ **分流靠 `next.log` 裡有沒有那句話,不靠猜** ——
#       無條件斷言「再等也不會變」會在冷啟慢的那次把人指錯方向(code-reviewer 抓到)。
if [ "${WEB_CODE:-000}" = "000" ]; then
  if grep -q '不是本機' "$S/next.log" 2>/dev/null; then
    {
      echo "🔴 web 回 000,而 next.log 裡有那道閘的訊息 ⇒ dev server 【被停掉了】,不是還沒暖機。"
      echo "     tail -20 $S/next.log"
      echo "   ~~那道閘擋得對:REPO 寫死主樹 ⇒ next dev 一定載入主樹 .env.local~~"
      echo "   🔵 2026-08-29 線I 改:REPO 已改成從腳本位置推 ⇒ 載入的是【你這棵樹】的 .env.local。"
      echo "      ⇒ 在【主樹】跑仍會撞到這道閘(主樹有 .env.local);在沒有 .env* 的 worktree 跑就不會。"
      echo "   正解(把 web 那一層搬到一棵沒有 .env* 的工作樹跑,前面幾層照用這一份):"
      echo "     docs/runbooks/local-admin-with-real-data-probe.md §8-g"
      echo "   🔴 不要用 PCM_ALLOW_PROD_DB_DEV=1、不要動任何 .env*(那是共用工作樹,別的窗在用)。"
    } >&2
  else
    {
      echo "⚠️ web 回 000 —— 兩種可能,先開 log 分辨,不要憑等:"
      echo "     tail -20 $S/next.log"
      echo "   ① 還在編譯(本腳本只等 15 秒)⇒ 過一下再打 curl http://localhost:$WEB/"
      echo "   ② 它已經死了 ⇒ log 裡會有原因;若寫著「指向【不是本機】的資料庫」"
      echo "      ⇒ 走 docs/runbooks/local-admin-with-real-data-probe.md §8-g,"
      echo "        🔴 不要用 PCM_ALLOW_PROD_DB_DEV=1、不要動任何 .env*。"
    } >&2
  fi
fi


# ─────────────────────────────────────────────────────────────────────────────
# 🔴 起站樹與主樹的 HEAD 比對(線D 2026-08-29 規格,線I 落地)。
#    ⚠️ **這一條與 owner.txt 裡那行 `HEAD:` 防的【不是同一件事】**(線D 自己標的):
#      · owner.txt 那行 ⇒ 擋「一開始就拿舊樹起站」
#      · 本段        ⇒ 擋「站起來之後世界前進了」
#    ⇒ 兩條都要。**不要讓其中一條看起來像解。**
#    🔴 印在【最後一行】:前面那一大段輸出會把它捲掉,而這是要人看到的。
MAIN_WT="$(git -C "$REPO" worktree list --porcelain 2>/dev/null | sed -n "1s/^worktree //p")"
HEAD_HERE="$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo unknown)"
HEAD_MAIN="$(git -C "${MAIN_WT:-$REPO}" rev-parse --short HEAD 2>/dev/null || echo unknown)"
# 🔴 線D 2026-08-29 追加的第三格:**印起站時刻**。
#    理由(它的原話):真正咬人的不是「起站時就舊」,是【起站之後主樹前進了】
#    ⇒ 一份交件帶著 hash + 時刻,讀的人才判得出「這份量測涵蓋到哪一顆」。
#    ⚠️ 而 owner.txt 已經有「起於」那一行 —— 這裡再印一次,是因為**這一段是印在螢幕最後一行的**,
#       而 owner.txt 要有人去開才看得到。**兩個載體,不是重複。**
STARTED_AT="$(date "+%Y-%m-%d %H:%M:%S")"
if [ "$HEAD_HERE" != "$HEAD_MAIN" ]; then
  {
    echo "🔴 本次起站的樹與主樹【HEAD 不同】——"
    echo "     這棵($REPO)      = $HEAD_HERE"
    echo "     主樹(${MAIN_WT:-$REPO}) = $HEAD_MAIN"
    echo "   ⇒ 你量到的東西是【這棵樹】的,不是主樹的。要拿去下結論前先確認你要的是哪一棵。"
    echo "   起站時刻:$STARTED_AT —— 這之後主樹若前進,本次量測不涵蓋。"
  } >&2
else
  echo "✅ 起站樹與主樹 HEAD 相同($HEAD_HERE)—— 這一格【有比過】,不是沒印就沒事。起站時刻:$STARTED_AT" >&2
fi

# ══ 收尾閘:這條鏈的每一段【真的在聽嗎】 ═══════════════════════════════════════
# 🔴🔴 **形狀抄 `admin-probe/up.sh` 的同名段(2026-09-04 線 `-ship` 在那支上實撞後加的)**:
#    那一次 `up` 回 **rc=0**,而 `proxy.log` 裡是 `OSError: [Errno 48] Address already in use`
#    ⇒ **proxy 根本沒起來**,而之後讀到的每一個畫面都是【無效量測】而**看起來完全正常**。
# 🔴 **而本支腳本【當時沒有撞到】—— 那不是它沒問題**:
#    同一夜我用了它四次而剛好沒有人跟我搶埠。
#    📌 **⇒ 一個靠運氣沒發生的失效, 與一個不會發生的失效, 在使用紀錄上長得一樣。**
#    ⇒ 而六個窗同時在跑 ⇒ **搶埠的機率只會升不會降。**
# 🔴 **而起之前那道前置閘擋不住這個** —— 它問的是「起之前埠空著嗎」,
#    而檢查完到綁埠之間有時間差。**檢查那一刻是誠實的。**
#    ⇒ ✅ **判準要換成「起完之後它真的在聽」。**
# 🛑 **而這一段刻意【不 exit 1】** —— 有些片(純看版面)在 proxy 死掉時仍然做得下去,
#    而把它們一起擋掉會讓人**想繞過這道閘**。紅的那幾格由人判要不要往下做。
echo
_LISTEN_BAD=0
for _p in "$WEB" "$PROXY" "$PREST" "$CORS" "$PG"; do
  # 🔴 `[.*]` 是刻意的:綁 127.0.0.1 印成 `127.0.0.1.3040`,綁全介面印成 `*.3989`
  #    ⇒ 只認 `\.` 會漏掉後者。
  _n=$(netstat -an -p tcp 2>/dev/null | grep LISTEN | grep -c "[.*]$_p " || true)
  if [ "${_n:-0}" = "0" ]; then
    echo "🔴 埠 $_p **沒有人在聽** —— 這條鏈少了一段。" >&2
    _LISTEN_BAD=1
  fi
done
# 🔴 **`grep -c` 印 0 的時候 rc=1** —— 而本檔是 `set -euo pipefail`
#    ⇒ 少了那個 or-true 的兜底, **這道閘會在「一切正常」時把整支腳本殺掉**
#    (2026-09-04 在 admin 那支實撞:up 回 rc=1、而閘一個字都沒印)
#    📌 **⇒ 一道守門死在它自己要守的那個綠上。**
_E48=$( { grep -c "Address already in use" "$S"/*.log 2>/dev/null || true; } \
        | awk -F: '{s+=$NF} END {print s+0}' )
if [ "${_E48:-0}" != "0" ]; then
  echo "🔴 log 裡有 $_E48 次 \`Address already in use\` ⇒ **有東西沒搶到埠**。" >&2
  _LISTEN_BAD=1
fi
if [ "$_LISTEN_BAD" = "0" ]; then
  echo "🟢 收尾閘:$WEB / $PROXY / $PREST / $CORS / $PG **五個都在聽**,且 log 零 \`Address already in use\`。" >&2
else
  {
    echo "🛑 **上面那幾格是紅的 ⇒ 這台鑽機【只有一部分起來了】。**"
    echo "   🔴 **而這支腳本仍然會回 rc=0** —— 那不是漏洞,是刻意:紅的那幾格由你判要不要往下做。"
    echo "   ⇒ 🎯 **而【rc=0】不代表起來了。** 換一組埠重跑(env.sh 那五個都可覆寫):"
    echo "        STOREFRONT_PROBE_DIR=/tmp/pcm-g3-probe-b STOREFRONT_PROBE_WEB=3041 \\"
    echo "        STOREFRONT_PROBE_PROXY=3898 STOREFRONT_PROBE_PREST=3899 \\"
    echo "        STOREFRONT_PROBE_CORS=3997 STOREFRONT_PROBE_PG=55654 \\"
    echo "          bash scripts/storefront-probe/up.sh"
  } >&2
fi