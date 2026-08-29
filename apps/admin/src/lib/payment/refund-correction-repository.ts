import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';

// refund-correction-repository.ts — `#890` 片2a:`admin_correct_order_refund_verdict` 的唯一呼叫端。
//
// plan:`docs/specs/2026-08-29-890-manual-verdict-correction-ui-plan.md` §1c #2(v4)。
// RPC 本體:`supabase/migrations/20260814190000_m4b_e10_473b1_refund_manual_corrections.sql:191`
// (**已 apply 2026-08-14**,`supabase/APPLIED.tsv:233`;ACL 同檔 `:392-395` GRANT 給 service_role)。
//
// 🔴🔴 **不照抄 `refund-repository.ts` 的 `isRpcRaise`**(plan v4 §1d「v4 折 A3」):
//    那支只認 `P0001` 與 `^P7C`(`refund-repository.ts:99-103` 逐字),
//    而本 RPC 的錯誤面走 **P2B42 / P2B43 / P2B44 / P8C01 / P8C03**
//    ⇒ 照抄的話,**CAS 失敗會落進「非 RAISE」那條分支** ⇒ 被當成一個不明的 DB 錯誤。
//    📌 而那不只是文案問題:CAS 失敗是**員工要重看一次現況**的訊號,不是「稍後再試」。
//
// 🔴 **兩族錯誤必須分得開**(同上,A3 第三點):
//    · **RPC 拒絕**(SQLSTATE RAISE)= 業務結果 ⇒ 員工看得懂的文案、他有下一步
//    · **協定漂移**(回傳形狀不對 / 未知碼)= **我們的 bug** ⇒ 不是業務錯
//    ⇒ 兩族用同一句文案 ⇒ 員工會對著一個 bug 一直重試。
//
// 🔴 **而 23505 是第三族,它不是 RAISE**(plan v4 §1f「v4 折 A6」):
//    RPC 檔頭 `:309-313` 逐字把一條義務交給呼叫端 ——
//    `request_id` 的唯一性是**全域**的、不受父列鎖序列化 ⇒ 兩個交易對**不同** refund
//    同時用同一把 token 時,後到者撞 UNIQUE 得 **23505**
//    ⇒ 呼叫端要**換一把新 token 重試一次**。
//    ⚠️ 而它與 `DUPLICATE_REQUEST`(P2B44 / 或成功回傳的冪等碼)是**兩條不同的路**:
//       23505      = 我們自己產的 token 撞了 ⇒ **靜靜換一把重送**,員工不必知道
//       DUPLICATE  = 員工重複送了同一筆 ⇒ **要告訴他「這筆已經處理過」**
//       ⇒ 兩者處置相反 ⇒ 本檔把它們分成兩個 result,**不合併**。

/** 本檔認得的 SQLSTATE(逐一對應 RPC 裡帶 `CONSTRAINT` 的那些 RAISE)。 */
export const CORRECTION_RPC_RAISE_CODES = ['P2B42', 'P2B43', 'P2B44', 'P8C01', 'P8C03'] as const;

/**
 * 🔴 **表層 CHECK 拒絕(codex 2026-08-29 must-fix 2)**。
 *
 * RPC 的 RAISE 不是唯一的拒絕路徑 —— **建表的 CHECK 會先動手**,而它吐 `23514`:
 * ```
 * :87-88  request_id  btrim <> '' / char_length <= 64
 * :75-76  reason      btrim <> '' / char_length <= 500
 * :81     actor       ~ '^[a-z0-9_]{1,64}$'
 * :69     corrected_to IN ('money_moved','no_money_moved')
 * ```
 * 🔴 而它與「平台故障」的差別是**誰能修**:
 * `23514` 幾乎一定是**送進來的值不合規**(員工打的理由太長、我們產的 token 太長)
 * ⇒ 那是一個**有下一步**的結果;而原樣拋會讓它長得像「系統壞了」⇒ 員工只會一直重按。
 * ⚠️ 而**本層不猜是哪一欄** —— `23514` 不帶欄名到 `error.code`,猜錯比不猜更糟。
 */
export const CORRECTION_INPUT_REJECT_CODE = '23514';

/**
 * 🔴 **這一族是【我們的 bug】,不是業務錯**(同一輪 must-fix 2 的另一半)。
 * `22P02` = 文字轉型失敗(例如一個不是 uuid 的字串被當成 `p_refund_id` 送進去)
 * ⇒ 那些 id **是我們自己產的、不是員工打的** ⇒ 它到不了 CHECK 就先炸。
 */
export const CORRECTION_CALLER_BUG_CODES = ['22P02'] as const;

/** `request_id` 撞全域 UNIQUE 時的索引名(RPC 檔頭 `:311` 逐字)。 */
export const CORRECTION_REQUEST_ID_UNIQUE = 'order_refund_manual_corrections_request_id_key';

/**
 * 🔴🔴 **`P2B44` 底下有三個 CONSTRAINT,而它們要員工做【三件不同的事】**
 * (codex 2026-08-29 must-fix 3;我原本把三個合併成一句「重看一次現況」)。
 * ```
 * pcm_rmc_cas_mismatch              :325  有人在你之前改過   ⇒ 重看一次現況 ✅ 那句對
 * pcm_rmc_target_not_manual_failed  :280  那一列根本不是人工判定失敗 ⇒ **重看一次也沒用**
 * pcm_rmc_request_id_reused         :304  token 撞到別筆     ⇒ **換一把重送**,員工不必知道
 * ```
 * 🔴 而 `error.code` **只有 SQLSTATE,沒有 CONSTRAINT 名** ⇒ 只能靠訊息裡的字面分辨。
 * ⚠️ **那是字面尺,它會因為 RPC 改字而斷** —— 所以配一發跨側測試釘住這三句還在。
 * 📌 而它斷掉的方向是 **fail-safe**:認不出來 ⇒ 落回 `cas_mismatch` 那句(叫他重看一次),
 *    那是三者裡最無害的一句 —— 它不會叫員工去做一件會出事的事。
 */
export const CORRECTION_P2B44_MARKERS = {
  targetNotManualFailed: '本支只更正人工判定',
  requestIdReused: '冪等鍵全域唯一',
  casMismatch: '期間有人改過',
} as const;

/** 協定漂移 = **我們的 bug**,不是業務錯。呼叫端不得把它映成「請重試」。 */
export class CorrectionCallerBugError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CorrectionCallerBugError';
  }
}

/** RPC 拒絕(帶 SQLSTATE 的 RAISE)。`sqlstate` 保留給呼叫端分文案。 */
export class CorrectionRejectedError extends Error {
  readonly sqlstate: string;
  constructor(sqlstate: string, message: string) {
    super(message);
    this.name = 'CorrectionRejectedError';
    this.sqlstate = sqlstate;
  }
}

export type CorrectionInput = {
  refundId: string;
  /** CAS 鏈頭;**`null` = 我看到的是「尚未被更正過」**(RPC `:315` 逐字支援 NULL)。 */
  expectedCorrectionId: string | null;
  /** 🔴 只能來自授權層,**不得讀表單**(plan §1d #11)。 */
  actor: string;
  reason: string;
  correctedTo: 'money_moved' | 'no_money_moved';
  requestId: string;
};

export type CorrectionResult =
  | { result: 'CORRECTED'; refundId: string; correctionId: string; seq: number; correctedTo: string }
  /** 同一把 token 重播同一筆 ⇒ RPC 自己的冪等回應(**不是** 23505)。 */
  | { result: 'DUPLICATE_REQUEST'; refundId: string; correctionId: string }
  /** token 撞到別筆的全域 UNIQUE ⇒ 呼叫端**換一把新 token 重試一次**。 */
  | { result: 'REQUEST_ID_COLLISION' };

function errCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

/**
 * 給**人看**的訊息(截 200 字,免得把一整段 SQL 錯誤塞進畫面)。
 * 🛑 **不要拿它去比對字面** —— 見 `errRaw()`。
 */
function errText(error: unknown): string {
  return errRaw(error).slice(0, 200);
}

/**
 * 🔴🔴 **比對字面一律用這一支,不用 `errText`**(codex 2026-08-29 R3 抓到)。
 *
 * `errText` 截到 200 字,而 `pcm_rmc_request_id_reused` 那句的關鍵字面在訊息**後段**:
 * `request_id` 最長 64 字(`20260814190000:88`)⇒ 那句話會被推到第 200 字之後
 * ⇒ **截斷之後 `includes()` 比不到** ⇒ 那一發會落回「業務錯」那一族
 * ⇒ 而員工會看到一句他無法處理的話,**而系統本來只要換一把 token 重送就好**。
 *
 * 📌 **形狀值得記**:我自己寫的截斷,把我自己寫的比對**靜靜地關掉了** ——
 *    而兩邊各自都是對的:截斷是為了畫面,比對是為了分流。
 */
function errRaw(error: unknown): string {
  if (typeof error !== 'object' || error === null) return String(error);
  return String((error as { message?: unknown }).message ?? '');
}

/**
 * 更正一筆退款的人工判定。
 *
 * @throws {CorrectionRejectedError}  RPC 帶 SQLSTATE 拒絕(業務結果)
 * @throws {CorrectionCallerBugError} 回傳形狀不對 / 未知 result 碼(我們的 bug)
 * @throws 其他 未知的 DB 錯誤 —— **原樣拋**,不包裝成業務錯
 */
export async function correctRefundVerdict(input: CorrectionInput): Promise<CorrectionResult> {
  const fn = 'admin_correct_order_refund_verdict';
  const client = createSupabaseServiceClient();
  // 🔴🔴 **這個 cast 是刻意的,而理由不是「型別很煩」**(2026-08-29 typecheck 當場撞到):
  //    產生的型別 `database.types.ts:3743` 把 `p_expected_correction_id` 標成 **`string`**(非 null),
  //    而 RPC 本體 `20260814190000:315` 逐字寫著「**可為 NULL**,語意 = 我看到的是尚未被更正過」。
  //    ⇒ 📌 **那不是 schema 說的,是產生器的限制** —— Supabase 的型別產生器對每一個 RPC 參數
  //      一律吐非 null(它看不出 PL/pgSQL 裡哪些參數容許 NULL)。
  //    ⇒ 🔴 **而順著型別走的那條路是【傳空字串】** —— 那會讓 CAS 拿 `''` 去比對,
  //      而 `'' <> NULL` ⇒ **每一筆「尚未更正過」的列都會 CAS 失敗**,
  //      而畫面上那是一句「有人剛改過,請重看一次」—— **一個永遠不會成立的提示**。
  //    ⇒ 所以這裡**只放寬這一個參數**,不用 `any`、不 disable 任何檢查,並把理由留在原地。
  //    ✅ 而「null 真的被送出去」有一格測試釘著(`refund-correction-repository.test.ts`
  //       「送出去的參數逐格對上」那一格)⇒ 這個 cast 不是無人看守的。
  const args = {
    p_refund_id: input.refundId,
    p_expected_correction_id: input.expectedCorrectionId,
    p_actor: input.actor,
    p_reason: input.reason,
    p_corrected_to: input.correctedTo,
    p_request_id: input.requestId,
  };
  const { data, error } = await client.rpc(fn, args as typeof args & { p_expected_correction_id: string });

  if (error) {
    const code = errCode(error);
    // 🔴 23505 先判:它**不帶** CONSTRAINT、不在上面那個碼表裡,而它有專屬處置。
    if (code === '23505' && errRaw(error).includes(CORRECTION_REQUEST_ID_UNIQUE)) {
      return { result: 'REQUEST_ID_COLLISION' };
    }
    // 🔴 P2B44 的「token 撞到別筆」與 23505 是**同一件事的兩個時機**(前置檢查 vs 索引)
    //    ⇒ 走同一條路:換一把新 token 重送。把它當業務錯 ⇒ 員工會看到一句他無法處理的話。
    if (code === 'P2B44' && errRaw(error).includes(CORRECTION_P2B44_MARKERS.requestIdReused)) {
      return { result: 'REQUEST_ID_COLLISION' };
    }
    if (code !== null && (CORRECTION_RPC_RAISE_CODES as readonly string[]).includes(code)) {
      throw new CorrectionRejectedError(code, `${fn} 拒收本次呼叫:${errText(error)}`);
    }
    // 🔴 表層 CHECK 也是「拒絕」,不是故障(見 CORRECTION_INPUT_REJECT_CODE 那段)。
    if (code === CORRECTION_INPUT_REJECT_CODE) {
      throw new CorrectionRejectedError(code, `${fn} 送進去的值不合規:${errText(error)}`);
    }
    // 🔴 而 22P02 那族是我們自己產錯了 id ⇒ 協定漂移那一族,員工沒有下一步。
    if (code !== null && (CORRECTION_CALLER_BUG_CODES as readonly string[]).includes(code)) {
      throw new CorrectionCallerBugError(`${fn} 參數型別不合(${code}):${errText(error)}`);
    }
    // 🔴 不認得的錯誤**原樣拋** —— 包裝成業務錯會讓一個平台故障長得像「你填錯了」。
    throw error;
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new CorrectionCallerBugError(`${fn} 回傳不是 jsonb 物件:${JSON.stringify(data)}`);
  }
  const row = data as Record<string, unknown>;
  const result = row.result;

  if (result === 'CORRECTED') {
    // 🔴 逐欄驗:少一欄就是協定漂移。缺 `seq` 而放行 ⇒ 畫面會顯示一個 undefined。
    const correctionId = row.correction_id;
    const seq = row.seq;
    const correctedTo = row.corrected_to;
    if (typeof correctionId !== 'string' || typeof seq !== 'number' || typeof correctedTo !== 'string') {
      throw new CorrectionCallerBugError(`${fn} CORRECTED 的欄位形狀不對:${JSON.stringify(row)}`);
    }
    return { result: 'CORRECTED', refundId: input.refundId, correctionId, seq, correctedTo };
  }

  if (result === 'DUPLICATE_REQUEST') {
    // ⚠️ 這一條**沒有** seq / corrected_to(RPC `:299-300` 逐字只回三欄)⇒ 不要照 CORRECTED 驗。
    const correctionId = row.correction_id;
    if (typeof correctionId !== 'string') {
      throw new CorrectionCallerBugError(
        `${fn} DUPLICATE_REQUEST 的欄位形狀不對:${JSON.stringify(row)}`,
      );
    }
    return { result: 'DUPLICATE_REQUEST', refundId: input.refundId, correctionId };
  }

  throw new CorrectionCallerBugError(`${fn} 回傳非預期碼:${JSON.stringify(result)}`);
}
