import 'server-only';
import { TapPayChargeAdapter, tapPayUrlsFor, type TapPayEnv } from '@pcm/adapters/server';

// composition.ts — 後台付款 composition root(M-3 RW2b;對照組 = apps/storefront/src/lib/payment/composition.ts)
//
// admin 唯一注入金流 server-only adapter 的「受控單檔」:RW2c 的退款 action 只 import 本檔,
// 不自己 `new TapPayChargeAdapter`、不自己讀 `TAPPAY_*`。
//
// 🔴 三端點 URL 走 `@pcm/adapters/server` 的 `tapPayUrlsFor`(RW2a 搬入)並以**物件展開**注入:
//   admin 複製第二份「正確值」正是「sandbox/production 對調也全綠」那類靜默失效的溫床
//   (`packages/adapters/src/tappay/endpoints.ts:4-6`)。本檔零端點字面 =
//   composition-tappay-wiring.test.ts 機械守。
//
// 🔴 server-only(本檔 import 'server-only'):Partner Key / Merchant ID 絕不進 client bundle;
//   env 在 factory 內讀(per-request、不 module-top throw),對齊 note-repository.ts 的 server-only 紀律。
//
// 🔴🔴 env **必須用動態 `process.env[name]` 讀**(與 storefront composition、
//   `packages/adapters/src/supabase/client.ts:25-27` 同一種讀法)—— 這不是風格,是正確性:
//   Next 會把**靜態** `process.env.NEXT_PUBLIC_*` 在 **build 時**內聯成字面值,而真正決定帳本去處的
//   `createSupabaseServiceClient()` 用的是動態讀法(runtime 值)。兩種讀法混用 = build 用正式 URL、
//   runtime 換成別的庫時,**本檔的配對斷言看到的是舊值、帳本 client 看到的是新值** ⇒ 守門量的東西
//   跟它要保護的東西不是同一顆(關卡2 codex C1)。要比對,就得跟被比對者用同一個機制讀。

/**
 * 正式站帳本 DB 的 host(Supabase project ref `bmpnplmnldofgaohnaok`;非機密、repo 內既有多處字面,
 * 例如 `packages/adapters/src/supabase/database.types.ts:11` 的重 gen 命令)。
 *
 * 🔴 **刻意寫死、不做成 env**:這條規則本身就是要擋「env 設錯」——把判準交給 env,
 * 設錯 env 的那一刻判準也一起錯,守門變裝飾。
 */
export const PROD_SUPABASE_HOST = 'bmpnplmnldofgaohnaok.supabase.co';

/**
 * 環境配對 fail-closed 斷言:**TapPay 環境**與**帳本 DB**(`NEXT_PUBLIC_SUPABASE_URL`,
 * `createSupabaseServiceClient()` 寫 `order_refunds` 的去處,`packages/adapters/src/supabase/client.ts:60-63`)
 * 必須同一側。回 `null` = 配對成立;回字串 = 拒絕理由。
 *
 * 兩種被擋掉的誤配對,各自的實際後果:
 * - `production` TapPay × 非正式帳本:動的是真錢,帳本卻寫在別的庫 ⇒ 正式站沒有這筆退款的任何紀錄,
 *   RW4 對帳與 remaining 額度全部看不到它。
 * - `sandbox` TapPay × 正式帳本:正式訂單被寫進 `order_refunds`(真的佔 single-flight 與可退額度),
 *   而 sandbox 根本碰不到那筆 `rec_trade_id` ⇒ 帳本被污染、客人的錢一毛沒退。
 *
 * 🔴 **誠實邊界 —— 這道斷言擋不住什麼**:
 * ①**同一側但金鑰是別的商戶**:TapPay partner key 沒有 sandbox/production 形狀標記,機械判別不了。
 * ②**非正式站的 Supabase 專案裡裝的是正式資料複本**:會被當成 sandbox 側放行。
 * ③**env 對、但 `TAPPAY_MERCHANT_ID` 與該筆交易的商戶不同**:由 adapter 的 recordQuery 恆帶
 *   `merchant_id` 過濾(`packages/adapters/src/tappay/TapPayChargeAdapter.ts:507`)+ plan §2 G0
 *   「恰 1 筆且 recTradeId 相符」在 action 層擋,不在本檔。
 * ④**正式站日後改用自訂網域連 Supabase**:host 不再是 `PROD_SUPABASE_HOST` ⇒ 判定會整個反過來
 *   (`production` 被誤擋、`sandbox × 正式帳本` 被誤放)。真要改網域時**必須同時改本常數**;
 *   誤擋那半邊會當場炸出來,誤放那半邊不會 —— 這是本守門已知的單向盲區。
 */
export function tapPayEnvPairingViolation(env: TapPayEnv, supabaseUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(supabaseUrl);
  } catch {
    // 解析不出來 = 判不出在哪一側 ⇒ 拒絕(不得因為「看不出來」而放行)。
    return `NEXT_PUBLIC_SUPABASE_URL 不是合法 URL、無法判定帳本 DB 屬於哪一側`;
  }
  // 🔴 `new URL()` 成功 ≠ 判得出 host:`file:///x` 解析得過但 hostname 是空字串(⇒ 會被當非正式站
  //    放行),`ftp://<正式 host>` 則會被當成正式站(關卡2 codex C3)。
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return `NEXT_PUBLIC_SUPABASE_URL 協定須為 http/https(got '${url.protocol}')`;
  }
  // 🔴 `.hostname` 不是 `.host`:帶 port 的正式站 URL(反向代理/自訂 port)用 `.host` 會比不中
  //    ⇒ 「sandbox × 正式帳本」那一格靜默放行。port 不影響「這是不是正式站」。
  // 🔴 再剝尾端的點:`...supabase.co.` 是合法且**DNS 真的連得通**的 FQDN 寫法,`hostname` 原樣保留
  //    ⇒ 不剝就是一個一個字元就能繞過的後門(code-reviewer R1 MF4)。
  const host = url.hostname.replace(/\.+$/, '');
  // 🔴 剝完尾點才檢查非空 —— **順序是重點**(關卡2 codex R2-1):協定 allowlist 只蘊含
  //    「原始 hostname 非空」,`http://.` 解析得過、hostname 是 `.`、剝完變空字串 ⇒ 不是正式站 ⇒
  //    「sandbox × 正式帳本」那格照樣放行。這條在剝點**之前**寫就是個永不觸發的裝飾。
  if (host === '') {
    return `NEXT_PUBLIC_SUPABASE_URL 沒有可判定的 host(正規化後為空)`;
  }
  const isProdLedger = host === PROD_SUPABASE_HOST;
  if (env === 'production' && !isProdLedger) {
    return `TAPPAY_ENV=production 但帳本 DB 是 ${host}(非正式站 ${PROD_SUPABASE_HOST})`;
  }
  if (env === 'sandbox' && isProdLedger) {
    return `TAPPAY_ENV=sandbox 但帳本 DB 是正式站 ${PROD_SUPABASE_HOST}`;
  }
  return null;
}

/** 讀必要 env、缺則 throw(fail fast;讀法必須與 `createSupabaseServiceClient` 同機制,見檔頭)。 */
function requireEnv(name: string): string {
  // eslint-disable-next-line no-restricted-syntax -- 受控例外:本檔 server-only(L1 import 'server-only')、不進 client bundle;且**刻意**要動態讀 —— 靜態讀會被 Next build-time 內聯,與帳本 client 的 runtime 讀值分岔(檔頭 🔴🔴;backlog #182 同款受控例外見 adapters/supabase/client.ts:25-27)
  const value = process.env[name];
  if (!value) {
    throw new Error(`缺少必要環境變數:${name}`);
  }
  return value;
}

/**
 * 後台用得到的 TapPay 面:只有退款本體與 G0 baseline 反查。
 *
 * 🔴 回這個窄型別而非 `TapPayChargeAdapter` 本身,買到的是:它帶 `private readonly config`
 * (`packages/adapters/src/tappay/TapPayChargeAdapter.ts:97`)⇒ 型別是 nominal 的,RW2c 的單元測試
 * 塞不進替身、得繞 cast。
 *
 * ⚠️ **只是型別層**(關卡2 codex C5):runtime 回的仍是完整 adapter,呼叫端硬轉型還是叫得到
 * `charge()`。「後台不刷卡」這件事的實際承重點是「composition 是唯一取得管道 + 本片的三格結構守門」,
 * 不是這個 `Pick`。
 */
export type AdminRefundTapPay = Pick<TapPayChargeAdapter, 'refund' | 'recordQuery'>;

/**
 * 建 TapPay adapter(退款 = `refund()` + baseline `recordQuery()`;RW2c 唯一取得管道)。
 *
 * `TAPPAY_ENV` fail-closed 只接 `'sandbox'|'production'`;**環境配對斷言排在建構之前** ——
 * 配對不成立時連 adapter 都不存在,不靠呼叫端記得先驗。
 */
export function getTapPayAdapter(): AdminRefundTapPay {
  const env = requireEnv('TAPPAY_ENV');
  if (env !== 'sandbox' && env !== 'production') {
    throw new Error(`TAPPAY_ENV 須為 'sandbox' 或 'production'(got '${env}')`);
  }

  const violation = tapPayEnvPairingViolation(env, requireEnv('NEXT_PUBLIC_SUPABASE_URL'));
  if (violation) {
    throw new Error(`TapPay 環境與帳本 DB 配對不成立、拒絕建立退款用 adapter:${violation}`);
  }

  return new TapPayChargeAdapter({
    partnerKey: requireEnv('TAPPAY_PARTNER_KEY'),
    merchantId: requireEnv('TAPPAY_MERCHANT_ID'),
    ...tapPayUrlsFor(env),
  });
}
