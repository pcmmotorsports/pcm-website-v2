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
// 具名身分不在此 payload:報價單=共用密碼登入,SSO 只帶認證(amr/auth_time)、無 per-user 身分。
//   「操作者是誰」仍走 lib/session/actor.ts 的 picker(到 M-4b 真帳號)。SSO=認證,不是身分綁定。
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

export interface AdminSessionPayload {
  v: 1;
  sid: string; // 128-bit hex;每次簽發新產 = §3.1「旋轉 session id」(stateless 下為衛生,非撤銷)
  iat: number; // unix sec:admin 簽發時刻
  exp: number; // unix sec:iat + TTL;🔴 verifySession 以此欄判過期(非靠 cookie 屬性)
  amr: AdminSessionAmr[]; // 報價單傳來、admin 已白名單過濾
  // 報價單 session.iat。⚠️ 語意=隨 sliding refresh 更新的時刻,非不變登入時刻(報價單端自述)。
  //   step-up「近期驗證過」比對前置=報價單側改存不變值,否則形同虛設;本 slice 只忠實存放。
  auth_time: number;
}

export const IS_PROD = process.env.NODE_ENV === 'production';
// 🔴 secret 最小長度(<32 視為未設、fail-closed):弱 ADMIN_SESSION_SECRET → 離線暴破 HMAC → 偽造任意 admin session(Fable/Codex MF5)。
const MIN_SECRET_LEN = 32;
const strongSecret = (s: string | undefined): string | null => (s && s.length >= MIN_SECRET_LEN ? s : null);
// prod: __Host- 前綴要求 secure + path=/ + 無 Domain;dev(http)不能用 __Host-、且不加 Secure(localhost 全瀏覽器可收)。
export const ADMIN_SESS_COOKIE = IS_PROD ? '__Host-pcm_admin_sess' : 'pcm_admin_sess_dev';
export const ADMIN_SESSION_MAX_AGE_SEC = 60 * 60 * 12; // 12h(後台、比報價單 24h 稍緊)

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

/** 組 payload(每次新 sid = 旋轉;iat=now、exp=now+TTL)。 */
export function buildAdminSession(
  amr: AdminSessionAmr[],
  authTime: number,
  maxAgeSec: number = ADMIN_SESSION_MAX_AGE_SEC,
): AdminSessionPayload {
  const now = Math.floor(Date.now() / 1000);
  return { v: 1, sid: newSid(), iat: now, exp: now + maxAgeSec, amr, auth_time: authTime };
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

/** 嚴格形狀檢查:缺欄 / 型別不對 / 非安全整數 / v≠1 / sid 非 32-hex / amr 空或不在白名單 / auth_time≤0 → reject。 */
function isPayload(p: unknown): p is AdminSessionPayload {
  if (typeof p !== 'object' || p === null) return false;
  const o = p as Record<string, unknown>;
  if (o.v !== 1) return false;
  if (typeof o.sid !== 'string' || !/^[0-9a-f]{32}$/.test(o.sid)) return false;
  if (!isSafeInt(o.iat) || o.iat < 0) return false;
  if (!isSafeInt(o.exp) || o.exp <= 0) return false;
  if (!isSafeInt(o.auth_time) || o.auth_time <= 0) return false;
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
  | 'expired';

/**
 * 🔴 **這一類就是「我們自己壞了」** —— 只有它值得無條件被知道。
 * `absent`/`shape`/`sig_invalid`/`expired` 都是**外面送進來的東西不對**,而那是常態。
 */
export const ALARM_REASONS: ReadonlySet<SessionRejectReason> = new Set<SessionRejectReason>([
  'no_secret',
  'no_env',
]);

// ── 告警的【有界去重】(codex 關卡2 M2) ──────────────────────────────────────
// 🔴 病:`no_key`(現已拆成 no_secret/no_env)發生時,**整站都在失敗** ——
//    而那正是【每一個匿名請求都會走到這一行】的時刻。逐次記 ⇒
//    ① Vercel log 量與費用被放大成一個 DoS 面(攻擊者只要打壞 cookie 就能放大)
//    ② 🔴 而更糟的是:**真訊號被自己的洪水淹掉** —— 這道警報在最需要它的那一分鐘失效
//    ③ 而只有這一類會多做一次 I/O ⇒ **延遲與其他拒絕不同 = 一個時間側通道**
// ⇒ 每個 reason 每 `ALARM_MIN_INTERVAL_MS` 最多一則。
// ⚠️ 誠實界線:serverless 每個 instance 各有自己的計時器 ⇒ 這是**上界不是精確節流**;
//    它擋的是「單一 instance 的洪水」,不是「全域剛好一則」。
const ALARM_MIN_INTERVAL_MS = 60_000;
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
  if (prev !== undefined && now - prev < ALARM_MIN_INTERVAL_MS) return false;
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
