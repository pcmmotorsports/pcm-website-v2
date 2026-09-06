import { readFileSync } from 'node:fs';
import path from 'node:path';
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
  rowForAudit: vi.fn<(orderId: string) => Promise<unknown>>(),
  phoneMark: vi.fn<(orderId: string) => Promise<unknown>>(),
  // 🔴 型別要給足 —— `mock.calls[0]?.[0]` 在無型別的 `vi.fn()` 上是 `never`,
  //    而 vitest 跑得動、`tsc` 不收(2026-09-06 實測 build 紅 4 條)。
  insert: vi.fn<(row: Record<string, unknown>) => void>(),
  // 🔴 插入的回應放這裡, **不要掛在 mock 函式身上** —— 那需要 `as unknown as {...}` 硬轉,
  //    而硬轉正是 `tsc` 擋下的東西。
  // RPC 回的形狀:`{ data: { result }, error }`。
  insertResult: {
    error: null as { code?: string; message?: string } | null,
    data: { result: 'ok' } as unknown,
  },
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
  // 🔵 撤銷那條路要先把那一列讀下來當稽核的 `before`(不是編的)。
  readManualCancelNoticeRowForAudit: mocks.rowForAudit,
  readPhoneNotifiedMark: mocks.phoneMark,
}));
// 🔴 **2026-09-06 起走 RPC 不走 `.from().insert()`** —— 資格重檢與寫入被關進同一個交易
//    (`record_manual_cancel_notice`, `20260906920000`;codex R3 must-fix ①)。
//    ⇒ 這裡的假 client 也要跟著換形狀, 否則測到的是一個**已經不存在的路徑**。
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({
    rpc: (fn: string, args: Record<string, unknown>) => {
      mocks.insert({ fn, ...args });
      // 🔵 兩支 RPC 共用同一個假回應槽 —— 每一格自己設它要的 result。
      return Promise.resolve(mocks.insertResult);
    },
  }),
}));

const { recordManualCancelNoticeAction, revokeManualCancelNoticeAction, markPhoneNotifiedAction } =
  await import('./manual-cancel-notice-actions');

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

// 🔴 表單送**大寫** UUID, 而 DB 回**小寫** —— 兩者在 `uuid` 欄位是同一張單。
// ⚠️ **這個 UUID 一定要含字母** —— 我第一版用全數字的 `1111…`, 而 `.toUpperCase()` 回同一個字串
//    ⇒ 那一格的 `not.toBe` 當場紅。📌 **一個「大小寫不同」的測試, 要先確定它真的不同。**
const OK_FORM = {
  order_id: 'a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d'.toUpperCase(),
  recipient_email: 'someone@example.com',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({ sid: 's-1', actorId: 'actor-1' });
  mocks.phoneMark.mockResolvedValue(null);
  mocks.rowForAudit.mockResolvedValue({
    id: 'e-1',
    manual: true,
    recipientEmail: 'someone@example.com',
    recordedBy: 'actor-1',
  });
  mocks.eligibility.mockResolvedValue({
    eligible: true,
    // 🔴 DB 正規化過的那一份(小寫), 與下面表單送的大寫**刻意不同** —— 見那一格測試。
    orderId: 'a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d',
    displayId: 'PCM-2026-0001',
    // 🔵 預設「沒有信箱」—— 電話通知那組需要它;登錄那組不看這一欄。
    suggestedEmail: null,
    customerEmailReadFailed: false,
  });
  mocks.record.mockResolvedValue(undefined);
  mocks.insertResult.error = null;
  mocks.insertResult.data = { result: 'ok' };
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
    expect(mocks.redirect).toHaveBeenCalledWith(`/orders/${OK_FORM.order_id}?r=manual_cancel_notice_not_cancelled`);
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('🔴 讀不到 ⇒ unreadable(不是「不適用」)且不寫', async () => {
    mocks.eligibility.mockResolvedValue({ eligible: false, blocker: 'unreadable' });
    await expect(recordManualCancelNoticeAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith(`/orders/${OK_FORM.order_id}?r=manual_cancel_notice_unreadable`);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  // 🔴 codex 關卡1 must-fix ④:信箱走 `NotificationEmailInput`(含假信箱 gate)。
  it('🔴 合成信箱被擋 ⇒ email_invalid、不寫', async () => {
    await expect(
      recordManualCancelNoticeAction(
        form({ ...OK_FORM, recipient_email: 'x@no-reply.pcmmotorsports.local' }),
      ),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith(`/orders/${OK_FORM.order_id}?r=manual_cancel_notice_email_invalid`);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('🔴 亂填的字串 ⇒ email_invalid、不寫', async () => {
    await expect(
      recordManualCancelNoticeAction(form({ ...OK_FORM, recipient_email: '   ' })),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith(`/orders/${OK_FORM.order_id}?r=manual_cancel_notice_email_invalid`);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  // 🔴 codex 關卡1 must-fix ⑤:稽核【先寫】, 寫不成就不插。
  it('🔴 稽核寫不進去 ⇒ audit_failed,而且【那一列沒有被插】', async () => {
    mocks.record.mockRejectedValue(new Error('boom'));
    await expect(recordManualCancelNoticeAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith(`/orders/${OK_FORM.order_id}?r=manual_cancel_notice_audit_failed`);
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

/**
 * 🛑 **這個 describe 的射程變了, 名字先說清楚**(codex 2026-09-06 nit)——
 * 2026-09-06 起那一列是**由 SQL 那側組的**(`record_manual_cancel_notice`, `20260906920000`)
 * ⇒ 📌 **這裡量得到的只有「我傳了什麼進 RPC」, 量不到「SQL 寫出什麼」。**
 * ⇒ 🔴 SQL 若把 `status` 寫成 `pending`、或漏掉 `payload.manual`, **本檔每一格照樣綠**。
 * ✅ **那一半由拋棄式 PG 那 13 格守**(見那支 migration 的 commit body):
 *    格1b 直接查 `email_outbox` 比對 `dedup_key` / `status` / `payload->>'manual'` / `recorded_by`。
 * ⇒ ⇒ **兩把尺各守一半, 而【只跑這一支】看不出 SQL 退步。**
 */
describe('登錄人工寄出取消通知 — 傳進 RPC 的參數(不是寫進去的那一列)', () => {
  it('🔴 dedup_key = 訂單 ID(沿用既有算法,不可以是新 UUID)', async () => {
    await expect(recordManualCancelNoticeAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    const row = mocks.insert.mock.calls[0]?.[0] ?? {};
    // 🔵 `dedup_key` 現在由 SQL 那側從 uuid 轉出來 ⇒ 這裡改問**傳進去的那個 id**。
    expect(row.fn).toBe('record_manual_cancel_notice');
    expect(row.p_order_id).toBe('a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d');
  });

  /**
   * 🔴🔴 **codex R3 must-fix ②:大小寫不同的 UUID 會繞過去重。**
   * `orders.id` 是 `uuid`(DB 正規化)而 `email_outbox.dedup_key` 是 **`text`**(不正規化)
   * ⇒ 表單送大寫、DB 回小寫時, 若我拿**表單那一份**當 dedup_key,
   *   兩個分頁就寫得出**兩筆**, 而唯一鍵完全攔不到。
   * ⇒ 這一格釘住:**寫進去的一定是 DB 回來的那一份, 不是網址上的那一份。**
   */
  it('🔴 表單送大寫 UUID ⇒ order_id 與 dedup_key 都要用【DB 回的小寫那一份】', async () => {
    await expect(recordManualCancelNoticeAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    const row = mocks.insert.mock.calls[0]?.[0] ?? {};
    // 表單送的是大寫(OK_FORM.order_id), 而傳進 RPC 的必須是 DB 回的小寫那一份。
    expect(row.p_order_id).toBe('a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d');
    expect(row.p_order_id).not.toBe(OK_FORM.order_id);
  });

  it('🔴 稽核的 target 也要用正規化那一份(不然同一張單會留下兩種寫法)', async () => {
    await expect(recordManualCancelNoticeAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    const entry = mocks.record.mock.calls[0]?.[0] ?? {};
    expect(entry.target).toBe('order:a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d');
  });

  it('🔴 status 借用 sent,而【人工】的證據住在 payload 裡', async () => {
    await expect(recordManualCancelNoticeAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    const row = mocks.insert.mock.calls[0]?.[0] ?? {};
    // 🔵 `status` 與 `payload` 現在由 SQL 那側組(見 20260906920000)⇒ 這裡改問
    //    **actor 有沒有從 session 傳過去**(payload 的 recorded_by 就是它)。
    expect(row.p_actor).toBe('actor-1');
    expect(row.p_recipient_email).toBe('someone@example.com');
  });

  it('🔴 attempts / max_attempts / next_retry_at 【不給】(有 DEFAULT;我們一次都沒試過寄)', async () => {
    await expect(recordManualCancelNoticeAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    const row = mocks.insert.mock.calls[0]?.[0] ?? {};
    // 🔵 那三欄現在**根本不經過 TS** —— SQL 那側不給值, 讓 DEFAULT 生效。
    //    ⇒ 這裡改釘「我沒有多傳任何欄位進去」。
    expect(Object.keys(row).sort()).toEqual(
      ['fn', 'p_actor', 'p_order_id', 'p_recipient_email', 'p_request_id'].sort(),
    );
  });

  // 🔴🔴 **這一格就是 code-reviewer must-fix ② 那條**:
  //    `backTo()` 若被包在 try 裡, 這裡會拿到 `write_failed` 而不是 `raced`。
  it('🔴 撞唯一鍵(23505)⇒ raced,【不是】write_failed、更不是「已登錄」', async () => {
    // 🔵 撞鍵現在由 SQL 那側接住並回 `raced`(它有 EXCEPTION 區塊), 不再靠 PostgREST 的 23505。
    mocks.insertResult.error = null;
    mocks.insertResult.data = { result: 'raced' };
    await expect(recordManualCancelNoticeAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith(`/orders/${OK_FORM.order_id}?r=manual_cancel_notice_raced`);
  });

  /**
   * 🔴🔴 **這一格釘的是 R3 must-fix ① 的下半**:TS 那側的資格檢查【過了】,
   * 而 RPC 在鎖住那張單之後**重算述詞發現已經不合格** ⇒ 回 `not_eligible`。
   * ⇒ 那表示**兩次檢查之間狀態真的變了** ⇒ 給人的話用 `raced` 最貼近事實。
   * 🛑 **不可以當成功** —— 當成功的話, 畫面會說「已登錄」而 DB 裡一列都沒有。
   */
  it('🔴 RPC 回 not_eligible(鎖之後才發現不合格)⇒ raced,不可以當成功', async () => {
    mocks.insertResult.error = null;
    mocks.insertResult.data = { result: 'not_eligible' };
    await expect(recordManualCancelNoticeAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith(`/orders/${OK_FORM.order_id}?r=manual_cancel_notice_raced`);
  });

  /**
   * 🔴 **RPC 回一個我不認得的字 ⇒ 也不可以當成功。**
   * 那表示 SQL 那側改了而這裡沒跟上 —— 而「安靜地當成功」會讓那張單被記成已處理。
   */
  it('🔴 RPC 回不認得的碼 ⇒ write_failed(不是成功)', async () => {
    mocks.insertResult.error = null;
    mocks.insertResult.data = { result: 'something_new_from_sql' };
    await expect(recordManualCancelNoticeAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith(
      `/orders/${OK_FORM.order_id}?r=manual_cancel_notice_write_failed`,
    );
  });

  it('🔴 其他 DB 錯 ⇒ write_failed', async () => {
    mocks.insertResult.error = { code: '42501', message: 'denied' };
    mocks.insertResult.data = null;
    await expect(recordManualCancelNoticeAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith(`/orders/${OK_FORM.order_id}?r=manual_cancel_notice_write_failed`);
  });

  // 🔴🔴 成功【不帶結果碼】—— `?r=` 偽造得出來, 假的綠字會讓員工停止動作。
  it('🔴 成功 ⇒ 導回訂單頁而網址【沒有】結果碼,且有 revalidate', async () => {
    await expect(recordManualCancelNoticeAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenLastCalledWith(`/orders/${OK_FORM.order_id}`);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/orders/${OK_FORM.order_id}`);
  });
});

describe('撤銷人工寄出取消通知的登錄', () => {
  it('🔴 未授權 ⇒ 導 /orders 帶 namespaced denied、不寫稽核、不叫 RPC', async () => {
    mocks.authorize.mockResolvedValue(null);
    await expect(revokeManualCancelNoticeAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith('/orders?r=manual_cancel_revoke_denied');
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  // 🔴 稽核【先寫】——「誰撤的」查不回來, 而撤銷可以晚一點。
  it('🔴 稽核寫不進去 ⇒ audit_failed,而且【沒有叫那支 RPC】', async () => {
    mocks.record.mockRejectedValue(new Error('boom'));
    await expect(revokeManualCancelNoticeAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith(
      `/orders/${OK_FORM.order_id}?r=manual_cancel_revoke_audit_failed`,
    );
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('🔴 稽核動作名是 _revoke_requested、actor 取自 session', async () => {
    mocks.insertResult.data = { result: 'ok' };
    await expect(revokeManualCancelNoticeAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    const entry = mocks.record.mock.calls[0]?.[0] ?? {};
    expect(entry.action).toBe('email.order_cancelled.manual_send_revoke_requested');
    expect(mocks.record.mock.calls[0]?.[1]).toMatchObject({ actor: 'actor-1' });
  });

  /**
   * 🔴🔴 **稽核的 `before` 要是【讀來的】** —— code-reviewer must-fix:
   * 我原本直接填 `{ order_cancelled_outbox_row: 'manual' }` **一個字都沒讀過**
   * ⇒ 繞過 UI 直呼 action、而那一列其實是系統寄的時候,
   *   **append-only 的稽核會永久記著一句假話**。
   */
  it('🔴 稽核的 before 帶【讀到的】那一列(不是我填的)', async () => {
    mocks.rowForAudit.mockResolvedValue({
      id: 'e-99',
      manual: false,
      recipientEmail: 'sys@example.com',
      recordedBy: null,
    });
    mocks.insertResult.data = { result: 'not_manual' };
    await expect(revokeManualCancelNoticeAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    const entry = mocks.record.mock.calls[0]?.[0] ?? {};
    // 🔴 它讀到的是 manual:false ⇒ 稽核就要記 false, 不可以記 'manual'。
    expect(entry.before).toMatchObject({ outbox_id: 'e-99', manual: false });
  });

  it('🔴 讀不到那一列 ⇒ 稽核記 null(那也是一個誠實的觀察)', async () => {
    mocks.rowForAudit.mockResolvedValue(null);
    mocks.insertResult.data = { result: 'not_found' };
    await expect(revokeManualCancelNoticeAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    const entry = mocks.record.mock.calls[0]?.[0] ?? {};
    expect(entry.before).toMatchObject({ order_cancelled_outbox_row: null });
  });

  /**
   * 🔴🔴 **成功要寫第二筆** —— 這是**硬刪**:成功之後 DB 裡連那一列都沒了
   * ⇒ 沒有第二筆的話,**事後沒有任何東西分得出「撤掉了」與「按了而沒撤成」**。
   */
  it('🔴 成功 ⇒ 寫第二筆稽核 _revoked,帶 deleted_id', async () => {
    mocks.insertResult.data = { result: 'ok', deleted_id: 'e-42' };
    await expect(revokeManualCancelNoticeAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.record).toHaveBeenCalledTimes(2);
    const second = mocks.record.mock.calls[1]?.[0] ?? {};
    expect(second.action).toBe('email.order_cancelled.manual_send_revoked');
    expect(second.after).toMatchObject({ deleted_outbox_id: 'e-42' });
  });

  it('🔴 失敗 ⇒ 【只有】第一筆(不可以留下一筆看起來像撤成功的紀錄)', async () => {
    mocks.insertResult.data = { result: 'not_manual' };
    await expect(revokeManualCancelNoticeAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.record).toHaveBeenCalledTimes(1);
  });

  it('🔴 叫的是 revoke 那支 RPC,參數三個', async () => {
    mocks.insertResult.data = { result: 'ok' };
    await expect(revokeManualCancelNoticeAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    const call = mocks.insert.mock.calls[0]?.[0] ?? {};
    expect(call.fn).toBe('revoke_manual_cancel_notice');
    expect(Object.keys(call).sort()).toEqual(
      ['fn', 'p_actor', 'p_order_id', 'p_outbox_id', 'p_request_id'].sort(),
    );
  });

  /**
   * 🔴🔴 **compare-and-swap**(codex 2026-09-06 must-fix ①)——
   * 傳進去的必須是**我讀到的那一列的 id**, 不是「這張單」。
   * 🔬 失敗情境:甲讀到誤登錄 A、暫停;乙撤 A、**真的寄了信**、重新登錄 B;
   *    甲這時才進 RPC ⇒ 舊版(只傳 order_id)會**把 B 刪掉** ——
   *    📌 一筆有效的登錄被過期的請求撤銷, 而那位客人的提醒又冒出來、信其實寄過了。
   */
  it('🔴 傳進 RPC 的是【讀到的那一列的 id】,不是訂單 id', async () => {
    mocks.rowForAudit.mockResolvedValue({
      id: 'e-77',
      manual: true,
      recipientEmail: 'a@b.co',
      recordedBy: 'actor-1',
    });
    mocks.insertResult.data = { result: 'ok', deleted_id: 'e-77' };
    await expect(revokeManualCancelNoticeAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    const call = mocks.insert.mock.calls[0]?.[0] ?? {};
    expect(call.p_outbox_id).toBe('e-77');
    expect(call.p_outbox_id).not.toBe(call.p_order_id);
  });

  // 🔴 讀不到那一列 ⇒ **根本不該叫 RPC**(不然就是拿一個空 id 去撞運氣)。
  it('🔴 讀不到那一列 ⇒ not_found 且【沒有叫 RPC】', async () => {
    mocks.rowForAudit.mockResolvedValue(null);
    await expect(revokeManualCancelNoticeAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith(
      `/orders/${OK_FORM.order_id}?r=manual_cancel_revoke_not_found`,
    );
    expect(mocks.insert).not.toHaveBeenCalled();
    // 🔵 而稽核**已經留下第一筆**(記 null)—— 那也是一個誠實的觀察。
    expect(mocks.record).toHaveBeenCalledTimes(1);
  });

  // 🔴🔴 這一格最重要:**系統寄的那一列撤不掉**, 而訊息要說清楚為什麼。
  it('🔴 RPC 回 not_manual ⇒ 導 not_manual(不是成功、也不是一般失敗)', async () => {
    mocks.insertResult.data = { result: 'not_manual' };
    await expect(revokeManualCancelNoticeAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith(
      `/orders/${OK_FORM.order_id}?r=manual_cancel_revoke_not_manual`,
    );
  });

  it('🔴 RPC 回 not_found ⇒ not_found', async () => {
    mocks.insertResult.data = { result: 'not_found' };
    await expect(revokeManualCancelNoticeAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith(
      `/orders/${OK_FORM.order_id}?r=manual_cancel_revoke_not_found`,
    );
  });

  // 🔴 不認得的碼不可以當成功 —— 那表示 SQL 那側改了而這裡沒跟上。
  it('🔴 RPC 回不認得的碼 ⇒ revoke_failed(不是成功)', async () => {
    mocks.insertResult.data = { result: 'brand_new_code' };
    await expect(revokeManualCancelNoticeAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith(
      `/orders/${OK_FORM.order_id}?r=manual_cancel_revoke_revoke_failed`,
    );
  });

  it('🔴 成功 ⇒ 導回訂單頁而網址【沒有】結果碼,且有 revalidate', async () => {
    mocks.insertResult.data = { result: 'ok' };
    await expect(revokeManualCancelNoticeAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenLastCalledWith(`/orders/${OK_FORM.order_id}`);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/orders/${OK_FORM.order_id}`);
  });

  // 🔵 code-reviewer nit:這兩顆碼原本【沒有任何一格在問】。
  it('🔴 沒有 order_id ⇒ namespaced invalid、不寫稽核', async () => {
    await expect(revokeManualCancelNoticeAction(form({}))).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith('/orders?r=manual_cancel_revoke_invalid');
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('🔴 RPC 回 invalid_args ⇒ 也走 invalid(不是成功)', async () => {
    mocks.insertResult.data = { result: 'invalid_args' };
    await expect(revokeManualCancelNoticeAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith(
      `/orders/${OK_FORM.order_id}?r=manual_cancel_revoke_invalid`,
    );
  });

  // 🔴 `res.error` 那條路原本整個 describe 都沒設過 —— 它與「RPC 回不認得的碼」是兩條路。
  it('🔴 res.error(PostgREST 層失敗)⇒ revoke_failed', async () => {
    mocks.insertResult.error = { code: '42883', message: 'function does not exist' };
    mocks.insertResult.data = null;
    await expect(revokeManualCancelNoticeAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith(
      `/orders/${OK_FORM.order_id}?r=manual_cancel_revoke_revoke_failed`,
    );
    // 🔵 而稽核**已經留下第一筆**(那是刻意的:他確實按了)。
    expect(mocks.record).toHaveBeenCalledTimes(1);
  });
});

/**
 * 🔴🔴 **這一格釘的是【一句話變成假的】** —— code-reviewer 2026-09-06 must-fix。
 * 登錄鈕的 confirm 原本逐字寫著「後台目前沒有地方可以把它改回來」,
 * 而**撤銷鈕就是那個地方, 在同一顆 diff 裡做的** ⇒ 那句話當場變假。
 * 🔵 **repo 有同型前科與現成修法**:`receipt-undo-bar.tsx:75` 逐字記著
 *    「⛔ ~~更早的到貨紀錄目前還沒有撤銷入口~~ ⇒ 2026-09-03 `#450` 讓這句變成假的」,
 *    而 `receipt-undo-bar.test.tsx:102` 釘了一條 `not.toMatch`。**這裡照抄那根釘子。**
 * 🛑 **它守的不是碼, 是【對員工說的話】** —— 而那句話錯了, 員工就不會去按那顆救援鈕。
 */
describe('對外字面:不可以再說「沒有撤銷入口」', () => {
  const BUTTON = path.resolve(__dirname, '../../components/orders/manual-cancel-notice-button.tsx');

  it('🔴 那支元件裡不可以有【活的】「沒有地方可以把它改回來」', () => {
    const src = readFileSync(BUTTON, 'utf8');
    // 🔵 刪除線裡的舊字面要留著(搜舊句的人要在同一發撞到訂正)⇒ 只把它們剝掉再看。
    const live = src.replace(/~~[^~]*~~/g, '');
    expect(live, '撤銷鈕已經做了 ⇒ 這句話是假的').not.toMatch(/沒有地方可以把它改回來/);
    expect(live, '撤銷鈕已經做了 ⇒ 這句話是假的').not.toMatch(/撤銷那一片還沒做/);
  });

  it('🟢 正對照:剝刪除線這個做法本身是活的(舊字面確實還在檔裡)', () => {
    const src = readFileSync(BUTTON, 'utf8');
    // 舊字面**應該**還在(帶著刪除線), 否則上面那兩格會因為「整段被刪掉」而假綠。
    expect(src).toMatch(/沒有地方可以把它改回來/);
  });
});

describe('標記「已電話通知」', () => {
  it('🔴 未授權 ⇒ 導 /orders 帶 namespaced denied、不寫稽核', async () => {
    mocks.authorize.mockResolvedValue(null);
    await expect(markPhoneNotifiedAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith('/orders?r=manual_cancel_phone_denied');
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('🔴 沒有 order_id ⇒ namespaced invalid', async () => {
    await expect(markPhoneNotifiedAction(form({}))).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith('/orders?r=manual_cancel_phone_invalid');
  });

  it('🔴 已經標記過 ⇒ already_marked、不重複寫', async () => {
    mocks.phoneMark.mockResolvedValue({ actor: 'staff-1', at: '2026-09-06T10:00:00Z' });
    await expect(markPhoneNotifiedAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith(
      `/orders/${OK_FORM.order_id}?r=manual_cancel_phone_already_marked`,
    );
    expect(mocks.record).not.toHaveBeenCalled();
  });

  /**
   * 🔴🔴 **動作名是契約** —— 它同時住在 `20260906960000` 的述詞裡。
   * 打錯一個字 ⇒ 📌 **計數不會歸零, 而畫面說「已電話通知」** —— 兩邊各自看起來都正常。
   */
  it('🔴 稽核的動作名逐字 = email.order_cancelled.phone_notified', async () => {
    await expect(markPhoneNotifiedAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    const entry = mocks.record.mock.calls[0]?.[0] ?? {};
    expect(entry.action).toBe('email.order_cancelled.phone_notified');
  });

  /**
   * 🔴🔴 **`target` 必須用【DB 正規化過的小寫 id】, 不是表單那個字串。**
   * code-reviewer 2026-09-06 must-fix ①:SQL 述詞是 `'order:' || o.id::text`,
   * 而 `uuid_out` **恆輸出小寫** ⇒ 從大寫 UUID 網址按下去:
   *   · 述詞永遠不匹配 ⇒ **計數不會歸零**
   *   · 而 `readPhoneNotifiedMark` 走 text 等值 ⇒ **畫面說「已電話通知」**
   *   ⇒ 📌 **兩邊各自看起來都正常。**
   * 🛑 **這一格原本把那個缺陷釘成了期望值**(斷言寫 `OK_FORM.order_id` = 大寫)——
   *    修碼之後它紅了, 而**那是對的紅**。改的是期望值本身錯了, 不是拿測試去遷就碼。
   */
  it('🔴 target 用【DB 正規化的小寫 id】,不是表單送來的大寫', async () => {
    await expect(markPhoneNotifiedAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    const entry = mocks.record.mock.calls[0]?.[0] ?? {};
    expect(entry.target).toBe('order:a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d');
    expect(entry.target).not.toBe(`order:${OK_FORM.order_id}`);
  });

  // 🔴 資格不合 ⇒ 拒(code-reviewer must-fix ②:稽核 append-only, 寫錯了撤不回來)。
  /**
   * 🔴🔴 **server 也要檢查「真的沒有信箱」**(codex must-fix ②, 它在隔離探針重現過)。
   * ⛔ 舊版只檢查 `eligible` ⇒ 管理者**直接 POST**、或開頁之後有人**補上信箱**,
   *    這一發仍會寫入「沒有信箱、已電話通知」並**關掉那張單的提醒**
   *    ⇒ 🛑 而稽核 append-only ⇒ **關掉了就撤不回來。**
   */
  it('🔴 那張單【有信箱】⇒ invalid,而且一個字都不寫', async () => {
    mocks.eligibility.mockResolvedValue({
      eligible: true,
      orderId: 'a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d',
      displayId: 'PCM-2026-0001',
      suggestedEmail: 'real@gmail.com',
      customerEmailReadFailed: false,
    });
    await expect(markPhoneNotifiedAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith(
      `/orders/${OK_FORM.order_id}?r=manual_cancel_phone_invalid`,
    );
    expect(mocks.record).not.toHaveBeenCalled();
  });

  // 🔵 讀失敗也拒 —— 那是「我不知道有沒有信箱」, 不是「沒有」。
  it('🔴 讀 customers 失敗 ⇒ 也 invalid(不知道 ≠ 沒有)', async () => {
    mocks.eligibility.mockResolvedValue({
      eligible: true,
      orderId: 'a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d',
      displayId: 'PCM-2026-0001',
      suggestedEmail: null,
      customerEmailReadFailed: true,
    });
    await expect(markPhoneNotifiedAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('🔴 資格不合 ⇒ invalid,而且【一個字都不寫】', async () => {
    mocks.eligibility.mockResolvedValue({ eligible: false, blocker: 'not_cancelled' });
    await expect(markPhoneNotifiedAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith(
      `/orders/${OK_FORM.order_id}?r=manual_cancel_phone_invalid`,
    );
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('🔴 actor 取自 session,不是表單', async () => {
    await expect(
      markPhoneNotifiedAction(form({ ...OK_FORM, actor: 'somebody-else' })),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.record.mock.calls[0]?.[1]).toMatchObject({ actor: 'actor-1' });
  });

  it('🔴 稽核寫不進去 ⇒ audit_failed', async () => {
    mocks.record.mockRejectedValue(new Error('boom'));
    await expect(markPhoneNotifiedAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith(
      `/orders/${OK_FORM.order_id}?r=manual_cancel_phone_audit_failed`,
    );
  });

  it('🔴 成功 ⇒ 導回訂單頁而網址沒有結果碼,且只寫【一筆】稽核', async () => {
    await expect(markPhoneNotifiedAction(form(OK_FORM))).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenLastCalledWith(`/orders/${OK_FORM.order_id}`);
    // 🔵 只有一筆 —— 與撤銷那支不同, 因為這裡**沒有第二個步驟**。
    expect(mocks.record).toHaveBeenCalledTimes(1);
  });
});

/**
 * 🔴🔴 **動作名與 target 形狀是【跨語言的契約】, 而契約沒有守門就只是註解。**
 * code-reviewer 2026-09-06 important ⑥ 逐字:「你明寫了這個缺口, 而**明寫不是機制**」。
 *
 * 那個字面住在三個地方:①`20260906960000` 的 SQL 述詞 ②本 repo 的 TS 常數 ③讀回來那一句。
 * TS 那兩處已經共用常數(只寫一次), 而 **SQL 那份是獨立字面** ——
 * ⇒ 📌 分岔的症狀是**安靜的**:計數不歸零, 而畫面說「已電話通知」。
 *
 * 🛑 **而光守動作名不夠** —— must-fix ① 的分岔就發生在 **`target` 那一半**
 *    (動作名是對的, 錯的是大小寫)⇒ 本格**兩個維度都守**。
 */
describe('跨語言契約:動作名與 target 形狀', () => {
  const MIG = path.resolve(
    __dirname,
    '../../../../../supabase/migrations/20260906960000_m4b_cancelled_mixed_rail_phone_notified.sql',
  );

  /**
   * 🔴🔴 **先把註解剝掉再看**(codex 2026-09-06 nit ⑤)——
   * ⛔ 舊版直接掃全檔 ⇒ 把兩處述詞的動作名**改錯**、或把 target 的 `=` 改成 `<>`,
   *    三格**照樣全綠** —— 因為**註解裡也寫著那個字**。
   * ⇒ 📌 **一道掃全檔的守門, 會被它自己要守的那段文件餵飽。**
   * ✅ 只看 `$fn$ … $fn$` 之間那段函式體, 而且剝掉 `--` 行註解。
   */
  const fnBody = (): string => {
    const sql = readFileSync(MIG, 'utf8');
    const a = sql.indexOf('AS $fn$');
    const b = sql.indexOf('$fn$;', a);
    expect(a, '抓不到函式體 ⇒ 這把尺沒有接上').toBeGreaterThan(-1);
    expect(b, '抓不到函式體結尾 ⇒ 這把尺沒有接上').toBeGreaterThan(a);
    return sql
      .slice(a, b)
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n');
  };

  it('🔴 【函式體裡】要含 TS 這側同一個動作名', () => {
    expect(fnBody(), '動作名在 SQL 那側對不上 ⇒ 計數永遠不會歸零').toContain(
      'email.order_cancelled.phone_notified',
    );
  });

  it("🔴 【函式體裡】target 要是 `a.target = 'order:' || o.id`(兩處都要)", () => {
    // 🔵 連 `=` 一起釘 —— codex 指出改成 `<>` 舊版照樣綠。
    const hits = fnBody().match(/a\.target = 'order:' \|\| o\.id/g) ?? [];
    expect(hits.length, `target 比對只出現 ${hits.length} 處, 而述詞有兩格`).toBe(2);
  });

  it('🔵 負對照:剝註解這件事是活的(整支檔裡【有】而函式體裡【沒有】的字)', () => {
    const sql = readFileSync(MIG, 'utf8');
    // `codex` 這個字只出現在註解裡 ⇒ 全檔有、函式體沒有 ⇒ 證明我真的剝掉了註解。
    expect(sql).toContain('codex');
    expect(fnBody()).not.toContain('codex');
  });

  it('🔵 負對照:現造的動作名不在函式體裡(證明上面那格不是恆真)', () => {
    expect(fnBody()).not.toContain('email.order_cancelled.zzq9_never_notified');
  });
});
