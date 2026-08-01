// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MobileCatalogUxPreview } from './MobileCatalogUxPreview';

afterEach(cleanup);

describe('MobileCatalogUxPreview', () => {
  it('尚未選車時提供清楚的選車入口', () => {
    render(<MobileCatalogUxPreview />);

    expect(screen.getByRole('button', { name: '選擇車輛' })).toBeTruthy();
    expect(screen.getByText('先選車，只看裝得上的零件')).toBeTruthy();
    expect(screen.queryByText('從大量商品中，先縮小成真正適用你的車款。')).toBeNull();
    const browseAllButton = screen.getByRole('button', { name: '暫不選車，瀏覽全部商品' });
    const productResults = screen.getByRole('region', { name: '商品結果' });
    const scrollIntoView = vi.fn();
    Object.defineProperty(productResults, 'scrollIntoView', { value: scrollIntoView });

    fireEvent.click(browseAllButton);

    expect(scrollIntoView).toHaveBeenCalledOnce();
  });

  it('開啟選車面板不自動聚焦輸入欄位', () => {
    render(<MobileCatalogUxPreview />);

    fireEvent.click(screen.getByRole('button', { name: '選擇車輛' }));

    const dialog = screen.getByRole('dialog', { name: '選擇適用車輛' });
    const brandInput = within(dialog).getByLabelText('輸入廠牌搜尋');
    expect(document.activeElement).not.toBe(brandInput);
    expect(within(dialog).getByText('可直接選擇，也可輸入搜尋')).toBeTruthy();
  });

  it('套用 CBR600RR 2021 後顯示車輛摘要與實際分類數量', () => {
    render(<MobileCatalogUxPreview />);

    fireEvent.click(screen.getByRole('button', { name: '選擇車輛' }));
    fireEvent.click(screen.getByRole('button', { name: '套用我的愛車 HONDA CBR600RR 2021' }));

    expect(screen.getByText('HONDA CBR600RR')).toBeTruthy();
    expect(screen.getByText('161 件適用商品')).toBeTruthy();
    expect(screen.getByRole('button', { name: '拉桿與把手 36 件' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '查看全部分類 13 類' })).toBeTruthy();
  });

  it('分類與商品篩選使用不同面板，商品篩選不重新選車', () => {
    render(<MobileCatalogUxPreview />);

    fireEvent.click(screen.getByRole('button', { name: '選擇車輛' }));
    fireEvent.click(screen.getByRole('button', { name: '套用我的愛車 HONDA CBR600RR 2021' }));

    fireEvent.click(screen.getByRole('button', { name: '分類' }));
    expect(screen.getByRole('dialog', { name: '選擇商品分類' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '關閉分類面板' }));

    fireEvent.click(screen.getByRole('button', { name: '篩選' }));
    const filterDialog = screen.getByRole('dialog', { name: '篩選商品' });
    expect(within(filterDialog).getByText('商品品牌')).toBeTruthy();
    expect(within(filterDialog).getByText('價格')).toBeTruthy();
    expect(within(filterDialog).queryByText('現貨商品')).toBeNull();
    expect(within(filterDialog).queryByRole('button', { name: '選擇車輛' })).toBeNull();
    expect(within(filterDialog).queryByText('全部分類（13）')).toBeNull();
  });

  it('尚未選車時可從分類面板直接前往選車', () => {
    render(<MobileCatalogUxPreview />);

    fireEvent.click(screen.getByRole('button', { name: '分類' }));
    fireEvent.click(screen.getByRole('button', { name: '尚未指定車輛，前往選擇' }));

    expect(screen.getByRole('dialog', { name: '選擇適用車輛' })).toBeTruthy();
  });

  it('選車面板提供我的愛車，三個欄位可輸入過濾後點選', () => {
    render(<MobileCatalogUxPreview />);

    fireEvent.click(screen.getByRole('button', { name: '選擇車輛' }));
    const vehicleDialog = screen.getByRole('dialog', { name: '選擇適用車輛' });
    expect(within(vehicleDialog).getByText('我的愛車')).toBeTruthy();
    expect(within(vehicleDialog).getByRole('button', { name: '套用我的愛車 HONDA CBR600RR 2021' })).toBeTruthy();

    const brandInput = within(vehicleDialog).getByLabelText('輸入廠牌搜尋');
    fireEvent.focus(brandInput);
    fireEvent.change(brandInput, { target: { value: 'YAM' } });

    const brandOptions = within(vehicleDialog).getByRole('listbox', { name: '廠牌選項' });
    expect(within(brandOptions).queryByRole('button', { name: 'HONDA' })).toBeNull();
    fireEvent.click(within(brandOptions).getByRole('button', { name: 'YAMAHA' }));

    const modelInput = within(vehicleDialog).getByLabelText('輸入車型搜尋');
    fireEvent.focus(modelInput);
    expect(within(vehicleDialog).getByRole('listbox', { name: '車型選項' })).toBeTruthy();
  });

  it('從車輛摘要清除車輛後回到全部商品並清除分類', () => {
    render(<MobileCatalogUxPreview />);

    fireEvent.click(screen.getByRole('button', { name: '選擇車輛' }));
    fireEvent.click(screen.getByRole('button', { name: '套用我的愛車 HONDA CBR600RR 2021' }));
    fireEvent.click(screen.getByRole('button', { name: '拉桿與把手 36 件' }));
    fireEvent.click(screen.getByRole('button', { name: '清除目前車輛' }));

    expect(screen.queryByText('HONDA CBR600RR')).toBeNull();
    expect(screen.getByText('精選商品')).toBeTruthy();
    expect(screen.getByText('先選車，只看裝得上的零件')).toBeTruthy();
  });

  it('黏頂車輛列提供快速清除入口', () => {
    render(<MobileCatalogUxPreview />);

    fireEvent.click(screen.getByRole('button', { name: '選擇車輛' }));
    fireEvent.click(screen.getByRole('button', { name: '套用我的愛車 HONDA CBR600RR 2021' }));
    fireEvent.click(screen.getByRole('button', { name: '快速清除目前車輛' }));

    expect(screen.queryByText('HONDA CBR600RR')).toBeNull();
    expect(screen.getByText('精選商品')).toBeTruthy();
  });

  it('選車提示列可清空三個輸入欄位但不取消已套用車輛', () => {
    render(<MobileCatalogUxPreview />);

    fireEvent.click(screen.getByRole('button', { name: '選擇車輛' }));
    fireEvent.click(screen.getByRole('button', { name: '套用我的愛車 HONDA CBR600RR 2021' }));
    fireEvent.click(screen.getAllByRole('button', { name: '更換' })[0]!);

    const dialog = screen.getByRole('dialog', { name: '選擇適用車輛' });
    const brandInput = within(dialog).getByLabelText('輸入廠牌搜尋') as HTMLInputElement;
    const modelInput = within(dialog).getByLabelText('輸入車型搜尋') as HTMLInputElement;
    const yearInput = within(dialog).getByLabelText('輸入年份搜尋') as HTMLInputElement;

    fireEvent.click(within(dialog).getByRole('button', { name: '清除車輛輸入欄位' }));

    expect(brandInput.value).toBe('');
    expect(modelInput.value).toBe('');
    expect(yearInput.value).toBe('');
    expect(modelInput.disabled).toBe(true);
    expect(yearInput.disabled).toBe(true);
    expect(screen.getByRole('heading', { name: 'HONDA CBR600RR' })).toBeTruthy();
    expect(screen.getByRole('dialog', { name: '選擇適用車輛' })).toBeTruthy();
  });
});
