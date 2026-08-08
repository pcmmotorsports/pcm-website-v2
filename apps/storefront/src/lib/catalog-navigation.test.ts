// @vitest-environment jsdom
//
// catalog-navigation.test.ts — 「跳商品目錄一律落地在頂」的守門。
//
// 背景:D-310-A Bug 2(Sean 手機:首頁選完車跳 /products,首排商品被黏頂篩選列蓋掉上半截)。
// 主視窗在真 DB 環境量到根因(D-315-A ②):`router.push` 保留了來源頁的捲動位置
// (push 前 scrollY 152.5 → 落地仍 152.5;首張卡 top 154 vs sticky bottom 169 ⇒ 被蓋 15px)。
//
// ⚠️ **誠實邊界(照 C2 前例降級宣稱)**:jsdom 沒有真的客戶端導覽、也沒有版面,
//    **「落地後首排卡片不再被蓋」這件事本檔證明不了** —— 那格要真瀏覽器 + 真 DB,
//    由主視窗照 D-315-A ① 的重現配方跑修前/修後兩態。
//    本檔證明的是兩件可機械驗證的事:①helper 真的把捲動歸零、順序是先 push 後捲
//    ②**沒有任何入口繞過 helper 裸 push 到 /products**(這條才是「一次蓋住所有入口」的機制)。

import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { navigateToCatalog } from './catalog-navigation';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) yield p;
  }
}

describe('navigateToCatalog', () => {
  it('🔴 push 之後把捲動歸零(落地在頂)', () => {
    const scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);
    const push = vi.fn();
    navigateToCatalog({ push }, '/products?vehicle=beta%3A300-racing-2t');
    expect(push).toHaveBeenCalledWith('/products?vehicle=beta%3A300-racing-2t');
    expect(scrollTo, '沒有把捲動歸零 ⇒ 落地停在來源頁的位置,首排商品被黏頂篩選列蓋住').toHaveBeenCalledWith(
      { top: 0, left: 0 },
    );
    vi.unstubAllGlobals();
  });

  it('🔴 順序是「先 push 後捲」(反過來會讓來源頁在導覽前先跳一下、被使用者看見)', () => {
    const calls: string[] = [];
    vi.stubGlobal('scrollTo', () => calls.push('scroll'));
    navigateToCatalog({ push: () => calls.push('push') }, '/products');
    expect(calls).toEqual(['push', 'scroll']);
    vi.unstubAllGlobals();
  });
});

describe('入口收斂(這條才是「一次蓋住所有入口」的機制)', () => {
  // 🔴 這條的價值在**未來**:任何人新加一個「跳商品目錄」的按鈕、順手寫 router.push('/products'),
  //    這裡就會紅,而不是等 Sean 又在手機上看到半張卡。
  it('🔴 全樹不得有繞過 helper 的裸 router.push 到 /products', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      if (file.endsWith('catalog-navigation.ts')) continue;
      const raw = readFileSync(file, 'utf8');
      // 🔴 先剝註解:本 repo 的註解大量引用程式碼字面(`CheckoutCartNotice.tsx` 就有一句
      //    「維持原本的 router.push('/products')」),不剝的話守門會對著散文報錯 = 假紅。
      //    註解換成等長空白,行號才不會位移。
      const src = raw.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
      for (const m of src.matchAll(/\.push\(\s*[`'"]\/products/g)) {
        const line = src.slice(0, m.index).split('\n').length;
        offenders.push(`${file.replace(SRC, 'src')}:${line}`);
      }
    }
    expect(
      offenders,
      `這些地方裸 push 到 /products、繞過了落地歸零:${offenders.join(', ')}(改用 navigateToCatalog)`,
    ).toEqual([]);
  });

  it('🔴 已知的三個入口確實走 helper(前提斷言:上一條若因為入口全消失而恆真,這條會紅)', () => {
    const users = [
      'components/VehicleFinder.tsx',
      'components/ProductBreadcrumb.tsx',
      'components/CartView.tsx',
    ];
    for (const rel of users) {
      const src = readFileSync(join(SRC, rel), 'utf8');
      expect(src, `${rel} 沒有 import navigateToCatalog ⇒ 它要嘛改回裸 push、要嘛入口被刪了`).toMatch(
        /import \{ navigateToCatalog \} from '@\/lib\/catalog-navigation'/,
      );
      expect(src, `${rel} import 了卻沒真的呼叫 ⇒ 死 import`).toMatch(/navigateToCatalog\(/);
    }
  });
});
