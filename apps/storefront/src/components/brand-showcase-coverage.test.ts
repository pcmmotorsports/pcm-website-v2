// brand-showcase-coverage.test.ts — 「上架供應商忘了補商品頁品牌形象區」的守門(#802 系列現場,2026-08-21)
//
// 背景:DNA 空濾 2026-08-21 首灌 787 件商品上架,商品頁卻缺「01 為什麼選 DNA」/「02」整段
// (BrandShowcase.tsx 的 switch 沒有 'dna' 這個 case,落 default → null,不是空白是整段不存在)。
// 根因(I 窗盤點,~/pcm-mailbox/I-b9-DNA商品頁品牌形象區-盤點-20260821.md):
//   BrandShowcase.tsx 是純 presentational dispatcher,每家品牌是一支獨立 .tsx 檔,
//   不吃 brand-content.ts、不是資料驅動 ⇒ 上架 runbook(填欄位/跑腳本的形狀)天生看不到
//   「這裡還要新建一支檔案」這一步。
//
// 🔴 閘的分母刻意不是「brand-content.ts 有這家」(21 家裡有 6 家沒有 case,但其中 5 家
// dbk/gilles/kineo/rizoma/wrs 從未在 supplier-config.ts 登記過、網站庫商品數 = 0,
// 沒有商品頁可看,現在就要求它們有 showcase 是「一裝就紅」)。
// ⇒ 閘綁在 `SUPPLIER_CONFIGS[...].writeAllowed === true`(= 這家已經開放寫入 prod、有真商品頁)。
// 這個旗標本來就是上架流程自己的開關,不需要另外查活 DB,而且紅格數會與「客人看得到的缺口」
// 一一對應:今天只有 DNA 一格紅,其餘 5 家哪天真的匯入商品、writeAllowed 翻 true,才會跟著紅。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SUPPLIER_CONFIGS } from '../../../../scripts/supplier-config';
import { RPM_CARBON_BRAND_SLUG } from '../data/mock-products';

const BRAND_SHOWCASE_PATH = fileURLToPath(new URL('./BrandShowcase.tsx', import.meta.url));

/**
 * 從 BrandShowcase.tsx 原始碼文字裡抽出 switch 裡所有的 case 品牌 slug。
 * 🔴 純文字掃描、不 import 元件本身:import 一支 .tsx dispatcher 會連帶拉進它 import 的
 * 15 支 XxxShowcase.tsx,不必要地放大測試的失敗面(改任一家 showcase 的內容都可能連坐)。
 * 這支閘只關心「switch 裡有沒有這個 case 標籤」,讀原始碼文字就夠、風險最小。
 */
function extractShowcaseCaseSlugs(source: string): Set<string> {
  const slugs = new Set<string>();
  for (const m of source.matchAll(/case\s+'([a-z0-9-]+)':/g)) {
    const slug = m[1];
    if (slug) slugs.add(slug);
  }
  // 🔴 RPM 那個 case 用的是 `case RPM_CARBON_BRAND_SLUG:`(具名常數,不是字面字串),
  // 上面的正規式抓不到 —— 顯式核對原始碼裡有這一行、再把常數的值補進集合。
  if (/case\s+RPM_CARBON_BRAND_SLUG:/.test(source)) {
    slugs.add(RPM_CARBON_BRAND_SLUG);
  }
  return slugs;
}

describe('extractShowcaseCaseSlugs (自檢:抽取邏輯本身要先被驗證,不能只信任它跑出來的答案)', () => {
  it('抓得到字面 case 與具名常數 case,抓不到 default', () => {
    const fixture = `
      switch (x) {
        case 'foo':
          return 1;
        case RPM_CARBON_BRAND_SLUG:
          return 2;
        default:
          return null;
      }
    `;
    const got = extractShowcaseCaseSlugs(fixture);
    expect(got).toEqual(new Set(['foo', RPM_CARBON_BRAND_SLUG]));
  });

  it('負對照:沒有任何 case 的原始碼回傳空集合(不是恆真的「有東西就算過」)', () => {
    expect(extractShowcaseCaseSlugs('switch (x) { default: return null; }')).toEqual(new Set());
  });
});

describe('BrandShowcase 覆蓋率 vs. 已開放寫入(writeAllowed)的供應商', () => {
  it('每一家 writeAllowed=true 的品牌,BrandShowcase.tsx 都要有對應的 case', () => {
    const source = readFileSync(BRAND_SHOWCASE_PATH, 'utf-8');
    const caseSlug = extractShowcaseCaseSlugs(source);

    const writeAllowedBrands = Object.values(SUPPLIER_CONFIGS)
      .filter((c) => c.writeAllowed)
      .map((c) => c.brandSlug);

    const missing = writeAllowedBrands.filter((slug) => !caseSlug.has(slug));

    expect(
      missing,
      `這些品牌已經 writeAllowed(商品在架上、客人點得進商品頁),` +
        `但 BrandShowcase.tsx 沒有對應的 case,商品頁會缺「為什麼選 XX」整段: ${missing.join(', ')}。` +
        `新建一支 <Brand>Showcase.tsx 並在 BrandShowcase.tsx 的 switch 加一個 case ` +
        `(見 docs/runbooks/supplier-storefront-onboarding.md 「商品頁品牌形象區」一節)。`,
    ).toEqual([]);
  });

  it('負對照:沒有 writeAllowed 的品牌(0 商品,如 kineo)不在檢查分母裡 —— 證明這道閘不會對它們誤報', () => {
    const zeroProductBrands = ['dbk', 'gilles', 'kineo', 'rizoma', 'wrs'];
    const writeAllowedSlugs = new Set(
      Object.values(SUPPLIER_CONFIGS)
        .filter((c) => c.writeAllowed)
        .map((c) => c.brandSlug),
    );
    for (const slug of zeroProductBrands) {
      expect(writeAllowedSlugs.has(slug), `${slug} 不應該出現在 writeAllowed 分母裡(它從未被登記進 supplier-config.ts)`).toBe(false);
    }
  });
});
