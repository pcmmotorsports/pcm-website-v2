// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';

// 🔴 三個 action 都 import `supplier-repository` ⇒ `import 'server-only'` ⇒ 在 jsdom 直接炸。
//    mock 掉它們是為了讓元件渲染得起來,**不是**在測 action 行為
//    (action 那一層由 `supplier-actions.test.ts` / `supplier-actions-redirect.test.ts` 覆蓋)。
vi.mock('../../lib/supplier-actions', () => ({
  createSupplierAction: vi.fn(),
  renameSupplierAction: vi.fn(),
  setSupplierActiveAction: vi.fn(),
}));

// 🔴 同理:`supplier.ts` 為了 `sortSuppliersByLabel` 被 import 進來,而它 runtime import
//    `supplier-repository` ⇒ `import 'server-only'`。整支換掉(形狀同 `supplier.test.ts:5`)。
//    本檔只用排序,不碰讀取。
vi.mock('../../lib/supplier-repository', () => ({
  listSupplierRows: vi.fn(),
}));

import { sortSuppliersByLabel } from '../../lib/supplier';
import { filterSupplierCandidates } from '../../lib/supplier-candidates';
import type { SupplierRow } from '../../lib/supplier-repository';
import { SupplierCreateForm } from './supplier-create-form';
import {
  SUPPLIER_CANDIDATE_LIST_LABEL,
  SupplierLabelInput,
} from './supplier-label-input';
import { SupplierEditRow } from './supplier-edit-row';
import { SupplierTable } from './supplier-table';

// 向量取自母 plan §11 的真 seed 名單(26 家的子集),含中英混排與**一家已停用的 Webike EU**
// —— 停用那家是契約債②的送出前防線,拿掉它整組候選斷言就退回「只測啟用中的列」。
const RAW: readonly SupplierRow[] = [
  { id: 'id-webike-tw', label: 'Webike TW', is_active: true },
  { id: 'id-akoso', label: 'AKOSO', is_active: true },
  { id: 'id-webike-eu', label: 'Webike EU', is_active: false },
  { id: 'id-anfengda', label: '安豐達', is_active: true },
  { id: 'id-webike-jp', label: 'Webike JP', is_active: true },
  { id: 'id-wrs', label: 'WRS s.r.l', is_active: true },
];

// 🔴 **一律用排序後的名單當向量**:頁面餵給元件的是 `listSuppliersForSettings()` 的輸出,
//    而它已經過 `sortSuppliersByLabel`。用原始 `RAW` 當向量的話,
//    「候選順序」那條斷言就會鎖住 DB 回傳順序而不是畫面上真正的順序(plan §4:230-231)。
const ROWS: readonly SupplierRow[] = sortSuppliersByLabel(RAW);

afterEach(cleanup);

describe('SupplierTable', () => {
  it('should render the three declared columns and one mobile card per row', () => {
    const { container } = render(<SupplierTable rows={ROWS} />);
    const headers = [...container.querySelectorAll('th')].map(
      (node) => node.textContent,
    );

    expect(headers).toEqual(['供應商名稱', '狀態', '操作']);
    expect(container.querySelectorAll('ul li')).toHaveLength(ROWS.length);
  });

  it('should mark an inactive supplier with text, not colour or strike-through alone', () => {
    const { container } = render(<SupplierTable rows={ROWS} />);

    // 桌機 + 手機各渲染一次 ⇒ 至少兩處;純視覺的刪節線之外必須有可讀文字。
    expect(
      [...container.querySelectorAll('span')].filter(
        (node) => node.textContent === '已停用',
      ).length,
    ).toBeGreaterThanOrEqual(2);
    expect(container.querySelector('.line-through')?.textContent).toBe(
      'Webike EU',
    );
  });

  it('should not offer any delete affordance because suppliers cannot be deleted', () => {
    const { container } = render(<SupplierTable rows={ROWS} />);
    const buttonText = [...container.querySelectorAll('button')]
      .map((node) => node.textContent ?? '')
      .join('|');

    expect(buttonText).not.toContain('刪除');
    expect(buttonText).not.toContain('移除');
  });

  it('should keep the uuid out of the visible columns while still submitting it', () => {
    const { container } = render(<SupplierTable rows={ROWS} />);

    // uuid 對員工零意義 ⇒ 不列成欄位;但每張表單仍要帶得出它。
    expect(container.querySelector('code')).toBeNull();
    expect(
      container.querySelector('input[type="hidden"][name="id"]'),
    ).toBeTruthy();
  });

  it('should show the empty-state copy instead of an empty table', () => {
    const { container, getByText } = render(<SupplierTable rows={[]} />);

    expect(getByText('目前沒有供應商。用下方表單新增。')).toBeTruthy();
    expect(container.querySelector('table')).toBeNull();
  });
});

describe('SupplierEditRow', () => {
  const ACTIVE: SupplierRow = {
    id: 'id-akoso',
    label: 'AKOSO',
    is_active: true,
  };
  const INACTIVE: SupplierRow = {
    id: 'id-webike-eu',
    label: 'Webike EU',
    is_active: false,
  };

  it('should submit the active toggle as a literal true/false hidden field, never a checkbox', () => {
    // 🔴 這條釘的是 `supplier-form.ts` 的 `parseSupplierActiveForm` docblock 寫死的契約:`parseSupplierActiveForm`
    //    只收字面 'true'/'false'。原生 checkbox 送 'on'(勾)或**整個欄位缺席**(沒勾)
    //    ⇒ 每次切換都會拿到 `invalid`,而畫面上看起來完全正常。
    const { container } = render(<SupplierEditRow supplier={ACTIVE} />);
    const field = container.querySelector<HTMLInputElement>(
      'input[name="is_active"]',
    );

    expect(field?.type).toBe('hidden');
    expect(field?.value).toBe('false');
    expect(
      container.querySelector('input[type="checkbox"][name="is_active"]'),
    ).toBeNull();
  });

  it('should send the opposite of the current state for an inactive supplier', () => {
    const { container } = render(<SupplierEditRow supplier={INACTIVE} />);

    expect(
      container.querySelector<HTMLInputElement>('input[name="is_active"]')
        ?.value,
    ).toBe('true');
    // 第二張 form = 啟用切換(第一張是改名,它的按鈕是「儲存名稱」)。
    expect(
      container.querySelectorAll('form')[1]?.querySelector('button')
        ?.textContent,
    ).toBe('啟用');
  });

  it('should keep rename and active toggle in two independent forms', () => {
    // 合成一張的話,改名會連帶送出 is_active ⇒ 一次點擊變成兩件事、稽核也記成兩件事。
    const { container } = render(<SupplierEditRow supplier={ACTIVE} />);
    const forms = container.querySelectorAll('form');

    expect(forms).toHaveLength(2);
    expect(forms[0]?.querySelector('input[name="label"]')).toBeTruthy();
    expect(forms[0]?.querySelector('input[name="is_active"]')).toBeNull();
    expect(forms[1]?.querySelector('input[name="is_active"]')).toBeTruthy();
    expect(forms[1]?.querySelector('input[name="label"]')).toBeNull();
  });

  it('should warn that renaming rewrites the name shown on every past purchase', () => {
    // 🔴 驗收項,不是文案潤飾:母 plan §6:251-253(Sean Q1=A 知情選擇)——
    //    不存下單當時的名稱快照 ⇒ 改名會**追溯**改寫歷史採購的顯示名。
    //    「知情」的前提是按下去的人看得到,只寫在 plan 裡不算數。
    const { container } = render(<SupplierEditRow supplier={ACTIVE} />);

    expect(container.textContent).toContain(
      '改後,過去所有採購紀錄都會顯示新名字。',
    );
  });

  it('should cap the rename field at the same 100 chars the parser enforces', () => {
    const { container } = render(<SupplierEditRow supplier={ACTIVE} />);
    const label = container.querySelector<HTMLInputElement>(
      'input[name="label"]',
    );

    expect(label?.maxLength).toBe(100);
    expect(label?.required).toBe(true);
    expect(label?.defaultValue).toBe('AKOSO');
  });
});

describe('SupplierLabelInput', () => {
  function typeInto(container: HTMLElement, value: string) {
    const input = container.querySelector('input[name="label"]');
    if (!input) throw new Error('缺少供應商名稱輸入框');
    fireEvent.change(input, { target: { value } });
  }

  // 🔴 錨定在候選清單自己的 aria-label 上,不是任意 `li` —— 表格的手機卡片也是 `<ul><li>`,
  //    用裸 `li` 的話,把候選面板換成「整份名單」的退化實作在單獨渲染本元件時仍會全綠,
  //    而在頁面層(表格 + 候選同時存在)會數到兩者相加。
  function candidateNodes(container: HTMLElement): Element[] {
    return [
      ...container.querySelectorAll(
        `ul[aria-label="${SUPPLIER_CANDIDATE_LIST_LABEL}"] li`,
      ),
    ];
  }

  function shownCandidates(container: HTMLElement): string[] {
    return candidateNodes(container).map((node) =>
      (node.textContent ?? '').replace('(已停用)', '').trim(),
    );
  }

  it('should show exactly what the pure function returns, in the same order (16h)', () => {
    // 🔴 **本片唯一釘住「元件真的接到那支純函式」的斷言**(plan §5-16h)。
    //    期望值不是手寫的 3,而是**同一支函式對同一輸入的輸出** ——
    //    元件若自己另寫一套比對,兩邊就會分岔。
    // 🔴 **這裡的「順序」只證得了「元件不自己重排」**(R1 must-fix 4 更正):
    //    `rows` 是測試自己傳的 prop,元件無從選擇來源 ⇒ 「候選來源必須是
    //    `listSuppliersForSettings()` 的輸出」那一半(plan §4:230-231)在元件層**測不到**,
    //    它由 `app/settings/suppliers/page.test.tsx` 的順序那條負責。
    const { container } = render(<SupplierLabelInput rows={ROWS} />);
    typeInto(container, 'Webike');

    const expected = filterSupplierCandidates(ROWS, 'Webike');
    expect(expected).toHaveLength(3);
    expect(shownCandidates(container)).toEqual(
      expected.map((row) => row.label),
    );
  });

  it('should agree with the pure function on a lower-case query', () => {
    // 🔴 **這條才是「元件真的接到那支純函式」的判別力來源**,上一條不是:
    //    把元件改成自己寫 `row.label.includes(query)`(最可能的退化寫法)時,
    //    `'Webike'` 與 `'bike'` 兩個向量會得到**逐字相同**的結果 ⇒ 突變不掉。
    //    全小寫 `'webike'` 讓兩者分岔:純函式回 3 筆、裸 `includes` 回 0 筆。
    const { container } = render(<SupplierLabelInput rows={ROWS} />);
    typeInto(container, 'webike');

    const expected = filterSupplierCandidates(ROWS, 'webike');
    expect(expected).toHaveLength(3);
    expect(shownCandidates(container)).toEqual(
      expected.map((row) => row.label),
    );
  });

  it('should agree with the pure function on a query padded with zero-width spaces', () => {
    // 🔴 **這條殺的是另一族退化**(R1 must-fix 3 抓到我漏了它):
    //    把元件改成 `label.toLowerCase().includes(query.trim().toLowerCase())` ——
    //    帶 `toLowerCase` 的 inline 寫法 —— 對前面每一個向量都給出**逐字相同**的結果,
    //    因為那些向量本身都已經是 trim 過的。差別只在空白正規化那一把尺:
    //    `rpcTrim` 剝得掉 U+200B(31 碼位全集),JS `.trim()` **剝不掉**
    //    ⇒ 純函式回 3 筆、`.trim()` 版回 0 筆。
    const query = '​Webike​';
    const { container } = render(<SupplierLabelInput rows={ROWS} />);
    typeInto(container, query);

    const expected = filterSupplierCandidates(ROWS, query);
    expect(expected).toHaveLength(3);
    expect(shownCandidates(container)).toEqual(
      expected.map((row) => row.label),
    );
  });

  it('should agree with the pure function on a mid-string match too', () => {
    // 'bike' 只在字串**中段**命中 ⇒ 把比對偷改成前綴會讓本條轉紅(plan §5-16g)。
    const { container } = render(<SupplierLabelInput rows={ROWS} />);
    typeInto(container, 'bike');

    expect(shownCandidates(container)).toEqual(
      filterSupplierCandidates(ROWS, 'bike').map((row) => row.label),
    );
  });

  it('should include a disabled supplier in the candidates and label it', () => {
    // 契約債②的**送出前**防線:停用的同名照樣會讓 RPC 回 DUPLICATE_LABEL,
    // 員工若在候選裡看不到它,就只能在送出後才撞牆。
    const { container } = render(<SupplierLabelInput rows={ROWS} />);
    typeInto(container, 'Webike EU');

    expect(container.textContent).toContain('Webike EU');
    expect(container.textContent).toContain('(已停用)');
  });

  it('should stay silent for whitespace-only input including zero-width space', () => {
    // 🔴 用 `rpcTrim` 而不是 `.trim()`:改成 `.trim()` 的話,一個 U+200B 會被判為
    //    「有查詢字串」⇒ needle 是空 ⇒ `includes('')` 恆真 ⇒ 面板攤開整份名單。
    const { container } = render(<SupplierLabelInput rows={ROWS} />);

    typeInto(container, '   ');
    expect(candidateNodes(container)).toHaveLength(0);

    typeInto(container, '​');
    expect(candidateNodes(container)).toHaveLength(0);
  });

  it('should tell the employee when nothing matches instead of showing an empty box', () => {
    const { container } = render(<SupplierLabelInput rows={ROWS} />);
    typeInto(container, 'zzzz');

    expect(candidateNodes(container)).toHaveLength(0);
    expect(container.textContent).toContain(
      '名單裡沒有相符的供應商,送出後會建立成新的一家。',
    );
  });

  it('should not turn candidates into clickable pickers', () => {
    // Sean Q2=A:「啟用是要員工自己按的動作」。點一下把候選填回輸入框 =
    // 做一顆「按了保證撞 DUPLICATE_LABEL」的按鈕。
    const { container } = render(<SupplierLabelInput rows={ROWS} />);
    typeInto(container, 'Webike');

    expect(candidateNodes(container)).toHaveLength(3);
    expect(
      candidateNodes(container).filter(
        (node) => node.querySelector('button') ?? node.querySelector('a'),
      ),
    ).toHaveLength(0);
  });
});

describe('SupplierCreateForm', () => {
  const NEW_ROW: SupplierRow = {
    id: 'id-new',
    label: 'ZZ 新供應商',
    is_active: true,
  };

  function labelInput(container: HTMLElement) {
    return container.querySelector<HTMLInputElement>('input[name="label"]');
  }

  it('should clear the box after a successful create so it stops warning about itself', () => {
    // 🔴🔴 Fable R4 must-fix 1:soft navigation 讓 `useState` 活過 PRG redirect ⇒
    //    成功新增後輸入框還留著那個名字,而名單**現在含**那一家
    //    ⇒ 候選面板會在綠色「已新增供應商」底下寫「名單裡已經有這 1 家」。
    //    **每次成功新增都會發生**,不是邊緣情況。
    const { container, rerender } = render(
      <SupplierCreateForm rows={ROWS} resultCode={undefined} />,
    );
    const input = labelInput(container);
    if (!input) throw new Error('缺少新增供應商的名稱輸入框');
    fireEvent.change(input, { target: { value: 'ZZ 新供應商' } });

    // 新增成功 ⇒ PRG 帶回 `?r=created`,名單多一列。
    rerender(
      <SupplierCreateForm rows={[...ROWS, NEW_ROW]} resultCode='created' />,
    );

    expect(labelInput(container)?.value).toBe('');
    expect(container.textContent).not.toContain('名單裡已經有這');
  });

  it('should keep what the employee typed when someone else grew the list', () => {
    // 🔴🔴 **上一條的反向反例**(codex K2 must-fix 4),兩條缺一不可:
    //    A 打了字還沒送、B 先建好**別家** ⇒ A 送出撞名回 `duplicate`,列數卻已 `N→N+1`。
    //    若 key 只看列數,A 的輸入會被清空 —— **與「撞名要保留輸入讓他改一下再送」正好相反**。
    //    ⇒ key 只在 `resultCode === 'created'` 時才把列數當重建訊號;其餘一律 `'keep'`。
    const { container, rerender } = render(
      <SupplierCreateForm rows={ROWS} resultCode={undefined} />,
    );
    const input = labelInput(container);
    if (!input) throw new Error('缺少新增供應商的名稱輸入框');
    fireEvent.change(input, { target: { value: 'ZZ 新供應商' } });

    rerender(
      <SupplierCreateForm rows={[...ROWS, NEW_ROW]} resultCode='duplicate' />,
    );

    expect(labelInput(container)?.value).toBe('ZZ 新供應商');
  });

  it('should state the irreversibility before the employee submits', () => {
    const { container } = render(<SupplierCreateForm rows={ROWS} />);

    expect(container.querySelector('h2')?.textContent).toBe('新增供應商');
    expect(container.textContent).toContain('建立後不可刪除,只能改名或停用。');
    expect(
      container.querySelector<HTMLInputElement>('input[name="label"]')
        ?.maxLength,
    ).toBe(100);
  });
});
