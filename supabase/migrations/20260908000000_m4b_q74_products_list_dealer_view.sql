-- ⟦M-4b · Q74 目錄頁經銷價 · 第 1 片 / 共 2 片⟧ 建【經銷專用列表 view】
--
-- 為什麼要有這一片(不看不懂的話, 這段就是全部的理由):
--   顧客站目錄頁的 RPC `search_catalog_by_vehicle` 是 `SECURITY INVOKER`, 顧客站用 `anon` 打它
--   ⇒ 它以 anon 的身分跑。而 2026-09-07 唯讀實測:
--     · `public.products` 整表 relacl = {postgres, service_role, pcm_readonly} ⇒ anon 整表零權限, 只有欄級
--     · 有欄級 ACL 的 20 欄裡 `price_general` 在, 🔴 `price_store` 不在
--     · `public.products_list_public` 16 欄, 無 `price_store`, reloptions = {security_invoker=true}, anon=r
--   📌 ⇒ 今天那支函式【根本讀不到經銷價】—— 不是擋得好, 是讀不到。
--   ⇒ 現況沒有洩漏風險【不是設計出來的】, 是副作用。改動時不得依賴它。
--   ⚠️ 收窄(codex R2 nit):讀不到的表現是【權限錯誤】, 不是「安靜退回一般價」——
--     所以它今天是 fail-loud 的;而那也代表:一旦改成 DEFINER, 那個 loud 就消失了。
--
-- 本片做什麼:建一支【不對 anon / authenticated 開】的 view, 價格欄換成經銷價。
--   下一片(第 2 片)才是那支 SECURITY DEFINER 的經銷 RPC, 它讀這一支。
--   ⇒ 🔵 本片單獨貼完【對顧客站零行為改變】:沒有任何呼叫端讀它, anon / authenticated 也讀不到。
--     ⚠️ 而「零行為改變」這句話要收窄(codex R1 nit):它確實【新增了一個 service_role 可能讀得到的資源】,
--     也【新增了一條結構相依】(products_list_public 之後要改就會被它擋)。那兩件是真的改變。
--
-- 為什麼是「另開一支」而不是「把 price_store 加進 products_list_public」:
--   那張 view 是 security_invoker=true ⇒ 用【呼叫者】的權限讀底表
--   ⇒ 加了那一欄, anon 一旦選到它就是 permission denied, 不是看到經銷價。
--
-- 為什麼經銷 view 直接 SELECT ... FROM products_list_public 而不是重抄一份 WHERE:
--   🔴 `apps/storefront/src/lib/vehicle-facet-counts.ts:88-94` 那段 docblock 逐字:
--      「面板數字 = 點進去的件數」的保證來自**兩邊走同一支 RPC 的同一個述詞**
--   ⇒ 清單改讀經銷、facet 留在一般 ⇒ 兩邊不再是同一支函式
--   ⇒ 若經銷 view 自己重抄一份列過濾, 差一個字面板數字就開始騙人。
--   ⇒ ✅ 本片把列過濾【整個委託給 products_list_public】⇒ 列集合逐列相同【是構造出來的, 不是靠斷言】。
--      唯一的差別是價格那一個運算式。
--
-- 🔴🔴 **而「委託給 products_list_public 就等於列集合相同」這句話【本來是錯的】—— 修在這裡, 記在這裡:**
--   `pg_get_viewdef('public.products_list_public')` 實測:**它自己沒有任何 WHERE** ——
--   逐字只有 `FROM products p JOIN brands b ... JOIN categories c ...`。
--   🔴 **「不顯示已下架」那一刀【整個住在 RLS policy 裡】**:
--     `products_select_public` USING `(delisted_at IS NULL)`(對 PUBLIC 角色)。
--   而 `public.products` 是 `relrowsecurity = t` / `relforcerowsecurity = f`
--   ⇒ 📌 **本 view 是 security_invoker=false、owner=postgres(也是表的 owner)⇒ 它【繞過 RLS】。**
--   ⇒ 🛑 **沒有這一句 `WHERE pr.delisted_at IS NULL` 的話, 559 筆已下架商品會出現在經銷清單裡。**
--     (2026-09-07 唯讀實測:products 全部 25,769 / 已下架 **559** / 未下架 25,210。)
--   ⇒ ⚠️ **代價要明寫**:這一刀現在是【RLS policy 的一份手抄本】——
--     policy 改了, 這張 view 不會紅、只會安靜地跟它分家。前置閘④把 policy 的字面釘住,
--     那擋得住「貼片當下已經不一樣」, **擋不住貼完之後才被改**。已列為殘餘風險。
--   🔵 brands / categories 也開著 RLS, 而它們的讀 policy USING 都是 `true` ⇒ 繞過去看到的一樣多(實測)。
--
-- 🔵 **今天這一片的判別力 = 0, 明寫**(2026-09-07 唯讀實測, 分母 25,769 筆 products):
--   `price_store IS NOT NULL` = **1** 筆;而 `price_store IS DISTINCT FROM price_general` = **0** 筆
--   ⇒ 📌 **今天全站沒有任何一筆商品的經銷價與一般價不同** ⇒ **改對與改錯會印出同一個畫面。**
--   ⇒ 驗收綁在上游同步上線前(有真資料那一刻), 不綁在一個沒有判別力的數。
--
-- 🔵 而 facet 那條路【不需要】經銷版(2026-09-07 實測, 免得下一個人以為漏做):
--   `vehicle-facet-counts.ts` 全檔 p_price_min / p_price_max 四處全是字面 `null`(:99-100 是**型別**釘死的,
--   :220-221 是呼叫), 且 p_sort='new' ⇒ 它永遠不吃價格條件、永遠不走 recommend 價帶
--   ⇒ 經銷價對它的輸出零影響。⚠️ 而【舊 11 參數多載仍然是活的正線, 不可以收掉】—— 它活著, 而它不吃價格。
--
-- 授權姿態(照 docs/patterns/revoking-function-execute-in-supabase.md):
--   新物件出生自帶 DEFACL ⇒ 兩道 REVOKE 都下, 而且【誰都不 GRANT】。
--   ⚠️ 🔴 codex R1 nit:所以【不能說「誰都不 GRANT / 沒有人拿得到」】——
--     `service_role` 很可能仍從 DEFACL 拿到 SELECT。本片不收它(它本來就讀得到底表 price_store),
--     而事後閘會把它當下的 relacl 原樣 NOTICE 出來, 讓貼的人看見, 不靠我這裡的宣稱。
--
-- 🛑 本片證不到什麼:
--   · 沒有驗「Supabase 在 anon 那條路帶不帶 JWT」—— 那是平台行為, 下一片才需要它。
--   · 沒有量成本 —— 本片零呼叫端, 沒有東西可量。
--   · `coalesce(price_store, price_general)` 這個【回退到一般價】的語意是本片自己定的, 不是抄來的;
--     若上游規則是「沒有經銷價就不該出現在經銷清單」, 那要改的是這一行。已寫進 plan §9 待確認格。

BEGIN;

SET LOCAL lock_timeout = '5s';
-- 🔴 codex R2 must-fix ④:本檔有三處靠【反解出來的字面】做判斷(policy 指紋 / USING 逐字 / viewdef)。
--    連線若開著 quote_all_identifiers, 反解會變成 "delisted_at" IS NULL ⇒ 三處【全部誤報】,
--    而誤報的方向是【擋下一份完全正確的東西】—— 看起來像 migration 壞了, 實際是量具被環境改了。
SET LOCAL quote_all_identifiers = off;

DO $pre$
DECLARE
  v_cols  text;
  v_want  text := 'id,title,subtitle,handle,brand_id,category_id,availability,fitments,'
                  || 'price_general,supplier_slug,card_image,fits,brand_name,brand_slug,category_raw,created_at';
  v_n     int;
  v_opts  text;
BEGIN
  -- 前置閘① 來源 view 在, 而且【欄名與欄序】就是我抄的那一份
  --   為什麼要比【順序】不只比集合:本片用 `SELECT v.*` 的替代寫法時欄序會外洩到呼叫端;
  --   逐欄列名之後順序仍然是合約的一部分(下一片那支函式的 RETURNS TABLE 依賴它)。
  SELECT string_agg(a.attname, ',' ORDER BY a.attnum)
    INTO v_cols
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'products_list_public'
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cols IS NULL THEN
    RAISE EXCEPTION '前置閘①:找不到 public.products_list_public ⇒ 停(不是「它沒欄位」, 是它不在)。';
  END IF;
  IF v_cols IS DISTINCT FROM v_want THEN
    RAISE EXCEPTION '前置閘①:products_list_public 的欄名/欄序變了 ⇒ 停。實際=% / 期望=%', v_cols, v_want;
  END IF;

  -- 前置閘② 底表真的有 price_store(否則本片建出來的東西是空的)
  SELECT count(*) INTO v_n
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'products'
     AND a.attname = 'price_store' AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '前置閘②:public.products.price_store 命中 % 欄(期望 1)⇒ 停。', v_n;
  END IF;

  -- 前置閘③ 三態:不存在 ⇒ 建;已經是我這一份 ⇒ 整筆回滾(no-op);是別的東西 ⇒ 拒絕
  SELECT c.reloptions::text INTO v_opts
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'products_list_dealer';
  IF FOUND THEN
    SELECT string_agg(a.attname, ',' ORDER BY a.attnum)
      INTO v_cols
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'products_list_dealer'
       AND a.attnum > 0 AND NOT a.attisdropped;
    IF v_cols IS NOT DISTINCT FROM v_want THEN
      -- 🔴 codex R2 nit:欄名欄序相同【不等於】就是本片那一份(WHERE 或價格運算式可能不同)。
      --   兩條分支都是 RAISE ⇒ 不會誤放行, 錯的只是訊息。訊息改成講得出自己不知道什麼。
      RAISE EXCEPTION '前置閘③(良性):已有一支 products_list_dealer, 16 欄逐欄對得上 ⇒ 整筆回滾, 什麼都沒改。⚠️ 本閘只比欄名欄序, 【不保證】它的定義與本片相同 —— 要確認請人工比 pg_get_viewdef。';
    END IF;
    RAISE EXCEPTION '前置閘③:products_list_dealer 已存在【而它不是本片這一份】(欄=%)⇒ 停, 不覆蓋別人的東西。', v_cols;
  END IF;

  -- 前置閘④ 🔴 codex R1 must-fix ③:原本只比 products_select_public 一條、只看 polcmd='r'
  --   ⇒ 新增一條 restrictive 的 `FOR ALL USING(false)`、或改角色適用範圍, 全綠照過,
  --      而那些【只擋 invoker 路徑】的東西, 本 view 繞過去之後就會回傳一般目錄看不到的商品。
  --   ⇒ 改成釘住三張表【全部】policy 的指紋(名稱/cmd/permissive/角色/USING/WITH CHECK 全進指紋)。
  --   ⚠️ 這個指紋只答「與我量的那一刻一不一樣」, 不答「新的那條危不危險」—— 它紅了要人來看, 不是自動放行。
  SELECT md5(string_agg(x, chr(10) ORDER BY x)), count(*)
    INTO v_cols, v_n
    FROM (
      -- 🔴 codex R2 must-fix ①:原本 PUBLIC(polroles 裡的 0)被 pg_get_userbyid 印成 'unknown (OID=0)',
      --   而那是一個【真實角色也可能長成的字串】⇒ 把公開讀取改授給一個同名角色, 指紋一個字都不會變,
      --   而 anon 會看不到商品、經銷那條路照樣看得到。⇒ PUBLIC 標成 @PUBLIC@(具名角色一律過 quote_ident,
      --   加得出引號 ⇒ 兩者永遠不同形), 且多角色清單【排序】(polroles 的陣列順序不保證穩定)。
      SELECT c.relname||'|'||pl.polname||'|'||pl.polcmd::text||'|'||pl.polpermissive::text||'|'
             || array_to_string(ARRAY(SELECT CASE WHEN m = 0 THEN '@PUBLIC@' ELSE quote_ident(pg_get_userbyid(m)) END
                                        FROM unnest(pl.polroles) m ORDER BY 1), ',')||'|'
             || coalesce(pg_get_expr(pl.polqual, pl.polrelid), '-')||'|'
             || coalesce(pg_get_expr(pl.polwithcheck, pl.polrelid), '-') AS x
        FROM pg_policy pl
        JOIN pg_class c ON c.oid = pl.polrelid
        JOIN pg_namespace n2 ON n2.oid = c.relnamespace
       WHERE n2.nspname = 'public' AND c.relname IN ('products', 'brands', 'categories')
    ) t;
  IF v_n <> 13 OR v_cols IS DISTINCT FROM '9bbf9f20aec682e7966f9bf7146c67e4' THEN
    RAISE EXCEPTION '前置閘④:products/brands/categories 的 RLS policy 變了(條數=% 期望 13 / 指紋=% 期望 9bbf9f20aec682e7966f9bf7146c67e4)⇒ 停 —— 本 view 繞過 RLS, 而它手抄的那一刀只涵蓋 2026-09-07 那一組 policy。', v_n, coalesce(v_cols, '(NULL)');
  END IF;

  -- 前置閘⑤ 那一刀本身:products_select_public 的 USING 必須逐字是我抄的那一句
  --   (④ 已涵蓋它, 這一條是【講得出人話的錯誤訊息】—— 指紋紅了看不出是哪一條變了。)
  SELECT pg_get_expr(pl.polqual, pl.polrelid) INTO v_cols
    FROM pg_policy pl
   WHERE pl.polrelid = 'public.products'::regclass AND pl.polname = 'products_select_public';
  IF v_cols IS DISTINCT FROM '(delisted_at IS NULL)' THEN
    RAISE EXCEPTION '前置閘⑤:products_select_public 的 USING 不是我抄的那一句(實際=%)⇒ 停, 本 view 的 WHERE 會與它分家。', coalesce(v_cols, '(查無此 policy)');
  END IF;

  -- 前置閘⑥ 三張表都必須【還開著 RLS】—— 關掉 RLS 的話, 一般路徑自己就會多看到列,
  --   而本 view 與它的差異就不再是「多繞過一層」而是「兩邊都壞了」, 診斷會指錯方向。
  SELECT count(*) INTO v_n
    FROM pg_class c JOIN pg_namespace n2 ON n2.oid = c.relnamespace
   WHERE n2.nspname = 'public' AND c.relname IN ('products', 'brands', 'categories')
     AND c.relrowsecurity;
  IF v_n <> 3 THEN
    RAISE EXCEPTION '前置閘⑥:三張表裡只有 % 張還開著 RLS(期望 3)⇒ 停。', v_n;
  END IF;

  -- 前置閘⑦ 🔴 codex R2 must-fix ②:來源 view 自己必須還是 security_invoker=true。
  --   若它被改成 false(owner=postgres), 那 anon 讀【公開清單】時也會繞過 RLS ⇒ 公開清單【含】下架列,
  --   而本 view 補了刀 ⇒ 【不含】⇒ 兩邊列集合不同, 而前面每一道閘都會綠。
  --   📌 這一條是「我委託的那個東西的姿態」—— 而姿態不在欄名裡, 欄名閘看不見它。
  -- 🔵 用 pg_options_to_table 取【那一個選項的值】, 不對整串 reloptions 做字面比對。
  --    ⓐ 字面比對會被排版差異影響;
  --    ⓑ 而它也讓本檔的碼裡不再出現那個選項名加等號加 true 的字串 ——
  --       scripts/invoker-view-execute-gate.py 用那串字判斷「這支檔在建 invoker view」,
  --       而本檔只是【在檢查別人是不是】⇒ 原寫法會讓那道閘誤報(它自己的 docstring 第 31-33 行
  --       就寫著同一個病:一支在【講】它的字串, 與一支【是】它的碼, 對字面尺長得一樣)。
  SELECT o.option_value INTO v_opts
    FROM pg_class c
    JOIN pg_namespace n2 ON n2.oid = c.relnamespace
    LEFT JOIN LATERAL pg_options_to_table(c.reloptions) o ON o.option_name = 'security_invoker'
   WHERE n2.nspname = 'public' AND c.relname = 'products_list_public';
  IF v_opts IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION '前置閘⑦:products_list_public 的 security_invoker 選項 = %(期望 true)⇒ 停 —— 公開清單與經銷清單的列集合會分岔。', coalesce(v_opts, '(沒有這個選項)');
  END IF;

END
$pre$;

-- ─────────────────────────────────────────────────────────────
-- 🔴 security_invoker 【刻意不設】⇒ 預設 false ⇒ 這張 view 以 owner(postgres)的權限讀底表。
--    ⚠️ 收窄(codex R1 nit):把它設成 true 【也會動】—— 因為讀它的是一支 owner=postgres 的 DEFINER RPC,
--    那條路上 current_user 本來就是 postgres。⇒ false 不是【必要】, 是【自足】:
--    這張 view 不論被誰讀都拿得到 price_store, 不依賴呼叫它的那一層是什麼姿態。
--    ⇒ 而正因為它自足, 那道 `WHERE delisted_at IS NULL` 就【一定】要在這裡, 不能指望上層補。
-- ─────────────────────────────────────────────────────────────
CREATE VIEW public.products_list_dealer AS
SELECT
  v.id,
  v.title,
  v.subtitle,
  v.handle,
  v.brand_id,
  v.category_id,
  v.availability,
  v.fitments,
  -- 🔴 唯一與 products_list_public 不同的一格。名字【刻意沿用 price_general】——
  --    下一片那支函式是一般那支的逐字複本(只換 view 名), 欄名一改就得改一整串。
  coalesce(pr.price_store, v.price_general) AS price_general,
  v.supplier_slug,
  v.card_image,
  v.fits,
  v.brand_name,
  v.brand_slug,
  v.category_raw,
  v.created_at
FROM public.products_list_public v
JOIN public.products pr ON pr.id = v.id
-- 🔴 這一刀是 RLS policy `products_select_public` 的手抄本, 不是這張 view 自己的想法。
--    products_list_public 沒有 WHERE;那一刀住在 RLS, 而本 view 繞過 RLS。少了它 = 559 筆已下架商品外流。
WHERE pr.delisted_at IS NULL;

COMMENT ON VIEW public.products_list_dealer IS
  '⟦M-4b Q74⟧ 經銷專用列表 view:列過濾整個委託給 products_list_public(⇒ 列集合逐列相同是構造出來的), 只把價格欄換成 coalesce(price_store, price_general)。security_invoker 刻意不設(=false)⇒ 以 owner 權限讀得到 price_store。🔴 誰都不 GRANT —— 只有 SECURITY DEFINER 的經銷 RPC 以 owner 身分讀它。';

-- 兩道 REVOKE(少一道都是開的);而本片【誰都不 GRANT】
REVOKE ALL ON TABLE public.products_list_dealer FROM PUBLIC;
REVOKE ALL ON TABLE public.products_list_dealer FROM anon, authenticated;

DO $post$
DECLARE
  v_acl   text;
  v_opts  text;
  v_cols  text;
  v_want  text := 'id,title,subtitle,handle,brand_id,category_id,availability,fitments,'
                  || 'price_general,supplier_slug,card_image,fits,brand_name,brand_slug,category_raw,created_at';
  v_owner text;
  v_pos   boolean;
  v_neg   boolean;
  r_rel   text;
  v_si    text;  -- security_invoker 那一個選項的值(用 pg_options_to_table 取, 不做整串字面比對)
  v_n     int;   -- 🔴 codex R1 must-fix ①:上一個 DO 區塊的變數【不跨區塊】, 少了這一行整支編譯失敗。
  -- 🔴 收權斷言清單:本片建出來的【可授權物件】全部列在這裡。
  --    這道斷言只檢查【你列出來的】⇒ 漏列等於沒檢查, 所以清單本身由 migration-static-checks ③ 守著。
  v_relations text[] := ARRAY['public.products_list_dealer']::text[];
BEGIN
  SELECT coalesce(c.relacl::text, '(NULL)'), coalesce(c.reloptions::text, '(NULL)'),
         pg_get_userbyid(c.relowner)
    INTO v_acl, v_opts, v_owner
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'products_list_dealer';
  IF NOT FOUND THEN
    RAISE EXCEPTION '事後閘①:建完之後找不到它 ⇒ 停。';
  END IF;

  -- 事後閘② 欄名與欄序逐欄對上一般那支(下一片的合約)
  SELECT string_agg(a.attname, ',' ORDER BY a.attnum)
    INTO v_cols
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'products_list_dealer'
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cols IS DISTINCT FROM v_want THEN
    RAISE EXCEPTION '事後閘②:欄名/欄序對不上(實際=% / 期望=%)⇒ 停。', v_cols, v_want;
  END IF;

  -- 事後閘③ security_invoker 不得為 true(true ⇒ 它就讀不到 price_store, 而【那不會報錯, 只會安靜地回一般價】)
  SELECT o.option_value INTO v_si
    FROM pg_class c
    LEFT JOIN LATERAL pg_options_to_table(c.reloptions) o ON o.option_name = 'security_invoker'
   WHERE c.oid = 'public.products_list_dealer'::regclass;
  IF v_si IS NOT DISTINCT FROM 'true' THEN
    RAISE EXCEPTION '事後閘③:本 view 的 security_invoker 選項是 true ⇒ 它讀不到 price_store ⇒ 停(reloptions=%)。', v_opts;
  END IF;

  -- 事後閘④ 逐一走過收權斷言清單:ACL 裡不得出現 anon / authenticated
  --   🔴 比 relacl 的【字面】, 不只問 has_*_privilege —— 後者對欄級授權會少報。
  FOREACH r_rel IN ARRAY v_relations LOOP
    IF to_regclass(r_rel) IS NULL THEN
      RAISE EXCEPTION '事後閘④:斷言清單裡的 % 不存在 ⇒ 停(清單與實作分家了)。', r_rel;
    END IF;
    SELECT coalesce(c.relacl::text, '(NULL)') INTO v_acl
      FROM pg_class c WHERE c.oid = to_regclass(r_rel);
    IF v_acl ILIKE '%anon=%' OR v_acl ILIKE '%authenticated=%' THEN
      RAISE EXCEPTION '事後閘④:% 的 relacl 仍含 anon/authenticated ⇒ 兩道 REVOKE 沒收乾淨(acl=%)⇒ 停。', r_rel, v_acl;
    END IF;
  END LOOP;

  -- 事後閘⑤ 量具要能雙向表演:同一把尺對【該有的】印 true、對【不該有的】印 false
  --   🔴 codex R1 must-fix ②:原本只驗 anon。而 authenticated 也是 PostgREST 會用的角色,
  --      且 relacl 的字面檢查看不到【透過角色繼承拿到的】權限 ⇒ 兩個角色都要問【有效權限】。
  FOREACH r_rel IN ARRAY ARRAY['anon', 'authenticated']::text[] LOOP
    v_pos := has_table_privilege(r_rel, 'public.products_list_public', 'SELECT');
    v_neg := has_table_privilege(r_rel, 'public.products_list_dealer', 'SELECT');
    IF NOT v_pos THEN
      RAISE EXCEPTION '事後閘⑤:正對照失敗 —— % 連 products_list_public 都 SELECT 不到 ⇒ 這把尺今天壞了, 它的 false 不算數 ⇒ 停。', r_rel;
    END IF;
    IF v_neg THEN
      RAISE EXCEPTION '事後閘⑤:% 對 products_list_dealer 仍有【有效】SELECT(可能來自角色繼承, relacl 字面看不到)⇒ 停。', r_rel;
    END IF;
    -- 欄級:整表沒有不代表每一欄都沒有(has_table_privilege 對欄級授權會少報)
    -- 🔴 codex R2 nit:這一格原本【只有負向】—— 一把只印過 false 的尺, 它的 false 不算數。
    IF NOT has_column_privilege(r_rel, 'public.products_list_public', 'price_general', 'SELECT') THEN
      RAISE EXCEPTION '事後閘⑤:欄級正對照失敗 —— % 對 products_list_public.price_general 都沒有 SELECT ⇒ 這把欄級尺今天壞了 ⇒ 停。', r_rel;
    END IF;
    IF has_column_privilege(r_rel, 'public.products_list_dealer', 'price_general', 'SELECT') THEN
      RAISE EXCEPTION '事後閘⑤:% 對 products_list_dealer.price_general 有欄級 SELECT ⇒ 停。', r_rel;
    END IF;
  END LOOP;

  IF v_owner <> 'postgres' THEN
    RAISE EXCEPTION '事後閘⑥:owner 是 %(期望 postgres)⇒ 它以誰的權限讀底表就變了 ⇒ 停。', v_owner;
  END IF;

  -- 事後閘⑦ 已下架不得出現在經銷清單 —— 而這把尺要【雙向表演】:
  --   正對照:同一個判準套在【沒有那一刀】的集合上, 必須 > 0(證明尺看得見已下架這件事)
  --   待驗  :套在本 view 上, 必須 = 0
  SELECT count(*) INTO v_n
    FROM public.products_list_public v JOIN public.products pr ON pr.id = v.id
   WHERE pr.delisted_at IS NOT NULL;
  IF v_n = 0 THEN
    RAISE EXCEPTION '事後閘⑦:正對照失敗 —— 今天一筆已下架都沒有 ⇒ 這把尺的 0 不算數 ⇒ 停(要人來判, 不是自動放行)。';
  END IF;
  RAISE NOTICE '事後閘⑦ 正對照:未套刀時看得到 % 筆已下架', v_n;
  SELECT count(*) INTO v_n
    FROM public.products_list_dealer d JOIN public.products pr ON pr.id = d.id
   WHERE pr.delisted_at IS NOT NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '事後閘⑦:經銷 view 裡有 % 筆已下架 ⇒ 停。', v_n;
  END IF;

  -- 事後閘⑧ 列集合守恆:經銷 view 的列數 = 公開 view 扣掉已下架
  SELECT (SELECT count(*) FROM public.products_list_dealer)
       - (SELECT count(*) FROM public.products_list_public v2
            JOIN public.products pr2 ON pr2.id = v2.id
           WHERE pr2.delisted_at IS NULL)
    INTO v_n;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '事後閘⑧:列數差 %(期望 0)⇒ JOIN 扇出或漏列 ⇒ 停。', v_n;
  END IF;

  RAISE NOTICE '✅ products_list_dealer 建好:owner=% acl=% reloptions=% / anon 正對照=true 待驗=false',
    v_owner, v_acl, v_opts;
END
$post$;

COMMIT;
