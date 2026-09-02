-- M-4b · 取消信片①-b:`email_outbox.event_type` 加第四個事件 `order_unpaid_cancelled`
--
-- ✅ **Sean 2026-09-03 拍板(經主視窗-87 端;逐字)**
--    「1 取消信射程 ⇒ **乙 另開一套 event_type**(多做一點, 但兩種分得開)」
--    「2 逾時信     ⇒ **乙 不寄, 只有員工按下取消才寄**」
--    ⇒ 🔴 **引用要帶【檔名 + 題號】**:本片對應 2026-09-03 那一批的第 1 題與第 2 題;
--      規格正本 `docs/specs/2026-09-03-cancel-email-scope-spec-draft.md` §1 / §2。
--
-- ── 🔴 為什麼是【另開一個值】而不是借用 `order_cancelled` ─────────────────────
--    理由不是「比較乾淨」,它寫在 `20260902120000` 那支自己的 COMMENT 裡,逐字:
--      「**它同時是去重鍵的一半**(唯一索引 `email_outbox_event_uniq (event_type, dedup_key)`)
--       ⇒ **不可以借用既有值來省一個 migration** —— 借用會讓兩條線的信互相擋掉對方的唯一鍵
--       = 製造漏信面。」
--    ⇒ 📌 而兩種單的客人處境是**相反**的:
--      `order_cancelled`          = 刷卡且已全額退款 ⇒ **錢已經回去了**
--      `order_unpaid_cancelled`   = 從頭到尾**沒有付過錢** ⇒ 信裡不該提退款
--      ⇒ 合成一封會逼出一個帶 if 的文案。
--
-- ── 🛑 射程(照 `20260902120000` 的形狀寫死在 COMMENT 裡,而這一段是它的來源)──────
--    本值**只涵蓋【員工在後台按下取消】那一條路**。
--    🔴 **`expire_unpaid_orders`(pg_cron 自動逾時取消,一次上限 500 張)【不涵蓋】**
--      —— Sean 2026-09-03 拍乙:「不寄, 只有員工按下取消才寄」。
--    ⚠️ 而「不接」這件事**在碼上沒有形狀** ⇒ 它靠一格測試守著(見下面「守門落點」),
--      **不是靠這支 migration** —— 本支只管值域。
--
-- ⚠️ **值域打開 ≠ 有人可以用它**:本 CHECK **一個字都不管**「是誰取消的」「付款了沒」,
--    它只管 `event_type` 這一欄可以填什麼。三道業務閘在寫這一列的那支函式裡(片②,尚未存在)。
--
-- 🛑 **部署順序(硬約束,而【沒有機制擋得住反序】)**:
--    **模板(片③)必須先於 enqueue(片④)上。**
--    `scripts/deploy-order-gate.sh` 掃 `.from()` / `.rpc(`,而**一個寫在 use-case 裡的
--    event_type 字串對它是隱形的**(`20260902120000:203-206` 逐字)⇒ **靠人。**
--    ✅ 而反序的後果是**不寄**、不是寄垃圾:`sweep-email-outbox.ts` 的 `buildEmailText`
--    `default` 分支是 `throw`(錨字串 `未知 event_type、fail-closed 不寄`)⇒ 計 error、列留 sending。
--
-- 🔵 **本支【不寄任何信、不碰 outbox 的資料列、不建任何函式】。** 它只換一條 CHECK 並改 COMMENT。
-- 🔴 **forward-only**:前置閘認得「已經跑過」那個世界並拒絕重跑。

DO $$
DECLARE
  v_def   text;
  v_others text;
BEGIN
  -- 前置閘①:那條 CHECK 要在(否則下面 DROP 會炸,而炸的訊息不會告訴你現況是什麼)
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.email_outbox'::regclass
     AND c.conname = 'email_outbox_event_type_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '前置閘①:找不到 email_outbox_event_type_check ⇒ 部署態與預期不符,停下人工確認';
  END IF;

  -- 前置閘②:forward-only —— 已經有第四個值就拒絕重跑
  IF pg_catalog.strpos(v_def, 'order_unpaid_cancelled') > 0 THEN
    RAISE EXCEPTION '前置閘②:order_unpaid_cancelled 已經在 CHECK 裡了 ⇒ forward-only,拒重跑';
  END IF;

  -- 前置閘③:🔴 前三個值都要在 —— 本片是【加一個】,不是【重寫白名單】。
  --   少了任何一個 ⇒ 現況不是我以為的那一版 ⇒ 我這支的 IN(...) 會把它悄悄刪掉。
  IF pg_catalog.strpos(v_def, 'order_created') = 0
     OR pg_catalog.strpos(v_def, 'order_shipped') = 0
     OR pg_catalog.strpos(v_def, 'order_cancelled') = 0 THEN
    RAISE EXCEPTION '前置閘③:現行 CHECK 不是預期的三值(實得 %)⇒ 本片會覆寫白名單,停下人工確認', v_def;
  END IF;

  -- 前置閘④:這一欄上不該掛著別的 CHECK / FK(含 whole-row 寫法)
  --   ⚠️ 刻意誤報大於漏報:別欄的 whole-row CHECK 也會命中(形狀抄 20260902120000 前置閘⑤)。
  SELECT string_agg(c.conname, ', ') INTO v_others
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_attribute a
      ON a.attrelid = c.conrelid AND a.attname = 'event_type'
   WHERE c.conrelid = 'public.email_outbox'::regclass
     AND c.contype IN ('c', 'f')
     AND (0 = ANY (c.conkey) OR a.attnum = ANY (c.conkey))
     AND c.conname <> 'email_outbox_event_type_check';
  IF v_others IS NOT NULL THEN
    RAISE EXCEPTION '前置閘④:event_type 這一欄上還掛著別的 CHECK 或 FOREIGN KEY(%)⇒ 放寬了也可能寫不進去,停下人工確認', v_others;
  END IF;
END
$$;

-- ── 1. 換 CHECK(ADD NOT VALID → VALIDATE → DROP 舊 → RENAME;形狀抄 20260902120000)──
ALTER TABLE public.email_outbox
  ADD CONSTRAINT email_outbox_event_type_check_v3
  CHECK (event_type IN ('order_created', 'order_shipped', 'order_cancelled', 'order_unpaid_cancelled')) NOT VALID;
ALTER TABLE public.email_outbox VALIDATE CONSTRAINT email_outbox_event_type_check_v3;
ALTER TABLE public.email_outbox DROP CONSTRAINT email_outbox_event_type_check;
ALTER TABLE public.email_outbox
  RENAME CONSTRAINT email_outbox_event_type_check_v3 TO email_outbox_event_type_check;

-- ── 2. COMMENT(整段重寫;🔴 保留前一版所有承重的句子,只加第四值那一段)────────────
COMMENT ON COLUMN public.email_outbox.event_type IS
  '事件型別(CHECK 白名單;**新增事件 = 新 migration**)。4 值:
order_created(付款成功通知)/ order_shipped(出貨通知)/ order_cancelled(2026-09-02 新增:刷卡且已全額退款的整單取消)/
🔴 order_unpaid_cancelled(2026-09-03 新增:**未付款**的單被【員工】取消)。
🔴 **它同時是去重鍵的一半**(唯一索引 `email_outbox_event_uniq ON public.email_outbox (event_type, dedup_key)`)
⇒ **不可以借用既有值來省一個 migration** —— 借用會讓兩條線的信互相擋掉對方的唯一鍵 = 製造漏信面。
🔴 **order_cancelled 的射程(Sean 2026-09-02 拍甲)**:只涵蓋【刷卡 且 已全額退款】的整單取消,
且那一次取消一個品項數量都不會動。**部分退款不涵蓋**、部分品項取消不涵蓋。
🔴 **order_unpaid_cancelled 的射程(Sean 2026-09-03 拍乙)**:只涵蓋【**員工在後台按下取消**】的未付款單。
🛑 **`expire_unpaid_orders`(pg_cron 自動逾時取消,一次上限 500 張)【不涵蓋】** ——
Sean 逐字「不寄, 只有員工按下取消才寄」。⇒ 那一條路**不得**寫這一列。
⚠️ 而「不接」在碼上沒有形狀 ⇒ 它靠測試守著,不是靠這條 CHECK。本 CHECK 只管值域。
⚠️ **值域打開 ≠ 有人可以用它** —— 本 CHECK 一個字都不管誰取消、付款了沒。業務閘在寫這一列的那支函式裡。
🛑 **反序部署**:enqueue 先上而模板後上 ⇒ sweeper 的 default 分支 throw
(`packages/use-cases/src/sweep-email-outbox.ts`,錨字串 `未知 event_type、fail-closed 不寄`
—— 🔴 **本 COMMENT 刻意不寫行號**:它會被寫進正式庫,而讀 `\d+` 的人沒有 repo 可以 grep,
行號漂了他發現不了;錨字串漂了至少 grep 得到零命中)⇒ 計 error、列留 sending、耗盡 attempts 進死信。
📌 **失敗方向是【不寄】,不是【寄垃圾】** —— 那一格是刻意的。';

-- ── 3. 事後閘(定義層;🛑 而它們【不驗行為】)─────────────────────────────────
DO $$
DECLARE
  v_def text;
  v_com text;
BEGIN
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.email_outbox'::regclass
     AND c.conname = 'email_outbox_event_type_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '事後閘①:改名後找不到 email_outbox_event_type_check';
  END IF;
  -- 🔴 四個值逐一問 —— 不要只問新的那一個。少問三個 = 悄悄刪掉三條線的信而全綠。
  IF pg_catalog.strpos(v_def, 'order_created') = 0
     OR pg_catalog.strpos(v_def, 'order_shipped') = 0
     OR pg_catalog.strpos(v_def, 'order_cancelled') = 0
     OR pg_catalog.strpos(v_def, 'order_unpaid_cancelled') = 0 THEN
    RAISE EXCEPTION '事後閘②:CHECK 不是預期的四值(實得 %)', v_def;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
              WHERE conrelid = 'public.email_outbox'::regclass
                AND conname = 'email_outbox_event_type_check'
                AND NOT convalidated) THEN
    RAISE EXCEPTION '事後閘③:CHECK 還沒 validated';
  END IF;
  SELECT pg_catalog.col_description('public.email_outbox'::regclass,
           (SELECT attnum FROM pg_catalog.pg_attribute
             WHERE attrelid = 'public.email_outbox'::regclass AND attname = 'event_type'))
    INTO v_com;
  IF v_com IS NULL OR pg_catalog.strpos(v_com, 'order_unpaid_cancelled') = 0 THEN
    RAISE EXCEPTION '事後閘④:COMMENT 沒有提到 order_unpaid_cancelled ⇒ 契約與碼分岔了';
  END IF;
  IF pg_catalog.strpos(v_com, 'expire_unpaid_orders') = 0 THEN
    RAISE EXCEPTION '事後閘⑤:COMMENT 沒有寫「逾時那條路不涵蓋」⇒ 而那是 Sean 拍的射程,不可以掉';
  END IF;
  RAISE NOTICE '事後閘通過(①改名後找得到 ②四值俱在 ③已 validated ④COMMENT 有新值 ⑤COMMENT 有射程排除)。🛑 **它們證不到的**:(a)**不驗行為** —— 「CHECK 的字面對了」與「它擋不擋得住東西」是兩個宣稱;(b)④⑤ 是**字串有沒有出現**,不是語意 —— 一句「order_unpaid_cancelled 已作廢」兩道都會過;(c)本支**完全不管**誰有權寫這一列、也不管逾時那條路有沒有真的沒接 —— 後者由 `sweep-email-outbox` 那一族的測試守。';
END
$$;
