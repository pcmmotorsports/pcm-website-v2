# OP7 · 部分取消(與任何讓 `effective_total` 變小的動作)要開待退款 —— 含稅單不猜 · plan(2026-09-14)

> Sean 2026-09-14 逐字「修好」「開工」(主視窗 4f 轉);板列 `⟦b4-PARTCANCEL1⟧`(`launch-todo:1209`,【少退】)與 `⟦b4-PARTCANCELTAX⟧`(`:1210`,【多退】)。
> 上游 plan:`2026-09-07-partcancel-pending-refund-plan.md`(掛法 丙 + Q1=C + Q2=D 已拍)、`2026-09-10-partcanceltax-effective-amounts-plan.md`(甲:算不出來回 NULL 已上線 `20260909100000`)。
> 本 plan 只做那兩份沒答的最後一格:**稅怎麼進算式**、**丙的函式長什麼樣**、**誰呼叫它**。migration 版本 `20260914070000`,**寫好不貼**(鐵則 12③ Sean 的手)。

## 0. 一句話

`retire = max(0, 已收未退(非卡)− 取消後剩餘應收)`(Sean `Q13`),其中「剩餘應收」對**有稅的單**只在**能從欄位重現出 `tax_total` 的時候**才算;重現不出 ⇒ 不寫列、對帳報出來。

## 1. 改什麼(四個物件,一支 migration)

| # | 物件 | 型 | 做什麼 |
|---|---|---|---|
| ① | `pcm_order_remaining_receivable(uuid) → bigint` | 新函式 | 「取消後訂單剩餘應收總額」。`tax_total = 0` ⇒ `effective_total`(既有 view);`tax_total <> 0` 且 **`order_source <> 'web'`(手動單)⇒ NULL**(codex R1-1:手動單的逐列殘差沒存,總額相等證明不了規則);`tax_total <> 0` 且 web ⇒ **先自檢** `round((subtotal + shipping_fee − discount_total) × 0.05) = tax_total`,成立才回 `effective_subtotal + effective_shipping_fee + round((effective_subtotal + effective_shipping_fee) × 0.05)`,不成立回 **NULL** |
| ② | `pcm_pending_refund_amounts_capped(uuid, bigint) → TABLE(rail, amount)` | 新函式 | 與既有 `pcm_pending_refund_amounts` **同一套逐軌分配**(bank_transfer / cash、淨額、順序貪婪),只是分配的總額由參數給(整單取消那支分的是「全部淨額」;本支分的是「多收的部分」) |
| ③ | `pcm_partial_cancel_recompute(uuid) → void` | 新函式(丙) | **先 `orders` 那一列 `FOR UPDATE`**(codex R1-2:service_role 也叫得到,不在 RPC 父列鎖下時會把整單取消的快照蓋回舊值);冪等重算:已整單取消 ⇒ 不做(那條路是 `pcm_pending_refund_on_cancel` 的);有 card 收款 ⇒ 不做(Q2=D);① 回 NULL ⇒ 不做;否則 `total = max(0, Σ非卡淨額 − ①)`,`total = 0` ⇒ 把本機制開的未結列作廢(`void_reason='partial_recompute_zero'`);`total > 0` ⇒ 逐軌 `INSERT … ON CONFLICT DO UPDATE`(**覆寫**,丙的定義) |
| ④ | `pcm_partial_cancel_refund_reconciliation_v` | 新 view(service_role) | 對帳面:每一張**未整單取消**的單,`kind ∈ {'has_card','tax_uncomputable','missing_row','rail_mismatch'}`。`has_card` 母體不看非卡淨額(純卡單也報;卡的刷退不在減項 ⇒ 可能多報,方向是給人看;codex R1-3);非卡那半**逐軌**比 capped 分配 vs 未結列(缺軌 / 多軌 / 金額差都報;codex R1-4)。`ok` 的不出現 |
| ⑤ | 三支 trigger | 新 | statement-level + transition table:`order_cancellation_items` INSERT · `order_items` UPDATE(函式內只挑 unit_price / quantity 變了的)· `orders` UPDATE(只挑 shipping_method 變了的;codex R1-5:改門市 ⇒ 運費 0 ⇒ 剩餘變小)。PG 不准 `UPDATE OF 欄位` 與 transition table 並用 ⇒ 在函式裡比 OLD/NEW |
| ⑥ | `apps/admin` `/orders/refund-exceptions` 多一段 | 新讀取端 | ④ 的呼叫點(codex R1-6:「兩件一起」⇒ 對帳要有人讀)。值班每天看那頁;view 沒貼 ⇒ 顯示「載入失敗」不是「0 張」 |

🔴 **不動的**:`pcm_pending_refund_amounts` / `pcm_pending_refund_open_for` / `pcm_pending_refund_on_cancel` / `pcm_order_effective_amounts_v`(含它的 `tax_total <> 0 ⇒ NULL` 那道閘)/ `admin_cancel_order` / `admin_update_order_item_amount` 全部一個字不改。

## 2. 為什麼是這個形狀(對上游三個拍板逐條)

- **丙(重算式)已拍**:③ 就是那支 `recompute(order_id)`。冪等 ⇒ 「覆寫還是累加」不存在。
- **A 的必要條件「丙 + 資料層對帳,兩件一起」**:④ 是對帳面、⑥ 是讀它的人(後台退款異常頁,不在任何 trigger / RPC 呼叫鏈上)。⛔ ~~呼叫它的排程是下一片~~(codex R1-6 打回:view 沒人讀 = 對帳不存在)。⚠️ 「定期」今天 = 值班開那一頁;要 cron 化(老闆 digest)另一片。
- **Q2=D(訂單級、含卡就不寫、對帳報)**:③ 第二道閘 `EXISTS(order_payments rail='card')` ⇒ 不寫;④ 把它報成 `has_card`。
- **Q1=C(跟著失敗)**:⑤ 的 trigger 讓取消 / 改價那一發**與重算同一個交易** —— 重算炸 ⇒ 那個動作跟著炸(不會靜靜少一列);而對帳在交易外。
- 🔴 **誰呼叫它 —— 為什麼是 trigger 不是「四支函式裡各呼叫一次」(乙)**:上游 §4-3 否決甲的理由是「一次動作多欄觸發 ⇒ 要自己去重」—— **丙的冪等把那個理由消掉了**(多觸發幾次答案一樣);而乙的代價「明天多一條路就安靜漏掉」還在。⇒ 冪等重算 + 資料層 trigger 同時拿到「不漏」與「不重」。代價:要改的是 `order_items` / `order_cancellation_items` 上的 trigger,不是三支各 600 行的 RPC(改那三支 = 三份新一代 + 三次 latest-definition 對齊,爆炸半徑大得多)。
- **稅**(`⟦b4-PARTCANCELTAX⟧`,Sean 09-10 拍甲「算不出來就不回數」):① **不複製任何稅率規則**。⛔ ~~總額自檢過 ⇒ 稅就是 5% 那一句~~ —— codex R1-1 反例:手動含稅 31×100 + 32×100 ⇒ 殘差 300 剛好 = 6000×5% ⇒ 自檢過而取消一半後剩餘稅不是 5% ⇒ 多開 50。**總額相等證明不了規則**。✅ 現在:手動單(`order_source <> 'web'`)有稅一律 NULL(逐列殘差沒存);web 單只有一句稅(`create_order:548`,每列未稅)⇒ 自檢重現得出才算。⇒ 🔴 **對 Sean 的未稅手動單,本片的答案是「不自動開、對帳報出來給人算」** —— 那正是他 09-10 拍的甲。要讓手動單也自動算,得存每一列的殘差(schema),另一題。
- **Q39(券作廢算原價)**:`effective_*` 已照原價算,所以剩餘稅基也不扣 `discount_total`;而**自檢那一半要扣** —— 因為原始 `tax_total` 是在扣了券之後算的(`create_order:548` 逐字 `subtotal + shipping − discount`)。兩半的稅基不同是刻意的,不是筆誤。

## 3. 算式每個名詞指到哪一欄

| 名詞 | 來源 | 備註 |
|---|---|---|
| 已收未退(非卡)| `pcm_pending_refund_amounts` 的 `net` CTE 口徑:`Σ order_payments.amount(rail ∈ bank_transfer, cash)` − `Σ order_manual_refunds.refund_amount(同軌, voided_at IS NULL)` | ② 逐字複製這一段(理由:不改那支活的整單取消函式) |
| 剩餘應收 | ① | 見 §1 |
| `effective_subtotal / effective_shipping_fee / effective_total` | `pcm_order_effective_amounts_v`(newest `20260909100000`)| 只讀這三欄;**不讀** `effective_balance_due`(它的 NULL 是給寄信用的) |
| 原稅基 | `orders.subtotal + orders.shipping_fee − orders.discount_total` | `create_order:548` 與 `admin_create_manual_order`(第 8 代 `:594`,無混單時 `v_untaxed_base = subtotal`)同一句 |
| 有沒有卡 | `EXISTS(order_payments WHERE rail='card')` | D |

## 4. 🔴 half-up 三個地雷(交接檔 `~/pcm-mailbox/交接-窗C-稅務與出貨那條線-20260911.md` 照抄)

1. PG `round(numeric)` 是 half-up,與 RPC 同一種 ⇒ ① 用 `pg_catalog.round((…)::numeric * 0.05)`,**不用** `::integer` 截斷、不用 `floor`。
2. **對照表不用 Python 內建 `round`**(banker's)—— 驗收數字用 psql 算或手算。
3. **判別格從兩種捨入的分岔交集挑**:稅基 × 0.05 落在 `.5` 的那些 —— 稅基 = 10, 30, 50, 70, …(公差 20)。⛔ 用 1000 / 1050 那種「兩邊同」的格子驗不出 half-up 有沒有走對。✅ 驗收用**稅基 1,050**(× 0.05 = 52.5 ⇒ half-up 53 / banker's 52)當判別格。

## 5. 影響面

- 寫入面:只有 `order_pending_refunds`(新列 / 覆寫 amount_at_cancel / 作廢);**零改既有列語意** —— 本機制開的列 `cancellation_id` 指向**最新一筆部分取消單**(`order_cancellations` 同單最新),改價路徑開的列 `cancellation_id = NULL`。
- 讀取面:`order_pending_refunds` 的既有消費端(後台待退款清單 / `pcm_manual_refund_rail_cap` 的分母**不含**本表)照舊。
- 效能:每一發部分取消 / 改價多 3–4 個索引查詢(同交易)。
- 🔴 **今天曝險**:正式庫 `order_payments` 1 列、`exclusive` 單 1 張、部分取消 0 次 ⇒ 上線那一刻**零列會被開出來**;它救的是下一次。

## 6. rollback(`supabase/rollbacks/20260914070000_down.sql`,先寫)

`DROP TRIGGER` ×3 → `DROP VIEW` → `DROP FUNCTION` ×4(含 trigger 函式),**不動 `order_pending_refunds` 的資料**(已開的列是「有人該拿回錢」的紀錄;回滾的是機制不是帳)。前置閘:`pcm_partial_cancel_recompute` 在才跑(其餘 `IF EXISTS`)。

## 7. 這一片證不到、留給下一片的

- ④ 的 **cron 化**(老闆 digest):今天的呼叫點是後台退款異常頁(值班每天看);要「沒人開頁也會叫」另一片。
- `has_card` 可能多報(卡的刷退不在減項)—— 要精準得接 `payment_refunds`,另一片。
- 混單(`v_taxed_residual ≠ 0`)的剩餘稅 —— ① 回 NULL、④ 報 `tax_uncomputable`;要算它得把每一列的殘差存下來(schema),另一題。
- 卡的退款(`⟦f3-AUTOREFUND2⟧`)本來就另一條線。

## 8. 驗收(拋棄式 / probe PG 真跑,四個世界都要出不同的數)

| # | 世界 | 期望 |
|---|---|---|
| A | inclusive、兩件各 1000、運費 100、收 2100(bank)、取消一件 | 開 1 列 bank **1000**(剩餘 1100) |
| B | exclusive、兩件各未稅 1000、稅 105(=(2000+100)×5%)、收 2205、取消一件 | 剩餘 = 1000+100+round(1100×.05=55) = **1155** ⇒ 開 bank **1050** |
| C | exclusive、稅 **53**(稅基 1050 half-up 判別格)、收 1103、取消掉一半 | ① 自檢 round(1050×.05)=53 ✓ ⇒ 算得出;banker's 會得 52 ⇒ 自檢失敗 ⇒ **兩種捨入印不同結果** |
| D | exclusive 混單(tax_total 與 5% 對不上,例 tax 60) | ① NULL ⇒ **零列**、④ 報 `tax_uncomputable` |
| E | 有一筆 card 收款 | 零列、④ 報 `has_card` |
| F | 同一張單再取消一件 | 同一列 amount 被**覆寫**成新值(不是第二列) |
| G | 取消到最後一件(cancelled_at 由 NULL 變非 NULL) | `admin_cancel_order` 先 INSERT 取消明細 ⇒ 本機制先跑一次(部分口徑);再 UPDATE cancelled_at ⇒ `pcm_pending_refund_on_cancel` 接手**覆寫**成整單口徑(probe 實跑:447 → 1103)|
| I | 手動單混單(含稅 31×100 + 32×100,tax 300 = 6000×5%)| ① NULL(manual)⇒ 零列、對帳 `tax_uncomputable` |
| J | 純卡單 收 2100 取消一件 | 零列、對帳 `has_card`(舊版 noncard_net=0 會漏報)|
| K | bank 1000 + cash 1100 開 bank 1000;之後 bank 沖銷改登 cash | 對帳 `rail_mismatch`(總額仍對而軌錯)|
| L | 部分取消後改配送成門市 | trigger 重算:1000 → 1100 |
| H | 收款 < 剩餘應收(不欠) | 零列;既有未結列被作廢 `partial_recompute_zero` |

## 9. 審查

碰錢 ⇒ codex `gpt-6-astra` 唯讀,R1 must-fix 修完 ⇒ R2,兩輪收工(4f 09-14 裁)。切入角:算式名詞、CAS / 冪等、half-up、trigger 的交易語意、D 的負對照。
