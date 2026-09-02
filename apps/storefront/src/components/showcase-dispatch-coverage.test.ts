// showcase-dispatch-coverage.test.ts — 「新建 Showcase 元件忘了【接進 dispatcher】」的守門
// (2026-09-02,`⟦f3-SHOWCASEREGNOGUARD⟧`)
//
// 🔴 **它與隔壁那支 `showcase-manifest-coverage.test.ts` 是【兩個不同的分母】**:
//   那一道 ⇒ 磁碟上的元件有沒有**登記進文件**(`docs/design-storefront-manifest.yaml`)
//   本 道 ⇒ 磁碟上的元件有沒有**接進 `BrandShowcase.tsx` 的 switch**
//   🎯 **而一支元件可以「登記了而沒接上」—— 在今天之前, 沒有東西看得到那個世界。**
//
// 🔴 **為什麼需要它**(2026-09-02 做第 18 家 RIZOMA 時撞到):
//   改動前 `ls apps/storefront/src/components/BrandShowcase*.test.tsx` ⇒ **查無**
//   ⇒ 那個 switch 上架到第 17 家為止,**沒有任何一格在守「有沒有註冊進去」**。
//   ⇒ 🎯 而它壞掉的方式是:元件寫好了、它自己那支 smoke test 全綠、
//     而**畫面只是少一整區** —— 不報錯、不紅、console 乾淨。
//   📌 **一個「少了東西」的失敗,而它沒有任何訊號。**
//
// 🛑 **本閘證不到什麼(先讀)**:
//   · 它讀的是 `BrandShowcase.tsx` 的**原始碼字面**,不是執行它
//     ⇒ 「import 了而 switch 分支永遠走不到」它看不見(那要 `BrandShowcase.test.tsx` 那支渲染測試)
//   · 它不檢查**接對了沒**(把 `case 'rizoma'` 接到 `GillesShowcase` 它會過)
//     ⇒ 那一格由各家自己那支 render 測試守(而今天只有 rizoma 有)

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const COMPONENTS_DIR = fileURLToPath(new URL('./', import.meta.url));
const DISPATCHER = 'BrandShowcase.tsx';

/**
 * 要被接進 dispatcher 的元件 = 磁碟上的 `*Showcase.tsx` **扣掉 dispatcher 自己**。
 *
 * 🔴 **扣掉 `BrandShowcase.tsx` 的理由要寫出來, 否則下一個人會以為漏了一支**:
 *    它就是那個 switch 所在的檔 —— 它不可能「接進自己」。
 * 🔵 而 `RPM_CARBON_BRAND_SLUG` 那條分支【刻意不在本閘的分母裡】:
 *    RPM 沒有 `RpmCarbonShowcase.tsx`,它 return 的是
 *    `ProductHighlights` + `ProductSwatchWall` + `ProductSpotlight` 三支既有元件
 *    ⇒ 用「元件檔 → case」對映會把它誤判成缺一支。
 *    ⇒ 📌 **所以本閘的分母是【磁碟上的檔】, 不是【switch 裡的分支】—— 兩者不等長, 而那是對的。**
 */
export function componentsNeedingDispatch(dir: string): Set<string> {
  return new Set(
    readdirSync(dir).filter(
      (f) => f.endsWith('Showcase.tsx') && !f.includes('.test.') && f !== DISPATCHER,
    ),
  );
}

/**
 * 從 dispatcher 原始碼裡抽出【接上了的】showcase 元件檔名。
 *
 * 🔴 **「接上」= import 了【而且】有被 render** —— 兩個都要, 而理由是量到的:
 *    第一版只認 `import` ⇒ 而**拿掉一整個 `case` 分支、留著 import** 時它【不會紅】
 *    (2026-09-02 `-f3` 自己跑突變發現的)。
 *    ⇒ 🎯 而那正是這道閘要防的那個世界:**元件在、import 在、而客人看不到那一區。**
 */
export function dispatchedComponents(source: string): Set<string> {
  const imported = new Set(
    [...source.matchAll(/^import\s+\{\s*(\w*Showcase)\s*\}\s+from\s+'\.\/\w+';$/gm)].map(
      (m) => m[1]!,
    ),
  );
  const rendered = new Set(
    [...source.matchAll(/<(\w*Showcase)\s*\/>/g)].map((m) => m[1]!),
  );
  return new Set([...imported].filter((n) => rendered.has(n)).map((n) => `${n}.tsx`));
}

describe('抽取邏輯自檢(尺要先被驗過, 不能只信它跑出來的答案)', () => {
  it('只抓 import 進來的 Showcase, 不抓註解裡提到的同一個名字', () => {
    const fixture = [
      "import { FooShowcase } from './FooShowcase';",
      '// 這一行只是提到 BarShowcase, 不是 import',
      "import { BazShowcase } from './BazShowcase';",
      "import { NotAComponent } from './helpers';",
      '  return <FooShowcase />;',
      '  return <BazShowcase />;',
    ].join('\n');
    expect(dispatchedComponents(fixture)).toEqual(new Set(['FooShowcase.tsx', 'BazShowcase.tsx']));
  });

  it('🔵 負對照:沒有任何 import 時回空集合(不是「有東西就算過」)', () => {
    expect(dispatchedComponents('// BarShowcase 只出現在註解裡')).toEqual(new Set());
  });

  it('🔴 import 了而【沒有被 render】⇒ 不算接上', () => {
    // 那正是「拿掉一整個 case 分支而留著 import」的形狀 —— 而第一版的尺看不見它。
    const fixture = ["import { FooShowcase } from './FooShowcase';", '  return null;'].join('\n');
    expect(dispatchedComponents(fixture)).toEqual(new Set());
  });
});

describe('BrandShowcase dispatcher vs 磁碟上的 Showcase 元件', () => {
  it('🔴 每一支磁碟上的 *Showcase.tsx 都要被 BrandShowcase.tsx 接進去', () => {
    const needed = componentsNeedingDispatch(COMPONENTS_DIR);
    const dispatched = dispatchedComponents(
      readFileSync(`${COMPONENTS_DIR}${DISPATCHER}`, 'utf-8'),
    );
    const missing = [...needed].filter((f) => !dispatched.has(f)).sort();

    // 🎯 印出集合而不是只印筆數:「兩個數字相等」與「兩邊是同一組東西」是兩個宣稱
    //    (隔壁那支檔的檔頭記過那次假同步)。
    expect(missing, '這幾支元件存在於磁碟, 而 BrandShowcase.tsx 沒有接它們 ⇒ 客人看不到那一區').toEqual([]);
  });

  it('🔵 反向:dispatcher 不得 import 一支磁碟上不存在的元件', () => {
    // 🎯 這一格擋的是【刪掉元件而忘了拆 import】—— 那會讓 build 紅, 但紅在別的地方,
    //    而錯誤訊息不會說「有人刪了一支 showcase」。
    const needed = componentsNeedingDispatch(COMPONENTS_DIR);
    const dispatched = dispatchedComponents(
      readFileSync(`${COMPONENTS_DIR}${DISPATCHER}`, 'utf-8'),
    );
    expect([...dispatched].filter((f) => !needed.has(f)).sort()).toEqual([]);
  });
});
