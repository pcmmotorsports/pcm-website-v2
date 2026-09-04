-- ============================================================
-- 20260904050000 · 客人改用刷卡時, 自動取消那張【未付款的匯款單】
--   線【信】-mail · 片 B of ⟦b4-BANKORDERINVISIBLE⟧
--
-- 🔵 **拍板**:Sean 2026-09-04 追加拍板 Q-改付款 **乙** —— 原話逐字
--    「乙 讓他刷卡, 而自動把那張匯款單取消」(~/pcm-mailbox/Sean拍板-20260904-七題.md 檔尾)
--    ⚠️ 他複製的那行尾巴帶著「← 我推這個」, **那是主視窗寫的字, 不是他的理由。**
--
-- 🔴🔴 **本片【不動 cart dedup 那道述詞】, 而那是刻意的**:
--    那道 SELECT 自己就有 `AND o.cancelled_at IS NULL` ⇒ **先取消, 它就自然看不到那張單**
--    ⇒ 🎯 **⇒ 「刷卡行為零改變」變成 diff 上看得到的 0, 不必用突變去證。**
--    📌 **能把「我沒動它」變成 diff 上的空白時, 不要改成「我動了它但我證明沒影響」**
--       —— 證明會過期(尺變了、世界變了), 而 diff 上的 0 不會。(主視窗 2026-09-04)
--
-- 🔴 **不借 admin_cancel_order** —— 它要 `p_actor text`(一個人)
--    ⇒ 借它 = 在稽核表上寫一個【不是人的 actor】⇒ 歸屬變假, 而歸屬錯零機械訊號。
--    ✅ 照【逾期自動取消】那支的形狀寫(20260903080000:185 逐字
--       `SET cancelled_at = pg_catalog.now(), cancelled_reason = 'payment_expired'`)。
--
-- 🔴 **不變量:cancelled ⇒ 無 active attempt**(20260903080000:249 逐字:
--    「三處『擋重新結帳』的查詢都靠 active attempt 判定, 放寬本條件的人必須同時回頭改那三處,
--      否則『已取消但 charge 在途』會不再被擋 = 雙扣」)
--    ✅ 本片**不放寬它** —— 下方 `NOT EXISTS` 把它寫死。
--    🛑 **而下一個人最可能做的錯事是「順手也取消有 attempt 的那些」** —— 那一步就是雙扣。
--
-- 🛑 **已知且【尚未被 Sean 問過】的行為:放棄路徑**
--    客人按下付款 ⇒ 那張匯款單當場沒了 ⇒ 而他**中途放棄**(沒刷完)⇒ 回來想匯款時那張單不在。
--    ⇒ 🔴 **放棄比失敗常見。** 而 Sean 拍的是「他改用刷卡」, **【放棄刷卡】那一格沒有人問過他。**
--    ⇒ 📌 **這不是「已接受的殘餘風險」** —— 那要他說了才算, 而他沒說過。板列 ⟦b4-BANKGIVEUPPATH⟧。
--    ⚠️ 而**兩案共有**:原 plan 的「改述詞 + 第三個出口」也在同一刻取消 ⇒ 這是這件事本身的代價。
--
-- 🔵 **客人看到什麼**:`orderCancelKindOf`(packages/domain/src/order/order-cancel-reason.ts:80)
--    只有 `cancelled_reason === PAYMENT_EXPIRED_CANCEL_REASON` 才回 'expired', 其餘一律 'cancelled'
--    ⇒ 客人看到「訂單已取消」⇒ **不必新文案**;而 `cancelled_reason` 本身客人**看不到**
--    (OrderDetailView.tsx:524-533 逐字:「客人端只渲染枚舉映射出來的固定字串, 永遠不渲染自由文字」)。
--    ⇒ ✅ **所以這個 reason 是寫給【值班的人】看的** —— 它不可以與 'payment_expired' 共用,
--       否則客服看到「已取消」會以為是逾期, 而給客人錯的答案。
--
-- 🔬 **前置閘基準線**(唯讀正式庫, 2026-09-04, `pcm_readonly` · `transaction_read_only=on`):
--      begin_charge_attempt prosrc md5 = 9faa3403a0ced0533e5c2c4f8c1a3cc1 · length = 6128 · 1 參
--    🟢 正對照 find_active_sibling_own ⇒ 1   ⚪ 負對照 qzx7419_nope2 ⇒ 0
-- ============================================================

BEGIN;

-- ── 1. 前置閘 ──────────────────────────────────────────────
DO $pre$
DECLARE v_md5 text; v_len integer;
BEGIN
  SELECT md5(p.prosrc), pg_catalog.length(p.prosrc) INTO v_md5, v_len
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'begin_charge_attempt';
  IF NOT FOUND THEN
    RAISE EXCEPTION '前置閘:public.begin_charge_attempt 不存在 ⇒ 這個庫不是我對著做的那個 ⇒ 拒繼續';
  END IF;
  IF v_md5 <> '9faa3403a0ced0533e5c2c4f8c1a3cc1' OR v_len <> 6128 THEN
    RAISE EXCEPTION '前置閘:begin_charge_attempt 的 prosrc 與我抽取時不符(md5=% len=%)⇒ 它被改過 ⇒ 拒繼續', v_md5, v_len;
  END IF;
END
$pre$;

-- ── 2. 換那支函式 ──────────────────────────────────────────
-- 🔴 本片相對於 20260820020000 那一版的差異 **只有一段**:advisory lock 之後、cart dedup 之前
--    多一個 UPDATE(下方標 `⑥b 片 B`)。其餘**逐字複製**。
CREATE OR REPLACE FUNCTION public.begin_charge_attempt(p_order_id uuid)
RETURNS jsonb  -- {acquired bool, attempt_id?, fallback_token?, reason?: user_in_flight|order_locked|not_unpaid|not_card_order|duplicate|needs_settle, existing_*?}
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_order        record;
  v_attempt_id   uuid;
  v_token        uuid;
  v_dup_order_id uuid;
  v_dup_display  text;
  v_dup_paid     boolean;
  v_dup_rec      text;
  v_dup_bank     text;
  v_inflight_order_id uuid;
  v_generic_msg constant text := 'begin_charge_attempt: 付款處理失敗';
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'begin_charge_attempt: isolation guard' USING ERRCODE = 'P8C01';
  END IF;

  SELECT id, customer_user_id, payment_status, cart_session_id, cancelled_at, payment_channel
    INTO v_order
    FROM public.orders
   WHERE id = p_order_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  IF v_order.cancelled_at IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.order_cancellations c WHERE c.order_id = p_order_id) THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  IF v_order.cart_session_id IS NULL THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  IF v_order.payment_status <> 'unpaid'::public.payment_status THEN
    RETURN pg_catalog.jsonb_build_object('acquired', false, 'reason', 'not_unpaid');
  END IF;

  -- 🔴 片 B(codex 關卡2 must-fix ④):**目標單必須是刷卡單。**
  --   本函式的名字是「開一次刷卡嘗試」, 而它原本【沒有驗過那張單的付款方式】——
  --   在片 B 之前那不痛(它只開 attempt);而片 B 之後它會【取消別的單】
  --   ⇒ 🛑 對一張匯款單誤呼叫這支 RPC ⇒ 它會取消同車另一張匯款單, 然後替匯款單開刷卡 attempt。
  --   📌 **一個原本無害的缺漏, 會因為【後來加進來的副作用】變成有害。**
  IF v_order.payment_channel <> 'tappay' THEN
    RETURN pg_catalog.jsonb_build_object('acquired', false, 'reason', 'not_card_order');
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_order.customer_user_id::text, 0));


  SELECT o.id, o.display_id, (o.payment_status = 'paid'::public.payment_status), a.rec_trade_id, a.bank_transaction_id
    INTO v_dup_order_id, v_dup_display, v_dup_paid, v_dup_rec, v_dup_bank
    FROM public.orders o
    LEFT JOIN public.payment_charge_attempts a
      ON a.order_id = o.id AND a.status IN ('pending', 'charged')
   WHERE o.customer_user_id = v_order.customer_user_id
     AND o.id              <> p_order_id
     AND o.cart_session_id  = v_order.cart_session_id
     AND o.cancelled_at IS NULL
     AND (
          a.status = 'charged'
       OR o.payment_status = 'paid'::public.payment_status
       OR (a.status = 'pending' AND o.payment_status <> 'paid'::public.payment_status)
     )
   ORDER BY (o.payment_status = 'paid'::public.payment_status) DESC, (a.status = 'charged') DESC, o.created_at DESC
   LIMIT 1;
  IF FOUND THEN
    IF v_dup_paid THEN
      RETURN pg_catalog.jsonb_build_object(
        'acquired', false, 'reason', 'duplicate',
        'existing_display_id', v_dup_display, 'existing_paid', true
      );
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'acquired', false, 'reason', 'needs_settle',
      'existing_order_id', v_dup_order_id,
      'existing_display_id', v_dup_display,
      'existing_rec_trade_id', v_dup_rec,
      'existing_bank_transaction_id', v_dup_bank
    );
  END IF;
  -- 🔴 per-user 閘(Q2=A;round2 MF1 + round3 MF 統一 predicate;原封不動、僅移到 dedup 後 → 硬約束② 守):
  -- 「未解決付款」= 10 分鐘內、異單、active(pending|charged)、且該單尚未 paid(join orders:
  --   charged-未-paid 也擋〔雙扣視窗〕;pending-但-已-paid 放行〔不誤卡〕)。異 cart 走此擋(同 cart 已被 dedup 攔)。
  SELECT a.order_id
    INTO v_inflight_order_id
      FROM public.payment_charge_attempts a
      JOIN public.orders o ON o.id = a.order_id
     WHERE a.customer_user_id = v_order.customer_user_id
       AND a.order_id <> p_order_id
       AND a.status IN ('pending', 'charged')
       AND a.created_at > pg_catalog.now() - interval '10 minutes'
       AND o.payment_status <> 'paid'::public.payment_status
     ORDER BY (a.status = 'charged') DESC, a.created_at DESC, a.id DESC
     LIMIT 1;
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'acquired', false, 'reason', 'user_in_flight',
      'in_flight_order_id', v_inflight_order_id
    );
  END IF;

  -- 🔴 per-order 佔鎖(原子;撞 active attempt → DO NOTHING → order_locked)+ 備軌 token 發放(round4 MF2)
  v_token := pg_catalog.gen_random_uuid();
  INSERT INTO public.payment_charge_attempts (order_id, customer_user_id, fallback_token_hash)
  VALUES (p_order_id, v_order.customer_user_id, public.charge_attempt_token_hash(v_token))
  ON CONFLICT (order_id) WHERE status IN ('pending', 'charged') DO NOTHING
  RETURNING id INTO v_attempt_id;

  IF v_attempt_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('acquired', false, 'reason', 'order_locked');
  END IF;

  -- ══ ⑨b 【片 B · 20260904050000】客人改用刷卡 ⇒ 取消那張未付款的匯款單 ═════════
  --
  -- 🔴🔴 **位置是這一片被 codex 打回來一次才對的地方, 而錯的那一版讀起來完全合理。**
  --   ⛔ ~~原本放在 advisory lock 之後、cart dedup 之【前】~~ **那是 bug**:
  --      後面還有四個早退(duplicate · needs_settle · user_in_flight · order_locked)
  --      ⇒ 那四條路上**刷卡 attempt 根本沒取得, 而匯款單已經被取消**
  --      ⇒ 🔴 **客人兩張單都沒了** —— 而那正是本檔檔頭寫著「拆兩次 RPC 會發生」的那件事。
  --   📌 **⇒ 原子性保證的是「要嘛都發生要嘛都不發生」,**
  --      **而我讓「都發生」裡的那個【都】只涵蓋我看得到的那一段。**
  --   ✅ ⇒ 現在它在**最後一個早退之後、attempt 已經真的取得之後**(v_attempt_id 非 NULL)。
  --
  -- 🔴 **取消條件【照抄逾期那支】, 不自己想一個** ——
  --   20260903080000_m4b_expire_unpaid_by_payment_channel.sql:176-179 逐字 `a.status <> 'failed'`,
  --   而該檔 :169 說「條件與 admin_cancel_order 步7 逐字相同 ⇒ 兩個寫入端維持同一條不變量」。
  --   ⛔ ~~我原本寫 `status IN ('pending','charged')`~~ **那比 canonical 窄** ——
  --      漏掉 `released`(20260624120000 加的狀態)⇒ 「已取消而事後仍可能扣款」。
  --   🛑 **這三處刻意逐字相同, 而它們【不共用】** —— 改任一處之前先讀另外兩處。
  --      📌 抽成共用點的話, 它會變成一個【會一起被改壞】的東西, 那是另一個方向的同一個病。
  UPDATE public.orders o
     SET cancelled_at     = pg_catalog.now(),
         cancelled_reason = 'superseded_by_card',
         -- 🔴 逾期那支同一行也寫 updated_at(同檔 :186)⇒ 少了它, 同步與稽核時間停在舊值。
         updated_at       = pg_catalog.now()
   WHERE o.customer_user_id = v_order.customer_user_id
     AND o.cart_session_id  = v_order.cart_session_id
     AND o.id              <> p_order_id
     AND o.cancelled_at IS NULL
     AND o.payment_channel  = 'bank_transfer'
     AND o.payment_status   = 'unpaid'::public.payment_status
     AND NOT EXISTS (
           SELECT 1 FROM public.payment_charge_attempts a
            WHERE a.order_id = o.id
              AND a.status <> 'failed'
         );
  -- ══ ⑨b 結束 ═══════════════════════════════════════════════════════════════

  -- token 明文只在此回傳值(server 呼叫端記憶體);DB 只有 hash、絕不入 log
  RETURN pg_catalog.jsonb_build_object(
    'acquired', true,
    'attempt_id', v_attempt_id,
    'fallback_token', v_token
  );
END;
$fn$;


-- ── 3. COMMENT ─────────────────────────────────────────────
-- 🔴 CREATE OR REPLACE 會把舊 COMMENT 原樣留著 ⇒ 它不會提到本片新增的取消行為。
COMMENT ON FUNCTION public.begin_charge_attempt(uuid) IS
  'M-3 3DS 0b/0c + M-4b A8c1/L4a1/A8a3-G + **M-4b 段 1 片 B**:開一次刷卡嘗試(advisory xact lock 序列化)。'
  '本片新增(⑨b):在 **attempt 已經取得之後**(所有早退之後), 把同一台車上未付款、且無任何非終態 attempt 的匯款單'
  '就地取消(cancelled_reason=''superseded_by_card''), 而**不 return** —— 讓這次刷卡照常往下走。'
  '依據:Sean 2026-09-04 拍板「乙 讓他刷卡, 而自動把那張匯款單取消」。'
  '🔴 不變量:cancelled ⇒ 無 active attempt(NOT EXISTS 寫死)——放寬它 = 「已取消但 charge 在途」不再被擋 = 雙扣。'
  '🔴 cart dedup 那道述詞**逐字未動**。'
  '⛔ ~~第一版把取消放在 dedup 之前~~ 那是 bug:早退四條路上刷卡沒取得而匯款單已取消 ⇒ 客人兩張單都沒了。'
  '🔴 取消條件照抄 20260903080000 的 a.status <> ''failed''(三處刻意逐字相同而不共用)。';

-- ── 4. 事後斷言 ─────────────────────────────────────────────
DO $post$
DECLARE v_n integer; v_src text; v_code text;
BEGIN
  SELECT count(*), max(p.prosrc) INTO v_n, v_src
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'begin_charge_attempt';

  -- 🔴🔴 **`prosrc` 含註解, 而我的註解裡就有 `superseded_by_card` 與 `NOT EXISTS`**
  --   ⇒ ⛔ 直接對 prosrc 做 strpos ⇒ **把真正的 UPDATE 整段刪掉, 它照樣通過。**(codex 關卡2 must-fix ⑤)
  --   📌 **一道用字面比對來驗「碼在不在」的斷言, 它的分母天生包含註解 —— 而註解最會講那件事。**
  --   ✅ 所以先把 `--` 行註解剝掉, 之後的斷言一律對 `v_code` 做, 不對 `v_src`。
  --   ⚠️ **射程**:只剝行註解(本檔沒有塊註解);而它**仍然是字面比對** ——
  --      證的是「那段碼在」, **不是「它在做事」**。做事那一半由探針的資料世界格子釘。
  v_code := pg_catalog.regexp_replace(v_src, '--[^\n]*', '', 'g');

  IF v_n <> 1 THEN
    RAISE EXCEPTION '事後①:begin_charge_attempt 有 % 支, 預期 1 ⇒ 拒繼續', v_n;
  END IF;

  -- ② 本片那段在裡面
  --   🛑 而這一格證的是【字面在】不是【它在做事】—— 行為由探針的資料世界格子釘。
  IF pg_catalog.strpos(v_code, 'superseded_by_card') = 0 THEN
    RAISE EXCEPTION '事後②:找不到 superseded_by_card ⇒ 換上去的不是我寫的那一版 ⇒ 拒繼續';
  END IF;

  -- ③ 🔴 不變量還在:取消那段必須帶 NOT EXISTS active attempt
  IF pg_catalog.strpos(v_code, 'NOT EXISTS') = 0 THEN
    RAISE EXCEPTION '事後③:取消那段的 NOT EXISTS(不變量:cancelled ⇒ 無 active attempt)不見了 ⇒ 拒繼續';
  END IF;

  -- ④ 🔴 舊的三個出口一個都不能少(防「我把新的加上去而把舊的擠掉了」)
  IF pg_catalog.strpos(v_code, '''not_card_order''') = 0 THEN
    RAISE EXCEPTION '事後④b:目標單必須是刷卡單那道守門不見了 ⇒ 拒繼續';
  END IF;

  IF pg_catalog.strpos(v_code, '''duplicate''') = 0
     OR pg_catalog.strpos(v_code, '''needs_settle''') = 0
     OR pg_catalog.strpos(v_code, '''not_unpaid''') = 0 THEN
    RAISE EXCEPTION '事後④:duplicate / needs_settle / not_unpaid 三個舊出口有缺 ⇒ 拒繼續';
  END IF;

  -- ⑤ 🔴 安全邊界還在:隔離閘 · 取消守門 · advisory lock
  IF pg_catalog.strpos(v_code, 'isolation guard') = 0
     OR pg_catalog.strpos(v_code, 'order_cancellations') = 0
     OR pg_catalog.strpos(v_code, 'pg_advisory_xact_lock') = 0 THEN
    RAISE EXCEPTION '事後⑤:隔離閘 / 取消守門 / advisory lock 有缺 ⇒ 拒繼續';
  END IF;

  -- ⑥ 🔴 ACL 沒漂:CREATE OR REPLACE 會把既有 ACL 原樣保留, **包含已經漂掉的那一種**
  -- ⑥ 🔴 ACL:**兩個方向都要釘**(codex 關卡2 must-fix ⑥ —— 我原本只驗了 anon)。
  --   📌 只驗「誰不能」⇒ 一個把 authenticated 也收掉的漂移會全綠, 而它讓顧客站整條斷。
  IF pg_catalog.has_function_privilege('anon', 'public.begin_charge_attempt(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '事後⑥:anon 可以執行 begin_charge_attempt ⇒ ACL 漂了 ⇒ 拒繼續';
  END IF;
  -- 🔴🔴 **⛔ ~~原本寫「authenticated 必須有 EXECUTE」~~ —— 那是【假的】, 而它會讓這支 migration 自己炸掉。**
  --   🔬 唯讀正式庫實測(2026-09-04, pcm_readonly · transaction_read_only=on):
  --      begin_charge_attempt ⇒ anon f · **authenticated f** · **payment_confirmer t** · service_role f
  --      對照 find_active_sibling_own ⇒ anon f · **authenticated t** · payment_confirmer f
  --   ⇒ 🎯 **兩支函式的正確 ACL【不一樣】, 而我把片 A 那道斷言的形狀照抄過來。**
  --   ⇒ 📌 **抄一份會分岔 —— 而這次分岔的不是碼, 是【一個斷言的期望值】。**
  --      而它的失效方式最糟:**正式 ACL 正確的時候, 它會 RAISE ⇒ 整支 migration 套用失敗。**
  --   ⇒ ⇒ 🛑 **一道寫錯期望值的斷言, 在對的世界裡叫。**(codex 關卡2 R2 抓到, 而它同時撤回自己 R1 的判斷)
  IF NOT pg_catalog.has_function_privilege('payment_confirmer', 'public.begin_charge_attempt(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '事後⑥:payment_confirmer 不能執行 begin_charge_attempt ⇒ 扣款那條路會斷 ⇒ 拒繼續';
  END IF;
  IF pg_catalog.has_function_privilege('authenticated', 'public.begin_charge_attempt(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '事後⑥b:authenticated 可以執行 begin_charge_attempt ⇒ ACL 漂了(它應該只給 payment_confirmer)⇒ 拒繼續';
  END IF;
  -- ⑦ 🔴 而 SECURITY DEFINER 那個性質本身也要釘 —— 掉了它, own-only 那層就靠 RLS 裸奔。
  IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'begin_charge_attempt' AND p.prosecdef) THEN
    RAISE EXCEPTION '事後⑦:begin_charge_attempt 不再是 SECURITY DEFINER ⇒ 拒繼續';
  END IF;
END
$post$;

COMMIT;
