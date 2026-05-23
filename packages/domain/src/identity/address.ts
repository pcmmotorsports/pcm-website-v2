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
