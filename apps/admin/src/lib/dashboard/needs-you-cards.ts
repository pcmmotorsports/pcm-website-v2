/**
 * ⟦f3-REDNEEDSEXIT⟧ 乙案(Sean 2026-09-07 答 Q59 乙:紅單 = 所有等你處理的單)。
 *
 * 🔴 **這裡【不是】一個新計數** —— 首頁本來就有那幾格, 而**沒有任何一句話說它們是同一族**。
 *    主視窗 B 2026-09-07 裁 B2:**零新讀數, 加一句話**。理由是查地圖查到的:
 *    Sean 答乙時的畫面前提是「首頁沒有那格」, 而實查**已經有那一族格子**
 *    (`page.tsx` 的 `data-testid` 當場列)⇒ 再加一個總數 = 把【摘要】與【內文】排在同一頁,
 *    而那正是板列 `⟦b9-TRIAGESIGNPOST⟧` 記的病:**讀的人會拿摘要當全部**。
 *
 * 🛑 **點名, 不泛指**(主視窗 B 指定):寫「這幾格」的話, 之後有人加格 / 改名, 這句話會靜靜地過期。
 *    ⇒ 名字寫在這裡一份, 而**畫面上那幾格是各自手寫的** ⇒ 兩份東西, 對不上就有測試會紅。
 */
export const NEEDS_YOU_CARDS: ReadonlyArray<{
  /** 畫面上那一格的 `data-testid` —— 測試拿它去 DOM 裡找。 */
  readonly testId: string;
  /** 畫面上**逐字**看得到的字 —— Sean 要能照這個字在畫面上找到那一格。 */
  readonly 名稱: string;
}> = [
  { testId: 'stuck-payment-count', 名稱: '扣款重試已放棄' },
  { testId: 'released-stuck-count', 名稱: '3DS 釋鎖後待人工' },
  { testId: 'dead-letter-count', 名稱: '寄不出去的信' },
];

/**
 * 那一句話。
 * 🔴 **後半句不可以拿掉**:這三格**不是全部** —— 巡檢那邊今天有 32 個計數,
 *    而後台這一側只有這三格有現成讀數(其餘要新寫 read ⇒ 板列 `⟦f3-REDNEEDSEXIT⟧` 的 B1 待派)。
 * 🛑 而它**刻意不寫「下界」** —— 那是給我們看的字, 不是給 Sean 看的字(主視窗 B 2026-09-07 指定)。
 */
export function needsYouSentence(): string {
  return (
    `下面這三格加起來, 就是今天等你處理的單:${NEEDS_YOU_CARDS.map((c) => c.名稱).join(' · ')}。` +
    '(這裡列的是我們現在數得出來的幾種, 不是全部。)'
  );
}
