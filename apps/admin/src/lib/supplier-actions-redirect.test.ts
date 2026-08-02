import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// supplier-actions-redirect.test.ts — S3b-2 的 **redirect 面**:撞名定位(Sean Q2=A)、
// 啟用切換的不可達碼、PRG 安全面。從 `supplier-actions.test.ts` 拆出。
// 🔴 拆檔理由是鐵則 6:codex 關卡2 的 3 條 must-fix 補下去會讓原檔 392 → 422 破 400。
//    依交接檔的教訓「先拆再加、不撐到 400 才處理」,先拆再補。
//    留在原檔的是:授權閘 / 解析閘 / 成功路徑 / 失敗分流 / log。

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  authorizeAdminMutation: vi.fn(),
  getRequestId: vi.fn(),
  createSupplier: vi.fn(),
  updateSupplier: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('./session/authorize', () => ({
  authorizeAdminMutation: mocks.authorizeAdminMutation,
}));
vi.mock('./audit/context', () => ({ getRequestId: mocks.getRequestId }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: vi.fn(),
}));

// 🔴 **只換掉兩支寫入函式,`SupplierCallerBugError` 用真的那一個。**
//    若在 mock 裡自己 `class SupplierCallerBugError extends Error {}`,
//    「bug 與 error 分得開」就變成自我實現:測試丟的是假 class、action 比對的也是同一個假 class,
//    真實作哪天改成不 extends Error 或改了 name,測試照樣全綠。
vi.mock('./supplier-repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./supplier-repository')>();
  return {
    ...actual,
    createSupplier: mocks.createSupplier,
    updateSupplier: mocks.updateSupplier,
  };
});

// 🔴 **解析器刻意不 mock** —— 驗收 2「解析失敗 ⇒ invalid 且 repository 零呼叫」若把解析器
//    也換成 mock,測到的是「假的 ok:false 會 redirect invalid」= 恆真,證不到真表單擋得住。
//    本檔一律餵真 FormData 走真解析器。
import {
  createSupplierAction,
  renameSupplierAction,
  setSupplierActiveAction,
} from './supplier-actions';

const PATH = '/settings/suppliers';
const TARGET_ID = '11111111-2222-3333-4444-555555555555';

function formOf(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const createForm = (label = 'AKOSO') => formOf({ label });
const renameForm = (label = '老吳車業', id = TARGET_ID) =>
  formOf({ id, label });
const activeForm = (isActive = 'false', id = TARGET_ID) =>
  formOf({ id, is_active: isActive });

/**
 * 取出 redirect 的**完整** URL 字串。
 * 🔴 刻意不用 `rejects.toThrow('NEXT_REDIRECT:/settings/suppliers?r=created')` ——
 *    `toThrow(string)` 是**子字串**比對,`?r=created&q=任何東西` 也會通過
 *    ⇒ 驗收 6「redirect 目標是寫死的常數、無額外參數面」會變成測不到的字面。
 *    改成整串 `toBe`,順便釘住「redirect 恰好被呼叫一次」。
 */
async function redirectUrlOf(action: Promise<void>): Promise<string> {
  await expect(action).rejects.toThrow('NEXT_REDIRECT');
  expect(mocks.redirect).toHaveBeenCalledTimes(1);
  return mocks.redirect.mock.calls[0]![0] as string;
}

function queryOf(url: string): URLSearchParams {
  return new URLSearchParams(url.slice(url.indexOf('?') + 1));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  });
  mocks.authorizeAdminMutation.mockResolvedValue({
    sid: 'sid-1',
    actorId: 'sean',
  });
  mocks.getRequestId.mockResolvedValue('req-1');
  mocks.createSupplier.mockResolvedValue('CREATED');
  mocks.updateSupplier.mockResolvedValue('UPDATED');
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── 驗收 4 + Sean Q2=A:撞名 ⇒ duplicate 且帶定位用的 q ──────────────
describe('supplier actions — 撞名定位', () => {
  beforeEach(() => {
    mocks.createSupplier.mockResolvedValue('DUPLICATE_LABEL');
    mocks.updateSupplier.mockResolvedValue('DUPLICATE_LABEL');
  });

  it('should redirect duplicate with the trimmed label as the locate query', async () => {
    const url = await redirectUrlOf(createSupplierAction(createForm('  Webike TW  ')));

    expect(url).toBe(`${PATH}?r=duplicate&q=Webike%20TW`);
    // 🔴 下面這行**沒有獨立判別力**(codex K2 R2 nit):上一行已把整串釘死。
    //    留著是診斷性的(失敗時直接看得到解碼結果),不得算成第二個證據面。
    expect(queryOf(url).get('q')).toBe('Webike TW');
    // 🔴 撞名**也**要重取:要定位的那一列可能是別的 session 剛建的,不重取就不在清單裡
    //    ⇒ Q2=A 的定位落空。少了本斷言,把 revalidatePath 移到 duplicate 分支之後仍全綠。
    expect(mocks.revalidatePath).toHaveBeenCalledWith(PATH);
  });

  // 🔴 Sean Q2=A 否決了「跳確認框直接啟用」⇒ **系統不代按**。
  //    撞名時本層除了那一次 create 之外不得再打任何寫入 —— 尤其不得偷偷把停用的那家啟用回來。
  it('should never issue a second write to reactivate the clashing row', async () => {
    await redirectUrlOf(createSupplierAction(createForm()));

    expect(mocks.createSupplier).toHaveBeenCalledTimes(1);
    expect(mocks.updateSupplier).not.toHaveBeenCalled();
  });

  it('should percent-encode a CJK label so it round-trips as a query value', async () => {
    const url = await redirectUrlOf(createSupplierAction(createForm('老吳精品')));

    expect(url).not.toContain('老吳精品'); // 真的編碼過,不是原字丟進 URL
    expect(queryOf(url).get('q')).toBe('老吳精品');
    expect(queryOf(url).get('r')).toBe('duplicate');
  });

  // 🔴🔴 參數注入:label 是使用者輸入,若沒編碼就串進 URL,`&r=denied` 會**覆寫結果碼**
  //    (`URLSearchParams.get('r')` 取第一個,但 Next 的 searchParams 對重複 key 會給陣列
  //    ⇒ 頁面端的 `typeof raw.r === 'string'` 會變成 false、banner 靜默消失)。
  it('should not let a label smuggle extra query parameters into the redirect', async () => {
    const hostile = 'A&r=denied#x?y';
    const url = await redirectUrlOf(createSupplierAction(createForm(hostile)));

    const params = queryOf(url);
    expect(params.get('r')).toBe('duplicate');
    expect(params.get('q')).toBe(hostile);
    expect([...params.keys()]).toEqual(['r', 'q']); // 恰兩個參數,沒有被塞進第三個
  });

  it('should use the rename-specific duplicate code, not the create one', async () => {
    // 🔴🔴 **兩條路的結果碼必須分開**(Fable R4 must-fix 2):
    //    新增那則的字面是「沒有**新增**」,在改名路徑上是錯的;而且 `?q=` 帶的是
    //    **新名字** ⇒ 清單篩到「佔用那個名字的別家」,**被改名的那一家(仍是舊名字)
    //    從畫面上消失** ⇒ 員工看到自己打的名字躺在表格裡,會讀成「改名成功了」。
    //    這條把「兩路共用同一個碼」釘死成會轉紅的事。
    const url = await redirectUrlOf(renameSupplierAction(renameForm('Webike JP')));

    expect(url).toBe(`${PATH}?r=duplicate_rename&q=Webike%20JP`);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(PATH);
    // 🔴 codex K2 R2 nit:撞名分支若額外再打一次 repository,redirect 仍正確 ⇒ 全綠。
    //    改名撞名時**只能有那一次 update、且絕不能走到新增**(否則就是替員工建了他沒要的那家)。
    expect(mocks.updateSupplier).toHaveBeenCalledTimes(1);
    expect(mocks.createSupplier).not.toHaveBeenCalled();
  });
});

// ── 切換啟用收到 DUPLICATE_LABEL = RPC 漂移,不是「名稱重複」──────────
describe('supplier actions — 啟用切換的不可達碼', () => {
  it('should treat DUPLICATE_LABEL on a toggle as drift, not as a name clash', async () => {
    mocks.updateSupplier.mockResolvedValue('DUPLICATE_LABEL');

    // 🔴 不映射成 duplicate:那句文案會叫員工去看「哪一家名稱重複」,而他根本沒改名字。
    //    不可達的理由見 `supplier-actions.ts` 該分支註解 —— **不是**「唯一性檢查不會執行」
    //    (RPC 沒有顯式檢查,是 UPDATE 撞 `suppliers_label_unique` 後 catch,而那個 UPDATE
    //    每次都寫 label ⇒ 約束一直在被評估);真理由是切換啟用時 label **值不變**、
    //    產不出新的衝突鍵。
    expect(await redirectUrlOf(setSupplierActiveAction(activeForm()))).toBe(
      `${PATH}?r=error`,
    );
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('理論上不可達'),
      expect.objectContaining({ target_id: TARGET_ID }),
    );
  });
});

// ── 驗收 6:PRG 安全面 ──────────────────────────────────────────────
describe('supplier actions — PRG 安全面', () => {
  // 🔴 釘成測試而不是靠「照抄 staff 沒問題」:表單多送 return_to / next,
  //    redirect 仍必須是那個寫死的站內常數,一個字都不多。
  // 🔴 codex K2 must-fix:注入矩陣原本**只測新增**一個 action ⇒ 哪天改名或切換啟用
  //    開始讀 `return_to` 之類的欄位,這裡不會紅。三個 action 都要釘。
  const SMUGGLED: ReadonlyArray<readonly [string, string]> = [
    ['return_to', 'https://evil.example/steal'],
    ['next', '//evil.example'],
    ['r', 'denied'],
    ['q', 'injected'],
  ];
  const TARGETS = [
    ['create', createForm, createSupplierAction, 'created'],
    ['rename', renameForm, renameSupplierAction, 'saved'],
    ['active', activeForm, setSupplierActiveAction, 'saved'],
  ] as const;

  it.each(
    TARGETS.flatMap(([name, build, invoke, code]) =>
      SMUGGLED.map(
        ([field, value]) => [name, field, value, build, invoke, code] as const,
      ),
    ),
  )(
    'should ignore a %s form field named %s',
    async (_name, field, value, build, invoke, code) => {
      const data = build();
      data.set(field, value);

      expect(await redirectUrlOf(invoke(data))).toBe(`${PATH}?r=${code}`);
    },
  );

  // 🔴 本條被本檔多處「完整 URL toBe」嚴格蘊含(codex K2 R2 nit)——
  //    留著是為了讓「絕不可以是跨站」這個**意圖**在檔案裡看得見,
  //    但它不是獨立證據,刪掉不會讓任何實作退化漏網。
  it('should always redirect to a same-site absolute path', async () => {
    const url = await redirectUrlOf(createSupplierAction(createForm()));

    expect(url.startsWith('/settings/suppliers?')).toBe(true);
    expect(url.startsWith('//')).toBe(false); // protocol-relative = 跨站
  });
});
