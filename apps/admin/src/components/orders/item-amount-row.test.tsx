// @vitest-environment jsdom
// item-amount-row.test.tsx — 展開列(M-4b E10 #13 片1c-2 版面片)。

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, fireEvent } from '@testing-library/react';

vi.mock('server-only', () => ({}));
vi.mock('../../lib/orders/amount-actions', () => ({
  updateOrderItemAmountAction: vi.fn(),
}));

import { ItemAmountRow, ItemAmountRowGroup } from './item-amount-row';
import { AMOUNT_UNIT_PRICE_FIELD } from '../../lib/orders/amount-form';

const ORDER = '11111111-2222-3333-4444-555555555555';
const ITEM = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function setup(blockedReason: string | null = null) {
  return render(
    <table>
      <ItemAmountRowGroup>
      <tbody>
        <ItemAmountRow
          rowClassName='border-t'
          colSpan={6}
          priceCellClassName='cell'
          before={
            <>
              <td>品名</td>
              <td>SKU-1</td>
              <td>2</td>
            </>
          }
          priceText={<>NT$ 1,200</>}
          after={
            <>
              <td>NT$ 2,400</td>
              <td>軸</td>
            </>
          }
          orderId={ORDER}
          expectedVersion={3}
          orderItemId={ITEM}
          currentUnitPrice={1200}
          returnTo={`/orders/${ORDER}`}
          blockedReason={blockedReason}
        />
      </tbody>
      </ItemAmountRowGroup>
    </table>,
  );
}

describe('ItemAmountRow — 收合/展開', () => {
  it('🔴 收合時【不多一列】,而且表單完全不在 DOM 裡', () => {
    // 品項多的訂單不該平白變兩倍長 —— 這一格就是釘那件事。
    const { container } = setup();
    expect(container.querySelectorAll('tr')).toHaveLength(1);
    expect(container.querySelector(`input[name="${AMOUNT_UNIT_PRICE_FIELD}"]`)).toBeNull();
  });

  it('六格內容照原樣出現在那一列(server 算好、當 children 傳進來)', () => {
    const { container } = setup();
    const tds = [...container.querySelectorAll('tr')[0]!.querySelectorAll('td')];
    expect(tds).toHaveLength(6);
    expect(tds.map((td) => td.textContent)).toEqual([
      '品名',
      'SKU-1',
      '2',
      expect.stringContaining('NT$ 1,200'),
      'NT$ 2,400',
      '軸',
    ]);
  });

  it('按「改金額」才展開,而展開列跨滿整張表', () => {
    const { container } = setup();
    fireEvent.click(container.querySelector('button')!);
    const rows = container.querySelectorAll('tr');
    expect(rows).toHaveLength(2);
    expect(rows[1]!.querySelector('td')?.getAttribute('colspan')).toBe('6');
    expect(container.querySelector(`input[name="${AMOUNT_UNIT_PRICE_FIELD}"]`)).not.toBeNull();
  });

  it('再按一次收起', () => {
    const { container } = setup();
    const btn = container.querySelector('button')!;
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(container.querySelectorAll('tr')).toHaveLength(1);
  });

  it('🔴 blockedReason 有值時:展開列顯示原因、不畫表單(重構最容易掉的那一行)', () => {
    const { container } = setup('這張單已經有收款紀錄,不開放改金額。');
    fireEvent.click(container.querySelector('button')!);
    expect(container.querySelector('form')).toBeNull();
    expect(container.textContent).toContain('已經有收款紀錄');
  });
});

describe('🔴 展開列的 colSpan 必須等於表頭欄數', () => {
  // 不一致時瀏覽器會**靜默把版面畫歪**,不會有任何東西紅 ⇒ 只能靠這一格。
  it('`ITEMS_TABLE_COLSPAN` 與 `<th>` 數逐字相同', () => {
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), 'order-detail-items-table.tsx'),
      'utf8',
    );
    const declared = Number(/ITEMS_TABLE_COLSPAN = (\d+);/.exec(src)?.[1]);
    // 🔴 nit6:也釘住 **call site 真的用那顆常數** —— 只釘「常數 == th 數」的話,
    //    有人把 call site 改成 `colSpan={5}` 兩格照樣綠。
    expect(src).toContain('colSpan={ITEMS_TABLE_COLSPAN}');
    // 只數品項表那段 thead 的 <th>(以 `<thead>` 起、`</thead>` 止的第一塊)
    const thead = /<thead>([\s\S]*?)<\/thead>/.exec(src)?.[1] ?? '';
    const thCount = (thead.match(/<th\b/g) ?? []).length;
    expect(declared).toBeGreaterThan(0); // 正向對照:真的抓到那個常數
    expect(thCount).toBeGreaterThan(0); // 正向對照:真的抓到那段 thead
    expect(declared).toBe(thCount);
  });
});

describe('🔴🔴 只展開「正在編輯的那一項」(codex 版面片 R1 must-fix 1)', () => {
  // 🔴 **這一格守的是「同時只有一個」,不是「點得開」** ——
  //    第一版每列各自 `useState` 時,上面所有格子**全部照樣綠**(每一列自己都開得起來)。
  //    ⇒ 唯一測得出那個缺陷的形狀是:**開 A 之後開 B,再回頭看 A 收了沒**。
  // ⚠️ 退回 local state 這一格會紅在 `expect(forms).toHaveLength(1)`。
  it('點開第二列時,第一列自己收起來(全表同時只有一個 form)', () => {
    const item2 = 'aaaaaaaa-bbbb-cccc-dddd-ffffffffffff';
    const { container } = render(
      <table>
        <ItemAmountRowGroup>
          <tbody>
            <ItemAmountRow
              rowClassName='border-t'
              colSpan={6}
              priceCellClassName='cell'
              before={<td>A</td>}
              priceText={<>A</>}
              after={<td>A</td>}
              orderId={ORDER}
              orderItemId={ITEM}
              expectedVersion={1}
              currentUnitPrice={1200}
              returnTo={`/orders/${ORDER}`}
              blockedReason={null}
            />
            <ItemAmountRow
              rowClassName='border-t'
              colSpan={6}
              priceCellClassName='cell'
              before={<td>B</td>}
              priceText={<>B</>}
              after={<td>B</td>}
              orderId={ORDER}
              orderItemId={item2}
              expectedVersion={1}
              currentUnitPrice={900}
              returnTo={`/orders/${ORDER}`}
              blockedReason={null}
            />
          </tbody>
        </ItemAmountRowGroup>
      </table>,
    );
    const triggers = container.querySelectorAll('button');
    expect(triggers).toHaveLength(2); // 正向對照:兩顆入口都在
    fireEvent.click(triggers[0]!);
    expect(container.querySelectorAll('form')).toHaveLength(1);
    fireEvent.click(triggers[1]!);
    // 🔴 這一行就是那條 must-fix:各自 local state 時這裡會是 2。
    expect(container.querySelectorAll('form')).toHaveLength(1);
  });

  it('🔴 不能改時,入口的字先講出來(不是等點開才知道)', () => {
    const { container } = setup('這張單已經有收款紀錄,不開放改金額。');
    expect(container.querySelector('button')!.textContent).toContain('無法改金額');
  });
});
