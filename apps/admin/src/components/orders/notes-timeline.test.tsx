// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { AdminOrderNote } from '@pcm/domain';

// 🔴 貼板 138:本檔現在會經 `note-delete-form.tsx` 拉到 server action,而那條鏈上
//    `note-repository.ts` 有 `import 'server-only'` ⇒ 在 vitest 裡會當場炸
//    (Next 建置時會把 server action 剝掉,vitest 不會)。
//    ⇒ 只換掉那一支 action,形狀逐字照 `note-compose-form.test.ts` 的既有做法。
//    🛑 **元件本身不 mock** —— 收起入口看不看得到是本檔要驗的東西,mock 掉就變成恆真。
vi.mock('../../lib/orders/note-actions', () => ({
  softDeleteOrderNoteAction: vi.fn(),
}));

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
  // 🔵 預設 = 沒被刪(貼板 138 軟刪除三欄)。要造已刪的就 over 這三個。
  deletedAt: null,
  deletedBy: null,
  deletedReason: null,
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
    expect(container.textContent).toContain('客人聯繫 · 已告知');
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
    const contact = badgeOf(container, '客人聯繫');
    const notified = badgeOf(container, '客人聯繫 · 已告知');
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
      (el) => el.textContent === '客人聯繫 · 已告知' && el.className.includes('rounded-full'),
    );
    // 🔴 2026-08-19 起,類型膠囊叫「客人聯繫 · 已告知」而**整單彙總徽章仍叫「已告知客人」**
    //    (兩者答的是不同的問題:單筆型別 vs 整張單的狀態,見 note-timeline.ts 的註解)
    //    ⇒ 這裡撈到的**恰好就是兩顆類型膠囊**,彙總徽章不再混進來 ⇒ 判準可以收緊成等於 2。
    expect(badges.length).toBe(2);
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
    expect(container.textContent).toContain('已告知 1 筆');
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
    expect(container.textContent).toContain('1 筆 · 已告知 0 筆');
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
    expect(container.textContent).toContain('已告知 0 筆');
  });

  // ══ `?correct=` 那一格(Sean 2026-09-13 答甲)═══════════════════════════════
  //
  // 🔬 **不修會怎樣(真瀏覽器實測, 不是讀碼推的)**:更正表單自己**已經**照規矩展開了,
  //    **而它是本卡的子節點** ⇒ 本卡收著的時候, 員工看到的仍然是一片空白。
  //    ```
  //    details#note-compose  open=true   ← 內層照規矩打開了
  //    details(本卡)        open=false  ← 而外層把它整個收起來
  //    ```
  //    📌 **內層那條規矩被外層默默作廢, 而兩邊的碼各自都是對的。**
  // 🔵 正常從時間軸點「更正」踩不到(那時本卡已經開著);踩得到的是**書籤 / 重新整理 / 貼網址給同事**。

  it('🔴 `correcting` ⇒ 展開, 即使一般條件全部不成立(否則書籤進來看到一片空白)', () => {
    const { container } = render(
      <NotesTimeline
        orderId={ID}
        correcting
        detail={{
          notes: [note({ id: 'a', noteType: 'internal' })],
          notesTruncated: false,
          customerNotified: false,
        }}
      />,
    );
    expect(details(container).open, '外層收著 ⇒ 內層 open 也沒有用').toBe(true);
  });

  it('🔴 正向對照:同一份資料、`correcting` 為 false ⇒ **仍然收起來**', () => {
    // 🛑 少了這一格,「一律展開」那個懶修法會通過上面那格, 而它**推翻 Q3=C**
    //    (上面 `defaultOpen` 那段檔內註解警告過的正是這件事)。
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
    expect(container.textContent).not.toContain('已告知 1 筆');
  });

  // ── 貼板 138:軟刪除的四條可見行為 ───────────────────────────────────────
  const deleted = (over: Record<string, unknown> = {}) =>
    note({
      id: 'a',
      body: '這是被收起來的內容',
      deletedAt: '2026-09-13T02:00:00+00:00',
      deletedBy: 'sean',
      deletedReason: '打錯字',
      ...over,
    });

  it('🔴 已收起 ⇒ 印「已收起」badge, 而字面**不是**「已刪除」(Sean 2026-09-13 用語)', () => {
    const { container } = render(
      <NotesTimeline
        orderId={ID}
        detail={{ notes: [deleted()], notesTruncated: false, customerNotified: false }}
      />,
    );
    expect(container.textContent).toContain('已收起');
    expect(container.textContent).not.toContain('已刪除');
  });

  it('🔴 誰收的 / 何時 / 理由都印得出來(那三件正是軟刪除存在的理由)', () => {
    const { container } = render(
      <NotesTimeline
        orderId={ID}
        detail={{ notes: [deleted()], notesTruncated: false, customerNotified: false }}
      />,
    );
    expect(container.textContent).toContain('sean');
    expect(container.textContent).toContain('打錯字');
  });

  // 🛑🛑 **這一格是整片的重點**:軟刪除之所以不是 DELETE,就是為了讓內容還查得到。
  //    把 body 藏起來 = 在畫面上把那個理由抵銷掉,而 DB 那一端照樣綠。
  it('🛑 已收起的列,**內容照樣印出來**(藏起來的話對帳與客訴就查不到)', () => {
    const { container } = render(
      <NotesTimeline
        orderId={ID}
        detail={{ notes: [deleted()], notesTruncated: false, customerNotified: false }}
      />,
    );
    expect(container.textContent).toContain('這是被收起來的內容');
  });

  // 🔵 理由選填(Sean 答乙)⇒ 沒寫就整句不印,不得出現「(無)」那種看起來像壞掉的字。
  it('🔵 沒寫理由 ⇒ 不印冒號、不印「(無)」,但仍然印得出誰收的', () => {
    const { container } = render(
      <NotesTimeline
        orderId={ID}
        detail={{
          notes: [deleted({ deletedReason: null })],
          notesTruncated: false,
          customerNotified: false,
        }}
      />,
    );
    expect(container.textContent).toContain('已收起');
    expect(container.textContent).toContain('sean');
    expect(container.textContent).not.toContain('(無)');
    expect(container.textContent).not.toContain('收起:');
  });

  // 🔴 負對照:沒被刪的列**不得**出現那顆 badge(否則上面四格在兩個世界印同一個值)。
  it('🔴 負對照:沒被收起的列不印「已收起」', () => {
    const { container } = render(
      <NotesTimeline
        orderId={ID}
        detail={{ notes: [note({ id: 'a' })], notesTruncated: false, customerNotified: false }}
      />,
    );
    expect(container.textContent).not.toContain('已收起');
  });

  // ══ 貼板 138:收起入口的可見性 —— 🔴 **第三格驗法** ═══════════════════════
  //
  // 🛑🛑 **「看不到」與「擋得住」是兩件事,兩格都要有,不能互相取代**:
  //    · 本組驗的是**看不看得到**(UI)。
  //    · 另一格在 `lib/orders/note-actions.test.ts`:把 `authorizeManagerMutation` mock 成 null
  //      ⇒ 斷言 repository **沒被呼叫**。
  //    ⚠️ **射程要講準**(codex 2026-09-13 nit 2):那一格證的是「**閘拒絕之後**不會寫入」,
  //       **不是**「真實的非 manager 身分會被閘拒絕」,也沒有連 DB。後者要真登入才驗得到。
  //    少了那一格,本組全綠只證明了「畫面上沒有那顆鈕」—— 而那從來不是安全邊界。

  /**
   * 🔴🔴 **`textContent` 讀得到【收合區裡】的字** —— 而那正是 codex 2026-09-13 must-fix
   *    抓到的形狀:那句話進了 DOM、員工看不到,而測試全綠。
   * ⇒ 這一支往上走訪祖先,只要碰到一個 `<details>` 沒有 `open` 就回 true。
   */
  const hiddenInsideClosedDetails = (container: HTMLElement, text: string): boolean => {
    const hit = [...container.querySelectorAll('*')].find(
      (el) => el.children.length === 0 && el.textContent?.includes(text),
    );
    if (hit === undefined) return false; // 根本不在 DOM 裡 —— 由別的斷言負責說話
    // 🔴 `<summary>` **是 `<details>` 的子節點,而收合時它照樣看得見** ——
    //    少了這一格,這把尺會把「放在摘要列」也判成藏住 ⇒ 正確的修法反而紅。
    let skipNextDetails = false;
    for (let el: Element | null = hit; el !== null; el = el.parentElement) {
      if (el.tagName === 'SUMMARY') {
        skipNextDetails = true;
        continue;
      }
      if (el.tagName === 'DETAILS' && !(el as HTMLDetailsElement).open) {
        if (skipNextDetails) {
          skipNextDetails = false;
          continue;
        }
        return true;
      }
    }
    return false;
  };
  const TOKENS = { a: '12345678-1234-4234-8234-123456789abc' };

  const renderTimeline = (canDeleteNotes: 'yes' | 'no' | 'unknown') =>
    render(
      <NotesTimeline
        orderId={ID}
        returnTo={`/orders/${ID}`}
        canDeleteNotes={canDeleteNotes}
        noteDeleteTokens={TOKENS}
        detail={{ notes: [note({ id: 'a' })], notesTruncated: false, customerNotified: false }}
      />,
    );

  it('🔴 正對照:manager(yes)⇒ 看得到收起入口,而且那句小字在旁邊', () => {
    const { container } = renderTimeline('yes');
    expect(container.textContent).toContain('收起 #1');
    // Sean 2026-09-13 逐字定案的那一句(按之前那一格)
    expect(container.textContent).toContain('僅收起，不刪除。');
  });

  it('🔴 負對照:非 manager(no)⇒ **看不到**收起入口,而且不印任何權限說明', () => {
    const { container } = renderTimeline('no');
    expect(container.textContent).not.toContain('收起 #1');
    // 🔵 `no` 刻意不說話:一個非管理者在訂單明細頁本來就不預期看到收起入口,
    //    對他印「你沒有權限」是憑空製造一個他沒問過的問題。
    expect(container.textContent).not.toContain('沒有權限');
  });

  it('🔴 unknown(查不到權限)⇒ 看不到入口,**但要說「暫時無法確認」**', () => {
    const { container } = renderTimeline('unknown');
    expect(container.textContent).not.toContain('收起 #1');
    // 🛑 這一句是 `unknown` 與 `no` 的唯一差別 —— 少了它,一個真的是管理者的人
    //    會在 DB 打嗝時以為自己被降權,而畫面上沒有任何字告訴他這是查不到。
    expect(container.textContent).toContain('暫時無法確認');
  });

  // 🔴🔴 **codex 2026-09-13 must-fix 換來的那一格**:上面那格只比對 `textContent`,
  //    而它**讀得到收合區裡的字** ⇒ 第一版把這句話放在 `<ul>` 最上面(卡片預設收合)
  //    ⇒ **進了 DOM 而員工看不到,測試照樣綠**。
  //    📌 本檔自己早就記過同一條規矩(`defaultOpen` 那段,主視窗 2026-08-19 裁 Q1=甲):
  //       「這裡的資料可能不完整」的警語不得住在預設收合的容器裡 —— 而我沒回去讀那一段。
  //    ⇒ 這一格改量**它在不在關著的 `<details>` 裡面**。定向突變:把那句話搬回 `<ul>` ⇒ 本格紅。
  it('🔴 那句「暫時無法確認」**不得被預設收合的卡片藏住**(進 DOM ≠ 看得到)', () => {
    const { container } = renderTimeline('unknown');
    expect(
      hiddenInsideClosedDetails(container, '暫時無法確認'),
      '那句話在一個關著的 <details> 裡 ⇒ 員工要自己展開才知道權限查核失敗',
    ).toBe(false);
  });

  // 🔵 正對照:這把新尺讀得到「真的被藏住」那個世界,否則上面那格是恆綠的。
  it('🔵 正對照:收合區裡的字【確實】會被這把尺判成藏住(證明它不是恆綠)', () => {
    const { container } = renderTimeline('unknown');
    // 備註內容住在卡片的收合區裡,而這張卡在本情境預設是收合的。
    expect(hiddenInsideClosedDetails(container, '內容')).toBe(true);
  });

  it('🔴 已經收起的列,不再出現收起入口(按一顆什麼都不會發生的鈕是另一回事)', () => {
    const { container } = render(
      <NotesTimeline
        orderId={ID}
        returnTo={`/orders/${ID}`}
        canDeleteNotes='yes'
        noteDeleteTokens={TOKENS}
        detail={{
          notes: [
            note({ id: 'a', deletedAt: '2026-09-13T02:00:00+00:00', deletedBy: 'sean' }),
          ],
          notesTruncated: false,
          customerNotified: false,
        }}
      />,
    );
    expect(container.textContent).toContain('已收起');
    expect(container.textContent).not.toContain('收起 #1');
  });

  // 🔵 token 拿不到 ⇒ 不渲染入口(而不是送一張沒有 token 的表單 —— 那會回 `invalid`,
  //    而員工看到的是一句他無從處理的錯誤)。
  it('🔵 拿不到那一則的 token ⇒ 不渲染入口(fail-closed,不給一張送不出去的表單)', () => {
    const { container } = render(
      <NotesTimeline
        orderId={ID}
        returnTo={`/orders/${ID}`}
        canDeleteNotes='yes'
        noteDeleteTokens={{}}
        detail={{ notes: [note({ id: 'a' })], notesTruncated: false, customerNotified: false }}
      />,
    );
    expect(container.textContent).not.toContain('收起 #1');
  });

  // ══ 2026-09-13:已被更正那一列的【操作指引】 ═══════════════════════════
  //
  // 🔴 `docs/phase-1-backlog.md:22301` 逐字:「唯一不能變的是【**不能還是 title**】…
  //    最小可行:**停用控件旁邊印一行短字**」(主視窗 2026-08-18 對 `#639` 釘的約束)。
  //    理由:**鍵盤使用者對不到停用鈕的焦點、觸控裝置叫不出原生提示**
  //    ⇒ 唯一的操作指引若只放在 `title` 裡,對那些員工**等於沒寫**。
  const corrected = () =>
    render(
      <NotesTimeline
        orderId={ID}
        detail={{
          // 🔴 `corrected` 是 **domain 欄位、由 mapper 算**,`buildNoteTimeline` 直接用它、不重推導
          //    (`note-timeline.ts` docstring 逐字:「重推導 = 第二真相源」)
          //    ⇒ fixture 要**顯式**給 `corrected: true`,只掛 `correctsNoteId` 是不夠的。
          //    (我第一版就是只掛指標 ⇒ 三格全紅,而紅得對。)
          notes: [
            note({ id: 'a', corrected: true }),
            note({ id: 'b', correctsNoteId: 'a' }),
          ],
          notesTruncated: false,
          customerNotified: false,
        }}
      />,
    );

  it('🔴 已被更正那一列,指引是**一個文字節點**,不是只活在 title 屬性裡', () => {
    const { container } = corrected();
    // 🛑 量的是**文字節點**,不是 `title` 屬性 —— 拿掉那行 span、只留 title ⇒ 本格紅。
    // ⚠️ **射程要講準**(codex 2026-09-13 nit 2):`textContent` 只證明**那個節點存在**,
    //    **證不到它在畫面上真的看得見** —— 給它 `hidden` 本格照樣綠。
    //    ⇒ 「鍵盤走得到 / 螢幕閱讀器唸得出 / 眼睛看得到」**今天沒有人驗過**。
    //    🔵 而位置本身是合理的:它與那顆停用鈕**同一列** ⇒ 卡片收合時兩個一起藏,
    //       展開後才需要解釋那顆鈕。⛔ ~~我第一版把這一格寫成「看得見」~~ —— 說滿了。
    expect(container.textContent).toContain('要再改請按最新那版');
  });

  // 🔴🔴 **沿用上一片那把尺,而改成量【成對】**(主視窗 2026-09-13 問「能不能沿用」)。
  //    直接問「那句話有沒有被藏住」會**永遠回 true** —— 整張備註卡預設收合,
  //    連它要解釋的那顆鈕也一起在裡面 ⇒ 那樣問等於問「這張卡收合了嗎」。
  // 🎯 **真正的不變式是【成對】**:指引與它解釋的那顆鈕,要嘛一起看得到、要嘛一起藏起來。
  //    ⇒ 哪天有人把指引搬進另一個收合容器(而鈕留在外面),本格會紅 —— 那才是這把尺守得住的東西。
  //    ⚠️ 而它**仍然證不到**「眼睛看得到 / 鍵盤走得到 / 螢幕閱讀器唸得出」。那三件今天沒有人驗過。
  it('🔴 那句指引與它解釋的那顆鈕【同進同出】(不得只有指引被藏進另一層收合)', () => {
    const { container } = corrected();
    const guidanceHidden = hiddenInsideClosedDetails(container, '要再改請按最新那版');
    // 那顆停用鈕的字面是「更正」,而時間軸上別處也有「更正」⇒ 改用它獨有的 title 當錨點。
    const btn = container.querySelector('button[disabled]');
    let btnHidden = false;
    for (let el: Element | null = btn; el !== null; el = el.parentElement) {
      if (el.tagName === 'DETAILS' && !(el as HTMLDetailsElement).open) {
        btnHidden = true;
        break;
      }
    }
    expect(guidanceHidden, '指引與那顆鈕的可見性不一致 ⇒ 有一邊被多藏了一層').toBe(btnHidden);
  });

  it('🔵 而 title 留著當補充(不是唯一載體,所以它在也不算違規)', () => {
    const { container } = corrected();
    const btn = container.querySelector('button[disabled]');
    expect(btn?.getAttribute('title')).toContain('最新那一版');
  });

  it('🔴 舊那句「一筆只能更正一次」不得再出現 —— 它讓人以為這則不能再改了', () => {
    const { container } = corrected();
    expect(container.textContent).not.toContain('一筆只能更正一次');
    expect(container.querySelector('button[disabled]')?.getAttribute('title')).not.toContain(
      '一筆只能更正一次',
    );
  });

  // 🔵 負對照:**沒被更正**的那一列不該出現這句指引(否則上面三格在兩個世界印同一個值)。
  it('🔵 負對照:還沒被更正的列不印那句指引,而且它的「更正」是可按的連結', () => {
    const { container } = render(
      <NotesTimeline
        orderId={ID}
        detail={{ notes: [note({ id: 'a' })], notesTruncated: false, customerNotified: false }}
      />,
    );
    expect(container.textContent).not.toContain('要再改請按最新那版');
    expect(container.querySelector('a[href*="correct="]')).not.toBeNull();
  });
});

// ── `?note=` 彈窗(2026-09-13):forceOpen 只在彈窗給;明細頁那條路零改變 ──────────────
describe('forceOpen(`?note=` 彈窗用)', () => {
  const ID = '3f2f2c1e-0000-4000-8000-000000000001';
  const quiet = { notes: [note({ id: 'a', noteType: 'internal' })], notesTruncated: false, customerNotified: false };
  const details = (c: HTMLElement) => c.querySelector('details') as HTMLDetailsElement;
  it('forceOpen ⇒ 沒有任何既有理由也攤開(彈窗標題已是「備註與客人聯繫」, 再收一層 = 點兩次)', () => {
    const { container } = render(<NotesTimeline orderId={ID} detail={quiet} forceOpen />);
    expect(details(container).open).toBe(true);
  });
  it('🔴 對照:同一份資料不給 forceOpen ⇒ 照舊收著(明細頁 / 就地展開那條路一個字沒變)', () => {
    const { container } = render(<NotesTimeline orderId={ID} detail={quiet} />);
    expect(details(container).open).toBe(false);
  });
});
