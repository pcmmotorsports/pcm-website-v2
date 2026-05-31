// @vitest-environment jsdom
//
// VehiclesTab smoke(g-6a 唯讀列表)— 前台 regression 安全網。
//
// 驗:
// - 標題「我的愛車」+ acc-section 殼(data-tab="vehicles")
// - 有車 → 渲染 .acc-bike 卡(h3 車型 + .acc-bike-meta 年份·引擎號);isPrimary → .acc-bike-primary class +
//   .ap-mono「Primary」、非主車「Secondary」
// - .acc-bike-stats 條件渲染:km/mods/service 任一有值 → 渲染(各自有值才顯);全空 → 不渲染 stats 區
// - 多筆全渲染 / 空清單 → design 空狀態字面「尚未新增愛車 — 新增後可記錄改裝履歷。」
// - 純 prop 驅動:空 prop 無任何卡(不洩 design localStorage mock 愛車)
//
// g-6a 唯讀(無 action / 無 useRouter / 無 server action import)→ 不需 mock(對比 AddressTab g-5b/c)。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { VehiclesTab } from './VehiclesTab';
import type { CustomerVehicle } from '@pcm/domain';

afterEach(cleanup);

function makeVeh(over: Partial<CustomerVehicle> = {}): CustomerVehicle {
  return {
    id: 'v1',
    customerUserId: 'u1',
    isPrimary: false,
    name: 'YAMAHA YZF-R6',
    year: '2022',
    engine: 'RJ27-xxxxx',
    km: '12,340 km',
    mods: '7 件',
    service: '2026-03-12',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

describe('VehiclesTab(g-6a 唯讀列表)', () => {
  it('標題「我的愛車」+ acc-section 殼(data-tab="vehicles")', () => {
    const { container } = render(<VehiclesTab vehicles={[]} />);
    expect(screen.getByText('我的愛車')).toBeTruthy();
    expect(container.querySelector('.acc-section[data-tab="vehicles"]')).toBeTruthy();
  });

  it('有車 → .acc-bike 卡(車型 + 年份·引擎號 meta)', () => {
    const { container } = render(<VehiclesTab vehicles={[makeVeh()]} />);
    expect(screen.getByText('YAMAHA YZF-R6')).toBeTruthy();
    // meta = year + ' · 引擎號 ' + engine(同卡片內、用 textContent 比對避免被斷成多 text node)
    expect(container.querySelector('.acc-bike-meta')?.textContent).toBe('2022 · 引擎號 RJ27-xxxxx');
  });

  it('isPrimary → .acc-bike-primary class + Primary 標籤;非主車 → Secondary', () => {
    const { container } = render(
      <VehiclesTab vehicles={[makeVeh({ id: 'v1', isPrimary: true }), makeVeh({ id: 'v2', isPrimary: false })]} />,
    );
    const cards = container.querySelectorAll('.acc-bike');
    expect(cards.length).toBe(2);
    expect(cards[0]?.classList.contains('acc-bike-primary')).toBe(true);
    expect(cards[1]?.classList.contains('acc-bike-primary')).toBe(false);
    expect(screen.getByText('Primary')).toBeTruthy();
    expect(screen.getByText('Secondary')).toBeTruthy();
  });

  it('stats 條件渲染:km/mods/service 全空 → 不渲染 .acc-bike-stats', () => {
    const { container } = render(
      <VehiclesTab vehicles={[makeVeh({ km: '', mods: '', service: null })]} />,
    );
    expect(container.querySelector('.acc-bike-stats')).toBeNull();
    // 但車型 + meta 仍在
    expect(screen.getByText('YAMAHA YZF-R6')).toBeTruthy();
  });

  it('stats 逐項:有 km/mods/service → 顯里程/已改裝/最近保養', () => {
    render(<VehiclesTab vehicles={[makeVeh()]} />);
    expect(screen.getByText('里程')).toBeTruthy();
    expect(screen.getByText('12,340 km')).toBeTruthy();
    expect(screen.getByText('已改裝')).toBeTruthy();
    expect(screen.getByText('最近保養')).toBeTruthy();
  });

  it('空清單 → 空狀態字面(design L613)', () => {
    render(<VehiclesTab vehicles={[]} />);
    expect(screen.getByText('尚未新增愛車 — 新增後可記錄改裝履歷。')).toBeTruthy();
  });

  it('純 prop 驅動:空 prop 無任何 .acc-bike 卡(不洩 design mock 愛車)', () => {
    const { container } = render(<VehiclesTab vehicles={[]} />);
    expect(container.querySelectorAll('.acc-bike').length).toBe(0);
  });
});
