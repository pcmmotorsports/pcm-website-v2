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

describe('#328 讀取失敗 ≠ 尚無備註', () => {
  const ID = '3f2f2c1e-0000-4000-8000-000000000001';

  it('🔴 整段沒讀到:說「讀取失敗」、不說「尚無備註」、不顯示「0 筆」', () => {
    // 這就是投影退版後 mapper 給出來的形狀(notes 空、customerNotified null、未截斷)。
    const { container } = render(
      <NotesTimeline
        orderId={ID}
        detail={{ notes: [], notesTruncated: false, customerNotified: null }}
      />,
    );
    expect(container.textContent).toContain('讀取失敗');
    // 🔴 這三條是這條 bug 的實際傷害面:員工看到的每一句話都在說「這單沒事」。
    expect(container.textContent).not.toContain('尚無備註');
    expect(container.textContent).not.toContain('尚未告知客人');
    expect(container.textContent).not.toContain('0 筆');
  });

  it('🔴 正向對照:真的沒備註仍然說「尚無備註」,不准被讀取失敗那格吃掉', () => {
    // 沒有這格,「一律顯示讀取失敗」的突變會讓上面全綠 —— 而那會讓每一張正常單都在喊壞掉。
    const { container } = render(
      <NotesTimeline
        orderId={ID}
        detail={{ notes: [], notesTruncated: false, customerNotified: false }}
      />,
    );
    expect(container.textContent).toContain('尚無備註');
    expect(container.textContent).not.toContain('讀取失敗');
  });

  it('🔴 截斷不得被誤報成讀取失敗(同樣是 customerNotified=null)', () => {
    const { container } = render(
      <NotesTimeline
        orderId={ID}
        detail={{ notes: [], notesTruncated: true, customerNotified: null }}
      />,
    );
    expect(container.textContent).toContain('載入上限');
    expect(container.textContent).not.toContain('讀取失敗');
  });
});

// OD 詳情頁片 1(2026-08-13,主視窗 MAIN-902-A 裁 Q3=C):收合 + note_type 三類分色。
describe('OD 片 1 — note_type 分色', () => {
  const ID = '3f2f2c1e-0000-4000-8000-000000000001';
  const badgeOf = (container: HTMLElement, label: string): string =>
    [...container.querySelectorAll('span')].find((el) => el.textContent === label)?.className ?? '';

  it('🔴 三類各自不同色:同一份灰底 = 這片沒做到「一眼分得出」', () => {
    const { container } = render(
      <NotesTimeline
        orderId={ID}
        detail={{
          notes: [
            note({ id: 'a', noteType: 'internal' }),
            note({ id: 'b', noteType: 'contact_log', channel: 'line', occurredAt: '2026-08-01T00:00:00+00:00' }),
            note({ id: 'c', noteType: 'customer_notified', channel: 'phone', occurredAt: '2026-08-01T00:00:00+00:00' }),
          ],
          notesTruncated: false,
          customerNotified: true,
        }}
      />,
    );
    const internal = badgeOf(container, '內部備註');
    const contact = badgeOf(container, '聯絡紀錄');
    const notified = badgeOf(container, '已告知客人');
    expect(new Set([internal, contact, notified]).size).toBe(3);
    // customer_notified = 告知義務稽核證據 ⇒ OD 逐字要求「最強的視覺份量」,不得是灰的。
    expect(notified).toContain('emerald');
    expect(internal).toContain('muted');
  });

  it('🔴 上色吃 noteType enum 而非中文字面:換掉 label 文字顏色不得跟著消失', () => {
    // 這格擋的是「用 typeLabel 中文字串比對上色」那種寫法 —— lib 檔頭明寫文案是暫定稿、Sean 會改。
    // 做法:兩筆同型別但 body 不同,兩者 badge class 必須一致(顏色由 enum 決定、與內容無關)。
    const { container } = render(
      <NotesTimeline
        orderId={ID}
        detail={{
          notes: [
            note({ id: 'a', noteType: 'customer_notified', body: '缺貨通知', channel: 'line', occurredAt: '2026-08-01T00:00:00+00:00' }),
            note({ id: 'b', noteType: 'customer_notified', body: '到貨通知', channel: 'phone', occurredAt: '2026-08-02T00:00:00+00:00' }),
          ],
          notesTruncated: false,
          customerNotified: true,
        }}
      />,
    );
    const badges = [...container.querySelectorAll('span')].filter(
      (el) => el.textContent === '已告知客人' && el.className.includes('rounded-full'),
    );
    // 兩筆的類型膠囊 + 整單彙總徽章都叫「已告知客人」⇒ 至少 2 顆類型膠囊
    expect(badges.length).toBeGreaterThanOrEqual(2);
    expect(new Set(badges.map((el) => el.className)).size).toBeLessThanOrEqual(2);
  });
});

describe('OD 片 1 — 收合(Q3=C)', () => {
  const ID = '3f2f2c1e-0000-4000-8000-000000000001';
  const details = (container: HTMLElement): HTMLDetailsElement =>
    container.querySelector('details') as HTMLDetailsElement;

  it('有未更正的「已告知客人」⇒ 預設展開(稽核證據不預設藏起來)', () => {
    const { container } = render(
      <NotesTimeline
        orderId={ID}
        detail={{
          notes: [note({ id: 'a', noteType: 'customer_notified', channel: 'line', occurredAt: '2026-08-01T00:00:00+00:00' })],
          notesTruncated: false,
          customerNotified: true,
        }}
      />,
    );
    expect(details(container).open).toBe(true);
    expect(container.textContent).toContain('已告知客人 1 筆');
  });

  it('🔴 正向對照:沒有告知紀錄時**要收起來**(否則 Q3=C 退化成「永遠展開」、精簡的目的沒達成)', () => {
    const { container } = render(
      <NotesTimeline
        orderId={ID}
        detail={{
          notes: [note({ id: 'a', noteType: 'internal' })],
          notesTruncated: false,
          customerNotified: false,
        }}
      />,
    );
    expect(details(container).open).toBe(false);
    expect(container.textContent).toContain('1 筆 · 已告知客人 0 筆');
  });

  it('🔴 被更正掉的「已告知客人」不算數:誤選更正後不得再撐開、也不得計入筆數', () => {
    // types.ts:899-900 逐字:「不得寫成『有 customer_notified』—— 被更正掉的誤選要排除」。
    // 少了這格,`filter(noteType === 'customer_notified')` 漏掉 `!corrected` 會全綠。
    const { container } = render(
      <NotesTimeline
        orderId={ID}
        detail={{
          notes: [
            note({ id: 'a', noteType: 'customer_notified', channel: 'line', occurredAt: '2026-08-01T00:00:00+00:00', corrected: true }),
            note({ id: 'b', noteType: 'internal', body: '更正:上一筆選錯類型', correctsNoteId: 'a', createdAt: '2026-08-02T00:00:00+00:00' }),
          ],
          notesTruncated: false,
          customerNotified: false,
        }}
      />,
    );
    expect(details(container).open).toBe(false);
    expect(container.textContent).toContain('已告知客人 0 筆');
  });

  it('🔴 讀取失敗:必須展開(收起來 = 把「讀取失敗」紅字藏起來,等於換位置重犯 #328)+ 不顯示 0 筆', () => {
    const { container } = render(
      <NotesTimeline
        orderId={ID}
        detail={{ notes: [], notesTruncated: false, customerNotified: null }}
      />,
    );
    expect(details(container).open).toBe(true);
    expect(container.textContent).toContain('筆數未知');
    expect(container.textContent).not.toContain('0 筆');
  });

  // 🔴 這兩格刻意拆開,是突變測試逼出來的:原本合成一格時資料裡有一筆未更正的 customer_notified,
  //    於是 `open` 是被「有告知筆數」那個理由滿足的 —— 把 `|| view.truncated` 整段拿掉,那格照樣綠。
  //    斷言量到的不是它宣稱在量的東西。拆開後「撐開」那格的資料裡零告知紀錄,truncated 是唯一可能的原因。
  it('🔴 截斷:必須展開(唯一撐開原因 = truncated,資料裡零告知紀錄)', () => {
    const { container } = render(
      <NotesTimeline
        orderId={ID}
        detail={{
          notes: [note({ id: 'a', noteType: 'internal' })],
          notesTruncated: true,
          customerNotified: null,
        }}
      />,
    );
    expect(details(container).open).toBe(true);
    expect(container.textContent).toContain('僅最新 1 筆');
  });

  it('🔴 截斷:不得報「已告知客人 M 筆」(告知列可能被擠出載入窗 ⇒ 那個數字會少報證據)', () => {
    const { container } = render(
      <NotesTimeline
        orderId={ID}
        detail={{
          notes: [note({ id: 'a', noteType: 'customer_notified', channel: 'line', occurredAt: '2026-08-01T00:00:00+00:00' })],
          notesTruncated: true,
          customerNotified: null,
        }}
      />,
    );
    expect(container.textContent).toContain('僅最新 1 筆');
    expect(container.textContent).not.toContain('已告知客人 1 筆');
  });
});
