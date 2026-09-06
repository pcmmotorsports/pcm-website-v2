-- 20260906700000_m4b_card_success_supersedes_bank.sql
-- ⟦b4-CARDPENDINGWINDOW⟧ 刷卡成功那一刻也 supersede 同 cart 的匯款單
--
-- ## 病灶(不是我重述, 是板列與 codex 的字)
-- `docs/launch-todo.md:341` 的 codex R1 逐字:「真正破口是正式庫的 `mark_charge_attempt_charged*` /
-- `confirm_order_payment` **不拿此鎖**:pending → 建匯款單 → charged/paid, 兩單仍同時活著。」
-- 時序:begin_charge_attempt 只 supersede【當下已存在】的匯款單 ⇒ 3DS pending 期間客人另開分頁建的那張
-- 沒有人回頭看 ⇒ 刷卡完成後兩張單同時活著。
-- 🛑 **不能靠「把 pending 也擋掉」修** —— `ClearCartOnSuccess.tsx:18` 逐字「callback page 僅在 paid 分支傳
-- regenerate」⇒ 刷卡失敗後 cart_session_id 不換 ⇒ 擋 pending 會讓想再試一次的客人結不了帳。
--
-- ## 分母(對正式庫唯讀量到, 不是 grep 檔案)
-- 掃全庫 187 支 plpgsql:寫 `payment_charge_attempts.status='charged'` = 2 支;
-- 寫 `orders.payment_status='paid'`(寫死字面)= 1 支 ⇒ **刷卡成功入口 = 3 支**。
-- 🔴 板列原本寫「兩支」, 漏了 `mark_charge_attempt_charged_fallback` ⇒ 已同日更正。
-- 🔵 `pcm_noncard_settle_recompute` 也會寫 `paid`(逐字 `IF v_verdict='settled' THEN v_new:='paid'`),
--    而它在 `confirm_order_payment` 的**下游**(card 腿寫 order_payments ⇒ AFTER INSERT trigger ⇒ 它)
--    ⇒ **刻意不列入口**(`-f8` 2026-09-06 裁 Q-pending4 = 3 支):把 supersede 放進它, 匯款/現金收款
--      也會觸發 ⇒ 那是沒有人拍過的行為改變, 那一半歸 `⟦b4-BANKDUPPERCART⟧` / M2 另一片。
--
-- ## 做法(`-f8` 裁 Q-pending1 = 乙)
-- **三處各寫一份逐字相同的 supersede 區塊**, 不抽共用函式
-- (不推翻 `20260904050000:200` 逐字「這三處刻意逐字相同, 而它們【不共用】」)。
-- ⇒ 而「各寫一份」的代價由**事後斷言**接住:三段抽出來比 md5, 不相等就紅。
--
-- ## 來源座標(動手當天重跑過)
-- `scripts/latest-definition-of.sh` ⇒ 三支的 newest 都是 `20260810170000`。
-- 本片以 `sed -n '127,234p' / '241,320p' / '328,520p'` 抽出三支本體, **一個字元都沒有重打**,
-- 只在各自的空行處插入同一段 45 行區塊(插入點 227 / 315 / 509,當天 `grep -n` 核過)。
-- 🔬 三支的 `prosrc` md5 由**兩個獨立來源**各自量到而相等(正式庫唯讀 · 拋棄式 PG `check_function_bodies=off`):
--    `mark_charge_attempt_charged` = 13dfcc0a3c7f8e35b53063ca9babf8e5
--    `mark_charge_attempt_charged_fallback` = ca9a7593ca05b2991d295ce93be692f4
--    `confirm_order_payment` = 184204e35edb0dba1b6d4d0909136f3c
--
-- 🟢 唯讀性:只 CREATE OR REPLACE 三支函式, 零 DML、零 DDL 於任何資料表。

BEGIN;
-- 🔴 codex R1 #9:止血檔與本片都要能【及時失敗】, 不能在事故中無限等鎖。
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ══ 0. 前置閘 ═════════════════════════════════════════════════════════════
DO $pre$
DECLARE
  r record;
  v_n integer;
  v_raw text;
  v_cmt text;
  v_has_new boolean;
  v_expect_old text;
  v_expect_new text;
  v_expect_cmt text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('mark_charge_attempt_charged',          'p_attempt_id uuid, p_order_id uuid, p_rec_trade_id text',                     '13dfcc0a3c7f8e35b53063ca9babf8e5', '0c72f0309ff5211f9da12e11949e822e', '3a470a3d1513e91b4dd7a63a1ea74c4d'),
      ('mark_charge_attempt_charged_fallback', 'p_attempt_id uuid, p_order_id uuid, p_rec_trade_id text, p_fallback_token uuid', 'ca9a7593ca05b2991d295ce93be692f4', '2896aa609d5a8fcdddbd7417947922bc', '7268cab8534684db6b94e85d4149fe3d'),
      ('confirm_order_payment',                'p_order_id uuid, p_amount integer, p_rec_trade_id text',                      '184204e35edb0dba1b6d4d0909136f3c', 'e8ab4ef32cdf7c30d25cc3476501521e', 'e3b98c9a0b3abb1dfc56a99b6fb5bf52')
    ) AS t(fn, args, old_md5, new_md5, cmt_md5)
  LOOP
    -- ① 同名多載恰 1 支(少了這一格, 下面的 SELECT 會任選一列)
    SELECT count(*) INTO v_n FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = r.fn;
    IF v_n <> 1 THEN
      RAISE EXCEPTION '前置閘①:public.% 有 % 支同名函式(期望 1)⇒ 拒繼續。', r.fn, v_n;
    END IF;

    -- ② 簽章語意(prosrc 的 md5 鎖不到參數預設值 / 回傳型別 / SECDEF / search_path)
    SELECT p.prosrc,
           pg_catalog.md5(coalesce(pg_catalog.obj_description(p.oid,'pg_proc'),'(無)'))
      INTO v_raw, v_cmt
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = r.fn
       AND pg_catalog.pg_get_function_arguments(p.oid) = r.args
       AND p.prosecdef
       AND p.proconfig @> ARRAY['search_path=""'];
    IF v_raw IS NULL THEN
      RAISE EXCEPTION '前置閘②:public.% 的簽章語意不符(參數列 / SECURITY DEFINER / search_path 至少一項)⇒ 拒繼續。實際引數 = %',
        r.fn, (SELECT pg_catalog.pg_get_function_arguments(p.oid) FROM pg_catalog.pg_proc p
                 JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
                WHERE n.nspname='public' AND p.proname=r.fn);
    END IF;

    -- ③ md5 錨:兩個世界各一個(還沒貼 / 已經貼過), 第三種一律停
    v_has_new := pg_catalog.strpos(v_raw, 'SUPERSEDE-BLOCK-BEGIN') > 0;
    IF v_has_new THEN
      IF pg_catalog.md5(v_raw) <> r.new_md5 THEN
        RAISE EXCEPTION '前置閘③:public.% 已含本片的區塊, 而它的原始 md5 = %(期望 %)⇒ 有人在本片之上又改過, 拒繼續。',
          r.fn, pg_catalog.md5(v_raw), r.new_md5;
      END IF;
    ELSE
      IF pg_catalog.md5(v_raw) <> r.old_md5 THEN
        RAISE EXCEPTION '前置閘③:public.% 的原始 md5 = %(期望 % = 20260810170000 那一代)⇒ 它不是我抄的那一版, 這一貼會蓋掉別人的東西, 拒繼續。',
          r.fn, pg_catalog.md5(v_raw), r.old_md5;
      END IF;
      -- ③b COMMENT 錨:本片會覆寫三支的 COMMENT ⇒ 上游改過就要停
      IF v_cmt <> r.cmt_md5 THEN
        RAISE EXCEPTION '前置閘③b:public.% 的 COMMENT md5 = %(期望 %)⇒ 有人改過它, 而本片會覆寫掉, 拒繼續。',
          r.fn, v_cmt, r.cmt_md5;
      END IF;
    END IF;
    -- ③c 🔴 ACL 白名單(codex R1 #5):`CREATE OR REPLACE` **保留既有授權** ——
    --    包括漂移出來的那一份。而本片給這三支加了「取消別張訂單」的副作用
    --    ⇒ 📌 若套版前有人誤授 PUBLIC / 其他角色, 那個副作用會跟著一起暴露出去。
    --    🔵 形狀取自 `20260810170000` 自己的 allowlist:owner 以外只准 `payment_confirmer`
    --      (主軌與 confirm)或 `authenticated`(備軌走 PostgREST), 且不得可轉授。
    SELECT count(*) INTO v_n
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
     WHERE n.nspname = 'public' AND p.proname = r.fn
       AND a.grantee <> p.proowner
       AND (a.is_grantable
            OR a.grantee = 0
            OR pg_catalog.pg_get_userbyid(a.grantee) NOT IN ('payment_confirmer','authenticated'));
    IF v_n <> 0 THEN
      RAISE EXCEPTION '前置閘③c:public.% 上有 % 筆沒預期的授權(PUBLIC / 可轉授 / 白名單外的角色)⇒ 本片會把它們連同新副作用一起保留, 拒繼續。', r.fn, v_n;
    END IF;
  END LOOP;

  -- ④ 抄來源那支的字面要在(證明我抄的那一版的特徵還在線上)
  SELECT p.prosrc INTO v_raw FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='mark_charge_attempt_charged';
  IF pg_catalog.strpos(v_raw, 'payment_double_charge_anomalies') = 0 THEN
    RAISE EXCEPTION '前置閘④:mark_charge_attempt_charged 裡找不到 payment_double_charge_anomalies ⇒ 線上那一支不是 20260810170000 那一代。';
  END IF;
  RAISE NOTICE '前置閘:三支都通過(多載 / 簽章語意 / 原始 md5 / COMMENT md5)。';
END
$pre$;

-- ══ 1.1 mark_charge_attempt_charged(逐字抄 20260810170000, 只插入那一段區塊)══
CREATE OR REPLACE FUNCTION public.mark_charge_attempt_charged(
  p_attempt_id   uuid,
  p_order_id     uuid,
  p_rec_trade_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_row             record;
  v_n               integer;
  v_cart_session_id uuid;      -- 🔴 R1b1c genesis:取自 orders、anomaly.cart_session_id NOT NULL 來源
  v_amount          integer;   -- 🔴 R1b1c genesis:取 orders.total(integer 快照、禁浮點)
  v_generic_msg constant text := 'mark_charge_attempt_charged: 付款處理失敗';  -- PF-E
BEGIN
  -- ⟦SUPERSEDE-BLOCK-BEGIN⟧ 刷卡成功也 supersede 同 cart 的匯款單(⟦b4-CARDPENDINGWINDOW⟧)
  -- 🔴🔴 **這一段在三支刷卡成功入口裡【逐字相同】** —— 由本片的事後斷言釘住(三段 md5 必須相等)。
  --    主視窗 `-f8` 2026-09-06 裁 Q-pending1=乙:三處各寫一份, 不抽共用函式
  --    (不推翻 `20260904050000:200` 那段「刻意逐字相同而不共用」)。
  -- 🔵 **為什麼它只吃 `p_order_id`**:三支函式的參數列不同, 而它們都有 `p_order_id`
  --    ⇒ 只靠這一個參數就能自足 ⇒ 三段才可能逐字相同。
  --
  -- 🔴🔴 **位置在函式的【最開頭】, 而那是 codex R1 打回第一版才改的 —— 理由是【鎖順序】。**
  --    ⛔ ~~第一版放在「最後一個早退之後」~~ ⇒ 那時三支**已經持有 orders / attempts 的列鎖**,
  --      而 `create_order`(`20260906500000:277`)與 `begin_charge_attempt`(`20260904050000:118`)
  --      都是**先拿 advisory、再動列** ⇒ 📌 **兩邊的取得順序相反 ⇒ 可以形成 40P01 死結。**
  --    ✅ 移到最開頭之後, 三支也變成「先 advisory、再動列」⇒ **全隊同一個順序, 環構不出來。**
  -- 🛑 **而「放在最前面 = 還沒確定成功就先取消」這個疑慮不成立** ——
  --    整支函式是**同一個交易**:任何失敗路徑都 `RAISE` ⇒ 連同這一段一起 rollback。
  --    🔬 三支裡的 `RETURN` 只有三處(`20260810170000:173` · `:300` · `:402`),
  --      **三處都是「同 rec 重放」的冪等成功語意** ⇒ 那些路徑上取消匯款單是對的, 不是誤殺。
  --
  -- 🔴 `k.payment_channel = 'tappay'` 這一條也是 codex R1 逼出來的:
  --    `confirm_order_payment` **沒有驗目標是不是刷卡單** ⇒ 誤傳一張匯款單進去,
  --    它會被標成 TapPay paid, 而少了這一條, 本區塊還會順手取消同 cart 的其他匯款單。
  --    ⇒ 📌 **本區塊只在「留下來的那張是刷卡單」時才動手。**
  DECLARE
    v_sup_uid uuid;
  BEGIN
    SELECT k.customer_user_id INTO v_sup_uid
      FROM public.orders k
     WHERE k.id = p_order_id AND k.payment_channel = 'tappay';
    IF v_sup_uid IS NOT NULL THEN
      -- 🔴 拿與 `create_order` / `begin_charge_attempt` **同一把** advisory lock。
      --    少了它, 建單那支可以在我這一發 UPDATE 之後才通過它的守門並插進來。
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_sup_uid::text, 0));
      -- 🔴 取消條件【照抄】`20260904050000:202-215`, 不自己想一個。
      --    那裡逐字記著:條件與逾期那支、與 admin_cancel_order 步7 三處相同,
      --    而 `a.status <> 'failed'` 比 `IN ('pending','charged')` 寬 —— 漏掉 `released`
      --    會變成「已取消而事後仍可能扣款」。
      UPDATE public.orders o
         SET cancelled_at     = pg_catalog.now(),
             cancelled_reason = 'superseded_by_card',
             updated_at       = pg_catalog.now()
        FROM public.orders k
       WHERE k.id                 = p_order_id
         AND k.payment_channel    = 'tappay'
         AND o.customer_user_id   = k.customer_user_id
         AND o.cart_session_id    = k.cart_session_id
         AND o.id                <> k.id
         AND o.cancelled_at IS NULL
         AND o.payment_channel    = 'bank_transfer'
         AND o.payment_status     = 'unpaid'::public.payment_status
         AND NOT EXISTS (
               SELECT 1 FROM public.payment_charge_attempts a
                WHERE a.order_id = o.id
                  AND a.status <> 'failed'
             );
    END IF;
  END;
  -- ⟦SUPERSEDE-BLOCK-END⟧
  -- rec 形狀驗(基線逐字不動;TapPay rec_trade_id 英數、上限 64)
  IF p_rec_trade_id IS NULL OR pg_catalog.btrim(p_rec_trade_id) = '' OR pg_catalog.length(p_rec_trade_id) > 64 THEN
    RAISE EXCEPTION '%', v_generic_msg;  -- 輸入驗同通用訊息(付款軌 RAISE 全收斂)
  END IF;

  -- 雙鍵驗(attempt_id + order_id 配對)+ FOR UPDATE 序列化雙軌並發重試(基線 WHERE/FOR UPDATE 逐字不動;
  -- 🔴 R1b1c 擴 SELECT 欄位〔order_id / customer_user_id / released_at〕供 genesis 取值;
  --    🔴 L5b-0 再擴 〔superseded_at〕供本片的閘取值。述詞與鎖**兩次都不變**)
  SELECT id, order_id, customer_user_id, status, rec_trade_id, released_at, superseded_at
    INTO v_row
    FROM public.payment_charge_attempts
   WHERE id = p_attempt_id AND order_id = p_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 🔴🔴 L5b-0 讓路入帳鐵律(Sean 2026-08-10 拍板 A):被讓路的 attempt **永不准**被認列成收款。
  --    被讓路 = L5a-1 蓋上 superseded_at(20260810010000:261)= 客人已改走新單,這筆錢的唯一出口是**退款**。
  --    位置刻意在「charged 冪等分支之前」:那個分支的 RETURN 對上游是**成功語意**,
  --    settlePaid 會續呼 confirm(settle-charge.ts:437)⇒ 讓它提前成功等於沒擋。
  --    通用訊息(PF-E)、不另給專屬 SQLSTATE:上游 catch 只回 record_unreachable、專屬碼觀測不到(plan §3.4)。
  IF v_row.superseded_at IS NOT NULL THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 冪等:已 charged 且同 rec → no-op(基線逐字不動;雙軌×重試安全;不刷 updated_at;同 rec 不重建 anomaly)
  IF v_row.status = 'charged' THEN
    IF v_row.rec_trade_id IS NOT DISTINCT FROM p_rec_trade_id THEN
      RETURN;
    END IF;
    RAISE EXCEPTION '%', v_generic_msg;  -- charged 但異 rec = 異常(不覆寫)
  END IF;

  -- 🔴 R1b1c 轉移放寬:pending / released → charged(基線僅 pending;released = late success 對帳收斂)
  UPDATE public.payment_charge_attempts
     SET status       = 'charged',
         rec_trade_id = p_rec_trade_id,
         updated_at   = pg_catalog.now()
   WHERE id = p_attempt_id AND order_id = p_order_id AND status IN ('pending', 'released');

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 🔴 R1b1c genesis:released→charged = late success「雙扣明確化」→ 同交易建 open anomaly(§2.6 / §4 R1b1c / PRD §5)
  IF v_row.status = 'released' THEN
    -- cart_session_id + amount 同交易取自 order(orders.total integer 禁浮點;orders.cart_session_id 為主要來源)
    SELECT cart_session_id, total
      INTO v_cart_session_id, v_amount
      FROM public.orders
     WHERE id = p_order_id;

    -- 🔴 所有 NOT NULL 欄齊填;缺則 INSERT not_null_violation RAISE(不被下方 unique_violation handler 攔 → 整交易回滾)
    --    → markCharged 失敗、attempt 維持 released、anomaly 不建 → 寧可不收斂也不漏記雙扣(§7 主訊號、PRD §1.3/§5)。
    -- ON CONFLICT (old_attempt_id) DO NOTHING:冪等(same-rec 重呼 / 並發二次 markCharged 皆不重複建)。
    INSERT INTO public.payment_double_charge_anomalies (
      old_attempt_id,
      old_order_id,
      user_id,
      cart_session_id,
      rec_trade_id,
      refund_target_rec_trade_id,
      released_at,
      charged_at,
      amount,
      status
    )
    VALUES (
      v_row.id,                  -- old_attempt_id
      v_row.order_id,            -- old_order_id
      v_row.customer_user_id,    -- user_id
      v_cart_session_id,         -- cart_session_id(取自 order)
      p_rec_trade_id,            -- rec_trade_id = 本次 released→charged 寫入 old attempt 的 rec
      p_rec_trade_id,            -- refund_target_rec_trade_id = 同上(舊 attempt rec、絕不指向重刷新單)
      v_row.released_at,         -- released_at(R1a3 COALESCE write-once)
      pg_catalog.now(),          -- charged_at
      v_amount,                  -- amount = orders.total(integer 快照)
      'open'                     -- status genesis = open
    )
    ON CONFLICT (old_attempt_id) DO NOTHING;
  END IF;

EXCEPTION
  -- 跨單重複 rec 撞 rec_unique_idx → 通用訊息(PF-E、不洩約束名/rec;基線逐字不動)
  -- 🔴 注意:genesis 之 not_null_violation 非 unique_violation → 不被此攔、向上傳播 → fail-closed(漏記雙扣寧失敗)。
  WHEN unique_violation THEN
    RAISE EXCEPTION '%', v_generic_msg;
END;
$fn$;

-- ── 1.1-b COMMENT 也要跟著改(codex R1 #6:本片給它加了副作用, 而 catalog 上的說明不知道)──
-- 🔵 下面整段逐字取自 20260810170000:236-237, 只在結尾補一句。
COMMENT ON FUNCTION public.mark_charge_attempt_charged(uuid, uuid, text) IS
  'M-3 3DS R1b1c + M-4b L5b-0 PF-X1 麵包屑主軌。🔴 **L5b-0 讓路入帳鐵律(閘一)**:superseded_at 非 NULL(=L5a-1 判定讓路、客人已改走新單)⇒ **一律 RAISE、永不轉 charged**;那筆錢的唯一出口是退款(Sean 2026-08-10 拍板 A)。閘位在 charged 冪等分支**之前**(該分支的 RETURN 對上游是成功語意、會讓 settlePaid 續呼 confirm)。⚠️ 本閘只是縱深,錢的歸屬由 confirm_order_payment 的同族閘(L5b-0 閘三)守;且**繞得過 owner 直寫**(非 DB 全域不變量)。以下為 R1b1c 既有行為、逐字不動:status IN (pending,released)→charged + rec_trade_id;released = late success 對帳收斂 → 同交易建 open anomaly(payment_double_charge_anomalies、ON CONFLICT old_attempt_id DO NOTHING、所有 NOT NULL 欄齊填、缺則 RAISE fail-closed;refund_target=舊 attempt rec、amount=orders.total integer);基線雙鍵驗 + FOR UPDATE + charged 同 rec 冪等 no-op + 跨單重複 rec 通用 RAISE。只 payment_confirmer 可呼(ACL 沿用基線、本片不改)。'
  '🔴 **2026-09-06 ⟦b4-CARDPENDINGWINDOW⟧ 新增的副作用**:本函式在【最開頭】會 supersede 同一位客人、同一個 cart_session_id、且【留下來那張是刷卡單】時的**未付款且無非終態 attempt 的匯款單**(cancelled_reason=''superseded_by_card'')。理由:3DS pending 期間客人另開分頁建的匯款單, `create_order` 的守門看到的是 pending 不是 charged ⇒ 放行 ⇒ 刷卡完成後兩張單同時活著。位置在最開頭是為了**鎖順序**(先 advisory 再動列, 與 create_order / begin_charge_attempt 一致)。三支入口的那段區塊逐字相同, 由 20260906700000 的事後斷言釘住。';

-- ══ 1.2 mark_charge_attempt_charged_fallback(逐字抄 20260810170000, 只插入那一段區塊)══
CREATE OR REPLACE FUNCTION public.mark_charge_attempt_charged_fallback(
  p_attempt_id     uuid,
  p_order_id       uuid,
  p_rec_trade_id   text,
  p_fallback_token uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_row         record;
  v_uid         uuid := (SELECT auth.uid());
  v_n           integer;
  v_generic_msg constant text := 'mark_charge_attempt_charged_fallback: 付款處理失敗';  -- PF-E(token 對錯不可區分)
BEGIN
  -- ⟦SUPERSEDE-BLOCK-BEGIN⟧ 刷卡成功也 supersede 同 cart 的匯款單(⟦b4-CARDPENDINGWINDOW⟧)
  -- 🔴🔴 **這一段在三支刷卡成功入口裡【逐字相同】** —— 由本片的事後斷言釘住(三段 md5 必須相等)。
  --    主視窗 `-f8` 2026-09-06 裁 Q-pending1=乙:三處各寫一份, 不抽共用函式
  --    (不推翻 `20260904050000:200` 那段「刻意逐字相同而不共用」)。
  -- 🔵 **為什麼它只吃 `p_order_id`**:三支函式的參數列不同, 而它們都有 `p_order_id`
  --    ⇒ 只靠這一個參數就能自足 ⇒ 三段才可能逐字相同。
  --
  -- 🔴🔴 **位置在函式的【最開頭】, 而那是 codex R1 打回第一版才改的 —— 理由是【鎖順序】。**
  --    ⛔ ~~第一版放在「最後一個早退之後」~~ ⇒ 那時三支**已經持有 orders / attempts 的列鎖**,
  --      而 `create_order`(`20260906500000:277`)與 `begin_charge_attempt`(`20260904050000:118`)
  --      都是**先拿 advisory、再動列** ⇒ 📌 **兩邊的取得順序相反 ⇒ 可以形成 40P01 死結。**
  --    ✅ 移到最開頭之後, 三支也變成「先 advisory、再動列」⇒ **全隊同一個順序, 環構不出來。**
  -- 🛑 **而「放在最前面 = 還沒確定成功就先取消」這個疑慮不成立** ——
  --    整支函式是**同一個交易**:任何失敗路徑都 `RAISE` ⇒ 連同這一段一起 rollback。
  --    🔬 三支裡的 `RETURN` 只有三處(`20260810170000:173` · `:300` · `:402`),
  --      **三處都是「同 rec 重放」的冪等成功語意** ⇒ 那些路徑上取消匯款單是對的, 不是誤殺。
  --
  -- 🔴 `k.payment_channel = 'tappay'` 這一條也是 codex R1 逼出來的:
  --    `confirm_order_payment` **沒有驗目標是不是刷卡單** ⇒ 誤傳一張匯款單進去,
  --    它會被標成 TapPay paid, 而少了這一條, 本區塊還會順手取消同 cart 的其他匯款單。
  --    ⇒ 📌 **本區塊只在「留下來的那張是刷卡單」時才動手。**
  DECLARE
    v_sup_uid uuid;
  BEGIN
    SELECT k.customer_user_id INTO v_sup_uid
      FROM public.orders k
     WHERE k.id = p_order_id AND k.payment_channel = 'tappay';
    IF v_sup_uid IS NOT NULL THEN
      -- 🔴 拿與 `create_order` / `begin_charge_attempt` **同一把** advisory lock。
      --    少了它, 建單那支可以在我這一發 UPDATE 之後才通過它的守門並插進來。
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_sup_uid::text, 0));
      -- 🔴 取消條件【照抄】`20260904050000:202-215`, 不自己想一個。
      --    那裡逐字記著:條件與逾期那支、與 admin_cancel_order 步7 三處相同,
      --    而 `a.status <> 'failed'` 比 `IN ('pending','charged')` 寬 —— 漏掉 `released`
      --    會變成「已取消而事後仍可能扣款」。
      UPDATE public.orders o
         SET cancelled_at     = pg_catalog.now(),
             cancelled_reason = 'superseded_by_card',
             updated_at       = pg_catalog.now()
        FROM public.orders k
       WHERE k.id                 = p_order_id
         AND k.payment_channel    = 'tappay'
         AND o.customer_user_id   = k.customer_user_id
         AND o.cart_session_id    = k.cart_session_id
         AND o.id                <> k.id
         AND o.cancelled_at IS NULL
         AND o.payment_channel    = 'bank_transfer'
         AND o.payment_status     = 'unpaid'::public.payment_status
         AND NOT EXISTS (
               SELECT 1 FROM public.payment_charge_attempts a
                WHERE a.order_id = o.id
                  AND a.status <> 'failed'
             );
    END IF;
  END;
  -- ⟦SUPERSEDE-BLOCK-END⟧
  -- rec 形狀驗(同主軌)
  IF p_rec_trade_id IS NULL OR pg_catalog.btrim(p_rec_trade_id) = '' OR pg_catalog.length(p_rec_trade_id) > 64 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;
  -- 護欄②前置:未登入(無 JWT)直接拒
  IF v_uid IS NULL OR p_fallback_token IS NULL THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 雙鍵驗 + FOR UPDATE
  SELECT id, status, rec_trade_id, customer_user_id, fallback_token_hash, superseded_at
    INTO v_row
    FROM public.payment_charge_attempts
   WHERE id = p_attempt_id AND order_id = p_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 護欄①:token hash 比對(同 helper 單一真相;不符 = 非本 server 流程發出 → 拒)
  IF public.charge_attempt_token_hash(p_fallback_token) <> v_row.fallback_token_hash THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;
  -- 護欄②:本人歸屬(auth.uid() 對 attempt 反正規化 customer_user_id)
  IF v_uid <> v_row.customer_user_id THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 🔴🔴 L5b-0 讓路入帳鐵律(Sean 2026-08-10 拍板 A):被讓路的 attempt **永不准**被認列成收款。
  --    被讓路 = L5a-1 蓋上 superseded_at(20260810010000:261)= 客人已改走新單,這筆錢的唯一出口是**退款**。
  --    位置刻意在「charged 冪等分支之前」:那個分支的 RETURN 對上游是**成功語意**,
  --    settlePaid 會續呼 confirm(settle-charge.ts:437)⇒ 讓它提前成功等於沒擋。
  --    通用訊息(PF-E)、不另給專屬 SQLSTATE:上游 catch 只回 record_unreachable、專屬碼觀測不到(plan §3.4)。
  --    🔴 備軌為什麼也要:它只擋 status='pending'(本檔基線),對 **pending+superseded** 完全沒守門;
  --       而「superseded ⇒ 必為 released」是**寫入端自律、schema 沒強制**(L5a-M 五條 CHECK 沒有這條)。
  IF v_row.superseded_at IS NOT NULL THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 護欄③:僅 pending→charged;charged 同 rec 冪等 no-op;其餘(failed / charged 異 rec)拒
  IF v_row.status = 'charged' THEN
    IF v_row.rec_trade_id IS NOT DISTINCT FROM p_rec_trade_id THEN
      RETURN;
    END IF;
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  UPDATE public.payment_charge_attempts
     SET status       = 'charged',
         rec_trade_id = p_rec_trade_id,
         updated_at   = pg_catalog.now()
   WHERE id = p_attempt_id AND order_id = p_order_id AND status = 'pending';

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION '%', v_generic_msg;
END;
$fn$;

-- ── 1.2-b COMMENT 也要跟著改(codex R1 #6:本片給它加了副作用, 而 catalog 上的說明不知道)──
-- 🔵 下面整段逐字取自 20260810170000:322-323, 只在結尾補一句。
COMMENT ON FUNCTION public.mark_charge_attempt_charged_fallback(uuid, uuid, text, uuid) IS
  'M-3-S2-d + M-4b L5b-0 PF-X1 麵包屑備軌(第二 transport、authenticated PostgREST)。🔴 **L5b-0 讓路入帳鐵律(閘二)**:superseded_at 非 NULL ⇒ 一律 RAISE。**備軌為什麼也要**:它的轉移閘只擋 status=''pending'',對 **pending+superseded** 完全沒守門;而「superseded ⇒ 必為 released」是**寫入端(L5a-1)自律、schema 沒強制**(L5a-M 五條 CHECK 沒有這條)⇒ 不得把不變量押在另一支 RPC 的實作上。閘位在 token/歸屬兩道護欄**之後**(先認身分再談業務規則)。既有三重護欄逐字不動:① token hash 比對 ② auth.uid() 歸屬 ③ 僅 pending→charged 緊縮轉移、永不釋鎖/標 failed;charged 同 rec 冪等 no-op。token 明文只在 server 記憶體。ACL 沿用基線(authenticated)、本片不改。'
  '🔴 **2026-09-06 ⟦b4-CARDPENDINGWINDOW⟧ 新增的副作用**:本函式在【最開頭】會 supersede 同一位客人、同一個 cart_session_id、且【留下來那張是刷卡單】時的**未付款且無非終態 attempt 的匯款單**(cancelled_reason=''superseded_by_card'')。理由:3DS pending 期間客人另開分頁建的匯款單, `create_order` 的守門看到的是 pending 不是 charged ⇒ 放行 ⇒ 刷卡完成後兩張單同時活著。位置在最開頭是為了**鎖順序**(先 advisory 再動列, 與 create_order / begin_charge_attempt 一致)。三支入口的那段區塊逐字相同, 由 20260906700000 的事後斷言釘住。';

-- ══ 1.3 confirm_order_payment(逐字抄 20260810170000, 只插入那一段區塊)══
CREATE OR REPLACE FUNCTION public.confirm_order_payment(
  p_order_id     uuid,
  p_amount       integer,
  p_rec_trade_id text
)
RETURNS jsonb                 -- {confirmed boolean, idempotent boolean};禁回 total/價結構(PF-G)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_order       record;
  v_n           integer;
  v_generic_msg constant text := 'confirm_order_payment: 付款確認失敗';  -- 🔴 PF-E:業務拒絕單一通用訊息、不洩內部狀態
BEGIN
  -- ⟦SUPERSEDE-BLOCK-BEGIN⟧ 刷卡成功也 supersede 同 cart 的匯款單(⟦b4-CARDPENDINGWINDOW⟧)
  -- 🔴🔴 **這一段在三支刷卡成功入口裡【逐字相同】** —— 由本片的事後斷言釘住(三段 md5 必須相等)。
  --    主視窗 `-f8` 2026-09-06 裁 Q-pending1=乙:三處各寫一份, 不抽共用函式
  --    (不推翻 `20260904050000:200` 那段「刻意逐字相同而不共用」)。
  -- 🔵 **為什麼它只吃 `p_order_id`**:三支函式的參數列不同, 而它們都有 `p_order_id`
  --    ⇒ 只靠這一個參數就能自足 ⇒ 三段才可能逐字相同。
  --
  -- 🔴🔴 **位置在函式的【最開頭】, 而那是 codex R1 打回第一版才改的 —— 理由是【鎖順序】。**
  --    ⛔ ~~第一版放在「最後一個早退之後」~~ ⇒ 那時三支**已經持有 orders / attempts 的列鎖**,
  --      而 `create_order`(`20260906500000:277`)與 `begin_charge_attempt`(`20260904050000:118`)
  --      都是**先拿 advisory、再動列** ⇒ 📌 **兩邊的取得順序相反 ⇒ 可以形成 40P01 死結。**
  --    ✅ 移到最開頭之後, 三支也變成「先 advisory、再動列」⇒ **全隊同一個順序, 環構不出來。**
  -- 🛑 **而「放在最前面 = 還沒確定成功就先取消」這個疑慮不成立** ——
  --    整支函式是**同一個交易**:任何失敗路徑都 `RAISE` ⇒ 連同這一段一起 rollback。
  --    🔬 三支裡的 `RETURN` 只有三處(`20260810170000:173` · `:300` · `:402`),
  --      **三處都是「同 rec 重放」的冪等成功語意** ⇒ 那些路徑上取消匯款單是對的, 不是誤殺。
  --
  -- 🔴 `k.payment_channel = 'tappay'` 這一條也是 codex R1 逼出來的:
  --    `confirm_order_payment` **沒有驗目標是不是刷卡單** ⇒ 誤傳一張匯款單進去,
  --    它會被標成 TapPay paid, 而少了這一條, 本區塊還會順手取消同 cart 的其他匯款單。
  --    ⇒ 📌 **本區塊只在「留下來的那張是刷卡單」時才動手。**
  DECLARE
    v_sup_uid uuid;
  BEGIN
    SELECT k.customer_user_id INTO v_sup_uid
      FROM public.orders k
     WHERE k.id = p_order_id AND k.payment_channel = 'tappay';
    IF v_sup_uid IS NOT NULL THEN
      -- 🔴 拿與 `create_order` / `begin_charge_attempt` **同一把** advisory lock。
      --    少了它, 建單那支可以在我這一發 UPDATE 之後才通過它的守門並插進來。
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_sup_uid::text, 0));
      -- 🔴 取消條件【照抄】`20260904050000:202-215`, 不自己想一個。
      --    那裡逐字記著:條件與逾期那支、與 admin_cancel_order 步7 三處相同,
      --    而 `a.status <> 'failed'` 比 `IN ('pending','charged')` 寬 —— 漏掉 `released`
      --    會變成「已取消而事後仍可能扣款」。
      UPDATE public.orders o
         SET cancelled_at     = pg_catalog.now(),
             cancelled_reason = 'superseded_by_card',
             updated_at       = pg_catalog.now()
        FROM public.orders k
       WHERE k.id                 = p_order_id
         AND k.payment_channel    = 'tappay'
         AND o.customer_user_id   = k.customer_user_id
         AND o.cart_session_id    = k.cart_session_id
         AND o.id                <> k.id
         AND o.cancelled_at IS NULL
         AND o.payment_channel    = 'bank_transfer'
         AND o.payment_status     = 'unpaid'::public.payment_status
         AND NOT EXISTS (
               SELECT 1 FROM public.payment_charge_attempts a
                WHERE a.order_id = o.id
                  AND a.status <> 'failed'
             );
    END IF;
  END;
  -- ⟦SUPERSEDE-BLOCK-END⟧
  -- 🔴 A8c2 隔離閘(fail-closed;A8c1 同款、A2b1 教訓):非 READ COMMITTED 下 FOR UPDATE 等鎖
  --    醒來後快照仍舊、部分取消不動 orders 列 ⇒ EXISTS 看不到已 commit 取消。
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'confirm_order_payment: isolation guard' USING ERRCODE = 'P8C01';
  END IF;

  -- ── 輸入驗:rec_trade_id 非空(server 自供參數、非訂單內部狀態 → 可具體)──
  IF p_rec_trade_id IS NULL OR pg_catalog.btrim(p_rec_trade_id) = '' THEN
    RAISE EXCEPTION 'confirm_order_payment: 交易識別碼缺失';
  END IF;

  -- ── PF-B:FOR UPDATE 鎖臨界區 ──
  SELECT id, total, payment_status, tappay_rec_trade_id, cancelled_at
    INTO v_order
    FROM public.orders
   WHERE id = p_order_id
   FOR UPDATE;

  -- ── PF-D(1):訂單不存在 → 拒(通用、不洩存在與否)──
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 🔴 A8c2 取消守門(master plan row 35;R8 守門先於取消):存在任何取消紀錄 ⇒ 拒確認。
  --    位置=paid 冪等樹之前:已取消且已 paid 的同 rec 同額重放不得回 idempotent 成功。
  --    真相=orders.cancelled_at + order_cancellations 本表(A1 契約);通用訊息=PF-E。
  IF v_order.cancelled_at IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.order_cancellations c WHERE c.order_id = p_order_id) THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 🔴🔴 L5b-0 閘三(§1-OPEN Sean 拍 A):**這裡才是「錢的歸屬」那道閘**。
  --    閘一/二 擋的是麵包屑;而非 3DS 的 confirmPayment 在 markCharged 失敗時**刻意續走**
  --    (confirm-payment.ts:107-130 逐字「log critical 續走」)⇒ 下一步就是這支 RPC 把舊單標 paid。
  --    位置=A8c2 取消守門之後、paid 冪等樹之前,理由與取消守門同款:
  --    冪等樹的提前 RETURN 也是「成功」,讓它先跑等於沒擋。
  -- 🔴 `status IN (...)` 那條**不可省**:少了它,凡是「曾經有過讓路 attempt」的訂單就**永遠**
  --    不能再被確認收款,包含客人日後合法重付(L5a-2 重付鈕)。
  --    這組 status 與 per-order 鎖 UNIQUE index 的 predicate 同源(20260624120000:62-64)
  --    ⇒ 語意=「**仍持有這張單付款權**的那顆 attempt 是被讓路的」。單一真相、不另立一套。
  --    close_released_attempt 把它翻 failed 之後(20260624120010:121-127)即離開此集合、該單可正常收款。
  -- ⚠️ 能力天花板(plan §3.3):本閘判的是「這張單有沒有活的讓路 attempt」,**不是**「這次的錢
  --    來自哪顆 attempt」。舊 attempt 結案後若有人拿**舊 rec** 呼本 RPC,本閘放行。今天走不到
  --    (兩個呼叫端的 rec 都取自當前 active attempt),失效條件見 plan §8-4。
  IF EXISTS (
    SELECT 1 FROM public.payment_charge_attempts a
     WHERE a.order_id = p_order_id
       AND a.superseded_at IS NOT NULL
       AND a.status IN ('pending', 'charged', 'released')
  ) THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- ── PF-D(3):paid 且 rec_trade_id+amount 雙等 → no-op 冪等成功(真 RETURN、不 UPDATE、不刷時間戳)──
  -- 🔴 OP3:這棵樹的位置**不得下移到 card 腿之後** —— 它提前 RETURN 正是「同 rec 重放不落第二列」
  --    的唯一機制(重放根本到不了 INSERT)。檔尾順序錨釘住它在 INSERT 之前。
  IF v_order.payment_status = 'paid'::public.payment_status THEN
    IF v_order.tappay_rec_trade_id IS NOT DISTINCT FROM p_rec_trade_id
       AND p_amount IS NOT NULL AND v_order.total = p_amount THEN
      RETURN pg_catalog.jsonb_build_object('confirmed', true, 'idempotent', true);
    END IF;
    -- PF-D(4):paid 但 rec 或 amount 任一不等(疑重複扣款/竄改)→ 拒
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- ── PF-D(4):refunded / partiallyPaid(非 unpaid)→ 拒(同 rec 也不復活成 paid)──
  IF v_order.payment_status <> 'unpaid'::public.payment_status THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- ── PF-D(5):unpaid 且金額相符 → 翻 paid;金額不符/NULL → 拒(整數比對、不洩 total)──
  IF p_amount IS NULL OR p_amount <> v_order.total THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 🔴 `total <= 0` 守門(Fable 實跑抓到;可達性趨零但後果不對稱):
  --    total=0 且 p_amount=0 時上面的相等檢查**會過**,然後 card 腿撞
  --    `order_payments.amount CHECK (amount <> 0)` ⇒ 噴 **raw 23514**,PG 的 DETAIL 會把
  --    **整列值**帶出來(繞過 PF-E 的不洩內部狀態),而 app 層又把非 P0001 標成「可重試」。
  --    ⇒ 收斂成 PF-E 通用訊息;這條**不改任何合法路徑**(合法訂單 total 恆正)。
  IF v_order.total <= 0 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- ── cross-order rec_trade_id 重用序列 pre-check(優雅通用訊息;UNIQUE 並發 backstop 見 EXCEPTION)──
  PERFORM 1 FROM public.orders
   WHERE tappay_rec_trade_id = p_rec_trade_id AND id <> p_order_id;
  IF FOUND THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- ── PF-G:翻 paid、僅 5 欄、零 fulfillment_status;WHERE 帶 payment_status='unpaid' 條件式 ──
  UPDATE public.orders
     SET payment_status      = 'paid'::public.payment_status,
         tappay_rec_trade_id = p_rec_trade_id,
         paid_at             = pg_catalog.now(),
         payment_method      = 'tappay',
         updated_at          = pg_catalog.now()
   WHERE id = p_order_id
     AND payment_status = 'unpaid'::public.payment_status;

  -- ── PF-C:row_count 守(防 FORCE RLS 靜默 0 列=收錢沒翻單)──
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- ══ 🔴 OP3 card 腿:與翻 paid **同一筆交易**寫收款帳本 ══════════════════════
  -- 🔴 執行期的 actor 守門(檔頭前置閘 ③ 的另一半):`actor` 是 NOT NULL FK 到 staff,
  --    而 `session_user` 記的是**登入角色**。以「沒有對應 staff 列」的角色呼叫本 RPC,
  --    原本會噴一個 raw 23503 並把約束名 `order_payments_actor_fkey` 洩出去,
  --    而現場完全看不出「這是部署設定問題、不是訂單問題」。⇒ 先問一次、給可診斷的訊息。
  -- ⚠️ 這條**刻意不用** PF-E 通用訊息:PF-E 是為了不洩**訂單狀態**;這裡洩的是我方的角色設定,
  --    與客人的訂單無關,而把它壓成「付款確認失敗」會讓一次部署事故變成查不出來的謎。
  -- 🔴🔴 **codex 關卡2 must-fix:第一版只問「有沒有同名 staff 列」,那擋不住錯的身分。**
  --    失敗情境:apply 之後有人給角色 `ops` EXECUTE、而 staff 恰好也有一列 `ops`
  --    ⇒ 舊守門**全綠**,card 腿的 actor 被寫成 `ops`,錢帳上的經手人從此是錯的,
  --      而且每一格斷言都看不出來(列有落、FK 也過)。
  --    ⇒ 守門要釘的是**身分本身**,不是「這個名字在 staff 表裡找得到」。
  -- 🔴 為什麼可以硬釘 `payment_confirmer` 這個字面:本片的 actor 政策就是
  --    「card 腿只由 TapPay 付款確認這條機器軌寫」(Sean 拍 A′),而那條軌的登入角色就是它。
  --    日後若真要多開一條機器軌,那是**新的拍板**,應該同時改這裡與檔頭政策 —— 讓它在這裡紅,
  --    比讓它靜默寫進一個沒人決定過的 actor 好。
  IF session_user <> 'payment_confirmer' THEN
    RAISE EXCEPTION 'confirm_order_payment: 呼叫端的 DB 角色是 [%],不是 payment_confirmer ⇒ 拒絕落 card 腿。'
                    '這是部署設定問題、不是訂單問題:本 RPC 的 actor 記的是 DB session role(非真人),'
                    '正式路徑必須「就是」payment_confirmer 登入,不是繼承它、也不是別的有 EXECUTE 的角色', session_user
      USING ERRCODE = 'P2B36', CONSTRAINT = 'pcm_op3_actor_wrong_role';
  END IF;
  -- 角色對了還要真的有那一列:seed 被刪掉時 FK 會噴 raw 23503(洩約束名且不可診斷)。
  IF NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.id = session_user) THEN
    RAISE EXCEPTION 'confirm_order_payment: DB 角色 [%] 在 staff 沒有對應列 ⇒ card 腿的 actor 寫不進去。'
                    '這是部署設定問題、不是訂單問題:OP3 seed 的那一列被刪了或沒 apply 到', session_user
      USING ERRCODE = 'P2B36', CONSTRAINT = 'pcm_op3_actor_not_in_staff';
  END IF;

  -- 位置=PF-C 之後、RETURN 之前。放在 PF-C 之後才有意義:翻單沒成功就不該落帳。
  -- · rail='card';`bank_reference` / `request_id` 必須 NULL(OP1 rail_fields 的 card 分支)。
  -- · amount = v_order.total —— **不是 p_amount**。兩者在這一行已被上面的守門證明相等
  --   (`p_amount <> v_order.total` 就 RAISE 了),取 DB 側的值是因為它是**帳本該記的那個事實**,
  --   而 p_amount 是呼叫端送進來的參數。等價但來源不同,選不會被外部影響的那個。
  -- · received_at = pg_catalog.now():理由與代價見檔頭 OP-A11 那段(帳上收款時點=我方確認時點)。
  -- · actor = session_user:見檔頭 actor 那段(DB session role、非真人)。
  -- · 冪等:同 rec 重放走上面的 paid 冪等樹提前 RETURN,到不了這裡;真並發撞
  --   `order_payments_card_idem_uniq` / `order_payments_rec_trade_global_uniq` 由下方既有的
  --   `WHEN unique_violation` handler 收成通用訊息(PF-E)。
  -- 🔴 search_path='' ⇒ 表名與函式名一律 schema-qualified;`session_user` 是**關鍵字不是函式**,
  --    不加 pg_catalog 前綴(加了會 42P01,實跑踩過)。
  INSERT INTO public.order_payments (order_id, rail, amount, received_at, rec_trade_id, actor)
  VALUES (p_order_id, 'card', v_order.total, pg_catalog.now(), p_rec_trade_id, session_user);

  -- 🔴🔴 **PF-C 的第二道(codex 關卡2 must-fix)**:我抄了 UPDATE 那道 row_count 守,
  --    卻沒替自己新增的 INSERT 補同一道。BEFORE INSERT trigger **回 NULL 會把那一列靜默吞掉**
  --    —— INSERT 影響 0 列、**不報任何錯**,函式照樣往下 RETURN 成功,而 orders 已翻成 paid
  --    並隨本交易 commit ⇒ 帳面顯示已收款、收款帳本查無此筆,**正是本片存在的理由本身**,
  --    而且沒有任何守門會叫。
  -- ⚠️ 這條擋的是「靜默 0 列」,不是「INSERT 報錯」—— 後者會直接拋例外、整筆 rollback,本來就安全;
  --    真正危險的是不報錯的那條路。負測 = op3-verify.sh G10(裝一支回 NULL 的 BEFORE INSERT trigger)。
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'confirm_order_payment: card 腿落帳 % 列(期望恰 1)⇒ 翻單成功但收款帳本沒收到這筆。'
                    '成因通常是 order_payments 上有 BEFORE INSERT trigger 回了 NULL(靜默吞列)。'
                    '本交易整筆回滾,訂單狀態與錢帳都不會半套', v_n
      USING ERRCODE = 'P2B37', CONSTRAINT = 'pcm_op3_card_leg_row_count';
  END IF;
  -- ══════════════════════════════════════════════════════════════════════════

  RETURN pg_catalog.jsonb_build_object('confirmed', true, 'idempotent', false);

EXCEPTION
  -- 🔴 PF-E:cross-order rec_trade_id 真並發撞 orders.tappay_rec_trade_id UNIQUE → 通用訊息(不洩 raw 23505/約束名)
  -- 🔴 OP3:本 handler 自本片起**多了一個觸發來源** —— card 腿撞 order_payments 的兩道 partial
  --    unique 也會走到這裡(OP3 之前只可能由 orders 那道 UNIQUE 觸發)。行為相同(通用訊息),
  --    但這句話要寫下來,否則下一個人會以為這條 handler 只管 orders。負測=op3-verify.sh G7。
  WHEN unique_violation THEN
    RAISE EXCEPTION '%', v_generic_msg;
END;
$fn$;

-- ── 1.3-b COMMENT 也要跟著改(codex R1 #6:本片給它加了副作用, 而 catalog 上的說明不知道)──
-- 🔵 下面整段逐字取自 20260810170000:522-539, 只在結尾補一句。
COMMENT ON FUNCTION public.confirm_order_payment(uuid, integer, text) IS
  'M-3-S2-c 付款確認(SECURITY DEFINER 零 service_role、search_path='''')。只 payment_confirmer 可呼;🔴 E10-A8c2 取消守門(master plan row 35;R8 守門先於取消):隔離閘(非 READ COMMITTED 一律 P8C01)→ PF-B FOR UPDATE(加讀 cancelled_at)→ 取消守門(cancelled_at 非空或 order_cancellations 任一列 ⇒ 通用 RAISE;真相表直讀;位置在 paid 冪等樹之前 ⇒ 已取消且已 paid 的同 rec 同額重放不得回 idempotent 成功)→ PF-D 冪等樹:unpaid + p_amount=orders.total + rec_trade_id 非空且未用於別單 → 翻 paid 寫 5 欄(零 fulfillment、PF-G);paid+同 rec+同 amount 重放冪等 no-op(不刷時間戳);refunded/partiallyPaid 即使同 rec 也拒。PF-C row_count 守 + PF-E 通用訊息(#219 harden)+ UNIQUE 並發 backstop。零經銷價/cost。'
  '🔴 E10-OP3 card 腿:PF-C 之後、RETURN 之前,**同一筆交易**往 order_payments insert 一列 '
  '(rail=card、amount=orders.total、received_at=now()、rec_trade_id=本次交易號、actor=session_user)⇒ 翻單與落帳同生共死。'
  'actor 記的是 **DB session role 不是真人**(照 3DS 線慣例);正式路徑必須「就是」payment_confirmer 登入,'
  '沒有對應 staff 列時走 P2B36 具名守門(可診斷訊息,刻意不壓成 PF-E 通用訊息 —— 那是部署問題不是訂單問題)。'
  'received_at 記的是**我方確認時點**、不是發卡行授權時點(外部時鐘 OP2a 的 A8 閘擋不到,見 OP1 檔頭 OP-A11);'
  '同 rec 重放由 paid 冪等樹提前 RETURN 擋住、到不了 INSERT ⇒ 不落第二列;'
  '並發撞 card 兩道 partial unique 由 WHEN unique_violation 收成通用訊息。歷史資料的回填是 OP4,不在本片。'
  '🔴 M-4b L5b-0 讓路入帳鐵律(閘三、本片):A8c2 取消守門之後、paid 冪等樹之前 —— 該單只要還有一顆 '
  '**活的**讓路 attempt(superseded_at 非 NULL 且 status IN (pending,charged,released))⇒ 一律拒絕確認收款,'
  '那筆錢的唯一出口是退款(Sean 2026-08-10 拍板 A)。**這一支才是錢的歸屬那道閘** —— 麵包屑那支 '
  '(mark_charge_attempt_charged)擋不住非 3DS 路徑:confirmPayment 在 markCharged 失敗時刻意續走。'
  '🔴 status 那條不可省:少了它,凡曾有過讓路 attempt 的訂單將**永遠**不能再被確認收款(含客人日後合法重付);'
  '該組 status 與 per-order 鎖 index predicate 同源 ⇒ 語意=「仍持有這張單付款權的那顆 attempt 是被讓路的」,'
  'close_released_attempt 翻 failed 後即離開此集合、該單可正常收款。'
  '⚠️ 天花板:本閘判的是「這張單有沒有活的讓路 attempt」,不是「這次的錢來自哪顆 attempt」;'
  '且繞得過 owner 直寫(非 DB 全域不變量)。失效條件見 plan §8。'
  '🔴 **2026-09-06 ⟦b4-CARDPENDINGWINDOW⟧ 新增的副作用**:本函式在【最開頭】會 supersede 同一位客人、同一個 cart_session_id、且【留下來那張是刷卡單】時的**未付款且無非終態 attempt 的匯款單**(cancelled_reason=''superseded_by_card'')。理由:3DS pending 期間客人另開分頁建的匯款單, `create_order` 的守門看到的是 pending 不是 charged ⇒ 放行 ⇒ 刷卡完成後兩張單同時活著。位置在最開頭是為了**鎖順序**(先 advisory 再動列, 與 create_order / begin_charge_attempt 一致)。三支入口的那段區塊逐字相同, 由 20260906700000 的事後斷言釘住。';


-- ══ 2. 事後斷言 ═══════════════════════════════════════════════════════════
DO $post$
DECLARE
  r record;
  v_raw text;
  v_blk text;
  v_first text;
  v_n integer;
BEGIN
  v_first := NULL;
  FOR r IN
    SELECT * FROM (VALUES
      ('mark_charge_attempt_charged',          '0c72f0309ff5211f9da12e11949e822e'),
      ('mark_charge_attempt_charged_fallback', '2896aa609d5a8fcdddbd7417947922bc'),
      ('confirm_order_payment',                'e8ab4ef32cdf7c30d25cc3476501521e')
    ) AS t(fn, new_md5)
  LOOP
    SELECT count(*) INTO v_n FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname=r.fn;
    IF v_n <> 1 THEN
      RAISE EXCEPTION '事後①:public.% 有 % 支同名函式 ⇒ 本片可能建出了多載。', r.fn, v_n;
    END IF;

    SELECT p.prosrc INTO v_raw FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname=r.fn;

    -- ② 區塊真的在
    IF pg_catalog.strpos(v_raw, 'SUPERSEDE-BLOCK-BEGIN') = 0
       OR pg_catalog.strpos(v_raw, 'SUPERSEDE-BLOCK-END') = 0 THEN
      RAISE EXCEPTION '事後②:public.% 裡找不到 supersede 區塊 ⇒ 本片對這一支沒生效。', r.fn;
    END IF;

    -- ③ 🔴🔴 三段【逐字相同】—— `-f8` 2026-09-06 指定的那道守門
    --    ⇒ 下一個人改一處而漏兩處, 貼的時候就會在這裡紅。
    v_blk := (pg_catalog.regexp_match(v_raw, 'SUPERSEDE-BLOCK-BEGIN(.*?)SUPERSEDE-BLOCK-END'))[1];
    IF v_blk IS NULL THEN
      RAISE EXCEPTION '事後③:public.% 的區塊抽不出來(兩個標記在而中間抓不到)⇒ 這把尺壞了。', r.fn;
    END IF;
    IF v_first IS NULL THEN
      v_first := v_blk;
    ELSIF pg_catalog.md5(v_blk) <> pg_catalog.md5(v_first) THEN
      RAISE EXCEPTION '事後③:public.% 的 supersede 區塊與第一支【不逐字相同】(md5 % vs %)⇒ 有人改了一處漏了其他處。',
        r.fn, pg_catalog.md5(v_blk), pg_catalog.md5(v_first);
    END IF;

    -- ④ 區塊裡的三個承重字面(少任一個 = 條件被改窄/改寬)
    IF pg_catalog.strpos(v_blk, 'superseded_by_card') = 0
       OR pg_catalog.strpos(pg_catalog.regexp_replace(v_blk,'\s+','','g'), 'a.status<>') = 0
       OR pg_catalog.strpos(v_blk, 'failed') = 0
       OR pg_catalog.strpos(v_blk, 'pg_advisory_xact_lock') = 0 THEN
      RAISE EXCEPTION '事後④:public.% 的區塊少了承重字面(superseded_by_card / a.status <> failed / pg_advisory_xact_lock)。', r.fn;
    END IF;

    -- ⑤ 原始 md5 錨
    IF pg_catalog.md5(v_raw) <> r.new_md5 THEN
      RAISE EXCEPTION '事後⑤:public.% 貼完的原始 md5 = %(期望 %)⇒ 貼進去的不是本片這一版。',
        r.fn, pg_catalog.md5(v_raw), r.new_md5;
    END IF;
  END LOOP;

  -- ⑥ 🔵 上面那把 regexp 不是恆真:對一段沒有標記的字串必須抓不到
  IF (pg_catalog.regexp_match('QXNOMARKERSHERE9142', 'SUPERSEDE-BLOCK-BEGIN(.*?)SUPERSEDE-BLOCK-END')) IS NOT NULL THEN
    RAISE EXCEPTION '事後⑥:抽區塊那把 regexp 對一段沒有標記的字串也命中 ⇒ 它在亂報, ③ 的綠是假的。';
  END IF;
  -- 🟢 而它抓得到東西:上面迴圈跑完 v_first 必須非 NULL
  IF v_first IS NULL THEN
    RAISE EXCEPTION '事後⑥b:迴圈跑完而一段區塊都沒抽到 ⇒ 迴圈根本沒進去。';
  END IF;

  RAISE NOTICE '[20260906700000] 事後斷言全數通過(① 多載 · ② 區塊在 · ③ 三段逐字相同 · ④ 承重字面 · ⑤ 原始 md5 · ⑥ 尺的正負對照)。';
END
$post$;

COMMIT;
