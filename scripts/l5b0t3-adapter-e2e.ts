/**
 * L5b-0-t3:**跨 adapter→真 DB** 的端到端格(plan §5.3 那條「不得只在 mock 掉的層測」)。
 *
 * 為什麼需要它:§5.3 的 14 個呼叫端座標**全部**有正向覆蓋,但**全是 mock 掉
 * `settleCharge` / `confirmer.confirm` 的呼叫端測試** —— 它們證明「呼叫端把參數傳對了」,
 * 證不了「這串參數真的餵得進那支 RPC、而且 RPC 的拒絕真的被 adapter 分類對」。
 * 本檔補的正是中間那一跳(memory `feedback_assertion-measures-the-wrong-thing` 第四形狀:
 * 兩端各有測試、中間透傳一跳無人守,刪掉那一跳兩頭照樣綠)。
 *
 * 跑法(由 `scripts/l5b0t2-verify.sh` 帶起、不單獨跑;clone DB 與 fixture 都由它準備):
 *   L5B0T3_DSN=… L5B0T3_ORDER=… L5B0T3_SUPERSEDED_ORDER=… L5B0T3_AMOUNT=… L5B0T3_REC=… \
 *     pnpm exec tsx scripts/l5b0t3-adapter-e2e.ts
 *
 * ══ 🔴 誠實邊界:這一格證不了什麼 ═══════════════════════════════════════
 *   `PaymentConfirmerAdapter` 的**預設** client factory 走 `buildPgConfig`,它把 host **釘死**在
 *   Supabase pooler 網域並強制 verify-full CA 驗證 ⇒ **結構上連不到 127.0.0.1**
 *   (那是刻意的 MITM 縱深、不是 bug)。⇒ 本格從 constructor 的 `clientFactory` 注入口換成本機 pg Client。
 *   **被驗到**:adapter 真正送出的 SQL 字面與參數轉型($1::uuid/$2::integer/$3::text)、
 *     `parseConfirmResult` 對 jsonb 回傳的解讀、`classifyPgError` 把 P0001 映成 `rejected`,
 *     而且這一整串是打在**真的 RPC**(含 L5b-0 閘三)上。
 *   **沒被驗到**:TLS/CA/host 釘死那一段(本機構造不出來)⇒ 不在本格宣稱、要驗得換別的層。
 */
import { Client } from 'pg';
import { PaymentConfirmerAdapter, type PgClientLike } from '../packages/adapters/src/payment/PaymentConfirmerAdapter';
import { PaymentConfirmError } from '../packages/domain/src/payment/errors';
import type { ConfirmOrderPaymentInput } from '../packages/domain/src/payment/types';
import type { OrderId } from '../packages/domain/src/order/types';
import type { Money, MoneyAmount } from '../packages/domain/src/shared/types';

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`缺環境變數 ${name}(本檔由 l5b0t2-verify.sh 帶起、不單獨跑)`);
  return v;
}

const DSN = need('L5B0T3_DSN');
const ORDER_OK = need('L5B0T3_ORDER') as OrderId;
const ORDER_SUPERSEDED = need('L5B0T3_SUPERSEDED_ORDER') as OrderId;
const REC = need('L5B0T3_REC');
const AMOUNT: Money = {
  amount: Number(need('L5B0T3_AMOUNT')) as MoneyAmount,
  currency: 'TWD',
};

/** 本機 pg client(繞開預設 factory 的 pooler host 釘死 + TLS;理由見檔頭誠實邊界)。 */
const localFactory = (connectionString: string): PgClientLike =>
  new Client({ connectionString }) as unknown as PgClientLike;

let pass = 0;
let fail = 0;
const ok = (m: string): void => { pass += 1; console.log(`  ok   ${m}`); };
const bad = (m: string): void => { fail += 1; console.log(`  FAIL ${m}`); };
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function input(orderId: OrderId, recTradeId: string): ConfirmOrderPaymentInput {
  return { orderId, amount: AMOUNT, recTradeId };
}

async function main(): Promise<void> {
  const adapter = new PaymentConfirmerAdapter(DSN, localFactory);
  // 🔴 ③ 的判別力綁在 ① 上:任何 P0001 都會被分類成 rejected(查無此單、已取消、金額不符…都是),
  //    所以「③ 綠」單獨看**證不了是閘三擋的**。實測踩過:拿兩個不存在的 uuid 去跑,③ 照樣綠。
  //    ⇒ ① 先證「這個形狀的單、這串參數,是真的收得了款的」,③ 才有資格說「差別只在 superseded」。
  let premiseOk = false;

  // ① 正向:未讓路的單 ⇒ 真的翻 paid、回 confirmed:true / idempotent:false
  try {
    const res = await adapter.confirm(input(ORDER_OK, REC));
    if (res.confirmed === true && res.idempotent === false) {
      premiseOk = true;
      ok('端到端①:adapter → 真 confirm_order_payment → confirmed:true / idempotent:false');
    } else {
      bad(`端到端①:回傳不如預期(${JSON.stringify(res)})`);
    }
  } catch (err) {
    bad(`端到端①:合法確認被擋(${msg(err)})⇒ 閘誤擋、或 adapter 送出的參數/型別不對`);
  }

  // ② 冪等:同 rec 同額重放 ⇒ idempotent:true(證 adapter 讀得懂冪等樹的回傳形狀)
  try {
    const res = await adapter.confirm(input(ORDER_OK, REC));
    if (res.confirmed === true && res.idempotent === true) {
      ok('端到端②:同 rec 同額重放 → idempotent:true');
    } else {
      bad(`端到端②:重放回傳不如預期(${JSON.stringify(res)})`);
    }
  } catch (err) {
    bad(`端到端②:重放竟 throw(${msg(err)})`);
  }

  // ③ 🔴 負向:該單有活的讓路 attempt ⇒ RPC RAISE P0001。
  //    adapter 必須分類成 **rejected**(孤兒、不得重 charge),不是 unreachable(可重試)。
  //    這一跳正是 mock 層測不到的:mock 只能假裝 adapter 回了什麼,不會告訴你真 RPC 的 RAISE 被怎麼歸類。
  if (!premiseOk) {
    bad('端到端③:前提被打穿(① 沒過)⇒ 就算它紅得漂亮也證不了是閘三擋的,本格判為無判別力');
  } else {
  try {
    await adapter.confirm(input(ORDER_SUPERSEDED, `${REC}-SUP`));
    bad('端到端③:讓路單竟被 adapter 收下 ⇒ 閘三沒擋、或 adapter 把 RAISE 吞了');
  } catch (err) {
    if (err instanceof PaymentConfirmError && err.code === 'rejected') {
      ok('端到端③:讓路單 → P0001 → adapter 分類成 rejected(不是 unreachable)');
    } else if (err instanceof PaymentConfirmError) {
      bad(`端到端③:有 throw 但分類成 ${err.code} ⇒ 上游會當可重試、對讓路單重打 charge`);
    } else {
      bad(`端到端③:throw 的不是 PaymentConfirmError(${msg(err)})`);
    }
  }
  }

  console.log(`PASS=${pass} FAIL=${fail}`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.log(`  FAIL 端到端 harness 自身爆掉:${msg(err)}`);
  console.log('PASS=0 FAIL=1');
  process.exitCode = 1;
});
