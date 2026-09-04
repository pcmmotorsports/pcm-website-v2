import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// print-font-embed.test.ts — ⟦ship-PRINTNOFONT1⟧ / ⟦ship-PRINTCARON1⟧ 的守門。
//
// 🔴🔴 **它守的是一個【不會叫】的失敗。**
//    把兩行 import 刪掉 ⇒ typecheck 綠、lint 綠、build 綠、所有既有測試綠,
//    而**紙上換了一種字** —— 而那看起來只是醜, 不像壞掉 ⇒ 沒有人會回報。
//
// 🛑 **本檔一律先去註解再掃** —— 上面這段話與 `layout.tsx` 的長註解都逐字寫著
//    `@fontsource/noto-sans-tc` ⇒ 掃原始檔的話, **import 被刪掉它照樣全綠**。
//    📌 那正是這一族最常見的假綠:註解在替被刪掉的碼作證。

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** 去掉 `/* *\/` 與 `//` 註解。🔴 回傳值要與原文**不同**, 否則下面每一格都是恆綠的。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('⟦ship-PRINTNOFONT1⟧ 字型要【帶在紙上】, 不靠對方機器有', () => {
  it('🔴 print layout 真的 import 了 400 / 700(去註解之後才算)', () => {
    const raw = read('./layout.tsx');
    const code = stripComments(raw);
    // 🟢 尺會動:去註解之後真的少了東西(否則下面兩行在掃註解)。
    expect(code.length, '去註解之後長度沒變 ⇒ 這把尺根本沒在去註解').toBeLessThan(raw.length);
    // 🟢 正對照:碼還在。
    expect(code).toContain('export default function PrintLayout');
    // 🔴 **兩個套件各兩個字重** —— 拉丁那支(`noto-sans`)接 Č / Š, 中日韓那支(`noto-sans-tc`)接中文。
    for (const pkg of ['noto-sans', 'noto-sans-tc']) {
      for (const w of ['400', '700']) {
        expect(code, `少了 ${pkg}/${w} 那一行 ⇒ 那個字在沒有 Noto 的機器上會換字, 而沒有東西會紅`)
          .toContain(`@fontsource/${pkg}/${w}.css`);
      }
    }
  });

  it('🔴 admin 自己的 package.json 有這個相依(不靠 workspace 別人裝了)', () => {
    const pkg = JSON.parse(read('../../../package.json')) as {
      dependencies?: Record<string, string>;
    };
    for (const name of ['@fontsource/noto-sans', '@fontsource/noto-sans-tc']) {
      expect(
        pkg.dependencies?.[name],
        `${name} 不在自己的 dependencies ⇒ 本機看起來會動(pnpm 提升), 而部署裝不到它`,
      ).toBeTruthy();
    }
  });

  /**
   * 🔵 兩行 import 只是讓 `'Noto Sans TC'` 這個名字**解析得到** ——
   *    真正決定紙上用哪支字的是 CSS 的字體鏈。**把名字從鏈上拿掉, import 就白裝了。**
   * 🛑 而 `--pd-mono` **不在這一格裡** —— 它刻意不含 Noto(理由在 layout.tsx)。
   */
  it('🔴 print-a4.css 的 --pd-body / --pd-disp 字體鏈上有 Noto Sans TC', () => {
    const css = read('./print-a4.css');
    for (const v of ['--pd-body', '--pd-disp']) {
      const line = css.split('\n').find((l) => l.trim().startsWith(`${v}:`));
      expect(line, `${v} 這一行找不到 ⇒ 這把尺量錯檔了`).toBeTruthy();
      expect(line, `${v} 的鏈上沒有 Noto Sans TC ⇒ 中文會掉回機器字型`).toContain('Noto Sans TC');
      /**
       * 🔴🔴 **兩件事, 而它們承重的不是同一格**(⟦ship-PRINTCARON1⟧;2026-09-04 訂正)。
       * · **`'Noto Sans'` 在不在鏈上** ⇒ 承重的是這個。拿掉它 ⇒ `Č` 掉回機器字型
       *   (真 PDF `CAAAAA+Helvetica` —— 而**那台機器上剛好有** ⇒ 在這裡看起來對)。
       * · **順序** ⇒ ⛔ ~~「排後面 Č 就沒救到」~~ **當場量:排後面 `Č` 仍由 NotoSans 畫**
       *   (TC 沒有那個字形 ⇒ 往下掉)。順序守的是**同一個字裡不要有兩種字形**:
       *   順序錯的整句量到 `AKRAPOVI 由 TC 畫 · Č 由 NotoSans 畫`。
       */
      const la = line!.indexOf(`'Noto Sans'`);
      const tc = line!.indexOf(`'Noto Sans TC'`);
      expect(la, `${v} 的鏈上沒有 'Noto Sans'(拉丁那支)⇒ Č / Š 會掉回機器字型`).toBeGreaterThan(-1);
      expect(la, `${v}:'Noto Sans' 排在 'Noto Sans TC' 後面 ⇒ 同一個字裡兩種字形(AKRAPOVI 由 TC 畫、Č 由 Noto Sans 畫)`)
        .toBeLessThan(tc);
    }
    // 🟢 負對照:mono 那條鏈【不該】有 —— 它有的話是有人把字型問題換成了數字對不齊。
    const mono = css.split('\n').find((l) => l.trim().startsWith('--pd-mono:'));
    expect(mono).toBeTruthy();
    expect(mono, 'mono 鏈補了 Noto ⇒ 沒有等寬字的機器上數字欄位會對不齊').not.toContain('Noto Sans');
  });
});
