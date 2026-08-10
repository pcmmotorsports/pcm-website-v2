import 'server-only';

// cancel-request-token.ts — M-4b E10 **#363**:取消線冪等 token 的**產生點**,獨立成模組 +
// `import 'server-only'` ⇒ 守門從**文字層升級成機制層**。
//
// 🔴🔴 **為什麼要獨立一個檔**:產生器原本住在 `cancel-action-state.ts`,而那個檔**必須維持
//    client-safe** —— 有兩支 client 元件在 import 它拿欄位名常數
//    (`components/orders/cancel-form-body.tsx`、`components/orders/cancel-result-url-cleanup.tsx`,
//     兩檔第一行都是 `'use client'`;該檔檔頭也自陳「不得引入 server-only」是硬需求)。
//    ⇒ 直接在原檔加 `server-only` 會當場把 build 打紅。**拆是唯一路。**
//    ⚠️ 因此**不得**從 `cancel-action-state.ts` re-export 本模組的任何東西 —— re-export 會把
//    `server-only` 拉回 client 模組圖,等於白做。
//    ✅ **這句是實測過的、不是推論(靶 M6)**:在該 client-safe 檔尾加一行
//    `export { generateCancelRequestToken } from './cancel-request-token';` ⇒ `next build --webpack`
//    **當場紅**(同 M1 的訊息、指到本檔 `:1:1`),因為該檔已有兩支 `'use client'` importer
//    ⇒ **不需要另造 fixture,既有的 import 鏈就足以觸發**。實測後那行已移除。
//    🔴 而且這條禁令現在**有機制守**(不只寫在註解裡):`cancel-order-forms.test.tsx` 有一格
//    斷言「client-safe 檔剝掉註解後不得出現 `cancel-request-token`」。
//
// 🔴🔴 **這道守門擋得住什麼 / 擋不住什麼(名字不得大於它的實際能力)**
//
//    **擋得住(真機制,build 期紅)**:任何 client 檔**import 這支產生器**。
//    #363 立案時記載的四種文字層繞法**全部失效**,因為機制看的是**模組圖**、不是字串:
//      ①改名 import(`as makeToken`)②呼叫寫成換行 ③把呼叫點搬進 `.ts` ④搬出 `components/orders/`。
//    **實測逐字證據 —— 靶 M1(對象是本檔本體,不是拋棄式 spike)**:一次性 fixture
//    (`'use client'` 檔 import 本檔 + 一條 `app/spike363/` 路由)跑 `next build --webpack`:
//      ```
//      Failed to compile.
//      ./src/lib/orders/cancel-request-token.ts
//      Error:   x You're importing a module that depends on "server-only". This API is only
//                available in Server Components in the App Router, but you are using it in the
//                Pages Router.
//         ,-[/…/apps/admin/src/lib/orders/cancel-request-token.ts:1:1]
//       1 | import 'server-only';
//      ```
//      ⚠️ 訊息裡「Pages Router」是 Next 自己的措辭不精確(本 app 是 App Router),照抄逐字、不改寫。
//    🔴 **靶 M3(消融對照,證明紅的是這一行、不是別的東西)**:把第 1 行暫時換成註解、
//      **fixture 一字不動**再 build ⇒ `✓ Compiled successfully`,且 route 清單出現 `└ ƒ /spike363`
//      (= fixture 真的被編譯了,不是又踩到「底線資料夾不編譯」那個坑)。
//      ⇒ M1 的紅**只能**歸給那一行。兩靶跑完 fixture 已刪、本檔已還原。
//
//    🔴 **擋不住:在 client 檔裡自己寫一行 `crypto.randomUUID()`(或 `crypto.getRandomValues` 手搓)。**
//    這不是假想的 —— **備註線今天就有一條 client 端鑄鍵的路徑,而且是刻意的**:
//    `components/orders/note-compose-form.tsx` 的 `regenerateToken()`(`'use client'` 檔內,
//     另帶非 secure context 的 `Math.random` 退路),用途是 bfcache 復原時**換鍵**
//    (`components/orders/cancel-order-forms.tsx` 檔頭逐字記為「備註線把同一件事列成債④、
//     用 client 端 `pageshow` 換鍵解決」)。
//    ⚠️ **精確範圍(opus nit)**:備註線的**主鍵仍是 server 鑄的**(該元件另收一顆 `serverToken` prop),
//      client 只鑄「bfcache 換鍵」那一把 ⇒ **不要讀成「備註線全線在 client 鑄」**。
//    🔴 **字面校正(codex must-fix)**:這裡原本寫「兩條線的教義**本來就不同**、不要拿本檔規則審它」——
//      **那是封口式字面、而且我證不到**。實檔只能證明「備註線**目前**這樣實作 + 它當初的理由」,
//      **證不到「那個必要性今天仍然成立」**(取消線是用『渲染期鑄 + 每次整頁重繪換新』解掉同一題的)。
//      ⇒ 正確說法:**本檔的規則不自動適用於備註線,但這不等於它的教義已被確認成立;那個判斷歸 `#373`。**
//    ⇒ 所以 `cancel-order-forms.test.tsx` 那條**文字層守門不能刪**,它改守 **inline 產生器**那個面:
//      **機制層擋 import、文字層擋 inline,兩層守的是不同的面。**
//    ⇒ 正確的宣稱字面是「取消線的 token **不可能經由 import 這支共用產生器**在 client 產生」,
//      **不是**「不可能在 client 產生」。
//
//    🔴 也擋不住**呼叫端把整棵樹包進快取層**(那一條由 `CancelFormShell` 的 docstring 與
//    `cancel-order-forms.test.tsx` 的原始碼層守門管,本片沒有改變它)。
//
// 🔴🔴 **寫負向對照(證明機制真的生效)的人必看 —— 路由名不得以底線開頭。**
//    本片 spike 第一版把 fixture 路由放在 `app/orders/__spike/`,結果 **build 完全成功、
//    `server-only` 一聲不響**,而且 build 輸出的 route 清單裡根本沒有它:
//    **Next 把 `_` / `__` 開頭的資料夾當 private、不編譯成路由** ⇒ 那個「控制組」永遠是綠的,
//    而你會以為機制沒生效(或更糟:以為機制生效但其實沒被測到)。
//    ⇒ 要驗這道守門,fixture 路由請用**不以底線開頭**的名字(本片用 `app/spike363/`),
//      並在測完之後把 fixture 刪掉(它會讓 build 恆紅,留在樹上遲早被人 skip 掉)。
//
// ⚠️ **測試環境**:`import 'server-only'` 在 vitest(node 與 jsdom 皆然)會拋 ——
//    本 repo 既有處置是**逐檔一行** `vi.mock('server-only', () => ({}))`
//    (前例:`lib/payment/composition.test.ts` 等五支;jsdom 前例
//     `app/orders/[id]/cancel-wiring.test.tsx`)。root `vitest.config.ts` **沒有** `setupFiles`,
//    本片刻意**不**為它開全域 setup(那會改動全 repo 的測試基建)。
//    另:`components/orders/cancel-forms-hydrated.test.tsx` 那支 esbuild harness 會把整棵樹打包進
//    瀏覽器 ⇒ 它的 stub plugin 要一併把 `server-only` 換掉(該檔內已有 stub namespace 機制)。

/**
 * 產一把冪等 token。
 *
 * 🔴 產生點必須在 server component 的渲染期、且**不得落在任何快取層內**
 * (`unstable_cache` / `React.cache` 會把 token 凍住 ⇒ 多次載入拿到同一把 ⇒ 第二個人送出時
 *  直接撞冪等格)。理由與前例逐字同 `note-action-state.ts` 的同款 docstring。
 *
 * 🔴 **形狀驗證刻意不另寫一條正規式**(plan §2 慣例 5):驗證器 `isCancelRequestToken` 留在
 * `cancel-action-state.ts`(它是純形狀檢查、client-safe、被解析器與 D3 classifier 共用),
 * 而它轉呼 `note-action-state` 的 `isUuid` —— 那裡的註解記著關卡2 抓過的漂移面
 * (同一條正規式養兩份,總有一天會不一樣)。
 * ⚠️ 代價寫清楚:取消線因此**依賴備註線的檔案**。這是刻意的取捨(單一真相 > 模組獨立),
 *    真要拆得把 `isUuid` 抽到共用檔、兩邊一起改,不是在這裡複製一份。
 *
 * ⚠️ **#363 之後產生器與驗證器住在不同檔**(前者 server-only、後者 client-safe)——
 *    「同源」那條守門因此改成跨兩檔驗(`cancel-request-token.test.ts`),不是不驗了。
 */
export function generateCancelRequestToken(): string {
  return crypto.randomUUID();
}
