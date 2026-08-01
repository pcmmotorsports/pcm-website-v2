// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { DesktopCatalogUxPreview } from './DesktopCatalogUxPreview';

afterEach(cleanup);

describe('DesktopCatalogUxPreview', () => {
  it('以固定桌機架構呈現選車、分類、商品條件與排序', () => {
    render(<DesktopCatalogUxPreview />);

    expect(screen.getByRole('heading', { name: '全部商品' })).toBeTruthy();
    expect(screen.getByText('選擇適用車輛')).toBeTruthy();
    expect(screen.getByText('我的愛車')).toBeTruthy();
    expect(screen.getByLabelText('輸入廠牌搜尋')).toBeTruthy();
    expect(screen.getByLabelText('輸入車型搜尋')).toBeTruthy();
    expect(screen.getByLabelText('輸入年份搜尋')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '商品分類' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '商品品牌' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '價格' })).toBeTruthy();
    expect(screen.getByLabelText('商品排序')).toBeTruthy();
    expect(screen.queryByText('現貨商品')).toBeNull();
  });

  it('我的愛車可直接套用，清除輸入不取消車輛，清除車輛回到全部商品', () => {
    render(<DesktopCatalogUxPreview />);

    fireEvent.click(screen.getByRole('button', { name: '桌機套用我的愛車 HONDA CBR600RR 2021' }));
    expect(screen.getByText('目前適用：HONDA CBR600RR・2021')).toBeTruthy();
    expect(screen.getByText('161 件適用商品')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '清除車輛輸入欄位' }));
    expect((screen.getByLabelText('輸入廠牌搜尋') as HTMLInputElement).value).toBe('');
    expect(screen.getByText('目前適用：HONDA CBR600RR・2021')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '清除已套用車輛' }));
    expect(screen.queryByText('目前適用：HONDA CBR600RR・2021')).toBeNull();
    expect(screen.getByText('6 件商品')).toBeTruthy();
  });

  it('廠牌欄位可輸入過濾，再繼續選擇車型與年份', () => {
    render(<DesktopCatalogUxPreview />);

    const brandInput = screen.getByLabelText('輸入廠牌搜尋');
    fireEvent.focus(brandInput);
    fireEvent.change(brandInput, { target: { value: 'YAM' } });

    const brandOptions = screen.getByRole('listbox', { name: '桌機廠牌選項' });
    expect(within(brandOptions).queryByRole('button', { name: 'HONDA' })).toBeNull();
    fireEvent.click(within(brandOptions).getByRole('button', { name: 'YAMAHA' }));

    const modelOptions = screen.getByRole('listbox', { name: '桌機車型選項' });
    fireEvent.click(within(modelOptions).getByRole('button', { name: 'MT-09' }));
    expect(screen.getByRole('listbox', { name: '桌機年份選項' })).toBeTruthy();
  });

  it('分類、商品品牌、價格與排序可獨立操作', () => {
    render(<DesktopCatalogUxPreview />);

    fireEvent.click(screen.getByRole('button', { name: '桌機分類 拉桿與把手 36 件' }));
    expect(screen.getByText('36 件商品')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'EVOTECH' }));
    expect(screen.getByRole('button', { name: 'EVOTECH', pressed: true })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'NT$ 3,000–8,000' }));
    expect(screen.getByRole('button', { name: 'NT$ 3,000–8,000', pressed: true })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('商品排序'), { target: { value: '最新上架' } });
    expect((screen.getByLabelText('商品排序') as HTMLSelectElement).value).toBe('最新上架');
  });
});
