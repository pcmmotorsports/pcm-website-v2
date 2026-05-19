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
      />,
    );
    expect(screen.getByText('0-0')).toBeDefined();
    expect(screen.queryByText('1-0')).toBeNull();
  });
});
