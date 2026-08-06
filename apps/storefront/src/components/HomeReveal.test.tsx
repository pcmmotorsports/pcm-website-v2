// @vitest-environment jsdom
//
// HomeReveal — 捲動進場控制器(D5g)。
//
// 🔴 **這支守的核心不是「動畫好不好看」,是「動畫壞掉時內容還看不看得見」。**
//    起始隱藏狀態掛在 `body.js-reveal` 底下,所以只要這支元件在任何情況下**誤加**了
//    `js-reveal` 而 observer 沒接上,整頁五個區塊就會**永久隱形** —— 而三綠全過、
//    元件測試也全過(內容在 DOM 裡,只是 opacity:0)。那是本片最貴的失敗模式。
//
// ⚠️ 它擋不住什麼:jsdom 沒有真的 layout、`IntersectionObserver` 是我們自己塞的假貨
//    ⇒ 這支證不了「捲到那裡真的會觸發」,只證得了**接線與退場條件**。
//    真的有沒有動、幅度對不對,由 `styles/home.test.ts`(CSS 字面)與真瀏覽器負責。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { HomeReveal } from './HomeReveal';

type IOEntry = { target: Element; isIntersecting: boolean };

/** 可控的假 IntersectionObserver:記下被觀察的元素,並允許測試手動觸發回呼。 */
class FakeIO {
  static instances: FakeIO[] = [];
  observed: Element[] = [];
  unobserved: Element[] = [];
  disconnected = false;
  constructor(
    public cb: (entries: IOEntry[]) => void,
    public options?: IntersectionObserverInit,
  ) {
    FakeIO.instances.push(this);
  }
  /**
   * 🔴 **真的 IntersectionObserver 在 `observe()` 之後會送一次「初始回呼」**
   *    (isIntersecting 依當下是否相交,通常是 false),這裡必須照做 ——
   *    第一版的假物件**永遠不回呼**,而實作用「有沒有回呼過」判斷 observer 是不是活的
   *    ⇒ 假物件把「活著的 observer」演成「啞掉的 observer」,測出來的是不存在的情境。
   *    (fixture 不忠實 = 測到的東西跟真實行為對不上,這比沒測還危險。)
   */
  observe(el: Element) {
    this.observed.push(el);
    this.cb([{ target: el, isIntersecting: false }]);
  }
  unobserve(el: Element) { this.unobserved.push(el); }
  disconnect() { this.disconnected = true; }
  /** 讓某些元素「進入視窗」。 */
  fire(els: Element[]) { this.cb(els.map((target) => ({ target, isIntersecting: true }))); }
}

function setMatchMedia(reduced: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: reduced && q.includes('reduce'),
    media: q,
    addEventListener() {}, removeEventListener() {},
  }));
}

/** 造出五個目標:四個 `[data-reveal]` + 一個 `.ed-feature`。 */
function mountTargets(): HTMLElement[] {
  const mk = (cls: string, reveal: boolean) => {
    const el = document.createElement('section');
    el.className = cls;
    if (reveal) el.setAttribute('data-reveal', '');
    document.body.appendChild(el);
    return el;
  };
  return [
    mk('ed-select', true), mk('ed-cats', true),
    mk('ed-statement', true), mk('b-brands', true),
    mk('ed-feature', false),
  ];
}

beforeEach(() => {
  FakeIO.instances = [];
  document.body.className = '';
  document.body.innerHTML = '';
  vi.stubGlobal('IntersectionObserver', FakeIO);
  setMatchMedia(false);
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('HomeReveal · 接線', () => {
  it('五個目標都被觀察,且參數就是設計稿那組', () => {
    const targets = mountTargets();
    render(<HomeReveal />);
    vi.advanceTimersByTime(0);
    // 雙層 rAF:jsdom 的 rAF 走 timer,推兩幀
    vi.advanceTimersToNextTimer();
    vi.advanceTimersToNextTimer();

    expect(FakeIO.instances, 'observer 沒有被建立').toHaveLength(1);
    const io = FakeIO.instances[0]!;
    expect(io.observed, '被觀察的目標數不對(四個 data-reveal + N°05)').toHaveLength(targets.length);
    expect(io.options?.rootMargin).toBe('0px 0px -12% 0px');
    expect(io.options?.threshold).toBe(0.05);
  });

  it('進場後掛 is-in,而且**一次性**(unobserve 那一顆,不做來回抽動)', () => {
    const targets = mountTargets();
    render(<HomeReveal />);
    vi.advanceTimersToNextTimer();
    vi.advanceTimersToNextTimer();
    const io = FakeIO.instances[0]!;

    io.fire([targets[0]!]);
    expect(targets[0]!.classList.contains('is-in')).toBe(true);
    expect(io.unobserved, '進場後沒有 unobserve ⇒ 捲上去再下來會重播').toContain(targets[0]!);
    // 其餘四個不受影響(不是一次全開)
    expect(targets.slice(1).some((t) => t.classList.contains('is-in'))).toBe(false);
  });
});

describe('🔴 HomeReveal · 失效與退場(內容一定要看得見)', () => {
  // 🔴 這三條是本支的存在理由。任何一條紅 = 有使用者會看到一片空白。
  it('🔴 沒有 IntersectionObserver ⇒ **不加 js-reveal**(整頁維持全可見)', () => {
    mountTargets();
    vi.stubGlobal('IntersectionObserver', undefined);
    render(<HomeReveal />);
    vi.advanceTimersToNextTimer();
    expect(
      document.body.classList.contains('js-reveal'),
      '不支援 IO 卻還是把內容藏起來了 ⇒ 那些瀏覽器上首頁是一片空白',
    ).toBe(false);
  });

  it('🔴 使用者開了「減少動效」⇒ **不加 js-reveal**(位移是生理不適,不是喜好)', () => {
    mountTargets();
    setMatchMedia(true);
    render(<HomeReveal />);
    vi.advanceTimersToNextTimer();
    expect(document.body.classList.contains('js-reveal')).toBe(false);
    expect(FakeIO.instances, '開了減少動效還去建 observer').toHaveLength(0);
  });

  // 🔴 R1 找到的第四種永久隱形路徑:能力檢查過得了(`typeof` 是 function),
  //    但**建構子一呼叫就炸**(隱私瀏覽器 / 擴充套件把敏感 API stub 成這個形狀)。
  //    那時 `js-reveal` 已經掛上去了,而 2 秒保險寫在建構子之後、同一個 callback 裡
  //    ⇒ 保險那行連跑都跑不到 ⇒ 五個區塊永久 opacity:0,而當時 14 條測試全綠。
  it('🔴 IntersectionObserver 建構子拋錯 ⇒ 退回全可見(不得留下 js-reveal)', () => {
    mountTargets();
    vi.stubGlobal('IntersectionObserver', class { constructor() { throw new Error('blocked'); } });
    render(<HomeReveal />);
    vi.advanceTimersToNextTimer();
    vi.advanceTimersToNextTimer();
    expect(
      document.body.classList.contains('js-reveal'),
      '建構子炸了卻還留著 js-reveal ⇒ 首頁五個區塊永久隱形(而三綠全過)',
    ).toBe(false);
    // 再等過保險時間,確認不是靠保險救回來的(保險本來就沒被註冊)。
    vi.advanceTimersByTime(5000);
    expect(document.body.classList.contains('js-reveal')).toBe(false);
  });

  // 🔴 R2 找到的第五種永久隱形路徑:`targets` 是 mount 當下的**一次性快照**,
  //    mount 之後才進 DOM 的目標永遠不會被觀察、保險也早就過期 ⇒ 永久 opacity:0。
  //    修法 = CSS 只藏帶 `data-reveal-armed` 的元素,而那個屬性只有 JS 認領時才加。
  it('🔴 只有被 JS 認領的目標會被上膛(晚到的元素不會被藏死)', () => {
    const targets = mountTargets();
    render(<HomeReveal />);
    vi.advanceTimersToNextTimer();
    vi.advanceTimersToNextTimer();
    for (const t of targets) {
      expect(t.hasAttribute('data-reveal-armed'), '既有目標沒被上膛 ⇒ 起始隱藏不會生效').toBe(true);
    }
    // 之後才進 DOM 的那一個:沒有上膛屬性 ⇒ CSS 藏不到它,頂多沒有動畫
    const late = document.createElement('section');
    late.setAttribute('data-reveal', '');
    document.body.appendChild(late);
    expect(
      late.hasAttribute('data-reveal-armed'),
      '晚到的元素被上膛了 ⇒ 沒人會來掀它,永久隱形',
    ).toBe(false);
  });

  it('🔴 一個目標都找不到 ⇒ 不加 js-reveal(選擇器改名時不會把整頁藏死)', () => {
    // 刻意不建任何目標
    render(<HomeReveal />);
    vi.advanceTimersToNextTimer();
    expect(document.body.classList.contains('js-reveal')).toBe(false);
  });

  // 🔴🔴 **這條原本把 bug 寫成正確行為**(R2 must-fix)。舊版斷言「2 秒後一個都沒進場就全開」,
  //    而實測第一個目標 `.ed-select` 在桌機與手機**都在首屏之外** ⇒「沒人進場」是**正常狀態**,
  //    舊判準會在每一次正常首載的第 2 秒把五段一次全開 = 進場動畫等於沒做。
  //    正確判準:**observer 接上了就什麼都不做**,只有它根本沒接上才補救。
  it('🔴 observer 正常接上 ⇒ 保險到期時**什麼都不做**(首屏外的區塊要留給捲動去掀)', () => {
    const targets = mountTargets();
    render(<HomeReveal />);
    vi.advanceTimersToNextTimer();
    vi.advanceTimersToNextTimer();
    expect(FakeIO.instances, '前提:observer 真的接上了').toHaveLength(1);
    vi.advanceTimersByTime(5000);
    expect(
      targets.some((t) => t.classList.contains('is-in')),
      '保險把沒進場的區塊一次全開了 ⇒ 使用者停留超過 2 秒才滑,就永遠看不到進場動畫',
    ).toBe(false);
    expect(document.body.classList.contains('js-reveal')).toBe(true);
  });

  // 🔴 R3 找到的洞:**observer 建得起來 ≠ 它會把該掀的掀開**。
  //    我原本的判準是「`observer` 物件存在就取消保險」—— 那時只要 observer 因為任何原因
  //    永遠不回呼(目標在 `display:none` 的祖先底下、被移出 DOM、實作被閹割…),
  //    保險已經自廢、而沒有人會來掀 ⇒ **永久隱形**。
  //    改成「**回呼過**才取消保險」:真的 IO 在 observe 後必送初始回呼,所以正常情況照樣不誤觸發。
  it('🔴 observer 建得起來但**永遠不回呼** ⇒ 保險仍然要救(建得起來 ≠ 會動)', () => {
    const targets = mountTargets();
    // 建得起來、observe 收得下,但一次回呼都不送
    class SilentIO {
      constructor(public cb: unknown) {}
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', SilentIO);
    render(<HomeReveal />);
    vi.advanceTimersToNextTimer();
    vi.advanceTimersToNextTimer();
    vi.advanceTimersByTime(2000);
    expect(
      targets.every((t) => t.classList.contains('is-in')),
      'observer 啞掉了而保險以為它還活著 ⇒ 五個區塊永久隱形',
    ).toBe(true);
    expect(document.body.classList.contains('js-reveal')).toBe(false);
  });

  it('🔴 observer 根本沒接上(rAF 沒跑到)⇒ 保險把內容全開並卸下 js-reveal', () => {
    const targets = mountTargets();
    // 🔴 直接把 rAF 換成「只發號碼、永遠不回呼」—— jsdom 的 rAF 是用 timer 實作的,
    //    光靠不推進 timer 是模擬不出來的(`advanceTimersByTime` 會把 rAF 一起推)。
    //    這正是背景分頁的真實行為:R2 實測 hidden 分頁 `rafHidden=0`、`timerHidden=13`。
    let rafId = 0;
    vi.stubGlobal('requestAnimationFrame', () => ++rafId);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    render(<HomeReveal />);
    vi.advanceTimersByTime(2000);
    expect(FakeIO.instances, '前提:observer 確實沒接上').toHaveLength(0);
    expect(
      targets.every((t) => t.classList.contains('is-in')),
      'observer 沒接上而保險也沒補救 ⇒ 背景分頁載入的人切回來看到一片空白',
    ).toBe(true);
    expect(document.body.classList.contains('js-reveal')).toBe(false);
  });
});

describe('🔴 HomeReveal · 卸載(StrictMode dev 雙掛載會走這條)', () => {
  it('卸載時 disconnect observer、清掉保險、並拿掉 body 的 js-reveal', () => {
    mountTargets();
    const { unmount } = render(<HomeReveal />);
    vi.advanceTimersToNextTimer();
    vi.advanceTimersToNextTimer();
    expect(document.body.classList.contains('js-reveal')).toBe(true);
    const io = FakeIO.instances[0]!;

    unmount();
    expect(io.disconnected, 'observer 沒 disconnect ⇒ 洩漏').toBe(true);
    expect(
      document.body.classList.contains('js-reveal'),
      'body 還留著 js-reveal ⇒ 換頁後別的頁面上符合選擇器的元素會被藏住',
    ).toBe(false);
  });

  it('🔴 卸載後 rAF 才跑到 ⇒ **不得**再建 observer(StrictMode 第一次 mount 的殘影)', () => {
    mountTargets();
    const { unmount } = render(<HomeReveal />);
    // 還沒推進 rAF 就卸載 —— 這正是 StrictMode 的 mount→unmount→mount 形狀
    unmount();
    vi.advanceTimersToNextTimer();
    vi.advanceTimersToNextTimer();
    expect(
      FakeIO.instances,
      '卸載後仍建立了 observer ⇒ 沒人 disconnect 得到它,兩個 observer 會同時加 class',
    ).toHaveLength(0);
  });
});
