// ⚠️⚠️ **2026-08-27:本檔【在正式站上跑的那一版】與你眼前這一版不一樣。**
//    `5276411e`(片二)欠兩場審查就被推上 `origin/dev`(= pcm-admin 的 production 分支),
//    而補審抓到 **15 條 must-fix**。修在 `bc61afe6`,**而那一顆還沒推**。
//    🔴 最會咬人的一條:staff 表抖一次 ⇒ 每個開著的分頁**永久**停止續期 ⇒ 15 分鐘內全體被踢。
//    🔴 **這一段話會過期, 而過期時【沒有任何訊號】** —— 所以不要相信它, 自己跑這一行:
//       `git merge-base --is-ancestor bc61afe6 origin/dev && echo 已推 || echo 未推`
//       印「已推」⇒ 本段已完成任務, **請連同這幾行一起刪掉**。
//    📌 我今晚修的毛病裡有一條就是「一段被推翻的註解還留在檔案裡」(`callback/route.ts` 那段
//      『停用後最多 12 小時』, 舊字面算出來的數字大 48 倍)⇒ 本段自帶判別法, 是為了不變成第二條。

// M-4a M0-S3 admin session 簽 / 驗 —— SSO 收端成功兌換後,admin 發給瀏覽器的「登入票證」。
//
// ★runtime-neutral 硬規則★(對齊報價單 lib/session.ts 已驗模式):只用 globalThis.crypto.subtle,
//   絕不 import 'node:crypto' 或 '@supabase/supabase-js'。proxy.ts 的 runtime 只是註解宣稱、未證實
//   (盲點掃描指名),用 subtle 則 edge / node 皆可驗,規避該不確定性。也★不在 top-level await★。
//
// Cookie 值 = base64url(payloadJSON) + '.' + base64url(HMAC_SHA256(payloadJSON, ADMIN_SESSION_SECRET))。
// 🔴 過期釘死在 payload.exp、verifySession 檢 exp(Fable MF1);cookie Max-Age 只是 UX,cookie 值一旦外洩,
//    唯有 payload.exp 到期或換 ADMIN_SESSION_SECRET 才失效(stateless、phase1 無 server 端撤銷,見殘餘風險)。
//
// ⛔ ~~具名身分不在此 payload:報價單=共用密碼登入,SSO 只帶認證(amr/auth_time)、無 per-user 身分。
//   「操作者是誰」仍走 lib/session/actor.ts 的 picker(到 M-4b 真帳號)。SSO=認證,不是身分綁定。~~
// **2026-08-24 `B5-a` 起,這段不再成立**:payload 是 `v` 判別的 union,而 `v:2` **必帶 `sub`**。
//   · 上游沒送身分(今天的每一次登入)⇒ 仍簽 `v:1`,而 `v:1` 裡確實沒有身分 ⇒ 上面那段對 `v:1` 仍為真
//   · 上游送了 ⇒ `v:2`,身分在票上,而 `actor.ts` 只認它
// 🔴 **兩軸仍然不要混**(B3 §3.12):`sub.kind`=【這是誰】,`amr`=【他怎麼證明的】。
//   SSO 現在同時帶認證與身分,而**它們仍是兩個欄、兩個閘**,不得互相代用。
//
// 相對 import 是歷史遺留(#606 前 root vitest alias 只指 storefront、lib 檔被迫走相對路徑);
// #606 起 admin project 有自己的 @ alias(proxy.test.ts 已用 @/ import 本檔),新 code 可直接用 @/。
// 既有相對路徑的整批清理=#612,不在單一 slice 裡混改。
import { b64urlFromBytes, b64urlToBytes } from '../base64url';

/** 報價單 exchange 回傳並經 admin 端自驗過的 amr 值(對齊報價單 lib/session.ts SessionAmr)。 */
export type AdminSessionAmr = 'pwd' | 'totp' | 'bootstrap' | 'recovery';

/**
 * 報價單 exchange 回傳的【身分】(M-4b E8-B B5;規格 docs/specs/2026-08-17-m4b-e8b-b5-spec.md)。
 *
 * 🔴 兩軸不要混(B3 spec §3.12):
 *   sub.kind = 【這是誰】       ⇒ 身分/授權閘唯一的鍵
 *   amr      = 【他怎麼證明的】 ⇒ 認證強度閘,不得拿來判身分
 *   —— 而 'bootstrap' 這個【字面】兩邊都有,它們是【不同軸的值】,會不一致且那不是 bug
 *      (B3 §3.10:2FA 綁定完成後 amr 升級、sub 不動)。
 *
 * 🔴 沒有「沒有身分的 session」—— 備援與首次建置都是【一種身分】(plan §7-Q1=A)。
 *   'fallback'  共用密碼備援登入
 *   'bootstrap' 首次建置(SETUP_SECRET);🔴 它【沒有】staff_id,而它與 fallback 不同:
 *               fallback 一律不得寫入;bootstrap 僅限 2FA 綁定端點白名單(B5 §寫入閘)
 */
export type AdminSessionSub =
  | { kind: 'user'; staff_id: string }
  | { kind: 'fallback' }
  | { kind: 'bootstrap' };

export interface AdminSessionCommon {
  /**
   * 128-bit hex。§3.1「旋轉 session id」(stateless 下為衛生,非撤銷)。
   *
   * ⛔ ~~每次簽發新產~~ —— 2026-08-27 訂正(第三把審查 N1)。
   * 🔴 **原句在片二之前是對的,因為那時「簽發」= 一次登入**。片二加了靜默續期
   *    ⇒ 簽發變成**每十幾分鐘一次** ⇒ 這個欄位就從「一次連線」變成「一個時間片」。
   *    而它被寫進稽核 log(`orders/order-actions.ts:79`、`customers/wallet-actions.ts:46`、
   *    `customers/tier-actions.ts:48`、`orders/amount-actions.ts:95`、`shipping/shipment-actions.ts:98`)
   *    ⇒ **「這幾筆是不是同一個人同一次連線做的」會答不出來** —— 而那一天正是最需要它的那天。
   * ✅ 現行:**續期沿用舊 `sid`**(`renew/route.ts` 傳 `opts.sid`),只有真的登入才新產。
   *    📌 一個欄位的語意可以被【別的地方的改動】換掉,而它自己一個字都沒動。
   */
  sid: string;
  iat: number; // unix sec:admin 簽發時刻
  /**
   * **這條票鏈的起點**(片二新增)—— 續期時**原封不動抄過去**,`iat` 每次重簽都會變而它不會。
   *
   * 🔴 **為什麼不能用 `auth_time` 當這個錨點**:`auth_time` 的語意是報價單那側的 `session.iat`,
   *    而本檔 `:51` 逐字記著它「**隨 sliding refresh 更新的時刻,非不變登入時刻**」⇒ 它會動。
   * 🔴 **為什麼是選填**:片一已經簽出去的 `v:2` 票沒有這個欄。
   *    寫成必填 ⇒ `isPayload` 會拒掉它們 ⇒ **部署當下全員被登出**。
   *    ⇒ 缺這個欄時,**用該票自己的 `iat` 當起點**(保守:只會讓上限更早到,不會更晚)。
   */
  sso_at?: number;
  exp: number; // unix sec:iat + TTL;🔴 verifySession 以此欄判過期(非靠 cookie 屬性)
  amr: AdminSessionAmr[]; // 報價單傳來、admin 已白名單過濾
  // 報價單 session.iat。⚠️ 語意=隨 sliding refresh 更新的時刻,非不變登入時刻(報價單端自述)。
  //   step-up「近期驗證過」比對前置=報價單側改存不變值,否則形同虛設;本 slice 只忠實存放。
  auth_time: number;
}

/** 舊票:**沒有身分**。報價單 B3/B4 上線前簽出的每一顆,以及今天的每一次登入。 */
export interface AdminSessionPayloadV1 extends AdminSessionCommon {
  v: 1;
}

/**
 * 新票:**帶身分**。
 *
 * 🔴 **`sub` 是【必填】,不得寫成 `sub?:`**(B5-a §B5-3;理由逐字引 B3 spec `:66-69`):
 *    「型別上不存在『沒有 `sub` 的 v:2 session』…備援路徑不是『沒有身分』,是一種明確的身分」。
 *    寫成選填 ⇒ 那個「不存在」就沒有了。
 */
export interface AdminSessionPayloadV2 extends AdminSessionCommon {
  v: 2;
  sub: AdminSessionSub;
}

/**
 * 🔴 **為什麼是 union 而不是 `v: 1 | 2` 加一個選填欄**(§B5-3):
 *    union 之下,「拿到一個 `v:2` 卻讀不到 `sub`」**在型別上構造不出來**;
 *    選填欄則要靠每一個呼叫端自己記得判。
 *    📎 **讓錯誤形狀不存在,勝過讓每個人記得檢查它。**
 */
export type AdminSessionPayload = AdminSessionPayloadV1 | AdminSessionPayloadV2;

export const IS_PROD = process.env.NODE_ENV === 'production';

/**
 * 📖 **要開這個旗標、或要 revert 這一包之前,先讀** `docs/runbooks/2026-08-24-b5a-identity-rollout.md`
 *    (三件東西的順序 / 唯一那道機制 / revert 要配換 secret / 兩個盲區)。
 *
 * `ADMIN_REQUIRE_REAL_IDENTITY` —— **B5 那條線的總開關**(§B5-3 (3) / §B5-5 第 2·3 層)。
 *
 * ```
 * 關(**這份 code 的預設值**,即 env 沒設時):v:1 與 v:2 都收;actor.ts 拿不到 v:2 時【維持現行行為】= 讀那顆自選 cookie
 *   🔴 **「預設」講的是 code,不是正式站** —— ~~原句寫「關(預設,今天)」~~ 而那個「今天」
 *   會被讀成「線上現在是關的」。正式站 2026-08-25 起是 `=1`(見 `authorize.ts` 錨 `正式站 2026-08-25 起`)。
 * 開:            v:1 一律拒;    actor.ts 拿不到 v:2 時回 null,【不得回退去讀 cookie】
 * ```
 * 🔴🔴 **2026-08-24 更正(codex B1-2)—— 這個旗標【不是】身分路徑的總開關。**
 *    ~~原句「預設關 = 這一整片是暗著出的」~~ **把功勞算錯了**。真值表:
 * ```
 * 關 + v:1  ⇒ 讀那顆自選 cookie(今天)      開 + v:1  ⇒ 拒(null)
 * 關 + v:2  ⇒ 🔴 用【簽章過的 sub】          開 + v:2  ⇒ 用簽章過的 sub
 *              ↑ 旗標關著, 新身分路徑照樣生效
 * ```
 *    ⇒ **旗標只管「拿不到 v:2 時怎麼辦」,不管「拿到 v:2 時要不要用它」。**
 *    ⇒ ⛔ ~~🔴 **這一片今天是暗的,靠的是【上游還沒送 `sub`】,不是靠這個旗標。**~~
 *       **2026-08-29 訂正:上游【已經在送】了**(2026-08-25 Sean 登出再登入成功
 *       ⇒ 通過 `sso/callback/route.ts:156` 的 `requireRealIdentity() && !result.sub`)
 *       ⇒ **這一片今天是【亮的】,不是暗的。** 原句留著:它記著這一片出廠時的狀態。
 *       上游一開始送,身分路徑就生效 —— **旗標關著也一樣**(這半句仍然成立)。
 *       ⚠️ 所以它**不是 kill switch**:出事時把旗標關掉**不會**讓身分路徑停下來。
 *
 * 🔴🔴 **rollback 的紙上約束 —— 讀者是【做 revert 的人】,不是翻旗標的人。**
 *    ⚠️ **2026-08-24 主視窗更正了它自己問這題的方式,而那個更正是承重的**:
 *    ```
 *    翻旗標的人   = Sean(Vercel dashboard)
 *    做 revert 的人 = 我們(主視窗 / 施工窗)
 *    而這條約束講的是【revert 的時候要注意什麼】⇒ 讀者是我們
 *    ```
 *    ⇒ 🔴 **本段是【副本】。主載體 = 那一包的 commit body**(要 revert 一顆 commit,
 *      動作的起點就是找到它 ⇒ `git log` / `git show` ⇒ 讀得到 body)。
 *    ⚠️ 而它的天花板照實寫:`git revert <sha>` 產生的訊息**預設只帶 subject、不帶 body**
 *      ⇒ 它不是「自動塞到眼前」,是「找它的過程中會經過」。**仍然是紙上約束。**
 *
 *    ⚠️ **2026-08-24 更正(codex B1-4):~~原句說「先把 env 拿掉就好」~~ 指錯了主要風險。**
 *    真正卡住的**不是 env**,是**已經簽出去、還沒過期的 `v:2` 票**:
 *    ```
 *    碼 revert 回去 ⇒ 舊碼的守衛是 `v === 1` ⇒ 那些還沒過期的 v:2 票【全部被拒】
 *    ⇒ 先拿掉 env 也救不了它們 —— 它們已經在使用者的瀏覽器裡了
 *    ⇒ 要嘛等它們自然過期, 要嘛換 ADMIN_SESSION_SECRET 讓所有票一起失效(全員重登)
 *    ```
 *    (旗標還開著 + 碼退回去 ⇒ 連 v:1 也被拒 ⇒ 那是**第二層**災難,仍然要先拿掉 env。)
 *
 * ⚠️🔴 **沒有任何機制在執行這一條。它靠 revert 的人讀到這段字。**
 *    **已知的失敗方式**:有人用 `git revert` 而**沒有先 `git show` 那顆 commit**。
 *    📌 為什麼要把這句寫出來,而不是寫成「已在 commit body 記載」就收工:
 *       **造一個看起來像機制的東西,會讓下一個人以為它被守住了**,而真的那個洞還在。
 *       一段誠實的「這裡沒有守門」比一段讀起來很安心的說明有用。
 *    📌 唯一一個**會被強制經過**的時點 = **B7(開旗標那一片)的 plan 必須先答「退場路徑」** ——
 *       而**那也不是機制,是流程**:它靠「B7 那片會照規矩提 plan」。
 *
 * 形狀抄 `lib/audit/audit-ui-flag.ts:29-30`(`=== '1'`,不收 `'true'`/`'yes'`):
 * **認得出來才算開**,而不是「不是空的就算開」。
 */
export function requireRealIdentity(): boolean {
  return process.env.ADMIN_REQUIRE_REAL_IDENTITY === '1';
}
// 🔴 secret 最小長度(<32 視為未設、fail-closed):弱 ADMIN_SESSION_SECRET → 離線暴破 HMAC → 偽造任意 admin session(Fable/Codex MF5)。
const MIN_SECRET_LEN = 32;
const strongSecret = (s: string | undefined): string | null => (s && s.length >= MIN_SECRET_LEN ? s : null);
// prod: __Host- 前綴要求 secure + path=/ + 無 Domain;dev(http)不能用 __Host-、且不加 Secure(localhost 全瀏覽器可收)。
export const ADMIN_SESS_COOKIE = IS_PROD ? '__Host-pcm_admin_sess' : 'pcm_admin_sess_dev';
/**
 * 一張票活多久。
 *
 * 🔴 **2026-08-26 片二:12h ⇒ 15 分鐘**(Sean `Q-B5b-2 = 乙`,逐字
 * 「只有登入那一刻問一次, 給他一張 15 分鐘就過期的通行證」)。
 * ⛔ ~~`60 * 60 * 12` // 12h(後台、比報價單 24h 稍緊)~~ —— 留痕,因為下一個人會問為什麼變這麼短。
 *
 * **它縮短的是【多久重新確認一次「他還在職」】,不是曝險上限** ——
 * 上限由 `SSO_CHAIN_MAX_AGE_SEC` 管,而那一格仍是 12 小時(見下)。
 * 🔴 **而這一格【必須與靜默續期一起出】**:只縮短不續期 ⇒ 每人每天被打斷約 32 次
 *    (`8h ÷ 15min`)⇒ 那是做一半。plan `docs/specs/2026-08-26-m4b-e8b-b5b-piece2-plan.md` §0。
 */
export const ADMIN_SESSION_MAX_AGE_SEC = 60 * 15; // 15 分鐘

/**
 * **票剩多少秒以內才真的去續**(片二補審 M1)。
 *
 * 🔴 **它住在 server,而不是前端** —— 前端那支原本有一個同名常數,而它
 *    只被塞進一個**沒有人讀的 header**(`x-renew-remaining-hint`)⇒ 那是死碼,
 *    而註解宣稱的行為(「剩 5 分鐘內才續」)在 diff 裡不存在:實際是**每 60 秒無條件續一次**。
 * 📌 判別句:**一個常數被【用來計算】與被【印出來給人看】是兩件事,而它們在 diff 上長得一樣。**
 *
 * ⚠️ 它必須**大於**前端的巡邏間隔(`CHECK_INTERVAL_MS`,60 秒),否則會有一整個巡邏週期
 *    落在窗口外面 ⇒ 票在兩次巡邏之間過期,而我們從來沒試過續它。
 */
export const ADMIN_SESSION_RENEW_WHEN_REMAINING_SEC = 300; // 5 分鐘

/**
 * **一條票鏈最多能自己續多久**,超過就要重走一次完整 SSO。
 *
 * 🔴 **為什麼一定要有**(Sean 2026-08-26 拍甲):片二讓 admin **自己重簽**票而不經報價單
 *    ⇒ **報價單那側永遠不會再驗證他** ⇒ 沒有天花板的話,**一張被偷的票可以永遠續下去**。
 * 📌 選 12 小時的理由:**最壞情況與片二之前【完全一樣】**(那時票就是 12h)
 *    ⇒ **本片不引入新的曝險上限,只是把中間的檢查變密。**
 *
 * 🔴 **而上面那句話在 2026-08-27 之前是【假的】**(codex 補審 MF1):
 *    這個常數只擋「還能不能【再簽】」,沒有擋「簽出來的那張活到什麼時候」
 *    ⇒ 鏈齡 11:59:59 續一發 ⇒ 新票活到 **12:14:59** ⇒ 多了近 15 分鐘。
 *    ✅ 已補:`api/session/renew/route.ts` 把新票的 `maxAgeSec` 夾到剩餘鏈長
 *    ⇒ 那句話**現在**才是真的,守門 `[R9]`。
 *    📌 判別句:**一個叫「絕對上限」的常數,與一段真的把東西夾住的碼,是兩件事。**
 *
 * ⚠️ **它管不到【部署前就簽出去的票】**(codex 補審 MF5,誠實寫下來):
 *    票是 stateless 的 ⇒ 片二部署前簽出的 12h 票,`exp` 就寫在票上,照樣活滿 12 小時。
 *    ⇒ 「TTL 已經是 15 分鐘」這句話對**新簽的票**成立,對**在飛的票**要等一輪才成立。
 *    ⇒ 這是刻意的(寫成必填 / 硬拒舊票 = 部署當下全員被登出),不是漏掉。
 */
export const SSO_CHAIN_MAX_AGE_SEC = 60 * 60 * 12; // 12h

/** login / SSO 收端發 cookie 的統一選項。SameSite=Lax:callback 後 303 為同源;Lax 足夠防跨站 CSRF、
 *  且跨站進站(從報價單點連結)不會誤判未登入。 */
export function adminSessionCookieOptions(maxAgeSec: number = ADMIN_SESSION_MAX_AGE_SEC) {
  return {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSec,
  };
}

/**
 * 這個部署認為自己在哪個環境 —— **「票綁環境」那一片的金鑰材料的一半。**
 *
 * 🔴🔴 **本片(片 0b)【只把它算出來、放進一個 response header】,【還沒有】接進金鑰。**
 *    理由是 W6 審查抓到的一格,而它會全員鎖死:
 *    ```
 *    片 0 那支探針宣告 runtime='nodejs' 且是 page ⇒ 它量到的是【route / Node runtime】
 *    而綁定會跑在 getKey() ← verifySession ← proxy.ts:40 ⇒ 那是【proxy runtime】
 *    而本檔 :4 逐字：「proxy.ts 的 runtime 只是註解宣稱、未證實」；proxy.ts 也沒有 export const runtime
 *    ⇒ 若 proxy 讀不到 VERCEL_ENV：每個請求被導去 /start，而 callback(Node runtime)簽得出來
 *      ⇒ 發了 cookie ⇒ 下一發又被 proxy 拒 ⇒ 🔴 無限迴圈，全員(含 Sean)進不去
 *    🔴 而 callback 的 REQ4 防線【防不到這一種】：它防的是「簽不出」，
 *       而這裡簽得出來，壞的是【驗】。
 *    ```
 *    ⇒ **⇒ 先量那個 runtime,量到了再接。** 這正是片 0 自己立的理由 ——
 *    **承重的未知只是換了一個 runtime,它還在。**
 *
 * 🔴 **白名單不是黑名單**(codex 關卡2 M1/M2):認得出來才用,認不出來回 `null`。
 *    用「不是壞的那個值」判會漏掉沒想到的壞值;用「就是好的那個值」判才封閉。
 */
export function resolveEnvTag(): string | null {
  const fromVercel = process.env.VERCEL_ENV;
  // 🔴 有值而【不在白名單】⇒ 立刻 null,不得往下掉進 NODE_ENV 啟發式(W6 nit②):
  //    Vercel 的 Custom Environments 是真實功能 ⇒ 'staging' 這種值真的可能出現,
  //    而掉下去之後它會被判成 'local'。**今天不可觸發,靠的是外部平台的性質,不是我們的守門。**
  if (fromVercel !== undefined) {
    return KNOWN_VERCEL_ENVS.has(fromVercel) ? fromVercel : null;
  }
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv !== undefined && KNOWN_LOCAL_NODE_ENVS.has(nodeEnv)) return 'local';
  return null; // 認不出這是哪個環境 ⇒ fail-closed
}

/** Vercel 系統變數的已知值白名單。 */
const KNOWN_VERCEL_ENVS = new Set(['production', 'preview', 'development']);
/** 只有這兩個 `NODE_ENV` 算「明確的非正式環境」。 */
const KNOWN_LOCAL_NODE_ENVS = new Set(['development', 'test']);

// ── HMAC key:依【完整材料】(secret + 環境)快取。缺任一半 → null,fail-closed 絕不 throw。──
//
// 🔴🔴 **環境進的是【金鑰材料】,不是 payload**(M-4b「票綁環境」;Sean 2026-08-19 `q3=甲`)。
//   ⇒ 跨環境的票在**簽章那一關就死** —— fail-closed 是**構造上的**,不必在 `isPayload()` 加分支;
//   ⇒ 而**零 payload 改動 ⇒ `v` 不升** ⇒ B3/B5 的版本軸一個字都不動。
//
// 🔴 **快取鍵必須是【完整材料】,不能只比對 secret**:同一個 process 內 env 變動時,
//   只比對 secret 會回**舊 key** ⇒ 翻了環境而簽章沒變。
//   ⚠️ 而那個 bug 的症狀**看起來像測試環境問題**,最順手的修法(重載模組)會讓 suite 變綠
//   **而這裡一行沒改** —— 那是「動驗證本身」的立即停止訊號。
//
// 🔴 **rollback 這幾行的人請讀這一句**:revert 之後金鑰材料變回單獨的 secret
//   ⇒ **那些在本片上線前於 preview 簽出、還沒過期的票會【復活】**(上界 = `ADMIN_SESSION_MAX_AGE_SEC` 12h)。
//   **⇒ rollback 的同一個動作裡必須【同時換 `ADMIN_SESSION_SECRET`】。**
//   ⚠️ 而**沒有任何機制在執行這條** —— `git revert` 不會問你,換 secret 是 Vercel 上的動作。
//   立案 `#666`。**這是紙上約束,不假裝它被守住了。**
let cachedMaterial: string | null | undefined;
let cachedKey: Promise<CryptoKey | null> | null = null;
function getKey(): Promise<CryptoKey | null> {
  const secret = strongSecret(process.env.ADMIN_SESSION_SECRET);
  const envTag = resolveEnvTag();
  // 🔴 長度前綴去歧義(codex 關卡2 nit):`${secret}|${envTag}` 會讓
  //    (S, 'a|b') 與 (S+'|a', 'b') 組出同一個字串。今天不可觸發,而修法只要一個長度前綴。
  const material =
    secret === null || envTag === null
      ? null
      : `v1:${secret.length}:${secret}:${envTag.length}:${envTag}`;
  if (material !== cachedMaterial || !cachedKey) {
    cachedMaterial = material;
    cachedKey = (async () => {
      if (!material) return null;
      return crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(material),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign', 'verify'],
      );
    })().catch(() => null);
    // 🔴 `.catch(() => null)` 是刻意的:fail-closed 絕不 throw。
    // ⚠️ 代價(W6 審查標的):**同一個 material 之下,那顆 null 會被永久快取** ——
    //    material 在 production 是穩定的 ⇒ 若 `importKey` 真的失敗一次,
    //    打到那台 instance 的人會全部被拒。
    //    (對非空 key 失敗實務上近乎不可能 —— **而近乎不可能不是零**。)
    // ✅ **而它現在看得見**:那條路回的正是 `no_secret` / `no_env`,
    //    而本片把那兩種做成【告警】⇒ **這個殘餘風險是被告警接住的,不是被忽略的。**
  }
  return cachedKey;
}

/**
 * ADMIN_SESSION_SECRET 是否已設。
 *
 * ⚠️🔴 **這段說明【現在是假的】,而它掛在一支 session 安全模組上**(W6 審查指出,2026-08-19):
 *    ⛔ ~~callback 用來把「簽不出」判為設定缺漏 500~~ —— **callback 沒有用它**
 *    (`callback/route.ts` 那個 branch 判的是 `!token`,不是呼叫本函式)。
 *    **本函式目前【零非測試呼叫端】= 死 export + 一句主動為假的說明。**
 *
 * 🔴 **刻意【不在這一片清掉】**:本片動的是 auth(鐵則 12②),而 12② 的 diff 要小 ——
 *    順手清無關的東西會**擴大審查面**,而審查面一大,reviewer 的注意力就被稀釋。
 *    ⇒ **那是真成本,不是潔癖。**
 * ⇒ **而它不能就這樣消失**:本註解就是它的落點。要清它是**另一片**。
 *    📌 判別句:一句【沒有人指著它的已知假話】,正是今天所有過期實例的共同起點。
 */
export function adminSessionSecretConfigured(): boolean {
  return strongSecret(process.env.ADMIN_SESSION_SECRET) !== null;
}

/** 128-bit hex sid。 */
export function newSid(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * 組 payload(每次新 sid = 旋轉;iat=now、exp=now+TTL)。
 *
 * 🔴 **`sub` 有沒有帶,決定簽出來的是 `v:1` 還是 `v:2`** —— 版本不是呼叫端自己挑的。
 *    · 上游沒送身分(今天的每一次登入)⇒ `v:1`,**與本片之前逐字相同**
 *    · 上游送了身分              ⇒ `v:2`,而 `sub` 一定在裡面(型別逼的)
 * ⚠️ **不要加一個 `version` 參數** —— 那會讓「v:2 而沒有 sub」重新變得構造得出來。
 */
/**
 * 🔴🔴 **簽章裡【只剩一個 `number`】,而那是刻意的。**
 *
 * 歷史(這一格被打開兩次):
 * ```
 * v1  (amr, authTime, maxAgeSec, sub)   ⇒ authTime 與 maxAgeSec 相鄰且同為 number
 *                                          ⇒ 對調照樣編得過(codex B1-3)
 * v2  (amr, authTime, sub?, maxAgeSec?) ⇒ 🔴 codex R2-4:**兩個 number 還在同一個簽章裡** ——
 *                                          `(amr, maxAge, undefined, authTime)` 仍可對調且 typecheck 全綠
 *                                          ⇒ 我只是把風險【縮小】, 沒有【消除】
 * v3  (amr, authTime, sub?, opts?)      ⇒ 本版:`maxAgeSec` 收進具名物件
 *                                          ⇒ **對調需要打出 `{ maxAgeSec: … }` 這個鍵名**
 *                                          ⇒ 它不再是「順手打錯位置」做得到的事
 * ```
 * 🔴 判別句:**風險縮小 ≠ 風險消除。** 而「相鄰」只是可對調的其中一種形狀,不是全部。
 */
export function buildAdminSession(
  amr: AdminSessionAmr[],
  authTime: number,
  sub?: AdminSessionSub,
  opts?: { maxAgeSec?: number; ssoAt?: number; sid?: string },
): AdminSessionPayload {
  const maxAgeSec = opts?.maxAgeSec ?? ADMIN_SESSION_MAX_AGE_SEC;
  const now = Math.floor(Date.now() / 1000);
  // 🔴 `ssoAt` 沒傳 ⇒ 這是一條【新的】票鏈(初次登入)⇒ 起點就是現在。
  //    續期時呼叫端要把舊票的 `sso_at` 傳進來, **不要讓它重新開始** ——
  //    重新開始 = 那個 12 小時上限永遠不會到,而它就是本片唯一的天花板。
  const common = {
    // 🔴 沒傳 = 新的一次登入 ⇒ 新產。續期要把舊的傳進來(見上方 `sid` 那段)。
    sid: opts?.sid ?? newSid(),
    iat: now,
    exp: now + maxAgeSec,
    amr,
    auth_time: authTime,
    sso_at: opts?.ssoAt ?? now,
  };
  return sub === undefined ? { v: 1, ...common } : { v: 2, ...common, sub };
}

/**
 * 這條票鏈還能不能續 —— **純函式,好測**。
 *
 * 🔴 缺 `sso_at`(片一簽出的舊票)⇒ **用該票自己的 `iat` 當起點**。
 *    方向是保守的:上限只會**更早**到,不會更晚。
 */
export function ssoChainExpired(
  payload: AdminSessionPayload,
  now: number = Math.floor(Date.now() / 1000),
): boolean {
  const start = payload.sso_at ?? payload.iat;
  return now >= start + SSO_CHAIN_MAX_AGE_SEC;
}

/** 簽出 cookie 字串。ADMIN_SESSION_SECRET 缺 → null(callback 據此回 500,見 REQ4)。 */
export async function signSession(payload: AdminSessionPayload): Promise<string | null> {
  const key = await getKey();
  if (!key) return null;
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
  return `${b64urlFromBytes(data)}.${b64urlFromBytes(sig)}`;
}

const VALID_AMR = new Set<AdminSessionAmr>(['pwd', 'totp', 'bootstrap', 'recovery']);
const isSafeInt = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n);

/**
 * `sub` 的形狀檢查(§B5-3 (2))。
 *
 * 🔴 **判別一律用 `kind`,永遠不要用「有沒有 `staff_id`」判。**
 *    理由:本檔的 `isPayload` **容許額外欄位**(逐欄檢查、沒有「不得有其他欄」那一道)
 *    ⇒ `{kind:'fallback', staff_id:'sean'}` 這種形狀**在型別上不合法、在 runtime 會被放行**。
 * ⚠️ **缺的那一道**(要不要對 `sub` 做嚴格 exact-shape 檢查)= **本片刻意不做**,
 *    理由:全檔沒有一個地方做 exact-shape,單獨在這裡做會與其餘欄位的鬆緊不一致,
 *    而收益要靠「有人用 kind 以外的方式判」才兌現。**寫成缺口,不假裝它被擋住。**
 */
function isSub(v: unknown): v is AdminSessionSub {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  switch (o.kind) {
    case 'user':
      // 🔴 空字串要拒:`resolveStaff('')` 與「沒有身分」在下游長得一樣。
      // 🔴🔴 **用【正面要求】,不要列舉空白**(2026-08-24 codex R2-2;這一格今天被打開兩次):
      //    ```
      //    v1  .length > 0     ⇒ '   ' 放行
      //    v2  .trim() !== ''  ⇒ 🔴 JS 的 trim() 不去 U+200B(零寬)⇒ 零寬字串放行
      //    ```
      //    📏 實測(2026-08-24,node 逐字元):`'\u200B'.trim() === ''` ⇒ **false**。
      //    ⇒ 一個「看起來是空的、而 trim 說它不是空的」slug 會簽出可信的 `v:2` 票。
      //
      // 🔴 **而 DB 那一層【不是同一組規則】** —— 這是 codex R2-2 的重點:
      //    `btrim(x)` **不帶字集只去 ASCII space** ⇒ tab / NBSP / 全形空白在 DB 那邊全部放行。
      //    ⇒ 兩層若各自列舉空白,**永遠對不齊**(JS 的空白定義 ≠ PG 的)。
      //    ⇒ 所以兩層都改成同一個**正面要求**:**至少要有一個 `[a-z0-9_]`**。
      //       migration `20260824030000_…_actor.sql` 的配對 CHECK 用 `~ '[a-z0-9_]'`,
      //       本行用同一個字元集合。**改任一邊要同時改另一邊。**
      // ✅ 不會誤殺:`staff.id` 格式是 `^[a-z0-9_]{1,64}$`
      //    (`20260726120000_m4b_e8a1_staff_table.sql:21`)⇒ 合法 slug 一定含 `[a-z0-9_]`。
      return typeof o.staff_id === 'string' && /[a-z0-9_]/.test(o.staff_id);
    case 'fallback':
    case 'bootstrap':
      return true;
    default:
      return false;
  }
}

/**
 * 嚴格形狀檢查:缺欄 / 型別不對 / 非安全整數 / v 不是 1 或 2 / sid 非 32-hex /
 * amr 空或不在白名單 / auth_time≤0 / (v:2 而 sub 形狀不合法) → reject。
 *
 * 🔴 **本函式只管【形狀】,不管【政策】**(§B5-3 (2)/(3))——
 *    「這個部署現在收不收 `v:1`」住在 `verifySessionDetailed`,不住這裡。
 *    分開的理由:形狀是**永遠**的性質,政策是**這個環境當下**的性質;
 *    混在一起之後,「為什麼這張票被拒」就分不出是票壞了還是旗標開了。
 */
function isPayload(p: unknown): p is AdminSessionPayload {
  if (typeof p !== 'object' || p === null) return false;
  const o = p as Record<string, unknown>;
  if (o.v !== 1 && o.v !== 2) return false;
  if (o.v === 2 && !isSub(o.sub)) return false;
  if (typeof o.sid !== 'string' || !/^[0-9a-f]{32}$/.test(o.sid)) return false;
  if (!isSafeInt(o.iat) || o.iat < 0) return false;
  if (!isSafeInt(o.exp) || o.exp <= 0) return false;
  if (!isSafeInt(o.auth_time) || o.auth_time <= 0) return false;
  // 🔴 選填, 而【有帶就要是合法的】—— 不驗的話, 一個亂填的 sso_at 會讓上限算出負的
  if (o.sso_at !== undefined && (!isSafeInt(o.sso_at) || o.sso_at <= 0)) return false;
  if (!Array.isArray(o.amr) || o.amr.length === 0) return false;
  if (!o.amr.every((x) => typeof x === 'string' && VALID_AMR.has(x as AdminSessionAmr))) return false;
  return true;
}

/**
 * 驗證失敗的**分類** —— 「票綁環境」那一片的**必要配套**,不是 nice-to-have。
 *
 * 🔴 **為什麼它是必要的**:綁環境之後,若 production 讀不到 `VERCEL_ENV`,
 *    症狀是**所有人被登出**。而在此之前 `verifySession` 的**每一種**拒絕都完全靜默
 *    (11 條 `return null`、零記錄;`proxy.ts` 只是導去 `/api/sso/start`)
 *    ⇒ **「真偽造」「設定壞了」「票自然過期」三者輸出完全相同,而且都是空的。**
 *    ⇒ 這是那條線**唯一的早期警報**。
 *
 * 🔴 **分類【永遠不得影響回應】** —— 三種都必須回完全相同的狀態碼 / 標頭 / 延遲。
 *    哪天 `sig_invalid` 與 `expired` 回不同的東西,就等於告訴偽造者「你的簽章對了,只是過期」。
 *    ⇒ 分類**只進 log**,不進回應。
 *
 * 🔴 **只記分類,不記內容**:不得記 token、payload、`sid`、secret
 *    (既有紀律:security-log 不記 code/secret/token)。
 */
export type SessionRejectReason =
  /** 沒有 token,或 token 格式不是 `<payload>.<sig>` */
  | 'absent'
  /**
   * 🔴 簽不出金鑰 —— **`ADMIN_SESSION_SECRET` 缺(或短於 32)**。
   * ⚠️ 與 `no_env` 拆開是刻意的(codex 關卡2 nit):壓成同一個 reason 之後,
   *    **告警永遠說不出是【憑證設定壞了】還是【環境綁定失效】** —— 而那兩件的處置完全不同。
   */
  | 'no_secret'
  /**
   * 🔴 簽不出金鑰 —— **環境標記解析不出來**(`resolveEnvTag()` 回 `null`)。
   * 這是「票綁環境」新增的那一種,而它的處置是**去看 `VERCEL_ENV` / `NODE_ENV`**,
   * 不是去看 secret。
   */
  | 'no_env'
  /**
   * 簽章驗不過 —— 偽造、竄改,**或跨環境**(綁環境之後,這一類會包含它)。
   *
   * 🔴 **綁環境之後,這一類會有一個【永久的噪音底】,而它不是攻擊**:
   *    `pcm-admin` 的 production 分支是 `dev`、preview 來自 `main`
   *    ⇒ preview 部署持續用**舊 code**簽票,那些票打到 production 一律落在這一類。
   *    ⇒ **下一個人若對這一類加告警,會看到一條【永遠不歸零】的線** —— 那是結構造成的,
   *       不是有人在攻擊。⇒ 本片刻意**不記**這一類(見 `proxy.ts` 只記 `no_key`)。
   *
   * 🔴 **而那條線是【低速率】的,這一句才是下一個人真正需要的**(W6 R2):
   *    噪音底的母體 = **有 Vercel 帳號、去打了 preview 的人** ⇒ **被團隊人數封頂**;
   *    而暴力嘗試是**高速率**的。
   *    ⇒ **⇒ 用 `reason` 分不開這兩者,用【速率】分得開。**
   *    ⇒ **日後要偵測,做成【速率訊號】不是【存在訊號】** —— 「有沒有出現」永遠是「有」。
   * ⚠️ 而**今天 `sig_invalid` 完全不記 ⇒ 暴力嘗試【現在就】看不見**。
   *    那是**既有缺口,不是本片造成的** —— 本片沒有讓它變差,也沒有修它。
   */
  | 'sig_invalid'
  /**
   * token 的**形狀**不對 —— 兩種都算(codex 關卡2 nit:原註解只寫了後者,而 code 兩者都回這個):
   *   ① base64url 解不開(垃圾 token)
   *   ② 簽章對了,而 payload 缺欄 / 型別不對 / 版本不合
   * ⚠️ **改的是註解不是行為** —— 本片是 12② 高風險片,能不動行為就不動。
   */
  | 'shape'
  /** 簽章對、形狀對,而 `exp` 已過 */
  | 'expired'
  /**
   * 簽章對、形狀對、沒過期 —— **而這個部署的政策不收這個版本**(B5-a §B5-3 (3))。
   * 今天唯一的來源:`ADMIN_REQUIRE_REAL_IDENTITY` 開著,而票是 `v:1`(舊票 / 上游還沒送身分)。
   *
   * 🔴 **為什麼不壓進 `shape`**:那會讓開旗標當天的「全員被登出」看起來像
   *    「大家的 cookie 都壞了」。而這兩件的處置完全相反 ——
   *    前者是**把旗標關掉**,後者是去查簽章與 secret。
   *    📌 本檔既有的同款判準逐字寫在 `no_secret` / `no_env` 那兩格旁邊。
   * ⛔ ~~**不進 `ALARM_REASONS`**:rollout 期間它是**預期會發生**的,而不是「我們自己壞了」。~~
   *    **2026-08-29 起改為【會告警】,而上面那句留著不刪 —— 它是那個決定的唯一紀錄。**
   * 🔴 **翻它的理由:那句話自己寫著有效期(「rollout 期間」),而【期間有沒有結束沒有人量過】。**
   *    ⚠️🔴 **而我一開始把這裡寫成「rollout 已結束」—— 那是我編的**(codex 對抗審查 must-fix 抓到):
   *    我手上只有「`ADMIN_REQUIRE_REAL_IDENTITY` 這顆變數 2026-08-25 被建立」
   *    (`vercel env ls production --project pcm-admin` ⇒ `created 4d ago`),而那**證不了**
   *    ①舊 `v:1` 票都過期了 ②沒有節點還在發 `v:1`。⇒ **原句已刪,改成下面這個寫得出來的版本。**
   *
   * **翻它的真正理由(不需要「rollout 結束」這個前提)**:
   *    這個 reason 的**兩種來源處置相反** —— 「舊票還在流通(良性)」與「有東西在發舊票(不良性)」
   *    ⇒ **而我們現在沒有任何方法分辨它們**,因為它一列都不記。
   *    ⇒ 記下來之後,**那個分辨才變成可能的**(看它的頻率與時間分布)。
   *    📌 **不是「現在該告警了」,是「不記就永遠不知道該不該告警」。**
   *
   * ⚠️ **本改動【不會】立刻產生任何一列 log** —— 它只在真的有 `v:1` 票撞上來時才叫。
   *    ⇒ ⛔ ~~**不是「拿到證據」,是「以後有事的時候會出聲」。**~~
   *    🔴 **2026-08-29 同日更正(R3 換角度量到)**:那句話**太強了**。
   *       `admin.session.reject` 這個 evt **全 repo 零消費者**
   *       (數法 `grep -rn "admin.session.reject" .` ⇒ 2 行,**兩行都是 `console.warn` 本身**;
   *        負對照 `admin.session.zzzreject` ⇒ 0);而監控是明文拍板延到 Phase 2
   *       (`docs/tools-and-skills.md:391` 逐字「❌ PostHog / Sentry / 監控 — Phase 2 或之後加」)。
   *    ⇒ **沒有人在聽的時候,出聲與不出聲是同一件事。**
   *    ✅ **準確的說法**:它讓**「以後去翻的時候翻得到」** —— 不是「有事的時候會有人知道」。
   *    ⚠️ 而連那個都不保證:Vercel runtime log 有保留期,**而保留期我沒查**(標未確認)。
   *    📌 全文與那一發的分母:`~/pcm-mailbox/線G-R3換角度-那道log沒有任何人在讀-20260829.md`。
   * 🔴 **已知天花板(codex must-fix,照實留)**:`lastAlarmAt` 是**模組層 Map**
   *    ⇒ 節流是【每個 serverless instance 各自一份】,**不是全站一份**。
   *    ⛔ ~~各自 60 秒~~ —— **同日更正**:`version_rejected` 的窗已改成 **1 小時**
   *    (`ALARM_INTERVAL_OVERRIDE_MS`)⇒ 最壞 **N 則/小時**,不是 `N × 60` 則/小時。
   *    🔴 **而我上面那句是我自己在同一顆 commit 裡寫的,寫完當天就被自己改掉的那個值弄成假的**
   *    ⇒ 留痕不刪:**一句描述現況的註解,最常見的死因是【寫它的人自己動了那個現況】。**⚠️ 這**不是本改動引入的**(`no_secret`/`no_env` 同款),
   *    而本改動**把一個可能高頻的 reason 放進了那個天花板底下** ⇒ 風險等級不同,寫出來。
   *    ⇒ **要真的擋洪水得換共享節流(KV/Redis),那是另一片,本片不做。**
   */
  | 'version_rejected';

/**
 * 🔴 **這一類就是「我們自己壞了」** —— 只有它值得無條件被知道。
 * `absent`/`shape`/`sig_invalid`/`expired` 都是**外面送進來的東西不對**,而那是常態。
 */
export const ALARM_REASONS: ReadonlySet<SessionRejectReason> = new Set<SessionRejectReason>([
  'no_secret',
  'no_env',
  // 🔴 2026-08-29 加入(理由全文在 `version_rejected` 那格的訃聞段)。
  //    ⚠️ 它與上面兩個**不同族**:上面兩個是「我們自己壞了」,這一個是
  //    「外面送進來一張不該還在的票」。
  //    🔴 **而我【不宣稱】那已經不是預期** —— 那要「rollout 結束」當前提,而我沒有那個證據。
  //    加它的理由只有一個:**不記就分辨不出那兩種來源。**
  'version_rejected',
]);

// ── 告警的【有界去重】(codex 關卡2 M2) ──────────────────────────────────────
// 🔴 病:`no_key`(現已拆成 no_secret/no_env)發生時,**整站都在失敗** ——
//    而那正是【每一個匿名請求都會走到這一行】的時刻。逐次記 ⇒
//    ① Vercel log 量與費用被放大成一個 DoS 面(攻擊者只要打壞 cookie 就能放大)
//    ② 🔴 而更糟的是:**真訊號被自己的洪水淹掉** —— 這道警報在最需要它的那一分鐘失效
//    ③ 而只有這一類會多做一次 I/O ⇒ **延遲與其他拒絕不同 = 一個時間側通道**
// ⇒ 每個 reason 每 `ALARM_MIN_INTERVAL_MS` 最多一則,**而個別 reason 可以更長**
//    (見下方 `ALARM_INTERVAL_OVERRIDE_MS`;2026-08-29 起 `version_rejected` = 1 小時)。
// ⚠️ 誠實界線:serverless 每個 instance 各有自己的計時器 ⇒ 這是**上界不是精確節流**;
//    它擋的是「單一 instance 的洪水」,不是「全域剛好一則」。
const ALARM_MIN_INTERVAL_MS = 60_000;

/**
 * 🔴 **逐 reason 的節流窗**(2026-08-29,codex 對抗審查 R2-1)。沒列的用 `ALARM_MIN_INTERVAL_MS`。
 *
 * 為什麼 `version_rejected` 要一個【一小時】的窗,而不是照舊的一分鐘:
 * ```
 * no_secret / no_env = 設定壞了 ⇒ 每個請求都撞，而【那件事本身就該吵】
 * version_rejected   = 一張 v:1 票 ⇒ 🔴 一個人重整頁面就能每分鐘產一則，
 *                      而【他不需要有惡意】—— 一個舊分頁自己就會做到
 * ```
 * ⚠️ **新的天花板是什麼,寫清楚**:每個 instance 每小時最多 1 則
 * ⇒ N 個 instance ⇒ **最壞 N 則/小時**(舊值是最壞 `N × 60` 則/小時)。
 * 🔴 **而它【仍然不是】全站上限** —— `lastAlarmAt` 是模組層 Map,
 *    每個 serverless instance 各有一份,**沒有任何跨 instance 的協調**。
 *    ⇒ 真正的全站上限要共享節流(KV / Redis),**那是另一片,已進池子**。
 * 📌 **不要把這一格讀成「已節流」** —— 它降了一個量級,而它沒有把那個面關掉。
 */
const ALARM_INTERVAL_OVERRIDE_MS: ReadonlyMap<SessionRejectReason, number> = new Map([
  ['version_rejected', 3_600_000],
]);

const lastAlarmAt = new Map<SessionRejectReason, number>();

/**
 * 🔴 **呼叫即消耗** —— 這不是一個純述詞,名字是刻意這樣取的(W6 審查)。
 *
 * ⛔ ~~原名 `shouldAlarm()`~~ —— 那個名字讀起來像「問一下該不該叫」,
 *    而**它回 true 的同時就把那個窗口用掉了**。
 *    ⇒ 有人在別處對同一個 reason 再問一次,**第二次會靜靜回 false**,
 *      而他會讀成「這次不該告警」—— 那是一個**看起來像答案的副作用**。
 * ⇒ **呼叫端每次拒絕只准呼叫一次,而且要直接拿它當「叫不叫」用,不要先問再決定。**
 */
export function consumeAlarmSlot(reason: SessionRejectReason, now: number = Date.now()): boolean {
  if (!ALARM_REASONS.has(reason)) return false;
  const prev = lastAlarmAt.get(reason);
  const minInterval = ALARM_INTERVAL_OVERRIDE_MS.get(reason) ?? ALARM_MIN_INTERVAL_MS;
  if (prev !== undefined && now - prev < minInterval) return false;
  lastAlarmAt.set(reason, now);
  return true;
}

/** 測試用:清掉去重狀態。**不要在 production code 呼叫。** */
export function __resetAlarmThrottleForTests(): void {
  lastAlarmAt.clear();
}


export type VerifyResult =
  | { readonly ok: true; readonly payload: AdminSessionPayload }
  | { readonly ok: false; readonly reason: SessionRejectReason };

/**
 * 驗 cookie 並**回報失敗分類**。`verifySession()` 是它的薄包裝。
 *
 * ⚠️ **誠實界線**:`sig_invalid` 目前**分不出「偽造」與「跨環境」** —— 兩者在 HMAC 那一關
 *    長得一樣,而那是綁環境這個設計的**本質**(它就是靠簽章對不上)。
 *    ⇒ 要分開只能在 payload 裡放環境標記,而那正是被否掉的那條路(要升 `v`、動 8 份 spec)。
 *    **⇒ 記成已知限制,不假裝分得開。**
 */
export async function verifySessionDetailed(
  token: string | undefined | null,
): Promise<VerifyResult> {
  if (!token) return { ok: false, reason: 'absent' };
  const key = await getKey();
  if (!key) {
    // 🔴 拆成兩種(codex 關卡2 nit):告警要說得出是【憑證】還是【環境】壞了。
    //    ⚠️ 只讀存在性,**不記任何值**。
    return {
      ok: false,
      reason: strongSecret(process.env.ADMIN_SESSION_SECRET) === null ? 'no_secret' : 'no_env',
    };
  }
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return { ok: false, reason: 'absent' };
  let data: Uint8Array;
  let sig: Uint8Array;
  try {
    data = b64urlToBytes(token.slice(0, dot));
    sig = b64urlToBytes(token.slice(dot + 1));
  } catch {
    return { ok: false, reason: 'shape' };
  }
  let valid = false;
  try {
    valid = await crypto.subtle.verify('HMAC', key, sig as BufferSource, data as BufferSource);
  } catch {
    return { ok: false, reason: 'sig_invalid' };
  }
  if (!valid) return { ok: false, reason: 'sig_invalid' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(data));
  } catch {
    return { ok: false, reason: 'shape' };
  }
  if (!isPayload(parsed)) return { ok: false, reason: 'shape' };
  if (parsed.exp <= Math.floor(Date.now() / 1000)) return { ok: false, reason: 'expired' };
  // ── 🔴 版本【政策】(§B5-3 (3))—— 形狀與過期都過了,才輪到「這個部署收不收它」 ──
  //    順序是硬的:政策放在最後,一張過期的舊票才會被報成 `expired` 而不是 `version_rejected`。
  //    ⚠️ 而政策**只看版本,不看 `sub` 的內容** —— 「那個人是誰、在不在職」是 `actor.ts` 那一層。
  if (parsed.v === 1 && requireRealIdentity()) return { ok: false, reason: 'version_rejected' };
  return { ok: true, payload: parsed };
}

/**
 * 驗 cookie。回 payload 或 null。
 * fail-closed:ADMIN_SESSION_SECRET 缺 / 簽章不符 / 任一欄缺 / 形狀不對 / 過期(exp≤now)→ null。
 * 🔴 phase1 stateless、無 server 端 token_version 撤銷:被竊 cookie 於 exp 前有效,緩解=短 TTL + 換 secret 全域失效。
 */
export async function verifySession(token: string | undefined | null): Promise<AdminSessionPayload | null> {
  // 🔴 **薄包裝,不得有第二份實作** —— 兩份會漂,而漂了之後
  //    「哪一支才是真的驗證邏輯」要靠人去比對。**能消除重複,就不要去偵測不一致。**
  const r = await verifySessionDetailed(token);
  return r.ok ? r.payload : null;
}

/** amr 是否含完整 2FA(totp/recovery);供未來 step-up slice 判斷,本 slice 不強制。 */
export function isFull2faSession(p: AdminSessionPayload): boolean {
  return p.amr.includes('totp') || p.amr.includes('recovery');
}
