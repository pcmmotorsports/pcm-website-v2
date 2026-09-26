# 計畫：退貨收回（2026-09-27，窗「進度 a0」，第 1 版）

> 狀態：**09-27 Sean 批准（經主視窗轉達）：Q1 甲、Q2 甲、Q3 甲。** 實作時照鐵則 12 每片送審。第 1 片見第八節。
> 「退貨收回」＝客人把已出貨的商品寄回來，員工登記、收件、再退錢。

## 一、現在有什麼

| 項目 | 現況 | 位置 |
|---|---|---|
| 取消（整單／部分） | 有。只能取消**還沒出貨**的品項 | `apps/admin/src/lib/orders/cancel-repository.ts`（RPC `admin_cancel_order`，帳本 `order_cancellations` ＋ `order_cancellation_items`） |
| 退款 | 有。刷卡原路退、手動登記退款、作廢登記 | `apps/admin/src/lib/payment/refund-repository.ts`、`manual-refund-repository.ts` |
| 已出貨的單退款 | 可以直接登記退款，**不會**把訂單變成已取消（Sean 0915 Q2 甲） | 同上 |
| 撤銷到貨、作廢出貨 | 有，但那是員工操作錯誤的更正，不是退貨 | `receipt-repository.ts`、`shipment-repository.ts` |
| **退貨** | **完全沒有**。沒有表、沒有按鈕、沒有狀態。畫面上刻意寫「退貨功能目前還沒有」，有測試鎖住 | `components/orders/cancel-review-section.tsx`、`order-detail-money-tab.tsx`、`danger-zone-details.tsx`；測試 `refund-wiring.test.tsx`、`cancel-review-section.test.tsx` |
| 前台 | 只有退換貨政策文字（`/info/shipping`，客製代購不適用七日鑑賞期），沒有客人申請退貨的入口 | `apps/storefront/src/data/legal-content.ts` 第 10 條 |
| 信件 | 有取消信、部分退款信；沒有退貨信 | `packages/adapters/src/email/order-email-assembly.ts` |
| OD 設計稿 `pcm-524f` | 沒有退貨畫面。`orders-admin-v4-timeline.html` 只有一句「已出貨，不能在這裡取消（退貨功能還沒有）」；`HANDOFF-orders-ui.md` 查無退貨 | OD 專案資料夾 |
| 規格書 | 後台重建規格 #18「退貨收回」＝整條沒做；下一步寫的是「先決定流程」 | `docs/specs/2026-07-25-admin-backend-rebuild-spec.md:371,579,600` |

## 二、Sean 已經拍過、這份計畫直接照做的

| 拍板 | 內容 | 出處 |
|---|---|---|
| 08-13 退貨三題 | 退回的貨「入庫」；**先收到貨再退錢**；手續費和運費**公司吸收** | `docs/specs/2026-08-12-admin-order-ui-design-brief.md` §0-I |
| 08-13「入庫」的限制 | 目前沒有庫存表。入庫只能做到「有紀錄查得到」，**不能**自動變成可以出別張單的存貨（和到貨溢收同一種做法） | 同上 |
| 08-17 Q-9 甲 | 要做退貨線，先做資料模型，兩段式：登記退貨 → 確認收到貨 → 才退款 | memory `project_0817-sean-nine-rulings-afternoon` |
| 07-26 U6=A | 基本上不讓客人自己申請退貨，客人在 LINE 問 ⇒ **前台不做申請入口**，只有員工在後台登記 | memory `project_m4b-ux-review-u-decisions` |
| 08-09 Q11=A | 通知：「退貨收到」只走 LINE，不寄信 | memory `project_m4b-order-admin-complete-then-test` |
| 08-26 Q16 甲 | 訂單列表先不加「退貨中」膠囊 | memory `project_0826-sean-answers-decision-table` |
| 08-26 C 甲 | 退貨後，客人用過的優惠券次數退回去，可以再用一次 | memory `project_0826-sean-answers-batch2` |
| 09-15 Q2 甲 | 已出貨的單退款不把訂單變成已取消 ⇒ 退貨退完也**不**變已取消 | memory `project_0915-ecommerce-audit-three-rulings` |

## 三、流程（員工看到什麼）

位置：後台訂單詳情的「金額」分頁，放在退款區塊上面，新增一個「退貨」區塊。只有**已出貨**的品項能選。

1. **登記退貨**（客人在 LINE 說要退，員工按「登記退貨」）
   - 選品項和數量（上限＝已出貨數量 − 已經登記退貨的數量）
   - 選原因（商品瑕疵／寄錯／客人不要了／其他）＋備註
   - 可填客人寄回的物流單號（選填）
   - 送出後，區塊顯示「退貨中：等商品寄回」，列出品項、數量、登記人、時間
2. **確認收到退貨**（貨到公司，員工按「確認收到退貨」）
   - 逐項填實收數量，選商品狀況（良好／有損傷）＋備註
   - 送出後顯示「已收回」；同時傳 LINE 給 Sean（照 Q11=A）
   - 優惠券次數退回（照 08-26 C 甲，接既有的券退回程式）
3. **登記退款**（按「為這筆退貨登記退款」）
   - 進入**現有的**退款流程（刷卡原路退或手動登記），金額欄預先帶入建議金額（見 Q2）
   - 退款本身的規則、狀態、信件都不變
4. **作廢退貨登記**（登記錯了，或客人改變主意沒寄回）
   - 只有「退貨中」還沒收到的可以作廢；已收回的不能作廢（要改就用新的更正紀錄，避免帳對不上）

訂單本身：`payment_status`、`fulfillment_status`、`cancelled_at` 都**不因退貨改變**；退款照舊由退款流程改付款狀態。訂單時間軸加三種事件：登記退貨／收到退貨／作廢退貨登記。

### 狀態

```
退貨中（已登記、等商品寄回） ──確認收到──▶ 已收回
        │
        └──作廢──▶ 已作廢
```

## 四、要改什麼（分 4 片）

| 片 | 內容 | 碰到 | 送審 |
|---|---|---|---|
| 1 | 資料庫：新表 `order_returns`（一筆退貨：訂單、狀態、原因、備註、物流單號、登記人／時間、收件人／時間、作廢人／時間、防重送的 idempotency key）＋ `order_return_items`（品項、登記數量、實收數量、狀況）。原因代碼：`defective` 商品瑕疵／`wrong_item` 寄錯／`changed_mind` 客人不要了／`other` 其他（要填說明）。三支 RPC：`admin_register_return`、`admin_receive_return`、`admin_void_return`，檢查「數量不能超過已出貨減已退」、鎖 `order_items` 照既有守門寫法。RLS／GRANT 照 `docs/patterns/revoking-function-execute-in-supabase.md` | schema、權限 | 鐵則 12（Codex／Fable） |
| 2 | 後台「退貨」區塊：登記、確認收到、作廢三個表單，狀態文字照 `docs/patterns/admin-copy-style.md`；改掉「退貨功能目前還沒有」那三處文字和鎖住它的兩支測試 | 後台 UI | 測試＋Sean 走一遍 |
| 3 | 接退款：「為這筆退貨登記退款」按鈕，帶建議金額進既有退款表單；時間軸三種事件；操作紀錄 | 錢 | 鐵則 12 |
| 4 | 收到退貨時：LINE 通知 Sean、優惠券次數退回 | 對外通知、券 | 鐵則 12 |

每片 15–45 分鐘的切法到實作時再細分；migration 由 Sean 貼（或他授權的那一次）。

## 五、影響

- 新增兩張表、三支 RPC，**既有的**取消、退款、出貨程式不改邏輯。
- 會改的既有文字：取消區的「退貨功能目前還沒有」，以及鎖住這句話的兩支測試（改成指向新的退貨區塊）。
- 報表／對帳：退貨不直接動錢，錢照舊只在退款帳本 `order_refunds`；運費公司吸收的部分，照 §0-I 在退款時記「公司吸收」，不向客人扣回。
- 庫存：只留紀錄，不影響任何可出貨數量（照 08-13 限制）。

## 六、怎麼退回

- 第 2–4 片：revert commit 即可，資料表留著沒人寫入不影響。
- 第 1 片：附一支 rollback migration（DROP 三支 RPC 和兩張表）；只在表內還沒有真資料時可以直接跑，有資料就先匯出再決定。

## 七、需要 Sean 決定（09-27 已答：Q1 甲、Q2 甲、Q3 甲）

```
Q1：這次要不要一起做「換貨」？
甲（推薦）：這次只做退貨退款。要換貨時，員工照舊另開一張新單
乙：一起做換貨（收回舊的、寄出新的、補差價），範圍大約多一倍

Q2：退款金額怎麼帶？
甲（推薦）：系統依退回品項算建議金額（實收數量 × 當初成交單價），員工可以改；商品有損傷時員工自己改少
乙：不帶金額，員工每次自己輸入（和現在的部分退款一樣）

Q3：客人寄回的運費（公司吸收）要不要接新竹物流「到府收件」？
甲（推薦）：這次不接。員工在 LINE 跟客人約好寄件方式，把物流單號填進退貨登記
乙：接新竹逆物流，員工在後台直接叫車去客人那裡收（要多一片，並另外測新竹的正式環境）
```

## 八、第 1 片結果（09-27，窗「進度 a0」）

- 檔案：`supabase/migrations/20260927010000_m4b_order_returns.sql`、退回檔 `supabase/rollbacks/20260927010000-rollback.sql`。**只寫檔、沒貼正式庫。**
- 可退上限：`order_item_quantity_summary.shipped_quantity`（作廢的包裹、還沒寄出的箱子不算）減掉沒作廢的退貨占用（已收回算實收數量、退貨中算登記數量）。
- 鎖的順序：訂單列 `FOR UPDATE` → 品項列 `FOR NO KEY UPDATE`（依 id 排序），和取消訂單、摘要重算用同一套，避免互卡。
- 已知不擋：退貨登記之後，那個包裹又被「作廢出貨」⇒ 已出貨可能小於已退。這片不改出貨函式，只在之後的登記擋下；第 2 片畫面要把這種單標出來。
- 驗證（拋棄式 PG，從零重播全部 migration 後跑）：`docs/probes/2026-09-27-order-returns-behaviour.sql` 13 組情況全部通過（超量、原因其他沒說明、冪等重送、同鑰匙換內容、實收 0 件／沒選狀況／多收、實收少於登記會釋出數量、已收回不能作廢、作廢要原因、作廢後不能收、作廢出貨後擋登記、操作紀錄筆數、anon／authenticated 權限、service_role 不能直接寫表）。整份在交易裡、最後 ROLLBACK。
- 退回檔：拋棄式 PG 上跑過（刪乾淨），再重貼 migration 可以建回來；同一支貼第二次會被前置閘擋下。
