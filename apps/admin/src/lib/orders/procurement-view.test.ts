// 🔴🔴 **釘一個「不是台北」的時區**(關卡2 突變 N35 逼出來的):本片契約是「一律用 Asia/Taipei」,
//    而測試機器本來就在台北 ⇒ 「用裝置時區」的壞實作與正解**完全重合**、斷言零判別力
//    (實測:把 `toTaipeiInputValue` 改成裝置時區,全部 783 案照樣綠)。
//    ⚠️ 這與 `note-compose-form.test.tsx:2-4` 釘 Asia/Taipei 的理由**方向相反** ——
//    那片要證「不能把 local 當 UTC」,本片要證「不能用裝置時區」,所以要釘非台北。
process.env.TZ = 'America/New_York';

import { describe, it, expect, vi } from 'vitest';
import type { AdminOrderItemProcurement } from '@pcm/domain';

// 🔴 `procurement-suppliers` → `lib/supplier.ts` → `supplier-repository.ts` → `import 'server-only'`,
//    在 vitest 的 node 環境解析不到(`supplier.test.ts:3-5` 同一個處置)。
//    這裡 mock 的是**倉庫層**、不是排序 —— 排序仍走真的 `sortSuppliersByLabel`,
//    否則「沿用 S3a 同一把排序」那條斷言會變成在測 mock。
vi.mock('../supplier-repository', () => ({ listSupplierRows: vi.fn() }));

import { buildSupplierChoices } from './procurement-suppliers';
import {
  hydrateFormValues,
  toTaipeiInputValue,
  toTaipeiIso,
  REPLY_STATUS_LABEL,
} from './procurement-view';
import { PROCUREMENT_REPLY_STATUSES } from './procurement-form';
import { EMPTY_PROCUREMENT_VALUES } from './procurement-action-state';

// M-4b E10 A10b:採購區塊的純顯示邏輯。

function proc(over: Partial<AdminOrderItemProcurement> = {}): AdminOrderItemProcurement {
  return {
    id: 'p-1',
    supplierId: 'sup-a',
    supplierLabel: 'RPM Carbon',
    supplierIsActive: true,
    allocatedQuantity: 2,
    receivedQuantity: 0,
    replyStatus: 'no_reply',
    contactChannel: null,
    submittedAt: null,
    supplierOrderNo: null,
    exceptionReason: null,
    expectedArrivalDate: null,
    firstOrderedAt: null,
    statusChangedAt: null,
    createdAt: '2026-08-04T02:00:00+00:00',
    ...over,
  };
}

describe('buildSupplierChoices — 停用的既有供應商必須留在選單裡', () => {
  // 🔴 這條是本片最實質的一格:S1b :183 不阻止採購指向已停用者、A5a 只擋新建與調升,
  //    事實記錄欄照常可更新 ⇒ 選單漏掉它,那一列就**永遠改不了**了。
  it('已停用但本品項有採購 → 仍在選單、標記 inactive', () => {
    const choices = buildSupplierChoices(
      [{ id: 'sup-b', label: 'Webike TW' }],
      [proc({ supplierId: 'sup-a', supplierLabel: 'RPM Carbon', supplierIsActive: false })],
    );
    expect(choices.map((c) => c.id).sort()).toEqual(['sup-a', 'sup-b']);
    expect(choices.find((c) => c.id === 'sup-a')?.inactive).toBe(true);
    expect(choices.find((c) => c.id === 'sup-b')?.inactive).toBe(false);
  });

  // 🔴 null = 內嵌沒回來 = 不知道,不得靜默當啟用中(A9a-2 domain 註解)。
  it('supplierIsActive 為 null(內嵌缺)→ 標成 inactive,不得當啟用', () => {
    const choices = buildSupplierChoices([], [proc({ supplierIsActive: null })]);
    expect(choices[0]?.inactive).toBe(true);
  });

  it('supplierLabel 為 null → 用 id 前 8 碼當顯示名,不得省略也不得空白', () => {
    const choices = buildSupplierChoices(
      [],
      [proc({ supplierId: 'abcdefgh-1111-4111-8111-111111111111', supplierLabel: null })],
    );
    expect(choices).toHaveLength(1);
    expect(choices[0]?.label).toBe('(未知供應商 abcdefgh)');
    expect(choices[0]?.label.trim()).not.toBe('');
  });

  it('啟用清單已有的不被既有採購覆蓋成 inactive(同一家同時在兩邊)', () => {
    const choices = buildSupplierChoices(
      [{ id: 'sup-a', label: 'RPM Carbon' }],
      [proc({ supplierId: 'sup-a', supplierIsActive: false })],
    );
    expect(choices).toHaveLength(1);
    expect(choices[0]?.inactive).toBe(false);
  });

  // 排序沿用 S3a 的同一把(zh-TW:中文在英文之前)——換掉排序這條會轉紅。
  it('依 zh-TW 規則排序(中文在英文前)', () => {
    const choices = buildSupplierChoices(
      [
        { id: 's1', label: 'Webike TW' },
        { id: 's2', label: '安豐達' },
        { id: 's3', label: 'AKOSO' },
      ],
      [],
    );
    expect(choices.map((c) => c.label)).toEqual(['安豐達', 'AKOSO', 'Webike TW']);
  });
});

describe('hydrateFormValues — 全量 payload 的承重', () => {
  // 🔴 少一欄 = 那一欄被送成 NULL = 靜默清掉既有事實(A5a :19-24)。
  it('選到既有採購 → **逐欄**填滿(沒有任何一欄被漏掉)', () => {
    const row = proc({
      supplierId: 'sup-a',
      allocatedQuantity: 3,
      replyStatus: 'partial',
      contactChannel: 'LINE',
      submittedAt: '2026-08-04T02:00:00+00:00',
      supplierOrderNo: 'SO-123',
      exceptionReason: '原廠缺料',
      expectedArrivalDate: '2026-09-30',
    });
    const values = hydrateFormValues([row], 'sup-a');
    expect(values.supplierId).toBe('sup-a');
    expect(values.allocatedQuantity).toBe('3');
    expect(values.replyStatus).toBe('partial');
    expect(values.contactChannel).toBe('LINE');
    expect(values.supplierOrderNo).toBe('SO-123');
    expect(values.exceptionReason).toBe('原廠缺料');
    expect(values.expectedArrivalDate).toBe('2026-09-30');
    expect(values.submittedAtLocal).toBe('2026-08-04T10:00'); // 台北牆上時間(UTC 02:00 + 8h)
    // 🔴 結構斷言:表單值的每一個 key 都被填了,沒有殘留空字串的漏欄
    for (const [key, value] of Object.entries(values)) {
      expect(value, `欄位 ${key} 沒有被 hydrate`).not.toBe('');
    }
  });

  it('選到還沒有採購的供應商 → 全空 + 該 supplierId(新建)', () => {
    expect(hydrateFormValues([proc({ supplierId: 'sup-a' })], 'sup-b')).toEqual({
      ...EMPTY_PROCUREMENT_VALUES,
      supplierId: 'sup-b',
    });
  });

  it('沒選供應商 → 全空', () => {
    expect(hydrateFormValues([proc()], '')).toEqual(EMPTY_PROCUREMENT_VALUES);
  });

  it('既有列的 null 欄 → 空字串(不是字串 "null")', () => {
    const values = hydrateFormValues([proc({ supplierId: 'sup-a' })], 'sup-a');
    expect(values.contactChannel).toBe('');
    expect(values.supplierOrderNo).toBe('');
    expect(values.exceptionReason).toBe('');
    expect(values.expectedArrivalDate).toBe('');
    expect(values.submittedAtLocal).toBe('');
  });
});

describe('toTaipeiIso / toTaipeiInputValue — 一律用 Asia/Taipei,不用裝置時區', () => {
  // 🔴 契約 = A5a `20260803160000:475-476`(offset 由 server 補 Asia/Taipei)。
  //    用 `new Date(local)`(裝置時區)的話,非台北機器上同一個 14:30 會存成別的時刻。
  it('台北牆上 14:30 → +08:00 的 ISO(= UTC 06:30)', () => {
    expect(toTaipeiIso('2026-08-04T14:30')).toBe('2026-08-04T14:30:00+08:00');
    expect(new Date(toTaipeiIso('2026-08-04T14:30')).toISOString()).toBe(
      '2026-08-04T06:30:00.000Z',
    );
  });

  it('帶秒也保留', () => {
    expect(toTaipeiIso('2026-08-04T14:30:45')).toBe('2026-08-04T14:30:45+08:00');
  });

  it('UTC 06:30 → 台北牆上 14:30(不是切 ISO 前 16 字的 06:30)', () => {
    expect(toTaipeiInputValue('2026-08-04T06:30:00.000Z')).toBe('2026-08-04T14:30');
  });

  it('來回一致(台北 → ISO → 台北)', () => {
    const local = '2026-12-31T23:45';
    expect(toTaipeiInputValue(toTaipeiIso(local))).toBe(local);
  });

  // 🔴 判別力:這兩條在**任何**裝置時區下都要成立 —— 這正是「不用裝置時區」的意思。
  //    (測試環境釘 Asia/Taipei 的話,用裝置時區的壞實作會與正解重合 ⇒ 那樣就量不到了。)
  it('結果與裝置時區無關:斷言用固定字面、不從 Date 的本地欄位推導', () => {
    const iso = '2026-08-04T06:30:00.000Z';
    expect(toTaipeiInputValue(iso)).toBe('2026-08-04T14:30');
    // 若實作改用裝置時區,在 UTC 的 CI 上會得到 '2026-08-04T06:30' ⇒ 這條會紅
    expect(toTaipeiInputValue(iso)).not.toBe(iso.slice(0, 16));
  });

  it('空字串 / 壞字面 / null → 空字串(fail-closed,不送半殘)', () => {
    expect(toTaipeiIso('')).toBe('');
    expect(toTaipeiIso('not-a-date')).toBe('');
    expect(toTaipeiIso('2026-08-04T14:30+08:00')).toBe(''); // 帶偏移的不收
    expect(toTaipeiInputValue(null)).toBe('');
    expect(toTaipeiInputValue('not-a-date')).toBe('');
  });
});

describe('REPLY_STATUS_LABEL — 五個狀態都有字', () => {
  it('與解析器的 allowlist 一一對應(新增狀態忘了寫字會轉紅)', () => {
    expect(Object.keys(REPLY_STATUS_LABEL).sort()).toEqual([...PROCUREMENT_REPLY_STATUSES].sort());
    for (const code of PROCUREMENT_REPLY_STATUSES) {
      expect(REPLY_STATUS_LABEL[code]).not.toBe('');
    }
  });
});
