#!/bin/bash
# probe-wallet-idempotency.sh — ⟦b4-WALLETDEDUPE⟧ 的鑽機(可重跑, 會紅)
#
# ══ 它答什麼 ══════════════════════════════════════════════════════════════
# 在**拋棄式 Postgres** 上把 `20260906800000` 真的貼一次, 然後**真的呼叫 RPC**,
# 逐格問「同一筆送兩次, 錢有沒有被扣兩次」。
#
# 🔴🔴 **每一格都要答得出「什麼樣的爛實作會讓這格變紅」** ——
#    codex 審 plan v1 的 #14/#15/#16 打的就是「這一格拔掉實作照樣綠」。
#    ⇒ 每個 ok() 的訊息裡都寫著它殺得掉什麼。
#
# ══ 🛑 它答不出什麼(先講, 免得綠被讀成比它大)═════════════════════════════
# ① **它不驗 app 那一半** —— 表單有沒有真的帶同一個 token 過來, 是
#    `apps/admin/src/lib/customers/wallet-form.test.ts` 與
#    `apps/admin/src/components/shared/admin-form-consumers.test.tsx` 在答。
#    ⇒ 📌 **DB 手填同鍵全綠是【假的安心】**:action 每次自產鍵的話, 這裡照樣全綠而線上照扣兩次。
# ② 這裡的 schema 是**最小重建**, 不是正式庫的全貌(沒有 RLS、沒有其他 FK)。
#    而**餘額 trigger 與 enum 是從正式庫唯讀撈下來的真定義**, 不是我編的。
# ③ 它不證「線上那一支是這一版」—— 那是 migration 自己的前置閘 md5 錨在答。
#
# 用法:bash scripts/probe-wallet-idempotency.sh   ⇒ 全過 rc=0;任一格不如預期 rc=1
export LC_ALL=C LANG=C PGCLIENTENCODING=UTF8
WT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$WT/supabase/migrations/20260716210000_m4a_admin_adjust_wallet_rpc.sql"
MIG="$WT/supabase/migrations/20260906800000_m4b_wallet_adjust_idempotency.sql"
test -f "$SRC" || { echo "🔴 找不到 $SRC"; exit 1; }
test -f "$MIG" || { echo "🔴 找不到 $MIG"; exit 1; }
SP="$(mktemp -d /tmp/walletdedupe.XXXXXX)"
D=""; PORT=""
cleanup() {
  local rc=$?; local dirty=0
  if [ -n "$D" ] && [ -d "$D/data" ]; then
    LC_ALL=C pg_ctl -D "$D/data" stop -m immediate > /dev/null 2>&1 || { echo "🔴 收攤:pg_ctl stop 失敗, 叢集留在 $D"; dirty=1; }
    sleep 1
  fi
  if [ -n "$PORT" ] && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN > /dev/null 2>&1; then
    echo "🔴 收攤:埠 $PORT 仍在監聽, 叢集留在 $D"; dirty=1
  fi
  [ "$dirty" = 0 ] && [ -n "$D" ] && rm -rf "$D"
  rm -rf "$SP"
  [ "$dirty" = 1 ] && exit 2
  exit "$rc"
}
trap cleanup EXIT
FAIL=0
bad() { printf '🔴 FAIL %s\n' "$1"; FAIL=1; }
ok()  { printf '🟢 PASS %s\n' "$1"; }

D=/tmp/pcm-walletdedupe-$$
[ -e "$D" ] && { echo "🔴 $D 已存在"; exit 1; }
read -r PORT _ < <(bash "$WT/scripts/free-port.sh" --two) || { echo "🔴 取不到埠"; exit 1; }
echo "🔵 PG 埠 = $PORT · 叢集 = $D"
mkdir -p "$D"
initdb -U postgres -A trust --encoding=UTF8 --locale=C "$D/data" > "$D/i.log" 2>&1 || { tail -5 "$D/i.log"; exit 1; }
LC_ALL=C pg_ctl -D "$D/data" \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories='' -c check_function_bodies=off" \
  -l "$D/pg.log" start > /dev/null 2>&1 || { tail -6 "$D/pg.log"; exit 1; }
sleep 3
PSQL=(psql -h 127.0.0.1 -p "$PORT" -U postgres -v ON_ERROR_STOP=1)
"${PSQL[@]}" -tAc "select 1" > /dev/null || { tail -6 "$D/pg.log"; exit 1; }

echo "=== 甲-0 角色 + 最小 schema(trigger 與 enum 是正式庫唯讀撈的真定義)==="
for R in service_role authenticated anon; do
  "${PSQL[@]}" -q -c "DO \$r\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='$R') THEN EXECUTE 'CREATE ROLE $R'; END IF; END \$r\$;" > /dev/null 2>&1
done
NR=$("${PSQL[@]}" -tAc "SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('service_role','authenticated','anon')")
[ "$NR" = "3" ] && ok "甲-0 三個角色都在" || bad "甲-0 只建出 $NR 個(期望 3)"

"${PSQL[@]}" -q > "$D/schema.log" 2>&1 <<'SQL'
CREATE TYPE public.wallet_entry_type AS ENUM ('deposit', 'use', 'refund');
CREATE TABLE public.customers (
  user_id uuid PRIMARY KEY,
  wallet_balance integer NOT NULL DEFAULT 0,
  total_deposit  integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.customer_wallet_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_user_id uuid NOT NULL,
  entry_date date NOT NULL DEFAULT (timezone('Asia/Taipei', clock_timestamp()))::date,
  entry_type public.wallet_entry_type NOT NULL,
  amount integer NOT NULL,
  note text NOT NULL DEFAULT '',
  related_order_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor text NOT NULL, action text NOT NULL, target text,
  before jsonb, after jsonb, reason text,
  request_id text NOT NULL, source_app text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- 🔵 逐字取自正式庫 pg_get_functiondef(2026-09-06 唯讀撈)—— **不是我編的**。
CREATE OR REPLACE FUNCTION public.sync_wallet_balance_on_ledger_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.customers
  SET
    wallet_balance = wallet_balance + NEW.amount,
    total_deposit  = total_deposit + (CASE WHEN NEW.entry_type = 'deposit' THEN NEW.amount ELSE 0 END),
    updated_at     = now()
  WHERE user_id = NEW.customer_user_id;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER on_wallet_ledger_inserted
  AFTER INSERT ON public.customer_wallet_ledger
  FOR EACH ROW EXECUTE FUNCTION public.sync_wallet_balance_on_ledger_insert();
SQL
[ $? = 0 ] && ok "甲-0b 最小 schema 建好(含真 trigger)" || { bad "甲-0b schema 失敗"; tail -5 "$D/schema.log"; }

echo "=== 甲-1 裝舊版 RPC(逐字 sed 抽 20260716210000:37-151, 含 COMMENT)==="
# 🔵 **37-151 = 函式 + 它的 `COMMENT`**。
#  ⛔ 第一版抓 37-150 ⇒ COMMENT 被切在中間 ⇒ `syntax error at end of input`。
#  ⛔ 第二版改成 37-148(只到 `$$;`)⇒ 語法對了, **而 COMMENT 根本沒裝**
#     ⇒ 🔴 我量「舊 COMMENT md5」時量到的是 `coalesce(…, '(無)')` 那個**佔位字**的 md5
#       🔬 **而這兩個數不要搞混**(codex 為此打回兩次):
#         · `md5('(無)')` = **`7cc781655c60486b4437b9568614a92a`** ← 這個代表「**沒有 COMMENT**」
#         · 真的舊 COMMENT 錨 = **`c12448e69f8ac5b8a6fd2a8a3adb40a7`** ← 裝了 COMMENT 之後才量得到
#       ⛔ ~~我原本在這裡把 `c12448…` 寫成「佔位字的 md5」~~ —— **寫反了**。
#     ⇒ 📌 **一個代表「沒有」的值, 被我當成「舊的那一版」記下來了。**
#       還原檔照那個錨去比 ⇒ 還原**成功**的時候反而紅。
#  ✅ 現在裝到 151, 這個世界才真的等於「貼之前的正式庫」。
sed -n '37,151p' "$SRC" > "$SP/old.sql"
"${PSQL[@]}" -q -f "$SP/old.sql" > "$D/old.log" 2>&1 || { bad "甲-1 裝舊版失敗"; tail -5 "$D/old.log"; }
GOT=$("${PSQL[@]}" -tAc "SELECT pg_catalog.md5(prosrc) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname='admin_adjust_wallet'")
[ "$GOT" = "ad55861bb449dfc98ae6630dceea546f" ] \
  && ok "甲-1 舊 body md5 = $GOT(與正式庫同一版)" \
  || bad "甲-1 舊 body md5 = $GOT(期望 ad55861bb449dfc98ae6630dceea546f)"

echo "=== 甲-1b 正對照:search_path 沒收緊時, 前置閘③b 必須擋下 ==="
# 🔴 來源檔寫的是 `public, pg_temp`, 而正式庫是空字串 ⇒ 剛裝好的這一支是【舊 search_path】。
#    ⇒ 📌 先在這個世界貼一次(**必須紅在③b**), 再收緊、再貼(必須綠)——
#      兩個世界都演到, 那道閘才不是「反正線上本來就對, 它永遠綠」。
"${PSQL[@]}" -f "$MIG" > "$D/apply0.log" 2>&1; RC=$?
[ "$RC" != 0 ] && grep -q '前置閘③b' "$D/apply0.log" \
  && ok "甲-1b search_path 沒收緊時被前置閘③b 擋下(rc=$RC)" \
  || { bad "甲-1b 沒有紅在③b(rc=$RC)⇒ 那道閘是假的"; grep -oE 'ERROR:.{0,90}' "$D/apply0.log" | head -1; }

echo "   收緊 search_path + 收權(對齊正式庫:20260905110000:171 做過的那件事)"
"${PSQL[@]}" -q -c "ALTER FUNCTION public.admin_adjust_wallet(uuid,text,integer,text,text,text) SET search_path = '';" > "$D/tighten.log" 2>&1
"${PSQL[@]}" -q -c "REVOKE ALL ON FUNCTION public.admin_adjust_wallet(uuid,text,integer,text,text,text) FROM PUBLIC;" >> "$D/tighten.log" 2>&1
"${PSQL[@]}" -q -c "GRANT EXECUTE ON FUNCTION public.admin_adjust_wallet(uuid,text,integer,text,text,text) TO service_role;" >> "$D/tighten.log" 2>&1
GP=$("${PSQL[@]}" -tAc "SELECT pg_catalog.has_function_privilege('service_role','public.admin_adjust_wallet(uuid,text,integer,text,text,text)','EXECUTE')")
GN=$("${PSQL[@]}" -tAc "SELECT pg_catalog.has_function_privilege('anon','public.admin_adjust_wallet(uuid,text,integer,text,text,text)','EXECUTE')")
GC=$("${PSQL[@]}" -tAc "SELECT coalesce(proconfig::text,'(NULL)') FROM pg_catalog.pg_proc WHERE oid='public.admin_adjust_wallet(uuid,text,integer,text,text,text)'::regprocedure")
{ [ "$GP" = "t" ] && [ "$GN" = "f" ] && [ "$GC" = '{"search_path=\"\""}' ]; } \
  && ok "甲-1c 環境對齊正式庫(service_role=t · anon=f · proconfig=$GC)" \
  || { bad "甲-1c 環境沒設好(sr=$GP anon=$GN cfg=$GC)⇒ 下面的紅是環境不是閘"; tail -3 "$D/tighten.log"; }

echo "=== 甲-2 貼本片(前置閘 + 事後斷言真的跑)==="
"${PSQL[@]}" -f "$MIG" > "$D/apply.log" 2>&1; RC=$?
[ "$RC" = 0 ] && ok "甲-2 貼片 rc=0" || { bad "甲-2 貼片 rc=$RC"; grep -oE 'ERROR:.{0,110}' "$D/apply.log" | head -2; }
grep -q '前置閘全過' "$D/apply.log" && ok "甲-2 前置閘那行 NOTICE 印了(證明它真的跑了)" || bad "甲-2 前置閘 NOTICE 沒印"
grep -q '事後斷言全過' "$D/apply.log" && ok "甲-2 事後斷言那行 NOTICE 印了" || bad "甲-2 事後斷言 NOTICE 沒印"

echo "=== 甲-3 重貼一次 —— 必須【紅在前置閘③】(不是安靜地成功)==="
# 🔴 本檔刻意【不用】IF NOT EXISTS(靜態閘①擋, 而它擋得對):那會讓重貼安靜地什麼都不做。
#    ⇒ 重貼的防線是 body md5 錨 —— 貼過一次 md5 就不是 ad55861b… 了。
"${PSQL[@]}" -f "$MIG" > "$D/apply2.log" 2>&1; RC=$?
[ "$RC" != 0 ] && grep -q '前置閘③' "$D/apply2.log" \
  && ok "甲-3 重貼被前置閘③擋下(rc=$RC)⇒ 看得見的紅, 不是安靜的成功" \
  || { bad "甲-3 重貼沒有紅在前置閘③(rc=$RC)"; grep -oE 'ERROR:.{0,90}' "$D/apply2.log" | head -1; }

echo "=== 甲-4 貼完的四個維度都對(body 之外的那三個才是這一格的重點)==="
NCFG=$("${PSQL[@]}" -tAc "SELECT coalesce(proconfig::text,'(NULL)') FROM pg_catalog.pg_proc WHERE oid='public.admin_adjust_wallet(uuid,text,integer,text,text,text)'::regprocedure")
NSEC=$("${PSQL[@]}" -tAc "SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid='public.admin_adjust_wallet(uuid,text,integer,text,text,text)'::regprocedure")
NSR=$("${PSQL[@]}" -tAc "SELECT pg_catalog.has_function_privilege('service_role','public.admin_adjust_wallet(uuid,text,integer,text,text,text)','EXECUTE')")
NAN=$("${PSQL[@]}" -tAc "SELECT pg_catalog.has_function_privilege('anon','public.admin_adjust_wallet(uuid,text,integer,text,text,text)','EXECUTE')")
# 🔴🔴 這一格是為了擋【我自己】:來源檔寫的是 `public, pg_temp`,
#    照抄就會把 20260905110000:171 那道強化打回去 —— **而 body md5 一模一樣, 只比 prosrc 的錨會印綠**。
[ "$NCFG" = '{"search_path=\"\""}' ] && ok "甲-4 search_path 仍是空字串(沒被 CREATE OR REPLACE 洗掉)" || bad "甲-4 proconfig = $NCFG ⇒ 我把 search_path 打回去了"
[ "$NSEC" = "t" ] && ok "甲-4 仍是 SECURITY DEFINER" || bad "甲-4 SECURITY DEFINER 掉了"
[ "$NSR" = "t" ] && [ "$NAN" = "f" ] && ok "甲-4 ACL 沒被洗掉(service_role=t · anon=f)" || bad "甲-4 ACL 變了(sr=$NSR anon=$NAN)"

echo "=== 甲-5 索引【真的是 partial UNIQUE】(逐字比 indexdef)==="
# 🛑 只驗「多筆 NULL 插得進去」是**免費的綠** —— 把整個 UNIQUE 拔掉也會通過那種驗法。
IDEF=$("${PSQL[@]}" -tAc "SELECT indexdef FROM pg_catalog.pg_indexes WHERE schemaname='public' AND tablename='customer_wallet_ledger' AND indexname='customer_wallet_ledger_idempotency_uidx'")
case "$IDEF" in
  *"UNIQUE INDEX"*"WHERE (request_id IS NOT NULL)"*)
    ok "甲-5 indexdef 同時含 UNIQUE 與 partial predicate" ;;
  "") bad "甲-5 找不到那個索引" ;;
  *)  bad "甲-5 indexdef 不對:$IDEF" ;;
esac

echo "=== 乙 行為:真的呼叫 RPC, 問「錢有沒有被扣兩次」==="
# 🔵 讀四個數的小工具:ledger 筆數 / 餘額 / 累積儲值 / 稽核筆數
snap() { "${PSQL[@]}" -tAc "SELECT (SELECT count(*) FROM public.customer_wallet_ledger)||'|'||(SELECT wallet_balance FROM public.customers WHERE user_id='$1')||'|'||(SELECT total_deposit FROM public.customers WHERE user_id='$1')||'|'||(SELECT count(*) FROM public.admin_audit_log)"; }
CUS='aaaaaaaa-1111-2222-3333-444444444444'
T1='11111111-aaaa-bbbb-cccc-000000000001'
T2='11111111-aaaa-bbbb-cccc-000000000002'
T3='11111111-aaaa-bbbb-cccc-000000000003'
"${PSQL[@]}" -q -c "INSERT INTO public.customers (user_id) VALUES ('$CUS');" > /dev/null 2>&1
call() { "${PSQL[@]}" -tAc "SELECT public.admin_adjust_wallet('$CUS','$1',$2,'$3','staff-1','$4')" 2>&1; }

echo "--- 乙-1 同鍵送兩次 ⇒ 只扣一次 ---"
B0=$(snap "$CUS")
R1=$(call deposit 500 '門市儲值' "$T1")
S1=$(snap "$CUS")
R2=$(call deposit 500 '門市儲值' "$T1")
S2=$(snap "$CUS")
[ "$R1" = "ADJUSTED" ] && ok "乙-1 第一發回 ADJUSTED" || bad "乙-1 第一發回 $R1"
[ "$S1" = "1|500|500|1" ] && ok "乙-1 第一發之後:ledger 1 / 餘額 500 / 累積 500 / 稽核 1" || bad "乙-1 第一發之後是 $S1(期望 1|500|500|1)"
# 🔴 這一格殺得掉「拿掉去重」的實作 —— 那時第二發會讓四個數全部再加一次。
[ "$R2" = "DUPLICATE" ] && ok "乙-1 第二發回 DUPLICATE(不是 ADJUSTED)" || bad "乙-1 第二發回 $R2"
[ "$S2" = "$S1" ] && ok "乙-1 第二發之後四個數【一格都沒動】= $S2" || bad "乙-1 第二發把數字動了:$S1 → $S2"

echo "--- 乙-2 不同鍵送兩次 ⇒ 扣兩次(正對照)---"
# 🔵 **這一格的理由訂正**(codex 打回):⛔ ~~「少了它, 永遠回 DUPLICATE 的壞實作會讓乙-1 全綠」~~
#    **不成立** —— 乙-1 已經要求 ledger +1 且餘額變動, 那種壞實作在乙-1 就會紅。
# ✅ 這一格真正在守的是**另一件事**:「**不同**的操作不得被誤擋」——
#    一支把去重寫得太寬(例如只比客人、不比 token)的實作, 乙-1 全綠而這一格會紅。
R3=$(call deposit 500 '門市儲值' "$T2")
S3=$(snap "$CUS")
[ "$R3" = "ADJUSTED" ] && ok "乙-2 不同鍵回 ADJUSTED" || bad "乙-2 不同鍵回 $R3"
[ "$S3" = "2|1000|1000|2" ] && ok "乙-2 四個數各加一次 = $S3" || bad "乙-2 是 $S3(期望 2|1000|1000|2)"

echo "--- 乙-3 同鍵而【內容不同】⇒ RAISE, 且一列都不寫 ---"
# 🔴 這一格殺得掉「只比鍵不比內容」的實作 —— 那時它會回 DUPLICATE,
#    而員工這一次要做的事(扣 600)【根本沒有執行】, 他卻以為做過了。
R4=$(call deposit 600 '門市儲值' "$T1")
S4=$(snap "$CUS")
case "$R4" in
  *"不同內容"*) ok "乙-3 同鍵不同內容 → RAISE(訊息含「不同內容」)" ;;
  *) bad "乙-3 沒有 RAISE, 回的是:$(printf '%s' "$R4" | head -c 80)" ;;
esac
# 🔴🔴 **這一格是 codex 審 diff 逼出來的**:光有 RAISE 不夠 —— app 端要分得出
#    「內容不符」與「一般 DB 錯誤」, 因為那兩者要讓員工做**相反**的動作
#    (前者停下來、後者放心再按一次)。第一版兩者都收斂成 `error` ⇒ 畫面唸「請稍後再試」
#    ⇒ 撞到 mismatch 的員工會**一直按**, 而那條路永遠不會成功。
#  ⇒ 所以要釘住 **SQLSTATE**, 不是訊息字串(訊息會被改、會被翻譯)。
SQLST=$("${PSQL[@]}" -tAc "DO \$t\$ BEGIN PERFORM public.admin_adjust_wallet('$CUS','deposit',600,'門市儲值','staff-1','$T1'); EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'SQLSTATE=%', SQLSTATE; END \$t\$;" 2>&1)
case "$SQLST" in
  *"SQLSTATE=P9W01"*) ok "乙-3b 那個 RAISE 帶專屬 SQLSTATE P9W01(app 分得出它與一般 DB 錯誤)" ;;
  *) bad "乙-3b 沒拿到 P9W01, 拿到:$(printf '%s' "$SQLST" | head -c 90)" ;;
esac
[ "$S4" = "$S3" ] && ok "乙-3 RAISE 之後四個數沒動 = $S4" || bad "乙-3 RAISE 而數字動了:$S3 → $S4"

# 🔴 **只改【備註】的獨立反例**(codex #8):上面那一發改的是金額 ⇒
#    把 RPC 裡比對 `note` 的那一行拔掉, 45 格照樣全綠 ⇒ **備註那一欄零覆蓋**。
#    ⇒ 同鍵、同方向、同金額、**只有備註不同** ⇒ 一樣要 RAISE, 不得回 DUPLICATE。
R4B=$(call deposit 500 '換了備註' "$T1")
case "$R4B" in
  *"不同內容"*) ok "乙-3c 同鍵同金額而【只改備註】→ 一樣 RAISE(備註那一欄有覆蓋)" ;;
  DUPLICATE)    bad "乙-3c 只改備註被當成重送 ⇒ RPC 沒有比對 note" ;;
  *)            bad "乙-3c 回的是:$(printf '%s' "$R4B" | head -c 80)" ;;
esac

echo "--- 乙-4 扣款方向也走同一條路 ---"
R5=$(call use -200 '電話訂單折抵' "$T3")
S5=$(snap "$CUS")
R6=$(call use -200 '電話訂單折抵' "$T3")
S6=$(snap "$CUS")
[ "$R5" = "ADJUSTED" ] && [ "$R6" = "DUPLICATE" ] && ok "乙-4 扣款:第一發 ADJUSTED、第二發 DUPLICATE" || bad "乙-4 扣款回 $R5 / $R6"
# 🔵 total_deposit 只在 deposit 時加 ⇒ 扣款後它不該動(這一格順便盯住 trigger 的語意)
[ "$S5" = "3|800|1000|3" ] && ok "乙-4 扣款後:餘額 800、累積儲值仍 1000(trigger 語意)" || bad "乙-4 扣款後是 $S5(期望 3|800|1000|3)"
[ "$S6" = "$S5" ] && ok "乙-4 扣款重送四個數沒動" || bad "乙-4 扣款重送動了:$S5 → $S6"

echo "--- 乙-5 非 uuid 形狀的 request_id ⇒ RAISE(fail-closed)---"
# 🔴 這一格殺得掉「只驗非空」的實作 —— 非空的隨機字串每次都不同 ⇒ 唯一索引永遠不會撞
#    ⇒ 去重【靜默失效】, 而 migration 貼了、索引建了、三綠全綠。
for BADID in 'req_abc' '11111111-2222-3333-4444' 'x'; do
  RB=$(call deposit 100 '形狀測試' "$BADID")
  case "$RB" in
    *"形狀不是 uuid"*) ok "乙-5 request_id='$BADID' → RAISE" ;;
    *) bad "乙-5 request_id='$BADID' 沒被擋:$(printf '%s' "$RB" | head -c 60)" ;;
  esac
done
S7=$(snap "$CUS")
[ "$S7" = "$S5" ] && ok "乙-5 三發都被擋, 四個數沒動" || bad "乙-5 數字動了:$S5 → $S7"

echo "--- 乙-6 🔴 跨連線同鍵競爭(兩個 session 真的交疊)---"
# 🔴🔴 **這一格被 codex 打回兩次, 兩個問題都是真的**:
#  ⛔ #6 原本「有 ERROR/FATAL 而不含那兩句中文 ⇒ 照印 PASS」
#     ⇒ 第一發成功、第二發**語法錯誤或斷線**, 一樣拿得到 `1|300` 而且全綠。
#  ⛔ #7 兩邊各 `pg_sleep(1)` **不保證交疊** —— 排程成一前一後也會綠, 沒有證明鎖等待。
#  ✅ 改法:①用 **advisory lock 當閘門**強制兩邊在同一時刻進入 RPC(不靠睡眠賭排程)
#          ②**逐 session 收 rc 並斷言它們的形狀**(一個成功一個 DUPLICATE)
#          ③四個數一起比(ledger / 餘額 / 累積儲值 / 稽核), 不只比兩個
TC='22222222-aaaa-bbbb-cccc-000000000001'
CUS2='bbbbbbbb-1111-2222-3333-444444444444'
"${PSQL[@]}" -q -c "INSERT INTO public.customers (user_id) VALUES ('$CUS2');" > /dev/null 2>&1
# 🔵 閘門:主 session 先握住 advisory lock 22 號, 兩個工人都要先等它 ⇒ 放開的瞬間兩邊【同時】起跑。
# 🔴🔴 **閘門被 codex R2 打回一次, 而它對**:
#  ⛔ ~~主 session 握鎖 3 秒然後靠 `pg_sleep` 放開~~ —— 那**沒有確認兩個工人真的在等**。
#     其中一個被排程晚了(在另一個提交之後才起跑)⇒ 兩發變成順序執行, **而這一格照樣全綠**。
#  ✅ 改成:**主動去 `pg_locks` 上數「有幾個在等 22 號鎖」, 數到 2 才放行**;
#     數不到 2 就是這一格**沒有演到它要演的東西** ⇒ 明說, 不要靜靜過關。
GATE=$(mktemp)
( "${PSQL[@]}" -v ON_ERROR_STOP=0 -tAc "SELECT pg_advisory_lock(22); SELECT pg_sleep(30); SELECT pg_advisory_unlock(22);" > "$GATE" 2>&1 ) & GP=$!
GPID=$("${PSQL[@]}" -tAc "SELECT pid FROM pg_catalog.pg_locks WHERE locktype='advisory' AND objid=22 AND granted LIMIT 1" 2>/dev/null)
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [ -n "$GPID" ] && break
  sleep 0.5
  GPID=$("${PSQL[@]}" -tAc "SELECT pid FROM pg_catalog.pg_locks WHERE locktype='advisory' AND objid=22 AND granted LIMIT 1" 2>/dev/null)
done
race_one() { "${PSQL[@]}" -v ON_ERROR_STOP=0 -tAc "SELECT pg_advisory_lock_shared(22); SELECT public.admin_adjust_wallet('$CUS2','deposit',300,'併發','staff-1','$TC');" > "$1" 2>&1; echo "rc=$?" >> "$1"; }
race_one "$D/race-a.log" & PA=$!
race_one "$D/race-b.log" & PB=$!
# 🔴 **等到【真的有兩個在排隊】才放行** —— 這一句就是這一格的判別力來源。
WAITERS=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  WAITERS=$("${PSQL[@]}" -tAc "SELECT count(*) FROM pg_catalog.pg_locks WHERE locktype='advisory' AND objid=22 AND NOT granted" 2>/dev/null)
  [ "$WAITERS" = "2" ] && break
  sleep 0.5
done
[ "$WAITERS" = "2" ] \
  && ok "乙-6 閘門:兩個 worker 都【真的在等】同一把鎖(pg_locks 數到 $WAITERS 個 waiter)⇒ 交疊是量到的, 不是賭排程" \
  || bad "乙-6 閘門只等到 $WAITERS 個 waiter(期望 2)⇒ 這一格沒有演到交疊, 下面的綠不算數"
# 放行:殺掉握鎖那一發(它本來要睡 30 秒)
[ -n "$GPID" ] && "${PSQL[@]}" -tAc "SELECT pg_catalog.pg_terminate_backend($GPID)" > /dev/null 2>&1
wait "$GP" 2>/dev/null; wait "$PA"; wait "$PB"
rm -f "$GATE"
# 🔴 **逐 session 收 rc 與回傳值** —— 不是只看最後的資料狀態。
RA=$(grep -v '^rc=' "$D/race-a.log" | tail -1); RCA=$(grep '^rc=' "$D/race-a.log" | tail -1)
RB=$(grep -v '^rc=' "$D/race-b.log" | tail -1); RCB=$(grep '^rc=' "$D/race-b.log" | tail -1)
# 🔴🔴 **這一格被打回第三次, 而第三次是我【收了 rc 卻沒有斷言它】。**
#  codex R2 餵了一個合成的 session log(`rc=9`)進來 ⇒ 我照樣印
#  「兩個 session 都沒有錯誤(rc: a=rc=9 b=rc=0)」—— **那個 9 就印在我宣稱沒有錯誤的那句話裡。**
#  ⇒ 📌 **把一個值收進變數、印進訊息, 與【拿它做判斷】是三件事**;我做了前兩件。
#  ⇒ ✅ 現在:rc 必須逐一等於 `rc=0`, 而 ERROR/FATAL 是另一道(兩道都要過)。
RCOK=1
[ "$RCA" = "rc=0" ] || { RCOK=0; }
[ "$RCB" = "rc=0" ] || { RCOK=0; }
if [ "$RCOK" != 1 ]; then
  bad "乙-6 有 session 的 rc 不是 0(a=$RCA b=$RCB)⇒ 這一格沒演到它要演的東西"
elif grep -qE 'ERROR|FATAL' "$D/race-a.log" "$D/race-b.log"; then
  bad "乙-6 rc 都是 0 而 log 裡有 ERROR/FATAL ⇒ 兩道尺不一致, 停下來看"
  grep -oE '(ERROR|FATAL):.{0,70}' "$D/race-a.log" "$D/race-b.log" | head -2
else
  ok "乙-6 兩個 session 都乾淨(rc 都是 0, 且 log 無 ERROR/FATAL)"
fi
# 🔴 一個 ADJUSTED、一個 DUPLICATE —— **順序不拘, 而不能兩個都是同一種**
case "$RA|$RB" in
  ADJUSTED\|DUPLICATE|DUPLICATE\|ADJUSTED) ok "乙-6 兩邊回傳恰好是 {ADJUSTED, DUPLICATE}(a=$RA b=$RB)" ;;
  *) bad "乙-6 兩邊回傳是 a=$RA b=$RB(期望一個 ADJUSTED 一個 DUPLICATE)" ;;
esac
# 🔴 四個數一起比(codex #6:只比兩個 ⇒ 累積儲值與稽核被漏掉)
RACE=$("${PSQL[@]}" -tAc "SELECT (SELECT count(*) FROM public.customer_wallet_ledger WHERE customer_user_id='$CUS2')||'|'||(SELECT wallet_balance FROM public.customers WHERE user_id='$CUS2')||'|'||(SELECT total_deposit FROM public.customers WHERE user_id='$CUS2')||'|'||(SELECT count(*) FROM public.admin_audit_log WHERE target LIKE '%$CUS2%')")
[ "$RACE" = "1|300|300|1" ] && ok "乙-6 四個數 = $RACE(ledger 1 / 餘額 300 / 累積 300 / 稽核 1)" || bad "乙-6 四個數 = $RACE(期望 1|300|300|1)"

echo "--- 乙-7 舊列(NULL 鍵)不受影響:partial 的意義 ---"
# 🔴 直插兩列 NULL 鍵 —— 都要成功。
# 🛑 **而這一格【殺不掉】什麼, 要講清楚**(code-reviewer R2 實測打回;本檔檔頭把
#    「每個 ok() 都要答得出它殺得掉什麼」立成合約, 而這一格原本違反了它自己的合約):
#  ⛔ ~~「它殺得掉『把 partial predicate 拿掉、改成普通 UNIQUE』的實作」~~ —— **假的**。
#     🔬 R2 起一座拋棄式 PG 實測:普通(非 partial)複合 UNIQUE 底下, 兩列 NULL 鍵
#        **照樣插得進去**(`INSERT 0 2`)⇒ 這一格在那個突變下**維持綠**。
#     📌 因為 Postgres 唯一索引預設 **`NULLS DISTINCT`** —— 每個 NULL 互不相等。
#  ✅ **真正擋住那個突變的是**:甲-5(`indexdef` 逐字比 UNIQUE + 欄位 + predicate)
#     與 migration 的**事後斷言④**(R2 另一發突變證到:整筆不 COMMIT, rc=3)。
#  ⇒ 🔵 **這一格的作用是【相容性】不是【判別力】**:證明加了那道唯一索引之後,
#     既有的 NULL 鍵舊列**沒有被鎖死**。它答的是「我沒有弄壞舊資料」, 不是「去重有效」。
"${PSQL[@]}" -q -c "INSERT INTO public.customer_wallet_ledger (customer_user_id, entry_type, amount, note) VALUES ('$CUS','deposit',1,'舊列A'),('$CUS','deposit',1,'舊列B');" > "$D/nullrows.log" 2>&1
NN=$("${PSQL[@]}" -tAc "SELECT count(*) FROM public.customer_wallet_ledger WHERE request_id IS NULL")
[ "$NN" = "2" ] && ok "乙-7 兩列 NULL 鍵都插得進去 ⇒ 既有舊列沒被鎖死(相容性;這一格【不】證明去重有效)" || { bad "乙-7 NULL 鍵列數 = $NN(期望 2)"; tail -3 "$D/nullrows.log"; }

echo "--- 乙-8 交易失敗回滾後, 同鍵重送要【成功】(不是被誤擋)---"
# 🔴 這一格殺得掉「把鍵寫在交易外」的實作 —— 那時第一發回滾了而鍵留著 ⇒ 第二發被誤判成重送
#    ⇒ 員工的錢【真的沒扣到】而畫面說「已處理過」。
TR='33333333-aaaa-bbbb-cccc-000000000001'
"${PSQL[@]}" -v ON_ERROR_STOP=0 -tAc "BEGIN; SELECT public.admin_adjust_wallet('$CUS','deposit',700,'會回滾','staff-1','$TR'); ROLLBACK;" > "$D/rb.log" 2>&1
RR=$(call deposit 700 '會回滾' "$TR")
[ "$RR" = "ADJUSTED" ] && ok "乙-8 回滾後同鍵重送 → ADJUSTED(鍵沒有留在交易外)" || bad "乙-8 回滾後重送回 $RR(期望 ADJUSTED)"

echo "--- 乙-9 不同客人用同一把鍵 ⇒ 互不干擾(唯一鍵是【兩欄】)---"
# 🔵 唯一索引是 (customer_user_id, request_id);少了第一欄的話, 甲客人的鍵會擋住乙客人。
# 🔵 T2 在 CUS 上用過(deposit 500 / 門市儲值)⇒ 要演「重送」就得**內容一模一樣**;
#    第一版我這裡寫 50 元 ⇒ 它正確地 RAISE 了「不同內容」, 而那是【乙-3 已經在演的東西】。
RX=$(call deposit 500 '門市儲值' "$T2")
RY=$("${PSQL[@]}" -tAc "SELECT public.admin_adjust_wallet('$CUS2','deposit',500,'門市儲值','staff-1','$T2')" 2>&1)
[ "$RX" = "DUPLICATE" ] && ok "乙-9 同客人同鍵 → DUPLICATE" || bad "乙-9 同客人同鍵回 $RX"
[ "$RY" = "ADJUSTED" ] && ok "乙-9 【不同客人】同一把鍵 → ADJUSTED(不互相擋)" || bad "乙-9 不同客人同鍵回 $RY"

echo "=== 甲-6 兩個突變:證明那道守門真的有咬合力 ==="
# 🔴🔴 **第一版的突變【沒有判別力】, 而鑽機自己告訴我了** ——
#    我當時換成「非 partial 的普通 UNIQUE」, 以為那會讓舊列(NULL 鍵)撞在一起。
#    ⇒ 🔬 實際結果:**第三列 NULL 鍵照樣插得進去。**
#    ⇒ 📌 因為 Postgres 的唯一索引預設 **NULLS DISTINCT** —— 每個 NULL 互不相等。
#    ⇒ 🛑 **所以「舊列不受影響」不是 partial predicate 在保護的, 是 NULL 的性質。**
#       我 plan §4 那句「partial ⇒ 既有列不受影響」**因果寫錯了**, 已訂正。
#    ⇒ ✅ 那 partial 在幹嘛?**它讓 ON CONFLICT 的仲裁者是它** —— 見下面突變①。

echo "--- 突變① 索引【整個拿掉】⇒ RPC 必須執行期炸 ---"
# 🔴🔴 **我在這一格連錯兩次, 兩次都是鑽機糾正我的。留著, 因為錯法比結論有用。**
#
#  ⛔ 第一版:換成「非 partial 的普通 UNIQUE」, 以為舊列(NULL 鍵)會撞
#     ⇒ 🔬 **第三列 NULL 鍵照樣插得進去** —— Postgres 唯一索引預設 **NULLS DISTINCT**。
#  ⛔ 第二版:改問「拿掉 WHERE 之後 ON CONFLICT 會不會找不到仲裁者」
#     ⇒ 🔬 **RPC 照樣回 ADJUSTED** —— 一個【全表】唯一索引**也能**當
#        `ON CONFLICT (…) WHERE …` 的仲裁者(它涵蓋的是超集)。
#
#  ✅ **所以誠實的結論是**:
#     · **扛事的是「那個唯一索引存在」** —— 沒有它, 去重整個不成立。
#     · **partial 那個 predicate 對【行為】沒有咬合力** —— 它是**大小與意圖**:
#       讓 NULL 鍵的舊列不進索引, 並在 `indexdef` 上寫明「這道唯一性只管有鍵的列」。
#     · 🛑 我 plan §4 原本寫「partial ⇒ 既有列不受影響」—— **因果是錯的**,
#       保護舊列的是 **NULL 的性質**(見突變②), 已訂正。
#
#  ⇒ 所以這一格改問**真正扛事的那個東西**:把索引整個拿掉。
"${PSQL[@]}" -q -c "DROP INDEX public.customer_wallet_ledger_idempotency_uidx;" > "$D/mut1.log" 2>&1
TM='44444444-aaaa-bbbb-cccc-000000000001'
RM=$(call deposit 10 '突變一' "$TM")
case "$RM" in
  *"no unique or exclusion constraint"*) ok "突變① 索引拿掉之後 RPC 執行期就炸 ⇒ 那個索引是扛事的(而它只在【真的呼叫】時才問得出來)" ;;
  *) bad "突變① 索引拿掉之後 RPC 還是跑得動(回 $RM)⇒ 去重根本沒有靠它, 我的模型錯了" ;;
esac
# 🔵 建回來(下一格要用)
"${PSQL[@]}" -q -c "CREATE UNIQUE INDEX customer_wallet_ledger_idempotency_uidx ON public.customer_wallet_ledger (customer_user_id, request_id) WHERE request_id IS NOT NULL;" >> "$D/mut1.log" 2>&1

echo "--- 突變② 拔掉 RPC 的【內容比對】⇒ 只改備註的重送必須被錯放 ---"
# 🔴🔴 **這一格換過一次, 而換掉的理由值得留著。**
#  ⛔ 原本的突變是「把索引改成 `NULLS NOT DISTINCT`」, 想證明舊列(NULL 鍵)會撞。
#     🔬 **而收緊判定之後它誠實地報「我沒有判別力」** —— 實得 `INSERT 0 1`:
#        索引建得起來、第三列 NULL 鍵也插得進去。
#     ⇒ 📌 **那個突變從頭到尾就沒有咬合力**, 只是原本的判定「含 error 就算成功」把它蓋住了
#       (codex #11 打的正是這點)。**收緊判定的第一個作用, 是揭穿我自己的假綠。**
#  ✅ 換成打**真正沒有被別的格覆蓋**的那一條:RPC 裡逐欄比對 `note` 的那一行。
#     乙-3 改的是金額、乙-3c 改的是備註 ⇒ 拔掉 note 比對之後, **乙-3c 必須紅**。
MUTFN="$SP/mut-nonote.sql"; ORIGFN="$SP/orig-fn.sql"
# 🔵 先把【現在線上這一版】原樣撈下來當還原用 —— 重貼 migration 是不行的,
#    那會紅在前置閘的 md5 錨(線上已經不是 `ad55861b…` 了)。
"${PSQL[@]}" -tAc "SELECT pg_catalog.pg_get_functiondef('public.admin_adjust_wallet(uuid,text,integer,text,text,text)'::regprocedure)" > "$ORIGFN" 2>/dev/null
printf ';\n' >> "$ORIGFN"
cp "$ORIGFN" "$MUTFN"
# 🔵 `pg_get_functiondef` 會重排空白 ⇒ 用【正則】找那一行, 不逐字比對。
if grep -qE 'v_prior\.note\s+IS\s+DISTINCT\s+FROM\s+v_note' "$MUTFN"; then
  # 🔴 取代完**一定要 assert 真的改到了** —— 沒有 assert 的字串取代 = 沒跑過。
  #    第一版就是逐字比對落空而報「還是 RAISE」, 讓我以為是實作沒拔到。
  python3 - "$MUTFN" <<'PYE'
import io, re, sys
p = sys.argv[1]
s = io.open(p, encoding='utf-8').read()
pat = re.compile(r'\n\s*OR\s+v_prior\.note\s+IS\s+DISTINCT\s+FROM\s+v_note')
assert pat.search(s), '正則沒命中 v_prior.note 那一行 ⇒ 這個突變沒有靶'
s2 = pat.sub('', s, count=1)
assert s2 != s, '取代之後檔案沒有變 ⇒ 這個突變【沒跑過】'
io.open(p, 'w', encoding='utf-8').write(s2)
print('  🔵 突變② 已寫入:拔掉 v_prior.note 那一項')
PYE
  "${PSQL[@]}" -q -f "$MUTFN" > "$D/mut2.log" 2>&1
  RM2=$(call deposit 500 '又換一個備註' "$T1")
  case "$RM2" in
    DUPLICATE) ok "突變② 拔掉 note 比對之後, 只改備註的重送被錯放成 DUPLICATE ⇒ 乙-3c 那一格有判別力" ;;
    *"不同內容"*) bad "突變② 拔掉 note 比對之後【還是】RAISE ⇒ 我沒有真的拔到那一行" ;;
    *) bad "突變② 回的是:$(printf '%s' "$RM2" | head -c 70)" ;;
  esac
  # 🔵 還原成突變前那一版(不是重貼 migration —— 那會紅在前置閘的 md5 錨)
  "${PSQL[@]}" -q -f "$ORIGFN" > /dev/null 2>&1
  RB2=$("${PSQL[@]}" -tAc "SELECT pg_catalog.md5(prosrc) FROM pg_catalog.pg_proc WHERE oid='public.admin_adjust_wallet(uuid,text,integer,text,text,text)'::regprocedure")
  [ "$RB2" = "ae2567393ca47e550ebe501644234d8a" ] && ok "突變② 已還原成本片那一版(md5 對得上)" || bad "突變② 還原後 md5 = $RB2 ⇒ 沒還原乾淨, 後面幾格不可信"
else
  bad "突變② 在線上函式裡找不到 note 比對那一行 ⇒ 突變本身沒有靶"
fi

echo "=== 甲-7 還原檔:跑得動, 而且【四個維度】都真的回去了 ==="
# 🔴 「還原對了」不是一個宣稱, 是四個:body / COMMENT / proconfig / ACL。
#    ⛔ 只比 body md5 的話, 「把 search_path 打回 public, pg_temp」會【印綠】。
RB="$WT/docs/specs/2026-09-06-wallet-idempotency-ROLLBACK.sql"
test -f "$RB" || bad "甲-7 找不到還原檔"
# 🔵 上面突變①②動過索引 ⇒ 先把它復原成本片貼完的樣子, 還原檔才有東西可拆。
"${PSQL[@]}" -q -c "DROP INDEX IF EXISTS public.customer_wallet_ledger_idempotency_uidx;" > /dev/null 2>&1
"${PSQL[@]}" -q -c "CREATE UNIQUE INDEX customer_wallet_ledger_idempotency_uidx ON public.customer_wallet_ledger (customer_user_id, request_id) WHERE request_id IS NOT NULL;" > /dev/null 2>&1
"${PSQL[@]}" -f "$RB" > "$D/rollback.log" 2>&1; RC=$?
[ "$RC" = 0 ] && ok "甲-7 還原檔 rc=0" || { bad "甲-7 還原檔 rc=$RC"; grep -oE 'ERROR:.{0,110}' "$D/rollback.log" | head -2; }
grep -q 'ROLLBACK\] 已回到' "$D/rollback.log" && ok "甲-7 還原的 NOTICE 印了" || bad "甲-7 還原 NOTICE 沒印"
grep -q '冪等鍵將永久消失' "$D/rollback.log" && ok "甲-7 那句「鍵會永久消失」的 WARNING 有印(值班看得到)" || bad "甲-7 沒印那句 WARNING"

RBODY=$("${PSQL[@]}" -tAc "SELECT pg_catalog.md5(prosrc) FROM pg_catalog.pg_proc WHERE oid='public.admin_adjust_wallet(uuid,text,integer,text,text,text)'::regprocedure")
RCFG=$("${PSQL[@]}" -tAc "SELECT coalesce(proconfig::text,'(NULL)') FROM pg_catalog.pg_proc WHERE oid='public.admin_adjust_wallet(uuid,text,integer,text,text,text)'::regprocedure")
RCMT=$("${PSQL[@]}" -tAc "SELECT pg_catalog.md5(coalesce(pg_catalog.obj_description('public.admin_adjust_wallet(uuid,text,integer,text,text,text)'::regprocedure,'pg_proc'),'(無)'))")
RSR=$("${PSQL[@]}" -tAc "SELECT pg_catalog.has_function_privilege('service_role','public.admin_adjust_wallet(uuid,text,integer,text,text,text)','EXECUTE')")
[ "$RBODY" = "ad55861bb449dfc98ae6630dceea546f" ] && ok "甲-7① body 回到舊版" || bad "甲-7① body md5 = $RBODY"
[ "$RCMT" = "c12448e69f8ac5b8a6fd2a8a3adb40a7" ] && ok "甲-7② COMMENT 也回去了(只還原 body 是不夠的)" || bad "甲-7② COMMENT md5 = $RCMT"
# 🔴🔴 這一格是整份還原檔最重要的一格:上面那個 body md5 對, 完全不代表這一格會對。
[ "$RCFG" = '{"search_path=\"\""}' ] && ok "甲-7③ proconfig 仍是空字串(沒把安全強化打回去)" || bad "甲-7③ proconfig = $RCFG ⇒ 打回去了"
[ "$RSR" = "t" ] && ok "甲-7④ ACL 沒被洗掉" || bad "甲-7④ service_role 叫不動了"
RIDX=$("${PSQL[@]}" -tAc "SELECT count(*) FROM pg_catalog.pg_indexes WHERE schemaname='public' AND tablename='customer_wallet_ledger' AND indexname='customer_wallet_ledger_idempotency_uidx'")
RCOL=$("${PSQL[@]}" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='customer_wallet_ledger' AND column_name='request_id'")
[ "$RIDX" = "0" ] && [ "$RCOL" = "0" ] && ok "甲-7⑤ 索引與欄位都不見了" || bad "甲-7⑤ 索引=$RIDX 欄位=$RCOL(都期望 0)"

echo "=== 甲-8 負對照:還原完再貼一次還原 ⇒ 必須紅在前置閘③ ==="
# 🔵 證明那道內容錨不是恆綠的:這時線上是【舊版】, 不是本片貼的那一版。
"${PSQL[@]}" -f "$RB" > "$D/rollback2.log" 2>&1; RC=$?
[ "$RC" != 0 ] && grep -q '還原前置閘③' "$D/rollback2.log" \
  && ok "甲-8 重跑還原被前置閘③擋下 ⇒ 那個內容錨有判別力" \
  || { bad "甲-8 重跑還原沒有紅在③(rc=$RC)"; grep -oE 'ERROR:.{0,90}' "$D/rollback2.log" | head -1; }

echo "──────────────────────────────────────────────"
[ "$FAIL" = 0 ] && echo "🟢 全部斷言通過" || echo "🔴 有斷言不如預期(見上面的 FAIL)"
exit "$FAIL"
