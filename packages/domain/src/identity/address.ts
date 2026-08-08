import type { CustomerId } from './types';

export type AddressId = string;

/**
 * InvoiceType: 發票類型(對齊 design InlineAddressForm L727-737 三 tab)。
 * - `personal` 個人(手機載具)
 * - `company` 公司(抬頭 + 統編)
 * - `donate` 捐贈(愛心碼)
 */
export type InvoiceType = 'personal' | 'company' | 'donate';

/**
 * CustomerAddress: 收件地址 + 發票合一 entity(M-1-14)。
 *
 * 對齊 PRD docs/specs/m-1-14-customer-schema.md §4.2 + Supabase migration
 * `20260523034911_init_customers_and_subtables` customer_addresses 表(M-1-14a);
 * 逐欄對齊 design AccountPages.jsx InlineAddressForm L686-757。
 *
 * invoice 巢狀物件對齊 design 三 tab(載具 / 抬頭+統編 / 愛心碼)、DB 端攤平為
 * invoice_type / invoice_carrier / invoice_title / invoice_tax_id / invoice_donate_code 欄、由 adapter mapper 轉。
 * 每 customer 至多一筆 isDefault(DB partial unique index 守、對齊 [[customer]])。
 */
export type CustomerAddress = {
  id: AddressId;
  customerUserId: CustomerId;
  isDefault: boolean;
  name: string; // 收件人
  phone: string;
  line: string; // 地址(縣市 / 區 / 路 / 號 / 樓)
  /**
   * 收件人 Email(M-4b LINE 3DS 修復)。付款時 `cardholder.email` 優先取這個值。
   *
   * **`string | null`,不跟 phone 一樣在 mapper 壓成空字串**:保留 `null` 是為了不在
   * mapper 這層抹掉存量資料的原始形狀(新欄之前建的列多半是 `null`),盤點與資料修復用得到。
   * ⚠️ 但 **`null` 不足以證明「從未填過」** —— 客人可直接打 PostgREST 寫自己的列
   * (表級 GRANT + RLS own-only,見 backlog #343)。
   *
   * ⚠️ **誠實邊界(codex 關卡2 指出、確認屬實)**:目前**沒有任何一條程式分支**真的
   * 依這個區分做不同的事 —— 結帳端(`cardholder.ts`)與表單端(`InlineAddressForm`)
   * 都把 null 與 '' 一視同仁當「沒有值」。所以這個區分現在的價值只在**辨識存量資料**
   * (查 DB 時分得出哪些是舊列),不是行為分支。要真的分流,得先加分支與對應的行為測試。
   */
  email: string | null;
  invoice: {
    type: InvoiceType;
    carrier: string; // personal only(手機載具)
    title: string; // company only(公司抬頭)
    taxId: string; // company only(統編 8 碼)
    donateCode: string; // donate only(愛心碼)
  };
  createdAt: string;
  updatedAt: string;
};
