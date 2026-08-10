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
import type { ShipmentCandidateItem } from '../../lib/shipping/shipment-candidates';

const CANDIDATES: ShipmentCandidateItem[] = [
  { orderItemId: 'oi-1', orderDisplayId: 'PCM-0001', variantSku: 'S-Y10E9-HGEH', title: '鈦合金頭段', remaining: 2, blockedReason: null },
  { orderItemId: 'oi-2', orderDisplayId: 'PCM-0002', variantSku: 'K-9921-BLK', title: '把手端子', remaining: 1, blockedReason: null },
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

  it('🔴 **不得**叫員工去「訂單頁」找這個箱(空箱在那裡看不到 —— #351④ 未修)', async () => {
    halfDone();
    open();
    fireEvent.click(screen.getByText('只建箱、先不出貨'));
    await waitFor(() => expect(screen.queryByText('K7X2MP')).not.toBeNull());
    expect(
      screen.queryByText(/訂單頁/),
      '掛品項失敗留下的是**空箱**,而出貨卡是由品項反查箱畫的 ⇒ 空箱在訂單頁看不到。' +
        '指一個找不到東西的地方,員工會在那裡繞半天(這正是 #351④ 記著的盲點)。' +
        '④ 落地後可以把地點加回來,那時要連這條斷言一起改。',
    ).toBeNull();
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
    { orderItemId: 'oi-9', orderDisplayId: 'PCM-0009', variantSku: 'X-0001', title: '還沒到的東西', remaining: 0, blockedReason: reason },
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
        { orderItemId: 'oi-blocked', orderDisplayId: 'PCM-0009', variantSku: 'X-0001', title: '還沒到的東西', remaining: 0, blockedReason: 'not_arrived' },
        { orderItemId: 'oi-ok', orderDisplayId: 'PCM-0001', variantSku: 'S-Y10E9-HGEH', title: '到了的東西', remaining: 2, blockedReason: null },
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
