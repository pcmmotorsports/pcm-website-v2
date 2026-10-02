// search-synonyms.ts — 2026-10-02 起本體搬到 @pcm/domain(packages/domain/src/catalog/search-synonyms.ts),
//   讓後台查商品、商品管理也能用同一份同義詞(後台搜尋計畫 S6)。這裡只轉出, 顧客站既有的 import 路徑不用改。
export { SEARCH_SYNONYMS, synonymFor } from '@pcm/domain';
export type { SearchSynonym, SynonymKind } from '@pcm/domain';
