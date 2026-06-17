// safe-redirect.test.ts — #190 同源白名單對抗測試(🔴 鐵則 12 open-redirect)
import { describe, it, expect } from 'vitest';
import { sanitizeNextParam } from './safe-redirect';
import { POST_AUTH_REDIRECT } from './constants';

describe('sanitizeNextParam — 安全站內路徑放行', () => {
  it.each([
    ['/account', '/account'],
    ['/', '/'],
    ['/products?cat=brake&sort=price', '/products?cat=brake&sort=price'],
    ['/products/123#spec', '/products/123#spec'],
    ['/account/orders', '/account/orders'],
    ['/a/b/c?x=1&y=2#frag', '/a/b/c?x=1&y=2#frag'],
  ])('放行站內路徑 %s', (input, expected) => {
    expect(sanitizeNextParam(input)).toBe(expected);
  });
});

describe('sanitizeNextParam — 缺值 / 非字串 → fallback', () => {
  it.each([null, undefined, ''])('缺值 %s → POST_AUTH_REDIRECT', (input) => {
    expect(sanitizeNextParam(input)).toBe(POST_AUTH_REDIRECT);
  });
  it('非字串(number)→ POST_AUTH_REDIRECT', () => {
    // @ts-expect-error 測 runtime 防線:非字串輸入(契約外、防呼叫端傳錯)
    expect(sanitizeNextParam(123)).toBe(POST_AUTH_REDIRECT);
  });
});

describe('sanitizeNextParam — open-redirect 攻擊向量全擋', () => {
  it.each([
    // 絕對 URL / scheme
    'http://evil.com',
    'https://evil.com/path',
    'HTTPS://evil.com',
    'javascript:alert(1)',
    'data:text/html,<script>',
    'mailto:x@evil.com',
    // 不以 '/' 開頭(裸字串、相對)
    'account',
    'evil.com',
    '../account',
    // protocol-relative(瀏覽器解析為外站 host)
    '//evil.com',
    '//evil.com/path',
    // 反斜線變體('/\' 被部分瀏覽器當 protocol-relative)
    '/\\evil.com',
    '/\\\\evil.com',
    '/path\\to\\evil',
    // 控制字元 / 空白(可繞過 startsWith 前綴檢查)
    '/\tevil',
    '/\nevil',
    '/\r\nLocation: evil',
    '/ evil',
    '/account ',
    '/\x00evil',
  ])('擋 %j → POST_AUTH_REDIRECT', (input) => {
    expect(sanitizeNextParam(input)).toBe(POST_AUTH_REDIRECT);
  });
});

describe('sanitizeNextParam — encoded / Unicode 空白:不解碼、同源字面放行(codex 關卡2 regression)', () => {
  // 🔴 本函式刻意「不解碼」:%2f / %E2%80%83 等被當字面 path 字元、結果仍是單一 '/' 開頭的同源路徑(瀏覽器
  //    對當前 origin 解析、%2f 不當路徑分隔、不跨站;codex 關卡2 以 new URL 實證皆 same-origin)。
  //    query 來源的 next 由 URLSearchParams 先解碼一次 → '%2f%2f' 解碼成 '//' 後落入上面 protocol-relative 攔截。
  //    故 encoded payload 在「query→解碼→sanitize」全鏈安全;此處鎖定「raw 字面同源、不被誤判可放行外站」契約。
  it.each([
    ['/%2f%2fevil.com', '/%2f%2fevil.com'], // %2f 未解碼、同源字面
    ['/%252f%252fevil.com', '/%252f%252fevil.com'], // double-encode、同源字面
    ['/\u2003//evil.com', '/\u2003//evil.com'], // U+2003 em-space 非控制字元(>0x20)、'/' 後接非 '/' → 同源
  ])('raw encoded %j 視為同源字面、原樣放行', (input, expected) => {
    expect(sanitizeNextParam(input)).toBe(expected);
  });
});
