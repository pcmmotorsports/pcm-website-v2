// strip-pictographs.ts — 把 emoji 類字元從【要印出來的字】裡拿掉(`#240`/Q1-A1;Sean 2026-08-23 拍「濾掉」)
//
// ══ 為什麼有這支 ═══════════════════════════════════════════════════════════
// 正式庫實查(2026-08-23,線2):`customers.name` 裡有一位客人的名字含 **U+1F3CD 🏍**。
// 它**不是**打錯字,是 **LINE 登入把顯示名帶進來的** ——
//   14 位客人:8 位 email 註冊 ⇒ emoji 0 / **6 位 LINE 登入 ⇒ emoji 1**
//   ⇒ **每一位新的 LINE 客人都可能再帶一次。清一次沒有用。**
//   ⚠️ 而「後台輸入驗證」也擋不到 —— **那不是後台輸入的欄位,是 OAuth 帶進來的。**
//
// 而 `picking-doc.tsx` 印的就是 `detail.customer.name`,**那張紙合併後要 email 給客人**
// ⇒ 印不出來就是一個方框,而**第一個發現的人會是客人**。
// 🔴 Sean 2026-08-23 拍板【濾掉】:**印的時候拿掉,不動客人自己的資料。**
//
// ══ 🔴🔴 這支【不做】什麼 —— 不要把它讀成「印不出來的字處理好了」════════════
// 它只處理 **emoji / 圖形符號**。它**抓不到**:
//   · **罕用漢字**(堃 / 㴪 這類)—— 它們是正常的 CJK 字元,`Extended_Pictographic` 不涵蓋
//   · 任何「字型裡剛好沒有」的字
// ⇒ **那一族要靠另一道守門**:掃**整份渲染文字**、對照**嵌入字型的 cmap**
//   (規格見 `docs/specs/2026-08-19-g1-240-order-detail-plan.md` §S-字域)。
// 🔴 **本檔綠了,不代表域外字那格解決了。** 兩件事,不要合併讀。
//
// ══ 為什麼用 Unicode 屬性而不是列一張表 ═══════════════════════════════════
// 🔴 **一張手列的 emoji 清單,它的分母是列表的人,不是 Unicode。**
//    (2026-08-23 實錘:同一個人把字元分成六個區間去數,而 144 個字元裡**有 3 個不在任何一區**
//     —— 露出它的不是那六個桶,是順手多選的一欄 `max_codepoint`。)
// ⇒ 改用 `\p{Extended_Pictographic}`:**讓 Unicode 標準當分母**,新的 emoji 不必回頭改這裡。

/**
 * 要濾掉的 emoji 本體 —— 🔴 **`\p{Extended_Pictographic}` 但【只砍 BMP 之外】**。
 *
 * 兩個 alternation, **各自擋一種**(2026-08-23 實測,碼點逐一列過):
 * ```
 * astral 且 Extended_Pictographic   🏍(U+1F3CD)—— 它 Emoji_Presentation = **false**,
 *                                   ⇒ 只用下面那條會**漏掉我們在正式庫實際抓到的那一顆**
 * Emoji_Presentation                ✨ ⭐ ✅ ❗ ⏰ ⚡ —— **BMP 而彩色預設** ⇒ 文字字型沒有它們
 * ```
 * 🔴🔴 **我第一版寫「BMP 就留」,而那個規則【碰巧答對而理由是錯的】**(code-reviewer 複驗抓到):
 *   ```
 *   我的理由      「BMP 內的圖形符號通常有字形」
 *   真正的判準    「**Emoji_Presentation = false 才留**」(= 文字預設呈現 ⇒ 文字字型本來就有)
 *   兩者在 ☎ ⚠ ® ™ ❤ 上**同答案**;在 ✨ ⭐ ✅ 上**分岔**
 *   ```
 *   ⇒ 而 `小明✨` / `美美⭐` **在台灣 LINE 顯示名比 🏍 常見得多** ⇒ 那正是本片要防的方框。
 *   📌 **一個對的結論配一個錯的理由,下一個人會拿那個理由去推別的東西** ——
 *      而這次「下一個人」就是我自己,在同一支檔的下一格。
 *
 * ✅ **留著的那些, 理由現在是對的**:`®` `™` `☎` `⚠` `❤` 的 `Emoji_Presentation` **全 = false**
 *   ⇒ 它們是**文字預設呈現**, 文字字型本來就有 ⇒ 留著不是啟發式, 是有判準的。
 * ⚠️ 而**仍然剩一個天花板**:`Emoji_Presentation = false` **不等於「這個字型一定有它」** ——
 *   真正的保證仍是「對照嵌入字型的 cmap」那道守門(plan §S-字域)。**本檔不宣稱涵蓋。**
 */
const ASTRAL_PICTOGRAPH =
  /(?=[\u{10000}-\u{10FFFF}])\p{Extended_Pictographic}|\p{Emoji_Presentation}/gu;

/**
 * 不帶字形、單獨留著會變成殘渣的那些 —— 🔴 **四類,而前三類是 R1 抓出來我漏的**:
 *   `\u{FE0F}` 變體選擇子 / `\u{200D}` 零寬連接子
 *   `\u{20E3}` **keycap 組合符**(實測 `'客人#️⃣號'` 只拿掉 VS16 會留下它)
 *   `\u{E0020}-\u{E007F}` **tag 字元**(旗幟序列 🏴󠁧󠁢… 拿掉本體後只剩看不見的 tag)
 *   `\p{Emoji_Modifier}` 膚色
 * 🔴 `\p{Regional_Indicator}` **國旗** —— 它**既不是 `Extended_Pictographic` 也不是
 *    `Emoji_Modifier`**(實測 `/\p{Extended_Pictographic}/u.test('\u{1F1F9}')` ⇒ **false**)
 *    ⇒ 我第一版的兩把尺**結構上看不見它**,而**台灣人的 LINE 名字帶 🇹🇼 是常態**。
 *    📌 形狀:我把「列碼位」升級成「列屬性」是對的,**而「哪些屬性算 emoji」本身又是一次枚舉** ——
 *       **分母仍然是我列的那些。** 這一格是 code-reviewer 抓到的,不是我。
 */
const EMOJI_GLUE =
  /[\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]|\p{Emoji_Modifier}|\p{Regional_Indicator}/gu;

/**
 * 拿掉字串裡的 emoji 類字元,並收掉**因此**產生的多餘空白。
 *
 * @returns 濾過的字串;**若整個字串被濾光則回 `null`**(而不是空字串)——
 *   讓呼叫端用自己既有的缺值寫法(例如 `?? '—'`),而不是印出一個看不見的空白。
 *
 * 🔴 **沒有東西被濾掉時,回傳與輸入【逐字相同】** —— 連空白也不動。
 *    (R1 nit:第一版無條件收空白 ⇒ `'王  小明'` 在**沒有任何 emoji** 的情況下也被改成 `'王 小明'`。)
 * 🔴 **非 emoji 的字元逐字不動** —— 中文 / 罕用漢字 / 英數 / `®` `™` / 空白全部原樣。
 *    那由測試裡的**負對照**釘住;沒有那些格,一個「把所有字都濾掉」的實作也會綠。
 */
export function stripPictographs(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const stripped = value.replace(ASTRAL_PICTOGRAPH, '').replace(EMOJI_GLUE, '');
  // 🔴 只有「真的濾掉了東西」才收空白 —— 否則這支函式會去動一個它不該碰的字串。
  const normalized = stripped === value ? value : stripped.replace(/\s{2,}/gu, ' ').trim();
  return normalized.trim() === '' ? null : normalized;
}
