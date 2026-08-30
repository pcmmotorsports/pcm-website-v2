-- M-4b `#445b`:退款金額上限 —— **每一筆卡片退款送出前,先問「這張單還能退多少」。**
--
-- 🔴 Sean 2026-08-30 逐字拍「排」⇒ 後續 plan 端出去他回「3.批」。
--    plan 全文 `~/pcm-mailbox/plan-445b-退款金額上限-20260830.md`。
--
-- ══ 這一片為什麼存在 ══════════════════════════════════════════════════
-- 今天**沒有任何一道閘在問「這張單還能退多少」** —— 而算得出那個數字的函式
-- **早就存在、早就 apply 了**(`pcm_order_refundable_remaining`,`20260820100000:224`),
-- 只是**沒有人消費它**。
-- 📌 **這不是「算不出來」,是【算出來了而沒有人問它】。**
-- 🔴 `refund-repository.ts:18-22` 逐字:「`REFUND_EXCEEDS_REMAINING` 由 **445b** 建立,
--    **今天庫裡那支 RPC 還不會吐它**」⇒ app 端早就接好了那個碼,缺的一直是這一支。
--
-- ══ 🔴🔴 為什麼要鎖父列(這一格是本片與 `#866` 的唯一差別,而它是實測出來的)══
-- `#866`(`20260824011000`)是同一個形狀的先例,而 **2026-08-30 實測:它擋不住併發。**
-- ```
-- 拋棄式 PG 17.10、真表 + 真 trigger、訂單收現金 1000、兩個 session 各送一筆 600:
--   #866 原樣(不加鎖)      ⇒ 兩筆都進去,總額 1200   🔴
--   同一道閘 + 先鎖父列      ⇒ 只進去一筆,總額  600   ✅
-- 而【單發對照】:單筆 1200 直接送 ⇒ 被擋(PCM01)⇒ **那道閘是活的,就是擋不住併發。**
-- ```
-- **機制**:`read committed` 之下,session2 的 trigger **看不到** session1 還沒 commit 的那一列
-- ⇒ 兩邊都算出 cap = 1000 ⇒ 兩邊都判「600 ≤ 1000,放行」。
-- 📌 **這道閘問的是「我看得到的帳」,而它要答的是「所有人的帳」。**
-- 🔴 **⇒ 所以本片抄 `#866` 的【骨架】,不抄它的【併發姿勢】。**
--    📌 **一個「已經過了 9 條 must-fix」的先例,仍然可能在一個沒有人問過的維度上是錯的。**
-- 🔵 而 repo 裡**已經有一個做對的**:`admin_adjust_wallet`(`20260716210000:25` 逐字)
--    「並發:`SELECT ... FOR UPDATE` 鎖 `customers` 列 → 同客並發調整序列化」
--    ⇒ **本片不是發明新做法,是把隔壁那個做法搬過來。**
--
-- ══ ⚠️ 已知未驗(明寫,不要讀成已驗)══════════════════════════════════
-- 1. ✅ **死結已驗(2026-08-30 拋棄式 PG 17.10,連跑兩發相同)—— 而答案是「會,而且沒關係」**:
--    構造兩個交易**交叉鎖兩張單**(T1 先 A 後 B、T2 先 B 後 A)⇒ **死結真的發生**
--    (`deadlock detected` 出現 1 次)⇒ **Postgres 偵測到並殺掉其中一個**(SQLSTATE `40P01`),
--    受害者**整筆回捲**、兩張單各留 1 列 ⇒ **錢是安全的。**
--    📌 **⇒ 「會不會死結」與「死結會不會出事」是兩個問題,而第二個的答案是不會** ——
--      PG 的死結偵測本來就是為這件事存在的,受害者拿到一個具名錯誤,不是靜默壞掉。
--    ⚠️ **而代價要寫出來**:高併發下會有退款**偶發失敗並要求重試**。
--      `#866` 當初為此加了 `deadlock_timeout='20ms'` 把受害者推向自己,而 codex R7 說那不是安全解法
--      ⇒ **本片不加那一行** —— 讓 PG 用它的預設(1s)自己判,受害者是誰由它決定。
--    🛑 **仍未驗的一格**:本片的 `FOR UPDATE` 與 `admin_initiate_order_refund` 的
--      **advisory lock** 的互動 —— 那需要走完整條 RPC,而 harness 只到 trigger 這一層。
-- 1b. ⛔ ~~🔴 **死結未驗。** 我證了「鎖父列擋得住超額」,**沒證「它不會製造死結」**。~~
--    `#866` 踩過三步:`FOR KEY SHARE` ⇒ 鎖序反轉死結 ⇒ 拿掉之後**死結還在**
--    (INSERT 的 FK 檢查本來就會對父列取 KEY SHARE)⇒ 最後用 `deadlock_timeout='20ms'`,
--    **而 codex R7 明說那不是安全解法**。
--    ⇒ **本片的鎖是 `FOR UPDATE`,比 KEY SHARE 強** ⇒ 它與 `order_refunds` 上既有那 3 支
--      trigger、以及 `admin_initiate_order_refund` 的 advisory lock 的**鎖序互動未驗**。
--    ⇒ 🔴 **harness 結論**:`~/pcm-mailbox/交件-445b實作-20260830.md`(11 個世界 + 2 發突變,連跑兩發相同)。
-- 2. **正式庫上「它會不會真的擋」未量** —— 後置斷言只驗「裝上了」與權限,**不驗行為**
--    (理由同 `#866`:行為要捏資料,而捏的資料過不了本表的 FK ⇒ 在正式庫必炸;
--     而 Sean 2026-08-30 對「行為探針」那個做法已拍【甲=拆掉】)。
--
-- ══ 🛑 本片【擋不住】的一條路(codex R1 must-fix 找到,而我修不掉,列給 Sean)═══
-- `admin_correct_order_refund_verdict`(`20260814190000:261-269`)**只鎖子列(order_refunds),
-- 不鎖 `orders`** ⇒ 它與一筆新退款**可以同時 commit**:
-- ```
-- T1 更正一筆 failed 列為 money_moved(那會讓 cap 變小)—— 只鎖那個子列
-- T2 送一筆新退款 —— 鎖 orders、算 cap ⇒ **算到的是 T1 還沒 commit 的舊 cap** ⇒ 放行
-- ⇒ 兩邊都 commit ⇒ 事後總額超過 cap。
-- ```
-- ✅ **2026-08-30 已關掉,而【不必動那支 RPC】** —— 見下方函式本體的「第二把鎖」那一段:
--    它鎖子列用 `FOR NO KEY UPDATE`,而 **`FOR SHARE` 與它互斥**
--    ⇒ 本閘在算 cap 之前對那幾列取 `FOR SHARE` ⇒ 兩條路序列化。
-- ⛔ ~~本片修不掉它 —— 要改一支已 apply 的 RPC ⇒ 另一支 migration。~~(舊字面留著:
--    那是我第一版的結論,而它錯在**只想到「讓對方也鎖 orders」這一種解法**。)
-- 📌 **判別句仍然成立,只是換了方向:兩個交易鎖【不同的東西】就不會互相等**
--    ⇒ 所以修法是**去鎖它已經在鎖的那個東西**,不是要它來鎖我的。

-- ══ 🛑🛑 **apply 之前:板子上有一條白紙黑字的停點,而它的兩個前提今天都變了** ══
-- `docs/phase-1-backlog.md:13890` 逐字:「**`#473` 沒有出口之前不得 apply 445b**」
-- `:13831` 逐字:「`#445b` 的硬前置**維持**」。
-- 🔴 **這條停點不在我原本的「部署順序」那一段裡** —— 而那一段自稱「apply 的人一定會讀到這裡」
--    ⇒ 照原字面 apply 會跨過一條白紙黑字的停點,而**零訊號**。(R3/fable 抓到,他是對的。)
--
-- 🔵 **而那條停點的兩個前提,2026-08-30 我逐格開檔量到【都已經變了】**:
-- ```
-- 前提① 停點的算式基礎是「manual_failed 佔額度」(#445 plan §4-2)
--   ⇒ 今天的 cap(本檔上方 20260820100000:231-248)那一段是
--     「JOIN 更正 view … AND v.corrected_to = 'money_moved'」
--   ⇒ **未更正的 manual_failed 【不佔額度】** ⇒ 「永久卡單」的機制今天不成立。
-- 前提② 「#473 沒有出口」
--   ⇒ 今天出口在:apps/admin/src/components/orders/refund-verdict-correction.tsx
--     而 refund-exceptions/page.tsx 真的渲染它(grep 命中 2;正對照 2、負對照 0)
--   ⇒ **員工今天按得到那個更正入口。**
-- ```
-- 🛑 **而【前提變了】不等於【停點解除】** —— 解不解那條停點是 Sean 的板,不是這支檔的。
--    ⇒ **apply 這支之前,請先確認那條停點的裁決落點。**(我查過 `before-asking-sean.sh`
--      與決策板、plan、launch-todo:**查無已裁的落點**。)
-- 📌 **一支 migration 的檔頭可以帶著量測去挑戰一條停點,但不可以自己把它劃掉。**

-- ══ 🛑 這道閘擋不住的,逐條列(不藏)═══════════════════════════════════
-- 1. **跨軌**(R3/fable F3):cap 第三段的寫者是 `order_manual_refunds`,而**本閘不鎖它**。
--    走 RPC 的路封著(`admin_record_manual_refund` 有 `orders FOR UPDATE`);
--    殘口 = **owner 直插 manual 列 + 併發卡退** ⇒ 本閘的 cap 看不到未 commit 的 manual 列。
--    ⇒ `⟦b4-CAPRACE1⟧` 已排定給 `#866` 補父列鎖 —— **補上即同時關掉這一條**。
--    ⚠️ 而那一列的修法字面寫 `FOR UPDATE` ⇒ **落地時要改成 `FOR NO KEY UPDATE`**
--      (理由同本檔:`20260812170000:88-89` 已實錘 `FOR UPDATE` 與 FK KEY SHARE 40P01)。
-- 2. **app 端的錯誤映射**(R3/fable F4):`refund-repository.ts:18-34` 接的是 **RPC 回傳碼**
--    `REFUND_EXCEEDS_REMAINING`,而本片吐的是 **trigger 的 PCM04**
--    ⇒ 全樹 `PCM04|PCM05|PCM06` 映射 = **0 命中**
--    ⇒ 🔴 **apply 之後,員工在正常路徑上撞到超額會拿到一個未映射的原始例外** ——
--      正是 445a 註解自己警告要避免的「系統呼叫異常」形狀。
--    ⇒ **畫面層那一片要與本片同批(或先)上,而它今天沒有落點** ⇒ **要 Sean 排。**

-- ══ 部署順序 ═════════════════════════════════════════════════════════
-- 🔴 `refund-repository.ts:22` 逐字:「**445a 必須先 deploy,才准 apply 445b**」——
--    而 **445a 早就在線上**(`INITIATE_RESULT_CODES` 已含 `REFUND_EXCEEDS_REMAINING`,該檔 `:34`)
--    ⇒ **這一格今天已經滿足**。寫在這裡是因為 apply 的人一定會讀到這裡。
-- ⚠️ 而本片吐的是**自訂 SQLSTATE**,不是那個 RPC 回傳碼 —— **兩者不同層**:
--    RPC 那個是 `admin_initiate_order_refund` 的回傳值;本片是 trigger 直接 RAISE。
--    ⇒ **app 端看到的會是例外,不是 `REFUND_EXCEEDS_REMAINING`** ⇒ 畫面層要另外接(不在本片)。

-- 🔴 **顯式交易**(codex R1 must-fix):本檔的後置斷言宣稱「不過 ⇒ 整筆 ROLLBACK」,
--    而**沒有 BEGIN 的話,在非交易式 runner 下會留下已建好的函式/trigger 半套狀態**。
--    ⇒ 把那句宣稱變成真的。(repo 內 127 支 migration 已這樣做,數法
--      `grep -rlc '^BEGIN;' supabase/migrations/*.sql | wc -l`。)
BEGIN;

-- ══ 0. 前置閘(fail-closed,不是冪等)═══════════════════════════════════
DO $pre$
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION '#445b 前置閘:apply 時的隔離級別是 % 而不是 read committed'
      ' ⇒ 本片的併發推導建立在 read committed 上,停下人工確認',
      pg_catalog.current_setting('transaction_isolation');
  END IF;

  IF to_regprocedure('public.pcm_order_refundable_remaining(uuid)') IS NULL THEN
    RAISE EXCEPTION '#445b 前置閘:pcm_order_refundable_remaining(uuid) 不存在 ⇒ 先 apply 20260820100000';
  END IF;

  IF to_regclass('public.order_refunds') IS NULL THEN
    RAISE EXCEPTION '#445b 前置閘:public.order_refunds 不存在';
  END IF;

  -- 🔴 `refund_amount` 的 NOT NULL 是本片比較式的【承重件】,而它寫在別人的檔裡:
  --    `NULL > v_cap` 回 NULL ⇒ IF 不成立 ⇒ **靜靜放行**。
  --    ⇒ 讓那個依賴變成會執行的東西,不是註解(同 `#866` F4)。
  IF NOT EXISTS (SELECT 1 FROM pg_attribute
                  WHERE attrelid = 'public.order_refunds'::regclass
                    AND attname = 'refund_amount' AND attnotnull
                    AND NOT attisdropped AND attnum > 0) THEN
    RAISE EXCEPTION '#445b 前置閘:order_refunds.refund_amount 不是 NOT NULL'
      ' ⇒ NULL 金額會讓比較式回 NULL ⇒ 本閘【靜靜放行】';
  END IF;

  -- 🔴🔴 **本片只做 BEFORE INSERT,而那是【依賴】不是【偷懶】**:
  --    DELETE 與「改金額」已經被兩道鄰居擋死(`20260801120000`)。
  --    ⇒ 那兩道哪天被拿掉,本片就漏 ⇒ 所以在這裡驗它們在。
  -- 🔴 **只驗名字在【不夠】**(codex R1 must-fix):一支被 `DISABLE` 的 trigger、
  --    或一支同名而其實是 no-op 的 trigger,都會讓「名字在」這道檢查通過
  --    ⇒ DELETE / UPDATE 旁路照樣成立。⇒ 連 `tgenabled` 與**觸發時機**一起驗。
  --    ⚠️ **而我【不驗 tgfoid 指向哪支函式】** —— 那需要把函式名字寫死在這裡,
  --       而那支函式屬於別人的 migration,它改名時本檔會變成假紅。**這一格是刻意的取捨。**
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'order_refunds_a7c_block_delete_bd'
                    AND tgrelid = 'public.order_refunds'::regclass
                    AND NOT tgisinternal
                    AND tgenabled = 'O'           -- 🔴 只認 'O'(一般啟用):
                                                  --    'D'=停用、'R'=只在 replica 觸發、'A'=always
                                                  --    ⇒ `<> 'D'` 會放行 'R',而 'R' 在主庫上【不觸發】
                    AND (tgtype & 1) <> 0         -- 1 = ROW(statement 級的擋不住逐列)
                    AND (tgtype & 8) <> 0         -- 8 = DELETE
                    AND (tgtype & 2) <> 0) THEN   -- 2 = BEFORE
    RAISE EXCEPTION '#445b 前置閘:order_refunds_a7c_block_delete_bd 不在、或被停用、或不是 BEFORE DELETE'
      ' ⇒ DELETE 沒有被擋 ⇒ 刪一列會讓額度憑空回來,而本片只做 INSERT 這一面';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'order_refunds_a7c_immutable_guard_bu'
                    AND tgrelid = 'public.order_refunds'::regclass
                    AND NOT tgisinternal
                    AND tgenabled = 'O'
                    AND (tgtype & 1) <> 0         -- ROW
                    AND (tgtype & 16) <> 0        -- 16 = UPDATE
                    AND (tgtype & 2) <> 0) THEN
    RAISE EXCEPTION '#445b 前置閘:order_refunds_a7c_immutable_guard_bu 不在、或被停用、或不是 BEFORE UPDATE'
      ' ⇒ refund_amount 可能被 UPDATE 改大,而本片只做 INSERT 這一面';
  END IF;

  IF to_regprocedure('public.pcm_order_refund_cap_guard()') IS NOT NULL THEN
    RAISE EXCEPTION '#445b 前置閘:public.pcm_order_refund_cap_guard() 已存在。'
      '⇒ 本檔【不覆寫】(CREATE OR REPLACE 會保留別人的 owner 與 ACL)。'
      '要重套先 DROP TRIGGER 再 DROP FUNCTION,並確認那支是我們建的。';
  END IF;
END
$pre$;

-- ══ 1. 檢查函式 ═══════════════════════════════════════════════════════
CREATE FUNCTION public.pcm_order_refund_cap_guard()
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
      USING ERRCODE = 'PCM04';
  END IF;

  RETURN NEW;
END
$fn$;

COMMENT ON FUNCTION public.pcm_order_refund_cap_guard() IS
  '#445b:order_refunds 的 BEFORE INSERT ROW 金額上限閘。先對父列 orders 取 '
  '**FOR NO KEY UPDATE**(不是 FOR UPDATE —— 後者與 FK RI 的 KEY SHARE 死結,'
  '20260812170000:88-89 實錘)再算 pcm_order_refundable_remaining ⇒ 併發序列化。'
  'SQLSTATE:PCM04=超額 / PCM05=算不出上限或查無訂單 / PCM06=隔離級別非 read committed。'
  '🔴 trigger 名字承重:必須排在 order_refunds_a7c_insert_guard_bi 之前,否則本片的鎖變成升級 ⇒ 死結。'
  '(後置斷言①b 會驗這個順序。)'
  '🔴 只做 INSERT —— DELETE 與改金額由 20260801120000 的兩道鄰居擋,前置閘驗它們是啟用的 ROW 級。'
  '✅ 死結已驗(2026-08-30 拋棄式 PG,連跑兩發):交叉鎖兩張單會死結,而 PG 偵測並殺一個(40P01),錢安全。'
  '⚠️ PCM06 連 SERIALIZABLE 也擋 —— 那個級別下本設計其實安全(SSI 會自己殺),'
  '刻意保守:本片的推導只在 read committed 上驗過,別的級別未驗 ⇒ 寧可停下來問人。'
  '✅ 更正判定那條路也序列化了:本閘算 cap 前對 failed+manual_failed 那幾列取 FOR SHARE,'
  '與 admin_correct_order_refund_verdict 的 FOR NO KEY UPDATE 互斥。';

REVOKE ALL ON FUNCTION public.pcm_order_refund_cap_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_order_refund_cap_guard() FROM anon;
REVOKE ALL ON FUNCTION public.pcm_order_refund_cap_guard() FROM authenticated;

-- ══ 2. 掛上去 ═════════════════════════════════════════════════════════
-- 🔴 **只有 BEFORE INSERT**(理由見前置閘那兩道鄰居的檢查)。
--
-- 🔴🔴 **trigger 的【名字】是承重的,不是命名品味**(2026-08-30 codex R1 逼出來、我實測確認):
-- ```
-- PostgreSQL 的 BEFORE trigger 依【名字排序】觸發。
-- 而 order_refunds 上已經有一道 `order_refunds_a7c_insert_guard_bi`,
-- 它對 orders 取 **FOR SHARE**(`20260803150000:241-249`,含「鎖順序約定:orders(FOR SHARE)→ order_refunds」)。
--
-- 我第一版叫 `trg_pcm_order_refund_cap` ⇒ 排在 a7c 【後面】
--   ⇒ 每一發 INSERT 的順序變成:先 FOR SHARE、再 FOR UPDATE = **一次鎖升級**
--   ⇒ 兩個 session 幾乎同時到 ⇒ 兩邊都持 SHARE、都要升級 ⇒ **教科書鎖升級死結**
--   ⇒ 🔴 **實測**:該形狀下 `deadlock detected` 出現 1 次(harness 世界 I)
--
-- ✅ 改名成 `order_refunds_a445b_cap_guard_bi` ⇒ `a4` < `a7` ⇒ **排在它前面**
--   ⇒ 我先取 FOR UPDATE、它後面那道 FOR SHARE 已被涵蓋 ⇒ **沒有升級,就沒有那個死結**
-- ```
-- 📌 **⇒ 一個看起來只是命名的決定,決定了正式庫上會不會每一次併發退款都死結。**
-- ⚠️ **而它是脆的**:哪天有人在 `order_refunds` 上加一道名字排在 `a445b` 之前、又鎖 orders 的 trigger,
--    這個順序就沒了。**後置斷言因此驗「我是第一個 BEFORE INSERT trigger」,不只驗「我在」。**
DROP TRIGGER IF EXISTS order_refunds_a445b_cap_guard_bi ON public.order_refunds;
CREATE TRIGGER order_refunds_a445b_cap_guard_bi
  BEFORE INSERT ON public.order_refunds
  FOR EACH ROW
  EXECUTE FUNCTION public.pcm_order_refund_cap_guard();

-- ══ 3. 後置斷言(同一交易;不過 ⇒ 整筆 ROLLBACK)═══════════════════════
-- ⚠️ **只驗「裝上去了」與「權限」——【不驗行為】。**
--    行為要捏資料,而捏的資料過不了本表的 FK ⇒ 在正式庫必炸;
--    而 Sean 2026-08-30 對「行為探針」那條路已拍【甲=拆掉】。
--    ⇒ 🔴 **行為在拋棄式 PG 驗**(harness 見 §5)。**「裝上了」與「它會擋」是兩個宣稱。**
DO $post$
DECLARE
  -- 🔴 新物件收權斷言的【清單】(`scripts/migration-static-checks.sh` ③ 要它可被數)。
  --    簽章逐字從本檔的 `CREATE FUNCTION` 抄(`to_regprocedure` 對參數型別逐字比對)。
  --    ⚠️ **trigger 本身不列** —— trigger 沒有 ACL,列進來 `to_regclass` 會找不到而紅。
  v_functions text[] := ARRAY[
    'public.pcm_order_refund_cap_guard()'
  ]::text[];
  v_n     int;
  v_first text;
  v_fn    oid;
  r    text;
BEGIN
  SELECT count(*) INTO v_n FROM pg_trigger
   WHERE tgname = 'order_refunds_a445b_cap_guard_bi'
     AND tgrelid = 'public.order_refunds'::regclass
     AND NOT tgisinternal;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '#445b 後置斷言①:order_refunds_a445b_cap_guard_bi 應恰 1 個,實得 %', v_n;
  END IF;

  -- 🔴🔴 **斷言「我是第一個 BEFORE INSERT trigger」** —— 這不是潔癖,是那道鎖的正確性條件:
  --    PG 依名字排序觸發;若有人插一支排在我前面、又對 orders 取較弱的鎖(例如 FOR SHARE),
  --    我這一行就變成**鎖升級** ⇒ 同一張單的併發退款會互相死結(2026-08-30 實測過那個形狀)。
  --    ⇒ 把那個順序變成**會執行的斷言**,不是一句註解。
  SELECT tgname INTO v_first
    FROM pg_trigger
   WHERE tgrelid = 'public.order_refunds'::regclass
     AND NOT tgisinternal
     AND tgenabled = 'O'
     AND (tgtype & 1) <> 0      -- 🔴 ROW —— 漏了它的話,一支【BEFORE STATEMENT】trigger
                                --    其實跑得【更早】,而本斷言會把本片誤判成「第一個」
     AND (tgtype & 2) <> 0      -- BEFORE
     AND (tgtype & 4) <> 0      -- INSERT
   ORDER BY tgname
   LIMIT 1;
  IF v_first IS DISTINCT FROM 'order_refunds_a445b_cap_guard_bi' THEN
    RAISE EXCEPTION '#445b 後置斷言①b:第一個 BEFORE INSERT trigger 是 %,不是本片。'
      ' ⇒ 若它也鎖 orders 而且鎖得比較弱,本片這一行會變成鎖升級 ⇒ 併發退款互相死結。'
      ' 停下人工確認。', v_first;
  END IF;

  -- ══ 收權斷言(逐個跑清單)═════════════════════════════════════════════
  -- 🔴🔴 **這裡【刻意沒有】「service_role 必須有 EXECUTE」那一格,不要照抄別支加回來。**
  --    ⛔ ~~它由 trigger 呼叫,而 trigger 執行時走的是**表擁有者**的身分~~
  --    🔴 **上面那句理由是錯的**(codex R1 nit):本函式是 `SECURITY DEFINER`
  --       ⇒ 它走的是**函式擁有者**的身分,不是表擁有者。
  --    ✅ **而結論不變**:trigger 觸發時**不檢查呼叫者對該函式的 EXECUTE**
  --       ⇒ `service_role` 不需要它 ⇒ 本檔刻意只有三道 REVOKE、零 GRANT。
  --    ⚠️ **一格未驗**:`CREATE TRIGGER` 那一刻,**建立者**是否需要對該函式有 EXECUTE ——
  --       本檔由 owner(postgres)套用 ⇒ 今天不會撞到;換一個角色 apply 時要重看。
  --    ⇒ 照抄那一格會斷言一個**我們刻意不給**的權限 ⇒ apply 直接紅。
  --    📌 **一份「合格範本」保證的是格式,不是語意 —— 抄之前要問這個物件是不是同一種東西。**
  --    (這一段的來源是 `#866` 片2 的同一格,它已經替我們踩過。)
  FOREACH r IN ARRAY v_functions LOOP
    v_fn := pg_catalog.to_regprocedure(r);
    IF v_fn IS NULL THEN
      RAISE EXCEPTION '#445b 後置斷言②:找不到函式 %(簽名打錯或沒建成)⇒ 拒繼續', r;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '#445b 後置斷言③:% 對 anon/authenticated 開著 EXECUTE(三道 REVOKE 少了一道?)', r;
    END IF;
    IF pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '#445b 後置斷言④:% 對 service_role 有 EXECUTE ——'
        ' 本檔【刻意不給】(trigger 觸發時不檢查呼叫者對該函式的 EXECUTE;'
        ' 本函式是 SECURITY DEFINER ⇒ 走【函式擁有者】,不是表擁有者)。'
        ' 它若有了,代表有人為了「讓它跑得動」加了一道不需要的 GRANT ⇒ 那要被看見。', r;
    END IF;
  END LOOP;

  RAISE NOTICE '#445b 後置斷言通過:①trigger 恰 1 個 ②函式在 ③anon/authenticated 無 EXECUTE ④service_role 也沒有(刻意)。'
    '🔴 而【行為未在本庫驗】—— 那一格在拋棄式 PG 的 harness 裡,見檔頭。';
END
$post$;

-- ══ 4. 回退法(⚠️ 未驗:本 repo 慣例 down-migration 不會被跑過)═══════════
--   DROP TRIGGER IF EXISTS order_refunds_a445b_cap_guard_bi ON public.order_refunds;
--   DROP FUNCTION IF EXISTS public.pcm_order_refund_cap_guard();
-- 🔴 回退之後,**已經被擋下的那些退款不會自己補回來** —— 它們是「沒發生」,不是
--    「發生了要復原」⇒ 這個回退是乾淨的。

COMMIT;
