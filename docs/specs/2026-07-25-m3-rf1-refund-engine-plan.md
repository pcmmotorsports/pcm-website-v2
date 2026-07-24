# RF1 Slice Plan — 退款金額+運費重算引擎(純函式)(2026-07-25)

> 退刷自動化線第 1 片(上位 PRD=`docs/specs/2026-07-24-refund-automation-line-prd.md` §4 RF1;拍板=§0+§0b)。
> 片型=**高風險片**(鐵則 12 ①錢:本片產出=全線退款金額的數學權威);審查=codex 關卡1(本 plan)→實作→三綠→code-reviewer→codex 關卡2、不降級。
> 內容分級=**L1**(純程式邏輯、無內容);估時 40 分鐘(含窮舉測試)。

## 1. 目標與動機

一個 stateless 純函式 `computeRefundQuote`:給「訂單當下剩餘狀態 + 要退的品項與數量」,回「該退客人多少錢 + 訂單三金額欄的新值」。後續 RF2b(RPC 以 SQL 重算驗證)、RF5(server action 呼 TapPay)、RF6(UI 預覽)全部消費同一份輸出——金額數學只此一處權威(TS 側)。

## 2. 檔案清單(限制;不動任何既有檔行為)

1. `packages/domain/src/order/refund.ts`(新)— 引擎本體 + 型別。
2. `packages/domain/src/order/refund.test.ts`(新)— 窮舉測試(§4 矩陣)。
3. `packages/domain/src/index.ts`(或既有 barrel;僅加 export 一行)。

不動:`shipping.ts`、`order.ts`、`errors.ts`、任何 RPC/migration/UI。

## 3. 規格

### 3.1 型別(對齊 domain 既有慣例:`Money`、`ShippingMethod`、errors.ts kind-union、`toMoneyAmount` 守門)

```ts
interface RefundQuoteInput {
  shippingMethod: ShippingMethod;            // 'home' | 'store'
  currentShippingFee: Money;                 // orders.shipping_fee 當下值
  currentSubtotal: Money;                    // orders.subtotal 當下值(剩餘有效小計)
  currentDiscountTotal: Money;               // orders.discount_total(Phase 1 恆 0、非 0 直接 reject)
  remainingItems: ReadonlyArray<{ orderItemId: string; unitPrice: Money; remainingQuantity: number }>;
  refundItems: ReadonlyArray<{ orderItemId: string; quantity: number }>;  // Q3=B 部分數量
}

type RefundQuoteResult =
  | { ok: true; quote: RefundQuote }
  | { ok: false; kind: RefundQuoteRejection };  // kind-union、鏡像 errors.ts 風格

interface RefundQuote {
  refundAmount: Money;          // 打 TapPay refund 的 amount
  refundedItemsAmount: Money;   // 退品項金額小計
  newShippingFee: Money;        // 重算後訂單層級運費(D5:單一數字)
  shippingFeeDelta: Money;      // 新−舊(可負=回退運費)
  newSubtotal: Money;           // = currentSubtotal − refundedItemsAmount
  newTotal: Money;              // = newSubtotal + newShippingFee − 0(鏡像 orders_total_balances CHECK;Q2=A 三欄同更的來源值)
  fullRefund: boolean;          // newSubtotal === 0
}

type RefundQuoteRejection =
  | 'empty_refund'               // refundItems 空 / 全 0
  | 'unknown_item'               // 退的品項不在 remainingItems
  | 'duplicate_refund_item'      // refundItems 內同 orderItemId 重複
  | 'quantity_exceeds_remaining' // 退量 > 剩餘量
  | 'invalid_amount'             // 任一金額/數量非安全整數、負數、幣別不一致(鏡像 errors.ts)
  | 'discount_unsupported'       // currentDiscountTotal ≠ 0(Phase 1 fail-closed、走人工 SOP)
  | 'subtotal_mismatch'          // currentSubtotal ≠ Σ remainingItems(unitPrice×remainingQuantity)=orders 欄與品項漂移、fail-closed
  | 'non_positive_refund';       // 算出退款額 ≤ 0(例:退 NT$50 品項卻要補 NT$100 運費差)→ 拒、提示改整單取消或加退品項
```

### 3.2 計算規則(Sean 拍板逐條對應)

1. `refundedItemsAmount = Σ unitPrice × quantity`(退的品項)。
2. `newSubtotal = currentSubtotal − refundedItemsAmount`;`fullRefund = (newSubtotal === 0)`。
3. `newShippingFee`:**fullRefund → 0**(邊界②全退回退運費;🔴 不可呼 `calculateShippingFee(0,'home')`=會回 100);否則 `calculateShippingFee(newSubtotal, shippingMethod)`(重用既有函式、零複製門檻常數 → 自動對齊 #216 drift gate)。
4. `refundAmount = refundedItemsAmount − (newShippingFee − currentShippingFee)`(D1=B 公式;fullRefund 時自動展開為「退品項 + 回退舊運費」)。
5. `refundAmount ≤ 0 → non_positive_refund` 拒絕。
6. 多次連續部分退=呼叫端每次傳「當下剩餘」(邊界①基準=當下餘額;引擎 stateless 天然滿足)。
7. `store` 恆 0:由 `calculateShippingFee` 既有分支涵蓋、無特例碼。
8. 金額全整數 `Money`、過 `toMoneyAmount`/幣別一致守門;任何違反 → `invalid_amount`(鐵則:金額禁 number 浮點——amount 為整數元位、計算全整數加減乘)。
9. **守恆不變量**(測試強制):`refundAmount + newSubtotal + newShippingFee === currentSubtotal + currentShippingFee`(discount=0 下錢不憑空增減)。

### 3.3 「整單取消」的關係

整單取消(PRD 邊界②)=呼叫端把全部剩餘品項當 refundItems 傳入 → `fullRefund=true` 路徑;引擎不另設 API(RF2b 的 `admin_cancel_order` 消費同一函式語意)。

## 4. 測試矩陣(全數為驗收條件)

| # | 案例 | 期望 |
| --- | --- | --- |
| 1 | Sean 範例:2500+3000 home 免運,退 3000 品項 | refund=2900、newFee=100、newSubtotal=2500、守恆 |
| 2 | 續 #1 第二輪退剩餘 2500(基準=當下) | fullRefund、newFee=0、refund=2600(2500+回退 100);兩輪合計 5500=原付 |
| 3 | 原收運費單(3000+fee100),退 1000 → 再退 2000 | 1000 → 2100;合計 3100=原付 |
| 4 | 一輪全退(免運單) | refund=5500、newFee=0 |
| 5 | 退後 newSubtotal 恰=5000 / 4999 | fee 0 / fee 100(門檻邊界) |
| 6 | 退 100 品項使 5050→4950 | refund=0 → `non_positive_refund` 拒 |
| 7 | 退 50 品項(跨門檻) | refund=−50 → `non_positive_refund` 拒 |
| 8 | store 單任意退 | fee 恆 0、refund=品項額 |
| 9 | 量 3×1000 退 1(Q3=B) | refund=1000、剩餘量 2 |
| 10 | 退量>剩餘 / 未知品項 / 空退 / 同品項重複列 | 各對應 rejection |
| 11 | discount>0 / subtotal 與品項和不符 | `discount_unsupported` / `subtotal_mismatch` |
| 12 | 非整數金額、負數、幣別混用 | `invalid_amount` |
| 13 | 守恆不變量:隨機化多輪部分退到清空,Σrefund+殘值=原付 | 恆成立 |
| 14 | 突變自驗:①移除 fullRefund→0 特例(測 2/4 轉紅)②公式 −(新−舊) 改 +(測 1 轉紅)③移除 non_positive 閘(測 6/7 轉紅) | 全紅才收 |

## 5. 鐵則判定

- 鐵則 12:①錢 命中(金額權威)→ 高風險片、codex 雙關卡+code-reviewer 不降級。零 migration、零交易模擬(無 DB)。
- 鐵則 8:純新增 2 檔+barrel 一行、不動 schema/API/既有共用行為;上位線級 plan 已 Sean 過目、本片 plan 走關卡1。
- 鐵則 4:40 分鐘內;鐵則 6:引擎檔預估 <200 行。
- 鐵則 3(前後台同步):本片純 domain、無 UI/後台變更 → 不觸發;消費端在 RF5/RF6。

## 6. 驗收條件(逐條 yes/no)

1. §4 矩陣 14 組全綠(含突變 3 組全紅後還原)。
2. `refund.ts` 重用 `calculateShippingFee`、零複製 5000/100 常數(grep 證)。
3. 三綠:typecheck+lint+build(動 .ts)。
4. 動共用 package → 跑完整 `pnpm test`(全 repo)綠。
5. 零既有檔行為變更(diff 僅新檔+barrel export)。

## 7. Rollback

純新增檔案;revert 本片 commit 即完全還原、無資料/部署面。

## 8. 相關既有紀錄與連動面(偵察 pass 命中)

- #216:運費門檻 TS↔SQL drift gate 已存在 → 本片靠「重用函式」自動在 gate 保護內。
- #26:partiallyRefunded enum(Q1=A)→ RF2a 的事、本片不碰 payment_status。
- graphify:退款態樞紐在 `settleCharge` 分類層(RF7)、與本片無耦合。
- Q5(D4 覆核口徑)未答:不影響本片(純數學、無狀態機)。
- 未確認項①(同 rec_trade_id 多次部分退官方口徑):RF3 驗;本片公式對「多次退」的正確性由守恆測試證,與 TapPay 行為無關。
