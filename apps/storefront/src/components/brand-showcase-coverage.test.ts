// brand-showcase-coverage.test.ts — 「上架供應商忘了補商品頁品牌形象區」的守門(#802 系列現場,2026-08-21)
//
// 背景:DNA 空濾 2026-08-21 首灌 787 件商品上架,商品頁卻缺「01 為什麼選 DNA」/「02」整段
// (BrandShowcase.tsx 的 switch 沒有 'dna' 這個 case,落 default → null,不是空白是整段不存在)。
// 根因(I 窗盤點,~/pcm-mailbox/I-b9-DNA商品頁品牌形象區-盤點-20260821.md):
//   BrandShowcase.tsx 是純 presentational dispatcher,每家品牌是一支獨立 .tsx 檔,
//   不吃 brand-content.ts、不是資料驅動 ⇒ 上架 runbook(填欄位/跑腳本的形狀)天生看不到
//   「這裡還要新建一支檔案」這一步。
//
// 🔴 閘的分母刻意不是「brand-content.ts 有這家」(brand-content.ts 有 21 家,而其中數家
// 從未在 supplier-config.ts 登記過、網站庫商品數 = 0,
// 沒有商品頁可看,現在就要求它們有 showcase 是「一裝就紅」)。
// ⇒ 閘綁在 `SUPPLIER_CONFIGS[...].writeAllowed === true`(= 這家已經開放寫入 prod、有真商品頁)。
// 這個旗標本來就是上架流程自己的開關,不需要另外查活 DB,而且紅格數會與「客人看得到的缺口」
// 一一對應:哪一家真的匯入商品、writeAllowed 翻 true,才會跟著紅。
//
// 🔴🔴 **下面那份負對照名單是【會過期的】,而它過期的方式很難看見**(2026-08-27 實錘):
// 名單原本寫死 `['dbk','gilles','kineo','rizoma','wrs']`,語意是「從未登記過、0 商品」。
// 而 gilles 於 2026-08-27 登記進 supplier-config.ts ⇒ **那一刻它就不再屬於這份名單**。
// 當晚實測(把 writeAllowed 暫時翻 true 跑一次 = 模擬 Sean 醒來按下去的那一刻):
//   世界 A(writeAllowed=true + case 已補齊)⇒ **這一條負對照紅了**,而上面那條主閘是綠的。
//   世界 B(writeAllowed=true + case 拿掉)  ⇒ 主閘紅、訊息正確指出 missing: gilles。
// ⇒ 世界 A 的紅**不是真缺陷**,是名單過期;而它紅在「負對照」這一條上,
//   訊息長得像「閘壞了」而不是「名單該更新了」⇒ 下一個人會去找不存在的 bug。
// ⇒ **新增供應商登記時,要把它從這份名單移除**(移除 = 這家已進上架流程,由主閘負責它)。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SUPPLIER_CONFIGS } from '../../../../scripts/supplier-config';
import { RPM_CARBON_BRAND_SLUG } from '../data/mock-products';

const BRAND_SHOWCASE_PATH = fileURLToPath(new URL('./BrandShowcase.tsx', import.meta.url));

/**
 * 從 BrandShowcase.tsx 原始碼文字裡抽出 switch 裡所有的 case 品牌 slug。
 * 🔴 純文字掃描、不 import 元件本身:import 一支 .tsx dispatcher 會連帶拉進它 import 的
 * 每一支 XxxShowcase.tsx,不必要地放大測試的失敗面(改任一家 showcase 的內容都可能連坐)。
 * ⚠️ ~~原字面寫「15 支」~~ 2026-08-27 作廢:當場數是 **16 支**(codex R1 抓到,它可以被當場證偽)。
 * 🔴 這裡刻意**不再寫死支數** —— 那個數字每上架一家就過期一次,而過期時零機械訊號。
 *   要現值就跑 `grep -c "Showcase } from" BrandShowcase.tsx`。
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

  // 🔴 code-reviewer R1 nit 3(2026-08-27)抓到:**這條負對照原本是恆真的。**
  //   變數名與失敗訊息說「從未登記過」,而斷言查的是 `writeAllowed === false`;
  //   dbk/kineo/rizoma/wrs 四家**根本不在 SUPPLIER_CONFIGS 裡** ⇒ `has()` 對它們恆為 false
  //   ⇒ 它抓不到任何東西,而它看起來像一條負對照。
  //   ⇒ 改成兩段:①先斷言【前提本身成立】(它們真的未登記),前提垮了這條要紅、不是靜靜變恆真;
  //             ②真正有判別力的分母是「**已登記而 writeAllowed=false**」那一群(今天 = gilles + canary)
  //               —— 那一格才會隨上架流程動。
  // 🔴 codex R1 must-fix(2026-08-27):主閘只看「switch 裡有沒有這個 case 標籤」,
  //   ⇒ **把 case 接到錯的元件、或接到 null,它一樣綠**。標籤存在 ≠ 客人看得到東西。
  //   這條補上「case 真的回傳一個【在本檔 import 過的】元件」。
  //   ⚠️ 它仍然證明不了「接的是**對的那一支**」(那要人看);但它擋得住 return null / 打錯字 / 忘了 import。
  it('🔴 每一家 writeAllowed=true 的 case 都要回傳一個本檔 import 過的元件(不是 null、不是打錯字)', () => {
    const source = readFileSync(BRAND_SHOWCASE_PATH, 'utf-8');
    const imported = new Set(
      [...source.matchAll(/import\s+\{\s*([A-Za-z0-9_]+)\s*\}\s+from\s+'\.\//g)].map((m) => m[1]!),
    );
    // case 'slug': (可夾註解) return <Component />;
    const wiring = new Map<string, string>();
    for (const m of source.matchAll(
      /case\s+'([a-z0-9-]+)':\s*(?:\/\/[^\n]*\n\s*)*return\s+<([A-Za-z0-9_]+)\s*\/>;/g,
    )) {
      wiring.set(m[1]!, m[2]!);
    }
    // 自檢:抽取邏輯要先證明它抓得到東西,否則下面整段恆真
    expect(wiring.size, '接線抽取結果是空的 ⇒ 正規式與檔案格式對不上,本條會恆真').toBeGreaterThan(10);

    const writeAllowedBrands = Object.values(SUPPLIER_CONFIGS)
      .filter((c) => c.writeAllowed)
      .map((c) => c.brandSlug)
      // RPM 那個 case 回傳的是 fragment(多個元件),不是單一 <X />,本條不涵蓋它
      .filter((slug) => slug !== RPM_CARBON_BRAND_SLUG);

    for (const slug of writeAllowedBrands) {
      const comp = wiring.get(slug);
      expect(comp, `${slug} 的 case 沒有「return <Component />」的形狀(可能 return null 或結構不同)`).toBeDefined();
      expect(imported.has(comp!), `${slug} 接到 <${comp} />,但本檔沒有 import 它`).toBe(true);
    }
  });

  it('🔴 gilles 的 case 必須接到 GillesShowcase(接錯元件時主閘不會紅,只有這條會)', () => {
    const source = readFileSync(BRAND_SHOWCASE_PATH, 'utf-8');
    expect(source).toMatch(/case\s+'gilles':\s*\n\s*return\s+<GillesShowcase\s*\/>;/);
  });

  it('負對照 ①:名單裡的品牌【真的未登記】—— 前提垮掉時要紅,不能靜靜變成恆真', () => {
    // 🔴 2026-09-04:`dbk` 移出 —— 它當天登記進 SUPPLIER_CONFIGS(`writeAllowed: false`)。
    //   照本條失敗訊息自己指的前例(gilles 2026-08-27)。⚠️ **移出這一格不代表它需要 showcase** ——
    //   主閘的分母是 `writeAllowed === true`,而 dbk 是 false ⇒ 它現在歸【負對照②】管。
    // 🔴 2026-09-04 上午:`rizoma` 移出 —— 它當天登記進 SUPPLIER_CONFIGS(writeAllowed: false)。
    //   ⛔ ~~而 rizoma 是 false ⇒ 它現在歸【已登記但未開寫】那一格管~~ —— **同日下午作廢**:
    //   Sean 逐字「`q3: 上`」批首灌 ⇒ `writeAllowed: true` ⇒ 🎯 **它現在歸主閘管**
    //   (而 `RizomaShowcase.tsx` 早就在 ⇒ 主閘不紅)。**舊字面留刪除線, 不刪。**
    //   📌 codex 抓到的:一句只在「還沒開寫」那個世界為真的註解, 在開寫之後【安靜地變假】。
    const zeroProductBrands = ['kineo', 'wrs'];
    const registeredBrandSlugs = new Set(Object.values(SUPPLIER_CONFIGS).map((c) => c.brandSlug));
    for (const slug of zeroProductBrands) {
      expect(
        registeredBrandSlugs.has(slug),
        `${slug} 現在已經登記進 supplier-config.ts 了 ⇒ 它不再屬於「從未登記」名單,請把它移出本清單` +
          `(gilles 2026-08-27 就是這樣移出去的)。`,
      ).toBe(false);
    }
  });

  // 🔴🔴 2026-09-04 改寫(code-reviewer F3):dbk 首灌翻 writeAllowed=true 之後,
  //   「已登記但未開寫」這一群【只剩 __gated_canary__】(永久 false 的守門靶)
  //   ⇒ 🛑 原本那句 `.toBeGreaterThan(0)` 從此**恆真**, 而它的註解寫著
  //     「哪天全家都開寫, 這條會紅、提醒改寫它」—— **那一天永遠不會來。**
  //   ⇒ 🎯 一格永遠不會紅的測試, 與沒有測試是同一件事。
  //
  // ✅ 改成【嚴格相等釘住現況】—— 這種形狀抽不乾:兩個方向的變動都會紅。
  //   · 有人登記一家新供應商而還沒開寫 ⇒ 名單多一個 ⇒ 紅(提醒:它現在歸負對照②管)
  //   · 有人把 canary 開寫 / 刪掉      ⇒ 名單少一個 ⇒ 紅
  //   ⇒ 📌 而它今天【綠得有理由】:所有真供應商都已開寫, 這是一個可以被驗證的事實,
  //     不是一個「湊得出來的通過」。
  it('🔴 「已登記但未開寫」這一群 = 恰好只有守門靶(多一個少一個都要紅)', () => {
    const notWriteAllowed = Object.values(SUPPLIER_CONFIGS)
      .filter((c) => !c.writeAllowed)
      .map((c) => c.supplierSlug)
      .sort();
    expect(
      notWriteAllowed,
      '這一群變了 ⇒ 要嘛有人登記了新供應商還沒開寫(那它歸本格管), ' +
        '要嘛守門靶被動過。兩種都要有人看一眼, 不要直接改期望值。',
    ).toEqual(['__gated_canary__']);
    // ⛔ ~~2026-09-04 上午:`['__gated_canary__', 'rizoma']`~~ —— rizoma 當天下午 Sean 逐字
    //   「`q3: 上`」批首灌 ⇒ 翻 writeAllowed=true ⇒ **這一格如上一則註解預告的【再紅了一次】**,
    //   而那正是它存在的理由:兩個方向的變動都會紅, 抽不乾。**舊字面留刪除線, 不刪。**
  });

  // 🔴 而【分割不變式】才是這一組真正扛事的那一格 —— 它與誰開不開寫無關, 抽不乾。
  it('🔴 每一家恰好落在一邊(開寫 / 未開寫), 而守門靶永遠不得有 showcase case', () => {
    const all = Object.values(SUPPLIER_CONFIGS);
    const wa = new Set(all.filter((c) => c.writeAllowed).map((c) => c.supplierSlug));
    const nwa = new Set(all.filter((c) => !c.writeAllowed).map((c) => c.supplierSlug));
    expect(wa.size + nwa.size, '兩邊相加要等於全部 ⇒ 不等於就是有人多了第三種狀態').toBe(all.length);
    for (const s of wa) expect(nwa.has(s), `${s} 同時出現在兩邊 = 分類自相矛盾`).toBe(false);

    const caseSlug = extractShowcaseCaseSlugs(readFileSync(BRAND_SHOWCASE_PATH, 'utf-8'));
    expect(
      caseSlug.has('__gated_canary__'),
      '守門靶拿到了 showcase case ⇒ 它不是真供應商, 那個 case 會是死碼',
    ).toBe(false);
  });

  // ✅ 已首灌的家:必須【已開寫】而且【case 在】—— 兩者缺一, 客人就會點進一個沒有品牌形象區的商品頁。
  //   🔴 gilles 2026-08-27 · dbk 2026-09-04 各自首灌後加入本格(F4:dbk 原本沒有專屬斷言)。
  it.each([
    ['gilles', 'gilles'],
    ['dbk', 'dbk'],
    ['rizoma', 'rizoma'],
  ])('🔴 %s 首灌後應為「已開寫 + case 在」', (supplierSlug, brandSlug) => {
    const cfg = SUPPLIER_CONFIGS[supplierSlug];
    expect(cfg, `${supplierSlug} 不在 SUPPLIER_CONFIGS 裡`).toBeDefined();
    expect(cfg!.writeAllowed, `${supplierSlug} 掉回未開寫 ⇒ 首灌的東西會停止同步`).toBe(true);
    const caseSlug = extractShowcaseCaseSlugs(readFileSync(BRAND_SHOWCASE_PATH, 'utf-8'));
    expect(caseSlug.has(brandSlug), `${brandSlug} 的 showcase case 不見了 ⇒ 商品頁少一整塊`).toBe(true);
  });
});
