-- M-4b · 匯款通知信的金額要扣掉「已取消的品項」
-- 板列 ⟦auth-PAIDAMOUNTNOTFROZEN⟧(族 B `bank_order_created`)· Sean `Q80 = 改` · 主視窗 A 拍【乙】
--
-- ══ 🔴 這支 view 存在的理由(不是效能,是一個【客人多匯錢】的缺陷)═══════════
-- 匯款通知信上的「訂單金額 / 應付餘額」讀的是 `orders.total`,
-- 而**部分取消依契約【不動 orders 那一列】**(`20260804120000:89` 等三處逐字)
-- ⇒ 兩個數都沒扣掉被取消的品項 ⇒ **信叫客人匯【原本那個數】。**
--
-- 🛑 **為什麼不是「作廢重排」**(這一段留著,它擋掉過一整片白工):
--    重排時 payload 仍然讀同一個沒動過的 `orders.total`
--    ⇒ 📌 **新信的金額一模一樣錯。作廢重排不是修法,是把同一封錯的信再寄一次。**
--
-- 🟢 **射程只在「部分」——「全部取消」今天已經是對的**:
--    `20260805100000:454-459` 算 `v_closed`(每個品項都取消完)⇒ `:462-466` 設 `orders.cancelled_at`
--    ⇒ 匯款兩支 view 的 `cancelled_at IS NULL` 直接擋掉 ⇒ 不寄。
--    ⇒ 🔴 **下一個人不要以為整條路都壞。**
--
-- ══ 算式的每一行都對應一個【拍板】,不是我算出來的 ══════════════════════
--  effective_subtotal     = Σ(未取消數量 × unit_price)
--  effective_shipping_fee = CASE WHEN effective_subtotal >= 5000 THEN 0 ELSE 100 END
--                           ← Sean 拍【乙 照規則補收】(佇列 `端Sean-0905早上佇列.md:416` 原題、
--                             `:621` 逐字「2 他選【乙】(補收運費退 200), 推翻推薦」)
--                           🔴 門檻與金額**逐字沿用** `create_order`(`20260604130000:226`),
--                             **不另立一份字面** —— 兩份會分岔而分岔沒有人會發現。
--  effective_discount     = 0
--                           ← Sean 拍 **Q39**:「那優惠卷就不能使用, 這樣最簡單, **算回原價**」
--                             (`memory/project_0907-sean-rulings-q39-q37-q43-paste-three.md:11` 逐字)
--                           🛑 **這一行的理由是【券整張作廢】, 不是「系統目前沒有折扣」** ——
--                             後者今天為真(`create_order` 硬編 0)而**它會過期**;
--                             寫成後者的話, 折扣上線那天這一行會**安靜地變錯**。
--  effective_total        = effective_subtotal + effective_shipping_fee
--
-- ⚠️ **射程延伸(明寫,不藏)**:運費那個拍板的情境是**已付款後退錢**,
--    而這裡用在**未付款的匯款單**。兩個拍板都指同一個方向(照現行規則重算),
--    而**「未付款也照同一條嗎」沒有被單獨問過** ⇒ 主視窗 B 2026-09-07 判:照做並標明。
--
-- 🔴 **一個已知的邊界,已進佇列等 Sean(而它【不改本算式】,只改「那封信要不要寄」)**:
--    原單 subtotal 5,000(免運)⇒ 取消一件 50 ⇒ subtotal 4,950 跌破門檻 ⇒ 運費 +100
--    ⇒ **total 5,050,比取消前【多 50】** ⇒ 📌 **客人取消了東西,卻被叫去匯更多錢。**
--
-- ⚠️ **為什麼不改 `order_balance_base_v`**:那支有 4 支 migration + 8 支 `.ts` 在用
--    (含 `20260906160000_m4b_member_balance_from_base`)⇒ **改它會動到會員餘額的語意**。
--    ⇒ 新增一層、只有兩個匯款 view 接 ⇒ 📌 **爆炸半徑比優雅重要。**

-- 🔴 **裸 `CREATE`, 不用 `OR REPLACE`** —— 它是新物件, **撞名要當場紅**;
--    `OR REPLACE` 會把撞名靜靜蓋掉(`migration-static-checks.sh` 那道閘 2026-09-07 當場抓到我)。
-- 🔴 **整支包在一個交易裡** —— 跑到一半失敗時,前面那幾句會【留在庫裡】。
--    2026-09-04 一晚兩次(`190000` DROP 後失敗留下無 CHECK 空窗 · `230000` 斷言紅了而壞版本已寫進去)
--    📌 **一道會叫的斷言, 在沒有交易包著時, 擋不住它自己前面那幾句。**
BEGIN;

CREATE VIEW public.pcm_order_effective_amounts_v AS
SELECT
  o.id AS order_id,
  eff.effective_subtotal,
  -- 🔴 門檻 5000 / 運費 100:逐字沿用 create_order(`20260604130000:226`)
  -- 🔴🔴 **自取(`store`)免運那一支【我第一版漏了】** —— codex `gpt-6-astra` 2026-09-07 抓到:
  --    `create_order:222-226` 逐字「store→0 自取免運;home→subtotal>=5000?0:100」。
  --    ⇒ 漏掉它的話, 一張小計 1,000 的**自取**單會被加 100 ⇒ 📌 **不必發生任何取消, 就已經多叫 100。**
  --    🛑 那正是「逐字沿用」沒做到底的代價:我抄了門檻那一半, 沒抄前面那個 `IF`。
  (CASE WHEN o.shipping_method = 'store' THEN 0
        WHEN eff.effective_subtotal >= 5000 THEN 0
        ELSE 100 END)::integer AS effective_shipping_fee,
  (eff.effective_subtotal
     + CASE WHEN o.shipping_method = 'store' THEN 0
            WHEN eff.effective_subtotal >= 5000 THEN 0
            ELSE 100 END)::integer AS effective_total,
  -- 🔴 `effective_balance_due` = 有效總額 − 已付
  --    已付 = `o.total - bal.balance_due`(base view 只吐 order_id/balance_due,不吐 paid_total)
  --    🛑 `bal.balance_due` 為 NULL(已退款那一族)⇒ 整條算式為 NULL ⇒ 消費端的
  --      `balance_due IS NOT NULL` 照舊擋掉 ⇒ **退完款的客人不會收到叫他再匯一次的信。**
  -- 🔴🔴 **型別必須是 `bigint`, 不能 `::integer`** —— codex 2026-09-07 抓到, 而它會【擋上線】:
  --    `bal.balance_due` 來自 `o.total - COALESCE(p.paid_total, 0)`(`20260906150000:110`),
  --    而 `p.paid_total = COALESCE(SUM(p.amount), 0)`(`20260823030000:188`)⇒ **SUM(integer) 回 bigint**
  --    ⇒ 下游那支 `pcm_bank_order_still_mailable` 的 `balance_due` 今天是 **bigint**。
  --    ⇒ 🛑 我若在這裡截成 `integer`, 那支 view 的 `CREATE OR REPLACE` 會**改到欄位型別 ⇒ 42P16 直接失敗**。
  --    📌 **「欄名一樣」不等於「換得掉」** —— 型別也算在裡面。
  (eff.effective_subtotal
     + CASE WHEN o.shipping_method = 'store' THEN 0
            WHEN eff.effective_subtotal >= 5000 THEN 0
            ELSE 100 END
     - (o.total - bal.balance_due)) AS effective_balance_due
FROM public.orders o
JOIN public.order_balance_base_v bal ON bal.order_id = o.id
CROSS JOIN LATERAL (
  SELECT COALESCE(SUM(
           (oi.quantity - COALESCE((
              SELECT SUM(ci.cancelled_quantity)
                FROM public.order_cancellation_items ci
               WHERE ci.order_item_id = oi.id), 0)) * oi.unit_price
         ), 0)::bigint AS effective_subtotal
    FROM public.order_items oi
   WHERE oi.order_id = o.id
) eff;

COMMENT ON VIEW public.pcm_order_effective_amounts_v IS
  '⟦auth-PAIDAMOUNTNOTFROZEN⟧ 族 B:扣掉已取消品項之後的訂單金額。'
  '🔴 只有匯款通知信那兩支 view 接它(pcm_bank_order_created_email_pending / pcm_bank_order_still_mailable)'
  '—— 單一來源、兩層共用,兩邊不可能算出兩個數。'
  '🛑 它【不是】對帳用的權威金額:orders.total 仍然是那一列上的字面, 本 view 只答「若照 Q39(券作廢算原價)'
  '與運費規則重算, 客人現在該付多少」。要改算式先讀本檔檔頭那四行, 每一行都對應一個拍板。';

-- 🔴 新物件出生就自帶 anon 權限、repo 內零 GRANT 字面可掃、三綠不紅
--    ⇒ 兩道 REVOKE 照 `docs/patterns/revoking-function-execute-in-supabase.md`
-- 授權斷言清單(本檔可授權物件恰 1 個):
--   public.pcm_order_effective_amounts_v ⇒ service_role SELECT;anon/authenticated 零權限
REVOKE ALL ON public.pcm_order_effective_amounts_v FROM PUBLIC;
REVOKE ALL ON public.pcm_order_effective_amounts_v FROM anon, authenticated, service_role;
GRANT SELECT ON public.pcm_order_effective_amounts_v TO service_role;

DO $postcheck$
DECLARE
  -- 🔴 **收權斷言清單** —— `migration-static-checks.sh` 第③格用它比對「可授權物件數」。
  --    🛑 那道閘防的是「**忘記列**」,不是「忘記收權」⇒ 清單短了它就叫,而它 2026-09-07 當場叫了我。
  v_relations text[] := ARRAY[
    'public.pcm_order_effective_amounts_v'
  ]::text[];
  v_rel  text;
  v_cnt  integer;
  v_cols text;
BEGIN
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'pcm_order_effective_amounts_v' AND c.relkind = 'v';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '事後閘①:view 不存在(實得 %)', v_cnt;
  END IF;

  SELECT string_agg(a.attname, ',' ORDER BY a.attnum) INTO v_cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.pcm_order_effective_amounts_v'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cols <> 'order_id,effective_subtotal,effective_shipping_fee,effective_total,effective_balance_due' THEN
    RAISE EXCEPTION '事後閘②:欄位不合(實得 %)', v_cols;
  END IF;

  -- 🔴 **型別也要釘** —— codex 2026-09-07:`balance_due` 下游是 bigint,
  --    這裡截成 integer 會讓 `CREATE OR REPLACE` 報 42P16。**只釘欄名的話,那個世界會印同一個綠。**
  SELECT pg_catalog.format_type(a.atttypid, a.atttypmod) INTO v_cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.pcm_order_effective_amounts_v'::regclass AND a.attname = 'effective_balance_due';
  IF v_cols <> 'bigint' THEN
    RAISE EXCEPTION '事後閘②b:effective_balance_due 不是 bigint(實得 %)⇒ 下游 REPLACE 會 42P16', v_cols;
  END IF;

  -- 🔴 **權限那格要【兩個方向都驗】** —— 只驗「service_role 讀得到」的話,
  --    一個 anon 也讀得到的世界會**印同一個綠**。
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.pcm_order_effective_amounts_v', 'SELECT') THEN
    RAISE EXCEPTION '事後閘③:service_role 讀不到(接線斷了)';
  END IF;
  IF pg_catalog.has_table_privilege('anon', 'public.pcm_order_effective_amounts_v', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.pcm_order_effective_amounts_v', 'SELECT') THEN
    RAISE EXCEPTION '事後閘④:anon/authenticated 讀得到 ⇒ REVOKE 沒生效';
  END IF;

  -- 🔴 逐個跑一遍清單,**兩個方向都驗**(只驗 service_role 讀得到的話,
  --    一個 anon 也讀得到的世界會印同一個綠)。
  FOREACH v_rel IN ARRAY v_relations LOOP
    IF NOT pg_catalog.has_table_privilege('service_role', v_rel, 'SELECT') THEN
      RAISE EXCEPTION '事後閘⑤:% 的 service_role 讀不到', v_rel;
    END IF;
    IF pg_catalog.has_table_privilege('anon', v_rel, 'SELECT')
       OR pg_catalog.has_table_privilege('authenticated', v_rel, 'SELECT') THEN
      RAISE EXCEPTION '事後閘⑥:% 的 anon/authenticated 讀得到 ⇒ REVOKE 沒生效', v_rel;
    END IF;
  END LOOP;

  RAISE NOTICE '事後閘通過(六格:①存在 ②欄位 ③service_role 可讀 ④anon/authenticated 不可讀 ⑤⑥清單逐個複驗)';
END
$postcheck$;

COMMIT;
