import type { Money, MemberTier } from '../shared/types';
import type { ProductId } from '../catalog/types';
import type { CustomerId } from '../identity/types';

export type OrderId = string;

/**
 * DisplayId: 人類可讀訂單編號(格式 `PCM-YYYY-NNNN`)。
 *
 * 型別為 string alias(對齊 OrderId 慣例);格式約定 / 驗證 / 組號 helper 見 `display-id.ts`。
 * 本片(M-3-S1)只定型別 + 格式約定 + 驗證 helper;**實際序號產生於後續 DB 片**
 * (orders 表序列 / create_order RPC、plan v6 §3.1)、本片不產真號。
 */
export type DisplayId = string;

/**
 * PaymentStatus: 付款狀態(domain enum、業務語意)。
 *
 * 對齊 ADR-0003 §3.2:
 * | domain | wire(Medusa) |
 * |---|---|
 * | paid | captured |
 * | unpaid | awaiting |
 * | partiallyPaid | partially_captured |
 * | refunded | refunded |
 *
 * Medusa wire 字串困在 adapter 內、ports / use-case / storefront 只見 domain enum。
 * 合法轉移表見 `state-machine.ts`(Phase 1 主路徑 unpaid→paid;refunded/partiallyPaid 留型別)。
 */
export type PaymentStatus = 'paid' | 'unpaid' | 'partiallyPaid' | 'refunded';

/**
 * FulfillmentStatus: 出貨狀態(domain enum、PCM 自家狀態機)。
 *
 * 對齊 ADR-0003 §3.2 + brainstorming Q9-10 拍板:
 * Medusa fulfillment_status 不夠用、PCM 自家 4 階段 enum 走 metadata。
 *
 * 業務含義(逐級線性、禁跳級 / 倒退、見 `state-machine.ts`):
 * - `notOrdered` 未跟廠商訂貨
 * - `ordered` 跟廠商訂貨中
 * - `inStock` 已現貨(到 PCM 倉庫或合作店家)
 * - `shipped` 已出貨給客人(或寄到合作店家)
 */
export type FulfillmentStatus = 'notOrdered' | 'ordered' | 'inStock' | 'shipped';

/**
 * ShippingMethod: 配送方式(domain enum、結帳當下凍結於 orders.shipping_method)。
 *
 * 對齊 design CheckoutPage + create_order RPC(20260604130000)p_shipping_method 白名單:
 * - `home`  宅配到府(運費依門檻、見 shipping.ts)
 * - `store` 合作店家自取(免運)
 *
 * (舊 4 種 home/cvs/store/express 已於 S2-a 作廢、Sean 拍 A 對齊 design;plan v6 §3.1。
 *  超商取貨 fulfillment_method 留 Phase 2、plan v6 §3.3。)
 */
export type ShippingMethod = 'home' | 'store';

/**
 * ProductSnapshot: 訂單品項商品快照(結帳當下凍結、逐欄白名單)。
 *
 * 🔴 鐵則 12 經銷價零滲入(plan v6 §5 紅線 4):型別層**只**允許 title / sku / spec 三欄、
 * 編譯期擋 `price_by_tier` / `price_store` / `cost` 進入 domain Order。任何「把整個 Product
 * 塞進快照」的企圖由 `createProductSnapshot()`(snapshot.ts)逐欄白名單複製於執行期攔截。
 *
 * - `title`:商品名稱(結帳當下、商品改名不影響歷史單)
 * - `sku`:商品主碼 productCode(對齊 catalog `Product.productCode`;與 `OrderItem.variantSku`
 *   變體個別料號語意分離)
 * - `spec`:變體規格 key-value 快照(例 `{ weave: '3K', finish: 'Glossy' }`);無變體商品為 `{}`
 */
export type ProductSnapshot = {
  title: string;
  sku: string;
  spec: Record<string, string>;
};

/**
 * OrderItem: 訂單品項(value-object、結帳當下凍結快照)。
 *
 * `unitPrice` / `lineTotal` 為「結帳當下」金額、與 `Product.priceByTier` 當前值無關
 * (商品改價不影響歷史訂單金額、plan v6 §5 紅線 4 歷史凍結)。
 * 建構走 `createOrderItem()` guard(order.ts):quantity 整數 ≥ 1、
 * lineTotal = unitPrice × quantity(整數)、productSnapshot 逐欄白名單。
 *
 * 🔴 型別層**無** price_by_tier / price_store / cost 欄(經銷價不滲 OrderItem)。
 */
export type OrderItem = {
  productId: ProductId;
  /** 訂購數量(整數 ≥ 1、createOrderItem guard 守) */
  quantity: number;
  /** 結帳當下單價(Money 整數、最小貨幣單位) */
  unitPrice: Money;
  /** 行小計 = unitPrice × quantity(Money 整數、createOrderItem 算 + 守) */
  lineTotal: Money;
  /** 變體個別料號快照(如 `DCC01-G-F`;無變體商品填商品主碼) */
  variantSku: string;
  /** 商品快照(逐欄白名單、禁經銷價 / cost) */
  productSnapshot: ProductSnapshot;
};

/**
 * OrderStatusFilter: admin 訂單列表雙維度篩選參數(value-object)。
 *
 * 對齊 PHASE-1-MILESTONES §7 M-4a-08(8 狀態雙維度篩選);
 * M-3 + M-4a-08 共用、抽出為共用 type。
 */
export type OrderStatusFilter = {
  paymentStatus?: PaymentStatus;
  fulfillmentStatus?: FulfillmentStatus;
};

/**
 * Order: 訂單 entity(M-3-S1 補完整 entity + 雙軸狀態機 + 金額快照)。
 *
 * 對齊 plan v6 §5.4 快照欄 + §5 紅線(金額整數 / 歷史凍結 / 經銷價零滲入);
 * 建構走 `createOrder()` factory(order.ts):invariant `subtotal = Σ lineTotal`、
 * `total = subtotal + shippingFee − discountTotal`、全非負整數;狀態流轉走 `state-machine.ts`。
 *
 * 🔴 型別層**無** price_by_tier / price_store / cost 欄(經銷價不滲 domain Order、plan §5 紅線 4)。
 * `tierAtCheckout` 只記「結帳當下會員等級」、**不記任何 tier 價結構**(取價在 server-only 路徑、
 * 落地後 OrderItem.unitPrice 已是該 tier 的單一 effective 價)。
 *
 * 完整欄位(shippingAddress / fulfillmentMethod / createdAt / tappay_rec_trade_id / 物流單號 / 等)
 * 在後續 DB 片(orders migration、plan §3.1)補。
 */
export type Order = {
  id: OrderId;
  /** 人類可讀單號 `PCM-YYYY-NNNN`(display-id.ts 組 / 驗) */
  displayId: DisplayId;
  customerId: CustomerId;
  items: OrderItem[];
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  /** 結帳當下會員等級快照(凍結;事後改 tier 不影響歷史單) */
  tierAtCheckout: MemberTier;
  /** 商品小計 = Σ items.lineTotal(Money 整數) */
  subtotal: Money;
  /** 運費(Money 整數;calculate-shipping 後續片算、本片由 caller 帶入) */
  shippingFee: Money;
  /** 折扣總額(Money 整數;Phase 1 多為 0) */
  discountTotal: Money;
  /** 訂單總額 = subtotal + shippingFee − discountTotal(Money 整數、非負) */
  total: Money;
};

/**
 * OrderListItem: 會員訂單摘要投影(member order summary、泛用 read-model)。
 *
 * 用途:account OrdersTab 列表 / Overview「最近訂單」preview / 未來月結等只讀清單。
 * 刻意**不含** `items[]`:order_items 表無 `product_id`(backlog #217)、無法忠實重建
 * `OrderItem.productId`;列表只需摘要,故繞過 #217(明細頁未來 slice 才需完整 Order + 解 #217)。
 *
 * 🔴 鐵則 12:型別層**無** price_by_tier / price_store / cost(經銷價零滲入);`total` 為會員
 * 自己訂單的總額(RLS own-only、非經銷價)。`itemCount` = Σquantity(總數量、非 distinct 列數;
 * M-3 Sean 拍 Q4=B)、由 adapter 端彙總。`createdAt` 為 ISO 原樣(UI 端格式化、domain 不綁格式)。
 */
export type OrderListItem = {
  id: OrderId;
  /** 人類可讀單號 `PCM-YYYY-NNNN` */
  displayId: DisplayId;
  /** 下單時間 ISO 字串(orders.created_at 原樣;UI formatOrderDate 格式化為 YYYY-MM-DD) */
  createdAt: string;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  /** 訂單總額(Money 整數、TWD;會員自己的單、非經銷價) */
  total: Money;
  /** 商品總數量 Σquantity(Q4=B、非 distinct 品項列數) */
  itemCount: number;
};

// ── M-4a 訂單線:後台管理讀模型(order_source / payment_channel / admin 篩選 + 摘要)──

/**
 * OrderSource: 訂單來源(M-4a、orders.order_source;來源與金流管道拆兩軸)。
 *
 * 對齊 orders.order_source CHECK(migration 20260712203000):
 * - `web` 前台 create_order 建單(既有列預設回填)
 * - `manual_phone` / `manual_line` / `manual_other` 後台手動建單(散客單、來源電話/LINE/其他;手動建單片才寫入)
 *
 * 本片(訂單線第一片)純顯示既有 web 單、不做手動建單;此 enum 供列表「來源」次要篩選 + 顯示標籤用。
 */
export type OrderSource = 'web' | 'manual_phone' | 'manual_line' | 'manual_other';

/**
 * PaymentChannel: 金流管道(M-4a、orders.payment_channel;錢實際走哪條)。
 *
 * 對齊 orders.payment_channel CHECK(migration 20260712203000):`tappay` / `bank_transfer` / `cash` / `none`。
 *
 * 🔴 語意分界(migration COMMENT 釘死):`payment_channel` 是「管理/預期軸」、**算實收金額禁用**;
 * 對帳/實收一律走 `payment_method`(金流事實軸)+ `payment_status`。本片列表純顯示不算錢,標明防後續片誤用。
 */
export type PaymentChannel = 'tappay' | 'bank_transfer' | 'cash' | 'none';

/**
 * AdminOrderFilter: 後台訂單列表雙軸 + 次要篩選(value-object;全欄可選、缺 = 不限)。
 *
 * 主雙軸 = `paymentStatus` × `fulfillmentStatus`(營運最常查「已付未出」);
 * 次要 = `orderSource` / `paymentChannel`。全部走 DB where 下推(server 端篩選、非前端過濾)。
 * (對比會員側 `OrderStatusFilter` 只有雙軸;admin 多來源/管道兩軸、故另立型別、不擴會員側。)
 */
export type AdminOrderFilter = {
  paymentStatus?: PaymentStatus;
  fulfillmentStatus?: FulfillmentStatus;
  orderSource?: OrderSource;
  paymentChannel?: PaymentChannel;
  /**
   * 訂單處理狀態篩選(M-4a workflow_status;Sean 的主操作軸):
   * - `undefined` = 不篩;
   * - `string` = 指定 order_status_options.code(動態詞彙、非靜態 enum,值域由 DB CHECK slug 格式約束);
   * - `null` = 只看「未設定」(workflow_status IS NULL 的單;新進線上單未 triage 態)。
   */
  workflowStatus?: string | null;
};

/**
 * AdminOrderLine: 後台訂單列表「每商品一列」品項投影(M-4a Slice D-1a;order_items 內嵌展開)。
 *
 * 🔴 鐵則 12:`unitPrice`/`lineTotal` = 該單**成交價**(下單當下實際賣價、integer 元位 → Money),
 * 非經銷價表 —— brand join 只取 `brands.name`,穿越的 product_variants/products 價格欄(price_store /
 * price_by_tier)絕不投影(見 `ADMIN_ORDER_LIST_SELECT` byte-lock + forbidden-token 測試縱深)。
 * `brand`:order_items.variant_id → product_variants → products → brands.name;variant_id 為 null
 * (supplier_slug+sku 型 line)或 join 缺 → null(顯示端「—」)。
 */
export type AdminOrderLine = {
  /** 料號(order_items.variant_sku) */
  variantSku: string;
  /** 品名(product_snapshot.title;缺 → null 防禦) */
  title: string | null;
  /** 商品品牌(join brands.name;缺 → null) */
  brand: string | null;
  quantity: number;
  /** 成交單價(整數元位;非經銷價表) */
  unitPrice: Money;
  /** 小計 line_total(下單當下 server 算、不重算) */
  lineTotal: Money;
};

/**
 * AdminOrderSummary: 後台訂單列表摘要投影(admin read-model、server 分頁)。
 *
 * 用途:後台 /orders 列表(找單 / 看狀態)。M-4a Slice D-1a 起攜 `lines[]`(每商品一列展開、brand join)+ tierAtCheckout;
 * 比 `OrderListItem` 多攜:客人顯示名(join customers)、order_source、payment_channel、display_position、
 * cancelled_at(取消軸,非 null = 已取消,本片純顯示、取消功能留取消片)。
 *
 * 🔴 鐵則 12:型別層**無** price_by_tier / price_store / cost(orders 表本身無成本欄、天生守;投影仍具名白名單)。
 * `total` 為該單總額(整數元位 → Money);`customerName` 可為 null(防禦:FK ON DELETE RESTRICT 保證客人存在,
 * 但 join 邊界仍容 null)。`createdAt` / `cancelledAt` ISO 原樣(UI 端格式化)。
 */
export type AdminOrderSummary = {
  id: OrderId;
  /** 人類可讀單號 `PCM-YYYY-NNNN` */
  displayId: DisplayId;
  /** 下單時間 ISO(orders.created_at 原樣;UI formatOrderDate 格式化) */
  createdAt: string;
  /** 客人顯示名(join customers.name;缺 → null) */
  customerName: string | null;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  orderSource: OrderSource;
  paymentChannel: PaymentChannel;
  /** 訂單總額(Money 整數、TWD) */
  total: Money;
  /** 後台工作排序鍵(NULL = 未手動排過);本片顯示排序值、拖曳排序留訂單線-03 */
  displayPosition: number | null;
  /** 取消時間 ISO(非 null = 已取消;本片純顯示,取消功能留取消片) */
  cancelledAt: string | null;
  /**
   * 訂單處理狀態(M-4a、orders.workflow_status;soft-ref order_status_options.code)。
   * NULL = 未設定(新進線上單未 triage);未知 code(選項被停用/改碼)由顯示端兜底、不在此層擋。
   * 🔴 純操作/顯示軸:金流真相恆為 paymentStatus,本欄絕不進金流/對帳/退款判斷。
   */
  workflowStatus: string | null;
  /** 樂觀鎖版本(M-4a Slice C;寫入路徑帶此值當 WHERE version 條件、衝突 409 重載)。 */
  version: number;
  /**
   * 會員等級(orders.tier_at_checkout、下單當下等級快照)。general=一般、store/premiumStore=車行。
   * 🔴 鐵則 12:tier + 品項成交價同列 = 經銷價脈絡,僅 admin server-render(SSO 閘後)消費、
   * 絕不進非 admin client bundle(本讀模型只由 server component 用)。
   */
  tierAtCheckout: MemberTier;
  /** 該單品項展開(M-4a Slice D-1a「每商品一列」、同單分組顯示;空陣列顯示端兜一列「—」)。 */
  lines: AdminOrderLine[];
};

/** 開票紀錄狀態(orders.invoice_status;DB CHECK 三值,v1 簡單欄位、不串電子發票 API)。 */
export type InvoiceStatus = 'not_issued' | 'issued' | 'voided';

/**
 * AdminOrderWorkflowPatch: 後台改單 patch(M-4a Slice C;admin_update_order_workflow RPC 入參)。
 *
 * 🔴「未提供 ≠ 清空」語意(對齊 RPC jsonb key 存在性):
 * - 欄位**省略(undefined)** = 不動該欄;
 * - `workflowStatus`/`invoiceNumber`/`invoiceAmount` 明給 `null` = 清空(Sean「全清重設」);
 * - `shippingMethod`/`invoiceStatus` 不可為 null(DB NOT NULL);
 * - `workflowStatus` 非 null 時須為 order_status_options.code(RPC 端驗 is_active、UI 不可信)。
 * 🔴 型別層**無** payment/fulfillment/金額 total 欄(金流紅線:改單絕不碰金流真相軸)。
 */
export type AdminOrderWorkflowPatch = {
  workflowStatus?: string | null;
  shippingMethod?: string;
  invoiceNumber?: string | null;
  invoiceAmount?: number | null;
  invoiceStatus?: InvoiceStatus;
};

/** 後台改單結果碼(RPC 回傳;UI 分流:成功 / 版本衝突重載 / 無變更)。 */
export type AdminOrderWorkflowResult = 'UPDATED' | 'CONFLICT' | 'NOOP';

/**
 * AdminOrderDetailItem: 後台訂單明細單一品項(M-4a Slice B;order_items 投影)。
 *
 * `title`/`spec` 來自 `product_snapshot` jsonb(create_order RPC 寫入 {sku,spec,title};防禦容缺 → null)。
 * 🔴 鐵則 12:`unitPrice`/`lineTotal` = 該單**成交價**(下單當下實際賣價、integer 元位 → Money),
 * **非**經銷價表(price_store / price_by_tier / cost 零滲入;snapshot 本身無價格欄)。
 */
export type AdminOrderDetailItem = {
  variantSku: string;
  /** 品名(product_snapshot.title;缺 → null 防禦) */
  title: string | null;
  /** 規格 kv(product_snapshot.spec;缺/非物件 → null 防禦) */
  spec: Record<string, string> | null;
  quantity: number;
  /** 成交單價(整數元位;非經銷價表) */
  unitPrice: Money;
  /** 小計 = 下單當下 server 算的 line_total(不重算) */
  lineTotal: Money;
};

/**
 * AdminOrderDetail: 後台訂單明細讀模型(M-4a Slice B;/orders/[id] 明細頁、admin-only)。
 *
 * 🔴 PII 邊界(設計檔 2026-07-13):明細**才**攜 客戶姓名/電話/email + 收件快照(姓名/電話/地址)——
 * 走 service_role、`ADMIN_ORDER_DETAIL_SELECT` 另立具名白名單,**不進列表投影**(列表維持精簡)。
 * 🔴 鐵則 12:**仍零**成本/經銷價欄(price_store / price_by_tier / cost)、**零** tappay_rec_trade_id
 * (金流對帳識別碼不進後台顯示層;對帳走 #250/W1 管線)。
 * `invoiceRequest` = 既有 orders.invoice jsonb(客人結帳開票**需求**:個人/統編/載具);
 * `invoiceNumber/Amount/Status` = 開票**紀錄**三欄(Sean 手填;兩者語意分離)。
 * `paymentMethod` = 金流事實軸(金流 RPC 寫入;報表算錢用它)、`paymentChannel` = 管理/預期軸。
 */
export type AdminOrderDetail = {
  id: OrderId;
  displayId: DisplayId;
  createdAt: string;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  /** 訂單處理狀態(NULL=未設定;同 AdminOrderSummary.workflowStatus 語意) */
  workflowStatus: string | null;
  orderSource: OrderSource;
  paymentChannel: PaymentChannel;
  /** 金流事實軸(付款成功才有值;null=尚無成功請款) */
  paymentMethod: string | null;
  paidAt: string | null;
  subtotal: Money;
  shippingFee: Money;
  discountTotal: Money;
  total: Money;
  /** 出貨方式(既有欄、結帳寫入;現值 'home',Slice C 起 admin 可改) */
  shippingMethod: string;
  /** 收件快照 PII(orders.shipping_address_snapshot jsonb {name,phone,line};防禦容缺) */
  shippingAddress: { name: string | null; phone: string | null; line: string | null };
  /** 客人資訊 PII(join customers;姓名/email/電話) */
  customer: { name: string | null; email: string | null; phone: string | null };
  /** 結帳開票需求(orders.invoice jsonb;type/taxId/title/carrier/donateCode,防禦容缺) */
  invoiceRequest: {
    type: string | null;
    taxId: string | null;
    title: string | null;
    carrier: string | null;
    donateCode: string | null;
  };
  /** 開票紀錄三欄(M-4a;Sean 手填) */
  invoiceNumber: string | null;
  invoiceAmount: Money | null;
  invoiceStatus: InvoiceStatus;
  cancelledAt: string | null;
  /** 取消原因=可對客文案(會員可見自己單此欄;內部原因在 admin_audit_log) */
  cancelledReason: string | null;
  /** 樂觀鎖版本(M-4a Slice C;明細頁表單 hidden 帶此值當寫入條件) */
  version: number;
  items: AdminOrderDetailItem[];
};

/**
 * OrderStatusOption: 後台訂單處理狀態詞彙(M-4a、order_status_options 表;Sean 可設定+顏色)。
 *
 * Sean 的 Google Sheet 工作方式:單一「訂單狀態」下拉 + 底色(收款×訂定×貨況合併標籤)。
 * `code` = 穩定識別碼(orders.workflow_status soft-ref);`label` = 顯示文字(截圖逐字);
 * `color` = badge 底色 hex;`textColor` = 深底淺字/淺底深字;`sortOrder` = 下拉排序;
 * `isActive` = soft-delete(停用不硬刪,既有單指向不消失、顯示端仍可解析 label)。
 */
export type OrderStatusOption = {
  code: string;
  label: string;
  /** badge 底色(hex,如 '#FBE4A6';DB CHECK 保證格式) */
  color: string;
  /** 字色模式:'light' 深底淺字 / 'dark' 淺底深字 */
  textColor: 'light' | 'dark';
  sortOrder: number;
  isActive: boolean;
};

/**
 * PlaceOrderLine: 結帳送出的單一購物車品項(client → server 線契約)。
 *
 * 對齊 create_order RPC(20260604130000)p_lines:`variantId` XOR `(supplierSlug + sku)`、皆帶 qty。
 * S3a 後 sku 非全域唯一 → 優先 variantId;無 variantId 時用 (supplierSlug, sku) 複合鍵防撞錯變體/錯價。
 *
 * 🔴 鐵則 12(plan v6 §5 紅線 3 server 價權威):**型別層無** price / unitPrice / tier / priceByTier /
 * priceStore / cost 欄。client 只送「買什麼變體、買幾個」、**永不送價/tier**;單價 / 小計 / 運費 / total
 * 全由 create_order RPC server 自算、client 送的任何金額一律忽略。
 */
export type PlaceOrderLine =
  | { variantId: string; quantity: number }
  | { supplierSlug: string; sku: string; quantity: number };

/**
 * OrderInvoice: 結帳發票資訊(對齊 create_order RPC p_invoice + design CheckoutPage)。
 *
 * type ∈ personal(手機載具選填)/ company(抬頭 + 8 碼統編)/ donate(愛心碼);
 * 跨欄位必填驗證在 @pcm/schemas `CheckoutInput`(delivery 層)+ RPC 收乾淨白名單 jsonb。
 */
export type OrderInvoice = {
  type: 'personal' | 'company' | 'donate';
  carrier?: string;
  title?: string;
  taxId?: string;
  donateCode?: string;
};

/**
 * PlaceOrderInput: 建單 use-case / repo 寫入 input(client → server 線契約、value-object)。
 *
 * 對齊 create_order RPC 簽名(p_lines / p_address_id / p_shipping_method / p_invoice / p_cart_session_id
 * / p_terms_version / p_client_ip / p_client_ua、#241 8-param):
 * - `lines`:購物車品項(1..200、每筆 qty 1..10000、上限 RPC 驗)
 * - `addressId`:收件地址 id(RPC 以 auth.uid() 驗本人歸屬、防 IDOR)
 * - `shippingMethod`:配送方式(運費 RPC §7 自算、見 shipping.ts)
 * - `invoice`:發票
 * - `cartSessionId`:cart-instance idempotency key(uuid;3DS 跨分頁雙扣去重、對齊 0b p_cart_session_id
 *   null fail-closed)。**非價/非身分/非 tier**。現行(3DS-7、已上線)= client CartContext 持有的穩定 key
 *   經 charge-actions chargePaymentAction 送 server(server 局部 UUID_RE 驗、非空 fail-closed;per-cart-instance 去重)。
 * - `termsVersion` / `clientIp` / `clientUserAgent`:🔴 #241 同意紀錄(**server 注入、非 client→server 線契約**;見各欄)。
 *
 * 🔴 鐵則 12:**無** customerId / tier / 任何價欄 —— 身分由 RPC server 端 `auth.uid()` 重查(零信任)、
 * 價 server 權威。client 永不送 userId / 價 / tier。
 */
export type PlaceOrderInput = {
  lines: PlaceOrderLine[];
  addressId: string;
  shippingMethod: ShippingMethod;
  invoice: OrderInvoice;
  cartSessionId: string;
  /**
   * 🔴 #241 同意條款版本(server 注入 `CURRENT_TERMS_VERSION`、**非 client 送**;對齊 create_order
   * 8-param `p_terms_version`)。create_order 路徑必填(NULL/空 → RPC RAISE「無 consent 不生 order」、
   * 同 transaction 原子寫 order_legal_consents)。
   */
  termsVersion: string;
  /** 🔴 #241 best-effort 同意來源 IP(server 由 request headers 抓、可 null;爭議舉證、**非強身分證據**)。 */
  clientIp?: string | null;
  /** 🔴 #241 best-effort 同意來源 User-Agent(server 抓、可 null)。 */
  clientUserAgent?: string | null;
};

/**
 * PlaceOrderResult: 建單回傳(對齊 create_order RPC return DTO `{order_id, display_id}`)。
 *
 * 🔴 鐵則 12(plan §5 紅線 4 + RPC L266-267「禁回原 row / 禁帶價結構」):建單**只**回訂單 id +
 * 人類可讀單號、**不帶任何價 / tier / 明細結構**;需要明細另走只讀路徑(findById、stage ③ 訂單查詢)。
 */
export type PlaceOrderResult = {
  orderId: OrderId;
  displayId: DisplayId;
};
