import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';
import { SupabaseCouponAdapter } from '@pcm/adapters';

/**
 * 後台券 repo 建構(M-4b 券片 2b-2a;**server-only、絕不入 client bundle**)。
 *
 * 形狀對齊 `apps/admin/src/lib/customers/customer-repository.ts` —— 那支也是這樣的一層薄 wiring,
 * 真正的查詢在 adapter 裡。
 *
 * 🔴 **為什麼是 `service_role`**:片1 把 `coupons` / `coupon_redemptions` **REVOKE 到零表權限**,
 *    而讀取唯一路是那支 view(`admin_coupon_list_blocks_v`),它**只 GRANT 給 `service_role`**。
 *    ⇒ 而那支 view 走 **owner 權限**(刻意不用 `security_invoker`,理由在
 *      `supabase/migrations/20260829170000_...:§2`)——
 *      照抄鄰居的 `security_invoker = true` 會 `permission denied`、整頁打不開。
 *
 * 🔴 `server-only`:本檔頂層 `import 'server-only'` + `createSupabaseServiceClient` 亦 server-only,
 *    client component import 即**編譯期報錯**;service_role 金鑰只在 server runtime 讀,
 *    不進 client bundle / git。
 *
 * 🛑 **本 repo 只讀。** 券的寫入唯一路是之後那幾片的 SECURITY DEFINER RPC ——
 *    這裡**沒有**任何寫入 getter,而那不是漏做:現在給一個,下一個人就會用它繞過稽核。
 *
 * ⚠️ **那兩支 view 目前【還沒 apply】**(檔頭寫著「現在不要 apply」,要 Sean 自己撤)
 *    ⇒ 本檔在真後台會拿到「關聯不存在」的錯誤,**而那是預期的**,不是接線錯。
 *    ⇒ 真資料驗收要等他貼。
 *
 * (未在 vitest 覆蓋:本檔 `import 'server-only'`〔node/測試環境會 throw〕;
 *  純 wiring、行為由 `SupabaseCouponAdapter.test.ts` 的 11 格 + 頁面實測驗。)
 */
export function getAdminCouponRepository(): SupabaseCouponAdapter {
  return new SupabaseCouponAdapter(createSupabaseServiceClient());
}
