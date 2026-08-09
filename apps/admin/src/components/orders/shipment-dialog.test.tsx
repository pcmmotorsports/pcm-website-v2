// @vitest-environment jsdom
// shipment-dialog.test.tsx — 建箱彈窗的**行為**守門(2026-08-09,codex R1 打回來之後補)。
//
// 🔴 **為什麼非要有這一檔**:料號與客人身分原本只有「資料層」的測試 ——
//    DTO 裡有 `variantSku` 全綠、`SubmitShipmentInput` 沒有 `customerUserId` 全綠。
//    但**把彈窗裡的 `{c.variantSku}` 整行刪掉,那些測試照樣全綠**,而 Sean 要的那一欄消失了。
//    ⇒ 「資料備妥」與「畫面畫出來」是兩件事,各要有自己的守門(管線每一跳都要有人守)。
//
// ⚠️ **它擋不住什麼**:jsdom 不是真瀏覽器 —— 量不到 truncate 之後料號實際看不看得見,
//    也證不了送出中那顆 ✕ 在觸控裝置上真的按不下去。這裡守的是 DOM 層的事實。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// 🔴 `vi.hoisted`:`vi.mock` 的工廠會被提升到檔頭,直接引用上面宣告的變數會炸
//    (`Cannot access 'submitShipment' before initialization`)。
const { submitShipment } = vi.hoisted(() => ({ submitShipment: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('../../lib/shipping/shipment-actions', () => ({ submitShipment }));

import { ShipmentDialog } from './shipment-dialog';

const CANDIDATES = [
  { orderItemId: 'oi-1', orderDisplayId: 'PCM-0001', variantSku: 'S-Y10E9-HGEH', title: '鈦合金頭段', remaining: 2 },
  { orderItemId: 'oi-2', orderDisplayId: 'PCM-0002', variantSku: 'K-9921-BLK', title: '把手端子', remaining: 1 },
];

const noop = () => {};

function open(over: Partial<Parameters<typeof ShipmentDialog>[0]> = {}) {
  return render(
    <ShipmentDialog
      candidates={CANDIDATES}
      recipient={{ name: '陳彥廷', phone: '0912345678', line: '台北市…' }}
      idempotencyKey='KEY-1'
      onClose={noop}
      onDone={noop}
      {...over}
    />,
  );
}

// 🔴 大括號、不要用省略 return 的箭頭:`mockResolvedValue()` 會把 mock 本身回傳出去,
//    而 vitest 會去 await hook 的回傳值。
beforeEach(() => {
  submitShipment.mockReset();
  submitShipment.mockResolvedValue({ ok: true, shipmentReference: 'K7X2MP', shipped: false });
});
afterEach(cleanup);

describe('🔴 每一列三件都在:訂單編號 + 商品名稱 + 料號(Sean 2026-08-09 實測後逐字要的)', () => {
  it('兩列各自的料號都真的畫在畫面上', () => {
    open();
    for (const c of CANDIDATES) {
      expect(
        screen.queryByText(c.variantSku),
        `料號 ${c.variantSku} 沒有出現在彈窗裡 ⇒ 員工對不到實物上的標籤。` +
          'DTO 有這個欄位不代表畫面畫得出來 —— 這正是本檔存在的理由。',
      ).not.toBeNull();
    }
  });

  it('料號與單號、品名是三個各自獨立的節點(不是同一段字被拆開看)', () => {
    open();
    const sku = screen.getByText('S-Y10E9-HGEH');
    expect(sku.textContent, '料號節點裡混進了別的欄位').toBe('S-Y10E9-HGEH');
    expect(screen.getByText('PCM-0001').textContent).toBe('PCM-0001');
    expect(screen.getByText('鈦合金頭段').textContent).toBe('鈦合金頭段');
  });
});

describe('🔴🔴 送出中不給關窗(關掉再開 = 新的冪等鍵 = 同一批貨建成兩箱)', () => {
  it('送出前 ✕ 可用;送出中 ✕ 變成 disabled', async () => {
    // 讓 action 卡住不回,模擬「飛在半空中」的那一段。
    // 🔴 用物件的欄位而不是 `let` —— TS 看不到 executor 會同步跑,會把區域變數窄化成 `null`。
    const flight = { release: () => {} };
    submitShipment.mockImplementation(
      () =>
        new Promise((r) => {
          flight.release = () => r({ ok: true, shipmentReference: 'K7X2MP', shipped: false });
        }),
    );
    open();
    const close = () => screen.getByRole('button', { name: /關閉|送出中/ }) as HTMLButtonElement;
    expect(close().disabled, '還沒送出就把 ✕ 鎖住了 ⇒ 員工關不掉這個彈窗').toBe(false);

    fireEvent.click(screen.getByText('只建箱、先不出貨'));
    await waitFor(() =>
      expect(
        close().disabled,
        '送出中還能關窗 ⇒ 關掉再開會生成**新的**冪等鍵,同一批貨真的被建成兩箱,' +
          '而且飛在半空那次回來後還會呼叫 onDone、把新開的彈窗關掉。',
      ).toBe(true),
    );

    flight.release();
    await waitFor(() => expect(close().disabled).toBe(false));
  });

  it('🔴🔴 送出「丟出例外」時 ✕ 必須解鎖 —— 否則員工被鎖在關不掉的彈窗裡', async () => {
    // 🔴 server action 自己內部的錯誤會回 `{ok:false}`;**傳輸層**失敗(斷網、部署換版)是直接 throw。
    //    這條擋的是 `setBusy(false)` 沒放在 `finally` 的那個版本 —— 那正是加上
    //    `disabled={busy}` 之後親手做出來的回歸(codex R2)。
    submitShipment.mockRejectedValue(new Error('Failed to fetch'));
    open();
    fireEvent.click(screen.getByText('只建箱、先不出貨'));
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: /關閉|送出中/ }) as HTMLButtonElement).disabled,
        'busy 卡在 true ⇒ ✕ 永遠 disabled ⇒ 只能重整頁面才逃得掉。',
      ).toBe(false),
    );
    expect(document.body.textContent).toContain('Failed to fetch');
  });

  it('🔴🔴 斷線後的指引是「再按一次」,而且**明講不要關窗**(關窗 = 換一把鍵 = 真的多一箱)', async () => {
    submitShipment.mockRejectedValue(new Error('Failed to fetch'));
    open();
    fireEvent.click(screen.getByText('只建箱、先不出貨'));
    await waitFor(() => expect(document.body.textContent).toContain('Failed to fetch'));
    const text = document.body.textContent ?? '';
    expect(text, '沒有叫他再按一次 ⇒ 員工會自己想辦法,最順手的就是關掉重來').toMatch(/再按一次/);
    expect(text, '沒有明講不要關窗 ⇒ 關掉就丟了冪等鍵,下次開窗是新鍵、真的建出第二箱').toMatch(/不要關掉/);
    // 🔴 反面同樣要釘:不得叫他「去出貨卡看箱子在不在」——
    //    `createShipment` 成功、掛品項前斷線留下的是**空箱**,而出貨卡是由品項反查箱畫出來的
    //    (`loadOrderShipments`)⇒ 空箱在那張卡上看不到,那個指引找不到東西。
    expect(text, '又叫員工去出貨卡找箱子了 ⇒ 空箱在那張卡上不會顯示').not.toMatch(/出貨卡/);
  });

  it('🔴🔴 斷線後**同一個彈窗**再送一次,用的還是同一把鍵(這才是復原路徑本身)', async () => {
    submitShipment.mockRejectedValueOnce(new Error('Failed to fetch'));
    open({ idempotencyKey: 'KEY-STAYS' });
    fireEvent.click(screen.getByText('只建箱、先不出貨'));
    await waitFor(() => expect(document.body.textContent).toContain('Failed to fetch'));

    // 第二次:mock 的預設回應(成功)。
    fireEvent.click(screen.getByText('只建箱、先不出貨'));
    await waitFor(() => expect(submitShipment).toHaveBeenCalledTimes(2));
    const keys = submitShipment.mock.calls.map((c) => c[0]?.idempotencyKey);
    expect(
      new Set(keys).size,
      `兩次送出用了不同的鍵(${JSON.stringify(keys)})⇒ 第一次可能已經建出箱子,` +
        '第二次用新鍵會**再建一箱**,而兩次都回報成功。',
    ).toBe(1);
    expect(keys[1]).toBe('KEY-STAYS');
  });

  it('前提 — 這顆真的是關閉鈕(不是隨便抓到一顆剛好 disabled 的鈕)', () => {
    const onClose = vi.fn();
    open({ onClose });
    fireEvent.click(screen.getByRole('button', { name: '關閉' }));
    expect(onClose, '按下去沒有觸發 onClose ⇒ 上面那條測的可能是別顆鈕').toHaveBeenCalledTimes(1);
  });
});

describe('冪等鍵原樣送出(重試沿用同一把的前提)', () => {
  it('送出時帶的是呼叫端給的那把鍵,不是彈窗自己生的', async () => {
    open({ idempotencyKey: 'KEY-FROM-CALLER' });
    fireEvent.click(screen.getByText('只建箱、先不出貨'));
    await waitFor(() => expect(submitShipment).toHaveBeenCalled());
    expect(
      submitShipment.mock.calls[0]?.[0]?.idempotencyKey,
      '彈窗送出了別把鍵 ⇒ 重試不再是同一把,冪等層失效而且零症狀。',
    ).toBe('KEY-FROM-CALLER');
  });

  it('🔴 送出的 payload 不含 customerUserId(客人由 server 反查,client 沒有這個欄位)', async () => {
    open();
    fireEvent.click(screen.getByText('只建箱、先不出貨'));
    await waitFor(() => expect(submitShipment).toHaveBeenCalled());
    expect(
      Object.keys(submitShipment.mock.calls[0]?.[0] ?? {}),
      '彈窗又把客人 id 送出去了 ⇒ 那等於「箱子掛誰」的來源回到瀏覽器手上。',
    ).not.toContain('customerUserId');
  });
});
