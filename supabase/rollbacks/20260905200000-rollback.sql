-- ════════════════════════════════════════════════════════════════════════════
-- Rollback:20260905200000_m4b_outbox_record_sent_tracking_number
-- 🔵 檔名與位置照既有慣例 `supabase/rollbacks/<版本>-rollback.sql`(2026-09-05 merge origin/dev
--    之後才看到那個目錄裡已經有六支)—— ⛔ 我第一版寫成 `supabase/rollback/…_rollback.sql`
--    (單數 + 底線)⇒ 📌 **一個自己開的目錄不會與任何東西衝突, 所以它不會有人來糾正。**
-- ════════════════════════════════════════════════════════════════════════════
-- 🔴🔴 **這一份的驗收條件是【貼得下去】, 不是【讀得懂】。**
--    它取代原本寫在那支 migration 檔頭、帶著一個 `...` 的「範例」——
--    📌 **要 rollback 的那一刻, 沒有人有心情去抄一支 60 行的 view。**(codex 2026-09-05 R1 must-fix)
--
-- 🛑 **它【不】刪 `email_outbox.sent_tracking_number` / `sent_seq` / 那個序列。**
--    那兩欄裡是「已經寄出去的信實際說了什麼」—— **沒有第二個來源的歷史**。
--    刪掉再貼回來會全部變 NULL ⇒ 歷史列永久落回舊的盲判準。
--    ⇒ ✅ 而留著之後**還能重貼**:forward 的前置閘②已經改成「兩欄要嘛都在、要嘛都不在」。
--
-- 🛑 **有一格不可逆**:過渡期間已經寄出去的信收不回來。**本檔只還原判準, 不還原後果。**
--
-- 🔴 **順序有意義**:先把主面換回第一代(它不再讀底面), 才能 DROP 底面。
--    反過來做會 `cannot drop … because other objects depend on it`。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ══ 前置閘:確認現在真的是第二代, 而不是別的東西 ═══════════════════════
DO $$
DECLARE v_def text;
BEGIN
  IF pg_catalog.to_regclass('public.pcm_tracking_corrected_email_pending') IS NULL THEN
    RAISE EXCEPTION 'rollback 前置閘①:主面不存在 ⇒ 這裡不是我以為的狀態, 停下來看一眼';
  END IF;
  v_def := pg_catalog.pg_get_viewdef('public.pcm_tracking_corrected_email_pending'::regclass, true);
  IF pg_catalog.strpos(v_def, 'pcm_tracking_correction_candidates') = 0 THEN
    RAISE EXCEPTION 'rollback 前置閘②:主面沒有讀底面 ⇒ 它已經不是 20260905200000 那一代 ⇒ 本檔不適用';
  END IF;
END
$$;

-- ══ 1. 主面換回第一代(逐字複製自 20260904220000:359-418)═══════════════
CREATE OR REPLACE VIEW public.pcm_tracking_corrected_email_pending
  WITH (security_invoker = true) AS
SELECT DISTINCT
  s.id                    AS shipment_id,
  s.shipment_reference    AS shipment_reference,
  s.tracking_number       AS tracking_number,
  s.carrier_code          AS carrier_code,
  s.tracking_corrected_at AS tracking_corrected_at,
  -- 🔴 **TS 拿這一欄去組 dedup_key, 它自己不格式化任何時間。** 見上面那支函式的說明。
  public.pcm_tracking_corrected_at_key(s.tracking_corrected_at) AS corrected_at_key,
  o.id                    AS order_id,
  o.display_id            AS display_id,
  o.notification_email    AS notification_email,
  c.email                 AS customer_email
FROM public.shipments s
JOIN public.shipment_items si ON si.shipment_id = s.id
JOIN public.order_items   oi ON oi.id = si.order_item_id
JOIN public.orders         o ON o.id = oi.order_id
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
WHERE s.shipped_at IS NOT NULL
  AND s.deleted_at IS NULL
  -- 🔴 這一格就是「這個號碼不是第一次出貨那個」。
  AND s.tracking_corrected_at IS NOT NULL
  -- 🔴🔴 **空白定義走 `pcm_js_trim_whitespace()` 單一來源, 不用預設的 `btrim`**
  --    (codex 2026-09-04 must-fix #1)。⛔ 我第一版寫裸 `btrim(x)` —— 它**只吃空格**,
  --    而本片的計數面(`20260904280000`)用的是 `btrim(x, JS_WS)`(含 tab / 換行)
  --    ⇒ 🛑 **一個只有 tab 的信箱:view 判「有收件人」而計數判「沒有」⇒ 【兩邊都算到它】。**
  --    ⇒ 📌 那兩支宣稱是**互補集**, 而互補集的定義若在兩邊各寫一份, 它們遲早不互補。
  AND nullif(pg_catalog.btrim(s.tracking_number, public.pcm_js_trim_whitespace()), '') IS NOT NULL
  AND (
        nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
     OR nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      )
  -- 🔴🔴 **這一句是本 view 最重要的一格 —— 而它不在任何人的驗收條件裡, 是我加的。**
  --    這封信的內容是「**先前**通知您的單號有誤」⇒ 🎯 **它的前提是客人【真的收過】那個錯號碼。**
  --    🛑 而有兩個世界會讓那個前提不成立, 兩個都是**真實會發生**的:
  --      ① **出貨信被 cutoff 擋掉 / 永久 failed** ⇒ 客人一個號碼都沒收過
  --      ② **出貨信還排在佇列裡(pending)時號碼就被改了** ⇒ 送信當下讀的是【live】追蹤碼
  --         (`OrderShippedEmailPayload` 刻意不存號碼)⇒ 那封出貨信本身帶的就是**改過的號碼**
  --         ⇒ 客人收到「您的單號是 B」, 而下一封告訴他「先前那個有誤, 是 B」。
  --    ⇒ ✅ 所以判準不是「出貨信寄了沒」, 是 **「出貨信在【更正之前】就寄出去了」**。
  --      `sent_at < tracking_corrected_at` 這一個比較同時擋掉上面兩個世界。
  --    ⚠️ **它答不出的**:同一箱被更正**兩次**, 而 `tracking_corrected_at` 只留最後一次
  --      ⇒ 兩次之間的時序分不出來。今天不會錯(鍵含號碼 ⇒ 每次更正各一封),
  --      而**若哪天要按次數對帳, 這一欄不夠** —— 那時要去 admin_audit_log。
  AND EXISTS (
        SELECT 1
          FROM public.email_outbox e0
         WHERE e0.event_type = 'order_shipped'
           AND e0.dedup_key  = public.pcm_shipped_email_dedup_key(s.id, o.id)
           AND e0.status     = 'sent'
           AND e0.sent_at IS NOT NULL
           AND e0.sent_at < s.tracking_corrected_at
      )
  AND NOT EXISTS (
        SELECT 1
          FROM public.email_outbox e
         WHERE e.event_type = 'shipment_tracking_corrected'
           AND e.dedup_key  = public.pcm_tracking_corrected_dedup_key(s.id, o.id, s.tracking_corrected_at)
      );

COMMENT ON VIEW public.pcm_tracking_corrected_email_pending IS
  $c$「已出貨、未作廢、單號被更正過、而且客人【真的收過那個錯號碼】、還沒排過更正信」的 (箱, 單) 配對。一列 = 一封信。
🔴 最重要的一格是 sent_at 早於 tracking_corrected_at 那個 EXISTS ——
這封信說的是「先前通知您的單號有誤」, 而它的前提是客人真的收過。
出貨信被 cutoff 擋掉、或還在 pending 時號碼就被改了(送信當下讀 live 追蹤碼)⇒ 兩種都不該寄。
⚠️ 本 view 含 PII(兩個 email 欄)⇒ 僅 service_role 可讀。
⚠️ 它不自帶 cutoff —— 呼叫端要不要加起始線由呼叫端決定;而上面那道 EXISTS 已經
把「功能上線第一秒集合等於歷史全部」那個病擋掉了(歷史上的箱沒有 tracking_corrected_at)。
🔴 部署順序:模板與 enqueue 接線必須同一次 deploy —— 差集不分 status, 一列 failed 就永久排除那個 (箱,號碼)。$c$;


-- ══ 2. 只收掉【會改變寄信行為】的那兩個物件 ═══════════════════════════════
-- 🔴🔴 **2026-09-05 codex R2 三條 must-fix 之後改小了範圍。**
--   ⛔ ~~原本:DROP 掉底面、互補面、`pcm_safe_uuid`, 並叫人「先重貼 20260904280000」~~
--   🛑 那條路有三個洞, 而三個都是【交易會成功提交、下一次呼叫才炸】的那種:
--     ① `20260904280000` 是 `CREATE FUNCTION` **不是** `CREATE OR REPLACE`
--       ⇒ 同名函式還在時重貼**直接 duplicate function 失敗** ⇒ 我指的那條路走不通。
--     ② 就算只貼本檔:`get_tracking_corrected_gap_counts()` 仍然 `SELECT … FROM` 那兩支 view,
--       而 **PL/pgSQL 的函式體不建立 catalog 相依** ⇒ **DROP 不會被擋、交易照樣 COMMIT**
--       ⇒ 🛑 **下一次告警呼叫才以 `relation does not exist` 爆掉。**
--     ③ 而我的後置驗收**完全沒有呼叫過那支 counts** ⇒ 上面那個世界**六格全綠**。
--   ✅ 改法:**rollback 只做「讓信恢復成第一代的判準」這一件事**。
--     底面 / 互補面 / `pcm_safe_uuid` / counts **全部留著** —— 它們是**唯讀**的,
--     留著不改變任何寄信行為, 而**刪掉它們會弄壞一個仍在被呼叫的函式**。
--   ⇒ 📌 **回退的範圍要對齊「我要撤銷的那個行為」, 不是「我這一片建了什麼」。**
--     (那兩支 view 從此會顯示第二代的判準, 而沒有人依它寄信 —— 這是刻意的取捨, 寫在這裡。)

DROP TRIGGER IF EXISTS pcm_email_outbox_stamp_sent_seq ON public.email_outbox;
DROP FUNCTION IF EXISTS public.pcm_email_outbox_stamp_sent_seq();

-- ══ 3. 後置驗收:每一格印【兩個世界會不同】的東西 ═════════════════════
DO $$
DECLARE v_def text;
BEGIN
  v_def := pg_catalog.pg_get_viewdef('public.pcm_tracking_corrected_email_pending'::regclass, true);
  IF pg_catalog.strpos(v_def, 'pcm_tracking_correction_candidates') > 0 THEN
    RAISE EXCEPTION 'rollback 後置①:主面還在讀底面 ⇒ 第 1 節沒生效';
  END IF;
  -- 🟢 正對照:主面確實回到了第一代那個時間比較(而不是變成一張空的/別的 view)
  IF pg_catalog.strpos(v_def, 'sent_at < s.tracking_corrected_at') = 0 THEN
    RAISE EXCEPTION 'rollback 後置②:主面裡找不到第一代的時間判準 ⇒ 它不是第一代';
  END IF;
  IF pg_catalog.strpos(v_def, 'sent_tracking_number') > 0 THEN
    RAISE EXCEPTION 'rollback 後置③:主面裡還有 sent_tracking_number ⇒ 換回去的不是第一代';
  END IF;
  -- 🔴 **底面【必須還在】** —— counts 仍然讀它。這一格是「別刪過頭」的負對照(方向與上一版相反)。
  IF pg_catalog.to_regclass('public.pcm_tracking_correction_candidates') IS NULL THEN
    RAISE EXCEPTION 'rollback 後置④:底面被刪掉了 ⇒ counts 下一次呼叫就會炸';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
              WHERE tgrelid = 'public.email_outbox'::regclass
                AND tgname  = 'pcm_email_outbox_stamp_sent_seq' AND NOT tgisinternal)
  THEN RAISE EXCEPTION 'rollback 後置⑤:蓋 sent_seq 的 trigger 還在'; END IF;
  -- 🔴 而這兩欄**必須還在** —— 它們是歷史。這一格是「別刪過頭」的負對照。
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public.email_outbox'::regclass
         AND attname IN ('sent_tracking_number', 'sent_seq', 'sent_tracking_recorded')
         AND NOT attisdropped) <> 3
  THEN RAISE EXCEPTION 'rollback 後置⑥:三個新欄不見了 ⇒ 有人刪過頭, 而那是唯一一份出門紀錄'; END IF;

  -- 🔴🔴 **後置⑦:真的把那支告警函式【叫一次】。**(codex R2 must-fix)
  --    上面那幾格全部只問「東西在不在」—— 而本檔要防的那個世界是
  --    **「交易成功提交、而下一次呼叫才炸」** ⇒ 📌 **那個世界只有【叫它一次】才看得見。**
  --    🔵 回傳值不看(它是計數, 會隨資料變)—— 看的是**它叫得動**。
  PERFORM public.get_tracking_corrected_gap_counts();
END
$$;

COMMIT;
