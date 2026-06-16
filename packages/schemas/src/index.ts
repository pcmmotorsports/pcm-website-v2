// @pcm/schemas — 跨前後台共用 zod 表單驗證 schema(M-1-14c、PRD docs/specs/m-1-14-customer-schema.md §6)
//
// 定位:同一份 schema 給 storefront(client 端即時驗證)+ server use-case(重新驗證,
// 對齊 CLAUDE.md「會員等級驗證必在 server 端重新檢查、不信任 client」)。
// schema ≠ domain type ≠ DB row:本層只做「表單 input 形狀 + 驗證」(寫/異動路徑);
// id / customerUserId / tier / wallet_balance 等 server 生成或敏感欄不在任何 input schema
// (對齊 M-1-14a column GRANT + RLS、client 寫不到)。
//
// 字面源:design-reference/components/AccountPages.jsx(637dafc)+ WalletTab.jsx(鐵則 1 已 grep)。
// 驗證對齊 design 表單 + DB CHECK(M-1-14a)雙層防線。
// 語法:zod v4(實裝 4.4.3、Sean 2026-05-23 Q=A 拍板;v4 語法經 context7 + 對 4.4.3 探針驗證)。
//
// 對應 ADR-0001 §3.5、ADR-0002 §4.1。

import { z } from 'zod';

// === Auth forms ===

// LoginInput — design AccountPages L181-227(email / password / remember default true)
export const LoginInput = z.object({
  email: z.email({ error: 'Email 格式不正確' }),
  password: z.string().min(8, { error: '密碼至少 8 碼' }),
  remember: z.boolean().default(true),
});
export type LoginInput = z.infer<typeof LoginInput>;

// RegisterInput — design AccountPages L256-299(欄位順序對齊 design:name→email→phone→password→agree)
export const RegisterInput = z.object({
  name: z.string().min(1, { error: '請填寫姓名' }),
  email: z.email({ error: 'Email 格式不正確' }),
  phone: z.string().regex(/^[\d\s-]{8,}$/, { error: '手機格式不正確' }),
  password: z.string().min(8, { error: '密碼至少 8 碼' }),
  agree: z.literal(true, { error: '請同意服務條款' }),
});
export type RegisterInput = z.infer<typeof RegisterInput>;

// === Address form(design InlineAddressForm L686-757) ===
// invoice.type 三 tab:personal(手機載具選填)/ company(抬頭+統編必填)/ donate(愛心碼必填)。
// 跨欄位驗證對齊 DB CHECK addresses_invoice_company_has_data / addresses_invoice_donate_has_code(M-1-14a)。
export const AddressInput = z
  .object({
    isDefault: z.boolean().default(false),
    name: z.string().min(1, { error: '請填寫收件人' }),
    phone: z.string().default(''),
    line: z.string().min(1, { error: '請填寫地址' }),
    invoice: z.object({
      type: z.enum(['personal', 'company', 'donate']),
      carrier: z.string().default(''),
      title: z.string().default(''),
      taxId: z.string().default(''),
      donateCode: z.string().default(''),
    }),
  })
  .superRefine((data, ctx) => {
    const { invoice } = data;
    if (invoice.type === 'company') {
      if (!invoice.title) {
        ctx.addIssue({ code: 'custom', message: '請填寫公司抬頭', path: ['invoice', 'title'] });
      }
      if (!/^\d{8}$/.test(invoice.taxId)) {
        ctx.addIssue({ code: 'custom', message: '統編需 8 碼數字', path: ['invoice', 'taxId'] });
      }
    }
    if (invoice.type === 'donate' && !invoice.donateCode) {
      ctx.addIssue({ code: 'custom', message: '請填愛心碼', path: ['invoice', 'donateCode'] });
    }
  });
export type AddressInput = z.infer<typeof AddressInput>;

// === Vehicle form(design InlineVehicleForm L760-798、僅 name 必填) ===
// year/km/mods 全 string(design 為 text input、km 含千分位+單位)。
// service:design 為 <input type="date">(空 → ''、填 → ISO date 字串)→ transform 把 '' 正規化為 null
//   (#177:DB customer_vehicles.service 是 nullable date 欄,塞空字串會觸發 invalid input syntax for type date;
//    domain CustomerVehicle.service 本就 string | null,正規化後型別/runtime 一致)。
export const VehicleInput = z.object({
  isPrimary: z.boolean().default(false),
  name: z.string().min(1, { error: '請填寫車型' }),
  year: z.string().default(''),
  engine: z.string().default(''),
  km: z.string().default(''),
  mods: z.string().default(''),
  service: z
    .string()
    .default('')
    .transform((s) => (s === '' ? null : s)),
});
export type VehicleInput = z.infer<typeof VehicleInput>;

// === Profile form(design profile tab L662-671) ===
// email 在 design 為 disabled(不可改)→ 不含 email;對齊 ICustomerRepository.update patch 限定
// name/phone/birthday + DB column GRANT 只開這 3 欄 UPDATE。
export const ProfileInput = z.object({
  name: z.string().min(1, { error: '請填寫姓名' }),
  phone: z.string().default(''),
  birthday: z.string().default(''),
});
export type ProfileInput = z.infer<typeof ProfileInput>;

// === Checkout form(design CheckoutPage.jsx、M-3-S2-b2)===
// 結帳表單 input:選收件地址(addressId)+ 配送方式(home/store)+ 發票。
// 對齊 create_order RPC(20260604130000)契約:p_address_id uuid / p_shipping_method ∈ {home,store} /
// p_invoice {type, carrier?, title?, taxId?, donateCode?}。
// 🔴 購物車品項(variant_id/sku + qty)不在本 schema:由 CartContext 提供、結帳時組 p_lines(S2-b2-b use-case);
//    本 schema 只驗「結帳填寫表單」(地址選擇 + 配送 + 發票)。
// invoice 跨欄位驗證鏡像 AddressInput(company 須抬頭 + 8 碼統編、donate 須愛心碼);
// ⚠️ invoice 形狀與 AddressInput 重複未抽共用 —— 抽出 InvoiceInput 須重排 AddressInput superRefine
//    的 path(['invoice','title']→['title'])會動既有地址表單錯誤顯示 + 測試,風險高於收益,留待
//    後續統一重構(現以「兩處同步」紀律維持、改 invoice 規則須同步兩 schema)。
export const CheckoutInput = z
  .object({
    addressId: z.uuid({ error: '請選擇收件地址' }),
    shippingMethod: z.enum(['home', 'store'], { error: '請選擇配送方式' }),
    invoice: z.object({
      type: z.enum(['personal', 'company', 'donate']),
      carrier: z.string().default(''),
      title: z.string().default(''),
      taxId: z.string().default(''),
      donateCode: z.string().default(''),
    }),
  })
  .superRefine((data, ctx) => {
    const { invoice } = data;
    if (invoice.type === 'company') {
      if (!invoice.title) {
        ctx.addIssue({ code: 'custom', message: '請填寫公司抬頭', path: ['invoice', 'title'] });
      }
      if (!/^\d{8}$/.test(invoice.taxId)) {
        ctx.addIssue({ code: 'custom', message: '統編需 8 碼數字', path: ['invoice', 'taxId'] });
      }
    }
    if (invoice.type === 'donate' && !invoice.donateCode) {
      ctx.addIssue({ code: 'custom', message: '請填愛心碼', path: ['invoice', 'donateCode'] });
    }
  });
export type CheckoutInput = z.infer<typeof CheckoutInput>;

// === Place-order cart lines(M-3-S2-b2-e3b、結帳送出建單的購物車品項驗證)===
// 🔴 與 CheckoutInput 分離:購物車品項不在 CheckoutInput(品項在 client CartContext、送出時另組);
//    本 schema 只驗「送出的購物車線」。client 只送 {variantId, quantity}、**永不送價/tier**
//    (價由 create_order RPC server 權威算、tier 恆 general 階段①)。
// 對齊 create_order RPC(20260604130000):variant_id 走 `::uuid` cast → 此處 z.uuid() 比 RPC 更早 fail-closed;
//    quantity 對齊 CartContext MAX_QTY=99;陣列長度上限 200 對齊 RPC >200 reject + resolveCartLines MAX_LINES。
// 🔴 fail-closed 語意(寫入路徑 vs 顯示路徑 resolveCartLines):顯示路徑有變體缺 variantId → found:false 略過該行;
//    寫入路徑(placeOrderAction)同情境 safeParse 失敗 → **REJECT 整單**(回 formError)、不可略過壞行續建單。
export const PlaceOrderLinesInput = z
  .array(
    z.object({
      variantId: z.uuid({ error: '商品規格資訊有誤' }),
      quantity: z.number().int().min(1).max(99),
    }),
  )
  .min(1, { error: '購物車是空的' })
  .max(200);
export type PlaceOrderLinesInput = z.infer<typeof PlaceOrderLinesInput>;

// === Wallet deposit(design WalletTab L150-224) ===
// presets [3000,10000,30000,50000,100000] 為 UI 快捷鍵、非 schema 欄位。
// amount 為整數(對齊 wallet ledger integer 欄 + 金額禁浮點);max 1M 為業務防呆 cap(非 design 字面)。
export const DepositInput = z.object({
  amount: z
    .number()
    .int()
    .min(100, { error: '最少 NT$ 100' })
    .max(1_000_000, { error: '單次上限 NT$ 1,000,000' }),
  paymentMethod: z.enum(['tappay', 'atm']),
});
export type DepositInput = z.infer<typeof DepositInput>;

// === TapPay prime(M-3 ②-③d、charge action 前端契約)===
// 一次性 token(TapPay Fields SDK getPrime() 產;~90s 有效、單次使用)。本層只驗形狀
// (trim 非空 + 長度上限 512 防呆);真偽由 TapPay pay-by-prime server 端驗。
// 🔴 前端契約 = { checkout input, lines, prime } —— 零價、零 cardholder、零 orderId(鐵則 12)。
export const TapPayPrimeInput = z
  .string()
  .trim()
  .min(1, { error: '付款資訊缺失,請重新進行刷卡' })
  .max(512, { error: '付款資訊異常,請重新進行刷卡' });
export type TapPayPrimeInput = z.infer<typeof TapPayPrimeInput>;
