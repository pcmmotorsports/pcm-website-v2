/**
 * D1t1:§8.7 TapPay read-back 判定矩陣(純函式、零 I/O)。
 *
 * 這是「憑什麼刪」的裁決層:D1b1 產證據包與 D1c 步驟 8b 的交易內複驗**共用本函式**,
 * 兩處不得各自實作(規格 §8.4 步驟 8b 逐字「六筆斷言與 D1b1 完全相同」)。
 *
 * 🔴 判定矩陣逐字對照(master-plan v2 §8.7 表 + §8.4:875-886;測試逐格覆蓋):
 * - 五筆有 `rec_trade_id`(0052/0064/0090/0102/0104):不降級。top `status ∈ {0,2}`、
 *   要求唯一命中、回傳 recTradeId === 查詢鍵、amount === orders.total(整數元位,
 *   settle-charge.ts:217 同口徑)、currency 'TWD'、全部 safe integer。
 * - 三筆已退(0052/0102/0104):`record_status === 3` 且 `refunded_amount === amount`。
 * - 🔴 0052 專屬出口:零筆命中 ⇒ 保持原值 + audit「正式商戶查無」——**不得寫成
 *   「sandbox 已證實」**(查無只證明正式商戶無此交易);0102/0104 零筆 = abort。
 * - 兩筆 pending(0064/0090):**命中時**只收 `record_status ∈ {-1, 5}`;`0`(AUTH)與 `4`(PENDING)
 *   **預期會發生、不是異常路徑**,出現即 abort raise Sean 附證據。
 * - 🔴 **0064/0090 零筆出口(2026-07-30 D1b1 首跑實證後新增;Sean 拍板「窄化放寬」)**:
 *   原規格假設「rec_trade_id 來自 3DS 啟動 ⇒ TapPay 端必有紀錄」(出處
 *   `docs/reviews/2026-07-28-e10-fable-retrospective.md:82`),**D1b1 首跑當場推翻**:
 *   兩張的 rec_trade_id 於正式商戶零命中,且 Sean 同日於 TapPay 商家後台實查
 *   2026-06-26、2026-06-27 **兩日零交易紀錄**(不是「查不到那一筆」,是那兩天什麼都沒有)。
 *   ⇒ 零筆**僅在 `payment_status === 'unpaid'` 時**放行 —— DB 與正式商戶對「沒收到錢」
 *   口徑一致才算數;`unpaid` 以外(DB 說收過錢、正式商戶卻查無)= 兩邊矛盾,一律 abort。
 *   證據等級 `official-no-hit`,**不得升格為 `system-readback`**(查無只證明正式商戶無此交易)。
 *   同批實證的反向支撐(🔴 措辭已於 2026-07-30 關卡2 更正,原文誤稱「金額逐格相符」):
 *   0102/0104 以**同一組 merchant id、同一條查詢路徑**各命中 1 筆,且 `rec_trade_id` 與
 *   `order_number` 逐格相符(實查證據檔確認)⇒ **查詢鍵綁定與商戶身分**已被正向證明,
 *   零筆不是查錯。**金額欄不在此列** —— 見下方「未解決」。
 *
 * 🔴 **未解決:本出口不足以解封 D1(2026-07-30 關卡2 codex + code-reviewer 一致指出)。**
 * D1b1 首跑在 0064 就 throw,`judgeHit` **從未對 0102/0104 執行過**;直接讀證據檔比對,
 * 本檔對「已全額退款紀錄」的三項假設與 TapPay 實回應不符,下次跑會改在 0102 abort:
 *   ① `amount` 實回 **0**(非授權金額;原額在 raw 的 `original_amount`)⇒ 撞 `judgeHit` 金額閘
 *   ② `refunded_amount` 實回 **101 / 1180**(= orders.total),而本檔要求它 `=== rec.amount`(0)
 *   ③ **`transaction_time_millis` 這個欄位不存在** —— raw 實有 `time` / `cap_millis` /
 *      `transaction_complete_millis` / `bank_transaction_*_millis`(`wire.ts:68` 的欄名待重訂)
 * 修這三項需要重查 TapPay 官方 Record API 文件、改 `wire.ts` 與本檔矩陣、重審。**尚未進行。**
 * - 🔴 0101(唯一無鍵):不查。**禁用 bank_transaction_id 或任何寬條件替代**(§8.7 逐字;
 *   本函式的輸入型別根本不收該欄 = 物理排除)。證據等級 = Sean 本人確認、非系統 read-back。
 * - 其餘一切(多筆、狀態不在集合、金額不符、top status 異常)= abort,不留人工解讀路徑。
 *
 * `transactionTimeMillis`(關卡1 R2-8 + R3-F11):`record_status===3` 的退款證據筆必備
 * (缺 = throw);`-1`/`5` 選填(TapPay 對 ERROR/CANCEL 是否必帶未確認,不得讓合法取消
 * 紀錄 wedge 整條線),缺值 audit 記原因。
 */
import type { TapPayRecordResponseWire, TapPayRecordWire } from '../packages/adapters/src/tappay/wire';

/** 六筆 attempts 的 DB 事實(交易內鎖列後讀取;authorizedAmount = orders.total,整數元位)。 */
export type D1AttemptFact = Readonly<{
  displayId: string;
  /** orders.id(UUID)。TapPay 的 order_number 存的是它(adapter:91 `order_number: payload.orderId`)。 */
  orderId: string;
  recTradeId: string | null;
  authorizedAmount: number;
  /** orders.payment_status 文字值;0101 例外的前提釘死用。 */
  paymentStatus: string;
}>;

/** 有查詢鍵的五筆(型別上排除 0101 —— runReadback 只收這個,無鍵單物理上進不了查詢層)。 */
export type D1KeyedAttemptFact = D1AttemptFact & Readonly<{ recTradeId: string }>;

/**
 * 🔴 0101 例外的前提釘死(codex K2:例外只鎖 rec_trade_id=NULL 不夠 —— Sean 拍板當時
 * 這張單是 NT$2,400、unpaid;金額或付款態漂移代表「那張單已經不是拍板的那張單」,
 * 舊的口頭確認不得沿用,必須停下重問)。
 */
export const NO_KEY_ORDER_EXPECTED = Object.freeze({
  authorizedAmount: 2400,
  paymentStatus: 'unpaid',
});

export type D1ReadbackVerdict =
  /** 退款證據成立(record_status=3、全額退)⇒ 步驟 12 改 refunded。 */
  | 'refund-confirmed'
  /** 0052 專屬:正式商戶查無 ⇒ 步驟 12 保持原值 + audit 註記。 */
  | 'keep-original-no-hit'
  /** pending 單確認未授權/已取消(record_status ∈ {-1,5})⇒ 照常刪除。 */
  | 'not-charged-confirmed'
  /**
   * 0064/0090 專屬:正式商戶查無 **且** `payment_status === 'unpaid'` ⇒ 照常刪除。
   * 🔴 與 `not-charged-confirmed` 刻意分開兩個值:那個是 TapPay 逐格回報終態(system-readback),
   * 這個是「兩邊都說沒有」(official-no-hit)。合併會讓 audit 讀者以為證據等級相同。
   */
  | 'not-charged-no-hit'
  /** 0101 專屬:無查詢鍵,Sean 本人確認、非系統 read-back。 */
  | 'sean-attested-no-key';

export type D1ReadbackAuditRow = Readonly<{
  displayId: string;
  verdict: D1ReadbackVerdict;
  evidenceLevel: 'system-readback' | 'official-no-hit' | 'sean-attested';
  recTradeId: string | null;
  recordStatus: number | null;
  amount: number | null;
  refundedAmount: number | null;
  transactionTimeMillis: number | null;
  note: string;
}>;

/** §8.7 六張單(唯一合法輸入集合)。 */
const EXPECTED_DISPLAY_IDS = [
  'PCM-2026-0052',
  'PCM-2026-0064',
  'PCM-2026-0090',
  'PCM-2026-0101',
  'PCM-2026-0102',
  'PCM-2026-0104',
] as const;

const NO_KEY_ORDER = 'PCM-2026-0101';
const REFUNDED_ORDERS = ['PCM-2026-0052', 'PCM-2026-0102', 'PCM-2026-0104'] as const;
const PENDING_ORDERS = ['PCM-2026-0064', 'PCM-2026-0090'] as const;
/** 0052 是唯一**無條件**「查無 ⇒ 保持原值」的單(交易環境未證實);0102/0104 正式站真刷必有紀錄。 */
const NO_HIT_TOLERATED = 'PCM-2026-0052';

/**
 * 🔴 0064/0090 的**條件式**零筆出口(2026-07-30 Sean 拍板 A「窄化放寬」;背景見檔頭)。
 *
 * 與 `NO_HIT_TOLERATED` 的差別 = **多一道 `payment_status === 'unpaid'` 前提**:
 * 零筆本身只證明「正式商戶沒有這筆」,要它等於「沒收到錢」,必須 DB 自己也說沒收到。
 *
 * 名單**寫死這兩張、不沿用 `PENDING_ORDERS`** —— 日後若有人往 `PENDING_ORDERS` 加單,
 * 不會連帶把零筆容忍度一起送出去(放寬要逐張明寫,不得靠共用清單長出來)。
 */
const NO_HIT_TOLERATED_WHEN_UNPAID = ['PCM-2026-0064', 'PCM-2026-0090'] as const;

/** 上述出口的硬前提;與 `NO_KEY_ORDER_EXPECTED.paymentStatus` 同字彙(orders.payment_status)。 */
const NO_HIT_REQUIRED_PAYMENT_STATUS = 'unpaid';

/**
 * Sean 2026-07-30 於 TapPay 商家後台的人工查證(D1b1 首跑當下)。
 * 🔴 這是**人工觀察、非系統 read-back**(比照 0101 的 `SEAN_ATTESTED_NOTE` 先例):
 * 程式無法在執行當下複驗它,故只入 audit 註記、不升格證據等級。
 */
export const SEAN_TAPPAY_CONSOLE_ATTESTATION =
  'Sean 2026-07-30 於 TapPay 商家後台實查:2026-06-26、2026-06-27 兩日正式商戶零交易紀錄';

export const SEAN_ATTESTED_NOTE =
  'Sean 2026-07-29 口頭確認未扣款;無 rec_trade_id,未經 TapPay read-back';

function abort(displayId: string, reason: string): never {
  throw new Error(`D1 read-back abort:${displayId}:${reason}`);
}

/**
 * 前置整組斷言(關卡1 R1-18):cohort 事實必須與 §8.7 逐字相符,任一漂移 = abort。
 * 特別是 0101 的 recTradeId **執行當下必須仍為 NULL** —— 若它後來長出了鍵,
 * 「Sean 口頭確認」這條放行的前提就變了,必須停下重問,不得沿用舊例外。
 */
function assertFactSet(facts: readonly D1AttemptFact[]): void {
  if (facts.length !== 6) {
    throw new Error(`D1 read-back abort:cohort 事實應 6 筆,實 ${facts.length}`);
  }
  const ids = facts.map((f) => f.displayId).sort();
  if (ids.join() !== [...EXPECTED_DISPLAY_IDS].sort().join()) {
    throw new Error('D1 read-back abort:display_id 集合與 §8.7 不符');
  }
  const keyed = facts.filter((f) => f.displayId !== NO_KEY_ORDER);
  const noKey = facts.find((f) => f.displayId === NO_KEY_ORDER);
  if (!noKey || noKey.recTradeId !== null) {
    abort(NO_KEY_ORDER, 'rec_trade_id 應為 NULL(放行前提已漂移,停下重問 Sean)');
  }
  if (
    noKey.authorizedAmount !== NO_KEY_ORDER_EXPECTED.authorizedAmount ||
    noKey.paymentStatus !== NO_KEY_ORDER_EXPECTED.paymentStatus
  ) {
    abort(
      NO_KEY_ORDER,
      `拍板前提漂移(應 NT$${NO_KEY_ORDER_EXPECTED.authorizedAmount}/${NO_KEY_ORDER_EXPECTED.paymentStatus},實 NT$${noKey.authorizedAmount}/${noKey.paymentStatus});舊口頭確認不得沿用,停下重問 Sean`,
    );
  }
  for (const f of keyed) {
    if (!f.recTradeId) abort(f.displayId, 'rec_trade_id 缺失(A0a 實查應非 NULL,已漂移)');
    if (!Number.isSafeInteger(f.authorizedAmount) || f.authorizedAmount <= 0) {
      abort(f.displayId, 'orders.total 非正整數');
    }
  }
  if (new Set(keyed.map((f) => f.recTradeId)).size !== 5) {
    throw new Error('D1 read-back abort:五把 rec_trade_id 有重複');
  }
}

/**
 * 🔴 查詢層入口閘(D1b1 關卡2 M1,審查者已實跑證偽舊寫法)。
 *
 * 舊寫法在兩個呼叫端各自 `facts.filter((f) => f.recTradeId !== null)` —— 那擋的是
 * 「沒有鍵」,不是「這一筆不准查」。`PCM-2026-0101` 是 `unpaid` + 卡片 `pending`,
 * 而 D1b1 刻意**不停 sweeper**;查詢前若它被回填 `rec_trade_id`,舊寫法就會把它
 * 送去打正式商戶 —— 正是 §8.7 逐字禁止的那次查詢(型別述詞 `f is D1KeyedAttemptFact`
 * 只是把同一個 null 判斷重述一次,不是第二道防線)。
 *
 * 本函式改以 **displayId** 排除,並在送出任何 HTTP 之前先跑整組前提斷言
 * (0101 必 NULL + NT$2,400 + unpaid;漂移 = 拍板前提已變,停下重問)。
 * **D1b1 取證與 D1c 步驟 8b 共用本函式,不得各自 filter。**
 */
export function selectFactsForQuery(
  facts: readonly D1AttemptFact[],
): readonly D1KeyedAttemptFact[] {
  assertFactSet(facts);
  return facts
    .filter((f) => f.displayId !== NO_KEY_ORDER)
    .map((f) => {
      if (f.recTradeId === null) abort(f.displayId, 'rec_trade_id 缺失(assertFactSet 應已擋下)');
      return { ...f, recTradeId: f.recTradeId };
    });
}

function judgeHit(fact: D1AttemptFact, rec: TapPayRecordWire): D1ReadbackAuditRow {
  const { displayId } = fact;
  if (rec.recTradeId !== fact.recTradeId) {
    abort(displayId, '回傳 rec_trade_id 與查詢鍵不符');
  }
  // 🔴 強識別閘(codex K2;比照 settle-charge recordMatchesOrder):order_number 必須
  //    等於本單 UUID —— 錯掛到別張單、但 rec id/金額/狀態剛好相同時,只有這條擋得住。
  if (rec.orderNumber !== fact.orderId) {
    abort(displayId, `order_number ${rec.orderNumber} ≠ 本單 UUID(錯掛他單)`);
  }
  if (!Number.isSafeInteger(rec.amount) || rec.amount !== fact.authorizedAmount) {
    abort(displayId, `TapPay amount ${rec.amount} ≠ orders.total ${fact.authorizedAmount}`);
  }
  if (rec.currency !== 'TWD') {
    abort(displayId, `currency 非 TWD(實 ${rec.currency ?? '缺'})`);
  }

  if ((REFUNDED_ORDERS as readonly string[]).includes(displayId)) {
    if (rec.recordStatus !== 3) {
      abort(displayId, `已退單 record_status 應為 3(REFUNDED),實 ${rec.recordStatus}`);
    }
    if (
      typeof rec.refundedAmount !== 'number' ||
      !Number.isSafeInteger(rec.refundedAmount) ||
      rec.refundedAmount !== rec.amount
    ) {
      abort(displayId, `refunded_amount ${rec.refundedAmount ?? '缺'} ≠ 授權金額 ${rec.amount}(非全額退)`);
    }
    // 退款證據筆的交易時間必備(§8.4:867 要求存檔;wire 層選填 ⇒ 本層收緊)。
    if (
      typeof rec.transactionTimeMillis !== 'number' ||
      !Number.isSafeInteger(rec.transactionTimeMillis)
    ) {
      abort(displayId, 'transaction_time_millis 缺失(退款證據不完整)');
    }
    return {
      displayId,
      verdict: 'refund-confirmed',
      evidenceLevel: 'system-readback',
      recTradeId: rec.recTradeId,
      recordStatus: rec.recordStatus,
      amount: rec.amount,
      refundedAmount: rec.refundedAmount,
      transactionTimeMillis: rec.transactionTimeMillis,
      note: '全額退款證據成立(record_status=3、refunded_amount=授權金額)',
    };
  }

  // pending 兩筆:只收 -1(ERROR)/ 5(CANCEL)。0(AUTH)與 4(PENDING)是「交易在途」——
  // 三筆 3DS 已啟動、4 是最可能的實際值,預期會發生;出現即 abort raise Sean,不算例外路徑。
  if ((PENDING_ORDERS as readonly string[]).includes(displayId)) {
    if (rec.recordStatus !== -1 && rec.recordStatus !== 5) {
      abort(
        displayId,
        `pending 單 record_status ${rec.recordStatus} 不在自動放行集合 {-1,5}(0=AUTH/4=PENDING 為交易在途,raise Sean 附證據)`,
      );
    }
    const millis =
      typeof rec.transactionTimeMillis === 'number' && Number.isSafeInteger(rec.transactionTimeMillis)
        ? rec.transactionTimeMillis
        : null;
    return {
      displayId,
      verdict: 'not-charged-confirmed',
      evidenceLevel: 'system-readback',
      recTradeId: rec.recTradeId,
      recordStatus: rec.recordStatus,
      amount: rec.amount,
      refundedAmount: typeof rec.refundedAmount === 'number' ? rec.refundedAmount : null,
      transactionTimeMillis: millis,
      note:
        millis === null
          ? '未授權/已取消證據成立;transaction_time_millis 缺值(TapPay 對 ERROR/CANCEL 未必帶,記錄缺值原因)'
          : '未授權/已取消證據成立',
    };
  }

  abort(displayId, '不在 §8.7 判定對象中(程式錯誤)');
}

/**
 * 裁決六筆。任何 abort 條件 = throw(orchestrator 據以 ROLLBACK);正常回傳 = 逐筆 audit 列。
 * `results` 只收五筆有鍵者(以 displayId 為鍵);0101 不得出現在 results(出現 = 有人偷查)。
 */
export function judgeReadback(
  facts: readonly D1AttemptFact[],
  results: ReadonlyMap<string, TapPayRecordResponseWire>,
): readonly D1ReadbackAuditRow[] {
  assertFactSet(facts);

  // 🔴 結果 key set 必須精確等於五筆有鍵者(codex K2):多 = 有人查了不該查的
  //    (含 0101 走替代鍵),少 = 漏查;兩個方向都 abort。
  const keyedIds = facts.filter((f) => f.displayId !== NO_KEY_ORDER).map((f) => f.displayId);
  const resultKeys = [...results.keys()].sort();
  if (resultKeys.join() !== [...keyedIds].sort().join()) {
    throw new Error(
      `D1 read-back abort:結果 key set 與五筆有鍵者不符(實 ${resultKeys.join(',') || '空'});禁用替代鍵、不得多查少查`,
    );
  }

  const rows: D1ReadbackAuditRow[] = [];
  for (const fact of facts) {
    if (fact.displayId === NO_KEY_ORDER) {
      rows.push({
        displayId: fact.displayId,
        verdict: 'sean-attested-no-key',
        evidenceLevel: 'sean-attested',
        recTradeId: null,
        recordStatus: null,
        amount: null,
        refundedAmount: null,
        transactionTimeMillis: null,
        note: SEAN_ATTESTED_NOTE,
      });
      continue;
    }

    const wire = results.get(fact.displayId);
    if (!wire) abort(fact.displayId, '缺 read-back 結果(五筆有鍵者一筆都不能少)');

    // top status:0/2 皆為查詢成功語意(與交易狀態正交);其他 = 查詢本身失敗,不得解讀。
    if (wire.status !== 0 && wire.status !== 2) {
      abort(fact.displayId, `Record API top status ${wire.status} 非查詢成功(0/2)`);
    }

    if (wire.records.length === 0) {
      if (fact.displayId === NO_HIT_TOLERATED) {
        rows.push({
          displayId: fact.displayId,
          verdict: 'keep-original-no-hit',
          evidenceLevel: 'official-no-hit',
          recTradeId: fact.recTradeId,
          recordStatus: null,
          amount: null,
          refundedAmount: null,
          transactionTimeMillis: null,
          // 🔴 措辭合約:只能說「正式商戶查無」。查無 ≠ sandbox 已證實(§8.4:880 R22)。
          note: '正式商戶查無此 rec_trade_id;依 §8.4 R21 保持原值,Sean 授權怎樣處理都好',
        });
        continue;
      }
      if ((NO_HIT_TOLERATED_WHEN_UNPAID as readonly string[]).includes(fact.displayId)) {
        // 🔴 窄化前提:零筆只證明「正式商戶沒這筆」。要它等於「沒收到錢」,DB 必須也說沒收到。
        //    DB 說收過錢卻查無 = 兩邊矛盾(可能是別的商戶收的),絕不在不可逆刪除前放行。
        if (fact.paymentStatus !== NO_HIT_REQUIRED_PAYMENT_STATUS) {
          abort(
            fact.displayId,
            `正式商戶查無,但 payment_status='${fact.paymentStatus}'(應 '${NO_HIT_REQUIRED_PAYMENT_STATUS}')` +
              ' —— DB 說收過錢而正式商戶查無 = 兩邊矛盾,停下重問 Sean',
          );
        }
        rows.push({
          displayId: fact.displayId,
          verdict: 'not-charged-no-hit',
          evidenceLevel: 'official-no-hit',
          recTradeId: fact.recTradeId,
          recordStatus: null,
          amount: null,
          refundedAmount: null,
          transactionTimeMillis: null,
          // 🔴 措辭合約(§8.4:880 R22)同樣適用:只能說「正式商戶查無」,不得寫「sandbox 已證實」。
          note:
            `正式商戶查無此 rec_trade_id,且 orders.payment_status='${NO_HIT_REQUIRED_PAYMENT_STATUS}'` +
            `(兩邊口徑一致 = 未收款);${SEAN_TAPPAY_CONSOLE_ATTESTATION}`,
        });
        continue;
      }
      abort(fact.displayId, '正式商戶查無(正式站真刷必有紀錄,零筆 = abort)');
    }
    if (wire.records.length > 1) {
      abort(fact.displayId, `要求唯一命中,實 ${wire.records.length} 筆`);
    }

    rows.push(judgeHit(fact, wire.records[0]!));
  }
  return rows;
}
