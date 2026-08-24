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
//   · 票不是 `v:2` 而旗標關(**今天**)⇒ 仍是上面那段描述的世界:使用者自選、未驗證
// 🔴 **所以上面那段今天仍然為真,而它【不再是全部】** —— 留痕不刪,因為
//    下一個讀這裡的人多半是來做安全審查的,他需要知道這條路曾經長什麼樣。
// ⏳ **它完全失效的那一天** = `ADMIN_REQUIRE_REAL_IDENTITY` 打開且上游穩定送 `sub`
//    ⇒ 那時第 3 層走不到,這段訃聞才可以整段刪。**那天不是今天。**

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
  const store = await cookies();

  // ── 第 1 層:票上帶了身分 ⇒ 只認它 ──────────────────────────────────────
  const session = await verifySession(store.get(ADMIN_SESS_COOKIE)?.value);
  if (session?.v === 2) {
    switch (session.sub.kind) {
      case 'user':
        return await resolveStaff(session.sub.staff_id);
      case 'fallback':
        // 共用密碼備援登入 = **一種明確的身分,而它沒有具名操作者**。不是「未登入」。
        return null;
      case 'bootstrap':
        // 首次建置(SETUP_SECRET)—— 它**沒有** staff_id(`session.ts` 的 AdminSessionSub 逐字)。
        return null;
      default: {
        // 🔴 **exhaustive check,不是防禦性編程**:日後 `AdminSessionSub` 加第四種變體時,
        //    **這一行會編譯紅** —— 而規格點名的病正是「寫成 if (kind==='fallback') 之後,
        //    新變體會【靜默】走到 user 那一支」。
        // ⚠️ runtime 走到這裡是**不可達**的(`isPayload` 已擋掉不認得的 kind);
        //    而萬一到了,**回 null(fail-closed),不 throw** —— 這是身分路徑,
        //    讓它 500 等於把一個型別問題變成全站故障。
        const _exhaustive: never = session.sub;
        void _exhaustive;
        return null;
      }
    }
  }

  // ── 第 2 層:旗標開著而票上沒身分 ⇒ 不得回退 ───────────────────────────
  // 🔴 這一行就是「不再信任使用者自己挑的那個人」那句話的實體。
  if (requireRealIdentity()) return null;

  // ── 第 3 層:旗標關著(今天)⇒ 與改動前逐字相同 ─────────────────────────
  return await resolveStaff(store.get(ACTOR_COOKIE)?.value);
}
