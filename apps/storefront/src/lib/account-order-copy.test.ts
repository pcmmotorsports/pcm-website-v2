import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ORDER_DETAIL_ITEM_CANCELLED_MARK,
  ORDER_DETAIL_ITEM_SHIPPED_MARK,
  ORDER_DETAIL_UNPAID_SHIPPED_NOTE,
  ORDER_ITEM_COUNT_TRUNCATED_NOTE,
  RETRY_PROMISE_WORD_ROOTS,
} from './account-order-copy';

// `#636` —— 客人面「? 件」那句話的守門。
//
// 🔴 **這一支釘的是【不准出現的字】,不是「有沒有講清楚」** —— 後者測不出來,前者可以。
//    舊句逐字含「請重新整理」,而觸發它的是一個寫死的 embed 上限 ⇒ 重整一百次還是「?」。
describe('ORDER_ITEM_COUNT_TRUNCATED_NOTE(`#636` 客人面截斷文案)', () => {
  // 🔴🔴 **禁詞根,不列祈使形白名單。** 後台同一族守門實測被穿透兩次:
  //    ①只禁「重新整理後」⇒「請重新整理再列印一次」全綠 ②補祈使形 ⇒「麻煩您重新整理一下看看」還是全綠。
  //    ⇒ **中文的祈使形舉不完**,白名單這個形狀本身就是錯的。
  it('🔴 不得叫客人去做一件永遠不會成功的事(重整/重試/稍後)', () => {
    // 🔴 `稍候`(U+5019)與 `稍後`(U+5F8C)**是不同字** —— 審查當場實測前者穿透。
    //    ⚠️ 這份清單擋的是【已知說法】不是【所有說法】(檔頭列了七種仍會全綠的寫法)
    //      ⇒ **真正扛住段②的是下面那格正向斷言**,這裡是第二道。
    // 🔴 2026-09-03:清單搬進 `account-order-copy.ts` 成為 export(單一權威)——
    //    因為 `account-profile-copy.test.ts` 重打了一份【比較窄】的, 而窄化在 diff 上看不出來。
    for (const bad of RETRY_PROMISE_WORD_ROOTS) {
      expect(
        ORDER_ITEM_COUNT_TRUNCATED_NOTE,
        `截斷是【寫死的上限】造成的,叫客人「${bad}」會讓他一直做一件不會成功的事`,
      ).not.toContain(bad);
    }
  });

  // 🔴🔴 段② **用「要求出現」測,不用「禁詞」測** —— 這是落地時翻掉的一版。
  //    「暫時」的**正確**寫法就是「**不是**暫時的」⇒ 禁詞根會把對的句子一起判紅。
  //    ⇒ 持久性這件事只能正面斷言:它有沒有講出「這是固定的、不會自己好」。
  //    🔴 而初版寫的是「這是系統的問題,**不是您的操作造成的**」——
  //      那句答的是**責任歸屬**,不是**持久性**;客人要的是「我還要不要再等」,那句答不了。
  //      **兩句都通順、都像已經寫過段②了**,所以這一格釘的是那個實際的差別。
  it('🔴 段②:必須明說這是固定的、不會自己好(不能只寫「這是系統的問題」)', () => {
    expect(ORDER_ITEM_COUNT_TRUNCATED_NOTE, '沒講持久性 ⇒ 客人會等它自己恢復').toContain('固定限制');
    expect(ORDER_ITEM_COUNT_TRUNCATED_NOTE).toContain('不會自己恢復');
  });

  // 「這次」會把一個固定限制講成偶發 ⇒ 客人會等它自己好。
  // (這個字沒有「正確的否定寫法」,所以它可以留在禁詞側。)
  it('🔴 不得用「這次」把固定限制講成偶發', () => {
    expect(ORDER_ITEM_COUNT_TRUNCATED_NOTE).not.toContain('這次');
  });

  // Sean 2026-08-18 拍板 `Q2`=甲:顧客站用「您」、後台用「你」。
  // ⚠️ `您`(U+60A8)與 `你`(U+4F60)是不同字元 ⇒ 含「您」不會讓下面那格誤紅。
  it('🔴 顧客站稱謂用「您」、不出現「你」', () => {
    expect(ORDER_ITEM_COUNT_TRUNCATED_NOTE).toContain('您');
    expect(ORDER_ITEM_COUNT_TRUNCATED_NOTE, '顧客站不用「你」(Q2=甲)').not.toContain('你');
  });

  // 🔴 ③「空白不等於沒有」—— 沒有這一句,客人看到「?」會以為訂單是空的 / 東西掉了。
  //    ⚠️ 這格釘的是**那個誤解有沒有被明說擋掉**,所以兩個字面都要在;
  //      只釘一個的話,把另一半刪掉照樣綠。
  it('🔴 必須明說「?」不代表訂單是空的、商品還在', () => {
    expect(ORDER_ITEM_COUNT_TRUNCATED_NOTE).toContain('不代表這張訂單是空的');
    expect(ORDER_ITEM_COUNT_TRUNCATED_NOTE).toContain('商品都在');
  });

  // 🔴 ④ 下一步 + 這個狀態下**不要做什麼**。少了後半,客人會拿一個錯的件數去對帳。
  it('🔴 必須給下一步,而且說出這個狀態下不要做什麼', () => {
    expect(ORDER_ITEM_COUNT_TRUNCATED_NOTE, '沒有下一步 = 一句只讓人焦慮的話').toContain('與我們聯絡');
    expect(ORDER_ITEM_COUNT_TRUNCATED_NOTE, '沒擋住「拿這個數字去對帳」').toContain('不要拿這個數字對帳');
  });

  // 🔴 **正向對照** —— 沒有這一格,把整個常數改成空字串,上面五格【全部照樣綠】
  //    (`''.includes('重新整理')` 是 false)。這正是「什麼都沒有被讀成檢查過了」那個形狀。
  it('🔴 正向對照:它必須真的是一句話(空字串會讓上面每一格恆綠)', () => {
    expect(ORDER_ITEM_COUNT_TRUNCATED_NOTE.length).toBeGreaterThan(40);
  });
});

/**
 * ⟦ship-AXISHOLE⟧ / ⟦ship-WHICHITEMSSHIPPED⟧ **Sean 2026-09-04 拍的兩句話, 逐字釘住。**
 *
 * 🔴🔴 **本 describe 是 adversarial-reviewer 2026-09-04 打出來的, 而它打中的是同一個形狀兩次**:
 *    ① 兩片的畫面測試**全部 import 那個常數去比** ⇒ 把常數的**值**改掉, **每一格照樣全綠**
 *       ⇒ 🎯 **測試問的是「畫面印的與常數一樣嗎」, 而沒有人問「常數是他拍的那句話嗎」。**
 *    ② 「灰字」那一半**只住在 CSS 裡**, 而 jsdom 不載 CSS ⇒ 刪掉那條規則三格全綠,
 *       而畫面上那三個字會變成 16px 黑體正文 —— 🛑 **他拍的是「灰字」, 不是「有那三個字」。**
 * 📌 ⇒ 兩者是同一句話:**一個常數 / 一條 CSS 規則, 在「照他拍的」與「被人改掉」兩個世界
 *    印同一個綠** —— 而那正是本 repo 反覆記的那個病。
 *
 * ⚠️ **本段刻意不寫行號** —— 這幾支檔多窗在寫, 認字面:`--c-text-3`、`.od-line-ship`。
 */
describe('⟦ship-AXISHOLE⟧ / ⟦ship-WHICHITEMSSHIPPED⟧ 2026-09-04 Sean 拍的兩句話', () => {
  // Q7 原話逐字(`~/pcm-mailbox/Sean拍板-20260904-七題.md`):
  //   q7:乙 那格變灰色 + 一句「尚未收到匯款」   ← 我推這個
  it('🔴 進度軸那個洞的字, 逐字是他打的六個字', () => {
    expect(
      ORDER_DETAIL_UNPAID_SHIPPED_NOTE,
      'Sean Q7 拍乙的原話引號裡就是這六個字;改成「等待匯款」「未付款」都是改一板',
    ).toBe('尚未收到匯款');
  });

  // Q5 甲的選項字面:甲灰字「已出貨」
  it('🔴 逐件那個標記的字, 逐字是他選的三個字', () => {
    expect(
      ORDER_DETAIL_ITEM_SHIPPED_MARK,
      'Sean Q5 拍甲的選項字面是「灰字『已出貨』」;改成「出貨中」「已寄出」都是改一板',
    ).toBe('已出貨');
  });

  /**
   * 🔴 **「灰」那一半的守門 —— 它讀真的 CSS 檔, 因為 jsdom 不載樣式。**
   *
   * 🛑 **驗收方式不是「它綠」, 是**:刪掉 `.od-line-ship` 那條規則 ⇒ 這一格必須紅。
   *    不紅 ⇒ 那條規則沒有任何世界殺得死它, 而畫面會變成黑體正文而三綠全綠。
   * 🔵 **顏色比的是 token 不是色碼** —— `var(--c-text-3)` 是鄰居 `.od-line-fits` 用的同一個值
   *    ⇒ 這一格同時釘住「對齊鄰居」這個理由;有人改成寫死的 `#999` 也會紅, 而那是對的:
   *    **一個繞過 token 的顏色值該被看見。**
   */
  it('🔴 那三個字必須是【灰的】—— jsdom 不載 CSS, 所以這一格讀真的樣式檔', () => {
    const css = readFileSync(
      path.join(__dirname, '..', 'styles', 'order-detail.css'),
      'utf8',
    );
    const rule = css.split('\n').find((l) => l.trim().startsWith('.od-line-ship'));
    expect(rule, '.od-line-ship 這條規則不見了 ⇒ 那三個字會變成 16px 黑體正文').toBeTruthy();
    expect(rule, '他拍的是「灰字」—— 顏色要走既有的次要文字 token, 不要寫死色碼').toContain(
      'var(--c-text-3)',
    );
    expect(rule, '灰字也要比正文小一號, 否則它會跟品名搶').toContain('font-size: 12px');
  });

  // Q-C 乙的字面:乙:灰字「已取消」
  it('🔴 那句「不會來了」的字, 逐字是他打的三個字', () => {
    expect(
      ORDER_DETAIL_ITEM_CANCELLED_MARK,
      'Sean Q-C 拍乙的字面是「灰字『已取消』」;改成「已作廢」「不出貨」都是改一板',
    ).toBe('已取消');
  });

  /**
   * 🔴 **「已取消」那三個字也必須是灰的 —— 而它與「已出貨」【共用同一條規則】。**
   *
   * 🔵 **共用是 Sean 那句話的內容, 不是我省事**:他拍 Q-C 乙時逐字說
   *    「與 Q5 甲的『已出貨』**同一組視覺語言**」。
   * 🛑 ⇒ 所以這一格釘的不只是「它是灰的」, 是**兩者在同一條規則上**:
   *    拆成兩條一模一樣的規則 ⇒ 下一個人改其中一條, **兩者會悄悄分家而沒有東西會紅**。
   */
  it('🔴 「已取消」與「已出貨」共用同一條灰字規則(分家了沒有東西會紅)', () => {
    const css = readFileSync(
      path.join(__dirname, '..', 'styles', 'order-detail.css'),
      'utf8',
    );
    const rule = css.split('\n').find((l) => l.trim().startsWith('.od-line-ship'));
    expect(rule, '.od-line-ship 那條規則不見了').toBeTruthy();
    expect(
      rule,
      '.od-line-cancel 不在同一條規則裡 ⇒ 兩個標記的灰會分家, 而分家時沒有東西會紅',
    ).toContain('.od-line-cancel');
  });

  /**
   * 🔵 **正對照:證明上面那一格的尺會動。**
   * 少了它, 一支**讀不到檔而回空字串**的 `readFileSync` 會讓 `.find()` 回 undefined ⇒ 紅,
   * 那是好的;而**一支讀到了【別的檔】**的路徑錯誤會安靜地也紅 ⇒ 兩種紅分不開。
   * ⇒ 這一格釘住「我確實讀到了那支 CSS」, 讓上面那格的紅只剩一個成因。
   */
  it('🔵 正對照:我讀到的確實是訂單明細那支 CSS(否則上面那格的紅有兩個成因)', () => {
    const css = readFileSync(
      path.join(__dirname, '..', 'styles', 'order-detail.css'),
      'utf8',
    );
    expect(css, '路徑對了但檔不對 ⇒ 上面那格會紅, 而紅的理由是錯的').toContain('.od-line-fits');
  });
});
