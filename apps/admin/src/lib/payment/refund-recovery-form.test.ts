import { describe, expect, it } from 'vitest';
import {
  RECOVERY_SINGLE_FIELDS,
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

// 🔴 #365(關卡2 審查 MF5):原本是 Map-based 假表單 —— 它**結構上construct 不出重複欄位**,
//    補一支 getAll 只是讓型別過關、對「送兩份」零判別力。改用**真 FormData**,
//    既有測試呼叫方式不變(仍吃 Record),而重複欄位那族才有得測。
function form(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [name, value] of Object.entries(entries)) f.append(name, value);
  return f;
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

describe('#365 逐欄「送兩份 → 被拒」(同時是欄位清單完整性的守門)', () => {
  function dupResolve(field: string): FormData {
    const f = new FormData();
    f.append(RECOVERY_REFUND_ID_FIELD, REFUND_ID);
    f.append(RECOVERY_REQUEST_TOKEN_FIELD, TOKEN);
    f.append(RECOVERY_RESOLUTION_FIELD, 'mark_failed');
    f.append(RECOVERY_CONFIRM_FIELD, 'ab12');
    // 🔴 保證真的變成「兩筆」:base 沒有的欄位(如 mark_failed 不帶 dr_code)要補到兩筆,
    //    只 append 一次會變成「送一份」⇒ 測不到重複、還會綠得像通過。
    const existing = f.getAll(field);
    const value = (existing[0] as string | undefined) ?? 'x1';
    if (existing.length === 0) f.append(field, value);
    f.append(field, value);
    return f;
  }

  it.each([...RECOVERY_SINGLE_FIELDS])('resolve:%s 送兩份 → ok:false', (field) => {
    expect(parseRecoveryResolveForm(dupResolve(field)).ok).toBe(false);
  });

  it('🔴 RECOVERY_SINGLE_FIELDS 逐字等於五欄(手寫對照,不走訪同一常數)', () => {
    expect([...RECOVERY_SINGLE_FIELDS].sort()).toEqual(
      ['refund_id', 'request_token', 'resolution', 'dr_code', 'confirm_code'].sort(),
    );
  });

  it('🔴 mark_failed + dr_code 是單一 File → ok:false(數量是 1、型別不是字串也要擋)', () => {
    const f = new FormData();
    f.append(RECOVERY_REFUND_ID_FIELD, REFUND_ID);
    f.append(RECOVERY_REQUEST_TOKEN_FIELD, TOKEN);
    f.append(RECOVERY_RESOLUTION_FIELD, 'mark_failed');
    f.append(RECOVERY_CONFIRM_FIELD, 'ab12');
    f.append(RECOVERY_DR_CODE_FIELD, new File(['DR1'], 'a.txt'));
    expect(parseRecoveryResolveForm(f).ok).toBe(false);
  });

  it('judge:refund_id 送兩份 → ok:false', () => {
    const f = new FormData();
    f.append(RECOVERY_REFUND_ID_FIELD, REFUND_ID);
    f.append(RECOVERY_REFUND_ID_FIELD, REFUND_ID);
    expect(parseRecoveryJudgeForm(f).ok).toBe(false);
  });

  // 🔴🔴 關卡2 實跑抓到的兩條 fail-open(互斥檢查靠「這欄是空的」判斷):
  it('🔴 mark_failed + dr_code 送兩份 → ok:false(不得因讀成 null 而跳過互斥擋)', () => {
    const f = new FormData();
    f.append(RECOVERY_REFUND_ID_FIELD, REFUND_ID);
    f.append(RECOVERY_REQUEST_TOKEN_FIELD, TOKEN);
    f.append(RECOVERY_RESOLUTION_FIELD, 'mark_failed');
    f.append(RECOVERY_CONFIRM_FIELD, 'ab12');
    f.append(RECOVERY_DR_CODE_FIELD, 'DR1');
    f.append(RECOVERY_DR_CODE_FIELD, 'DR2');
    expect(parseRecoveryResolveForm(f).ok).toBe(false);
  });

  it('🔴 recover_confirmed + confirm_code 送兩份 → ok:false(同型)', () => {
    const f = new FormData();
    f.append(RECOVERY_REFUND_ID_FIELD, REFUND_ID);
    f.append(RECOVERY_REQUEST_TOKEN_FIELD, TOKEN);
    f.append(RECOVERY_RESOLUTION_FIELD, 'recover_confirmed');
    f.append(RECOVERY_DR_CODE_FIELD, 'DR1');
    f.append(RECOVERY_CONFIRM_FIELD, 'ab12');
    f.append(RECOVERY_CONFIRM_FIELD, 'cd34');
    expect(parseRecoveryResolveForm(f).ok).toBe(false);
  });
});
