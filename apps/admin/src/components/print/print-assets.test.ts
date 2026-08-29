// 守門:`print-assets.ts` 裡的 base64 常數, 必須與 `public/print/` 底下的 png【逐位元組一致】。
//
// 🔴 **它防的是這一片自己的失敗模式**(2026-08-29 線A;主視窗 `-06` 裁 D′):
//    那兩個常數是【產生出來的】⇒ 有人換了 png 而沒重跑產生器 ⇒ **安靜地印舊 LOGO**。
//    ⇒ 而那正是「錯的那次和對的那次長得一樣」—— 紙照樣印得出來, 只是圖是舊的。
//
// 🔴🔴 **而本檔【讀不到 png 時必須紅, 不得 skip】**(主視窗加的那一格):
//    一個「找不到檔就跳過」的測試, 在檔被刪掉時**全綠** ——
//    那正是這一片在躲的那個失敗模式, 從測試那一側跑回來。
//    ⇒ 所以下面一律用 `readFileSync` 直接讀, 讓它自己丟;不做 existsSync 分支、不 try/catch。
//
// ⚠️ **本檔證得到什麼**:常數與磁碟上的 png 一致。
//    **證不到**:那張圖在正式站的 HTML 裡真的出現了 —— 那要在【沒有 cookie 的伺服器端請求】裡量。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LOGO_DATA_URI, QR_DATA_URI } from './print-assets';

// 🔴 路徑從【本檔自己的位置】推, 不從 process.cwd() ——
//    cwd 由跑測試的人決定(repo 根 / apps/admin / worktree), 而本檔與 png 的相對關係是固定的。
const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_PRINT = join(HERE, '../../../public/print');

const CASES = [
  { name: 'LOGO', file: 'logo-p2-bicolor.png', uri: LOGO_DATA_URI },
  { name: 'QR', file: 'line-qr.png', uri: QR_DATA_URI },
] as const;

const PREFIX = 'data:image/png;base64,';

describe('print-assets:常數必須等於磁碟上的 png', () => {
  it.each(CASES)('$name 的 base64 與 $file 逐位元組一致', ({ file, uri }) => {
    // 讀不到就讓它丟 —— 這一行是本檔「不得 skip」那條紀律的實作。
    const raw = readFileSync(join(PUBLIC_PRINT, file));
    expect(raw.length, `${file} 是空的 ⇒ 空的 base64 會安靜地變成一張看不見的圖`).toBeGreaterThan(0);
    expect(uri.startsWith(PREFIX), `${file} 的常數少了 ${PREFIX} 前綴`).toBe(true);
    expect(uri.slice(PREFIX.length)).toBe(raw.toString('base64'));
  });

  // 🔴 這一格不是重複:上面驗「值對不對」, 這一格驗「它是不是一個【瀏覽器不會再發請求】的東西」。
  //    本片存在的理由就是【那張圖不得是一個要登入才拿得到的網址】。
  it.each(CASES)('$name 是內嵌 data URI —— 不是任何會發出請求的網址', ({ uri }) => {
    expect(uri.startsWith(PREFIX)).toBe(true);
    expect(uri).not.toMatch(/^\/print\//); // 舊形狀:走 proxy 登入閘 ⇒ 無 cookie 被 303
    expect(uri).not.toMatch(/^https?:\/\//);
    expect(uri).not.toMatch(/^\/_next\//);
  });

  // ⚠️ 正對照:證明上面那把尺【看得到差異】, 而不是恆真。
  // ⛔ ~~原版寫成 `expect(tampered).not.toBe(real)`~~ 🛑 **2026-08-29 code-reviewer 抓到:**
  //    **那一格從頭到尾沒有引用 `LOGO_DATA_URI`, 也沒有跑任何比較 —— 它在測 `String.slice`。**
  //    📌 而它上面那句註解宣稱「沒有這一格的話,『兩個常數都對』與『比較根本沒執行』印同一個綠」
  //       ⇒ **那句話不成立**:它對「比較根本沒執行」一樣失明。
  //    ✅ 改法:把 tampered 餵進【與真斷言同一個形狀的比較】, 而且左邊必須是【那個常數本身】。
  // ⚠️ 另一格 reviewer 抓到的:原本的 tampered 是動最後一個字元,
  //    而 base64 結尾是 `A=` / `BA` 這類組合時它會【等於 real】⇒ 換一張圖之後可能無故紅。
  //    ⇒ 改成動一個固定的中間位置, 並當場斷言它真的不同。
  it('正對照:拿一個【改過的】base64 去餵同一個比較 ⇒ 必須不相等', () => {
    const raw = readFileSync(join(PUBLIC_PRINT, 'logo-p2-bicolor.png'));
    const real = raw.toString('base64');
    const i = 10;
    const tampered = `${real.slice(0, i)}${real[i] === 'A' ? 'B' : 'A'}${real.slice(i + 1)}`;
    expect(tampered, '突變沒改到東西 ⇒ 本格作廢').not.toBe(real);
    // 🔴 這一行才是正對照的本體:左邊是【真的常數】, 比較是【與上面那格同一個】。
    expect(LOGO_DATA_URI.slice(PREFIX.length)).not.toBe(tampered);
    // 而反面:沒改過的必須相等 —— 兩句一起才說得出「這把尺分得出 same/diff 兩個世界」。
    expect(LOGO_DATA_URI.slice(PREFIX.length)).toBe(real);
  });
});
