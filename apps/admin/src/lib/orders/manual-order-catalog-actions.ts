'use server';

// manual-order-catalog-actions.ts — 片1(⟦b4-SKULOOKUP⟧):把【已經寫好但沒有人用】的
// 目錄搜尋接上一個 server action,讓前端有東西可以呼叫。
//
// 🔴 **本片【只做後端】** —— 前端那一格卡在 Q0(鐵則 1 掃過 12 個 OD 專案 ⇒ 這個畫面**沒有設計稿**)。
//    ⇒ 所以這支今天落地之後仍然**沒有呼叫端**,而那是刻意的、寫在 plan 裡的。
//    📎 `docs/plans/2026-08-31-manual-order-sku-lookup-plan.md`
//
// 🔵 **經銷價(`price_store`)【在】回傳裡** —— `ManualOrderCatalogHit.dealerPriceUntaxed`。
//    Sean 2026-08-31 拍板(⟦b4-SKULOOKUP⟧ Q2,逐字「甲 標未稅」)。
//    🛑 **這一段刻意【不保留】先前那句禁令的原字面**(codex R2 must-fix ②):
//       原始碼裡的 `~~刪除線~~` **沒有語意** —— 搜尋式的安全審查會命中那句過期禁令,
//       而它讀起來像現行規則。⇒ **安全相關的註解只留現行規則;歷史去 git log 與決策檔。**
//       📌 而這與本 repo「舊字面留著讓人搜得到」那條慣例**方向相反**, 那不是矛盾:
//          那條慣例服務的是「**搜舊句的人要撞到訂正**」;而**一句禁令被搜到時, 讀的人會直接照做。**
//          ⇒ 兩者的差別在【讀者拿它去做什麼】。
// 🔴🔴 **而安全警告本身仍然成立, 它不隨拍板消失**:
//    Server 端鐵則逐字「經銷價絕不傳到一般會員瀏覽器」。這裡是後台、員工看得到是對的;
//    而它**會進 Server Action 的回應與瀏覽器記憶體**(⛔ ~~⚠️ 今天零呼叫端 ⇒ **還沒有**進任何頁面,
//    見下面那段「沒有呼叫端」;接上 UI 的那一天才會~~)。
//    🔴🔴 **2026-09-03 訂正(線 `-account` 量,主視窗 `-87` 裁准)—— 已接上 ⇒ 上面那句是【現在式】:**
//       `apps/admin/src/components/orders/manual-order-catalog-lookup.tsx:4` 逐字
//       `import { searchManualOrderCatalogAction } from '@/lib/...'`;同支 `:135` 逐字畫
//       ``經銷 {money(h.dealerPriceUntaxed)}(未稅)`` ⇒ **經銷價現在真的會進瀏覽器。**
//    🟢 **保護在**(照抄查到的,不放寬):`apps/admin/src/lib/session/session.ts:175` 逐字
//       `process.env.ADMIN_REQUIRE_REAL_IDENTITY === '1'`;`apps/admin/src/lib/session/actor.ts:25`
//       逐字「**2026-08-25 起(含今天)** `ADMIN_REQUIRE_REAL_IDENTITY` 已被設為 `1`」。
//    🛑 **而【正式站上那顆 env 現在是不是 `1`】沒有人在本次驗過** —— 我讀的是**碼與註解**,
//       不是部署環境。**不要讀成「有人查過了」。**(該格已交主視窗 `-87` 用 Vercel API 查。)
//    ⇒ 誰拿得到那個後台頁面由 `ADMIN_REQUIRE_REAL_IDENTITY` 那道閘決定, **不是這一支檔**。
//    📌 **⇒ 拍板改變的是「要不要送」, 沒有改變「送了會被誰看到」。兩件事不要合成一句。**
// ⚠️ 而 `price_store` 是**未稅**、`price_general` 是**含稅** ——
//    呼叫端顯示時**兩邊都要標稅基**(Sean 選甲的整個前提就是那個標籤)。
//
// 🔴 **為什麼要包一層,而不是讓前端直接 import `searchManualOrderCatalog`**:
//    那支走 `createSupabaseServiceClient()`(service_role)⇒ **它必須留在 server**。
//    而 server action 是這個 repo 既有的那條路(`manual-order-actions.ts` 同款)。
//
// 🔴🔴 **codex R1 must-fix:`authorizeAdminMutation()` 拒絕時【回 `null`】, 它不拋錯。**
//    我第一版寫 `await authorizeAdminMutation();` 就往下走 ⇒ **未授權的人照樣查得到 DB**。
//    📌 而我的測試是綠的 —— 因為我把它 mock 成 `mockRejectedValue` ⇒
//       **那個 mock 編碼的是【我以為的合約】, 不是它真正的合約。**
//    ⇒ ⇒ 今天第四次同族:替身照著我的假設長, 於是兩個世界都印綠。
//    ✅ 既有呼叫端的做法在 `manual-order-actions.ts:86-88`(`if (!authorization) …`)—— 照它。
//
// 🔴 **授權用 `authorizeAdminMutation`,而它的名字裡有 `Mutation`** ——
//    本 action 是**讀**不是寫,名字對不上。而我仍然用它,理由:
//      · server action 是 POST ⇒ 需要的正是它做的三件(session 票證 / Origin fail-closed / 具名 actor)
//      · 這個 repo **沒有**讀取版的授權 helper(`authorize.ts` 只匯出兩支,都是 Mutation)
//    ⚠️ ⇒ **名字與用途對不上這件事寫在這裡**,不要讓下一個人以為「讀不必授權」。

import { authorizeAdminMutation } from '../session/authorize';
import { searchManualOrderCatalog, type ManualOrderCatalogHit } from './manual-order-catalog';

/**
 * 🔴 三態,而**「查無」與「查詢失敗」必須分得開**。
 *    那是 `manual-order-catalog.ts:135-139` 逐字要求的:
 *    「出錯【不得】回空陣列 —— 那會把『查詢失敗』顯示成『查無此料號』,
 *      而前者他該找人,後者他該改關鍵字。」
 *    ⇒ 這一層若把 catch 轉成 `[]`,那句話就被繞過了 ⇒ 用 `ok` 欄把兩者釘開。
 */
export type ManualOrderCatalogResult =
  | { ok: true; hits: ManualOrderCatalogHit[] }
  // 🔴 `denied` 與 `error` **分開** —— 兩者員工的下一步不同:
  //    前者他該去登入 / 找人開權限;後者他該找工程。合成一句話會讓他做錯事。
  | { ok: false; reason: 'denied' | 'error'; message: string };

export async function searchManualOrderCatalogAction(
  keyword: string,
): Promise<ManualOrderCatalogResult> {
  // 🔴 授權在最前面 —— 未授權時**不得**先打 DB(那會讓一個沒有票的人也能量到「這個料號存不存在」)。
  //    🛑 而它**回 `null` 不拋錯** ⇒ 一定要接回傳值。忽略它 = 這道閘不存在。
  const authorization = await authorizeAdminMutation();
  if (!authorization) {
    return { ok: false, reason: 'denied', message: '沒有權限查商品,請重新登入或找人開權限。' };
  }

  try {
    return { ok: true, hits: await searchManualOrderCatalog(keyword) };
  } catch (thrown) {
    // 🔴 **不把原始訊息丟回瀏覽器** —— 它可能含連線字串 / 表名 / PostgREST 內部細節。
    //    而員工需要的是「這不是你的問題,去找人」這一句。
    return { ok: false, reason: 'error', message: '商品查詢失敗,請通知維護。這不是料號打錯。' };
  }
}
