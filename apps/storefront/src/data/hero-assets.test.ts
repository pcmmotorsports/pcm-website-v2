// hero-assets.test.ts — 首頁 hero 四張輪播照必須真的在 repo 裡(D6 / 首頁對齊批 H4;2026-08-06)
//
// 🔴 為什麼需要這支(理由與姊妹檔 `brand-assets.test.ts` 逐字同款):
//    這 8 個檔名將來會是 `HomeHero` 裡的**字串**。少複製一個檔、改名、或是 OD 那邊重新產生
//    卻沒重新轉存 —— 全部都是 **typecheck 綠、lint 綠、單元測試綠、build 也綠**,
//    只有真的打開首頁才看得到那一格是破的。破圖不會讓任何流程紅,只會讓客人看到。
//
// 來源 = Open Design `pcm-home-redesign/assets/hero/slides/`(`build-hero-wall.py` 產生;
// README.md:214-216 逐字:寬版 `hero-0N.jpg` 2560×1200、直式 `hero-0N-m.jpg` 1080×1800、
// `compare.jpg` 是四張並排對照 = **QA 用、不轉存**)。
// 轉存時逐檔比對過 sha256,8/8 與來源相同。
//
// 🔴 佈局刻意**不照 `brand-assets` 那種鏡像 OD 目錄**的做法:那份鏡像存在的理由是
//    `brand-content.ts` 的資料層帶著 `assets/...` 路徑字串、渲染時補前綴;hero 的路徑
//    **不在任何資料層**,鏡像 `assets/hero/slides/` 三層只是把路徑變長。⇒ 平放 `public/hero/`。
//
// ⚠️ **它擋不住什麼**:①只驗檔案在不在、大小合不合理,**不驗畫面內容**(換成另一張同尺寸的照片
//    照樣全綠)②不驗 `HomeHero` 有沒有真的引用到它們 —— 那條守門是 H5 的事,
//    在 H5 之前這 8 個檔是「已就位、尚無消費端」的狀態。

import { describe, expect, it } from 'vitest';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/hero');

/** 四張輪播 × 兩個版本(桌機寬版 / 手機直式)。 */
const SLIDES = ['01', '02', '03', '04'] as const;
const FILES = SLIDES.flatMap((n) => [`hero-${n}.jpg`, `hero-${n}-m.jpg`]);

/** JPEG 尺寸:掃 SOF 標記(0xFFC0-0xFFCF,跳過 0xFFC4/C8/CC)。 */
function jpegSize(path: string): { w: number; h: number } {
  const buf = readFileSync(path);
  expect(buf[0], `${path} 不是 JPEG(缺 SOI)`).toBe(0xff);
  expect(buf[1]).toBe(0xd8);
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) { i += 1; continue; }
    const marker = buf[i + 1]!;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error(`${path} 找不到 SOF 標記`);
}

describe('首頁 hero 資產 · 8 檔都在(H4)', () => {
  it('🔴 前提:檔名清單真的有 8 個(清單被改空的話,下面每一條都會空跑全綠)', () => {
    expect(FILES).toHaveLength(8);
    expect(new Set(FILES).size, '檔名有重複 ⇒ 實際覆蓋不到 8 檔').toBe(8);
  });

  it('🔴 8 個檔都存在,而且不是 0 位元組的空殼', () => {
    for (const f of FILES) {
      const p = join(HERO_ROOT, f);
      expect(existsSync(p), `${f} 不在 public/hero/ ⇒ 首頁 hero 會破一張圖`).toBe(true);
      // 來源實測最小 101KB;抓 20KB 當下界 = 只擋「空殼 / 被 LFS 指標取代」這種,不擋正常的重壓縮
      expect(statSync(p).size, `${f} 只有 ${statSync(p).size} 位元組 ⇒ 不像一張照片`).toBeGreaterThan(20_000);
    }
  });

  it('🔴 尺寸照 OD README:寬版 2560×1200、直式 1080×1800(拿錯版本 = 手機吃 2.5K 大圖)', () => {
    for (const n of SLIDES) {
      expect(jpegSize(join(HERO_ROOT, `hero-${n}.jpg`)), `hero-${n}.jpg 尺寸不對`).toEqual({ w: 2560, h: 1200 });
      expect(jpegSize(join(HERO_ROOT, `hero-${n}-m.jpg`)), `hero-${n}-m.jpg 尺寸不對`).toEqual({ w: 1080, h: 1800 });
    }
  });

  it('🔴 QA 用的 compare.jpg **不得**被一起轉存(548KB 的四張並排對照,對客人零用處)', () => {
    expect(existsSync(join(HERO_ROOT, 'compare.jpg')), 'compare.jpg 被誤搬進 public/').toBe(false);
  });
});
