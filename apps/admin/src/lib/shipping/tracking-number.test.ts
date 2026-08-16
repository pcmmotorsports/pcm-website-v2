import { describe, expect, it } from 'vitest';
import { trackingNumberIssue } from './tracking-number';

// #551 的守門。
//
// 🔴🔴 **本檔最容易寫錯的地方,主視窗 2026-08-16 先點名了,所以先寫在這裡**:
//    「對【不驗的東西】斷言『沒有錯誤』**永遠成立**」⇒ `sf` / `other` 那幾格天生恆綠。
//    ⇒ **修法:每一格 `sf`/`other` 的 `null` 斷言,都配一格【同一個值餵給 hct】的正向對照。**
//       沒有那半的話,「sf 沒被誤報」可能只是因為我隨手挑的那個值剛好是合法貨號。
//    ⚠️ 這也讓這族**有判別力**:哪天有人把實作改成「所有貨運商都驗」,sf 那幾格會紅。

// 合法貨號(算出來的,不是手推:`python3 -c "print(123456789 % 7)"` ⇒ 1)。
const VALID = '1234567891';
// 只有最後一碼不同 ⇒ 檢查碼不對,而長度與字元集都合法。
const BAD_CHECK = '1234567890';

describe('只驗 hct —— 而且要證明「沒被誤報」不是因為測資剛好合法', () => {
  it('🔴 sf 不驗檢查碼(規則未查證,不是豁免)', () => {
    expect(trackingNumberIssue('sf', BAD_CHECK)).toBeNull();
    // 🔴 **正向對照**:同一個值餵給 hct 會有意見 ⇒ 上面那個 `null` 是「沒驗」不是「驗過沒事」。
    expect(trackingNumberIssue('hct', BAD_CHECK)).not.toBeNull();
  });

  it('other / 未知代碼也不驗檢查碼', () => {
    expect(trackingNumberIssue('other', BAD_CHECK)).toBeNull();
    expect(trackingNumberIssue('zzz', BAD_CHECK)).toBeNull();
    expect(trackingNumberIssue('hct', BAD_CHECK)).not.toBeNull(); // 正向對照
  });
});

describe('hct:🔴 三條【全部只警告】—— 本 lib 不擋任何東西(Q-C551=乙)', () => {
  it('合法貨號 ⇒ 沒問題', () => {
    expect(trackingNumberIssue('hct', VALID)).toBeNull();
    expect(trackingNumberIssue('hct', ` ${VALID} `)).toBeNull(); // 前後空白不算錯
  });

  it('🔴🔴 「長度必須是 10」那條【已經拿掉】,不是降級 —— Sean 說每家貨運不一樣', () => {
    // Sean 2026-08-16 逐字「我們每一家貨運都不一樣,不限制多少數字或者號碼,最長 39位數」。
    // ⇒ 9 碼、11 碼、非數字…**通通不出意見**。留著那條會對 sf 噪音誤報,
    //   而噪音警告的下場是被無視 —— 那會連帶讓【真正的】警告失效。
    for (const ok of ['123456789', '12345678912', 'ABC', 'ABCDEFGHIJ', '12345 6789', 'SF-2026-0042']) {
      expect(trackingNumberIssue('hct', ok), `${ok} 不該有任何意見`).toBeNull();
    }
  });

  it('🔴🔴 上限 39 的正負對照 —— 沒有這格,「不限位數」會被讀成「完全不檢查」', () => {
    // 39 這個數字的出處:**Sean 口述,未見書面來源**(不是查證結果)。
    const n = (len: number) => '1'.repeat(len);
    expect(trackingNumberIssue('hct', n(39)), '39 位是上限本身，要過').toBeNull();
    expect(trackingNumberIssue('hct', n(40))?.level, '40 位要警告').toBe('warn');
    // 🔴 上限是【全部貨運商】共用的,不是 hct 專屬 ⇒ sf / other / 未知碼都要接住。
    for (const c of ['sf', 'other', 'zzz']) {
      expect(trackingNumberIssue(c, n(39)), `${c} 39 位要過`).toBeNull();
      expect(trackingNumberIssue(c, n(40))?.level, `${c} 40 位要警告`).toBe('warn');
    }
  });

  it('🔴🔴 全域斷言:【沒有任何輸入】會回 block —— 這是本片最重要的一格', () => {
    // ⚠️ **這格【抓不到什麼】要先講**:實作若整支恆回 null，它照樣綠 ⇒ **不能當覆蓋率證據**。
    //    它是**單向**的:只證「沒有 block」，不證「該警告的有警告」（那是上面那幾格的事）。
    // 🔴 為什麼還要它:上面那幾格是逐條釘，而這一格釘的是**性質**——
    //    下一個人只要在任何一條分支寫回 'block'，這格就紅，不必等他改到被釘住的那幾條。
    //    ⚠️ 「擋住員工」的真實後果不是他停下來回報，是他把貨運商改成「其他」硬送
    //       ⇒ 資料被寫壞而且事後看不出來。那比擋住他嚴重一級。
    const inputs = ['', '   ', 'ABC', '123456789', '12345678912', 'ABCDEFGHIJ', '１２３４５６７８９０',
      '12345 6789', '1234567890', VALID, '0000000000', '1'.repeat(40), '1'.repeat(39)];
    for (const carrier of ['hct', 'sf', 'other', 'zzz']) {
      for (const v of inputs) {
        expect(trackingNumberIssue(carrier, v)?.level, `${carrier} / "${v}" 回了 block`).not.toBe('block');
      }
    }
  });

  it('🔴 「必須純數字」那條也拿掉了 —— Sean 逐字「不限制多少數字或者【號碼】」', () => {
    for (const ok of ['ABCDEFGHIJ', '12345 6789', '１２３４５６７８９０']) {
      expect(trackingNumberIssue('hct', ok), `${ok} 不該有任何意見`).toBeNull();
    }
  });

  it('🔴🔴 檢查碼不對 ⇒ 只 warn,【不】block', () => {
    const r = trackingNumberIssue('hct', BAD_CHECK);
    expect(r?.level).toBe('warn');
    // 🔴 **這一格釘的是一個【刻意的弱】,不是漏做**:檢查碼規則只有參考檔一行寫過,
    //    而同檔 §8 說那兩份 PDF 是否為最新版未確認 ⇒ 規則若已改版,「擋」會讓員工出不了貨。
    //    ⚠️ 有人拿真貨號對過一次之後要來把它升成 'block' —— 那時**本格會紅,而那是對的**。
    expect(r?.level).not.toBe('block');
    // 🔴 訊息要帶出「應該是幾」。**原本寫 toContain('1') 是假綠**(R1 MF4)——
    //    訊息固定含「第 **1**0 碼」⇒ 算式改成 %10、訊息寫「應該是 5」,那格照樣綠。
    expect(r?.message).toContain('應該是 1');
    // 🔴 而且不可以再說「新竹會再驗」(R1 MF3:我們沒串 HCT API,沒有人會再驗)。
    expect(r?.message).not.toContain('新竹那邊會再驗');
    expect(r?.message).toContain('沒有人會再幫你抓這個錯');
  });

  it('空字串不歸這裡管(「還沒填」與「填錯了」是兩件事)', () => {
    expect(trackingNumberIssue('hct', '')).toBeNull();
    expect(trackingNumberIssue('hct', '   ')).toBeNull();
  });

  it('檢查碼 0 的情形也要算對(不要被 falsy 吃掉)', () => {
    // 000000000 % 7 = 0 ⇒ 第 10 碼是 '0'。
    expect(trackingNumberIssue('hct', '0000000000')).toBeNull();
    expect(trackingNumberIssue('hct', '0000000001')?.level).toBe('warn');
  });
});
