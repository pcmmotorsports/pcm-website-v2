// strip-pictographs 守門(`#240`/Q1-A1)。
//
// 🔴 這支最重要的不是「emoji 被拿掉了」那一格, 是它旁邊的**負對照**:
//    **餵純中文名 ⇒ 輸出逐字不變。**
//    沒有它, 一個 `return null` 或「把所有字都濾掉」的實作**會通過上面那一格**。

import { describe, expect, it } from 'vitest';
import { stripPictographs } from './strip-pictographs';

describe('stripPictographs', () => {
  // 🔴 正式庫實查到的那一顆(2026-08-23):customers.name 裡的 U+1F3CD,LINE 登入帶進來的
  it('拿掉正式庫實際出現的那顆 U+1F3CD 🏍', () => {
    expect(stripPictographs('王小明🏍')).toBe('王小明');
    expect(stripPictographs('王小明🏍')).not.toContain('\u{1F3CD}');
  });

  // 🔴🔴 **負對照 —— 這一格不可省。** 它擋的是「把所有字都濾掉」那種實作。
  it('🔴 純中文名 ⇒ 逐字不變(沒有這格, 一個濾光一切的實作也會綠)', () => {
    for (const name of ['王小明', '陳美玲', '歐陽靖', '李 小 龍', 'Wang Xiaoming', '王小明(先生)']) {
      expect(stripPictographs(name)).toBe(name);
    }
  });

  // 🔴 罕用漢字 —— 它們**不是** emoji, 必須留著。
  //    這一格同時是「本檔沒有解決域外字」的證據:堃/㴪 留下來了, 而它們仍可能印成方框。
  it('🔴 罕用漢字逐字保留(而那也表示【它們的方框問題本檔沒有解決】)', () => {
    expect(stripPictographs('陳堃')).toBe('陳堃');
    expect(stripPictographs('林㴪')).toBe('林㴪');
  });

  it('多個 emoji / 夾在中間 / 帶膚色修飾 都拿得掉, 而中文原樣', () => {
    expect(stripPictographs('🏍王小明🏍')).toBe('王小明');
    expect(stripPictographs('王🏍小🎉明')).toBe('王小明');
    expect(stripPictographs('王小明👍🏽')).toBe('王小明');
  });

  it('濾掉之後的多餘空白會收掉, 而【字與字之間原有的單一空白留著】', () => {
    expect(stripPictographs('王小明 🏍 先生')).toBe('王小明 先生');
    expect(stripPictographs('  王小明🏍  ')).toBe('王小明');
    // 負對照:本來就有的單一空白不可以被吃掉
    expect(stripPictographs('Wang Xiao Ming')).toBe('Wang Xiao Ming');
  });

  // 🔴 整串被濾光 ⇒ 回 null 而不是空字串, 讓呼叫端走自己的缺值寫法(印「—」)
  it('整串都是 emoji ⇒ 回 null(不是空字串)', () => {
    expect(stripPictographs('🏍')).toBeNull();
    expect(stripPictographs('🏍🎉👍')).toBeNull();
    expect(stripPictographs('   ')).toBeNull();
  });

  // ══ 以下五格是 code-reviewer R1 抓出來的, 我第一版全部漏掉 ══════════════

  // 🔴🔴 **國旗** —— 台灣人的 LINE 名字帶 🇹🇼 是常態, 而我第一版的兩把尺**結構上看不見它**
  //    (實測 /\p{Extended_Pictographic}/u.test('\u{1F1F9}') ⇒ **false**;它是 Regional_Indicator)
  it('🔴 國旗 🇹🇼 要濾掉(Regional_Indicator 不在 Extended_Pictographic 裡)', () => {
    expect(stripPictographs('王小明🇹🇼')).toBe('王小明');
    expect(stripPictographs('🇹🇼')).toBeNull();
    expect(stripPictographs('王小明🇹🇼')).not.toContain('\u{1F1F9}');
  });

  // 🔴 keycap 的組合符 U+20E3 —— 只拿掉 VS16 會留下它, 而它是一個沒有東西可以組合的殘渣
  it('🔴 keycap 的殘渣 U+20E3 不得留下', () => {
    expect(stripPictographs('客人#️⃣號')).toBe('客人#號');
    expect(stripPictographs('客人#️⃣號')).not.toContain('\u{20E3}');
  });

  // 🔴 tag 字元(旗幟序列 🏴󠁧󠁢󠁳󠁣󠁴󠁿 拿掉本體後只剩看不見的 tag)
  it('🔴 tag 字元(U+E0020–U+E007F)不得留下', () => {
    const out = stripPictographs('王小明\u{1F3F4}\u{E0067}\u{E0062}\u{E007F}');
    expect(out).toBe('王小明');
  });

  // 🔴 ® 與 ™ **也帶 Extended_Pictographic**, 而它們在一般字型裡有字形 ⇒ **不該被濾掉**
  //    本檔住在共用 lib/print/ ⇒ 品牌名接上來那天, `Brembo®` 若安靜掉字會很難發現
  it('🔴 ® 與 ™ 要留著(它們有 Extended_Pictographic 屬性, 而不是印不出來的字)', () => {
    expect(stripPictographs('PCM® 原廠')).toBe('PCM® 原廠');
    expect(stripPictographs('Brembo™ 卡鉗')).toBe('Brembo™ 卡鉗');
  });

  // 🔴 沒有 emoji 的字串 ⇒ **逐字不動, 連空白都不收**
  //    (第一版無條件收空白 ⇒ 它會去改一個它不該碰的字串)
  it('🔴 沒有東西被濾掉時 ⇒ 輸入輸出逐字相同(含連續空白)', () => {
    for (const s of ['王  小明', ' 王小明 ', 'Wang   Xiao   Ming', '王小明']) {
      expect(stripPictographs(s)).toBe(s);
    }
  });

  // 🔴 astral 的**罕用漢字**(CJK 擴展 B)必須留著 —— 它與 emoji 同樣在 BMP 之外,
  //    而規則是「astral 且是 Extended_Pictographic」才砍。這一格釘住那個 AND。
  it('🔴 astral 的罕用漢字(𠀋, U+2000B)留著 —— 只砍 astral【且】是圖形符號的', () => {
    expect(stripPictographs('\u{2000B}田')).toBe('\u{2000B}田');
  });

  // ══ 複驗(R1-confirm)抓到的:我第一版的規則【碰巧答對而理由是錯的】══════════

  // 🔴🔴 `✨` `⭐` 在台灣 LINE 顯示名**比 🏍 常見得多**, 而我第一版的「BMP 就留」放它們過。
  it('🔴 BMP 而【彩色預設】的圖形符號要濾掉(✨⭐✅❗⏰⚡)', () => {
    expect(stripPictographs('小明✨')).toBe('小明');
    expect(stripPictographs('美美⭐')).toBe('美美');
    expect(stripPictographs('王✅明')).toBe('王明');
    expect(stripPictographs('急件❗')).toBe('急件');
    expect(stripPictographs('⏰提醒')).toBe('提醒');
    expect(stripPictographs('⚡快')).toBe('快');
    expect(stripPictographs('✨')).toBeNull();
  });

  // 🔴 而【文字預設呈現】的要留著 —— 判準不是「在不在 BMP」, 是 `Emoji_Presentation = false`
  //    (實測:☎ ⚠ ® ™ ❤ 五個的 Emoji_Presentation 全 = false ⇒ 文字字型本來就有它們)
  it('🔴 文字預設呈現的符號留著(☎ ⚠ ® ™ ❤)—— 而它們與上一格【同在 BMP】', () => {
    expect(stripPictographs('電話☎ 分機')).toBe('電話☎ 分機');
    expect(stripPictographs('注意⚠ 事項')).toBe('注意⚠ 事項');
    expect(stripPictographs('PCM® 原廠')).toBe('PCM® 原廠');
    expect(stripPictographs('Brembo™ 卡鉗')).toBe('Brembo™ 卡鉗');
    expect(stripPictographs('我❤你')).toBe('我❤你');
  });

  // 🔴 這一格釘住「兩個 alternation 各自擋一種」——
  //    🏍 的 Emoji_Presentation 是 **false** ⇒ 只靠下面那條會漏掉它(候選①的錯)
  //    ✨ 不在 astral ⇒ 只靠上面那條會漏掉它(我第一版的錯)
  //    ⇒ **兩條都要在。** 拿掉任何一條, 這一格會紅。
  it('🔴 兩條規則缺一不可:🏍(astral 而非彩色預設)與 ✨(彩色預設而非 astral)都要濾掉', () => {
    expect(stripPictographs('a🏍b✨c')).toBe('abc');
  });

  it('null / undefined / 空字串 ⇒ null(不炸)', () => {
    expect(stripPictographs(null)).toBeNull();
    expect(stripPictographs(undefined)).toBeNull();
    expect(stripPictographs('')).toBeNull();
  });
});
