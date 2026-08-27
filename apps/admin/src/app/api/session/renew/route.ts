// ⚠️⚠️ **2026-08-27:本檔【在正式站上跑的那一版】與你眼前這一版不一樣。**
//    `5276411e`(片二)欠兩場審查就被推上 `origin/dev`(= pcm-admin 的 production 分支),
//    而補審抓到 **15 條 must-fix**。修在 `bc61afe6`,**而那一顆還沒推**。
//    🔴 最會咬人的一條:staff 表抖一次 ⇒ 每個開著的分頁**永久**停止續期 ⇒ 15 分鐘內全體被踢。
//    🔴 **這一段話會過期, 而過期時【沒有任何訊號】** —— 所以不要相信它, 自己跑這一行:
//       `git merge-base --is-ancestor bc61afe6 origin/dev && echo 已推 || echo 未推`
//       印「已推」⇒ 本段已完成任務, **請連同這幾行一起刪掉**。
//    📌 我今晚修的毛病裡有一條就是「一段被推翻的註解還留在檔案裡」(`callback/route.ts` 那段
//      『停用後最多 12 小時』, 舊字面算出來的數字大 48 倍)⇒ 本段自帶判別法, 是為了不變成第二條。

import { NextRequest, NextResponse } from 'next/server';
import { getRequestId } from '@/lib/audit/context';
import {
  ADMIN_SESS_COOKIE,
  ADMIN_SESSION_MAX_AGE_SEC,
  ADMIN_SESSION_RENEW_WHEN_REMAINING_SEC,
  SSO_CHAIN_MAX_AGE_SEC,
  adminSessionCookieOptions,
  buildAdminSession,
  signSession,
  ssoChainExpired,
  verifySession,
} from '@/lib/session/session';
import { planStaffGate } from '@/lib/session/read-gate';
import { isAllowedOrigin } from '@/lib/orders/workflow-form';
import { resolveActiveStaffById } from '@/lib/staff';

// B5-b′ 片二:**靜默續期**。前端在票快到期時 `fetch` 這裡,拿一張新的 15 分鐘票。
//
// 🔴🔴 **為什麼可以自己重簽,而不用跑一趟報價單**(plan §1,附行號):
//    `buildAdminSession` 要的三個東西(`amr` / `auth_time` / `sub`)**舊票上都有**,
//    而 `is_active` 查的是**我們自己的 `staff` 表** ⇒ 這一趟不需要上游參與。
//    ⇒ **零 redirect** ⇒ 使用者頁面狀態不會掉。
//
// 🔴 **本路由【不進】`SSO_OPEN_PATHS`** —— 它自己驗票,
//    不是「未登入可達」的第三條白名單。proxy 的登入閘照樣先擋一次。
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 回應形狀 —— **前端要分得出這幾種,而它們的處置完全不同。**
 *
 * 🔴 2026-08-27 補審:原句寫「這三種」而型別上是五個(`fresh` / `error` 是補審加的)。
 *    ⇒ 註解裡的**數字**是最容易與碼脫節的東西, 而它讀起來完全合理。
 *
 * 🔴 這是本片的**硬需求**,不是 nice-to-have。理由是 2026-08-26 實測到的那條鏈:
 * ```
 * 票過期 ⇒ proxy 回 303 ⇒ /api/sso/start ⇒ 302 ⇒ 跨來源到報價單站
 * 而 fetch() 【預設會跟著 redirect 走】⇒ 跟到跨來源那一跳 ⇒ CORS 擋住
 * ⇒ fetch 失敗, 而失敗是【不透明的】:拿不到狀態碼、看不出發生什麼
 * ```
 * ⇒ 📌 **「靜默續期」只在票還沒過期時成立。晚一秒,失敗會是無聲且看不懂的那種。**
 * ⇒ 所以前端呼叫時要用 `redirect: 'manual'`(見 `components/session/session-renew.tsx`),
 *   而本端點對「還能不能續」給出**明確的、可分辨的**答案。
 */
type RenewOutcome = 'renewed' | 'fresh' | 'chain-expired' | 'not-active' | 'bad-origin' | 'error';

function json(outcome: RenewOutcome, status: number, requestId: string): NextResponse {
  const res = NextResponse.json({ outcome }, { status });
  res.headers.set('Cache-Control', 'no-store');
  res.headers.set('Referrer-Policy', 'no-referrer');
  // 🔴 回報用的編號要跟得回 log —— 片一那顆的教訓:
  //    一個「請附上編號」的畫面配一個查不到編號的 log, 比不給編號更糟。
  res.headers.set('x-request-id', requestId);
  return res;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const requestId = await getRequestId();

  // 🔴 **Origin fail-closed**(codex 補審 MF3)。缺 Origin 就拒,不是「沒帶就放行」。
  //    這是一個**會發新認證 cookie 的 POST** ⇒ 它屬於 mutation 那一族,
  //    而本 repo 每一支 mutation 都過 `authorizeAdminMutation` 的同一道 Origin 閘。
  //    ⚠️ `SameSite=Lax` **擋不住同站子網域** —— `__Host-` 讓 cookie 是 host-only(不外送給子網域),
  //       而子網域【送請求過來】時 cookie 照樣會帶上。同站 = Lax 不管。
  //    🔴 **刻意重用 `isAllowedOrigin` 而不自己寫一份**:那個字面
  //       (`https://admin.pcmmotorsports.com`)已經是正式站每一次改單都在跑的承重件
  //       ⇒ 它若是錯的,後台早就整片壞了。**重用把「配錯」這個風險降到既有水位,自己寫一份會新開一個。**
  const devBypass = process.env.NODE_ENV !== 'production' && process.env.ADMIN_DEV_BYPASS === '1';
  //    🔴 `#948`(2026-08-27):dev 分支現在要比對【本伺服器自己的 host】。
  //       **只讀 `host`,不讀 `x-forwarded-host`** —— 實測兩個會一起被假 Host 騙
  //       (射程:本 repo 現行 dev、無反代;有反代時會反過來 —— 見 `workflow-form.ts` docstring)。
  //       🔴 **而這支是 `#948` 唯一【真正可達】的那條路**:Next 對 server action 自己有一道
  //          Origin vs Host,對 route handler 沒有。`authorize.ts` 那道是縱深。
  if (
    !isAllowedOrigin(req.headers.get('origin'), { devBypass, host: req.headers.get('host') })
  ) {
    return json('bad-origin', 403, requestId);
  }

  const payload = await verifySession(req.cookies.get(ADMIN_SESS_COOKIE)?.value);

  // 🔴 票已經無效(過期/簽章不符/缺)⇒ **401,而不是導向。**
  //    導向會讓 fetch 跟到跨來源那一跳 ⇒ 失敗變不透明(見上方那條鏈)。
  //    ⚠️ 而實務上走不太到這裡:proxy 的登入閘會先把它 303 掉。
  //       留著它是因為**「今天走不到」與「這裡有處理」是兩件事** ——
  //       proxy 的 matcher 改一個字,這裡就會變成第一線。
  if (!payload) return json('not-active', 401, requestId);

  // 🔴 **票鏈的絕對上限** —— 續期不經報價單 ⇒ 沒有這道天花板,一張被偷的票可以永遠續。
  //    這一格回 `chain-expired`,而前端**不該靜默重試** —— 它要讓使用者走一次完整登入。
  if (ssoChainExpired(payload)) return json('chain-expired', 401, requestId);

  // 🔴 **還早 ⇒ 直接回,【不碰 DB】**(片二補審 M1)。
  //    原本沒有這一格 ⇒ 前端每 60 秒敲一次, 每一次都查一發 staff 表:
  //    一個分頁一天約 480 次, 五個分頁一人一天 2400 次 —— 而當時 `session-renew.tsx` 的
  //    `RENEW_WHEN_REMAINING_SEC` 註解逐字寫著「否則等於每次巡邏都在續 —— 那是無謂的 DB 查詢」,
  //    那正是當時的行為。(不寫行號:那支檔已重寫, 行號會漂而字面不會 —— codex 補審 nit。)
  //    ⚠️ 這一格排在鏈上限【之後】:鏈到頂就是到頂, 不因為「票還沒過期」而被蓋掉。
  if (payload.exp - Math.floor(Date.now() / 1000) > ADMIN_SESSION_RENEW_WHEN_REMAINING_SEC) {
    return json('fresh', 200, requestId);
  }

  // ⚠️ **「每次續期都會查 is_active」這句話【不成立】**(codex 補審 MF4,誠實寫下來而不是偷偷修):
  //    `planStaffGate` 只對 `v:2` 具名票回 `require-active-staff`;
  //    `v:1` / `fallback` / bootstrap 這三種**一次 DB 都不查**就續(測試 [R5] 明確斷言這件事,
  //    依規格 §7.1 壞世界① —— 那是**刻意的可用性設計**:staff 表掛掉時後台不該整個停擺)。
  //    ⇒ 這三種票的唯一天花板就是上面那個鏈上限。**修法不是在這裡加查詢**(那會把 #935 的
  //      fail-open 設計反轉,屬於要 Sean 拍板的範圍)⇒ 先把宣稱改成真的。
  const gate = planStaffGate(payload.v === 2 ? payload.sub : undefined);
  if (gate.kind === 'require-active-staff') {
    // 🔴 與片一走**同一支** `resolveActiveStaffById` —— 兩邊語意一旦漂掉,
    //    「簽票時算數、續期時不算數」這種狀態會出現,而沒有測試看得到。
    if ((await resolveActiveStaffById(gate.staffId)) === null) {
      return json('not-active', 403, requestId);
    }
  }

  // 🔴🔴 **新票的 `exp` 不得越過鏈尾**(codex 補審 MF1)。
  //    原本只擋「還能不能再簽」,沒有擋「簽出來的那張活到什麼時候」
  //    ⇒ 在鏈齡 11:59:59 續一發 ⇒ 新票活到 **12:14:59** ⇒ 比片二之前【多了近 15 分鐘】。
  //    📌 而 `session.ts` 逐字宣稱「最壞情況與片二之前完全一樣」——
  //      **那句話在這一行加上去之前是假的。** 一個天花板只擋住「再蓋一層」,
  //      而沒有擋住「最後那一層可以蓋多高」。
  //    ⚠️ `ssoChainExpired` 已在上面擋過 ⇒ 這裡 `chainRemaining` 必為正。
  const chainStart = payload.sso_at ?? payload.iat;
  const chainRemaining = chainStart + SSO_CHAIN_MAX_AGE_SEC - Math.floor(Date.now() / 1000);
  const next = buildAdminSession(
    payload.amr,
    payload.auth_time,
    payload.v === 2 ? payload.sub : undefined,
    // 🔴 **`sso_at` 原封抄過去** —— 讓它重新開始 = 那個 12 小時上限永遠不會到,
    //    而它是本片唯一的天花板。
    {
      ssoAt: chainStart,
      maxAgeSec: Math.min(ADMIN_SESSION_MAX_AGE_SEC, chainRemaining),
      // 🔴 **沿用舊 `sid`,不旋轉**(第三把審查 N1)。續期不是新的一次登入。
      //    旋轉的話, 稽核 log 裡同一次連線的動作會散成一堆對不起來的 sid。
      sid: payload.sid,
    },
  );
  const token = await signSession(next);
  // 簽不出 = 設定壞了(secret 缺)⇒ 不是「他不能續」⇒ 500,讓前端知道是我們壞了。
  // 走 json() 而不是自己組一份 —— 自己組的那份少了 Referrer-Policy, 而
  // 「同一個端點有兩條各自維護的回應路徑」是下一次漏掉標頭的原因(補審 nit1)。
  if (!token) return json('error', 500, requestId);

  const res = json('renewed', 200, requestId);
  res.cookies.set(ADMIN_SESS_COOKIE, token, adminSessionCookieOptions());
  return res;
}
