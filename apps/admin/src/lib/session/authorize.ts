import 'server-only';
import { cookies, headers } from 'next/headers';
// 相對 import(非 @/):#606 前的歷史遺留,見 session/actor.ts 註解(#612 更新:#606 起可用 @/,既有不回改)。
import { ADMIN_SESS_COOKIE, consumeAlarmSlot, verifySessionDetailed } from './session';
import { getSessionActor } from './actor';
import { isActiveManager } from '../staff';
import { isAllowedOrigin } from '../orders/workflow-form';

// authorize.ts — admin mutation 共用授權閘(M-4a 儲值金編輯片自 order-actions.ts 抽出;
// 原「D-2 抽出、order/item 兩 action 共用」的 authorizeAdminMutation 原封搬移,行為零變更,
// 供 orders / customers 兩域 server action 共用;不放 'use server' 檔內=避免 helper 被當 action 匯出)。
//
// 🔴 安全縱深(不只靠 proxy 登入閘;Slice C verdict must-fix 2/3):
//   ① verifySession(cookie) 自驗——admin session 票證無效 → 拒;
//   ② Origin fail-closed——缺 Origin 即拒 + 精確等值(dev 走 ADMIN_DEV_BYPASS localhost allowlist);
//   ③ actor 具名身分——picker cookie 解析(缺=拒)。
//
// 🔴 **⟦b4-MGR0⟧ 2026-08-28 推翻了原本寫在 ③ 的那半句**:
//    ~~「actor 只標『我是誰』、非授權,授權在 ①」~~ **對本檔的第二支閘不再成立** ——
//    `authorizeManagerMutation` 拿的正是那個 actor 去問「他是不是管理者」⇒ **actor 現在承重了。**
//    ⚠️ 而 `authorizeAdminMutation`(①②③ 那支)本身沒變:對它而言原句仍然為真。
//    ⇒ 這裡有【兩道閘、兩種語意】,不要把其中一句當成整支檔的規則。

const DEV_BYPASS =
  process.env.NODE_ENV !== 'production' && process.env.ADMIN_DEV_BYPASS === '1';

/**
 * 共用授權閘(①session 自驗 ②Origin fail-closed ③具名 actor)。
 * 任一失敗 → null(caller redirect denied;不以未知身分寫稽核)。
 */
export async function authorizeAdminMutation(): Promise<{
  sid: string;
  actorId: string;
} | null> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const verified = await verifySessionDetailed(cookieStore.get(ADMIN_SESS_COOKIE)?.value);
  if (!verified.ok) {
    // 🔴 同 proxy.ts:只記分類、不記內容、不影響回傳(照舊 null),而【只記 no_key】。
    //    規則與 proxy 一致比較不會有人只改一邊。
    if (consumeAlarmSlot(verified.reason)) {
      console.warn(JSON.stringify({ evt: 'admin.session.reject', at: 'authorize', reason: verified.reason }));
    }
    return null;
  }
  const session = verified.payload;
  // 🔴 `#948`:dev 分支要比對【這台伺服器自己的 host】——**只讀 `host`,不讀 `x-forwarded-host`**
  //    (2026-08-27 實測:餵一個假 Host 進去,兩個一起變成假的 ⇒ forwarded 那支不比 `host` 可信。
  //     🔴 **射程 = 本 repo 現行 dev、瀏覽器直連、無反向代理** —— 有反代時會反過來,
  //     完整說明在 `workflow-form.ts` 的 docstring,不要只讀這一行。)
  //    這道閘靠的是「瀏覽器改不了 Host」,不是「Host 可信」—— 理由全文在 `workflow-form.ts` 的 docstring。
  if (
    !isAllowedOrigin(headerStore.get('origin'), {
      devBypass: DEV_BYPASS,
      host: headerStore.get('host'),
    })
  ) {
    return null;
  }
  const actor = await getSessionActor();
  if (!actor) return null;
  return { sid: session.sid, actorId: actor.id };
}

/**
 * 管理者專用閘 = `authorizeAdminMutation()` 再加一道「這個 actor 是不是【啟用中的管理者】」。
 * ⟦b4-MGR0⟧ 2026-08-28(Sean 當日批准開工,依主視窗摘要)。
 *
 * **為什麼入口在這支檔**:下一個來找「授權在哪」的人會打開 `authorize.ts`。
 * 閘要住在讀者會去找的地方;**而查詢住在管資料的那支檔**(`../staff` 的 `isActiveManager`)。
 *
 * 🔴 天花板與代價寫在 `isActiveManager` 的 docstring,不在這裡重複一份
 *    ——【兩份會漂】,而漂掉的那天沒有任何東西會紅。
 *
 * 🔴🔴 **路二(兩條天花板之一;路一在 `isActiveManager` 的 docstring)——
 *    這道閘的效力【綁在 `ADMIN_REQUIRE_REAL_IDENTITY=1` 上】**(codex 關卡2 must-fix,2026-08-28):
 *    ⚠️ **兩條互相獨立、任一條成立就夠** —— 補了路一(DB 層 REVOKE)對這一條**零效果**,反之亦然。
 *       (線C 2026-08-28 更正:我原本把它寫成「路一的更深一層」,而那是錯的軸。)
 *    旗標關著時,`getSessionActor` 會走到第 3 層 = 讀那顆**使用者自選的 picker cookie**
 *    (`session/actor.ts`)⇒ 任何登入者把 cookie 設成某個啟用中管理者的 id,
 *    本閘查的就是【他自陳的那個 id】⇒ **它會放行,而每一道檢查都正確運作了。**
 *    ✅ 正式站 2026-08-25 起 `=1`(Sean 親口 + 登出再登入的行為驗證)⇒ **今天這道閘是真的。**
 *    🔴 **而它的值【物理上沒有人讀得到】** —— Vercel 那格 Type = `Secret`,面板逐字
 *       「You can't reveal this value after saving」⇒ **連 Sean 本人也讀不到。**
 *       ⇒ 所以這裡**不寫「請確認那顆 env 開著」** —— 那是一個永遠不會結束的動作。
 *       看得到的只有【它存不存在】:`vercel env ls production --project pcm-admin`
 *       ⇒ 那張清單在 `=1` 與 `=0` 兩個世界**印同一個 `Encrypted`**。
 *    ⚠️ 而**本檔沒有、也不該在這裡強制那個旗標** —— 關掉它會讓 dev(`ADMIN_DEV_BYPASS`)進不去,
 *       那是另一片的範圍(B7)。這裡只把依賴寫下來:
 *       📌 **有人把那顆 env 拿掉的那一天,這道閘會安靜地退化成裝飾,而三綠全綠。**
 */
export async function authorizeManagerMutation(): Promise<{
  sid: string;
  actorId: string;
} | null> {
  const base = await authorizeAdminMutation();
  if (!base) return null;
  if (!(await isActiveManager(base.actorId))) return null;
  return base;
}
