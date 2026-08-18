-- 20260819040000_m4b_20_admin_set_product_listing.sql
-- M-4b `#20`:後台上下架 RPC —— `public.admin_set_product_listing()`
--
-- plan = docs/specs/2026-08-19-product-listing-toggle-plan.md(主視窗裁「走 RPC」+ 裁「按鈕放詳情頁」)
-- 樣板 = 20260717010000_m4a_admin_set_customer_tier_rpc.sql(SECURITY DEFINER + search_path 鎖定
--        + v_ws Unicode 空白集 + 鎖列讀 before + 同值 NO_CHANGE 零寫入 + 同交易 audit
--        + REVOKE→GRANT service_role only + fail-closed 自檢)
--
-- ══ 為什麼有這一支 ═════════════════════════════════════════════════════════
-- Sean 2026-08-15 拍板 `Q-B-2=甲` / `Q-關哪一條=乙`:**下架權威從供應商移到員工**。
-- 業務理由逐字:「如果原廠停產,但是我有現貨庫存,那我需要維持上架狀態」。
-- 同步管線已照拍板停寫這一欄(`scripts/rpm-transform.ts:200-206` 逐字
--   「delisted_at 已從本型別移除,同步管線不再輸出這個 key」)
-- 🔴 **而後台沒有任何介面可以按 ⇒ 那個拍板到 2026-08-19 為止,一次都沒有被使用過。**
-- 本支是商品域的**第一條寫入路**(實測:`git grep "\.update(|\.upsert(|\.insert(|\.rpc(" --
--   apps/admin/src/{lib,components,app}/products` 排除測試 ⇒ 0 命中;
--   正向對照同一把尺對 `apps/admin/src/lib/orders` ⇒ 5 個檔命中)。
--
-- ══ 🔴🔴 與樣板【刻意不同】的一件:**不做欄級 ACL 收斂** ═══════════════════
-- 樣板的 §2b 做了 `REVOKE UPDATE ON TABLE public.customers FROM service_role`
-- 再只回欄級 GRANT,用來封死「持 service key 繞過 RPC 直接 UPDATE」的旁路。
-- 🔴 **對 `products` 不能照做,照做會把每日同步弄壞:**
--   `scripts/rpm-import.ts:21` 逐字「NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY(目標寫)」
--   ⇒ 同步管線**就是以 service_role 對 `products` 做 upsert**(`scripts/rpm-load.ts` upsertBatched)。
--   ⇒ 撤掉表級 UPDATE ⇒ 同步整條掛掉,而**它每天跑**,壞掉的隔天才會被發現。
-- ⇒ **本支只新增函式,不動 `products` 的任何表級/欄級權限。**
-- ⚠️ **代價要寫出來,不要假裝沒有**:持 service key 的人**仍然可以**繞過本 RPC
--   直接 `.from('products').update({delisted_at})` ⇒ **那條路不寫稽核、也不寫 `listing_set_by`**。
--   本支擋不掉它;要擋只能等「同步改走它自己的具名角色」那一片(**尚未存在,未排**)。
-- 🔴🔴 **而那個代價的【大小】要對齊基線,否則下一個人會誤判**(GR R1 ①,我收):
--   **持 service key 可直寫任何表,是本站的【現狀】,不是本支造成的** ——
--   admin 側有 55 個檔在用 service client(GR 掃的分母)。
--   ⇒ **本支沒有開一個新洞,是【沒有關掉一個全站都開著的舊洞】。**
--   ⇒ 🔴 寫這一句的用途:防止三個月後有人看到上面那段,以為 `products` 特別危險,
--     然後**發明一個只蓋這一張表的機制** —— 那會是一個貼在安全路上的補丁,而真正的洞在別處。
--   📎 `products` 的寫入者全集(GR 補掃):`scripts/rpm-load.ts` 的 upsert + 一支舊 spike 的 delete
--     ⇒ **零隱藏的 app 層寫入者**。
--
-- ══ rollback ══════════════════════════════════════════════════════════════
--   DROP FUNCTION public.admin_set_product_listing(uuid, boolean, text, text, text);
--   🔴 先退應用層再 drop(否則 admin 的 server action 會在執行期 404/42501,而 typecheck 抓不到
--      —— 08-07 那次正式站壞 8 小時就是這個順序反了)。
--   本支不改任何既有物件 ⇒ rollback 不影響同步、不影響既有 RPC。

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 0. 前置閘:依賴的物件必須在(fail-closed,照 N3b/W1 慣例)──────────────
DO $$
BEGIN
  IF pg_catalog.to_regclass('public.admin_audit_log') IS NULL THEN
    RAISE EXCEPTION '前置閘失敗 — public.admin_audit_log 不存在(M-4a M0-S2 未套用)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
     WHERE attrelid = 'public.products'::regclass
       AND attname  = 'listing_set_by'
       AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION '前置閘失敗 — public.products.listing_set_by 不存在(#20 片2a 未套用)';
  END IF;
END $$;

-- ── 1. RPC 本體 ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_product_listing(
  p_product_id uuid,
  -- true = 下架(delisted_at 設為 now())/ false = 上架(delisted_at 設為 NULL)
  p_delisted   boolean,
  -- 變更原因。🔴 **本片刻意做成【選填】**(見下方註)。
  p_note       text,
  p_actor      text,
  p_request_id text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- 空白字元集:逐字沿用樣板 20260717010000 的 31 字元全集(理由見該檔;
  -- PG POSIX regex 無 \p{White_Space},只能顯式列舉;E'' 不支援 \v ⇒ 垂直 tab 用 \013)。
  v_ws constant text := E' \t\r\n\f\013'
    || U&'\0085' || U&'\00A0' || U&'\1680' || U&'\180E'
    || U&'\2000' || U&'\2001' || U&'\2002' || U&'\2003' || U&'\2004'
    || U&'\2005' || U&'\2006' || U&'\2007' || U&'\2008' || U&'\2009'
    || U&'\200A' || U&'\200B' || U&'\200C' || U&'\200D'
    || U&'\2028' || U&'\2029' || U&'\202F' || U&'\205F' || U&'\2060'
    || U&'\3000' || U&'\FEFF';
  v_note              text;
  v_before_delisted   timestamptz;
  v_before_set_by     text;
  v_after_delisted    timestamptz;
BEGIN
  -- 0. v_ws 自檢(字面漂移 ⇒ 全 RPC 拒用、fail-loud;同樣板)。
  IF pg_catalog.char_length(v_ws) <> 31 THEN
    RAISE EXCEPTION 'admin_set_product_listing: v_ws 字元集長度異常(預期 31)';
  END IF;

  -- 1a. server 供參數 fail-closed(actor 由 server session 解析、非 client;
  --     缺 ⇒ 拒,不以未知身分寫稽核)。
  IF p_actor IS NULL OR pg_catalog.btrim(p_actor, v_ws) = '' THEN
    RAISE EXCEPTION 'admin_set_product_listing: 缺 actor';
  END IF;
  IF p_request_id IS NULL OR pg_catalog.btrim(p_request_id, v_ws) = '' THEN
    RAISE EXCEPTION 'admin_set_product_listing: 缺 request_id';
  END IF;
  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'admin_set_product_listing: 缺 product_id';
  END IF;
  IF p_delisted IS NULL THEN
    RAISE EXCEPTION 'admin_set_product_listing: 缺 delisted';
  END IF;

  -- 1b. 變更原因:**選填**,而給了就要合法。
  -- 🔴 為什麼選填(與樣板的 tier 相反,那支是 Sean `Q2=A` 明確要求必填):
  --    上下架是**每天會做很多次**的操作,而 Sean 沒有對它拍過「必填」。
  --    稽核已經記了【誰】【什麼時候】【從什麼變成什麼】—— 那三樣是自動的、不靠人打字。
  --    ⚠️ 而**改成必填是一行**(把下面那個 NULL 分支換成 RAISE)⇒ Sean 若要,成本極低。
  IF p_note IS NULL THEN
    v_note := NULL;
  ELSE
    v_note := pg_catalog.btrim(p_note, v_ws);
    IF v_note = '' THEN
      v_note := NULL;  -- 只打空白 = 沒給,不當成「原因是空字串」
    ELSIF pg_catalog.char_length(v_note) > 200 OR v_note ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION 'admin_set_product_listing: 變更原因非法';
    END IF;
  END IF;

  -- 1c. 鎖列 + before 快照(同品項並發序列化;查無 ⇒ 固定碼,讓 UI 顯示「找不到這件商品」)。
  SELECT delisted_at, listing_set_by
    INTO v_before_delisted, v_before_set_by
    FROM public.products
   WHERE id = p_product_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'NOT_FOUND';
  END IF;

  -- 1d. 同值冪等:零寫入零稽核。
  -- 🔴 判準是【上架/下架這個狀態】,不是 delisted_at 的值 ——
  --    已經下架的再按一次「下架」**不重新蓋時間戳**(那會讓「什麼時候下架的」失真,
  --    而那正是稽核要回答的問題)。
  IF (p_delisted AND v_before_delisted IS NOT NULL)
     OR (NOT p_delisted AND v_before_delisted IS NULL) THEN
    RETURN 'NO_CHANGE';
  END IF;

  v_after_delisted := CASE WHEN p_delisted THEN pg_catalog.now() ELSE NULL END;

  -- 1e. 目的寫入:**兩欄一起**。
  -- 🔴🔴 `listing_set_by = 'staff'` 是這整件事的重點,不是附帶:
  --    不寫它,同步下一輪確實不會碰 delisted_at(2026-08-15 拍板後它已停寫),
  --    **但【這個狀態是誰決定的】就沒有落點** —— 而那正是 Sean 那個拍板的載體。
  --    (欄位語意見 20260815030000 的 COMMENT:'sync=每日同步管線;staff=後台員工手動設定'。)
  UPDATE public.products
     SET delisted_at    = v_after_delisted,
         listing_set_by = 'staff',
         updated_at     = pg_catalog.now()
   WHERE id = p_product_id;

  -- 1f. 同交易寫稽核(before/after 鍵名對稱;reason 可為 NULL)。
  INSERT INTO public.admin_audit_log (actor, action, target, before, after, reason, request_id, source_app)
  VALUES (
    p_actor,
    'product.listing.change',
    'product:' || p_product_id::text,
    pg_catalog.jsonb_build_object(
      'delisted_at', v_before_delisted,
      'listing_set_by', v_before_set_by
    ),
    pg_catalog.jsonb_build_object(
      'delisted_at', v_after_delisted,
      'listing_set_by', 'staff'
    ),
    v_note,
    p_request_id,
    'admin'
  );

  RETURN 'UPDATED';
END;
$$;

COMMENT ON FUNCTION public.admin_set_product_listing(uuid, boolean, text, text, text) IS
  'M-4b #20 後台上下架(Sean 2026-08-15 Q-B-2=甲 把下架權威從供應商移到員工;同步管線已停寫 delisted_at)。'
  'SECURITY DEFINER owner RPC;鎖列讀 before → 同【狀態】回 NO_CHANGE 零寫入 → UPDATE 同時寫 '
  'delisted_at 與 listing_set_by=staff → 同交易寫 admin_audit_log(product.listing.change)。'
  '回 UPDATED/NO_CHANGE/NOT_FOUND。EXECUTE 僅 service_role。'
  '🔴 刻意不做欄級 ACL 收斂:同步管線以 service_role upsert products,撤表級 UPDATE 會把它弄壞。';

-- ── 2. EXECUTE 權限:REVOKE 全 client → 只 GRANT service_role(admin server 專用)──
REVOKE ALL ON FUNCTION public.admin_set_product_listing(uuid, boolean, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_product_listing(uuid, boolean, text, text, text)
  TO service_role;

-- ── 3. apply 期斷言:上面兩件真的生效了才算數(fail-closed)──────────────────
DO $$
DECLARE
  v_bad text := '';
BEGIN
  IF pg_catalog.to_regprocedure(
       'public.admin_set_product_listing(uuid, boolean, text, text, text)') IS NULL THEN
    v_bad := v_bad || '函式沒有建立成功;';
  END IF;
  -- anon / authenticated 不得有 EXECUTE(縱深:它們本來就打不到 admin server,這是第二道)
  IF pg_catalog.has_function_privilege('anon',
       'public.admin_set_product_listing(uuid, boolean, text, text, text)', 'EXECUTE') THEN
    v_bad := v_bad || 'anon 仍可 EXECUTE;';
  END IF;
  IF pg_catalog.has_function_privilege('authenticated',
       'public.admin_set_product_listing(uuid, boolean, text, text, text)', 'EXECUTE') THEN
    v_bad := v_bad || 'authenticated 仍可 EXECUTE;';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role',
       'public.admin_set_product_listing(uuid, boolean, text, text, text)', 'EXECUTE') THEN
    v_bad := v_bad || 'service_role 沒有 EXECUTE;';
  END IF;
  IF v_bad <> '' THEN
    RAISE EXCEPTION 'admin_set_product_listing apply 期斷言失敗:%', v_bad;
  END IF;
END $$;

COMMIT;
