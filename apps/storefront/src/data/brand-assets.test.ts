// brand-assets.test.ts — 品牌內容引用的資產檔案必須真的在 repo 裡(2026-08-04)
//
// 🔴 為什麼需要這支(主視窗 C-02-A 建議、與 D1b 的守門哲學同款):
//    `brand-content.ts` 裡的資產路徑是**字串**。打錯一個字、少複製一個檔、
//    或是來源改名後重新產生資料卻沒重新複製資產 —— 這些全部都是
//    **typecheck 綠、lint 綠、單元測試綠、build 也綠**,
//    只有真機逐頁看才會看到那一格破圖。破圖不會讓任何流程紅,只會讓客人看到。
//
// 資產佈局 = 保留 Open Design 原樣(信箱 C-01-A Q1=A),
// 所以資料層的 `assets/...` 路徑一字不改,渲染時前綴 `/brand-assets/`。
// 對應磁碟位置 = `apps/storefront/public/brand-assets/assets/...`。

import { describe, expect, it } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { BRAND_CONTENT } from './brand-content';

const ASSET_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/brand-assets');

/** 走遍整棵資料樹,撿出所有長得像資產路徑的字串。 */
function referencedAssetPaths(): string[] {
  const found = new Set<string>();
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      if (value.startsWith('assets/')) found.add(value);
      return;
    }
    if (Array.isArray(value)) return value.forEach(walk);
    if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk(BRAND_CONTENT);
  return [...found].sort();
}

describe('品牌資產 · 資料引用的檔案都在', () => {
  const paths = referencedAssetPaths();

  it('前提斷言:真的掃到了一批路徑(掃到空集合的話,下面那條會空跑全綠)', () => {
    // 🔴 沒有這條,「每個路徑都存在」在 referencedAssetPaths() 回空陣列時也會通過。
    // 2026-08-04 實測 117 條;用下限而非等號,新增品牌時不會誤紅。
    expect(paths.length).toBeGreaterThan(100);
  });

  it('🔴 每一條引用路徑都對應到 public/brand-assets 底下的真實檔案', () => {
    const missing = paths.filter((p) => !existsSync(join(ASSET_ROOT, p)));
    expect(
      missing,
      missing.length
        ? [
            `${missing.length} 個資產路徑在 repo 裡找不到檔案。`,
            '這不會讓三綠變紅,但真站上就是破圖。',
            '成因通常是:重新產生了 brand-content.ts 卻沒重新複製資產。',
            `複製來源 = Open Design pcm-home-redesign/${'{該路徑}'}`,
          ].join('\n')
        : undefined,
    ).toEqual([]);
  });

  it('每個檔案都不是 0 byte(複製中斷會留下空檔,existsSync 照樣通過)', () => {
    // existsSync 只回答「有沒有這個名字」。rsync/cp 被打斷會留下 0 byte 的殼,
    // 那種檔案存在、但畫面上一樣是破圖。實測:把一個檔 truncate 成 0,
    // 上面那條 existsSync 照樣綠、只有這條會紅。
    // 🔴 先濾掉不存在的:否則檔案不見時這裡會是 statSync 拋 ENOENT(髒紅),
    //    而不是乾淨地報告「這條測的是空檔」。兩條各量各的,失敗訊息才指得準。
    const empty = paths
      .filter((p) => existsSync(join(ASSET_ROOT, p)))
      .filter((p) => statSync(join(ASSET_ROOT, p)).size === 0);
    expect(empty).toEqual([]);
  });
});

describe('品牌資產 · 磚牆用的 brands-trim', () => {
  // brands-trim **資料層沒有引用**(它不是 brand-content.ts 的欄位),
  // 但品牌磚牆與「其他品牌」都吃它(brand-page-integration.md §4 的資料夾對照表)。
  // 所以上面那組掃不到它,得單獨守 —— 少一家的話磚牆會缺一格。
  // 🔴 D2e-1 收緊:原本這條接受 `.png` **或** `.svg`,但真正在渲染的
  //    `BrandPageBrandWall.tsx` 只會產出 `.png`(設計稿組裝 :2027 就是寫死副檔名)。
  //    ⇒ 哪天某家只放了 svg,這條照樣綠、磚牆卻缺一格。副檔名跟著元件走。
  const trimPath = (slug: string) => `assets/brands-trim/${slug}.png`;

  it('20 家每一家都有 trim logo(副檔名與元件一致 = .png)', () => {
    const missing = BRAND_CONTENT.filter((b) => !existsSync(join(ASSET_ROOT, trimPath(b.slug))))
      .map((b) => b.slug);
    expect(missing).toEqual([]);
    // 前提斷言:真的掃了 20 家,不是空集合恆綠
    expect(BRAND_CONTENT.length).toBe(20);
  });

  it('trim logo 沒有 0 byte 的殼(理由同上面那組)', () => {
    // 🔴 先斷言「掃到的存在集合真的是 20 個」:少了它,20 檔全不見時 empty = [] = 綠,
    //    這條就完全靠隔壁那條撐著(R1 nit)。
    const present = BRAND_CONTENT.filter((b) => existsSync(join(ASSET_ROOT, trimPath(b.slug))));
    expect(present).toHaveLength(20);
    const empty = present
      .filter((b) => statSync(join(ASSET_ROOT, trimPath(b.slug))).size === 0)
      .map((b) => b.slug);
    expect(empty).toEqual([]);
  });
});
