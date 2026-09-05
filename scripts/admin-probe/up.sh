#!/usr/bin/env bash
# 後台(admin)拋棄式鑽機 —— 一行起完整鏈,給 Sean 肉眼驗用。
# 2026-08-19 W3 建。形狀抄 `scripts/storefront-probe/up.sh`(顧客站版),**不自己發明一套**。
# 正本 runbook = `docs/runbooks/local-admin-with-real-data-probe.md`(這支是它的可執行版)。
#
#   起  bash scripts/admin-probe/up.sh
#   收  bash scripts/admin-probe/down.sh     <- 逐項 pgrep + 逐埠 lsof 驗死,不看指令回傳
#
# 🔴🔴 **零 secret、不碰任何 `.env*`** —— 自己造一個拋棄式資料庫 + 自簽 JWT。
#    `apps/admin/.env.local` **不存在也不要建它**(施工窗的工作樹本來就沒有)。
#
# 🔴 **綁 127.0.0.1、瀏覽器開 localhost** —— 兩件事,不要合併:
#    · 綁 `-H 127.0.0.1`:`next dev` 預設綁**所有網路介面**,而 `ADMIN_DEV_BYPASS=1` 是免登入
#      ⇒ 不綁的話等於把一個免登入後台對整個區網開著(2026-08-19 G2 實測,詳
#        `docs/design/admin-design-system.md` 檔頭)。
#    · 開 `http://localhost:PORT`:Next 16 dev 只認 `localhost` 這個 Origin,
#      用 `127.0.0.1` 時 HTML/CSS 正常而 **client JS 靜靜地不見**(runbook §9)。
#    ⇒ **綁 127 是為了安全;開 localhost 是為了它能動。** 兩條理由不同,不可互相取代。
#
# 🔴🔴 **自檢的射程(先講,因為它決定你能拿這支腳本說什麼)**:
#    結尾那三格量的是 **curl 拿回來的 HTML**,也就是**伺服器渲染那一層**。
#    ⚠️ **它證不到 client JS 可用** —— runbook `:335` 逐字記著:用 `127.0.0.1` 時
#    「**HTML 正常、CSS 正常,只有 client JS 靜靜地不見**」⇒ 那正是這三格量的東西。
#    ⚠️ 而 Next 的 RSC payload 塞在 `<script>self.__next_f.push(...)` 裡
#    ⇒ **表格根本沒渲染、資料仍在 script 裡**時,單號照樣數得到、數字照樣對得上。
#    ⇒ **「畫面能不能用」只有真的開瀏覽器才算數。** (2026-08-19 W2 審查 F1;那句話原本寫成
#      「這條鏈是活的」—— 而**一個假的宣稱比少一格檢查更糟:它會讓下一個人停止查**。)
#
# 🔴 效度限制照 runbook §5,一條都不放寬。最容易忘的三條:
#    · GRANT 與 BYPASSRLS 是這支腳本自己下的 ⇒ **證不了正式站的權限設定**
#    · auth.users 是骨架、auth.uid() 是替身 ⇒ 任何依賴真 session 的判斷都不算數
#    · 這條鏈**沒有** `/auth/v1` 替身(admin 走 DEV_BYPASS)⇒ **證不了 admin 的登入閘**
#
# 🔴 migration 套不完是常態 —— **判準是「你要用的表在不在」,不是全綠**(runbook §3)。
#
# 🔴🔴 **`FORCE=1` 那條放行路徑【至今沒有人走完】** —— 寫死在這裡,免得下一個人以為它驗過。
#    每一次不驗它的理由都一樣、而且都成立:**走下去會真的 initdb + 起 server + 刪掉一個
#    可能屬於別窗的資料目錄** ⇒ 副作用落在別人身上,不該為了驗它去砸別人。
#    ⇒ 那不是拖延,而它的結果是:**這是一個永遠不會被驗的分支。**
#    ⇒ 要驗它,唯一乾淨的做法是**在一台沒有別窗的機器上**、或先把所有別窗的鑽機都收乾淨再跑。
set -euo pipefail

# 🔴 `export` 而不是只給 initdb 加前綴:postmaster 啟動時也要看到它,
#    否則 `FATAL: postmaster became multithreaded during startup`(顧客站那支實際踩過)。
export LC_ALL=C

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
# 🔴 路徑可覆寫:多窗平行時各自帶一個 `ADMIN_PROBE_DIR`(down.sh 讀同一個變數)。
#    預設值仍是固定路徑 —— 讓 up/down 這一對在【不傳任何東西】時仍配得上;
#    代價由下面那道前置閘擋住,不是靠使用者記得。
SP="$(cd "$(dirname "$0")" && pwd)"
# 🔴 埠與路徑住在 `env.sh`,**up 與 down 讀同一份**(W6 `W6-043` n2;為什麼不能兩邊各寫一份,
#    見那支檔的檔頭 —— 簡短版:各寫一份 ⇒ 收的時候拿預設埠去查 ⇒ 兩層都印「已釋放」而它還活著)。
# shellcheck source=./env.sh
. "$SP/env.sh"
SEC="pcm-admin-probe-throwaway-jwt-secret-at-least-32-chars"

# ── 前置:要用的東西在不在(缺了就明確報錯,不要跑到一半才炸)────────────────
# 🔴 `lsof` 少不得, 而它以前不在這張清單上(2026-08-30 線【客人帳戶區】`-08` 補):
#    下面那道「埠已被佔用」預檢是 `lsof … 2>/dev/null || true` ⇒ **`lsof` 不存在時它回空字串**
#    ⇒ 預檢**安靜地放行**, 而畫面上與「埠是空的」一模一樣。
#    📌 **一道用不存在的工具做的檢查, 它印的是【通過】不是【我不知道】。**
for c in initdb pg_ctl psql postgrest python3 curl lsof; do
  command -v "$c" >/dev/null || { echo "🔴 缺 $c —— 這條鏈起不來。postgrest 用 brew install postgrest"; exit 1; }
done
# 🔴🔴 **這裡原本還有一個【一模一樣的】埠迴圈,已於 2026-08-19 刪掉(W6 `W6-043` M1)。**
#    它先跑、命中就 `exit 1` ⇒ **下面那道帶來歷、帶指引的 busy 閘,在它為之而寫的情境下【到不了】**
#    ⇒ `owner.txt` 的來歷、並行跑法、「要收掉它 ⇒ down.sh」那三行**一次都沒印出來過**。
#    🔴 而它的形狀正是本 repo 記過的那個:**保護確實還在,但擋下它的是【更早那道閘】**
#      ⇒「我驗過前置閘」與「前置閘生效」在這裡印出同一個結果。
#    ⚠️ 刪掉之後**沒有損失 fail-fast**(W6 替我核過順序,我複驗):
#      工具檢查 → **busy 閘** → `$S` 存在閘 → `rm -rf "$S"`
#      ⇒ busy 閘仍然排在任何破壞性動作之前,只是換成會講話的那一道。
# 🔴🔴 **前置閘(2026-08-19 新增)—— 本來這裡是無條件 `rm -rf $S`。**
#    A 窗正在跑,B 窗跑 `up.sh` ⇒ **B 當場砍掉 A 的 datadir,而 A 收不到任何訊息**,
#    它的 postgres 變成一個沒有資料目錄的孤兒。
#    ⇒ **一個被中途拆掉的量測,長得跟一個完成的量測一模一樣。**
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
  for _p in $WEB $PROXY $PREST $PG; do
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
  echo "   要收掉它  ⇒ bash scripts/admin-probe/down.sh" >&2
  echo "   要並行跑  ⇒ 換一組路徑與埠(2026-08-19 起埠也可覆寫,見 env.sh):" >&2
  echo "       ADMIN_PROBE_DIR=/tmp/pcm-admin-probe-b \\" >&2
  echo "       ADMIN_PROBE_PG=55544 ADMIN_PROBE_PREST=3989 ADMIN_PROBE_PROXY=3988 ADMIN_PROBE_WEB=3021 \\" >&2
  echo "         bash scripts/admin-probe/up.sh" >&2
  echo "       🔴 收的時候要帶【同一組】—— 不帶的話 down.sh 會拿預設埠去查," >&2
  echo "          兩層都印「已釋放」而你的鑽機還活著。owner.txt 有記你當初用的那四個埠。" >&2
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
  echo "   看過、確定不要了 ⇒ FORCE=1 bash scripts/admin-probe/up.sh" >&2
  [ "${FORCE:-0}" = "1" ] || exit 1
  echo "   (FORCE=1 ⇒ 照你的意思刪掉重來)" >&2
fi

rm -rf "$S" && mkdir -p "$S"   # 🔴 引號:`${ADMIN_PROBE_DIR:-…}` 只擋空字串,擋不了空白/glob(W6 n3)
{ echo "起於   : $(date '+%Y-%m-%d %H:%M:%S')"
  echo "shell  : pid $$  tty $(tty 2>/dev/null || echo '?')"
  echo "datadir: $S"
  echo "埠     : web $WEB / proxy $PROXY / prest $PREST / pg $PG"
  # 🔴 **這兩行 2026-09-03 線 `-auth` 補** —— 逐字抄自 `scripts/storefront-probe/up.sh` 的同一段, 不自己發明。
  #   成因:本支與 storefront-probe 是**兩支獨立的腳本**(不是同一支的兩個分支),
  #   而那一支一直有這兩行、本支一直沒有 ⇒ **同一個家族產出兩種形狀的 `owner.txt`**。
  #   🎯 **代價是【下一次判孤兒時會缺一格】**:判一台鑽機是不是孤兒的條件之一是
  #     「它的 HEAD 停在幾天前」(線 `-front` 2026-09-02 收掉一台時用的),
  #     而**那個條件在本支起的機器上用不了** —— 因為那一行不存在。
  #   ⚠️ 而 2026-09-03 06:4x 實測到的就是這個:
  #     `/tmp/pcm-admin-probe-db/owner.txt` 缺 REPO/HEAD · `/tmp/pcm-mail-probe/owner.txt` 兩行都有。
  #   🛑 **只加這兩行, 既有欄位一個都沒動** —— 別人的尺在讀它們(`down.sh` 讀埠與 datadir)。
  echo "REPO   : $REPO"
  echo "HEAD   : $(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo unknown)"
} > $S/owner.txt

# ── ① 拋棄式 Postgres ────────────────────────────────────────────────────
# 🔴 `--encoding=UTF8` 少不得:`LC_ALL=C` 會讓 initdb 建成 SQL_ASCII,
#    而 migration 裡的中文 COMMENT 會在一支**不相干的** migration 上炸
#    (`conversion between UTF8 and SQL_ASCII is not supported`)⇒ 很難聯想到 initdb。
# 🔴 `-k /tmp`:unix socket 路徑上限 103 bytes,長路徑會直接開不起來。
initdb -D $S/pg -U postgres --auth=trust --encoding=UTF8 --locale=C > $S/initdb.log 2>&1
pg_ctl -D $S/pg -o "-p $PG -k /tmp" -l $S/pg.log start > $S/pgctl.log 2>&1
sleep 2

# 🔴 **驗「我連上的那顆, 真的是我剛起的那顆」**(2026-08-30 `-08` 補;成因由哨兵 `-22` 轉來:
#    `-eb` 的 codex MF2 在另一支 probe 上抓到同型 —— 埠上若已經有【別的】postgres,
#    腳本會對**不是拋棄式的那顆**套 migration, **而且照樣全綠**)。
# 🔴 為什麼不靠上面那道埠預檢就好:①它依賴 `lsof`(見上一段, 不存在就放行)
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
  echo "   ⇒ 若是別人的 postgres:換一組埠(ADMIN_PROBE_PG=…),或收掉那一份" >&2
  exit 1
fi
echo "✅ pg 身分核對:$PG ⇒ $_got"

# ── ② PCM bootstrap(平台有、本機沒有的)──────────────────────────────────
psql -h 127.0.0.1 -p $PG -U postgres -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE ROLE service_role NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticator LOGIN NOINHERIT;
GRANT anon, authenticated, service_role TO authenticator;
-- 🔴🔴 **BYPASSRLS 要在【套 migration 之前】就給** —— 2026-09-05 `-f3` 量到:
--    原本它寫在 ④(migration 跑完之後)⇒ `20260815020000_m4b_e10_27_d1_admin_audit_log_grant_select.sql`
--    的 D0 閘當場 `ERROR: D0 異常 — service_role 無 BYPASSRLS,而本表已驗為 RLS 啟用`。
-- 📌 它是【Supabase 平台給角色的預設屬性】,不是這支腳本的一道 GRANT
--    ⇒ 它的落點是「造角色」這一格,不是「補權限」那一格。位置就是語意。
-- ⚠️ 而這仍然證不了正式站 —— 見檔頭第 30 行那句(GRANT 與 BYPASSRLS 是本腳本自己下的)。
ALTER ROLE service_role BYPASSRLS;
-- 🔴🔴 **service_role 的【預設權限】也要在套 migration 之前就設好**(2026-09-05 `-auth` 量到)。
--    病灶與 BYPASSRLS 那一條同型, 而它藏得更深:
--    `20260729010000`(D0)`:343` 用 `has_table_privilege('service_role','public.orders','SELECT')` 自檢,
--    而原本那道 GRANT 寫在 ④(**migration 跑完之後**)⇒ D0 跑的當下 service_role 一個權限都沒有
--    ⇒ 逐字 `D0 驗收失敗 — service_role 對 orders 的 SELECT 不見了` ⇒ **D0 整支回捲**
--    ⇒ `orders.legacy_display_id` 沒建 ⇒ 🎯 **兩個月後 `20260905230000` 重建 view 時才炸**
--       (`column o.legacy_display_id does not exist`)⇒ view 少 `tax_total` ⇒ 後台訂單列表載入失敗。
--    📌 **一支 migration 失敗的傷口, 會在【兩個月後的另一支檔】上出現, 而錯誤訊息指的是後面那一支。**
-- 🔵 **形狀抄平台的, 不自己發明**:Supabase 對 `service_role` 的預設權限是 `arwdDxtm`(全開),
--    所以這裡用 `GRANT ALL`;而 `anon` / `authenticated` **刻意不給** ——
--    它們在正式站上是**逐支 migration 明寫**的, 這裡給了會讓那些 REVOKE 斷言失去判別力。
-- ⚠️ 而這仍然證不了正式站(檔頭第 30 行):**這些是本腳本自己下的**。
-- 🔴🔴 **`pcm_readonly` —— 唯讀查證那個角色, 而它【也是平台/人手建的, 不在任何 migration 裡】**
--    (2026-09-05 `-auth`:`20260905230000…:261` 逐字 `role "pcm_readonly" does not exist` ⇒ 那支整支 FAIL
--     ⇒ `admin_order_list_v` 少 `tax_total` 欄 ⇒ 後台訂單列表在鑽機上載入失敗。)
-- 🔬 **形狀是【對正式庫實量】來的, 不是照著猜**(2026-09-05 唯讀查證, `pg_roles`):
--    ```
--      pcm_readonly   rolbypassrls=t  rolcanlogin=t  rolsuper=f  rolinherit=t
--      service_role   rolbypassrls=t  rolcanlogin=f
--      anon           rolbypassrls=f  rolcanlogin=f
--      🟢 正對照 一個編造的角色名 ⇒ 查無(尺會分辨)
--      has_table_privilege('pcm_readonly','public.orders','SELECT') ⇒ true
--    ```
-- 🔴🔴 **而這裡【只造角色, 一個權限都不給】—— 那是量出來的, 不是保守**
--    第一版我照正式庫的**終態**建(`BYPASSRLS` + `GRANT SELECT ON ALL TABLES` + ADP SELECT),
--    當場重跑 ⇒ 🛑 **`ok=271 fail=54` 惡化成 `ok=169 fail=156`, web 起不來**。
--    逐條看那些新紅(apply.log 逐字):
--    ```
--      角色 pcm_readonly 已存在, 而它是 SUPERUSER 或帶 BYPASSRLS ⇒ 那不是唯讀角色, 不對它 GRANT
--      relacl 裡有 owner 以外的 grantee(pcm_readonly)⇒ 零 GRANT 這句話是假的
--      suppliers ACL 異常 — 應仍為 service_role:SELECT:false, 實 [pcm_readonly:SELECT…]
--      E683:postgres 的 public 表預設 ACL 出現 owner/service_role 以外的授權(pcm_readonly=SELECT)
--    ```
--    🎯 **成因**:正式庫的 `pcm_readonly` 是**在整條 migration 鏈跑完【之後】**由另一批
--       grant-readonly SQL 給權限的;而那條鏈上有一整族斷言在問
--       「**這張表除了 owner 與 service_role, 不該有別的 grantee**」。
--    ⇒ 📌 **我把【終態】搬到【起點】, 於是那一族斷言全部變紅 —— 而它們是對的。**
--    ⇒ 📌 **一個「照正式庫的樣子建」的動作, 打壞的正是【驗證那條路怎麼走過來】的那些檢查。**
-- ✅ **所以這裡只做一件事:讓那個角色【存在】**, 好讓引用它的 migration
--    (`20260905230000…:261`)`GRANT … TO pcm_readonly` 有對象。**權限交給鏈自己給。**
-- ⚠️ **也刻意不給 `BYPASSRLS`** —— 上面第一條逐字說了:帶 BYPASSRLS 的話那支會**拒絕**對它 GRANT。
--    (正式庫實量它是 `BYPASSRLS=t` 且 `LOGIN` —— **這裡兩者都不同形, 寫出來不藏。**)
-- 🛑 **fail-open 風險**:任何「問 `pcm_readonly` 讀不讀得到」的斷言,在這台鑽機上量到的是
--    **這條鏈給的**, 不是正式站證明的 ⇒ 兩個方向都不能拿去說正式站(檔頭第 30 行對它一樣成立)。
-- 🔬 **重跑三次的讀數(同一組埠, 2026-09-05 `-auth`)—— 三個世界並排**
--    ```
--      只補 service_role(前一顆)          ok=271 fail=54 · web 200 · 230000 死在「role pcm_readonly 不存在」
--      再照正式庫【終態】建 pcm_readonly    ok=169 fail=156 · web 000 · 🔴 惡化, 見上面那段
--      改成【只造角色、零權限】(本版)      ok=271 fail=54 · web 200 · 230000 死在【第三個】錯誤
--    ```
--    🔴 **230000 仍然不綠, 而第三個錯誤是【結構性的】**:它 `:257` 逐字
--    `IF NOT has_table_privilege('pcm_readonly', v_oid, 'SELECT') THEN RAISE '斷言④失敗…ACL 掉了'`
--    ⇒ 📌 **那支 migration 自己【不 GRANT】, 它【檢查】那個 SELECT 已經在。**
--       而正式庫裡那個 SELECT 是**整條鏈跑完之後**由 grant-readonly 那批 SQL 給的
--    ⇒ 🎯 **它是「對今天為真、放進重播必假」那一族**(同 `a559eb258`), 而**不是**環境缺東西那一族。
--    ⇒ 🛑 **所以 `20260905230000` 在【從零重播】的世界裡【結構上不可能綠】**, 除非
--       ①那批 grant-readonly SQL 也進版控並排在它前面, 或②那道斷言改成「有就檢查, 沒有就跳過」。
--       **兩個都不是這支腳本能決定的**, 而本檔到此為止:`admin_order_list_v` 建得起來(`paid_total` 有),
--       **而 `tax_total` 那一欄在鑽機上拿不到**(當場複量 `tax_total 0 / paid_total 1`)。
CREATE ROLE pcm_readonly NOLOGIN;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;
GRANT USAGE ON SCHEMA public TO service_role, anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
CREATE SCHEMA auth;
-- 🔴 `id` 一欄不夠:`handle_new_auth_user()` trigger 會讀 NEW.email 與 NEW.raw_user_meta_data。
-- 🔴🔴 **2026-08-30 加了兩欄, 而理由不是「補完整」, 是【不補會讓一道安全檢查 fail-open】**:
--    `manual-customer.ts:297` 拿 `getUserById(...).app_metadata` 去判「這個既有帳號是不是我們自己建的」
--    (codex R2 擊破過一次的那條:**未驗 app_metadata ⇒ 搶註者會被當成這張表單的既有客人**)。
--    骨架若沒有 `raw_app_meta_data`, 替身只能回 undefined ⇒ **那道檢查在鑽機上恆過**
--    ⇒ 📌 **一個【少一欄】的骨架, 會讓一道真的安全檢查在這條鏈上永遠印綠。**
-- 🔴 `email` 加 UNIQUE:`createManualCustomer` 的**冪等靠它**(同一個佔位信箱重送 ⇒ 唯一鍵撞到
--    ⇒ 那不是失敗, 是第一發已經建好了)。沒有這個約束, 重送會安靜地建出第二個帳號 ——
--    而那正是那支檔逐字警告「那種帳號**刪不掉**, 而且他之後登入會看不到自己的單」的情境。
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text UNIQUE, raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
                         raw_app_meta_data jsonb DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now());
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA extensions;
-- 🔴🔴 pgcrypto **一定要在 extensions 這個 schema**:少了它(或裝進 public)⇒
--    `extensions.gen_random_bytes(integer) 解析不到` ⇒ 出貨那條路的四支 RPC 一支都不會存在,
--    而錯誤訊息**不會指向這裡**(你會看到一串「前置閘失敗」)。
CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions;
-- 🔴 auth.uid() 要同時吃兩種 GUC:PostgREST 14 起不再設 `request.jwt.claim.sub`
--    (改設 `request.jwt.claims`,JSON)⇒ 只寫舊的會讓它恆為 null,而 HTTP 仍是 200。
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(coalesce(current_setting('request.jwt.claim.sub', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.role', true), '')::text $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
SQL

# ── ③ 套 migration(不要求全綠)────────────────────────────────────────────
ok=0; fail=0
for f in "$REPO"/supabase/migrations/*.sql; do
  if psql -h 127.0.0.1 -p $PG -U postgres -v ON_ERROR_STOP=1 -q -f "$f" >> $S/apply.log 2>&1
  then ok=$((ok+1)); else fail=$((fail+1)); echo "FAIL $f" >> $S/apply.log; fi
done
echo "migration ok=$ok fail=$fail  (判準不是全綠,是你要用的表在不在;失敗清單 grep '^FAIL' $S/apply.log)"

# ── ③-b 把【人手寫的前置閘訊息】印到人正在看的那個畫面上 ────────────────────
# 🔴 成因是量到的(2026-08-30):`20260729010000`(D0)在本鑽機 apply 失敗 ⇒ 那條
#    `orders_display_id_format` CHECK 停在舊版 ⇒ 後來每一筆手動建單都死 `sqlstate 23514`。
#    而**答案在起站當下就印在 `apply.log` 裡了** —— `20260730120100:84` 逐字:
#    「…否則本片 apply 會全綠、但第一筆真結帳會死在 check_violation」。
#    ⇒ 📌 **寫那道閘的人把後來要花一小時找到的東西寫成一句話, 而沒有人讀那個 log。**
#    ⇒ 🔴 **這不是「忘了讀」能修的 —— 上面那行已經寫著「grep '^FAIL' $S/apply.log」,**
#       **而它照樣沒有被走過。一條【要你自己再打一個指令】的路, 等於沒有路。**
#
# 為什麼只挑含中文的那些:generic 的(`relation "cron.job" does not exist`)是本機沒有
# pg_cron 造成的**預期失敗**、runbook §3 已寫;含中文的是**人手寫的前置閘**,
# 它們的作者是刻意在預告「apply 全綠但之後某件事會壞」—— 那才是會咬人的那一種。
# ⚠️ 分類法就是「這一行有沒有 CJK」, 不是語意判斷 ⇒ **一道用英文寫的手寫閘會被漏掉**(已知盲區)。
if [ "$fail" -gt 0 ]; then
  GATES=$(grep -E '^psql:.*ERROR:' "$S/apply.log" 2>/dev/null | grep -E '[一-龥]' || true)
  NGATE=$(printf '%s\n' "$GATES" | grep -c . || true)
  if [ "$NGATE" -gt 0 ]; then
    echo "  🔴 其中 $NGATE 支是【人手寫的前置閘】—— 它們在預告「現在全綠、但之後某件事會壞」:"
    printf '%s\n' "$GATES" | while IFS= read -r line; do
      [ -n "$line" ] || continue
      x=${line#psql:}; f=${x%%:*}; where=${x#*:}; where=${where%%:*}
      rest=${line#*: ERROR:  }
      echo "     · $(basename "$f"):$where"
      echo "       $rest"
    done
    echo "  ⇒ 全文 grep 'ERROR:' $S/apply.log"
  else
    echo "  ✅ $fail 支失敗裡【沒有】人手寫的前置閘(都是本機缺 pg_cron 那類預期失敗)"
    echo "     ⚠️ 這一行的分類法是「該行有沒有中文」⇒ 英文寫的手寫閘會被算進上面那個「預期」"
  fi
fi

# ── ④ service_role 的 GRANT(平台平常幫你做,本機沒有)──────────────────────
# 🔴 少了 BYPASSRLS ⇒ RLS 把結果濾成 0 列,而 **HTTP 仍是 200** ⇒
#    「200 + 0 列」與「真的沒有資料」長得一模一樣。
# 🔴 而 `ALTER ROLE service_role BYPASSRLS` **已經搬到 ② 去了**(它要在 ③ 套 migration 之前)——
#    ~~原本它在本區塊最後一行~~。搬的理由寫在 ② 那幾行,不在這裡重複。
psql -h 127.0.0.1 -p $PG -U postgres -v ON_ERROR_STOP=1 -q <<'SQL'
GRANT USAGE ON SCHEMA public TO service_role, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
SQL

# ── ⑤ 種子(後台要看得到東西,空庫沒有判別力)──────────────────────────────
psql -h 127.0.0.1 -p $PG -U postgres -v ON_ERROR_STOP=1 -q -f "$SP/seed.sql"

# ── ⑥ PostgREST + 前綴代理 ───────────────────────────────────────────────
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
def tok(role):
    h = b64(json.dumps({"alg":"HS256","typ":"JWT"},separators=(",",":")).encode())
    p = b64(json.dumps({"role":role,"iss":"pcm-admin-probe","exp":4102444800},separators=(",",":")).encode())
    return (h+b"."+p+b"."+b64(hmac.new(sec,h+b"."+p,hashlib.sha256).digest())).decode()
print("ANON="+tok("anon"))
print("SERVICE="+tok("service_role"))
PY

cp "$SP/proxy.py" $S/proxy.py
# 🔴 第三個參數 = 拋棄式 PG 的埠 —— 沒帶的話 proxy 裡那兩支 `/auth/v1/admin/users`
#    替身**自動停用**(而不是壞掉):`PG_PORT is None ⇒ _auth 直接回 False ⇒ 照舊轉給 PostgREST`。
#    ⇒ 那是刻意的:少一個參數應該讓它退回舊行為, 不是讓它半開。
nohup python3 $S/proxy.py "$PREST" "$PROXY" "$PG" > $S/proxy.log 2>&1 &
sleep 2

# ── ⑦ 真後台 ─────────────────────────────────────────────────────────────
A=$(grep '^ANON=' $S/jwts.txt | cut -d= -f2-); SR=$(grep '^SERVICE=' $S/jwts.txt | cut -d= -f2-)
cd "$REPO/apps/admin"
ADMIN_DEV_BYPASS=1 \
ADMIN_SESSION_SECRET="$SECRET" \
REFUND_UI_ENABLED="${REFUND_UI_ENABLED:-}" \
AUDIT_UI_ENABLED="${AUDIT_UI_ENABLED:-}" \
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:$PROXY \
NEXT_PUBLIC_SUPABASE_ANON_KEY="$A" \
SUPABASE_SERVICE_ROLE_KEY="$SR" \
nohup npx next dev -p $WEB -H 127.0.0.1 > $S/next.log 2>&1 &
sleep 18

# ── ⑧ 🔴 自檢:證明【這個環境是活的】,不是「腳本跑完了」──────────────────
# 每一格都印一個**兩個世界會不同**的值,而不是一句「OK」。
echo
echo "──────── 自檢(每一格都是量到的值,不是狀態宣稱)────────"
SQL_PRODUCTS=$(psql -h 127.0.0.1 -p $PG -U postgres -tAc 'select count(*) from products')
SQL_ORDERS=$(psql -h 127.0.0.1 -p $PG -U postgres -tAc 'select count(*) from orders')
REST_PRODUCTS=$(curl -s -H "Authorization: Bearer $SR" \
  "http://127.0.0.1:$PROXY/rest/v1/products?select=id" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))' 2>/dev/null || echo ERR)
HTTP_ORDERS=$(curl -s -o $S/orders.html -w '%{http_code}' --max-time 60 "http://localhost:$WEB/orders")

# 🔴 **數【不同的單號】,不要 `grep -c`** —— `grep -c` 數的是**行**,而整頁 HTML 常常是一行
#    ⇒ 六張單會被數成 1。(建這支腳本時真的先寫錯了:印出 1 而實際有 5 張。)
SHOWN=$(grep -o 'PCM-[0-9]\{4\}-[0-9]\{4,\}' $S/orders.html 2>/dev/null | sort -u | wc -l | tr -d ' ')
# 🔴🔴 **這把尺 2026-08-19 換過(W6 `W6-043` M2)—— 舊的量的是【比產品窄的】那個集合。**
#    產品真正下的述詞(`SupabaseOrderAdapter.ts:830-831`):
#        query.or('payment_channel.neq.tappay,payment_status.neq.unpaid')
#    ⇒ 真正被藏起來的是 **`payment_channel = 'tappay'` 且 `payment_status = 'unpaid'`**,
#      **不是所有未付款**。
#    ~~舊寫法 `where payment_status <> 'unpaid'`~~ 在舊種子上答案相同 ——
#    而相同的原因是**一個沒有人寫下來的預設值**:種子沒寫 `payment_channel` ⇒ 全部吃 `DEFAULT 'tappay'`。
#    ⇒ 兩個後果,方向相反:
#      · **假紅**:種子哪天加一列 `bank_transfer` 的未付款單(= 後台要支援的電話單/匯款單),
#        畫面**會顯示它**(對的),而舊尺把它算成不該顯示 ⇒ 自檢紅、訊息卻叫你去查種子。
#      · **假綠(更貴)**:舊尺**分不出**「真述詞」與「退化成只看 payment_status」——
#        兩者在舊種子上輸出一模一樣,而這一格印的是「證明篩選【真的在篩】」。
#    ⇒ 現在種子第 7 列是 `bank_transfer` × `unpaid`(見 `seed.sql`),**它是唯一分得開的那一列**。
SQL_VISIBLE=$(psql -h 127.0.0.1 -p $PG -U postgres -tAc "select count(*) from orders where not (payment_channel = 'tappay' and payment_status = 'unpaid')")
# 🔴 這一格要抓的是**刷卡未付款**那張(= 真的會被藏起來的那一種),不是「隨便一張未付款」。
#    改完之後它與 `bank_transfer × unpaid` 那張**不是同一列** —— 訊息文字也跟著改,見下方。
UNPAID_ID=$(psql -h 127.0.0.1 -p $PG -U postgres -tAc "select display_id from orders where payment_channel = 'tappay' and payment_status = 'unpaid' order by display_id limit 1")
# 🔴🔴 **新增的一格:`bank_transfer × unpaid` 那張【必須出現】。**
#    沒有它,「退化成只看 payment_status」仍然會通過 —— 因為那條退化只會【多藏】、不會少藏,
#    而上面的張數比對在種子剛好對稱時抓不到。**這一格才是把兩把尺分開的那一發。**
BANK_UNPAID_ID=$(psql -h 127.0.0.1 -p $PG -U postgres -tAc "select display_id from orders where payment_channel <> 'tappay' and payment_status = 'unpaid' order by display_id limit 1")

printf "  DB   products=%s  orders=%s(其中非未付款 %s)\n" "$SQL_PRODUCTS" "$SQL_ORDERS" "$SQL_VISIBLE"
printf "  REST products=%s   <- 與上面那個 DB 數字一致才算通\n" "$REST_PRODUCTS"
printf "  HTTP /orders=%s    畫面上不同單號=%s\n" "$HTTP_ORDERS" "$SHOWN"

FAILED=0
[ "$SQL_PRODUCTS" = "$REST_PRODUCTS" ] || { echo "  🔴 REST 與 DB 對不上 ⇒ 多半是 service_role 的 GRANT/BYPASSRLS 沒生效(200+0 列)"; FAILED=1; }
[ "$HTTP_ORDERS" = "200" ] || { echo "  🔴 後台 /orders 不是 200 ⇒ 看 $S/next.log"; FAILED=1; }
# 🔴🔴 **兩個世界要給不同答案,這一格才有判別力**:
#    ① 該出現的**都出現**(數字對得上,而不是「>0 就算過」)
#    ② 該被隱藏的**真的不在**(未付款那張)
#    ⇒ 只驗①的話,「篩選整個壞掉、全部都印出來」也會通過;只驗②的話,空白頁也會通過。
[ "$SHOWN" = "$SQL_VISIBLE" ] || { echo "  🔴 畫面上的單號數($SHOWN)與應顯示數($SQL_VISIBLE)不符 ⇒ 種子沒進去,或查詢層壞了"; FAILED=1; }
if grep -q "$UNPAID_ID" $S/orders.html 2>/dev/null; then
  echo "  🔴 刷卡未付款那張($UNPAID_ID)出現在預設清單上 ⇒ 「預設隱藏刷卡未付款」那道篩選沒生效"
  FAILED=1
else
  printf "  ✅ 刷卡未付款那張(%s)正確地不在預設清單上\n" "$UNPAID_ID"
fi
# 🔴🔴 **這一格與上一格【方向相反】,兩格都在才有判別力**(W6 `W6-043` M2):
#    上一格問「該藏的藏了沒」,這一格問「**不該藏的有沒有被誤藏**」。
#    只有它會在「述詞退化成只看 payment_status」時變紅 —— 那條退化只會多藏、不會少藏。
if [ -z "$BANK_UNPAID_ID" ]; then
  echo "  🔴 種子裡沒有『非刷卡 × 未付款』那一列 ⇒ **這一格沒有判別力**,不要當它通過了"
  FAILED=1
elif grep -q "$BANK_UNPAID_ID" $S/orders.html 2>/dev/null; then
  printf "  ✅ 匯款未付款那張(%s)有出現 <- 這一格證明篩的是【刷卡且未付款】,不是【所有未付款】\n" "$BANK_UNPAID_ID"
else
  echo "  🔴 匯款未付款那張($BANK_UNPAID_ID)被藏起來了 ⇒ 述詞多半退化成只看 payment_status"
  FAILED=1
fi

# ── ⑧b 🔴 簽一張【真的 admin session 票】(2026-08-30 加)──────────────────────────
# 在此之前這台鑽機**任何寫入都做不到**:畫面「沒有權限或登入狀態已失效,…沒有寫入。」+ DB 0 筆。
# 成因見 env.sh 那段(三道閘,ADMIN_DEV_BYPASS 只放寬第②道)。
#
# 🔴 票的形狀【不是我發明的】,逐格對著 `apps/admin/src/lib/session/session.ts` 抄:
#   · cookie 名  `pcm_admin_sess_dev`         (`:181`,非 prod 分支)
#   · 值         `b64url(payloadJSON).b64url(HMAC_SHA256(payloadJSON, key))` (`:418-424`)
#   · 金鑰材料   `v1:<len>:<secret>:<len>:<envTag>`  (`:304-307`;長度前綴是刻意的)
#   · envTag     `local`   (`:263-274`:無 VERCEL_ENV 且 NODE_ENV=development ⇒ 'local')
#   · b64url     無 padding、`+`→`-` `/`→`_`  (`lib/base64url.ts:6-10`)
#   · v:2 + sub  `{kind:'user',staff_id}`   (`:51-53`,`:97-103` sub 必填)
# ⚠️ **票只活 15 分鐘**(`ADMIN_SESSION_MAX_AGE_SEC`,`:193`)—— 那是 Sean `Q-B5b-2=乙` 拍的,
#    不是我選的。過期就重跑本區塊那行 python,或重跑 up.sh。
#    🔴 app 有靜默續期(`/api/session/renew`),而**它要先有一張有效票才續得動** ——
#       修這件事之前那支路由一直回 401,那正是「沒有票」的外顯。
COOKIE_NAME="pcm_admin_sess_dev"
COOKIE_VAL=$(SECRET="$SECRET" STAFF_ID="$STAFF_ID" python3 <<'MINT'
import base64, hashlib, hmac, json, os, time
secret = os.environ["SECRET"]; staff = os.environ["STAFF_ID"]
env_tag = "local"
material = f"v1:{len(secret)}:{secret}:{len(env_tag)}:{env_tag}".encode()
now = int(time.time())
payload = {
    "v": 2, "sid": os.urandom(16).hex(), "iat": now, "sso_at": now,
    "exp": now + 60 * 15,                      # 對齊 ADMIN_SESSION_MAX_AGE_SEC
    "amr": ["pwd"], "auth_time": now,
    "sub": {"kind": "user", "staff_id": staff},
}
# 🔴 separators 去空白:`verifySession` 驗的是【位元組】,而簽名與 payload 是同一份 bytes,
#    所以其實怎麼排都行 —— 但保持穩定輸出讓兩次跑出來的票可比對。
data = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode()
b64 = lambda x: base64.urlsafe_b64encode(x).decode().rstrip("=")
sig = hmac.new(material, data, hashlib.sha256).digest()
print(f"{b64(data)}.{b64(sig)}")
MINT
)
printf '%s\n' "$COOKIE_NAME=$COOKIE_VAL" > "$S/session-cookie.txt"

echo
if [ "$FAILED" = "0" ]; then
  echo "✅ 這份 HTML 裡有正確的資料 —— 上面每一格都拿到真資料。"
  echo
  echo "   ⚠️ 而這個自檢【不證】client JS 可用 —— 它量的是 curl 拿回來的那份 HTML。"
  echo "      Next 的 RSC payload 會塞在 <script>self.__next_f.push(...) 裡 ⇒"
  echo "      **表格沒渲染、資料仍在 script 裡** 時,上面那些數字照樣對得上。"
  echo "      ⇒ 「畫面能不能用」只有【真的開瀏覽器】才算數,見下面那行網址。"
  echo
  echo "   👉 用瀏覽器開:  http://localhost:$WEB/orders"
  echo "      (🔴 一定要 localhost,不要 127.0.0.1 —— 用 127 的話 client JS 會靜靜地不見)"
  echo
  echo "   🔴 要【寫入】(送採購 / 加備註 / 登錄收款…)⇒ 先把這一行貼進瀏覽器 console:"
  echo "        document.cookie='$COOKIE_NAME=$COOKIE_VAL; path=/'"
  echo "      (同一行也存在 $S/session-cookie.txt)"
  echo "      ⚠️ **票 15 分鐘到期**(Sean Q-B5b-2=乙 拍的,不是我們選的)⇒ 過期就重跑 up.sh。"
  echo "      🔴 不貼的話寫入會被擋,而畫面上那句是「沒有權限或登入狀態已失效」——"
  echo "         那句**字面上是對的**,不是 bug:這台鑽機沒有登入流程,票要用手貼。"
  echo
  echo "   ⚠️ 這張票【證不了】的兩件事(照實寫,不要拿鑽機當它們的證據):"
  echo "      · 真登入流程(SSO callback / 報價單那一側)—— 完全沒有走到"
  echo "      · 「非管理者會被擋下」—— 種子那一列是 is_manager=true;要驗擋下要改成 false 再跑一次"
  echo
  echo "   🔌 要驗【被旗標關著】那幾格(板 :433 的 #17 / #27)⇒ 起站時帶旗標:"
  echo "        REFUND_UI_ENABLED=1 AUDIT_UI_ENABLED=1 <你原本那串 env> bash scripts/admin-probe/up.sh"
  echo "      🔴 **預設不帶 = 關著** —— 那是正式站今天的樣子, 不要為了看得到而預設打開。"
  echo "      ⚠️ 兩個都【不是】 NEXT_PUBLIC_* ⇒ 只有 server 讀得到; 側欄那顆是 client,"
  echo "         它靠 layout 傳下去(見 app-sidebar.tsx 檔頭那段量法)。"
  echo ""
  echo "   收攤:  bash scripts/admin-probe/down.sh"

  # ══════════════════════════════════════════════════════════════════════
  # 🔴🔴 **空表清單 —— 印在【最後一行】, 而它是提醒不是閘。**
  #
  # 為什麼存在(2026-09-03 量的):這台機器 **55 張表有 42 張是空的(76%)**。
  #   ⇒ 而那 42 張**沒有被任何人決定過** —— `seed.sql` 全檔零範圍聲明,
  #     它被種過的唯一方式是【有人被卡住之後回頭補一張】
  #     (commit `e7b9aeab` 逐字:「而它擋了那一格**九天**」)。
  #   ⇒ 同一天兩個窗各撞一次:一個撞「料號查無」、一個撞「比價零判別力」
  #     —— 📌 **同一個成因的兩個症狀。**
  #
  # 🎯 **而它要防的那句話是**:
  #    「一台【驗不到】的機器, 與一台【驗過了】的機器,
  #      在報告上都寫『我開了探針走過一次』。」
  #
  # 🛑 **為什麼是提醒不是閘**:探針的用途本來就包含「驗不需要資料的東西」
  #    (版面、文案、錯誤態、旗標)⇒ 擋下來會擋掉正當用途,
  #    而**閘死於誤報遠比死於漏報常見**。
  # 🛑 **為什麼印在最後**:中間那幾行會被捲走, 而人只看最後一畫面。
  # ══════════════════════════════════════════════════════════════════════
  # 🔴🔴 **用【精確計數】不用 `n_live_tup`** —— 後者是**統計估計值**, 由 stats collector 非同步更新。
  #    它今天與精確版**都回 41**(我兩把尺並排量過)—— 🛑 而**兩把尺今天一致, 不代表它們永遠一致**,
  #    而它們**會用不同的方式壞**:估計值在 `DELETE`/`TRUNCATE` 之後可能還留著舊的非零值
  #    ⇒ 📌 那個方向會把一張**空表**印成「有資料」⇒ **警告被靜靜關掉**, 而那正是這一格要防的事。
  #    ⇒ ✅ 這裡是拋棄式小庫, 精確 `count(*)` 的成本可以忽略 ⇒ **不要為了省那個成本收下一個會反向壞的估計值。**
  _EMPTY_Q="select t.relname from pg_stat_user_tables t where t.schemaname='public' and (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', t.schemaname, t.relname), false, true, '')))[1]::text::int = 0"
  _NEMPTY=$(psql -h 127.0.0.1 -p $PG -U postgres -tAc "select count(*) from ($_EMPTY_Q) z;" 2>/dev/null || true)
  _NALL=$(psql -h 127.0.0.1 -p $PG -U postgres -tAc "select count(*) from pg_stat_user_tables where schemaname='public';" 2>/dev/null || true)
  _EMPTY=$(psql -h 127.0.0.1 -p $PG -U postgres -tAc "select string_agg(relname, ' ' order by relname) from ($_EMPTY_Q) z;" 2>/dev/null || true)
  echo
  # 🔴 標籤由【結果】決定, 不無條件印 —— 一句寫死的「以下是空表」在零空表時照樣印。
  if [ -z "$_NEMPTY" ] || [ -z "$_NALL" ]; then
    echo "   ⚠️ **空表清單這一格沒量到**(psql 沒回值)"
    echo "      ⇒ 🔴 那【不是】「沒有空表」, 是**這一格失效了**。兩者不要讀成同一件事。"
  elif [ "$_NEMPTY" = "0" ]; then
    echo "   🟢 這台機器 $_NALL 張表**都有資料** —— 空表清單這一格今天沒有東西要說。"
  else
    echo "   🔴🔴 **這台機器有 $_NEMPTY / $_NALL 張表是空的** ——"
    echo "      🎯 **你要驗的那個東西, 它的表在不在下面這串裡?**"
    echo "         **在 ⇒ 那一發是【零判別力】, 不是【通過】。**"
    echo "         (畫面會印「沒有資料」, 而那與「功能壞了」長得一樣。)"
    echo
    echo "      $_EMPTY"
    echo
    echo "      🔵 要補:寫一支自己的種子(例 scripts/admin-probe/seed-catalog-price-check.sql),"
    echo "         **不要改 seed.sql** —— 它全窗共用, 多幾筆可能動到別片的期望值。"
  fi
else
  echo "🔴 自檢沒過 —— **不要拿這個環境下任何結論**。log 在 $S/"
  exit 1
fi

# ══ 收尾閘:這條鏈的每一段【真的在聽嗎】 ═══════════════════════════════════════
# 🔴🔴 **這一段存在的理由是一次實錘(2026-09-04 線 `-ship`)**:
#    這支腳本回 **rc=0**,而 `proxy.log` 裡是 `OSError: [Errno 48] Address already in use`
#    —— **proxy 根本沒起來**。⇒ 🎯 而那之後讀到的每一個畫面都是【無效量測】,
#    **而它們看起來完全正常**(頁面 200、側欄有數字、空表提示照印)。
# 🔴 **而那一次的前置埠檢查【印了綠】** —— 檢查完到綁埠之間,別窗把那個埠拿走了。
#    📌 **⇒ 檢查與使用之間有時間差,而檢查那一刻是誠實的。**
#    ⇒ ✅ **所以判準不能是「起之前埠空著」,要是「起完之後它真的在聽」。**
# 🛑 **而這一段【不 exit 1】** —— 它印紅、講清楚,而把要不要用交給人:
#    有些片(純看版面)在 proxy 死掉時仍然做得下去,而**把它們一起擋掉會讓人想繞過這道閘**。
echo
_LISTEN_BAD=0
for _p in "$WEB" "$PROXY" "$PREST" "$PG"; do
  # 🔴 `[.*]` 是刻意的:綁 127.0.0.1 印成 `127.0.0.1.3061`,綁全介面印成 `*.3979`
  #    ⇒ 只認 `\.` 會漏掉後者,而**漏掉的方向是「以為它沒起來」**(那個方向會叫,還好)。
  _n=$(netstat -an -p tcp 2>/dev/null | grep LISTEN | grep -c "[.*]$_p " || true)
  if [ "${_n:-0}" = "0" ]; then
    echo "🔴 埠 $_p **沒有人在聽** —— 這條鏈少了一段。"
    _LISTEN_BAD=1
  fi
done
# 🔴 **`grep -c` 印 0 的時候 rc=1** —— 而本檔是 `set -euo pipefail`
#    ⇒ 沒有 `|| true` 的話, **這道閘會在「一切正常」時把整支腳本殺掉**(2026-09-04 實撞:
#    我加完這段, up 回 rc=1 而閘一個字都沒印)⇒ 📌 **一道守門死在它自己要守的那個綠上。**
_E48=$( { grep -c "Address already in use" "$S"/*.log 2>/dev/null || true; } \
        | awk -F: '{s+=$NF} END {print s+0}' )
if [ "${_E48:-0}" != "0" ]; then
  echo "🔴 log 裡有 $_E48 次 \`Address already in use\` ⇒ **有東西沒搶到埠**。"
  _LISTEN_BAD=1
fi
if [ "$_LISTEN_BAD" = "0" ]; then
  echo "🟢 收尾閘:$WEB / $PROXY / $PREST / $PG **四個都在聽**,且 log 零 \`Address already in use\`。"
else
  echo "🛑 **上面那幾格是紅的 ⇒ 這台鑽機【只有一部分起來了】。**"
  echo "   🔴 **而這支腳本仍然會回 rc=0** —— 那不是漏洞,是刻意:紅的那幾格由你判要不要往下做。"
  echo "   ⇒ 🎯 **而【rc=0】不代表起來了。** 換一組埠重跑:"
  echo "        ADMIN_PROBE_WEB=3062 ADMIN_PROBE_PROXY=3892 ADMIN_PROBE_PREST=3893 ADMIN_PROBE_PG=55854 \\"
  echo "          bash scripts/admin-probe/up.sh"
fi
