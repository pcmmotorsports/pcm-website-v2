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
import { stripComments } from '../../lib/test-support/strip-comments';
import { AMOUNT_UNIT_PRICE_FIELD } from '../../lib/orders/amount-form';

const ORDER = '11111111-2222-3333-4444-555555555555';
const ITEM = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

/**
 * 🔴 **兩個殼各自要有正確的外框**:`table-row` 必須包在 `<table><tbody>` 裡
 *    (`<tr>` 不能裸放,jsdom 會把它丟掉 ⇒ 那會讓斷言對著一個空容器跑而恆綠);
 *    `card-line` 不能包在 table 裡(它渲染的是 `<details>`/`<div>`)。
 * ⚠️ 兩個殼**共用同一份 `formProps`** —— 那是刻意的:
 *    只要有一邊少傳一個 prop,兩邊的比較就不成立了。
 */
function setup(
  blockedReason: string | null | undefined = null,
  variant: 'table-row' | 'card-line' = 'table-row',
) {
  const row = (
    <ItemAmountRow
      variant={variant}
      rowClassName='border-t'
      colSpan={6}
      priceCellClassName='cell'
      before={
        variant === 'table-row' ? (
          <>
            <td>品名</td>
            <td>SKU-1</td>
            <td>2</td>
          </>
        ) : (
          <>
            <div>品名</div>
            <div>SKU-1</div>
            <div>2</div>
          </>
        )
      }
      priceText={<>NT$ 1,200</>}
      after={
        variant === 'table-row' ? (
          <>
            <td>NT$ 2,400</td>
            <td>軸</td>
          </>
        ) : (
          <div>NT$ 2,400</div>
        )
      }
      orderId={ORDER}
      expectedVersion={3}
      orderItemId={ITEM}
      currentUnitPrice={1200}
      returnTo={`/orders/${ORDER}`}
      blockedReason={blockedReason}
    />
  );
  return render(
    variant === 'table-row' ? (
      <table>
        <ItemAmountRowGroup>
          <tbody>{row}</tbody>
        </ItemAmountRowGroup>
      </table>
    ) : (
      <ItemAmountRowGroup>{row}</ItemAmountRowGroup>
    ),
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


/**
 * 剝掉 JSX 註解(`{/* … *\/}`)。原始碼層的結構斷言一律先過它。
 * 🔴 存在理由是實錘:尺原本直接數 `<th\b`,而**註解裡提到的 `<th>` 也被算成欄**。
 *    危險的方向是反的:刪掉一個真欄位 + 一句提到它的註解 ⇒ 一加一減 ⇒ 恆綠而版面已歪。
 */
function stripJsxComments(source: string): string {
  return source.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

describe('🗑 【不變量遷移】「展開列 colSpan == 表頭欄數」那一格已經移走,不是刪掉', () => {
  it('本檔不再數 `<th>` —— 而它守的那件事由 shape test 接手', () => {
    // 🔴 2026-08-19 片6a:結構從 `<table>` 換成 `.ihead` + `<details class="icard">`
    //    ⇒ 沒有 `<th>` 也沒有 colSpan ⇒ **「跨幾欄」這個不變量在新結構下沒有對象**。
    //    ⇒ 它守的那件事(欄頭與資料列必須對齊)換成了
    //      `order-detail-items-table-shape.test.tsx` 的
    //      「`.ihead` 與 `.iline` 由同一條 CSS 規則宣告軌道」。
    //    ⚠️ **寫在這裡是為了讓下一個人分得出「守門被弄丟」與「不變量不存在了」** ——
    //       兩者在 diff 上長得一模一樣。
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), 'order-detail-items-table.tsx'),
      'utf8',
    );
    // 🔴 用 repo 既有的 `stripComments`(剝 `/* */` 與 `//`),不是只剝 JSX 註解的那一支 ——
    //    受測檔裡還有兩處 **JSDoc 區塊註解**提到 `<th>`(`:178` / `:186`,片5 留下的舊敘述)。
    //    ⚠️ 那兩句現在是**過期字面**(它們描述的 `ITEMS_TABLE_COLSPAN`/表頭 `<th>` 數已不存在)
    //       —— 但**那是受測檔的散文,屬線主**,我只在這裡標記,不代改。
    expect(stripComments(src)).not.toContain('<th');
  });

  it('🔴 這把剝除器要分得出【註解裡的 th】與【真的 th】—— 兩個世界要給不同答案', () => {
    // 保留:它守的是「原始碼層斷言不得把註解當成結構」,與結構換不換無關。
    const strip = (src: string) => (stripJsxComments(src).match(/<th\b/g) ?? []).length;
    expect(strip("<tr><th>A</th>{/* 這裡提到 <th> 但它不是欄 */}<th>B</th></tr>")).toBe(2);
    expect(strip("<tr><th>A</th><th>B</th></tr>")).toBe(2);
    expect(strip("<tr><th>A</th>{/* <th> <th> <th> */}</tr>")).toBe(1);
  });
});

describe('🔴🔴 錢閘:「已收款 ⇒ 不得改金額」在【兩個殼】上都要成立', () => {
  // 🔴 線主 W1 明確要求這一族,理由逐字:**「一道閘在殼被重寫的過程中被漏掉,不會有東西紅。」**
  //    而它命中鐵則 12①(錢)⇒ 只驗「放行那半」不算過,**兩個世界都要釘**。
  // 🔴 而 `variant` 兩個值各驗一次的理由:兩個殼**宣稱**共用同一份 trigger/form,
  //    而那是宣稱 —— 要有東西釘著,否則哪天有人在卡片殼裡複製一份,兩份會各自漂。
  for (const variant of ['table-row', 'card-line'] as const) {
    describe(`variant=${variant}`, () => {
      it('🔴 已收款(blockedReason 有值)⇒ 展開後【不畫表單】、而且講得出原因', () => {
        const { container } = setup('這張單已經有收款紀錄,不開放改金額。', variant);
        fireEvent.click(container.querySelector('button')!);
        expect(container.querySelector('form')).toBeNull();
        expect(container.textContent).toContain('已經有收款紀錄');
      });

      it('✅ 未收款(blockedReason 為 undefined)⇒ 展開後【真的有表單】', () => {
        // 正向對照:沒有這一格,「永遠不畫表單」也會讓上一格通過。
        const { container } = setup(undefined, variant);
        fireEvent.click(container.querySelector('button')!);
        expect(container.querySelector('form')).not.toBeNull();
      });

      it('🔴 不能改時,入口的字先講出來(不是等點開才知道)', () => {
        const { container } = setup('這張單已經有收款紀錄,不開放改金額。', variant);
        expect(container.querySelector('button')!.textContent).toContain('無法改金額');
      });
    });
  }
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
