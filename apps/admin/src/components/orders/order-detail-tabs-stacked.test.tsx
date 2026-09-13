// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { expect, it } from 'vitest';
import { OrderDetailTabs } from './order-detail-tabs';
it('stacked ⇒ 沒有分頁列、四段全部展開、每段有小標', () => {
  const tabs = ['items','money','customer','notes'].map((k) => ({ key: k, label: '段'+k, content: <p>{'內容'+k}</p> }));
  const { container } = render(<OrderDetailTabs header={<div>抬頭</div>} tabs={tabs} stacked />);
  expect(container.querySelector('[role="tablist"]')).toBeNull();
  expect(container.textContent).not.toContain('全部展開');
  for (const k of ['items','money','customer','notes']) {
    const sec = container.querySelector(`[data-od-panel="${k}"]`) as HTMLElement;
    expect(sec.hidden, k + ' 不得被藏').toBe(false);
    expect(sec.querySelector('h2')?.textContent).toBe('段'+k);
  }
});
it('對照:stacked=false ⇒ 分頁列在、只有一頁看得到', () => {
  const tabs = ['items','money'].map((k) => ({ key: k, label: '段'+k, content: <p>{k}</p> }));
  const { container } = render(<OrderDetailTabs header={<div>抬頭</div>} tabs={tabs} />);
  expect(container.querySelector('[role="tablist"]')).not.toBeNull();
  expect((container.querySelector('[data-od-panel="money"]') as HTMLElement).hidden).toBe(true);
});
