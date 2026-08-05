import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  authorizeAdminMutation: vi.fn(),
  getRequestId: vi.fn(),
  cancelOrder: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('../session/authorize', () => ({
  authorizeAdminMutation: mocks.authorizeAdminMutation,
}));
vi.mock('../audit/context', () => ({ getRequestId: mocks.getRequestId }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
// 🔴 **redirect mock 必須像 Next 真實行為一樣拋**(關卡2 codex must-fix):
//    純 `vi.fn()` 不拋 ⇒ 把 `redirect()` 搬到 revalidate / 成功 log **之前**整份測試照樣全綠,
//    而正式環境會當場跳出、那兩件事都不會發生。
class NextRedirectError extends Error {
  constructor() {
    super('NEXT_REDIRECT');
    this.name = 'NEXT_REDIRECT';
  }
}
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@pcm/adapters/server', () => ({ createSupabaseServiceClient: vi.fn() }));

vi.mock('./cancel-repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./cancel-repository')>();
  return { ...actual, cancelOrder: mocks.cancelOrder };
});

// 🔴 解析器與 state builder **刻意不 mock** —— 餵真 FormData 走真解析器,
//    否則「爛表單擋得住」「invalid 會換新 token」都是恆真斷言(前例 `note-actions.test.ts:29`)。
import { cancelOrderAction } from './cancel-actions';
import {
  CANCEL_ITEM_FIELD,
  CANCEL_MODE_FIELD,
  CANCEL_ORDER_ID_FIELD,
  CANCEL_REASON_CODE_FIELD,
  CANCEL_REASON_DETAIL_FIELD,
  CANCEL_REQUEST_TOKEN_FIELD,
  ORDER_CANCELLED_RESULT_CODE,
  type CancelActionState,
} from './cancel-action-state';

const ORDER_ID = '11111111-2222-3333-4444-555555555555';
const TOKEN = '99999999-8888-7777-6666-555555555555';
const ITEM_ID = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
const DETAIL_PATH = `/orders/${ORDER_ID}`;
// 🔴 **刻意與表單的 TOKEN 不同**(code-reviewer nit):兩者相同的話,
//    把實作改成 `prevState?.requestToken ?? parsed.requestToken` 也會全綠 ——
//    「回帶的是**這次送出**的那一顆」就沒被分辨出來。
const PREV_TOKEN = '12121212-3434-5656-7878-909090909090';
const IDLE: CancelActionState = { status: 'idle', requestToken: PREV_TOKEN };
// 🔴 刻意含 emoji(surrogate pair):碼位長度與 UTF-16 長度不同 ⇒
//    log 那格若改用 `.length` 會轉紅(同備註片 fixture 的理由)。
const OTHER_DETAIL = '客人改買別款,已電話確認 🏍️';

function cancelForm(over: Record<string, string> = {}, items: string[] = []): FormData {
  const data = new FormData();
  const fields: Record<string, string> = {
    [CANCEL_ORDER_ID_FIELD]: ORDER_ID,
    [CANCEL_REQUEST_TOKEN_FIELD]: TOKEN,
    [CANCEL_REASON_CODE_FIELD]: 'out_of_stock',
    [CANCEL_MODE_FIELD]: 'full',
    ...over,
  };
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  for (const item of items) data.append(CANCEL_ITEM_FIELD, item);
  return data;
}

const OK_OUTCOME = {
  ok: true as const,
  cancellationId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  idempotent: false,
  closed: true,
};

beforeEach(() => {
  mocks.authorizeAdminMutation.mockResolvedValue({ sid: 'sid-1', actorId: 'sean' });
  mocks.getRequestId.mockResolvedValue('req-1');
  mocks.cancelOrder.mockResolvedValue(OK_OUTCOME);
  mocks.redirect.mockImplementation(() => {
    throw new NextRedirectError();
  });
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('cancelOrderAction — 閘的順序(plan §2 慣例 1 + 片 4 交棒義務 1)', () => {
  it('未授權 → denied、不呼叫 RPC', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    const state = await cancelOrderAction(IDLE, cancelForm());
    expect(state).toMatchObject({ status: 'failed', outcome: 'not_sent', code: 'denied' });
    expect(mocks.cancelOrder).not.toHaveBeenCalled();
  });

  it('🔴 未授權時**不保留輸入**(授權閘在讀任何欄位之前 —— 這是明說的取捨,不是漏)', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    const state = await cancelOrderAction(
      IDLE,
      cancelForm({ [CANCEL_REASON_CODE_FIELD]: 'other', [CANCEL_REASON_DETAIL_FIELD]: '看得見我嗎' }),
    );
    expect(state).toMatchObject({
      input: { cancelMode: '', reasonCode: '', reasonDetail: '', items: [] },
    });
  });

  // 🔴🔴 **關卡2 codex must-fix:上面兩格餵的都是合法表單** ⇒ 把「解析失敗立即 return invalid」
  //    搬到授權閘**之前**,它們照樣全綠(合法表單解析得過、走不到那條路)。
  //    要證明「授權閘絕對第一、之前零讀取」,得餵一顆**碰到就炸**的表單:
  //    授權失敗時若有任何一行先摸了它,這格會拿到 TypeError 而不是 denied。
  it('🔴 未授權 + **碰到就炸的表單** → 仍是 denied(證明授權閘之前一個欄位都沒讀)', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    const landmine = {
      get() {
        throw new TypeError('授權閘之前不該讀表單');
      },
      getAll() {
        throw new TypeError('授權閘之前不該讀表單');
      },
    } as unknown as FormData;
    const state = await cancelOrderAction(IDLE, landmine);
    expect(state).toMatchObject({ outcome: 'not_sent', code: 'denied' });
  });

  // 🔴🔴 **這格釘的是「順序」而不是「兩道閘各自會擋」**(memory
  //    `feedback_assertion-measures-the-wrong-thing`:每組負測只讓一道閘失敗 ⇒ 順序沒被測)。
  //    同時餵「未授權」與「凍結的 prevState」,只有把授權排第一才會回 denied。
  //    把兩道對調 → 本格回 sent state 而紅;而上面每一格都仍會綠。
  it('🔴 未授權 + prevState 已凍結 → 仍是 denied(證明授權閘排在凍結判斷之前)', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    const frozen: CancelActionState = {
      status: 'failed',
      outcome: 'sent',
      code: 'error',
      message: '取消可能已經寫進去了。',
      requestToken: TOKEN,
      input: { cancelMode: 'full', reasonCode: 'out_of_stock', reasonDetail: '', items: [] },
    };
    const state = await cancelOrderAction(frozen, cancelForm());
    expect(state).toMatchObject({ outcome: 'not_sent', code: 'denied' });
  });

  it('已授權 + prevState 已凍結 → 原樣回、不呼叫 RPC、不 revalidate、不導頁', async () => {
    const frozen: CancelActionState = {
      status: 'failed',
      outcome: 'sent',
      code: 'rejected',
      message: '這張單目前不能取消。',
      requestToken: TOKEN,
      input: { cancelMode: 'partial', reasonCode: 'other', reasonDetail: 'x', items: [`${ITEM_ID}:1`] },
    };
    const state = await cancelOrderAction(frozen, cancelForm());
    expect(state).toBe(frozen);
    expect(mocks.cancelOrder).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  // 🔴🔴 **code-reviewer must-fix:凍結閘搬到解析之後 → 原本 54 格全綠**。
  //    實害:凍結中的畫面送出爛表單 → 解析先擋 → 回 `invalid` → **換新 token**
  //    ⇒ 新 payload_hash ⇒ 同一份 payload 會真的再取消一次(正是 §2.1 要防的事)。
  //    上面那格用的是**合法**表單,擋不住這個突變 —— 爛表單才分得出兩者的順序。
  it('🔴 已凍結 + **爛表單** → 仍原樣回 frozen(證明凍結閘排在解析之前)', async () => {
    const frozen: CancelActionState = {
      status: 'failed',
      outcome: 'sent',
      code: 'bug',
      message: '系統狀態異常。',
      requestToken: TOKEN,
      input: { cancelMode: 'full', reasonCode: 'out_of_stock', reasonDetail: '', items: [] },
    };
    const state = await cancelOrderAction(frozen, cancelForm({ [CANCEL_MODE_FIELD]: '亂碼' }));
    expect(state).toBe(frozen);
    if (state.status !== 'failed') return;
    // 🔴 這行是本格的承重:突變後回的是新鑄的 token,而 frozen 這顆必須原封不動。
    expect(state.requestToken).toBe(TOKEN);
  });

  it('🔴 prevState 是 undefined 也不得炸(偽造 undefined 不能在授權後變成 500)', async () => {
    // 走到成功路徑 ⇒ 拋的是 NEXT_REDIRECT(不是 TypeError)。拿掉 `?.` 這格會變成 TypeError 而紅。
    await expect(cancelOrderAction(undefined, cancelForm())).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.cancelOrder).toHaveBeenCalledTimes(1);
  });

  it('prevState 是 not_sent(可編輯)→ 不凍結,照常送出', async () => {
    const editable: CancelActionState = {
      status: 'failed',
      outcome: 'not_sent',
      code: 'invalid',
      message: '表單內容不正確,取消沒有送出。',
      requestToken: TOKEN,
      input: { cancelMode: 'full', reasonCode: '', reasonDetail: '', items: [] },
    };
    await expect(cancelOrderAction(editable, cancelForm())).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.cancelOrder).toHaveBeenCalledTimes(1);
  });
});

describe('cancelOrderAction — 解析失敗', () => {
  it('爛表單 → invalid、不呼叫 RPC、保留輸入', async () => {
    const state = await cancelOrderAction(IDLE, cancelForm({ [CANCEL_REASON_CODE_FIELD]: '亂碼' }));
    expect(state).toMatchObject({
      outcome: 'not_sent',
      code: 'invalid',
      input: { reasonCode: '亂碼', cancelMode: 'full' },
    });
    expect(mocks.cancelOrder).not.toHaveBeenCalled();
  });

  it('🔴 invalid 一定**換新 token**(舊的沒送出、沒有冪等價值;留著會在日後撞 payload_hash)', async () => {
    const state = await cancelOrderAction(IDLE, cancelForm({ [CANCEL_MODE_FIELD]: '亂碼' }));
    expect(state).toMatchObject({ code: 'invalid' });
    if (state.status !== 'failed') return;
    expect(state.requestToken).not.toBe(TOKEN);
  });

  it('🔴 品項是可重複欄位:invalid 時要帶回**全部**勾選(用 get() 只會帶回第一筆)', async () => {
    const items = [`${ITEM_ID}:2`, 'cccccccc-dddd-eeee-ffff-000000000000:1'];
    const state = await cancelOrderAction(
      IDLE,
      // mode 亂碼 ⇒ 解析必失敗,但品項要原樣帶回
      cancelForm({ [CANCEL_MODE_FIELD]: '亂碼' }, items),
    );
    expect(state).toMatchObject({ code: 'invalid', input: { items } });
  });
});

describe('cancelOrderAction — 送達 RPC 之後', () => {
  it('逐欄具名送進 repository(整單取消:items=null)', async () => {
    await expect(cancelOrderAction(IDLE, cancelForm())).rejects.toThrow('NEXT_REDIRECT');
    // 🔴 恰呼一次:多打一次(換新 token)帳本會真的多一筆。
    expect(mocks.cancelOrder).toHaveBeenCalledTimes(1);
    expect(mocks.cancelOrder).toHaveBeenCalledWith({
      orderId: ORDER_ID,
      reasonCode: 'out_of_stock',
      reasonDetail: null,
      items: null,
      actor: 'sean',
      requestToken: TOKEN,
    });
  });

  it('部分取消 + other 說明:品項與說明原樣送達', async () => {
    await expect(
      cancelOrderAction(
        IDLE,
        cancelForm(
          {
            [CANCEL_MODE_FIELD]: 'partial',
            [CANCEL_REASON_CODE_FIELD]: 'other',
            [CANCEL_REASON_DETAIL_FIELD]: OTHER_DETAIL,
          },
          [`${ITEM_ID}:3`],
        ),
      ),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.cancelOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        reasonCode: 'other',
        reasonDetail: OTHER_DETAIL,
        items: [{ order_item_id: ITEM_ID, quantity: 3 }],
      }),
    );
  });

  it('成功 → 成功 log 與 revalidate **都在 redirect 之前**,再 PRG 導回明細頁帶結果碼', async () => {
    // 🔴 `redirect()` 真的會拋 ⇒ 排在它後面的東西一律不會執行。
    await expect(cancelOrderAction(IDLE, cancelForm())).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.revalidatePath).toHaveBeenCalledWith(DETAIL_PATH);
    expect(console.info).toHaveBeenCalledWith(
      '[admin/orders/cancel] order_cancel.done',
      expect.objectContaining({
        request_token: TOKEN,
        cancellation_id: OK_OUTCOME.cancellationId,
      }),
    );
    expect(mocks.redirect).toHaveBeenCalledWith(
      `${DETAIL_PATH}?r=${ORDER_CANCELLED_RESULT_CODE}`,
    );
  });

  it('🔴 `idempotent: true` 也是成功(顯示成錯誤會誘導員工換 token 重送 = 真的多一筆取消)', async () => {
    mocks.cancelOrder.mockResolvedValue({ ...OK_OUTCOME, idempotent: true });
    await expect(cancelOrderAction(IDLE, cancelForm())).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith(
      `${DETAIL_PATH}?r=${ORDER_CANCELLED_RESULT_CODE}`,
    );
  });

  // 🔴 plan §2 慣例 3:失敗路徑**也**要 revalidate —— 那幾支可能已經寫進去了,
  //    不重取的話員工會停在看不到那筆取消的舊畫面(也就沒得跟手上的 token 對)。
  for (const code of ['rejected', 'retry', 'bug', 'error'] as const) {
    it(`${code} 失敗 → 仍 revalidate、回 sent state、**原樣**帶回送出的 token`, async () => {
      mocks.cancelOrder.mockResolvedValue({
        ok: false,
        code,
        sqlstate: 'P0001',
        logMessage: 'boom',
      });
      const state = await cancelOrderAction(IDLE, cancelForm());
      expect(mocks.revalidatePath).toHaveBeenCalledWith(DETAIL_PATH);
      expect(mocks.redirect).not.toHaveBeenCalled();
      // 🔴 `input` 也要斷言(code-reviewer must-fix:原本零守門)——
      //    片 4 義務 5 的比對要在凍結畫面上做,畫面得先知道員工剛送出什麼。
      expect(state).toMatchObject({
        outcome: 'sent',
        code,
        input: { cancelMode: 'full', reasonCode: 'out_of_stock', reasonDetail: '', items: [] },
      });
      if (state.status !== 'failed') return;
      // 🔴 換新鍵 = 全新 payload_hash = 同一份 payload 會真的再取消一次。
      expect(state.requestToken).toBe(TOKEN);
    });
  }

  // 🔴🔴 我加了 `safeRevalidate` 卻沒配負測 —— 拿掉那個 try 整份測試照樣全綠(自己跑突變才發現)。
  //    這格就是它的判別力:`revalidatePath` 拋錯時,補償 log 與凍結 state **都必須照樣發生**。
  //    沒有這格,那道防護就只是一個名字。
  it('🔴 revalidate 拋錯不得吃掉失敗回傳(否則員工拿到 500、換到新 token,而前一次可能已 commit)', async () => {
    mocks.cancelOrder.mockResolvedValue({
      ok: false,
      code: 'error',
      sqlstate: null,
      logMessage: 'boom',
    });
    mocks.revalidatePath.mockImplementation(() => {
      throw new Error('revalidate 炸了');
    });
    const state = await cancelOrderAction(IDLE, cancelForm());
    expect(state).toMatchObject({ outcome: 'sent', code: 'error' });
    if (state.status !== 'failed') return;
    expect(state.requestToken).toBe(TOKEN);
    // 補償 log 也要還在(它排在 revalidate 之前)。
    expect(console.error).toHaveBeenCalledWith(
      '[admin/orders/cancel] 取消失敗',
      expect.objectContaining({ message: 'boom' }),
    );
  });

  it('🔴 P0001 路徑一定把 message 記進 log(plan §4.2 補償條款;判別器從 UI 移到可觀測面)', async () => {
    mocks.cancelOrder.mockResolvedValue({
      ok: false,
      code: 'rejected',
      sqlstate: 'P0001',
      logMessage: 'admin_cancel_order: p_items 需為非空陣列',
    });
    await cancelOrderAction(IDLE, cancelForm());
    expect(console.error).toHaveBeenCalledWith(
      '[admin/orders/cancel] 取消失敗',
      expect.objectContaining({
        request_id: 'req-1',
        request_token: TOKEN,
        order_id: ORDER_ID,
        code: 'rejected',
        sqlstate: 'P0001',
        message: 'admin_cancel_order: p_items 需為非空陣列',
      }),
    );
  });
});

describe('cancelOrderAction — log 衛生', () => {
  it('🔴 attempt log **不記說明全文**,只記碼位長度', async () => {
    await expect(
      cancelOrderAction(
        IDLE,
        cancelForm({
          [CANCEL_REASON_CODE_FIELD]: 'other',
          [CANCEL_REASON_DETAIL_FIELD]: OTHER_DETAIL,
        }),
      ),
    ).rejects.toThrow('NEXT_REDIRECT');
    const [, payload] = vi.mocked(console.info).mock.calls[0] ?? [];
    expect(payload).toMatchObject({
      request_id: 'req-1',
      request_token: TOKEN,
      sid: 'sid-1',
      actor: 'sean',
      order_id: ORDER_ID,
      reason_code: 'other',
      reason_detail_length: [...OTHER_DETAIL].length,
      mode: 'full',
      item_count: null,
    });
    expect(JSON.stringify(payload)).not.toContain('客人改買別款');
  });

  // 🔴 code-reviewer must-fix:**失敗 log 原本零負測** —— 而失敗路徑正是最容易
  //    順手多塞欄位除錯的地方(往 `console.error` 加 `detail: carried.reasonDetail` 曾經全綠)。
  it('🔴 失敗 log 同樣不得帶出說明全文或品項內容', async () => {
    mocks.cancelOrder.mockResolvedValue({
      ok: false,
      code: 'error',
      sqlstate: null,
      logMessage: 'boom',
    });
    await cancelOrderAction(
      IDLE,
      cancelForm(
        {
          [CANCEL_MODE_FIELD]: 'partial',
          [CANCEL_REASON_CODE_FIELD]: 'other',
          [CANCEL_REASON_DETAIL_FIELD]: OTHER_DETAIL,
        },
        [`${ITEM_ID}:3`],
      ),
    );
    const serialized = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(serialized).not.toContain('客人改買別款');
    expect(serialized).not.toContain(ITEM_ID);
  });

  it('部分取消的 attempt log 記筆數、不記品項內容', async () => {
    await expect(
      cancelOrderAction(IDLE, cancelForm({ [CANCEL_MODE_FIELD]: 'partial' }, [`${ITEM_ID}:3`])),
    ).rejects.toThrow('NEXT_REDIRECT');
    const [, payload] = vi.mocked(console.info).mock.calls[0] ?? [];
    expect(payload).toMatchObject({ mode: 'partial', item_count: 1 });
    expect(JSON.stringify(payload)).not.toContain(ITEM_ID);
  });
});
