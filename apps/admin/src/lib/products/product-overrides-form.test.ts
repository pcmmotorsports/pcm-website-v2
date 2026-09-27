// 商品文字「我們的版本」一次儲存的表單解析(商品頁改版乙 B3;原丙方案片 2 的單欄解析併進來,規則不變)。
import { describe, expect, it } from 'vitest';
import {
  OVERRIDE_HIGHLIGHT_FIELD,
  OVERRIDE_PRODUCT_ID_FIELD,
  OVERRIDE_SUBTITLE_FIELD,
  OVERRIDE_TITLE_FIELD,
  OVERRIDE_UNCHANGED_FIELD,
  describeTextSave,
  parseOverrideTextForm,
} from './product-overrides-form';

const PID = '11111111-2222-3333-4444-555555555555';

function form(fields: { title?: string; subtitle?: string; highlights?: string[] } = {}): FormData {
  const f = new FormData();
  f.set(OVERRIDE_PRODUCT_ID_FIELD, PID);
  f.set(OVERRIDE_TITLE_FIELD, fields.title ?? '');
  f.set(OVERRIDE_SUBTITLE_FIELD, fields.subtitle ?? '');
  for (const h of fields.highlights ?? ['']) f.append(OVERRIDE_HIGHLIGHT_FIELD, h);
  return f;
}

describe('parseOverrideTextForm(一次讀三欄)', () => {
  it('三欄一起讀:去前後空白;賣點空白那幾行丟掉', () => {
    expect(parseOverrideTextForm(form({ title: '  我們的標題 ', subtitle: '副標', highlights: [' a ', '', ' b'] }))).toEqual({
      ok: true,
      productId: PID,
      values: { title: '我們的標題', subtitle: '副標', highlights: ['a', 'b'] },
      unchanged: [],
    });
  });

  it('空白 = 還原(null):不會存一個空白標題;賣點全空白 ⇒ null', () => {
    expect(parseOverrideTextForm(form({ title: ' 　 ', highlights: ['', ' '] }))).toMatchObject({
      ok: true,
      values: { title: null, subtitle: null, highlights: null },
    });
  });

  it('🔴 上限:標題 200、副標 300、賣點每點 200、最多 12 點;超過 ⇒ 說得出是哪一欄', () => {
    expect(parseOverrideTextForm(form({ title: '字'.repeat(200) })).ok).toBe(true);
    expect(parseOverrideTextForm(form({ title: '字'.repeat(201) }))).toEqual({ ok: false, badField: 'title' });
    expect(parseOverrideTextForm(form({ subtitle: '字'.repeat(300) })).ok).toBe(true);
    expect(parseOverrideTextForm(form({ subtitle: '字'.repeat(301) }))).toEqual({ ok: false, badField: 'subtitle' });
    expect(parseOverrideTextForm(form({ highlights: ['字'.repeat(201)] }))).toEqual({ ok: false, badField: 'highlights' });
    expect(parseOverrideTextForm(form({ highlights: Array.from({ length: 12 }, (_, i) => `點${i}`) })).ok).toBe(true);
    expect(parseOverrideTextForm(form({ highlights: Array.from({ length: 13 }, (_, i) => `點${i}`) }))).toEqual({
      ok: false,
      badField: 'highlights',
    });
  });

  it('🔴 控制字元不收', () => {
    expect(parseOverrideTextForm(form({ subtitle: 'a\u0007b' }))).toEqual({ ok: false, badField: 'subtitle' });
  });

  it('🔴 product_id 不是 uuid、或同名欄位送兩次 ⇒ 不合法(不指名欄位)', () => {
    const bad = form();
    bad.set(OVERRIDE_PRODUCT_ID_FIELD, 'not-a-uuid');
    expect(parseOverrideTextForm(bad)).toEqual({ ok: false, badField: null });
    const dup = form({ title: 'a' });
    dup.append(OVERRIDE_TITLE_FIELD, 'b');
    expect(parseOverrideTextForm(dup)).toEqual({ ok: false, badField: null });
  });
});

describe('parseOverrideTextForm:沒動過的欄位', () => {
  it('🔴 畫面標了沒動過的欄位 ⇒ 列進 unchanged, 那一欄的內容不檢查(不會因為舊資料不合規則擋住別欄)', () => {
    const f = form({ title: '新標題', subtitle: '字'.repeat(301) });
    f.append(OVERRIDE_UNCHANGED_FIELD, 'subtitle');
    f.append(OVERRIDE_UNCHANGED_FIELD, 'highlights');
    expect(parseOverrideTextForm(f)).toMatchObject({ ok: true, unchanged: ['subtitle', 'highlights'] });
  });

  // Fable R2 建議:缺了某一欄的輸入框不能當成「清空 = 還原」(會靜默刪掉我們的版本)。
  it('🔴 沒標 unchanged 的欄位卻沒送 ⇒ 表單不合法, 不當成還原', () => {
    const noTitle = new FormData();
    noTitle.set(OVERRIDE_PRODUCT_ID_FIELD, PID);
    noTitle.set(OVERRIDE_SUBTITLE_FIELD, '');
    noTitle.append(OVERRIDE_HIGHLIGHT_FIELD, '');
    expect(parseOverrideTextForm(noTitle)).toEqual({ ok: false, badField: null });
    const noHighlights = form({ title: 'a' });
    noHighlights.delete(OVERRIDE_HIGHLIGHT_FIELD);
    expect(parseOverrideTextForm(noHighlights)).toEqual({ ok: false, badField: null });
    noHighlights.append(OVERRIDE_UNCHANGED_FIELD, 'highlights');
    expect(parseOverrideTextForm(noHighlights).ok).toBe(true);
  });

  it('🔴 unchanged 帶了不認得的欄位 ⇒ 表單不合法', () => {
    const f = form();
    f.append(OVERRIDE_UNCHANGED_FIELD, 'description');
    expect(parseOverrideTextForm(f)).toEqual({ ok: false, badField: null });
  });
});

describe('describeTextSave(存完顯示的話)', () => {
  it('存了幾欄就講哪幾欄;還原另外講;沒變的不列', () => {
    expect(
      describeTextSave({
        kind: 'done',
        results: [
          { field: 'title', outcome: 'saved' },
          { field: 'subtitle', outcome: 'restored' },
          { field: 'highlights', outcome: 'noop' },
        ],
      }),
    ).toEqual({ tone: 'ok', lines: ['已儲存：標題。', '已還原成供應商的：副標。', '網站約 1 分鐘內會顯示新的內容。'] });
  });

  it('三欄都沒變 ⇒ 說沒有變更', () => {
    expect(
      describeTextSave({
        kind: 'done',
        results: [
          { field: 'title', outcome: 'noop' },
          { field: 'subtitle', outcome: 'noop' },
          { field: 'highlights', outcome: 'noop' },
        ],
      }),
    ).toEqual({ tone: 'ok', lines: ['內容和目前相同，沒有變更。'] });
  });

  it('🔴 有一欄沒存成功 ⇒ 講清楚是哪一欄, 其他欄的結果照講;無法確認不寫成失敗', () => {
    const d = describeTextSave({
      kind: 'done',
      results: [
        { field: 'title', outcome: 'saved' },
        { field: 'subtitle', outcome: 'error' },
        { field: 'highlights', outcome: 'invalid' },
      ],
    })!;
    expect(d.tone).toBe('error');
    expect(d.lines).toContain('已儲存：標題。');
    expect(d.lines).toContain('副標：無法確認是否已儲存。請重新整理頁面查看目前內容；若沒有更新，再試一次，仍失敗請聯絡系統管理員。');
    expect(d.lines).toContain('賣點：沒有儲存，字數超過上限，或含有不能使用的字元。請修改後再儲存。');
    expect(d.lines.join('')).not.toContain('儲存失敗');
  });

  it('🔴 整批沒送出(登入過期 / 內容不合規則 / 找不到商品)⇒ 原話顯示', () => {
    expect(describeTextSave({ kind: 'failed', message: 'X' })).toEqual({ tone: 'error', lines: ['X'] });
    expect(describeTextSave({ kind: 'idle' })).toBeNull();
  });
});
