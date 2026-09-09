-- ⟦b4-PARTCANCELTAX⟧ 回滾:把 `pcm_order_effective_amounts_v` 換回 `20260909100000` 之前那一版,
-- 並移除那支告警 view。
--
-- ⚠️ **回滾之後那個高估會回來** —— 一張剛好付完的未稅單又會被算成「多收了一個稅額」,
--    而匯款通知信會少講那個稅。📌 **那正是 `20260909100000` 在修的事,不是副作用。**
-- 🔵 零資料改動:兩支都是 view,沒有列。
-- 🛑 `effective_total` 在正向與反向都一字未動。

BEGIN;

DO $pre$
DECLARE v_md5 text;
BEGIN
  -- 🔴🔴 **比【完整指紋】不是比一個字樣**(codex R1 must-fix③)。
  --    ⛔ ~~我第一版只檢查定義裡有沒有 `price_tax_mode`~~
  --    🛑 **失敗情境**:之後有人改了運費或稅制那段而**保留那個字樣** ⇒ 這一閘照樣過
  --       ⇒ 下面那句 `CREATE OR REPLACE` 會把**他的修正整份蓋掉**。
  --       而末段那個「回到舊版 md5」的對帳**也會過** —— 因為它證的是【覆蓋之後】確實是舊版。
  --    ✅ 所以這裡釘的是 `20260909100000` **貼進去那一版的完整 md5**。
  --    🔬 那個值來自:在拋棄式 PG 上跑完正向之後 `md5(pg_get_viewdef(...))`。
  v_md5 := pg_catalog.md5(pg_catalog.pg_get_viewdef('public.pcm_order_effective_amounts_v'::regclass, true));
  IF v_md5 <> '89c088a1f021259dc62916c9ffbb3343' THEN
    RAISE EXCEPTION '回滾前置閘:現行 viewdef md5 = % ⇒ 不是 20260909100000 貼進去那一版(要 89c088a1f021259dc62916c9ffbb3343)⇒ 停, 不要蓋掉別人的東西', v_md5;
  END IF;

  -- 🔵 那支告警 view 也一樣 —— 它若被別人改過, 這裡 DROP 掉會弄丟他的東西。
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relname = 'pcm_bank_order_mail_blocked_by_tax')
     AND pg_catalog.md5(pg_catalog.pg_get_viewdef('public.pcm_bank_order_mail_blocked_by_tax'::regclass, true))
         <> 'c07a4a7a18682d97da901f0c7cdcfa70' THEN
    RAISE EXCEPTION '回滾前置閘:告警 view 不是 20260909100000 建的那一版 ⇒ 停';
  END IF;
END
$pre$;

DROP VIEW IF EXISTS public.pcm_bank_order_mail_blocked_by_tax;

-- 🔴 換回舊那一份(逐字取自 20260909100000 前置閘②比對的那個 md5:f112b526df7afca49ca22efe412567ea)
CREATE OR REPLACE VIEW public.pcm_order_effective_amounts_v AS
 SELECT o.id AS order_id,
    eff.effective_subtotal,
        CASE
            WHEN o.shipping_method = 'store'::text THEN 0
            WHEN eff.effective_subtotal >= 5000 THEN 0
            ELSE 100
        END AS effective_shipping_fee,
    (eff.effective_subtotal +
        CASE
            WHEN o.shipping_method = 'store'::text THEN 0
            WHEN eff.effective_subtotal >= 5000 THEN 0
            ELSE 100
        END)::integer AS effective_total,
    eff.effective_subtotal +
        CASE
            WHEN o.shipping_method = 'store'::text THEN 0
            WHEN eff.effective_subtotal >= 5000 THEN 0
            ELSE 100
        END - (o.total - bal.balance_due) AS effective_balance_due
   FROM orders o
     JOIN order_balance_base_v bal ON bal.order_id = o.id
     CROSS JOIN LATERAL ( SELECT COALESCE(sum((oi.quantity - COALESCE(( SELECT sum(ci.cancelled_quantity) AS sum
                   FROM order_cancellation_items ci
                  WHERE ci.order_item_id = oi.id), 0::bigint)) * oi.unit_price), 0::numeric)::bigint AS effective_subtotal
           FROM order_items oi
          WHERE oi.order_id = o.id) eff;

-- 🔴 **還原【原本那一段】註解, 不是設成 NULL**(codex R1 nit①)——
--    ⛔ ~~我第一版寫 `IS NULL`~~ ⇒ 正向再回滾之後那段說明就消失了,
--    而 `pg_get_viewdef` 的 md5 **不涵蓋 COMMENT** ⇒ 對帳照樣過 ⇒ **它會靜靜不見。**
--    🔬 下面這段逐字抄自建立它的那支 `20260907210000:104-109`。
COMMENT ON VIEW public.pcm_order_effective_amounts_v IS
  '⟦auth-PAIDAMOUNTNOTFROZEN⟧ 族 B:扣掉已取消品項之後的訂單金額。'
  '🔴 只有匯款通知信那兩支 view 接它(pcm_bank_order_created_email_pending / pcm_bank_order_still_mailable)'
  '—— 單一來源、兩層共用,兩邊不可能算出兩個數。'
  '🛑 它【不是】對帳用的權威金額:orders.total 仍然是那一列上的字面, 本 view 只答「若照 Q39(券作廢算原價)'
  '與運費規則重算, 客人現在該付多少」。要改算式先讀本檔檔頭那四行, 每一行都對應一個拍板。';

DO $post$
DECLARE v_md5 text;
BEGIN
  v_md5 := pg_catalog.md5(pg_catalog.pg_get_viewdef('public.pcm_order_effective_amounts_v'::regclass, true));
  IF v_md5 <> 'f112b526df7afca49ca22efe412567ea' THEN
    RAISE EXCEPTION '回滾對帳:回完的 viewdef md5 = % ⇒ 不是舊那一版(要 f112b526…)', v_md5;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
              WHERE n.nspname='public' AND c.relname='pcm_bank_order_mail_blocked_by_tax') THEN
    RAISE EXCEPTION '回滾對帳:告警 view 沒移除';
  END IF;
  PERFORM 1 FROM public.pcm_bank_order_still_mailable LIMIT 1;
  RAISE NOTICE '✅ 已回滾到 20260909100000 之前那一版(md5 %)', v_md5;
END
$post$;

COMMIT;
