// lib/auth/composition.ts — 會員認證 + 會員資料 composition root(M-1-14e-f1-pre 建、g-4a 擴 getCustomerRepo)
//
// 對齊 plan v4 §2(D-b=A / PRECISION-4 / finding-5):
// - storefront 唯一注入 SupabaseAuthAdapter(IAuthService 實作)的「受控單檔」。register/login server action
//   只 import 本檔的 getAuthService()、不直接碰 @pcm/adapters/server。
// - eslint.config.js L113-126 禁整個 apps/storefront/**/*.{ts,tsx} import @pcm/adapters/server;本檔以
//   inline eslint-disable + 意圖註解開「受控小門」(比 files-override block 更可審、code-reviewer 在 import 點即見例外)。
// - getAuthService 為 async per-request factory(注入 createServerSupabaseClient() 的 cookie-aware client;
//   finding-5:Next 16 cookies() async、不可 module singleton)。
//
// g-4a:新加 getCustomerRepo() 為 ICustomerRepository factory(對齊 getAuthService 並列、單檔 composition root)。
// SupabaseCustomerAdapter 在 @pcm/adapters root export(非 /server subpath、eslint 允許 lint pass、無 -disable),
// **但 root export 來源 packages/adapters/src/supabase/client.ts 頂層 `import 'server-only'`、整條 import chain
// 被 server-only 約束;本檔已 `import 'server-only'`、安全因「server-only composition 使用」而非「client-safe」**
// (codex k1 Important 2 修正:plan 早期字面誤導「public 可任意進 client」、實況需 server-only 守)。
// 不持 service_role:SupabaseCustomerAdapter 收 cookie-aware authenticated client、走 RLS customers_select_own /
// customers_update_own(auth.uid()=user_id 限自己改自己),寫入 ownership 靠 RLS row 守、欄位靠 GRANT 守。

import 'server-only';
import type { IAuthService, ICustomerRepository, IAddressRepository, IVehicleRepository, IOrderRepository } from '@pcm/ports';
// eslint-disable-next-line no-restricted-imports -- 受控例外:composition root 注入 IAuthService;SupabaseAuthAdapter 不持 service_role(收注入的 anon-ssr client)、本檔永不 import createSupabaseServiceClient / SupabaseWalletAdapter
import { SupabaseAuthAdapter } from '@pcm/adapters/server';
import { SupabaseCustomerAdapter, SupabaseAddressAdapter, SupabaseVehicleAdapter, SupabaseOrderAdapter } from '@pcm/adapters';
import { createServerSupabaseClient } from '@/lib/supabase/server';

/**
 * 建本次 request 的 IAuthService(SupabaseAuthAdapter + cookie-aware server client)。
 * server action / route handler 每次 `await getAuthService()`、不快取跨 request。
 */
export async function getAuthService(): Promise<IAuthService> {
  const supabase = await createServerSupabaseClient();
  return new SupabaseAuthAdapter(supabase);
}

/**
 * 建本次 request 的 ICustomerRepository(SupabaseCustomerAdapter + cookie-aware authenticated server client)。
 * 用於 server action(g-4 updateProfileAction)+ server component(M-1-14e-g-4+ profile/address/vehicle read)。
 *
 * **不持 service_role**:authenticated client 走 RLS customers_update_own(auth.uid()=user_id 限自己)、
 * column 寫入靠 migration GRANT L231(name/phone/birthday/updated_at 三欄 + trigger 強制 updated_at)。
 */
export async function getCustomerRepo(): Promise<ICustomerRepository> {
  const supabase = await createServerSupabaseClient();
  return new SupabaseCustomerAdapter(supabase);
}

/**
 * 建本次 request 的 IAddressRepository(SupabaseAddressAdapter + cookie-aware authenticated server client)。
 * g-5a 讀清單(listByCustomer);g-5b 接 addAddress 新增(create);編輯(update)/刪除(delete)/設預設留 g-5c。
 *
 * **鏡像 getCustomerRepo**:SupabaseAddressAdapter 在 @pcm/adapters root export(非 /server subpath、
 * eslint 放行無 -disable)、來源 client.ts 頂層 `import 'server-only'`、整條 chain 受 server-only 約束(本檔已 import)。
 * **不持 service_role**:authenticated client 走 RLS addresses_*_own(auth.uid()=customer_user_id 限自己 row、
 * GRANT 守欄)、ownership 靠 RLS row 守。
 */
export async function getAddressRepo(): Promise<IAddressRepository> {
  const supabase = await createServerSupabaseClient();
  return new SupabaseAddressAdapter(supabase);
}

/**
 * 建本次 request 的 IVehicleRepository(SupabaseVehicleAdapter + cookie-aware authenticated server client)。
 * g-6a 讀清單(listByCustomer);新增(create)g-6b、編輯(update)/刪除(delete)/設主車留 g-6c。
 *
 * **鏡像 getAddressRepo**:SupabaseVehicleAdapter 在 @pcm/adapters root export(非 /server subpath、
 * eslint 放行無 -disable)、來源 client.ts 頂層 `import 'server-only'`、整條 chain 受 server-only 約束(本檔已 import)。
 * **不持 service_role**:authenticated client 走 RLS vehicles_*_own(auth.uid()=customer_user_id 限自己 row、
 * GRANT 守欄)、ownership 靠 RLS row 守。
 */
export async function getVehicleRepo(): Promise<IVehicleRepository> {
  const supabase = await createServerSupabaseClient();
  return new SupabaseVehicleAdapter(supabase);
}

/**
 * 建本次 request 的 IOrderRepository(SupabaseOrderAdapter + cookie-aware authenticated server client)。
 * M-3-S2-b2:建單 server action 用(placeOrder → create_order RPC)。
 *
 * **鏡像 getAddressRepo**:SupabaseOrderAdapter 在 @pcm/adapters root export(非 /server subpath、
 * eslint 放行無 -disable)、來源 client.ts 頂層 `import 'server-only'`、整條 chain 受 server-only 約束(本檔已 import)。
 * **不持 service_role**:authenticated client 呼 create_order SECURITY DEFINER RPC(REVOKE PUBLIC + GRANT
 * authenticated、owner 承擔受控寫入)、價/運費/tier/歸屬全 RPC server 端 auth.uid() 重算、client 永不送價;
 * orders/order_items 對 authenticated 僅 SELECT、建單只能走 RPC。本檔永不注入 service_role(對齊 wallet 紀律)。
 */
export async function getOrderRepo(): Promise<IOrderRepository> {
  const supabase = await createServerSupabaseClient();
  return new SupabaseOrderAdapter(supabase);
}
