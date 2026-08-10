import { describe, it, expect } from 'vitest';
import {
  parseProcurementForm,
  PROCUREMENT_REPLY_STATUSES,
  type FormLike,
  PROCUREMENT_SINGLE_FIELDS,
} from './procurement-form';
import {
  PROC_ALLOCATED_FIELD,
  PROC_CONTACT_CHANNEL_FIELD,
  PROC_EXCEPTION_REASON_FIELD,
  PROC_EXPECTED_ARRIVAL_FIELD,
  PROC_ORDER_ID_FIELD,
  PROC_ORDER_ITEM_ID_FIELD,
  PROC_REPLY_STATUS_FIELD,
  PROC_SUBMITTED_AT_FIELD,
  PROC_SUPPLIER_ID_FIELD,
  PROC_SUPPLIER_ORDER_NO_FIELD,
} from './procurement-action-state';

// M-4b E10 A10b:採購表單解析器。合約來源 = A5a migration 20260803160000。

const ORDER = '11111111-1111-4111-8111-111111111111';
const ITEM = '22222222-2222-4222-8222-222222222222';
const SUPPLIER = '33333333-3333-4333-8333-333333333333';

function form(over: Record<string, string> = {}): FormLike {
  const base: Record<string, string> = {
    [PROC_ORDER_ID_FIELD]: ORDER,
    [PROC_ORDER_ITEM_ID_FIELD]: ITEM,
    [PROC_SUPPLIER_ID_FIELD]: SUPPLIER,
    [PROC_ALLOCATED_FIELD]: '2',
    [PROC_REPLY_STATUS_FIELD]: 'confirmed',
    [PROC_CONTACT_CHANNEL_FIELD]: '',
    [PROC_SUBMITTED_AT_FIELD]: '',
    [PROC_SUPPLIER_ORDER_NO_FIELD]: '',
    [PROC_EXCEPTION_REASON_FIELD]: '',
    [PROC_EXPECTED_ARRIVAL_FIELD]: '',
    ...over,
  };
  // #365:單值讀法改走 getAll 恰一筆 ⇒ 假表單補這一支(單值情境回 0 或 1 筆)。
  return {
    get: (name) => base[name] ?? null,
    getAll: (name) => (name in base ? [base[name] as string] : []),
  };
}

describe('parseProcurementForm — 形狀閘', () => {
  it('完整合法表單 → ok,選填欄空字串收斂成 null', () => {
    const parsed = parseProcurementForm(form());
    expect(parsed).toEqual({
      ok: true,
      orderId: ORDER,
      orderItemId: ITEM,
      supplierId: SUPPLIER,
      allocatedQuantity: 2,
      replyStatus: 'confirmed',
      contactChannel: null,
      submittedAtLocal: null,
      supplierOrderNo: null,
      exceptionReason: null,
      expectedArrivalDate: null,
    });
  });

  it.each([PROC_ORDER_ID_FIELD, PROC_ORDER_ITEM_ID_FIELD, PROC_SUPPLIER_ID_FIELD])(
    '%s 非 uuid → ok:false',
    (field) => {
      expect(parseProcurementForm(form({ [field]: 'not-a-uuid' })).ok).toBe(false);
    },
  );

  // 🔴 失敗時仍要帶出 orderItemId —— 一張單多份表單,錯誤要顯示在對的那一份上。
  it('解析失敗但 orderItemId 合法 → 仍帶回 orderItemId(錯誤要顯示在對的表單上)', () => {
    const parsed = parseProcurementForm(form({ [PROC_SUPPLIER_ID_FIELD]: '' }));
    expect(parsed.ok).toBe(false);
    expect(parsed.orderItemId).toBe(ITEM);
  });

  it('orderItemId 自己就壞掉 → orderItemId 回 null(呼叫端顯示在頁層)', () => {
    const parsed = parseProcurementForm(form({ [PROC_ORDER_ITEM_ID_FIELD]: 'x' }));
    expect(parsed.ok).toBe(false);
    expect(parsed.orderItemId).toBeNull();
  });
});

describe('parseProcurementForm — 訂購數量只收純十進位整數', () => {
  it('正常整數 → 數字', () => {
    const parsed = parseProcurementForm(form({ [PROC_ALLOCATED_FIELD]: '17' }));
    expect(parsed.ok && parsed.allocatedQuantity).toBe(17);
  });

  // 🔴 這幾個字面 `Number()` / `parseInt()` 都會**默默**變成合法數量寫進採購真相表。
  it.each(['1e3', ' 12 ', '0x10', '12abc', '1.5', '-3', '', '٣', '1_0'])(
    '%s → ok:false(不得被 Number/parseInt 默默救回來)',
    (raw) => {
      expect(parseProcurementForm(form({ [PROC_ALLOCATED_FIELD]: raw })).ok).toBe(false);
    },
  );

  // 值域(1..100000)是 RPC 的單一真相 ⇒ 這裡只擋形狀,`0` 與 `999999` 都放行、由 RPC 回固定碼。
  it('0 與 999999 形狀合法 → 放行給 RPC 判值域(不在本層重做規格)', () => {
    expect(parseProcurementForm(form({ [PROC_ALLOCATED_FIELD]: '0' })).ok).toBe(true);
    expect(parseProcurementForm(form({ [PROC_ALLOCATED_FIELD]: '999999' })).ok).toBe(true);
  });
});

describe('parseProcurementForm — 回覆狀態 allowlist', () => {
  it.each(PROCUREMENT_REPLY_STATUSES)('%s 合法', (code) => {
    expect(parseProcurementForm(form({ [PROC_REPLY_STATUS_FIELD]: code })).ok).toBe(true);
  });

  it.each(['', 'shipped', 'NO_REPLY', 'no reply'])('%s → ok:false', (code) => {
    expect(parseProcurementForm(form({ [PROC_REPLY_STATUS_FIELD]: code })).ok).toBe(false);
  });
});

describe('parseProcurementForm — submitted_at 收「無偏移的台北牆上時間」', () => {
  // 🔴 契約 = A5a **本片自己的** `20260803160000:475-476`:「submitted_at 的 offset 由 server 補 Asia/Taipei」。
  //    ⚠️ 備註線 `note-form.ts:48-50` 對 `occurred_at` 的契約是**相反的**(client 產帶偏移的 ISO)——
  //    兩片兩份契約,不要互抄。(關卡2 我抄錯過一次,而且拿錯的那份去反駁審查者。)
  it.each(['2026-08-04T14:30', '2026-08-04T14:30:45'])('%s(無偏移)→ 放行、原樣帶出', (raw) => {
    const parsed = parseProcurementForm(form({ [PROC_SUBMITTED_AT_FIELD]: raw }));
    expect(parsed.ok && parsed.submittedAtLocal).toBe(raw);
  });

  // 🔴 帶偏移 = 呼叫端繞過了「server 補偏移」那條契約 ⇒ fail-closed 擋掉,
  //    否則裝置時區不同的人送進來的時刻會與畫面顯示的不一致、而且沒人看得出來。
  it.each([
    '2026-08-04T14:30+08:00',
    '2026-08-04T06:30:00.000Z',
    '2026-08-04T06:30Z',
    '2026-08-04 14:30',
    '2026-08-04',
    'now',
  ])('%s → ok:false', (raw) => {
    expect(parseProcurementForm(form({ [PROC_SUBMITTED_AT_FIELD]: raw })).ok).toBe(false);
  });

  it('空字串 → null(沒填,不是壞掉)', () => {
    const parsed = parseProcurementForm(form({ [PROC_SUBMITTED_AT_FIELD]: '' }));
    expect(parsed.ok && parsed.submittedAtLocal).toBeNull();
  });
});

describe('parseProcurementForm — 選填欄「整個沒送」不等於「送了空字串」', () => {
  // 🔴 關卡2 codex R2 MF3:A5a 是全量 payload ⇒ 沒送 = 寫成 NULL = 靜默清掉既有值。
  //    畫面上每個欄位一定都會送(即使空白)⇒「整個鍵不存在」只可能來自繞過畫面的呼叫。
  it.each([
    PROC_SUBMITTED_AT_FIELD,
    PROC_EXPECTED_ARRIVAL_FIELD,
    PROC_CONTACT_CHANNEL_FIELD,
    PROC_SUPPLIER_ORDER_NO_FIELD,
    PROC_EXCEPTION_REASON_FIELD,
  ])('%s 整個沒送 → ok:false(不得被當成合法的 null)', (field) => {
    const base = form();
    const missing: FormLike = {
      get: (name) => (name === field ? null : base.get(name)),
      // #365:兩支都要覆寫,否則測到的是 TypeError、不是「這個欄位整個沒送」
      getAll: (name) => (name === field ? [] : base.getAll(name)),
    };
    expect(parseProcurementForm(missing).ok).toBe(false);
  });

  it('五個選填欄都送空字串 → ok(空白是合法的「沒填」)', () => {
    expect(parseProcurementForm(form()).ok).toBe(true);
  });
});

describe('parseProcurementForm — expected_arrival_date 是 date、不做偏移處理', () => {
  it('YYYY-MM-DD → 原樣', () => {
    const parsed = parseProcurementForm(form({ [PROC_EXPECTED_ARRIVAL_FIELD]: '2026-09-30' }));
    expect(parsed.ok && parsed.expectedArrivalDate).toBe('2026-09-30');
  });

  // 🔴 對 date 欄補偏移會製造跨日誤差 ⇒ 帶時間的字面一律擋掉,不是「順手轉換」。
  it.each(['2026-09-30T00:00:00Z', '2026/09/30', '26-09-30', ''])(
    '%s → 非法或 null,不得被轉成別的日子',
    (raw) => {
      const parsed = parseProcurementForm(form({ [PROC_EXPECTED_ARRIVAL_FIELD]: raw }));
      if (raw === '') {
        expect(parsed.ok && parsed.expectedArrivalDate).toBeNull();
      } else {
        expect(parsed.ok).toBe(false);
      }
    },
  );
});

describe('parseProcurementForm — 三個文字欄刻意不 trim', () => {
  // 🔴 A5a 自己用 v_ws||v_zw 正規化,而「同值 no-op」比對的是它正規化後的結果
  //    (migration :231 逐字)⇒ 這層先剝一次會讓乾淨值重放被判「有差異」= 冪等破功。
  it('前後空白原樣送出(由 RPC 正規化,本層不搶)', () => {
    const parsed = parseProcurementForm(
      form({ [PROC_SUPPLIER_ORDER_NO_FIELD]: '  SO-123  ' }),
    );
    expect(parsed.ok && parsed.supplierOrderNo).toBe('  SO-123  ');
  });

  it('完全沒填 → null;只有空字串算沒填', () => {
    const parsed = parseProcurementForm(form({ [PROC_CONTACT_CHANNEL_FIELD]: '' }));
    expect(parsed.ok && parsed.contactChannel).toBeNull();
  });

  it('只有空白的字串**不是** null(原樣送、由 RPC 收斂成 NULL)', () => {
    const parsed = parseProcurementForm(form({ [PROC_EXCEPTION_REASON_FIELD]: '   ' }));
    expect(parsed.ok && parsed.exceptionReason).toBe('   ');
  });
});

describe('#365 同名欄位送兩份 → 被拒(不採第一筆)', () => {
  // 🔴 用**真 FormData**(理由同 wallet 那組:假表單的 getAll 是測試自己寫的)。
  function realForm(pairs: [string, string][]): FormData {
    const f = new FormData();
    for (const [k, v] of pairs) f.append(k, v);
    return f;
  }
  const base: [string, string][] = [
    [PROC_ORDER_ID_FIELD, ORDER],
    [PROC_ORDER_ITEM_ID_FIELD, ITEM],
    [PROC_SUPPLIER_ID_FIELD, SUPPLIER],
    [PROC_REPLY_STATUS_FIELD, 'confirmed'],
    [PROC_SUBMITTED_AT_FIELD, ''],
    [PROC_EXPECTED_ARRIVAL_FIELD, ''],
    [PROC_CONTACT_CHANNEL_FIELD, ''],
    [PROC_SUPPLIER_ORDER_NO_FIELD, ''],
    [PROC_EXCEPTION_REASON_FIELD, ''],
  ];

  it('🔴 數量送兩份 → ok:false(採購量是寫進採購真相表的值)', () => {
    const f = realForm([...base, [PROC_ALLOCATED_FIELD, '1'], [PROC_ALLOCATED_FIELD, '999']]);
    expect(parseProcurementForm(f).ok).toBe(false);
    expect(f.get(PROC_ALLOCATED_FIELD)).toBe('1');
  });

  it('🔴 選填欄送兩份 → ok:false(optionalText 的 invalid 也要擋、不能落回「沒填」)', () => {
    const f = realForm([
      ...base.filter(([k]) => k !== PROC_SUPPLIER_ORDER_NO_FIELD),
      [PROC_ALLOCATED_FIELD, '1'],
      [PROC_SUPPLIER_ORDER_NO_FIELD, 'A'],
      [PROC_SUPPLIER_ORDER_NO_FIELD, 'B'],
    ]);
    expect(parseProcurementForm(f).ok).toBe(false);
  });

  it('單筆仍照常通過(擋的是「兩份」不是整條路)', () => {
    expect(parseProcurementForm(realForm([...base, [PROC_ALLOCATED_FIELD, '1']])).ok).toBe(true);
  });
});

describe('#365 逐欄「送兩份 → 被拒」(同時是 PROCUREMENT_SINGLE_FIELDS 完整性的守門)', () => {
  function dup(base: [string, string][], field: string): FormData {
    const f = new FormData();
    for (const [k, v] of base) f.append(k, v);
    // 保證真的兩筆:base 沒有的欄位也補到兩筆(只 append 一次 = 送一份,測不到重複)。
    const existing = f.getAll(field);
    const value = (existing[0] as string | undefined) ?? 'x1';
    if (existing.length === 0) f.append(field, value);
    f.append(field, value);
    return f;
  }
  const BASE: [string, string][] = [
    [PROC_ORDER_ID_FIELD, ORDER],
    [PROC_ORDER_ITEM_ID_FIELD, ITEM],
    [PROC_SUPPLIER_ID_FIELD, SUPPLIER],
    [PROC_ALLOCATED_FIELD, '1'],
    [PROC_REPLY_STATUS_FIELD, 'confirmed'],
    [PROC_SUBMITTED_AT_FIELD, ''],
    [PROC_EXPECTED_ARRIVAL_FIELD, ''],
    [PROC_CONTACT_CHANNEL_FIELD, ''],
    [PROC_SUPPLIER_ORDER_NO_FIELD, ''],
    [PROC_EXCEPTION_REASON_FIELD, ''],
  ];

  it.each([...PROCUREMENT_SINGLE_FIELDS])('%s 送兩份 → ok:false', (field) => {
    expect(parseProcurementForm(dup(BASE, field)).ok).toBe(false);
  });
  // 🔴 codex 關卡2 MF:上面那條走訪的是常數本身 ⇒ 清單少一欄時測項也少一條、全綠(循環論證)。
  //    真正的完整性守門 = 拿**測試檔自己手寫的**清單比對;來源檔漏欄或多欄,這一條就紅。
  it('🔴 PROCUREMENT_SINGLE_FIELDS 逐字等於十欄(手寫對照)', () => {
    expect([...PROCUREMENT_SINGLE_FIELDS].sort()).toEqual(
      [
        'order_id',
        'order_item_id',
        'supplier_id',
        'allocated_quantity',
        'reply_status',
        'submitted_at',
        'expected_arrival_date',
        'contact_channel',
        'supplier_order_no',
        'exception_reason',
      ].sort(),
    );
  });
});
