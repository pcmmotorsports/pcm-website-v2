// @pcm/adapters — 外部系統 adapter 實作(Supabase / Google Sheets / TapPay)
//
// 對應 ADR-0002 §4.1。子目錄結構待 backlog #48 / Audit-F25 / T17(adapters 子目錄結構) trigger 拍。
//
// Public API(對齊 M-1-03-main-d-d2 落地、Step 1 真權威字面確認 packages/adapters/src/supabase/client.ts):
// - SupabaseProductAdapter:domain Product 真實 adapter 實作(ADR-0005 後 main wire-up)
// - createSupabaseAnonClient / createSupabaseServiceClient:client factory(server-side DI)
//
// 注:Public API 範圍 d2 階段限 storefront 直接需要的字面(adapter + 兩 factory)。
// 未來 Sheets / TapPay adapter 落地時順手擴(對齊 ADR-0002 §4.1 + backlog #48 trigger)。

export { SupabaseProductAdapter } from './supabase/SupabaseProductAdapter';
export {
  createSupabaseAnonClient,
  createSupabaseServiceClient,
} from './supabase/client';
