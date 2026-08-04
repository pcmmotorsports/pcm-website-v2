import { describe, expect, it } from 'vitest';
import {
  parseRecoveryJudgeForm,
  parseRecoveryResolveForm,
} from './refund-recovery-form';
import {
  RECOVERY_CONFIRM_FIELD,
  RECOVERY_DR_CODE_FIELD,
  RECOVERY_REFUND_ID_FIELD,
  RECOVERY_REQUEST_TOKEN_FIELD,
  RECOVERY_RESOLUTION_FIELD,
} from './refund-recovery-state';

// refund-recovery-form.test.ts — RW4 兩張表單的形狀鏡像(RPC 步 1-2 恢復半邊+人因閘)。

const REFUND_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const TOKEN = '9f8e7d6c-5b4a-4321-a987-654321fedcba';

function form(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries));
  return { get: (name: string) => map.get(name) ?? null };
}

describe('parseRecoveryJudgeForm', () => {
  it('正:uuid 形狀的 refund_id', () => {
    expect(parseRecoveryJudgeForm(form({ [RECOVERY_REFUND_ID_FIELD]: REFUND_ID }))).toEqual({
      ok: true,
      refundId: REFUND_ID,
    });
  });

  it('負:缺欄 / 非 uuid', () => {
    expect(parseRecoveryJudgeForm(form({}))).toEqual({ ok: false });
    expect(parseRecoveryJudgeForm(form({ [RECOVERY_REFUND_ID_FIELD]: 'not-a-uuid' }))).toEqual({
      ok: false,
    });
  });
});

function resolveEntries(over: Record<string, string> = {}): Record<string, string> {
  return {
    [RECOVERY_REFUND_ID_FIELD]: REFUND_ID,
    [RECOVERY_REQUEST_TOKEN_FIELD]: TOKEN,
    [RECOVERY_RESOLUTION_FIELD]: 'mark_failed',
    [RECOVERY_CONFIRM_FIELD]: '0087',
    ...over,
  };
}

describe('parseRecoveryResolveForm — mark_failed', () => {
  it('正:確認碼 4 位英數 + 無 DR 碼(缺欄或空字串皆可)', () => {
    expect(parseRecoveryResolveForm(form(resolveEntries()))).toEqual({
      ok: true,
      refundId: REFUND_ID,
      requestToken: TOKEN,
      resolution: 'mark_failed',
      drCode: null,
      confirmCode: '0087',
    });
    expect(
      parseRecoveryResolveForm(form(resolveEntries({ [RECOVERY_DR_CODE_FIELD]: '  ' }))),
    ).toMatchObject({ ok: true, resolution: 'mark_failed' });
  });

  it('🔴 負:缺確認碼 / 形狀不合(opus C3:一鍵零摩擦是人因洞,4 位英數必填)', () => {
    expect(
      parseRecoveryResolveForm(form(resolveEntries({ [RECOVERY_CONFIRM_FIELD]: '' }))),
    ).toEqual({ ok: false });
    expect(
      parseRecoveryResolveForm(form(resolveEntries({ [RECOVERY_CONFIRM_FIELD]: '00877' }))),
    ).toEqual({ ok: false });
  });

  it('🔴 負:標記失敗帶 DR 碼=矛盾表單(鏡像 RPC「manual_failed 不得帶 tappay_refund_id」)', () => {
    expect(
      parseRecoveryResolveForm(form(resolveEntries({ [RECOVERY_DR_CODE_FIELD]: 'DR123' }))),
    ).toEqual({ ok: false });
  });
});

describe('parseRecoveryResolveForm — recover_confirmed', () => {
  const recover = (dr: string, extra: Record<string, string> = {}) =>
    resolveEntries({
      [RECOVERY_RESOLUTION_FIELD]: 'recover_confirmed',
      [RECOVERY_DR_CODE_FIELD]: dr,
      [RECOVERY_CONFIRM_FIELD]: '',
      ...extra,
    });

  it('正:DR 碼 trim 後過 `^\\S{1,64}$`(貼上尾隨空白是常態)', () => {
    expect(parseRecoveryResolveForm(form(recover(' DR20260803gvcV5i ')))).toEqual({
      ok: true,
      refundId: REFUND_ID,
      requestToken: TOKEN,
      resolution: 'recover_confirmed',
      drCode: 'DR20260803gvcV5i',
      confirmCode: null,
    });
    expect(parseRecoveryResolveForm(form(recover('x'.repeat(64))))).toMatchObject({ ok: true });
  });

  it('負:缺 DR 碼 / 內含空白 / 超 64;帶確認碼=矛盾表單(恢復表單沒這欄)', () => {
    expect(parseRecoveryResolveForm(form(recover('')))).toEqual({ ok: false });
    expect(parseRecoveryResolveForm(form(recover('DR 123')))).toEqual({ ok: false });
    expect(parseRecoveryResolveForm(form(recover('x'.repeat(65))))).toEqual({ ok: false });
    expect(
      parseRecoveryResolveForm(
        form(recover('DR123', { [RECOVERY_CONFIRM_FIELD]: '0087' })),
      ),
    ).toEqual({ ok: false });
  });
});

describe('parseRecoveryResolveForm — 共同欄', () => {
  it('負:refund_id 非 uuid / token 非 v4 小寫 / resolution 不在 allowlist', () => {
    expect(
      parseRecoveryResolveForm(form(resolveEntries({ [RECOVERY_REFUND_ID_FIELD]: 'nope' }))),
    ).toEqual({ ok: false });
    expect(
      parseRecoveryResolveForm(
        form(resolveEntries({ [RECOVERY_REQUEST_TOKEN_FIELD]: TOKEN.toUpperCase() })),
      ),
    ).toEqual({ ok: false });
    expect(
      parseRecoveryResolveForm(form(resolveEntries({ [RECOVERY_RESOLUTION_FIELD]: 'confirm' }))),
    ).toEqual({ ok: false });
  });
});
