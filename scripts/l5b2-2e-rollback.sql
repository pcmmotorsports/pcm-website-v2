-- ============================================================
-- L5b-2 片 2e 回退:close_released_attempt 還原到 2e 之前的 pre-image
-- 標的 = supabase/migrations/20260812160000_m4b_lifecycle_l5b2_2e_close_advisory.sql
-- plan  = docs/specs/2026-08-12-l5b2-2e-close-advisory-plan.md(v2)§6
--
-- 🔴🔴 **本檔必須整支單一交易跑,禁止只抄座標逐句手跑。**
--    用法:psql "$URL" -v ON_ERROR_STOP=1 -f scripts/l5b2-2e-rollback.sql
--    理由(母 plan :719-724 已實測,不是顧慮):本 repo 舊慣例是「檔尾座標 + 逆序手動執行」=
--    `psql -f` 逐句 autocommit、無 ON_ERROR_STOP ⇒ `DO … RAISE` 之後**後續每一句照跑**,
--    下面兩道閘等於被滾過去。實測(PG17.10):同樣兩句散跑 ⇒ 後句成功(靶表 1 列);
--    包成單一交易 ⇒ 後句死於 `current transaction is aborted` (靶表 0 列)。
--
-- 🔴 還原來源是**兩個不同的檔**(v1 曾寫成同一個檔,是沖銷片 codex RB-1 的同族):
--    · 本體    = supabase/migrations/20260624120010_m3_3ds_r1c3_close_released_attempt.sql:70-136
--                ✅ 機械驗過:`{ printf '\n'; sed -n '71,135p' <檔>; }` 的 md5
--                   = fa8afcc2bf0f3c683e156a719fea80f0 = 回退前正式庫 prosrc,2891 字元逐字相符
--    · COMMENT = supabase/migrations/20260804120000_m4b_e10_a8c1_begin_cancel_guard.sql:215
--                (A8c1 **只重寫 COMMENT、沒動本體** ⇒ 拿 20260624120010 的 COMMENT 會還原到錯的世代)
--
-- ⚠️ 本檔**只還原函式**。2e 沒有建立任何表/索引/約束 ⇒ 無其他物件要撤。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL transaction_timeout = '90s';

-- ── 閘①:成組回退(母 plan :718)──────────────────────────────────────────
--    2e/2f/2g 是同一個 apply 批次。**只撤 2e 而 2g 的補償 writer 還在庫 = 只有一方排隊
--    = 比不做更危險**(它會讓人以為已經擋住了)。
--    判準用「有沒有函式在寫 payment_refunds」而不是 2g 的函式名 —— 寫這支時 2g 尚未實作、沒有名字,
--    而「誰在寫這張表」才是真正要問的事(形制同母 plan §5-12 的第四方硬閘)。
--    ⚠️ 誠實射程(R1 must-fix 1 修正後的**實際**射程,逐條列):
--       ✅ 涵蓋:①**顯式函式名單**(見下 (i),2g 必填)②public **函式與 procedure**(prokind f/p)
--          本體(**先剝 `--` 註解**)裡的 `INSERT|MERGE INTO [ONLY] [["]public["].]["]payment_refunds["]`;
--          `INSERT … ON CONFLICT DO UPDATE` 因含 INSERT INTO 而**一併涵蓋**。
--       ❌ 不涵蓋:①只做 `UPDATE public.payment_refunds` 而不新增列的函式(2g 是**新增**補償退款,
--          故不納入判準;納入會讓一般維護函式把回退卡死)②動態 SQL(`EXECUTE format(...)`)
--          ③owner 在 psql 直接 DML ④其他 schema 的函式 ⑤把關鍵字拆開的寫法
--          (`INSERT /* c */ INTO`、字串常值裡的假命中反過來會誤擋)。
--       ⇒ 它降低機率、**不是不變量**。閘①是 fail-closed 方向:誤擋只會要求人工判斷,不會放行。
--
-- 🔴🔴 **R2 codex must-fix 2:文字掃描永遠補不完 ⇒ 加了一個「不是啟發式」的那一半。**
--    v3 只有正規式,實測仍會靜默放行 `INSERT INTO ONLY public.payment_refunds`、
--    quoted identifier `"payment_refunds"`、`public . payment_refunds`(關鍵字間插空白)等形狀。
--    v4 做兩件:
--      (a) 正規式吸收 `ONLY` / 可選雙引號 / 點號兩側空白(這幾種便宜、直接補);
--      (b) 🔴 **加一份顯式函式名單**(下方 `p.proname = ANY (ARRAY[...])`,目前空陣列)——
--          **2g 實作時必須把自己的函式名填進去**,那才是真正的不變量。
--          ⇒ 這條是**寫給 2g 作者的前置義務**,同時寫進 plan §6;正規式只是它沒被履行時的網子。
--       (v1 只掃 prokind='f' + 逐字 `INSERT INTO public.payment_refunds`,PROCEDURE 與未
--        schema-qualified 兩形會**靜默放行**=放行本檔自陳「比不回退更危險」的狀態。)
-- ── 閘②:不對著陌生版本回退 ────────────────────────────────────────────────
DO $gate_2e$
DECLARE
  v_writers text;
  v_md5     text;
BEGIN
  SELECT pg_catalog.string_agg(n.nspname || '.' || p.proname, ', ' ORDER BY p.proname)
    INTO v_writers
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
     AND (
          -- (i) 顯式名單:2g(以及任何後續補償 writer)實作時**必須把自己的函式名加進來**。
          --     這是唯一「不是啟發式」的那一半 —— 文字掃描永遠補不完(見下 R2 MF2)。
          p.proname = ANY (ARRAY[]::text[])
          -- (ii) 啟發式文字掃描:先剝 `--` 註解再比(否則註解裡提到這張表就誤擋=回退卡死)
          OR pg_catalog.regexp_replace(p.prosrc, '--[^' || pg_catalog.chr(10) || ']*', '', 'g')
             ~* '(INSERT|MERGE)[[:space:]]+INTO[[:space:]]+(ONLY[[:space:]]+)?("?public"?[[:space:]]*\.[[:space:]]*)?"?payment_refunds"?([^a-zA-Z0-9_"]|$)'
         );
  --  🔴 詞尾邊界寫成顯式的 `([^a-zA-Z0-9_"]|$)`,**不用 `\y`**:v3 用 `\y`,但加了可選雙引號之後
  --     `\y` 會被引號本身滿足 ⇒ 邊界失效。自己寫字元類才擋得住 `payment_refunds_archive`。
  --  **實測消融**(PG17.10,五支假函式 ab_f / ab_p / ab_u / ab_m / ab_arch):
  --       · v1(prokind='f' + 逐字 public.)命中 = [ab_arch, ab_f] ⇒ **同時有假陰性與假陽性**:
  --         漏掉 PROCEDURE、未 qualified、MERGE 三種真 writer,
  --         卻把寫 `payment_refunds_archive` 的 ab_arch 誤判成 payment_refunds 的 writer。
  --         (假陽性這半 R1 沒點出來,是做消融時量到的:它會把回退路徑永久卡死。)
  --       · v3 命中 = [ab_f, ab_m, ab_p, ab_u] = 四種真 writer 全中、ab_arch 正確排除。
  --       · v3 **拿掉邊界** 命中 = 五支全中 ⇒ 邊界是承重的,不是裝飾。
  --     harness `scripts/l5b2-2e-verify.sh rb` 的 RB2/RB4/RB5/RB6/RB6b/RB6c 六格把這幾形釘住。

  IF v_writers IS NOT NULL THEN
    RAISE EXCEPTION '2e 回退閘①:偵測到 payment_refunds 的寫入函式仍在庫 [%] ⇒ 2g(或後續片)的補償 '
                    'writer 尚未撤。只撤 2e 會變成「只有補償方排隊、close 不排隊」= 沒有互斥,'
                    '比不回退更危險。**先撤 2g,再跑本檔。**', v_writers
      USING ERRCODE = 'P2E20', CONSTRAINT = 'l5b2_2e_rollback_group_blocked';
  END IF;

  SELECT pg_catalog.md5(p.prosrc) INTO v_md5
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'close_released_attempt'
     AND pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_attempt_id uuid, p_resolution text';

  IF NOT FOUND THEN
    RAISE EXCEPTION '2e 回退閘②:找不到 public.close_released_attempt(uuid, text)'
      USING ERRCODE = 'P2E20', CONSTRAINT = 'l5b2_2e_rollback_target_missing';
  END IF;

  -- 只接受兩種起點:2e 的 post-image(正常回退),或**已經是** pre-image(重跑冪等)
  IF v_md5 = 'fa8afcc2bf0f3c683e156a719fea80f0' THEN
    RAISE NOTICE '2e 回退:目前已是 pre-image(md5=fa8afcc2…)⇒ 本檔為冪等重跑,仍會重寫一次本體與 COMMENT。';
  ELSIF v_md5 IS DISTINCT FROM 'f4e3aa5b5afb9e886b0b2820a4c4b34b' THEN
    RAISE EXCEPTION '2e 回退閘②:現況 prosrc md5=% —— 既不是 2e 的 post-image '
                    '(f4e3aa5b5afb9e886b0b2820a4c4b34b)也不是 pre-image(fa8afcc2bf0f3c683e156a719fea80f0)。'
                    '⇒ 有別的片動過這支函式。**停下人工判斷,不要對著陌生版本回退。**', v_md5
      USING ERRCODE = 'P2E20', CONSTRAINT = 'l5b2_2e_rollback_unknown_version';
  END IF;
END
$gate_2e$;


-- ── 還原本體(逐字節 = 20260624120010:70-136;🔴 勿手改)────────────────────
CREATE OR REPLACE FUNCTION public.close_released_attempt(
  p_attempt_id uuid,
  p_resolution text
)
RETURNS jsonb  -- {closed: boolean, idempotent: boolean}(closed 永 true=結案/已結案;非 released/charged/paid/不存在 一律 RAISE)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_actor        text := session_user;                            -- 稽核記 DB session role(非 current_user=function owner;對齊 R1b1b)
  v_status       text;
  v_closed_at    timestamptz;
  v_order_id     uuid;
  v_order_status public.payment_status;
  v_resolution   text := pg_catalog.btrim(COALESCE(p_resolution, ''));  -- 驗證 + 寫入皆用 trim 後正規值(稽核欄整潔)
  v_n            integer;
BEGIN
  -- p_resolution 必填非空(group_chk 要求 released_close_resolution 非 NULL + 操作稽核留痕;自由文字、非 enum)
  IF v_resolution = '' THEN
    RAISE EXCEPTION 'close_released_attempt:p_resolution 必填非空(人工結案理由)';
  END IF;

  -- 鎖 attempt 列讀現態(鎖序 attempt→order、對齊 R1b2;無 order→attempt 反向 = 無死結)
  SELECT a.status, a.released_closed_at, a.order_id
    INTO v_status, v_closed_at, v_order_id
    FROM public.payment_charge_attempts a
   WHERE a.id = p_attempt_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'close_released_attempt:attempt % 不存在', p_attempt_id;
  END IF;

  -- 冪等:已結案(status=failed 且 released_closed_at 非 NULL = 前次 close 終局、唯一寫此欄者 = 本 RPC)
  --   → no-op、保留首次結案三欄不覆蓋(稽核完整性)、回 idempotent
  IF v_status = 'failed' AND v_closed_at IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('closed', true, 'idempotent', true);
  END IF;

  -- 僅 released 可人工結案;pending / charged / 未經 close 的 plain failed 一律拒
  --   (charged 已扣款不可結為 failed;pending 走正常付款流程;plain failed 非 released 終局、無 close 語意)
  IF v_status <> 'released' THEN
    RAISE EXCEPTION 'close_released_attempt:attempt % status=% 非 released、不可 close(僅 released 人工結案)', p_attempt_id, v_status;
  END IF;

  -- order-paid guard(fail-closed):鎖 order、payment_status 必須 unpaid;非 unpaid → RAISE
  --   (released 但 order 已 paid/refunded = 潛在雙扣,走 W1 anomaly + 退款 runbook、不得 close 掩蓋)
  SELECT o.payment_status
    INTO v_order_status
    FROM public.orders o
   WHERE o.id = v_order_id
   FOR UPDATE;
  IF NOT FOUND OR v_order_status <> 'unpaid'::public.payment_status THEN
    RAISE EXCEPTION 'close_released_attempt:order % payment_status 非 unpaid、fail-closed 拒 close(潛在雙扣走 W1 退款)', v_order_id;
  END IF;

  -- 結案:released → failed + closed_* 三欄成組(滿足 R1a1 group_chk 整組非 NULL + status_chk released_closed_at⇒failed)
  --   row 離開 per-order 鎖 partial index(failed 不在 predicate)= 釋放該單對帳鎖位
  UPDATE public.payment_charge_attempts
     SET status                    = 'failed',
         released_closed_at        = pg_catalog.now(),
         released_closed_by        = v_actor,
         released_close_resolution = v_resolution,
         updated_at                = pg_catalog.now()
   WHERE id = p_attempt_id AND status = 'released';

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    -- 持 FOR UPDATE 鎖 + 已驗 released → 理論恆 1;防禦性斷言(任何意外 → fail-closed 回滾)
    RAISE EXCEPTION 'close_released_attempt:結案 UPDATE 影響 % 列(預期 1、attempt %)', v_n, p_attempt_id;
  END IF;

  RETURN pg_catalog.jsonb_build_object('closed', true, 'idempotent', false);
END;
$fn$;


-- ── 還原 COMMENT(逐字節 = 20260804120000:215,**不是** 20260624120010 的那版)────
COMMENT ON FUNCTION public.close_released_attempt(uuid, text) IS
  'M-3 3DS R1c3 owner-only 人工結案(SECDEF、search_path='''')。Sean 取得 TapPay 明確終局(未扣款)後收尾 released attempt:released→failed + 寫 released_closed_at=now()/released_closed_by=session_user/released_close_resolution=p_resolution(三欄成組、滿足 R1a1 group_chk)。order-paid guard fail-closed(order 非 unpaid → RAISE,潛在雙扣走 W1 退款)+ charged/pending/plain-failed 拒(僅 released 可 close)+ 重複 close 冪等(failed+closed_at 非 NULL → no-op、保留首次三欄、{idempotent:true})。🔴 鎖序 attempt→order;E10-A8c1(2026-08-04)起 begin 持 orders 先鎖 ⇒「無反向鎖序 ⇒ 無死結」舊字面(本檔源 migration 檔頭 :24-27)失效——本函式對 begin 只阻塞不死結(同構 mark_failed;實測 scripts/a8c1-verify.sh L3b)。p_resolution 自由文字(非 enum、btrim 非空)。REVOKE 5 角色含 payment_confirmer、無 GRANT = owner/postgres only(Phase 1 受控人工流程)。';


-- ── 後置斷言:真的回到 pre-image ──────────────────────────────────────────
DO $post_rb_2e$
DECLARE
  v_md5     text;
  v_cfg     text;
  v_acl     text;
  v_owner   text;
  v_sec     boolean;
  v_comment text;
BEGIN
  SELECT pg_catalog.md5(p.prosrc),
         COALESCE(pg_catalog.array_to_string(p.proconfig, ' | '), '(NULL)'),
         COALESCE(pg_catalog.array_to_string(p.proacl, ' | '), '(NULL)'),
         pg_catalog.pg_get_userbyid(p.proowner),
         p.prosecdef,
         COALESCE(pg_catalog.obj_description(p.oid, 'pg_proc'), '(NULL)')
    INTO v_md5, v_cfg, v_acl, v_owner, v_sec, v_comment
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'close_released_attempt'
     AND pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_attempt_id uuid, p_resolution text';

  IF v_md5 IS DISTINCT FROM 'fa8afcc2bf0f3c683e156a719fea80f0' THEN
    RAISE EXCEPTION '2e 回退後置:prosrc md5=%(期望 fa8afcc2bf0f3c683e156a719fea80f0)⇒ 本體沒回到 pre-image', v_md5
      USING ERRCODE = 'P2E21', CONSTRAINT = 'l5b2_2e_rollback_body_mismatch';
  END IF;

  -- 🔴 proconfig 必須回到**只剩 search_path="" 一項**:2e 加的 lock_timeout 要跟著消失。
  --    少了這道,回退後會留下「本體是舊的、GUC 是新的」的混種,而 md5 那道看不出來。
  IF v_cfg IS DISTINCT FROM 'search_path=""' THEN
    RAISE EXCEPTION '2e 回退後置:proconfig=[%](期望恰為 [search_path=""];2e 加的 lock_timeout 必須消失)', v_cfg
      USING ERRCODE = 'P2E21', CONSTRAINT = 'l5b2_2e_rollback_proconfig_mismatch';
  END IF;

  IF v_acl IS DISTINCT FROM 'postgres=X/postgres' THEN
    RAISE EXCEPTION '2e 回退後置:proacl=[%](期望 [postgres=X/postgres])', v_acl
      USING ERRCODE = 'P2E21', CONSTRAINT = 'l5b2_2e_rollback_acl_mismatch';
  END IF;

  IF v_owner IS DISTINCT FROM 'postgres' OR NOT COALESCE(v_sec, false) THEN
    RAISE EXCEPTION '2e 回退後置:owner=%、secdef=%(期望 postgres/true)', v_owner, v_sec
      USING ERRCODE = 'P2E21', CONSTRAINT = 'l5b2_2e_rollback_owner_mismatch';
  END IF;

  -- COMMENT 必須是 A8c1 世代:留一個只有那一版才有的字面當指紋,且必須**不含** 2e 新增的段落
  IF pg_catalog.strpos(v_comment, 'E10-A8c1(2026-08-04)起 begin 持 orders 先鎖') = 0 THEN
    RAISE EXCEPTION '2e 回退後置:COMMENT 不是 A8c1 世代(缺其專屬字面)⇒ 還原自錯的來源檔'
      USING ERRCODE = 'P2E21', CONSTRAINT = 'l5b2_2e_rollback_comment_generation';
  END IF;
  IF pg_catalog.strpos(v_comment, 'L5b-2 片 2e') > 0 THEN
    RAISE EXCEPTION '2e 回退後置:COMMENT 仍含 2e 的段落 ⇒ COMMENT 沒被還原'
      USING ERRCODE = 'P2E21', CONSTRAINT = 'l5b2_2e_rollback_comment_stale';
  END IF;

  RAISE NOTICE '2e 回退完成:本體 md5=fa8afcc2…、proconfig 回單項、ACL/owner/secdef/COMMENT 世代全數驗過。';
END
$post_rb_2e$;

COMMIT;
