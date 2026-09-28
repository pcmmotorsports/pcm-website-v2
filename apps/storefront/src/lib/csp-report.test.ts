import { describe, expect, it } from 'vitest';
import { describeReport, readCapped } from './csp-report';

const report = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    'csp-report': {
      'document-uri': 'https://www.pcmmotorsports.com/products/x?search=secret',
      'effective-directive': 'img-src',
      'blocked-uri': 'http://evil.example/a/b.png?token=1',
      ...over,
    },
  });

describe('CSP 回報解析', () => {
  it('三站之一 ⇒ 只記站別、規則、來源網域、路徑(不含查詢字串)', () => {
    expect(describeReport(report())).toBe(
      '[csp] site=www.pcmmotorsports.com directive=img-src blocked=http://evil.example page=/products/x',
    );
  });

  it('admin、b2b 的回報也收', () => {
    expect(describeReport(report({ 'document-uri': 'https://admin.pcmmotorsports.com/orders' }))).toContain('site=admin.pcmmotorsports.com');
    expect(describeReport(report({ 'document-uri': 'https://b2b.pcmmotorsports.com/' }))).toContain('site=b2b.pcmmotorsports.com');
  });

  it('🔴 不是三站的 document-uri(外人偽造)⇒ 不記', () => {
    expect(describeReport(report({ 'document-uri': 'https://attacker.example/' }))).toBeNull();
    expect(describeReport(report({ 'document-uri': 'not a url' }))).toBeNull();
  });

  it('格式不對 ⇒ 不記、不丟例外', () => {
    expect(describeReport('{')).toBeNull();
    expect(describeReport('{"other":1}')).toBeNull();
  });

  it('inline / eval 關鍵字原樣;奇怪的字串與規則名換成 unknown(不讓外人寫任意字進紀錄)', () => {
    expect(describeReport(report({ 'blocked-uri': 'inline' }))).toContain('blocked=inline');
    expect(describeReport(report({ 'blocked-uri': 'x\ny' }))).toContain('blocked=unknown');
    expect(describeReport(report({ 'effective-directive': 'img-src\nFAKE' }))).toContain('directive=unknown');
  });
});

describe('讀取上限 8 KB', () => {
  const big = 'x'.repeat(8 * 1024 + 1);

  it('content-length 超過 ⇒ 不讀', async () => {
    const req = new Request('https://www.pcmmotorsports.com/api/csp-report', {
      method: 'POST',
      body: big,
      headers: { 'content-length': String(big.length) },
    });
    expect(await readCapped(req)).toBeNull();
  });

  it('沒有 content-length 而內容超過 ⇒ 讀到上限就停', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(big));
        c.close();
      },
    });
    const req = new Request('https://www.pcmmotorsports.com/api/csp-report', { method: 'POST', body: stream, duplex: 'half' } as RequestInit); // duplex 不在 TS 的 RequestInit 型別裡
    expect(await readCapped(req)).toBeNull();
  });

  it('正常大小 ⇒ 讀得到全文', async () => {
    const body = report();
    const req = new Request('https://www.pcmmotorsports.com/api/csp-report', { method: 'POST', body });
    expect(await readCapped(req)).toBe(body);
  });
});
