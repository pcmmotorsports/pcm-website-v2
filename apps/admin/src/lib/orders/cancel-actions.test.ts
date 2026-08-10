import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  authorizeAdminMutation: vi.fn(),
  getRequestId: vi.fn(),
  cancelOrder: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('../session/authorize', () => ({
  authorizeAdminMutation: mocks.authorizeAdminMutation,
}));
vi.mock('../audit/context', () => ({ getRequestId: mocks.getRequestId }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
// 🔴 **redirect mock 必須像 Next 真實行為一樣拋**(關卡2 codex must-fix):
//    純 `vi.fn()` 不拋 ⇒ 把 `redirect()` 搬到 revalidate / 成功 log **之前**整份測試照樣全綠,
//    而正式環境會當場跳出、那兩件事都不會發生。
class NextRedirectError extends Error {
  constructor() {
    super('NEXT_REDIRECT');
    this.name = 'NEXT_REDIRECT';
  }
}
// 🔴 `RedirectType` **也要 mock**:source 用 `redirect(url, RedirectType.replace)`,
//    只 mock `redirect` 會讓 `RedirectType` 是 undefined、當場 TypeError
//    —— 而那個錯會被測試看成「有拋 = 有導頁」而**假綠**。值照 Next 真實匯出。
vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  RedirectType: { push: 'push', replace: 'replace' },
}));
vi.mock('@pcm/adapters/server', () => ({ createSupabaseServiceClient: vi.fn() }));

vi.mock('./cancel-repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./cancel-repository')>();
  return { ...actual, cancelOrder: mocks.cancelOrder };
});

// 🔴 解析器與 query builders **刻意不 mock**(state builder 已隨 D2b 刪除) —— 餵真 FormData 走真解析器,
//    否則「爛表單擋得住」「invalid 不帶 rt」都是恆真斷言(前例 `note-actions.test.ts:29`)。
//    ⚠️ D2a 之後**新 token 不再由 action 鑄** —— 改成下次整頁渲染時表單自己鑄(D4 硬驗收)。
import { cancelOrderAction } from './cancel-actions';
import {
  CANCEL_ITEM_FIELD,
  CANCEL_MODE_FIELD,
  CANCEL_ORDER_ID_FIELD,
  CANCEL_REASON_CODE_FIELD,
  CANCEL_REASON_DETAIL_FIELD,
  CANCEL_REQUEST_TOKEN_FIELD,
  cancelItemQtyField,
  cancelledResultQuery,
  notSentResultQuery,
  sentResultQuery,
} from './cancel-action-state';

const ORDER_ID = '11111111-2222-3333-4444-555555555555';
const TOKEN = '99999999-8888-7777-6666-555555555555';
const ITEM_ID = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
// 🔴 第二顆品項 id(窄 R3 F3):**只有多一筆樣本,依筆數分流的壞實作才紅得起來**。
const ITEM_ID_2 = 'cccccccc-dddd-eeee-ffff-111111111111';
const DETAIL_PATH = `/orders/${ORDER_ID}`;
// 🔴 刻意含 emoji(surrogate pair):碼位長度與 UTF-16 長度不同 ⇒
//    log 那格若改用 `.length` 會轉紅(同備註片 fixture 的理由)。
const OTHER_DETAIL = '客人改買別款,已電話確認 🏍️';

function cancelForm(over: Record<string, string> = {}, items: string[] = []): FormData {
  const data = new FormData();
  const fields: Record<string, string> = {
    [CANCEL_ORDER_ID_FIELD]: ORDER_ID,
    [CANCEL_REQUEST_TOKEN_FIELD]: TOKEN,
    [CANCEL_REASON_CODE_FIELD]: 'out_of_stock',
    [CANCEL_MODE_FIELD]: 'full',
    ...over,
  };
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  for (const item of items) data.append(CANCEL_ITEM_FIELD, item);
  return data;
}

const OK_OUTCOME = {
  ok: true as const,
  cancellationId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  idempotent: false,
  closed: true,
};

beforeEach(() => {
  mocks.authorizeAdminMutation.mockResolvedValue({ sid: 'sid-1', actorId: 'sean' });
  mocks.getRequestId.mockResolvedValue('req-1');
  mocks.cancelOrder.mockResolvedValue(OK_OUTCOME);
  mocks.redirect.mockImplementation(() => {
    throw new NextRedirectError();
  });
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

// ── D2a:全 PRG 之後,每一條路徑都導頁 ────────────────────────────────────────
//
// 🔴 讀本檔前先知道兩件事:
//   ① `redirect` 的 mock **會拋**(像 Next 真實行為)⇒ 每個案例都是 `rejects.toThrow('NEXT_REDIRECT')`
//      **加上**對 `mocks.redirect` 的參數斷言。只斷言有拋 = 恆真(六條路徑都會拋)。
//   ② 導頁一律 `replace`,所以第二個參數也要斷言 —— 少了它,實作改回預設 push 不會有人紅。

describe('cancelOrderAction — 閘的順序(plan §2 慣例 1;PRG 之後仍不變)', () => {
  it('未授權 → 導固定安全頁 /orders 帶 denied、不呼叫 RPC', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);

    await expect(cancelOrderAction(cancelForm())).rejects.toThrow('NEXT_REDIRECT');

    expect(mocks.redirect).toHaveBeenCalledWith(
      `/orders?${notSentResultQuery('denied')}`,
      'replace',
    );
    expect(mocks.cancelOrder).not.toHaveBeenCalled();
  });

  // 🔴 未授權**不得**用表單裡的 orderId 導回明細頁:那等於在授權之前就採信 client 送的欄位。
  //    把實作改成「denied 也導 detailPath(信封 orderId)」→ 本條紅。
  it('🔴 未授權 → 即使表單帶著合法 orderId,也不導明細頁(授權前不採信任何欄位)', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);

    await expect(cancelOrderAction(cancelForm())).rejects.toThrow('NEXT_REDIRECT');

    const [url] = mocks.redirect.mock.calls[0] as [string, string];
    expect(url.startsWith('/orders?')).toBe(true);
    expect(url).not.toContain(ORDER_ID);
  });

  // 🔴 沿用舊片的地雷表單:任何欄位被讀到就炸 ⇒ 證明授權閘之前一個欄位都沒讀。
  it('🔴 未授權 + 碰到就炸的表單 → 仍是 denied(證明授權閘之前零讀欄位)', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    const landmine = {
      get() {
        throw new Error('授權前不得讀取任何欄位');
      },
      getAll() {
        throw new Error('授權前不得讀取任何欄位');
      },
    } as unknown as FormData;

    await expect(cancelOrderAction(landmine)).rejects.toThrow('NEXT_REDIRECT');

    expect(mocks.redirect).toHaveBeenCalledWith(
      `/orders?${notSentResultQuery('denied')}`,
      'replace',
    );
  });
});

describe('cancelOrderAction — 解析失敗(invalid)', () => {
  it('爛表單 → 導回**那張單的明細頁**帶 invalid、不呼叫 RPC', async () => {
    await expect(
      cancelOrderAction(cancelForm({ [CANCEL_REASON_CODE_FIELD]: '不存在的原因' })),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(mocks.redirect).toHaveBeenCalledWith(
      `${DETAIL_PATH}?${notSentResultQuery('invalid')}`,
      'replace',
    );
    expect(mocks.cancelOrder).not.toHaveBeenCalled();
  });

  // 🔴 信封解析的存在理由:完整解析器失敗時拿不到 orderId ⇒ 沒有它,員工每填錯一次
  //    就被踢回訂單列表。把 `readRedirectTargetOrderId` 改成永遠回 null → 本條紅。
  it('🔴 orderId 合法但別的欄位爛 → 仍導回該單明細頁(不是把人踢回列表)', async () => {
    await expect(
      cancelOrderAction(cancelForm({ [CANCEL_MODE_FIELD]: '亂寫的模式' })),
    ).rejects.toThrow('NEXT_REDIRECT');

    const [url] = mocks.redirect.mock.calls[0] as [string, string];
    expect(url).toBe(`${DETAIL_PATH}?${notSentResultQuery('invalid')}`);
  });

  // 🔴 反向:orderId 本身就不是 uuid ⇒ 沒有可信目標,退回 /orders。
  //    這條同時關掉開放重導向面:client 送 `https://evil.example` 也只會得到 `/orders`。
  it('🔴 orderId 不是 uuid(含想塞外部網址)→ 退回 /orders,不拿它拼路徑', async () => {
    await expect(
      cancelOrderAction(cancelForm({ [CANCEL_ORDER_ID_FIELD]: 'https://evil.example/x' })),
    ).rejects.toThrow('NEXT_REDIRECT');

    const [url] = mocks.redirect.mock.calls[0] as [string, string];
    // 🔴 上面的全等已涵蓋「不含 evil.example」⇒ 不另寫那條恆真斷言(關卡2 nit)。
    expect(url).toBe(`/orders?${notSentResultQuery('invalid')}`);
  });

  it('🔴 invalid 的 query 不得帶 rt(沒送到 RPC = 帳本裡本來就沒有那筆,給 token 是叫 D5 去找鬼)', async () => {
    await expect(
      cancelOrderAction(cancelForm({ [CANCEL_REASON_CODE_FIELD]: '' })),
    ).rejects.toThrow('NEXT_REDIRECT');

    const [url] = mocks.redirect.mock.calls[0] as [string, string];
    expect(url).not.toContain('rt=');
  });
});

describe('cancelOrderAction — 送達 RPC 之後', () => {
  // 🔴🔴 **本片 code-review must-fix:這兩格差點隨簽章改動一起被我刪掉。**
  //    它們與 PRG 改造無關,守的是**送進 RPC 的參數本身** —— 一刪,把 `items: parsed.items`
  //    改成 `items: null` 就會**送出整單取消而整份測試全綠**,正是 `E-011-STOP` 那個失敗模式。
  //    改簽章時「順手清掉不再編譯的測試」= 把錢面覆蓋跟著清掉,這裡逐字記著。
  it('逐欄具名送進 repository(整單取消:items=null)', async () => {
    await expect(cancelOrderAction(cancelForm())).rejects.toThrow('NEXT_REDIRECT');

    expect(mocks.cancelOrder).toHaveBeenCalledTimes(1);
    expect(mocks.cancelOrder).toHaveBeenCalledWith({
      orderId: ORDER_ID,
      reasonCode: 'out_of_stock',
      reasonDetail: null,
      items: null,
      actor: 'sean',
      requestToken: TOKEN,
    });
  });

  // 🔴🔴 **一筆與兩筆都要測**(窄 R3 must-fix F3)。原本只有單筆樣本 ⇒ 一個**依筆數分流**的
  //    壞實作(例如 `items: parsed.items.length > 1 ? null : parsed.items`)會讓兩格全綠,
  //    而 `items: null` 對 RPC 的意思是**整單取消** —— 寫進 append-only 的取消帳本、刪不掉。
  //    這正是 `E-011-STOP` 那個失敗模式的同形,只是換一條路徑進來。
  //    ⚠️ 記帳:我自評「沒驗過改欄位名那一軸」時**根本沒想到筆數這一軸**;
  //    「構造不出負測」與「想不到那個維度」是兩件事,後者只有換人/換角度看得到
  //    (memory `feedback_negative-test-observation-supplied-by-another-mechanism` 的反面提醒)。
  it.each([
    ['一筆', [`${ITEM_ID}:3`], [{ order_item_id: ITEM_ID, quantity: 3 }]],
    [
      '兩筆',
      [`${ITEM_ID}:3`, `${ITEM_ID_2}:1`],
      [
        { order_item_id: ITEM_ID, quantity: 3 },
        { order_item_id: ITEM_ID_2, quantity: 1 },
      ],
    ],
  ])(
    '部分取消(%s)+ other 說明:品項與說明原樣送達(整單 ≠ 部分,這組是分界)',
    async (_label, formItems, expectedItems) => {
      await expect(
        cancelOrderAction(
          cancelForm(
            {
              [CANCEL_MODE_FIELD]: 'partial',
              [CANCEL_REASON_CODE_FIELD]: 'other',
              [CANCEL_REASON_DETAIL_FIELD]: OTHER_DETAIL,
              // ⚠️ **A13b E1 改的是輸入、不是期望值**:>1 的品項必須帶同名數量欄
              //    (關卡2 codex 第三輪 #1 的 fail-closed);值刻意等於 checkbox 的數量
              //    ⇒ 覆寫不改變結果,下面的期望值一個字都沒動。
              [cancelItemQtyField(ITEM_ID)]: '3',
            },
            formItems as string[],
          ),
        ),
      ).rejects.toThrow('NEXT_REDIRECT');

      expect(mocks.cancelOrder).toHaveBeenCalledTimes(1);
      expect(mocks.cancelOrder).toHaveBeenCalledWith({
        orderId: ORDER_ID,
        reasonCode: 'other',
        reasonDetail: OTHER_DETAIL,
        // 🔴 snake_case 是**解析器就定好的形狀**(RPC 的 jsonb 契約),不是這裡順手寫的。
        items: expectedItems,
        actor: 'sean',
        requestToken: TOKEN,
      });
    },
  );

  it('成功 → 成功 log 與 revalidate 都在 redirect 之前,再帶 r+rt 導回明細頁', async () => {
    await expect(cancelOrderAction(cancelForm())).rejects.toThrow('NEXT_REDIRECT');

    expect(mocks.revalidatePath).toHaveBeenCalledWith(DETAIL_PATH);
    expect(mocks.redirect).toHaveBeenCalledWith(
      `${DETAIL_PATH}?${cancelledResultQuery(TOKEN)}`,
      'replace',
    );
    // 🔴 **成功 log 也要斷言**(關卡2 must-fix:本條名稱寫著「成功 log 與 revalidate 都在
    //    redirect 之前」,但原本只驗 revalidate ⇒ 把 `order_cancel.done` 整段刪掉照樣全綠,
    //    而那行 log 是災難當天把 `request_token` 對回 `cancellation_id` 的唯一線索)。
    expect(console.info).toHaveBeenCalledWith(
      '[admin/orders/cancel] order_cancel.done',
      expect.objectContaining({
        request_token: TOKEN,
        order_id: ORDER_ID,
        cancellation_id: OK_OUTCOME.cancellationId,
      }),
    );

    // 🔴 順序:redirect 一拋就跳出 ⇒ 它若排在前面,上面那兩條會零呼叫。
    const redirectOrder = mocks.redirect.mock.invocationCallOrder[0] as number;
    const revalidateOrder = mocks.revalidatePath.mock.invocationCallOrder[0] as number;
    const doneLogOrder = vi
      .mocked(console.info)
      .mock.invocationCallOrder.at(-1) as number;
    expect(revalidateOrder).toBeLessThan(redirectOrder);
    expect(doneLogOrder).toBeLessThan(redirectOrder);
  });

  // 🔴🔴 成功也必須帶 rt(關卡2 R2 must-fix):少了它,D5 分不出「這次成功 / 帳本裡的舊紀錄 /
  //    有人自己打的網址」⇒ 成功訊息要嘛不敢顯示、要嘛顯示成偽造得出來的東西。
  //
  // 🔴 **餵三顆不同的 token 各送一次**(關卡2 R1 must-fix:原本只有固定那顆 ⇒ 實作若寫死
  //    一顆常數、或捕獲了上一次的值,單一樣本一律看不出來 —— 那正是 fixture「碰巧」讓
  //    守門恆真的形狀,memory `feedback_fixture-value-makes-guard-vacuous` 同族)。
  it.each([
    ['本次送出的那顆', '11112222-3333-4444-8555-666677778888'],
    ['另一顆(模擬上一次那把)', '99998888-7777-6666-8555-444433332222'],
    ['第三顆(模擬別人偽造後又被正常送出)', 'abcdabcd-1234-4321-8abc-abcdabcdabcd'],
  ])('🔴 成功的 query 帶回的是「%s」,不是寫死或上一次的值', async (_label, token) => {
    await expect(
      cancelOrderAction(cancelForm({ [CANCEL_REQUEST_TOKEN_FIELD]: token })),
    ).rejects.toThrow('NEXT_REDIRECT');

    const [url] = mocks.redirect.mock.calls[0] as [string, string];
    expect(url).toBe(`${DETAIL_PATH}?${cancelledResultQuery(token)}`);
  });

  it('🔴 idempotent: true 也是成功(顯示成錯誤會誘導員工換 token 重送 = 真的多一筆取消)', async () => {
    mocks.cancelOrder.mockResolvedValue({ ...OK_OUTCOME, idempotent: true });

    await expect(cancelOrderAction(cancelForm())).rejects.toThrow('NEXT_REDIRECT');

    expect(mocks.redirect).toHaveBeenCalledWith(
      `${DETAIL_PATH}?${cancelledResultQuery(TOKEN)}`,
      'replace',
    );
  });

  it.each(['rejected', 'retry', 'bug', 'error'] as const)(
    '已送到 RPC 的 %s → 導回明細頁,r 與 rt 都要有',
    async (code) => {
      mocks.cancelOrder.mockResolvedValue({ ok: false, code, sqlstate: 'P0001', logMessage: 'x' });

      await expect(cancelOrderAction(cancelForm())).rejects.toThrow('NEXT_REDIRECT');

      expect(mocks.redirect).toHaveBeenCalledWith(
        `${DETAIL_PATH}?${sentResultQuery(code, TOKEN)}`,
        'replace',
      );
    },
  );

  // 🔴 這條釘的是「換一顆新 token 就會真的再取消一次」那個洞的反面:
  //    已送到 RPC 的失敗**必須原樣帶回這次那顆**,不得鑄新的。
  it('🔴 已送達失敗帶回的是原本那顆 token(鑄新的 → 本條紅)', async () => {
    mocks.cancelOrder.mockResolvedValue({
      ok: false,
      code: 'retry',
      sqlstate: '40P01',
      logMessage: 'x',
    });

    await expect(cancelOrderAction(cancelForm())).rejects.toThrow('NEXT_REDIRECT');

    const [url] = mocks.redirect.mock.calls[0] as [string, string];
    expect(url).toContain(`rt=${TOKEN}`);
  });

  // 🔴 plan §3 D2 驗收③:revalidate 拋錯**仍必導頁**。
  //    它一旦被往外傳,員工拿到 500、重載換到新 token,而前一次可能已 commit。
  it('🔴 revalidate 拋錯不得吃掉導頁(仍要導到失敗出口)', async () => {
    mocks.cancelOrder.mockResolvedValue({
      ok: false,
      code: 'error',
      sqlstate: 'XX000',
      logMessage: 'boom',
    });
    mocks.revalidatePath.mockImplementation(() => {
      throw new Error('revalidate 爆了');
    });

    await expect(cancelOrderAction(cancelForm())).rejects.toThrow('NEXT_REDIRECT');

    expect(mocks.redirect).toHaveBeenCalledWith(
      `${DETAIL_PATH}?${sentResultQuery('error', TOKEN)}`,
      'replace',
    );
  });

  // 🔴 同一條的成功側:成功路徑的 revalidate 拋錯也不得把已經成功的取消變成 500。
  it('🔴 成功路徑的 revalidate 拋錯同樣不得吃掉導頁', async () => {
    mocks.revalidatePath.mockImplementation(() => {
      throw new Error('revalidate 爆了');
    });

    await expect(cancelOrderAction(cancelForm())).rejects.toThrow('NEXT_REDIRECT');

    expect(mocks.redirect).toHaveBeenCalledWith(
      `${DETAIL_PATH}?${cancelledResultQuery(TOKEN)}`,
      'replace',
    );
  });

  it('🔴 失敗路徑一定把 message 記進 log(plan §4.2 補償條款)', async () => {
    mocks.cancelOrder.mockResolvedValue({
      ok: false,
      code: 'rejected',
      sqlstate: 'P0001',
      logMessage: '這張單已經取消過了',
    });

    await expect(cancelOrderAction(cancelForm())).rejects.toThrow('NEXT_REDIRECT');

    expect(console.error).toHaveBeenCalledWith(
      '[admin/orders/cancel] 取消失敗',
      expect.objectContaining({ message: '這張單已經取消過了', sqlstate: 'P0001' }),
    );
  });
});

describe('cancelOrderAction — log 衛生', () => {
  it('🔴 attempt log **不記說明全文**,只記碼位長度', async () => {
    await expect(
      cancelOrderAction(
        cancelForm({
          [CANCEL_REASON_CODE_FIELD]: 'other',
          [CANCEL_REASON_DETAIL_FIELD]: OTHER_DETAIL,
        }),
      ),
    ).rejects.toThrow('NEXT_REDIRECT');
    const [, payload] = vi.mocked(console.info).mock.calls[0] ?? [];
    expect(payload).toMatchObject({
      request_id: 'req-1',
      request_token: TOKEN,
      sid: 'sid-1',
      actor: 'sean',
      order_id: ORDER_ID,
      reason_code: 'other',
      reason_detail_length: [...OTHER_DETAIL].length,
      mode: 'full',
      item_count: null,
    });
    expect(JSON.stringify(payload)).not.toContain('客人改買別款');
  });

  // 🔴 code-reviewer must-fix:**失敗 log 原本零負測** —— 而失敗路徑正是最容易
  //    順手多塞欄位除錯的地方(往 `console.error` 加 `detail: carried.reasonDetail` 曾經全綠)。
  it('🔴 失敗 log 同樣不得帶出說明全文或品項內容', async () => {
    mocks.cancelOrder.mockResolvedValue({
      ok: false,
      code: 'error',
      sqlstate: null,
      logMessage: 'boom',
    });
    // 🔴 D2a 之後失敗也導頁 ⇒ 這裡會拋。**先接住再驗 log**:不接住的話本條會以
    //    「NEXT_REDIRECT 未捕捉」失敗,而那與 log 衛生無關、會遮掉真正要驗的東西。
    await expect(
      cancelOrderAction(
        cancelForm(
          {
            [CANCEL_MODE_FIELD]: 'partial',
            [CANCEL_REASON_CODE_FIELD]: 'other',
            [CANCEL_REASON_DETAIL_FIELD]: OTHER_DETAIL,
            // ⚠️ A13b E1 契約收緊:>1 的品項必須帶數量欄。**漏補這一格會讓整條測試變恆真**
            //    —— 解析器提前判 invalid ⇒ RPC 從沒被呼叫、`console.error` 從沒發生
            //    ⇒ `JSON.stringify([])` 當然不含敏感字串。關卡2 codex 複審 #1 抓到的就是這個。
            [cancelItemQtyField(ITEM_ID)]: '3',
          },
          [`${ITEM_ID}:3`],
        ),
      ),
    ).rejects.toThrow('NEXT_REDIRECT');
    // 🔴🔴 **先證「該跑的路徑真的跑到了」,再驗它沒帶敏感內容**(關卡2 codex 複審 #1)。
    //    少了這兩條前置斷言,任何讓表單提前 invalid 的改動都會把本條變成恆真格。
    expect(mocks.cancelOrder).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.error)).toHaveBeenCalled();
    const serialized = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(serialized).not.toContain('客人改買別款');
    expect(serialized).not.toContain(ITEM_ID);
  });

  it('部分取消的 attempt log 記筆數、不記品項內容', async () => {
    await expect(
      cancelOrderAction(
        cancelForm(
          { [CANCEL_MODE_FIELD]: 'partial', [cancelItemQtyField(ITEM_ID)]: '3' },
          [`${ITEM_ID}:3`],
        ),
      ),
    ).rejects.toThrow('NEXT_REDIRECT');
    const [, payload] = vi.mocked(console.info).mock.calls[0] ?? [];
    expect(payload).toMatchObject({ mode: 'partial', item_count: 1 });
    expect(JSON.stringify(payload)).not.toContain(ITEM_ID);
  });
});

describe('A13b E1:失敗導頁的 order_id 也走「恰一筆」(關卡2 codex 複審 #3)', () => {
  // 🔴 解析器那邊會拒重複的 `order_id`,但**失敗導頁**若採第一筆,員工會被導到**另一張單**、
  //    看著別人的取消結果面板。導頁目標與解析器必須用同一套讀法。
  function twoOrderIds(first: string, second: string): FormData {
    const data = cancelForm();
    data.delete(CANCEL_ORDER_ID_FIELD);
    data.append(CANCEL_ORDER_ID_FIELD, first);
    data.append(CANCEL_ORDER_ID_FIELD, second);
    return data;
  }
  const OTHER_ORDER = '77777777-6666-5555-4444-333333333333';

  it.each([
    ['本單在前', ORDER_ID, OTHER_ORDER],
    ['別單在前', OTHER_ORDER, ORDER_ID],
  ])('🔴 order_id 送兩份(%s)⇒ 導回訂單列表,**不導向任一張單**', async (_l, a, b) => {
    await expect(cancelOrderAction(twoOrderIds(a, b))).rejects.toThrow('NEXT_REDIRECT');
    const [target] = mocks.redirect.mock.calls[0] ?? [];
    expect(String(target)).not.toContain(ORDER_ID);
    expect(String(target)).not.toContain(OTHER_ORDER);
  });

  it('🔴 正向對照:只送一份時仍導回那張單(證明上面兩條不是「永遠不導向任何單」)', async () => {
    await expect(cancelOrderAction(cancelForm({ [CANCEL_MODE_FIELD]: 'nope' }))).rejects.toThrow(
      'NEXT_REDIRECT',
    );
    expect(String(mocks.redirect.mock.calls[0]?.[0])).toContain(ORDER_ID);
  });
});

describe('A13b E1:數量覆寫欄走完整條接線(段 1 = action → repository)', () => {
  // 🔴 **為什麼這組非有不可**(關卡1 R1 #8):解析器測試只量純函式、表單測試只量 markup,
  //    中間那一跳(真 FormData → 解析器 → repository 參數)兩頭都綠也可能斷掉
  //    —— memory `feedback_assertion-measures-the-wrong-thing` 的第四形狀。
  // ⚠️ 這條只證**段 1**;段 2(repository → RPC 的 `p_items`)在 `cancel-repository.test.ts`
  //    (那裡已有 `p_items: items` 的深度相等斷言)。兩段合起來才是完整證據鏈,單獨任一段都不是。
  it('🔴 覆寫 2 件 ⇒ repository 收到 quantity:2,而不是 checkbox 帶的 5', async () => {
    await expect(
      cancelOrderAction(
        cancelForm(
          { [CANCEL_MODE_FIELD]: 'partial', [cancelItemQtyField(ITEM_ID)]: '2' },
          [`${ITEM_ID}:5`],
        ),
      ),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.cancelOrder).toHaveBeenCalledTimes(1);
    expect(mocks.cancelOrder.mock.calls[0]![0]).toMatchObject({
      items: [{ order_item_id: ITEM_ID, quantity: 2 }],
    });
  });

  it('🔴 正向對照:覆寫值 = checkbox 值時送 5(證明上一條量的是覆寫、不是恆為 2)', async () => {
    await expect(
      cancelOrderAction(
        cancelForm(
          { [CANCEL_MODE_FIELD]: 'partial', [cancelItemQtyField(ITEM_ID)]: '5' },
          [`${ITEM_ID}:5`],
        ),
      ),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.cancelOrder.mock.calls[0]![0]).toMatchObject({
      items: [{ order_item_id: ITEM_ID, quantity: 5 }],
    });
  });

  it('🔴 >1 的品項缺數量欄 ⇒ invalid、送不到 RPC(關卡2 codex 第三輪 #1,走完整條接線)', async () => {
    await expect(
      cancelOrderAction(cancelForm({ [CANCEL_MODE_FIELD]: 'partial' }, [`${ITEM_ID}:5`])),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.cancelOrder).not.toHaveBeenCalled();
  });

  it('🔴 覆寫欄是空字串 ⇒ 整份 invalid、**根本送不到 RPC**(不是靜默取消到底)', async () => {
    await expect(
      cancelOrderAction(
        cancelForm(
          { [CANCEL_MODE_FIELD]: 'partial', [cancelItemQtyField(ITEM_ID)]: '' },
          [`${ITEM_ID}:5`],
        ),
      ),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.cancelOrder).not.toHaveBeenCalled();
  });
});
