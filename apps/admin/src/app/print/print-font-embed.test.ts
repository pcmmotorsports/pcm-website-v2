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
    for (const w of ['400', '700']) {
      expect(code, `少了 ${w} 那一行 ⇒ 那個字重在沒有 Noto 的機器上會換字, 而沒有東西會紅`)
        .toContain(`@fontsource/noto-sans-tc/${w}.css`);
    }
  });

  it('🔴 admin 自己的 package.json 有這個相依(不靠 workspace 別人裝了)', () => {
    const pkg = JSON.parse(read('../../../package.json')) as {
      dependencies?: Record<string, string>;
    };
    expect(
      pkg.dependencies?.['@fontsource/noto-sans-tc'],
      '顧客站有而後台沒有 ⇒ 本機看起來會動(pnpm 提升), 而後台自己的部署裝不到它',
    ).toBeTruthy();
  });

  /**
   * 🔵 兩行 import 只是讓 `'Noto Sans TC'` 這個名字**解析得到** ——
   *    真正決定紙上用哪支字的是 CSS 的字體鏈。**把名字從鏈上拿掉, import 就白裝了。**
   * 🛑 而 `--pd-mono` **不在這一格裡** —— 它刻意不含 Noto(理由在 layout.tsx)。
   */
  it('🔴 print-a4.css 的 --pd-body / --pd-disp 字體鏈上有 Noto Sans TC', () => {
    const css = read('./print-a4.css');
    for (const v of ['--pd-body', '--pd-disp']) {
      const line = css.split('\n').find((l) => l.includes(`${v}:`));
      expect(line, `${v} 這一行找不到 ⇒ 這把尺量錯檔了`).toBeTruthy();
      expect(line, `${v} 的鏈上沒有 Noto Sans TC ⇒ 那兩行 import 裝了也用不到`)
        .toContain('Noto Sans TC');
    }
    // 🟢 負對照:mono 那條鏈【不該】有 —— 它有的話是有人把字型問題換成了數字對不齊。
    const mono = css.split('\n').find((l) => l.includes('--pd-mono:'));
    expect(mono).toBeTruthy();
    expect(mono, 'mono 鏈補了 Noto ⇒ 沒有等寬字的機器上數字欄位會對不齊').not.toContain(
      'Noto Sans TC',
    );
  });
});
