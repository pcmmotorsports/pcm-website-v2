import { describe, expect, it } from 'vitest';
import type { HomeBannerSystemDraft, InboundMailRecord } from '@pcm/ports';
import { SupabaseSupplierNewProductStore } from './SupabaseSupplierNewProductStore';

function fakeClient(result: { data: unknown; error: unknown }) {
  const calls: { kind: string; args: unknown[] }[] = [];
  const query = {
    select: (...args: unknown[]) => { calls.push({ kind: 'select', args }); return query; },
    in: (...args: unknown[]) => { calls.push({ kind: 'in', args }); return query; },
    then: (resolve: (r: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  };
  return {
    calls,
    client: {
      from: (table: string) => { calls.push({ kind: 'from', args: [table] }); return query; },
      rpc: (fn: string, args: Record<string, unknown>) => { calls.push({ kind: 'rpc', args: [fn, args] }); return Promise.resolve(result); },
    },
  };
}

const record: InboundMailRecord = {
  gmailMessageId: 'm1', gmailThreadId: 't1', sender: 'news@akrapovic.com', subject: 's', receivedAt: '2026-09-15T22:12:00.000Z',
  authPassed: true, status: 'drafted', extracted: { skus: [] }, errorCode: null,
};
const draft: HomeBannerSystemDraft = {
  eyebrow: 'E', titleLine1: 'T1', titleLine2: null, subtitle: null, ctaLabel: '看', linkPath: '/brands/akrapovic',
  imageDesktopUrl: 'https://x/a.jpg', imageKind: 'scene', matchedVariantIds: ['v1'],
};

describe('SupabaseSupplierNewProductStore', () => {
  it('🔴 failed 的信不算讀過(下一輪重跑)', async () => {
    const { client } = fakeClient({
      data: [
        { gmail_message_id: 'a', status: 'drafted' },
        { gmail_message_id: 'b', status: 'failed' },
        { gmail_message_id: 'c', status: 'skipped_sender' },
      ],
      error: null,
    });
    const known = await new SupabaseSupplierNewProductStore(client).knownMessageIds(['a', 'b', 'c', 'd']);
    expect([...known].sort()).toEqual(['a', 'c']);
  });

  it('record 走 system_supplier_mail_record,欄位轉 snake_case、草稿一起送、帶 request id', async () => {
    const { client, calls } = fakeClient({ data: 'recorded', error: null });
    const store = new SupabaseSupplierNewProductStore(client, () => 'req-fixed');
    await expect(store.record(record, draft)).resolves.toBe('recorded');
    const rpc = calls.find((c) => c.kind === 'rpc')!;
    expect(rpc.args[0]).toBe('system_supplier_mail_record');
    expect(rpc.args[1]).toEqual({
      p_record: {
        gmail_message_id: 'm1', gmail_thread_id: 't1', sender: 'news@akrapovic.com', subject: 's', received_at: '2026-09-15T22:12:00.000Z',
        auth_passed: true, status: 'drafted', extracted: { skus: [] }, error_code: null,
      },
      p_draft: {
        eyebrow: 'E', title_line1: 'T1', title_line2: null, subtitle: null, cta_label: '看', link_path: '/brands/akrapovic',
        image_desktop_url: 'https://x/a.jpg', image_kind: 'scene', matched_variant_ids: ['v1'],
      },
      p_request_id: 'req-fixed',
    });
  });

  it('duplicate 原樣回;DB 錯 throw;怪回傳碼 throw', async () => {
    await expect(new SupabaseSupplierNewProductStore(fakeClient({ data: 'duplicate', error: null }).client).record(record, null)).resolves.toBe('duplicate');
    await expect(new SupabaseSupplierNewProductStore(fakeClient({ data: null, error: { code: '23514' } }).client).record(record, null)).rejects.toEqual({ code: '23514' });
    await expect(new SupabaseSupplierNewProductStore(fakeClient({ data: 'ok', error: null }).client).record(record, null)).rejects.toThrow('回傳碼不對');
  });
});
