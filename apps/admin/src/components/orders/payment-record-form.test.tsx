// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import {
  paymentFailure,
  type PaymentActionState,
  type PaymentFormValues,
} from '../../lib/orders/payment-action-state';

// payment-record-form.test.tsx — M-4b E10 #15-B2-c 片2a:表單接線 smoke test。
// 🔴 mock 掉 server action 模組(transitively 拉 next/cache 與 session,jsdom 載不了);
//    action 的語意層在 `payment-actions.test.ts` 測過,本檔只測表單這一層。
//    ⚠️ 生命週期(失敗→重送→換鍵)在 **2b** 的 `payment-lifecycle.test.tsx`,不在這裡。

const actionMock = vi.fn<(prev: PaymentActionState, form: FormData) => Promise<PaymentActionState>>();
vi.mock('../../lib/orders/payment-actions', () => ({
  recordManualPaymentAction: (prev: PaymentActionState, form: FormData) => actionMock(prev, form),
}));

import { PaymentRecordForm } from './payment-record-form';

const ORDER_ID = '3f2f2c1e-0000-4000-8000-000000000001';
const STAMP = {
  requestId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  cashReceivedAt: '2026-08-12T02:00:00.000Z',
};
const RETURN_TO = '/orders?payment_status=paid';

function renderForm(props: Partial<Parameters<typeof PaymentRecordForm>[0]> = {}) {
  return render(
    <PaymentRecordForm
      orderId={ORDER_ID}
      returnTo={RETURN_TO}
      stamp={STAMP}
      detailsReadable
      {...props}
    />,
  );
}

// ── `#493`(同一條拍板的第三個落點)──────────────────────────────────────
// 「收款日期」= 錢已經收到了我才在登記 ⇒ **已發生** ⇒ 預設當下。
describe('`#493` 收款日期預設當下', () => {
  it('🔴 一開啟就帶著當下(本欄只到日 ⇒ 形狀是 YYYY-MM-DD)', () => {
    const { container } = renderForm();
    const v = container.querySelector<HTMLInputElement>('input[type="date"]')?.value ?? '';
    expect(v, '空的 ⇒ 同 `#493`:員工以為系統會填').not.toBe('');
    expect(v, 'type=date 只吃 YYYY-MM-DD;多帶時分會被瀏覽器靜默丟掉').toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

/** 表單此刻**真的會送出去**的 payload —— 斷言對象一律是它,不是畫面上的字。 */
function payload(container: HTMLElement): FormData {
  const form = container.querySelector('form');
  if (form === null) throw new Error('沒有 form 可以送出');
  return new FormData(form);
}

function submitButton(container: HTMLElement): HTMLButtonElement {
  const el = container.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (el === null) throw new Error('找不到送出鈕');
  return el;
}

function checkbox(container: HTMLElement): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (el === null) throw new Error('找不到確認勾選格');
  return el;
}

function pickCash(container: HTMLElement) {
  fireEvent.click(container.querySelector('input[name="rail"][value="cash"]')!);
}

/** 「帶入尾款 NT$X」那顆鈕;沒有就回 `null`(不畫 = 這一族一半的期望)。 */
function fillButton(container: HTMLElement): HTMLButtonElement | null {
  return [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('帶入尾款')) ?? null;
}

// ── 🔴🔴 [2026-09-16 Sean 走查第 2 件]「帶入尾款」那顆鈕的【行為】 ──────────────────────
//   `payment-list.test.tsx` 那一族守的是「算出來的數字對不對」;**本族守的是「按下去真的填對了」**。
//   📌 兩件事分得開:數字算對了而按鈕填錯格式,員工一樣送不出去(而畫面只回一句通用的
//      「表單內容不正確」,他看不出是哪一欄 —— 那個坑 `:286-288` 的註解已經記過一次)。
describe('帶入尾款那顆鈕', () => {
  it('🔴 按下去填進金額欄的是【純數字】—— 不是鈕面上那個帶逗號的', () => {
    // 解析器只收「整數元、無分隔符」(`payment-form.ts` 的 `toAmount`)⇒ 填 "1,785,000" 會被判 invalid。
    const { container } = renderForm({ variant: 'dialog', fillableDue: 1785000 });
    const btn = fillButton(container);
    expect(btn, '鈕不見了 ⇒ 下面的斷言全部會因為「什麼都沒有」而空過').not.toBeNull();
    expect(btn!.textContent, '鈕面上要有逗號 —— 那是給人看的').toContain('1,785,000');
    fireEvent.click(btn!);
    expect(payload(container).get('amount'), '填進去的帶了逗號 ⇒ 送出會被判 invalid').toBe('1785000');
  });

  // 🔴🔴 **[對抗審查 2026-09-16 nice-to-have ②]** 這一片**真正修掉的那個 bug** 原本零覆蓋:
  //   `payment-record-form.tsx` 那段註解自己逐字寫著「狀態行為什麼一定要移出 `<label>` ——
  //   點到數字也會切換勾選。**那是 bug,不是版面偏好。**」
  //   而在本格加進來之前,**有人把它搬回 `<label>` 裡,156 格照樣全綠。**
  //   📌 這正是同一片註解在罵的形狀:**修好了、寫了理由,而沒有任何東西守著它。**
  it('🔴 狀態行必須在 `<label>` 外面 —— 在裡面的話點那串數字會誤勾', () => {
    const { container } = renderForm({ variant: 'dialog', receivedNote: '還沒登過 · 尾款 NT$1,785' });
    const p = [...container.querySelectorAll('p')].find((x) => x.textContent?.startsWith('這張單目前'));
    expect(p, '狀態行整個不見了 ⇒ 下面那條會因為「什麼都沒有」而空過').not.toBeUndefined();
    expect(p!.closest('label'), '狀態行又跑回 label 裡 ⇒ 點它會把確認勾切掉或勾上').toBeNull();
  });

  it('🔵 沒有尾款可帶(null)⇒ 整顆鈕不出現,而不是出現一顆按不動的', () => {
    const { container } = renderForm({ variant: 'dialog', fillableDue: null });
    expect(fillButton(container), '灰掉的鈕會讓員工問「為什麼不能按」,而那句解釋已經印在旁邊了').toBeNull();
  });

  it('🔴 明細頁版【就算硬把數字傳進去】也不畫 —— 這格測的是元件,不是「我沒傳」', () => {
    // 🔴 本格刻意**傳**一個合法的數字進去。若元件只看 `fillableDue !== null`,它會畫出來 ⇒ 紅。
    //    📌 寫第一版時我就是只看 `fillableDue`,而這格若改成「不傳」也會綠 ——
    //       **那樣它測的是我的呼叫方式,不是元件的行為。** 兩者在全綠的畫面上長得一樣。
    // 範圍的理由:明細頁那半走 `children` 拿不到這個值(`payment-section.tsx` 那段註解),
    // 而且那一版**沒有摺疊在下面的收款清單** ⇒ 要給它鈕得先決定版面,不是多傳一個 prop。
    const { container } = renderForm({ variant: 'page', fillableDue: 700 });
    expect(fillButton(container)).toBeNull();
  });
});

beforeEach(() => {
  actionMock.mockReset();
  actionMock.mockResolvedValue({ status: 'idle' });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('印章 = 整組兩格、成組送出', () => {
  // 🔴 `payment-form.ts:160-166` 逐字「印章的形狀在**兩軌都驗**」——匯款軌不使用
  //    `cash_received_at`,但少了它解析器一樣判 invalid。⇒ 兩軌各驗一次,不只驗現金軌。
  it.each([
    ['匯款軌(預設)', (_c: HTMLElement) => {}],
    ['現金軌', pickCash],
  ])('%s:request_id 與 cash_received_at 都在 payload 裡、值等於 server 章', (_name, pick) => {
    const { container } = renderForm();
    pick(container);
    const form = payload(container);
    expect(form.getAll('request_id')).toEqual([STAMP.requestId]);
    expect(form.getAll('cash_received_at')).toEqual([STAMP.cashReceivedAt]);
  });

  // 🔴 送兩份會讓 `readSingleString` 回 null ⇒ `anyMalformed` 擋下 ⇒ `invalid`,
  //    而畫面上兩個 hidden 長得一模一樣、完全看不出來(`payment-form.ts:146-149`)。
  it('每個印章欄位只有一份', () => {
    const { container } = renderForm();
    expect(container.querySelectorAll('[name="request_id"]')).toHaveLength(1);
    expect(container.querySelectorAll('[name="cash_received_at"]')).toHaveLength(1);
  });

  it('order_id 與 return_to 各一份、值逐字相同', () => {
    const { container } = renderForm();
    const form = payload(container);
    expect(form.getAll('order_id')).toEqual([ORDER_ID]);
    expect(form.getAll('return_to')).toEqual([RETURN_TO]);
  });
});

describe('兩軌的欄位不同(不是同一組欄位有些留空)', () => {
  // 🔴 現金軌**帶了單號就是偽造 payload、當場拒**(`payment-form.ts:178`)。
  //    ⇒ 那一欄在現金軌必須**不存在**,而不是存在但空著 —— 空字串經 `orNull` 會變 null 沒事,
  //    但只要員工先在匯款軌打了單號再切現金,殘值就會跟著送出去。本格釘的是後者。
  it('現金軌:切過去之後 payload 裡沒有 bank_reference(即使先前打過)', () => {
    const { container } = renderForm();
    fireEvent.change(container.querySelector('input[name="bank_reference"]')!, {
      target: { value: 'CTBC-12345' },
    });
    expect(payload(container).getAll('bank_reference')).toEqual(['CTBC-12345']);

    pickCash(container);
    expect(payload(container).getAll('bank_reference')).toEqual([]);
  });

  it('現金軌:沒有銀行入帳日那一欄(時點來自 server 章)', () => {
    const { container } = renderForm();
    pickCash(container);
    expect(container.querySelector('input[name="received_date"]')).toBeNull();
  });

  it('匯款軌:銀行入帳日與單號兩欄都在', () => {
    const { container } = renderForm();
    expect(container.querySelector('input[name="received_date"]')).not.toBeNull();
    expect(container.querySelector('input[name="bank_reference"]')).not.toBeNull();
  });

  // 🔴🔴 **這兩格是一對, 而只釘「匯款軌看得到」是不夠的。**
  //    那兩行提示住在 `{!isCash && …}` 裡 ⇒ 一個把它們搬到那個條件【外面】的改動,
  //    在「匯款軌看得到」那一格底下**照樣全綠** —— 而畫面上會出現一句
  //    「匯款一定要填這一欄」**印在現金軌上**, 而現金軌根本沒有那兩欄可填。
  //    ⇒ 📌 所以現金軌那一格不是補充, 它是**唯一殺得掉那個突變的一半**。
  //    🔵 而它與 `:129` 盯的不是同一個東西:那格盯【輸入框】, 本格盯【解釋它的那句話】
  //      ⇒ 兩者可以分開壞掉(搬走一個而留下另一個), 所以兩格都要。
  it('匯款軌:兩欄各有一行「一定要填」的提示', () => {
    const { container } = renderForm();
    const txt = container.textContent ?? '';
    expect(txt).toContain('匯款一定要填這一欄。');
    expect(txt).toContain('匯款一定要填這一欄,只打末五碼也可以。');
  });

  it('現金軌:那兩行提示【跟著兩欄一起不見】(正對照)', () => {
    const { container } = renderForm();
    pickCash(container);
    expect(container.textContent ?? '').not.toContain('匯款一定要填這一欄');
  });
});

describe('文案紅線(plan v4 §4a)', () => {
  // 🔴 `payment-action-state.ts:54-57` 逐字:這個時點 FormData 偽造得掉
  //    ⇒ **不得**把它講成可信來源。「系統自動記錄」正是被點名的那種說法。
  it('現金軌的說明不得出現「系統自動記錄」', () => {
    const { container } = renderForm();
    pickCash(container);
    expect(container.textContent).not.toContain('系統自動記錄');
  });

  // 🔴 Fable R3 F3:`rejected`(P0001)是一碼多義,零寫入也走它
  //    ⇒ 「開始下一筆」那顆鈕**不得斷言已入帳**。
  //
  // 🔴🔴 **這一格差一點寫成恆真**:第一版只有三條 `not.toContain`,而 `useActionState`
  //    是非同步的 —— 沒等就讀的話鈕根本還沒出現、`label` 是空字串,三條否定斷言**全部照過**,
  //    而且「文案改成『已入帳』」這個突變也照樣綠。⇒ 修法 = **先正面斷言鈕真的在**
  //    (`toContain('確認明細')`),否定斷言才有東西可否定。
  it.each(['error', 'rejected'] as const)('%s 失敗後出現的鈕,文案不得斷言已入帳', async (code) => {
    const { container } = renderForm();
    const label = await buttonLabelAfterFailure(container, code);
    // 前提自斷言:鈕真的渲染出來了(否則下面三條是空轉)。
    expect(label).toContain('確認明細');
    expect(label).not.toContain('已入帳');
    expect(label).not.toContain('已經入帳');
    expect(label).not.toContain('確認入帳');
  });

  // 🔴 稽核 P0-2 / codex R2 M1:P2B53 確定那把鍵已有一筆入帳 ⇒ **不給**「開始下一筆」這個換鍵出口。
  //    先正面等到失敗訊息真的畫出來,「沒有鈕」才不是空轉(同上面那格的教訓)。
  it('content_conflict 失敗後【沒有】開始下一筆的鈕,而且 revalidate 換章之後仍送同一把鍵', async () => {
    const { container, rerender } = renderForm();
    actionMock.mockResolvedValue(
      paymentFailure('content_conflict', {
        rail: 'bank_transfer',
        amount: '1000',
        receivedDate: '2026-08-12',
        bankReference: 'CTBC-1',
        payerNote: '',
        requestId: STAMP.requestId,
        cashReceivedAt: STAMP.cashReceivedAt,
      }),
    );
    fireEvent.click(checkbox(container));
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => {
      if (!(container.textContent ?? '').includes('已經記進帳')) throw new Error('失敗訊息還沒出現');
    });
    expect(container.querySelector('button[type="button"]')).toBeNull();
    // 🔴 codex TS 片 R1 should-fix 1:失敗路徑會 revalidate ⇒ server 鑄一組**不同**的新章傳進來。
    //    prop 與失敗 state 用同一組章的話,錯用 prop 也會過 ⇒ 這裡換成另一組,表單必須仍送舊鍵。
    const STAMP_B = {
      requestId: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
      cashReceivedAt: '2026-08-12T03:00:00.000Z',
    };
    rerender(
      <PaymentRecordForm orderId={ORDER_ID} returnTo={RETURN_TO} stamp={STAMP_B} detailsReadable />,
    );
    const key = container.querySelector<HTMLInputElement>('input[name="request_id"]');
    const at = container.querySelector<HTMLInputElement>('input[name="cash_received_at"]');
    expect(key?.value).toBe(STAMP.requestId);
    expect(at?.value).toBe(STAMP.cashReceivedAt);
    expect(key?.value).not.toBe(STAMP_B.requestId);
  });
});

describe('Q-D8=B 確認閘(Sean 2026-08-12 拍)', () => {
  it('全新掛載:沒勾之前送出鈕是停用的', () => {
    const { container } = renderForm();
    expect(submitButton(container).disabled).toBe(true);
  });

  it('勾了之後才啟用', () => {
    const { container } = renderForm();
    fireEvent.click(checkbox(container));
    expect(submitButton(container).disabled).toBe(false);
  });

  // 🔴 明細讀不到時**連那一格也停用**:不讓「叫你去看明細」與「明細讀不到」
  //    同時出現在畫面上互打(plan v4 §5)。
  it.each([false])('detailsReadable=%s:勾選格與送出鈕都停用', (readable) => {
    const { container } = renderForm({ detailsReadable: readable });
    expect(checkbox(container).disabled).toBe(true);
    expect(submitButton(container).disabled).toBe(true);
  });

  // 🔴 表單**不卸載**(plan v4 §3 D3):卸載會銷毀 `state` 裡那組舊印章,
  //    重新掛載 = 新印章 = 重複入帳那條路。
  it('detailsReadable=false 時表單仍在畫面上(只是不能送)', () => {
    const { container } = renderForm({ detailsReadable: false });
    expect(container.querySelector('form')).not.toBeNull();
    expect(payload(container).getAll('request_id')).toEqual([STAMP.requestId]);
  });

  // 🔴 送出中也要停用(codex 關卡2 nit1:拿掉 `isPending` 那半,原本全套照樣綠)。
  //    連點兩下 = 同一把鍵兩個併發請求打進 RPC;G8 擋得掉重複入帳,但那是**第二道**,
  //    第一道本來就該是不讓他按第二下。
  it('送出中(action 還沒回)送出鈕是停用的', async () => {
    actionMock.mockImplementation(() => new Promise(() => {})); // 永不 resolve = 停在 pending
    const { container } = renderForm();
    fireEvent.click(checkbox(container));
    expect(submitButton(container).disabled).toBe(false); // 前提自斷言:送出前是啟用的
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => {
      if (!submitButton(container).disabled) throw new Error('送出中仍可再按');
    });
  });
});

/**
 * 讓表單真的走到某個失敗碼,回傳「開始下一筆」那顆鈕的文字。
 * 🔴 `waitFor` 不是保險起見 —— `useActionState` 的 state 是下一輪才到,
 *    不等的話呼叫端拿到空字串、否定斷言全部空轉(見上面那段)。
 */
async function buttonLabelAfterFailure(
  container: HTMLElement,
  code: 'error' | 'rejected',
): Promise<string> {
  const values: PaymentFormValues = {
    rail: 'bank_transfer',
    amount: '1000',
    receivedDate: '2026-08-12',
    bankReference: 'CTBC-1',
    payerNote: '',
    requestId: STAMP.requestId,
    cashReceivedAt: STAMP.cashReceivedAt,
  };
  actionMock.mockResolvedValue(paymentFailure(code, values));
  fireEvent.click(checkbox(container));
  fireEvent.submit(container.querySelector('form')!);
  return await waitFor(() => {
    const button = container.querySelector('button[type="button"]');
    if (button === null) throw new Error('「開始下一筆」鈕還沒出現');
    return button.textContent ?? '';
  });
}
