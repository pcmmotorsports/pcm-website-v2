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
  it('🔴 sf 不驗(規則未查證,不是豁免)', () => {
    expect(trackingNumberIssue('sf', BAD_CHECK)).toBeNull();
    expect(trackingNumberIssue('sf', 'ABC')).toBeNull();
    // 🔴 **正向對照**:同樣這兩個值餵給 hct 都會有問題 ⇒ 上面兩個 `null` 是「沒驗」不是「驗過沒事」。
    expect(trackingNumberIssue('hct', BAD_CHECK)).not.toBeNull();
    expect(trackingNumberIssue('hct', 'ABC')).not.toBeNull();
  });

  it('other 不驗(自取/自送本來就沒有貨號)', () => {
    expect(trackingNumberIssue('other', 'ABC')).toBeNull();
    expect(trackingNumberIssue('hct', 'ABC')).not.toBeNull(); // 正向對照,同上
  });

  it('未知代碼也不驗 —— 我們對它一無所知,不能假裝驗過', () => {
    expect(trackingNumberIssue('zzz', 'ABC')).toBeNull();
    expect(trackingNumberIssue('hct', 'ABC')).not.toBeNull();
  });
});

describe('hct:只有【長度】擋,字元集與檢查碼都只警告(R1 MF2 重新對齊證據強度)', () => {
  it('合法貨號 ⇒ 沒問題', () => {
    expect(trackingNumberIssue('hct', VALID)).toBeNull();
    expect(trackingNumberIssue('hct', ` ${VALID} `)).toBeNull(); // 前後空白不算錯
  });

  it('🔴 長度不是 10 ⇒ block(四處、跨兩章節印證,本檔證據最硬的一條)', () => {
    for (const bad of ['123456789', '12345678912', 'ABC']) {
      expect(trackingNumberIssue('hct', bad)?.level, `${bad} 長度不對，應該被擋`).toBe('block');
    }
  });

  it('🔴🔴 長度對但不是純數字 ⇒ 只 warn,【不】block(R1 MF2:它與檢查碼同源同級)', () => {
    // 「純數字」只在參考檔出現一次，而且就在「檢查碼」的【相鄰上一行】、同一份 PDF。
    // ⇒ 我第一版把它擋、把檢查碼放行，兩者證據一樣弱而分成兩級 = 分級理由與結果對不上。
    for (const bad of ['ABCDEFGHIJ', '12345 6789', '１２３４５６７８９０']) {
      const r = trackingNumberIssue('hct', bad);
      expect(r?.level, `${bad} 長度是 10，只該警告`).toBe('warn');
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
