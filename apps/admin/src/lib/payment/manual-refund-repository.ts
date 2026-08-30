import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';
import { isUuid } from '../orders/note-action-state';
import type { ManualRefundFailureCode } from './manual-refund-action-state';
import type { ManualRefundRail } from './manual-refund-form';

// manual-refund-repository.ts — M-4b E10 D3:admin_record_manual_refund owner RPC 的唯一呼叫端。
//
// 🔴 本層不 throw、只回傳(同 cancel-repository.ts 的刻意選擇,理由逐字同款):
//    action 的主流程因此不需要包 try,「成功的 redirect() 被 catch 吞掉」那個坑在結構上不存在。
//
// 🔴 稽核由 RPC 同交易寫(D1 header 段自陳),本層不碰 admin_audit_log。
//
// 🔴 **分類依 SQLSTATE、不解析 RPC message 的內容**;`rejected` 這一格額外把 message 原樣帶出去
//    (`staffMessage`),讓 action 層決定要不要顯示給員工(D1 的每句 RAISE 本身就是寫給員工看的)。
//
// ⛔ ~~業務 RAISE **全部**落 P0001(檔頭已確認**無其他顯式 ERRCODE**)~~
// 🔴🔴 **2026-08-31:那句話現在是假的 —— 而【它寫的時候是對的】。三件都留在這裡:**
//    · **它寫的時候是對的**:D1 那支 RPC 自己的**業務** RAISE 確實都落預設 P0001
//      (唯一顯式帶碼的是步1 隔離閘 `P8C01`,`20260820021000:169` —— 而它不是業務 RAISE,
//       且下方 map 本來就列著它)。
//      ⚠️ **我第一版訂正時把「業務」兩個字弄丟了**,寫成「每一句 RAISE 都是 P0001」——
//      🔴 **那樣訂正出來的新句子自己是假的。**📌 **訂正一句話時,最容易掉的是它的【限定詞】。**
//    · **被什麼弄假的**:`#866`(`20260824011000`)後來在**同一張表** `order_manual_refunds` 上掛了
//      一道 `BEFORE INSERT OR UPDATE **OR DELETE**` trigger(`20260824011000:259` 逐字),
//      而 `admin_record_manual_refund` 正是 INSERT 那張表的人
//      —— 🔴 **座標用【現行代】`20260823020000:447`,不是首建那一代**
//      (`bash scripts/latest-definition-of.sh admin_record_manual_refund` ⇒ newest=live=20260823020000;
//       我第一版引了 `20260820021000:298`,而那一代已被 `CREATE OR REPLACE` 換掉)
//      ⇒ 那道 trigger 的 SQLSTATE 會**穿過 RPC** 冒上來。
//    · **現在是什麼**:除了 P0001,還會收到 `PCM01` / `PCM02` / `PCM03`(下方 map 已列)。
//    🔴 **⇒ 只寫「現在是什麼」的話,下一個人會以為原作者搞錯了** ——
//       而真相是:**一句對的話被別人後來加的東西弄假,而它不會紅。**
//    📌 **判別句:這張表【還有誰會寫它】?那些人各自會吐什麼 SQLSTATE?**

export interface RecordManualRefundArgs {
  orderId: string;
  rail: ManualRefundRail;
  refundAmount: number;
  reason: string;
  /** ISO 字串。 */
  occurredAt: string;
  actor: string;
  /** 冪等鍵 = 表單帶回的一次性 token。 */
  requestId: string;
}

export type RecordManualRefundOutcome =
  | { ok: true; refundId: string; idempotent: boolean }
  | {
      ok: false;
      code: ManualRefundFailureCode;
      sqlstate: string | null;
      /** 已截 200 字、不含 details/hint,呼叫端記 log 用。 */
      logMessage: string;
      /** 僅 code==='rejected' 時有值:RPC 的 message 原文,action 層顯示給員工用。 */
      staffMessage: string | null;
    };

/**
 * SQLSTATE → 失敗碼。🔴 用 Map 不用物件字面(memory `reference_js-index-lookup-hits-prototype-chain`,
 * 同 cancel-repository.ts 的理由)。
 */
const SQLSTATE_CLASSIFICATION = new Map<string, ManualRefundFailureCode>([
  ['P8C01', 'bug'], // 隔離閘(部署面設定錯)
  ['P0001', 'rejected'], // D1 那支 RPC 自己的業務 RAISE 走這條
  // 🔴 `#866` 的軌別上限 trigger(`pcm_manual_refund_rail_cap_guard`,`20260824011000`,**已 apply**)。
  //    三個都走 `rejected` ——`-48` 2026-08-31 裁【甲】,理由是本檔下游
  //    `manual-refund-action-state.ts:36-42` 逐字寫的那條:那些 RAISE **本身就是寫給員工看的指示**,
  //    罐頭化只會把「只剩 300 元可退」換成一句更含糊的話。
  // ⛔ **而它們原本落進 fallback 的 `error`,而 `error` 說「可以用同一張表單稍後再試」** ——
  //    🔴 那對三個碼【每一個】都是錯的下一步(超額再送 = 同一個金額 = 永遠失敗),
  //    而且它多講一句假話:三個都是 RAISE ⇒ 交易回滾 ⇒ **沒有任何東西在系統裡等著被回報**。
  ['PCM01', 'rejected'], // 現金/匯款軌別上限:「這張單在【現金/匯款】上目前只剩 % 元可退」
  ['PCM02', 'rejected'], // 算不出上限:「請找工程確認」(fail-closed,不宣稱知道原因)
  ['PCM03', 'rejected'], // 不能刪除:「要取消請用『作廢』」⇒ 員工要的是【換一個動作】
  // ⚠️ PCM03 那句 RAISE 的字面裡有 Markdown 星號,而畫面是純文字輸出 ⇒ 員工會看到兩個星號。
  //    已開列 `⟦b4-PCM03STARS⟧`(要動已 apply 的 migration ⇒ 要新的一支)。
  //    🔵 **不因此改走罐頭碼**:兩顆星星是【難看】,而罐頭化會讓他失去「要用作廢」這個指示。
  ['23514', 'bug'], // 表 CHECK 被觸發卻沒被 RPC 自己的 IF 攔到 = RPC 與表定義漂移
  ['23505', 'bug'], // UNIQUE(order_id, request_id):RPC 自己有冪等檢查,不預期還會冒出這個
  ['42501', 'bug'], // ACL 被撤
  ['PGRST202', 'bug'], // 簽章漂移 / 找不到函式
]);

/** 成功 payload 的鍵集合(D1 §7:jsonb_build_object('recorded', true, 'idempotent', <bool>, 'refund_id', <uuid>))。 */
const SUCCESS_PAYLOAD_KEYS = 'idempotent,recorded,refund_id';

function parseSuccessPayload(data: unknown): { refundId: string; idempotent: boolean } | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  if (Object.keys(data).sort().join(',') !== SUCCESS_PAYLOAD_KEYS) return null;
  const row = data as Record<string, unknown>;
  if (row.recorded !== true) return null;
  if (typeof row.refund_id !== 'string' || !isUuid(row.refund_id)) return null;
  if (typeof row.idempotent !== 'boolean') return null;
  return { refundId: row.refund_id, idempotent: row.idempotent };
}

function describeShape(data: unknown): string {
  if (typeof data !== 'object' || data === null) return `<${data === null ? 'null' : typeof data}>`;
  if (Array.isArray(data)) return `<array len=${data.length}>`;
  const entries = Object.entries(data)
    .map(([key, value]) => `${key}:${value === null ? 'null' : typeof value}`)
    .sort();
  return `{${entries.join(',')}}`.slice(0, 200);
}

/** 只取 message 前 200 字,不碰 details/hint(它們會帶整列內容)。 */
function summarize(value: unknown): string {
  return String((value as { message?: unknown } | null)?.message ?? '').slice(0, 200);
}

/**
 * 登記一筆非卡退款。**永不 throw**;所有失敗都收斂成 `ok: false`。
 *
 * 🔴 拋出型失敗一律歸 `error`(同 cancel-repository.ts 的理由):supabase-js 對 PostgREST
 * 的錯誤是回傳的,會拋的是傳輸層/環境層失敗 —— 那正是「請求可能已經到 PG 並 commit,只是
 * 回應斷在路上」,與 `error` 的員工訊息「可能已經寫進去了、用同一張表單重試會被冪等鍵認出」語意一致。
 */
export async function recordManualRefund(
  args: RecordManualRefundArgs,
): Promise<RecordManualRefundOutcome> {
  let data: unknown;
  let error: unknown;
  try {
    ({ data, error } = await createSupabaseServiceClient().rpc('admin_record_manual_refund', {
      p_order_id: args.orderId,
      p_request_id: args.requestId,
      p_actor: args.actor,
      p_rail: args.rail,
      p_refund_amount: args.refundAmount,
      p_reason: args.reason,
      p_occurred_at: args.occurredAt,
    }));
  } catch (thrown) {
    return {
      ok: false,
      code: 'error',
      sqlstate: null,
      logMessage: summarize(thrown),
      staffMessage: null,
    };
  }

  if (error) {
    const raw = (error as { code?: unknown }).code;
    const sqlstate = typeof raw === 'string' ? raw : null;
    const code = (sqlstate !== null && SQLSTATE_CLASSIFICATION.get(sqlstate)) || 'error';
    const message = summarize(error);
    return {
      ok: false,
      code,
      sqlstate,
      logMessage: message,
      staffMessage: code === 'rejected' && message !== '' ? message : null,
    };
  }

  const payload = parseSuccessPayload(data);
  if (payload === null) {
    return {
      ok: false,
      code: 'bug',
      sqlstate: null,
      logMessage: `admin_record_manual_refund 回傳形狀漂移:${describeShape(data)}`,
      staffMessage: null,
    };
  }

  return { ok: true, ...payload };
}
