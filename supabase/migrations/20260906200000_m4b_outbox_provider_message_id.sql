-- 20260906200000 · M-4b ⟦b4-NOSENTBODY⟧(貼板 45g):`email_outbox` 加一欄 `provider_message_id`。
--
-- 🛑🛑 **草稿。未 apply。** 🔴 **排在 45f(`20260906190000`)之後。**
--
-- ══════════════════════════════════════════════════════════════════
-- 為什麼(而它只做拍板的那一半)
-- ══════════════════════════════════════════════════════════════════
-- 🔵 **Sean 2026-09-06 03:1x 拍【乙】, 逐字**:「Q-留信: 乙」+「resend.com 按收件人搜尋 有, free方案」
--    ⇒ ⛔ **不留信件全文**(那一欄會裝滿 PII, 而他選了不承擔那個保存期限與存取權的問題)
--    ⇒ ✅ **只存 provider 回的那個 id**。
--
-- 🎯 **它買到什麼**:客服要核對「客人當時收到的是哪一封」時,
--    今天只能到 dashboard **按收件人肉眼翻**;有了 id 就能直接取那一封
--    (`GET /emails/{id}` 的回應含 `html` 與 `text` —— 2026-09-06 親讀官方文件)。
-- 🛑 **它【買不到】什麼(這一句要跟著這支檔走)**:
--    provider 的保存期是 **30 天**(Free/Pro/Scale 同一條, 官方文件逐字)
--    ⇒ 📌 **超過 30 天, 有 id 也取不到** —— 這一欄**縮短不了那個天花板**,
--      它只是把「30 天內要靠人翻」變成「30 天內取得到」。
--    ⇒ 🔴 而**匯款爭議正是會拖過一個月的那種**(板列 ⟦b4-NOSENTBODY⟧)
--      —— 那是**已授權的殘餘風險**, 不是本支的缺陷。
--
-- ══════════════════════════════════════════════════════════════════
-- 🔵 為什麼它【不是 PII】, 而那個判斷要寫出來不能只是宣稱
-- ══════════════════════════════════════════════════════════════════
-- 它是 provider 給的**不透明識別碼**(uuid 形狀), **不含收件人、不含內容、不含金額**。
-- 🛑 **而它是一把【指向 PII 的鑰匙】** —— 拿著它 + provider 的 API key 就取得到那封信的全文。
--    ⇒ 📌 **所以它的 ACL 要與這張表其餘欄位一致(僅 service_role), 不是「反正不是 PII 就放寬」。**
--    ⇒ 事後閘③ 就在量這件事, 而它問的是**欄級**權限(見那一格的註解)。

BEGIN;

-- 🔴 **等鎖最多 5 秒, 等不到就放棄整發**(codex R1-#12)——
--    📌 沒有它, 一個長交易會讓這一發**排在隊伍裡**, 而**它後面的每一個查詢也一起排**。
--    ⇒ 貼板時看到它失敗是**對的**:重貼一次比卡住整張表便宜。
SET LOCAL lock_timeout = '5s';

DO $precondition$
DECLARE v_cnt int;
BEGIN
  -- 前置閘①:那張表要在
  IF pg_catalog.to_regclass('public.email_outbox') IS NULL THEN
    RAISE EXCEPTION '前置閘①:找不到 public.email_outbox';
  END IF;

  -- 前置閘②:forward-only —— 欄已存在就拒重跑
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.email_outbox'::regclass
     AND a.attname = 'provider_message_id'
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '前置閘②:provider_message_id 已存在 ⇒ forward-only,拒重跑';
  END IF;
END
$precondition$;

-- 🔴 **NULL-able 且【沒有 DEFAULT】** —— 兩件事:
--    ① 既有的每一列都是 NULL ⇒ **不需要回填**, 而「NULL」在這裡的意思是
--       **「那封信寄出去的時候我們還沒開始記」**, 不是「provider 沒給」。
--       ⇒ 📌 那兩種世界日後若要分開, 要靠 `sent_at` 與本欄的先後, 不是靠本欄自己。
--    ② 加一個 NULL-able 欄**不重寫整張表**(PG 11+ 對有 DEFAULT 的也不重寫, 而這裡連 DEFAULT 都沒有)
--       ⛔ ~~⇒ 不鎖表、不需要 `lock_timeout` 特別處理。~~
--       🔴 **那句是錯的**(codex R1-#12):`ADD COLUMN` **照樣取 `ACCESS EXCLUSIVE`**,
--         而且**持有到 COMMIT** ⇒ 📌 **「不重寫」與「不鎖表」是兩件事, 我把它們寫成一件。**
--       ✅ 差別在**持有時間**:不重寫 ⇒ 那把鎖是**瞬間**的, 而不是「不存在」。
--         ⇒ 而**等待期仍可能排隊**(它要等既有交易放手)⇒ 下面加 `lock_timeout`。
ALTER TABLE public.email_outbox
  ADD COLUMN provider_message_id text;

-- 🔴 本文用 dollar-quoted 而不是單引號 —— `migration-static-checks` ⑦ 擋下我一次:
--    單引號字串裡若有【行尾的 ASCII 分號】, Supabase SQL Editor 會在字串中間切一刀
--    ⇒ 貼下去 42601, 而**本機與拋棄式 PG 全綠**(那是假說, 兩個資料點與它一致)。
COMMENT ON COLUMN public.email_outbox.provider_message_id IS
  $c$⟦b4-NOSENTBODY⟧(2026-09-06, Sean 拍乙「只存 id、不留全文」):寄送成功時 provider 回的訊息 id。
🔵 非 PII(不透明識別碼, 不含收件人/內容/金額),而它是一把**指向 PII 的鑰匙**
⇒ ACL 與本表其餘欄位一致(僅 service_role),不因為「不是 PII」而放寬。
🛑 **它縮短不了 provider 的 30 天保存期** —— 超過 30 天有 id 也取不到;
那是已授權的殘餘風險(板列 ⟦b4-NOSENTBODY⟧),不是本欄的缺陷。
🔴 **NULL 有兩族成因, 而它們在本欄上分不出來**(codex R1-#11 訂正我原本只寫一族):
①【舊資料】那封信寄出去時我們還沒開始記(45g 貼之前的每一列);
②【新資料而沒拿到】provider 沒回 / 回應超過大小上限 / content-length 看不懂 / 型別或格式不合。
⇒ 要分開它們只能靠 `sent_at` 與 45g 的 apply 時刻比對, **不能靠本欄自己**。
📌 而稽核時把 ② 誤讀成 ① 會得到「我們一直沒開始記」這個假結論。$c$;

DO $postcheck$
DECLARE
  v_notnull boolean;
  v_default text;
  v_cnt     int;
  v_cols    text;
BEGIN
  -- 事後閘①:欄在, 而且是 nullable、無 DEFAULT
  SELECT a.attnotnull, pg_catalog.pg_get_expr(d.adbin, d.adrelid)
    INTO v_notnull, v_default
    FROM pg_catalog.pg_attribute a
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'public.email_outbox'::regclass
     AND a.attname = 'provider_message_id'
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_notnull IS NULL THEN
    RAISE EXCEPTION '事後閘①:加完找不到 provider_message_id';
  END IF;
  IF v_notnull THEN
    RAISE EXCEPTION '事後閘①b:它是 NOT NULL ⇒ 既有列會被擋, 而本支不打算回填';
  END IF;
  IF v_default IS NOT NULL THEN
    RAISE EXCEPTION '事後閘①c:它有 DEFAULT [%] ⇒ 那會讓「還沒開始記」與「provider 給了這個值」分不出來', v_default;
  END IF;

  -- 🔴🔴 事後閘②:**anon / authenticated 讀不到它** —— 而這裡問的是【欄級】權限。
  --    ⛔ ~~`has_table_privilege`~~ **對欄級授權會少報**(2026-09-05 codex R2-MF1 實錘:
  --      `GRANT SELECT (col) ON <rel> TO anon` 之下它回 `f`, 而那個角色**已經讀得到那一欄**)
  --    ⇒ ✅ 用 `has_column_privilege` 直接問那一欄。
  IF pg_catalog.has_column_privilege('anon', 'public.email_outbox', 'provider_message_id', 'SELECT') THEN
    RAISE EXCEPTION '事後閘②a:anon 讀得到 provider_message_id ⇒ 它是一把指向 PII 的鑰匙';
  END IF;
  IF pg_catalog.has_column_privilege('authenticated', 'public.email_outbox', 'provider_message_id', 'SELECT') THEN
    RAISE EXCEPTION '事後閘②b:authenticated 讀得到 provider_message_id';
  END IF;

  -- 🟢 事後閘②c(**正對照**):同一把尺對 `service_role` 要答【讀得到】——
  --    📌 少了這一格, 上面兩個 false 可能只是**這把尺對整張表都回 false**(例如表名打錯)。
  IF NOT pg_catalog.has_column_privilege('service_role', 'public.email_outbox', 'provider_message_id', 'SELECT') THEN
    RAISE EXCEPTION '事後閘②c(正對照):service_role 讀不到 provider_message_id ⇒ 上面兩格的 false 不可信';
  END IF;
  -- 🔴 **而【寫得進】要另外問**(codex R1-#13):我原本只驗 `SELECT` 卻宣稱「寫不進也讀不出」。
  --    📌 **UPDATE 漂掉而 SELECT 還在** ⇒ 這一支全綠, 而 `markSent` **每一發都失敗**。
  IF NOT pg_catalog.has_column_privilege('service_role', 'public.email_outbox', 'provider_message_id', 'UPDATE') THEN
    RAISE EXCEPTION '事後閘②c2:service_role 對 provider_message_id 沒有 UPDATE ⇒ markSent 會每一發都失敗';
  END IF;

  -- 🔵 事後閘②d(**負對照**):同一把尺問一個現造的欄名 —— 它必須【炸】或回 false。
  --    ⚠️ `has_column_privilege` 對不存在的欄會 raise ⇒ 這裡用 exception block 收下來,
  --      而**收不到 exception 才是問題**(代表那把尺對任何欄名都回 true)。
  BEGIN
    IF pg_catalog.has_column_privilege('service_role', 'public.email_outbox', 'zzz_never_a_column', 'SELECT') THEN
      RAISE EXCEPTION '事後閘②d(負對照):現造的欄名居然回 true ⇒ 這把尺壞了, 上面三格不可信';
    END IF;
  EXCEPTION WHEN undefined_column THEN
    NULL; -- ✅ 預期:不存在的欄會 raise ⇒ 那把尺在看真的欄
  END;

  -- 事後閘③:🔴 **本支【只准】加這一欄** ——
  --    ⛔ ~~原本的條件是「總欄數 < 2 就炸」~~ **那形同虛設**(codex R1-#14):
  --      順手多加一個 `email_body text` **照樣通過**, 而那正是這道閘的名字說它要擋的東西。
  --    ✅ 改成**逐名比對**:把本支之外不該出現的欄名列出來, 有任何一個就炸。
  --    🔵 而它只擋**本支這一發**新增的欄 —— 它答不出「別支 migration 加了什麼」, 那是另一件事。
  SELECT string_agg(a.attname, ',' ORDER BY a.attname) INTO v_cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.email_outbox'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attname IN ('email_body', 'body_html', 'body_text', 'rendered_body', 'sent_body');
  IF v_cols IS NOT NULL THEN
    RAISE EXCEPTION '事後閘③:出現了不該有的欄 [%] ⇒ Sean 拍的是【只存 id、不留全文】', v_cols;
  END IF;
END
$postcheck$;

COMMIT;

-- ══════════════════════════════════════════════════════════════════
-- 回退(可執行, 而**會丟資料**)
-- ══════════════════════════════════════════════════════════════════
-- ALTER TABLE public.email_outbox DROP COLUMN provider_message_id;
-- 🔴 **退掉之後那些 id 就沒了** —— 而它們是「30 天內取得回那封信」的唯一鑰匙。
--    ⇒ 📌 退版之前先想清楚:**碼那一半不寫它是無害的(欄留著就好), 而 DROP 是不可逆的。**
-- ✅ **正確的回退單位是【碼】** —— 讓 sender 不再寫它, 這一欄留著。
