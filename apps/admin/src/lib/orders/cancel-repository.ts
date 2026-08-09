import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';
import { isUuid } from './note-action-state';
import type { CancelSentCode } from './cancel-action-state';
import type { CancelItemInput, CancelReasonCode } from './cancel-form';

// cancel-repository.ts — M-4b E10 A9d2-2b:`admin_cancel_order` owner RPC 的唯一呼叫端。
//
// 🔴🔴 **本片對 plan 的一處明文偏離,已申報**(關卡2 codex must-fix 要求講清楚):
//    plan §4.1(`docs/specs/2026-08-05-e10-cancel-ui-wire-plan.md:212`)逐字寫
//    「任一不符 → `OrderCancelCallerBugError`」= 用**拋例外**表達形狀漂移。
//    本片改成**回傳** `{ ok: false, code: 'bug' }`。
//    - **員工看到的行為完全相同**:兩者都判 `bug`、都導頁(D5 之後由帳本核對面板說「寫進去了沒有」;在那之前畫面空白)。差別只在機制。
//    - 換掉的理由:拋例外就得在 action 裡包 try。**不是「有 try 就會吞 redirect」**
//      (關卡2 R2 更正我原本寫太滿的字面)—— 窄包住 repository 那一個 await 就不會。
//      但那個窄 try 得由每個未來的呼叫端自己記得維持,而漏掉的代價是把成功的 `redirect()`
//      拋出的 NEXT_REDIRECT 一起吃掉(備註片 `note-actions.ts:28-30` 就是這樣被教訓的)。
//      回傳形讓這件事**沒有可以記錯的地方**。
//      形狀漂移這一支**真的可能已經 commit**(驗證發生在 RPC 成功 RETURN 之後),
//      把它變成未處理的 500 會連原 token 一起弄丟,員工就再也對不回那一次。
//    🔴 **要改回拋例外的人請連 action 一起改**,不要只改這一層。
//
// 🔴 **本層不 throw、只回傳**(與備註片 `note-repository.ts` 的 throw 形相反,是刻意的):
//    action 的**主流程(RPC / redirect)因此一行 try 都不需要**(唯一的窄 try 在 `safeRevalidate()`,
//    包的是 `revalidatePath`、碰不到 `redirect()`),而「成功的 `redirect()` 被 catch 吞掉」那個坑
//    (plan §2 慣例 2、備註片 `note-actions.ts:28-30` 的教訓)在結構上就不存在 ——
//    不是靠下一個人記得把 `redirect()` 寫在 try 外面。
//
// 🔴 稽核由 RPC **同交易**寫,本層不碰 `admin_audit_log`(同備註片)。
//
// 🔴 **失敗一律帶著可觀測資訊回去**:plan §4.2 的補償條款要求 `P0001` 路徑必須把
//    `error.message` 記進 log —— 因為 `P0001` **同時**是「這張單不能取消」與「我們送了畸形參數」
//    的 SQLSTATE(全函式只有隔離閘顯式帶 `P8C01`),光看碼分不出來。
//    ⚠️ 只帶 `message` 前 200 字,**不帶** `details` / `hint`:PG 的 DETAIL 會把整列內容
//    (含員工打的取消說明)帶進 Vercel log。記 log 的動作在 action,本層只負責把字串遞出去。

/** 呼叫 RPC 需要的全部參數。🔴 逐欄具名送、不 spread(plan §2 慣例 4)。 */
export interface CancelOrderArgs {
  orderId: string;
  reasonCode: CancelReasonCode;
  /** 🔴 `other` 才有值、其餘恆 null(RPC `20260805100000:134-145` 的配對 RAISE)。 */
  reasonDetail: string | null;
  /** 🔴 `null` = 整單取消(送 `p_items: null`);非 null = 部分取消、且必為非空。 */
  items: CancelItemInput[] | null;
  actor: string;
  /** 冪等鍵 = 表單帶回的一次性 token(server 渲染表單帶下來的 `request_token`)。 */
  requestToken: string;
}

export type CancelOrderOutcome =
  | {
      ok: true;
      cancellationId: string;
      /** true = 這次沒有新寫入,RPC 認出同鍵同 payload 而吸收掉了。 */
      idempotent: boolean;
      /** 整單是否因此關閉(部分取消把最後一件也取消掉時也會 true)。 */
      closed: boolean;
    }
  | {
      ok: false;
      code: CancelSentCode;
      /** PostgREST 回的 SQLSTATE;拋出型失敗與形狀漂移沒有這個值。 */
      sqlstate: string | null;
      /** 已截到 200 字、確定不含 `details`/`hint` 的字串,呼叫端直接記 log。 */
      logMessage: string;
    };

/**
 * SQLSTATE → 失敗碼(plan §4.3 表逐格)。
 *
 * 🔴 **用 `Map` 不用物件字面**(memory `reference_js-index-lookup-hits-prototype-chain`):
 * `obj[error.code]` 在 code 剛好是 `constructor` / `toString` 時會取到原型鏈上的**函式**,
 * 那是 truthy ⇒ `?? 'error'` 接不住(它只接 null/undefined),分類結果會變成一個函式。
 * `Map.get()` 沒有這條路。
 *
 * 🔴 `P0001` → `rejected` 是**保守**的一格:它同時涵蓋業務拒絕與呼叫端送了畸形參數
 * (plan §4.2 逐字)。分不出來時歸「這張單不能取消」比歸「系統壞了」安全 ——
 * 代價是呼叫端 bug 會被誤說成業務拒絕,所以那條 log 是必要的、不是加值。
 */
const SQLSTATE_CLASSIFICATION = new Map<string, CancelSentCode>([
  ['P8C01', 'bug'], // 隔離閘(部署面設定錯,重按不會好)
  ['P0001', 'rejected'], // RPC 全部 RAISE
  ['55P03', 'retry'], // SET lock_timeout='5s'
  ['40P01', 'retry'], // 死結
  ['23514', 'bug'], // 寫 items 觸發 A4a 重算 → A1 CHECK
  ['22003', 'bug'], // 數值溢位
  ['42501', 'bug'], // ACL 被撤
  ['PGRST202', 'bug'], // 簽章漂移 / 找不到函式(PostgREST schema cache,不是 42501)
  // 🔴 **plan §4.3 的表沒有這一格,是本片依 DB 端的明文加的**(關卡2 codex must-fix):
  //    建表檔逐字「(order_id,key) UNIQUE=不可達 backstop、誠實認列不設格;**任何 23505=真異常
  //    fail-loud**」(`20260804180000_m4b_e10_a8a1_admin_cancel_order.sql:20-21`),
  //    而部分取消的 header INSERT(`20260805100000:428`)確實冒得出它。
  //    落進未知碼那格會變成 `error` =「你自己確認後再決定要不要重送」,
  //    但 DB 說它是真異常 ⇒ 該講的是「通知系統維護、不要重複按」。
  ['23505', 'bug'],
]);

/** plan §4.1 的鍵集合,排序後逐字比對用。 */
const SUCCESS_PAYLOAD_KEYS = 'cancellation_id,cancelled,closed,idempotent';

/**
 * 成功 payload 形狀全集(plan §4.1 五條,逐條)。不符 → null,呼叫端翻成 `bug`。
 *
 * 🔴 ②的「鍵集合**恰等**」而不是「包含」是刻意的:RPC 日後加鍵要**轉紅讓人來看**,
 * 不是靜默忽略。這條也是 `bug` 裡唯一**真的可能已經寫進去**的那一支 ——
 * 它發生在 RPC 成功 RETURN **之後**(逐支歸類見 `cancel-action-state.ts:64-70`)。
 */
function parseSuccessPayload(
  data: unknown,
): { cancellationId: string; idempotent: boolean; closed: boolean } | null {
  // ① object 且非 null 非陣列
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  // ② 鍵集合恰為四個
  if (Object.keys(data).sort().join(',') !== SUCCESS_PAYLOAD_KEYS) return null;
  const row = data as Record<string, unknown>;
  // ③ cancelled === true(RPC 只在成功路徑 RETURN,false 不是它的產物)
  if (row.cancelled !== true) return null;
  // ④ cancellation_id 是 uuid 字串
  if (typeof row.cancellation_id !== 'string' || !isUuid(row.cancellation_id)) return null;
  // ⑤ 兩個旗標都是 boolean
  if (typeof row.idempotent !== 'boolean' || typeof row.closed !== 'boolean') return null;
  return {
    cancellationId: row.cancellation_id,
    idempotent: row.idempotent,
    closed: row.closed,
  };
}

/**
 * 把未知形狀描述成「鍵名 + 型別」,**不含任何值**。
 * 非 object 只回型別名(值本身可能就是 RPC 塞回來的字串內容)。
 */
function describeShape(data: unknown): string {
  if (typeof data !== 'object' || data === null) return `<${data === null ? 'null' : typeof data}>`;
  if (Array.isArray(data)) return `<array len=${data.length}>`;
  const entries = Object.entries(data)
    .map(([key, value]) => `${key}:${value === null ? 'null' : typeof value}`)
    .sort();
  return `{${entries.join(',')}}`.slice(0, 200);
}

/** 只取 `message` 前 200 字。🔴 不碰 `details`/`hint`(它們會帶整列內容)。 */
function summarize(value: unknown): string {
  return String((value as { message?: unknown } | null)?.message ?? '').slice(0, 200);
}

/**
 * 取消一張單(整單或部分)。**永不 throw**;所有失敗都收斂成 `ok: false` 的四支碼。
 *
 * 🔴 **拋出型失敗一律歸 `error`**(plan §4.3 表末列「其他 throw」):supabase-js 對
 * PostgREST 的錯誤是**回傳**的,會拋的是傳輸層/環境層失敗(網路斷、fetch abort、
 * 建 client 時 env 缺)—— 那正是「請求可能已經到 PG 並 commit,只是回應斷在路上」,
 * 與 `error` 的員工訊息「取消可能已經寫進去了」語意一致。
 * ⇒ 拋出物件**即使帶 `code` 也不查表**:查了會把「回應遺失」講成「這張單不能取消」。
 */
export async function cancelOrder(args: CancelOrderArgs): Promise<CancelOrderOutcome> {
  let data: unknown;
  let error: unknown;
  try {
    ({ data, error } = await createSupabaseServiceClient().rpc('admin_cancel_order', {
      p_order_id: args.orderId,
      p_reason_code: args.reasonCode,
      p_reason_detail: args.reasonDetail,
      p_items: args.items,
      p_actor: args.actor,
      p_idempotency_key: args.requestToken,
    }));
  } catch (thrown) {
    return { ok: false, code: 'error', sqlstate: null, logMessage: summarize(thrown) };
  }

  if (error) {
    const raw = (error as { code?: unknown }).code;
    const sqlstate = typeof raw === 'string' ? raw : null;
    return {
      ok: false,
      // 🔴 查無 = `error`。**理由不是「它可能已 commit」**(關卡2 codex nit 更正我原本寫的):
      //    走到這裡代表 PostgREST 回了 SQLSTATE = PG 那筆交易**已中止**,不可能已 commit;
      //    真正有 commit 不確定性的是上面 catch 到的傳輸層 throw。
      //    歸 `error` 是因為**我們不知道它是什麼**,而 `error` 的畫面最保守(叫他去確認再決定)。
      //    已知該 fail-loud 的碼(如 `23505`)要進上面那張表,不准靠這個 fallback 兜。
      code: (sqlstate !== null && SQLSTATE_CLASSIFICATION.get(sqlstate)) || 'error',
      sqlstate,
      logMessage: summarize(error),
    };
  }

  const payload = parseSuccessPayload(data);
  if (payload === null) {
    return {
      ok: false,
      code: 'bug',
      sqlstate: null,
      // 🔴 **只記鍵名與型別、不記值**(code-reviewer nit):走到這裡的前提就是「形狀未知」,
      //    而「未知的東西不含員工輸入」是一句自打嘴巴的斷言 —— RPC 日後若回一整列
      //    (含 `reason_detail`),整包塞進 log 就是把員工打的字送進 Vercel。
      //    鍵名 + typeof 足以診斷漂移,那才是這行的用途。
      logMessage: `admin_cancel_order 回傳形狀漂移:${describeShape(data)}`,
    };
  }

  return { ok: true, ...payload };
}
