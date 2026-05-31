// @vitest-environment jsdom
//
// VehiclesTab smoke(g-6a 唯讀列表 + g-6b 新增表單 + g-6c 編輯/刪除/設主車)— 前台 regression 安全網。
//
// 驗:
// - 標題「我的愛車」+ acc-section 殼(data-tab="vehicles")+「＋ 新增車輛」鈕(g-6b)
// - 有車 → 渲染 .acc-bike 卡(h3 車型 + .acc-bike-meta);isPrimary → .acc-bike-primary + Primary/Secondary
// - .acc-bike-stats 條件渲染:km/mods/service 任一有值 → 渲染;全空 → 不渲染
// - 多筆全渲染 / 空清單 → design 空狀態字面「尚未新增愛車 — 新增後可記錄改裝履歷。」
// - g-6b:點「＋ 新增車輛」→ 開 InlineVehicleForm(heading「新增車輛」)
// - g-6c:每卡 .acc-addr-actions「編輯/刪除」鈕;點編輯 → 開編輯模式(heading「編輯車輛」+ 帶入既有值)
// - g-6c:編輯 submit → updateVehicleAction(該筆 id, payload);點刪除 → confirm 確認 deleteVehicleAction、取消則不刪(design L400)
// - 純 prop 驅動:空 prop 無任何卡(不洩 design localStorage mock 愛車)
//
// mock '@/app/account/vehicle/actions'(server action、transitively server-only 在 jsdom 爆)+ next/navigation。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { mockUpdateVehicleAction, mockDeleteVehicleAction } = vi.hoisted(() => ({
  mockUpdateVehicleAction: vi.fn(),
  mockDeleteVehicleAction: vi.fn(),
}));
vi.mock('@/app/account/vehicle/actions', () => ({
  addVehicleAction: vi.fn(),
  updateVehicleAction: mockUpdateVehicleAction,
  deleteVehicleAction: mockDeleteVehicleAction,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

// jsdom 不實作 scrollIntoView(g-6c inline-form 包裹層 ref 觸發會爆);就地補。
Element.prototype.scrollIntoView = vi.fn();

beforeEach(() => {
  mockUpdateVehicleAction.mockReset().mockResolvedValue({ ok: true });
  mockDeleteVehicleAction.mockReset().mockResolvedValue({ ok: true });
  // jsdom confirm 預設未實作;預設放行、單一測試 mockReturnValueOnce(false) 覆寫驗取消。
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

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

describe('VehiclesTab(g-6a 唯讀 + g-6b 新增 + g-6c 編輯/刪除)', () => {
  it('標題「我的愛車」+ acc-section 殼 +「＋ 新增車輛」鈕', () => {
    const { container } = render(<VehiclesTab vehicles={[]} />);
    expect(screen.getByText('我的愛車')).toBeTruthy();
    expect(container.querySelector('.acc-section[data-tab="vehicles"]')).toBeTruthy();
    expect(screen.getByRole('button', { name: '＋ 新增車輛' })).toBeTruthy();
  });

  it('有車 → .acc-bike 卡(車型 + 年份·引擎號 meta)', () => {
    const { container } = render(<VehiclesTab vehicles={[makeVeh()]} />);
    expect(screen.getByText('YAMAHA YZF-R6')).toBeTruthy();
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
    expect(screen.getByText('YAMAHA YZF-R6')).toBeTruthy();
  });

  it('空清單 → 空狀態字面(design L613)', () => {
    render(<VehiclesTab vehicles={[]} />);
    expect(screen.getByText('尚未新增愛車 — 新增後可記錄改裝履歷。')).toBeTruthy();
  });

  it('g-6b:點「＋ 新增車輛」→ 開 InlineVehicleForm(heading「新增車輛」)', () => {
    const { container } = render(<VehiclesTab vehicles={[]} />);
    expect(container.querySelector('.acc-inline-form')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增車輛' }));
    expect(screen.getByText('新增車輛')).toBeTruthy();
    expect(screen.getByPlaceholderText('YAMAHA YZF-R6')).toBeTruthy();
  });

  it('g-6c 每卡渲染 .acc-addr-actions「編輯/刪除」鈕(design L600-603)', () => {
    render(<VehiclesTab vehicles={[makeVeh()]} />);
    expect(screen.getByRole('button', { name: '編輯' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '刪除' })).toBeTruthy();
  });

  it('g-6c 點「編輯」→ 開編輯模式(heading「編輯車輛」+ 帶入既有值 車型/年份/引擎號)', () => {
    render(<VehiclesTab vehicles={[makeVeh({ name: '陳大文的 R1', year: '2020', engine: 'RN49-yyyyy' })]} />);
    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    expect(screen.getByText('編輯車輛')).toBeTruthy();
    expect((screen.getByPlaceholderText('YAMAHA YZF-R6') as HTMLInputElement).value).toBe('陳大文的 R1');
    expect((screen.getByPlaceholderText('2022') as HTMLInputElement).value).toBe('2020');
    expect((screen.getByPlaceholderText('RJ27-xxxxx') as HTMLInputElement).value).toBe('RN49-yyyyy');
  });

  it('g-6c 編輯 submit → updateVehicleAction(該筆 id, payload)(id 綁 parent closure)', async () => {
    render(<VehiclesTab vehicles={[makeVeh({ id: 'v-77' })]} />);
    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    fireEvent.submit(screen.getByText('儲存').closest('form')!);
    await waitFor(() => expect(mockUpdateVehicleAction).toHaveBeenCalledTimes(1));
    expect(mockUpdateVehicleAction.mock.calls[0]![0]).toBe('v-77');
  });

  it('g-6c 點「刪除」→ confirm 確認後 deleteVehicleAction(該筆 id)(對齊 design L400)', async () => {
    render(<VehiclesTab vehicles={[makeVeh({ id: 'v-77' })]} />);
    fireEvent.click(screen.getByRole('button', { name: '刪除' }));
    await waitFor(() => expect(mockDeleteVehicleAction).toHaveBeenCalledTimes(1));
    expect(mockDeleteVehicleAction).toHaveBeenCalledWith('v-77');
  });

  it('g-6c 刪除 confirm 取消(回 false)→ 不呼叫 deleteVehicleAction(對齊 design L400)', () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    render(<VehiclesTab vehicles={[makeVeh({ id: 'v-77' })]} />);
    fireEvent.click(screen.getByRole('button', { name: '刪除' }));
    expect(mockDeleteVehicleAction).not.toHaveBeenCalled();
  });

  it('g-6c 同一時間只開一個表單:開新增後點編輯 → 切換為編輯(新增表單收合)', () => {
    const { container } = render(<VehiclesTab vehicles={[makeVeh()]} />);
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增車輛' }));
    expect(screen.getByText('新增車輛')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    expect(screen.queryByText('新增車輛')).toBeNull();
    expect(screen.getByText('編輯車輛')).toBeTruthy();
    expect(container.querySelectorAll('.acc-inline-form').length).toBe(1);
  });

  it('純 prop 驅動:空 prop 無任何 .acc-bike 卡(不洩 design mock 愛車)', () => {
    const { container } = render(<VehiclesTab vehicles={[]} />);
    expect(container.querySelectorAll('.acc-bike').length).toBe(0);
  });
});
