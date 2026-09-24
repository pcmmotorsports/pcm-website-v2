// app/auth/confirm/route.ts — 邀請信與重設密碼信的連結落點(B2B 計畫 §9.9「D4a／D4b 共同」)。
//
// 員工在後台建經銷帳號(邀請信)或替客人寄重設密碼信時, 發信的是後台 server, 客人在自己的瀏覽器開信
// ⇒ /auth/callback 那條 PKCE code 交換走不通(驗證碼存在發起的那個瀏覽器)。
// 這裡改收信件模板帶的 token_hash, 在 server 端 verifyOtp 建立登入, 再導到 /login/reset 設定密碼。
// 🔴 要生效, Supabase 後台「Invite user」「Reset password」兩個信件模板的連結要改成
//    {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite(重設信是 type=recovery)——只有 Sean 能改。
// 🔴 不做登入分流(前台窗 pcm-website-v2-40 09-25 確認分流不接這條):經銷會員在一般站設密碼到一半不能被登出。
// 🔴 導向目的地寫死 /login/reset, 不收 next 參數;相對路徑, 不從 request host 組網址(同 /auth/callback 的理由)。
// 失敗 / 缺 token / type 不對 ⇒ /login/reset?expired=1:那頁一律顯示「這個連結不能用了」。
// 🔴 不能只導 /login/reset(Codex R1):瀏覽器原本已登入 A、開了 B 的過期連結, verifyOtp 失敗不會清掉 A,
//    設定密碼頁只看「有沒有登入」⇒ 會顯示 A 的表單, 送出改到 A 的密碼。

import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const ALLOWED_TYPES = ['invite', 'recovery'] as const;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get('token_hash');
  const type = ALLOWED_TYPES.find((t) => t === url.searchParams.get('type'));

  let ok = false;
  if (tokenHash && type) {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    ok = !error;
    if (error) console.warn('[auth/confirm] 連結驗證失敗', { type, code: (error as { code?: unknown }).code });
  }
  redirect(ok ? '/login/reset' : '/login/reset?expired=1');
}
