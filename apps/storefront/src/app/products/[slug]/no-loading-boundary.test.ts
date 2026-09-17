// 商品詳情頁【不得】有載入邊界 —— 這一格守的是 HTTP 狀態碼,不是畫面。
//
// 🔴 **為什麼(2026-09-17)**:`app/products/[slug]/loading.tsx` 曾經存在,而它會讓
//    App Router 把該段包進 Suspense ⇒ 回應**邊算邊送** ⇒ **HTTP 狀態列在第一個位元組
//    就送出去了** ⇒ `page.tsx` 的 `notFound()` 之後只換得掉畫面、換不掉已送出的 `200`。
//    ⇒ `/products/<不存在的 handle>` 對 Google 是「這一頁存在而且有內容」= **soft-404**,
//      而正式庫當時有 **1,089 件已下架商品**全部長這樣 —— 那個數字的出處(2026-09-17 唯讀實查):
//      `SELECT count(*) FILTER (WHERE delisted_at IS NOT NULL) FROM public.products;` ⇒ 1089 / 全站 26491,
//      經 `bash scripts/readonly-prod-sql.sh`。而它們對客人查無的原因是 RLS:
//      `products_select_public` 的條件逐字是 `(delisted_at IS NULL)`(同一發查 `pg_policy` 得到)。
//
// 🔵 **對照組(實測,不是推的)**:`/brands/[slug]` 同樣叫 `notFound()`、**沒有**
//    `loading.tsx` ⇒ 回**真的 404**;`/products/[slug]` 有 ⇒ 回 `200`。
//    同一支 `notFound()`,差別只有那一個檔。
//
// ══ 🔴 **拍板紀錄 —— 拿 `loading.tsx` 去 blame 的人一定會先撞到這裡** ══════════
//   被刪掉的 `app/products/[slug]/loading.tsx` 檔頭寫著:
//     「🔵 **形狀 = Sean 2026-09-10 拍【乙:只放一個轉圈圈】**」
//   ⇒ 🛑 **看到那一條不要以為我們違反了它。**
//   ✅ **Sean 2026-09-17 知情之後改判,逐字「依照建議」⇒ 甲 = 那顆轉圈圈可以拿掉。**
//      他看到的代價原樣是:**站內點商品卡會完全沒反應**(全站 0 個 `useLinkStatus`)、
//      **從 Google 點進來白畫面變長**(`page.tsx` 循序 `await` 六段、0 個 `<Suspense>`),
//      量級與 `/brands/` 現在一樣。
//   📌 **那是【推翻他自己 09-10 的乙】,不是我們漏看** —— 而他是看過完整代價才改的。
//
// 🛑 **這一格不驗畫面,也驗不到狀態碼**(jsdom 沒有伺服器)——
//    它驗的是**那個會讓狀態碼壞掉的檔案不存在**。真的狀態碼要靠
//    `docs/plans/2026-09-17-products-soft-404-plan.md` §4 那四發 curl。
//    📌 **一道只能守到結構的閘,要講清楚它守不到什麼**,否則下一個人會以為狀態碼被測過了。
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SLUG_DIR = dirname(fileURLToPath(import.meta.url));
const PRODUCTS_DIR = dirname(SLUG_DIR);

describe('商品詳情頁沒有載入邊界', () => {
  // 🔴 `[slug]` 自己那一層
  it('`app/products/[slug]/loading.tsx` 不存在', () => {
    expect(
      existsSync(join(SLUG_DIR, 'loading.tsx')),
      'loading.tsx 又回來了 ⇒ 詳情頁會重新開 Suspense ⇒ 不存在的商品又會回 200',
    ).toBe(false);
  });

  // 🔴 上一層 —— App Router 的 `loading.tsx` 會往下套到所有巢狀路由,
  //    所以只刪 `[slug]` 那支不夠,`app/products/loading.tsx` 一樣會補位。
  it('`app/products/loading.tsx` 不存在(它會往下套到詳情頁)', () => {
    expect(
      existsSync(join(PRODUCTS_DIR, 'loading.tsx')),
      '型錄的骨架又搬回 products/ 了 ⇒ 它會套到 [slug] ⇒ 狀態碼再壞一次;要放就放進 (catalog)/',
    ).toBe(false);
  });

  // 🔴 再上一層 —— 同一句「會往下套到所有巢狀路由」對 `app/loading.tsx` 一樣成立。
  //    今天它不存在(R1 審查 C2 指出這一層沒守)⇒ 這一格是**先擋住**,不是在修 bug。
  it('`app/loading.tsx` 不存在(它會往下套到全站每一頁)', () => {
    expect(
      existsSync(join(PRODUCTS_DIR, '..', 'loading.tsx')),
      '根目錄長出 loading.tsx ⇒ 它會套到【全站】每一個路由 ⇒ 所有 notFound() 都會回 200',
    ).toBe(false);
  });

  // 🔵 **正對照**:沒有它,上面三格在「我把路徑拼錯了」的時候會【自動全綠】。
  it('正對照:型錄自己的骨架【還在】route group 裡', () => {
    expect(
      existsSync(join(PRODUCTS_DIR, '(catalog)', 'loading.tsx')),
      '型錄的骨架不見了 ⇒ 要嘛被誤刪, 要嘛這支測試的路徑算錯了(那上面兩格就是假綠)',
    ).toBe(true);
  });
});
