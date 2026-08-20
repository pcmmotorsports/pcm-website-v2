// app/api/auth/line/callback/route.ts — LINE OAuth callback route(M-1-14e-f2-a2、Q4=Y 自寫)
//
// 對齊 PRD §8.5 step 1-6:驗 state → 換 token → 驗 id_token → 建/查 LINE 用戶(service_role)→ 發 session → redirect。
// - **單一 redirect 點、在 try 外**:resolveDestination 回字串、GET 末尾唯一 redirect()。避免 redirect() 的
//   NEXT_REDIRECT throw 被 try/catch 吞掉(否則成功路徑會被當失敗再導 error)。
// - state 比對用 timingSafeEqual + 長度先檢(長度不等直接 false、避免 timingSafeEqual throw;codex 關卡1 finding-7)。
// - state/nonce cookie 用後即刪、**所有路徑都清**(成功 / 失敗 / 早退;codex 關卡1 finding-7)。
// - 任一步失敗(state 不符 / LINE 錯 / 冒登入 / verifyOtp 錯)→ redirect '/login?error=line'(相對、不上洩原始 error);
//   🔴 #190 起**失敗也帶 next**(`&next=`,見 lineErrorRedirect):cookie 已被刪、不帶就永遠回不去了。
// - session 發放分工:service_role(line-admin.ts)產 hashed_token;anon cookie client(lib/supabase/server)verifyOtp
//   寫 session cookie(對齊 d-2 雙 client 紀律)。
// - runtime='nodejs':用 node:crypto + LINE fetch + service_role(line-admin)、強制 Node runtime(Q1=A 紀律)。

import { timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { authenticateLineUser } from '@/lib/auth/line-admin';
import {
  exchangeCodeForToken,
  LINE_NEXT_COOKIE,
  LINE_NONCE_COOKIE,
  LINE_OAUTH_COOKIE_PATH,
  LINE_STATE_COOKIE,
  verifyIdToken,
} from '@/lib/auth/line';
import { sanitizeNextParam } from '@/lib/auth/safe-redirect';

export const runtime = 'nodejs';

const LINE_ERROR_REDIRECT = '/login?error=line';

/**
 * 失敗時的導回目的地。🔴 **#190 codex 關卡2 MF-2:失敗路徑也要把 next 帶著走。**
 *
 * 為什麼這條比 Google 那條重:LINE 的 next 住在 **cookie**,而 :108-110 **所有路徑都會刪它**
 * (單次有效、CSRF 衛生,那是對的、不動它)⇒ 失敗一次之後,客人重試登入時**已經沒有東西可以帶他回去**,
 * 而那個回不去的地方可能是**已經扣款完成的 `/checkout/callback`** —— 不是「重走一次結帳」,
 * 是「他可能已經付錢了,而他回不到看結果的那一頁」。
 *
 * 🔴 修法刻意**不是**讓 cookie 活下來(那會拆掉單次有效那道防線),而是**把值搬進 URL query**:
 *   · 值的來源是我方 start route 存的、已 sanitize(`line/start/route.ts:34`),不是外部直接可控;
 *   · 這裡**再過一次** `sanitizeNextParam`(sink 端縱深,與 :89 成功路徑同一把白名單);
 *   · 產出是站內相對路徑,維持 :8 那條「不上洩、不組絕對 URL」。
 */
function lineErrorRedirect(next: string | undefined): string {
  if (!next) return LINE_ERROR_REDIRECT;
  return `${LINE_ERROR_REDIRECT}&next=${encodeURIComponent(sanitizeNextParam(next))}`;
}

/** 等長 constant-time 比對;長度不等先回 false(timingSafeEqual 要求等長 Buffer、否則 throw)。 */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

type CallbackInput = {
  code: string | null;
  state: string | null;
  storedState: string | undefined;
  nonce: string | undefined;
  next: string | undefined; // #190:start 存的(已 sanitize)next cookie 值
};

/** 回 redirect 目的地(相對路徑);所有失敗都回 lineErrorRedirect(next)、不上洩。redirect() 由 GET 末尾單點呼叫。 */
async function resolveDestination({ code, state, storedState, nonce, next }: CallbackInput): Promise<string> {
  // CSRF:code + state + 兩 cookie 齊全且 state 比對相符(含 LINE 取消授權無 code 的情形)。
  if (!code || !state || !storedState || !nonce || !safeEqual(state, storedState)) {
    return lineErrorRedirect(next);
  }
  try {
    const { idToken } = await exchangeCodeForToken(code);
    const identity = await verifyIdToken(idToken, nonce);
    const result = await authenticateLineUser(identity);
    if (!result.ok) {
      return lineErrorRedirect(next); // invalid_sub / collision_not_line(防冒登入)
    }
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: result.hashedToken,
      type: 'email',
    });
    if (error) {
      return lineErrorRedirect(next);
    }
    // #190:成功 → 導回 sanitize 過的 next(cookie 值 start 已 sanitize、此處 sink 再驗一次縱深;不安全→ '/')。
    return sanitizeNextParam(next);
  } catch {
    // LINE / Supabase 任一失敗 → 不上洩原始 error、導回登入頁(next 跟著走,見 lineErrorRedirect)。
    return lineErrorRedirect(next);
  }
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const { searchParams } = new URL(request.url);
  const input: CallbackInput = {
    code: searchParams.get('code'),
    state: searchParams.get('state'),
    storedState: cookieStore.get(LINE_STATE_COOKIE)?.value,
    nonce: cookieStore.get(LINE_NONCE_COOKIE)?.value,
    next: cookieStore.get(LINE_NEXT_COOKIE)?.value, // #190:start 存的已 sanitize next
  };

  // 用後即刪(所有路徑):state / nonce / next cookie 單次有效。
  cookieStore.delete({ name: LINE_STATE_COOKIE, path: LINE_OAUTH_COOKIE_PATH });
  cookieStore.delete({ name: LINE_NONCE_COOKIE, path: LINE_OAUTH_COOKIE_PATH });
  cookieStore.delete({ name: LINE_NEXT_COOKIE, path: LINE_OAUTH_COOKIE_PATH });

  const destination = await resolveDestination(input);
  redirect(destination); // 唯一 redirect 點、相對路徑、try 外。
}
