# RF1 Slice Plan — 退款金額+運費重算引擎(純函式)(2026-07-25;**v7 = 五輪審查 findings 全折入**)

> 退刷自動化線第 1 片(上位 PRD=`docs/specs/2026-07-24-refund-automation-line-prd.md` §4 RF1;拍板=§0/§0b/§0c)。
> 片型=**高風險片**(鐵則 12 ①錢:本片產出=全線退款金額的數學權威、且動到共用運費函式簽章);審查=codex 關卡1→實作→三綠→code-reviewer→codex 關卡2、不降級。
> 內容分級=**L1**(純程式邏輯、無內容);估時 **50 分鐘**(§5 揭示鐵則 4 偏離與理由)。
>
> **版本沿革**:v1 初稿 → codex 關卡1 **R1 FAIL 8** → v2 → v3 = Sean 拍 Q6=B(下單凍結)折入 → v4 = codex 關卡1 **R2 FAIL 4** 折入(§10)→ v5 = **code-reviewer(opus) FAIL 3 must-fix + 8 nit** 折入(§10c)→ v6 = **codex 關卡2 R1 FAIL 5 must-fix + 1 nit** 折入(§10d)→ **v7(本版)= codex 關卡2 R2(5 must-fix + 1 nit)+ R3(4 must-fix)全折入**。
> 🔴 **共五輪審查、累計 30 must-fix + 9 nit 全數折入;另 1 條 codex 誤判經實查駁回**。
> 🔴 **R3 為 Sean 2026-07-25 特別授權破例**(平時 codex 每片上限 2 輪);**R3 的 4 條已折入但未再複審**——3 條為文件字面同步、1 條為測試隔離缺口(已補 14h + 突變 M20 驗證)。

## 1. 目標與動機

一個 stateless 純函式 `computeRefundQuote`:給「訂單當下剩餘狀態 + **該訂單下單時凍結的運費規則** + 要退的品項與數量」,回「該退客人多少錢 + 訂單三金額欄的新值 + 逐筆明細」。後續 RF2b(RPC 以 SQL 重算驗證)、RF5(server action 呼 TapPay)、RF6(UI 預覽)全部消費同一份輸出——金額數學只此一處權威(TS 側)。

🔴 **Q6=B 的意義**:退款重算運費時,用「這張訂單下單當時的門檻/費率」而非「今天的常數」。本片讓引擎**接受規則當輸入**;規則從哪來(orders 凍結欄)由 **RF2a-0** 負責——兩片解耦,本片不依賴 RF2a-0 先落地(測試自帶規則值)。

## 2. 檔案清單(限制)

| # | 檔案 | 變更性質 |
| --- | --- | --- |
| 1 | `packages/domain/src/order/shipping.ts` | **擴充**:export `ShippingRule` 型別 + **模組私有** frozen 預設規則 + `calculateShippingFee` **選填**第三參數 `rule`。🔴 **行為零變更**、既有兩參呼叫完全不受影響 |
| 2 | ~~`packages/domain/src/order/shipping.test.ts`~~ → **實際改為 `shipping-rpc-drift.test.ts`** | 🔴 **v5 更正(code-reviewer MF3-1)**:`shipping.test.ts` **未動**;選填參數的補測寫進 `refund.test.ts`(與引擎同檔便於對照),而 §3.1 要求的 #216 三方 gate 擴充落在 `shipping-rpc-drift.test.ts`(§2 表原未列此檔) |
| 3 | `packages/domain/src/order/refund.ts` | **新增**:引擎本體 + 型別 |
| 4 | `packages/domain/src/order/refund.test.ts` | **新增**:§4 窮舉矩陣 |
| 5 | `packages/domain/src/index.ts` | 加 export:refund 函式/型別 + `ShippingRule` 型別。🔴 **v6 更正**:**`DEFAULT_SHIPPING_RULE` 刻意不匯出**(codex 關卡2 must-fix、RF5 腳槍) |

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
 * 現行規則。🔴 v4(R2-F1)必須逐欄由既有兩常數建立、不得另寫字面值(否則可獨立漂走=同源假綠)。
 * 🔴 **v6 最終形(codex 關卡2 R1→R2 兩步收斂):模組私有 `const`(完全不 export)+ `Object.freeze`**。
 *   R1 只從 barrel 移除仍不夠 —— `packages/domain/package.json` 無 `exports` 封鎖,
 *   深層路徑 `@pcm/domain/src/order/shipping` 仍可 import 後寫 `?? DEFAULT_SHIPPING_RULE` fallback。
 *   ⇒ 唯一取得管道只剩 `calculateShippingFee` 的預設參數。
 */
const DEFAULT_SHIPPING_RULE: Readonly<ShippingRule> = Object.freeze({
  freeThreshold: toMoneyAmount(FREE_SHIPPING_THRESHOLD),
  homeFee: toMoneyAmount(HOME_SHIPPING_FEE),
});

export function calculateShippingFee(
  subtotal: Money,
  method: ShippingMethod,
  rule: ShippingRule = DEFAULT_SHIPPING_RULE,   // 🔴 選填、預設保既有行為
): Money;
```

🔴 **零複製門檻邏輯**:`store→0` / `subtotal >= rule.freeThreshold ? 0 : rule.homeFee` 分支仍只此一處;RF1 引擎呼叫本函式、不自行實作分支(§6 驗收條件 2)。

🔴 **v4(R2-F1)#216 drift gate 必須同片擴充**:既有 `shipping-rpc-drift.test.ts` 只斷言「TS 兩常數 == 最新 create_order migration §7 CASE」;本片加入預設規則後須擴為三方一致。
🔴 **v6 更正(codex 關卡2 R2)**:因預設規則已改**模組私有不 export**,gate 改以**行為驗證**(呼 `calculateShippingFee` 在門檻上下的輸出對照 TS 常數與 SQL 兩數),**不再直接斷言物件欄位**。
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
  | 'non_positive_refund'             // 退款額 ≤ 0
  | 'invalid_field';                  // 🔴 v7(codex 關卡2 R3、原漏列):結構性壞輸入 —— 兩陣列非
  //   陣列 / item 非物件 / orderItemId 非字串或空 / unitPrice 非物件,以及**任何逸出到最外層
  //   try/catch 的病態輸入**(null input、throwing getter、Proxy trap、巢狀 Money=null)。
  //   🔴 **RF2b/RF5 做 exhaustive handling 必須含此 kind**
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
10b. 🔴 **v5 字面更正(code-reviewer MF2)**:本節與矩陣 14 原寫「非安全整數…違反回 `amount_overflow`」**不精確**。實作分兩類、**以 `errors.ts:20` 既有慣例為準**:
   - **非安全整數 / 負數** → `invalid_amount`(對齊 `errors.ts` 既有定義「`invalid_amount`:金額非整數 / 負數」)
   - **合法整數但 > `2147483647`(DB 上限)** → `amount_overflow`
   ⇒ `Number.MAX_SAFE_INTEGER + 1` 回 **`invalid_amount`** 而非 `amount_overflow`。
   🔴 **RF2b 以 SQL 鏡像 kind 時必須依此、不可依原字面**(否則兩側分類分岔)。
   ⚠️ **揭示形狀**:此處是「測試期望值配合實作」而非改實作 —— 判斷依據=與 sibling `errors.ts` 對齊優先於本 plan 草稿字面;已於 commit body 揭示。

10. 🔴 **整數與溢位守門(v2 F5)**:`toMoneyAmount()` 實測**只驗整數+非負、無 `Number.isSafeInteger`**(`shared/types.ts:44-51`);DB 側 `create_order` 用 bigint 中間值 + `> 2147483647` RAISE(當前生效版 `20260719120000`)。→ 引擎自行對**每個輸入值(含 `shippingRule` 兩欄)與每個乘/加/減中間結果**驗 `Number.isSafeInteger` 且 `<= 2147483647`,不倚賴 `toMoneyAmount` 兜底。🔴 **違反時的 kind 依 §3.3-10b 分兩類**(非安全整數/負數→`invalid_amount`;合法整數但超上限→`amount_overflow`)——**不是一律 `amount_overflow`**(v6 修正 codex 關卡2 R2:此處原字面與 10b 自我矛盾)。
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
| 14 | v2(F5):unitPrice=2147483647、乘積溢位、currentSubtotal 超上限、`MAX_SAFE_INTEGER+1`、rule 欄超上限 | 🔴 **v5 字面更正**:合法整數但超 DB 上限 → `amount_overflow`;**非安全整數 / 負數 → `invalid_amount`**(對齊 `errors.ts:20`)⇒ `MAX_SAFE_INTEGER+1` 回 `invalid_amount`。詳 §3.3-10b |
| 15 | 守恆不變量:多組固定情境多輪部分退到清空 | Σrefund + 殘值 = 原付,恆成立 |
| 16 | 引擎對外零 throw:所有壞輸入包 try/catch 斷言未 throw | 全回 `{ok:false}` |
| 17 | 🔴 **v3 凍結規則生效(v4 修正期望值、R2-F2)**:同一情境(退 3000 品項後 `newSubtotal=2500`、原 fee 0)分別套三組規則 | `{5000,100}`→newFee **100**/refund **2900**;`{3000,60}`→2500<3000 → newFee **60**/refund **2940**;`{2000,60}`→2500≥2000 → newFee **0**/refund **3000**。⇒ 三組同時證「**門檻**與**費率**都取自輸入、非模組常數」。⚠️ v3 原寫 `{3000,60}`→0/3000 **算錯**(2500<3000 不可能免運),codex R2 抓出 |
| 18 | 🔴 **v3 規則守門**:rule 欄負數 / 非整數 / 缺欄 | `invalid_shipping_rule`、零 throw |
| 19 | 🔴 **v3 `shipping.ts` 零行為變更(v4 補強、R2-F1)**:①既有兩參呼叫 vs 三參傳 `DEFAULT_SHIPPING_RULE` 逐組**輸出全等** ②🔴 **加「固定期望值表」對照**:`home/4999→100`、`home/5000→0`、`home/5001→0`、`store/任意→0`(**寫死期望數字、不由常數推導**) | ①②皆過。🔴 **只有 ① 是同源假綠**(兩參本就 delegate 到 DEFAULT)→ 必須有 ② 才擋得住「DEFAULT 寫錯」;另由 #216 gate 擴充斷言把 `DEFAULT_SHIPPING_RULE` 綁死到常數 |
| 20 | 突變自驗 → 🔴 **實測結果見 §10e(共 19 組、全數有效)**;plan 原列的預測紅數已被實測取代(v6) | 全組轉紅才收 |

## 5. 鐵則判定

- **鐵則 12**:①錢 命中(金額權威 + 動共用運費函式簽章)→ 高風險片、codex 雙關卡 + code-reviewer 不降級。零 migration、無 DB → 不跑交易模擬。
- **鐵則 8**:動到 `packages/domain` 共用函式簽章(`calculateShippingFee`)→ 屬「動共用元件」→ **本 plan 即為等批准的 plan**;上位線級拆片 Sean 已過目、Q6=B 為其明示拍板。
- 🔴 **鐵則 4 偏離揭示**:估時 **50 分鐘 > 上限 45**。**不拆的理由**:唯一可拆點是「`shipping.ts` 選填參數」獨立成跑道片,但拆出後該片**無任何消費端**(選填參數沒人傳=半套),且它同樣命中鐵則 12 ①錢 → 需**重複跑一整輪高風險審查鏈**(codex 關卡1+關卡2),成本高於 5 分鐘超時。判定合併為單片、於本節與 commit body 揭示。**若實作中實際超過 60 分鐘 → 停下回報 Sean、不硬塞**。
- **鐵則 6**:🔴 **`refund.ts` 實際 388 行、`shipping.ts` 92 行**(v1 預估 <250;**過 300 硬警戒、仍 <400**)。組成=型別宣告+JSDoc 約 200 行、可執行邏輯約 190 行;膨脹來源=四輪審查各要求加輸入守門與「為何這樣做」註解。**不拆理由**:拆開會把同一條輸入驗證鏈切散、反而更難審;🔴 **下次動本檔前須先評估外移**。
- **鐵則 3**(前後台同步):本片純 domain、無 UI/後台變更 → 不觸發;消費端在 RF5/RF6。
- **鐵則 5**:無 CSS/TSX → 不適用。

## 6. 驗收條件(逐條 yes/no)

1. §4 功能矩陣全綠(60+ 條測試);**突變證據獨立記於 §10e(20 組、全數有效)**,每組驗紅後以檔案備份還原 + `shasum -a 256 -c` 逐字元比對。
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

## 10c. code-reviewer(opus)findings 銷案(**判 FAIL、3 must-fix + 8 nit**;v5 全數處置)

| # | finding | 核對 | 處置 |
| --- | --- | --- | --- |
| **MF1** | `badComputed` 第三個位點(`remainingSum` 累加)**可達但零覆蓋** —— 逐筆 line 各自合法(2e9)、累加 4e9 才溢位;拿掉守門仍全綠 = **與 M5 同一種假綠** | ✅ 屬實 | 加測 14b-4(`[['A',2e9,1],['B',2e9,1]]` + `subtotal:100`)+ **新突變 M8 專驗**(實測 1 紅);並改寫誠實揭示(原文讀來像「除兩處外都有覆蓋」,實際四個呼叫點中**兩處已覆蓋、兩處不可達**) |
| **MF2** | rejection kind 與 plan 字面不符(`MAX_SAFE_INTEGER+1` plan 寫 `amount_overflow`、實作回 `invalid_amount`) | ✅ 屬實;**碼對 plan 錯**(`errors.ts:20` 既有定義即「金額非整數/負數 → `invalid_amount`」) | **改 plan 字面**(§3.3-10b 新增分類表)+ commit body 揭示「測試期望值配合實作」的高危形狀與判斷依據;🔴 標明 RF2b 鏡像 kind 須依此 |
| **MF3** | 需揭示的 plan 偏離 4 項 | ✅ 屬實 | 逐項落檔:①§2 檔案表更正(見上)②`refund.ts` **339 行**(plan 估 <250、過鐵則 6 的 300 警戒、仍 <400;型別+JSDoc 約 180 行、可執行邏輯約 150 行,不拆)③突變實測紅數與 plan 預測不符 + **M5 初版 0 紅是本片最有價值的實質發現**(補 14b 三案才轉紅)④矩陣加強案(9b/13 第二案/17b/19-③④)|
| N1 | `badQuantity` 的 DB 上限分支零覆蓋 | ✅ | 加測(數量 `2147483648`,兩個陣列各一案)+ **突變 M9 專驗**(1 紅) |
| N2 | barrel 匯出 `DEFAULT_SHIPPING_RULE` 是 RF5 腳槍 | ✅ | `index.ts` export 處加 🔴 **RF5 禁令註解**(只給結帳顯示鏡像用、退款嚴禁 fallback) |
| N3 | 「對外零 throw」對 `remainingItems`/`refundItems` 為 null 不成立(會 TypeError)、與 method/rule 已做 runtime 驗不對稱 | ✅ | 新增 `Array.isArray` 守門 + 新 kind **`invalid_field`**(命名對齊 `errors.ts:36`)+ 加測 14c(4 種壞值)+ **突變 M11 專驗**(1 紅)⇒ 保證升級為「**任何**壞輸入零 throw」 |
| N4 | 刻意不驗 `currentShippingFee` 與凍結規則自洽,需寫成註解免日後誤補 | ✅ | `refund.ts` §3 加 🔴 註解(RF2a-0 用欄位 DEFAULT 回填、舊單 fee 可能不自洽,補 gate 會誤擋所有舊單退款) |
| N5 | 「非全退 + direction=`refund`」路徑零測試 | ✅ | 加測 17c(6000+1000 退 1000 → 新運費 0、回退 100、refund 1100、守恆成立) |
| N6 | 輸出沿用輸入 Money 物件參照 | ✅ | `previousShippingFee` / `refundedLines[].unitPrice` 改淺拷貝 |
| N7 | 測 15 未斷言真跑過部分退、未斷言 `guard` 未打上限 | ✅ | 加 `expect(partialRounds).toBeGreaterThan(0)` + `expect(guard).toBeLessThan(50)` |
| N8 | 平行 session 同在 dev commit,務必 pathspec 精準 add | ✅ | 🔴 **實錘**:本片 commit 前確實踩到 —— 為 review 而 staged 的 5 檔被一次無 pathspec 的 docs commit 掃進去(訊息只寫搜尋偵察、內容含 339 行金流引擎)→ 已 `reset --soft` 拆開、改用 pathspec 只 commit docs、shasum 驗 RF1 檔零改動 |

### 突變自驗最終結果(11 組全紅)

| 組 | 內容 | 紅數 |
| --- | --- | --- |
| M1 | 移除 fullRefund→0 特例(全退不回退運費) | 7 |
| M2 | 公式 `−(新−舊)` 改 `+` | 6 |
| M3 | 移除 `non_positive_refund` 閘 | 2 |
| M4 | fullRefund 判定改回 `newSubtotal===0` | 2 |
| M5 | 移除 `badComputed` 函式體 | 🔴 **初版 0**(真缺口)→ 補 14b 三案後 **3** |
| M6 | 引擎忽略輸入 rule、改用 DEFAULT(Q6=B 失效) | 1 |
| M7 | `DEFAULT_SHIPPING_RULE` 改寫死 `{4000,150}` | 13 |
| M8 | 移除 `remainingSum` 累加溢位守門(MF1) | 1 |
| M9 | 移除 `badQuantity` DB 上限分支(N1) | 1 |
| M10 | `shipping.ts` 門檻 `>=` 改 `>` | 3 |
| M11 | 移除陣列型別守門(N3) | 1 |

每組驗紅後以檔案備份還原 + `shasum -a 256 -c` 逐字元比對(🔴 `refund.ts` 為 untracked 新檔、`git checkout` 救不回,首組突變已踩到)。

## 10d. codex 關卡2 findings 銷案(**R1 判 FAIL、5 must-fix + 1 nit;v6 全數折入**)

| # | finding | 核對 | 處置 |
| --- | --- | --- | --- |
| **K2-1** | 「對外零 throw」不成立:`input` 為 null/undefined(解構即 throw)、throwing getter、Proxy trap、巢狀 `Money=null` | ✅ 屬實(逐欄防禦追不完病態輸入) | **改為機制保證**:`computeRefundQuote` 只做 `try { computeRefundQuoteUnsafe() } catch { reject('invalid_field') }`;內部再加 `input` 物件型別檢。加測 **14d**(null/undefined/42/'str'/throwing getter/Proxy trap/nested null/array iterator trap 共 8 種) |
| **K2-2** | 只驗幣別「彼此相等」、**未驗必須是 TWD** → 全部欄位都 USD 會成功產出 USD 退款 quote | ✅ 屬實(`Currency` 型別只有 TWD,但值來自 DB/HTTP 邊界) | 加 `if (currency !== 'TWD') return reject('currency_mismatch')`;加測 **14e**(全 USD 必拒) |
| **K2-3** | `orderItemId` 未做 runtime string 驗 → 同一 `Symbol()` 可產出含 Symbol 的 quote、RF2a 帳本寫入與序列化會出事 | ✅ 屬實 | 兩個陣列迴圈各加「item 為物件 + `orderItemId` 為非空字串 + `unitPrice` 為物件」守門 → `invalid_field`;加測 **14f**(Symbol / null item / 空字串 / null unitPrice) |
| **K2-4** | `DEFAULT_SHIPPING_RULE` 仍可變且從 barrel public 匯出;**註解擋不住 RF5 fallback,也擋不住 consumer runtime 改寫欄位**(drift gate 只驗模組初始值) | ✅ 屬實、且**正中機制優先律** | ①`Object.freeze` + 型別改 `Readonly<ShippingRule>` ②**從 barrel 移除匯出**(只留 domain 內部:`calculateShippingFee` 預設參數 + #216 gate)③barrel 與 `shipping.ts` 各留一段「為何不匯出」說明 |
| **K2-5** | plan 字面不同步:自稱 v4 但 §10c 已寫 v5;矩陣 14 仍稱 `MAX_SAFE_INTEGER+1` 回 `amount_overflow`;記 339 行但實際 357 | ✅ 屬實(我漏了) | 版本改 **v6**;矩陣 14 加 kind 分類更正;行數更新為**實測 388 / 92**;§2 檔案表 #5 與 §3.1 程式碼片段一併同步 |
| K2-nit | 守恆測試只跑「第一個品項每輪退 1」單一拆法 | ✅ | 加測 **15b**(同張單 A→B / B→A / 一次全退,三種拆法總額須相同)+ **15c**(部分數量 1+1+1 vs 2+1 vs 3) |

## 10e. 突變自驗最終實測(**20 組、全數有效**;取代 §4 矩陣 20 的預測紅數)

> 方法:每組改壞一處 → 跑 `refund.test.ts` + `shipping.test.ts` + `shipping-rpc-drift.test.ts` → 記紅數 → 檔案備份還原 → `shasum -a 256 -c` 逐字元比對。
> 🔴 `refund.ts` 為 untracked 新檔,`git checkout` 救不回 —— 第一組突變即踩到,改用備份還原。

| 組 | 改壞什麼 | 紅數 | 來源 |
| --- | --- | --- | --- |
| M1 | 移除 fullRefund→0 特例(全退不回退運費) | 7 | plan |
| M2 | 公式 `−(新−舊)` 改 `+` | 6 | plan |
| M3 | 移除 `non_positive_refund` 閘 | 2 | plan |
| M4 | fullRefund 判定改回 `newSubtotal===0` | 2 | plan |
| M5 | 移除 `badComputed` 函式體 | 🔴 **初版 0** → 補測後 **3** | plan |
| M6 | 引擎忽略輸入 rule、改用預設(Q6=B 失效) | 1 | plan |
| M7 | 預設規則改寫死 `{4000,150}` | 13 | plan |
| M8 | 移除 `remainingSum` 累加溢位守門 | 1 | code-reviewer MF1 |
| M9 | 移除 `badQuantity` DB 上限分支 | 1 | code-reviewer N1 |
| M10 | `shipping.ts` 門檻 `>=` 改 `>` | 3 | code-reviewer 建議 |
| M11 | 移除陣列型別守門 | 1 | code-reviewer N3 |
| M12 | 移除 `try/catch` 機制底線 | 1 | codex K2-1 |
| M13 | 移除 TWD 白名單 | 1 | codex K2-2 |
| M14 | 移除 **remainingItems 端** `orderItemId` 守門 | 🔴 **初版 0**(被 refund 端遮蔽)→ 補隔離測試後 **1** | codex K2-3 |
| M15 | 解凍預設規則 | 🔴 **初版 0**(無人斷言凍結)→ 已由 M19 取代(改私有後不可解凍) | codex K2-4 |
| M16 | 移除 **refundItems 端** `orderItemId` 守門 | 1 | codex R2 |
| M17 | 移除 `currentDiscountTotal` 的 currency 比對 | 1 | codex R2 |
| M18 | 略過 `currentDiscountTotal` 的 amount 驗證 | 1 | codex R2 |
| M19 | 預設參數改寫死錯值(取代 M15) | 9 | codex R2 |
| M20 | 移除 `remainingItems[].unitPrice` 金額守門 | 🔴 **初版 0**(壞單價被下游守門攔下且回同 kind)→ 重新設計 14h 後 **2** | codex R3 |

🔴 **四次「初版 0 紅」是本片最有價值的實質發現**——每次都是「防線存在但沒有任何測試會因為它消失而失敗」的假綠,且兩次(M5/M14)是同一種形狀(**遮蔽**:另一道守門先擋住,使被測守門無法被隔離驗證)。

## 10g. codex 關卡2 R3 findings 銷案(**Sean 授權破例第三輪;判 FAIL、4 must-fix、全折入**)

| # | finding | 核對 | 處置 |
| --- | --- | --- | --- |
| **R3-1** | `remainingItems[].unitPrice` 的 `badAmount` 守門**無隔離測試**;移除後測試仍全綠 | ✅ 屬實 —— **同型缺口第四次** | 補測 **14h**。🔴 **第一版設計失敗**(突變 M20 仍綠):負單價被下游 `newSubtotal < 0` 守門攔下**且回同一個 kind** → 分不出哪道在work。**重新設計**為「壞單價落在**未被退**的品項、且 subtotal 對得起來」⇒ 移除守門後結果明顯不同(①負單價→**會成功回 quote** ②非整數單價但和為整數→變 `amount_overflow`)。突變 **M20 實測 2 紅** |
| **R3-2** | plan 的 `RefundQuoteRejection` union **漏列 `invalid_field`**(實作已公開) → RF2b/RF5 若照 plan 做 exhaustive handling,病態輸入會成未定義契約 | ✅ 屬實 | §3.2 union 補 `invalid_field` + 語意說明 + 🔴 標明 RF2b/RF5 必須含此 kind |
| **R3-3** | 沿革只記到「四輪 / 20 must-fix」、`refund.ts` 檔頭仍寫「plan v4 / 12 findings」 | ✅ 屬實 | 標題→**v7**、沿革補 R2/R3 並重算為**五輪 / 30 must-fix + 9 nit**;`refund.ts:23` 檔頭同步 |
| **R3-4** | 驗收條件仍稱「突變 6 組」,§10e 已列 19 組 | ✅ 屬實 | 驗收條件 1 改為「功能矩陣全綠 + 突變證據見 §10e(20 組)」,把功能矩陣與突變證據分開表述 |

🔴 **誠實邊界**:R3 的 4 條**已折入但未再複審**(Sean 授權的破例僅一輪)。其中 R3-1 已用突變 M20 機械驗證修法有效;R3-2~R3-4 為文件字面,可由讀者直接對照。

### 🔴 五輪審查的形狀(值得記入制度)

- **20 must-fix 中,質疑「核心公式 / 金額正確性 / Q6=B 架構」的:0 條。** 公式面自 R1 起未被動搖。
- **反覆出現的兩種形狀**:
  1. **「守門存在但沒有測試會因它消失而失敗」= 4 次**(M5 / M14 / M15 / M20)。其中 3 次的根因是**遮蔽**——另一道守門先擋、或**回同一個 kind**,使被測守門無法被隔離驗證。⇒ 教訓:**隔離測試必須讓「移除該守門」產生可觀察的不同結果**(不同 kind 或成功/失敗翻轉),否則測試只是陪襯。
  2. **文件字面與實作漂移 = 每輪都有**。根因是我每輪都在改 plan,改一處生一處新漂移。⇒ 教訓:**高風險片的 plan 應在實作後做一次「全檔字面對帳」**,而非逐輪局部補。
- **註解不是機制**:codex 兩次針對同一件事升級要求(RF5 誤用預設運費規則)——先要求「不從 barrel 出」,再指出深層 import 可繞、要求「模組私有」。⇒ 防護要問「它實際擋得住什麼」。

## 11. 開工前 gate

- ~~Q6 運費規則版本~~ → ✅ **Sean 2026-07-25 拍 B(下單凍結)**,已折入 v3/v4。
- ~~Q5 D4 覆核口徑~~ → ✅ **Sean 拍 A + 失敗回滾/告警**(PRD §0c),屬 RF8、不擋本片。
- 🔴 **plan 層 codex 審查 2 輪已用盡**(R1 FAIL 8 條 → v2/v3 折入;R2 FAIL 4 條 → v4 折入)。依 `~/.claude/rules/00-work-rules.md` §5「plan 層審查上限 2 輪、round2 仍 FAIL 停下 raise Sean」+ codex-adversary skill 同條 → **不跑 R3**。
- ✅ **Sean 2026-07-25 拍 A = 直接開工實作**(知情:plan 層 2 輪已用盡、12 findings 全折入、diff 層仍有 code-reviewer + codex 關卡2 兩道)。→ **本 plan gate 全解、進實作**。
- (原題留存)~~RF1 是否直接開工實作~~(v4 已折入全部 12 條 findings、diff 層仍有 code-reviewer + codex 關卡2 兩道把關),或要再跑一輪 plan 審。**誠實說明**:R2 的 4 條都是機械性錯誤(算錯期望值/契約矛盾/文件未同步/測試同源),**非方向問題**;兩輪 findings 沒有一條質疑核心公式或 Q6=B 架構。
