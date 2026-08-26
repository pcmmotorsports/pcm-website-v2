import { NextRequest, NextResponse } from 'next/server';
import { getRequestId } from '@/lib/audit/context';
import { isSafeRequestId } from '@/lib/request-id';
import {
  ADMIN_SESS_COOKIE,
  adminSessionCookieOptions,
  buildAdminSession,
  requireRealIdentity,
  signSession,
} from '@/lib/session/session';
import { planStaffGate } from '@/lib/session/read-gate';
import { resolveActiveStaffById } from '@/lib/staff';
import { getSsoConfig } from '@/lib/sso/config';
import { exchangeCode } from '@/lib/sso/exchange';
import { identityDropTrace } from '@/lib/sso/identity-drop-trace';
// 🔴 M-4b:改叫 `recordSsoLogin`(它自己會先寫 console 再 best-effort 進 DB)。
//    ~~原本直接叫 `logSsoLogin`~~ —— 兩個分開叫的話,下一個人加第五處失敗路徑時
//    很可能只叫其中一個,而**那時 DB 少一列不會有任何東西紅**。
import { recordSsoLogin } from '@/lib/sso/login-event';
import {
  SSO_STATE_COOKIE,
  clearStateCookieOptions,
  decodeStateCookie,
  safeReturnTo,
} from '@/lib/sso/state';

// M-4a M0-S3 SSO 收端 — callback:收 opaque code。
//   驗 state cookie 相符(login CSRF)→ server-to-server 兌換 → 簽 admin session(新 sid=旋轉)
//   → set session cookie + 清 state cookie → 303 導向乾淨相對 returnTo(allowlist)。
//   🔴 失敗路徑只清 state cookie、**絕不清 session cookie**(防並發/prefetch:另一個成功請求剛設好的 session
//      被 401 分支清掉;code 一次性、雙擊必一 200 一 401)。proxy 閘放行本路徑(未登入必須可達,否則無限迴圈)。
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 失敗:303 到錯誤頁、清 state cookie、no-referrer;不動 session cookie。 */
function failResponse(req: NextRequest): NextResponse {
  const res = NextResponse.redirect(new URL('/?sso=error', req.url), 303);
  res.cookies.set(SSO_STATE_COOKIE, '', clearStateCookieOptions());
  res.headers.set('Referrer-Policy', 'no-referrer');
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

/** 設定缺漏 500(帶與其他回應一致的安全標頭;不動任何 cookie)。 */
function configError(): NextResponse {
  const res = NextResponse.json({ error: '設定缺漏' }, { status: 500 });
  res.headers.set('Referrer-Policy', 'no-referrer');
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

/**
 * 查不到「在職的他」時的**終點頁**。
 *
 * 🔴🔴 **為什麼是終點頁,不是導回 `/api/sso/start`**(本片最重要的一條約束):
 *    導回去 ⇒ 報價單那側 session 還活著 ⇒ 它**直接發一張新碼導回來**
 *    (量到的:`~/API大量上架/PCM報價單-V2/app/api/sso/authorize/route.ts:55-57,:87` ——
 *     有 session 就發碼、不需要使用者做任何事)
 *    ⇒ 回到本函式 ⇒ 同一個 `staff_id` ⇒ 一樣查不到 ⇒ 又導回去
 *    ⇒ **兩站之間無限互踢,而畫面看起來只是「一直在轉圈」,不像被擋。**
 *    📌 那種故障最貴的地方是**它不像故障** —— 它像網路慢。
 *
 * 🔴🔴 **而頁面上【有一顆手動的「重新登入」】,那與上面那條不衝突**(codex R3 must-fix 4):
 *    ```
 *    自動導回  ⇒ 使用者沒有選擇 ⇒ 無限迴圈, 而他看到的是轉圈
 *    手動按鈕  ⇒ 使用者自己決定何時再試 ⇒ 最壞情況是【他再看到這一頁一次】
 *    ```
 *    ⇒ 📌 **「同一個目的地」在自動與手動之下是兩件事** —— 差別不在去哪裡,在**誰決定去**。
 *    ⚠️ **而沒有這顆按鈕的代價是具體的**:被誤停用的人, 在管理員改回來之後
 *       **重新整理只會拿那張【已經被兌換掉】的一次性 code 再失敗一次**
 *       ⇒ 他會以為「還是不行」, 而其實只要重新發起一次就好。
 *       ⇒ **我們會把一個【可恢復】的問題, 變成一個【他只能打電話】的問題。**
 *
 * 🔴 **文案為什麼把兩種可能都寫出來**:
 *    `resolveActiveStaffById` 對「查無此人 / 已停用 / **DB 讀不到**」回**同一個 null**(`#933`)。
 *    ⇒ 只寫「你已被停用」⇒ DB 抖動那天全公司以為自己被開除;
 *      只寫「載入失敗」⇒ 真的被停用的人會一直等。**兩件都講,並告訴他去找誰。**
 */
function inactiveStaffResponse(requestId: string): NextResponse {
  // 🔴 **插進 HTML 之前先驗形狀**(code-reviewer nit C1)。
  //    今天安全靠的是**別的檔**:`proxy.ts` 一律 `generateRequestId()` 覆寫 inbound
  //    ⇒ 值恆為 `req_<uuid>`。**那是一個非本地的不變式** —— 它成立與否不在本檔手上。
  //    ⚠️ 而 `isSafeRequestId()` 在 repo 裡**有定義卻零 production 呼叫端**
  //      (數法 `grep -rn isSafeRequestId apps/admin/src | grep -v '.test.' | grep -v 'export function' | wc -l` ⇒ 0)
  //      ⇒ 有人**打算**在某個邊界接受 inbound 值。而本檔是 admin 唯一一支自建 HTML 的 production 檔。
  //    📌 **「今天注不進來」與「這裡有防注入」是兩件事。** 這一行讓它變成後者。
  const safeId = isSafeRequestId(requestId) ? requestId : '(格式不正確, 已略去)';
  const body = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>無法確認員工身分</title></head>
<body style="font-family:system-ui,-apple-system,'Noto Sans TC',sans-serif;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#f5f5f5;color:#1a1a1a">
<main style="max-width:32rem;padding:2rem;background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.1)">
<h1 style="font-size:1.25rem;margin:0 0 1rem">無法確認你的員工身分</h1>
<p style="margin:0 0 1rem;line-height:1.7">可能是<strong>系統暫時讀不到員工名單</strong>,也可能是<strong>你的帳號已停用</strong>。<br>這兩種情況目前看起來一樣,請直接找管理員確認。</p>
<p style="margin:0 0 1.5rem;line-height:1.7;color:#444">管理員說已經處理好之後,再按下面這顆:</p>
<p style="margin:0 0 1.5rem"><a href="/api/sso/start" style="display:inline-block;padding:.625rem 1.25rem;background:#1a1a1a;color:#fff;text-decoration:none;border-radius:8px;font-size:.9375rem">重新登入一次</a></p>
<p style="margin:0;color:#666;font-size:.8125rem">回報時請附上這組編號:<code>${safeId}</code></p>
</main></body></html>`;
  const res = new NextResponse(body, { status: 403 });
  res.headers.set('Content-Type', 'text/html; charset=utf-8');
  res.headers.set('Referrer-Policy', 'no-referrer');
  res.headers.set('Cache-Control', 'no-store');
  // 🔴 **與其他失敗路徑一致地清掉 state cookie**(code-reviewer nit C2)。
  //    實害低(下次 `/start` 會覆寫), 而**兩條失敗路徑不一致本身**就是下一個人要花時間確認的東西。
  //    📌 一致性的價值不在這一次, 在下一個人【不用去查為什麼這裡不一樣】。
  res.cookies.set(SSO_STATE_COOKIE, '', clearStateCookieOptions());
  return res;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const requestId = await getRequestId();

  const config = getSsoConfig();
  if (!config) {
    await recordSsoLogin('fail', { requestId, reason: 'config-missing' }, req.headers);
    return configError();
  }

  const decoded = decodeStateCookie(req.cookies.get(SSO_STATE_COOKIE)?.value);
  const code = req.nextUrl.searchParams.get('code');
  const queryState = req.nextUrl.searchParams.get('state');

  // state 綁定:cookie 必須存在且 === query.state(cookie 缺 = 拒),code 必填。
  if (!decoded || !code || !queryState || decoded.s !== queryState) {
    await recordSsoLogin('fail', { requestId, reason: 'state-mismatch' }, req.headers);
    return failResponse(req);
  }

  const result = await exchangeCode(code, decoded.s, config);
  if (!result) {
    await recordSsoLogin('fail', { requestId, reason: 'exchange-failed' }, req.headers);
    return failResponse(req);
  }

  // ══ 🔴🔴 部署時序閘(2026-08-24 codex B1-5;主視窗 Q-a 批准)═══════════════
  //
  // **偵測一個自我矛盾**:旗標開著 = 我等一下會【拒絕】`v:1` 票;
  // 而上游沒送 `sub` = 我現在只簽得出 `v:1`
  // ⇒ 我正要簽一張**我自己保證會拒絕**的票。
  //
  // 不擋的話會發生什麼(codex B1-5 逐字):簽 v:1 ⇒ 下一個請求被自己拒 ⇒ 回登入頁
  // ⇒ 再簽 v:1 ⇒ 再被拒 ⇒ **無限迴圈**,而**每一次登入在 log 上都是成功的**。
  //
  // 🔴 **這是機制不是提醒,理由是它的載體**:
  //    誰   = 旗標開了之後【第一個登入的管理員】—— 不是「記得順序的人」,是任何一個人
  //    何時 = 那一次登入的當下
  //    載體 = 本檔。**每一次登入都會經過這裡。**
  //
  // ⚠️🔴 **不要讀成「裝了就安全了」**(主視窗點名要保留這一句):
  //    它**不會**讓大家登得進去 —— 旗標開著而沒有真身分,**本來就該拒**(那是旗標的意思)。
  //    它改的是**失敗的形狀**:從「安靜的無限迴圈」變成「一次明確失敗 + 一列查得到的稽核紀錄」。
  //    **失敗沒有被消除,只是變得看得見。**
  //
  // ✅ **可逆性**(主視窗核過):誤開 ⇒ 全員被拒 ⇒ 拿掉 env ⇒ `requireRealIdentity()` 回 false
  //    ⇒ 不進本分支 ⇒ 恢復。**這個 fail-closed 不會把人鎖在門外。**
  if (requireRealIdentity() && !result.sub) {
    await recordSsoLogin(
      'fail',
      { requestId, reason: 'flag-on-without-upstream-sub' },
      req.headers,
    );
    // 沿用既有那條「顯式 500、不導 /start」的路(見下方 `!token` 那格的理由:導了就是無限迴圈)。
    return configError();
  }

  // ── B5-b′ 片一:**簽票之前先問一句「他還在職嗎」** ──────────────────────────
  //
  // 🔴 **這是本片唯一在補的那個洞**:在這一行之前,**全 repo 沒有任何一處在簽票時查 `is_active`**
  //    (2026-08-26 量:`grep -nE "resolveStaff|listActiveStaff|is_active" <本檔>` ⇒ 三處全是註解/log;
  //     負對照 同檔 `grep -c buildAdminSession` ⇒ 2 ⇒ 尺是活的)。
  //    ⇒ 一個已停用的員工,只要報價單那側還讓他登入,就能一直換到新的 admin 票。
  //
  // 🔴🔴 **為什麼查在【這裡】而不是每個請求都查**(Sean 2026-08-26 拍板,逐字「只有登入那一刻問一次」):
  //    每個請求都查 ⇒ `staff` 表**單獨**故障就會讓**整個後台停擺**,而訂單客戶資料其實還好好的
  //    ⇒ codex R3 逐字:「有些故障下,它確實比【沒有這道閘】更糟」。詳 `#935`。
  //    ⚠️ **而這不是把依賴消掉,是把它搬家**:DB 掛掉 ⇒ 沒有人能換新票
  //       ⇒ 大家在自己的票過期時**陸續**被擋。**擋的位置變了,不是消失了。**
  //       📌 而**漸進式的全站故障比瞬間的更難認出來** —— 值班看到的是「陸陸續續有人說進不去」。
  //
  // ⏳ ~~**本片刻意【不動】票的有效期**(仍是 `ADMIN_SESSION_MAX_AGE_SEC` 12h)。~~
  //    ~~所以今天的效果是「停用之後,最多 12 小時內下次換票時進不去」,不是「立刻」。~~
  //    ⛔ **上面兩行已被片二推翻**(2026-08-26 `5276411e`;codex 補審 nit 抓到它還留著)——
  //       留痕不刪,因為值班會拿這一段估「停用多久才生效」,而**舊字面算出來的數字大 48 倍**。
  // ✅ **現況**:`ADMIN_SESSION_MAX_AGE_SEC` = **15 分鐘**
  //    ⇒ 停用之後,具名員工**最多 15 分鐘**內下一次換票時被擋。
  //    ⛔ ~~「靜默續期【每次都重查一次】`is_active`」~~ —— 這句話**寫上去二十分鐘就被抓到是錯的**
  //       (第三把審查 N3)。續期端點有一格「剩餘 > 5 分鐘 ⇒ 直接回、**不碰 DB**」的早退
  //       ⇒ 真正查 DB 的是**每張票快到期的那一次**,不是每一次巡邏。
  //       📌 結論(≤15 分鐘生效)沒變,**機制寫錯了** —— 而值班拿去估的是機制。
  //    ⚠️ 而這只涵蓋 `v:2` 具名票 —— `v:1` / `fallback` 續期時**不查名單**
  //       ⇒ 那三種的天花板是 `SSO_CHAIN_MAX_AGE_SEC`(12h),不是 15 分鐘。
  const gate = planStaffGate(result.sub);
  if (gate.kind === 'require-active-staff') {
    const staff = await resolveActiveStaffById(gate.staffId);
    if (staff === null) {
      // 🔴 三種世界在這裡回**同一個 null**:查無此人 / 已停用 / **DB 讀不到**(`#933`)。
      //    本片刻意接受這個歧義(Sean 2026-08-25 拍板:先關破口、DB 韌性另開一片),
      //    ⇒ 所以下面那頁**兩種可能都講**,不能只講一種。
      await recordSsoLogin('fail', { requestId, reason: 'staff-not-active' }, req.headers);
      return inactiveStaffResponse(requestId);
    }
  }

  // 📌 **本段(B5-b′ 的閘)刻意排在 B5-a 那段註解【之前】**(code-reviewer nit C5):
  //    B5-a 那段的結尾逐字是「**所以這一行的位置是契約的一部分,不是風格**」,
  //    而它指的是下面那行 `buildAdminSession(…, result.sub)`。
  //    ⚠️ 上一版我把 30 行新註解 + 整段閘插在**它們中間** ⇒ 那句話讀起來變成在描述我的閘。
  //    📌 **註解要跟著它解釋的那段碼**(鐵則 6 同精神)—— 插隊會靜默改掉一句話的主詞。
  // 🔴 **B5-a 件 2:上游送來的身分【接進票裡】。** 這一行之前,`result.sub` 走到這裡就沒了。
  //    · 上游沒送(今天的每一次登入)⇒ `sub` 是 `undefined` ⇒ 簽出 `v:1`,行為與之前逐字相同
  //    · 上游送了                    ⇒ 簽出 `v:2`,而 `sub` 一定在裡面(型別逼的)
  //
  // 🔴🔴 **為什麼放在【這裡】而不是在 `recordSsoLogin` 內部補**(`identity-drop-trace.ts` 檔頭逐字):
  //    那道 trace「會自己退場」靠的前提是 **`sub` 被加進【呼叫端傳給它的那個物件本身】**。
  //    若改成在下游內部補,trace 看到的 carrier 永遠不帶 ⇒ **每次登入都印、永不退場**
  //    ⇒ 它就變成它自己要防的那種噪音。**所以這一行的位置是契約的一部分,不是風格。**
  const session = buildAdminSession(result.amr, result.auth_time, result.sub);
  const token = await signSession(session);
  if (!token) {
    // 🔴 簽不出 = ADMIN_SESSION_SECRET 缺(設定缺漏)→ 顯式 500,不導 /start(否則未登入→/start→…→再簽不出=無限迴圈,Fable REQ4)。
    await recordSsoLogin('fail', { requestId, reason: 'sign-failed-config' }, req.headers);
    return configError();
  }

  const res = NextResponse.redirect(new URL(safeReturnTo(decoded.r), req.url), 303);
  res.cookies.set(ADMIN_SESS_COOKIE, token, adminSessionCookieOptions());
  res.cookies.set(SSO_STATE_COOKIE, '', clearStateCookieOptions());
  res.headers.set('Referrer-Policy', 'no-referrer');
  res.headers.set('Cache-Control', 'no-store');
  // 🔴 **B5-a 接線的第二本帳**:身分同時進 session 票**與**登入事件表。
  //    ⚠️ 這裡送的是 `result.sub`(上游送來、`sanitizeSub` 清洗過的那個),
  //       **不是** `session` 裡那份 —— 兩者同源,而送前者少一層「我以為它被帶進去了」。
  //    ⚠️ `staff_id` 只在 `kind === 'user'` 時存在(型別逼的),其餘兩態送 undefined
  //       ⇒ 對齊 DB 的配對 CHECK(`20260824030000`:非 user 不得帶 slug)。
  const loginEvent = {
    requestId,
    amr: result.amr,
    ...(result.sub
      ? {
          actorKind: result.sub.kind,
          ...(result.sub.kind === 'user' ? { actorStaffId: result.sub.staff_id } : {}),
        }
      : {}),
  };
  // 🔴 **中間契約(2026-08-23,主視窗裁定)**:B5-a 之前我們【還沒接】`sub`,
  //    而「還沒接」不可以是**安靜**的 —— 上游一開始送,這一行就是唯一的**痕**。
  //    🔴 **是「痕」不是「訊號」(R3 更正)**:全 repo 沒有任何告警接線在讀 console
  //       ⇒ 加了它**仍然沒有任何東西會響**。它買到的是【出事之後查得到】,不是【有人會被通知】。
  //    ⚠️ 既有那兩顆 fuse 看的是**原始碼結構** ⇒ 它們只在「我們做到一半」時響,
  //       對「我們沒開始而上游已經送」這個世界**恆綠**(見 `lib/sso/identity-drop-trace.ts` 檔頭)。
  //
  // 🔴 **只掛 session 這一本(codex must-fix 4)**:route 看得到的 `loginEvent` 是**傳進去的參數**,
  //    **不是 `login-event.ts` 實際 insert 的那個物件**。掛它會出現「**提早退場**」——
  //    B5-a 只把 `sub` 加進參數 ⇒ 本 trace 安靜下來,而 DB 仍然沒有那一欄、身分照樣掉。
  //    ⚠️ **而「安靜」會被讀成「已經好了」,那比每次都印更危險。**
  //    ⇒ ~~DB 那一半由 `login-event-identity-drop-fuse.test.ts` 的原始碼守門接~~
  //       **2026-08-24 更新**:那支已 **2026-08-24 依它自己的退場條款刪除**(原文 `git show 952c0c42:apps/admin/src/lib/sso/login-event-identity-drop-fuse.test.ts`,189 行)(它守的兩個訊號現在都成立)。
  //       DB 那一半現在由 `lib/sso/login-event.test.ts` 的**行為測試**接;
  //       而空窗(migration 未 apply)由 `login-event.ts` 的**會出聲的退回路徑**接。
  //    ✅ 而「上游送了、兩邊都沒接」這個**今天的**世界仍然叫得出來:session 這本也沒有 `sub`。
  //
  // ✅ **它會自己退場,而前提寫在 `identity-drop-trace.ts` 檔頭** —— 那裡也寫了它不成立的那條路。
  let identityDrop: string | null = null;
  try {
    identityDrop = identityDropTrace(result.sub, [
      { name: 'session cookie', payload: session, identityKey: 'sub' },
    ]);
  } catch {
    // 守門自己壞掉 ⇒ 吞掉,登入照常完成(同 login-event.ts 的 best-effort 紀律)。
    identityDrop = null;
  }
  if (identityDrop) {
    // 🔴 **只送一個參數(codex must-fix 5)**:第二個參數一樣會進 Vercel log,
    //    而 PII 那道守門只看回傳字串 ⇒ `console.warn(msg, result.sub)` 會**兩邊照綠而洩漏 staff_id**。
    //    ⇒ 這裡**永遠只送 `identityDrop` 一個字串**,而測試釘住呼叫的參數個數。
    // 🔴 **走 `warn` 不走 `error`(codex nit)**:`security-log.ts` 逐字「成功=info、失敗=warn
    //    (值班撈 warn 即異常登入候選)」—— 一次**成功登入但身分掉了**正是那個分類。
    //    而 `error` 會污染 error 篩選、Log Drain 全量轉送時多花錢,**卻不會觸發 Vercel 的 5xx 告警**
    //    ⇒ 它買不到告警,只買到雜訊。
    console.warn(identityDrop);
  }
  await recordSsoLogin('success', loginEvent, req.headers);
  return res;
}
