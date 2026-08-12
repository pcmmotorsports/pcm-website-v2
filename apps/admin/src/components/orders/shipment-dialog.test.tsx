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
const { submitShipment, fetchItemProcurementChoices, recordItemReceiptAction, undoItemReceiptAction } = vi.hoisted(() => ({
  submitShipment: vi.fn(),
  fetchItemProcurementChoices: vi.fn(),
  recordItemReceiptAction: vi.fn(),
  undoItemReceiptAction: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('../../lib/shipping/shipment-actions', () => ({ submitShipment }));
// 🔴 `undoItemReceiptAction` 也要給:`ReceiptRecordForm` 成功後會渲染 `ReceiptUndoBar`,
//    它 `useActionState` 吃那支。少給 = 整包 mock 抹掉具名匯出 ⇒ **Unhandled Error**
//    (詭異之處:每一格都綠、`vitest run` 卻 exit 1 ⇒ 只看「N passed」會漏掉)。
vi.mock('../../lib/orders/receipt-actions', () => ({
  fetchItemProcurementChoices,
  recordItemReceiptAction,
  undoItemReceiptAction,
}));

import { ShipmentDialog } from './shipment-dialog';
// 🔴 深引入是**刻意的**:這個類別沒有公開匯出口,而元件用的判定式是 `instanceof`
//    ⇒ 只有真的實例才餵得進那條分支。Next 若搬走它,這一格會**直接爆**(不是靜默轉綠)= 對的訊號。
import { UnrecognizedActionError } from 'next/dist/client/components/unrecognized-action-error';
import type { ShipmentCandidateItem } from '../../lib/shipping/shipment-candidates';

const CANDIDATES: ShipmentCandidateItem[] = [
  { orderId: 'ord-uuid-1', orderItemId: 'oi-1', orderDisplayId: 'PCM-0001', variantSku: 'S-Y10E9-HGEH', title: '鈦合金頭段', remaining: 2, blockedReason: null },
  { orderId: 'ord-uuid-2', orderItemId: 'oi-2', orderDisplayId: 'PCM-0002', variantSku: 'K-9921-BLK', title: '把手端子', remaining: 1, blockedReason: null },
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
    // 🔴 分流的另一半:斷線這條**不得**跑進換版文案(否則兩格會同時綠 = 零判別力)。
    expect(text, '斷線卻叫他重新整理 ⇒ 白白丟掉手上那把冪等鍵').not.toMatch(/重新整理/);
  });

  it('🔴🔴 **換版**(server action id 不存在)要叫他「重新整理」,不是「再按一次」', async () => {
    // 🔴 用**真的** `UnrecognizedActionError`,不是自己造一個 name 對的假物件:
    //    元件走的是 `unstable_isUnrecognizedActionError`(instanceof 判定),
    //    餵假物件的話這一格驗的是我自己的假設,不是 Next 真的怎麼判。
    submitShipment.mockRejectedValue(new UnrecognizedActionError('Server Action "abc" was not found on the server.'));
    open();
    fireEvent.click(screen.getByText('只建箱、先不出貨'));
    await waitFor(() => expect(document.body.textContent).toMatch(/重新整理/));
    const text = document.body.textContent ?? '';
    // 🔴 這是本片的**核心斷言**:換版下叫他再按一次 = 叫他做一件永遠不會成功的事
    //    (id 綁在已載入的 bundle 裡,再按送的是同一個 id)。
    expect(text, '換版卻叫他再按一次 ⇒ 按到天荒地老都是同一顆錯誤').not.toMatch(/再按一次/);
    expect(text, '沒講「這次什麼都沒送出去」⇒ 員工會怕重整之後多出一箱、卡在原地').toMatch(/什麼都沒有送出去/);
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

// ─────────────────────────────────────────────────────────────
// #351③(2026-08-10):半成品箱提示「保留但精簡」。
// 🔴 這段文案原本**一格測試都沒有** —— 整段刪掉、或把箱號拿掉,所有測試照樣全綠,
//    而員工失去的正是 Sean 08-09 逐字問的那個「箱子在哪裡」。精簡的前提是先有守門。
// ─────────────────────────────────────────────────────────────
describe('#351③ 半成品箱(建箱成功、後續失敗)的提示', () => {
  const halfDone = () => {
    submitShipment.mockResolvedValue({
      ok: false,
      message: '掛品項:有品項的出貨數量超過現有可出數量。',
      shipmentReference: 'K7X2MP',
      code: 'P2B27',
    });
  };

  it('🔴 箱號要顯示出來(Sean 逐字「我也找不到那個箱子在哪裡」的答案)', async () => {
    halfDone();
    open();
    fireEvent.click(screen.getByText('只建箱、先不出貨'));
    await waitFor(() => expect(screen.queryByText('K7X2MP')).not.toBeNull());
  });

  it('🔴 要講「再按一次不會重複建」(不講的話員工不敢按,半成品就永遠留著)', async () => {
    halfDone();
    open();
    fireEvent.click(screen.getByText('只建箱、先不出貨'));
    await waitFor(() => expect(screen.queryByText(/不會重複建/)).not.toBeNull());
  });

  // 🔴 2026-08-12:這條斷言**翻面**了(舊版是「**不得**出現訂單頁」)。
  //    ④(`5d891eb3` 的「未收尾的空箱」區)落地前,空箱在訂單頁結構上畫不出來
  //    ⇒ 指那裡 = 指一個找不到東西的地方;落地後不指,才是把答案藏起來。
  //    ⚠️ 翻面的前提是那一區真的存在:它由 `loadEmptyShipments` + `shipment-section.tsx` 供著,
  //    哪天那區被拿掉,這條會變成「文案指著一個不存在的區塊」而**照樣綠** —— 那是本檔看不到的面。
  it('🔴 要指出去哪裡作廢它(④ 已落地 ⇒ 空箱在訂單頁真的看得到了)', async () => {
    halfDone();
    open();
    fireEvent.click(screen.getByText('只建箱、先不出貨'));
    await waitFor(() => expect(screen.queryByText('K7X2MP')).not.toBeNull());
    expect(
      screen.queryByText(/未收尾的空箱/),
      '只講「要去作廢它」而不講在哪 ⇒ 員工又回到 Sean 08-09 逐字「我也找不到那個箱子在哪裡」。' +
        '這裡要的是 `shipment-section.tsx` 那一區的**字面**標題,不是隨便一句「去訂單頁」。',
    ).not.toBeNull();
  });

  it('🔴 講的是「這位客人任一張訂單頁」,不是含糊的「訂單頁」', async () => {
    halfDone();
    open();
    fireEvent.click(screen.getByText('只建箱、先不出貨'));
    await waitFor(() => expect(screen.queryByText('K7X2MP')).not.toBeNull());
    expect(
      screen.queryByText(/這位客人任一張訂單頁/),
      '空箱掛客人不掛訂單(shipments 沒有 order_id),而彈窗可能是從訂單列表勾多張單開的 ⇒ ' +
        '單講「訂單頁」員工不知道該回哪一張。',
    ).not.toBeNull();
  });

  // 🔴 文案叫他去訂單頁找,而**失敗路徑不會呼叫 `onDone`** ⇒ 頁面沒被重取、空箱區不會出現。
  //    這一格釘的是「關窗時要把『有建出箱』這件事告訴呼叫端」;真正去刷的是 launcher。
  //    ⚠️ 誠實邊界:launcher 那一端(`router.refresh()` 有沒有真的被叫)本檔測不到。
  it('🔴 半成品箱關窗時,要通知呼叫端「有建出箱」(否則頁面是舊的、文案指的那一區不會出現)', async () => {
    halfDone();
    const onClose = vi.fn();
    open({ onClose });
    fireEvent.click(screen.getByText('只建箱、先不出貨'));
    await waitFor(() => expect(screen.queryByText('K7X2MP')).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /關閉/ }));
    expect(
      onClose.mock.calls[0]?.[0],
      '半成品箱關窗卻回報「沒建出箱」⇒ 呼叫端不會重取,員工照文案回訂單頁看不到那個箱。',
    ).toBe(true);
  });

  it('沒建出箱就關窗時回報 false(白刷一次頁面是雜訊,不是安全的預設)', () => {
    const onClose = vi.fn();
    open({ onClose });
    fireEvent.click(screen.getByRole('button', { name: /關閉/ }));
    expect(onClose.mock.calls[0]?.[0]).toBe(false);
  });

  // 🔴 codex R1 nit4:上面那格只走「**沒送出**就關窗」⇒ 把判斷寫成 `result !== null` 也全綠。
  //    這格補的是「送出了、但**建箱那一步就失敗**(沒有箱號)」⇒ 沒有東西要去作廢,不該刷。
  it('送出失敗但**沒有**建出箱(建箱那步就被擋)⇒ 關窗回報 false', async () => {
    submitShipment.mockResolvedValue({
      ok: false,
      message: '這位客人不存在,無法建立包裹。',
      shipmentReference: null,
      code: '23503',
    });
    const onClose = vi.fn();
    open({ onClose });
    fireEvent.click(screen.getByText('只建箱、先不出貨'));
    await waitFor(() => expect(screen.queryByText(/這位客人不存在/)).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /關閉/ }));
    expect(onClose.mock.calls[0]?.[0]).toBe(false);
  });

  // 🔴🔴 codex R1 MF1:半成品箱之後**再按一次**、這次撞傳輸層 throw。
  //    `run()` 開頭 `setResult(null)`、`catch` 寫回的 result 帶 `shipmentReference: null`
  //    ⇒ 只看 `result` 的話會回報「沒建出箱」,而那個箱**是真的存在的**(員工正要去作廢它)。
  //    ⇒ 判準必須是「**曾經**建出過」。
  it('🔴🔴 半成品箱 → 再按一次撞斷線 → 關窗仍要回報 true(箱子沒有因為斷線而消失)', async () => {
    halfDone();
    const onClose = vi.fn();
    open({ onClose });
    fireEvent.click(screen.getByText('只建箱、先不出貨'));
    await waitFor(() => expect(screen.queryByText('K7X2MP')).not.toBeNull());

    // 第二次:傳輸層直接 throw(斷網 / 部署換版),彈窗手上的 result 被換掉、箱號不見了。
    submitShipment.mockRejectedValue(new Error('Failed to fetch'));
    fireEvent.click(screen.getByText('只建箱、先不出貨'));
    await waitFor(() => expect(screen.queryByText(/Failed to fetch/)).not.toBeNull());
    expect(screen.queryByText('K7X2MP'), '前提:這時畫面上已經沒有箱號了(result 被換掉)').toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /關閉/ }));
    expect(
      onClose.mock.calls[0]?.[0],
      '斷線把「已經建出一個箱」這件事抹掉了 ⇒ 不重取 ⇒ 員工回訂單頁找不到那個真的存在的箱。',
    ).toBe(true);
  });

  it('🔴🔴 半成品箱 → 再按一次撞**換版** ⇒ 不得說「不會多出一箱」(那時真的會)', async () => {
    // 🔴 R1 must-fix 1:換版本身確實零副作用,但**這個彈窗先前已經建出過一個箱**。
    //    叫他重整 = 丟掉冪等鍵;他照原樣再建一次就是第二箱。⇒ 兩種狀態要講不同的話。
    halfDone();
    open();
    fireEvent.click(screen.getByText('只建箱、先不出貨'));
    await waitFor(() => expect(screen.queryByText('K7X2MP')).not.toBeNull());

    submitShipment.mockRejectedValue(new UnrecognizedActionError('Server Action "abc" was not found on the server.'));
    fireEvent.click(screen.getByText('只建箱、先不出貨'));
    await waitFor(() => expect(document.body.textContent).toMatch(/重新整理/));
    const text = document.body.textContent ?? '';
    expect(text, '這時說「不會多出一箱」是假的 —— 前面那箱還在,重建就是第二箱').not.toMatch(/不會多出一箱/);
    // 🔴 R3 F1 之後文案改成 hedge 版(「可能已經建出箱子」)—— 因為判準從「確定建出過」
    //    放寬成「可能建出過」,同一句話要同時涵蓋半成品箱與斷線結果不明兩型。
    expect(text, '沒警告他先前已建出過箱 ⇒ 他重整後會原樣再建一次').toMatch(/可能已經建出箱子/);
  });

  it('🔴🔴 **先斷線一次、再撞換版** ⇒ 也不得說「不會多出一箱」(斷線那次可能已建成)', async () => {
    // 🔴 R3 F1(穿透 R1+R2 的那條):`everCreatedRef` 只在**拿到回傳**時才變 true,
    //    而斷線的定義就是沒拿到回傳 —— 那一次 server 可能已經 commit 了箱。
    //    只看 everCreatedRef 的話,這一格會讓「不會多出一箱」這句假話通過。
    submitShipment.mockRejectedValue(new Error('Failed to fetch'));
    open();
    fireEvent.click(screen.getByText('只建箱、先不出貨'));
    await waitFor(() => expect(document.body.textContent).toMatch(/再按一次/));

    submitShipment.mockRejectedValue(new UnrecognizedActionError('Server Action "abc" was not found on the server.'));
    fireEvent.click(screen.getByText('只建箱、先不出貨'));
    await waitFor(() => expect(document.body.textContent).toMatch(/重新整理/));
    const text = document.body.textContent ?? '';
    expect(text, '前一次斷線可能已經建出箱 ⇒ 這句是假話,而員工會照它重建成第二箱').not.toMatch(
      /不會多出一箱/,
    );
    expect(text, '沒警告他先前那次可能已經建成 ⇒ 他會原樣重建').toMatch(/可能已經建出箱子/);
  });

  it('成功時不出現半成品警告(那是只在失敗路徑才該講的話)', async () => {
    open();
    fireEvent.click(screen.getByText('只建箱、先不出貨'));
    await waitFor(() => expect(screen.queryByText(/已建立包裹/)).not.toBeNull());
    expect(screen.queryByText(/不會重複建/), '成功了還警告半成品 ⇒ 員工以為出事了').toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// #351②(2026-08-10):出不了的品項要**看得到、看得懂、按不動**。
// 🔴 為什麼放在這一檔而不是資料層:資料層只證得了 `blockedReason` 這個欄位算得對;
//    把畫面上那一行標籤刪掉、或把 `disabled` 拿掉,資料層測試照樣全綠 —— 而員工看到的就壞了。
//    (同「管線每一跳都要有自己的守門」那條:資料備妥 ≠ 畫面畫出來。)
// ─────────────────────────────────────────────────────────────
describe('#351② 出不了的品項:留在清單裡 + 標出原因 + 不可選', () => {
  const blocked = (reason: ShipmentCandidateItem['blockedReason']): ShipmentCandidateItem[] => [
    { orderId: 'ord-uuid-1', orderItemId: 'oi-9', orderDisplayId: 'PCM-0009', variantSku: 'X-0001', title: '還沒到的東西', remaining: 0, blockedReason: reason },
  ];

  // 🔴 標題不寫「整列消失就是 #351 的症狀」:整列消失發生在**資料層的 filter**,彈窗從來不過濾
  //    ⇒ 那句話在這一層恆真、零判別力。釘住「不濾掉」的是 `shipment-candidates.test.ts`。
  //    本格只驗彈窗**真的把傳進來的 blocked 品項畫出來**(有人加一道 `.filter` 進來就會紅)。
  it('🔴 傳進來的 blocked 品項會被畫出來(彈窗自己不得再濾一次)', () => {
    open({ candidates: blocked('not_arrived') });
    expect(
      screen.queryByText('還沒到的東西'),
      '彈窗自己把出不了的品項濾掉了 ⇒ 員工訂了東西卻在建箱彈窗裡找不到它。',
    ).not.toBeNull();
  });

  it('🔴 四個原因各自顯示自己的字,不是共用一句「未到貨」', () => {
    open({ candidates: blocked('not_arrived') });
    expect(screen.queryByText('未到貨'), 'not_arrived 沒顯示「未到貨」').not.toBeNull();
    cleanup();

    open({ candidates: blocked('all_boxed') });
    expect(
      screen.queryByText('已全數配箱'),
      '對「已全數配箱」的品項說「未到貨」是假話 —— 員工會跑去追採購,而東西其實在別的箱子裡。',
    ).not.toBeNull();
    expect(screen.queryByText('未到貨'), 'all_boxed 卻顯示「未到貨」').toBeNull();
    cleanup();

    open({ candidates: blocked('cancelled') });
    expect(
      screen.queryByText('已取消'),
      '對已取消的品項說「未到貨」= 叫員工去等一批永遠不會到的貨。',
    ).not.toBeNull();
    expect(screen.queryByText('未到貨'), 'cancelled 卻顯示「未到貨」').toBeNull();
    cleanup();

    open({ candidates: blocked('unknown') });
    expect(
      screen.queryByText('數量資料尚未就緒'),
      '數量讀不到/資料損壞時顯示成一個正常的數字或「未到貨」= 把「不知道」偽裝成事實。',
    ).not.toBeNull();
  });

  // 🔴 R2 nit:上面五格全是「單一品項、全 blocked」⇒「blocked 不進 payload、可出的數量正確」
  //    只被間接罩到。混合清單才是員工真正會看到的畫面。
  it('🔴 混合清單:只有出得了的那件進 payload,blocked 那件不進去', async () => {
    open({
      candidates: [
        { orderId: 'ord-uuid-1', orderItemId: 'oi-blocked', orderDisplayId: 'PCM-0009', variantSku: 'X-0001', title: '還沒到的東西', remaining: 0, blockedReason: 'not_arrived' },
        { orderId: 'ord-uuid-1', orderItemId: 'oi-ok', orderDisplayId: 'PCM-0001', variantSku: 'S-Y10E9-HGEH', title: '到了的東西', remaining: 2, blockedReason: null },
      ],
    });
    fireEvent.click(screen.getByText('只建箱、先不出貨'));
    await waitFor(() => expect(submitShipment).toHaveBeenCalled());
    expect(
      submitShipment.mock.calls[0]?.[0]?.items,
      'blocked 的品項混進 payload(或可出那件的數量不對)⇒ 掛品項會被 DB 整批退件,' +
        '員工看到的是「建箱成功但掛不上去」的半成品箱。',
    ).toEqual([{ orderItemId: 'oi-ok', quantity: 2 }]);
  });

  it('🔴 出不了的品項不顯示「還能出 0」(那是 #351 抱怨的那種看不懂的畫面)', () => {
    open({ candidates: blocked('not_arrived') });
    expect(screen.queryByText('還能出 0'), '顯示「還能出 0」⇒ 員工只知道不能出、不知道為什麼').toBeNull();
  });

  it('🔴 數量框被停用且維持 0(不預選;#351② 逐字「0 件品項不預選」)', () => {
    open({ candidates: blocked('not_arrived') });
    const box = screen.getByLabelText('還沒到的東西 要出的數量') as HTMLInputElement;
    expect(box.disabled, '數量框沒停用 ⇒ 員工打得進數字、按下去被 DB 退件').toBe(true);
    expect(box.value, '預選了數量 ⇒ 「0 件品項不預選」沒做到').toBe('0');
  });

  it('🔴 清單裡只有出不了的品項時,建箱鈕按下去不會送出(至少要選一件)', async () => {
    open({ candidates: blocked('not_arrived') });
    fireEvent.click(screen.getByText('只建箱、先不出貨'));
    expect(
      submitShipment,
      '整箱都是出不了的品項卻送得出去 ⇒ 建出一個空箱(#359 那個找不到的孤兒箱)。',
    ).not.toHaveBeenCalled();
  });
});

// ── #352-b-2 入口 2 + 驗收 23a ──────────────────────────────────────────
describe('ShipmentDialog — #352-b-2 入口 2「貨到了」', () => {
  const NOT_ARRIVED: ShipmentCandidateItem = {
    orderId: 'ord-uuid-1',
    orderItemId: 'oi-na',
    orderDisplayId: 'PCM-0009',
    variantSku: 'X-0001',
    title: '還沒到的東西',
    remaining: 0,
    blockedReason: 'not_arrived',
  };

  function open(items: ShipmentCandidateItem[], onRefresh = vi.fn()) {
    return {
      onRefresh,
      ...render(
        <ShipmentDialog
          candidates={items}
          recipient={{ name: '客', phone: '09', line: null }}
          idempotencyKey='key-1'
          onClose={noop}
          onDone={noop}
          onRefreshCandidates={onRefresh}
        />,
      ),
    };
  }

  // 🔴 只給 `not_arrived`:四個原因各代表完全不同的下一步,給 `all_boxed`/`cancelled`
  //    一顆「貨到了」是假話,還會把員工指去追一批不會來的貨。
  it('🔴 只有 not_arrived 那件有「貨到了」', () => {
    const { queryAllByText } = open([
      NOT_ARRIVED,
      { ...NOT_ARRIVED, orderItemId: 'oi-c', blockedReason: 'cancelled' },
      { ...NOT_ARRIVED, orderItemId: 'oi-b', blockedReason: 'all_boxed' },
      { ...NOT_ARRIVED, orderItemId: 'oi-u', blockedReason: 'unknown' },
    ]);
    expect(queryAllByText('貨到了')).toHaveLength(1);
  });

  it('可以出的品項不出現「貨到了」', () => {
    const { queryByText } = open([{ ...NOT_ARRIVED, remaining: 2, blockedReason: null }]);
    expect(queryByText('貨到了')).toBeNull();
  });

  it('按下去 → 先顯示讀取中,再列出採購列', async () => {
    let resolve: (v: unknown) => void = () => {};
    fetchItemProcurementChoices.mockReturnValue(new Promise((r) => (resolve = r)));
    const { getByText, findByText } = open([NOT_ARRIVED]);
    fireEvent.click(getByText('貨到了'));
    expect(await findByText(/正在讀取/)).toBeTruthy();
    resolve([
      { procurementId: 'p-1', supplierLabel: 'RPM', allocatedQuantity: 3, receivedQuantity: 1 },
    ]);
    expect(await findByText(/RPM/)).toBeTruthy();
  });

  // 🔴 `null` = 被拒或查詢失敗,**不是**「這件沒有採購列」——文案必須分開,
  //    因為員工的下一步完全不同(重試/找工程 vs 去採購區塊建一筆)。
  it('🔴 抓失敗 → 文案寫「怎麼辦」,而且不能長得像「沒有採購列」', async () => {
    fetchItemProcurementChoices.mockResolvedValue(null);
    const { getByText, findByRole } = open([NOT_ARRIVED]);
    fireEvent.click(getByText('貨到了'));
    const alert = await findByRole('alert');
    expect(alert.textContent).toContain('重新整理');
    expect(alert.textContent).toContain('先不要出');
  });

  it('真的沒有採購列 → 指去採購區塊補來源(與抓失敗分開的文案)', async () => {
    fetchItemProcurementChoices.mockResolvedValue([]);
    const { getByText, findByText } = open([NOT_ARRIVED]);
    fireEvent.click(getByText('貨到了'));
    expect(await findByText(/還沒有任何採購紀錄/)).toBeTruthy();
  });

  // 🔴🔴 驗收 23a:登錄成功後**不重整**就要就地更新 ⇒ 這格釘住彈窗真的去重取了。
  //    沒有它的話,`onRefreshCandidates` 整條拿掉也全綠,而症狀是「按完沒反應、要重整才看得到」。
  it('🔴 登錄成功 → 彈窗就地重取候選(驗收 23a)', async () => {
    fetchItemProcurementChoices.mockResolvedValue([
      { procurementId: 'p-1', supplierLabel: 'RPM', allocatedQuantity: 3, receivedQuantity: 1 },
    ]);
    recordItemReceiptAction.mockResolvedValue({
      status: 'recorded_inline',
      outcome: 'recorded',
      procurementId: 'p-1',
    });
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { getByText, container } = open([NOT_ARRIVED], onRefresh);
    fireEvent.click(getByText('貨到了'));
    await waitFor(() => expect(container.querySelector('input[name="request_id"]')).toBeTruthy());
    await waitFor(() =>
      expect(
        (container.querySelector('input[name="request_id"]') as HTMLInputElement).value,
      ).not.toBe(''),
    );
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  });
});

// ── R2 N2:員工刻意填 0 的品項,重取後不得被靜默補回滿量 ────────────────
describe('ShipmentDialog — 手動填 0 不被自動補回(N2)', () => {
  const ITEM: ShipmentCandidateItem = {
    orderId: 'ord-uuid-1',
    orderItemId: 'oi-1',
    orderDisplayId: 'PCM-0001',
    variantSku: 'S-1',
    title: '甲',
    remaining: 2,
    blockedReason: null,
  };

  function view(items: ShipmentCandidateItem[]) {
    return render(
      <ShipmentDialog
        candidates={items}
        recipient={{ name: '客', phone: '09', line: null }}
        idempotencyKey='k'
        onClose={noop}
        onDone={noop}
        onRefreshCandidates={async () => {}}
      />,
    );
  }

  // 🔴🔴 拿掉 `touchedRef` 那道跳過(V2 突變)⇒ 這格必紅。
  //    失效症狀是**靜默的**:員工把某件改成 0(這箱不出這件),重取後被補回滿量,
  //    他不重看一眼就把不該出的東西裝進箱子。
  //    ⇒ 判準必須是「**員工碰過沒有**」,不是「值是不是 0」——0 是合法且有意義的輸入。
  it('🔴 員工把數量改成 0,重取之後仍然是 0(不是被當成「沒填」補回滿量)', () => {
    const { container, rerender } = view([ITEM]);
    const box = () =>
      container.querySelector('input[aria-label="甲 要出的數量"]') as HTMLInputElement;
    expect(box().value).toBe('2');

    fireEvent.change(box(), { target: { value: '0' } });
    expect(box().value).toBe('0');

    // 23a 重取:換一份**新的** candidates 陣列(身分變了、內容相同)⇒ 補量的 effect 會跑。
    rerender(
      <ShipmentDialog
        candidates={[{ ...ITEM }]}
        recipient={{ name: '客', phone: '09', line: null }}
        idempotencyKey='k'
        onClose={noop}
        onDone={noop}
        onRefreshCandidates={async () => {}}
      />,
    );

    expect(box().value, '員工刻意填的 0 被當成「沒填」而補回滿量了').toBe('0');
  });

  // 正向對照:**沒被碰過**的品項由 0 變可出時,該補還是要補(否則 M1 就沒做事)。
  it('沒碰過的品項:remaining 由 0 變 2 → 自動補上(M1 仍然有效)', () => {
    const blocked: ShipmentCandidateItem = { ...ITEM, remaining: 0, blockedReason: 'not_arrived' };
    const { container, rerender } = view([blocked]);
    const box = () =>
      container.querySelector('input[aria-label="甲 要出的數量"]') as HTMLInputElement;
    expect(box().value).toBe('0');

    rerender(
      <ShipmentDialog
        candidates={[{ ...ITEM, remaining: 2, blockedReason: null }]}
        recipient={{ name: '客', phone: '09', line: null }}
        idempotencyKey='k'
        onClose={noop}
        onDone={noop}
        onRefreshCandidates={async () => {}}
      />,
    );
    expect(box().value).toBe('2');
  });
});
