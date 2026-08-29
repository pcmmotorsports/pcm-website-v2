#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# 證明「當客人去讀一發」這個做法【會紅】—— 兩個世界,一個該紅一個該綠
#
# 🛑 為什麼需要這支:一支【沒有紅過的工具】與一支【壞掉的工具】,長得一樣。
#    scripts/probe-schema-exposure.sh 檔頭逐字「本檔【從來沒有對正式站跑過】」
#    ⇒ 「它寫好了」與「它跑得動」是兩個宣稱。本檔只證後者,而且是在拋棄式庫上。
#
# 做法:拋棄式 PG + PostgREST,建兩張表 ——
#    open_table   GRANT SELECT TO anon  ⇒ 探針【必須】看到它(該紅)
#    closed_table 不 GRANT              ⇒ 探針【必須】看不到(該綠)
#    ⇒ 只有兩發都符合,才叫「這把尺有判別力」。
#
# 🔴 射程(每次都印):
#    · 本檔在【拋棄式本機庫】跑;它證不出正式站的行為
#    · PostgREST 版本與設定與正式站不同 ⇒ 這裡綠不代表那裡綠
#    · 它只量【HTTP 讀得到嗎】,不量「為什麼讀得到」—— 那正是這個做法的重點
# 🛑 負對照的字面【不准離開這支檔】
#    本檔的負對照用的是現造字面 zzz_never_exists_e9,而它必須【只存在於這支檔裡】。
#    🔴 一旦它被寫進 commit body / plan / 板子 / 任何會被掃描的檔,
#       那個負對照就開始命中【它自己被記錄的那一筆】⇒ 分母被自己汙染。
#    📎 實錘(-1c 2026-08-30):它的 selftest 判準是「某字面第一輪必須五段全零」,
#       而那一片的 commit 訊息裡就寫著那個字面 ⇒ 第①段從此必定命中。
#    📌 一個測資,被寫進了它自己的分母 —— 而寫它進去的正是那一片的 commit。
#    ⚠️ 它那次壞掉的方式是【紅】,所以還算幸運;同族另一種是【安靜地變綠】。
#
# 用法: bash scripts/anon-reachability-probe-verify.sh
# ══════════════════════════════════════════════════════════════════════════════
set -u

# 🔴 `export` 而不是只給 initdb 加前綴:postmaster 啟動時也要看到它,
#    否則 `FATAL: postmaster became multithreaded during startup`。
#    📌 這一句【逐字抄自 scripts/admin-probe/up.sh:43】,而那裡還寫著「顧客站那支實際踩過」
#    ⇒ 我是第三個踩的,而答案在 repo 裡躺了很久 —— 我沒有先讀它。
export LC_ALL=C LANG=C

S=$(mktemp -d "${TMPDIR:-/tmp}/anonreach.XXXXXXXX")
PG=54399
PR=54398
PASS=0; FAIL=0

say() { printf '%s\n' "$*"; }
ok()  { PASS=$((PASS+1)); printf '  ✅ %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf '  🔴 %s\n' "$*"; }

KEEP=0
cleanup() {
  [ -n "${PRPID:-}" ] && kill "$PRPID" 2>/dev/null
  pg_ctl -D "$S/pg" stop -m immediate > /dev/null 2>&1
  # 🔴 非零退出【不刪】—— 否則證據跟著失敗一起消失(我第一發就踩到:
  #    ENV-FAIL 印了 log 路徑,而 trap 已經把那個目錄刪了)。
  if [ "$KEEP" = "1" ]; then printf '🛑 非綠 ⇒ log 保留在 %s\n' "$S"; else rm -rf "$S"; fi
}
trap cleanup EXIT

say '══ 0. 前置'
for c in initdb pg_ctl psql postgrest curl; do
  command -v "$c" > /dev/null 2>&1 || { say "🔴 缺 $c ⇒ ENV-FAIL(不是紅,是這條鏈起不來)"; KEEP=1; exit 2; }
done
ok "五個執行檔都在"

say '══ 1. 起拋棄式 PG'
initdb -D "$S/pg" -U postgres --auth=trust --encoding=UTF8 --locale=C > "$S/initdb.log" 2>&1
RC=$?
[ "$RC" -eq 0 ] || { say "🔴 initdb rc=$RC ⇒ ENV-FAIL;log 在 $S/initdb.log"; KEEP=1; exit 2; }
pg_ctl -D "$S/pg" -o "-p $PG -k /tmp" -l "$S/pg.log" start > "$S/pgctl.log" 2>&1
RC=$?
[ "$RC" -eq 0 ] || { say "🔴 pg_ctl rc=$RC ⇒ ENV-FAIL;log 在 $S/pg.log"; KEEP=1; exit 2; }
ok "PG 起在 :$PG"

say '══ 2. 建兩個世界'
psql -h /tmp -p "$PG" -U postgres -d postgres -v ON_ERROR_STOP=1 > "$S/seed.log" 2>&1 <<'SQL'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticator LOGIN NOINHERIT;
GRANT anon TO authenticator;
CREATE TABLE public.open_table   (id int primary key, note text);
CREATE TABLE public.closed_table (id int primary key, secret text);
INSERT INTO public.open_table   VALUES (1, 'visible');
INSERT INTO public.closed_table VALUES (1, 'must-not-leak');
GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT ON public.open_table TO anon;

-- 🔴 第三個世界:【ACL 一格不動,而可達性會變】的那一族
--    rls_table 有 GRANT SELECT TO anon,而 RLS 開著且【沒有任何 policy】
--    ⇒ 200 但零列。之後關掉 RLS ⇒ 同一個 ACL,而資料出來了。
--    ⇒ ⇒ 這一發就是「用目錄推論可達性」那八條反例的其中一條，實測版。
CREATE TABLE public.rls_table (id int primary key, payload text);
INSERT INTO public.rls_table VALUES (1, 'rls-guarded-row');
GRANT SELECT ON public.rls_table TO anon;
ALTER TABLE public.rls_table ENABLE ROW LEVEL SECURITY;
SQL
RC=$?
[ "$RC" -eq 0 ] || { say "🔴 seed rc=$RC ⇒ ENV-FAIL;log 在 $S/seed.log"; KEEP=1; exit 2; }
ok "open_table 開給 anon / closed_table 沒開"

say '══ 3. 起 PostgREST'
printf 'db-uri = "postgres://authenticator@/postgres?host=/tmp&port=%s"\ndb-schemas = "public"\ndb-anon-role = "anon"\nserver-port = %s\n' "$PG" "$PR" > "$S/prest.conf"
nohup postgrest "$S/prest.conf" > "$S/prest.log" 2>&1 &
PRPID=$!
n=0
while [ "$n" -lt 40 ]; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PR/" 2>/dev/null)
  [ "$code" = "200" ] && break
  n=$((n+1)); sleep 0.25
done
[ "$code" = "200" ] || { say "🔴 PostgREST 起不來(最後 code=$code)⇒ ENV-FAIL;log 在 $S/prest.log"; KEEP=1; exit 2; }
ok "PostgREST 起在 :$PR"

say '══ 4. 🔴 兩個世界各發一發（這才是本檔的重點）'
OPEN_CODE=$(curl -s -o "$S/open.json"   -w '%{http_code}' "http://127.0.0.1:$PR/open_table?select=id"   2>/dev/null)
CLOSED_CODE=$(curl -s -o "$S/closed.json" -w '%{http_code}' "http://127.0.0.1:$PR/closed_table?select=id" 2>/dev/null)
say "  open_table   HTTP $OPEN_CODE"
say "  closed_table HTTP $CLOSED_CODE"

if [ "$OPEN_CODE" = "200" ]; then ok "該紅的那個【真的被看到】(200)"; else bad "開給 anon 的表卻回 $OPEN_CODE ⇒ 這把尺【叫不出來】"; fi
if [ "$CLOSED_CODE" = "200" ]; then bad "沒開的表卻回 200 ⇒ 這把尺【亂叫】,或 PostgREST 設定錯"; else ok "該綠的那個【看不到】($CLOSED_CODE)"; fi

say '══ 5. 內容也要比，不能只比狀態碼'
if grep -q '"id"' "$S/open.json" 2>/dev/null; then ok "open_table 真的回了資料列"; else bad "open_table 回 200 而沒有資料 ⇒ 200 不等於讀得到"; fi
if grep -q 'must-not-leak' "$S/closed.json" 2>/dev/null; then bad "🔴🔴 closed_table 的內容外洩了"; else ok "closed_table 沒有洩出內容"; fi

say '══ 6.5 🔴 ACL 一格不動，而可達性變了（八條反例的實測版 1/8）'
RLS_ON_CODE=$(curl -s -o "$S/rls_on.json" -w '%{http_code}' "http://127.0.0.1:$PR/rls_table?select=id" 2>/dev/null)
RLS_ON_ROWS=$(grep -c '"id"' "$S/rls_on.json" 2>/dev/null)
say "  RLS 開著   HTTP $RLS_ON_CODE，資料列 $RLS_ON_ROWS"
if [ "$RLS_ON_CODE" = "200" ] && [ "$RLS_ON_ROWS" = "0" ]; then
  ok "RLS 開著 ⇒ 200 而【零列】(這一態不得併進「安全」，表本身是可達的)"
else
  bad "RLS 開著時期待 200+0 列，實得 $RLS_ON_CODE + $RLS_ON_ROWS 列"
fi

psql -h /tmp -p "$PG" -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c 'ALTER TABLE public.rls_table DISABLE ROW LEVEL SECURITY;' > "$S/rlsoff.log" 2>&1
RC=$?
[ "$RC" -eq 0 ] || { say "🔴 關 RLS 失敗 rc=$RC ⇒ ENV-FAIL"; KEEP=1; exit 2; }

RLS_OFF_CODE=$(curl -s -o "$S/rls_off.json" -w '%{http_code}' "http://127.0.0.1:$PR/rls_table?select=id,payload" 2>/dev/null)
say "  RLS 關掉後 HTTP $RLS_OFF_CODE"
if grep -q 'rls-guarded-row' "$S/rls_off.json" 2>/dev/null; then
  ok "🔴 關掉 RLS 之後【資料真的出來了】—— 而 ACL 一格都沒有動"
else
  bad "關掉 RLS 之後仍讀不到 ⇒ 這一發沒有演出那個世界，本格結論作廢"
fi

say '══ 6. 負對照：一張【根本不存在】的表'
GHOST=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PR/zzz_never_exists_e9?select=id" 2>/dev/null)
if [ "$GHOST" = "200" ]; then bad "不存在的表回 200 ⇒ 這把尺什麼都說看得到"; else ok "不存在的表回 $GHOST（不是 200）"; fi

say '══ 7. 🔴 分母:清單怎麼產生，以及【我餵幾條 vs 它試幾張】'
# plan §2 那發 SQL —— 機械來源，不是「我們想得到的那幾張」
LIST=$(psql -h /tmp -p "$PG" -U postgres -d postgres -tA -c \
  "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f') ORDER BY 1;" 2>"$S/list.err")
RC=$?
if [ "$RC" -ne 0 ]; then say "🔴 分母 SQL rc=$RC ⇒ ENV-FAIL;err 在 $S/list.err"; KEEP=1; exit 2; fi

FED=$(printf '%s\n' "$LIST" | grep -c .)
say "  清單（我餵幾條）= $FED"
printf '%s\n' "$LIST" | sed 's/^/    · /'

TRIED=0
while IFS= read -r t; do
  [ -n "$t" ] || continue
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PR/$t?select=*&limit=1" 2>/dev/null)
  crc=$?
  # 🔴 curl 自己失敗（rc≠0 或 000）⇒ 那不是「試過了」，是「沒試成」⇒ 不計入 TRIED
  if [ "$crc" -eq 0 ] && [ "$code" != "000" ]; then
    TRIED=$((TRIED+1))
    say "    $t ⇒ HTTP $code"
  else
    say "    $t ⇒ 🔴 沒試成（curl rc=$crc code=$code）"
  fi
done <<< "$LIST"

say "  試過幾張 = $TRIED"
if [ "$FED" -eq "$TRIED" ]; then ok "餵 $FED 條 = 試 $TRIED 張（鐵則 11 的第四個數）"; else bad "餵 $FED 條而只試 $TRIED 張 ⇒ 少跑了 $((FED-TRIED)) 張，而總數不會告訴你"; fi

say '══ 8. 🔴 突變:餵一條【不存在的表】，它必須【叫】，不准安靜跳過'
GHOST_LIST=$(printf '%s\nzz_not_a_real_table_e9\n' "$LIST")
GFED=$(printf '%s\n' "$GHOST_LIST" | grep -c .)
GTRIED=0; GHOST_SEEN=0
while IFS= read -r t; do
  [ -n "$t" ] || continue
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PR/$t?select=*&limit=1" 2>/dev/null)
  crc=$?
  if [ "$crc" -eq 0 ] && [ "$code" != "000" ]; then
    GTRIED=$((GTRIED+1))
    [ "$code" = "404" ] && GHOST_SEEN=$((GHOST_SEEN+1))
  fi
done <<< "$GHOST_LIST"
say "  餵 $GFED 條（含一條假的）· 試 $GTRIED 張 · 其中 404 有 $GHOST_SEEN 張"
if [ "$GHOST_SEEN" -ge 1 ]; then
  ok "假的那條【被試了而且回 404】⇒ 它不會安靜消失（鐵則 11 那個 vitest 的病，這裡不成立）"
else
  bad "假的那條沒有留下形狀 ⇒ 少跑一張而總計行看不出來"
fi

say ''
say "── 結果: PASS=$PASS FAIL=$FAIL"
say '🛑 射程: 本檔在【拋棄式本機庫】跑 —— 它證明「當客人去讀」這個做法【叫得出來也不亂叫】,'
say '   而它【證不出正式站的行為】。要那一格 ⇒ 需要 Sean 本人授權對正式站跑一發。'
[ "$FAIL" -eq 0 ] || { KEEP=1; exit 1; }
exit 0
