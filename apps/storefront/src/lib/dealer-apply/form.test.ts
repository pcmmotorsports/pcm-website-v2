import { describe, expect, it } from 'vitest';
import { TAIWAN_REGIONS, validateDealerApply, mapSubmitError, type DealerApplyValues } from './form';

// B2B 計畫 §9.7「八個欄位的輸入規則」。規則要與資料庫 CHECK(20260925010000)一致:
// 前台先擋、server action 再擋一次、資料庫最後一道。
const ok: DealerApplyValues = {
  companyName: '〇〇車業有限公司',
  taxId: '12345678',
  storeName: '小明車行',
  region: '臺北市',
  contactName: '王小明',
  contactPhone: '(02) 2345-6789',
  contactEmail: 'owner@example.com',
  note: '主要賣 Rizoma',
};

describe('經銷商申請表單檢查', () => {
  it('合法資料通過, 而且把前後空白(含全形空白)去掉、統編去掉中間空白', () => {
    const r = validateDealerApply({ ...ok, companyName: '　〇〇車業有限公司 ', taxId: '1234 5678', contactEmail: ' owner@example.com\t' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.values.companyName).toBe('〇〇車業有限公司');
      expect(r.values.taxId).toBe('12345678');
      expect(r.values.contactEmail).toBe('owner@example.com');
    }
  });

  it('縣市清單 22 個, 用「臺」不用「台」', () => {
    expect(TAIWAN_REGIONS).toHaveLength(22);
    expect(TAIWAN_REGIONS.join('')).not.toContain('台');
  });

  it.each([
    ['companyName', '   ', '請填寫公司或商號名稱。'],
    ['companyName', '　　', '請填寫公司或商號名稱。'],
    ['taxId', '1234567', '統一編號是 8 位數字，請再確認一次。'],
    ['taxId', '1234567a', '統一編號是 8 位數字，請再確認一次。'],
    ['region', '台北市', '請選擇營業地區。'],
    ['region', '', '請選擇營業地區。'],
    ['contactName', '', '請填寫聯絡人姓名。'],
    ['contactPhone', '12345', '請填寫可以聯絡到您的電話號碼。'],
    ['contactPhone', '0912-345-678 分機 3', '請填寫可以聯絡到您的電話號碼。'],
    ['contactEmail', 'not-an-email', 'Email 格式不正確，請再確認一次。'],
  ] as const)('%s = %j ⇒ 那一格顯示「%s」', (field, value, message) => {
    const r = validateDealerApply({ ...ok, [field]: value });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors[field]).toBe(message);
  });

  it('需求說明超過 500 字要擋, 訊息帶目前字數', () => {
    const r = validateDealerApply({ ...ok, note: '字'.repeat(501) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors.note).toBe('需求說明最多 500 字，目前 501 字。');
  });

  it('長度照字元算(與資料庫 char_length 一致), 擴充區漢字不算成 2 個字', () => {
    expect(validateDealerApply({ ...ok, contactName: '𠀋'.repeat(50) }).ok).toBe(true);
    const r = validateDealerApply({ ...ok, contactName: '𠀋'.repeat(51) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors.contactName).toBe('聯絡人姓名最多 50 字。');
  });

  it('店名與需求說明是選填', () => {
    const r = validateDealerApply({ ...ok, storeName: '', note: '' });
    expect(r.ok).toBe(true);
  });
});

describe('送出失敗的訊息對應', () => {
  it('23505(已有一筆審核中)⇒ 說不需要重送', () => {
    expect(mapSubmitError({ code: '23505' })).toEqual({ kind: 'already_pending', message: '您已經有一筆申請在審核中，不需要重新送出。' });
  });
  it('28000(沒有登入身分)⇒ 請重新登入', () => {
    expect(mapSubmitError({ code: '28000' }).kind).toBe('session_expired');
  });
  it('23503(帳號沒有會員資料)⇒ 請聯絡業務, 不叫他重試', () => {
    const m = mapSubmitError({ code: '23503' });
    expect(m.kind).toBe('account_incomplete');
    expect(m.message).not.toContain('再試');
  });
  it('其他錯誤 ⇒ 可以重試(單一 INSERT, 重送最多撞 23505)', () => {
    expect(mapSubmitError({ code: 'XX000' })).toEqual({
      kind: 'failed',
      message: '申請送出失敗，請稍後再試一次。若仍無法送出，請直接聯絡 PCM 業務。',
    });
  });
});
