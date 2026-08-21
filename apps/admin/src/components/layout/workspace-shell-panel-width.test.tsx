// @vitest-environment jsdom
// workspace-shell-panel-width.test.tsx — 🔴 **面板寬度在【軟導航之後】才拿到 marker 的那條路。**
//
// 🔴🔴 **這支測試存在的理由 = 一個上線中的 bug,而既有守門一格都沒紅。**
//    `workspace-shell.test.ts` 有一格釘著「有 marker ⇒ 720、沒有 ⇒ defaultPanelWidth」——
//    它比對的是**原始碼字串**,所以那條規則寫在哪個 effect、相依是什麼、跑幾次,它都看不到。
//    ⇒ 舊版把判斷寫在相依 `[initialPanelWidth]` 的 effect 裡,而那個值從頭到尾不變
//      ⇒ **`querySelector` 只在掛載那一瞬間跑過一次。**
//    平行路由的槽在**軟導航**時換內容而 shell **不重新掛載** ⇒ marker 是在判斷做完【之後】才進 DOM。
//
//    **真瀏覽器實測(2026-08-22、真滑鼠點擊、視窗 1728;`-2e` 以不同工具獨立複現同一組數字):**
//      直接貼網址 `?panel=…` ⇒ 720 ✅   從訂單列表點一張單 ⇒ **864** ❌(= 視窗的一半)
//      視窗 1280 同樣點法    ⇒ **640** ❌ —— 比 720 還**窄**,**方向會翻面**
//    ⇒ 不是「固定錯成 864」,是**寬度跟著視窗跑、而拍板那個數字根本沒進入計算**。
//    ⇒ Sean 每天的動線就是「開列表 → 點單」⇒ **他從來沒拿到過自己拍的 720。**
//
// ⚠️ **本檔的效度邊界(不要放寬)**:jsdom 沒有版面引擎 ⇒ 它驗的是
//    「shell 有沒有把 `--workspace-panel-width` 這個變數改成 720」,**不是「畫面上真的 720px」**。
//    真正的像素要真瀏覽器。本檔擋的是**邏輯不再重算**這一件,而那正好是這次的病。

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { WorkspaceShell } from './workspace-shell';

/**
 * 🔴 **把 jsdom 的視窗設成 Sean 的實測值 1728**(主視窗 `osascript` 量到的 Chrome 視窗寬)。
 *
 * 不設的話 jsdom 預設 1024 ⇒ `maxPanelWidth(1024) = 1024 − 480 = 544`
 * ⇒ **720 在那個視窗本來就放不下,會被 `clampPanelWidth` 正確地夾成 544**。
 * 🔴 我第一版把 `720` 寫死在期望值裡,加上 N3 的夾之後三格同時紅 ——
 *    而**那三個紅是對的**:程式沒錯,是我的測試在一個「720 不成立」的視窗裡要求 720。
 * ⇒ 判別句:**期望值寫的是一個【數字】,還是一個【在這個環境下算得出來的規則】?**
 *    寫數字 ⇒ 換一個環境它就在說謊。
 *
 * 🔴🔴 **動這個 1728 會讓下面四格(`'720px'` 那四處)失去意義** —— 它是它們的隱藏前提:
 *    720 在 1728 底下拿得到,在 1024 底下拿不到。**改它之前先看那四格。**
 * 🔴🔴 **而它同時把 `clampPanelWidth` 那層夾變成【恆等函式】**
 *    (`maxPanelWidth(1728) = 1248 ≥ 720` ⇒ 夾不到任何東西)
 *    ⇒ 所以下面**另外開一格窄視窗**,那格是 N3 那層夾**唯一的判別力來源**。
 *    📌 這件事 `-4a` R2 抓到,而它是我自己造的:
 *       我把視窗從 1024 抬到 1728 是為了讓四格期望值變真(對的),
 *       **而同一個動作把夾從【有效】變成【恆等】(我沒看到)。**
 *       ⇒ 判別句(給修法用,不只給期望值用):
 *         **我為了讓它變綠而改的那個環境,會不會也把某個東西變成永遠不會紅?**
 */
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 1728, configurable: true, writable: true });
});

afterEach(cleanup);

const widthVar = (container: HTMLElement): string =>
  (container.querySelector('.workspace-row') as HTMLElement | null)?.style.getPropertyValue(
    '--workspace-panel-width',
  ) ?? '';

/**
 * 把面板內容塞進 `.workspace-panel` 槽 —— 模擬軟導航之後面板才到。
 * @param withMarker `true` = 訂單面板(帶 `.panel-width-locked`);`false` = **其他面板**。
 */
const landPanel = async (container: HTMLElement, withMarker: boolean): Promise<void> => {
  const slot = container.querySelector('.workspace-panel') as HTMLElement;
  await act(async () => {
    const inner = document.createElement('div');
    inner.className = withMarker ? 'panel-width-locked' : 'some-other-panel';
    slot.appendChild(inner);
    // MutationObserver 是微任務 ⇒ 讓它排空
    await Promise.resolve();
  });
};

describe('🔴 面板寬度:marker 在【掛載之後】才出現(= 從列表點一張單)', () => {
  it('前提 — 一開始沒有面板時,寬度是「視窗的一半」而不是 720', () => {
    const { container } = render(
      <WorkspaceShell initialPanelWidth={null} panel={null}>
        <div />
      </WorkspaceShell>,
    );
    // jsdom 預設 innerWidth = 1024 ⇒ 一半 = 512。**不寫死 512,從 window 算**,
    // 免得哪天 jsdom 換預設值,這一格變成一個看起來很篤定的假設。
    expect(widthVar(container)).toBe(`${Math.round(window.innerWidth * 0.5)}px`);
  });

  it('🔴 marker 後到 ⇒ 寬度【必須】重算成 720(舊版停在視窗的一半,這一格就是它)', async () => {
    const { container } = render(
      <WorkspaceShell initialPanelWidth={null} panel={null}>
        <div />
      </WorkspaceShell>,
    );
    const before = widthVar(container);
    await landPanel(container, true);
    const after = widthVar(container);
    // 🔴 兩個世界都要表演:before 不是 720、after 是 720。
    //    只驗 after ⇒ 分不出「重算了」與「它本來就一直是 720」。
    expect(before, '前提壞了:還沒有面板就已經是 720 ⇒ 下面那格恆綠').not.toBe('720px');
    expect(after, 'marker 進 DOM 之後寬度沒有重算 ⇒ 從列表點單的人永遠拿不到 720').toBe('720px');
  });

  /**
   * 🔴🔴 **這一格才是上面那格的判別力來源(主視窗 2026-08-22 指出,`-2e` 抓到)。**
   *    上面那格只證「訂單面板會拿到 720」——**而「把 720 寫死、根本不查 marker」也會通過它。**
   *    那種修法會把**所有其他面板**一起變成 720(它們本來該是視窗的一半),
   *    而 720 對它們也不是個荒謬的數字 ⇒ **畫面看起來完全正常 ⇒ 零回饋路徑。**
   *    ⇒ 本格餵一個**沒有 marker** 的面板,它必須**還是**視窗的一半。
   */
  it('🔴 負對照 — 沒有 marker 的面板後到 ⇒ 必須【還是】視窗的一半,不得變成 720', async () => {
    const { container } = render(
      <WorkspaceShell initialPanelWidth={null} panel={null}>
        <div />
      </WorkspaceShell>,
    );
    await landPanel(container, false);
    expect(
      widthVar(container),
      '沒有 marker 的面板也拿到 720 ⇒ 這是「把數字寫死」不是「查 marker」,上面那格沒有判別力',
    ).toBe(`${Math.round(window.innerWidth * 0.5)}px`);
  });

  /**
   * 🔴🔴 **回歸守門:使用者【在這個 session 裡】調過寬度之後,面板再動一下不得把它彈回 720。**
   *
   * 這一格擋的是**本片修法自己帶進來的洞**(`-4a` 審查 2026-08-22 R1 MF1):
   * `MutationObserver` 掛上去之後**活過整個 session**,而 `apply()` 是無條件 `setWidth`
   * ⇒ 使用者拖到 900 之後,面板裡**任何一次** DOM 變動(`subtree: true`)都會再跑一次 `apply()`
   * ⇒ **彈回 720**。舊版沒有這個洞(effect 只跑一次)⇒ **這是回歸,不是既有缺陷。**
   *
   * 🔴 **它彈回的是 720 —— 那個「看起來正確」的數字** ⇒ 讀起來像功能正常,不像 bug。
   * 🔴 **範圍是全後台**:`WorkspaceShell` 全 repo 只有一個消費者 = `app/layout.tsx:91`(根 layout)。
   *
   * ⚠️ **下面那一格(`initialPanelWidth={999}`)蓋不到這件事,而它的名字讀起來像有蓋到** ——
   *    `999` 不是 `null` ⇒ effect 第一行就 `return` ⇒ **觀察者根本沒掛上去**。
   *    ⇒ 那一格驗的是「重新整理」那條路,而那條路本來就沒風險。
   *    📌 **測試的名字說它擋 X,而它的 setup 讓 X 不可能發生。** 那不是寫錯,是**前提把述詞排除掉了**。
   */
  it('🔴🔴 回歸 — 這個 session 裡拖過寬度之後,面板再變動【不得】彈回 720', async () => {
    const { container } = render(
      <WorkspaceShell initialPanelWidth={null} panel={null}>
        <div />
      </WorkspaceShell>,
    );
    await landPanel(container, true);
    expect(widthVar(container), '前提壞了:marker 到了卻不是 720 ⇒ 下面測的不是這條路').toBe('720px');

    // 使用者主動調寬 —— 走的是 `commit()`/鍵盤步進那條真實路徑,不是直接改 state
    const handle = container.querySelector('[role="separator"]') as HTMLElement;
    await act(async () => {
      fireEvent.keyDown(handle, { key: 'ArrowLeft' });
      await Promise.resolve();
    });
    const afterUser = widthVar(container);
    expect(afterUser, '鍵盤步進沒有改變寬度 ⇒ 這一格失去前提,下面恆綠').not.toBe('720px');

    // 面板再動一下(換一張單 / 任何 re-render 都會這樣)
    await act(async () => {
      const slot = container.querySelector('.workspace-panel') as HTMLElement;
      slot.appendChild(document.createElement('span'));
      await Promise.resolve();
    });
    expect(
      widthVar(container),
      '使用者剛調好的寬度被觀察者蓋回 720 ⇒ 他每次面板一動就要重調一次,而 720 看起來很正常',
    ).toBe(afterUser);
  });

  /**
   * 🔴 上面那格用**鍵盤**調寬(走 `onKeyDown`),本格用**滑鼠拖曳**(走 `commit()`)——
   *    **兩條路各自標記、各自要驗。**
   * 📌 **為什麼分成兩格**:突變實測(2026-08-22)——
   *    拿掉鍵盤那個標記 ⇒ 上面那格紅 ✅;**拿掉 `commit()` 那個標記 ⇒ 全部 59 格皆綠** ❌
   *    ⇒ 少了本格,**滑鼠拖曳那條路(比較常用的那條)沒有任何守門**。
   * ⚠️ jsdom 沒有 Pointer Capture ⇒ 下面補上 `setPointerCapture`/`hasPointerCapture`,
   *    那是**環境的洞**不是產品的洞;補了才走得到 `commit()`,不補會死在第一行而看起來像「沒事」。
   */
  it('🔴🔴 回歸 — 用【滑鼠拖曳】調寬之後,面板再變動也【不得】彈回 720', async () => {
    const { container } = render(
      <WorkspaceShell initialPanelWidth={null} panel={null}>
        <div />
      </WorkspaceShell>,
    );
    await landPanel(container, true);
    expect(widthVar(container), '前提壞了:marker 到了卻不是 720').toBe('720px');

    const handle = container.querySelector('[role="separator"]') as HTMLElement;
    handle.setPointerCapture = () => undefined;
    handle.hasPointerCapture = () => false;
    await act(async () => {
      fireEvent.pointerDown(handle, { pointerId: 1 });
      // `commit(window.innerWidth - clientX)` ⇒ clientX 給 innerWidth-900 就是拖到 900
      window.dispatchEvent(
        new MouseEvent('pointermove', { clientX: window.innerWidth - 900 }) as PointerEvent,
      );
      window.dispatchEvent(new MouseEvent('pointerup') as PointerEvent);
      await Promise.resolve();
    });
    const afterDrag = widthVar(container);
    expect(afterDrag, '拖曳沒有改變寬度 ⇒ 本格失去前提、恆綠(先修這裡再看下面)').not.toBe('720px');

    await act(async () => {
      const slot = container.querySelector('.workspace-panel') as HTMLElement;
      slot.appendChild(document.createElement('span'));
      await Promise.resolve();
    });
    expect(
      widthVar(container),
      '拖曳調好的寬度被觀察者蓋回 720 ⇒ 每次面板一動就要重拖一次',
    ).toBe(afterDrag);
  });

  /**
   * 🔴🔴 **N3 那層 `clampPanelWidth` 的【唯一】判別力來源。**
   *
   * 上面所有格都在 `innerWidth = 1728` 底下跑,而 `maxPanelWidth(1728) = 1248 ≥ 720`
   * ⇒ **夾在那個環境裡是恆等函式**,把它整層拿掉,上面一格都不會紅(`-4a` R2 實測:0 格紅)。
   * ⇒ 本格把視窗壓到 **1000**:`maxPanelWidth(1000) = 1000 − 480 = 520`
   *   ⇒ 拍板值 720 **必須被夾成 520**。拿掉夾 ⇒ 本格立刻紅。
   *
   * 📌 而 520 不寫死成「某個數字」的理由同上:它是**在這個視窗下算得出來的規則**。
   *    這裡仍寫字面 520 是為了讓讀的人看得到那個結果,**而算式寫在旁邊、兩者必須對得起來**。
   */
  it('🔴 窄視窗(1000)⇒ 拍板的 720 必須被夾成 520 —— 這格是 N3 唯一會紅的地方', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true, writable: true });
    const { container } = render(
      <WorkspaceShell initialPanelWidth={null} panel={null}>
        <div />
      </WorkspaceShell>,
    );
    await landPanel(container, true);
    expect(
      widthVar(container),
      '720 沒有被夾 ⇒ state 存著一個畫面上不成立的值,而 aria-valuenow 讀的就是 state',
    ).toBe('520px');
  });

  /**
   * 🔴🔴 **這一格是上面那格的對照,而它的第一版是【恆真的】—— 我自己抓到的(R2 交件前自檢)。**
   *
   * 第一版我寫的是 `expect(Math.round(window.innerWidth * 0.5)).toBeLessThan(520)`
   * = `expect(500).toBeLessThan(520)` ⇒ **一句算術,完全沒有碰到元件。**
   * 它讀起來像對照組(還配了一行說明它為什麼不是重複),**而它在任何 code 之下都會綠。**
   * 📌 形狀:**我把「我相信的那個前提」寫成斷言,而不是把「元件會做什麼」寫成斷言。**
   *    前者一定成立(不然我不會相信它),後者才會紅。
   *
   * ⇒ 真的對照長這樣:**同一個窄視窗、同一條路,只差有沒有 marker。**
   *   有 marker ⇒ 720 被夾成 **520**(上面那格);沒有 marker ⇒ `defaultPanelWidth(1000)` = **500**。
   *   兩個值不同 ⇒ 上面那格量到的 520 **確實來自「720 被夾」**,不是來自別的路徑剛好也給 520。
   */
  it('🔴 對照 — 同一個窄視窗、沒有 marker ⇒ 走的是「視窗一半」那條路(500),不是被夾的 520', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true, writable: true });
    const { container } = render(
      <WorkspaceShell initialPanelWidth={null} panel={null}>
        <div />
      </WorkspaceShell>,
    );
    await landPanel(container, false);
    expect(
      widthVar(container),
      '沒有 marker 卻拿到 520 ⇒ 上面那格的 520 不一定來自「720 被夾」,那格失去判別力',
    ).toBe('500px');
  });

  it('🔴 使用者拖過(有 cookie 偏好)⇒ 即使 marker 後到也【不得】被改成 720', async () => {
    const { container } = render(
      <WorkspaceShell initialPanelWidth={999} panel={null}>
        <div />
      </WorkspaceShell>,
    );
    await landPanel(container, true);
    expect(
      widthVar(container),
      '偏好被預設值蓋掉了 ⇒ 使用者每次點單都要重拖一次',
    ).toBe('999px');
  });
});
