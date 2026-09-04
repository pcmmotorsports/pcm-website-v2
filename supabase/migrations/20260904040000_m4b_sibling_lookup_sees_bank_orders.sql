-- ============================================================
-- 20260904040000 · 讓 find_active_sibling_own 看得見【未付款的匯款單】
--   線【信】-mail · 片 A of ⟦b4-BANKORDERINVISIBLE⟧
--
-- 🔴 **根因一句**:三處都用「有沒有 payment_charge_attempts」當「有沒有進行中的單」的代理,
--    而**一條正確的匯款流程不會建立卡片 attempt** ⇒ 那些述詞對匯款單一律為假。
--    本片只修其中一處(② find_active_sibling_own);
--    ① begin_charge_attempt 的 cart dedup 在**片 B**(它需要 Sean 已拍的第三種出口)。
--
-- 🔴🔴 **本片對【刷卡】那條路是【行為零改變】, 而那是刻意的不是巧合**:
--    新分支只在「未付款 ∧ 零 active attempt ∧ payment_channel='bank_transfer'」時成立,
--    而那三個條件同時為真的單, 在本片之前**根本不會被 WHERE 選中** ⇒ 它落在 `none`。
--    ⇒ 📌 **⇒ 所以本片是把一個【碰巧回 none】換成一個【明確回 bank_pending】。**
--       而「碰巧正確的東西, 你去驗它會通過」—— 守門測試釘的就是這個差別。
--
-- 🔵 **上層怎麼用它(Sean 2026-09-04 追加拍板 Q-改付款 = 乙, 原話逐字在
--    ~/pcm-mailbox/Sean拍板-20260904-七題.md 檔尾)**:
--      「乙 讓他刷卡, 而自動把那張匯款單取消」
--    ⇒ ⇒ 🔴 **所以 preflight 對 bank_pending 回 `proceed`(讓他刷), 不是 hold(擋住他)。**
--       ⚠️ 而**自動取消那半不在本片** —— 它是 begin_charge_attempt 的第三種出口(片 B)。
--       ⇒ 🛑 **⇒ 片 A 之後, 雙重付款那個洞【還在】。**
--          `BANK_TRANSFER_CHECKOUT_ENABLED` 在片 B 也做完之前**不得翻 true**。
--
-- 🛑 **絕不把匯款單餵進 settleCharge** —— 它的 rec_trade_id 與 bank_transaction_id **兩個都 NULL**,
--    拿一張沒有卡片交易的單去問 TapPay「這筆刷成功了嗎」
--    ⇒ 📌 **那不是一個比較差的答案, 是一個沒有意義的問題。**
--
-- 🔬 **前置閘的基準線是量到的**(唯讀正式庫, 2026-09-04, `pcm_readonly` · `transaction_read_only=on`):
--      md5(prosrc) = f89038663b336f6e3844c99b72985e44 · length = 1899 · pronargs = 1
--    🟢 正對照 begin_charge_attempt ⇒ 1   ⚪ 負對照 qzx7419_nope ⇒ 0
-- ============================================================

BEGIN;

-- ── 1. 前置閘:我要取代的, 是不是我讀過的那一版 ──────────────────
DO $pre$
DECLARE v_md5 text; v_len integer;
BEGIN
  SELECT md5(p.prosrc), pg_catalog.length(p.prosrc) INTO v_md5, v_len
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'find_active_sibling_own';

  IF NOT FOUND THEN
    RAISE EXCEPTION '前置閘:public.find_active_sibling_own 不存在 ⇒ 這個庫不是我對著做的那個 ⇒ 拒繼續';
  END IF;

  -- 🔴 **不比對就替換 = 拿一份對著舊世界寫的副本去蓋掉一個我沒讀過的東西。**
  IF v_md5 <> 'f89038663b336f6e3844c99b72985e44' OR v_len <> 1899 THEN
    RAISE EXCEPTION '前置閘:find_active_sibling_own 的 prosrc 與我抽取時不符(md5=% len=%)⇒ 它被改過 ⇒ 拒繼續', v_md5, v_len;
  END IF;
END
$pre$;

-- ── 2. 換那支函式(CREATE OR REPLACE、簽名相同 ⇒ 不產生第二 overload、ACL 保留)──
CREATE OR REPLACE FUNCTION public.find_active_sibling_own(p_cart_session_id uuid)
RETURNS jsonb  -- discriminated union:{kind:'paid'|'active'|'bank_pending'|'none', existingOrderId?, attemptId?, displayId?}
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_row record;
BEGIN
  -- own-only fail-safe:無 JWT / 無 cart → none(不洩他人單、不誤命中)
  IF v_uid IS NULL OR p_cart_session_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'none');
  END IF;

  -- 鏡像 begin 安全排序;LEFT JOIN active(pending|charged)attempt;paid 即使無 active attempt 也找到
  SELECT o.id          AS order_id,
         o.display_id  AS display_id,
         (o.payment_status = 'paid'::public.payment_status) AS is_paid,
         a.id          AS attempt_id,
         o.payment_channel AS payment_channel,
         o.payment_status  AS payment_status
    INTO v_row
    FROM public.orders o
    LEFT JOIN public.payment_charge_attempts a
      ON a.order_id = o.id AND a.status IN ('pending', 'charged')
   WHERE o.customer_user_id = v_uid
     AND o.cart_session_id  = p_cart_session_id
     -- 🔴 A8a3-G:**已取消的單不是「進行中的單」**。
     --    在本片之前這一條是多餘的(能被取消的單必定 unpaid ⇒ 永遠不滿足下一行的 paid 分支);
     --    A8a3 讓「現金已付款」可以取消 ⇒ 出現 cancelled=true 且 payment_status='paid' 的新形狀
     --    ⇒ 少了這一行,**客人會被自己那張已被取消的單擋住重新結帳**。
     AND o.cancelled_at IS NULL
     AND (
          o.payment_status = 'paid'::public.payment_status
       OR a.id IS NOT NULL
       -- 🔴🔴 **20260904040000 新增的唯一一條**:未付款的匯款單。
       --    它 unpaid 且零 attempt ⇒ 上面兩支都假 ⇒ **在本片之前它落在 none**(= 看不見)。
       --    ⚠️ 這一行**不會多選到任何刷卡單** —— 刷卡單的 payment_channel 是 'tappay',
       --    而已付款的匯款單走上面第一支(paid), 不會走到這裡。
       -- 🔴🔴 **判準是「精確等於 unpaid」, 不是「不等於 paid」**(codex 關卡2 must-fix ①, 我實測核過):
       --    🔬 唯讀正式庫查 pg_enum ⇒ payment_status 有 **5 個值**:
       --       unpaid / paid / partiallyPaid / refunded / partiallyRefunded
       --    ⇒ 🛑 `<> 'paid'` 會**一次收進四個**, 其中 partiallyPaid 是「已經收到一部分錢」
       --      ⇒ 那張單被判成 bank_pending ⇒ preflight 放行 ⇒ **一張已部分收款的單旁邊再開一張刷卡單。**
       --    ⇒ 📌 **一個否定式的條件, 它的射程是【剩下全部】, 而剩下全部會隨 enum 增值而變大。**
       OR (o.payment_channel = 'bank_transfer'
           AND o.payment_status = 'unpaid'::public.payment_status)
     )
   ORDER BY (o.payment_status = 'paid'::public.payment_status) DESC,
            -- 🔴🔴 **這一行是 20260904040000 新增的, 而它修的是我自己寫反的一句註解**
            --    (codex 關卡2 must-fix ②;我在正式庫實跑 `SELECT x FROM (VALUES (true),(false),(NULL)) v(x)
            --     ORDER BY x DESC` ⇒ **印出來的順序是 NULL, t, f**)。
            --    ⛔ ~~原註解:「匯款單的 a.status 是 NULL ⇒ 排在 charged 之後」~~ **正好相反** ——
            --      Postgres 的 `DESC` 預設是 `NULLS FIRST` ⇒ 匯款單會**排在 charged / pending 前面**
            --      ⇒ 🛑 客人同時有「刷卡在途」與「未付款匯款單」時, **匯款那張會贏**
            --        ⇒ 回 bank_pending ⇒ preflight `proceed` ⇒ **繞過 settle 那道裁決。**
            --    ✅ 修法 = 多一個【NULL-safe 的鍵】排在前面:有 attempt 的一律優先。
            --    🔵 而它對【只有刷卡單】的世界是行為零改變:那些列 `a.id IS NOT NULL` 恆真 ⇒ 打平 ⇒
            --      落到下面兩個舊鍵, 逐字如舊。
            (a.id IS NOT NULL) DESC,
            (a.status = 'charged') DESC NULLS LAST,
            o.created_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'none');
  END IF;

  IF v_row.is_paid THEN
    -- paid sibling:DB 確定完成 → 顯既有單(不強迫帶 attemptId;資料最小化、無 rec/bank)
    RETURN pg_catalog.jsonb_build_object(
      'kind',            'paid',
      'existingOrderId', v_row.order_id,
      'displayId',       v_row.display_id
    );
  END IF;

  -- 🔴 **未付款的匯款單:第三種出口。**
  --    判準是 `attempt_id IS NULL` **而不是只看 payment_channel** ——
  --    因為一張 payment_channel='bank_transfer' 而**有** active attempt 的單, 意思是
  --    「有人真的對它跑過卡片扣款」⇒ 那是 active 的世界, 要交 settleCharge, 不是這裡。
  --    ⇒ 📌 **兩個條件都要, 少一個就會把一張正在扣款的單當成純匯款單放過去。**
  --    ⚠️ 而 `is_paid` 為假**不等於** unpaid(見上面 enum 那 5 個值)⇒ 這裡也要精確比。
  IF v_row.attempt_id IS NULL
     AND v_row.payment_channel = 'bank_transfer'
     AND v_row.payment_status = 'unpaid'::public.payment_status THEN
    RETURN pg_catalog.jsonb_build_object(
      'kind',            'bank_pending',
      'existingOrderId', v_row.order_id,
      'displayId',       v_row.display_id
    );
  END IF;

  -- active(pending|charged 未 paid):交上層 settleCharge 即時裁決(資料最小化:無 recTradeId/bankTransactionId)
  RETURN pg_catalog.jsonb_build_object(
    'kind',            'active',
    'existingOrderId', v_row.order_id,
    'attemptId',       v_row.attempt_id,
    'displayId',       v_row.display_id
  );
END;
$fn$;

-- ── 3. COMMENT(codex 關卡2 nit ①)──────────────────────────────
-- 🔴 `CREATE OR REPLACE` **會把舊的 COMMENT 原樣留著**, 而舊那句(20260820020000:695-700)
--    逐字寫「回 discriminated union paid/active/none」⇒ **它現在少一個, 而它是資料庫裡的權威描述。**
--    📌 一個沒有跟著改的 COMMENT, 比沒有 COMMENT 糟 —— 它會被當成契約來讀。
COMMENT ON FUNCTION public.find_active_sibling_own(uuid) IS
  'M-3 3DS R1a2 + M-4b A8a3-G + **M-4b 段 1 片 A**:立即重刷 preflight own-only sibling lookup'
  '(authenticated SECDEF、auth.uid() 歸屬、search_path='''')。依 p_cart_session_id 找呼叫者自己同 cart 的既有單。'
  '排序 paid > 有 attempt(charged > pending)> 未付款匯款單 > 最新。'
  '回 discriminated union **paid/active/bank_pending/none**(資料最小化)。只 GRANT authenticated。'
  'bank_pending = payment_channel 為 bank_transfer 且 payment_status 精確為 unpaid 且無 active attempt;'
  '它沒有 attemptId, 而上層【不得】把它餵進 settleCharge(它沒有卡片交易可以問)。';

-- ── 4. 事後斷言 ─────────────────────────────────────────────
DO $post$
DECLARE v_n integer; v_src text;
BEGIN
  SELECT count(*), max(p.prosrc) INTO v_n, v_src
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'find_active_sibling_own';

  -- ① 只有一支(CREATE OR REPLACE 沒有意外產生第二 overload)
  IF v_n <> 1 THEN
    RAISE EXCEPTION '事後①:find_active_sibling_own 有 % 支, 預期 1 ⇒ 拒繼續', v_n;
  END IF;

  -- ② 新分支真的在裡面
  --   🛑 **而這一格證的是【字面在】, 不是【它在做事】** —— 那件事由 TS 那側的守門測試釘,
  --      而本檔在註解裡明說, 免得下一個人把這一格讀成行為背書。
  IF pg_catalog.strpos(v_src, 'bank_pending') = 0 THEN
    RAISE EXCEPTION '事後②:新函式體裡找不到 bank_pending ⇒ 換上去的不是我寫的那一版 ⇒ 拒繼續';
  END IF;

  -- ③ 🔴 舊的兩個出口一個都不能少(防「我把新的加上去而把舊的擠掉了」)
  IF pg_catalog.strpos(v_src, '''paid''') = 0 OR pg_catalog.strpos(v_src, '''active''') = 0 THEN
    RAISE EXCEPTION '事後③:paid / active 兩個舊出口有缺 ⇒ 拒繼續';
  END IF;

  -- ④ 🔴 own-only 那道 fail-safe 還在(它是這支函式的安全邊界, 不是可有可無的早退)
  IF pg_catalog.strpos(v_src, 'auth.uid()') = 0 OR pg_catalog.strpos(v_src, 'cancelled_at IS NULL') = 0 THEN
    RAISE EXCEPTION '事後④:own-only 或 cancelled_at 那道守門不見了 ⇒ 拒繼續';
  END IF;

  -- ⑤ 🔴 ACL 沒漂(codex 關卡2 must-fix ④):`CREATE OR REPLACE` **會把既有 ACL 原樣保留** ——
  --    包含【已經漂掉的那一種】。前一代(20260820020000:762)明確驗過 anon 不可執行、authenticated 可執行,
  --    ⇒ 本片沿用同一組斷言, 不因為「我沒動 GRANT」就跳過。
  --    📌 **「我沒動它」與「它現在是對的」是兩個宣稱。**
  IF pg_catalog.has_function_privilege('anon', 'public.find_active_sibling_own(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '事後⑤:anon 可以執行 find_active_sibling_own ⇒ ACL 漂了 ⇒ 拒繼續';
  END IF;
  IF NOT pg_catalog.has_function_privilege('authenticated', 'public.find_active_sibling_own(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '事後⑤:authenticated 不能執行 find_active_sibling_own ⇒ 顧客站會整條斷 ⇒ 拒繼續';
  END IF;
END
$post$;

COMMIT;
