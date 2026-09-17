-- supabase/rollbacks/20260917150000-rollback.sql
-- 還原 `20260917150000_m4b_refund_cap_uses_paid_not_total.sql`:
-- 把 `pcm_order_refundable_remaining` 的第一項退回「訂單原總額」。
--
-- 🛑🛑 **絕對不要對正式庫跑這支。** 演練只在拋棄式 PG
--     (`scripts/migrations-replay-from-zero.sh --keep-db`)。
--
-- 🔴 **本檔嵌的是【貼之前】從正式庫 `pg_get_functiondef` 撈下來的原文**
--    (撈取時間 2026-09-17, prosrc md5 = a7c426364358738f792625c14363fb69, functiondef 1,693 字元),
--    **不是從 repo 的 20260820100000 抄的**。
--    `scripts/latest-definition-of.sh` 自己的檔頭就警告過它看不到後來的 `ALTER FUNCTION`
--    —— 而這支正是 2026-09-05 M1a/M1b 被 ALTER 過 search_path 的那一族:
--    repo 裡寫 `SET search_path = public, pg_temp`, 而活的庫是 `SET search_path TO ''`
--    ⇒ **照 repo 抄就是把加固解開。**
--
-- 🔴🔴 **退這一支【要連碼一起退】** —— 2026-09-17 R2 抓到我這裡寫了一句假話:
--    ⛔ ~~「不用先退碼:呼叫端 6 支全部只讀回傳值, 沒有任何碼因為本片改過。」~~
--    三處都錯:① 本片**改了碼**(`apps/admin/src/lib/orders/payment-list-view.ts` 的
--    `refundedTotalFromUnregistered` + 四個呼叫端)② DB 端呼叫端是 **3 支**不是 6 支
--    (那個 6 是 `prosrc LIKE` 掃到註解與 RAISE 字串,R1 已更正,而**這一支檔漏改**)
--    ③ 因此「不用先退碼」的結論是**反的**。
-- 📌 **同一個更正沒有落到第三個落點** —— migration 檔頭與 plan 都改了, 只有這裡沒改。
--
-- ⇒ **正確順序:先把碼退掉(或同一發一起退), 再跑這一支。**
--    只退板而碼留著 ⇒ `已退 = 已收 − (原總額 − 已退)`:
--      · 未付款 / 訂金單 ⇒ 算出負數 ⇒ 印「已退 未知」(fail-closed, 但員工會以為系統壞了)
--      · **溢付單 ⇒ 印出一個憑空的「已退」**(付 8,000 的 500 元單 ⇒ 印「已退 7,500」),
--        而且 `refundedTotal !== 0` ⇒ 收款彈窗那顆「帶入尾款」鈕會消失。
-- ⚠️ **而退回去等於把那 21,360 元的空頭額度放回來** —— 退之前先想清楚是不是真的要。

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 1. 前置閘:確認現在真的是【貼過本片】的狀態 ──────────────────────────────
-- 🔴 釘 md5, 不用子字串 —— 舊算式被引在新版的註解裡, 子字串判不出來。
DO $pre$
DECLARE v_oid oid; v_md5 text;
BEGIN
  v_oid := to_regprocedure('public.pcm_order_refundable_remaining(uuid)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION '還原前置閘:函式不存在 ⇒ 停下, 不要亂動';
  END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_catalog.pg_proc WHERE oid=v_oid;
  IF v_md5 = 'a7c426364358738f792625c14363fb69' THEN
    RAISE EXCEPTION '還原前置閘:現在就是【貼之前】那一版 ⇒ 本片沒貼過, 或已經還原過 ⇒ 停下, 不要重複跑';
  END IF;
  IF v_md5 IS DISTINCT FROM 'a5a57c30196ca1c67215317667b47a36' THEN
    RAISE EXCEPTION '還原前置閘:現在的 body md5 是 %, 既不是本片寫上去的 a5a57c30196ca1c67215317667b47a36 也不是貼之前的 a7c426364358738f792625c14363fb69 ⇒ 中間有人改過 ⇒ 停下, 由人判', v_md5;
  END IF;
END
$pre$;

-- ── 2. 還原(正式庫原文逐字) ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pcm_order_refundable_remaining(p_order_id uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT o.total::bigint
       -- ↓↓ 前兩段【逐字取自 20260814190000 的現行定義,一個字都沒改】↓↓
       - COALESCE(
           (SELECT SUM(r.refund_amount)
              FROM public.order_refunds r
             WHERE r.order_id = o.id
               AND r.status IN ('processing', 'confirmed')), 0)
       - COALESCE(
           (SELECT SUM(r.refund_amount)
              FROM public.order_refunds r
              JOIN public.order_refund_effective_verdict v ON v.refund_id = r.id
             WHERE r.order_id = o.id
               AND r.status = 'failed'
               AND r.failed_reason = 'manual_failed'
               AND v.corrected_to = 'money_moved'), 0)
       -- ↑↑ 以上為現行機制(#473b-1),本檔【只加不改】↑↑
       -- 第三段:非卡退款(本檔新表)。刻意【不】join 上面那張更正判定 view ——
       -- 那張 view 是【卡片退款的人工判定被更正】的產物,而本表沒有判定 ⇒ join 會是零列、純裝飾。
       -- 🔴🔴 **刻意不寫出那張 view 的名字** —— 下一個維護者會想「為什麼這裡不寫清楚?」,答案在這:
       --    本檔 §0 的前置斷言與 §5e 都比對 `prosrc` 的**字面**,而 **`prosrc` 含註解**
       --    ⇒ 在函式本體裡寫出那個名字,會讓那兩道斷言對「把 JOIN 整段刪掉」**恆真**。
       --    (2026-08-20 突變 N2 實測抓到:刪掉 JOIN 之後 5e **沒紅** —— 因為這行註解替它答了。)
       --    📌 通則:`prosrc` / 檔案內容 / diff 這類「整包字串」當比對對象時,
       --       **註解與 code 在裡面是同一種東西**。要寫說明,寫在函式本體【外面】。
       -- 🔴 本表【沒有 status】⇒ 沒有值域可篩 ⇒ 全部列一律計入。
       --    這不是疏忽:它記的是既成事實,不存在「還沒生效的那種列」。
       - COALESCE(
           (SELECT SUM(m.refund_amount)
              FROM public.order_manual_refunds m
             WHERE m.order_id = o.id
               AND m.voided_at IS NULL), 0)
    FROM public.orders o
   WHERE o.id = p_order_id;
$function$;

-- ── 3. 後置斷言 ──────────────────────────────────────────────────────────────
DO $post$
DECLARE v_oid oid; v_md5 text; v_cfg text;
BEGIN
  v_oid := to_regprocedure('public.pcm_order_refundable_remaining(uuid)');
  SELECT md5(prosrc), (SELECT c FROM unnest(proconfig) c WHERE c LIKE 'search_path=%')
    INTO v_md5, v_cfg FROM pg_catalog.pg_proc WHERE oid=v_oid;
  IF v_md5 IS DISTINCT FROM 'a7c426364358738f792625c14363fb69' THEN
    RAISE EXCEPTION '還原後置閘:退回去的 body md5 是 %, 不是貼之前的 a7c426364358738f792625c14363fb69 ⇒ 沒有真的還原 ⇒ 拒 COMMIT', v_md5;
  END IF;
  -- 🔴 還原也會踩同一個坑:CREATE OR REPLACE 換掉 SET 子句 ⇒ 這裡一樣要驗。
  IF v_cfg IS DISTINCT FROM 'search_path=""' THEN
    RAISE EXCEPTION '還原後置閘:search_path 變成 % ⇒ 還原把加固解開了 ⇒ 拒 COMMIT', COALESCE(v_cfg,'(沒了)');
  END IF;
  RAISE NOTICE '✅ 已逐字還原(body md5 %)', v_md5;
END
$post$;

COMMIT;
