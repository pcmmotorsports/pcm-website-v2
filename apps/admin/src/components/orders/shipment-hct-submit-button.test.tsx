// @vitest-environment jsdom
// shipment-hct-submit-button.test.tsx — ⟦ship-HCTAPI⟧ 步驟②
//
// 🔴 **本檔最重要的一格是那個【負對照】**:開關關著時,鈕**必須仍然在畫面上**。
//    plan 逐字:消失時「還沒開通」/「這張單不能送」/「我沒權限」印同一個畫面。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const submitShipmentToHctAction = vi.fn();
// 🔵 ⟦ship-SHIPFILESSPLIT⟧:mock 的路徑要跟著搬 —— 🛑 **而這一格是這次最危險的一格**:
//    `vi.mock` 一個【不存在的路徑】不會報錯, 它只是**什麼都沒 mock**
//    ⇒ 真正的 action 會被叫到 ⇒ 那是一個對外送單的 server action。
//    ⇒ 📌 路徑寫錯時, 這幾格**不會紅在「mock 沒生效」上**, 它們會紅在別的地方或乾脆不紅。
vi.mock('../../lib/shipping/shipment-submit-hct-action', () => ({ submitShipmentToHctAction }));

const { ShipmentHctSubmitButton } = await import('./shipment-hct-submit-button');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// 🔵 `shipped` 預設 true = 走查當下的那個世界(箱子已標出貨, 而那顆「送新竹」還亮著)。
//    🔴 **它只換那句說明的前半, 不換鈕的任何行為** —— 下面每一格的期望值因此一個都沒動。
// 🔵 2026-09-16:`hctStatus` 是第二個參數 —— 它**只**決定要不要多印「還沒叫車」那一句,
//    鈕的行為一格都不看它。預設 `draft` = 還沒跟新竹要過號碼(既有每一格的世界)。
const mount = (shipped = true, hctStatus = 'draft') =>
  render(
    <ShipmentHctSubmitButton
      shipmentId='s1'
      shipmentReference='BCDFGH'
      shipped={shipped}
      hctStatus={hctStatus}
    />,
  );

describe('說明句(2026-09-09 Sean 拍甲:只加說明, 不動鈕)', () => {
  // 🔴🔴 **2026-09-16:這兩格的期望值換了, 而換的理由不是實作改了 —— 是【原本那句話是錯的】。**
  //    舊字面逐字「要真的叫新竹來收貨才按這顆」⇒ **這顆鈕不是叫車**, 它走 `submitTransData`,
  //    做的是跟新竹要一個託運單號;真的叫車是出貨清單頁那顆(`dispatchOrder`)。
  //    🔬 Sean 2026-09-16 真後台按完這顆之後 `hct_request_id`=8947081975 而 `hct_dispatched_at` 仍 NULL
  //       ⇒ 他以為出貨走完了, 而車根本還沒叫。
  //    ⚠️ 舊字面是 Sean 2026-09-09 親自選的 —— **而他當時是在同一個誤解下選的**;
  //       主視窗 2026-09-16 已知並拍板改字。舊字逐字留在這段註解裡, 讓「為什麼曾經那樣寫」有得查。
  it('已標出貨的箱:講「已標出貨」, 而且講的是【要號碼】不是【叫車】', () => {
    mount();
    expect(screen.getByText(/已標出貨。/)).toBeTruthy();
    expect(screen.getByText(/按了會跟新竹要一個託運單號/)).toBeTruthy();
    // 🔴 負對照:不准再出現那句把它講成叫車的舊話。
    expect(screen.queryByText(/要真的叫新竹來收貨才按這顆/)).toBe(null);
  });

  it('🔴 取消那件要講清楚:不是「無法取消」, 是「系統不能幫你取消」(你還可以打電話)', () => {
    mount();
    // 🔵 新竹【有】取消介面(`TransDataCancel_Json`), 只是我們沒接 ⇒ 話寫太滿他就不會打那通電話。
    expect(screen.getByText(/系統目前不能幫你取消/)).toBeTruthy();
    expect(screen.queryByText(/無法取消/)).toBe(null);
  });

  it('🔴🔴 已經要到號碼(submitted)⇒ 要告訴他【還沒叫車】—— 那是他缺的下一步', () => {
    mount(true, 'submitted');
    // 🔴 **要帶路徑** —— 2026-09-16 實證:在被明確告知「叫車在出貨清單頁」之後,
    //    Sean 還是回到訂單頁按那顆鈕 ⇒ 他缺的不是「知道有那一頁」, 是**知道它在哪**。
    expect(screen.getByText(/左邊選單的「出貨清單」/)).toBeTruthy();
    expect(screen.getByText(/在那之前貨還在店裡/)).toBeTruthy();
  });

  it('🟢 負對照:還沒要到號碼(draft)⇒ **不印**那一句(與當下無關的提醒會被學會忽略)', () => {
    mount(true, 'draft');
    expect(screen.queryByText(/還沒叫車/)).toBe(null);
  });

  // 🔴 負對照:`decideSubmit`(`hct-submit-flow.ts:48`)只吃 hct_status 四態、不看出貨與否
  //    ⇒ 沒標出貨的箱一樣送得出去 ⇒ 對它印「已標出貨」就是**用一句安慰的話蓋掉他該看見的狀態**。
  it('🔴 沒標出貨的箱:不准說「已標出貨」', () => {
    mount(false);
    expect(screen.getByText(/這一箱還沒標出貨。/)).toBeTruthy();
    expect(screen.queryByText(/已標出貨。/)).toBe(null);
  });
});

describe('三態', () => {
  it('預設:鈕在、可以按', () => {
    mount();
    const b = screen.getByRole('button', { name: /跟新竹要託運單號 BCDFGH/ });
    expect(b).toBeTruthy();
    expect((b as HTMLButtonElement).disabled).toBe(false);
  });

  it('🔴 負對照:server 回 disabled ⇒ 鈕【仍然在畫面上】, 而且旁邊寫著那句話', async () => {
    submitShipmentToHctAction.mockResolvedValue({
      ok: false,
      kind: 'disabled',
      message: '新竹未開通(缺 HCT_API_ENDPOINT …)',
    });
    mount();
    const b = screen.getByRole('button', { name: /跟新竹要託運單號/ });
    b.click();
    // 🔵 nit① 之後這裡印的是 **server 給的那句**(含「缺哪一顆 env」), 不是寫死的四個字
    //    ⇒ 逐字比對會紅, 而**它紅得對**:那正是這次改動的內容。
    await vi.waitFor(() => expect(screen.getByText(/新竹未開通/)).toBeTruthy());
    // 🔴 而「缺哪一顆」必須真的出現 —— 否則 nit① 等於沒修
    //    (兩種完全不同的原因印同一句話)。
    expect(screen.getByText(/HCT_API_ENDPOINT/)).toBeTruthy();
    // 🔴 這一行是本檔的重點:它證的是「鈕沒有消失」。
    expect(screen.getByRole('button', { name: /跟新竹要託運單號/ })).toBeTruthy();
    // disabled 不鎖 —— Sean 放了 env 之後不必重整頁面。
    expect((screen.getByRole('button', { name: /跟新竹要託運單號/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('unknown ⇒ 鎖住不給再按, 而且畫面逐字有「不要重按」', async () => {
    submitShipmentToHctAction.mockResolvedValue({
      ok: false,
      kind: 'unknown',
      message: '送出去了而不知道結果 —— 不要重按,請用查詢補問新竹貨號',
    });
    mount();
    screen.getByRole('button', { name: /跟新竹要託運單號/ }).click();
    await vi.waitFor(() =>
      expect(screen.getByText(/不要重按/)).toBeTruthy(),
    );
    expect((screen.getByRole('button', { name: /跟新竹要託運單號/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('needs_confirm ⇒ 不鎖, 文字換成「知道了, 還是要送」, 第二次帶 confirmTruncated', async () => {
    submitShipmentToHctAction.mockResolvedValue({
      ok: false,
      kind: 'needs_confirm',
      message: '這幾欄超長、送出去會被截掉:ercsig —— 看過再按一次就送',
      truncated: ['ercsig'],
      confirmToken: 'ercsig',
    });
    mount();
    screen.getByRole('button', { name: /跟新竹要託運單號/ }).click();
    await vi.waitFor(() => expect(screen.getByText(/會被截掉/)).toBeTruthy());
    const b2 = screen.getByRole('button', { name: /跟新竹要託運單號/ });
    expect((b2 as HTMLButtonElement).disabled).toBe(false);
    expect(b2.textContent).toContain('還是要送');
    b2.click();
    // 🔴 第二次必須帶 confirmTruncated —— 少了它, 員工按第二次還是送不出去(死循環)。
    await vi.waitFor(() =>
      // 🔴 第二次要把 **server 給的那個 token** 原樣帶回去 —— 不是一個寫死的 true。
      //    codex:`true` 是一張空白支票, 它證明不了員工看過【這一次】的內容。
      expect(submitShipmentToHctAction).toHaveBeenLastCalledWith({
        shipmentId: 's1',
        confirmTruncated: 'ercsig',
      }),
    );
  });

  it('failed ⇒ 不鎖(新竹回失敗是可以重試的那一種)', async () => {
    submitShipmentToHctAction.mockResolvedValue({
      ok: false,
      kind: 'failed',
      message: '新竹回了失敗 —— 可以再按一次',
    });
    mount();
    screen.getByRole('button', { name: /跟新竹要託運單號/ }).click();
    await vi.waitFor(() => expect(screen.getByText(/可以再按一次/)).toBeTruthy());
    expect((screen.getByRole('button', { name: /跟新竹要託運單號/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('submitted ⇒ 顯示貨號並鎖住', async () => {
    submitShipmentToHctAction.mockResolvedValue({ ok: true, kind: 'submitted', requestId: 'R1' });
    mount();
    screen.getByRole('button', { name: /跟新竹要託運單號/ }).click();
    await vi.waitFor(() => expect(screen.getByText(/已送出 R1/)).toBeTruthy());
    expect((screen.getByRole('button', { name: /跟新竹要託運單號/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
