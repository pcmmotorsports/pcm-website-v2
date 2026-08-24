// @vitest-environment jsdom
// danger-zone-details.test.tsx — 2026-08-20 新建。
//
// 🔴 **這支元件在此之前零測試**(量法:`git grep -l 'danger-zone-details' -- apps/admin/src`
//    ⇒ 只有元件本身 + `order-detail.tsx` 一個渲染點,無 `.test.`)。
//    而它是面板最底那兩顆鈕的殼 —— Sean 回報「取消整張訂單…點下去沒反應」就落在這裡。
//
// ⚠️⚠️ **這支測試守得住什麼、守不住什麼(先讀這段再引用它)**:
//    ✅ 守得住:展開時**有沒有叫** `scrollIntoView`、以及三條不該叫的路。
//    🔴 **守不住:使用者到底看不看得到。** jsdom 不做版面、不做捲動,
//       `scrollIntoView` 在這裡是我們自己塞的 spy,**它回什麼都不會改變任何位置**。
//       ⇒ 「叫了」與「看到了」是兩件事,而本檔只證得到前者。
//       要證後者只能開真瀏覽器量 `revealed.getBoundingClientRect().top < 容器 clientHeight`。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { DangerZoneDetails, DetailsScrollOnOpen } from './danger-zone-details';

afterEach(() => {
  cleanup();
  window.location.hash = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup(props: { anchorId?: string; defaultOpen?: boolean } = {}) {
  const spy = vi.fn();
  // jsdom 沒有實作 scrollIntoView ⇒ 不塞這個,元件會 throw(而那是【元件壞了】不是【沒捲】)。
  Element.prototype.scrollIntoView = spy;
  render(
    <DangerZoneDetails summary={<span>申請取消整張單</span>} {...props}>
      <p>取消表單</p>
    </DangerZoneDetails>,
  );
  return { spy, details: screen.getByText('取消表單').closest('details') as HTMLDetailsElement };
}

describe('DangerZoneDetails 展開時把被揭露的那塊捲進視野', () => {
  it('🔴 正對照:使用者展開 ⇒ 捲', () => {
    const { spy, details } = setup();
    expect(spy).not.toHaveBeenCalled();
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toMatchObject({ block: 'nearest' });
  });

  it('🔴 負對照 1:收合 ⇒ 不捲(否則關掉一塊也會把畫面拉走)', () => {
    const { spy, details } = setup({ defaultOpen: true });
    details.open = false;
    details.dispatchEvent(new Event('toggle'));
    expect(spy).not.toHaveBeenCalled();
  });

  it('🔴 負對照 2:hash 命中自己 ⇒ 不捲,讓錨點那條路自己處理(兩邊搶會跳兩次)', () => {
    window.location.hash = '#cancel';
    const { spy, details } = setup({ anchorId: 'cancel' });
    // 掛載時 effect 就會把它打開 ⇒ 這裡再打一發 toggle 模擬瀏覽器行為
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    expect(spy).not.toHaveBeenCalled();
  });

  it('負對照 3:hash 指向別人 ⇒ 照捲(上一條擋的是【自己被指名】,不是【有 hash】)', () => {
    window.location.hash = '#somewhere-else';
    const { spy, details } = setup({ anchorId: 'cancel' });
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  // 🔴 `#701`:採購表單那兩塊借的是這支殼(它們是 server component、掛不了 onToggle)。
  //    它與上面那支共用同一份捲動邏輯(`useRevealScroll`)——
  //    **不共用的話這會是本 repo 第三份同樣的邏輯**,而那正是這一夜盤點出來的形狀。
  //    ⚠️ 它與 `DangerZoneDetails` 的差別:**呼叫端自己保留 `<summary>`** ⇒ 版面零改動。
  it('🔴 DetailsScrollOnOpen:展開 ⇒ 捲;收合 ⇒ 不捲', () => {
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;
    render(
      <DetailsScrollOnOpen className='group'>
        <summary className='自己的樣式'>＋ 再跟一家供應商下訂</summary>
        <p>採購表單</p>
      </DetailsScrollOnOpen>,
    );
    const el = screen.getByText('採購表單').closest('details') as HTMLDetailsElement;
    // 呼叫端的 summary class 原封保留 —— 這一條守的是「版面零改動」那個宣稱
    expect(el.querySelector('summary')?.className).toBe('自己的樣式');
    expect(el.className).toBe('group');

    el.open = true;
    el.dispatchEvent(new Event('toggle'));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toMatchObject({ block: 'nearest' });

    spy.mockClear();
    el.open = false;
    el.dispatchEvent(new Event('toggle'));
    expect(spy).not.toHaveBeenCalled();
  });

  // ── §12 組19/20 染色所依賴的【結構前提】(2026-08-25,codex 關卡2 之後補)────────────
  //
  // 🔴🔴 **為什麼這一格非有不可**:`globals.css` 那兩條標題列染色規則,**沒有逐字照稿寫**。
  //    稿:掛在收合元素上、`:has()` 往下看標題列裡的 h2、再選回標題列。
  //    我方:**直接掛在標題列上**(理由:那道掃描守門連【註解】裡都不准出現收合元素的標籤名)。
  //    ⇒ 兩者「今天選到同一組元素」,而**那是由現況撐住的**:
  //      **有人把 h2 從標題列裡搬出去、或在標題列與收合元素之間多包一層 ⇒ 兩者就不再等價,
  //      而那一天【不會有任何東西紅】。**
  //    📌 本 repo 記過這個形狀:**由現況撐住的約束,沒有聲音。** 這一格就是把它變成有聲的。
  //
  // ⚠️ **本格證得到 / 證不到**:證得到「結構前提成立」;**證不到** CSS 真的染上色
  //    (那要真瀏覽器,已量:destructive ⇒ 紅底、拿掉 ⇒ 翻黃底、收合仍可切換)。
  it('🔴🔴 標題列是收合元素的【直接子代】,而 h2 在標題列【裡面】—— 染色選擇器的等價性靠這兩件事', () => {
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;
    render(
      <DangerZoneDetails
        summary={
          <span>
            <h2 className='text-destructive'>申請取消整張單</h2>
          </span>
        }
      >
        <p>取消表單</p>
      </DangerZoneDetails>,
    );
    const details = screen.getByText('取消表單').closest('details') as HTMLDetailsElement;
    const summary = details.querySelector('summary');
    expect(summary, '收合元素底下找不到標題列').not.toBeNull();

    // ① 標題列必須是**直接子代** —— 中間多包一層,稿的 `> summary` 就不再命中,而我方的仍然命中。
    expect(summary!.parentElement, '標題列不再是收合元素的直接子代 ⇒ 兩個選擇器不再等價').toBe(
      details,
    );

    // ② h2 必須在標題列**裡面** —— 被搬出去的話,我方那條 `summary:has(h2…)` 會整個失配(靜靜地不染色)。
    const h2 = summary!.querySelector('h2');
    expect(h2, 'h2 不在標題列裡面 ⇒ 染色會靜靜地消失').not.toBeNull();
    expect(h2!.className, 'h2 的 destructive class 是染色的開關,不能改名').toContain(
      'text-destructive',
    );
  });

  it('prefers-reduced-motion ⇒ behavior 降成 auto(無障礙基本盤,不是效果)', () => {
    // jsdom 沒有 matchMedia ⇒ 只能塞,不能 spyOn。
    // 📌 而其餘四條**沒有**塞它 ⇒ 它們同時是「這支元件在無 matchMedia 環境不 throw」的對照。
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const { spy, details } = setup();
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    expect(spy.mock.calls[0]?.[0]).toMatchObject({ behavior: 'auto' });
  });
});
