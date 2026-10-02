import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ getUserById: vi.fn(), authorize: vi.fn() }));
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({ auth: { admin: { getUserById: mocks.getUserById } } }),
}));
vi.mock('../session/authorize', () => ({ authorizeAdminMutation: mocks.authorize }));

import {
  AUTH_MAIL_MAX_PAGES,
  authMailStatusLabel,
  emailAddressOf,
  listRecentResendEmails,
  lookupAuthMail,
  resetLookupSlotForTest,
  summarizeAuthMail,
  type ResendListedEmail,
  type ResendListPage,
} from './auth-mail-lookup';
import { lookupAuthMailAction } from './auth-mail-lookup-action';

// 客戶頁「查最近寄信紀錄」(計畫 ~/pcm-mailbox/計畫-查得到驗證信有沒有寄出去-20261002.md §六)。

const ID = '11111111-1111-4111-8111-111111111111';
const FROM = 'PCM 重機零件販售 <no-reply@pcmmotorsports.com>';

function mail(over: Partial<ResendListedEmail> = {}): ResendListedEmail {
  return {
    id: 'e-1',
    to: ['wang@example.com'],
    from: FROM,
    subject: '確認您的 Email',
    created_at: '2026-10-02T07:40:00.000Z',
    last_event: 'delivered',
    ...over,
  };
}
const page = (data: ResendListedEmail[], has_more = false): ResendListPage => ({ data, has_more });

function okUser(over: Record<string, unknown> = {}) {
  mocks.getUserById.mockResolvedValue({
    data: { user: { email: 'wang@example.com', new_email: null, app_metadata: { providers: ['email'] }, ...over } },
    error: null,
  });
}

function fetchPages(...pages: Array<ResendListPage | 'fail' | 'throw'>) {
  const calls: string[] = [];
  const impl = vi.fn(async (url: string, _init?: unknown) => {
    calls.push(url);
    const p = pages[calls.length - 1];
    if (p === 'throw') throw Object.assign(new Error('timeout'), { name: 'AbortError' });
    if (p === 'fail' || p === undefined) return { ok: false, status: 429, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => p };
  });
  return { impl, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetLookupSlotForTest();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('summarizeAuthMail(純函式)', () => {
  it('寄件人帶顯示名稱也認得;收件人大小寫不同也對得到;別的寄件人不列', () => {
    const r = summarizeAuthMail(
      [
        page([
          mail({ id: 'a', to: ['WANG@Example.com'] }),
          mail({ id: 'b', from: 'PCM <orders@pcmmotorsports.com>' }),
          mail({ id: 'c', from: 'alerts@pcmmotorsports.com' }),
          mail({ id: 'd', to: ['lin@example.com'] }),
        ]),
      ],
      ['wang@example.com'],
    );
    expect(r.kind).toBe('found');
    if (r.kind === 'found') expect(r.rows).toHaveLength(1);
  });

  it('畫面只拿到 時間 / 主旨 / 狀態, 沒有收件人、副本、信件編號', () => {
    const r = summarizeAuthMail([page([mail({ id: 'secret-id' })])], ['wang@example.com']);
    if (r.kind !== 'found') throw new Error('應該找到');
    expect(Object.keys(r.rows[0] ?? {}).sort()).toEqual(['sentAt', 'status', 'subject']);
    expect(JSON.stringify(r)).not.toMatch(/secret-id|wang@example\.com/);
  });

  it('時間轉成台灣時間;狀態翻成中文, 對不上的照原值', () => {
    const r = summarizeAuthMail([page([mail()])], ['wang@example.com']);
    if (r.kind !== 'found') throw new Error('應該找到');
    expect(r.rows[0]).toMatchObject({ sentAt: '10/02 15:40', status: '已送達' });
    expect(authMailStatusLabel('bounced')).toBe('被退回');
    expect(authMailStatusLabel('some_new_event')).toBe('some_new_event');
    expect(authMailStatusLabel(null)).toBe('狀態不明');
  });

  it('沒有符合的:印實際查到的最舊時間, 不寫固定天數;沒有更多頁才說都查過了', () => {
    const more = summarizeAuthMail(
      [page([mail({ to: ['x@y.z'], created_at: '2026-10-01T01:12:00.000Z' }), mail({ to: ['x@y.z'] })], true)],
      ['wang@example.com'],
    );
    expect(more).toEqual({ kind: 'none', checkedSince: '10/01 09:12', allChecked: false });
    const done = summarizeAuthMail([page([mail({ to: ['x@y.z'] })], false)], ['wang@example.com']);
    expect(done).toMatchObject({ kind: 'none', allChecked: true });
  });

  it('整個列表是空的 ⇒ empty_account(不是「沒有寄過」)', () => {
    expect(summarizeAuthMail([page([])], ['wang@example.com'])).toEqual({ kind: 'empty_account' });
  });

  it('申請中的新信箱也比對', () => {
    const r = summarizeAuthMail([page([mail({ to: ['new@example.com'] })])], ['wang@example.com', 'new@example.com']);
    expect(r.kind).toBe('found');
  });

  it('emailAddressOf 取角括號裡那段並轉小寫', () => {
    expect(emailAddressOf('A <No-Reply@PCMmotorsports.com>')).toBe('no-reply@pcmmotorsports.com');
    expect(emailAddressOf(' x@Y.z ')).toBe('x@y.z');
  });
});

describe('listRecentResendEmails(讀 Resend)', () => {
  it('最多翻 3 頁, 用上一頁最後一封的編號往舊的方向翻', async () => {
    const full = (n: string) => page([mail({ id: `${n}-1` }), mail({ id: `${n}-last` })], true);
    const { impl, calls } = fetchPages(full('p1'), full('p2'), full('p3'), full('p4'));
    const pages = await listRecentResendEmails('k', impl);
    expect(pages).toHaveLength(AUTH_MAIL_MAX_PAGES);
    expect(calls).toEqual([
      'https://api.resend.com/emails?limit=100',
      'https://api.resend.com/emails?limit=100&after=p1-last',
      'https://api.resend.com/emails?limit=100&after=p2-last',
    ]);
  });

  it('沒有更多頁就停', async () => {
    const { impl, calls } = fetchPages(page([mail()], false));
    await listRecentResendEmails('k', impl);
    expect(calls).toHaveLength(1);
  });

  it('第 2 頁失敗 ⇒ 整次回 null, 不把第 1 頁當完整答案', async () => {
    const { impl } = fetchPages(page([mail()], true), 'fail');
    expect(await listRecentResendEmails('k', impl)).toBeNull();
  });

  it('401 / 403(金鑰只能寄信或已刪)⇒ key_rejected, 不是「稍後再試」', async () => {
    okUser();
    for (const status of [401, 403]) {
      resetLookupSlotForTest();
      const impl = vi.fn(async () => ({ ok: false, status, json: async () => ({}) }));
      expect(await lookupAuthMail(ID, { apiKey: 'k', fetchImpl: impl, now: 1 })).toEqual({ kind: 'key_rejected' });
    }
  });

  it('逾時 / 斷線 ⇒ null', async () => {
    const { impl } = fetchPages('throw');
    expect(await listRecentResendEmails('k', impl)).toBeNull();
  });

  it('Authorization 帶金鑰;log 不含任何信箱', async () => {
    okUser();
    const { impl } = fetchPages(page([mail()], false));
    await lookupAuthMail(ID, { apiKey: 'key-1', fetchImpl: impl, now: 1 });
    expect(impl.mock.calls.at(-1)?.[1]).toMatchObject({ headers: { Authorization: 'Bearer key-1' } });
    const logged = JSON.stringify([...vi.mocked(console.info).mock.calls, ...vi.mocked(console.error).mock.calls]);
    expect(logged).not.toMatch(/@/);
  });
});

describe('lookupAuthMail(整條路)', () => {
  it('沒有設定金鑰 ⇒ not_configured, 不查會員也不叫 Resend', async () => {
    const { impl } = fetchPages(page([mail()]));
    expect(await lookupAuthMail(ID, { apiKey: undefined, fetchImpl: impl, now: 1 })).toEqual({ kind: 'not_configured' });
    expect(await lookupAuthMail(ID, { apiKey: '  ', fetchImpl: impl, now: 1 })).toEqual({ kind: 'not_configured' });
    expect(mocks.getUserById).not.toHaveBeenCalled();
    expect(impl).not.toHaveBeenCalled();
  });

  it('LINE / 後台手動建 / Google 帳號 ⇒ not_applicable, 不叫 Resend', async () => {
    const { impl } = fetchPages(page([mail()]));
    for (const over of [
      { email: 'u1@line.pcmmotorsports.local', app_metadata: { providers: ['email'] } },
      { app_metadata: { providers: ['google'] } },
      { app_metadata: { providers: ['email', 'google'] } },
    ]) {
      okUser(over);
      expect(await lookupAuthMail(ID, { apiKey: 'k', fetchImpl: impl, now: 1 })).toEqual({ kind: 'not_applicable' });
    }
    expect(impl).not.toHaveBeenCalled();
  });

  it('讀不到會員 ⇒ error(暫時查不到), 不當成沒有紀錄', async () => {
    mocks.getUserById.mockResolvedValue({ data: { user: null }, error: { status: 500 } });
    const { impl } = fetchPages(page([mail()]));
    expect(await lookupAuthMail(ID, { apiKey: 'k', fetchImpl: impl, now: 1 })).toEqual({ kind: 'error' });
  });

  it('收件信箱用伺服器查到的那個', async () => {
    okUser({ email: 'real@example.com' });
    const { impl } = fetchPages(page([mail({ to: ['real@example.com'] })]));
    const r = await lookupAuthMail(ID, { apiKey: 'k', fetchImpl: impl, now: 1 });
    expect(r.kind).toBe('found');
  });

  it('同一實例 10 秒內第二次 ⇒ busy, 不叫 Resend;過了 10 秒可以再查', async () => {
    okUser();
    const { impl } = fetchPages(page([mail()]), page([mail()]));
    await lookupAuthMail(ID, { apiKey: 'k', fetchImpl: impl, now: 1_000 });
    expect(await lookupAuthMail(ID, { apiKey: 'k', fetchImpl: impl, now: 5_000 })).toEqual({ kind: 'busy' });
    expect(impl).toHaveBeenCalledTimes(1);
    expect((await lookupAuthMail(ID, { apiKey: 'k', fetchImpl: impl, now: 11_000 })).kind).toBe('found');
  });
});

describe('lookupAuthMailAction(伺服器動作)', () => {
  it('沒登入後台 ⇒ denied, 不查會員', async () => {
    mocks.authorize.mockResolvedValue(null);
    expect(await lookupAuthMailAction(ID)).toEqual({ kind: 'denied' });
    expect(mocks.getUserById).not.toHaveBeenCalled();
  });

  it('客戶編號格式不對 ⇒ error, 不查會員', async () => {
    mocks.authorize.mockResolvedValue({ actorId: 'probe' });
    expect(await lookupAuthMailAction('../etc')).toEqual({ kind: 'error' });
    expect(mocks.getUserById).not.toHaveBeenCalled();
  });
});
