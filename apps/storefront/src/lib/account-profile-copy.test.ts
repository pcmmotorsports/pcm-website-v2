// account-profile-copy 的**規矩**守門(Q28,2026-09-03)。
//
// 🔴🔴 **為什麼需要這一支 —— 它是一次假綠抓出來的。**
// `OverviewTab.test.tsx` / `WalletTab.test.tsx` 那幾格斷言長這樣:
// ```
// expect(screen.getByText(PROFILE_UNREADABLE_NOTE)).toBeDefined();
// ```
// 🛑 **期望值與被測值是【同一個常數】** ⇒ 我把文案改成「會員資料暫時讀不到,請稍後再試。」
//    **實跑:22 passed,一格都沒紅。**
// 📌 ⇒ 那幾格測的是「畫面有印出那個常數」(接線),**不是「那句話說得對」**(內容)。
//    兩件事都要測,而只有下面這幾格測得到後者。
// 🎯 母題:**把期望值抄成觀察值 = 讓實作自己出考題。**

import { describe, expect, it } from 'vitest';
import { PROFILE_UNREADABLE_NOTE } from './account-profile-copy';
import { RETRY_PROMISE_WORD_ROOTS } from './account-order-copy';

describe('RETRY_PROMISE_WORD_ROOTS 這把尺自己', () => {
  // 🔴🔴 **R2 nit:那把尺【自己】沒有守門。**
  //    兩個消費點都只是【遍歷】它 ⇒ 從 array 裡刪掉 `'刷新'`:
  //    兩支測試各少跑一格、**0 紅**(116 ⇒ 115)—— 而**沒有任何東西在斷言 116 這個數**。
  //    🎯 **一把靠遍歷來用的清單, 縮短它不會讓任何一格變紅 —— 它只會讓覆蓋面安靜地變小。**
  //    ⇒ 📌 這與 R1 M1(窄化副本)是同一個病的**第二層**:
  //       M1 修掉的是「兩份清單不同步」, 而這一格修的是「唯一那份被縮短」。
  it('🔴 釘住完整內容 —— 少一個詞就要紅', () => {
    expect(RETRY_PROMISE_WORD_ROOTS).toEqual([
      '重新整理',
      '重新載入',
      '重整',
      '刷新',
      '重試',
      '再試',
      '稍後',
      '稍候',
    ]);
  });
});

describe('PROFILE_UNREADABLE_NOTE 的規矩', () => {
  // 🔴🔴 **清單來自 `account-order-copy.ts` 的 export, 不是本檔重打一份。**
  //    首版我在這裡自己列了 5 個詞, 少掉 `重新載入`/`重整`/`刷新`/`重試`,
  //    而且把詞根 `稍候` 寫成句子 `請稍候` ⇒ 「請刷新頁面」「稍候片刻」**全綠穿透**。
  //    🎯 **搬結論而把清單搬窄了 —— 而那個窄化在 diff 上長得像「我也有寫那道守門」。**
  it.each(RETRY_PROMISE_WORD_ROOTS)('🔴 不得叫客人再做一次:不含「%s」', (word) => {
    expect(PROFILE_UNREADABLE_NOTE).not.toContain(word);
  });

  // ⚠️ `暫時` 刻意【不在】canonical 清單裡(它的正確寫法就是「不是暫時的」)——
  //    而本檔加禁它, 代價寫在這裡:
  //    🔴 本句的兩個世界(A 會好 / B 永久)**同時可能** ⇒ 我正面斷言不了持久性
  //       (`account-order-copy` 那支可以, 因為它只有一個世界:永遠不會好)。
  //    ⇒ 所以只剩禁詞這一道 ⇒ **代價 = 未來若要寫「這不一定是暫時的」會被這格判紅。**
  //    ⇒ 撞到它的人:那是已知取捨, 不是誤報 —— 回來改這一格, 別繞過去。
  it('🔴 不得承諾會好:不含「暫時」', () => {
    expect(PROFILE_UNREADABLE_NOTE).not.toContain('暫時');
  });

  // 🔴🔴 M3:這句話會印在 `.wal-balance-soon` 那個插槽裡, 取代 `WALLET_UNAVAILABLE_NOTE`。
  //    而那個插槽上掛著四道拍板守門(`WalletTab.test.tsx`:不承諾時程 / 兩半都要點名 / 不承諾折抵),
  //    **它們 render 時都不帶 `balanceFailed` ⇒ 一道都量不到這句話。**
  //    ⇒ 📌 少了下面這格, 往這句話加「近期修復」四個字:
  //       它自己的 gate 不禁時程詞、那插槽的 gate 量不到它 ⇒ **一個沒有人授權過的時程承諾可以合法上線。**
  it.each(['即將推出', '即將開放', '近期', '很快', '月'])(
    '🔴 借用 `.wal-balance-soon` 插槽 ⇒ 一併扛它的「不承諾時程」拍板:不含「%s」',
    (word) => {
      expect(PROFILE_UNREADABLE_NOTE).not.toContain(word);
    },
  );

  // 🔴🔴 **R2:我判「不承諾折抵」那道不必轉移, 而【理由是錯的】——**
  //    我說「那道講的是未開放功能的描述, 失敗世界那句話不在描述功能」。
  //    🛑 審查者指出:**它是【禁令】, 而禁令跟著插槽走** —— 與「不承諾時程」一模一樣,
  //       而我自己用同一條邏輯讓新常數扛了時程。
  //    🔴 它現在不咬我的真正原因是 `WalletTab.test.tsx` 那格斷的是 `.wal-balance-meta`,
  //       **而那個節點在失敗世界根本不渲染** —— 不是因為它對失敗世界不適用。
  //    🎯 **⇒ 結論恰好對, 而理由是錯的。照著那個理由做下一個判斷就會錯。**
  it('🔴 借用插槽 ⇒ 一併扛它的「不承諾折抵」拍板:不含「折抵」', () => {
    expect(PROFILE_UNREADABLE_NOTE).not.toContain('折抵');
  });

  // 🔴🔴 正向斷言才是真正扛住的那一道(`account-order-copy.ts` 逐字:禁詞清單只是第二道)。
  //    少了這格:把常數換成「結帳時如需協助請聯絡客服。」⇒ 禁詞全過, 而**客人被告知的內容整個不見了**。
  it('🔴 必須講出【讀不到】—— 否則客人不知道發生了什麼事', () => {
    expect(PROFILE_UNREADABLE_NOTE).toContain('讀不到');
  });

  it('🔴 必須講【結帳】—— 只講餘額會讓他以為只是少一個數字, 直到結不了帳才知道', () => {
    expect(PROFILE_UNREADABLE_NOTE).toContain('結帳');
  });

  it('🔴 必須給一條【不靠我們自己好】的出路', () => {
    expect(PROFILE_UNREADABLE_NOTE).toContain('客服');
  });

  it('🔵 不得提價格 —— 顧客站每個價都是 price_general, 等級掉回去不會讓金額變錯', () => {
    for (const word of ['價格', '金額', '價錢']) {
      expect(PROFILE_UNREADABLE_NOTE).not.toContain(word);
    }
  });

  // 🔴 M4:同一個畫面在 `balanceFailed` 世界照常印 `<TierBadge tier='general'>`
  //    ⇒ 這句話若說「等級無法顯示」, 就與旁邊那顆徽章互相矛盾, 而客人會相信徽章。
  //    tier 卡本身是 Q28 第 3 步(等 Sean 批 plan), 本片只是不再多講一句它做不到的話。
  it('🔴 不得宣稱「等級無法顯示」—— 同畫面正在印一個等級', () => {
    expect(PROFILE_UNREADABLE_NOTE).not.toContain('等級');
  });
});
