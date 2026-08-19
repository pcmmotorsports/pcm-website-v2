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
        truncation={{ missing: 500, expected: 1000, shownCount: 500, offset: 0, total: 20341 }}
      />,
    );
    expect(screen.getByText(/少了 500 筆/)).toBeTruthy();
    expect(screen.getByText(/應該有 1000 筆,實際收到 500 筆/)).toBeTruthy();
  });

  it('列比 total 允許的還多 ⇒ 換一句話,不是硬講成「少了 -15 筆」', () => {
    render(
      <ListPagination
        {...BASE}
        truncation={{ missing: -15, expected: 5, shownCount: 20, offset: 200, total: 205 }}
      />,
    );
    expect(screen.getByText(/多了 15 筆/)).toBeTruthy();
  });

  it('truncation = null ⇒ 完全不渲染那一帶', () => {
    render(<ListPagination {...BASE} truncation={null} />);
    expect(screen.queryByText(/這一頁的資料不完整/)).toBeNull();
  });
});
