// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ListPagination } from './list-pagination';

// list-pagination.test.tsx — 2026-08-19 商品分頁片。
//
// 🔴🔴 **本檔存在的第一理由 = 釘住「其餘 5 個呼叫端零行為改動」**
//    (plan 驗收 7)。本元件被 orders / customers / customer-detail / supplier-table /
//    admin-data-table / products 六處使用,而只有 products 給了新的 `jump` / `truncation`。
//    ⇒ **不給那兩個 props 時,畫面上不得多出任何東西。**
//    ⚠️ 「看起來一樣」不算 —— 所以下面是**兩個世界各驗一次**:
//       不給 ⇒ 新東西必須**全部不在**;給了 ⇒ 必須**全部在**。
//       少了第二半,第一半可能只是因為那些東西**根本沒做出來**而恆綠。

afterEach(cleanup);

const BASE = {
  page: 3,
  total: 20341,
  pageSize: 200,
  shownCount: 200,
  buildHref: (p: number) => `/x?page=${p}`,
};

describe('🔴 不給 jump / truncation ⇒ 與改造前逐字相同(其餘 5 個呼叫端)', () => {
  it('只有「上一頁 / 下一頁」,沒有頁碼、沒有表單、沒有選單', () => {
    const { container } = render(<ListPagination {...BASE} />);

    expect(screen.getByText('上一頁')).toBeTruthy();
    expect(screen.getByText('下一頁')).toBeTruthy();

    // 🔴 新東西一個都不許出現
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('select')).toBeNull();
    expect(container.querySelector('input')).toBeNull();
    expect(screen.queryByText('«')).toBeNull();
    expect(screen.queryByText('»')).toBeNull();
    expect(screen.queryByText('每頁')).toBeNull();
    expect(screen.queryByRole('link', { name: '第 2 頁' })).toBeNull();
  });

  it('footer 字面不變', () => {
    render(<ListPagination {...BASE} unit='件' />);
    expect(screen.getByText('第 401–600 件 / 共 20341 件(第 3／102 頁)')).toBeTruthy();
  });

  it('沒有截斷警示帶', () => {
    render(<ListPagination {...BASE} />);
    expect(screen.queryByText(/這一頁的資料不完整/)).toBeNull();
  });
});

const JUMP = {
  action: '/products',
  filterFields: { set_by: 'staff', q: undefined },
  pageParam: 'page',
  sizeParam: 'size',
  sizeOptions: [20, 50, 100, 200, 500, 1000] as const,
  currentSize: 200,
  defaultSize: 200,
};

describe('✅ 正向對照:給了 jump ⇒ 那些東西必須真的在', () => {
  it('頁碼列 + 跳頁框 + 每頁筆數選單 + 首末頁', () => {
    const { container } = render(<ListPagination {...BASE} jump={JUMP} />);

    expect(screen.getByText('每頁')).toBeTruthy();
    expect(container.querySelector('select')).toBeTruthy();
    expect(screen.getByText('«')).toBeTruthy();
    expect(screen.getByText('»')).toBeTruthy();
    expect(screen.getByLabelText('跳到第幾頁,共 102 頁')).toBeTruthy();
    // 兩個表單:換筆數、跳頁
    expect(container.querySelectorAll('form')).toHaveLength(2);
  });

  it('🔴 頁碼窗是 10 個,而目前頁不是連結(它已經在這裡了)', () => {
    render(<ListPagination {...BASE} jump={JUMP} />);
    // 第 3 頁、共 102 頁 ⇒ 窗 = 1..10
    expect(screen.getByRole('link', { name: '第 1 頁' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '第 10 頁' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: '第 11 頁' })).toBeNull();
    // 目前頁:有 aria-current、不是連結
    expect(screen.queryByRole('link', { name: '第 3 頁' })).toBeNull();
    expect(screen.getByText('3').getAttribute('aria-current')).toBe('page');
  });

  it('🔴 換筆數的表單【不帶 page】⇒ 換筆數一律回第 1 頁', () => {
    const { container } = render(<ListPagination {...BASE} jump={JUMP} />);
    const sizeForm = container.querySelectorAll('form')[0]!;
    const names = [...sizeForm.querySelectorAll('input')].map((i) => i.getAttribute('name'));
    expect(names).not.toContain('page');
    expect(names).toContain('set_by');
  });

  it('🔴 跳頁的表單要帶著篩選 —— 否則跳頁把篩選洗掉', () => {
    const { container } = render(<ListPagination {...BASE} jump={JUMP} />);
    const jumpForm = container.querySelectorAll('form')[1]!;
    const hidden = [...jumpForm.querySelectorAll('input[type=hidden]')].map((i) =>
      i.getAttribute('name'),
    );
    expect(hidden).toContain('set_by');
    // size 是預設 ⇒ 不送(與網址省略規則對齊)
    expect(hidden).not.toContain('size');
  });

  it('size 非預設 ⇒ 跳頁表單要把它帶著', () => {
    const { container } = render(
      <ListPagination {...BASE} pageSize={500} jump={{ ...JUMP, currentSize: 500 }} />,
    );
    const jumpForm = container.querySelectorAll('form')[1]!;
    const sizeInput = jumpForm.querySelector('input[name=size]');
    expect(sizeInput?.getAttribute('value')).toBe('500');
  });

  it('undefined 的篩選軸不得產生 hidden 欄位(空值不進網址)', () => {
    const { container } = render(<ListPagination {...BASE} jump={JUMP} />);
    expect(container.querySelector('input[name=q]')).toBeNull();
  });
});

describe('🔴🔴 截斷警示帶 —— 這個病的本體就是【安靜】', () => {
  it('有截斷 ⇒ 印出四個數字,而不是一句「發生錯誤」', () => {
    render(
      <ListPagination
        {...BASE}
        page={1}
        pageSize={1000}
        shownCount={500}
        truncation={{
          kind: 'short',
          missing: 500,
          expected: 1000,
          shownCount: 500,
          offset: 0,
          total: 20341,
        }}
      />,
    );
    expect(screen.getByText(/少了 500 筆/)).toBeTruthy();
    expect(screen.getByText(/應該有 1000 筆,實際收到 500 筆/)).toBeTruthy();
  });

  // 🔴 **這一條原本斷言的是「多了 15 筆」,而 2026-08-19 的審查判那句是誤導。**
  //    這裡留著這段註解,是因為它是本片唯一一條「測試把錯的行為釘住了」的紀錄:
  //    那個 bug **有測試蓋到**,而測試**站在 bug 那一邊** ⇒ 覆蓋率沒有救到它。
  it('🔴 列比 total 允許的還多 ⇒ 這是【另一種病】,不得講成「這一頁少了東西」', () => {
    render(
      <ListPagination
        {...BASE}
        truncation={{
          kind: 'inconsistent',
          missing: -15,
          expected: 5,
          shownCount: 20,
          offset: 200,
          total: 205,
        }}
      />,
    );
    expect(screen.getByText(/對不上/)).toBeTruthy();
    // 🔴 而「調小每頁筆數」對這一種【沒有幫助】⇒ 不得給出那個建議
    expect(screen.getByText(/調小「每頁筆數」沒有幫助/)).toBeTruthy();
    expect(screen.queryByText(/少了/)).toBeNull();
  });

  it('short 那一種【才】給「調小每頁筆數」的建議', () => {
    render(
      <ListPagination
        {...BASE}
        truncation={{
          kind: 'short',
          missing: 500,
          expected: 1000,
          shownCount: 500,
          offset: 0,
          total: 20341,
        }}
      />,
    );
    expect(screen.getByText(/調小再看一次/)).toBeTruthy();
  });

  it('truncation = null ⇒ 完全不渲染那一帶', () => {
    render(<ListPagination {...BASE} truncation={null} />);
    expect(screen.queryByText(/這一頁的資料不完整/)).toBeNull();
  });
});


// ─────────────── 2026-08-19 審查(R1)折入的四條

describe('🔴 超界頁(?page=999,總共 102 頁)—— 審查 nit-2 / nit-3', () => {
  const OVER = { ...BASE, page: 999, shownCount: 0 };

  it('nit-2:「上一頁」要落在最後一個【真實】的頁,不是另一個空頁', () => {
    render(<ListPagination {...OVER} jump={JUMP} />);
    // 未修前:連到 998(仍是空的)⇒ 要按 897 次才回得去
    expect(screen.getByLabelText('上一頁').getAttribute('href')).toBe('/x?page=102');
  });

  it('nit-2:文字版的「上一頁」同樣要落在 102', () => {
    render(<ListPagination {...OVER} />);
    expect(screen.getByText('上一頁').getAttribute('href')).toBe('/x?page=102');
  });

  it('nit-3:超界時不得把第 102 頁高亮成「你在這裡」', () => {
    render(<ListPagination {...OVER} jump={JUMP} />);
    // footer 沒謊報(rangeEnd=0 ⇒ 只寫「共 N 件」)⇒ 按鈕也要跟它同一個標準
    // JSX 內插會把這行拆成多個 text node ⇒ 用 textContent 比對,不用 getByText 的完全比對
    expect(document.body.textContent).toContain('共 20341 筆');
    expect(document.body.textContent).not.toContain('第 401–600');
    expect(screen.queryByRole('link', { name: '第 102 頁' })).toBeTruthy();
    expect(document.querySelector('[aria-current="page"]')).toBeNull();
  });

  it('✅ 正向對照:在真實頁上,current 仍然要高亮(否則上一條可能只是把功能拿掉)', () => {
    render(<ListPagination {...BASE} jump={JUMP} />);
    expect(document.querySelector('[aria-current="page"]')?.textContent).toBe('3');
  });
});
