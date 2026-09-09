// lib/seo.ts — robots.txt / sitemap.xml 路由的純邏輯 builder(GEO P0「大門 + 地圖」)
//
// app/robots.ts 與 app/sitemap.ts 是 Next App Router metadata route(自動產 /robots.txt 與
// /sitemap.xml),但它們要 await DB / 讀環境變數、不易單測 → 純邏輯抽到本檔(builder 收「已解析的
// base + handle 陣列」、回 Next 型別物件),app/ 端只負責 fetch + 接線。
//
// 🔴 休眠降級(與 site-url.ts resolveSiteUrl() prod-safe 一致):
//   base = undefined(prod 未設 NEXT_PUBLIC_SITE_URL)→ robots 全擋 + sitemap 空陣列。
//   理由:① sitemap 規範要求**絕對 URL**、無 base 產不出合法 sitemap;② 沒設正式網域的半成品
//   deploy 不該被索引。Sean 上線時在 Vercel 設 NEXT_PUBLIC_SITE_URL=https://正式網域 → 自動切
//   「開放 + 全量」,不需改 code。

import type { MetadataRoute } from 'next';
// 零依賴的純字串模組(server/client 兩邊都能用)⇒ 不會把任何東西拖進本檔。
import { brandIntroUrl } from '@/lib/brand-url';

/** 對爬蟲關閉的私頁 / 非索引路徑(robots disallow;對齊既有 noindex 慣例如 checkout/callback)。 */
export const CRAWLER_DISALLOW_PATHS = [
  '/account',
  '/cart',
  '/checkout',
  '/login',
  '/register',
  '/auth',
  '/api',
  '/dev-preview',
] as const;

/**
 * 進 sitemap 的靜態可索引頁(商品詳情頁另由 DB handle 動態補)。'' = 首頁。
 * 🔴 D3c-4 補 `/brands`:那條 route 在 D3c-3 才落地,在此之前不在地圖上。
 *    品牌**介紹頁**(`/brands/<slug>`,20 頁)不放這裡 —— 它們由 `BRAND_CONTENT` 衍生,
 *    見 `buildSitemapEntries` 的 `brandSlugs` 參數。
 */
export const STATIC_SITEMAP_PATHS = ['', '/products', '/brands'] as const;

/**
 * AI 搜尋 / 助理**真的會發 HTTP 請求**的爬蟲(Sean 2026-09-09 拍甲:明確允許)。
 *
 * 每一支都查過官方文件才列(2026-09-09 抓):
 * · `GPTBot` / `OAI-SearchBot` / `ChatGPT-User` —— OpenAI `developers.openai.com/api/docs/bots`
 *   (依序:訓練基礎模型 / ChatGPT 搜尋結果 / 使用者在 ChatGPT 裡按下去才來抓)
 * · `ClaudeBot` / `Claude-SearchBot` / `Claude-User` —— Anthropic 說明頁 8896518
 *   (依序:訓練 / 搜尋品質 / 使用者提問時來抓)
 * · `PerplexityBot` / `Perplexity-User` —— `docs.perplexity.ai/guides/bots`
 * · `CCBot` —— Common Crawl,多家 AI 訓練集的上游
 *
 * ⚠️ **兩支官方文件自陳「不一定照 robots.txt」**:`ChatGPT-User`(逐字 "robots.txt rules may
 *   not apply")與 `Perplexity-User`(逐字 "generally ignores robots.txt rules"),理由都是
 *   「那是使用者按的、不是自動爬」。⇒ 📌 **對這兩支,下面那組 Disallow 是一個【請求】不是一道【閘】。**
 *   真的要擋得住私頁,靠的是那些路徑本身的登入檢查,不是這個檔。
 *
 * ⛔ ~~`Claude-Web`~~ **不列** —— 2026-09-09 讀 Anthropic 現行說明頁,只有上面那三支,
 *   沒有這個 token ⇒ 未確認的東西不寫進正式檔。
 * ⛔ `Bytespider`(ByteDance)**不列** —— 找不到它的官方文件頁 ⇒ 同上,未確認不寫。
 */
export const AI_CRAWLER_USER_AGENTS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-SearchBot',
  'Claude-User',
  'PerplexityBot',
  'Perplexity-User',
  'CCBot',
] as const;

/**
 * 🔴 **這兩個【不是爬蟲】,是「你抓到的東西可不可以拿去訓練」的旗標。** 它們一個請求都不發。
 *
 * · `Google-Extended` —— Google 逐字:「doesn't have a separate HTTP request user agent string.
 *   Crawling is done with existing Google user agent strings; the robots.txt user-agent token is
 *   used in a control capacity.」控制的是 Gemini 的訓練與 grounding,且**不影響 Google 搜尋排名**。
 * · `Applebot-Extended` —— Apple 逐字:「Applebot-Extended does not crawl webpages.」
 *   它只決定 `Applebot` 已經抓到的東西能不能拿去訓練。
 *
 * 🔵 **而它們仍然抄同一組 `Disallow`** —— 對非爬蟲的 token,`Disallow: /checkout` 的意思是
 *   「那一段不要拿去訓練」,那是一句**成立而且我們真心要講**的話。
 *   ⇒ 📌 同一條規則套到每一段,守門只有一種形狀、沒有例外要記。
 */
export const AI_TRAINING_CONTROL_TOKENS = ['Google-Extended', 'Applebot-Extended'] as const;

/**
 * robots 規則。base 有值 → 開放(擋私頁 + 指 sitemap + host);無值 → 全擋(休眠、見檔頭 🔴)。
 *
 * 🔴🔴 **具名段一旦出現,那支爬蟲就【只讀它自己那一段】,`*` 那段對它完全失效。**
 *   (robots.txt 的比對規則是「最具體的那一段贏」,不是疊加。)
 *   ⇒ **每一個具名段都必須把 `CRAWLER_DISALLOW_PATHS` 整組抄一份進去** —— 少抄一條,
 *     等於把那條路徑對那支 AI 爬蟲全開,而**產出的檔案看起來完全正常**。
 *   ⇒ 守門在 `seo.test.ts`:對每一個具名 UA 斷言那 8 條一條不差。**那是這一片唯一真正重要的東西。**
 */
export function buildRobots(base: string | undefined): MetadataRoute.Robots {
  if (!base) {
    // 休眠:未設正式網域時不讓任何爬蟲索引(避免半成品 preview 被抓)。
    // 🔵 具名段也不發 —— 全擋就是全擋,多印幾段只會讓「這台是不是半成品」變難看出來。
    return { rules: [{ userAgent: '*', disallow: '/' }] };
  }
  // 🔴 `*` 與每一個具名段拿的是**同一個運算式**產出的 disallow,不是各寫一份。
  //
  // 🔴🔴 **⛔ ~~`allow: '/'`~~ 拿掉了(2026-09-09 實測後改)—— 而它不是風格問題。**
  //   `Allow: /` 對規格正確的解析器是**零資訊**(沒有 Disallow 命中本來就是放行),
  //   而它排在 Disallow **前面**時,會讓「**先命中先贏**」那一族的解析器
  //   (例如 Python 內建的 `urllib.robotparser`)判定 `/checkout` `/account` **全部放行**。
  //   📌 實測三種形狀,只有這一個差別:
  //     ① `Allow: /` 在前 + `Disallow: /checkout` ⇒ can_fetch('/checkout') = **True**(全開)
  //     ② 只留 `Disallow: /checkout`              ⇒ False
  //     ③ `Disallow` 在前、`Allow: /` 在後        ⇒ False
  //   ⇒ 🛑 Google 走的是「最長的贏」⇒ 對 Googlebot 本來就沒事;**而本片新增的 11 個具名段
  //     全是給第三方 AI 爬蟲讀的, 那一族用什麼解析器我們不知道。**
  //   ⇒ ✅ 拿掉之後兩族的判定一致:私頁擋、其餘放行。**行為對規格解析器零變化。**
  //   ⚠️ 這一格連 `*` 那段也一起改了 —— 它本來就有同一個弱點(在本片之前就有), 而
  //     只修具名段會留下「同一個檔案裡兩種寫法」, 那比修好之前更難讀。
  const openRule = (userAgent: string) => ({
    userAgent,
    disallow: [...CRAWLER_DISALLOW_PATHS],
  });
  return {
    rules: [
      openRule('*'),
      ...AI_CRAWLER_USER_AGENTS.map(openRule),
      ...AI_TRAINING_CONTROL_TOKENS.map(openRule),
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}

/**
 * sitemap 條目。base 無值 → 空陣列(休眠)。有值 → 靜態頁 + 每個商品 handle + 每個品牌介紹頁。
 * handles 應為公開商品的 handle(= MockProduct.slug,對應路由 /products/[slug])。
 *
 * 🔴 `brandSlugs` **刻意是必填參數、沒有預設值**(D3c-4):給 `= []` 的話,呼叫端漏傳時
 *    20 頁會靜默不進地圖,而 typecheck、既有測試、產出的 XML 都不會有任何症狀 ——
 *    這條 route 的唯一價值就是「有沒有被列出來」。必填 ⇒ 漏傳當場編譯不過。
 * ⚠️ 品牌介紹頁**全部 20 頁都進地圖**,包含目錄零商品那 5 家:那 5 頁的內容(沿革、工藝、
 *    年表)是真的、也渲染得出來,泛白的是**入口**不是頁面本身(Sean 2026-08-04 拍板的範圍)。
 *    把它們排除等於同時對搜尋引擎隱藏 5 篇真內容。
 */
export function buildSitemapEntries(
  handles: readonly string[],
  base: string | undefined,
  brandSlugs: readonly string[],
): MetadataRoute.Sitemap {
  if (!base) return [];

  const staticEntries: MetadataRoute.Sitemap = STATIC_SITEMAP_PATHS.map((path) => ({
    url: `${base}${path}`,
    changeFrequency: path === '' ? 'daily' : 'weekly',
    priority: path === '' ? 1 : 0.8,
  }));

  const productEntries: MetadataRoute.Sitemap = handles.map((handle) => ({
    url: `${base}/products/${handle}`,
    changeFrequency: 'weekly',
    priority: 0.6,
  }));

  // 品牌介紹頁的內容是 L1(年 0-1 次改)⇒ `monthly` 比商品的 `weekly` 誠實;
  // priority 0.7 介於分類入口(0.8)與單一商品(0.6)之間。
  // 🔴 路徑走 `brandIntroUrl()`、不自己拼字串(關卡2 R1 nit):品牌介紹頁的網址形狀只有一個
  //    出處,自己拼的話哪天那支改了(例如加前綴),地圖會安靜地指到不存在的網址;
  //    順帶拿到 `encodeURIComponent`(今天 20 個 slug 全 ASCII、但那是資料現況不是保證)。
  const brandEntries: MetadataRoute.Sitemap = brandSlugs.map((slug) => ({
    url: `${base}${brandIntroUrl(slug)}`,
    changeFrequency: 'monthly',
    priority: 0.7,
  }));

  return [...staticEntries, ...productEntries, ...brandEntries];
}
