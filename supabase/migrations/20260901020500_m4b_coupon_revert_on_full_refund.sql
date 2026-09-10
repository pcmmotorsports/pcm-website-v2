-- ══════════════════════════════════════════════════════════════════════════════
-- 🔴 **貼板順序:本支必須在 `20260901021000` 【之前】**
-- ══════════════════════════════════════════════════════════════════════════════
--   ⟦b4-COUPONREVERT⟧ 券的退回路徑。`20260901021000` 與 `20260901030000` 的第一道
--   前置閘查的就是本支建的這個函式 ⇒ 本支沒貼, 那兩支【誰先誰後都貼不下去】。
--   🛑 版本號 `20260901020500` 落在 `20260901020000` 與 `20260901021000` 之間, 是刻意的:
--      `scripts/coupon-revert-migration-order.test.ts` 守著「定義它的 migration 版本號
--      不得晚於 20260901021000」(該檔 violates() 逐字 `v > GATE_VERSION`)。
--   🔴 **⇒ 它是【插隊到過去】的一支** —— 檔名日期會讓它看起來像最早寫的, 而它是
--      2026-09-11 才寫的。**排貼板順序的人請照本段, 不要照檔名日期排。**
--   ⇒ 實際貼板順序: 本支 → `20260901021000` → `20260901030000`
--
--   🔵 貼了沒:去問 `supabase/APPLIED.tsv` 與正式庫, **不要相信這一段檔頭**。
--      (2026-09-11 實例:`20260908070000` 檔頭逐字寫「草稿。未 apply。」而它已經在正式庫上。
--       📌 檔頭寫得出「未 apply」, 而沒有東西會在它變成 apply 的那一刻回來改它。)
--
-- ── 授權鏈 ────────────────────────────────────────────────────────────────────
--   Sean 2026-09-11 一次拍五題, 經主視窗 `pcm-website-v2-59` 轉述
--   (🛑 **不是我直接從 Sean 收到的**):
--     Q1 誰來呼它    甲 = 掛 `pcm_sync_order_refund_payment_status` 那個匯流點
--     Q2 整筆退判準  甲 = **看金額**
--     Q3 重複退      甲 = **冪等、不可逆**
--     Q4 權限        甲 = SECURITY DEFINER + EXECUTE 只給 `service_role`
--     Q5 取消沒退錢  甲 = **算整筆退, 取消就退券**
--   plan: `docs/plans/2026-09-11-coupon-revert-on-full-refund-plan.md`
--
-- ── 🔴 共用邊界:`manual_failed` ─────────────────────────────────────────────
-- 🔴 本支碰到 `manual_failed` 那個共用邊界。兩支的判準必須【並排讀一次】:
--    · pcm_order_refundable_remaining          ⇒ corrected_to = 'money_moved' 才扣
--    · pcm_order_pending_manual_verdict_amount ⇒ v.refund_id IS NULL 才算
--    🛑 只改一邊 ⇒ 另一邊不會紅, 而畫面會雙重計算或漏算。板列 ⟦b9-REFUNDNUM1⟧。
--
--   🔬 **而我照這道閘要的【讀了一次再抄】** —— 2026-09-11 唯讀對正式庫實查兩支的碼行:
--     pcm_order_refundable_remaining          :12 JOIN(內部)· :14 status='failed'
--                                             :15 failed_reason='manual_failed' · :16 corrected_to='money_moved'
--     pcm_order_pending_manual_verdict_amount : 5 LEFT JOIN · :7 status='failed'
--                                             : 8 failed_reason='manual_failed' · :9 v.refund_id IS NULL
--     ⚪ 負對照 現造函式名 ⇒ 0 支
--   ⇒ 📌 兩支把 `manual_failed` 切成兩半:**已判定錢出去了**(前者扣掉)與**還沒判**(後者算待判)。
--
--   🎯 **而那對本支的意義, 寫死在這裡**:一筆 `manual_failed` 而**還沒被判定**的退款,
--      **不會**從 `pcm_order_refundable_remaining` 扣掉 ⇒ `remaining > 0` ⇒ **本支不退券。**
--      ✅ **那是對的**:錢有沒有真的出去還不知道, 不該先把券的名額還回去。
--      ✅ 而它之後被判成 `money_moved` 時, `admin_correct_*` 會呼匯流點 ⇒ 本支再跑一次
--         ⇒ 那時 `remaining <= 0` ⇒ 才退券。**靠的是本支的冪等, 不是靠誰記得補呼一次。**
--   🛑 **⇒ 所以本支【不可以】改成自己算一份「已退多少」** —— 一旦自己算, 上面這個
--      「還沒判就先不退」的性質會**安靜消失**, 而兩支的邊界只有這一份檔頭在記錄它。
--
-- ── 🔴 本支【只建函式, 不接呼叫端】 ──────────────────────────────────────────
--   接線(誰在什麼時候呼它)是**另一支** migration。刻意分開的理由:
--   本支一貼, `20260901021000` / `20260901030000` 就變成貼得下去, 而那兩支
--   **是讓扣券真的跑起來的東西**。
--   ⚠️ **這一句的理由 2026-09-11 換過, 舊的那個是我量錯的**:
--     ⛔ ~~「接線沒完成之前扣券先上線 = 一段【扣得動而退不了】的視窗期」~~
--        —— 那個視窗期**今天不存在**:全庫**沒有任何東西呼 `redeem_coupon`**
--        (剝掉行註解重量:raw 11 行 ⇒ real **0** 行;🟢 正對照
--         `pcm_order_refundable_remaining` ⇒ real 4 ⇒ 那把尺印得出非零)
--        ⇒ 就算那兩支貼了, 還要有人去接 `create_order` 那一端才會真的扣。
--     ✅ **真正的理由**:那兩支一貼, 扣券就**只差最後一根線** ⇒
--        接線的人若手上沒有退券, 他會在**不知道自己少了什麼**的情況下接上去。
--
-- ── 為什麼它自己判、而不是叫呼叫端判 ────────────────────────────────────────
--   前置閘釘死的簽章只有一個 uuid 參數 ⇒ 呼叫端沒有地方告訴它「這是不是整筆退」。
--   ✅ 而那反而是對的:**判準寫在一個地方**, 呼叫端無條件呼叫即可,
--      少一個「呼叫端自己判而判錯」的洞。
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. 函式 ───────────────────────────────────────────────────────────────────
CREATE FUNCTION public.coupon_revert_on_full_refund(p_order_id pg_catalog.uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
-- 🔴🔴 **`search_path = ''`, 不是 `public, pg_temp`。**
--    把可寫的 schema 排在前面 = SECURITY DEFINER 提權的標準路徑
--    (本 repo 零處 `REVOKE CREATE ON SCHEMA public` ⇒ 任何人都建得出同名函式去劫持它)。
--    ⚠️ 我第一版抄的是 `redeem_coupon`(`20260831160000:113` 寫 `public, pg_temp`)——
--       而**那是舊的那一版**;同族較新的 `coupon_redeem_on_paid`(`20260901021000:470`)
--       寫的就是 `''`。📌 **抄鄰居會抄到鄰居的舊版本**, 而兩個都在 repo 裡。
--    ⇒ ✅ 本函式 body 內的物件一律全名:`public.x` / `pg_catalog.x`。
SET search_path = ''
-- 🔵 與同族一致:鎖等不到就放棄, 不要卡住整條退款交易。
SET lock_timeout = '3s'
AS $fn$
DECLARE
  v_total_remaining bigint;
  v_cancelled_at    pg_catalog.timestamptz;
  v_reverted        integer;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'coupon_revert_on_full_refund:p_order_id 不可為 NULL';
  END IF;

  -- 🔴 那張單在不在。查無 ⇒ 大聲失敗, 不要靜靜回 0
  --    (📌 「這張單沒有券」與「這張單不存在」都會讓 UPDATE 影響 0 列 ——
  --     兩個世界印同一個數字, 所以要在這裡先把它們分開。)
  SELECT o.cancelled_at INTO v_cancelled_at
    FROM public.orders o
   WHERE o.id = p_order_id
   FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'coupon_revert_on_full_refund:訂單 % 不存在', p_order_id;
  END IF;

  -- ── 判準(Q2 甲 = 看金額 · Q5 甲 = 取消就退)──────────────────────────────
  -- 🔴🔴 **刻意重用 `pcm_order_refundable_remaining`, 不自己算一份。**
  --    它是**退款管線自己在用的那一把尺**(orders.total 減掉 processing/confirmed 的卡退、
  --    減掉更正成 money_moved 的 manual_failed、減掉未作廢的人工退款)。
  --    📌 自己再算一份 ⇒ 兩把尺會在某一天分岔, 而分岔的那天沒有東西會叫。
  --    ⇒ ✅ 「整筆退」在券這一側與在退款那一側, 依建構就是同一句話。
  v_total_remaining := public.pcm_order_refundable_remaining(p_order_id);

  -- 🔴 Q5 甲 —— **取消就退券, 不管有沒有退過錢。**
  --
  -- ⚠️⚠️ **這一段的【理由】2026-09-11 訂正過, 而條件本身沒有改。**
  --    ⛔ ~~理由:券是在 `create_order` 建單當下就扣掉的, 不等付款 ⇒ 未付款就取消的單
  --       券已經被扣走而錢從來沒進來過 ⇒ 沒有任何退款函式會被呼到~~
  --    🔴 **那是假的, 而且它是我同一個錯誤前提的【第三個下游】**:
  --       `create_order` **不呼** `redeem_coupon`(剝行註解重量:raw 11 行 ⇒ real 0 行;
  --       🟢 正對照 `pcm_order_refundable_remaining` ⇒ real 4)。
  --    ✅ 而 Sean 2026-08-29 逐字拍過相反的話, 就寫在
  --       `20260829150000_m4b_coupon_p1_tables.sql:7,11`:
  --         「Q『用掉一次』什麼時候算 ⇒ 乙:**付款成功才算**」
  --         「⇒ 片2 落點:寫 redemption 的時機**綁付款成功那一步, 不綁建單**。」
  --       📌 **⇒ 未付款就取消的單【根本沒有 redemption 可退】** —— 那一類單不需要救。
  --
  -- ✅ **而 `OR` 仍然要留, 換一個真的理由**:
  --    **付款成功 ⇒ 扣券 ⇒ 之後取消, 而退款還沒真的執行**的那一段時間裡,
  --    `pcm_order_refundable_remaining` 仍然 > 0(錢還沒退出去), 而單已經取消。
  --    ⇒ 只看金額的話, 那張券要等到有人真的把退款做完才回得來;
  --      而 Sean Q5 甲逐字是「**取消就退券**」⇒ 不等那一步。
  --    🛑 所以這裡是 `OR` 不是 `AND` —— 拿掉它, Q5 甲就沒有被實作。
  IF v_total_remaining > 0 AND v_cancelled_at IS NULL THEN
    -- 部分退、而且沒取消 ⇒ 不退券(Sean 2026-08-29 逐字「只有整筆退才退回券」)。
    RETURN 0;
  END IF;

  -- ── 動作(Q3 甲 = 冪等、不可逆)────────────────────────────────────────────
  -- 🔵 `reverted_at IS NULL` 這個條件本身就是冪等:第二次呼叫影響 0 列, 不覆寫、不報錯。
  -- 🛑 **不刪列** —— 後台券清單 view 的名額口徑是 `WHERE r.reverted_at IS NULL`,
  --    填上這一欄名額就自己回來, **那支 view 一個字都不用改**。
  -- 🔴🔴 **`reverted_by` 刻意【不寫】, 留 NULL** —— 而這一格是我自己差點寫錯的:
  --    第一版我寫 `reverted_by = 'coupon_revert_on_full_refund'`(想記「哪個機制退的」),
  --    而 `coupon_redemptions_reverted_by_fkey` 是 **FOREIGN KEY (reverted_by) REFERENCES
  --    staff(id)** ⇒ 📌 **那個字串不是任何一個員工的 id ⇒ 每一次退券都會違反外鍵而整筆炸掉。**
  --    ⚠️ 而它**不會在 apply 當下叫** —— apply 只建函式, 這一句要等到**真的有人退款**
  --       才第一次執行 ⇒ 🛑 **一個只在正式營運中才會現形的錯誤。**
  --    ✅ 留 NULL 是合法的:`coupon_redemptions_revert_pair` 的 CHECK 是
  --       `(reverted_by IS NULL) OR (reverted_at IS NOT NULL)` ⇒ 只填 `reverted_at` 過得了。
  --    🔵 語意也對:**這不是某個人退的, 是規則退的。** 要記到人得改簽章(而簽章被前置閘釘死)。
  UPDATE public.coupon_redemptions r
     SET reverted_at = pg_catalog.now()
   WHERE r.order_id = p_order_id
     AND r.reverted_at IS NULL;
  GET DIAGNOSTICS v_reverted = ROW_COUNT;

  RETURN v_reverted;
END;
$fn$;

COMMENT ON FUNCTION public.coupon_revert_on_full_refund(pg_catalog.uuid) IS
  '⟦b4-COUPONREVERT⟧ 整筆退款(或訂單取消)之後把該單的券兌換標記為已退回, 名額還回去。'
  '判準:pcm_order_refundable_remaining <= 0 或 orders.cancelled_at IS NOT NULL。'
  '冪等(reverted_at 已有值就不動), 不可逆(沒有 un-revert)。回傳退回的 redemption 列數。'
  '🛑 本函式【不自己決定何時被呼叫】—— 接線在另一支 migration。'
  '🔴 而「名額還回去」【不等於這張單可以再用一次券】:coupon_redemptions_one_per_order 是 '
  'UNIQUE (order_id)【整表的】, 不是「WHERE reverted_at IS NULL」的部分唯一 ⇒ 退回之後 '
  '那個 order_id 的位子仍然被佔著, 這張單永遠不能再兌換第二次。回去的是【那張券的名額】, '
  '不是【這張單的資格】。(與 Sean 2026-09-11 Q3 甲「冪等、不可逆」一致 ⇒ 這是設計不是缺陷。)';

-- ── 2. 權限(Q4 甲)───────────────────────────────────────────────────────────
-- 🔴 新函式出生就帶 PUBLIC EXECUTE ⇒ REVOKE 是必要的, 不是保險。
REVOKE ALL ON FUNCTION public.coupon_revert_on_full_refund(pg_catalog.uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coupon_revert_on_full_refund(pg_catalog.uuid)
  FROM anon, authenticated;
-- 🔴 `REVOKE … FROM PUBLIC` **不會動到具名角色**;而若 default privilege 早就給了
--    `service_role` **WITH GRANT OPTION**, 下面那道普通 GRANT **不會把它降級**
--    ⇒ 先收乾淨再重發。(形狀抄 `20260831160000:405-418`, 那是 codex R2 must-fix 的結果。)
REVOKE ALL ON FUNCTION public.coupon_revert_on_full_refund(pg_catalog.uuid)
  FROM service_role;
GRANT EXECUTE ON FUNCTION public.coupon_revert_on_full_refund(pg_catalog.uuid) TO service_role;

-- ── 3. apply 當下的自檢(fail-closed)────────────────────────────────────────
-- 🔴🔴 **問「ACL 現在長什麼樣」, 不問「有沒有出錯」。**
--    ⟦tidy-NETPUBLICALL⟧ 2026-09-11 實測:一支 REVOKE 在沒有 GRANT OPTION 的情況下
--    只會印 `WARNING`, 而 **`WARNING` 不進 rc、`ON_ERROR_STOP` 也擋不住它** ⇒ rc=0 而 ACL 原封不動。
DO $selfcheck$
DECLARE
  -- 🔴 清單不可空:收權斷言【只檢查你列出來的物件】—— 它防「忘記收權」, 不防「忘記列」。
  v_functions text[] := ARRAY['public.coupon_revert_on_full_refund(pg_catalog.uuid)'];
  v_fn        text;
  v_oid       oid;
  v_acl       aclitem[];
  v_grantees  text[];
  v_extra     text[];
BEGIN
  FOREACH v_fn IN ARRAY v_functions LOOP
    v_oid := pg_catalog.to_regprocedure(v_fn);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '券退回 fail-closed:% 沒建成', v_fn;
    END IF;

    SELECT p.proacl INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
    IF v_acl IS NULL THEN
      -- ACL 是 NULL = 走預設 = **PUBLIC 看得見** ⇒ 那正是上面 REVOKE 要關掉的狀態。
      RAISE EXCEPTION '券退回 fail-closed:% 的 proacl 是 NULL(預設 ACL ⇒ PUBLIC 可執行)', v_fn;
    END IF;

    -- 🔴🔴 **`LEFT JOIN` 不是 `JOIN`**:`aclexplode` 給 **PUBLIC 的 grantee 是 oid `0`**,
    --    而 `pg_roles` 裡**沒有 0** ⇒ 內部 JOIN 會把 PUBLIC 那一列**靜靜丟掉**
    --    ⇒ 這把尺就看不到它唯一要防的那一種。(`20260831160000:437-441` 實測過。)
    SELECT coalesce(array_agg(DISTINCT g), ARRAY[]::text[]) INTO v_grantees
      FROM (SELECT (aclexplode(v_acl)).grantee AS gid) x
      LEFT JOIN pg_catalog.pg_roles r ON r.oid = x.gid
      CROSS JOIN LATERAL (SELECT coalesce(r.rolname::text, 'PUBLIC') AS g) y;

    SELECT coalesce(array_agg(gr), ARRAY[]::text[]) INTO v_extra
      FROM unnest(v_grantees) AS gr
     WHERE gr NOT IN ('service_role', (SELECT r2.rolname::text FROM pg_catalog.pg_proc p2
                                         JOIN pg_catalog.pg_roles r2 ON r2.oid = p2.proowner
                                        WHERE p2.oid = v_oid));
    IF array_length(v_extra, 1) IS NOT NULL THEN
      RAISE EXCEPTION '券退回 fail-closed:% 的 EXECUTE 還開給了預期外的角色:%', v_fn, v_extra;
    END IF;

    IF NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION '券退回 fail-closed:service_role 拿不到 % 的 EXECUTE', v_fn;
    END IF;

    -- 🔴 帶 GRANT OPTION 的權限表示持有者可以自己轉發出去 ⇒ 今天的 grantee 集合是對的,
    --    而明天它可以不經過任何 migration 就變。**「現在誰有」與「誰能給別人」是兩個宣稱。**
    IF EXISTS (SELECT 1 FROM (SELECT (aclexplode(v_acl)).*) a WHERE a.is_grantable) THEN
      RAISE EXCEPTION '券退回 fail-closed:% 有人拿到帶 GRANT OPTION 的權限(可自行轉授)', v_fn;
    END IF;

    -- 🔴 ACL 只答【直接授權】:若 anon/authenticated 是 service_role 的成員, 它們照樣執行得了。
    --    **`MEMBER` 不是 `USAGE`** —— `USAGE` 只答「繼承得到」, 而 NOINHERIT 的成員仍可 `SET ROLE`。
    IF pg_catalog.pg_has_role('anon', 'service_role', 'MEMBER')
       OR pg_catalog.pg_has_role('authenticated', 'service_role', 'MEMBER') THEN
      RAISE EXCEPTION '券退回 fail-closed:anon/authenticated 繼承得到 service_role ⇒ 它們執行得了 %', v_fn;
    END IF;
  END LOOP;

  -- 🔴 本支存在的全部理由:那兩支的前置閘查的就是這個簽章。這裡用**同一句話**再問一次。
  IF pg_catalog.to_regprocedure('public.coupon_revert_on_full_refund(pg_catalog.uuid)') IS NULL THEN
    RAISE EXCEPTION '券退回 fail-closed:前置閘要的那個簽章查不到 ⇒ 20260901021000 仍然貼不下去';
  END IF;

  -- 🔴 它必須是 **function 不是 procedure**(前置閘用 to_regprocedure 查, 而 prokind 要 'f')。
  IF (SELECT p.prokind FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.coupon_revert_on_full_refund(pg_catalog.uuid)')) <> 'f' THEN
    RAISE EXCEPTION '券退回 fail-closed:它不是 function(前置閘要 function)';
  END IF;

  -- 🟢 負對照:上面那把尺若對【任何東西】都回同一個答案, 它就沒有判別力。
  IF pg_catalog.to_regprocedure('public.zzq_no_such_fn_20260911(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION '券退回 自檢:負對照命中了一支不該存在的函式 ⇒ 量具可疑';
  END IF;
END $selfcheck$;

COMMIT;
