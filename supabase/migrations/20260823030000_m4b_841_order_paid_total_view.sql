-- 20260823030000_m4b_841_order_paid_total_view.sql
-- `#841`:匯款登錄完,那張單從訂單列表消失
--
-- 🔴🔴 **本檔所有「唯一 / 全部 / 三條 / 每一個」這類量詞句,指的是【我當時列舉出來的那些】,
--    不是全集。** 2026-08-23 一天之內被推翻三次(「只有一處會寫 paid」/「唯一會壞而全綠的路」
--    /「三條直覺修法全部不可行」)。⇒ 讀到量詞句時當它是**已知清單**,不是**證明過的窮舉**;
--    要當窮舉用,先自己數一次。
--
-- 鐵則 12①(錢:述詞決定哪張單被員工看見,看不見 = 貨不會動)
--      12③(新 DB 物件 + CREATE OR REPLACE 既有 view;**零資料異動**)
--      12⑥(`packages/adapters` 的查詢跟著改)
--
-- ══ 1. 在修什麼 —— 單子沒有不見,是那道篩選【問錯了欄位】═══════════════════════
--
-- 現行隱藏規則(`packages/adapters/src/supabase/SupabaseOrderAdapter.ts:906-907`):
--     query.or('payment_channel.neq.tappay,payment_status.neq.unpaid')
--   ⇒ 隱藏 ⟺ `payment_channel = 'tappay'` AND `payment_status = 'unpaid'`
--
-- 而 `payment_status` **不是**「錢收到了沒」的單一真相。
--
-- ⚠️ **這裡原本寫「它的語意是『那張卡刷過了沒』」—— 那句已經過期,不要再抄**:
--    現金退款登記(`20260823010000:164-167`,`admin_finalize_order_refund`)**也寫這一欄**
--    (寫成 `refunded` / `partiallyRefunded`)⇒ 「人工那條路永遠不動這欄」已經是假的。
--
-- 🔴 **量得到的命題只有這一條**(2026-08-23 實查,分母 = `supabase/migrations/*.sql`):
--    **在正常運行路徑上**,`'paid'` 這個值**只由 `public.confirm_order_payment()` 寫**,
--    也就是刷卡確認那條路。
--
-- ⚠️ 🔴 **而「只由」這兩個字如果不加限定就是【假的】**(codex 2026-08-23 抓,他是對的;我複核過):
--    migration 的 **apply-time probe** 也直接寫它 ——
--      `20260820020000_m4b_e10_a8a3g_cancel_guard_sibling_dedup.sql:560`  `SET payment_status = 'paid'…`
--      同檔 `:646`  `INSERT INTO … payment_status … 'paid'…`(合成單 `PCM-9999-90002`)
--    那些是 apply 當下造出來的測資,不是業務路徑 —— **但它們確實會寫**。
--    📌 **這一句話今天已經被證明寫太滿【三次】**(我的初稿 / R2 的更正建議 / 這一次)。
--       三次都是同一個方向:**把「我掃到的」講成「全部」。** ⇒ 引用它之前先重掃一次。
--    ⚠️ 而那支函式全樹被 `CREATE OR REPLACE` **四次**,四處都有那句 `SET payment_status = 'paid'`:
--        `20260611120000:178`(最早)/ `20260804150000:127` / `20260810160000:448`
--        / `20260810170000:436`(**檔名序最大 = live**)
--    🔴 **所以「只有 `20260611120000:178` 一處會寫」是假的** —— 那是最早那一版,不是現行的。
--      (本註解初稿與 R2 的更正建議**都**寫成「只有一處」;逐字 grep 才看得出是四處同一支函式。)
--
-- ⇒ 對本片承重的那一句是:**人工收款(匯款 / 現金)不會把 `payment_status` 寫成 `'paid'`**,
--    它走的是 `order_payments` 帳本(`20260810100000`,檔頭逐字「本表記收款流入」)。
-- ⇒ **兩條路各自為真,而列表只問了其中一條。**
--
-- 病的形狀:客人刷卡失敗 → 改匯款 → 員工在訂單頁登錄收款(**每一步都成功**:今日實收算進來、
-- 面板顯示 1,500/1,500)→ 回到列表,**那張單不在預設清單裡**。
-- 🔴 它不是「解開了但走不通」,是「**走通了但走完會消失**」—— 後者更難自己發現,因為沒有一步是紅的。
--
-- ⚠️ **這是地雷不是火**(2026-08-23 主視窗對正式庫唯讀實測):現行述詞藏起來的 9 張裡,
--    帳本已收 > 0 的 = **0 張** ⇒ **修好的當下收穫 = 0 張**。它救的是【下一張】,不是這 9 張。
--    ⇒ 修它的成本最低。**不要把它讀成緊急。**
--
-- 📌 **留痕(兩份文件對那 9 張的說法不是同一個宣稱,而現在沒人對過)**:
--      plan `~/pcm-mailbox/58-841-…-plan-20260823.md` §3-b:「堆二 帳本零收款 ⇒ 9 張(已取消 7,未取消 2)」
--        ⇒ 這個版本說【9 張全部零收款】,7 只是其中的已取消數
--      主視窗 MAIN-133:「實查 9 張,7 張已取消;剩 2 張零收款」
--        ⇒ 這個版本【沒說】那 7 張的收款狀況
--    兩句可能是同一發統計的不同寫法,而**它們不是同一個宣稱**。本片不承重(下面的述詞
--    不管那 9 張長什麼樣都不會漏出已取消單,見 §3),**但下次可能承重** ⇒ 先記在這裡。
--
-- ══ 2. 🔴 三條走不通的路(先讀這段,免得又走一次)═════════════════════════════════
--
-- 📌 **「三條」= 我當時想到並逐條驗過的那三條,不是候選全集。**
--    第四條(本片走的)就是在驗完那三條之後才想出來的 ⇒ **這個清單本身證明它不是窮舉。**
--
-- 正確的述詞要問帳本「還欠多少」,而**帳本讀不到**:
--     `20260810100000_m4b_e10_op1_order_payments_m.sql:409-410` 逐字
--       ALTER TABLE public.order_payments ENABLE ROW LEVEL SECURITY;   （零 policy)
--       REVOKE ALL ON TABLE public.order_payments FROM PUBLIC, anon, authenticated, service_role, authenticator;
--   而訂單列表用的正是 service_role(`apps/admin/src/lib/orders/order-repository.ts:25`)。
--
--   ❌ PostgREST 直接 `.from('order_payments')`      ⇒ 每次都 42501,而**全 mock 的單測照樣全綠**
--                                                      (`20260815010000:7-9` 逐字記過同一句)
--   ❌ 內嵌子表做 anti-join                          ⇒ 同上,子表一樣讀不到
--                                                      (repo 內確有 anti-join 前例
--                                                       `SupabasePaidOrderScannerAdapter.ts:190-192`,
--                                                       **但那支的子表是 `email_outbox`,不是零 GRANT 的表**⇒ 不可照抄)
--   ❌ 對表補一句 GRANT                              ⇒ 🔴 **會讓一支既有 migration 下次 apply 整份炸掉**:
--                                                      `20260810100000:690-701` 有 apply-time 閘,掃 `pg_class.relacl`,
--                                                      出現 owner 以外的 grantee 就 RAISE(P2B20 / `pcm_op1_acl_extra_grantee`)
--
-- ⇒ 本片走的是**第四條**:建一張【只曝彙總、不曝列】的窄 view,由它去讀帳本。
--
-- ══ 3. 🔴 為什麼是「窄 view(definer)+ 外層 view(invoker)」的夾心 ═════════════
--
-- `admin_order_list_v` 是 `security_invoker = true`(`20260816050000:72`)——
-- 那表示它的子查詢用【**呼叫者**】的身分跑,而呼叫者是 service_role,而 service_role 對帳本零 GRANT
-- ⇒ **直接在它裡面加一個讀 `order_payments` 的子查詢會 42501。**
--
-- ⇒ 夾心:窄 view `order_paid_totals_v` 設 `security_invoker = false` ⇒ 用【**view 擁有者**】的身分讀帳本;
--   外層維持 `invoker = true`,只需要 service_role 對**窄 view** 有 SELECT。
--
-- 📏 **這不是推的 —— 2026-08-23 拋棄式 PG 17.10 + PostgREST 14.16 逐發量過**
--    (owner 刻意建成**非 superuser**,對齊正式庫 postgres `rolsuper=false`;
--     service_role 建成 `BYPASSRLS`,對齊正式庫。少了這一格,下面每一發綠都不算數而且沒有訊號):
--      service_role 直讀 order_payments              ⇒ ERROR: permission denied for table order_payments
--      owner 直讀(正對照)                          ⇒ 4 列                    ← 尺是活的
--      service_role 讀窄 view(invoker=false)        ⇒ 3 列 / 合計 3000        ✅
--      🔴 同樣的 view 但 invoker=true(負向)         ⇒ ERROR: permission denied for table order_payments
--      service_role 讀外層 admin_order_list_v        ⇒ 6 列 / 有錢的 2         ✅ 夾心通
--      anon / authenticated 讀兩張 view(各兩發)     ⇒ 四發全 permission denied for view <名>
--    消融(證明下面那兩道 REVOKE 是承重的):
--      完全不下 REVOKE        ⇒ anon 讀得到 3 列   ← 平台預設真的把新物件生成開的
--      🔴 只下 `FROM PUBLIC`  ⇒ anon **照樣讀得到** ← view 也吃「方向甲」這一款,不是只有函式
--      兩道都下               ⇒ anon 被擋
--
-- ⚠️ **刻意放寬,寫下來不是順手**:service_role 從「完全讀不到帳本」變成「讀得到每張單的**已收總額**」。
--    曝的是**彙總不是列** —— 逐筆的軌別 / 時點 / 沖銷旗標都不在這張 view 裡。
--    ⇒ 這是本片付出的代價,審查請針對它,不要略過。
--
-- ══ 4. 新的隱藏規則(逐字,而它是今天隱藏面的【真子集】)═════════════════════
--
--   隱藏 ⟺ tappay AND unpaid AND NOT(已收 ≠ 0 AND 未取消)
--
-- 🔴 **方向要講對**(Fable R2 F1 抓的;而寫反的那句是主視窗先寫、我照抄的):
--    新隱藏面 = `tappay ∧ unpaid ∧ (零收 ∨ 已取消)` ⊊ 今天的 `tappay ∧ unpaid`
--    ⇒ 新的是今天的**真子集**,**不是**包含。
--    ⇒ 所以保證的是「零新被**藏**」(只會有東西跑出來),不是「零新被放出」。
--    ⚠️ 照「包含」那個字面推,會推出相反的方向 ⇒ 複核的人會簽錯邊。
--
-- 📐 而這件事**不依賴那六張測試單**(R2 給的證明,比我的樣本強):
--    diff 保留原兩項逐字、只在**顯示面**的 OR 加第三個 disjunct
--    ⇒ 三值邏輯下多一個 disjunct 只能把結果從 false/NULL 推向 true、**不能 true→false**
--    ⇒ 「零新被藏」是**恆真式**。下面那六張單是佐證,不是唯一依據。
--   PostgREST:'payment_channel.neq.tappay,payment_status.neq.unpaid,and(paid_total.neq.0,cancelled_at.is.null)'
--
-- 🔴 `cancelled_at` 那一格**不是額外加一條「已取消不顯示」的規則**,是收進【**復活條件**】裡:
--    「有錢 **而且** 沒取消」才把它放出來。差別是實測出來的,不是風格:
--      六張測試單(1 已付款 / 2 未付零收 / 3 未付有 1500 / 4 未付一收一沖淨額 0 /
--                  5 未付有 1500 **但已取消** / 6 現金未付零收)
--        現行述詞                        ⇒ 1, 6
--        三項平鋪 `paid_total.neq.0`     ⇒ 1, 3, **5**, 6   🔴 5 是已取消單,今天被藏、那樣改會跑出來
--        本片(巢狀 and)                ⇒ 1, 3, 6          ✅
--    ⇒ **今天被藏的一張都沒有多跑出來,只多放行 `#841` 要救的那一種。**
--    ⚠️ 同款警告 `SupabaseOrderAdapter.ts:845-847` 逐字寫過:`.or()` 不會自帶 `cancelled_at`,
--       不加就會撈回已取消的單(**那一列真的跑出來過**)⇒ 員工按「待處理」會看到一批寫著「已取消」的單。
--
-- 巢狀 `and()` 寫在 `or()` 裡,同檔 `:838-841` 記著片0「沒測過 `in.(…)` 寫在 `or=()` 裡面」
-- ⇒ 巢狀 `and()` 同樣沒測過 ⇒ **量了,沒有憑推論改**:
--      負向 `or=(and(paid_total.eq.99999,cancelled_at.is.null))`  ⇒ 空
--      正對照 `or=(and(paid_total.eq.1500,cancelled_at.is.null))` ⇒ 3
--      亂語法 `or=(paid_total.zzz.0)`                             ⇒ HTTP 400   ← 它不是照單全收
--      兩道 `.or()` 疊(本規則 + `payment_status.eq.unpaid`)      ⇒ 3, 6 = 兩集合的交集
--                                                                   (括號沒保住的話會是 1..6)
--      count 跟著述詞走:`Content-Range` 無述詞 `0-5/6` ⇒ 有述詞 `0-2/3`
--
-- ⚠️ **效度限制**:上述量測用的是**最小欄位的替身表**,量的是【權限機制】與【述詞語意】兩件,
--    那兩件不依賴欄位形狀。真表的 apply 由本檔 §7 的斷言 + 拋棄式全樹 apply 覆蓋。
--    本機 PostgREST 14.16;**正式站版本未查** —— 巢狀 `and()` 是老語法,風險低,但這是【未確認】不是【量到】。
--
-- ══ 5. 窄 view ════════════════════════════════════════════════════════════════
--
-- 🔴 `security_invoker = false` 是**這張 view 存在的全部理由**。有人把它改成 true
--    ⇒ 列表當場 42501。§7 的斷言 ⑦ 釘住它。
-- 🔴 只曝 `(order_id, paid_total)` 兩欄。**不要為了方便多帶一欄** —— 每多一欄都是在擴大 §3 那段
--    寫下來的代價,而擴大的那一次不會有人重新審它。
-- 🔴🔴 **裸 `CREATE`,不是 `CREATE OR REPLACE`** —— 我第一版寫了 `OR REPLACE`,理由是
--    「Sean 手貼、中途失敗會重貼」。**那個理由是真的,而那個修法是錯的**(codex M5 抓,他是對的):
--    `docs/patterns/revoking-function-execute-in-supabase.md:171-193` 逐字 ——
--      「`OR REPLACE` 是在說『我不在乎它本來在不在』。而 migration 的多數情境裡,你【非常在乎】。」
--      「跳過之後最毒的一段是:你的 `REVOKE` 與斷言會對著【那個既有的、你沒看過的物件】跑,
--        而它們很可能通過 ⇒ **你會拿到一個綠燈,而你這支 migration 什麼都沒建。**」
--    ⇒ 正式庫若已經有同名 view(別人建的、或上一次半途成功),`OR REPLACE` 會**靜靜蓋掉它**,
--      而下面每一條斷言都會對著那個新定義通過 ⇒ **看不出世界跟我想的不一樣。**
--
-- ⇒ 重貼的需求改用**明寫的前提斷言**接(同一段規則指定的做法):讓它**紅**,而不是讓它安靜。
DO $precondition$
BEGIN
  IF to_regclass('public.order_paid_totals_v') IS NOT NULL THEN
    RAISE EXCEPTION '#841 前提不成立 — public.order_paid_totals_v 已經存在。'
      '本片建的是【新物件】,它不該在。可能的原因:①這支 SQL 上次已經貼成功過(那就不用再貼)'
      '②正式庫上有人建了同名 view(那要先看那一張是什麼,不要蓋掉它)。'
      '🔴 確認要重建才手動 DROP —— 本檔【不替你 DROP】。'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_841_view_already_exists';
  END IF;
END
$precondition$;

CREATE VIEW public.order_paid_totals_v
  WITH (security_invoker = false) AS
SELECT
  p.order_id,
  -- 口徑照 `20260815010000:18-20`:直接加總、不得過濾負列、不得 ABS、不得只算非沖銷列。
  -- ⚠️ 這裡的 `COALESCE` 在本形狀下**到不了**(`GROUP BY` 保證每組至少一列、`amount` NOT NULL
  --    且有 `CHECK (amount <> 0)`)—— 留著是為了讓「零列回 NULL」這個 SQL 陷阱在**兩層都被擋住**,
  --    而**真正承重的那個 COALESCE 在外層**(見那裡的註解)。
  COALESCE(SUM(p.amount), 0) AS paid_total
FROM public.order_payments p
GROUP BY p.order_id;

COMMENT ON VIEW public.order_paid_totals_v IS
  '#841:每張訂單的帳本已收淨額(直接加總 amount,沖銷列為負)。security_invoker=false 是刻意的 —— 底表 order_payments 零 GRANT,只有 view 擁有者讀得到。只 GRANT SELECT 給 service_role。';

-- 🔴 兩道 REVOKE,少一道都是開的(`docs/patterns/revoking-function-execute-in-supabase.md`)。
--    本專案 `pg_default_acl` 對 public schema 的表與 view 有 `anon=arwdDxtm, authenticated=arwdDxtm`
--    ⇒ **新物件一出生就被授權**(`20260816050000:118-120` 實查過)。
--    「只下 FROM PUBLIC 就夠了」在 2026-08-23 的拋棄式 PG 上**實測為假**(§3 消融第二列)。
-- 🔴🔴 **`service_role` 也要收** —— 這一格是 2026-08-23 R1 的 nit 逼我加嚴斷言之後**實測撞出來的**,
--    不是照抄前例:前例(`20260816050000:123-125`)只收 PUBLIC 與 anon/authenticated,
--    而 `ALTER DEFAULT PRIVILEGES` **同樣把整套權限發給 `service_role`** ⇒ 它從來沒被收過。
--    拋棄式 PG 實查(套完真樹之後,兩張 view 各 8 條):
--      service_role 拿到 DELETE / INSERT / MAINTAIN / REFERENCES / SELECT / TRIGGER / TRUNCATE / UPDATE
--    ⇒ `GRANT SELECT` 那一句**什麼都沒加**,它一直都有更多。
--    (母題逐字見 `docs/patterns/revoking-function-execute-in-supabase.md:8`:
--     「新表的危害比新函式大:ADP 給表的是**整套寫權限含 `TRUNCATE`**,而 `TRUNCATE` **不受 RLS 管**。」)
REVOKE ALL ON public.order_paid_totals_v FROM PUBLIC;
REVOKE ALL ON public.order_paid_totals_v FROM anon, authenticated, service_role;
GRANT SELECT ON public.order_paid_totals_v TO service_role;

-- ══ 6. 外層 view 加一欄 —— **只加 `paid_total`,`goods_axis` 那段一字未動** ═══════
--
-- 🔴 下面整段是從 `20260816050000_m4b_522_goods_axis_subtract_cancelled.sql:71-114`
--    **原樣抽出**再插入新欄的(不是重打)。`goods_axis` 的 CASE 順序與 `cancelled_quantity`
--    三處扣減都必須逐字對齊 `orderGoodsAxis()`,§7 的斷言 ②③ 承接 `#522` 的守門原樣再跑一次。
-- ⚠️ `CREATE OR REPLACE VIEW` 只准在**尾端**加欄 ⇒ `paid_total` 排在 `goods_axis` 之後。
--
-- ⛔🔴🔴 ~~(已查:`20260816050000` 之後**沒有**任何 migration `ALTER TABLE public.orders`
--    ⇒ `o.*` 的展開穩定,不會把新欄插到 `goods_axis` 前面而讓 REPLACE 炸掉。
--    最後一支動 orders 的是 `20260729010000`。)~~ **這段自 2026-08-24 起為假 —— 見 `#957`。**
--
--    🔴 **本檔在【已經套用過 `20260824020000` 的 schema 上】重跑就會炸**
--       (2026-08-29 線A 拋棄式 PG 17.10 實測,逐字):
--      ERROR:  cannot change name of view column "goods_axis" to "manual_request_id"
--      HINT:   Use ALTER VIEW ... RENAME COLUMN ... to change name of view column instead.
--    ⚠️ **前提要寫在句子裡**(R1 抓的):乾淨庫照檔名序從頭跑,本檔跑在 `manual_request_id`
--       **出生之前** ⇒ 那一發**不會炸**。⇒ 會炸的是【線上那種已經長好的 schema】,
--       也就是**真正會發生的那一種**。
--    成因:`20260824020000_m4b_858_admin_create_manual_order.sql` 的
--         `ALTER TABLE public.orders` **真陳述式 3 句**(`:142` / `:147` / `:165`),
--         其中 `:142` 加了 `manual_request_id`
--         ⇒ `o.*` 展開後它排在 `goods_axis` 之前 ⇒ REPLACE 變成「插欄進中間」。
--    ⛔ ~~原稿寫「6 句」~~ 作廢 —— **那是 `grep -c` 的原始命中,含註解裡的 grep 指令與
--       被註解掉的 rollback。** 濾註解的數法寫在 `#957`。
--    🔴 **負對照(它證明這與後來的 B1 無關)**:在一個**完全沒有 B1** 的 schema 上跑,
--       印的是**一字不差的同一句** ⇒ **不是 B1 造成的,B1 只是第二個。**
--
--    📌 **為什麼要就地劃掉而不是只開 backlog**:上面那句是【當時】正確的,
--       而**它不會知道自己過期了**。留著它比沒有它更糟 ——
--       🔴 **它會關掉下一個人的懷疑**:讀到「已查」兩個字,就不會再去數一次。
--    ⇒ 要動這支 view ⇒ 改 `DROP VIEW` + `CREATE VIEW`,或改寫成不用 `o.*`。
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
  ) AS goods_axis,
  -- 🔴 契約③(`#841` 新增):**純量子查詢,形狀刻意與 `goods_axis` 同款** —— 不 join。
  --    用 LEFT JOIN 也做得到,而純量子查詢多兩件事:
  --      ① 上游若哪天變成一單多列,`LEFT JOIN` 會**安靜地把訂單複製成多列**(分頁與 count 一起壞),
  --         純量子查詢則直接 `ERROR: more than one row returned by a subquery` ⇒ **吵著死,不是安靜地錯**
  --      ② `FROM` 子句一個字不動 ⇒ `CREATE OR REPLACE` 是純加法,既有 15 欄與四層 embed 的形狀不受影響
  --
  -- 🔴🔴 **這個 COALESCE 是承重的,不是保險絲**:`order_paid_totals_v` 只為【有收款列的單】產生列
  --    ⇒ 沒收過款的單在這裡是 **零列 ⇒ 純量子查詢回 NULL**,而 PostgREST 的 `paid_total.neq.0`
  --    碰到 NULL 回 NULL(不是 true)⇒ 那些單**照樣被藏**。
  --    ⚠️ 於是「規則藏對了」與「NULL 巧合藏對了」在畫面上長得一模一樣,**而三綠與 mock 單測全綠**
  --    (同款警告逐字見 `20260815010000_m4b_e10_16_admin_today_payment_total.sql:24-26`)。
  --    ⇒ 下面 §7 的驗收 ⑦c 就是專門紅這一格的;拿掉 COALESCE 而庫裡有任何一張單 ⇒ **必紅**
--      (NULL `IS DISTINCT FROM` 實際 SUM ⇒ true)。
  --
  -- 🔴 口徑不得自創:「已收 = SUM(amount)」是承重不變式(`20260810100000:197`),
  --    沖銷列帶負值 ⇒ **直接加總、不得過濾負列、不得 ABS、不得只算非沖銷列**
  --    (`20260815010000:18-20` 逐字)。淨額 0 = 收了又沖掉 = 錢不在我們手上 ⇒ 該藏。
  --    ⚠️ **加總看正負是對的;分類看正負是錯的** —— 要認哪列是沖銷只准看 `is_reversal`
  --    (`apps/admin/src/lib/orders/payment-list-view.ts:28-31`)。本欄只加總,不分類。
  -- 🔴🔴 `COALESCE` 必須包在【純量子查詢外面】—— 包在裡面等於沒有:
  --    子查詢命中零列時,回 NULL 的是**子查詢本身**,裡面的 COALESCE 一次都沒執行。
  --    (2026-08-23 我第一版就是寫在裡面,真表實測 `paid_total=NULL`;當時的斷言 ④ 紅了、抓到它。
--     ④ 後來被 ⑦c 取代 —— 理由見那一段。)
  COALESCE((
    SELECT t.paid_total
      FROM public.order_paid_totals_v t
     WHERE t.order_id = o.id
  ), 0) AS paid_total
FROM public.orders o;

-- 🔴 `CREATE OR REPLACE VIEW` 保留既有 ACL,**但不靠它**(`20260816050000:116-122` 同一立場):
--    成本是三行,而漏掉的代價是全體訂單外洩。
-- 🔴🔴 **本片對【既有物件】做了一次收緊,而它不是順手 —— 明寫在這裡讓審查看得到:**
--    `admin_order_list_v` 從 `20260814140000` 建立以來,`service_role` 一直握著整套 8 條權限
--    (含 INSERT / UPDATE / DELETE),來源是平台的 `ALTER DEFAULT PRIVILEGES`,**沒有任何一支 migration
--    收過它**。本片把它收成只剩 SELECT。
--
-- 📏 **今天它寫不進去 —— 而「今天」是限定詞,不是結論**(2026-08-23 拋棄式 PG 實打):
--    ```
--    SET ROLE service_role; UPDATE public.orders            SET total=999 …  ⇒ permission denied for table orders
--    SET ROLE service_role; UPDATE public.admin_order_list_v SET total=999 … ⇒ permission denied for table orders
--    正對照 pg_relation_is_updatable ⇒ view 與 orders 表同為 28(它【是】可自動更新的)
--    ```
--    🔴 擋住它的**不是**「view 不可更新」,是 **`security_invoker = true`** ——
--    寫入用呼叫者的身分去查底表,而 `service_role` 對 `orders` 的寫權早被明文收掉
--    (`20260611120000:239` 逐字 `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.orders FROM service_role;`
--     行尾註解「保留 SELECT(admin 唯讀…)」)。
--    ⇒ **誰把這張 view 翻成 `security_invoker = false`,那 8 條權限【當場變活】**,
--      而 `service_role` 就繞過了那道刻意的分級。
--    ⇒ 這也是 `#841` 選案時**否掉「把外層翻成 definer」那條路的第二個理由**
--      (第一個是它會擴大讀取面)—— 而這個理由當初沒人講出來,是加嚴斷言之後才撞到的。
--    ⇒ 下面 §7 **斷言 ⑥** 釘住 `invoker = true`,**它守的是安全,不只是正確性。**
REVOKE ALL ON public.admin_order_list_v FROM PUBLIC;
REVOKE ALL ON public.admin_order_list_v FROM anon, authenticated, service_role;
GRANT SELECT ON public.admin_order_list_v TO service_role;

-- ══ 7. apply 時的自我斷言 ═════════════════════════════════════════════════════
--
-- ⚠️ 大多只驗結構;**斷言 ⑦c 是唯一的值層斷言**,而它是本片最容易安靜退化的那一格。
DO $verify$
DECLARE
  v_def       text;
  v_inner_def text;
  v_cnt       integer;
  v_null_cnt  integer;
  v_rel       text;
BEGIN
  SELECT pg_get_viewdef('public.admin_order_list_v'::regclass, true) INTO v_def;
  SELECT pg_get_viewdef('public.order_paid_totals_v'::regclass, true) INTO v_inner_def;

  -- ① 🔴 正向對照:抓不到定義的話,下面每一條都恆真(照 `#522` 同款,不省)
  IF v_def IS NULL OR position('goods_axis' in v_def) = 0 OR position('paid_total' in v_def) = 0 THEN
    RAISE EXCEPTION '#841 驗收失敗 — 抓不到外層 view 定義,或裡面缺 goods_axis / paid_total,下面的斷言沒有判別力';
  END IF;
  IF v_inner_def IS NULL OR position('paid_total' in v_inner_def) = 0 THEN
    RAISE EXCEPTION '#841 驗收失敗 — 抓不到窄 view 定義,下面的斷言沒有判別力';
  END IF;

  -- ② 承接 `#522`:三條判定都要扣取消量。**本片重建了這張 view,所以要重驗一次。**
  SELECT count(*) INTO v_cnt FROM regexp_matches(v_def, 'cancelled_quantity', 'g');
  IF v_cnt <> 3 THEN
    RAISE EXCEPTION '#841 驗收失敗 — 我重建 view 時把 #522 弄壞了:定義裡 cancelled_quantity 應 3 次,實 %', v_cnt;
  END IF;

  -- ③ 承接 `#522`:判序不可倒(六個 position 的嚴格交錯;理由與限度見 20260816050000:174-181)
  IF NOT (
        position('s.shipped_quantity' in v_def) > 0
    AND position('s.shipped_quantity' in v_def) < position('THEN ''shipped''' in v_def)
    AND position('THEN ''shipped''' in v_def) < position('s.instock_quantity' in v_def)
    AND position('s.instock_quantity' in v_def) < position('THEN ''instock''' in v_def)
    AND position('THEN ''instock''' in v_def) < position('s.ordered_quantity' in v_def)
    AND position('s.ordered_quantity' in v_def) < position('THEN ''ordered''' in v_def)
  ) THEN
    RAISE EXCEPTION '#841 驗收失敗 — 我重建 view 時把 #522 的 CASE 配對或順序弄壞了';
  END IF;

  -- ══ ⑦b 🔴🔴 definer fail-open 面 —— 「壞掉而全綠」的**其中一條**路 ═══════════════
  --
  -- 🔴 **上一版這裡寫「本片【唯一】會壞掉而全綠的那條路」,而那句已經被推翻兩次**
  --    (codex 第三輪:重複列 ⑦d、以及無效 policy 的情況)。
  --    📌 而它是**上一輪才剛寫下的** —— 寫的當下我剛驗完六個世界,於是把「我列舉的」寫成了「唯一」。
  --    ⇒ **判別句:打出「唯一 / 全部」就當場停下來數。而「我剛驗過所以我知道」不算數過 ——
  --      我驗的是【我列舉的那幾個世界】。**
  --
  -- `order_paid_totals_v` 是 `security_invoker = false` ⇒ 它用**自己的擁有者**的身分去讀
  -- 零 GRANT 的 `order_payments`。這一格守那個身分。
  --
  -- ⚠️ **兩種壞法的形狀【不一樣】,而我第一版把它們寫成同一種(實測更正)**:
  -- ```
  -- ⑦b-1 擁有者沒有 SELECT   ⇒ 2026-08-23 實測:**大聲炸** `ERROR: permission denied for table order_payments`
  --                             ⇒ 不是靜默。列表會壞得很明顯。
  --                             (做法:ALTER VIEW … OWNER TO 一個讀不到帳本的角色,再跑驗收區塊)
  -- ⑦b-2 底表開 FORCE RLS    ⇒ 這一種**才是靜默回空**(我沒有在本機重現 —— 本機 owner 是 superuser、
  --                             繞過 RLS ⇒ 重現不了。依據是 `20260811090000:255-262` 的三案對照表)
  -- ```
  -- 🔴 **而不論哪一種,⑦c 那格都接得住** —— 它問的是「有收款的單 paid_total 是不是真的非 0」,
  --    對成因不敏感。⑦b 的價值是**把錯誤訊息講清楚**,不是唯一防線。
  --
  -- 🔴🔴 **順序**:本段刻意排在值層斷言之前(R1 點名的「順序遮蔽」,而我實測撞到了)——
  --    ⑦c 會 `SELECT … FROM admin_order_list_v`,而擁有者讀不到時**它會先炸**,
  --    印出來的是 `permission denied for table order_payments`:
  --    那句話**沒有告訴下一個人「窄 view 的擁有者不對」**,他會去查錯的地方。
  --    ⇒ 先跑權限、再跑值。**閘的順序決定人看到哪一句話。**
  --
  -- 靜默回空那一種的完整形狀(⑦b-2 / 以及任何讓窄 view 回不出列的原因):
  -- ```
  -- 窄 view 回零列 ⇒ 外層純量子查詢命中零列 ⇒ COALESCE 把它變成 0
  --   ⇒ 每一張單的 paid_total 都是 0 ⇒ 述詞 `paid_total.neq.0` 永遠 false ⇒ **`#841` 完全沒修**
  --   ⇒ 而純結構的那幾格全過(它們對「回零列」為真)⇒ **這正是 ⑦c 存在的理由**
  -- ```
  -- 🔴 「靜默回空」是這一族最毒的失敗:沒有錯誤、沒有紅,只有一個有信心的錯答案
  --    (逐字同 `20260811090000:253`;house 對「definer 讀零 GRANT 表」一律有這道閘)。
  --
  -- ⚠️ **我的 spike 用非 superuser 的 owner 量過這個機制可行** —— 但那是「**實驗室裡證明做得到**」,
  --    **不是「正式庫上有一道閘在看」**。兩件事。R1 指出這一格時,新檔對 `relowner`
  --    / `relforcerowsecurity` / `has_table_privilege` **零命中**。
  --
  -- ⚠️ **本閘只在 apply 當下跑** ⇒ 事後才被改的情況它看不到(同 `20260811090000:262` 的已知限制)。
  DECLARE
    v_owner oid;
  BEGIN
    SELECT relowner INTO v_owner FROM pg_catalog.pg_class
     WHERE oid = 'public.order_paid_totals_v'::regclass;

    -- ⑦b-1 擁有者**讀得到底表嗎** —— 直接問那個承重的問題,不繞道問 owner 名字
    IF NOT pg_catalog.has_table_privilege(v_owner, 'public.order_payments'::regclass, 'SELECT') THEN
      RAISE EXCEPTION '#841 驗收失敗 — 窄 view order_paid_totals_v 的擁有者(%)對 order_payments 沒有 SELECT。'
        '⇒ 每一次讀列表都會炸 permission denied for table order_payments,而那句話指向底表、'
        '不會告訴你【是這張 view 的擁有者不對】。修法:把 view 的擁有者換回讀得到帳本的角色。',
        pg_catalog.pg_get_userbyid(v_owner)
        USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_841_definer_cannot_read';
    END IF;

    -- ⑦b-2 FORCE RLS —— 照 `20260811090000:255-262` 的做法,連同它記下的那個限定一起抄:
    --    | owner 形狀                                   | FORCE RLS | 結果 |
    --    | `rolbypassrls=true`(正式站 postgres 就是這個) | on  | 照常回列,**不受影響** |
    --    | `rolbypassrls=false`                          | on  | **靜默回空** |
    --    | `rolbypassrls=false`                          | off | 正常(對照組) |
    --    ⇒ **BYPASSRLS 連 FORCE RLS 也一起繞過** ⇒ 以今天的 owner 而言這條路走不到。
    --      這一半守的是「**owner 換成沒有 BYPASSRLS 的角色**」那個未來。
    --    🔴 我**不放寬成「owner 有 BYPASSRLS 就免驗」** —— 那等於把閘綁在今天的部署形狀上,
    --      而閘要守的正是那個形狀被換掉的那一天。
    IF (SELECT relforcerowsecurity FROM pg_catalog.pg_class
         WHERE oid = 'public.order_payments'::regclass) THEN
      RAISE EXCEPTION '#841 驗收失敗 — order_payments 開了 FORCE ROW LEVEL SECURITY ⇒ '
        '窄 view 的擁有者若沒有 BYPASSRLS 就會【靜默回空】(見本段的三案對照表)'
        USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_841_force_rls_silent_empty';
    END IF;

    -- ⑦b-3 🔴🔴 **FORCE RLS 不是唯一一條靜默路 —— 普通 RLS 配零 policy 就夠了**(codex M3 抓的)。
    --    `order_payments` **本來就是** RLS on + 零 policy(`20260810100000:409-410`)。
    --    RLS 只放過兩種身分:**表的擁有者**、以及**具 BYPASSRLS 的角色**。
    --    ⇒ 窄 view 的擁有者若**兩者皆非**,它有 SELECT 也照樣一列都讀不到 ——
    --      而 ⑦b-1 只問「有沒有 SELECT」,**它會過**。
    --    🔴 **這一種我在本機重現不了**(本機 owner 是 superuser,兩個條件都滿足)
    --      ⇒ **它只能靠斷言擋,不能靠實測背書。這一格是【推論 + 官方語意】,不是量到的。**
    -- 🔴 **第四個條件不可省:零 policy**(codex 第二輪 E 抓的)。
    --    我第一版只驗前三項,卻在訊息裡寫「零 policy」⇒ **結論被套到所有 RLS-on 的情況**。
    --    未來若有人替該 owner 加一條允許 SELECT 的 policy ⇒ 查詢正常回列,而這格**會誤紅**,
    --    而誤紅的成本是下一個人以為閘壞了、然後把它拿掉。
    --    ⚠️ 這裡數的是**該表上的 policy 總數**,不是「有沒有一條適用於這個 owner」——
    --      後者要解 `polroles` / `polqual` 才知道,而**那是一個我沒把握寫對的判斷**。
    --      ⇒ 保守作法:**只在「一條 policy 都沒有」時才敢說 default-deny**。
    --        有 policy 時本格放行,由 ⑦c 的值層比對接住(它不看成因)。
    --
    -- 🔴🔴 **本格已知的兩個缺口(codex 2026-08-23 第三輪 C;我判不動,明寫成未解)**:
    -- ```
    -- 漏紅:表上有 policy,但那些 policy 對這個 owner 一條都不適用
    --       ⇒ 實際仍是 default-deny、靜默回空,而本格因為「policy 總數 > 0」放行
    --       ⇒ 接住它的只剩 ⑦c(值層),而 ⑦c 在【空庫】那一輪會跳過
    -- 誤紅:view owner 是 `rolsuper = true` 但 `rolbypassrls = false` 且非表 owner
    --       ⇒ superuser **實際上繞得過 RLS**,查詢正常,而本格仍會報錯
    --       ⚠️ 這一種在拋棄式環境很常見(本機 postgres 就是 superuser),
    --          正式庫的 postgres 是 `rolsuper=false` ⇒ 對正式庫影響小,對本機驗證會擋路
    -- ```
    -- 🔴 **兩個缺口的修法都要解 `polroles`/`polqual` 或補 `rolsuper` 判斷,而我沒把握寫對** ——
    --    上一輪我自己講過那句,這一輪它仍然成立。**寫成未解,不硬猜。**
    --    ⇒ 誰要修:先在拋棄式 PG 上把這兩個世界各造一次,**確認該紅有紅、該綠有綠再改**。
    IF (SELECT relrowsecurity FROM pg_catalog.pg_class
         WHERE oid = 'public.order_payments'::regclass)
       AND (SELECT count(*) FROM pg_catalog.pg_policy
             WHERE polrelid = 'public.order_payments'::regclass) = 0
       AND v_owner <> (SELECT relowner FROM pg_catalog.pg_class
                        WHERE oid = 'public.order_payments'::regclass)
       AND NOT (SELECT rolbypassrls FROM pg_catalog.pg_roles WHERE oid = v_owner) THEN
      RAISE EXCEPTION '#841 驗收失敗 — order_payments 開著 RLS 且【零 policy】,而窄 view 的擁有者(%)'
        '既不是該表的擁有者、也沒有 BYPASSRLS ⇒ 它有 SELECT 也會【一列都讀不到】,'
        '而 paid_total 會全部變 0、#841 完全沒修。'
        '(⑦b-1 只問有沒有 SELECT ⇒ 那一格會過,擋不到這一種)',
        pg_catalog.pg_get_userbyid(v_owner)
        USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_841_plain_rls_silent_empty';
    END IF;
  END;

  -- ⑤ 結構面補網:`paid_total` 那個運算式裡必須有 COALESCE(擋「⑦c 因為空庫而跳過」那一輪)
  --
  -- 🔴🔴 **初版寫成 `position('COALESCE' in v_def) = 0` —— 那是一格恆綠**(R1 抓的,他是對的)。
  --    成因:`goods_axis` 那段自己就有 **6 個** COALESCE
  --    (2026-08-23 拋棄式 PG 印 `pg_get_viewdef` 實數:`s.shipped/instock/ordered_quantity` 各一
  --     + `s.cancelled_quantity` 三處 = 6,加上 `paid_total` 這個共 7)
  --    ⇒ **把 `paid_total` 的 COALESCE 整個拿掉,那一格照樣綠** ⇒ 值層斷言跳過時「由 ⑤ 頂著」是**零覆蓋**。
  --
  -- ⇒ 改成錨在 `paid_total` **自己的運算式形狀**上。字面不是推的,是印出來對著抄的:
  --      COALESCE(( SELECT t.paid_total
  --             FROM order_paid_totals_v t
  --            WHERE t.order_id = o.id), 0::bigint) AS paid_total
  -- ⚠️ **限度**(照 `#522` 同款寫法標清楚):這是**語法模板斷言**。
  --    換等價寫法(改別名、改成 LEFT JOIN、包一層 CTE)會**誤紅**。
  --    紅的時候先問「我是不是換了寫法」,再問「我是不是拿掉了 COALESCE」。
  --    真正的判別力在 ⑦c(值層)。本格只是 ⑦c 因空庫而跳過那一輪的下界。
  IF v_def !~ 'COALESCE\(\(\s*SELECT\s+t\.paid_total' THEN
    RAISE EXCEPTION '#841 驗收失敗 — paid_total 的運算式沒有包在 COALESCE 裡'
      '(或換了寫法而本格認不得)。包在【純量子查詢裡面】的 COALESCE 等於沒有:'
      '子查詢命中零列時回 NULL 的是子查詢本身,裡面的 COALESCE 一次都沒執行。'
      '⇒ 那些單會靠 NULL 巧合被藏,而畫面完全正常。';
  END IF;

  -- ⑥ 🔴 窄 view 必須是 `security_invoker = false`,外層必須是 `true`。
  --    **寫反的兩個方向壞法不同,而都不會在三綠紅**:
  --      窄的變 true  ⇒ 列表當場 42501(吵)
  --      外層變 false ⇒ 整張 view 改用擁有者身分讀 orders ⇒ **默默繞過 orders 那層刻意的分級**
  --                    (`20260611120000:239` 逐字:orders 只收寫權、留 SELECT)
  -- ⚠️ 用 `::boolean` 而不是逐字比 `'true'` / `'false'`:PG 的 reloption 也吃 `on` / `off` / `1` / `0`
  --    ⇒ 有人寫 `security_invoker = on` 時逐字比會**誤紅**,而誤紅的成本是下一個人以為閘壞了。
  --    (`COALESCE(..., 'false')` 那一半留著:reloptions 為 NULL 時 PG 的預設就是 invoker=false。)
  IF COALESCE((SELECT option_value FROM pg_options_to_table(
        (SELECT reloptions FROM pg_class WHERE oid = 'public.order_paid_totals_v'::regclass))
      WHERE option_name = 'security_invoker'), 'false')::boolean <> false THEN
    RAISE EXCEPTION '#841 驗收失敗 — order_paid_totals_v 不是 security_invoker=false ⇒ 它讀不到零 GRANT 的帳本,列表會 42501';
  END IF;
  IF COALESCE((SELECT option_value FROM pg_options_to_table(
        (SELECT reloptions FROM pg_class WHERE oid = 'public.admin_order_list_v'::regclass))
      WHERE option_name = 'security_invoker'), 'false')::boolean <> true THEN
    RAISE EXCEPTION '#841 驗收失敗 — admin_order_list_v 不再是 security_invoker=true ⇒ 它會用擁有者身分讀 orders,繞過刻意的權限分級';
  END IF;

  -- ⑦ 兩張 view 的授權面:除 owner 與 service_role 外一個都不准有(表層 + 欄位層兩個獨立的面)
  FOREACH v_rel IN ARRAY ARRAY['public.admin_order_list_v', 'public.order_paid_totals_v'] LOOP
    IF (SELECT relacl FROM pg_class WHERE oid = v_rel::regclass) IS NULL THEN
      RAISE EXCEPTION '#841 驗收失敗 — % 的 relacl 是 NULL(從沒下過 GRANT),授權斷言沒有判別力', v_rel;
    END IF;
    -- 🔴 三件一起驗,而它們**擋的不是同一種事**(precedent `20260811090000:155-171`):
    --    ① grantee 身分:除 owner 與 service_role 之外一個都不准有(`grantee = 0` 即 PUBLIC)
    --    ② privilege 種類:service_role **只准 SELECT** —— 這是一張【錢】的 view,
    --       它拿到 INSERT/UPDATE/DELETE 沒有任何用途,而 view 一旦變成可更新就真的寫得下去
    --       (`docs/patterns/revoking-…:570-582` 記過:兩張 `_public` view 的寫入權「今天」執行不出來,
    --        而誰替它加一個 `INSTEAD OF` trigger,那些權限**當場變活**)
    --    ③ `is_grantable`:帶 WITH GRANT OPTION 的話,允許清單裡的角色可以再轉授給別人
    --       ⇒ 閉世界當場破掉,而 ① 看不到這件事
    SELECT count(*) INTO v_cnt
      FROM pg_class c, aclexplode(c.relacl) a
     WHERE c.oid = v_rel::regclass
       AND a.grantee <> c.relowner
       AND (a.grantee = 0
            OR pg_get_userbyid(a.grantee) <> 'service_role'
            OR a.privilege_type <> 'SELECT'
            OR a.is_grantable);
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION '#841 驗收失敗 — % 的表層授權閉世界被打破(% 條)⇒ '
        '①出現 {owner, service_role} 以外的 grantee(grantee=0 即 PUBLIC)'
        '②或 service_role 拿到 SELECT 以外的權限 ③或有人帶了 WITH GRANT OPTION', v_rel, v_cnt
        USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_841_view_acl_closed_world';
    END IF;

    -- 🔴 有效權限實測 —— 上面那格只看 **ACL 字面**,這一層才擋得住「**透過成員關係間接拿到**」
    --    (precedent `20260811090000:176-186` 明說字面層擋不住這條路)。
    --    ⚠️ `authenticator` **刻意在名單裡**:它是 PostgREST 的登入角色,而本 view 只給 service_role
    --    ⇒ 它若直接讀得到,那不是正常路徑。(它 `SET ROLE service_role` 之後讀得到是正常的,
    --      而 `has_table_privilege` 看不到那條路 —— 那一半本閘不管,見下。)
    SELECT count(*) INTO v_cnt
      FROM unnest(ARRAY['anon','authenticated','authenticator']) x(r)
     WHERE pg_catalog.has_table_privilege(x.r, v_rel::regclass, 'SELECT');
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION '#841 驗收失敗 — % 有 % 個低權角色【有效】讀得到(anon/authenticated/authenticator)⇒ '
        '訂單金額與已收款外流', v_rel, v_cnt
        USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_841_view_readable_too_wide';
    END IF;
    -- 🔴 **service_role 的有效【寫】權** —— codex M4:上面那格只從 `relacl` 證,
    --    而低權角色我補了 effective SELECT、**service_role 的 DML 卻沒有同級檢查 ⇒ 兩邊不對稱**。
    --    `has_table_privilege` 會把 `pg_write_all_data` 這類**叢集層角色成員**算進去,而 `relacl` 看不到。
    --    ⚠️ **今天它寫不進去是因為 `security_invoker = true`**(2026-08-23 實打 ⇒ permission denied),
    --      而那是**另一個機制**在擋 —— 本格擋的是**權限本身**,兩件事不要互相當背書。
    SELECT count(*) INTO v_cnt
      FROM unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) x(priv)
     WHERE pg_catalog.has_table_privilege('service_role', v_rel::regclass, x.priv);
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION '#841 驗收失敗 — service_role 對 % 有效拿得到 % 種【寫】權限。'
        '本片只給它 SELECT;拿得到寫權表示有別的來源(叢集層角色成員 / 有人手動 GRANT)。'
        '⚠️ 不要用「今天 security_invoker=true 所以寫不進去」當理由 —— 那是另一個機制,'
        '而誰改掉它,這些權限就當場變活。', v_rel, v_cnt
        USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_841_service_role_write_reachable';
    END IF;

    -- ⚠️ **本閘【不】驗「SET ROLE 之後才拿得到」那條路**(`pg_has_role(…,'SET')`)——
    --    `20260811090000:189-211` 為函式驗了它。這裡不驗,理由是:那條路的把關對象是
    --    **service_role 這個身分本身**(誰達得到它),而那是全庫共用的問題、不是本 view 的。
    --    在本片重複一次會讓它看起來像本片解決了那件事。**明寫成未驗,不是漏掉。**
    SELECT count(*) INTO v_cnt
      FROM pg_attribute at
     WHERE at.attrelid = v_rel::regclass AND at.attacl IS NOT NULL;
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION '#841 驗收失敗 — % 出現 % 條【欄位層】授權', v_rel, v_cnt;
    END IF;
  END LOOP;

  -- ══ ⑦c 🔴🔴 值層對照 —— **逐單比對真值**,而不是「有沒有非零」════════════════
  --
  -- ⚠️ **初版有兩個破口,兩個都是 codex 抓的(M1 / M2),兩個都會讓【壞掉的世界】全綠:**
  -- ```
  -- M2 初版只問「有收款的單 paid_total 是不是 0」⇒ 算成任何非零值(固定 1、只加一部分列)
  --    ⇒ **照樣綠**。它問的是「有沒有東西」,不是「算得對不對」。
  -- M1 而更大的破口是【跳過】:空庫時 ④ 與 ⑦c 都印 NOTICE 走開
  --    ⇒ 把窄 view 換成「仍含 paid_total 字面、但永遠回零列」的版本,結構閘全綠、值層全跳過
  --    ⇒ **整套通過,而東西是壞的。**
  -- ```
  -- ⇒ 改成**逐單 `IS DISTINCT FROM` 比對實際 `SUM(amount)`**,分母 = **全部訂單**(不只有收款的)。
  --    `IS DISTINCT FROM` 而不是 `<>`:NULL 與任何值比 `<>` 回 NULL(= 不算差異)⇒ 會漏掉
  --    「paid_total 是 NULL」那一族。
  -- 📌 **原本的斷言 ④(零收款單的 paid_total 不得為 NULL)已經刪掉** —— 本格完全涵蓋它:
  --    ```
  --    ④  分母 = 【沒有收款列的】訂單;判定 = paid_total IS NULL
  --    ⑦c 分母 = 【全部】訂單        ;判定 = paid_total IS DISTINCT FROM 實際 SUM
  --    沒有收款列 ⇒ 實際 SUM = 0;NULL IS DISTINCT FROM 0 ⇒ true ⇒ 紅
  --    ⇒ ④ 能紅的每一格,⑦c 都紅。分母 ④ ⊊ ⑦c。
  --    ```
  --
  -- 🔴🔴 **而我刪 ④ 時寫的理由「兩份弱的不如一份【沒有跳過】的」是【假的】**
  --    (codex 第二輪 D1 抓的;本格自己也有跳過)。**更正成量得到的版本:**
  --    ```
  --    ④  跳過條件 = 「庫裡沒有零收款單」  ← **軟條件**,正常運作的庫也可能滿足
  --    ⑦c 跳過條件 = 「庫裡 orders 零列」   ← **硬事實**,只有全新環境
  --    ```
  --    ⇒ 對的說法是「**把一個軟的跳過條件換成一個硬的**」,不是「沒有跳過」。
  --
  -- ⚠️ **而全新正式庫那個世界剩下什麼,照實列**(它是真的會發生的:第一次 apply):
  --    ```
  --    仍然跑:⑤ 語法形狀 / ⑥ security_invoker / ⑦ ACL 閉世界 + 有效權限
  --            ⑦b-1 擁有者讀得到底表 / ⑦b-2 FORCE RLS / ⑦b-3 零 policy RLS / ⑧ 底表 ACL
  --    🔴 不跑:**值層驗證,一格都沒有。**
  --    ⇒ 那個世界裡「算出來的數字對不對」**沒有任何東西在看** —— 而那正是本片的核心。
  --    ⇒ **緩解不在本檔**:片3 的真後台走查(改之前重現消失、改之後證明回來)才是那一格的證據。
  --      本檔不假裝自己蓋得住它。
  --    ```
  SELECT count(*) INTO v_cnt FROM public.orders;
  IF v_cnt = 0 THEN
    -- 🔴 **這是本檔【唯一】一個允許跳過的出口,而它有硬前提:庫裡一張單都沒有。**
    --    有單就一定跑得動 —— 不需要「有收款的單」才跑,零收款的單一樣比得出真值(兩邊都該是 0)。
    RAISE NOTICE '⚠️ #841 斷言⑦c【跳過】— 本庫 orders 零列(全新環境)。'
      '有任何一張單就會真的比對,不會再跳過。';
  ELSE
    -- 🔴🔴 **`FROM orders` LEFT JOIN view,不是 `FROM view`**(codex 第二輪 D2 抓的第六個恆綠世界):
    --    初版寫 `FROM public.admin_order_list_v v` ⇒ 宣稱的分母是「全部訂單」,
    --    而**實際被掃的是 view 吐出來的列**。
    --    構造:**外層 view 加一個 `WHERE false`** ⇒ `v_cnt`(數 orders)仍 > 0、看起來有判別力,
    --    而比對掃到零列 ⇒ mismatch = 0 ⇒ **整格通過,而列表一張單都撈不到。**
    --    ⇒ 從 `orders` 出發、LEFT JOIN 回來,**view 漏掉的單會以 `v.id IS NULL` 現形**。
    SELECT count(*) INTO v_null_cnt
      FROM public.orders o
      LEFT JOIN public.admin_order_list_v v ON v.id = o.id
     WHERE v.id IS NULL
        OR v.paid_total IS DISTINCT FROM (
             SELECT COALESCE(SUM(p.amount), 0) FROM public.order_payments p WHERE p.order_id = o.id
           );
    IF v_null_cnt <> 0 THEN
      RAISE EXCEPTION '#841 驗收失敗 — % 張單對不上(分母:本庫共 % 張 orders,逐單 LEFT JOIN 比對)。'
        '⇒ 可能是:①**view 根本沒吐出這張單**(漏了 WHERE、JOIN 接錯)'
        '②窄 view 讀不到底表、正在【靜默回空】(每張都變 0)'
        '③COALESCE 掉了(變 NULL)④算式只加了一部分列。'
        '🔴 這一格【不看成因】,它只問「orders 的每一張,view 有沒有、數字對不對」。', v_null_cnt, v_cnt
        USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_841_paid_total_mismatch';
    END IF;
  END IF;

  -- ══ ⑦d 🔴🔴 一對多 —— **⑦c 擋得住「view 少吐」,擋不住「view 多吐」**═══════════
  --
  -- codex 2026-08-23 第三輪構造出來的第七個恆綠世界(不是「可能有」,是真的做得出來):
  -- ```
  -- 讓 admin_order_list_v 對每張訂單吐【兩列】,而兩列的 paid_total 都是對的
  --   ⇒ ⑦c 的 LEFT JOIN 兩列都不符合 mismatch ⇒ v_null_cnt = 0 ⇒ **全綠**
  --   ⇒ 而列表會把每張單畫成兩張,分頁與 `count: 'exact'` 一起錯
  -- ```
  -- 📌 **這個方向是我上一輪【修 D2 時製造出來的】** —— 我把「掃不到」修成「LEFT JOIN 掃得到」,
  --    而 LEFT JOIN 對一對多是沉默的。**修一個方向會長出另一個方向。**
  --
  -- ⚠️ 順帶:`order_paid_totals_v` 有 `GROUP BY p.order_id` ⇒ 它每個 order_id 至多一列,
  --    所以今天的一對多只可能來自**外層 view 自己**(多一個 JOIN、少一個 GROUP BY)。
  --    本格不假設成因,直接數。
  SELECT count(*) INTO v_cnt
    FROM (
      SELECT v.id FROM public.admin_order_list_v v GROUP BY v.id HAVING count(*) <> 1
    ) dup;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '#841 驗收失敗 — admin_order_list_v 有 % 個 order id 不是恰好一列。'
      '⇒ 列表會把同一張單畫成多張,而分頁與 count(exact) 一起錯。'
      '🔴 ⑦c(逐單比對)對這種情況是【沉默的】:每一列的數字都對,只是列數不對。', v_cnt
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_841_view_row_fanout';
  END IF;

  -- ⑧ 🔴 底表沒有被本片動到 —— 這正是 `20260810100000:690-701`(P2B20)那道閘的檢查,
  --    **自己先跑一次,不等下次 apply 才炸。**
  SELECT count(*) INTO v_cnt
    FROM pg_class c, aclexplode(c.relacl) a
   WHERE c.oid = 'public.order_payments'::regclass
     AND a.grantee <> c.relowner;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '#841 驗收失敗 — order_payments 的 relacl 多了 % 個 owner 以外的 grantee。'
      '本片【不得】對它補任何 GRANT ⇒ 補了會讓 20260810100000 下次 apply 整份炸掉(P2B20)', v_cnt;
  END IF;

  RAISE NOTICE '✅ #841:窄 view definer / 外層 invoker / 授權只給 service_role / 底表零額外 grantee / #522 未被弄壞';
END
$verify$;

-- ══ 8. Rollback ═══════════════════════════════════════════════════════════════
--
--   DROP VIEW public.order_paid_totals_v;   ← 🔴 要先把外層的 paid_total 欄拿掉,否則相依擋著
--   然後重跑 `20260816050000_…:71-114` 的 CREATE OR REPLACE VIEW 段回到原狀。
--
-- 🔴 **回退等於把 `#841` 裝回去** —— 那條人工出路一旦有人走,單子就會消失,而走的人不會知道為什麼。
-- additive:沒有動表、索引、trigger、資料。**零資料異動。**
