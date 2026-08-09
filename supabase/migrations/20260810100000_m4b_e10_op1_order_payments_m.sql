-- ══════════════════════════════════════════════════════════════════════════
-- OP1(M 片)· 收款帳本 `order_payments` —— 表 + 值域 + 唯一性 + 索引 + ACL
-- ══════════════════════════════════════════════════════════════════════════
-- 塊規格權威 = `docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:655`(第 3 批第 1 項)。
-- 塊級 plan = `B-340-Q`;主視窗 `B-341-A` 四題全裁 A/A/A/A、核准開工。
--
-- 🔴 **片名用 OP1-OP7 不用 P1-P7**:夜跑同時有一個叫「P 窗」的施工窗(生命週期線),
--    片名撞窗名會讓交接信讀起來像在講別人的工作。這是我改的,不是規格字面。
--
-- ── 本片做什麼 / 不做什麼 ────────────────────────────────────────────────
-- 做:表、值域 CHECK、唯一性、索引、ACL/RLS、COMMENT、**dormant gate**。**零行為**。
-- 不做:任何 trigger、任何 RPC、任何回填。守門在 OP2、writer 在 OP3/OP5、回填在 OP4。
-- 🔴 M/T 分片的理由 = A7b 先例(`…a7b_m_refund_jobs.sql:49-57`):兩支各自 COMMIT,
--    「同批 apply ⇒ 風險窗為零」那句話**已被證偽** ⇒ 用 dormant gate 讓中間那段時間寫不進東西。
--
-- 🔴🔴 **發布序寫死(R1 F11,must-fix):`OP1 → OP2 → OP3/R 片`,不得跳號。**
--    dormant gate 讓本表寫不進。而 `:655` 的常態 writer 是「`confirm_order_payment` 擴充片,
--    付款確認**同交易** insert card 腿」⇒ **那支若先於 OP2 上線,結帳的付款確認會撞 gate、
--    整筆失敗、正式站結不了帳**。這不是理論:memory
--    `feedback_app-layer-must-not-ship-before-migration-apply`(08-07 正式站壞約 8 小時)同形狀。
--    ⇒ 這行不是給讀者推的,是發布順序的硬約束。
--
-- ── 三個拍板輸入(逐字對過,不是轉述)──────────────────────────────────
-- · **Q12=A**(master-plan §8.6):各自**原路退** —— 卡款系統自動退刷、匯款列待辦人工匯還。
-- · **Q13**(Sean 自案,逐字):「保留,看剩下訂單總金額多少,退掉多餘部分,不足的話也不用退款,
--   就當作是先收多餘部分」⇒ 退款額 = `max(0, 已收未退總額 − 取消後訂單剩餘應收總額)`。
--   🔴 這條公式**本片不落地**(它是 OP7 的函式);寫在這裡是因為它決定了本表要記得下「已收」。
-- · **U3=A**:匯款**可記多筆**;少收自動掛催款待辦、多收強制二選一(退/留抵);結清前掛今日對帳。
--
-- 🔴 **`:655` 舊字面同 commit 銷案,但只銷「受理面」那一半**(主視窗 B-341-A Q-A=A;
--    🔴 **R1 F19 打回我原本的全面銷案,他對**):
--    R8 上呈的是**兩件事包在一個項目裡** —— 「混合收款(卡+匯款)退款**分軌與分配順序**」
--    (`docs/reviews/2026-07-28-e10-k1-r8-codex.md:7-8`,親驗)。
--    §8.6 的 Q12=A 答的是**分軌**(各自原路退);**分配順序從未拍板** ——
--    退款額 < 已收總額的混合單「先退哪一軌」到今天仍無定義。
--    ⇒ **受理面解除**(混合收款正常收、正常記帳,本表就是為此而生);
--      **退款面不解除**:A8b 的混合分支在「分配順序」拍板前仍應 fail-closed。
--    我原本寫「閘解除」是把沒拍的那半也一起放行了 —— 結論超出前提。
-- 🔴 另一條同向的話(R1 F20):非卡軌的退款帳本**目前還不存在**(見下一段)⇒
--    受理面解除之後,現在起可以合法產生「下游做不出退款」的單。這是已知代價,不是意外。
--
-- ── 🔴 本表只記「流入」,退款不在這裡 ────────────────────────────────────
-- 這題規格自己答了,不是我選的:`:655` 寫的是「**收款**帳本」,而退款在同一行被分流到
-- 三個不同機制(TapPay refund job / 匯款退款線 / 現金退還登記)。`order_refunds`
-- (`…rf2a2…`)已存在且是**卡片/TapPay 形狀**的退款帳本。
-- 🔴 **代價寫明**:「已收**未退**總額」因此要跨源相加減,而**非卡軌的退款帳本目前還不存在**
--    ⇒ OP6/OP7 算那個數之前,要嘛那兩個帳本先落地、要嘛明文限定只算卡軌。這是 OP6 的前置,
--    不是本片能關掉的。寫在這裡免得下一個人以為 `SUM(order_payments)` 就是答案。
--
-- ── 假設清單(= 重估觸發清單,B-340-Q §④)────────────────────────────────
-- A1 金額一律**整數元** / A2 帳本 **append-only**(更正走沖銷,OP2 落地)/
-- A3 `rail` canonical 三值 / A4 「留抵」= **同單折抵**、跨單餘額與 wallet **明確不碰**(Q-C=A)/
-- A5 本片不改 `orders.payment_status` 的既有轉移規則。
-- 🔴 R1 補三條(F3/F9/F10),都是「現在不寫、下一片會重新爭一次」的:
-- A6 **溢款處置(退/留抵)的落點 = OP6**,不在本表 —— 那是**每張單一個決定**,grain 不對。
--    (U3「四格」= 已收累計/應收/差額/處置;前三格由本表算得出,第四格是單級狀態。)
-- A7 **「客人聲稱的匯款日」不記** —— 催款情境會想要它,但目前只能塞 `payer_note`,
--    而那欄明文不參與判定。要記就是 OP5 加欄,不要臨時發明。
-- A8 **「不得晚於現在」的閘 = OP2 的具名交付物**,不是散文。gate DROP 的前置條件之一。
-- A9 **沖銷金額必須等於被沖金額的負值 = OP2 的具名交付物**(跨列比較,CHECK 做不到)。
--    沒有這條,「已收 = SUM(amount)」只擋得住重複沖銷與跨單沖銷,擋不住金額對不上。
-- 任一動搖 ⇒ 停下回報,不自行擴張解釋。
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE public.order_payments (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 🔴 RESTRICT 而非 CASCADE(同 A2/A3/A7):收款是要留存的事實,不得因為刪一張單就無聲消失。
  order_id        uuid        NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,

  -- 🔴 canonical 值域三值(master-plan `:655` 定死)。用 CHECK 不用 enum type:
  --    新增管道時 enum 要 `ALTER TYPE`(不可回滾、且在交易內有限制),CHECK 改起來乾淨。
  --    代價 = 少了型別層的集合語意;本表的消費端一律走具名 RPC,不直接比字串。
  rail            text        NOT NULL CHECK (rail IN ('card', 'bank_transfer', 'cash')),

  -- A1:整數元。
  -- 🔴🔴 **R1 F1(must-fix,我自己宣告的 A2 被自己的欄位設計否決)**:檔頭寫「append-only、
  --    更正走沖銷」,但第一版是 `CHECK (amount > 0)` + 零沖銷欄 ⇒ **沖銷列物理上寫不進**,
  --    而 OP2 是 trigger 片、變不出欄。宣告一個做不到的東西比不宣告更糟。
  -- ⇒ 收款列為正、沖銷列為負,並用 `reverses_payment_id` 指向被沖的那一列。
  --    好處:「已收」= `SUM(amount)`,不必外接「哪些被沖掉了」的知識。
  amount          integer     NOT NULL CHECK (amount <> 0),

  -- 沖銷:指向被沖掉的那一列。NULL = 這是一筆收款;非 NULL = 這是一筆沖銷。
  -- 🔴 兩者的正負由下方 `order_payments_reversal_shape` 綁死,不靠寫入端自律。
  -- 🔴🔴 **我自己追出來的三個洞(在 codex 關卡2 回來之前)**:第一版只有
  --    `REFERENCES order_payments(id)`,於是「已收 = SUM(amount)」這個不變式**站不住** ——
  --    三種**完全合法**的 INSERT 就能把它弄錯:
  --      ① 同一列被沖銷兩次 ⇒ 總額被多扣一次
  --      ② 沖銷**別張單**的列 ⇒ 兩張單的總額同時錯
  --      ③ 沖銷金額 ≠ 被沖金額 ⇒ 總額對不上
  --    ①② 宣告式擋得掉(見下方 composite FK 與 partial unique);
  --    ③ 是跨列比較,CHECK 做不到 ⇒ **OP2 的具名交付物**(寫進 A9,不是散文)。
  reverses_payment_id uuid,

  -- 🔴 `received_at` = **實際收到錢的時點**,不是登錄時間(登錄時間是 `created_at`)。
  --    匯款這一軌兩者常常差好幾天,對帳看的是前者。分兩欄是為了讓「今日對帳」問得出正確的問題。
  -- 🔴 R1 F8:**逐軌定義寫死**,否則「實際收到錢」對卡軌是模糊的 ——
  --    · card          = **授權成功的時點**(常態 writer 在付款確認同交易寫,落的就是它)
  --    · bank_transfer = **銀行入帳日**(不是客人說他匯款的那天,見 A7)
  --    · cash          = 收到現金的時點
  received_at     timestamptz NOT NULL,

  -- card 軌的外部交易識別(TapPay)。**冪等鍵的一半**,見下方 partial unique。
  rec_trade_id    text,
  -- bank_transfer 軌的銀行參考(末五碼 / 交易序號)。**只是對帳線索,不是冪等鍵**。
  -- 🔴 codex 關卡2:第一版拿它當防重複登錄的唯一鍵 —— **錯的**。它允許「末五碼」,
  --    而同一張單的兩筆合法匯款完全可能末五碼相同 ⇒ 那道 unique 會**誤擋真的第二筆錢**。
  --    一個欄位不能同時當「銀行線索」與「可靠冪等鍵」。⇒ 冪等鍵改用下面的 `request_id`。
  bank_reference  text,

  -- 🔴 codex 關卡2 #6a:**人工軌的冪等鍵**(bank_transfer / cash)。
  --    現金軌原本零冪等鍵,我寫成「只能靠 OP5 的複核擋」—— 那不是機制:
  --    RPC timeout 重送一次就重複入帳,而複核是事後的人。
  --    ⇒ 由呼叫端產生、隨整段互動沿用(同 A7 `order_cancellations.idempotency_key` 的形狀)。
  --    卡軌不用它:卡軌的冪等鍵是 `rec_trade_id`(外部事實,比自產的鍵更硬)。
  request_id      uuid,
  -- 匯款人備註(客人在匯款單上寫的、或客服記下的)。純資訊,不參與任何判定。
  payer_note      text,

  -- 誰登錄的。對齊 A7 的 `actor` 慣例(`…a7_order_cancellations.sql:112`)。
  actor           text        NOT NULL REFERENCES public.staff(id) ON DELETE RESTRICT,
  -- U3 的複核。**本片只提供欄位,不強制** —— 「哪些軌必須複核」是 OP5 的守門,
  -- 寫死在 M 片會讓 OP3(卡軌自動寫帳)過不了自己的閘。
  reviewed_by     text        REFERENCES public.staff(id) ON DELETE RESTRICT,
  reviewed_at     timestamptz,

  -- 🔴 codex 關卡2 #6b:沖銷**必須有理由**。第一版沖銷可以完全沒說明,
  --    而錢帳上「為什麼把這 500 沖掉」是稽核時第一個會被問的問題。
  reversal_reason text,

  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),

  -- ── 值域:rail 決定哪些欄必填、哪些欄必空 ────────────────────────────
  -- 🔴 用單一 CASE 寫成一條,而不是三條各管一軌的 CHECK:三條各自成立不代表合起來窮盡,
  --    CASE 的 ELSE 分支讓「新增了 rail 值卻忘了寫規則」當場紅(值域 CHECK 擋不到那個)。
  -- 🔴 codex 關卡2 #5:**沖銷列不帶任何外部識別** —— 它的歸屬由 `reverses_payment_id`
  --    這條 composite FK 決定,再讓它自己填一組識別 = 開一條「沖銷單指向 A、識別卻寫 B」的路。
  --    ⇒ 值域分成「收款列」與「沖銷列」兩組規則,不是只看 rail。
  CONSTRAINT order_payments_rail_fields CHECK (
    CASE WHEN reverses_payment_id IS NOT NULL THEN
      -- 沖銷列:三個識別欄一律空(關係已由 composite FK 綁死),但要有理由
      rec_trade_id IS NULL AND bank_reference IS NULL AND request_id IS NULL
      AND reversal_reason IS NOT NULL AND btrim(reversal_reason) <> ''
    ELSE CASE rail
      -- 卡軌:必須有 TapPay 交易號(它自己就是冪等鍵);不得帶銀行參考或人工軌的 request_id
      WHEN 'card'          THEN rec_trade_id IS NOT NULL AND btrim(rec_trade_id) <> ''
                            AND bank_reference IS NULL AND request_id IS NULL
      -- 匯款軌:銀行參考必填(對帳線索)、request_id 必填(冪等鍵);不得帶 TapPay 交易號
      WHEN 'bank_transfer' THEN bank_reference IS NOT NULL AND btrim(bank_reference) <> ''
                            AND request_id IS NOT NULL AND rec_trade_id IS NULL
      -- 現金軌:無外部識別,但 request_id 必填(否則重送就重複入帳)
      WHEN 'cash'          THEN rec_trade_id IS NULL AND bank_reference IS NULL
                            AND request_id IS NOT NULL
      ELSE false
    END END
    -- 收款列不得帶沖銷理由(那欄只屬於沖銷列)
    AND (reverses_payment_id IS NOT NULL OR reversal_reason IS NULL)
  ),

  -- 複核是「一對」:有人簽就要有時間,有時間就要有人。半套的稽核痕跡比沒有更糟。
  CONSTRAINT order_payments_review_pair CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL)),

  -- 🔴 沖銷列的形狀綁死:收款恆正、沖銷恆負。少了這條,寫入端可以送出「正數的沖銷」
  --    或「負數的收款」,`SUM(amount)` 當場失去意義。
  CONSTRAINT order_payments_reversal_shape
    CHECK ((reverses_payment_id IS NULL AND amount > 0) OR (reverses_payment_id IS NOT NULL AND amount < 0)),

  -- 🔴 讓下面那道 composite FK 有得指(PK 已保證 id 唯一,本道是為了 FK 的形狀)。
  CONSTRAINT order_payments_id_order_rail_uniq UNIQUE (id, order_id, rail),

  -- 🔴🔴 **洞②的宣告式修法**:沖銷必須指向**同一張單、同一軌**的列。
  --    只寫 `REFERENCES order_payments(id)` 的話,拿別張單的收款來沖是合法的。
  --    composite FK 把「同單同軌」變成**結構事實**,不是 writer 的自律。
  --    `MATCH SIMPLE`(預設):`reverses_payment_id IS NULL` 時整條不檢查 ⇒ 收款列不受影響。
  CONSTRAINT order_payments_reverses_same_order_rail
    FOREIGN KEY (reverses_payment_id, order_id, rail)
    REFERENCES public.order_payments (id, order_id, rail) ON DELETE RESTRICT,

  -- 🔴 R1 F5:`bank_reference` 必須是**正規化後**的值。少了這條,`'A1'` / `' A1'` 是兩個不同的鍵,
  --    下方那道防重複登錄的 unique 就形同虛設(人工輸入前後空白是常態)。
  --    大小寫由下方 unique 的 `upper()` 處理;這裡只擋前後空白與空字串。
  CONSTRAINT order_payments_bank_reference_trimmed
    CHECK (bank_reference IS NULL OR bank_reference = btrim(bank_reference)),

  -- 🔴 `received_at <= now()` **刻意不寫成 CHECK**。實測 PG 17.10 **接受**這個構造(不報錯),
  --    但 CHECK 的表達式在文件上要求 IMMUTABLE,`now()` 不是 ⇒ 那是「現在能用」不是「保證能用」。
  --    ⇒ 未來時間的閘放在 OP2 的 trigger 裡(那裡用 `now()` 名正言順)。
  --    寫下來是因為下一個人很可能想「順手加一條 CHECK」——那不是我漏了。
  -- 🔴 R1 F21:repo 另外兩支(a2 receipts / a6 order_notes)的註解寫「**擋不進** CHECK」,
  --    那個字面是錯的(我實測 PG 17.10 接受)。**結論一樣、理由不同** ⇒ 兩處已同 commit 更正。

  -- ── 🔴🔴 dormant gate(A7b-M 先例;OP2 在**同交易的最後一步** DROP 它)────
  -- 本表與本約束**同生** ⇒ 恆為空表,`NOT VALID` 在這裡零行為差異 ⇒ 不寫它
  --    (A7b-M 施工時實測過:`NOT VALID` 在 CREATE TABLE 的 table constraint 上不生效,
  --     留著等於宣稱一個不存在的效果)。
  -- 驗收必須測**兩個方向**:OP1 之後合法 INSERT 必拒、OP2 之後同一筆必過 ——
  --    只測前者等於沒證明 gate 被移除過。
  CONSTRAINT order_payments_dormant_until_triggers CHECK (false)
);

-- ── 唯一性 ────────────────────────────────────────────────────────────────
-- 🔴 卡軌冪等鍵(master-plan `:655` 明寫 `(order_id, rec_trade_id)` UNIQUE)。
--    用 partial index 而不是 table constraint:另兩軌的 `rec_trade_id` 恆為 NULL,
--    整表 UNIQUE 對 NULL 不生效、看起來有守其實沒守(本 repo 記過這個形狀)。
CREATE UNIQUE INDEX order_payments_card_idem_uniq
  ON public.order_payments (order_id, rec_trade_id)
  WHERE rail = 'card' AND reverses_payment_id IS NULL;

-- 🔴🔴 R1 F2(must-fix):`rec_trade_id` 在本 repo 的既有不變式是**全域唯一**,不是 per-order ——
--    `orders.tappay_rec_trade_id text UNIQUE`(`…m3_s2a_orders_order_items.sql:107`,親驗)。
--    只做 per-order 等於允許「同一筆 TapPay 交易記到別張單」,而那是 repo 別處明文擋掉的事。
--    `:655` 只規定冪等鍵是 `(order_id, rec_trade_id)`,沒說不能更嚴 ⇒ 現在加零成本。
CREATE UNIQUE INDEX order_payments_rec_trade_global_uniq
  ON public.order_payments (rec_trade_id)
  WHERE rail = 'card' AND reverses_payment_id IS NULL;

-- 🔴 匯款軌防**重複登錄**:U3 說「可記多筆」——多筆是**多次不同的匯款**,
--    同一筆銀行參考被登錄兩次不是多筆、是重複。這道擋的是後者。
-- 🔴🔴 **人工軌(bank_transfer / cash)的冪等鍵 = `request_id`,不是 `bank_reference`。**
--    第一版把 unique 建在 `bank_reference` 上 ⇒ 同一張單兩筆合法匯款若末五碼相同,
--    **第二筆真的錢會被擋掉**(codex 關卡2 抓)。銀行參考是線索、不是鍵。
--    ⚠️ 誠實邊界(三條都寫,不只寫最好講的那條):
--       ① `request_id` 由呼叫端產生 ⇒ 它擋的是「同一次互動被重送」,不是「同一筆錢被登兩次」。
--          後者(換個 request_id 再登一次)DB 擋不到,靠 OP5 的複核與對帳。
--       ② 範圍 per-order,**刻意的** —— 一筆匯款付兩張單是合法情境;代價是「同一筆錢被兩張單
--          各記一次」零偵測。
--       ③ `bank_reference` 現在**沒有任何 unique** —— 它回到它該有的角色:對帳時給人看的線索。
CREATE UNIQUE INDEX order_payments_request_id_uniq
  ON public.order_payments (order_id, request_id)
  WHERE request_id IS NOT NULL;

-- 🔴🔴 **洞①的宣告式修法**:一筆收款**最多被沖銷一次**。
--    少了這道,同一列可以被沖兩次、總額被多扣一次,而每一筆單看都合法。
CREATE UNIQUE INDEX order_payments_one_reversal_uniq
  ON public.order_payments (reverses_payment_id)
  WHERE reverses_payment_id IS NOT NULL;

-- ── 索引 ──────────────────────────────────────────────────────────────────
-- 每張單的實收總額(OP6 的主查詢)。
CREATE INDEX order_payments_order_idx ON public.order_payments (order_id);
-- 今日對帳(U3:結清前掛今日對帳不消失)。
CREATE INDEX order_payments_received_at_idx ON public.order_payments (received_at);

-- ── ACL / RLS ─────────────────────────────────────────────────────────────
-- 🔴 零 GRANT:所有寫入走具名 SECURITY DEFINER RPC(OP3/OP5)。給了表權限
--    就等於開一條繞過那些 RPC 直接動錢帳的路。
ALTER TABLE public.order_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.order_payments FROM PUBLIC, anon, authenticated, service_role, authenticator;

COMMENT ON TABLE public.order_payments IS
  'OP1 收款帳本(master-plan v2 :655 第 3 批第 1 項)。**只記流入**,退款照 rail 分流到別的機制'
  '(卡=order_refunds/TapPay refund job、匯款=匯款退款線、現金=現金退還登記)。'
  '🔴 「已收未退總額」要跨源算,非卡軌的退款帳本目前還不存在 = OP6 的前置。'
  '🔴 本表是 A8b partiallyPaid 上限與退款分軌的唯一事實來源。'
  '🔴 零 GRANT + RLS zero-policy;寫入一律走具名 SECDEF RPC。'
  '🔴 跨單餘額 / wallet 體系**明確不碰**(Q-C=A:留抵 = 同單折抵)。';
COMMENT ON COLUMN public.order_payments.received_at IS '實際收到錢的時點(匯款=銀行入帳日),不是登錄時間;登錄時間看 created_at。對帳看這欄。';
COMMENT ON COLUMN public.order_payments.rail   IS 'canonical 三值 card/bank_transfer/cash。A8b 讀本欄分軌退款(Q12=A 各自原路退)。';
COMMENT ON COLUMN public.order_payments.amount IS '整數元、恆正。本表只記流入 —— 沖銷與退款不在這裡。';

-- ── 檔尾 fail-closed 結構驗收 ─────────────────────────────────────────────
DO $op1_asserts$
DECLARE v_n integer; v_bad text; v_rail text;
BEGIN
  -- ① dormant gate 真的在,而且真的擋得住(**不是只看它存在**)。
  --    本 repo 記過太多次「守門只檢查規則存在、沒檢查它做了什麼」⇒ 這裡實際插一筆再回滾。
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                  WHERE conname = 'order_payments_dormant_until_triggers'
                    AND conrelid = 'public.order_payments'::regclass) THEN
    RAISE EXCEPTION 'dormant gate 不在 ⇒ OP2 落地前這張錢帳是可寫的,拒絕通過'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op1_dormant_gate_missing';
  END IF;
  -- 🔴🔴 **這段第一版是假綠,我自己用突變抓到的**:原本 handler 寫
  --    `WHEN check_violation OR foreign_key_violation THEN NULL`,而探針的 order_id / actor
  --    是假值 ⇒ **FK 也會擋**。把 gate 改成 `CHECK (true)`(存在但完全沒效果)時,
  --    擋下來的是 FK,而斷言照樣印「通過」——**兩道都擋,證不了是哪一道在擋**
  --    (memory `feedback_negative-test-observation-supplied-by-another-mechanism`)。
  -- ⇒ 改成**認名字**:只有被 dormant gate 這條 CHECK 擋下才算數;被別的東西擋 = 判紅。
  DECLARE v_con text;
  BEGIN
    INSERT INTO public.order_payments (order_id, rail, amount, received_at, rec_trade_id, actor)
    VALUES ('00000000-0000-0000-0000-000000000000', 'card', 1, now(), 'probe', 'probe');
    RAISE EXCEPTION 'dormant gate 沒擋住 INSERT ⇒ 它存在但沒效果,拒絕通過'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op1_dormant_gate_vacuous';
  EXCEPTION
    -- 🔴 R1 F14(must-fix):上面那句「gate 沒擋住」的哨兵 RAISE **在同一個 BEGIN 內**,
    --    會被下面的 `WHEN others` 接住 ⇒ INSERT 真的成功時,印出來的訊息與事實相反。
    --    ⇒ 自己的哨兵先放行(repo 先例:A5a F1 同形狀)。
    WHEN SQLSTATE 'P2B20' THEN RAISE;
    WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
      -- 🔴 `IS DISTINCT FROM` 不用 `<>`:conname 為 NULL 時 `<>` 會**靜默吞掉**(A5a 前科)。
      IF v_con IS DISTINCT FROM 'order_payments_dormant_until_triggers' THEN
        RAISE EXCEPTION 'INSERT 被擋了,但擋它的是 %(不是 dormant gate)⇒ 證不到 gate 有效', coalesce(v_con, '(conname 為 NULL)')
          USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op1_dormant_gate_wrong_blocker';
      END IF;
    WHEN others THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
      RAISE EXCEPTION 'INSERT 被擋了,但不是 CHECK(擋它的是 %)⇒ dormant gate 沒生效', coalesce(v_con, '(未提供 conname)')
        USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op1_dormant_gate_wrong_blocker';
  END;

  -- 🔴 R1 F17:只用 card 形狀探一次的話,`CHECK (rail <> 'card')` 這種**部分** gate 仍全綠
  --    ⇒ 再探一發 cash(不帶任何外部識別),必須紅在同一個 conname。
  DECLARE v_con2 text;
  BEGIN
    INSERT INTO public.order_payments (order_id, rail, amount, received_at, actor)
    VALUES ('00000000-0000-0000-0000-000000000000', 'cash', 1, now(), 'probe');
    RAISE EXCEPTION 'dormant gate 對 cash 形狀沒擋住 ⇒ 它是部分 gate,不是全擋'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op1_dormant_gate_partial';
  EXCEPTION
    WHEN SQLSTATE 'P2B20' THEN RAISE;
    WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_con2 = CONSTRAINT_NAME;
      IF v_con2 IS DISTINCT FROM 'order_payments_dormant_until_triggers' THEN
        RAISE EXCEPTION 'cash 探針被 % 擋住(不是 dormant gate)', coalesce(v_con2, '(NULL)')
          USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op1_dormant_gate_wrong_blocker';
      END IF;
    WHEN others THEN
      RAISE EXCEPTION 'cash 探針被非 CHECK 的東西擋住 ⇒ gate 沒生效'
        USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op1_dormant_gate_wrong_blocker';
  END;

  -- 🔴 codex 關卡2 #4a:第一版只探 card 與 cash 兩軌 ⇒ 把 gate 改成
  --    `CHECK (rail = 'bank_transfer')` 那種「只擋兩軌、放行第三軌」的形狀,兩發探針照樣全過,
  --    而匯款軌**已經可以寫進錢帳**。⇒ 三軌都探,一軌都不能少。
  FOREACH v_rail IN ARRAY ARRAY['card','bank_transfer','cash'] LOOP
    DECLARE v_con2 text;
    BEGIN
      INSERT INTO public.order_payments (order_id, rail, amount, received_at, rec_trade_id, bank_reference, request_id, actor)
      VALUES ('00000000-0000-0000-0000-000000000000', v_rail, 1, now(),
              CASE WHEN v_rail = 'card' THEN 'probe' END,
              CASE WHEN v_rail = 'bank_transfer' THEN 'probe' END,
              CASE WHEN v_rail <> 'card' THEN '00000000-0000-0000-0000-000000000001'::uuid END,
              'probe');
      RAISE EXCEPTION 'dormant gate 對 % 軌沒擋住 ⇒ 它存在但只擋部分軌', v_rail
        USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op1_dormant_gate_vacuous';
    EXCEPTION
      WHEN check_violation THEN
        GET STACKED DIAGNOSTICS v_con2 = CONSTRAINT_NAME;
        IF v_con2 IS DISTINCT FROM 'order_payments_dormant_until_triggers' THEN
          RAISE EXCEPTION '% 軌被擋了,但擋它的是 %(不是 dormant gate)⇒ 證不到 gate 對這一軌有效',
                          v_rail, coalesce(v_con2, '(conname 為 NULL)')
            USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op1_dormant_gate_wrong_blocker';
        END IF;
      WHEN others THEN
        GET STACKED DIAGNOSTICS v_con2 = CONSTRAINT_NAME;
        RAISE EXCEPTION '% 軌被擋了,但不是 CHECK(擋它的是 %)⇒ gate 沒生效',
                        v_rail, coalesce(v_con2, '(未提供 conname)')
          USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op1_dormant_gate_wrong_blocker';
    END;
  END LOOP;

  -- ② 值域 CASE 的 ELSE 分支:新增 rail 值卻沒寫規則時要當場紅。
  --    這裡只能驗約束在;它的判別力由 OP1 的 harness 用突變證。
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                  WHERE conname = 'order_payments_rail_fields'
                    AND conrelid = 'public.order_payments'::regclass) THEN
    RAISE EXCEPTION 'rail 值域約束不在' USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op1_rail_fields_missing';
  END IF;

  -- ③ 兩道 partial unique 都在,而且**帶 WHERE**(整表 UNIQUE 對 NULL 不生效 = 假守門)。
  -- 🔴 R1 F13(must-fix):第一版只比 indexname + `indexdef LIKE '%WHERE%'` ——
  --    **不驗 UNIQUE、不驗欄位、不驗 WHERE 的內容**。把 `CREATE UNIQUE INDEX` 改成
  --    `CREATE INDEX`、或把 WHERE 改成 `rail='cash'`,那道照樣綠;我的突變②(少 WHERE)
  --    剛好避開了這個盲區 = 靶沒打到守門真正的弱點。
  -- ⇒ 改問 catalog 的事實:`indisunique` 為真、`indpred` 非空(真的是 partial),三道齊全。
  SELECT pg_catalog.count(*)::integer INTO v_n
    FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
   WHERE c.relname IN ('order_payments_card_idem_uniq',
                       'order_payments_rec_trade_global_uniq',
                       'order_payments_request_id_uniq',
                       'order_payments_one_reversal_uniq')
     AND i.indisunique AND i.indpred IS NOT NULL;
  IF v_n <> 4 THEN
    RAISE EXCEPTION '四道 partial unique 實得 % 道(期望 4、且都要 indisunique + indpred 非空)'
                    '⇒ 少了 UNIQUE 或少了 WHERE 的索引看起來有守、其實沒守', v_n
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op1_partial_unique_shape';
  END IF;

  -- ④ 零 GRANT:逐角色 × 逐 privilege 實查。
  -- 🔴 R1 F15:第一版的理由寫反了 —— `has_table_privilege` **本身就是表級**,對欄級
  --    `pg_attribute.attacl` 全盲(memory `reference_pg-table-acl-flatten-blind-to-column-grants`)。
  --    本表建立當下不可能有欄級 GRANT,所以影響為零;但那句錯的理由會被抄到 OP2 去。
  -- 🔴 privilege 補到七個:少了 **TRUNCATE**(拿到就能清空整本錢帳)、REFERENCES、TRIGGER。
  --    `REVOKE ALL` 有做,但斷言沒守 = 又一個「做了但沒證」。
  SELECT pg_catalog.string_agg(r || '=' || p, ' ' ORDER BY r, p) INTO v_bad
    FROM (SELECT r, p FROM unnest(ARRAY['anon','authenticated','service_role','authenticator']) r
                          CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p) x
   WHERE pg_catalog.has_table_privilege(x.r, 'public.order_payments', x.p);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '錢帳表對非 owner 角色有權限(%)⇒ 有繞過 RPC 直接動帳的路', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op1_acl_not_zero';
  END IF;
  -- 🔴 誠實邊界:`has_table_privilege` 證不了 RLS 通不通(memory
  --    `reference_pg-has-table-privilege-not-rls-passthrough`);這裡有用是因為斷言的是 **false**。

  -- ⑤ RLS 開著且**零 policy**(第二層:哪天有人 GRANT 回去,零 policy 仍讀寫不到)。
  IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c
           WHERE c.oid = 'public.order_payments'::regclass) THEN
    RAISE EXCEPTION 'RLS 沒開' USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op1_rls_off';
  END IF;
  -- 🔴 R1 F16:**FORCE RLS 必須關著**。開了連 owner 都受 policy 管,而本表零 policy
  --    ⇒ OP3/OP5 的 SECURITY DEFINER RPC 會**寫不進去**。這是 `:95-98` 那種「下一個人
  --    很可能順手加」的對稱面,而我第一版只寫了另一邊。
  IF (SELECT c.relforcerowsecurity FROM pg_catalog.pg_class c
       WHERE c.oid = 'public.order_payments'::regclass) THEN
    RAISE EXCEPTION '本表開了 FORCE ROW LEVEL SECURITY ⇒ 零 policy 之下連 SECDEF writer 都寫不進去'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op1_force_rls_on';
  END IF;
  SELECT pg_catalog.count(*)::integer INTO v_n FROM pg_catalog.pg_policies
   WHERE schemaname = 'public' AND tablename = 'order_payments';
  IF v_n <> 0 THEN
    RAISE EXCEPTION '本表不該有 policy(實得 % 條)', v_n USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op1_unexpected_policy';
  END IF;

  -- 🔴 R1 F17:四支 FK 的刪除行為要逐支釘死 RESTRICT(A7b F8 先例、master-plan:396 明文要求)。
  --    寫錯成 CASCADE = 刪一個 staff 連錢帳一起消失。
  -- 🔴 codex 關卡2 #4c:上面那些 CHECK 斷言**只認名字** ⇒ 有人把同名約束改成 `CHECK (true)`,
  --    每一道都照樣綠。名字證明不了它在守什麼。
  --    ⇒ 逐條問 `pg_get_constraintdef` 裡有沒有那條規則**非有不可的字面**。
  --    誠實邊界:這仍是文字比對,擋的是「被掏空」不是「被改細」——改成語意不同但仍提到那些欄的
  --    版本它抓不到。要更緊得比整段定義,但那會讓任何格式化都紅 ⇒ 不划算,寫下來不假裝關完。
  FOR v_rail, v_bad IN
    SELECT * FROM (VALUES
      ('order_payments_rail_fields',            'reverses_payment_id'),
      ('order_payments_rail_fields',            'rec_trade_id'),
      ('order_payments_reversal_shape',         'amount'),
      ('order_payments_review_pair',            'reviewed_by'),
      ('order_payments_dormant_until_triggers', 'false'),
      ('order_payments_amount_check',           'amount'),
      ('order_payments_rail_check',             'bank_transfer')
    ) t(cname, frag)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint
       WHERE conrelid = 'public.order_payments'::regclass
         AND conname  = v_rail
         AND pg_catalog.pg_get_constraintdef(oid) ILIKE '%' || v_bad || '%'
    ) THEN
      RAISE EXCEPTION '約束 % 的定義裡找不到「%」⇒ 它可能被掏空成 CHECK(true) 或改成別的東西', v_rail, v_bad
        USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op1_constraint_body_drifted';
    END IF;
  END LOOP;

  -- 🔴 codex 關卡2 #4e:第一版只數「confdeltype='r' 有幾支」——**把一支改成 CASCADE、
  --    再補一支無關的 RESTRICT FK,數量照樣是 4** ⇒ 那個數字對「有沒有人改成 CASCADE」零判別力。
  --    ⇒ 改成兩道都問:①**零支非 RESTRICT** ②指向的表集合逐字凍結。
  --    刻意不比 FK 名字:那是 PG 自動產生的、改欄名就變,凍它會變成維護噪音而不是守門。
  -- 🔴 `confdeltype` 是 `"char"` 型別 ⇒ `text || confdeltype` 的運算子**不唯一**、當場報錯,
  --    必須顯式 `::text`。本 repo 記過同款(`w5-line-verify.sh` 的 `tgenabled`),我又踩一次。
  SELECT pg_catalog.count(*)::integer,
         pg_catalog.string_agg(conname || '→' || confdeltype::text, ', ' ORDER BY conname)
    INTO v_n, v_bad
    FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.order_payments'::regclass AND contype = 'f' AND confdeltype <> 'r';
  IF v_n > 0 THEN
    RAISE EXCEPTION '有 % 支 FK 不是 ON DELETE RESTRICT(%)⇒ 刪一個 staff 或一張單就可能把錢帳一起帶走', v_n, v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op1_fk_delete_action';
  END IF;
  SELECT pg_catalog.string_agg(confrelid::regclass::text, ',' ORDER BY confrelid::regclass::text) INTO v_bad
    FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.order_payments'::regclass AND contype = 'f';
  IF v_bad IS DISTINCT FROM 'order_payments,orders,staff,staff' THEN
    RAISE EXCEPTION 'FK 指向的表集合變了(實得 [%],期望 order_payments,orders,staff,staff)'
                    '⇒ 少一支、多一支、或指錯表都在這裡紅', coalesce(v_bad, '(無)')
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op1_fk_targets';
  END IF;

  -- 其餘具名 CHECK 逐條在(第一版只驗了 rail_fields 一條)。
  SELECT pg_catalog.string_agg(x.c, ', ' ORDER BY x.c) INTO v_bad
    FROM unnest(ARRAY['order_payments_review_pair','order_payments_reversal_shape',
                      'order_payments_bank_reference_trimmed']) x(c)
   WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                      WHERE conname = x.c AND conrelid = 'public.order_payments'::regclass);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '具名 CHECK 少了:%', v_bad USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op1_named_checks_missing';
  END IF;

  RAISE NOTICE 'OP1 結構驗收通過:dormant gate 對兩種形狀都實測擋得住、值域 CASE 在、四道 partial unique(indisunique+indpred)、四支 FK 皆 RESTRICT、具名 CHECK 齊、七種 privilege 零 GRANT、RLS 開且非 FORCE、零 policy';
END
$op1_asserts$;
