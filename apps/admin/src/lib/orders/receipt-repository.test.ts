import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({ rpc: mocks.rpc, from: mocks.from }),
}));

import { readFileSync } from 'node:fs';
import {
  RECEIPT_DELETE_RESULT_CODES,
  RECEIPT_RECORD_RESULT_CODES,
  ReceiptCallerBugError,
  deleteItemReceipt,
  findDuplicateOutcome,
  findProcurementRemaining,
  findReceiptIdByRequestId,
  listOrderItemReceipts,
  listProcurementChoices,
  recordItemReceipt,
  ORDER_RECEIPT_ROWS_LIMIT,
  findOrderItemIdForReceipt,
} from './receipt-repository';

const ARGS = {
  procurementId: 'p-1',
  quantity: 2,
  surplusQuantity: 0,
  receivedAt: '2026-08-11T10:30:00+08:00',
  note: null,
  actor: 'staff-1',
  requestId: 'k-1',
};

beforeEach(() => vi.clearAllMocks());

describe('recordItemReceipt — 固定碼窮盡收斂', () => {
  /**
   * ⟦mail-ITEACHSHRINK⟧ **這個 `it.each` 的分母來自【被測物自己】** ——
   * 拿掉 `RECEIPT_RECORD_RESULT_CODES` 的一項, 它**只是少跑一格, 全綠**(板列有實錘)。
   * ✅ 一格寫死的長度**兩個方向都擋得住**(2026-09-07 `-mail` 在 `receipt-repository` 實測:
   *    少一項 ⇒ 紅 1 · 多一項 ⇒ 紅 1 · 沒有這一格而少一項 ⇒ **rc=0 全綠**)。
   * 🔴 **`11` 必須寫死** —— 從 `RECEIPT_RECORD_RESULT_CODES.length` 取就是拿它驗它自己, 那一格恆綠。
   * ⚠️ 它擋的是【項數】不是【成員】:換掉一項換成另一項, 長度不變 ⇒ 這一格不會叫。
   *
   * ⚠️ **它答什麼 / 答不出什麼**(2026-09-07 A 派補齊):
   *   **答**:`RECEIPT_RECORD_RESULT_CODES` 的**項數變了**(增或刪, 兩個方向都會紅)。
   *   **答不出**:① **成員換掉**(A 換成 B, 長度不變)② 那些成員的**值對不對**
   *     ③ 那個常數與**正式庫的封閉集**對不對得上(那要另一把尺)。
   * 🟢 ⛔ ~~**一個會讓它假綠的世界**:有人**同時**刪一項、加一項 ⇒ 長度不變 ⇒ 它一聲都不吭~~
   *   🟢 **[2026-09-07 當天關掉了]** 這一格已從【釘長度】升級成【釘成員】
   *   ⇒ 換一項**會紅**(實測:各餵一發「刪一項 + 加一項」, 三支都紅在這一格)。
   * 🔴 **而【還沒關掉】的是這個, 寫成一個問句**:
   *   ❓ **「這份寫死的成員, 與【正式庫那一側的封閉集】現在還對得上嗎?」**
   *   🛑 這一格答不出它 —— 右邊是**測試裡的一份靜態清單**, 兩邊各自改, 它**不會叫**。
   *   ⏰ **什麼時候要回來讀這一段(綁時點, 不是綁心情)**:
   *     **有人改動 item_receipts 那支 RPC 的回傳碼 那一側的定義(CHECK / enum / RAISE 的碼)的那一趟。**
   *     ⇒ 那一趟請當場回答上面那個問句;答不出來就別假設它還對。
   *   ✅ **關得掉它的形狀**:右邊換成一個**會自己長大的全集**
   *     (例 `Record<Union, …>` —— union 加一個成員, TypeScript 逼你補;
   *      做法見 `packages/adapters/src/email/SupabaseEmailOutboxAdapter.test.ts`)。
   */
  it('⟦mail-ITEACHSHRINK⟧ RECEIPT_RECORD_RESULT_CODES 成員逐一釘死 —— 增 / 刪 / 換都要有人看見', () => {
    /**
     * 🔴🔴 **[2026-09-07 從【釘長度】升級成【釘成員】]** —— 主視窗 B 裁。
     * ⛔ ~~`expect(RECEIPT_RECORD_RESULT_CODES).toHaveLength(11);`~~
     *    🛑 那擋不住「**同時刪一項、加一項**」:長度不變 ⇒ 一聲都不吭, 而 `it.each` 的格數也不變。
     *    (那正是這一格自己「答不出什麼」那一段寫過的假綠世界 —— 現在把它關掉。)
     * 🔴 **右邊這份成員【寫死在測試裡】**, 與被測物是兩份東西 ⇒ 改任一邊都會紅。
     *    ⚠️ 代價:**加一個碼要改兩個地方** —— 而那正是要的(那是一次要被看見的改動)。
     * 🔵 排序後比 —— 順序不是這一格要守的東西。
     */
    expect([...RECEIPT_RECORD_RESULT_CODES].sort()).toEqual([
      'DUPLICATE_REQUEST',
      'EXCEEDS_ROOM_AFTER_CANCELLATION',
      'INVALID_QUANTITY',
      'NOTE_TOO_LONG',
      'PROCUREMENT_NOT_FOUND',
      'PROCUREMENT_VOIDED',
      'QUANTITY_EXCEEDS_ALLOCATED',
      'RECEIVED_AT_IN_FUTURE',
      'RECEIVED_AT_OUT_OF_RANGE',
      'RECEIVED_AT_REQUIRED',
      'RECORDED',
    ]);
  });

  it.each(RECEIPT_RECORD_RESULT_CODES)('%s 原樣回傳', async (code) => {
    mocks.rpc.mockResolvedValue({ data: code, error: null });
    await expect(recordItemReceipt(ARGS)).resolves.toBe(code);
  });

  // 🔴🔴 R1 Important 4 突變③:拿掉 `RECORD_CODE_SET.has(data)` ⇒ 未知碼被當成功回傳。
  //    這是本片最貴的失敗形狀:「到貨沒記進去」長得跟成功一模一樣 —— instock 不動、
  //    出貨彈窗照樣說「未到貨」,而員工已經看到綠色橫幅了。
  it.each([
    ['未知碼(RPC 漂移)', 'SOMETHING_NEW'],
    ['null', null],
    ['數字', 42],
    ['物件', { ok: true }],
    ['空字串', ''],
  ])('🔴 %s ⇒ 拋 CallerBugError,**不得**當成功', async (_label, data) => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    await expect(recordItemReceipt(ARGS)).rejects.toBeInstanceOf(ReceiptCallerBugError);
  });

  it('逐欄具名送(不 spread、不漏欄)', async () => {
    mocks.rpc.mockResolvedValue({ data: 'RECORDED', error: null });
    await recordItemReceipt({ ...ARGS, note: '外箱破損' });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_record_item_receipt', {
      p_procurement_id: 'p-1',
      p_quantity: 2,
      p_surplus_quantity: 0,
      p_received_at: '2026-08-11T10:30:00+08:00',
      p_note: '外箱破損',
      p_actor: 'staff-1',
      p_request_id: 'k-1',
    });
  });
});

describe('recordItemReceipt — RAISE 分類', () => {
  it.each(['P0001', 'P2B02'])('%s ⇒ 呼叫端 bug', async (code) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: 'x' } });
    await expect(recordItemReceipt(ARGS)).rejects.toBeInstanceOf(ReceiptCallerBugError);
  });

  // 🔴 其他 SQLSTATE **不得**被認領成「已知的呼叫端 bug」—— 認領了就等於把真正的異常
  //    (例如未被翻譯的守門)包裝成一句「請重新整理」,而它需要的是進通用 error 被看見。
  it.each(['23514', '40P01', 'PGRST301'])('%s ⇒ 原樣往上拋,不當 bug', async (code) => {
    const raw = { code, message: 'x' };
    mocks.rpc.mockResolvedValue({ data: null, error: raw });
    await expect(recordItemReceipt(ARGS)).rejects.toBe(raw);
  });
});

describe('findDuplicateOutcome', () => {
  /**
   * 兩次 `.from()` 依序回傳:冪等帳、receipt 本體。
   * 🔴 **把 table / select / eq 的參數記下來**(R2 nit):上一版 `eq: () => …` 直接吃掉參數
   * ⇒「到底查了哪一張表的哪一欄」從來沒被斷言,把 `request_id` 打成 `receipt_id` 也全綠。
   */
  const calls: { table: string; column: string; value: unknown }[] = [];
  function chain(ledger: unknown, receipt: unknown) {
    const make = (data: unknown, table: string) => ({
      select: () => ({
        eq: (column: string, value: unknown) => {
          calls.push({ table, column, value });
          return { maybeSingle: async () => ({ data, error: null }) };
        },
      }),
    });
    mocks.from
      .mockImplementationOnce((t: string) => make(ledger, t))
      .mockImplementationOnce((t: string) => make(receipt, t));
  }

  beforeEach(() => {
    calls.length = 0;
    mocks.from.mockReset();
  });

  it('查的是冪等帳的 request_id,再拿 receipt_id 查 receipt 本體', async () => {
    chain({ receipt_id: 'r-1' }, { id: 'r-1' });
    await findDuplicateOutcome('k-1');
    expect(calls).toEqual([
      { table: 'order_item_receipt_requests', column: 'request_id', value: 'k-1' },
      { table: 'order_item_procurement_receipts', column: 'id', value: 'r-1' },
    ]);
  });

  // 🔴 查詢炸掉**不可以**被吞成某個結論 —— 呼叫端(action)要自己決定退到哪裡,
  //    在這一層靜默回 'unknown' 會讓「查不到」與「查壞了」永遠分不出來。
  it.each([
    ['冪等帳查詢炸掉', true],
    ['receipt 查詢炸掉', false],
  ])('%s ⇒ 原樣拋,不吞', async (_label, ledgerFails) => {
    const boom = { message: 'boom' };
    const ok = (data: unknown) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data, error: null }) }) }),
    });
    const bad = () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: boom }) }) }),
    });
    if (ledgerFails) mocks.from.mockImplementationOnce(bad);
    else mocks.from.mockImplementationOnce(() => ok({ receipt_id: 'r-1' })).mockImplementationOnce(bad);
    await expect(findDuplicateOutcome('k-1')).rejects.toBe(boom);
  });

  it('產物還在 ⇒ alive', async () => {
    chain({ receipt_id: 'r-1' }, { id: 'r-1' });
    await expect(findDuplicateOutcome('k-1')).resolves.toBe('alive');
  });

  // 🔴 這條是 `DUPLICATE_DELETED` 文案的來源:帳本列不可刪、receipt 可刪
  //    ⇒ 鍵查得到但產物查不到 = 先前登錄過、後來被刪、而且**沒有**重新建立。
  it('帳本有鍵但產物查不到 ⇒ deleted', async () => {
    chain({ receipt_id: 'r-1' }, null);
    await expect(findDuplicateOutcome('k-1')).resolves.toBe('deleted');
  });

  it('連鍵都查不到 ⇒ unknown(退回保守文案,不猜)', async () => {
    chain(null, null);
    await expect(findDuplicateOutcome('k-1')).resolves.toBe('unknown');
  });
});

describe('findProcurementRemaining', () => {
  // 🔴 `vi.clearAllMocks()` **不會清掉 `mockImplementationOnce` 的佇列** ——
  //    上面兩個 describe 排進去的 once 實作會殘留到這裡、把第一次 `.from()` 吃掉。
  //    (第一版就是這樣紅的:三格全回 null。)⇒ 這裡明確 reset 再裝。
  beforeEach(() => mocks.from.mockReset());

  function row(data: unknown, error: unknown = null) {
    mocks.from.mockImplementation(() => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data, error }) }) }),
    }));
  }

  it('回 allocated − received', async () => {
    row({ allocated_quantity: 5, received_quantity: 2 });
    await expect(findProcurementRemaining('p-1')).resolves.toBe(3);
  });

  // 查無 ⇒ null,讓呼叫端「不給數字」而不是給一個編出來的 0
  it('查無 ⇒ null', async () => {
    row(null);
    await expect(findProcurementRemaining('p-1')).resolves.toBeNull();
  });

  it('查詢炸掉 ⇒ 原樣拋(呼叫端自己 catch 成不給建議)', async () => {
    const boom = { message: 'boom' };
    row(null, boom);
    await expect(findProcurementRemaining('p-1')).rejects.toBe(boom);
  });
});

// ── `#476` 片4:「貨到了」選單不得列出已作廢的採購 ────────────────────────
// ⚠️ 名稱只講**本檔證得到**的事:這三格量的是「送出去的查詢參數」,mock 不會真的過濾。
//    「作廢的採購不會出現在選單上」是 DB 那一側的行為,本檔證不到(自己的 §②-a 判準)。
describe('listProcurementChoices — 查詢帶 voided_at IS NULL(#476 片4)', () => {
  /** 串接式 query builder 的 mock:每一段都回自己,最後一段回資料。 */
  function builder(rows: unknown[]) {
    const calls: Array<[string, unknown[]]> = [];
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'is', 'order']) {
      chain[m] = vi.fn((...args: unknown[]) => {
        calls.push([m, args]);
        return m === 'order' ? { data: rows, error: null } : chain;
      });
    }
    return { chain, calls };
  }

  // 🔴 **行為格,不是掃字面**:掃 `RAW.includes(".is('voided_at', null)")` 擋得住「整段被刪」,
  //    擋不住「呼叫了但參數寫錯」(例如 `.is('voided_at', false)` 或 filter 掛錯欄)。
  //    ⇒ 直接量**真的送出去的那組參數**。
  it('🔴 查詢帶 voided_at IS NULL(參數逐字比對,不只是「有呼叫」)', async () => {
    const { chain, calls } = builder([]);
    mocks.from.mockReturnValue(chain);
    await listProcurementChoices('item-1');
    const isCall = calls.find(([m]) => m === 'is');
    expect(isCall, '沒有 .is(…) ⇒ 作廢列會進選單').toBeTruthy();
    expect(isCall![1]).toEqual(['voided_at', null]);
  });

  it('品項 id 那道 filter 沒有被順手弄壞(改一處不得掉另一處)', async () => {
    const { chain, calls } = builder([]);
    mocks.from.mockReturnValue(chain);
    await listProcurementChoices('item-1');
    expect(calls.find(([m]) => m === 'eq')![1]).toEqual(['order_item_id', 'item-1']);
  });

  it('回傳形狀不變(加 filter 不該動到映射)', async () => {
    const { chain } = builder([
      { id: 'p-1', allocated_quantity: 3, received_quantity: 1, suppliers: { label: 'RPM Carbon' } },
    ]);
    mocks.from.mockReturnValue(chain);
    await expect(listProcurementChoices('item-1')).resolves.toEqual([
      { procurementId: 'p-1', supplierLabel: 'RPM Carbon', allocatedQuantity: 3, receivedQuantity: 1 },
    ]);
  });
});

// ── #352-b-2 I1 第三道:逐欄具名 select(不得 `*`)──────────────────────
describe('listProcurementChoices — 欄位白名單', () => {
  // 🔴 **掃原始碼**:這一條擋的是「日後有人加欄時**自動**把它送到 client」,
  //    而那件事在行為測試裡看不到(mock 回什麼就是什麼)⇒ 只能在文字層釘。
  //    ⚠️ 它擋不住「有人具名多加一個敏感欄」——那要靠 review;這裡守的是 `*` 這個**類別**的錯。
  const RAW = readFileSync(new URL('./receipt-repository.ts', import.meta.url), 'utf8');

  it('🔴 採購列查詢逐欄具名,沒有 select(\'*\')', () => {
    const line = RAW.split('\n').find((l) => l.includes(".from('order_item_procurement')"));
    expect(line, "找不到採購列查詢 —— 這格的錨點沒了,不是通過").toBeTruthy();
    expect(RAW).not.toMatch(/\.select\(\s*['"`]\*/);
  });

  it('🔴 回傳形狀不含價格類欄名', () => {
    // 🔴 **分母守門(2026-08-29 突變量到本格恆綠)**:`RAW` 讀空時 `filter` 回 `[]`
    //    ⇒ `toEqual([])` 恆真 ⇒「檔裡沒有價格欄名」與「這個檔根本沒讀到」印同一個綠。
    //    🔴 這一格守的是**收據 repository 的回傳形狀不得帶價格欄** —— 帶了就會流到畫面上。
    // 🔴 **錨要證明【讀到的是這一支檔】**(2026-08-29 code-reviewer R1):
    //    `toContain('export')` 任何一支 TS 檔都滿足 ⇒ 把讀檔路徑指到兄弟檔它照樣過,
    //    而 banned 掃描對 receipt-repository.ts 完全落空。
    expect(RAW, '讀到的不是 receipt-repository.ts ⇒ 下面那條什麼都沒證明').toContain(
      "from('order_item_procurement')",
    );
    const banned = ['unit_price', 'line_total', 'price', 'cost', 'amount'];
    const hit = banned.filter((w) => RAW.includes(w));
    expect(hit, `receipt-repository.ts 出現價格欄名:${hit.join(', ')}`).toEqual([]);
  });
});

// ── 「改軟」線片 1:撤銷到貨 ────────────────────────────────────────────
describe('deleteItemReceipt — 三類結果嚴格分開', () => {
  const DEL = { receiptId: 'r-1', actor: 'staff-1', requestId: 'req-1' };

  /**
   * DB 原文的形狀。**這是手抄的副本,不是從正式庫撈的** ——
   * 來源 = `supabase/migrations/20260810233000_m4b_e10_352a2_receipt_write_rpcs.sql:428-433`
   * (那段 RAISE 的註解也指回本 fixture)。改那段 SQL 的訊息時要回來對一次;
   * 🔴 刻意**不做自動同步**:自動抓字串會讓「訊息被改壞」也一起同步過來、守門變恆真。
   */
  const P4A03_MESSAGE =
    '刪不掉這筆到貨紀錄:刪掉之後這個品項的可出數量會不夠。\n' +
    '已出貨 1 件、已裝進尚未出貨的包裹 2 件,而刪除後只剩 2 件。\n' +
    '尚未出貨的包裹:\n  K7X2MP:1 件\n  M3QQ8Z:1 件\n' +
    '要先把那些包裹作廢、或從包裹裡移除這個品項,才能刪掉這筆到貨紀錄。';

  // ══ 撤銷理由(2026-09-17)══════════════════════════════════════════════════
  // 🔴 **這三格守的是【送不送那個 key】,不是送什麼值。**
  //    RPC 的 `p_reason` 有 `DEFAULT NULL` ⇒ **不送 key** 走的是預設值那條路,
  //    與舊版三參數呼叫完全同一條。
  //    ⇒ 🛑 **送 `p_reason: null` 不等於不送** —— 前者會讓「舊碼呼叫」這個形狀消失,
  //      而它在 diff 上與「不送」長得幾乎一樣。
  //
  // 🔴 **`DEFAULT NULL` 只買到「板先貼 / 碼還沒推」那一半**(R2 F1, 2026-09-17)。
  //    ⛔ ~~「部署兩個方向都叫得動」~~ —— 這句原本住在這裡,而它是**假的**:
  //      反方向(碼先推 / 板還沒貼 + 員工填了理由)會送出 `p_reason` ⇒ 四參簽章配不到
  //      ⇒ PGRST202 ⇒ 撤銷失敗而東西沒撤。**`DEFAULT` 只救「少送」,救不了「多送」。**
  //    ✅ 兩個方向現在**真的**都通了, 而成立的理由是
  //      `receipt-repository.ts` 的 **fail-soft 那一段**(`isReasonSignatureMissing` ⇒ 不帶 key 重打),
  //      **不是** `DEFAULT NULL`。守它的是下面那一格「舊庫 + 有填理由 ⇒ 撤銷仍然成功」。
  //    📌 這句話被 R1 在隔壁檔改掉、而**原樣留在這裡繼續當通行證**, R2 才抓到。
  //      ⇒ **修這類假字面要先 `grep` 全 repo 找同族, 一次修完。**
  it('🔵 沒填理由 ⇒ 【整個 p_reason key 不送】(走 RPC 的 DEFAULT NULL)', async () => {
    mocks.rpc.mockResolvedValue({ data: 'DELETED', error: null });
    await deleteItemReceipt(DEL);
    const payload = mocks.rpc.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(Object.hasOwn(payload, 'p_reason'), '沒填卻送了 p_reason ⇒ 舊碼那條路的形狀被改掉了').toBe(
      false,
    );
    expect(payload.p_request_id).toBe('req-1');
  });

  it('🔵 空字串也當作沒填 ⇒ 一樣不送', async () => {
    mocks.rpc.mockResolvedValue({ data: 'DELETED', error: null });
    await deleteItemReceipt({ ...DEL, reason: '' });
    const payload = mocks.rpc.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(Object.hasOwn(payload, 'p_reason')).toBe(false);
  });

  it('🔴 有填 ⇒ 原樣送過去,【這一層不 trim 也不截斷】(正規化只有 RPC 那一套)', async () => {
    mocks.rpc.mockResolvedValue({ data: 'DELETED', error: null });
    const raw = '  客人說要換規格  ';
    await deleteItemReceipt({ ...DEL, reason: raw });
    const payload = mocks.rpc.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(payload.p_reason, '這一層動了字 ⇒ 前後端會有兩套正規化, 而它們遲早不一樣').toBe(raw);
  });

  // ══ 🔴 部署間隙的 fail-soft(R2 F2, Sean 2026-09-17 拍甲)══════════════════
  // **這五格守的是【行為】不是【有沒有那段程式】**:
  //   把 `receipt-repository.ts` 的 fail-soft 那一段拿掉 ⇒ 第一格會紅(撤銷變成 throw)。
  // 🛑 而它同時守**射程不可以變寬** —— 後面四格各自釘住一個「**不准**退」的方向。
  //    一個吃掉所有錯誤的重試, 會把真故障變成靜默重試, 那比原本的病更難查。

  /** PostgREST 在「參數名配不到任何一支多載」時回的碼(= 板還沒貼 / cache 沒刷)。 */
  const PGRST202 = { code: 'PGRST202', message: 'Could not find the function public.admin_delete_item_receipt(p_actor, p_receipt_id, p_reason, p_request_id) in the schema cache' };
  /** cache 記得四參、DB 已回滾成三參 ⇒ PG 說本函式不存在。 */
  const PG42883_SELF = { code: '42883', message: 'function admin_delete_item_receipt(uuid, text, text, text) does not exist' };

  it('🔴 舊庫 + 有填理由 ⇒ 【撤銷仍然成功】,只是理由沒存進去', async () => {
    // 🔴 `vi.clearAllMocks()`【不會】清掉 `...Once` 的佇列(本檔 :210 早就記著這個坑)
    //    ⇒ 上一格沒被消耗掉的 Once 會漏進這一格 ⇒ 突變時紅的格數會多、訊號不可信。
    mocks.rpc.mockReset();
    mocks.rpc
      .mockResolvedValueOnce({ data: null, error: PGRST202 })
      .mockResolvedValueOnce({ data: 'DELETED', error: null });
    await expect(deleteItemReceipt({ ...DEL, reason: '客人說要換規格' })).resolves.toEqual({
      kind: 'code',
      code: 'DELETED',
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    const retry = mocks.rpc.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(Object.hasOwn(retry, 'p_reason'), '重打那一發還帶著 p_reason ⇒ 會再撞一次同樣的錯').toBe(
      false,
    );
    expect(retry.p_receipt_id).toBe(DEL.receiptId);
    expect(retry.p_request_id).toBe('req-1');
  });

  it('🔴 42883【點名本函式】(板已回滾)⇒ 一樣退一次', async () => {
    // 🔴 `vi.clearAllMocks()`【不會】清掉 `...Once` 的佇列(本檔 :210 早就記著這個坑)
    //    ⇒ 上一格沒被消耗掉的 Once 會漏進這一格 ⇒ 突變時紅的格數會多、訊號不可信。
    mocks.rpc.mockReset();
    mocks.rpc
      .mockResolvedValueOnce({ data: null, error: PG42883_SELF })
      .mockResolvedValueOnce({ data: 'DELETED', error: null });
    await expect(deleteItemReceipt({ ...DEL, reason: '理由' })).resolves.toEqual({
      kind: 'code',
      code: 'DELETED',
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it('🛑 42883 但【沒點名本函式】(函式體內叫到別的不存在函式)⇒ 不准退,要炸出來', async () => {
    // 🔴 `vi.clearAllMocks()`【不會】清掉 `...Once` 的佇列(本檔 :210 早就記著這個坑)
    //    ⇒ 上一格沒被消耗掉的 Once 會漏進這一格 ⇒ 突變時紅的格數會多、訊號不可信。
    mocks.rpc.mockReset();
    const other = { code: '42883', message: 'function some_other_helper(uuid) does not exist' };
    mocks.rpc.mockResolvedValue({ data: null, error: other });
    await expect(deleteItemReceipt({ ...DEL, reason: '理由' })).rejects.toMatchObject({
      code: '42883',
    });
    expect(mocks.rpc, '把別的函式不存在也吞掉 ⇒ 真故障變成靜默重試').toHaveBeenCalledTimes(1);
  });

  it('🛑 【沒填理由】卻配不到簽章 ⇒ 不准退(退一次也不會變好,那是別的問題)', async () => {
    // 🔴 `vi.clearAllMocks()`【不會】清掉 `...Once` 的佇列(本檔 :210 早就記著這個坑)
    //    ⇒ 上一格沒被消耗掉的 Once 會漏進這一格 ⇒ 突變時紅的格數會多、訊號不可信。
    mocks.rpc.mockReset();
    mocks.rpc.mockResolvedValue({ data: null, error: PGRST202 });
    await expect(deleteItemReceipt(DEL)).rejects.toMatchObject({ code: 'PGRST202' });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('🛑 其他錯誤(有填理由也一樣)⇒ 不准退', async () => {
    // 🔴 `vi.clearAllMocks()`【不會】清掉 `...Once` 的佇列(本檔 :210 早就記著這個坑)
    //    ⇒ 上一格沒被消耗掉的 Once 會漏進這一格 ⇒ 突變時紅的格數會多、訊號不可信。
    mocks.rpc.mockReset();
    const boom = { code: '57014', message: 'canceling statement due to statement timeout' };
    mocks.rpc.mockResolvedValue({ data: null, error: boom });
    await expect(deleteItemReceipt({ ...DEL, reason: '理由' })).rejects.toMatchObject({
      code: '57014',
    });
    expect(mocks.rpc, 'fail-soft 吃成「任何錯都重打」⇒ 逾時被重試, 而畫面說成功').toHaveBeenCalledTimes(
      1,
    );
  });

  it('三個固定碼原樣回傳', async () => {
    for (const code of RECEIPT_DELETE_RESULT_CODES) {
      mocks.rpc.mockResolvedValueOnce({ data: code, error: null });
      await expect(deleteItemReceipt(DEL)).resolves.toEqual({ kind: 'code', code });
    }
  });

  it('🔴🔴 P4A03 = 業務拒絕:訊息**一個字都不准少**(硬條款)', async () => {
    // 🔴 這格守的是原作者交辦的那條:DB 訊息逐箱列出包裹編號與件數,是員工唯一能照做的資訊。
    //    在這層做任何 slice / 改寫(同檔 `recordItemReceipt` 就有 `.slice(0, 200)` 的前例)
    //    都會把它切掉,而 UI 那 7 格因為 mock 掉 action **照樣全綠** —— 所以這格必須在這裡。
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: 'P4A03', message: P4A03_MESSAGE },
    });
    const out = await deleteItemReceipt(DEL);
    expect(out).toEqual({ kind: 'blocked', message: P4A03_MESSAGE });
    if (out.kind !== 'blocked') throw new Error('unreachable');
    expect(out.message, '包裹清單被切掉了').toContain('M3QQ8Z');
    expect(out.message.length, `訊息被截短:${out.message.length} < ${P4A03_MESSAGE.length}`).toBe(
      P4A03_MESSAGE.length,
    );
  });

  it('🔴 P0001 / P2B02 = 呼叫端 bug,拋 `ReceiptCallerBugError`(不得回成功)', async () => {
    for (const code of ['P0001', 'P2B02']) {
      mocks.rpc.mockResolvedValueOnce({ data: null, error: { code, message: 'x' } });
      await expect(deleteItemReceipt(DEL)).rejects.toBeInstanceOf(ReceiptCallerBugError);
    }
  });

  it('🔴 未知碼一律拋,**不得靜默當成功**(「以為撤掉了、其實沒撤」)', async () => {
    mocks.rpc.mockResolvedValue({ data: 'SOMETHING_NEW', error: null });
    await expect(deleteItemReceipt(DEL)).rejects.toBeInstanceOf(ReceiptCallerBugError);
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } });
    await expect(deleteItemReceipt(DEL)).rejects.toBeTruthy();
  });

  it('🔴 參數逐欄具名送(欄名錯了 RPC 會吃到 null)', async () => {
    mocks.rpc.mockResolvedValue({ data: 'DELETED', error: null });
    await deleteItemReceipt(DEL);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_delete_item_receipt', {
      p_receipt_id: 'r-1',
      p_actor: 'staff-1',
      p_request_id: 'req-1',
    });
  });
});

describe('findReceiptIdByRequestId — 撤銷唯一拿得到 receipt id 的路', () => {
  function ledger(data: unknown, error: unknown = null) {
    mocks.from.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data, error }) }) }),
    });
  }

  it('查到就回 id', async () => {
    ledger({ receipt_id: 'r-9' });
    await expect(findReceiptIdByRequestId('k-1')).resolves.toBe('r-9');
  });

  it('🔴 查無回 null(呼叫端要當「這把鍵沒登錄成功過」,不是「本來有、現在沒了」)', async () => {
    ledger(null);
    await expect(findReceiptIdByRequestId('k-1')).resolves.toBeNull();
  });

  it('🔴 查詢本身失敗要拋,不得回 null(fail-closed:回 null 會被讀成查無)', async () => {
    ledger(null, { message: 'boom' });
    await expect(findReceiptIdByRequestId('k-1')).rejects.toBeTruthy();
  });
});

// ── `#450` 逐筆到貨列表:它唯一的資料來源 ────────────────────────────
// 🔴🔴 **本片修的病就是「靜默少列」** ⇒ 這一組驗的不是「有沒有撈到」,
//    是**撈不全的時候它會不會說**。少了它們, 這支函式的每一條少列路徑都零訊號。
describe('listOrderItemReceipts — 撈不全就要說「算不出來」', () => {
  /** 串接式 builder:最後一段是 `.limit()`。 */
  function builder(rows: unknown[] | null, error: unknown = null) {
    const calls: Array<[string, unknown[]]> = [];
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'in', 'order', 'limit']) {
      chain[m] = vi.fn((...args: unknown[]) => {
        calls.push([m, args]);
        return m === 'limit' ? { data: rows, error } : chain;
      });
    }
    return { chain, calls };
  }

  function row(over: Record<string, unknown> = {}) {
    return {
      id: 'rc-1',
      quantity: 3,
      surplus_quantity: 0,
      received_at: '2026-09-01T00:00:00.000Z',
      received_by: 'sean',
      note: null,
      order_item_procurement: { order_item_id: 'item-1' },
      ...over,
    };
  }

  it('🔵 零個品項 ⇒ 不查 DB, 回空陣列(而不是 null)', async () => {
    await expect(listOrderItemReceipts([])).resolves.toEqual([]);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('🔵 正常路:內嵌是【單物件】⇒ 攤平成 orderItemId', async () => {
    mocks.from.mockReturnValue(builder([row()]).chain);
    await expect(listOrderItemReceipts(['item-1'])).resolves.toEqual([
      {
        id: 'rc-1',
        orderItemId: 'item-1',
        quantity: 3,
        surplusQuantity: 0,
        receivedAt: '2026-09-01T00:00:00.000Z',
        receivedBy: 'sean',
        note: null,
      },
    ]);
  });

  it('🔵 內嵌是【陣列】⇒ 也要接得出來(生成型別對 many-to-one 推斷不穩)', async () => {
    mocks.from.mockReturnValue(
      builder([row({ order_item_procurement: [{ order_item_id: 'item-9' }] })]).chain,
    );
    const out = await listOrderItemReceipts(['item-9']);
    expect(out?.[0]?.orderItemId).toBe('item-9');
  });

  // 🔴🔴 **codex 2026-09-03 must-fix ③ 的那一格。**
  //    ⛔ ~~接不出來就 `continue`~~ ⇒ 回一個**非 null 的部分清單**
  //    ⇒ 畫面對「少了一列」與「本來就只有這些」印同一個東西 = 本片要修的病本身。
  it.each([
    ['id 不是字串', row({ id: 42 })],
    ['內嵌整個不見', row({ order_item_procurement: undefined })],
    ['內嵌是空陣列', row({ order_item_procurement: [] })],
    ['order_item_id 不是字串', row({ order_item_procurement: { order_item_id: null } })],
  ])('🔴 %s ⇒ 整個回 null(**不得**回少一列的清單)', async (_label, bad) => {
    mocks.from.mockReturnValue(builder([row({ id: 'ok-1' }), bad]).chain);
    await expect(listOrderItemReceipts(['item-1'])).resolves.toBeNull();
  });

  it('🔴 筆數超過上限 ⇒ 回 null(截斷要看得見)', async () => {
    const many = Array.from({ length: ORDER_RECEIPT_ROWS_LIMIT + 1 }, (_v, i) =>
      row({ id: `rc-${i}` }),
    );
    mocks.from.mockReturnValue(builder(many).chain);
    await expect(listOrderItemReceipts(['item-1'])).resolves.toBeNull();
  });

  it('🔵 負對照:剛好【等於】上限 ⇒ 正常回, 不誤報截斷', async () => {
    const exact = Array.from({ length: ORDER_RECEIPT_ROWS_LIMIT }, (_v, i) => row({ id: `rc-${i}` }));
    mocks.from.mockReturnValue(builder(exact).chain);
    const out = await listOrderItemReceipts(['item-1']);
    expect(out).toHaveLength(ORDER_RECEIPT_ROWS_LIMIT);
  });

  it('🔴 多要一筆:limit 一定要是「上限 + 1」, 否則那把尺量不到截斷', async () => {
    const { chain, calls } = builder([]);
    mocks.from.mockReturnValue(chain);
    await listOrderItemReceipts(['item-1']);
    expect(calls.find(([m]) => m === 'limit')![1]).toEqual([ORDER_RECEIPT_ROWS_LIMIT + 1]);
  });

  it('🔴 filter 掛在【內嵌欄位】上, 參數逐字比對(掛錯欄 ⇒ 撈到別張單)', async () => {
    const { chain, calls } = builder([]);
    mocks.from.mockReturnValue(chain);
    await listOrderItemReceipts(['a', 'b']);
    expect(calls.find(([m]) => m === 'in')![1]).toEqual([
      'order_item_procurement.order_item_id',
      ['a', 'b'],
    ]);
  });

  it('🔴 排序帶唯一鍵(received_at 可能相同 ⇒ 沒唯一鍵時「前 N 筆」跨請求是不同子集)', async () => {
    const { chain, calls } = builder([]);
    mocks.from.mockReturnValue(chain);
    await listOrderItemReceipts(['item-1']);
    expect(calls.filter(([m]) => m === 'order').map(([, a]) => a[0])).toEqual([
      'received_at',
      'id',
    ]);
  });

  it('🔴 DB 錯誤 ⇒ 往外拋, **不得**吞成空清單', async () => {
    mocks.from.mockReturnValue(builder(null, { message: 'boom' }).chain);
    await expect(listOrderItemReceipts(['item-1'])).rejects.toBeTruthy();
  });
});

describe('findOrderItemIdForReceipt — 「列不在」與「歸屬讀不出」是兩個答案(codex 2026-09-14 must-fix D)', () => {
  function row(data: unknown, error: unknown = null) {
    mocks.from.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data, error }) }) }),
    });
  }

  it("列不存在 ⇒ 'missing'(別的視窗先撤了 ⇒ action 要答 already_gone,不是 bug)", async () => {
    row(null);
    await expect(findOrderItemIdForReceipt('r-gone')).resolves.toBe('missing');
  });

  it('列在、內嵌歸屬讀不出 ⇒ null(fail-closed,action 拒撤)', async () => {
    row({ order_item_procurement: null });
    await expect(findOrderItemIdForReceipt('r-1')).resolves.toBeNull();
  });

  it('列在、歸屬讀得出 ⇒ 那個 item id(單物件 / 陣列兩形都接)', async () => {
    row({ order_item_procurement: { order_item_id: 'i-1' } });
    await expect(findOrderItemIdForReceipt('r-1')).resolves.toBe('i-1');
    row({ order_item_procurement: [{ order_item_id: 'i-2' }] });
    await expect(findOrderItemIdForReceipt('r-1')).resolves.toBe('i-2');
  });

  it('查詢失敗要拋,不得回 missing / null', async () => {
    row(null, { message: 'boom' });
    await expect(findOrderItemIdForReceipt('r-1')).rejects.toBeTruthy();
  });
});
