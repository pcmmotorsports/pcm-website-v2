-- 20260906600000_m4b_expire_day_boundary.sql
-- ⟦b4-EXPIREDAYBOUND⟧ 匯款/現金逾期取消改用【台北日界】—— Sean 2026-09-06 逐字拍【乙】
--
-- ## 這一片在修什麼
-- 客人看到的是「請於 9 月 10 日(**含**)之前完成匯款」, 而 cron 的述詞是**時戳比較**
-- (`created_at < now() - interval '5 days'`)⇒ 9/5 12:00 下單的單, **9/10 12:00 之後**
-- 任一整點就可能被自動取消 —— **不是 9/10 整天**。
-- 🎯 ⇒ 兩邊各自都讀得通, 而客人第 5 天下午匯的那筆錢會匯進一張剛被取消的單。
--
-- ## Sean 的字(不是我的轉述)
-- `~/pcm-mailbox/明早Sean清單-20260906.md:97` 逐字:
--   「乙 = 改系統(改成「第 5 天整天都算, 隔天 00:00 才取消」⇒ 字不用改;每張單最多多活 24 小時;要再貼一支 SQL)」
-- 他的答字 `~/pcm-mailbox/端Sean-0905早上佇列.md:1317` 逐字「Q-匯款到期=乙(改系統日界)」。
--
-- ## 本片改什麼 / 不改什麼
-- ✅ 改:`pcm_cron.expire_unpaid_orders` 的**到期述詞那五行**, 與它的 catalog COMMENT。
-- ❌ 不改:天數(仍是 tappay 1 / bank_transfer 5 / cash 5)· 白名單 · 淨額腿 · 心跳 · 鎖策略 ·
--    `PCM_REMITTANCE_EXPIRE_DAYS = 5` · 客人看到的任何一個字(Sean 逐字「字不用改」)。
-- 🛑 **`tappay` 不動**(主視窗 `-f8` 2026-09-06 裁【甲】)—— 理由在述詞旁邊那三行。
--
-- ## 這一支的來源座標(動手當天重跑過, 不是照 plan 抄)
-- `scripts/latest-definition-of.sh expire_unpaid_orders` ⇒ `newest = live = 20260904230000`
-- ⇒ 函式本體 **`sed -n '401,543p'` 抽出, 一個字元都沒有重打**;COMMENT 抽 `553,564`;
--   4c 權限段抽 `579,599`。**只有述詞那五行被換掉**, 以及 COMMENT 結尾補一句。
-- 🛑 **`20260828060000` 是舊一代, 板上逐字標「禁止重貼」** —— 本片不碰它。
--
-- ## 冪等
-- 已經貼過(線上 `prosrc` 已含 `Asia/Taipei`)⇒ 前置閘印 NOTICE 說「已經做過了」,
-- 然後**照常 REPLACE**(同一份定義覆蓋同一份定義)⇒ 重貼安全。
--
-- ## 還原
-- `docs/specs/2026-09-06-expire-day-boundary-ROLLBACK.sql`(**真 SQL, 不是註解**)。
-- ⚠️ 而「rollback 回到原狀」對**已經多活的那些單**不成立:若客人在那段多出來的時間裡匯了款,
--    那筆錢已經進 `order_payments` —— 還原述詞不會把它變回去(那是好事, 寫在這裡是因為字面要等於事實)。
--
-- 🟢 唯讀性:本片**只 CREATE OR REPLACE 一支函式 + 一段 COMMENT**, 零 DML、零 DDL 於任何資料表。

BEGIN;

-- ══ 0. 前置閘:線上那一支必須是我以為的那一代 ═══════════════════════════════
-- 🔴 為什麼要有它:`CREATE OR REPLACE` 會**整支蓋掉**。若正式庫上跑的其實是別的一代
--    (例如有人重貼了 `20260828060000` 那個舊一代), 我這一貼會把別人的東西靜靜刪掉,
--    而**三綠全綠、審查看到的是「只改了述詞」**。
DO $pre$
DECLARE
  v_src text;
  v_had_new boolean;
  v_n integer;
  v_md5 text;
  v_raw text;
  v_raw_md5 text;
  v_cmt text;
BEGIN
  -- ① tzdata:`Asia/Taipei` 這個名字必須存在, 否則新述詞會在執行期才炸
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = 'Asia/Taipei') THEN
    RAISE EXCEPTION '前置閘①:這個 DB 沒有 Asia/Taipei 時區名 ⇒ 新述詞跑不了, 拒繼續。';
  END IF;

  -- ② 那支函式要在, 而且**只能有那一支簽章**
  -- 🔴 codex R1 #3:只用 schema + proname 找, 同名多載存在時會**任選一列** ⇒ 可能拿錯函式通過。
  --    ⇒ 這裡兩件都做:先數多載(多於一支就停), 再用 `::regprocedure` 鎖 `(integer)` 那一支。
  SELECT count(*) INTO v_n
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'pcm_cron' AND p.proname = 'expire_unpaid_orders';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '前置閘②a:pcm_cron.expire_unpaid_orders 有 % 支同名函式(期望 1)⇒ 我不知道要改哪一支, 拒繼續。', v_n;
  END IF;
  SELECT p.prosrc INTO v_src
    FROM pg_catalog.pg_proc p
   WHERE p.oid = 'pcm_cron.expire_unpaid_orders(integer)'::regprocedure;
  IF v_src IS NULL THEN
    RAISE EXCEPTION '前置閘②b:pcm_cron.expire_unpaid_orders(integer) 不存在 ⇒ 先貼它的前一代, 不要從本片開始。';
  END IF;

  -- 🔴🔴 ②c **簽章的【語意】也要比, 不只本體**(codex R3 #1):
  --    `prosrc` 的 md5 只鎖**函式本體那段文字** —— 它鎖不到
  --    回傳型別 / volatility / SECURITY DEFINER / search_path / **`p_limit` 的預設值**。
  --    ⇒ 📌 正式庫若「本體一字不差而 `DEFAULT 500` 被改成 `DEFAULT 5`」, md5 錨**全過**,
  --      而本片會把那個改動蓋掉, 且**每輪只處理 5 張**這件事沒有任何人會發現。
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
     WHERE p.oid = 'pcm_cron.expire_unpaid_orders(integer)'::regprocedure
       AND p.prorettype = 'integer'::regtype
       AND p.provolatile = 'v'
       AND p.prosecdef
       AND p.proconfig @> ARRAY['search_path=""']
       AND pg_catalog.pg_get_function_arguments(p.oid) = 'p_limit integer DEFAULT 500'
  ) THEN
    RAISE EXCEPTION '前置閘②c:簽章語意漂了(回傳型別 / volatility / SECURITY DEFINER / search_path / p_limit 預設值 至少一項不符)⇒ 拒繼續。實際引數 = %', 
      (SELECT pg_catalog.pg_get_function_arguments('pcm_cron.expire_unpaid_orders(integer)'::regprocedure));
  END IF;

  -- 🔵 原始那一份先留著 —— 主錨要用它(見 ③b)
  v_raw := v_src;
  -- 🔴 剝註解再問 —— 不剝的話「述詞被刪掉、註解留著」照樣通過(那是 20260904230000 自己記下的病)
  v_src := pg_catalog.regexp_replace(v_src, '--[^' || chr(10) || ']*', '', 'g');

  -- ③ 線上那一代必須帶著 20260904230000 的四個特徵 ⇒ 少任一個 = 它不是我要改的那一代
  IF pg_catalog.strpos(v_src, 'order_payments') = 0
     OR pg_catalog.strpos(v_src, 'sweeper_heartbeat') = 0
     OR pg_catalog.strpos(v_src, '5 days') = 0
     OR pg_catalog.strpos(v_src, 'payment_channel') = 0
     OR pg_catalog.strpos(pg_catalog.regexp_replace(v_src, '\s+', '', 'g'), ')<=0') = 0 THEN
    RAISE EXCEPTION '前置閘③:線上那一代缺特徵(order_payments / sweeper_heartbeat / 5 days / payment_channel / )<=0)⇒ 它不是 20260904230000 那一代, 拒繼續。';
  END IF;

  -- 🔴🔴 ③b **md5 錨 —— 這一格才是「線上真的是那一代」的證明**(codex R1 #2 打回第一版)
  --    ⛔ ~~只靠上面那五個散落 token~~ **不夠**:codex 構造出反例 ——
  --      把 attempt 條件從 `<> 'failed'` 改成 `= 'failed'`, **五個 token 一個不少**
  --      ⇒ 閘全過, 而我這一貼會把那個未知修補**靜靜蓋掉**。
  --    ✅ 改成比**整支正規化後的 md5**:剝 `--` 註解 + 壓掉所有空白 ⇒ 一個字元不同就不等。
  --    🔬 期望值 `3a21a5aa1fa0d0f7b8b075c1cacfe85f` 是**兩處各自量到而相等**才寫進來的:
  --      ① 正式庫唯讀(2026-09-06 `scripts/readonly-prod-sql.sh`, `raw_len=7074` · 同名多載 1 支)
  --      ② 拋棄式 PG 裝 `sed -n '401,543p' 20260904230000` 之後同一個算法
  --      ⇒ 📌 兩個獨立來源同一個值 ⇒ **線上跑的就是 repo 裡那一代**。
  --    ⚠️ 射程:它證「本體逐字相同」, **不證**「那一代本身是對的」。
  -- 🔴🔴 **主錨用【原始 prosrc】的 md5, 不是正規化的那個**(codex R2 #4 打回第二版):
  --    正規化那一套(剝 `--` 到行尾)**會誤剝字串常值裡的 `--`, 也不剝 `/* */`**
  --    ⇒ 拿它當唯一的錨, 等於把錨綁在一把有已知盲區的尺上。
  --    ✅ 原始 md5 沒有那個問題:它一個位元都不放過。
  --    🔵 正規化那個仍然留著當**第二把**(它對「只改了縮排/註解」比較寬容, 訊息比較好讀)。
  v_raw_md5 := pg_catalog.md5(v_raw);
  v_md5     := pg_catalog.md5(pg_catalog.regexp_replace(v_src, '\s+', '', 'g'));
  v_had_new := pg_catalog.strpos(v_src, 'Asia/Taipei') > 0;
  IF v_had_new THEN
    -- 已經是日界版 ⇒ 它必須是**本片自己**產生的那一版, 不是別人改過的日界版
    IF v_raw_md5 <> '7e1e6764def6738440a1012cbea44f05' THEN
      RAISE EXCEPTION '前置閘③b:線上已是日界版, 而它的原始 md5 = %(期望 7e1e6764def6738440a1012cbea44f05)⇒ 有人在本片之上又改過它, 我這一貼會蓋掉那個改動, 拒繼續。', v_raw_md5;
    END IF;
  ELSE
    IF v_raw_md5 <> 'b91dc97700d43dd1015dd31ff6eacdfa' OR v_md5 <> '3a21a5aa1fa0d0f7b8b075c1cacfe85f' THEN
      RAISE EXCEPTION '前置閘③b:線上那一支 原始md5=% 正規化md5=%(期望 b91dc97700d43dd1015dd31ff6eacdfa / 3a21a5aa1fa0d0f7b8b075c1cacfe85f)⇒ 它不是 20260904230000 那一代, 我這一貼會蓋掉別人的東西, 拒繼續。', v_raw_md5, v_md5;
    END IF;

    -- 🔴🔴 **③c 事後⑦ 那把 needle 的【真】正對照**(codex R2 #6 打回第二版):
    --    ⛔ ~~第二版在事後拿「一段自己拼出來的、含同一個字面的字串」去餵同一個 needle~~
    --      ⇒ 📌 **那只證明「字串包含自己」** —— needle 寫錯時, 那段自造字串也跟著錯, 照樣命中。
    --    ✅ 真正的正對照只有一個地方拿得到:**還沒被覆蓋掉的舊函式本人**。
    --      ⇒ 這一格在覆蓋【之前】問:舊那一支壓空白後**必須**含那個 needle。
    --        needle 拼錯 ⇒ 這裡當場紅 ⇒ 事後⑦ 的綠就不再是免費的。
    IF pg_catalog.strpos(pg_catalog.regexp_replace(v_src, '\s+', '', 'g'),
                         'o.created_at<pg_catalog.now()-CASEo.payment_channel') = 0 THEN
      RAISE EXCEPTION '前置閘③c:事後⑦ 要找的舊述詞字面, 在【還沒被覆蓋的舊函式】裡就找不到 ⇒ 那個 needle 是錯的, 事後⑦ 會恆綠。';
    END IF;
  END IF;

  -- 🔴 ③d **COMMENT 也要錨**(codex R2 新 #3):本片會**無條件覆寫** catalog COMMENT,
  --    而 md5 只錨 `prosrc` ⇒ 上游若合法更新過 COMMENT, 這一貼會讓它**無聲消失**。
  -- 🔴🔴 **兩個世界都要問**(codex R3 #2 打回第三版):第三版只在「還是舊版」時問 ——
  --    ⇒ 📌 已經貼過一次之後, 若有人只改了 COMMENT(操作備註很常這樣改),
  --      重貼會**靜靜清掉它**, 而前置閘④ 還會印「同定義覆蓋同定義, 安全」。
  v_cmt := pg_catalog.md5(coalesce(pg_catalog.obj_description(
             'pcm_cron.expire_unpaid_orders(integer)'::regprocedure, 'pg_proc'), '(無)'));
  IF v_had_new THEN
    IF v_cmt <> '623ddd9848b789c5f91edbacdfc82cdc' THEN
      RAISE EXCEPTION '前置閘③d:線上已是日界版, 而它的 COMMENT md5 = %(期望 623ddd9848b789c5f91edbacdfc82cdc)⇒ 有人改過 COMMENT, 而本片會覆寫掉 ⇒ 拒繼續。', v_cmt;
    END IF;
  ELSE
    IF v_cmt <> '6db6598dd49288e6607ee5dd7f628361' THEN
      RAISE EXCEPTION '前置閘③d:線上 COMMENT 的 md5 = %(期望 6db6598dd49288e6607ee5dd7f628361, 長度 1175)⇒ 有人改過它, 而本片會覆寫掉 ⇒ 拒繼續, 先去看那個改動。', v_cmt;
    END IF;
  END IF;

  -- ④ 冪等:已經是新的了就說一聲, 然後照常 REPLACE(不 skip —— skip 會讓「貼過」與「貼壞」印同一個東西)
  IF v_had_new THEN
    RAISE NOTICE '前置閘④:線上已經是日界版(prosrc 已含 Asia/Taipei)⇒ 本片重貼, 同定義覆蓋同定義, 安全。';
  ELSE
    RAISE NOTICE '前置閘④:線上是舊的時戳比較版 ⇒ 本片會把它換成日界版。';
  END IF;
END
$pre$;

-- ══ 1. 函式本體(逐字取自 20260904230000:401-543, 只換述詞那五行)══════════
CREATE OR REPLACE FUNCTION pcm_cron.expire_unpaid_orders(p_limit integer DEFAULT 500)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_count integer;
BEGIN
  -- 🔴 誠實邊界(codex 關卡2):本函式**完全信任 `orders.created_at`**,而那一欄沒有不可變守門 ——
  --    owner / migration 把它回填成舊日期,新單會提早被取消;改成未來,則永遠掃不到。
  --    不加守門的理由:owner 本來就能繞過任何 DB 層防線,為此加欄位級 trigger 的代價大於收益。
  -- p_limit fail-safe:NULL / <=0 一律退回 1(不接受「無上限」;0-worker 會靜默不處理)。
  -- ⚠️ 誠實邊界(codex 關卡2 nit):`LIMIT` 限的是**改幾列**,不是**掃幾列** —— 歷史 paid/failed 單一多,
  --    找候選的掃描成本仍會長,且本函式沒有 statement_timeout。現況存量 0、每小時一次 ⇒ 可接受;
  --    真的長起來時的修法 = 對 (payment_status, cancelled_at, created_at) 加部分索引 + 設 statement_timeout。
  IF p_limit IS NULL OR p_limit <= 0 THEN
    p_limit := 1;
  END IF;

  WITH target AS (
    SELECT o.id
      FROM public.orders o
     WHERE o.payment_status = 'unpaid'::public.payment_status
       AND o.cancelled_at IS NULL                                    -- 已取消/已失效 → 不重複寫(冪等)
       -- 🔴🔴 **2026-09-03 依 payment_channel 分流**(Sean 本人逐字回「乙 5天」)。
       --    ⛔ ~~原本是無條件 `interval '1 day'`~~ —— 而那一行**沒有濾 payment_channel**
       --      ⇒ 員工手動建的匯款單(`admin_create_manual_order` 只收 bank_transfer/cash)
       --        1 天後就被殺掉, 而**匯款常要 1-3 天**。
       --    📌 **而這不是有人忘了改** —— `20260809160000:66-69` 那一節標題逐字
       --      「重估觸發(Sean 拍板時逐字要求寫死在規格裡)」, 內容逐字
       --      「開放匯款付款時『1 天』**必須重看** … **1 天會把正常等匯款的單殺掉**」
       --      ⇒ 🎯 **那是一個【自己寫下失效條件】的數字, 而今天正是那個條件。**
       -- 🛑 **白名單, 不是黑名單** —— 只有【明列的三種】會被自動失效。
       --    ⇒ `none` 與**任何未來新增的 channel** 一律【不失效】。
       -- 🔴🔴 ⛔ ~~原本這兩行寫「只有這兩種」「`cash` / `none` 一律不失效」~~ **作廢** ——
       --    那是 Sean 補拍 cash 之前的殘留, 而我改了碼沒改它(code-reviewer C1 抓)。
       --    ⇒ 📌 **它會被寫進正式庫的 `prosrc`** ⇒ 下一個 `\df+` 開這支函式的人讀到的是假的。
       --    🎯 而那正是本檔自己在講的病:**一句話在兩個世界是同一個字串。**
       --    🔴 理由是不對稱的:**不失效是可逆的**(人可以手動取消),
       --      **失效是不可逆的**(那張單就沒了, 而客人今天連取消信都收不到)。
       --    🔴 `cash` = **5 天**(Sean 2026-09-03 逐字「甲 跟匯款一樣 5 天」)——
       --      ⚠️ 我原本刻意留白不敢比照, 而他自己答了。**現在它是拍板不是推論。**
       --    🛑🛑 **`none` 【明列排除】, 而它不是漏掉的** —— 那個值在 CHECK 裡合法
       --      (`20260712203000:51`)、而**今天沒有任何寫入端會寫它**, 也沒有人談過它該怎樣。
       --      ⇒ 🔴 **若寫成「其餘 ⇒ 5 天」, `none` 會靜靜地拿到一個沒有人決定過的行為。**
       --      ⇒ ✅ 所以這裡是**白名單明列三種**;`none` 與任何未來新 channel ⇒ **不失效**
       --        (不失效可逆 · 失效不可逆 ⇒ 不對稱)。`none` 要怎樣**待拍板**。
       --    🔴 **而「有人開始寫它的那天要回來看」不是一句提醒, 它有一個可機械跑的訊號**:
       --      `SELECT count(*) FROM public.orders WHERE payment_channel = 'none'` **> 0**
       --      ⇒ 📌 今天它是 0(零寫入端)⇒ **那個 0 就是「這條規則還沒承重」的意思**;
       --        它變成非 0 的那一天, 這一格的「不失效」才第一次真的擋到東西。
       --    🔵 `payment_channel` 是 `NOT NULL DEFAULT 'tappay'` ⇒ 沒有 NULL 那一格要處理。
       AND o.payment_channel IN ('tappay', 'bank_transfer', 'cash')
       -- 🔴🔴 **2026-09-06 日界(Sean 逐字「乙」:「第 5 天整天都算, 隔天 00:00 才取消」)**
       --    ⛔ ~~原本是 `AND o.created_at < pg_catalog.now() - CASE o.payment_channel …`~~ **作廢** ——
       --      那是**時戳比較** ⇒ 9/5 12:00 下單的匯款單, 9/10 12:00 之後任一整點就可能被取消,
       --      而客人畫面上寫的是「9 月 10 日(**含**)之前」
       --      (`packages/domain/src/order/remittance-info.ts:127` 逐字 `請於 ${label}(含)之前完成匯款,逾期訂單將自動取消。`)
       --      ⇒ 📌 **文案與述詞在【第 5 天當天下午】那一段是矛盾的, 而兩邊各自都讀得通。**
       --    ✅ 現在的判準:**下單那一天(台北日曆日)+ N 天 + 1 天的 00:00(台北)**。
       --      驗算 N=5:9/5 任何時刻下單 ⇒ 日曆日 9/5 ⇒ +5 天 = 9/10 ⇒ +1 天 = **9/11 00:00 取消**
       --      ⇒ 9/10 整天有效 ⇒ 與畫面上那一句逐格對齊。
       -- 🛑 **`tappay` 不在下面那個 CASE 裡, 而那是刻意的**(主視窗 `-f8` 2026-09-06 裁【甲】):
       --    ① Sean 那題的主詞是**匯款**, 刷卡沒有「(含)之前」那句話可以對齊
       --    ② 刷卡棄單多活 24h 會多佔住「同車只能有一張活單」那道守門(⟦b4-BANKCARDRACE⟧ / 20260906500000)
       --    ③「不改」= 現況 = 不需要任何人拍板;「改」才是新行為。
       --    ⇒ 🔵 `tappay` 走 THEN 那一支, 維持原本的時戳比較。
       -- 🔵 **新界不早於舊界 —— 而這句話有【射程】, 不是全稱**(codex R1 #12/#13 打回第一版)
       --    量到的:2026-09-06 對正式庫跑純運算式 SELECT(唯讀零寫入, `scripts/readonly-prod-sql.sh`),
       --    六個 2026 年的下單時刻 ⇒ `新界 − 舊界` 全為正:
       --    00:00 ⇒ `1 day` · 00:01 ⇒ `23:59:00` · 12:00 ⇒ `12:00:00` · 23:59 ⇒ `00:01:00`
       --    · 2026-03-01 07:30 ⇒ `16:30:00` · 2026-12-31 22:15 ⇒ `01:45:00`
       --    ⛔ ~~原本寫「**沒有任何一張單**會提早被取消」「最多多活 24 小時」~~ **作廢** ——
       --      🔴 那是**全稱句**, 而它在【下單當天到期日之間有日光節約轉換】時不成立:
       --        台灣 1945-1961 年實施過夏令時間 ⇒ 那種輸入下新界可比舊界**早 30 分鐘**
       --        (codex R1 構造出 `1946-05-10` 那一發)。
       --    ✅ 正確字面:**`新界 − 舊界 = 1 天 − 下單當天的時刻`, 前提是那段區間內台北沒有 UTC 偏移變動。**
       --      🔵 台灣**自 1980 年起沒有再實施夏令時間** ⇒ 對 `orders.created_at` 的實際取值域
       --        (2026 年)這個前提成立;而**它是前提不是定理**, 未來若恢復 DST 要回來看這一格。
       --    🟢 同一發的正對照:六列邊界表兩欄都同時出現 t 與 f;🔵 負對照:channel 餵 NULL ⇒ 兩欄皆非 t。
       -- ⚠️ 代價明寫:`created_at` 被包進函式 ⇒ 比舊版更難用索引。現況存量小(正式庫 orders 2 列)、
       --    每小時一次(`20260809170000:77` 逐字 `'0 * * * *'`)⇒ 可接受。真的長起來時的修法 =
       --    加前置粗篩 `AND o.created_at < pg_catalog.now() - interval '1 day'`(對所有可取消的列恆真 ⇒ 不改語意)。
       --    **本片不加** —— 為一個量不到的問題付複雜度。
       -- 🛑 內層 CASE **沒有 ELSE** ⇒ 白名單以外的 channel 會得到 NULL ⇒ `now() >= NULL` 是 NULL
       --    ⇒ **不取消**。方向與上面那條白名單一致:不失效可逆, 失效不可逆。
       AND CASE o.payment_channel
             WHEN 'tappay' THEN o.created_at < pg_catalog.now() - interval '1 day'  -- 🔵 逐字不動(Sean 2026-08-09「1天」)
             ELSE pg_catalog.now() >= pg_catalog.timezone(
                    'Asia/Taipei',
                    pg_catalog.date_trunc('day', pg_catalog.timezone('Asia/Taipei', o.created_at))
                      + CASE o.payment_channel
                          WHEN 'bank_transfer' THEN interval '5 days'   -- 🔴 Sean 2026-09-03 逐字「乙 5天」
                          WHEN 'cash'          THEN interval '5 days'   -- 🔴 Sean 2026-09-03 逐字「甲 跟匯款一樣 5 天」
                        END
                      + interval '1 day'                                -- 🔴 Sean 2026-09-06 逐字「隔天 00:00 才取消」
                  )
           END
       --    ⚠️ 那份 memory 內部編號 Q2 指的是天數,與本 plan §6 的 Q2「失效單不復活」是**不同的兩題**,別混)。
       --    重估觸發見檔頭。
       -- 🔴 安全核心:有任何非終態 attempt = 錢可能在途 ⇒ 一律不碰(留給對帳/人工)。
       --    條件與 admin_cancel_order 步7 逐字相同 ⇒ 兩個寫入端維持同一條不變量。
       --    ⚠️ 代價(code-reviewer N7):`released` 也被這條擋住 ⇒ **帶 released attempt 的單永遠不會被失效**。
       --    這是保守的正確選擇(released = 鎖已釋、仍在低頻對帳到 terminal),但它意味著那類單
       --    **在本片之後仍然沒有終點** —— 那正是 Q7/L5 要處理的「放棄型」殭屍,不在件① 範圍。
       AND NOT EXISTS (
             SELECT 1 FROM public.payment_charge_attempts a
              WHERE a.order_id = o.id
                AND a.status <> 'failed'
           )
       -- 🔴🔴 ⟦b4-NONCARDPAID1⟧ 新增的那一句(本片對 20260903080000 的【唯一】行為差異)。
       --    已收淨額 > 0 的單不取消 —— 客人錢已經進來了, 而狀態沒翻上去。
       -- 🔵 為什麼 `SUM(amount)` 就是淨額, 不必外接「哪些被沖掉了」:
       --    `order_payments` 是 append-only, 沖銷 = 插一列**反號**
       --    (`20260810100000_m4b_e10_op1_order_payments_m.sql:199` 逐字
       --     `amount integer NOT NULL CHECK (amount <> 0)`, 檔內 A10 拍板段
       --     逐字「P(+500)+R1(-500)+R2(+500) = 500」)⇒ 沖銷回 0 的單**恢復可取消**。
       -- 🛑 而它與上面那道 trigger 是**兩層不同的保護, 不是重複**:
       --    trigger 讓收到錢的單自己離開 `unpaid` 集合 ⇒ 涵蓋 verdict = settled / underpaid;
       --    這一句涵蓋 trigger **刻意不翻**的那兩種(overpaid / needs_human)——
       --    那兩種的錢一樣進來了, 而它們仍然是 `unpaid`。
       --    ⇒ 📌 少了這一句, 「不翻是安全的」這句話**不成立**。
       AND (
             SELECT coalesce(pg_catalog.sum(p.amount), 0)
               FROM public.order_payments p
              WHERE p.order_id = o.id
           ) <= 0
     ORDER BY o.created_at                                            -- 最舊的先處理(可預期、便於分批)
     LIMIT p_limit
     -- 🔴 字面精確(codex 關卡2 nit):SKIP LOCKED 只保證**本函式**跳過已被別人鎖住的列;
     --    若本函式先拿到鎖,後來的 admin 仍會等。稱「互不阻塞」不實,實際是「本函式不等別人」。
     FOR UPDATE OF o SKIP LOCKED
  )
  UPDATE public.orders o
     SET cancelled_at     = pg_catalog.now(),
         cancelled_reason = 'payment_expired',
         updated_at       = pg_catalog.now()
    FROM target t
   WHERE o.id = t.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  -- 🔴 觀測點(plan §4-6 驗收條件):每次執行都留一行,零 PII(只有筆數與上限)。
  --    沒有它的話,「掃到 0 筆」與「這支根本沒被呼叫」在 DB 側分不出來 ——
  --    而 cron.job_run_details 的 return_message 對 SELECT 只會記 command tag、不記筆數。
  RAISE LOG '[expire_unpaid_orders] expired=% limit=%', v_count, p_limit;

  -- ══ ⟦b4-CRON6⟧ 片2 新增:成功心跳 ═════════════════════════════════════════
  -- 🔴🔴 **那個 EXCEPTION 子區塊是本片的重點,不是防禦性裝飾。**
  --    沒有它:心跳表出任何問題(被鎖住 / 被 TRUNCATE / 欄位被改名)⇒ 整個函式拋錯
  --    ⇒ **那一小時的訂單不會被取消** ⇒ 監控把被監控的弄死。
  --    📌 而那正是本檔檔頭那段話要防的事 —— 它差一點由這片自己實現。
  -- ⚠️ 代價明寫:心跳寫失敗時**只留一行 WARNING**,而心跳會開始變舊 ⇒ 後台那一列會亮。
  --    那是**假陽性,而方向是對的**(叫比不叫好),**不得**被讀成「這裡不會出錯」。
  -- 🔴🔴 **而「心跳寫不出去不影響本輪取消」有一個【真的例外】**(codex R1 must-fix ②):
  --    這一列**被別人鎖住**時不會立刻拋錯,它會**等** —— 而此時 orders 那半已經改完。
  --    若這一等撞上 statement_timeout 或人工 cancel(SQLSTATE 57014),
  --    🔴 `EXCEPTION WHEN OTHERS` 依 PostgreSQL 定義**不接** query cancel
  --    ⇒ 例外冒出去 ⇒ **整輪取消一起 rollback**。
  --    ⇒ 正確字面:**心跳自己【出錯】不影響本輪;心跳【被卡住】+ 被取消,會拖垮本輪。**
  --    ⚠️ 本片**沒有修掉這條路**(要動 upsert 的鎖策略,那是另一片)。它是已知殘留風險。
  -- 🔴 只寫成功那三欄;**失敗那一欄一個字都不碰**(理由見檔頭:寫不出去,不是懶得寫)。
  --    ⚠️ 這句刻意不寫出那個欄名 —— 見檔頭「3d 這把尺分不出碼與註解」那段。
  -- 🔴 用 `clock_timestamp()` 不用 `now()`(codex R1 must-fix ③):

  --    `now()` 是**交易起始時間** ⇒ 一個 10:00 開始而跑很久的交易,會用 10:00 蓋掉
  --    另一個 10:05 已經寫好的心跳 ⇒ **`last_success_at` 會倒退**,而畫面上只是「比較舊」。
  --    心跳要的是**觀測時刻**,不是交易時刻。
  -- 🔴 而光換函式不夠,`GREATEST` 那半才是真正擋倒退的(晚到的舊值不得覆蓋新值)。
  BEGIN
    INSERT INTO public.sweeper_heartbeat (job_name, last_success_at, consecutive_failures, updated_at)
    VALUES ('pcm-expire-unpaid-orders', pg_catalog.clock_timestamp(), 0, pg_catalog.clock_timestamp())
    ON CONFLICT (job_name) DO UPDATE
      SET last_success_at      = GREATEST(public.sweeper_heartbeat.last_success_at, excluded.last_success_at),
          consecutive_failures = 0,
          updated_at           = GREATEST(public.sweeper_heartbeat.updated_at, excluded.updated_at);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[expire_unpaid_orders] 心跳寫入失敗(本輪取消不受影響):%', SQLERRM;
  END;

  RETURN v_count;
END;
$function$;

-- ══ 2. COMMENT(逐字取自 20260904230000:553-564, 結尾補一句日界)══════════
COMMENT ON FUNCTION pcm_cron.expire_unpaid_orders(integer) IS
  'M-4b 生命週期 L3(件①):unpaid + 未取消 + **依 payment_channel 分流的逾時** + **無任何非終態 attempt** 的訂單 → 寫 cancelled_at + cancelled_reason=''payment_expired''(不刪資料、不動 payment_status、不碰庫存)。回本次筆數。'
  '🔴 **逾時分流(2026-09-03 Sean 本人逐字拍板)**:tappay = 1 天(逐字不動)· bank_transfer = **5 天**(「乙 5天」)· cash = **5 天**(「甲 跟匯款一樣 5 天」)。'
  '⛔ ~~原本無條件「建立超過 1 天」~~ **作廢** —— 那會把正常等匯款的單殺掉(匯款常要 1-3 天)。'
  '⛔ ~~原本的「⚠️ 重估觸發:…屆時改為依 payment_channel 分流」~~ **已完成, 不要再照它去做**。'
  '🛑 **白名單明列三種**:`none` 與任何未來新增的 channel 一律**不失效**(不失效可逆 · 失效不可逆)。`none` 今天零寫入端;`SELECT count(*) FROM orders WHERE payment_channel=''none''` > 0 的那天要回來看。'
  '🔴 不變量:cancelled ⇒ 無 active attempt(與 admin_cancel_order 步7 同條件)——三處「擋重新結帳」的查詢都靠 active attempt 判定,放寬本條件的人必須同時回頭改那三處,否則「已取消但 charge 在途」會不再被擋 = 雙扣。'
  '⛔ ~~本片【不修】⟦b4-NONCARDPAID1⟧:登記匯款/現金收款不會把 payment_status 翻成 paid ⇒ 已收錢的單仍會被本函式取消~~ **2026-09-04 由 20260904230000 修掉了**'
  '🔴 現況:①`order_payments` AFTER INSERT 掛了 pcm_noncard_settle_recompute ⇒ 收到錢的單會自己離開 unpaid;'
  '②本函式另加一條腿:**已收淨額 SUM(order_payments.amount) > 0 的單一律不取消**(涵蓋 verdict = overpaid / needs_human 那兩種不翻狀態的單)。'
  '🔵 沖銷回 0 之後恢復可取消 —— 那條腿問的是淨額, 不是「有沒有收款列」。'
  '批次上限 p_limit(預設 500、NULL/<=0 退回 1)、FOR UPDATE SKIP LOCKED。只由 pg_cron job pcm-expire-unpaid-orders 呼叫;無任何 client role 可執行。'
  '🔴 **逾時的【日界】(2026-09-06 Sean 逐字「乙」)**:bank_transfer / cash 不是「下單滿 N 天那一刻」, 是**下單那個台北日曆日 + N 天 + 1 天的 00:00(Asia/Taipei)** ⇒ 第 N 天整天都算, 隔天 00:00 才取消。tappay **不適用**(仍是時戳比較 1 天), 那是刻意的。';

-- ── 2b. 權限零漂移(逐字取自 20260904230000:579-599)─────────────────────
DO $post0903$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
     WHERE p.oid = 'pcm_cron.expire_unpaid_orders(integer)'::regprocedure
       AND p.proowner = 'postgres'::regrole
       AND p.prosecdef
       AND p.proconfig @> ARRAY['search_path=""']
  ) THEN
    RAISE EXCEPTION '事後(0903繼承):cron 函式的 owner / SECURITY DEFINER / search_path 漂了;拒繼續';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p,
         LATERAL aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
     WHERE p.oid = 'pcm_cron.expire_unpaid_orders(integer)'::regprocedure
       AND a.grantee <> p.proowner
  ) THEN
    RAISE EXCEPTION '事後(0903繼承):cron 函式有 owner 以外的 grantee;拒繼續';
  END IF;
END
$post0903$;

-- ══ 3. 事後斷言(前五組繼承 20260904230000:760-786, 後兩組是本片新增)══════
DO $post$
DECLARE
  v_src text;
  v_raw text;
  v_flat text;
  v_n integer;
BEGIN
  -- 🔴 codex R1 #3:鎖簽章, 並先確認沒有同名多載(否則 SELECT 會任選一列)
  SELECT count(*) INTO v_n
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'pcm_cron' AND p.proname = 'expire_unpaid_orders';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '事後⓪a:pcm_cron.expire_unpaid_orders 有 % 支同名函式(期望 1)⇒ 本片可能建出了一支多載。', v_n;
  END IF;
  SELECT p.prosrc INTO v_src
    FROM pg_catalog.pg_proc p
   WHERE p.oid = 'pcm_cron.expire_unpaid_orders(integer)'::regprocedure;
  IF v_src IS NULL THEN
    RAISE EXCEPTION '事後⓪b:函式不見了 ⇒ 本片把它弄掉了。';
  END IF;
  v_raw := v_src;   -- 🔵 原始那一份留著給 ⑨ 的主錨用
  v_src := pg_catalog.regexp_replace(v_src, '--[^' || chr(10) || ']*', '', 'g');
  v_flat := pg_catalog.regexp_replace(v_src, '\s+', '', 'g');

  IF pg_catalog.strpos(v_src, 'order_payments') = 0 THEN
    RAISE EXCEPTION '事後①失敗:淨額腿不見了(剝註解後)⇒ 本片把它刪掉了。';
  END IF;
  IF pg_catalog.strpos(v_flat, ')<=0') = 0 THEN
    RAISE EXCEPTION '事後②失敗:淨額腿的比較符不是 `<= 0` ⇒ 方向可能被改反了。';
  END IF;
  IF pg_catalog.strpos(v_src, 'sweeper_heartbeat') = 0 THEN
    RAISE EXCEPTION '事後③失敗:心跳不見了。';
  END IF;
  IF pg_catalog.strpos(v_src, '5 days') = 0 THEN
    RAISE EXCEPTION '事後④失敗:找不到「匯款/現金 5 天」⇒ 本片把 Sean 2026-09-03 拍的東西刪掉了。';
  END IF;
  IF pg_catalog.strpos(v_src, 'payment_channel') = 0 THEN
    RAISE EXCEPTION '事後⑤失敗:payment_channel 分流不見了。';
  END IF;

  -- 🔴 ⑥ 本片新增:日界真的在(少了它 = 本片沒生效, 而前五組照樣全過)
  -- 🔴🔴 **要問到 `'day'` 那個字面, 不只是 `date_trunc(`**(codex R1 #5 打回第一版):
  --    把 `date_trunc('day', …)` 換成 `date_trunc('minute', …)`, 其餘 token 一個不少
  --    ⇒ 舊版斷言**全過**, 而行為變成「下單那一分鐘 + 6 天」才取消, 不是隔天 00:00。
  IF pg_catalog.strpos(v_src, 'Asia/Taipei') = 0
     OR pg_catalog.strpos(v_flat, 'pg_catalog.date_trunc(''day''') = 0
     OR pg_catalog.strpos(v_flat, '+interval''1day''') = 0 THEN
    RAISE EXCEPTION '事後⑥失敗:日界三個零件沒有到齊(Asia/Taipei / date_trunc(''day'') / + interval ''1 day'')⇒ 本片沒有生效, 或只生效了一半。';
  END IF;

  -- 🔴 ⑦ 本片新增:舊述詞的形狀**不得**還在
  --    (防「新的加上去、舊的也留著」—— 那會讓兩個判準同時成立, 而嚴格的那個贏)
  IF pg_catalog.strpos(v_flat, 'o.created_at<pg_catalog.now()-CASEo.payment_channel') > 0 THEN
    RAISE EXCEPTION '事後⑦失敗:舊的時戳比較述詞還在 ⇒ 新舊並存, 嚴格的那個會贏 ⇒ 本片等於沒做。';
  END IF;

  -- 🔵 ⑧ `strpos` 這把尺**不是恆真** —— 現造一個假字串必須回 0
  --    ⚠️ **這一格證不到 ⑦ 的 needle 拼得對不對**(codex R2 #6 說得對:
  --      第二版拿一段自己拼的、含同一個字面的字串去餵同一個 needle ⇒ 只證明「字串包含自己」)。
  --    ⇒ 🔴 **⑦ 的真正對照住在【前置閘 ③c】** —— 那裡拿的是**還沒被覆蓋的舊函式本人**。
  --      這一格只負責「尺不亂報」這一半。
  IF pg_catalog.strpos(v_flat, 'QXNOTINTHISPROBE9142') > 0 THEN
    RAISE EXCEPTION '事後⑧失敗:strpos 對一個現造的假字串也命中 ⇒ 這把尺在亂報。';
  END IF;

  -- 🔴🔴 ⑨ **md5 錨:貼完之後那支函式【逐字】就是本片要的那一版**
  --    上面 ①-⑧ 都是「某個字串在不在」, 而 codex R1 #5 證明了那種問法可以被繞過
  --    (把 `date_trunc('day')` 換成 `('minute')`, token 全在)。
  --    ⇒ ✅ 這一格問的是**整支**:剝註解 + 壓空白後的 md5 必須逐字元相等。
  --    🔬 期望值 `2c4bbe9c55646f5cb9b4fb5347d87b26` = 2026-09-06 在拋棄式 PG 17.10 上
  --      貼完本片之後當場量的(同一個算法, 見 `scripts/probe-expire-day-boundary.sh`)。
  --    ⚠️ **改動本片的函式本體(含本體內的註解)就要重量這個值** ——
  --      而它會自己叫:值不對這一格就紅。
  IF pg_catalog.md5(v_raw) <> '7e1e6764def6738440a1012cbea44f05'
     OR pg_catalog.md5(pg_catalog.regexp_replace(v_src, '\s+', '', 'g')) <> '2c4bbe9c55646f5cb9b4fb5347d87b26' THEN
    RAISE EXCEPTION '事後⑨失敗:貼完的函式 原始md5=% 正規化md5=%(期望 7e1e6764def6738440a1012cbea44f05 / 2c4bbe9c55646f5cb9b4fb5347d87b26)⇒ 貼進去的不是本片這一版。',
      pg_catalog.md5(v_raw), pg_catalog.md5(pg_catalog.regexp_replace(v_src, '\s+', '', 'g'));
  END IF;

  RAISE NOTICE '[20260906600000] 事後斷言全數通過(⓪a/⓪b 簽章與多載 · ①-⑤ 繼承 20260904230000 · ⑥ 日界三零件 · ⑦ 舊述詞已移除 · ⑧ 尺不亂報 · ⑨ 原始+正規化 md5 雙錨)。';
END
$post$;

COMMIT;
