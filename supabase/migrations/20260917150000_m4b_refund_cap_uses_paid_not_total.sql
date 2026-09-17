-- 20260917150000_m4b_refund_cap_uses_paid_not_total.sql
-- M-4b · 窗 B(後台, worktree pcm-ops)· Sean 2026-09-17 Q3 拍甲(改用已收)+ 「繼續把待辦排下去」
-- plan:docs/plans/2026-09-17-refund-cap-uses-paid-not-total-plan.md
--
-- 🔴 本支碰到 `manual_failed` 那個共用邊界。兩支的判準必須【並排讀一次】:
--    · pcm_order_refundable_remaining          ⇒ corrected_to = 'money_moved' 才扣
--    · pcm_order_pending_manual_verdict_amount ⇒ v.refund_id IS NULL 才算
--    🛑 只改一邊 ⇒ 另一邊不會紅, 而畫面會雙重計算或漏算。板列 ⟦b9-REFUNDNUM1⟧。
--    🔵 (本閘認的就是【⟦b9-REFUNDNUM1⟧ 這個錨】—— 而它在這裡不是裝飾, 是機器讀的那個字。)
--
-- 🔵 **我照它說的「讀一次再抄」做了 —— 對正式庫撈兩支並排看過**(2026-09-17):
--    後半句那支的本體逐字是
--      `LEFT JOIN public.order_refund_effective_verdict v ON v.refund_id = r.id
--        WHERE … AND r.status='failed' AND r.failed_reason='manual_failed' AND v.refund_id IS NULL`
--    ⇒ 兩支把同一批 `manual_failed` 列**切成互斥兩半**:判過且判成 money_moved 的歸主數字扣,
--      還沒判的歸後半句算。
--    ✅ **而本片一個字都沒動那一段** —— 只換了第一項(應收 ⇒ 已收)。
--      ⇒ 這個切分維持原樣, 不會雙重計算也不會漏算。
--      📌 寫出來不是為了過閘, 是因為下一個改這支的人**可能會動到那一段**, 而那時它就會壞。

-- ══ 做什麼 ═══════════════════════════════════════════════════════════════════
-- `pcm_order_refundable_remaining` 的**第一項**從「訂單原總額」改成「已收」。
-- 後面三段「已退」**逐字沿用, 一個字都沒動**。簽章 / 回傳型別 / STABLE / SECURITY DEFINER
-- / `SET search_path TO ''` / 權限 全部不變。
--
-- ══ 為什麼 ═══════════════════════════════════════════════════════════════════
-- 退款的天花板是【我們實際收到多少】, 不是【當初要收多少】。
-- 🔬 2026-09-17 正式庫實查:**6 張客人一毛錢都沒付的取消單, 上限仍是全額**
--    (13,800 / 5,400 / 1,050 / 1,000 / 100 / 10, 合計 21,360)。
-- 🛑 **而沒有人退超過** —— 全庫逐筆比對「已退 vs 已收」= 0 筆。
--    ⇒ 這是一道擋不住的閘, **不是事故**。兩句不要合併成「正在超退」。
--
-- 🔴🔴 **不可以改成「取消後的有效總額」** —— 那會【擋掉合法退款】, 而且有真單為證:
--    庫裡那張 total=1 / 已收=1 / 已退=1 的取消單 —— 客人付了錢、單取消、錢退回去了, 整條路都對。
--    改成有效總額 ⇒ 整單取消 ⇒ 有效總額 0 ⇒ cap 0 ⇒ **那筆已經發生而且正確的退款會被擋下**。
--    📌 判別句:**取消讓客人少欠我們錢, 不是讓我們少欠客人錢。**
-- 🔵 順帶修好「多收退不掉」:溢付時已收 > 原總額 ⇒ 那多收的部分現在退得掉(舊制擋掉)。
--    ⚠️ **與訂金那格同級:正式庫此刻 `paid > total` 的單 0 筆**(實查)⇒ 這個好處是
--       **拋棄式庫上構造出來的,不是真資料驗的** ⇒ 一樣標「吻合但未證實」,不要讀成已兌現。
--
-- ══ 影響 ═════════════════════════════════════════════════════════════════════
-- 🛑🛑 **本片【不可以單獨貼】** —— adversarial-reviewer 2026-09-17 R1 抓到一顆 BLOCKER,
--    見下面〈🔴 未解決〉。在 Sean 裁定之前這支不要進正式庫。
--
-- **DB 端真正的呼叫端是 3 支**(不是 6 支):
--   `pcm_order_refund_cap_guard`(`v_cap := …`)
--   `admin_record_manual_refund`(步5 `v_remaining := …`)
--   `admin_correct_backfilled_refund`(`SELECT … INTO v_remaining`,用法是
--      `IF p_new_amount > v_remaining + v_amount` ⇒ **只比大小、不推導已退** ⇒ 算式仍正確)
--      🔴 **而「算式仍正確」不是全部**(R2 S4):那道 P7C34 展開後是
--         `p_new_amount > 已收 − 其他已退`,舊制是 `原總額 − 其他已退`
--         ⇒ **在未付款 / 訂金單上這道閘會更容易打到**(更正補登退款金額時被擋)。
--      ⚠️ 而 `20260907050000:155-166` 自己說 P7C34 是**過渡**,且 Sean 2026-09-07 q33 甲
--         拍過相反的語意(「補登金額超過可退餘額 ⇒ **記下來並標異常, 而不是擋**
--         —— 錢外面已經動了, 擋 = 從帳上消失」)。⇒ 本片把那道過渡閘**收緊了**。
--      🛑 **本片不放寬它** —— 放寬就是該檔自己說的「開一個沒有 incident 接住的洞」;
--         寫在這裡是讓片 C(記+incident)上線的人知道這一段動過。
-- ⛔ ~~另外兩支 `coupon_revert_on_full_refund` / `pcm_d3d_manual_refund_immutable`~~ —— **不是呼叫端**:
--    前者那 4 行全是註解(而且逐字是「不要改用它」),後者那一行在 RAISE 的訊息字串裡。
--    🔴 **我第一版用 `prosrc LIKE` 掃出「6 支」而信了它** —— 那正是本檔 `:71-73` 自己引用的那個坑
--       (`prosrc` 含註解 ⇒ 註解與 code 在裡面是同一種東西)。**我寫下那句警告,然後踩了它。**
-- 🔴 而真正的漏在另一頭:**那份清單只掃了 DB,沒掃 app** —— 唯一會出事的消費者在 app。
--
-- 🔴 「查無此單 ⇒ 回 NULL」的行為**必須保留**:`cap_guard` 靠它分流 PCM05、
--    `admin_record_manual_refund` 步5 靠它分流 fail-closed。後置閘④ 專門守這一格。
--
-- ══ 🟢 R1 那顆 BLOCKER 已解決(2026-09-17)═══════════════════════════════════
-- R1 抓到:後台 `payment-list-view.ts` 用**相減**推導「已退」= `第一個參數 − 這支 RPC`,
-- 而四個呼叫端一律傳 `orders.total` ⇒ 換口徑後 `T−(P−R) = T−P+R`
-- ⇒ 每一張未付款 / 只收訂金的單都會印「已退 <原總額>」。
-- ✅ **已修**(Sean 拍甲:板與碼是同一次動作):那支函式的第一個參數從 `orderTotal: number`
--    換成 `paymentRows: readonly OrderPaymentRow[] | null`,內部 `sumReceived(rows) − RPC`,
--    四個呼叫端改傳 `payments.status === 'ok' ? payments.rows : null`。
--    🔑 **刻意連型別一起換** —— 原本四處傳的型別同為 `number`,只換語意的話漏改一處
--       沒有任何東西會叫;換型別之後漏改 = typecheck 當場紅。
--
-- 🛑 **本片仍然【不可以單獨貼】** —— 那句話還是真的,但理由變了:
--    不是「等裁定」,是**板與碼要一起上**(順序見下面〈部署順序〉)。
--
-- ══ 🔴 部署順序(等 Sean 拍;R2 判這一題要他看過)══════════════════════════════
-- 兩個方向都有空窗,而**代價不對稱**(R2 實算四種單):
--   板先貼(舊碼+新 RPC):未付款單印「已退 13,800」⇒ **憑空的數字**
--   碼先推(新碼+舊 RPC):未付款單算出負數 ⇒ 印「未知」⇒ **誠實的 fail-closed**
--                        (只有溢付單會高估,而正式庫此刻溢付 0 筆 —— 實查)
-- ⇒ R2 建議**碼先推、板隨後貼**。
-- ⚠️ 而 CLAUDE.md〈Git〉那條「程式要用到的 DB 變更 ⇒ 板先貼」**在這裡不適用**:
--    它的原文是「還沒套用的 DB 變更」且配套閘只擋**新函式 / 新 view**;
--    本片**沒有新物件**,兩個方向都叫得動,差別只在答案對不對。
--    真正命中的是同段那條「改既有函式兩個方向都有空窗 ⇒ 當成同一次動作、時間壓到最短」,
--    **而那一條沒有指定誰先。** ⇒ 所以要 Sean 拍。

-- ══ 🔴 S1:本片讓「上限」多了一個輸入,而那個輸入【不在 cap_guard 的鎖集合裡】════
-- `pcm_order_refund_cap_guard` 的契約(`20260830210000:250-263` 逐字)是
-- 「對**會影響 cap 的那幾列**取鎖 ⇒ 兩條路序列化」。它鎖的是 `orders`(FOR NO KEY UPDATE)
-- 與 failed/manual_failed 的 `order_refunds` 列。
-- ⇒ **本片把 `order_payments` 放進了 cap,而它不在那個集合裡。**
--
-- 🔵 **今天這個窗是關著的,但關它的不是本片**(adversarial-reviewer R1 S1 實查):
--    會寫 `order_payments` 的函式只有三支,每一支都在 INSERT **之前**鎖同一張單:
--      `confirm_order_payment` · `admin_record_manual_payment` · `admin_reverse_manual_payment`
--      (都是 `FROM public.orders … FOR UPDATE`,而 `FOR UPDATE` 與 cap_guard 的
--       `FOR NO KEY UPDATE` 互斥 ⇒ 同一張單上「收款/沖銷」與「退款」被序列化)
--    再加上 cap_guard 的「取鎖」與「算 cap」是**兩句 SQL** ⇒ READ COMMITTED 下第二句取新快照
--    ⇒ 等到鎖之後看得到對方剛 commit 的收款列。
-- 🛑 **⇒ 這個保證住在一條沒有被任何閘守著的慣例裡。**
--    哪天多一支 writer,或有人把那句 `FOR UPDATE` 搬到 INSERT 之後 ⇒
--    **超退的門會安靜地打開,而本片不會叫。**
--    📌 寫在這裡是為了讓下一個動那三支的人看得到這條依賴;**不在本片加閘**
--       (鐵則:不加閘;而且那道閘該住在 cap_guard 或那三支 writer 那邊,不是這裡)。
--
-- ══ 🔴 CREATE OR REPLACE 會把 SET 子句整組換掉 ═══════════════════════════════
-- ⇒ 下面**原樣寫回** `SET search_path TO ''`。而我不靠這句話擔保 —— 後置閘②直接驗。
--
-- ══ 驗過了(拋棄式 PG 17.10, 與正式庫同大版本)═══════════════════════════════
-- fixture 用**正式庫撈下來的函式原文 + 真的 cap_guard + 同名同時機的 trigger**重建,
-- 10 張單照正式庫的形狀種進去, **舊 cap 十格逐一對上正式庫**才開始測。
-- 🔴 **測的是真的會跑的那條路** —— 走 `INSERT INTO order_refunds`(trigger), 不是只呼叫函式。
--   改前:沒付過錢的取消單登 13,800 退款 ⇒ **放行**(洞)
--   改後:同一筆 ⇒ **擋下**;十張單的新 cap 全部 = 0
--   誤擋檢查(合法的還退得掉嗎):
--     付1/整單取消/退1      cap=1    ⇒ 放行 ✅  ← 有效總額制會擋下, 這格就是活證據
--     溢付 訂1000/付1200    cap=1200 ⇒ 放行 ✅  ← 舊制 cap 1000, 那 200 退不掉
--     訂金 訂1000/付300     cap=300  ⇒ 退300 放行 ✅ · 退1000 擋下 ✅(舊制會放行)
--     付滿未取消 退全額     cap=1000 ⇒ 放行 ✅
--     付滿【已取消】退全額  cap=1000 ⇒ 放行 ✅  ← 取消不影響
--     分次退 付1000已退400  cap=600  ⇒ 再退600 放行 ✅ · 再多退1 擋下 ✅
--     查無此單              ⇒ NULL ✅
-- ⚠️ **射程**:庫裡**沒有任何一張「收了訂金、還沒收完」的真單**(`payment_status` 只印得出
--    unpaid 6 / refunded 4)⇒ 分期 / 訂金那個情境是**拋棄式庫上構造出來的**, 不是真資料驗的。
--    這一句維持 plan 裡的用詞:**吻合但未證實**, 不改口。
--
-- ══ 還原 ═════════════════════════════════════════════════════════════════════
-- `supabase/rollbacks/20260917150000-rollback.sql` —— 嵌的是【貼之前】從正式庫
-- `pg_get_functiondef` 撈下來的原文(2026-09-17, prosrc md5 = a7c426364358738f792625c14363fb69), 不是從 repo 抄的。

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 1. 前置閘 ────────────────────────────────────────────────────────────────
DO $pre$
DECLARE v_oid oid; v_md5 text; v_cfg text;
BEGIN
  v_oid := to_regprocedure('public.pcm_order_refundable_remaining(uuid)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION '前置閘①:找不到 pcm_order_refundable_remaining(uuid) ⇒ 這個庫不是我以為的那個 ⇒ 停下';
  END IF;

  SELECT md5(prosrc), (SELECT c FROM unnest(proconfig) c WHERE c LIKE 'search_path=%')
    INTO v_md5, v_cfg FROM pg_catalog.pg_proc WHERE oid = v_oid;

  -- 🔴 比【現行 body 的 md5】, 不比子字串。
  --    我在 20260917130000(COMMENT 那支)踩過:舊字面會被引用在新字面的註解裡
  --    ⇒ 任何用子字串判「換掉沒」的閘都會說謊。這一支的舊算式同樣被引在註解裡。
  IF v_md5 IS DISTINCT FROM 'a7c426364358738f792625c14363fb69' THEN
    RAISE EXCEPTION '前置閘②:現行 body md5 是 %, 不是我寫這一片時看到的 a7c426364358738f792625c14363fb69 ⇒ 正式庫已經變了 ⇒ 拒繼續。', v_md5;
  END IF;
  IF v_cfg IS DISTINCT FROM 'search_path=""' THEN
    RAISE EXCEPTION '前置閘③:現行 search_path 是 %, 不是空字串 ⇒ 這個庫不是我以為的那個 ⇒ 停下', COALESCE(v_cfg,'(未設)');
  END IF;

  -- 前置閘④:「已收」那張 view 要在
  IF to_regclass('public.order_paid_totals_v') IS NULL THEN
    RAISE EXCEPTION '前置閘④:找不到 public.order_paid_totals_v ⇒ 新版算不出已收 ⇒ 拒繼續';
  END IF;

  /* 前置閘⑤ 🔴 **「在不在」不等於「讀不讀得到」**(adversarial-reviewer R1 S2)。
     本片把這張 view 變成金額上限的**承重件**, 而它讀得到全部收款列是靠三個前提:
       ① view 的 `security_invoker = false` ⇒ 讀底表用 **view owner** 的身分
       ② view owner = `order_payments` 的 owner(實查兩者都是 postgres)
       ③ `order_payments` 沒開 FORCE ROW LEVEL SECURITY ⇒ owner 不受 RLS 管
     ⛔ 少任何一個 ⇒ 已收讀成 0 ⇒ 上限 ≤ 0 ⇒ **全站退款靜靜被擋**。
     🔵 方向是 fail-closed(不會超退)所以不是 must-fix;但「靜靜」才是問題 ——
        這幾行讓它**在貼板當下就叫**, 而不是等員工按不動才發現。
     📌 `20260823030000:449` 早有一格「order_payments 開了 FORCE RLS ⇒ 驗收失敗」, 同一個前提釘在這裡。 */
  IF (SELECT c.relforcerowsecurity FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname='order_payments') IS NOT FALSE THEN
    RAISE EXCEPTION '前置閘5a:order_payments 開了 FORCE ROW LEVEL SECURITY ⇒ view owner 也會被 RLS 濾 ⇒ 已收會讀成 0 ⇒ 拒繼續';
  END IF;
  IF (SELECT pg_catalog.pg_get_userbyid(v.relowner) FROM pg_catalog.pg_class v
       JOIN pg_catalog.pg_namespace n ON n.oid=v.relnamespace
      WHERE n.nspname='public' AND v.relname='order_paid_totals_v')
     IS DISTINCT FROM
     (SELECT pg_catalog.pg_get_userbyid(t.relowner) FROM pg_catalog.pg_class t
       JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
      WHERE n.nspname='public' AND t.relname='order_payments') THEN
    RAISE EXCEPTION '前置閘5b:order_paid_totals_v 與 order_payments 的 owner 不一致 ⇒ 讀得到什麼變成 RLS 說了算 ⇒ 拒繼續';
  END IF;

  RAISE NOTICE '✅ 前置閘全過(現行 body md5 %)', v_md5;
END
$pre$;

-- ── 2. 動作 ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pcm_order_refundable_remaining(p_order_id uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- 🔴🔴 **第一項從「訂單原總額」改成「已收」**(2026-09-17,Sean Q3 甲)。
  --    plan:`docs/plans/2026-09-17-refund-cap-uses-paid-not-total-plan.md`
  --    ⛔ 舊的第一項是訂單那一欄的原始總額 —— 它是【應收】,而退款的天花板是【已收】。
  --       實測:6 張客人一毛錢都沒付的取消單,上限仍是全額(最高 13,800)。
  --    🛑 **不要改成「取消後的有效總額」** —— 那會擋掉合法退款:
  --       付了錢又整單取消 ⇒ 有效總額 0 ⇒ 上限 0 ⇒ 該退給客人的錢退不出去。
  --       庫裡有一張真單(總額 1 / 已收 1 / 已退 1)就是那條路,它當初會被擋下。
  --       📌 取消讓客人【少欠我們錢】,不是讓我們【少欠客人錢】。
  --    🔵 順帶修好「多收退不掉」:客人溢付時已收 > 原總額 ⇒ 那多收的部分現在退得掉。
  --    🔵 用既有的那支彙總 view(它的欄位 COMMENT 逐字定義「已收」= 收款金額加總),
  --       不在這裡自己再算一次 —— 同一個量只留一個來源。
  --    🔴 沒有收款列 ⇒ 子查詢無列 ⇒ NULL ⇒ 外面補 0(不是補原總額)。
  SELECT COALESCE(
           (SELECT pt.paid_total
              FROM public.order_paid_totals_v pt
             WHERE pt.order_id = o.id), 0)::bigint
       -- ↓↓ 以下三段【逐字沿用改之前的定義,一個字都沒動】↓↓
       - COALESCE(
           (SELECT SUM(r.refund_amount)
              FROM public.order_refunds r
             WHERE r.order_id = o.id
               AND r.status IN ('processing', 'confirmed')), 0)
       - COALESCE(
           (SELECT SUM(r.refund_amount)
              FROM public.order_refunds r
              JOIN public.order_refund_effective_verdict v ON v.refund_id = r.id
             WHERE r.order_id = o.id
               AND r.status = 'failed'
               AND r.failed_reason = 'manual_failed'
               AND v.corrected_to = 'money_moved'), 0)
       -- 第三段:非卡退款。刻意【不】join 上面那張更正判定 view ——
       -- 那張 view 是【卡片退款的人工判定被更正】的產物,而本表沒有判定 ⇒ join 會是零列、純裝飾。
       -- 🔴🔴 **刻意不寫出那張 view 的名字**(沿用改之前的理由,一個字沒動):
       --    別片的斷言比對 `prosrc` 的**字面**,而 **`prosrc` 含註解**
       --    ⇒ 在函式本體裡寫出那個名字,會讓那些斷言對「把 JOIN 整段刪掉」**恆真**。
       --    📌 通則:`prosrc` / 檔案內容 / diff 這類「整包字串」當比對對象時,
       --       **註解與 code 在裡面是同一種東西**。要寫說明,寫在函式本體【外面】。
       -- 🔴 本表【沒有 status】⇒ 沒有值域可篩 ⇒ 全部列一律計入。
       --    這不是疏忽:它記的是既成事實,不存在「還沒生效的那種列」。
       - COALESCE(
           (SELECT SUM(m.refund_amount)
              FROM public.order_manual_refunds m
             WHERE m.order_id = o.id
               AND m.voided_at IS NULL), 0)
    FROM public.orders o
   WHERE o.id = p_order_id;
$function$;

-- ── 3. 後置斷言 + 負對照 ─────────────────────────────────────────────────────
DO $post$
DECLARE v_oid oid; v_md5 text; v_cfg text; v_bad bigint; v_ctrl text; v_detail text;
BEGIN
  v_oid := to_regprocedure('public.pcm_order_refundable_remaining(uuid)');

  SELECT md5(prosrc), (SELECT c FROM unnest(proconfig) c WHERE c LIKE 'search_path=%')
    INTO v_md5, v_cfg FROM pg_catalog.pg_proc WHERE oid = v_oid;

  -- ① 換上去的精確就是本片打算寫的那一版(釘 md5, 不用子字串)
  IF v_md5 IS DISTINCT FROM 'a5a57c30196ca1c67215317667b47a36' THEN
    RAISE EXCEPTION '後置閘①:新 body md5 是 %, 不是本片打算寫的 a5a57c30196ca1c67215317667b47a36 ⇒ 拒 COMMIT', v_md5;
  END IF;

  -- ② 🔴 CREATE OR REPLACE 沒有把 SET 子句吃掉(我不靠「它應該不會」這句話)
  IF v_cfg IS DISTINCT FROM 'search_path=""' THEN
    RAISE EXCEPTION '後置閘②:search_path 變成 % ⇒ CREATE OR REPLACE 把 SET 子句換掉了 ⇒ 拒 COMMIT', COALESCE(v_cfg,'(沒了)');
  END IF;

  -- ③ 身分與揮發性沒變(SECURITY DEFINER / STABLE / 回傳 bigint)
  IF NOT (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid=v_oid) THEN
    RAISE EXCEPTION '後置閘③a:不再是 SECURITY DEFINER ⇒ 拒 COMMIT';
  END IF;
  IF (SELECT provolatile FROM pg_catalog.pg_proc WHERE oid=v_oid) <> 's' THEN
    RAISE EXCEPTION '後置閘③b:揮發性不是 STABLE ⇒ 拒 COMMIT';
  END IF;
  IF (SELECT pg_get_function_result(v_oid)) <> 'bigint' THEN
    RAISE EXCEPTION '後置閘③c:回傳型別不是 bigint ⇒ 拒 COMMIT';
  END IF;

  -- ③d 🔵 owner 與 EXECUTE 權限沒變(N2)。`CREATE OR REPLACE` 確實保留兩者,
  --     **而本片其他每一格都拒絕靠「它應該不會」** ⇒ 這裡直接驗,不靠那句話。
  IF (SELECT pg_catalog.pg_get_userbyid(proowner) FROM pg_catalog.pg_proc WHERE oid=v_oid) <> 'postgres' THEN
    RAISE EXCEPTION '後置閘3d:函式 owner 不再是 postgres ⇒ SECURITY DEFINER 的身分變了 ⇒ 拒 COMMIT';
  END IF;
  /* 🔴 **比【集合】不比整串字面**(R2 S5):`proacl` 是 `aclitem[]`,元素順序依授權發生順序,
     **不是規格保證的** ⇒ 釘整串字面會在一個順序不同、權限相同的庫上誤擋(fail-closed 但白跑一趟)。
     🔵 貼板前實查(2026-09-17):`{postgres=X/postgres,service_role=X/postgres}`,
        拆開是 `postgres=X/postgres` 與 `service_role=X/postgres` 兩筆 —— 下面比的就是這兩筆。 */
  IF (SELECT array_agg(a ORDER BY a) FROM (
        SELECT unnest(proacl)::text AS a FROM pg_catalog.pg_proc WHERE oid=v_oid) t)
     IS DISTINCT FROM ARRAY['postgres=X/postgres','service_role=X/postgres'] THEN
    RAISE EXCEPTION '後置閘3e:EXECUTE 權限變了(現在是 %)⇒ 拒 COMMIT',
                    COALESCE((SELECT proacl::text FROM pg_catalog.pg_proc WHERE oid=v_oid),'(預設 acl = 誰都能執行!)');
  END IF;

  -- ④ 🔴 **「查無此單 ⇒ NULL」必須還在** —— cap_guard 的 PCM05 與手動退款步5 的 fail-closed 都靠它。
  IF public.pcm_order_refundable_remaining('00000000-0000-0000-0000-0000000000ff'::uuid) IS NOT NULL THEN
    RAISE EXCEPTION '後置閘④:不存在的單沒有回 NULL ⇒ 兩條路的 fail-closed 分流會失效 ⇒ 拒 COMMIT';
  END IF;

  -- ⑤ 🔵 行為斷言:**沒有任何一張單的上限是負的**。
  --    負的 = 已退超過已收 ⇒ 要嘛資料有問題, 要嘛我的算式寫反了。
  --    📌 這一條會抓到「把第一項寫成 0」或「加減號寫反」這類錯 —— 那時會大量出現負數。
  --    ⚠️ **成本**:對 `orders` 全表逐列呼叫本函式(負分支那段每列再算 3 次)。
  --       實查 2026-09-17:`orders` **10 列** ⇒ 在 `statement_timeout = 60s` 下綽綽有餘。
  --       🔴 而那個 10 會長大 —— 哪天這一格超時, **不要拉高 timeout**, 改成抽樣或加索引。
  SELECT count(*) INTO v_bad FROM public.orders o
   WHERE public.pcm_order_refundable_remaining(o.id) < 0;
  IF v_bad > 0 THEN
    /* 🔴 **把是哪幾張單印出來**(R1 S3):只給一個數字, 現場分不出下面兩種 ——
         ① 我的算式寫反了(那會是【大量】負數)
         ② 真的有單超退(**合法可達**:`20260907110000` C-1b 讓 `backfilled_source IS NOT NULL`
            的補登退款不受 cap 約束 ⇒「已退 > 已收」不再只是「資料有問題」)
       而這兩種的下一步相反:① 改碼 ② 找人對帳。 */
    SELECT string_agg(x.line, ' · ') INTO v_detail FROM (
      SELECT o.display_id || '(已收 ' ||
             COALESCE((SELECT pt.paid_total FROM public.order_paid_totals_v pt WHERE pt.order_id=o.id),0)::text
             || ' / 上限 ' || public.pcm_order_refundable_remaining(o.id)::text || ')' AS line
        FROM public.orders o
       WHERE public.pcm_order_refundable_remaining(o.id) < 0
       ORDER BY public.pcm_order_refundable_remaining(o.id) LIMIT 10) x;
    RAISE EXCEPTION '後置閘⑤:有 % 張單的可退上限是負的 ⇒ 拒 COMMIT。最嚴重的前 10 張:%。'
                    '🔴 下一步看形狀:【大量】負數 ⇒ 本片算式寫反了, 改碼;'
                    '【少數幾張】⇒ 那幾張真的已退 > 已收(補登退款不受 cap 約束是合法路徑), 找人對帳, 不要改這支函式。',
                    v_bad, COALESCE(v_detail,'(撈不出明細)');
  END IF;

  -- ⑥ 🔵 負對照:**不該被我動到的那支沒變**。
  --    📌 少了這一條, 「把整個 schema 的函式都改掉」也會讓①過。
  --    挑 pcm_order_remaining_receivable —— 它是同一族的「應收」, 而且它【本來就看取消】,
  --    正好是本片刻意【不】模仿的那一支。
  SELECT md5(pg_get_functiondef(p.oid)) INTO v_ctrl
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='pcm_order_remaining_receivable';
  IF v_ctrl IS NULL THEN
    RAISE EXCEPTION '🔴 負對照失敗:對照組 pcm_order_remaining_receivable 不見了 ⇒ 對照組本身沒有判別力 ⇒ 拒 COMMIT';
  END IF;
  IF (SELECT pg_get_functiondef(p.oid) ~ 'cancelled_at' FROM pg_catalog.pg_proc p
       JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='pcm_order_remaining_receivable') IS NOT TRUE THEN
    RAISE EXCEPTION '🔴 負對照失敗:對照組不再看 cancelled_at ⇒ 我動到了不該動的東西 ⇒ 拒 COMMIT';
  END IF;

  RAISE NOTICE '✅ 後置閘 + 負對照全過(新 body md5 %)', v_md5;
END
$post$;

COMMIT;
