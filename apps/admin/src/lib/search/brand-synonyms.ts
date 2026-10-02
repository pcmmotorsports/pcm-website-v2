import { foldSearchTerm, SEARCH_SYNONYMS } from '@pcm/domain';

// 後台搜尋計畫 S6(2026-10-02):後台查商品、商品管理也認顧客站的品牌俗名(「阿卡」「蠍子管」⇒ Akrapovic)。
// 只用品牌那幾列, 而且只用人核過的(source = sean / verified);分類那幾十列多半是沒人核過的草稿, 後台不接。
// 比對規則同顧客站 synonymFor:折過之後整個詞相等才換, 不做前綴(「阿」不會變成 Akrapovic)。

/** 一個詞:是人核過的品牌俗名就換成正式品牌名, 否則原樣。 */
export function applyBrandSynonym(term: string): string {
  const f = foldSearchTerm(term);
  if (f === '') return term;
  const hit = SEARCH_SYNONYMS.find((s) => s.kind === 'brand' && s.source !== 'draft' && foldSearchTerm(s.from) === f);
  return hit ? hit.to : term;
}

/** 整串關鍵字:用空白切開, 每個詞各換一次, 空白原樣保留(資料庫那邊照樣拆詞)。 */
export function applyBrandSynonyms(keyword: string): string {
  return keyword
    .split(/(\s+)/)
    .map((t) => (t.trim() === '' ? t : applyBrandSynonym(t)))
    .join('');
}
