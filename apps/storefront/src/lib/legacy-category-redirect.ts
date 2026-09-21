const CATEGORY_BY_LEGACY_PATHNAME: ReadonlyMap<string, string> = new Map([
  [encodeURI('/排氣管'), '排氣系統'],
  [encodeURI('/碳纖維'), '碳纖維部品'],
  [encodeURI('/碳纖維/index.html'), '碳纖維部品'],
  [encodeURI('/懸吊系統'), '懸吊與車架'],
  [encodeURI('/懸吊系統/index.html'), '懸吊與車架'],
  [encodeURI('/懸吊系統/懸吊系統/index.html'), '懸吊與車架'],
  [encodeURI('/輪框'), '懸吊與車架 · 輪圈'],
  [encodeURI('/懸吊系統/輪框.html'), '懸吊與車架 · 輪圈'],
  [encodeURI('/改裝精品/輪框.html'), '懸吊與車架 · 輪圈'],
]);

/** 只接受 Search Console 已確認且有明確替代內容的完整原始 pathname。 */
export function legacyCategoryLocation(pathname: string): string | undefined {
  // 百分比編碼的 hex 大小寫等價；只正規化 hex，不解碼也不重組 segment。
  const normalizedPathname = pathname.replace(/%[0-9a-f]{2}/gi, (value) => value.toUpperCase());
  const category = CATEGORY_BY_LEGACY_PATHNAME.get(normalizedPathname);
  if (!category) return undefined;
  const query = new URLSearchParams({ category }).toString();
  return `/products?${query}`;
}
