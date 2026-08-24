import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';
import { isUuid } from './note-action-state';
import type { ManualOrderValues } from './manual-order-form';

// manual-order-repository.ts — M12-A1:`admin_create_manual_order`(#858)的**唯一呼叫端**。
//
// 體例逐字沿用同目錄 `cancel-repository.ts`(同一支 owner-RPC 形狀):
//   · **永不 throw**,所有失敗收斂成 `ok: false` 的碼
//   · 逐欄具名送、不 spread
//   · 只把 `message` 前 200 字遞出去,**不碰 `details` / `hint`**(PG 的 DETAIL 會把整列內容
//     帶進 Vercel log,而手動單那一列含客人姓名 / 電話 / 地址)
//   · 稽核由 RPC 同交易寫(`G9`),本層不碰 `admin_audit_log`
//
// 🔴 **本層不接受外部傳入的 actor 以外的任何身分欄** —— actor 由呼叫端(server action)
//    自 `authorizeAdminMutation().actorId` 取得後傳入。本層不去猜、也不從表單值裡撈。
//
// 🔴 **`p_actor` 不進內容指紋**(RPC COMMENT 逐字):誰按送出不改變那張單
//    ⇒ 同事拿同一顆 `manualRequestId` 重送同一包內容,應得 `idempotent: true`。

/**
 * 送出這次建單需要的全部東西。
 * `values` 直接吃 `parseManualOrderForm()` 的產物 —— 本層**不再驗一次形狀**,
 * 那是表單層的工作(`manual-order-form.ts`),而 RPC 的十道守門是最終防線。
 */
export interface CreateManualOrderArgs {
  values: ManualOrderValues;
  /** 🔴 必來自 `authorizeAdminMutation().actorId`,**不得來自表單**。 */
  actor: string;
}

/**
 * 失敗碼。**三個是 `#858` 的合約碼,而它們的下一步互不相同**(RPC COMMENT 逐字):
 *
 * | 碼 | 機器該做 | 為什麼不能混 |
 * |---|---|---|
 * | `concurrent` | **保留同一顆 `manualRequestId` 原樣重送** | 那一刻很可能已建好一張單;換新 id 會建出**第二張真訂單** |
 * | `mismatch`   | **不要重送** | 這顆鍵已經建過一張單,而內容不一樣 |
 * | `exhausted`  | **不要重送** + 告警 | 系統產不出單號,重按不會好 |
 */
export type ManualOrderSentCode =
  | 'concurrent'
  | 'mismatch'
  | 'exhausted'
  | 'rejected'
  | 'bug'
  | 'error';

export type CreateManualOrderOutcome =
  | {
      ok: true;
      orderId: string;
      displayId: string;
      /** true = 這次沒有新寫入,RPC 認出同鍵同內容而吸收掉了(**不是**建了第二張)。 */
      idempotent: boolean;
    }
  | {
      ok: false;
      code: ManualOrderSentCode;
      /** PostgREST 回的 SQLSTATE;拋出型失敗與形狀漂移沒有這個值。 */
      sqlstate: string | null;
      /**
       * RPC `RAISE … USING CONSTRAINT = …` 帶的 token。
       *
       * 🔴 **未確認:PostgREST 到底有沒有把 `constraint` 放進錯誤物件,我沒有真的打過一發。**
       *    缺的那一道檢查 = 對正式庫(或拋棄式 PG + PostgREST)真的觸發一次 `P858A`,
       *    看回來的 JSON 有沒有這個欄位。
       * ⇒ **所以分類【不依賴它】**(看 `SQLSTATE_CLASSIFICATION`);它只是遞出去給人看的。
       *    它是 `null` 不代表 RPC 沒帶,可能只是這一層拿不到。
       */
      constraint: string | null;
      /** 已截到 200 字、確定不含 `details`/`hint` 的字串,呼叫端直接記 log。 */
      logMessage: string;
    };

/**
 * SQLSTATE → 失敗碼。
 *
 * 🔴 **用 `Map` 不用物件字面**(同 `cancel-repository.ts`):`obj[code]` 在 code 剛好是
 * `constructor` / `toString` 時會取到原型鏈上的函式,那是 truthy ⇒ `?? 'error'` 接不住。
 *
 * 🔴 `P0001` **不在這張表裡** —— 它同時是「員工輸入被逐格拒絕」與「產號用盡」兩件事,
 *    要看訊息才分得出來(見 `classifyP0001`)。放進表裡會把後者靜靜歸成前者。
 */
const SQLSTATE_CLASSIFICATION = new Map<string, ManualOrderSentCode>([
  ['P858A', 'concurrent'], // pcm_858_manual_order_concurrent_request
  ['P858B', 'mismatch'], // pcm_858_manual_order_payload_mismatch
  ['55P03', 'error'], // lock_timeout
  ['40P01', 'error'], // 死結
  ['23514', 'bug'], // 表上的 CHECK(白名單鍵 / 金額)
  ['23505', 'bug'], // UNIQUE:建表檔明訂「任何 23505 = 真異常 fail-loud」
  ['22003', 'bug'], // 數值溢位
  ['42501', 'bug'], // ACL 被撤
  ['PGRST202', 'bug'], // 簽章漂移 / 找不到函式(PostgREST schema cache)
]);

/**
 * 🔴 產號用盡的把手**只是訊息裡的一個字串**,不是機器讀得懂的碼。
 *
 * 座標:`supabase/migrations/20260824020000_m4b_858_admin_create_manual_order.sql:565`
 * 逐字 `' (pcm_display_id_exhausted)' USING ERRCODE = 'P0001'`
 * ⇒ 它的 SQLSTATE 是**通用的 `P0001`**,`CONSTRAINT` 是空的
 *   (同一支函式的 `P858A` / `P858B` 兩個都有專用 SQLSTATE + token,**而這個守的事更嚴重**)。
 *
 * ✅ 裁定(主視窗 2026-08-24,M12-A plan §1-b F-a):**不補 `P858C`,本片用字串比對**。
 * 🔴 **失效條件**:那支 RPC 若因別的原因需要再開一輪審查 ⇒ 補 `P858C` 當場變成對的、順手補。
 * ⚠️ **本常數必須有一格測試釘住** —— RPC 那句訊息一被改,這裡就**靜靜地**改走 `rejected`,
 *    而 `rejected` 的畫面會叫員工「看訊息自己改」,他改不動(那不是他的輸入的問題)。
 */
export const DISPLAY_ID_EXHAUSTED_TOKEN = 'pcm_display_id_exhausted';

/** `P0001` 兩義:訊息含產號用盡的 token ⇒ `exhausted`,其餘 ⇒ `rejected`(員工看得懂的逐格拒絕)。 */
function classifyP0001(message: string): ManualOrderSentCode {
  return message.includes(DISPLAY_ID_EXHAUSTED_TOKEN) ? 'exhausted' : 'rejected';
}

/** 成功 payload 的鍵集合,排序後逐字比對用(RPC `:491` 與 `:629` 兩處 RETURN 皆為這三鍵)。 */
const SUCCESS_PAYLOAD_KEYS = 'display_id,idempotent,order_id';

/**
 * 成功 payload 形狀全集。不符 → null,呼叫端翻成 `bug`。
 *
 * 🔴 「鍵集合**恰等**」不是「包含」:RPC 日後加鍵要**轉紅讓人來看**,不是靜默忽略。
 *    而這一支是 `bug` 裡唯一**真的可能已經寫進去**的 —— 它發生在 RPC 成功 RETURN 之後。
 */
function parseSuccessPayload(
  data: unknown,
): { orderId: string; displayId: string; idempotent: boolean } | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  if (Object.keys(data).sort().join(',') !== SUCCESS_PAYLOAD_KEYS) return null;
  const row = data as Record<string, unknown>;
  if (typeof row.order_id !== 'string' || !isUuid(row.order_id)) return null;
  if (typeof row.display_id !== 'string' || row.display_id === '') return null;
  if (typeof row.idempotent !== 'boolean') return null;
  return { orderId: row.order_id, displayId: row.display_id, idempotent: row.idempotent };
}

/** 把未知形狀描述成「鍵名 + 型別」,**不含任何值**(值可能就是客人的姓名地址)。 */
function describeShape(data: unknown): string {
  if (typeof data !== 'object' || data === null) return `<${data === null ? 'null' : typeof data}>`;
  if (Array.isArray(data)) return `<array len=${data.length}>`;
  const entries = Object.entries(data)
    .map(([key, value]) => `${key}:${value === null ? 'null' : typeof value}`)
    .sort();
  return `{${entries.join(',')}}`.slice(0, 200);
}

/** 只取 `message` 前 200 字。🔴 不碰 `details`/`hint`。 */
function summarize(value: unknown): string {
  return String((value as { message?: unknown } | null)?.message ?? '').slice(0, 200);
}

function readConstraint(value: unknown): string | null {
  const raw = (value as { constraint?: unknown } | null)?.constraint;
  return typeof raw === 'string' && raw !== '' ? raw : null;
}

/**
 * 建一張手動單。**永不 throw**。
 *
 * 🔴 **拋出型失敗一律歸 `error`**:supabase-js 對 PostgREST 的錯誤是**回傳**的,會拋的是
 * 傳輸層 / 環境層失敗(網路斷、fetch abort、建 client 時 env 缺)—— 那正是
 * 「請求可能已經到 PG 並 commit,只是回應斷在路上」。
 * ⇒ 拋出物件**即使帶 `code` 也不查表**:查了會把「回應遺失」講成「你的輸入有問題」。
 * ⇒ 而這條路上的正確下一步與 `concurrent` 相同 —— **保留同一顆 id 重送**,由 RPC 的
 *   冪等格去分辨那一發到底寫進去了沒有。**這正是那顆 id 存在的理由。**
 */
export async function createManualOrder(
  args: CreateManualOrderArgs,
): Promise<CreateManualOrderOutcome> {
  const { values, actor } = args;
  let data: unknown;
  let error: unknown;
  try {
    ({ data, error } = await createSupabaseServiceClient().rpc('admin_create_manual_order', {
      p_customer_user_id: values.customerUserId,
      p_manual_request_id: values.manualRequestId,
      p_actor: actor,
      p_order_source: values.orderSource,
      p_payment_channel: values.paymentChannel,
      p_shipping_method: values.shippingMethod,
      p_ship_to: values.shipTo,
      p_invoice: values.invoice,
      p_shipping_fee: values.shippingFee,
      p_lines: values.lines,
    }));
  } catch (thrown) {
    return {
      ok: false,
      code: 'error',
      sqlstate: null,
      constraint: null,
      logMessage: summarize(thrown),
    };
  }

  if (error) {
    const raw = (error as { code?: unknown }).code;
    const sqlstate = typeof raw === 'string' ? raw : null;
    const logMessage = summarize(error);
    // 🔴 查無 = `error`(**不是** `rejected`):走到這裡代表我們不知道它是什麼,
    //    而 `error` 的畫面最保守 —— 叫員工去確認那張單建出來了沒有再決定。
    //    已知該 fail-loud 的碼要進上面那張表,不准靠這個 fallback 兜。
    const code: ManualOrderSentCode =
      sqlstate === 'P0001'
        ? classifyP0001(logMessage)
        : (sqlstate !== null && SQLSTATE_CLASSIFICATION.get(sqlstate)) || 'error';
    return { ok: false, code, sqlstate, constraint: readConstraint(error), logMessage };
  }

  const payload = parseSuccessPayload(data);
  if (payload === null) {
    return {
      ok: false,
      code: 'bug',
      sqlstate: null,
      constraint: null,
      // 🔴 只記鍵名與型別、不記值:走到這裡的前提就是「形狀未知」,
      //    而「未知的東西不含客人資料」是一句自打嘴巴的斷言。
      logMessage: `admin_create_manual_order 回傳形狀漂移:${describeShape(data)}`,
    };
  }

  return { ok: true, ...payload };
}
