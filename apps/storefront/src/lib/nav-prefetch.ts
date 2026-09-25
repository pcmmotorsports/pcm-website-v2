// 頁首、手機選單、頁尾的連結要不要預先載入。
// 2026-09-15:/products 與 /search 不預載 —— 防火牆規則 search-log-flood-cap 會把預載算進流量。
// 2026-09-26:不常點的頁面也不預載 —— Vercel 實測每頁每小時被預先抓約 500 次, 多數來自爬蟲。
// 回傳 undefined 代表照 Next 預設(畫面上看到就預載)。
const NO_PREFETCH = /^\/(products|search|install|stores|info\/shipping|terms|privacy|dealer-apply)(\?|$)/;

export function navPrefetch(href: string): false | undefined {
  return NO_PREFETCH.test(href) ? false : undefined;
}
