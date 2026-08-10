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
const { fetchShipmentCandidates, refresh } = vi.hoisted(() => ({
  fetchShipmentCandidates: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('../../lib/shipping/shipment-actions', () => ({ fetchShipmentCandidates }));

import { OrderShipButton } from './shipment-launcher';
import type { ShipmentCandidateItem } from '../../lib/shipping/shipment-candidates';

// 🔴 **標型別**(2026-08-10 R2 抓到):不標的話漏一個欄位 `vi.fn()` 不會有任何抱怨,
//    而 `blockedReason` 缺席會讓彈窗把一個 `remaining=2` 的可出品項畫成「數量資料尚未就緒」,
//    測試卻因為只斷言料號而全綠 —— fixture 缺欄是假綠的常見入口。
const CANDIDATE: ShipmentCandidateItem = {
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

  it('🔴 全部出不了時,錯誤訊息報**逐項原因**(server 已經算好了,不要丟掉讓員工猜)', async () => {
    fetchShipmentCandidates.mockResolvedValue({
      items: [
        { ...CANDIDATE, orderItemId: 'a', remaining: 0, blockedReason: 'not_arrived' },
        { ...CANDIDATE, orderItemId: 'b', remaining: 0, blockedReason: 'not_arrived' },
        { ...CANDIDATE, orderItemId: 'c', remaining: 0, blockedReason: 'cancelled' },
      ],
      customerUserId: 'cu-A',
      recipient: RECIPIENT,
    });
    render(<OrderShipButton orderId='o1' />);
    click();
    await waitFor(() => expect(screen.queryByText(/沒有任何一件出得了/)).not.toBeNull());
    expect(
      screen.queryByText(/2件未到貨、1件已取消/),
      '只丟一句「未到貨、已取消,或已裝進其他箱子」⇒ 把三個可能性交給員工自己猜,' +
        '而原因就在 items[].blockedReason 手上 —— 這片存在的理由就是說出原因。',
    ).not.toBeNull();
  });

  // 🔴 2026-08-10 #351②:**這一格是新的主線**。改片之後「全部出不了」不再等於 `items` 是空的 ——
  //    出不了的品項現在會留在清單裡(要標原因)⇒ 舊的 `items.length === 0` 判斷對這個情境完全失效,
  //    員工會開到一個兩顆鈕全灰的彈窗、看到「至少要選一件才能建箱」,像是他自己忘了選。
  it('🔴 品項都在、但一件都出不了 → 一樣不開窗(不是開一個全灰的彈窗給他)', async () => {
    fetchShipmentCandidates.mockResolvedValue({
      items: [{ ...CANDIDATE, remaining: 0, blockedReason: 'not_arrived' }],
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
