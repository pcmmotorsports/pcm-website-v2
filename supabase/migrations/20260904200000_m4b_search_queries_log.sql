-- 🛑 **檔頭第一行:本支【可以獨立貼】** —— 它只新建物件(一張表 + 一支函式),
--    不依賴任何其他 SQL、不需要先部署 TS、不改動任何既有物件。
--    🔴 **而它有【部署順序】**(那是另一件事,不是依賴):
--       本支必須**先**貼進正式庫, TS 那半才能上 —— 反過來的話,
--       每一次搜尋都會被 `after()` 吞掉一次失敗 ⇒ **客人無感, 而語料是空的。**
-- ============================================================
-- M-4b · 搜尋日誌 —— 把客人真的打了什麼記下來
-- `#183` / ⟦search-NOSEARCHLOG⟧ · 2026-09-04 · 線【身分】`-auth`
-- 📎 plan = `~/pcm-mailbox/plan-搜尋日誌-v5-20260904-auth.md`
-- ============================================================
-- ✅ **Sean 2026-09-04 19:3x 拍板(原話逐字, 正本 `~/pcm-mailbox/Sean拍板-20260904-七題.md` 檔尾)**:
--    > Q-搜尋紀錄: 開始記客人打的字, 但【不記是誰打的】?
--    > 甲 = 好, 不記誰 (推薦)
--    ⇒ 📌 **這一板【09-04 甲 取代 08-21】** —— 他 2026-08-21 拍的是「要記, 連誰搜的一起記」。
--       🔵 不是我改了他的拍板, 是把一個他當時沒有的量測(他要的三題不記誰也答得出)端給他, 他重拍。
--    ⇒ 🛑 **而他同時明令:連 IP / user-agent 都不存 —— 那是身分的替身。**
--    ⇒ 📌 政策那一行(「站內搜尋紀錄」列為個資類別)**先不改** —— 留著只是比實際保守,
--       而 `#821` 法遵那半仍待外部專業。**那是對外文字(鐵則 12⑤), 不是我能拍的。**
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🔬 這些閘【被實測殺過】—— 而【哪幾發的全綠不是斷言太弱】也寫出來
-- ══════════════════════════════════════════════════════════════════════════
--    拋棄式 PG(自己造出 Supabase 那種「新物件出生就對三個角色開全權」的世界:
--    `ALTER DEFAULT PRIVILEGES` 對 **TABLES / SEQUENCES / FUNCTIONS 三種都要下**)· 2026-09-04:
--    ```
--    乾淨貼                                       ⇒ rc=0
--    拿掉去重那道 UNIQUE                           ⇒ 紅(`ON CONFLICT` 找不到約束, PG 自己擋)
--    把 created_at 的 date_trunc 拿掉              ⇒ 事後閘⑥d 紅   ← 見下方那段【重要】
--    拿掉 anon 的 GRANT EXECUTE                    ⇒ 🟢 全綠, 而那是對的 ← 見下方
--    GRANT 之後再 REVOKE 掉 anon                   ⇒ 事後閘①a 紅
--    遮罩改成什麼都不遮                            ⇒ 事後閘⑤d 紅
--    給 anon 一個【欄級】SELECT                    ⇒ 事後閘③a2 紅  ← codex must-fix ④ 原場景
--    把 search_path 改成 `public`(可寫的 schema)  ⇒ 事後閘⑤b 紅  ← codex must-fix ⑤ 原場景
--    拿掉 sequence 的 REVOKE                       ⇒ 事後閘④b 紅
--    拿掉表的 service_role REVOKE                  ⇒ 事後閘③c 紅(TRUNCATE 還在, RLS 管不到)
--    拿掉 path 的 CHECK                            ⇒ 事後閘⑦  紅
--    拿掉 service_role 的 SELECT 政策              ⇒ 事後閘③b2 紅(pre-commit RLS 守門逼出來的)
--    收權清單漏列 mask 那支                        ⇒ 收權斷言⓪ 紅(pre-commit 靜態檢查逼出來的)
--    ```
--
--    🔴🔴 **【重要】`date_trunc` 那一發, 我的行為測試【到不了那個世界】**:
--       ⑥c 是「同一個字送兩次, 表裡仍然只有一列」。而 **`now()` 在同一個交易裡是凍住的**
--       ⇒ 換成 `now()` 之後兩發拿到**同一個時間戳** ⇒ UNIQUE 照樣撞 ⇒ **⑥c 印綠**(實測 rc=0)。
--       ⇒ 📌 **一個到不了目標世界的量測, 可能剛好給出正確答案 —— 而那種綠永遠不會被發現。**
--       ✅ 所以 ⑥d 改成**問欄位預設值的字面**, 並在它旁邊把「為什麼只能用字面」寫清楚。
--
--    🔴 **而「拿掉 GRANT ⇒ 全綠」也不是斷言太弱**:
--       Supabase 的預設授權**本來就給** `anon` EXECUTE ⇒ 那一行 GRANT 與平台預設**重複**。
--       🛑 它不是沒用(平台哪天收掉預設, 它讓功能不死), **它只是今天不是唯一來源**。
--       ✅ 真正測得到 ①a 的突變是 **GRANT 之後再 REVOKE**(上表第五列, 紅)。
--    ⇒ 📌 **「突變全綠」有兩種原因:斷言太弱, 或那個突變根本沒壞掉任何東西。先問第二個。**
--
--    ⚠️ **而有兩格是我自己的閘抓到我自己**:
--    ① `⑤b` 第一版寫死 `= 'search_path='`, 而 PG 實際存 `search_path=""` ⇒ **乾淨貼當場紅**。
--       兩種形狀都收, 而**其餘一律不收** —— 不能退回 `LIKE '%search_path=%'`, 那正是 codex 抓的那格。
--    ② 早一輪的鑽機只對 `TABLES` 下了 `ALTER DEFAULT PRIVILEGES` ⇒ sequence 與 function 那兩發
--       第一次都是假的全綠。補完之後**先用一張隨手的表/函式確認 anon 真的拿得到**(正對照 `t|t|t`)。
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🔴🔴 codex must-fix ①(灌爆)—— **我沒有照它的修法改, 而理由不是「我不同意」**
-- ══════════════════════════════════════════════════════════════════════════
--    他說(**對**):「`anon` 可直接無限呼叫 RPC, 自填搜尋字與結果數;攻擊者可污染語料、
--    灌爆資料量。**RLS 擋不到 `SECURITY DEFINER`**(它以 owner 身分跑)。」
--
--    ⛔ ~~我第一版照他改成:EXECUTE 只給 `service_role`, TS 改用 service client~~
--    🛑 **那一版被 lint 擋下來, 而擋它的是一條 Sean 拍過的架構線**:
--       `eslint.config.js` 對 `apps/storefront/**` **整片禁止** import `@pcm/adapters/server`
--       (ADR-0005 §6/§7 · service_role key 三層防)。既有唯一例外
--       `apps/storefront/src/lib/auth/line-admin.ts:32` 逐字寫著:
--       **「多開第五道門 = 要 Sean 拍板 + ADR 記錄的事, 不是實作窗自己批得了的」。**
--    ⇒ 🎯 **這是【一個安全片的修法撞到另一道安全線】, 不是我忘了。**
--
--    ✅ **我選的**:留在 `anon`(= plan v5 §3, Sean 批過的那一版)+ **在 DB 那一層加去重**:
--       `created_at` 是**整點** + `UNIQUE (query_raw, path, created_at)`
--       ⇒ **同一個字每小時最多留一列** ⇒ 灌爆的成本從「無限列」降成「無限個【不同的字】」。
--    🛑 **而那【不是零】** —— 攻擊者仍可送無限個不同的字。
--       ⇒ 📌 **殘餘風險我不自宣接受**:板列 `⟦search-LOGFLOOD⟧`,
--          而「要不要為它開第五道門(service_role 例外)」**是要 Sean 拍的**, 已端。
--
--    🔴 **而 GRANT 給 `anon` 與 TS 那半【成對】**:`search-log.ts` 走 `createSupabaseAnonClient()`。
--       改成別的 client ⇒ **每一筆都被權限擋掉、被 `after()` 吞掉, 而畫面完全正常、語料永遠是空的。**
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🔴 保存期限:2 年是 Sean 2026-08-21 拍的, **而本支【不做刪除排程】**
-- ══════════════════════════════════════════════════════════════════════════
--    ⇒ 📌 **一個寫在註解裡而沒有東西在跑的保存期限 = 沒有保存期限。**
--    ⇒ 年限寫進 `COMMENT ON TABLE`(給下一個人看), **而刪除排程另開一列**,
--       不假裝本支做了它。
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🔴 這張表【分不出人和機器人】—— 寫在這裡, 免得日後被當成流量統計
-- ══════════════════════════════════════════════════════════════════════════
--    `?search=` 網址可分享、可被爬, 而顧客站 bot 防護是**只記錄模式**
--    ⇒ 熱門字排行會被重抓灌高, 而表上**零欄位**看得出來。
--    ⇒ 📌 **它是【語料】, 不是流量統計。**

BEGIN;

-- ── 前置閘:本支只新建, 不得覆蓋任何既有東西 ──────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.search_queries') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘①:public.search_queries 已經存在 ⇒ 本支已經貼過了, 或有人先建了一張同名的 ⇒ 停下來看, 不要往上蓋。';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'log_search_query'
  ) THEN
    RAISE EXCEPTION '前置閘②:public.log_search_query 已經存在 ⇒ 停。';
  END IF;
  -- 🔵 三個角色都要在 —— 少了任何一個, 下面的 GRANT/REVOKE 會炸在半路,
  --    而**炸在半路比一開始就停危險**(前面的 DDL 已經生效)。
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    RAISE EXCEPTION '前置閘③a:找不到角色 anon';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RAISE EXCEPTION '前置閘③b:找不到角色 authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION '前置閘③c:找不到角色 service_role';
  END IF;
END
$$;

-- ── 表 ────────────────────────────────────────────────────────────────────
-- 🔴 **沒有 `customer_user_id`** —— plan §0:他要的三題都不需要身分,
--    而需要身分的那一題(買過 X 的人搜什麼)是 Phase 3 的 `#187`。
CREATE TABLE public.search_queries (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  query_raw    text        NOT NULL CHECK (btrim(query_raw) <> '' AND length(query_raw) <= 100),
  path         text        NOT NULL CHECK (path IN ('keyword','capsule')),
  unmatched    text                 CHECK (unmatched IS NULL OR length(unmatched) <= 100),
  result_count integer              CHECK (result_count IS NULL OR result_count >= 0),
  created_at   timestamptz NOT NULL DEFAULT date_trunc('hour', now()),
  -- 🔴🔴 **同一個字每小時最多留一列**(2026-09-04 codex must-fix ① 的替代修法)——
  --    `created_at` 是**整點** ⇒ 這道 UNIQUE 把「無限灌同一個字」變成**每小時一列**。
  --    🎯 灌爆的成本從「無限列」降成「無限個【不同的字】」。
  --    ⚠️ **代價要寫出來, 不要藏**:我們因此**數不出「同一個字被搜了幾次」** ——
  --       只數得出「有幾個小時出現過它」。而本表的用途是**語料**(Sean 逐字「字詞我們慢慢追加」),
  --       不是流量統計 ⇒ 這個代價是可接受的;**要頻率的那天要另外設計, 不要偷偷把這道拿掉。**
  --    🛑 `unmatched` / `result_count` **不在鍵裡** ⇒ 同一小時的第二筆整個被丟掉(含它的 unmatched)。
  UNIQUE (query_raw, path, created_at)
);

COMMENT ON TABLE public.search_queries IS
  '客人在顧客站打的搜尋字(語料, 不是流量統計)。'
  '🔴 刻意不含任何指向個人的欄位 —— Sean 2026-09-04 拍 Q1(plan v5 §0)。'
  '🔴 保存期限 2 年(Sean 2026-08-21 拍), 而【本支沒有做刪除排程】—— '
  '一個沒有東西在跑的保存期限等於沒有保存期限, 排程另開一列。'
  '🔴 分不出人和機器人:網址可被爬而 bot 防護是只記錄模式 ⇒ 熱門字排行會被灌高。';
COMMENT ON COLUMN public.search_queries.path IS
  'keyword=打字搜尋 / capsule=膠囊那條路。🔵 獨立一欄、不用 result_count IS NULL 代表 —— '
  '一個「代表沒有」的值與真值長得一樣。';
COMMENT ON COLUMN public.search_queries.unmatched IS
  '膠囊那條路上【沒被解析掉】的字 ⇒ 「我們的分類缺什麼」的直接訊號。這一欄是本線要的東西。';

-- 🔵 RLS 開著而**一條 policy 都不給**。
-- 🔴🔴 **[2026-09-04 codex nit 訂正 —— 舊字面留痕]**
--    ⛔ ~~「= 對所有不 BYPASSRLS 的角色一律拒絕」~~ **那句話是錯的**:
--    **表的 owner 預設也繞過 RLS**(`ALTER TABLE … FORCE ROW LEVEL SECURITY` 才收得掉),
--    而**本檔那支 `SECURITY DEFINER` 函式正是以 owner 的身分執行** ⇒ 它本來就不受 RLS 管。
--    ⇒ 📌 所以 RLS 在這裡**只是第三道**, 而且它擋的角色比我原本寫的少。
--    🛑 主要防線是下面的 REVOKE(RLS 連 TRUNCATE 都管不到), 第二道是「只有 service_role 叫得動那支函式」。
ALTER TABLE public.search_queries ENABLE ROW LEVEL SECURITY;

-- 🔴🔴 **而 `service_role` 要一條【明寫的】SELECT 政策 —— 這一格是 pre-commit 守門逼出來的。**
--    它逐字說明了為什麼:今天 service_role 讀得到, 是因為它帶 **`BYPASSRLS`**,
--    而那是**平台角色屬性、不是我寫的政策**。
--    ⇒ 🛑 哪天那個屬性被收掉(而「收掉 BYPASSRLS」正是一種很像正確的安全強化),
--       這張表會變成 **後台讀到空的** —— 而**空資料看起來像正常資料, 沒有人會叫**。
--    🔬 守門自己報:正式庫現在已經有 **42 張**這樣的表。
--    ⇒ ✅ 所以政策要明寫, 不靠平台屬性。
CREATE POLICY search_queries_select_service_role ON public.search_queries
  FOR SELECT TO service_role USING (true);

-- ── 收權(表)────────────────────────────────────────────────────────────
-- 🔴🔴 **`service_role` 一定要顯式 REVOKE** —— 它出生自帶 `Dxtm`(含 TRUNCATE),
--    而 **`TRUNCATE` 不受 RLS 管** ⇒ 只開 RLS 擋不住它。
REVOKE ALL ON TABLE public.search_queries FROM PUBLIC;
REVOKE ALL ON TABLE public.search_queries FROM anon;
REVOKE ALL ON TABLE public.search_queries FROM authenticated;
REVOKE ALL ON TABLE public.search_queries FROM service_role;
GRANT SELECT ON TABLE public.search_queries TO service_role;   -- 以後撈語料用, 不給寫不給刪

-- ── 收權(IDENTITY 另建的那支 sequence)──────────────────────────────────
-- 🔴🔴 **表上的 REVOKE 收不到它, 而 sequence 沒有 RLS** ——
--    留著的話 anon 叫得動 `nextval()`。名字用 `pg_get_serial_sequence()` 查, **不要憑慣例拼**。
DO $$
DECLARE v_seq text;
BEGIN
  v_seq := pg_get_serial_sequence('public.search_queries', 'id');
  IF v_seq IS NULL THEN
    RAISE EXCEPTION '收權:查不到 id 那一欄的 sequence ⇒ 停(不要假設它叫 search_queries_id_seq)';
  END IF;
  EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role', v_seq);
END
$$;

-- ── 遮罩:客人可能把個資打進搜尋框(2026-09-04 codex must-fix ②)────────────
-- 🔴🔴 **而這一格【只遮得掉 email】, 而我把做不到的那半也寫出來**:
--    ✅ **email 遮得掉** —— 它的形狀(`x@y.z`)**不可能是料號**, 所以遮它零誤傷。
--    🛑 **電話遮不掉** —— 台灣手機是 10 位數字, 而**料號也可以是 10 位數字**
--       (`20260904180000` 那支剛把「7 位以上的純數字」放進料號那條路!)
--       ⇒ 📌 **遮電話會把料號一起遮掉, 而那正是這條線要收的語料。**
--       ⇒ 🔴 **所以這是一個【真的殘餘風險】, 不是我沒想到** —— 板列 `⟦search-LOGPHONEPII⟧`。
--    🛑 **姓名遮不掉** —— 中文姓名與商品名在字元層完全無法分辨。
--    ⇒ 🎯 **准許句:過了這一格只能說「明顯的 email 被遮掉了」, 不得說「這張表不含個資」。**
CREATE FUNCTION public.mask_obvious_pii(p_in text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $mask$
  SELECT CASE WHEN p_in IS NULL THEN NULL ELSE
    regexp_replace(p_in, '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}', '[email]', 'gi')
  END;
$mask$;
REVOKE ALL ON FUNCTION public.mask_obvious_pii(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mask_obvious_pii(text) FROM anon;
REVOKE ALL ON FUNCTION public.mask_obvious_pii(text) FROM authenticated;
REVOKE ALL ON FUNCTION public.mask_obvious_pii(text) FROM service_role;

-- ── 記一筆的函式 ──────────────────────────────────────────────────────────
-- 🔴 `SECURITY DEFINER` 是**刻意的**:anon 對那張表零權限, 只能透過這支寫。
-- 🔴 `SET search_path = ''` 是**必要的**:DEFINER + 可變 search_path = 提權面
--    ⇒ 所以body 裡每一個物件都寫全名。
CREATE FUNCTION public.log_search_query(
  p_query_raw    text,
  p_path         text,
  p_unmatched    text    DEFAULT NULL,
  p_result_count integer DEFAULT NULL
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $fn$
  INSERT INTO public.search_queries (query_raw, path, unmatched, result_count)
  VALUES (
    -- 🔵 兩端都截:CHECK 會擋掉過長的, 而**擋掉 = 那一筆語料消失**
    --    ⇒ 這裡先截成合法的, 讓它進得去。截斷長度與 CHECK 一致(100)。
    -- 🔴🔴 **遮掉 email(2026-09-04 codex must-fix ②)** —— 而它做在【DB 這一層】,
    --    不是做在 TS:呼叫端可能不只一個, 而遮罩漏在任何一個呼叫端上都沒有東西會叫。
    left(btrim(public.mask_obvious_pii(p_query_raw)), 100),
    p_path,
    left(public.mask_obvious_pii(p_unmatched), 100),
    p_result_count
  )
  -- 🔴 撞到那道 UNIQUE 就靜靜跳過 —— **不得讓它變成一個 error**:
  --    呼叫端是 fire-and-forget, 而「同一小時第二次搜同一個字」是**完全正常的客人行為**,
  --    讓它進 log 會把真的失敗淹掉。
  ON CONFLICT (query_raw, path, created_at) DO NOTHING;
$fn$;

-- 🔴 函式**出生就對 PUBLIC 開 EXECUTE** ⇒ 先收再給。
-- 🔴 灌爆那條 must-fix 的處置見檔頭那一節(留 anon + 每小時去重, 而殘餘風險已開板列)。
REVOKE ALL ON FUNCTION public.log_search_query(text, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_search_query(text, text, text, integer) FROM authenticated;
REVOKE ALL ON FUNCTION public.log_search_query(text, text, text, integer) FROM service_role;
-- 🔴🔴 **ACL 守門要求為這一行寫理由 —— 而理由不是「我想這樣」, 是【另一道安全線不准我用 service_role】**:
--    顧客站(`apps/storefront/**`)被 `eslint.config.js` **整片禁止** import `@pcm/adapters/server`
--    (ADR-0005 §6/§7 · service_role key 三層防), 而既有唯一例外那支自己寫著
--    「多開第五道門 = 要 Sean 拍板 + ADR 記錄」⇒ 我開不了, 也不該自己開。
--    ⇒ 所以記 log 這一發只能是 `anon`, 而灌爆風險改用「每小時去重」壓(見檔頭那節)。
--    🛑 **而守門說得對的那半我不反駁**:apply 之後**沒有任何東西會再量這一行**。
--       今天看得見它壞掉的只有 `⟦search-LOGSILENTZERO⟧` 那格告警, **而那格還沒做。**
-- ACL-GATE-EXEMPT: public.log_search_query -- 顧客站禁 import adapters/server(ADR-0005), 只能走 anon;灌爆改用每小時去重壓(⟦search-LOGFLOOD⟧, 20260904200000, 2026-09-04)
GRANT EXECUTE ON FUNCTION public.log_search_query(text, text, text, integer) TO anon;

-- ── 事後閘 ────────────────────────────────────────────────────────────────
DO $$
DECLARE
  -- 🔴🔴 **本檔新建的每一個【可授權物件】都列在這裡 —— 而這一格是 pre-commit 守門逼出來的。**
  --    ⛔ ~~我原本兩份清單都是空的~~ —— 那是從**上一支 migration** 抄來的形狀,
  --       而那一支只 `CREATE OR REPLACE` 一支既有函式(ACL 原樣保留)⇒ 它的空清單是**對的**。
  --    🛑 **本檔建了 3 個**(1 張表 + 2 支函式)⇒ 空清單等於**宣稱沒有收權面, 而那是假的**。
  --    ⇒ 📌 **抄一個形狀時, 連它成立的【前提】一起抄** —— 那個前提在這裡不成立。
  --    🔵 守門自己的字面:「收權斷言**只檢查你列出來的物件**:它防『忘記收權』, 不防『忘記列』。」
  v_relations text[] := ARRAY['public.search_queries'];
  v_functions text[] := ARRAY[
    'public.log_search_query(text,text,text,integer)',
    'public.mask_obvious_pii(text)'
  ];
  v_obj  text;
  v_seq  text;
  v_acl  text;
  v_cnt  bigint;
  v_code text;
  v_ok   boolean;
  v_role text;
  v_priv text;
BEGIN
  -- ⓪ 🔵 正對照:清單不得是空的 —— 空清單會讓下面整圈**一次都不跑而全綠**。
  IF cardinality(v_relations) + cardinality(v_functions) <> 3 THEN
    RAISE EXCEPTION '收權斷言⓪:清單長度是 %(期望 3)⇒ 有人加了物件而沒列進來, 或列了不存在的。',
      cardinality(v_relations) + cardinality(v_functions);
  END IF;
  FOREACH v_obj IN ARRAY v_relations LOOP
    IF to_regclass(v_obj) IS NULL THEN
      RAISE EXCEPTION '收權斷言①:清單上的 % 不存在 ⇒ 清單與實際建的東西對不起來。', v_obj;
    END IF;
  END LOOP;
  FOREACH v_obj IN ARRAY v_functions LOOP
    IF to_regprocedure(v_obj) IS NULL THEN
      RAISE EXCEPTION '收權斷言②:清單上的 % 不存在 ⇒ 清單與實際建的東西對不起來。', v_obj;
    END IF;
    IF has_function_privilege('authenticated', v_obj, 'EXECUTE') THEN
      RAISE EXCEPTION '收權斷言③:authenticated 對 % 有 EXECUTE。', v_obj;
    END IF;
    -- 🔵 `log_search_query` 對 anon 是**刻意**的(見檔頭那節);其餘一律不得。
    IF v_obj <> 'public.log_search_query(text,text,text,integer)'
       AND has_function_privilege('anon', v_obj, 'EXECUTE') THEN
      RAISE EXCEPTION '收權斷言④:anon 對 % 有 EXECUTE, 而它不在例外名單上。', v_obj;
    END IF;
  END LOOP;

  -- ① 🔴 **兩個方向都要** —— 少了正向, 全部 REVOKE 掉也會綠(功能死掉沒人知道);
  --    少了反向, 漏一行 REVOKE 也會綠。
  IF NOT has_function_privilege('anon', 'public.log_search_query(text,text,text,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION '事後閘①a:anon 執行不到這支函式 ⇒ 顧客站記不了任何一筆, 而畫面完全正常。';
  END IF;
  IF has_function_privilege('authenticated', 'public.log_search_query(text,text,text,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION '事後閘①b:authenticated 執行得到 ⇒ REVOKE 漏了(而①a 對這件事沒有判別力)。';
  END IF;
  IF has_function_privilege('service_role', 'public.log_search_query(text,text,text,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION '事後閘①c:service_role 執行得到 ⇒ REVOKE 漏了。';
  END IF;
  IF has_function_privilege('anon', 'public.mask_obvious_pii(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.mask_obvious_pii(text)', 'EXECUTE') THEN
    RAISE EXCEPTION '事後閘①d:mask_obvious_pii 對 anon/authenticated 開著。';
  END IF;

  -- ② PUBLIC 不得留在函式的 ACL 裡(`{=X/...}` 那種空 grantee 就是 PUBLIC)
  SELECT coalesce(p.proacl::text, '') INTO v_acl
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'log_search_query';
  IF v_acl = '' THEN
    RAISE EXCEPTION '事後閘②⓪:函式 proacl 是 NULL ⇒ 那代表【回到預設】= PUBLIC 叫得動。';
  END IF;
  IF v_acl LIKE '%{=%' OR v_acl LIKE '%,=%' THEN
    RAISE EXCEPTION '事後閘②a:PUBLIC 出現在函式 ACL 裡 ⇒ %', v_acl;
  END IF;

  -- ③ 表:🔴🔴 **[2026-09-04 codex must-fix ④ 改寫 —— 舊字面留痕]**
  --    ⛔ ~~原本只問 anon 的四項(SELECT/INSERT/UPDATE/DELETE)~~
  --    🛑 那把尺漏了三種**照樣會漏權**的形狀:
  --       ① `TRUNCATE` / `REFERENCES` / `TRIGGER`(anon 拿到 TRUNCATE ⇒ 整張表可被清掉, 而 RLS 管不到)
  --       ② **欄級授權** —— `GRANT SELECT (query_raw)` 不會讓 `has_table_privilege` 變 true
  --       ③ **`authenticated` 完全沒被問過**
  --    ⇒ ✅ 改成:兩個角色 × 七種權限逐項問, 外加欄級 `has_any_column_privilege`。
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF has_table_privilege(v_role, 'public.search_queries', v_priv) THEN
        RAISE EXCEPTION '事後閘③a:% 對 search_queries 還有 % ⇒ 它應該一項都沒有(只能透過函式寫)。', v_role, v_priv;
      END IF;
    END LOOP;
    -- 🔴 欄級那一層:`has_table_privilege` 對 `GRANT SELECT (col)` **回 false** ⇒ 它看不見這種漏。
    IF has_any_column_privilege(v_role, 'public.search_queries', 'SELECT')
       OR has_any_column_privilege(v_role, 'public.search_queries', 'INSERT')
       OR has_any_column_privilege(v_role, 'public.search_queries', 'UPDATE')
       OR has_any_column_privilege(v_role, 'public.search_queries', 'REFERENCES') THEN
      RAISE EXCEPTION '事後閘③a2:% 有【欄級】授權 ⇒ 上面那一圈表級的問法看不見它。', v_role;
    END IF;
  END LOOP;
  -- 🔵 正對照:service_role 的 SELECT 必須【在】 —— 否則③a 在「這張表誰都沒權限」的世界裡照樣綠
  IF NOT has_table_privilege('service_role', 'public.search_queries', 'SELECT') THEN
    RAISE EXCEPTION '事後閘③b:service_role 讀不到 ⇒ ③a 沒有判別力(而且以後撈不了語料)。';
  END IF;
  -- 🔴 而那條 SELECT 政策要真的在 —— 少了它, service_role 今天靠 BYPASSRLS 照樣讀得到,
  --    而那個「照樣讀得到」正是它壞掉時不會出聲的原因。
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
     WHERE c.relname = 'search_queries' AND pol.polname = 'search_queries_select_service_role'
  ) THEN
    RAISE EXCEPTION '事後閘③b2:service_role 的 SELECT 政策不在 ⇒ 它今天靠 BYPASSRLS 讀得到, 而那不是我們寫的保證。';
  END IF;
  -- 🔴 而 TRUNCATE 必須被收掉 —— RLS 管不到它
  IF has_table_privilege('service_role', 'public.search_queries', 'TRUNCATE') THEN
    RAISE EXCEPTION '事後閘③c:service_role 還有 TRUNCATE ⇒ 它出生自帶的 Dxtm 沒收乾淨, 而 RLS 管不到 TRUNCATE。';
  END IF;

  -- ④ IDENTITY 那支 sequence
  v_seq := pg_get_serial_sequence('public.search_queries', 'id');
  IF v_seq IS NULL THEN
    RAISE EXCEPTION '事後閘④a:查不到 sequence';
  END IF;
  IF has_sequence_privilege('anon', v_seq, 'USAGE')
     OR has_sequence_privilege('anon', v_seq, 'SELECT')
     OR has_sequence_privilege('anon', v_seq, 'UPDATE') THEN
    RAISE EXCEPTION '事後閘④b:anon 對 % 還有權限 ⇒ 表上的 REVOKE 收不到 sequence, 而 sequence 沒有 RLS。', v_seq;
  END IF;

  -- ⑤ 函式必須是 DEFINER 且 search_path 被釘死
  SELECT p.prosecdef, array_to_string(p.proconfig, ',') INTO v_ok, v_code
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'log_search_query';
  IF NOT v_ok THEN
    RAISE EXCEPTION '事後閘⑤a:函式不是 SECURITY DEFINER ⇒ anon 對表零權限 ⇒ 它一筆都寫不進去。';
  END IF;
  -- 🔴🔴 **[2026-09-04 codex must-fix ⑤ 改寫 —— 舊字面留痕]**
  --    ⛔ ~~只問 `LIKE '%search_path=%'`~~ ⇒ 🛑 **它只問「有沒有釘」, 不問「釘成什麼」**
  --       ⇒ 有人改成 `SET search_path = public` 或任何**可寫的 schema**, 這道閘照樣綠,
  --         而那正是 `SECURITY DEFINER` 提權的標準路徑。
  --    ⇒ ✅ 改成**逐字釘死**:唯一允許的值是空字串。
  -- ⚠️ **PG 存的字面有兩種形狀**:`search_path=` 與 `search_path=""`(實測 PG 17 存後者)。
  --    ⇒ 兩個都收, 而**其餘一律不收** —— 這裡不能寫 `LIKE '%search_path=%'`, 那正是被 codex 抓的那格。
  IF coalesce(v_code, '') NOT IN ('search_path=', 'search_path=""') THEN
    RAISE EXCEPTION '事後閘⑤b:DEFINER 的 search_path 不是【空字串】⇒ 那是提權面。proconfig=%', coalesce(v_code, '(NULL)');
  END IF;
  -- 🔵 遮罩那支也是 DEFINER 面的一部分(它被 DEFINER 函式呼叫)⇒ 同樣要釘。
  SELECT array_to_string(p.proconfig, ',') INTO v_code
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'mask_obvious_pii';
  IF coalesce(v_code, '') NOT IN ('search_path=', 'search_path=""') THEN
    RAISE EXCEPTION '事後閘⑤c:mask_obvious_pii 的 search_path 不是空字串。proconfig=%', coalesce(v_code, '(NULL)');
  END IF;
  -- 🔴 而遮罩要**真的會遮** —— 一支 `RETURN p_in` 的實作在上面每一格都是綠的。
  IF public.mask_obvious_pii('找 a.b@c.com 的東西') NOT LIKE '%[email]%' THEN
    RAISE EXCEPTION '事後閘⑤d:遮罩沒把 email 遮掉 ⇒ %', public.mask_obvious_pii('找 a.b@c.com 的東西');
  END IF;
  -- 🟢 負對照:一個【不是 email】的字串不得被動到 —— 否則「整串換成 [email]」也會過。
  IF public.mask_obvious_pii('01-0110058 排氣管') <> '01-0110058 排氣管' THEN
    RAISE EXCEPTION '事後閘⑤e:遮罩把不是 email 的東西也改掉了 ⇒ %', public.mask_obvious_pii('01-0110058 排氣管');
  END IF;

  -- ⑥ 🔴🔴 **行為閘 —— 而它必須不留痕**:在同一個交易裡寫一筆、驗它進去了、再刪掉。
  --    📌 只驗權限不驗行為的話,「函式存在而 INSERT 寫錯欄位」會全綠。
  PERFORM public.log_search_query('__gate_probe__', 'keyword', NULL, 0);
  SELECT count(*) INTO v_cnt FROM public.search_queries WHERE query_raw = '__gate_probe__';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '事後閘⑥a:透過函式寫了一筆而表裡有 % 列(期望 1)⇒ 這支函式沒有真的寫進去。', v_cnt;
  END IF;
  -- 🔴🔴 **⑥c 去重那道 UNIQUE 要真的會擋** —— 同一個字再送一次, 表裡仍然只有一列。
  --    少了這一格, 那道 UNIQUE 沒建上也全綠(而它是 must-fix ① 的整個替代修法)。
  PERFORM public.log_search_query('__gate_probe__', 'keyword', NULL, 99);
  SELECT count(*) INTO v_cnt FROM public.search_queries WHERE query_raw = '__gate_probe__';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '事後閘⑥c:同一個字在同一小時送第二次, 表裡變成 % 列(期望 1)⇒ 去重那道 UNIQUE 沒生效。', v_cnt;
  END IF;
  -- 🟢 而它不得是「第二發根本沒進函式」—— 換一個【不同的字】必須真的多一列。
  PERFORM public.log_search_query('__gate_probe3__', 'keyword', NULL, 0);
  SELECT count(*) INTO v_cnt FROM public.search_queries;
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION '事後閘⑥c2:換一個不同的字之後表裡有 % 列(期望 2)⇒ 去重擋過頭了, 連不同的字都寫不進去。', v_cnt;
  END IF;
  DELETE FROM public.search_queries WHERE query_raw IN ('__gate_probe__', '__gate_probe3__');

  -- ⑥d 🔴🔴 **`created_at` 必須是【整點】—— 而這一格只能用【字面】檢查, 理由要寫出來:**
  --    ⑥c 那發行為測試**到不了那個世界** —— `now()` 在**同一個交易裡是凍住的**
  --    ⇒ 把 `date_trunc('hour', now())` 換成 `now()`, ⑥c 照樣只看到一列 ⇒ **它印綠**(實測 rc=0)。
  --    ⇒ 📌 **一個到不了目標世界的量測, 可能剛好給出正確答案, 而那種綠永遠不會被發現。**
  --    ✅ 所以這裡改問**欄位的預設值字面**:少了 `date_trunc` ⇒ 去重的粒度變成「微秒」
  --       ⇒ 那道 UNIQUE **等於不存在**(而 must-fix ① 的整個替代修法就靠它)。
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_code
    FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
   WHERE d.adrelid = 'public.search_queries'::regclass AND a.attname = 'created_at';
  IF coalesce(v_code, '') NOT LIKE '%date_trunc%' THEN
    RAISE EXCEPTION '事後閘⑥d:created_at 的預設值不含 date_trunc ⇒ 去重粒度變成微秒 ⇒ 那道 UNIQUE 等於不存在。預設值=%', coalesce(v_code, '(無)');
  END IF;
  -- 🟢 負對照:這把尺會不會對任何東西都說「含 date_trunc」
  IF coalesce(v_code, '') LIKE '%zzz這個字串不存在%' THEN
    RAISE EXCEPTION '事後閘⑥d2:負對照命中了 ⇒ 上面那個 LIKE 是恆真的。';
  END IF;
  SELECT count(*) INTO v_cnt FROM public.search_queries;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '事後閘⑥b:清完探針之後表裡還有 % 列 ⇒ 本支留痕了。', v_cnt;
  END IF;

  -- ⑦ 🟢 負對照:`path` 只認兩個值 —— 餵第三個必須被 CHECK 擋掉。
  --    少了這一格, 一個「CHECK 根本沒建上」的世界與現在長一樣。
  BEGIN
    PERFORM public.log_search_query('__gate_probe2__', '不是合法的path', NULL, 0);
    RAISE EXCEPTION '事後閘⑦:餵了一個非法的 path 而它【寫進去了】⇒ CHECK 沒生效。';
  EXCEPTION
    WHEN check_violation THEN
      NULL;  -- 🟢 這才是對的:它該被擋下
  END;
  SELECT count(*) INTO v_cnt FROM public.search_queries;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '事後閘⑦b:負對照跑完表裡有 % 列 ⇒ 有東西漏進去了。', v_cnt;
  END IF;
END
$$;

COMMIT;
