// rpm-import-same-name-category.test.ts — 父子同名分類(`X · X`)查無時退回頂層 `X`
// (Sean 2026-09-14 Q17 丙:維修零件 · 維修零件 併進 維修零件;migration 20260915090000)。
// 🔴 沒這條退路,貼板之後 major=sub=維修零件 那幾家會整批 abort(rpm-import.ts 「未 seed 子類」那道閘)。
import { describe, expect, it } from 'vitest';

const SEP = ' · ';

describe('sameNameParentPath', () => {
  it('維修零件 · 維修零件 ⇒ 維修零件', async () => {
    const { sameNameParentPath } = await import('./rpm-import');
    expect(sameNameParentPath(`維修零件${SEP}維修零件`, SEP)).toBe('維修零件');
  });

  it('🔵 負對照:父子不同名 / 只有一段 / 三段 / 空字 ⇒ null(不猜)', async () => {
    const { sameNameParentPath } = await import('./rpm-import');
    expect(sameNameParentPath(`排氣系統${SEP}尾段排氣管(Slip-On)`, SEP)).toBeNull();
    expect(sameNameParentPath('維修零件', SEP)).toBeNull();
    expect(sameNameParentPath(`a${SEP}a${SEP}a`, SEP)).toBeNull();
    expect(sameNameParentPath(`${SEP}`, SEP)).toBeNull();
  });

  it('🔴 resolveCategoryByPath 真的接了這條退路(靜態:查無之後才叫、用的是同一個 helper)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./rpm-import.ts', import.meta.url), 'utf8');
    const i = src.indexOf('async function resolveCategoryByPath');
    const block = src.slice(i, src.indexOf('categoryIdCache.set(rawPath, id)', i));
    expect(block).toContain('if (id === null)');
    expect(block).toContain('sameNameParentPath(rawPath, CATEGORY_PATH_SEP)');
  });
});
