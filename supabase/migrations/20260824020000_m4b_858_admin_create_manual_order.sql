-- 20260824020000_m4b_858_admin_create_manual_order.sql
-- ⚠️ **本檔原本是 `20260824010000`,與窗 A 的 `_m4b_866_manual_refund_rail_cap` 撞號**
--    (主視窗 2026-08-24 裁:先來後到,A 先報 ⇒ 我改)。
--    🔴 而**沒有任何守門在檢查時間戳唯一性**(`scripts/migration-static-checks.sh` 四道都不管這件事)
--    ⇒ 撞號本身已由主視窗立案:APPLIED.tsv 以 14 碼版本號為鍵 ⇒ 兩支同號**帳本分不出是哪一支**。
-- `#858`:後台手動建單(散客打電話 / LINE 來訂貨)
--
-- 🔴🔴 **本檔所有量詞句(唯一 / 全部 / 只有)指的是【我當時列舉出來的那些】,不是全集。**
--    本片一路四輪審查,被推翻最多次的就是這種句子。讀到時當它是**已知清單**,不是**證明過的窮舉**。
--
-- 鐵則 12①(錢:這支函式決定一張單的金額與品項)
--      12③(schema:orders 加**兩**欄 + 一個索引 + 一道 CHECK + 一支新函式;**零資料異動** —— 既有列全部拿 NULL)
--      ⚠️ ~~「加一欄」~~ 是 R1 版本的字面,**R2 加了指紋欄之後我沒有把這裡改掉**
--         (codex R2 nit)。同族的還有下面三處 —— **碼改對了,描述那個碼的字沒跟著改。**
--
-- ══ 1. 為什麼不能沿用 `create_order` ═══════════════════════════════════════════
--
-- 三條理由,任一條就足以否決(2026-08-23 實查):
--   ① `20260730120100:203`  `v_uid uuid := (select auth.uid());`
--      ⇒ service_role 呼叫時 `auth.uid()` 是 NULL ⇒ 撞 `orders.customer_user_id` 的 NOT NULL
--   ② `20260719120000:484`  它會寫一列 `order_legal_consents`(客人同意條款的法律紀錄)
--      ⇒ 手動單**沒有那個同意動作**,**偽造它是錯的**
--   ③ 它吃 `p_address_id`(客人自己存的地址)—— 散客沒有
-- ⇒ 另開一支,而本檔**不碰** `create_order`。
--    ⚠️ ~~「§6 有 apply-time 斷言釘住這件事」~~ **這句話比那道斷言能證的多**(codex R1 nit `:342`
--       已收窄斷言本身,而**這一行的宣稱當時沒有跟著收窄** ⇒ codex R2 再點一次)。
--       **斷言實際只比對【參數簽章】** ⇒ 同簽章的本體漂移它看不到。
--       真正保證「不碰」的是**本檔一行 `create_order` 的 DDL 都沒有**,不是那道斷言。
--
-- ══ 2. 三個一定要【顯式寫】的欄,不能吃預設 ════════════════════════════════════
--
-- | 欄 | 不寫會怎樣 |
-- |---|---|
-- | `payment_channel` | 吃 DEFAULT `'tappay'`(`20260712203000:48`)⇒ 而列表預設藏
-- |                   | 「tappay + unpaid + 淨收款 0 + 未取消」的單(`SupabaseOrderAdapter.ts`)
-- |                   | ⇒ 🔴 **員工按下建立、單子建好了,而列表上看不到。**
-- | `order_source`    | 吃 DEFAULT `'web'`(同檔 `:40`)⇒ 手動單與客人自己下的單**分不出來**
-- | `customer_user_id`| NOT NULL;傳 NULL 必須**拒絕**,不得靜默建出無主單
--
-- ══ 3. 冪等:為什麼要加一欄,而不是借現成的 ═══════════════════════════════════
--
-- 🔴 **`orders` 上沒有任何冪等鍵**(2026-08-24 實查:
--    `git grep -n "ALTER TABLE public.orders ADD COLUMN" -- supabase/migrations | grep -i request` ⇒ 查無)。
-- 而**沒有冪等的建單 RPC 是一支【已知會壞】的 RPC**:
--    `apps/admin/src/lib/orders/payment-action-state.ts:6-10` 逐字
--    「每次 render 重產 = **手滑按兩次就記兩筆**」—— 而這裡重複的是**訂單**,**會出兩次貨**。
--
-- ⚠️ **命名要與 `order_payments.request_id` 區分得開**:那是**另一張表的把手**,兩者不共用、不對照。
-- 🔴 **關於 partial UNIQUE 的理由,我原本寫錯了**(codex R2 nit;R1 三處同一句話):
--    ~~「既有的單全部是 NULL,普通 UNIQUE 會讓第二張既有單就撞掉」~~ —— **這句不成立。**
--    PostgreSQL 的唯一索引**預設把 NULL 兩兩視為相異**(`NULLS DISTINCT`)
--    ⇒ **多少列 NULL 都塞得下,不會互撞。**(本片 2026-08-24 在拋棄式 PG 17.10 實測驗過,見 `docs/probes/2026-08-24-858-manual-order-rpc-probe.md` §3)
--    ⇒ 真正的理由有兩個,都不是「不然會撞」:
--      ① **索引只裝手動單**(幾十列),不是整張 `orders` ⇒ 小、且不隨 web 單成長。
--      ② `WHERE … IS NOT NULL` 把「這顆鍵只對手動單有意義」寫進了 schema 本身。
--    ⚠️ 留著劃掉的舊句是**故意的**:它已經被我抄進三個地方,只刪不留痕的話,
--       下一個人讀到別處的殘留會以為那是對的。
--
-- ══ 4. 誠實揭示(不要讀成「以外都沒問題」)═════════════════════════════════════
--
-- · 本函式與「建客人」是**兩次呼叫**,中間斷掉會留下一個**沒有單的客人**。同族問題已在未做清單。
-- · ~~`p_lines` **沒有筆數上限**~~ **已補**(codex R1 `:138`)—— 而這一句留著是因為它示範了一件事:
--   **我當時把它誠實地寫出來了,而 codex 照樣判它 must-fix,它是對的。**
--   寫下一個限制不等於擋住它(`feedback_writing-down-a-limit-does-not-cover-it`)。
--   ⚠️ 新上限 `50 筆 / 單筆 qty 9999` 是**我挑的保守值、未經 Sean 拍板**(見 G1/G6 註解)。
--
-- ══ 4a. 🔴🔴 呼叫端合約 —— **接這支函式的人請先讀完這一節** ═══════════════════
--
-- 🔴🔴 **`p_actor` 絕對不可以是【client 送上來的值】。**
--    它必須來自 server 端的授權結果:`authorizeAdminMutation().actorId`
--    (`apps/admin/src/lib/session/authorize.ts:24`;既有用法見 `apps/admin/src/lib/staff-actions.ts:99`)。
--
--    **為什麼要特地寫這一句**(f5 R3 must-fix,而它明說「不是寫錯了,是沒有地方寫著」):
--      本函式對 `p_actor` 是**照單全收** —— 它只驗「在不在 `staff` 且啟用中」(見 G1)。
--      ⇒ 它**分辨不出**這個值是 server 從 session 取的,還是**表單欄位直接傳進來的**。
--      ⇒ 下一個接呼叫端的人若把表單欄位傳進來,**所有測試都會綠**,而稽核從此可以被指定。
--    ⚠️ **而這條約束在今天的 repo 裡沒有任何機制擋得住** —— 它只能住在規格與測試裡。
--    ⇒ 接呼叫端那片(M12-A)請配**一格必紅測試**:餵一個「不等於 `authorizeAdminMutation().actorId`」
--      的 actor 進去 ⇒ 必須被那一層擋下(不是被本函式擋下 —— 本函式擋不到)。
--
-- 🔴 **G1 那道 actor 守門到底買到了什麼**(f5 量準的,收下、不誇大):
--    它把「**任意字串**」收成「**一個合法的在職代號**」—— 它擋掉亂打的字串,也擋掉**已離職員工**
--    (後者是真的:FK 只擋不存在,擋不到停用)。
--    ⚠️ **但它沒有把「自稱」變成「身分」。** 而 `staff.id` 是**人可讀的短代號**
--    (`20260726120000:21` CHECK `^[a-z0-9_]{1,64}$`,不是 uuid),而且**就列在後台的選人下拉選單裡**
--    ⇒ 任何能登入後台的人都看得到全部可用代號 ⇒ **冒名門檻接近零。**
--    ⇒ 那不是本函式修得了的(`apps/admin/src/lib/session/actor.ts:7` 自陳逐字:「actor 以 cookie 承載、內容來自使用者自行選擇。這**不是**登入 / 授權邊界」),
--      **但讀本檔的人必須知道這一格的射程到哪裡。**
--
-- 📌 F1 真正買到的東西,一句話講準(f5 原話):
--    **它讓「沒有經手人紀錄的手動單」變成一個 DB 拒絕的狀態 —— 那與「可稽核」是兩回事。**

-- ══ 4b. 🔴🔴 這支檔【自己造過】的兩個洞(2026-08-24 codex R2 修完那一輪)═══════
--
-- 留在這裡的理由:**兩個都不是讀得出來的,而兩個都在「為了修 nit 而新增的碼」裡。**
-- 下一個改這支檔的人會經過檔頭 —— 信件不會。
--
-- | 洞 | 它躲過了什麼 | 抓到它的是什麼 |
-- |---|---|---|
-- | `pg_catalog.nullif(...)` 這個函式不存在 | 靜態閘 4 道 / typecheck / lint / build / apply 斷言 **全綠** | 上一輪(R1)留下的 21 格回歸負測 |
-- | 新加的 CHECK 少了 `AND sha IS NOT NULL` | 同上全綠,而且**它在 schema 上看起來完全像一道 CHECK** | 為那條 nit 新寫的一格負測 |
--
-- 🔴 第二個的形狀比它的內容值錢:那道 CHECK **存在的唯一理由**就是擋「有鍵無指紋」的毒化列,
--    而它對那個情境是**完全無效**的 ⇒ 它不是「擋得不夠嚴」,是**對它自己的目標零判別力**。
--    成因見 `:107-117`(SQL 三值邏輯:`NULL ~ '…'` 是 NULL 不是 FALSE,而 CHECK 只擋 FALSE)。
--    ⚠️ **這一族用眼睛讀是零判別力的** —— 我讀了兩遍沒看出來。
--
-- 📌 可複用的那句(已寫進 memory `feedback_nit-fix-code-ships-must-fix-bugs`):
--    **修小問題新增的碼,和修大問題新增的碼一樣會出錯,而它比較不會被當一回事去測。**
--    而「nit」這個標籤本身就是那個減量訊號 —— **碼不知道自己被貼了什麼標籤。**
--
-- ⇒ **動這支檔的紀律**:改完跑 `docs/probes/2026-08-24-858-manual-order-rpc-r{1,2}-negatives.sql` 那兩組負測,
--    不要只看 apply 有沒有成功 —— 上面那張表的左欄,每一格都 apply 成功過。

-- 🔴🔴 **`discount_total = 0` 是【刻意的】,不是還沒做**(codex R1 `:197` → Sean 2026-08-23 拍板)
--
--   ① **拍板逐字**:問「手動建單要不要分開填『折扣』和『稅額』?」
--      **答:甲 —— 不分開。員工把折扣自己算好,直接填最後單價。**
--   ② ⇒ 本函式只收 `unit_price`(已折後的價),`discount_total` 固定寫 0。
--      **這一行不是漏做的缺陷。** 下一個看到它的人不必再挖一次。
--   ③ 🔴 **代價明寫(它是被選擇的,不是被忽略的)**:
--      折扣折進單價之後,**這張單事後看不出原價與折扣各是多少**——
--      那個資訊在建單當下就沒有被記下來,**它不會再回來**。
--      ⇒ 影響面:會計拆分、對帳、「這筆為什麼比較便宜」的事後追查。
--      ⚠️ 退款分母**是對的**(退的是實收的單價),壞掉的是**拆分**,不是金額。
--   ④ 🔴 **失效條件(哪天這個決定要回訪)**:
--      只要有人要做**會計拆分**(發票稅額分列 / 折扣要單獨入帳 / 對外報表要分開兩個數字),
--      這個拍板就不夠用了 ⇒ 屆時要:**`order_items` 加 discount / tax 欄 + 回訪本拍板**。
--      ⚠️ **而現在沒有任何東西會提醒任何人** —— 沒有測試會紅、沒有守門會擋。
--      **這四行就是那個提醒本身。** 動到會計相關的片時,先回來讀這一段。
-- · `tier_at_checkout` 取**客人當下的 tier**(不是像 `create_order` 那樣寫死 `'general'`):
--   那一欄的語意是「結帳當下等級凍結」,而手動單的結帳當下就是現在。
--   ⚠️ **價格不由 tier 推算** —— `unit_price` 是員工填的,本函式不查價、不算折扣。

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- ══ 5. 欄與索引 ═══════════════════════════════════════════════════════════════

ALTER TABLE public.orders ADD COLUMN manual_request_id uuid;

-- 🔴 codex R1 `:143`/`:248`:光有冪等鍵**不夠** —— 同一顆鍵裝不同內容時,舊版會直接回「成功」,
--    而呼叫端拿到的是**舊那張單**。repo 既有的收款/退款 RPC 合約是**同鍵不同內容必拒絕**
--    (`20260820021000:257` 逐字)。這一欄就是「內容」那一半的把手。
ALTER TABLE public.orders ADD COLUMN manual_request_payload_sha256 text;

COMMENT ON COLUMN public.orders.manual_request_payload_sha256 IS
  '#858 手動建單那一發**正規化後**輸入的 sha256(hex)。🔴 用途只有一個:同 `manual_request_id` 重送時比對內容 —— 相同才回 idempotent,不同就**拒絕**。⚠️ **上限**:它比的是指紋不是欄位 ⇒ 只答得出「一樣/不一樣」,答不出**哪一欄**不一樣。既有列與所有 web 單恆 NULL。';

COMMENT ON COLUMN public.orders.manual_request_id IS
  '#858 後台手動建單的一次性冪等鍵(表單產、每次送出同一顆)。🔴 **與 order_payments.request_id 是兩張表的兩個把手**,不共用、不對照。既有列與所有 web 單恆 NULL。⚠️ 唯一索引做成 partial 的理由是**索引只裝手動單**(小、且把意圖寫進 schema),**不是**「不然多筆 NULL 會互撞」——PostgreSQL 預設 NULLS DISTINCT,多筆 NULL 本來就塞得下(2026-08-24 實測)。';

-- 🔴 codex R2 nit:兩欄之間**原本沒有任何約束** ⇒ 未來別的 service_role 寫入者可以留下
--    「有冪等鍵、指紋卻是 NULL 或亂碼」的列 ⇒ 那種列會讓 G6.5 的比對**靜靜失效**
--    (`IS NOT DISTINCT FROM` 對 NULL 指紋只在對方也算出 NULL 時才相等 ⇒ 實務上永遠走到「內容不同」
--     ⇒ 那顆鍵**從此再也不能重送**,而畫面上看不出為什麼)。⇒ 用 CHECK 把這種列擋在門外。
-- 🔴🔴 **`IS NOT NULL` 那一句不是贅字,拿掉這道 CHECK 就【整個失效】。**
--    2026-08-24 實測(拋棄式 PG 17.10):上一版**沒有**那一句,結果
--    「有鍵、指紋是 NULL」的那一列**直接寫進去了**。
--    成因=SQL 的三值邏輯:`NULL ~ '…'` 得到的是 **NULL 不是 FALSE**,
--    而 **CHECK 只擋 FALSE、放行 NULL** ⇒ `false OR NULL` = NULL ⇒ 放行。
--    ⚠️ 這個洞我讀了兩遍沒看出來 —— **是負測餵了那一列才紅的。**
ALTER TABLE public.orders ADD CONSTRAINT orders_manual_request_pair_valid CHECK (
  (manual_request_id IS NULL     AND manual_request_payload_sha256 IS NULL)
  OR
  (manual_request_id IS NOT NULL AND manual_request_payload_sha256 IS NOT NULL
                                 AND manual_request_payload_sha256 ~ '^[0-9a-f]{64}$')
);

COMMENT ON CONSTRAINT orders_manual_request_pair_valid ON public.orders IS
  '#858:手動建單的兩欄**同生共死** —— 要嘛都 NULL(web 單與所有既有列),要嘛冪等鍵在場**且**指紋是 64 碼小寫 hex。擋的是「有鍵無有效指紋」的毒化列:那種列會讓內容比對靜靜失效,而那顆鍵從此不能重送。';

-- 🔴 partial 的理由=**索引只裝手動單**(見檔頭 §3 那段修正)。
--    ⚠️ **不是**「不然既有的 NULL 列會互撞」——那句是錯的,PostgreSQL 預設 NULLS DISTINCT。
CREATE UNIQUE INDEX orders_manual_request_id_uniq
  ON public.orders (manual_request_id)
  WHERE manual_request_id IS NOT NULL;

-- ══ 6. RPC ════════════════════════════════════════════════════════════════════

-- 🔴 **裸 `CREATE`,不是 `CREATE OR REPLACE`**(`scripts/migration-static-checks.sh` ①):
--    這是**新物件**。`OR REPLACE` 會把撞名的東西**靜靜蓋掉**,而 REVOKE 與斷言照樣綠
--    ⇒ 拿到綠燈,卻蓋掉了一個你不知道存在的東西。撞名要**當場紅**。
CREATE FUNCTION public.admin_create_manual_order(
  p_customer_user_id uuid,
  p_manual_request_id uuid,
  -- 🔴 F1(R3):**誰建的這張單。** 位置鏡像 `20260820021000:144`(退款登記那支)。
  --    ⚠️ 它**不進指紋**,理由見 G6.5 那段。
  p_actor            text,
  p_order_source     text,
  p_payment_channel  text,
  p_shipping_method  text,
  p_ship_to          jsonb,
  p_invoice          jsonb,
  p_shipping_fee     integer,
  p_lines            jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = ''
AS $fn$
DECLARE
  v_line        jsonb;
  v_qty         integer;
  v_unit_price  integer;
  v_sku         text;
  v_title       text;
  v_spec        jsonb;
  v_variant_id  uuid;
  v_line_total  bigint;
  v_subtotal    bigint := 0;
  v_total       bigint;
  v_items       jsonb := '[]'::jsonb;
  v_ship_to     jsonb;
  v_invoice     jsonb;
  v_tier        public.member_tier;
  v_display_id  text;
  v_order_id    uuid;
  v_existing    record;
  v_attempt     integer;
  v_cname       text;
  v_n           integer;
  -- codex R1 `:186`:跨列去重的累積器(形狀照 `create_order` `20260730120100:322-325`)
  v_seen        text[] := ARRAY[]::text[];
  v_key         text;
  -- codex R1 `:143`/`:248`:正規化後的整包輸入 + 它的指紋
  v_canonical   jsonb;
  v_payload_sha text;
  -- codex R1 `:138`:兩個**業務上限**。
  -- 🔴 **這兩個數字是我挑的,Sean 沒有拍過。** 挑法=比實務用量大一個數量級、
  --    又小到擋得住「一發打爆」:電話單實務上個位數筆、單筆數量兩位數。
  --    ⇒ 撞到它們的時候要**改這裡並問 Sean**,不要在呼叫端拆單繞過去。
  c_max_lines   constant integer := 50;
  c_max_qty     constant integer := 9999;
BEGIN
  -- ── G1 輸入:每一格各自一道,訊息講【哪一格】不講「輸入有誤」 ──────────────
  IF p_customer_user_id IS NULL THEN
    RAISE EXCEPTION 'admin_create_manual_order: 沒有指定客人(customer_user_id 是 NULL);拒絕建出無主單';
  END IF;
  IF p_manual_request_id IS NULL THEN
    RAISE EXCEPTION 'admin_create_manual_order: 缺冪等鍵(manual_request_id);沒有它,重送會建出第二張單';
  END IF;
  -- 🔴🔴 F1(R3 f5):**憑空建單卻記不住是誰做的** —— 而「憑空建單」正是本片新增的能力。
  --    對照:退款登記那支(`20260820021000`)提到 actor **29 次**;本檔上一版**零次**。
  --    f5 的框架句(收下,不改寫):兩片一起上線之後,能力邊界變成
  --    「**有後台密碼的人可以造出一條完整的假金流鏈,而鏈上第一環查不出是誰做的**」
  --    (建單 → 灌假收款 → 退款,三片各自都說「那不歸我管」,而沒有一片說錯)。
  --    ⇒ 走 `admin_audit_log`,**不在 `orders` 加欄**(那張表本來就沒有 actor 欄,
  --      而 audit 是這個 repo 既有的、對的載體)。
  IF p_actor IS NULL OR pg_catalog.btrim(p_actor, E' \t\r\n') = '' THEN
    RAISE EXCEPTION 'admin_create_manual_order: 沒有指定經手人(actor);'
                    '手動單是憑空建出來的,**不知道是誰建的單不准建**';
  END IF;
  -- 🔴 FK 只擋「不存在」,**擋不到已停用的** ⇒ 這一道查 is_active(逐字同 `20260820021000:198-199`)。
  IF NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.id = pg_catalog.btrim(p_actor, E' \t\r\n') AND s.is_active) THEN
    RAISE EXCEPTION 'admin_create_manual_order: 經手人 [%] 不是啟用中的員工 ⇒ 拒絕建單。'
                    '🔴 手動建單的失敗模式是【人】,而 actor 是唯一的線索 —— '
                    '拿一個查不到的名字建單,等於這張單沒有來源。', p_actor;
  END IF;
  IF p_order_source IS NULL OR p_order_source NOT IN ('manual_phone', 'manual_line', 'manual_other') THEN
    RAISE EXCEPTION 'admin_create_manual_order: 來源 [%] 不是手動三值之一', p_order_source;
  END IF;
  -- 🔴 具名拒 tappay:刷卡那條路由 TapPay 那一側寫,人工建單不得宣稱一筆卡片交易。
  IF p_payment_channel = 'tappay' THEN
    RAISE EXCEPTION 'admin_create_manual_order: 手動單不得標記為線上刷卡(tappay);那條路由付款確認寫入';
  END IF;
  IF p_payment_channel IS NULL OR p_payment_channel NOT IN ('bank_transfer', 'cash') THEN
    RAISE EXCEPTION 'admin_create_manual_order: 金流管道 [%] 不是 bank_transfer 或 cash', p_payment_channel;
  END IF;
  IF p_shipping_method IS NULL OR p_shipping_method NOT IN ('home', 'store') THEN
    RAISE EXCEPTION 'admin_create_manual_order: 配送方式非白名單(%);僅 home/store', p_shipping_method;
  END IF;
  IF p_shipping_fee IS NULL OR p_shipping_fee < 0 THEN
    RAISE EXCEPTION 'admin_create_manual_order: 運費必須是 0 或正整數(收到 %)', p_shipping_fee;
  END IF;
  IF p_lines IS NULL OR pg_catalog.jsonb_typeof(p_lines) <> 'array'
     OR pg_catalog.jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'admin_create_manual_order: 沒有品項;一張單至少要有一個品項';
  END IF;
  -- 🔴 codex R1 `:138`:**沒有上限的迴圈**。舊版靠「總額 > integer 上限」兜底,而那道
  --    對 `unit_price = 0` 的品項**零判別力** ⇒ 幾萬筆零元品項可以整包穿過去。
  IF pg_catalog.jsonb_array_length(p_lines) > c_max_lines THEN
    RAISE EXCEPTION 'admin_create_manual_order: 一張單最多 % 個品項(收到 %);超過請拆單,'
                    '或這個上限要調整 ⇒ 找系統維護(它是保守預設值、未經拍板)',
                    c_max_lines, pg_catalog.jsonb_array_length(p_lines);
  END IF;

  -- 🔴🔴 **冪等格搬到 G6 之後了**(codex R1 `:143`)。
  --    原本它在這裡 = 「鍵在就回成功」,**完全不看內容** ⇒ 同鍵裝不同內容時,
  --    員工以為新單建好了,實際拿到的是**舊那張單**。
  --    ⇒ 要比對內容,就必須**先把內容正規化完**(G4/G5/G6 做那件事)⇒ 冪等格只能排在它們之後。
  --    ⚠️ 排序安全性:重送同一包輸入時,G3-G6 全部是**決定性**的(同輸入同結果)
  --       ⇒ 不存在「完全相同的重試被前面某道閘誤擋」那個坑
  --       (退款 RPC `20260820021000:238-242` 踩過的正是那個坑,方向相反)。

  -- ── G3 客人必須存在(FK 也會擋,而這裡先擋是為了給員工看得懂的訊息) ────────
  SELECT c.tier INTO v_tier FROM public.customers c WHERE c.user_id = p_customer_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_create_manual_order: 找不到這位客人(user_id=%);請先建立客人資料',
                    p_customer_user_id;
  END IF;

  -- ── G4 收件快照:逐鍵白名單重組,**不收員工原樣的 jsonb** ───────────────────
  -- 🔴 表上有 exact-key CHECK(`20260604120000` orders_ship_addr_whitelist)
  --    ⇒ 多一個鍵就整筆回滾。這裡自己組,壞掉的輸入在這裡就講清楚。
  IF p_ship_to IS NULL OR pg_catalog.jsonb_typeof(p_ship_to) <> 'object'
     OR pg_catalog.btrim(COALESCE(p_ship_to ->> 'name', '')) = ''
     OR pg_catalog.btrim(COALESCE(p_ship_to ->> 'phone', '')) = ''
     OR pg_catalog.btrim(COALESCE(p_ship_to ->> 'line', '')) = '' THEN
    RAISE EXCEPTION 'admin_create_manual_order: 收件資料要有收件人 / 電話 / 地址三格,不得留空';
  END IF;
  v_ship_to := pg_catalog.jsonb_build_object(
    'name',  pg_catalog.btrim(p_ship_to ->> 'name'),
    'phone', pg_catalog.btrim(p_ship_to ->> 'phone'),
    'line',  pg_catalog.btrim(p_ship_to ->> 'line'));

  -- ── G5 發票:同樣逐鍵白名單 ────────────────────────────────────────────────
  IF p_invoice IS NULL OR pg_catalog.jsonb_typeof(p_invoice) <> 'object'
     OR COALESCE(p_invoice ->> 'type', '') NOT IN ('personal', 'company', 'donate') THEN
    RAISE EXCEPTION 'admin_create_manual_order: 發票類型要是 personal / company / donate 之一';
  END IF;
  -- 🔴 codex R2 `N1`:上一版這裡**沒有 trim** ⇒ 載具打成 `" ABC "` 與 `"ABC"` 會被算成
  --    兩包不同的內容 ⇒ 合法重送被拒。`NULLIF(btrim(…), '')` 讓「只打了空白」與「沒填」歸位到同一個值。
  -- 🔴🔴 **`NULLIF` 不加 `pg_catalog.` 前綴,那不是漏掉的,是唯一寫得對的寫法。**
  --    本函式其他每一個呼叫都寫成 `pg_catalog.xxx(...)`(因為 `SET search_path = ''`)
  --    ⇒ 照著那個風格會很自然地把這裡寫成 `pg_catalog.nullif(...)` —— **我自己就是這樣寫的。**
  --    而 `NULLIF` / `COALESCE` / `CASE` 是 **SQL 的語法構造,不是 `pg_catalog` 裡的函式**
  --    ⇒ `pg_catalog.nullif(...)` 會在**執行期**炸「function does not exist」。
  --    🔴 **那一發:靜態閘四道 + typecheck + lint + build + 本檔的 apply 斷言 —— 全綠。**
  --       plpgsql 的函式本體到**被呼叫**那一刻才解析名稱 ⇒ 上面每一道對它都是零判別力。
  --    ⚠️ ⇒ 誰要「統一風格」把前綴加回去:**請先跑一次真的呼叫**,不要只看它有沒有 apply 成功。
  v_invoice := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'type',       pg_catalog.btrim(p_invoice ->> 'type'),
    'carrier',    NULLIF(pg_catalog.btrim(p_invoice ->> 'carrier'), ''),
    'title',      NULLIF(pg_catalog.btrim(p_invoice ->> 'title'), ''),
    'taxId',      NULLIF(pg_catalog.btrim(p_invoice ->> 'taxId'), ''),
    'donateCode', NULLIF(pg_catalog.btrim(p_invoice ->> 'donateCode'), '')));

  -- ── G6 品項:逐筆驗 + 自算金額(**價錢不信 client 送的合計**) ──────────────
  FOR v_line IN SELECT * FROM pg_catalog.jsonb_array_elements(p_lines) LOOP
    v_sku   := pg_catalog.btrim(COALESCE(v_line ->> 'sku', ''));
    v_title := pg_catalog.btrim(COALESCE(v_line ->> 'title', ''));
    IF v_sku = '' OR v_title = '' THEN
      RAISE EXCEPTION 'admin_create_manual_order: 每個品項都要有料號與品名(收到 sku=[%] title=[%])',
                      v_sku, v_title;
    END IF;
    v_qty := NULLIF(v_line ->> 'qty', '')::integer;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'admin_create_manual_order: 品項 [%] 的數量要是正整數', v_sku;
    END IF;
    -- 🔴 codex R1 `:138`:`qty = 2147483647` 配 `unit_price = 0` ⇒ 金額守門**不會紅**
    --    (0 × 任何數還是 0)⇒ 一張「兩億件、零元」的單會真的建出來。
    IF v_qty > c_max_qty THEN
      RAISE EXCEPTION 'admin_create_manual_order: 品項 [%] 的數量 % 超過單筆上限 %;'
                      '真的要這個量 ⇒ 找系統維護(這個上限是保守預設值、未經拍板)',
                      v_sku, v_qty, c_max_qty;
    END IF;
    v_unit_price := NULLIF(v_line ->> 'unit_price', '')::integer;
    IF v_unit_price IS NULL OR v_unit_price < 0 THEN
      RAISE EXCEPTION 'admin_create_manual_order: 品項 [%] 的單價要是 0 或正整數', v_sku;
    END IF;
    -- 🔴 代購品項:`variant_id` 允許 NULL(`20260604120000:143`)⇒ 網站上沒有的商品也建得起來。
    v_variant_id := NULLIF(v_line ->> 'variant_id', '')::uuid;
    -- 🔴 `spec` 只收物件,而且**每個值都必須是字串**(表上 CHECK 會擋,這裡先講清楚)。
    v_spec := COALESCE(v_line -> 'spec', '{}'::jsonb);
    IF pg_catalog.jsonb_typeof(v_spec) <> 'object' THEN
      RAISE EXCEPTION 'admin_create_manual_order: 品項 [%] 的規格要是物件', v_sku;
    END IF;
    -- 🔴🔴 codex R1 `:203`:舊版**只驗到這裡為止**,底下三句話是靠
    --    `order_items_snapshot_whitelist` 這道表上的 CHECK 幫我擋的。
    --    ⇒ 那是**別人家的守門**:正式庫若缺它或它漂移了,**本檔的 apply 斷言不會紅**,
    --      而經銷價 / cost 會直接寫進快照裡。⇒ **自己驗一遍**(判準逐字對齊 `20260604120000:157-165`)。
    --    ⚠️ 這不是重複勞動:表上那道是**縱深**,這一道是**訊息** —— CHECK 紅的時候
    --       員工看到的是一串約束名,這裡紅的時候他看得到是哪一個品項的哪一種問題。
    IF NOT public.m3_jsonb_values_all_string(v_spec) THEN
      RAISE EXCEPTION 'admin_create_manual_order: 品項 [%] 的規格裡有不是字串的值(數字 / 巢狀物件 / 陣列);'
                      '規格只收「字串對字串」,那是為了擋價格欄藏在巢狀值裡', v_sku;
    END IF;
    IF v_spec ?| ARRAY['price_store', 'price_by_tier', 'cost'] THEN
      RAISE EXCEPTION 'admin_create_manual_order: 品項 [%] 的規格出現價格欄名(price_store / price_by_tier / cost);'
                      '訂單快照**絕不放經銷價與成本**', v_sku;
    END IF;
    -- 🔴 codex R2 `N1`:規格的鍵與值也要 trim —— 它們**進指紋**,而空白差異會讓合法重送被拒。
    --    ⚠️ 順序有意義:**先驗全值皆字串**(上面那道)**才能** `jsonb_each_text`,
    --       否則數字會被靜靜轉成字串、把該紅的那一發變綠。
    v_spec := COALESCE((SELECT pg_catalog.jsonb_object_agg(pg_catalog.btrim(k), pg_catalog.btrim(val))
                          FROM pg_catalog.jsonb_each_text(v_spec) AS t(k, val)), '{}'::jsonb);

    -- 🔴🔴 codex R1 `:186`:舊版**沒有任何跨列比對** ⇒ 員工手滑送兩列同一個變體,
    --    兩列各自計價 ⇒ `subtotal` / `total` **與退款分母**直接加倍。
    --    既有 `create_order` 明文要求同變體合併數量(`20260730120100:323` 逐字:「同變體應合併 qty」)。
    --    ⚠️ **代購品項(`variant_id` 是 NULL)怎麼去重**:它沒有變體可比 ⇒ 退而用 `料號 + 品名` 當鍵。
    --       兩列**料號與品名都一樣**幾乎只會是重送;真的是兩個不同東西 ⇒ 品名寫得出差別。
    -- 🔴🔴 codex R2 `N3`:上一版的代購鍵**只有 sku + 品名** ⇒ 兩個病一起犯:
    --    ① **太窄**:同料號同品名、但**規格或單價不同**的兩個代購品 ⇒ 被錯誤拒絕。
    --       ⚠️ 這一格的後果是**擋到合法的**(這裡是拒絕、不是合併)
    --       ⇒ 修的方向必須是**讓鍵更寬**,不是更嚴。
    --    ② **太鬆**:把品名中間的空白改一下 ⇒ 換一把鑰匙 ⇒ 真正的重複列繞過去。
    --    ⇒ 兩個方向一起修:**加進規格與單價**(變寬)+ **內部連續空白壓成一個**(變嚴)。
    v_key := COALESCE('variant:' || v_variant_id::text,
                      'custom:' || pg_catalog.lower(pg_catalog.regexp_replace(v_sku,   '\s+', ' ', 'g'))
                        || '|' || pg_catalog.lower(pg_catalog.regexp_replace(v_title, '\s+', ' ', 'g'))
                        || '|' || v_unit_price::text
                        || '|' || v_spec::text);
    IF v_key = ANY(v_seen) THEN
      RAISE EXCEPTION 'admin_create_manual_order: 重複品項 [%];同一個東西請**合併數量**寫成一列,'
                      '不要送兩列 —— 送兩列會讓總額與**可退金額**都變成兩倍', v_sku;
    END IF;
    v_seen := v_seen || v_key;

    v_line_total := v_unit_price::bigint * v_qty::bigint;
    v_subtotal := v_subtotal + v_line_total;
    v_items := v_items || pg_catalog.jsonb_build_object(
      'variant_id', v_variant_id,
      'variant_sku', v_sku,
      -- 🔴 exact-key 白名單:title / sku / spec 三鍵,**不得把員工輸入原樣塞進去**
      --    (`order_items_snapshot_whitelist`:多一鍵整筆回滾)。
      'product_snapshot', pg_catalog.jsonb_build_object('title', v_title, 'sku', v_sku, 'spec', v_spec),
      'quantity', v_qty,
      'unit_price', v_unit_price,
      'line_total', v_line_total);
  END LOOP;

  v_total := v_subtotal + p_shipping_fee;
  IF v_total > 2147483647 OR v_subtotal > 2147483647 THEN
    RAISE EXCEPTION 'admin_create_manual_order: 金額超出 integer 上限;這張單請拆開建';
  END IF;

  -- ── G6.5 冪等格(codex R1 `:143`;形狀照退款 RPC `20260820021000:245-270`)─────
  -- 🔴🔴 **這一段的上一版是一句假話,而它讀起來像一句保證**(codex R2 `N1` 抓到):
  --    ~~「多打一個空白、鍵的順序不同、發票欄位給了 NULL,都不會被誤判成不同內容」~~
  --    R1 當下的實情是:**發票與規格根本沒有 trim,品項也照原順序進指紋**
  --    ⇒ 那三件事**每一件都會**讓合法重送被拒。
  --    ⚠️ 這句話的危害不只是錯:**它會讓下一個人不去測那三件事** —— 我自己就沒測。
  --    ⇒ R2 把碼補齊之後,下面這句話**現在才成立**,而它成立是因為有三件事真的做了:
  --      ① 收件 / 發票 / 規格的鍵與值**全部 btrim**(空白只打了空白 ⇒ 等於沒填)
  --      ② 品項**排序後**才進指紋(順序不再影響指紋)
  --      ③ `jsonb` 本身把鍵排序、重複鍵消掉(這一件是 PG 給的,不是我做的)
  --    ⇒ 多打一個空白、品項換順序、鍵的順序不同、發票欄位給了 NULL,**都不會**被誤判成「不同內容」。
  --    📌 三件事各有一格負測釘著(`docs/probes/2026-08-24-858-manual-order-rpc-r2-negatives.sql` 的 R2-1b/1c/1e),不是只有這段話。
  -- ⚠️ **上限(誠實揭示)**:比的是**指紋**,所以只答得出「一樣 / 不一樣」,
  --    答不出**哪一欄**不一樣 —— 退款 RPC 那支比得出來,因為它比的是欄位。
  --    這裡的輸入是一整包(含品項陣列),逐欄比會隨著欄位增加而**靜靜漏掉新欄**;
  --    指紋不會漏,代價就是訊息比較鈍。**這是選擇,不是疏忽。**
  -- ⚠️ 另一格上限:`jsonb::text` 的輸出在**同一個 PG 大版本內**是決定性的(鍵已排序、
  --    重複鍵已消)。跨大版本若渲染改變 ⇒ 舊指紋對不上 ⇒ 會被判成「內容不同」而**拒絕**
  --    ⇒ 方向是 fail-closed(擋下來、不是放行)。
  -- 🔴 **`p_actor` 刻意【不進指紋】** —— 這是與 `20260820021000` 的**有意分歧**,不是漏掉:
  --    那支把 actor 放進逐欄比對,結果它必須為此寫一整段訊息教人怎麼辦
  --    (`:262-264` 逐字:「若你是在重送同一筆(**例如原經手人已停用而你換了人**)
  --     ⇒ 不要用新的 request_id」)。
  --    ⇒ 指紋要回答的問題是「**這是不是同一張單**」,而**誰按下送出不會改變那張單**。
  --      同事幫忙重送同一包內容 ⇒ 應該拿到 idempotent,不該被判成「內容不同」。
  --    ⇒ 「**誰建的**」由 `admin_audit_log` 那一列回答,那才是它該住的地方。
  --    ⚠️ **代價講明(2026-08-24 擴寫:我原本只寫了併發那一半,而它比那寬)**:
  --       **任何重送**,audit 都只會有**最初建單那一位**。
  --       · 併發:後到那發拿 `P858A`、不落 audit(它什麼都沒建)。
  --       · **非併發**:A 建單、B 一小時後拿同一顆 id 重送 ⇒ 回 `idempotent` ⇒ **B 這次操作零紀錄**。
  --    🔴 而**後者正是本設計自己舉的主要使用情境**(「原經手人已停用而你換了人」)
  --       ⇒ 它是**常態,不是邊角**。~~原本寫「併發時」~~ 那個限定把常態寫成了例外。
  --    ✅ 而這**不是缺陷**:B 沒有建單。`admin_audit_log` 記的是「**建單**」事件,不是「**請求**」事件
  --       ⇒ 不記 B 是**一致的**。⚠️ 但「誰碰過這張單」這條線索**確實不在系統裡** —— 要就得另立事件。
  v_canonical := pg_catalog.jsonb_build_object(
    'customer_user_id', p_customer_user_id,
    'order_source',     p_order_source,
    'payment_channel',  p_payment_channel,
    'shipping_method',  p_shipping_method,
    'shipping_fee',     p_shipping_fee,
    'ship_to',          v_ship_to,
    'invoice',          v_invoice,
    -- 🔴🔴 codex R2 `N1`:上一版直接把 `v_items` **照員工送來的順序**丟進指紋
    --    ⇒ 同樣的品項換個順序 ⇒ 指紋不同 ⇒ **合法重放被判成「內容不同」而拒絕**。
    --    ⇒ 排序後再算。排序鍵用 `x::text`:jsonb 轉文字時鍵已排序、重複鍵已消
    --      ⇒ 同一個 jsonb 值恆得同一個字串 ⇒ 是個穩定的鍵。
    --    ⚠️ **只有指紋排序,落表的 `order_items` 仍照員工原順序** —— 那是他要看的順序。
    'items',            (SELECT COALESCE(pg_catalog.jsonb_agg(x ORDER BY x::text), '[]'::jsonb)
                           FROM pg_catalog.jsonb_array_elements(v_items) AS x));
  v_payload_sha := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(v_canonical::text, 'UTF8')), 'hex');

  SELECT o.id, o.display_id, o.manual_request_payload_sha256 INTO v_existing
    FROM public.orders o
   WHERE o.manual_request_id = p_manual_request_id;
  IF FOUND THEN
    IF v_existing.manual_request_payload_sha256 IS NOT DISTINCT FROM v_payload_sha THEN
      -- 同一顆鍵、同一包內容 ⇒ 這就是重送。回既有那張單。
      RETURN pg_catalog.jsonb_build_object(
        'order_id', v_existing.id, 'display_id', v_existing.display_id, 'idempotent', true);
    END IF;
    -- 🔴 同鍵不同內容 ⇒ **拒絕**(合約逐字對齊 `20260820021000:257`)
    -- 🔴 codex R2 `N2` 連帶:這一條與上面那條的**下一步完全相反**
    --    (那條要「原樣重送」,這條是「**不准重送**」)⇒ 呼叫端必須分得出來
    --    ⇒ 兩條都給代碼,不能只給一條。
    RAISE EXCEPTION 'admin_create_manual_order: 這個建單請求的編號已經用過了,而**內容不一樣** ⇒ 拒絕。'
                    '🔴 **呼叫端合約**:SQLSTATE P858B / constraint pcm_858_manual_order_payload_mismatch ⇒ '
                    '**不要重送**(重送幾次都會是同一個答案)。'
                    '🔴 這不是「重複建單」的警告 —— 系統裡那張單(%)與你這次送來的至少有一處不同'
                    '(客人 / 品項 / 數量 / 單價 / 運費 / 收件資料 / 發票 / 來源 / 付款方式)。'
                    '⚠️ **先確認你要的是哪一件事**:'
                    '① 要**改**那張既有的單 ⇒ 去那張單上改,不要用建單重送(這裡不會幫你覆蓋它);'
                    '② 這是**另一張**單 ⇒ 請重新開一張建單表單(它會產一顆新編號),'
                    '   不要把舊表單改一改再送 —— 那顆編號綁的是**上一次那包內容**。',
                    v_existing.display_id
                    USING ERRCODE = 'P858B',
                          CONSTRAINT = 'pcm_858_manual_order_payload_mismatch';
  END IF;

  -- ── G7 建單(display_id 有界重試;形狀照 create_order `:432-463`) ───────────
  v_order_id := NULL;
  FOR v_attempt IN 1 .. 5 LOOP
    BEGIN
      v_display_id := public.pcm_generate_display_id();
      INSERT INTO public.orders (
        display_id, customer_user_id, address_id, shipping_address_snapshot, tier_at_checkout,
        subtotal, shipping_fee, discount_total, total, shipping_method, invoice,
        order_source, payment_channel, manual_request_id, manual_request_payload_sha256
      ) VALUES (
        v_display_id, p_customer_user_id, NULL, v_ship_to, v_tier,
        v_subtotal::integer, p_shipping_fee, 0, v_total::integer, p_shipping_method, v_invoice,
        -- 🔴 這兩欄顯式寫。不寫的後果見檔頭 §2。
        p_order_source, p_payment_channel, p_manual_request_id, v_payload_sha
      )
      RETURNING id INTO v_order_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
      -- 🔴🔴 codex R1 `:248`:**這條路不得回 `idempotent: true`。**
      --    舊版在這裡直接把既有那張單回出去 —— 而**它從來沒有比對過對方寫了什麼**
      --    ⇒ 上面 G6.5 那道逐內容比對,在「兩發並行」這條路上等於不存在。
      --    ⇒ 處置逐字沿用退款 RPC 對同一條路的定位(`20260820021000:311-316`):
      --      **拒絕本次、請呼叫端重試一次** —— 重試時 G6.5 就看得到那一列,也就會比對內容。
      --    ⚠️ 走到這裡只有一種情況:兩發並行、兩發都在 G6.5 查無、其中一發先寫進去。
      IF v_cname = 'orders_manual_request_id_uniq' THEN
        -- 🔴🔴 codex R2 `N2`:**上一版這裡是一顆沒有代碼的 RAISE,而它對呼叫端說「請重送」。**
        --    那句話有一個致命前提:**重送的人要用同一顆 request id。**
        --    而**今天 repo 裡沒有任何呼叫端實作那件事** ⇒ 前端最可能的行為是
        --    「這次失敗了 ⇒ 開新表單 ⇒ 產一顆新 id ⇒ 再送」
        --    ⇒ 🔴 **第一張單其實已經建好了,於是變成兩張真訂單、要出兩次貨。**
        --    ⇒ 病灶不是訊息寫得不夠清楚:**是我把一個決定交給了一個還沒被寫出來的呼叫端**,
        --      而它的預設行為剛好是錯的那一邊。
        --    ⇒ 修法=給它**機器讀得懂的把手**(SQLSTATE + CONSTRAINT token,體例照 repo 既有
        --      `P2B02` 那族),而不是只給人看的字。
        RAISE EXCEPTION 'admin_create_manual_order: 同一個建單請求正在被並行送出 ⇒ 拒絕本次。'
                        '🔴 **呼叫端合約(這一句是給程式看的,不是給人看的)**:'
                        '收到 SQLSTATE P858A / constraint pcm_858_manual_order_concurrent_request ⇒ '
                        '**保留同一顆 manual_request_id 原樣重送**,'
                        '⚠️ **絕對不要產生新的 manual_request_id** —— '
                        '這一刻另一發很可能已經成功建好那張單了,換新 id 會建出【第二張真訂單】。'
                        '重送時會走內容比對:內容相同 ⇒ 回那張已建好的單(idempotent:true);'
                        '內容不同 ⇒ 回 P858B。'
                        USING ERRCODE = 'P858A',
                              CONSTRAINT = 'pcm_858_manual_order_concurrent_request';
      END IF;
      -- 🔴 只吞 display_id 的碰撞;其他 unique violation 原樣上拋(重試會把語意訊號吃掉)。
      IF v_cname IS DISTINCT FROM 'orders_display_id_key' THEN
        RAISE;
      END IF;
      v_order_id := NULL;
      IF v_attempt = 5 THEN
        RAISE EXCEPTION 'admin_create_manual_order: display_id 連續 5 次碰撞、已放棄'
                        ' (pcm_display_id_exhausted)' USING ERRCODE = 'P0001';
      END IF;
    END;
  END LOOP;
  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'admin_create_manual_order: 建單迴圈離開時沒有訂單 id;拒絕繼續';
  END IF;

  -- ── G8 品項落表 + 筆數守 ───────────────────────────────────────────────────
  INSERT INTO public.order_items (
    order_id, variant_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  SELECT v_order_id,
         NULLIF(it ->> 'variant_id', '')::uuid,
         it ->> 'variant_sku',
         it -> 'product_snapshot',
         (it ->> 'quantity')::integer,
         (it ->> 'unit_price')::integer,
         (it ->> 'line_total')::integer
    FROM pg_catalog.jsonb_array_elements(v_items) AS it;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> pg_catalog.jsonb_array_length(v_items) THEN
    RAISE EXCEPTION 'admin_create_manual_order: 品項落 % 列、期望 %;整筆回滾',
                    v_n, pg_catalog.jsonb_array_length(v_items);
  END IF;

  -- ── G9 稽核落列(F1;形狀逐字對齊 `20260804180000:251-260`)────────────────
  -- 🔴 `before` 是 NULL 而不是 `{}` —— **這張單建立之前不存在**,那不是「空的狀態」是「沒有狀態」。
  -- 🔴 `after` 只放**訂單層**的欄與**筆數**,不逐品項展開:
  --    ① 品項細節在 `order_items`,`target` 指得到那張單 ⇒ 查得到,不必抄一份
  --    ② 稽核表是 append-only、永久留存 ⇒ **少抄一份 = 少一個會過期、會外洩的副本**
  --    ⚠️ 零經銷價、零 cost(本函式從頭到尾不查價,見檔頭 §4)。
  INSERT INTO public.admin_audit_log (actor, action, target, request_id, before, after, reason, source_app)
  VALUES (pg_catalog.btrim(p_actor, E' \t\r\n'), 'order.manual_create',
          -- ⚠️ **`request_id` 這一欄的語意在這裡與別的 admin 操作不同源**(f5 R3 nit,記一筆):
          --    建表註解(`20260712210000:51`)說它是「correlation id(貫穿 admin 寫入→audit→DB→外部服務 log)」,
          --    而本函式填的是**本片自己的冪等鍵** `manual_request_id`。
          --    ✅ 它**串得回那一次操作**(那正是 correlation 要的),所以合理、不改。
          --    ⚠️ 但**它不是別處那個 request_id 的同一條血脈** ⇒ 拿它跨操作做關聯查詢時要知道這件事。
          'order:' || v_order_id::text, p_manual_request_id::text,
          NULL,
          pg_catalog.jsonb_build_object(
            'display_id',       v_display_id,
            'customer_user_id', p_customer_user_id,
            'order_source',     p_order_source,
            'payment_channel',  p_payment_channel,
            'shipping_method',  p_shipping_method,
            'subtotal',         v_subtotal,
            'shipping_fee',     p_shipping_fee,
            'total',            v_total,
            'item_count',       pg_catalog.jsonb_array_length(v_items)),
          NULL, 'admin');
  -- 🔴 筆數守:trigger 抑制 / FORCE RLS ⇒ **零稽核的成功建單**,而那正是 F1 要擋的東西
  --    ⇒ 落不進去就整筆回滾,**不接受「單建好了但沒人知道是誰建的」**。
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'admin_create_manual_order: 稽核落 % 列(期望恰 1)⇒ 整筆回滾;'
                    '這張單不准在沒有經手人紀錄的情況下存在', v_n;
  END IF;

  -- ⚠️ **重送(idempotent)那條路【不落 audit】** —— 它在 G6.5 就 return 了。
  --    理由:那一發**什麼都沒建**,而 audit 記的是「發生了什麼」不是「誰按過按鈕」。
  --    ⇒ 一張單 = 恰一列 `order.manual_create`。查「誰建的」不會查到兩個人。

  -- 🔴 **刻意不寫 `order_legal_consents`** —— 手動單沒有客人的同意動作,偽造它是錯的。
  RETURN pg_catalog.jsonb_build_object(
    'order_id', v_order_id, 'display_id', v_display_id, 'idempotent', false);
END;
$fn$;

COMMENT ON FUNCTION public.admin_create_manual_order(uuid, uuid, text, text, text, text, jsonb, jsonb, integer, jsonb) IS
  '#858 後台手動建單(SECURITY DEFINER、search_path='''';service_role only)。十道守門:G1 逐格輸入驗(含 **actor 必填且須為啟用中 staff** + tappay 具名拒 + **品項筆數上限 50**)→ G3 客人存在 + 取當下 tier → G4 收件快照逐鍵白名單重組 → G5 發票逐鍵白名單 → G6 品項逐筆驗(含 **單筆數量上限 9999**、**spec 值型別與價格欄名自驗**、**跨列去重**)+ **server 自算金額**(不信 client 合計;variant_id 可 NULL = 代購品項)→ **G6.5 冪等格:同 manual_request_id 且**內容指紋相同**才回 idempotent:true,內容不同一律拒絕**(合約對齊 20260820021000)→ G7 建單(order_source / payment_channel **顯式寫**、display_id 有界重試 5 次、**併發撞冪等索引=拒絕並請重試,不回 idempotent**)→ G8 品項落表 + 筆數守 → **G9 稽核落列**(`admin_audit_log`,action=`order.manual_create`、target=`order:<id>`、request_id=冪等鍵、before=NULL、after=訂單層欄+品項筆數、source_app=admin、筆數守;🔴 落不進去整筆回滾 —— **不接受沒有經手人紀錄的單**;重送那條路不落 audit,一張單恰一列)。🔴 `p_actor` **不進內容指紋**(誰按送出不改變那張單;同事重送同一包內容應得 idempotent)。🔴 **不寫 order_legal_consents**(手動單無同意動作)。🔴 **不碰 create_order**。🔴🔴 **呼叫端合約(給程式讀的兩個代碼)**:`P858A` / `pcm_858_manual_order_concurrent_request` = 併發撞鍵 ⇒ **保留同一顆 manual_request_id 原樣重送**,**絕不可換新 id**(那一刻很可能已經建好一張單,換 id 會建出第二張真訂單);`P858B` / `pcm_858_manual_order_payload_mismatch` = 同鍵不同內容 ⇒ **不要重送**,要改單就去那張單上改、要開新單就重開表單拿新 id。';

-- 🔴🔴 **兩道 REVOKE,少一道都是開的**(`docs/patterns/revoking-function-execute-in-supabase.md`)
--    在 `public` 建的函式**出生就把 EXECUTE 給了 PUBLIC** ⇒ 只寫 GRANT 的話,**`anon` 叫得到它**。
--    ⚠️ **這不是我讀出來的,是本片的自我斷言③在拋棄式 PG 17.10 上把我擋下來的**
--       (2026-08-24:第一版只有 GRANT ⇒ apply 當場紅「對 anon/authenticated 開了 EXECUTE」)。
--    📌 該檔 `:92-97` 的實測表:只收 `FROM anon, authenticated`(不收 PUBLIC)⇒ **洞還在**。
REVOKE ALL ON FUNCTION public.admin_create_manual_order(uuid, uuid, text, text, text, text, jsonb, jsonb, integer, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_create_manual_order(uuid, uuid, text, text, text, text, jsonb, jsonb, integer, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_manual_order(uuid, uuid, text, text, text, text, jsonb, jsonb, integer, jsonb) TO service_role;

-- ══ 7. apply 時的自我斷言 ═════════════════════════════════════════════════════

DO $$
DECLARE
  -- 🔴 新物件收權斷言的【清單】(`scripts/migration-static-checks.sh` ③ 要它可被數)。
  --    **它防的不是「忘記收權」,是「忘記列」** —— 斷言只檢查你列出來的物件。
  --    🔴 結尾的 `::text[]` 不能拿掉(清單清空時 `ARRAY[]` 無法推斷型別)。
  v_relations text[] := ARRAY[]::text[];
  v_functions text[] := ARRAY[
    'public.admin_create_manual_order(uuid,uuid,text,text,text,text,jsonb,jsonb,integer,jsonb)'
  ]::text[];
  v_declares_nothing boolean := false;
  v_args text;
  v_n    integer;
  v_fn   oid;
  r      text;
BEGIN
  IF cardinality(v_relations) = 0 AND cardinality(v_functions) = 0 THEN
    IF NOT v_declares_nothing THEN
      RAISE EXCEPTION '新物件收權斷言:兩份清單都是空的。真的沒新建物件請把 v_declares_nothing 設 true(明示),不要留空。';
    END IF;
  END IF;
  -- ① 新欄與 partial 索引在,而且索引真的是 partial(普通 UNIQUE 會讓既有 NULL 列撞掉)
  SELECT count(*) INTO v_n FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.orders'::regclass AND attname = 'manual_request_id' AND NOT attisdropped;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '#858 驗收失敗 — orders.manual_request_id 不存在';
  END IF;
  SELECT count(*) INTO v_n FROM pg_catalog.pg_indexes
   WHERE schemaname = 'public' AND indexname = 'orders_manual_request_id_uniq'
     AND indexdef LIKE '%WHERE (manual_request_id IS NOT NULL)%';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '#858 驗收失敗 — 冪等索引不存在,或它不是 partial(索引應只裝手動單;'
                    '⚠️ 不是因為「多筆 NULL 會互撞」——那句是錯的,見檔頭 §3)';
  END IF;

  -- ①-b 指紋欄在(codex R1 `:143`:沒有它,冪等格就退化回「鍵在就回成功」)
  SELECT count(*) INTO v_n FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.orders'::regclass AND attname = 'manual_request_payload_sha256'
     AND NOT attisdropped;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '#858 驗收失敗 — orders.manual_request_payload_sha256 不存在;冪等格會變成只看鍵不看內容';
  END IF;

  -- ①-d codex R2 nit:兩欄的同生共死 CHECK 要在場(沒有它,毒化列就進得來)
  SELECT count(*) INTO v_n FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.orders'::regclass AND conname = 'orders_manual_request_pair_valid';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '#858 驗收失敗 — orders_manual_request_pair_valid 不在;「有鍵無有效指紋」的列擋不住';
  END IF;

  -- ①-e F1:稽核落列依賴 `admin_audit_log` 與 `staff` 兩張表 —— 少一張,
  --      本函式會在**第一個員工建單那一刻**才爆,而不是現在。
  IF pg_catalog.to_regclass('public.admin_audit_log') IS NULL THEN
    RAISE EXCEPTION '#858 驗收失敗 — 找不到 public.admin_audit_log;F1 的稽核落列無處可寫';
  END IF;
  IF pg_catalog.to_regclass('public.staff') IS NULL THEN
    RAISE EXCEPTION '#858 驗收失敗 — 找不到 public.staff;actor 守門無處可查(同 20260820021000:102)';
  END IF;

  -- ①-c 🔴 **我依賴的兩個外部物件要在場**(codex R1 `:203` 的另一半)
  --    G6 的 spec 驗證呼叫 `m3_jsonb_values_all_string`;快照的最後一道網是
  --    `order_items_snapshot_whitelist`。**任一不在,我上面那些話就有一句是空的**
  --    —— 而少了這一格,它會在**第一個客人建單的時候**才紅,不是在 apply 的時候。
  IF pg_catalog.to_regprocedure('public.m3_jsonb_values_all_string(jsonb)') IS NULL THEN
    RAISE EXCEPTION '#858 驗收失敗 — 找不到 public.m3_jsonb_values_all_string(jsonb);G6 的 spec 驗證會在執行期才爆';
  END IF;
  SELECT count(*) INTO v_n FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.order_items'::regclass AND conname = 'order_items_snapshot_whitelist';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '#858 驗收失敗 — order_items 少了 order_items_snapshot_whitelist;'
                    '經銷價零滲入的最後一道網不在場(本函式自己那道還在,但縱深只剩一層)';
  END IF;

  -- ② `create_order` 的**參數簽章**沒被動到 —— 作法照 `20260719120000:583-588`
  --    🔴 **codex R1 nit `:342` 收窄措辭**:原本這裡寫「一個字都沒被動到」,**那句是假的**。
  --       它比的是 `pg_get_function_arguments`,也就是**參數列**。
  --       ⇒ **同簽章的函式本體漂移,這道斷言不會紅。**
  --    ⚠️ 為什麼不改成比對本體的 md5(codex 給的另一個選項):那會在**任何人合法修改
  --       `create_order`** 之後讓本檔 apply 變紅,而紅的理由與本片無關
  --       ⇒ 製造一道「紅了但不是你的錯」的閘,而那種閘會訓練人略過它。
  --       ⇒ 選擇是**把話講準**,不是把守門加嚴到會誤爆。**這是取捨,不是漏掉。**
  SELECT pg_catalog.pg_get_function_arguments(p.oid) INTO v_args
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_order';
  IF v_args IS NULL THEN
    RAISE EXCEPTION '#858 驗收失敗 — 抓不到 create_order,下面那道斷言沒有判別力';
  END IF;
  IF v_args <> 'p_lines jsonb, p_address_id uuid, p_shipping_method text, p_invoice jsonb, '
              || 'p_cart_session_id uuid, p_terms_version text, p_client_ip text, p_client_ua text, '
              || 'p_notification_email text DEFAULT NULL::text' THEN
    RAISE EXCEPTION '#858 驗收失敗 — create_order 的簽章變了(現為 %);客人那條路必須零改變', v_args;
  END IF;

  -- ③ 清單裡每一支都要:存在 + 對 anon/authenticated 零 EXECUTE + service_role 有
  --    🔴 這一格在 2026-08-24 **當場擋下了我自己**:第一版只寫 GRANT 沒寫兩道 REVOKE,
  --       而 `public` 的函式**出生就把 EXECUTE 給了 PUBLIC` ⇒ anon 叫得到。apply 直接紅。
  FOREACH r IN ARRAY v_functions LOOP
    v_fn := pg_catalog.to_regprocedure(r);
    IF v_fn IS NULL THEN
      RAISE EXCEPTION '#858 驗收失敗 — 找不到函式 %(簽名打錯或沒建成);拒繼續', r;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '#858 驗收失敗 — % 對 anon/authenticated 開著 EXECUTE(兩道 REVOKE 少了一道?)', r;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '#858 驗收失敗 — % 對 service_role 沒有 EXECUTE(收太多)', r;
    END IF;
  END LOOP;

  -- ④ 零資料異動:既有列的 manual_request_id 必須全是 NULL
  SELECT count(*) INTO v_n FROM public.orders
   WHERE manual_request_id IS NOT NULL OR manual_request_payload_sha256 IS NOT NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '#858 驗收失敗 — 本片不該寫任何一列,卻有 % 列帶著冪等鍵或內容指紋', v_n;
  END IF;
END;
$$;

-- ══ 回滾(手動貼;本檔不自帶 down) ════════════════════════════════════════════
--   DROP FUNCTION IF EXISTS public.admin_create_manual_order(uuid, uuid, text, text, text, text, jsonb, jsonb, integer, jsonb);
--   DROP INDEX IF EXISTS public.orders_manual_request_id_uniq;
--   ALTER TABLE public.orders DROP COLUMN IF EXISTS manual_request_id;
--   ALTER TABLE public.orders DROP COLUMN IF EXISTS manual_request_payload_sha256;
-- ⚠️ 回滾前先確認**沒有任何一列**帶著 manual_request_id(有的話那是真的手動單,刪欄會弄掉冪等證據)。

COMMIT;
