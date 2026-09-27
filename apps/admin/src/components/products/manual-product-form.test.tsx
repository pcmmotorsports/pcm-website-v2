// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }));
vi.mock('../../lib/products/manual-product-actions', () => ({ createManualProductAction: (a: unknown) => create(a) }));
const { ManualProductForm } = await import('./manual-product-form');

beforeEach(() => {
  create.mockReset();
  create.mockResolvedValue({ ok: false, message: 'x' });
});
afterEach(cleanup);

async function submitWithGeneral(value: string) {
  const { container } = render(<ManualProductForm brands={[]} categories={[]} />);
  fireEvent.change(screen.getByLabelText('一般價'), { target: { value } });
  await act(async () => {
    fireEvent.submit(container.querySelector('form')!);
  });
}

describe('商品頁乙 P6:新增商品表單', () => {
  it('一般價只打空白 ⇒ 不送出,提示要填一般價(一般價空不能賣)', async () => {
    await submitWithGeneral('   ');
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByText('每個規格都要填一般價（0 以上的整數）。')).toBeTruthy();
  });

  it('一般價有填 ⇒ 送出,帶整數', async () => {
    await submitWithGeneral('1200');
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0].variants[0].priceGeneral).toBe(1200);
  });
});
