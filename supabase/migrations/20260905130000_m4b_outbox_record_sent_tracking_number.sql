-- 20260905130000_m4b_outbox_record_sent_tracking_number.sql
--
-- ⟦5b-SHIPPEDNUMNOTRECORDED1⟧ 片 A · **草稿, 尚未經 Sean 拍板** —— 留在分支上, 不進 dev。
-- plan:`docs/plans/2026-09-05-shipped-email-records-sent-tracking-plan.md`
--
-- ═══ 這一支在解什麼 ═════════════════════════════════════════════════════
-- 出貨信 payload **刻意不存**追蹤碼(`OrderShippedEmailPayload` 註解逐字「追蹤碼不行, 存了會過期」)
-- ⇒ 更正信的掃描面只好用**時間比較**當代理:`sent_at < tracking_corrected_at`。
-- 🔴 而它有一個會出錯的窗:
--     sweeper 讀 live 號碼 = A ⇒ 寄出「您的單號是 A」
--       ⇒ **在寫 sent_at 之前**員工改成 B(觸發器蓋上 tracking_corrected_at)
--       ⇒ 最後才寫 sent_at ⇒ sent_at > tracking_corrected_at
--     ⇒ 判成「客人沒收過錯號碼」⇒ 🛑 不寄更正信, 而客人手上那封寫著 A。
--   ⚠️ 窗口只有寄送那幾秒, **而後果是永久的且零訊號**。
--
-- ═══ 🔴 而板列給的修法【不夠】 —— 「改回去」那個世界 ═══════════════════
-- 板列逐字:「判準改成逐字比對(`寄出去的號碼 <> 現在的號碼`)」。
-- 照 memory `feedback_a-rulings-reason-can-be-right-and-narrow` 的機械判別句
--   **「這個值可以【重複出現】嗎?」** ⇒ **可以, 追蹤號改回去是合法操作。**
--     寄 A → 改 B → 更正信說「正確的是 B」 → 🔴 又改回 A
--     「出貨信寄的號碼 <> 現在的號碼」⇒ A <> A 不成立 ⇒ 不寄
--     🛑 而客人手上【最後一封】說的是 B ⇒ 他拿著錯的, 而系統認為一切正常。
-- ✅ **⇒ 要比的不是「出貨信寄了什麼」, 是【我們最後一次告訴客人的是什麼】。**
--
-- 🔵 **而它不推翻原拍板, 是指出射程**:「存了會過期」講的是 **enqueue 時點的快照**;
--    而「寄出去的當下記下寄了什麼」是**出門紀錄** —— 它不會過期, 因為它描述一件已經發生的事。
--    ⇒ 所以落點是**新欄**, 不塞 payload(payload 欄註解逐字「事件時點不可變」)。
--
-- ═══ 🔴🔴 釘樁② —— 而我先前把它講得比實際嚴重, 這裡訂正 ═════════════════
-- ⛔ ~~「新 migration 若只 CREATE OR REPLACE VIEW, 下一次重貼舊 migration 會當場炸」~~
-- ✅ **實際更糟, 而它更安靜**:`20260904220000:443-447` 那段註解**自己就寫了** ——
--    逐字「**它只在【本檔 apply 的那一刻】成立。之後任何一支 migration 重建這個 view,
--    本釘樁完全不會知道 ⇒ 那條保護就沒了, 而沒有東西會叫。**」
--    ⇒ 📌 **所以本檔重建 view【不會被擋】, 它只是讓那道保護靜靜消失。**
--    ⇒ ⇒ **重釘不是為了避開一個 RAISE, 是因為不重釘就沒有人會發現保護不見了。**
--
-- ⛔ 舊樁字面(留著加刪除線, 讓搜它的人同一發撞到本檔):
--    ~~`IF pg_catalog.strpos(v_def, 'sent_at < s.tracking_corrected_at') = 0 THEN`~~
--    ⇒ 本檔之後那個字面**不再出現在 view 定義裡**(它搬進 CASE 的 ELSE 分支, 見下)。
--
-- ═══ 過渡期(會被忘記的一格, 所以寫在這裡而不是 plan 裡)═══════════════════
-- 片 A(本檔)先貼、片 B(寫入那一欄)才有東西可寫 ⇒ **B 上線前新欄全是 NULL**。
-- 🔴 若判準無條件改成逐字比對:`NULL IS DISTINCT FROM 'A'` ⇒ **TRUE** ⇒ 每一箱改過號碼的都會寄
--    ⇒ 🛑 **連「客人從來沒收過那個錯號碼」的也會收到一封「先前那個有誤」。**
-- ✅ **所以判準是 CASE**:那一欄有值 ⇒ 逐字比;**沒值 ⇒ 回落到今天的時間比較**(行為完全不變)。
-- ⚠️ **混合狀態也對**:最後一封若是 B 之後寄的(有值)⇒ 走逐字;若是 B 之前寄的(NULL)⇒ 回落。
--
-- ═══ rollback ═════════════════════════════════════════════════════════
--   BEGIN;
--   CREATE OR REPLACE VIEW public.pcm_tracking_corrected_email_pending ... (舊定義, 見 20260904220000:359-419)
--   COMMENT ON VIEW public.pcm_tracking_corrected_email_pending IS '<舊 COMMENT 原文>';
--   ALTER TABLE public.email_outbox DROP COLUMN sent_tracking_number;
--   COMMIT;
-- 🛑 **而有一格不可逆**:過渡期間已經寄出去的信收不回來。**rollback 只還原判準, 不還原後果。**
-- ⚠️ **DROP COLUMN 會連 COMMENT 一起消失** ⇒ 上面那句 `COMMENT ON VIEW` 要一起下, 否則
--    view 回到舊定義而 COMMENT 還在講新判準 —— **兩者都是「正確的」, 而合起來是假的。**

BEGIN;

-- ── 前置閘① live 的 view 必須是【第一代】(不是「不存在」)────────────────
--    🔴 「不存在」與「已經是第二代」都不該讓本檔跑下去, 而它們的成因完全不同。
DO $$
DECLARE v_def text;
BEGIN
  IF pg_catalog.to_regclass('public.pcm_tracking_corrected_email_pending') IS NULL THEN
    RAISE EXCEPTION '前置閘①a:view 不存在 ⇒ 20260904220000 沒貼過, 先貼它';
  END IF;
  v_def := pg_catalog.pg_get_viewdef('public.pcm_tracking_corrected_email_pending'::regclass, true);
  IF pg_catalog.strpos(v_def, 'sent_tracking_number') > 0 THEN
    RAISE EXCEPTION '前置閘①b:live 已經是第二代(view 定義裡已有 sent_tracking_number)⇒ 本檔貼過了';
  END IF;
  IF pg_catalog.strpos(v_def, 'sent_at < s.tracking_corrected_at') = 0 THEN
    RAISE EXCEPTION '前置閘①c:live 的 view 不是我預期的第一代(找不到舊判準字面)⇒ 停下來看一眼';
  END IF;
END
$$;

-- ── 前置閘② 那一欄還不存在 ────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
              WHERE attrelid = 'public.email_outbox'::regclass
                AND attname  = 'sent_tracking_number'
                AND NOT attisdropped)
  THEN RAISE EXCEPTION '前置閘②:email_outbox.sent_tracking_number 已存在'; END IF;
END
$$;

-- ── 1. 加欄 ───────────────────────────────────────────────────────────
ALTER TABLE public.email_outbox ADD COLUMN sent_tracking_number text;

COMMENT ON COLUMN public.email_outbox.sent_tracking_number IS
'🔴 **【出門紀錄】—— 這一列的信【實際寄出去】的那個貨運單號。**
它與 `payload` 的分界要寫清楚, 否則下一個人會把它搬進 payload:
  · `payload` = **enqueue 時點**的不可變快照 ⇒ 所以追蹤碼不放那裡(「存了會過期」)
  · 本欄     = **send 時點**的出門紀錄     ⇒ 它描述一件已經發生的事, **不會過期**
⚠️ **只有 order_shipped 與 shipment_tracking_corrected 兩種事件會寫它**, 其餘恆 NULL。
🔴 **NULL 有兩種意思, 而它們在讀端要分開**:①這種事件本來就不寫 ②片 B 上線前的舊列。
   ⇒ 掃描面用 CASE 處理②(沒值就回落到時間比較), 見 pcm_tracking_corrected_email_pending。
🛑 **它不是 PII**(貨運單號不指向人)—— 而這一句是判斷, 不是量測;
   若哪天判定它是 PII, 本表 §⑤ 那條「唯一預期存在的 PII 欄是 recipient_email」要一起改。';

-- ── 2. 掃描面第二代 ───────────────────────────────────────────────────
-- 🔴 **唯一的行為差異在最後那個 CASE。** 其餘每一行與 20260904220000:359-419 逐字相同,
--    刻意不順手改別的 —— 一次只換一個變因, 否則出事時分不出是誰。
CREATE OR REPLACE VIEW public.pcm_tracking_corrected_email_pending
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
  c.email                 AS customer_email
FROM public.shipments s
JOIN public.shipment_items si ON si.shipment_id = s.id
JOIN public.order_items   oi ON oi.id = si.order_item_id
JOIN public.orders         o ON o.id = oi.order_id
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
WHERE s.shipped_at IS NOT NULL
  AND s.deleted_at IS NULL
  AND s.tracking_corrected_at IS NOT NULL
  AND nullif(pg_catalog.btrim(s.tracking_number, public.pcm_js_trim_whitespace()), '') IS NOT NULL
  AND (
        nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
     OR nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      )
  -- 🔴🔴 **【我們最後一次告訴客人的是什麼】** —— 本檔唯一的行為改動。
  --    · 有出門紀錄 ⇒ 逐字比對(它同時解掉「競態」與「改回去」兩個世界)
  --    · 沒有       ⇒ ⛔ ~~回落到舊判準 `sent_at < s.tracking_corrected_at`~~ 那個字面就在下面 ELSE 裡
  AND CASE
        WHEN (
          SELECT last.sent_tracking_number
            FROM public.email_outbox last
           WHERE last.status     = 'sent'
             AND last.sent_at   IS NOT NULL
             AND last.event_type IN ('order_shipped', 'shipment_tracking_corrected')
             AND nullif(last.payload ->> 'shipment_id', '')::uuid = s.id
           -- 🔴 排序帶唯一鍵:同一毫秒兩列時 sent_at 分不出先後, 而「最後一封」必須是確定的。
           ORDER BY last.sent_at DESC, last.id DESC
           LIMIT 1
        ) IS NOT NULL
        THEN (
          SELECT last.sent_tracking_number
            FROM public.email_outbox last
           WHERE last.status     = 'sent'
             AND last.sent_at   IS NOT NULL
             AND last.event_type IN ('order_shipped', 'shipment_tracking_corrected')
             AND nullif(last.payload ->> 'shipment_id', '')::uuid = s.id
           ORDER BY last.sent_at DESC, last.id DESC
           LIMIT 1
        ) IS DISTINCT FROM nullif(pg_catalog.btrim(s.tracking_number, public.pcm_js_trim_whitespace()), '')
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
  AND NOT EXISTS (
        SELECT 1
          FROM public.email_outbox e
         WHERE e.event_type = 'shipment_tracking_corrected'
           AND e.dedup_key  = public.pcm_tracking_corrected_dedup_key(s.id, o.id, s.tracking_corrected_at)
      );

COMMENT ON VIEW public.pcm_tracking_corrected_email_pending IS
'該寄更正單號信的箱(第二代)。
🔴 **第一代用時間比較當代理**(`sent_at < tracking_corrected_at`)—— 而它在
   「寄出之後、寫 sent_at 之前號碼被改」那幾秒會判反, 且對「改回去」失明。
✅ **第二代改問【我們最後一次告訴客人的號碼】是不是還等於現在的號碼。**
⚠️ **過渡期**:`email_outbox.sent_tracking_number` 尚未有人寫入時(片 B 上線前),
   本 view **逐字回落到第一代那個時間比較** ⇒ 行為與今天完全相同。';

-- ── 3. 🔴🔴 字面釘樁(第二代)—— 舊樁的三格全部保留, 再加兩格 ──────────────
-- ⚠️ **射程與第一代相同, 這裡不重複** —— 它防的是【漂移】不是【對手】,
--    而且**只在本檔 apply 的那一刻成立**(下一支重建 view 的 migration 要再釘一次)。
DO $$
DECLARE v_def text;
BEGIN
  v_def := pg_catalog.pg_get_viewdef('public.pcm_tracking_corrected_email_pending'::regclass, true);
  IF pg_catalog.strpos(v_def, 'tracking_corrected_at IS NOT NULL') = 0 THEN
    RAISE EXCEPTION '釘樁①:view 裡找不到「tracking_corrected_at IS NOT NULL」⇒ 沒改過號碼的箱會收到更正信';
  END IF;
  -- 🔴 舊樁②【保留】—— 它現在住在 CASE 的 ELSE 分支裡, 而那個分支就是過渡期的行為。
  IF pg_catalog.strpos(v_def, 'sent_at < s.tracking_corrected_at') = 0 THEN
    RAISE EXCEPTION '釘樁②:回落分支不見了 ⇒ 片 B 上線前每一箱改過號碼的都會收到更正信';
  END IF;
  -- ✅ 新樁③:逐字比對那一半真的在。
  IF pg_catalog.strpos(v_def, 'sent_tracking_number') = 0 THEN
    RAISE EXCEPTION '釘樁③:view 裡找不到 sent_tracking_number ⇒ 第二代判準沒接上, 只剩舊代理';
  END IF;
  -- ✅ 新樁④:那個比較必須是 IS DISTINCT FROM(用 <> 的話 NULL 會讓整條變 NULL ⇒ 該寄的不寄)。
  IF pg_catalog.strpos(v_def, 'IS DISTINCT FROM') = 0 THEN
    RAISE EXCEPTION '釘樁④:找不到 IS DISTINCT FROM ⇒ 有人改成 <> , 而 NULL 會讓那一列靜靜消失';
  END IF;
  -- 🟢 正對照:這把尺在【該找到東西】時真的找得到(否則上面四格恆綠)。
  IF pg_catalog.strpos(v_def, 'shipment_tracking_corrected') = 0 THEN
    RAISE EXCEPTION '釘樁正對照:連 event_type 字面都找不到 ⇒ 這把尺沒接上, 上面四格的通過不算數';
  END IF;
END
$$;

-- ── 4. 事後閘 ─────────────────────────────────────────────────────────
DO $$
BEGIN
  IF pg_catalog.has_table_privilege('anon', 'public.pcm_tracking_corrected_email_pending', 'SELECT')
  THEN RAISE EXCEPTION '事後閘①:anon 讀得到那個含 email 的 view'; END IF;
  IF pg_catalog.has_table_privilege('authenticated', 'public.pcm_tracking_corrected_email_pending', 'SELECT')
  THEN RAISE EXCEPTION '事後閘②:authenticated 讀得到那個含 email 的 view'; END IF;
  -- 🔴 新欄不得讓 anon / authenticated 讀到 —— 它跟著表走, 而表的授權我不在本檔動;
  --    這一格是【回核】不是【設定】:若它紅了, 代表 email_outbox 的授權跟我想的不一樣。
  IF pg_catalog.has_column_privilege('anon', 'public.email_outbox', 'sent_tracking_number', 'SELECT')
  THEN RAISE EXCEPTION '事後閘③:anon 讀得到 email_outbox.sent_tracking_number'; END IF;
  -- 🟢 正對照:service_role 必須讀得到, 否則 sweeper 寫不進去(而上面三格會恆綠)。
  IF NOT pg_catalog.has_column_privilege('service_role', 'public.email_outbox', 'sent_tracking_number', 'SELECT')
  THEN RAISE EXCEPTION '事後閘正對照:service_role 讀不到新欄 ⇒ 上面三格的通過不算數'; END IF;
END
$$;

-- ── 5. 🔴🔴 invoker view 的 EXECUTE 事後斷言(`invoker-view-execute-gate` 逼我補的)──
-- **我第一版漏了這一整段, 而 pre-commit 當場擋下。**
-- 🔴 **為什麼漏得掉**:`security_invoker = true` 的 view **用【查它的人】的權限**跑 body 裡的函式。
--    那幾支函式的 EXECUTE 若被收掉過(本 repo 有一整套 REVOKE 紀律), **view 建得起來、靜態全綠**,
--    而**查它的人一次錯一次** —— 失敗發生在執行期, 不在 apply 期。
-- ✅ **而斷言不是 GRANT**:GRANT 是我寫的動作, **斷言是量到的結果**。這裡只斷言, 不授權 ——
--    若它紅了, 代表授權跟我想的不一樣, 那要停下來看, 不是順手 GRANT 過去。
-- ⚠️ **本段的射程**:它問的是 `service_role`(sweeper 用的角色)。**問錯角色的話這幾格會恆綠** ——
--    那正是那道閘自己說它驗不到的事, 所以下面每一格都把角色寫死在訊息裡, 讓紅的時候看得出問的是誰。
DO $$
BEGIN
  IF NOT pg_catalog.has_function_privilege('service_role',
       'public.pcm_js_trim_whitespace()'::regprocedure, 'EXECUTE')
  THEN RAISE EXCEPTION 'EXECUTE 斷言①:service_role 叫不動 public.pcm_js_trim_whitespace() ⇒ 查本 view 會一次錯一次'; END IF;

  IF NOT pg_catalog.has_function_privilege('service_role',
       'public.pcm_shipped_email_dedup_key(uuid, uuid)'::regprocedure, 'EXECUTE')
  THEN RAISE EXCEPTION 'EXECUTE 斷言②:service_role 叫不動 public.pcm_shipped_email_dedup_key(uuid, uuid)'; END IF;

  IF NOT pg_catalog.has_function_privilege('service_role',
       'public.pcm_tracking_corrected_at_key(timestamptz)'::regprocedure, 'EXECUTE')
  THEN RAISE EXCEPTION 'EXECUTE 斷言③:service_role 叫不動 public.pcm_tracking_corrected_at_key(timestamptz)'; END IF;

  IF NOT pg_catalog.has_function_privilege('service_role',
       'public.pcm_tracking_corrected_dedup_key(uuid, uuid, timestamptz)'::regprocedure, 'EXECUTE')
  THEN RAISE EXCEPTION 'EXECUTE 斷言④:service_role 叫不動 public.pcm_tracking_corrected_dedup_key(uuid, uuid, timestamptz)'; END IF;

  -- 🟢 正對照:這把尺在【該印 false】時真的印 false。
  --    沒有這一格的話, 上面四格在「`has_function_privilege` 對任何東西都回 true」的世界裡恆綠。
  IF pg_catalog.has_function_privilege('anon',
       'public.pcm_tracking_corrected_dedup_key(uuid, uuid, timestamptz)'::regprocedure, 'EXECUTE')
  THEN RAISE EXCEPTION 'EXECUTE 正對照:anon 竟然叫得動 dedup_key ⇒ 要嘛授權漏了, 要嘛上面四格的通過不算數'; END IF;
END
$$;

COMMIT;
