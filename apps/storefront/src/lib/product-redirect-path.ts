// product-redirect-path.ts — 商品舊網址轉址的新網址組法(純函式;查詢在 product-redirect.ts)。
// 分開放是因為查詢那支會帶進伺服器端的資料庫連線,而頁面測試只想換掉查詢、保留這支。

/** 新網址:handle 編碼、原本的網址參數原樣帶過去。 */
export function productRedirectPath(
  newHandle: string,
  searchParams: Record<string, string | string[] | undefined>,
): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) qs.append(key, v);
  }
  const query = qs.toString();
  return `/products/${encodeURIComponent(newHandle)}${query ? `?${query}` : ''}`;
}
