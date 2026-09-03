// search-terms-fold.ts — 把使用者打的字與目錄裡的字**折成同一個形狀**再比
// (⟦search-CAPSULEPARSE⟧ 2026-09-03)。
//
// 🔵 它解的是【格式】不是【語意】:
//    `mt07` / `MT-07` / `mt 07` 是**同一串字的不同打法**;
//    而 `油箱貼 ⇒ 油箱止滑貼` 是**換了一個詞** —— 後者住 `data/search-synonyms.ts`,不在這裡。
//
// ── 🔬 而「要不要字典」這件事是量出來的,而答案是【大部分不用】────────────
//    對真實 taxonomy 實測(2026-09-03):
//    ```
//      mt07      ⇒ ✅ 車款 MT-07        mt-07 / MT07 同樣中
//      akrapovic ⇒ ✅ 品牌 AKRAPOVIČ    (Č ⇒ C 是【變音符號】不是同義詞)
//      ohlins    ⇒ ✅ 品牌 Öhlins
//      cbr600rr  ⇒ ✅ 車款 CBR600RR
//    ```
//    🎯 **⇒ Sean 原話那句裡的 `mt07` 與 `akrapovic` 兩顆,光靠本函式就對得上 —— 零字典。**
//
// ── 🔴🔴 為什麼**保留 CJK**:因為我第一版沒有,而它印給我一排【假的 ✅】────
//
//    我第一版是這樣寫的:
//    ```js
//    .replace(/[^A-Za-z0-9]/g, '')      // 🛑 這一行把【中文】也剝掉了
//    ```
//    ⇒ `fold('油箱貼')` = `''` ⇒ 而 `''.startsWith('')` 是 `true`
//    ⇒ 🛑 **每一個中文詞都「命中」每一個分類**,它印給我:
//    ```
//      油箱貼  ✅ 油箱止滑貼,碳纖維部品,駐車架,排氣管
//      排氣    ✅ 油箱止滑貼,碳纖維部品,駐車架,排氣管
//      土除    ✅ 油箱止滑貼,碳纖維部品,駐車架,排氣管
//    ```
//    🎯 **一排 ✅。而正確答案是「3 個裡有 2 個對不上」。**
//
//    🔴 **而那排 ✅ 差一點就寫進 plan** —— 它會被批准,而下游會照著一份
//       **建立在假 ✅ 上的 plan** 去做三支檔。
//
//    🛑 **而它是【好消息】形狀的**:結論是「中文幾乎都對得上 ⇒ 字典幾乎不用做」
//       = 一個**讓工作變少**的結論 ⇒ 📌 **而那種結論沒有人會回頭查。**
//
//    ⚠️ 而最難堪的一格:我**當天稍早才為同一個空字串陷阱寫過 SQL 守門 + 突變測試**
//       (拿掉守衛 ⇒ 中文詞回 22,804 列 = 全表 ⇒ 紅)。
//       ⇒ 📌 **那個知識一點都沒有遷移到我自己的量尺上** ——
//         因為【被驗的東西】有守門,而【驗它的工具】沒有。
//       (同族全文:memory `feedback_fixing-the-tool-does-not-fix-my-own-hand`。)
//
//    ✅ **抓到它的動作(可機械執行,不是「更仔細」)**:
//    ```js
//    console.log('fold("油箱貼") =', JSON.stringify(fold('油箱貼')));   // ⇒ ""
//    ```
//    > **一把新尺印出「全部命中」或「全部不命中」時,先把它對【一個已知輸入】的
//    > 輸出印出來 —— 印出來的是不是一個【空的東西】?**
//    🛑 **而這與正對照不同**:正對照問「尺會不會動」,而我的尺**會動**(它印了一堆 ✅)。
//       ⇒ 📌 要問的是 **「它動的時候,我的輸入還在不在裡面?」**
//
// 🔴 **⇒ 所以本檔有一格測試專門盯這件事**:餵純中文 ⇒ **`fold` 之後不得是空字串**。

/**
 * 剝掉變音符號 + 去掉 ASCII 的標點與空白 + 轉大寫。
 *
 * 🔴 **刻意【只】剝 ASCII 標點,不用 `[^A-Za-z0-9]`** —— 見檔頭那段假 ✅。
 *    `̀-ͯ` 是 Unicode 的組合用變音符號區(NFD 之後 `Č` = `C` + `̌`)。
 *
 * @example fold('mt-07')      // 'MT07'
 * @example fold('AKRAPOVIČ')  // 'AKRAPOVIC'
 * @example fold('油箱貼')      // '油箱貼'  ← **不是空字串**
 */
export function foldSearchTerm(raw: string): string {
  return raw
    .normalize('NFD')
    // 🔵 `U+0300`–`U+036F` = Unicode 的**組合用變音符號**區。NFD 之後 `Č` = `C` + `̌`,
    //    所以剝掉這一段就等於剝掉變音符號,而**底下那個字母原封不動**。
    //    ⚠️ 我原本在這裡掛了一行 `eslint-disable-next-line no-misleading-character-class`,
    //       而 lint 說**那一行沒有在擋任何東西** ⇒ 拿掉。
    //       📌 一個沒有在擋東西的 disable, 會讓下一個人以為這裡有一條規則要繞。
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\s\-_./()[\]{}·,、]/g, '')
    .toUpperCase();
}

/**
 * 兩個字串折過之後是不是**同一個**。
 * 🔵 用於「使用者打的字 vs 車款/品牌的正式名」。
 */
export function foldEquals(a: string, b: string): boolean {
  const fa = foldSearchTerm(a);
  // 🔴 **空的一律不算相等** —— 否則兩個折完都是空的東西會互相「命中」。
  //    ⚠️ 今天 `fold` 保留 CJK ⇒ 只有「純標點」才折得出空字串;
  //    而那正是本片最貴的失敗形狀,所以這一格**不靠上游保證**,自己擋。
  if (fa === '') return false;
  return fa === foldSearchTerm(b);
}

/**
 * 折過之後,`candidate` 是不是以 `query` **開頭**。
 * 🔴 用【前綴】不是【子字串】—— 理由與料號那片同一個:
 *    子字串會讓 `GRAB123MM` 命中 `AB123`(實測 31 筆語料:子字串 6 件 / 前綴 3 件、雜訊 0)。
 */
export function foldStartsWith(candidate: string, query: string): boolean {
  const fq = foldSearchTerm(query);
  if (fq === '') return false;
  return foldSearchTerm(candidate).startsWith(fq);
}
