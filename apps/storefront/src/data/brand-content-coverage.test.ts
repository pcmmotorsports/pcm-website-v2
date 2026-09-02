// brand-content-coverage.test.ts — 「上架供應商忘了補品牌介紹頁內容」的守門
// (板子 `docs/launch-todo.md` 的 `⟦b4-BRAND1⟧`「新品牌上架後客人在品牌區看不到它」,線G 2026-08-29)
// 🔴 ~~原本寫「`:215`」~~ —— 2026-09-02 量到那一行今天是一段 ``` 圍籬,真正那一列已漂到 `:482`。
//    ⇒ 改成錨:`grep -n '⟦b4-BRAND1⟧' docs/launch-todo.md`。
//    📌 為什麼這一格特別要修:板上的壞座標至少還有人會回頭改,而**跑進 repo 的這一個
//       沒有任何機制會碰它** —— 板子改一百次,這行註解都不會跟著動。
//
// 客人看到的形狀:`app/brands/[slug]/page.tsx:102` 逐字 `if (!brand) notFound();`
// ⇒ 一家品牌真的上架了、商品也進來了,而 `BRAND_CONTENT` 裡沒有它 ⇒ 客人點進去是 404。
//
// 🔴 **這一片不是修一個現有的缺陷,是【讓下一次的缺陷會出聲】。**
//   落筆當下實量:供應商 `brandSlug` 18 家,而差集只有 `__gated_canary__`
//   ⇒ 17/17 真供應商品牌都在 `BRAND_CONTENT` 的 21 家裡 ⇒ **今天沒有客人會撞到。**
//   而**沒有任何東西會在下一次撞上時叫** —— 那才是這道閘存在的理由。
//
// ═══════════════════════════════════════════
// 🔴 它與隔壁 `components/brand-showcase-coverage.test.ts` 守的是【相反的方向】
// ═══════════════════════════════════════════
//   隔壁那支 `:10-13` 逐字說明它為什麼**不**綁 brand-content:
//     「brand-content.ts 有 21 家,而其中數家從未在 supplier-config.ts 登記過、
//       網站庫商品數 = 0…現在就要求它們有 showcase 是【一裝就紅】」
//   ⇒ 它擋的是「**每個 brand-content 條目都要有 showcase**」—— 那個方向確實會一裝就紅。
//   ⇒ 而本檔要的是反過來:「**每個 writeAllowed=true 的供應商品牌,都要有 brand-content 條目**」。
//   📌 **同一組資料、相反的涵蓋方向,一個一裝就紅、一個今天是綠的。**
//      沿用隔壁的【結論】會得到「這種閘裝不起來」;讀它的【射程】才看得出方向不同。
//
// ═══════════════════════════════════════════
// 🔴 `__gated_canary__` 怎麼處理 —— **不用名字排除,靠 writeAllowed 自動排除**
// ═══════════════════════════════════════════
//   `scripts/supplier-config.ts:386` 的 `__gated_canary__` 是**寫入權限的測試靶**,不是品牌
//   (`writeAllowed` 恆 `false`)。本閘的分母綁 `writeAllowed === true` ⇒ 它天生不在分母裡。
//   ⚠️ **「那哪天有人把它翻成 true,本閘會不會安靜地漏掉它?」——不會,而理由不在本檔:**
//     `scripts/rpm-import-cli.test.ts:45` 已經在守那件事(`--supplier=__gated_canary__ --confirm-write`
//     必須非零退出並明說 `writeAllowed=false`)⇒ 翻成 true 的那一刻**那支會紅**。
//     🔴 而本閘的反應**與真品牌相同**:它會要求 `__gated_canary__` 有 brand-content 條目 ⇒ **也紅**。
//     ⇒ 兩支都紅,而訊息不同:那支說「授權閘破了」,本支說「這家沒有品牌頁」。**都不是安靜的。**
//
// ═══════════════════════════════════════════
// 🔴🔴 這道閘紅了以後,**不要去 `brand-content.ts` 加一筆** —— 那是鐵則 1 禁止的動作
// ═══════════════════════════════════════════
//   `data/brand-content.ts:1` 逐字:「品牌介紹頁內容資料(21 家)**【機器產生,不要手改】**」
//   來源 = Open Design `pcm-home-redesign/brand-content-data.js`;
//   **Sean 2026-08-03 拍 Q1=B:本線真權威在 Open Design**(鐵則 1 的明文例外)。
//   重產指令寫在該檔 `:7` 起的「重新產生(來源改動後)」那段。
//
//   ⇒ **正確順序**:①先在 OD 的 `brand-content-data.js` 補這家的內容
//                 ②再照 `brand-content.ts` 檔頭那條指令**重新產生本檔**
//                 ③產生後**必跑** `brand-content.test.ts`(它守 D2/D3 依賴的結構不變量)
//
//   🔴 **為什麼這一段非寫不可**:這道閘紅的時候,讀它的人第一個念頭是「去 brand-content.ts 加一筆」
//      —— **而那正好是鐵則 1 禁止的動作**,且手加的條目下次重產就會被蓋掉、零訊號。
//      📌 **一支會把人導向違規修法的測試,比沒有那支測試糟。**
//
//   ⚠️ 連帶:`notFound()` 在這個設計下**是正確行為**,不是 bug ——
//      一家品牌在 Sean 還沒寫它的文案之前,那一頁**本來就不該存在**(fallback 只會給客人一頁空殼)。
//      ⇒ 本閘要的不是「讓它顯示出來」,是**讓那個缺口出聲**。
//
// ═══════════════════════════════════════════
// ⚠️ 它守不到什麼(照隔壁那支的規格,先寫這一段)
// ═══════════════════════════════════════════
//   · **只看 `BRAND_CONTENT` 有沒有這個 slug** ⇒ 條目**內容**是不是填好的(band/facts/about…)它不看。
//     一個只有 slug、其餘全空的條目在本閘底下是綠的,而客人會看到一個空殼頁。
//   · **不看網站庫**:分母是 `supplier-config.ts` 的靜態設定,不是 DB 裡真的有幾件商品。
//     一家 `writeAllowed=true` 而實際 0 件商品的品牌,本閘照樣要求它有條目。
//   · **不看 `/brands` 目錄頁**:那頁走 `BRAND_CONTENT` 全表,不是這條路徑。
//   · **不看商品頁品牌形象區**:那是隔壁 `brand-showcase-coverage.test.ts` 的分母。

import { describe, it, expect } from 'vitest';
import { BRAND_CONTENT } from './brand-content';
import { SUPPLIER_CONFIGS } from '../../../../scripts/supplier-config';

/**
 * 「哪些已開放寫入的供應商品牌,在 `BRAND_CONTENT` 裡沒有條目」。
 *
 * 抽成純函式是為了讓**負對照跑得起來** —— 直接對 `SUPPLIER_CONFIGS` 斷言的話,
 * 「該紅必紅」那個世界造不出來(那份設定是真的,不能為了測試改它)。
 */
function brandsMissingContent(
  suppliers: ReadonlyArray<{ brandSlug: string; writeAllowed: boolean }>,
  contentSlugs: ReadonlySet<string>,
): string[] {
  return suppliers
    .filter((c) => c.writeAllowed)
    .map((c) => c.brandSlug)
    .filter((slug) => !contentSlugs.has(slug))
    .sort();
}

describe('品牌介紹頁內容覆蓋(上架了而客人點進去 404)', () => {
  const contentSlugs = new Set(BRAND_CONTENT.map((b) => b.slug));
  const suppliers = Object.values(SUPPLIER_CONFIGS);

  it('前提:兩邊的分母都不是空的(空掉的話下面整段恆綠)', () => {
    expect(
      contentSlugs.size,
      'BRAND_CONTENT 抽不到 slug ⇒ 下面那條的 contentSlugs 是空集合 ⇒ 它會把【每一家】都報成缺,' +
        '或者(若供應商側也空)整條恆綠。兩種都不是它該有的樣子。',
    ).toBeGreaterThan(10);
    expect(
      suppliers.filter((c) => c.writeAllowed).length,
      'SUPPLIER_CONFIGS 裡沒有任何 writeAllowed=true ⇒ 主閘的分母是空的 ⇒ 它恆綠。',
    ).toBeGreaterThan(0);
  });

  // 🔴 2026-08-30 線C `-b4` 更正失敗訊息的指路(舊字面留著,不刪):
  //   ~~「補條目的做法見 docs/runbooks/supplier-storefront-onboarding.md」~~
  //   ⇒ **那份 runbook 的 `:12-13` 逐字寫著「本份【不管】品牌內容…是另一條線」**
  //   ⇒ 📌 紅的時候照它走的人,會打開一份【自己聲明不涵蓋這件事】的文件。
  it('🔴 主閘:每一家 writeAllowed=true 的供應商品牌,都要在 BRAND_CONTENT 裡有條目', () => {
    const missing = brandsMissingContent(suppliers, contentSlugs);
    expect(
      missing,
      `這些品牌已開放寫入正式庫(有真商品),而 apps/storefront/src/data/brand-content.ts 裡沒有它們` +
        ` ⇒ 客人點 /brands/<slug> 會走到 page.tsx 的 notFound()。` +
        ` 🔴 修法【不是】在 brand-content.ts 手加一筆(它是機器產生的,見本檔檔頭)——` +
        ` 先在 Open Design pcm-home-redesign/brand-content-data.js 補內容,再照` +
        ` brand-content.ts 檔頭那條指令重產。品牌頁內容那條線見 ~/.claude/skills/pcm-brand-page/SKILL.md。`,
    ).toEqual([]);
  });

  it('✅ 該綠必綠:今天現況(17 家真供應商品牌全在)不能因為本閘而紅', () => {
    // 這一條與主閘看同一件事,而它存在的理由不同:
    // 主閘壞成「恆紅」時,上面那條會紅而**讀的人會以為真的缺了品牌**。
    // 這一條把「今天應該是 0 缺」寫成一個獨立的宣稱 —— 它紅 = 閘壞了,不是資料壞了。
    expect(brandsMissingContent(suppliers, contentSlugs).length).toBe(0);
  });

  it('🔴 該紅必紅:現造一家 writeAllowed=true 而沒有 brand-content 的供應商 ⇒ 必須被抓到、而且要印出是哪一個', () => {
    const fake = [
      ...suppliers.map((c) => ({ brandSlug: c.brandSlug, writeAllowed: c.writeAllowed })),
      { brandSlug: 'zz-newly-onboarded-0829', writeAllowed: true },
    ];
    const missing = brandsMissingContent(fake, contentSlugs);
    expect(missing, '造了一家沒有 brand-content 的活供應商,而本閘沒抓到 ⇒ 它對真的缺口也不會叫').toContain(
      'zz-newly-onboarded-0829',
    );
    // 「有沒有抓到」與「訊息說不說得出是哪一個」是兩個宣稱:
    // 只斷言 length>0 的話,一個回傳 ['???'] 的實作照樣過,而修的人不知道要補哪一家。
    // 🔴 而這裡【刻意不寫 toEqual([...])】—— 2026-08-29 突變 M-G215 當場量到的理由:
    //   注入一個真的缺口(supplier-config.ts 加一家 writeAllowed=true 而無 brand-content)之後,
    //   `toEqual` 那條會紅在「陣列多了一個真缺口」上,而它的訊息長得像【負對照壞了】。
    //   ⇒ 負對照要斷言【它自己造的那一件】,不要順便斷言真實資料的現況 —— 那是主閘的工作。
  });

  it('負對照:同一家但 writeAllowed=false ⇒ 不該被抓(否則未開寫的品牌會把本閘打成恆紅)', () => {
    const fake = [
      ...suppliers.map((c) => ({ brandSlug: c.brandSlug, writeAllowed: c.writeAllowed })),
      { brandSlug: 'zz-registered-not-live-0829', writeAllowed: false },
    ];
    // 同上:斷言【我造的那一件沒被抓】,而不是「整個結果是空的」。
    expect(brandsMissingContent(fake, contentSlugs)).not.toContain('zz-registered-not-live-0829');
  });

  it('前提:__gated_canary__ 仍是 writeAllowed=false(它一旦翻 true,本閘會把它當真品牌要求品牌頁)', () => {
    const canary = suppliers.find((c) => c.brandSlug === '__gated_canary__');
    expect(canary, 'supplier-config.ts 裡找不到 __gated_canary__ ⇒ 本檔檔頭那段說明已經過期,請一起改').toBeDefined();
    expect(
      canary!.writeAllowed,
      '__gated_canary__ 的 writeAllowed 被翻成 true ⇒ 它會進本閘的分母而被要求有 brand-content 條目。' +
        '正確的處置是去看 scripts/rpm-import-cli.test.ts:45(授權閘)為什麼也紅了,不是來這裡加排除。',
    ).toBe(false);
  });
});
