-- 出貨清單那一頁的種子(⟦出貨清單⟧ 2026-09-10)。
--
-- 🔴 **為什麼要有它**:`admin-probe/up.sh` 起站時自己印著
--    「這台機器有 45 / 61 張表是空的」,而 `shipments` 與 `shipment_items` **都在那串裡**
--    ⇒ 不種資料就開那一頁 ⇒ 畫面印「沒有建立任何箱子」
--    ⇒ 📌 **那與「這一頁壞了」長得一模一樣** ⇒ 那一發是零判別力,不是通過。
--
-- 🔴🔴 **四箱的值【逐欄抄自 2026-09-10 唯讀正式庫】,不是我編的** ——
--    因為那四箱剛好把這一頁所有的邊界都踩到了:
-- ```
-- 箱號    carrier  hct_status  tracking_number  hct_request_id  shipped_at  deleted_at
-- XS6XVY  hct      draft       123123           (空)            有          有  ← 作廢
-- ZN2HDP  hct      draft       31223            (空)            有          有  ← 作廢
-- ZNDXJP  other    draft       123              (空)            有          有  ← 作廢
-- S9FC6P  hct      submitted   (空)             8947081964      (空)        (空) ← 真的那一箱
-- ```
-- 🎯 照字面接 DB 的話,**Sean 最想看的那一箱日期與貨號兩欄都空白**,而作廢的箱反而滿的。
--    這支種子就是為了讓那件事在畫面上看得見。
--
-- 🛑 **不要改 `seed.sql`** —— 它全窗共用,多幾筆可能動到別片的期望值(up.sh 檔頭逐字)。

BEGIN;

-- 🔴 **順序是承重的**(實撞):有一條 trigger 擋「包裹已寄出或已作廢,不可再加品項」
--    ⇒ 必須 **① 先建乾淨的箱 → ② 掛品項 → ③ 才翻成已出貨/已作廢**。
--    ⇒ 📌 一次寫完的 INSERT 會被那條 trigger 擋下, 而錯訊講的是「不可再加品項」
--      —— 讀起來像資料有問題, 其實是【順序】。

CREATE TEMP TABLE picked ON COMMIT DROP AS
  SELECT o.id AS order_id, o.customer_user_id, oi.id AS order_item_id,
         row_number() OVER (ORDER BY o.display_id) AS n
    FROM public.orders o
    JOIN public.order_items oi ON oi.order_id = o.id
   WHERE o.display_id IN ('PCM-2026-1001','PCM-2026-1002','PCM-2026-1003','PCM-2026-1004')
     -- 🔴 `min(uuid)` 在 Postgres 不存在(實撞)⇒ 用 ORDER BY + LIMIT 1 取一個穩定的品項。
     AND oi.id = (SELECT x.id FROM public.order_items x WHERE x.order_id = o.id
                   ORDER BY x.id::text LIMIT 1);

-- ① 建箱(乾淨的:還沒出貨、還沒作廢)
INSERT INTO public.shipments
  (id, shipment_reference, customer_user_id, recipient_snapshot, carrier_code, carrier_note,
   tracking_number, hct_request_id, hct_status, created_at)
SELECT
  ('aaaaaaaa-0000-4000-8000-00000000000' || p.n)::uuid,
  (ARRAY['XS6XVY','ZN2HDP','ZNDXJP','S9FC6P'])[p.n],
  p.customer_user_id,
  -- 🔴 `shipments_recipient_snapshot_shape` 要求【恰好三個鍵、而且值全部是字串】
  --    (`m3_jsonb_values_all_string`)⇒ `line` 給 `NULL` 會被 CHECK 擋下(實撞)。
  jsonb_build_object('name', (ARRAY['王小明','陳大文','李美華','張三'])[p.n],
                     'phone', '0912345678', 'line', ''),
  (ARRAY['hct','hct','other','hct'])[p.n],
  -- 🔴 `shipments_carrier_note_pair` 是一條【等價】約束(實撞):
  --    `carrier_code = 'other'` **恰好等於** `carrier_note` 非空
  --    ⇒ other 一定要填備註, 而非 other 一定不能填。兩邊都會被擋。
  (ARRAY[NULL,NULL,'自送',NULL]::text[])[p.n],
  (ARRAY['123123','31223','123',NULL]::text[])[p.n],
  (ARRAY[NULL,NULL,NULL,'8947081964']::text[])[p.n],
  (ARRAY['draft','draft','draft','submitted'])[p.n],
  (ARRAY['2026-09-10T03:02:50Z','2026-09-10T03:28:16Z','2026-09-10T09:37:16Z',
         '2026-09-10T02:59:51Z'])[p.n]::timestamptz
FROM picked p
ON CONFLICT (id) DO NOTHING;

-- ② 掛品項(此時箱還是乾淨的 ⇒ trigger 放行)
INSERT INTO public.shipment_items (shipment_id, order_item_id, shipped_quantity)
SELECT ('aaaaaaaa-0000-4000-8000-00000000000' || p.n)::uuid, p.order_item_id, 1
  FROM picked p
ON CONFLICT DO NOTHING;

-- ③ 前三箱翻成【已出貨 + 已作廢】
--    🔴 這兩個同時有值正是正式庫的真值, 而狀態欄的順序就是靠它驗的:
--       順序寫反 ⇒ 這三箱會被印成「已出貨」, 而它們其實已經作廢。
-- 🔴 一句 UPDATE 改多列 `shipments` 會被 B2 守門擋下(實撞), 而**它把逃生門寫在錯訊裡**:
--    「要批次修資料請用 break-glass, **必須與 UPDATE 在同一個顯式交易裡**」
--    ⇒ 少了 BEGIN/COMMIT 的話 `SET LOCAL` 是 no-op(只發 WARNING)、會再被擋一次。
-- 🎯 一個知道自己會擋住合法用途的守門, 而它把「怎麼合法地繞過我」印在拒絕訊息上。
SET LOCAL pcm_b2.batch_shipments = '1';

UPDATE public.shipments s
   SET shipped_at = v.shipped_at, deleted_at = v.deleted_at, void_reason = '測試作廢'
  FROM (VALUES
    ('aaaaaaaa-0000-4000-8000-000000000001'::uuid,
     '2026-09-10T03:02:50Z'::timestamptz, '2026-09-10T03:26:54Z'::timestamptz),
    ('aaaaaaaa-0000-4000-8000-000000000002'::uuid,
     '2026-09-10T03:28:16Z'::timestamptz, '2026-09-10T03:45:46Z'::timestamptz),
    ('aaaaaaaa-0000-4000-8000-000000000003'::uuid,
     '2026-09-10T09:37:16Z'::timestamptz, '2026-09-10T14:51:03Z'::timestamptz)
  ) AS v(id, shipped_at, deleted_at)
 WHERE s.id = v.id;

COMMIT;

-- 種完自己數一次(🟢 沒有這一發, 「種進去了」與「靜靜地 0 列」長一樣)。
SELECT count(*) AS shipments, (SELECT count(*) FROM public.shipment_items) AS shipment_items
  FROM public.shipments;
