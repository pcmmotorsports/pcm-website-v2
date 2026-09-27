// @vitest-environment jsdom
// 快速編輯側邊欄:按 Esc 關閉(Sean 2026-09-28 快速編輯第 2 片)。
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
import { QuickEditEscape } from './product-quick-edit-escape';

afterEach(() => {
  cleanup();
  push.mockReset();
});

describe('QuickEditEscape', () => {
  it('🔴 按 Esc ⇒ 回到關閉的網址(只拿掉 ?edit), 不捲動', () => {
    render(<QuickEditEscape closeHref='/products?attn=out_of_stock' />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(push).toHaveBeenCalledWith('/products?attn=out_of_stock', { scroll: false });
  });

  it('🔴 在輸入框裡按 Esc 不關(員工可能正在打字, 關掉會丟掉沒存的字)', () => {
    const { container } = render(
      <>
        <input data-testid='t' />
        <QuickEditEscape closeHref='/products' />
      </>,
    );
    fireEvent.keyDown(container.querySelector('input')!, { key: 'Escape' });
    expect(push).not.toHaveBeenCalled();
  });

  it('其他鍵不關', () => {
    render(<QuickEditEscape closeHref='/products' />);
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(push).not.toHaveBeenCalled();
  });
});
