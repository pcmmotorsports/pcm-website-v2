-- 20260917130000_m4b_order_payments_amount_comment_op2b_landed.sql
-- M-4b · 窗 B(後台, worktree pcm-ops)· Sean 2026-09-17 Q7 拍甲
--
-- ══ 做什麼 ═══════════════════════════════════════════════════════════════════
-- 只改一個東西:`public.order_payments.amount` 的【欄位 COMMENT】。
-- 🟢 **零行為改動** —— 不動資料、不動 CHECK、不動 trigger、不動權限、不動任何函式。
--    `COMMENT ON COLUMN` 只寫 `pg_description`。
--
-- ══ 為什麼 ═══════════════════════════════════════════════════════════════════
-- 那句 COMMENT 逐字寫著:
--   「沖銷列的金額正確性(反號)與環的防護要等 A9 trigger(OP2b)——
--     **在 OP2b 落地前, 本表由 dormant gate 全擋、任何列都寫不進來**」
-- 而 **OP2b 已經落地了**, 本表也一直在寫。⇒ 這句話今天是假的。
--
-- 🔬 2026-09-17 唯讀正式庫實查(不是讀 repo):
--   · 本表五個 trigger 全部 `tgenabled='O'`(啟用):
--     pcm_op2b_reversal_amount · pcm_op2b_immutable_columns · pcm_op2b_no_delete ·
--     pcm_op2_received_at_not_future · pcm_noncard_settle_after_payment
--   · `pcm_op2b_reversal_amount` 的本體(pg_get_functiondef)確實在守反號:
--       查不到被沖列 ⇒ ERRCODE P2B32(指向自己也走這條 ⇒ 兼擋自環)
--       NEW.amount IS DISTINCT FROM -被沖列金額 ⇒ ERRCODE P2B33
--   · 三種 rail 都有真實列寫進來:card / cash / bank_transfer, 最近一筆 2026-09-16
--     ⇒ 「dormant gate 全擋、任何列都寫不進來」與事實相反。
--
-- 🔴 **為什麼值得為一句註解開一支板**:那句話會讓下一個人以為
--    「沖銷金額沒有人在守」而去重造一道, 或以為這張表是死的而不敢用它。
--    而 `⇒ 「已收」= SUM(amount)` 這一句正住在同一段裡 —— 它是別片要引用的定義。
--
-- 🛑 **我【不】把「反號已經受保護」寫成無條件的保證**:欄位 CHECK
--    (`order_payments_reversal_shape`)本身一個字都沒變, 它仍然只保證
--    「收款列恆正、沖銷列 <> 0」。反號是 **trigger** 在守, 不是 CHECK 在守。
--    新字面把這兩道分開講清楚, 不要讓下一個人以為 CHECK 升級了。
--
-- ══ 影響 / 錯了會怎樣 ════════════════════════════════════════════════════════
-- 改壞了最壞的情況 = 一句話寫錯, **沒有任何行為會變**。
-- 鎖:`COMMENT ON COLUMN` 不拿 ACCESS EXCLUSIVE(本檔仍照慣例設 lock_timeout)。
-- 部署時序:🟢 無空窗 —— 沒有新物件、沒有簽章變動 ⇒ 板先貼或碼先推都可以(本片沒有碼)。
--
-- ══ 還原 ═════════════════════════════════════════════════════════════════════
-- `supabase/rollbacks/20260917130000-rollback.sql`
-- 🔴 那支嵌的是【貼之前】從正式庫 `col_description` 撈下來的原文(md5 對過),**不是從 repo 抄的**。

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 1. 前置閘 ────────────────────────────────────────────────────────────────
DO $pre$
DECLARE v_md5 text;
BEGIN
  IF to_regclass('public.order_payments') IS NULL THEN
    RAISE EXCEPTION '前置閘①:public.order_payments 不存在 ⇒ 這個庫不是我以為的那個 ⇒ 停下';
  END IF;

  SELECT md5(col_description('public.order_payments'::regclass, a.attnum))
    INTO v_md5
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.order_payments'::regclass AND a.attname = 'amount';

  -- 🔴 比【現值的 md5】, 不比「有沒有值」—— 後者對「別人已經改成另一句」恆真。
  IF v_md5 IS DISTINCT FROM 'da43a149e697091c7a89fbbfa574d94d' THEN
    RAISE EXCEPTION '前置閘②:amount 欄現在的 COMMENT md5 是 %, 不是我寫這一片時看到的 da43a149e697091c7a89fbbfa574d94d ⇒ 正式庫已經變了(有人先改過, 或我拿的是舊資訊)⇒ 拒繼續。',
                    COALESCE(v_md5, '(沒有 COMMENT)');
  END IF;

  -- 🔵 前置閘③ 正對照:確認我要更正的那句【真的在裡面】。
  --    少了這一條, 上面的 md5 相等也可能是我把 md5 抄錯而剛好撞上另一句。
  IF position('dormant gate' IN col_description('public.order_payments'::regclass,
       (SELECT attnum FROM pg_catalog.pg_attribute
         WHERE attrelid='public.order_payments'::regclass AND attname='amount'))) = 0 THEN
    RAISE EXCEPTION '前置閘③:現行 COMMENT 裡找不到 dormant gate 那句 ⇒ 我要改的東西不在這裡 ⇒ 拒繼續';
  END IF;

  RAISE NOTICE '✅ 前置閘:amount 欄 COMMENT 就是我寫這一片時看到的那一句(md5 %)', v_md5;
END
$pre$;

-- ── 2. 動作(本片唯一會改變資料庫的一句) ───────────────────────────────────
COMMENT ON COLUMN public.order_payments.amount IS '整數元、非零。收款列恆正;沖銷列 = 被沖列金額的反號(可正可負,必帶 reverses_payment_id)。🟢 沖銷金額的反號【已經有 trigger 在守】(2026-09-17 唯讀正式庫實查):pcm_op2b_reversal_amount(BEFORE INSERT,WHEN reverses_payment_id IS NOT NULL)—— 查不到被沖列 ⇒ P2B32(指向自己也走這條,兼擋自環);NEW.amount IS DISTINCT FROM -被沖列金額 ⇒ P2B33。⛔ 舊字面「沖銷分支的 <> 0 與欄位 CHECK 同界、等於沒守…要等 A9 trigger(OP2b)——在 OP2b 落地前,本表由 dormant gate 全擋、任何列都寫不進來」已過期:OP2b 已落地(本表五個 trigger 全 tgenabled=''O''),而且 card / cash / bank_transfer 三種 rail 都有真實列寫進來(最近一筆 2026-09-16)。🛑 而欄位 CHECK 本身【沒變】:order_payments_reversal_shape 仍只保證「收款列恆正、沖銷列 <> 0」—— 反號是 trigger 在守,不是 CHECK 在守,兩者不要讀成同一道。⇒ 「已收」= SUM(amount)。🔴 退款不在本表(照 rail 分流到別的機制);沖銷 ≠ 退款,沖銷是登錄錯誤的更正。';

-- ── 3. 後置斷言 + 負對照 ─────────────────────────────────────────────────────
-- 🔴🔴 **這一段我第一版寫錯了, 而且是【在拋棄式 PG 上真的跑過】才發現的**(2026-09-17)。
-- ```
-- ⛔ 我第一版寫:IF position('dormant gate' IN v_new) <> 0 THEN RAISE …
--    意思是「舊那句不見了才算成功」。而【新字面裡照樣有那五個字】——
--    因為本 repo 的慣例是**舊字面留刪除線不刪**, 我把舊句原樣引在 ⛔ 後面。
--    ⇒ 貼下去當場紅在後置閘①, 整筆回滾。
-- ```
-- 📌 **這與 `pcm_order_refundable_remaining` 檔頭記的是同一個形狀**:
--    「整包字串當比對對象時, 被引用的舊字面與真正生效的新字面在裡面是同一種東西。」
--    那支的結論是「要寫說明就寫在本體外面」;而 COMMENT **整個就是說明, 沒有外面**
--    ⇒ 所以這裡改用【釘死新字面的 md5】, 不用子字串。
DO $post$
DECLARE v_new text; v_md5 text; v_attnum smallint;
BEGIN
  SELECT a.attnum INTO v_attnum FROM pg_catalog.pg_attribute a
   WHERE a.attrelid='public.order_payments'::regclass AND a.attname='amount';
  v_new := col_description('public.order_payments'::regclass, v_attnum);
  v_md5 := md5(v_new);

  -- ① 該變的變了, 而且【精確變成我打算的那一句】(釘 md5, 不用子字串)
  IF v_md5 IS DISTINCT FROM '83193f5fc7eab104b1abc5dd26139186' THEN
    RAISE EXCEPTION '後置閘①:換上去的 COMMENT md5 是 %, 不是本片打算寫的 83193f5fc7eab104b1abc5dd26139186 ⇒ 拒 COMMIT', v_md5;
  END IF;

  -- ② 兩句【承重的】定義沒有被我順手弄丟 —— 別片會引用它們。
  --    🔵 有了①之後這兩條在數學上是多餘的, **刻意留著**:
  --       它們是「我打算保留什麼」的可讀宣告, 而且若哪天有人改了字面又順手改了 ①的 md5,
  --       這兩條仍會叫。(①防手滑, ②③防「改對了 md5 卻改錯了意思」。)
  IF position('SUM(amount)' IN v_new) = 0 THEN
    RAISE EXCEPTION '後置閘②:新字面裡沒有「已收 = SUM(amount)」⇒ 弄丟了一句別片在引用的定義 ⇒ 拒 COMMIT';
  END IF;
  IF position('退款不在本表' IN v_new) = 0 THEN
    RAISE EXCEPTION '後置閘③:新字面裡沒有「退款不在本表」⇒ 同上 ⇒ 拒 COMMIT';
  END IF;

  -- ③ 🔵 負對照:同一張表【其他三個有 COMMENT 的欄】必須一個字都沒變。
  --    📌 少了這一條, 「把全表 COMMENT 清光再寫上這一句」也會讓①過 ——
  --       而那正是【改壞了】的樣子。①單獨為真證明不了改對。
  IF md5(col_description('public.order_payments'::regclass, (SELECT attnum FROM pg_catalog.pg_attribute
       WHERE attrelid='public.order_payments'::regclass AND attname='rail'))) <> '598f9333a718e75cf54c4b2d69439117' THEN
    RAISE EXCEPTION '🔴 負對照失敗:同一張表的 % 欄 COMMENT 也變了 ⇒ 本片動到了不該動的東西(或有人同時在改這張表)⇒ 拒 COMMIT', 'rail';
  END IF;
  IF md5(col_description('public.order_payments'::regclass, (SELECT attnum FROM pg_catalog.pg_attribute
       WHERE attrelid='public.order_payments'::regclass AND attname='received_at'))) <> 'f41621dd5a2fd5a65a6da377ea880eec' THEN
    RAISE EXCEPTION '🔴 負對照失敗:同一張表的 % 欄 COMMENT 也變了 ⇒ 本片動到了不該動的東西(或有人同時在改這張表)⇒ 拒 COMMIT', 'received_at';
  END IF;
  IF md5(col_description('public.order_payments'::regclass, (SELECT attnum FROM pg_catalog.pg_attribute
       WHERE attrelid='public.order_payments'::regclass AND attname='actor'))) <> '6a26d037c742e730345f10a63e696a37' THEN
    RAISE EXCEPTION '🔴 負對照失敗:同一張表的 % 欄 COMMENT 也變了 ⇒ 本片動到了不該動的東西(或有人同時在改這張表)⇒ 拒 COMMIT', 'actor';
  END IF;

  RAISE NOTICE '✅ 後置閘 + 負對照全過(新字面 md5 %)', v_md5;
END
$post$;

COMMIT;
