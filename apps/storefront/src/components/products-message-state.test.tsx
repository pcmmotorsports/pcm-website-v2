// @vitest-environment jsdom
// products-message-state.test.tsx — 訊息態的兩件事:
//   ① 車款讀不到那句話【只有一個定義點】(複製成兩份會分岔, 而分岔不會紅)
//   ② `VehicleTaxonomyNotice` 只在 `failed` 為真時說話
//
// 🔴 **①【不是潔癖】** —— `packages/domain/src/catalog/supplier-placeholder.ts` 檔頭
//    逐字警告過「複製成兩份 ⇒ 它們會分岔, 而分岔不會紅」。四處共用一句話, 正是那個形狀。
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { VEHICLE_TAXONOMY_UNAVAILABLE, VehicleTaxonomyNotice } from './products-message-state';

afterEach(cleanup);

describe('車款讀不到那句話 · 單一定義點(⟦search-TAXONOMYTIMEOUT⟧)', () => {
  // 🔴 **用 `git grep -l` 數【檔】不是數行** —— 同一支檔裡出現兩次仍是一個定義點。
  // 🛑 **排除 `.test.` 是【必要的】而且要講明**:本檔自己就含那個字面
  //    ⇒ 不排除的話這一格會被自己的存在弄紅, 而那個紅什麼都沒證明。
  const nonTestFilesContaining = (literal: string): string[] =>
    execFileSync('git', ['grep', '-l', '--', literal, 'apps', 'packages'], { encoding: 'utf8' })
      .split('\n')
      .filter((f) => f !== '' && !f.includes('.test.'));

  it('🔴 非測試檔裡只有一支含那個字面, 而它就是定義處', () => {
    expect(nonTestFilesContaining(VEHICLE_TAXONOMY_UNAVAILABLE)).toEqual([
      'apps/storefront/src/components/products-message-state.tsx',
    ]);
  });

  it('🟢 正對照:這把尺會動 —— 拿一個【確定散落多處】的字面去問, 要回多支', () => {
    // `motoBrands` 這個識別字在多支非測試檔裡都有 ⇒ 若尺壞了(恆回 1 支)這一格會紅。
    expect(nonTestFilesContaining('motoBrands').length).toBeGreaterThan(3);
  });

  it('🔵 負對照:現造一個不存在的字面 ⇒ 零支', () => {
    // 🔴 `git grep` 查無時 rc=1 ⇒ execFileSync 會 throw, 那正是「零支」的形狀。
    expect(() => nonTestFilesContaining('zqTaxonomyNopeXY7')).toThrow();
  });
});

describe('VehicleTaxonomyNotice · 讀不到與真的沒有是兩種東西', () => {
  it('failed=true ⇒ 說話, 而且是 role="alert"', () => {
    render(<VehicleTaxonomyNotice failed />);
    expect(screen.getByRole('alert').textContent).toBe(VEHICLE_TAXONOMY_UNAVAILABLE);
  });

  it('🔵 負對照:failed=false ⇒ 什麼都不畫(這才是「真的沒有」那一態)', () => {
    const { container } = render(<VehicleTaxonomyNotice failed={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('🔵 負對照:連 prop 都沒給 ⇒ 什麼都不畫(舊呼叫端零改動)', () => {
    const { container } = render(<VehicleTaxonomyNotice />);
    expect(container.innerHTML).toBe('');
  });
});
