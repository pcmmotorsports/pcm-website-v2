// @pcm/adapters — 外部系統 adapter 實作(Supabase / Google Sheets / TapPay)
//
// 對應 ADR-0002 §4.1。子目錄結構待 backlog #48 / Audit-F25 / T17(adapters 子目錄結構) trigger 拍。
//
// Public API(對齊 sub-slice B-2 subpath exports 拆法):
// - SupabaseProductAdapter:domain Product 真實 adapter 實作(ADR-0005 後 main wire-up)
// - createSupabaseAnonClient:anon factory(可進 client bundle、RLS-protected、storefront 公開讀用)
//
// Server-only API(從 @pcm/adapters/server import、不在本檔):
// - createSupabaseServiceClient:service_role factory(繞 RLS、apps/api 寫操作用、絕不入 client bundle)
//
// 注:Public API 範圍限 storefront 直接需要的字面(adapter + anon factory)。
// 未來 Sheets / TapPay adapter 落地時順手擴(對齊 ADR-0002 §4.1 + backlog #48 trigger)。

export { SupabaseProductAdapter } from './supabase/SupabaseProductAdapter';
// M-1-14d:會員系統 3 個 Supabase adapter(單一 authenticated client、RLS 守自己 row)。
// wallet adapter(混合 auth:讀 authenticated / 寫 service_role)拆下一段 M-1-14d-2。
export { SupabaseCustomerAdapter } from './supabase/SupabaseCustomerAdapter';
export { SupabaseAddressAdapter } from './supabase/SupabaseAddressAdapter';
export { SupabaseVehicleAdapter } from './supabase/SupabaseVehicleAdapter';
export { createSupabaseAnonClient } from './supabase/client';
export {
  availabilityToBool,
  boolToAvailability,
} from './storefront-mappers/availability';
