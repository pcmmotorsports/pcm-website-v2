-- ============================================================================
-- M-4b E10 片 D3-d:`order_manual_refunds` 帳不塗改(append-once)
-- ============================================================================
-- ⚠️ **先看語意**(R3 對抗審查 F6):Sean 那句話說的是「更正成『其實沒退過錢』」,
--    而**這張表對「作廢」的權威定義不是那個** —— `20260820090000:121-122` 逐字:
--      「**作廢不是『又退了一筆負的錢』,是『這筆登記本身是錯的』** ——
--        錢有沒有真的交回去,要看 actor 與稽核,不看本欄」
--    ⇒ **作廢【不宣稱】錢沒動。** 本片下方 P2B46 的訊息是按這個正確語意寫的;
--      而若照 Sean 那句的字面讀成「作廢 = 錢沒動」,下一個人會做出錯的補救流程。
--
-- Sean 2026-08-30 拍板 `Q4 退款更正` = **甲**,逐字:
--   「一筆退款單被更正成『其實沒退過錢』之後,**不能**再改回『有退過』,
--     要另外開一筆新的更正紀錄(**帳不塗改**)」
-- 範圍由主視窗 `-48` 裁 **乙**(2026-08-30 03:2x):不只守作廢那三欄,連金額與身分一起鎖。
-- Plan 全文 `~/pcm-mailbox/線A-plan-Q4退款更正-帳不塗改-20260830.md`。
--
-- ══ 🔴🔴 **本片只動了兩個機制裡的【一個】** ═══════════════════════════════
--    「退款單被更正」在本 repo 有兩個機制,而 Sean 那句話沒有說是哪一個:
--
--    機制 B  卡片退款判定更正 `order_refund_manual_corrections`
--            (`20260814190000_m4b_e10_473b1_refund_manual_corrections.sql:69`)
--            ⇒ **本來就符合,本片一個字都沒有動它**
--            它是追加一列、舊列不動,`corrected_to` 最新一筆說了算(拍板 `Q-473-1=A`)。
--
--    機制 A  現金 / 匯款人工退款登記 `order_manual_refunds`  ⇒ **本片動的是它**
--            作廢 = **就地翻旗標**(`20260820100000_…d3b:358` 的
--            `UPDATE … SET voided_at = now(), void_reason, voided_by`)
--            🔴 **而「復活」那條路(`voided_at` 非 NULL ⇒ NULL)沒有任何一行碼在看它。**
--
--    📌 **⇒ 看到「Q4 做完了」的人請讀完上面兩段:只有 A 被動過。**
--
-- ══ 為什麼今天擋得住,而那不算擋住 ═══════════════════════════════════════
--    本表零寫入 GRANT(`20260820010000:268` REVOKE ALL FROM PUBLIC, anon,
--    authenticated, service_role)⇒ RPC / PostgREST 層**做不到**復活(查無 unvoid 函式)。
--    🔴 **而 DB 層沒有結構性禁令** —— owner 直連(SQL Editor)改得動。
--    而那支建表 migration **自己就寫了**(`20260820010000:62-64` 逐字):
--      「本表零寫入 GRANT ⇒ 只有 owner 寫得進來…**本檔不宣稱本表不可竄改**」
--
-- ══ 🛑 **而本片【也不宣稱】防得住 owner —— 這一段是誠實邊界,不是免責** ══════
--    ⚠️ **原本這裡寫「本片把那句話從『不宣稱』變成『宣稱得起來』」—— 那句話太滿,已刪。**
--       codex 對抗審查 2026-08-30 指出:owner 可以
--         · `ALTER TABLE … DISABLE TRIGGER` 或 `DROP TRIGGER`
--         · `SET session_replication_role = replica`
--       兩條都能繞過本片。⇒ **原句在宣稱一件本片做不到的事。**
--    ✅ 本片實際買到的是:
--       ① **一般 UPDATE 路徑上,復活與塗改改不動了**(對 owner 身分的 SECDEF RPC 也一樣觸發)
--       ② **本片自己這兩支** trigger 在 `session_replication_role = replica` 下仍會觸發
--          (下方 `ENABLE ALWAYS`)
--       ③ TRUNCATE 那條路已關(下方 statement-level 守門,同樣 `ALWAYS`)
--    🛑🛑 **而本片指名的那條補救出口,今天在後台【按不到】**(R3 對抗審查 F4 實查):
--       `apps/admin/src/components/orders/manual-refund-entry-gate.ts:85`
--         `MANUAL_REFUND_ENTRY_BLOCKED_BY_787 = true`
--       `apps/admin/src/lib/payment/manual-refund-actions.ts:70-72` 無條件 denied
--       ⇒ **登記入口 UI 與 server 兩道都封著**(解封要 `#866` + Sean)。
--       而**作廢那半是活的**(`manual-refund-void-actions.ts:31-37` 沒有 787 閘)。
--    🔴 **⇒ 凌晨三點的實際路徑是:員工按得到「作廢」,而按不到「補登」。**
--       本片又把 DB 層 owner 直改那條退路關掉 ⇒ **唯一出口是 owner 直呼 RPC。**
--       ⇒ 這不是本片造成的(#787 早就封著), 而**本片讓它變得更要緊** ⇒ 寫在這裡。
--    ✅ 而額度不是問題(R3 實查):`20260824010000:130-136` 扣除側有 `AND m.voided_at IS NULL`
--       ⇒ 作廢會把額度**還回來**, 補登不會被 PCM01 擋。
--
--    🛑 **買不到的是**:
--       · owner 主動 `DISABLE` / `DROP` 這兩支 trigger
--       · 🔴🔴 **`replica` 模式下的 DELETE** —— codex R2 抓到,而**我上一版寫「replica 那條路已關」是錯的**:
--         擋 DELETE 的是 **866 那支**(`20260824011000` 的 `trg_pcm_manual_refund_rail_cap`),
--         而它是預設的 `tgenabled='O'` ⇒ **replica 模式下它不觸發** ⇒ `DELETE` 會成功。
--         本片的兩支 `ALWAYS` **都不處理 DELETE**(刻意:DELETE 是那支的職責,本片不搶)
--         ⇒ **那條路仍然開著,而它不在本片的範圍裡。**
--         📌 **⇒ 「我把我的兩支設成 ALWAYS」與「replica 這條路關了」是兩個宣稱** ——
--            而我上一版把前者寫成了後者。要真的關,要動的是**別人的那支**,那是另一片。
--    📌 與同族的字面一致(`20260810140000:163` 的 `prl_append_only_guard` COMMENT 逐字
--       「**不宣稱防得住它們**」;`20260824011000:221-222` 同款)——
--       **這不是本片的缺陷,是這一族守門共同的天花板;而把它寫出來才是這一族的家法。**
--
-- ══ 既有 trigger 為什麼擋不到 ═══════════════════════════════════════════
--    `trg_pcm_manual_refund_rail_cap`(`20260824011000:258`,BEFORE INSERT OR UPDATE
--    OR DELETE)只做兩件事:DELETE 擋死(`:152-157`)、`NEW.voided_at IS NOT NULL`
--    就**提早 return**(`:159-161`)。
--    🔴 復活會落到那個早退**下面**的金額上限檢查 —— 而那道檢查問的是
--       「金額有沒有超過額度」,**不是「你是不是在把一筆作廢過的退款救回來」**。
--    📌 **⇒ 它會通過,而通過的理由與這件事無關。**
--
-- ══ 形狀照抄 `order_payments`,不發明 ═══════════════════════════════════
--    `20260810130000_m4b_e10_op2b_reversal_invariants.sql` 的
--    `pcm_op2b_immutable_columns()`(`:209`)+ `order_payments_immutable_bu`(`:270`)。
--    照抄的三件事:①**逐欄列出**不用「allowlist 以外」的動態寫法(新增欄位時動態寫法會
--    **自動放行**,逐欄寫死則是新增欄位時當場想起要決定)②`IS DISTINCT FROM`(NULL-safe)
--    ③trigger **不加 WHEN**(條件式會讓某些形狀溜過去)。
--
-- ⚠️ **發火序**:同 timing 的 trigger 依**名稱字母序**發火。
--    `order_manual_refunds_immutable_bu` < `trg_pcm_manual_refund_rail_cap`
--    ⇒ 本片先跑。**這是刻意的**:塗改要在額度計算之前就被拒,
--    否則錯誤訊息會變成「額度不足」而真正的成因是「你在改一列不該改的」。
--
-- 🛑 **本片零資料修補** —— 只管未來的 UPDATE。正式庫若已有被復活過的列,
--    本片**看不到也不修**;要查那個要另外跑 SQL(而寫本片的窗打不了正式站)。
--
-- Rollback(🔴 **四樣,缺一不可** —— codex R2 抓到我上一版只寫了 UPDATE 那一組,
--   照它做會留下 TRUNCATE 守門,之後 TRUNCATE 仍回 P2B48 ⇒ **那不是可逆,是回退到一個沒有人描述過的中間態**):
--           `DROP TRIGGER order_manual_refunds_immutable_bu   ON public.order_manual_refunds;`
--           `DROP TRIGGER order_manual_refunds_no_truncate_bt ON public.order_manual_refunds;`
--           `DROP FUNCTION public.pcm_d3d_manual_refund_immutable();`
--           `DROP FUNCTION public.pcm_d3d_manual_refund_no_truncate();`
--           無資料變更 ⇒ 可逆。
--   ⚠️ **而回退把這道守門拿掉之後,「復活」這件事又沒有人在看了** ——
--      回退腳本要把這句話印出來,不要只印 DROP 成功。
--
-- 行為的證人 = `scripts/d3d-immutable-verify.sh`(拋棄式 PG)。
--   🔴 下面的後置斷言**只驗「裝上去了」與「權限」,不驗行為** ——
--      行為要捏資料,而捏的資料過不了本表的 FK(`order_id → orders`)⇒ 在正式庫必炸。
--      (這一句與做法都是 `20260824011000:264-266` 那支檔自己的教訓,照它做。)
-- ============================================================================

BEGIN;

-- ══ 0. 前置:欄位分母 ══════════════════════════════════════════════════════
-- 🔴🔴 **這一段是本片最重要的守門,而它守的是【本片自己】。**
--    下面那份不可變欄清單是**人列的**。若日後有人 ADD COLUMN 而沒有回來改這裡,
--    那個新欄會**安靜地可竄改**,而本片的名字會讓人以為它被守住了。
--    ⇒ 所以這裡把**欄位集合**釘死:對不上就整筆 ROLLBACK,逼下一個人當場做決定。
--    📌 形狀:**一份「逐欄列出」的清單,它的失效方式是【表長出了新的欄】,
--       而那件事不會來通知你。**
DO $d3d_col_denominator$
DECLARE
  v_expected text[] := ARRAY[
    'actor', 'created_at', 'id', 'occurred_at', 'order_id', 'rail',
    'reason', 'refund_amount', 'request_id', 'void_reason', 'voided_at', 'voided_by'
  ];
  v_actual text[];
BEGIN
  SELECT pg_catalog.array_agg(a.attname::text ORDER BY a.attname::text)
    INTO v_actual
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.order_manual_refunds'::regclass
     AND a.attnum > 0
     AND NOT a.attisdropped;

  IF v_actual IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION
      'D3-d 欄位分母對不上 —— 本表現在有 %,而本片的不可變清單是照 % 寫的。'
      '🔴 多出來的欄【不會】被本片守住,而本片的名字會讓人以為它被守住了。'
      '⇒ 請決定新欄該不該可變,改下面那支函式,再回來更新這份清單。',
      v_actual, v_expected
      USING ERRCODE = 'P2B47', CONSTRAINT = 'pcm_d3d_column_denominator';
  END IF;
END
$d3d_col_denominator$;

-- ══ 1. 不可變欄 + 作廢是終態 ═══════════════════════════════════════════════
-- invoker(不是 SECURITY DEFINER):它只看 OLD/NEW,不讀任何表 ⇒ 不需要提權。
CREATE FUNCTION public.pcm_d3d_manual_refund_immutable()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $fn$
DECLARE v_bad text;
BEGIN
  -- ── ① 帳體:一律不可變 ────────────────────────────────────────────────
  --    🔴 逐欄列出,不用「除了 allowlist 以外」的動態寫法。理由見檔頭。
  --    ⚠️ `request_id` 也在裡面 —— 它是 `20260820021000:128` 後加的 NOT NULL 欄,
  --       **建表那支裡沒有它**。(「這張表長怎樣」的分母,是所有寫過它的 migration。)
  v_bad := pg_catalog.concat_ws(', ',
    CASE WHEN NEW.id            IS DISTINCT FROM OLD.id            THEN 'id' END,
    CASE WHEN NEW.order_id      IS DISTINCT FROM OLD.order_id      THEN 'order_id' END,
    CASE WHEN NEW.rail          IS DISTINCT FROM OLD.rail          THEN 'rail' END,
    CASE WHEN NEW.refund_amount IS DISTINCT FROM OLD.refund_amount THEN 'refund_amount' END,
    CASE WHEN NEW.reason        IS DISTINCT FROM OLD.reason        THEN 'reason' END,
    CASE WHEN NEW.actor         IS DISTINCT FROM OLD.actor         THEN 'actor' END,
    CASE WHEN NEW.occurred_at   IS DISTINCT FROM OLD.occurred_at   THEN 'occurred_at' END,
    CASE WHEN NEW.created_at    IS DISTINCT FROM OLD.created_at    THEN 'created_at' END,
    CASE WHEN NEW.request_id    IS DISTINCT FROM OLD.request_id    THEN 'request_id' END);

  IF v_bad IS NOT NULL AND v_bad <> '' THEN
    RAISE EXCEPTION
      '人工退款登記的這些欄位不可變更:%。'
      '🔴 帳不塗改 —— 登錯了請用「作廢」,再另外登一筆新的;改列等於繞過 append-only。',
      v_bad
      USING ERRCODE = 'P2B45', CONSTRAINT = 'pcm_d3d_immutable_violation';
  END IF;

  -- ── ② 作廢是終態:已作廢的列,那三欄一個字都不能再動 ────────────────────
  --    🔴 這一格就是 Sean 那句話本身。它同時擋掉兩種形狀:
  --      · **復活**(`voided_at` 非 NULL ⇒ NULL)
  --      · **改作廢理由 / 改作廢的人**(那是塗改稽核痕跡,比復活更難發現)
  --    ⚠️ 表上的 `order_manual_refunds_void_trio` CHECK 只保證三欄**三向配對**
  --       (`num_nonnulls(...) IN (0,3)`,`20260820090000:115`)——
  --       它**擋不住把三欄一起清掉**(0 也在允許集合裡)。⇒ 那正是本格要擋的。
  IF OLD.voided_at IS NOT NULL THEN
    v_bad := pg_catalog.concat_ws(', ',
      CASE WHEN NEW.voided_at   IS DISTINCT FROM OLD.voided_at   THEN 'voided_at' END,
      CASE WHEN NEW.void_reason IS DISTINCT FROM OLD.void_reason THEN 'void_reason' END,
      CASE WHEN NEW.voided_by   IS DISTINCT FROM OLD.voided_by   THEN 'voided_by' END);

    IF v_bad IS NOT NULL AND v_bad <> '' THEN
      RAISE EXCEPTION
        '這一筆已經作廢了,作廢紀錄不能再改(你動到的是:%)。'
        '🔴 Sean 2026-08-30 拍板:**不能改回「有退過」,要另外開一筆新的更正紀錄(帳不塗改)**。'
        '⇒ 若這筆退款其實真的發生了,請用 admin_record_manual_refund **登一筆新的**,'
        '作廢的這一列原樣留著。'
        '🔴🔴 **而那一筆【必須用新的 request_id】** —— 沿用原本那把會【什麼都不做而回報成功】:'
        'admin_record_manual_refund 的冪等格是 (order_id, request_id) 且**不濾 voided_at**'
        '(20260823020000:394-403)⇒ 它會命中那個已作廢的列、回 idempotent:true, '
        '而後台把 idempotent 當成功顯示(manual-refund-actions.ts:150)⇒ **一列都沒寫、帳仍是沒退過**。'
        '⚠️ 而若你只改了內容(例如換個理由), 會撞到它的同鍵不同內容拒絕, '
        '那則訊息逐字叫你「不要用新的 request_id」—— **那句話的前提是「你在重送同一筆」, '
        '不涵蓋「原本那筆被作廢了」這個情況。**'
        '⇒ 補登完請核 pcm_order_refundable_remaining 是否回到預期值(D1 明文不擋'
        '「同一筆錢用不同 request_id 登兩次」, 20260820021000:333-335 ⇒ 那一半只有對帳看得到)。',
        v_bad
        USING ERRCODE = 'P2B46', CONSTRAINT = 'pcm_d3d_void_is_terminal';
    END IF;
  END IF;

  RETURN NEW;
END
$fn$;

REVOKE ALL ON FUNCTION public.pcm_d3d_manual_refund_immutable()
  FROM PUBLIC, anon, authenticated, service_role, authenticator;

-- ══ 1b. TRUNCATE:row trigger 對它【不觸發】 ═══════════════════════════════
-- 🔴 **codex 對抗審查 2026-08-30 must-fix**:`TRUNCATE public.order_manual_refunds`
--    之後用原 id 重插一列,舊帳消失、新帳成立 ⇒ **本片宣稱的 append-once 不成立**。
--    而 `FOR EACH ROW` 的 trigger **對 TRUNCATE 一律不觸發** ——
--    既有的 DELETE 守門(`20260824011000:152`)是 row-level ⇒ **它也擋不住 TRUNCATE**。
-- ✅ 形狀照抄同族 `20260810140000_m4b_lifecycle_l5b_refund_ledger.sql:153-162`
--    的 `prl_append_only_guard`:**ROW 與 STATEMENT 兩種都掛。**
-- ⚠️ 全 repo 查無指向本表的 inbound FK ⇒ 不需要處理 `TRUNCATE … CASCADE` 的連帶。
CREATE FUNCTION public.pcm_d3d_manual_refund_no_truncate()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $fn$
BEGIN
  RAISE EXCEPTION
    '人工退款登記不得 TRUNCATE(帳不塗改)。'
    '🔴 TRUNCATE 不會觸發逐列守門, 而它會讓整本帳連同稽核痕跡一起消失 —— '
    '那比改一列更難查:沒有錯誤、沒有痕跡、也沒有人會知道曾經有過那些列。'
    USING ERRCODE = 'P2B48', CONSTRAINT = 'pcm_d3d_truncate_forbidden';
END
$fn$;

REVOKE ALL ON FUNCTION public.pcm_d3d_manual_refund_no_truncate()
  FROM PUBLIC, anon, authenticated, service_role, authenticator;

COMMENT ON FUNCTION public.pcm_d3d_manual_refund_no_truncate() IS
  'D3-d:order_manual_refunds 的 TRUNCATE 守門(STATEMENT-level)⇒ P2B48。'
  '🔴 存在理由:FOR EACH ROW 的 trigger 對 TRUNCATE **不觸發** ——'
  '既有的 DELETE 守門(20260824011000:152)是 row-level, 它擋不住 TRUNCATE。'
  '⚠️ 誠實邊界:owner 可 DISABLE / DROP 本 trigger 繞過, **不宣稱防得住它**(同族家法)。';

COMMENT ON FUNCTION public.pcm_d3d_manual_refund_immutable() IS
  'D3-d:order_manual_refunds 的 append-once 守門(BEFORE UPDATE、invoker、只看 OLD/NEW)。'
  '① 帳體九欄不可變(id/order_id/rail/refund_amount/reason/actor/occurred_at/created_at/request_id)⇒ P2B45。'
  '② 作廢是終態:OLD.voided_at 非 NULL 時, voided_at/void_reason/voided_by 一個字都不能再動 ⇒ P2B46。'
  '🔴 ② 同時擋【復活】與【改作廢理由】—— 後者是塗改稽核痕跡, 比復活更難發現。'
  '🔴 表上的 void_trio CHECK 只保證三向配對(0 或 3), **擋不住把三欄一起清掉** ⇒ 那正是 ② 要擋的。'
  '⚠️ 本片零資料修補:只管未來的 UPDATE, 既有被復活過的列(若有)本片看不到也不修。'
  '⚠️ **只動了機制 A** —— 卡片退款判定更正(order_refund_manual_corrections)本來就符合, 一個字沒動。'
  '行為的證人 = scripts/d3d-immutable-verify.sh(拋棄式 PG);本片的後置斷言只驗裝上去了與權限, 不驗行為。';

-- ══ 2. 掛上 ═══════════════════════════════════════════════════════════════
-- 🔴 **不加 WHEN** —— 條件式會讓某些形狀溜過去(照抄 op2b `:266-268` 的理由)。
--    成本是每次 UPDATE 多一次欄位比較,而本表的 UPDATE 全 repo 只有一條路徑
--    (`20260820100000_…d3b:358` 那支 void RPC)⇒ 成本可忽略。
CREATE TRIGGER order_manual_refunds_immutable_bu
  BEFORE UPDATE ON public.order_manual_refunds
  FOR EACH ROW
  EXECUTE FUNCTION public.pcm_d3d_manual_refund_immutable();

CREATE TRIGGER order_manual_refunds_no_truncate_bt
  BEFORE TRUNCATE ON public.order_manual_refunds
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.pcm_d3d_manual_refund_no_truncate();

-- 🔴 **`ENABLE ALWAYS`:關掉 `session_replication_role = replica` 那條繞路。**
--    (codex 2026-08-30 建議評估,本片採用。)
--    預設的 `ENABLE`(tgenabled='O')在 replica 模式下**不會觸發**;`ALWAYS`('A')會。
--    ⚠️ **而這與同族既有的兩支不同**(`prl_append_only_guard` / rail-cap 都是預設 O)——
--       這是刻意的偏離,多關一條路。
--    ⚠️ ~~上一版寫「成本為零」「拿掉這兩行即可」~~ —— **兩句都太滿**(codex R2 nit #1):
--       下方 A2c/A3c **要求 `tgenabled='A'`** ⇒ 只拿掉這兩行的話,後置斷言會回 P2B47、整筆 rollback。
--       ⇒ 要退回同族形狀,得**同時**把 A2c/A3c 的期望值改成接受 `'O'`。**那是兩處,不是兩行。**
--    🛑 它**仍然擋不住** owner 主動 DISABLE / DROP —— 那條路見檔頭的誠實邊界。
ALTER TABLE public.order_manual_refunds ENABLE ALWAYS TRIGGER order_manual_refunds_immutable_bu;
ALTER TABLE public.order_manual_refunds ENABLE ALWAYS TRIGGER order_manual_refunds_no_truncate_bt;

-- ══ 3. 後置斷言(同一交易;不過 ⇒ 整筆 ROLLBACK)══════════════════════════
-- ⚠️ **只驗「裝上去了」與「權限」,【不驗行為】**(理由見檔頭)。
DO $d3d_post2$
DECLARE
  v_tgtype   int2;
  v_tgfoid   oid;
  v_tgenab   "char";
  v_tgqual   pg_node_tree;
  v_secdef   boolean;
  v_cfg      text[];
  v_role     text;
  v_fn       oid;
  -- 🔴 **收權斷言清單**(家法:`migration-static-checks` 規則③ 讀的就是這一行,
  --    而它必須**自己一行** —— 寫在 `DECLARE` 同一行的話那支 awk 看不到)。
  --    它防的是「忘記收權」,**不防「忘記列」** ⇒ 本檔的可授權物件恰好 2 個,兩個都在。
  v_functions text[] := ARRAY['public.pcm_d3d_manual_refund_immutable()', 'public.pcm_d3d_manual_refund_no_truncate()']::text[];
BEGIN
  -- ── A1-A3:UPDATE 那支 ────────────────────────────────────────────────
  v_fn := 'public.pcm_d3d_manual_refund_immutable()'::regprocedure;
  SELECT t.tgtype, t.tgfoid, t.tgenabled, t.tgqual
    INTO v_tgtype, v_tgfoid, v_tgenab, v_tgqual
    FROM pg_catalog.pg_trigger t
   WHERE t.tgrelid = 'public.order_manual_refunds'::regclass
     AND t.tgname  = 'order_manual_refunds_immutable_bu'
     AND NOT t.tgisinternal;
  IF v_tgtype IS NULL THEN
    RAISE EXCEPTION 'D3-d A1:UPDATE 守門沒掛上'
      USING ERRCODE = 'P2B47', CONSTRAINT = 'pcm_d3d_trigger_missing';
  END IF;
  -- tgtype 位元:1=ROW 2=BEFORE 4=INSERT 8=DELETE 16=UPDATE 32=TRUNCATE
  IF (v_tgtype & 1) = 0 OR (v_tgtype & 2) = 0 OR (v_tgtype & 16) = 0 THEN
    RAISE EXCEPTION 'D3-d A1b:時機/事件不對(tgtype=%,要 BEFORE UPDATE FOR EACH ROW)', v_tgtype
      USING ERRCODE = 'P2B47', CONSTRAINT = 'pcm_d3d_trigger_shape';
  END IF;
  -- 🔴 負向:不該吃 INSERT / DELETE —— 多吃 INSERT 會把「登一筆新的」那條路一起擋掉,
  --    而那正是本片叫人去走的路。
  IF (v_tgtype & 4) <> 0 OR (v_tgtype & 8) <> 0 THEN
    RAISE EXCEPTION 'D3-d A1c:吃到了 INSERT 或 DELETE(tgtype=%)', v_tgtype
      USING ERRCODE = 'P2B47', CONSTRAINT = 'pcm_d3d_trigger_overreach';
  END IF;
  IF v_tgfoid <> v_fn THEN
    RAISE EXCEPTION 'D3-d A2:trigger 綁到了別支函式(tgfoid=%,期望 %)', v_tgfoid, v_fn
      USING ERRCODE = 'P2B47', CONSTRAINT = 'pcm_d3d_trigger_wrong_fn';
  END IF;
  IF v_tgqual IS NOT NULL THEN
    RAISE EXCEPTION 'D3-d A2b:trigger 帶了 WHEN 條件 ⇒ 某些形狀會溜過去(本片刻意不加 WHEN)'
      USING ERRCODE = 'P2B47', CONSTRAINT = 'pcm_d3d_trigger_has_when';
  END IF;
  IF v_tgenab <> 'A' THEN
    RAISE EXCEPTION 'D3-d A2c:tgenabled=% ⇒ 不是 ENABLE ALWAYS(D=已停用 / O=replica 模式下不觸發)', v_tgenab
      USING ERRCODE = 'P2B47', CONSTRAINT = 'pcm_d3d_trigger_not_always';
  END IF;

  -- ── A3:TRUNCATE 那支 ─────────────────────────────────────────────────
  v_fn := 'public.pcm_d3d_manual_refund_no_truncate()'::regprocedure;
  SELECT t.tgtype, t.tgfoid, t.tgenabled, t.tgqual
    INTO v_tgtype, v_tgfoid, v_tgenab, v_tgqual
    FROM pg_catalog.pg_trigger t
   WHERE t.tgrelid = 'public.order_manual_refunds'::regclass
     AND t.tgname  = 'order_manual_refunds_no_truncate_bt'
     AND NOT t.tgisinternal;
  IF v_tgtype IS NULL THEN
    RAISE EXCEPTION 'D3-d A3:TRUNCATE 守門沒掛上'
      USING ERRCODE = 'P2B47', CONSTRAINT = 'pcm_d3d_truncate_trigger_missing';
  END IF;
  -- STATEMENT-level ⇒ ROW 位元(1)必須是 0;要 BEFORE(2)+ TRUNCATE(32)
  IF (v_tgtype & 1) <> 0 OR (v_tgtype & 2) = 0 OR (v_tgtype & 32) = 0 THEN
    RAISE EXCEPTION 'D3-d A3b:TRUNCATE 守門形狀不對(tgtype=%,要 BEFORE TRUNCATE FOR EACH STATEMENT)', v_tgtype
      USING ERRCODE = 'P2B47', CONSTRAINT = 'pcm_d3d_truncate_shape';
  END IF;
  -- 🔴🔴 **codex R2 must-fix #2**:上一版這裡沒有禁止位元、也沒驗 `tgqual`。
  --    失敗情境(它給的可執行重現):把它改成
  --      `BEFORE UPDATE OR TRUNCATE … FOR EACH STATEMENT WHEN (false)`
  --    ⇒ 函式對、`ALWAYS` 對、A3b 也過(BEFORE+TRUNCATE 位元都在)
  --    ⇒ **A1-A6 全部印通過,而 TRUNCATE 照樣把表清空。**
  --    (PostgreSQL 允許 statement-level trigger 帶 `WHEN` —— 我原本以為不行,那是我沒查。)
  IF (v_tgtype & 4) <> 0 OR (v_tgtype & 8) <> 0 OR (v_tgtype & 16) <> 0 THEN
    RAISE EXCEPTION 'D3-d A3d:TRUNCATE 守門吃到了 INSERT/DELETE/UPDATE(tgtype=%)—— 它只該吃 TRUNCATE', v_tgtype
      USING ERRCODE = 'P2B47', CONSTRAINT = 'pcm_d3d_truncate_overreach';
  END IF;
  IF v_tgqual IS NOT NULL THEN
    RAISE EXCEPTION 'D3-d A3e:TRUNCATE 守門帶了 WHEN 條件 ⇒ `WHEN (false)` 會讓它完全不執行而 A3 仍印通過'
      USING ERRCODE = 'P2B47', CONSTRAINT = 'pcm_d3d_truncate_has_when';
  END IF;
  IF v_tgfoid <> v_fn OR v_tgenab <> 'A' THEN
    RAISE EXCEPTION 'D3-d A3c:TRUNCATE 守門綁錯函式或未 ENABLE ALWAYS(tgfoid=%,tgenabled=%)', v_tgfoid, v_tgenab
      USING ERRCODE = 'P2B47', CONSTRAINT = 'pcm_d3d_truncate_wrong_fn';
  END IF;

  -- ── A4-A5:兩支函式的屬性(以 regprocedure 釘簽章,不按 proname —— codex nit #8:
  --    同名 overload 存在時,按 proname 會查到錯的那一支)────────────────────
  FOR v_fn IN SELECT (unnest(v_functions))::regprocedure::oid
  LOOP
    SELECT p.prosecdef, p.proconfig INTO v_secdef, v_cfg
      FROM pg_catalog.pg_proc p WHERE p.oid = v_fn;
    IF v_secdef THEN
      RAISE EXCEPTION 'D3-d A4:% 不該是 SECURITY DEFINER(只看 OLD/NEW,不需要提權)', v_fn::regprocedure
        USING ERRCODE = 'P2B47', CONSTRAINT = 'pcm_d3d_unexpected_secdef';
    END IF;
    IF v_cfg IS NULL OR NOT ('search_path=pg_catalog, public' = ANY(v_cfg)) THEN
      RAISE EXCEPTION 'D3-d A5:% 的 search_path 沒有釘住(proconfig=%)', v_fn::regprocedure, v_cfg
        USING ERRCODE = 'P2B47', CONSTRAINT = 'pcm_d3d_search_path';
    END IF;

    -- ── A6:逐角色驗**有效權限**,不是驗 proacl 非 NULL ──────────────────
    -- 🔴🔴 **codex must-fix #5**:原本只驗 `proacl IS NOT NULL`。
    --    而「REVOKE 完再 GRANT EXECUTE TO anon」也會讓 proacl 非 NULL ⇒ 那一格是綠的,
    --    而 anon 仍然執行得了。⇒ **「ACL 欄有東西」與「不該有的角色沒有權限」是兩個宣稱。**
    --    ✅ `has_function_privilege` 問的是**有效權限**(含 PUBLIC 繼承),那才是要的那一個。
    FOREACH v_role IN ARRAY ARRAY['public', 'anon', 'authenticated', 'service_role', 'authenticator']
    LOOP
      IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role) OR v_role = 'public' THEN
        IF pg_catalog.has_function_privilege(v_role, v_fn, 'EXECUTE') THEN
          RAISE EXCEPTION 'D3-d A6:% 對 % 仍有 EXECUTE ⇒ REVOKE 沒有生效或被重新 GRANT 回去',
                          v_fn::regprocedure, v_role
            USING ERRCODE = 'P2B47', CONSTRAINT = 'pcm_d3d_execute_leak';
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'D3-d A1-A6 通過(兩支 trigger:掛上 / 事件 / 綁對函式 / 無 WHEN / ENABLE ALWAYS;';
  RAISE NOTICE '                兩支函式:invoker / search_path 釘住 / 五個角色皆無 EXECUTE)';
  RAISE NOTICE '🔴 行為【沒有】在這裡驗 —— 跑 scripts/d3d-immutable-verify.sh(拋棄式 PG)';
  RAISE NOTICE '🛑 owner 主動 DISABLE / DROP 這兩支 trigger 仍然繞得過去 —— 本片不宣稱防得住它';
END
$d3d_post2$;

COMMIT;
