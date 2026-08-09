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

const CANDIDATE = {
  orderItemId: 'oi-1',
  orderDisplayId: 'PCM-0001',
  variantSku: 'S-Y10E9-HGEH',
  title: '鈦合金頭段',
  remaining: 2,
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
  it('沒有可出貨品項 → 不開窗,告訴員工為什麼', async () => {
    fetchShipmentCandidates.mockResolvedValue({ items: [], customerUserId: 'cu-A', recipient: RECIPIENT });
    render(<OrderShipButton orderId='o1' />);
    click();
    await waitFor(() => expect(screen.queryByText(/沒有可出貨的品項/)).not.toBeNull());
    expect(screen.queryByRole('dialog'), '沒東西可出卻把彈窗開起來了').toBeNull();
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
