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

// 🔴 GoTrue 錯誤碼判別的**唯一**處(2026-08-28 R3 F5:原本 storefront 與 admin 各一份,
//    而後者出生就比前者寬)。純函式、零 server-only ⇒ 放 root。
export { isEmailExistsError } from './supabase/auth-errors';
export { SupabaseProductAdapter } from './supabase/SupabaseProductAdapter';
// M-1-14d:會員系統 3 個 Supabase adapter(單一 authenticated client、RLS 守自己 row)。
export { SupabaseCustomerAdapter } from './supabase/SupabaseCustomerAdapter';
// 🔴 進 root export 的理由**照本檔 :47-50 那條界線判的, 不是照「會不會寫入」**:
//    真正的界線是「ctor 要不要【強制】一個 service_role client」。
//    `SupabaseCouponAdapter` 的 ctor 收一個普通的 `SupabaseClient<Database>` ⇒ 不強制
//    ⇒ 與同一行的 `SupabaseCustomerAdapter` 同款(那支也是 admin 列表要 service_role 才讀得到)。
//    ⚠️ 而它**只讀不寫** —— 券的寫入唯一路是之後那幾片的 SECURITY DEFINER RPC。
export {
  SupabaseCouponAdapter,
  ADMIN_COUPON_LIST_SELECT,
  ADMIN_COUPON_LIST_VIEW,
} from './supabase/SupabaseCouponAdapter';
export type {
  SupabaseAdminCouponRow,
  AdminCouponFilter,
  AdminCouponSort,
} from './supabase/SupabaseCouponAdapter';
export { SupabaseAddressAdapter } from './supabase/SupabaseAddressAdapter';
export { SupabaseVehicleAdapter } from './supabase/SupabaseVehicleAdapter';
// M-3-S2-b2:SupabaseOrderAdapter 建單走 create_order SECURITY DEFINER RPC、**零 service_role**
// (authenticated client 對 orders/order_items 僅 SELECT、建單只能走 RPC)→ root public export、
// 鏡像 Address/Customer/Vehicle(非 /server 受控小門〔那是 Wallet service_role 用〕)。
export { SupabaseOrderAdapter } from './supabase/SupabaseOrderAdapter';
// M-4b #191:SupabaseFavoritesAdapter 走客人自己的 authenticated client(RLS favorites_*_own、
// DB 端 authenticated 只有 SELECT/INSERT/DELETE)→ **零 service_role**、鏡像 Address/Vehicle 走 root export。
export { SupabaseFavoritesAdapter } from './supabase/SupabaseFavoritesAdapter';
// M-4b E10 A9w4c(後半收尾):`SupabaseOrderStatusOptionsAdapter` 已隨 port 與讀取鏈整支移除
// (A11a-1 後零 production 呼叫端)。DB 端 service_role 的**寫**權由 A9v `20260807120000`
// 撤除(SELECT 保留),apply 後生效。
// M-1-14d-2:SupabaseWalletAdapter 因 addEntry 需 service_role writeClient(金流敏感、server-only
// 邊界)、不在 root public API export、改從 @pcm/adapters/server export(見 server.ts)。
export { createSupabaseAnonClient } from './supabase/client';
export {
  availabilityToBool,
  boolToAvailability,
} from './storefront-mappers/availability';

// 🔴 **純 mapper,不是 adapter** —— 它只把一列 `customer_wallet_ledger` 的 row 轉成 domain 型別,
//    **不持任何 client、不碰 service_role** ⇒ 放 root export 不違反上面那條
//    「`SupabaseWalletAdapter` 因 `addEntry` 需 service_role writeClient 而不在 root」的界線。
//
//    🔴 **而那條界線【不是「會不會寫入」】** —— 我第一版這樣寫,而它是錯的(對抗審查 nit,我複驗過):
//    root export 裡**已經有好幾支會寫入的 adapter**(`SupabaseCustomerAdapter` `:18` 有 `update`、
//    `SupabaseAddressAdapter` `:19`、`SupabaseOrderAdapter` `:24` …)。
//    ⇒ **真正的界線是「要不要 service_role / server-only」** —— `SupabaseWalletAdapter` 出局是因為
//      它的 ctor **強制**一個 service_role writeClient,而那個東西不該進得了顧客站的 bundle。
//    ⇒ 本支 mapper **兩個都不沾**:不持任何 client、不碰 service_role,它收一個已經在手上的物件。
//
// ⚠️ **為什麼要 export 而不是在 storefront 抄一份**:顧客站的會員中心要直接查 ledger
//    (它不能用 `SupabaseWalletAdapter` —— 那支的 ctor 強制 service_role writeClient,
//     而 `apps/storefront/src/app/account/page.tsx:18-19` 逐字寫著 storefront 不允許注入 service_role)。
//    ⇒ 沒有這個 export,那邊就要**再寫一份欄位對照** ⇒ 兩份會漂,而漂了之後畫面照樣顯示得出東西。
// 🔵 `narrowGender` 進 root export 的理由:**會員中心那一頁自己讀 `customers` 行**
//    (`account/page.tsx` 走 Supabase client 直取,不經 adapter)⇒ 它需要同一把收窄尺。
//    🔴 而重點是【同一把】—— 兩處各寫一份「認得哪三個值」的判斷,它們會漂。
export { narrowGender } from './supabase/mappers/customer';
export { mapSupabaseWalletEntryToDomain } from './supabase/mappers/wallet';
