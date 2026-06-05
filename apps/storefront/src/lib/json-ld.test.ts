// json-ld.test.ts — safeJsonLd 共用 escape helper 回歸測(2026-06-05 安全稽核 batch1 M-2 新增 helper)。
//
// safeJsonLd 是注入 <script type="application/ld+json"> 的唯一安全序列化入口(product-jsonld +
// ProductFAQ 共用)。鎖死:① escape `<` → < 防 </script> breakout;② 對無 `<` 內容等價 JSON.stringify;
// ③ 不過度 escape(只動 `<`)。

import { describe, it, expect } from 'vitest';
import { safeJsonLd } from './json-ld';

describe('safeJsonLd', () => {
  it('escape 每個 < 成字面 \\u003c、無未轉義 </script> 或 <script> breakout', () => {
    const s = safeJsonLd({ x: 'a </script><script>alert(1)</script> b' });
    expect(s).toContain('\\u003c'); // 字面 6 bytes:backslash-u-003c
    expect(s).not.toContain('</script>');
    expect(s).not.toContain('<script>');
  });

  it('無 < 的內容等價 JSON.stringify(資料語意不變)', () => {
    const obj = { '@context': 'https://schema.org', '@type': 'Product', name: '碳纖維部品', price: 12000 };
    expect(safeJsonLd(obj)).toBe(JSON.stringify(obj));
  });

  it('只 escape <、不動 > 或其他字元', () => {
    const s = safeJsonLd({ a: 'x > y & z' });
    expect(s).toContain('x > y & z');
    expect(s).not.toContain('\\u003c');
  });

  it('JSON.parse(safeJsonLd(obj)) 還原為原物件(escape 不破壞資料)', () => {
    const obj = { tag: '<b>粗體</b>', n: 5 };
    expect(JSON.parse(safeJsonLd(obj))).toEqual(obj);
  });
});
