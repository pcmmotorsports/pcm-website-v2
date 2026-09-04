-- 20260904190000 · M-4b ⟦5b-TRACKNUMGAP1⟧ 片 A:已出貨的箱【更正貨運單號】。
--
-- ══ 這支存在的理由 —— 而它【不是】一個新功能 ═══════════════════════════
-- 🔴🔴 **一個拍板被三層實作, 而第四層漏了。**
--    Sean 的 `Q2=A 單號可改` 逐字寫在 X8(`20260805170100…:96`)
--    ⇒ ① X8 的凍結清單**刻意不含** `tracking_number`
--    ⇒ ② 出貨信 adapter 的 port 檔頭逐字「追蹤碼可後台改, 存進 payload 會過期」
--         ⇒ 它**整個設計**改成寄送當下才查
--    ⇒ ③ 冪等存根守門**拒絕**把 `tracking_number` 放進快照(理由逐字:「會被改動的欄」)
--    🛑 **而唯一不知道的是 `admin_mark_shipment_shipped`** —— 它的寫入自帶 `AND shipped_at IS NULL`
--       ⇒ 出貨後改不了 ⇒ 📌 **今天唯一的補救路是【一個人在 SQL Editor 手打 UPDATE】——**
--         **零守門、零稽核。**
--    ⇒ 🎯 **本支最大的價值是把那個動作【變成有紀錄的】, 不是「終於能改了」。**
--
-- 🛑 **它修不了已經寄出去的那封信** —— 片 C 負責那一半(Sean 2026-09-04 逐字
--    「甲 = 做, 改完自動再寄一封對的信給客人」, `~/pcm-mailbox/Sean拍板-20260904-七題.md:459`)。
--
-- ⚠️ **本支讓 `⟦b4-SHIPSNAP1⟧`(原 parked)的競態變真** —— 它 park 的理由就是「追蹤碼可後台改」
--    這個前提, 而本支讓那個前提**真的被人用**。兩者是同一個決定的兩面。

-- 🔴 **明確交易** —— DROP CONSTRAINT 與 ADD CONSTRAINT 之間若逐句提交, 失敗會留下
--    【一段沒有 CHECK 的空窗】。(codex R1 #1;而 repo 168 支 migration 本來就這樣寫。)
BEGIN;

-- ══ 前置閘:那份白名單今天長什麼樣 ══════════════════════════════════
-- 🔴 **這一格是拋棄式庫跑出來的**(2026-09-04):草稿第一版直接用 `'trackfix'` ⇒ 每一發都撞
--    `new row … violates check constraint "pcm_b2_shipping_idem_action_known"`。
-- 📌 **而那是好消息** —— 那份白名單就是「這張表只收得下我們認得的動作」那道防線, **它擋住了我。**
DO $$
DECLARE v_def text;
BEGIN
  -- 🔴 **指名那張表** —— 只按 `conname` 判會撞到別表上的同名 constraint(codex R1 #1)。
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conname = 'pcm_b2_shipping_idem_action_known'
     AND conrelid = 'public.pcm_b2_shipping_idempotency'::regclass;
  IF v_def IS NULL THEN
    RAISE EXCEPTION '前置閘①:那道 action 白名單不在 ⇒ 這支的前提已經變了, 停下來重讀';
  END IF;
  IF pg_catalog.strpos(v_def, 'trackfix') > 0 THEN
    RAISE EXCEPTION '前置閘②:白名單已經含 trackfix ⇒ 這支跑過了, 不要再跑一次';
  END IF;
  -- 🔵 負對照:一個現造的動作名不該在裡面 ⇒ 證明上面那個 strpos 有判別力。
  IF pg_catalog.strpos(v_def, 'zz_no_such_action_qq') > 0 THEN
    RAISE EXCEPTION '前置閘③:負對照命中 ⇒ 這把 strpos 對誰都說「在」, 它沒有判別力';
  END IF;
END $$;

ALTER TABLE public.pcm_b2_shipping_idempotency
  DROP CONSTRAINT pcm_b2_shipping_idem_action_known;
ALTER TABLE public.pcm_b2_shipping_idempotency
  ADD CONSTRAINT pcm_b2_shipping_idem_action_known
  CHECK (action = ANY (ARRAY['create_shipment','add_items','ship','void','unvoid','trackfix']));

-- 🔴 **裸 `CREATE FUNCTION`, 不是 `CREATE OR REPLACE`** —— 這是**新**物件,
--    而 `OR REPLACE` 會【靜靜蓋掉】一個同名而我不知道存在的東西。
--    (`scripts/migration-new-file-static-checks.sh` 擋下了我的第一版, 逐字:
--     「同身分在更早的 migration 查無定義 ⇒ 它是新物件」。那道閘是對的。)
CREATE FUNCTION public.admin_update_shipment_tracking(
  p_idempotency_key text,
  p_shipment_id     uuid,
  p_tracking_number text,
  p_actor           text,
  p_request_id      text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $fn$
DECLARE
  v_replay jsonb;
  v_ship   record;
  v_rows   bigint;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_update_shipment_tracking:需在 READ COMMITTED 下執行(現為 %)',
      pg_catalog.current_setting('transaction_isolation')
      USING ERRCODE = 'P2B02', CONSTRAINT = 'pcm_b2_w1_isolation_rc';
  END IF;

  -- 🔴 冪等認領在【任何業務寫入之前】。命名空間用 `'trackfix'` 而不是 `'ship'` ——
  --    兩者是不同的動作、payload 也不同, 共用會讓兩邊的冪等鍵互撞。
  v_replay := public.pcm_b2_shipping_idem_claim(
    'trackfix', p_idempotency_key,
    public.pcm_b2_shipping_idem_payload_hash('trackfix', pg_catalog.jsonb_build_object(
      'shipment_id',     p_shipment_id,
      'tracking_number', p_tracking_number)));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  -- 🔴🔴 **`FOR UPDATE` —— 而姊妹 RPC 沒有這一句, 那【不是】不一致。**
  --    它們寫的是**狀態轉移**(`shipped_at IS NULL → now()`), `WHERE` 自帶守門
  --    ⇒ 併發時第二發是 0 列、走 rowcount 閘。
  --    🛑 **本支寫的是【值覆蓋】** ⇒ 兩把不同的冪等鍵可以同時讀到同一個 before、
  --       兩發都成功, 而稽核記成「兩次都從同一個舊值改」—— 最後一筆覆蓋前一筆而沒有人知道。
  --    (codex R1 #3/#4 抓到, 我原本沒有。)
  SELECT s.id, s.shipment_reference, s.carrier_code, s.tracking_number, s.shipped_at, s.deleted_at
    INTO v_ship FROM public.shipments s WHERE s.id = p_shipment_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '更正單號:找不到這個包裹(shipment_id=%)', p_shipment_id
      USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_trackfix_shipment_missing';
  END IF;

  IF v_ship.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION '更正單號:包裹 % 已作廢,它的單號不會再被任何人看到,不需要更正。',
      v_ship.shipment_reference
      USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_trackfix_shipment_voided';
  END IF;

  -- 🔴🔴 **未出貨的箱要【指路】, 不是說「不能改」**(⟦b4-DEADENDMSG1⟧ 那一族)。
  --    它的單號在「按出貨」那一步填, 而那條路是通的。
  IF v_ship.shipped_at IS NULL THEN
    RAISE EXCEPTION '更正單號:包裹 % 還沒出貨。單號請在按「出貨」的那一步填,不必走更正。',
      v_ship.shipment_reference
      USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_trackfix_not_shipped_yet';
  END IF;

  -- 🔴 不得清空:A8 `shipments_shipped_needs_tracking` 會擋, 而它丟的是 raw constraint 名
  --    ⇒ 這裡先丟一句員工看得懂的話。
  IF v_ship.carrier_code <> 'other' AND public.pcm_b2_is_blank(p_tracking_number) THEN
    RAISE EXCEPTION '更正單號:快遞商是 % 時不能把單號清空。要改成沒有單號請作廢這一箱。',
      v_ship.carrier_code
      USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_trackfix_blank_not_allowed';
  END IF;

  -- 🔵 沒有變化就不寫 —— 否則稽核會長出 before == after 的雜訊, 而那張表要有人讀得下去。
  --    ⚠️ 它**不是**錯誤:員工按了兩次而值相同, 對他來說事情已經是對的。
  --    🔴 而片 C【也靠這一格】:`changed=false` ⇒ 不寄信 ⇒ 員工重按不會轟炸客人。
  IF v_ship.tracking_number IS NOT DISTINCT FROM p_tracking_number THEN
    RETURN public.pcm_b2_shipping_idem_record('trackfix', p_idempotency_key, p_shipment_id,
      -- 🔴 快照【不得含 tracking_number】—— 守門逐字「快照不得含會被改動的 shipments 欄」。
      pg_catalog.jsonb_build_object(
        'shipment_id', p_shipment_id,
        -- 🔴 `shipment_reference` 是呼叫端 `toWriteResult` 逐字要求的非空字串欄位;
        --    少了它 ⇒ **DB 寫成功而畫面報錯**(codex R1 #3 抓到)。
        --    🔵 它是不可變欄(X8 的永久凍結清單), 所以放進快照不違反「不得含會被改動的欄」。
        'shipment_reference', v_ship.shipment_reference,
        'changed', false));
  END IF;

  UPDATE public.shipments
     SET tracking_number = p_tracking_number
   WHERE id = p_shipment_id
     AND deleted_at IS NULL
     AND shipped_at IS NOT NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'admin_update_shipment_tracking:更新列數異常(%)', v_rows
      USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_trackfix_rowcount';
  END IF;

  -- 🔴🔴 同交易寫稽核 —— **這一段就是本支存在的理由**:今天那條 SQL Editor 路徑寫不出這一列。
  INSERT INTO public.admin_audit_log (actor, action, target, before, after, request_id, source_app)
  VALUES (
    p_actor,
    'shipment.tracking.update',
    'shipment:' || p_shipment_id::text,
    pg_catalog.jsonb_build_object('tracking_number', v_ship.tracking_number),
    pg_catalog.jsonb_build_object('tracking_number', p_tracking_number),
    p_request_id,
    'admin'
  );

  RETURN public.pcm_b2_shipping_idem_record('trackfix', p_idempotency_key, p_shipment_id,
    pg_catalog.jsonb_build_object(
      'shipment_id', p_shipment_id,
      'shipment_reference', v_ship.shipment_reference,
      'changed', true));
END;
$fn$;

-- 🔴 授權形狀抄 `20260807150000…:207-218`(那一段逐字寫著「不得只寫 GRANT 就當作權限是我給的」)。
REVOKE ALL ON FUNCTION public.admin_update_shipment_tracking(text, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated, authenticator, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_shipment_tracking(text, uuid, text, text, text)
  TO service_role;
-- 🔴 **`SECURITY DEFINER` 的提權身分不該由「誰跑這支 migration」決定**(codex R1 #2)。
--    姊妹三支逐字這樣寫(`20260807150000…:224-225`)。
ALTER FUNCTION public.admin_update_shipment_tracking(text, uuid, text, text, text) OWNER TO postgres;

-- ══ 後置閘 ═══════════════════════════════════════════════════════
DO $$
DECLARE
  v_functions text[] := ARRAY[
    'public.admin_update_shipment_tracking(text,uuid,text,text,text)'
  ]::text[];
  v_fn  text;
  v_def text;
BEGIN
  IF pg_catalog.to_regprocedure('public.admin_update_shipment_tracking(text,uuid,text,text,text)') IS NULL THEN
    RAISE EXCEPTION '後置閘①:函式沒有建起來 ⇒ 這一支沒有做到它宣稱的事';
  END IF;

  -- 🔴 後置閘②:白名單真的多了那個值 —— 少了它, 函式建起來而每一發都會被 CHECK 擋。
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conname = 'pcm_b2_shipping_idem_action_known'
     AND conrelid = 'public.pcm_b2_shipping_idempotency'::regclass;
  IF pg_catalog.strpos(v_def, 'trackfix') = 0 THEN
    RAISE EXCEPTION '後置閘②:白名單沒有 trackfix ⇒ 函式建好了而它一發都跑不動';
  END IF;
  -- 🔵 而舊的五個要【還在】—— 一個把清單換成只有 trackfix 的世界會通過上一格。
  IF pg_catalog.strpos(v_def, 'unvoid') = 0 OR pg_catalog.strpos(v_def, 'create_shipment') = 0 THEN
    RAISE EXCEPTION '後置閘②b:舊的動作值不見了 ⇒ 我把白名單換掉了, 不是加一個';
  END IF;

  FOREACH v_fn IN ARRAY v_functions LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '後置閘③a:anon 叫得動 % ⇒ 匿名連線改得了客人的貨運單號', v_fn;
    END IF;
    IF has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '後置閘③b:authenticated 叫得動 % ⇒ 任何登入的【客人】改得了單號', v_fn;
    END IF;
    -- 🔵 負對照:上面兩個 false 要有判別力。少了這一格, 一個「簽名打錯 ⇒ 對誰都回 false」
    --    的世界會安靜地通過 —— 而那時真正的函式一格都沒被檢查。
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '後置閘③c:service_role 叫不動 % ⇒ 要嘛 GRANT 沒生效, 要嘛簽名打錯(上面兩個 false 因此沒有判別力)', v_fn;
    END IF;
  END LOOP;
END $$;

-- 🔴🔴 **片 C 的合約寫在這裡, 而它【不是】「看 changed 就好」**(codex R1 #3 抓到):
--    冪等重放會把**當初存下來的信封原樣回傳** ⇒ 同一把鍵重送, `changed` 仍然是 `true`
--    ⇒ 🛑 **片 C 若只看 `changed` 就寄, 員工重按一次就多寄一封更正信給客人。**
--    ✅ **判準是 `changed = true 且 idempotent = false`** —— 後者才是「這一次真的動到資料」。
COMMENT ON FUNCTION public.admin_update_shipment_tracking(text, uuid, text, text, text) IS
  '⟦5b-TRACKNUMGAP1⟧ 片 A:已出貨包裹的貨運單號更正。同交易寫 admin_audit_log;'
  '回傳信封含 changed 與 idempotent —— 片 C 要兩個一起看(changed 且非重放)才寄更正信。';

COMMIT;
