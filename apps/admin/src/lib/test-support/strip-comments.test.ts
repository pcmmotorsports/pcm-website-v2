import { describe, expect, it } from 'vitest';

import { stripComments } from './strip-comments';

// strip-comments.test.ts — 每一格都成對:一個「它該剝掉」+ 一個「它不准剝掉」。
// 🔴 只驗「註解不見了」是不夠的 —— 一支【把整份檔清空】的實作會讓那一半全綠。

const B = String.fromCharCode(96); // 反引號:不寫進 heredoc,免得被 shell 吃掉

describe('stripComments — 該剝掉的', () => {
  it('行註解與區塊註解都變成等長空白,而換行保留', () => {
    const src = 'const a = 1; // 註解\n/* 區塊\n多行 */\nconst b = 2;\n';
    const out = stripComments(src, 'x.ts');
    expect(out).toHaveLength(src.length);
    expect(out.split('\n')).toHaveLength(src.split('\n').length);
    expect(out).not.toContain('註解');
    expect(out).not.toContain('區塊');
    // 🔵 正對照:真程式碼一個字都不准少
    expect(out).toContain('const a = 1;');
    expect(out).toContain('const b = 2;');
  });

  it('JSX 裡的 {/* … */} 也剝得掉(掛在 } 上,forEachChild 會漏)', () => {
    const src = 'const x = <div>{/* 藏起來 */}<b>看得見</b></div>;\n';
    const out = stripComments(src, 'x.tsx');
    expect(out).not.toContain('藏起來');
    expect(out).toContain('看得見');
  });
});

describe('🔴 不准剝掉的 —— 這四格就是 regex 版死掉的地方', () => {
  it('🔴🔴 行註解裡的 `*/` 不得開一個假區塊(-08 R2 實測:206 行真碼 / 27 支檔消失)', () => {
    // 這正是 PreviewHarness.tsx:8 的形狀:一個行註解裡帶著 `*` 與 `/`
    const src = ['// dev-preview/*', 'const KEEP_ME = 1;', 'const b = "a */ b";', 'const AFTER = 2;'].join('\n');
    const out = stripComments(src, 'x.tsx');
    expect(out, '中間那段真程式碼被吃掉了').toContain('KEEP_ME');
    expect(out, '假區塊收尾之後那一段也被吃掉了').toContain('AFTER');
    // 🔵 而它確實有剝到東西(否則這一格會被「什麼都不做」的實作矇過去)
    expect(out).not.toContain('dev-preview');
  });

  // 🔴🔴 **這兩格是從 `product-repository.test.ts` 接走的覆蓋**(-48 2026-08-31 的放行條件):
  //    那裡原本有兩個 `it.fails('已知上限…(修好了就刪這格)')` 在記錄舊 regex 的這兩個缺陷。
  //    parser 版修好之後它們「預期失敗而成功」⇒ 自己叫了 ⇒ 照作者的指示刪掉。
  //    🛑 **而刪掉之前必須先把形狀搬過來** —— 否則刪掉的是【唯一在記錄它們的東西】。
  //    ✅ 已驗:把本模組換回舊 regex 版(突變)⇒ 這兩格會紅。
  it('🔴 接走①:protocol-relative URL(`//cdn/x`)不是行註解', () => {
    // 舊 regex 用 `(?<!:)` 排除 `https://`,而 protocol-relative 的 `//` 前面【沒有冒號】⇒ 被吃掉
    const src = "const u = '//cdn/x/price_store'; const AFTER = 1;\n";
    const out = stripComments(src, 'x.ts');
    expect(out).toContain('price_store');
    expect(out).toContain('const AFTER = 1;');
  });

  it('🔴 接走②:字串裡的 /* 與 */ 不得把中間的真程式碼吃掉', () => {
    const src = "const a = '/*'; const b = row.price_store; const c = '*/';\n";
    expect(stripComments(src, 'x.ts')).toContain('price_store');
  });

  it('字串裡的 // 與 /* 不是註解', () => {
    const src = 'const u = "https://example.com/a"; const g = "src/*"; const k = 1;\n';
    const out = stripComments(src, 'x.ts');
    expect(out).toContain('https://example.com/a');
    expect(out).toContain('src/*');
    expect(out).toContain('const k = 1;');
  });

  it('帶 ${} 的 template 不得讓它從那裡開始錯讀(裸 scanner 死在這裡)', () => {
    const src = 'const m = ' + B + '缺少必要環境變數:${name}' + B + '; const AFTER = 3; // 走\n';
    const out = stripComments(src, 'x.ts');
    expect(out).toContain('${name}');
    expect(out).toContain('const AFTER = 3;');
    expect(out).not.toContain('走');
  });

  it('正則字面裡的 */ 不得開區塊', () => {
    const src = 'const re = /a*\\/b/; const AFTER = 4;\n';
    const out = stripComments(src, 'x.ts');
    expect(out).toContain('const AFTER = 4;');
  });
});

describe('🔴 這支實作自己的射程,寫成會執行的東西', () => {
  it('🔴 省略 fileName 時預設當 `.ts` —— 而那個預設是量出來的(641 支檔實測 0 支不同)', () => {
    const src = 'const a = 1; // x\n';
    expect(stripComments(src)).toBe(stripComments(src, 'anything.ts'));
    // 🔵 而它與 .tsx 不同(型別斷言那格)⇒ 預設值真的在承重,不是裝飾
    const asrt = 'const a = <string>b; /* C */ const AFTER = 2;\n';
    expect(stripComments(asrt)).not.toBe(stripComments(asrt, 'x.tsx'));
  });

  it('回傳長度恆等於輸入長度(位移保證 —— importers 那支的 ^ 錨依賴它)', () => {
    for (const [src, name] of [
      ['const a = 1; // x\n', 'a.ts'],
      ['/* 多\n行 */ const b = 2;\n', 'b.ts'],
      ['const c = <p>{/* j */}q</p>;\n', 'c.tsx'],
      ['', 'd.ts'],
    ] as const) {
      expect(stripComments(src, name), name).toHaveLength(src.length);
    }
  });

  it('🔴 副檔名參數【真的在承重】—— 而我是找了五種形狀才找到會分歧的那一種', () => {
    // ⛔ 我第一版拿 `<div>{/* 藏 */}留</div>` 當例子 ⇒ **兩種 ScriptKind 輸出【完全相同】**
    //    ⇒ 那一格證不出參數有在承重。舊例子留著當紀錄:五種候選裡三種都是「同」
    //    (泛型箭頭 `<T,>` / 斷言後接註解 / JSX 屬性內註解)。
    // ✅ 真的會分歧的是**型別斷言**:`<string>b` 在 TSX 底下被讀成一個沒收尾的 JSX 元素。
    const src = 'const a = <string>b; /* C2 */ const AFTER = 2;\n';
    expect(stripComments(src, 'x.ts'), '.ts 該剝掉那段註解').not.toContain('C2');
    expect(stripComments(src, 'x.tsx'), '.tsx 讀錯 ⇒ 那段註解【剝不掉】').toContain('C2');
    // 🔴 而方向要講清楚:判錯 ScriptKind 時註解會**留下來**(掃描器看到更多字)
    //    ⇒ 那是**誤紅**方向,不是漏放 —— 與檔頭那條盲區①同向。
    expect(stripComments(src, 'x.ts')).not.toBe(stripComments(src, 'x.tsx'));
  });

  it('🔵 負對照:一支「什麼都不剝」的假實作必須讓上面那些「該剝掉」的格子紅', () => {
    const fake = (s: string): string => s;
    const src = 'const a = 1; // 註解\n';
    expect(fake(src)).toContain('註解'); // ⇒ 若拿 fake 換掉本模組,第一個 describe 會紅
    expect(stripComments(src, 'x.ts')).not.toContain('註解');
  });
});
