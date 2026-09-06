import { beforeEach, describe, expect, it, vi } from 'vitest';

// manual-cancel-notice-actions.test.ts — ⟦b4-CANCELMAILMIXEDRAIL⟧ 片 B ②
//
// 🔴 **這支存在的理由很具體**:code-reviewer 2026-09-06 對這一片的兩條 must-fix
//    **都住在 actions 那支檔, 而它當時零測試**:
//      ① 結果碼導到一個沒有人讀的參數 ⇒ 13 個碼全部畫面空白
//      ② `backTo()` 被自己的 `try` 吃掉 ⇒ `raced` 到不了, 撞鍵被回報成「登錄失敗」
//    ⇒ 📌 **兩條都是「線路」的錯, 而型別與三綠對線路是瞎的。**
//
// 🔴🔴 **`redirect` 的 mock 必須【會拋】**(逐字照 `cancel-actions.test.ts:25-32` 那段):
//    純 `vi.fn()` 不拋 ⇒ 把 `redirect()` 搬到寫入之前, 整份測試照樣全綠,
//    而正式環境會當場跳出。
// 🛑 **而只斷言「有拋」是恆真的**(該檔 `:135` 逐字警告)—— 每一條路都會拋。
//    ⇒ 每一格都**加上對 `mocks.redirect` 的參數斷言**, 那才是有判別力的那一半。

class NextRedirectError extends Error {
  constructor() {
    super('NEXT_REDIRECT');
    this.name = 'NEXT_REDIRECT';
  }
}

const mocks = vi.hoisted(() => ({
  redirect: vi.fn<(url: string) => never>(() => {
    throw new NextRedirectError();
  }),
  revalidatePath: vi.fn(),
  authorize: vi.fn(),
  getRequestId: vi.fn(async () => 'req-1'),
  record: vi.fn<(entry: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<void>>(
    async () => undefined,
  ),
  eligibility: vi.fn(),
  // 🔴 型別要給足 —— `mock.calls[0]?.[0]` 在無型別的 `vi.fn()` 上是 `never`,
  //    而 vitest 跑得動、`tsc` 不收(2026-09-06 實測 build 紅 4 條)。
  insert: vi.fn<(row: Record<string, unknown>) => void>(),
  // 🔴 插入的回應放這裡, **不要掛在 mock 函式身上** —— 那需要 `as unknown as {...}` 硬轉,
  //    而硬轉正是 `tsc` 擋下的東西。
  insertResult: { error: null as { code?: string; message?: string } | null, data: {} as unknown },
}));

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  RedirectType: { push: 'push', replace: 'replace' },
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('../session/authorize', () => ({ authorizeManagerMutation: mocks.authorize }));
vi.mock('../audit/context', () => ({ getRequestId: mocks.getRequestId }));
vi.mock('./order-repository', () => ({
  getAdminAuditLogRepository: () => ({ record: mocks.record }),
}));
vi.mock('./manual-cancel-notice-read', () => ({
  readManualCancelNoticeEligibility: mocks.eligibility,
}));
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        mocks.insert(row);
        return { select: () => ({ maybeSingle: async () => mocks.insertResult }) };
      },
    }),
  }),
}));

const { recordManualCancelNoticeAction } = await import('./manual-cancel-notice-actions');

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const OK_FORM = { order_id: 'o-1', recipient_email: 'someone@example.com' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({ sid: 's-1', actorId: 'actor-1' });
  mocks.eligibility.mockResolvedValue({ eligible: true, suggestedEmail: null });
  mocks.record.mockResolvedValue(undefined);
  mocks.insertResult.error = null;
  mocks.insertResult.data = { id: 'e-1' };
});

describe('登錄人工寄出取消通知 — 閘的順序', () => {
  it('🔴 未授權 ⇒ 導 /orders 帶 namespaced denied、不讀資格、不寫稽核、不插', async () => {
    mocks.authorize.mockResolvedValue(null);
    await expect(recordManualCancelNoticeAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    // 🔴 參數斷言才是有判別力的那一半 —— 只驗「有拋」六條路都會過。
    expect(mocks.redirect).toHaveBeenCalledWith('/orders?r=manual_cancel_notice_denied');
    expect(mocks.eligibility).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('🔴 授權失敗時【不可以】把未信任的 order_id 放進網址', async () => {
    mocks.authorize.mockResolvedValue(null);
    await expect(
      recordManualCancelNoticeAction(form({ ...OK_FORM, order_id: 'evil' })),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(String(mocks.redirect.mock.calls[0]?.[0])).not.toContain('evil');
  });

  it('🔴 沒有 order_id ⇒ namespaced invalid', async () => {
    await expect(recordManualCancelNoticeAction(form({ recipient_email: 'a@b.co' }))).rejects.toThrow(
      'NEXT_REDIRECT',
    );
    expect(mocks.redirect).toHaveBeenCalledWith('/orders?r=manual_cancel_notice_invalid');
  });

  // 🔴🔴 codex 關卡1 must-fix ①:資格是**伺服器重讀的**, 不是信 UI。
  it('🔴 資格不符 ⇒ 用它的 blocker 當結果碼,而且【一個字都不寫】', async () => {
    mocks.eligibility.mockResolvedValue({ eligible: false, blocker: 'not_cancelled' });
    await expect(recordManualCancelNoticeAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith('/orders/o-1?r=manual_cancel_notice_not_cancelled');
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('🔴 讀不到 ⇒ unreadable(不是「不適用」)且不寫', async () => {
    mocks.eligibility.mockResolvedValue({ eligible: false, blocker: 'unreadable' });
    await expect(recordManualCancelNoticeAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith('/orders/o-1?r=manual_cancel_notice_unreadable');
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  // 🔴 codex 關卡1 must-fix ④:信箱走 `NotificationEmailInput`(含假信箱 gate)。
  it('🔴 合成信箱被擋 ⇒ email_invalid、不寫', async () => {
    await expect(
      recordManualCancelNoticeAction(
        form({ ...OK_FORM, recipient_email: 'x@no-reply.pcmmotorsports.local' }),
      ),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith('/orders/o-1?r=manual_cancel_notice_email_invalid');
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('🔴 亂填的字串 ⇒ email_invalid、不寫', async () => {
    await expect(
      recordManualCancelNoticeAction(form({ ...OK_FORM, recipient_email: '   ' })),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith('/orders/o-1?r=manual_cancel_notice_email_invalid');
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  // 🔴 codex 關卡1 must-fix ⑤:稽核【先寫】, 寫不成就不插。
  it('🔴 稽核寫不進去 ⇒ audit_failed,而且【那一列沒有被插】', async () => {
    mocks.record.mockRejectedValue(new Error('boom'));
    await expect(recordManualCancelNoticeAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith('/orders/o-1?r=manual_cancel_notice_audit_failed');
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('🔴 稽核的 actor 取自 session,不是表單', async () => {
    await expect(
      recordManualCancelNoticeAction(form({ ...OK_FORM, actor: 'i-am-somebody-else' })),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.record.mock.calls[0]?.[1]).toMatchObject({ actor: 'actor-1' });
  });

  it('🔴 稽核動作名是 _requested、after 留白(寫的當下還沒發生)', async () => {
    await expect(recordManualCancelNoticeAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    const entry = mocks.record.mock.calls[0]?.[0] ?? {};
    expect(entry.action).toBe('email.order_cancelled.manual_send_record_requested');
    expect(entry.after).toBeUndefined();
  });
});

describe('登錄人工寄出取消通知 — 寫進去的那一列', () => {
  it('🔴 dedup_key = 訂單 ID(沿用既有算法,不可以是新 UUID)', async () => {
    await expect(recordManualCancelNoticeAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    const row = mocks.insert.mock.calls[0]?.[0] ?? {};
    expect(row.dedup_key).toBe('o-1');
    expect(row.event_type).toBe('order_cancelled');
  });

  it('🔴 status 借用 sent,而【人工】的證據住在 payload 裡', async () => {
    await expect(recordManualCancelNoticeAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    const row = mocks.insert.mock.calls[0]?.[0] ?? {};
    expect(row.status).toBe('sent');
    expect(row.payload).toMatchObject({ manual: true, recorded_by: 'actor-1' });
  });

  it('🔴 attempts / max_attempts / next_retry_at 【不給】(有 DEFAULT;我們一次都沒試過寄)', async () => {
    await expect(recordManualCancelNoticeAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    const row = mocks.insert.mock.calls[0]?.[0] ?? {};
    expect(row.attempts).toBeUndefined();
    expect(row.max_attempts).toBeUndefined();
    expect(row.next_retry_at).toBeUndefined();
  });

  // 🔴🔴 **這一格就是 code-reviewer must-fix ② 那條**:
  //    `backTo()` 若被包在 try 裡, 這裡會拿到 `write_failed` 而不是 `raced`。
  it('🔴 撞唯一鍵(23505)⇒ raced,【不是】write_failed、更不是「已登錄」', async () => {
    mocks.insertResult.error = { code: '23505', message: 'duplicate key' };
    mocks.insertResult.data = null;
    await expect(recordManualCancelNoticeAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith('/orders/o-1?r=manual_cancel_notice_raced');
  });

  it('🔴 其他 DB 錯 ⇒ write_failed', async () => {
    mocks.insertResult.error = { code: '42501', message: 'denied' };
    mocks.insertResult.data = null;
    await expect(recordManualCancelNoticeAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith('/orders/o-1?r=manual_cancel_notice_write_failed');
  });

  // 🔴🔴 成功【不帶結果碼】—— `?r=` 偽造得出來, 假的綠字會讓員工停止動作。
  it('🔴 成功 ⇒ 導回訂單頁而網址【沒有】結果碼,且有 revalidate', async () => {
    await expect(recordManualCancelNoticeAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenLastCalledWith('/orders/o-1');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/orders/o-1');
  });
});
