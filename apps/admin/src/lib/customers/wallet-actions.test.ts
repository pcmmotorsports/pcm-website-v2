import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  authorizeAdminMutation: vi.fn(),
  getRequestId: vi.fn(),
  adjustCustomerWallet: vi.fn(),
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

// 🔴 只換掉寫入函式(同 note-actions.test.ts 的理由)。
vi.mock('./customer-repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./customer-repository')>();
  return { ...actual, adjustCustomerWallet: mocks.adjustCustomerWallet };
});

// 🔴 解析器**刻意不 mock** —— 餵真 FormData 走真解析器,否則「爛表單擋得住」是恆真斷言。
import { adjustWalletAction } from './wallet-actions';
import {
  WALLET_CUSTOMER_ID_FIELD,
  WALLET_DIRECTION_FIELD,
  WALLET_AMOUNT_FIELD,
  WALLET_NOTE_FIELD,
  WALLET_RETURN_TO_FIELD,
  WALLET_REQUEST_TOKEN_FIELD,
} from './wallet-form';

// ⟦b4-WALLETDEDUPE⟧ 2026-09-06 —— **這支檔是 codex 審 diff #5 逼出來的**。
//
// 🛑 它逐字說:「把 action 改回 HTTP id、刪掉保留 token 的邏輯或雙 id log,**這兩支仍可全綠**」——
//    因為當時只有兩支測試:一支把 action **mock 成空函式**(元件契約檔), 一支只驗解析器。
//    ⇒ 📌 **這一片的承重(送哪一個 id 進 RPC)當時零覆蓋。**
// ⇒ 本檔逐格釘住那條線, 每一格都答得出「什麼樣的爛實作會讓它變紅」。

const CUS = '11111111-2222-3333-4444-555555555555';
/** 🔴 表單 token 與 HTTP id **刻意長得不一樣** —— 送錯那一個, 斷言才分得出來。 */
const FORM_TOKEN = '99999999-8888-7777-6666-555555555555';
const HTTP_ID = 'req_00000000-0000-4000-8000-000000000000';

function form(overrides: Record<string, string> = {}): FormData {
  const f = new FormData();
  const base: Record<string, string> = {
    [WALLET_CUSTOMER_ID_FIELD]: CUS,
    [WALLET_DIRECTION_FIELD]: 'use',
    [WALLET_AMOUNT_FIELD]: '200',
    [WALLET_NOTE_FIELD]: '電話訂單折抵',
    [WALLET_RETURN_TO_FIELD]: `/customers/${CUS}`,
    [WALLET_REQUEST_TOKEN_FIELD]: FORM_TOKEN,
    ...overrides,
  };
  for (const [k, v] of Object.entries(base)) f.set(k, v);
  return f;
}

describe('adjustWalletAction — 冪等鍵那條線(⟦b4-WALLETDEDUPE⟧)', () => {
  beforeEach(() => {
    mocks.authorizeAdminMutation.mockResolvedValue({ sid: 's1', actorId: 'staff-1' });
    mocks.getRequestId.mockResolvedValue(HTTP_ID);
    mocks.adjustCustomerWallet.mockResolvedValue('ADJUSTED');
    mocks.redirect.mockImplementation(() => {
      throw new Error('REDIRECTED');
    });
  });
  afterEach(() => vi.clearAllMocks());

  it('🔴🔴 送進 RPC 的是【表單 token】, 不是 HTTP request id', async () => {
    // 這一格殺得掉「把 requestId 改回 getRequestId()」—— 那正是 backlog #279 的舊解法,
    // 而它會讓去重靜默失效(每個 HTTP 請求一個新 id ⇒ 唯一索引永遠不會撞)。
    await expect(adjustWalletAction({ status: 'idle' }, form())).rejects.toThrow('REDIRECTED');
    expect(mocks.adjustCustomerWallet).toHaveBeenCalledTimes(1);
    const arg = mocks.adjustCustomerWallet.mock.calls[0]?.[0] as { requestId: string };
    expect(arg.requestId).toBe(FORM_TOKEN);
    expect(arg.requestId).not.toBe(HTTP_ID);
  });

  it('🔴 兩個 id 都進 attempt log(A6 §4 F2 逐字要求;刪掉那行 log 這格就紅)', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    await expect(adjustWalletAction({ status: 'idle' }, form())).rejects.toThrow('REDIRECTED');
    const payload = info.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.idempotency_token).toBe(FORM_TOKEN);
    expect(payload.http_request_id).toBe(HTTP_ID);
    info.mockRestore();
  });

  it('🔴🔴 RPC 回 DUPLICATE ⇒ redirect 帶 r=wallet_duplicate(帶前綴, 不是裸 duplicate)', async () => {
    // 呼叫端要分得出「我這一發做了事」與「上一發做過了」。
    mocks.adjustCustomerWallet.mockResolvedValue('DUPLICATE');
    await expect(adjustWalletAction({ status: 'idle' }, form())).rejects.toThrow('REDIRECTED');
    expect(mocks.redirect.mock.calls[0]?.[0]).toContain('r=wallet_duplicate');
  });

  it('🔴🔴 SQLSTATE P9W01 ⇒ mismatch(不是 error)—— 兩者要讓員工做【相反】的事', async () => {
    // 這一格殺得掉「把兩者都收斂成 error」:那時畫面唸「請稍後再試」,
    // 而 mismatch 那條路**永遠不會成功**, 員工會一直按。
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.adjustCustomerWallet.mockRejectedValue(
      Object.assign(new Error('同一個 request_id 帶著不同內容'), { code: 'P9W01' }),
    );
    const s = await adjustWalletAction({ status: 'idle' }, form());
    expect(s.status).toBe('failed');
    expect(s.status === 'failed' && s.code).toBe('mismatch');
    // 🔵 而失敗 state 要原樣帶回 token 與員工輸入(含**方向**)。
    expect(s.status === 'failed' && s.requestToken).toBe(FORM_TOKEN);
    expect(s.status === 'failed' && s.direction).toBe('use');
    expect(s.status === 'failed' && s.amount).toBe('200');
    expect(s.status === 'failed' && s.note).toBe('電話訂單折抵');
  });

  it('🔵 負對照:一般 DB 錯誤 ⇒ error(不是 mismatch)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.adjustCustomerWallet.mockRejectedValue(
      Object.assign(new Error('connection lost'), { code: '08006' }),
    );
    const s = await adjustWalletAction({ status: 'idle' }, form());
    expect(s.status === 'failed' && s.code).toBe('error');
    expect(s.status === 'failed' && s.requestToken).toBe(FORM_TOKEN);
  });

  it('🔴 兩句訊息要讓員工做【相反】的事(不得共用、不得互換)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.adjustCustomerWallet.mockRejectedValue(Object.assign(new Error('x'), { code: 'P9W01' }));
    const mismatch = await adjustWalletAction({ status: 'idle' }, form());
    mocks.adjustCustomerWallet.mockRejectedValue(Object.assign(new Error('y'), { code: '08006' }));
    const err = await adjustWalletAction({ status: 'idle' }, form());
    const a = mismatch.status === 'failed' ? mismatch.message : '';
    const b = err.status === 'failed' ? err.message : '';
    expect(a).not.toBe(b);
    expect(a, 'mismatch 要叫他停下來').toContain('重新整理');
    expect(b, 'error 要叫他放心再按一次').toContain('再按一次');
  });

  it('🔴 缺 token 的表單 ⇒ invalid, 而且【沒有打到 RPC】', async () => {
    const f = form();
    f.delete(WALLET_REQUEST_TOKEN_FIELD);
    const s = await adjustWalletAction({ status: 'idle' }, f);
    expect(s.status === 'failed' && s.code).toBe('invalid');
    expect(mocks.adjustCustomerWallet).not.toHaveBeenCalled();
  });

  it('🔴 沒授權 ⇒ denied, 而且【沒有打到 RPC】', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    const s = await adjustWalletAction({ status: 'idle' }, form());
    expect(s.status === 'failed' && s.code).toBe('denied');
    expect(mocks.adjustCustomerWallet).not.toHaveBeenCalled();
  });

  // 🔴🔴 **這一格是 codex R2 ② 逼出來的, 而它打的是【這支檔自己的盲點】**:
  //  上面每一格都把 `adjustCustomerWallet` 換成 mock ⇒ **repository 那一半零覆蓋**。
  //  ⇒ 📌 把 `customer-repository.ts` 裡放行 `'DUPLICATE'` 的那一行刪掉,
  //    正式的重送會變成 `throw`(收斂成 `error`)⇒ 員工看到「再按一次」而那條路已經沒用了;
  //    **而上面八格照樣全綠**, 因為 DUPLICATE 是 mock 自己給的。
  //  ✅ 所以這一格**不用 mock** —— 直接拿真的 repository, 只換掉最底層的 supabase client。
  it('🔴🔴 repository 真的放行 DUPLICATE(不經過 mock)', async () => {
    const actual = await vi.importActual<typeof import('./customer-repository')>(
      './customer-repository',
    );
    const adapters = await import('@pcm/adapters/server');
    const rpc = vi.fn().mockResolvedValue({ data: 'DUPLICATE', error: null });
    vi.mocked(adapters.createSupabaseServiceClient).mockReturnValue({
      rpc,
    } as unknown as ReturnType<typeof adapters.createSupabaseServiceClient>);
    await expect(
      actual.adjustCustomerWallet({
        customerId: CUS,
        entryType: 'use',
        signedAmount: -200,
        note: 'x',
        actor: 'staff-1',
        requestId: FORM_TOKEN,
      }),
    ).resolves.toBe('DUPLICATE');
    // 🔵 順便釘住:送進 RPC 的那個參數名就是 `p_request_id`
    expect((rpc.mock.calls[0]?.[1] as { p_request_id: string }).p_request_id).toBe(FORM_TOKEN);
  });
});
