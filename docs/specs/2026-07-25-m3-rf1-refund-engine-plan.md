# RF1 Slice Plan — 退款金額+運費重算引擎(純函式)(2026-07-25;**v2 = codex 關卡1 R1 FAIL findings 折入後**)

> 退刷自動化線第 1 片(上位 PRD=`docs/specs/2026-07-24-refund-automation-line-prd.md` §4 RF1;拍板=§0+§0b)。
> 片型=**高風險片**(鐵則 12 ①錢:本片產出=全線退款金額的數學權威);審查=codex 關卡1(本 plan)→實作→三綠→code-reviewer→codex 關卡2、不降級。
> 內容分級=**L1**(純程式邏輯、無內容);估時 45 分鐘(v1 寫 40、codex 指不可信 → 重估 45、仍在鐵則 4 上限內)。
> **v2 變更**:codex 關卡1 R1 判 FAIL、8 findings;技術面 6 條全數屬實已折入(見 §9 逐條銷案),第 7 條「運費規則版本」升為 **Q6 上游決策題等 Sean**(§10),第 8 條估時已重估。

## 1. 目標與動機

一個 stateless 純函式 `computeRefundQuote`:給「訂單當下剩餘狀態 + 要退的品項與數量」,回「該退客人多少錢 + 訂單三金額欄的新值 + 逐筆明細」。後續 RF2b(RPC 以 SQL 重算驗證)、RF5(server action 呼 TapPay)、RF6(UI 預覽)全部消費同一份輸出——金額數學只此一處權威(TS 側)。

## 2. 檔案清單(限制;不動任何既有檔行為)

1. `packages/domain/src/order/refund.ts`(新)— 引擎本體 + 型別。
2. `packages/domain/src/order/refund.test.ts`(新)— 窮舉測試(§4 矩陣)。
3. `packages/domain/src/index.ts`(或既有 barrel;僅加 export 一行)。

不動:`shipping.ts`、`order.ts`、`errors.ts`、`shared/types.ts`、任何 RPC/migration/UI。

## 3. 規格

### 3.1 型別

🔴 **v2 修正 F1**:`Money.amount` 走 `toMoneyAmount()`、**實測只允許整數且非負**(`shared/types.ts:44-51` throw on negative)→ v1 的 `shippingFeeDelta: Money` 帶 −100 會直接 throw、**型別上不可成立** → 改為「方向 + 非負金額」union。

```ts
interface RefundQuoteInput {
  shippingMethod: ShippingMethod;            // 'home' | 'store';🔴 DB 欄為無 CHECK 的 text → 本片自行白名單驗、不倚賴 TS 型別
  currentShippingFee: Money;                 // orders.shipping_fee 當下值
  currentSubtotal: Money;                    // orders.subtotal 當下值(剩餘有效小計)
  currentDiscountTotal: Money;               // orders.discount_total(Phase 1 恆 0、非 0 直接 reject)
  remainingItems: ReadonlyArray<{ orderItemId: string; unitPrice: Money; remainingQuantity: number }>;
  refundItems: ReadonlyArray<{ orderItemId: string; quantity: number }>;  // Q3=B 部分數量
}

type RefundQuoteResult =
  | { ok: true; quote: RefundQuote }
  | { ok: false; kind: RefundQuoteRejection };   // 🔴 全部壞輸入都走這條、引擎對外零 throw

interface RefundQuote {
  refundAmount: Money;              // 打 TapPay refund 的 amount(非負、>0 保證)
  refundedItemsAmount: Money;       // 退品項金額小計
  refundedLines: ReadonlyArray<{    // 🔴 v2 新增(F3):逐筆明細供 RF2a 帳本 / RF6 預覽 / audit
    orderItemId: string;
    quantity: number;               // 本次退數量
    unitPrice: Money;
    lineAmount: Money;              // unitPrice × quantity
    remainingQuantityAfter: number; // 退後剩餘量
  }>;
  previousShippingFee: Money;       // 🔴 v2(F1):改輸出兩個非負值 + 方向,不輸出 signed delta
  newShippingFee: Money;            // 重算後訂單層級運費(D5:單一數字)
  shippingAdjustment: {             // 🔴 v2(F1)
    direction: 'charge' | 'refund' | 'none';  // charge=新>舊(自退款額扣回);refund=新<舊(回退給客人)
    amount: Money;                             // 非負差額絕對值
  };
  newSubtotal: Money;               // = currentSubtotal − refundedItemsAmount
  newTotal: Money;                  // = newSubtotal + newShippingFee − discountTotal(0)
  fullRefund: boolean;              // 🔴 v2(F2):定義見 3.2-3,不再用 newSubtotal === 0
}

type RefundQuoteRejection =
  // 🔴 v2(F6):錯誤分類改對齊 errors.ts 既有 kind 命名(invalid_quantity / currency_mismatch /
  //     subtotal_mismatch 在 errors.ts:29-33 本就各自獨立),不再混塞 invalid_amount、不宣稱「鏡像」。
  | 'empty_refund'                    // refundItems 空 / 全 0
  | 'unknown_item'                    // 退的品項不在 remainingItems
  | 'duplicate_refund_item'           // refundItems 內同 orderItemId 重複
  | 'duplicate_remaining_item'        // 🔴 v2(F4):remainingItems 內同 id 重複
  | 'invalid_quantity'                // 🔴 v2(F4/F6):數量非安全整數 / 負 / 超出 DB int 上限
  | 'quantity_exceeds_remaining'      // 退量 > 剩餘量
  | 'invalid_amount'                  // 金額非安全整數 / 負(僅金額;數量與幣別已分家)
  | 'currency_mismatch'               // 🔴 v2(F6):幣別不一致自 invalid_amount 拆出
  | 'invalid_shipping_method'         // 🔴 v2(F4):非 home/store(不讓 calculateShippingFee throw 逸出)
  | 'amount_overflow'                 // 🔴 v2(F5):任一輸入或乘/加/減中間值超過 DB integer 上限 2147483647
  | 'discount_unsupported'            // currentDiscountTotal ≠ 0(Phase 1 fail-closed、走人工 SOP)
  | 'subtotal_mismatch'               // currentSubtotal ≠ Σ remainingItems(unitPrice×remainingQuantity)
  | 'zero_value_remainder_unsupported'// 🔴 v2(F2 衍生):newSubtotal=0 但非全退(零元品項殘留)→ 拒、走人工
  | 'non_positive_refund';            // 算出退款額 ≤ 0 → 拒、提示改整單取消或加退品項
```

### 3.2 計算規則(Sean 拍板逐條對應)

1. `refundedItemsAmount = Σ unitPrice × quantity`(退的品項);同時產 `refundedLines` 逐筆。
2. `newSubtotal = currentSubtotal − refundedItemsAmount`。
3. 🔴 **`fullRefund` 判定(v2 修正 F2)**= **「每個 remainingItems 的退款量都等於其 remainingQuantity」**(即所有剩餘品項全數退光),**不是** `newSubtotal === 0`。理由:`order_items.unit_price CHECK (>= 0)`(`20260604120000:145` 允許 0)→ 若留下 NT$0 品項卻退光所有付費品項,`newSubtotal` 也會是 0、v1 會誤判全退並把運費歸零。
   - 衍生保護:`newSubtotal === 0 && !fullRefund`(零元品項殘留)→ 回 `zero_value_remainder_unsupported` 拒絕。理由:PCM 現無 NT$0 商品(最低=NT$1 補差額品),此組合的運費語意未經 Sean 拍板 → fail-closed 走人工,不由引擎自行發明。
4. `newShippingFee`:**fullRefund → 0**(邊界②全退回退運費;🔴 不可呼 `calculateShippingFee(0,'home')`=會回 100);否則 `calculateShippingFee(newSubtotal, shippingMethod)`(重用既有函式、零複製門檻常數 → 自動對齊 #216 drift gate)。**呼叫前先自驗 method 白名單**,壞值回 `invalid_shipping_method`、不讓既有函式 throw 逸出(F4)。
5. `shippingAdjustment` = `newShippingFee` vs `previousShippingFee` 的方向 + 非負差額(F1)。
6. `refundAmount` = `refundedItemsAmount − (newShippingFee − currentShippingFee)`,以非負算術表達:
   - `direction==='charge'` → `refundedItemsAmount − shippingAdjustment.amount`
   - `direction==='refund'` → `refundedItemsAmount + shippingAdjustment.amount`
   - `direction==='none'` → `refundedItemsAmount`
7. `refundAmount ≤ 0 → non_positive_refund` 拒絕。
8. 多次連續部分退=呼叫端每次傳「當下剩餘」(邊界①基準=當下餘額;引擎 stateless 天然滿足)。
9. `store` 恆 0:由 `calculateShippingFee` 既有分支涵蓋、無特例碼。
10. 🔴 **整數與溢位守門(v2 新增 F5)**:`toMoneyAmount()` 實測**只驗整數+非負、無 `Number.isSafeInteger`**(`shared/types.ts:44-51`);而 DB 側 `create_order` 用 bigint 中間值 + `> 2147483647` RAISE(`20260716190000:263-265`)。→ 本引擎自行對**每個輸入值與每個乘/加/減中間結果**驗 `Number.isSafeInteger` 且 `<= 2147483647`,違反回 `amount_overflow`,**不倚賴 `toMoneyAmount` 兜底**。
11. **守恆不變量**(測試強制):`refundAmount + newTotal === currentTotal`(其中 `currentTotal = currentSubtotal + currentShippingFee − 0`)。等價於「錢不憑空增減」。

### 3.3 「整單取消」的關係

整單取消(PRD 邊界②)=呼叫端把全部剩餘品項與全部剩餘數量當 refundItems 傳入 → `fullRefund=true` 路徑;引擎不另設 API(RF2b 的 `admin_cancel_order` 消費同一函式語意)。

## 4. 測試矩陣(全數為驗收條件)

| # | 案例 | 期望 |
| --- | --- | --- |
| 1 | Sean 範例:2500+3000 home 免運,退 3000 品項 | refund=2900、newFee=100、adjustment=charge/100、newSubtotal=2500、守恆 |
| 2 | 續 #1 第二輪退剩餘 2500(基準=當下) | fullRefund、newFee=0、adjustment=refund/100、refund=2600;兩輪合計 5500=原付 |
| 3 | 原收運費單(3000+fee100),退 1000 → 再退 2000 | 1000(none)→ 2100(refund/100);合計 3100=原付 |
| 4 | 一輪全退(免運單) | refund=5500、newFee=0、fullRefund |
| 5 | 退後 newSubtotal 恰=5000 / 4999 | fee 0 / fee 100(門檻邊界) |
| 6 | 退 100 品項使 5050→4950 | refund=0 → `non_positive_refund` 拒 |
| 7 | 退 50 品項(跨門檻) | refund=−50 → `non_positive_refund` 拒 |
| 8 | store 單任意退 | fee 恆 0、adjustment=none、refund=品項額 |
| 9 | 量 3×1000 退 1(Q3=B) | refund=1000、`refundedLines[0].remainingQuantityAfter=2` |
| 10 | 退量>剩餘 / 未知品項 / 空退 / refundItems 同 id 重複 / remainingItems 同 id 重複 | 各對應 rejection(含 F4 新增兩項) |
| 11 | discount>0 / subtotal 與品項和不符 | `discount_unsupported` / `subtotal_mismatch` |
| 12 | 非整數金額、負金額、幣別混用、數量 0/負/非整數、method='' 或 'pickup' | `invalid_amount` / `currency_mismatch` / `invalid_quantity` / `invalid_shipping_method`(**逐 kind 分別斷言、不接受只驗 ok===false**) |
| 13 | 🔴 v2(F2):留 NT$0 品項退光付費品項 | `zero_value_remainder_unsupported`;另組「連 NT$0 品項一起全退」→ fullRefund 正常 |
| 14 | 🔴 v2(F5):unitPrice=2147483647、quantity 使乘積溢位、currentSubtotal 超上限、`Number.MAX_SAFE_INTEGER+1` | 全回 `amount_overflow`、零 throw |
| 15 | 守恆不變量:多組固定情境多輪部分退到清空,Σrefund + 殘值 = 原付 | 恆成立 |
| 16 | 引擎對外零 throw:上述所有壞輸入包 try/catch 斷言未 throw | 全數回 `{ok:false}` |
| 17 | 突變自驗:①移除 fullRefund→0 特例(測 2/4 轉紅)②公式 −(新−舊) 改 +(測 1 轉紅)③移除 non_positive 閘(測 6/7 轉紅)④fullRefund 判定改回 `newSubtotal===0`(測 13 轉紅)⑤移除溢位守門(測 14 轉紅) | 5 組全紅才收 |

## 5. 鐵則判定

- 鐵則 12:①錢 命中(金額權威)→ 高風險片、codex 雙關卡+code-reviewer 不降級。零 migration、零交易模擬(無 DB)。
- 鐵則 8:純新增 2 檔+barrel 一行、不動 schema/API/既有共用行為;上位線級 plan 已 Sean 過目、本片 plan 走關卡1。
- 鐵則 4:重估 45 分鐘(v1 的 40 分未計 F4/F5 守門與 F3 明細;仍在 15-45 上限內、**若實作中超時則停下回報、不硬塞**)。
- 鐵則 6:引擎檔預估 <250 行(v2 守門增量後仍遠低於 400)。
- 鐵則 3(前後台同步):本片純 domain、無 UI/後台變更 → 不觸發;消費端在 RF5/RF6。

## 6. 驗收條件(逐條 yes/no)

1. §4 矩陣 17 組全綠(含突變 5 組逐一轉紅後還原、shasum 比對)。
2. `refund.ts` 重用 `calculateShippingFee`、零複製 5000/100 常數(grep 證)。
3. **引擎對外零 throw**:所有 rejection 路徑回 `{ok:false}`(測 16 機械證明)。
4. 三綠:typecheck+lint+build。
5. 動共用 package → 跑完整 `pnpm test`(全 repo)綠。
6. 零既有檔行為變更(diff 僅新檔+barrel export 一行)。
7. plan 字面 vs 實作一致;偏離寫進 commit body。

## 7. Rollback

純新增檔案;revert 本片 commit 即完全還原、無資料/部署面。

## 8. 相關既有紀錄與連動面(偵察 pass 命中)

- #216:運費門檻 TS↔SQL drift gate 已存在 → 本片靠「重用函式」自動在 gate 保護內。
- #26:partiallyRefunded enum(Q1=A)→ RF2a 的事、本片不碰 payment_status。
- graphify:退款態樞紐在 `settleCharge` 分類層(RF7)、與本片無耦合。
- Q5(D4 覆核口徑)未答:不影響本片(純數學、無狀態機)。
- 未確認項①(同 rec_trade_id 多次部分退官方口徑):RF3 驗;本片公式對「多次退」的正確性由守恆測試證,與 TapPay 行為無關。

## 9. codex 關卡1 R1 findings 逐條銷案(2026-07-25)

| # | codex finding | 核對結果 | 處置 |
| --- | --- | --- | --- |
| F1 | `shippingFeeDelta: Money` 不可成立(Money 非負) | ✅ 屬實(`shared/types.ts:44-51` throw on negative) | 折入:改 `previousShippingFee` + `newShippingFee` + `shippingAdjustment{direction,非負amount}` |
| F2 | `fullRefund = newSubtotal===0` 誤判(零元品項) | ✅ 屬實(`order_items.unit_price CHECK >= 0` 允許 0) | 折入:改「所有剩餘品項全數退」判定 + 新增 `zero_value_remainder_unsupported` fail-closed + 測 13 |
| F3 | 缺逐筆明細、與 PRD §4 RF1「明細」drift | ✅ 屬實(PRD 明寫「輸出=退款額、新運費、明細」) | 折入:新增 `refundedLines[]`(含退後剩餘量) |
| F4 | 輸入守門不完整(remaining 重複 id / quantity 混類 / method 壞值致 throw) | ✅ 屬實 | 折入:新增 `duplicate_remaining_item`/`invalid_quantity`/`invalid_shipping_method` + 驗收條件 3「對外零 throw」 |
| F5 | 宣稱安全整數但 `toMoneyAmount` 無 `isSafeInteger`、無 DB int 上限守門 | ✅ 屬實(`types.ts:44-51` 只驗整數+非負;`create_order` 有 2147483647 閘) | 折入:自行 safe-integer + 2147483647 全鏈守門 + `amount_overflow` + 測 14 |
| F6 | 宣稱「鏡像 errors.ts」但把 quantity/currency 混進 invalid_amount | ✅ 屬實(`errors.ts:29-33` 三者本就獨立) | 折入:錯誤 kind 拆開對齊既有命名;移除不實的「鏡像」宣稱 |
| F7 | 運費規則版本(當下表 vs 下單凍結)未定義 | ✅ 屬實且**超出 AI 可拍板範圍**(涉錢語意) | **升為 Q6 決策題等 Sean**(§10);v2 暫按 A(當下表)撰寫、若 Sean 選 B 則 `RefundQuoteInput` 加一個 rule 參數(小改、不影響其餘設計) |
| F8 | 40 分鐘估時不可信 | ✅ 接受 | 重估 45 分鐘;超時停下回報 |

## 10. 🔴 開工前必答決策題(Q6;RF1 實作前 gate)

**Q6 運費規則版本**:退款重算運費時,用「**當下的運費表**」還是「**下單當時凍結的運費表**」?
- 背景:門檻 5000/免運、未滿 100 是 **L2 hardcode、季度可能調整**(`shipping.ts:9-10` 自述);`orders` 表**未存**規則版本(只存算出來的 `shipping_fee`)。
- 影響:今天無差別(門檻從未變過);一旦調整門檻,舊單退款會用新規則重算 → 退款額與客人當初付的邏輯不一致。
- **A(推薦)**=用當下運費表(現行 `calculateShippingFee`)。簡單、與前台顯示一致、零 schema 變更;風險=調價後舊單退款規則不同,靠「調價低頻 + 退款多在下單後短期內」吸收。
- **B**=下單凍結規則:RF2a 需在 `orders` 加欄存門檻/費率(或規則版本號),`create_order` 也要一併寫入 → 動到既有建單 RPC(高風險擴張)、且**舊訂單無此欄需 backfill 或 fallback**。

(Q5 仍待答:D4=B 隔日 Record 覆核維持,或 refund `status=0` 當下即標已退款。)
