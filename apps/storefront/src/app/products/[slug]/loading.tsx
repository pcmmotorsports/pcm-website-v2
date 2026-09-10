// /products/[slug] 的載入畫面。
//
// 🔴 **它存在的唯一理由是【擋住上一層】** —— App Router 的 `loading.tsx` 會套用到該段
//    **與其下所有巢狀路由**,所以在本檔出現之前,`app/products/loading.tsx`(型錄骨架)
//    就是商品詳情頁的載入畫面。而那份骨架帶著 `<main className="pp-main">` 與
//    `<h1 className="pp-title">全部商品</h1>`。
//    ⇒ 📌 於是 PDP 的**原始 HTML** 同時存在兩個 `<main>` 與兩個 `<h1>`,
//      而多出來的那個 h1 逐字是「全部商品」—— 一個商品頁對搜尋引擎宣告自己叫「全部商品」。
//    量到的(正式站 `/products/samco-hus-9` 的 `curl` 原始 HTML,2026-09-10):
//      `<main` ⇒ 2 · `<h1` ⇒ 2(`pp-title 全部商品` 與 `pd-title 防爆水管 3件組`)
//      🟢 正對照:同一份 `<h2` ⇒ 9 ⇒ 尺是活的。
//
// 🔴🔴 **驗這件事一定要量【原始 HTML(`curl`)】,不能量瀏覽器** ——
//    瀏覽器那份在 hydration 之後 fallback 已經被換掉、現在就已經是 1 個,
//    **用它驗會永遠是綠的,不管修沒修。**
//
// 🔵 **形狀 = Sean 2026-09-10 拍【乙:只放一個轉圈圈】** —— 不畫商品頁的骨架。
//    理由是他拍的,不是我推的:骨架要嘛猜錯版面、要嘛就是再抄一份 PDP 的殼。
//    ⇒ 所以本檔**刻意沒有** `<main>`、**刻意沒有** `<h1>`:那正是它要修的兩樣東西。
//    ⚠️ 下一個想在這裡「順手加個標題比較好看」的人:那會把這一片整個退回去。
//
// 🔵 `<Header>` 留著,與 `app/products/loading.tsx` 同款:PDP 自己也畫 Header
//    (`ProductPage.tsx:272`),不畫的話導航當下整條頁首會閃掉再長回來。
//    🟢 而 Header 本身 `<main` 與 `<h1` 命中皆為 0,不會把剛修掉的東西帶回來。

import { Header } from '@/components/Header';

export default function ProductDetailLoading() {
  return (
    <>
      <Header currentPage="catalog" />
      {/* role="status" + aria-busy 讓報讀器知道「在等」而不是「空的」;
          轉圈本身 aria-hidden,它是裝飾,話由 aria-label 講。 */}
      <div
        className="pd-route-loading"
        role="status"
        aria-label="正在載入商品"
        aria-busy="true"
      >
        <span className="pd-route-loading-spinner" aria-hidden="true" />
      </div>
    </>
  );
}
