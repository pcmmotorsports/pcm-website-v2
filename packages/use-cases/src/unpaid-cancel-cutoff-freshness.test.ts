import { describe, it, expect } from 'vitest';
import {
  unpaidCancelCutoffIsFresh,
  UNPAID_CANCEL_CUTOFF_FRESH_WINDOW_MS,
} from './deploy-cutoff';

/**
 * ⟦b4-CUTOFFWRONGCOLUMN⟧ 乙的守門 —— **兩個世界都要演,不是只演會紅的那一半。**
 *
 * 🔴 為什麼要有「好世界必須綠」那一發:一道恆真的閘與一道有效的閘,
 *    **在只跑壞世界的時候印同一個結果**。今晚全隊實測過這件事。
 */
const NOW = new Date('2026-09-08T00:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

describe('⟦b4-CUTOFFWRONGCOLUMN⟧ 乙:cutoff 剛動過的窗口要出聲', () => {
  it('🔴 壞世界:cutoff 一小時前才動 ⇒ fresh(那一天要有聲音)', () => {
    const r = unpaidCancelCutoffIsFresh(hoursAgo(1), NOW);
    expect(r.fresh).toBe(true);
    expect(Math.round(r.ageMs / 3_600_000)).toBe(1);
  });

  it('🟢 好世界:cutoff 已經放了 10 天 ⇒ 不 fresh(不得亂叫)', () => {
    expect(unpaidCancelCutoffIsFresh(hoursAgo(240), NOW).fresh).toBe(false);
  });

  it('🔴 邊界釘死 —— 門檻是 48 小時,而它不是我發明的:未付款單 TTL 1 天 + 1 天餘裕', () => {
    expect(UNPAID_CANCEL_CUTOFF_FRESH_WINDOW_MS).toBe(48 * 60 * 60 * 1000);
    // 47h59m ⇒ 還在窗口內;48h 整 ⇒ 已經出窗口。兩邊各釘一格,少一邊就分不出「>=」與「>」。
    expect(unpaidCancelCutoffIsFresh(hoursAgo(47.9), NOW).fresh).toBe(true);
    expect(unpaidCancelCutoffIsFresh(hoursAgo(48), NOW).fresh).toBe(false);
  });

  it('🔴 讀不懂的值要【自己出聲】—— 不得與「舊而安全」印同一個答案', () => {
    // R1 #6:new Date('垃圾') ⇒ NaN ⇒ NaN >= 0 是 false ⇒ 舊版會回 fresh:false,
    // 而那與「這顆 cutoff 放很久了, 沒事」是同一個答案。分開回才分得出兩個世界。
    const bad = unpaidCancelCutoffIsFresh('not-a-date', NOW);
    expect(bad.unparseable).toBe(true);
    expect(bad.fresh).toBe(false);
    expect(Number.isNaN(bad.ageMs)).toBe(true);
    // 🟢 正對照:一個讀得懂而且舊的值 ⇒ 同樣 fresh:false, 而 unparseable 必須是 false
    const oldOk = unpaidCancelCutoffIsFresh(hoursAgo(240), NOW);
    expect(oldOk.fresh).toBe(false);
    expect(oldOk.unparseable).toBe(false);
  });

  it('🛑 未來的 cutoff(有人填錯成明天)⇒ 不 fresh, 而那是【刻意】的', () => {
    // ageMs < 0。它不屬於「剛動過」那個窗口 —— 那種填錯有它自己的守門(readDeployCutoff 的形狀檢查
    // 擋不到「合法但在未來」),而本格【不假裝管它】。寫下來免得下一個人以為這裡守住了。
    const future = new Date(NOW.getTime() + 3_600_000).toISOString();
    expect(unpaidCancelCutoffIsFresh(future, NOW).fresh).toBe(false);
    expect(unpaidCancelCutoffIsFresh(future, NOW).ageMs).toBeLessThan(0);
  });
});
