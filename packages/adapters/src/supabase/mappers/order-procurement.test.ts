import { describe, it, expect } from 'vitest';
import {
  mapSupabaseProcurementRowsToProjection,
  ORDER_ITEM_PROCUREMENT_EMBED_LIMIT,
  type SupabaseOrderItemProcurementRow,
} from './order-procurement';

// M-4b E10 A9a-2:採購讀模型(master plan `docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:385`
// row 38 的採購那半;合約來源 = 建表檔 supabase/migrations/20260729020000_m4b_e10_a2_order_item_procurement.sql
// + S1b 20260801150000 的 supplier_id FK + A5a 20260803160000 的全量 payload 契約)。

function proc(
  over: Partial<SupabaseOrderItemProcurementRow> & { id: string },
): SupabaseOrderItemProcurementRow {
  return {
    supplier_id: 'sup-a',
    allocated_quantity: 2,
    received_quantity: 0,
    reply_status: 'no_reply',
    contact_channel: null,
    submitted_at: null,
    supplier_order_no: null,
    exception_reason: null,
    expected_arrival_date: null,
    first_ordered_at: null,
    status_changed_at: null,
    created_at: '2026-08-03T10:00:00+00:00',
    suppliers: { label: 'RPM Carbon', is_active: true },
    ...over,
  };
}

describe('mapSupabaseProcurementRowsToProjection — 供應商 embed 正規化', () => {
  it('單物件 embed → supplierLabel / supplierIsActive 直取', () => {
    const res = mapSupabaseProcurementRowsToProjection([proc({ id: 'p-1' })]);
    expect(res.procurements[0]?.supplierLabel).toBe('RPM Carbon');
    expect(res.procurements[0]?.supplierIsActive).toBe(true);
  });

  it('陣列形 embed(生成型別對 many-to-one 推斷不穩)→ 取第一個、不炸', () => {
    const res = mapSupabaseProcurementRowsToProjection([
      proc({ id: 'p-1', suppliers: [{ label: 'Webike JP', is_active: false }] }),
    ]);
    expect(res.procurements[0]?.supplierLabel).toBe('Webike JP');
    expect(res.procurements[0]?.supplierIsActive).toBe(false);
  });

  // 🔴 label 是 NOT NULL + UNIQUE(S1a :32,:45)⇒ null 只代表「內嵌沒回來」。誠實回 null,
  //    不得兜成空字串(空字串在選單上是「看不見卻選得到」的項目,正是 S1a 要防的病灶)。
  it('embed 缺(null / undefined / 空陣列)→ label 與 isActive 皆 null,但 supplierId 仍在', () => {
    const missingShapes: SupabaseOrderItemProcurementRow['suppliers'][] = [null, undefined, []];
    for (const suppliers of missingShapes) {
      const res = mapSupabaseProcurementRowsToProjection([
        proc({ id: 'p-1', supplier_id: 'sup-x', suppliers }),
      ]);
      expect(res.procurements[0]?.supplierId).toBe('sup-x'); // A10b 送 A5a 靠它,不能一起消失
      expect(res.procurements[0]?.supplierLabel).toBeNull();
      expect(res.procurements[0]?.supplierIsActive).toBeNull();
    }
  });

  // 🔴 停用不是「不顯示」:S1b :183 明文本鍵不阻止採購指向已停用者;被擋的是 A5a 的新建與調升。
  //    這條負測釘住「停用的既有採購列照樣回」—— 反過來做(過濾掉)會讓明細頁少一筆真的採購。
  it('停用供應商的既有採購列照常回、isActive=false 誠實帶出', () => {
    const res = mapSupabaseProcurementRowsToProjection([
      proc({ id: 'p-1', suppliers: { label: 'Webike JP', is_active: false } }),
    ]);
    expect(res.procurements).toHaveLength(1);
    expect(res.procurements[0]?.supplierIsActive).toBe(false);
  });
});

describe('mapSupabaseProcurementRowsToProjection — 排序合約(PostgREST 內嵌順序不保證)', () => {
  it('依 createdAt ASC 重排(投影送 DESC 進來)', () => {
    const res = mapSupabaseProcurementRowsToProjection([
      proc({ id: 'p-late', created_at: '2026-08-03T12:00:00+00:00' }),
      proc({ id: 'p-early', created_at: '2026-08-03T10:00:00+00:00' }),
      proc({ id: 'p-mid', created_at: '2026-08-03T11:00:00+00:00' }),
    ]);
    expect(res.procurements.map((p) => p.id)).toEqual(['p-early', 'p-mid', 'p-late']);
  });

  // 🔴 `Date.parse` 只解析到毫秒、而 created_at 是微秒精度 ⇒ 少了「同毫秒比字面」那層,
  //    這兩列會落到 id(uuid)字典序 —— 這裡刻意讓 id 字典序與時間序**相反**,少一層就會紅。
  it('同毫秒不同微秒:比時間字面(id 字典序刻意相反、量得到少一層)', () => {
    const res = mapSupabaseProcurementRowsToProjection([
      proc({ id: 'aaa', created_at: '2026-08-03T10:00:00.123999+00:00' }),
      proc({ id: 'zzz', created_at: '2026-08-03T10:00:00.123456+00:00' }),
    ]);
    expect(res.procurements.map((p) => p.id)).toEqual(['zzz', 'aaa']);
  });

  it('跨時區偏移:比的是時間點不是字面(字典序會排反)', () => {
    const res = mapSupabaseProcurementRowsToProjection([
      proc({ id: 'p-utc', created_at: '2026-08-03T10:00:00+00:00' }), // 18:00 台北
      proc({ id: 'p-tpe', created_at: '2026-08-03T17:00:00+08:00' }), // 09:00 UTC ⇒ 較早
    ]);
    expect(res.procurements.map((p) => p.id)).toEqual(['p-tpe', 'p-utc']);
  });

  it('時間字面全同 → id 字典序 tie-break(全序、不回 NaN)', () => {
    const res = mapSupabaseProcurementRowsToProjection([
      proc({ id: 'p-b' }),
      proc({ id: 'p-a' }),
    ]);
    expect(res.procurements.map((p) => p.id)).toEqual(['p-a', 'p-b']);
  });

  it('created_at 腐壞(解析不出來)→ 排最後、不炸', () => {
    const res = mapSupabaseProcurementRowsToProjection([
      proc({ id: 'p-bad', created_at: 'not-a-timestamp' }),
      proc({ id: 'p-ok' }),
    ]);
    expect(res.procurements.map((p) => p.id)).toEqual(['p-ok', 'p-bad']);
  });

  it('輸入陣列不被就地改動(mapper 不得有副作用)', () => {
    const rows = [
      proc({ id: 'p-late', created_at: '2026-08-03T12:00:00+00:00' }),
      proc({ id: 'p-early', created_at: '2026-08-03T10:00:00+00:00' }),
    ];
    mapSupabaseProcurementRowsToProjection(rows);
    expect(rows.map((r) => r.id)).toEqual(['p-late', 'p-early']);
  });
});

describe('mapSupabaseProcurementRowsToProjection — 截斷判定(雙向)', () => {
  it('筆數 < 上限 ⇒ procurementTruncated = false(方向一)', () => {
    const rows = Array.from({ length: ORDER_ITEM_PROCUREMENT_EMBED_LIMIT - 1 }, (_, i) =>
      proc({ id: `p-${i}` }),
    );
    expect(mapSupabaseProcurementRowsToProjection(rows).procurementTruncated).toBe(false);
  });

  // 🔴 fail-closed:觸及上限時分不出「剛好這麼多筆」與「被截斷」⇒ 一律當可能被截斷。
  it('筆數 = 上限 ⇒ procurementTruncated = true(方向二;剛好等於也算)', () => {
    const rows = Array.from({ length: ORDER_ITEM_PROCUREMENT_EMBED_LIMIT }, (_, i) =>
      proc({ id: `p-${i}` }),
    );
    expect(mapSupabaseProcurementRowsToProjection(rows).procurementTruncated).toBe(true);
  });

  it('空陣列 ⇒ 空清單 + 不截斷(沒訂過貨的品項)', () => {
    expect(mapSupabaseProcurementRowsToProjection([])).toEqual({
      procurements: [],
      procurementTruncated: false,
    });
  });

  // 🔴 關卡2 codex MF1:**「沒問到」≠「答案是零筆」**。投影退版時內嵌鍵整個不見,
  //    若也回 false,A10b(寫入端、A5a 全量 payload)會把空白清單當「新建」送出去 = 覆蓋真實採購事實。
  //    ⇒ 缺鍵與空陣列必須分得出來,這條與上一條**成對**(只留一條的話,把兩者都回 true 或都回 false
  //    的壞實作各有一條會綠)。
  it('🔴 內嵌鍵整個缺(null / undefined)⇒ 空清單但 procurementTruncated = true(不可信,非「零筆」)', () => {
    for (const rows of [null, undefined]) {
      expect(mapSupabaseProcurementRowsToProjection(rows)).toEqual({
        procurements: [],
        procurementTruncated: true,
      });
    }
  });

  // 🔴 這條**只**證明常數落在我們宣稱的區間內,**不**證明正式站現在的 max-rows ≥ 50
  //    (關卡2 codex MF3:1000 是 2026-08-02 的一次量測、不是持續驗證的事實)。
  //    若專案 max-rows 被設到低於 50,回應永遠達不到 50 ⇒ 旗標恆 false 而本測試照樣綠 ——
  //    那個殘餘風險只能靠第二支 `count: 'exact'` 查詢治本(每次明細多一次往返,本片未做)。
  it('🔴 上限是正整數且低於 2026-08-02 實測值 1000(不宣稱正式站當下設定)', () => {
    expect(Number.isInteger(ORDER_ITEM_PROCUREMENT_EMBED_LIMIT)).toBe(true);
    expect(ORDER_ITEM_PROCUREMENT_EMBED_LIMIT).toBeGreaterThan(0);
    expect(ORDER_ITEM_PROCUREMENT_EMBED_LIMIT).toBeLessThan(1000);
  });
});

describe('mapSupabaseProcurementRowsToProjection — 欄位對映(A5a 全量 payload 契約)', () => {
  // 🔴 A5a 是全量 payload、非 patch(20260803160000:20-24):表單必「全欄 hydrate 自最新列、先讀後送」。
  //    少投影一欄 ⇒ A10b 會用 undefined 覆蓋掉那一欄的既有值 ⇒ 這條逐欄釘住 hydrate 面。
  it('逐欄 snake_case → camelCase 全帶出(hydrate 面完整)', () => {
    const res = mapSupabaseProcurementRowsToProjection([
      proc({
        id: 'p-1',
        supplier_id: 'sup-a',
        allocated_quantity: 3,
        received_quantity: 2,
        reply_status: 'partial',
        contact_channel: 'LINE',
        submitted_at: '2026-08-01T02:00:00+00:00',
        supplier_order_no: 'SO-123',
        exception_reason: '原廠缺料',
        expected_arrival_date: '2026-09-30',
        first_ordered_at: '2026-08-01T02:00:00+00:00',
        status_changed_at: '2026-08-02T02:00:00+00:00',
        created_at: '2026-08-01T02:00:00+00:00',
      }),
    ]);
    expect(res.procurements[0]).toEqual({
      id: 'p-1',
      supplierId: 'sup-a',
      supplierLabel: 'RPM Carbon',
      supplierIsActive: true,
      allocatedQuantity: 3,
      receivedQuantity: 2,
      replyStatus: 'partial',
      contactChannel: 'LINE',
      submittedAt: '2026-08-01T02:00:00+00:00',
      supplierOrderNo: 'SO-123',
      exceptionReason: '原廠缺料',
      expectedArrivalDate: '2026-09-30',
      firstOrderedAt: '2026-08-01T02:00:00+00:00',
      statusChangedAt: '2026-08-02T02:00:00+00:00',
      createdAt: '2026-08-01T02:00:00+00:00',
    });
  });

  it('五種 reply_status 都原樣帶出(建表檔 :86-87 allowlist)', () => {
    const codes = ['no_reply', 'confirmed', 'price_changed', 'out_of_stock', 'partial'] as const;
    const res = mapSupabaseProcurementRowsToProjection(
      codes.map((code, i) =>
        proc({ id: `p-${i}`, reply_status: code, created_at: `2026-08-03T1${i}:00:00+00:00` }),
      ),
    );
    expect(res.procurements.map((p) => p.replyStatus)).toEqual([...codes]);
  });
});
