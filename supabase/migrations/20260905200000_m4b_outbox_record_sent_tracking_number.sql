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
-- 🔴🔴 **2026-09-05 codex R1 兩條 must-fix 之後重寫 —— 這一段以前是【貼不下去的範例】。**
--   ⛔ ~~`CREATE OR REPLACE VIEW … ;` 帶著一個 `...`~~ ⇒ 那不是 rollback, 是一句「你自己去抄」。
--   🛑 而**要 rollback 的那一刻, 沒有人有心情去抄一支 60 行的 view** ——
--     📌 **一份要在事故當下被使用的東西, 它的驗收條件是【貼得下去】, 不是【讀得懂】。**
--   ⛔ ~~「互補 view 與 counts 函式可以留著」~~ ⇒ **假的**:留著 counts 而 DROP 掉互補 view
--     ⇒ counts 裡那一格仍在 `SELECT … FROM pcm_tracking_corrected_payload_unparseable`
--     ⇒ **回退之後第一次呼叫就 `relation does not exist`** ⇒ 告警整條掛掉。
--
-- 🔵 **逐字可貼的 rollback 放在**:`supabase/rollbacks/20260905200000-rollback.sql`
--    (與本檔同一顆 commit;它自己帶前置閘與後置驗收, 而且**跑過**)。
--    ⇒ 這裡不再抄第二份 —— **抄第二份就會有第二份會過期。**
--
-- 🔴🔴 **兩個新欄與那個序列【留著】, 不 DROP** ——
--    片 B 上線之後那一欄裡是**已經寄出去的信實際說了什麼**, 那是**沒有第二個來源的歷史**。
--    DROP 掉再 apply 一次會全部變 NULL ⇒ 歷史列**永久落回舊的盲判準**。
--    ⇒ 📌 **一個為了「乾淨回退」而刪掉的欄, 刪掉的是唯一一份出門紀錄。**
--    ⇒ ✅ 而「留著之後還能不能重貼」現在由**前置閘②的訂正**保證(見下面), 不再是單行道。
-- 🛑 **而有一格不可逆**:過渡期間已經寄出去的信收不回來。**rollback 只還原判準, 不還原後果。**
-- ⚠️ **`COMMENT ON` 是覆寫不是追加** ⇒ rollback 檔裡的 `COMMENT ON VIEW` 要一起下,
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

  -- ② 兩個新欄:🔴🔴 **2026-09-05 codex R1 must-fix —— 這一格原本讓 rollback 之後【無法重貼】。**
  --    ⛔ ~~原本:任一欄存在就 RAISE~~
  --    🛑 而本檔的 rollback(見檔頭)**刻意保留那兩欄與那個序列**(裡面是沒有第二份的歷史)
  --      ⇒ 📌 **回退之後再貼一次, 一定會撞到這道閘** ⇒ **那個 rollback 是一次性的單行道。**
  --    ✅ 改成:**兩欄要嘛都不在, 要嘛都在**(都在 = 回退後重貼, 那是合法狀態)。
  --      只有一欄在 = 上一次貼到一半 ⇒ 那才是要人看一眼的。
  --      而「已經貼過了」由 ①b 偵測(view 已是第二代)—— **那是唯一一個不會被 rollback 留下的痕跡。**
  --    🔴 **三欄了**(2026-09-05 加了出處旗標)⇒ 合法狀態是 0 或 3。
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public.email_outbox'::regclass
         AND attname IN ('sent_tracking_number', 'sent_seq', 'sent_tracking_recorded')
         AND NOT attisdropped) NOT IN (0, 3)
  THEN RAISE EXCEPTION '前置閘②:email_outbox 的三個新欄不是【全有或全無】⇒ 上一次貼到一半, 停下來看一眼'; END IF;

  -- ②-b 🔴🔴 **欄位【在】不等於欄位【對】**(codex R2 must-fix)。
  --    `ADD COLUMN IF NOT EXISTS` 對一個型別不同的同名欄**靜靜跳過** ——
  --    `sent_seq` 若是 `text`, 排序會變成**字典序**(`'10' < '9'`)⇒ 🛑 「最後一封」長期挑錯,
  --    而每一道釘樁、每一格事後閘、三綠**全部照樣綠**。
  --    ⇒ 📌 **一個型別不合的欄位, 它的錯法是【安靜地換一種排序】。**
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
              WHERE a.attrelid = 'public.email_outbox'::regclass AND NOT a.attisdropped
                AND ((a.attname = 'sent_seq'               AND a.atttypid <> 'pg_catalog.int8'::regtype)
                  OR (a.attname = 'sent_tracking_number'   AND a.atttypid <> 'pg_catalog.text'::regtype)
                  OR (a.attname = 'sent_tracking_recorded' AND a.atttypid <> 'pg_catalog.bool'::regtype)))
  THEN RAISE EXCEPTION '前置閘②-b:某個新欄已經存在而【型別不是我預期的】⇒ 停下來看一眼(IF NOT EXISTS 會靜靜沿用它)'; END IF;

  -- ②-c 🔴 序列若已存在(rollback 留下的), 它的**增量必須是正的**, 而且不能落後既有最大值
  --    ⇒ 否則重貼之後蓋出來的號會**倒著走或重號**, 而排序是它唯一的用途(codex R2 must-fix)。
  IF pg_catalog.to_regclass('public.pcm_email_outbox_sent_seq') IS NOT NULL THEN
    IF (SELECT s.seqincrement FROM pg_catalog.pg_sequence s
         WHERE s.seqrelid = 'public.pcm_email_outbox_sent_seq'::regclass) <= 0
    THEN RAISE EXCEPTION '前置閘②-c:既有序列的增量不是正的 ⇒ 蓋出來的號會倒著走'; END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
                WHERE attrelid = 'public.email_outbox'::regclass
                  AND attname = 'sent_seq' AND NOT attisdropped)
       -- 🔴 `last_value` 是**序列這張關聯的欄位**, 不是 pg_catalog 的函式;
       --    而 `COALESCE` 是**關鍵字**不是函式 ⇒ 兩個都不能加 `pg_catalog.` 前綴。
       --    ⛔ 我第一版兩個都加了 ⇒ `missing FROM-clause entry for table "pg_catalog"`。
       --    🛑 而它**只在【序列已經存在】時才跑得到** ⇒ 從零重播 313 支**永遠碰不到這一行**
       --    ⇒ 📌 抓到它的是【真的跑一次 rollback 再重貼】, 不是任何一次全綠。
       AND (SELECT last_value FROM public.pcm_email_outbox_sent_seq)
           < (SELECT COALESCE(pg_catalog.max(sent_seq), 0) FROM public.email_outbox)
    THEN RAISE EXCEPTION '前置閘②-d:序列落後於欄位裡的最大值 ⇒ 重貼之後會發出重號'; END IF;
  END IF;

  -- ③ 🔴 trigger 與它的函式**必須不存在** —— 它們是 rollback 會清掉的東西
  --    ⇒ 它們在 = 這支真的貼過而 view 卻不是第二代 ⇒ 狀態自相矛盾, 停。
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
              WHERE tgrelid = 'public.email_outbox'::regclass
                AND tgname  = 'pcm_email_outbox_stamp_sent_seq' AND NOT tgisinternal)
  THEN RAISE EXCEPTION '前置閘③:trigger pcm_email_outbox_stamp_sent_seq 已存在, 而 view 不是第二代 ⇒ 狀態自相矛盾'; END IF;
END
$$;

-- ══ 1. 單調序號的序列(裁定④)═════════════════════════════════════════
-- 🔴 **為什麼需要它**:見檔頭 —— `email_outbox.id` 是隨機 UUID, 這張表沒有任何單調欄。
--    而「我們最後一次告訴客人什麼」這個問題, **需要一個確定的先後**;
--    靠 `sent_at` 的毫秒在同毫秒兩封時是【賭】, 而它壞掉時是安靜的(挑錯 ⇒ 漏寄或誤寄)。
-- 🔵 `IF NOT EXISTS`:rollback 刻意留著它 ⇒ 重貼時要能跳過, 而不是炸掉(見前置閘②的訂正)。
CREATE SEQUENCE IF NOT EXISTS public.pcm_email_outbox_sent_seq;

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
-- 🔵 `IF NOT EXISTS`:同上 —— 回退後重貼時這兩欄還在, 而它們裡面是【已經寄出去的信說了什麼】。
ALTER TABLE public.email_outbox
  ADD COLUMN IF NOT EXISTS sent_tracking_number text,
  ADD COLUMN IF NOT EXISTS sent_seq             bigint,
  -- 🔴🔴 **第三欄, 2026-09-05 codex R2 逼出來的 —— 而它推翻了我自己的「一欄兩用」。**
  --    ⛔ ~~`sent_seq IS NOT NULL` 就是「片 B 寫過這一列」~~ ⇒ **裝了 trigger 之後那句話是【假的】**:
  --      trigger 對**每一列**進 sent 的都蓋章, 包括**舊 writer 寫的**(它不寫號碼)。
  --    🛑 而那正好發生在**我們自己指定的部署順序上**(先貼 migration、後上 app):
  --      舊 writer 寄出的信 ⇒ 有 seq、沒號碼 ⇒ 底面判成「片 B 寫的而沒告訴過客人號碼」
  --      ⇒ `NULL IS DISTINCT FROM 'A'` ⇒ **寄一封多餘的更正信給號碼本來就正確的客人。**
  --    ⇒ 📌 **我把「這一列什麼時候進 DB」與「這一列是誰寫的」塞進同一欄, 而那是兩件事。**
  --      裝上 trigger 的那一刻, 第一件事的答案變了, 而第二件事的答案跟著錯。
  -- ✅ 出處由**應用層明確寫**(`markSent` 一定帶它, 連沒有號碼時也帶)⇒ 它答的是「誰寫的」;
  --    `sent_seq` 退回只做**排序**。兩個問題兩個欄位。
  ADD COLUMN IF NOT EXISTS sent_tracking_recorded boolean NOT NULL DEFAULT false;

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
🛑🛑 **而【怎麼分辨這三種】不在這一欄裡** —— 要問 `sent_tracking_recorded`:
   · `recorded = false` ⇒ 是①或② ⇒ **這一列沒有出門紀錄**, 不要拿它下任何結論
   · `recorded = true` 而本欄 NULL ⇒ 是③ ⇒ **我們確實沒告訴過他號碼**
🔴🔴 **過渡期(片 B 的碼上線前)整張表的 `recorded` 都是 `false`** ——
   ⇒ 📌 **任何用「有沒有號碼」當判準的掃描面, 在那段期間會把「全部沒寫過」讀成「全部沒帶號碼」。**
   ⇒ 🎯 而那兩件事的下一步**完全相反**:前者該回落到舊判準, 後者該當成「首次告知」去寄。
   ⚠️ 這句話為什麼寫在 `COMMENT` 而不是交接檔(mail 線 `-1d` 2026-09-06 提):
     **交接檔會不見, 而 `COMMENT` 跟著 schema 走** —— 下一個人是在讀 schema 時撞到這件事的。
🔵 **今天誰不受影響**:取消信那條掃描面(`pcm_cancelled_email_pending`)**不讀這一欄**。
🛑 **它是不是 PII:⛔ ~~不是(貨運單號不指向人)~~ ⇒ 2026-09-05 收窄。**
   plan 那一格自己寫著「這一格請主視窗覆核」, 而 codex R1 覆核的結論是**那句話過度絕對**:
   單號**可以連回訂單、收件地址與物流軌跡** ⇒ 它是**間接識別碼**, 不是與人無關的字串。
   ✅ 所以它照 PII 的規矩走:**不給 anon / authenticated 讀**(§8 事後閘②a/②b 在驗),
     不進日誌、不進對外文案。⚠️ 而「要不要進資料保存期限的清單」**沒有人拍過** —— 已知缺口。';

COMMENT ON COLUMN public.email_outbox.sent_seq IS
'寄出順序的單調序號(`pcm_email_outbox_sent_seq` 的 `nextval()`, **由 trigger 在進 sent 那一刻蓋**)。
🔴 存在的理由:`id` 是隨機 UUID、`created_at` 是入列時間 ⇒ 兩個都答不出「哪一封比較晚寄」。
🛑🛑 **它答的是【排序】, 不是【誰寫的】** —— ⛔ ~~`sent_seq IS NOT NULL` = 片 B 寫過這一列~~
   那句話在裝了 trigger 之後是**假的**:trigger 蓋**每一列**進 sent 的, 包括舊 writer 寫的
   ⇒ 拿它分代 ⇒ 部署窗口裡會**多寄一封更正信給號碼本來就正確的客人**。
   ✅ 分代一律問 `sent_tracking_recorded`。
⚠️ 沒有 seq 的列 = **本 migration 貼進來之前就已經 sent 的** ⇒ 它們一定比較舊
   ⇒ 排序用 `NULLS LAST` 是對的。
🛑 **天花板**:它是【進 DB 的順序】不是【離開我們去 provider 的順序】。多 instance 時可能先寄後寫
   ⇒ 它比 `sent_at`(應用主機時鐘)好, 而**它不是真相**。';

COMMENT ON COLUMN public.email_outbox.sent_tracking_recorded IS
'🔴 **【這一列是不是片 B 的 writer 寫的】** —— 由應用層明確寫, **連號碼是 NULL 時也寫 `true`**。
它與 `sent_tracking_number` 一定成對出現在**同一發 update** 裡。
🛑 **為什麼不能用 `sent_seq` 代替它**:序號由 DB 的 trigger 蓋, 而 trigger 蓋**每一列**進 sent 的
   ⇒ 舊 writer 寫的列也有序號、而沒有號碼 ⇒ 被誤判成「片 B 寫的而我們沒告訴過客人號碼」
   ⇒ **在【先貼 migration、後上碼】那個窗口裡, 每一封舊 writer 寄出的信都會讓那一箱多寄一封更正信。**
   ⇒ 📌 **「這一列什麼時候進 DB」與「這一列是誰寫的」是兩個問題, 不能共用一欄。**
🔵 **預設 `false` 是安全的方向**:既有列全部是 false ⇒ 掃描面回落到舊的時間比較
   ⇒ 行為與本 migration 貼進來之前**逐字相同**。';

-- ══ 2-b. 🔴🔴 **誰去寫 `sent_seq`** —— 一道 trigger, 而**沒有它整片是空的** ═══════
--
-- 🛑🛑 **這一節是 2026-09-05 補的, 而在補它之前【沒有任何東西會寫這一欄】。**
--    抓到它的不是審查, 是我把片 B(`084e7ed9b`)寫完之後回頭讀這支檔:
--    `markSent` 那一發 update 只帶 `sent_tracking_number`, **沒有帶 `sent_seq`** ——
--    ⇒ 那一欄**永遠是 NULL** ⇒ 底面的 `WHEN … sent_seq IS NOT NULL` **永遠不成立**
--    ⇒ 🎯 **整張 view 永遠走回落分支** ⇒ **這支 migration 與這一整片, 行為上等於沒做。**
--    ⇒ 📌 而它**全綠**:三綠會綠、apply 會成功、每一道釘樁都會過、告警印正常的數字。
--      **一個什麼都沒改變的改動, 沒有任何一道現成的閘看得見它。**
--
-- 🔴 **為什麼不是讓應用層寫**:PostgREST 的 update **帶不了 SQL expression**
--    ⇒ `nextval()` 送不進去(codex 2026-09-05 R1 獨立指出同一件事)。
--    而應用層自己 `SELECT nextval` 再送值 = **兩發** ⇒ 中間有窗
--    ⇒ 🛑 **那正是本片要修的那個病的同一種形狀:一個修競態的修法自己帶了一個競態。**
-- ✅ **所以由 DB 蓋章**:`BEFORE UPDATE` trigger, 在**同一發 update** 裡把號碼蓋上去。
--
-- 🛑🛑 **它的天花板要寫在這裡, 不要讓下一個人以為它比實際更強**(codex R1 那條 must-fix):
--    這個號碼是**「這一發 update 進到 DB 的順序」**, **不是「這封信離開我們去 provider 的順序」**。
--    多個 instance 同時在跑時, 完全可能 **A 先寄而 B 先寫** ⇒ 那時它會挑錯「最後一封」。
--    ⇒ 📌 **而那個窗 = provider 回 200 到我們寫 DB 之間**, 以毫秒計;
--      **沒有辦法從我們這一端消掉它** —— 要消掉得由 provider 給一個全域單調的送出序,
--      而 Resend 不給。⇒ ⚠️ **所以本欄是【比 `sent_at` 好】, 不是【正確】。**
--    🔵 而排序主鍵是 `sent_at`(見 §4 釘樁⑧), 本欄只在同刻決勝 ⇒ 天花板的射程又更窄一點。

CREATE OR REPLACE FUNCTION public.pcm_email_outbox_stamp_sent_seq()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
BEGIN
  -- 🔴 只在【第一次進 sent】蓋章。三個條件各擋一種重覆蓋:
  --    · `NEW.status = 'sent'`               ⇒ 別的狀態轉換不蓋
  --    · `OLD.status IS DISTINCT FROM 'sent'` ⇒ 已經是 sent 的列再被 update 不會重蓋
  --    · `NEW.sent_seq IS NULL`               ⇒ 呼叫端若自己帶了值, 尊重它(而今天沒有人會帶)
  --    🛑 重蓋的後果不是「多一個號碼」, 是**同一封信在時間軸上往前跳** ⇒ 它會被誤判成最後一封。
  -- 🔴 **INSERT 也要蓋**(codex R2 must-fix):`service_role` 可以直接 INSERT 一列 `status='sent'`
  --    ⇒ 只掛 UPDATE 的話那一列**永遠沒有 seq** ⇒ 它在排序上靜靜落到最後面。
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'sent' THEN
      NEW.sent_seq := pg_catalog.nextval('public.pcm_email_outbox_sent_seq'::pg_catalog.regclass);
    END IF;
    RETURN NEW;
  END IF;
  -- 🔵 **INSERT 這一支也是無條件覆寫** —— 與 UPDATE 一致, 沒有「呼叫端自己帶值」的後門。
  --    ⚠️ **代價**:要造一列「migration 之前就 sent 的舊列」(seq 為 NULL)時,
  --      不能靠 INSERT 帶 NULL —— 要 **INSERT 完再一發 `UPDATE … SET sent_seq = NULL`**
  --      (那一發不會重蓋, 因為 `OLD.status` 已經是 `sent`)。fixture 就是這樣做的。

  -- 🔴 **只在【進入 sent 的那一刻】蓋**, 而蓋的時候**無條件覆寫**。
  --    ⛔ ~~`AND NEW.sent_seq IS NULL`~~ ⇒ 呼叫端自己帶一個值就能繞過蓋章(codex R2 must-fix)。
  --    🔵 `OLD.status IS DISTINCT FROM 'sent'` 這一條同時做兩件事:
  --      · 已經是 sent 的列再被 update(改 request_id 之類)⇒ **不重蓋**
  --        (重蓋的後果不是多一個號, 是那封信在時間軸上往前跳 ⇒ 被誤判成最後一封)
  --      · 而 `sent → failed → sent`(真的重寄一次)⇒ **會重蓋, 而那是對的**:
  --        它真的是比較晚寄出去的那一封。
  IF NEW.status = 'sent' AND OLD.status IS DISTINCT FROM 'sent' THEN
    NEW.sent_seq := pg_catalog.nextval('public.pcm_email_outbox_sent_seq'::pg_catalog.regclass);
  END IF;
  RETURN NEW;
END
$fn$;

ALTER FUNCTION public.pcm_email_outbox_stamp_sent_seq() OWNER TO postgres;

-- 🔵 **刻意【不是】SECURITY DEFINER** —— 它以呼叫者的身分取 nextval。
--    §1 已經 `GRANT USAGE ON SEQUENCE … TO service_role` ⇒ 寫信那條路過得了。
--    ⇒ 🎯 **而若哪天換了一個沒有 USAGE 的角色來寫, 那一發 update 會【當場報錯】** ——
--      那是 fail-loud。改成 DEFINER 的話它會靜靜蓋成功, 而我們就再也不知道有人繞過了授權。
REVOKE ALL ON FUNCTION public.pcm_email_outbox_stamp_sent_seq() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_email_outbox_stamp_sent_seq() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pcm_email_outbox_stamp_sent_seq() TO service_role;

CREATE TRIGGER pcm_email_outbox_stamp_sent_seq
  BEFORE INSERT OR UPDATE ON public.email_outbox
  FOR EACH ROW
  EXECUTE FUNCTION public.pcm_email_outbox_stamp_sent_seq();

COMMENT ON FUNCTION public.pcm_email_outbox_stamp_sent_seq() IS
'在「這一列第一次變成 sent」的那一發 update 裡蓋上 `sent_seq`。
🔴 **不是應用層寫的** —— PostgREST 的 update 帶不了 `nextval()`;應用層分兩發寫會再造一個競態。
🛑 **天花板**:它是【進 DB 的順序】不是【離開我們的順序】。多 instance 時可能先寄後寫。
   ⇒ 它比 `sent_at` 好(同毫秒不會賭), 而**它不是真相**。';

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
CREATE OR REPLACE FUNCTION public.pcm_safe_uuid(p_text text)
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
-- 🔴🔴 **2026-09-05 codex R1 之後改了結構:規則住在【一支底面 view】, 兩個消費者各自加一半條件。**
--
-- ⛔ ~~原本:主 view 裡一份規則, `get_tracking_corrected_gap_counts()` 的
--    `no_recipient_count` 裡【另一份】規則(而它還停在第一代的時間比較)~~
-- 🛑 codex 抓到的失效:**競態發生 + 那張單兩個信箱都空 ⇒ 主 view 與告警【一起】漏掉它。**
--    ⇒ 而兩者宣稱是互補的兩半 ⇒ 📌 **互補集的定義在兩邊各寫一份, 它們遲早不互補**
--      —— 那句話**本檔自己在 §3 就寫過了**, 而我在 §6 違反了它。
-- ✅ 改法:
-- ```
--   pcm_tracking_correction_candidates   ← 規則的【唯一一份】(不管有沒有收件人)
--        ├─ 有收件人 ⇒ pcm_tracking_corrected_email_pending(要寄的)
--        └─ 沒收件人 ⇒ no_recipient_count(寄不出去的, 要有人去看那張單)
-- ```
--   ⇒ 🎯 **兩半的和恆等於底面** —— 而那是一個**結構上的保證**, 不是一句註解。
-- 🔵 兩個消費者的條件互為否定(`(A OR B)` vs `NOT A AND NOT B`), 而**空白定義用同一支函式**
--   ⇒ 「只有 tab 的信箱」不會兩邊都算到(那正是第一代 codex must-fix #1 的病)。

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
  -- 🛑 **這裡【刻意沒有】收件人條件** —— 它是兩個消費者各自加的那一半。
  --
  -- 🔴🔴 **【我們最後一次告訴這【一張訂單】的收件人什麼】** —— 本檔唯一的行為改動。
  --
  --  裁定① **兩鍵都綁**:一箱可以裝好幾張訂單的品項(`shipment_items → order_items → orders`)。
  --    只綁 shipment 的話:O1 最後收到 B、O2 最後收到 A、現在是 A
  --    ⇒ **一邊漏寄、一邊誤寄**, 而兩者都不會叫。(codex 第 1 條 must-fix。)
  --
  --  裁定② **髒 payload 略過那一列**:`pcm_safe_uuid()` 沒過就當作不匹配,
  --    **不 cast、不 raise** ⇒ 整張 view 活著。那些列在 §5 的互補面看得見。
  --
  --  裁定④ **同刻決勝用 `sent_seq`** —— 而**排序的主鍵是 `sent_at`**, 見下面那段訂正。
  AND CASE
        -- 🔴🔴 **判斷式問的是「片 B 有沒有寫過這一列」, 不是「號碼是不是 NULL」。**
        --    ⛔ ~~原本問 `sent_tracking_number IS NOT NULL`~~ —— **那分不出兩種 NULL**
        --    (codex R2 第 3 條;而它正好打中主視窗裁的③ 我沒真的做到):
        --      ① 片 B 之前的舊列              ⇒ 該回落到時間比較
        --      ② 片 B 寫的, 而【那封信本來就沒帶號碼】⇒ **我們沒告訴過客人任何號碼**
        --    兩者的 `sent_tracking_number` 都是 NULL, 而**下一步完全不同**。
        -- ✅ `sent_seq IS NOT NULL` 就是「片 B 寫過這一列」—— **一欄兩用**(排序 + 出處)。
        --
        -- 🔴🔴 **排序鍵 2026-09-05 換了主從(codex R1「rolling deploy」那條 must-fix)**:
        -- ⛔ ~~`ORDER BY last.sent_seq DESC NULLS LAST, last.sent_at DESC`~~
        --    🛑 **那個順序在【滾動部署】期間會挑錯**:新舊 writer 同時在跑幾分鐘,
        --      新 writer 寫的列有 seq、舊 writer 寫的沒有 ⇒ `NULLS LAST` 讓**有 seq 的永遠排前面**
        --      ⇒ 即使**舊 writer 那封是後來才寄的**, 也會被判成「不是最後一封」。
        -- ✅ **改成 `sent_at` 當主鍵、`sent_seq` 只當同刻決勝**:
        --    · 混合狀態 ⇒ 由**兩邊都有的** `sent_at` 決定先後 ⇒ 順序是對的
        --    · 同毫秒   ⇒ 才輪到 `sent_seq`(而 `id` 是隨機 UUID, 拿它決勝等於擲骰子)
        --    · 過渡期最上面那列若是舊 writer 寫的(seq 為 NULL)⇒ 走回落分支
        --      ⇒ 🎯 **那是【今天的行為】, 也就是安全的那個方向。**
        --
        -- 🔴🔴 **2026-09-05 codex R2:判斷式從 `sent_seq IS NOT NULL` 改成問【出處旗標】。**
        --    ⛔ ~~`sent_seq IS NOT NULL` 就是「片 B 寫過這一列」~~ —— 裝了 trigger 之後**它是假的**
        --      (trigger 對每一列進 sent 的都蓋, 包括舊 writer 的)⇒ 見那一欄的註解。
        -- 🔴🔴 **而排序也跟著改回 `sent_seq` 當主鍵。**
        --    ⛔ ~~`ORDER BY last.sent_at DESC, last.sent_seq DESC NULLS LAST`~~
        --    當時換成 `sent_at` 的理由是「滾動部署期間舊 writer 的列沒有 seq」——
        --    🛑 **而那個理由被 trigger 推翻了**:trigger 裝上去之後, **每一列進 sent 的都有 seq**
        --      ⇒ 沒有 seq 的列**一定是 migration 之前就 sent 的** ⇒ 它們**一定比較舊**
        --      ⇒ `NULLS LAST` 把它們排後面**正是對的**。
        --    ✅ 而 `sent_seq` 比 `sent_at` 好:`sent_at` 是**應用主機的時鐘**, 兩台機器有偏差時
        --      後寄的信可以拿到比較早的 `sent_at`(codex R2 must-fix)。序列沒有時鐘。
        WHEN (
          SELECT last.sent_tracking_recorded
            FROM public.email_outbox last
           WHERE last.status     = 'sent'
             AND last.sent_at   IS NOT NULL
             AND last.event_type IN ('order_shipped', 'shipment_tracking_corrected')
             AND last.order_id   = o.id
             AND public.pcm_safe_uuid(last.payload ->> 'shipment_id') = s.id
           ORDER BY last.sent_seq DESC NULLS LAST, last.sent_at DESC
           LIMIT 1
        ) IS TRUE
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

-- 🔴 **先收再給** —— 新 view 出生就帶著 default privileges(本 repo 記過:「新物件出生自帶 anon 權限」)。
--    ⛔ 我第一版對 §5 那支只寫了 GRANT 沒寫 REVOKE(codex R1 must-fix)⇒ 後置閘會讓整支 migration 回滾。
REVOKE ALL ON public.pcm_tracking_correction_candidates FROM PUBLIC;
REVOKE ALL ON public.pcm_tracking_correction_candidates FROM anon, authenticated;
GRANT SELECT ON public.pcm_tracking_correction_candidates TO service_role;

COMMENT ON VIEW public.pcm_tracking_correction_candidates IS
'該寄更正單號信的箱 —— **不管寄不寄得出去**(規則的唯一一份)。
🔴 兩個消費者各自加一半條件, 而那兩半互為否定:
   · 有收件人 ⇒ `pcm_tracking_corrected_email_pending`(要寄的)
   · 沒收件人 ⇒ `get_tracking_corrected_gap_counts()` 的 `no_recipient_count`(寄不出去、要人去看的)
🎯 **兩半的和恆等於本面** —— 這是結構上的保證, 不是一句註解。
⚠️ 本面**沒有**收件人條件;拿它當「要寄幾封」會**多算**寄不出去的那些。';

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
  v.customer_email
FROM public.pcm_tracking_correction_candidates v
-- 🔴 這一半 = 「寄得出去」。空白定義走 `pcm_js_trim_whitespace()` 單一來源, 不用裸 `btrim`
--    (第一代 codex must-fix #1:裸 btrim 只吃空格, 而計數面吃 tab/換行 ⇒ 兩邊都算到同一列)。
WHERE nullif(pg_catalog.btrim(v.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
   OR nullif(pg_catalog.btrim(v.customer_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL;

COMMENT ON VIEW public.pcm_tracking_corrected_email_pending IS
'該寄更正單號信的箱(第二代)。
🔴 第一代用**時間比較**當代理(`sent_at < tracking_corrected_at`)—— 它在
   「寄出之後、寫 sent_at 之前號碼被改」那幾秒判反, 且對「號碼改回去」失明。
✅ 第二代問的是【**我們最後一次告訴這張訂單的收件人的號碼**】是不是還等於現在的號碼。
   粒度是 **(shipment_id, order_id) 兩鍵** —— 一箱可含多張訂單, 只綁箱會一邊漏寄一邊誤寄。
🔴🔴 **規則不住在這裡** —— 它住在 `pcm_tracking_correction_candidates`, 本面只加「有收件人」那一半。
   ⇒ 📌 要改判準去改那一支;在這裡加條件會讓它與 `no_recipient_count` 再度不互補。
⚠️ **過渡期**:`email_outbox.sent_seq` 尚未有人寫入時(片 B 上線前),
   底面**逐字回落到第一代那個時間比較** ⇒ 行為與今天完全相同。
🛑 `payload->>''shipment_id''` 不是合法 UUID 的列在判「最後告知」時**被略過**
   ⇒ 那些列在 `pcm_tracking_corrected_payload_unparseable` 看得見, 並被 counts 數到。';

-- ══ 5. 互補面:被略過的那些列(裁定② 的後半)═══════════════════════════
-- 🟢 **形狀照既有的 `pcm_shipped_email_pending` / `pcm_shipped_email_unsendable` 那一對**
--    —— 主面是「該做而沒做的」, 互補面是「**做不了的**」, 分開數的理由:
--    **併起來 = 用一種原因的文案報另一種原因。**
CREATE OR REPLACE VIEW public.pcm_tracking_corrected_payload_unparseable
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

-- 🔴🔴 **先收再給**(codex R1 must-fix:我第一版只有 GRANT)——
--    新 view 出生就帶 Supabase 的 default privileges ⇒ **只 GRANT 不 REVOKE 的話**
--    下面 §8 事後閘①c/①d 會抓到 anon 讀得到, 而**那會讓整支 migration 回滾**。
--    ⇒ 📌 那道閘是對的, 錯的是我少寫兩行。本 repo 記過:「新物件出生就自帶 anon 權限」。
REVOKE ALL ON public.pcm_tracking_corrected_payload_unparseable FROM PUBLIC;
REVOKE ALL ON public.pcm_tracking_corrected_payload_unparseable FROM anon, authenticated;
-- 🔴 **少了這一行, 那支 view 誰都讀不到** —— 而姊妹面 `pcm_tracking_corrected_email_pending`
--    授的就是 `service_role`(`20260904220000:431` 逐字)⇒ 照抄, 不發明新角色。
GRANT SELECT ON public.pcm_tracking_corrected_payload_unparseable TO service_role;

COMMENT ON VIEW public.pcm_tracking_corrected_payload_unparseable IS
'已寄出、而 `payload->>''shipment_id''` **不是合法 UUID**(或整個不在)的 outbox 列。
🔴 它們在判「我們最後一次告訴客人什麼」時**被略過** ⇒ **我們看不到那封信說了什麼。**
⛔ ~~那些箱的更正信永遠不會被排~~ —— 🔴 **2026-09-05 codex R1 訂正:那句話是【錯的】。**
   被略過的是**那一列**, 不是那一箱:同一箱若還有別的乾淨列, 它照樣被判;
   一列都沒有時**落到回落分支**(時間比較)⇒ **那一箱仍然可能被排**
   —— 而 `scripts/sent-tracking-three-worlds.sql` 的 fixture 逐字證了這件事(`WRDB22` 仍進主面)。
   ⇒ 🛑 **而我照著那句錯話寫了告警文案** ⇒ 一個**永久假陽性**:
     它天天說「這些信永遠不會被排」, 而它們其中一些正在被排。
✅ **正確的語意**:本面是一個**資料品質**訊號 —— 「有信寄出去了, 而我們讀不出它是哪一箱的」。
   它**不預測**那一箱會不會被排;要知道那個, 去看主面。
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
  -- 🔴🔴 **兩個 md5 都收 —— 而它們是【兩個不同的狀態】, 不是放寬。**
  --    · `dd0fa160…` = `20260904280000` 那一版(第一次貼本檔時線上的樣子)
  --    · `7b227290…` = **本檔自己裝上去的那一版**(2026-09-05 拋棄式 PG 實測值)
  --      ⇒ 它出現的時機只有一個:**本檔貼過、然後被 rollback 過**
  --        (rollback 刻意留著 counts —— 刪掉它會弄壞一個仍在被呼叫的函式)。
  --    🛑 **少了第二個, 「rollback 之後可以重貼」那條 must-fix 只修了一半** ——
  --      前置閘② 放行了, 而這一格照樣擋住(2026-09-05 實測:真的跑一次 rollback 再重貼才看到)。
  --    ⇒ 📌 這道樁守的是「**不要覆蓋一個我沒讀過的版本**」, 而**本檔自己的產物是我讀過的**。
  --    ⚠️ 而第二個值是**自我指涉**的:動了下面那支函式的 body ⇒ **這個字面要重量一次**。
  --      量法:`SELECT md5(prosrc) FROM pg_proc WHERE oid='public.get_tracking_corrected_gap_counts()'::regprocedure`
  IF v_md5 NOT IN ('dd0fa16035e52befaed8e1fc7848bf60',   -- 20260904280000 那一版
                   '7b227290dfb34485c63d24587a39bcb6')  -- 本檔自己裝的那一版(rollback 後重貼)
  THEN
    RAISE EXCEPTION '前置閘④b:那支函式的 prosrc md5 是 %, 而我認得的兩版是 dd0fa160… / 7b227290… ⇒ 【停下來看一眼】, 不要讓本檔靜靜覆蓋一個我沒讀過的版本', v_md5;
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
      -- 🔴🔴 **2026-09-05 codex R1 must-fix:這一格【曾經停在第一代的判準】。**
      -- ⛔ ~~這裡原本自己抄了一份 WHERE:`EXISTS(... e0.sent_at < s.tracking_corrected_at)`~~
      --    🛑 而主 view 已經換成「最後一次告訴客人的號碼」⇒ **兩邊的規則不一樣了**:
      --      競態發生(寄出後、寫 sent_at 前號碼被改)**而且**那張單兩個信箱都空
      --      ⇒ 主 view 看不到它(它沒有收件人), 這一格也看不到它(它用舊判準)
      --      ⇒ 📌 **兩個互補的一半【一起】漏掉同一列, 而互補的意思正好是不該發生這件事。**
      -- ✅ 改成:**直接讀底面**, 只加「兩個信箱都空」那一半。
      --    ⇒ 🎯 規則從此只有一份 ⇒ **主 view 換判準時這一格自動跟著換**, 不靠人記得改兩處。
      -- 🔵 `count(*)` 就夠 —— 底面已經 `SELECT DISTINCT`, 而那組欄位對 (shipment_id, order_id)
      --    是函數相依 ⇒ 一組一列。(舊版寫 `count(DISTINCT (s.id, o.id))` 是因為它自己 join 出重複列。)
      (SELECT pg_catalog.count(*)
         FROM public.pcm_tracking_correction_candidates v
        WHERE NULLIF(pg_catalog.btrim(v.notification_email, JS_WS), '') IS NULL
          AND NULLIF(pg_catalog.btrim(v.customer_email, JS_WS), '') IS NULL),

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

-- 🔴🔴 **`CREATE OR REPLACE FUNCTION` 【不會】換掉 COMMENT**(codex R2 nit)——
--    不重下的話, 資料庫上那句註解仍然說它只回三個 key、而且 `no_recipient_count` 是舊語意。
--    ⇒ 📌 **一支函式與它的說明各自「正確」, 而合起來是假的** —— 本檔檔頭對 view 記過同一句。
COMMENT ON FUNCTION public.get_tracking_corrected_gap_counts() IS
'更正單號信線的缺口計數(**四個 key**)。2026-09-05 由 20260905200000 換上第二代語意。
· `pending_count`                    該寄而還沒排的(**正常會 >0**, 下一輪就排掉了 ⇒ 不要拿它當告警判準)
· `no_recipient_count`               🔴 該寄而**兩個信箱都空** ⇒ 寄不出去, 要人去看那張單
· `payload_unparseable_count`        已寄出的信裡 `payload->>''shipment_id''` 讀不出來的列(資料品質)
· `corrected_shipments_total_count`  分母(**一個計數沒有分母, 讀的人會自己補一個**)
🔴 **前兩格是【互補的兩半】, 而它們讀同一支底面** `pcm_tracking_correction_candidates`:
   有收件人 ⇒ 進 `pcm_tracking_corrected_email_pending`;沒有 ⇒ 進 `no_recipient_count`。
   ⇒ 🎯 **兩半的和恆等於底面** —— 那是結構上的保證, 不是一句註解。
   ⛔ ~~本函式曾經自己抄一份判準, 而它停在第一代的時間比較~~(2026-09-05 codex R1 抓到)。
⚠️ 本支**沒有 cutoff 參數**, 而那與姊妹線不同 —— 不是漏了(觸發欄是新加的, 母體天生從空的開始長)。';

-- 🔵 ACL 不動(既有那支已經設好)—— 而下面 §8 有一格在【回核】它, 不是在設定它。

-- ══ 7. 字面釘樁 ══════════════════════════════════════════════════════
-- ⚠️ **射程與第一代相同, 不重複** —— 它防的是【漂移】不是【對手】(有人加 `OR TRUE` 它照樣過),
--    而且**只在本檔 apply 的那一刻成立**:下一支重建這些 view 的 migration 要**再釘一次**,
--    而它**不會知道**自己沒被釘 ⇒ 見檔頭那段訂正。
-- 🔴🔴 **2026-09-05 改結構之後, 這些樁要釘在【底面】上** —— 規則搬家了, 而
--    **樁若還釘在主面, 它們會全部找不到而集體 RAISE**(那是好的失敗);
--    🛑 **真正危險的是相反的那種**:把樁改成寬鬆到兩邊都過 ⇒ 它就再也不看規則了。
DO $$
DECLARE v_base text; v_top text;
BEGIN
  v_base := pg_catalog.pg_get_viewdef('public.pcm_tracking_correction_candidates'::regclass, true);
  v_top  := pg_catalog.pg_get_viewdef('public.pcm_tracking_corrected_email_pending'::regclass, true);

  IF pg_catalog.strpos(v_base, 'tracking_corrected_at IS NOT NULL') = 0 THEN
    RAISE EXCEPTION '釘樁①:找不到「tracking_corrected_at IS NOT NULL」⇒ 沒改過號碼的箱會收到更正信';
  END IF;

  -- 🔵 舊樁②【保留】—— 它現在住在 CASE 的 ELSE 分支裡, 而那個分支就是過渡期的行為。
  IF pg_catalog.strpos(v_base, 'sent_at < s.tracking_corrected_at') = 0 THEN
    RAISE EXCEPTION '釘樁②:回落分支不見了 ⇒ 片 B 上線前每一箱改過號碼的都會收到更正信';
  END IF;

  IF pg_catalog.strpos(v_base, 'sent_tracking_number') = 0 THEN
    RAISE EXCEPTION '釘樁③:找不到 sent_tracking_number ⇒ 第二代判準沒接上, 只剩舊代理';
  END IF;

  -- 🔴 `<>` 在有 NULL 時整條變 NULL ⇒ 該寄的那一列會靜靜消失。
  -- ⚠️ **訂正(codex R2 第 12 條, nit)**:⛔ ~~「而 NULL 會讓那一列靜靜消失」~~
  --    THEN 那一半的判斷式已經排除了「片 B 沒寫過」的世界, 而**右邊那個現在的號碼**
  --    在 WHERE 上面已經被釘成非空 ⇒ **這裡的 NULL 只剩一種**:那封信本來就沒帶號碼(裁定③)。
  IF pg_catalog.strpos(v_base, 'IS DISTINCT FROM') = 0 THEN
    RAISE EXCEPTION '釘樁④:找不到 IS DISTINCT FROM ⇒ 有人改成 <>, 而【沒帶號碼那封】會靜靜不寄(裁定③失效)';
  END IF;

  -- 🔴 裁定①:兩鍵都要綁。少了 order_id 那一半 ⇒ 一箱多單時一邊漏寄一邊誤寄。
  IF pg_catalog.strpos(v_base, 'last.order_id = o.id') = 0 THEN
    RAISE EXCEPTION '釘樁⑤:相關子查詢沒有綁 order_id ⇒ 一箱多單時會一邊漏寄一邊誤寄';
  END IF;

  -- 🔴 裁定②:一定要先過格式檢查才 cast, 否則髒列會炸掉整張 view。
  IF pg_catalog.strpos(v_base, 'pcm_safe_uuid') = 0 THEN
    RAISE EXCEPTION '釘樁⑥:找不到 pcm_safe_uuid ⇒ 髒 payload 會 cast 失敗而炸掉整張 view';
  END IF;

  -- 🔴 裁定④:同刻要有決勝鍵。
  IF pg_catalog.strpos(v_base, 'sent_seq') = 0 THEN
    RAISE EXCEPTION '釘樁⑦:排序沒有用 sent_seq ⇒ 同毫秒兩封時「最後一封」是賭出來的';
  END IF;

  -- 🔴🔴 **釘樁⑧**:排序主鍵必須是 `sent_seq`(`sent_at` 只同刻決勝)。
  --    ⛔ ~~本樁一度反過來釘 `sent_at` 當主鍵~~ —— 當時的理由是「舊 writer 沒有 seq」,
  --    🛑 而**裝了 trigger 之後每一列進 sent 的都有 seq** ⇒ 沒有 seq 的一定比較舊
  --      ⇒ `NULLS LAST` 正確;而 `sent_at` 是**應用主機的時鐘**, 兩台有偏差時會排反(codex R2)。
  IF pg_catalog.strpos(v_base, 'ORDER BY last.sent_seq DESC NULLS LAST, last.sent_at DESC') = 0 THEN
    RAISE EXCEPTION '釘樁⑧:排序主鍵不是 sent_seq ⇒ 兩台機器時鐘有偏差時「最後一封」會排反';
  END IF;

  -- 🔴🔴 **釘樁⑩(新)**:分代必須問【出處旗標】, 不是問 `sent_seq` 在不在。
  --    🛑 改回問 seq ⇒ **舊 writer 寫的列(有 seq、沒號碼)會被當成片 B 寫的**
  --      ⇒ 在【先貼 migration、後上 app】那段窗口裡, 每一封舊 writer 寄出去的
  --      都會讓那一箱多寄一封更正信 —— 而收信的客人號碼本來就是對的。
  IF pg_catalog.strpos(v_base, 'last.sent_tracking_recorded') = 0 THEN
    RAISE EXCEPTION '釘樁⑩:分代沒有用 sent_tracking_recorded ⇒ 部署窗口裡會寄出多餘的更正信';
  END IF;

  -- 🔴🔴 **釘樁⑨(新)**:主面必須是【讀底面】, 不得自己再抄一份規則。
  --    ⇒ 那正是 codex R1 抓到的那個病(規則兩份, 而其中一份停在第一代)。
  IF pg_catalog.strpos(v_top, 'pcm_tracking_correction_candidates') = 0 THEN
    RAISE EXCEPTION '釘樁⑨:主面沒有讀底面 ⇒ 規則又變成兩份, 而它會與 no_recipient_count 不互補';
  END IF;

  -- 🟢 正對照:這把尺在【該找到東西】時真的找得到 —— 否則上面那些格恆綠。
  IF pg_catalog.strpos(v_base, 'shipment_tracking_corrected') = 0 THEN
    RAISE EXCEPTION '釘樁正對照:連 event_type 字面都找不到 ⇒ 這把尺沒接上, 上面每一格的通過不算數';
  END IF;
  -- 🟢 第二個正對照:兩把尺**各自**都要會動(v_base 綠而 v_top 是空字串時, ⑨ 以外全綠)。
  IF pg_catalog.strpos(v_top, 'notification_email') = 0 THEN
    RAISE EXCEPTION '釘樁正對照b:主面的 def 裡連 notification_email 都沒有 ⇒ 那把尺沒接上';
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
  -- 🔴 底面含 email 兩欄(它是主面的來源)⇒ 同樣不得外流。
  IF pg_catalog.has_table_privilege('anon', 'public.pcm_tracking_correction_candidates', 'SELECT')
  THEN RAISE EXCEPTION '事後閘①e:anon 讀得到底面'; END IF;
  IF pg_catalog.has_table_privilege('authenticated', 'public.pcm_tracking_correction_candidates', 'SELECT')
  THEN RAISE EXCEPTION '事後閘①f:authenticated 讀得到底面'; END IF;
  -- 🟢 正對照:該讀得到的角色真的讀得到 —— 否則上面六格在「誰都讀不到」的世界裡也全綠,
  --    而那個世界裡整條寄信路是壞的。
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.pcm_tracking_correction_candidates', 'SELECT')
  THEN RAISE EXCEPTION '事後閘①正對照:service_role 讀不到底面 ⇒ GRANT 漏了, 而上面那些格不算數'; END IF;

  -- 🔴🔴 **兩支 view 的 ACL 要【逐個 grantee 看過】, 不只問三個角色**(codex R2 must-fix)。
  --    成因:本檔對它們用 `CREATE OR REPLACE VIEW`, 而 **`CREATE OR REPLACE` 保留既有 ACL**
  --    ⇒ 若正式庫上早有一支同名相容的 view 授給了**別的具名角色**, 我的兩道 REVOKE
  --      (只收 PUBLIC / anon / authenticated)**碰不到它**, 而上面那六格**也不會問到它**
  --    ⇒ 🛑 這兩支 view 含兩個 email 欄 ⇒ **PII 從一個沒有人在看的角色流出去。**
  --    ✅ 改成把 grantee 名單整個撈出來比對:只允許 owner 與 `service_role`。
  --    🔵 `relacl IS NULL` = 從來沒有人授過 ⇒ 只有 owner 看得到 ⇒ 那也是合格的。
  DECLARE v_bad_grantee text;
  BEGIN
    SELECT pg_catalog.string_agg(g.grantee::pg_catalog.regrole::text || '@' || c.relname, ', ')
      INTO v_bad_grantee
      FROM pg_catalog.pg_class c
      CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) g
     WHERE c.oid IN ('public.pcm_tracking_correction_candidates'::regclass,
                     'public.pcm_tracking_corrected_email_pending'::regclass,
                     'public.pcm_tracking_corrected_payload_unparseable'::regclass)
       AND g.grantee <> 0                       -- 0 = PUBLIC, 上面幾格已經在問它
       AND g.grantee <> c.relowner
       AND g.grantee::pg_catalog.regrole::text <> 'service_role';
    IF v_bad_grantee IS NOT NULL THEN
      RAISE EXCEPTION '事後閘①h:這三支 view 上有預期外的 grantee ⇒ % ⇒ 它們含 email, 停下來看一眼', v_bad_grantee;
    END IF;
  END;

  -- 🔴🔴 **trigger 必須真的裝上去了** —— 沒有它 `sent_seq` 恆為 NULL,
  --    而**那會讓整支 migration 在行為上等於沒做**(見 §2-b 那段)。
  --    🛑 而它的失敗是**全綠的**:view 建得起來、每一道釘樁都過、告警印正常的數字。
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
                  WHERE tgrelid = 'public.email_outbox'::regclass
                    AND tgname  = 'pcm_email_outbox_stamp_sent_seq'
                    AND NOT tgisinternal)
  THEN RAISE EXCEPTION '事後閘①g:蓋 sent_seq 的 trigger 不在 ⇒ 那一欄永遠是 NULL ⇒ 本片行為上等於沒做'; END IF;

  -- ② 兩個新欄:anon 與 authenticated 都不得讀
  --    🔴 **兩個角色都要問** —— codex 抓到我第一版只問了 anon 而註解宣稱兩個都問。
  IF pg_catalog.has_column_privilege('anon', 'public.email_outbox', 'sent_tracking_number', 'SELECT')
  THEN RAISE EXCEPTION '事後閘②a:anon 讀得到 sent_tracking_number'; END IF;
  IF pg_catalog.has_column_privilege('authenticated', 'public.email_outbox', 'sent_tracking_number', 'SELECT')
  THEN RAISE EXCEPTION '事後閘②b:authenticated 讀得到 sent_tracking_number'; END IF;
  IF pg_catalog.has_column_privilege('anon', 'public.email_outbox', 'sent_seq', 'SELECT')
  THEN RAISE EXCEPTION '事後閘②c:anon 讀得到 sent_seq'; END IF;
  -- 🔴 **`authenticated` 對 `sent_seq` 那一格原本漏了**(codex R2 nit)——
  --    註解宣稱「兩欄、兩角色都不得讀」, 而實際只問了三格。**四格才是那句話。**
  IF pg_catalog.has_column_privilege('authenticated', 'public.email_outbox', 'sent_seq', 'SELECT')
  THEN RAISE EXCEPTION '事後閘②d:authenticated 讀得到 sent_seq'; END IF;
  -- 🔴 第三欄(出處旗標)同樣兩個角色都要問。
  IF pg_catalog.has_column_privilege('anon', 'public.email_outbox', 'sent_tracking_recorded', 'SELECT')
  THEN RAISE EXCEPTION '事後閘②e:anon 讀得到 sent_tracking_recorded'; END IF;
  IF pg_catalog.has_column_privilege('authenticated', 'public.email_outbox', 'sent_tracking_recorded', 'SELECT')
  THEN RAISE EXCEPTION '事後閘②f:authenticated 讀得到 sent_tracking_recorded'; END IF;

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
  THEN RAISE EXCEPTION '事後閘④a:anon 叫得動 counts 函式(它是 SECURITY DEFINER)'; END IF;
  -- 🔴 **`authenticated` 原本沒問**(codex R2 must-fix)—— 而註解宣稱「anon / authenticated 都不得」。
  --    ⚠️ 而這裡特別要問:本檔用 `CREATE OR REPLACE` 動那支函式, 而 **`CREATE OR REPLACE` 保留 ACL**
  --    ⇒ 若哪天有人授過 `authenticated`, 本檔**不會清掉它**, 而少了這一格也**不會有人發現**。
  IF pg_catalog.has_function_privilege('authenticated',
       'public.get_tracking_corrected_gap_counts()'::regprocedure, 'EXECUTE')
  THEN RAISE EXCEPTION '事後閘④b:authenticated 叫得動 counts 函式(它是 SECURITY DEFINER)'; END IF;

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
-- 🔵 **本檔新建的可授權物件**:⛔ ~~正好 2 個:一支 view + 一支函式~~ ——
--    🔴 **2026-09-05 codex R2:那個分母已經失真。**現在是 **3 支 view + 2 支函式 + 1 個序列**。
--    下面兩個陣列就是這道閘的**分母**, 而**名單短了它只會少跑幾圈, 不會抗議** ⇒ 改動時要一起改。
--    (序列與欄位不在這兩個陣列裡 —— 它們由上面 §8 ②③ 那幾格各自問。)
--    (`get_tracking_corrected_gap_counts()` 是 `CREATE OR REPLACE` **既有**物件 ⇒
--     ACL 是繼承的, 不在本清單裡 —— 那道守門自己的註解也是這樣算的。)
DO $$
DECLARE
  -- 🔴 **名單要跟著本檔新建的物件走** —— 少列一個 = 那個物件的收權從此沒有人在驗,
  --    而它會**全綠**(這個迴圈只走名單, 名單短了它就少跑幾圈, 不會抗議)。
  --    🔵 主面 `pcm_tracking_corrected_email_pending` 也放進來 —— 它不是本檔【新建】的,
  --      而本檔用 `CREATE OR REPLACE` 動了它, 而那個動作**保留既有 ACL** ⇒ 它一樣要被問。
  v_relations text[] := ARRAY['pcm_tracking_corrected_payload_unparseable',
                              'pcm_tracking_correction_candidates',
                              'pcm_tracking_corrected_email_pending']::text[];
  v_functions text[] := ARRAY['pcm_safe_uuid(text)',
                              'pcm_email_outbox_stamp_sent_seq()']::text[];
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
  -- 🔴🔴 **2026-09-05 codex R2 訂正:這兩格【問錯角色】。**
  --    ⛔ ~~問 `payment_confirmer`~~ —— 它走的是 `get_tracking_corrected_gap_counts()`,
  --    而**那支是 `SECURITY DEFINER` 且 owner 是 postgres** ⇒ 函式體裡的有效身分是 **postgres**,
  --    不是 payment_confirmer ⇒ 📌 **它的權限從來不會被那條路用到。**
  --    ✅ 真正【直接查這兩支 invoker view】的是 **`service_role`**(sweeper 那條路)——
  --      要問的是它。⚠️ 而 `payment_confirmer` 那一格**不是白費**:它當時抓到我 ACL 的假設錯了,
  --      只是它守的不是這件事。
  IF NOT pg_catalog.has_function_privilege('service_role',
       'pg_catalog.btrim(text, text)'::regprocedure, 'EXECUTE')
  THEN RAISE EXCEPTION 'EXECUTE 斷言⑥:service_role 叫不動 pg_catalog.btrim(text, text) ⇒ 直接查主掃描面會在執行期整個失敗'; END IF;

  IF NOT pg_catalog.has_function_privilege('service_role',
       'pg_catalog.left(text, integer)'::regprocedure, 'EXECUTE')
  THEN RAISE EXCEPTION 'EXECUTE 斷言⑦:service_role 叫不動 pg_catalog.left(text, integer) ⇒ 直接查互補面會在執行期整個失敗'; END IF;

  -- 🟢 正對照:這把尺在【該印 false】時真的印 false。
  --    沒有這一格, 上面七格在「has_function_privilege 對任何東西都回 true」的世界裡恆綠。
  IF pg_catalog.has_function_privilege('anon',
       'public.pcm_tracking_corrected_dedup_key(uuid, uuid, timestamptz)'::regprocedure, 'EXECUTE')
  THEN RAISE EXCEPTION 'EXECUTE 正對照:anon 竟然叫得動 dedup_key ⇒ 要嘛授權漏了, 要嘛上面五格不算數'; END IF;
END
$$;

COMMIT;
