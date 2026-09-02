// @vitest-environment jsdom
//
// DnaShowcase smoke test — 品牌放量精簡版 N°01 + 短 N°02(#212 方向3、對齊 `EbcShowcase`)。
//
// 🔴🔴 **這支檔 2026-09-03 才出現, 而它是同族 18 支裡【最後一支】** ——
//   線 `-auth` 補 `⟦f3-SHOWCASEREGNOGUARD⟧` 時量到:18 支 showcase 元件裡缺自己那支 test 的只有 1 支。
//   ⇒ 而 `dna` 那一格在 dispatcher 上**已經有守門了**(接上了沒有人看),
//     缺的是**它自己畫壞了沒有人看** —— 而那正是同族其他 17 支都有人看的那一格。
//   📎 ⟦f3-DNANOSMOKE⟧
//
// 🛑 **它證不到什麼**:jsdom 不跑 CSS ⇒ 本檔證「那些節點在」, **不證它們長得對**。
//   版面要用真瀏覽器量(`bash scripts/storefront-probe/up.sh`)。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { DnaShowcase } from './DnaShowcase';

afterEach(cleanup);

describe('DnaShowcase', () => {
  it('N°01:eyebrow logo + h2 + lead + 3 卡', () => {
    render(<DnaShowcase />);
    expect(document.querySelector('#pd-h-dna01')).not.toBeNull();
    expect(screen.getByAltText('DNA Filters')).toBeDefined();
    expect(screen.getByRole('heading', { level: 2, name: '為什麼選 DNA' })).toBeDefined();
    expect(screen.getByText(/擋得住的不是網目，是靜電/)).toBeDefined();
    expect(screen.getByText('靜電吸附，孔隙大顆粒照樣留住')).toBeDefined();
    expect(screen.getByText('自有工廠，三條產線出貨')).toBeDefined();
    expect(screen.getByText('沙漠實測，扛得住細沙')).toBeDefined();
    expect(document.querySelectorAll('.pd-feature-card').length).toBe(3);
  });

  it('短 N°02:信任狀四格 + 故事段 + 產品線四卡', () => {
    render(<DnaShowcase />);
    expect(
      screen.getByRole('heading', { level: 2, name: '上油棉紗擋沙，引擎照樣順暢呼吸' }),
    ).toBeDefined();
    expect(document.querySelector('.pd-bs.pd-bs--dna')).not.toBeNull();
    expect(screen.getByText('Mandra Attika')).toBeDefined();
    expect(screen.getByText('Red Dot 設計獎')).toBeDefined();
    expect(document.querySelectorAll('.pd-bs-stat').length).toBe(4);
    expect(screen.getByAltText('DNA 濾材結構剖面示意圖')).toBeDefined();
    expect(screen.getByText('Air Filter')).toBeDefined();
    expect(screen.getByText('Oil Filter')).toBeDefined();
    expect(document.querySelectorAll('.pd-bs-mcard').length).toBe(4);
  });

  /**
   * 🔴🔴 **這一格不是 smoke test —— 它把本檔檔頭那個【未驗】關掉。**
   *
   * `DnaShowcase.tsx:3` 逐字寫著:「`pd-bs--dna` 這個 class 在 storefront 的 CSS 裡
   * **沒有任何規則**, 而**沒有人看過它**」, 並列了四種解釋(①真的沒寫 ②兄弟撐著
   * ③靠父層版面 ④走 inline style), 然後說「**下一次有人為了任何理由走到這條動線時,
   * 請順手看一眼它**」。⇒ 2026-09-03 我走到了, 所以我看了。
   *
   * 🔬 **量到的(帶正負對照, 在 `apps/storefront/src/styles/`)**:
   *   `.pd-bs--dna` ⇒ **0** 條規則
   *   🟢 正對照 `.pd-bs--ebc` ⇒ **1**(同族精簡版的兄弟, 尺會動)· `.pd-bs` ⇒ **43**
   *   🔵 負對照 現造 class ⇒ **0**
   *   而 DNA 的品牌色 token(`--dna*`)⇒ **0**(🟢 正對照 `--ebc-blue` ⇒ 2 · 🔵 負對照 ⇒ 0)
   *
   * ✅ **⇒ 四種解釋收斂到 ①「真的沒寫」, 而它【不是缺陷】**:
   *   那個修飾子的唯一用途是 `--bs-accent`(品牌強調色), 而**全 repo 只有 8 家有**
   *   (`evotech` / `lightech` / `cnc-racing` / `samco` / `ebc` / `akrapovic` / `extreme` / `gilles`);
   *   dispatcher 有 **19** 家 ⇒ **11 家沒有, DNA 是其中之一 ⇒ 它在多數那邊。**
   *   沒有覆寫時走 `.pd-bs { --bs-accent: var(--c-text); }` 的預設 ⇒ **有顏色, 只是不是品牌色。**
   *
   * 🛑 **⇒ 剩下的是【視覺決定】不是缺陷** —— DNA 該不該有自己的強調色, 那是 Sean 拍板,
   *   而**本窗不自己發明一個顏色**。這一格只把「沒有人看過」關掉, 不替他決定。
   * 📌 **為什麼寫成一格測試而不是一句註解**:它釘住那個「0 家 ⇒ 8 家」的分母 ——
   *   有人日後幫 DNA 加了 accent, 這一格會紅, 而那時該去改的是這段敘述, 不是把它刪掉。
   */
  it('🔵 pd-bs--dna 沒有 CSS 規則 —— 而那是【多數】不是缺陷(檔頭那個未驗, 收在這裡)', () => {
    render(<DnaShowcase />);
    // 節點掛得上(class 在不在是本檔看得到的;它有沒有規則是 CSS 那一層, 見上面量測)
    const el = document.querySelector('.pd-section.pd-bs.pd-bs--dna');
    expect(el, 'N°02 那一段的三個 class 少了任何一個 ⇒ 版面會塌, 而 jsdom 看不到塌').not.toBeNull();
    // 🔵 而 N°01 那一段【刻意】只有 pd-section, 沒有 pd-bs ——
    //    釘住它, 免得有人「順手統一」而改掉了版面。
    const heads = document.querySelectorAll('.pd-section');
    expect(heads.length, '兩段 section 各一個').toBe(2);
    expect(heads[0]!.className).toBe('pd-section');
  });
});
