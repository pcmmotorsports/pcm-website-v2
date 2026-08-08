// catalog-navigation.ts — 「帶車輛條件跳商品目錄」的單一導覽出口。
//
// 🔴 存在理由(Sean 2026-08-09 手機回報 / D-310-A Bug 2):從首頁 finder 選完車跳 `/products`,
//    **落地時捲動位置沒有歸零**,停在來源頁捲到哪就是哪 ⇒ 首排商品被黏頂的篩選列蓋掉上半截。
//    主視窗在真 DB 環境量到鐵證(D-315-A ②):
//      push 前首頁 scrollY 152.5 → 落地 /products scrollY **仍是 152.5**;
//      首張 `.pcard` top 154、`.pmc-sticky` bottom 169 ⇒ **被蓋 15px**;
//      對照組(push 前 scrollY=0)落地 cardTop 307、零遮蔽。
//    被蓋多深 = 來源頁捲了多深;手機 hero 更高、Sean 捲得更深 ⇒ 他看到的是半張卡。
//
// 🔴 **弔詭點沒有被解釋掉,誠實申報**:`router.push(url)` 是裸呼叫、沒有 `scroll: false`,
//    Next App Router 的預設**應該**滾回頂,但實測沒有。`/products` 有 `loading.tsx`
//    (Suspense boundary),本 repo 也已經有一次 Next16 segment cache 的實錘
//    (memory `reference_nextjs-duplicate-query-key-segment-collision`)⇒ 疑似同族,
//    但**我沒有證明**:本 worktree 無 DB、`/products` 渲染不出任何商品卡,重現不了那條動線。
//    ⇒ 這裡做的是「**不論 Next 為什麼沒滾,我們自己保證落地在頂**」,不是根因修復。
//
// 🔴 為什麼修在這裡、不修在 `/products` 那一端:
//    在 `/products` 掛「進頁就捲到頂」會**打壞瀏覽器返回時的捲動還原** ——
//    客人捲到第 20 個商品、點進去看、按返回,應該回到原位而不是被丟回頂端。
//    而「按下搜尋部品/點車輛 pill」是**明確的使用者動作**,落地在頂沒有歧義。
//    ⇒ 出口收斂成這一支,呼叫端只有兩處(見 `catalog-navigation.test.ts` 的來源掃描)。

/** router 只用得到 push,收窄型別讓測試不必造整個 AppRouterInstance。 */
type PushOnly = { push: (url: string) => void };

/**
 * 跳到商品目錄,並保證**落地在頁面頂端**。
 * 順序刻意是「先 push、後捲」:反過來會讓來源頁在導覽前先跳一下、被使用者看見。
 */
export function navigateToCatalog(router: PushOnly, url: string): void {
  router.push(url);
  if (typeof window !== 'undefined') {
    window.scrollTo({ top: 0, left: 0 });
  }
}
