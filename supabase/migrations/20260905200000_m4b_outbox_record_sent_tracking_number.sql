-- 20260905200000_m4b_outbox_record_sent_tracking_number.sql
--
-- ⟦5b-SHIPPEDNUMNOTRECORDED1⟧ 片 A · **草稿, 尚未經 Sean 拍板** —— 留在分支上, 不進 dev。
-- plan:`docs/plans/2026-09-05-shipped-email-records-sent-tracking-plan.md`
--
-- 🔴🔴 **第二版**(2026-09-05 12:xx)。第一版被 codex 判 `FAIL`(18 must-fix + 2 nit),
--    主視窗 `-f8` 裁了五個設計題 + 互補 view 那條。**下面每一節都標它對應哪一條。**
--
-- ══════════════════════════════════════════════════════════════════════
-- 這一支在解什麼
-- ══════════════════════════════════════════════════════════════════════
-- 出貨信 payload **刻意不存**追蹤碼 ⇒ 更正信的掃描面只好拿**時間比較**當代理
-- (`sent_at < tracking_corrected_at`)。而它有兩個世界會判錯:
--   ① **競態**:寄出之後、寫 `sent_at` 之前號碼被改 ⇒ `sent_at > corrected_at` ⇒ 判成「沒收過」⇒ 不寄。
--   ② **改回去**:寄 A → 改 B → 更正信說 B → **又改回 A** ⇒ 「出貨信寄的 <> 現在的」= A<>A 不成立 ⇒ 不寄,
--      而客人手上**最後一封**說的是 B。
-- ✅ **⇒ 要比的是【我們最後一次告訴客人的號碼】與【現在的號碼】。**
-- 🟢 ① 已在 `docs/probes/shipped-tracking-two-connection-race-probe.sh` **實物重現**
--    (第一代判準 `false` / 第二代 `true`, 只差 delay 的對照組會翻面)。
--
-- ══════════════════════════════════════════════════════════════════════
-- 主視窗 2026-09-05 裁的五題 + 一條(逐條對應到下面哪一節)
-- ══════════════════════════════════════════════════════════════════════
--  ① 粒度 = **(shipment_id, order_id) 兩鍵都綁**                      ⇒ §4 的相關子查詢
--  ② 髒 payload = **略過那一列 + 互補 view 讓它數得到**(不擋整張 view)⇒ §3 §5 §6
--  ③ 出貨信**沒帶追蹤號** = 沒告訴過客人任何號碼 ⇒ 記 NULL          ⇒ §2 欄註解 + §4 CASE
--  ④ 排序用 **單調序號**, 不用隨機 UUID                              ⇒ §1 序列 + §4 ORDER BY
--  ⑤ rollback **不 DROP COLUMN**                                     ⇒ 見下面 rollback 那節
--  ＋ 互補 view 照 `pending` / `unsendable` 那個形狀                  ⇒ §5
--
-- 🔴 **④ 的來源是一個量測**:`20260717020000_m4a_email_outbox.sql:298` 逐字
--    `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` ⇒ **那是隨機 UUID, 排序上零判別力**。
--    而這張表**沒有任何單調欄**(`created_at` 是【入列】時間不是【寄出】時間, 且不保證唯一)
--    ⇒ 📌 主視窗裁的「用 outbox 的 bigint id」那個選項**不存在**, 所以走「序列」那條。
--
-- ══════════════════════════════════════════════════════════════════════
-- 🔴🔴 釘樁② —— 訂正一句我先前講錯的話
-- ══════════════════════════════════════════════════════════════════════
-- ⛔ ~~「新 migration 只 CREATE OR REPLACE VIEW ⇒ 下一次重貼舊 migration 會當場炸」~~
-- ✅ **實際更糟, 而它更安靜**:`20260904220000:443-447` 那段註解**自己就寫著** ——
--    「它只在【本檔 apply 的那一刻】成立。之後任何一支 migration 重建這個 view,
--     本釘樁**完全不會知道** ⇒ 那條保護就沒了, 而**沒有東西會叫**。」
--    ⇒ 📌 **重釘不是為了避開一個 RAISE, 是因為不重釘就【沒有人會發現保護不見了】。**
--
-- ══════════════════════════════════════════════════════════════════════
-- 過渡期(片 B 上線前, 兩個新欄全是 NULL)
-- ══════════════════════════════════════════════════════════════════════
-- 🔴 若判準無條件改成逐字比對:`NULL IS DISTINCT FROM 'A'` ⇒ TRUE ⇒ **每一箱改過號碼的都會寄**
--    ⇒ 連「客人從來沒收過那個錯號碼」的也會收到一封「先前那個有誤」。
-- ✅ **所以判準是 CASE**:有出門紀錄 ⇒ 逐字比;**沒有 ⇒ 回落到今天的時間比較**(行為完全不變)。
-- ⚠️ **混合狀態也對**:最後一封若是片 B 之後寄的(有值)⇒ 走逐字;之前寄的(NULL)⇒ 回落。
--
-- ══════════════════════════════════════════════════════════════════════
-- rollback(⑤ 裁定:**不 DROP COLUMN**)
-- ══════════════════════════════════════════════════════════════════════
--   BEGIN;
--   -- ① 只把 view 換回第一代(逐字定義見 20260904220000:359-419)
--   CREATE OR REPLACE VIEW public.pcm_tracking_corrected_email_pending ... ;
--   COMMENT ON VIEW public.pcm_tracking_corrected_email_pending IS '<20260904220000 的原文>';
--   -- ② 互補 view 與 counts 函式可以留著(它們是唯讀的, 留著不影響行為)
--   DROP VIEW IF EXISTS public.pcm_tracking_corrected_payload_unparseable;
--   -- 🔴 counts 那支【不要 DROP】—— 它是【既有】的零參數函式, 本檔只是 CREATE OR REPLACE 加了一個鍵。
--   --    要退的話是把它 REPLACE 回 20260904280000 那一版(逐字定義在那支檔 :66-127),
--   --    而 md5 釘樁的存在就是為了讓「我抄的那一版」與「線上那一版」對得起來。
--   -- ⚠️ 而【不退也可以】:多出來的那一格計數是唯讀的, 留著不影響行為。
--   COMMIT;
-- 🔴🔴 **兩個新欄與那個序列【留著】, 不 DROP** ——
--    片 B 上線之後那一欄裡是**已經寄出去的信實際說了什麼**, 那是**沒有第二個來源的歷史**。
--    DROP 掉再 apply 一次會全部變 NULL ⇒ 歷史列**永久落回舊的盲判準**。
--    ⇒ 📌 **一個為了「乾淨回退」而刪掉的欄, 刪掉的是唯一一份出門紀錄。**
-- 🛑 **而有一格不可逆**:過渡期間已經寄出去的信收不回來。**rollback 只還原判準, 不還原後果。**
-- ⚠️ **`COMMENT ON` 是覆寫不是追加** ⇒ 上面那句 `COMMENT ON VIEW` 要一起下,
--    否則 view 回到第一代而 COMMENT 還在講第二代 —— **兩者各自「正確」, 而合起來是假的。**

BEGIN;

-- ══ 前置閘 ═══════════════════════════════════════════════════════════
DO $$
DECLARE v_def text;
BEGIN
  -- ① view 必須存在, 而且是【第一代】。「不存在」與「已經是第二代」成因完全不同, 分開報。
  IF pg_catalog.to_regclass('public.pcm_tracking_corrected_email_pending') IS NULL THEN
    RAISE EXCEPTION '前置閘①a:view 不存在 ⇒ 20260904220000 沒貼過, 先貼它';
  END IF;
  v_def := pg_catalog.pg_get_viewdef('public.pcm_tracking_corrected_email_pending'::regclass, true);
  IF pg_catalog.strpos(v_def, 'sent_tracking_number') > 0 THEN
    RAISE EXCEPTION '前置閘①b:live 已經是第二代 ⇒ 本檔貼過了';
  END IF;
  IF pg_catalog.strpos(v_def, 'sent_at < s.tracking_corrected_at') = 0 THEN
    RAISE EXCEPTION '前置閘①c:live 的 view 不是我預期的第一代(找不到舊判準字面)⇒ 停下來看一眼';
  END IF;

  -- ② 兩個新欄都還不存在(只有一個存在 = 上一次貼到一半, 那要人看一眼)
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
              WHERE attrelid = 'public.email_outbox'::regclass
                AND attname IN ('sent_tracking_number', 'sent_seq') AND NOT attisdropped)
  THEN RAISE EXCEPTION '前置閘②:email_outbox 已有 sent_tracking_number 或 sent_seq'; END IF;

  -- ③ 序列還不存在
  IF pg_catalog.to_regclass('public.pcm_email_outbox_sent_seq') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘③:序列 pcm_email_outbox_sent_seq 已存在';
  END IF;
END
$$;

-- ══ 1. 單調序號的序列(裁定④)═════════════════════════════════════════
-- 🔴 **為什麼需要它**:見檔頭 —— `email_outbox.id` 是隨機 UUID, 這張表沒有任何單調欄。
--    而「我們最後一次告訴客人什麼」這個問題, **需要一個確定的先後**;
--    靠 `sent_at` 的毫秒在同毫秒兩封時是【賭】, 而它壞掉時是安靜的(挑錯 ⇒ 漏寄或誤寄)。
CREATE SEQUENCE public.pcm_email_outbox_sent_seq;

-- 🔴🔴 **新序列出生就自帶 PUBLIC 的權限** —— 這不是慣例是物理:
--    memory `reference_supabase-...` 與 `docs/patterns/revoking-function-execute-in-supabase.md` 記過
--    「表上兩道 REVOKE 收不到 IDENTITY 另建的 sequence, 而 anon 可 nextval 且 RLS 擋不到」。
--    ⇒ **建完立刻收**, 而下面 §8 有一格事後閘在驗它真的收掉了。
REVOKE ALL ON SEQUENCE public.pcm_email_outbox_sent_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.pcm_email_outbox_sent_seq FROM anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.pcm_email_outbox_sent_seq TO service_role;

COMMENT ON SEQUENCE public.pcm_email_outbox_sent_seq IS
'`email_outbox.sent_seq` 的來源。**寄出當下** `nextval()`, 不是入列當下。
🔴 存在的理由:`email_outbox.id` 是 `gen_random_uuid()` ⇒ 排序上零判別力;
   而 `created_at` 是【入列】時間 —— 用它會在「先入列的後寄出」時給錯答案,
   而那正是本片要修的那種競態。';

-- ══ 2. 兩個新欄 ══════════════════════════════════════════════════════
ALTER TABLE public.email_outbox
  ADD COLUMN sent_tracking_number text,
  ADD COLUMN sent_seq             bigint;

COMMENT ON COLUMN public.email_outbox.sent_tracking_number IS
'🔴 **【出門紀錄】—— 這一列的信【實際寄出去】的那個貨運單號。**
與 `payload` 的分界要寫清楚, 否則下一個人會把它搬進 payload:
  · `payload` = **enqueue 時點**的不可變快照 ⇒ 所以追蹤碼不放那裡(「存了會過期」)
  · 本欄     = **send 時點**的出門紀錄     ⇒ 它描述一件已經發生的事, **不會過期**
⚠️ 只有 `order_shipped` 與 `shipment_tracking_corrected` 兩種事件會寫它, 其餘恆 NULL。
🔴 **NULL 有三種意思, 讀端要分開**(主視窗 2026-09-05 裁③):
   ① 這種事件本來就不寫
   ② 片 B 上線前的舊列(⇒ 掃描面回落到時間比較)
   ③ **那封信寄出去時本來就沒有追蹤號** ⇒ 我們**沒有告訴過客人任何號碼**
      ⇒ 之後第一次有號碼的那封是「**首次告知**」, **不是「更正」**。
🛑 **它不是 PII**(貨運單號不指向人)—— 而這一句是判斷, 不是量測。';

COMMENT ON COLUMN public.email_outbox.sent_seq IS
'寄出順序的單調序號(`pcm_email_outbox_sent_seq` 的 `nextval()`, **寄出當下**取)。
🔴 存在的理由:`id` 是隨機 UUID、`created_at` 是入列時間 ⇒ 兩個都答不出「哪一封比較晚寄」。
⚠️ 片 B 上線前恆 NULL ⇒ 掃描面用 `NULLS LAST` 並回落到時間比較。';

-- ══ 3. 「這個 payload 的 shipment_id 是不是一個合法 UUID」—— 🔴 **定義只寫一份** ═════
-- 主視窗 2026-09-05 裁②:髒 payload **略過那一列**, 不擋整張 view。
-- 🛑 **而 PG 沒有 `try_cast`** —— `'bad'::uuid` 會 raise, 而在 view 裡 raise **會炸掉整張 view**
--    ⇒ 不是略過那一列, 是【所有】該寄的更正信全部掃不到。(codex 抓到的第 2 條 must-fix。)
-- ✅ 所以先做**字面格式檢查**, 通過才 cast。
-- 🔴🔴 **而它必須是【一支具名函式】不是兩處各寫一份正規式** ——
--    主 view 用它「略過」、互補 view 用它「撈出來」, 那是一組**互補集**;
--    而 `20260905040000` 那支檔的註解逐字記過:
--    「互補集的定義若在兩邊各寫一份, 它們遲早不互補。」
-- 🔴🔴 **回傳 uuid 不是 boolean —— 而這一格是 fixture 世界⑧ 當場抓到的。**
-- ⛔ ~~第一版:`pcm_safe_uuid(text) RETURNS boolean`, 然後在 WHERE 裡寫
--    `AND pcm_safe_uuid(x) AND x::uuid = s.id`~~
-- 🛑 **那個守門是【裝飾用的】** —— **PG 不保證 `AND` 的求值順序**, planner 可以把
--    `x::uuid` 排在守門之前 ⇒ 實測(拋棄式 PG, 2026-09-05):
--    `ERROR: invalid input syntax for type uuid: "bad"` ⇒ **整張 view 炸掉, 而不是略過那一列。**
--    ⇒ 📌 **我以為我照裁定②做了「略過」, 而我只是把那個 cast 換了一個位置。**
-- ✅ **改成一支真的 `try_cast`**:合法就回 uuid, 不合法回 NULL。**沒有求值順序可以賭。**
--    (PG 沒有內建 `try_cast`, 所以這一支要自己寫 —— 而第一版就是因為這樣才繞路。)
CREATE FUNCTION public.pcm_safe_uuid(p_text text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
-- 🔵 `STRICT` = 收到 NULL 直接回 NULL, 不進 body。
STRICT
SET search_path = ''
AS $fn$
  -- 8-4-4-4-12 的十六進位, 大小寫都收(PG 的 uuid 型別本身也大小寫都收)。
  SELECT CASE WHEN p_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN p_text::uuid END;
$fn$;

ALTER FUNCTION public.pcm_safe_uuid(text) OWNER TO postgres;

COMMENT ON FUNCTION public.pcm_safe_uuid(text) IS
'「這段字是不是一個合法 UUID 的字面」。**單一事實來源** —— 主掃描面用它略過髒列,
互補面用它撈出髒列;兩者是互補集, 而互補集的定義只能有一份。
🛑 **它只驗【字面格式】** —— 不驗那個 uuid 指到的東西存不存在。
⚠️ `STRICT` ⇒ 餵 NULL 回 NULL(不是 false)⇒ 呼叫端要自己決定 NULL 算哪一邊。';

-- 🔴🔴 **新函式出生就自帶 PUBLIC 的 EXECUTE** —— 這不是慣例是物理
--    (`docs/patterns/revoking-function-execute-in-supabase.md` 全篇在講這件事)。
--    ⇒ **先收再給**, 而 §8-b 有一格在驗它真的收掉了。
-- 🔵 而這一支**純字面判斷、零資料** ⇒ 它被 anon 叫得動不洩漏任何東西。
--    仍然收 —— 📌 **「今天無害」與「明天無害」是兩件事, 而收掉的成本是 0。**
REVOKE ALL ON FUNCTION public.pcm_safe_uuid(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_safe_uuid(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pcm_safe_uuid(text) TO service_role;

-- ══ 4. 掃描面第二代 ═══════════════════════════════════════════════════
-- 🔴 **唯一的行為差異在最後那個 CASE 與它的相關子查詢。** 其餘每一行與
--    `20260904220000:359-419` 逐字相同 —— **一次只換一個變因**, 否則出事時分不出是誰。
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
  -- 🔴🔴 **【我們最後一次告訴這【一張訂單】的收件人什麼】** —— 本檔唯一的行為改動。
  --
  --  裁定① **兩鍵都綁**:一箱可以裝好幾張訂單的品項(`shipment_items → order_items → orders`)。
  --    只綁 shipment 的話:O1 最後收到 B、O2 最後收到 A、現在是 A
  --    ⇒ **一邊漏寄、一邊誤寄**, 而兩者都不會叫。(codex 第 1 條 must-fix。)
  --
  --  裁定② **髒 payload 略過那一列**:`pcm_safe_uuid()` 沒過就當作不匹配,
  --    **不 cast、不 raise** ⇒ 整張 view 活著。那些列在 §5 的互補面看得見。
  --
  --  裁定④ **排序用 `sent_seq`**:`id` 是隨機 UUID, 拿它決勝等於擲骰子。
  --    `NULLS LAST` ⇒ 片 B 上線前那些 NULL 排在後面, 而 CASE 的判斷式本來就會落到回落分支。
  AND CASE
        -- 🔴🔴 **判斷式問的是「片 B 有沒有寫過這一列」, 不是「號碼是不是 NULL」。**
        --    ⛔ ~~原本問 `sent_tracking_number IS NOT NULL`~~ —— **那分不出兩種 NULL**
        --    (codex R2 第 3 條;而它正好打中主視窗裁的③ 我沒真的做到):
        --      ① 片 B 之前的舊列              ⇒ 該回落到時間比較
        --      ② 片 B 寫的, 而【那封信本來就沒帶號碼】⇒ **我們沒告訴過客人任何號碼**
        --    兩者的 `sent_tracking_number` 都是 NULL, 而**下一步完全不同**。
        -- ✅ `sent_seq IS NOT NULL` 就是「片 B 寫過這一列」—— **一欄兩用**(排序 + 出處)。
        WHEN (
          SELECT last.sent_seq
            FROM public.email_outbox last
           WHERE last.status     = 'sent'
             AND last.sent_at   IS NOT NULL
             AND last.event_type IN ('order_shipped', 'shipment_tracking_corrected')
             AND last.order_id   = o.id
             AND public.pcm_safe_uuid(last.payload ->> 'shipment_id') = s.id
           ORDER BY last.sent_seq DESC NULLS LAST, last.sent_at DESC
           LIMIT 1
        ) IS NOT NULL
        THEN (
          SELECT last.sent_tracking_number
            FROM public.email_outbox last
           WHERE last.status     = 'sent'
             AND last.sent_at   IS NOT NULL
             AND last.event_type IN ('order_shipped', 'shipment_tracking_corrected')
             AND last.order_id   = o.id
             AND public.pcm_safe_uuid(last.payload ->> 'shipment_id') = s.id
           ORDER BY last.sent_seq DESC NULLS LAST, last.sent_at DESC
           LIMIT 1
        -- 🔵 而 THEN 這一半仍然比【號碼】。裁定③ 落在這裡:那封信的 `sent_tracking_number`
        --    是 NULL(= 我們沒告訴過他號碼)⇒ `NULL IS DISTINCT FROM 'A'` ⇒ **true ⇒ 寄**
        --    ⇒ 📌 而那一封在客人眼中是【首次告知】不是【更正】—— **文案由片 B 決定, 不在本檔。**
        ) IS DISTINCT FROM nullif(pg_catalog.btrim(s.tracking_number, public.pcm_js_trim_whitespace()), '')
        -- 🔵 回落分支:片 B 上線前(出門紀錄全 NULL)行為與第一代**逐字相同**。
        --    ⚠️ 裁定③ 也落在這裡:那封信寄出時本來就沒有追蹤號 ⇒ 出門紀錄是 NULL
        --      ⇒ 走這一支 ⇒ 而時間比較會判「他收過那封信」⇒ 之後第一次有號碼的那封
        --      **在客人眼中是首次告知** —— 這一格的處置在片 B 的文案, 不在本檔。
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
🔴 第一代用**時間比較**當代理(`sent_at < tracking_corrected_at`)—— 它在
   「寄出之後、寫 sent_at 之前號碼被改」那幾秒判反, 且對「號碼改回去」失明。
✅ 第二代問的是【**我們最後一次告訴這張訂單的收件人的號碼**】是不是還等於現在的號碼。
   粒度是 **(shipment_id, order_id) 兩鍵** —— 一箱可含多張訂單, 只綁箱會一邊漏寄一邊誤寄。
⚠️ **過渡期**:`email_outbox.sent_tracking_number` 尚未有人寫入時(片 B 上線前),
   本 view **逐字回落到第一代那個時間比較** ⇒ 行為與今天完全相同。
🛑 `payload->>''shipment_id''` 不是合法 UUID 的列**被略過**(不 cast, 否則整張 view 會炸)
   ⇒ 那些列在 `pcm_tracking_corrected_payload_unparseable` 看得見, 並被 counts 數到。';

-- ══ 5. 互補面:被略過的那些列(裁定② 的後半)═══════════════════════════
-- 🟢 **形狀照既有的 `pcm_shipped_email_pending` / `pcm_shipped_email_unsendable` 那一對**
--    —— 主面是「該做而沒做的」, 互補面是「**做不了的**」, 分開數的理由:
--    **併起來 = 用一種原因的文案報另一種原因。**
CREATE VIEW public.pcm_tracking_corrected_payload_unparseable
  WITH (security_invoker = true) AS
SELECT
  e.id           AS outbox_id,
  e.order_id     AS order_id,
  e.event_type   AS event_type,
  e.sent_at      AS sent_at,
  -- 🛑 **只印前 64 字元** —— 這一欄的用途是「讓人看得出它壞在哪」, 不是把 payload 端出來。
  pg_catalog.left(e.payload ->> 'shipment_id', 64) AS shipment_id_raw
FROM public.email_outbox e
WHERE e.event_type IN ('order_shipped', 'shipment_tracking_corrected')
  AND e.status   = 'sent'
  AND e.sent_at IS NOT NULL
  -- 🔴 **兩種壞法**:①那個鍵根本不在 payload 裡(`->>` 回 NULL)②在, 而不是合法 UUID。
  --    ⚠️ `pcm_safe_uuid` 是 STRICT ⇒ 餵 NULL 回 NULL ⇒ 這裡要**顯式**把 NULL 算進來。
  -- 🔵 `pcm_safe_uuid` 對「不在」與「不合法」都回 NULL ⇒ 一個 `IS NULL` 同時涵蓋兩種壞法,
  --    而**主面用同一支函式** ⇒ 互補集的定義仍然只有一份。
  AND public.pcm_safe_uuid(e.payload ->> 'shipment_id') IS NULL;

-- 🔴 **少了這一行, 那支 view 誰都讀不到** —— 而姊妹面 `pcm_tracking_corrected_email_pending`
--    授的就是 `service_role`(`20260904220000:431` 逐字)⇒ 照抄, 不發明新角色。
GRANT SELECT ON public.pcm_tracking_corrected_payload_unparseable TO service_role;

COMMENT ON VIEW public.pcm_tracking_corrected_payload_unparseable IS
'已寄出、而 `payload->>''shipment_id''` **不是合法 UUID**(或整個不在)的 outbox 列。
🔴 它們**被主掃描面略過** ⇒ 那些箱的更正信永遠不會被排。**這一面就是讓它們數得到。**
🟢 形狀照 `pcm_shipped_email_pending` / `pcm_shipped_email_unsendable` 那一對。
🛑 **零列不代表健康** —— 它也可能代表「這裡根本沒有已寄出的信」
   ⇒ 所以 `get_tracking_corrected_gap_counts` 帶了分母。';

-- ══ 6. counts —— 🔴 **改既有那支, 不新建** ═══════════════════════════
-- ⛔ ~~另開同形的 `get_tracking_corrected_gap_counts(timestamptz, integer)`~~
-- 🔴🔴 **2026-09-05 訂正:那個做法是錯的, 而它錯得很安靜。**
--    `get_tracking_corrected_gap_counts()`(**零參數**)**已經存在而且已經上線**
--    (`20260904280000_m4b_e4_tracking_corrected_gap_counts.sql`, 帳本已記),
--    而 TS 那側**整條路都接好了**(型別 / adapter / emailPush / 觸發條件)。
--    ⇒ 🛑 **PG 允許多載 ⇒ 新建那支【不會報錯】, 兩支會同時存在, 而沒有人說得出誰是權威。**
--    ⇒ 📌 抓到它的是 TypeScript 的 `Duplicate identifier`, **不是我**。
--
-- 🔴 **而「重打一支上線中的 SECDEF 函式」正是我兩小時前反對過的事** —— 我當時的理由
--    (鐵則 6:重打會靜靜掉註解, 而那在 diff 上與搬移長得一樣)**仍然成立**。
-- ✅ **所以加一道我當時沒想到的保險:`md5(prosrc)` 前置釘樁**(形狀照 `20260905050000`)——
--    **若正式庫那支的內容與我抄的這一版不同, apply 當場 RAISE, 不會靜靜覆蓋。**
--    ⇒ 🎯 **那個反對理由被機制接住了, 不用靠小心。**
-- 🟢 **而 body 是程式逐字搬的, 不是我重打的** —— 搬完驗過「舊 body 的每一行都還在 ⇒ True」。

DO $$
DECLARE v_md5 text;
BEGIN
  IF pg_catalog.to_regprocedure('public.get_tracking_corrected_gap_counts()') IS NULL THEN
    RAISE EXCEPTION '前置閘④a:get_tracking_corrected_gap_counts() 不存在 ⇒ 20260904280000 沒貼過';
  END IF;
  SELECT pg_catalog.md5(p.prosrc) INTO v_md5
    FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.get_tracking_corrected_gap_counts()'::regprocedure;
  IF v_md5 <> 'dd0fa16035e52befaed8e1fc7848bf60' THEN
    RAISE EXCEPTION '前置閘④b:那支函式的 prosrc md5 是 %, 而我抄的那一版是 dd0fa16035e52befaed8e1fc7848bf60 ⇒ 【停下來看一眼】, 不要讓本檔靜靜覆蓋一個我沒讀過的版本', v_md5;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.get_tracking_corrected_gap_counts()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  JS_WS constant text := public.pcm_js_trim_whitespace();
  v_result jsonb;
BEGIN
  -- 🔴 **本支【沒有 cutoff 參數】, 而那與姊妹線不同 —— 不是漏了。**
  --    姊妹線要 cutoff, 因為它們的母體(orders)在功能上線前就存在。
  --    本線的觸發欄 `shipments.tracking_corrected_at` 是片 C 才新增的
  --    ⇒ 歷史上每一箱都是 NULL ⇒ **母體天生從空的開始長。**
  --    ⇒ 📌 而姊妹線那句「NULL 比較 = UNKNOWN ⇒ 恆回 0 = 靜默漏報」在這裡沒有對象可以擋。
  SELECT pg_catalog.jsonb_build_object(
    -- 🔵 **正常會 >0** —— 下一輪 scanner 就排掉了。**不要拿它當告警判準**(那會變成「有更正就叫」)。
    'pending_count',
      (SELECT pg_catalog.count(*) FROM public.pcm_tracking_corrected_email_pending),

    -- 🔴🔴 **告警的主詞。** 單號被更正過、出貨信【在更正之前】已經寄出去(⇒ 客人手上那個號碼是錯的)、
    --    而現在**兩個信箱都空** ⇒ 我們**寄不出那封更正信**, 而它**不會自己好**。
    -- 🛑 條件逐字鏡像掃描 view, 只把「有信箱」那一條**翻過來** ——
    --    ⇒ 兩者是**互補的兩半**, 加起來才是「該通知而還沒通知」的全部。
    'no_recipient_count',
      (SELECT pg_catalog.count(DISTINCT (s.id, o.id))
         FROM public.shipments s
         JOIN public.shipment_items si ON si.shipment_id = s.id
         JOIN public.order_items   oi ON oi.id = si.order_item_id
         JOIN public.orders         o ON o.id = oi.order_id
         LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
        WHERE s.shipped_at IS NOT NULL
          AND s.deleted_at IS NULL
          AND s.tracking_corrected_at IS NOT NULL
          AND NULLIF(pg_catalog.btrim(s.tracking_number, JS_WS), '') IS NOT NULL
          AND NULLIF(pg_catalog.btrim(o.notification_email, JS_WS), '') IS NULL
          AND NULLIF(pg_catalog.btrim(c.email, JS_WS), '') IS NULL
          AND EXISTS (
                SELECT 1 FROM public.email_outbox e0
                 WHERE e0.event_type = 'order_shipped'
                   AND e0.dedup_key  = public.pcm_shipped_email_dedup_key(s.id, o.id)
                   AND e0.status     = 'sent'
                   AND e0.sent_at IS NOT NULL
                   AND e0.sent_at < s.tracking_corrected_at)
          AND NOT EXISTS (
                SELECT 1 FROM public.email_outbox e
                 WHERE e.event_type = 'shipment_tracking_corrected'
                   AND e.dedup_key  = public.pcm_tracking_corrected_dedup_key(
                                        s.id, o.id, s.tracking_corrected_at))),

    -- 🔴🔴 **[2026-09-05 片 A 加的第三格]** 已寄出的信裡 `payload->>'shipment_id'` 壞掉的列。
    --    🎯 **它與上面兩格是【第三種】壞法, 而三者去看的地方都不一樣**:
    --      `pending_count`      = 正常會 >0, 下一輪就排掉了 ⇒ **不要拿它當告警判準**
    --      `no_recipient_count` = 該寄而【兩個信箱都空】     ⇒ 去看那張單的收件資料
    --      本格               = 我們【看不到它該不該寄】   ⇒ **去看 outbox 那一列的 payload**
    --    🛑 **主掃描面【略過】那些列**(不 cast, 否則整張 view 會炸)⇒ 若沒有這一格,
    --      那幾箱的更正信永遠不會被排, 而**每一個既有的計數都會照樣印一個正常的數字**。
    'payload_unparseable_count',
      (SELECT pg_catalog.count(*) FROM public.pcm_tracking_corrected_payload_unparseable),

    -- 🔵 分母。**一個計數沒有分母, 讀的人會自己補一個**(而他補的那個多半是全部)。
    'corrected_shipments_total_count',
      (SELECT pg_catalog.count(*) FROM public.shipments s
        WHERE s.tracking_corrected_at IS NOT NULL AND s.deleted_at IS NULL)
  )
  INTO v_result;
  RETURN v_result;
END
$fn$;

ALTER FUNCTION public.get_tracking_corrected_gap_counts() OWNER TO postgres;

-- 🔵 ACL 不動(既有那支已經設好)—— 而下面 §8 有一格在【回核】它, 不是在設定它。

-- ══ 7. 字面釘樁 ══════════════════════════════════════════════════════
-- ⚠️ **射程與第一代相同, 不重複** —— 它防的是【漂移】不是【對手】(有人加 `OR TRUE` 它照樣過),
--    而且**只在本檔 apply 的那一刻成立**:下一支重建這個 view 的 migration 要**再釘一次**,
--    而它**不會知道**自己沒被釘 ⇒ 見檔頭那段訂正。
DO $$
DECLARE v_def text;
BEGIN
  v_def := pg_catalog.pg_get_viewdef('public.pcm_tracking_corrected_email_pending'::regclass, true);

  IF pg_catalog.strpos(v_def, 'tracking_corrected_at IS NOT NULL') = 0 THEN
    RAISE EXCEPTION '釘樁①:找不到「tracking_corrected_at IS NOT NULL」⇒ 沒改過號碼的箱會收到更正信';
  END IF;

  -- 🔵 舊樁②【保留】—— 它現在住在 CASE 的 ELSE 分支裡, 而那個分支就是過渡期的行為。
  IF pg_catalog.strpos(v_def, 'sent_at < s.tracking_corrected_at') = 0 THEN
    RAISE EXCEPTION '釘樁②:回落分支不見了 ⇒ 片 B 上線前每一箱改過號碼的都會收到更正信';
  END IF;

  IF pg_catalog.strpos(v_def, 'sent_tracking_number') = 0 THEN
    RAISE EXCEPTION '釘樁③:找不到 sent_tracking_number ⇒ 第二代判準沒接上, 只剩舊代理';
  END IF;

  -- 🔴 `<>` 在有 NULL 時整條變 NULL ⇒ 該寄的那一列會靜靜消失。
  -- ⚠️ **訂正(codex R2 第 12 條, nit)**:⛔ ~~「而 NULL 會讓那一列靜靜消失」~~
  --    THEN 那一半的判斷式已經排除了「片 B 沒寫過」的世界, 而**右邊那個現在的號碼**
  --    在 WHERE 上面已經被釘成非空 ⇒ **這裡的 NULL 只剩一種**:那封信本來就沒帶號碼(裁定③)。
  --    ⇒ 📌 `IS DISTINCT FROM` 在這裡守的是**那一種**, 不是「NULL 會讓整條變 NULL」那個泛稱。
  --    🔵 而它仍然要釘 —— 改成 `<>` 之後**裁定③ 那條路會靜靜失效**(`NULL <> 'A'` ⇒ NULL ⇒ 不寄)。
  IF pg_catalog.strpos(v_def, 'IS DISTINCT FROM') = 0 THEN
    RAISE EXCEPTION '釘樁④:找不到 IS DISTINCT FROM ⇒ 有人改成 <>, 而【沒帶號碼那封】會靜靜不寄(裁定③失效)';
  END IF;

  -- 🔴 裁定①:兩鍵都要綁。少了 order_id 那一半 ⇒ 一箱多單時一邊漏寄一邊誤寄。
  IF pg_catalog.strpos(v_def, 'last.order_id = o.id') = 0 THEN
    RAISE EXCEPTION '釘樁⑤:相關子查詢沒有綁 order_id ⇒ 一箱多單時會一邊漏寄一邊誤寄';
  END IF;

  -- 🔴 裁定②:一定要先過格式檢查才 cast, 否則髒列會炸掉整張 view。
  IF pg_catalog.strpos(v_def, 'pcm_safe_uuid') = 0 THEN
    RAISE EXCEPTION '釘樁⑥:找不到 pcm_safe_uuid ⇒ 髒 payload 會 cast 失敗而炸掉整張 view';
  END IF;

  -- 🔴 裁定④:排序要用單調序號。`id DESC` 是隨機 UUID, 等於擲骰子。
  IF pg_catalog.strpos(v_def, 'sent_seq') = 0 THEN
    RAISE EXCEPTION '釘樁⑦:排序沒有用 sent_seq ⇒ 同毫秒兩封時「最後一封」是賭出來的';
  END IF;

  -- 🟢 正對照:這把尺在【該找到東西】時真的找得到 —— 否則上面七格恆綠。
  IF pg_catalog.strpos(v_def, 'shipment_tracking_corrected') = 0 THEN
    RAISE EXCEPTION '釘樁正對照:連 event_type 字面都找不到 ⇒ 這把尺沒接上, 上面七格的通過不算數';
  END IF;
END
$$;

-- ══ 8. 事後閘 ════════════════════════════════════════════════════════
DO $$
BEGIN
  -- ① 兩支 view 都不得讓 anon / authenticated 讀到(它們含 email)
  IF pg_catalog.has_table_privilege('anon', 'public.pcm_tracking_corrected_email_pending', 'SELECT')
  THEN RAISE EXCEPTION '事後閘①a:anon 讀得到主掃描面'; END IF;
  IF pg_catalog.has_table_privilege('authenticated', 'public.pcm_tracking_corrected_email_pending', 'SELECT')
  THEN RAISE EXCEPTION '事後閘①b:authenticated 讀得到主掃描面'; END IF;
  IF pg_catalog.has_table_privilege('anon', 'public.pcm_tracking_corrected_payload_unparseable', 'SELECT')
  THEN RAISE EXCEPTION '事後閘①c:anon 讀得到互補面'; END IF;
  IF pg_catalog.has_table_privilege('authenticated', 'public.pcm_tracking_corrected_payload_unparseable', 'SELECT')
  THEN RAISE EXCEPTION '事後閘①d:authenticated 讀得到互補面'; END IF;

  -- ② 兩個新欄:anon 與 authenticated 都不得讀
  --    🔴 **兩個角色都要問** —— codex 抓到我第一版只問了 anon 而註解宣稱兩個都問。
  IF pg_catalog.has_column_privilege('anon', 'public.email_outbox', 'sent_tracking_number', 'SELECT')
  THEN RAISE EXCEPTION '事後閘②a:anon 讀得到 sent_tracking_number'; END IF;
  IF pg_catalog.has_column_privilege('authenticated', 'public.email_outbox', 'sent_tracking_number', 'SELECT')
  THEN RAISE EXCEPTION '事後閘②b:authenticated 讀得到 sent_tracking_number'; END IF;
  IF pg_catalog.has_column_privilege('anon', 'public.email_outbox', 'sent_seq', 'SELECT')
  THEN RAISE EXCEPTION '事後閘②c:anon 讀得到 sent_seq'; END IF;

  -- ③ 🔴🔴 序列:新序列出生自帶 PUBLIC 權限, 而 §1 收掉了它。這一格驗它真的收掉了。
  IF pg_catalog.has_sequence_privilege('anon', 'public.pcm_email_outbox_sent_seq', 'USAGE')
  THEN RAISE EXCEPTION '事後閘③a:anon 對序列有 USAGE ⇒ 那道 REVOKE 沒生效'; END IF;
  IF pg_catalog.has_sequence_privilege('authenticated', 'public.pcm_email_outbox_sent_seq', 'USAGE')
  THEN RAISE EXCEPTION '事後閘③b:authenticated 對序列有 USAGE'; END IF;

  -- ④ counts 函式不得被 anon / authenticated 叫得動
  -- 🔵 這一格是【回核】不是【設定】—— 那支函式的 ACL 由 20260904280000 設好, 本檔沒動它。
  --    紅了代表那邊的授權跟我想的不一樣, 要停下來看, 不是順手 REVOKE。
  IF pg_catalog.has_function_privilege('anon',
       'public.get_tracking_corrected_gap_counts()'::regprocedure, 'EXECUTE')
  THEN RAISE EXCEPTION '事後閘④:anon 叫得動 counts 函式(它是 SECURITY DEFINER)'; END IF;

  -- 🟢 正對照四格:service_role 必須有 —— 少了它們, 上面每一格在「一律 false」的世界裡恆綠。
  IF NOT pg_catalog.has_column_privilege('service_role', 'public.email_outbox', 'sent_tracking_number', 'SELECT')
  THEN RAISE EXCEPTION '事後閘正對照a:service_role 讀不到 sent_tracking_number ⇒ 上面那些 false 不算數'; END IF;
  IF NOT pg_catalog.has_sequence_privilege('service_role', 'public.pcm_email_outbox_sent_seq', 'USAGE')
  THEN RAISE EXCEPTION '事後閘正對照b:service_role 對序列沒有 USAGE ⇒ 片 B 寫不進去'; END IF;
  -- 🔴🔴 **這一格我原本問 `service_role`, 而重放當場紅了 —— 是【我問錯角色】不是碼錯。**
  --    既有那支 `20260904280000:145` 逐字 `GRANT EXECUTE ... TO payment_confirmer;`
  --    ⇒ 📌 **告警那條路跑的是 `payment_confirmer`(受控窗), 不是 `service_role`。**
  --    🟢 抓到它的是這一格正對照本身 —— 一個問錯角色的斷言, 在【它該綠的世界】裡印紅,
  --      而那正是正對照要做的事。少了它, 我會以為 ACL 跟我想的一樣。
  IF NOT pg_catalog.has_function_privilege('payment_confirmer',
       'public.get_tracking_corrected_gap_counts()'::regprocedure, 'EXECUTE')
  THEN RAISE EXCEPTION '事後閘正對照c:payment_confirmer 叫不動 counts 函式'; END IF;
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.pcm_tracking_corrected_payload_unparseable', 'SELECT')
  THEN RAISE EXCEPTION '事後閘正對照d:service_role 讀不到互補面'; END IF;
END
$$;

-- ══ 8-b. 🔴 收權斷言(照 repo 慣例的 `v_relations` / `v_functions` 陣列)═════════
-- 🛑 **這一段與 §8 的差別要寫出來, 否則下一個人會以為它們重複**:
--    §8 是**逐格手寫**的斷言(每一格帶自己的訊息與正對照);
--    本段是**照 `migration-new-file-static-checks` 認得的形狀**列出本檔新建的物件清單。
--    ⇒ 📌 那道守門防的是「**忘記列**」—— 而它逐字說「它防『忘記收權』, 不防『忘記列』」。
--    ⇒ ⇒ 兩者不是重複:**手寫的那些防我收錯, 這份清單防我漏掉一個物件。**
-- 🔵 **本檔新建的可授權物件正好 2 個**:一支 view + 一支函式。
--    (`get_tracking_corrected_gap_counts()` 是 `CREATE OR REPLACE` **既有**物件 ⇒
--     ACL 是繼承的, 不在本清單裡 —— 那道守門自己的註解也是這樣算的。)
DO $$
DECLARE
  v_relations text[] := ARRAY['pcm_tracking_corrected_payload_unparseable']::text[];
  v_functions text[] := ARRAY['pcm_safe_uuid(text)']::text[];
  v_rel text; v_fn text; v_bad text := '';
BEGIN
  FOREACH v_rel IN ARRAY v_relations LOOP
    IF pg_catalog.has_table_privilege('anon', ('public.' || v_rel)::regclass, 'SELECT') THEN
      v_bad := v_bad || v_rel || '(anon 讀得到) ';
    END IF;
    IF pg_catalog.has_table_privilege('authenticated', ('public.' || v_rel)::regclass, 'SELECT') THEN
      v_bad := v_bad || v_rel || '(authenticated 讀得到) ';
    END IF;
  END LOOP;
  FOREACH v_fn IN ARRAY v_functions LOOP
    -- 🔵 `pcm_safe_uuid` 是**純字面判斷、零資料**(它只看一段字是不是 UUID 格式)
    --    ⇒ 它被 anon 叫得動**不洩漏任何東西**。而這一格仍然斷言它 —— 理由是
    --    📌 **「今天無害」與「明天無害」是兩件事, 而收掉它的成本是 0。**
    IF pg_catalog.has_function_privilege('anon', ('public.' || v_fn)::regprocedure, 'EXECUTE') THEN
      v_bad := v_bad || v_fn || '(anon 叫得動) ';
    END IF;
  END LOOP;
  IF v_bad <> '' THEN
    RAISE EXCEPTION '收權斷言:本檔新建的物件沒有關乾淨 ⇒ %', v_bad;
  END IF;
END $$;

-- ══ 9. 🔴🔴 invoker view 的 EXECUTE 事後斷言 ═══════════════════════════
-- **第一版我漏了這一整段, `invoker-view-execute-gate` 當場擋下。**
-- 🔴 `security_invoker = true` 的 view **用【查它的人】的權限**跑 body 裡的函式。
--    那幾支的 EXECUTE 若被收掉過, **view 建得起來、靜態全綠**, 而**查它的人一次錯一次**
--    —— 失敗發生在執行期, 不在 apply 期。
-- ✅ **而斷言不是 GRANT**:GRANT 是我寫的動作, **斷言是量到的結果**。紅了要停下看, 不是順手 GRANT。
DO $$
BEGIN
  IF NOT pg_catalog.has_function_privilege('service_role',
       'public.pcm_js_trim_whitespace()'::regprocedure, 'EXECUTE')
  THEN RAISE EXCEPTION 'EXECUTE 斷言①:service_role 叫不動 pcm_js_trim_whitespace()'; END IF;

  IF NOT pg_catalog.has_function_privilege('service_role',
       'public.pcm_shipped_email_dedup_key(uuid, uuid)'::regprocedure, 'EXECUTE')
  THEN RAISE EXCEPTION 'EXECUTE 斷言②:service_role 叫不動 pcm_shipped_email_dedup_key(uuid, uuid)'; END IF;

  IF NOT pg_catalog.has_function_privilege('service_role',
       'public.pcm_tracking_corrected_at_key(timestamptz)'::regprocedure, 'EXECUTE')
  THEN RAISE EXCEPTION 'EXECUTE 斷言③:service_role 叫不動 pcm_tracking_corrected_at_key(timestamptz)'; END IF;

  IF NOT pg_catalog.has_function_privilege('service_role',
       'public.pcm_tracking_corrected_dedup_key(uuid, uuid, timestamptz)'::regprocedure, 'EXECUTE')
  THEN RAISE EXCEPTION 'EXECUTE 斷言④:service_role 叫不動 pcm_tracking_corrected_dedup_key(uuid, uuid, timestamptz)'; END IF;

  -- 🔴 本片新加的那一支也要問(第一版沒有它)
  IF NOT pg_catalog.has_function_privilege('service_role',
       'public.pcm_safe_uuid(text)'::regprocedure, 'EXECUTE')
  THEN RAISE EXCEPTION 'EXECUTE 斷言⑤:service_role 叫不動 pcm_safe_uuid(text) ⇒ 查主掃描面會一次錯一次'; END IF;

  -- 🔴 **內建函式也要問**(codex R2 第 9 條)—— `pg_catalog` 的 EXECUTE 預設給 PUBLIC,
  --    **而它收得掉**。收掉之後這支 invoker view 會在執行期整個失敗, 而 apply 期全綠。
  --    ⚠️ 今天踩不到(沒有人收過內建函式的 EXECUTE)⇒ 這是【未來的洞】不是今天的。
  IF NOT pg_catalog.has_function_privilege('payment_confirmer',
       'pg_catalog.btrim(text, text)'::regprocedure, 'EXECUTE')
  THEN RAISE EXCEPTION 'EXECUTE 斷言⑥:payment_confirmer 叫不動 pg_catalog.btrim(text, text) ⇒ 主掃描面會在執行期整個失敗'; END IF;

  IF NOT pg_catalog.has_function_privilege('payment_confirmer',
       'pg_catalog.left(text, integer)'::regprocedure, 'EXECUTE')
  THEN RAISE EXCEPTION 'EXECUTE 斷言⑦:payment_confirmer 叫不動 pg_catalog.left(text, integer) ⇒ 互補面會在執行期整個失敗'; END IF;

  -- 🟢 正對照:這把尺在【該印 false】時真的印 false。
  --    沒有這一格, 上面七格在「has_function_privilege 對任何東西都回 true」的世界裡恆綠。
  IF pg_catalog.has_function_privilege('anon',
       'public.pcm_tracking_corrected_dedup_key(uuid, uuid, timestamptz)'::regprocedure, 'EXECUTE')
  THEN RAISE EXCEPTION 'EXECUTE 正對照:anon 竟然叫得動 dedup_key ⇒ 要嘛授權漏了, 要嘛上面五格不算數'; END IF;
END
$$;

COMMIT;
