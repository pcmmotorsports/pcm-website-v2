-- 20260909040000_m4b_q74b_dealer_rpc_add_p_terms.sql
-- 🔴 [2026-09-09 撞號改號] ⛔ ~~20260909030000~~ ⇒ ✅ 20260909040000
--   成因:money 線同一夜也用了 20260909030000(invoice5pct 那支), 而【merge 不跑 pre-commit】
--   ⇒ 那道撞號閘在合併的路徑上沒有機會叫, 兩支同號一起上了 dev。
--   為什麼改的是【我這一支】:money 的貼板包 109 已經做好且指著他那支;我這支還沒打包。
--   🔵 而改號對本片零副作用 —— 本片的順序約束是「必須在 20260909010000 之後」, 040000 仍然滿足。
-- ⟦M-4b · Q74-b⟧ 經銷目錄 RPC 補 `p_terms` —— 讓它與一般價那支【同簽章】
--
-- 為什麼要有這一片(一句):`20260909010000` 給【一般價】那支加了 `p_terms`(12 參 ⇒ 13 參),
--   而 `search_catalog_by_vehicle_dealer` 沒有 ⇒ 🔴 **兩支的簽章分岔。**
--   `apps/storefront/src/lib/products.ts:495` 收 `rpcName`、`:501` 一次 `client.rpc(rpcName, {…})`
--   ⇒ **兩支共用同一組參數物件** ⇒ 前端那一半一上線開始送 `p_terms`,經銷那條路會拿 `PGRST202`。
--   🛑 **而今天經銷會員 0 人 ⇒ 沒有人會叫它, 也不會有任何一把尺紅** ——
--      📌 **那正是這個缺口躲過所有守門的方式, 不是它比較小。**
--
-- 本片做什麼(兩件, 沒有第三件):
--   ① DROP 12 參那支經銷函式, CREATE 13 參那支(加參數會產生【新的多載】不是取代
--      ⇒ 不 DROP 就會變成兩個多載 ⇒ PostgREST `PGRST203` 歧義)
--   ② 新 body = 一般價那支的【13 參新 body】+ 同樣那兩塊身分閘標記區 + view 名換成 dealer
--      ⇒ 逐字複本的性質【一個字都沒有放寬】, 事後閘 A3 照舊反向重建比 md5
--
-- 🔴🔴 **順序約束(不可換)**:本片【必須】在 `20260909010000` 貼進正式庫之後才貼。
--   理由是機械的:前置閘 P1 釘的是那支的【新】body md5 `f84d53d68827e5839fcef3310289d45e`,
--   而在 `20260909010000` 貼上去之前, 庫上那支的 md5 是舊的 `336beaff1188c7670e85134db5aa623b`
--   ⇒ 先貼本片 ⇒ P1 當場 RAISE ⇒ 整筆回滾。**那是刻意的, 不是意外。**
--
-- 🔵 **md5 的算法改了, 而這是【訂正】不是偏好**(codex R3 打出來的, `20260909010000` 帶過來):
--   ⛔ ~~裸 `md5(prosrc)`~~(既有 `20260908010000` 八處全是這種)
--   ✅ `md5(replace(prosrc, chr(13), ''))`
--   📌 理由:貼入管道若把行尾正規化成 CRLF, **語意完全相同的函式會被 md5 閘擋下**
--      ⇒ 安全被換成不可部署。⚠️ **而今天兩種算法同值**(正式庫那份 prosrc 的 `\r` 數是 0
--      —— 三個來源對 12 參那支都得 `336beaff…`:repo 檔算的 / 真 PG 印的 / 主視窗正式庫唯讀量的)
--      ⇒ **這個不一致今天不會咬人, 而它是潛伏的。本片把它收斂成一種寫法。**
--
-- 🔬 **本片那個期望值我自己重現過**(不是照抄 `shop` 給的):
--   從 `20260909010000` 的檔面抽出 13 參 body ⇒ 長度 21,876 ⇒ `md5(去 CR)` = `f84d53d68827e5839fcef3310289d45e`
--   ⇒ 與 `shop` 在拋棄式 PG 上真的建出來再問 `pg_proc` 印的**逐字相同**(它 harness 第 45 格)。
--   ⇒ 📌 **三個獨立來源同值** —— repo 檔算的 / 真 PG 印的 / 我自己重算的。
--
-- 🛑 **本片證不到什麼**(寫在這裡, 不要被讀成已驗):
--   ① 我**沒有在正式庫上用經銷身分真的打過一次這支 RPC** —— 經銷會員 0 人, 我沒有那個身分。
--   ② 12 參經銷那支的 body md5 我**只有主視窗唯讀量到的前八碼 `4c3ee7c2…`**, 拿不到全值
--      ⇒ 前置閘 P3 因此只問【它在不在】, **不比 md5**。那是一個已知的、寫下來的弱點,
--      而**下一個人不要把它讀成「比過了」**。
--   ③ 本片的 `p_terms` 述詞是**從一般價那支整段搬過來的**, 我**沒有獨立設計過它的語意**
--      ⇒ 它對不對, 由 `20260909010000` 那一片的驗收負責, 不由本片。

BEGIN;

-- 🔴 [codex R2] 舊檔 :31-32 有這兩行, 我重寫時漏抄。補回, 理由各自寫:
--   · lock_timeout:DROP 要拿 ACCESS EXCLUSIVE 鎖。沒有它 ⇒ 遇到長交易時【無限等】,
--     而那在正式庫上是「整個部署卡住而沒有人知道為什麼」。
--   · quote_all_identifiers=off:本檔已不做參數文字反解(A4 改查 catalog),
--     🔵 而它仍留著 —— 舊檔的 A3c 若日後搬回來會需要它, 且關掉它零成本。
SET LOCAL lock_timeout = '5s';
SET LOCAL quote_all_identifiers = off;

-- ══ 前置閘 ════════════════════════════════════════════════════════════════
DO $pre$
DECLARE
  v_md5 text; v_cfg text; v_sec boolean; v_own text; v_n int; v_txt text; v_role text;
BEGIN
  -- P1:一般價那支的【13 參】必須在, 而且就是我抄的那一版
  SELECT md5(replace(p.prosrc, chr(13), '')), coalesce(array_to_string(p.proconfig, ','), ''),
         p.prosecdef, pg_get_userbyid(p.proowner)
    INTO v_md5, v_cfg, v_sec, v_own
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE p.oid = pg_catalog.to_regprocedure('public.search_catalog_by_vehicle(text[],text,text,int,int,int,text,text,text[],int,int,timestamptz,text[])');
  IF v_md5 IS NULL THEN
    RAISE EXCEPTION E'前置閘 P1:找不到【13 參】的 search_catalog_by_vehicle。\n'
      '  🔑 最可能的原因:`20260909010000` 還沒貼。本片必須排在它之後。\n'
      '  ⚠️ 這【不是】「它沒改」, 是它不在。';
  END IF;
  IF v_md5 <> 'f84d53d68827e5839fcef3310289d45e' THEN
    RAISE EXCEPTION E'前置閘 P1:來源 body md5 = %(期望 f84d53d68827e5839fcef3310289d45e)\n'
      '  ⇒ 我抄的不是這一版 ⇒ 停。', v_md5;
  END IF;
  IF v_sec OR v_cfg <> 'search_path=public, pg_temp' OR v_own <> 'postgres' THEN
    RAISE EXCEPTION '前置閘 P1b:來源的屬性不是我以為的(secdef=% cfg=% owner=%)⇒ 停。', v_sec, v_cfg, v_own;
  END IF;

  -- P2:🔴 問【哪一支在 / 哪一支不在】, 不問「幾支」
  --    (`20260909010000` 的 R3 實錘:它的 harness 只造 12 參, 而正式庫是 11 參 + 12 參
  --     ⇒ 一個數總數的斷言在那個世界會答錯。)
  IF pg_catalog.to_regprocedure('public.search_catalog_by_vehicle(text[],text,text,int,int,int,text,text,text[],int,int,timestamptz)') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘 P2a:一般價的【12 參】那支還在 ⇒ `20260909010000` 沒貼或它的 DROP 沒生效 ⇒ 停。';
  END IF;
  IF pg_catalog.to_regprocedure('public.search_catalog_by_vehicle(text,text,int,int,int,text,text,text[],int,int,timestamptz)') IS NULL THEN
    RAISE EXCEPTION '前置閘 P2b:一般價的【11 參】那支不見了 ⇒ 有人 DROP 錯簽章 ⇒ 停(本片與 010000 都不該碰它)。';
  END IF;

  -- P3:🔴 與 `20260908010000` 的 P3 【方向相反】—— 那支要求「不存在」, 本片要求「必須存在」
  IF pg_catalog.to_regprocedure('public.search_catalog_by_vehicle_dealer(text[],text,text,int,int,int,text,text,text[],int,int,timestamptz)') IS NULL THEN
    RAISE EXCEPTION '前置閘 P3:經銷【12 參】那支不在 ⇒ 我要 DROP 的東西不存在 ⇒ 停(本片是【改】不是【建】)。';
  END IF;
  IF pg_catalog.to_regprocedure('public.search_catalog_by_vehicle_dealer(text[],text,text,int,int,int,text,text,text[],int,int,timestamptz,text[])') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘 P3b:經銷【13 參】那支已經在了 ⇒ 本片可能已貼過 ⇒ 整筆回滾(不判它是不是本片那一份)。';
  END IF;

  -- P5 [codex R2 P1-①]:經銷 view 在, 而且它不對 anon/authenticated 開
  --   🔴 舊檔 :54-63 有這一道, 我重寫時【整道沒搬】。
  --   為什麼承重:P3/A5 問的都是【RPC】的權限。若 view 自己被直接授權給一般角色,
  --   本片仍會全綠, 而任何人可以【繞過 RPC 的身分閘直接讀那張 view】⇒ 經銷價外流。
  SELECT coalesce(c.relacl::text, '(NULL)') INTO v_txt
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'products_list_dealer' AND c.relkind = 'v';
  IF v_txt IS NULL THEN
    RAISE EXCEPTION '前置閘 P5:找不到 public.products_list_dealer(view)⇒ 先貼 20260908000000。';
  END IF;
  -- 🔴🔴 [codex R3 must-fix] ⛔ ~~只做 relacl 的【字串】比對~~ —— 那是【舊版】的寫法。
  --   📌 而我是【照抄 20260908010000:54-63】抄來的 —— **抄對了, 而被抄的那一份本身是舊的。**
  --      隔壁 20260908000000:296-315 早就被它自己的 codex 兩輪升級成【有效權限】那一版, 我沒去看它。
  --   🔴 relacl 字面看不到三種東西:①PUBLIC 授的 ②角色繼承拿到的 ③欄級授權
  --      ⇒ 「migration 全綠, 而非經銷會員可以直接 SELECT 經銷價」在舊寫法下是可能的。
  --   ✅ 改問 has_*_privilege(= 「有效權限」那個問題本身), 形狀照抄 20260908000000:296-315。
  --   🔵 relacl 那個字串留著【只當錯誤訊息用】, 不當安全判準。
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated']::text[] LOOP
    -- 🟢 正對照:同一把尺對【該有的】必須印 true, 否則它的 false 不算數
    IF NOT has_table_privilege(v_role, 'public.products_list_public', 'SELECT') THEN
      RAISE EXCEPTION '前置閘 P5:正對照失敗 —— % 連 products_list_public 都 SELECT 不到 ⇒ 這把尺今天壞了 ⇒ 停。', v_role;
    END IF;
    IF has_table_privilege(v_role, 'public.products_list_dealer', 'SELECT') THEN
      RAISE EXCEPTION '前置閘 P5:% 對 products_list_dealer 有【有效】SELECT(可能來自 PUBLIC 或角色繼承, relacl 字面看不到;relacl=%)⇒ 停, 經銷價會外流。', v_role, v_txt;
    END IF;
    -- 欄級:整表沒有不代表每一欄都沒有(has_table_privilege 對欄級授權會少報)
    IF NOT has_column_privilege(v_role, 'public.products_list_public', 'price_general', 'SELECT') THEN
      RAISE EXCEPTION '前置閘 P5:欄級正對照失敗 —— % 對 products_list_public.price_general 沒有 SELECT ⇒ 這把欄級尺今天壞了 ⇒ 停。', v_role;
    END IF;
    IF has_column_privilege(v_role, 'public.products_list_dealer', 'price_general', 'SELECT') THEN
      RAISE EXCEPTION '前置閘 P5:% 對 products_list_dealer.price_general 有欄級 SELECT ⇒ 停, 經銷價會外流。', v_role;
    END IF;
  END LOOP;

  -- P6 [codex R2 P2-②]:身分閘要讀的兩欄在
  --   🔴 舊檔 :73-79 有這一道, 我重寫時換成了函式名的正負對照 —— 那答的是別的問題。
  --   body 指紋正確 ≠ 它依賴的欄位還在;缺欄要到【呼叫時】才炸。
  SELECT count(*) INTO v_n FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.customers'::regclass AND NOT a.attisdropped
     AND a.attname IN ('user_id','tier');
  IF v_n <> 2 THEN
    RAISE EXCEPTION '前置閘 P6:public.customers 的 user_id/tier 命中 % 欄(期望 2)⇒ 身分閘讀不到, 停。', v_n;
  END IF;

  -- P4:🟢 正對照 —— 這把尺對【一定在】的東西必須答得出來, 否則上面每個 NOT FOUND 都不算數
  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='search_catalog_by_vehicle_dealer';
  IF NOT FOUND THEN
    RAISE EXCEPTION '前置閘 P4:正對照失敗 —— 連 search_catalog_by_vehicle_dealer 這個名字都查不到 ⇒ 這把尺今天壞了 ⇒ 停。';
  END IF;
  -- ⚪ 負對照:現造名必須查無
  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='search_catalog_by_vehicle_zzq0909never';
  IF FOUND THEN
    RAISE EXCEPTION '前置閘 P4b:負對照失敗 —— 現造函式名竟然查得到 ⇒ 這把尺會亂命中 ⇒ 停。';
  END IF;
END
$pre$;

DROP FUNCTION public.search_catalog_by_vehicle_dealer(text[], text, text, integer, integer, integer, text, text, text[], integer, integer, timestamptz);

CREATE FUNCTION public.search_catalog_by_vehicle_dealer(p_categories text[], p_brand text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_year integer DEFAULT NULL::integer, p_offset integer DEFAULT 0, p_limit integer DEFAULT 25, p_sort text DEFAULT 'recommend'::text, p_category text DEFAULT NULL::text, p_brand_slugs text[] DEFAULT NULL::text[], p_price_min integer DEFAULT NULL::integer, p_price_max integer DEFAULT NULL::integer, p_new_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_terms text[] DEFAULT NULL::text[])
 RETURNS TABLE(item jsonb, total bigint)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
-- ⟦DEALER-GUARD-DECL-BEGIN⟧
  v_uid  uuid;
  v_tier text;
-- ⟦DEALER-GUARD-DECL-END⟧
  -- 🔴🔴 **`v_cats` 把新舊兩個入口收成【一份】** —— 新的 `p_categories` 加上舊的 `p_category`。
  --    ⇒ 📌 下面每一處都只讀 `v_cats`, **不再有任何一處直接讀 `p_category`**
  --      ⇒ 那讓「漏改一處」變成不可能, 而不是靠人數對。
  -- 🔴🔴 **[2026-09-04 本支改的就是這件事 —— 而它【只動排序, 不動過濾】]**
  --    Sean 2026-09-04 逐字「3. 甲」= 帶分類時也照【中高價位優先】排。
  --    ⛔ ~~原本 12 處排序 CASE 都掛著 `AND cardinality(v_cats) = 0`~~
  --       ⇒ 一旦帶了分類, 那組 CASE 全部回 NULL ⇒ **唯一還在生效的鍵是 `f.id ASC`(UUID)**
  --       ⇒ 📌 **客人點進一個分類, 第一頁等於【隨機順序】** —— 而那不是「另一種排法」, 是沒有排法。
  --    ✅ 本支把那 12 處的 `AND cardinality(v_cats) = 0` 拿掉。
  --    🛑 **而【WHERE 那兩處一個字都沒動】** —— 那是過濾, 不是排序:
  --       `WHERE (cardinality(v_cats) = 0 OR ...)` 決定「要不要套分類過濾」。
  --       ⇒ 動它會改變**回傳哪些商品**, 而本支只改**它們的順序**。
  --    🔵 而「大類輪流」(`sort_rn` 的 PARTITION BY 大類)在只選一個分類時**自然變成 no-op**
  --       —— 同一個 partition ⇒ 剩下「中高價分帶 + 段內由高到低」, 那正是 Sean 要的。
  -- 🛑 **而「空」的判準一律是 `cardinality(v_cats) = 0`, 不是 `IS NULL`** ——
  --    陣列有兩種空(NULL 與 `{}`), 而**它們在 `IS NULL` 上不一樣**。
  --    🔬 本檔實測到的分母:`p_category IS NULL` 在原版出現 **12** 次(兩份查詢各 6)
  --      ⇒ ⚠️ 而 plan 裡我寫「三行」—— 那是**只 grep 到一份查詢**的數。**12 才是對的。**
  v_cats text[];
  -- 供應商批次門檻 N（Sean 2026-08-11 Q15=C 定 500 起手、明文委任 S 窗可調 → 本檔落 100）。
  -- 判準是「單一台灣日新增**達到** N 件」（>=，不是 >）；正當性與殘留風險見檔頭。
  -- 🔴 改這個數字要開**新的 migration** 重貼整支函式 —— 本檔一旦 apply 就不該再編輯，
  --    改舊檔 `db push` 不會重跑、正式庫的門檻不會變(codex R3)。
  -- 🔴 而且改 N ＝ 檔頭那組突變證據作廢，必須用 `scripts/269b-evidence.sql` §2b 重找切點重量。
  -- 單一定義點：下面兩個分支都讀這一個，不得各寫一個數字。
  c_batch_day_threshold constant int := 100;
  -- ── #950 推薦排序:中高價位優先(Sean 2026-08-27「中間~高 價位優先在前面好了」, 選項回「乙」)──
  -- 🔴 這兩個數字是【我們挑的, 不是他挑的】。他看到的選項字面是
  --    「這次先寫死在程式裡, 記一筆待辦(要改得叫我們)」, 而他回【甲】
  --    ⇒ 他同意的是那個做法, **不是這兩個值**。
  -- 🔴🔴 **要改就是改這兩行。**
  --    ⚠️ **而 backlog `#950` 目前【還沒有】指回本檔**(code-reviewer 實查:
  --       `grep -n '20260827150000' docs/phase-1-backlog.md` ⇒ 0 命中)
  --       ⇒ 那句「要改得叫我們」的承諾,現在只有【這一行】是它的地址。
  --       ⇒ 條目改寫是欠著的工(見 checkpoint), 而在那之前不要說「backlog 指到這裡」。
  --      (改了要開新 migration 重貼整支函式, 理由同上面那個門檻常數。)
  -- 值的來源:全站群代表價分布, 2026-08-27 量於報價單庫 storefront_catalog_v(22,193 群)
  --    中位數 4,000 / P90 13,800 ⇒ 段界取【中位數 ~ P90】
  --    ⚠️ 換成 Q3~P95(7,480 ~ 約 21,000)⇒ 第一頁整批換人、平均單價高很多
  -- 分類第一段 = 這個字的商品【不進新品區】(Sean 2026-08-27 拍【甲】= 照大類切)。
  -- 🔴 用 split_part 取第一段, 不是整串比對 —— 以後多出「維修零件 · 油封」這種子類會【自動】跟著排除,
  --    不需要有人記得回來改。Sean 拍甲的理由就是這個(de 端題時已明說「今天甲乙行為一樣, 差別在以後」)。
  -- ⚠️ 只作用在【新品模式】(p_new_since IS NOT NULL)。目錄 / 搜尋 / 品牌頁 / 分類頁傳 NULL ⇒ 不受影響;
  --    客人在分類頁直接看「維修零件」時 p_new_since 也是 NULL ⇒ 那 1631 件照常看得到。
  c_new_arrivals_excluded_category constant text := '維修零件';
  c_recommend_band_lo constant int := 4000;
  c_recommend_band_hi constant int := 13800;
  -- 🔴🔴 ⟦db-SEARCHFACETMUTEX⟧ **「空白」的字集 —— 顯式列舉**(codex R1 nit + R2 nit)
  --   ⛔ ~~`btrim(pt)` 預設~~ 只剝 ASCII 空格;⛔ ~~`pt ~ '[^[:space:]]'`~~ **依 locale**
  --     (我自己的 harness 在 `--locale=C` 下抓到它對全形空格失效)。
  --   ⇒ 📌 兩個都不行, 而它們**在正式庫與拋棄式庫會給不同答案, 且兩邊都不報錯**。
  c_ws constant text := E' \t\n\r\x0B\f\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u200B\u2028\u2029\u202F\u205F\u3000\uFEFF';
BEGIN
-- ⟦DEALER-GUARD-BEGIN⟧
  -- 🔴🔴 fail-closed 身分閘 —— 而它【故意不 fallback 回一般價】。
  --    📌 一個「安全的 fallback」會讓這一整支存在的理由消失, 而且不會有人發現:
  --       退回一般價 = 這支變成 search_catalog_by_vehicle 的複本, 而呼叫端本來就該挑。
  --    ⇒ 查無 / 非 store ⇒ RAISE, 讓「叫錯支」在第一次就被看見。
  -- 🔵 寫法照範本 public.get_effective_prices(20260907010000):auth.uid() ⇒ 查 customers.tier。
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '經銷目錄:沒有登入身分 ⇒ 這支只給經銷會員, 一般客人請叫 public.search_catalog_by_vehicle'
      USING ERRCODE = 'PCM04';
  END IF;
  SELECT c.tier INTO v_tier FROM public.customers c WHERE c.user_id = v_uid;
  IF v_tier IS DISTINCT FROM 'store' THEN
    RAISE EXCEPTION '經銷目錄:這個帳號的 tier 是 %(期望 store)⇒ 拒絕', coalesce(v_tier, '(查無此人)')
      USING ERRCODE = 'PCM04';
  END IF;
-- ⟦DEALER-GUARD-END⟧
  -- 🔵 新舊合流:兩個都給的話一起吃(聯集)。`p_category` 是舊入口, 保留到步驟 C 才 DROP。
  v_cats := (
    -- 🔴 **`btrim` 要寫回, 不是只拿來過濾**(codex nit):原版只用它排除空白字串,
    --    而 `' 排氣系統 '` 會**帶著空白留下來** ⇒ 比不到任何分類, 而且不會與無空白版去重。
    SELECT coalesce(array_agg(DISTINCT btrim(x)), ARRAY[]::text[])
      FROM unnest(coalesce(p_categories, ARRAY[]::text[])
                  || CASE WHEN p_category IS NULL THEN ARRAY[]::text[] ELSE ARRAY[p_category] END) AS x
     WHERE btrim(x) <> ''
  );
  IF p_brand IS NULL THEN
    RETURN QUERY
    WITH new_batch_days AS (
      -- 只在 p_new_since 有值時才會被執行（見 filtered 的 OR 短路）。
      -- 下界 = p_new_since 所在台灣日的 00:00（不是 p_new_since 本身）：整日量才判得準。
      SELECT (pb.created_at AT TIME ZONE 'Asia/Taipei')::date AS day
      FROM public.products_list_dealer pb
      WHERE pb.created_at >= timezone('Asia/Taipei', date_trunc('day', timezone('Asia/Taipei', p_new_since)))
        -- 未來時戳不得參與批次日計數（codex R2）：那種列自己不會被回傳（filtered 有 <= now()），
        -- 但若同一天累積到 N，會把當天**真正的**新品整天一起誤殺。
        AND pb.created_at <= now()
      GROUP BY 1
      HAVING count(*) >= c_batch_day_threshold
    ), filtered AS (
      SELECT p.*
      FROM public.products_list_dealer p
      -- 🔴🔴 **不是 `= ANY(v_cats)`** —— 分類的述詞有【兩個分支】(`=` 與 `LIKE 父 · %`),
      --    而品牌只有一個 ⇒ 照抄品牌那一格會**漏掉「打大類要涵蓋子類」那一半**,
      --    而它看起來完全正確。⇒ 每一個元素都要走那兩個分支。
      -- ✅ **聯集**(任一元素中就算中)= Sean 2026-09-04 拍的甲:
      --    逐字「甲 聯集 —— 排氣管【或】油箱貼, 兩種商品都列出來(比較多)」。
      WHERE (cardinality(v_cats) = 0
             OR EXISTS (SELECT 1 FROM unnest(v_cats) AS vc
                         WHERE p.category_raw = vc OR p.category_raw LIKE vc || ' · %'))
        AND (p_brand_slugs IS NULL OR cardinality(p_brand_slugs) = 0 OR p.brand_slug = ANY(p_brand_slugs))
        AND (p_price_min IS NULL OR p.price_general >= p_price_min)
        AND (p_price_max IS NULL OR p.price_general <= p_price_max)
        AND (p_new_since IS NULL OR (
              p.created_at >= p_new_since
              -- 上界（codex R2 NIT-2）：未來時戳的列不算新品，否則它會永遠釘在「新品」第一位。
              -- 只夾窗、不夾 new_batch_days：批次日要用「整日實際有幾列」判斷。
              AND p.created_at <= now()
              AND NOT EXISTS (
                SELECT 1 FROM new_batch_days nbd
                WHERE nbd.day = (p.created_at AT TIME ZONE 'Asia/Taipei')::date
              )
              -- 🔴 維修零件不進新品區。`coalesce` 少不得:category_raw 若為 NULL,
              --    `split_part(NULL,…) <> '維修零件'` 會回 NULL ⇒ 那一列會被【當成維修零件排掉】。
              --    現值空值 0 ⇒ 今天看不出差別, 而那正是它以後會安靜咬人的原因。
              AND coalesce(split_part(p.category_raw, ' · ', 1), '') <> c_new_arrivals_excluded_category
            ))
        -- 🔴🔴 ⟦db-SEARCHFACETMUTEX⟧ 關鍵字那一格 —— **比對【不在這裡】做**, 委給 `storefront_search_product_ids`。
        --    🎯 **為什麼委出去**:那支已經有四欄 ILIKE + 品牌名 + 母料號前綴 + 變體 sku 四塊,
        --      而每一塊的守門條件都付過學費(見 `20260906950000` 的註解)⇒ 自己再寫一份 ILIKE
        --      = 兩份會漂, 而漂的方向是【客人搜不到】, 那沒有人會回報。
        --    🛑 **而 `products_list_public` 上【沒有】`description` 與 `external_id` 兩欄**
        --      ⇒ 就算想在這裡比也比不完整;委出去那一側走的是 `products_public`。
        -- 🔴🔴 **第二個條件不可以省, 而少了它會【整站零商品】**:
        --    被委的那支在零個有效詞時逐字「回零列(不是回全表)」(`20260906950000` 的 `WHERE n.want > 0`)
        --    ⇒ 📌 `p_terms = ARRAY['']` 這種呼叫會讓每一列都被濾掉, 而 HTTP 200、畫面完全正常。
        --    ⇒ **「沒有關鍵字」這件事必須在【這裡】判, 不得委出去。**
        --    🔴🔴 **「有效詞」的判準【刻意與被委那支不同】, 而差的方向是承重的**(codex R1 nit):
--      被委那支用 `btrim(term) <> ''`, 而 **`btrim` 預設只剝 ASCII 空格**
--      ⇒ 📌 `ARRAY[E'\t']` / 換行 / 全形空格 `U+3000` 在它眼裡是**有效詞**
--        ⇒ 它會拿 `%<tab>%` 去比 ⇒ 回零列 ⇒ **整站零商品**, 又是同一個形狀。
--      ⛔ ~~我的第一版寫 `pt ~ '[^[:space:]]'`~~ —— 🔴 **那一版是【我自己的 harness 抓到的】**:
--        `[[:space:]]` 是**依 locale 的**, 而拋棄式庫跑在 `--locale=C` ⇒ 它只認 ASCII
--        ⇒ 全形空格 `U+3000` 那一格實測 **0(期望 4)**。
--        📌 而正式庫是 UTF-8 locale ⇒ 📌 **同一段碼在兩個環境會給不同答案, 而兩邊都不報錯。**
--      ✅ 改成**顯式列舉**(與 `normalizeSearchInput` 學到的同一課:`\s` 不含 `U+200B`)
--        `btrim(pt, ' '||chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(8203)||chr(12288)||chr(65279))`
--        ⇒ 空白 / tab / 換行 / 零寬空格 / 全形空格 / BOM,**locale 無關** ⇒ **比被委那支寬**
--        ⇒ 純空白的詞在這裡算「沒有關鍵字」⇒ **不過濾, 出全部**。
--    🔴🔴 **[codex R2 must-fix]** ⛔ ~~只擋「整組都是空白」就夠~~ —— **那句是假的, 而反例很小**:
--      `ARRAY['碳纖維', E'\t']` ⇒ 第一個詞有效 ⇒ 整組過了我的閘 ⇒ **連同那個 tab 原樣送出去**
--      ⇒ 被委那支把 tab 當成**第二個必要條件**(`count(DISTINCT ord) = want`)
--      ⇒ 📌 **一筆都不會中** ⇒ 客人打了字而拿到 0 件, 而畫面完全正常。
--      ✅ **所以不是【擋】, 是【濾】**:只把有效詞 `array_agg` 起來送出去。
--      🎯 兩邊不一致仍是刻意的, 而現在它**真的**只往【出全部】倒 —— 空白詞根本不會抵達那一支。
        AND (p_terms IS NULL
             OR NOT EXISTS (SELECT 1 FROM unnest(p_terms) AS pt WHERE btrim(pt, c_ws) <> '')
             OR p.id IN (SELECT k.id FROM public.storefront_search_product_ids(
                  (SELECT array_agg(pt) FROM unnest(p_terms) AS pt WHERE btrim(pt, c_ws) <> '')) k))
    ), paged AS (
      -- count/排序/分頁先收斂到 ≤100 列，trim JOIN 只對當頁做（20260719150000 MF-4）
      SELECT f.*, count(*) OVER () AS total_rows,
        -- ── #950 recommend 的兩個排序欄。🔴 **算在這裡, 不算在外層 ORDER BY 裡** ──
        --   理由是實測踩到的:第一版把 row_number() 寫進【外層】那個 ORDER BY,
        --   它會對【已經分頁後的那幾列】重算一次 ⇒ 名次變成頁內名次、不是全域名次
        --   ⇒ 第一頁出現重複的大類(2026-08-27 實測:期望 12 個相異大類, 實得 11)。
        --   📌 而 11/12 看起來幾乎對 —— 那正是它難發現的地方。
  -- 🔴🔴 **第二個實測抓到的錯:PARTITION 要含【段】。**
  --   只用大類分割 ⇒ rn 是「這一類【全部】商品裡的名次」, 而段外(比段更貴)的也算在內
  --   ⇒ 各大類段外商品【數量不同】⇒ 每一類第一個段內商品拿到的 rn 不同
  --     (實測:第一頁的 rn 從 24 起跳、有 24 也有 25 ⇒ 同一個大類出現兩次)
  --   ⇒ 加上 band 之後, 每一類【在段內】的名次才從 1 開始, 輪流才真的是輪流。
        CASE WHEN f.price_general BETWEEN c_recommend_band_lo AND c_recommend_band_hi
             THEN 0 ELSE 1 END AS sort_band,
        -- 🔴 大類 = category_raw 的第一段。單段的分類是合法的(本函式自己的 WHERE 就有
        --    `= p_category` 與 `LIKE p_category || ' · %'` 兩個分支)⇒ split_part 對單段值
        --    回整串 ⇒ 它自成一個大類, 行為正確、不是 bug。
        row_number() OVER (PARTITION BY split_part(f.category_raw, ' · ', 1),
                                           CASE WHEN f.price_general BETWEEN c_recommend_band_lo
                                                     AND c_recommend_band_hi THEN 0 ELSE 1 END
                           ORDER BY f.price_general DESC NULLS LAST, f.id) AS sort_rn
      FROM filtered f
      ORDER BY
        CASE WHEN p_sort = 'recommend' THEN
          CASE WHEN f.price_general BETWEEN c_recommend_band_lo AND c_recommend_band_hi
               THEN 0 ELSE 1 END
        END ASC NULLS LAST,
        CASE WHEN p_sort = 'recommend' THEN
          row_number() OVER (PARTITION BY split_part(f.category_raw, ' · ', 1),
                                             CASE WHEN f.price_general BETWEEN c_recommend_band_lo
                                                       AND c_recommend_band_hi THEN 0 ELSE 1 END
                             ORDER BY f.price_general DESC NULLS LAST, f.id)
        END ASC NULLS LAST,
        CASE WHEN p_sort = 'recommend' THEN f.price_general END DESC NULLS LAST,
        CASE WHEN p_sort = 'price-asc' THEN f.price_general END ASC NULLS LAST,
        CASE WHEN p_sort = 'price-desc' THEN f.price_general END DESC NULLS LAST,
        CASE WHEN p_sort = 'new' THEN f.created_at END DESC NULLS LAST,
        f.id ASC
      OFFSET GREATEST(p_offset, 0)
      LIMIT LEAST(GREATEST(p_limit, 1), 100)
    )
    SELECT
      jsonb_build_object(
        'id', pg.id,
        -- 🔴 母料號:Sean 2026-09-06 拍「全部頁面都顯示料號」。
        --    來源是 `products_public`(下面 LEFT JOIN 的 `pe`), **不是 `products_list_public`** ——
        --    那支清單投影**沒有這一欄**(2026-09-06 正式庫唯讀逐欄查:16 欄, 無 `external_id`;
        --    而 `products_public` 有 ⇒ 🟢 正對照)。
        -- 🛑 **刻意不動 `products_list_public`**(主視窗 `Q-母料號來源 A: 甲`):它是**公開投影**,
        --    消費端沒有盤過 ⇒ 板列 `⟦search-LISTVIEWNOEXTID⟧` 記著未來若要動它的入口。
         --    ⛔ ~~理由之一是「它的 COMMENT 逐字寫著排除 external_id, 那個排除看起來是刻意的」~~
         --    🔴 **那句是錯的**(codex + code-reviewer 同時抓):現行 COMMENT(`20260811040000:229`)
         --      逐字是 `excludes price_store, price_by_tier, metadata, detail content and delisted_at`
         --      —— **沒有 external_id**。含它的是 9/10 欄時期那兩代, 而那份清單裡它跟
         --      `description / images / timestamps` 排在一起 ⇒ 那是**卡片瘦身**, 不是安全排除。
         --    ✅ **選甲仍然對, 而理由換成量到的那個**:動公開投影會改欄數與欄位順序,
         --      而**消費端沒有盤過** —— 這一條不需要那句 COMMENT 撐。
        'external_id', pe.external_id,
        'title', pg.title,
        'subtitle', pg.subtitle,
        'handle', pg.handle,
        'availability', pg.availability,
        'price_general', pg.price_general,
        'card_image', pg.card_image,
        'fits', pg.fits,
        'brand_name', pg.brand_name,
        'brand_slug', pg.brand_slug,
        'category_raw', pg.category_raw,
        'fitments', pg.fitments,
        'card_image_trim', CASE WHEN t.url IS NULL THEN NULL ELSE jsonb_build_object(
          'l', t.bbox_left, 't', t.bbox_top, 'w', t.bbox_width, 'h', t.bbox_height,
          'nw', t.natural_width, 'nh', t.natural_height) END
      ),
      pg.total_rows
    FROM paged pg
    LEFT JOIN public.product_image_trim t ON t.url = pg.card_image AND t.status = 'ok'
    -- 🔵 **只在【這一頁】上 join** —— `paged` 已經 LIMIT 過(最多 100 列), 而 join key 是主鍵。
    -- 🔴 用 `LEFT` 不是 `INNER`:兩支 view 都吃 RLS, 正常同進同出;而萬一某一列只在其中一邊,
    --    INNER 會把那張卡**整張弄不見**, LEFT 只讓料號是 null。
    --    ⇒ 📌 **少一個料號 vs 少一張商品卡, 後者嚴重得多。**
    LEFT JOIN public.products_public pe ON pe.id = pg.id
    ORDER BY
      -- #950:🔴 用內層算好的 sort_band / sort_rn, **不要在這裡重算 row_number()**(理由見內層註解)
      CASE WHEN p_sort = 'recommend' THEN pg.sort_band END ASC NULLS LAST,
      CASE WHEN p_sort = 'recommend' THEN pg.sort_rn   END ASC NULLS LAST,
      CASE WHEN p_sort = 'recommend' THEN pg.price_general END DESC NULLS LAST,
      CASE WHEN p_sort = 'price-asc' THEN pg.price_general END ASC NULLS LAST,
      CASE WHEN p_sort = 'price-desc' THEN pg.price_general END DESC NULLS LAST,
      CASE WHEN p_sort = 'new' THEN pg.created_at END DESC NULLS LAST,
      pg.id ASC;
    RETURN;
  END IF;

  RETURN QUERY
  WITH new_batch_days AS (
    SELECT (pb.created_at AT TIME ZONE 'Asia/Taipei')::date AS day
    FROM public.products_list_dealer pb
    WHERE pb.created_at >= timezone('Asia/Taipei', date_trunc('day', timezone('Asia/Taipei', p_new_since)))
      AND pb.created_at <= now()                       -- 同上：未來時戳不參與批次日計數
    GROUP BY 1
    HAVING count(*) >= c_batch_day_threshold
  ), matched AS (
    SELECT product_id
    FROM public.product_fitments
    WHERE moto_brand = p_brand
      AND (p_model IS NULL OR model_code = p_model)
      AND (p_year IS NULL OR ((year_start IS NULL OR year_start <= p_year)
                          AND (year_end IS NULL OR year_end >= p_year)))
    UNION
    SELECT product_id
    FROM public.product_fitments_effective
    WHERE moto_brand = p_brand
      AND (p_model IS NULL OR model_code = p_model)
      AND (p_year IS NULL OR ((year_start IS NULL OR year_start <= p_year)
                          AND (year_end IS NULL OR year_end >= p_year)))
  ), filtered AS (
    SELECT p.*
    FROM public.products_list_dealer p
    JOIN matched m ON m.product_id = p.id
    -- 🔴 與上面那份同一個修法(本函式有【兩份】查詢, 兩份都要改)。
    WHERE (cardinality(v_cats) = 0
           OR EXISTS (SELECT 1 FROM unnest(v_cats) AS vc
                       WHERE p.category_raw = vc OR p.category_raw LIKE vc || ' · %'))
      AND (p_brand_slugs IS NULL OR cardinality(p_brand_slugs) = 0 OR p.brand_slug = ANY(p_brand_slugs))
      AND (p_price_min IS NULL OR p.price_general >= p_price_min)
      AND (p_price_max IS NULL OR p.price_general <= p_price_max)
      AND (p_new_since IS NULL OR (
            p.created_at >= p_new_since
            AND p.created_at <= now()
            AND NOT EXISTS (
              SELECT 1 FROM new_batch_days nbd
              WHERE nbd.day = (p.created_at AT TIME ZONE 'Asia/Taipei')::date
            )
            -- 🔴 維修零件不進新品區。`coalesce` 少不得:category_raw 若為 NULL,
            --    `split_part(NULL,…) <> '維修零件'` 會回 NULL ⇒ 那一列會被【當成維修零件排掉】。
            --    現值空值 0 ⇒ 今天看不出差別, 而那正是它以後會安靜咬人的原因。
            AND coalesce(split_part(p.category_raw, ' · ', 1), '') <> c_new_arrivals_excluded_category
          ))
      -- 🔴🔴 ⟦db-SEARCHFACETMUTEX⟧ 關鍵字那一格 —— **比對【不在這裡】做**, 委給 `storefront_search_product_ids`。
      --    🎯 **為什麼委出去**:那支已經有四欄 ILIKE + 品牌名 + 母料號前綴 + 變體 sku 四塊,
      --      而每一塊的守門條件都付過學費(見 `20260906950000` 的註解)⇒ 自己再寫一份 ILIKE
      --      = 兩份會漂, 而漂的方向是【客人搜不到】, 那沒有人會回報。
      --    🛑 **而 `products_list_public` 上【沒有】`description` 與 `external_id` 兩欄**
      --      ⇒ 就算想在這裡比也比不完整;委出去那一側走的是 `products_public`。
      -- 🔴🔴 **第二個條件不可以省, 而少了它會【整站零商品】**:
      --    被委的那支在零個有效詞時逐字「回零列(不是回全表)」(`20260906950000` 的 `WHERE n.want > 0`)
      --    ⇒ 📌 `p_terms = ARRAY['']` 這種呼叫會讓每一列都被濾掉, 而 HTTP 200、畫面完全正常。
      --    ⇒ **「沒有關鍵字」這件事必須在【這裡】判, 不得委出去。**
      --    🔴🔴 **「有效詞」的判準【刻意與被委那支不同】, 而差的方向是承重的**(codex R1 nit):
--      被委那支用 `btrim(term) <> ''`, 而 **`btrim` 預設只剝 ASCII 空格**
--      ⇒ 📌 `ARRAY[E'\t']` / 換行 / 全形空格 `U+3000` 在它眼裡是**有效詞**
--        ⇒ 它會拿 `%<tab>%` 去比 ⇒ 回零列 ⇒ **整站零商品**, 又是同一個形狀。
--      ⛔ ~~我的第一版寫 `pt ~ '[^[:space:]]'`~~ —— 🔴 **那一版是【我自己的 harness 抓到的】**:
--        `[[:space:]]` 是**依 locale 的**, 而拋棄式庫跑在 `--locale=C` ⇒ 它只認 ASCII
--        ⇒ 全形空格 `U+3000` 那一格實測 **0(期望 4)**。
--        📌 而正式庫是 UTF-8 locale ⇒ 📌 **同一段碼在兩個環境會給不同答案, 而兩邊都不報錯。**
--      ✅ 改成**顯式列舉**(與 `normalizeSearchInput` 學到的同一課:`\s` 不含 `U+200B`)
--        `btrim(pt, ' '||chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(8203)||chr(12288)||chr(65279))`
--        ⇒ 空白 / tab / 換行 / 零寬空格 / 全形空格 / BOM,**locale 無關** ⇒ **比被委那支寬**
--        ⇒ 純空白的詞在這裡算「沒有關鍵字」⇒ **不過濾, 出全部**。
--    🔴🔴 **[codex R2 must-fix]** ⛔ ~~只擋「整組都是空白」就夠~~ —— **那句是假的, 而反例很小**:
--      `ARRAY['碳纖維', E'\t']` ⇒ 第一個詞有效 ⇒ 整組過了我的閘 ⇒ **連同那個 tab 原樣送出去**
--      ⇒ 被委那支把 tab 當成**第二個必要條件**(`count(DISTINCT ord) = want`)
--      ⇒ 📌 **一筆都不會中** ⇒ 客人打了字而拿到 0 件, 而畫面完全正常。
--      ✅ **所以不是【擋】, 是【濾】**:只把有效詞 `array_agg` 起來送出去。
--      🎯 兩邊不一致仍是刻意的, 而現在它**真的**只往【出全部】倒 —— 空白詞根本不會抵達那一支。
      AND (p_terms IS NULL
           OR NOT EXISTS (SELECT 1 FROM unnest(p_terms) AS pt WHERE btrim(pt, c_ws) <> '')
           OR p.id IN (SELECT k.id FROM public.storefront_search_product_ids(
                (SELECT array_agg(pt) FROM unnest(p_terms) AS pt WHERE btrim(pt, c_ws) <> '')) k))
  ), paged AS (
    SELECT f.*, count(*) OVER () AS total_rows,
      -- ── #950 recommend 的兩個排序欄。🔴 **算在這裡, 不算在外層 ORDER BY 裡** ──
      --   理由是實測踩到的:第一版把 row_number() 寫進【外層】那個 ORDER BY,
      --   它會對【已經分頁後的那幾列】重算一次 ⇒ 名次變成頁內名次、不是全域名次
      --   ⇒ 第一頁出現重複的大類(2026-08-27 實測:期望 12 個相異大類, 實得 11)。
      --   📌 而 11/12 看起來幾乎對 —— 那正是它難發現的地方。
  -- 🔴🔴 **第二個實測抓到的錯:PARTITION 要含【段】。**
  --   只用大類分割 ⇒ rn 是「這一類【全部】商品裡的名次」, 而段外(比段更貴)的也算在內
  --   ⇒ 各大類段外商品【數量不同】⇒ 每一類第一個段內商品拿到的 rn 不同
  --     (實測:第一頁的 rn 從 24 起跳、有 24 也有 25 ⇒ 同一個大類出現兩次)
  --   ⇒ 加上 band 之後, 每一類【在段內】的名次才從 1 開始, 輪流才真的是輪流。
      CASE WHEN f.price_general BETWEEN c_recommend_band_lo AND c_recommend_band_hi
           THEN 0 ELSE 1 END AS sort_band,
      -- 🔴 大類 = category_raw 的第一段。單段的分類是合法的(本函式自己的 WHERE 就有
      --    `= p_category` 與 `LIKE p_category || ' · %'` 兩個分支)⇒ split_part 對單段值
      --    回整串 ⇒ 它自成一個大類, 行為正確、不是 bug。
      row_number() OVER (PARTITION BY split_part(f.category_raw, ' · ', 1),
                                         CASE WHEN f.price_general BETWEEN c_recommend_band_lo
                                                   AND c_recommend_band_hi THEN 0 ELSE 1 END
                         ORDER BY f.price_general DESC NULLS LAST, f.id) AS sort_rn
    FROM filtered f
    ORDER BY
      CASE WHEN p_sort = 'recommend' THEN
        CASE WHEN f.price_general BETWEEN c_recommend_band_lo AND c_recommend_band_hi
             THEN 0 ELSE 1 END
      END ASC NULLS LAST,
      CASE WHEN p_sort = 'recommend' THEN
        row_number() OVER (PARTITION BY split_part(f.category_raw, ' · ', 1),
                                           CASE WHEN f.price_general BETWEEN c_recommend_band_lo
                                                     AND c_recommend_band_hi THEN 0 ELSE 1 END
                           ORDER BY f.price_general DESC NULLS LAST, f.id)
      END ASC NULLS LAST,
      CASE WHEN p_sort = 'recommend' THEN f.price_general END DESC NULLS LAST,
      CASE WHEN p_sort = 'price-asc' THEN f.price_general END ASC NULLS LAST,
      CASE WHEN p_sort = 'price-desc' THEN f.price_general END DESC NULLS LAST,
      CASE WHEN p_sort = 'new' THEN f.created_at END DESC NULLS LAST,
      f.id ASC
    OFFSET GREATEST(p_offset, 0)
    LIMIT LEAST(GREATEST(p_limit, 1), 100)
  )
  SELECT
    jsonb_build_object(
      'id', pg.id,
      -- 🔴 母料號:Sean 2026-09-06 拍「全部頁面都顯示料號」。
      --    來源是 `products_public`(下面 LEFT JOIN 的 `pe`), **不是 `products_list_public`** ——
      --    那支清單投影**沒有這一欄**(2026-09-06 正式庫唯讀逐欄查:16 欄, 無 `external_id`;
      --    而 `products_public` 有 ⇒ 🟢 正對照)。
      -- 🛑 **刻意不動 `products_list_public`**(主視窗 `Q-母料號來源 A: 甲`):它是**公開投影**,
      --    消費端沒有盤過 ⇒ 板列 `⟦search-LISTVIEWNOEXTID⟧` 記著未來若要動它的入口。
         --    ⛔ ~~理由之一是「它的 COMMENT 逐字寫著排除 external_id, 那個排除看起來是刻意的」~~
         --    🔴 **那句是錯的**(codex + code-reviewer 同時抓):現行 COMMENT(`20260811040000:229`)
         --      逐字是 `excludes price_store, price_by_tier, metadata, detail content and delisted_at`
         --      —— **沒有 external_id**。含它的是 9/10 欄時期那兩代, 而那份清單裡它跟
         --      `description / images / timestamps` 排在一起 ⇒ 那是**卡片瘦身**, 不是安全排除。
         --    ✅ **選甲仍然對, 而理由換成量到的那個**:動公開投影會改欄數與欄位順序,
         --      而**消費端沒有盤過** —— 這一條不需要那句 COMMENT 撐。
      'external_id', pe.external_id,
      'title', pg.title,
      'subtitle', pg.subtitle,
      'handle', pg.handle,
      'availability', pg.availability,
      'price_general', pg.price_general,
      'card_image', pg.card_image,
      'fits', pg.fits,
      'brand_name', pg.brand_name,
      'brand_slug', pg.brand_slug,
      'category_raw', pg.category_raw,
      'fitments', pg.fitments,
      'card_image_trim', CASE WHEN t.url IS NULL THEN NULL ELSE jsonb_build_object(
        'l', t.bbox_left, 't', t.bbox_top, 'w', t.bbox_width, 'h', t.bbox_height,
        'nw', t.natural_width, 'nh', t.natural_height) END
    ),
    pg.total_rows
  FROM paged pg
  LEFT JOIN public.product_image_trim t ON t.url = pg.card_image AND t.status = 'ok'
  -- 🔵 **只在【這一頁】上 join** —— `paged` 已經 LIMIT 過(最多 100 列), 而 join key 是主鍵。
  -- 🔴 用 `LEFT` 不是 `INNER`:兩支 view 都吃 RLS, 正常同進同出;而萬一某一列只在其中一邊,
  --    INNER 會把那張卡**整張弄不見**, LEFT 只讓料號是 null。
  --    ⇒ 📌 **少一個料號 vs 少一張商品卡, 後者嚴重得多。**
  LEFT JOIN public.products_public pe ON pe.id = pg.id
  ORDER BY
    -- #950:🔴 用內層算好的 sort_band / sort_rn, **不要在這裡重算 row_number()**(理由見內層註解)
    CASE WHEN p_sort = 'recommend' THEN pg.sort_band END ASC NULLS LAST,
    CASE WHEN p_sort = 'recommend' THEN pg.sort_rn   END ASC NULLS LAST,
    CASE WHEN p_sort = 'recommend' THEN pg.price_general END DESC NULLS LAST,
    CASE WHEN p_sort = 'price-asc' THEN pg.price_general END ASC NULLS LAST,
    CASE WHEN p_sort = 'price-desc' THEN pg.price_general END DESC NULLS LAST,
    CASE WHEN p_sort = 'new' THEN pg.created_at END DESC NULLS LAST,
    pg.id ASC;
END;
$function$;

-- ── 授權:兩道 REVOKE(少一道都是開的)後, 只授 authenticated ────────────
-- 🔴 與 12 參那支同一套 —— DROP 會把舊的 ACL 一起帶走, 所以這三行【必須重下】。
REVOKE ALL ON FUNCTION public.search_catalog_by_vehicle_dealer(text[], text, text, integer, integer, integer, text, text, text[], integer, integer, timestamptz, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_catalog_by_vehicle_dealer(text[], text, text, integer, integer, integer, text, text, text[], integer, integer, timestamptz, text[]) FROM anon, authenticated;
-- ACL-GATE-EXEMPT: public.search_catalog_by_vehicle_dealer -- 經銷會員從顧客站以自己的身分呼叫;不能改用 service_role 因為函式靠 auth.uid() 讀 customers.tier 判經銷(Q74-b, 2026-09-09)
GRANT EXECUTE ON FUNCTION public.search_catalog_by_vehicle_dealer(text[], text, text, integer, integer, integer, text, text, text[], integer, integer, timestamptz, text[]) TO authenticated;

-- ══ 事後閘 ════════════════════════════════════════════════════════════════
DO $post$
DECLARE
  v_src text; v_rebuilt text; v_ctrl text; v_acl text; v_n int;
  v_fn text; v_aclarr aclitem[]; v_nd int; v_sec boolean; v_cfg text; v_own text; v_txt2 text;
  -- 🔴 收權斷言清單 —— 這一格【不是形式】:收權斷言只檢查你列出來的物件,
  --    它防「忘記收權」, 不防「忘記列」。漏列一個 = 那個物件的權限沒有人在看。
  v_functions text[] := ARRAY[
    'public.search_catalog_by_vehicle_dealer(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamptz,text[])'
  ]::text[];
BEGIN
  -- A1:問【哪一支在 / 哪一支不在】, 不問幾支
  IF pg_catalog.to_regprocedure('public.search_catalog_by_vehicle_dealer(text[],text,text,int,int,int,text,text,text[],int,int,timestamptz)') IS NOT NULL THEN
    RAISE EXCEPTION '事後閘 A1a:經銷【12 參】那支還在 ⇒ 我的 DROP 沒生效 ⇒ 停。';
  END IF;
  SELECT md5(replace(p.prosrc, chr(13), '')), coalesce(p.proacl::text,'') INTO v_src, v_acl
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE p.oid = pg_catalog.to_regprocedure('public.search_catalog_by_vehicle_dealer(text[],text,text,int,int,int,text,text,text[],int,int,timestamptz,text[])');
  IF v_src IS NULL THEN
    RAISE EXCEPTION '事後閘 A1b:經銷【13 參】那支不在 ⇒ CREATE 沒生效 ⇒ 停。';
  END IF;
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='search_catalog_by_vehicle_dealer';
  RAISE NOTICE '事後閘 A1:search_catalog_by_vehicle_dealer 現在有 % 支多載(1 是預期的;本行只報數, 不擋)。', v_n;

  -- 取真 body 做逐字複本比對
  SELECT replace(p.prosrc, chr(13), '') INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE p.oid = pg_catalog.to_regprocedure('public.search_catalog_by_vehicle_dealer(text[],text,text,int,int,int,text,text,text[],int,int,timestamptz,text[])');

  -- A2:🟢 正對照 —— 一般那支的 proacl 必須看得到 anon(否則這把 ACL 尺今天壞了)
  SELECT coalesce(p.proacl::text, '') INTO v_ctrl
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE p.oid = pg_catalog.to_regprocedure('public.search_catalog_by_vehicle(text[],text,text,int,int,int,text,text,text[],int,int,timestamptz,text[])');
  IF v_ctrl NOT ILIKE '%anon=%' THEN
    RAISE EXCEPTION '事後閘 A2:正對照失敗 —— 一般那支的 proacl 竟然沒有 anon ⇒ 這把尺今天壞了 ⇒ 停。';
  END IF;
  IF v_acl ILIKE '%anon=%' THEN
    RAISE EXCEPTION '事後閘 A2b:經銷那支的 proacl 出現 anon(%)⇒ 未登入者能以 owner 身分跑它 ⇒ 停。', v_acl;
  END IF;

  -- A3:逐字複本閘 —— 反向重建再比 md5
  v_rebuilt := regexp_replace(v_src, '-- ⟦DEALER-GUARD-DECL-BEGIN⟧.*?-- ⟦DEALER-GUARD-DECL-END⟧' || chr(10), '', 'gs');
  v_rebuilt := regexp_replace(v_rebuilt, '-- ⟦DEALER-GUARD-BEGIN⟧.*?-- ⟦DEALER-GUARD-END⟧' || chr(10), '', 'gs');
  v_rebuilt := replace(v_rebuilt, 'public.products_list_dealer', 'public.products_list_public');
  IF md5(v_rebuilt) <> 'f84d53d68827e5839fcef3310289d45e' THEN
    RAISE EXCEPTION '事後閘 A3:反向重建後 md5 = %(期望 f84d53d68827e5839fcef3310289d45e)⇒ 本支【不是】那一支的逐字複本 ⇒ 停。', md5(v_rebuilt);
  END IF;
  -- ⚪ A3 的負對照:不換 view 名 ⇒ 必須【不等於】來源, 否則上面那個相等是空的
  v_rebuilt := regexp_replace(v_src, '-- ⟦DEALER-GUARD-DECL-BEGIN⟧.*?-- ⟦DEALER-GUARD-DECL-END⟧' || chr(10), '', 'gs');
  v_rebuilt := regexp_replace(v_rebuilt, '-- ⟦DEALER-GUARD-BEGIN⟧.*?-- ⟦DEALER-GUARD-END⟧' || chr(10), '', 'gs');
  IF md5(v_rebuilt) = 'f84d53d68827e5839fcef3310289d45e' THEN
    RAISE EXCEPTION '事後閘 A3:負對照失敗 —— 【不換 view 名】也等於來源 ⇒ 代表 view 名根本沒被換過 ⇒ 停。';
  END IF;

  -- A3b:A3 對「四處只換了其中幾處」失明 ⇒ 額外釘兩個計數
  v_n := (length(v_src) - length(replace(v_src, 'public.products_list_dealer', ''))) / length('public.products_list_dealer');
  IF v_n <> 4 THEN
    RAISE EXCEPTION '事後閘 A3b:body 裡 public.products_list_dealer 出現 % 次(期望恰 4)⇒ 有查詢沒換到 ⇒ 停。', v_n;
  END IF;
  v_n := (length(v_src) - length(replace(v_src, 'public.products_list_public', ''))) / length('public.products_list_public');
  IF v_n <> 0 THEN
    RAISE EXCEPTION '事後閘 A3b:body 裡還有 % 處 public.products_list_public(期望 0)⇒ 停。', v_n;
  END IF;

  -- A3d:身分閘區塊逐字未變(A3 把它整段排除掉了 ⇒ 少了這道, 把 IF v_uid IS NULL 改成 IF FALSE 仍全綠)
  -- 🔴 這裡【不能】用 regexp_match(..., 'gs') —— PG 明說 regexp_match 不支援 g
  --    (拋棄式 PG 實測:ERROR regexp_match() does not support the "global" option)
  --    substring(x from pattern) 走 ARE, 而 ARE 的 `.` 預設就吃換行 ⇒ 不需要 s 旗標。
  v_ctrl := substring(v_src from '-- ⟦DEALER-GUARD-BEGIN⟧.*?-- ⟦DEALER-GUARD-END⟧');
  IF v_ctrl IS NULL THEN
    RAISE EXCEPTION '事後閘 A3d:抓不到身分閘區塊 ⇒ 停(這【不是】「它沒變」, 是我量不到)。';
  END IF;
  IF md5(v_ctrl) <> '20b461c1a844ee85eba4590bf6689cf1' THEN
    RAISE EXCEPTION '事後閘 A3d:身分閘區塊 md5 = %(期望 20b461c1a844ee85eba4590bf6689cf1)⇒ 有人動過那一段 ⇒ 停。', md5(v_ctrl);
  END IF;

  -- A4:p_terms 真的進到簽章裡了(A3 比的是 body, 它看不到參數列)
  -- A4:p_terms 真的進到簽章裡了(A3 比的是 body, 它看不到參數列)
  --   🔴 [codex R1 P2-④] ⛔ ~~原本用 pg_get_function_arguments(...) LIKE '%p_terms text[] DEFAULT …%'~~
  --      —— 那是【文字反解】, 而 `quote_all_identifiers = on` 時它反解成 `"p_terms"` ⇒ 比對不中
  --      ⇒ 一支【完全正確】的 migration 會被自己的閘擋掉並整筆回滾。那是部署誤擋。
  --   ✅ 改問 catalog 欄位, 不經任何文字格式。
  SELECT p.pronargs, p.proargnames[13], p.pronargdefaults
    INTO v_n, v_ctrl, v_nd
    FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.search_catalog_by_vehicle_dealer(text[],text,text,int,int,int,text,text,text[],int,int,timestamptz,text[])');
  IF v_n <> 13 THEN
    RAISE EXCEPTION '事後閘 A4a:pronargs = %(期望 13)⇒ 停。', v_n;
  END IF;
  IF v_ctrl IS DISTINCT FROM 'p_terms' THEN
    RAISE EXCEPTION '事後閘 A4b:第 13 個參數名 = %(期望 p_terms)⇒ 停。', coalesce(v_ctrl, '(NULL)');
  END IF;
  -- 🔵 預設值必須【連續靠後】—— pronargdefaults >= 1 ⇒ 最後那一個(= p_terms)一定有預設值
  -- 🔴 [codex R2 P2-④] ⛔ ~~原本只驗 pronargdefaults >= 1~~ —— 那只證明「有預設值」,
  --    證不到【是相容的預設值】。兩個具體反例(codex 給的, 我照抄不重新發明):
  --      ① 把 p_terms 預設改成非空關鍵字陣列 ⇒ 三個舊斷言全不變, 而舊呼叫端會【自動套上搜尋條件】
  --      ② 只留最後一個參數有預設值 ⇒ >= 1 照樣過, 而原本可省略其他參數的呼叫全部失效
  IF coalesce(v_nd, 0) <> 12 THEN
    RAISE EXCEPTION '事後閘 A4c:pronargdefaults = %(期望 12:除 p_categories 外每個都有預設值)⇒ 舊呼叫端會壞 ⇒ 停。', coalesce(v_nd, 0);
  END IF;
  -- 🔵 預設值本體:pg_get_expr 印的是【運算式】不是識別字 ⇒ 不受 quote_all_identifiers 影響
  SELECT pg_catalog.pg_get_expr(p.proargdefaults, 0) INTO v_txt2
    FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.search_catalog_by_vehicle_dealer(text[],text,text,int,int,int,text,text,text[],int,int,timestamptz,text[])');
  IF v_txt2 IS NULL OR v_txt2 NOT LIKE '%NULL::text[]' THEN
    RAISE EXCEPTION '事後閘 A4d:預設值運算式尾端 = %(期望以 NULL::text[] 結尾)⇒ p_terms 的預設值不是 NULL ⇒ 舊呼叫端會被自動套上搜尋條件 ⇒ 停。', coalesce(v_txt2, '(NULL)');
  END IF;

  -- ══ 以下三道是 codex R1 抓到【我把既有保護弄掉了】而補回來的 ══════════════
  -- 🛑 成因寫在這裡:我是【重寫】前後置閘而不是【複製】20260908010000 的,
  --    而重寫的時候這三道沒有跟著過來。📌 兩道是【原本就有的保護】, 不是新需求。

  -- A6 [codex R1 P1-①]:兩段標記各恰好一組
  --   🔴 少了它, A3d 的 substring 只取【第一組】⇒ 在宣告區塞一個 dollar-quoted 字串
  --      內含原版身分閘、再把真正執行的那段換成 NULL; ⇒ A3 / A3d / A3b 四把尺全綠而身分檢查消失。
  --      (codex 用字串驗過:四個讀數與原文逐字相同。它自陳沒有在 PG 上跑。)
  v_n := (length(v_src) - length(replace(v_src, '⟦DEALER-GUARD-BEGIN⟧', ''))) / length('⟦DEALER-GUARD-BEGIN⟧');
  IF v_n <> 1 THEN
    RAISE EXCEPTION '事後閘 A6a:⟦DEALER-GUARD-BEGIN⟧ 出現 % 次(期望 1)⇒ A3 的移除會移錯範圍 ⇒ 停。', v_n;
  END IF;
  v_n := (length(v_src) - length(replace(v_src, '⟦DEALER-GUARD-DECL-BEGIN⟧', ''))) / length('⟦DEALER-GUARD-DECL-BEGIN⟧');
  IF v_n <> 1 THEN
    RAISE EXCEPTION '事後閘 A6b:⟦DEALER-GUARD-DECL-BEGIN⟧ 出現 % 次(期望 1)⇒ 停。', v_n;
  END IF;
  -- 🔴 [codex R2] 兩個 END 標記也要唯一 —— 只釘 BEGIN 的話, 多一個 END 會讓非貪婪匹配提早收尾
  v_n := (length(v_src) - length(replace(v_src, '⟦DEALER-GUARD-END⟧', ''))) / length('⟦DEALER-GUARD-END⟧');
  IF v_n <> 1 THEN
    RAISE EXCEPTION '事後閘 A6c:⟦DEALER-GUARD-END⟧ 出現 % 次(期望 1)⇒ 停。', v_n;
  END IF;
  v_n := (length(v_src) - length(replace(v_src, '⟦DEALER-GUARD-DECL-END⟧', ''))) / length('⟦DEALER-GUARD-DECL-END⟧');
  IF v_n <> 1 THEN
    RAISE EXCEPTION '事後閘 A6d:⟦DEALER-GUARD-DECL-END⟧ 出現 % 次(期望 1)⇒ 停。', v_n;
  END IF;

  -- A6e [codex R2 P2-③]:🔴 宣告區【內容】也要釘, 不能只釘唯一性
  --   反例(codex 給的):在宣告標記內加 `v_abort integer := 1 / 0;`
  --   ⇒ A3 重建 md5 / A3d 身分閘 md5 / view 名計數 / 兩種 BEGIN 計數 —— 五個讀數【全部不變】
  --   ⇒ 而宣告的初始化【有執行行為】:函式一進來就除以零。
  --   📌 A3 把整個宣告區【排除掉】才成立, 所以它對宣告區裡的任何東西天生失明。
  v_ctrl := substring(v_src from '-- ⟦DEALER-GUARD-DECL-BEGIN⟧.*?-- ⟦DEALER-GUARD-DECL-END⟧');
  IF v_ctrl IS NULL THEN
    RAISE EXCEPTION '事後閘 A6e:抓不到宣告區 ⇒ 停(這【不是】「它沒變」, 是我量不到)。';
  END IF;
  IF md5(v_ctrl) <> '6a4ec0a40d946a058a87816bb9651669' THEN
    RAISE EXCEPTION '事後閘 A6e:宣告區 md5 = %(期望 6a4ec0a40d946a058a87816bb9651669)⇒ 有人在宣告區加了東西 ⇒ 停。', md5(v_ctrl);
  END IF;

  -- A7 [codex R1 P2-②]:同名函式恰一支
  --   🔴 A1 只點名 12 參與 13 參兩個具名簽章 ⇒ 一支【第三種型別】的多載會全綠留下,
  --      而 PostgREST 對同名不同型別的參數集合仍可能歧義。總數只 NOTICE 擋不住它。
  SELECT count(*) INTO v_n FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'search_catalog_by_vehicle_dealer';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '事後閘 A7:同名函式有 % 支(期望恰 1)⇒ 同名多載會讓下游每一把尺失明 ⇒ 停。', v_n;
  END IF;

  -- A8 [codex R1 P2-③]:新函式的姿態(DEFINER · 空 search_path · owner)
  --   🔴 CREATE FUNCTION 的 owner 取決於【執行角色】。P1b 驗的是【來源】那支的姿態,
  --      不是新建這支的。拋棄式庫以 postgres 成功, 證不到別的角色跑會怎樣。
  SELECT p.prosecdef, coalesce(array_to_string(p.proconfig, ','), ''), pg_get_userbyid(p.proowner)
    INTO v_sec, v_cfg, v_own
    FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.search_catalog_by_vehicle_dealer(text[],text,text,int,int,int,text,text,text[],int,int,timestamptz,text[])');
  IF NOT v_sec THEN
    RAISE EXCEPTION '事後閘 A8a:prosecdef = f(期望 t)⇒ 它讀不到 price_store ⇒ 停。';
  END IF;
  -- 🔵 `SET search_path TO ''` 在 proconfig 裡存成 `search_path=""`(帶兩個引號), 不是 `search_path=`
  --    (20260908010000:472-478 那條 codex must-fix 的實測結論, 我照抄不重新發明)
  IF v_cfg <> 'search_path=""' THEN
    RAISE EXCEPTION '事後閘 A8b:proconfig = %(期望 search_path=""(空字串))⇒ 停。', v_cfg;
  END IF;
  IF v_own <> 'postgres' THEN
    RAISE EXCEPTION '事後閘 A8c:owner = %(期望 postgres)⇒ 停。', v_own;
  END IF;

  -- A5:收權斷言 —— DROP 會把舊 ACL 一起帶走 ⇒ 那三行【必須真的生效】, 不能只是寫在檔裡
  FOREACH v_fn IN ARRAY v_functions LOOP
    SELECT p.proacl INTO v_aclarr FROM pg_catalog.pg_proc p WHERE p.oid = v_fn::regprocedure;
    -- 🔴 ACL 欄是 NULL 時 PUBLIC 看不見 —— 那正是「沒有明寫收權」的形狀;本檔明寫了 ⇒ 必須非 NULL
    IF v_aclarr IS NULL THEN
      RAISE EXCEPTION '收權斷言失敗:% 的 ACL 是 NULL ⇒ REVOKE/GRANT 那三行沒生效', v_fn;
    END IF;
    IF EXISTS (SELECT 1 FROM aclexplode(v_aclarr) a WHERE a.grantee = 0) THEN
      RAISE EXCEPTION '收權斷言失敗:% 還有 PUBLIC 的授權 ⇒ 兩道 REVOKE 少了一道', v_fn;
    END IF;
    -- 🔴 anon 不得有 —— 本支是 SECURITY DEFINER, 給 anon 等於讓未登入者以 owner 身分跑它
    IF EXISTS (SELECT 1 FROM aclexplode(v_aclarr) a JOIN pg_roles r ON r.oid = a.grantee
                WHERE r.rolname = 'anon' AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION '收權斷言失敗:% 上 anon 有 EXECUTE ⇒ 未登入者能以 owner 身分跑它 ⇒ 停', v_fn;
    END IF;
    -- 🟢 正對照:authenticated【要真的在】—— 只驗「誰不在」的話,
    --    一支【誰都叫不動】的函式也會通過, 而症狀是經銷客人打型錄 42501
    IF NOT EXISTS (SELECT 1 FROM aclexplode(v_aclarr) a JOIN pg_roles r ON r.oid = a.grantee
                    WHERE r.rolname = 'authenticated' AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION '收權斷言失敗:% 上 authenticated 沒有 EXECUTE ⇒ 經銷客人打型錄會 42501', v_fn;
    END IF;
  END LOOP;
END
$post$;

COMMIT;
