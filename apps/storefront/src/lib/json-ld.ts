// apps/storefront/src/lib/json-ld.ts — JSON-LD 安全序列化共用 helper
//
// 🔴 XSS 防護:注入 <script type="application/ld+json"> 的 JSON 必須把每個 `<` escape 成
//   跳脫序列 U+003C(原始碼第 2 引數寫雙反斜線 → runtime 6 bytes):JSON 解析回 `<`、
//   但 HTML parser 不誤判 </script> breakout(Next.js 官方 json-ld guide)。
//
// 抽出原因(2026-06-05 安全稽核 M-2):product-jsonld.ts(serializeProductJsonLd)原已正確 escape,
//   但 ProductFAQ.tsx 的 FAQPage JSON-LD 漏了同一步驟(escape 不一致)。抽共用 helper、兩處都用、
//   杜絕日後分歧;**任何新增的 JSON-LD 注入點一律走本函式**,別再各寫各的 JSON.stringify。

/**
 * 把任意物件序列化為「注入 <script type="application/ld+json"> 安全」的字串。
 * 把每個 `<` replace 成 U+003C 跳脫序列(原始碼第 2 引數雙反斜線、runtime 6 bytes),
 * 防 </script> breakout;JSON 解析時仍還原為 `<`,資料語意不變。
 */
export function safeJsonLd(obj: unknown): string {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}
