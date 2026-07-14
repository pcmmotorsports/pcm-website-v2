// @pcm/adapters — 外部系統 adapter 實作(Supabase / Google Sheets / TapPay)
//
// 對應 ADR-0002 §4.1。子目錄結構待 backlog #48 / Audit-F25 / T17(adapters 子目錄結構) trigger 拍。
//
// Public API(對齊 sub-slice B-2 subpath exports 拆法):
// - SupabaseProductAdapter:domain Product 真實 adapter 實作(ADR-0005 後 main wire-up)
// - createSupabaseAnonClient:anon factory(**server-only**〔client.ts 頂層 import 'server-only'〕、anon key + RLS-protected、
//   伺服器端公開 SELECT〔storefront SSR/server component 讀目錄〕;瀏覽器端公開讀走 storefront lib/supabase/browser.ts、非本 factory、#218)
//
// Server-only API(從 @pcm/adapters/server import、不在本檔):
// - createSupabaseServiceClient:service_role factory(繞 RLS、apps/api 寫操作用、絕不入 client bundle)
//
// 注:Public API 範圍限 storefront 直接需要的字面(adapter + anon factory)。
// 未來 Sheets / TapPay adapter 落地時順手擴(對齊 ADR-0002 §4.1 + backlog #48 trigger)。

export { SupabaseProductAdapter } from './supabase/SupabaseProductAdapter';
// M-1-14d:會員系統 3 個 Supabase adapter(單一 authenticated client、RLS 守自己 row)。
export { SupabaseCustomerAdapter } from './supabase/SupabaseCustomerAdapter';
export { SupabaseAddressAdapter } from './supabase/SupabaseAddressAdapter';
export { SupabaseVehicleAdapter } from './supabase/SupabaseVehicleAdapter';
// M-3-S2-b2:SupabaseOrderAdapter 建單走 create_order SECURITY DEFINER RPC、**零 service_role**
// (authenticated client 對 orders/order_items 僅 SELECT、建單只能走 RPC)→ root public export、
// 鏡像 Address/Customer/Vehicle(非 /server 受控小門〔那是 Wallet service_role 用〕)。
export { SupabaseOrderAdapter } from './supabase/SupabaseOrderAdapter';
// M-4a Slice A:訂單處理狀態詞彙讀 adapter(admin-only;client 由 admin composition 注入 service_role、
// 本 class 不持金鑰,同 SupabaseOrderAdapter 注入模式)。
export { SupabaseOrderStatusOptionsAdapter } from './supabase/SupabaseOrderStatusOptionsAdapter';
// M-1-14d-2:SupabaseWalletAdapter 因 addEntry 需 service_role writeClient(金流敏感、server-only
// 邊界)、不在 root public API export、改從 @pcm/adapters/server export(見 server.ts)。
export { createSupabaseAnonClient } from './supabase/client';
export {
  availabilityToBool,
  boolToAvailability,
} from './storefront-mappers/availability';
