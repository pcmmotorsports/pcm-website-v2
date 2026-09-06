-- ══════════════════════════════════════════════════════════════════════
-- 20260906940000 · ⟦5b-SHIPPEDNUMNOTRECORDED1⟧ 收尾:互補面補成真的互補 + sent_seq 出處約束
-- 貼板 61(號由主視窗 -f8 2026-09-06 指派、艦隊表佔號)
-- 前置:20260905200000 必須先貼(本檔前置閘①會擋)
-- ══════════════════════════════════════════════════════════════════════
-- 🔴 **本檔修的是 20260905200000 那一片 codex R3 沒折的 must-fix, 而【三條裡只做兩條】。**
--    第三條(rollback 仍是 placeholder)在 8571ef5ec 就補掉了:
--    supabase/rollbacks/20260905200000-rollback.sql 171 行 / 95 行非註解,
--    ⚪ 正對照:同目錄八支照非註解行數排序它最大(次大 45 / 最小 4)⇒ 那個 95 不是孤兒數字。
--
-- ══ 修 1:互補面【今天不是互補集】═══════════════════════════════════════
-- 🔬 **機制是讀出來的, 不是引用審查意見**:
--   · 互補面 pcm_tracking_corrected_payload_unparseable 的條件逐字
--     `AND public.pcm_safe_uuid(e.payload ->> ''shipment_id'') IS NULL`
--     ⇒ **UUID 格式合法就收不到**。
--   · 底面 pcm_tracking_correction_candidates 找「最後告知」時逐字
--     `AND public.pcm_safe_uuid(last.payload ->> ''shipment_id'') = s.id`
--     ⇒ **指不到那一箱就不會被看**。
-- 🛑 ⇒ 一個【格式合法而指不到任何 shipment】的 payload:主面不收、互補面也不收
--    ⇒ **它從我們所有的面上消失, 而 payload_unparseable_count 不會動。**
-- 🔵 那不是假想:改號那條路(admin_update_shipment_tracking)今天就在跑,
--    而 payload 裡的 shipment_id 是**應用層寫進去的字串**, 沒有外鍵綁著它。
--
-- ✅ **修法 = 把兩個條件收成一個, 而新條件【嚴格包含】舊條件**:
--    舊 `pcm_safe_uuid(...) IS NULL`
--    新 `NOT EXISTS (SELECT 1 FROM shipments s WHERE s.id = pcm_safe_uuid(...))`
--    🔵 為什麼新的一定涵蓋舊的:`pcm_safe_uuid` 回 NULL 時 `s.id = NULL` 恆為 NULL
--       ⇒ 子查詢零列 ⇒ NOT EXISTS 為真 ⇒ **原本收得到的那兩種壞法一個都沒掉。**
--    ⇒ 📌 這不是「換一個條件」, 是**同一個條件的嚴格放寬** —— 所以不需要另開一支面。
--
-- 🛑🛑 **而它有一個誠實要講的代價, 不藏**:
--    這支 view 的名字是 `..._payload_unparseable`, 而**一個指不到箱的合法 UUID 是 parseable 的**
--    ⇒ **名字從今天起比內容窄**。TS 那側的欄位名同樣是
--    `payload_unparseable_count`(`PgAnomalyAlertReaderAdapter.ts:1032` 逐字
--    `const PAYLOAD_UNPARSEABLE_KEY = ''payload_unparseable_count'';`)。
--    ⚠️ **不改名的理由是量到的**:改名要動 `get_tracking_corrected_gap_counts()` 的 body,
--    而 `20260905200000:` 那道 **md5(prosrc) 前置釘樁**綁著它的兩個字面
--    ⇒ 動 body ⇒ **那支 migration 以後重貼會當場 RAISE**。
--    ⇒ 🎯 **本檔選擇讓數字變對, 而不是讓名字變對** —— 因為告警是靠數字響的。
--    📌 命名漂移已寫進板列 ⟦5b-SHIPPEDNUMNOTRECORDED1⟧, 它是**已知的**, 不是漏掉的。
--
-- ══ 修 2:sent_seq 沒有約束綁住 ═══════════════════════════════════════
-- 🔴 codex R3 那條寫了兩個世界, 而 **只有一個還存在**:
--   🟡 「寫了 seq 卻漏寫號碼 ⇒ 偽裝成真的沒號碼」⇒ **這個世界【存在】, 而 CHECK 不是它的解藥。**
--      ⛔ ~~我一度寫成「這個世界不存在」~~ ⇒ 🔴 **codex 2026-09-06 R1 訂正, 我收下**:
--        我引的那段註解只證得了「合法的 NULL 存在」⇒ 它推得出「**不能加 NOT NULL**」,
--        推不出「**沒有人會漏寫**」。**兩件事我當時併成一件。**
--      🔬 事實面(讀出來的):`SupabaseEmailOutboxAdapter` 的 `markSent` 逐字
--        「**它與號碼【一定成對】, 連號碼是 null 的時候也要寫**」, 而它**正常路徑確實成對寫**
--        ⇒ 今天沒有已知的漏寫者。
--      🛑 **而關鍵是【分不出來】**:一個漏寫號碼的列與一個合法的「寄了而沒告訴號碼」的列,
--        在 DB 裡**逐欄一模一樣** ⇒ 📌 **任何 CHECK 都擋不到前者而不誤殺後者。**
--        ⇒ 🎯 **所以本檔不下那一半, 不是因為那個世界不存在, 是因為 CHECK 是錯的量具。**
--      ⇒ ⚠️ **正確的量具在碼那一層**(呼叫端測試:markSent 一定同時帶兩個值)——
--        **本檔沒有做那一件**, 它是一條還開著的缺口, 已寫進板列。
--   🟢 「漏寫 seq ⇒ 偽裝成舊列」⇒ **這個世界是真的, 而且沒有東西擋**:
--      trigger `pcm_email_outbox_stamp_sent_seq` 只在【這一列第一次變成 sent】蓋號;
--      一列 `sent_tracking_recorded IS TRUE` 而 `sent_seq IS NULL` 時,
--      底面 `ORDER BY last.sent_seq DESC NULLS LAST` **把最新那一列排到最後**
--      ⇒ 我們讀到錯的「最後告知」⇒ 該寄的更正信不寄 / 不該寄的寄。
--
-- 🔴 **加法刻意用 `NOT VALID`**(主視窗 -f8 2026-09-06 裁):
--    正式庫既有列裡若已經有違規的, `ADD CONSTRAINT` 會**當場讓貼板炸在 Sean 手上**。
--    ⇒ 先 NOT VALID 掛上(**從此刻起新寫入一律受檢**), 再數既有列:
--      · 0 列 ⇒ 本檔自己 `VALIDATE CONSTRAINT`(那時它是全效的)
--      · >0 列 ⇒ **留在 NOT VALID**, 並把那些列的 id RAISE WARNING 印出來端人看
--    🛑 **兩條路都不讓貼板失敗** —— 而「有違規列」這件事不會被靜靜吞掉。
-- ══════════════════════════════════════════════════════════════════════

BEGIN;

-- ══ 鎖與逾時(codex 2026-09-06 R1 must-fix)═══════════════════════════
-- 🔴 本檔會對 `public.email_outbox` 拿 **ACCESS EXCLUSIVE**(ADD CONSTRAINT),
--    而那個鎖**握到 COMMIT** ⇒ 期間整張表的讀寫排隊, 寄信 sweeper 就住在這張表上。
-- 🛑 **所以寧可【失敗得快】, 也不要【擋得久】**:
--    · `lock_timeout` —— 拿不到鎖就放棄, 不要排在別人後面把後面的人也堵住
--    · `statement_timeout` —— 單句(含 VALIDATE 的全表掃)封頂
--    ⇒ 逾時 = 整支 migration 回滾 = **什麼都沒改**, 換個離峰時段重貼即可。
-- 📌 這兩行是 `SET LOCAL` ⇒ **只活在這個交易裡**, 不會留給下一個連線。
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- ══ 前置閘 ═══════════════════════════════════════════════════════════
DO $$
DECLARE v_def text; v_cols text; v_ands int; v_ors int; v_norm text;
BEGIN
  -- ① 20260905200000 貼過了嗎 —— 三支 view + trigger + 三個欄, 缺一就停
  IF pg_catalog.to_regclass('public.pcm_tracking_corrected_payload_unparseable') IS NULL
  THEN RAISE EXCEPTION '前置閘①a:互補面 view 不存在 ⇒ 20260905200000 沒貼過, 先貼它'; END IF;
  IF pg_catalog.to_regclass('public.pcm_tracking_correction_candidates') IS NULL
  THEN RAISE EXCEPTION '前置閘①b:底面 view 不存在 ⇒ 20260905200000 沒貼過, 先貼它'; END IF;
  IF pg_catalog.to_regprocedure('public.pcm_safe_uuid(text)') IS NULL
  THEN RAISE EXCEPTION '前置閘①c:pcm_safe_uuid(text) 不存在 ⇒ 20260905200000 沒貼過, 先貼它'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
                  WHERE attrelid = 'public.email_outbox'::regclass
                    AND attname  = 'sent_tracking_recorded' AND NOT attisdropped)
  THEN RAISE EXCEPTION '前置閘①d:email_outbox.sent_tracking_recorded 不存在 ⇒ 20260905200000 沒貼過'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
                  WHERE attrelid = 'public.email_outbox'::regclass
                    AND attname  = 'sent_seq' AND NOT attisdropped)
  THEN RAISE EXCEPTION '前置閘①e:email_outbox.sent_seq 不存在 ⇒ 20260905200000 沒貼過'; END IF;

  -- ② live 的互補面【必須是我預期的那一版】才准覆蓋
  --    🔴 這一格守的是「不要覆蓋一個我沒讀過的版本」(形狀照 20260905200000 的前置閘①c)。
  --    ⚠️ pg_get_viewdef 會重寫 SQL ⇒ **不比整段字面, 比語意特徵**
  --       (本 repo 記過:reference_pg-get-viewdef-rewrites-not-in-literal-compare-blind)。
  -- 🔴🔴 **codex 2026-09-06 R1 must-fix:一個字串在不在, 只證明「含這個字」** ——
  --    ⛔ ~~原本只問 `strpos(v_def,'pcm_safe_uuid') > 0`~~ ⇒ 一支**另外加了日期範圍
  --    或多收了別的 event_type** 的 view 照樣含那個字 ⇒ 閘門放行 ⇒ **我覆蓋掉別人的條件而全綠。**
  --    ✅ 改成【多個特徵一起問】+【欄位清單逐字比對】。
  --    ⚠️ 而這仍然不是「證明它是那一版」—— pg_get_viewdef 會重寫 SQL, 整段字面比對會誤紅
  --      (本 repo 記過 reference_pg-get-viewdef-rewrites-not-in-literal-compare-blind)。
  --      ⇒ 📌 **這一格把偽陽性的空間縮小, 而它答不出「逐字相同」。** 不宣稱它做得到。
  v_def := pg_catalog.pg_get_viewdef('public.pcm_tracking_corrected_payload_unparseable'::regclass, true);
  IF pg_catalog.strpos(v_def, 'pcm_safe_uuid') = 0
  THEN RAISE EXCEPTION '前置閘②a:live 的互補面裡沒有 pcm_safe_uuid ⇒ 不是我預期的那一版'; END IF;
  IF pg_catalog.strpos(v_def, 'email_outbox') = 0
  THEN RAISE EXCEPTION '前置閘②b:live 的互補面沒有從 email_outbox 讀 ⇒ 不是我預期的那一版'; END IF;
  IF pg_catalog.strpos(v_def, 'order_shipped') = 0
     OR pg_catalog.strpos(v_def, 'shipment_tracking_corrected') = 0
  THEN RAISE EXCEPTION '前置閘②c:live 的互補面少了那兩個 event_type 之一 ⇒ 不是我預期的那一版'; END IF;

  -- ②d **欄位清單逐字比對** —— 這一格比字串在不在強:它答的是「輸出形狀是不是那一個」。
  SELECT pg_catalog.string_agg(a.attname, ',' ORDER BY a.attnum) INTO v_cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.pcm_tracking_corrected_payload_unparseable'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cols <> 'outbox_id,order_id,event_type,sent_at,shipment_id_raw'
  THEN RAISE EXCEPTION '前置閘②d:live 的互補面欄位清單不是我預期的 ⇒ [%] ⇒ 停下來看一眼', v_cols; END IF;

  -- ②e 🔴🔴 **codex 2026-09-06 R2 must-fix:上面每一格都答「有沒有這個字」,**
  --    **而它們對【多了一個條件】完全失明。** 他給的反例逐字:
  --    有人在第一代上加了 `AND e.sent_at >= DATE '2026-09-01'`
  --    ⇒ 四個特徵在、五個欄位在 ⇒ **全部放行 ⇒ 我靜靜刪掉別人的日期限制。**
  -- ✅ 修法 = **數條件的個數**, 而不是問某個字在不在。
  --    第一代的 WHERE 恰好是四段以 AND 相連:
  --      event_type IN (…) / status = 'sent' / sent_at IS NOT NULL / safe_uuid IS NULL
  --    ⇒ **3 個 AND、0 個 OR**。多一個條件 ⇒ AND 變 4 ⇒ 這一格紅。
  -- 🔵 **為什麼用個數而不用整段字面**:`pg_get_viewdef` 會重寫 SQL(`IN` ⇒ `= ANY (ARRAY[…])` 等),
  --    整段比對會在不同 PG 版本上誤紅(本 repo 記過)⇒ 而**它不會憑空生出 AND / OR**。
  -- 🛑 **殘餘風險照實寫**:有人把某一段條件裡的【值】改掉(例如換掉一個 event_type 字面),
  --    個數不變 ⇒ **這一格看不到**。⇒ 📌 本閘把偽陽性空間縮小, 它不是「證明逐字相同」。
  -- 🔴 先把所有空白(含 pretty-print 的換行與縮排)壓成單一空格 ——
  --    否則 `\n  AND (` 這種形狀在數 ' AND ' 時會漏掉, 而**漏數會讓這道閘靜靜放行**。
  v_norm := pg_catalog.upper(pg_catalog.regexp_replace(v_def, '\s+', ' ', 'g'));
  v_ands := (pg_catalog.length(v_norm)
             - pg_catalog.length(pg_catalog.replace(v_norm, ' AND ', ''))) / 5;
  v_ors  := (pg_catalog.length(v_norm)
             - pg_catalog.length(pg_catalog.replace(v_norm, ' OR ', ''))) / 4;
  IF v_ands <> 3 OR v_ors <> 0
  THEN RAISE EXCEPTION '前置閘②e:live 的互補面條件個數不是第一代(AND=% 期望 3 / OR=% 期望 0)⇒ 有人動過它, 停下來看一眼, 不要覆蓋', v_ands, v_ors; END IF;

  -- ③ 本檔貼過了嗎 —— 貼過就停, 不要靜靜再跑一次
  --    🔴 **codex R1 nit**:⛔ ~~只問 shipments 在不在~~ ⇒ 一支把 `email_outbox`
  --    **別名取作 `shipments`** 的 view 會讓首次套用被誤拒。
  --    ✅ 改成【兩個特徵同時成立】才算貼過:有 shipments **而且**有 NOT EXISTS 的形狀。
  IF pg_catalog.strpos(v_def, 'shipments') > 0
     AND pg_catalog.strpos(v_def, 'EXISTS') > 0
  THEN RAISE EXCEPTION '前置閘③:live 的互補面已經含 shipments 的 NOT EXISTS ⇒ 本檔貼過了'; END IF;
END $$;

-- ══ 1. 互補面補成真的互補 ═══════════════════════════════════════════
-- 🔴 **欄位清單與順序逐字不動** —— `CREATE OR REPLACE VIEW` 比的就是那個清單,
--    少一欄 / 換順序 / 改名都會回 42P16。本檔只動 WHERE。
CREATE OR REPLACE VIEW public.pcm_tracking_corrected_payload_unparseable
  WITH (security_invoker = true) AS
SELECT
  e.id           AS outbox_id,
  e.order_id     AS order_id,
  e.event_type   AS event_type,
  e.sent_at      AS sent_at,
  -- 🛑 只印前 64 字元 —— 這一欄的用途是「讓人看得出它壞在哪」, 不是把 payload 端出來。
  pg_catalog.left(e.payload ->> 'shipment_id', 64) AS shipment_id_raw
FROM public.email_outbox e
WHERE e.event_type IN ('order_shipped', 'shipment_tracking_corrected')
  AND e.status   = 'sent'
  AND e.sent_at IS NOT NULL
  -- 🔴🔴 **三種壞法收成一個條件**(舊版只收前兩種):
  --   ① 那個鍵根本不在 payload 裡(`->>` 回 NULL)
  --   ② 在, 而不是合法 UUID
  --   ③ 🆕 是合法 UUID, 而**指不到任何一箱**(舊版對它失明 ⇒ 主面也不收 ⇒ 兩邊都消失)
  -- 🔵 為什麼一個條件涵蓋三種:`pcm_safe_uuid` 對 ①② 都回 NULL,
  --    而 `s.id = NULL` 恆為 NULL ⇒ 子查詢零列 ⇒ NOT EXISTS 為真。
  --    ⇒ 📌 **新條件嚴格包含舊條件, 舊的命中一個都沒掉。**
  AND NOT EXISTS (
        SELECT 1
          FROM public.shipments s
         WHERE s.id = public.pcm_safe_uuid(e.payload ->> 'shipment_id')
      );

-- 🔴 `CREATE OR REPLACE VIEW` **保留既有 ACL** ⇒ 這兩行不是多餘的:
--    它讓「本檔貼完之後的授權狀態」不依賴上一支 migration 還在不在。
REVOKE ALL ON public.pcm_tracking_corrected_payload_unparseable FROM PUBLIC;
REVOKE ALL ON public.pcm_tracking_corrected_payload_unparseable FROM anon, authenticated;
GRANT SELECT ON public.pcm_tracking_corrected_payload_unparseable TO service_role;

COMMENT ON VIEW public.pcm_tracking_corrected_payload_unparseable IS
$c$已寄出、而我們**無法把它歸屬到某一箱**的 outbox 列。
🔴🔴 **名字比內容窄** —— 2026-09-06(20260906940000)之後它收三種壞法:
   ① `payload->>'shipment_id'` 不在 ② 在而不是合法 UUID
   ③ **是合法 UUID 而指不到任何 shipment**(舊版對這一種失明)
   ⇒ ③ 是 parseable 的, 所以「unparseable」這個名字對它不精確。
   ⚠️ 不改名的理由:改名要動 `get_tracking_corrected_gap_counts()` 的 body,
      而 `20260905200000` 有一道 md5(prosrc) 釘樁綁著它 ⇒ 動了那支 migration 重貼會 RAISE。
   ⇒ 🎯 **選擇讓數字變對, 而不是讓名字變對** —— 告警是靠數字響的。
🛑 **③ 為什麼非收不可**:它在主面也不會出現(底面找「最後告知」時用 `= s.id`)
   ⇒ 舊版之下**兩面都不收 ⇒ 它從我們所有的面上消失**。
✅ **語意**:資料品質訊號 —— 「有信寄出去了, 而我們讀不出它是哪一箱的」。
   它**不預測**那一箱會不會被排;要知道那個, 去看主面
   (同一箱若還有別的乾淨列, 它照樣被判)。
🛑 **零列不代表健康** —— 也可能代表「這裡根本沒有已寄出的信」
   ⇒ 所以 `get_tracking_corrected_gap_counts` 帶了分母。$c$;

-- ══ 2. sent_seq 出處約束(NOT VALID 加 + 條件式 VALIDATE)═══════════
DO $$
DECLARE
  v_bad   bigint;
  v_ids   text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
              WHERE conrelid = 'public.email_outbox'::regclass
                AND conname  = 'email_outbox_recorded_needs_sent_seq')
  THEN RAISE EXCEPTION '前置閘④:約束 email_outbox_recorded_needs_sent_seq 已存在 ⇒ 本檔貼過了'; END IF;

  -- 🔴🔴 **先掛鎖, 才數** —— 而這個順序是 R1 與 R2 打架之後選的, 理由寫在這裡:
  --    · **R1(鎖)**說:`ADD CONSTRAINT` 拿 ACCESS EXCLUSIVE 且在同交易裡握到 COMMIT
  --      ⇒ 把 count 那一發全表掃移到鎖【之前】可以縮短鎖窗。我照做了。
  --    · **R2 推翻了那個修法, 而它是對的**:鎖之前數出來的 0,
  --      在 `ADD` 真的拿到鎖之前**可以被另一個交易寫成 1** ⇒ 我走進 VALIDATE 分支
  --      ⇒ **VALIDATE 當場報錯 ⇒ 整支 migration 回滾** ⇒ 🛑 **正好違反本檔最重要的那句話:
  --        「不要讓貼板在正式庫炸在 Sean 手上」。**
  --    ⇒ 🎯 **所以順序改回【先 ADD(拿鎖)再數】** —— 鎖握著的時候, 那個數字才不會在腳下改變。
  --    ⚠️ **代價照實寫, 不藏**:鎖窗裡因此多一次全表掃(count)。
  --      封頂靠本檔開頭的 `SET LOCAL statement_timeout` / `lock_timeout`,
  --      而**逾時 = 整支回滾 = 什麼都沒改** ⇒ 那是可接受的失敗形狀, 半套不是。
  --    📌 一句話:**寧可鎖久一點, 也不要拿一個會過期的讀數去做分支。**
  EXECUTE 'ALTER TABLE public.email_outbox
             ADD CONSTRAINT email_outbox_recorded_needs_sent_seq
             CHECK (sent_tracking_recorded IS NOT TRUE OR sent_seq IS NOT NULL)
             NOT VALID';

  -- 🔬 **在鎖裡數** —— 這一格就是主視窗要的「貼前數一次」, 而現在它是可信的:
  --    ACCESS EXCLUSIVE 握著 ⇒ 沒有別的交易能在這一刻寫進一列違規的。
  SELECT pg_catalog.count(*) INTO v_bad
    FROM public.email_outbox e
   WHERE e.sent_tracking_recorded IS TRUE AND e.sent_seq IS NULL;

  IF v_bad = 0 THEN
    -- 🟢 沒有違規列 ⇒ 現在就驗滿, 讓它從「只管新列」升級成「全效」。
    EXECUTE 'ALTER TABLE public.email_outbox
               VALIDATE CONSTRAINT email_outbox_recorded_needs_sent_seq';
    RAISE NOTICE '§2:既有違規列 0 ⇒ 已 VALIDATE, 約束全效';
  ELSE
    -- 🛑 有違規列 ⇒ **不 VALIDATE、也不讓貼板失敗**, 而把 id 印出來端人看。
    --    📌 不吞掉的理由:一個「靜靜留在 NOT VALID」的約束, 與「驗過了」印同一個畫面。
    SELECT pg_catalog.string_agg(x.id::text, ', ')
      INTO v_ids
      FROM (SELECT e.id FROM public.email_outbox e
             WHERE e.sent_tracking_recorded IS TRUE AND e.sent_seq IS NULL
             ORDER BY e.id LIMIT 50) x;
    RAISE WARNING '§2:既有違規列 % 筆 ⇒ 約束留在 NOT VALID(新寫入仍受檢)。前 50 筆 id = %', v_bad, v_ids;
  END IF;
END $$;

COMMENT ON CONSTRAINT email_outbox_recorded_needs_sent_seq ON public.email_outbox IS
$c$片 B 寫過的列必須有排序鍵。
🔴 **它擋的世界**:`sent_tracking_recorded IS TRUE` 而 `sent_seq IS NULL`
   ⇒ 底面 `ORDER BY last.sent_seq DESC NULLS LAST` **把最新那一列排到最後**
   ⇒ 我們讀到錯的「最後告知」⇒ 該寄的更正信不寄 / 不該寄的寄。
🛑 **它【刻意】不管號碼那一半** —— `sent_tracking_recorded = true` 而
   `sent_tracking_number IS NULL` 是**合法狀態**(語意 = 寄了一封沒告訴客人號碼的信),
   `SupabaseEmailOutboxAdapter` 那段逐字「它與號碼【一定成對】, 連號碼是 null 的時候也要寫」。
   ⇒ 加上那一半會讓每一封那種信寫不進 DB。$c$;

-- ══ 3. 事後閘 ═══════════════════════════════════════════════════════
DO $$
DECLARE
  v_def   text;
  v_cols  text;
  v_bad_grantee text;
BEGIN
  -- ①a 新條件真的在 live 的 view 定義裡(不是我以為我改了)
  v_def := pg_catalog.pg_get_viewdef('public.pcm_tracking_corrected_payload_unparseable'::regclass, true);
  IF pg_catalog.strpos(v_def, 'shipments') = 0
  THEN RAISE EXCEPTION '事後閘①a:live 的互補面裡沒有 shipments ⇒ CREATE OR REPLACE 沒生效'; END IF;
  -- 🟢 **正對照**:舊條件的元件也必須還在 —— 否則「我把它整個換掉了」與「我加寬了」印同一個綠。
  IF pg_catalog.strpos(v_def, 'pcm_safe_uuid') = 0
  THEN RAISE EXCEPTION '事後閘①b:live 的互補面裡沒有 pcm_safe_uuid ⇒ 我把舊條件弄丟了, 不是加寬'; END IF;

  -- ①c 欄位清單逐字不變(本檔宣稱只動 WHERE)
  SELECT pg_catalog.string_agg(a.attname, ',' ORDER BY a.attnum) INTO v_cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.pcm_tracking_corrected_payload_unparseable'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cols <> 'outbox_id,order_id,event_type,sent_at,shipment_id_raw'
  THEN RAISE EXCEPTION '事後閘①c:互補面欄位清單變了 ⇒ [%] ⇒ 本檔宣稱只動 WHERE', v_cols; END IF;

  -- ②a/②b 授權沒退化:anon / authenticated 都不得讀(它帶 outbox id 與 order_id)
  IF pg_catalog.has_table_privilege('anon', 'public.pcm_tracking_corrected_payload_unparseable', 'SELECT')
  THEN RAISE EXCEPTION '事後閘②a:anon 讀得到互補面'; END IF;
  IF pg_catalog.has_table_privilege('authenticated', 'public.pcm_tracking_corrected_payload_unparseable', 'SELECT')
  THEN RAISE EXCEPTION '事後閘②b:authenticated 讀得到互補面'; END IF;
  -- 🟢 **正對照**:該讀得到的角色真的讀得到 —— 否則上面兩格在「誰都讀不到」的世界裡也全綠,
  --    而那個世界裡告警是啞的。
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.pcm_tracking_corrected_payload_unparseable', 'SELECT')
  THEN RAISE EXCEPTION '事後閘②正對照:service_role 讀不到互補面 ⇒ GRANT 漏了, 上面兩格不算數'; END IF;

  -- ②c 逐個 grantee 看過(照 20260905200000 事後閘①h:CREATE OR REPLACE 保留既有 ACL)
  SELECT pg_catalog.string_agg(g.grantee::pg_catalog.regrole::text, ', ')
    INTO v_bad_grantee
    FROM pg_catalog.pg_class c
    CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) g
   WHERE c.oid = 'public.pcm_tracking_corrected_payload_unparseable'::regclass
     AND g.grantee <> 0
     AND g.grantee <> c.relowner
     AND g.grantee::pg_catalog.regrole::text <> 'service_role';
  IF v_bad_grantee IS NOT NULL
  THEN RAISE EXCEPTION '事後閘②c:互補面上有預期外的 grantee ⇒ % ⇒ 停下來看一眼', v_bad_grantee; END IF;

  -- ②d 🔴🔴 **invoker view 的函式 EXECUTE**(`scripts/invoker-view-execute-gate.py` 擋下來的)——
  --    這支 view 是 `security_invoker = true` ⇒ 它 body 裡的 `pcm_safe_uuid()` 用**呼叫者**的權限跑。
  --    🛑 若那支函式的 EXECUTE 被收掉過, **view 建得起來、每一道靜態檢查全綠**,
  --      而**查它的人一次錯一次** —— 而查它的人是告警那條路 ⇒ 告警靜靜變啞。
  --    ✅ 斷言 = 量到的結果(不是只補一條 GRANT —— GRANT 是我寫的動作, 它答不出現況)。
  IF NOT pg_catalog.has_function_privilege('service_role',
           'public.pcm_safe_uuid(text)'::regprocedure, 'EXECUTE')
  THEN RAISE EXCEPTION '事後閘②d:service_role 叫不動 public.pcm_safe_uuid(text) ⇒ 這支 invoker view 對它是壞的'; END IF;
  -- 🟢 **負對照**:不該叫得動的角色真的叫不動 —— 否則上面那一格在「誰都叫得動」的世界裡也是綠的。
  IF pg_catalog.has_function_privilege('anon',
       'public.pcm_safe_uuid(text)'::regprocedure, 'EXECUTE')
  THEN RAISE EXCEPTION '事後閘②d負對照:anon 叫得動 public.pcm_safe_uuid(text) ⇒ 上面那一格不算數'; END IF;

  -- ③ 約束真的在
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                  WHERE conrelid = 'public.email_outbox'::regclass
                    AND conname  = 'email_outbox_recorded_needs_sent_seq'
                    AND contype  = 'c')
  THEN RAISE EXCEPTION '事後閘③:約束 email_outbox_recorded_needs_sent_seq 不在'; END IF;
END $$;

COMMIT;
