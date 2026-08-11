// layout.test.ts — #385 `/dev-preview/*` 環境閘的守門。
//
// 🔴 為什麼測純函式**而不是**只測 layout:判準是一張矩陣,而 layout 一次只跑得到一格。
//    純函式讓「讀不到 VERCEL_ENV 時往哪邊倒」這格**測得到**——那格正是本片唯一的 fail-closed 支點。
// 🔴 最後一組(layout 本體)不能省:少了它,「把 notFound() 那行刪掉」的突變會讓上面全綠。

import { describe, expect, it, vi } from 'vitest';

const notFound = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ notFound }));

import DevPreviewLayout, { isDevPreviewReachable } from './layout';

describe('#385 isDevPreviewReachable — 環境矩陣', () => {
  it('🔴 Vercel 正式站 ⇒ 關(本片的目標)', () => {
    expect(isDevPreviewReachable({ VERCEL_ENV: 'production', NODE_ENV: 'production' })).toBe(false);
  });

  it('Vercel preview / vercel dev ⇒ 開', () => {
    expect(isDevPreviewReachable({ VERCEL_ENV: 'preview', NODE_ENV: 'production' })).toBe(true);
    expect(isDevPreviewReachable({ VERCEL_ENV: 'development', NODE_ENV: 'production' })).toBe(true);
  });

  it('🔴 讀不到 VERCEL_ENV + production build ⇒ 關(fail-closed 支點)', () => {
    // 這格是本片最重要的一格:Turbo strict mode 濾掉 VERCEL_ENV、或 Vercel 關掉系統變數曝露時,
    // 現場就是這一格。把 fallback 改成 `return true` ⇒ 只有這格紅。
    expect(isDevPreviewReachable({ VERCEL_ENV: undefined, NODE_ENV: 'production' })).toBe(false);
  });

  it('本機 next dev / 測試環境 ⇒ 開(不能把開發者一起擋掉)', () => {
    expect(isDevPreviewReachable({ VERCEL_ENV: undefined, NODE_ENV: 'development' })).toBe(true);
    expect(isDevPreviewReachable({ VERCEL_ENV: undefined, NODE_ENV: 'test' })).toBe(true);
  });

  it('🔴 沒見過的 VERCEL_ENV 值 ⇒ 關(白名單,不是黑名單)', () => {
    // 把實作寫成黑名單 `VERCEL_ENV !== 'production'` ⇒ 只有這格紅。
    // 方向:未知環境當正式站看待,寧可擋錯不可放錯。
    for (const unknown of ['staging', 'PRODUCTION', '', 'prod']) {
      expect(isDevPreviewReachable({ VERCEL_ENV: unknown, NODE_ENV: 'production' })).toBe(false);
    }
  });
});

describe('#385 DevPreviewLayout — 真的有呼 notFound', () => {
  it('🔴 被判關 ⇒ 呼 notFound;被判開 ⇒ 不呼、原樣回 children', () => {
    notFound.mockClear();
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('NODE_ENV', 'production');
    DevPreviewLayout({ children: null });
    expect(notFound).toHaveBeenCalledTimes(1);

    // 正向對照:少了它,「layout 永遠呼 notFound」的突變也會讓上一行綠。
    notFound.mockClear();
    vi.stubEnv('VERCEL_ENV', 'preview');
    const out = DevPreviewLayout({ children: 'PREVIEW_OK' });
    expect(notFound).not.toHaveBeenCalled();
    expect(out).toBe('PREVIEW_OK');

    vi.unstubAllEnvs();
  });
});
