import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
const getVerifiedUser = vi.fn();
vi.mock('@/lib/auth/verified-user', () => ({ getVerifiedUser: () => getVerifiedUser() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { submitDealerApplicationAction, updateDealerApplicationAction } from './actions';

const values = {
  companyName: '〇〇車業', taxId: '12345678', storeName: '', region: '臺北市',
  contactName: '王小明', contactPhone: '0912345678', contactEmail: 'a@x.tw', note: '',
};

beforeEach(() => {
  rpc.mockReset();
  getVerifiedUser.mockReset();
  getVerifiedUser.mockResolvedValue({ supabase: { rpc }, user: { id: 'u1' }, error: null });
});

describe('送出經銷商申請(server action)', () => {
  it('🔴 登入已過期 ⇒ 不送到資料庫, 回 session_expired', async () => {
    getVerifiedUser.mockResolvedValue({ supabase: { rpc }, user: null, error: null });
    const r = await submitDealerApplicationAction(values);
    expect(rpc).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: false, kind: 'session_expired' });
  });

  it('🔴 7 碼統編 ⇒ 擋在 server, 不送到資料庫', async () => {
    const r = await submitDealerApplicationAction({ ...values, taxId: '1234567' });
    expect(rpc).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: false, fieldErrors: { taxId: '統一編號是 8 位數字，請再確認一次。' } });
  });

  it('合法 ⇒ 用整理過的值呼叫 dealer_application_submit, 不帶任何身分參數', async () => {
    rpc.mockResolvedValue({ data: 'new-id', error: null });
    const r = await submitDealerApplicationAction({ ...values, companyName: ' 〇〇車業 ', taxId: '1234 5678' });
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('dealer_application_submit', {
      p_company_name: '〇〇車業', p_tax_id: '12345678', p_store_name: '', p_region: '臺北市',
      p_contact_name: '王小明', p_contact_phone: '0912345678', p_contact_email: 'a@x.tw', p_note: '',
    });
  });

  it('資料庫回 23505 ⇒ 已有一筆審核中', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate' } });
    expect(await submitDealerApplicationAction(values)).toMatchObject({ ok: false, kind: 'already_pending' });
  });

  it('其他錯誤 ⇒ 通用失敗訊息', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'boom' } });
    expect(await submitDealerApplicationAction(values)).toMatchObject({ ok: false, kind: 'failed' });
  });

  it('收到的不是物件或欄位不是字串 ⇒ 擋下, 不送到資料庫', async () => {
    expect(await submitDealerApplicationAction(null as never)).toMatchObject({ ok: false, kind: 'invalid' });
    expect(await submitDealerApplicationAction({ ...values, taxId: 12345678 } as never)).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('修改審核中的申請(片 B2)', () => {
  const id = '11111111-1111-4111-8111-111111111111';

  it('🔴 登入已過期 ⇒ 不送到資料庫', async () => {
    getVerifiedUser.mockResolvedValue({ supabase: { rpc }, user: null, error: null });
    expect(await updateDealerApplicationAction(id, values)).toMatchObject({ ok: false, kind: 'session_expired' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('申請編號不是 uuid ⇒ 擋下, 不送到資料庫', async () => {
    expect(await updateDealerApplicationAction('abc', values)).toMatchObject({ ok: false, kind: 'invalid' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('合法 ⇒ 呼叫 dealer_application_update_mine, 回 true ⇒ ok', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await updateDealerApplicationAction(id, { ...values, companyName: ' 新名 ' })).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('dealer_application_update_mine', expect.objectContaining({ p_id: id, p_company_name: '新名' }));
  });

  it('🔴 資料庫更新 0 筆(回 false)⇒ 已經審核完成, 不是「已更新」', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await updateDealerApplicationAction(id, values)).toEqual({
      ok: false,
      kind: 'already_decided',
      message: '這筆申請已經審核完成，無法再修改。請重新整理查看結果。',
    });
  });

  it('回傳不是 true 也不是 false ⇒ 當成失敗, 不宣稱已更新', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await updateDealerApplicationAction(id, values)).toMatchObject({
      ok: false,
      kind: 'failed',
      message: '修改沒有儲存成功，請稍後再試一次。若仍無法儲存，請直接聯絡 PCM 業務。',
    });
  });
});
