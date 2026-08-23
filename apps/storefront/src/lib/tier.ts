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

import { designTierToSchema, toMemberTier } from '@pcm/domain';
import type { MemberTier } from '@pcm/domain';
import { getVerifiedUser, isNoSessionError } from '@/lib/auth/verified-user';

// ── `toMemberTier`:把 DB 讀出來的 `customers.tier` 收斂成 `MemberTier`,認不得回 `null` ──
//
// 🔴 **2026-08-24:本檔原本有一支同義的私有 `toSchemaTier`,已刪,改用 domain 那支。**
//    canonical = `packages/domain/src/shared/utils.ts` 的 `toMemberTier`。
//    合併前跑過**差分檢查**:19 個輸入(三個合法值 / 大小寫變體 / snake_case / null / undefined /
//    0 / NaN / 物件 / 陣列 / `new String('store')` / 尾空白…)兩支**逐一同值,0 差異**;
//    負對照(把其中一支故意改成回 `'general'`)⇒ 16 筆不同 ⇒ **那把尺不是死的**。
//    📌 為什麼要合併:兩份同義實作並存時,**DB enum 加一個值只會有一邊被改到**,
//       而另一邊會安靜地把那位會員降級 —— 合併之後「只有一份」這件事本身就是守門。
//    ⚠️ 而原本擋著不合併的理由只活在 `toMemberTier` 的檔頭註解裡
//       (逐字:「那支檔當下正被 `#215` 那條線改著」)⇒ 沒有人會回來讀 ⇒ 差點被忘記。
//
// ⚠️ **留著兩句原本寫在這裡、而它們與合併無關的知識**:
//  · 🔴 **不可以拿 `designTierToSchema` 驗這個值** —— 那支只認 design 的 snake_case 字面,
//    餵 `'premiumStore'` 會 **throw**(`packages/domain/src/shared/utils.ts` 的 `default:` 分支逐字)。
//  · `checkout/page.tsx` 對同一個值用的是**裸 cast**(`customerRow.tier as MemberTier`)。
//    那是既有寫法,本檔不動它;但**新的路不沿用裸 cast** —— DB 加一個 enum 值時,
//    裸 cast 會安靜地讓一個 TS 不認得的字串流進 tier,而這裡會退成 general。

/**
 * 🔴 `#215` / H-1 的認證化那一半:**依登入身分查 `customers.tier`**,不看任何 client 送的東西。
 *
 * - **未登入 ⇒ 直接回 `'general'`,而且【不查 `customers`】**。
 *   ⚠️ 「不查」是個否定宣稱 ⇒ 它的可觀測形態 = 對 supabase client 掛 spy,
 *      斷言 `from('customers')` 呼叫次數為 0(見 `tier.test.ts`)。
 * - **查不到 row / RLS 異常 ⇒ 退成 `'general'`**(對齊 `checkout/page.tsx` 的 PGRST116 退化;
 *   那支檔頭逐字寫「customers row missing(PGRST116、極罕)/ RLS 異常 → tier='general'」)。
 * - 🔴 **退化方向只准往下** —— 任何不確定都回 `'general'`,不得回經銷 tier。
 */
export async function resolveAuthenticatedTier(): Promise<MemberTier> {
  // 🔴 **兩種失敗要分開,而處置【相同】—— 分的是【留下什麼痕】,不是回什麼值**(codex M3)。
  //    ① 「認證說你沒登入」= 正常路徑 ⇒ 回 general,**不記錄**(那是每個訪客的日常)。
  //    ② 「這條路壞了」(factory throw / 網路 / 非 Auth 例外)= 故障 ⇒ 回 general,**但一定 console.error**。
  //    ⚠️ 為什麼不讓 ② 往上拋:本函式在 `page.tsx` 是**首頁 render 路徑上的第一個 await**
  //       ⇒ 讓它 reject = 我在本片【新增】一個「Supabase 一抖首頁就 500」的失敗點,而改之前沒有。
  //    🔴 而「靜靜降級」正是 codex 點名的另一種病 ⇒ 用**日誌**把它與 ① 分開:
  //       故障時螢幕上看不出來,但 log 裡兩個世界印不同的東西。
  //    🔴 降級方向只准往下(→ general)。任何不確定都**不得**回經銷 tier。
  try {
    const { supabase, user, error: authError } = await getVerifiedUser();
    // 🔴 **codex R5 must-fix 1**:`user` 有值 **而且** `error` 有值,是一個沒有人想過的世界
    //    (`getUser()` 可以回一個**被錯誤污染**的 user,例如 `AuthRetryableFetchError`)。
    //    舊寫法先問 `!user` ⇒ 那種 user 會被當成**已驗證**、拿去查 tier、回 `store`。
    //    ⇒ **「認證不確定」這件事要先判,而且不看 `user` 有沒有值。**
    //    📌 判準照本檔既有的那句:**任何不確定都回 `general`,不得回經銷 tier。**
    if (authError && !isNoSessionError(authError)) {
      console.error('[lib/tier] getUser 回報非「未登入」的錯誤、退化 general:', authError);
      return 'general';
    }
    if (!user) {
      // ✅ 走到這裡代表 `authError` 要嘛不存在、要嘛就是「未登入」那一種(上面已擋掉其餘)。
      // 🔴 **codex R2 M1**:我原本在這裡對「有 authError」一律記 error log ——
      //    而**未登入的正常形狀就是「user=null + AuthSessionMissingError」**
      //    ⇒ 每一個訪客都會被記成故障,而**那正好廢掉我用來分辨訪客與故障的那個機制本身**。
      //    📏 這一格是從安裝的 `@supabase/auth-js` 原始碼讀到的,不是推的(出處見 verified-user.ts)。
      //    ⚠️ 而抓到它的是審查者:**我的 fixture 餵的是我以為的形狀,兩個世界是我 mock 出來的。**
      return 'general'; // ① 正常的訪客(不留 log)
    }

    const { data, error } = await supabase
      .from('customers')
      .select('tier')
      .eq('user_id', user.id)
      .single();
    if (error) {
      console.error('[lib/tier] customers.tier 讀取失敗、退化 general:', error);
      return 'general';
    }
    const tier = toMemberTier(data?.tier);
    if (tier === null) {
      // 🔴 codex R2 nit:原本這裡是**靜默**退 general —— 而 enum 漂移/版本落後會
      //    **無聲把一個經銷會員降級**。降級方向是對的,但它不該安靜。
      console.error('[lib/tier] customers.tier 是本版不認得的值、退化 general:', data?.tier);
      return 'general';
    }
    return tier;
  } catch (unexpected) {
    // ② 這一支是**故障**,不是訪客 —— 它是本片唯一「螢幕上看不出來」的路,所以日誌是它的可觀測形態。
    console.error('[lib/tier] tier 解析路徑異常、退化 general(首頁不因此 500):', unexpected);
    return 'general';
  }
}

/**
 * 解析訪客當前 MemberTier(server-side)、供金額相關頁面顯示 tier-dependent price。
 *
 * priority(**2026-08-23 `#215` 之後**):
 *   1. `?tier=` override(僅 dev:`NODE_ENV≠production` 且 env flag `PCM_DEV_TIER_OVERRIDE=1` 時生效;production 硬擋、與 flag 無關)
 *   2. **登入身分 → `customers.tier`**(`resolveAuthenticatedTier()`;未登入不查 DB)
 *   3. 預設 `'general'`
 *   ~~2. cookie `pcm-tier`~~ **已移除**(留痕不刪,理由見下)。
 *
 * 攻擊 URL(`?tier=xyz`)→ `designTierToSchema` throw → catch fallback `'general'`。
 *
 * ─── ✅ **`#215` / H-1 已於 2026-08-23 完成(B 窗)。以下整段描述的是【已經修掉的舊行為】** ───
 * 🔴 **留痕不刪的理由**:下一個讀這裡的人多半是來做安全審查的 ——
 *    他需要知道這條路曾經長什麼樣、以及它為什麼不再是那樣。
 *
 * ~~🔴🔴 安全前置(2026-06-05 安全稽核 H-1、M-2-08 開工前必修、backlog #215):
 *   `pcm-tier` cookie 是 client 可偽造的(訪客自設 `document.cookie='pcm-tier=store'` 即被當經銷會員),
 *   本函式只驗「字面合法性」、不向 DB customers.tier 查證身分。
 *   → 目前無洩漏:read 路徑走 products_public view + mapper store/premiumStore 恆 dummy 0。
 *   → 但 M-2-08 接真 tier-aware pricing 前,tier 必改為 server 端 getUser() 後查 customers.tier。
 *   → 本次稽核只釘樁防遺忘、未改行為(Sean 拍 Q3=A);真正的認證化留 M-2-08。~~
 *
 * **現況(取代上面那整段)**:tier 只來自 `resolveAuthenticatedTier()`,未登入恆 `'general'`;
 * cookie 那條路整項移除,函式不再收 `cookieStore` 參數。
 * 🔴 **而修的時候量到兩件,寫下來免得被誤讀**:
 *   ① `pcm-tier` 在 **production 原始碼零 writer、零 reader**
 *      (數法:`grep -rn "pcm-tier" apps/storefront/src packages --include="*.ts" --include="*.tsx"`
 *       ⇒ 命中全部落在**註解、測試、backlog 與安全文件**;⚠️ **這是字面掃描**,
 *       有人用變數組出那個字串掃不到,而我沒有第二套字集掃過這一題)。
 *   ② 修的當下,偽造它其實**拿不到任何經銷價** —— 每一個 production `toUIProduct(...)` 都寫死 `'general'`。
 *      ⇒ 本片是**接真經銷價那片的前置**,不是止血。**別把它讀成「當時正在洩漏」。**
 * 📌 同片退場:`scripts/storefront-tier-cookie-writer-guard.test.ts` 依它自己檔頭的
 *    【退場拍板】刪除(cookie 路徑整個移除之日 ⇒ 格1 紅 = 本檔大聲退場)。**已實跑確認它真的紅過再刪。**
 *
 * @param searchParams 已 await 過的 URL searchParams 物件(server component 從 `await searchParams` 取得)
 */
export async function resolveTierFromRequest(
  searchParams: Record<string, string | string[] | undefined>,
): Promise<MemberTier> {
  // 🔴 prod 硬閘(權限鐵則 12②;形狀抄 admin proxy.ts:18 / authorize.ts:18 的 ADMIN_DEV_BYPASS):
  //   `NODE_ENV=production` 時 override 恆失效,與 `PCM_DEV_TIER_OVERRIDE` 是否設【無關】——
  //   否則該 env 一旦在正式站被設成 '1',任何人加 `?tier=store` 即可覆蓋會員等級。
  //   ⚠️ ~~這與下面 #215 的 cookie 釘樁是兩件事……cookie 的認證化仍【未做】、仍等 M-2-08。~~
  //      **2026-08-23 更正**:認證化**已完成**。這道硬閘與它仍是兩件事 ——
  //      硬閘擋的是 `?tier=` 這條 dev 捷徑,`#215` 處理的是身分來源。**兩者都在,互不取代。**
  const tierOverride =
    process.env.NODE_ENV !== 'production' &&
    process.env.PCM_DEV_TIER_OVERRIDE === '1' &&
    typeof searchParams.tier === 'string'
      ? searchParams.tier
      : undefined;
  // ✅ `#215`:cookie 那條路【整項拿掉】,不是加驗證(分母與限度見上方 JSDoc)。
  if (tierOverride !== undefined) {
    try {
      return designTierToSchema(tierOverride);
    } catch {
      return 'general';
    }
  }
  return resolveAuthenticatedTier();
}
