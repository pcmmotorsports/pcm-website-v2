import { describe, expect, it } from 'vitest';
import { decideDealerApplyView, type MineRow } from './view';

// B2B 計畫 §9.7「開頁時先決定顯示哪一種畫面」:依序判斷, 命中就停。
const row = (status: MineRow['status']): MineRow => ({
  id: 'a1', company_name: '〇〇車業', tax_id: '12345678', store_name: '', region: '臺北市',
  contact_name: '王', contact_phone: '0912345678', contact_email: 'a@x.tw', note: '',
  status, decided_at: status === 'pending' ? null : '2026-09-25T01:00:00Z',
  created_at: '2026-09-24T01:00:00Z', updated_at: '2026-09-24T01:00:00Z',
});

describe('申請頁顯示哪一種畫面', () => {
  it('帳號已經是經銷(store)⇒ 已開通, 不管有沒有申請紀錄', () => {
    expect(decideDealerApplyView({ tier: 'store', mine: null, readFailed: false }).kind).toBe('dealer');
    expect(decideDealerApplyView({ tier: 'store', mine: row('rejected'), readFailed: false }).kind).toBe('dealer');
  });
  it('🔴 審核中 ⇒ 顯示「申請已送出」, 看不到空白表單', () => {
    expect(decideDealerApplyView({ tier: 'general', mine: row('pending'), readFailed: false }).kind).toBe('pending');
  });
  it('已核准但等級不是經銷 ⇒ 不能顯示「已開通」, 請他聯絡業務', () => {
    expect(decideDealerApplyView({ tier: 'general', mine: row('approved'), readFailed: false }).kind).toBe('approved_not_effective');
  });
  it('被婉拒 ⇒ 顯示未通過, 可重新申請(帶入上一次的資料)', () => {
    const v = decideDealerApplyView({ tier: 'general', mine: row('rejected'), readFailed: false });
    expect(v.kind).toBe('rejected');
    if (v.kind === 'rejected') expect(v.prefill.companyName).toBe('〇〇車業');
  });
  it('沒有任何申請 ⇒ 空白表單', () => {
    expect(decideDealerApplyView({ tier: 'general', mine: null, readFailed: false }).kind).toBe('form');
  });
  it('🔴 讀申請紀錄失敗 ⇒ 錯誤訊息, 不是空白表單(否則已送過的人會以為沒送出而重送)', () => {
    expect(decideDealerApplyView({ tier: 'general', mine: null, readFailed: true }).kind).toBe('load_error');
  });
  it('片 B2:審核中而且要求修改(edit)⇒ 修改表單, 帶入現在的資料與申請編號', () => {
    const v = decideDealerApplyView({ tier: 'general', mine: row('pending'), readFailed: false, edit: true });
    expect(v.kind).toBe('edit');
    if (v.kind === 'edit') {
      expect(v.id).toBe('a1');
      expect(v.prefill.companyName).toBe('〇〇車業');
    }
  });
  it('🔴 已經審核完成的申請帶 edit ⇒ 不給修改表單(照狀態顯示)', () => {
    expect(decideDealerApplyView({ tier: 'general', mine: row('rejected'), readFailed: false, edit: true }).kind).toBe('rejected');
    expect(decideDealerApplyView({ tier: 'general', mine: row('approved'), readFailed: false, edit: true }).kind).toBe('approved_not_effective');
  });

  it('premiumStore 這次不啟用, 不算經銷 ⇒ 照申請狀態判斷', () => {
    expect(decideDealerApplyView({ tier: 'premiumStore', mine: null, readFailed: false }).kind).toBe('form');
  });
});
