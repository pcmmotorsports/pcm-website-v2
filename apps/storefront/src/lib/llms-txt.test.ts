import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildLlmsTxt, FORBIDDEN_AUTHORITY_CLAIMS, UNSUPPORTED_ORIGIN_CLAIMS } from './llms-txt';
import { serializeOrganizationJsonLd } from './org-jsonld';
import { BRAND_CONTENT } from '@/data/brand-content';

const BASE = 'https://www.pcmmotorsports.com';

describe('buildLlmsTxt', () => {
  it('🔴 base 未設 ⇒ 回空字串(路由據此回 404,與 robots 全擋 / sitemap 空同一個決定)', () => {
    expect(buildLlmsTxt(undefined)).toBe('');
  });

  it('🔵 形狀符合 llmstxt.org:H1 開頭 + blockquote 摘要 + H2 區塊 + markdown 連結', () => {
    const lines = buildLlmsTxt(BASE).split('\n');
    expect(lines[0]).toMatch(/^# .+/);
    expect(lines.some((l) => l.startsWith('> '))).toBe(true);
    expect(lines.filter((l) => l.startsWith('## ')).length).toBeGreaterThanOrEqual(3);
    // 每一條清單項都必須是 `- [名稱](網址)` 的形狀(規格逐字要求 markdown 連結)。
    const items = lines.filter((l) => l.startsWith('- ['));
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item).toMatch(/^- \[[^\]]+\]\(https?:\/\/[^)]+\)(: .+)?$/);
  });

  it('🔵 每一個品牌介紹頁都在裡面(漏掉不會有東西叫,所以在這裡數)', () => {
    const txt = buildLlmsTxt(BASE);
    for (const b of BRAND_CONTENT) expect(txt).toContain(`${BASE}/brands/${b.slug}`);
    expect(BRAND_CONTENT.length).toBeGreaterThan(0); // 正對照:清單不是空的
  });

  // 🔴 換網域那天不用改這個檔 —— 所有網址都由 base 拼出來。
  it('🔴 零寫死網域:換 base ⇒ 全文不再出現舊網域', () => {
    const txt = buildLlmsTxt('https://example.test');
    expect(txt).not.toContain('pcmmotorsports.com');
    expect(txt).toContain('https://example.test/products');
  });
});

// ══ 🔴🔴 身分宣稱的守門(Sean 2026-09-09 拍乙:不是總代理,是經銷)══════════════
//
// 🛑 **這一組守的不是用詞品味,是一個【沒有人會發現】的錯。**
//   寫「總代理」是對外的事實宣稱,品牌方可以投訴 —— 而 Google 不會叫、畫面不會變、
//   其他測試也不會紅。⇒ 只有這裡會紅。
// 📌 掃的範圍是**所有對外產出**:llms.txt、Organization JSON-LD、以及首頁 description
//   的字面(它住在 `app/layout.tsx`,那支不是純函式 ⇒ 讀檔掃)。
describe('🔴 對外產出不得出現身分宣稱', () => {
  // 🔴 **掃字串、不掃註解。** 第一版直接掃整份原始碼 ⇒ 被**解釋這條規則的那段註解**
  //   裡的「總代理」判紅(而那段註解正是在說「不准寫總代理」)。
  //   🟢 那一發誤判反過來證明這把尺會紅 —— 但它量錯了對象。⇒ 先剝掉 `//` 與 `/* */`。
  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const layoutSource = stripComments(
    readFileSync(join(__dirname, '..', 'app', 'layout.tsx'), 'utf8'),
  );
  const targets: Array<[string, string]> = [
    ['llms.txt', buildLlmsTxt(BASE)],
    ['Organization JSON-LD', serializeOrganizationJsonLd()],
    ['app/layout.tsx(首頁 title / description)', layoutSource],
  ];

  for (const [name, text] of targets) {
    it(`🔴 ${name} 不含「總代理 / 獨家 / Exclusive Distributor」那組字面`, () => {
      for (const claim of FORBIDDEN_AUTHORITY_CLAIMS) {
        expect(text, `${name} 出現了「${claim}」`).not.toContain(claim);
      }
    });
  }

  // 🔴 **「我們賣什麼」的宣稱**(2026-09-10 補)。與上面那組分開列,而病因相同。
  //   `日系` 這一格是實查出來的:21 家品牌裡日本 **0** 家、泰國 **2** 家,
  //   而首頁 description 曾經寫「專營歐系與日系」並且**上線過**。
  for (const [name, text] of targets) {
    it(`🔴 ${name} 不含查不到出處的產地宣稱(日系)`, () => {
      for (const claim of UNSUPPORTED_ORIGIN_CLAIMS) {
        expect(text, `${name} 出現了「${claim}」`).not.toContain(claim);
      }
    });
  }

  // 🟢 正對照:證明這把尺【抓得到】—— 少了這一格,一個永遠回空字串的 builder 也會全綠。
  it('🟢 正對照:把禁字塞進去 ⇒ 這把尺抓得到', () => {
    const poisoned = `${buildLlmsTxt(BASE)}\n我們是台灣總代理。`;
    const hit = FORBIDDEN_AUTHORITY_CLAIMS.some((c) => poisoned.includes(c));
    expect(hit).toBe(true);
  });

  it('🔵 而站上既有那句「部分品牌正式代理、部分平行輸入」要留著(它是刻意留餘地的)', () => {
    expect(buildLlmsTxt(BASE)).toContain('部分品牌正式代理、部分平行輸入');
  });
});
