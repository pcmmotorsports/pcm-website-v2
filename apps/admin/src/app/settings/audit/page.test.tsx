// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';

// 🔴 `notFound` mock 成**直接丟錯**,不是回 `undefined` ——
//    形狀照抄 `app/@panel/order-panel-wiring.test.ts:62`,該檔 `:27` 逐字寫了理由:
//    **丟錯測試才會紅,回 undefined 是靜默通過**(頁面會繼續往下 render,看起來完全正常)。
const NOT_FOUND = 'NEXT_NOT_FOUND';
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error(NOT_FOUND);
  },
}));

const { listRecent, listStaffRows, sessionActor, getStaffRowById, STAFF_ROWS } = vi.hoisted(() => {
  const STAFF_ROWS = [
    { id: 'sean', label: '阿祥', is_manager: true, is_active: true },
    { id: 'left', label: '已離職', is_manager: false, is_active: false },
  ];
  return {
    listRecent: vi.fn(),
    listStaffRows: vi.fn(),
    // 2026-09-14(成本遮罩):頁面現在也讀 session actor 與 is_manager;預設 = 沒票(非 manager, fail-closed)。
    sessionActor: vi.fn<() => Promise<{ id: string; label: string } | null>>().mockResolvedValue(null),
    getStaffRowById: vi.fn(async (id: string) => STAFF_ROWS.find((r) => r.id === id) ?? null),
    STAFF_ROWS,
  };
});

// `order-repository.ts:1` 有 `import 'server-only'` ⇒ jsdom 直接炸,必須換掉。
vi.mock('../../../lib/orders/order-repository', () => ({
  getAdminAuditLogReader: () => ({ listRecent }),
}));
// 🔴 換掉的是 `staff.ts` 的**依賴**(`staff-repository.ts:1` 才是 server-only 那支),
//    **不是 `staff.ts` 本身** —— 形狀同 `app/settings/suppliers/page.test.tsx:12-14`。
//    這樣 `listActiveStaff()` 的 `is_active` 過濾與 `{id,label}` 投影走的是**真實作**。
vi.mock('../../../lib/session/actor', () => ({ getSessionActor: () => sessionActor() }));
const brandNames = vi.fn(async () => new Map([['b1', 'ARROW']]));
vi.mock('../../../lib/customers/brand-discount-repository', () => ({ loadBrandNames: () => brandNames() }));
vi.mock('../../../lib/staff-repository', () => ({ listStaffRows, getStaffRowById }));
// `next/link` 需要 app router context 才 render 得起來;本頁只用它做站內導航。
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import AuditLogPage from './page';

// page.test.tsx — `#27` D1c-1(旗標閘)+ D1c-2a(三狀態與 N)。
//
// ── 🔴 本檔的第一個職能:**「直接打網址進不進得來」**(主視窗 D1c-1 派工信逐字)────
//   **只擋側欄 = 擋的是「看得到入口」,不是「進得去」。**
//   判別句:**這格紅的時候,是因為「頁面真的擋住」還是「選單剛好沒渲染」?**
//   ⇒ **本檔完全不經過側欄任何一行 code** —— 直接載入頁面模組並呼叫它。
//
// ⚠️ **誠實邊界,不要讀成「404 已驗證」**:本檔量的是「頁面模組有沒有呼叫 `notFound()`」。
//   **真的變成 404 畫面**是 Next runtime 的行為,要真跑 dev server / Sean 肉眼驗才算。
//
// ⚠️ **D1c-2a 起頁面是 `async`** ⇒ 旗標閘的 `notFound()` 變成 **rejected promise**,不再是同步 throw
//   ⇒ 那幾格改用 `rejects.toThrow`。**這不是放寬,是同一件事在 async 下的正確量法**
//   (寫成 `expect(() => …).toThrow` 會**恆綠**:async 函式呼叫本身不丟)。


const LOG_ROW = {
  id: 'log-1',
  actor: 'sean',
  actor_label: null,
  actor_is_manager: null,
  action: 'order.cancel',
  target: 'order:11111111-1111-4111-8111-111111111111',
  before: null,
  after: null,
  reason: null,
  request_id: null,
  source_app: 'admin' as const,
  created_at: '2026-08-15T01:23:45.000Z',
};

beforeEach(() => {
  listStaffRows.mockResolvedValue(STAFF_ROWS);
  listRecent.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

// ⛔ ~~describe('/settings/audit 頁本體的旗標閘')~~(旗標關 ⇒ notFound / 開 ⇒ 渲染 / 非 '1' ⇒ 擋,三格)
//    2026-09-14 Sean 拍 Q2 乙:這一頁常開、旗標檔刪 ⇒ 換成一格「不設任何 env 也渲染」。
describe('/settings/audit 常開(2026-09-14 Q2 乙)', () => {
  it('🔴 不設 AUDIT_UI_ENABLED 也正常渲染 —— 旗標那條路不得回來', async () => {
    vi.stubEnv('AUDIT_UI_ENABLED', '');
    const { getByRole } = render(await AuditLogPage());
    expect(getByRole('heading', { level: 1 }).textContent).toBe('操作紀錄');
  });
});

describe('D1c-2a:三種狀態必須長得不一樣', () => {
  it('有資料 ⇒ 四欄的內容都出現(代碼已轉中文、slug 已轉姓名)', async () => {
    listRecent.mockResolvedValue([LOG_ROW]);
    const { container } = render(await AuditLogPage());
    const text = container.textContent ?? '';

    // 走的是 D1b 的 `toAuditListRow`:代碼 → 中文、actor slug → 姓名。
    expect(text).toContain('取消訂單');
    expect(text).toContain('阿祥');
    // 🔴 負向對照:**原始代碼不得同時出現** —— 若顯示層被繞過(直接把 row 攤上畫面),
    //    上面兩條可能仍綠(中文剛好也在),但這條會紅。
    expect(text).not.toContain('order.cancel');
  });

  // 🆕 2026-09-14 驗收(1):停用的員工(`left`, is_active=false)的舊列仍印名字 —— 頁面改讀含停用的全名單。
  //    改回 `listActiveStaff()` 這格應會紅(他會被濾掉 ⇒ 印成 `left(查無此員工)`;推論, 未親自反證)。
  it('🔴 已停用員工的舊列(快照 NULL)⇒ 仍印他的名字, 不是 slug', async () => {
    listRecent.mockResolvedValue([{ ...LOG_ROW, actor: 'left' }]);
    const { container } = render(await AuditLogPage());
    const text = container.textContent ?? '';
    expect(text).toContain('已離職');
    expect(text).not.toContain('查無此員工');
  });

  // 🆕 驗收(2)的顯示端:列上有快照 ⇒ 用快照, 名單裡的現名不算數。
  it('🔴 列上有快照 ⇒ 印快照的名字 + 管理者尾綴, 不印名單現名', async () => {
    listRecent.mockResolvedValue([{ ...LOG_ROW, actor_label: '當時叫這個', actor_is_manager: true }]);
    const { container } = render(await AuditLogPage());
    const text = container.textContent ?? '';
    expect(text).toContain('當時叫這個(管理者)');
    expect(text).not.toContain('阿祥');
  });

  it('🔴 沒有資料 ⇒ 出現空狀態,而且**不得**出現失敗字樣', async () => {
    listRecent.mockResolvedValue([]);
    const { container } = render(await AuditLogPage());
    const text = container.textContent ?? '';

    expect(text).toContain('目前沒有操作紀錄');
    // 空狀態要說明「為什麼這是正常的」—— 只寫「沒有資料」會被讀成壞掉或權限不對。
    expect(text).toContain('這裡就會出現紀錄');
    expect(text).not.toContain('載入失敗');
  });

  it('🔴🔴 讀取失敗 ⇒ 出現失敗字樣,而且**不得**出現空狀態字樣(本片的 must)', async () => {
    // 🔴 **這一格擋的是「壞掉但看起來完全正常」**:
    //    `SupabaseAuditLogReader.listRecent()` 出錯是 **throw**、不是回 `[]`(D1a-2 刻意如此)。
    //    若頁面寫成 `catch { rows = [] }`,畫面會顯示「目前沒有操作紀錄」——
    //    員工看到的是「今天沒人動過東西」,而事實是「這頁讀不到資料」。
    //    ⇒ 主視窗 2026-08-15 裁定 **must、不准降級**(同日訂單線獨立踩過「拿不到值 ≠ 0」同形狀)。
    listRecent.mockRejectedValue(new Error('42501 permission denied'));
    const { container } = render(await AuditLogPage());
    const text = container.textContent ?? '';

    expect(text).toContain('載入失敗');
    expect(text).not.toContain('目前沒有操作紀錄');
  });

  // 🆕 codex R1 must-fix:名單讀失敗【不得】被印成「查無此員工」(讀取失敗冒充查無)⇒ 走 loadFailed。
  it('🔴🔴 員工名單讀失敗 ⇒ 載入失敗, 而且**不得**把人印成「查無此員工」', async () => {
    listRecent.mockResolvedValue([LOG_ROW]);
    listStaffRows.mockRejectedValue(new Error('db down'));
    const { container } = render(await AuditLogPage());
    const text = container.textContent ?? '';
    expect(text).toContain('載入失敗');
    expect(text).not.toContain('查無此員工');
  });
});

describe('D1c-2a:接線那一跳(顯示層算得對 ≠ 頁面真的用了它)', () => {
  it('🔴 執行環境在 UTC 時,畫面上仍是台北時間', async () => {
    // 🔴 **本格補的是「接線」,不是「顯示層」** —— `audit-list-view.test.ts:138-148` 已經證明
    //    `toAuditListRow` 在 UTC 下仍印台北時間(含前提斷言,那格是活的)。
    //    **它證不到的是:這一頁有沒有真的走那條路。**
    //    繞過 `toAuditListRow` 直接把 `row.created_at` 攤上畫面,那格照樣全綠、本格會紅。
    // ⚠️ **我原本把這條寫成誠實邊界「時區零判別力」——那是錯的**(E 窗 2026-08-15 R1 預告時點出)。
    //    真相:`vitest.config.ts:64` 釘死 `TZ=Asia/Taipei` 只是**預設**,`vi.stubEnv` 蓋得過去,
    //    而 D1b 那輪我自己就做過。**我把一個「已被解掉的限制」當成「測不出」繼承下來了。**
    vi.stubEnv('TZ', 'UTC');
    // 前提斷言:先確認 stub 真的改到執行期時區 —— 沒改到的話下面那句在台北下恆綠。
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone, '前提:stub 應改到執行期時區').toBe('UTC');

    listRecent.mockResolvedValue([LOG_ROW]);
    const { container } = render(await AuditLogPage());
    // created_at = 2026-08-15T01:23:45Z ⇒ 台北 09:23(+8);若走了執行期時區會印 01:23。
    expect(container.textContent).toContain('2026-08-15 09:23');
    expect(container.textContent).not.toContain('2026-08-15 01:23');
  });
});

describe('🔴🔴 「操作人」未經驗證的警語(釘字面 + 三種狀態都要在)', () => {
  // 🔴 **這一格擋的是「一份沉默的稽核」**:四欄、有時間有對象、排版像帳本,
  //    而 `staff.ts:4-5` 逐字「操作者仍是**使用者自行選擇**…沒有驗證『目前使用者是誰』」
  //    ⇒ 那一欄印的是**他自己說他是誰**。不寫出來的話,畫面看起來完全正常,
  //    而讀的人會拿它當「誰做的」的憑據。
  //
  // 🔴 **釘的是【字面】不是【關鍵字】** —— 因為這句話被改軟(「未經驗證」→「僅供參考」)
  //    之後**畫面看起來一模一樣**,沒有任何別的東西會紅。
  //    ⇒ 突變兩個方向都要紅:**整句拿掉** 紅、**改成別的字** 也紅。
  //    只斷言「有沒有出現『操作人』三個字」擋不住第二種(那三個字本來就是欄標題)。
  //
  // ⚠️ 空白正規化:JSX 把跨行文字接成單一空白,而**空白是排版不是內容** ⇒ 兩邊都抽掉再比。
  const COPY =
    '2026-08-25 起，「操作人」來自已驗證的登入身分。在此日期之前，操作人由使用者自行選擇，' +
    '系統未驗證是否為本人，因此舊紀錄只能作為查核線索，不能單憑姓名認定實際操作人。';
  const strip = (text: string) => text.replace(/\s+/g, '');

  it('🔴 有資料 ⇒ 警語逐字出現', async () => {
    listRecent.mockResolvedValue([LOG_ROW]);
    const { container } = render(await AuditLogPage());
    expect(strip(container.textContent ?? '')).toContain(strip(COPY));
  });

  it('🔴 沒有資料 ⇒ 警語仍逐字出現(空的那天不得悄悄變成沒有但書的稽核)', async () => {
    // 這句講的是**這一頁的資料是什麼**,不是「這次有沒有撈到」。
    // 同形狀既有前例:`app/products/[id]/page.test.tsx:353`「空的時候警語仍要在…三段都要在」。
    listRecent.mockResolvedValue([]);
    const { container } = render(await AuditLogPage());
    const text = container.textContent ?? '';
    // 前提斷言:先證明我真的在看空狀態那條路,否則這格會在「其實有資料」時假綠。
    expect(text, '前提:這格量的是空狀態').toContain('目前沒有操作紀錄');
    expect(strip(text)).toContain(strip(COPY));
  });

  it('🔴 讀取失敗 ⇒ 警語仍逐字出現', async () => {
    listRecent.mockRejectedValue(new Error('42501 permission denied'));
    const { container } = render(await AuditLogPage());
    const text = container.textContent ?? '';
    expect(text, '前提:這格量的是失敗狀態').toContain('載入失敗');
    expect(strip(text)).toContain(strip(COPY));
  });

  it('🔴 警語是**可見文字**,不是 title / aria-label', async () => {
    // `title` 由 OS 畫、不進 paint tree ⇒ 截圖與 DOM 都抓不到(`item-name-cell.tsx` 檔頭)。
    // 這格擋的是有人為了版面把這句搬進屬性裡 —— 搬完之後上面三格會紅,
    // 而**若有人改用 `title` 又同時放一份可見文字**,這格保證那份可見的才是被量到的那份。
    listRecent.mockResolvedValue([LOG_ROW]);
    const { container } = render(await AuditLogPage());
    const visible = Array.from(container.querySelectorAll('p'))
      .map((el) => strip(el.textContent ?? ''))
      // 🔴 認人用的字面挑【兩個時期都在】的那半 —— 挑「未經驗證」那半的話,
      //    ⟦b4-MGR0⟧ 把橫幅拆成兩個時期時這一格會紅, 而紅的原因與本格要守的事無關
      //    (2026-08-28 實際撞過一次:改完文案這格 AssertionError expected [] to have length 1)。
      .filter((t) => t.includes(strip('不能單憑姓名認定實際操作人')));
    expect(visible).toHaveLength(1);
  });
});

describe('D1c-2a:一次抓幾筆是頁面層的決定', () => {
  it('🔴 頁面把 50 傳給 listRecent(不是讓 adapter 自己決定)', async () => {
    // `AuditLogReader.listRecent(limit)` **刻意沒有預設值**(`lib/audit/repository.ts:73-75`:
    // 預設值會讓「這頁一次抓幾筆」藏在最底層)。
    // ⇒ **忘了傳** 由 typecheck 擋;**傳成別的數**只有這一格擋得住。
    render(await AuditLogPage());
    expect(listRecent).toHaveBeenCalledWith(50);
  });
});

describe('🔴 成本紀錄的數字只有老闆看得到(20260914010000;codex 2026-09-14 must-fix ①)', () => {
  const COST_LOG = {
    ...LOG_ROW,
    id: 'log-costs',
    action: 'orders.item.costs.set',
    target: 'order_item:22222222-2222-4222-8222-222222222222',
    before: { cost_price: '100.5000', currency: 'EUR', fx_rate: '35.5' },
    after: { cost_price: '120.0000', currency: 'EUR', fx_rate: '35.5' },
  };
  beforeEach(() => {
    process.env.AUDIT_UI_ENABLED = '1';
    listRecent.mockResolvedValue([COST_LOG, LOG_ROW]);
  });

  it('非 manager(沒票 / 一般員工)⇒ 那一筆還在,但 before / after 遮成「老闆才看得到」', async () => {
    sessionActor.mockResolvedValue(null);
    const { container } = render(await AuditLogPage());
    const text = container.textContent ?? '';
    expect(text).toContain('(老闆才看得到)');
    expect(text).not.toContain('100.5');
    expect(text).not.toContain('120');
    expect(text, '事件本身不能消失').toContain('order_item:');
  });

  it('manager ⇒ 數字照印(正向對照:證明上一格不是恆真)', async () => {
    sessionActor.mockResolvedValue({ id: 'sean', label: '阿祥' });
    const { container } = render(await AuditLogPage());
    const text = container.textContent ?? '';
    expect(text).toContain('100.5');
    expect(text).toContain('120');
    expect(text).not.toContain('(老闆才看得到)');
  });

  // 🔴🔴 **2026-09-17 加「為什麼」那一欄時,這道遮罩差點漏掉它。**
  //    ⚠️ 只遮 before/after 而放 `reason` 過去 ⇒ 員工把數字打在原因裡(「改成 3200」)
  //       就**從旁邊那一欄漏出去**, 而畫面看起來「有遮」。
  //    📌 **一道遮罩的射程止於它遮的那幾欄** —— 加新欄位的人要自己把它加進來,
  //       而沒有東西會提醒他。這一格就是那個提醒。
  it('🔴 非 manager ⇒ 成本那一筆的「為什麼」也要遮(數字可能被打在原因裡)', async () => {
    sessionActor.mockResolvedValue(null);
    listRecent.mockResolvedValue([{ ...COST_LOG, reason: '改成 3200 因為供應商調價' }]);
    const { container } = render(await AuditLogPage());
    const text = container.textContent ?? '';
    expect(text, '原因整句漏出去了').not.toContain('3200');
    expect(text).toContain('(老闆才看得到)');
  });

  it('🔵 正向對照:manager 看得到那句原因(證明上一格不是恆真)', async () => {
    sessionActor.mockResolvedValue({ id: 'sean', label: '阿祥' });
    listRecent.mockResolvedValue([{ ...COST_LOG, reason: '改成 3200 因為供應商調價' }]);
    const { container } = render(await AuditLogPage());
    expect(container.textContent ?? '').toContain('3200');
  });

  // 🔵 **負對照:遮罩只掛在成本那一個 action** —— 沒有它, 把遮罩改成「一律遮」也會綠。
  it('🔵 負對照:別的 action 的原因, 非 manager 照樣看得到', async () => {
    sessionActor.mockResolvedValue(null);
    listRecent.mockResolvedValue([{ ...LOG_ROW, reason: '客人打電話說不要了' }]);
    const { container } = render(await AuditLogPage());
    expect(container.textContent ?? '').toContain('客人打電話說不要了');
  });
});

// ══ 2026-09-17「為什麼為選填欄位」那一句 ═══════════════════════════════════════
// 🔴 **為什麼要守它**:接上那一欄之後, 畫面上多半是一排「—」
//    (實查正式庫:最近 15 筆裡只有 3 筆有原因)⇒ **沒有這一句, 第一個念頭是「壞了」。**
// 🛑 **三種狀態都要在** —— 同這一頁既有那句警語的紀律:它講的是【這一欄是什麼】,
//    不是「這次有沒有撈到」。只在有資料時印, 等於在空的那天悄悄消失。
describe('🔴「為什麼為選填欄位」那一句:三種狀態都要在', () => {
  it('有資料時在', async () => {
    process.env.AUDIT_UI_ENABLED = '1';
    listRecent.mockResolvedValue([LOG_ROW]);
    const { container } = render(await AuditLogPage());
    expect(container.textContent).toContain('為選填欄位');
  });

  it('一筆都沒有時也要在', async () => {
    process.env.AUDIT_UI_ENABLED = '1';
    listRecent.mockResolvedValue([]);
    const { container } = render(await AuditLogPage());
    expect(container.textContent, '空的那天這句話悄悄消失了').toContain('為選填欄位');
  });

  it('讀取失敗時也要在', async () => {
    process.env.AUDIT_UI_ENABLED = '1';
    listRecent.mockRejectedValue(new Error('boom'));
    const { container } = render(await AuditLogPage());
    expect(container.textContent, '讀取失敗那天這句話悄悄消失了').toContain('為選填欄位');
  });

  // 🔴 **實體星號守門**:我第一版把它寫成 `**選填**` ⇒ JSX 純文字渲染會印出實體 `**`。
  //    📌 那是 2026-09-16 才修過的同一個病, 而那道守門只掃 cancel-result-panel 自己那幾個常數
  //       ⇒ 對這一頁零判別力。這一格把它帶到這一頁。
  // 🔴🔴 **我第一版把這一格寫成 `expect('「為什麼」為選填欄位').not.toContain('**')`** ——
  //    那是斷言一個**我自己在測試裡打的字串**, 跟畫面無關 ⇒ **恆綠, 永遠寫不出負測。**
  //    ⇒ 📌 一個守門若殺不死任何一種世界, 它只是一句宣稱。改成【掃真的渲染出來的文字】。
  it('🔴 這一頁【渲染出來的文字】不得含 Markdown 星號', async () => {
    process.env.AUDIT_UI_ENABLED = '1';
    listRecent.mockResolvedValue([LOG_ROW]);
    const { container } = render(await AuditLogPage());
    expect(
      container.textContent ?? '',
      'JSX 是純文字渲染 ⇒ 寫 `**粗體**` 會印出實體星號(2026-09-16 同一個病修過一次)',
    ).not.toContain('**');
  });
});

describe('換商品紀錄(20260922100000):成本只有老闆看得到, 請求指紋不顯示', () => {
  const SWAP_LOG = {
    ...LOG_ROW,
    id: 'log-swap',
    action: 'order.item.swap',
    target: 'order:33333333-3333-4333-8333-333333333333',
    before: { sku: 'OLD-SKU', title: '舊商品', item_id: 'i-old', quantity: 2, unit_price: 98765, item_cost: { cost_price: '456.7000', currency: 'TWD' } },
    after: { sku: 'NEW-SKU', title: '新商品', item_id: 'i-new', request: { order_id: 'fp-order-xyz' } },
  };
  beforeEach(() => {
    process.env.AUDIT_UI_ENABLED = '1';
    listRecent.mockResolvedValue([SWAP_LOG]);
  });

  it('非 manager ⇒ 看得到換了什麼(料號、品名), 成本數字遮掉, 指紋不顯示', async () => {
    sessionActor.mockResolvedValue(null);
    const { container } = render(await AuditLogPage());
    const text = container.textContent ?? '';
    expect(text).toContain('換商品');
    expect(text).toContain('OLD-SKU');
    expect(text).toContain('NEW-SKU');
    expect(text).toContain('舊商品');
    expect(text, '成本數字漏出去了').not.toContain('456.7');
    expect(text).toContain('(老闆才看得到)');
    expect(text).not.toContain('fp-order-xyz');
    expect(text, '沒變的單價不該顯示成被清掉').not.toContain('98765');
  });

  it('manager ⇒ 成本照印(正向對照:證明上一格不是恆真)', async () => {
    sessionActor.mockResolvedValue({ id: 'sean', label: '阿祥' });
    const { container } = render(await AuditLogPage());
    const text = container.textContent ?? '';
    expect(text).toContain('456.7');
    expect(text).not.toContain('fp-order-xyz');
  });

  it('同款換規格(品名相同)⇒ 品名仍然顯示;目錄價不列在變動裡', async () => {
    sessionActor.mockResolvedValue(null);
    listRecent.mockResolvedValue([
      {
        ...SWAP_LOG,
        before: { sku: 'BLK-01', title: '同一款車牌架', item_id: 'i-old' },
        after: { sku: 'RED-01', title: '同一款車牌架', item_id: 'i-new', catalog_price: 76543 },
      },
    ]);
    const { container } = render(await AuditLogPage());
    const text = container.textContent ?? '';
    expect(text).toContain('BLK-01');
    expect(text).toContain('RED-01');
    expect(text, '品名被差異過濾吃掉了').toContain('同一款車牌架');
    expect(text, '目錄價不該看起來像被改了').not.toContain('76543');
  });
});

describe('🔴 經銷品牌折扣的「低於成本的原因」只有老闆看得到(20260925030000;B2B 計畫 §10.4, Codex E1 R1)', () => {
  const DISCOUNT_LOG = {
    ...LOG_ROW,
    id: 'log-discount',
    action: 'dealer.brand_discount.change',
    target: 'customer:33333333-3333-4333-8333-333333333333',
    before: { brand_id: 'b1', percent: 5, below_cost_reason: '' },
    after: { brand_id: 'b1', percent: 12.5, below_cost_reason: '成本 3150 以下也要清庫存' },
    reason: '成本 3150 以下也要清庫存',
  };
  beforeEach(() => {
    process.env.AUDIT_UI_ENABLED = '1';
    listRecent.mockResolvedValue([DISCOUNT_LOG]);
  });

  it('非 manager ⇒ 看得到折扣從 5 變 12.5, 但原因(before/after 與「為什麼」)都遮掉', async () => {
    sessionActor.mockResolvedValue(null);
    const { container } = render(await AuditLogPage());
    const text = container.textContent ?? '';
    expect(text).toContain('12.5');
    expect(text, '成本原因漏出去了').not.toContain('3150');
  });

  it('🔵 正向對照:manager 看得到原因', async () => {
    sessionActor.mockResolvedValue({ id: 'sean', label: '阿祥' });
    const { container } = render(await AuditLogPage());
    expect(container.textContent ?? '').toContain('3150');
  });

  it('🔴 沒有原因的那一筆, 非管理者也印遮罩(否則「有沒有遮罩」就等於「是不是低於成本」)', async () => {
    sessionActor.mockResolvedValue(null);
    listRecent.mockResolvedValue([{ ...DISCOUNT_LOG, reason: null, after: { brand_id: 'b1', percent: 6, below_cost_reason: '' } }]);
    const { container } = render(await AuditLogPage());
    expect(container.textContent ?? '').toContain('(老闆才看得到)');
  });

  it('經銷品牌折扣那一筆顯示品牌名稱(不是編號);管理者與一般員工都看得到', async () => {
    for (const actor of [null, { id: 'sean', label: '阿祥' }]) {
      sessionActor.mockResolvedValue(actor);
      const { container, unmount } = render(await AuditLogPage());
      const text = container.textContent ?? '';
      expect(text).toContain('品牌');
      expect(text).toContain('ARROW');
      unmount();
    }
  });

  it('讀不到品牌名稱 ⇒ 退回顯示編號, 頁面照常', async () => {
    brandNames.mockRejectedValueOnce(new Error('down'));
    sessionActor.mockResolvedValue(null);
    const { container } = render(await AuditLogPage());
    expect(container.textContent ?? '').toContain('b1');
  });
});
