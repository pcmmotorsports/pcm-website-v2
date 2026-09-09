-- ══════════════════════════════════════════════════════════════════
-- ⟦b4-PARTCANCELTAX⟧ · `pcm_order_effective_amounts_v` 算不出來就回空值
--   **未稅單的「多收」會算出太大的數字,而錯的方向是【錢往外】。**
--
-- 🔴 **拍板逐字**(Sean 2026-09-10,經主視窗 `-b2` 轉達):
--    「**甲(窗B 推薦)= 算不出來就【不回一個數】, 回空值**」
--    plan:`docs/plans/2026-09-10-partcanceltax-effective-amounts-plan.md` §5 甲。
--
-- ══ 病灶(拋棄式 PG 實測,不是讀定義推的)═══════════════════════════
-- `effective_subtotal = Σ((quantity − 已取消) × unit_price)` ⇒ **exclusive 單的 unit_price 是未稅**
-- 而 `effective_balance_due = effective_total − (o.total − balance_due)` 減掉的是**含稅實收**
-- ⇒ 🎯 **兩邊不同幣別,差一個稅。**
--
--   四格實測(逐字 view;⚠️ **不是「只換稅制」** —— A 小計 1000 而 B 小計 1050,
--   合法資料下小計必然跟著變 ⇒ 它們是**同一筆錢的兩種合法計價表示**。codex R1 nit④):
--     A exclusive 稅 50  付 1050(剛好付完)⇒ 餘額 −50   🔴 多收 50
--     B inclusive 稅 0   付 1050(同樣的錢)⇒ 餘額 0     ✅
--     C exclusive 稅 100 付 1100          ⇒ 餘額 −100  🔴(錯跟著稅走)
--     D exclusive 稅 0   付 1000          ⇒ 餘額 0     ✅(關掉稅這個變因)
--
-- 🛑 **而「錯的量 = 稅額」只在【沒有取消】時成立**(codex R1 must-fix③,我自己跑過才收):
--     兩件各未稅 1000、原稅 100、已收 2100、**取消一件**
--     ⇒ view 說多收 **1100** · 真正該退 **1050** · **誤差 50**(不是原稅 100)
--   ⇒ 📌 **三個量要分開講**:view 算出的多收總額 / 真正該退 / 兩者誤差。
--     那個 1100 **不是「全部算錯」** —— 方向對,只多報了 50。
--
-- ══ 為什麼是【回 NULL】而不是【把稅算回去】═══════════════════════════
-- 🔵 ① **這是 repo 已有的慣用法** —— `order_balance_base_v` 對「有退款的單」就回 `NULL`,
--      理由逐字:「在**印一個可能錯的數**與**不印**之間,對錢永遠選不印。」
-- 🔵 ② **消費端已經接得住** —— `pcm_bank_order_still_mailable` 的述詞第一條就是
--      `eff.effective_balance_due IS NOT NULL` ⇒ **那封信直接不寄**,而不是寄一個錯的金額。
--      ⇒ 📌 fail-closed,而且**不用改消費端一個字**。
-- 🛑 ③ **不複製計價規則** —— 稅率規則(Sean `Q24`:稅隨付款方式)**還沒落進這支 view**,
--      而它今天活在**兩支 RPC 裡**(`create_order` 看 `p_payment_channel`;
--      `admin_create_manual_order` 看發票勾選)⇒ **第三份實作 = 第三種世界觀**。
--      📌 **猜出來的話,算出的每個數字都會很有說服力而且沒有人查得出來它從哪來。**
--
-- ══ 🛑 射程寫死:本支【只修寄信】════════════════════════════════════
-- 🔴 `effective_total` **仍然回未稅數字** —— 本支一個字都沒動它。
--    而 `docs/plans/2026-09-07-partcancel-pending-refund-plan.md:58` 把它指定為
--    **剩餘應收的來源** ⇒ 退款端若照它算 `已收 − effective_total`,那個 1100 **照樣開得出來**,
--    而 `effective_balance_due` 的 `NULL` **完全不參與**。
-- ⇒ 🔴 **OP7 必須自己拒絕不可信的金額。不可以因為本支做完就當退款那條路也安全了。**
--    (`pcm_order_partial_cancel*` 今天**不在正式庫** ⇒ 那條路還沒接上。)
--
-- ══ 曝險(照實寫)══════════════════════════════════════════════════
-- 🔬 唯讀正式庫 2026-09-10:照那張寄信 view 的**完整述詞**,真正會寄的 `exclusive` 單 = **0 張**
--    (🟢 正對照:同述詞不限稅制 = **1** ⇒ 尺是活的)
-- ⇒ 📌 **今天零影響。** 而它擋的是「那一天」到來時的第一封錯信。
--
-- ══ 🔴 而本支帶來【一個新的沉默】,所以第二個物件不是附贈的 ═══════════
-- 回 `NULL` ⇒ 那種單**從此不寄匯款通知信**,而**沒有任何東西會說它為什麼沒寄**。
-- ⇒ 所以本支同時建 `pcm_bank_order_mail_blocked_by_tax` ——
--    它數的是**「那張 view 的其他每一個條件都成立,而【只因為本次新增的稅制分支】被排除的單」**。
-- 🛑 **母體刻意窄**:不含已取消 / 手動來源 / **本來就因為有退款而 `NULL`** 的單
--    —— 那些**本來就不該寄**,把它們數進來會變成誤報(codex R1 must-fix⑤)。
-- 🛑 **而它與「財務算不出來」是兩個母體,不可混用。**
--
-- ══ 回滾 ══════════════════════════════════════════════════════════
-- `supabase/rollbacks/20260909100000_down.sql`(可執行,帶 `pg_get_viewdef` 前置閘)。
-- ⚠️ 回滾之後那個高估會回來 —— **那正是本支在修的事,不是副作用。**
-- ══════════════════════════════════════════════════════════════════

BEGIN;

-- ══ 前置閘 ════════════════════════════════════════════════════════
DO $pre$
DECLARE v_def text; v_n integer;
BEGIN
  -- ① 兩支相依物件都在
  SELECT count(*) INTO v_n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('pcm_order_effective_amounts_v','order_balance_base_v','pcm_bank_order_still_mailable');
  IF v_n <> 3 THEN
    RAISE EXCEPTION '前置閘①:三個相依 view 不是都在(只有 % 個)⇒ 停', v_n;
  END IF;

  -- ② 現行定義 = 我抄下來的那一版(不同 ⇒ 有人動過 ⇒ 停,不要蓋掉別人的東西)
  v_def := pg_catalog.pg_get_viewdef('public.pcm_order_effective_amounts_v'::regclass, true);
  IF pg_catalog.md5(v_def) <> 'f112b526df7afca49ca22efe412567ea' THEN
    RAISE EXCEPTION '前置閘②:現行 viewdef md5 = % ⇒ 不是我抄的那一版(要 f112b526…)⇒ 停',
                    pg_catalog.md5(v_def);
  END IF;

  -- ③ 那支寄信 view 今天真的靠 `IS NOT NULL` 擋 —— 本支的 fail-closed 建立在它身上
  --    ⚠️ **這一閘只證【那個片段存在】,不證它仍是必須成立的條件**(codex R1 nit②)。
  IF pg_catalog.strpos(
       pg_catalog.pg_get_viewdef('public.pcm_bank_order_still_mailable'::regclass, true),
       'effective_balance_due IS NOT NULL') = 0
  THEN
    RAISE EXCEPTION '前置閘③:寄信 view 沒有 `effective_balance_due IS NOT NULL` ⇒ 本支的 fail-closed 前提不成立 ⇒ 停';
  END IF;

  -- ④ 新分支【還不在】(防重貼)
  IF pg_catalog.strpos(v_def, 'price_tax_mode') > 0 THEN
    RAISE EXCEPTION '前置閘④:現行定義已經提到 price_tax_mode ⇒ 本支貼過了 ⇒ 停(不重複貼)';
  END IF;

  -- ⑤ 🟢 正對照 —— 上面那幾把 strpos 不是恆假的尺
  IF pg_catalog.strpos(v_def, 'effective_subtotal') = 0 THEN
    RAISE EXCEPTION '前置閘⑤(正對照):連 effective_subtotal 都找不到 ⇒ 這把尺今天是死的 ⇒ 上面每一閘都不算數';
  END IF;

  -- ⑥ ⚪ 負對照 —— 現造一個不可能的字面,必須找不到
  IF pg_catalog.strpos(v_def, 'zzq_nope_literal_20260910') > 0 THEN
    RAISE EXCEPTION '前置閘⑥(負對照):現造字面竟然找得到 ⇒ 這把尺今天是恆真的 ⇒ 停';
  END IF;

  -- ⑦ 新 view 的名字還沒被佔用
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relname = 'pcm_bank_order_mail_blocked_by_tax') THEN
    RAISE EXCEPTION '前置閘⑦:pcm_bank_order_mail_blocked_by_tax 已存在 ⇒ 停';
  END IF;
END
$pre$;

-- ══ ① 主體:算不出來就回 NULL ══════════════════════════════════════
-- 🔴 **只動 `effective_balance_due` 一欄** —— 其餘三欄(含 `effective_total`)一個字沒改。
--    欄名與欄序**完全不變**(`CREATE OR REPLACE VIEW` 動欄名或欄序會 42P16)。
CREATE OR REPLACE VIEW public.pcm_order_effective_amounts_v AS
 SELECT o.id AS order_id,
    eff.effective_subtotal,
        CASE
            WHEN o.shipping_method = 'store'::text THEN 0
            WHEN eff.effective_subtotal >= 5000 THEN 0
            ELSE 100
        END AS effective_shipping_fee,
    (eff.effective_subtotal +
        CASE
            WHEN o.shipping_method = 'store'::text THEN 0
            WHEN eff.effective_subtotal >= 5000 THEN 0
            ELSE 100
        END)::integer AS effective_total,
    -- 🔴🔴 **⟦b4-PARTCANCELTAX⟧ Sean 2026-09-10 拍甲:算不出來就回空值。**
    --    下面這個分支是本支【唯一】新增的東西。
    --
    -- 🔴🔴 **判準只有一條 `tax_total <> 0`,而我第一版寫了兩條**(codex R1 must-fix①)。
    --    ⛔ ~~`price_tax_mode = 'exclusive' AND tax_total <> 0`~~
    --    🛑 **我當時的註解寫「多帶 `price_tax_mode` 是為了哪天 inclusive 出現非零稅時仍擋得住」**
    --       —— **而那句話與那行碼講的是【相反】的事**:多一個 `AND` 只會讓守門**更窄**。
    --    🎯 **反例(照資料表約束造得出來,不是宣稱正式庫有)**:`inclusive`、小計 1000、
    --       `tax_total = 50`、`total = 1050`、未收款 ⇒ **舊判準放行 ⇒ 餘額算成 1000 ⇒ 信照寄而少講 50。**
    --       `orders` 的總額 CHECK(`20260828100000:281`)只驗加總,稅制 CHECK 沒有禁止這個組合。
    --    ✅ **正確判準 = `tax_total <> 0` 一條** —— 它問的正是那件事:
    --       **`total` 裡有沒有一塊錢是 `effective_subtotal` 看不見的。**
    --       (`inclusive` 單今天 `tax_total` 恆為 0 ⇒ 這一條對它是 no-op,不改變今天的行為。)
    CASE
        WHEN o.tax_total <> 0 THEN NULL::bigint
        ELSE eff.effective_subtotal +
            CASE
                WHEN o.shipping_method = 'store'::text THEN 0
                WHEN eff.effective_subtotal >= 5000 THEN 0
                ELSE 100
            END - (o.total - bal.balance_due)
    END AS effective_balance_due
   FROM orders o
     JOIN order_balance_base_v bal ON bal.order_id = o.id
     CROSS JOIN LATERAL ( SELECT COALESCE(sum((oi.quantity - COALESCE(( SELECT sum(ci.cancelled_quantity) AS sum
                   FROM order_cancellation_items ci
                  WHERE ci.order_item_id = oi.id), 0::bigint)) * oi.unit_price), 0::numeric)::bigint AS effective_subtotal
           FROM order_items oi
          WHERE oi.order_id = o.id) eff;

COMMENT ON VIEW public.pcm_order_effective_amounts_v IS
  '部分取消後的有效金額。⟦b4-PARTCANCELTAX⟧ 2026-09-10:effective_balance_due 在【未稅單且稅非零】時回 NULL '
  '—— 因為 effective_subtotal 是未稅而 total 是含稅, 兩邊不同幣別。'
  '🛑 而 effective_total 仍是未稅數字, 本支【不保護】退款那條路 —— OP7 要自己拒絕不可信的金額。';

-- ══ ② 那個新的沉默要有人數得到 ════════════════════════════════════
-- 🔴 母體 = **那張寄信 view 的其他每一個條件都成立, 而只因為本次稅制分支被排除的單**。
--    ⇒ 述詞逐字鏡像 `pcm_bank_order_still_mailable`, 只把稅制那一條【翻過來】。
-- 🛑 **刻意不含**:已取消 / 手動來源 / 本來就因為有退款而 NULL 的單
--    —— 那些本來就不該寄, 數進來就是誤報。
CREATE VIEW public.pcm_bank_order_mail_blocked_by_tax AS
 SELECT o.id AS order_id,
    o.display_id,
    o.created_at,
    o.price_tax_mode,
    o.tax_total,
    -- 🔵 欄名用 ASCII —— 中文識別字要加引號, 而下游 grep 與型別產生器都會被它咬。
    o.total AS payable_total
   FROM orders o
     JOIN order_balance_base_v bal ON bal.order_id = o.id
     LEFT JOIN customers c ON c.user_id = o.customer_user_id
     -- 🔴 **改動【前】的兩個數,原地重算一次** —— 用來回答「它本來寄不寄」。
     --    🛑 不可以讀改動後的 `pcm_order_effective_amounts_v`:那一欄現在正是 NULL。
     CROSS JOIN LATERAL (
       SELECT sub.s AS old_effective_subtotal,
              (sub.s + sub.ship)::integer AS old_effective_total,
              sub.s + sub.ship - (o.total - bal.balance_due) AS old_balance_due
         FROM ( SELECT e.s,
                       CASE WHEN o.shipping_method = 'store'::text THEN 0
                            WHEN e.s >= 5000 THEN 0
                            ELSE 100 END AS ship
                  FROM ( SELECT COALESCE(sum((oi.quantity - COALESCE(( SELECT sum(ci.cancelled_quantity)
                                   FROM order_cancellation_items ci
                                  WHERE ci.order_item_id = oi.id), 0::bigint)) * oi.unit_price), 0::numeric)::bigint AS s
                           FROM order_items oi
                          WHERE oi.order_id = o.id) e) sub) eff0
  WHERE o.payment_channel = 'bank_transfer'::text
    AND o.payment_status = 'unpaid'::payment_status
    AND o.cancelled_at IS NULL
    AND o.order_source = 'web'::text
    AND o.manual_request_id IS NULL
    -- 🔴 本次新增那個分支的【觸發條件】, 逐字與上面那支 view 相同
    AND o.tax_total <> 0
    -- 🛑 **`balance_due IS NOT NULL`** —— 把「本來就因為有退款而算不出來」的單排除掉,
    --    否則它們會被誤報成「因為稅制被擋住」。
    AND bal.balance_due IS NOT NULL
    -- 🔴🔴 **而還要鏡像那兩條【金額範圍】條件**(codex R1 must-fix②)。
    --    ⛔ ~~我第一版只有 `IS NOT NULL`~~ —— 🛑 **那不能取代 `> 0` 與 `<= effective_total`。**
    --    🎯 **反例**:未稅兩件各 1000、原稅 100、總額 2100、**已收 1500**、取消一件、尚未退款
    --       ⇒ `balance_due = 600`(通過我的舊條件)
    --       ⇒ 而**改動前**的 `effective_balance_due = 1000 − 1500 = −500` ⇒ **它本來就不寄**
    --       ⇒ 📌 **我會把它誤報成「因為稅制才不寄」。**
    --    ✅ 所以下面把**改動前那個算式**原地重算一次 —— **不能拿改動後已經是 NULL 的欄位去比較。**
    AND (eff0.old_balance_due > 0 AND eff0.old_balance_due <= eff0.old_effective_total)
    AND (NULLIF(btrim(o.notification_email, pcm_js_trim_whitespace()), ''::text) IS NOT NULL
      OR NULLIF(btrim(c.email, pcm_js_trim_whitespace()), ''::text) IS NOT NULL);

COMMENT ON VIEW public.pcm_bank_order_mail_blocked_by_tax IS
  '⟦b4-PARTCANCELTAX⟧:因為【未稅單且稅非零】而不再寄匯款通知信的單。'
  '🛑 母體刻意窄 —— 不含已取消 / 手動來源 / 本來就因退款而算不出來的單, 那些本來就不該寄。'
  '🛑 這與「財務算不出來」是兩個母體, 不可混用。今天 0 列, 而 0 不等於這道訊號會叫。';

-- 🔴 **新物件出生就自帶 anon 權限、repo 內零 GRANT 字面可掃、三綠不紅**
--    ⇒ 兩道 REVOKE 照 `docs/patterns/revoking-function-execute-in-supabase.md`
-- 授權斷言清單(本檔可授權物件恰 1 個):
--   public.pcm_bank_order_mail_blocked_by_tax ⇒ service_role SELECT;anon/authenticated 零權限
-- 🔴 **收權程序逐字對齊 `pcm_bank_order_still_mailable`**(`20260906180000:112-114`)——
--    ⛔ ~~我第一版漏了 `service_role` 那一句~~(codex R1 nit③):
--    `GRANT SELECT` **不會撤掉別的權限** ⇒ 若預設 ACL 給過 service_role 別的東西,它會留著,
--    而貼後對帳只驗 SELECT ⇒ **看不出差別**。
REVOKE ALL ON public.pcm_bank_order_mail_blocked_by_tax FROM PUBLIC;
REVOKE ALL ON public.pcm_bank_order_mail_blocked_by_tax FROM anon, authenticated, service_role;
GRANT SELECT ON public.pcm_bank_order_mail_blocked_by_tax TO service_role;

-- ══ 收權斷言(逐個物件真的問一次,不是寫在註解裡)══════════════════
-- 🔴 **靜態閘③擋過我一次** —— 我第一版只把清單寫成**註解**,而它數的是這個
--    `v_relations` 陣列。📌 **一個寫在註解裡的清單,對機器來說等於沒有清單。**
DO $acl$
DECLARE
  v_relations text[] := ARRAY['public.pcm_bank_order_mail_blocked_by_tax']::text[];
  r text;
BEGIN
  FOREACH r IN ARRAY v_relations LOOP
    IF has_table_privilege('anon', r, 'SELECT')
     OR has_table_privilege('authenticated', r, 'SELECT') THEN
      RAISE EXCEPTION '收權斷言:% 仍被 anon 或 authenticated 讀得到', r;
    END IF;
    IF NOT has_table_privilege('service_role', r, 'SELECT') THEN
      RAISE EXCEPTION '收權斷言:service_role 讀不到 % ⇒ 這道訊號沒有讀者', r;
    END IF;
  END LOOP;
END
$acl$;

-- ══ 貼後對帳 ══════════════════════════════════════════════════════
DO $post$
DECLARE v_def text; v_n integer;
BEGIN
  v_def := pg_catalog.pg_get_viewdef('public.pcm_order_effective_amounts_v'::regclass, true);

  -- ① 新分支進去了
  --    ⚠️ **只驗字樣**(codex R1 nit②):把 NULL 分支改成回數字而保留這個字樣, 這一格仍會過。
  IF pg_catalog.strpos(v_def, 'THEN NULL::bigint') = 0 THEN
    RAISE EXCEPTION '貼後對帳①:新分支沒進去';
  END IF;

  -- ② 🔴 `effective_total` 那一欄還在(本支不保護退款那條路, 也不假裝有)
  --    ⚠️ **只驗欄名在**,不驗它算的還是同一件事 —— 換成 `0::integer` 這一格照樣過。
  IF pg_catalog.strpos(v_def, 'AS effective_total') = 0 THEN
    RAISE EXCEPTION '貼後對帳②:effective_total 那一欄不見了';
  END IF;

  -- ③ 欄名與欄序沒變(42P16 的那一格)
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'pcm_order_effective_amounts_v';
  -- ⛔ ~~我第一版寫 4~~ 🔴 **我自己數錯了** —— 是 **5** 欄
  --    (order_id / effective_subtotal / effective_shipping_fee / effective_total /
  --     effective_balance_due), 我漏數了 order_id。
  --    ✅ **而這道閘在拋棄式 PG 上當場把我擋下來了** —— 它照設計動作了。
  IF v_n <> 5 THEN
    RAISE EXCEPTION '貼後對帳③:欄數變了(是 % 不是 5)', v_n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='pcm_order_effective_amounts_v'
                    AND ordinal_position = 5 AND column_name = 'effective_balance_due') THEN
    RAISE EXCEPTION '貼後對帳③b:第 5 欄不是 effective_balance_due ⇒ 欄序變了';
  END IF;

  -- ④ 新 view 在, 而且權限收乾淨
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                  WHERE n.nspname='public' AND c.relname='pcm_bank_order_mail_blocked_by_tax') THEN
    RAISE EXCEPTION '貼後對帳④:告警 view 沒建起來';
  END IF;
  IF has_table_privilege('anon','public.pcm_bank_order_mail_blocked_by_tax','SELECT')
   OR has_table_privilege('authenticated','public.pcm_bank_order_mail_blocked_by_tax','SELECT') THEN
    RAISE EXCEPTION '貼後對帳④b:收權失敗 —— anon 或 authenticated 讀得到';
  END IF;
  IF NOT has_table_privilege('service_role','public.pcm_bank_order_mail_blocked_by_tax','SELECT') THEN
    RAISE EXCEPTION '貼後對帳④c:service_role 讀不到 ⇒ 這道訊號沒有讀者';
  END IF;

  -- ⑤ 那支寄信 view 仍然編譯得起來(相依沒被弄壞)
  PERFORM 1 FROM public.pcm_bank_order_still_mailable LIMIT 1;

  RAISE NOTICE '✅ ⟦b4-PARTCANCELTAX⟧ 五格貼後對帳全過';
END
$post$;

COMMIT;
