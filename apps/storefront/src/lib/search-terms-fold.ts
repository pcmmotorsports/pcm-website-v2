// search-terms-fold.ts — 2026-10-02 起本體搬到 @pcm/domain(packages/domain/src/catalog/search-terms-fold.ts),
//   後台與顧客站共用同一個折疊規則(後台搜尋計畫 S6)。這裡只轉出, 顧客站既有的 import 路徑不用改。
export { foldSearchTerm, foldEquals, foldStartsWith, foldIncludes } from '@pcm/domain';
