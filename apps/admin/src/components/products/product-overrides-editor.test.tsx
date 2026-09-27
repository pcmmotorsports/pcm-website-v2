// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('server-only', () => ({}));
const save = vi.hoisted(() => vi.fn());
vi.mock('../../lib/products/product-overrides-actions', () => ({ saveProductTextAction: save }));

const { ProductOverridesEditor } = await import('./product-overrides-editor');
const { readProductOverrides } = await import('../../lib/products/product-overrides-view');

const PID = '11111111-2222-3333-4444-555555555555';
const SUPPLIER = { title: 'Brake Lever', subtitle: '6-position adjustable', highlights: ['CNC machined', 'Folding tip'] };

afterEach(() => {
  cleanup();
  save.mockReset();
});

function card(field: string) {
  const el = document.querySelector(`[data-override-field="${field}"]`);
  expect(el, `找不到 ${field} 那張卡`).not.toBeNull();
  return el as HTMLElement;
}

describe('readProductOverrides', () => {
  it('合法形狀照讀;非預期形狀一律當沒填(頁面不壞)', () => {
    expect(readProductOverrides({ title: '我們的', highlights: ['a'] })).toEqual({ title: '我們的', subtitle: null, highlights: ['a'] });
    for (const bad of [null, undefined, '字串', [], { title: 1, subtitle: '', highlights: [1] }, { highlights: [] }]) {
      expect(readProductOverrides(bad)).toEqual({ title: null, subtitle: null, highlights: null });
    }
  });
});

describe('ProductOverridesEditor(商品頁改版乙 B3:三欄一次儲存)', () => {
  it('沒填任何我們的版本 ⇒ 三欄都標「網站顯示：供應商的」,沒有還原鈕;供應商的內容照顯示', () => {
    render(<ProductOverridesEditor productId={PID} supplier={SUPPLIER} overrides={readProductOverrides({})} />);
    for (const f of ['title', 'subtitle', 'highlights']) {
      const c = card(f);
      expect(c.textContent).toContain('網站顯示：供應商的');
      expect(within(c).queryByRole('button', { name: '還原成供應商的' })).toBeNull();
    }
    expect(card('title').textContent).toContain('Brake Lever');
    expect(card('highlights').textContent).toContain('CNC machined');
    for (const f of ['title', 'subtitle']) {
      expect(card(f).textContent).toContain('客人用新標題搜尋，要等之後搜尋功能更新才找得到');
    }
  });

  it('🔴 三欄同一個表單、只有一顆儲存鈕;表單帶 product_id 與三欄的值', () => {
    render(<ProductOverridesEditor productId={PID} supplier={SUPPLIER} overrides={readProductOverrides({ title: '煞車拉桿組', highlights: ['一'] })} />);
    const forms = document.querySelectorAll('form');
    expect(forms).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^儲存/ }).map((b) => b.textContent)).toEqual(['儲存標題、副標、賣點']);
    const fd = new FormData(forms[0]!);
    expect(fd.get('product_id')).toBe(PID);
    expect(fd.get('title')).toBe('煞車拉桿組');
    expect(fd.get('subtitle')).toBe('');
    expect(fd.getAll('highlight')).toEqual(['一', '', '']);
  });

  it('標題有我們的版本 ⇒ 標「網站顯示：我們的版本」;按「還原成供應商的」只清空那一欄, 不送出', () => {
    render(<ProductOverridesEditor productId={PID} supplier={SUPPLIER} overrides={readProductOverrides({ title: '煞車拉桿組', subtitle: '副' })} />);
    const c = card('title');
    expect(c.textContent).toContain('網站顯示：我們的版本');
    fireEvent.click(within(c).getByRole('button', { name: '還原成供應商的' }));
    expect((within(c).getByRole('textbox') as HTMLInputElement).value).toBe('');
    expect((within(card('subtitle')).getByRole('textbox') as HTMLInputElement).value).toBe('副');
    expect(save).not.toHaveBeenCalled();
  });

  it('賣點:我們的每一點各一格,另外多兩格空白可以新增;已經 12 點就不再多給', () => {
    render(<ProductOverridesEditor productId={PID} supplier={SUPPLIER} overrides={readProductOverrides({ highlights: ['一', '二'] })} />);
    expect([...card('highlights').querySelectorAll('input[name="highlight"]')].map((i) => (i as HTMLInputElement).value)).toEqual([
      '一',
      '二',
      '',
      '',
    ]);
    cleanup();
    const twelve = Array.from({ length: 12 }, (_, i) => `點${i}`);
    render(<ProductOverridesEditor productId={PID} supplier={SUPPLIER} overrides={readProductOverrides({ highlights: twelve })} />);
    expect(card('highlights').querySelectorAll('input[name="highlight"]')).toHaveLength(12);
  });

  it('🔴 儲存中欄位鎖住, 不能繼續打字(回應回來重掛時補打的字會不見;Fable R2 建議)', async () => {
    let finish: (v: unknown) => void = () => {};
    save.mockReturnValue(new Promise((res) => (finish = res)));
    render(<ProductOverridesEditor productId={PID} supplier={SUPPLIER} overrides={readProductOverrides({})} />);
    fireEvent.change(within(card('title')).getByRole('textbox'), { target: { value: '新' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存標題、副標、賣點' }));
    // 鎖在外層 fieldset ⇒ 要看 :disabled(input.disabled 只看輸入框自己的屬性)
    await waitFor(() => expect(within(card('title')).getByRole('textbox').matches(':disabled')).toBe(true));
    finish({ kind: 'done', results: [] });
    await waitFor(() => expect(within(card('title')).getByRole('textbox').matches(':disabled')).toBe(false));
  });

  it('🔴 按儲存 ⇒ 送出一次, 顯示逐欄結果;沒存成功時輸入框保留剛打的字(不被清掉)', async () => {
    save.mockResolvedValue({
      kind: 'done',
      results: [
        { field: 'title', outcome: 'saved' },
        { field: 'subtitle', outcome: 'error' },
        { field: 'highlights', outcome: 'noop' },
      ],
    });
    render(<ProductOverridesEditor productId={PID} supplier={SUPPLIER} overrides={readProductOverrides({})} />);
    const subtitle = within(card('subtitle')).getByRole('textbox') as HTMLInputElement;
    fireEvent.change(subtitle, { target: { value: '新的副標' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存標題、副標、賣點' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    // 只改了副標 ⇒ 標題與賣點標成沒動過(伺服器不會送那兩欄)
    expect((save.mock.calls[0]![1] as FormData).getAll('unchanged')).toEqual(['title', 'highlights']);
    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('已儲存：標題。');
    expect(status.textContent).toContain('副標：無法確認是否已儲存');
    expect(subtitle.value).toBe('新的副標');
  });

  // Codex R1 必修 1、2:存完之後, 每一欄要跟伺服器的新值同步;沒存成功的欄位保留剛打的字。
  it('🔴 伺服器的值變了(存成功、或同事剛改)⇒ 那一欄換成新值, 並算「沒動過」;伺服器沒變的欄位保留草稿', () => {
    const { rerender } = render(
      <ProductOverridesEditor productId={PID} supplier={SUPPLIER} overrides={readProductOverrides({ title: '舊標題', subtitle: '舊副標' })} />,
    );
    const titleBox = () => within(card('title')).getByRole('textbox') as HTMLInputElement;
    const subBox = () => within(card('subtitle')).getByRole('textbox') as HTMLInputElement;
    fireEvent.change(titleBox(), { target: { value: '草稿標題' } });
    // 同事把副標改成「新副標」(畫面重新取得資料), 我的標題還沒存
    rerender(<ProductOverridesEditor productId={PID} supplier={SUPPLIER} overrides={readProductOverrides({ title: '舊標題', subtitle: '新副標' })} />);
    expect(subBox().value).toBe('新副標');
    expect(subBox().value).toBe(subBox().defaultValue);
    expect(titleBox().value).toBe('草稿標題');
  });

  it('🔴 賣點存完變少 ⇒ 格子照伺服器的新值重排, 不會留下空白格把已存的賣點蓋掉', () => {
    const { rerender } = render(
      <ProductOverridesEditor productId={PID} supplier={SUPPLIER} overrides={readProductOverrides({ highlights: ['一', '二', '三', '四'] })} />,
    );
    rerender(<ProductOverridesEditor productId={PID} supplier={SUPPLIER} overrides={readProductOverrides({ highlights: ['四'] })} />);
    const inputs = [...card('highlights').querySelectorAll('input[name="highlight"]')] as HTMLInputElement[];
    expect(inputs.map((i) => i.value)).toEqual(['四', '', '']);
    expect(inputs.every((i) => i.value === i.defaultValue)).toBe(true);
  });
});

