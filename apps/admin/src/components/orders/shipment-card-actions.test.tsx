// @vitest-environment jsdom
// shipment-card-actions.test.tsx — 包裹卡動作版面(2026-09-09,Sean 挑摺疊版之後留下的守門)。
//
// 🔴🔴 **本檔最重要的一格是「作廢預設看不到」** —— 而那正是這個版面的**全部價值**:
//    Sean 選摺疊版的理由是「最危險的那顆不要跟最常按的並排」。
//    ⇒ 📌 哪天有人把 `<details>` 換成一個 `<div>`、或給它加上 `open`,
//      **畫面會看起來只是「比較長」,而那顆紅鈕就回到日常動作旁邊了** —— 沒有東西會紅。
//
// ⚠️ **誠實邊界:jsdom 不排版。**
//    真瀏覽器上我量到的是 `checkVisibility() === false`(2026-09-09、鑽機 3011、箱 RQQJ2K),
//    而 jsdom **沒有實作 `<details>` 的收合渲染** ⇒ 那個量法在這裡不成立。
//    ⇒ 這裡釘的是**產生那個結果的結構**:作廢在一個【沒有 `open`】的 `<details>` 裡面。
//    🛑 **兩者不是同一件事** —— 結構對而 CSS 被人蓋掉時,本檔仍然全綠。
//      那一半只有真的開瀏覽器才算數(同 `admin-probe/up.sh` 檔頭那條)。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { ShipmentCardActions } from './shipment-card-actions';

// 🔴 少了它 ⇒ 上一格 render 的節點留在 document 裡 ⇒ 下一格 `getByRole` 撞到
//    「found multiple elements」而**紅在一個與被測行為無關的地方**(本檔第一版實測)。
afterEach(cleanup);

const mount = () =>
  render(
    <ShipmentCardActions
      notice={<span>送出結果未知</span>}
      primary={<button type='button'>送新竹</button>}
      secondary={<button type='button'>列印出貨明細單</button>}
      danger={<button type='button'>作廢這一箱</button>}
    />,
  );

describe('摺疊版(Sean 2026-09-09 挑的那版)', () => {
  it('🔴 作廢預設收在「其他操作」裡 —— 它所在的 details 沒有 open', () => {
    mount();
    const danger = screen.getByRole('button', { name: '作廢這一箱' });
    const details = danger.closest('details');
    expect(details).not.toBeNull();
    // 🔴 `hasAttribute` 不是 `.open`:`.open` 在 jsdom 一樣回 false,而**屬性**才是渲染出去的那個字。
    expect(details?.hasAttribute('open')).toBe(false);
  });

  it('🔴 日常動作也收在同一個 details 裡(不是只有作廢被收)', () => {
    mount();
    const secondary = screen.getByRole('button', { name: '列印出貨明細單' });
    expect(secondary.closest('details')).not.toBeNull();
  });

  // 🔴 負對照:收起來 ≠ 拿掉。摸不到的話員工會來問人,而那是另一種病。
  it('🔴 收起來不等於拿掉 —— 作廢仍然在 DOM 裡', () => {
    mount();
    expect(screen.getByRole('button', { name: '作廢這一箱' })).toBeTruthy();
  });

  it('🔴 主要動作【不】被收起來 —— 送新竹在 details 外面', () => {
    mount();
    expect(screen.getByRole('button', { name: '送新竹' }).closest('details')).toBeNull();
  });

  // 🛑 警示收進摺疊 = 把「這一箱送出結果未知」藏起來,而那要員工立刻看到。
  it('🔴 警示【不】被收起來', () => {
    mount();
    expect(screen.getByText('送出結果未知').closest('details')).toBeNull();
  });

  it('沒有主要動作時不畫空殼(primary = null)', () => {
    render(
      <ShipmentCardActions
        notice={null}
        primary={null}
        secondary={<button type='button'>列印出貨明細單</button>}
        danger={<button type='button'>作廢這一箱</button>}
      />,
    );
    expect(screen.queryByRole('button', { name: '送新竹' })).toBeNull();
    expect(screen.getByRole('button', { name: '作廢這一箱' }).closest('details')).not.toBeNull();
  });
});
