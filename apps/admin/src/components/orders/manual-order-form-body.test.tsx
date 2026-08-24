// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('server-only', () => ({}));
// action 只是 `<form action={...}>` 的值 ⇒ 換成一個假的,避免把 'use server' 那條鏈拉進來。
vi.mock('@/lib/orders/manual-order-actions', () => ({ createManualOrderAction: vi.fn() }));

import { ManualOrderFormBody } from './manual-order-form-body';
import type { ManualCustomerCandidate } from '@/lib/customers/manual-customer';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const STAFF = [{ id: 'alice', label: '小愛' }];

function candidate(over: Partial<ManualCustomerCandidate> = {}): ManualCustomerCandidate {
  return {
    userId: '22222222-2222-4222-8222-222222222222',
    name: '王小明',
    email: 'a@example.test',
    phone: '0912345678',
    isManual: false,
    ...over,
  };
}

function renderForm(over: Partial<Parameters<typeof ManualOrderFormBody>[0]> = {}) {
  return render(
    <ManualOrderFormBody
      manualRequestId={REQUEST_ID}
      activeStaff={STAFF}
      candidates={[]}
      candidatesTruncated={false}
      phoneQuery=''
      selectedCustomer={candidate()}
      lookupFailed={false}
      staffLoadFailed={false}
      {...over}
    />,
  );
}

/**
 * 送出鈕是不是被停用。
 *
 * 🔴🔴 **不能寫 `button.disabled`** —— 那個 property 只反映**按鈕自己**的屬性,
 *    而真正的機制是祖先 `<fieldset disabled>`(它一口氣停掉裡面每一個輸入,
 *    不是只有送出鈕)。實測:寫 `.disabled` 那一格在 `activeStaff: []` 下**紅**,
 *    而瀏覽器裡那顆鈕是真的按不下去的 ⇒ **量錯東西了,不是行為錯了**。
 *    ⚠️ 誰看到這格紅想「那就在按鈕上也加一個 disabled」:**先讀這段**。
 *    加在按鈕上會讓這格變綠,而**其他每一個輸入框仍然能打字** —— 綠了而洞更大。
 */
function submitDisabled(): boolean {
  const btn = screen.getByRole('button', { name: '建立訂單' });
  return btn.closest('fieldset[disabled]') !== null;
}

afterEach(cleanup);

describe('🔴🔴 沒有啟用中的員工 ⇒ 表單停用 + 一句話指路(Sean 2026-08-24 裁甲)', () => {
  it('員工空 ⇒ 送出鈕不能按', () => {
    renderForm({ activeStaff: [] });
    expect(submitDisabled()).toBe(true);
  });

  it('員工空 ⇒ 那句話在畫面上,而且指向一個真的能做那件事的地方', () => {
    renderForm({ activeStaff: [] });
    const notice = screen.getByTestId('manual-order-no-staff');
    expect(notice.textContent).toContain('還沒有建立員工');
    expect(notice.querySelector('a')?.getAttribute('href')).toBe('/settings/staff');
  });

  it('🔴 那句話寫【怎麼做】,不寫內部語彙(Sean 08-11 常設準則)', () => {
    renderForm({ activeStaff: [] });
    const text = screen.getByTestId('manual-order-no-staff').textContent ?? '';
    for (const jargon of ['staff', 'is_active', 'null', '空陣列', '表為空']) {
      expect(text).not.toContain(jargon);
    }
  });

  it('🔴🔴 負對照:有一位啟用中的員工 ⇒ 送出鈕【可以按】, 而那句話【不在畫面上】', () => {
    // 少了這一格,「永遠停用 + 永遠出那句話」也會讓上面三格全綠。
    renderForm({ activeStaff: STAFF });
    expect(submitDisabled()).toBe(false);
    expect(screen.queryByTestId('manual-order-no-staff')).toBeNull();
  });
});

describe('🔴 冪等鍵:表單只是帶著走,不自己鑄', () => {
  it('隱藏欄位的值 = 傳進來的那顆', () => {
    const { container } = renderForm();
    const hidden = container.querySelector('input[name="manual_request_id"]') as HTMLInputElement;
    expect(hidden.value).toBe(REQUEST_ID);
  });

  it('🔴 找客人那個 GET 表單也要帶著它 —— 否則搜一次電話就換一顆鍵', () => {
    // 搜尋是 GET 導頁 ⇒ 頁面重繪 ⇒ 沒帶的話會鑄新的。
    // ⚠️ 搜尋框只在【還沒選客人】時出(codex R2:選定之後留著它 = 清值路徑還在)。
    const { container } = renderForm({ selectedCustomer: null });
    const carried = container.querySelector('input[name="mrid"]') as HTMLInputElement;
    expect(carried.value).toBe(REQUEST_ID);
  });

  it('🔴 負對照:兩個階段帶的是【同一顆】', () => {
    // ⚠️ 兩段式之後這兩個欄位**不會同時存在**(搜尋框只在還沒選客人時出)
    //    ⇒ 要跨兩次 render 比,不能在同一棵 DOM 裡找。
    //    📌 這一格原本是在同一棵 DOM 裡比 —— 而兩段式讓那個寫法【永遠拿不到其中一個】。
    const noPick = renderForm({ selectedCustomer: null });
    const b = (noPick.container.querySelector('input[name="mrid"]') as HTMLInputElement).value;
    cleanup();
    const picked = renderForm({ selectedCustomer: candidate() });
    const a = (picked.container.querySelector('input[name="manual_request_id"]') as HTMLInputElement).value;
    expect(a).toBe(b);
    expect(a).toBe(REQUEST_ID);
  });
});

describe('🔴🔴 兩段式:選到客人之前不出建單表單(codex R1 must-fix)', () => {
  // 原本兩者同時在畫面上 ⇒ 填好運費 150 再按「找客人」⇒ GET 導頁 ⇒ 表單重建、運費回 0
  // ⇒ 員工補完必填欄就**少收 150**。改成兩段式 = 把那個時間窗拿掉, 不是「小心一點」。
  it('沒選客人 ⇒ 沒有建單表單, 而且說了為什麼', () => {
    renderForm({ selectedCustomer: null, candidates: [candidate()], phoneQuery: '09' });
    expect(screen.queryByRole('button', { name: '建立訂單' })).toBeNull();
    expect(screen.getByTestId('manual-order-pick-first')).toBeTruthy();
  });

  it('🔴 負對照:選了客人 ⇒ 建單表單在(少了這格,「永遠不出表單」也會全綠)', () => {
    renderForm({ selectedCustomer: candidate() });
    expect(screen.getByRole('button', { name: '建立訂單' })).toBeTruthy();
    expect(screen.queryByTestId('manual-order-pick-first')).toBeNull();
  });

  it('🔴 候選連結帶著同一顆冪等鍵(否則選個客人就換一顆鍵)', () => {
    renderForm({ selectedCustomer: null, candidates: [candidate()], phoneQuery: '09' });
    const href = screen.getByTestId('manual-order-candidates').querySelector('a')!.getAttribute('href')!;
    expect(href).toContain(`mrid=${REQUEST_ID}`);
    expect(href).toContain('customer=');
  });

  it('🔴🔴 候選連結也要帶 phone —— 否則【點誰都選不上】(codex R2 新發現)', () => {
    // 頁面是靠「這次查回來的候選」去核 customer 的。少了 phone ⇒ 重載後候選是空的
    // ⇒ customer 判無效 ⇒ 正常流程永遠選不到客人。
    // ⚠️ 上一格只斷言 mrid 與 customer ⇒ **那是我的盲區**,這一格補的就是它。
    renderForm({ selectedCustomer: null, candidates: [candidate()], phoneQuery: '0912345678' });
    const href = screen.getByTestId('manual-order-candidates').querySelector('a')!.getAttribute('href')!;
    expect(href).toContain('phone=0912345678');
  });

  it('🔴🔴 選定客人之後【搜尋框要消失】—— 否則清值那條路還在(codex R2 新發現)', () => {
    // 兩段式只擋住「表單」是不夠的:搜尋框留著 ⇒ 填完地址運費再按一次「找客人」⇒ 值全消失。
    renderForm({ selectedCustomer: candidate() });
    expect(screen.queryByRole('button', { name: '找客人' })).toBeNull();
  });

  it('🔴 負對照:還沒選客人時搜尋框【要在】(少了它就沒辦法選人)', () => {
    renderForm({ selectedCustomer: null });
    expect(screen.getByRole('button', { name: '找客人' })).toBeTruthy();
  });

  it('🔴 選定之後仍要有一條回頭的路(「換一位」)', () => {
    const { container } = renderForm({ selectedCustomer: candidate() });
    const back = Array.from(container.querySelectorAll('a')).find((a) => a.textContent === '換一位');
    expect(back?.getAttribute('href')).toContain(`mrid=${REQUEST_ID}`);
  });
});

describe('🔴 中間態要講出來:品項還沒做(codex R1 must-fix)', () => {
  it('表單上有一句話說現在還不能真的建單', () => {
    renderForm();
    expect(screen.getByTestId('manual-order-lines-todo').textContent).toContain('還不能真的建單');
  });
});

describe('🔴 名單讀不到 ≠ 沒有員工(codex R1 nit)', () => {
  it('讀不到 ⇒ **不出**「還沒有建立員工」那一句(兩句同時在畫面上會互相矛盾)', () => {
    renderForm({ activeStaff: [], staffLoadFailed: true });
    expect(screen.queryByTestId('manual-order-no-staff')).toBeNull();
  });

  it('🔴 而它仍然停用(讀不到也不該讓他送出)', () => {
    renderForm({ activeStaff: [], staffLoadFailed: true });
    expect(submitDisabled()).toBe(true);
  });

  it('🔴 負對照:真的沒有員工(不是讀不到)⇒ 那一句要在', () => {
    renderForm({ activeStaff: [], staffLoadFailed: false });
    expect(screen.getByTestId('manual-order-no-staff')).toBeTruthy();
  });
});

describe('客人候選', () => {

  it('🔴 被上限截斷 ⇒ 畫面必須說出來(靜默截斷讓員工以為就這幾個)', () => {
    renderForm({ selectedCustomer: null, candidates: [candidate()], candidatesTruncated: true, phoneQuery: '09' });
    expect(screen.getByText(/符合的帳號太多/)).toBeTruthy();
  });

  it('🔴 負對照:沒截斷時那句話【不在畫面上】', () => {
    renderForm({ selectedCustomer: null, candidates: [candidate()], candidatesTruncated: false, phoneQuery: '09' });
    expect(screen.queryByText(/符合的帳號太多/)).toBeNull();
  });

  it('🔴 搜過了但查無 ⇒ 出一句話, 而它叫他【去建客人】不是叫他重試', () => {
    renderForm({ selectedCustomer: null, candidates: [], phoneQuery: '0900000000' });
    expect(screen.getByText(/這支電話找不到客人/)).toBeTruthy();
  });

  it('🔴🔴 查詢【壞掉】時不得出「找不到客人」(codex R1 must-fix)', () => {
    // 兩個世界的下一步相反:查無 ⇒ 去建客人(做得到);查壞了 ⇒ 找人(他建再多客人都沒用)。
    // 少了這一格, 員工會照「找不到」去建一個重複帳號, 而訂單掛到錯的人身上。
    renderForm({ selectedCustomer: null, candidates: [], phoneQuery: '09', lookupFailed: true });
    expect(screen.queryByText(/這支電話找不到客人/)).toBeNull();
  });

  it('🔴 負對照:【還沒搜】的時候不得出「找不到客人」', () => {
    // 少了這格,「一進來就說找不到」也會讓上一格全綠 —— 而那會讓員工以為系統壞了。
    renderForm({ selectedCustomer: null, candidates: [], phoneQuery: '' });
    expect(screen.queryByText(/這支電話找不到客人/)).toBeNull();
  });
});

describe('🔴 表單送不出 actor —— 那一格在型別與 DOM 上都不存在', () => {
  it('沒有任何 name 會被 RPC 當成 p_actor 的輸入欄', () => {
    const { container } = renderForm();
    for (const name of ['actor', 'p_actor', 'actor_id']) {
      expect(container.querySelector(`[name="${name}"]`)).toBeNull();
    }
  });

  it('🔴 畫面上【完全沒有】經手人這個欄位(codex R1 must-fix:會說謊的欄位比沒有糟)', () => {
    // 原本擺了一個 disabled 下拉顯示 activeStaff[0] —— 登入的是 Bob 而排序第一是 Alice 時,
    // 畫面說 Alice、帳上寫 Bob。⇒ 拿掉它。要顯示的話值必須來自 getSessionActor()。
    const { container } = renderForm();
    expect(container.querySelector('[name="acting_staff_display"]')).toBeNull();
    expect(screen.queryByText(/經手人/)).toBeNull();
  });
});
