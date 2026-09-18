import { describe, expect, it } from 'vitest';
import {
  FITMENT_EXCLUSIONS,
  findFitmentExclusion,
  formatExclusionViolation,
  reconcileFitmentExclusions,
  type ExclusionSourceProduct,
} from './fitment-exclusions';

// fitment-exclusions.test.ts — 釘住那張例外表與它的對帳。
//
// 🔴🔴 **這一支的重點【不是】「表填對了」,是「對帳真的會叫」。**
//   理由:一道從來沒擋過東西的閘,與沒有閘長得一模一樣。
//   ⇒ 所以下面每一格正向斷言旁邊都有一個**動過手腳的輸入**,而它必須紅。

/** 用例外表自己組一份「全部對得上」的來源 —— 正向那一半的輸入。 */
const cleanSource: ExclusionSourceProduct[] = FITMENT_EXCLUSIONS.map((e) => ({
  brandSlug: e.brandSlug,
  externalId: e.externalId,
  description: `前面一些字 ${e.source} 後面一些字`,
}));

describe('FITMENT_EXCLUSIONS 這張表本身', () => {
  it('🔴 前提:表不是空的(空表會讓下面每一格恆真)', () => {
    expect(FITMENT_EXCLUSIONS.length).toBeGreaterThan(0);
  });

  it('每一筆至少有 years 或 excludes 其中一個(兩個都空 = 對客人零效果)', () => {
    for (const e of FITMENT_EXCLUSIONS) {
      const n = (e.years?.length ?? 0) + (e.excludes?.length ?? 0);
      expect(n, `${e.brandSlug}/${e.externalId} 兩個都空`).toBeGreaterThan(0);
    }
  });

  it('每一筆都留了 source 原文(對帳靠它,沒有它這一筆核不動)', () => {
    for (const e of FITMENT_EXCLUSIONS) {
      expect(e.source.trim(), `${e.externalId} 沒有 source`).not.toBe('');
    }
  });

  it('(supplierSlug, externalId) 不重複', () => {
    const keys = FITMENT_EXCLUSIONS.map((e) => `${e.brandSlug}/${e.externalId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('findFitmentExclusion:找得到 / 找不到都要對', () => {
    expect(findFitmentExclusion('rpm-carbon', 'XADV04')?.excludes?.[0]).toContain('2021');
    // 🔵 負對照:沒有條款是常態, 要回 undefined 而不是丟錯
    expect(findFitmentExclusion('rpm-carbon', 'ZZZ_NOT_A_REAL_SKU')).toBeUndefined();
    expect(findFitmentExclusion('lightech', 'XADV04')).toBeUndefined(); // 料號對而品牌不對
  });
});

describe('🔴 對帳:它【必須】叫,而且要講得出是哪一筆', () => {
  it('正向:來源全部對得上 ⇒ 零違規', () => {
    expect(reconcileFitmentExclusions(cleanSource)).toEqual([]);
  });

  it('🔵 負對照①:料號從來源消失 ⇒ 必須紅, 而且指名那一筆', () => {
    const tampered = cleanSource.filter((p) => p.externalId !== 'XADV04');
    expect(tampered.length, '這個負對照本身失效了(沒拿掉任何東西)').toBe(cleanSource.length - 1);
    const v = reconcileFitmentExclusions(tampered);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ kind: 'missing-product', externalId: 'XADV04' });
    expect(formatExclusionViolation(v[0]!)).toContain('XADV04');
  });

  it('🔵 負對照②:那句原文從描述裡不見了 ⇒ 必須紅', () => {
    const tampered = cleanSource.map((p) =>
      p.externalId === 'DUCMO937-06' ? { ...p, description: '供應商改寫了描述, 完全沒提那句話' } : p,
    );
    const v = reconcileFitmentExclusions(tampered, undefined, { checkClause: true });
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ kind: 'clause-gone', externalId: 'DUCMO937-06' });
    expect(formatExclusionViolation(v[0]!)).toContain('找不到了');
  });

  it('🔵 負對照③:描述整個是 null(那件商品沒描述)⇒ 也要紅, 不可以當成通過', () => {
    const tampered = cleanSource.map((p) =>
      p.externalId === 'XADV04' ? { ...p, description: null } : p,
    );
    const v = reconcileFitmentExclusions(tampered, undefined, { checkClause: true });
    expect(v.map((x) => x.kind)).toEqual(['clause-gone']);
  });

  it('🔵 負對照④:一筆 years 與 excludes 都空的 ⇒ 必須被指名', () => {
    const v = reconcileFitmentExclusions(
      [{ brandSlug: 'rpm-carbon', externalId: 'FAKE1', description: 'whatever 原文' }],
      [{ brandSlug: 'rpm-carbon', externalId: 'FAKE1', source: 'whatever 原文' }],
    );
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ kind: 'empty-entry', externalId: 'FAKE1' });
  });

  it('🛑 射程:它【不】驗中文寫得對不對 —— 寫錯字也照樣綠(這一格是把限度寫下來)', () => {
    const nonsense = [{ brandSlug: 'rpm-carbon', externalId: 'FAKE2', description: 'abc' }];
    const table = [
      { brandSlug: 'rpm-carbon', externalId: 'FAKE2', excludes: ['這句話完全是胡說八道'], source: 'abc' },
    ];
    // 🔴 它是綠的, 而那【不是 bug】—— 沒有機器判得動一句中文對不對。
    //    守那件事的是人看過, 不是這一格。寫在這裡免得有人以為對帳過了就代表文案沒問題。
    expect(reconcileFitmentExclusions(nonsense, table)).toEqual([]);
  });
});

describe('🔴 2026-09-18 R1 之後補的:用【真實形狀】餵,不要只餵自己組的乾淨輸入', () => {
  // 🛑 R1 nit 逐字:`cleanSource` 由例外表自己組 ⇒ **永遠對得上** ⇒ 它抓不到
  //    「source 抄錯 / 鍵用錯 / 兩邊文字不同源」。下面這幾格餵的是真實世界的形狀。

  it('🔵 條款檢查【預設關掉】—— 因為那句英文不在來源裡(乾跑實測 13 筆全不中)', () => {
    const source = [{ brandSlug: 'rpm-carbon', externalId: 'XADV04', description: '採用乾式碳纖維製造。適用車款與年式以本頁標示為準' }];
    const table = [FITMENT_EXCLUSIONS.find((e) => e.externalId === 'XADV04')!];
    // 預設:不比條款 ⇒ 過
    expect(reconcileFitmentExclusions(source, table)).toEqual([]);
    // 🔴 而開起來就會紅 —— 證明「關掉」是個決定,不是這把尺壞了
    expect(reconcileFitmentExclusions(source, table, { checkClause: true }).map((v) => v.kind)).toEqual(['clause-gone']);
  });

  it('🔴 同一群有多個變體(來源粒度是每列一變體)⇒ 任一列命中就算過, 不可以 last-wins', () => {
    const e = FITMENT_EXCLUSIONS.find((x) => x.externalId === 'XADV04')!;
    const source = [
      { brandSlug: 'rpm-carbon', externalId: 'XADV04', description: `有條款 ${e.source}` },
      { brandSlug: 'rpm-carbon', externalId: 'XADV04', description: null }, // 🔴 排在後面、沒有描述
    ];
    // 舊版 last-wins 會留下 description=null 那一列 ⇒ 誤判 clause-gone
    expect(reconcileFitmentExclusions(source, [e], { checkClause: true })).toEqual([]);
  });

  it('🔴 來源是 HTML 且大小寫不同 ⇒ 正規化之後仍要比得中', () => {
    const e = FITMENT_EXCLUSIONS.find((x) => x.externalId === 'DUCMO937-06')!;
    const source = [{
      brandSlug: 'rpm-carbon',
      externalId: 'DUCMO937-06',
      // 真實形狀:包標籤、換行、大小寫不同
      description: '<p><strong>does not fit\n  monster   937 SP</strong></p>',
    }];
    expect(reconcileFitmentExclusions(source, [e], { checkClause: true })).toEqual([]);
  });
});

describe('🔴 duplicate-key:同【品牌 + 料號】對到一件以上 ⇒ 必須紅, 而且指名', () => {
  // 🛑 今天實查是 **0 組**(2026-09-18), 而 **0 會變** —— 多一家供應商賣同一個品牌的
  //   同一個料號就撞。這一格就是為了那一天。
  it('🔵 負對照:塞一筆同品牌同料號的重複 ⇒ 必須紅並指名', () => {
    const e = FITMENT_EXCLUSIONS[0]!;
    const dup = [
      { brandSlug: e.brandSlug, externalId: e.externalId, supplierSlug: 'rpm', description: e.source },
      { brandSlug: e.brandSlug, externalId: e.externalId, supplierSlug: '別家', description: '另一家供應商賣的同品牌同料號' },
    ];
    const v = reconcileFitmentExclusions(dup, [e]);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ kind: 'duplicate-key', externalId: e.externalId, count: 2 });
    expect(formatExclusionViolation(v[0]!)).toContain('掛錯商品');
  });

  it('🔵 正向:同一件商品的【多個變體】不算撞號 —— 來源粒度就是每列一變體', () => {
    const e = FITMENT_EXCLUSIONS[0]!;
    // 🛑 這一格是上面那格的對照:同 supplier 的兩列是常態, 不可以誤判成撞號。
    //   (第一版判準寫成 `rows.length > 1`, 就是被這個形狀當場抓到的。)
    const sameProductTwoVariants = [
      { brandSlug: e.brandSlug, externalId: e.externalId, supplierSlug: 'rpm', description: e.source },
      { brandSlug: e.brandSlug, externalId: e.externalId, supplierSlug: 'rpm', description: e.source },
    ];
    expect(reconcileFitmentExclusions(sameProductTwoVariants, [e])).toEqual([]);
  });
});
