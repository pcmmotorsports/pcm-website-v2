// apps/storefront/src/lib/tier.ts
//
// server-side tier resolution helper(從 app/page.tsx L42-58 抽出)。
//
// 業務拍板(Sean 2026-05-20 M-1-13e-pre-1 Q1=B):
//   PCM 任何牽扯金額的頁面(商品頁 / 品牌頁 / 特價 / 購物車 / 結帳 / 訂單)
//   都應該 server-side 呼叫此 helper、依 tier 顯示對應價格。
//   tier-aware price strip 在 toUIProduct(lib/products.ts)完成、不傳其他 tier
//   價格至 client bundle(對齊 CLAUDE.md「經銷價絕不傳到一般會員瀏覽器」鐵則)。
//
// server-only:檔頭 `import 'server-only';` 編譯期擋 client bundle 引入;
//   對齊 @pcm/adapters/src/supabase/client.ts pattern、優於 lib/products.ts
//   runtime guard 慣例。

import 'server-only';

import { designTierToSchema } from '@pcm/domain';
import type { MemberTier } from '@pcm/domain';
import type { cookies } from 'next/headers';

/**
 * 解析訪客當前 MemberTier(server-side)、供金額相關頁面顯示 tier-dependent price。
 *
 * priority:
 *   1. ?tier= override(僅當 env flag `PCM_DEV_TIER_OVERRIDE=1` 時生效、production 預設關)
 *   2. cookie `pcm-tier`
 *   3. 預設 'general'
 *
 * corrupt cookie / 攻擊 URL → designTierToSchema throw → catch fallback 'general'。
 *
 * 🔴🔴 安全前置(2026-06-05 安全稽核 H-1、M-2-08 開工前必修、backlog #215):
 *   `pcm-tier` cookie 是 **client 可偽造**的(訪客自設 `document.cookie='pcm-tier=store'` 即被當經銷會員),
 *   本函式只驗「字面合法性」(general|store|premium_store)、**不向 DB customers.tier 查證身分**。
 *   → 目前**無洩漏**:read 路徑走 products_public view(物理排除 price_store)+ mapper store/premiumStore 恆 dummy 0,
 *     偽造 tier 最多看到「店價 NT$0」破圖、看不到真經銷價。
 *   → **但 M-2-08 接真 tier-aware pricing(讀真 price_store)前,tier 必改為 server 端 `getUser()` 後查 customers.tier、
 *     未登入恆 general;若沿用此 cookie 為唯一 tier 來源,一般會員偽造 cookie 即可取得真經銷價 = 違反專案最高安全鐵則(升 CRITICAL)。**
 *   → 本次稽核**只釘樁防遺忘、未改行為**(Sean 拍 Q3=A);真正的認證化留 M-2-08(鐵則 8+12 → plan + codex 雙關卡)。
 *
 * @param searchParams 已 await 過的 URL searchParams 物件(server component 從 `await searchParams` 取得)
 * @param cookieStore  已 await 過的 next/headers cookies()(server component 從 `await cookies()` 取得)
 */
export async function resolveTierFromRequest(
  searchParams: Record<string, string | string[] | undefined>,
  cookieStore: Awaited<ReturnType<typeof cookies>>,
): Promise<MemberTier> {
  const tierOverride =
    process.env.PCM_DEV_TIER_OVERRIDE === '1' && typeof searchParams.tier === 'string'
      ? searchParams.tier
      : undefined;
  // 🔴 H-1(#215):cookie pcm-tier 為 client 可偽造、非身分權威。M-2-08 接真經銷價前須改為
  //   server 端認證查 customers.tier(見上方 JSDoc 安全前置)。本行現狀未改、只釘樁。
  const rawTier = tierOverride ?? cookieStore.get('pcm-tier')?.value ?? 'general';

  try {
    return designTierToSchema(rawTier);
  } catch {
    return 'general';
  }
}
