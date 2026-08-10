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
-- ── 🔴 本表記「收款流入 + 對它的沖銷更正」,退款不在這裡 ──────────────────
-- 🔴 codex R2-R2 #6:這個小標原本寫「本表只記**流入**」—— 那是第一版(`CHECK (amount > 0)`、
--    零沖銷欄)的字面,設計改成「沖銷列就在本表、金額是被沖列的反號」之後它就錯了。
--    (原句寫「改成沖銷列為負」,2026-08-10 A10 拍板放寬成反號後**這句歷史敘述自己也過期**,同步改。)
--    同一句矛盾字面在本檔出現**三處**
--    (欄位 COMMENT / 表 COMMENT / 這個小標),前兩處在 R2 折掉、這處漏了 = 只補被點名的行
--    (memory `feedback_claimed-sync-but-only-patched-touched-lines`,同一輪內連犯兩次)。
-- ⚠️ 「沖銷 ≠ 退款」:沖銷是**登錄錯誤的更正**(同軌、同單、指向被沖那一列),退款是把錢還給客人。
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
-- A9 **沖銷金額必須等於被沖列金額的「反號」= OP2b 的具名交付物**(跨列比較,CHECK 做不到)。
--    沒有這條,「已收 = SUM(amount)」只擋得住重複沖銷與跨單沖銷,擋不住金額對不上。
--    🔴 **字面 2026-08-10 隨 A10 拍板改過**:原字面是「等於被沖金額的**負值**」,那假設了被沖的一定是
--       收款列(正值);允許沖銷之沖銷之後,被沖的可能是**沖銷列**(負值),它的沖銷必為正
--       ⇒ 正確字面是 `NEW.amount = -被沖列.amount`(反號),不是「恆負」。OP2b 照這句實作。
-- 🏁 A10 **「沖銷本身登錯(誤沖)」的恢復路 = 沖銷之沖銷。已拍板銷案,不再是缺口。**
--    (缺口由 R3 換模型換角度抓到 → `B-348-Q` → **Sean 2026-08-10 晨拍 Q1=A**,
--     memory `project_m4b-0810-morning-seven-decisions` 第 1 條;本顆 commit 就是它的落地。)
--    原本的死路:A2 宣稱「更正走沖銷」,但沖銷機制自己是**單向**的,三條路全堵死 ——
--      ① 沖銷之沖銷:`order_payments_reversal_shape` 舊字面強制沖銷列 `amount < 0`,
--         而沖掉 -500 的那列必須是 +500 ⇒ 該列**物理上構造不出來**。**← 本次放寬的就是這條**
--      ② 重登原收款:被誤沖的那筆卡軌收款仍滿足 `WHERE rail='card' AND reverses_payment_id IS NULL`
--         (predicate 問的是「這列是不是沖銷」,不是「這列被沖過沒」)⇒ 兩道 card unique 擋死。**仍然擋死,照舊**
--      ③ 剩下的只有偽造 `rec_trade_id` 或 owner 直接改列 —— 兩者都破 A2。**仍然禁止**
--    ⇒ 拍板後的合法路**只有 ①**:鏈式沖銷 P(+500) → R1(-500) → R2(+500),每一列都是 append,
--      A2 不破,「已收 = SUM(amount)」照樣成立(500-500+500=500)。
--    🔴 **鏈只保證「不是樹」,不保證「不是環」——這句話的邊界要寫死**
--      (原句寫「鏈不會爆」,codex 關卡2 打回、我實測證實它字面過強):
--        · `one_reversal_uniq`(partial unique on `reverses_payment_id`)擋的**只有**「同一列被沖兩次」
--          ⇒ 鏈不會分岔成樹。**這條沒放寬、不得放寬。**
--        · 它**擋不住環**:自環(某列的 `reverses_payment_id` 指向自己)與雙列互指,
--          每一列的 `reverses_payment_id` 都不同 ⇒ partial unique 看不到;複合自我 FK 只管同單同軌。
--        · 🔴 **實測真值表(2026-08-10,拋棄式 PG17 全新 provision、交易內 DROP gate、跑完 ROLLBACK、
--          每次都驗本表零殘列)**。四發探針、逐格都跑過,**不是推論**:
--            ┌ 形狀 ──────────────────┬ 放寬後(<> 0)─────────┬ 放寬前(< 0)──────────┐
--            │ 自環(一列 -500 指向自己)│ 寫得進,該單 SUM=-500  │ **寫得進**(同樣沒擋)  │
--            │ 兩列皆負互指(-300/-300) │ 寫得進                │ **寫得進**,SUM=-600   │
--            │ 一正一負互指(-300/+300) │ 寫得進,該單 SUM=0     │ **被 reversal_shape 擋** │
--            └────────────────────────┴──────────────────────┴────────────────────────┘
--          ⇒ 結論分兩半,不要混為一談:
--            ① **「環可構造」是 OP1 既有的洞**(自環與全負互指環在放寬前後都寫得進)。
--            ② **「含正額沖銷列的環」是這次放寬新增的面**(表格第三列:舊版擋、新版不擋)。
--            拿「本來就有」當不處理的理由不成立;拿「這次放寬開的洞」當否決拍板的理由也不成立。
--          ⚠️ 兩列互指**單一 multi-row INSERT 就構造得出來**(FK 是 statement 結束才檢查,
--             不需要 `DEFERRABLE`,也不需要事後 UPDATE)—— 這一條是 code-reviewer 判「構造不出來」、
--             我以實跑輸出駁回的;寫在這裡免得下一個人再推論一次。
--    🔴🔴 **⇒ 對 OP2b 的具名要求(A9 的驗收條件,不是散文)**:A9 除了「金額 = 被沖列反號」,
--      **必須同時擋住自環與多列環**(例如:沖銷列不得指向自己 + 被沖列必須是「更早提交且不是沖銷鏈上游」;
--      實作方式由 OP2b 決定,但驗收要有一發環的負測)。**A9 沒擋環 = OP2b 不算完成。**
--    ⚠️ 在 OP2b 落地之前,唯一擋住上述所有形狀的東西是 dormant gate(`CHECK (false)`)——
--      它擋的是**全部寫入**,不是「擋得聰明」。所以 gate 不得先 DROP,見下方發布序那段。
--    🔴 **本次連動改了哪些**(逐條列出,免得下一個人以為只有 CHECK 那一行。
--       code-reviewer nit 打回過一次:上一版宣稱「逐條」卻漏了五處 ⇒ 現在是真的逐條):
--         · `order_payments_reversal_shape`:沖銷列 `amount < 0` → `amount <> 0`。
--         · 檔尾 fail-closed 的片段:`('order_payments_reversal_shape','amount')` → `'amount > 0'`
--           (放寬後片段 `amount` 會被 `CHECK (amount <> 0)` 滿足 = 掏空也全綠,見該處註解)。
--         · A9 字面:「被沖金額的**負值**」→「被沖列金額的**反號**」,並補「A9 必須連環一起擋」。
--         · A9 / 洞③ 的歸屬:`OP2` → **`OP2b`**(OP2 拆片後的正確名字,兩處)。
--         · A10 整段:從「待拍板的具名缺口」改寫成「已拍板銷案」+ 實測真值表 + 對 OP2b 的具名要求。
--         · 「各片影響」整段重寫(OP2a 不受影響 / OP2b・OP3・OP5 解鎖)。
--         · 三處「沖銷列為負 / 沖銷恆負」的散文與 COMMENT(欄位 COMMENT、表 COMMENT、本檔小標)。
--         · `reversal_shape` 約束上方的理由段、`reverses_payment_id` 欄位上方的「誰在守哪一半」段。
--           —— 同一句字面散在多處是本檔的已知病(memory `feedback_claimed-sync-but-only-patched-touched-lines`),
--              所以這次是先 `grep '為負\|恆負\|負值\|amount < 0\|OP2 的'` 建清單再逐處改,不是看到哪改到哪。
--    🔴 **各片影響(主視窗 2026-08-10 裁定的片界,拍板後更新)**:
--         · **OP2a**(A8 閘,`…op2a_received_at_guard.sql`)**從頭到尾不受這題影響**;
--           它的 N6 沖銷列探針用 `amount = -1`,放寬後仍合法 ⇒ 本次改動對它零連動(已實查該檔)。
--         · **OP2b**(A9 + `DROP` dormant gate,同 migration 同交易)**解鎖**,照「反號」字面實作。
--         · **OP3**(card 腿)與 **OP5** 解鎖。
--           (拍板 memory `project_m4b-0810-morning-seven-decisions` §1 逐字是「OP2b/OP3/OP5 解鎖」;
--            上一版漏抄 OP3 = code-reviewer nit 打回,已補。)
--    🔴 **這次放寬新開、而目前無人守的面(登記在案,不要當作沒有)**:
--       「同號沖銷」—— R 沖 P 但金額**同號**(例如 P=+500、R=+500)現在寫得進去,`SUM` 會**高報**。
--       舊 CHECK 擋得住它(沖銷恆負),放寬後擋它的責任整條落在 A9(反號)身上。
--       ⚠️ 本片**沒有**為這個形狀留守門 —— 它與環一樣,都是 A9 的驗收條件。在 OP2b 之前由 gate 全擋。
--       ⚠️ 同族還有一個(R3 nit N2,寫下來免得下一代重推):「**異號但金額不等的正額沖銷**」——
--          例如 R2=+300 沖 R1=-500,符號對了、金額不對,舊 CHECK 一樣擋得住(它禁止正額沖銷列)、
--          放寬後可構造。它被 A9 的「反號」字面涵蓋(反號蘊含等額)⇒ 不必另立要求,但要在清單上。
--    ⚠️ 仍然成立的那條警告:四道 unique 的 predicate 已**逐字凍結**,②那條路日後要打開會很貴。
--       拍板選的是 ①,②維持擋死 —— 這是刻意的,不是還沒做。
-- 🔴 **OP-A11**(OP2a 施工時新增;**這裡是本帳本所有具名交付物的登記處** —— OP3/OP5 的規劃者
--    讀的是這一份清單,散在各片檔頭的東西他們不會去翻):
--    `received_at` 的**時間來源與時鐘偏差政策**,逐軌指定 owner —
--      · **card 軌 = OP3**:值若來自 TapPay 回呼帶回的授權時點,那是**外部系統的時鐘**;
--        OP2a 的 A8 閘比的是 **DB 自己的時鐘**,對時鐘偏差那個面**擋不到**
--        ⇒ 不得把 A8 當成「時間一定對」的證明。
--      · **bank_transfer 軌 = OP5**(主視窗 2026-08-10 裁定):銀行入帳日由人工輸入,
--        「哪個日期算數、誰有權改、輸錯怎麼更正」是 OP5 登錄 RPC 的設計題,不是閘能回答的。
--      · cash 軌沿用 OP5 同一份設計。
-- ⚠️ 命名:本帳本的交付物一律 **`OP-` 前綴**(`OP-A11`),不要寫成 `A11` —— master-plan 另有
--    UI 線的 `A11a/A11b/A11c`,撞名會讓交接信讀起來像在講別人的工作(E-041 撞號同型雷)。
--    A1-A10 是 OP1 落檔時就在的舊編號、不改,新增的一律帶前綴。
-- 任一動搖 ⇒ 停下回報,不自行擴張解釋。
-- ══════════════════════════════════════════════════════════════════════════

-- 🔴🔴 **R2(補跑的凍結版關卡2)#6:整片一交易。** 原本全檔裸奔 ——
--    repo 的 apply 路徑是逐 statement 自動提交(`d1t2-rehearsal.sh:68` 的 `psql -f` 迴圈、
--    以及 `supabase db push`)⇒ **檔尾斷言紅掉時,表與索引已經提交了**,
--    留下一張沒被驗過的錢帳,而重跑會撞 `CREATE TABLE` 已存在。
--    這正是本片存在理由(dormant gate 封住 OP1→OP2 之間)的前提:OP1 自己要嘛全上、要嘛全不上。
--    先例 = A7b-M(`…a7b_m_refund_jobs.sql:75-85`,本片檔頭 `:13` 已引它當分片依據,卻沒抄它這段)。
BEGIN;

-- 🔴 R2 #7:建 FK 要對 `orders` / `staff` 取 SHARE ROW EXCLUSIVE,與 live 結帳的
--    `create_order` INSERT(ROW EXCLUSIVE)互斥。5 秒等不到就整片回滾、改挑離峰重跑,不賭。
--    ⚠️ 照抄 A7b-M 的誠實邊界:`lock_timeout` 只保護「**我**等不到鎖時放棄」,
--       **不保護「結帳交易在等我放鎖」**;整筆交易的持鎖上限要靠 `transaction_timeout`(PG17)。
-- 🔴🔴 **apply 前置(本輪 code-reviewer;不擋 commit、擋 apply)**:`transaction_timeout` 是
--    **PG17 才有**的參數。本片只證到「本機 PG 17.10 可用」,**正式站的 PG 版本本片沒查過**;
--    若正式站 <17,整片會在這一行 `unrecognized configuration parameter` 當場全紅(交易內 ⇒ 零留痕,
--    但那次 apply 白跑)。A7b-M 同款寫法,但它是否已 apply 也未確認 ⇒ **不能拿它當已證**。
--    ⇒ apply 前跑一次 `SHOW server_version;`。
-- 🔴🔴 **codex R2-R2 #1 打回我上一版的處置**:我原本寫「<17 就把這一行拿掉再送」——**不夠**。
--    本檔還有第二個 PG17-only 的東西:檔尾 ACL 斷言的 **`MAINTAIN`** privilege
--    (`has_table_privilege(…, 'MAINTAIN')` 在 PG<17 會 `unrecognized privilege type` 當場紅)。
--    ⇒ **PG<17 的正確處置 = 兩處一起改**(拿掉 `transaction_timeout` + 從 privilege 陣列拿掉
--      `MAINTAIN`),而不是只改看得見的那一處。這種「同一個版本前提撐著兩個地方、只記得一個」
--      正是本片一路踩的同款(memory `feedback_claimed-sync-but-only-patched-touched-lines`)。
--    另兩個 timeout(`lock_timeout` / `statement_timeout`)全版本都有,不受影響。
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL transaction_timeout = '90s';

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
  -- ⇒ 收款列為正、沖銷列 = 被沖列金額的反號,並用 `reverses_payment_id` 指向被沖的那一列。
  --    (A10 拍板前這裡寫「沖銷列為負」;放寬成反號的理由見檔頭 A10。)
  --    好處:「已收」= `SUM(amount)`,不必外接「哪些被沖掉了」的知識 —— 鏈式沖銷也一樣成立:
  --    P(+500)+R1(-500)+R2(+500) = 500。
  amount          integer     NOT NULL CHECK (amount <> 0),

  -- 沖銷:指向被沖掉的那一列。NULL = 這是一筆收款;非 NULL = 這是一筆沖銷。
  -- 🔴 收款列的正負由下方 `order_payments_reversal_shape` 綁死(恆正),不靠寫入端自律。
  -- ⚠️ 沖銷列的正負與金額(= 被沖列的反號)**現在沒有任何東西在守** —— 那是 A9 trigger 的職責,
  --    而 A9 要到 **OP2b** 才落地。在那之前擋住一切的是 dormant gate(全擋,不是擋得聰明)。
  --    別把這兩句讀成「兩層防線」:同一時間點上只有一層在,見檔頭 A10。
  -- 🔴🔴 **我自己追出來的三個洞(在 codex 關卡2 回來之前)**:第一版只有
  --    `REFERENCES order_payments(id)`,於是「已收 = SUM(amount)」這個不變式**站不住** ——
  --    三種**完全合法**的 INSERT 就能把它弄錯:
  --      ① 同一列被沖銷兩次 ⇒ 總額被多扣一次
  --      ② 沖銷**別張單**的列 ⇒ 兩張單的總額同時錯
  --      ③ 沖銷金額 ≠ 被沖金額 ⇒ 總額對不上
  --    ①② 宣告式擋得掉(見下方 composite FK 與 partial unique);
  --    ③ 是跨列比較,CHECK 做不到 ⇒ **OP2b 的具名交付物**(寫進 A9,不是散文)。
  --       (原字面寫「OP2 的」,A10 拍板後 OP2 已拆成 OP2a/OP2b,A9 明確在 **OP2b** ⇒ 同步改。)
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

  -- 🔴 收款列的形狀綁死:收款恆正。少了這條,寫入端可以送出「負數的收款」,
  --    `SUM(amount)` 當場失去意義。
  -- 🔴🔴 **A10 已拍板放寬(Sean 2026-08-10 晨拍 Q1=A;memory `project_m4b-0810-morning-seven-decisions`
  --    第 1 條逐字、原決策題 `B-348-Q`)**:沖銷列從「恆負」放寬成「非零」。
  --    理由 = 誤沖之後唯一的合法恢復路是**沖銷之沖銷**,而那一列必為正:
  --      P(+500) → R1(-500) → R2(+500),R2 沖的是 R1、金額是 R1 的反號。
  --      舊字面「沖銷恆負」讓 R2 **物理上構造不出來** ⇒ 一次誤沖就讓那張單的「已收」永久低報。
  -- ⚠️ **誠實邊界:放寬後本條對沖銷列只剩「非零」,而那與欄位層的 `CHECK (amount <> 0)` 同界
  --    ⇒ 本條實際上只剩「收款恆正」一件事在守。** 沖銷列的正負與金額改由 **A9 trigger** 保證
  --    (字面見檔頭 A9:「沖銷金額 = 被沖列金額的**反號**」),A9 是 **OP2b** 的具名交付物。
  -- 🔴 **為什麼中間沒有裸奔窗口**:OP2b 在**同一支 migration、同一筆交易**裡做「建 A9 + DROP dormant gate」,
  --    而在那之前 `order_payments_dormant_until_triggers`(`CHECK (false)`)擋住本表**所有**寫入
  --    (OP2a 檔頭逐字:「本片不碰 dormant gate。`DROP` gate 綁在 OP2b、與 A9 同 migration 同交易」)。
  --    ⇒ 從本條放寬到 A9 上線之間,一列都寫不進來。**發布序 OP1 → OP2b 不得跳號、gate 不得先 DROP。**
  CONSTRAINT order_payments_reversal_shape
    CHECK ((reverses_payment_id IS NULL AND amount > 0) OR (reverses_payment_id IS NOT NULL AND amount <> 0)),

  -- 🔴 讓下面那道 composite FK 有得指(PK 已保證 id 唯一,本道是為了 FK 的形狀)。
  CONSTRAINT order_payments_id_order_rail_uniq UNIQUE (id, order_id, rail),

  -- 🔴🔴 **洞②的宣告式修法**:沖銷必須指向**同一張單、同一軌**的列。
  --    只寫 `REFERENCES order_payments(id)` 的話,拿別張單的收款來沖是合法的。
  --    composite FK 把「同單同軌」變成**結構事實**,不是 writer 的自律。
  --    `MATCH SIMPLE`(預設):`reverses_payment_id IS NULL` 時整條不檢查 ⇒ 收款列不受影響。
  CONSTRAINT order_payments_reverses_same_order_rail
    FOREIGN KEY (reverses_payment_id, order_id, rail)
    REFERENCES public.order_payments (id, order_id, rail) ON DELETE RESTRICT,

  -- 🔴 `bank_reference` 必須是**正規化後**的值:擋前後空白與空字串。
  -- 🔴🔴 **R2(補跑的凍結版關卡2)自審:原本的理由已經過期,不是我漏改就是我沒重讀。**
  --    R1 F5 當時寫的是「少了這條,**下方那道防重複登錄的 unique** 就形同虛設」「大小寫由
  --    下方 unique 的 `upper()` 處理」—— 但 `bank_reference` 的那道 unique 在同一輪就被拆掉了
  --    (下方唯一性段的誠實邊界「③ `bank_reference` 現在**沒有任何 unique**」那行明寫),
  --    而 `upper()` 從頭到尾不存在於本檔。
  -- ⚠️ **本檔的自我引用一律用文字錨、不用行號**:行號在本輪已被我自己後續的編輯推移過
  --    (memory `feedback_line-numbers-go-stale-from-your-own-later-edits`),文字錨不會。
  --    ⇒ **撤回了實作卻留著宣稱它的註解**(memory `feedback_withdrawal-reason-needs-expiry-condition`
  --      的同族)。約束本身留著,但理由改成它現在真正的樣子:
  --    `bank_reference` 是**給人看的對帳線索**,前後空白會讓「同一筆匯款」在人眼與 `=` 比對下
  --    分裂成兩個值 ⇒ 這條是**資料衛生**,不是任何唯一性的支撐(它現在不支撐任何東西)。
  CONSTRAINT order_payments_bank_reference_trimmed
    CHECK (bank_reference IS NULL OR bank_reference = btrim(bank_reference)),

  -- 🔴 `received_at <= now()` **刻意不寫成 CHECK**。實測 PG 17.10 **接受**這個構造(不報錯),
  --    但 CHECK 的表達式在文件上要求 IMMUTABLE,`now()` 不是 ⇒ 那是「現在能用」不是「保證能用」。
  --    ⇒ 未來時間的閘放在 OP2 的 trigger 裡(那裡用時間函式名正言順)。
  --    🔴 **更正(OP2a 落檔後同步)**:這句原本寫「那裡用 `now()`」——**OP2a 實際用的是
  --       `clock_timestamp()`**。`now()` 是交易開始時刻、比 `clock_timestamp()` 嚴,會誤殺
  --       「交易開始後、寫入前」真的已經發生的時刻。理由全文在 `…op2a_received_at_guard.sql` 檔頭。
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
-- 🔴 **codex R2-R2 #5 = 唯一被駁回的一條(不是漏掉,是已答)**:它重報「換新 `request_id` 可合法
--    重登、跨單各記一次 ⇒ `SUM(amount)` 會高於實際已收」。那正是上面 ①② 逐字寫下的**刻意選擇**,
--    不是被忽略的洞:①「同一筆錢被登兩次」DB 擋不到,靠 OP5 複核與對帳;②「一筆匯款付兩張單」
--    是合法情境,per-order 範圍是為它留的。要 DB 擋得住就得引入「一筆真實金流」的全域身分,
--    而人工軌**沒有可靠的外部識別**(`bank_reference` 允許末五碼,擋了會誤擋真的第二筆錢)。
--    ⇒ 維持原判。若日後 Sean 拍板「寧可誤擋也不可重複入帳」,那是產品決策、回頭改這裡。
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
-- 🔴🔴 **R2 #5:RLS 在這張表的真實實力(原本寫大了)。** 原句是「零 policy ⇒ 哪天有人
--    GRANT 回去仍讀寫不到」——**對 `service_role` 是假的**:它具 `BYPASSRLS`,policy 對它
--    根本不執行(repo 既有實查:`docs/specs/2026-07-30-e10-a7-order-cancellations-plan.md:153`、
--    完整版措辭在 `20260729020000…a2…sql:250-256`)。
--    ⇒ 誠實版:**這張錢帳唯一擋得住 `service_role` 的是 ACL 與金鑰保密,不是 RLS。**
--      RLS 的縱深價值只涵蓋 **非 BYPASSRLS 的角色**(`anon` / `authenticated`):
--      誤 GRANT 給它們時,零 policy 仍全拒。
--    ⚠️ 天花板照抄 A2:role 繼承與 `pg_read_all_data` 這類叢集層授權不在 `relacl` 裡,
--       表層斷言物理上看不到 ⇒ 下方斷言不是完備證明。
ALTER TABLE public.order_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.order_payments FROM PUBLIC, anon, authenticated, service_role, authenticator;

-- 🔴 本輪 code-reviewer:欄位 COMMENT 改了、**表級這句沒跟**(`\d+` 先讀到的是它)——
--    「只記流入」與「沖銷列有負值、就在本表」是同一個矛盾,只補被點名的那一行不算修好
--    (memory `feedback_claimed-sync-but-only-patched-touched-lines`)。
--    🔴 2026-08-10 A10 拍板後**這句自己也改過一次**:原本寫「沖銷列為負」,而拍板允許沖銷之沖銷
--       ⇒ 沖銷列可正可負(必為被沖列的反號)。同一個病第二次發作在同一句話上。
COMMENT ON TABLE public.order_payments IS
  'OP1 收款帳本(master-plan v2 :655 第 3 批第 1 項)。記的是**收款流入 + 對它的沖銷更正**(沖銷列可正可負);'
  '🔴 「沖銷列 = 被沖列的反號」是**設計意圖、還不是已生效的保護** —— 那要等 A9 trigger(OP2b);'
  '在 OP2b 落地之前,本表由 dormant gate 全擋、任何列都寫不進來。詳見 amount 欄的 COMMENT。'
  '**退款不在本表**,照 rail 分流到別的機制'
  '(卡=order_refunds/TapPay refund job、匯款=匯款退款線、現金=現金退還登記)。'
  '🔴 「已收未退總額」要跨源算,非卡軌的退款帳本目前還不存在 = OP6 的前置。'
  '🔴 本表是 A8b partiallyPaid 上限與退款分軌的唯一事實來源。'
  '🔴 零 GRANT + RLS zero-policy;寫入一律走具名 SECDEF RPC。RLS 擋不住 service_role(BYPASSRLS)⇒ 真防線是 ACL 與金鑰保密。'
  '🔴 跨單餘額 / wallet 體系**明確不碰**(Q-C=A:留抵 = 同單折抵)。';
COMMENT ON COLUMN public.order_payments.received_at IS '實際收到錢的時點(匯款=銀行入帳日),不是登錄時間;登錄時間看 created_at。對帳看這欄。';
COMMENT ON COLUMN public.order_payments.rail   IS 'canonical 三值 card/bank_transfer/cash。A8b 讀本欄分軌退款(Q12=A 各自原路退)。';
-- 🔴🔴 **R2 #8 + 我自審同時抓到:這行原本與 DDL 直接矛盾。** 原字面是「整數元、**恆正**。
--    本表只記流入 —— **沖銷**與退款不在這裡」,而同檔 `CHECK (amount <> 0)` 加
--    `order_payments_reversal_shape` 明定**沖銷列有負值且就在本表**。
--    那是「第一版 `CHECK (amount > 0)` + 零沖銷欄」的殘留字面 —— 設計改了、COMMENT 沒跟。
--    COMMENT 是下一個人在 DB 裡讀到的唯一說明,錯的字面比沒有更貴。
--    🔴 2026-08-10 A10 拍板後再改一次:沖銷列不再恆負(見檔頭 A10)。
COMMENT ON COLUMN public.order_payments.amount IS
  '整數元、非零。收款列恆正;沖銷列 = 被沖列金額的反號(可正可負,必帶 reverses_payment_id)。'
  '🔴 現在真正在守的只有「收款恆正」(order_payments_reversal_shape);沖銷分支的 <> 0 與欄位 CHECK 同界、等於沒守。'
  '沖銷列的金額正確性(反號)與環的防護要等 A9 trigger(OP2b)——**在 OP2b 落地前,本表由 dormant gate 全擋、任何列都寫不進來**,'
  '不要把這句讀成「沖銷金額已經受保護」。'
  '⇒ 「已收」= SUM(amount)。🔴 退款不在本表(照 rail 分流到別的機制);沖銷 ≠ 退款,沖銷是登錄錯誤的更正。';

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
  -- 🔴🔴 **探針的兩條教訓保留、實作已收斂成下面一個迴圈**
  --  · R1 F14:哨兵 RAISE 與探針在同一個 BEGIN 內會被 `WHEN others` 接住 ⇒ INSERT 真的成功時
  --    印出來的訊息與事實相反。⇒ 每個 handler 第一條一律 `WHEN SQLSTATE 'P2B20' THEN RAISE`。
  --  · 第一版 handler 寫 `WHEN check_violation OR foreign_key_violation THEN NULL`,而探針的
  --    order_id / actor 是假值 ⇒ **FK 也會擋**;gate 改成 `CHECK (true)` 時擋下來的是 FK、
  --    斷言照樣印「通過」= 兩道都擋、證不了是哪一道
  --    (memory `feedback_negative-test-observation-supplied-by-another-mechanism`)。
  --    ⇒ 認 conname;用 `IS DISTINCT FROM` 不用 `<>`(conname 為 NULL 時 `<>` 靜默吞,A5a 前科)。
  --
  -- 🔴🔴 **本輪 code-reviewer:刪掉原本兩發 standalone 探針(card / cash)。**
  --    ① 它們與下面的迴圈完全重疊 —— 迴圈已逐軌探,且每軌帶該軌合法的欄位形狀。
  --    ② 更糟的是舊 cash 探針**沒帶 `request_id`** ⇒ 它同時違反 `order_payments_rail_fields`;
  --       之所以還是紅在 gate,靠的是 PG 挑失敗 constraint 的順序
  --       (`order_payments_dormant_until_triggers` 排在 `order_payments_rail_fields` 前面)——
  --       一個**沒寫出來的隱含依賴**,改個約束名就翻盤。這正好違反我自己在沖銷探針那裡立的紀律
  --       「探針要把其餘 CHECK 全部滿足,否則紅的會是別條」。⇒ 刪掉,不留兩套。

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
      -- 🔴 R2 自審:F14 的同一形狀原本漏了迴圈這一處(兩發 standalone 探針有、迴圈沒有;
      --    那兩發已於本輪刪除,見上方註解)。自己的哨兵 RAISE 若被下面的 `WHEN others` 接住,
      --    印出來的訊息會與事實相反。
      --    ⚠️ 誠實邊界(R3 F5 更正我上一版的理由:原本寫「FK 恆先擋」,**理由是錯的**——
      --       PG 的 CHECK 早於 FK(FK 是 after-row trigger)。正確的說法要分兩支:
      --       ①gate 正常時,擋探針的是 gate 這條 CHECK;②gate 被掏空成 `CHECK (true)` 時,
      --       才輪到 FK(假 order_id/actor)接手。**兩支都不會讓 INSERT 成功**
      --       ⇒ 這支哨兵**目前不可達、影響為零,也沒有可構造的負測 ⇒ 不宣稱它被證明過**。
      --       結論與上一版相同,但上一版只寫了其中一支的理由 = 理由與事實不符。
      --       補它是因為 OP2 的探針會換成真 id,那時它就活了。
      WHEN SQLSTATE 'P2B20' THEN RAISE;
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

  -- 🔴🔴 **R2 #1(must-fix):上面迴圈那三發探針全是「收款列」形狀**(`reverses_payment_id` 恆 NULL)
  --    ⇒ 把 gate 換成 `CHECK (reverses_payment_id IS NOT NULL)`(**只擋收款列、放行沖銷列**)時,
  --      三軌探針因為仍被 gate 擋住而**全綠**,可是沖銷列已經寫得進這本錢帳。⇒ 補第四種形狀。
  --    🔴 極性別寫反(本輪 code-reviewer 抓到我第一版寫成 `IS NULL`,那是**放行收款列**、
  --       會讓舊探針自己就紅 ⇒ 紅的是舊探針、不是新探針,整條舉證作廢
  --       —— memory `feedback_negative-test-observation-supplied-by-another-mechanism`)。
  --    判別力來源:基準時 `CHECK (false)` 在 row 寫入當下就紅 ⇒ conname 對得上(綠);
  --    上述突變下這一發通過所有 CHECK、改由**複合自我 FK**(指向不存在的 id)擋 ⇒ 落到
  --    `WHEN others` 判紅,而三發舊探針全綠。**只有這一發會動,方向可觀測、不是恆真。**
  --    ⚠️ 本列刻意把其餘 CHECK 全部滿足(沖銷列三個識別欄皆 NULL、有 reversal_reason、amount < 0),
  --       否則紅的會是別條 CHECK,證不到 gate。
  DECLARE v_con3 text;
  BEGIN
    INSERT INTO public.order_payments (order_id, rail, amount, received_at,
                                       reverses_payment_id, reversal_reason, actor)
    VALUES ('00000000-0000-0000-0000-000000000000', 'card', -1, now(),
            '00000000-0000-0000-0000-000000000002', 'probe', 'probe');
    RAISE EXCEPTION 'dormant gate 對沖銷列形狀沒擋住 ⇒ 它只擋收款列,不是全擋'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op1_dormant_gate_partial';
  EXCEPTION
    WHEN SQLSTATE 'P2B20' THEN RAISE;
    WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_con3 = CONSTRAINT_NAME;
      IF v_con3 IS DISTINCT FROM 'order_payments_dormant_until_triggers' THEN
        RAISE EXCEPTION '沖銷列探針被 % 擋住(不是 dormant gate)⇒ 證不到 gate 對沖銷列有效',
                        coalesce(v_con3, '(conname 為 NULL)')
          USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op1_dormant_gate_wrong_blocker';
      END IF;
    WHEN others THEN
      GET STACKED DIAGNOSTICS v_con3 = CONSTRAINT_NAME;
      RAISE EXCEPTION '沖銷列探針被非 CHECK 的東西擋住(%)⇒ dormant gate 對沖銷列沒生效',
                      coalesce(v_con3, '(未提供 conname)')
        USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op1_dormant_gate_wrong_blocker';
  END;

  -- ② 值域 CASE 的 ELSE 分支:新增 rail 值卻沒寫規則時要當場紅。
  --    這裡只能驗約束在;它的判別力由 OP1 的 harness 用突變證。
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                  WHERE conname = 'order_payments_rail_fields'
                    AND conrelid = 'public.order_payments'::regclass) THEN
    RAISE EXCEPTION 'rail 值域約束不在' USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op1_rail_fields_missing';
  END IF;

  -- ③ 四道 partial unique:鍵欄與 WHERE **逐字**對過(整表 UNIQUE 對 NULL 不生效 = 假守門)。
  -- 🔴 R1 F13:第一版只比 indexname + `indexdef LIKE '%WHERE%'`,不驗 UNIQUE、不驗欄位、不驗內容。
  -- 🔴 codex R2 #2:改成 `indisunique + indpred IS NOT NULL` 之後仍只量**形狀** ——
  --    把 `request_id_uniq` 改建在 `(order_id, payer_note) WHERE payer_note IS NOT NULL`,四道照樣全綠,
  --    而人工軌的冪等鍵當場消失(memory `feedback_guard-checks-existence-not-effect`)。
  -- 🔴🔴 **codex R2-R2 #3(must-fix):片段比對還是不夠。** 上一版用 ILIKE 比「必要字面」,
  --    於是在 WHERE 後面加一個 ` AND false` —— 必要字面還在、斷言全綠,而 partial index 覆蓋零列
  --    = **唯一性完全失守**。片段比對擋得住「換條件」,擋不住「疊上一個恆假的條件」。
  --    ⇒ 改成 predicate **逐字相等**。凍結值取自 catalog 實查(`pg_get_expr`),不是我寫出來的:
  --      card_idem / rec_trade_global = `((rail = 'card'::text) AND (reverses_payment_id IS NULL))`
  --      request_id = `(request_id IS NOT NULL)` / one_reversal = `(reverses_payment_id IS NOT NULL)`
  --    ⚠️ 代價寫明:PG 若改變 `pg_get_expr` 的渲染格式,這四道會一起紅。那是**要人看一眼**的紅,
  --       不是噪音 —— 錢帳的唯一性值得這個代價;不划算的是索引名那種會隨欄名漂的東西。
  -- 🔴 codex R2-R2 #2:查詢要綁 `indrelid` —— 只綁 schema+name 時,把索引建到**別張表**上
  --    (名字照舊)仍可能因為那張表剛好有同名欄位而全綠,而 order_payments 根本沒有這道索引。
  DECLARE
    v_ix text; v_cols text; v_pred text; v_act_cols text; v_act_pred text;
  BEGIN
    FOR v_ix, v_cols, v_pred IN
      SELECT * FROM (VALUES
        ('order_payments_card_idem_uniq',        'order_id,rec_trade_id', '((rail = ''card''::text) AND (reverses_payment_id IS NULL))'),
        ('order_payments_rec_trade_global_uniq', 'rec_trade_id',          '((rail = ''card''::text) AND (reverses_payment_id IS NULL))'),
        ('order_payments_request_id_uniq',       'order_id,request_id',   '(request_id IS NOT NULL)'),
        ('order_payments_one_reversal_uniq',     'reverses_payment_id',   '(reverses_payment_id IS NOT NULL)')
      ) t(ix, cols, pred)
    LOOP
      -- 🔴 `indisunique` 放進 WHERE 而不是另外斷言:索引被改成非唯一時這裡查無列
      --    ⇒ v_act_cols 為 NULL ⇒ 下面 `IS DISTINCT FROM` 判紅。一道守門同時擋兩種壞法。
      v_act_cols := NULL; v_act_pred := NULL;
      SELECT (SELECT pg_catalog.string_agg(a.attname, ',' ORDER BY k.ord)
                FROM unnest(i.indkey::smallint[]) WITH ORDINALITY k(attnum, ord)
                JOIN pg_catalog.pg_attribute a
                  ON a.attrelid = i.indrelid AND a.attnum = k.attnum),
             pg_catalog.pg_get_expr(i.indpred, i.indrelid)
        INTO v_act_cols, v_act_pred
        FROM pg_catalog.pg_index i
        JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname = v_ix
         AND i.indrelid = 'public.order_payments'::regclass
         AND i.indisunique;
      IF v_act_cols IS DISTINCT FROM v_cols THEN
        RAISE EXCEPTION '唯一索引 % 的鍵欄是 [%],期望 [%]⇒ 換欄、改成非唯一、或建到別張表都紅在這裡',
                        v_ix, coalesce(v_act_cols, '(order_payments 上查無此唯一索引)'), v_cols
          USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op1_partial_unique_columns';
      END IF;
      IF v_act_pred IS DISTINCT FROM v_pred THEN
        RAISE EXCEPTION '唯一索引 % 的 WHERE 是 [%],期望逐字 [%]⇒ 少了 WHERE、換了條件、或疊上恆假條件都紅在這裡',
                        v_ix, coalesce(v_act_pred, '(無 predicate = 整表 UNIQUE)'), v_pred
          USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op1_partial_unique_predicate';
      END IF;
    END LOOP;
  END;

  -- 🔴🔴 **codex R2-R2 #4(must-fix):複合自我 FK 的三欄不能只問「定義裡有沒有那個字」。**
  --    上一版把 `reverses_payment_id` / `order_id` / `rail` 當字串片段丟進下面那個 constraint 定義
  --    比對迴圈。但把**本地端第三欄**改成 `rec_trade_id`(被參照端仍是 `rail`)時,三個字都還在
  --    定義字面裡 ⇒ 全綠;而 `rec_trade_id` 對非卡軌恆為 NULL,MATCH SIMPLE 讓**整條 FK 跳過**
  --    ⇒ 洞② 的「同單同軌」重新失守,而且是無聲的。
  -- ⇒ 改成問 catalog 的欄位**清單**:本地端三欄、被參照表、被參照端三欄,逐字相等。
  --    凍結值取自 catalog 實查(conkey / confkey 展開),不是我寫出來的。
  DECLARE
    v_fk text; v_lcols text; v_ftab text; v_fcols text; v_match text;
  BEGIN
    SELECT (SELECT pg_catalog.string_agg(a.attname, ',' ORDER BY k.ord)
              FROM unnest(c.conkey) WITH ORDINALITY k(n, ord)
              JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.n),
           c.confrelid::regclass::text,
           (SELECT pg_catalog.string_agg(a.attname, ',' ORDER BY k.ord)
              FROM unnest(c.confkey) WITH ORDINALITY k(n, ord)
              JOIN pg_catalog.pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.n)
           , c.confmatchtype::text
      INTO v_lcols, v_ftab, v_fcols, v_match
      FROM pg_catalog.pg_constraint c
     WHERE c.conrelid = 'public.order_payments'::regclass
       AND c.contype = 'f'
       AND c.conname = 'order_payments_reverses_same_order_rail';
    -- 🔴🔴 **R3(換模型換角度)F2:`confmatchtype` 也要凍。** 上一版只凍欄位清單 ⇒ 把 FK 改成
    --    `MATCH FULL`(欄位清單逐字不變)本片**全綠**,可是 MATCH FULL 要求「全 NULL 或全非 NULL」,
    --    而**收款列**正是 `reverses_payment_id` NULL + `order_id`/`rail` 非 NULL
    --    ⇒ OP3 上線後每一筆結帳寫帳都被 FK 拒。上方 `MATCH SIMPLE(預設)` 那句註解明文依賴它,
    --      依賴卻沒凍 = 又一個「宣稱有、實際沒守」。`'s'` = MATCH SIMPLE。
    v_fk := coalesce(v_lcols, '(查無)') || ' -> ' || coalesce(v_ftab, '(查無)') || '(' || coalesce(v_fcols, '(查無)') || ')'
            || ' MATCH ' || coalesce(v_match, '(查無)');
    IF v_fk IS DISTINCT FROM 'reverses_payment_id,order_id,rail -> order_payments(id,order_id,rail) MATCH s' THEN
      RAISE EXCEPTION '複合自我 FK 是 [%],期望逐字 [reverses_payment_id,order_id,rail -> order_payments(id,order_id,rail) MATCH s]'
                      '⇒ 縮成單欄、換欄、指錯表、或改成 MATCH FULL 都紅在這裡'
                      '(換成恆 NULL 的欄會讓 MATCH SIMPLE 整條跳過;改 MATCH FULL 會讓收款列全部寫不進)', v_fk
        USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op1_reversal_fk_columns';
    END IF;
  END;

  -- 🔴🔴 **R3 F3:唯一性斷言只驗「正面清單存在」,沒驗「不多出來」。**
  --    FK 那道明文抓「多一支」(表集合逐字凍結),unique 這族卻只逐道點名 ⇒ 有人把 R1 拆掉的
  --    `UNIQUE (bank_reference)` **加回來**(正是「同單兩筆合法匯款末五碼相同時誤擋真的第二筆錢」
  --    那顆雷),四道照樣全綠、零斷言會紅。兩族守門形狀不對稱 = 其中一族有縫。
  -- ⇒ 凍結本表唯一索引的**總數**:PK + `id_order_rail_uniq` + 四道 partial = 6。
  SELECT pg_catalog.count(*)::integer INTO v_n
    FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
   WHERE i.indrelid = 'public.order_payments'::regclass AND i.indisunique;
  IF v_n <> 6 THEN
    SELECT pg_catalog.string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_bad
      FROM pg_catalog.pg_index i
      JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
     WHERE i.indrelid = 'public.order_payments'::regclass AND i.indisunique;
    RAISE EXCEPTION '本表唯一索引 % 道(期望 6:PK + id_order_rail_uniq + 四道 partial)實得 [%]'
                    '⇒ 多一道也要紅 —— 例如把已拆除的 UNIQUE(bank_reference) 加回來會誤擋真的第二筆匯款', v_n, coalesce(v_bad, '(無)')
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op1_unique_index_count';
  END IF;

  -- ④ 零 GRANT:逐角色 × 逐 privilege 實查。
  -- 🔴 R1 F15:第一版的理由寫反了 —— `has_table_privilege` **本身就是表級**,對欄級
  --    `pg_attribute.attacl` 全盲(memory `reference_pg-table-acl-flatten-blind-to-column-grants`)。
  --    本表建立當下不可能有欄級 GRANT,所以影響為零;但那句錯的理由會被抄到 OP2 去。
  -- 🔴 privilege 補到七個:少了 **TRUNCATE**(拿到就能清空整本錢帳)、REFERENCES、TRIGGER。
  --    `REVOKE ALL` 有做,但斷言沒守 = 又一個「做了但沒證」。
  -- 🔴 R2 #4a:privilege 補到**八**個 —— PG17 新增 `MAINTAIN`(VACUUM/ANALYZE/REINDEX/CLUSTER/
  --    REFRESH MATERIALIZED VIEW)。`REVOKE ALL` 有收,但斷言沒守 = 又一個「做了但沒證」。
  SELECT pg_catalog.string_agg(r || '=' || p, ' ' ORDER BY r, p) INTO v_bad
    FROM (SELECT r, p FROM unnest(ARRAY['anon','authenticated','service_role','authenticator']) r
                          CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p) x
   WHERE pg_catalog.has_table_privilege(x.r, 'public.order_payments', x.p);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '錢帳表對非 owner 角色有權限(%)⇒ 有繞過 RPC 直接動帳的路', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op1_acl_not_zero';
  END IF;
  -- 🔴 誠實邊界:`has_table_privilege` 證不了 RLS 通不通(memory
  --    `reference_pg-has-table-privilege-not-rls-passthrough`);這裡有用是因為斷言的是 **false**。

  -- 🔴🔴 **R2 #4b(must-fix):上面那道只掃「我想得到的四個角色」。** 授權給
  --    第五個角色(自建 role、`supabase_read_only_user`、日後新增的服務帳號)時它**全綠**,
  --    而錢帳已經被別人讀得到。⇒ 改問 `relacl` 本身:**除了 owner,一個 grantee 都不准有**。
  --    這道同時涵蓋 PUBLIC(`aclexplode` 把 PUBLIC 表示成 grantee = 0)。
  SELECT pg_catalog.string_agg(DISTINCT
           CASE WHEN g.grantee = 0 THEN 'PUBLIC' ELSE g.grantee::regrole::text END, ', ') INTO v_bad
    FROM pg_catalog.pg_class c
    CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) g
   WHERE c.oid = 'public.order_payments'::regclass
     AND g.grantee <> c.relowner;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'relacl 裡有 owner 以外的 grantee(%)⇒ 零 GRANT 這句話是假的', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op1_acl_extra_grantee';
  END IF;

  -- 🔴🔴 **R2 #4c(must-fix):欄級 GRANT 對上面兩道全盲。**
  --    `has_table_privilege` 與 `relacl` 都只放**表級**;欄級授權住在 `pg_attribute.attacl`
  --    (memory `reference_pg-table-acl-flatten-blind-to-column-grants` 記過:兩條都要寫,
  --     否則欄級後門隱形)。第一版只在註解裡承認這件事、沒把它變成斷言 —— 承認不是守門。
  --    ⚠️ 本表建立當下不可能有欄級 GRANT ⇒ 這道現在恆綠;它守的是**日後**被人補一句
  --      `GRANT SELECT (amount) ON order_payments TO anon` 而表級斷言照樣全過。
  SELECT pg_catalog.string_agg(a.attname, ', ' ORDER BY a.attname) INTO v_bad
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.order_payments'::regclass AND a.attacl IS NOT NULL;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '有欄級 GRANT(%)⇒ 表級斷言看不到的後門', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op1_column_acl_not_zero';
  END IF;

  -- ⑤ RLS 開著且**零 policy**。
  -- 🔴 R2 #5:原本這行寫「第二層:哪天有人 GRANT 回去,零 policy 仍讀寫不到」——
  --    **對 service_role 是假的**(BYPASSRLS)。縱深只涵蓋 anon / authenticated;
  --    完整說明在上方 `ALTER TABLE … ENABLE ROW LEVEL SECURITY` 前的「R2 #5」那段(文字錨,非行號)。
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
      -- 🔴🔴 code-reviewer(本片)MF2:片段原本是 `'amount'` —— 放寬之後 `reversal_shape`
      --    只剩「收款恆正」一件事在守,而 `amount` 這個子字串在 `CHECK (amount <> 0)` 裡照樣命中
      --    ⇒ 有人把它掏空成 `CHECK (amount <> 0)`,收款恆正整條消失、apply 當下**照樣全綠**。
      --    這道縫是**本次縮小約束職責時新開的**,不是舊債。⇒ 片段升級成 `amount > 0`。
      --    實測 `pg_get_constraintdef` 對本約束渲染成
      --    `CHECK ((((reverses_payment_id IS NULL) AND (amount > 0)) OR (...)))` ⇒ 逐字命中得到。
      ('order_payments_reversal_shape',         'amount > 0'),
      ('order_payments_review_pair',            'reviewed_by'),
      ('order_payments_dormant_until_triggers', 'false'),
      ('order_payments_amount_check',           'amount'),
      ('order_payments_rail_check',             'bank_transfer')
      -- 🔴 R2 #3 原本在這裡加了三行片段(複合自我 FK 的三個欄名)。
      --    codex R2-R2 #4 打回:片段比對對「本地端換成另一個也叫得出名字的欄」全盲
      --    ⇒ 已改成上方**逐字比對 conkey/confkey 欄位清單**的具名斷言(pcm_op1_reversal_fk_columns),
      --      這三行片段被它嚴格蘊含,留著只是噪音 ⇒ 移除,不留兩套講同一件事的守門。
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

  -- 🔴 R2:這句原本寫「兩種形狀」「七種 privilege」= 宣稱小於事實;本輪 code-reviewer 又抓到
  --    刪掉重複探針前的數法也不對。NOTICE 也是字面,大小都要對得上實際跑過的東西。
  --    現在的事實:探針 = 迴圈三軌(各帶該軌合法欄位形狀)+ 沖銷列一發 = **四種形狀**。
  RAISE NOTICE 'OP1 結構驗收通過:dormant gate 對 card/bank_transfer/cash 三軌收款列 + 沖銷列共四種形狀都實測擋得住、值域 CASE 在、四道 partial unique 的鍵欄與 WHERE 皆逐字相等、唯一索引總數 6 道(多一道也紅)、複合自我 FK 的欄位清單與 MATCH SIMPLE 逐字釘住、四支 FK 皆 RESTRICT、具名 CHECK 齊、八種 privilege 零 GRANT + relacl 零外部 grantee + 零欄級 ACL、RLS 開且非 FORCE、零 policy';
END
$op1_asserts$;

COMMIT;
