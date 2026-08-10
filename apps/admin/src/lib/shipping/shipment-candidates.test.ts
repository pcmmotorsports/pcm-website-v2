// shipment-candidates.test.ts — 建箱彈窗資料源的守門。
//
// 🔴 **主守的是鐵則 12**:`AdminOrderDetail.items` 帶成交價(`unitPrice`/`lineTotal`),
//    而這支的產物是要交給 client 元件的 ⇒ **DTO 裡出現任何金額欄位就是外洩**。
//    守門兩面:①型別/實作層面不得出現金額欄名 ②實際回傳的物件逐鍵檢查、只有白名單那六個鍵
//    (`orderItemId` / `orderDisplayId` / `variantSku` / `title` / `remaining` / `blockedReason`;
//     `variantSku` 是 2026-08-09 追加的料號、`blockedReason` 是 2026-08-10 #351② 追加的
//     「為什麼出不了」列舉值,兩者都是非價格欄)。
//
// ⚠️ **它擋不住什麼**:mock 證不了真 DB 的數字對不對(無 DB);也證不了 RSC payload ——
//    `import 'server-only'` 讓誤用變成建置期錯誤,那是機制,不是本檔的斷言。

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const findAdminOrderDetail = vi.fn();
const listAssigned = vi.fn();
const listCustomers = vi.fn();
vi.mock('server-only', () => ({}));
vi.mock('../orders/order-repository', () => ({
  getAdminOrderRepository: () => ({ findAdminOrderDetail }),
}));
vi.mock('./shipment-repository', () => ({
  listAssignedQuantitiesByOrderItemIds: listAssigned,
  listOrderCustomerUserIds: listCustomers,
}));

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = readFileSync(resolve(HERE, 'shipment-candidates.ts'), 'utf8');
/** 剝註解:檔頭大量引用 `unitPrice` / `lineTotal` 當反例。 */
const SRC = RAW.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));

const detail = (over: Record<string, unknown> = {}) => ({
  id: 'o1',
  displayId: 'PCM-0001',
  shippingAddress: { name: '陳彥廷', phone: '0912', line: '台北市…' },
  customer: { name: '陳彥廷', email: 'a@b.c', phone: '0912' },
  items: [
    {
      id: 'oi-1',
      title: 'Akrapovic 鈦合金頭段',
      // 🔴 料號與品名**刻意不同構**:兩者長得像的話,「把 title 抄成 sku」的實作也會全綠。
      variantSku: 'S-Y10E9-HGEH',
      // 🔴 三個輸入數字**刻意讓新舊公式算出不同答案**(2026-08-10 #351②):
      //    訂購 4 / 到貨 2 / 取消 1(可取消欄依公式必為 1 = 4−2−1,與取消量相同是算出來的、不是湊的)。
      //    · 新式(到貨 − 已配箱)= 2 − a
      //    · 舊式(訂購 − 取消 − 已配箱)= 3 − a  ⇒ 兩式差 1,回退到舊式的實作**測得出來**。
      //    · 「順手把 cancelled 再減一次」= 1 − a ⇒ 也測得出來。
      //    C7 前提滿足:instock 2 + cancelled 1 = 3 ≤ quantity 4。
      quantity: 4,
      unitPrice: { amount: 61500, currency: 'TWD' },
      lineTotal: { amount: 246000, currency: 'TWD' },
      quantitySummary: { quantity: 4, orderedQuantity: 4, instockQuantity: 2, cancelledQuantity: 1, cancellableQuantity: 1 },
    },
  ],
  ...over,
});

beforeEach(() => {
  findAdminOrderDetail.mockReset();
  listAssigned.mockReset();
  listAssigned.mockResolvedValue(new Map());
  listCustomers.mockReset();
  // 預設:兩張 fixture 單同屬一位客人(這才是常態;跨客人是另外構造的負向格)。
  listCustomers.mockResolvedValue(
    new Map([
      ['o1', 'cu-same'],
      ['o2', 'cu-same'],
    ]),
  );
});

describe('🔴🔴 鐵則 12 — DTO 不得帶任何金額', () => {
  it('實作層不得出現 unitPrice / lineTotal / total / subtotal 等金額欄名', () => {
    const forbidden = ['unitPrice', 'lineTotal', 'subtotal', 'discountTotal', 'shippingFee', 'tierAtCheckout'];
    const bad = forbidden.filter((t) => SRC.includes(t));
    expect(
      bad,
      `shipment-candidates.ts 出現了金額欄名:${bad.join(', ')}。本檔的產物要交給 client 元件,` +
        '任何金額進 DTO = 成交價脈絡外洩進 RSC payload。',
    ).toEqual([]);
  });

  it('🔴 實際回傳的品項物件只有白名單六個鍵(逐鍵檢查,不是只看型別)', async () => {
    findAdminOrderDetail.mockResolvedValue(detail());
    const { loadShipmentCandidates } = await import('./shipment-candidates');
    const r = await loadShipmentCandidates(['o1']);
    expect(r.items.length).toBe(1);
    expect(
      Object.keys(r.items[0]!).sort(),
      '品項 DTO 的鍵不是白名單那六個 ⇒ 有人把 detail 的欄位整包展開進來了',
    ).toEqual(['blockedReason', 'orderDisplayId', 'orderItemId', 'remaining', 'title', 'variantSku']);
  });

  it('前提 — 本檔必須有 `import \'server-only\'`(誤用變建置期錯誤,不是上線才發現)', () => {
    expect(
      RAW.slice(0, 200),
      "檔首少了 import 'server-only' ⇒ 有人從 client 檔 import 它時不會有任何警告," +
        '而它會把訂單明細(含成交價與 PII)拉進 client bundle。',
    ).toMatch(/import 'server-only'/);
  });
});

describe('還能出幾件 = 已到貨 − 已配箱(#351② 口徑修正)', () => {
  it('🔴 從**到貨量**起算,不是從訂購量(這條就是 Sean 撞到的那個)', async () => {
    findAdminOrderDetail.mockResolvedValue(detail());
    listAssigned.mockResolvedValue(new Map([['oi-1', 1]])); // 已配箱 1
    const { loadShipmentCandidates } = await import('./shipment-candidates');
    const r = await loadShipmentCandidates(['o1']);
    // 到貨 2 − 已配箱 1 = 1(舊式會算成 訂購 4 − 取消 1 − 已配箱 1 = 2)
    expect(
      r.items[0]!.remaining,
      '算出 2 = 退回了「訂購量起算」的舊式子 ⇒ 還沒到貨的件會被標成「還能出」,' +
        '員工照著出貨,而 DB 判可出 0 —— 失敗是靜默的。',
    ).toBe(1);
    // 🔴 契約的另一半:出得了的品項 `blockedReason` 必須是 `null`。
    //    沒有這條的話「無條件算 blockedReason」那個突變全綠,而型別註解逐字承諾了 null
    //    ⇒ 下一個人拿 `blockedReason !== null` 當「不能出」的判準就會把可出的品項擋掉。
    expect(
      r.items[0]!.blockedReason,
      '出得了的品項卻帶了 blockedReason ⇒ 型別註解承諾的 null 是假的。',
    ).toBeNull();
  });

  it('🔴 完全沒到貨的品項:可出 0 且原因 = `not_arrived`(不是消失、也不是可出訂購量)', async () => {
    findAdminOrderDetail.mockResolvedValue(
      detail({
        items: [
          {
            ...detail().items[0]!,
            quantitySummary: { quantity: 4, orderedQuantity: 4, instockQuantity: 0, cancelledQuantity: 0, cancellableQuantity: 4 },
          },
        ],
      }),
    );
    const { loadShipmentCandidates } = await import('./shipment-candidates');
    const r = await loadShipmentCandidates(['o1']);
    expect(
      r.items[0]?.remaining,
      '訂了 4 件、一件都還沒到貨,彈窗卻讓員工選 ⇒ 這正是 #351② 要修的那個口徑錯。',
    ).toBe(0);
    expect(
      r.items[0]?.blockedReason,
      '原因標錯 ⇒ 員工被指去做錯的下一步(該追採購卻跑去翻既有包裹)。',
    ).toBe('not_arrived');
  });

  it('🔴 `已取消` **不得**再被減一次', async () => {
    findAdminOrderDetail.mockResolvedValue(detail());
    const { loadShipmentCandidates } = await import('./shipment-candidates');
    const r = await loadShipmentCandidates(['o1']);
    // 到貨 2 − 已配箱 0 = 2;若有人「順手」把 cancelled(1)也減掉會得到 1。
    // 為什麼不該減:A8a2 的可取消量守門(增量 ≤ quantity − instock − cancelled)讓已到貨的件
    // 永遠取消不掉 ⇒ 取消掉的件從來就不在到貨量裡。
    // ⚠️ 別引 C7 當理由:`instock + cancelled ≤ quantity` 是必要條件不是充分條件,
    //    本 fixture(4/2/1)自己就滿足 C7 而數值上仍容得下重疊。(本條不驗那兩道,那是 DB 的事。)
    expect(
      r.items[0]!.remaining,
      '算出 1 = 有人把 cancelled 加回式子裡 ⇒ **重複扣**(取消掉的件本來就沒到貨),' +
        '可出量被算少,已到貨的東西出不掉。這是 cancellableQuantity 那條「不可再減 shipped」的鏡像。',
    ).toBe(2);
  });

  it('🔴 已配箱沒被扣 → 同一件會被裝進第二個箱(這條擋的就是漏扣)', async () => {
    findAdminOrderDetail.mockResolvedValue(detail());
    listAssigned.mockResolvedValue(new Map([['oi-1', 2]])); // 到貨 2 全被裝走
    const { loadShipmentCandidates } = await import('./shipment-candidates');
    const r = await loadShipmentCandidates(['o1']);
    expect(r.items[0]?.remaining, 'remaining 不是 0 ⇒ 已配箱沒扣,同一件會被裝進第二個箱').toBe(0);
    expect(
      r.items[0]?.blockedReason,
      '到貨過但都被裝走了,原因卻不是 all_boxed ⇒ 畫面會叫員工去追一批其實已經到了的貨。',
    ).toBe('all_boxed');
  });

  // 🔴 R2 抓到的兩條假話,各配一格(兩條都是「原因標錯 ⇒ 員工被指去做錯的下一步」)。
  it('🔴 整筆被取消的品項標 `cancelled`,不是 `not_arrived`(它永遠不會到)', async () => {
    findAdminOrderDetail.mockResolvedValue(
      detail({
        items: [
          {
            ...detail().items[0]!,
            // 訂 4 全取消 ⇒ 到貨恆 0(C7),舊分支只看 instock 會說「未到貨」。
            quantitySummary: { quantity: 4, orderedQuantity: 4, instockQuantity: 0, cancelledQuantity: 4, cancellableQuantity: 0 },
          },
        ],
      }),
    );
    const { loadShipmentCandidates } = await import('./shipment-candidates');
    expect(
      (await loadShipmentCandidates(['o1'])).items[0]?.blockedReason,
      '標成「未到貨」⇒ 叫員工去追一批**已經被取消、永遠不會到**的貨。',
    ).toBe('cancelled');
  });

  it('🔴 已裝箱後到貨紀錄被下修(instock 0 但 already > 0)標 `all_boxed`,不是 `not_arrived`', async () => {
    findAdminOrderDetail.mockResolvedValue(
      detail({
        items: [
          {
            ...detail().items[0]!,
            quantitySummary: { quantity: 4, orderedQuantity: 4, instockQuantity: 0, cancelledQuantity: 1, cancellableQuantity: 3 },
          },
        ],
      }),
    );
    listAssigned.mockResolvedValue(new Map([['oi-1', 2]])); // 東西已經在某個箱子裡
    const { loadShipmentCandidates } = await import('./shipment-candidates');
    expect(
      (await loadShipmentCandidates(['o1'])).items[0]?.blockedReason,
      '標成「未到貨」⇒ 員工跑去追供應商,而東西其實在別人開的箱子裡。' +
        '(分支順序:`already > 0` 必須排在 `instock === 0` 之前。)',
    ).toBe('all_boxed');
  });

  // 🔴 2026-08-10 #351②:本條的規格被改過**兩次**,兩次都要看懂再動:
  //    ①第一版測「`Math.max(0,…)` 把負數收斂成 0」—— 突變 M3 證明那是死碼(負數會被 filter 濾掉)。
  //    ②於是改成釘那道 `filter(remaining > 0)`。**但 #351② 把那道 filter 拿掉了**
  //      (可出 0 現在是常態、要留在清單裡標原因)⇒ 夾在 0 以上**不再是死碼**:
  //      -97 現在真的會被畫進數量框。本條回到釘「夾」這個動作本身。
  it('🔴 快取短暫不一致算出負數時,對外一律夾成 0(不是把 −97 畫進數量框)', async () => {
    findAdminOrderDetail.mockResolvedValue(detail());
    listAssigned.mockResolvedValue(new Map([['oi-1', 99]])); // 到貨 2 − 已配箱 99 = −97
    const { loadShipmentCandidates } = await import('./shipment-candidates');
    const r = await loadShipmentCandidates(['o1']);
    expect(r.items[0]?.remaining, '負數被原樣吐出 ⇒ 彈窗會出現「還能出 -97」與 max=-97 的數量框').toBe(0);
    expect(r.items[0]?.blockedReason, '到貨過(2)但被裝走更多 ⇒ 仍屬 all_boxed,不是未到貨').toBe('all_boxed');
  });

  // 🔴 2026-08-10 #351②:本條的**規格被反轉**。
  //    舊版斷言「summary=null ⇒ 當作零取消 ⇒ remaining = 訂購量」,那在「訂購量起算」的舊式下成立。
  //    改成到貨量起算後,`null` 一律 fail-closed(`types.ts:638-660` 的契約)。
  //    🔴 原因是 `unknown` **不是** `not_arrived`:`mapQuantitySummary` 吐 null 有三個來源
  //    (缺列 / 讀不到 / C7 被違反),這裡分不出是哪個,說「未到貨」就是編造。
  it('🔴 quantitySummary 讀不到 → 可出 0 且原因 = `unknown`(擋的是有人補 `?? it.quantity` fail-open)', async () => {
    findAdminOrderDetail.mockResolvedValue(
      detail({ items: [{ ...detail().items[0]!, quantitySummary: null }] }),
    );
    const { loadShipmentCandidates } = await import('./shipment-candidates');
    const r = await loadShipmentCandidates(['o1']);
    expect(
      r.items[0]?.remaining,
      '讀不到卻吐出可出數量 ⇒ 有人把「不知道」翻譯成「訂購量都能出」,' +
        '而這種品項在 DB 那邊 avail=0、掛品項必被 pcm_b2_w3b2_exceeds_instock 退件。',
    ).toBe(0);
    expect(
      r.items[0]?.blockedReason,
      '把「不知道」標成「未到貨」= 編一個看起來正常的原因給員工,' +
        '而真正的情況可能是投影退版或資料損壞(mapQuantitySummary 的三個 null 來源分不出來)。',
    ).toBe('unknown');
  });
});

// ─────────────────────────────────────────────────────────────
// 排序(Sean 2026-08-10 晚拍 A;backlog `:9425`)。
// ─────────────────────────────────────────────────────────────
describe('🔴 可出的排前面、出不了的沉底', () => {
  /** 三件:到貨 2(可出)/ 未到貨 / 到貨 1(可出)—— 刻意讓可出的被出不了的隔開。 */
  const mixed = () => {
    const base = detail().items[0]!;
    return detail({
      items: [
        { ...base, id: 'oi-a', title: 'A 可出', quantitySummary: { quantity: 4, orderedQuantity: 4, instockQuantity: 2, cancelledQuantity: 0, cancellableQuantity: 2 } },
        { ...base, id: 'oi-b', title: 'B 未到貨', quantitySummary: { quantity: 4, orderedQuantity: 4, instockQuantity: 0, cancelledQuantity: 0, cancellableQuantity: 4 } },
        { ...base, id: 'oi-c', title: 'C 可出', quantitySummary: { quantity: 4, orderedQuantity: 4, instockQuantity: 1, cancelledQuantity: 0, cancellableQuantity: 3 } },
      ],
    });
  };

  it('出不了的沉到最後', async () => {
    findAdminOrderDetail.mockResolvedValue(mixed());
    const { loadShipmentCandidates } = await import('./shipment-candidates');
    const r = await loadShipmentCandidates(['o1']);
    expect(
      r.items.map((i) => i.title),
      '出不了的沒沉底 ⇒ 能出的那幾件散在一堆灰列中間,員工還是要逐列找。',
    ).toEqual(['A 可出', 'C 可出', 'B 未到貨']);
  });

  it('🔴 同一組內維持原順序(排序必須穩定,否則對不上訂單頁)', async () => {
    findAdminOrderDetail.mockResolvedValue(
      detail({
        // 三件全部未到貨 ⇒ 排序鍵完全相同,任何 tie-breaker 都會露餡。
        items: ['oi-x', 'oi-y', 'oi-z'].map((id) => ({
          ...detail().items[0]!,
          id,
          title: id,
          quantitySummary: { quantity: 4, orderedQuantity: 4, instockQuantity: 0, cancelledQuantity: 0, cancellableQuantity: 4 },
        })),
      }),
    );
    const { loadShipmentCandidates } = await import('./shipment-candidates');
    expect(
      (await loadShipmentCandidates(['o1'])).items.map((i) => i.title),
      '同組內順序被打散 ⇒ 比較子多比了「能不能出」以外的鍵,彈窗與訂單頁對不起來。',
    ).toEqual(['oi-x', 'oi-y', 'oi-z']);
  });
});

describe('多張訂單 · 邊界', () => {
  it('跨單的品項會被攤平成同一份清單,各自標示來源單號', async () => {
    findAdminOrderDetail
      .mockResolvedValueOnce(detail())
      .mockResolvedValueOnce(detail({ id: 'o2', displayId: 'PCM-0002' }));
    const { loadShipmentCandidates } = await import('./shipment-candidates');
    const r = await loadShipmentCandidates(['o1', 'o2']);
    expect(r.items.map((i) => i.orderDisplayId)).toEqual(['PCM-0001', 'PCM-0002']);
  });

  it('收件資料形狀恰好是 name/phone/line 三欄(RPC 多一個少一個都退件)', async () => {
    findAdminOrderDetail.mockResolvedValue(detail());
    const { loadShipmentCandidates } = await import('./shipment-candidates');
    const r = await loadShipmentCandidates(['o1']);
    expect(Object.keys(r.recipient ?? {}).sort()).toEqual(['line', 'name', 'phone']);
  });

  it('空輸入 / 查無訂單 → 空清單,不打後續查詢', async () => {
    const { loadShipmentCandidates } = await import('./shipment-candidates');
    expect(await loadShipmentCandidates([])).toEqual({
      items: [],
      customerUserId: null,
      recipient: null,
    });
    expect(findAdminOrderDetail).not.toHaveBeenCalled();

    findAdminOrderDetail.mockResolvedValue(null);
    expect(await loadShipmentCandidates(['nope'])).toEqual({
      items: [],
      customerUserId: null,
      recipient: null,
    });
    expect(listAssigned, '查無訂單時仍去查已配箱數量 ⇒ 多打一次沒有意義的 DB').not.toHaveBeenCalled();
    expect(listCustomers, '查無訂單時仍去查客人 ⇒ 同上').not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
// D-373-A 任務 1:料號 + server 端客人身分。
// ─────────────────────────────────────────────────────────────
describe('料號(2026-08-09 Sean 實測後追加)', () => {
  it('🔴 DTO 帶 `variantSku`,值取自品項本身(不是抄品名、不是抄單號)', async () => {
    findAdminOrderDetail.mockResolvedValue(detail());
    const { loadShipmentCandidates } = await import('./shipment-candidates');
    const r = await loadShipmentCandidates(['o1']);
    expect(
      r.items[0]!.variantSku,
      '料號不見了或被抄成別欄 ⇒ 員工在彈窗裡對不到實物上的標籤,' +
        '而「訂單編號 + 商品名稱 + 料號三件都在」正是 Sean 實測後逐字要的。',
    ).toBe('S-Y10E9-HGEH');
  });

  it('🔴 料號是**每列各自的**,不是整批共用一個值', async () => {
    const base = detail().items[0]!;
    findAdminOrderDetail.mockResolvedValue(
      detail({
        items: [
          base,
          { ...base, id: 'oi-2', title: '另一件', variantSku: 'K-9921-BLK' },
        ],
      }),
    );
    const { loadShipmentCandidates } = await import('./shipment-candidates');
    const r = await loadShipmentCandidates(['o1']);
    expect(
      r.items.map((i) => i.variantSku),
      '兩列的料號一樣 ⇒ 實作可能是取第一筆再套給全部,員工會照著錯的料號撿貨',
    ).toEqual(['S-Y10E9-HGEH', 'K-9921-BLK']);
  });
});

describe('🔴🔴 第 ③ 道閘 — 客人身分由 server 查、跨客人不給建箱', () => {
  it('單一客人 → 回那位客人的 id(值來自 `orders`,不是輸入)', async () => {
    findAdminOrderDetail.mockResolvedValue(detail());
    listCustomers.mockResolvedValue(new Map([['o1', 'cu-from-db']]));
    const { loadShipmentCandidates } = await import('./shipment-candidates');
    expect((await loadShipmentCandidates(['o1'])).customerUserId).toBe('cu-from-db');
  });

  it('🔴 兩張單屬於不同客人 → `null`(呼叫端開不了窗,不會送出一箱裝兩位客人)', async () => {
    findAdminOrderDetail
      .mockResolvedValueOnce(detail())
      .mockResolvedValueOnce(detail({ id: 'o2', displayId: 'PCM-0002' }));
    listCustomers.mockResolvedValue(
      new Map([
        ['o1', 'cu-A'],
        ['o2', 'cu-B'],
      ]),
    );
    const { loadShipmentCandidates } = await import('./shipment-candidates');
    const r = await loadShipmentCandidates(['o1', 'o2']);
    expect(
      r.customerUserId,
      '跨客人卻吐出一個客人 id ⇒ 建箱 RPC 會拿其中一位去建,另一位的品項在掛品項時被 DB 退件,' +
        '而箱子已經建出來了(半成品)。',
    ).toBeNull();
    expect(r.items.length, '品項清單本身不受影響(擋的是建箱、不是顯示)').toBe(2);
  });

  it('🔴 有訂單查不到客人 → `null`(不是拿剩下那位「湊」一個出來)', async () => {
    findAdminOrderDetail
      .mockResolvedValueOnce(detail())
      .mockResolvedValueOnce(detail({ id: 'o2', displayId: 'PCM-0002' }));
    // o2 不在 Map 裡 = 它的 customer_user_id 是 null 或那列讀不到。
    listCustomers.mockResolvedValue(new Map([['o1', 'cu-A']]));
    const { loadShipmentCandidates } = await import('./shipment-candidates');
    expect(
      (await loadShipmentCandidates(['o1', 'o2'])).customerUserId,
      '少一張單的客人卻照樣回傳 ⇒ 那張單的品項會被掛進別人的箱子。',
    ).toBeNull();
  });

  it('前提 — 只拿「查得到明細」的單去問客人(否則查無會被誤判成跨客人)', async () => {
    findAdminOrderDetail
      .mockResolvedValueOnce(detail())
      .mockResolvedValueOnce(null); // o2 查無
    listCustomers.mockResolvedValue(new Map([['o1', 'cu-A']]));
    const { loadShipmentCandidates } = await import('./shipment-candidates');
    const r = await loadShipmentCandidates(['o1', 'o2']);
    expect(listCustomers, '拿了沒濾過的輸入清單去問').toHaveBeenCalledWith(['o1']);
    expect(r.customerUserId, '一張單查無就整批建不了箱 ⇒ 員工會卡在一個沒有解釋的錯誤').toBe('cu-A');
  });
});
