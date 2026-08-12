import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';

// receipt-repository.ts — M-4b E10 #352-b:`admin_record_item_receipt` 的唯一呼叫端。
//
// 🔴 稽核由 RPC **同交易**寫(`20260811010000` 步 10)⇒ 本層不碰 `admin_audit_log`。
//
// 🔴 **刪除那支(`admin_delete_item_receipt`)刻意不在本檔**(R1 nit 9、主視窗裁):
//    它在 DB 已經就緒,但本片沒有任何刪除入口 ⇒ 寫在這裡會是一段**從未執行過**的 code
//    進 commit。等刪除入口那片再一起寫、一起被測到。
//    ⚠️ 寫它的人注意:它有第三個 SQLSTATE **`P4A03`**(`a352a2_delete_below_shipped`),
//    那是**業務拒絕不是呼叫端 bug**,而且 DB 訊息已寫成白話、還逐箱列出未出貨的包裹編號與件數
//    (`20260810233000:429-433`)⇒ **原文帶給員工**,別在 app 層改寫成一句籠統的「刪不掉」。
//
// 🔴 **固定碼窮盡收斂**(同 `procurement-repository.ts` 的立場):未知碼 / null 一律當呼叫端 bug 拋,
//    不得靜默當成功 —— 「到貨沒記進去」長得跟成功一樣是本片最貴的失敗形狀
//    (instock 不動 ⇒ 出貨彈窗照樣說「未到貨」,而員工以為已經登錄了)。

/** `admin_record_item_receipt` 的固定碼(逐字取自 `20260811010000` 的 `RETURN '…'`,共 10 個)。 */
export const RECEIPT_RECORD_RESULT_CODES = [
  'RECORDED',
  'DUPLICATE_REQUEST',
  'EXCEEDS_ROOM_AFTER_CANCELLATION',
  'QUANTITY_EXCEEDS_ALLOCATED',
  'PROCUREMENT_NOT_FOUND',
  'INVALID_QUANTITY',
  'NOTE_TOO_LONG',
  'RECEIVED_AT_REQUIRED',
  'RECEIVED_AT_OUT_OF_RANGE',
  'RECEIVED_AT_IN_FUTURE',
] as const;

export type ReceiptRecordResultCode = (typeof RECEIPT_RECORD_RESULT_CODES)[number];

const RECORD_CODE_SET = new Set<string>(RECEIPT_RECORD_RESULT_CODES);

/** 呼叫端契約違反 —— 訊息要叫員工停手重新整理,不是「稍後再試」。 */
export class ReceiptCallerBugError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReceiptCallerBugError';
  }
}

function errorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

/**
 * 呼叫端 bug 型的 RAISE。
 *
 * 🔴 **兩支到貨 RPC 實查的 SQLSTATE 只有三個**(`grep ERRCODE` 兩檔 + 「無 USING 的 RAISE = P0001」):
 *   ① `P0001` = actor / request_id 形狀、常數自檢、不變式破損等防衛枝(兩支都有)
 *   ② `P2B02` = 隔離閘(非 read committed 拒收;`20260811010000:72`、`20260810233000:99`/`:320`)
 *   ③ `P4A03` = 只出現在刪除那支(本檔不呼叫;見檔頭)⇒ 不在本判別式。
 *
 * ⚠️ **誠實邊界**:只看 `code`、不看訊息;沒有逐一親驗過相關表的全部 trigger
 *    ⇒ 不宣稱「`P0001` 在這條路徑上唯一來源是本 RPC」,只宣稱當 bug 處理是 fail-closed 的。
 */
function isCallerBugRaise(error: unknown): boolean {
  const code = errorCode(error);
  return code === 'P0001' || code === 'P2B02';
}

export interface RecordItemReceiptArgs {
  procurementId: string;
  /**
   * 到貨幾件。
   *
   * 🔴 **0 是合法值,不要在型別或表單上把它擋掉** —— `quantity=0 / surplus=N` 正是
   *    「這張單已經收滿/已取消,但供應商的貨還是到了」的登記方式
   *    (a1 `20260810230000:82` 逐字)。兩道額度守門
   *    (採購列層 `20260811010000:193`、品項層 `:245`)都**只看本欄、不看 surplus**
   *    ⇒ 到貨填 0 就通得過。把本欄設成必填正整數會讓那條路在 UI 上直接死掉。
   */
  quantity: number;
  /** 溢收幾件(Sean Q1=A 的「乙」)。不進 `received_quantity` / `instock`,只留紀錄。 */
  surplusQuantity: number;
  /**
   * 到貨時刻。🔴 **帶偏移的 ISO、由 server 端補 Asia/Taipei**(同 A5a `submittedAt` 的理由:
   * 用裝置時區換算會讓非台北機器靜默存錯時刻)。
   */
  receivedAt: string;
  note: string | null;
  actor: string;
  /**
   * 🔴 **這支的 `p_request_id` 是真的冪等鍵,不是稽核關聯 id** ——
   *    與 `admin_upsert_item_procurement` 相反(那支只寫進 audit log、零唯一性約束)。
   *    本支有 `order_item_receipt_requests` 冪等帳:同鍵同內容回 `DUPLICATE_REQUEST`、
   *    同鍵不同內容 RAISE。⇒ **必須由表單一次性產生並隨表單送出**,
   *    不可每次 render 重產、也不可拿每次的 HTTP request id ——
   *    那會讓重送變成新請求、冪等失效(plan §5.1 逐字)。
   *
   * 形狀限制(`20260811010000:101-103`):可列印 ASCII、無空白、**全小寫**、≤200。
   */
  requestId: string;
}

/**
 * 記一筆到貨。回 10 碼之一;RAISE → `ReceiptCallerBugError`。
 *
 * 🔴 逐欄具名送、不 spread(TS 多餘屬性檢查只作用在物件字面上)。
 */
export async function recordItemReceipt(
  args: RecordItemReceiptArgs,
): Promise<ReceiptRecordResultCode> {
  const { data, error } = await createSupabaseServiceClient().rpc('admin_record_item_receipt', {
    p_procurement_id: args.procurementId,
    p_quantity: args.quantity,
    p_surplus_quantity: args.surplusQuantity,
    p_received_at: args.receivedAt,
    p_note: args.note,
    p_actor: args.actor,
    p_request_id: args.requestId,
  });

  if (error) {
    if (isCallerBugRaise(error)) {
      throw new ReceiptCallerBugError(
        `admin_record_item_receipt 拒收本次呼叫(${String(errorCode(error))}):${String(
          error.message,
        ).slice(0, 200)}`,
      );
    }
    throw error;
  }

  if (typeof data === 'string' && RECORD_CODE_SET.has(data)) {
    return data as ReceiptRecordResultCode;
  }

  throw new ReceiptCallerBugError(
    `admin_record_item_receipt 回傳非預期碼:${JSON.stringify(data)}`,
  );
}

/**
 * `DUPLICATE_REQUEST` 之後,那次登錄的產物**現在還在不在**。
 *
 * 🔴 **為什麼需要多這一次讀**:RPC 兩個 `DUPLICATE_REQUEST` 出口
 * (`20260811010000:183` 快篩 / `:283` 併發 `unique_violation`)**回的是同一個裸字串**,
 * 完全沒帶「產物還在嗎」這個資訊 —— 而 plan §5.1 要求這兩種情況給**不同文案**:
 *   · 產物還在 ⇒「這筆到貨先前已經登錄過了」(純安心話)
 *   · 產物已被刪 ⇒「先前登錄過,而且後來被刪除了 —— **沒有**重新建立」
 *     (RPC `:181` 逐字:產物被刪一樣回 DUPLICATE、**不重新 INSERT**,復活路徑不存在)
 * ⇒ 只回一個綠色的成功會讓員工以為貨記在帳上了,而實際上帳面是空的。
 *
 * 冪等帳列**不可刪**(a1 `:197-199` 只 GRANT SELECT)⇒ 查得到鍵就查得到 `receipt_id`;
 * 查不到鍵 = 呼叫端拿了一個從沒送成功過的鍵來問 ⇒ `'unknown'`,文案退回保守說法。
 *
 * ⚠️ 兩次都是 PK 查、且只在 `DUPLICATE_REQUEST` 這條**罕見**路徑上跑,不進正常成功路徑。
 */
export type ReceiptDuplicateOutcome = 'alive' | 'deleted' | 'unknown';

export async function findDuplicateOutcome(requestId: string): Promise<ReceiptDuplicateOutcome> {
  const client = createSupabaseServiceClient();

  const ledger = await client
    .from('order_item_receipt_requests')
    .select('receipt_id')
    .eq('request_id', requestId)
    .maybeSingle();
  if (ledger.error) throw ledger.error;

  const receiptId = ledger.data?.receipt_id;
  if (typeof receiptId !== 'string') return 'unknown';

  const receipt = await client
    .from('order_item_procurement_receipts')
    .select('id')
    .eq('id', receiptId)
    .maybeSingle();
  if (receipt.error) throw receipt.error;

  return receipt.data ? 'alive' : 'deleted';
}

/** `admin_delete_item_receipt` 的固定碼(逐字取自 `20260810233000` 的 `RETURN '…'`,共 3 個)。 */
export const RECEIPT_DELETE_RESULT_CODES = [
  'DELETED', //           `:452`
  'ALREADY_DELETED', //   `:353`(冪等重放)、`:390`(列已不在)
  'RECEIPT_NOT_FOUND', // `:355`
] as const;

export type ReceiptDeleteResultCode = (typeof RECEIPT_DELETE_RESULT_CODES)[number];

const DELETE_CODE_SET = new Set<string>(RECEIPT_DELETE_RESULT_CODES);

/**
 * 撤銷的結果。**業務拒絕不是例外** —— 它是一個要原文轉給員工的答案。
 *
 * 🔴 `blocked` 帶的 `message` 是 **DB 原文**(主枝 `20260810233000:428-433`):它已經寫成白話,
 *    而且**逐箱列出未出貨的包裹編號與件數**、還講了出路(先作廢包裹或從包裹移除品項)。
 *    ⇒ **不准**在這層或 UI 層壓成一句「刪不掉」——那正是本檔檔頭交辦的第一條。
 * 🔴 **fixture 的回指住在這裡,不在 SQL 檔裡**(2026-08-13:我原本要照裁示在那段 RAISE 上加註解,
 *    但那支 migration **已 apply**,`supabase/APPLIED.tsv:169` 記著它的 sha256
 *    ——我改完實測雜湊當場對不上(`54121aba…` → `80ae4f83…`),已 `git checkout` 還原。
 *    ⇒ **已 apply 的 migration 連註解都不能動**;回指改放本檔:
 *    P4A03 的原文在測試裡有兩份**手抄副本**當 fixture
 *    (`receipt-repository.test.ts` / `components/orders/receipt-undo-bar.test.tsx`,兩處都註了來源),
 *    **改那段 SQL 訊息時要回來對這兩份**,否則守門會對著舊字面恆綠。
 *    ⚠️ 已 apply 的那支動不了,但**新 migration 可以改到這段訊息** —— 那條路要接住:
 *    **若日後有新 migration 改動此訊息,必須同步本檔 fixture 與三層守門格**
 *    (repository / action / UI 各一格,見那三檔的「原文不准壓成一句」註解)。
 *
 * ⚠️ **P4A03 有兩個發出點,兩者的訊息長得不一樣**(R1 nit:我原本只描述了主枝):
 *    另一枝 `:407-408` 是「讀不到品項 `<uuid>` 的數量摘要 —— 拒絕刪除」的 fail-closed,
 *    訊息帶內部 uuid、對員工沒有可照做的資訊。行為上歸 `blocked` 是對的(確實是業務拒絕、
 *    確實沒刪),但**畫面會出現一句內部訊息** —— 那一枝依 RPC 自陳「在正常路徑上構造不出來」
 *    (`20260810233000:401-405` 逐字「這一枝在正常路徑上構造不出來」「保留它的理由是 trigger 壞掉/有人直寫 DB 的世界」),所以本片不另做文案分流,只記在這裡。
 */
export type ReceiptDeleteOutcome =
  | { kind: 'code'; code: ReceiptDeleteResultCode }
  | { kind: 'blocked'; message: string };

/** P4A03 = 業務拒絕(已出貨/已裝箱的不給刪),**不是**呼叫端 bug。 */
const DELETE_BLOCKED_SQLSTATE = 'P4A03';

/**
 * 撤銷一筆到貨。
 *
 * 🔴 **三類結果嚴格分開**(同本檔「固定碼窮盡收斂」的立場):
 *   ① 固定碼 3 個 → `kind: 'code'`
 *   ② `P4A03` → `kind: 'blocked'`,**原文往上帶**
 *   ③ `P0001` / `P2B02` → `ReceiptCallerBugError`(呼叫端契約違反,叫員工停手重新整理)
 *   ④ 其他 → 原樣往上拋。**未知碼絕不靜默當成功** —— 「以為撤掉了、其實沒撤」會讓員工
 *      照著錯的庫存去出貨,和登錄那支「以為記進去了、其實沒有」是同一種最貴的失敗形狀。
 *
 * 🔴 `p_request_id` 在**這支不是冪等鍵**(檔頭 `20260810233000:283` 逐字「不用於冪等判斷」)
 *    ⇒ 傳 HTTP request id 即可,不必、也不該沿用表單那把一次性鍵。
 */
export async function deleteItemReceipt(args: {
  receiptId: string;
  actor: string;
  requestId: string;
}): Promise<ReceiptDeleteOutcome> {
  const { data, error } = await createSupabaseServiceClient().rpc('admin_delete_item_receipt', {
    p_receipt_id: args.receiptId,
    p_actor: args.actor,
    p_request_id: args.requestId,
  });

  if (error) {
    if (errorCode(error) === DELETE_BLOCKED_SQLSTATE) {
      return { kind: 'blocked', message: String(error.message) };
    }
    if (isCallerBugRaise(error)) {
      throw new ReceiptCallerBugError(
        `admin_delete_item_receipt 拒收本次呼叫(${String(errorCode(error))}):${String(
          error.message,
        ).slice(0, 200)}`,
      );
    }
    throw error;
  }

  if (typeof data === 'string' && DELETE_CODE_SET.has(data)) {
    return { kind: 'code', code: data as ReceiptDeleteResultCode };
  }

  throw new ReceiptCallerBugError(
    `admin_delete_item_receipt 回傳非預期碼:${JSON.stringify(data)}`,
  );
}

/**
 * 由冪等鍵反查那次登錄產出的 `receipt_id`。查無 → `null`。
 *
 * 🔴 **這是「撤銷剛剛那筆」唯一拿得到 receipt id 的路** —— 逐筆到貨**沒有被投影**到讀模型
 *    (`packages/adapters/src/supabase/mappers/order-procurement.ts:16-20` 逐字「本片不投影逐批到貨明細」),畫面上沒有 id 可拿。
 *    冪等帳 `order_item_receipt_requests` 是 `request_id` PK(`20260810230000:130`)、
 *    有 `receipt_id` 欄、`GRANT SELECT TO service_role`(`:199`)⇒ 走它。
 *    (同一條反查 `findDuplicateOutcome` 已經在用,不是新開的查詢面。)
 *
 * ⚠️ 回 id **不代表那筆還在** —— 冪等帳列不可刪,產物被刪之後這裡照樣查得到 id。
 *    「還在不在」由 RPC 自己答(`ALREADY_DELETED`),不要在這裡多查一次製造第二真相。
 */
/**
 * 這筆到貨掛在哪一個 `order_item` 底下。查無 → `null`。
 *
 * 🔴 **為什麼需要它**(主視窗裁,鐵則 12② 權限面不降級):撤銷的目標 id 是由**冪等鍵反查**來的,
 *    而歸屬閘只驗「表單送來的 item 屬於這張單」⇒ 中間那段「這筆 receipt 真的屬於這個 item」
 *    **沒有任何 code 在管**。上一版靠兩個**外部條件**撐:①冪等鍵是 client mint 的 uuid、猜不到
 *    ②admin 全在 SSO 閘後。那兩件**這段 code 都管不到** —— 鍵的產生方式改成可預測、或 SSO
 *    邊界變動,防護就沒了,而且**不會有任何一格轉紅**。⇒ 改成這一層自己證得出來的事實。
 *
 * 鏈是兩跳:`receipts.procurement_id`(FK,`20260729020000:186`)→
 * `order_item_procurement.order_item_id`。**用內嵌一次讀完**,不拆兩次查(兩次之間可以被改)。
 */
export async function findOrderItemIdForReceipt(receiptId: string): Promise<string | null> {
  const { data, error } = await createSupabaseServiceClient()
    .from('order_item_procurement_receipts')
    .select('order_item_procurement(order_item_id)')
    .eq('id', receiptId)
    .maybeSingle();
  if (error) throw error;
  // 🔴 內嵌 many-to-one 的生成型別對「單物件 / 陣列」推斷不穩(同 `mappers/order.ts` 對
  //    `customers` 的慣例)⇒ 兩形都接;接不出字串一律回 null = fail-closed,呼叫端會拒撤。
  const embedded = (data as { order_item_procurement?: unknown } | null)?.order_item_procurement;
  const row = Array.isArray(embedded) ? embedded[0] : embedded;
  const orderItemId = (row as { order_item_id?: unknown } | undefined)?.order_item_id;
  return typeof orderItemId === 'string' ? orderItemId : null;
}

export async function findReceiptIdByRequestId(requestId: string): Promise<string | null> {
  const { data, error } = await createSupabaseServiceClient()
    .from('order_item_receipt_requests')
    .select('receipt_id')
    .eq('request_id', requestId)
    .maybeSingle();
  if (error) throw error;
  const receiptId = data?.receipt_id;
  return typeof receiptId === 'string' ? receiptId : null;
}

/**
 * 這筆採購還能再登錄幾件(= `allocated − received`)。查無 → null。
 *
 * 🔴 **只用來組錯誤訊息裡的拆分建議**(plan §5.1 / R3-nit1:「`QUANTITY_EXCEEDS_ALLOCATED`
 *    由 app 算出拆分建議」),**不是守門** —— 守門在 RPC 裡、且在鎖之內
 *    (`20260811010000:193`,同交易讀 `v_proc`)。本讀在鎖外、可能已經過期,
 *    拿它去判斷「這次送得出去嗎」會是第二真相。
 *    ⇒ 只在 RPC **已經拒絕之後**跑,用來把「超過了」變成「填 N 件、多的 M 件放溢收」。
 */
export async function findProcurementRemaining(procurementId: string): Promise<number | null> {
  const { data, error } = await createSupabaseServiceClient()
    .from('order_item_procurement')
    .select('allocated_quantity, received_quantity')
    .eq('id', procurementId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return data.allocated_quantity - data.received_quantity;
}

/**
 * 一個品項的採購列(#352-b-2 入口 2 用;**按下「貨到了」那一刻才抓**)。
 *
 * 🔴 **為什麼不放進出貨彈窗的 candidates DTO**(主視窗 2026-08-11 裁 C):
 *    `shipment-candidates.ts` 檔頭自陳它是「**刻意很窄的 DTO**」——
 *    只帶單號/品名/料號/還能出幾件,理由是 `AdminOrderDetail` 含成交價與客人 PII。
 *    把採購列(含供應商身分)塞進去 = **為了便利改寫一條安全不變式**,
 *    而且多一條路徑就多一個未來要記得守的出口。
 *    ⇒ 改成按下去才抓;代價(一次往返)只發生在那一刻。
 *
 * 🔴 **回傳欄位是最小集,一個價格欄都沒有**:id / 供應商 label / 訂購 / 已到貨。
 *    `order_item_procurement` 本身沒有價格欄,但這裡仍逐欄具名 select ——
 *    `select('*')` 會讓日後有人加欄時**自動**把它送到 client。
 */
export type ItemProcurementChoice = {
  procurementId: string;
  supplierLabel: string | null;
  allocatedQuantity: number;
  receivedQuantity: number;
};

export async function listProcurementChoices(
  orderItemId: string,
): Promise<ItemProcurementChoice[]> {
  const { data, error } = await createSupabaseServiceClient()
    .from('order_item_procurement')
    .select('id, allocated_quantity, received_quantity, suppliers(label)')
    .eq('order_item_id', orderItemId)
    .order('created_at', { ascending: true });
  if (error) throw error;

  return (data ?? []).map((row) => {
    // 內嵌回來的形狀依關聯基數可能是物件或陣列 ⇒ 兩種都收,取不到就誠實回 null
    // (`null` = 「這次沒帶回來」,**不是**「這家沒有名字」—— 同 A9a-2 對 supplierLabel 的立場)。
    const s = row.suppliers as { label?: string | null } | { label?: string | null }[] | null;
    const label = Array.isArray(s) ? (s[0]?.label ?? null) : (s?.label ?? null);
    return {
      procurementId: row.id,
      supplierLabel: label,
      allocatedQuantity: row.allocated_quantity,
      receivedQuantity: row.received_quantity,
    };
  });
}
