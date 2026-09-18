-- 20260918040000-rollback.sql —— 退回 20260918040000_m4b_order_payments_comments_fix.sql
-- M-4b · 窗 B(後台, worktree pcm-ops)
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 🛑🛑 **先讀這一段再跑:退回去 = 把【三句已知為假的話】寫回正式庫。**
-- ═══════════════════════════════════════════════════════════════════════════
-- · 「本表由 dormant gate 全擋、**任何列都寫不進來**」⇒ 而它現在有 4 列、5 個 trigger 全啟用
-- · 「**今天零寫入端**」(settled_at)⇒ 而有兩支函式真的在寫它
-- · 「底表 order_payments **零 GRANT**」⇒ 而它有兩個角色各有 SELECT ——
--   🔴 **這一句是【安全論證】** ⇒ 退回去等於把一句會讓人做錯權限判斷的話放回庫裡。
--
-- ✅ **該跑它的世界**:貼錯庫 · 新字面本身打錯字 · 新字面的事實被證明是錯的
--    🔴 而最後那一種**多半該【往前修】不是【往後退】** —— 寫新的一片蓋過去。先問人。
-- ❌ **不該跑的**:「這片看起來沒必要」—— 退掉之後那三張表會重新開始說謊。
--
-- 🔵 **不用先退碼** —— 本片沒有任何碼(④⑤ 那兩句碼註解在 commit `2513ebff1`, 與本片無關、不必一起退)。
--    🔴 **本片自己那一顆** commit 的 hash 由 **follow-up commit** 補在這裡, **不要 `--amend`**
--       (amend 會換掉 hash ⇒ 這裡釘的那一顆就不存在了)。
--       ⛔ ~~原本寫「那一顆」~~ —— 🔴 R2 consider-5:那個指代文法上指回上一句的 `2513ebff1`,
--       **而它的 hash 就印在上一行** ⇒ 讀的人會以為已經有了。要補的是本片自己那一顆。
--    ⇒ 那一顆 = `c4ea6b3c6`(分支 `agent/ops-17-receipt`)。自己核:`git show --stat c4ea6b3c6`
--       ⇒ **2 files changed**:本檔 + 那支 migration。**沒有第三個檔**
--         (閘清冊那份基準是別的窗的落差, 另存一顆;commit 前用 `git diff --cached --name-only` 實看過)。
--       ⚠️ 用 **follow-up commit** 補, **不是 `--amend`** —— amend 會換掉 hash ⇒ 這裡釘的那一顆就不存在了。
--
-- 🔵 `pcm_acl_approve_latest`:退完也不用跑 —— 整支檔零權限語句, `COMMENT ON` 只寫 `pg_description`。
--
-- 🛑 **本片改的三則, 目前沒有別片也在改** —— 若日後有第二片動它們, 那一片要先讀
--    `20260918020000-rollback.sql` / `20260918030000-rollback.sql` 檔頭那段
--    (**共用一則 COMMENT 會靜靜弄死前一片的還原檔**)。

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 1. 前置閘:現在真的是【本片貼上去】的那三則嗎 ────────────────────────────
DO $pre$
DECLARE vA text; vB text; vC text; v_att smallint;
BEGIN
  -- 🔴 R1 N4:正片有這道而本檔沒有 ⇒ 物件被 drop 時拿到的是**裸 PG 錯誤**, 不是這裡寫的話。
  IF pg_catalog.to_regclass('public.order_payments') IS NULL
     OR pg_catalog.to_regclass('public.order_pending_refunds') IS NULL
     OR pg_catalog.to_regclass('public.order_paid_totals_v') IS NULL THEN
    RAISE EXCEPTION '退回前置閘⓪:那三個物件不是都在 ⇒ 停下(不要在一個形狀不對的庫上退)';
  END IF;
  SELECT a.attnum INTO v_att FROM pg_catalog.pg_attribute a
   WHERE a.attrelid='public.order_pending_refunds'::pg_catalog.regclass AND a.attname='settled_at'
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_att IS NULL THEN
    RAISE EXCEPTION '退回前置閘⓪b:order_pending_refunds.settled_at 這一欄不存在(被 drop 或 rename)⇒ 停下';
  END IF;
  vA := pg_catalog.md5(pg_catalog.obj_description('public.order_payments'::pg_catalog.regclass,'pg_class'));
  vB := pg_catalog.md5(pg_catalog.col_description('public.order_pending_refunds'::pg_catalog.regclass, v_att));
  vC := pg_catalog.md5(pg_catalog.obj_description('public.order_paid_totals_v'::pg_catalog.regclass,'pg_class'));

  -- 🔴 三則**各自**要是本片寫上去的那一版 —— 只守一則的話, 另外兩則若被別人正當改過,
  --    退回去會**靜靜蓋掉他的**(板 213 R2 C2 抓過同一個形狀)。
  IF vA IS DISTINCT FROM '5770d6dac1810330840696893d011198' THEN
    IF vA = 'ff2476c8ee366ccd441fc8a481f61dfe' THEN
      RAISE EXCEPTION '退回前置閘A:order_payments 表 COMMENT 已經是貼前那一則 ⇒ 這片沒貼, 或已經被退過 ⇒ 不重複退, 停下。';
    END IF;
    RAISE EXCEPTION '退回前置閘A:order_payments 表 COMMENT(%)不是本片寫的 ⇒ 中間有人改過 ⇒ 退下去會蓋掉他的 ⇒ 拒退', COALESCE(vA,'(沒有 COMMENT)');
  END IF;
  IF vB IS DISTINCT FROM '43fb65d5fe799078d4f8f44ce33346f6' THEN
    RAISE EXCEPTION '退回前置閘B:settled_at 欄 COMMENT(%)不是本片寫的 ⇒ 拒退', COALESCE(vB,'(沒有 COMMENT)');
  END IF;
  IF vC IS DISTINCT FROM '773a49aa09a4f585c2ef1c1377342290' THEN
    RAISE EXCEPTION '退回前置閘C:order_paid_totals_v 的 view COMMENT(%)不是本片寫的 ⇒ 拒退', COALESCE(vC,'(沒有 COMMENT)');
  END IF;
  RAISE NOTICE '✅ 退回前置閘:三則都是 20260918040000 寫上去的那一版 ⇒ 可以退。';
END
$pre$;

-- ── 2. 動作:三則逐字寫回貼之前 ──────────────────────────────────────────────
-- 🔴 下面三段原文是**從正式庫 obj_description / col_description 撈下來的**, 不是從 repo 抄;
--    md5 三顆機器核過 = ff2476c8ee366ccd441fc8a481f61dfe / 47cb57acafafa7c6024018411e77f922 / 3c02b85166773cb17a08acca715e226f。
COMMENT ON TABLE public.order_payments IS 'OP1 收款帳本(master-plan v2 :655 第 3 批第 1 項)。記的是**收款流入 + 對它的沖銷更正**(沖銷列可正可負);🔴 「沖銷列 = 被沖列的反號」是**設計意圖、還不是已生效的保護** —— 那要等 A9 trigger(OP2b);在 OP2b 落地之前,本表由 dormant gate 全擋、任何列都寫不進來。詳見 amount 欄的 COMMENT。**退款不在本表**,照 rail 分流到別的機制(卡=order_refunds/TapPay refund job、匯款=匯款退款線、現金=現金退還登記)。🔴 「已收未退總額」要跨源算,非卡軌的退款帳本目前還不存在 = OP6 的前置。🔴 本表是 A8b partiallyPaid 上限與退款分軌的唯一事實來源。🔴 零 GRANT + RLS zero-policy;寫入一律走具名 SECDEF RPC。RLS 擋不住 service_role(BYPASSRLS)⇒ 真防線是 ACL 與金鑰保密。🔴 跨單餘額 / wallet 體系**明確不碰**(Q-C=A:留抵 = 同單折抵)。';

COMMENT ON COLUMN public.order_pending_refunds.settled_at IS '這筆待退款什麼時候被真的退掉了。🛑 **今天零寫入端** —— 消化那一端等 #787 解封。它現在就存在的理由是【值域要一次定義完】, 不是它壞了。🔴 而寫它的人必須先重算(見 amount_at_cancel 那一欄), 不得直接把 amount_at_cancel 當應退金額。';

COMMENT ON VIEW public.order_paid_totals_v IS '#841:每張訂單的帳本已收淨額(直接加總 amount,沖銷列為負)。security_invoker=false 是刻意的 —— 底表 order_payments 零 GRANT,只有 view 擁有者讀得到。只 GRANT SELECT 給 service_role。';

-- ── 3. 後置斷言 ──────────────────────────────────────────────────────────────
DO $post$
DECLARE v_att smallint;
BEGIN
  SELECT a.attnum INTO v_att FROM pg_catalog.pg_attribute a
   WHERE a.attrelid='public.order_pending_refunds'::pg_catalog.regclass AND a.attname='settled_at'
     AND a.attnum > 0 AND NOT a.attisdropped;   -- 🔵 R2 consider-4:我回報說「兩邊一致」而這一處沒有 ⇒ 補上
  IF pg_catalog.md5(pg_catalog.obj_description('public.order_payments'::pg_catalog.regclass,'pg_class'))
     IS DISTINCT FROM 'ff2476c8ee366ccd441fc8a481f61dfe' THEN
    RAISE EXCEPTION '退回後置閘A:沒有退回貼前那一則 ⇒ 拒 COMMIT';
  END IF;
  IF pg_catalog.md5(pg_catalog.col_description('public.order_pending_refunds'::pg_catalog.regclass, v_att))
     IS DISTINCT FROM '47cb57acafafa7c6024018411e77f922' THEN
    RAISE EXCEPTION '退回後置閘B:沒有退回貼前那一則 ⇒ 拒 COMMIT';
  END IF;
  IF pg_catalog.md5(pg_catalog.obj_description('public.order_paid_totals_v'::pg_catalog.regclass,'pg_class'))
     IS DISTINCT FROM '3c02b85166773cb17a08acca715e226f' THEN
    RAISE EXCEPTION '退回後置閘C:沒有退回貼前那一則 ⇒ 拒 COMMIT';
  END IF;
  RAISE NOTICE '⚠️ 三則都退回貼前了 —— 那三句【已知為假】的話現在又在庫裡, 見本檔頭。';
END
$post$;

COMMIT;
