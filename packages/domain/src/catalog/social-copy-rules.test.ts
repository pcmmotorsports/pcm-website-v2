import { describe, expect, it } from 'vitest';
import { checkSocialCopy, checkSocialCopyFields } from './social-copy-rules';

const codes = (t: string) => checkSocialCopy(t).map((i) => `${i.code}:${i.word}`);

describe('checkSocialCopy', () => {
  it.each([
    ['台灣現貨！', 'stock_promise:現貨'],
    ['下週到貨', 'stock_promise:到貨'],
    ['庫存有限', 'stock_promise:庫存'],
    ['符合規定可合法上路', 'legal_claim:合法上路'],
    ['免登記直上', 'legal_claim:免登記'],
    ['義大利設計製造，品質保證', 'quality_promise:品質保證'],
    ['終身保固', 'warranty_not_maker:保固'],
    ['本店提供兩年保修', 'warranty_not_maker:保修'],
  ])('該紅:%s', (text, want) => {
    expect(codes(text)).toContain(want);
  });

  it.each([
    '原廠提供兩年保固',
    '・原廠提供終身保固，限正常使用',
    '確保固定螺絲不會鬆脫',
    'Materya｜Lever Guard 拉桿護弓\n主體實心鋁合金 CNC 切削',
  ])('不該紅:%s', (text) => {
    expect(checkSocialCopy(text)).toEqual([]);
  });

  it('保固要整句看:同一則裡另一句是原廠提供, 這一句不是 ⇒ 仍然紅', () => {
    expect(codes('原廠提供兩年保固。另享終身保固')).toEqual(['warranty_not_maker:保固']);
  });

  it('逗號後半是本店保固 ⇒ 紅(R1 建議 3)', () => {
    expect(codes('原廠提供一年保固，本店延長至兩年保固')).toEqual(['warranty_not_maker:保固']);
  });

  it.each(['1. 原廠提供兩年保固', '「原廠提供兩年保固」', '2、原廠提供終身保固'])('編號或引號開頭不誤紅:%s', (text) => {
    expect(checkSocialCopy(text)).toEqual([]);
  });

  it('引號裡是原廠提供、引號外是本店保固 ⇒ 紅(R2 建議 3)', () => {
    expect(codes('「原廠提供兩年保固」本店再加一年保固')).toEqual(['warranty_not_maker:保固']);
  });

  it('多個欄位一起檢查, 空欄位略過', () => {
    expect(checkSocialCopyFields([null, '新品', undefined, '現貨供應']).map((i) => i.word)).toEqual(['現貨']);
  });
});
