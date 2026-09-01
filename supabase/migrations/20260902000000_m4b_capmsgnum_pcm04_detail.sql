-- ⟦b4-CAPMSGNUM⟧ · 讓「只剩 X 元可退」的那個【數字】離開資料庫
--
-- ══ 一句話 ═══════════════════════════════════════════════════════════════════
--   `445b` 的 trigger 早就算好「這張單只剩 X 元可退」, 而那個 X 今天
--   **只活在一句人話字串裡** ⇒ 員工在畫面上看到的是一句沒有數字的固定文案。
--   本支把 X 變成【結構化欄位】(`DETAIL` 的 JSON), app 層才拿得到它。
--
-- ══ 🔴 定位:那個數字是在【哪一層】不見的(先定位再動手)═══════════════════════
--   `20260830210000:280-286`  RAISE 只帶 `USING ERRCODE = 'PCM04'`, **沒有 DETAIL 也沒有 HINT**
--     ⇒ 🔴 **它在【第 0 層】就沒有離開資料庫** —— 不是「RPC 帶了而 TS 沒讀」,
--       也不是「TS 讀了而 UI 沒印」。那三種的修法在【三個不同的檔】,
--       而它們在「畫面上沒有那個數字」這個症狀上長得一模一樣。
--   `refund-repository.ts:180-188`  `toCapGuard` 只把 `code` 提到頂層, `details` 留在 `cause` 上
--   `refund-actions.ts:124`         `CAP_GUARD_FAILURE_CODE.PCM04 = 'exceeds_remaining'`
--   `refund-action-state.ts:220`    那句固定文案, **零數字插槽**
--   ⇒ ⇒ 所以這一件是【四層都要動】, 而本支是最下面那一層。
--
-- ══ 🛑 為什麼要【新的一支】而不是改原檔 ═══════════════════════════════════════
--   `20260830210000` 已 apply(`scripts/latest-definition-of.sh pcm_order_refund_cap_guard`
--   ⇒ `newest = live = 20260830210000`, 共 1 代)⇒ 改原檔對正式庫零效果。
--   ⇒ 本支 `CREATE OR REPLACE`, **函式本體逐字沿用那一代**, 只加 `DETAIL` / `HINT` 兩行。
--
-- ══ 🛑 本支【不做】什麼 ═══════════════════════════════════════════════════════
--   · 不動那句人話的一個字(它是 `445b` 拍板過的)
--   · 不動 `PCM05` 的兩個語意共用一碼(那是 `⟦b4-PCM05SPLIT⟧`, 另一件)
--   · 不動 trigger 的綁定(本支只 REPLACE 函式本體;trigger 指的是同一個函式名)
--   · **員工看到的那句話怎麼講, 仍然是 Sean 的** —— 本支只讓那個數字【拿得到】。

CREATE OR REPLACE FUNCTION public.pcm_order_refund_cap_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_cap  bigint;
  v_lock uuid;
BEGIN
  -- 🔴 **執行期也斷言隔離級別,不只 apply 時。**
  --    本片的整個推導(「read committed 之下看不到別人未 commit 的列」⇒ 所以需要鎖)
  --    **依賴那個級別**。哪天有人把預設調成 repeatable read / serializable,
  --    鎖的必要性與本閘的行為都會變 —— **而今天沒有任何東西會出聲。**
  --    ⚠️ 它**不是**鎖的替代品:它讓「我假設的世界變了」會叫,不讓超額退款不發生。
  --    🔵 這一行抄自 repo 既有慣例(`pcm_a4a_*_summary_recompute` 等四支都這樣做)。
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION
      '這筆退款的安全檢查在一個沒有預期到的資料庫設定下執行(隔離級別 = %),為了安全先擋下,'
      '退款沒有發起、錢沒有動。請通知系統維護。',
      pg_catalog.current_setting('transaction_isolation')
      USING ERRCODE = 'PCM06';
  END IF;

  -- 🔴🔴 **先鎖父列,再算 cap** —— 這一行是本片的本體。
  --    少了它:兩個 session 各自算出同一個 cap、各自判「還夠」⇒ 兩筆都進去。
  --    **2026-08-30 實測過,不是理論**(見檔頭)。
  --
  -- 🔴🔴 **鎖的【強度】也是承重的,而正確答案已經寫在 repo 裡了**(codex R1 逼我去查):
  -- ```
  -- ⛔ 我第一版用 FOR UPDATE。
  -- 而 `admin_initiate_order_refund`(20260812170000:88-89)逐字寫著:
  --   「G1:FOR NO KEY UPDATE —— **FOR UPDATE 與 FK RI KEY SHARE 死結 40P01 實錘**;
  --     鎖順序沿既有約定 orders → order_refunds;INSERT trigger 的 FOR SHARE 同列同交易相容」
  -- ⇒ **我選的正是他們已經實錘會死結的那一個。**
  -- ✅ 改成 FOR NO KEY UPDATE:①與 FK 檢查的 KEY SHARE 相容 ②仍然與另一個
  --   FOR NO KEY UPDATE 互斥 ⇒ **併發序列化的效果不變**
  -- ```
  -- 📌 **⇒ 這一格不是我推出來的,是【repo 裡已經有人踩過並寫下來】的。**
  -- 🔵 而那支 RPC 在 INSERT 之前**已經取了同一把鎖**(步 3)⇒ 走 RPC 的正常路徑上,
  --    本行是一個 **no-op**(同交易已持有)⇒ **零額外成本、零額外鎖序風險**。
  --    ⇒ **本行真正守的是【不經那支 RPC 的直接 INSERT】** —— 而那正是閘該存在的理由。
  SELECT o.id INTO v_lock
    FROM public.orders o
   WHERE o.id = NEW.order_id
     FOR NO KEY UPDATE;

  IF NOT FOUND THEN
    -- 父列不在 ⇒ FK 本來就會擋,而在這裡先講清楚比讓 FK 吐一句看不懂的話好。
    RAISE EXCEPTION
      '找不到這筆退款要掛的訂單,退款沒有發起、錢沒有動。請重新整理後確認。'
      USING ERRCODE = 'PCM05';
  END IF;

  -- 🔴🔴 **第二把鎖:把「更正判定」那條路也拉進同一個序列**(codex R1/R2 must-fix,實測關掉的)
  -- ```
  -- 病:admin_correct_order_refund_verdict(20260814190000:261-269)【只鎖子列、不鎖 orders】
  --    ⇒ 它與新退款鎖的是【不同的東西】⇒ 不會互相等
  --    ⇒ 一筆「更正成 money_moved」(那會讓 cap 變小)與一筆新退款可以同時 commit
  --    ⇒ 新退款按【舊的 cap】放行 ⇒ 事後總額超過 cap。
  -- 藥:它鎖子列用的是 FOR NO KEY UPDATE,而 **FOR SHARE 與它互斥**
  --    ⇒ 本閘在算 cap 之前,對【會影響 cap 的那幾列】取 FOR SHARE ⇒ 兩條路序列化。
  -- 鎖序:orders(NO KEY UPDATE)→ order_refunds(SHARE) —— **與 repo 既有約定同向**
  --    (20260803150000:244 逐字「鎖順序約定:orders(FOR SHARE)→ order_refunds」)
  --    ⇒ 而更正那支【只拿 order_refunds】、不要 orders ⇒ 沒有環 ⇒ 不會死結,只會排隊。
  -- ```
  -- 📌 **判別句:兩個交易鎖【不同的東西】就不會互相等 —— 而它們改的是同一個帳。**
  -- ⚠️ **只鎖 `failed` + `manual_failed` 那幾列**:它們是更正表唯一會動到的對象
  --    (`20260814190000:2` 逐字「更正的對象是 order_refunds 的 manual_failed」)
  --    ⇒ 不必鎖全部帳本列,那會把無關的退款也拖進來排隊。
  PERFORM 1
     FROM public.order_refunds r
    WHERE r.order_id = NEW.order_id
      AND r.status = 'failed'
      AND r.failed_reason = 'manual_failed'
      FOR SHARE;

  v_cap := public.pcm_order_refundable_remaining(NEW.order_id);

  IF v_cap IS NULL THEN
    -- 🔴 **與「金額太大」分開一個碼**(同 `#866` PCM02 的理由):
    --    那是金額問題,這是**系統算不出上限** —— 員工的下一步完全不同。
    --    ⚠️ 措辭照實:不寫「讀不到帳本」(真的讀不到通常直接拋權限錯),寫「算不出來」。
    RAISE EXCEPTION
      '這張單算不出可退上限 ⇒ 為了安全先擋下,退款沒有發起、錢沒有動。'
      '這與「金額太大」不同:那是金額問題,這是系統算不出上限,請找工程確認。'
      USING ERRCODE = 'PCM05';
  END IF;

  IF NEW.refund_amount > v_cap THEN
    -- 🔴 負 cap 也走這句人話(同 `#866` F-nit):髒資料下 cap 可能是負的,
    --    而「上限 -500」對員工不可讀。**fail-closed 的行為對,訊息也要對。**
    RAISE EXCEPTION
      '這張單目前只剩 % 元可退,退不了 % 元,退款沒有發起、錢沒有動。'
      '(這個數字已經扣掉處理中與已完成的退款、已判定錢有動的失敗退款、以及現金/匯款退款。)',
      GREATEST(v_cap, 0), NEW.refund_amount
      USING ERRCODE = 'PCM04',
            -- 🔴 **本支唯一的改動就是下面這兩行。**上面那句人話一個字都沒動。
            --    ⇒ 為什麼要它:那個數字今天【只存在於人話字串裡】, 而 app 層
            --      明文紀律是「分類依 SQLSTATE、**不解析 RPC message 的內容**」
            --      (`manual-refund-repository.ts` 檔頭)⇒ 從字串挖數字會做出一個
            --      **跟著文案漂**的解析器:改一個字, 員工看到的金額就變成 undefined,
            --      而三綠不會紅、型別也不會紅。
            --    ⇒ ⇒ 所以要把它當【結構化欄位】送出去, 而 `DETAIL` 就是那個欄位。
            --    ✅ 機制不是猜的(線 `-e4` 2026-08-31 實測:拋棄式 PG 17.10 + PostgREST 14.16
            --       + 真的 `@supabase/supabase-js` 2.105.3)⇒ `DETAIL` / `HINT` 兩欄【原樣抵達】
            --       `error.details` / `error.hint`。
            --    ⚠️ `DETAIL` 是給機器讀的 JSON, **不是給員工看的字** ——
            --       員工那句話由 app 層組(措辭鐵律 `refund-ledger-view.ts:4-8` 管的是那一句)。
            DETAIL = json_build_object(
                       'cap',   GREATEST(v_cap, 0),
                       'asked', NEW.refund_amount
                     )::text,
            HINT = 'lower-the-amount';
  END IF;

  RETURN NEW;
END
$fn$;

