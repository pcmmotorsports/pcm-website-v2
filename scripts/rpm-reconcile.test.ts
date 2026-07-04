// rpm-reconcile.test.ts — V1 變體級對賬純分類(classifyVariantOrphans)回歸鎖
//
// 背景(2026-07-05 雙跨模型審查 must-fix F1-F3):群(main_sku)還在、群內變體 sku 從來源消失 →
//   變體殘留 DB + 前台選項可見 + create_order 可下單凍結舊價(客人買到停產色)。
//   classifyVariantOrphans = 差集決策核心;安全 gate 對齊商品級 delist(源空硬 abort / >10% abort)。

import { describe, it, expect } from 'vitest';
import { classifyVariantOrphans, type VariantOrphan } from './rpm-reconcile';

const tv = (sku: string, externalId: string): VariantOrphan => ({ sku, externalId });

describe('V1 classifyVariantOrphans(孤兒變體差集 + 安全 gate)', () => {
  it('群在、變體 sku 從來源消失 → 判孤兒(F1 核心情境:bonamici 某色停產)', () => {
    const target = [tv('PU_001-RED', 'PU_001'), tv('PU_001-BLK', 'PU_001')];
    const r = classifyVariantOrphans(target, new Set(['PU_001-RED']), new Set(['PU_001']), {
      allowLargeDelist: true, // 2 列中刪 1 = 50% 超閾、此測聚焦差集正確性、比例 gate 另測
    });
    expect(r.orphans).toEqual([tv('PU_001-BLK', 'PU_001')]);
    expect(r.aborted).toBe(false);
  });

  it('parent 群不在本次 source → 變體不判孤兒(交商品級 delist 路徑、RLS 連動隱藏)', () => {
    const target = [tv('GONE-01', 'GONE')]; // 整群從 source 消失
    const r = classifyVariantOrphans(target, new Set(['OTHER-01']), new Set(['OTHER']));
    expect(r.orphans).toEqual([]); // 不越權刪:群級軟下架已藏、復架時下一輪對賬收斂
    expect(r.targetInScope).toBe(0);
  });

  it('target 變體全在 source → 零孤兒(每日同步常態)', () => {
    const target = [tv('A-1', 'A'), tv('A-2', 'A')];
    const r = classifyVariantOrphans(target, new Set(['A-1', 'A-2']), new Set(['A']));
    expect(r.orphans).toEqual([]);
    expect(r.ratio).toBe(0);
    expect(r.aborted).toBe(false);
  });

  it('首載(target 空)→ 零孤兒、不 abort(試點首寫天然免疫)', () => {
    const r = classifyVariantOrphans([], new Set(['NEW-1']), new Set(['NEW']));
    expect(r.orphans).toEqual([]);
    expect(r.aborted).toBe(false);
  });

  it('🔴 source sku 集合空但 target 有列 → 硬 abort(疑 transform 失敗、絕不刪全部)', () => {
    const target = [tv('A-1', 'A')];
    const r = classifyVariantOrphans(target, new Set(), new Set(['A']));
    expect(r.aborted).toBe(true);
    expect(r.abortReason).toMatch(/絕不刪全部/);
  });

  it('🔴 孤兒比例 >10% → abort(疑來源變體殘缺);--allow-large-delist 顯式放行留 audit', () => {
    // 10 列中 2 孤兒 = 20% 超閾
    const target = Array.from({ length: 10 }, (_, i) => tv(`A-${i}`, 'A'));
    const srcSkus = new Set(Array.from({ length: 8 }, (_, i) => `A-${i}`)); // A-8/A-9 消失
    const blocked = classifyVariantOrphans(target, srcSkus, new Set(['A']));
    expect(blocked.aborted).toBe(true);
    expect(blocked.abortReason).toMatch(/--allow-large-delist/);

    const bypassed = classifyVariantOrphans(target, srcSkus, new Set(['A']), { allowLargeDelist: true });
    expect(bypassed.aborted).toBe(false);
    expect(bypassed.largeDeleteBypassed).toBe(true); // loud log + audit trail
    expect(bypassed.orphans).toHaveLength(2);
  });

  it('比例 ≤10% 日常汰換 → 不 abort、不標 bypass', () => {
    // 20 列刪 1 = 5%
    const target = Array.from({ length: 20 }, (_, i) => tv(`B-${i}`, 'B'));
    const srcSkus = new Set(Array.from({ length: 19 }, (_, i) => `B-${i}`));
    const r = classifyVariantOrphans(target, srcSkus, new Set(['B']));
    expect(r.aborted).toBe(false);
    expect(r.largeDeleteBypassed).toBe(false);
    expect(r.orphans).toEqual([tv('B-19', 'B')]);
  });
});
