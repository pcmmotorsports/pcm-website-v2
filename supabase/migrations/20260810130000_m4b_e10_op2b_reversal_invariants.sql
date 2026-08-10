-- ══════════════════════════════════════════════════════════════════════════
-- OP2b(T 片)· 沖銷不變式三件套 + DROP dormant gate(同交易)
-- ══════════════════════════════════════════════════════════════════════════
-- 塊規格 = `docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:655`。
-- 本片交付 = OP1 檔頭 **A9** 那條具名交付物的**全部三條驗收**(反號 / 擋環 / gate 同交易),
-- 三條在 OP1 檔頭 A10 逐字寫著,本檔**自帶一份**(主視窗 2026-08-10 R3-N1:
-- 不要只靠 grep 到 OP1 才看得見):
--   ① **反號**:沖銷列 `amount` = 被沖列 `amount` 的反號(`NEW.amount = -parent.amount`)。
--   ② **擋環**:自環與多列互指環,一律不得存在。
--   ③ **gate 同交易**:`order_payments_dormant_until_triggers` 的 DROP 必須與本片守門
--      在**同一支 migration、同一筆交易**,不得先 DROP 再另片建守門。
--
-- ── 🔴🔴 核心設計:環不是被「偵測」出來的,是**構造不出來**的 ────────────────
-- plan v1 原本要在 trigger 裡沿 `reverses_payment_id` 追鏈判環。**關卡1 打掉了**:
-- `BEFORE INSERT` 當下 `NEW` 尚未寫入、對誰都不可見,而既有列不可能指向一個還不存在的 id
-- ⇒ INSERT 面**追不出**多跳環;那段追鏈邏輯**整段刪掉、測試仍會全綠** = 零判別力的守門
-- (memory `feedback_unconstructible-negative-test-means-noop-guard`)。
--
-- 換路成兩條機制,環就成為**構造上不可能**:
--   (1) 插入時 parent **必須已經存在**(查不到就 RAISE)⇒ 每列的 parent 嚴格早於自己;
--   (2) `id` 與 `reverses_payment_id` 插入後**不可變**(下方不可變契約)⇒ 邊不會事後改指向。
-- ⇒ 沿 parent 走 = 沿「插入序嚴格更早」走 ⇒ **不可能回到起點**。
--
-- 🔴 **這是有前提的歸納,不是無條件事實**(關卡1 R2 #6 打回我原本的無條件寫法):
--   · 基底 = 本表**零列**(本片 apply 當下實測,見檔尾斷言)。
--   · 步進 = **一般 row-level DML** 且 origin trigger 啟用(`tgenabled = 'O'`,檔尾斷言)。
--   · **天花板(繞得過的,逐條寫明,不假裝擋住)**:
--       - `session_replication_role = 'replica'` ⇒ origin trigger 不發火。
--       - `ALTER TABLE … DISABLE TRIGGER` ⇒ 同上。兩者都需要 owner/superuser。
--       - `TRUNCATE` ⇒ **不觸發 row-level DELETE trigger**。本片**選擇不加** TRUNCATE 守門,
--         靠本表的**零 GRANT**(OP1 已 REVOKE ALL)擋住一般角色。**這是選擇,不是「擋住了」。**
--       - owner / superuser 一律在天花板之上。
--   · 一般 `COPY` **會**發火(不在天花板內)。
--
-- ── 🔴 可見性的精確規則(實測,不是推論)──────────────────────────────────
-- 拋棄式 PG17、交易內以等價 trigger 實測(2026-08-10;跑完 ROLLBACK、驗本表零列):
--   · 自環(一列指向自己)          ⇒ 被擋在「parent 取不到」(`P2B32`)
--       ⇒ **自環不另立守門**:它被 parent 存在性**嚴格蘊含**,另寫一條會是「寫不出只紅它的
--         負測」那族(memory `feedback_unconstructible-negative-test-means-noop-guard`)。
--   · multi-row VALUES 的互指環(前列指向後列)⇒ 被擋在 `P2B32`
--   · multi-row VALUES 的**合法**鏈(後列指向前列)⇒ **寫得進去**
--       ⇒ 規則 = 「**後面的列看得到前面的列、前面的看不到後面的**」。
-- ⚠️ **誠實邊界(關卡1 R2 #2;範圍已於本輪 code-reviewer nit 7 縮小)**:
--    · `INSERT … SELECT` 與 **data-modifying CTE** 的合法鏈:**該次實測觀察到寫得進**,
--      且 **sibling CTE 的互指環被擋在 `P2B32`**。
--      這兩條由 `scripts/op2b-verify.sh` 的 **G3 ②③④** 每次重跑重新觀察。
--    🔴 **口徑更正(2026-08-10,P 線 codex 論點,隨 OP3 片帶入)**:上一版寫「已實測寫得進」
--      並據此當成可依賴的形狀 —— **那句過強**。PG **不保證** multi-row / `INSERT … SELECT` /
--      CTE 的**列處理順序**;我們量到的是「在這個 PG 版本、這個計畫下會這樣跑」,
--      **不是語意保證**。⇒ 正確讀法:**這是一次(每跑一次就重驗一次的)觀察,不是契約**。
--      · 對**擋環**那一半無影響:擋環靠的是「parent 必須已存在」,那與順序無關、方向永遠安全。
--      · 對**合法鏈會不會被誤擋**那一半有影響:順序若改變,合法鏈可能開始紅在 `P2B32`
--        ⇒ 那是 **fail-closed** 的失敗方向(誤擋,不是誤放),所以是可用性風險、不是錢的風險。
--      ⇒ **writer 不得倚賴「同一 statement 內多列互指」這個形狀**;OP3 的 card 腿本來就一次插一列,
--        不受影響。要倚賴它的人請先自己重驗。
--    · **`COPY` 仍未實測** ⇒ 那個形狀下「合法鏈會不會被誤擋」**未確認**。
--    無環論證不依賴這三種寫法(它只需要「parent 必須已存在」+ 不可變),受影響的只是使用便利。
--    🔴 上一版這裡寫「對應探針在 op2b-verify.sh」而那裡當時**只有 VALUES 一種** ——
--      宣稱範圍大於實際驗到的範圍,是本 repo 記過的形狀;現在字面與 G3 的格數逐條對得上。
--
-- ── A2「append-only」到底是什麼(關卡1 R2 #1;逐欄契約,不用「除了…之外」)────
-- OP1 檔頭 A2 只說「append-only、更正走沖銷」,沒有欄位級定義 ⇒ 本片把它寫死:
--   · **可改(allowlist,只有這四欄)**:`note` / `payer_note` / `reviewed_by` / `reviewed_at`
--   · **其餘全部不可變**,逐欄列出(見 `pcm_op2b_immutable_columns` 函式體):
--     `id` `order_id` `rail` `amount` `reverses_payment_id` `received_at`
--     `rec_trade_id` `bank_reference` `request_id` `reversal_reason` `actor` `created_at`
--   🔴 為什麼 `request_id` 也不可變:它是人工軌的**冪等鍵**;改掉它就能拿舊值重登一筆付款
--      ⇒ append-only 照樣被破(關卡1 R2 #1 的失敗情境,原封收下)。
--   · **DELETE 一律擋**(`pcm_op2b_no_delete`)。少了它,「刪掉再重寫」就是 UPDATE 的替代路。
--
-- ── 發火序(關卡1 R2 #3 打回我的事實錯誤,已親驗重釘)───────────────────────
-- 🔴 我原本把 `pcm_op2_received_at_future` 當成 OP2a 的 trigger 名 —— **錯的**,那是
--    `…op2a_received_at_guard.sql:95` RAISE 裡的 **CONSTRAINT 標籤**;真 trigger 名在 `:108` =
--    `order_payments_received_at_not_future_biu`。PG 按 **trigger 名字**排序發火 ⇒ 名字選錯
--    會靜默改變「同時違反兩條時使用者看到哪一個錯誤」。
-- ⇒ 本片一律用 `order_payments_*` 同族命名,並把兩個面的序**逐字釘死**(檔尾斷言 + 雙重違規探針):
--   · **INSERT 面**:`order_payments_received_at_not_future_biu`(A8)
--                  → `order_payments_reversal_amount_bi`(A9)
--     ("rec" < "rev" ⇒ A8 先)⇒ 同時違反時,使用者看到的是 **A8 的 `P2B31`**。
--   · **UPDATE 面**:`order_payments_immutable_bu`
--                  → `order_payments_received_at_not_future_biu`(A8)
--     ("i" < "r" ⇒ 不可變先)⇒ 同時違反時,使用者看到的是 **不可變的 `P2B34`**。
--   · **DELETE 面**:只有 `order_payments_no_delete_bd` 一支。
--
-- ── SQLSTATE 分配(守門碼與哨兵碼必須不同,OP2a 檔頭已記過同款雷)──────────────
--   `P2B32` = 沖銷的 parent 取不到(**自環也走這條**)
--   `P2B33` = 沖銷金額不是被沖列的反號(A9 主體)
--   `P2B34` = 改到不可變欄
--   `P2B35` = 試圖 DELETE
--   `P2B20` = 檔尾驗收自己的哨兵(沿用本 repo 慣例,**不得**與上面任何一個相同)
--
-- ── 🔴 SECDEF 只給 A9,理由與代價 ────────────────────────────────────────
-- A9 要**讀本表**(`SELECT amount FROM order_payments WHERE id = …`),而本表是零 GRANT +
-- RLS 開啟零 policy ⇒ 以 invoker 身分跑會讀不到自己的 parent(關卡1 R2 #5:這與 OP2a 不同型,
-- OP2a 不讀任何別的列)。⇒ **A9 = SECURITY DEFINER + 固定 search_path**;
-- 另外兩支(不可變 / 擋 DELETE)只看 `OLD`/`NEW`、不讀表 ⇒ **維持 invoker**,不濫用 SECDEF。
-- 三支都顯式 `REVOKE`(memory `reference_supabase-service-role-execute-default-grant`:
-- 新函式的 EXECUTE 預設會漏),並在檔尾用**三層** ACL 斷言(`proacl IS NOT NULL` /
-- 非 owner grantee 為零 / 四個具名角色的有效 EXECUTE 皆為假)。
--
-- 🔴🔴 **SECDEF 的身分不能靠「誰跑了這支 migration」**(關卡2 #5,本片最危險的一條)──────
-- `SECURITY DEFINER` 的執行身分 = 函式的 **owner**,而 owner 預設 = 執行 `CREATE FUNCTION`
-- 的 `current_user`。若正式站的 migration runner **不是本表 owner 且無 BYPASSRLS**,
-- A9 就**永遠讀不到 parent** ⇒ 每一筆合法沖銷都被判成 `P2B32`(parent 不存在)而全擋。
-- 🔴 而 apply 當下那三發負向探針**仍然會通過** —— 它們期望的就是 `P2B32`
--    ⇒ 「負測恆真、功能其實壞掉」。負測全綠證明不了 A9 是**因為對的理由**紅的。
-- ⇒ 兩道處置(缺一不可):
--   ① **owner 釘死到本表 owner**(下方 `ALTER FUNCTION … OWNER TO`,用本表 `relowner` 動態取)。
--      runner 若不是該 role 的成員,`ALTER` 會當場失敗 ⇒ **整片 apply 失敗**,
--      這正是要的:寧可大聲炸掉,也不要帶著一支讀不到 parent 的 A9 上線。
--   ② **檔尾正向可讀性斷言**(下方 ⑧):A9 的 owner = 表 owner、對 `id`/`amount` 有 SELECT、
--      且本表 **FORCE RLS 關著**(FORCE 開著時連 owner 都受零 policy 管 ⇒ 一樣讀不到)。
--      三者是「A9 讀得到 parent」的充分條件,逐條驗、不靠 OP1 當時驗過。
--
-- ── 回滾(關卡1 R2 #7;兩態不同,不可混用)──────────────────────────────────
-- · **態一:本表零列(= 本片 apply 當下的狀態)** —— 可原樣回滾,逐步:
--     BEGIN; DROP TRIGGER 三支; DROP FUNCTION 三支(連同它們的 ACL 一起消失);
--     ALTER TABLE public.order_payments ADD CONSTRAINT order_payments_dormant_until_triggers
--       CHECK (false); COMMIT;
--   ⚠️ 只 DROP trigger 不 DROP function = **沒有回到原狀**(函式與 ACL 留著)。
-- · **態二:已經有資料** —— **不得**原樣恢復 dormant gate(`CHECK (false)` 會擋掉所有新收款,
--   等於關掉收錢)。正確做法:
--     ① 先 `ALTER TABLE … ADD CONSTRAINT … CHECK (false) NOT VALID` 只凍結**新的** INSERT/UPDATE
--        (既有列不重驗)⇒ 不留無守門窗口;
--     ② 停掉 OP3/OP5 writer;
--     ③ 全表驗不變式(每列沖銷是否反號、有無環);
--     ④ 另開 **forward repair** migration,不走 down migration;
--     ⑤ 驗證失敗 ⇒ 停在 ② 的狀態 raise,**不自行恢復 writer**。
--
-- ── ⛔ apply 停點(Sean 拍板才 apply;本輪 code-reviewer MF2 補)────────────
-- 🔴 **本片是開閘片**:它 DROP 掉 `order_payments_dormant_until_triggers`,
--    收款帳本從此**可寫**。這不是一支「加守門」的 migration,是一支**放行**的 migration
--    ⇒ apply 之後 OP3/OP5 的 writer 就能真的把錢寫進本表,回頭關閘要走檔頭「回滾 · 態二」
--    (不得原樣加回 `CHECK (false)`,那等於關掉收錢)。
-- ⛔ **因此:apply = Sean 停點。** 施工窗與夜跑一律**不得自行 apply 正式庫**;
--    preflight 照 W 線規矩(`bash scripts/w7-coverage.sh record all` 全綠 + 本片
--    `scripts/op2b-verify.sh all` 全綠 + 全新 provision 套完全部 migration 綠)跑完,
--    把結果交給 Sean,由他決定何時開閘。
--
-- ── apply 前置(硬的)────────────────────────────────────────────────────
-- · 先 `SHOW server_version;`。**PG<17 要拿掉 `transaction_timeout`(本檔一處)**。
--   本檔**沒有**用 `MAINTAIN`(那是 OP1 的兩處之一),不必動 privilege 陣列。
-- · 發布序 **OP1 → OP2a → OP2b**,不得跳號;本片自己會斷言 OP2a 的 trigger 還在。
-- ══════════════════════════════════════════════════════════════════════════
BEGIN;

-- 🔴 CREATE TRIGGER 對 order_payments 取 SHARE ROW EXCLUSIVE 且持到 COMMIT(OP2a :71 同款)。
--    5 秒等不到就整片回滾、改挑離峰重跑,不賭。
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL transaction_timeout = '90s';

-- ── A9:沖銷金額必須是被沖列的反號(SECDEF,唯一讀表的那支)────────────────
CREATE FUNCTION public.pcm_op2b_reversal_amount()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $fn$
DECLARE v_parent_amount integer;
BEGIN
  -- 🔴 這一句同時撐起三件事,不要當成「順手查一下」:
  --    ① A9 的比較對象 ② 自環的擋法(BEFORE INSERT 當下自己還沒寫入 ⇒ 查不到自己)
  --    ③ 無環歸納的步進條件(parent 嚴格早於自己)。
  SELECT amount INTO v_parent_amount
    FROM public.order_payments
   WHERE id = NEW.reverses_payment_id;

  IF NOT FOUND THEN
    -- 🔴 訊息帶一句**分流診斷**(R3 C1):這條碼有兩個成因,現場分不出來就會查錯方向 ——
    --    ① 真的沒有那一列(資料問題)② A9 的 SECDEF 身分讀不到本表(owner 或 FORCE RLS
    --    在 apply 之後被改動),那時**每一筆合法沖銷都會紅在這裡**。檔尾 ⑧ 只保 apply 那一刻。
    RAISE EXCEPTION '沖銷指向的收款列不存在(reverses_payment_id=%)⇒ 沖銷之沖銷要指向已經寫進帳的列;指向自己也走這條。'
                    '🔴 若該 id 以 admin/owner 身分查得到那一列,問題就不是資料,而是本 trigger(SECURITY DEFINER)讀不到本表 —— '
                    '查 pcm_op2b_reversal_amount 的 owner 是否仍 = order_payments 的 owner、以及本表是否被開了 FORCE ROW LEVEL SECURITY',
                    NEW.reverses_payment_id
      USING ERRCODE = 'P2B32', CONSTRAINT = 'pcm_op2b_reversal_parent_missing';
  END IF;

  -- 🔴 `IS DISTINCT FROM` 不是 `<>`(本輪 code-reviewer nit 4):`<>` 在任一邊為 NULL 時得 NULL,
  --    IF 就走 ELSE = **放行**。今天 `amount` 是 NOT NULL 所以兩者等價,但那是**外部前提**,
  --    寫成 `IS DISTINCT FROM` 就不必依賴它(零成本,且 NULL 進來時 fail-closed)。
  IF NEW.amount IS DISTINCT FROM -v_parent_amount THEN
    RAISE EXCEPTION '沖銷金額必須是被沖列的反號(本列=%,被沖列=%,應為 %)',
                    NEW.amount, v_parent_amount, -v_parent_amount
      USING ERRCODE = 'P2B33', CONSTRAINT = 'pcm_op2b_reversal_amount_mismatch';
  END IF;

  RETURN NEW;
END
$fn$;

-- 🔴 SECDEF 身分釘死到本表 owner(檔頭「SECDEF 的身分不能靠誰跑了這支 migration」)。
--    動態取 `relowner` 而不是寫死角色名:各環境(本機拋棄庫 / Supabase 正式站)的 owner 名字不同,
--    寫死會在其中一邊炸掉;要釘的不變式是「= 本表 owner」,不是「= postgres」。
DO $op2b_pin_owner$
DECLARE v_owner text;
BEGIN
  SELECT pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(c.relowner)) INTO v_owner
    FROM pg_catalog.pg_class c WHERE c.oid = 'public.order_payments'::regclass;
  EXECUTE pg_catalog.format('ALTER FUNCTION public.pcm_op2b_reversal_amount() OWNER TO %s', v_owner);
END
$op2b_pin_owner$;

REVOKE ALL ON FUNCTION public.pcm_op2b_reversal_amount()
  FROM PUBLIC, anon, authenticated, service_role, authenticator;

-- ── 不可變欄(invoker;只看 OLD/NEW,不讀表)────────────────────────────────
CREATE FUNCTION public.pcm_op2b_immutable_columns()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $fn$
DECLARE v_bad text;
BEGIN
  -- 🔴 逐欄列出、不用「除了 allowlist 以外」的動態寫法:欄位日後新增時,
  --    動態寫法會**自動放行**新欄(靜默擴大可改面),逐欄寫死則是新增欄位時當場想起要決定。
  --    可改的只有:note / payer_note / reviewed_by / reviewed_at。
  v_bad := pg_catalog.concat_ws(', ',
    CASE WHEN NEW.id                  IS DISTINCT FROM OLD.id                  THEN 'id' END,
    CASE WHEN NEW.order_id            IS DISTINCT FROM OLD.order_id            THEN 'order_id' END,
    CASE WHEN NEW.rail                IS DISTINCT FROM OLD.rail                THEN 'rail' END,
    CASE WHEN NEW.amount              IS DISTINCT FROM OLD.amount              THEN 'amount' END,
    CASE WHEN NEW.reverses_payment_id IS DISTINCT FROM OLD.reverses_payment_id THEN 'reverses_payment_id' END,
    CASE WHEN NEW.received_at         IS DISTINCT FROM OLD.received_at         THEN 'received_at' END,
    CASE WHEN NEW.rec_trade_id        IS DISTINCT FROM OLD.rec_trade_id        THEN 'rec_trade_id' END,
    CASE WHEN NEW.bank_reference      IS DISTINCT FROM OLD.bank_reference      THEN 'bank_reference' END,
    CASE WHEN NEW.request_id          IS DISTINCT FROM OLD.request_id          THEN 'request_id' END,
    CASE WHEN NEW.reversal_reason     IS DISTINCT FROM OLD.reversal_reason     THEN 'reversal_reason' END,
    CASE WHEN NEW.actor               IS DISTINCT FROM OLD.actor               THEN 'actor' END,
    CASE WHEN NEW.created_at          IS DISTINCT FROM OLD.created_at          THEN 'created_at' END);

  IF v_bad IS NOT NULL AND v_bad <> '' THEN
    RAISE EXCEPTION '這些欄位不可變更:%(可改的只有 note / payer_note / reviewed_by / reviewed_at;更正走沖銷,不是改列)',
                    v_bad
      USING ERRCODE = 'P2B34', CONSTRAINT = 'pcm_op2b_immutable_violation';
  END IF;

  RETURN NEW;
END
$fn$;

REVOKE ALL ON FUNCTION public.pcm_op2b_immutable_columns()
  FROM PUBLIC, anon, authenticated, service_role, authenticator;

-- ── 擋 DELETE(invoker)────────────────────────────────────────────────────
CREATE FUNCTION public.pcm_op2b_no_delete()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $fn$
BEGIN
  RAISE EXCEPTION '收款帳本不得刪列(id=%)⇒ 登錯走沖銷(reverses_payment_id),刪掉重寫等於繞過 append-only',
                  OLD.id
    USING ERRCODE = 'P2B35', CONSTRAINT = 'pcm_op2b_delete_forbidden';
END
$fn$;

REVOKE ALL ON FUNCTION public.pcm_op2b_no_delete()
  FROM PUBLIC, anon, authenticated, service_role, authenticator;

-- ── 掛上(命名決定發火序,見檔頭「發火序」那段)────────────────────────────
CREATE TRIGGER order_payments_reversal_amount_bi
  BEFORE INSERT ON public.order_payments
  FOR EACH ROW WHEN (NEW.reverses_payment_id IS NOT NULL)
  EXECUTE FUNCTION public.pcm_op2b_reversal_amount();

-- 🔴 不可變那支**不加 WHEN**:條件式會讓「把沖銷列改成收款列」這種形狀溜過去
--    (關卡1 R2 #4 的失敗情境之一)。無條件跑,成本是每次 UPDATE 多一次欄位比較。
CREATE TRIGGER order_payments_immutable_bu
  BEFORE UPDATE ON public.order_payments
  FOR EACH ROW EXECUTE FUNCTION public.pcm_op2b_immutable_columns();

CREATE TRIGGER order_payments_no_delete_bd
  BEFORE DELETE ON public.order_payments
  FOR EACH ROW EXECUTE FUNCTION public.pcm_op2b_no_delete();

COMMENT ON FUNCTION public.pcm_op2b_reversal_amount() IS
  'OP2b / A9:沖銷列金額必須是被沖列金額的反號,且被沖列必須已存在。'
  '🔴 「被沖列必須已存在」同時是**無環**的來源(parent 嚴格早於子列)與**自環**的擋法;'
  'SECURITY DEFINER 是因為本表零 GRANT + RLS 零 policy,invoker 讀不到 parent。P2B32=parent 不存在、P2B33=非反號。';
COMMENT ON FUNCTION public.pcm_op2b_immutable_columns() IS
  'OP2b:order_payments 的欄位不可變契約。可改的只有 note / payer_note / reviewed_by / reviewed_at,其餘十二欄逐欄擋(P2B34)。'
  '🔴 request_id 也不可變 —— 它是人工軌的冪等鍵,改掉它就能拿舊值重登一筆付款。';
COMMENT ON FUNCTION public.pcm_op2b_no_delete() IS
  'OP2b:order_payments 一律不得 DELETE(P2B35)。🔴 天花板:TRUNCATE 不觸發 row-level trigger,'
  '本表靠零 GRANT 擋一般角色 —— 那是選擇,不是「TRUNCATE 被擋住了」。';

-- ══════════════════════════════════════════════════════════════════════════
-- 探針(SAVEPOINT 內暫移 dormant gate 才跑得到 A9;跑完 ROLLBACK TO)
-- 🔴 關卡1 R2 #4:原本規劃「建 A9 → 探針 → 最後 DROP gate」——**證不到東西**,
--    因為 gate 還在時任何 INSERT 都先被 `CHECK (false)` 擋掉,連 A9 都輪不到發火。
--    ⇒ 探針必須在**暫時沒有 gate** 的狀態下跑,而且要能完整回滾。
-- 🔴 這裡**只有三發負向探針**(N1 parent 不存在 / N2 自環 / N3 multi-row 互指環),
--    三發都在各自的例外子交易內失敗、**零列寫進本表**(它們的候選列全被 A9 擋在寫入之前)。
--    正向與所有需要既有列的負向 ⇒ `scripts/op2b-verify.sh`,理由見下方 DO 區塊開頭。
-- ══════════════════════════════════════════════════════════════════════════
-- 🔴 SAVEPOINT 在**這裡**(SQL 頂層)不是在 DO 裡:plpgsql 沒有 SAVEPOINT 語法,
--    而探針會真的 DROP gate ⇒ 沒有這一層,那個 DROP 的副作用會留到 COMMIT。
SAVEPOINT op2b_probe;

DO $op2b_probes$
DECLARE v_state text;
        -- 🔴 假 actor:三發探針都在 A9 紅掉,而 FK 是**在 statement 結束才檢查**
        --    ⇒ 探針根本不需要真的 staff。第一版在這裡查 `public.staff` 取不到就 RAISE,
        --      等於讓 migration 依賴業務資料(空 staff 的乾淨環境會直接 `P2B20` 套不上),
        --      而那正是同一個 DO 區塊下面在數落第一版 orders fixture 的同款錯(關卡2 #1)。
        v_actor CONSTANT text := 'OP2B-PROBE-FAKE-ACTOR';
BEGIN
  -- 🔴🔴 **apply 當下只跑「不依賴業務資料」的負向探針,正向全部交給 harness。**
  --    第一版我在這裡要求抓一筆真的 orders 當 fixture、取不到就 RAISE —— 實跑當場證明那是錯的:
  --    **全新的庫在 migration 階段 orders 是空的**(種子資料在 migration 之後才進),
  --    於是這支 migration 在任何空庫都套不上。migration 不得依賴業務資料存在。
  --    ⇒ 這裡只留三發**在 FK 之前就會紅**的負向探針(OP1 檔頭實測過的求值序:
  --      BEFORE trigger → CHECK → 寫入 → FK ⇒ 假 order_id 打真表是安全的);
  --      正向(合法鏈落值、值沒被偷改、allowlist 欄可改)與需要既有列的負向(改欄、DELETE、
  --      UPDATE 面雙重違規)一律在 `scripts/op2b-verify.sh` 跑,那裡有種子資料。
  --    ⚠️ 誠實邊界:**apply 當下沒有證明「trigger 不吞列、不偷改欄位」** —— 那條證據在 harness,
  --      不在這支 migration 的 NOTICE 裡。不要把下面那行 NOTICE 讀成「行為全驗過了」。
  ALTER TABLE public.order_payments DROP CONSTRAINT order_payments_dormant_until_triggers;

  -- ── N1 parent 不存在(A9 主體的存在性那半)──────────────────────────
  BEGIN
    INSERT INTO public.order_payments (order_id, rail, amount, received_at,
                                       reverses_payment_id, reversal_reason, actor)
    VALUES ('00000000-0000-0000-0000-0000000000aa', 'card', -500, now(),
            '00000000-0000-0000-0000-0000000000ff', 'probe', v_actor);
    RAISE EXCEPTION 'N1:指向不存在 parent 的沖銷竟然寫進去了'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2b_n1_not_blocked';
  EXCEPTION
    WHEN SQLSTATE 'P2B20' THEN RAISE;
    WHEN others THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      IF v_state <> 'P2B32' THEN
        RAISE EXCEPTION 'N1 被擋但 SQLSTATE=%(期望 P2B32)⇒ 擋它的不是 A9,可能是 FK 或別條 CHECK', v_state
          USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2b_n1_wrong_blocker';
      END IF;
  END;

  -- ── N2 自環(被 parent 存在性嚴格蘊含,不另立碼)──────────────────────
  BEGIN
    INSERT INTO public.order_payments (id, order_id, rail, amount, received_at,
                                       reverses_payment_id, reversal_reason, actor)
    VALUES ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000aa',
            'card', -500, now(), '00000000-0000-0000-0000-00000000f001', 'probe', v_actor);
    RAISE EXCEPTION 'N2:自環竟然寫進去了 ⇒ 無環論證的第一根柱子不成立'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2b_n2_not_blocked';
  EXCEPTION
    WHEN SQLSTATE 'P2B20' THEN RAISE;
    WHEN others THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      IF v_state <> 'P2B32' THEN
        RAISE EXCEPTION 'N2 自環被擋但 SQLSTATE=%(期望 P2B32=parent 取不到)', v_state
          USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2b_n2_wrong_blocker';
      END IF;
  END;

  -- ── N3 multi-row VALUES 的互指環(前列指向後列)⇒ 環在 INSERT 面構造不出來 ──
  BEGIN
    INSERT INTO public.order_payments (id, order_id, rail, amount, received_at,
                                       reverses_payment_id, reversal_reason, actor)
    VALUES ('00000000-0000-0000-0000-00000000f002', '00000000-0000-0000-0000-0000000000aa',
            'card', -300, now(), '00000000-0000-0000-0000-00000000f003', 'probe A', v_actor),
           ('00000000-0000-0000-0000-00000000f003', '00000000-0000-0000-0000-0000000000aa',
            'card',  300, now(), '00000000-0000-0000-0000-00000000f002', 'probe B', v_actor);
    RAISE EXCEPTION 'N3:multi-row 互指環竟然寫進去了 ⇒ 環在 INSERT 面構造得出來,無環論證倒了'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2b_n3_not_blocked';
  EXCEPTION
    WHEN SQLSTATE 'P2B20' THEN RAISE;
    WHEN others THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      IF v_state <> 'P2B32' THEN
        RAISE EXCEPTION 'N3 互指環被擋但 SQLSTATE=%(期望 P2B32)', v_state
          USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2b_n3_wrong_blocker';
      END IF;
  END;

  RAISE NOTICE 'OP2b apply 當下的負向探針通過:N1 parent 不存在 / N2 自環 / N3 multi-row 互指環,三發皆紅在 P2B32(A9 的存在性那半)。🔴 正向與需要既有列的負向不在這裡,見 scripts/op2b-verify.sh';
END
$op2b_probes$;

-- 🔴 探針的副作用在這裡整段消失 —— 實際上只有**那一發 DROP gate**:
--    三發探針的候選列全部被 A9 擋在寫入之前,本表從頭到尾零列(檔尾 ⑦ 再驗一次)。
--    (關卡2 nit 13:上一版這裡寫「十幾列 probe 資料」,是改成純負向探針之前的殘留字面。)
--    ROLLBACK TO 之後 savepoint 仍在,要 RELEASE 才乾淨。
ROLLBACK TO SAVEPOINT op2b_probe;
RELEASE SAVEPOINT op2b_probe;

-- ══════════════════════════════════════════════════════════════════════════
-- DROP dormant gate —— **本片最後一個動作之前**,先證前置還在
-- 🔴 關卡1 R2 #6:不能只依賴「OP2a 當時驗過零列」。DROP 是不可逆的放行動作,
--    它的每一個前提都要在**這一刻**重新確認,而不是引用別片的舊觀察。
-- 🔴 關卡1 R2 #4:DROP 前要重新驗 OP2a 存活(不然本片可能在 A8 已被誰拿掉的世界裡放行寫入)。
-- ══════════════════════════════════════════════════════════════════════════
DO $op2b_pre_drop$
DECLARE v_n integer; v_def text;
BEGIN
  -- ① OP2a 的 A8 閘還在,而且**還是那一支**(發布序 OP1→OP2a→OP2b 的前置)
  -- 🔴 關卡2 #2:只用**名字**判存活擋不住「同名但綁到別的函式 / 被改成 AFTER / 被加上縮窄的
  --    WHEN / 被 DISABLE」—— 那四種形狀下 A8 其實已經不守了,而本片照樣放行 DROP gate。
  --    ⇒ 逐條驗 `tgfoid`(綁哪支函式)+ `tgtype`(BEFORE INSERT OR UPDATE ROW = 1+2+16+4 = 23,
  --      實測值見下方 ③ 的位元說明)+ `tgenabled`('O' 才會在一般 DML 發火)
  --      + `tgqual IS NULL`(A8 無 WHEN;有 WHEN 就是被縮窄過)。
  SELECT pg_catalog.count(*)::integer INTO v_n FROM pg_catalog.pg_trigger
   WHERE tgrelid = 'public.order_payments'::regclass
     AND NOT tgisinternal
     AND tgname = 'order_payments_received_at_not_future_biu'
     AND tgfoid = 'public.pcm_op2_received_at_not_future()'::regprocedure
     AND tgtype = 23
     AND tgenabled = 'O'
     AND tgqual IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'OP2a 的 A8 trigger 不在或已被改過(名字+函式+BEFORE INSERT OR UPDATE ROW+origin 啟用+無 WHEN 的完整比對 count=%)⇒ 發布序或 A8 本體被破壞,拒絕 DROP gate', v_n
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2b_op2a_missing';
  END IF;

  -- ② gate 本身還在、還是 CHECK (false)、而且是 validated(NOT VALID 的 gate 擋不住既有列)
  SELECT pg_catalog.pg_get_constraintdef(oid) INTO v_def
    FROM pg_catalog.pg_constraint
   WHERE conname = 'order_payments_dormant_until_triggers'
     AND conrelid = 'public.order_payments'::regclass
     AND convalidated;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'dormant gate 不在或未 validated ⇒ 本片的前提(它一路擋著)不成立,拒絕繼續'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2b_gate_absent';
  END IF;
  -- 🔴 關卡2 #3:原本用 `ILIKE '%false%'` —— `CHECK (false OR true)`、
  --    `CHECK (amount <> 0 OR false)` 這種掏空版照樣命中,子字串證明不了它擋得住什麼。
  --    ⇒ 改**逐字**比對。期望字面 = 實測:PG 17.10 對 `CONSTRAINT … CHECK (false)`
  --      的 `pg_get_constraintdef` 渲染就是 `CHECK (false)`(2026-08-10 拋棄式 PG17 實跑取樣)。
  IF v_def <> 'CHECK (false)' THEN
    RAISE EXCEPTION 'dormant gate 的定義不是逐字 CHECK (false)(實得 [%])⇒ 它可能已被掏空,期間可能已有列寫進來', v_def
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2b_gate_hollowed';
  END IF;

  -- ③ 無環歸納的**基底**:本表零列。有列 = 那些列沒被本片的守門驗過,歸納不成立。
  SELECT pg_catalog.count(*)::integer INTO v_n FROM public.order_payments;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '本表已有 % 列 ⇒ 無環歸納的基底(零列)不成立,那些列從未被 A9 驗過。'
                    '處置見檔頭「回滾 · 態二」:先凍結、驗全表不變式、走 forward repair,不要硬 DROP gate', v_n
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2b_base_not_empty';
  END IF;
END
$op2b_pre_drop$;

ALTER TABLE public.order_payments DROP CONSTRAINT order_payments_dormant_until_triggers;

-- ══════════════════════════════════════════════════════════════════════════
-- 檔尾 fail-closed 結構驗收(DROP 之後才驗得到終態)
-- ══════════════════════════════════════════════════════════════════════════
DO $op2b_asserts$
DECLARE
  v_n integer; v_bad text; v_oid oid; v_names text;
BEGIN
  -- ① gate 確實已經不在(本片的核心動作真的發生了)
  SELECT pg_catalog.count(*)::integer INTO v_n FROM pg_catalog.pg_constraint
   WHERE conname = 'order_payments_dormant_until_triggers'
     AND conrelid = 'public.order_payments'::regclass;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'dormant gate 還在(count=%)⇒ 本片沒真的放行,OP3/OP5 會寫不進去', v_n
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2b_gate_still_there';
  END IF;

  -- ② 本表的非 internal trigger 集合**逐字凍結**(多一支少一支都紅),並驗全部是 origin 啟用。
  --    🔴 `tgenabled` 四態:'O'=origin(一般 DML 發火、replica 模式不發火)、'D'=停用、
  --       'R'=只在 replica 模式發火、'A'=always(**兩種模式都發火**)。
  --       關卡2 nit 12:上一版把 'A' 和 'R' 併成「replica 模式相關」—— 不對,'A' 在一般 DML
  --       **會**發火。本片仍然只收 'O':步進條件只需要 'O',而 'A' 代表有人動過發火設定
  --       ⇒ 那本身就該紅一次讓人看見(從嚴,不是因為 'A' 擋不住)。
  SELECT pg_catalog.string_agg(tgname, ',' ORDER BY tgname),
         pg_catalog.count(*)::integer
    INTO v_names, v_n
    FROM pg_catalog.pg_trigger
   WHERE tgrelid = 'public.order_payments'::regclass AND NOT tgisinternal;
  IF v_names IS DISTINCT FROM 'order_payments_immutable_bu,order_payments_no_delete_bd,'
                              'order_payments_received_at_not_future_biu,order_payments_reversal_amount_bi' THEN
    RAISE EXCEPTION 'trigger 集合不符(實得 [%])⇒ 少一支、多一支、或改了名(改名會改發火序)都在這裡紅',
                    coalesce(v_names, '(無)')
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2b_trigger_set';
  END IF;
  SELECT pg_catalog.string_agg(tgname || '=' || tgenabled::text, ', ' ORDER BY tgname) INTO v_bad
    FROM pg_catalog.pg_trigger
   WHERE tgrelid = 'public.order_payments'::regclass AND NOT tgisinternal AND tgenabled <> 'O';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '有 trigger 不是 origin 啟用(%)⇒ 一般 DML 不會發火,無環歸納的步進條件不成立', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2b_trigger_disabled';
  END IF;

  -- ③ 綁定逐字:tgtype 位元 **ROW=1、BEFORE=2、INSERT=4、DELETE=8、UPDATE=16**
  --    🔴 關卡2 nit 12:上一版註解把 BEFORE 寫成 1(與 ROW 同值)—— 事實錯誤。
  --      實測(2026-08-10 拋棄式 PG17.10):`AFTER INSERT … FOR EACH ROW` = 5 = ROW(1)+INSERT(4)
  --      ⇒ BEFORE 那一位的權重 = 7-5 = **2**。期望值 7/19/11 本身沒錯,錯的是它們怎麼被拆解。
  --    A9=BEFORE INSERT ROW ⇒ 1+2+4=7(且**必須**帶 WHEN);不可變=BEFORE UPDATE ROW ⇒ 1+2+16=19;
  --    擋刪=BEFORE DELETE ROW ⇒ 1+2+8=11。寫死才擋得住「被改成 AFTER」或「多掛一個事件」。
  SELECT pg_catalog.string_agg(tgname || '=' || tgtype::text, ', ' ORDER BY tgname) INTO v_bad
    FROM pg_catalog.pg_trigger
   WHERE tgrelid = 'public.order_payments'::regclass AND NOT tgisinternal
     AND tgname IN ('order_payments_reversal_amount_bi','order_payments_immutable_bu','order_payments_no_delete_bd')
     AND tgtype <> CASE tgname
                     WHEN 'order_payments_reversal_amount_bi' THEN 7
                     WHEN 'order_payments_immutable_bu'       THEN 19
                     WHEN 'order_payments_no_delete_bd'       THEN 11
                   END;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'trigger 綁定的事件/時機不對(%)⇒ BEFORE/ROW/事件被改過', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2b_trigger_binding';
  END IF;

  -- ③b 綁到**哪一支函式**逐支釘死。
  -- 🔴 關卡2 #4:②③ 只驗名字與 tgtype ⇒ 有人把 `order_payments_reversal_amount_bi` 改綁到
  --    一支 `RETURN NEW` 的空函式,集合、位元、啟用狀態**全部照樣綠**,而 A9 已經整條消失。
  SELECT pg_catalog.string_agg(tgname || '→' || tgfoid::regprocedure::text, ', ' ORDER BY tgname) INTO v_bad
    FROM pg_catalog.pg_trigger
   WHERE tgrelid = 'public.order_payments'::regclass AND NOT tgisinternal
     AND tgname IN ('order_payments_reversal_amount_bi','order_payments_immutable_bu','order_payments_no_delete_bd')
     AND tgfoid <> CASE tgname
                     WHEN 'order_payments_reversal_amount_bi' THEN 'public.pcm_op2b_reversal_amount()'::regprocedure
                     WHEN 'order_payments_immutable_bu'       THEN 'public.pcm_op2b_immutable_columns()'::regprocedure
                     WHEN 'order_payments_no_delete_bd'       THEN 'public.pcm_op2b_no_delete()'::regprocedure
                   END;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'trigger 綁到的函式不對(%)⇒ 名字還在、守門已被換掉', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2b_trigger_function';
  END IF;

  -- ③c WHEN 條件逐字:A9 **必須恰好是**那一條;另兩支**必須無** WHEN。
  -- 🔴 關卡2 #4 的要害:A9 的 WHEN 若被縮成 `NEW.reverses_payment_id IS NOT NULL AND NEW.amount < 0`,
  --    **正額的沖銷之沖銷就整批繞過 A9**(金額不必是反號、parent 不必存在),
  --    而上面每一道結構驗收都還是綠的。tgqual 是 node tree、`pg_get_expr` 對它會報
  --    「expression contains variables of more than one relation」(OLD/NEW 兩個 varno,實測),
  --    ⇒ 從 `pg_get_triggerdef` 把 WHEN 段切出來比。期望字面為實測值(同日 PG17.10 取樣)。
  -- 🔴 另兩支**無** WHEN 同樣要驗:不可變那支一旦被加上條件,「把沖銷列改成收款列」那種形狀
  --    就從守門底下溜過去(檔頭「不可變那支不加 WHEN」那段的守門面)。
  SELECT pg_catalog.string_agg(
           tgname || '→' || coalesce(pg_catalog.substring(pg_catalog.pg_get_triggerdef(oid),
                                                          'WHEN \((.*)\) EXECUTE FUNCTION'), '(無 WHEN)'),
           ', ' ORDER BY tgname) INTO v_bad
    FROM pg_catalog.pg_trigger
   WHERE tgrelid = 'public.order_payments'::regclass AND NOT tgisinternal
     AND tgname IN ('order_payments_reversal_amount_bi','order_payments_immutable_bu','order_payments_no_delete_bd')
     AND coalesce(pg_catalog.substring(pg_catalog.pg_get_triggerdef(oid),
                                                          'WHEN \((.*)\) EXECUTE FUNCTION'), '')
         <> CASE tgname
              WHEN 'order_payments_reversal_amount_bi' THEN '(new.reverses_payment_id IS NOT NULL)'
              ELSE ''
            END;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'trigger 的 WHEN 條件不對(%)⇒ A9 期望逐字 [(new.reverses_payment_id IS NOT NULL)]、另兩支必須無 WHEN', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2b_trigger_when';
  END IF;

  -- ③d 三支函式**恰好都在**。
  -- 🔴 關卡2 #6:下面 ④⑤⑥ 每一道都是「篩出違規的那幾列、`string_agg` 出來是不是 NULL」——
  --    函式若整支不見,`WHERE proname IN (…)` 直接零列、`string_agg` 得 NULL ⇒ **整組真空通過**。
  --    ⇒ 先把「三支都在」釘住,後面那些斷言才有對象。(trigger 那邊由 ② 的集合逐字比對頂住。)
  SELECT pg_catalog.count(*)::integer INTO v_n
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('pcm_op2b_reversal_amount','pcm_op2b_immutable_columns','pcm_op2b_no_delete');
  IF v_n <> 3 THEN
    RAISE EXCEPTION '本片的三支函式不是恰好三支(實得 %)⇒ 下面 SECDEF/search_path/ACL 三組斷言會真空通過', v_n
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2b_function_set';
  END IF;

  -- ④ SECDEF **只有** A9 一支;另兩支必須是 invoker(不濫用 SECDEF)。
  SELECT pg_catalog.string_agg(p.proname || '=' || p.prosecdef::text, ', ' ORDER BY p.proname) INTO v_bad
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('pcm_op2b_reversal_amount','pcm_op2b_immutable_columns','pcm_op2b_no_delete')
     AND p.prosecdef <> (p.proname = 'pcm_op2b_reversal_amount');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'SECDEF 分配不對(%)⇒ 期望只有 pcm_op2b_reversal_amount 是 SECURITY DEFINER', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2b_secdef_set';
  END IF;

  -- ⑤ search_path 逐字(SECDEF 沒釘 search_path = 可被 search_path 劫持)
  SELECT pg_catalog.string_agg(p.proname || '=' || coalesce(pg_catalog.array_to_string(p.proconfig, '|'), '(NULL)'), ', ' ORDER BY p.proname)
    INTO v_bad
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('pcm_op2b_reversal_amount','pcm_op2b_immutable_columns','pcm_op2b_no_delete')
     AND coalesce(pg_catalog.array_to_string(p.proconfig, '|'), '') <> 'search_path=pg_catalog, public';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'proconfig 不是逐字 search_path=pg_catalog, public(%)', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2b_proconfig';
  END IF;

  -- ⑥ ACL 三層(照 OP2a 檔尾形狀;memory reference_supabase-service-role-execute-default-grant)
  --    第一層:proacl 非 NULL —— NULL 代表「預設權限」= PUBLIC 有 EXECUTE,REVOKE 沒生效。
  SELECT pg_catalog.string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_bad
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('pcm_op2b_reversal_amount','pcm_op2b_immutable_columns','pcm_op2b_no_delete')
     AND p.proacl IS NULL;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'proacl 是 NULL(%)⇒ 等於預設權限、PUBLIC 仍可 EXECUTE,REVOKE 沒生效', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2b_proacl_null';
  END IF;
  --    第二層:直接 ACL 裡 owner 以外的 grantee 一律為零。
  SELECT pg_catalog.string_agg(p.proname || '→' || a.grantee::regrole::text, ', ') INTO v_bad
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
   WHERE n.nspname = 'public'
     AND p.proname IN ('pcm_op2b_reversal_amount','pcm_op2b_immutable_columns','pcm_op2b_no_delete')
     AND a.grantee <> p.proowner;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '函式的直接 ACL 有 owner 以外的 grantee(%)', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2b_acl_grantee';
  END IF;
  --    第三層:四個具名角色的**有效** EXECUTE 皆為假(has_function_privilege 含 role 繼承)。
  --    ⚠️ 誠實邊界(照抄 OP2a):**未涵蓋**清單外的角色、owner 身分與 superuser。
  --    🔴 本輪 code-reviewer nit 5:下面那句 `EXISTS (… pg_roles …)` 在本片**是恆真的** ——
  --       上方 `REVOKE … FROM anon, authenticated, service_role, authenticator` 在角色缺席時
  --       就先硬炸了,跑到這裡四個角色必定都在。留著是**刻意照抄 OP2a 檔尾的形狀**
  --       (兩檔的這段要能逐字對讀),不是以為它在守什麼。寫下來,不假裝它有判別力。
  SELECT pg_catalog.string_agg(p.proname || '→' || r.rolname, ', ') INTO v_bad
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN (VALUES ('anon'),('authenticated'),('service_role'),('authenticator')) r(rolname)
   WHERE n.nspname = 'public'
     AND p.proname IN ('pcm_op2b_reversal_amount','pcm_op2b_immutable_columns','pcm_op2b_no_delete')
     AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles pr WHERE pr.rolname = r.rolname)
     AND pg_catalog.has_function_privilege(r.rolname, p.oid, 'EXECUTE');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '具名角色仍有 EXECUTE(%)⇒ REVOKE 沒收乾淨', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2b_effective_execute';
  END IF;

  -- ⑦ 本表仍零列(探針的 SAVEPOINT 真的回滾了;錢帳不能被驗收流程弄髒)
  SELECT pg_catalog.count(*)::integer INTO v_n FROM public.order_payments;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '探針結束後本表有 % 列 ⇒ SAVEPOINT 沒回滾乾淨,錢帳被驗收流程污染', v_n
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2b_probe_residue';
  END IF;

  -- ⑨ 🔴🔴 **欄名集合逐字凍結**(本輪 code-reviewer MF1)
  -- 失敗情境:`pcm_op2b_immutable_columns` 是**逐欄枚舉**的 —— 不可變 12 欄 + allowlist 4 欄
  --   恰好等於本表現有的 16 欄。OP3/OP5 之後任何一句 `ALTER TABLE order_payments ADD COLUMN x`,
  --   新欄**不在枚舉裡** ⇒ 它當場成為「可以隨便改」的欄,而本檔 ①-⑧ 與 harness G1-G7
  --   **一格都不會紅**(它們驗的是 trigger/函式/ACL 的形狀,沒有一個看得到欄集)。
  --   檔頭那句「逐欄寫死則是新增欄位時當場想起要決定」本來是**靠人記得**,這裡把它變成機制。
  -- 🔴 `COLLATE "C"`:期望字面是一個**排序過**的字串,而排序結果取決於資料庫的 collation。
  --   ⚠️ 誠實邊界:本機實測(2026-08-10、PG17.10)C 與 en_US.UTF-8 **同序** ——
  --   釘 `COLLATE "C"` 不是因為已經觀察到差異,是為了不把正確性押在目標庫的 collation 上。
  SELECT pg_catalog.string_agg(a.attname, ',' ORDER BY a.attname COLLATE "C"),
         pg_catalog.count(*)::integer
    INTO v_names, v_n
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.order_payments'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_n <> 16 OR v_names IS DISTINCT FROM
       'actor,amount,bank_reference,created_at,id,note,order_id,payer_note,rail,'
       'rec_trade_id,received_at,request_id,reversal_reason,reverses_payment_id,'
       'reviewed_at,reviewed_by' THEN
    RAISE EXCEPTION '本表欄名集合不是凍結的那 16 欄(實得 % 欄:[%])⇒ 有欄被新增或改名。'
                    '新增的欄**不在 pcm_op2b_immutable_columns 的枚舉裡 = 立刻成為可隨意改的欄**;'
                    '處置:把新欄加進不可變枚舉或 allowlist(擇一,要想清楚),再同步更新本斷言與 op2b-verify.sh G1 的字面',
                    v_n, coalesce(v_names, '(無)')
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2b_column_set';
  END IF;

  -- ⑧ 🔴🔴 A9 的 SECDEF 身分**讀得到本表**(關卡2 #5;上面所有斷言加起來都證不到這件事)
  -- 失敗情境:migration runner 不是表 owner 且無 BYPASSRLS ⇒ A9 以那個身分跑,
  --   RLS 零 policy 之下 `SELECT amount … WHERE id = NEW.reverses_payment_id` **恆為零列**
  --   ⇒ 每一筆合法沖銷都被判成 `P2B32`(parent 不存在)而全擋 —— 而 apply 當下三發負向探針
  --   期望的就是 `P2B32`,**照樣全綠**。這是「負測恆真、功能已經壞掉」的完整形狀。
  -- 這裡驗的是「讀得到」的三個充分條件,逐條列出實得值,不只回一句 false:
  --   (a) A9 的 owner = 本表 owner(上方 `ALTER FUNCTION … OWNER TO` 釘的,這裡驗它真的釘上了)
  --   (b) 該身分對 `id` / `amount` 有 SELECT(欄級或表級任一給了都算 —— `has_column_privilege`
  --       兩種都看得到,不像 `relacl` 對欄級全盲:memory `reference_pg-table-acl-flatten-blind-to-column-grants`)
  --   (c) 本表 FORCE RLS 關著(開著時連 owner 都受零 policy 管 ⇒ 一樣讀不到)
  -- ⚠️ 誠實邊界:這是**結構條件**,不是「真的跑了一次 SELECT 拿到一列」——
  --   apply 當下本表零列(⑦ 剛驗過),就算真的去 SELECT 也是零列,分不出「被 RLS 濾掉」與「本來就空」。
  --   真的讀得到一列的證據在 `scripts/op2b-verify.sh` G2/G4(有種子資料、合法鏈真的落值)。
  SELECT pg_catalog.concat_ws(' / ',
           CASE WHEN p.proowner <> c.relowner
                THEN 'A9 owner=' || p.proowner::regrole::text || ' 不是表 owner=' || c.relowner::regrole::text END,
           CASE WHEN NOT pg_catalog.has_column_privilege(p.proowner, c.oid, 'id'::text, 'SELECT')
                THEN 'A9 身分對 id 無 SELECT' END,
           CASE WHEN NOT pg_catalog.has_column_privilege(p.proowner, c.oid, 'amount'::text, 'SELECT')
                THEN 'A9 身分對 amount 無 SELECT' END,
           CASE WHEN c.relforcerowsecurity
                THEN '本表 FORCE RLS 開著 ⇒ 零 policy 之下連 owner 都讀不到 parent' END)
    INTO v_bad
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_catalog.pg_class c ON c.oid = 'public.order_payments'::regclass
   WHERE n.nspname = 'public' AND p.proname = 'pcm_op2b_reversal_amount';
  -- 🔴 `IS DISTINCT FROM ''` 不是 `IS NOT NULL`:函式不見時這個查詢零列、v_bad = NULL,
  --    用 `IS NOT NULL` 會把「查不到」讀成「沒問題」。fail-closed 要連 NULL 一起紅。
  IF v_bad IS DISTINCT FROM '' THEN
    RAISE EXCEPTION 'A9 的 SECDEF 身分讀不到本表(%)⇒ 每一筆合法沖銷都會被誤判成 parent 不存在,而負向探針照樣全綠',
                    coalesce(v_bad, '(查不到 pcm_op2b_reversal_amount)')
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2b_secdef_unreadable';
  END IF;

  RAISE NOTICE 'OP2b 結構驗收通過:dormant gate 已移除、本表四支非 internal trigger 集合逐字凍結且全為 origin 啟用、三支新 trigger 的 BEFORE/ROW/事件位元 + 綁定函式 + WHEN 條件逐字釘死(A9 有 WHEN、另兩支無)、三支函式恰好都在、SECDEF 僅 A9、三支 proconfig 逐字 search_path、ACL 三層(proacl 非 NULL + 非 owner grantee 為零 + 四個具名角色有效 EXECUTE 皆為假;未涵蓋清單外角色/owner/superuser)、本表零列、**欄名集合逐字凍結為那 16 欄**(日後 ADD COLUMN 會在這裡紅,不會靜默變成可改欄)、A9 的 SECDEF 身分結構上讀得到本表(owner=表 owner + id/amount 有 SELECT + FORCE RLS 關著;「真的讀到一列」的證據在 scripts/op2b-verify.sh)';
END
$op2b_asserts$;

COMMIT;
