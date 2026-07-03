// @vitest-environment jsdom
//
// ProductServices smoke test — 前台 regression 安全網(M-1-13f-1)。
// 驗「4 卡 label + desc 字面渲染」(對齊鐵則 1「直接搬」、字面是合約)。
// 純 presentational、無 hooks;唯一 prop = isRpmCarbon(P0-C 去碳卡級守門)、不需 router / matchMedia stub。
// P0-C:isRpmCarbon=true → 4 卡(含泰國原廠、RPM byte 不變);false → 3 卡(泰國原廠卡去碳、其餘 3 卡通用不動)。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { ProductServices } from './ProductServices';

afterEach(cleanup);

describe('ProductServices', () => {
  it('RPM(isRpmCarbon):renders 4 service labels (滿額免運 / 專業安裝 / 泰國原廠 / LINE 諮詢)', () => {
    render(<ProductServices isRpmCarbon />);
    expect(screen.getByText('滿額免運')).toBeDefined();
    expect(screen.getByText('專業安裝')).toBeDefined();
    expect(screen.getByText('泰國原廠')).toBeDefined();
    expect(screen.getByText('LINE 諮詢')).toBeDefined();
  });

  it('RPM(isRpmCarbon):renders 4 service descriptions matching OD 模板字面', () => {
    render(<ProductServices isRpmCarbon />);
    // OD-5:字面直接搬 OD product-detail-rpm-template.html(免運門檻仍 5,000、對齊 Sean 永久拍板)
    expect(screen.getByText('NT$ 5,000 以上免運費')).toBeDefined();
    expect(screen.getByText('全台合作店家')).toBeDefined();
    expect(screen.getByText('RPM Carbon 授權代理')).toBeDefined();
    expect(screen.getByText('下單前先聊聊確認貨況')).toBeDefined();
  });

  it('RPM(isRpmCarbon):renders exactly 4 .pd-service cards inside a full-width .pd-services-strip section', () => {
    render(<ProductServices isRpmCarbon />);
    // OD-5:元件改吐完整 section.pd-services-strip(全寬橫條外殼由本元件擁有)
    const strip = document.querySelector('section.pd-services-strip');
    expect(strip).not.toBeNull();
    const cards = document.querySelectorAll('.pd-service');
    expect(cards.length).toBe(4);
  });

  // 🔴 P0-C 去碳卡級守門:非 RPM 隱藏「泰國原廠 / RPM Carbon 授權代理」卡,但 3 張通用服務卡不動。
  it('非 RPM(!isRpmCarbon):去碳藏泰國原廠卡、其餘 3 張通用卡照渲染(Q2=B)', () => {
    render(<ProductServices isRpmCarbon={false} />);
    // 泰國原廠(RPM 專屬)整卡消失、無 RPM 字樣
    expect(screen.queryByText('泰國原廠')).toBeNull();
    expect(screen.queryByText('RPM Carbon 授權代理')).toBeNull();
    // 3 張通用服務承諾仍全顯(不誤藏)
    expect(screen.getByText('滿額免運')).toBeDefined();
    expect(screen.getByText('專業安裝')).toBeDefined();
    expect(screen.getByText('LINE 諮詢')).toBeDefined();
    const strip = document.querySelector('section.pd-services-strip');
    expect(strip).not.toBeNull();
    expect(document.querySelectorAll('.pd-service').length).toBe(3);
  });
});
