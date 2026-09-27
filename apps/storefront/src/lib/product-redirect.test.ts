import { beforeEach, describe, expect, it, vi } from 'vitest';

// product-redirect.test.ts — 商品舊網址轉址(20260927100000;Ilmberger 合卡配套)。資料庫用假的。

const m = vi.hoisted(() => ({ result: { data: null as unknown, error: null as unknown }, calls: [] as unknown[][], throws: false }));
vi.mock('./catalog-anon-client', () => ({
  createCatalogAnonClient: () => {
    if (m.throws) throw new Error('env 沒設');
    const chain = {
      from: (...a: unknown[]) => (m.calls.push(['from', ...a]), chain),
      select: (...a: unknown[]) => (m.calls.push(['select', ...a]), chain),
      eq: (...a: unknown[]) => (m.calls.push(['eq', ...a]), chain),
      maybeSingle: async () => m.result,
    };
    return chain;
  },
}));

import { findProductRedirect } from './product-redirect';
import { productRedirectPath } from './product-redirect-path';

beforeEach(() => {
  m.result = { data: null, error: null };
  m.calls = [];
  m.throws = false;
});

describe('findProductRedirect', () => {
  it('查前台 view(不是表), 用舊 handle 找新 handle', async () => {
    m.result = { data: { new_handle: 'ilmberger-new-1' }, error: null };
    expect(await findProductRedirect('ilmberger-old-1')).toBe('ilmberger-new-1');
    expect(m.calls).toEqual([
      ['from', 'product_redirects_live_v'],
      ['select', 'new_handle'],
      ['eq', 'old_handle', 'ilmberger-old-1'],
    ]);
  });

  it('查無 ⇒ null(照舊 404)', async () => {
    expect(await findProductRedirect('nope')).toBeNull();
  });

  it('🔴 查詢出錯或連不上 ⇒ null(404), 不讓商品頁壞掉', async () => {
    m.result = { data: null, error: { message: 'relation does not exist' } };
    expect(await findProductRedirect('x')).toBeNull();
    m.throws = true;
    expect(await findProductRedirect('x')).toBeNull();
  });

  it('轉到自己 / 空字串 ⇒ 不轉(不做無限轉址)', async () => {
    m.result = { data: { new_handle: 'same' }, error: null };
    expect(await findProductRedirect('same')).toBeNull();
    m.result = { data: { new_handle: '' }, error: null };
    expect(await findProductRedirect('x')).toBeNull();
  });
});

describe('productRedirectPath', () => {
  it('帶上原本的網址參數;handle 做編碼', () => {
    expect(productRedirectPath('ilmberger-new-1', {})).toBe('/products/ilmberger-new-1');
    expect(productRedirectPath('a b', { v: '2', tag: ['x', 'y'], skip: undefined })).toBe('/products/a%20b?v=2&tag=x&tag=y');
  });
});
