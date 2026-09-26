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

//
// 資安修正片 2(2026-09-26,計畫 ~/pcm-mailbox/計畫-資安修正-註冊登入-20260926.md §四):註冊確認信也落在這裡。
// 🔴 不走 /auth/callback:那條路的 PKCE verifier 只存在發起註冊的那個瀏覽器, 客人在電腦註冊、用手機開信就失敗。
//    Supabase 後台「Confirm signup」範本的連結要改成
//    {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email —— 只有 Sean 能改。
// 🔴 只有 type=email 跑站別檢查(同 /auth/callback 那一道);invite / recovery 維持不跑(見上)。
//    檢查回錯就照它的錯誤頁導, 不顯示確認成功。驗證失敗 ⇒ /login?error=confirm, 不沿用瀏覽器原本登入的帳號。
// 成功導到 /?confirmed=1:首頁那段提示的 Email 取自登入狀態, 不信網址參數。
//
// 🔴 2026-09-26 上線後修正(正式站實測):帶著另一個帳號「快過期」的登入開連結時, 背景換發舊登入會蓋掉剛確認的新帳號
//    (正式站 Supabase auth log 2026-09-25 19:33:38:/verify 登入 47eefd4d, 8ms 後 refresh_token 換出 e434e6fb)。
//    先前在這裡 verifyOtp 前 await getSession(), 2026-09-26 改由共用的 createSignInSupabaseClient 處理
//    (lib/supabase/server.ts 檔尾:登入前先清掉快過期的舊登入;Sean Q27 甲)。重現測試:race.test.ts、lib/supabase/server-race.test.ts。
// 🔴 同一個連結被開第二次(客人再點一次、或瀏覽器重送)時 token 已用掉。type=email 若此刻登入的帳號
//    剛在 10 分鐘內確認過 Email, 就當成確認成功, 不顯示「連結失效」。只看登入狀態, 不信網址。

import { redirect } from 'next/navigation';
import { createSignInSupabaseClient } from '@/lib/supabase/server';
import { checkSiteAfterLogin, siteLoginErrorPath } from '@/lib/auth/site-login-gate';
import { getVerifiedUser } from '@/lib/auth/verified-user';

const ALLOWED_TYPES = ['invite', 'recovery', 'email'] as const;
/** 連結被開第二次時, 登入中的帳號多久內確認過 Email 才算「剛剛確認的就是它」。 */
const RECENT_CONFIRM_MS = 10 * 60 * 1000;

async function justConfirmedInThisBrowser(): Promise<boolean> {
  const { user } = await getVerifiedUser();
  const at = user?.email_confirmed_at ? Date.parse(user.email_confirmed_at) : NaN;
  return Date.now() - at < RECENT_CONFIRM_MS;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get('token_hash');
  const type = ALLOWED_TYPES.find((t) => t === url.searchParams.get('type'));

  let ok = false;
  if (tokenHash && type) {
    const supabase = await createSignInSupabaseClient(); // 見檔頭:先清掉快過期的舊登入
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    ok = !error;
    if (error) console.warn('[auth/confirm] 連結驗證失敗', { type, code: (error as { code?: unknown }).code });
  }
  if (type === 'email') {
    if (!ok && !(tokenHash && (await justConfirmedInThisBrowser()))) redirect('/login?error=confirm');
    const siteError = await checkSiteAfterLogin();
    redirect(siteError ? siteLoginErrorPath(siteError) : '/?confirmed=1');
  }
  redirect(ok ? '/login/reset' : '/login/reset?expired=1');
}
