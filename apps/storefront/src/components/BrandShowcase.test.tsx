// @vitest-environment jsdom
//
// BrandShowcase dispatcher 守門 —— 2026-09-02 新增(`⟦f3-RIZOMASHOWCASE⟧` 那一片帶進來的)。
//
// 🔴🔴 **為什麼這支檔今天才出現**:改動前 `ls apps/storefront/src/components/BrandShowcase*.test.tsx`
//   ⇒ **查無**。⇒ 那個 switch 上架到第 17 家為止,**沒有任何一格在守「有沒有註冊進去」**。
//   ⇒ 🎯 而它壞掉的方式是:**畫面只是少一整區,不會報錯、不會紅、console 乾淨**。
//      —— 元件寫好了、測試全綠、而客人在商品頁上看不到它。
//
// ✅ **2026-09-03 線 `-auth` 補完 ⟦f3-SHOWCASEREGNOGUARD⟧:每一家【全部】各一格。**
//   ⛔ 本檔原註 ~~「涵蓋 `rizoma` 與 `dbk` 兩格。已知未涵蓋:其餘 17 家」~~ 今天不再成立。
//   ⚠️ 而那一列板上寫「dispatcher 有 **18** 家」也已過期 —— ⛔ ~~實數 19~~ ⇒ **2026-09-04 起 20**
//     (`dbk` 09-03 上架 · `wrs` 09-04 加入)。
//   🔴🔴 **而這個數字上一輪就是這樣過期的, 這一輪又過期一次** —— code-reviewer 抓到它(M6)。
//     ⇒ 📌 **本檔存在的理由就是防「數字與 switch 脫鉤」, 而它自己的檔頭一直在脫鉤。**
//     ✅ **所以【不要引用這個數字】** —— 下面那格 `:註冊表的分母要跟著 switch 走` 是唯一權威,
//        它當場 parse `BrandShowcase.tsx` ⇒ 它不會過期。本行寫數字只是給人讀的, 當場重數才算數。
//     數法:`grep -c "^    case '" BrandShowcase.tsx` + `grep -c "^    case RPM_CARBON_BRAND_SLUG:"`。
//     📌 那個 `+1` 正是最容易被漏掉的一格 —— 它是唯一**不用 `'字面'` 而用具名常數**的 case。
//
// 🔴 **為什麼第 19 家非跟上這個前例不可**(2026-09-03 `-front` R1 F3 量到):
//   隔壁 `showcase-dispatch-coverage.test.ts` 那道閘**只認 import + `<X />` 兩件事**
//   ⇒ 實測把 `case 'dbk'` 改成 `case 'dbk-typo'`,那道閘**仍回 dispatched=true、照樣全綠**。
//   ⇒ 🎯 它擋得住「整個 case 被拿掉」,擋不住「case 標籤打錯字 / 接到別家的元件」——
//     而那兩種的畫面後果一模一樣:**客人少看到一整區,不報錯、不紅、console 乾淨。**

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { MOCK_PRODUCTS, RPM_CARBON_BRAND_SLUG } from '@/data/mock-products';
import { BrandShowcase } from './BrandShowcase';
import { ProductHighlights } from './ProductHighlights';
import { ProductSwatchWall } from './ProductSwatchWall';
import { ProductSpotlight } from './ProductSpotlight';
import { GbRacingShowcase } from './GbRacingShowcase';
import { BonamiciShowcase } from './BonamiciShowcase';
import { EvotechShowcase } from './EvotechShowcase';
import { LightechShowcase } from './LightechShowcase';
import { CncRacingShowcase } from './CncRacingShowcase';
import { EaziGripShowcase } from './EaziGripShowcase';
import { SamcoShowcase } from './SamcoShowcase';
import { MotogadgetShowcase } from './MotogadgetShowcase';
import { Front3dShowcase } from './Front3dShowcase';
import { MateryaShowcase } from './MateryaShowcase';
import { EbcShowcase } from './EbcShowcase';
import { DnaShowcase } from './DnaShowcase';
import { AkrapovicShowcase } from './AkrapovicShowcase';
import { KspeedShowcase } from './KspeedShowcase';
import { ExtremeComponentsShowcase } from './ExtremeComponentsShowcase';
import { GillesShowcase } from './GillesShowcase';
import { RizomaShowcase } from './RizomaShowcase';
import { DbkShowcase } from './DbkShowcase';
import { WrsShowcase } from './WrsShowcase';

// 各家 showcase 都是重元件(影片 / IntersectionObserver / 大量標記)——
// 本檔只問「有沒有分派到」,不問「它畫了什麼」(那是各家自己那支 test 的事)。
vi.mock('./RizomaShowcase', () => ({
  RizomaShowcase: () => <div data-testid="rizoma-showcase" />,
}));
vi.mock('./DbkShowcase', () => ({
  DbkShowcase: () => <div data-testid="dbk-showcase" />,
}));

afterEach(cleanup);

const base = MOCK_PRODUCTS[0]!;

describe('BrandShowcase dispatcher', () => {
  it('🔴 brandSlug=rizoma ⇒ 分派到 RizomaShowcase', () => {
    // 🧬 突變:把 BrandShowcase.tsx 的 `case 'rizoma'` 拿掉 ⇒ 這一格必須紅。
    //    否則「第 18 家有沒有接上」在 CI 上零訊號。
    const { container } = render(<BrandShowcase product={{ ...base, brandSlug: 'rizoma' }} />);
    expect(container.querySelector('[data-testid="rizoma-showcase"]')).not.toBeNull();
  });

  it('🔴 brandSlug=dbk ⇒ 分派到 DbkShowcase(第 19 家)', () => {
    // 🧬 突變:把 `case 'dbk'` 拿掉、或打成 'dbk-typo'、或接到 <RizomaShowcase /> ⇒ 這一格都必須紅。
    //    隔壁那道 dispatch 閘對後兩種是綠的(見檔頭)⇒ 只有這一格看得見「接對了沒」。
    const { container } = render(<BrandShowcase product={{ ...base, brandSlug: 'dbk' }} />);
    expect(container.querySelector('[data-testid="dbk-showcase"]')).not.toBeNull();
    // 🟢 同時釘住「沒有接到別家」—— 接到 RizomaShowcase 時上一行仍會紅, 而這一行說得出紅在哪
    expect(container.querySelector('[data-testid="rizoma-showcase"]')).toBeNull();
  });

  /**
   * 🔴🔴 **19 家的註冊表 —— 而這一格用的尺與上面兩格【不同】,那是刻意的。**
   *
   * 上面兩格用 `render()` + `vi.mock` ⇒ 要驗一家就得多寫一個 `vi.mock`(路徑必須是字面、不能迴圈)
   * ⇒ **19 家要 19 個 mock**,而那是「為了測試而寫的樣板」不是判別力。
   *
   * ✅ 本格改問一個更直接的問題:**dispatcher 回傳的那個 element,它的 `type` 是不是那一家的元件?**
   *   —— 不 render、不 mock,**直接呼叫**這個純 switch 函式,比對回傳值的 `type` 身分。
   *
   * 🎯 **它擋得住四種。而隔壁 `showcase-dispatch-coverage.test.ts` 擋得住幾種 —— 我實測了,**
   *   **而結果與那一列板上寫的【不一樣】,所以逐格列出來:**
   *   ```
   *   突變                                        隔壁閘   本檔
   *   ① case 整個被拿掉(gilles)                  🔴 紅    🔴 紅(2 格)
   *   ② case 標籤打錯字(extreme ⇒ extreme-typo)  🟢 綠    🔴 紅   ← 只有本檔看得見
   *   ③ 單向接到別家(ebc ⇒ DnaShowcase)          🔴 紅    🔴 紅
   *   ④ 兩家【對調】(ebc ↔ dna)                  🟢 綠    🔴 紅   ← 只有本檔看得見
   *   ⑤ 新增第 20 家而沒回來註冊                   🟢 綠    🔴 紅   ← 只有本檔看得見
   *   ```
   *   ⚠️ **③ 那一格我原本照板上抄成「隔壁擋不住」—— 實測它【擋得住】**:單向改接之後
   *     `EbcShowcase` 變成沒有人用 ⇒ 那道「元件有沒有接進 switch」的閘當場紅。
   *     🎯 **它真正的盲區是【對調】** —— 兩支元件都還被用到 ⇒ 它的分母上什麼都沒少。
   *     📌 **⇒ 「接錯了」不是一種,是兩種,而它們在那道閘底下顏色相反。**
   *   📌 而這幾種的畫面後果一模一樣:**客人少看到一整區(或看到別家的),不報錯、不紅、console 乾淨。**
   *
   * 🛑 **它證不到什麼(先讀,不要把它讀得比實際強)**:
   *   · 它只證「分派到那個元件」,**不證那個元件畫得對** —— 那是各家自己那支 test 的事。
   *   · 它讀的是**這棵樹上的** `BrandShowcase.tsx`;線上跑的是不是這一版,本檔答不出。
   */
  const REGISTRY: readonly (readonly [string, unknown])[] = [
    ['gb-racing', GbRacingShowcase],
    ['bonamici', BonamiciShowcase],
    ['evotech', EvotechShowcase],
    ['lightech', LightechShowcase],
    ['cnc-racing', CncRacingShowcase],
    ['eazi-grip', EaziGripShowcase],
    ['samco', SamcoShowcase],
    ['motogadget', MotogadgetShowcase],
    ['front3d', Front3dShowcase],
    ['materya', MateryaShowcase],
    ['ebc', EbcShowcase],
    ['dna', DnaShowcase],
    ['akrapovic', AkrapovicShowcase],
    ['k-speed', KspeedShowcase],
    ['extreme', ExtremeComponentsShowcase],
    ['gilles', GillesShowcase],
    ['rizoma', RizomaShowcase],
    ['dbk', DbkShowcase],
    // 🟢 2026-09-04 加入第 20 家 —— 而**加它進來的不是我記得要加, 是下面那道分母閘當場紅**:
    //    逐字「switch 有 20 支分支, 而本檔的註冊表只釘了 19 支 ⇒ 那一家現在零守門」。
    //    📌 這正是它註解裡預告的第 ⑤ 種突變, 而它在真實的第 20 家身上第一次被兌現。
    ['wrs', WrsShowcase],
  ] as const;

  it.each(REGISTRY)('🔴 brandSlug=%s ⇒ 分派到【那一家】的元件(不是別家、不是 null)', (slug, Comp) => {
    const el = BrandShowcase({ product: { ...base, brandSlug: slug as string } }) as {
      type?: unknown;
    } | null;
    expect(el, `brandSlug=${slug} 回了 null ⇒ 那個 case 不在 switch 裡`).not.toBeNull();
    expect(el?.type, `brandSlug=${slug} 分派到了別家的元件`).toBe(Comp);
  });

  it('🔴 第 19 家是 RPM —— 它是唯一【不回單一元件】的那一支, 所以單獨一格', () => {
    // 🛑 RPM 走 `RPM_CARBON_BRAND_SLUG` 具名常數(不是字面), 且回的是 Fragment 包三支既有元件
    //    ⇒ 上面那張表的形狀對它不成立 ⇒ 硬塞進去會讓那張表多一個「例外」欄位。
    //    📌 而隔壁 `showcase-dispatch-coverage.test.ts` 也刻意把它排除在分母外(它沒有自己的 Showcase 檔)
    //      ⇒ **兩道閘都排除它 ⇒ 它會變成沒有人在看的那一格** ⇒ 這一格就是補那個洞。
    const el = BrandShowcase({
      product: { ...base, brandSlug: RPM_CARBON_BRAND_SLUG },
    }) as { type?: unknown; props?: { children?: unknown } } | null;
    expect(el, 'RPM 那一支回了 null ⇒ 那個 case 不在 switch 裡').not.toBeNull();
    const kids = (el?.props?.children ?? []) as { type?: unknown }[];
    expect(kids.map((k) => k?.type)).toEqual([ProductHighlights, ProductSwatchWall, ProductSpotlight]);
  });

  it('🔵 註冊表的分母要跟著 switch 走 —— 不是我手打的一個數字', () => {
    // 🔴 這一格擋的是本檔自己最可能的壞法:**有人新增下一家而沒有回來加一行。**
    //   ⛔ ~~「新增第 20 家」~~ ⇒ 2026-09-04 第 20 家(`wrs`)已經在了, 而**它就是被這一格逼進來的**
    //     (逐字紅了一發:「switch 有 20 支分支, 而本檔的註冊表只釘了 19 支」)。
    //   ✅ **這一句刻意改成不帶序號** —— 帶序號的句子每來一家就過期一次, 而沒有東西會叫。
    //    ⇒ 那時上面 18 格【全綠】,而新那一家零守門 —— 與本列原本的病一模一樣。
    // 數法:`case '…':`(字面)+ `case RPM_CARBON_BRAND_SLUG:`(具名常數)= switch 的全部分支。
    // 🔴 **不能用 `new URL('./…', import.meta.url)`** —— 本檔跑在 `jsdom` 環境, 而那裡的
    //    `import.meta.url` 是 `http://…` ⇒ `readFileSync` 當場 `TypeError: The URL must be of scheme file`。
    //    (隔壁 `showcase-dispatch-coverage.test.ts` 用得成, 是因為它跑 node 環境 —— 兩支檔不同環境。)
    //    ⇒ 改從 repo 根往下指, 而**根在哪由下面那道正對照證明**(讀不到 ⇒ case 數 0 ⇒ 那一格會紅)。
    const src = readFileSync(
      resolve(process.cwd(), 'apps/storefront/src/components/BrandShowcase.tsx'),
      'utf8',
    );
    const literalCases = src.match(/^\s*case '[^']+':/gm) ?? [];
    const namedCases = src.match(/^\s*case RPM_CARBON_BRAND_SLUG:/gm) ?? [];
    // 🟢 正對照:分母不得為 0(尺接不上時它會是 0, 而 0 === 0 會讓下一行恆綠)
    expect(literalCases.length, '讀不到任何 case ⇒ 這把尺沒接上, 不是 switch 空了').toBeGreaterThan(0);
    expect(namedCases.length, '讀不到 RPM 那一支具名 case ⇒ 尺沒接上或它被改名了').toBe(1);
    expect(
      literalCases.length + namedCases.length,
      `switch 有 ${literalCases.length + namedCases.length} 支分支, 而本檔的註冊表只釘了 ${REGISTRY.length + 1} 支` +
        ' ⇒ 有人加了一家而沒有回來加一行, 那一家現在零守門',
    ).toBe(REGISTRY.length + 1);
  });

  it('🔵 負對照:未知品牌 ⇒ 什麼都不畫(而不是畫錯一家)', () => {
    // 🟢 這一格證明上面那格的 not.toBeNull() 有判別力 ——
    //    若 dispatcher 對任何 slug 都回同一個東西,這裡會紅。
    const { container } = render(
      <BrandShowcase product={{ ...base, brandSlug: 'zzq-not-a-brand' }} />,
    );
    expect(container.querySelector('[data-testid="rizoma-showcase"]')).toBeNull();
    expect(container.querySelector('[data-testid="dbk-showcase"]')).toBeNull();
    expect(container.innerHTML).toBe('');
  });
});
