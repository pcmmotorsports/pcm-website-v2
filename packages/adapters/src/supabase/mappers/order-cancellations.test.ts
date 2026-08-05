import { describe, expect, it } from 'vitest';
import {
  mapSupabaseOrderCancellationRowsToProjection,
  ORDER_CANCELLATIONS_EMBED_LIMIT,
  ORDER_CANCELLATION_ITEMS_EMBED_LIMIT,
  type SupabaseOrderCancellationRow,
} from './order-cancellations';

function row(over: Partial<SupabaseOrderCancellationRow> = {}): SupabaseOrderCancellationRow {
  return {
    id: 'c-1',
    reason_code: 'customer_request',
    reason_detail: null,
    actor: 'sean',
    created_at: '2026-08-05T10:00:00.000000+00:00',
    order_cancellation_items: [
      { id: 'ci-1', order_item_id: 'oi-1', cancelled_quantity: 2 },
    ],
    ...over,
  };
}

describe('mapSupabaseOrderCancellationRowsToProjection — A9g-3 取消歷程', () => {
  it('🔴 內嵌鍵不存在(投影退版)→ cancellations=null(不得當成「沒被取消過」的空清單)', () => {
    const res = mapSupabaseOrderCancellationRowsToProjection(undefined);
    expect(res.cancellations).toBeNull(); // 🔴 這條才是承重的:null 才逼得動消費端
    expect(res.cancellationsTruncated).toBe(false); // 沒觸及上限 —— 是根本沒讀到
  });

  it('🔴 null → 同上', () => {
    expect(mapSupabaseOrderCancellationRowsToProjection(null).cancellations).toBeNull();
  });

  it('零筆(真的沒被取消過)→ 空清單且 truncated=false', () => {
    const res = mapSupabaseOrderCancellationRowsToProjection([]);
    expect(res.cancellations).toEqual([]);
    expect(res.cancellationsTruncated).toBe(false);
  });

  it('逐欄映射(snake → camel),不帶 idempotency_key / payload_hash', () => {
    const res = mapSupabaseOrderCancellationRowsToProjection([
      row({ reason_code: 'other', reason_detail: '客人改買別款' }),
    ]);
    expect(res.cancellations?.[0]).toEqual({
      id: 'c-1',
      reasonCode: 'other',
      reasonDetail: '客人改買別款',
      actor: 'sean',
      createdAt: '2026-08-05T10:00:00.000000+00:00',
      items: [{ id: 'ci-1', orderItemId: 'oi-1', cancelledQuantity: 2 }],
      itemsTruncated: false,
    });
  });

  // 🔴 這條在守一個**會靜默發生**的實作錯:共用的 `compareByCreatedAtThenId` 吃的是 snake_case
  //    的 `created_at`。若把 `.sort()` 接在 `.map()` **後面**(排映射後的物件),
  //    `Date.parse(undefined)` 全是 NaN、**不會報錯**,只會退化成純 id 排序。
  //    ⇒ 本 fixture 刻意讓「時間序」與「id 字典序」**相反**,退化就一定被抓到。
  it('🔴 依 createdAt 升冪排序(且時間序與 id 序相反,退化成 id 排序會轉紅)', () => {
    const res = mapSupabaseOrderCancellationRowsToProjection([
      row({ id: 'aaa', created_at: '2026-08-05T12:00:00.000000+00:00' }),
      row({ id: 'zzz', created_at: '2026-08-05T09:00:00.000000+00:00' }),
    ]);
    expect(res.cancellations?.map((c) => c.id)).toEqual(['zzz', 'aaa']);
  });

  it('🔴 同毫秒不同微秒 → 仍是全序(比時間字面那一層)', () => {
    const res = mapSupabaseOrderCancellationRowsToProjection([
      row({ id: 'aaa', created_at: '2026-08-05T10:00:00.123999+00:00' }),
      row({ id: 'bbb', created_at: '2026-08-05T10:00:00.123456+00:00' }),
    ]);
    expect(res.cancellations?.map((c) => c.id)).toEqual(['bbb', 'aaa']);
  });

  it('不修改呼叫端傳進來的陣列(排序走複本)', () => {
    const rows = [
      row({ id: 'aaa', created_at: '2026-08-05T12:00:00.000000+00:00' }),
      row({ id: 'zzz', created_at: '2026-08-05T09:00:00.000000+00:00' }),
    ];
    mapSupabaseOrderCancellationRowsToProjection(rows);
    expect(rows.map((r) => r.id)).toEqual(['aaa', 'zzz']);
  });

  it('🔴 觸及取消列上限 → cancellationsTruncated=true', () => {
    const rows = Array.from({ length: ORDER_CANCELLATIONS_EMBED_LIMIT }, (_, i) =>
      row({ id: `c-${String(i).padStart(4, '0')}` }),
    );
    expect(mapSupabaseOrderCancellationRowsToProjection(rows).cancellationsTruncated).toBe(true);
  });

  it('🔴 品項內嵌鍵不存在 → 該列 items=null(不是「這次取消沒動到品項」)', () => {
    const res = mapSupabaseOrderCancellationRowsToProjection([
      row({ order_cancellation_items: undefined }),
    ]);
    expect(res.cancellations?.[0]?.items).toBeNull();
    expect(res.cancellations?.[0]?.itemsTruncated).toBe(false);
  });

  // 🔴 R1 must-fix:`[]` 是 truthy ⇒ 原本走到「完整地取消了 0 件」。
  //    DB 端不存在零品項的取消(A8a1 筆數守
  //    `20260804180000_m4b_e10_a8a1_admin_cancel_order.sql:231-240`、A8a2 全零增量拒)
  //    ⇒ 觀察到空陣列必然是沒讀到。把守門改回 `if (!rows)`,本條就紅。
  it('🔴 品項回空陣列 → items=null(DB 端不存在零品項的取消 ⇒ 空 = 沒讀到)', () => {
    const res = mapSupabaseOrderCancellationRowsToProjection([
      row({ order_cancellation_items: [] }),
    ]);
    expect(res.cancellations?.[0]?.items).toBeNull();
    expect(res.cancellations?.[0]?.itemsTruncated).toBe(false);
  });

  it('🔴 品項 null → 同上', () => {
    const res = mapSupabaseOrderCancellationRowsToProjection([
      row({ order_cancellation_items: null }),
    ]);
    expect(res.cancellations?.[0]?.items).toBeNull();
  });

  it('🔴 觸及品項上限 → 該列 itemsTruncated=true 且 items 非 null(讀到了、只是子集)', () => {
    const items = Array.from({ length: ORDER_CANCELLATION_ITEMS_EMBED_LIMIT }, (_, i) => ({
      id: `ci-${String(i).padStart(4, '0')}`,
      order_item_id: `oi-${i}`,
      cancelled_quantity: 1,
    }));
    const res = mapSupabaseOrderCancellationRowsToProjection([
      row({ order_cancellation_items: items }),
    ]);
    expect(res.cancellations?.[0]?.itemsTruncated).toBe(true);
    expect(res.cancellations?.[0]?.items).not.toBeNull();
  });

  it('品項依 id 升冪(穩定顯示序)', () => {
    const res = mapSupabaseOrderCancellationRowsToProjection([
      row({
        order_cancellation_items: [
          { id: 'ci-9', order_item_id: 'oi-9', cancelled_quantity: 1 },
          { id: 'ci-1', order_item_id: 'oi-1', cancelled_quantity: 3 },
        ],
      }),
    ]);
    expect(res.cancellations?.[0]?.items?.map((i) => i.id)).toEqual(['ci-1', 'ci-9']);
  });

  // 🔴 兩層截斷是**前提關係**:外層被切掉的取消列,連同它的 itemsTruncated 一起消失
  //    ⇒ 呼叫端看到的每個 itemsTruncated 都還是 false,而清單其實不完整。
  it('🔴 外層截斷時,看得到的那些列的 itemsTruncated 仍可能全是 false(兩個旗標要一起讀)', () => {
    const rows = Array.from({ length: ORDER_CANCELLATIONS_EMBED_LIMIT }, (_, i) =>
      row({ id: `c-${String(i).padStart(4, '0')}` }),
    );
    const res = mapSupabaseOrderCancellationRowsToProjection(rows);
    expect(res.cancellationsTruncated).toBe(true);
    expect(res.cancellations?.every((c) => c.itemsTruncated === false)).toBe(true);
  });

  // 🔴 關卡2 nit:上限只驗區間的話,`100 → 1` 也全綠,而歷程會幾乎立刻被判成截斷
  //    (畫面永遠說「可能不完整」= 這片等於白做)。⇒ 釘死字面,改動必須是**刻意**的。
  it('🔴 上限常數字面釘死(改值必須連同本條一起改 = 逼人想一次)', () => {
    expect(ORDER_CANCELLATIONS_EMBED_LIMIT).toBe(100);
    expect(ORDER_CANCELLATION_ITEMS_EMBED_LIMIT).toBe(200);
    // 區間斷言留著:字面改了但忘了想「有沒有超過伺服器 max-rows」時的第二道。
    expect(ORDER_CANCELLATIONS_EMBED_LIMIT).toBeLessThan(1000);
    expect(ORDER_CANCELLATION_ITEMS_EMBED_LIMIT).toBeLessThan(1000);
  });

  // 🔴 關卡2 nit:上面兩條排序測試的 created_at 都不同 ⇒ 拿掉第三層 id tie-break 仍全綠。
  //    三層全序是本 mapper 對外的宣稱,最後那層要自己被證明。
  it('🔴 created_at 完全相同 → 以 id 定序(拿掉第三層 tie-break 會轉紅)', () => {
    const res = mapSupabaseOrderCancellationRowsToProjection([
      row({ id: 'zzz', created_at: '2026-08-05T10:00:00.000000+00:00' }),
      row({ id: 'aaa', created_at: '2026-08-05T10:00:00.000000+00:00' }),
    ]);
    expect(res.cancellations?.map((c) => c.id)).toEqual(['aaa', 'zzz']);
  });
});
