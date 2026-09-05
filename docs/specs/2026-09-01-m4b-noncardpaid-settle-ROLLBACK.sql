-- ⛔⛔ **[2026-09-04] 本檔已被 `supabase/migrations/20260904230000_m4b_noncardpaid_settle_and_expire_leg.sql` 取代 —— 不得貼。**
--   🔴 **貼下去的後果不是「重複做一次」, 是【把 Sean 拍的「匯款 5 天」靜靜翻回 1 天】** ——
--      本檔也 `CREATE OR REPLACE` 同一支 `pcm_cron.expire_unpaid_orders`, 而它寫死 `interval '1 day'`、
--      全檔 `payment_channel` 命中 0 ⇒ 分流那三行會被整段蓋掉, **而本檔自己的事後閘全綠、沒有東西會叫。**
--   🛑 **而擋它的【不是這段橫幅】** —— 板列 `⟦b4-V3REVERTS5DAYS⟧`:
--      本檔在此之前**就已經有一段「不得貼、不得 apply」的橫幅**, 而那個洞照樣被開出來。
--      ⇒ 📌 **橫幅擋不住這件事。真正擋得住的是 `fab3234bd` 加進本檔的【前置閘】** ——
--        它會在正式庫已經是分流版時 `RAISE` 拒絕繼續。
--      ⇒ 🎯 **所以這一段的作用是【指路】, 不是防線** —— 防線在碼裡, 而它已經裝上了。
--   🔵 要做本檔想做的那件事 ⇒ 去看 `20260904230000`(它是 `20260903080000` 的逐字超集 + 淨額腿)。
-- 🛑🛑🛑 **codex R2 判 FAIL(12 must-fix + 3 nit)· 不得貼、不得 apply、不得當交件。** 🛑🛑🛑
--    2026-09-02 01:0x。而【第一條就推翻了本檔存在的前提, 而我獨立複查過它是對的】:
--    本檔檔頭寫「人工退款那半有既有管線在管」—— **那句話不成立。**
--    `pcm_sync_order_refund_payment_status`(`20260823020000:265`)只加總
--    `order_refunds` 且 `status='confirmed'`,**它提到 `order_manual_refunds` 0 次**
--    (🟢 正對照:同一份函式體提到 `order_refunds` 1 次 ⇒ 那個 0 不是尺沒動)。
--    ⇒ `admin_record_manual_refund` 寫 A 表、然後呼叫一支只讀 B 表的同步器
--      ⇒ 它算到 0 ⇒ 提早 return ⇒ **狀態從來沒有被改過。**
--    ⇒ 📌 **人工退款 → payment_status 是一個【沒有主人】的缺口, 而我把它讀成「別人的」。**
--    🔴 而這是本片核心前提第【三】次被推翻:
--      v2「OP6a 看不到 ⇒ 我來補」⇒ v4「別人在管 ⇒ 我交還」⇒ 現在「沒有人在管」。
--    其餘 11 條 must-fix 見 plan(並發 stale-write / overpaid 留錯狀態 /
--      負淨額 cron 誤取消 / 還原閘沒剝註解 / ACL 斷言不含 PUBLIC / 沒有修復路徑 …)。
-- ════════════════════════════════════════════════════════════════════════
-- ⟦b4-NONCARDPAID1⟧ 還原 —— **整支貼下去就對, 不用挑段落。**
--
-- 🛑 **貼這一支之前先想一件事:還原之後, 原本的缺陷會回來。**
--    客人匯款、後台登記了收款, 而那張單隔天仍然會被逾期程式自動取消。
--
-- ✅ 它做兩件事:
--    ① 拿掉本片加的 trigger 與兩支函式
--    ② 把逾期程式改回【沒有匯款那條腿】的樣子 —— **而心跳保留**
--       (它重貼的是 20260828060000 那一代的完整身體, 只是拿掉本片新增的那一條腿)
-- 🔴 它【不做】的一件事:**不把已經被改過的訂單狀態改回去。**
--    那些是真實的收款事實 —— 一張真的收到錢的單, 不該因為我們拆掉一段程式就變回「未付款」。
--
-- ⚠️ 貼之前先看一眼現在裝的是不是本片:
--    SELECT prosrc FROM pg_proc WHERE oid = 'pcm_cron.expire_unpaid_orders(integer)'::regprocedure;
--    裡面若出現 `np.order_id = o.id` 以外你不認得的東西 ⇒ 停下來問, 不要貼。

BEGIN;

DO $pre$
BEGIN
  IF pg_catalog.strpos(
       (SELECT p.prosrc FROM pg_catalog.pg_proc p
         WHERE p.oid = 'pcm_cron.expire_unpaid_orders(integer)'::regprocedure),
       'np.order_id = o.id') = 0 THEN
    RAISE EXCEPTION '還原前置:現在裝的【不是】本片(找不到 np.order_id = o.id)。'
                    '⇒ 貼下去會把別人的版本蓋掉。停下來確認, 拒繼續';
  END IF;

  -- 🔴🔴 **2026-09-04 線【信】加的一道前置閘 —— 本檔的業務邏輯一個字都沒動。**
  --   成因:本檔 `CREATE OR REPLACE` 的 `expire_unpaid_orders` 是**依 `payment_channel` 分流【之前】**
  --   的那一代(它的 WHERE 寫死 `interval '1 day'`、全檔 `payment_channel` 命中 0),
  --   而它對這支函式的既有前置閘**只問「有沒有心跳」** ⇒ 分流版身上也有心跳 ⇒ **那道閘會放行**。
  --   ⇒ 🛑 **貼下去會把 Sean 2026-09-03 的拍板(匯款/現金 5 天)靜靜還原成一律 1 天**,
  --     而本檔既有的四道事後 `strpos` 閘**一道都不會叫**(它們檢的字面在兩版都在)。
  --   🎯 **⇒ 而那個洞是【分流那一片】的作者(線信)自己漏的**:他用 `md5(prosrc)` 守住了
  --     「別人先上、我後上」那個方向, **而沒有守「我先上、別人後上」** ——
  --     📌 **一個不變式有兩個方向, 而他只想到會傷害自己的那一個。**
  --   ⚠️ **本閘只擋、不修** —— 要不要分流、天數多少, 那是 ⟦b4-NONCARDPAID1⟧ 與 Sean 的事。
  IF pg_catalog.strpos(
       (SELECT p.prosrc FROM pg_catalog.pg_proc p
         WHERE p.oid = 'pcm_cron.expire_unpaid_orders(integer)'::regprocedure),
       'payment_channel') > 0 THEN
    RAISE EXCEPTION '前置:正式庫的 expire_unpaid_orders 已經【依 payment_channel 分流】'
                    '(supabase/migrations/20260903080000_m4b_expire_unpaid_by_payment_channel.sql:'
                    ' tappay 1 天 / bank_transfer 與 cash 5 天, Sean 2026-09-03 逐字拍板)。'
                    '而本檔重建的是分流【之前】那一版 ⇒ 貼下去會把那個拍板靜靜還原成一律 1 天, '
                    '而本檔的四道事後 strpos 閘不會叫。'
                    '出路二選一:①把 20260903080000 的那段 CASE 分流合進本檔的函式體 '
                    '②先貼本檔、再貼 20260903080000(它自己的 md5 前置閘會擋住順序錯誤)。拒繼續';
  END IF;
END
$pre$;

DROP TRIGGER IF EXISTS pcm_noncard_settle_after_payment_ai ON public.order_payments;
DROP FUNCTION IF EXISTS public.pcm_noncard_settle_after_payment();
DROP FUNCTION IF EXISTS public.pcm_noncard_settle_recompute(uuid);

-- 逐字回到 20260828060000_m4b_b4cron6_expire_unpaid_orders_heartbeat.sql:189 那一代。
CREATE OR REPLACE FUNCTION pcm_cron.expire_unpaid_orders(p_limit integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_count integer;
BEGIN
  IF p_limit IS NULL OR p_limit <= 0 THEN
    p_limit := 1;
  END IF;

  WITH target AS (
    SELECT o.id
      FROM public.orders o
     WHERE o.payment_status = 'unpaid'::public.payment_status
       AND o.cancelled_at IS NULL
       AND o.created_at < pg_catalog.now() - interval '1 day'
       AND NOT EXISTS (
             SELECT 1 FROM public.payment_charge_attempts a
              WHERE a.order_id = o.id
                AND a.status <> 'failed'
           )
     ORDER BY o.created_at
     LIMIT p_limit
     FOR UPDATE OF o SKIP LOCKED
  )
  UPDATE public.orders o
     SET cancelled_at     = pg_catalog.now(),
         cancelled_reason = 'payment_expired',
         updated_at       = pg_catalog.now()
    FROM target t
   WHERE o.id = t.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE LOG '[expire_unpaid_orders] expired=% limit=%', v_count, p_limit;

  BEGIN
    INSERT INTO public.sweeper_heartbeat (job_name, last_success_at, consecutive_failures, updated_at)
    VALUES ('pcm-expire-unpaid-orders', pg_catalog.clock_timestamp(), 0, pg_catalog.clock_timestamp())
    ON CONFLICT (job_name) DO UPDATE
      SET last_success_at      = GREATEST(public.sweeper_heartbeat.last_success_at, excluded.last_success_at),
          consecutive_failures = 0,
          updated_at           = GREATEST(public.sweeper_heartbeat.updated_at, excluded.updated_at);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[expire_unpaid_orders] 心跳寫入失敗(本輪取消不受影響):%', SQLERRM;
  END;

  RETURN v_count;
END;
$fn$;

REVOKE ALL ON FUNCTION pcm_cron.expire_unpaid_orders(integer)
  FROM PUBLIC, anon, authenticated, service_role, payment_confirmer;

DO $post$
DECLARE v_bare text; v_n integer;
BEGIN
  SELECT pg_catalog.regexp_replace(p.prosrc, '--[^' || pg_catalog.chr(10) || ']*', '', 'g')
    INTO v_bare FROM pg_catalog.pg_proc p
   WHERE p.oid = 'pcm_cron.expire_unpaid_orders(integer)'::regprocedure;
  IF pg_catalog.strpos(v_bare, 'np.order_id = o.id') > 0 THEN
    RAISE EXCEPTION '還原後置:那條腿還在 ⇒ 還原沒生效'; END IF;
  IF pg_catalog.strpos(v_bare, 'sweeper_heartbeat') = 0 THEN
    RAISE EXCEPTION '還原後置:心跳不見了 ⇒ 還原把它一起拆掉了, 那不是還原'; END IF;
  IF pg_catalog.strpos(v_bare, 'payment_charge_attempts') = 0 THEN
    RAISE EXCEPTION '還原後置:卡片那條腿不見了'; END IF;
  SELECT pg_catalog.count(*)::integer INTO v_n FROM pg_catalog.pg_trigger t
   WHERE NOT t.tgisinternal AND t.tgname LIKE 'pcm_noncard%';
  IF v_n <> 0 THEN RAISE EXCEPTION '還原後置:本片 trigger 還剩 % 支', v_n; END IF;
  RAISE NOTICE '⟦b4-NONCARDPAID1⟧ 還原完成:trigger 與兩支函式已移除 / cron 回到心跳那一代且匯款腿已拿掉';
  RAISE NOTICE '⚠️ 提醒:原本的缺陷回來了 —— 匯款單隔天會再度被自動取消。';
END
$post$;

COMMIT;
