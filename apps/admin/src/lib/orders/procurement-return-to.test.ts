import { beforeEach, describe, expect, it, vi } from 'vitest';

// procurement-return-to.test.ts — #350d-3:採購線的 C1 接線 + 契約 §5。
//
// 🔴 採購線同備註線是**混合形**:失敗回 action state(留住員工填的四個欄位)、只有成功走 redirect。

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((..._args: unknown[]): never => {
    throw new Error('NEXT_REDIRECT');
  }),
  revalidatePath: vi.fn(),
  authorizeAdminMutation: vi.fn(),
  upsertItemProcurement: vi.fn(),
  findOrderIdForItem: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('../session/authorize', () => ({ authorizeAdminMutation: mocks.authorizeAdminMutation }));
vi.mock('../audit/context', () => ({ getRequestId: async () => 'req-1' }));
vi.mock('./procurement-repository', () => ({
  upsertItemProcurement: mocks.upsertItemProcurement,
  // 🔴 品項歸屬驗證(關卡2 codex R2 MF4 加的):不給替身的話真的去打 DB ⇒ 一律 error。
  findOrderIdForItem: mocks.findOrderIdForItem,
  // action 用 `instanceof` 分流 ⇒ 替身要給真的 class。
  ProcurementCallerBugError: class ProcurementCallerBugError extends Error {},
}));

import { upsertItemProcurementAction } from './procurement-actions';
import {
  PROCUREMENT_CREATED_RESULT_CODE,
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
  PROC_SUPPLIER_ID_FIELD,
  PROC_SUPPLIER_ORDER_NO_FIELD,
} from './procurement-action-state';
import { ORDER_RETURN_TO_FIELD } from './order-return-to';

const ORDER = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-8888-4777-8666-555555555555';
const ITEM = '3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a';
const SUPPLIER = '7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b';
/**
 * 🔴 刻意夾帶舊的 `r` —— 不夾帶的話「`r` 恰一顆」是恆真。
 * 🔴 用**不同族**的碼(`saved` 是改單線的)—— 同族的話證不出剝的是**鍵**而不是那個值。
 */
const PANEL_VIEW = `/orders?payment_status=paid&panel=${ORDER}&r=saved`;
const PANEL_VIEW_CLEAN = `/orders?payment_status=paid&panel=${ORDER}`;

function form(returnTo: string): FormData {
  const fd = new FormData();
  fd.set(PROC_ORDER_ID_FIELD, ORDER);
  fd.set(PROC_ORDER_ITEM_ID_FIELD, ITEM);
  fd.set(PROC_SUPPLIER_ID_FIELD, SUPPLIER);
  fd.set(PROC_ALLOCATED_FIELD, '2');
  fd.set(PROC_REPLY_STATUS_FIELD, 'no_reply');
  // 🔴 `optionalText` 對「欄位根本不存在」回 `undefined` ⇒ 整份表單 invalid。
  //    真實表單這四欄一定 present(空字串)⇒ fixture 要照著給,否則量到的是「解析失敗」不是導頁。
  fd.set(PROC_CONTACT_CHANNEL_FIELD, '');
  fd.set(PROC_SUBMITTED_AT_FIELD, '');
  fd.set(PROC_SUPPLIER_ORDER_NO_FIELD, '');
  fd.set(PROC_EXCEPTION_REASON_FIELD, '');
  fd.set(PROC_EXPECTED_ARRIVAL_FIELD, '');
  fd.set(PROC_HYDRATED_FIELD, '1');
  fd.set(PROC_STALE_FIELD, '0');
  fd.set(ORDER_RETURN_TO_FIELD, returnTo);
  return fd;
}

async function redirectTarget(returnTo: string): Promise<string> {
  const state = await upsertItemProcurementAction(undefined as never, form(returnTo)).catch(
    (e: unknown) => e,
  );
  // 成功路徑一定 throw NEXT_REDIRECT;若回了 state 就是解析或閘門把它擋下 ⇒ 把碼印出來好除錯。
  expect(mocks.redirect, `action 沒有導頁,回了 ${JSON.stringify(state)}`).toHaveBeenCalledTimes(1);
  return mocks.redirect.mock.calls[0]![0] as string;
}

describe('#350d-3 採購線:成功導回發起的那個視圖', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorizeAdminMutation.mockResolvedValue({ sid: 's1', actorId: 'staff-a' });
    mocks.upsertItemProcurement.mockResolvedValue('CREATED');
    mocks.findOrderIdForItem.mockResolvedValue(ORDER);
  });

  it('🔴 成功:回面板,篩選逐字保留、`r` 恰一顆', async () => {
    // 突變:把 redirect 改回 `detailPath(parsed.orderId)` ⇒ 這條紅(登錄完面板被關掉)。
    const target = await redirectTarget(PANEL_VIEW);
    expect(target).toBe(`${PANEL_VIEW_CLEAN}&r=${PROCUREMENT_CREATED_RESULT_CODE}`);
    expect([...target.matchAll(/[?&]r=/g)]).toHaveLength(1);
  });

  it('整頁版行為不變', async () => {
    expect(await redirectTarget(`/orders/${ORDER}`)).toBe(
      `/orders/${ORDER}?r=${PROCUREMENT_CREATED_RESULT_CODE}`,
    );
  });

  it('🔴 return_to 指向別張單(query 與 path 兩形式)⇒ 退回本單明細頁(契約 §6-1)', async () => {
    expect(await redirectTarget(`/orders?panel=${OTHER}`)).toBe(
      `/orders/${ORDER}?r=${PROCUREMENT_CREATED_RESULT_CODE}`,
    );
    vi.clearAllMocks();
    mocks.authorizeAdminMutation.mockResolvedValue({ sid: 's1', actorId: 'staff-a' });
    mocks.upsertItemProcurement.mockResolvedValue('CREATED');
    mocks.findOrderIdForItem.mockResolvedValue(ORDER);
    expect(await redirectTarget(`/orders/${OTHER}`)).toBe(
      `/orders/${ORDER}?r=${PROCUREMENT_CREATED_RESULT_CODE}`,
    );
  });

  it('🔴 return_to 非法 ⇒ 退回本單明細頁,而且採購**照樣寫進去了**', async () => {
    expect(await redirectTarget('https://evil.example')).toBe(
      `/orders/${ORDER}?r=${PROCUREMENT_CREATED_RESULT_CODE}`,
    );
    expect(mocks.upsertItemProcurement).toHaveBeenCalledTimes(1);
  });

  it('🔴 契約 §5:回面板時 `/orders` 那條也要 revalidate,且吃的是路徑不是網址', async () => {
    await redirectTarget(PANEL_VIEW);
    const paths = mocks.revalidatePath.mock.calls.map((c) => c[0]);
    expect(paths).toContain(`/orders/${ORDER}`);
    expect(paths).toContain('/orders');
    for (const [path] of mocks.revalidatePath.mock.calls) expect(String(path)).not.toContain('?');
  });

  it('🔴 失敗(RPC 回非成功碼)⇒ 不導頁、回 state,但兩條路由仍被 revalidate', async () => {
    // 🔴 code-reviewer nit:`revalidate` 排在 `classifyResult` **之前**是刻意的
    //    (`bug`/`error` 兩支都可能已經寫進去了)。沒有這格的話,有人把它挪到 `if (failure)` 之後
    //    全套照樣綠,而症狀是員工停在看不到那筆採購的舊畫面上 —— 正是會讓他再送一次的畫面。
    mocks.upsertItemProcurement.mockResolvedValue('OVER_ALLOCATION');
    const state = await upsertItemProcurementAction(undefined as never, form(PANEL_VIEW));
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(state.status).toBe('failed');
    expect(mocks.revalidatePath.mock.calls.map((c) => c[0])).toContain('/orders');
  });

  it('🔴 明細頁那條 revalidate 拋錯,`/orders` 那條仍要被嘗試(逐條各自 try)', async () => {
    // 突變:把 for 迴圈換成單一外層 try ⇒ 這格紅。
    mocks.revalidatePath.mockImplementation((path: unknown) => {
      if (path === `/orders/${ORDER}`) throw new Error('boom');
    });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await redirectTarget(PANEL_VIEW);
      expect(mocks.revalidatePath.mock.calls.map((c) => c[0])).toContain('/orders');
    } finally {
      errorLog.mockRestore();
    }
  });
});
