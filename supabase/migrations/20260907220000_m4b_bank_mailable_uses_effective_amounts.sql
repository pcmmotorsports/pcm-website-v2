-- M-4b · 匯款通知信改用「扣掉已取消品項」的金額(接線那一顆)
-- 板列 ⟦auth-PAIDAMOUNTNOTFROZEN⟧ 族 B · Sean `Q80 = 改` · 主視窗 A 拍【乙】
-- 上游:`20260907210000_m4b_order_effective_amounts_v.sql`(算式與每一行的拍板出處都在那支檔頭)
--
-- ══ 🟢 只改【一支】view, 而那不是我省事 ═══════════════════════════════
-- `pcm_bank_order_created_email_pending`(排信面)**本來就是從**
-- `pcm_bank_order_still_mailable`(送信前面)衍生的 —— 它 select 的是 `m.total` / `m.balance_due`
-- (`20260906180000:123-128`), 而那支檔自己逐字寫著:
--   「🛑 **要改「誰該收到這封信」, 改那一支, 不要在這裡再寫一份。**」
-- ⇒ 📌 **改上游一支, 兩層自動一致** —— 這正是「單一來源、兩層共用」的既有形狀,
--   我沿用它, **不新造一份**。
--
-- ══ 🔴 這一顆真正的修法是【讓既有那道守門終於有東西可比】═══════════════
-- `packages/use-cases/src/sweep-email-outbox.ts:1697-1703` 那道閘比三個數
-- (`snap.total` / `snap.balanceDue` / `recipientEmail`), 而**部分取消依契約一個都不會動**
-- ⇒ 它對這個情境**零判別力**。
-- 🛑 **那道閘不是壞的** —— 它正確實作、正確執行、也真的會紅, 而它**看著另一個方向**。
-- ⇒ ✅ **本顆一行都不動它**;改的是**它比的來源** ⇒ 排信後才部分取消時, 兩邊的數**可能**不再相等
--   ⇒ 它會**標 stale 不寄**。📌 **我們不是加一道新守門, 是讓舊的那道終於有東西可比。**
-- 🔴 **而「取消後必不相等」是【錯的】—— 我第一版這樣宣稱, codex 2026-09-07 給了反例**:
--    原單 5,000(免運)⇒ 取消 100 ⇒ 小計 4,900 跌破門檻 ⇒ 運費 +100 ⇒ **總額又回到 5,000**
--    ⇒ 三個數全相等 ⇒ **照寄**。🔵 而那一封的金額**是對的**(4,900 + 100 = 5,000),
--    所以它不是缺陷 —— 📌 **但它證明那道閘偵測的是「金額變了」, 不是「有沒有取消過」。**
--    ⇒ 🛑 **不得拿它當「每一次取消都會被攔下」的證據。**
--
-- ⚠️ **`<= o.total` 那條要跟著換成 `<= effective_total`** —— 它是「可信的正數」的上界,
--    留著舊上界的話, 一個**跌破免運門檻而總額變大**的單會被它擋掉而**沒有人知道為什麼**。

BEGIN;

CREATE OR REPLACE VIEW public.pcm_bank_order_still_mailable
  WITH (security_invoker = false, security_barrier = true) AS
SELECT
  o.id                     AS order_id,
  o.display_id             AS display_id,
  o.created_at             AS created_at,
  -- 🔴 ⛔ ~~o.total~~ / ~~bal.balance_due~~ ⇒ 改讀 effective(扣掉已取消品項)
  --    欄名與型別**刻意不變** —— 呼叫端(`SupabaseBankOrderCreatedScannerAdapter` /
  --    `readBankSnapshot`)一個字都不用改, 而**那也表示 typecheck 不會替這一顆把關** ⇒ 見事後閘。
  eff.effective_total      AS total,
  eff.effective_balance_due AS balance_due,
  o.notification_email     AS notification_email,
  c.email                  AS customer_email,
  o.order_source           AS order_source
FROM public.orders o
JOIN public.order_balance_base_v bal ON bal.order_id = o.id
JOIN public.pcm_order_effective_amounts_v eff ON eff.order_id = o.id
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
WHERE o.payment_channel = 'bank_transfer'
  AND o.payment_status  = 'unpaid'
  AND o.cancelled_at IS NULL
  AND o.order_source = 'web'
  AND o.manual_request_id IS NULL
  -- 🔴 三條「可信的正數」照舊, 而**主詞換成 effective** ——
  --    `bal.balance_due` 為 NULL(已退款那族)會讓 `effective_balance_due` 也是 NULL
  --    ⇒ 第一條照樣擋掉 ⇒ **退完款的客人仍然不會收到叫他再匯一次的信。**
  AND eff.effective_balance_due IS NOT NULL
  AND eff.effective_balance_due > 0
  AND eff.effective_balance_due <= eff.effective_total
  AND (
        nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
     OR nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      );

COMMENT ON VIEW public.pcm_bank_order_still_mailable IS
  '⟦b4-BANKNOEMAIL⟧ 送信前的合格性面。2026-09-07 起 total / balance_due 改讀 '
  'pcm_order_effective_amounts_v(扣掉已取消品項)⇒ ⟦auth-PAIDAMOUNTNOTFROZEN⟧ 族 B。'
  '🔴 部分取消依契約不動 orders 那一列 ⇒ 舊版兩個數都沒扣, 信會叫客人匯原本那個數。'
  '🛑 欄名刻意不變(呼叫端零改動)⇒ **typecheck 不會替這個改動把關**, 只有本檔事後閘與行為測試會。';

DO $postcheck$
DECLARE
  v_relations text[] := ARRAY[
    'public.pcm_bank_order_still_mailable',
    'public.pcm_bank_order_created_email_pending'
  ]::text[];
  v_rel  text;
  v_cols text;
  v_def  text;
BEGIN
  -- ① 欄位形狀沒變(呼叫端靠它, 換了就是靜默破壞)
  SELECT string_agg(a.attname, ',' ORDER BY a.attnum) INTO v_cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.pcm_bank_order_still_mailable'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cols <> 'order_id,display_id,created_at,total,balance_due,notification_email,customer_email,order_source' THEN
    RAISE EXCEPTION '事後閘①:欄位變了(實得 %)', v_cols;
  END IF;

  -- ② 🔴 **真的接上了嗎** —— 這一格是本檔唯一能證明改動生效的東西。
  --    🛑 只驗「view 還在」的話, **一個沒改到的世界會印同一個綠。**
  SELECT pg_catalog.pg_get_viewdef('public.pcm_bank_order_still_mailable'::regclass, true) INTO v_def;
  IF pg_catalog.strpos(v_def, 'pcm_order_effective_amounts_v') = 0 THEN
    RAISE EXCEPTION '事後閘②:still_mailable 沒有引用 pcm_order_effective_amounts_v ⇒ 接線斷了';
  END IF;
  -- 🔴🔴 **③ 要釘的是【輸出欄的來源】, 不是「整份定義裡有沒有那個字」** ——
  --    codex `gpt-6-astra` 2026-09-07 擊破了我第一版:**保留 JOIN 與 WHERE、只把輸出偷偷改回
  --    `o.total` / `bal.balance_due`, 六格照樣全綠而信照樣寄錯金額。**
  --    📌 **一個字面出現在定義裡, 不代表它出現在【被選出來的那一欄】上。**
  --    ⇒ 改成比 `AS total` / `AS balance_due` 前面那個運算式。
  IF pg_catalog.strpos(v_def, 'eff.effective_total AS total') = 0 THEN
    RAISE EXCEPTION '事後閘③a:total 那一欄不是取自 effective_total ⇒ 輸出被換回去了';
  END IF;
  IF pg_catalog.strpos(v_def, 'eff.effective_balance_due AS balance_due') = 0 THEN
    RAISE EXCEPTION '事後閘③b:balance_due 那一欄不是取自 effective_balance_due';
  END IF;
  -- 🔵 負對照:舊來源不得再出現在輸出位置上(兩個方向都釘, 否則「加了新的而舊的還在」會過)
  IF pg_catalog.strpos(v_def, 'o.total AS total') <> 0
     OR pg_catalog.strpos(v_def, 'bal.balance_due AS balance_due') <> 0 THEN
    RAISE EXCEPTION '事後閘③c:輸出仍有舊來源 ⇒ 只加了新的而沒換掉舊的';
  END IF;

  -- ④ 衍生那支跟著變(它 select m.total / m.balance_due ⇒ 應自動吃到新值)
  SELECT pg_catalog.pg_get_viewdef('public.pcm_bank_order_created_email_pending'::regclass, true) INTO v_def;
  IF pg_catalog.strpos(v_def, 'pcm_bank_order_still_mailable') = 0 THEN
    RAISE EXCEPTION '事後閘④:pending 不再從 still_mailable 衍生 ⇒ 兩層可能算出兩個數';
  END IF;

  -- ⑤⑥ 權限兩個方向都驗(只驗一邊的話, 一個 anon 也讀得到的世界會印同一個綠)
  FOREACH v_rel IN ARRAY v_relations LOOP
    IF NOT pg_catalog.has_table_privilege('service_role', v_rel, 'SELECT') THEN
      RAISE EXCEPTION '事後閘⑤:% 的 service_role 讀不到', v_rel;
    END IF;
    IF pg_catalog.has_table_privilege('anon', v_rel, 'SELECT')
       OR pg_catalog.has_table_privilege('authenticated', v_rel, 'SELECT') THEN
      RAISE EXCEPTION '事後閘⑥:% 的 anon/authenticated 讀得到', v_rel;
    END IF;
  END LOOP;

  RAISE NOTICE '事後閘通過(六格:①欄位不變 ②接上新 view ③輸出用 effective ④衍生鏈完整 ⑤⑥權限兩向)';
END
$postcheck$;

COMMIT;
