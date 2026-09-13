// workflow-form.test.ts — 後台改單純函式核心(M-4a Slice C;Origin 白名單 + 表單→patch 解析)。

import { describe, it, expect } from 'vitest';
import {
  isAllowedOrigin,
  parseWorkflowPatchForm,
  ORDER_ID_FIELD,
  VERSION_FIELD,
  SHIPPING_METHOD_FIELD,
  INVOICE_NUMBER_FIELD,
  INVOICE_AMOUNT_FIELD,
  INVOICE_STATUS_FIELD,
  RETURN_TO_FIELD,
  WORKFLOW_SINGLE_FIELDS,
  invoiceIssuedAtDefault,
  type FormLike,
} from './workflow-form';

const UUID = '11111111-2222-3333-4444-555555555555';

// #365 片②:假表單整個拿掉,改用**真 FormData** —— `FormLike` 已收窄成只有 `getAll()`
// (`get()` / `has()` 分不出「送一份」與「送兩份」,型別上就不再提供),而手寫的假表單
// 正是「單值情境永遠只回一筆」那種讓重複欄位測不出來的形狀。
function form(entries: Record<string, string>): FormLike {
  const data = new FormData();
  for (const [name, value] of Object.entries(entries)) data.set(name, value);
  return data;
}

describe('isAllowedOrigin — fail-closed', () => {
  it('缺 Origin(null/空)→ 拒', () => {
    expect(isAllowedOrigin(null, { devBypass: false, host: null })).toBe(false);
    expect(isAllowedOrigin('', { devBypass: true, host: 'localhost:3011' })).toBe(false);
    expect(isAllowedOrigin(undefined, { devBypass: true, host: 'localhost:3011' })).toBe(false);
  });

  it('prod 精確等值 admin 網域;近似值/子網域/host 不放行', () => {
    expect(
      isAllowedOrigin('https://admin.pcmmotorsports.com', { devBypass: false, host: null }),
    ).toBe(true);
    for (const bad of [
      'https://admin.pcmmotorsports.com.evil.com',
      'https://quote.pcmmotorsports.com',
      'http://admin.pcmmotorsports.com',
      'https://admin.pcmmotorsports.com/',
    ]) {
      expect(isAllowedOrigin(bad, { devBypass: false, host: null })).toBe(false);
    }
  });

  it('dev bypass 允許 localhost;非 bypass 不允許', () => {
    // 🔴 **這四格的期望值一個都沒改**(`#948`,2026-08-27)—— 改的是**呼叫的形狀**:
    //    多帶一個 `host`,而 `host` 對得上時,`localhost:3213` 仍然放行。
    //    ⚠️ **舊的寫法為什麼是錯的**:原本這一行逐字是
    //      `isAllowedOrigin('http://localhost:3213', { devBypass: true })` ⇒ `true`
    //    而 **3213 在本 repo 裡除了這支測試檔以外查無**(`grep -rn 3213` 排除 node_modules ⇒ 5 行,
    //    全在本檔;正對照 `3001` ⇒ 92 行)⇒ 它不是任何一個**被設定過**的 dev 埠。
    //    ⚠️ **而這不是一個永久成立的宣稱**(codex 對抗審查 2026-08-27 訂正我原本那句
    //       「3213 不是任何一個 dev 埠」):有人跑 `next dev -p 3213` 它當場就變假。
    //       ⇒ 這一格真正證明的是「**Host 與 Origin 對得上就放行**」,不是「3213 很特別」。
    //    舊寫法斷言的其實是「**任何埠都放行**」——
    //    也就是 `#948` 那個洞本身,**被一格測試釘成了期望行為**。
    //    📌 一個洞如果有測試在保護它,修它就會讓測試變紅 ⇒ **那個紅看起來像退步。**
    //       所以這裡刻意保留原本的埠與期望值,只補上 `host` —— 讓「什麼變了」看得出來。
    expect(isAllowedOrigin('http://localhost:3213', { devBypass: true, host: 'localhost:3213' })).toBe(
      true,
    );
    expect(isAllowedOrigin('http://127.0.0.1:3000', { devBypass: true, host: '127.0.0.1:3000' })).toBe(
      true,
    );
    expect(
      isAllowedOrigin('http://localhost:3213', { devBypass: false, host: 'localhost:3213' }),
    ).toBe(false);
    expect(
      isAllowedOrigin('http://evil.localhost.com', { devBypass: true, host: 'evil.localhost.com' }),
    ).toBe(false);
  });

  it('🔴 `#948` dev 跨埠必拒:Origin 的埠與本伺服器的 host 不同 ⇒ 不放行', () => {
    // 正對照(該通的要通):同一個埠 ⇒ 放行。沒有這一格,下面全紅也看起來「很安全」。
    expect(isAllowedOrigin('http://localhost:3011', { devBypass: true, host: 'localhost:3011' })).toBe(
      true,
    );
    // 🔴 本體:敵意頁在別的埠。瀏覽器會把 Host 設成【被打的那台】⇒ 兩者不等 ⇒ 擋掉。
    for (const [origin, host] of [
      ['http://localhost:4001', 'localhost:3011'],
      ['http://localhost:3011', 'localhost:4001'],
      ['http://127.0.0.1:4001', '127.0.0.1:3011'],
      // 同一台但寫法不同(localhost vs 127.0.0.1)也不算同源 —— 兩者在瀏覽器眼中是不同 origin。
      ['http://localhost:3011', '127.0.0.1:3011'],
      ['http://127.0.0.1:3011', 'localhost:3011'],
    ] as const) {
      expect(isAllowedOrigin(origin, { devBypass: true, host }), `${origin} vs ${host}`).toBe(false);
    }
  });

  it('🔴 `#948` fail-closed:沒給 host ⇒ dev 分支拒(而 prod 那條不受影響)', () => {
    for (const host of [null, undefined, '']) {
      expect(isAllowedOrigin('http://localhost:3011', { devBypass: true, host }), `host=${host}`).toBe(
        false,
      );
    }
    // 而 prod 白名單那條在 host 缺席時照樣成立 —— 它從來不比 host。
    expect(
      isAllowedOrigin('https://admin.pcmmotorsports.com', { devBypass: true, host: null }),
    ).toBe(true);
  });

  it('🔴 `#948` host 被偽造也不會把別人的 origin 放行(威脅模型的邊界,明寫)', () => {
    // 能偽造 Host 的客戶端**沒有受害者的 cookie** ⇒ 它偽造成功也拿不到身分。
    // 這一格釘住的是:偽造 Host 只能讓【它自己那個 origin】通過,不能讓別的 origin 通過。
    expect(isAllowedOrigin('http://localhost:4001', { devBypass: true, host: 'bogus.example:9999' })).toBe(
      false,
    );
    // 而非 localhost 形狀的 origin,即使 host 完全吻合也不放行(形狀閘在比對之前)。
    expect(isAllowedOrigin('http://evil.example.com', { devBypass: true, host: 'evil.example.com' })).toBe(
      false,
    );
  });
});

describe('parseWorkflowPatchForm — 形狀守門 + 未提供≠清空', () => {
  it('order_id 非 UUID / version 非法(含上下界)→ ok:false;邊界內 → ok:true', () => {
    expect(parseWorkflowPatchForm(form({ [ORDER_ID_FIELD]: 'PCM-1', [VERSION_FIELD]: '1' })).ok).toBe(false);
    // 🔴 **上界那兩格是 A9w4a(2026-08-06)補的**:原本只有 item 層那組測到 `2147483647`,
    //    本片刪掉 item parser 後,order 層的 `> 2147483646` 變成零覆蓋 —— 把那條 clause 整個拿掉
    //    也會全綠(codex 關卡2 must-fix)。正負兩格併存才擋得住「上界改成 2147483645」這種退化。
    expect(parseWorkflowPatchForm(form({ [ORDER_ID_FIELD]: UUID, [VERSION_FIELD]: '2147483646' })).ok).toBe(true);
    for (const bad of ['0', '-1', '1.5', 'x', '', '2147483647']) {
      expect(parseWorkflowPatchForm(form({ [ORDER_ID_FIELD]: UUID, [VERSION_FIELD]: bad })).ok).toBe(false);
    }
  });

  // 🔴 欄名與哨兵值改用 **wire literal**(A9w4c 後半:`WF_STATUS_FIELD` / `WF_CLEAR_VALUE` 兩常數
  //    隨九碼詞彙面一併刪除)。這裡量的本來就是「**手工 POST 送這個 wire 欄名**會不會進 patch」——
  //    欄名是 wire 契約、不是 TS 常數;`nine-code-retire.test.tsx` 早有「常數名不是欄名」被 R1 抓過的先例。
  it('🔴 D-2(Codex R1 must-fix 1):送 workflow_status(code/哨兵/非法形狀)→ 一律忽略、絕不進 patch(orders 層停寫、寫入路徑關死)', () => {
    for (const v of ['shipped_done', '__clear__', '', 'Bad Code!']) {
      const r = parseWorkflowPatchForm(
        form({ [ORDER_ID_FIELD]: UUID, [VERSION_FIELD]: '5', workflow_status: v, [INVOICE_STATUS_FIELD]: 'issued' }),
      );
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect('workflowStatus' in r.patch).toBe(false);
        expect(Object.keys(r.patch)).toEqual(['invoiceStatus']);
      }
    }
  });

  it('明細頁全欄:invoice 空→清空(null)、非空→設定;shipping 空→ok:false', () => {
    const r = parseWorkflowPatchForm(
      form({
        [ORDER_ID_FIELD]: UUID,
        [VERSION_FIELD]: '5',
        // 🔴 片15:白名單值(`' 宅配 '` 已不合法)。**前後空白仍要被 trim** ⇒ 這裡刻意保留空白。
        [SHIPPING_METHOD_FIELD]: ' home ',
        [INVOICE_NUMBER_FIELD]: '',
        [INVOICE_AMOUNT_FIELD]: '',
        [INVOICE_STATUS_FIELD]: 'issued',
      }),
    );
    expect(r).toMatchObject({
      ok: true,
      patch: { shippingMethod: 'home', invoiceNumber: null, invoiceAmount: null, invoiceStatus: 'issued' },
    });

    expect(
      parseWorkflowPatchForm(
        form({ [ORDER_ID_FIELD]: UUID, [VERSION_FIELD]: '5', [SHIPPING_METHOD_FIELD]: '   ' }),
      ).ok,
    ).toBe(false); // shipping NOT NULL
  });

  /**
   * 🔴🔴 **片15(2026-08-19):白名單擋在 parser,不是只擋在畫面上。**
   *
   * 畫面那顆 `<select>` 只是 UX —— **一發 POST 就繞過去了**。而下游沒有第二道:
   *   · `orders.shipping_method` **沒有表 CHECK**(建表 migration `20260604120000…:105` 逐字
   *     「白名單在 RPC…不加表 CHECK」)
   *   · 而那道 RPC 白名單(`20260630120000…:144-145`)**只在【下單】那條路上**,改單不經過它
   * ⇒ 在這道守門之前,後台改單可以把**任何 64 字以內的字串**寫進正式欄位,而沒有東西會紅。
   * 🔴 下游真的在讀它:退款運費重算 `mode === 'store' ? 0 : fee` ⇒ 非 `store` 的雜訊值一律當宅配算運費。
   *
   * ⚠️ **正向對照少不得**:只留否定式的話,parser 整支壞掉(什麼都回 ok:false)時這一格照樣綠。
   */
  it('🔴 shipping_method 白名單:home / store 收;其餘一律 ok:false', () => {
    const withMethod = (m: string) =>
      parseWorkflowPatchForm(
        form({ [ORDER_ID_FIELD]: UUID, [VERSION_FIELD]: '5', [SHIPPING_METHOD_FIELD]: m }),
      );
    // 正向對照:白名單兩個都要收得下,否則下面那串否定式沒有判別力
    expect(withMethod('home')).toMatchObject({ ok: true, patch: { shippingMethod: 'home' } });
    expect(withMethod('store')).toMatchObject({ ok: true, patch: { shippingMethod: 'store' } });
    // 🔴 非白名單:快遞名 / 中文 / 大小寫變體 / 前後綴 —— 都不准進去
    for (const bad of ['黑貓', '新竹物流', '宅配', 'Home', 'HOME', 'home x', 'homestore', 'delivery']) {
      expect(withMethod(bad).ok, `非白名單值「${bad}」被放進去了`).toBe(false);
    }
  });

  it('invoice_amount 十進位整數 → 設定;小數/負/非數字 → ok:false', () => {
    const good = parseWorkflowPatchForm(
      form({ [ORDER_ID_FIELD]: UUID, [VERSION_FIELD]: '5', [INVOICE_AMOUNT_FIELD]: '10920' }),
    );
    expect(good.ok && good.patch.invoiceAmount).toBe(10920);
    // nit-5:int4 上限 2147483647 內過、超過拒(form 層擋、不讓 RPC ::integer 溢位走 error)
    expect(
      parseWorkflowPatchForm(form({ [ORDER_ID_FIELD]: UUID, [VERSION_FIELD]: '5', [INVOICE_AMOUNT_FIELD]: '2147483647' })).ok,
    ).toBe(true);
    for (const bad of ['10.5', '-1', '1,000', 'abc', '2147483648', '9999999999']) {
      expect(
        parseWorkflowPatchForm(form({ [ORDER_ID_FIELD]: UUID, [VERSION_FIELD]: '5', [INVOICE_AMOUNT_FIELD]: bad })).ok,
      ).toBe(false);
    }
  });

  it('invoice_status 非三值 → ok:false', () => {
    expect(
      parseWorkflowPatchForm(
        form({ [ORDER_ID_FIELD]: UUID, [VERSION_FIELD]: '5', [INVOICE_STATUS_FIELD]: 'weird' }),
      ).ok,
    ).toBe(false);
  });

  it('return_to:站內 /orders 路徑保留;外部/他路徑退回這張單的明細頁(防 open redirect)', () => {
    const inPath = parseWorkflowPatchForm(
      form({ [ORDER_ID_FIELD]: UUID, [VERSION_FIELD]: '5', workflow_status: 'shipped_done', [RETURN_TO_FIELD]: `/orders/${UUID}` }),
    );
    expect(inPath.ok && inPath.returnTo).toBe(`/orders/${UUID}`);
    // nit-6:`..` 站內 redirect gadget(/orders/../../api/sso/start)拒
    // 🔴 **#350d:fallback 從 `/orders` 改成 `/orders/{orderId}`**(契約 §3 逐字)——
    //    非法的 return_to 不該把正在看這張單的員工踢回列表。守門本體已搬到
    //    `order-return-to.test.ts`(那裡有 16 種非法形狀 + 512 邊界 + decode 那道);
    //    這裡留一格**接線**斷言:本 parser 真的走那支、不是自己留了一份舊的正規式。
    for (const evil of ['https://evil.com', '//evil.com', '/customers', '/orders\n/x', '/orders/../../api/sso/start']) {
      const r = parseWorkflowPatchForm(
        form({ [ORDER_ID_FIELD]: UUID, [VERSION_FIELD]: '5', workflow_status: 'shipped_done', [RETURN_TO_FIELD]: evil }),
      );
      expect(r.ok && r.returnTo).toBe(`/orders/${UUID}`);
    }
    // 🔴 #350d 新行為:一次性參數被剝掉(舊的那份正規式做不到這件事 ⇒ 這條也是接線證據)。
    const withResult = parseWorkflowPatchForm(
      form({
        [ORDER_ID_FIELD]: UUID,
        [VERSION_FIELD]: '5',
        workflow_status: 'shipped_done',
        [RETURN_TO_FIELD]: `/orders?panel=${UUID}&r=saved&rt=${UUID}`,
      }),
    );
    expect(withResult.ok && withResult.returnTo).toBe(`/orders?panel=${UUID}`);
  });
});

// 🔴 `parseItemWorkflowForm — 形狀守門(item 層)` 4 條:**A9w4a(2026-08-06)隨受測函式一併移除**
//    (母 plan row 53)。order 層的 return_to / version 守門仍在上方 `parseWorkflowPatchForm` 那組。

// ── #365 片②:單值欄位「getAll 恰一筆」 ────────────────────────────────────────────────
//
// 🔴 為什麼是真 FormData 而不是假表單:重複欄位只有真 FormData 造得出來(`append` 兩次),
//    上面那支 `form()` 幫手在片② 之前是 Map 支撐的、單值情境永遠只回一筆 ⇒ 這一整族測不出來。
describe('parseWorkflowPatchForm — #365 單值欄位恰一筆', () => {
  function base(): FormData {
    const d = new FormData();
    d.set(ORDER_ID_FIELD, UUID);
    d.set(VERSION_FIELD, '5');
    return d;
  }

  // 🔴 **手寫清單、不 `it.each(WORKFLOW_SINGLE_FIELDS)`**:走訪受測常數本身是循環論證 ——
  //    清單少一欄,測項也跟著少一條,全綠(片① 關卡2 codex 抓到的形狀)。
  const EXPECTED_SINGLE_FIELDS = [
    'order_id',
    'version',
    'shipping_method',
    'invoice_number',
    'invoice_amount',
    'invoice_status',
    // 第 3 代(20260913060000):抬頭 / 統編。手寫 wire 名, **不引常數** —— 這格守的正是常數與 wire 名對不對。
    'invoice_title',
    'invoice_tax_id',
    // 🔴 2026-09-13 P2:開立日。**本格在 B 窗加進 `WORKFLOW_SINGLE_FIELDS` 的當下真的紅過** —— 那是它有判別力的證據。
    //    (兩支分支合體:第 4 代 = 抬頭 / 統編 + 開立日, 九顆。)
    'invoice_issued_at',
  ];

  // ── 2026-09-13 P2:invoice_issued_at ────────────────────────────────────────
  // 🔴 這一層【只驗形狀】:「不得未來 / 不得早於成立日 / issued 一定要有」住在 RPC(各帶專屬 SQLSTATE),
  //    這裡再判一次就是同一條規則兩份 —— 而兩份會漂。
  describe('invoiceIssuedAtDefault(預填規則;一份, 兩個表單共用)', () => {
    // 🔴🔴 根因:任何不是員工自己打的日期都會被原樣送出, 而 RPC 分不出「打的」與「自動送的」。
    //    兩輪 codex 各重現一種:重開沿用舊值(歸回上個月)/ 跨午夜的「今天」(算進上個月)。
    it('issued ⇒ 既有;既有是 null ⇒ 空(不補今天 —— 那是 P1b 之前的舊列, 逼他填真的)', () => {
      expect(invoiceIssuedAtDefault({ invoiceStatus: 'issued', invoiceIssuedAt: '2026-04-16' })).toBe('2026-04-16');
      expect(invoiceIssuedAtDefault({ invoiceStatus: 'issued', invoiceIssuedAt: null })).toBe('');
    });
    it('🔴🔴 voided ⇒ 空, 就算列上有日期(重開必須重填)', () => {
      expect(invoiceIssuedAtDefault({ invoiceStatus: 'voided', invoiceIssuedAt: '2026-09-28' })).toBe('');
    });
    it('🔴🔴 not_issued ⇒ 空 —— ⛔ ~~預設今天~~(跨午夜會錯月);殘留日期也不用', () => {
      expect(invoiceIssuedAtDefault({ invoiceStatus: 'not_issued', invoiceIssuedAt: '2026-01-01' })).toBe('');
      expect(invoiceIssuedAtDefault({ invoiceStatus: 'not_issued', invoiceIssuedAt: null })).toBe('');
    });
  });

  describe('invoice_issued_at(2026-09-13 P2)', () => {
    const with_ = (v: string) =>
      form({ [ORDER_ID_FIELD]: UUID, [VERSION_FIELD]: '5', invoice_issued_at: v });
    it('`YYYY-MM-DD` ⇒ 原樣進 patch(字串, 不是 Date)', () => {
      const r = parseWorkflowPatchForm(with_('2026-09-05'));
      expect(r.ok && r.patch.invoiceIssuedAt).toBe('2026-09-05');
    });
    it('空字串 ⇒ null(清空), 與 invoice_number 同一個語意', () => {
      const r = parseWorkflowPatchForm(with_(''));
      expect(r.ok && r.patch.invoiceIssuedAt).toBeNull();
    });
    it('沒送這一欄 ⇒ 不進 patch(RPC 不動該欄)', () => {
      const r = parseWorkflowPatchForm(form({ [ORDER_ID_FIELD]: UUID, [VERSION_FIELD]: '5' }));
      expect(r.ok && 'invoiceIssuedAt' in r.patch).toBe(false);
    });
    it.each([['2026/09/05'], ['20260905'], ['2026-9-5'], ['05-09-2026'], ['明天'], ['2026-09-05T00:00:00Z']])(
      '形狀不對 %s ⇒ ok:false',
      (v) => {
        expect(parseWorkflowPatchForm(with_(v)).ok).toBe(false);
      },
    );
    it('🔵 未來日期【在這一層過】—— 那是 RPC 的事(P9I03), 這裡不做第二份', () => {
      expect(parseWorkflowPatchForm(with_('2999-01-01')).ok).toBe(true);
    });
  });

  it('入口清單 = 手寫的九顆 wire 欄名(漏列一欄 ⇒ 那一欄的洞無症狀)', () => {
    expect([...WORKFLOW_SINGLE_FIELDS]).toEqual(EXPECTED_SINGLE_FIELDS);
    // 🔴 `return_to` **刻意不在清單內**(判斷不是遺漏;理由見 `WORKFLOW_SINGLE_FIELDS` docstring)。
    expect([...WORKFLOW_SINGLE_FIELDS]).not.toContain(RETURN_TO_FIELD);
  });

  // ── 第 3 代:抬頭 / 統編的三態(沒送 ≠ 清空 ≠ 有值)—— 與 invoice_number 同一條語意 ──
  it('🔴 抬頭 / 統編:沒送 ⇒ 不進 patch;空 ⇒ null(清空);有值 ⇒ trim 後原樣送', () => {
    const none = parseWorkflowPatchForm(base());
    expect(none.ok && 'invoiceTitle' in none.patch, '沒送卻進了 patch ⇒ RPC 會把它當成清空').toBe(false);
    expect(none.ok && 'invoiceTaxId' in none.patch).toBe(false);

    const cleared = base();
    cleared.set('invoice_title', '  ');
    cleared.set('invoice_tax_id', '');
    const c = parseWorkflowPatchForm(cleared);
    expect(c.ok && c.patch.invoiceTitle).toBeNull();
    expect(c.ok && c.patch.invoiceTaxId).toBeNull();

    const filled = base();
    filled.set('invoice_title', ' 傑藝有限公司 ');
    filled.set('invoice_tax_id', '12345678');
    const f = parseWorkflowPatchForm(filled);
    expect(f.ok && f.patch.invoiceTitle).toBe('傑藝有限公司');
    expect(f.ok && f.patch.invoiceTaxId).toBe('12345678');
  });

  // 🔴 這一層【刻意不驗】8 碼 / 半填 / donate —— 那些在 RPC(第二份實作會漂)。
  //    所以 7 碼在這裡是 ok:true, 由 RPC RAISE;這一格釘住「parser 不擋」, 免得有人順手加一道然後兩邊不一致。
  it('🔵 parser 不驗統編格式(7 碼照送 ⇒ ok:true, 由 RPC 擋)', () => {
    const d = base();
    d.set('invoice_tax_id', '1234567');
    const r = parseWorkflowPatchForm(d);
    expect(r.ok).toBe(true);
    expect(r.ok && r.patch.invoiceTaxId).toBe('1234567');
  });

  // 兩份都是**各自合法**的值 ⇒ 被拒的原因只可能是「送了兩份」,不是值本身不合法。
  const GOOD: Record<string, string> = {
    order_id: UUID,
    version: '5',
    // 🔴 片15:`'黑貓'` 已不是合法值(白名單 home/store 從畫面移進 parser)。
    //    ⚠️ 這個 fixture 的用途是「**各自合法**的值 ⇒ 被拒只可能因為送了兩份」——
    //       留著非白名單值會讓那格失去它要證的東西(被拒的原因會變成兩個)。
    shipping_method: 'home',
    invoice_number: 'AB-12345678',
    invoice_amount: '1200',
    invoice_status: 'issued',
    invoice_title: '傑藝有限公司',
    invoice_tax_id: '12345678',
    // 🔵 2026-09-13 P2:合法形狀 `YYYY-MM-DD`(範圍不在這一層驗 ⇒ 任何一個過去的日期都合法)。
    invoice_issued_at: '2026-09-05',
  };
  // 🔴 查不到就當場炸,不回 undefined —— 清單加了新欄卻忘了補合法值時,
  //    這格會變成「拿 undefined 去送」而靜默失去判別力。
  function goodValueOf(field: string): string {
    const v = GOOD[field];
    if (v === undefined) throw new Error(`fixture 缺 ${field} 的合法值`);
    return v;
  }

  it.each(EXPECTED_SINGLE_FIELDS)('%s 送兩份 → ok:false(不採第一筆)', (field) => {
    const d = base();
    d.set(field, goodValueOf(field));
    d.append(field, goodValueOf(field));
    expect(parseWorkflowPatchForm(d).ok).toBe(false);
    // 正向對照:同樣的值只送一份 ⇒ 過。證明上面那格紅的是「兩份」而不是那個值。
    const one = base();
    one.set(field, goodValueOf(field));
    expect(parseWorkflowPatchForm(one).ok).toBe(true);
  });

  // 🔴 **第二種形狀:單一 File**(片① 關卡2 codex 抓到的 —— 數量是 1、只數 length 的擋門放行)。
  //    這兩欄的舊寫法會把非字串收斂成 `''`,而 `''` 在它們的語意是 **「清空」**
  //    ⇒ 舊行為 = 送一顆 File 就靜默清掉發票號 / 發票金額,且回 ok:true。
  it.each([
    [INVOICE_NUMBER_FIELD, 'invoiceNumber'],
    [INVOICE_AMOUNT_FIELD, 'invoiceAmount'],
    // 第 3 代:抬頭 / 統編也是「空 = 清空」語意 ⇒ 同一個坑, 同一格守。
    ['invoice_title', 'invoiceTitle'],
    ['invoice_tax_id', 'invoiceTaxId'],
  ])('%s 送單一 File → ok:false(舊行為是靜默清空該欄)', (field) => {
    const d = base();
    d.set(field, new File(['x'], 'x.txt'));
    expect(parseWorkflowPatchForm(d).ok).toBe(false);
  });

  it('return_to 送兩份 → 走 fallback、但寫入照常成立(它不決定寫什麼)', () => {
    const d = base();
    d.set(INVOICE_STATUS_FIELD, 'issued');
    d.append(RETURN_TO_FIELD, `/orders?panel=${UUID}`);
    d.append(RETURN_TO_FIELD, '/orders?panel=evil');
    const r = parseWorkflowPatchForm(d);
    expect(r.ok).toBe(true);
    expect(r.ok && r.returnTo).toBe(`/orders/${UUID}`);
    expect(r.ok && r.patch.invoiceStatus).toBe('issued');
  });
});
