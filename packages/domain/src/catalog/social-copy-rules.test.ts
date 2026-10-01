import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BANNER_BLOCKED_PATTERN, checkBannerCopy, checkSocialCopy, checkSocialCopyFields } from './social-copy-rules';

const codes = (t: string) => checkSocialCopy(t).map((i) => `${i.code}:${i.word}`);

describe('checkSocialCopy', () => {
  it.each([
    ['台灣現貨！', 'stock_promise:現貨'],
    ['下週到貨', 'stock_promise:到貨'],
    ['庫存有限', 'stock_promise:庫存'],
    ['符合規定可合法上路', 'legal_claim:合法上路'],
    ['免登記直上', 'legal_claim:免登記'],
    ['義大利設計製造，品質保證', 'quality_promise:品質保證'],
    ['終身保固', 'warranty_not_maker:終身保固'],
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
    expect(codes('原廠提供兩年保固。另享終身保固')).toEqual(['warranty_not_maker:終身保固']);
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

  describe('主視窗 2026-10-01 Q1 甲:品牌名開頭的保固放行', () => {
    it.each(['Samco Sport 原廠提供終身保固', 'Samco Sport 提供終身保固', 'samco sport提供終身保固'])('放行:%s', (text) => {
      expect(checkSocialCopy(text, ['Samco Sport'])).toEqual([]);
    });
    it('沒給品牌名時照舊紅', () => {
      expect(codes('Samco Sport 提供終身保固')).toEqual(['warranty_not_maker:終身保固']);
    });
    it('品牌名開頭但不是「提供」⇒ 照舊紅', () => {
      expect(checkSocialCopy('Samco Sport 終身保固', ['Samco Sport']).map((i) => i.code)).toEqual(['warranty_not_maker']);
    });
  });

  describe('主視窗 2026-10-01 Q2 甲:保固寫法照報價單清單', () => {
    it.each(['保證期兩年', '質保一年', '兩年保證', '保證更換', '三年內免費維修', '終身免費更換'])('該紅:%s', (text) => {
      expect(checkSocialCopy(text).map((i) => i.code)).toContain('warranty_not_maker');
    });
    it.each(['保證同心度精度', '操作壽命保證超過 70 萬次', '行車安全保障', '確保用車安全'])('規格說法不紅:%s', (text) => {
      expect(checkSocialCopy(text)).toEqual([]);
    });
    it('原廠或品牌名開頭的放行', () => {
      expect(checkSocialCopy('原廠提供兩年保證')).toEqual([]);
      expect(checkSocialCopy('Puig 原廠提供質保一年', ['Puig'])).toEqual([]);
    });
  });

  it('多個欄位一起檢查, 空欄位略過', () => {
    expect(checkSocialCopyFields([null, '新品', undefined, '現貨供應']).map((i) => i.word)).toEqual(['現貨']);
  });
});

describe('checkBannerCopy(首頁大圖, 比 FB / IG 嚴)', () => {
  it('原廠提供的保固在大圖上也紅', () => {
    expect(checkBannerCopy(['拉桿護弓', '原廠提供兩年保固']).map((i) => i.word)).toEqual(['保固']);
  });
  it('乾淨的大圖不紅', () => {
    expect(checkBannerCopy(['Materya', '拉桿護弓', null, '看商品'])).toEqual([]);
  });
  it('🔴 與資料庫發布檢查同一串禁用字(讀 migration 檔比對)', () => {
    const sql = readFileSync(
      fileURLToPath(new URL('../../../../supabase/migrations/20261001120000_m4b_home_banner_new_product_drafts.sql', import.meta.url)),
      'utf8',
    );
    expect(sql).toContain(`~ '${BANNER_BLOCKED_PATTERN}'`);
  });
});
