# RF1 Slice Plan — 退款金額+運費重算引擎(純函式)(2026-07-25;**v4 = codex 關卡1 R2 findings 折入**)

> 退刷自動化線第 1 片(上位 PRD=`docs/specs/2026-07-24-refund-automation-line-prd.md` §4 RF1;拍板=§0/§0b/§0c)。
> 片型=**高風險片**(鐵則 12 ①錢:本片產出=全線退款金額的數學權威、且動到共用運費函式簽章);審查=codex 關卡1→實作→三綠→code-reviewer→codex 關卡2、不降級。
> 內容分級=**L1**(純程式邏輯、無內容);估時 **50 分鐘**(§5 揭示鐵則 4 偏離與理由)。
>
> **版本沿革**:v1 初稿 → codex 關卡1 R1 **FAIL 8 findings** → v2 折入 6 條技術面 + 升 Q6 決策題 → v3 = Sean 拍 Q6=B(下單凍結)折入,引擎改收 `shippingRule`、`calculateShippingFee` 加選填第三參數 → **v4(本版)= codex 關卡1 R2 判 FAIL、4 條 findings 全折入**(§10);**plan 層 2 輪已用盡、不跑 R3**。

## 1. 目標與動機

一個 stateless 純函式 `computeRefundQuote`:給「訂單當下剩餘狀態 + **該訂單下單時凍結的運費規則** + 要退的品項與數量」,回「該退客人多少錢 + 訂單三金額欄的新值 + 逐筆明細」。後續 RF2b(RPC 以 SQL 重算驗證)、RF5(server action 呼 TapPay)、RF6(UI 預覽)全部消費同一份輸出——金額數學只此一處權威(TS 側)。

🔴 **Q6=B 的意義**:退款重算運費時,用「這張訂單下單當時的門檻/費率」而非「今天的常數」。本片讓引擎**接受規則當輸入**;規則從哪來(orders 凍結欄)由 **RF2a-0** 負責——兩片解耦,本片不依賴 RF2a-0 先落地(測試自帶規則值)。

## 2. 檔案清單(限制)

| # | 檔案 | 變更性質 |
| --- | --- | --- |
| 1 | `packages/domain/src/order/shipping.ts` | **擴充**:新增 `ShippingRule` 型別 + `DEFAULT_SHIPPING_RULE` 常數 + `calculateShippingFee` **選填**第三參數 `rule`(預設=現行常數)。🔴 **行為零變更**、既有兩參呼叫完全不受影響 |
| 2 | `packages/domain/src/order/shipping.test.ts` | 補測:預設參數等價既有行為 + 自訂 rule 路徑 |
| 3 | `packages/domain/src/order/refund.ts` | **新增**:引擎本體 + 型別 |
| 4 | `packages/domain/src/order/refund.test.ts` | **新增**:§4 窮舉矩陣 |
| 5 | `packages/domain/src/index.ts` | 僅加 export(refund 型別/函式 + `ShippingRule`/`DEFAULT_SHIPPING_RULE`) |

不動:`order.ts`、`errors.ts`、`shared/types.ts`、任何 RPC/migration/UI/呼叫端。
🔴 **唯一既有呼叫端** = `apps/storefront/src/hooks/useResolvedCart.tsx:118`(兩參呼叫)→ 選填參數保證零改動、零行為變更;驗收條件 6 以測試機械證明。

## 3. 規格

### 3.1 `shipping.ts` 擴充(v3 新增)

```ts
/** 運費規則(門檻/費率);Q6=B:退款重算須用「訂單下單當時」的規則、非當下常數。 */
export interface ShippingRule {
  freeThreshold: MoneyAmount;  // 宅配免運門檻(達到即免運)
  homeFee: MoneyAmount;        // 宅配未達門檻運費
}

/**
 * 現行規則。🔴 **v4(R2-F1):必須逐欄由既有兩常數建立、不得另寫字面值**
 * ——否則 `DEFAULT_SHIPPING_RULE` 可獨立漂走而 #216 gate 與測 19 都抓不到(同源假綠)。
 */
export const DEFAULT_SHIPPING_RULE: ShippingRule = {
  freeThreshold: toMoneyAmount(FREE_SHIPPING_THRESHOLD),
  homeFee: toMoneyAmount(HOME_SHIPPING_FEE),
};

export function calculateShippingFee(
  subtotal: Money,
  method: ShippingMethod,
  rule: ShippingRule = DEFAULT_SHIPPING_RULE,   // 🔴 選填、預設保既有行為
): Money;
```

🔴 **零複製門檻邏輯**:`store→0` / `subtotal >= rule.freeThreshold ? 0 : rule.homeFee` 分支仍只此一處;RF1 引擎呼叫本函式、不自行實作分支(§6 驗收條件 2)。

🔴 **v4(R2-F1)#216 drift gate 必須同片擴充**:既有 `packages/domain/src/order/shipping-rpc-drift.test.ts` 只斷言「TS 兩常數 == 最新 create_order migration §7 CASE」;本片新增 `DEFAULT_SHIPPING_RULE` 後,gate 須加斷言 **`DEFAULT_SHIPPING_RULE.freeThreshold/homeFee` 逐欄 == 該兩常數 == SQL CASE 兩數**(三方一致)。
🔴 **字面事實更正(v4)**:當前生效的 `create_order` 定義 = **`supabase/migrations/20260719120000_m4a_b2_create_order_notification_email.sql`**(運費 CASE 在 `:459`、`INSERT INTO public.orders` 具名欄位在 `:471-477`)。⚠️ 先前 PRD/偵察與 codex R2 分別引用 `20260716190000` / `20260716200000` **皆為已被取代的舊版**(drift gate 依檔名時戳取最新、實測即 `20260719120000`)。其 INSERT 為**具名欄位列**⇒ 新增欄位不在列內 ⇒ **RF2a-0 的 B3(欄位 DEFAULT 凍結、零 RPC 改動)路線經此實證可行**。

### 3.2 引擎型別

🔴 **v2 修正 F1 沿用**:`Money.amount` 走 `toMoneyAmount()`、**實測只允許整數且非負**(`shared/types.ts:44-51` throw on negative)→ 不輸出 signed delta,改「方向 + 非負金額」。

```ts
interface RefundQuoteInput {
  shippingMethod: ShippingMethod;            // 🔴 DB 欄為無 CHECK 的 text → 本片自行白名單驗、不倚賴 TS 型別
  shippingRule: ShippingRule;                // 🔴 v3(Q6=B):訂單凍結規則,呼叫端必給、引擎不 fallback 到常數
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
  refundedLines: ReadonlyArray<{    // v2(F3):逐筆明細供 RF2a 帳本 / RF6 預覽 / audit
    orderItemId: string;
    quantity: number;
    unitPrice: Money;
    lineAmount: Money;              // unitPrice × quantity
    remainingQuantityAfter: number;
  }>;
  previousShippingFee: Money;
  newShippingFee: Money;            // 重算後訂單層級運費(D5:單一數字)
  shippingAdjustment: {             // v2(F1)
    direction: 'charge' | 'refund' | 'none';  // charge=新>舊(自退款額扣回);refund=新<舊(回退給客人)
    amount: Money;                             // 非負差額絕對值
  };
  newSubtotal: Money;
  newTotal: Money;                  // = newSubtotal + newShippingFee − discountTotal(0)
  fullRefund: boolean;              // v2(F2):定義見 3.3-3
}

type RefundQuoteRejection =
  // v2(F6):錯誤分類對齊 errors.ts 既有 kind 命名(invalid_quantity / currency_mismatch /
  //     subtotal_mismatch 在 errors.ts:29-33 本就各自獨立),不混塞 invalid_amount、不宣稱「鏡像」。
  | 'empty_refund'                    // 🔴 v4(R2-F3):**僅限 refundItems 為空陣列**;任何 quantity ≤ 0 走 invalid_quantity
  | 'unknown_item'                    // 退的品項不在 remainingItems
  | 'duplicate_refund_item'           // refundItems 內同 orderItemId 重複
  | 'duplicate_remaining_item'        // v2(F4)
  | 'invalid_quantity'                // v2(F4/F6)+v4(R2-F3):數量非安全整數 / **≤0(含 0)** / 超 DB int 上限;`refundItems` 與 `remainingItems` 兩陣列都檢
  | 'quantity_exceeds_remaining'
  | 'invalid_amount'                  // 僅金額(數量與幣別已分家)
  | 'currency_mismatch'               // v2(F6)
  | 'invalid_shipping_method'         // v2(F4):非 home/store(不讓 calculateShippingFee throw 逸出)
  | 'invalid_shipping_rule'           // 🔴 v3:凍結規則欄非安全整數 / 負 / 超上限
  | 'amount_overflow'                 // v2(F5):輸入或乘/加/減中間值超過 DB integer 上限 2147483647
  | 'discount_unsupported'
  | 'subtotal_mismatch'
  | 'zero_value_remainder_unsupported'// v2(F2 衍生):newSubtotal=0 但非全退(零元品項殘留)
  | 'non_positive_refund';            // 退款額 ≤ 0
```

### 3.3 計算規則(Sean 拍板逐條對應)

1. `refundedItemsAmount = Σ unitPrice × quantity`;同時產 `refundedLines` 逐筆。
2. `newSubtotal = currentSubtotal − refundedItemsAmount`。
3. 🔴 **`fullRefund` 判定(v2 修正 F2)**= **「每個 remainingItems 的退款量都等於其 remainingQuantity」**(所有剩餘品項全數退光),**不是** `newSubtotal === 0`。理由:`order_items.unit_price CHECK (>= 0)` 允許 0 → 留 NT$0 品項而退光付費品項時 `newSubtotal` 也是 0、v1 會誤判全退並把運費歸零(少收運費)。
   - 衍生保護:`newSubtotal === 0 && !fullRefund` → `zero_value_remainder_unsupported` 拒絕(PCM 現無 NT$0 商品、最低 NT$1;此組合運費語意未經拍板 → fail-closed 走人工,不由引擎發明)。
4. `newShippingFee`:**fullRefund → 0**(邊界②全退回退運費;🔴 不可呼 `calculateShippingFee(0, 'home', rule)`=會回 `rule.homeFee`);否則 `calculateShippingFee(newSubtotal, shippingMethod, input.shippingRule)`(🔴 v3:傳**凍結規則**)。呼叫前先自驗 method 白名單與 rule 合法性,壞值回 `invalid_shipping_method` / `invalid_shipping_rule`、不讓既有函式 throw 逸出(F4)。
5. `shippingAdjustment` = `newShippingFee` vs `previousShippingFee` 的方向 + 非負差額(F1)。
6. `refundAmount` = `refundedItemsAmount − (newShippingFee − currentShippingFee)`,以非負算術表達:
   - `charge` → `refundedItemsAmount − shippingAdjustment.amount`
   - `refund` → `refundedItemsAmount + shippingAdjustment.amount`
   - `none` → `refundedItemsAmount`
7. `refundAmount ≤ 0 → non_positive_refund` 拒絕。
8. 多次連續部分退=呼叫端每次傳「當下剩餘」(邊界①基準=當下餘額;引擎 stateless 天然滿足)。
9. `store` 恆 0:由 `calculateShippingFee` 既有分支涵蓋、無特例碼。
10. 🔴 **整數與溢位守門(v2 F5)**:`toMoneyAmount()` 實測**只驗整數+非負、無 `Number.isSafeInteger`**(`shared/types.ts:44-51`);DB 側 `create_order` 用 bigint 中間值 + `> 2147483647` RAISE(`20260716190000:263-265`)。→ 引擎自行對**每個輸入值(含 `shippingRule` 兩欄)與每個乘/加/減中間結果**驗 `Number.isSafeInteger` 且 `<= 2147483647`,違反回 `amount_overflow`,不倚賴 `toMoneyAmount` 兜底。
11. **守恆不變量**(測試強制):`refundAmount + newTotal === currentTotal`(`currentTotal = currentSubtotal + currentShippingFee − 0`)。

### 3.4 「整單取消」的關係

整單取消(PRD 邊界②)=呼叫端把全部剩餘品項與全部剩餘數量當 refundItems 傳入 → `fullRefund=true` 路徑;引擎不另設 API(RF2b 的 `admin_cancel_order` 消費同一語意)。

## 4. 測試矩陣(全數為驗收條件;規則值除註明外用 `{5000, 100}`)

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
| 10 | 退量>剩餘 / 未知品項 / **refundItems=`[]`** / refundItems 同 id 重複 / remainingItems 同 id 重複 | 各對應 rejection(空陣列→`empty_refund`;含 F4 兩項) |
| 10b | 🔴 **v4(R2-F3)rejection 優先序**:`refundItems=[{qty:0}]`(非空但量 0)、`remainingItems` 內含 `remainingQuantity:0` | 兩者皆 → `invalid_quantity`(**不是** `empty_refund`);另證「空陣列」與「量 0」兩路徑各回各的 kind、契約無歧義 |
| 11 | discount>0 / subtotal 與品項和不符 | `discount_unsupported` / `subtotal_mismatch` |
| 12 | 非整數金額、負金額、幣別混用、數量 0/負/非整數、method='' 或 'pickup' | `invalid_amount` / `currency_mismatch` / `invalid_quantity` / `invalid_shipping_method`(**逐 kind 分別斷言、不接受只驗 ok===false**) |
| 13 | v2(F2):留 NT$0 品項退光付費品項 | `zero_value_remainder_unsupported`;另組「連 NT$0 品項一起全退」→ fullRefund 正常 |
| 14 | v2(F5):unitPrice=2147483647、乘積溢位、currentSubtotal 超上限、`MAX_SAFE_INTEGER+1`、rule 欄超上限 | 全回 `amount_overflow`、零 throw |
| 15 | 守恆不變量:多組固定情境多輪部分退到清空 | Σrefund + 殘值 = 原付,恆成立 |
| 16 | 引擎對外零 throw:所有壞輸入包 try/catch 斷言未 throw | 全回 `{ok:false}` |
| 17 | 🔴 **v3 凍結規則生效(v4 修正期望值、R2-F2)**:同一情境(退 3000 品項後 `newSubtotal=2500`、原 fee 0)分別套三組規則 | `{5000,100}`→newFee **100**/refund **2900**;`{3000,60}`→2500<3000 → newFee **60**/refund **2940**;`{2000,60}`→2500≥2000 → newFee **0**/refund **3000**。⇒ 三組同時證「**門檻**與**費率**都取自輸入、非模組常數」。⚠️ v3 原寫 `{3000,60}`→0/3000 **算錯**(2500<3000 不可能免運),codex R2 抓出 |
| 18 | 🔴 **v3 規則守門**:rule 欄負數 / 非整數 / 缺欄 | `invalid_shipping_rule`、零 throw |
| 19 | 🔴 **v3 `shipping.ts` 零行為變更(v4 補強、R2-F1)**:①既有兩參呼叫 vs 三參傳 `DEFAULT_SHIPPING_RULE` 逐組**輸出全等** ②🔴 **加「固定期望值表」對照**:`home/4999→100`、`home/5000→0`、`home/5001→0`、`store/任意→0`(**寫死期望數字、不由常數推導**) | ①②皆過。🔴 **只有 ① 是同源假綠**(兩參本就 delegate 到 DEFAULT)→ 必須有 ② 才擋得住「DEFAULT 寫錯」;另由 #216 gate 擴充斷言把 `DEFAULT_SHIPPING_RULE` 綁死到常數 |
| 20 | 突變自驗:①移除 fullRefund→0 特例(2/4 紅)②公式 −(新−舊) 改 +(1 紅)③移除 non_positive 閘(6/7 紅)④fullRefund 判定改回 `newSubtotal===0`(13 紅)⑤移除溢位守門(14 紅)⑥**引擎改用 `DEFAULT_SHIPPING_RULE` 忽略輸入 rule(17 的 `{3000,60}` 與 `{2000,60}` 兩組轉紅)** ⑦🔴 **v4:`DEFAULT_SHIPPING_RULE` 改寫死 `{4000,150}`**(測 19-② 固定期望值表 + #216 擴充 gate 轉紅;若只有 19-① 則**不會紅**=證同源假綠已被補上) | 7 組全紅才收 |

## 5. 鐵則判定

- **鐵則 12**:①錢 命中(金額權威 + 動共用運費函式簽章)→ 高風險片、codex 雙關卡 + code-reviewer 不降級。零 migration、無 DB → 不跑交易模擬。
- **鐵則 8**:動到 `packages/domain` 共用函式簽章(`calculateShippingFee`)→ 屬「動共用元件」→ **本 plan 即為等批准的 plan**;上位線級拆片 Sean 已過目、Q6=B 為其明示拍板。
- 🔴 **鐵則 4 偏離揭示**:估時 **50 分鐘 > 上限 45**。**不拆的理由**:唯一可拆點是「`shipping.ts` 選填參數」獨立成跑道片,但拆出後該片**無任何消費端**(選填參數沒人傳=半套),且它同樣命中鐵則 12 ①錢 → 需**重複跑一整輪高風險審查鏈**(codex 關卡1+關卡2),成本高於 5 分鐘超時。判定合併為單片、於本節與 commit body 揭示。**若實作中實際超過 60 分鐘 → 停下回報 Sean、不硬塞**。
- **鐵則 6**:`refund.ts` 預估 <250 行、`shipping.ts` 擴充後 <100 行(皆遠低於 400)。
- **鐵則 3**(前後台同步):本片純 domain、無 UI/後台變更 → 不觸發;消費端在 RF5/RF6。
- **鐵則 5**:無 CSS/TSX → 不適用。

## 6. 驗收條件(逐條 yes/no)

1. §4 矩陣 20 組全綠(含突變 6 組逐一轉紅後還原、shasum 逐字元比對)。
2. `refund.ts` **呼叫** `calculateShippingFee`、零複製門檻分支邏輯與 5000/100 常數(grep 證)。
3. **引擎對外零 throw**:所有 rejection 路徑回 `{ok:false}`(測 16 機械證明)。
4. 三綠:typecheck + lint + build。
5. 動共用 package → 跑完整 `pnpm test`(全 repo)綠(鐵則:動共用元件跑完整測試套件)。
6. 🔴 **`useResolvedCart.tsx` 零改動**(git diff 證)且既有行為零變更(測 19 機械證明)。
7. plan 字面 vs 實作一致;任何偏離寫進 commit body。

## 7. Rollback

新增 2 檔 + 既有 `shipping.ts` 為**純加法**(選填參數);revert 本片 commit 即完全還原、無資料/部署面、無消費端受影響。

## 8. 相關既有紀錄與連動面(偵察 pass 命中)

- **#216**:運費門檻 TS↔SQL drift gate 已存在 → 本片保留 `FREE_SHIPPING_THRESHOLD`/`HOME_SHIPPING_FEE` 常數為 `DEFAULT_SHIPPING_RULE` 的來源,**gate 保護不失效**。
- **#295**(🆕 2026-07-25 本次新登):運費後台管理 → 明確**不進本線**、退刷線收工後評估;本片的 `ShippingRule` 型別是它未來的天然介面。
- **RF2a-0**(🆕 Q6=B 衍生;🔴 **v4 修正 R2-F4:以下為 B3 精確敘述,舊「`create_order` 寫入 + backfill」字面已作廢**):`orders` 加 `shipping_free_threshold`/`shipping_home_fee` 兩欄、`NOT NULL DEFAULT`=當前規則,**零 `create_order` 改動**(其 INSERT 為具名欄位列 `20260719120000:471-477` ⇒ 新欄不在列內 ⇒ 由 DB DEFAULT 填值)、**免獨立 backfill**(PG11+ 加帶 DEFAULT 欄位同時回填既有列)。本片**不依賴它先落地**(測試自帶規則值)。
- 🔴 **RF5 串接 gate(v4 新增、R2-F4)**:RF5 實作前 **RF2a-0 必須已 apply**;RF5 組 `shippingRule` **只能**讀 `orders.shipping_free_threshold` / `orders.shipping_home_fee` 兩欄,**嚴禁 fallback 到 `DEFAULT_SHIPPING_RULE`**(fallback = 悄悄退回 Q6=A 當下表語意、Q6=B 拍板失效)。RF5 須有負向測試:兩欄任一為 null/缺 → 拒絕退款並回明確錯誤,**不得代入預設值**。
- **#26**:partiallyRefunded enum(Q1=A)→ RF2a 的事、本片不碰 `payment_status`。
- **graphify**:退款態樞紐在 `settleCharge` 分類層(RF7)、與本片無耦合。
- **Q5=A**(隔日覆核 + 失敗回滾 + 告警):狀態機議題、不影響本片純數學。

## 9. codex 關卡1 R1 findings 逐條銷案(2026-07-25)

| # | codex finding | 核對結果 | 處置 |
| --- | --- | --- | --- |
| F1 | `shippingFeeDelta: Money` 不可成立(Money 非負) | ✅ 屬實(`shared/types.ts:44-51` throw on negative) | v2 折入:`previousShippingFee` + `newShippingFee` + `shippingAdjustment{direction, 非負amount}` |
| F2 | `fullRefund = newSubtotal===0` 誤判(零元品項) | ✅ 屬實(`order_items.unit_price CHECK >= 0`) | v2 折入:改「所有剩餘品項全數退」+ `zero_value_remainder_unsupported` + 測 13 |
| F3 | 缺逐筆明細、與 PRD §4 RF1「明細」drift | ✅ 屬實 | v2 折入:`refundedLines[]`(含退後剩餘量) |
| F4 | 輸入守門不完整(remaining 重複 id / quantity 混類 / method 壞值致 throw) | ✅ 屬實 | v2 折入:3 個新 kind + 驗收條件 3「對外零 throw」 |
| F5 | 宣稱安全整數但 `toMoneyAmount` 無 `isSafeInteger`、無 DB int 上限守門 | ✅ 屬實(`types.ts:44-51` / `create_order:263-265`) | v2 折入:safe-integer + 2147483647 全鏈守門 + `amount_overflow` + 測 14 |
| F6 | 宣稱「鏡像 errors.ts」但把 quantity/currency 混進 invalid_amount | ✅ 屬實(`errors.ts:29-33` 三者獨立) | v2 折入:kind 拆開對齊;移除不實宣稱 |
| F7 | 運費規則版本(當下表 vs 下單凍結)未定義 | ✅ 屬實且超出 AI 拍板範圍 | **v3 折入:Sean 拍 Q6=B 凍結** → `shippingRule` 入參 + `calculateShippingFee` 選填參數 + 測 17/18/19 + 突變⑥ + 新片 RF2a-0 + backlog #295 |
| F8 | 40 分鐘估時不可信 | ✅ 接受 | v2 重估 45 → v3 因 Q6=B 擴充再估 **50**(§5 揭示鐵則 4 偏離與不拆理由) |

## 10. codex 關卡1 R2 findings 逐條銷案(2026-07-25;**R2 判 FAIL、4 條全屬實**)

| # | codex R2 finding | 核對結果 | 處置(v4) |
| --- | --- | --- | --- |
| R2-F1 | `DEFAULT_SHIPPING_RULE` 未與 #216 綁定、測 19 是**同源假綠**(兩參本就 delegate 到 DEFAULT,DEFAULT 寫錯兩邊一起錯仍「全等」) | ✅ 屬實(既有 gate `shipping-rpc-drift.test.ts` 只斷言 TS 常數 ↔ SQL CASE,不含新常數) | ①`DEFAULT_SHIPPING_RULE` **逐欄由既有兩常數建立**(結構上不可能漂)②#216 gate 同片擴充為三方斷言 ③測 19 加「**寫死期望值表**」(4999→100/5000→0/store→0)④突變⑦專驗此假綠已補 |
| R2-F2 | 測 17 期望值**算錯**:`newSubtotal=2500` 套 `{3000,60}` 應收 **60**、非 0 | ✅ 屬實(2500 < 3000 不可能免運;是我的算術錯) | 期望值改 60/2940;並擴為**三組規則**(`{5000,100}`/`{3000,60}`/`{2000,60}`)同時證門檻與費率都取自輸入;突變⑥改對應兩組 |
| R2-F3 | `empty_refund`(含「全 0」)與矩陣「quantity 0 → `invalid_quantity`」**契約互相矛盾**,實作者可任選一邊 | ✅ 屬實(§3.2 註解與測 12 直接衝突) | 定優先序:`empty_refund` **僅限空陣列**;任何 quantity ≤ 0(兩個輸入陣列都檢)→ `invalid_quantity`;新增測 10b 專驗兩路徑各回各的 kind |
| R2-F4 | §8 殘留舊方案文字(「`create_order` 寫入 + backfill」),與已拍定的 B3 矛盾 → 施工者可能去碰 654 行金流 RPC | ✅ 屬實(PRD 已改 B3、本 plan §8 未同步=正是「改 spec 只補動到的行」慣犯) | §8 改為 B3 精確敘述 + 新增 **RF5 串接 gate**(只能讀 orders 兩欄、**嚴禁 fallback default**、須負向測試) |

🔴 **附帶字面更正(兩方都錯,v4 已修)**:當前生效 `create_order` = **`20260719120000_m4a_b2_create_order_notification_email.sql`**(CASE `:459`、INSERT `:471-477`)。codex R2 引 `20260716200000`、本 session 偵察引 `20260716190000`,**兩者皆已被取代**;結論(B3 可行)不變、依據行號已更正為實測值。

## 11. 開工前 gate

- ~~Q6 運費規則版本~~ → ✅ **Sean 2026-07-25 拍 B(下單凍結)**,已折入 v3/v4。
- ~~Q5 D4 覆核口徑~~ → ✅ **Sean 拍 A + 失敗回滾/告警**(PRD §0c),屬 RF8、不擋本片。
- 🔴 **plan 層 codex 審查 2 輪已用盡**(R1 FAIL 8 條 → v2/v3 折入;R2 FAIL 4 條 → v4 折入)。依 `~/.claude/rules/00-work-rules.md` §5「plan 層審查上限 2 輪、round2 仍 FAIL 停下 raise Sean」+ codex-adversary skill 同條 → **不跑 R3**。
- ✅ **Sean 2026-07-25 拍 A = 直接開工實作**(知情:plan 層 2 輪已用盡、12 findings 全折入、diff 層仍有 code-reviewer + codex 關卡2 兩道)。→ **本 plan gate 全解、進實作**。
- (原題留存)~~RF1 是否直接開工實作~~(v4 已折入全部 12 條 findings、diff 層仍有 code-reviewer + codex 關卡2 兩道把關),或要再跑一輪 plan 審。**誠實說明**:R2 的 4 條都是機械性錯誤(算錯期望值/契約矛盾/文件未同步/測試同源),**非方向問題**;兩輪 findings 沒有一條質疑核心公式或 Q6=B 架構。
