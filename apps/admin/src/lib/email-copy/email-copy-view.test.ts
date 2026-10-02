import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { buildEmailCopyRows } from './email-copy-view';
import type { EmailCopyKey } from '@pcm/domain';

const v = (id: string, copyKey: string, text: string | null, savedAt: string, savedBy = 'staff-a') => ({ id, copyKey, text, savedAt, savedBy });
const samples = new Map<string, readonly EmailCopyKey[]>([
  ['unpaid_cancelled', ['greeting', 'unpaidCancelledNoCharge', 'companyLine', 'contactLead'] as EmailCopyKey[]],
]);
const rowOf = (rows: ReturnType<typeof buildEmailCopyRows>, key: string) => rows.find((r) => r.key === key)!;

describe('buildEmailCopyRows', () => {
  it('沒改過 ⇒ 預設文字, 沒有修改紀錄', () => {
    const r = rowOf(buildEmailCopyRows([], samples), 'greeting');
    expect(r).toMatchObject({ currentText: '您好，', isDefault: true, history: [], lockReason: null, defaultSampleId: 'unpaid_cancelled' });
  });
  it('改過 ⇒ 用最新一版;修改紀錄新到舊', () => {
    const r = rowOf(
      buildEmailCopyRows([v('a', 'greeting', '早安，', '2026-10-01T01:00:00Z'), v('b', 'greeting', '午安，', '2026-10-02T01:00:00Z')], samples),
      'greeting',
    );
    expect(r.currentText).toBe('午安，');
    expect(r.isDefault).toBe(false);
    expect(r.history.map((h) => h.text)).toEqual(['午安，', '早安，']);
    expect(r.history[0]?.savedAt).toBe('2026-10-02 09:00');
  });
  it('最新一版是還原(null)⇒ 預設', () => {
    const r = rowOf(buildEmailCopyRows([v('a', 'greeting', '早安，', '2026-10-01T01:00:00Z'), v('b', 'greeting', null, '2026-10-02T01:00:00Z')], samples), 'greeting');
    expect(r).toMatchObject({ currentText: '您好，', isDefault: true });
  });
  it('最新一版不符合現在的規則 ⇒ 顯示預設(寄信也用預設), 並提醒重新存', () => {
    const r = rowOf(buildEmailCopyRows([v('a', 'greeting', '您好<b>，', '2026-10-01T01:00:00Z')], samples), 'greeting');
    expect(r).toMatchObject({ currentText: '您好，', isDefault: true });
    expect(r.note).toMatch(/寄信時改用預設文字/);
    expect(r.history.map((h) => h.text)).toEqual(['您好<b>，']);
  });
  it('鎖住的句子 ⇒ 有原因, 表裡有字也不採用', () => {
    const r = rowOf(buildEmailCopyRows([v('a', 'contactLead', '問題請找 LINE', '2026-10-01T01:00:00Z')], samples), 'contactLead');
    expect(r.lockReason).toMatch(/LINE 通知/);
    expect(r.currentText).toBe('有任何問題，加入官方 LINE');
  });
  it('公司名稱、地址 ⇒ 提醒帳號停用信不跟著改;範例信看不到的句子 ⇒ defaultSampleId = null', () => {
    const rows = buildEmailCopyRows([], samples);
    expect(rowOf(rows, 'companyLine').note).toMatch(/帳號停用通知信/);
    expect(rowOf(rows, 'companyAddress').note).toMatch(/帳號停用通知信/);
    expect(rowOf(rows, 'paidLinesTruncated').defaultSampleId).toBeNull();
  });
});
