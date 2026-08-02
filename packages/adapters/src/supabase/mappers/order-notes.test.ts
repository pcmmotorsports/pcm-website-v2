import { describe, it, expect } from 'vitest';
import {
  mapSupabaseOrderNoteRowsToProjection,
  ORDER_NOTES_EMBED_LIMIT,
  type SupabaseOrderNoteRow,
} from './order-notes';

// M-4b E10 A9a-1:備註時間軸 + U6 告知義務(plan v4 §5;合約來源 = 建表檔
// supabase/migrations/20260729030000_m4b_e10_a3_order_notes.sql:160-196)。

function note(over: Partial<SupabaseOrderNoteRow> & { id: string }): SupabaseOrderNoteRow {
  return {
    note_type: 'internal',
    body: '備註內容',
    channel: null,
    occurred_at: null,
    author: 'sean',
    corrects_note_id: null,
    created_at: '2026-08-02T10:00:00+00:00',
    ...over,
  };
}

/** 一筆有效的「已告知客人」(配對規則 CHECK:非 internal ⇒ channel + occurred_at 必填)。 */
function notified(over: Partial<SupabaseOrderNoteRow> & { id: string }): SupabaseOrderNoteRow {
  return note({
    note_type: 'customer_notified',
    channel: 'line',
    occurred_at: '2026-08-01T09:00:00+00:00',
    ...over,
  });
}

describe('mapSupabaseOrderNoteRowsToProjection — U6 告知義務(建表檔 :160-177 合約)', () => {
  // 🔴 雙向負測(建表檔 :176-177 明文):只測「更正後算 0」的話,一個「永遠回 0」的壞實作照樣全綠。
  it('更正**前**:未被指向的 customer_notified ⇒ customerNotified = true(方向一)', () => {
    const res = mapSupabaseOrderNoteRowsToProjection([notified({ id: 'n-a' })]);
    expect(res.customerNotified).toBe(true);
    expect(res.notes[0]?.corrected).toBe(false);
  });

  it('更正**後**:被別筆直接指向 ⇒ customerNotified = false、該列標 corrected(方向二)', () => {
    const res = mapSupabaseOrderNoteRowsToProjection([
      notified({ id: 'n-a' }),
      note({ id: 'n-b', corrects_note_id: 'n-a', created_at: '2026-08-02T11:00:00+00:00' }),
    ]);
    expect(res.customerNotified).toBe(false);
    expect(res.notes.find((n) => n.id === 'n-a')?.corrected).toBe(true);
    expect(res.notes.find((n) => n.id === 'n-b')?.corrected).toBe(false);
  });

  it('🔴 更正不可撤回(:179-184):A ← B ← C 裡 C 更正 B **不會**讓 A 復活', () => {
    const res = mapSupabaseOrderNoteRowsToProjection([
      notified({ id: 'n-a' }),
      note({ id: 'n-b', corrects_note_id: 'n-a', created_at: '2026-08-02T11:00:00+00:00' }),
      note({ id: 'n-c', corrects_note_id: 'n-b', created_at: '2026-08-02T12:00:00+00:00' }),
    ]);
    expect(res.customerNotified).toBe(false); // A 仍被 B 直接指著
    expect(res.notes.map((n) => n.corrected)).toEqual([true, true, false]);
  });

  it('被更正的誤選旁邊另有一筆有效告知 ⇒ 仍算已告知(排除的是「那一列」不是「那個型別」)', () => {
    const res = mapSupabaseOrderNoteRowsToProjection([
      notified({ id: 'n-a' }),
      note({ id: 'n-b', corrects_note_id: 'n-a', created_at: '2026-08-02T11:00:00+00:00' }),
      notified({ id: 'n-c', created_at: '2026-08-02T12:00:00+00:00' }),
    ]);
    expect(res.customerNotified).toBe(true);
  });

  it('只有 internal / contact_log(含一筆被更正的 contact_log)⇒ customerNotified = false', () => {
    const res = mapSupabaseOrderNoteRowsToProjection([
      note({ id: 'n-a' }),
      note({ id: 'n-b', note_type: 'contact_log', channel: 'phone', occurred_at: '2026-08-01T09:00:00+00:00' }),
      note({ id: 'n-c', corrects_note_id: 'n-b', created_at: '2026-08-02T13:00:00+00:00' }),
    ]);
    expect(res.customerNotified).toBe(false);
    expect(res.notes.find((n) => n.id === 'n-b')?.corrected).toBe(true); // 被更正的確實在向量裡
  });
});

describe('mapSupabaseOrderNoteRowsToProjection — 排序全序(plan v4 §5 [51])', () => {
  // 🔴 id 字典序與時序**刻意相反**:若實作根本不看 created_at(只按 id 排),本條就會轉紅。
  //    (審查 R1 nit7:原本四組向量的 id 序都與期望輸出同序 ⇒ 對那個壞實作零判別力。)
  it('createdAt ASC(輸入順序不影響輸出;id 字典序與時序相反)', () => {
    const res = mapSupabaseOrderNoteRowsToProjection([
      note({ id: 'n-a', created_at: '2026-08-02T12:00:00+00:00' }),
      note({ id: 'n-c', created_at: '2026-08-02T10:00:00+00:00' }),
      note({ id: 'n-b', created_at: '2026-08-02T11:00:00+00:00' }),
    ]);
    expect(res.notes.map((n) => n.id)).toEqual(['n-c', 'n-b', 'n-a']);
  });

  // 🔴 這是本片最實際的排錯情境:更正列與被更正列常在同一秒內連續寫入。
  it('同毫秒不同微秒仍按真實時序(Date.parse 只到毫秒 ⇒ 少了字面 tie-break 會落到 id 亂序)', () => {
    const res = mapSupabaseOrderNoteRowsToProjection([
      note({ id: 'n-a', created_at: '2026-08-02T10:00:00.123999+00:00' }), // 後寫,但 id 較小
      note({ id: 'n-b', created_at: '2026-08-02T10:00:00.123456+00:00' }),
    ]);
    expect(res.notes.map((n) => n.id)).toEqual(['n-b', 'n-a']);
  });

  it('連時間字面都完全相同 ⇒ id 字典序 tie-break(PostgREST 內嵌列順序不保證 ⇒ 不得靠輸入順序)', () => {
    const same = '2026-08-02T10:00:00+00:00';
    const res = mapSupabaseOrderNoteRowsToProjection([
      note({ id: 'n-c', created_at: same }),
      note({ id: 'n-a', created_at: same }),
      note({ id: 'n-b', created_at: same }),
    ]);
    expect(res.notes.map((n) => n.id)).toEqual(['n-a', 'n-b', 'n-c']);
  });

  // 🔴 字典序與時序**相反**、id 序也與期望輸出相反 ⇒ 同時殺得掉「字串比 created_at」與「只按 id 排」。
  it('跨時區偏移仍按真實時序(字典序在此會排錯)', () => {
    const res = mapSupabaseOrderNoteRowsToProjection([
      note({ id: 'n-a', created_at: '2026-08-02T02:00:00+00:00' }), // 02:00Z(較晚,但 id 較小)
      note({ id: 'n-b', created_at: '2026-08-02T09:00:00+08:00' }), // 01:00Z(較早)
    ]);
    expect(res.notes.map((n) => n.id)).toEqual(['n-b', 'n-a']);
  });

  it('小數秒精度不同仍按真實時序', () => {
    const res = mapSupabaseOrderNoteRowsToProjection([
      note({ id: 'n-a', created_at: '2026-08-02T10:00:00.5+00:00' }),
      note({ id: 'n-b', created_at: '2026-08-02T10:00:00.25+00:00' }),
    ]);
    expect(res.notes.map((n) => n.id)).toEqual(['n-b', 'n-a']);
  });

  it('created_at 腐壞(解析不出)⇒ 排在最後、彼此以 id 定序(結果仍是確定的、不是實作決定)', () => {
    const res = mapSupabaseOrderNoteRowsToProjection([
      note({ id: 'n-bad-b', created_at: 'not-a-timestamp' }),
      note({ id: 'n-ok', created_at: '2026-08-02T10:00:00+00:00' }),
      note({ id: 'n-bad-a', created_at: 'garbage' }),
    ]);
    expect(res.notes.map((n) => n.id)).toEqual(['n-ok', 'n-bad-a', 'n-bad-b']);
  });
});

describe('mapSupabaseOrderNoteRowsToProjection — 截斷偵測(plan v4 §5 F9)', () => {
  // 🔴 本常數是**請求端**上限(adapter 送 order_notes.limit),必須嚴格低於實測的伺服器 max-rows
  //    (2026-08-02 production 實測 = 1000)—— 否則邊界回到伺服器設定手上、改小了就靜默失效。
  //    (審查 R2 nit5:原本並排的 `toBe(200)` 嚴格蘊含這條 ⇒ 那條零獨立判別力,已移除;
  //     真正要守的不是「剛好 200」而是「低於伺服器上限」。)
  it('請求端上限嚴格低於實測的伺服器 max-rows(1000)', () => {
    expect(ORDER_NOTES_EMBED_LIMIT).toBeLessThan(1000);
  });

  function rowsOfLength(n: number) {
    return Array.from({ length: n }, (_, i) => note({ id: `n-${String(i).padStart(4, '0')}` }));
  }

  it('筆數觸及上限 ⇒ notesTruncated = true 且 customerNotified = null(分不出「剛好滿」與「被截斷」⇒ fail-closed)', () => {
    const res = mapSupabaseOrderNoteRowsToProjection(rowsOfLength(ORDER_NOTES_EMBED_LIMIT));
    expect(res.notesTruncated).toBe(true);
    expect(res.customerNotified).toBeNull();
  });

  it('🔴 截斷時即使有一筆未被更正的 customer_notified,也只能說「無法判定」、不得回 true', () => {
    const rows = rowsOfLength(ORDER_NOTES_EMBED_LIMIT - 1);
    rows.push(notified({ id: 'n-9999' }));
    const res = mapSupabaseOrderNoteRowsToProjection(rows);
    expect(res.notesTruncated).toBe(true);
    expect(res.customerNotified).toBeNull();
  });

  it('差一筆到上限 ⇒ notesTruncated = false、customerNotified 照常判定(邊界)', () => {
    const res = mapSupabaseOrderNoteRowsToProjection(rowsOfLength(ORDER_NOTES_EMBED_LIMIT - 1));
    expect(res.notesTruncated).toBe(false);
    expect(res.customerNotified).toBe(false);
  });

  it('零筆 ⇒ 空時間軸、未告知、未截斷', () => {
    expect(mapSupabaseOrderNoteRowsToProjection([])).toEqual({
      notes: [],
      customerNotified: false,
      notesTruncated: false,
    });
  });
});

describe('mapSupabaseOrderNoteRowsToProjection — 逐欄 wire → domain', () => {
  it('contact_log 八欄逐欄對映(snake_case → camelCase)+ corrected', () => {
    const res = mapSupabaseOrderNoteRowsToProjection([
      {
        id: 'n-1',
        note_type: 'contact_log',
        body: '客人來電詢問到貨',
        channel: 'phone',
        occurred_at: '2026-08-01T09:30:00+00:00',
        author: 'sean',
        corrects_note_id: null,
        created_at: '2026-08-02T10:00:00+00:00',
      },
    ]);
    expect(res.notes).toEqual([
      {
        id: 'n-1',
        noteType: 'contact_log',
        body: '客人來電詢問到貨',
        channel: 'phone',
        occurredAt: '2026-08-01T09:30:00+00:00',
        author: 'sean',
        correctsNoteId: null,
        createdAt: '2026-08-02T10:00:00+00:00',
        corrected: false,
      },
    ]);
  });

  it('internal:channel / occurredAt 皆 null 直送(配對規則 CHECK :123-127)', () => {
    const res = mapSupabaseOrderNoteRowsToProjection([note({ id: 'n-1' })]);
    expect(res.notes[0]).toMatchObject({ noteType: 'internal', channel: null, occurredAt: null });
  });

  it('不改動輸入陣列(排序走複本;呼叫端拿到的 row 陣列順序不被副作用改掉)', () => {
    const rows = [
      note({ id: 'n-2', created_at: '2026-08-02T12:00:00+00:00' }),
      note({ id: 'n-1', created_at: '2026-08-02T10:00:00+00:00' }),
    ];
    mapSupabaseOrderNoteRowsToProjection(rows);
    expect(rows.map((r) => r.id)).toEqual(['n-2', 'n-1']);
  });
});
