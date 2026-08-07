import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  authorizeAdminMutation: vi.fn(),
  getRequestId: vi.fn(),
  upsertItemProcurement: vi.fn(),
  findOrderIdForItem: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('../session/authorize', () => ({
  authorizeAdminMutation: mocks.authorizeAdminMutation,
}));
vi.mock('../audit/context', () => ({ getRequestId: mocks.getRequestId }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@pcm/adapters/server', () => ({ createSupabaseServiceClient: vi.fn() }));

// 🔴 只換掉寫入函式,`ProcurementCallerBugError` 用真的那一個(自己造假 class 的話,
//    「bug 與 error 分得開」就變成自我實現;同 note-actions.test.ts:22-23 的理由)。
vi.mock('./procurement-repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./procurement-repository')>();
  return {
    ...actual,
    upsertItemProcurement: mocks.upsertItemProcurement,
    findOrderIdForItem: mocks.findOrderIdForItem,
  };
});

// 🔴 解析器**刻意不 mock** —— 餵真 FormData 走真解析器,否則「爛表單擋得住」是恆真斷言。
import { upsertItemProcurementAction } from './procurement-actions';
import { ProcurementCallerBugError, PROCUREMENT_RESULT_CODES } from './procurement-repository';
import {
  PROCUREMENT_CREATED_RESULT_CODE,
  PROCUREMENT_NO_CHANGE_RESULT_CODE,
  PROCUREMENT_UPDATED_RESULT_CODE,
  PROC_ALLOCATED_FIELD,
  PROC_CONTACT_CHANNEL_FIELD,
  PROC_EXCEPTION_REASON_FIELD,
  PROC_EXPECTED_ARRIVAL_FIELD,
  PROC_HYDRATED_FIELD,
  PROC_ORDER_ID_FIELD,
  PROC_ORDER_ITEM_ID_FIELD,
  PROC_REPLY_STATUS_FIELD,
  PROC_STALE_FIELD,
  PROC_SUBMITTED_AT_FIELD,
  PROC_SUBMITTED_AT_LOCAL_FIELD,
  PROC_SUPPLIER_ID_FIELD,
  PROC_SUPPLIER_ORDER_NO_FIELD,
  type ProcurementActionState,
} from './procurement-action-state';

const ORDER = '11111111-1111-4111-8111-111111111111';
const ITEM = '22222222-2222-4222-8222-222222222222';
const SUPPLIER = '33333333-3333-4333-8333-333333333333';
const IDLE: ProcurementActionState = { status: 'idle' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorizeAdminMutation.mockResolvedValue({ sid: 'sid-1', actorId: 'sean' });
  mocks.getRequestId.mockResolvedValue('req-http-1');
  mocks.upsertItemProcurement.mockResolvedValue('CREATED');
  mocks.findOrderIdForItem.mockResolvedValue(ORDER);
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

function fd(over: Record<string, string> = {}): FormData {
  const f = new FormData();
  const base: Record<string, string> = {
    [PROC_ORDER_ID_FIELD]: ORDER,
    [PROC_ORDER_ITEM_ID_FIELD]: ITEM,
    [PROC_SUPPLIER_ID_FIELD]: SUPPLIER,
    [PROC_ALLOCATED_FIELD]: '2',
    [PROC_REPLY_STATUS_FIELD]: 'confirmed',
    [PROC_STALE_FIELD]: '0',
    [PROC_HYDRATED_FIELD]: '1',
    // 🔴 五個選填欄**一定要送**(即使空白)—— 真實表單就是這樣送的;
    //    整個鍵不存在 = 繞過畫面的呼叫,解析器會擋(關卡2 codex R2 MF3)。
    [PROC_CONTACT_CHANNEL_FIELD]: '',
    [PROC_SUBMITTED_AT_FIELD]: '',
    [PROC_SUPPLIER_ORDER_NO_FIELD]: '',
    [PROC_EXCEPTION_REASON_FIELD]: '',
    [PROC_EXPECTED_ARRIVAL_FIELD]: '',
    ...over,
  };
  for (const [k, v] of Object.entries(base)) f.set(k, v);
  return f;
}

describe('upsertItemProcurementAction — 授權閘絕對第一', () => {
  it('未授權 → denied,且**完全不碰**解析器與 RPC', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    // 爛到解析器一定擋得住的表單:未授權者要拿到 denied,不是 invalid
    const state = await upsertItemProcurementAction(IDLE, fd({ [PROC_SUPPLIER_ID_FIELD]: 'x' }));
    expect(state.status === 'failed' && state.code).toBe('denied');
    expect(mocks.upsertItemProcurement).not.toHaveBeenCalled();
  });

  it('denied 不保留輸入(拿不到值就回不了;A9d2-1 同一條刻意取捨)', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    const state = await upsertItemProcurementAction(
      IDLE,
      fd({ [PROC_SUPPLIER_ORDER_NO_FIELD]: 'SO-999' }),
    );
    expect(state.status === 'failed' && state.values.supplierOrderNo).toBe('');
  });
});

describe('upsertItemProcurementAction — hydration 閘(關卡2 Critical)', () => {
  // 🔴 React 19 的 form action 在 hydration 前就送得出去,那一刻選填欄全空 ⇒
  //    全量 payload 把單號/異常原因/預計到貨/送出時間/管道全部靜默清成 NULL。
  it.each([
    ['旗標為 0', '0'],
    ['旗標為空', ''],
    ['旗標亂填', 'yes'],
  ])('%s → not_hydrated、**不打 RPC**', async (_label, raw) => {
    const state = await upsertItemProcurementAction(IDLE, fd({ [PROC_HYDRATED_FIELD]: raw }));
    expect(state.status === 'failed' && state.code).toBe('not_hydrated');
    expect(mocks.upsertItemProcurement).not.toHaveBeenCalled();
  });

  // fail-closed:舊快取的 HTML / 直接打 action 都不會帶這個欄位
  it('完全沒帶旗標 → 一樣擋(fail-closed,不是只擋明確的 0)', async () => {
    const f = fd();
    f.delete(PROC_HYDRATED_FIELD);
    const state = await upsertItemProcurementAction(IDLE, f);
    expect(state.status === 'failed' && state.code).toBe('not_hydrated');
    expect(mocks.upsertItemProcurement).not.toHaveBeenCalled();
  });

  // 🔴 順序:未 hydrate 時連「這個品項是不是被截斷」都還沒被畫面算出來 ⇒ hydration 閘要在前面
  it('同時未 hydrate 且 stale → 回 not_hydrated(閘序:hydration 在截斷之前)', async () => {
    const state = await upsertItemProcurementAction(
      IDLE,
      fd({ [PROC_HYDRATED_FIELD]: '0', [PROC_STALE_FIELD]: '1' }),
    );
    expect(state.status === 'failed' && state.code).toBe('not_hydrated');
  });

  it('未授權且未 hydrate → 仍回 denied(授權閘永遠最前面)', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    const state = await upsertItemProcurementAction(IDLE, fd({ [PROC_HYDRATED_FIELD]: '0' }));
    expect(state.status === 'failed' && state.code).toBe('denied');
  });
});

describe('upsertItemProcurementAction — 截斷閘(A9a-2 MF1 的下游義務)', () => {
  // 🔴 A5a 是全量 payload:清單不完整 ⇒ hydrate 不可信 ⇒ 照送 = 用不完整內容覆蓋既有事實。
  it('stale=1 → 回 stale、**不打 RPC**', async () => {
    const state = await upsertItemProcurementAction(IDLE, fd({ [PROC_STALE_FIELD]: '1' }));
    expect(state.status === 'failed' && state.code).toBe('stale');
    expect(mocks.upsertItemProcurement).not.toHaveBeenCalled();
  });

  it('stale=1 時仍帶回 orderItemId 與輸入(錯誤要顯示在對的那份表單上)', async () => {
    const state = await upsertItemProcurementAction(
      IDLE,
      fd({ [PROC_STALE_FIELD]: '1', [PROC_EXCEPTION_REASON_FIELD]: '原廠缺料' }),
    );
    expect(state.status === 'failed' && state.orderItemId).toBe(ITEM);
    expect(state.status === 'failed' && state.values.exceptionReason).toBe('原廠缺料');
  });

  // 🔴 只有字面 '1' 算截斷 —— 不得寫成 truthy 判斷,否則 '0' 也會被當成截斷、表單整個送不出去。
  it.each(['0', '', 'true', 'yes'])('stale=%s → 照常送出(只有 "1" 算截斷)', async (raw) => {
    const state = await upsertItemProcurementAction(IDLE, fd({ [PROC_STALE_FIELD]: raw }));
    expect(state).toBeUndefined(); // 成功走 redirect(mock 不拋)
    expect(mocks.upsertItemProcurement).toHaveBeenCalledTimes(1);
  });

  it('截斷閘排在解析**之前**:表單同時 stale 且爛 → 回 stale 而不是 invalid', async () => {
    const state = await upsertItemProcurementAction(
      IDLE,
      fd({ [PROC_STALE_FIELD]: '1', [PROC_ALLOCATED_FIELD]: 'abc' }),
    );
    expect(state.status === 'failed' && state.code).toBe('stale');
  });
});

describe('upsertItemProcurementAction — 三個成功碼各自的 PRG', () => {
  it.each([
    ['CREATED', PROCUREMENT_CREATED_RESULT_CODE],
    ['UPDATED', PROCUREMENT_UPDATED_RESULT_CODE],
    ['NO_CHANGE', PROCUREMENT_NO_CHANGE_RESULT_CODE],
  ])('%s → redirect 帶 %s', async (rpcCode, resultCode) => {
    mocks.upsertItemProcurement.mockResolvedValue(rpcCode);
    await upsertItemProcurementAction(IDLE, fd());
    expect(mocks.redirect).toHaveBeenCalledWith(`/orders/${ORDER}?r=${resultCode}`);
  });

  // 🔴 三個成功碼**不共用一則訊息**:NO_CHANGE 是零寫入,跟「已更新」說同一句話會讓員工
  //    以為改成功了而不再檢查。這條釘住「三個 redirect 目標互異」。
  it('三個成功碼的 redirect 目標互異', () => {
    const set = new Set([
      PROCUREMENT_CREATED_RESULT_CODE,
      PROCUREMENT_UPDATED_RESULT_CODE,
      PROCUREMENT_NO_CHANGE_RESULT_CODE,
    ]);
    expect(set.size).toBe(3);
  });

  it('成功一定先 revalidate 再 redirect(不重取的話員工看不到剛寫的採購)', async () => {
    await upsertItemProcurementAction(IDLE, fd());
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/orders/${ORDER}`);
  });
});

describe('upsertItemProcurementAction — 14 個失敗碼逐碼回 state', () => {
  const failures = PROCUREMENT_RESULT_CODES.filter(
    (c) => c !== 'CREATED' && c !== 'UPDATED' && c !== 'NO_CHANGE',
  );

  it('失敗碼恰 14 個(17 − 3 成功)', () => {
    expect(failures).toHaveLength(14);
  });

  it.each(failures)('%s → 回 state、不 redirect、訊息非空', async (code) => {
    mocks.upsertItemProcurement.mockResolvedValue(code);
    const state = await upsertItemProcurementAction(IDLE, fd());
    expect(state.status).toBe('failed');
    expect(state.status === 'failed' && state.code).toBe(code);
    expect(state.status === 'failed' && state.message).not.toBe('');
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  // 🔴 SUPPLIER_INACTIVE 是**可改輸入型**、不是 bug —— 停用是合法業務狀態
  //    (Sean 08-03 晚 Q1=A),訊息要說得出「哪些還能改」。
  it('SUPPLIER_INACTIVE 的訊息要說明「紀錄欄仍可更新」', async () => {
    mocks.upsertItemProcurement.mockResolvedValue('SUPPLIER_INACTIVE');
    const state = await upsertItemProcurementAction(IDLE, fd());
    expect(state.status === 'failed' && state.message).toContain('紀錄欄');
  });

  it('失敗時原樣帶回員工輸入(含 datetime 的**本地**字面,不是換算後的 ISO)', async () => {
    mocks.upsertItemProcurement.mockResolvedValue('OVER_ALLOCATION');
    const state = await upsertItemProcurementAction(
      IDLE,
      fd({
        [PROC_ALLOCATED_FIELD]: '9',
        [PROC_CONTACT_CHANNEL_FIELD]: 'LINE',
        [PROC_SUBMITTED_AT_LOCAL_FIELD]: '2026-08-04T14:30',
        [PROC_SUBMITTED_AT_FIELD]: '2026-08-04T06:30:00.000Z',
        [PROC_EXPECTED_ARRIVAL_FIELD]: '2026-09-30',
      }),
    );
    expect(state.status === 'failed' && state.values).toMatchObject({
      allocatedQuantity: '9',
      contactChannel: 'LINE',
      // 🔴 帶 ISO 回去 datetime-local 會顯示空白 = 「保留輸入」變成空宣稱
      submittedAtLocal: '2026-08-04T14:30',
      expectedArrivalDate: '2026-09-30',
    });
  });
});

describe('upsertItemProcurementAction — throw 面', () => {
  it('CallerBugError → bug(叫他停手)', async () => {
    mocks.upsertItemProcurement.mockRejectedValue(new ProcurementCallerBugError('壞了'));
    const state = await upsertItemProcurementAction(IDLE, fd());
    expect(state.status === 'failed' && state.code).toBe('bug');
  });

  it('一般錯誤 → error(可能已寫入,叫他重新整理確認)', async () => {
    mocks.upsertItemProcurement.mockRejectedValue({ code: '08006', message: 'boom' });
    const state = await upsertItemProcurementAction(IDLE, fd());
    expect(state.status === 'failed' && state.code).toBe('error');
    expect(state.status === 'failed' && state.message).toContain('可能');
  });

  // 🔴 bug / error 兩支都**可能已經 commit**(回應斷在路上)⇒ 不 revalidate 的話
  //    員工停在看不到那筆採購的舊畫面,會再送一次。
  it.each([
    ['CallerBugError', new ProcurementCallerBugError('壞了')],
    ['一般錯誤', { code: '08006', message: 'boom' }],
  ])('%s 也要 revalidate(可能已經寫進去了)', async (_label, err) => {
    mocks.upsertItemProcurement.mockRejectedValue(err);
    await upsertItemProcurementAction(IDLE, fd());
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/orders/${ORDER}`);
  });
});

describe('upsertItemProcurementAction — 解析與 log', () => {
  it('爛表單 → invalid、不打 RPC', async () => {
    const state = await upsertItemProcurementAction(IDLE, fd({ [PROC_ALLOCATED_FIELD]: '1e3' }));
    expect(state.status === 'failed' && state.code).toBe('invalid');
    expect(mocks.upsertItemProcurement).not.toHaveBeenCalled();
  });

  it('🔴 log 不得帶三個文字欄的內容(內部營運資料不進 Vercel log)', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    await upsertItemProcurementAction(
      IDLE,
      fd({
        [PROC_SUPPLIER_ORDER_NO_FIELD]: 'SO-SECRET-123',
        [PROC_EXCEPTION_REASON_FIELD]: '原廠倒閉了',
        [PROC_CONTACT_CHANNEL_FIELD]: 'LINE-群組-機密',
      }),
    );
    const logged = JSON.stringify(infoSpy.mock.calls);
    expect(logged).not.toContain('SO-SECRET-123');
    expect(logged).not.toContain('原廠倒閉了');
    expect(logged).not.toContain('LINE-群組-機密');
    // 但「有沒有填」要看得到(除錯用)
    expect(logged).toContain('has_supplier_order_no');
  });

  it('requestId 用 HTTP x-request-id(A5a 的 request_id 是稽核關聯、不是冪等鍵)', async () => {
    await upsertItemProcurementAction(IDLE, fd());
    expect(mocks.upsertItemProcurement).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'req-http-1', actor: 'sean' }),
    );
  });

  // 🔴 A9h-M(關卡2 F5):明細頁單列表單**有**那四個欄位 ⇒ 必須送 false,員工清空某欄才真的清得掉。
  //    改成 true 會讓「清空」靜默失效、畫面與回傳碼都看不出來 ⇒ 用斷言釘死,不靠註解(機制優先律)。
  it('🔴 單列表單一律送 preserveOptionalFields: false(改成 true = 清空能力靜默失效)', async () => {
    await upsertItemProcurementAction(IDLE, fd());
    expect(mocks.upsertItemProcurement).toHaveBeenCalledWith(
      expect.objectContaining({ preserveOptionalFields: false }),
    );
  });
});

describe('upsertItemProcurementAction — 品項歸屬驗證(關卡2 codex R2 MF4)', () => {
  // 🔴 RPC 只認 order_item_id、order_id 是表單 hidden 欄 ⇒ 不驗就會「從 A 單的表單寫進 B 單的品項」,
  //    而畫面跳回 A 單、A 單還不 revalidate。
  it('品項屬於別張單 → bug、**不打 RPC**', async () => {
    mocks.findOrderIdForItem.mockResolvedValue('99999999-9999-4999-8999-999999999999');
    const state = await upsertItemProcurementAction(IDLE, fd());
    expect(state.status === 'failed' && state.code).toBe('bug');
    expect(mocks.upsertItemProcurement).not.toHaveBeenCalled();
  });

  it('查無該品項 → ORDER_ITEM_NOT_FOUND、不打 RPC', async () => {
    mocks.findOrderIdForItem.mockResolvedValue(null);
    const state = await upsertItemProcurementAction(IDLE, fd());
    expect(state.status === 'failed' && state.code).toBe('ORDER_ITEM_NOT_FOUND');
    expect(mocks.upsertItemProcurement).not.toHaveBeenCalled();
  });

  // fail-closed:查詢自己炸掉也不能放行(不確定歸屬就不寫)
  it('歸屬查詢丟錯 → error、不打 RPC', async () => {
    mocks.findOrderIdForItem.mockRejectedValue(new Error('boom'));
    const state = await upsertItemProcurementAction(IDLE, fd());
    expect(state.status === 'failed' && state.code).toBe('error');
    expect(mocks.upsertItemProcurement).not.toHaveBeenCalled();
  });

  it('歸屬相符 → 照常寫入', async () => {
    await upsertItemProcurementAction(IDLE, fd());
    expect(mocks.upsertItemProcurement).toHaveBeenCalledTimes(1);
  });
});

describe('upsertItemProcurementAction — 偏移由 server 補 Asia/Taipei(A5a :475-476)', () => {
  // 🔴 契約在 A5a 的**函式 COMMENT**裡,不在驗證邏輯裡 —— 我關卡2 就是只讀了邏輯、
  //    沒讀 COMMENT,還拿備註線的相反契約去反駁審查者。
  it('無偏移的台北牆上時間 → 送出 +08:00 的 ISO', async () => {
    await upsertItemProcurementAction(
      IDLE,
      fd({ [PROC_SUBMITTED_AT_FIELD]: '2026-08-04T14:30' }),
    );
    expect(mocks.upsertItemProcurement).toHaveBeenCalledWith(
      expect.objectContaining({ submittedAt: '2026-08-04T14:30:00+08:00' }),
    );
  });

  it('沒填 → null(不是空字串)', async () => {
    await upsertItemProcurementAction(IDLE, fd({ [PROC_SUBMITTED_AT_FIELD]: '' }));
    expect(mocks.upsertItemProcurement).toHaveBeenCalledWith(
      expect.objectContaining({ submittedAt: null }),
    );
  });
});

describe('upsertItemProcurementAction — 選填欄整個沒送就擋(關卡2 codex R2 MF3)', () => {
  // 🔴 直接呼叫 action(繞過畫面)且只帶部分欄位時,缺的欄在全量 payload 下會被寫成 NULL
  //    ⇒ 靜默清掉既有的單號 / 異常原因 / 預計到貨 / 送出時間。
  it.each([
    PROC_SUBMITTED_AT_FIELD,
    PROC_EXPECTED_ARRIVAL_FIELD,
    PROC_CONTACT_CHANNEL_FIELD,
    PROC_SUPPLIER_ORDER_NO_FIELD,
    PROC_EXCEPTION_REASON_FIELD,
  ])('缺 %s → invalid、不打 RPC', async (field) => {
    const f = fd();
    f.delete(field);
    const state = await upsertItemProcurementAction(IDLE, f);
    expect(state.status === 'failed' && state.code).toBe('invalid');
    expect(mocks.upsertItemProcurement).not.toHaveBeenCalled();
  });
});
