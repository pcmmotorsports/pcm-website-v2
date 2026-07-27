// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { AdminDataTable, type AdminColumn } from './admin-data-table';

// E11-1 積木 smoke test。重點不在樣式,在三條會靜默壞掉的分支:
//   ①桌機/手機兩份 DOM 同時存在(§4-1 手機轉卡片) ②cell 回 null 時兩邊行為不同
//   (桌機顯「—」保持欄位對齊、手機略過整格避免出現「wang@… · —」)③mobile 槽位分派。
// 固定向量測不住排版,但這三條壞了看起來仍「有東西」——正是 smoke test 該擋的。

type Row = { id: string; name: string; email: string; phone: string | null; amount: number };

const ROWS: Row[] = [
  { id: 'a', name: '王大明', email: 'wang@example.com', phone: '0912-345-678', amount: 20300 },
  { id: 'b', name: '陳小華', email: 'chen@example.com', phone: null, amount: 4800 },
];

const COLUMNS: ReadonlyArray<AdminColumn<Row>> = [
  { key: 'name', header: '姓名', mobile: 'title', cell: (r) => r.name },
  { key: 'email', header: 'Email', mobile: 'sub', cell: (r) => r.email },
  { key: 'phone', header: '電話', mobile: 'sub', cell: (r) => r.phone },
  { key: 'amount', header: '金額', alignRight: true, mobile: 'trailing', cell: (r) => r.amount },
  { key: 'note', header: '備註', cell: () => '僅桌機' },
];

/** 取索引並斷言存在(tsconfig noUncheckedIndexedAccess);缺列/缺格 = 測試失敗,不靜默放行。 */
function at<T>(list: readonly T[], i: number): T {
  const item = list[i];
  if (item === undefined) throw new Error(`索引 ${i} 不存在(長度 ${list.length})`);
  return item;
}

function setup() {
  const { container } = render(
    <AdminDataTable
      rows={ROWS}
      columns={COLUMNS}
      getRowKey={(r) => r.id}
      emptyText='目前沒有符合條件的客戶。'
    />,
  );
  const table = container.querySelector('table');
  const cards = container.querySelector('ul');
  if (!table || !cards) throw new Error('桌機表格與手機卡片必須同時渲染');
  return { table, cards };
}

afterEach(cleanup);

describe('AdminDataTable', () => {
  it('should show only the empty text when there are no rows', () => {
    const { container, getByText } = render(
      <AdminDataTable
        rows={[]}
        columns={COLUMNS}
        getRowKey={(r) => r.id}
        emptyText='目前沒有符合條件的客戶。'
      />,
    );
    expect(getByText('目前沒有符合條件的客戶。')).toBeTruthy();
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelector('ul')).toBeNull();
  });

  it('should render every column as a desktop table cell, in order', () => {
    const { table } = setup();
    const headers = [...table.querySelectorAll('th')].map((th) => th.textContent);
    expect(headers).toEqual(['姓名', 'Email', '電話', '金額', '備註']);

    const firstRow = at([...table.querySelectorAll('tbody tr')], 0);
    const cells = [...firstRow.querySelectorAll('td')].map((td) => td.textContent);
    expect(cells).toEqual(['王大明', 'wang@example.com', '0912-345-678', '20300', '僅桌機']);
  });

  it('should render a dash for a null cell on desktop so columns stay aligned', () => {
    const { table } = setup();
    const secondRow = at([...table.querySelectorAll('tbody tr')], 1);
    const phoneCell = at([...secondRow.querySelectorAll('td')], 2);
    expect(phoneCell.textContent).toBe('—');
  });

  it('should omit a null field entirely on mobile instead of printing a dash', () => {
    const { cards } = setup();
    const items = [...cards.querySelectorAll('li')];
    expect(items).toHaveLength(2);
    // 有電話 → 副行含 email 與電話,以 · 串接
    expect(at(items, 0).textContent).toContain('0912-345-678');
    expect(at(items, 0).textContent).toContain('·');
    // 無電話 → 副行只剩 email,整份卡片不得出現「—」
    expect(at(items, 1).textContent).toContain('chen@example.com');
    expect(at(items, 1).textContent).not.toContain('—');
    expect(at(items, 1).textContent).not.toContain('·');
  });

  it('should place columns into their declared mobile slots and drop unslotted ones', () => {
    const { cards } = setup();
    const first = at([...cards.querySelectorAll('li')], 0);
    // title 粗體主行 + trailing 靠右,同一行
    const topLine = first.firstElementChild;
    expect(topLine?.textContent).toBe('王大明20300');
    // 未標 mobile 的欄位(備註)手機不出現
    expect(first.textContent).not.toContain('僅桌機');
  });

  it('should right-align a column flagged as alignRight on desktop only', () => {
    const { table, cards } = setup();
    const amountHeader = at([...table.querySelectorAll('th')], 3);
    expect(amountHeader.className).toContain('text-right');
    const firstRow = at([...table.querySelectorAll('tbody tr')], 0);
    const amountCell = at([...firstRow.querySelectorAll('td')], 3);
    expect(amountCell.className).toContain('text-right');
    expect(amountCell.className).toContain('tabular-nums');
    // 手機卡片的 trailing 槽自帶靠右:金額 span 本身不得帶 alignRight 的 class
    const first = at([...cards.querySelectorAll('li')], 0);
    const amountSpan = [...first.querySelectorAll('span')].find((s) => s.textContent === '20300');
    expect(amountSpan).toBeTruthy();
    expect(amountSpan?.className ?? '').not.toContain('text-right');
    expect(amountSpan?.className ?? '').not.toContain('tabular-nums');
  });

  it('should treat an empty string cell as blank on both layouts', () => {
    const { container } = render(
      <AdminDataTable
        rows={[{ id: 'c', name: '林先生', email: '', phone: null, amount: 100 }]}
        columns={COLUMNS}
        getRowKey={(r) => r.id}
        emptyText='—'
      />,
    );
    // 桌機:email 欄顯「—」保持對齊
    const row = at([...container.querySelectorAll('tbody tr')], 0);
    expect(at([...row.querySelectorAll('td')], 1).textContent).toBe('—');
    // 手機:副行 email 與電話皆空 → 整行不出現,也不得殘留「·」分隔符
    const card = at([...container.querySelectorAll('li')], 0);
    expect(card.textContent).not.toContain('—');
    expect(card.textContent).not.toContain('·');
  });

  it('should render optional actions only at the bottom of each mobile card', () => {
    const { container } = render(
      <AdminDataTable
        rows={ROWS}
        columns={COLUMNS}
        getRowKey={(r) => r.id}
        emptyText='—'
        renderMobileActions={(row) => (
          <form>
            <button type='submit'>編輯 {row.id}</button>
          </form>
        )}
      />,
    );

    const table = container.querySelector('table');
    const cards = [...container.querySelectorAll('ul li')];
    expect(table?.textContent).not.toContain('編輯 a');
    expect(cards).toHaveLength(2);
    expect(at(cards, 0).lastElementChild?.tagName).toBe('DIV');
    expect(at(cards, 0).lastElementChild?.textContent).toBe('編輯 a');
    expect(at(cards, 1).lastElementChild?.textContent).toBe('編輯 b');
  });
});
