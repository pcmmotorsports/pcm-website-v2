// rpm-title-language.test.ts — Q31 品名語言報告
//
// 🔴 **本檔要釘住的三格, 而它們各自防一個【已經發生過】的病**:
//   ① **只印不擋** —— 下一個人會很想把它改成擋。而擋了等於為一個猜測停掉整家同步
//      (`title-shape-gate.ts:10` 的既有哲學)。⇒ 一格斷言:它不 throw、回傳報告。
//   ② **零件英文名時仍然印「0 列」** —— 一個只在有東西時才出現的報告,
//      與「這道檢查根本沒跑」在畫面上長同一個樣子。⇒ 那是本 repo 記過的「該叫才叫」。
//   ③ **兩個數由同一份 rows 算出來** —— 呼叫端不得有機會傳一個對不起來的分母
//      (理由見被測檔檔頭引的 `rpm-preflight.ts:390-394`)。
//
// 🧬 **突變自檢 —— 2026-09-03 實跑, 兩發都還原並 `diff -q` 驗過逐字相同**:
//   · 突變①  把 `printTitleLanguageReport` 裡那個 `console.log` 整段拿掉
//            ⇒ **4 格紅**(1 file failed)
//   · 突變②  在 `console.log` 前插 `if (r.noChinese === 0) return r;`(= 製造「該叫才叫」)
//            ⇒ **恰好 1 格紅, 而且正是「零件英文名時仍然要印 0 列」那一格**
//   ⇒ 📌 **②那一發是精準擊殺** —— 它證明那一格不是靠別格順便通過的。
//   ⛔ ~~「把判準改成『zh 欄是空的』⇒ 那格紅」~~ —— **那個突變我原本寫在這裡而它【不適用】**:
//      本檔的函式**根本不收 `product_name_zh`**(判準 B 只看顯示用 `title`)⇒ 構造不出來。
//      🔴 留著這一句是刻意的:**一個沒跑過的突變宣稱, 與跑過的長得一模一樣。**
//   · 突變③  把 `rpm-import.ts` 那行呼叫刪掉 ⇒ **2 格紅**(接線守門那兩格)
//            🔴 而這一格是 **code-reviewer 2026-09-03 抓的** —— 本檔第一版沒有接線守門,
//               刪掉接線之後 **10 格全綠**。⇒ 📌 **判別式全對而沒接上, 每一格都還是綠的。**
//   ⇒ 📌 而**沒有一格是靠「跑得完」通過的** —— 每一格都比對輸出字面。
//
// 🔵 **而 `capture()` 自己踩過一次, 留著**:第一版只攔 `console.log`, 而實作把 >0 那條改走 `console.warn`
//    ⇒ **3 格紅, 而實作是對的** —— 那是**尺比被測的東西窄**, 不是程式壞掉。
//    📌 判別句:紅的時候先問「是實作錯了, 還是我的尺看不到那個世界」。

import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import {
  hasChineseChar,
  countTitlesWithoutChinese,
  printTitleLanguageReport,
} from './rpm-title-language';

/**
 * 抓 console 的字面 —— 報告的價值全在那一行字上, 不在回傳值。
 * 🔴 **log 與 warn 兩條都要攔**:>0 走 warn、0 走 log(與 `rpm-preflight.ts:405` 同族)。
 *    本檔第一版只攔 log ⇒ 三格紅, 而**那是尺比被測的東西窄**, 不是實作壞掉。
 */
function capture(fn: () => void): string {
  const out: string[] = [];
  const push = (...a: unknown[]) => { out.push(a.map(String).join(' ')); };
  const spies = [
    vi.spyOn(console, 'log').mockImplementation(push),
    vi.spyOn(console, 'warn').mockImplementation(push),
  ];
  try {
    fn();
  } finally {
    for (const sp of spies) sp.mockRestore();
  }
  return out.join('\n');
}

describe('hasChineseChar', () => {
  it('中文字要認得出來', () => {
    expect(hasChineseChar('碳纖維前土除')).toBe(true);
    expect(hasChineseChar('碳纖維 Front Fender')).toBe(true); // 中英混雜 ⇒ 有中文
  });

  it('🔴 純英文 / 純型號 / 純符號都算「沒有中文」', () => {
    expect(hasChineseChar('Quad Lock MAG Ring')).toBe(false);
    expect(hasChineseChar('360°')).toBe(false);
    expect(hasChineseChar('AKRAPOVIČ')).toBe(false); // 重音拉丁字仍是拉丁字
  });

  it('🔵 假名不是漢字 —— 本尺只認 Han, 這一格把射程釘住', () => {
    expect(hasChineseChar('ハンドル')).toBe(false);
  });
});

describe('countTitlesWithoutChinese —— 兩個數由同一份 rows 算出來', () => {
  it('分子分母都對, 而 ids 指得出是哪幾列', () => {
    const r = countTitlesWithoutChinese([
      { external_id: 'A1', title: '碳纖維前土除' },
      { external_id: 'A2', title: 'Quad Lock MAG Ring' },
      { external_id: 'A3', title: '360°' },
    ]);
    expect(r.total).toBe(3);
    expect(r.noChinese).toBe(2);
    expect(r.ids).toEqual(['A2', 'A3']);
  });

  it('🔴 空陣列 ⇒ 分母 0 而不是爆掉', () => {
    expect(countTitlesWithoutChinese([])).toEqual({ total: 0, noChinese: 0, ids: [] });
  });

  it('🔴 中英混雜【不】算英文名 —— 那是本尺的假陰性, 釘住它免得有人以為修好了', () => {
    const r = countTitlesWithoutChinese([{ external_id: 'B1', title: '碳纖維 Front Fender' }]);
    expect(r.noChinese).toBe(0);
  });
});

describe('printTitleLanguageReport', () => {
  it('🔴 ① 只印不擋 —— 不 throw, 而且把報告回傳給呼叫端', () => {
    const rows = [{ external_id: 'A2', title: 'Quad Lock MAG Ring' }];
    let r: ReturnType<typeof printTitleLanguageReport> | undefined;
    const out = capture(() => {
      r = printTitleLanguageReport(rows, true);
    });
    expect(r).toEqual({ total: 1, noChinese: 1, ids: ['A2'] });
    expect(out).toContain('本次 1 個商品, 其中 1 個品名沒有中文字');
  });

  it('🔴🔴 ② 零件英文名時【仍然要印 0 列】—— 只在有東西時才出現的報告與沒跑長一樣', () => {
    const out = capture(() => {
      printTitleLanguageReport([{ external_id: 'A1', title: '碳纖維前土除' }], true);
    });
    expect(out).toContain('品名語言 gate');
    expect(out).toContain('本次 1 個商品, 其中 0 個品名沒有中文字');
  });

  it('🔴 ③ 那一行字要帶【射程】—— 分母是本次轉換出的商品數, 不是上架件數', () => {
    const out = capture(() => printTitleLanguageReport([{ external_id: 'A1', title: 'X' }], true));
    expect(out).toContain('分母=本次轉換出的商品數');
    expect(out).toContain('判法=顯示用品名無中文字元');
  });

  it('🛑 而它不可以說「沒翻好」也不可以說「英文名」—— 兩句各宣稱了一個我們量不到的東西', () => {
    // 「沒翻好」= 翻了但翻錯, 形狀檢查答不出來
    // 「英文名」= 本尺跑在 title-shape-gate 之前 ⇒ `#N/A` / `TBD` 這種壞名也在分子裡
    const out = capture(() => printTitleLanguageReport([{ external_id: 'A1', title: '#N/A' }], true));
    expect(out).toContain('品名沒有中文字');
    expect(out).not.toContain('沒翻好');
    expect(out).not.toContain('還是英文');
  });

  it('🔴 --group/--limit 下要標【篩選後、非全量比例】—— 否則 --limit 5 會印出假的全綠', () => {
    const rows = [{ external_id: 'A1', title: '碳纖維前土除' }];
    expect(capture(() => printTitleLanguageReport(rows, false))).toContain('(篩選後、非全量比例)');
    expect(capture(() => printTitleLanguageReport(rows, true))).not.toContain('篩選後');
  });

  it('🔴 ids 要【印出來】—— 算得出來而沒有人看得到, 那句「供人抽查」就是假的宣稱', () => {
    const many = Array.from({ length: 33 }, (_, i) => ({ external_id: `E${i}`, title: 'X' }));
    const warn: string[] = [];
    const w = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
      warn.push(a.map(String).join(' '));
    });
    try {
      printTitleLanguageReport(many, true);
    } finally {
      w.mockRestore();
    }
    const joined = warn.join('\n');
    expect(joined).toContain('料號:');
    expect(joined).toContain('E0');
    expect(joined).toContain('(另有 3 個未列)'); // 33 - 30
  });
});

describe('🔴🔴 接線守門 —— 這一發在 rpm-import.ts 把呼叫刪掉時會紅', () => {
  // 判別式全對而【沒接上去】, 上面每一格都還是綠的。
  // 只有讀 rpm-import.ts 的原始碼才看得到這件事 —— 樣板抄 title-shape-gate.test.ts:226。
  // 🔴 而 code-reviewer 2026-09-03 抓到的正是這一格:本檔第一版沒有它, 刪掉接線 10 格全綠。
  const code = readFileSync(new URL('./rpm-import.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1'); // 剝註解:註解裡提到不算接上

  it('rpm-import.ts 有 import 它', () => {
    expect(code).toMatch(/import\s*\{[^}]*printTitleLanguageReport[^}]*\}\s*from\s*'\.\/rpm-title-language'/);
  });

  it('rpm-import.ts 有【呼叫】它, 而且分母是 productRows', () => {
    expect(code, '沒有呼叫 ⇒ 這道報告沒有裝上').toMatch(/printTitleLanguageReport\s*\(\s*productRows\s*,/);
  });

  it('🔴 有把 FULL_MODE 傳進去 —— 不傳的話 --limit 會印出假的全綠', () => {
    expect(code).toMatch(/printTitleLanguageReport\([\s\S]{0,60}FULL_MODE/);
  });
});
