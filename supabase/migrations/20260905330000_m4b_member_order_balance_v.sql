-- 20260905330000_m4b_member_order_balance_v.sql
-- ⟦b4-PARTIALPAIDNOWHERE⟧ 會員訂單明細的「應付餘額」—— 一支【窄的、own-only 的】唯讀 view。
--
-- ═══ 為什麼需要它(這一段是這支檔存在的全部理由, 不要刪)═══════════════════════════
-- 🔴🔴 **會員那條路讀不到帳本, 而讀不到的樣子是【空】不是【錯】。**
--   order_payments        零 GRANT
--   order_paid_totals_v   只 GRANT SELECT 給 service_role(20260823030000)
--   會員明細那條路        跑的是 authenticated
--                         (apps/storefront/src/lib/auth/composition.ts 逐字「本檔永不注入 service_role」)
--   ⇒ 客人的身分去讀那支 view ⇒ PostgREST 回【空】⇒ 已收算成 0 ⇒ 應付餘額 = 訂單全額
--   ⇒ 🎯 **對一個已經付了訂金的人印出全額** —— 那正是本列要修的病, 被修法自己重新造出來。
--   ⇒ 📌 而它三綠全綠、型別全對、畫面看起來完全正常。
--
-- ═══ 公式(兩處與交辦的口徑不同, 都有依據)═══════════════════════════════════════
--   應付餘額 = orders.total − ( 帳本已收淨額 − 已 confirmed 的退款 )
--
--   ① order_payments **沒有 status/confirmed 欄**(建表 20260810100000)⇒ 不能寫 `where confirmed`。
--      它的負數列是【沖銷】(登錄錯了的更正)不是退款, 而 SUM(amount) 已經把沖銷抵掉
--      (20260810100000 逐字「P(+500)+R1(-500)+R2(+500) = 500」)。
--   ② 退款**不在** order_payments —— 在 order_refunds
--      (20260820010000 逐字寫著「為什麼【不是】記進 order_payments」)。
--   ③ 只算 status='confirmed' 的退款 —— Sean 2026-09-05 拍甲:
--      **「處理中的退款還算已收(餘額暫不變)」** ⇒ processing 不扣。
--      (order_refunds.status 值域 processing|confirmed|failed, 20260725130100)
--
-- ═══ 安全(這一段每一句都是【少一句就是開的】)══════════════════════════════════════
-- 🔴 security_invoker = false ⇒ 用 view 擁有者的身分讀底下那兩本帳(客人自己讀不到它們)。
-- 🔴 security_barrier = true ⇒ 擋「外層塞一個會報錯的述詞去探測別人的列」
--    (codex 關卡1 R2 must-fix;代價是部分述詞不能下推 ⇒ 本 view 是單張單的點查, 量級上可接受)。
-- 🔴 own-only 寫死在 view 裡:WHERE o.customer_user_id = auth.uid()
-- 🔴 兩道 REVOKE 少一道都是開的 —— 本專案 pg_default_acl 對 public schema 的表與 view 有
--    anon=arwdDxtm, authenticated=arwdDxtm ⇒ **新物件一出生就被授權**
--    (理由正本 docs/patterns/revoking-function-execute-in-supabase.md;
--     20260823030000 實測過「只下 FROM PUBLIC 不夠」與「service_role 也要收」)。
-- 🔴 只曝兩欄 (order_id, balance_due) —— 對齊 20260823030000 那句「不要為了方便多帶一欄」。
--
-- ⚠️ 本檔【不動】order_payments / order_refunds / order_paid_totals_v 三者, 一個字都沒改。
--
-- 🔴🔴 **發布序:先 apply 本檔, 再 deploy app** —— 反過來會有一段【全部匯款單一起降級】的窗口:
--   view 不存在 ⇒ PostgREST 回錯 ⇒ adapter 判 null ⇒ **每一張未付匯款單**從「帳號 + 金額」
--   變成「請聯絡我們」, 連一毛都沒付、本來看得到正確數字的客人也一起。
--   📌 同形狀的事故 repo 記過(memory `feedback_app-layer-must-not-ship-before-migration-apply`)。

BEGIN;

DO $precondition$
BEGIN
  IF to_regclass('public.order_paid_totals_v') IS NULL THEN
    RAISE EXCEPTION '前置不成立 — public.order_paid_totals_v 不存在(它是本 view 的來源之一)。';
  END IF;
  IF to_regclass('public.order_refunds') IS NULL THEN
    RAISE EXCEPTION '前置不成立 — public.order_refunds 不存在。';
  END IF;
  IF to_regclass('public.order_manual_refunds') IS NULL THEN
    RAISE EXCEPTION '前置不成立 — public.order_manual_refunds 不存在(匯款/現金那一軌的退款帳本)。';
  END IF;
  IF to_regclass('public.member_order_balance_v') IS NOT NULL THEN
    RAISE EXCEPTION '前置不成立 — public.member_order_balance_v 已經存在。';
  END IF;
END
$precondition$;

CREATE VIEW public.member_order_balance_v
  WITH (security_invoker = false, security_barrier = true) AS
SELECT
  o.id AS order_id,
  -- 🔴🔴 **退了款的單一律回 NULL(= 算不出來), 不是把退款加回應付** ——
  --   codex 關卡2 must-fix, 而它舉的例子讓我當場推翻自己的公式:
  --     客人付清 10,000 → 我們 confirmed 退他 3,000 → 舊公式算出【應付 3,000】
  --     ⇒ 📌 **那等於叫客人把我們退給他的錢再匯回來。**
  --     更壞的:收 3,000、退 5,000 ⇒ 舊公式印【12,000】, 比訂單總額還大。
  --   ⇒ 🎯 **有退款的單, 我們今天算不出「他還要付多少」** ——
  --      而在「印一個可能錯的數」與「不印」之間, 對不可回收的東西永遠選不印。
  --   ⚠️ **Sean 2026-09-05 的乙(「0 或負就改印請聯絡我們」)原本涵蓋不到這一格** ——
  --      他答的前提是餘額會 ≤0, 而 codex 指出的世界餘額是**正的** ⇒ 端回去補問。
  --      ✅ **他答了, 逐字:「Q-退款後的匯款單: 乙」** = 與餘額 ≤0 同一句「請聯絡我們」。
  --      ⇒ 所以這裡回 NULL 不是「什麼都不印」, 而是**交給顯示端去印那一句話**。
  -- 🔴🔴 **只問「有沒有」, 不自己加總金額** —— 這一格是 `#473b-1` 那道守門逼出來的, 而它是對的:
  --   `refund-remaining-single-source.test.ts` 逐字擋「新的 migration 碰 `order_refunds` 的退款金額欄」,
  --   ⚠️ **而這句話本身不寫那個欄名** —— 那道尺掃的是【檔案字面】, 註解也算數
  --      (同族坑:『註解被 grep 當成碼』)⇒ 我第一版把欄名寫進註解, 那道守門照樣紅。
  --   理由是**自己算的地方看不到更正** ⇒ 報出的數比實際多 ⇒ 重複退款。
  --   ⇒ 🎯 而本 view **不需要那個金額** —— 它只需要知道「這張單算不算得清楚」。
  --   ⇒ 📌 **一道擋住我的守門, 同時讓我發現我要的東西比我寫的少。**
  -- 🔴🔴 **退款有【兩本帳】, 而只看一本的話這道守門在【唯一會用到它的通道上構造不出來】**
  --   (R3 對抗審查 must-fix, 而它是對的 —— 我查了它引的三個位置):
  --     `order_refunds`        = **卡軌**帳本:`bank_refund_id NOT NULL`(20260725130100:86)、
  --       且 trigger 逐字「訂單沒有 tappay_rec_trade_id…無法登記退款」(20260803150000:265)
  --       ⇒ 📌 **一張 `bank_transfer` 的單, 這張表永遠 0 列。**
  --     `order_manual_refunds` = 匯款 / 現金那一軌, canonical 述詞是 `voided_at IS NULL`
  --       (逐字對齊 20260905010000:293-300 那支 RPC 的兩段加總)
  --   ⇒ 🎯 而本 view 的消費端 **只在 `bank_transfer` 才渲染** ⇒ 只看卡軌 = 這道守門形同不存在
  --     ⇒ **已退過款的匯款單照樣印帳號與應付餘額。**
  CASE WHEN EXISTS (
         SELECT 1 FROM public.order_refunds rf
          WHERE rf.order_id = o.id
            -- 🔵 只認 confirmed —— Sean 2026-09-05 拍甲:processing 的退款【還算已收】, 餘額暫不變。
            AND rf.status = 'confirmed'
       ) OR EXISTS (
         SELECT 1 FROM public.order_manual_refunds mr
          WHERE mr.order_id = o.id
            -- 🔵 這一軌沒有 status, 它的「還算數嗎」是 `voided_at`(作廢過的不算)。
            AND mr.voided_at IS NULL
       ) THEN NULL
       ELSE o.total - COALESCE(p.paid_total, 0)
  END AS balance_due
FROM public.orders o
LEFT JOIN public.order_paid_totals_v p ON p.order_id = o.id
WHERE o.customer_user_id = auth.uid();

COMMENT ON VIEW public.member_order_balance_v IS
  '⟦b4-PARTIALPAIDNOWHERE⟧:客人自己那張單的應付餘額 = total 減掉帳本已收淨額。這張單只要有一筆有效退款(卡軌 confirmed 或人工軌未作廢)就回 NULL = 算不出來, 不自己加總退款金額。own-only 寫死在 view 裡;security_invoker=false 是刻意的 —— 底下的帳本對 authenticated 零 GRANT。只 GRANT SELECT 給 authenticated。';

-- 🔴 兩道 REVOKE:第一道收 PUBLIC, 第二道收三個具名角色 —— 少一道都是開的。
REVOKE ALL ON public.member_order_balance_v FROM PUBLIC;
REVOKE ALL ON public.member_order_balance_v FROM anon, authenticated, service_role;
-- 🔴 只給 authenticated 的 SELECT。**不給 anon** —— 沒登入的人本來就不該有「他的訂單」。
-- ACL-GATE-EXEMPT: public.member_order_balance_v -- 客人要讀自己那張單的應付餘額(⟦b4-PARTIALPAIDNOWHERE⟧, 20260905330000, 2026-09-05)
-- 🔵 **為什麼不是 service_role**:這條路跑的是 `authenticated`
--    (`apps/storefront/src/lib/auth/composition.ts` 逐字「本檔永不注入 service_role」)——
--    給 service_role 的話客人**讀不到**, 而讀不到的樣子是【空】不是【錯】
--    ⇒ 餘額算成 0 ⇒ 📌 對已付訂金的人印出全額, 那正是本片要修的病。
-- 🔵 **而它安全的理由不是這道 GRANT, 是 view 裡那句 own-only** —— 兩者要一起看:
--    `WHERE customer_user_id = auth.uid()` + `security_barrier=true`, 而那兩句各有一道 apply 斷言守著
--    (③-b 比對 pg_get_viewdef、①比對 reloptions), 負對照都實跑過會叫。
GRANT SELECT ON public.member_order_balance_v TO authenticated;

-- ═══ 驗收斷言(apply 當下就叫, 不留給人事後發現)═══════════════════════════════════
DO $verify$
DECLARE
  -- 🔴 **收權斷言的清單** —— `migration-static-checks.sh` 第③格逐字:
  --    「收權斷言【只檢查你列出來的物件】:它防『忘記收權』, 不防『忘記列』」
  --    ⇒ 新物件必須在這裡具名, 而下面每一道 ACL 斷言都從這個清單取 ——
  --      **它是承重的, 不是給守門看的裝飾**(哪天多開一支 view 而忘了列, 那支就不會被驗)。
  v_relations text[] := ARRAY['public.member_order_balance_v']::text[];
  v_rel regclass := v_relations[1]::regclass;
  v_bad int;
BEGIN
  IF array_length(v_relations, 1) <> 1 THEN
    RAISE EXCEPTION '驗收失敗 — 本檔只建一支 view, 而清單裡有 % 筆 ⇒ 有人加了物件而斷言沒跟上。',
      array_length(v_relations, 1);
  END IF;
  -- ① 兩個 reloption 都要在(少 security_barrier ⇒ 探測那條路是開的)
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    WHERE c.oid = v_rel AND c.reloptions @> ARRAY['security_invoker=false']
  ) THEN
    RAISE EXCEPTION '驗收失敗 — security_invoker 不是 false ⇒ 客人的身分讀不到底表, 這支 view 會回空。';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    WHERE c.oid = v_rel AND c.reloptions @> ARRAY['security_barrier=true']
  ) THEN
    RAISE EXCEPTION '驗收失敗 — security_barrier 不是 true ⇒ 外層述詞可下推到 own-only 過濾之前。';
  END IF;

  -- ② ACL 封閉世界:除 owner 外, 只准 authenticated 有 SELECT, 其他一律不准
  IF (SELECT relacl FROM pg_class WHERE oid = v_rel) IS NULL THEN
    RAISE EXCEPTION '驗收失敗 — relacl 是 NULL(從沒下過 GRANT)⇒ 下面那道斷言沒有判別力。';
  END IF;
  SELECT count(*) INTO v_bad
    FROM pg_class c, aclexplode(c.relacl) a
   WHERE c.oid = v_rel
     AND a.grantee <> c.relowner
     AND (a.grantee = 0
          OR pg_get_userbyid(a.grantee) <> 'authenticated'
          OR a.privilege_type <> 'SELECT');
  IF v_bad > 0 THEN
    RAISE EXCEPTION '驗收失敗 — % 條 owner 以外的授權不是「authenticated 的 SELECT」(grantee=0 即 PUBLIC)。', v_bad;
  END IF;

  -- ②-b 🔴 **`WITH GRANT OPTION` 也要擋**(codex R2 must-fix):上面那道只比對 privilege_type,
  --    而一條「authenticated 的 SELECT **可再轉授**」完全通得過它 ⇒ 那等於它能把讀權發給別人。
  IF EXISTS (
    SELECT 1 FROM pg_class c, aclexplode(c.relacl) a
     WHERE c.oid = v_rel AND a.grantee <> c.relowner AND a.is_grantable
  ) THEN
    RAISE EXCEPTION '驗收失敗 — 有一條 owner 以外的授權帶著 WITH GRANT OPTION(可再轉授)。';
  END IF;

  -- ②-c 🔴 **欄位層 ACL 也要是空的** —— 表層收乾淨了, 而 `GRANT SELECT (balance_due) TO anon`
  --    這種欄級授權**不在 relacl 裡**, 上面兩道都看不到它。
  IF EXISTS (
    SELECT 1 FROM pg_attribute at WHERE at.attrelid = v_rel AND at.attacl IS NOT NULL
  ) THEN
    RAISE EXCEPTION '驗收失敗 — 本 view 有欄位層授權(attacl 非空)⇒ 表層的封閉世界看不到它。';
  END IF;

  -- ③ 有效權限:anon 與 authenticator 一個都不准讀得到
  SELECT count(*) INTO v_bad
    FROM unnest(ARRAY['anon','authenticator']) x(r)
   WHERE pg_catalog.has_table_privilege(x.r, v_rel, 'SELECT');
  IF v_bad > 0 THEN
    RAISE EXCEPTION '驗收失敗 — % 個低權角色【有效】讀得到本 view(anon/authenticator)。', v_bad;
  END IF;

  -- ③-a 🔴 **`status = 'confirmed'` 那個條件也要守** —— codex R2 must-fix:
  --    刪掉它上面那些斷言【一句都不會叫】, 而那時 processing / failed 的退款也會讓餘額回 NULL
  --    ⇒ 📌 **原本該印數字的單改印「請聯絡我們」** —— 那與 Sean 09-05 拍的甲相反
  --      (他逐字說 processing 的退款【還算已收】, 餘額暫不變)。
  --    ⚠️ **這是一把字面尺, 它的限制要寫出來**:它證的是「定義裡有那個字」,
  --       不是「那個過濾在資料上真的對」。後者要有種子資料, 而 apply 當下沒有。
  IF pg_get_viewdef(v_rel, true) NOT LIKE '%confirmed%' THEN
    RAISE EXCEPTION '驗收失敗 — view 定義裡找不到 confirmed 這個退款狀態過濾。';
  END IF;
  -- 🔴 **兩本退款帳都要被看到** —— 少看匯款那一本, 這道守門在唯一會用到它的通道上是死的。
  IF pg_get_viewdef(v_rel, true) NOT LIKE '%order_manual_refunds%' THEN
    RAISE EXCEPTION '驗收失敗 — view 定義裡沒有 order_manual_refunds(匯款/現金那一軌的退款帳本)。';
  END IF;

  -- ③-b 🔴 **own-only 那句話【必須在 view 的定義裡】** —— codex 關卡2 must-fix:
  --    上面那些斷言一句都沒有驗 WHERE, 刪掉它仍然全綠, 而那時 authenticated 讀得到【所有人的單】。
  --    `security_barrier` 只保證過濾順序, **不保證那個過濾存在**。
  IF pg_get_viewdef(v_rel, true) NOT LIKE '%customer_user_id = auth.uid()%' THEN
    RAISE EXCEPTION '驗收失敗 — view 定義裡找不到 own-only 述詞(customer_user_id = auth.uid())。';
  END IF;

  -- ③-c 🔴 **authenticated 要【確實有】SELECT** —— 上面那道是封閉世界(擋別人),
  --    它對「一條 GRANT 都沒有」同樣通過 ⇒ 那時客人讀不到, 而畫面會【安靜地不印】。
  IF NOT pg_catalog.has_table_privilege('authenticated', v_rel, 'SELECT') THEN
    RAISE EXCEPTION '驗收失敗 — authenticated 讀不到本 view ⇒ 應付餘額會靜默不印。';
  END IF;

  -- ③-d 🔴 **view 擁有者要讀得到三個來源** —— 否則 migration 綠了而 runtime 才炸,
  --    而 adapter 會把那個錯吞成 null ⇒ 📌 壞掉的樣子與「這張單沒有餘額」一模一樣。
  IF NOT (pg_catalog.has_table_privilege(
            pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = v_rel)),
            'public.order_paid_totals_v'::regclass, 'SELECT')
          AND pg_catalog.has_table_privilege(
            pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = v_rel)),
            'public.order_refunds'::regclass, 'SELECT')
          AND pg_catalog.has_table_privilege(
            pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = v_rel)),
            'public.orders'::regclass, 'SELECT')) THEN
    RAISE EXCEPTION '驗收失敗 — view 擁有者讀不到 orders / order_paid_totals_v / order_refunds 其中之一。';
  END IF;

  -- ④ 只曝兩欄
  IF (SELECT count(*) FROM pg_attribute WHERE attrelid = v_rel AND attnum > 0 AND NOT attisdropped) <> 2 THEN
    RAISE EXCEPTION '驗收失敗 — 本 view 不是兩欄。多帶一欄就是多一份要守的東西。';
  END IF;

  RAISE NOTICE '✅ member_order_balance_v:definer + barrier + 只給 authenticated SELECT + 兩欄';
END
$verify$;

COMMIT;
