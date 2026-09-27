// 商品文字「我們的版本」表單解析(商品編輯丙方案片 2;純函式,無 'use server',可單測)。
// 商品頁改版乙 B3(2026-09-28):三欄改成同一個表單一次儲存 ⇒ 一次讀標題、副標、賣點;每欄的規則不變。
// 鏡射 product-listing-form.ts。欄位與上限與 RPC admin_set_product_override(20260927060000)一致;
// 這一層先擋,RPC 會再擋一次(畫面上的字只是提示,真正的規則在資料庫)。
//
// 🔴 「還原成供應商的」= value null = RPC 刪掉那個鍵(片 1 CHECK:取消覆寫要刪鍵,不能寫 null)。
//    B3 之後畫面上的「還原成供應商的」只是把那一欄清空, 按儲存才送出 ⇒ 還原就是「存空白」。
// 🔴 存空白 = 還原:員工把欄位清空再按儲存,意思就是「不要我們的版本了」,不會存一個空白標題。
// 🔴 description 不在這裡:說明走說明鎖(Sean 2026-09-02 ⟦b4-QUOTEDESCLOCK⟧),見 20260927040000 檔頭。

import { anyMalformed, readSingleString as readString } from '../forms/single-value';
import type { FormLike } from '../orders/workflow-form';

export const OVERRIDE_PRODUCT_ID_FIELD = 'product_id';
export const OVERRIDE_TITLE_FIELD = 'title';
export const OVERRIDE_SUBTITLE_FIELD = 'subtitle';
export const OVERRIDE_HIGHLIGHT_FIELD = 'highlight';
/**
 * 畫面上沒動過的欄位(可送多次)。伺服器不送這幾欄 ⇒ 存標題時不會順手用舊內容蓋掉別人剛改的副標、賣點,
 * 也不會多寫稽核。它只能讓伺服器「少寫」, 不能讓伺服器寫別的東西 ⇒ 信它是安全的。
 */
export const OVERRIDE_UNCHANGED_FIELD = 'unchanged';

export const OVERRIDE_FIELDS = ['title', 'subtitle', 'highlights'] as const;
export type OverrideField = (typeof OVERRIDE_FIELDS)[number];

export const OVERRIDE_FIELD_LABEL: Readonly<Record<OverrideField, string>> = { title: '標題', subtitle: '副標', highlights: '賣點' };

export const OVERRIDE_TEXT_MAX: Readonly<Record<'title' | 'subtitle', number>> = { title: 200, subtitle: 300 };
export const OVERRIDE_HIGHLIGHT_MAX = 200;
export const OVERRIDE_HIGHLIGHTS_MAX_COUNT = 12;

const SINGLE_FIELDS = [OVERRIDE_PRODUCT_ID_FIELD, OVERRIDE_TITLE_FIELD, OVERRIDE_SUBTITLE_FIELD] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// 與 RPC 的 v_ws 同族:JS 的 \s 已含全形空白 U+3000;另外補幾個 \s 不含的零寬字元。
const trimAll = (s: string) => s.replace(/^[\s\u0085᠎​‌‍⁠﻿]+|[\s\u0085᠎​‌‍⁠﻿]+$/g, '');
const CONTROL_RE = /[\u0000-\u001F\u007F-\u009F]/;

export interface OverrideTextValues {
  readonly title: string | null;
  readonly subtitle: string | null;
  readonly highlights: string[] | null;
}

export type OverrideTextParseResult =
  | { ok: true; productId: string; values: OverrideTextValues; unchanged: OverrideField[] }
  /** badField:哪一欄不合規則(給員工看);null = 表單本身壞了(不是員工打的字的問題)。 */
  | { ok: false; badField: OverrideField | null };

/** 單行文字:空白 = null(還原);超過上限或含控制字元 = undefined(不合法)。 */
function readText(form: FormLike, name: 'title' | 'subtitle'): string | null | undefined {
  const text = trimAll(readString(form, name) ?? '');
  if (text === '') return null;
  if (text.length > OVERRIDE_TEXT_MAX[name] || CONTROL_RE.test(text)) return undefined;
  return text;
}

function readHighlights(form: FormLike): string[] | null | undefined {
  const items: string[] = [];
  for (const entry of form.getAll(OVERRIDE_HIGHLIGHT_FIELD)) {
    if (typeof entry !== 'string') return undefined;
    const t = trimAll(entry);
    if (t === '') continue;
    if (t.length > OVERRIDE_HIGHLIGHT_MAX || CONTROL_RE.test(t)) return undefined;
    items.push(t);
  }
  if (items.length > OVERRIDE_HIGHLIGHTS_MAX_COUNT) return undefined;
  return items.length === 0 ? null : items;
}

export function parseOverrideTextForm(form: FormLike): OverrideTextParseResult {
  if (anyMalformed(form, SINGLE_FIELDS)) return { ok: false, badField: null };
  const productId = readString(form, OVERRIDE_PRODUCT_ID_FIELD);
  if (!productId || !UUID_RE.test(productId)) return { ok: false, badField: null };

  const unchanged: OverrideField[] = [];
  for (const u of form.getAll(OVERRIDE_UNCHANGED_FIELD)) {
    if (typeof u !== 'string' || !(OVERRIDE_FIELDS as readonly string[]).includes(u)) return { ok: false, badField: null };
    if (!unchanged.includes(u as OverrideField)) unchanged.push(u as OverrideField);
  }
  // 沒動過的欄位不檢查、不送(值給 null, 呼叫端看 unchanged 跳過)。
  const skip = (f: OverrideField) => unchanged.includes(f);

  // Fable R2 建議:沒標 unchanged 的欄位卻沒送 ⇒ 表單壞了, 不能當成「清空 = 還原」(會靜默刪掉我們的版本)。
  if (
    (!skip('title') && form.getAll(OVERRIDE_TITLE_FIELD).length === 0) ||
    (!skip('subtitle') && form.getAll(OVERRIDE_SUBTITLE_FIELD).length === 0) ||
    (!skip('highlights') && form.getAll(OVERRIDE_HIGHLIGHT_FIELD).length === 0)
  ) {
    return { ok: false, badField: null };
  }
  const title = skip('title') ? null : readText(form, OVERRIDE_TITLE_FIELD);
  if (title === undefined) return { ok: false, badField: 'title' };
  const subtitle = skip('subtitle') ? null : readText(form, OVERRIDE_SUBTITLE_FIELD);
  if (subtitle === undefined) return { ok: false, badField: 'subtitle' };
  const highlights = skip('highlights') ? null : readHighlights(form);
  if (highlights === undefined) return { ok: false, badField: 'highlights' };
  return { ok: true, productId, values: { title, subtitle, highlights }, unchanged };
}

// ── 存完的結果與給員工看的話 ───────────────────────────────────────────
// 型別與文字放在這裡(不是 'use server' 檔):server action 檔只能匯出 async 函式。

export type OverrideFieldOutcome = 'saved' | 'restored' | 'noop' | 'invalid' | 'denied' | 'error';

export type TextSaveState =
  | { kind: 'idle' }
  /** 三欄都送過了(各自的結果);找不到商品、沒登入、內容不合規則走 failed。 */
  | { kind: 'done'; results: { field: OverrideField; outcome: OverrideFieldOutcome }[] }
  | { kind: 'failed'; message: string };

// 🔴 error 不寫「儲存失敗」:錯誤可能發生在寫入之後(例如回應在路上斷掉),結果沒辦法確認(同 result-banner 的 override_error)。
const FIELD_PROBLEM: Readonly<Record<'invalid' | 'denied' | 'error', string>> = {
  invalid: '沒有儲存，字數超過上限，或含有不能使用的字元。請修改後再儲存。',
  denied: '沒有儲存：登入已過期，或這個帳號目前不能修改商品。請重新登入後再試；仍無法儲存時請聯絡系統管理員。',
  error: '無法確認是否已儲存。請重新整理頁面查看目前內容；若沒有更新，再試一次，仍失敗請聯絡系統管理員。',
};

export function describeTextSave(state: TextSaveState): { tone: 'ok' | 'error'; lines: string[] } | null {
  if (state.kind === 'idle') return null;
  if (state.kind === 'failed') return { tone: 'error', lines: [state.message] };
  const names = (o: OverrideFieldOutcome) =>
    state.results.filter((r) => r.outcome === o).map((r) => OVERRIDE_FIELD_LABEL[r.field]);
  const lines: string[] = [];
  const saved = names('saved');
  const restored = names('restored');
  if (saved.length > 0) lines.push(`已儲存：${saved.join('、')}。`);
  if (restored.length > 0) lines.push(`已還原成供應商的：${restored.join('、')}。`);
  if (saved.length + restored.length > 0) lines.push('網站約 1 分鐘內會顯示新的內容。');
  const problems = state.results.filter(
    (r): r is { field: OverrideField; outcome: 'invalid' | 'denied' | 'error' } =>
      r.outcome === 'invalid' || r.outcome === 'denied' || r.outcome === 'error',
  );
  for (const r of problems) lines.push(`${OVERRIDE_FIELD_LABEL[r.field]}：${FIELD_PROBLEM[r.outcome]}`);
  if (lines.length === 0) lines.push('內容和目前相同，沒有變更。');
  return { tone: problems.length > 0 ? 'error' : 'ok', lines };
}
