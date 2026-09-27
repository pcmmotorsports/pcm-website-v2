// 商品文字「我們的版本」表單解析(商品編輯丙方案片 2;純函式,無 'use server',可單測)。
// 鏡射 product-listing-form.ts。欄位與上限與 RPC admin_set_product_override(20260927060000)一致;
// 這一層先擋,RPC 會再擋一次(畫面上的字只是提示,真正的規則在資料庫)。
//
// 🔴 「還原成供應商的」= value null = RPC 刪掉那個鍵(片 1 CHECK:取消覆寫要刪鍵,不能寫 null)。
// 🔴 存空白 = 還原:員工把欄位清空再按儲存,意思就是「不要我們的版本了」,不會存一個空白標題。
// 🔴 description 不在這裡:說明走說明鎖(Sean 2026-09-02 ⟦b4-QUOTEDESCLOCK⟧),見 20260927040000 檔頭。

import { anyMalformed, readSingleString as readString } from '../forms/single-value';
import type { FormLike } from '../orders/workflow-form';
import { parseProductsReturnTo } from './product-listing-form';

export const OVERRIDE_PRODUCT_ID_FIELD = 'product_id';
export const OVERRIDE_FIELD_FIELD = 'field';
export const OVERRIDE_INTENT_FIELD = 'intent';
export const OVERRIDE_VALUE_FIELD = 'value';
export const OVERRIDE_HIGHLIGHT_FIELD = 'highlight';
export const OVERRIDE_RETURN_TO_FIELD = 'return_to';

export const OVERRIDE_FIELDS = ['title', 'subtitle', 'highlights'] as const;
export type OverrideField = (typeof OVERRIDE_FIELDS)[number];

export const OVERRIDE_TEXT_MAX: Readonly<Record<'title' | 'subtitle', number>> = { title: 200, subtitle: 300 };
export const OVERRIDE_HIGHLIGHT_MAX = 200;
export const OVERRIDE_HIGHLIGHTS_MAX_COUNT = 12;

const SINGLE_FIELDS = [
  OVERRIDE_PRODUCT_ID_FIELD,
  OVERRIDE_FIELD_FIELD,
  OVERRIDE_INTENT_FIELD,
  OVERRIDE_VALUE_FIELD,
  OVERRIDE_RETURN_TO_FIELD,
] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// 與 RPC 的 v_ws 同族:JS 的 \s 已含全形空白 U+3000;另外補幾個 \s 不含的零寬字元。
const trimAll = (s: string) => s.replace(/^[\s\u0085᠎​‌‍⁠﻿]+|[\s\u0085᠎​‌‍⁠﻿]+$/g, '');
const CONTROL_RE = /[\u0000-\u001F\u007F-\u009F]/;

export type OverrideParseResult =
  | { ok: true; productId: string; field: OverrideField; value: string | string[] | null; returnTo: string }
  | { ok: false };

export function parseOverrideForm(form: FormLike): OverrideParseResult {
  if (anyMalformed(form, SINGLE_FIELDS)) return { ok: false };

  const productId = readString(form, OVERRIDE_PRODUCT_ID_FIELD);
  if (!productId || !UUID_RE.test(productId)) return { ok: false };

  const field = readString(form, OVERRIDE_FIELD_FIELD);
  if (!field || !(OVERRIDE_FIELDS as readonly string[]).includes(field)) return { ok: false };

  const intent = readString(form, OVERRIDE_INTENT_FIELD);
  if (intent !== 'save' && intent !== 'restore') return { ok: false };

  const returnTo = parseProductsReturnTo(readString(form, OVERRIDE_RETURN_TO_FIELD));
  const base = { ok: true as const, productId, field: field as OverrideField, returnTo };
  if (intent === 'restore') return { ...base, value: null };

  if (field === 'highlights') {
    const raw = form.getAll(OVERRIDE_HIGHLIGHT_FIELD);
    const items: string[] = [];
    for (const entry of raw) {
      if (typeof entry !== 'string') return { ok: false };
      const t = trimAll(entry);
      if (t === '') continue;
      if (t.length > OVERRIDE_HIGHLIGHT_MAX || CONTROL_RE.test(t)) return { ok: false };
      items.push(t);
    }
    if (items.length > OVERRIDE_HIGHLIGHTS_MAX_COUNT) return { ok: false };
    return { ...base, value: items.length === 0 ? null : items };
  }

  const text = trimAll(readString(form, OVERRIDE_VALUE_FIELD) ?? '');
  if (text === '') return { ...base, value: null };
  if (text.length > OVERRIDE_TEXT_MAX[field as 'title' | 'subtitle'] || CONTROL_RE.test(text)) return { ok: false };
  return { ...base, value: text };
}
