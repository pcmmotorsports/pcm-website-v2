-- 20260816050000_m4b_522_goods_axis_subtract_cancelled.sql
-- `#522`:貨品軸的分母改成【還需要處理的量】—— `quantity − cancelled_quantity`
--
-- 鐵則 12③(DDL:CREATE OR REPLACE 既有 view)。**只換 `goods_axis` 那個運算式,其餘一字不動。**
-- 前一支 = `20260814140000_m4b_e10_484a_order_goods_axis_view.sql`(權限、契約、理由都在那支,不重寫)。
--
-- ══ 1. 🔴 在修什麼 —— 這是【正確性】缺陷,不是顯示瑕疵 ═══════════════════════
--
-- 三條判定原本都拿 `oi.quantity`(**原始訂購量**)當分母。
-- 而 `ordered_quantity` 有守門 `SUM(allocated) ≤ quantity − SUM(cancelled)`
-- (`20260803130000_…:164`)⇒ **只要有任何取消,三個分母在數學上就到不了**
-- ⇒ 三個 `WHEN` 全 false ⇒ 落到 `ELSE 'none'`。
--
-- 🔴 **那不是「通常不會到」,是 100% 復現**:
--    **任何有部分取消的單,貨品軸永遠顯示「未訂購」。**
--    ⇒ 員工看到「還沒訂貨」,會去**重新採購一批已經出貨的東西** —— 那是實體動作。
--
-- 📏 **修前實跑(A 窗 2026-08-16,直接呼叫 `goodsAxisOfLines`)**:
--      對照組 訂 3 / 出 3、無取消        ⇒ `shipped` ✅(證函式本身是好的)
--      訂 5 取消 2、剩 3 全出貨完畢       ⇒ 實得 `none`(期望 `shipped`)
--      訂 5 取消 2、剩 3 到貨未出         ⇒ 實得 `none`(期望 `instock`)
--      訂 5 取消 2、已向供應商訂 3        ⇒ 實得 `none`(期望 `ordered`)
--
-- ══ 2. 🔴 整筆取消時分母 = 0 ⇒ 該列恆真(主視窗 2026-08-16 裁 `Q-522-分母` = A)═══
--
-- · 與 `apps/admin/src/lib/shipping/shipment-candidates.ts:170` 現行同立場
--   (整筆取消 ⇒ `blockedReason='cancelled'`,不留在待辦裡)⇒ **不多出第二套語意**。
-- · ⚠️ **A 的失效面已量掉,不是沒想到**:
--   「整張單只有一個品項而它整筆取消」會讓本運算式回 `shipped`,
--   但那種單 **`orders.cancelled_at` 已被 A8a2 關單寫入**
--   (`20260805100000_…:456` 算 `v_closed`、`:463-467` 真的 `UPDATE public.orders SET cancelled_at`;
--    該檔 `COMMENT :493` 逐字:「多次累積至全量=關單 op 補寫 orders 對客欄」)
--   ⇒ 畫面由訂單層「已取消」蓋過去,**本欄的值到不了使用者**。
--   🔴 **這條前提若被改掉(有人讓全取消不再關單),`shipped` 就會浮上檯面,而它比原本的
--      `none` 更毒** —— 前者讓員工多做一次,後者讓員工**不做該做的事**。
--      ⇒ 動 A8a2 的關單邏輯之前請回來看這一段。
--
-- ══ 3. 🔴 兩邊必須同一片改,而且守門的形狀不是「互比」════════════════════════
--
-- 前一支檔頭逐字:「本 view 的 CASE 順序**必須逐字對齊** `orderGoodsAxis()`」,
-- 而它同時標了「**這一片還沒有自動守門**」——
-- 🔴 **兩邊這次一起錯,正是因為那道守門沒補。**
--
-- ⚠️ **順帶更正一個既有說法**(codex 關卡2 nit,而它是拿我自己的真值表打我的):
--    前一支檔頭寫 `shipped ⊆ instock ⊆ ordered`(Sean 2026-08-05 拍「出貨必先到貨、無直送」)。
--    🔴 那是**正常資料的不變量,不是判定式的前提** —— 真值表裡就有一條反例:
--    「已出貨但 `ordered_quantity` 沒補齊(舊資料)⇒ 仍是 `shipped`」。
--    ⇒ 判序寫成「先問最遠的那個」的**另一個理由**是:**它要容忍舊資料的不完整**,
--      不是只因為那個包含關係成立。
--
-- ⚠️ **守門不能做成「兩邊互比」**:`#522` 是**兩邊【一起】用錯分母**,
--    互比對同一組輸入會得到同一個錯答案、一致通過。
-- ⇒ 做成**共用真值表 + 人寫的期望值**當第三方,兩邊各自對它比:
--      真值表  `apps/admin/src/lib/orders/goods-axis-cases.json`
--      TS 側   `apps/admin/src/lib/orders/goods-axis-cases.test.ts`(每次 vitest 都跑)
--              ⚠️ 不是 `order-status-axes.test.ts` —— 那支測的是別的東西(兩軸相乘、refunded 早退)。
--      SQL 側  `docs/probes/order-goods-axis-parity-probe.sh`(拋棄式 PG,可重跑)
--
-- 🔴 **兩側的【觸發】不對稱,這是已知缺口不是疏漏**(code-reviewer 2026-08-16 實查):
--    TS 側每次 `vitest` 都跑;**SQL 側只有人想到時才跑** ——
--    `.husky/pre-commit` / `.github/` / `package.json` 對 `docs/probes` **零命中**。
--    ⇒ **有人改了這支 view 而沒跑 probe,不會有任何東西紅。**
--
--    🔴 **更精確的版本(主視窗 2026-08-16 查環境、我自己複核過)**:
--       **CI 是存在的** —— `.github/workflows/` 有 `ci.yml` / `e2e-prod.yml` / `rpm-sync.yml`,
--       `ci.yml` 跑 typecheck / lint / test。**但它沒有 postgres service**
--       (`grep -c postgres .github/workflows/ci.yml` ⇒ **0**),也沒有人叫 probe。
--       ⇒ 缺口不是「沒有 CI」,是「**CI 跑不動需要資料庫的東西**」。
--    動這支 view 的人要自己跑:`bash docs/probes/order-goods-axis-parity-probe.sh`

CREATE OR REPLACE VIEW public.admin_order_list_v
  WITH (security_invoker = true) AS
SELECT
  -- 🔴 契約①:`orders` 全欄原樣帶出。不要改成逐欄列舉再加工。
  o.*,
  -- 🔴 契約②:純量子查詢,不 join、不 GROUP BY。CASE 順序逐字對齊 orderGoodsAxis()。
  --    `#522`:分母一律 `GREATEST(oi.quantity - COALESCE(s.cancelled_quantity, 0), 0)`。
  --    ⚠️ **`GREATEST(…, 0)` 對【回傳值】其實沒有作用**(code-reviewer 2026-08-16 抓的,他是對的):
  --       三條判定都是「非負值 `>=` need」,把 need 從負夾成 0 不改變任何一次比較的真假
  --       (`0 >= -1` 與 `0 >= 0` 同為 true)⇒ **它什麼都沒防**。
  --       留著是為了讓運算式的**意圖**看得出來(need 不會是負數),
  --       **不要以為那裡有一道線** —— 真正擋 `cancelled > quantity` 的是摘要表 CHECK C6
  --       `cancelled <= quantity`(`20260730150000:116`)。
  (
    SELECT CASE
      WHEN NOT EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = o.id) THEN 'none'
      WHEN (
        SELECT bool_and(
          COALESCE(s.shipped_quantity, 0)
            >= GREATEST(oi.quantity - COALESCE(s.cancelled_quantity, 0), 0))
        FROM public.order_items oi
        LEFT JOIN public.order_item_quantity_summary s ON s.order_item_id = oi.id
        WHERE oi.order_id = o.id
      ) THEN 'shipped'
      WHEN (
        SELECT bool_and(
          COALESCE(s.instock_quantity, 0)
            >= GREATEST(oi.quantity - COALESCE(s.cancelled_quantity, 0), 0))
        FROM public.order_items oi
        LEFT JOIN public.order_item_quantity_summary s ON s.order_item_id = oi.id
        WHERE oi.order_id = o.id
      ) THEN 'instock'
      WHEN (
        SELECT bool_and(
          COALESCE(s.ordered_quantity, 0)
            >= GREATEST(oi.quantity - COALESCE(s.cancelled_quantity, 0), 0))
        FROM public.order_items oi
        LEFT JOIN public.order_item_quantity_summary s ON s.order_item_id = oi.id
        WHERE oi.order_id = o.id
      ) THEN 'ordered'
      ELSE 'none'
    END
  ) AS goods_axis
FROM public.orders o;

-- ══ 4. 權限 —— `CREATE OR REPLACE VIEW` 保留既有 ACL,但不靠它 ═════════════════
--
-- 🔴 前一支實查過:本專案 `pg_default_acl` 對 `public` schema 的表與 view 有
--    `anon=arwdDxtm, authenticated=arwdDxtm` 的預設授權 ⇒ **新建物件一出生就被授權**。
--    `CREATE OR REPLACE` 不會重新套用 default privileges(物件沒有重建),
--    但**照樣收一次**:成本是兩行,而漏掉的代價是全體訂單外洩。
REVOKE ALL ON public.admin_order_list_v FROM PUBLIC;
REVOKE ALL ON public.admin_order_list_v FROM anon, authenticated;
GRANT SELECT ON public.admin_order_list_v TO service_role;

-- ══ 5. apply 時的自我斷言 ═════════════════════════════════════════════════════
--
-- ⚠️ **只驗結構,不驗值** —— 值要造資料,而 migration 正式 apply 時也會跑。
--    值的正確性在 `docs/probes/order-goods-axis-parity-probe.sh`(拋棄式 PG,含真值表)。
DO $verify$
DECLARE
  v_def text;
  v_cnt integer;
BEGIN
  SELECT pg_get_viewdef('public.admin_order_list_v'::regclass, true) INTO v_def;

  -- ① 正向對照:抓不到定義的話,下面每一條都恆真
  IF v_def IS NULL OR position('goods_axis' in v_def) = 0 THEN
    RAISE EXCEPTION '#522 驗收失敗 — 抓不到 view 定義或裡面沒有 goods_axis,下面的斷言沒有判別力';
  END IF;

  -- ② 🔴 三條判定**都**要扣掉取消量。少一條就是「部分修好」,而那比全沒修更難發現。
  SELECT count(*) INTO v_cnt
    FROM regexp_matches(v_def, 'cancelled_quantity', 'g');
  IF v_cnt <> 3 THEN
    RAISE EXCEPTION '#522 驗收失敗 — 定義裡 cancelled_quantity 應出現 3 次(三條判定各一),實 %。'
      '(偏少=有一條判定還在用原始訂購量當分母 ⇒ 那條會恆為 false)', v_cnt;
    -- ⚠️ 限度(codex 關卡2 nit):這是**次數守門**,擋得住「漏改一條 / 多引用一次」,
    --    擋不住「三次全塞同一條判定」「改成【加】取消量」「寫在無效運算式裡」——
    --    那幾種由真值表 probe 抓(值不對就紅),不是靠這一條。
  END IF;

  -- ③ 一條都不准剩下「直接拿 oi.quantity 比」的舊形狀
  IF v_def ~ '>=\s*oi\.quantity\M' THEN
    RAISE EXCEPTION '#522 驗收失敗 — 還有判定直接拿 oi.quantity 當分母(舊形狀),沒扣取消量';
    -- ⚠️ 限度:只認 `>= oi.quantity` 這個精確字面。`>= (oi.quantity)`、`oi.quantity <= …`、
    --    加 cast 都繞得過 —— 它是**廉價的舊形狀偵測**,真正的判別力在真值表 probe。
  END IF;

  -- ④ 判序不可倒 —— **釘的是「哪個欄位配哪個結果、照什麼順序」**,不是關鍵字首次出現位置。
  --    ⚠️ 初版只比 `position()`(codex 關卡2 must-fix):把 `THEN 'shipped'` 與 `THEN 'instock'`
  --       的**值對調**、條件不動,首次出現順序照樣是 shipped→instock→ordered ⇒ **照樣通過**。
  --    ⇒ 改成抽出 (量欄位, 回傳值) 的**配對序列**逐字比對。
  --    ⚠️ 這仍是**語法模板斷言**:換一種等價寫法(改用 CTE、把條件抽出去)會誤判失敗。
  --       紅的時候先問「我是不是換了寫法」,再問「我是不是寫錯了」。
  --    🔴 **不用正規式**:PG 走 POSIX 語意,`[^;]*?` 的非貪婪在跨 branch 時會整段吃到底 ——
  --       我第一版就是這樣寫的,實測抽出來是 `shipped_quantity>ordered`(**基準就紅**)。
  --       ⇒ 改成六個 `position()` 的**嚴格交錯**:每個量欄位必須緊接在它自己的 `THEN` 之前,
  --         而三組又必須照 shipped → instock → ordered 排。把 `THEN` 的值對調就會打破交錯。
  IF NOT (
        position('s.shipped_quantity' in v_def) > 0
    AND position('s.shipped_quantity' in v_def) < position('THEN ''shipped''' in v_def)
    AND position('THEN ''shipped''' in v_def) < position('s.instock_quantity' in v_def)
    AND position('s.instock_quantity' in v_def) < position('THEN ''instock''' in v_def)
    AND position('THEN ''instock''' in v_def) < position('s.ordered_quantity' in v_def)
    AND position('s.ordered_quantity' in v_def) < position('THEN ''ordered''' in v_def)
  ) THEN
    RAISE EXCEPTION '#522 驗收失敗 — CASE 的(量欄位 → 回傳值)配對或順序不對。'
      '應為 shipped_quantity→shipped、instock_quantity→instock、ordered_quantity→ordered。'
      '倒過來或配錯的話,已出貨的單會被判成在庫(L0 之前真的出過這個病)';
  END IF;

  -- ⑤ 🔴 權限:除了 owner 與 service_role,誰都不得有 —— **表層與欄位層是兩個獨立的面**。
  --    ⚠️ 初版註解寫「表層 + 欄位層」而 code **只查了表層**(codex 關卡2 must-fix)。
  --       `REVOKE ALL ON <view>` 實測收得掉欄位層 ACL(2026-08-16 拋棄式 PG 量的),
  --       所以這裡不是補洞,是**擋「ACL 從別的地方冒出來」**(default privileges、有人手動 GRANT)。
  IF (SELECT relacl FROM pg_class WHERE oid = 'public.admin_order_list_v'::regclass) IS NULL THEN
    RAISE EXCEPTION '#522 驗收失敗 — relacl 是 NULL(從沒下過 GRANT),下面的授權斷言沒有判別力';
  END IF;

  SELECT count(*) INTO v_cnt
    FROM pg_class c, aclexplode(c.relacl) a
   WHERE c.oid = 'public.admin_order_list_v'::regclass
     AND a.grantee <> c.relowner
     AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) <> 'service_role');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '#522 驗收失敗 — 表層授權除了 owner 與 service_role 之外還有 % 條(grantee=0 即 PUBLIC)', v_cnt;
  END IF;

  SELECT count(*) INTO v_cnt
    FROM pg_attribute at, aclexplode(at.attacl) a
   WHERE at.attrelid = 'public.admin_order_list_v'::regclass
     AND at.attacl IS NOT NULL;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '#522 驗收失敗 — 出現 % 條【欄位層】授權,而 REVOKE ALL ON <view> 之外的來源收不到它', v_cnt;
  END IF;

  RAISE NOTICE '✅ #522:三條判定都扣了取消量、無舊形狀殘留、判序正確、授權只給 service_role';
END
$verify$;

-- ══ 6. Rollback ═══════════════════════════════════════════════════════════════
-- 重跑 `20260814140000_…` 的 `CREATE OR REPLACE VIEW` 段即可回到原狀。
-- 🔴 **但那等於把 `#522` 裝回去** —— 回退前先確認你要的是「舊的錯行為」而不是別的。
-- additive:沒有動表、索引、trigger。
