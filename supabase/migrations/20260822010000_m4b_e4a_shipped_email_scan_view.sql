-- M-4b E4-a:出貨通知信的「還沒排過信」掃描面 —— **一個 view,零寫入,不寄任何東西**。
--
-- ══ 0. 這支解決什麼 ══════════════════════════════════════════════════════════
-- `order_created` 那條線的 enqueue 走「掃描 + 差集」(`SupabasePaidOrderScannerAdapter`),
-- 而它的 anti-join 是在 PostgREST 上用 embed 語法拼的。那支 adapter 的檔頭自己記著那個語法
-- 有一個**寫錯了會回 200 而且看起來完全正常**的形狀(`email_outbox.order_id=is.null` vs
-- `email_outbox=is.null`)。
--
-- 🔴 出貨這條的差集鍵**比那條複雜一層**:它不是 `order_id`,是 `(箱, 單)` 這個配對,
--    而且要跨 `shipments → shipment_items → order_items → orders` 四張表。
--    在 PostgREST 上拼四張表的複合 anti-join = 把上面那個坑放大四倍。
-- ⇒ 差集寫在 SQL 裡、由 DB 保證,TS 端只做「讀一頁、加 cutoff 條件」。
--
-- ══ 1. 為什麼是 (箱, 單) 而不是 (箱) ═══════════════════════════════════════
-- **Sean 2026-08-17 已拍板:一箱兩單就寄兩封,一封講一張訂單。**
--   逐字出處 `~/pcm-mailbox/C-219-STOP-20260817.md:181`,
--   決策表與前後文 `docs/specs/2026-08-17-qc9-tracking-to-customer-plan.md:305-325`。
--   2026-08-22 再問過一次,答案相同(**不是新拍板,是再次確認**)。
--
-- 🔴 **那次拍板【收窄】了更早的 `S2=B`「每出一批寄一封」。**
--    `S2=B` 的字面還留在 `20260717020000_m4a_email_outbox.sql:7 :19 :349` 與四份 spec 裡
--    —— **那些字面不改**(已 apply 的 migration 註解不可改;spec 側加日期註記、不刪原句)。
--    ⇒ 讀到那句話的人請看這裡:**`S2=B` 講的「一批」在他講的當下還沒有「一箱可含兩張單」
--      這個前提**(那份 plan `:322` 自己記下了這個判斷)。
--
-- ⚠️ **今天這個新行為一次都不會被真實資料執行到**(2026-08-22 唯讀量測):
--      已出貨且未作廢的箱 = 2、攤開成 (箱,單) 配對 = 2、**裝了超過一張單的箱 = 0**。
--    ⇒ 「一箱兩單寄兩封」這條路**沒有任何真實流量會走到** ⇒ 它壞掉時不會有人發現。
--    ⇒ 🔴 守住它的東西有三個,**分屬三層,少一層就有一整段沒人看**(codex 2026-08-22 R1 更正:
--      ~~原本寫「唯一量具是 TS 的突變測試」~~ —— 那句話錯了,TS 那格**碰不到 SQL**):
--      ① TS 側 dedup 字面 → `SupabaseEmailOutboxAdapter.test.ts`
--      ② SQL 側 dedup 字面 → 本檔 §4b 的 apply 期釘樁
--      ③ view 真的攤成兩列 → 2026-08-22 拋棄式 PG 實跑(一箱兩單 ⇒ **2 列**,已量到)
--    ⚠️ 而**沒有任何東西**在守「①與②寫的是同一個格式」—— 那一格今天是空的,見 §2。
--
-- ══ 2. dedup_key 的形狀,以及它為什麼是兩份 ═════════════════════════════════
-- `email_outbox` 的唯一鍵是 `(event_type, dedup_key)`,**不含 order_id**
-- (`20260717020000:377`)⇒ `20260717020000:350` 明文要求 dedup_key 在同一 event_type 內
-- **全域唯一**,不可只在單筆訂單內唯一。
-- ⇒ 本片用 `shipment_id::text || ':' || order_id::text`。`shipment_id` 是 uuid ⇒ 全域唯一 ⇒ 過。
--
-- 🔴 **這個字串有兩份:這裡一份,TS 落表端一份**(`SupabaseEmailOutboxAdapter.enqueue`)。
--    兩份漂掉的症狀**不是報錯,是同一封信被重複排入、重複寄出** —— 而三綠不會紅。
-- ⇒ 所以它在這裡包成一支 IMMUTABLE 函式(下方 §4),TS 側有一格測試釘住同樣的形狀。
--    **改任何一邊之前,先看另一邊。**
--
-- ══ 3. 本片【不會】讓任何東西寄出去 ════════════════════════════════════════
-- 這支只建一個 view + 一支函式。排信的呼叫端在 TS,而**片1 不把它掛上 cron route**。
-- 真正的「上膛」是兩個獨立動作,兩個都還沒做:
--   ① 掛上 route(片3)  ② 設 `SHIPPED_EMAIL_CUTOFF` env(Sean 的事,片3 交付說明書)
-- ⚠️ 起始線為什麼非有不可:本 view 的語意是「已出貨而沒排過信」,
--    **在功能上線的第一秒,那個集合 = 歷史全部**(今天量到 2 筆,最舊 2026-08-12、最舊那筆
--    已經過了十天)⇒ 沒有 cutoff 就會寄出兩封「十天前出貨」的通知,而**信收不回來**。

-- ── 4. dedup_key 產生器(單一 SQL 側事實來源)────────────────────────────────
-- 🔴 **裸 `CREATE`,不是 `CREATE OR REPLACE`**(codex R1):正式庫若已存在同名物件,
--    `OR REPLACE` 會**安靜地改寫它**,而下面那些 ACL 斷言就會去驗一個不是本片建的東西
--    ⇒ 全綠,而綠的是別人的物件。裸 CREATE 撞名時直接 42723 ⇒ **人來看**。
-- ⚠️ **代價寫在這裡,免得下一個人以為是 bug**(codex 2026-08-22 R2 指出、主視窗裁定不改):
--    **本檔重跑會 42723「物件已存在」,那是刻意的,不是失敗。**
--    ⇒ 要重跑請先照 §7 的 down 註解逐支 DROP,再跑一次。
--    ⇒ 我們寧可「重試時停下來讓人看」,也不要「安靜地改寫一個可能不是本片建的物件」。
CREATE FUNCTION public.pcm_shipped_email_dedup_key(
  p_shipment_id uuid,
  p_order_id    uuid
) RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT p_shipment_id::text || ':' || p_order_id::text;
$$;

COMMENT ON FUNCTION public.pcm_shipped_email_dedup_key(uuid, uuid) IS
  '🔴 order_shipped 的 email_outbox.dedup_key。形狀 = "{shipment_id}:{order_id}"。'
  '唯一鍵是 (event_type, dedup_key) 不含 order_id(20260717020000:377)⇒ 同 event_type 內必須全域唯一;'
  'shipment_id 是 uuid ⇒ 滿足。⚠️ TS 落表端(SupabaseEmailOutboxAdapter 的 composeEvent)有第二份實作 —— '
  '兩份漂掉的症狀是【同一封信重複排入、重複寄出】,不是報錯,三綠不會紅。改一邊之前先看另一邊。'
  '本檔 §4b 有一道 apply 期的字面釘樁;TS 那半由 SupabaseEmailOutboxAdapter.test.ts 釘。';

-- 🔴 兩道 REVOKE,少一道都是開的(docs/patterns/revoking-function-execute-in-supabase.md §1/§2):
--    只 FROM PUBLIC ⇒ 收不到 Supabase ADP 給 anon/authenticated 的具名授權;
--    只 FROM anon,authenticated ⇒ 收不到 Postgres 給 PUBLIC 的那份。
REVOKE ALL ON FUNCTION public.pcm_shipped_email_dedup_key(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pcm_shipped_email_dedup_key(uuid, uuid) TO service_role;

-- ── 4b. dedup_key 的字面釘樁(codex R1:SQL 側改格式時,TS 測試【一格都不會紅】)──
-- 🔴 這一道釘的是**輸出的字面**,不是「函式存在」。
--    改成 `-` 分隔、改成 `order:shipment` 倒序、少了冒號 —— 三種都會在這裡當場紅,
--    而**在此之前它們的症狀是「anti-join 對不上 ⇒ 同一封信每輪重排、重複寄出」**。
DO $$
DECLARE
  v_key text;
BEGIN
  v_key := public.pcm_shipped_email_dedup_key(
    '00000000-0000-0000-0000-0000000000a1'::uuid,
    '00000000-0000-0000-0000-0000000000b2'::uuid
  );
  IF v_key <> '00000000-0000-0000-0000-0000000000a1:00000000-0000-0000-0000-0000000000b2' THEN
    RAISE EXCEPTION 'E4-a:dedup_key 格式漂了(拿到 %)⇒ anti-join 會對不上 ⇒ 信會重複寄', v_key;
  END IF;
END $$;

-- ── 5. 待排信的 (箱, 單) 配對 ────────────────────────────────────────────────
-- 🔴 `security_invoker = true`:讀它的只有 service_role,不需要 definer 提權。
--    設 true 的意義是**萬一哪天有別的角色拿到讀權,底表 RLS 仍然會套上去**。
--    ⚠️ **而它有一個代價,codex R1 指出的**:invoker 模式下,「有 view 的 SELECT」
--    **推不出**「讀得動底表」—— 缺任一張底表的 SELECT,查詢在 runtime 才 42501。
--    ⇒ 所以 §6 的正向驗證**不是問權限,是用那個角色真的查一次**。
--    (反例、什麼時候該用 false:`20260811020000_..._vehicle_taxonomy_effective_view.sql:19-28`。)
--
-- ⚠️ 作廢欄是 `deleted_at`,**不是 `voided_at`**。TS 側 `ShipmentRow.voidedAt` 是改過名的
--    (`apps/admin/src/lib/shipping/shipment-repository.ts:285` 逐字 `voidedAt: r.deleted_at`)
--    ⇒ 照 TS 的名字寫 SQL 會拿到 42703。這一句是 2026-08-22 真的踩過才寫的。
--
-- 🔴 **本 view 只回【有收件信箱可用的】** —— 兩個候選都空的配對走 §5b 那支。
--    ⚠️ **「有信箱」不等於「寄得出去」**(codex 2026-08-22 R2 nit):LINE 合成假信箱
--    (`@line.pcmmotorsports.local`)**非空** ⇒ 它會進本 view,再由 outbox adapter
--    落一列 `skipped_no_real_email`。**那是正確的位置** —— 若把它擋在 §5b,
--    那些單會**永遠沒有 outbox 痕跡**,日後查「這封信為什麼沒寄」會查不到任何東西。
--    理由不是嫌它們礙眼,是 codex R1 抓到的一個會咬人的形狀:
--    掃描固定取**最舊的 limit 筆**,而「沒有信箱」是**永遠不會消失**的狀態
--    ⇒ 累積到 limit 筆之後,**它們會永久擋住後面每一封有效的信**,
--      而症狀是「有些信永遠沒寄出,系統一切正常」。
--    ⚠️ 排除 ≠ 消失:它們在 §5b 那支 view 裡**逐列看得到**,不是被靜默吞掉。
CREATE VIEW public.pcm_shipped_email_pending
  WITH (security_invoker = true) AS
SELECT DISTINCT
  s.id                 AS shipment_id,
  s.shipment_reference AS shipment_reference,
  s.shipped_at         AS shipped_at,
  o.id                 AS order_id,
  o.display_id         AS display_id,
  o.notification_email AS notification_email,
  c.email              AS customer_email
FROM public.shipments s
JOIN public.shipment_items si ON si.shipment_id = s.id
JOIN public.order_items   oi ON oi.id = si.order_item_id
JOIN public.orders         o ON o.id = oi.order_id
-- 🔴 LEFT JOIN 不是 JOIN:客人列查不到時**不可以讓整個配對消失** ——
--    那會讓「這張單沒有備援信箱」與「這張單不需要寄信」在掃描結果上長得一樣。
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
WHERE s.shipped_at IS NOT NULL
  AND s.deleted_at IS NULL
  AND (
        nullif(pg_catalog.btrim(o.notification_email), '') IS NOT NULL
     OR nullif(pg_catalog.btrim(c.email), '') IS NOT NULL
      )
  AND NOT EXISTS (
        SELECT 1
          FROM public.email_outbox e
         WHERE e.event_type = 'order_shipped'
           AND e.dedup_key  = public.pcm_shipped_email_dedup_key(s.id, o.id)
      );

COMMENT ON VIEW public.pcm_shipped_email_pending IS
  '「已出貨、未作廢、有收件信箱、而且還沒排過 order_shipped 通知信」的 (箱, 單) 配對。一列 = 一封要寄的信。'
  '🔴 一箱可含多張訂單(shipments 刻意沒有 order_id,20260805170000:169)⇒ 一箱兩單會出兩列 = 兩封信,'
  '這是 Sean 2026-08-17 拍板(一箱兩單就兩封、一封講一張訂單);它收窄了更早的 S2=B「每出一批寄一封」。'
  '⚠️ 本 view 【不】自帶起始線 —— 它回的是【歷史上全部】還沒排過信的配對。'
  'cutoff 由呼叫端以 shipped_at 條件加上(env SHIPPED_EMAIL_CUTOFF,鏡像 order_created 那條的 B4_DEPLOY_CUTOFF)。'
  '🔴 拿掉那個條件的症狀 = 客人收到一封講十天前那批貨的通知,而信收不回來(鐵則 12⑤)。'
  '🔴 兩個信箱候選都空的配對【不在本 view】,在 pcm_shipped_email_unsendable —— 分開的理由是'
  '它們永遠不會消失,留在這裡會由最舊那端永久擋住後面的有效信(codex 2026-08-22 R1)。'
  '⚠️ 本 view 含 PII(兩個 email 欄)⇒ 僅 service_role 可讀。'
  '⚠️ 它不含追蹤碼與品項 —— 那些是【寄送當下】才查主表的(可後台改的欄存了會過期,'
  'packages/ports/src/IShippedEmailContext.ts 檔頭)。';

REVOKE ALL ON public.pcm_shipped_email_pending FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pcm_shipped_email_pending TO service_role;

-- ── 5b. 寄不出去的那些(**排除不等於消失**)──────────────────────────────────
-- 🔴 這支 view 存在的唯一理由是:讓 §5 的排除**看得見**。
--    沒有它,「這張單沒有任何信箱」與「這張單不需要寄信」在系統上是同一件事(都是「不在待排清單裡」)。
--    ⚠️ 而它**不會自己叫** —— 要有人去查它。查法寫在下面的 COMMENT 裡。
CREATE VIEW public.pcm_shipped_email_unsendable
  WITH (security_invoker = true) AS
SELECT DISTINCT
  s.id                 AS shipment_id,
  s.shipment_reference AS shipment_reference,
  s.shipped_at         AS shipped_at,
  o.id                 AS order_id,
  o.display_id         AS display_id
FROM public.shipments s
JOIN public.shipment_items si ON si.shipment_id = s.id
JOIN public.order_items   oi ON oi.id = si.order_item_id
JOIN public.orders         o ON o.id = oi.order_id
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
WHERE s.shipped_at IS NOT NULL
  AND s.deleted_at IS NULL
  AND nullif(pg_catalog.btrim(o.notification_email), '') IS NULL
  AND nullif(pg_catalog.btrim(c.email), '') IS NULL
  AND NOT EXISTS (
        SELECT 1
          FROM public.email_outbox e
         WHERE e.event_type = 'order_shipped'
           AND e.dedup_key  = public.pcm_shipped_email_dedup_key(s.id, o.id)
      );

COMMENT ON VIEW public.pcm_shipped_email_unsendable IS
  '已出貨、未作廢、還沒排過信,而**兩個信箱候選都是空的**的 (箱, 單) 配對 = 這幾位客人收不到出貨通知。'
  '🔴 它是 pcm_shipped_email_pending 的補集,兩支的其餘條件逐字相同 —— 改一支必須改另一支。'
  '⚠️ **本 view 不含 email 欄**(它們本來就是空的),所以不含 PII;仍然只授權 service_role,'
  '因為它會洩漏「哪些單出貨了」。'
  '查法(唯讀):select count(*), min(shipped_at) from public.pcm_shipped_email_unsendable;'
  '⚠️ **它不會自己叫。** 2026-08-22 量測時這個集合 = 0 列(舊單 13 張裡「完全沒收件人」= 0),'
  '⇒ 目前沒有受害者,而**沒有受害者不等於裝好了告警**。';

REVOKE ALL ON public.pcm_shipped_email_unsendable FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pcm_shipped_email_unsendable TO service_role;

-- ── 6. apply 當下的驗證 —— 🔴 **正向【真的查一次】,負向逐個角色逐欄** ────────
--
-- 為什麼把它寫在 migration 裡,而不是寫成一格測試:
-- 🔴 **這一片的失敗模式是「安靜地什麼都不寄」。** view 建好了、adapter 寫好了、測試綠了,
--    而 `service_role` 讀不到 ⇒ 掃描器撈到 0 列 ⇒ 一封信都不排
--    ⇒ **而那與「今天本來就沒有單要寄」在回應上是【同一句話】**(counts 全 0、200)。
-- ⇒ 權限只有在 **apply 當下**才驗得到真的東西。測試裡的 mock client 天生有權限,
--   它兩個世界印一樣的答案 ⇒ **那格恆綠、零判別力**。
--
-- 🔴 **正向那半:2026-08-22 codex R1 推翻了我的第一版。**
--    ~~原本用 `has_table_privilege('service_role', view, 'SELECT')`~~ —— 那**不夠**:
--    view 是 `security_invoker`,缺任一張**底表**的 SELECT 時那道斷言**仍然過**,
--    而 runtime 查詢才 42501 ⇒ 兩個世界印同一句話。
--    ⇒ 改成 **`SET ROLE service_role` 之後真的 `SELECT` 一次**(六張底表全部經過)。
--
-- ⚠️ **`SET ROLE` 這個手法自己的限定,照實寫**:
--    ① 它換的是 `current_user`,而 **`session_user` 不變** ⇒ 用它**量不出「該角色能不能升權」**
--      (memory `reference_set-role-cannot-measure-target-role-escalation`)。本段不宣稱那件事。
--    ② `service_role` 有 BYPASSRLS ⇒ 本段驗的是 **GRANT**,**不是 RLS**。
--    ③ 下面那道 `current_user` 自檢是為了讓「SET ROLE 沒生效」自己現形 ——
--      少了它,若 SET ROLE 因任何原因是 no-op,整段就會用 postgres 的權限查出一個假綠。
--      (`SET LOCAL` 在沒自包 BEGIN 的 migration 裡就是 no-op,memory
--       `reference_supabase-migration-set-local-is-noop` ⇒ 本檔刻意用 `SET ROLE` 不用 `SET LOCAL`。)
DO $$
DECLARE
  v_user text;
  v_n    bigint;
BEGIN
  SET ROLE service_role;

  v_user := current_user;  -- 🔴 current_user 是 SQL 關鍵字,不是 pg_catalog 的函式(2026-08-22 本機實跑撞到)
  IF v_user <> 'service_role' THEN
    RESET ROLE;
    RAISE EXCEPTION 'E4-a:SET ROLE 沒生效(current_user=%)⇒ 下面的查詢會用錯的角色跑出假綠', v_user;
  END IF;

  -- 🔴 真的查。查得動 = view 與**六張底表**的 SELECT 都在。
  SELECT count(*) INTO v_n FROM public.pcm_shipped_email_pending;
  SELECT count(*) INTO v_n FROM public.pcm_shipped_email_unsendable;
  -- 也真的呼叫一次那支函式(EXECUTE 授權同理:問權限 ≠ 叫得動)。
  PERFORM public.pcm_shipped_email_dedup_key(
    '00000000-0000-0000-0000-0000000000a1'::uuid,
    '00000000-0000-0000-0000-0000000000b2'::uuid
  );

  RESET ROLE;
EXCEPTION
  WHEN insufficient_privilege THEN
    RESET ROLE;
    RAISE EXCEPTION 'E4-a:service_role 查不動(42501)⇒ 掃描器會安靜地撈到 0 列。缺的是 view 或某張底表的 SELECT';
END $$;

-- 負向:**兩個角色 × 兩支 view × 表級與欄級 + 函式 EXECUTE**。
-- 🔴 少了任何一格,對應的那個漏法都不會有東西紅:
--    · 只檢查 anon ⇒ 「漏撤 authenticated」全綠,而登入者讀得到(codex R1)
--    · 只用 has_table_privilege ⇒ 「單獨把 email 欄授權出去」全綠,而 PII 已可讀(codex R1)
DO $$
DECLARE
  v_role text;
  v_view text;
  v_col  text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH v_view IN ARRAY ARRAY['public.pcm_shipped_email_pending', 'public.pcm_shipped_email_unsendable'] LOOP
      IF pg_catalog.has_table_privilege(v_role, v_view, 'SELECT') THEN
        RAISE EXCEPTION 'E4-a:% 讀得到 %(表級)', v_role, v_view;
      END IF;
    END LOOP;

    -- 欄級:表級 REVOKE 之後仍可能有人單獨授權某一欄,而其中兩欄正是 PII。
    -- 🔴 **分母從 `pg_catalog` 當場列舉,不寫死欄名清單**(codex 2026-08-22 R2:硬編清單
    --    **view 加欄時不會自己長**,而漏掉的那一欄不會有任何東西紅)。
    -- ⚠️ 走 `pg_catalog` 不走 `information_schema` —— 後者對零權限帳號會系統性回 0 列
    --    ⇒ 分母變成空的,而空迴圈**全綠**(memory `feedback_absence-read-as-verified` 同族)。
    -- 🔴 自檢:分母是 0 就是量具沒接上,當場紅 —— 否則「一欄都沒檢查」與「每一欄都乾淨」同一個畫面。
    FOR v_view IN SELECT unnest(ARRAY['pcm_shipped_email_pending', 'pcm_shipped_email_unsendable']) LOOP
      IF (SELECT count(*) FROM pg_catalog.pg_attribute a
            JOIN pg_catalog.pg_class     c ON c.oid = a.attrelid
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relname = v_view
             AND a.attnum > 0 AND NOT a.attisdropped) = 0 THEN
        RAISE EXCEPTION 'E4-a:列舉 % 的欄位拿到 0 個 ⇒ 量具沒接上,本輪斷言作廢', v_view;
      END IF;
      FOR v_col IN
        SELECT a.attname FROM pg_catalog.pg_attribute a
          JOIN pg_catalog.pg_class     c ON c.oid = a.attrelid
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname = v_view
           AND a.attnum > 0 AND NOT a.attisdropped
      LOOP
        IF pg_catalog.has_column_privilege(v_role, 'public.' || v_view, v_col, 'SELECT') THEN
          RAISE EXCEPTION 'E4-a:% 讀得到 %.%(欄級)', v_role, v_view, v_col;
        END IF;
      END LOOP;
    END LOOP;

    IF pg_catalog.has_function_privilege(
         v_role, 'public.pcm_shipped_email_dedup_key(uuid, uuid)', 'EXECUTE') THEN
      RAISE EXCEPTION 'E4-a:% 執行得到 pcm_shipped_email_dedup_key(兩道 REVOKE 少了一道)', v_role;
    END IF;
  END LOOP;
END $$;

-- 🔴 **上面這些斷言的效力有上限,照實寫**(不要因為它們全綠就讀成「這兩支 view 是關好的」):
--    ① 正向那道證明的是「**apply 當下、以 service_role 的身分**查得動」。
--       它**不保證** PostgREST 那條路查得動(那裡多一層 schema 曝光與 API 設定)。
--    ② 負向那些用 `has_*_privilege`,而 **owner 與 `SET ROLE` 兩條繞路它一概看不到**
--       (`docs/patterns/revoking-function-execute-in-supabase.md` §3.5 有實測反例)。
--    ③ ~~欄級那圈只列了四個欄名,view 加欄時不會自己長~~ **已解**(R2):分母改成從
--       `pg_catalog.pg_attribute` 當場列舉,並在分母為 0 時當場紅。
--       ⚠️ 仍然只涵蓋**這兩支 view 自己的欄** —— 底表的欄級授權不在本段的分母裡。
--    ⇒ 它們證明的是「基線那幾道有生效」,**不是「沒有任何路徑讀得到」**。

-- ── 7. down(**未跑過,照本 repo 慣例只留註解,不自動執行**)────────────────
--   DROP VIEW IF EXISTS public.pcm_shipped_email_unsendable;
--   DROP VIEW IF EXISTS public.pcm_shipped_email_pending;
--   DROP FUNCTION IF EXISTS public.pcm_shipped_email_dedup_key(uuid, uuid);
