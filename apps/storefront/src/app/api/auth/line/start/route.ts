// app/api/auth/line/start/route.ts — LINE OAuth 起手 route(M-1-14e-f2-a1、Q4=Y 自寫)
//
// 對齊 PRD §8.5 step 1:產 state(防 CSRF)+ nonce(OIDC replay 防護)→ 寫短效 cookie → redirect LINE authorize。
// - cookie:httpOnly + Secure(prod)+ SameSite=Lax + path '/api/auth/line'(只送 LINE auth routes)+ maxAge 10min。
//   SameSite=Lax 必要:/callback 是 LINE 來的 top-level 跨站導航、Lax 允許 top-level GET 帶 cookie。
// - redirect 目標(LINE authorize URL)由 env(LINE_CHANNEL_ID/REDIRECT_URI)+ 本次 state/nonce 組、不取自請求輸入
//   → 無 open-redirect(沿用 f1-c /auth/callback 教訓、codex 關卡1 finding-e)。
// - runtime='nodejs':本路徑(及 /callback)用 node:crypto + LINE fetch + service_role〔/callback〕、強制 Node runtime、
//   不跑 edge(對齊 Sean Q1=A service_role 受控小門紀律、codex 關卡1 finding-b)。
//
// f2-a1 範圍:只到「導向 LINE」;/callback(換 token + 發 session)為 f2-a2;LoginPage 鈕接線為 f2-b
// (後台未完成前鈕維持惰性、不上線壞掉的半流程、codex 關卡1 finding-5)。

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  buildAuthorizeUrl,
  generateNonce,
  generateState,
  LINE_NONCE_COOKIE,
  LINE_OAUTH_COOKIE_MAX_AGE,
  LINE_OAUTH_COOKIE_PATH,
  LINE_STATE_COOKIE,
} from '@/lib/auth/line';

export const runtime = 'nodejs';

export async function GET() {
  const state = generateState();
  const nonce = generateNonce();
  // 先組 URL(getLineConfig 缺 env 則 throw、fail fast)、再寫 cookie → redirect。
  const authorizeUrl = buildAuthorizeUrl({ state, nonce });

  const cookieStore = await cookies();
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // 本地 http://localhost 不可設 secure、否則 cookie 不落地
    sameSite: 'lax' as const,
    path: LINE_OAUTH_COOKIE_PATH,
    maxAge: LINE_OAUTH_COOKIE_MAX_AGE,
  };
  cookieStore.set(LINE_STATE_COOKIE, state, cookieOptions);
  cookieStore.set(LINE_NONCE_COOKIE, nonce, cookieOptions);

  redirect(authorizeUrl); // 外部絕對 URL(LINE)、由 env + 本次 state/nonce 組、非請求輸入。
}
