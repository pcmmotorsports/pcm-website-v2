// brand-availability.ts — 品牌「有沒有商品」讀不到時,客人看到的那一句。
//
// 🔴 **為什麼這一句住在自己的檔裡,而不是住在 `lib/brand-products.ts`** —— 這是量到的,不是設計潔癖:
//    那支檔的下游 `lib/products.ts` 有 `import 'server-only'` ⇒ 元件測試在 jsdom 下 import 它會炸
//    (實測訊息 `This module cannot be imported from a Client Component module.`)。
//    ⇒ 常數放在那裡的話,元件那幾條測試會**紅在 import 而不是紅在斷言** = 尺沒接上被測的東西;
//      而繞過去的寫法(測試裡直接比字面)會讓斷言與文案各有一個作者、**改文案時安靜地變假綠**。
//    📌 這件事是【先寫測試】才撞到的:先寫實作的話,常數會理所當然地放進 brand-products.ts。
//
// 🔴 **一個作者**:server 側(`lib/brand-products.ts`)與 client 側(三支品牌元件)共用這一份。
//    形狀抄 `contexts/FavoritesContext.tsx` 的 `LOAD_FAILED_MESSAGE`(`MAIN-035 ①-1`【必修】),
//    那裡逐字寫著同一句判別句:「『讀不到』與『沒有收藏』必須是兩個畫面」。
//
// ⚠️ 這一句**不含**技術細節(錯誤訊息 / 表名 / RPC 名)。細節留 console,畫面只講人話 ——
//    同 FavoritesContext 那支被 codex 對抗審查 must-fix 5 抓過的形狀。

/**
 * ✅ **定稿**(Sean 2026-08-27 回 `q13: 甲`,主視窗 `-84` 轉;逐字採用提案原句)。
 *
 * 改文案**只改這兩個常數** —— 測試吃常數不吃字面,三支元件也只 import 它,
 * 所以這裡改一個字,其他六支檔一行都不用動。
 */
export const BRAND_AVAILABILITY_UNREADABLE = '品牌商品狀態讀取失敗';

/** 副行,同上。 */
export const BRAND_AVAILABILITY_UNREADABLE_SUB =
  '以下品牌暫時無法確認是否有商品,請重新整理再試一次';
