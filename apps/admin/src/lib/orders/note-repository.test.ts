import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({ rpc: mocks.rpc }),
}));

import {
  NOTE_RESULT_CODES,
  OrderNoteCallerBugError,
  appendOrderNote,
} from './note-repository';

// M-4b E10 A9d2-1:`admin_append_order_note` 唯一呼叫端。
// 🔴 誠實邊界:本檔全是 mock ⇒ 證的是「呼叫端把契約接對了」,不是「RPC 在正式站的行為」。

const ARGS = {
  orderId: '11111111-2222-3333-4444-555555555555',
  noteType: 'internal' as const,
  body: '客人說先不要出貨',
  channel: null,
  occurredAt: null,
  correctsNoteId: null,
  actor: 'sean',
  requestToken: '99999999-8888-7777-6666-555555555555',
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('appendOrderNote — wire', () => {
  it('逐欄具名送進 RPC(八參數深度相等;多送/少送一欄即轉紅)', async () => {
    mocks.rpc.mockResolvedValue({ data: 'APPENDED', error: null });
    await appendOrderNote({
      ...ARGS,
      noteType: 'contact_log',
      channel: 'phone',
      occurredAt: '2026-08-02T14:30:00+08:00',
      correctsNoteId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_append_order_note', {
      p_order_id: ARGS.orderId,
      p_note_type: 'contact_log',
      p_body: ARGS.body,
      p_channel: 'phone',
      p_occurred_at: '2026-08-02T14:30:00+08:00',
      p_corrects_note_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      p_actor: 'sean',
      p_request_id: ARGS.requestToken,
    });
  });

  it('🔴 `p_request_id` 送的是**表單 token**(Sean Q2=C),不是任何 HTTP 層的 id', async () => {
    mocks.rpc.mockResolvedValue({ data: 'APPENDED', error: null });
    await appendOrderNote(ARGS);
    const args = mocks.rpc.mock.calls[0]?.[1] as { p_request_id: string };
    expect(args.p_request_id).toBe(ARGS.requestToken);
  });

  it('internal:channel / occurredAt 逐欄送 null(配對規則 CHECK 強制)', async () => {
    mocks.rpc.mockResolvedValue({ data: 'APPENDED', error: null });
    await appendOrderNote(ARGS);
    const args = mocks.rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(args.p_channel).toBeNull();
    expect(args.p_occurred_at).toBeNull();
  });
});

describe('appendOrderNote — 14 碼窮盡收斂', () => {
  it('14 個固定碼**逐碼**原樣回傳(非代表值抽測)', async () => {
    expect(NOTE_RESULT_CODES).toHaveLength(14);
    for (const code of NOTE_RESULT_CODES) {
      mocks.rpc.mockResolvedValue({ data: code, error: null });
      await expect(appendOrderNote(ARGS)).resolves.toBe(code);
    }
  });

  it('未知碼 → OrderNoteCallerBugError(**不得**靜默當成功)', async () => {
    mocks.rpc.mockResolvedValue({ data: 'SOMETHING_NEW', error: null });
    await expect(appendOrderNote(ARGS)).rejects.toBeInstanceOf(OrderNoteCallerBugError);
  });

  it('null / 非字串 → OrderNoteCallerBugError', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(appendOrderNote(ARGS)).rejects.toBeInstanceOf(OrderNoteCallerBugError);
    mocks.rpc.mockResolvedValue({ data: { code: 'APPENDED' }, error: null });
    await expect(appendOrderNote(ARGS)).rejects.toBeInstanceOf(OrderNoteCallerBugError);
  });
});

describe('appendOrderNote — P0001 判別(關卡1 F4)', () => {
  // 🔴 mock **必須帶真實 PostgrestError 形狀的 `code`** —— 只丟裸 Error 的話這格會恆綠。
  it('RPC 的 RAISE(P0001)→ OrderNoteCallerBugError(不是一般 DB error)', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        code: 'P0001',
        message: 'admin_append_order_note: request_id 已被使用但無對應備註或內容不符',
        details: '整列內容不該進 log',
        hint: null,
      },
    });
    await expect(appendOrderNote(ARGS)).rejects.toBeInstanceOf(OrderNoteCallerBugError);
  });

  it('非 P0001 的 DB error → 原樣拋出(呼叫端歸成 error =「可能已寫入」)', async () => {
    const dbError = { code: '23514', message: 'check constraint violated' };
    mocks.rpc.mockResolvedValue({ data: null, error: dbError });
    await expect(appendOrderNote(ARGS)).rejects.not.toBeInstanceOf(OrderNoteCallerBugError);
    await expect(appendOrderNote(ARGS)).rejects.toBe(dbError);
  });
});
