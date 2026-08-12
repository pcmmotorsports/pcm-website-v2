// @vitest-environment jsdom
// shipment-launcher.test.tsx — 開建箱彈窗這條共用邏輯的**行為**守門
//                              (2026-08-09,codex R2 第 4 條打回來之後補)。
//
// 🔴 **為什麼非要有這一檔**:launcher 原本只有「掃原始碼」的守門(渲染彈窗的檔只有一個、
//    生成鍵的地方只有一個)。那些擋得住「複製第二份」,但**擋不住行為錯**:
//    把 `toMessage(e)` 改回 `String(e)`,原始碼掃描全綠,而員工看到的是 `[object Object]`
//    —— 那正是 2026-08-09 Sean 在正式站遇到、剛修好的那一族。
//
// ⚠️ **它擋不住什麼**:jsdom 下 server action 是 mock,證不了真的 PostgREST 錯誤長什麼樣;
//    也證不了 RSC payload 裡沒有金額(那要看瀏覽器的 network 面板)。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// 🔴 `vi.hoisted`:mock 工廠會被提升到檔頭,直接引用下面的 const 會炸。
const {
  fetchShipmentCandidates,
  submitShipment,
  refresh,
  fetchItemProcurementChoices,
  recordItemReceiptAction,
  undoItemReceiptAction,
} = vi.hoisted(() => ({
  fetchShipmentCandidates: vi.fn(),
  submitShipment: vi.fn(),
  refresh: vi.fn(),
  fetchItemProcurementChoices: vi.fn(),
  recordItemReceiptAction: vi.fn(),
  undoItemReceiptAction: vi.fn(),
}));
vi.mock('server-only', () => ({}));
// 🔴 **保留真模組、只換掉 `useRouter`**(原本是整包替換)。
//    整包替換的話 `unstable_isUnrecognizedActionError` 會是 `undefined` ⇒ 元件的 catch 一走就 TypeError
//    (實測:本檔既有兩格當場紅)。而且**不可以拿假的 predicate 頂替** —— 那樣這裡驗的是
//    我自己寫的假設,不是 Next 真的怎麼判(換版分支的唯一判準就是它)。
vi.mock('next/navigation', async () => ({
  ...(await vi.importActual<typeof import('next/navigation')>('next/navigation')),
  useRouter: () => ({ refresh }),
}));
vi.mock('../../lib/shipping/shipment-actions', () => ({ fetchShipmentCandidates, submitShipment }));
// 🔴 `undoItemReceiptAction` 也要給:`ReceiptRecordForm` 成功後會渲染 `ReceiptUndoBar`,
//    它 `useActionState` 吃那支。少給 = 整包 mock 抹掉具名匯出 ⇒ **Unhandled Error**
//    (詭異之處:每一格都綠、`vitest run` 卻 exit 1 ⇒ 只看「N passed」會漏掉)。
vi.mock('../../lib/orders/receipt-actions', () => ({
  fetchItemProcurementChoices,
  recordItemReceiptAction,
  undoItemReceiptAction,
}));

import { OrderShipButton } from './shipment-launcher';
import { UnrecognizedActionError } from 'next/dist/client/components/unrecognized-action-error';
import type { ShipmentCandidateItem } from '../../lib/shipping/shipment-candidates';

// 🔴 **標型別**(2026-08-10 R2 抓到):不標的話漏一個欄位 `vi.fn()` 不會有任何抱怨,
//    而 `blockedReason` 缺席會讓彈窗把一個 `remaining=2` 的可出品項畫成「數量資料尚未就緒」,
//    測試卻因為只斷言料號而全綠 —— fixture 缺欄是假綠的常見入口。
const CANDIDATE: ShipmentCandidateItem = {
  orderId: 'ord-uuid-1',
  orderItemId: 'oi-1',
  orderDisplayId: 'PCM-0001',
  variantSku: 'S-Y10E9-HGEH',
  title: '鈦合金頭段',
  remaining: 2,
  blockedReason: null,
};
const RECIPIENT = { name: '陳彥廷', phone: '0912345678', line: '台北市…' };

beforeEach(() => {
  fetchShipmentCandidates.mockReset();
  refresh.mockReset();
  // 🔴🔴 **通則:只要這個檔有任何一格在斷言「呼叫幾次」,每一支 mock 都要進這份 reset 清單。**
  //    漏一支 = 次數**跨測試累加**,而症狀長得像被測程式多跑了一次 —— 你會去修一個不存在的 bug。
  //    實錘(#352-b-2):我新增 `fetchItemProcurementChoices` / `recordItemReceiptAction`
  //    卻沒進這份清單,N1 那格看到 action 被呼叫 2 次,其實是上一格的 1 次加進來的。
  //    ⚠️ 加新 mock 時**同一個動作**把它加進來,別等到有人斷言次數才想起。
  fetchItemProcurementChoices.mockReset();
  recordItemReceiptAction.mockReset();
  undoItemReceiptAction.mockReset();
  submitShipment.mockReset();
});
afterEach(cleanup);

const click = () => fireEvent.click(screen.getByRole('button', { name: /建立包裹|載入中/ }));

describe('🔴🔴 錯誤訊息 — PostgrestError 是普通物件,不是 Error 實例', () => {
  it('丟出 `PostgrestError` 形狀的物件時,畫面顯示它的 message,**不是** `[object Object]`', async () => {
    // 🔴 這正是 Supabase 丟出來的形狀:有 message/code/details/hint,但**不是** Error 實例。
    fetchShipmentCandidates.mockRejectedValue({
      message: '這位客人不存在,無法建立包裹。',
      code: '23503',
      details: null,
      hint: null,
    });
    render(<OrderShipButton orderId='o1' />);
    click();
    await waitFor(() =>
      expect(
        screen.queryByText('這位客人不存在,無法建立包裹。'),
        'DB 用 RAISE EXCEPTION 寫給員工看的中文沒有出現在畫面上 ⇒ ' +
          '多半是又改回 `String(e)`,而 PostgrestError 不是 Error 實例 ⇒ 員工看到 `[object Object]`。',
      ).not.toBeNull(),
    );
    expect(document.body.textContent, '畫面上出現了 [object Object]').not.toContain('[object Object]');
  });

  it('丟出真的 `Error` 時同樣顯示 message(兩條路徑都要通)', async () => {
    fetchShipmentCandidates.mockRejectedValue(new Error('伺服器沒有回應'));
    render(<OrderShipButton orderId='o1' />);
    click();
    await waitFor(() => expect(screen.queryByText('伺服器沒有回應')).not.toBeNull());
  });

  it('🔴 **換版**時不得把 Next 的英文原文丟給員工,要講「重新整理」', async () => {
    // 🔴 真的 `UnrecognizedActionError`(深引入理由同 `shipment-dialog.test.tsx`):
    //    元件的判定是 instanceof,假物件驗不到真分支。
    fetchShipmentCandidates.mockRejectedValue(
      new UnrecognizedActionError('Server Action "abc" was not found on the server.'),
    );
    render(<OrderShipButton orderId='o1' />);
    click();
    await waitFor(() => expect(screen.queryByText(/重新整理/)).not.toBeNull());
    const text = document.body.textContent ?? '';
    expect(text, '英文原文對非工程師是純噪音,而且零指示').not.toMatch(/was not found on the server/);
    // 🔴 這條路是**讀候選**、零副作用 ⇒ 不得複製建箱那套冪等鍵論述(會讓員工以為東西送出去了)。
    expect(text, '這裡沒有冪等鍵可言,講它只會讓員工更怕').not.toMatch(/冪等|再按一次/);
  });
});

describe('🔴 開窗的前置閘 — 兩種情況都不給開,而且各有自己的說法', () => {
  it('一列品項都沒有 → 不開窗,而且**不編原因**(沒有品項就沒有「未到貨」可言)', async () => {
    fetchShipmentCandidates.mockResolvedValue({ items: [], customerUserId: 'cu-A', recipient: RECIPIENT });
    render(<OrderShipButton orderId='o1' />);
    click();
    await waitFor(() => expect(screen.queryByText(/沒有任何品項/)).not.toBeNull());
    expect(
      screen.queryByText(/未到貨|已取消|其他箱子/),
      '對一張沒有品項的單列出「未到貨/已取消/已裝箱」⇒ 三個理由全是編的。',
    ).toBeNull();
    expect(screen.queryByRole('dialog'), '沒東西可出卻把彈窗開起來了').toBeNull();
  });

  // ⚠️ **2026-08-11 #352-b-2 F1:fixture 換掉了,斷言的東西沒變。**
  //    原本用「2 件未到貨 + 1 件已取消」,而放寬之後**未到貨會開窗**(窗裡有「貨到了」可按)
  //    ⇒ 那份 fixture 不再走到「擋下」這條路。本格要守的是**擋下時訊息要逐項報原因**,
  //    所以改用一組「真的什麼都不能做」的品項,斷言字面同步跟著改。
  it('🔴 全部出不了時,錯誤訊息報**逐項原因**(server 已經算好了,不要丟掉讓員工猜)', async () => {
    fetchShipmentCandidates.mockResolvedValue({
      items: [
        { ...CANDIDATE, orderItemId: 'a', remaining: 0, blockedReason: 'cancelled' },
        { ...CANDIDATE, orderItemId: 'b', remaining: 0, blockedReason: 'cancelled' },
        { ...CANDIDATE, orderItemId: 'c', remaining: 0, blockedReason: 'all_boxed' },
      ],
      customerUserId: 'cu-A',
      recipient: RECIPIENT,
    });
    render(<OrderShipButton orderId='o1' />);
    click();
    await waitFor(() => expect(screen.queryByText(/沒有任何一件出得了/)).not.toBeNull());
    expect(
      screen.queryByText(/1件已裝進其他箱子、2件已取消/),
      '只丟一句「未到貨、已取消,或已裝進其他箱子」⇒ 把三個可能性交給員工自己猜,' +
        '而原因就在 items[].blockedReason 手上 —— 這片存在的理由就是說出原因。',
    ).not.toBeNull();
  });

  // 🔴 2026-08-10 #351②:**這一格是新的主線**。改片之後「全部出不了」不再等於 `items` 是空的 ——
  //    出不了的品項現在會留在清單裡(要標原因)⇒ 舊的 `items.length === 0` 判斷對這個情境完全失效,
  //    員工會開到一個兩顆鈕全灰的彈窗、看到「至少要選一件才能建箱」,像是他自己忘了選。
  //
  // ⚠️ **2026-08-11 #352-b-2 F1:本格的不變式沒變,但「什麼算不能做」的定義變了。**
  //    入口 2 之後,`not_arrived` 的品項在窗裡**有事可做**(按「貨到了」登記到貨)
  //    ⇒ 它不再屬於「開了也是全灰」那一類,fixture 因此改用 `cancelled`。
  //    要守的東西一字未改:**別開一個什麼都按不動的彈窗給員工**。
  it('🔴 品項都在、但一件都出不了 → 一樣不開窗(不是開一個全灰的彈窗給他)', async () => {
    fetchShipmentCandidates.mockResolvedValue({
      items: [{ ...CANDIDATE, remaining: 0, blockedReason: 'cancelled' }],
      customerUserId: 'cu-A',
      recipient: RECIPIENT,
    });
    render(<OrderShipButton orderId='o1' />);
    click();
    await waitFor(() => expect(screen.queryByText(/沒有任何一件出得了/)).not.toBeNull());
    expect(
      screen.queryByRole('dialog'),
      '全部出不了卻開了窗 ⇒ 員工面對一個什麼都按不動的彈窗,錯誤訊息還說是他沒選。',
    ).toBeNull();
  });

  it('🔴 只要有一件出得了就要開窗(不能因為清單裡有出不了的就整批擋掉)', async () => {
    fetchShipmentCandidates.mockResolvedValue({
      items: [{ ...CANDIDATE, orderItemId: 'oi-0', remaining: 0, blockedReason: 'not_arrived' }, CANDIDATE],
      customerUserId: 'cu-A',
      recipient: RECIPIENT,
    });
    render(<OrderShipButton orderId='o1' />);
    click();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeNull());
    expect(
      screen.queryByText(/沒有任何一件出得了/),
      '清單裡混了出不了的品項就把整批擋掉 ⇒ 到貨的東西寄不出去(把 every 寫成 some 就是這個症狀)。',
    ).toBeNull();
  });

  it('🔴 查不到共同客人(跨客人)→ 不開窗', async () => {
    fetchShipmentCandidates.mockResolvedValue({
      items: [CANDIDATE],
      customerUserId: null,
      recipient: RECIPIENT,
    });
    render(<OrderShipButton orderId='o1' />);
    click();
    await waitFor(() => expect(screen.queryByText(/共同的客人/)).not.toBeNull());
    expect(
      screen.queryByRole('dialog'),
      'customerUserId 是 null 卻照樣開窗 ⇒ 員工會填完一整張表才被 server 退件。',
    ).toBeNull();
  });

  it('一切正常 → 彈窗開起來,而且帶著料號', async () => {
    fetchShipmentCandidates.mockResolvedValue({
      items: [CANDIDATE],
      customerUserId: 'cu-A',
      recipient: RECIPIENT,
    });
    render(<OrderShipButton orderId='o1' />);
    click();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeNull());
    expect(screen.queryByText('S-Y10E9-HGEH'), '彈窗開了但料號沒畫出來').not.toBeNull();
  });
});

describe('詳情頁入口 — 只送這一張單', () => {
  it('🔴 帶去查的訂單 id 恰好是本單(不是空陣列、也不是全部)', async () => {
    fetchShipmentCandidates.mockResolvedValue({ items: [], customerUserId: null, recipient: null });
    render(<OrderShipButton orderId='o-this-one' />);
    click();
    await waitFor(() => expect(fetchShipmentCandidates).toHaveBeenCalled());
    expect(fetchShipmentCandidates.mock.calls[0]?.[0]).toEqual(['o-this-one']);
  });
});

// ── #351③ 收尾:半成品箱關窗後要重取頁面(整合) ──────────────────────────
//
// 🔴🔴 **為什麼守在這一層**:彈窗那端只做得到「關窗時回報有沒有建出箱」
//    (`shipment-dialog.test.tsx` 有那兩格);**真的去刷的是 launcher**。
//    只守元件那一端 = 透傳一跳無人守:把這裡的 `if (createdShipment) router.refresh()`
//    整行刪掉,元件層照樣全綠,而員工照文案回訂單頁看到的還是沒有那個箱子的舊畫面。
describe('#351③ 半成品箱 — 關窗後重取(整合)', () => {
  const openHalfDone = async () => {
    fetchShipmentCandidates.mockResolvedValue({
      items: [CANDIDATE],
      customerUserId: 'cu-A',
      recipient: RECIPIENT,
    });
    // 建箱成功、掛品項失敗 ⇒ 失敗路徑但帶著箱號(= 半成品箱)。
    submitShipment.mockResolvedValue({
      ok: false,
      message: '掛品項:有品項的出貨數量超過現有可出數量。',
      shipmentReference: 'K7X2MP',
      code: 'P2B27',
    });
    render(<OrderShipButton orderId='o1' />);
    click();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeNull());
    fireEvent.click(screen.getByText('只建箱、先不出貨'));
    await waitFor(() => expect(screen.queryByText('K7X2MP')).not.toBeNull());
  };

  it('🔴 半成品箱關窗 → `router.refresh()` 恰 1 次(不刷的話文案指的那一區不會出現)', async () => {
    await openHalfDone();
    // 🔴 先驗這時候還沒刷過:失敗路徑不走 `onDone` ⇒ 刷的動作只可能來自關窗那一下。
    expect(refresh, '還沒關窗就刷了 ⇒ 這格證不了「關窗」是刷的原因').not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /關閉/ }));
    expect(refresh.mock.calls.length).toBe(1);
    // 🔴 codex R1 nit1:也要驗**窗真的關了** —— 只斷言有刷的話,把 `setOpen(null)` 刪掉照樣全綠,
    //    而那個彈窗會繼續蓋在畫面上,擋住文案剛叫他去看的那一區。
    expect(screen.queryByRole('dialog'), '刷了但窗沒關 ⇒ 員工看不到底下那一區').toBeNull();
  });

  it('沒建出箱就關窗 → 不刷(白刷一次是雜訊)', async () => {
    fetchShipmentCandidates.mockResolvedValue({
      items: [CANDIDATE],
      customerUserId: 'cu-A',
      recipient: RECIPIENT,
    });
    render(<OrderShipButton orderId='o1' />);
    click();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /關閉/ }));
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog'), '按了關閉窗卻沒關').toBeNull();
  });
});

// ── #352-b-2 C1b:23a 成功路徑的**整合**守門 ────────────────────────────
//
// 🔴🔴 **為什麼一定要走 `OrderShipButton` 而不是直接 render `ShipmentDialog`**:
//    R1 的 Critical 就住在「元件 × launcher」那一跳 —— 元件層測試自己傳的 `onRefresh`
//    是**身分穩定**的 `vi.fn()`,而真正的 launcher 每次 render 都給**新的箭頭函式**
//    (`setOpen({...o, data})` 也是新物件)⇒ 迴圈在元件層**構造不出來、那一格恆綠**。
//    實測那條路是 321 次重取 / 400ms + Maximum update depth。
//    ⇒ 守門要畫在**壞掉的那一跳**上,不是畫在看得見的那一層(b-1 線自己的教訓)。
describe('OrderShipButton — 23a 登錄到貨後就地重取(整合)', () => {
  const NOT_ARRIVED: ShipmentCandidateItem = {
    ...CANDIDATE,
    orderItemId: 'oi-na',
    remaining: 0,
    blockedReason: 'not_arrived',
  };

  // ⚠️ **fixture 必須是「混合箱」(至少一件出得了 + 一件未到貨),不能全是未到貨** ——
  //    launcher `:93` 對「每一件都出不了」的單**根本不開窗**(#351② 的既有守門)。
  //    ⇒ 全未到貨的單今天走不到入口 2,那是本片的**已知範圍限制**、已回報主視窗待裁,
  //    不是這一格可以自己放寬的東西。這裡用混合箱測的是 C1 那條迴圈,與該限制無關。
  it('🔴 登錄成功 → 重取恰 1 次,不是無窮迴圈', async () => {
    fetchShipmentCandidates.mockResolvedValue({
      items: [{ ...CANDIDATE, orderItemId: 'oi-ok', remaining: 2, blockedReason: null }, NOT_ARRIVED],
      customerUserId: 'cus-1',
      recipient: { name: '客', phone: '09', line: null },
    });
    // 🔴🔴 **第二次要回「已推上去」的 received**(R2 N1 打掉我上一版):
    //    原本兩次都回同一份 ⇒ `remaining` 恆等 ⇒ effect 的第二次觸發**永遠不會發生**
    //    ⇒ 「重取恰 1 次」那個斷言在真資料下是假的、這一格量不到 N1 那個 bug。
    //    真實情況是:登錄成功 → M2 重抓採購列 → `received` 由 1 變 3 → `remaining` 變 →
    //    舊寫法(deps 含 remaining)會再觸發一次、把員工正在打的第二批數字清空。
    fetchItemProcurementChoices
      .mockResolvedValueOnce([
        { procurementId: 'p-1', supplierLabel: 'RPM', allocatedQuantity: 3, receivedQuantity: 1 },
      ])
      .mockResolvedValue([
        { procurementId: 'p-1', supplierLabel: 'RPM', allocatedQuantity: 3, receivedQuantity: 3 },
      ]);
    recordItemReceiptAction.mockResolvedValue({
      status: 'recorded_inline',
      outcome: 'recorded',
      procurementId: 'p-1',
    });

    const { container } = render(<OrderShipButton orderId='ord-uuid-1' />);
    fireEvent.click(screen.getByRole('button', { name: /建立包裹|出貨|建箱/ }));
    await waitFor(() => expect(fetchShipmentCandidates).toHaveBeenCalledTimes(1));

    fireEvent.click(await screen.findByText('貨到了'));
    await waitFor(() =>
      expect(
        (container.querySelector('input[name="request_id"]') as HTMLInputElement | null)?.value,
      ).toBeTruthy(),
    );

    fireEvent.submit(container.querySelector('form')!);
    // 成功後應再重取(開窗那次 + 這次 = 2)
    await waitFor(() => expect(fetchShipmentCandidates).toHaveBeenCalledTimes(2));

    // 🔴 關鍵:再等一段時間,次數**不得繼續往上爬**。
    //    迴圈版在這段時間內會衝到數百次(R1 實測 321 次 / 400ms)。
    //    ⚠️ 斷言寫成**上界**而不是「恰 2 次」:重取次數不是我們要釘死的規格,
    //    「有界」才是(R2 明示 commit body 也不要寫「恰 1 次」)。
    await new Promise((r) => setTimeout(r, 300));
    expect(fetchShipmentCandidates.mock.calls.length).toBeLessThanOrEqual(2);
    expect(recordItemReceiptAction).toHaveBeenCalledTimes(1);
  });
});

// ── #352-b-2 F1:開窗條件放寬(主視窗 2026-08-11 裁)────────────────────
//
// 🔴 **正負成對**:只釘「全未到貨開得了窗」的話,有人把整道閘拆掉也全綠 ——
//    而那道閘擋的是「開了窗什麼都不能做」那種更糟的畫面。
describe('OrderShipButton — F1 開窗條件', () => {
  const base = (items: ShipmentCandidateItem[]) => ({
    items,
    customerUserId: 'cus-1',
    recipient: { name: '客', phone: '09', line: null },
  });
  const NA: ShipmentCandidateItem = {
    ...CANDIDATE,
    orderItemId: 'oi-na',
    remaining: 0,
    blockedReason: 'not_arrived',
  };

  // 🔴 這格是 #352-b 的**主場景**:單品項訂單、東西還沒到、員工要按「貨到了」。
  //    放寬前它開不了窗 ⇒ 入口 2 在最該用的情況下不可達。
  it('🔴 整張單只有未到貨品項 → **開得了窗**(入口 2 的主場景)', async () => {
    fetchShipmentCandidates.mockResolvedValue(base([NA]));
    render(<OrderShipButton orderId='ord-uuid-1' />);
    fireEvent.click(screen.getByRole('button', { name: '建立包裹' }));
    expect(await screen.findByText('貨到了')).toBeTruthy();
  });

  // 🔴 放寬的是**條件**不是拆閘:真的什麼都不能做的單照舊擋下、訊息不變。
  it.each([
    ['全部已取消', 'cancelled' as const],
    ['全部已裝箱', 'all_boxed' as const],
  ])('🔴 %s(沒得出也沒有在等的貨)→ 仍然擋下、不開窗', async (_label, reason) => {
    fetchShipmentCandidates.mockResolvedValue(base([{ ...NA, blockedReason: reason }]));
    render(<OrderShipButton orderId='ord-uuid-1' />);
    fireEvent.click(screen.getByRole('button', { name: '建立包裹' }));
    expect(await screen.findByText(/沒有任何一件出得了/)).toBeTruthy();
    expect(screen.queryByText('貨到了')).toBeNull();
  });

  // 🔴 開窗之後的文案要跟「為什麼開得了」一致 —— 不能對沒得選的人說「你至少要選一件」。
  it('🔴 全未到貨開窗後,建箱那半講的是「先登記到貨」不是「你忘了選」', async () => {
    fetchShipmentCandidates.mockResolvedValue(base([NA]));
    render(<OrderShipButton orderId='ord-uuid-1' />);
    fireEvent.click(screen.getByRole('button', { name: '建立包裹' }));
    expect(await screen.findByText(/現在都不能出,其中還有在等到貨的/)).toBeTruthy();
    expect(screen.queryByText(/至少要選一件/)).toBeNull();
  });
});

// ── R2 N1:同一次成功不得把欄位重置兩遍 ────────────────────────────────
//
// 🔴 **本 describe 就是 N1 的守門**(2026-08-11 終輪更正)。
//    突變靶 = 還原 N1(拿掉 `receipt-record-form.tsx` 的 `handledRef` 早退 + 把 `remaining`
//    放回**成功那支 effect** 的 deps)⇒ **本檔 2 格紅**(下面兩條 `≤2` 上界),
//    訊息皆為 `expected 3 to be less than or equal to 2` —— M2 把 `received` 推上去讓
//    `remaining` 改變、同一次成功被處理第二遍,於是重取從 2 次變 3 次。
//
// 🔴🔴 **這段前一版寫的是「構造不出來、本 describe 非守門」—— 那是錯的,錯因值得留著**:
//    我的突變腳本有兩段 replace,第二段用 `'}, [state, procurementId]);\n\n  const set ='`
//    當錨點,而本檔**有兩個 effect 的 deps 長得一模一樣** —— 那個錨點命中的是**失敗回填**那支,
//    不是成功那支 ⇒ **`remaining` 從來沒被加進我要突變的那個 effect**,N1 根本沒被還原。
//    而我的「突變是否套上」只驗了另一半(`grep -c handledRef` = 0)就放行。
//    ⇒ **教訓:驗突變要驗「改到的是不是那一處」,不是只驗「檔案有沒有變」。**
//    多處同字面時用行號錨點,並把改完的那一行印出來確認。
describe('OrderShipButton — 成功只被處理一次(N1 守門)', () => {
  it('🔴 M2 重抓讓 remaining 改變,也不得再觸發一次重置', async () => {
    fetchShipmentCandidates.mockResolvedValue({
      items: [
        { ...CANDIDATE, orderItemId: 'oi-ok', remaining: 2, blockedReason: null },
        { ...CANDIDATE, orderItemId: 'oi-na', remaining: 0, blockedReason: 'not_arrived' },
      ],
      customerUserId: 'cus-1',
      recipient: { name: '客', phone: '09', line: null },
    });
    fetchItemProcurementChoices
      .mockResolvedValueOnce([
        { procurementId: 'p-1', supplierLabel: 'RPM', allocatedQuantity: 5, receivedQuantity: 1 },
      ])
      .mockResolvedValue([
        { procurementId: 'p-1', supplierLabel: 'RPM', allocatedQuantity: 5, receivedQuantity: 4 },
      ]);
    recordItemReceiptAction.mockResolvedValue({
      status: 'recorded_inline',
      outcome: 'recorded',
      procurementId: 'p-1',
    });

    const { container } = render(<OrderShipButton orderId='ord-uuid-1' />);
    fireEvent.click(screen.getByRole('button', { name: '建立包裹' }));
    fireEvent.click(await screen.findByText('貨到了'));
    const qtyBox = () =>
      container.querySelector('input[name="quantity"]') as HTMLInputElement | null;
    await waitFor(() => expect(qtyBox()).toBeTruthy());
    fireEvent.submit(container.querySelector('form')!);

    // 成功後表單重置一次(預設回滿量)—— 這是對的。
    await waitFor(() => expect(recordItemReceiptAction).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(fetchItemProcurementChoices.mock.calls.length).toBeGreaterThan(1));

    // 🔴 這兩條同時擋兩件事:①重取失控(C1 那類迴圈,會衝到數百次)
    //    ②同一次成功被處理兩遍(N1,會變成 3 次)。V1 突變下兩條都會紅在 `3 ≤ 2`。
    await new Promise((r) => setTimeout(r, 300));
    expect(fetchShipmentCandidates.mock.calls.length).toBeLessThanOrEqual(2);
    expect(fetchItemProcurementChoices.mock.calls.length).toBeLessThanOrEqual(2);
  });
});
