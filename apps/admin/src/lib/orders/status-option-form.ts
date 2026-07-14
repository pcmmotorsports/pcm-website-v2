// status-option-form.ts — 狀態選項設定 server action 的純函式核心(M-4a Slice D-3;可單測、無 'use server'/next 依賴)。
// authz(session/Origin)在 action 檔;本檔只做「表單 → OrderStatusOptionUpdate」的形狀層驗證
// (值域 fail-closed 權威在 DB CHECK:code slug / label 1..32 / color hex / text_color IN light,dark)。

import type { OrderStatusOptionUpdate } from '@pcm/domain';

// Origin 白名單複用 Slice C(prod 精確等值 https://admin.pcmmotorsports.com、缺 Origin 拒、dev localhost)。
export { isAllowedOrigin } from './workflow-form';

// ── 表單欄名 ──
export const CODE_FIELD = 'code';
export const LABEL_FIELD = 'label';
export const COLOR_FIELD = 'color';
export const TEXT_COLOR_FIELD = 'text_color';
export const SORT_ORDER_FIELD = 'sort_order';
export const IS_ACTIVE_FIELD = 'is_active';

// 值域(對齊 order_status_options DB CHECK:label/color/text_color = Slice A 20260714120000;
// code_not_reserved = 20260714130000;sort_order 無 CHECK,form 限 int4 有效域〔溢位走 invalid 非 DB RAISE〕)。
const CODE_RE = /^[a-z0-9_]{1,64}$/;
const COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
const LABEL_MAX = 32;
const SORT_ORDER_MAX = 2147483647; // int4 上限
/** DB 保留字(篩選哨兵 'unset' / 改單清空哨兵 '__clear__';order_status_options_code_not_reserved CHECK)。 */
const RESERVED_CODES = new Set(['unset', '__clear__']);

/** 表單讀取的最小介面(FormData 相容;單測用 Map 亦可)。 */
export interface FormLike {
  get(name: string): FormDataEntryValue | null;
  has(name: string): boolean;
}

function asString(v: FormDataEntryValue | null): string | null {
  return typeof v === 'string' ? v : null;
}

export type StatusOptionEditParse =
  | { ok: true; code: string; update: OrderStatusOptionUpdate }
  | { ok: false };

/**
 * 表單 → { code, update }(編輯既有選項;形狀層,值域 fail-closed 權威在 DB CHECK):
 * - code:必填、`^[a-z0-9_]{1,64}$`、非保留字('unset'/'__clear__')→ 指定要改「哪個」選項(非改 code 本身);
 * - label:trim 後 1..32 非空;
 * - color:`^#[0-9A-Fa-f]{6}$`;
 * - text_color:'light' | 'dark';
 * - sort_order:非負十進位整數(0..int4 上限);
 * - is_active:checkbox 存在(勾)=true、缺(不勾)=false;
 * 任一不合 → ok:false(action 退 'invalid'、不靜默寫壞值)。
 */
export function parseStatusOptionEditForm(form: FormLike): StatusOptionEditParse {
  const code = asString(form.get(CODE_FIELD));
  if (!code || !CODE_RE.test(code) || RESERVED_CODES.has(code)) return { ok: false };

  const label = (asString(form.get(LABEL_FIELD)) ?? '').trim();
  if (label === '' || label.length > LABEL_MAX) return { ok: false };

  const color = asString(form.get(COLOR_FIELD)) ?? '';
  if (!COLOR_RE.test(color)) return { ok: false };

  const textColor = asString(form.get(TEXT_COLOR_FIELD));
  if (textColor !== 'light' && textColor !== 'dark') return { ok: false };

  const sortRaw = (asString(form.get(SORT_ORDER_FIELD)) ?? '').trim();
  if (!/^\d{1,10}$/.test(sortRaw)) return { ok: false };
  const sortOrder = Number(sortRaw);
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > SORT_ORDER_MAX) {
    return { ok: false };
  }

  // checkbox:present(勾)=true、absent(不勾)=false(bare checkbox、未勾不送)。
  const isActive = form.has(IS_ACTIVE_FIELD);

  return { ok: true, code, update: { label, color, textColor, sortOrder, isActive } };
}
