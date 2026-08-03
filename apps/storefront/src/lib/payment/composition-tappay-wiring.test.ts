// composition-tappay-wiring.test.ts — composition 真的走 @pcm/adapters 的 tapPayUrlsFor
//(RW2a:原 tappay-endpoints.test.ts 第三格;URL 字面兩格已隨模組搬到
//  packages/adapters/src/tappay/endpoints.test.ts,本格守的是 storefront 自己的接線)
//
// 🔴 值比對證不了 composition 有用那個模組 —— 若有人把 composition 改回 inline URL 字面
// (繞過單一綁定點),URL 格照綠。本格直接觀察 composition 源碼:必須展開注入、
// 且不得再出現任何 tappaysdk 端點字面(單一來源 = @pcm/adapters/server 的 tapPayUrlsFor)。

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

describe('composition ↔ tapPayUrlsFor 接線(防 inline 回歸;codex 關卡2)', () => {
  it('🔴 含展開注入、零 tappaysdk 字面、import 來源=@pcm/adapters/server', () => {
    const src = readFileSync(path.join(__dirname, 'composition.ts'), 'utf8');
    expect(src).toMatch(/\.\.\.tapPayUrlsFor\(env\)/);
    expect(src).not.toMatch(/tappaysdk\.com/);
    // 🔴 釘 import 來源(code-reviewer R1 nit2):沒這行的話,有人在 storefront 新建本地
    // 同名模組(值對調)並改 import 它,前兩個斷言照綠 —— 單一綁定點正是本片的存在理由。
    expect(src).toMatch(/tapPayUrlsFor,\s*\}\s*from '@pcm\/adapters\/server'/);
  });
});
