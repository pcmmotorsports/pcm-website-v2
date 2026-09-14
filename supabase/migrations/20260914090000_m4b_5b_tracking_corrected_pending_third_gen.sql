-- 20260914090000_m4b_5b_tracking_corrected_pending_third_gen.sql
--
-- ⟦5b-SHIPPEDNUMNOTRECORDED1⟧ —— **更正單號信的掃描面回到「比號碼」。**
-- plan:`docs/plans/2026-09-14-tracking-corrected-pending-third-gen-plan.md`
--
-- 🔴 **版本號不是 20260914080000** —— 那個號 2026-09-14 掃五個 worktree 時
--    **已被施工窗佔用**(`~/pcm-admin-ui/.../20260914080000_m4b_hct_record_label_raw.sql`)。
--
-- ══ 病灶 ═══════════════════════════════════════════════════════════════════
-- `pcm_tracking_corrected_email_pending` 今天用**時間比較**(`e0.sent_at < s.tracking_corrected_at`)
-- 判「客人收過的號碼跟現在不一樣」。它在兩個世界判錯:
--   ① **競態**:寄出之後、寫 `sent_at` 之前號碼被改 ⇒ `sent_at > corrected_at` ⇒ 判成「沒收過」⇒ 不寄。
--   ② **改回去**:寄 A → 改 B → 更正信說 B → **又改回 A** ⇒ 客人手上最後一封說 B, 而現在是 A ⇒ 不寄。
-- ✅ 要比的是【**我們最後一次告訴這張訂單的收件人的號碼**】與【現在的號碼】,
--    而那個規則**早就寫好了**, 住在 `pcm_tracking_correction_candidates`(`20260905200000`)。
--
-- ══ 🔴🔴 為什麼它「寫好了」而線上還是第一代 —— 這一段是本檔的核心 ══════════
-- `20260905200000` 把 pending 改成**讀底面**(規則只有一份)。
-- 兩天後 `20260907060000`(給五張 view 補「自己 skip 的要能重排」)**用一份自己寫的、
-- 時間比較的定義 `CREATE OR REPLACE` 了同一支 view** ⇒ 第二代那一半被安靜換掉。
-- 🛑 **而三綠、型別、每一道靜態閘、每一支測試全部照樣綠** —— 沒有任何東西會叫。
-- 📌 memory `reference_parallel-rpc-generations-later-version-must-be-union` 記的正是這個形狀:
--    **同一個物件兩窗各開一代 ⇒ 版本號晚的那一支【必須是聯集】。**
--    ⇒ 🎯 **所以本檔不是「把第二代再貼一次」, 是【把兩代合起來】。** 少任何一半都是退步。
--
-- ══ 🔴 連帶修的第二件事(本次查出來的, 不在派工單上)════════════════════════
-- `get_tracking_corrected_gap_counts()` 的 `no_recipient_count` **直接讀底面**
-- (`20260905200000` 那支函式), 而它的 COMMENT 逐字保證
-- 「前兩格是互補的兩半…**兩半的和恆等於底面**」。
-- 而 `20260907060000` 讓 pending **完全不讀底面**, 還多了兩個底面沒有的條件
-- ⇒ 🛑 **那個「結構上的保證」今天不成立**, 具體兩種漏法:
--   · 被我們自己 skip 過的列(四碼)⇒ 進得了 pending, **而底面把它排除** ⇒ 兩邊不同意;
--   · 手動單 `notification_email` 空而 `customers.email` 有 ⇒ pending 排除它,
--     `no_recipient_count` 也不數它(它有收件人)⇒ 📌 **兩半【都】看不到同一列。**
-- ✅ **修法 = 把那兩個條件搬回底面** ⇒ 規則回到一份, 互補保證自動回來。
--    ⇒ 🔵 而 `no_recipient_count` 的語意因此變得更對:手動單留白是 Sean 拍過的「不寄」,
--      它本來就不該被當成一個「該寄而寄不出去」的缺口去告警。
--
-- ══ 不動的 ═════════════════════════════════════════════════════════════════
-- `get_tracking_corrected_gap_counts()` / `pcm_tracking_corrected_payload_unparseable` /
-- 全部 ACL / TS 那一側(`SupabaseTrackingCorrectedScannerAdapter.ts` 只認 view 名)。
-- **不加欄、不加表、不加函式** —— 本檔只換兩支 view 的定義。

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ══ 前置閘 ════════════════════════════════════════════════════════════════
DO $pre$
DECLARE
  v_base text;
  v_top  text;
  v_cols text[];
BEGIN
  -- ① 兩支 view 都要在。「不存在」與「已經是別代」成因不同, 分開報。
  IF pg_catalog.to_regclass('public.pcm_tracking_correction_candidates') IS NULL THEN
    RAISE EXCEPTION '前置閘①a:pcm_tracking_correction_candidates 不存在 ⇒ 20260905200000 沒貼過, 先貼它';
  END IF;
  IF pg_catalog.to_regclass('public.pcm_tracking_corrected_email_pending') IS NULL THEN
    RAISE EXCEPTION '前置閘①b:pcm_tracking_corrected_email_pending 不存在 ⇒ 先貼 20260904220000';
  END IF;

  v_base := pg_catalog.pg_get_viewdef('public.pcm_tracking_correction_candidates'::regclass, true);
  v_top  := pg_catalog.pg_get_viewdef('public.pcm_tracking_corrected_email_pending'::regclass, true);

  -- ② 底面必須是第二代(比號碼)。不是的話, 本檔的「搬兩個條件進去」會蓋到一個我沒看過的定義。
  IF pg_catalog.strpos(v_base, 'sent_tracking_number') = 0 THEN
    RAISE EXCEPTION '前置閘②:底面 pcm_tracking_correction_candidates 不是第二代(找不到 sent_tracking_number)⇒ 停下來看一眼';
  END IF;

  -- ③ 🔴 本檔貼過了沒:貼完之後 pending 會【讀底面】。已經讀了 ⇒ 別再貼一次。
  IF pg_catalog.strpos(v_top, 'pcm_tracking_correction_candidates') > 0 THEN
    RAISE EXCEPTION '前置閘③:pending 已經讀底面 ⇒ 本檔貼過了(或有人先做了同一件事)';
  END IF;

  -- ④ 🔴🔴 **線上必須是我預期的那一代** —— 找不到第一代那個時間比較的字面 ⇒ 停。
  --    (少了這一格, 本檔會把一個我沒讀過的第三方定義安靜換掉。)
  -- ⛔ ~~原本找的是 `tracking_corrected_at`~~ —— codex 2026-09-14 R1 must-fix 2:
  --    **那個欄名本來就在 SELECT 清單裡** ⇒ 那一格恆真, **零判別力**。
  -- ✅ 要找的是【那一代獨有的】比較式本身。`pg_get_viewdef(..., true)` 會把它正規化成
  --    `e0.sent_at < s.tracking_corrected_at`(別名 s / e0 由 view 自己固定)。
  IF pg_catalog.strpos(v_top, 'sent_at < s.tracking_corrected_at') = 0 THEN
    RAISE EXCEPTION '前置閘④:pending 的定義裡找不到第一代那個時間比較(sent_at < s.tracking_corrected_at)⇒ 那不是我預期的那一代, 停下來看一眼';
  END IF;

  -- ⑤ 🔴🔴 **`CREATE OR REPLACE VIEW` 只准在尾端【加】欄** —— 少一欄 / 改名 / 換順序都會
  --    `ERROR: 42P16`。而 `20260905200000` 檔頭記過:它被這件事咬過一次
  --    (正式庫上這支 view 已被 `20260905080000` 加了第 11 欄 `order_source`,
  --     而**拋棄式 PG 從零重播看不見那件事**)⇒ 這裡逐欄比對, 不靠記憶。
  SELECT pg_catalog.array_agg(a.attname::text ORDER BY a.attnum)
    INTO v_cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.pcm_tracking_corrected_email_pending'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cols IS DISTINCT FROM ARRAY[
       'shipment_id','shipment_reference','tracking_number','carrier_code',
       'tracking_corrected_at','corrected_at_key','order_id','display_id',
       'notification_email','customer_email','order_source']::text[]
  THEN
    RAISE EXCEPTION '前置閘⑤:pending 的欄位清單不是我這一版的那 11 欄(線上=%)⇒ CREATE OR REPLACE 會紅, 停下來看一眼', v_cols;
  END IF;

  -- ⑥ 底面的欄位清單同樣要對(本檔也要 REPLACE 它)。
  SELECT pg_catalog.array_agg(a.attname::text ORDER BY a.attnum)
    INTO v_cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.pcm_tracking_correction_candidates'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cols IS DISTINCT FROM ARRAY[
       'shipment_id','shipment_reference','tracking_number','carrier_code',
       'tracking_corrected_at','corrected_at_key','order_id','display_id',
       'notification_email','customer_email','order_source']::text[]
  THEN
    RAISE EXCEPTION '前置閘⑥:底面的欄位清單不是我這一版的那 11 欄(線上=%)⇒ 停下來看一眼', v_cols;
  END IF;

  -- ⑦ 🔴 本檔要搬進底面的那四個 skip 碼, **必須是線上 pending 現在就有的那一份** ——
  --    少一個字就不是聯集了, 而那是靜默的退步。
  -- 🔴 **五碼, 不是四碼**(codex R1 must-fix 1):第五碼由 `20260907230000` 加入, 那才是最後一代。
  IF pg_catalog.strpos(v_top, 'tracking_superseded') = 0
     OR pg_catalog.strpos(v_top, 'shipment_voided') = 0
     OR pg_catalog.strpos(v_top, 'bank_order_not_mailable_at_send') = 0
     OR pg_catalog.strpos(v_top, 'bank_order_snapshot_stale') = 0
     OR pg_catalog.strpos(v_top, 'recipient_stale_at_send') = 0
  THEN
    RAISE EXCEPTION '前置閘⑦:線上 pending 少了五個 skip 碼其中之一 ⇒ 我要搬的那一份不是完整的(或線上比我新), 停下來看一眼';
  END IF;

  -- ⑧ 🔴 手動單那一段同樣要在(本檔要把它一起搬進底面)。
  IF pg_catalog.strpos(v_top, 'manual_phone') = 0 THEN
    RAISE EXCEPTION '前置閘⑧:線上 pending 少了手動單那一段 ⇒ 我要搬的那一份不是完整的, 停下來看一眼';
  END IF;
END
$pre$;

-- ══ 1. 底面 = 規則的唯一一份(第三代 = 第二代的比號碼 ＋ 20260907060000 的兩個條件)══
-- 🔴 欄位清單逐字與線上相同(11 欄、同名同序)—— 前置閘⑥ 已經比對過。
CREATE OR REPLACE VIEW public.pcm_tracking_correction_candidates
  WITH (security_invoker = true) AS
SELECT DISTINCT
  s.id                    AS shipment_id,
  s.shipment_reference    AS shipment_reference,
  s.tracking_number       AS tracking_number,
  s.carrier_code          AS carrier_code,
  s.tracking_corrected_at AS tracking_corrected_at,
  public.pcm_tracking_corrected_at_key(s.tracking_corrected_at) AS corrected_at_key,
  o.id                    AS order_id,
  o.display_id            AS display_id,
  o.notification_email    AS notification_email,
  c.email                 AS customer_email,
  o.order_source          AS order_source
FROM public.shipments s
JOIN public.shipment_items si ON si.shipment_id = s.id
JOIN public.order_items   oi ON oi.id = si.order_item_id
JOIN public.orders         o ON o.id = oi.order_id
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
WHERE s.shipped_at IS NOT NULL
  AND s.deleted_at IS NULL
  AND s.tracking_corrected_at IS NOT NULL
  AND nullif(pg_catalog.btrim(s.tracking_number, public.pcm_js_trim_whitespace()), '') IS NOT NULL
  -- 🛑 **這裡【刻意沒有】收件人條件** —— 它是兩個消費者各自加的那一半
  --    (`pcm_tracking_corrected_email_pending` 加「有」, `no_recipient_count` 加「沒有」)。
  --    ⇒ 兩半的和恆等於本面 —— 那是結構上的保證, 不是一句註解。
  --
  -- 🔴🔴 **【我們最後一次告訴這【一張訂單】的收件人什麼】** —— 逐字沿用 `20260905200000` 那一版。
  --  · 粒度 = **(shipment_id, order_id) 兩鍵都綁**:一箱可裝多張訂單的品項,
  --    只綁 shipment ⇒ O1 最後收到 B、O2 最後收到 A ⇒ **一邊漏寄、一邊誤寄**, 而兩者都不會叫。
  --  · 髒 payload ⇒ `pcm_safe_uuid()` 沒過就當不匹配, **不 cast、不 raise** ⇒ 整張 view 活著;
  --    那些列在 `pcm_tracking_corrected_payload_unparseable` 看得見。
  --  · 判斷式問的是**出處旗標** `sent_tracking_recorded`, 不是「號碼是不是 NULL」——
  --    後者分不出「片 B 之前的舊列(該回落)」與「那封信本來就沒帶號碼(= 沒告訴過客人)」。
  --  · 排序主鍵是 `sent_seq`(序列沒有時鐘;`sent_at` 是應用主機的時鐘, 兩台機器偏差時
  --    後寄的信可以拿到比較早的 `sent_at`), `sent_at` 只當決勝。
  AND CASE
        WHEN (
          SELECT last.sent_tracking_recorded
            FROM public.email_outbox last
           WHERE last.status      = 'sent'
             AND last.sent_at    IS NOT NULL
             AND last.event_type IN ('order_shipped', 'shipment_tracking_corrected')
             AND last.order_id    = o.id
             AND public.pcm_safe_uuid(last.payload ->> 'shipment_id') = s.id
           ORDER BY last.sent_seq DESC NULLS LAST, last.sent_at DESC
           LIMIT 1
        ) IS TRUE
        THEN (
          SELECT last.sent_tracking_number
            FROM public.email_outbox last
           WHERE last.status      = 'sent'
             AND last.sent_at    IS NOT NULL
             AND last.event_type IN ('order_shipped', 'shipment_tracking_corrected')
             AND last.order_id    = o.id
             AND public.pcm_safe_uuid(last.payload ->> 'shipment_id') = s.id
           ORDER BY last.sent_seq DESC NULLS LAST, last.sent_at DESC
           LIMIT 1
        -- 🔵 那封信的 `sent_tracking_number` 是 NULL(= 沒告訴過他號碼)⇒ `NULL IS DISTINCT FROM 'A'`
        --    ⇒ true ⇒ 寄。而那一封在客人眼中是【首次告知】不是【更正】—— 文案不在本檔。
        ) IS DISTINCT FROM nullif(pg_catalog.btrim(s.tracking_number, public.pcm_js_trim_whitespace()), '')
        -- 🔵 回落分支:出門紀錄全 NULL 的舊列, 行為與第一代**逐字相同**。
        ELSE EXISTS (
          SELECT 1
            FROM public.email_outbox e0
           WHERE e0.event_type = 'order_shipped'
             AND e0.dedup_key  = public.pcm_shipped_email_dedup_key(s.id, o.id)
             AND e0.status     = 'sent'
             AND e0.sent_at IS NOT NULL
             AND e0.sent_at < s.tracking_corrected_at
        )
      END
  -- 🔴🔴 **[本檔搬進來的第 ① 個條件 —— 來源 `20260907060000`]**
  --    只擋【不是我們自己跳過的】列。`COALESCE` 不可省:`last_error_code` 可以是 NULL
  --    (pending / sent 的列就是)⇒ 少了它 `NULL NOT IN (…)` 回 NULL ⇒ WHERE 當假
  --    ⇒ 🛑 **那些列就不擋了** ⇒ 每一輪重寄同一封, 方向【相反】。
  --    🛑 **`failed` 不在清單裡, 而那是刻意的** —— 放行它會被唯一鍵 `(event_type, dedup_key)`
  --      擋著 ⇒ 每一輪重撈而永遠插不進去 ⇒ 擠掉真的要寄的信(45f 量到的病)。
  --      死信怎麼救是另一件事 ⇒ 後台 `admin_requeue_dead_email`。
  --    🔴 **新增 skip 碼時五張 view 一起加, 少一張等於沒修。**
  AND NOT EXISTS (
        SELECT 1
          FROM public.email_outbox e
         WHERE e.event_type = 'shipment_tracking_corrected'
           AND e.dedup_key  = public.pcm_tracking_corrected_dedup_key(s.id, o.id, s.tracking_corrected_at)
           AND COALESCE(e.last_error_code, '') NOT IN (
                 'shipment_voided',
                 'tracking_superseded',
                 'bank_order_not_mailable_at_send',
                 'bank_order_snapshot_stale',
                 -- 🔴🔴 **第五碼 —— codex 2026-09-14 R1 must-fix 1 抓到我漏了它。**
                 --    `20260907230000_m4b_pending_views_allow_recipient_stale.sql` 才是這支 view
                 --    的**最後一代**(比 `20260907060000` 晚), 而我照著 09-07 06:00 那一版寫聯集
                 --    ⇒ 📌 **我差一點在一支【為了修「後貼的蓋掉先貼的」而寫】的 migration 裡,
                 --      再犯一次同一個錯。** 掃法已改成機械的:
                 --      `grep -ln 'CREATE OR REPLACE VIEW public.pcm_tracking_corrected_email_pending' supabase/migrations/*.sql | sort`
                 --      取**最後一支**, 不靠記憶挑。
                 'recipient_stale_at_send'
               ))
  -- 🔴🔴 **[本檔搬進來的第 ② 個條件 —— 來源 `20260907060000`]** 手動單留白 = 不寄。
  --    🔴 `o.order_source IS NULL` 那一格**非加不可**:`NULL NOT IN (…)` 回 **NULL**(不是 true)
  --      ⇒ `NULL OR false` = NULL ⇒ WHERE 當假 ⇒ 🛑 **來源不明的單會被排除**。
  --      而 TS 那半(`packages/domain/src/order/notification-fallback.ts`)對 `null` 是**照舊寄**
  --      ⇒ 📌 兩層對同一個世界給相反的答案, 而 SQL 那半贏(它先篩掉)。
  --      ⇒ ✅ 對齊 TS 的 fail 方向:**不知道來源 ⇒ 留在掃描面上(照舊寄)。**
  --        理由不對稱:**多寄一封信看得見, 少寄一封看不見。**
  --    🛑 值域**具名列出**, 不用 `LIKE 'manual\_%'` —— 前綴比對會讓一個未來的 `manual_whatever`
  --      靜靜拿到「可以不寄」這個行為, 而沒有人決定過它。
  --    ⚠️ 與 `notification-fallback.ts` 是**兩份**, 今天沒有機械守門把它們綁在一起(誠實揭示)。
  AND (
        o.order_source IS NULL
     OR o.order_source NOT IN ('manual_phone', 'manual_line', 'manual_other')
     OR nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      );

COMMENT ON VIEW public.pcm_tracking_correction_candidates IS
$c$該寄更正單號信的**規則底面**(第三代,2026-09-14 `20260914090000`)。
🔴 **判準 = 我們最後一次告訴【這一張訂單的收件人】的號碼 <> 現在的號碼**,粒度 (shipment_id, order_id)。
🔴 本面**刻意不含收件人條件** —— 有收件人 ⇒ `pcm_tracking_corrected_email_pending`;
   沒有 ⇒ `get_tracking_corrected_gap_counts()` 的 `no_recipient_count`。**兩半的和恆等於本面。**
🔵 第三代 = 第二代(`20260905200000` 的比號碼)∪ `20260907060000` 的兩個條件
   (自己 skip 的四碼要能重排、手動單留白不寄)。
   ⛔ **那兩個條件曾經只住在 pending 上** ⇒ 兩半各用一套規則 ⇒ 互補保證當時不成立。
🛑 要改判準**改這裡**;在 pending 上加條件會讓兩半再度不互補。$c$;

-- ══ 2. pending = 底面 ＋「寄得出去」那一半 ════════════════════════════════
CREATE OR REPLACE VIEW public.pcm_tracking_corrected_email_pending
  WITH (security_invoker = true) AS
SELECT
  v.shipment_id,
  v.shipment_reference,
  v.tracking_number,
  v.carrier_code,
  v.tracking_corrected_at,
  v.corrected_at_key,
  v.order_id,
  v.display_id,
  v.notification_email,
  v.customer_email,
  -- 🔴 **順序與名稱要與線上逐字相同** —— `CREATE OR REPLACE VIEW` 比的是這個清單(前置閘⑤)。
  v.order_source
FROM public.pcm_tracking_correction_candidates v
-- 🔴 空白定義走 `pcm_js_trim_whitespace()` 單一來源, 不用裸 `btrim`
--    (裸 btrim 只吃空格, 而計數面吃 tab/換行 ⇒ 兩邊會算到同一列)。
WHERE nullif(pg_catalog.btrim(v.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
   OR nullif(pg_catalog.btrim(v.customer_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL;

COMMENT ON VIEW public.pcm_tracking_corrected_email_pending IS
$c$該寄更正單號信的箱(第三代,2026-09-14 `20260914090000`)。
🔴 **規則不住在這裡** —— 它住在 `pcm_tracking_correction_candidates`,本面只加「有收件人」那一半。
⛔ ~~第一代:`sent_at < tracking_corrected_at`(比時間)~~ —— 它在兩個世界判錯:
   ①寄出之後、寫 `sent_at` 之前號碼被改(競態)②寄 A → 改 B → 更正信說 B → 又改回 A。
🛑 **第二代曾經上線, 而 `20260907060000` 用一份自己寫的時間比較定義把它蓋回去了** ——
   三綠與每一道靜態閘當時全綠。⇒ 下一支重建本面的 migration **必須是聯集**。
⚠️ 過渡:`email_outbox.sent_tracking_recorded` 為 false/NULL 的舊列**逐字回落到時間比較**
   ⇒ 對那些列行為與第一代完全相同。$c$;

-- ══ 3. ACL 回核(不設定, 只斷言)═══════════════════════════════════════════
-- 🔴 `CREATE OR REPLACE VIEW` **不會動既有的權限**, 所以本檔不重下 GRANT/REVOKE。
--    而「不會動」是我信的事 ⇒ 下面把它量出來。
DO $acl$
DECLARE v_has_anon boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') INTO v_has_anon;
  IF NOT v_has_anon THEN
    RAISE NOTICE '🔵 本環境沒有 anon 角色 ⇒ 反向那兩格【沒有讀數】, 不是通過';
  END IF;

  IF NOT pg_catalog.has_table_privilege('service_role', 'public.pcm_tracking_correction_candidates', 'SELECT') THEN
    RAISE EXCEPTION '斷言:service_role 讀不到 pcm_tracking_correction_candidates ⇒ 掃描線會斷, 拒繼續';
  END IF;
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.pcm_tracking_corrected_email_pending', 'SELECT') THEN
    RAISE EXCEPTION '斷言:service_role 讀不到 pcm_tracking_corrected_email_pending ⇒ 掃描線會斷, 拒繼續';
  END IF;
  IF v_has_anon AND pg_catalog.has_table_privilege('anon', 'public.pcm_tracking_correction_candidates', 'SELECT') THEN
    RAISE EXCEPTION '斷言(反向):anon 讀得到 pcm_tracking_correction_candidates ⇒ 客人資料外洩面, 拒繼續';
  END IF;
  IF v_has_anon AND pg_catalog.has_table_privilege('anon', 'public.pcm_tracking_corrected_email_pending', 'SELECT') THEN
    RAISE EXCEPTION '斷言(反向):anon 讀得到 pcm_tracking_corrected_email_pending ⇒ 客人資料外洩面, 拒繼續';
  END IF;
  -- 🔵 `authenticated` 也要核(codex R1 nit 2)—— 一般會員登入後拿的就是這個角色,
  --    而這兩支 view 逐列帶著客人的 email。`anon` 過了不蘊含它也過。
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    IF pg_catalog.has_table_privilege('authenticated', 'public.pcm_tracking_correction_candidates', 'SELECT') THEN
      RAISE EXCEPTION '斷言(反向):authenticated 讀得到 pcm_tracking_correction_candidates ⇒ 客人 email 外洩面, 拒繼續';
    END IF;
    IF pg_catalog.has_table_privilege('authenticated', 'public.pcm_tracking_corrected_email_pending', 'SELECT') THEN
      RAISE EXCEPTION '斷言(反向):authenticated 讀得到 pcm_tracking_corrected_email_pending ⇒ 客人 email 外洩面, 拒繼續';
    END IF;
  ELSE
    RAISE NOTICE '🔵 本環境沒有 authenticated 角色 ⇒ 那兩格【沒有讀數】, 不是通過';
  END IF;
END
$acl$;

-- ══ 4. EXECUTE 事後斷言(invoker-view-execute-gate 要的那一條)══════════════
-- 🔴 這兩張是 `security_invoker` 的 view ⇒ 裡面那幾支函式是用【查它的人】的權限跑的。
--    view 建得起來、靜態閘全綠 —— 而如果那支函式的 EXECUTE 被收掉過,
--    **查它的人一次錯一次**, 而本 migration 不會有任何症狀。
-- ⚠️ 四支逐條寫開、簽章寫成字面, 是刻意的:`scripts/invoker-view-execute-gate.py` 的尺
--    只看 `has_function_privilege(` 之後 200 字 ⇒ 用迴圈它抽不到名字, 會判「這支檔沒有斷言」。
DO $exec$
DECLARE v_has_anon boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') INTO v_has_anon;

  IF NOT pg_catalog.has_function_privilege(
           'service_role', 'public.pcm_js_trim_whitespace()'::pg_catalog.regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '斷言:service_role 叫不動 public.pcm_js_trim_whitespace() ⇒ invoker view 會在【查的時候】才錯, 拒繼續';
  END IF;
  IF v_has_anon AND pg_catalog.has_function_privilege(
           'anon', 'public.pcm_js_trim_whitespace()'::pg_catalog.regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '斷言(反向):anon 竟然叫得動 public.pcm_js_trim_whitespace() ⇒ 那不是本支要的授權面, 拒繼續';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
           'service_role', 'public.pcm_shipped_email_dedup_key(uuid, uuid)'::pg_catalog.regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '斷言:service_role 叫不動 public.pcm_shipped_email_dedup_key(uuid, uuid) ⇒ invoker view 會在【查的時候】才錯, 拒繼續';
  END IF;
  IF v_has_anon AND pg_catalog.has_function_privilege(
           'anon', 'public.pcm_shipped_email_dedup_key(uuid, uuid)'::pg_catalog.regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '斷言(反向):anon 竟然叫得動 public.pcm_shipped_email_dedup_key(uuid, uuid) ⇒ 那不是本支要的授權面, 拒繼續';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
           'service_role', 'public.pcm_tracking_corrected_at_key(timestamptz)'::pg_catalog.regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '斷言:service_role 叫不動 public.pcm_tracking_corrected_at_key(timestamptz) ⇒ invoker view 會在【查的時候】才錯, 拒繼續';
  END IF;
  IF v_has_anon AND pg_catalog.has_function_privilege(
           'anon', 'public.pcm_tracking_corrected_at_key(timestamptz)'::pg_catalog.regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '斷言(反向):anon 竟然叫得動 public.pcm_tracking_corrected_at_key(timestamptz) ⇒ 那不是本支要的授權面, 拒繼續';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
           'service_role', 'public.pcm_safe_uuid(text)'::pg_catalog.regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '斷言:service_role 叫不動 public.pcm_safe_uuid(text) ⇒ invoker view 會在【查的時候】才錯, 拒繼續';
  END IF;
  IF v_has_anon AND pg_catalog.has_function_privilege(
           'anon', 'public.pcm_safe_uuid(text)'::pg_catalog.regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '斷言(反向):anon 竟然叫得動 public.pcm_safe_uuid(text) ⇒ 那不是本支要的授權面, 拒繼續';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
           'service_role', 'public.pcm_tracking_corrected_dedup_key(uuid, uuid, timestamptz)'::pg_catalog.regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '斷言:service_role 叫不動 public.pcm_tracking_corrected_dedup_key(uuid, uuid, timestamptz) ⇒ invoker view 會在【查的時候】才錯, 拒繼續';
  END IF;
  IF v_has_anon AND pg_catalog.has_function_privilege(
           'anon', 'public.pcm_tracking_corrected_dedup_key(uuid, uuid, timestamptz)'::pg_catalog.regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '斷言(反向):anon 竟然叫得動 public.pcm_tracking_corrected_dedup_key(uuid, uuid, timestamptz) ⇒ 那不是本支要的授權面, 拒繼續';
  END IF;
END
$exec$;

-- ══ 5. 事後閘:這一版真的是【聯集】════════════════════════════════════════
-- 🔴 本檔最大的風險不是建不起來, 是**建起來而少了一半** —— 那正是 20260907060000 的錯法,
--    而它當時全綠。⇒ 逐個字面回問底面的定義。
DO $post$
DECLARE
  v_base text;
  v_top  text;
BEGIN
  v_base := pg_catalog.pg_get_viewdef('public.pcm_tracking_correction_candidates'::regclass, true);
  v_top  := pg_catalog.pg_get_viewdef('public.pcm_tracking_corrected_email_pending'::regclass, true);

  -- ① 第二代那一半:比號碼
  IF pg_catalog.strpos(v_base, 'sent_tracking_number') = 0
     OR pg_catalog.strpos(v_base, 'sent_tracking_recorded') = 0 THEN
    RAISE EXCEPTION '事後閘①:底面掉了「比號碼」那一半 ⇒ 這不是聯集, 回滾';
  END IF;
  -- ② 20260907060000 那一半:四個 skip 碼
  IF pg_catalog.strpos(v_base, 'tracking_superseded') = 0
     OR pg_catalog.strpos(v_base, 'shipment_voided') = 0
     OR pg_catalog.strpos(v_base, 'bank_order_not_mailable_at_send') = 0
     OR pg_catalog.strpos(v_base, 'bank_order_snapshot_stale') = 0
     OR pg_catalog.strpos(v_base, 'recipient_stale_at_send') = 0 THEN
    RAISE EXCEPTION '事後閘②:底面掉了五個 skip 碼其中之一 ⇒ 這不是聯集, 回滾';
  END IF;
  -- ③ 20260907060000 那一半:手動單留白不寄(三個值域都要在)
  IF pg_catalog.strpos(v_base, 'manual_phone') = 0
     OR pg_catalog.strpos(v_base, 'manual_line') = 0
     OR pg_catalog.strpos(v_base, 'manual_other') = 0 THEN
    RAISE EXCEPTION '事後閘③:底面掉了手動單那一段 ⇒ 這不是聯集, 回滾';
  END IF;
  -- ④ 互補保證:pending 必須【讀底面】, 而且自己不再帶規則
  IF pg_catalog.strpos(v_top, 'pcm_tracking_correction_candidates') = 0 THEN
    RAISE EXCEPTION '事後閘④:pending 沒有讀底面 ⇒ 兩半又會各用一套規則, 回滾';
  END IF;
  IF pg_catalog.strpos(v_top, 'shipments') > 0 THEN
    RAISE EXCEPTION '事後閘⑤:pending 自己又 join 了 shipments ⇒ 規則跑回上層了, 回滾';
  END IF;

  -- ⑥🔴🔴 **繞過形狀的負對照**(codex 2026-09-14 R1 must-fix 2)。
  --    ①-⑤ 全部是「那個字面在不在」⇒ 它們擋得住【整段被刪掉】, 而**擋不住保留字面的邏輯退步**:
  --      · 底面 WHERE 尾巴加 `AND FALSE`  ⇒ 候選面整個歸零 ⇒ **全部少寄**, 而每一格字面都還在;
  --      · 加 `OR TRUE`                   ⇒ 繞過出貨 / 號碼 / 去重三組條件 ⇒ **錯的候選進排信流程**;
  --      · `o.order_source IS NULL` 換成 `FALSE` ⇒ 來源不明的單靜默漏掉。
  --    ⇒ 📌 **而「少寄」那一種是看不見的** —— 所以下面這幾格專門找那三種形狀。
  IF v_base ~ '(?i)\m(AND|OR)\s+(TRUE|FALSE)\M'
     OR v_base ~ '(?i)\m(AND|OR)\s+1\s*=\s*1\M' THEN
    RAISE EXCEPTION '事後閘⑥:底面的定義裡出現 AND/OR TRUE|FALSE|1=1 ⇒ 那是繞過形狀, 回滾';
  END IF;
  IF pg_catalog.strpos(v_base, 'order_source IS NULL') = 0 THEN
    RAISE EXCEPTION '事後閘⑦:底面掉了 `o.order_source IS NULL` 那一格 ⇒ 來源不明的單會被靜默排除(TS 那半是照舊寄), 回滾';
  END IF;
  IF pg_catalog.strpos(v_base, 'IS DISTINCT FROM') = 0 THEN
    RAISE EXCEPTION '事後閘⑧:底面掉了 `IS DISTINCT FROM`(比號碼那一式)⇒ 這不是第三代, 回滾';
  END IF;

  -- 🛑🛑 **射程 —— 這幾道閘證得到什麼、證不到什麼, 寫在這裡不寫在 commit 訊息裡:**
  --    ✅ 證得到:**漂移**(某一半被刪掉 / 被換成另一代 / 出現上面那三種繞過形狀)。
  --    ⛔ 證不到:一個**有心人**寫得出的等價繞過(例如 `AND (1=2 OR 1=2)`、
  --      或把某個條件包進一支永遠回 true 的函式)。
  --    📌 `20260905200000` 的字面釘樁早就逐字寫過同一句:「它防的是【漂移】不是【對手】」。
  --      ⇒ **不要因為這幾格綠了, 就說「行為被守住了」** —— 行為那一層在拋棄式 PG 的六個世界。
END
$post$;

COMMIT;
