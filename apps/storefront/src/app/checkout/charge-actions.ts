'use server';

// app/checkout/charge-actions.ts — 結帳刷卡 server action(M-3 ②-③e、plan v6 §7)
//
// 🔴 鐵則 12 成交 path:組「建單(既有 placeOrder)→ charge → confirm」整鏈。
// 前端契約 = { addressId, shippingMethod, invoice, lines, prime, cartSessionId, agreed,
//   notificationEmail?(只在 flag-on 時進 schema;flag-off 一律 strip) } —— **零價、零 cardholder、零 orderId**
// 🔴 B-4 更正(codex 關卡2 nit 3):~~不採用 client 這個值~~ 說反了。實際是
//   **flag on ⇒ 採用【經 server schema 驗過的】那個值(收件人第一候選);flag off ⇒ 該鍵被 strip、完全不進來**。
// (client 多塞的鍵一律不讀;金額 = server read-back orders.total 單一來源;cardholder = server 組裝)。
//
// 信任邊界(五層 + 付款層;沿用 addAddressAction 既有五層信任邊界 pattern):
// - ① server session getUser:純登入 gate(不把 user.id 傳進建單 use-case;身分由 create_order RPC
//      auth.uid() 重查)。user.id/email 餵 cardholder 組裝**與 B-4 通知信收件人解析**(本就 server session 權威值)。
// - ② CheckoutInput + PlaceOrderLinesInput + TapPayPrimeInput 三段 safeParse(strip 未知欄)。
// - ③ buildCardholder **先於建單**(PII 缺失不產垃圾 unpaid 單;fail → 對應引導文案、placeOrder 零呼叫)。
// - ④ placeOrder(RPC server 權威算價)→ ⑤ findTotal read-back(🔴 單一金額來源;null → 拒、零扣款)
//   → ⑥ confirmPayment(鎖 → charge → 雙軌簿記 → PF-X3 → confirm → 收斂補記;②-③c-2)。
// - 🔴 error 不洩:catch 全吞回通用字面(Q2=A);**走到 throw 的路徑全屬零扣款**(begin throw 含內;
//   charge/confirm 失敗已由 use-case 收斂為 outcome、不會 throw)→ 通用「請稍後再試」誠實且安全。
//
// outcome → UI 六態(plan v6 §7;文案常數 = 單一真相、②-④ 直接顯示):
// - paid → { ok:true, displayId }(②-⑤ 完成頁)。
// - charge_failed(recordPersisted:true)→ 卡拒未扣款、可立即重試。
// - charge_failed_wait(recordPersisted:false、round5 MF1)→ 誠實「未扣款」+ 請稍候(鎖殘留、
//   per-user 閘 10 分鐘自動過期;不誘導立即重試、不謊稱「已收」)。
// - processing → charge_unknown / orphan(全 reason)/ locked(order_locked|not_unpaid):
//   勿重複付款(成功真相 = confirm 成功;重試走 ②-⑥ 冪等 confirm 非重 charge)。
// - 🔴 settlement_required(cart dedup duplicate/needs_settle、本次零扣款)→ 3DS-7 7c-2 即時裁決
//   adjudicateSettlement(取代 7b「一律處理中」):
//     duplicate / settleCharge=paid(既有單 DB 確定 paid)→ paid-equivalent({ ok:true, displayId:既有單 }、
//       hook clear+regenerate;codex K1 must-fix:換 key 防下次重購撞已 paid sibling D2 誤擋)。
//     settleCharge=failed/no_attempt → 放行重刷(charge_failed、釋鎖、保留 key)。
//     settleCharge=pending / throw → 短 hold(processing、保留 key、不背景輪詢〔Q3=A〕)。
// - in_flight → locked(user_in_flight):🔴 不帶 displayId(此請求的新單零扣款、不得以
//   「付款單號/已收」呈現;codex 關卡1 round3 C)。
//
// 🔴 3DS-6a(flag on=`isThreeDSEnabled()`、僅 sandbox/staging):⑥ 改走 initiatePayment(回 payment_url
//   跳轉、不請款)→ mapInitiateOutcome 映 `{ redirect:true, redirectUrl }`(client 整頁跳 TapPay);非成功
//   態(charge_unknown/settlement_required/locked/init_failed)沿用上方同名 UI 態(無 paid、結算交 settleCharge)。
//   ①-⑤ 兩路徑共用;result_url base+secret 在 placeOrder「前」preflight(缺/壞 → 零扣款 + 零垃圾單)。
//   flag off = 同步 confirmPayment(逐字不動、現況)。🔴 payment_url 含 token、零入 log。

import {
  placeOrder,
  confirmPayment,
  initiatePayment,
  settleCharge,
  preflightReleaseSibling,
} from '@pcm/use-cases';
import { createCheckoutInputSchema, PlaceOrderLinesInput, TapPayPrimeInput } from '@pcm/schemas';
import { resolveNotificationRecipient } from '@/lib/email/resolve-notification-recipient';
import { CART_LINES_INVALID_MESSAGE } from '@/lib/checkout/checkout-messages';
import type {
  ConfirmPaymentOutcome,
  InitiatePaymentOutcome,
  PlaceOrderInput,
  PlaceOrderLine,
  SettlementRequiredContext,
  SettleChargeOutcome,
} from '@pcm/domain';
import { getOrderRepo, getCustomerRepo, getAddressRepo } from '@/lib/auth/composition';
import {
  getTapPayAdapter,
  getPaymentConfirmer,
  getChargeAttemptStore,
  getSettleChargeDeps,
  getPreflightReleaseSiblingDeps,
  getPollSettleThrottle,
} from '@/lib/payment/composition';
import { buildCardholder, type BuildCardholderFailReason } from '@/lib/payment/cardholder';
import { isThreeDSEnabled } from '@/lib/payment/three-ds-flag';
import { isBankTransferCheckoutEnabled } from '@/lib/payment/bank-transfer-flag';
import { isCheckoutNotificationEmailEnabled } from '@/lib/email/notification-email-gate';
import { resolveThreeDSConfig, buildResultUrls, isHttpsUrl } from '@/lib/payment/three-ds-urls';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { headers } from 'next/headers';
import { CURRENT_TERMS_VERSION } from '@/lib/legal/terms-version';
import { safeErrorName, safeLog } from '@/lib/safe-log';
import type { CheckoutFieldErrors } from './checkout-form-types';

// 🔴 3DS-7:cart_session_id 局部 uuid 驗(不改共用 CheckoutInput;沿用
//   callback/page.tsx 同層 UUID_RE 慣例 —— storefront 無 zod 直接依賴,不引 z.uuid 避脆弱 transitive import)。
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 文案常數(單一真相;②-④ client 直接顯示、不另維護字面)。
const MSG = {
  generic: '付款失敗,請稍後再試或聯繫客服 LINE',
  chargeFailed: '付款未成功,請確認卡片資訊後重試',
  chargeFailedWait: '付款未成功、未扣款;系統忙碌中,請約 10 分鐘後再試',
  processing: '付款已收或處理中,請勿重複付款,客服 LINE 將協助確認',
  settlementRequired: '訂單付款狀態確認中,請勿重複付款,客服 LINE 將協助確認',
  inFlight: '您有一筆付款正在處理中,請稍候再試',
} as const;

/**
 * 🔴 M-4b L4b:撞到 per-user 閘時,對那張在途單觸發 Record 查詢的節流窗(秒)。
 *
 * 值刻意與輪詢端點的 `POLL_SETTLE_THROTTLE_SECONDS` 相同(10)—— 兩者共用 **同一張 order 的
 * `last_poll_settle_at` 時窗**(`claim_order_poll_settle` RPC),不是各自獨立的預算。
 * ⚠️ 誠實邊界:客人剛輪詢過那張在途單、10 秒內又撞窗 ⇒ 節流不放行 ⇒ 退回**今天的行為**
 * (擋住、請稍候)。那不是新的洞,是「這一次沒有改善」。
 * ⚠️ 另注:`settle_attempt_count < 8` 那個 ceiling 是 **sweeper 的計數器**,輪詢與本路徑都不遞增它
 * (`20260621120000_*.sql:51` 逐字「輪詢窗內 count 恆=0」)—— 別把它當成本路徑的預算。
 */
const IN_FLIGHT_SETTLE_THROTTLE_SECONDS = 10;

export type ChargePaymentActionResult =
  | { fieldErrors?: CheckoutFieldErrors; formError?: string } // 驗證/登入/建單失敗(零扣款)
  | { ok: true; displayId: string } // paid(含冪等)→ ②-⑤ 完成頁(僅同步 flag-off 路徑)
  | { redirect: true; redirectUrl: string } // 🔴 3DS-6a:3DS 啟動成功 → client 整頁跳轉 TapPay(非 paid、付款狀態非終態)
  | { ok: false; payment: 'charge_failed'; displayId: string; message: string }
  | { ok: false; payment: 'charge_failed_wait'; displayId: string; message: string }
  // 🔴 displayId-presence 是契約:**有單號**=既有 processing(orphan/charge_unknown/locked,已建單、hook 清車);
  //   **無單號**=R3 preflight hold(新單未建、§2.3 保留 cart、hook 不清車)。非 hold 的 processing producer 一律必帶 displayId。
  | { ok: false; payment: 'processing'; displayId?: string; message: string }
  | { ok: false; payment: 'in_flight'; message: string }; // 🔴 無 displayId

/**
 * 刷卡成交。成功 → { ok:true, displayId };付款層結果 → { ok:false, payment, message };
 * 驗證/登入/建單失敗 → { fieldErrors | formError }(零扣款)。
 */
export async function chargePaymentAction(input: unknown): Promise<ChargePaymentActionResult> {
  // ① 登入 gate(user.id/email 之後只餵 cardholder server 組裝)。
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { formError: '請重新登入' };
  }

  const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;

  // ②a 單一 Email flag 同步選 schema：off 維持舊 3 欄並 strip 偷塞值；on 要求 Email 並做 server canonical 二次驗證。
  const notificationEmailEnabled = isCheckoutNotificationEmailEnabled();
  const checkoutSchema = createCheckoutInputSchema(notificationEmailEnabled);
  const parsedCheckout = checkoutSchema.safeParse({
    addressId: raw.addressId,
    shippingMethod: raw.shippingMethod,
    invoice: raw.invoice,
    // 🔴 段 1-B:付款方式。**必填、無預設** —— client 少送 ⇒ zod 這裡就擋(fail-closed)。
    //   🛑 而 **TypeScript 在這一格擋不到**:`raw` 是 FormData 來的、沒有型別化的建構點
    //     (實測:schema 加這個必填欄之後 `typecheck` **零錯誤**, 而 **123 支測試紅**)
    //   ⇒ 📌 **擋它的是 zod, 不是型別。**
    paymentChannel: raw.paymentChannel,
    ...(notificationEmailEnabled ? { notificationEmail: raw.notificationEmail } : {}),
  });
  if (!parsedCheckout.success) {
    const fieldErrors: CheckoutFieldErrors = {};
    for (const issue of parsedCheckout.error.issues) {
      const p0 = issue.path[0];
      const p1 = issue.path[1];
      if (
        p0 === 'invoice' &&
        (p1 === 'carrier' || p1 === 'title' || p1 === 'taxId' || p1 === 'donateCode')
      ) {
        (fieldErrors.invoice ??= {})[p1] = issue.message;
      } else if (
        p0 === 'addressId' ||
        p0 === 'shippingMethod' ||
        p0 === 'notificationEmail' ||
        p0 === 'paymentChannel'
      ) {
        fieldErrors[p0] = issue.message;
      }
    }
    if (Object.keys(fieldErrors).length > 0) {
      return { fieldErrors };
    }
    return { formError: '結帳資料有誤,請返回確認' };
  }

  // ②a-2 🔴 匯款總開關(M-4b 段 1;擋在**任何建單/付款/settle 副作用之前**、與其餘 ②x 同一層)。
  //   ⛔ ~~原句寫「擋在任何副作用之前」~~ **過強**(codex 關卡2 nit):它上面已經有
  //      `createServerSupabaseClient()` 與 `auth.getUser()`(:124 附近)—— 那些是讀, 而它們也是副作用。
  //   flag off 而 client 送 bank_transfer ⇒ 拒。今天 UI 沒有那個選項(radio 仍隱藏)
  //   ⇒ 走到這裡的只會是**繞過 UI 的請求**,而那正是這道閘要擋的形狀。
  //
  // 🔴 **為什麼需要它**(不是滾動發布,是一個會兩邊都付錢的洞):
  //   begin_charge_attempt 的 cart dedup 述詞看不見「unpaid + 零 attempt」的匯款單
  //   ⇒ 先建匯款單再回頭刷卡 ⇒ dedup 放行 ⇒ 一張刷卡付掉、一張等匯款。
  //   全文與啟用條件在 `@/lib/payment/bank-transfer-flag` 的檔頭 + 板列 ⟦b4-BANKORDERINVISIBLE⟧。
  //
  // 🛑🛑 **而這道閘的射程只到【這支 action】—— 它不是那個洞的鎖**(codex 關卡2 must-fix ①, 我核過):
  //   🔬 `20260904020000_m4b_create_order_payment_channel.sql:533` 逐字
  //      `GRANT EXECUTE ON FUNCTION public.create_order(...) TO authenticated;`
  //   ⇒ 🔴 **任何登入中的客人都能直接打 PostgREST 的 `/rpc/create_order` 送 `bank_transfer`**,
  //      而 DB 的白名單(同檔 `:168`)**收它** ⇒ 完全不經過這一行。
  //   ⇒ ⇒ 📌 **所以「flag off ⇒ 零建單」只對走這支 action 的人成立。不要把它讀成系統性保證。**
  //
  // 🔴 **⇒ 所以順序是綁死的:RPC 那一側要有自己的 opt-in 守門, 或 A 不得先於分岔上正式庫。**
  //    ⚠️ **而「那條繞路今天走不通嗎」是【當日部署狀態】, 不寫在這裡**(codex 關卡2 R2 nit ④)——
  //    程式註解只放**部署不變式**;會過期的那半在板列 ⟦b4-BANKORDERINVISIBLE⟧ 的「flag 可啟用條件」,
  //    那裡有量測日期與正負對照。📌 **寫在碼裡的當日狀態, 在它變假的那天沒有人會回來改它。**
  //
  // ✅ **而不依賴任何部署狀態的那一道在下面 ⑤c** —— 建出來的單是匯款就不扣款, 一律。
  //
  // 🔵 **文案為什麼沿用 '請選擇付款方式'**:那是本 schema 既有的字面
  //   (`packages/schemas/src/index.ts` paymentChannel enum 的 error)。
  //   🛑 今天這條路 UI 到不了 ⇒ **新開的頁面**沒有真客人會讀到它 ⇒ **我不在這裡發明對外文案**。
  //   ⚠️ **而「沒有真客人會讀到」有一個例外, 寫出來免得它被讀成全稱**(codex 關卡2 nit):
  //      **日後把 flag 從 on 關回 off 時**, 手上還開著舊付款頁的客人會真的送出並看到這一句。
  //   ⇒ 📌 而 flag 翻 true 的那一天它就變成看得到的字 ⇒ **那時要重新看一次這一句**
  //      (寫在這裡, 因為那時動這段碼的人打開的是這支檔)。
  if (parsedCheckout.data.paymentChannel === 'bank_transfer' && !isBankTransferCheckoutEnabled()) {
    return { fieldErrors: { paymentChannel: '請選擇付款方式' } };
  }

  // ②b 購物車線(缺/非法 variantId → REJECT 整單、zod strip 竄改的 unitPrice/tier 等鍵)。
  const parsedLines = PlaceOrderLinesInput.safeParse(raw.lines);
  if (!parsedLines.success) {
    return { formError: CART_LINES_INVALID_MESSAGE };
  }

  // ②c prime(一次性 token、形狀驗;真偽 TapPay server 驗)。
  const parsedPrime = TapPayPrimeInput.safeParse(raw.prime);
  if (!parsedPrime.success) {
    return { formError: '付款資訊缺失,請重新進行刷卡' };
  }

  // ②d cart_session_id(3DS-7:信任 client CartContext 穩定 key + server 驗 uuid 格式/非空 fail-closed)。
  //   非價/tier/身分純去重子(plan §4);偽造僅自我 DoS、無跨用戶面;begin/settleCharge 仍讀 DB row key、不信
  //   client 重送(plan §4 不變量)。缺/非法 → 零垃圾單(對齊既有 placeOrder + create_order null fail-closed)。
  const cartSessionId = raw.cartSessionId;
  if (typeof cartSessionId !== 'string' || !UUID_RE.test(cartSessionId)) {
    return { formError: '購物車工作階段資訊有誤,請重新整理頁面後再試' };
  }

  // ②e 🔴 #241 同意條款 server 驗(不信任 client)。⚠️ 2026-07-22 U3b 起前端**不再**用 payDisabled=!agreed
  //   硬擋(改為 design §7.3「仍可按、按下顯示錯誤導引」)→ 本 guard 從「縱深」升格為**唯一**權威守門。
  //   🔴 守門放 try{ 之前(buildCardholder/preflightReleaseSibling/placeOrder/charge/settle **全部之前**;codex 關卡1 B3;
  //   登入 gate + schema parse 之後=純讀/驗證、非付款副作用):agreed !== true → 任何**付款/建單/settle 副作用**前 return,
  //   零扣款零建單、不動 sibling/settle;涵蓋 flag-on(3DS)+ flag-off(同步)兩路徑。
  //   非單純 defense-in-depth:繞 UI 者須主動建構 {agreed:true} = 明確同意訊號,舉證責任推回發起端(non-repudiation;plan §3)。
  if (raw.agreed !== true) {
    return { formError: '請先閱讀並同意服務條款與隱私政策' };
  }

  try {
    // ③ 🔴 cardholder server 組裝(MUST-FIX 3、Q3=B 級聯)**先於建單**:fail → 引導文案、零垃圾單。
    const built = await buildCardholder(
      { customers: await getCustomerRepo(), addresses: await getAddressRepo() },
      { user: { id: user.id, email: user.email }, addressId: parsedCheckout.data.addressId },
    );
    if (!built.ok) {
      // 🔴 M-4b:這一行是本片**唯一**留下的痕跡,不是可有可無的 debug log(R3 換模型審查抓到)。
      //   修復前,被 TapPay 擋下的客人至少會留下一張 order + 一列 payment_charge_attempts
      //   (status 521)—— 2026-08-08 就是靠那組 DB 指紋定位到根因的。
      //   現在改成擋在 placeOrder **之前** ⇒ 零單、零 attempt。沒有這行 log,
      //   「修好了(沒人被擋)」與「大家被擋在更前面,只是不再產生證據」在觀測上**長得一模一樣**。
      //   🔴 PII(#16):只記 reason 與 userId,**email 值絕不入 log**。
      // 🔴 `safeLog` 而非裸 `console.error`(#900 R1 finding 2 的同族, 既有非本片新增):
      //    這一行在外層 try 裡 ⇒ 它自己拋會被外層那個 catch 收成 `MSG.generic`
      //    ⇒ 客人拿到的是通用字面而不是「持卡人資料」那句。零扣款, 但診斷全丟。
      //    (~~原句寫 `:340`~~ ⇒ 那個 catch 現在在 `:343`, 行號會漂 ⇒ 改成不引行號。)
      //
      // 🔴🔴 **而換成 `safeLog` 的那顆 commit 宣稱「行為零改動」—— 那句話是假的**
      //    (codex 對抗審查 2026-08-29,`⟦b4-B07⟧` must-fix ①;線G 唯讀複驗)。
      //    上面那段已經寫出差別了,這裡把它接成一句完整的話:
      //    ```
      //    console 自己拋時：
      //      舊（裸 console.error）⇒ 逃進外層 catch ⇒ MSG.generic（通用字面）
      //      新（safeLog 吞掉）    ⇒ 繼續 ⇒ mapCardholderFail(reason)（具體那一句）
      //    🔴 兩條路【都是零扣款】—— 差別只在客人看到哪一句話，而【方向是變好】
      //    ```
      //    ⚠️ **所以要改的不是這段碼**(它是對的,而且比舊的好)——
      //    **假的是那顆 commit 的 message,而 commit body 改不了** ⇒ 訂正留在這裡。
      // 📌 **而那句「行為零改動」正是它【跳過審查】的理由** ——
      //    ⇒ 一個誠實的跳審理由與一個編的,在那道閘底下印同一個綠。
      //    ⚠️ 而抓到它的是 codex,**不是我們的任何一道閘**。
      safeLog('error', '[checkout] cardholder blocked', { reason: built.reason, userId: user.id });
      return mapCardholderFail(built.reason);
    }

    // 🔴 3DS-6a:flag 讀一次 + preflight(placeOrder「前」驗 result_url base+secret;不合 → 既有 catch
    //   → MSG.generic、零扣款 + 零垃圾單;codex 關卡1 #3)。flag off → threeDSConfig=null → 走同步 ⑥。
    const threeDSConfig = isThreeDSEnabled() ? resolveThreeDSConfig() : null;

    // 🔴 R3:立即重刷 preflight(canonical §2.3、**placeOrder「前」**=否則新單先建成孤兒)。
    //   Q1=A gating:**只在 3DS 路徑跑**(threeDSConfig 非 null)。flag off → 同步路徑逐字不動、零回歸;
    //   prod flag=false → preflight 不啟用、prod 零影響。released 重刷機制本就只在 3DS async redirect 才需要。
    //   接線注意:① 在 placeOrder 前(此處);② release 三參數順序由 use-case 內固定(R2b S1、R3 不直接呼);
    //   ④ userId 餵 server 驗過登入態 user.id(L92-96 getUser、**不信 client**)。
    if (threeDSConfig) {
      const preflight = await preflightReleaseSibling(await getPreflightReleaseSiblingDeps(), {
        userId: user.id,
        cartSessionId,
      });
      if (preflight.kind === 'existing_paid') {
        // 兄弟單已付款 → 顯既有單(paid-equivalent;hook 當 paid 處理:clear + regenerateCartSession,
        //   防下次合法重購撞已 paid sibling 被 begin D2 誤擋;同 adjudicateSettlement duplicate 分支)。
        return { ok: true, displayId: preflight.displayId };
      }
      if (preflight.kind === 'hold') {
        // 確認中、稍候(§2.3:不建新單、保留 cart)。🔴 Q2=B:回 processing **無 displayId** →
        //   hook 鎖死按鈕(終態鎖、防焦慮連按再打 Record)+ 不清車(displayId 缺=hold、保留 cart)。
        return { ok: false, payment: 'processing', message: MSG.settlementRequired };
      }
      // proceed → 續往下建單 + charge(none / 已 release / failed / no_attempt;§2.3 確定未成交)。
    }

    // 🔴 #241 best-effort 同意來源 IP/UA(於 try 內抓 → 萬一 headers 異常落 generic catch、零扣款;
    //   Vercel header 順序 x-vercel-forwarded-for > x-forwarded-for > x-real-ip、取首段、截斷 128/1024;
    //   best-effort 爭議舉證、**非強身分證據**;codex 關卡1 M7/M8)。
    const reqHeaders = await headers();
    const clientIp =
      (reqHeaders.get('x-vercel-forwarded-for') ??
        reqHeaders.get('x-forwarded-for') ??
        reqHeaders.get('x-real-ip'))
        ?.split(',')[0]
        ?.trim()
        ?.slice(0, 128) ?? null;
    const clientUserAgent = reqHeaders.get('user-agent')?.slice(0, 1024) ?? null;

    // ④ 建單(零 userId/tier/price;身分/算價全 create_order RPC server 權威)。
    //   V-3a:line 可帶 optional vehicle(schema 已判別式驗+非法丟欄;RPC 端白名單重組
    //   → order_items.vehicle_snapshot;純 metadata、無價/tier 面)。
    const placeOrderInput: PlaceOrderInput = {
      lines: parsedLines.data.map(
        (l): PlaceOrderLine => ({
          variantId: l.variantId,
          quantity: l.quantity,
          ...(l.vehicle !== undefined ? { vehicle: l.vehicle } : {}),
        }),
      ),
      addressId: parsedCheckout.data.addressId,
      shippingMethod: parsedCheckout.data.shippingMethod,
      invoice: parsedCheckout.data.invoice,
      // 🔴 3DS-7:cart_session_id = client CartContext 穩定 key(②d 已驗 uuid/非空)。信任此非價/tier/身分
      //   去重子(plan §4)、取代 option A 的 server randomUUID → begin cart-instance dedup 由此叫醒生效(治本)。
      cartSessionId,
      // 🔴 段 1-A 的第 11 個參數。**新舊兩支 `create_order` 靠【名字集合】各自被唯一命中**
      //   ⇒ 送它 ⇒ 命中新那支;**不送 ⇒ 靜靜掉回舊那支、存成 tappay**。
      //   ⇒ 🛑 所以它一路到 mapper 都是**必填**, 不是 optional。
      paymentChannel: parsedCheckout.data.paymentChannel,
      // 🔴 #241 同意紀錄(server 注入、非 client):version 常數 + best-effort IP/UA → create_order 同 transaction 原子寫 order_legal_consents。
      termsVersion: CURRENT_TERMS_VERSION,
      clientIp,
      clientUserAgent,
      // 🔴 M-4a B-4:通知信收件人【無條件】送(不再受 flag 管;plan §4.1 的申報偏離 ——
      //    UI/client/server-schema 三層仍受 flag 管、仍 off,只有「送不送第 9 參」拿出來)。
      //    ~~B-3 只切到 9-param RPC 形狀;canonical 真值持久化刻意留 B-4。~~
      //    候選順位 = plan §3:①flag-on 時客人自己填的 ②session 註冊信箱 ③收件地址 email。
      //    🔴 ① 不能拿掉:flag 將來被翻成 on 時,:129-131 會強制客人填 Email,少了它會被靜默丟掉。
      notificationEmail: resolveNotificationRecipient([
        // flag-off 時 schema 沒這個鍵 ⇒ undefined ⇒ resolver 自動跳過。
        // 型別註記而非 `in` 收窄:union 上的 `in` 會把型別放大成 unknown(實測 TS2322)。
        (parsedCheckout.data as { notificationEmail?: string }).notificationEmail,
        user.email,
        built.addressEmail,
      ]),
    };
    const orderRepo = await getOrderRepo();
    const placed = await placeOrder(orderRepo, placeOrderInput);

    // ⑤ 🔴 server read-back orders.total = 單一金額來源(client 永不送價;null → 拒、此時零扣款)。
    const total = await orderRepo.findTotal(placed.orderId);
    if (!total) {
      return { formError: MSG.generic };
    }

    // ⑤b 🔴 server read-back orders.payment_channel = 客人選的付款方式真的寫進去了嗎。
    //
    // 🎯 **它守的是一個【兩端都印成功】的世界** —— TS 拿到 order id、DB 有一張合法的單。
    //    `orders.payment_channel` 是 `NOT NULL DEFAULT 'tappay'`
    //    (`20260712203000_m4a_orders_admin_columns.sql:48`)⇒ 沒送到那一欄時它**不報錯**,
    //    安靜地變成 `'tappay'`。客人選了匯款, 而單子上寫刷卡, 然後我們照刷卡的規矩去催他。
    //
    // 🔴 **而它【不是】下面那個 `PGRST202` 分支的同一族** —— 兩者各擋一半, 缺一不可:
    //    ```
    //    送 11 個名字 · A 未貼 ⇒ 找不到函式 ⇒ PGRST202 ⇒ 大聲 ⇒ 外層 catch 那支擋得到
    //    送 10 個名字(TS 把 undefined 序列化掉)· 舊 10 參簽名還在
    //                          ⇒ 解析到【舊的那一版】⇒ INSERT 不含該欄 ⇒ 吃 DEFAULT
    //                          ⇒ 🛑 安靜成功 ⇒ **只有這一發回查分得出來**
    //    ```
    //
    // 🛑 **為什麼是 `return` 而不是 `throw`(f0 交辦寫的是「丟例外」, 我改了形狀、理由在此)**:
    //    這一行在外層 `try` 裡 ⇒ **`throw` 會被下面那個 catch 收成 `MSG.generic`**
    //    ⇒ 客人看到的字面、扣款金額(零)、後續流程, **與這裡直接 return 逐字相同**
    //    ⇒ 📌 `throw` 買不到任何東西, 只多繞一圈, 而且與本檔既有慣例不一致。
    //    ✅ **f0 要的是「不可以只 log 然後繼續」, 而 `return` 沒有繼續** ⇒ 意圖照做, 形狀對齊本檔。
    //    🔴 而**訊號那一半靠 `safeLog`**:少了它, 這道守門擋下來的每一次
    //       都會與「客人自己放棄結帳」在觀測上長得一模一樣。
    const storedChannel = await orderRepo.findPaymentChannel(placed.orderId);
    if (storedChannel !== placeOrderInput.paymentChannel) {
      // 🔴 PII(#16):只記兩個 enum 值與 orderId,**零 email / 零地址 / 零金額**。
      safeLog('error', '[checkout] payment_channel read-back 不符', {
        sent: placeOrderInput.paymentChannel,
        stored: storedChannel,
        orderId: placed.orderId,
      });
      return { formError: MSG.generic };
    }

    // ⑤c 🔴🔴 **fail-closed:一張匯款單, 絕不往下走進扣款。**
    //
    // 🎯 **它擋的是今天真的存在的一條路**(codex 關卡2 R1 must-fix ② / R2 must-fix ② 逼出來的):
    //    ```
    //    flag on + 客人送 bank_transfer ⇒ 過 ②a-2 ⇒ 過 ②c prime
    //      (⚠️ prime 擋不住 —— **有卡的人選匯款, prime 照樣送得出來**)
    //    ⇒ placeOrder 建單 ⇒ 真的 DB 把 bank_transfer 正確存下來 ⇒ 上面那道 read-back **相符**
    //    ⇒ 🔴 繼續往下 ⇒ confirmPayment ⇒ **拿客人的卡, 去扣一張匯款單的錢。**
    //    ```
    // 🛑 **⇒ 而上面那道 read-back 擋不到它** —— 它問的是「存的跟送的一不一樣」,
    //    而這條路上**兩者一樣**。📌 **一道正確的守門, 在它自己的問題上答對, 而放行了另一個問題。**
    //
    // 🔵 **為什麼這一格不是「分岔」**:分岔要回 `pendingTransfer` 並把客人送到匯款資訊頁 ——
    //    那是段 1 的另一片。**這裡只做一件事:不扣款。** 建出來的單靠後台處理。
    //    ⇒ 🎯 **⇒ 所以它是 fail-closed, 不是功能。** 而它讓那格守門測試**今天就會綠**,
    //       不必留一格故意紅的測試等分岔(codex R2 逐字:「不要提交故意維持紅色的測試」)。
    //
    // 🔴 **而它【不依賴任何部署狀態】** —— 不管 A 貼了沒、flag 開了沒、RPC 有沒有被繞過去,
    //    只要這支 action 建出來的單是匯款, 它就停在這裡。
    //    ⇒ 📌 這正是它與「A 還沒 apply 所以今天安全」的差別:**後者會過期, 這一行不會。**
    if (storedChannel === 'bank_transfer') {
      safeLog('info', '[checkout] 匯款單建立完成, 不進扣款(段 1 分岔未上)', {
        orderId: placed.orderId,
      });
      return { formError: MSG.generic };
    }

    // 🔴 3DS-6a flag on:3DS 啟動半段(initiatePayment → redirect / 對帳態);結算交 settleCharge 脊椎。
    //   ①-⑤(getUser/parse/cardholder/placeOrder/findTotal)與同步路徑共用、只 ⑥ 分岔;deps 復用既有
    //   getTapPayAdapter/getChargeAttemptStore(不呼 confirmer — initiate 不 markCharged/confirm)。
    if (threeDSConfig) {
      const { frontendRedirectUrl, backendNotifyUrl } = buildResultUrls(threeDSConfig, placed.orderId);
      // 🔴 L4b:包一層撞窗即時對帳。closure 固定的是**付款 input 的值**(同一 orderId / total /
      //   cardholder / 同一把未消耗的 prime)⇒ 兩次之間無從漂移。
      //   ⚠️ deps **不是**固定實例:每次 run() 都會重呼 factory(getChargeAttemptStore 會新建 client)。
      //      這對正確性無影響(它們是無狀態的取得器),但別把註解寫成「deps 也固定」——那是假話(codex 關卡2 nit)。
      const runInitiate = async () =>
        initiatePayment(
          {
            tappay: getTapPayAdapter(),
            attempts: await getChargeAttemptStore(),
          },
          {
            prime: parsedPrime.data,
            orderId: placed.orderId,
            amount: total,
            cardholder: built.cardholder,
            frontendRedirectUrl,
            backendNotifyUrl,
          },
        );
      return await settleInFlightThenRetryOnce(runInitiate, inFlightOrderIdOfOutcome, (o) =>
        mapInitiateOutcome(o, placed.displayId),
      );
    }

    // ⑥ 編排(flag off 同步路徑、逐字不動):鎖 → charge → 雙軌簿記 → PF-X3 → confirm → 收斂補記(②-③c-2)。
    // 🔴 L4b:同 3DS 路徑,包一層撞窗即時對帳(closure 固定的是付款 input 的值;deps factory 每次重呼)。
    const runConfirm = async () =>
      confirmPayment(
        {
          tappay: getTapPayAdapter(),
          confirmer: getPaymentConfirmer(),
          attempts: await getChargeAttemptStore(),
        },
        {
          prime: parsedPrime.data,
          orderId: placed.orderId,
          amount: total,
          cardholder: built.cardholder,
        },
      );
    return await settleInFlightThenRetryOnce(runConfirm, inFlightOrderIdOfOutcome, (o) =>
      mapOutcome(o, placed.displayId),
    );
  } catch (err) {
    // 🔴 B-4:第 9 參從 flag 底下拿出來之後(plan §4.1),**每一筆結帳都走 9 參 create_order**。
    //    prod 若其實還是 8 參 ⇒ PostgREST `PGRST202`(找不到符合的函式)/ PG `42883`
    //    ⇒ **結帳整條斷**,而客人與客服看到的只有通用字面。
    //    這行的用途不是除錯,是**把那 10 秒的答案放進錯誤訊息** —— 甲(硬閘)真正的弱點不是
    //    壞得太大聲,是壞掉的人不知道為什麼壞。比在金流路徑加一個 fallback 分支便宜一個數量級。
    //    🔴 只印錯誤碼與固定修法字串,**不印 err 本體**(PII / error 不洩;Q2=A 逐字不變)。
    const rpcErrorCode = (err as { code?: unknown } | null)?.code;
    if (rpcErrorCode === 'PGRST202' || rpcErrorCode === '42883') {
      // 🔴 這一行與 finding 2 **同一個形狀**(既有, 非本片新增):它就在 catch 區塊裡
      //    ⇒ 它自己拋就逃出這個 catch ⇒ 下面那句 `return { formError: MSG.generic }` 不會跑。
      //    ⚠️ 而它的**傷害比 finding 2 輕**, 理由寫在下面 :356 那段註解:走到此處的 throw
      //       全屬零扣款路徑 ⇒ 逃出去也沒有一筆錢可以扣第二次。**輕不等於不修**, 而修法是一個字。
      // 🔵 2026-09-03 訂正(主視窗 `-87` 對正式庫唯讀實測 `pg_proc`;線 `-account` 落檔)
      //   ⛔ 下面 `fix:` 字串裡那句 ~~「prod 的 create_order 可能仍是 8 參」~~ **今天為假**:
      //   正式庫已是 **10 參** —— p_lines / p_address_id / p_shipping_method / p_invoice /
      //   p_cart_session_id / p_terms_version / p_client_ip / p_client_ua /
      //   p_notification_email / p_coupon_code
      //   🛑 射程:**只量了參數個數與名稱, 沒有比對函式本體是不是 repo 裡那一版**
      //      ⇒ 「簽章對了」不等於「函式本體是我們以為的那一版」—— 那正是這一族的坑。
      //   📌 這是【好消息型的過期】(以為有風險而其實沒有)⇒ **最不會被回頭查的一種**,
      //      而它的成本是讓人為一個不存在的風險繞路。
      //   ✅ **2026-09-04 已改掉**(f0 裁「順手訂正, 是 nit 不是片」):
      //      新字串**不寫死參數個數**, 改指到 `supabase/migrations/` 底下最新那支 create_order migration
      //      ⇒ 📌 **因為 C 之後它又會變一次, 而寫死的數字每一代都要有人回來改。**
      //      ⚠️ 而舊字面留在上面那幾行(刪除線), 讓搜「8 參」「verify-create-order-9param」的人同一發撞到訂正。
      //   ⛔ ~~**而那句假話【還留在下面那個字串裡】, 本次沒有動它** —— 理由:那是**執行時會印出去的
      //      log 訊息, 不是註解**;改它不是零行為改動(實測:剝註解後 sha256 會變)⇒ 依鐵則 12
      //      的判準它不該由我自己放行。**已端給主視窗,等裁。**~~ ← **裁下來了, 見上。**
      //   ✓ 而「那支腳本是否仍為必要」也一併結掉:新字串**不再叫任何人跑它**
      //      (`scripts/verify-create-order-9param.sh` 本身還在, 沒有刪 —— 它只是不再被這行 log 指名)。
      safeLog('error', '[checkout] create_order 簽章不符', {
        code: rpcErrorCode,
        fix: 'create_order 的參數與本次部署不符(正式庫少了這一版):對照 supabase/migrations/ 底下最新那支 create_order migration,確認它已 apply 再部署',
      });
    }
    // 🔴 Q2=A 通用字面、零原始 error 透傳。走到此處的 throw 全屬零扣款路徑
    // (cardholder repo / placeOrder RPC / findTotal / attempts.begin;charge 之後的失敗
    //  已由 confirmPayment 收斂為 outcome、不 throw)→「請稍後再試」誠實且安全。
    return { formError: MSG.generic };
  }
}

/**
 * 🔴 M-4b L4b:撞窗即時對帳(母 plan §2;plan v3 §4)。
 *
 * 客人**跨裝置 / 換購物車**回來重刷時會撞 per-user 閘(同 cart 那條路更早就被 cart dedup 攔成
 * `needs_settle` → `adjudicateSettlement`,不走這裡)。撞窗當下,那張擋住他的在途單可能其實**早就死了**
 * (客人按過取消 ⇒ Record ≤1 秒轉 `5 CANCEL`,L1a probe 實測)—— 舊行為是一律叫他等,
 * 本片改成:先對那張單做一次對帳,**裁出明確死亡才放行**。
 *
 * `run` 呼**兩次**(至多),`map` 負責把 outcome 映成 UI 態。這個形狀本身就是三道護欄:
 * 1. **只重呼同一支 use-case、同一組參數**(同 `orderId` / `total` / `cardholder` / 同一把**還沒用掉**的 prime
 *    —— begin 沒過 ⇒ charge 從未跑 ⇒ prime 未消耗)。**不重跑 `placeOrder` / preflight / `findTotal`**,
 *    也**不遞迴呼 `chargePaymentAction`** —— 那會多建一張孤兒單、並讓「重試恰一次」失去意義。
 * 2. **恰一次**:`run` 在本函式裡字面上只出現兩次、沒有迴圈也沒有遞迴 ⇒ 第三次在結構上不存在。
 * 3. **只有 `failed` 放行**:其餘一切(節流不放行 / settle throw / paid / pending / no_attempt / 沒有識別碼)
 *    一律走 `map(first)` = **今天的行為**,fail-closed。
 */
async function settleInFlightThenRetryOnce<O>(
  run: () => Promise<O>,
  inFlightOrderIdOf: (outcome: O) => string | null,
  map: (outcome: O) => Promise<ChargePaymentActionResult>,
): Promise<ChargePaymentActionResult> {
  const first = await run();
  const inFlightOrderId = inFlightOrderIdOf(first);
  // 沒有識別碼 = migration 未 apply(payload 無該欄)或不是 user_in_flight ⇒ 整段 skip、退回舊行為。
  // 🔴 這條就是「app 層不得先於 migration apply 上線」那顆雷的形狀內建解:
  //    L4b 先上線也只是 dormant no-op,不會壞(memory feedback_app-layer-must-not-ship-before-migration-apply)。
  if (inFlightOrderId === null) {
    return map(first);
  }
  if (!(await isInFlightSettledFailed(inFlightOrderId))) {
    return map(first);
  }
  return map(await run());
}

/**
 * 對在途單跑一次對帳,回「是否裁出明確失敗(可放行)」。
 *
 * 🔴 **只有 `failed` 回 true**。特別是 `no_attempt` **不放行** —— 這點與 cart dedup 那條路
 * (`adjudicateSettlement` 把 `no_attempt` 當可重刷)**刻意不同**:那邊的 `no_attempt` 是
 * 「同 cart 的兄弟單已無 active attempt」;這裡的在途單是**剛剛才被閘認定為 active** 的,
 * 兩次觀察不一致 = 未知,未知不放行。
 *
 * 🔴 全包 try/catch:任何 throw 都回 false(照舊擋),**絕不落到 `chargePaymentAction` 的外層
 * generic catch** —— 那會回 `formError`,而 client 收到 formError 會釋放按鈕允許重試 = 潛在雙扣。
 */
async function isInFlightSettledFailed(inFlightOrderId: string): Promise<boolean> {
  // 🔴 `stage` = **歸因**(#900 codex R1 finding 5, must-fix)。throttle RPC 自己拋錯時,
  //    原本印的是「settle 拋錯」而 settle **根本沒被呼叫** ⇒ 值班的人去查一個沒壞的東西。
  //    ⇒ 兩個世界要有兩個名字。而它**不動控制流**:下面那個「全包 try/catch」的形狀一個字沒改
  //      —— 那個形狀是本函式的不變式, 不是風格。
  let stage: 'throttle' | 'settle' = 'throttle';
  try {
    const allowed = await getPollSettleThrottle().claimPollSettle(
      inFlightOrderId,
      IN_FLIGHT_SETTLE_THROTTLE_SECONDS,
    );
    stage = 'settle';
    if (!allowed) {
      // 🔴 `#900`(2026-08-24):**行為不變(照舊擋),加的是訊號。**
      //    這一格回 `false` = 「不放行客人重新結帳」,而它原本**不留任何痕跡**
      //    ⇒ 一個被 throttle 擋在門外的客人,與一個從來沒來過的客人,在我們這端長得一樣。
      //    ⚠️ 用 `info`:被擋是**預期行為**(10 秒內重按),不是故障。
      safeLog('info', '[checkout] 在途單 settle 被 throttle 擋下、維持擋住重新結帳', {
        inFlightOrderId,
        throttleSeconds: IN_FLIGHT_SETTLE_THROTTLE_SECONDS,
      });
      return false;
    }
    // 不帶 recTradeIdHint:settleCharge 以 orderId 重查 attempt、自取強鍵(settle-charge.ts:74,77),
    // 我們手上沒有、也不需要一個較舊的觀察。
    const settled = await settleCharge(getSettleChargeDeps(), { orderId: inFlightOrderId });
    return settled.kind === 'failed';
  } catch (settleError) {
    // 🔴 `#900`:**行為不變(任何 throw 都回 false、照舊擋)**,加的是訊號。
    //    這一格與上面那個 `!allowed` **必須印不同的東西** —— 它們是兩個世界:
    //      上面 = 擋得好好的(預期);這裡 = settle 這條路壞了(不預期)
    //    而原本兩者都是沉默 ⇒ 在我們這端**分不出來**。
    // 🔴 `safeLog` 不是美觀, 它是這支函式的不變式(#900 codex R1 finding 2, must-fix)。
    //    上面 docstring 逐字寫著「任何 throw 都回 false、**絕不落到 `chargePaymentAction` 的
    //    外層 generic catch**」—— 而我原本在這個 catch 裡放了一個 `console.error`,
    //    **catch 區塊裡的語句在那個 catch 的保護範圍外面** ⇒ console 自己拋就逃出去
    //    ⇒ formError ⇒ client 釋放按鈕 ⇒ 客人重按 ⇒ **雙扣**。
    //    📌 我親手寫下那條不變式, 又親手在同一支檔裡打破它。
    //       母題:**「我只是加 log」是一句關於【意圖】的話, 不是關於【控制流】的話。**
    // 🔴 `errorName`(finding 4):`settleError.message` 由第三方決定
    //    ⇒ 可能含 prime / rec_trade_id / payload / PII。第三方決定的字串不進 log。
    safeLog('error', stage === 'throttle'
      ? '[checkout] 在途單 throttle RPC 拋錯、維持擋住重新結帳'
      : '[checkout] 在途單 settle 拋錯、維持擋住重新結帳', {
      inFlightOrderId,
      stage,
      errorName: safeErrorName(settleError),
    });
    return false;
  }
}

/** locked/user_in_flight 且帶識別碼 → 回那張在途單的 orderId;其餘一律 null(fail-closed)。 */
function inFlightOrderIdOfOutcome(
  outcome: ConfirmPaymentOutcome | InitiatePaymentOutcome,
): string | null {
  return outcome.kind === 'locked' && outcome.reason === 'user_in_flight' && outcome.inFlight
    ? outcome.inFlight.orderId
    : null;
}

/** cardholder 組裝失敗 → 引導文案(fieldErrors.addressId 引導補地址/手機;其餘 formError)。 */
function mapCardholderFail(reason: BuildCardholderFailReason): ChargePaymentActionResult {
  switch (reason) {
    case 'address_not_found':
      return { fieldErrors: { addressId: '請重新選擇收件地址' } };
    case 'phone_missing':
      return { fieldErrors: { addressId: '收件地址缺少手機號碼,請補齊後再試' } };
    case 'name_missing':
      return { formError: '會員資料缺少姓名,請至會員中心補齊後再試' };
    // M-4b:引導**去補地址的 Email**,不是「重新登入」——會走到這裡的幾乎都是
    // LINE 登入 + 新欄之前建的舊地址,他的登入完全正常,叫他重登只會白繞一圈。
    // ⚠️ 顯示位置(codex 關卡2 糾正,已實查 useChargePayment.tsx:231-241):
    //   client 會把 fieldErrors **壓成單一訊息**顯示在付款區的錯誤條,
    //   **不會**變成收件地址欄旁的紅字。所以文案本身必須把「要去哪裡改」講完整
    //   (現在這句有講),不能依賴它出現在地址欄旁邊。要真的落到地址欄,
    //   得把 server 的 addressId 錯誤接回 `shipping.address` —— 那是另一片。
    // ⚠️ 這一碼涵蓋四種情況:沒有值 / 超過 40 字元 / 格式不合 / 合成信箱(R3 審查 C1)。
    //   所以文案**不能說「缺少」** —— 地址上明明填了一個 45 字元信箱的客人,
    //   看到「缺少 Email」會以為系統壞了,客服也判不出是哪一種。
    //   用「無法用於付款驗證」+ 條件說明,四種情況都講得通、且都指向同一個動作。
    case 'email_unusable':
      return {
        fieldErrors: {
          addressId: '收件地址的 Email 無法用於付款驗證(需 40 字元內的一般信箱),請編輯地址修改後再試',
        },
      };
    case 'profile_not_found':
      return { formError: '會員資料異常,請重新登入後再試' };
  }
}

/** ConfirmPaymentOutcome → UI 態(plan v6 §7 映射表;settlement_required 走 7c-2 即時裁決、其餘純映)。 */
async function mapOutcome(
  outcome: ConfirmPaymentOutcome,
  displayId: string,
): Promise<ChargePaymentActionResult> {
  switch (outcome.kind) {
    case 'paid':
      return { ok: true, displayId };
    case 'charge_failed':
      return outcome.recordPersisted
        ? { ok: false, payment: 'charge_failed', displayId, message: MSG.chargeFailed }
        : { ok: false, payment: 'charge_failed_wait', displayId, message: MSG.chargeFailedWait };
    case 'charge_unknown':
    case 'orphan':
      return { ok: false, payment: 'processing', displayId, message: MSG.processing };
    case 'settlement_required':
      // 🔴 3DS-7 7c-2:cart dedup(duplicate/needs_settle)即時裁決(取代 7b「一律處理中」);
      //    duplicate→既有單 paid-equivalent / needs_settle→鎖外跑 settleCharge(見 adjudicateSettlement)。
      return adjudicateSettlement(outcome.dedup);
    case 'locked':
      return outcome.reason === 'user_in_flight'
        ? { ok: false, payment: 'in_flight', message: MSG.inFlight } // 🔴 無 displayId(round3 C)
        : { ok: false, payment: 'processing', displayId, message: MSG.processing };
  }
}

/**
 * InitiatePaymentOutcome → UI 態(3DS-6a flag on;plan §2.3 映射表)。
 *
 * 🔴 與同步 `mapOutcome` 本質差異:3DS 啟動半段不回 paid(無 `ok:true`);成功 = `redirect`(client 整頁跳轉
 * TapPay payment_url、付款狀態非終態)。結算/失敗-釋鎖全交 settleCharge 脊椎(Record API 唯一權威)。
 */
async function mapInitiateOutcome(
  outcome: InitiatePaymentOutcome,
  displayId: string,
): Promise<ChargePaymentActionResult> {
  switch (outcome.kind) {
    case 'redirect':
      // 🔴 N1 / codex 關卡1 #2:client 整頁 window.location 跳轉「前」,delivery 層驗 payment_url 是合法 https URL
      //   (isHttpsUrl 較鬆、允許 ?token= query)。合法 → redirect;壞值(TapPay 已 status=0、可能 OTP 後成交)→
      //   processing 終態(**非** generic 可重試 → 防誤導重刷雙扣);bank_txn 已 durable、settleCharge 經 bank_txn 收斂。
      return isHttpsUrl(outcome.redirectUrl)
        ? { redirect: true, redirectUrl: outcome.redirectUrl }
        : { ok: false, payment: 'processing', displayId, message: MSG.settlementRequired };
    case 'charge_unknown':
      // initiate 非成功、bank_txn 已 durable、可能已登記交易 → 狀態確認中、勿重複付款(settleCharge 經 bank_txn 收斂)。
      return { ok: false, payment: 'processing', displayId, message: MSG.settlementRequired };
    case 'settlement_required':
      // 🔴 3DS-7 7c-2:cart dedup 即時裁決(同步路徑同款 adjudicateSettlement;取代 7b「一律處理中」)。
      return adjudicateSettlement(outcome.dedup);
    case 'locked':
      return outcome.reason === 'user_in_flight'
        ? { ok: false, payment: 'in_flight', message: MSG.inFlight } // 🔴 無 displayId(此請求零扣款、無單號)
        : { ok: false, payment: 'processing', displayId, message: MSG.processing };
    case 'init_failed':
      // bank_txn 未 durable → 零 TapPay 呼叫、零扣款(誠實未扣款 + 系統忙碌請稍候;鎖殘留 expirer/sweeper 清)。
      return { ok: false, payment: 'charge_failed_wait', displayId, message: MSG.chargeFailedWait };
  }
}

/**
 * settlement_required(cart-instance dedup)即時裁決(🔴 3DS-7 7c-2、鐵則 12 核心;同步 + 3DS 兩路徑共用)。
 *
 * - `duplicate`(existingPaid:true)→ 既有單 DB 確定 paid → **paid-equivalent 終態**:回 { ok:true, displayId:既有單 }
 *   → hook 當 paid 處理(clear + regenerateCartSession;🔴 codex K1 must-fix:換 key 防下次合法重購撞已 paid
 *   sibling 被 begin D2 誤擋)。
 * - `needs_settle` → 鎖外跑 settleCharge(既有單;begin needs_settle 未取鎖、settleCharge 自管冪等:Record API
 *   權威 + markCharged/confirm `FOR UPDATE` + paid 短路 → 零雙扣/零雙 settle),依結果映:
 *     `paid`             → paid-equivalent(同 duplicate;顯既有單號、hook clear+regenerate)。
 *     `failed`/`no_attempt` → 放行重刷(charge_failed → hook error 態:釋鎖、保留 cart、保留 key);既有單已
 *                            markFailed/無 active attempt → 退出 begin dedup + user_in_flight 雙閘 → 重結帳建新單。
 *     `pending`          → 短 hold「狀態確認中」(processing、保留 key、不放行〔防雙扣〕、不背景輪詢〔Q3=A〕)。
 *
 * 🔴 settleCharge / getSettleChargeDeps **全包局部 try/catch**(codex K1 should):任何 throw → fail-closed hold
 *   (processing / MSG.settlementRequired、保留 key)、**絕不落 chargePaymentAction 外層 generic catch**(否則回
 *   formError → client 釋鎖允許重試 → 潛在雙扣)。duplicate 分支為純 return(零 throw)→ 本函式整體不 reject。
 *
 * displayId 一律取既有單(ctx.existingDisplayId / settleCharge paid 回的 displayId),不用本次新建的孤兒單號
 * (孤兒未付、對客人無意義)。existingOrderId / existing_* 全鏈 server 權威(begin→adapter→outcome、client 零入口)→ 無 IDOR。
 *
 * 🔴 攻擊時序自審(鐵則 10):
 *  ① failed 放行重刷 vs 客人稍後在舊 3D 頁完成 OTP —— `failed` 僅由 Record record_status ∈ {-1 ERROR, 5 CANCEL}
 *     終態驅動(settle-charge classifyRecordStatus);TapPay 模型下同交易終態 -1/5 與「後續 OTP 成功」互斥 →
 *     放行重刷後既有單不會再成交 → 無雙扣。(綁定 Record 終態語意、未來改 settleCharge 裁決須重核。)
 *  ② callback settleCharge(callback/page.tsx)× 本 action settleCharge 對同 existingOrderId 並發 —— 兩條走同一
 *     use-case、讀 Record 同一權威 rec、經 markCharged/confirm `FOR UPDATE` 序列化 → 一條 paid、一條 idempotent
 *     no-op → 零雙扣 / 零雙 settle。
 */
async function adjudicateSettlement(
  ctx: SettlementRequiredContext,
): Promise<ChargePaymentActionResult> {
  // duplicate:既有單 DB 確定 paid → paid-equivalent(純 return、零 throw;顯既有單號、hook clear+regenerate)。
  if (ctx.reason === 'duplicate') {
    return { ok: true, displayId: ctx.existingDisplayId };
  }

  // needs_settle:鎖外跑 settleCharge。🔴 全包局部 try/catch(含 getSettleChargeDeps):throw → fail-closed
  //   hold(processing、保留 key)、不落外層 generic catch(防誤釋鎖重試=雙扣)。
  let settled: SettleChargeOutcome;
  try {
    settled = await settleCharge(getSettleChargeDeps(), {
      orderId: ctx.existingOrderId,
      recTradeIdHint: ctx.existingRecTradeId ?? undefined,
    });
  } catch {
    return {
      ok: false,
      payment: 'processing',
      displayId: ctx.existingDisplayId,
      message: MSG.settlementRequired,
    };
  }

  switch (settled.kind) {
    case 'paid':
      // 既有單確定 paid → paid-equivalent 終態(顯既有單號、hook clear+regenerate;codex K1 must-fix)。
      return { ok: true, displayId: settled.displayId };
    case 'failed':
    case 'no_attempt':
      // 既有單已釋鎖(markFailed 退雙閘)或無 active attempt(必未扣款)→ 放行重刷(hook error 態、保留 key)。
      return {
        ok: false,
        payment: 'charge_failed',
        displayId: ctx.existingDisplayId,
        message: MSG.chargeFailed,
      };
    case 'pending':
      // 既有 3D 可能仍進行中 → 短 hold「狀態確認中」(保留 key、不放行、不背景輪詢;Q3=A)。
      return {
        ok: false,
        payment: 'processing',
        displayId: ctx.existingDisplayId,
        message: MSG.settlementRequired,
      };
  }
}
