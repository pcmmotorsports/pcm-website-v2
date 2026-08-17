// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { ReactNode } from 'react';

const { listSuppliersForSettings } = vi.hoisted(() => ({
  listSuppliersForSettings: vi.fn(),
}));

// `supplier.ts` runtime import `supplier-repository` ⇒ `import 'server-only'` ⇒ jsdom 直接炸。
// 換掉的是**它的依賴**,不是它本身(形狀同 `lib/supplier.test.ts:5`)。
vi.mock('../../../lib/supplier-repository', () => ({
  listSupplierRows: vi.fn(),
}));
// 🔴 只換 `listSuppliersForSettings` 一支,`sortSuppliersByLabel` 保留**真實作** ——
//    向量必須經過畫面上真正在跑的那把排序,否則「候選順序」與「定位」兩組斷言
//    鎖住的是測試自己捏的順序。
vi.mock('../../../lib/supplier', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/supplier')>()),
  listSuppliersForSettings,
}));
vi.mock('../../../lib/supplier-actions', () => ({
  createSupplierAction: vi.fn(),
  renameSupplierAction: vi.fn(),
  setSupplierActiveAction: vi.fn(),
}));
// `next/link` 需要 app router context 才 render 得起來;本頁只用它做站內導航。
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { SUPPLIER_CANDIDATE_LIST_LABEL } from '../../../components/settings/supplier-label-input';
import { sortSuppliersByLabel } from '../../../lib/supplier';
import { filterSupplierCandidates } from '../../../lib/supplier-candidates';
import type { SupplierRow } from '../../../lib/supplier-repository';
import { SUPPLIER_RESULT_MESSAGES } from '../../../lib/supplier-result-messages';
import SupplierSettingsPage from './page';

// page.test.tsx — M-4b E10 S3b-3 頁面層。
// 🔴 **admin 的 `app/` 目錄在此之前零 page 層測試**,原因是既有頁面用 `@/` import 而
//    vitest 的 `@` alias 指向 `apps/storefront/src`(`vitest.config.ts:28`)⇒ resolve 不到。
//    本頁改用相對路徑就是為了讓 `[K1-M7]`(讀取失敗 ⇒ 不渲染新增表單)這條**真的測得到**
//    —— 它是本片刻意偏離 staff 樣板的那一條,沒有測試就只是一句 plan 裡的話。
// ⚠️ #612 更新(2026-08-17):上述 alias 限制已由 #606 修除(vitest projects、admin 自帶 @ alias)⇒ 新 code 可用 @/;既有相對 import 保留、不回改。

const RAW: readonly SupplierRow[] = [
  { id: 'id-webike-tw', label: 'Webike TW', is_active: true },
  { id: 'id-akoso', label: 'AKOSO', is_active: true },
  { id: 'id-webike-eu', label: 'Webike EU', is_active: false },
  { id: 'id-anfengda', label: '安豐達', is_active: true },
  { id: 'id-webike-jp', label: 'Webike JP', is_active: true },
  { id: 'id-wrs', label: 'WRS s.r.l', is_active: true },
];
const ROWS = sortSuppliersByLabel(RAW);

type Params = Record<string, string | string[] | undefined>;

async function renderPage(params: Params = {}) {
  const element = await SupplierSettingsPage({
    searchParams: Promise.resolve(params),
  });
  return render(element);
}

/** 桌機表格的資料列數(手機卡片是同一份資料的第二次渲染,不重複數)。 */
function tableRowCount(container: HTMLElement): number {
  return container.querySelectorAll('tbody tr').length;
}

beforeEach(() => {
  listSuppliersForSettings.mockReset();
  listSuppliersForSettings.mockResolvedValue([...ROWS]);
});

afterEach(cleanup);

describe('SupplierSettingsPage — 讀取失敗', () => {
  it('should refuse to render the create form when the list fails to load', async () => {
    // 🔴 `[K1-M7]` —— 本片**刻意偏離** staff 樣板(`settings/staff/page.tsx:47-55`
    //    在讀取失敗時仍然渲染新增表單)。理由是供應商**不可刪除**:名單載不出來
    //    ⇒ 候選恆為空 ⇒ 員工看不到「這家已經有了」⇒ 建一筆永久垃圾列。
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    listSuppliersForSettings.mockRejectedValue(new Error('boom'));

    const { container } = await renderPage();

    expect(container.textContent).toContain('供應商名單載入失敗');
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('input[name="label"]')).toBeNull();
    expect(container.querySelector('table')).toBeNull();
    error.mockRestore();
  });

  it('should never leak markdown emphasis markers into visible copy', async () => {
    // 🔴 R1 must-fix 1 的守門:第一版在 JSX 純文字裡寫了 `供應商**建立後不可刪除**`,
    //    JSX **不解析 markdown** ⇒ 員工看到的是逐字的星號。三綠、typecheck、lint
    //    沒有一個會轉紅,因為那只是一段沒人斷言過的字串。整頁一起守,不只守那一句。
    const { container } = await renderPage();

    expect(container.textContent).not.toContain('**');
    expect(container.textContent).toContain('供應商建立後不可刪除');
  });

  it('should render both the list and the create form on the happy path', async () => {
    // 上一條的對照組:沒有它,一個「永遠不渲染表單」的實作也會全綠。
    const { container } = await renderPage();

    expect(tableRowCount(container)).toBe(ROWS.length);
    expect(container.querySelector('input[name="label"]')).toBeTruthy();
    expect(container.textContent).toContain('新增供應商');
  });
});

describe('SupplierSettingsPage — ?r= 結果提示', () => {
  it('should show the stop-and-report warning for the bug code', async () => {
    // 🔴 `[K1-M8]`:`bug` 與 `error` 分開的**全部價值**在於這句文案。
    //    其中一支代表「已經多寫進去一筆刪不掉的供應商」,叫他再試一次會再多一筆。
    const { container } = await renderPage({ r: 'bug' });

    expect(container.textContent).toContain('請先不要重複送出');
    expect(container.textContent).toContain('通知維護者');
  });

  it('should point a duplicate at the row without claiming a locate that did not happen', async () => {
    // Sean 2026-08-02 Q2=A:只指路 + 標記,系統**不代按**啟用。
    // 🔴 codex K2 must-fix 1:這一組**沒有 `q`** ⇒ 清單根本沒有被定位。
    //    原文案寫「下方清單已定位到那一家」,在這條路上就是對員工說謊
    //    (同樣的謊還會出現在「`q` 指的那家剛被改名而命中 0 筆」與「名單載入失敗」)。
    //    ⇒ banner 只准講「這個名字已存在」;定位成功與否由頁面的 `locating` 那一行講。
    const { container } = await renderPage({ r: 'duplicate' });

    expect(container.textContent).toContain('這個名稱已經有了');
    expect(container.textContent).toContain('按該列的「啟用」');
    expect(container.textContent).not.toContain('已定位');
    expect(tableRowCount(container)).toBe(ROWS.length);
  });

  it('should drop every list-dependent instruction when the list failed to load', async () => {
    // 🔴🔴 同一個謊的第三條路,而且**上一輪我沒修乾淨**(codex K2 R2 must-fix 1):
    //    我只拿掉了「已定位」三個字,卻留著「到下方清單找出那一家」「按該列的『啟用』」——
    //    那條路上根本沒有清單,兩句都是做不到的指示。**整則 banner 都不該渲染。**
    //    ⇒ 這條改成把**每一則**結果文案都排除,不再只盯我上次手碰到的那三個字
    //    (`feedback_claimed-sync-but-only-patched-touched-lines`)。
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    listSuppliersForSettings.mockRejectedValue(new Error('boom'));

    const { container } = await renderPage({ r: 'duplicate', q: 'Webike' });

    const everyMessage = Object.values(SUPPLIER_RESULT_MESSAGES).map(
      (message) => message.text,
    );
    expect(
      everyMessage.filter((text) => container.textContent?.includes(text)),
    ).toEqual([]);
    expect(container.textContent).not.toContain('下方清單');
    expect(container.textContent).not.toContain('按該列的');
    expect(container.querySelector('table')).toBeNull();
    // 但員工仍要知道「剛才那次操作有結果、只是這裡講不清楚」——不是靜默吞掉。
    expect(container.textContent).toContain('請在名單恢復後重新整理確認');
    error.mockRestore();
  });

  it('should not show the operation notice when there was no operation', async () => {
    // 上一條的判別力對照:沒有 `?r=` 時不該憑空冒出「你剛才那次操作」。
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    listSuppliersForSettings.mockRejectedValue(new Error('boom'));

    const { container } = await renderPage();

    expect(container.textContent).toContain('供應商名單載入失敗');
    expect(container.textContent).not.toContain('你剛才那次操作');
    error.mockRestore();
  });

  it('should render no banner at all for an unknown result code', async () => {
    // `[K1-n6]` ②:`?r=` 是任意 URL 輸入,未知值必須什麼都不顯示。
    const { container } = await renderPage({ r: 'ZZUNKNOWNZZ' });

    // 🔴 **不用 `[role="status"]` 當代理**(R1 nit):候選面板也帶 `role="status"`,
    //    這條之所以成立只是因為初始 `query===''` 面板不渲染 —— 面板哪天改成預設展開,
    //    它就會靜默量到別的東西。直接斷言「沒有任何一則已知文案出現」。
    const everyMessage = Object.values(SUPPLIER_RESULT_MESSAGES).map(
      (message) => message.text,
    );
    expect(
      everyMessage.filter((text) => container.textContent?.includes(text)),
    ).toEqual([]);
    expect(container.textContent).not.toContain('ZZUNKNOWNZZ');
  });
});

describe('SupplierSettingsPage — ?q= 定位', () => {
  it('should narrow the table to the located rows and offer a way back', async () => {
    const { container } = await renderPage({ r: 'duplicate', q: 'Webike' });

    expect(tableRowCount(container)).toBe(3);
    expect(
      container.querySelector('a[href="/settings/suppliers"]')?.textContent,
    ).toBe('顯示全部');
  });

  it('should keep the located hint free of the q value, word for word', async () => {
    // 🔴 `[K1-n6]` ③ / plan §3.5:`q` 來自 URL 的任意輸入,`boundSupplierQuery`
    //    只收斂空白與長度,**不**過濾控制字元或 U+202E 這類方向覆寫字
    //    ⇒ 它只能當過濾條件,永不印到畫面上。
    // 🔴 **這裡的 q 必須是「定位得到」的**(第一版寫成 `ZZQMARKERZZ` 而它命中 0 筆
    //    ⇒ 提示區塊根本不渲染 ⇒ 「把 q 插進提示文字」那個退化完全看不見,突變存活)。
    // 🔴 而且不能用 `not.toContain(q)` —— 命中的 q 必然是某個 label 的子字串,
    //    它本來就會出現在表格裡。改成**逐字白名單**:提示區塊的文字必須恰好是這一句。
    const { container } = await renderPage({ r: 'duplicate', q: 'Webike' });
    const hint = container.querySelector(
      'a[href="/settings/suppliers"]',
    )?.parentElement;

    // 🔴 不寫「剛才那個名稱」(codex K2 R2 nit):`q` 是任意 URL 輸入,
    //    直接開一個帶 `q` 的網址時根本沒有「剛才」這回事。
    expect(hint?.textContent).toBe(
      '清單目前只顯示符合網址篩選條件的 3 家。顯示全部',
    );
  });

  it('should not leak a non-matching q anywhere on the page either', async () => {
    // 上一條守「提示區塊」,這條守「其餘任何角落」——
    // 用一個不可能出現在名單裡的標記字串,涵蓋「把 q 印在別處」的退化。
    const { container } = await renderPage({ r: 'duplicate', q: 'ZZQMARKERZZ' });

    expect(container.textContent).not.toContain('ZZQMARKERZZ');
    expect(container.innerHTML).not.toContain('ZZQMARKERZZ');
  });

  it('should fall back to the full list when q locates nothing', async () => {
    // 🔴 名單被清空比沒定位更糟:員工會以為那家不見了,然後再建一筆永久重複列。
    const { container } = await renderPage({ r: 'duplicate', q: 'ZZQMARKERZZ' });

    expect(tableRowCount(container)).toBe(ROWS.length);
    expect(container.textContent).not.toContain('顯示全部');
  });

  it('should not claim to be locating when q matches every row', async () => {
    // 🔴 R1 nit 的修法守門:`q` 若命中每一列(單一常見字元、或名單只剩一家),
    //    畫面本來會宣稱「目前只顯示 N 家」+ 給一個「顯示全部」連結,
    //    而它其實什麼都沒過濾掉 —— 那句話就是假的。
    //    最乾淨的構造 = 名單只有一家、`q` 就是那一家(撞名時的真實情境:名單剛起步)。
    listSuppliersForSettings.mockResolvedValue([
      { id: 'id-akoso', label: 'AKOSO', is_active: true },
    ]);
    const { container } = await renderPage({ r: 'duplicate', q: 'AKOSO' });

    expect(tableRowCount(container)).toBe(1);
    expect(container.textContent).not.toContain('顯示全部');
    expect(container.textContent).not.toContain('目前只顯示');
  });

  it('should ignore a repeated q parameter instead of guessing', async () => {
    // `?q=a&q=b` ⇒ Next 交出陣列 ⇒ 當作沒給,不取第一個也不 join。
    const { container } = await renderPage({ q: ['Webike', 'AKOSO'] });

    expect(tableRowCount(container)).toBe(ROWS.length);
  });

  it('should ignore an over-long q that would otherwise still match', async () => {
    // 🔴🔴 **我上一版在這裡寫了一整段「這條負測構造不出來」的註解,而那是錯的**
    //    (codex K2 must-fix 3 給出構造,主對話 node v22.22.3 實測確認):
    //    · `İ`(U+0130)是合法 label 字元,`'İ'.repeat(100)` 恰 100 碼位 ⇒ 過得了 `normalizeLabel`。
    //    · `'İ'.toLowerCase()` 是 **`i` + U+0307 兩個碼位** ⇒ 小寫後的 label 有 **200** 碼位。
    //    · 於是 **101 碼位**的 `q`(= `i◌̇` ×50 + `i`)超過 `boundSupplierQuery` 的上限,
    //      但它仍是小寫 label 的**子字串** ⇒ 拿掉長度閘就會真的命中、真的把清單定位掉。
    //    ⇒ 有閘:2 列全顯示、無定位提示;無閘:縮成 1 列 + 「顯示全部」。**差異可觀察。**
    //    教訓:「構造不出負測」這句話本身就是一個需要被推翻的斷言,不是可以寫進註解的結論。
    const longLabel = 'İ'.repeat(100);
    listSuppliersForSettings.mockResolvedValue(
      sortSuppliersByLabel([
        { id: 'id-long', label: longLabel, is_active: true },
        { id: 'id-akoso', label: 'AKOSO', is_active: true },
      ]),
    );

    const { container } = await renderPage({
      r: 'duplicate',
      q: 'i̇'.repeat(50) + 'i',
    });

    expect(tableRowCount(container)).toBe(2);
    expect(container.textContent).not.toContain('顯示全部');
  });

  // 🔴 **明文不做:純空白的 `q` 在頁面層構造不出只紅它的負測**(codex K2 must-fix 2)。
  //    `boundSupplierQuery` 把空白收成 `null`;拿掉它之後 needle 是 `''`、`includes('')` 恆真
  //    ⇒ `located` = **全部** ⇒ `located.length < rows.length` 為 false ⇒ 一樣不進定位模式
  //    ⇒ 畫面逐字相同。上一版在這裡放了一條「空白 q 不進定位模式」的測試,它**照樣綠**,
  //    是我加 `< rows.length`(R1 nit)時把它自己的判別力吃掉的
  //    —— memory `feedback_new-fk-can-demote-an-existing-guard-to-unobservable` 的同型。
  //    ⇒ 空白那一半的判別力在 `lib/supplier-form.test.ts` 的直接單元測試;
  //      長度那一半由上面那條**真的測得到**,不要再把兩者混為一談。
});

describe('SupplierSettingsPage — 候選來源', () => {
  /** 候選清單的可見文字(錨定 aria-label,不數表格的手機卡片)。 */
  function candidateLabels(container: HTMLElement): string[] {
    return [
      ...container.querySelectorAll(
        `ul[aria-label="${SUPPLIER_CANDIDATE_LIST_LABEL}"] li`,
      ),
    ].map((node) => (node.textContent ?? '').replace('(已停用)', '').trim());
  }

  /** 新增表單 = 唯一沒有 `id` 欄位的那張 form(§3.3:新增路徑物理上餵不出 id)。 */
  function typeIntoCreateForm(container: HTMLElement, value: string) {
    const createForm = [...container.querySelectorAll('form')].find(
      (form) => form.querySelector('input[name="id"]') === null,
    );
    if (!createForm) throw new Error('找不到新增供應商表單(每張 form 都帶了 id)');
    const input = createForm.querySelector('input[name="label"]');
    if (!input) throw new Error('新增供應商表單缺少名稱輸入框');
    fireEvent.change(input, { target: { value } });
  }

  it('should keep the candidate order the read model handed over (16h 的順序那一半)', async () => {
    // 🔴 **順序只有在頁面層才證得了**(R1 must-fix 4):元件測試的 `rows` 是測試自己傳的,
    //    元件無從選來源。這裡的 `rows` 走的是頁面真正的那條路
    //    (`listSuppliersForSettings()` ⇒ 已經過 `sortSuppliersByLabel`)。
    //    ⇒ 頁面若對它再排一次、反轉、或改餵 `listSupplierRows()` 的原始列,本條轉紅。
    // 🔴 而且必須是**多筆**才有順序可言 —— 原本唯一那條候選斷言用 `AKOSO`(1 筆),
    //    順序在那裡是空轉的。
    const { container } = await renderPage();
    typeIntoCreateForm(container, 'Webike');

    const expected = filterSupplierCandidates(ROWS, 'Webike').map(
      (row) => row.label,
    );
    expect(expected).toHaveLength(3);
    expect(candidateLabels(container)).toEqual(expected);
  });

  it('should feed the typeahead the complete list even while the table is located', async () => {
    // 🔴 定位是為了讓員工看到「那一家」,不是把候選一起縮到一家 ——
    //    那會讓 typeahead 在撞名之後正好失效,而那正是最需要它的時候。
    //    ⇒ 表格 3 列的同時,打 `AKOSO` 仍要在候選裡看得到它。
    // 🔴 打字的目標**不能用裸 `input[name="label"]`** —— 那會抓到表格第一列的**改名**
    //    輸入框(它沒有 typeahead 狀態,打字什麼都不會發生 ⇒ 候選恆為空 = 假紅/假綠)。
    const { container } = await renderPage({ r: 'duplicate', q: 'Webike' });
    expect(tableRowCount(container)).toBe(3);

    typeIntoCreateForm(container, 'AKOSO');

    expect(candidateLabels(container)).toEqual(['AKOSO']);
  });
});
