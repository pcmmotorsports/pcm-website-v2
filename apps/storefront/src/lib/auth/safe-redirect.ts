// lib/auth/safe-redirect.ts — 登入後導回 next 同源白名單(#190、🔴 鐵則 12 open-redirect 防護)
//
// 受保護頁(account)未登入 → /login?next=<path>;登入 / 註冊 / Google / LINE 成功後優先回 next。
// next 進來自 URL query(login/register form)或 cookie(LINE)、皆「外部可控輸入」→ redirect 前必過本白名單。
//
// 🔴 別重開 M-1-14e-f1-c(Google)+ f2(LINE callback)修過的 open-redirect 傷口(兩處 codex 關卡2 must-fix
// 已治「不從請求 host 組絕對 URL」)。本 helper 是「登入後導回」的單點白名單:集中審、單點防。

import { POST_AUTH_REDIRECT } from './constants';

/**
 * 控制字元(charCode ≤ 0x20、含 space + \t \n \r \f \v)/ DEL(0x7f)/ 反斜線(\):
 * 可繞過前綴檢查的注入向量。用 char-code 掃描(非 regex、避 no-control-regex + 表達清楚)。
 */
function hasUnsafeChar(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f || s[i] === '\\') return true;
  }
  return false;
}

/**
 * 把 next 參數收斂成「安全站內絕對路徑」、不安全 / 缺值 → fallback POST_AUTH_REDIRECT('/')。
 *
 * 只允許「單一 '/' 開頭的站內相對路徑」(瀏覽器對當前 origin 解析、不跨站)。拒絕:
 * - 非字串 / 空字串 / 不以 '/' 開頭(絕對 URL `http(s)://` / 任何 `scheme:` / 裸字串)
 * - protocol-relative(`//host`、`/\host`)→ 瀏覽器解析為外站 host
 * - 含反斜線(`\`)/ 控制字元 / 空白(可繞過前綴檢查的注入字元)
 *
 * 允許:站內路徑 + query + fragment(如 `/account`、`/products?cat=x`、`/p/123#spec`)。
 */
export function sanitizeNextParam(next: string | null | undefined): string {
  if (typeof next !== 'string' || next.length === 0) return POST_AUTH_REDIRECT;
  // 必須站內絕對路徑(單一 '/' 開頭)
  if (!next.startsWith('/')) return POST_AUTH_REDIRECT;
  // protocol-relative('//host' / '/\host')→ 外站
  if (next.startsWith('//') || next.startsWith('/\\')) return POST_AUTH_REDIRECT;
  // 反斜線 / 控制字元 / 空白
  if (hasUnsafeChar(next)) return POST_AUTH_REDIRECT;
  return next;
}
