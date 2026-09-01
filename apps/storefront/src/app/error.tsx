'use client';

// app/error.tsx — 全站 500 錯誤邊界(Sean 2026-09-01 拍甲「錯誤頁現在做」)
//
// 字面從 design-reference/components/ErrorPage.jsx 直接搬(500 變體、type=500:
// num/eyebrow/title/desc 逐字、showSupport=true ⇒ 渲染 err-support 段)。
// 🔴 design 讀自【主樹】/Users/sean_1/pcm-website-v2/design-reference/ ——
//    本 worktree 的 design-reference/ 是【空的】(submodule 未在 worktree 初始化)
//    ⇒ 在這棵樹 grep design 會拿到 0,而那個 0 是「檔不在」不是「稿裡沒有」。
//
// design harness 轉譯(對齊 not-found.tsx 既有慣例、非視覺偏離):
//   - onNav('home') / onNav('catalog') button → <Link href="/"> / <Link href="/products">
//   - onNav('stores') → <Link href="/stores">(該路由實存:app/stores/page.tsx)
//   - <Header currentPage="error" onNav> → <Header currentPage="error" />
//   - <Footer onNav> → <HomeFooter />
//   - data-screen-label 保留
// CSS = styles/error.css,layout.tsx:59 已全域 import(404 那片帶進來的)⇒ 本片不動 CSS。
//
// 🔴 **這一頁不印 error.message,也不印 digest。**
//    理由:repo 既有做法是「先過中文對照表、不洩漏原始 error」(login/actions.ts:29-38 的
//    authErrorCopy)。而 error boundary 拿到的是一個沒有 domain code 的 Error
//    ⇒ 沒有表可以對 ⇒ 那就只給 design 寫好的那一句中文,不給第二種東西。
//
// 🛑 **兩件刻意【沒做】,不是漏(已請主視窗端給 Sean)**:
//   ① design 的 500 只有「回首頁 / 商品目錄」兩顆鈕,**沒有重試鈕**。
//      Next 會傳 `reset()` 進來,而加一顆鈕 = 動視覺 ⇒ 照鐵則 1 不自行加。
//      ⇒ 所以本檔【不收 props】,`reset` 沒有被用到。
//   ② design 的 err-support 有一個 mailto:service@pcm-motorsports.com ⇒ **本片不放它與它的分隔點**,
//      只留「持續發生?聯絡客服」那一條(它指到實存的 /stores)。
//      ⛔ ~~理由:那個字面 repo 0 次 ⇒ 沒有人驗過那個信箱活著~~
//      ✅ **真正的理由更硬(code-reviewer R1 抓到、R2 訂正我的數字、本窗重量)**:
//         ⛔ ~~apps+packages 命中 166 檔 vs 2 檔~~ —— 🔴 **那一發把 `.next` 建置產物算進去了**
//            (含 `.next` 今天是 168 vs 2, 而 168−2 那個差就是本檔自己 + 它的 build map
//             ⇒ 我量到的是【寫下這段註解之前】的世界)。
//         ✅ **範圍寫清楚的版本**(排除 `.next` / `node_modules` / `dist`, 2026-09-01 18:3x 實跑):
//            `pcmmotorsports.com`(**無**連字號)⇒ **33 檔**
//            `pcm-motorsports.com`(**有**連字號)⇒ **1 檔, 而那一檔就是這段註解自己**
//            ⇒ ⇒ **真正在用它的地方 = 0。33 vs 0 比 166 vs 2 銳利, 而結論沒有變。**
//      ⚠️ **而「稿上那個是拼錯 / 佔位」是【推出來的】不是量到的**(code-reviewer N6):
//         grep 只答得出「repo 裡沒有人用它」——
//         它到底是打錯字, 還是 PCM 真的持有的第二個網域, **沒有任何一發檢查碰得到。**
//      ⇒ 而活的單一事實在 `lib/site-config.ts:26 CONTACT_EMAIL='sean@pcmmotorsports.com'`
//        (隱私政策 / 出貨單抬頭 / org-jsonld 都在吃它)。
//      🎯 **⇒ 所以要端給 Sean 的題目是「要不要接既有的 CONTACT_EMAIL」, 不是「要不要放一個死信箱」。**
//
// ⚠️ **這一頁接不到的東西 —— 兩個, 而【第二個比第一個大】(code-reviewer 2026-09-01 補;
//   我第一版只寫了 route handler 那個, 而那份清單讀起來像窮舉)**:
//   ① route handler 的 throw 走不到 error boundary(例 api/auth/line/start/route.ts)。
//   ② 🔴 **全站沒有 `global-error.tsx`** —— **layout 自己 throw, 這一頁【結構上】接不到**
//      ⇒ 客人仍看到 Next 內建黑底白字英文頁 = **這一片存在的理由, 在那條路上還沒有被解掉。**
//      ⚠️ **而【架構上接不到】與【今天正在發生】是兩件事, 不要混讀**(code-reviewer N5):
//         `layout.tsx:105-135` 那段 `getUser()` 與 URL 解析**都已經在 try/catch 裡** ——
//         ⇒ **今天最可能的那個 throw 來源已經被接住了。缺口是真的, 而它今天不常踩。**
//   ③ 🔴 **這一頁自己 render 那個【可能剛炸掉的元件】**(code-reviewer N2):
//      `layout.tsx` **不 render Header**(它只到 `CartProvider`), 是 16 支頁面各自 render 的;
//      而本檔也 render 它 ⇒ 若 `Header` / `HomeFooter` / `useCart` 是那個 throw 的來源,
//      **error boundary 接住之後會再 render 一次 ⇒ 再 throw ⇒ 上面沒有 boundary**
//      ⇒ ⇒ **落回那張黑底英文頁, 也就是這一片要消滅的那個東西。**
//   🛑 **⇒ 而我第一版寫「兩個」, R2 找到第三個 ⇒ 這份清單【仍然不保證窮舉】。**
//   🛑 **而 ② 的自然修法【不能把本檔原封搬過去】**:`Header` 吃 `useCart()`,
//      而 `useCart` 沒有 provider 時會 throw(`CartContext.tsx:494`);
//      `global-error.tsx` 取代 root layout ⇒ CartProvider 不存在 ⇒ **當場 throw ⇒ 不可恢復的白畫面**。
//      ⇒ 那一片要另外做一個不吃 context 的版本。**現在寫下來, 免得下一個人踩。**
//   內容分級 L1(文案年 0-1 次改動、hardcode 可)。

import Link from 'next/link';
import { Header } from '@/components/Header';
import { HomeFooter } from '@/components/HomeFooter';

export default function GlobalRouteError() {
  return (
    <div data-screen-label="Error 500" className="err-page">
      {/* client component 不得 export metadata ⇒ 用 JSX <title> 對齊 not-found.tsx:23 的專屬標題;
          沒有它的話 500 頁會退回 layout.tsx:82 的全站預設標題(code-reviewer F6)。 */}
      <title>服務暫時無法使用 — PCM重機零件販售</title>
      <Header currentPage="error" />
      <main className="err-main">
        <div className="err-inner">
          <div className="err-num" aria-hidden="true">500</div>
          <div className="ap-mono err-eyebrow">N°500 · Server Error</div>
          <h1 className="err-title">服務暫時無法使用</h1>
          <p className="err-desc">我們正在處理、請稍後再試。如持續發生、請聯絡客服。</p>
          <div className="err-cta">
            <Link href="/" className="btn-primary err-btn-primary">
              回首頁
              <span>→</span>
            </Link>
            <Link href="/products" className="btn-outline err-btn-outline">
              商品目錄
            </Link>
          </div>
          <div className="err-support">
            持續發生?<Link href="/stores">聯絡客服</Link>
          </div>
        </div>
      </main>
      <HomeFooter />
    </div>
  );
}
