// seo.test.ts — robots / sitemap builder 回歸測(GEO P0)。
//
// 鎖死:① 休眠降級(base undefined → robots 全擋 + sitemap 空);② 開放時 robots 擋私頁 + 指
// sitemap + host;③ sitemap 含靜態頁 + 每商品 handle、URL 正確絕對網址。

import { describe, it, expect } from 'vitest';
import {
  buildRobots,
  buildSitemapEntries,
  AI_CRAWLER_USER_AGENTS,
  AI_TRAINING_CONTROL_TOKENS,
  CRAWLER_DISALLOW_PATHS,
  STATIC_SITEMAP_PATHS,
} from './seo';

const BASE = 'https://pcmmotorsports.com';

describe('buildRobots', () => {
  it('base undefined → 全擋(休眠)、無 sitemap / host', () => {
    const r = buildRobots(undefined);
    expect(r.rules).toEqual([{ userAgent: '*', disallow: '/' }]);
    expect(r.sitemap).toBeUndefined();
    expect(r.host).toBeUndefined();
  });

  it('base 有值 → 開放 / 擋私頁 / 指 sitemap / 設 host', () => {
    const r = buildRobots(BASE);
    const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    expect(rule?.userAgent).toBe('*');
    // ⛔ ~~`expect(rule?.allow).toBe('/')`~~ —— 2026-09-09 拿掉 `Allow: /`,理由見下面那條
    //    「先命中先贏」的守門與 `seo.ts` 檔內註解。規格解析器的行為零變化。
    expect(rule?.allow).toBeUndefined();
    expect(rule?.disallow).toEqual([...CRAWLER_DISALLOW_PATHS]);
    expect(r.sitemap).toBe(`${BASE}/sitemap.xml`);
    expect(r.host).toBe(BASE);
  });

  // ══ Sean 2026-09-09 拍甲:明確允許 AI 爬蟲 ══════════════════════════════
  //
  // 🔴🔴 **下面第一條是這一整片唯一真正重要的東西。**
  //   robots.txt 的比對是「最具體的那一段贏」,不是疊加 ⇒ 具名段一出現,那支爬蟲就
  //   **只讀它自己那一段**,`*` 那段的 Disallow 對它完全失效。
  //   ⇒ 少抄一條 Disallow = 把那條路徑對那支 AI 爬蟲全開,而**檔案看起來完全正常**。
  it('🔴🔴 每一個具名段都把 8 條 Disallow 抄滿 —— 一條都不能少', () => {
    const r = buildRobots(BASE);
    const rules = Array.isArray(r.rules) ? r.rules : [r.rules];
    const named = [...AI_CRAWLER_USER_AGENTS, ...AI_TRAINING_CONTROL_TOKENS];
    // 正對照:先證明真的產出了那些段(全 0 段時下面的 forEach 會空跑而【印綠】)。
    expect(rules).toHaveLength(named.length + 1);
    for (const ua of named) {
      const rule = rules.find((x) => x?.userAgent === ua);
      expect(rule, `缺少 ${ua} 這一段`).toBeDefined();
      expect(rule?.disallow, `${ua} 的 Disallow 與 * 那段不一致`).toEqual([
        ...CRAWLER_DISALLOW_PATHS,
      ]);
    }
  });

  // 🔴🔴 **「先命中先贏」那一族的解析器也要擋得住。**
  //   robots.txt 有兩族解析器:Google 走「最長的贏」,而 Python 內建的 `urllib.robotparser`
  //   那一族走「**先命中先贏**」。`Allow: /` 排在 Disallow 前面時,後者會把私頁**全部放行** ——
  //   2026-09-09 實測:`Allow: /` + `Disallow: /checkout` ⇒ `can_fetch('/checkout')` 回 **True**。
  //   ⇒ 我們新增的具名段全是給第三方 AI 爬蟲讀的,**那一族用什麼解析器我們不知道** ⇒ 兩族都要擋住。
  //   ⇒ 這一條用「先命中先贏」重跑一次每一段,不是看檔案長什麼樣。
  it('🔴🔴 用「先命中先贏」重算,每一段的私頁仍然擋得住', () => {
    const r = buildRobots(BASE);
    const rules = Array.isArray(r.rules) ? r.rules : [r.rules];
    /** 先命中先贏:照宣告順序走,第一個前綴命中的指令說了算;都沒命中 ⇒ 放行。 */
    const firstMatchAllows = (rule: (typeof rules)[number], path: string): boolean => {
      const allows = ([] as string[]).concat(rule?.allow ?? []);
      const disallows = ([] as string[]).concat(rule?.disallow ?? []);
      for (const p of allows) if (path.startsWith(p)) return true;
      for (const p of disallows) if (path.startsWith(p)) return false;
      return true;
    };
    for (const rule of rules) {
      for (const path of CRAWLER_DISALLOW_PATHS) {
        expect(firstMatchAllows(rule, path), `${rule?.userAgent} 沒擋住 ${path}`).toBe(false);
      }
      // 正對照:公開頁**要**放行 —— 少了這一格,一個「全部都擋」的檔案也會印綠。
      expect(firstMatchAllows(rule, '/products'), `${rule?.userAgent} 誤擋 /products`).toBe(true);
    }
  });

  it('🔵 具名清單本身鎖字面(每一支都查過官方文件才列;Claude-Web / Bytespider 刻意不列)', () => {
    expect([...AI_CRAWLER_USER_AGENTS]).toEqual([
      'GPTBot',
      'OAI-SearchBot',
      'ChatGPT-User',
      'ClaudeBot',
      'Claude-SearchBot',
      'Claude-User',
      'PerplexityBot',
      'Perplexity-User',
      'CCBot',
    ]);
    expect([...AI_TRAINING_CONTROL_TOKENS]).toEqual(['Google-Extended', 'Applebot-Extended']);
  });

  it('🔴 休眠時不發任何具名段(全擋就是全擋)', () => {
    expect(buildRobots(undefined).rules).toEqual([{ userAgent: '*', disallow: '/' }]);
  });

  it('私頁清單涵蓋 account / cart / checkout / login / register / auth / api / dev-preview', () => {
    expect([...CRAWLER_DISALLOW_PATHS]).toEqual([
      '/account',
      '/cart',
      '/checkout',
      '/login',
      '/register',
      '/auth',
      '/api',
      '/dev-preview',
    ]);
  });
});

describe('buildSitemapEntries', () => {
  it('base undefined → 空陣列(休眠)', () => {
    expect(buildSitemapEntries(['a-1', 'b-2'], undefined, ['akrapovic'])).toEqual([]);
  });

  it('base 有值 → 靜態頁 + 每商品 handle、URL 為絕對網址', () => {
    const entries = buildSitemapEntries(['lightech-1', 'brembo-7'], BASE, ['akrapovic', 'kineo']);
    const urls = entries.map((e) => e.url);
    // 靜態頁(首頁 '' + /products + /brands)
    expect(urls).toContain(`${BASE}`);
    expect(urls).toContain(`${BASE}/products`);
    expect(urls).toContain(`${BASE}/brands`);
    // 商品頁
    expect(urls).toContain(`${BASE}/products/lightech-1`);
    expect(urls).toContain(`${BASE}/products/brembo-7`);
    // 🔴 品牌介紹頁(D3c-4):`kineo` 是**目錄零商品**那 5 家之一 —— 泛白的是入口、不是頁面,
    //    它的內容照樣要被索引(理由寫在 `buildSitemapEntries` 的 doc)。
    expect(urls).toContain(`${BASE}/brands/akrapovic`);
    expect(urls).toContain(`${BASE}/brands/kineo`);
    // 數量 = 靜態頁 + 商品數 + 品牌數
    expect(entries).toHaveLength(STATIC_SITEMAP_PATHS.length + 2 + 2);
  });

  it('首頁 priority=1 changeFrequency=daily', () => {
    const entries = buildSitemapEntries([], BASE, []);
    const home = entries.find((e) => e.url === BASE);
    expect(home?.priority).toBe(1);
    expect(home?.changeFrequency).toBe('daily');
  });

  it('無商品、無品牌時只剩靜態頁', () => {
    expect(buildSitemapEntries([], BASE, [])).toHaveLength(STATIC_SITEMAP_PATHS.length);
  });

  // 🔴 D3c-4:靜態頁清單本身要釘住。`/brands` 在 D3c-3 才落地,漏掉的話那一頁與它底下
  //    20 頁的入口都不在地圖上,而 sitemap.xml 照樣是合法的 —— 零症狀。
  it('🔴 靜態頁清單 = 首頁 / 商品目錄 / 品牌總覽', () => {
    expect([...STATIC_SITEMAP_PATHS]).toEqual(['', '/products', '/brands']);
  });

  it('🔴 品牌介紹頁的 changeFrequency 是 monthly、priority 0.7(與商品頁區分開)', () => {
    const entries = buildSitemapEntries([], BASE, ['rizoma']);
    const brand = entries.find((e) => e.url === `${BASE}/brands/rizoma`);
    expect(brand?.changeFrequency).toBe('monthly');
    expect(brand?.priority).toBe(0.7);
  });
});
