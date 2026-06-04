// @vitest-environment jsdom
//
// LineCtaButton + line-cta smoke test。
// 驗:① 預填訊息含商品名 + 料號 + 頁面 URL ② 🔴 車種鐵律:預填零車款字串(不拼 product.fits / 車型)
// ③ 車型欄留空(結尾「我的車是…:」、冒號後無車款) ④ deep link 格式(oaMessage %40pcmmoto + urlencode)
// ⑤ 桌機:原生 <a href> = lin.ee 加好友頁 ⑥ 手機:<a href> = oaMessage 預填 deep link(非 window.open、避 popup 被擋)。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { LineCtaButton } from './LineCtaButton';
import { LINE_ADD_URL, LINE_OA_ID, buildOaDeepLink, buildPrefillMessage } from '../lib/line-cta';
import { MOCK_PRODUCTS } from '../data/mock-products';

const ORIG_UA = navigator.userAgent;
afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, 'userAgent', { value: ORIG_UA, configurable: true });
});

// lightech-1:name 'Lightech 鋁合金腳踏組'、fits 'CBR600RR'(有車款)、無 productCode。
const product = MOCK_PRODUCTS[0]!;
const PAGE_URL = 'https://pcm.example/products/lightech-1';

describe('buildPrefillMessage(車種鐵律守門)', () => {
  it('含商品名 + 料號(productCode 無 → slug)+ 頁面 URL', () => {
    const msg = buildPrefillMessage(product, PAGE_URL);
    expect(msg).toContain(product.name);
    expect(msg).toContain('料號:');
    expect(msg).toContain(product.slug);
    expect(msg).toContain(PAGE_URL);
  });

  it('🔴 車種鐵律:預填零車款字串(不拼 product.fits 廠牌 / 車型)', () => {
    const msg = buildPrefillMessage(product, PAGE_URL);
    expect(product.fits).toBe('CBR600RR'); // 該商品 fits 確有車款
    expect(msg).not.toContain(product.fits); // 但預填訊息不得含整串車款
    expect(msg).not.toContain('CBR'); // 車型片段亦不含
  });

  it('車型欄留空(結尾「我的車是(…):」、冒號後無車款)', () => {
    const msg = buildPrefillMessage(product, PAGE_URL);
    expect(msg.endsWith('我的車是(請告知年式 / 車型,幫您確認適用):')).toBe(true);
  });

  it('productCode 存在時料號用 productCode(非 slug)', () => {
    const withCode = { ...product, productCode: 'RPM-DCC01' };
    const msg = buildPrefillMessage(withCode, PAGE_URL);
    expect(msg).toContain('料號:RPM-DCC01');
  });
});

describe('buildOaDeepLink', () => {
  it('組 oaMessage deep link(@ encode 成 %40 + urlencode 訊息)', () => {
    const link = buildOaDeepLink('測試 訊息');
    expect(link).toBe(`https://line.me/R/oaMessage/${encodeURIComponent(LINE_OA_ID)}/?${encodeURIComponent('測試 訊息')}`);
    expect(link).toContain('%40pcmmoto'); // @ 必 encode、否則真機 line.me 解析失敗不喚起 App
  });
});

describe('LineCtaButton(原生 <a> 直跳、避手機 popup blocker)', () => {
  it('桌機:連結 href = lin.ee 加好友頁、target=_blank', () => {
    // jsdom userAgent 非手機 → 桌機路徑(useEffect 不改 href)
    render(<LineCtaButton product={product} />);
    const link = screen.getByRole('link', { name: '用 LINE 詢價' });
    expect(link.getAttribute('href')).toBe(LINE_ADD_URL);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('手機:連結 href = oaMessage %40pcmmoto 預填 deep link', () => {
    Object.defineProperty(navigator, 'userAgent', { value: 'iPhone', configurable: true });
    render(<LineCtaButton product={product} />);
    const link = screen.getByRole('link', { name: '用 LINE 詢價' });
    expect(link.getAttribute('href')).toContain('line.me/R/oaMessage/%40pcmmoto');
  });
});
