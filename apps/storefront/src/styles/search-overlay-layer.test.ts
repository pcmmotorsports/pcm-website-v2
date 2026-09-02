// search-overlay-layer.test.ts — 「搜尋疊層必須在所有全屏層之上」的守門(全樹掃描型)。
//
// 🔴 **來源是一個真缺陷**(線 `-fc` 2026-09-02 真瀏覽器鍵盤實測,五步):
//    商品詳情頁開圖片 lightbox(`.pd-lightbox` z-index 10000)⇒ 背景那顆搜尋鈕**仍在 tab 序裡**
//    ⇒ 鍵盤按得到 ⇒ 疊層真的開了(display:flex · visibility:visible · 375×214)
//    ⇒ 而 `elementFromPoint(疊層中心)` 回 `DIV.pd-lb-stage`、`document.activeElement`
//       是 `INPUT.search-overlay-input`
//    🎯 **客人打的字進到一個他看不到的框,而畫面上還是那張放大的圖。**
//
// 🔴 **本檔比的是【關係】不是【數字】**:斷言「搜尋疊層 > 其他每一個全屏層」。
//    寫死 `10001` 的話,下一個人新增一個 z-index 20000 的全屏層 ⇒ 這裡不會紅,而客人會踩到。
//
// ⚠️ **它證不到什麼**(與修法一樣顯眼,否則人只讀它抓到什麼):
//    · 它是**文字層**:看不到 cascade 勝負、看不到 stacking context
//      —— 一個被 `transform` / `filter` 開出新 stacking context 的祖先,會讓 z-index 比較失去意義
//    · 它只掃 `apps/storefront/src/styles/*.css` 的 `position:fixed` + `inset:0`
//      ⇒ **inline style、CSS-in-JS、`top/right/bottom/left: 0` 的寫法一律看不到**
//    · 🔴 它**不證明**「焦點跑不進看不見的東西」—— 那個不變式的根治是
//      **每一支 modal 把背景 inert**,而那住在別人的元件裡(已交 backlog)。
//      本檔守的是「萬一焦點還是跑進來了,至少它看得見」。
//    · 🔴 真瀏覽器那一格 jsdom 到不了(`elementFromPoint` 在 jsdom 上不可靠)
//      ⇒ **「疊層真的畫在 lightbox 上面」只有真瀏覽器驗得到**,本檔驗不到。

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

type Layer = { file: string; selector: string; z: number | null };

/** 掃出所有「全屏覆蓋層」= 同一條規則裡同時有 `position:fixed` 與 `inset:0`。 */
function fullscreenLayers(): Layer[] {
  const out: Layer[] = [];
  for (const f of readdirSync(HERE).filter((x) => x.endsWith('.css'))) {
    // 先剝註解:本 repo 的註解大量引用 CSS 字面,不剝會對著散文報錯。
    const src = readFileSync(join(HERE, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const body = m[2] ?? '';
      if (!/position:\s*fixed/.test(body)) continue;
      if (!/inset:\s*0/.test(body)) continue;
      const z = /z-index:\s*(-?\d+)/.exec(body);
      const sel = (m[1] ?? '').trim().split('\n').pop()!.trim();
      out.push({ file: f, selector: sel, z: z ? Number(z[1]) : null });
    }
  }
  return out;
}

describe('搜尋疊層的層級', () => {
  it('🔵 前提 — 掃得到東西,而且掃得到【已知的那兩個】(尺沒接上時本格會紅)', () => {
    const layers = fullscreenLayers();
    expect(layers.length, '一個全屏層都沒掃到 ⇒ 尺沒接上,下面每一格都不算數').toBeGreaterThan(1);
    const sels = layers.map((l) => l.selector);
    expect(sels, '掃不到搜尋疊層自己').toContain('.search-overlay');
    // 🔴 正對照必須**同類**:`.pd-lightbox` 就是那次真缺陷的另一半。
    expect(sels, '掃不到 .pd-lightbox ⇒ 這把尺對本缺陷零判別力').toContain('.pd-lightbox');
  });

  it('🔴 搜尋疊層必須【嚴格大於】其他每一個全屏層', () => {
    const layers = fullscreenLayers();
    const me = layers.find((l) => l.selector === '.search-overlay')!;
    expect(me.z, '搜尋疊層沒有 z-index ⇒ 疊在誰上面由文件順序決定,那不是一個保證').not.toBeNull();
    const others = layers.filter((l) => l.selector !== '.search-overlay');
    const offenders = others.filter((l) => l.z === null || l.z >= me.z!);
    expect(
      offenders.map((l) => `${l.file}:${l.selector}(z=${l.z})`),
      `這些全屏層會蓋住搜尋疊層 ⇒ 客人可能打字進一個看不見的框(搜尋疊層 z=${me.z})`,
    ).toEqual([]);
  });

  it('🔵 負對照 — 一個現造的選擇器必須掃不到(否則上面兩格在亂答)', () => {
    expect(fullscreenLayers().map((l) => l.selector)).not.toContain('.zzz-not-a-real-layer');
  });
});
