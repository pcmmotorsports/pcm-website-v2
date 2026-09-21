// @vitest-environment jsdom
//
// Pagination smoke test — M-1-12 Codex finding 2 regression:0 筆結果起始筆數
// 顯示 0(不再顯示「1-0」)。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Pagination } from './Pagination';

afterEach(cleanup);

describe('Pagination', () => {
  it('should render the per-page select and item range', () => {
    render(
      <Pagination
        page={1}
        totalPages={3}
        perPage={25}
        total={60}
        onChangePage={vi.fn()}
        onChangePerPage={vi.fn()}
        getPageHref={(nextPage) => `/products?page=${nextPage}`}
      />,
    );
    expect(screen.getByLabelText('每頁')).toBeDefined();
    expect(screen.getByText('1-25')).toBeDefined();
  });

  it('should show 0 (not 1) as the start when there are no results', () => {
    render(
      <Pagination
        page={1}
        totalPages={1}
        perPage={25}
        total={0}
        onChangePage={vi.fn()}
        onChangePerPage={vi.fn()}
        getPageHref={(nextPage) => `/products?page=${nextPage}`}
      />,
    );
    expect(screen.getByText('0-0')).toBeDefined();
    expect(screen.queryByText('1-0')).toBeNull();
  });

  it('renders crawlable hrefs for page numbers and enabled arrows', () => {
    render(
      <Pagination
        page={2}
        totalPages={4}
        perPage={100}
        total={350}
        onChangePage={vi.fn()}
        onChangePerPage={vi.fn()}
        getPageHref={(nextPage) => `/products?category=排氣系統&page=${nextPage}`}
      />,
    );

    expect(screen.getByRole('link', { name: '上一頁' }).getAttribute('href')).toBe(
      '/products?category=排氣系統&page=1',
    );
    expect(screen.getByRole('link', { name: '1' }).getAttribute('href')).toBe(
      '/products?category=排氣系統&page=1',
    );
    expect(screen.getByRole('link', { name: '2' }).getAttribute('href')).toBe(
      '/products?category=排氣系統&page=2',
    );
    expect(screen.getByRole('link', { name: '下一頁' }).getAttribute('href')).toBe(
      '/products?category=排氣系統&page=3',
    );
  });

  it('keeps unavailable arrows disabled instead of linking outside the valid range', () => {
    render(
      <Pagination
        page={1}
        totalPages={1}
        perPage={100}
        total={20}
        onChangePage={vi.fn()}
        onChangePerPage={vi.fn()}
        getPageHref={(nextPage) => `/products?page=${nextPage}`}
      />,
    );

    expect(screen.queryByRole('link', { name: '上一頁' })).toBeNull();
    expect(screen.queryByRole('link', { name: '下一頁' })).toBeNull();
    expect(screen.getByRole('button', { name: '上一頁' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: '下一頁' }).hasAttribute('disabled')).toBe(true);
  });

  it('uses only the existing page-change path for a normal click', () => {
    const onChangePage = vi.fn();
    render(
      <Pagination
        page={2}
        totalPages={4}
        perPage={100}
        total={350}
        onChangePage={onChangePage}
        onChangePerPage={vi.fn()}
        getPageHref={(nextPage) => `/products?page=${nextPage}`}
      />,
    );

    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    const allowedDefaultNavigation = screen.getByRole('link', { name: '3' }).dispatchEvent(event);

    expect(allowedDefaultNavigation).toBe(false);
    expect(onChangePage).toHaveBeenCalledTimes(1);
    expect(onChangePage).toHaveBeenCalledWith(3);
  });

  it.each([
    ['Command', { metaKey: true }],
    ['Ctrl', { ctrlKey: true }],
    ['Shift', { shiftKey: true }],
    ['Alt', { altKey: true }],
    ['middle button', { button: 1 }],
    ['right button', { button: 2 }],
  ])('leaves %s clicks to the browser without changing the current page', (_name, init) => {
    const onChangePage = vi.fn();
    render(
      <Pagination
        page={2}
        totalPages={4}
        perPage={100}
        total={350}
        onChangePage={onChangePage}
        onChangePerPage={vi.fn()}
        getPageHref={(nextPage) => `/products?page=${nextPage}`}
      />,
    );

    const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...init });
    let componentPreventedDefault: boolean | undefined;
    document.addEventListener('click', (nativeEvent) => {
      componentPreventedDefault = nativeEvent.defaultPrevented;
      // jsdom 不會真的開新分頁；在 React handler 之後才攔住，避免它嘗試同頁導覽並噴警告。
      nativeEvent.preventDefault();
    }, { once: true });
    screen.getByRole('link', { name: '3' }).dispatchEvent(event);

    expect(componentPreventedDefault).toBe(false);
    expect(onChangePage).not.toHaveBeenCalled();
  });
});
