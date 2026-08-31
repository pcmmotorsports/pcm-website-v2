import { cookies } from 'next/headers';
import { ADMIN_SESS_COOKIE, requireRealIdentity, verifySession } from './session';
// 相對 import 是歷史遺留(#606 前 root vitest alias 只指 storefront);#606 起 admin project
// 有自己的 @ alias,新 code 可直接用 @/。既有相對路徑與各檔指到本行的指標註解,整批清理=#612。
import { resolveStaff, type StaffActor } from '../staff';

// M-4a M0-S2 session 具名身分讀取層 —— **2026-08-24 `B5-a` 之後,這一段變了。**
//
// ⛔ ~~🔴 actor 以 cookie 承載、內容來自使用者自行選擇。這**不是**登入 / 授權邊界,
//    也沒有驗證「目前使用者是誰」;真實身分驗證待個人帳號接上後,此 cookie 版才退場。~~
//
// **現況(取代上面那段)**:身分來源**依票而定**,見 `getSessionActor` 的三層。
//   · 票是 `v:2` ⇒ 身分來自**經過簽章驗證的票**,而那顆自選 cookie **一個字都不讀**
//   · 票不是 `v:2` 而旗標【關】⇒ 仍是上面那段描述的世界:使用者自選、未驗證
//
// ⛔🔴🔴 ~~所以上面那段今天仍然為真, 而它【不再是全部】~~
// ⛔ ~~它完全失效的那一天 = `ADMIN_REQUIRE_REAL_IDENTITY` 打開且上游穩定送 `sub`
//    ⇒ 那時第 3 層走不到, 這段訃聞才可以整段刪。**那天不是今天。**~~
//    **上面兩句寫於 2026-08-24, 而它們自 2026-08-25 起【不再描述正式站】。**
//    (2026-08-29 11:39:20 線A 訂正;`Q-ACTORCITE` Sean 批甲「先修正本」)
//
// ✅ **拆兩個時期, 兩半都留**(形狀抄 `app/settings/audit/page.tsx:139`, 它 2026-08-28 已這樣解過):
//   **2026-08-25 之前**:上面那段訃聞【為真】—— 而**它對那個時期產生的稽核紀錄仍然為真**,
//                        所以不刪。做安全審查或讀舊紀錄的人需要它。
//   🔴 **2026-08-25 起(含今天)**:`ADMIN_REQUIRE_REAL_IDENTITY` 已被設為 `1` 並重新部署
//                        ⇒ **第 3 層在正式站上走不到** ⇒ 那顆自選 cookie 一個字都不讀。
//
// **依據(三條,線A 逐條複核過;不是憑印象)**:
//   ① Sean 2026-08-25 逐字「`ADMIN_REQUIRE_REAL_IDENTITY` 沒有這一條, 我剛剛加上去了
//      並且重新部署了」, 追問值 ⇒ 答「1」;而 `session.ts:175` 判的是 `=== '1'` ⇒ 值對得上
//      (memory `project_0825-real-identity-gate-is-live.md`)
//   ② 同一份:他【登出再登入】成功 ⇒ 通過 `sso/callback` 的 `!result.sub` 那道閘
//      ⇒ **上游有在送 `sub` 是量到的**(旗標開著而上游沒送, 本來就該拒)
//   ③ repo 內已有第二處這樣寫:`app/settings/audit/page.tsx:139` 逐字
//      「那句話 2026-08-25 就已經假了(B5-a 起 `ADMIN_REQUIRE_REAL_IDENTITY=1`…)」
//
// ⚠️🔴 **而這段【讀不到線上那個 env 的現值】** —— 上面三條全部是 repo 與 memory 的紀錄。
//    **若有人把它關掉、或改成 `true`**(`session.ts:175` 只認剛好是 `'1'`)
//    **⇒ 這一整段要重算, 而不會有任何東西提醒你。**
//
// 📌 **⇒ 引用本檔頭的人請引【錨字串】不要引行號** —— 那 5 處自陳引用引的是
//    `session/actor.ts:5-7 / :6-7 / :7`, 而那個座標今天指到的是上面那段刪節線。
//    (全文與那 28 支候選:`~/pcm-mailbox/線F-plan-5處自陳引用指到墓碑-20260829.md`)

/** actor cookie 名(讀寫共用;寫在 session/actor-actions.ts)。 */
export const ACTOR_COOKIE = 'pcm_admin_actor';

/**
 * 「選具名身分」表單的欄名(**wire 契約**:送出端 `app/page.tsx` 與讀取端
 * `actor-actions.ts` 必須是同一個字面)。
 *
 * 🔴 **#388:為什麼要有這顆常數** —— 這個欄名打錯字的症狀是
 * **讀不到 ⇒ 靜默不寫 cookie ⇒ 操作者身分沒換**,而 typecheck、lint、測試**全部看不到**
 * (兩邊各自都是合法字串)。而這顆值最終會成為 `admin_audit_log.actor` 的來源
 * (`20260726120000:26-27`)⇒ 打錯字 = 稽核歸屬靜默斷線。
 *
 * 🔴 **常數住在這裡、不在 `actor-actions.ts`**:那支是 `'use server'` 模組,
 * **只能 export async function** —— 在那裡放常數會讓 Next 把整個模組的 export 清空,
 * 而且 **只有 `next build` 抓得到**(`lib/orders/keyword-search-action.ts` 檔頭記過同一個坑:
 * typecheck、lint、全套測試當時全部沒抓到)。
 */
export const ACTOR_ID_FIELD = 'actorId';

/**
 * 讀 session 當前具名身分 —— **B5-a 之後,它有三層,而順序是硬的**(規格 §B5-5)。
 *
 * ```
 * 第 1 層  票是 v:2      ⇒ 身分【只】從 sub 來,ACTOR_COOKIE 一個字都不讀
 * 第 2 層  不是 v:2 而旗標【開】 ⇒ null,🔴 不得回退去讀 ACTOR_COOKIE
 * 第 3 層  不是 v:2 而旗標【關】 ⇒ 維持改動前那一行(= 今天的行為,零改變)
 * ```
 *
 * 🔴 **第 1 層為什麼是「不讀」而不是「讀了再覆蓋」**(§B5-5 第 1 條):
 *    讀了就會有人想「兩邊不一致時要不要合一下」,而那正是 §7.1 標為**未折**的那一題。
 *    **不讀 ⇒ 那一題在這條路上不存在。**
 *
 * 🔴🔴 **回 `null` 現在有兩種來源,而它們【都不是】「未登入」**:
 *    ① 還沒選人(第 3 層,今天的意思)
 *    ② 登入了而**沒有具名身分**(第 1 層的 fallback / bootstrap)
 *    ⇒ **呼叫端不得把 `null` 當成「導去登入頁」** —— §7.1 逐字「讀取是允許的,它一定走得到」。
 *    📏 而這件事我在 B5-a 開工前**逐支開過檔**(四個呼叫端,不是 grep 命中數):
 *       `authorize.ts:40`(不准寫入=正是 fallback 該有的)/ `audit/context.ts:27`(只被寫入路徑呼叫)/
 *       `app/page.tsx:34`(顯示選人表單,不是導登入頁)/ `order-detail-route.tsx:135`(顯示層比對)
 *       ⇒ **沒有一支把 `null` 當「未登入」** ⇒ 本片不需要第三種回傳值。
 *
 * 🔴 **寫入的攔截點仍在寫入端**(`authorizeAdminMutation`),
 *    **不靠本函式回 `null` 順便擋住**(§B5-5 第 3 條)。
 */
export async function getSessionActor(): Promise<StaffActor | null> {
  return (await getSessionActorWithSource()).actor;
}

/**
 * 同一段三層,而**多回一格「身分是打哪來的」**(`:247` 後台首頁假文案片,2026-08-29 線F)。
 *
 * 🔴 **為什麼要有這個函式**:首頁那句「這個身分是你自己選的、系統並未驗證」
 *    **是無條件印的** —— 三個世界印同一句,而其中兩個世界它是假的。
 *    而要印對那句話所需要的事實,**這段程式每一次 request 都已經算出來了,只是沒有回傳出去**。
 *
 * 🔴🔴 **決定文案的是【那張票】,不是那顆旗標** —— 這一格很容易寫反,寫反了測試也不會紅:
 *    存在「旗標**關**而票已經是 `v:2`」的世界 ⇒ 身分是**驗證過的**,
 *    ⇒ 照旗標分岔會在那裡印「你自己選的」。**旗標只在第 2 層有話講,第 1 層它一個字都不算數。**
 *
 * 🔴 **`'none'` / `'stale-ticket'` 都不是「沒選人」** —— 它們的意思是**這次 request 根本不會去讀
 *    `ACTOR_COOKIE`**(前者=第 1 層 fallback/bootstrap,後者=第 2 層)
 *    ⇒ **首頁那顆選單在這兩個世界裡選了不會生效**,而**兩者的復原步驟不同**(見下面型別上的說明)。
 *    ⚠️ 而「選了沒生效」與「還沒選」在畫面上長得一樣(兩者都印「尚未選擇」)——
 *    **停用那顆選單是 UI 行為改動 ⇒ Sean 的地盤,本片只把話說對、不動那顆鈕**(已進累積表)。
 *    ⇒ 對照:`'self-selected'` + `actor === null` 才是真的「還沒選」,那顆選單是**活的**。
 */
export type ActorSource =
  /** 第 1 層:票是 `v:2` 且 `sub.kind='user'` ⇒ 身分來自簽章驗證過的票。 */
  | 'ticket'
  /** 第 3 層:讀 `ACTOR_COOKIE` ⇒ 使用者自選、未驗證(`actor` 為 null = 還沒選)。 */
  | 'self-selected'
  /** 第 1 層 fallback/bootstrap ⇒ 這次登入**沒有**具名操作者,而**重登也不會變**。 */
  | 'none'
  /**
   * 第 2 層:旗標開著而票上沒身分(= 舊的 `v:1` 票)。
   *
   * 🔴 **它與 `none` 分開,是因為【員工該做的事不同】**(codex 關卡2 R3「災難當天」角度):
   *    這一種**登出再登入一次就會拿到新票**;`none` 那一種(共用密碼 / 首次建置)重登沒有用。
   *    ⇒ 合併成一個值,首頁就只能講一句對其中一半是錯的復原步驟。
   */
  | 'stale-ticket';

export async function getSessionActorWithSource(): Promise<{
  readonly actor: StaffActor | null;
  readonly source: ActorSource;
}> {
  const store = await cookies();

  // ── 第 1 層:票上帶了身分 ⇒ 只認它 ──────────────────────────────────────
  const session = await verifySession(store.get(ADMIN_SESS_COOKIE)?.value);
  if (session?.v === 2) {
    switch (session.sub.kind) {
      case 'user':
        return { actor: await resolveStaff(session.sub.staff_id), source: 'ticket' };
      case 'fallback':
        // 共用密碼備援登入 = **一種明確的身分,而它沒有具名操作者**。不是「未登入」。
        return { actor: null, source: 'none' };
      case 'bootstrap':
        // 首次建置(SETUP_SECRET)—— 它**沒有** staff_id(`session.ts` 的 AdminSessionSub 逐字)。
        return { actor: null, source: 'none' };
      default: {
        // 🔴 **exhaustive check,不是防禦性編程**:日後 `AdminSessionSub` 加第四種變體時,
        //    **這一行會編譯紅** —— 而規格點名的病正是「寫成 if (kind==='fallback') 之後,
        //    新變體會【靜默】走到 user 那一支」。
        // ⚠️ runtime 走到這裡是**不可達**的(`isPayload` 已擋掉不認得的 kind);
        //    而萬一到了,**回 null(fail-closed),不 throw** —— 這是身分路徑,
        //    讓它 500 等於把一個型別問題變成全站故障。
        const _exhaustive: never = session.sub;
        void _exhaustive;
        return { actor: null, source: 'none' };
      }
    }
  }

  // ── 第 2 層:旗標開著而票上沒身分 ⇒ 不得回退 ───────────────────────────
  // 🔴 這一行就是「不再信任使用者自己挑的那個人」那句話的實體。
  if (requireRealIdentity()) return { actor: null, source: 'stale-ticket' };

  // ── 第 3 層:旗標關著(今天)⇒ 與改動前逐字相同 ─────────────────────────
  return {
    actor: await resolveStaff(store.get(ACTOR_COOKIE)?.value),
    source: 'self-selected',
  };
}

/**
 * 同一段三層,而**只回【原始 id】,一次 DB 都不打**。
 *
 * 🔴 **為什麼要它**(codex R2 must-fix,2026-08-31;Sean 同日拍甲):
 *    `getSessionActor()` 出口的 `null` 有**兩種意思壓在一起**:
 *      ① 這次登入沒有具名操作者(共用密碼 / 首次建置 / 舊票 / 還沒選)
 *      ② **查身分的那一發失敗了** —— `staff.ts` 的 `listActiveStaff()` 逐字
 *         `catch { … return []; }`(`staff.ts:67-73`)⇒ DB 掛掉也回 `null`
 *    ⇒ 任何想把「沒權限」與「查不出來」分開顯示的畫面,**在拿到值之前就已經分不開了**。
 *    codex 原話:**三態在【資料進頁面之前】就已經塌成兩態。**
 *
 * ⇒ 本函式**不查 DB** ⇒ 它的回傳值裡沒有「查詢失敗」這種可能:
 *   `id` 為 null **只代表【票 / cookie 上沒有具名 id】**,而那是一個確定的事實。
 *   呼叫端若需要「這個 id 是不是啟用中的管理者」,**拿自己已經載好的那份名單去比**
 *   —— 那樣「名單載入失敗」就由呼叫端自己的錯誤處理承接,不會偽裝成「沒權限」。
 *
 * 🛑 **本函式不取代 `getSessionActor()`** —— 那支仍是授權路徑在用的
 *    (`session/authorize.ts:67`、`audit/context.ts:27`),**一個字都沒動**。
 *    兩者的分層邏輯目前是**兩份**,而 `actor-source-parity.test.ts` 釘著它們的 `source` 必須一致
 *    (⇒ 有人只改一邊, 那支會紅)。
 */
export async function getSessionActorIdWithSource(): Promise<{
  readonly id: string | null;
  readonly source: ActorSource;
}> {
  const store = await cookies();

  // ── 第 1 層:票上帶了身分 ⇒ 只認它(不查 DB) ──────────────────────────
  const session = await verifySession(store.get(ADMIN_SESS_COOKIE)?.value);
  if (session?.v === 2) {
    switch (session.sub.kind) {
      case 'user':
        return { id: session.sub.staff_id, source: 'ticket' };
      case 'fallback':
      case 'bootstrap':
        return { id: null, source: 'none' };
      default: {
        // exhaustive check,理由與 `getSessionActorWithSource` 同一段,不重複寫。
        const _exhaustive: never = session.sub;
        void _exhaustive;
        return { id: null, source: 'none' };
      }
    }
  }

  // ── 第 2 層:旗標開著而票上沒身分 ⇒ 不得回退 ──────────────────────────
  if (requireRealIdentity()) return { id: null, source: 'stale-ticket' };

  // ── 第 3 層:旗標關著 ⇒ 讀那顆自選 cookie(仍然不查 DB) ──────────────────
  return { id: store.get(ACTOR_COOKIE)?.value ?? null, source: 'self-selected' };
}
