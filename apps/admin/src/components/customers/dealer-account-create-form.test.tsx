// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

vi.mock('../../lib/customers/dealer-account-actions', () => ({ createDealerAccountAction: vi.fn() }));
import { DealerAccountCreateForm } from './dealer-account-create-form';

afterEach(cleanup);

describe('新增經銷帳號表單(片 D4a)', () => {
  it('🔴 表單沒有任何密碼欄(有人加回來這格會紅)', () => {
    const { container } = render(<DealerAccountCreateForm />);
    expect(container.querySelector("input[type='password']")).toBeNull();
    const names = [...container.querySelectorAll('input, select, textarea')].map((el) => el.getAttribute('name') ?? '');
    expect(names.filter((n) => /pass/i.test(n))).toEqual([]);
    expect(names).toEqual(
      expect.arrayContaining(['email', 'companyName', 'taxId', 'storeName', 'region', 'contactName', 'contactPhone', 'contactEmail', 'note']),
    );
  });
});
