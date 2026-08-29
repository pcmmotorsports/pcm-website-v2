-- M-4b 優惠券 片1:兩張新表(coupons / coupon_redemptions)+ 拒絕理由 enum
--
-- ═══ ✅ 2026-08-29 16:03 Sean 把下面那三題全答了(主視窗轉述,決策檔已落)═══
--
-- 🔴 **括號裡的字是我們寫的,不是他寫的** —— 他答的是甲/乙,選項字面是我們出的。
--
-- **Q「用掉一次」什麼時候算 ⇒ 乙:付款成功才算**
--   ⚠️ **而他是看過代價才選的** —— 選項裡逐字寫著「限量券沒辦法先保留,兩個人同時結帳可能都成功」
--   ⇒ **超賣是他知情接受的**,不是我們沒想到。
--   ⇒ 連帶:規格裡那個 `SKIP LOCKED` 併發設計【不再是關鍵路徑】,而**不要因此拿掉它**。
--   ⇒ 片2 落點:寫 redemption 的時機綁付款成功那一步,不綁建單。
--
-- **Q 退貨時那次券要退回去嗎 ⇒ 甲:只有整筆退才退回券**
--   🔴 **而這條規則今天【不會被觸發】** —— 「部分退」現在做不到(退刷線 RF2b 起未實作)
--   ⇒ **今天只有整筆退這一種,所以這條規則現在不區分任何東西。**
--   ⚠️ 寫在這裡是免得下一個人以為有一道判斷在跑 —— 沒有,只有一種情況。
--
-- **Q「券為什麼不能用」要不要留紀錄 ⇒ 甲:不留**
--   🔴 **這是【撤掉一個承諾】,不是默默不做** —— 規格
--      `docs/specs/2026-08-26-coupon-schema-plan.md:168` 逐字承諾「失敗記進 redemptions 供事後查」
--   ⇒ 該句已在那份規格標作廢(同一顆 commit)。理由:那張表裝不下
--      (打錯券碼時根本沒有券可以指,而 coupon_id 是 NOT NULL)。
--   ⇒ **不標作廢就默默不做 ⇒ 那份規格會變成「寫著要做而沒做,而沒有人知道它被撤了」。**
--
-- ⇒ 所以第 5 節那個 enum 仍然留著:它是 RPC 回給前端的【當下原因】,不是要存進表的稽核紀錄。
--
-- ═══════════════════════════════════════════════════════════════════
--
-- 🛑🛑 **這支【現在還不要貼進正式庫】,而理由不是它有 bug** ——
--    codex R3 換角度審(不看欄位、質疑框架)抓到:**這張表的「計次」語意根本還沒定**,
--    而 schema 一旦上線就把還沒定的東西凍住了。
-- ✅ **這三題 Sean 已於 2026-08-29 16:03 全答**(答案在本檔最上面那一節)⇒ 語意不再是空的。
-- 🛑 **而「現在不要 apply」這句【維持】** —— 撤掉它要 Sean 自己說一句,
--    不是「問題答完了所以應該可以貼」。這兩件事不是同一件。
--    (下面三題留著當上下文,它們是那三個答案在回答什麼。)
--
--    ① **一次「使用」是在【建單】算,還是【付款】算?**
--       PCM 是先建 unpaid 訂單、一天沒付會自動失效(20260828060000_...expire_unpaid_orders:153)
--       ⇒ 建單就算 ⇒ 有人下單不付,就把限量券的名額吃掉了
--       ⇒ 付款才算 ⇒ 限量券沒辦法「先保留」⇒ 兩個人同時結帳可能都成功
--    ② **「退回」不是一個是非題** —— 現在的退款流程有整筆退、部分退、部分取消
--       (20260803150000_m3_a7c_rw1a_refund_write_rpcs.sql:472)
--       ⇒ `reverted_at` 現在沒有來源事件:誰在什麼情況下寫它?部分退要不要退整次?
--    ③ **規格說「用不了的原因要記進 redemptions」,而這個模型裝不下它**
--       (2026-08-26-coupon-schema-plan.md:168)⇒ `not_found` 沒有 coupon_id、
--       驗券當下也還沒有 order_id,而這兩欄都是 NOT NULL
--       ⇒ 要嘛撤掉那個承諾,要嘛另開一張 attempt 表。**同一張表不能同時當成功帳與失敗帳。**
--
--    ✅ **而先 commit 是安全的**:commit ≠ apply,而本片交付後零寫入端 ⇒ 這三題在片2 之前打不到。
--    📌 **不 commit 才是危險的** —— 這份東西會跟著 session 消失,而下一個人會從頭再做一次。
--
-- 🛑 **本檔【不由任何窗 apply】** —— apply 是 Sean 的手(照本 repo 慣例:他自己在 SQL Editor 貼)。
-- ✅ Sean 批准:2026-08-29 15:17:37 逐字「A: 甲 開工」(片1 的 plan);
--    而這條線本身他 14:36 逐字「都開」。
--
-- 欄位【逐欄照】docs/specs/2026-08-26-coupon-schema-plan.md §1-2 / §1-2b 抄,
-- 每一欄旁邊標它的出處 ⇒ reviewer 一眼看得出【哪一欄是 Sean 答過的】、【哪一欄是我們補的】。
-- 上位:Sean 2026-08-29 14:36「都開」(開這條線)+ 2026-08-26 的決策表(Q1乙/Q2乙/Q3甲/Q4丙/Q6甲/Q7甲/Q22甲/a甲/c甲)
-- 鐵則:12③ DB 結構(新表)。⚠️ 本片【不含】任何 RPC、任何畫面、任何既有表的改動。
--
-- 🔴 本檔自帶顯式 BEGIN/COMMIT:本 repo 已實證 migration 檔【不保證】跑在單一交易內
--    (SET LOCAL 是 no-op)⇒ 若 CREATE TABLE 成功而後續 REVOKE / RLS 失敗,
--    會留下「表已建、而 Supabase 對新表的 default privileges 仍在」= 半套用的直寫面。
--    (形狀抄自 20260725130100 檔頭那段,理由相同。)
--
-- ═══ codex R1 FAIL(2026-08-29,7 must-fix + 1 nit)全折,逐條記在它改的那一行旁邊 ═══
-- 🔴🔴 **R1-MF1 是最貴的一條,而它貴在【我的驗收全綠】**:原版寫 `created_by uuid REFERENCES staff(id)`,
--    而 `staff.id` 是 `text`(20260726120000_m4b_e8a1_staff_table.sql:13)⇒ **這支在正式庫會 apply 失敗**。
--    而我的拋棄式 PG 驗收 19/19 全綠 —— 因為 **那張 staff 表是我自己 bootstrap 出來的,而我把它建成了 uuid**。
--    📌 **我造了尺,也造了被量的東西 ⇒ 它們用同一個錯,所以完全吻合。**
--    ⇒ 修法不只是改型別:**fixture 一律從真 migration 抄,不自己發明**。
-- ⚠️ **R2 抓到的假引用**:上一版這裡寫「見 coupon-p1-acceptance.md D 節」,
--    而那份檔【只在 session scratchpad,不在 repo】⇒ 讀這行的人查無此檔。
--    ⇒ 該紅該綠的清單改寫在本片的 commit body 裡(那是 repo 查得到的地方)。
--    ⚠️ **而這一行原本寫死「25 格」,R2 之後實際跑的是 28 格** ⇒ codex R3 抓到這個字面差。
--       ⇒ 所以這裡【不再寫數字】—— 一個寫死在註解裡的計數,會在下一次加測時安靜地過期。

BEGIN;

-- ── 1. 拒絕理由 = 封閉集(§1-4;Q22甲 的實體)────────────────────────
-- 🔴 寫成 enum 不是 text —— 理由與板子的「態」同一條:字串會長出第八種而沒有人發現。
CREATE TYPE public.coupon_reject_reason AS ENUM (
  'not_found',                 -- 券碼不存在(打錯)
  'inactive',                  -- 已停用            ← Q7甲(停用取代刪除)
  'expired',                   -- 已過結束日        ← Q3甲
  'exhausted',                 -- 總量已用完        ← Q2乙
  'already_used_by_account',   -- 這個帳號用過了    ← Q2乙
  'below_min_spend',           -- 還差 N 到最低消費 ← Q6甲
  'tier_conflict'              -- 不能與會員價並用  ← Q4丙
);

-- ── 2. coupons:券本體(§1-2,逐欄標出處)─────────────────────────
CREATE TABLE public.coupons (
  -- ← 本片補充(spec 未列):代理主鍵,形狀對齊 orders.id(20260604120000:93)  [R1-nit]
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 券碼。§1-2:trim + toUpperCase 後唯一。
  -- 🔴 大小寫正規化寫在【寫入端 RPC】,而這裡用 CHECK 釘住「存進來的必須已經正規化」
  --    ⇒ 兩層:RPC 做轉換、DB 拒絕沒轉換過的 ⇒ 繞過 RPC 也寫不進一個小寫券碼。
  -- 🔴 **R1-MF3**:原版只有 `code = upper(btrim(code))`,而 **`btrim()` 預設只剝【半形空格】**
  --    ⇒ `E'\tSAVE10\t'` 在 DB 這關【過】,而 JS `String.trim()` 會把它剝成 `SAVE10`
  --    ⇒ 同一張券會存成兩列,而兩列在畫面上【看起來一模一樣】。
  --    ⇒ 改成【整個字串不准有任何空白字元】—— 這比「剝掉頭尾」嚴格,而它同時關掉中段的 tab。
  -- 🔴🔴 **這裡曾經有一句【描述了一個不存在的約束】的註解**(codex 第四輪抓到):
  --    R2 我原本寫成 `code ~ '^[A-Z0-9][A-Z0-9_-]*$'`,而 codex R2 說那是【未經 Sean 批准的字集政策】
  --    ⇒ 我把碼改成只擋空白,**而描述它的那段字沒有跟著改** ⇒ 註解與 commit body 都還在講字集。
  --    📌 **而三綠、28 格驗收、migration 守門【全部照樣綠】** —— 它們量的是碼,
  --       沒有任何一把尺在量「描述它的那句話對不對」。
  -- ⇒ **現況照實寫**:只擋「大小寫沒正規化」與「含任何空白字元」兩件事,**沒有字集限制**
  --    ⇒ `SAVE!10`、emoji、標點都寫得進去。
  --    ⚠️ 而那不是疏漏,是【沒有人拍過字集】⇒ 要限制的話是一個新的決定,不是補一個洞。
  code            text NOT NULL UNIQUE
                    CHECK (code = upper(code) AND code <> '' AND code !~ '[[:space:]]'),
  description     text NOT NULL DEFAULT '',        -- 給員工看

  -- ← Q1乙:fixed 與 percent 兩種都要
  discount_type   text NOT NULL CHECK (discount_type IN ('fixed', 'percent')),
  -- fixed = 金額(整數 TWD);percent = 百分比整數
  -- 🔴 percent 的進位 = Math.round(四捨五入)← a甲,與 packages/domain/src/catalog/pricing.ts:53 同一個做法
  --    而那是【折抵】不是【定價】⇒ 四捨五入的方向是可能多折 0.5 元給客人 ⇒ 那是他拍的
  discount_value  integer NOT NULL CHECK (discount_value > 0),
  -- 🔴 **R1-MF4 的折法**:codex 說「允許 100% = 先替 Sean 決定可以開整單免費券」。
  --    ⇒ 我的判斷是【把生意政策搬出 schema】,不是在這裡挑一個數字:
  --      · `> 100` = **算術上無意義**(折掉比原價多)⇒ 這一層擋掉,不需要問任何人
  --      · `= 100` = **整單免費**,那是【生意政策】⇒ **它不屬於這張表**
  --        ⇒ 由片2 的建券 RPC 執行,而 RPC 上線前 Sean 要先答(已進未決清單)
  --    📌 所以這個 CHECK 現在只表達算術邊界,**不表達「准不准」**。
  CONSTRAINT coupons_percent_range
    CHECK (discount_type <> 'percent' OR discount_value BETWEEN 1 AND 100),

  ends_on         date,                            -- ← Q3甲 只做結束日(NULL = 不設)
  max_redemptions  integer CHECK (max_redemptions  IS NULL OR max_redemptions  > 0), -- ← Q2乙 總量;NULL=不限
  max_per_account  integer CHECK (max_per_account  IS NULL OR max_per_account  > 0), -- ← Q2乙 每人;NULL=不限
  min_spend       integer NOT NULL DEFAULT 0 CHECK (min_spend >= 0),                 -- ← Q6甲 最低消費
  stacks_with_tier boolean NOT NULL,               -- ← Q4丙 每張券一個開關
  is_active       boolean NOT NULL DEFAULT true,   -- ← Q7甲 停用取代刪除

  -- ← Q5甲 的配套。建立者不給改(沒有 UPDATE 路徑會動它 —— 而那由 RPC 保證,不是 DB)
  -- 🔴🔴 **R1-MF1**:`text` 不是 `uuid` —— staff.id 是 `text`(20260726120000_...staff_table.sql:13,
  --      格式 `^[a-z0-9_]{1,64}$`)。原版寫 uuid ⇒ **正式庫建 FK 當場失敗**。
  created_by      text NOT NULL REFERENCES public.staff(id) ON DELETE RESTRICT,
  -- ← 本片補充(spec 未列):建立時點,形狀對齊 orders/staff 的 created_at  [R1-nit]
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ── 3. coupon_redemptions:使用紀錄(§1-2b)──────────────────────
-- 🔴 為什麼一定要第二張表:orders.discount_total 是【一個總數】,
--    而 Q2乙 的「每人上限」要答得出「這個帳號用過沒」⇒ 那要一列一列的紀錄。
CREATE TABLE public.coupon_redemptions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- 本片補充(同上)  [R1-nit]
  coupon_id         uuid NOT NULL REFERENCES public.coupons(id) ON DELETE RESTRICT,
  order_id          uuid NOT NULL REFERENCES public.orders(id)  ON DELETE RESTRICT,

  -- 🔴 綁【帳號】不是 email —— Sean 逐字「同一個帳號, email 重複無所謂」
  --    ⇒ 同一個人開兩個帳號各用一次 = 兩次,不擋。
  -- 🔴 **R1-MF2**:原版【沒有 FK】,而 spec:78 逐字「綁 `customers.user_id`」
  --    ⇒ 沒有 FK ⇒ 寫得進一個【不存在的帳號】,而「每人上限」就從那一列開始數錯人。
  --    ON DELETE RESTRICT 與 orders.customer_user_id(20260604120000:95)同向:有紀錄不可刪客。
  user_id           uuid NOT NULL REFERENCES public.customers(user_id) ON DELETE RESTRICT,
  discount_applied  integer NOT NULL CHECK (discount_applied > 0),

  -- ← c甲:退貨之後那張券的次數退回去,客人可以再用一次
  -- 🔴 NULL = 還算數;有值 = 已退回
  reverted_at       timestamptz,
  reverted_by       text REFERENCES public.staff(id) ON DELETE RESTRICT,  -- text ← R1-MF1 同一條
  -- 🔴 **R1-MF5**:原版寫 `(reverted_at IS NULL) = (reverted_by IS NULL)` = **兩欄嚴格成對**
  --    ⇒ 那等於在 schema 裡拍了「退回一定有一個人」⇒ **封死【退貨流程自動退】那條路**。
  --    而 spec §5 逐字:「`reverted_at` 由【誰】寫進去(退貨流程自動 vs 客服手動)——
  --    §1-2b 我傾向手動,**而那是我判的不是 Sean 拍的**」⇒ **未拍板的事不進 CHECK。**
  --    ⇒ 只留【單向】:有 by 必有 at(「有人退了但沒有時間」永遠是壞資料,那一向沒有爭議)。
  --    ⚠️ 代價寫清楚:`at` 有而 `by` NULL 現在寫得進去 = 系統自動退 ⇒ 那一格由片2 的 RPC 決定要不要填。
  CONSTRAINT coupon_redemptions_revert_pair
    CHECK (reverted_by IS NULL OR reverted_at IS NOT NULL),

  created_at        timestamptz NOT NULL DEFAULT now(),

  -- 同一張單同一張券只能有一列(重送 / 重試不會變成兩次)
  -- 🔴 **R2-新洞①**:原版寫 `UNIQUE (coupon_id, order_id)` ⇒ 它只擋「同一張券在同一張單第二次」,
  --    **而同一張單用【兩張不同的券】它是放行的** —— 而 PRD(2026-08-25-coupon-prd.md:186)
  --    明列「本版不做兩張券」⇒ 那不是我加的政策,是【已經寫下的決定沒有被釘住】。
  --    ⇒ 收成 `UNIQUE (order_id)`:一張單最多一列 redemption。它同時涵蓋舊的那一種。
  CONSTRAINT coupon_redemptions_one_per_order UNIQUE (order_id)
);

-- 🔴 這兩個索引【不是效能優化】,是上面兩個上限的查詢路徑:
--    已用/總量  count(*) WHERE coupon_id = X AND reverted_at IS NULL
--    每人上限    count(*) WHERE coupon_id = X AND user_id = Y AND reverted_at IS NULL
--    ⚠️ 而【每一個數次數的地方都要帶 reverted_at IS NULL】——
--       漏掉任何一處 ⇒ 那張券【看起來已用完】而客人明明退過貨,
--       而它不會報錯、不會紅,只會有客人打電話來說「我的券不見了」。
CREATE INDEX coupon_redemptions_active_idx
  ON public.coupon_redemptions (coupon_id) WHERE reverted_at IS NULL;
CREATE INDEX coupon_redemptions_active_per_account_idx
  ON public.coupon_redemptions (coupon_id, user_id) WHERE reverted_at IS NULL;

-- ── 4. RLS + 表權限:零 GRANT ───────────────────────────────
-- 🔴 新表出生就自帶 anon/authenticated 權限(Supabase default privileges)
--    ⇒ repo 內零 GRANT 字面可掃、三綠不會紅 ⇒ REVOKE 是必要的,不是保險。
-- 🔴 而 GRANT 擋的是 service_role —— 它有 BYPASSRLS ⇒ RLS 對它零判別力。
ALTER TABLE public.coupons            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupon_redemptions ENABLE ROW LEVEL SECURITY;

-- RLS-GATE-EXEMPT: coupons -- 零表權限(下方 REVOKE ALL);讀寫唯一路 = 之後的 SECURITY DEFINER RPC
-- RLS-GATE-EXEMPT: coupon_redemptions -- 零表權限(下方 REVOKE ALL + 第5節閉世界斷言);讀寫唯一路 = 片2 的 SECURITY DEFINER RPC
-- 🔴 上一行原本寫「同上」,而 RLS 守門把它擋了(rls-service-role-policy-gate.py:107 EXEMPT_MIN_REASON=8)。
--    ⚠️ 而【同一顆 commit 裡 coupons 那行過了】⇒ 畫面上看起來像「豁免這個機制有在動」,
--       而其實只有一半在動 ⇒ 那道閘是對的:「同上」對下一個讀的人零資訊,他還得回頭找上一行。
REVOKE ALL ON TABLE public.coupons            FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.coupon_redemptions FROM PUBLIC, anon, authenticated, service_role;

-- ── 5. 🔴🔴 migration 內的 fail-closed 斷言(R1-MF6/MF7 起,R3-MF4/MF5/MF6 收尾)──
-- **為什麼一定要寫在這裡,而不是只寫在我的驗收腳本裡:**
--   · 我的驗收跑在【拋棄式 PG】上 ⇒ 它量不到正式庫的 default privileges 漂移
--   · 而漂移發生時,上面那兩行 REVOKE **照樣印成功** ⇒ 沒有任何東西會紅
--   ⇒ 這一段是唯一一個【在 Sean 貼進正式庫的那一刻】會叫的東西。
--
-- 🔴 **R3-MF6:形狀改成本 repo 的家法**(`v_relations` 陣列 + FOREACH),不是我自創。
--    理由不是美觀:`scripts/migration-static-checks.sh:461` 那道 commit 守門
--    **數 CREATE TABLE 的支數,再數 `v_relations`/`v_functions` 裡列了幾個** ⇒ 兩邊不等就擋。
--    ⚠️ 而上一版我自己寫的 DO 區塊【功能上是對的、突變也殺得掉】,而它在守門底下 rc=1:
--       實跑 `bash scripts/migration-static-checks.sh <本檔>` ⇒ 「可授權物件 2 個,斷言清單列了 0 個」。
--    📌 **28 格驗收全綠,而 commit 會紅 —— 因為那 28 格量的是「約束擋不擋得住」,
--       而守門量的是「你有沒有用大家看得懂的形狀寫」。兩把尺,兩個世界。**
--    (家法範本:20260829010000_m4a_email_deadman_alert_counts.sql:243-280)
--
-- 🔴 **R3-MF4:enum 也是一個可授權物件** —— PostgreSQL 新建 data type
--    **預設就給 PUBLIC `USAGE`**,而上面第 4 節只收了兩張表 ⇒ 型別整個漏在框架外。
-- 🔴 **R3-MF5:點名式檢查是黑名單,不是「零權限」** —— 只問 anon/authenticated/service_role
--    ⇒ **第四個 grantee 存在時它全綠**。⇒ 補一段無條件掃 `relacl` 的閉世界檢查(家法同款)。
REVOKE ALL ON TYPE public.coupon_reject_reason FROM PUBLIC, anon, authenticated, service_role;

DO $$
DECLARE
  v_relations text[] := ARRAY[
    'public.coupons',
    'public.coupon_redemptions'
  ]::text[];
  v_functions text[] := ARRAY[]::text[];
  v_privs     text[];
  r           text;
  v_rel       oid;
  p           text;
  col         text;
  v_extra     text;
BEGIN
  -- PG 17 新增第八種表權限 MAINTAIN;舊版收到未知權限名會報錯 ⇒ 分岔,免得 fail-closed 變 fail-loud
  v_privs := CASE WHEN current_setting('server_version_num')::int >= 170000
    THEN ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']
    ELSE ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']
  END;

  FOREACH r IN ARRAY v_relations LOOP
    v_rel := pg_catalog.to_regclass(r);
    IF v_rel IS NULL THEN
      RAISE EXCEPTION '片1 收權斷言失敗:找不到 %(沒建成?)⇒ 拒繼續', r;
    END IF;

    -- 5a. RLS 真的開了(不是「我寫了 ALTER」,是「現在的狀態是開的」)
    IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = v_rel) THEN
      RAISE EXCEPTION '片1 fail-closed:RLS 未開 ⇒ %', r;
    END IF;

    -- 5b. 表級【有效】權限 = 0(has_* 回的是有效權限 ⇒ 角色繼承算進去)
    FOREACH p IN ARRAY v_privs LOOP
      IF pg_catalog.has_table_privilege('public', v_rel, p)
         OR pg_catalog.has_table_privilege('anon', v_rel, p)
         OR pg_catalog.has_table_privilege('authenticated', v_rel, p)
         OR pg_catalog.has_table_privilege('service_role', v_rel, p) THEN
        RAISE EXCEPTION '片1 fail-closed:表級權限未清乾淨 ⇒ % 的 % 還開著', r, p;
      END IF;
    END LOOP;

    -- 5c. 欄級【有效】權限
    --  🔴 **這一格的理由原本寫錯了**(codex 第四輪 nit,我實測確認它對):
    --     舊註解說「REVOKE ALL ON TABLE 不會動已存在的欄級授權」⇒ **實測是反的**:
    --     `grant select (a)` ⇒ has_column_privilege=t;`revoke all on table` 之後 ⇒ **f,且 attacl 變空**。
    --  ⇒ 所以這一格【不是】在補 REVOKE 的漏,它守的是:
    --     在 REVOKE 之後才出現的欄級授權、以及角色繼承來的有效路徑。
    FOR col IN
      SELECT a.attname FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = v_rel AND a.attnum > 0 AND NOT a.attisdropped
    LOOP
      FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
        IF pg_catalog.has_column_privilege('anon', v_rel, col, p)
           OR pg_catalog.has_column_privilege('authenticated', v_rel, col, p)
           OR pg_catalog.has_column_privilege('service_role', v_rel, col, p) THEN
          RAISE EXCEPTION '片1 fail-closed:欄級權限未清乾淨 ⇒ %.% 的 %', r, col, p;
        END IF;
      END LOOP;
    END LOOP;

    -- 5d. 🔴 **R3-MF5 的實體:上面三格只問【我點名的那幾個角色】,這一格問【還有誰】。**
    --     沒有這一格,一個叫 `reporting_ro` 的新角色拿到 SELECT ⇒ 上面全綠。
    SELECT pg_catalog.string_agg(DISTINCT g.grantee, ', ') INTO v_extra
      FROM (
        SELECT pg_catalog.pg_get_userbyid((pg_catalog.aclexplode(c.relacl)).grantee) AS grantee
          FROM pg_catalog.pg_class c
         WHERE c.oid = v_rel AND c.relacl IS NOT NULL
      ) g
     WHERE g.grantee <> pg_catalog.pg_get_userbyid(
             (SELECT c2.relowner FROM pg_catalog.pg_class c2 WHERE c2.oid = v_rel));
    IF v_extra IS NOT NULL THEN
      RAISE EXCEPTION '片1 fail-closed:% 上還有非 owner 的【表級】授權對象 ⇒ %', r, v_extra;
    END IF;

    -- 5d-2. 🔴 **閉世界原本只關了一格**(codex 第四輪 must-fix):5d 只掃 `relacl`
    --       ⇒ 第四個角色如果拿到的是【欄級】授權,它住在 `pg_attribute.attacl` ⇒ 上面整段全綠。
    --       📌 一個宣稱「閉世界」的檢查,它的世界比它宣稱的窄。
    SELECT pg_catalog.string_agg(DISTINCT g.grantee, ', ') INTO v_extra
      FROM (
        SELECT pg_catalog.pg_get_userbyid((pg_catalog.aclexplode(a.attacl)).grantee) AS grantee
          FROM pg_catalog.pg_attribute a
         WHERE a.attrelid = v_rel AND a.attnum > 0
           AND NOT a.attisdropped AND a.attacl IS NOT NULL
      ) g
     WHERE g.grantee <> pg_catalog.pg_get_userbyid(
             (SELECT c2.relowner FROM pg_catalog.pg_class c2 WHERE c2.oid = v_rel));
    IF v_extra IS NOT NULL THEN
      RAISE EXCEPTION '片1 fail-closed:% 上還有非 owner 的【欄級】授權對象 ⇒ %', r, v_extra;
    END IF;
  END LOOP;

  -- 5e. 🔴 **R3-MF4:enum 型別的 USAGE** —— 新型別預設給 PUBLIC,而它不在上面那個迴圈裡。
  IF pg_catalog.has_type_privilege('public', 'public.coupon_reject_reason', 'USAGE')
     OR pg_catalog.has_type_privilege('anon', 'public.coupon_reject_reason', 'USAGE')
     OR pg_catalog.has_type_privilege('authenticated', 'public.coupon_reject_reason', 'USAGE')
     OR pg_catalog.has_type_privilege('service_role', 'public.coupon_reject_reason', 'USAGE') THEN
    RAISE EXCEPTION '片1 fail-closed:coupon_reject_reason 型別的 USAGE 還開著';
  END IF;

  -- 5e-2. 🔴 同一個病的第三格(codex 第四輪 must-fix):上面 5e 也是【點名式】=黑名單。
  --       第四個角色拿到型別 USAGE ⇒ 它住在 `pg_type.typacl` ⇒ 那四個 has_type_privilege 全綠。
  SELECT pg_catalog.string_agg(DISTINCT g.grantee, ', ') INTO v_extra
    FROM (
      SELECT pg_catalog.pg_get_userbyid((pg_catalog.aclexplode(t.typacl)).grantee) AS grantee
        FROM pg_catalog.pg_type t
       WHERE t.oid = 'public.coupon_reject_reason'::regtype AND t.typacl IS NOT NULL
    ) g
   WHERE g.grantee <> pg_catalog.pg_get_userbyid(
           (SELECT t2.typowner FROM pg_catalog.pg_type t2
             WHERE t2.oid = 'public.coupon_reject_reason'::regtype));
  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION '片1 fail-closed:coupon_reject_reason 型別上還有非 owner 的授權對象 ⇒ %', v_extra;
  END IF;
END $$;

-- ── 6. 🛑 這一片【關不掉】的三個缺口(codex R2 抓的,寫在這裡不是寫在別處)──
--
-- 🔴 **缺口①(R2-MF2 的另一半):兩個 FK 各自保證「訂單存在」「客人存在」,
--    而【沒有東西保證那兩個是同一個人】** ⇒ 寫得進「甲的訂單算到乙頭上」,
--    而 Q2乙 的「每人上限」就從那一列開始數錯人。
--    ⇒ 要在 DB 關掉它,得用複合外鍵 ⇒ 那需要先在 `orders` 上加 UNIQUE (id, customer_user_id)
--    ⇒ **那是改既有的錢相關表** ⇒ 超出本片自己宣告的範圍(檔頭第 10 行:不含既有表改動)
--       且命中鐵則 8/12 ⇒ **要 plan + Sean 批,不是一個窗自己加**。
--    ✅ 而在片2 之前它【打不到】:本片交付後這兩張表零寫入端 ⇒ 沒有路徑製造那一列。
--    ⇒ 片2 的第一件事:要嘛提那個 plan,要嘛在建 redemption 的 RPC 裡驗這一格。
--
-- 🔴 **缺口②:百分比四捨五入可能算出【折抵 0 元】,而 discount_applied CHECK 擋 0**
--    ⇒ 例:1% 折一筆 40 元的單 ⇒ round(0.4) = 0 ⇒ 寫不進去 ⇒ RPC 會炸。
--    ⇒ 這不是 schema 的 bug,是【片2 要先決定】:拒券 / 最低折 1 元 / 允許 0 三選一。
--    ⚠️ 而它是【錢】那一層 ⇒ Sean 拍,不是我挑。已進未決清單。
--
-- ⚠️ **缺口③(第 5 節那三格的射程上限)**:`has_*_privilege` 答的是
--    「這個角色現在有沒有」,它答不出「有沒有一條 `SET ROLE` 的路通到有權限的角色」
--    (NOINHERIT 成員資格)⇒ 那一格本片沒有守,也沒有假裝守了。
--
-- static-checks:no-grant-needed 本片刻意零 GRANT —— 讀寫唯一路是【之後那幾片的 RPC】。
-- ⚠️ 所以本片交付後這兩張表【零消費者】,而那是預期的。
--    🔴 而「零消費者」與「被忘記」在 information_schema 裡長得一模一樣
--       ⇒ 所以那句話寫在這裡,不是只寫在 plan 上。
--    ⇒ 下一片(建券 RPC + 後台畫面)才會給它第一個寫入端。

COMMIT;
