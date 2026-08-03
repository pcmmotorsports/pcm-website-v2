// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { AdminOrderNote } from '@pcm/domain';
import { NotesTimeline } from './notes-timeline';

// M-4b E10 A10a-2 smoke test:唯讀時間軸的四條可見行為(語意層在 note-timeline.test.ts 21 格,不重測)。

afterEach(cleanup);

const note = (over: Partial<AdminOrderNote> & Pick<AdminOrderNote, 'id'>): AdminOrderNote => ({
  noteType: 'internal',
  body: '內容',
  channel: null,
  occurredAt: null,
  author: 'sean',
  correctsNoteId: null,
  createdAt: '2026-08-01T00:00:00+00:00',
  corrected: false,
  ...over,
});

describe('NotesTimeline — A10a-2', () => {
  it('空清單:顯示尚無備註 + 尚未告知客人', () => {
    const { container } = render(
      <NotesTimeline orderId='3f2f2c1e-0000-4000-8000-000000000001' detail={{ notes: [], notesTruncated: false, customerNotified: false }} />,
    );
    expect(container.textContent).toContain('尚無備註');
    expect(container.textContent).toContain('尚未告知客人');
  });

  it('新在上:輸入 ASC(#1 舊、#2 新),渲染順序 #2 在前;seq 不隨顯示方向變', () => {
    const { container } = render(
      <NotesTimeline orderId='3f2f2c1e-0000-4000-8000-000000000001'
        detail={{
          notes: [
            note({ id: 'old', body: '舊備註', createdAt: '2026-08-01T00:00:00+00:00' }),
            note({ id: 'new', body: '新備註', createdAt: '2026-08-02T00:00:00+00:00' }),
          ],
          notesTruncated: false,
          customerNotified: false,
        }}
      />,
    );
    const text = container.textContent ?? '';
    expect(text.indexOf('新備註')).toBeLessThan(text.indexOf('舊備註'));
    // #2 = 新備註(seq 依時間軸編號、不是依顯示順序)
    expect(text.indexOf('#2')).toBeLessThan(text.indexOf('#1'));
  });

  it('更正雙向標記 + 已告知客人 badge:被更正列標「已更正(由 #2)」、更正列標「更正 → #1」', () => {
    const { container } = render(
      <NotesTimeline orderId='3f2f2c1e-0000-4000-8000-000000000001'
        detail={{
          notes: [
            note({ id: 'a', noteType: 'customer_notified', channel: 'phone', occurredAt: '2026-08-01T02:00:00+00:00', corrected: true }),
            note({ id: 'b', correctsNoteId: 'a' }),
          ],
          notesTruncated: false,
          customerNotified: false,
        }}
      />,
    );
    expect(container.textContent).toContain('已更正(由 #2)');
    expect(container.textContent).toContain('更正 → #1');
    expect(container.textContent).toContain('已告知客人');
    expect(container.textContent).toContain('電話');
  });

  it('截斷:customerNotified=null 顯示無法判定 + 載入上限警示(不得顯示成尚未告知)', () => {
    const { container } = render(
      <NotesTimeline orderId='3f2f2c1e-0000-4000-8000-000000000001'
        detail={{
          notes: [note({ id: 'n1' })],
          notesTruncated: true,
          customerNotified: null,
        }}
      />,
    );
    expect(container.textContent).toContain('無法判定');
    expect(container.textContent).toContain('超過載入上限');
    expect(container.textContent).not.toContain('尚未告知客人');
  });

  it('[A10a-3] 更正入口:canCorrect 列 = Link 帶 ?correct=<id>;corrected 列 = disabled 非連結', () => {
    const { container } = render(
      <NotesTimeline
        orderId='3f2f2c1e-0000-4000-8000-000000000001'
        detail={{
          notes: [note({ id: 'was-fixed', corrected: true }), note({ id: 'fixable' })],
          notesTruncated: false,
          customerNotified: false,
        }}
      />,
    );
    const links = [...container.querySelectorAll('a')].filter((a) => a.textContent === '更正');
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute('href')).toBe(
      '/orders/3f2f2c1e-0000-4000-8000-000000000001?correct=fixable#note-compose',
    );
    const disabled = [...container.querySelectorAll('button[disabled]')].filter(
      (b) => b.textContent === '更正',
    );
    expect(disabled).toHaveLength(1);
  });

  it('更正目標不在已載入範圍:顯示誠實字面而非 #undefined', () => {
    const { container } = render(
      <NotesTimeline orderId='3f2f2c1e-0000-4000-8000-000000000001'
        detail={{
          notes: [note({ id: 'c', correctsNoteId: 'ghost' })],
          notesTruncated: true,
          customerNotified: null,
        }}
      />,
    );
    expect(container.textContent).toContain('不在已載入範圍');
    expect(container.textContent).not.toContain('undefined');
  });
});
