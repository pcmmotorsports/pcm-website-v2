# M-3 會員訂單列表(OrdersTab 接真訂單)— 執行 plan

> 寫審分離 ROLE=A(執行 session)。本檔 = 動手前 plan。
> **狀態:Sean 2026-06-20 拍板 Q1-Q7(全 A,Q4=B);codex 關卡1 round1 = FAIL(安全紅線獨立 grep 全 PASS、FAIL 純決策未定稿 + 2 補強)→ 本版已定稿納入 M1-M3 + C1/C2 + NIT,待 codex round2(硬上限第 2 輪)PASS 才動實作。**
> 分支 `m3-orders-list`(worktree `/Users/sean_1/pcm-orders`)、基底 `826e336`。
> 日期 2026-06-20。

---

## 0. 一句話

把會員中心「訂單記錄」分頁從**空狀態**接上**會員自己的真實訂單清單**;後端訂單讀路徑其實**早就搭好骨架**(port/adapter/composition 都在),本 slice 主要是**填掉一個被 #217 卡住的 stub**,但用「列表只要摘要、不要明細」的角度**繞過 #217**(列表不需要 `items[]`,自然不踩「order_items 沒有 product_id」這個雷)。

範圍**只到訂單列表**;訂單詳情頁不做(另開 slice = backlog #240)。

---

## 1. 現況關鍵發現(偵察結論,鐵則 1 grep 字面、非憑記憶)

### 1a. design 字面(真權威,CSS 已 100% 鏡像、不需新增 CSS)
- 訂單分頁 JSX:`design-reference/components/AccountPages.jsx` **L538-557**。結構:
  `.acc-section` > `.acc-section-head h2「訂單記錄」` > `.acc-orders` > `orders.map` → `.acc-order.acc-order-full`
  - 左欄 `.acc-order-l`:`<div className="ap-mono acc-order-id">{o.id}</div>` + `<div className="acc-order-meta">{o.date} · {o.items} 件商品</div>`
  - 右欄 `.acc-order-r`:`<div className="acc-order-total">NT$ {o.total.toLocaleString()}</div>` + `<div className="acc-order-status">{o.status}</div>` + `<button className="acc-order-detail">查看詳情 →</button>`
- 總覽「最近訂單」preview:同檔 **L498-517**(`.acc-order` 無 `-full`、**無**查看詳情鈕、meta 用「件」非「件商品」、`orders.slice(0,2)`)。
- mock 資料(**禁搬字面**):L326-330 `{ id:'PCM-2026-0042', date:'2026-04-15', items:2, total:18600, status:'已出貨' }` 等。
- design 的 `.acc-order-status` 是**單一中性灰膠囊、無 per-status 顏色變體**;design 只出現「已出貨」「已完成」兩種狀態字面。
- design 訂單分頁**沒有空狀態**;查看詳情鈕**沒有 onClick**(mock 死鈕)。
- CSS:`.acc-order*`(L195-244)+ `.acc-empty`/`.acc-empty-sub`(L280-291)**已存在於** `apps/storefront/src/styles/account.css`。**本 slice 不需新增/改 CSS**(若要左欄 wrapper `.acc-order-l` 才需補,但 design 也沒給 `.acc-order-l` 規則 → 不補)。

### 1b. 前台現況
- `OrdersTab.tsx`(23 行):**零 props、零 import**,純空狀態殼(`.acc-section[data-tab="orders"]` + h2「訂單記錄」+ `.acc-empty「目前尚無訂單紀錄」` + sub「您的購買紀錄會顯示在此」)。
- `OrdersTab.test.tsx`:含**反洩 guard**(`not.toMatch(/PCM-2026-/)`、`not.toContain('已出貨')`、`not.toContain('已完成')`)。真資料用 `PCM-YYYY-NNNN` id + 「已出貨」狀態字面**會打爆此 guard → 測試必重寫(非擴充)**。
- `AccountView.tsx`:薄 router,`{tab === 'orders' && <OrdersTab />}`(L137,無 prop);需加 `orders` prop 並 forward。
- `OverviewTab.tsx`:🔴 **重要耦合**。L74-76 註解寫明「M-3 接真訂單後本段(最近訂單)改成 `orders.slice(0,2)` 列表;g-2 階段 page.tsx 固定 `orderCount=0`,此處不留 `orderCount > 0` 死碼分支(codex k2 round1 consider:防 stat 數字 vs 列表空白 inconsistency)」。
  → **一旦 `orderCount` 變真數字,OverviewTab「Total orders」卡會顯示真數量,但「最近訂單」preview 仍空 → 重現 codex 當初點名的不一致。**(Q5=A 固定處理、見 §11)

### 1c. 後端讀路徑「不是 greenfield」
- **port** `packages/ports/src/IOrderRepository.ts`:`listByCustomer(customerId): Promise<Order[]>` **已宣告**(連 findById/listByStatus/findTotal/placeOrder)。
- **adapter** `packages/adapters/src/supabase/SupabaseOrderAdapter.ts`:`listByCustomer` **已存在但是 deferred stub**(`Promise.reject(...backlog #217)`)。ctor 注入 `SupabaseClient<Database>`(與 vehicle/address 同 pattern)。
- **composition** `apps/storefront/src/lib/auth/composition.ts`:`getOrderRepo()` **已 wire**(回 `new SupabaseOrderAdapter(await createServerSupabaseClient())`,authenticated/RLS client,**非 service_role**)。
- **mapper** `packages/adapters/src/supabase/mappers/order.ts`:目前**只有寫路徑** args mapper;需加讀路徑 mapper。
- **use-case**:vehicle/address 的「列表讀」**沒有獨立 use-case**,server component 直接呼 `repo.listByCustomer`。→ 訂單列表讀**同樣不需 use-case**(無讀側商業邏輯)。

### 1d. #217 是什麼、為何本 slice 能繞過
- domain `OrderItem.productId` 是 **required**(`ProductId`),但 `order_items` 表**沒有 `product_id` 欄**(只有 `variant_id`)→ 無法忠實重建 domain `Order.items[]` → 這是 stub 被延後的原因。
- **但列表視圖根本不需要 `items[]`**:列表只要 `display_id / created_at / 件數 / total / 狀態`。→ 用**輕量讀模型(read DTO)`OrderListItem`** 投影,**完全不碰 `OrderItem.productId`、不碰 #217**。明細頁(未來 slice)才需要解 #217。

### 1e. orders 資料層(權威 schema,**不需新 migration**)
- `orders`:`id`(uuid)、`display_id`(text,`PCM-YYYY-NNNN`,**訂單號**)、`customer_user_id`(uuid,**歸屬 FK** → `customers.user_id`)、`payment_status`(enum `unpaid|paid|partiallyPaid|refunded`)、`fulfillment_status`(enum `notOrdered|ordered|inStock|shipped`)、`subtotal/shipping_fee/discount_total/total`(**整數 TWD**)、`created_at`(timestamptz,**日期來源**)…
- `order_items`:`order_id`、`variant_id`、`variant_sku`、`product_snapshot`(白名單 title/sku/spec)、`quantity`、`unit_price`、`line_total`、`availability_at_checkout`。
  - NIT 更正(codex):`availability_at_checkout` 由 **`20260614130000_m3_create_order_stock_snapshot.sql`** 新增(非基表 `20260604120000`);本 slice **不取該欄**(只取 `quantity`)、不影響安全。base 表 `order_items` 欄不含它。
- **RLS 已就緒**:`orders_select_own` `USING (customer_user_id = (select auth.uid()))`;`order_items_select_own` 走 EXISTS 比對。`GRANT SELECT ... TO authenticated`;`anon` 零權限。index `orders_customer_idx ON orders(customer_user_id)` 已存在。
- **無取消/軟刪欄**(無 `delisted_at`/`cancelled`/`is_deleted`);`payment_status='refunded'` 是最接近訊號但非刪除旗標。
- domain `Order` **無 `createdAt` 欄** → 用 `OrderListItem` 投影補(攜 ISO `createdAt`)。

---

## 2. 內容分級(鐵則 9)
- 訂單清單資料 = **L3**(週多次、會員自有、必後台讀 CRUD)→ 已走 RLS own-only repo 讀路徑,**符合**。
- 訂單狀態 → 中文文案對照 = **L1/L2 文案**(狀態 enum 固定、文案幾乎不動)→ **hardcode + TODO + backlog 可**(指令明示)。
- 空狀態/「件商品」字面 = **L1**(沿用既有 override + design 字面)。

## 3. 鐵則判定 + 固定驗收條件(codex M2)
- **鐵則 8(重大改動 → plan-first)**:✅ 命中(跨 domain/ports/adapters/app 多檔 + 動共用 port 契約)→ 本檔即 plan,Sean 已批(Q7=A)、codex 關卡1。
- **鐵則 12(order / IDOR → codex review)**:✅ 命中 → 審查 session 跑 codex 關卡2 審 diff。
- **不動 schema/RLS/migration**:✅ 讀路徑重用既有表 + RLS + GRANT + index;**無新 migration**;`authenticated` 既有 `SELECT` 權限即足。
- **不動 deployment/env**:✅。
- **🔒 固定驗收(M2,不可回退)**:
  - **Q5=A 固定**:`orderCount` 顯真數字 **且** 總覽「最近訂單」同步接真(`orders.slice(0,2)`、與 `orderCount` 同源)→ **不得**出現「stat 數字 vs 列表空白」不一致(B 選項已移除)。
  - **Q7=A 固定**:Sean 明確批准本 **oversized slice**(18 檔、見 §6),一次前後台同步、不拆(守鐵則 3);oversized 已批註明、非未授權擴張。

---

## 4. 架構設計(讀模型投影法,繞過 #217)

### 4a. domain — 新增輕量投影型別
`packages/domain/src/order/types.ts` 新增(domain 零 import、合規):
```ts
/** Member order summary(訂單摘要投影,泛用:account OrdersTab / Overview 最近訂單 / 未來月結等)。
 *  刻意不含 items[](避 #217:order_items 無 product_id 無法重建 OrderItem.productId);
 *  明細頁(未來 slice)才需完整 Order + 解 #217。 */
export type OrderListItem = {
  id: OrderId;
  displayId: DisplayId;          // PCM-YYYY-NNNN
  createdAt: string;             // ISO timestamptz 原樣(UI 端格式化、domain 不綁格式)
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  total: Money;                  // 整數 Money(TWD)
  itemCount: number;             // Q4=B:Σquantity(總數量、非 distinct 列數);adapter 端彙總
};
```
> `packages/domain/src/index.ts` **不需手改**:L17 `export type * from './order/types'` 是 wildcard type re-export,新增 `OrderListItem`(type-only)自動可由 `@pcm/domain` reach(critic 驗:runtime values 才需顯式 export,本型別純 type)。

### 4b. port — 新增聚焦讀方法(不動既有簽章)
`packages/ports/src/IOrderRepository.ts` 新增:
```ts
/** 列出某會員訂單「摘要」(account 列表用;RLS own-only)。
 *  與既有 listByCustomer(回完整 Order、仍因 #217 deferred)分離:列表只需摘要、不需 items[]。 */
listSummariesByCustomer(customerId: CustomerId): Promise<OrderListItem[]>;
```
> 既有 `listByCustomer(): Promise<Order[]>` stub **維持 deferred**(完整 Order 重建仍待 #217),不在本 slice 啟用(Q6=A、見 §11 + §9 禁止項)。

### 4c. adapter — 實作 + 讀 mapper
- `SupabaseOrderAdapter.ts` 實作 `listSummariesByCustomer`(取代用、非動既有 stub;既有 `listByCustomer/findById/listByStatus` 是 zero-arg deferred rejecter、本 slice 不碰):
  ```ts
  // 模組頂(鏡像 SupabaseAddressAdapter 的 ADDRESS_SELECT):select 字面集中一處、未來加欄可審。
  // 🔴 只摘要欄 + 內嵌 order_items(quantity);禁 unit_price/line_total/product_snapshot/經銷價/PII。
  const ORDER_LIST_SELECT =
    'id, display_id, created_at, payment_status, fulfillment_status, total, order_items(quantity)';

  async listSummariesByCustomer(customerId: CustomerId): Promise<OrderListItem[]> {
    const { data, error } = await this.supabase
      .from('orders')
      .select(ORDER_LIST_SELECT)
      .eq('customer_user_id', customerId)              // 縱深防護(RLS 已強制、此為應用層歸屬冗餘)
      .order('created_at', { ascending: false });      // 新到舊(決策題 Q3)
    if (error) throw error;
    return data.map(mapSupabaseOrderRowToListItem);    // typed query 回非 null array、不加 ?? [] 與生成型別打架
  }
  ```
  - **只 select 摘要欄 + 內嵌 `order_items(quantity)`**(只拉 quantity 算件數;**不拉 unit_price/line_total/product_snapshot**)→ 零經銷價/cost 洩漏。
  - `total` 走 `toMoneyAmount(row.total)` + `currency:'TWD'`(`toMoneyAmount` 是 domain helper、由 adapters `import { toMoneyAmount } from '@pcm/domain'`、boundaries 合規;整數 Money、禁 float、禁 `as MoneyAmount`)。
  - 內嵌 `order_items` 為 **to-many 非 null array**(FK `order_items_order_id_fkey`、isOneToOne:false);**`itemCount = row.order_items.reduce((s, it) => s + it.quantity, 0)`(Q4=B Σquantity、整數加總、非 distinct 列數)**。**不加 `?? []`/null-cast**(與生成型別衝突、PCM 既知摩擦)、但 mapper test 補 0-item(空 array → itemCount=0)防禦 case。
- `mappers/order.ts` 新增 `mapSupabaseOrderRowToListItem(row)`:row → `OrderListItem`;**`itemCount = Σquantity`(Q4=B)**。

### 4d. composition / use-case
- composition:`getOrderRepo()` **已 wire,零改動**(adapter 多實作一方法即可)。
- use-case:**不新增**(讀路徑直呼 repo,鏡像 vehicle/address)。

### 4e. app 串接
- `app/account/page.tsx`:
  - import 補 `getOrderRepo`、type 補 `OrderListItem`。
  - vehicles 區塊後加:
    ```ts
    let orders: OrderListItem[] = [];
    try {
      orders = await (await getOrderRepo()).listSummariesByCustomer(user.id);
    } catch (orderError) {
      console.error('[account/page] orders 讀取失敗、退化空陣列:', orderError);
    }
    ```
  - `stats={{ tier, walletBalance, orderCount: orders.length }}`(取代 `orderCount: 0`)。
  - `<AccountView ... orders={orders} />`。
- `AccountView.tsx`:`AccountViewProps` 加 `orders: OrderListItem[]`(required)、解構、forward 給 `<OrdersTab orders={orders} />` **且**(Q5=A 固定)`<OverviewTab orders={orders} ... />`。
- `OrdersTab.tsx`:接 `{ orders }: OrdersTabProps`,`orders.length===0` → 保留現有 `.acc-empty` override;否則 `orders.map` 按 design L538-557 字面渲染(`.acc-order.acc-order-full` + 左右欄)。狀態走 `orderStatusLabel(paymentStatus, fulfillmentStatus)`、日期走 `formatOrderDate(createdAt)`、金額 `NT$ {total.amount.toLocaleString()}`、件數 `{itemCount} 件商品`。**Q1=A**:查看詳情鈕照 design 渲染 `<button className="acc-order-detail">查看詳情 →</button>`、**無 onClick**(明細頁 backlog #240)。
- `OverviewTab.tsx`(**Q5=A 固定、非條件**):「最近訂單」段改 `orders.slice(0,2)` 列表(`.acc-order` 無 `-full`、無詳情鈕,對齊 design L498-517);無單則保留現有空狀態;「Total orders」卡用 `stats.orderCount`(= `orders.length`,與列表同源,天然一致)。新增 `orders` prop forward。

### 4f. 顯示 util(L1/L2 文案,hardcode + TODO)
`apps/storefront/src/lib/orders/order-display.ts`:
- `formatOrderDate(iso: string): string` → `YYYY-MM-DD`(用 `toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })`,避 timestamptz 時區跨日 off-by-one)。
- `orderStatusLabel(payment, fulfillment): string` — **完整雙軸映射表(Q2=A、逐字,codex M1 must-fix)**:

  | payment_status | fulfillment_status | 顯示中文 |
  |---|---|---|
  | `refunded` | (任意) | 已退款 |
  | `unpaid` | (任意) | 待付款 |
  | `partiallyPaid` | (任意) | 付款確認中 |
  | `paid` | `notOrdered` | 處理中 |
  | `paid` | `ordered` | 調貨中 |
  | `paid` | `inStock` | 備貨完成‧待出貨 |
  | `paid` | `shipped` | 已出貨 |

  **exhaustive 寫法(codex M1:所有 payment×fulfillment 組合全覆蓋、`partiallyPaid` 絕不 fall-through 成空字串、編譯期 `never` 守門)**:
  ```ts
  const PAID_FULFILLMENT_LABEL: Record<FulfillmentStatus, string> = {
    notOrdered: '處理中',
    ordered: '調貨中',
    inStock: '備貨完成‧待出貨',
    shipped: '已出貨',
  };
  export function orderStatusLabel(payment: PaymentStatus, fulfillment: FulfillmentStatus): string {
    switch (payment) {
      case 'refunded':      return '已退款';
      case 'unpaid':        return '待付款';
      case 'partiallyPaid': return '付款確認中';
      case 'paid':          return PAID_FULFILLMENT_LABEL[fulfillment]; // Record 覆蓋全 4 fulfillment
      default: {
        const _exhaustive: never = payment;  // PaymentStatus 新增值未處理 → 編譯期紅
        return _exhaustive;
      }
    }
  }
  ```
  - 終態用「已出貨」;design mock 的「已完成」**無後台對應狀態**(fulfillment enum 終態僅到 `shipped`)→ **不產「已完成」**(Q2=A)。
  - `// TODO(L2→L3 升級):狀態文案未來移後台 CMS;現 hardcode 為 Sean 2026-06-20 拍板定稿。`(文案已定稿、非待決)

---

## 5. IDOR / 安全設計(鐵則 12,餵 codex 關卡1/2)
1. **RLS own-only**(資料層):`orders_select_own USING (customer_user_id = auth.uid())` + `order_items_select_own`(EXISTS 比對)。登入者只能 SELECT 自己的單。
2. **應用層歸屬縱深**:adapter 顯式 `.eq('customer_user_id', customerId)`,`customerId = user.id`(來自 `supabase.auth.getUser()` 驗 JWT、非 getSession)。RLS + `.eq` 雙層,任一失效另一層仍擋。
3. **authenticated/RLS client、非 service_role**:client 來自 `createServerSupabaseClient()`(anon key + cookie + RLS);storefront eslint 禁 import `@pcm/adapters/server`;`SupabaseOrderAdapter` 在 root barrel(零 service_role)。
4. **經銷價/cost 零洩漏**:投影只含 `total`(會員自己的訂單總額、非經銷價)+ 內嵌 `order_items(quantity)`;**不拉** unit_price/line_total/product_snapshot/tier 定價欄;domain `OrderListItem` 型別本身無任何 price_by_tier/price_store/cost 欄位。
5. **未登入**:page.tsx 既有 `getUser()` → 無 user `redirect('/login?next=/account')`,orders 區塊在其後執行,user 必非空。
6. **退化不 500**:adapter error → try/catch 退空陣列 + console.error(**server-side RSC 程序內、不序列化到 client**;error.message 不進 JSX、[] 退化只渲染既有 `.acc-empty`、不洩他人單存在與否)。
7. **唯一 port 實作 = `SupabaseOrderAdapter`**(本 slice 編輯)。`place-order.test.ts` 的 test double 用 `as unknown as IOrderRepository` cast → 新增 port 方法**非 breaking**、無其他 fake 要補(critic 驗:`grep implements IOrderRepository` 僅 1 命中)。
8. **select 字面回歸守門(codex C1 + round2 N2 落地法)**:`ORDER_LIST_SELECT` 為 **module-level `export const`**(`SupabaseOrderAdapter.ts` export、test import)。`SupabaseOrderAdapter.test.ts` **兩個斷言**:① `expect(ORDER_LIST_SELECT).toBe('id, display_id, created_at, payment_status, fulfillment_status, total, order_items(quantity)')`(byte-equal exact whitelist);② spy `client.from().select` 驗證 `.select` **確實以 `ORDER_LIST_SELECT` 被呼叫**(非另傳 inline 字串)。任何未來誤加欄(`invoice`/`shipping_address_snapshot`/`tappay_rec_trade_id`/`tier_at_checkout`/`unit_price`/`line_total`/`product_snapshot`/經銷價)立即測紅。
9. **orders 表另有 PII 本投影刻意不取**:`shipping_address_snapshot`(name/phone/line)、`invoice`(taxId/title)、`tappay_rec_trade_id`(金流 token)、`tier_at_checkout` → 維持投影只取 §4a 七欄,named const + 守門 test 連帶保護這些。

eslint boundaries(餵 codex 關卡1,鏡像 memory `feedback_codex-k1-feed-boundaries-config`):
```
domain → 不可 import 任何層;ports → 只 domain;use-cases → domain+ports;
adapters → domain+ports(外部 @supabase SDK 不在 boundaries、不擋);apps → 全可。
```
→ 本 slice import 形狀:domain 新增型別(零 import)、adapters 用 domain+ports(合規)、app 用 domain/ports/adapters(合規)。**零新增跨層 import 形狀。**

---

## 6. 檔案清單(18 檔、精準 add、禁 git add .)
| # | 檔 | 動作 | 層 |
|---|---|---|---|
| 1 | `packages/domain/src/order/types.ts` | +`OrderListItem` | domain |
| 2 | `packages/ports/src/IOrderRepository.ts` | +`listSummariesByCustomer` | ports |
| 3 | `packages/adapters/src/supabase/SupabaseOrderAdapter.ts` | +`ORDER_LIST_SELECT` const +實作 | adapters |
| 4 | `packages/adapters/src/supabase/mappers/order.ts` | +讀 mapper `mapSupabaseOrderRowToListItem` | adapters |
| 5 | `packages/adapters/src/supabase/mappers/order.test.ts` | +讀 mapper 測(含 0-item 空 array) | adapters |
| 6 | `packages/adapters/src/supabase/SupabaseOrderAdapter.test.ts` | +摘要讀測 + select 守門測 | adapters |
| 7 | `apps/storefront/src/app/account/page.tsx` | import 補 `getOrderRepo`(同 composition import 行)+ fetch orders + `orderCount: orders.length` + `orders={orders}` | app |
| 8 | `apps/storefront/src/components/account/AccountView.tsx` | +`orders` prop(required)+解構+forward | app |
| 9 | `apps/storefront/src/components/account/AccountView.test.tsx` | 🔴 **必補**:`renderView` 預設 props 加 `orders: []`(否則 required prop 缺 → typecheck 紅、爆三綠) | app |
| 10 | `apps/storefront/src/components/account/tabs/OrdersTab.tsx` | 接真清單 | app |
| 11 | `apps/storefront/src/components/account/tabs/OrdersTab.test.tsx` | **重寫**(props 渲染 + 空狀態 + `orders={[]}` 不含 mock 字面 guard) | app |
| 12 | `apps/storefront/src/lib/orders/order-display.ts` | +狀態/日期 util | app |
| 13 | `apps/storefront/src/lib/orders/order-display.test.ts` | +util 測 | app |
| 14 | `apps/storefront/src/components/account/tabs/OverviewTab.tsx` | **Q5=A 固定**:最近訂單段改 `orders.slice(0,2)` + 新 `orders` prop | app |
| 15 | `apps/storefront/src/components/account/tabs/OverviewTab.test.tsx` | **Q5=A 固定**:`renderTab` 預設 props 加 `orders`、重寫 L72「orderCount=0 顯 acc-empty」測為「orders=[] 空 / orders 有單列 ≤2」 | app |
| 16 | `docs/design-storefront-manifest.yaml` | 🔴 manifest:`--update-sync AccountPages --commit-hash <hash>` 刷 last_modified + **改寫 `ordersEmptyState` business_override**(原稱 orders tab/overview 均走 .acc-empty「絕不搬」、M-3 後已非事實 → 改述真清單;字面 vs 事實) | tooling/docs |
| 17 | `STATUS.md` | 7 欄(同 commit) | docs |
| 18 | `docs/phase-1-backlog.md` | 🆕 **Q1=A 連帶**:加 `#240` 訂單詳情頁 backlog entry(明細頁 = 查看詳情鈕未來行為) | docs |

> **檔數(Q7=A、誠實計數)**:Sean Q7 原述「17 檔」=本檔上一版表;**Q1=A 連帶 backlog #240 entry → 實為 18 檔**。第 18 檔(`docs/phase-1-backlog.md`)為純 docs 加法、非 scope code、不增安全/部署風險;oversized 整體已 Sean Q7=A 批。
> `packages/domain/src/index.ts` **不計入**:wildcard type re-export 自動涵蓋 `OrderListItem`(critic 驗、不手改)。

---

## 7. 測試計畫(動共用面 → 跑完整 `pnpm test`,memory `feedback_run-full-vitest-after-shared-component-change`)
- `OrdersTab.test.tsx`(重寫):① 多單 props → 渲染 `display_id`/狀態/件數/金額/日期 + `.acc-order-full` + 詳情鈕(依 Q1);② `orders={[]}` → 空狀態 `.acc-empty`;③ 反洩 guard 改為「`orders={[]}` 時不含 design mock 字面(`PCM-2026-0042`/`18,600`)」=證元件無 hardcode mock(真資料合法含 `PCM-YYYY-` 與「已出貨」、不再 blanket 禁)。
- `order-display.test.ts`(codex M1 + round2 N1):`orderStatusLabel` 用 **16 組 exhaustive table(4 payment × 4 fulfillment 全列)** 逐一斷言中文(`it.each` 16 列、**不寫「或等價」弱化**);**明確鎖 `partiallyPaid`→「付款確認中」、`refunded`→「已退款」、`paid+shipped`→「已出貨」**;`formatOrderDate` ISO→`YYYY-MM-DD`(含跨日時區 case、UTC 邊界 → Asia/Taipei 不退一日)。
- `mappers/order.test.ts`:row(含內嵌 `order_items` quantity 陣列)→ `OrderListItem`(Money 包裝、`itemCount=Σquantity`、日期/狀態原樣);**+ codex C2 case:單一品項 `quantity=3` → `itemCount=3`**(證 Σqty 非列數);**+ 多品項 `[{q:2},{q:1}]` → 3**;**+ 0-item(空 array)→ 0**。
- `SupabaseOrderAdapter.test.ts`:mock client → `.eq('customer_user_id', ...)` + `.order('created_at',desc)` 被呼叫、error → throw、空 → `[]`;**+ codex C1/N2 select 守門兩斷言:① `expect(ORDER_LIST_SELECT).toBe('<精確字串>')` byte-equal;② spy 驗 `.select` 以 `ORDER_LIST_SELECT` 被呼叫**。
- `AccountView.test.tsx`(🔴 必補):`renderView` 預設 props 加 `orders: []`,維持既有測綠(required prop 缺則 typecheck 紅)。
- `OverviewTab.test.tsx`(Q5=A):`renderTab` 預設 props 加 `orders`;最近訂單 preview ≤2 筆 + Total orders 與列表同源一致;`orders=[]` 顯 acc-empty。

## 8. 實作前置 + 三綠 + 工具
**前置(實作前必跑、blocker)**
- 🔴 `git submodule update --init design-reference`:worktree `design-reference` 是未 populate 的 gitlink(`ls design-reference/components` → No such file)。鐵則 1 要求**寫 JSX 前 grep 真 design 字面**(`.acc-order` vs `.acc-order-full`、meta「件」vs「件商品」、詳情鈕有無);本檔 §1a 的字面是我從 main tree 讀來轉述,實作者(下一回)須在 worktree populate 後**自行再 grep 一次** AccountPages.jsx L538-557 / L498-517 對齊。
- `pnpm install --frozen-lockfile`(memory `reference_od-worktree-typecheck-gotcha`:worktree node_modules 可能過時、root .bin 缺 tsc symlink 屬正常)。

**三綠(commit 前)**
- `/slice-checkpoint`:typecheck + lint + build(動 .tsx)。任一紅停下修紅、不 disable/skip。
- 動共用面(domain/port/adapter/AccountView)→ **跑完整 `pnpm test`**(非單檔子集)。

**manifest(design-mirror.mjs 用法更正、critic major)**
- `node scripts/design-mirror.mjs --target apps/storefront/src/components/account/tabs/OrdersTab.tsx` = **唯讀 inspect**(讀 override、不寫 manifest、不需 submodule)。
- 刷 manifest:`node scripts/design-mirror.mjs --update-sync AccountPages --commit-hash <可達 hash>`(Account 整組元件 manifest entry 名 = `AccountPages`)+ 手改 `docs/design-storefront-manifest.yaml` 的 `ordersEmptyState` business_override(述真清單、去掉「均走 .acc-empty / 絕不搬」的過時字面)。
- checkpoint 跑 `node scripts/design-mirror.mjs --validate`。

**審查**
- `code-reviewer` subagent(commit 前必跑、鐵則 + 字面 vs 事實 + manifest)。

## 9. 不做 / 禁止(scope 邊界)
- ❌ 訂單詳情頁 / 查看詳情鈕**行為**(onClick/導頁)— 明細頁另開 slice = **backlog #240**(本 slice 只渲染無行為的鈕、並寫入 #240 entry)。
- ❌ 動 schema/RLS/migration(讀路徑零 migration)。
- ❌ 搬 design mock 假單(`PCM-2026-0042`/`NT$ 18,600`/`已出貨` 等字面)。
- ❌ service_role 繞 RLS;❌ 投影含經銷價/cost/tier 定價欄。
- ❌ **啟用 `listByCustomer` / `findById`(完整 `Order` 重建)**(Q6=A 明確禁止項:維持 deferred、待 #217 + 明細頁 slice)。
- ❌ 分頁/排序參數化 port(port 留 `TODO M-4a-08`;本 slice 固定 created_at desc、不分頁)。
- ❌ per-status 顏色徽章(design 無 → 不發明,除非 Sean 另要)。

## 10. Rollback
- 全 slice 在 `m3-orders-list` 分支、未 merge dev。revert = 刪分支或 `git revert` 該 commit。
- 無 migration/schema/部署改動 → 零資料面 rollback 成本。
- domain/port 為**新增**(非改既有簽章,Q6=A 時)→ 移除新增即還原,不影響既有呼叫點。

---

## 11. 決策定稿(Sean 2026-06-20 拍板,codex M3:完整內嵌、不再「見對話」)

| Q | 主題 | 選項 | **拍板** | 禁止值 / 備註 |
|---|---|---|---|---|
| Q1 | 查看詳情鈕 | A 渲染無行為 / B disabled / C 不渲染 | **A** | 禁接 onClick/導頁;明細頁 = backlog **#240** |
| Q2 | 狀態映射 | A 草案 7-列表 / B shipped→「已完成」/ C 自訂 | **A** | 用 §4f 逐字表;終態「已出貨」、**不產「已完成」** |
| Q3 | 排序 | A created_at desc / B 其他 | **A** | 新到舊 |
| Q4 | 件數 | A 列數(distinct)/ B Σquantity | **B** | `itemCount=Σquantity`;**禁用列數** |
| Q5 | 總覽最近訂單 | A 同步接真 / ~~B 維持空~~ | **A** | **B 已移除**;Overview(#14/#15)強制;不得 stat/list 不一致 |
| Q6 | 讀模型架構 | A 新增 `listSummariesByCustomer` / B 改 `listByCustomer` 簽章 | **A** | **禁啟用 `listByCustomer`/`findById`**(維持 deferred、待 #217) |
| Q7 | oversized 批准 | A 批 18 檔不拆 / B 拆 | **A** | Sean 明確批 oversized;一次前後台同步、守鐵則 3 |

> 全部依審查建議拍板。安全紅線(IDOR / RLS own-only / 經銷價零洩漏 / boundaries / 繞 #217)codex 關卡1 round1 已獨立 grep 主樹全 **PASS**;round1 FAIL 純來自決策未定稿(本 §11)+ 2 補強(C1 exact-whitelist、C2 Σqty mapper 測),已全納入。

## 12. codex 關卡1 round1 修項對照(本版納入,供 round2 快查)
- **M1**(must)狀態映射完整定義 → §4f 逐字表 + exhaustive `never` 寫法 + §7 全組合測(鎖 partiallyPaid/refunded)。
- **M2**(must)Q5=A + Q7=A 固定為驗收條件 → §3「固定驗收」+ §6 檔數誠實計數。
- **M3**(must)Q1-Q7 完整內嵌 → §11 表(含選項/拍板/禁止值);Q6「不啟用 listByCustomer」→ §9 禁止項。
- **C1**(採納)select 守門升 exact whitelist(byte-for-byte)→ §5.8 + §7 adapter 測。
- **C2**(Q4=B 連帶)itemCount=Σquantity → §4a/§4c + §7 mapper 測(quantity=3→3)。
- **NIT**(修)availability_at_checkout 來源 = 20260614130000 → §1e 更正。
- **nit**(修)OrderListItem 註解改 generic「member order summary」→ §4a。
