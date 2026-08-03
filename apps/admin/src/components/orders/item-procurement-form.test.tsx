// @vitest-environment jsdom
// 🔴 釘非 UTC 時區(同 note-compose-form.test.tsx:2-4 的理由):CI 是 UTC,
//    「把 local 當 UTC 解析」的突變在 UTC 下兩邊同錯相消、恆真;釘 Asia/Taipei 才量得到。
process.env.TZ = 'Asia/Taipei';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AdminOrderItemProcurement } from '@pcm/domain';
import {
  procurementFailure,
  PROC_SUBMITTED_AT_FIELD,
  PROC_STALE_FIELD,
  PROC_HYDRATED_FIELD,
  type ProcurementActionState,
} from '../../lib/orders/procurement-action-state';

// 🔴 mock 掉 server action 模組(transitively 拉 next/cache 與 session,jsdom 載不了);
//    action 的語意層在 procurement-actions.test.ts 測過,這裡只測表單接線。
const actionMock =
  vi.fn<(prev: ProcurementActionState, form: FormData) => Promise<ProcurementActionState>>();
// `useRouter` 需要 app router context;jsdom 沒有 ⇒ mock 成只記呼叫的假 router
const routerRefresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: routerRefresh }) }));

vi.mock('../../lib/orders/procurement-actions', () => ({
  upsertItemProcurementAction: (prev: ProcurementActionState, form: FormData) =>
    actionMock(prev, form),
}));

import { ItemProcurementForm } from './item-procurement-form';

const ORDER = '11111111-1111-4111-8111-111111111111';
const ITEM = '22222222-2222-4222-8222-222222222222';
const SUP_A = '33333333-3333-4333-8333-333333333333';
const SUP_B = '44444444-4444-4444-8444-444444444444';

function proc(over: Partial<AdminOrderItemProcurement> = {}): AdminOrderItemProcurement {
  return {
    id: 'p-1',
    supplierId: SUP_A,
    supplierLabel: 'RPM Carbon',
    supplierIsActive: true,
    allocatedQuantity: 3,
    receivedQuantity: 1,
    replyStatus: 'partial',
    contactChannel: 'LINE',
    submittedAt: '2026-08-04T06:30:00.000Z', // = 台北 14:30
    supplierOrderNo: 'SO-123',
    exceptionReason: '原廠缺料',
    expectedArrivalDate: '2026-09-30',
    firstOrderedAt: null,
    statusChangedAt: null,
    createdAt: '2026-08-04T02:00:00+00:00',
    ...over,
  };
}

const CHOICES = [
  { id: SUP_A, label: 'RPM Carbon', inactive: false },
  { id: SUP_B, label: 'Webike JP', inactive: true },
];

function setup(over: Partial<Parameters<typeof ItemProcurementForm>[0]> = {}) {
  return render(
    <ItemProcurementForm
      orderId={ORDER}
      orderItemId={ITEM}
      procurements={[proc()]}
      supplierChoices={CHOICES}
      truncated={false}
      {...over}
    />,
  );
}

beforeEach(() => {
  actionMock.mockReset();
  actionMock.mockResolvedValue({ status: 'idle' });
});
afterEach(() => {
  cleanup();
});

describe('ItemProcurementForm — 選供應商即 hydrate(全量 payload 的承重)', () => {
  it('選到既有採購的供應商 → 整份表單填成那一列的值', () => {
    const { container } = setup();
    const select = container.querySelector<HTMLSelectElement>('select[name="supplier_id"]')!;
    fireEvent.change(select, { target: { value: SUP_A } });

    expect(container.querySelector<HTMLInputElement>('input[name="allocated_quantity"]')!.value).toBe('3');
    expect(container.querySelector<HTMLInputElement>('input[name="contact_channel"]')!.value).toBe('LINE');
    expect(container.querySelector<HTMLInputElement>('input[name="supplier_order_no"]')!.value).toBe('SO-123');
    expect(container.querySelector<HTMLTextAreaElement>('textarea[name="exception_reason"]')!.value).toBe('原廠缺料');
    expect(container.querySelector<HTMLInputElement>('input[name="expected_arrival_date"]')!.value).toBe('2026-09-30');
    const partial = container.querySelector<HTMLInputElement>('input[name="reply_status"][value="partial"]')!;
    expect(partial.checked).toBe(true);
  });

  // 🔴 這條就是 A10a-3 那個坑的本片版本:UTC 06:30 = 台北 14:30,
  //    切 ISO 字串的寫法會顯示成 06:30(少 8 小時)。
  it('送出時間顯示成**本地**時間(台北 14:30),不是 ISO 的 UTC 字面', () => {
    const { container } = setup();
    fireEvent.change(container.querySelector('select[name="supplier_id"]')!, {
      target: { value: SUP_A },
    });
    expect(
      container.querySelector<HTMLInputElement>('input[name="submitted_at_local"]')!.value,
    ).toBe('2026-08-04T14:30');
  });

  // 🔴 量**真的送出去的那份 FormData**,不是畫面上的 hidden 欄(關卡2 codex MF4 之後,
  //    hidden 值由 action wrapper 在送出當下設,畫面上根本沒有那個節點)。
  it('送出的 FormData 帶的是帶偏移的 ISO,且與可見欄同一時刻', async () => {
    const { container } = setup();
    fireEvent.change(container.querySelector('select[name="supplier_id"]')!, {
      target: { value: SUP_A },
    });
    await act(async () => {
      fireEvent.submit(container.querySelector('form')!);
    });
    const sent = actionMock.mock.calls[0]![1];
    // 🔴 送出的是**無偏移的台北牆上時間**(偏移由 server 補;A5a :475-476)
    expect(sent.get(PROC_SUBMITTED_AT_FIELD)).toBe('2026-08-04T14:30:00');
  });

  // 🔴 關卡2 codex MF3:`datetime-local` 只到分鐘 ⇒ 既有 `14:30:45` 回填成 `14:30`、
  //    再換算就變 `14:30:00`,而 A5a 是全量 payload ⇒ **只改別的欄位也會把秒靜默改掉**。
  //    沒動過送出時間時要原樣送回 hydrate 當下那個 ISO。
  it('只改別的欄位時,既有 submitted_at 的**秒不會被吃掉**', async () => {
    const withSeconds = '2026-08-04T06:30:45.123Z';
    const { container } = setup({ procurements: [proc({ submittedAt: withSeconds })] });
    fireEvent.change(container.querySelector('select[name="supplier_id"]')!, {
      target: { value: SUP_A },
    });
    // 只改異常原因,完全不碰送出時間
    fireEvent.change(container.querySelector('textarea[name="exception_reason"]')!, {
      target: { value: '改了別的欄位' },
    });
    await act(async () => {
      fireEvent.submit(container.querySelector('form')!);
    });
    const sent = actionMock.mock.calls[0]![1];
    // 秒保留:送回帶秒的台北牆上時間(UTC 06:30:45 = 台北 14:30:45)
    expect(sent.get(PROC_SUBMITTED_AT_FIELD)).toBe('2026-08-04T14:30:45');
  });

  it('真的改了送出時間 → 送新值(不是死抱原始 ISO)', async () => {
    const withSeconds = '2026-08-04T06:30:45.123Z';
    const { container } = setup({ procurements: [proc({ submittedAt: withSeconds })] });
    fireEvent.change(container.querySelector('select[name="supplier_id"]')!, {
      target: { value: SUP_A },
    });
    fireEvent.change(container.querySelector('input[name="submitted_at_local"]')!, {
      target: { value: '2026-08-05T09:00' },
    });
    await act(async () => {
      fireEvent.submit(container.querySelector('form')!);
    });
    const sent = actionMock.mock.calls[0]![1];
    expect(sent.get(PROC_SUBMITTED_AT_FIELD)).toBe('2026-08-05T09:00');
  });

  it('切換到還沒有採購的供應商 → 整份清空(不留上一筆的值)', () => {
    const { container } = setup();
    const select = container.querySelector<HTMLSelectElement>('select[name="supplier_id"]')!;
    fireEvent.change(select, { target: { value: SUP_A } });
    fireEvent.change(select, { target: { value: SUP_B } });
    expect(container.querySelector<HTMLInputElement>('input[name="allocated_quantity"]')!.value).toBe('');
    expect(container.querySelector<HTMLInputElement>('input[name="supplier_order_no"]')!.value).toBe('');
    expect(container.querySelector<HTMLTextAreaElement>('textarea[name="exception_reason"]')!.value).toBe('');
  });
});

describe('ItemProcurementForm — 停用供應商', () => {
  it('停用的仍在選單、標記「已停用」', () => {
    const { container } = setup();
    const options = [...container.querySelectorAll('option')].map((o) => o.textContent);
    expect(options).toContain('Webike JP(已停用)');
  });

  it('選到停用的 → 顯示「可以更新紀錄欄、不能新建或調高數量」的提示', () => {
    const { container, getByText } = setup();
    fireEvent.change(container.querySelector('select[name="supplier_id"]')!, {
      target: { value: SUP_B },
    });
    expect(getByText(/不能新建採購/)).toBeTruthy();
  });
});

describe('ItemProcurementForm — 截斷時拒送(A9a-2 MF1 的下游義務)', () => {
  it('truncated → 沒有送出鈕、欄位 disabled、hidden stale=1', () => {
    const { container } = setup({ truncated: true });
    expect(container.querySelector('button[type="submit"]')).toBeNull();
    expect(container.querySelector('fieldset')!.disabled).toBe(true);
    expect(
      container.querySelector<HTMLInputElement>(`input[name="${PROC_STALE_FIELD}"]`)!.value,
    ).toBe('1');
  });

  it('未截斷 → 有送出鈕、stale=0', () => {
    const { container } = setup({ truncated: false });
    expect(container.querySelector('button[type="submit"]')).not.toBeNull();
    expect(
      container.querySelector<HTMLInputElement>(`input[name="${PROC_STALE_FIELD}"]`)!.value,
    ).toBe('0');
  });
});

describe('ItemProcurementForm — 失敗 state 只作用在自己那份表單', () => {
  // 🔴 一張單多個品項共用同一支 action:不比對 orderItemId 的話,
  //    A 品項的錯誤會顯示在 B 品項的表單上(員工會去改沒有問題的那一筆)。
  //    ⚠️ 這兩條要**真的送出**才測得到 —— 直接造一個 failed 物件當 prop 是量不到 `failedHere` 的
  //       (useActionState 的 state 只能由 action 回傳產生)。
  const VALUES = {
    supplierId: SUP_B,
    allocatedQuantity: '99',
    replyStatus: 'no_reply',
    contactChannel: '別人的',
    submittedAtLocal: '',
    supplierOrderNo: '',
    exceptionReason: '',
    expectedArrivalDate: '',
  };

  it('失敗屬於**本品項** → 顯示錯誤訊息', async () => {
    actionMock.mockResolvedValue(procurementFailure('OVER_ALLOCATION', ITEM, VALUES));
    const { container, findByRole } = setup();
    fireEvent.submit(container.querySelector('form')!);
    const alert = await findByRole('alert');
    expect(alert.textContent).toContain('超過可訂購數量');
  });

  it('失敗屬於**別的品項** → 本表單不顯示錯誤、且欄位值不被別人的 values 蓋掉', async () => {
    actionMock.mockResolvedValue(procurementFailure('OVER_ALLOCATION', 'other-item-id', VALUES));
    const { container } = setup();
    // 先把本表單填成可辨識的狀態(選 SUP_A ⇒ allocated=3),否則「沒被蓋掉」與「本來就空」分不開
    fireEvent.change(container.querySelector('select[name="supplier_id"]')!, {
      target: { value: SUP_A },
    });
    expect(container.querySelector<HTMLInputElement>('input[name="allocated_quantity"]')!.value).toBe('3');

    // 🔴 用 `act` 把 action promise 與後續 effect **一次 flush 完**再斷言。
    //    只用 `waitFor(actionMock 被呼叫)` 的話,斷言會跑在 state 更新之前 ⇒
    //    「套值 effect 不比對 orderItemId」那個突變照樣全綠(施工當場的 N25 就這樣活下來)。
    await act(async () => {
      fireEvent.submit(container.querySelector('form')!);
    });

    expect(actionMock).toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector<HTMLInputElement>('input[name="allocated_quantity"]')!.value).toBe('3');
    expect(container.querySelector<HTMLInputElement>('input[name="contact_channel"]')!.value).toBe('LINE');
    expect(container.querySelector<HTMLSelectElement>('select[name="supplier_id"]')!.value).toBe(SUP_A);
  });
});

describe('ItemProcurementForm — 送出鈕字面隨新建/編輯切換', () => {
  it('選到既有 → 「更新這筆採購」;選到新的 → 「新增採購」', () => {
    const { container } = setup();
    const select = container.querySelector<HTMLSelectElement>('select[name="supplier_id"]')!;
    fireEvent.change(select, { target: { value: SUP_A } });
    expect(container.querySelector('button[type="submit"]')!.textContent).toContain('更新');
    fireEvent.change(select, { target: { value: SUP_B } });
    expect(container.querySelector('button[type="submit"]')!.textContent).toContain('新增');
  });
});

describe('ItemProcurementForm — hydration 閘(關卡2 Critical)', () => {
  // 🔴 掛載後才給送。React 19 的 form action 在 hydration 前就送得出去,
  //    那一刻選填欄全空 ⇒ 全量 payload 把既有事實清成 NULL。
  it('掛載後 hidden 旗標 = 1、送出鈕可按', () => {
    const { container } = setup();
    expect(
      container.querySelector<HTMLInputElement>(`input[name="${PROC_HYDRATED_FIELD}"]`)!.value,
    ).toBe('1');
    const btn = container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(btn.disabled).toBe(false);
  });

  it('掛載後應該是 submit 鈕、不是 type=button 的佔位', () => {
    const { container } = setup();
    expect(container.querySelector('button[type="button"][disabled]')).toBeNull();
    expect(container.querySelector('button[type="submit"]')).not.toBeNull();
  });

  // 🔴🔴 **這條才是承重**:pre-hydration 使用者送出的是**伺服器產的那份 HTML**。
  //    只驗「掛載後 = 1」的話,把旗標寫死成 '1' 照樣全綠(施工當場的突變 N23 就活下來了)。
  //    ⇒ 用 server render 直接看那份 HTML。
  it('🔴 server render 的 HTML:旗標 = 0、且**沒有** submit 鈕', () => {
    const html = renderToStaticMarkup(
      <ItemProcurementForm
        orderId={ORDER}
        orderItemId={ITEM}
        procurements={[proc()]}
        supplierChoices={CHOICES}
        truncated={false}
      />,
    );
    expect(html).toContain(`name="${PROC_HYDRATED_FIELD}" value="0"`);
    expect(html).not.toContain('type="submit"');
    expect(html).toContain('載入中');
  });
});

describe('ItemProcurementForm — 失敗回來的值真的進畫面(關卡2 finding 2)', () => {
  // 🔴 `useState` 初值只在首次掛載求值 ⇒ 只寫 useState(carried ?? …) 的話
  //    state.values 永遠不會被任何 render 消費 =「保留輸入」是空頭支票。
  it('本品項失敗 → 欄位被 state.values 覆寫(不是靠受控 state 剛好活著)', async () => {
    actionMock.mockResolvedValue(
      procurementFailure('OVER_ALLOCATION', ITEM, {
        supplierId: SUP_A,
        allocatedQuantity: '77',
        replyStatus: 'out_of_stock',
        contactChannel: '電話',
        submittedAtLocal: '2026-08-05T09:00',
        supplierOrderNo: 'SO-CARRIED',
        exceptionReason: '帶回來的原因',
        expectedArrivalDate: '2026-10-01',
      }),
    );
    const { container } = setup();
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => {
      expect(
        container.querySelector<HTMLInputElement>('input[name="allocated_quantity"]')!.value,
      ).toBe('77');
    });
    expect(container.querySelector<HTMLInputElement>('input[name="supplier_order_no"]')!.value).toBe('SO-CARRIED');
    expect(container.querySelector<HTMLTextAreaElement>('textarea[name="exception_reason"]')!.value).toBe('帶回來的原因');
    expect(container.querySelector<HTMLInputElement>('input[name="expected_arrival_date"]')!.value).toBe('2026-10-01');
    expect(container.querySelector<HTMLInputElement>('input[name="submitted_at_local"]')!.value).toBe('2026-08-05T09:00');
    expect(container.querySelector<HTMLSelectElement>('select[name="supplier_id"]')!.value).toBe(SUP_A);
  });
});

describe('ItemProcurementForm — bfcache 還原要重取(關卡2 finding 3)', () => {
  // 🔴 A5a 無 version/CAS ⇒「全欄 hydrate 自最新列」的「最新」只到頁面載入那一刻;
  //    返回鍵還原會拿到更舊的快照 ⇒ 用更舊的值做全量 payload = 覆蓋別人的更新。
  //    這只縮小窗口、不消滅它(誠實邊界寫在 handoff)。
  it('pageshow persisted=true → router.refresh()', () => {
    setup();
    routerRefresh.mockClear();
    const event = new Event('pageshow') as PageTransitionEvent;
    Object.defineProperty(event, 'persisted', { value: true });
    window.dispatchEvent(event);
    expect(routerRefresh).toHaveBeenCalledTimes(1);
  });

  it('pageshow persisted=false(一般載入)→ 不重取(免得每次進頁面都多打一次)', () => {
    setup();
    routerRefresh.mockClear();
    const event = new Event('pageshow') as PageTransitionEvent;
    Object.defineProperty(event, 'persisted', { value: false });
    window.dispatchEvent(event);
    expect(routerRefresh).not.toHaveBeenCalled();
  });
});

describe('ItemProcurementForm — denied 這類全域失敗要看得到(關卡2 codex MF6)', () => {
  // 🔴 `denied` 拿不到品項 id(授權閘在讀任何欄位之前)⇒ 嚴格比對 orderItemId 的話
  //    **每一張表單都不顯示** ⇒ 員工按下去像沒反應,而其實是 session 失效了。
  it('orderItemId 為 null 的失敗 → 本表單照樣顯示訊息', async () => {
    actionMock.mockResolvedValue(
      procurementFailure('denied', null, {
        supplierId: '',
        allocatedQuantity: '',
        replyStatus: '',
        contactChannel: '',
        submittedAtLocal: '',
        supplierOrderNo: '',
        exceptionReason: '',
        expectedArrivalDate: '',
      }),
    );
    const { container, findByRole } = setup();
    fireEvent.change(container.querySelector('select[name="supplier_id"]')!, {
      target: { value: SUP_A },
    });
    fireEvent.submit(container.querySelector('form')!);
    const alert = await findByRole('alert');
    expect(alert.textContent).toContain('登入狀態已失效');
  });

  // 🔴 但**值**不能被 denied 帶回的空值灌進畫面(顯示條件與套值條件刻意不同)
  it('denied 不清掉員工已經填好的欄位', async () => {
    actionMock.mockResolvedValue(
      procurementFailure('denied', null, {
        supplierId: '',
        allocatedQuantity: '',
        replyStatus: '',
        contactChannel: '',
        submittedAtLocal: '',
        supplierOrderNo: '',
        exceptionReason: '',
        expectedArrivalDate: '',
      }),
    );
    const { container } = setup();
    fireEvent.change(container.querySelector('select[name="supplier_id"]')!, {
      target: { value: SUP_A },
    });
    await act(async () => {
      fireEvent.submit(container.querySelector('form')!);
    });
    expect(
      container.querySelector<HTMLInputElement>('input[name="allocated_quantity"]')!.value,
    ).toBe('3');
    expect(container.querySelector<HTMLSelectElement>('select[name="supplier_id"]')!.value).toBe(SUP_A);
  });
});

describe('ItemProcurementForm — 送出值取自真正的 FormData(關卡2 codex MF4)', () => {
  // 🔴 這條要**繞過 React** 改 DOM 才有判別力:瀏覽器自動填 / 表單還原就是這樣改值的
  //    (不觸發 React 的 onChange)。用 state 算 hidden 的寫法在這裡會送出**舊值**;
  //    讀送出的那份 FormData 才會送新值。
  //    (施工當場的突變 N29 原本活下來,就是因為測試都用 fireEvent.change ⇒ state 與 DOM 恆同步。)
  it('DOM 被直接改掉(未觸發 onChange)→ 送出的仍是 DOM 上那個值', async () => {
    const { container } = setup();
    fireEvent.change(container.querySelector('select[name="supplier_id"]')!, {
      target: { value: SUP_A },
    });
    const local = container.querySelector<HTMLInputElement>('input[name="submitted_at_local"]')!;
    // 繞過 React:直接寫 DOM value
    local.value = '2026-12-25T08:15';
    await act(async () => {
      fireEvent.submit(container.querySelector('form')!);
    });
    const sent = actionMock.mock.calls[0]![1];
    expect(sent.get(PROC_SUBMITTED_AT_FIELD)).toBe('2026-12-25T08:15');
  });
});

describe('ItemProcurementForm — bfcache 還原要連狀態一起清(關卡2 codex MF1)', () => {
  // 🔴 只 refresh 不夠:server component 重繪帶來新的 procurements,但本元件 state 不會跟著重建
  //    ⇒ 員工手上仍是還原前的舊快照,照送就是用舊值覆蓋新資料。
  //    (突變 N31「只 refresh 不清狀態」原本活下來,因為測試只驗 refresh 被呼叫。)
  it('pageshow persisted → 表單選擇與欄位一起清空(逼員工重新 hydrate)', () => {
    const { container } = setup();
    fireEvent.change(container.querySelector('select[name="supplier_id"]')!, {
      target: { value: SUP_A },
    });
    expect(container.querySelector<HTMLInputElement>('input[name="allocated_quantity"]')!.value).toBe('3');

    const event = new Event('pageshow') as PageTransitionEvent;
    Object.defineProperty(event, 'persisted', { value: true });
    act(() => {
      window.dispatchEvent(event);
    });

    expect(container.querySelector<HTMLSelectElement>('select[name="supplier_id"]')!.value).toBe('');
    expect(container.querySelector<HTMLInputElement>('input[name="allocated_quantity"]')!.value).toBe('');
    expect(container.querySelector<HTMLInputElement>('input[name="supplier_order_no"]')!.value).toBe('');
  });
});

describe('ItemProcurementForm — 送出中要鎖欄位(關卡2 codex R2 MF5)', () => {
  // 🔴 送出後才改的內容**不在那份 FormData 裡**:成功會跳頁、失敗會把 state.values 套回來,
  //    兩條路都讓他剛打的東西靜默消失 ⇒ pending 期間整組欄位鎖住。
  it('pending 期間 fieldset disabled、送出鈕也停用', async () => {
    let release: (v: ProcurementActionState) => void = () => {};
    actionMock.mockImplementation(
      () => new Promise<ProcurementActionState>((resolve) => { release = resolve; }),
    );
    const { container } = setup();
    fireEvent.change(container.querySelector('select[name="supplier_id"]')!, {
      target: { value: SUP_A },
    });
    await act(async () => {
      fireEvent.submit(container.querySelector('form')!);
    });
    expect(container.querySelector('fieldset')!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    await act(async () => {
      release({ status: 'idle' });
    });
    expect(container.querySelector('fieldset')!.disabled).toBe(false);
  });
});
