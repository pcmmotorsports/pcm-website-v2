// apps/storefront/src/lib/site-url.ts — 站台基底 URL + URL 工具(M-1-16c-4c SEO)
//
// 用途:商品詳情頁 canonical / Open Graph url / JSON-LD url 需要**絕對網址**才對 SEO 有效。
//
// 🔴 prod-safe(codex 關卡1 MUST-FIX 2 + 審查 Q3=A):
//   - 設定 NEXT_PUBLIC_SITE_URL(正式網域)→ 用它(去尾斜線)。
//   - 未設且非 production(本機 dev / test)→ 'http://localhost:3000'(本機可驗)。
//   - 未設且 production → **回 undefined**(省略 canonical/OG/JSON-LD url 欄)。
//     ❌ 絕不在 production 吐 'http://localhost:3000' canonical(會害 Google 索引到 localhost)。
//
// 📌 環境變數 NEXT_PUBLIC_SITE_URL 設定點(刻意不寫進 .env.example — `.env*` 命中
//    禁止清單 + permissions.deny;此註解 + STATUS 為文件化來源):
//   - 本機:不設 → fallback localhost:3000(canonical 顯本機、僅本地驗用)。
//   - 線上:Sean 在 Vercel 後台 Project → Settings → Environment Variables 設
//     NEXT_PUBLIC_SITE_URL = https://<正式網域>(例 https://www.pcmmotorsports.com)。
//     未設只是 prod 暫無 canonical/OG url(安全降級、可後補)、非阻塞。

/** 解析站台基底 URL。production 未設環境變數時回 undefined(不 fallback localhost、見檔頭 🔴)。 */
export function resolveSiteUrl(): string | undefined {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  // 僅接受絕對 http(s) URL(codex 關卡2 CONSIDER:typo'd / 相對值的環境變數不該吐成壞 canonical/OG/JSON-LD url)。
  if (env && isAbsoluteHttpUrl(env)) {
    return env.replace(/\/+$/, ''); // 去尾斜線、避免 base + '/products/x' 出現 '//'
  }
  // 未設 或 格式不合(非 http(s))→ dev fallback localhost、prod 省略(絕不吐 localhost / 壞值)。
  return process.env.NODE_ENV === 'production' ? undefined : 'http://localhost:3000';
}

/** 是否為絕對 http(s) 網址(JSON-LD image / OG image 白名單;相對路徑如 /placeholder-product.png 不合格)。 */
export function isAbsoluteHttpUrl(url: string): boolean {
  return /^https?:\/\//.test(url);
}

/**
 * 靜態頁的 `alternates.canonical`(M-6-01,2026-09-14)。
 *
 * 2026-09-14 對 www 站實測:`/info/shipping` `/privacy` `/terms` `/stores` `/install` 五頁
 * **一個 canonical 都沒有** —— canonical 只做在 5 支 route(首頁 / 型錄 / PDP / 品牌總覽 /
 * 品牌介紹)。這支把那五頁接上同一套規則,而不是各自複製一份 `...(base ? … : {})`。
 *
 * 🔴 休眠照舊(`resolveSiteUrl()` 檔頭 🔴):base 拿不到 ⇒ **回空物件、不發 canonical**。
 *    寧缺勿錯 —— 相對 canonical 會落到框架預設基底,可能讓 Google 索引到 localhost。
 *
 * ⛔ `/search` 不用這支(它的網址帶 `?q=`, 用下面的 `selfPageUrl`)。
 */
export function canonicalAlternates(path: string): { alternates?: { canonical: string } } {
  const base = resolveSiteUrl();
  return base ? { alternates: { canonical: `${base}${path}` } } : {};
}

/**
 * 這一頁自己的完整網址(網址參數照原順序、重複參數保留)。base 拿不到 ⇒ undefined(同上「寧缺勿錯」)。
 *
 * 🔴 為什麼不進索引的頁面也要有 canonical(2026-09-29 Sean 手機發現):
 *   頁面沒有 canonical 時, 前一頁的 canonical 會留在畫面上(正式站實測:先開 bonamici + zx-10r 的目錄頁,
 *   回首頁再搜「daytona 660」⇒ 網址列是 daytona 660, canonical 仍是 bonamici + zx-10r)。
 *   Chrome 手機的「分享」讀的是 canonical ⇒ 客人分享出去的是上一頁。新頁有自己的 canonical 時都會正確換掉。
 *   ⇒ `/products` 不進索引的那些組合與 `/search` 一律發一條指向自己的 canonical(noindex 照舊, 兩者不衝突)。
 */
export function selfPageUrl(
  base: string | undefined,
  path: string,
  searchParams: Record<string, string | string[] | undefined>,
): string | undefined {
  if (!base) return undefined;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (typeof v === 'string') qs.append(k, v);
    else if (Array.isArray(v)) for (const one of v) qs.append(k, one);
  }
  const s = qs.toString();
  return `${base}${path}${s ? `?${s}` : ''}`;
}
