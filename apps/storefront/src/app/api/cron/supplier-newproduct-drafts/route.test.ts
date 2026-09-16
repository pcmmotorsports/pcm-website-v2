// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { runSpy, depsSpy, senders } = vi.hoisted(() => ({
  runSpy: vi.fn(),
  depsSpy: vi.fn(),
  senders: [] as { sender: string; brandSlugs: string[]; rightsPolicy: string }[],
}));
vi.mock('@pcm/use-cases', () => ({ draftSupplierNewProductBanners: runSpy }));
vi.mock('@/lib/supplier-mail/composition', () => ({ getSupplierNewProductDraftDeps: depsSpy }));
vi.mock('@/data/supplier-mail-senders', () => ({ SUPPLIER_MAIL_SENDERS: senders }));

import { GET } from './route';
import { resetCronRateLimit } from '@/lib/cron/rate-limit';

const SECRET = 's'.repeat(48);
const req = (authorization?: string) =>
  new Request('http://localhost:3000/api/cron/supplier-newproduct-drafts', {
    headers: authorization === undefined ? {} : { authorization },
  });
const ALL_ENV = {
  SUPPLIER_MAIL_DRAFTS_ENABLED: 'on',
  GMAIL_OAUTH_CLIENT_ID: 'id',
  GMAIL_OAUTH_CLIENT_SECRET: 'client-secret-value',
  GMAIL_OAUTH_REFRESH_TOKEN: 'refresh-token-value',
  ANTHROPIC_API_KEY: 'anthropic-key-value',
};

beforeEach(() => {
  vi.clearAllMocks();
  resetCronRateLimit();
  vi.stubEnv('CRON_SECRET', SECRET);
  senders.length = 0;
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('GET /api/cron/supplier-newproduct-drafts', () => {
  it('沒帶 Bearer ⇒ 401', async () => {
    expect((await GET(req())).status).toBe(401);
    expect(runSpy).not.toHaveBeenCalled();
  });

  it('🔴 預設(旗標沒設)⇒ 200 disabled,不組依賴、不讀信', async () => {
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, enabled: false, skipped: 'disabled' });
    expect(depsSpy).not.toHaveBeenCalled();
    expect(runSpy).not.toHaveBeenCalled();
  });

  it('🔴 旗標開但 env 缺 ⇒ 200 missing_env,只回名字不回值', async () => {
    vi.stubEnv('SUPPLIER_MAIL_DRAFTS_ENABLED', 'on');
    vi.stubEnv('GMAIL_OAUTH_CLIENT_ID', 'id');
    const res = await GET(req(`Bearer ${SECRET}`));
    const body = await res.json();
    expect(body).toEqual({ ok: true, enabled: true, skipped: 'missing_env', missing: ['GMAIL_OAUTH_CLIENT_SECRET', 'GMAIL_OAUTH_REFRESH_TOKEN', 'ANTHROPIC_API_KEY'] });
    expect(runSpy).not.toHaveBeenCalled();
  });

  it('env 齊但白名單空 ⇒ 200 no_senders', async () => {
    for (const [k, v] of Object.entries(ALL_ENV)) vi.stubEnv(k, v);
    const body = await (await GET(req(`Bearer ${SECRET}`))).json();
    expect(body).toMatchObject({ skipped: 'no_senders' });
    expect(runSpy).not.toHaveBeenCalled();
  });

  it('全部齊 ⇒ 跑一輪、回計數;值不出現在回應', async () => {
    for (const [k, v] of Object.entries(ALL_ENV)) vi.stubEnv(k, v);
    senders.push({ sender: '@akrapovic.com', brandSlugs: ['akrapovic'], rightsPolicy: 'allowed' });
    depsSpy.mockReturnValue({ fake: true });
    runSpy.mockResolvedValue({ listed: 2, known: 0, skippedSender: 0, skippedAuth: 0, drafted: 1, noProducts: 1, failed: 0 });
    const res = await GET(req(`Bearer ${SECRET}`));
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(text)).toMatchObject({ ok: true, drafted: 1, noProducts: 1 });
    expect(depsSpy).toHaveBeenCalledWith({ gmailClientId: 'id', gmailClientSecret: 'client-secret-value', gmailRefreshToken: 'refresh-token-value', anthropicApiKey: 'anthropic-key-value' });
    expect(text).not.toContain('refresh-token-value');
  });

  it('列信失敗(授權失效)⇒ 503 + 分類碼', async () => {
    for (const [k, v] of Object.entries(ALL_ENV)) vi.stubEnv(k, v);
    senders.push({ sender: '@akrapovic.com', brandSlugs: ['akrapovic'], rightsPolicy: 'allowed' });
    runSpy.mockRejectedValue(Object.assign(new Error('x'), { code: 'gmail_auth_failed' }));
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: 'gmail_auth_failed' });
  });
});
