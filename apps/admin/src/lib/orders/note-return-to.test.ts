import { beforeEach, describe, expect, it, vi } from 'vitest';

// note-return-to.test.ts — #350d-3:備註線的 C1 接線 + 契約 §5。
//
// 🔴 備註線是**混合形**(Sean 2026-08-02 Q1=A):失敗回 action state(留住員工打的字)、
//    **只有成功走 redirect** ⇒ 本檔要量的導頁只有一條,但 revalidate 兩條路徑都要對。
// 🔴 備註同樣 append-only:讓員工「以為沒寫進去而再送一次」= 第二筆刪不掉的備註。

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((..._args: unknown[]): never => {
    throw new Error('NEXT_REDIRECT');
  }),
  revalidatePath: vi.fn(),
  authorizeAdminMutation: vi.fn(),
  appendOrderNote: vi.fn(),
}));

// `note-repository` 走 `server-only`(vitest 走 client 條件解析會直接擲)。
vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('../session/authorize', () => ({ authorizeAdminMutation: mocks.authorizeAdminMutation }));
vi.mock('../audit/context', () => ({ getRequestId: async () => 'req-1' }));
vi.mock('./note-repository', () => ({
  appendOrderNote: mocks.appendOrderNote,
  // action 用 `instanceof` 分流 —— 替身要給一個真的 class,不能只給空物件。
  OrderNoteCallerBugError: class OrderNoteCallerBugError extends Error {},
}));

import { appendOrderNoteAction } from './note-actions';
import {
  NOTE_ADDED_RESULT_CODE,
  NOTE_BODY_FIELD,
  NOTE_CHANNEL_FIELD,
  NOTE_ORDER_ID_FIELD,
  NOTE_REQUEST_TOKEN_FIELD,
  NOTE_TYPE_FIELD,
} from './note-action-state';
import { ORDER_RETURN_TO_FIELD } from './order-return-to';

const ORDER = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-8888-4777-8666-555555555555';
const TOKEN = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5';
/**
 * 🔴 刻意夾帶舊的 `r`,否則「結果 URL 的 r 恰一顆」是恆真。
 * 🔴 用**不同族**的碼(`saved` 是改單線的)—— 同族的話證不出剝的是**鍵**而不是那個值。
 */
const PANEL_VIEW = `/orders?payment_status=paid&panel=${ORDER}&r=saved`;
const PANEL_VIEW_CLEAN = `/orders?payment_status=paid&panel=${ORDER}`;

function form(returnTo: string): FormData {
  const fd = new FormData();
  fd.set(NOTE_ORDER_ID_FIELD, ORDER);
  fd.set(NOTE_REQUEST_TOKEN_FIELD, TOKEN);
  fd.set(NOTE_TYPE_FIELD, 'internal');
  fd.set(NOTE_CHANNEL_FIELD, 'none');
  fd.set(NOTE_BODY_FIELD, '客人來電確認地址');
  fd.set(ORDER_RETURN_TO_FIELD, returnTo);
  return fd;
}

async function redirectTarget(returnTo: string): Promise<string> {
  await expect(appendOrderNoteAction(undefined as never, form(returnTo))).rejects.toThrow(
    'NEXT_REDIRECT',
  );
  expect(mocks.redirect).toHaveBeenCalledTimes(1);
  return mocks.redirect.mock.calls[0]![0] as string;
}

describe('#350d-3 備註線:成功導回發起的那個視圖', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorizeAdminMutation.mockResolvedValue({ sid: 's1', actorId: 'staff-a' });
    mocks.appendOrderNote.mockResolvedValue('APPENDED');
  });

  it('🔴 成功:回面板,篩選逐字保留、`r` 恰一顆', async () => {
    // 突變:把 redirect 改回 `detailPath(parsed.orderId)` ⇒ 這條紅(寫完備註面板被關掉)。
    const target = await redirectTarget(PANEL_VIEW);
    expect(target).toBe(`${PANEL_VIEW_CLEAN}&r=${NOTE_ADDED_RESULT_CODE}`);
    expect([...target.matchAll(/[?&]r=/g)]).toHaveLength(1);
  });

  it('整頁版行為不變', async () => {
    expect(await redirectTarget(`/orders/${ORDER}`)).toBe(
      `/orders/${ORDER}?r=${NOTE_ADDED_RESULT_CODE}`,
    );
  });

  it('🔴 return_to 指向別張單(query 與 path 兩形式)⇒ 退回本單明細頁(契約 §6-1)', async () => {
    expect(await redirectTarget(`/orders?panel=${OTHER}`)).toBe(
      `/orders/${ORDER}?r=${NOTE_ADDED_RESULT_CODE}`,
    );
    vi.clearAllMocks();
    mocks.authorizeAdminMutation.mockResolvedValue({ sid: 's1', actorId: 'staff-a' });
    mocks.appendOrderNote.mockResolvedValue('APPENDED');
    expect(await redirectTarget(`/orders/${OTHER}`)).toBe(
      `/orders/${ORDER}?r=${NOTE_ADDED_RESULT_CODE}`,
    );
  });

  it('🔴 return_to 非法 ⇒ 退回本單明細頁,而且備註**照樣寫進去了**', async () => {
    expect(await redirectTarget('https://evil.example')).toBe(
      `/orders/${ORDER}?r=${NOTE_ADDED_RESULT_CODE}`,
    );
    expect(mocks.appendOrderNote).toHaveBeenCalledTimes(1);
  });

  it('🔴 契約 §5:回面板時 `/orders` 那條路由也要 revalidate', async () => {
    await redirectTarget(PANEL_VIEW);
    const paths = mocks.revalidatePath.mock.calls.map((c) => c[0]);
    expect(paths).toContain(`/orders/${ORDER}`);
    expect(paths).toContain('/orders');
    // 🔴 吃的是**路徑**、不是帶 query 的網址(打不中的路徑不會報錯)。
    for (const [path] of mocks.revalidatePath.mock.calls) expect(String(path)).not.toContain('?');
  });

  it('🔴 明細頁那條 revalidate 拋錯,`/orders` 那條仍要被嘗試(逐條各自 try)', async () => {
    // 🔴 取消線 codex 關卡2 的同型教訓:修法自己要有靶。
    //    突變:把 for 迴圈換成單一外層 try ⇒ 這格紅。
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

  it('🔴 失敗(RPC 回非成功碼)⇒ 不導頁、回 state,但兩條路由仍被 revalidate', async () => {
    // 備註線的失敗**不導頁**(要留住員工打的字)⇒ 這格確認我沒把 revalidate 也一起搬走:
    // 失敗路徑不重取的話,員工停在看不到那筆備註的舊畫面上,正是會讓他再送一次的畫面。
    mocks.appendOrderNote.mockResolvedValue('ORDER_NOT_FOUND');
    const state = await appendOrderNoteAction(undefined as never, form(PANEL_VIEW));
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(state.status).toBe('failed');
    const paths = mocks.revalidatePath.mock.calls.map((c) => c[0]);
    expect(paths).toContain('/orders');
  });
});
