-- 20260824040000_m3_250_order_refunds_stuck_summary.sql
-- 線 2 · 退款告警的分母不含退款表(F-004 落地;規格 `~/pcm-mailbox/F-004-那個2與新欄名-規格定稿-20260824.md`)
--
-- ── 這支存在的理由 ────────────────────────────────────────────────
-- 每天台北 09:00 那封付款告警信的分母是 `payment_double_charge_anomalies`,
-- 所以**畫面上卡住的「退款」(`order_refunds`)從來沒有被通報過一次**。
-- 🔴 而排程與寄信都活著、信真的有來 ⇒ **這比完全沒有通知更難發現。**
--
-- ── 🔴 為什麼是【新開一支】,不是把 key 加進 get_payment_anomaly_alert_summary ──
-- 那支函式的定義散在四支 migration,而 `20260810220000` 檔內有
-- **四顆 pre-image md5 fail-closed 閘(`c_md5_c1`…`c_md5_c4`)+ 三道 post-image prosrc 指紋**,
-- 檔頭逐字「零漂移:四支各自以活本體為 pre-image 逐字沿用(awk 抽取、非手抄)」。
-- 同簽章重貼 ⇒ 可能**安靜撤回** L5b-0-s 的最新述詞,而新 key 照常出現、型別過、ACL 過、三綠過。
-- ⇒ 而走那條路要 **live pre-image md5**,施工窗零 DB access ⇒ **我做不到那道驗證**。
--    🔴 「我做不到那道驗證」本身就是選路的理由 —— 硬走 = 交出一支「閘寫了但沒對過」的 migration。
-- ⇒ 本片**一個字都不動舊函式**,既有 7 個計數的述詞零風險。
--    代價:新函式**出生自帶 PUBLIC EXECUTE** ⇒ 檔尾兩道 REVOKE/GRANT 是硬條件,不是加分。
--
-- ── 門檻為什麼寫死在函式體裡 ──────────────────────────────────────
-- Sean 2026-08-24 夜裁甲:**30 分鐘**,與畫面同值(錨 `refund-ledger-view.ts` 的
-- `REFUND_EXCEPTION_STALL_MS`)。理由不是 30 比較好,是別的值會造出「畫面 5 筆而信 2 筆」。
-- 🔴 **刻意不吃 `p_refunding_stuck_seconds`** —— 那顆參數 route 餵的是
--    `ALERT_REFUNDING_STUCK_SECONDS = 86400`(24 小時),對象是**另一張表**。
--    兩個東西都叫「卡住門檻」而值差 48 倍;沿用它會安靜地把 30 分變成 24 小時,
--    **而它編得過、三綠全綠、信照常寄 —— 沒有任何東西會紅。**
-- ⇒ 跨檔守門測試 `apps/admin/src/lib/payment/refund-alert-threshold-parity.test.ts`:
--    分鐘門檻**取函式體裡的全部**(本檔有兩處:總數那顆 + 過夜那顆的基底述詞)、
--    斷言集合恰為 `{REFUND_EXCEPTION_STALL_MS / 60000}`,期望值**算出來**不是打上去的。
--    🔴 **本行原本逐字寫「兩個字面各配一格」,而那句話當時是假的** ——
--       守門用的是不帶 `/g` 的 `.match()` ⇒ **只釘住第一個**,改第二個三格全綠
--       (code-reviewer 2026-08-24 實測:改成 `4320 minutes` ⇒ 全綠,而「卡超過一天」會少報)。
--       📌 留著這句紀錄:**一支檔會對它自己說謊**,而說謊的那句讀起來最像已經做到了。
--
-- ── 述詞與畫面同源 ────────────────────────────────────────────────
-- ①可處理半(本函式收的)  `refund-read.ts` 的 `listRefundExceptionsUncached` 第一支查詢
-- ②終態半(本函式不收)    `status='failed' AND failed_reason='manual_failed'`
--   🔴 不收②的理由:終態、後台**零按鈕**(人工退款入口封印在 `#866`)⇒ 進了計數型告警會每輪都叫,
--      那正是 `2SQH2P` 已經叫了 15 天的同一個病。②要不要另闢通報路徑 = Sean 待答。
--   ⚠️ ⇒ **信上的數字通常會小於畫面上的數字**,這是設計而非 bug;差額 = ②那半。
--      🔴 而「通常」二字是必要的,不要退回全稱句:`refund-read.ts` 的
--         `REFUND_EXCEPTIONS_LIMIT = 200` 會截斷①半 ⇒ ①半超過 200 筆時**方向會反過來**
--         (信上的數字比畫面大)。寫成全稱句的話,那一天沒有人解釋得了那個矛盾。

-- 🔴 裸 CREATE、不用 OR REPLACE(靜態閘①擋下過一次):這是**新物件**,撞名要當場紅。
--    OR REPLACE 會把撞名靜靜蓋掉,而 REVOKE 與斷言照樣綠 —— 拿到綠燈,卻蓋掉了不知道存在的東西。
-- ── 🔴 交易包覆(2026-08-25 加;實物證據 `~/pcm-mailbox/線DB驗證-交件-兩支migration實貼驗證-20260825.md` §4)──
-- **問題**:在**不包交易的 applier** 上,本檔中途失敗會留下一個**半套用的物件**。
--   實測(拋棄式 PG 17.10 · PORT 55551 · 2026-08-25),兩種失敗時點留下的東西**不一樣**:
--     · 失敗在 REVOKE **之前**(例:REVOKE 那行被刪)⇒ 函式留下,ACL = **出生自帶**
--       `{=X/postgres,…,anon=X,authenticated=X,service_role=X,…}` ⇒ 一支 SECDEF 對所有人開著
--     · 失敗在 REVOKE/GRANT **之後**(例:檔尾斷言炸)⇒ 函式留下,而 ACL **是收好的**
--       (`anon=f / payment_confirmer=t`)⇒ 壞的是「有個沒驗過的物件在庫裡」,不是權限
--   🔴 **所以不要寫成「檔尾任一句失敗都會停在出生 ACL」—— 那句是假的**(codex R2 抓到,已重量)。
--     共同的真相只有一句:**留下一個沒有走完斷言的物件,而 apply 的人只看到一行 ERROR。**
-- **處置**:`BEGIN;` / `COMMIT;`。實測 rc=3 時**零殘留**;正對照(拿掉 RAISE)rc=0 建得起來。
--
-- ── 🔴 這個修法【驗過的射程】(codex 對抗審查 R1+R2 逼出來的精確版)────────────────
--    ✅ 已驗:`psql -f`(不包交易)、`psql -1`(整檔一交易)兩條路,本檔都不再留下半成品。
--    ✅ 已驗:外層已有交易時,內嵌 BEGIN 只多兩行 WARNING、本檔照樣建得起來(rc=0)。
--    ✅ 已驗:本檔的**可執行碼**沒有交易內禁跑的 DDL。
--       🔴 **量法要看【非註解行】,不能整檔掃** —— 因為**這段說明自己就把那組關鍵字寫進檔案了**
--          (整檔掃本檔 ⇒ 2 行命中,而那 2 行就是這段字;code-reviewer 2026-08-25 抓到:
--           **一句宣稱「零命中」的話,把自己變成了命中**)。
--       量法(2026-08-25 重量,可重跑):
--         `grep -vE '^[[:space:]]*--' <檔> | grep -cE 'CONCURRENTLY|^[[:space:]]*VACUUM|ALTER SYSTEM|CREATE DATABASE|DROP DATABASE|TABLESPACE|REINDEX'`
--         本檔 ⇒ **0**
--         同尺非零對照(`supabase/migrations/*.sql` 全目錄、同樣只看非註解行)⇒ **2 支命中**
--       ⚠️ **原本這裡寫「全 repo 9 支」,那個 9 對不上任何一個可重跑的狀態**
--          (重量:HEAD 整檔 8 / 工作樹整檔 10 / 非註解行 2)⇒ 已作廢。
--          📌 **一個沒有寫清楚「量的是哪個範圍、哪一版、含不含註解」的對照數字,等於沒有對照。**
--       ⚠️ 而 grep 只證明**那組字**零命中,**不證明**不存在其他交易限制
--          (動態 SQL、`DO` 內只有正式資料才走到的分支、extension 行為、版本差異都在射程外)。
--       ⚠️ 而 grep 只證明**那組字**零命中,**不證明**不存在其他交易限制
--       (動態 SQL、DO 內只有正式資料才走到的分支、extension 行為、版本差異都在射程外)。
--    🔴 **我們現行走的是哪一條(2026-08-25 主視窗裁定,寫成條件式不是「不適用」)**:
--       **Supabase SQL Editor 手貼 + 手寫 `supabase/APPLIED.tsv`** —— `APPLIED.tsv` 是人寫的、不是 CLI 寫的
--       🔴 **紀錄的主詞不是本檔,不要讀錯**(code-reviewer 2026-08-25 抓到我引用時把主詞拿掉了):
--          `docs/launch-todo.md` 那句「2026-08-24 夜 Sean 本人貼…已記進 `supabase/APPLIED.tsv`」
--          講的是 **`20260824030000`(B5-a 登入事件欄)**,**不是本檔**。
--          它證明的只有「**手貼是我們現行的路徑**」這一件事。
--       🔴 **本檔【不在】 `supabase/APPLIED.tsv` 裡**(2026-08-25 量:兩支目標 0 命中;
--          同尺非零對照 `20260801120000` ⇒ 2 命中)⇒ **本檔還沒貼過,不要因為上面那句就跳過它。**
--       ⇒ 本檔**未在真的 `supabase db push` 下驗過**。CLI 那條「台帳 INSERT 以 session_user 跑」的
--         因果鏈在**手貼路徑上不會發生,因為那一步不存在**。
--       🔴 **若有人改走 `db push`(或任何自動 runner)⇒ 這一格要重驗。**
--         缺的檢查 = 一個可拋棄的 Supabase 專案,對 `db push` 至少驗
--         「成功 / 斷言失敗 / 台帳寫入失敗」三種結果。
--       📌 **「我們不走那條路」是一個會過期的中間態,所以寫成條件式,不寫成「不適用」。**
--    ❌ **未驗**:Supabase Dashboard SQL Editor / `supabase db push` / MCP `apply_migration`
--       三條路各自怎麼包交易 —— 三個都沒量過。**不要讀成「所有 applier 都安全」。**
--    ── 🔴🔴 **一次只貼一支**(2026-08-25 實測,Sean 本人貼進正式庫的 SQL Editor)──────
--       量法(探針全文 `~/pcm-mailbox/線DB驗證-給Sean-一發量交易包覆的探針-20260825.md`):
--         第一個 `DO` 建一張 `TEMP TABLE … ON COMMIT DROP`,之後一發 `SELECT` 問它還在不在。
--         包了 ⇒ 還在;沒包 ⇒ 第一個 `DO` 結束就被清掉。
--       結果:`g1_wrapped_batch = YES` · `g2_poscontrol = ruler-alive` · `g3_negctrl = null`
--         🔴 判別力**先被證明過**:同一發在本機兩個世界各跑一次
--            ⇒ psql 不包交易 `NO` / `psql -1` `YES`。**不是事後推的。**
--       ⇒ **Supabase SQL Editor 會把【整批】包成一個交易。**
--       🔴 所以:**一次只貼一支。** 本檔的 `COMMIT;` 提交的是 editor 那個交易;
--          若同一批後面還有別支,**它們就失去保護**(前一支的 `COMMIT` 把交易斷開了)。
--       ⚠️ 而**這是我們觀察到的現況,不是 Supabase 的承諾** —— 它變的那天不會有人通知我們。
--          ⇒ 交易框**不因為 `g1=YES` 就可以拿掉**:自帶交易框才讓結果與 applier 無關,
--            而全樹 214 支裡 110 支本來就自帶 ⇒ 拿掉才是特例。
--
--    🔴 **殘餘風險(未確認,不是已排除)。兩種形狀,不要只讀到第一種**:
--       ⓐ **單檔外層交易 + 台帳寫入在本檔 `COMMIT;` 之後** —— **這是 runner 最常見的形狀**,
--          而它把本檔的 DDL 與台帳那筆的原子性拆開:DDL 已提交,台帳那筆若失敗就補不回來
--          ⇒ 下次重跑本檔 ⇒ 本檔刻意不冪等 ⇒ 42723。
--          🔴 **原本這一段只寫了 ⓑ,而「前面那幾支」那個字面在文法上排除了本檔自己**
--          ⇒ 讀者會判「只有跨檔才有風險」而對單檔 runner 放行(code-reviewer 2026-08-25 抓到)。
--       ⓑ **跨檔外層交易** —— 本檔的 `COMMIT;` 會一起提交**前面那幾支還沒登記完成的 migration**,
--          並釋放 runner 的 advisory lock / `SET LOCAL` / savepoint
--          ⇒ 之後任何一步失敗,runner 的 `ROLLBACK` 也救不回來。
--       ⇒ **「COMMIT 之後本檔沒有語句」是必要條件,不是充分條件。**
--          充分條件是:`COMMIT` 之後,**runner 與整批 migration 都沒有必須與本檔原子完成的動作**。
--       缺的檢查=在拋棄式 Supabase 專案上,對那三條路各跑一次
--       「成功 / 失敗回滾 / migration 台帳」三者是否一致,並確認 runner 有無跨檔共用交易。正本 `#913`。
BEGIN;

CREATE FUNCTION public.get_order_refunds_stuck_summary()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT pg_catalog.jsonb_build_object(
    -- ①可處理半全體:processing 且(滯留逾 30 分 或 TapPay 已受理但帳本未結案)
    'order_refunds_stuck_count',
      (SELECT pg_catalog.count(*)
         FROM public.order_refunds
        WHERE status = 'processing'
          AND ( created_at < pg_catalog.now() - INTERVAL '30 minutes'
                OR provider_refund_id_evidence IS NOT NULL )),
    -- 過夜子集:上者再加「建立超過 24 小時」
    -- 🔴 這兩個數字**在同一發 SELECT 裡算出來** ⇒ 內部恆一致,不會出現 overnight > total。
    'order_refunds_stuck_overnight_count',
      (SELECT pg_catalog.count(*)
         FROM public.order_refunds
        WHERE status = 'processing'
          AND ( created_at < pg_catalog.now() - INTERVAL '30 minutes'
                OR provider_refund_id_evidence IS NOT NULL )
          AND created_at < pg_catalog.now() - INTERVAL '24 hours'),
    -- ②終態半:已人工判定失敗、後台【零按鈕】的那幾筆。
    -- 🔴🔴 **Sean 2026-08-24 拍甲**:這一類**不列進清單**,只在信尾寫一行
    --    「另有 N 筆已判定失敗,不需要你動作」。
    --    ⇒ 所以它**只是一個數字**,而且**絕不可以進 `shouldAlert`** ——
    --      它是終態、永遠不會自己消失(正式庫今天 = 4)⇒ 進了就是每天叫一次做不到的事,
    --      那正是 `2SQH2P` 已經叫了 15 天的同一個病。
    -- ⚠️ `'manual_failed'` 這個字面的權威在 app 端:`refund-ledger-view.ts` 的
    --    `STUCK_MANUAL_VERDICT_FAILED_REASON`。兩處各寫一份會漂 ⇒ 跨檔守門測試釘住。
    'order_refunds_manual_failed_count',
      (SELECT pg_catalog.count(*)
         FROM public.order_refunds
        WHERE status = 'failed'
          AND failed_reason = 'manual_failed')
  );
$fn$;

COMMENT ON FUNCTION public.get_order_refunds_stuck_summary() IS
  'F-004 退款卡住計數(owner-defined SECDEF 受控窗;payment_confirmer cron 唯讀讀聚合計數,零 PII/零金額/零 id)。回 jsonb{order_refunds_stuck_count(order_refunds.status=processing 且〔created_at 逾 30 分 或 provider_refund_id_evidence 非空〕),order_refunds_stuck_overnight_count(前者的子集、再加 created_at 逾 24 小時)}。'
  '🔴 分母是 public.order_refunds —— 與 get_payment_anomaly_alert_summary 的 refunding_stuck_count 【不同表】:後者的分母是 payment_double_charge_anomalies,名字比分母寬,不要混用。'
  '🔴 30 分門檻刻意寫死、不吃 p_refunding_stuck_seconds:那顆 route 餵 86400(24 小時)、對象是另一張表,沿用會安靜地把 30 分變成 24 小時且無任何守門會紅。與 app 端 REFUND_EXCEPTION_STALL_MS 同源,跨檔守門測試釘住。'
  '⚠️ 只收「可處理半」;status=failed AND failed_reason=manual_failed 那半是終態且後台零按鈕(封印 #866),不進計數型告警 ⇒ 信上數字會小於畫面,差額即該半。';

-- ── 收權(🔴 硬條件,不是加分)────────────────────────────────────
-- 新函式**出生就自帶 PUBLIC EXECUTE**,而 repo 內零 GRANT 字面可掃、三綠不紅。
-- 兩道缺一不可:先對所有可能的持有者 REVOKE,再只 GRANT 給 payment_confirmer。
REVOKE ALL ON FUNCTION public.get_order_refunds_stuck_summary() FROM PUBLIC, anon, authenticated, service_role, payment_confirmer;
GRANT EXECUTE ON FUNCTION public.get_order_refunds_stuck_summary() TO payment_confirmer;

-- ⚠️ **這兩行證的是「我列了」,不是「列對了」** —— 簽章打錯一個字,這兩行會指向一個不存在的
--    函式,而靜態閘照樣印「兩邊都是 1 個」⇒ 真正建出來的那支帶著 PUBLIC EXECUTE 裸奔。
--    🔴 分得開這兩個世界的只有一發:**apply 後查 pg_proc 的 ACL**(交件包附 SQL,
--    鎖 exact regprocedure、列舉 PUBLIC/anon/authenticated/service_role 四者必須 false、
--    payment_confirmer 必須 true —— 正向那格不可省:全 false 也可能是函式根本沒建起來)。


-- ── fail-closed assert:授權清單必須【恰好】只有 payment_confirmer ──
-- 形狀逐字沿用 `20260819130000` §3(它是被 codex 對抗審查逼出來的版本),兩處差異只有簽章與訊息。
-- 🔴 用【列舉實際 grantee】而不是點名檢查 anon/authenticated/service_role ——
--    **點名式檢查看不到你沒點到的名字**:日後多一個 ops_reader,它拿得到計數而斷言照樣綠。
-- 🔴🔴 **而這道斷言【看不到角色成員閉包】,讀到這裡就要知道,不要以為它蓋住了**:
--    `GRANT payment_confirmer TO ops_reader` 之後 `proacl` 一個字都不會變 ⇒ 本斷言全綠,
--    而 ops_reader 只要 `SET ROLE payment_confirmer` 就讀得到。
--    ⇒ **這不是本片引入的缺口**(既有幾支 SECDEF migration 的 ACL 斷言同一形狀),正本 `#665`。
DO $$
DECLARE
  -- 🔴 清單式斷言(靜態閘③ 要求;而它同時解掉「簽章打錯」那格):
  --    `to_regprocedure` 對打錯的簽名**回 NULL**,下面第一道 IF 讓那件事 fail-loud。
  --    ⇒ 「我對一個不存在的簽章收權了」不再與「我收權了」印同一句話。
  --    🔴 結尾 `::text[]` 不能拿掉(清單清空時 `ARRAY[]` 無法推斷型別)。
  v_relations text[] := ARRAY[]::text[];
  v_functions text[] := ARRAY[
    'public.get_order_refunds_stuck_summary()'
  ]::text[];
  v_fn    oid;
  r       text;
  v_extra text;
BEGIN
  FOREACH r IN ARRAY v_functions LOOP
    v_fn := pg_catalog.to_regprocedure(r);
    IF v_fn IS NULL THEN
      RAISE EXCEPTION 'F-004 A0 失敗:找不到函式 %(簽名打錯或沒建成)⇒ 拒繼續', r;
    END IF;
    -- 🔴 角色逐個點名:新函式出生自帶 anon/authenticated/service_role 的 EXECUTE,
    --    而 `REVOKE … FROM PUBLIC` 收不掉角色專屬的那三份(PUBLIC 是偽角色,不是具名角色)。
    -- 🔴🔴 **`public` 這一格是 codex 關卡2 逼出來的,而它守的是下面那道枚舉斷言的一個洞**:
    --    `proacl` 為 **NULL** 時(= 從沒被 GRANT/REVOKE 動過)`aclexplode` **回零列**
    --    ⇒ 下面那發 `v_extra` 是 NULL ⇒ 斷言**空轉、印綠**。
    --    而 `proacl IS NULL` 的語意**不是「沒有人有權限」,是「套用預設權限」** —— 函式的預設是
    --    **PUBLIC 有 EXECUTE** ⇒ 那個綠正好蓋住最壞的世界。
    --    ⇒ 這一格用 `has_function_privilege` 問 **有效權限**(它看得懂 NULL proacl 的預設),
    --      所以它在那個世界會紅。**枚舉那發與這一發不是重複,是互補。**
    IF pg_catalog.has_function_privilege('public', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'F-004 A0 失敗:% 對 PUBLIC/anon/authenticated/service_role 還開著 EXECUTE(REVOKE 少了一個角色?或 proacl 是 NULL = 套用預設)', r;
    END IF;
    -- 正向那格:全 false 也可能是「函式根本沒建起來」,要有一發證明它真的給對了人。
    IF NOT pg_catalog.has_function_privilege('payment_confirmer', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'F-004 A0 失敗:% 對 payment_confirmer 沒有 EXECUTE ⇒ 告警讀不到退款計數', r;
    END IF;
  END LOOP;

  SELECT pg_catalog.string_agg(g.grantee, ', ')
    INTO v_extra
    FROM (
      SELECT pg_catalog.pg_get_userbyid((aclexplode(p.proacl)).grantee) AS grantee
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname = 'get_order_refunds_stuck_summary'
         -- 🔴 鎖簽名,不能只比名字:日後有人建一支同名 overload 並授權給別人,
         --    不鎖簽名的話這道斷言會**為了別人的函式而炸**,而訊息指向我們這一支 ⇒ 假紅且指錯地方。
         --    本函式零參數 ⇒ identity arguments 是空字串。
         AND pg_catalog.pg_get_function_identity_arguments(p.oid) = ''
    ) g
   -- 🔴 `CURRENT_USER` 是關鍵字不是函式,不可寫成 `pg_catalog.current_user`(會被當成欄名)。
   --    排除它:owner 自己的 EXECUTE 是 CREATE FUNCTION 天生給的,不是額外授權。
   WHERE g.grantee NOT IN ('payment_confirmer', CURRENT_USER);

  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION 'F-004 退款卡住計數:EXECUTE 授權清單多出非預期角色(%) — 只應有 payment_confirmer;拒繼續', v_extra;
  END IF;

  -- ── 🔴🔴 RLS 閘:**SECURITY DEFINER 不等於繞過 RLS**(codex 關卡2 must-fix)──
  -- 這一格守的是本片**最壞的失敗形狀**,而它與本片要修的 bug 是同一個形狀、只是換了一層:
  --   函式建起來了、EXECUTE 收好了、apply 全綠,而 RLS 讓它**每天安靜地回 0**
  --   ⇒ 「沒有卡住的退款」與「我讀不到這張表」**印同一個數字**
  --   ⇒ 而信照常寄、沒有任何東西會紅 —— 那正是我們現在在修的那個病。
  --
  -- 兩個世界怎麼分(這是機械的,不是我推的):
  --   · `relforcerowsecurity` = true  ⇒ **連表擁有者也受 RLS 管** ⇒ 函式必然可能被濾成 0
  --   · `relrowsecurity` = true 而函式 owner ≠ 表 owner ⇒ 函式走 policy ⇒ 同樣可能被濾成 0
  --   · 其餘(RLS 關,或 RLS 開但函式 owner = 表 owner 且未 FORCE)⇒ owner 繞過 ⇒ 安全
  -- ⇒ 前兩種**當場 RAISE**,不要讓它上線之後才用「每天 0 筆」告訴我們。
  DECLARE
    v_rls        boolean;
    v_force      boolean;
    v_tbl_owner  name;
    v_fn_owner   name;
  BEGIN
    SELECT c.relrowsecurity, c.relforcerowsecurity, pg_catalog.pg_get_userbyid(c.relowner)
      INTO v_rls, v_force, v_tbl_owner
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'order_refunds';

    IF v_rls IS NULL THEN
      RAISE EXCEPTION 'F-004 RLS 閘:查不到 public.order_refunds ⇒ 拒繼續(不要在看不到分母的情況下上線)';
    END IF;

    SELECT pg_catalog.pg_get_userbyid(p.proowner) INTO v_fn_owner
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'get_order_refunds_stuck_summary'
       AND pg_catalog.pg_get_function_identity_arguments(p.oid) = '';

    IF v_rls AND v_force THEN
      RAISE EXCEPTION
        'F-004 RLS 閘:order_refunds 開著 FORCE ROW LEVEL SECURITY ⇒ 連擁有者(%)也受 policy 管 '
        '⇒ 這支 SECDEF 函式可能被靜靜濾成 0,而「0 筆」與「讀不到」印同一個數字;拒繼續', v_tbl_owner;
    END IF;

    IF v_rls AND v_fn_owner IS DISTINCT FROM v_tbl_owner THEN
      RAISE EXCEPTION
        'F-004 RLS 閘:order_refunds 開著 RLS,而函式擁有者(%)不是表擁有者(%) '
        '⇒ 函式會走 policy、可能被靜靜濾成 0;拒繼續', v_fn_owner, v_tbl_owner;
    END IF;
  END;

  -- 🔴 正向那格不可省:上面那發全空也可能是「函式根本沒建起來」,兩個世界會印同一個結果。
  IF NOT has_function_privilege('payment_confirmer',
        'public.get_order_refunds_stuck_summary()', 'EXECUTE') THEN
    RAISE EXCEPTION 'F-004 退款卡住計數:payment_confirmer 沒有 EXECUTE ⇒ 告警讀不到退款計數;拒繼續';
  END IF;
END
$$;

COMMIT;
