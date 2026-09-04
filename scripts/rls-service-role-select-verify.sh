#!/bin/bash
# 驗 20260904270000 那 40 條 policy 的【形狀真的會讓人讀得到】—— 用替身角色, 不用 service_role。
#
# ═══ 🔴🔴 為什麼要替身 ══════════════════════════════════════════════════════
# 正式庫實測 `pg_roles`:**`service_role` 有 `rolbypassrls = t`**
# ⇒ 拿 service_role 去測「policy 生效了嗎」, **在建了與沒建兩個世界印同一個答案**。
#    一把在兩個世界印同一個東西的尺, 不是尺。
# ⇒ 本支造一個 `pcm_verify_norls`(**NOBYPASSRLS**), 給它與 service_role 相同的表層 GRANT,
#    然後問它:**沒有 policy 時讀不讀得到 / 有 policy 時讀不讀得到**。那才是兩個不同的世界。
#
# ═══ 🛑 天花板(先講, 不要讀成比它強)═════════════════════════════════════════
# ① **拋棄式 PG 不是 Supabase** —— 這裡沒有 `ALTER DEFAULT PRIVILEGES`、沒有 Supabase 的既有授權,
#    所以本支證的是「**這個 policy 形狀會生效**」, **不是**「正式庫貼下去會怎樣」。
# ② 本機世界只有 3 張表, 不是正式庫那 40 張。形狀是【從 migration 抽出來】的同一句,
#    而「那 40 張都會拿到同一個形狀」由 migration 自己的事後斷言⑤ 守(它驗 polqual/polpermissive)。
# ③ 那 36 條真正第一次承重, 是在**下一支拿掉 BYPASSRLS** 的那一刻 —— **本支到不了那個世界。**
#
# 用法:bash scripts/rls-service-role-select-verify.sh
# 出口:0=全綠 / 1=行為不如預期 / 2=ENV-FAIL / 9=建不出暫存目錄
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
M="$REPO/supabase/migrations/20260904270000_m4b_rls_service_role_select_36.sql"
[ -f "$M" ] || { echo "🔴 ENV-FAIL:找不到 $M"; exit 2; }
for _t in initdb pg_ctl psql; do
  command -v "$_t" >/dev/null 2>&1 || { echo "🔴 ENV-FAIL:沒有 $_t ⇒ 這不是量測結果"; exit 2; }
done

D=$(mktemp -d "${TMPDIR:-/tmp}/rlssr.XXXXXXXX") || { echo "🔴 建不出暫存目錄 ⇒ exit 9"; exit 9; }
cleanup(){ [ -n "${PG:-}" ] && pg_ctl -D "$D/pg" stop -m immediate >/dev/null 2>&1; rm -rf "$D"; }
trap cleanup EXIT
trap 'cleanup; exit 1' INT TERM

initdb -U postgres -A trust --encoding=UTF8 --locale=C "$D/pg" > "$D/initdb.log" 2>&1 \
  || { echo "🔴 ENV-FAIL:initdb"; tail -4 "$D/initdb.log"; exit 2; }

# ═══ 🔴🔴 codex R1 must-fix ⑨ —— 這是今晚最危險的一條 ═══════════════════════════
#   第一版寫死 `PG=54397`, 而且 **`pg_ctl start` 的 rc 沒收**。
#   ⇒ 那個埠上若已經有【別人的】PG(另一個窗、或某個服務), 我的 start 失敗而腳本照跑,
#     後面每一發 psql 都連到**那一台**, 然後真的在上面
#     `CREATE ROLE service_role` / `ALTER ROLE service_role BYPASSRLS` / `CREATE TABLE`。
#   🛑 **那就不是拋棄式環境了 —— 它是「在別人的資料庫上動權限」。**
#   📌 而它的失效形狀是**全綠**:那台 PG 本來就跑得動, 每一格都會有合理的答案。
#
#   三道一起上(缺一都還有洞):
#     ① 埠讓作業系統挑, 不寫死  ② `pg_ctl start` 的 rc 當場收
#     ③ 🔴 連上之後【問它是不是我那一台】—— `SHOW data_directory` 必須等於 `$D/pg`
#        ⇒ 這一道才是真的那一道:①② 都可能因為 race 或環境差異而漏掉,
#          而 ③ 直接問「我在跟誰講話」。
PG=""
for _try in 1 2 3 4 5; do
  # 讓 OS 挑一個當下沒人用的高位埠(比寫死或亂數猜安全)
  _cand=$(python3 -c "import socket;s=socket.socket();s.bind(('127.0.0.1',0));print(s.getsockname()[1]);s.close()" 2>/dev/null)
  [ -n "$_cand" ] || { echo "🔴 ENV-FAIL:挑不到埠"; exit 2; }
  LC_ALL=C pg_ctl -D "$D/pg" \
    -o "-p $_cand -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" \
    -l "$D/pg.log" -w start > "$D/pgctl.log" 2>&1
  _rc=$?
  if [ "$_rc" -eq 0 ]; then PG="$_cand"; break; fi
  echo "  (第 $_try 次 pg_ctl start rc=$_rc, 換一個埠再試)"
done
[ -n "$PG" ] || { echo "🔴 ENV-FAIL:pg_ctl start 五次都失敗 ⇒ 這不是量測結果"; tail -6 "$D/pg.log"; exit 2; }

# ③ 🔴 身分驗證:我連到的是不是【我剛起的那一台】
_dd=$(psql -h 127.0.0.1 -p "$PG" -U postgres -tAc 'SHOW data_directory' 2>/dev/null | tail -1 | tr -d ' ')
_want=$(cd "$D/pg" 2>/dev/null && pwd -P)
_got=$(cd "$_dd" 2>/dev/null && pwd -P)
if [ -z "$_got" ] || [ "$_got" != "$_want" ]; then
  echo "🔴 ENV-FAIL:埠 $PG 上那台 PG 的 data_directory 是 [$_dd]"
  echo "   而我起的是 [$_want] ⇒ **我連到的不是我那一台** ⇒ 立刻停, 不在別人的庫上動權限。"
  exit 2
fi
echo "  🟢 連到的是我自己那一台(data_directory 對得上), 埠 $PG"

q(){ psql -h 127.0.0.1 -p $PG -U postgres -tAc "$1" 2>&1; }
# 🔴🔴 `SET ROLE x; SELECT …` 這種多敘述的查詢, psql 會【先印一行 SET】再印結果
#    ⇒ 第一版拿整包去比 "0" ⇒ 永遠不相等 ⇒ 8 格紅了 6 格。
#    🛑 而最該記的不是「少取一行」, 是**那些失敗訊息說了一個具體而完全錯誤的故事**:
#      它印「沒有 policy 時替身竟然讀得到」, 而真相是「我根本沒讀到那個值」。
#      🔬 我單量三種寫法(SET LOCAL / BEGIN+SET LOCAL / SET ROLE)⇒ 三種都對 ⇒ 壞的是比對。
#      📌 **一把壞掉的尺會給出一個可信而錯誤的診斷** —— 我差一點照著它去改 policy 的形狀。
#    ⇒ `qv` = 只取最後一行(值), 給要比數字的格用;`q` 留著給要看整包錯誤訊息的格用。
qv(){ q "$1" | tail -1; }
PASS=0; FAIL=0
ok(){  echo "  ok   $1"; PASS=$((PASS+1)); }
bad(){ echo "  🔴 FAIL $1"; FAIL=$((FAIL+1)); }

# ═══ 🔴🔴 codex R1 must-fix ③ —— 第一版在這裡【手抄】了一份正確的 policy SQL ═══════
#   ⇒ migration 改成錯的形狀(`USING (false)` / `AS RESTRICTIVE`), 本支 8 格照樣全綠。
#   而我在檔頭寫「同一個形狀由 migration 自己的斷言④⑥⑦ 守」——
#   🛑 **而斷言④ 也驗不到內容(codex must-fix ②)⇒ 兩份文件互相背書, 中間是空的。**
#   ✅ 改法:**把形狀從 migration 檔案裡【抽出來】**, 本支跑的就是它真正會執行的那一句。
MIG_SHAPE=$(grep -oE "CREATE POLICY %I ON public\.%I[^']+" "$M" | head -1)
if [ -z "$MIG_SHAPE" ]; then
  echo "🔴 抽不到 migration 的 CREATE POLICY 形狀 ⇒ 這【不是】通過, 是本支的尺沒接上"
  echo "   ⇒ 那一行的字面變了。去看 $M 的 EXECUTE format(...)。"
  exit 2
fi
echo "  🔵 從 migration 抽到的形狀:$MIG_SHAPE"
# 把 %I %I 換成本支的測試對象(第一個 = policy 名, 第二個 = 表名)
mk_policy(){ printf '%s\n' "$MIG_SHAPE" | sed "s/%I/$1/" | sed "s/%I/$2/"; }

# ── 造世界 ────────────────────────────────────────────────────────────────────
#   🔴 替身 pcm_verify_norls 是 service_role 的【成員】而自己 NOBYPASSRLS
#      ⇒ migration 那句 `TO service_role` 會【透過角色繼承】套用到它身上,
#        而它不繞過 RLS ⇒ **可以拿 migration 的原句去測, 不用改寫成別的角色。**
q "CREATE ROLE service_role NOLOGIN;" >/dev/null
q "CREATE ROLE anon NOLOGIN;" >/dev/null
q "CREATE ROLE authenticated NOLOGIN;" >/dev/null
q "CREATE ROLE pcm_verify_norls NOLOGIN NOBYPASSRLS;" >/dev/null
q "GRANT service_role TO pcm_verify_norls;" >/dev/null
q "CREATE TABLE public.t_demo(id int);" >/dev/null
q "INSERT INTO public.t_demo VALUES (1),(2),(3);" >/dev/null
q "ALTER TABLE public.t_demo ENABLE ROW LEVEL SECURITY;" >/dev/null
q "GRANT SELECT ON TABLE public.t_demo TO service_role, anon;" >/dev/null

[ "$(qv "SELECT rolbypassrls FROM pg_roles WHERE rolname='pcm_verify_norls'")" = "f" ] \
  && ok "① 替身 rolbypassrls = f 且是 service_role 的成員(它會受 policy 管)" \
  || bad "① 替身竟然有 BYPASSRLS ⇒ 後面每一格都會恆過"

[ "$(qv "SET LOCAL ROLE pcm_verify_norls; SELECT count(*) FROM public.t_demo")" = "0" ] \
  && ok "② 沒有 policy 時, 替身讀到 0 列(RLS 開 + 零 policy = 全擋)" \
  || bad "② 沒有 policy 時替身竟然讀得到 ⇒ 這個世界沒造出來, 後面那些綠沒有意義"

q "ALTER ROLE service_role BYPASSRLS;" >/dev/null
[ "$(qv "SET LOCAL ROLE service_role; SELECT count(*) FROM public.t_demo")" = "3" ] \
  && ok "③ 🔴 同一張表、同一刻:service_role(BYPASSRLS)讀到 3 列 = 它不看 policy ⇒ 拿它驗 policy 零判別力" \
  || bad "③ 沒重現出 BYPASSRLS 繞過 ⇒ 本支的前提要重查"
q "ALTER ROLE service_role NOBYPASSRLS;" >/dev/null   # 🔴 用完改回去, 不留給後面的格

# ── 🔴 用【migration 真正那一句】建 policy ────────────────────────────────────
q "$(mk_policy t_demo_select_service_role t_demo)" >/dev/null
[ "$(qv "SET LOCAL ROLE pcm_verify_norls; SELECT count(*) FROM public.t_demo")" = "3" ] \
  && ok "④ 用 migration 抽出來的原句建 policy ⇒ 替身讀到 3 列 = **那一句真的會讓人讀得到**" \
  || bad "④ 用 migration 的原句建了 policy 而替身讀不到 ⇒ 那一句的形狀有問題(USING?PERMISSIVE?)"

# ── 🔴 突變:把形狀改成 USING (false) ⇒ 必須翻面 ───────────────────────────────
#   沒有這一格, 格④ 的綠可能只是「它本來就讀得到」。
q "DROP POLICY t_demo_select_service_role ON public.t_demo;" >/dev/null
q "$(printf '%s\n' "$MIG_SHAPE" | sed 's/%I/t_demo_bad/' | sed 's/%I/t_demo/' | sed 's/USING (true)/USING (false)/')" >/dev/null
[ "$(qv "SET LOCAL ROLE pcm_verify_norls; SELECT count(*) FROM public.t_demo")" = "0" ] \
  && ok "⑤ 突變 USING(true)→USING(false) ⇒ 替身回到 0 列 = 格④ 的綠真的來自 USING(true)" \
  || bad "⑤ 改成 USING(false) 而替身還讀得到 ⇒ 格④ 的綠不是那條 policy 給的"

# ── 🔴 第二個突變:RESTRICTIVE ⇒ 也必須翻面(codex 點名的另一種錯形狀)──
q "DROP POLICY t_demo_bad ON public.t_demo;" >/dev/null
q "$(printf '%s\n' "$MIG_SHAPE" | sed 's/%I/t_demo_res/' | sed 's/%I/t_demo/' | sed 's/CREATE POLICY/CREATE POLICY/; s/FOR SELECT/AS RESTRICTIVE FOR SELECT/')" >/dev/null
[ "$(qv "SET LOCAL ROLE pcm_verify_norls; SELECT count(*) FROM public.t_demo")" = "0" ] \
  && ok "⑥ 突變 PERMISSIVE→RESTRICTIVE ⇒ 替身讀 0 列(只有 restrictive 沒有 permissive = 沒有人放行)" \
  || bad "⑥ 只有 RESTRICTIVE policy 而替身竟然讀得到"

# ── 回到正確形狀, 做剩下兩格 ──
q "DROP POLICY t_demo_res ON public.t_demo;" >/dev/null
q "$(mk_policy t_demo_select_service_role t_demo)" >/dev/null

[ "$(qv "SET LOCAL ROLE anon; SELECT count(*) FROM public.t_demo")" = "0" ] \
  && ok "⑦ 負對照:anon 全程 0 列(TO service_role 沒有外溢到別的角色)" \
  || bad "⑦ anon 讀得到 ⇒ 有 policy 外溢"

q "REVOKE SELECT ON TABLE public.t_demo FROM service_role;" >/dev/null
_r=$(q "SET LOCAL ROLE pcm_verify_norls; SELECT count(*) FROM public.t_demo")
case "$_r" in
  *"permission denied"*) ok "⑧ 🔴 policy 在而【表層 GRANT 收掉】⇒ permission denied = 兩道門都要開(那 8 張的那一半)";;
  *) bad "⑧ 收掉 GRANT 之後竟然還讀得到 ⇒ 回傳[$_r]";;
esac

# ═══ 🔴🔴 格⑨⑩:**整支 migration 真的跑一遍**(不只驗形狀)═══════════════════════
#   第一版只驗「那一句 CREATE POLICY 的形狀會生效」——
#   🛑 **而那支 migration 的迴圈、四條事後斷言、回滾產生器, 一行都沒被執行過。**
#   ⇒ 這兩格造一個最小世界, 讓它走【主路徑】與【閘④ 該擋的世界】各一次。
#   ⚠️ 天花板:世界是最小的(3 張表), 不是正式庫那 40 張。它證的是**碼跑得動、斷言會過**,
#      不是「正式庫貼下去會怎樣」。
q "DROP TABLE IF EXISTS public.t_demo CASCADE;" >/dev/null
q "CREATE TABLE public.orders(id int); ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;" >/dev/null
q "CREATE TABLE public.t_a(id int); ALTER TABLE public.t_a ENABLE ROW LEVEL SECURITY;" >/dev/null
q "CREATE TABLE public.t_b(id int); ALTER TABLE public.t_b ENABLE ROW LEVEL SECURITY;" >/dev/null
q "GRANT SELECT ON public.t_b TO service_role;" >/dev/null
q "CREATE TABLE public.payment_webhook_events(id int); ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;" >/dev/null

# ── 格⑨ 負向先跑:**不改常數** ⇒ 閘④ 名單對不上 ⇒ 必須整支中止 ──
#    🔴 先跑這一格, 因為它證的是「閘會擋」;若順序反過來, 主路徑會先把 policy 建好,
#       這一格就變成在一個已經被改過的世界裡測, 而它會因為別的原因通過。
_out=$(psql -h 127.0.0.1 -p "$PG" -U postgres -f "$M" 2>&1)
case "$_out" in
  *"前置閘⑤:目標名單"*) ok "⑨ 閘⑤ 負向:本機世界的名單與正式庫不同 ⇒ 整支中止(名單身分被鎖住了)";;
  *) bad "⑨ 閘⑤ 沒擋下名單不符的世界 ⇒ 它只鎖數量沒鎖身分, 或根本沒跑到";;
esac
[ "$(qv "SELECT count(*) FROM pg_policy")" = "0" ] \
  && ok "⑩ 閘⑤ 擋下之後【零留痕】:一條 policy 都沒建(交易整筆回滾)" \
  || bad "⑩ 閘⑤ 擋下了而還是建出了 policy ⇒ 不是全有全無"

# ── 格⑪:把常數改成本機世界的值 ⇒ 走主路徑 ──
# 🔴 R2 之後 migration 的期望名單不再是 md5 常數, 是一個【逐字名單區塊】
#    ⇒ 本機世界要把那個區塊換成本機那幾張表。換不成 ⇒ 下面 cmp 會抓到。
_n=$(qv "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity AND c.relname <> 'payment_webhook_events'")
qv "SELECT string_agg(c.relname, chr(10) ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity AND c.relname <> 'payment_webhook_events'" > /dev/null
psql -h 127.0.0.1 -p "$PG" -U postgres -tAc "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity AND c.relname <> 'payment_webhook_events' ORDER BY 1" > "$D/local-names.txt"
MIG_SRC="$M" MIG_DST="$D/mig-local.sql" NAMES_FILE="$D/local-names.txt" python3 "$REPO/scripts/rls-swap-expected-block.py"
# 🔴 突變有沒有套上 —— 沒套上的話下一格會在原檔上跑, 而它會紅在錯的理由上
if [ ! -f "$D/mig-local.sql" ]; then
  # 🔴 R3 F9:替換器找不到錨/名單為空時【不寫檔】⇒ 前一版 cmp 對不存在的檔回 2 走 else,
  #    然後 psql 開不到檔印【小寫】error: ⇒ 不匹配 *ERROR* ⇒ 紅在「迴圈可能沒進去」。
  #    **紅是對的, 而故事是錯的。** 先問檔在不在。
  bad "⑪ 產不出本機副本(替換器沒寫出檔:錨找不到, 或本機表名清單是空的)"
elif cmp -s "$M" "$D/mig-local.sql"; then
  bad "⑪ 期望名單區塊沒被替換(副本與原檔逐位元組相同)⇒ 下面那格會測到錯的東西"
else
  _out2=$(psql -h 127.0.0.1 -p "$PG" -U postgres -f "$D/mig-local.sql" 2>&1)
  case "$_out2" in
    *ERROR*) bad "⑪ 主路徑跑不完:$(printf '%s' "$_out2" | grep -a ERROR | head -1)";;
    *"建了 $_n 條 policy"*) ok "⑪ 主路徑實跑:建了 $_n 條 policy, 四條事後斷言全過, COMMIT";;
    *) bad "⑪ 主路徑跑完而沒印出預期的 NOTICE ⇒ 迴圈可能沒進去";;
  esac
fi

# ── 格⑫:建出來的 policy 內容對不對(斷言⑤ 該擋的東西, 這裡從外面再看一次)──
# 🔴 R3 F8:只問「有幾條是壞的」在【一條都沒建】的世界裡也回 0 ⇒ 空的真綠。
#    ⇒ 同時問「總共幾條」, 讓「都對」與「根本沒有」分得開。
_wrong=$(qv "SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid WHERE p.polname LIKE '%_select_service_role' AND (NOT p.polpermissive OR pg_get_expr(p.polqual,p.polrelid) NOT IN ('true','(true)'))")
_total=$(qv "SELECT count(*) FROM pg_policy p WHERE p.polname LIKE '%_select_service_role'")
if [ "$_wrong" = "0" ] && [ "$_total" = "$_n" ]; then
  ok "⑫ 建出來的 $_total 條(= 目標 $_n 張)每一條都是 PERMISSIVE + USING (true)"
elif [ "$_total" != "$_n" ]; then
  bad "⑫ 只有 $_total 條 policy(期望 $_n)⇒ 這不是「都對」, 是沒建齊"
else
  bad "⑫ 有 $_wrong 條 policy 的內容不對"
fi

# ── 格⑬:排除清單上那張, 一條都沒被建 ──
[ "$(qv "SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid WHERE c.relname='payment_webhook_events'")" = "0" ] \
  && ok "⑬ 排除清單上的表:0 條 policy(排除真的有效)" \
  || bad "⑬ 排除清單上的表被建了 policy"

# ── 格⑭:GRANT 只補【本來沒有的】那些(t_b 本來就有 ⇒ 不該被重複算)──
case "$_out2" in
  *"補了 2 張的表層 GRANT"*) ok "⑭ GRANT 前態:3 張目標裡只補了 2 張(t_b 本來就有)⇒ 回滾名單不會多收";;
  *) bad "⑭ GRANT 補的張數不是 2 ⇒ had_grant_before 前態沒抓對";;
esac

# ── 格⑮(codex R2 nit):**回滾產出的 REVOKE 名單**要核, 不只核「補了幾張」──
#   🔴 格⑭ 只看動手時的計數;而回滾那段的 WHERE 若日後寫反(`had_grant_before` 少個 NOT),
#      格⑭ 照樣綠, 而回滾會去 REVOKE 那些【本來就有】的表 ⇒ 收掉不該收的權限。
#   ⇒ 這一格直接讀那份 NOTICE:它必須逐字含 orders 與 t_a, 且【不含】t_b。
case "$_out2" in
  *"REVOKE SELECT ON TABLE public.orders FROM service_role;"*) _r1=1;; *) _r1=0;;
esac
case "$_out2" in
  *"REVOKE SELECT ON TABLE public.t_a FROM service_role;"*) _r2=1;; *) _r2=0;;
esac
case "$_out2" in
  *"REVOKE SELECT ON TABLE public.t_b FROM service_role;"*) _r3=1;; *) _r3=0;;
esac
if [ "$_r1$_r2$_r3" = "110" ]; then
  ok "⑮ 回滾名單:含 orders 與 t_a(本來沒 GRANT), 【不含】t_b(本來就有)⇒ 不會收掉不該收的"
else
  bad "⑮ 回滾名單不對:orders=$_r1 t_a=$_r2 t_b=$_r3(期望 1 1 0)"
fi

# ── 格⑯⑰(R3 F5):**閘⑤ 的 0-branch 目前零覆蓋** ────────────────────────────
#   「重跑安全」寫在檔頭, 而 15 格從來沒有把同一支跑第二次
#   ⇒ 把 0-branch 那整段 IF 刪掉, 15 格照樣全綠。⇒ 這兩格讓那條路被走到。
_out3=$(psql -h 127.0.0.1 -p "$PG" -U postgres -f "$D/mig-local.sql" 2>&1)
case "$_out3" in
  *"本支已套用過"*) ok "⑯ 重跑:第二次跑同一支 ⇒ 目標 0 張、逐張驗過 ⇒ 正常結束(重跑真的安全)";;
  *ERROR*)          bad "⑯ 重跑炸了:$(printf '%s' "$_out3" | grep -a ERROR | head -1)";;
  *)                bad "⑯ 重跑沒印出「本支已套用過」⇒ 0-branch 沒走到";;
esac

# 🔴 而 0-branch 不可以是「目標 0 就放行」—— 造一個【目標 0 而世界壞掉】的世界:
#    把期望名單裡的 t_a 整張刪掉 ⇒ targets 仍是 0(它不在了),
#    而 pcm_rls_expected 裡還有它 ⇒ c.oid IS NULL ⇒ **必須紅**。
q "DROP TABLE public.t_a CASCADE;" >/dev/null
_out4=$(psql -h 127.0.0.1 -p "$PG" -U postgres -f "$D/mig-local.sql" 2>&1)
case "$_out4" in
  *"前置閘⑤:目標 0 張"*) ok "⑰ 0-branch 負向:期望名單裡的表被刪掉 ⇒ 目標仍 0 而【擋下】(不是印「已套用」放行)";;
  *"本支已套用過"*)       bad "⑰ 表被刪掉了而它說「已套用過」⇒ 0-branch 是 fail-open";;
  *)                      bad "⑰ 0-branch 負向沒走到預期分支:$(printf '%s' "$_out4" | grep -aE 'ERROR|NOTICE' | head -1)";;
esac

echo
echo "══ 結果:PASS=$PASS FAIL=$FAIL ══"
echo "🛑 本支證到的是:①那一句 policy 的形狀會生效(而 USING(false) / RESTRICTIVE 會翻面)"
echo "   ②整支 migration 跑得動、四條事後斷言會過、閘⑤ 擋得住名單不符且零留痕。"
echo "🔴 它【證不到】的:正式庫貼下去會怎樣 —— 拋棄式 PG 不是 Supabase(沒有 ALTER DEFAULT"
echo "   PRIVILEGES、沒有既有授權), 而本機世界只有 3 張表不是那 40 張。"
echo "🔴 那 40 條真正第一次承重, 是在【下一支拿掉 BYPASSRLS】的那一刻 —— 本支到不了那個世界。"
[ "$FAIL" -eq 0 ] || exit 1
