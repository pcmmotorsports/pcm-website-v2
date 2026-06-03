// @vitest-environment jsdom
//
// LineCtaButton + line-cta smoke test。
// 驗:① 預填訊息含商品名 + 料號 + 頁面 URL ② 🔴 車種鐵律:預填零車款字串(不拼 product.fits / 車型)
// ③ 車型欄留空(結尾「我的車是…:」、冒號後無車款) ④ deep link 格式(oaMessage @pcmmoto + urlencode)
// ⑤ 桌機點 → QRCODE modal(dialog + QR 圖 + 加好友連結 fallback) ⑥ 手機點 → window.open deep link。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { LineCtaButton } from './LineCtaButton';
import { LINE_ADD_URL, LINE_OA_ID, buildOaDeepLink, buildPrefillMessage } from '../lib/line-cta';
import { MOCK_PRODUCTS } from '../data/mock-products';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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
  it('組 oaMessage deep link(@pcmmoto + urlencode 訊息)', () => {
    const link = buildOaDeepLink('測試 訊息');
    expect(link).toBe(`https://line.me/R/oaMessage/${LINE_OA_ID}/?${encodeURIComponent('測試 訊息')}`);
    expect(link).toContain('@pcmmoto');
  });
});

describe('LineCtaButton', () => {
  it('桌機點 → 顯 QRCODE modal(dialog + QR 圖 + 加好友連結 fallback)', () => {
    // jsdom userAgent 非手機 → 桌機路徑
    render(<LineCtaButton product={product} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'LINE 詢價' }));
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByAltText('PCM LINE 官方帳號 QR Code')).toBeDefined();
    const addLink = screen.getByRole('link', { name: /加 LINE 好友/ });
    expect(addLink.getAttribute('href')).toBe(LINE_ADD_URL);
  });

  it('QR 圖載入失敗 → 顯 fallback 提示(破圖隱藏、加好友連結仍在)', () => {
    render(<LineCtaButton product={product} />);
    fireEvent.click(screen.getByRole('button', { name: 'LINE 詢價' }));
    fireEvent.error(screen.getByAltText('PCM LINE 官方帳號 QR Code'));
    expect(screen.queryByAltText('PCM LINE 官方帳號 QR Code')).toBeNull(); // 破圖隱藏
    expect(screen.getByText(/QR 圖準備中/)).toBeDefined();
    expect(screen.getByRole('link', { name: /加 LINE 好友/ }).getAttribute('href')).toBe(LINE_ADD_URL);
  });

  it('手機點 → window.open 開 oaMessage deep link(不開 modal)', () => {
    Object.defineProperty(navigator, 'userAgent', { value: 'iPhone', configurable: true });
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<LineCtaButton product={product} />);
    fireEvent.click(screen.getByRole('button', { name: 'LINE 詢價' }));
    expect(openSpy).toHaveBeenCalledOnce();
    const url = openSpy.mock.calls[0]![0] as string;
    expect(url).toContain('line.me/R/oaMessage/@pcmmoto');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
