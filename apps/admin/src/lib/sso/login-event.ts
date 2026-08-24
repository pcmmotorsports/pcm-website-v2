// login-event.ts — 把 SSO 登入事件寫進自家 DB(M-4b;Sean 2026-08-18 `Q04=乙` + 三個岔路全拍)。
//
// 🔴 **為什麼**:Vercel Hobby 的 runtime log 保留 = **1 小時**,而 log drain 要 Pro
//    ⇒ 出事那天要回答「誰、什麼時候、從哪裡登入了後台」,**一小時之後沒有任何地方查得到**。
//    `security-log.ts` 那半仍然照寫(它是那一小時內的軌跡),本檔加的是**留得住的那一半**。
//
// 🔴 **為什麼是【一支函式同時做兩件】**:呼叫端有 **5 處**(`api/sso/callback/route.ts`,4 失敗 + 1 成功)。
//    若 console log 與 DB 寫入是兩個函式,**下一個人加第六處時很可能只叫其中一個**,
//    而那時 DB 少一列**不會有任何東西紅**。
//    ⚠️ **它保證的是「依序嘗試兩邊」,不是「兩邊都成功」**(codex 關卡2 收窄我原本寫的
//    ~~「讓只做一半在型別上就不成立」~~ —— 那是假的:`logSsoLogin` 仍然 export 得出去,
//    別的檔照樣 import 得到;真正擋住繞道的是測試裡那格 source-contract,而它也有天花板,見該格註解)。
//
// 🔴 **best-effort:不讓寫紀錄拖垮登入**。DB 掛掉 / 表還沒 apply / 權限不對 ⇒ 吞掉,登入照常完成。
//    (那張表 apply 之前,這裡每次都會走失敗分支 —— **那是預期的**,不是壞了。)
//    ⚠️ **兩個保護是分開的**(codex 關卡2 R1 高1):
//      · console 那半**自己包 try/catch** —— ~~原本它在 try 外~~,它若 throw 會直接中斷 route。
//      · DB 那半**有硬逾時** —— ~~原本沒有~~;連線一直不結束時,五條路徑都會卡到平台把函式殺掉,
//        **成功路徑即使 session cookie 已經簽好,response 也送不出去**。
//    ⚠️ 逾時只**解開 route 的等待**,不保證底層連線被取消(那要 adapter 支援 abort signal)。
//
// 🔴 **PII**:`ip` / `user_agent` 是 PII。它們**只進 DB 那一列**,
//    **絕不進 console log、絕不進回應**(鏡像 PRD §7 對 email 的規則)。
//    ⚠️ **正確的說法是「不輸出那個錯誤」,不是「不進錯誤訊息」**(codex 關卡2:DB 的 error message
//      本來就可能夾帶整列資料,我們控制不了它的內容,只控制得了**不把它印出去**)。
//
// @see supabase/migrations/20260818190000_m4b_admin_sso_login_events.sql
// @see docs/specs/2026-08-18-admin-login-events-to-own-db-draft.md §7
import 'server-only';
import { isIP } from 'node:net';

import { createSupabaseServiceClient } from '@pcm/adapters/server';

import { logSsoLogin, type SsoLoginLogFields, type SsoLoginOutcome } from './security-log';

/** `user_agent` 落表上限(鏡像 `charge-actions.ts` 對 UA 的 1024 截斷)。 */
const UA_MAX = 1024;

/** DB 寫入的硬逾時。登入是互動路徑,寫紀錄不值得讓客人多等。 */
const DB_WRITE_TIMEOUT_MS = 1_500;

/**
 * 從 request headers 取來源 IP。
 *
 * 🔴🔴 **取哪一段是【app 層的決定】,而這個決定會影響鑑識結論** ——
 *    proxy 後面拿到的常常是一串(`client, proxy1, proxy2`),這裡取**第一段**。
 * ```
 * x-vercel-forwarded-for  ← Vercel 自己填的，最可信（優先）
 * x-forwarded-for         ← 🔴 客戶端可控：攻擊者可以自己塞一個假的
 * x-real-ip               ← 同上
 * ```
 * ⇒ **不要把這一欄讀成「這就是客人的 IP」。** 它是 best-effort 的鑑識線索,不是身分證據。
 *    (同一句話也寫在 migration 的 `COMMENT ON COLUMN`,兩處都寫是刻意的。)
 */
export function extractClientIp(headers: Headers): string | null {
  const raw =
    headers.get('x-vercel-forwarded-for') ??
    headers.get('x-forwarded-for') ??
    headers.get('x-real-ip');
  const first = raw?.split(',')[0]?.trim();
  // 🔴 **真的 parse,不是看字元**(codex 關卡2 R1 高3:~~原本只檢查字元集合~~,
  //    `999.999.999.999` / `::::` 這種**字元全合法而語法錯**的值會通過,
  //    然後讓 PG 的 `inet` 拒絕**整筆 INSERT** ⇒ 連 outcome 都遺失)。
  //    `node:net` 的 `isIP` 回 0 = 兩種都不是。
  if (!first || isIP(first) === 0) return null;
  // ⚠️ **驗過語法 ≠ 驗過真實性**:`x-forwarded-for` 是客戶端可控的,
  //    攻擊者可以送一個**語法完全合法的假 IP**。這一欄是鑑識線索,不是身分證據。
  return first;
}

/**
 * 🔴 **回傳值存在的理由:讓「DB 那半在期限內【確認成功了沒】」可觀測。**
 * ⚠️ **措辭要精準到這個地步**(codex 關卡2 R2):
 * ```
 * 'ok'        = 期限內【確認】寫成功
 * 'log_only'  = 期限內【沒有確認成功】 ← 🔴 不等於「DB 一定沒寫進去」
 *               逾時那一路尤其明顯：底層 insert 可能【逾時之後才成功】
 * ```
 * ⇒ 拿它當「這一筆沒進 DB」的依據會錯。它只能用來說「我沒等到確認」。
 *
 * 寫入失敗是**靜默**的(那是刻意的 PII 保護),而靜默的後果是:
 * **「有檢查 `{ error }`」與「沒檢查」在外部看起來一模一樣** —— 我實測過:
 * 把那道檢查整個拿掉,13 格測試**全綠**。
 * ⇒ 一個沒有任何可觀測差異的檢查,**它的測試必然是恆綠的**。
 * ⇒ 所以把結果回出來。呼叫端(route)可以繼續忽略它,而**測試分得出兩個世界**。
 */
export type SsoLoginRecordResult =
  | 'ok'
  /** DB 那半整個沒寫成(表沒 apply / 權限 / 逾時 / DB 掛)—— **設計上是靜默的**,見下方 catch 的註解。 */
  | 'log_only'
  /**
   * 🔴 **寫成了,但【沒有身分】** —— 第一發帶身分的 insert 被 DB 拒,退回不帶身分那版才寫成。
   * 今天唯一已知的成因:`20260824030000_m4b_b5a_sso_login_events_actor.sql` **還沒 apply**
   * ⇒ 那兩個欄不存在 ⇒ PostgREST 回錯。
   * ⚠️ 這個態**存在的理由不是容錯,是【讓那個世界有名字】** —— 見 `insert` 那段。
   */
  | 'ok_without_identity';

/**
 * 寫一筆登入事件:**先 console log(1 小時軌跡),再 best-effort 進 DB(留得住的那半)**。
 *
 * 呼叫端**只需要叫這一支**。
 * ⚠️ ~~「它保證兩邊不會只做一半」~~ **那句是假的**(codex 關卡2 R2 抓到的第八句):
 *    它保證的只有**依序嘗試兩邊** —— 任一邊仍可能失敗,而 DB 那邊失敗時**設計上就是只剩 console 那半**。
 */
/**
 * 🔴🔴 **supabase-js 的 `.insert()` 失敗時【回傳 `{ error }`,不會 reject】** ——
 * 表不存在、權限不對、PostgREST 回錯,`await` 全部正常完成、`catch` 一次都不會跑。
 * ⇒ 抽成一支,因為現在有**兩處**要問同一個問題(第一發、退回那一發)——
 *   而兩份同義判斷會漂,漂了之後要靠人去比對。
 */
function hasInsertError(result: unknown): boolean {
  return result !== null && typeof result === 'object' && 'error' in result && Boolean(result.error);
}

/** 🔴 值班撈這一行用的**固定前綴**(整支檔只有這裡定義它;grep 它就撈得到所有身分掉落事件)。 */
const IDENTITY_DROP_PREFIX = '[sso.login] 登入事件寫成了,但【沒有身分】—— ';

/** 🔴 兩發都失敗(整列不見)—— 比只丟身分嚴重,給它自己的前綴,值班分得開。 */
const ROW_LOST_PREFIX = '[sso.login] 登入事件【整列都沒寫成】—— ';
/** 🔴 DB 那半整段 throw / 逾時 —— 這條路 2026-08-24 之前**一聲都不叫**(codex B2-4)。 */
const DB_HALF_THREW_PREFIX = '[sso.login] 登入事件的 DB 那半整段拋出或逾時 —— ';

/**
 * 🔴🔴 **把「第一發被拒」的原因分類**(2026-08-24 codex B2-3 / B2-5)。
 *
 * ~~原本這裡無條件印「最可能的原因:migration 還沒 apply」~~ —— **那句在多數世界是錯的**,
 * 而 2026-08-24 本窗在拋棄式 PG + 真 PostgREST 上量到:migration **已 apply** 的世界裡,
 * `{kind:'user', staff_id:null}` / `{kind:'bogus'}` / `{kind:'fallback', staff_id:'x'}`
 * 三發**都**走到退回路徑、**都**印出那句「還沒 apply」⇒ 值班會被指去查一件已經做完的事。
 *
 * 🔴 **只有錯誤碼分得出是哪個世界**:
 *   · `PGRST204` / `42703` = 欄位不在 ⇒ **真的**是 apply 空窗(這一片預期中的暫態)
 *   · `23514`              = CHECK 被拒 ⇒ **應用層契約 bug**,身分形狀不合法(不是暫態,不會自己好)
 *   · 其餘(權限 `42501`、唯一鍵 `23505`、連線…)⇒ **不知道**,不要冒充知道
 *
 * ⚠️ **只讀 `code`,不讀 `message` / `details`** —— 那兩個欄位會夾帶出事那一行的內容
 *    (IP / UA / staff_id)。`code` 是列舉值,零 PII。這道紀律與下面 catch 的理由同源。
 */
function classifyIdentityInsertFailure(result: unknown): string {
  const code =
    result !== null && typeof result === 'object' && 'error' in result
      ? (result.error as { code?: unknown } | null)?.code
      : undefined;
  switch (code) {
    case 'PGRST204':
    case '42703':
      // 🔴 2026-08-24 codex R2-3 收窄:**這個碼有不只一個來源**,不要斷言成「尚未 apply」。
      //    · `PGRST204` 也可能是 **PostgREST 的 schema cache 還沒刷新**(apply 完到 reload 之間)
      //    · `42703` 也可能來自 **trigger 或別的地方**參照了不存在的欄
      //    ⇒ 所以這句只說**症狀**(找不到那個欄)與**最可能**的原因,並把第二個來源寫出來,
      //      而不是說「apply 之後不再出現」。~~那句話我改過一次,而它還是太寬。~~
      return '找不到身分欄(code PGRST204/42703)。最可能:20260824030000_m4b_b5a_sso_login_events_actor.sql 尚未 apply。⚠️ 第二個可能:已 apply 但 PostgREST 的 schema cache 還沒刷新(對它下 NOTIFY pgrst, \'reload schema\')。⚠️ 第三個可能:42703 來自 trigger 等其他未定義欄位。**先查 apply 狀態,再查 cache。**';
    case '23514':
      return '🔴 身分形狀被 DB 的 CHECK 拒絕(code 23514)⇒ 這是**應用層契約 bug**,不是 apply 空窗。送進來的 actorKind/actorStaffId 配對不合法(見 security-log.ts 的 SsoLoginLogFields)。它不會自己好。';
    default:
      return `帶身分的 insert 被拒,錯誤碼 ${typeof code === 'string' ? code : '(無)'} ⇒ 原因未分類。**不要假設是 apply 空窗**;去查該碼在 PostgREST/Postgres 的意思。`;
  }
}

export async function recordSsoLogin(
  outcome: SsoLoginOutcome,
  fields: SsoLoginLogFields,
  headers: Headers,
): Promise<SsoLoginRecordResult> {
  // ① console 那半。🔴 **自己包 try/catch**(codex 關卡2 R1 高1):它原本在 try 外,
  //    若 `console.info` 在某個 runtime 上 throw,整條登入路徑會被它中斷 —— 而它只是寫紀錄的。
  try {
    logSsoLogin(outcome, fields);
  } catch {
    // 連寫 log 都失敗就真的沒地方講了。登入照常。
  }

  // ② DB 那半。🔴 整段包 try/catch + **硬逾時**:登入結果優先。
  try {
    // ✅ **窄 cast 已拆**(2026-08-19,backlog `#652` 兩個條件都成立:表 apply 了、`database.types.ts` 重生成了)。
    //    ~~在型別回來之前,守門是測試裡逐字比對欄名那一格~~ ⇒ **現在編譯器自己看得到了**:
    //    把 `.from()` 或任一欄名加 `_TYPO` ⇒ `TURBO_FORCE=1 pnpm typecheck` 當場紅(拆完**當場表演過**)。
    //    (同一件事 `SupabaseEmailOutboxAdapter` 檔頭在 `#415` 記過:拆掉 cast 之後那個性質**才回來**。)
    // 🔴 **不送 `occurred_at`** —— DB 有 BEFORE INSERT trigger 無條件覆寫成 `now()`;
    //    送了也會被蓋掉。這裡不送,是為了讓「時間由 DB 決定」在**呼叫端**也讀得出來。
    const baseRow = {
      outcome,
      reason: fields.reason ?? null,
      amr: fields.amr ? fields.amr.join('+') : null,
      request_id: fields.requestId,
      source_app: 'quote',
      ip: extractClientIp(headers),
      user_agent: headers.get('user-agent')?.slice(0, UA_MAX) ?? null,
    };
    // 🔴 **B5-a 接線**:`actor_kind` / `actor_staff_id` 來自 SSO 票上經過簽章驗證的 `sub`。
    //    形狀與 CHECK 由 `20260824030000_m4b_b5a_sso_login_events_actor.sql` 強制
    //    (kind=user ⇒ 必有非空 staff_id;其餘 ⇒ 必須沒有)。這裡照著送,不自己補值。
    const identityRow = {
      actor_kind: fields.actorKind ?? null,
      actor_staff_id: fields.actorStaffId ?? null,
    };
    const client = createSupabaseServiceClient();
    const raced = <T>(pending: PromiseLike<T>) =>
      Promise.race([
        pending,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('db_write_timeout')), DB_WRITE_TIMEOUT_MS),
        ),
      ]);

    let wroteIdentity = true;
    let result = await raced(
      client.from('admin_sso_login_events').insert({ ...baseRow, ...identityRow }),
    );

    // ══ 🔴🔴 這一段是【部署時序】的安全網,不是容錯 ══════════════════════════
    // 問題:`20260824030000_…_actor.sql` 是**先 commit、後由 Sean 貼 SQL**。
    // 在那個空窗裡,帶身分的 insert 會被 DB 拒 —— 而本函式的失敗路徑**設計上是靜默的**
    // (下面 catch 的註解逐字:「表還沒 apply、權限不對、DB 掛掉、逾時,症狀都一樣」)
    // ⇒ 🔴 **不接這一段的話,那個空窗裡【每一次登入都會整列不見】** ——
    //    我們會拿「沒有身分」換成「連紀錄都沒有」,而**那比接線前更糟**。
    //
    // 🔴🔴 **而這段安全網的射程要講清楚(2026-08-24 R3-3,窗 F)**:
    //    ~~原本我把「那一列不會不見」寫成一句【無條件句】~~,而這個機制**只涵蓋一種失敗因**:
    //    ```
    //    ✅ 欄位不存在(migration 未 apply)⇒ 第一發被拒、退回那發【會成功】⇒ 那一列在
    //       📏 已實測(2026-08-24 真 PostgREST:PGRST204 ⇒ 回 {error} 不 throw ⇒ 退回成功)
    //    🔴 權限 / RLS 不對          ⇒ 【兩發都被拒】⇒ 那一列【真的會不見】, 只剩 console 那半
    //    🔴 逾時 / throw             ⇒ 不退回(刻意), 那一列狀態未知
    //    ```
    //    ⇒ **正確的說法是:「在【欄位不存在】那個世界裡,那一列不會不見。」**
    //    ⚠️ **權限那條路徑我沒有量過** —— 我量的是欄位不存在那條。**未量,不是已驗。**
    //    📌 母題(今天第二次):**一句話標了誠實缺口,不等於那句話本身被收窄了** ——
    //       缺口寫在別的地方,而承重句仍然在這裡以無條件的形式被讀。
    //
    // ⚠️ **為什麼不用一個 env 旗標**(我先想的是那個):旗標要有人記得在 apply 之後翻,
    //    而「有人記得翻」正是本 repo 反覆出事的那個半落地態。**這一段不需要任何人記得。**
    //
    // 🔴 **而它【會出聲】** —— 那是本段存在的主要理由,不是自救本身:
    //    退回去寫成功之後留一行固定字串,值班 grep 得到(前綴 `IDENTITY_DROP_PREFIX`)。
    //    🔴🔴 **2026-08-24 更正(codex B2-5 + 本窗實跑,兩條獨立證據)**:
    //       ~~原句「它在 apply 之後**永遠不再出現**」~~ **是錯的,不只是不精確。**
    //       📏 量到的:migration **已 apply** 的世界裡,`{user, null}` / `{bogus}` / `{fallback,'x'}`
    //          三發都走到退回路徑、都印出這一行 ⇒ 「apply 之後」它照樣出現。
    //       🔴 **2026-08-24 codex R2-3 又補一格**:連 `PGRST204` 自己都不只一個來源 ——
    //          已 apply 而 **PostgREST 的 schema cache 還沒刷新**時,它照樣回 PGRST204。
    //          ⇒ **任何「這個碼一定代表 X」的句子都要先問「這個碼還有沒有別的來源」。**
    //       ⇒ 現在改成**帶分類句**(見 `classifyIdentityInsertFailure`):
    //          它仍然會出現,但**說得出是哪一個世界** —— 而那才是值班要的。
    //    ⇒ 回答了「誰會第一個發現它沒接」:**看到這行字的人。**
    // ⚠️ **只在【insert 回了 error】時退回**,不在逾時/throw 時退 ——
    //    逾時再打一發會讓登入這條互動路徑的最壞延遲加倍,而那一發多半也會逾時。
    if (hasInsertError(result)) {
      // 🔴 **先分類再退回** —— 分類要讀第一發的 error,而下一行就會把 `result` 覆蓋掉。
      const cause = classifyIdentityInsertFailure(result);
      wroteIdentity = false;
      result = await raced(client.from('admin_sso_login_events').insert(baseRow));
      if (!hasInsertError(result)) {
        // 🔴 **零 PII、固定前綴 + 分類句**:不帶 DB 的 error 物件(它夾帶那一行的 IP 與 UA),
        //    也不帶 staff_id(那道紀律釘的是日誌,見 migration 檔頭)。只帶 `code`,它是列舉值。
        console.warn(IDENTITY_DROP_PREFIX + cause);
      } else {
        // 🔴🔴 **兩發都失敗 = 整列不見**,比「只丟身分」嚴重(codex B2-4)。
        //    2026-08-24 之前這個世界**一聲都不叫**;裝它之前先把本檔測試那道守門
        //    從【數次數】改成【驗內容】(主視窗 Q1 裁准,並要求先在兩個世界表演過)。
        //    ⚠️ `cause` 是分類過的固定句(只讀 error.code)⇒ 零 PII,不夾帶 message/details。
        console.warn(ROW_LOST_PREFIX + `帶身分與不帶身分的 insert 都被拒。第一發:${cause}`);
      }
    }

    // 🔴🔴 **supabase-js 的 `.insert()` 失敗時【回傳 `{ error }`,不會 reject】**
    //    (codex 關卡2 R1 高2)⇒ ~~只靠 catch~~ 根本抓不到主要失敗路徑:
    //    表不存在、權限不對、PostgREST 回錯 —— `await` 全部正常完成,`catch` 一次都不會跑。
    //    ⇒ 這裡**顯式檢查回傳值**,把它導向同一條靜默失敗的路。
    if (hasInsertError(result)) {
      return 'log_only'; // 🔴 **不丟 error 物件**:它帶著 DB 給的內容(= 那一行的 IP 與 UA)
    }
    return wroteIdentity ? 'ok' : 'ok_without_identity';
  } catch {
    // 🔴 零 PII:**不接住 error 物件** —— 接住了就會有人「順手」把它印出來,
    //    而 DB 的錯誤訊息會夾帶出事那一行的內容(= IP 與 UA)。
    // 🔴🔴 **2026-08-24 codex B2-4**:這條路(逾時 / 網路斷 / client 建不起來 / 任何 throw)
    //    原本**一聲都不叫**,而它與「寫成了」在呼叫端是同一個回傳值家族 ⇒ 值班撈不到它。
    //    ⚠️ **只印固定字串,不接住 error** —— 那道 PII 紀律不放寬(接住了就會有人順手印它,
    //       而 DB 的錯誤訊息夾帶出事那一行的 IP 與 UA)。放寬的只有「有沒有聲音」。
    console.warn(
      DB_HALF_THREW_PREFIX +
        '那一列可能不存在,也可能稍後才寫成。登入本身不受影響。',
    );
    // ⚠️ 並且:`Promise.race` 逾時**不會取消底層那發 insert**(codex B2-4)——
    //    它可能稍後才成功,而呼叫端已經拿到 `log_only`
    //    ⇒ **`log_only` 的意思是「我不知道」,不是「那一列不在」。**
    //    ⚠️ 代價寫在這裡:**寫入失敗是【靜默】的。** 表還沒 apply、權限不對、DB 掛掉、逾時,
    //       症狀都一樣:console 那半照常有、DB 那半沒有列。
    //       ⇒ 判別法是**比對兩邊**(Vercel log 有幾筆 vs DB 有幾列),不是等某個告警。
    //       (要不要做那個告警是另一題,未立案;plan §4「這個草案不解決什麼」已列。)
    return 'log_only';
  }
}
