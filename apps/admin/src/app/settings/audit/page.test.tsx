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

const { listRecent, listStaffRows } = vi.hoisted(() => ({
  listRecent: vi.fn(),
  listStaffRows: vi.fn(),
}));

// `order-repository.ts:1` 有 `import 'server-only'` ⇒ jsdom 直接炸,必須換掉。
vi.mock('../../../lib/orders/order-repository', () => ({
  getAdminAuditLogReader: () => ({ listRecent }),
}));
// 🔴 換掉的是 `staff.ts` 的**依賴**(`staff-repository.ts:1` 才是 server-only 那支),
//    **不是 `staff.ts` 本身** —— 形狀同 `app/settings/suppliers/page.test.tsx:12-14`。
//    這樣 `listActiveStaff()` 的 `is_active` 過濾與 `{id,label}` 投影走的是**真實作**。
vi.mock('../../../lib/staff-repository', () => ({ listStaffRows }));
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

const STAFF_ROWS = [
  { id: 'sean', label: '阿祥', is_manager: true, is_active: true },
  { id: 'left', label: '已離職', is_manager: false, is_active: false },
];

const LOG_ROW = {
  id: 'log-1',
  actor: 'sean',
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

describe('/settings/audit 頁本體的旗標閘', () => {
  it('🔴 旗標關 ⇒ 直接載入頁面會被 notFound() 擋下(不經過側欄)', async () => {
    vi.stubEnv('AUDIT_UI_ENABLED', '');
    // 🔴 **前提斷言**:先證明我塞的值真的生效,再斷言行為。
    //    沒有這行,`stubEnv` 若沒生效,整格會在「旗標剛好也是關的」情況下**假綠**
    //    (house 現成形狀:`lib/orders/payment-list-view.test.ts:96-107`)。
    expect(process.env.AUDIT_UI_ENABLED).toBe('');

    await expect(AuditLogPage()).rejects.toThrow(NOT_FOUND);
  });

  it('🔴 旗標開 ⇒ 頁面正常渲染(正向對照:證明上一格不是恆真)', async () => {
    // 沒有這一條,把閘寫成 `if (true) notFound()`(恆擋、功能永遠打不開)上面那格照樣綠。
    vi.stubEnv('AUDIT_UI_ENABLED', '1');
    expect(process.env.AUDIT_UI_ENABLED).toBe('1');

    const { getByRole } = render(await AuditLogPage());
    expect(getByRole('heading', { level: 1 }).textContent).toBe('操作紀錄');
  });

  it('🔴 旗標值不是恰好 `1` ⇒ 一律擋(`true` / `yes` 都不算開)', async () => {
    // `audit-ui-flag.ts:21` 逐字「預設 off、**恰 `'1'`** 才開」。
    // 這格擋的是有人把判斷改成 `Boolean(process.env.X)` 之類的寬鬆寫法。
    vi.stubEnv('AUDIT_UI_ENABLED', 'true');
    expect(process.env.AUDIT_UI_ENABLED).toBe('true');

    await expect(AuditLogPage()).rejects.toThrow(NOT_FOUND);
  });
});

describe('D1c-2a:三種狀態必須長得不一樣', () => {
  beforeEach(() => {
    vi.stubEnv('AUDIT_UI_ENABLED', '1');
  });

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
    vi.stubEnv('AUDIT_UI_ENABLED', '1');
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
    '「操作人」是操作的人自己在畫面上選的,系統還沒有驗證他是誰 —— 這個名字未經驗證。' +
    '這裡的紀錄可以當線索,不能當「誰做的」的唯一憑據。要讓它可信,請通知系統維護接上個人帳號登入。';
  const strip = (text: string) => text.replace(/\s+/g, '');

  beforeEach(() => {
    vi.stubEnv('AUDIT_UI_ENABLED', '1');
  });

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
      .filter((t) => t.includes(strip('這個名字未經驗證')));
    expect(visible).toHaveLength(1);
  });
});

describe('D1c-2a:一次抓幾筆是頁面層的決定', () => {
  it('🔴 頁面把 50 傳給 listRecent(不是讓 adapter 自己決定)', async () => {
    // `AuditLogReader.listRecent(limit)` **刻意沒有預設值**(`lib/audit/repository.ts:73-75`:
    // 預設值會讓「這頁一次抓幾筆」藏在最底層)。
    // ⇒ **忘了傳** 由 typecheck 擋;**傳成別的數**只有這一格擋得住。
    vi.stubEnv('AUDIT_UI_ENABLED', '1');
    render(await AuditLogPage());
    expect(listRecent).toHaveBeenCalledWith(50);
  });
});
