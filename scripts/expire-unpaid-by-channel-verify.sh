#!/usr/bin/env bash
# expire-unpaid-by-channel-verify.sh
#   在【拋棄式 PG】上驗 `20260903080000_m4b_expire_unpaid_by_payment_channel.sql` 的**行為**。
#
# 🔴 為什麼要有它:那支自己的前置閘與事後斷言驗的是【函式定義裡有沒有那些字面】。
#    **一個字面在, 與它擋不擋得住東西、放不放得過東西, 是兩個宣稱。**
#    這一支問的是行為:**哪幾張單被取消了。**
#
# 🛑🛑 **這支【測不到】什麼 —— 這一段要跟「它測到什麼」一樣顯眼**(code-reviewer 指定):
#   基準線是【從本片的函式體把 CASE 換回單一 interval】得到的 ⇒ **兩版共有的東西一律測不到**。
#   🔴 那一族包含:`cancelled_at IS NULL` 冪等 · `SKIP LOCKED` · `p_limit` fail-safe ·
#     以及**整段結構被拆掉**那種改法(它會 ENV-FAIL rc=2 —— 大聲失敗, 但那不是紅)。
#   ✅ 而錢守門(`NOT EXISTS … attempts`)與心跳**已經補進來了** —— 它們原本也在那一族裡,
#     而它們是這一族裡最貴的兩個。
#
# 🛑 天花板(寫出來, 免得被讀成「這支綠了就沒事」):
#   · 本機拋棄式庫 ⇒ 證不出正式庫(那裡可能有我們不知道的觸發器/RLS/殘留約束)。
#   · 它**不驗** cron 有沒有排、不驗心跳被誰讀。
#   · 世界是我造的最小四表 ⇒ 正式 schema 的其他欄位不在這裡。
#
# 用法:bash scripts/expire-unpaid-by-channel-verify.sh
# 出口:0=全綠 / 1=行為不如預期 / 2=ENV-FAIL(工具或檔案不在)/ 9=建不出暫存目錄
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
M="$REPO/supabase/migrations/20260903080000_m4b_expire_unpaid_by_payment_channel.sql"
[ -f "$M" ] || { echo "🔴 ENV-FAIL:找不到 $M"; exit 2; }
for _t in initdb pg_ctl psql lsof python3; do
  command -v "$_t" >/dev/null 2>&1 || { echo "🔴 ENV-FAIL:沒有 $_t ⇒ 這不是量測結果"; exit 2; }
done
# ⚠️ 而 lsof 對【不屬於自己的】socket 印 0 ⇒「埠是空的」與「我看不到」印同一個東西(N6)。
#    ⇒ 下面那道埠檢查是 best-effort;真的撞到會被 initdb / pg_ctl 接住。

D=$(mktemp -d "${TMPDIR:-/tmp}/eubc.XXXXXXXX") || { echo "🔴 建不出暫存目錄 ⇒ exit 9"; exit 9; }
PG=54393
cleanup(){ pg_ctl -D "$D/pg" stop -m immediate >/dev/null 2>&1; rm -rf "$D"; }
trap cleanup EXIT
lsof -nP -iTCP:$PG -sTCP:LISTEN >/dev/null 2>&1 && { echo "🔴 ENV-FAIL:埠 $PG 被佔"; exit 2; }

initdb -U postgres -A trust --encoding=UTF8 --locale=C "$D/pg" > "$D/initdb.log" 2>&1 || { echo "🔴 ENV-FAIL:initdb"; exit 2; }
LC_ALL=C pg_ctl -D "$D/pg" -o "-p $PG -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" -l "$D/pg.log" start >/dev/null 2>&1
sleep 3
psql -h 127.0.0.1 -p $PG -U postgres -tAc "select 1" >/dev/null 2>&1 || { echo "🔴 ENV-FAIL:PG 起不來"; tail -6 "$D/pg.log"; exit 2; }
q(){ psql -h 127.0.0.1 -p $PG -U postgres -tAc "$1" 2>&1; }
rc=0
check(){ printf '  %-52s 期望 %-6s 實得 %-6s ' "$1" "$2" "$3"; if [ "$2" = "$3" ]; then echo "✅"; else echo "🔴"; rc=1; fi; }

# ── 世界:活函式只碰四樣東西(我從 pg_get_functiondef 抽出來數的)──
psql -h 127.0.0.1 -p $PG -U postgres -v ON_ERROR_STOP=1 -q >"$D/w.log" 2>&1 <<'SQLEOF'
CREATE SCHEMA pcm_cron;
CREATE TYPE public.payment_status AS ENUM ('unpaid','paid','refunded');
CREATE TABLE public.orders (
  id bigserial PRIMARY KEY,
  payment_status public.payment_status NOT NULL,
  -- 🔴 CHECK 要有(code-reviewer N2):少了它, migration 檔頭那句「那個值在 CHECK 裡合法」
  --    在這個世界【不成立】, 而白名單以外的形狀(大小寫/空白/未來新 channel)一格都沒演。
  payment_channel text NOT NULL DEFAULT 'tappay'
    CHECK (payment_channel IN ('tappay','bank_transfer','cash','none')),
  cancelled_at timestamptz, cancelled_reason text,
  -- 🔴 updated_at 不是裝飾:活函式的 UPDATE 會寫它 ⇒ 少了這一欄整支函式在執行期炸,
  --    而**它炸的時候 psql 回的 rc 仍是 0**(我第一版就是這樣, 三格全印「殺了 0 張」
  --    ⇒ 看起來像【那個洞不存在】)⇒ 📌 一個建不完整的世界會給出安慰性的答案。
  --    ⚠️ **而上面那句是【過去式】**(code-reviewer N4)—— 補了這一欄之後, 同樣的世界殘缺
  --      今天會讓「期望 6」「期望 3」那兩格**紅**, 不再是靜靜印 0。
  updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.payment_charge_attempts (
  id bigserial PRIMARY KEY, order_id bigint NOT NULL, status text NOT NULL);
CREATE TABLE public.sweeper_heartbeat (
  job_name text PRIMARY KEY, last_success_at timestamptz,
  consecutive_failures integer DEFAULT 0, updated_at timestamptz);
SQLEOF
[ $? -eq 0 ] || { echo "🔴 ENV-FAIL:建世界失敗"; tail -5 "$D/w.log"; exit 2; }

# ── 基準線:先裝【改之前】那一版(單一 1 day)──
#    🔴 它不是我手打的, 是把本片的函式體把那段 CASE 換回單一 interval 得到的 ⇒ 兩版只差那一處。
python3 - "$M" "$D/base.sql" <<'PYEOF'
import io,sys,re
t=io.open(sys.argv[1],encoding='utf-8').read()
i=t.index('CREATE OR REPLACE FUNCTION pcm_cron.expire_unpaid_orders')
j=t.index('$function$;', i)+len('$function$;')
fn=t[i:j]
old_start=fn.index("       -- 🔴🔴 **2026-09-03 依 payment_channel 分流**")
old_end=fn.index("           END", old_start)+len("           END")
base=fn[:old_start]+"       AND o.created_at < pg_catalog.now() - interval '1 day'"+fn[old_end:]
assert 'payment_channel IN' not in base, '基準線裡不該還有白名單'
assert "interval '5 days'" not in base, '基準線裡不該有 5 days'
io.open(sys.argv[2],'w',encoding='utf-8').write(base+'\n')
PYEOF
[ -s "$D/base.sql" ] || { echo "🔴 ENV-FAIL:造不出基準線(本片的結構變了?)"; exit 2; }
psql -h 127.0.0.1 -p $PG -U postgres -v ON_ERROR_STOP=1 -q -f "$D/base.sql" >>"$D/w.log" 2>&1 || { echo "🔴 ENV-FAIL:基準線裝不起來"; tail -8 "$D/w.log"; exit 2; }
# 🔴 **世界要鏡像正式庫的 ACL 形狀** —— 正式庫那支是 `postgres=X/postgres`(= PUBLIC 已被收掉)。
#    ⇒ 拋棄式庫裡新建的函式 `proacl` 是 NULL ⇒ 本片的事後 ACL 斷言會紅,
#    ⛔ ~~原本這裡寫「事後⑤ proacl 不得為 NULL」~~ —— **那道斷言已經不存在了**:
#      C4 之後換成「owner / SECDEF / search_path 四件」+「零 owner 以外的 grantee」。
#      🔵 而在【那個】形狀底下, `proacl IS NULL` 反而**不會**直接紅 ——
#      `aclexplode(coalesce(proacl, acldefault('f', owner)))` 會噴出 grantee=0 的 PUBLIC
#      ⇒ 被「零非 owner grantee」那道擋下。**擋是擋住了, 而訊息換了一句。**
#      而**那是世界沒建對, 不是碼有問題**(我第一發就是被它擋下來的)。
#    📌 ⇒ 而那一格【紅得對】:它證明那道斷言真的會動, 不是裝飾。
psql -h 127.0.0.1 -p $PG -U postgres -q -c "REVOKE ALL ON FUNCTION pcm_cron.expire_unpaid_orders(integer) FROM PUBLIC;" >/dev/null 2>&1

# 🔴🔴 **錢守門的兩張(code-reviewer I2)** —— 我第一版 payment_charge_attempts 恆為空表
#   ⇒ 那道「有非終態 attempt 就不碰」的條件在兩版都是**恆真**
#   ⇒ 把整段 NOT EXISTS 刪掉, 11 格照樣全綠 ⇒ 📌 **那道【錢】守門在我造的世界裡一次都沒被執行過**,
#     而本檔第 6 行宣稱「這一支問的是行為」。
# 🛑 而 attempt 只發給【那兩張 9 天的】—— 第一版我寫 `< 8 days`, 結果連 cash10 / none30
#   也拿到 attempt(實測那格印 4 不是 2)⇒ **cash 10 天那張被錢守門保護, 5 天線那格就失去判別力**
#   ⇒ 🎯 **一個範圍寫太寬的 seed, 會安靜地把另一格的正對照關掉。**
seed(){ psql -h 127.0.0.1 -p $PG -U postgres -q -c "TRUNCATE public.orders;" -c "TRUNCATE public.sweeper_heartbeat;" -c "
INSERT INTO public.orders(payment_status,payment_channel,created_at) VALUES
 ('unpaid','tappay',        now()-interval '2 days'),   -- 1 刷卡 2 天 ⇒ 兩版都該殺
 ('unpaid','bank_transfer', now()-interval '2 days'),   -- 2 匯款 2 天 ⇒ 舊版殺 / 新版【不該殺】
 ('unpaid','bank_transfer', now()-interval '6 days'),   -- 3 匯款 6 天 ⇒ 兩版都該殺
 ('unpaid','cash',          now()-interval '10 days'),  -- 4 現金 10 天 ⇒ 兩版都該殺(5 天線)
 ('unpaid','cash',          now()-interval '2 days'),   -- 4b 現金 2 天 ⇒ 舊版殺 / 新版【不該殺】
 ('unpaid','none',          now()-interval '30 days'),  -- 4c none 30 天 ⇒ 舊版殺 / 新版【不該殺, 待拍板】
 ('unpaid','tappay',        now()-interval '2 hours'),  -- 5 刷卡 2 小時 ⇒ 兩版都不該殺
 ('paid',  'bank_transfer', now()-interval '9 days'),  -- 6 已付款 ⇒ 兩版都不該碰
 ('unpaid','tappay',        now()-interval '9 days'),  -- 7 刷卡9天 + attempt ⇒ 兩版都不該殺
 ('unpaid','bank_transfer', now()-interval '9 days');  -- 8 匯款9天 + attempt ⇒ 兩版都不該殺
" >/dev/null 2>&1
psql -h 127.0.0.1 -p $PG -U postgres -q -c "TRUNCATE public.payment_charge_attempts;" -c "
INSERT INTO public.payment_charge_attempts(order_id,status)
  SELECT id,'pending' FROM public.orders
   WHERE payment_status='unpaid'
     AND created_at BETWEEN now()-interval '9.5 days' AND now()-interval '8.5 days';
" >/dev/null 2>&1; }

echo "── ① 基準線(改之前):它到底殺了誰 ──"
seed
psql -h 127.0.0.1 -p $PG -U postgres -tAc "SELECT pcm_cron.expire_unpaid_orders(500)" >"$D/run.log" 2>&1 ; RC=$?
# 🔴 N5:rc 不要丟掉 —— 今天靠計數格接住是【巧合不是設計】, 換一組期望全 0 的 seed 就沒人會叫。
[ "$RC" = "0" ] || { echo "  🔴 函式呼叫失敗 rc=$RC ⇒ 下面的計數不是量測結果:"; tail -3 "$D/run.log"; exit 1; }
check "基準線:被取消的張數" 6 "$(q "select count(*) from public.orders where cancelled_at is not null")"
check "🔴 基準線:匯款 2 天那張【被殺了】(= 這就是那個洞)" 1 "$(q "select count(*) from public.orders where payment_channel='bank_transfer' and created_at > now()-interval '3 days' and cancelled_at is not null")"
check "🔴 基準線:現金與 none 全被殺(舊版不分 channel)" 3 "$(q "select count(*) from public.orders where payment_channel in ('cash','none') and cancelled_at is not null")"

echo "── ② 套上本片 ──"
psql -h 127.0.0.1 -p $PG -U postgres -v ON_ERROR_STOP=1 -q -f "$M" >"$D/apply.log" 2>&1 \
  && # 🔴 這行原本寫「前置閘四道 + 事後斷言五道」, 而實物是 **3 + 3**, 還提到一道已經不存在的
#   「事後⑤ proacl 不得為 NULL」(它被 C4 換成 grantee 檢查)⇒ adversarial-reviewer M4。
#   📌 那是操作者唯一看得到的成功訊息, 而它宣稱跑了三道不存在的閘。
  echo "  ✅ apply rc=0(前置閘三道 + 事後斷言三道都在這一步跑)" \
  || { echo "  🔴 apply 失敗:"; tail -8 "$D/apply.log"; exit 1; }

echo "── ③ 改之後:誰被殺、誰活下來 ──"
seed
psql -h 127.0.0.1 -p $PG -U postgres -tAc "SELECT pcm_cron.expire_unpaid_orders(500)" >"$D/run.log" 2>&1 ; RC=$?
# 🔴 N5:rc 不要丟掉 —— 今天靠計數格接住是【巧合不是設計】, 換一組期望全 0 的 seed 就沒人會叫。
[ "$RC" = "0" ] || { echo "  🔴 函式呼叫失敗 rc=$RC ⇒ 下面的計數不是量測結果:"; tail -3 "$D/run.log"; exit 1; }
check "被取消的張數(刷卡2天 + 匯款6天 + 現金10天)" 3 "$(q "select count(*) from public.orders where cancelled_at is not null")"
# 🔴 這一格是本片存在的理由
check "🟢 匯款 2 天那張【活下來了】" 0 "$(q "select count(*) from public.orders where payment_channel='bank_transfer' and created_at > now()-interval '3 days' and cancelled_at is not null")"
check "🟢 匯款 6 天那張仍然被殺(5 天線有效)" 1 "$(q "select count(*) from public.orders where payment_channel='bank_transfer' and created_at < now()-interval '5 days' and cancelled_at is not null")"
check "🟢 現金 2 天活下來(5 天線)" 0 "$(q "select count(*) from public.orders where payment_channel='cash' and created_at > now()-interval '3 days' and cancelled_at is not null")"
  check "🔴 現金 10 天仍被殺(Sean 拍 5 天)" 1 "$(q "select count(*) from public.orders where payment_channel='cash' and created_at < now()-interval '5 days' and cancelled_at is not null")"
  check "🛑 none 30 天【活下來】(明列排除, 待拍板)" 0 "$(q "select count(*) from public.orders where payment_channel='none' and cancelled_at is not null")"
# 🔴🔴 **正對照:刷卡的行為逐字不變** —— 本片最重要的一格
check "🔴 正對照 刷卡 2 天仍被殺(行為不變)" 1 "$(q "select count(*) from public.orders where payment_channel='tappay' and created_at < now()-interval '1 day' and cancelled_at is not null")"
check "🔴 正對照 刷卡 2 小時仍不被殺" 0 "$(q "select count(*) from public.orders where payment_channel='tappay' and created_at > now()-interval '1 day' and cancelled_at is not null")"
check "🟢 已付款那張沒被碰" 0 "$(q "select count(*) from public.orders where payment_status='paid' and cancelled_at is not null")"
# 🔴🔴 **錢守門(I2)**:有非終態 attempt 的單一律不碰 —— 不論多舊、不論哪個 channel。
check "🔴 錢守門:帶 pending attempt 的兩張都活著" 0 "$(q "select count(*) from public.orders o where exists(select 1 from public.payment_charge_attempts a where a.order_id=o.id and a.status<>'failed') and o.cancelled_at is not null")"
# 🔵 而要證那個 0 是【錢守門】擋的、不是【5 天線】擋的 —— 兩個原因印同一個 0。
check "🔵 而那兩張確實超過 5 天(否則上一格零判別力)" 2 "$(q "select count(*) from public.orders o where exists(select 1 from public.payment_charge_attempts a where a.order_id=o.id) and o.created_at < now()-interval '5 days'")"
# ── I3:心跳(套完之後從來沒有任何一格看它)──
# 🔴🔴 **這一格原本【零判別力】**(adversarial-reviewer M3):`seed()` 沒有清 `sweeper_heartbeat`,
#   而**基準線那一版也寫心跳**(python 只換掉 CASE 那一段)⇒ 那一列在步驟① 就寫進去了
#   ⇒ 🛑 **把本片函式體的心跳整段刪掉, 這一格仍然印 1 ✅**
#   ⇒ 📌 **它在「心跳有寫」與「心跳被整段刪掉」兩個世界印同一個東西。**
# ✅ 修法:`seed()` 現在會 `TRUNCATE public.sweeper_heartbeat` ⇒ 這一格量的是【本輪有沒有寫】。
check "🟢 心跳被寫進去了(seed 已清空 ⇒ 這是本輪寫的)" 1 "$(q "select count(*) from public.sweeper_heartbeat where job_name='pcm-expire-unpaid-orders'")"

echo "── ④ forward-only:同一支再跑一次必須被擋 ──"
if psql -h 127.0.0.1 -p $PG -U postgres -v ON_ERROR_STOP=1 -q -f "$M" >"$D/again.log" 2>&1; then
  echo "  🔴 重跑竟然過了 ⇒ 那道 forward-only 閘沒作用"; rc=1
else
  grep -q '前置閘②' "$D/again.log" && echo "  ✅ 被前置閘②(md5 已是改後的值)擋下 —— 訊息對得上" || { echo "  🔴 被擋了而不是那道閘擋的:"; tail -3 "$D/again.log"; rc=1; }
fi

echo
[ "$rc" = "0" ] && echo "✅ 全綠 —— 它證的是【哪幾張單被取消】, 不證 cron 有沒有排、不證正式庫。" \
                || echo "🔴 有格子不如預期 —— 上面標 🔴 的那幾格。"
exit $rc
