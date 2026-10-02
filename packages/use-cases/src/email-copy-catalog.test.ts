import { describe, expect, it } from 'vitest';
import { EMAIL_COPY, emailCopy, fillEmailCopy } from './email-copy-catalog';

// 信件文字第 1 片(2026-10-02):清單本身的規則。寄出的信與今天逐字相同, 由 sweep-email-outbox.test.ts 檔尾的快照證。

describe('fillEmailCopy', () => {
  it('換掉給了值的代號, 沒給值的原樣留著', () => {
    expect(fillEmailCopy('訂單 {訂單編號} 共 {件數} 件', { 訂單編號: 'PCM-1' })).toBe('訂單 PCM-1 共 {件數} 件');
  });
  it('值裡的 $& $1 不會被當成取代語法', () => {
    expect(fillEmailCopy('品名 {品名}', { 品名: 'A$&B$1' })).toBe('品名 A$&B$1');
  });
  it('同一個代號出現兩次都換', () => {
    expect(fillEmailCopy('{a}-{a}', { a: 'x' })).toBe('x-x');
  });
});

describe('EMAIL_COPY 清單', () => {
  it('每一句列的必填代號, 預設文字裡真的都有;文字裡的代號也都列在必填裡', () => {
    for (const [key, entry] of Object.entries(EMAIL_COPY)) {
      const inText = [...entry.text.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1]).sort();
      expect([...new Set(inText)], key).toEqual([...entry.placeholders].sort());
    }
  });
  it('全部填好之後不留任何大括號', () => {
    for (const [key, entry] of Object.entries(EMAIL_COPY)) {
      const vars = Object.fromEntries(entry.placeholders.map((p) => [p, '值']));
      expect(emailCopy(key as keyof typeof EMAIL_COPY, vars), key).not.toMatch(/[{}]/);
    }
  });
  it('每一句都有位置說明, 文字不是空的', () => {
    for (const [key, entry] of Object.entries(EMAIL_COPY)) {
      expect(entry.label.trim(), key).not.toBe('');
      expect(entry.text.trim(), key).not.toBe('');
    }
  });
});

describe('快照涵蓋不到的兩句(寄信測試走不到那個分支)', () => {
  // 檔尾快照只收得到「有測項寄出」的信;這兩句所在的分支沒有任何寄信測試走得到
  // (品項過多那句, sweep-email-outbox.ts 自己註明今天走不到)⇒ 直接釘住字面, 證明搬家時一字未改。
  it('付款信「品項過多」那句', () => {
    expect(EMAIL_COPY.paidLinesTruncated.text).toBe('(品項過多，此處僅列出部分)');
  });
  it('單號更正信讀不到訂單編號時的開頭', () => {
    expect(EMAIL_COPY.trackingCorrectedHeadlineNoId.text).toBe('您先前那封出貨通知上的貨運單號有誤。');
  });
});

