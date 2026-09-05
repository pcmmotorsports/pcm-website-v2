'use client';

// CheckoutView.tsx — 結帳頁 client 殼(M-3-S2-b2-e1 建;②-④b 接 TapPay 刷卡流程)
//
// 直接搬 design-reference/components/CheckoutPage.jsx(L163-694、鐵則 1 字面)。
// e1 範圍:結帳殼 + 步驟指示器 + Step1(收件地址選擇 + 配送方式)+ mobile buybar;
//   Step2(第二步全部內容)= CheckoutStep2;右側摘要 ②-④b 抽 CheckoutSummaryAside(鐵則 6)。
//
// 🔴 M-3 兩步結帳(business override checkoutTwoStepFlow、Sean 已批准):
//   step domain 由 `1|2|3` 原子收斂為 `CheckoutStep = 1 | 2`(型別源 CheckoutStepIndicator);
//   Step 2 = 收件摘要 + 發票 + 付款 + 商品 + 條款 + 付款鈕同一頁,三步版的第三步入口鈕已移除。
//   U1 搬骨架 → U2a 抽複查區塊 → **U2b ✅ 收斂完成**:三步版 shell `CheckoutStep3.tsx` 已退役刪除,
//   Step 2 只掛單一 `CheckoutStep2`(內含 CheckoutStep2ReviewSections 的收件摘要與訂單複查),
//   disabled 假卡欄與重複的發票 / 付款複查節點全部移除。
//   🔴 鐵則 6 跑道:U3b 三刀(validate-checkout-payment / usePaymentErrors / CheckoutMobileBuybar)後 392 行;
//   U4a-0 第四·五刀(CheckoutTerminalScreen / CheckoutCartNotice、皆純 presentational 零行為變更)後 356 行。
//   U4b:聚焦邏輯外移至 lib/checkout/focus-first-error.ts + hooks/useFirstErrorFocus.tsx(不塞 View);
//   桌機動作列 + CheckoutPaymentFeedback 移進 CheckoutStep2(design §8「CheckoutStep2 負責動作列」)。
//   🔴 付款 orchestrator 仍在 View(design §8):handleSubmit 全鏈未動,只以 onSubmit prop 傳給 Step2 的按鈕。
//
// ②-④b 成交流程(取代 e3b 純建單;本檔走 useChargePayment 刷卡整鏈):
//   付款方式選項 body 插 TapPay 安全卡欄(paymentSlot;卡資料零進 React state、useTapPayCard
//   只在 step===2 啟用 setup)→ 確認付款 = **U3b 非卡片 validation** → getPrime →
//   useChargePayment.submit(server cardholder 組裝 → 建單 → findTotal → 鎖 → charge → confirm)
//   → 結果映 UI:paid / processing / unknown(action throw 回應遺失層、可能已扣款)→ CheckoutTerminalScreen
//   終態;error / wait / in_flight → 留頁,訊息與非卡片錯誤共用 CheckoutPaymentFeedback 單一 alert。
//
// route adaptation(對齊 storefront 慣例、非 design 視覺偏離):
//   - <Header>/<HomeFooter>(取代 design Header/Footer onNav prop);Header 無 cartCount prop。
//   - 麵包屑 / 返回購物車 / 升級會員 → Next <Link> / router.push;不複製 design onNav。
//
// 🔴 鐵則 12 / 審查側 e1 條件 1:右側摘要價走 useResolvedCart(server-resolve、不存 client、釘 general)。
//
// design 偏離(commit body + manifest 揭示):
//   - 地址走真資料(getAddressRepo、server page 傳入)、非 design localStorage mock。
//   - 配送方式只「貨運宅配」home(Q1=A;design 的「合作店家取貨」+ 地圖選店 StorePickerModal 不做、
//     後端仍保留 store 白名單供未來)。
//   - 新增地址 inline 表單(design InlineAddressForm)延後 → 連 /account 管理(降 e1 體積、單一地址 CRUD 源)。
//   - 優惠券 / 儲值金折抵不做(plan §3.2 + #202);ATM 不做(§3.2 隱藏)。
//   - 免運門檻 4,000 → 統一 5,000(memory iron-rule #161、用 FREE_SHIPPING_THRESHOLD)。
//   - 登入守門在 /checkout server 端 getUser()(對齊 /account);不複製 design client localStorage 檢查。

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { NotificationEmailInput } from '@pcm/schemas';
import type { CustomerAddress, MemberTier } from '@pcm/domain';
import { Header } from '@/components/Header';
import { HomeFooter } from '@/components/HomeFooter';
import { CheckoutStep1 } from '@/components/CheckoutStep1';
import { CheckoutStep2, type InvoiceDraft } from '@/components/CheckoutStep2';
import { CheckoutStepIndicator, type CheckoutStep } from '@/components/CheckoutStepIndicator';
import { CheckoutTerminalScreen, isTerminalChargeState } from '@/components/CheckoutTerminalScreen';
import { CheckoutCartNotice } from '@/components/CheckoutCartNotice';
import { navigateToCatalog } from '@/lib/catalog-navigation';
import { CheckoutPaymentOverlay } from '@/components/CheckoutPaymentOverlay';
import { CheckoutSummaryAside } from '@/components/CheckoutSummaryAside';
import { CheckoutMobileBuybar } from '@/components/CheckoutMobileBuybar';
import { TapPayCardFields } from '@/components/TapPayCardFields';
import { validateNonCardFields, validateTapPayFields } from '@/lib/checkout/validate-checkout-payment';
import { usePaymentErrors } from '@/hooks/usePaymentErrors';
import { useFirstErrorFocus } from '@/hooks/useFirstErrorFocus';
import { useResolvedCart } from '@/hooks/useResolvedCart';
import { useCheckoutShipping } from '@/hooks/useCheckoutShipping';
import { useInvoiceAutofill, DEFAULT_INVOICE } from '@/hooks/useInvoiceAutofill';
import { useChargePayment } from '@/hooks/useChargePayment';
import { useTapPayCard } from '@/hooks/useTapPayCard';
import { confirmProceedIfInflight } from '@/lib/payment/inflight-marker';

export type CheckoutViewProps = {
  /**
   * 🔴🔴 **匯款結帳的開關 —— server 讀、當 prop 傳,不做 `NEXT_PUBLIC_` 鏡像。**
   * `lib/payment/bank-transfer-flag.ts` 是 `import 'server-only'`,而那是刻意的:
   * 它擋的不是「功能沒做好」,是**一個會讓客人兩邊都付錢的洞**(見該檔檔頭)。
   * 🛑 **一顆安全 flag 有兩份來源時,關掉的人只會關到他知道的那一份。**
   */
  bankTransferEnabled: boolean;
  /** 會員收件地址清單(server page getAddressRepo→listByCustomer、RLS 守自己 row) */
  addresses: CustomerAddress[];
  /** 會員顯示名(server page customers.name SoT) */
  memberName: string;
  /** 會員等級(server page customers.tier;階段① 顯示用、價格仍 general-only) */
  memberTier: MemberTier;
  /** B-3 四層單一 flag；server page 讀一次後往下傳，預設 off。 */
  notificationEmailEnabled: boolean;
  /** 僅可能是 server 共用 schema 驗過的真 Email；LINE 合成域與壞值均為空字串。 */
  initialNotificationEmail: string;
};

export function CheckoutView({
  bankTransferEnabled,
  addresses,
  memberName,
  memberTier,
  notificationEmailEnabled,
  initialNotificationEmail,
}: CheckoutViewProps) {
  // 🔴🔴 **付款方式從【寫死】換成畫面狀態**(⟦b4-BANKCHARGESCARD⟧ 片 2)。
  //    ⛔ ~~兩處 `paymentChannel: 'tappay' as const`~~ —— 它們相距約 60 行,
  //    而舊註解逐字寫著「要**同時**換這兩處」⇒ 現在它們讀**同一個 state**。
  // 🔴🔴 ⛔ ~~`bankTransferEnabled` 為 false 時這個 state 永遠是 `'tappay'`~~
  //    —— **那句話是假的**(codex ①):選項不渲染只擋得住「**新的**選擇」,
  //    擋不住**已經選過而 flag 之後才被關掉**的那顆 state。
  //    ✅ 真的成立的是下面那個 `effectiveChannel` —— **它是推導出來的, 不是記住的。**
  const [pickedChannel, setPickedChannel] = useState<'tappay' | 'bank_transfer'>('tappay');
  // 🔴🔴 **`effectiveChannel` 才是唯一真相 —— 而它不是 `pickedChannel`。**
  //    🔬 codex 給的反例(我核過):flag 開 ⇒ 客人選匯款 ⇒ 回 step1 存地址觸發 `router.refresh()`
  //       ⇒ 這一刻 flag 被關掉 ⇒ **server 傳下來的 prop 變 false, 而 client state 還是 `'bank_transfer'`**。
  //    🛑 那時如果 radio 讀的是 `pickedChannel`:匯款那顆已經不渲染, 而信用卡那顆
  //       `checked={pickedChannel === 'tappay'}` **也是 false** ⇒ 📌 **兩顆都沒亮, 而送出去的是刷卡。**
  //    ⇒ ✅ **收斂成一個值**:flag 關著時它一律是 `'tappay'`, 畫面與 payload **讀同一個**。
  //    📌 **我原本寫「flag 關著 ⇒ state 永遠是 tappay」—— 那句話是假的**(state 會留著),
  //       真的成立的是「**flag 關著 ⇒ effectiveChannel 永遠是 tappay**」。
  const effectiveChannel: 'tappay' | 'bank_transfer' =
    bankTransferEnabled && pickedChannel === 'bank_transfer' ? 'bank_transfer' : 'tappay';
  const isBank = effectiveChannel === 'bank_transfer';
  const router = useRouter();
  // 配送方式 + 標籤依購物車自算(補差額整車=store 免運;鐵則 6 外移至 useCheckoutShipping)。
  const { method: shippingMethod, label: shippingLabel, balancePaymentCheckout } = useCheckoutShipping();
  const cart = useResolvedCart(shippingMethod);
  const charge = useChargePayment();

  const [step, setStep] = useState<CheckoutStep>(1);
  const [shippingAddrId, setShippingAddrId] = useState<string | undefined>(
    () => addresses.find((a) => a.isDefault)?.id ?? addresses[0]?.id,
  );
  const [notificationEmail, setNotificationEmail] = useState(initialNotificationEmail);
  const [notificationEmailError, setNotificationEmailError] = useState<string | null>(null);

  // 發票:state 提升至此(跨步驟存活、送出時讀);發票 UI 在 CheckoutStep2(U2b 起唯一節點、無 readonly 複查)。
  // 從選中地址自動帶入、使用者可手動覆寫的 effect 對齊 design L72-76。
  const [invoice, setInvoice] = useState<InvoiceDraft>(DEFAULT_INVOICE);
  const [invoiceOverride, setInvoiceOverride] = useState(false);

  // U3b:非卡片錯誤 lifecycle(state + 清除規則在 usePaymentErrors;驗證在 lib 純函式)。
  const payErrors = usePaymentErrors(step);

  // 選中地址→發票自動帶入(未覆寫時);invoiceRef/effect 外移至 useInvoiceAutofill(鐵則 6)。
  useInvoiceAutofill({
    invoice,
    setInvoice,
    invoiceOverride,
    shippingAddrId,
    addresses,
    clearInvoiceKeys: payErrors.clearInvoiceKeys,
  });

  // 同意條款(Step 2 底部)。
  const [agreed, setAgreed] = useState(false);

  const handleInvoiceChange = (next: InvoiceDraft) => {
    payErrors.clearInvoiceKeys(invoice, next);
    setInvoice(next);
  };

  const goNext = () => {
    if (step === 1 && notificationEmailEnabled) {
      const result = NotificationEmailInput.safeParse(notificationEmail);
      if (!result.success) {
        // 🔴 U3a 立了「不得用 issues[0] 當欄位錯誤來源」硬規則,**此處是明示豁免**:
        //    parse 的對象是單欄 `NotificationEmailInput`(非物件 schema),所有 issue 都屬同一欄、
        //    順序無關。全樹唯一命中點,勿誤判為漏改(見 @pcm/schemas CheckoutInvoiceInput 註解)。
        setNotificationEmailError(result.error.issues[0]?.message ?? 'Email 格式不正確');
        const emailInput = document.getElementById('checkout-notification-email');
        emailInput?.focus();
        emailInput?.scrollIntoView?.({ block: 'center' });
        return;
      }
      setNotificationEmail(result.data);
      setNotificationEmailError(null);
    }
    setStep(2); // U1:兩步 domain,goNext 只可能 1→2
  };
  const goBack = () => setStep(1); // U1:兩步 domain,goBack 只可能 2→1

  // ②-④b 刷卡送出。TapPay 卡欄只在 step===2 啟用(U1:setup 需容器在 DOM);getPrime 成功才呼
  // chargePaymentAction(六態契約見 useChargePayment)。🔴 雙擊防線:primeBusyRef 同步原子鎖
  // (state 版 re-render 前擋不住同輪連點;codex 關卡2 r1)→ getPrime 全程只進一次;終態
  // (paid/processing、submit 回 true)**不釋放**(r2)。shippingMethod 依車自算(補差額=store 免運);身分/金額零 client。
  // 🔴 U3b:design 原 submitOrder 的 `if (!agreed) return` 前端硬擋**已移除** —— 改為 design §7.3
  //   「未填完整時仍可按、用來觸發錯誤導引」;consent 的權威守門在 server(charge-actions ②e)。
  const tappay = useTapPayCard(step === 2);
  const primeBusyRef = useRef(false);
  const [primeBusy, setPrimeBusy] = useState(false);
  const [primeError, setPrimeError] = useState<string | null>(null);
  const submitting = charge.state.status === 'submitting' || primeBusy;
  // 🔴 U4a:`!tappay.canGetPrime` **已移除**(design §7.3「未填完整時仍可按、用錯誤導引取代 disabled」)。
  //   縱深未降低:①本檔 validation 閘擋在 getPrime 前 ②getPrime 內部仍檢查 getTappayFieldsStatus()
  //   ③server 權威守門。移除的只是「按鈕按不下去卻不說為什麼」這個死鎖。
  const payDisabled = submitting;
  // 🔴 card errors 每 render 由 live fieldStatus 衍生、**不存 state**(plan §⑤ 硬紅線):
  //   status 2→0 時該欄紅字自然消失,不需要第二套清除路徑。
  //   「按過付款沒」與其離開第二步的重設規則由 usePaymentErrors 持有(該 hook docstring 有完整理由)。
  const cardValidation = validateTapPayFields({
    ready: tappay.ready,
    canGetPrime: tappay.canGetPrime,
    fieldStatus: tappay.fieldStatus,
    submitAttempted: payErrors.submitAttempted,
  });
  // 🔴 U4b:按下付款、有錯 → 聚焦第一個錯誤(design §7.2「捲動並聚焦第一個可聚焦錯誤」)。
  //   傳入卡片 + 非卡片的合併 map;hook 於 commit 後對**最新**值聚焦(見 useFirstErrorFocus 時序註解)。
  //   聚焦 orchestration 是 View 職責(design §8),但 registry 與 DOM 副作用外移至 lib/hook(鐵則 6、不塞 View)。
  // 🔴🔴 codex ②③:**卡片錯誤的【顯示 / 聚焦 / 摘要】那一半原本沒有跟著 `isBank` 走。**
  //    🛑 症狀:匯款客人**按過一次**之後 `submitAttempted` 變 true ⇒ **卡欄紅字全部冒出來**,
  //       而聚焦順序甚至會先跳到卡號 —— 📌 **一個正要匯款的人, 被要求去修他沒有要用的卡。**
  //    ⇒ ✅ 匯款時把卡片錯誤**整組清空**(不是隱藏一半)。
  const shownCardErrors = isBank ? {} : cardValidation.errors;
  const requestErrorFocus = useFirstErrorFocus({ ...payErrors.errors, ...shownCardErrors });
  const handleSubmit = async () => {
    // 🔴 順序不可調動(codex 關卡1 R1#6 / R3-B / 關卡2 R1#1 釘死):同步 guard → **淘汰舊 charge error**
    //   → non-card validation → confirm → prime 鎖 → getPrime → **解除淘汰** → charge.submit。
    if (payDisabled || primeBusyRef.current) return;
    // 🔴 每次按下都先淘汰上一輪 charge error(codex 關卡2):合法直接重試時 getPrime 可等 ~15 秒,
    //   不淘汰則舊「付款失敗」整段掛著。`wait`/`in_flight` 不受影響(見 alertFor)。
    payErrors.retireChargeMessage();
    payErrors.markSubmitAttempted();
    const validation = validateNonCardFields({
      addressId: shippingAddrId,
      invoice,
      notificationEmailEnabled,
      notificationEmail,
      agreed,
      // 🔴 段 1-B:與下面送給 server 的那個值**必須是同一份** ——
      //   前端驗一個、後端存另一個, 兩邊都不會叫。(下一個增量把它換成畫面上的狀態時,
      //   要**同時**換這兩處, 而它們相距約 60 行。)
      // 🔵 ⛔ ~~寫死 `'tappay'`~~ ⇒ 讀畫面狀態。與下面送給 server 的那個值**同一份**。
      paymentChannel: isBank ? ('bank_transfer' as const) : ('tappay' as const),
    });
    payErrors.applyValidation(validation);
    // 🔴 卡片閘與非卡片閘**同時求值、一起擋**(design §7.2「同一次 submit 找到的所有錯誤全部顯示,
    //   不採逐一阻擋」)。submitAttempted 顯式傳 true:closure 裡的 state 這一輪還沒更新。
    //   放行只看 `valid` 旗標,**不看 errors map 是否為空**(未按過付款時 map 恆空但 valid 可能 false)。
    // 🔴 **匯款那條路不【擋】卡** —— 卡欄對他是空的, 擋它只會擋住一個沒有要刷卡的人。
    //    ⚠️ ⛔ ~~原本這裡寫「不驗卡」~~ —— **那個詞比它的射程大**(codex ③):
    //    `validateTapPayFields` 仍然在上面**照跑**(它餵 `TapPayCardFields` 的紅字),
    //    這裡換掉的只有**送出那一刻的閘**;而**顯示那一半**由 `shownCardErrors` 收。
    //    🔵 `valid: true` 而不是跳過整個判斷式:下面那一行同時看兩個旗標,
    //    給它一個「這條路沒有卡要驗」的**顯式真值**, 比在條件式裡多加一個 `!isBank` 好讀。
    const cardResult = isBank
      ? { valid: true as const, errors: {} }
      : validateTapPayFields({
          ready: tappay.ready,
          canGetPrime: tappay.canGetPrime,
          fieldStatus: tappay.fieldStatus,
          submitAttempted: true,
        });
    if (!validation.valid || !cardResult.valid) {
      // 🔴 有錯即止:confirmProceedIfInflight / getPrime / chargePaymentAction 一律 0 次。
      //   prime 訊息一併淘汰,否則客人修完欄位後舊訊息會幽靈重現。
      setPrimeError(null);
      // 🔴 U4b:錯誤集合完成後聚焦第一個(design §7.2)。此刻 applyValidation/markSubmitAttempted 已排入
      //   同批 setState → 下一 render 的合併 map 已含卡片錯誤,hook 於 commit 後才真正聚焦(讀最新值)。
      requestErrorFocus();
      return;
    }
    if (!confirmProceedIfInflight()) return; // 🔴 P3:另開分頁防呆軟提醒(取消則不送出;後端 preflight 才是雙扣真防線)
    primeBusyRef.current = true;
    setPrimeBusy(true);
    setPrimeError(null);
    let terminal = false;
    try {
      // 🔴 `.catch(() => null)`:SDK 若 throw,無 catch 會讓 handler 靜默結束、客人完全沒訊息;
      //   轉 null 即落入下方友善錯誤路徑(code-reviewer nit,已由 getPrime reject 測試守門)。
      //   (它跟著 `getPrime` 搬進下面那個 `if` 裡了,本行只留指標。)
      // ⛔ ~~🔴🔴 **匯款這條路【今天仍然取 prime】—— 而那是暫時的,不是設計。**~~ (2026-09-05 片 2 拆掉了)
      //    🛑 原因在 server 那一側:`charge-actions.ts` 的 prime 閘是**無條件**的,
      //       而且排在任何 channel 分岔**之前**(`TapPayPrimeInput.safeParse(raw.prime)`
      //       失敗 ⇒ `formError: '付款資訊缺失,請重新進行刷卡'`)。
      //    ⇒ 📌 **前端不取 prime ⇒ 一個正要匯款的客人會吃到一句叫他去刷卡的錯誤訊息。**
      //    ⇒ ⇒ 要拆開它必須改 `charge-actions.ts` —— **那是片 1 的檔**(⟦b4-BANKCHARGESCARD⟧),
      //       而兩片改同一支函式是我們刻意避開的(主視窗 2026-09-05 裁【丙】)。
      // ✅ **⛔ ~~上面那兩條代價~~ 2026-09-05 片 2 收掉了** —— 舊字面留在上面加刪除線,
      //    因為它記著「為什麼當時不能拆」,而那個理由現在已經不成立(片 1 把 server 的閘挪到分岔之後)。
      //
      // 🔴🔴 **匯款這條路【不取 prime】—— 而跳過的邊界只有這一段, 前面那一串一個都不動。**
      //    🛑 **不可以順手一起跳的**(片 2 plan §2b, 每一條都指名不做會怎樣):
      //      · `confirmProceedIfInflight()`(上面那行)—— 它的註解自己寫「**後端 preflight 才是雙扣真防線**」
      //        ⇒ 繞過去會**再建一張單** ⇒ 📌 我們修的是「他以為沒買成」, 繞過去變成「他真的買了兩次」。
      //      · `agreed` / 收件地址 / cart session —— 那些與付款方式無關, 匯款客人一樣要同意條款。
      //        (⚠️ **cardholder 不在這一串裡** —— 它是 server 那側組出來的, client 從來沒有那個欄位;reviewer R1 抓到我原本把它寫進來了, 而那會叫下一個人去找一個不存在的變數。)
      //      · 下面那行 `payErrors.resumeChargeMessage()` —— 連它一起跳 ⇒ **新的錯誤會被 stale 機制蓋掉**
      //        ⇒ 客人看到的是**上一次**的訊息, 而那與「沒有訊息」一樣糟。
      //    ⇒ 🎯 **所以這裡只多一個 `if (!isBank)`, 而不是把整段搬進分支。**
      //
      // 🔴🔴 **`prime` 送 `null` 之後, server 那一側【今天還接不住】—— 而這一句是量到的, 不是推的。**
      //    實查 `agent/line-mail`(片 1 的分支)`charge-actions.ts`:
      //      · `:217` `TapPayPrimeInput.safeParse(raw.prime)` —— **無條件**, 且排在
      //      · `:416` `storedChannel === 'bank_transfer'` 那個分岔【之前】, 也排在 `②e agreed` 之前。
      //    ⇒ 📌 **片 1 沒有動那道閘** —— 它動的是分岔【之後】的出口(fail-closed ⇒ 終態)。
      //    ⇒ ⇒ 所以送 null 的結局是 `formError: '付款資訊缺失,請重新進行刷卡'`,
      //         而那句話對一個正要匯款的客人是**錯的指示**。
      // 🛑 **⇒ 因此本片【不足以】翻 `BANK_TRANSFER_CHECKOUT_ENABLED`。**
      //    缺的那一格有名字:**「把 ②c prime 閘挪到 channel 分岔之後」, 而它今天【沒有人認領】**
      //    (片 1 plan §6 交給片 2 的原句是「只跳過 prime 的 parse」—— 那句指的是 **client 這一段**,
      //     server 那一道同名的閘不在任何一片的範圍裡)。已回報主視窗。
      // ⚠️ **而本片仍然要進去**:它是那一格的**前置**, 且它讓「沒有卡的人」不再卡在 client 側。
      let prime: string | null = null;
      if (!isBank) {
        prime = await tappay.getPrime().catch(() => null);
        if (!prime) {
          setPrimeError('卡片資訊驗證失敗,請確認卡號 / 有效期 / CVV 後重試');
          return;
        }
      }
      // 🔴 stale 解除必須晚到這裡(R3-B):getPrime 可等 ~15 秒,期間 charge.state 仍持上一輪訊息,
      //   提早解除會讓舊訊息在取 prime 期間重新現身。submit 內部同步切 'submitting'、與本行同批。
      payErrors.resumeChargeMessage();
      terminal = await charge.submit({
        addressId: shippingAddrId,
        shippingMethod,
        invoice,
        prime,
        agreed,
        /**
         * 🔴 段 1-B(2026-09-04):付款方式。**今天只送得出 `'tappay'`** ——
         * 而那不是預設值, 是**現況**:`CheckoutStep2` 目前只渲染一個 radio
         * (`CheckoutStep2.tsx` 逐字「ATM 轉帳不做(plan §3.2 隱藏)」, 而 Sean 09-04 推翻了它)。
         * 🛑 **這一格是【接線】不是【功能】** —— 把 channel 一路送到 `create_order` 的第 11 個參數,
         *   而**讓客人選得到**是下一個增量(解除那個隱藏 + 第二個 radio)。
         * ⇒ 📌 拆成兩步是刻意的:**接線壞掉與選項沒出現, 症狀完全不同** ——
         *   而合成一步的話, 客人選了匯款卻存成刷卡, 會被讀成「選項壞了」。
         * 🔴 而它**寫死在這裡是暫時的**;下一個增量要把它換成畫面上的狀態, 不要在別處再寫一份。
         */
        // 🔵 與上面驗證用的那個值**同一份**(它們相距約 60 行)。
        paymentChannel: isBank ? ('bank_transfer' as const) : ('tappay' as const),
        ...(notificationEmailEnabled ? { notificationEmail } : {}),
        // 🔴 **Sean 拍 `Q15 = 甲`**:讓那句擋人的話**叫得出是哪一件商品**。
        //    品名來自**這一次 render 已經解析好的那一份**(`cart.lines`)——
        //    🛑 **不重查** :重查會多一條可能與畫面不一致的來源, 而客人要對照的正是畫面上那幾列。
        //    🔵 找不到那一列 ⇒ 回 `undefined` ⇒ hook 那端整句退回不指名的版本。
        //    ⛔ ~~我原本寫「`found === false` 的列拿不到真名字(`actions.ts:130` 的 `name: ''`)」~~
        //    🔴 **那個機制描述是假的**(code-reviewer 開檔核):`!found` 的列**根本進不了 `cart.lines`**
        //       —— `useResolvedCart.tsx:174` 先濾掉了;而另一條 found:false 的路
        //       (`actions.ts:145-158`)帶的是 `name: product.name` **真名字**。
        //    ⇒ 📌 **`|| undefined` 可以留, 而它守的不是我原本宣稱的那件事。**
        //       真正會回 `undefined` 的是「那一列不在 `cart.lines` 裡」, 而 hook 那端
        //       用 `names.length === missing.length` 接住它。
        lineName: ({ productId, variantId }) =>
          cart.lines.find(
            (l) => l.item.productId === productId && l.item.variantId === variantId,
          )?.resolved.name || undefined,
      });
    } finally {
      if (!terminal) {
        primeBusyRef.current = false;
        setPrimeBusy(false);
      }
    }
  };
  // 付款區唯一 alert 的文字。U4a 起優先序 = formError > 只有 card.module 時念全文 > 逐欄數量摘要
  //   > getPrime 失敗 > 未過期的 charge 訊息(合併在 usePaymentErrors 內、不在 View inline 算)。
  const paymentAlert = payErrors.alertFor({
    primeError,
    chargeState: charge.state,
    // 🔴 codex ②:警示摘要也吃卡片錯誤 ⇒ 匯款時會蓋掉 prime / charge 那半的訊息。
    cardErrors: shownCardErrors,
  });

  // 終態(優先於 loading/empty;clear() 後 cart 轉 empty 不可蓋掉終態)。各終態畫面在 CheckoutTerminalScreen。
  // 🔴 U4a-0:條件必須是 status 型別守衛,**不可**寫成「元件回傳值是否 truthy」——
  //   JSX 元素恆為 truthy、子元件回 null 也擋不住,會讓非終態的整頁結帳表單消失。
  if (isTerminalChargeState(charge.state)) // 🔴 S1b-2:透傳 reconcile props(邏輯在 useReconcilePayment、鐵則 6)
    return (
      <CheckoutTerminalScreen
        state={charge.state}
        onReconcile={charge.reconcile}
        reconcileDisabled={charge.reconcileDisabled}
      />
    );

  // 🔴🔴 `#887` 乙案 —— **這一道必須排在下面三道 cart 閘【之前】。**
  //
  //   病:下面三道(`loading` / `error` / `empty`)都是**整頁 early return**, 而
  //   `<CheckoutPaymentOverlay open={submitting} />` 住在它們的**下游**(見下方 return)
  //   ⇒ 付款進行中(錢已經在飛、尚未落終態)只要 cart 掉出 `ready`, **整頁連同遮罩一起被換掉**:
  //     · `error` ⇒ 客人看到「請重新整理頁面再試一次」⇒ 讀成「付款失敗了」⇒ **重按 ⇒ 重複扣款**
  //     · `empty` ⇒ 畫面上還遞給他一顆「繼續購物」, 那是一個**會離開結帳頁的出口**
  //     · `loading` ⇒ 什麼都不說, 而他的錢正在飛
  //
  //   🔴 這條不變量**早就有前例, 而沒有人把它延伸到「進行中」**:
  //     `:253` 的 `isTerminalChargeState` 早退擋的是**終態**那一半, 而它的守門
  //     (`CheckoutView.test.tsx` 「終態優先於空車」)註解逐字寫著「直接誘導重複付款」。
  //     `#887` = 那道守門只守了一半。本行補「進行中」那一半。
  //
  //   🔴 為什麼**不是**在 `:264` 加一個 `&& !submitting` 就好:那樣會掉進下面 `ready` 的路,
  //     拿 `lines = []` 渲染出一張**零商品的結帳頁**而付款鈕是活的 —— 那正是 A2 修掉的病。
  //
  //   🔴 遮罩**不可省**:`CheckoutCartNotice` 自帶 `Header` / `HomeFooter`, 它們有連結(離開入口)。
  //     原生 `<dialog>` 的 inert 背景才鎖得住。少了它, 乙案會比甲案更糟。
  //
  //   Sean 2026-08-24 拍「依照建議」= 乙案(付款中專屬畫面, 那顆「繼續購物」根本不渲染)。
  //   ⚠️ 他買的是**結果**不是方案 —— 若實作撞到與那三行選項不符的現實, 回去找主視窗改,
  //      **不要說「Sean 決定的」**。
  if (submitting && cart.status !== 'ready') {
    return (
      <>
        <CheckoutPaymentOverlay open />
        <CheckoutCartNotice variant="paying" />
      </>
    );
  }

  if (cart.status === 'loading') return <CheckoutCartNotice variant="loading" />;
  // A2:讀不到 ≠ 空車。少了這一行,`error` 會掉進下面 `ready` 的路 ⇒ 結帳頁渲染**零商品的訂單**。
  if (cart.status === 'error') return <CheckoutCartNotice variant="error" />;
  // 空車不進結帳(對齊 design 假設「有商品」;導回購物車)。
  if (cart.status === 'empty') {
    return (
      // 走 navigateToCatalog:落地必須在頂(D-310-A Bug 2;理由見 `lib/catalog-navigation.ts`)。
      <CheckoutCartNotice
        variant="empty"
        onContinueShopping={() => navigateToCatalog(router, '/products')}
      />
    );
  }

  const { lines, subtotal, shipping, total } = cart;
  const nextDisabled = step === 1 && !shippingAddrId;

  return (
    <div data-screen-label="Checkout" className="co-page">
      {/* U5:付款進行中全頁遮罩(原生 dialog top layer;submitting 時鎖住整頁所有回頭/離開入口、
          收斂 drift checkoutStepIndicatorUnlockedDuringPayment;付款鏈零改) */}
      <CheckoutPaymentOverlay open={submitting} />
      <Header currentPage="checkout" />
      <main className="co-main">
        {/* Breadcrumb */}
        <nav className="pp-breadcrumb co-breadcrumb">
          <Link href="/">首頁</Link>
          <span>›</span>
          <Link href="/cart">購物車</Link>
          <span>›</span>
          <span>結帳</span>
        </nav>

        <div className="co-head">
          <div>
            <div className="ap-mono">N°01 · CHECKOUT</div>
            <h1>結帳</h1>
          </div>
          <div className="co-head-meta">共 {lines.length} 件商品</div>
        </div>

        {/* Step indicator(U1:兩步、型別源 CheckoutStepIndicator) */}
        <CheckoutStepIndicator step={step} onStepChange={setStep} locked={submitting} />

        <div className="co-layout">
          {/* ============ LEFT MAIN ============ */}
          <div className="co-body">

            {/* ===== STEP 1: 收件資料 + 配送方式 ===== */}
            {step === 1 && (
              <CheckoutStep1
                addresses={addresses}
                shippingAddrId={shippingAddrId}
                onShippingAddressChange={(id) => {
                  if (id === shippingAddrId) return; // 值沒變 → 不清(只清真正被修正的欄位)
                  setShippingAddrId(id);
                  payErrors.clearKeys(['shipping.address']);
                }}
                shipping={shipping}
                balancePaymentCheckout={balancePaymentCheckout}
                notificationEmailEnabled={notificationEmailEnabled}
                notificationEmail={notificationEmail}
                notificationEmailError={notificationEmailError}
                onNotificationEmailChange={(value) => {
                  if (value === notificationEmail) return; // 值沒變 → 不清
                  setNotificationEmail(value);
                  setNotificationEmailError(null);
                  payErrors.clearKeys(['notificationEmail']);
                }}
                onBack={() => router.push('/cart')}
                onNext={goNext}
                nextDisabled={nextDisabled}
              />
            )}

            {/* ===== STEP 2: 收件摘要 + 發票 + 付款 + 商品 + 條款 + 動作列(U2b 單一元件;U4b 起動作列亦在其內)===== */}
            {step === 2 && (
              <CheckoutStep2
                bankTransferEnabled={bankTransferEnabled}
                paymentChannel={effectiveChannel}
                onPaymentChannelChange={setPickedChannel}
                currentAddr={addresses.find((a) => a.id === shippingAddrId)}
                shippingLabel={shippingLabel}
                onEditAddress={() => setStep(1)}
                invoice={invoice}
                setInvoice={handleInvoiceChange}
                invoiceOverride={invoiceOverride}
                setInvoiceOverride={setInvoiceOverride}
                paymentSlot={
                  <TapPayCardFields
                    ready={tappay.ready}
                    fieldStatus={tappay.fieldStatus}
                    errors={shownCardErrors}
                  />
                }
                lines={lines}
                agreed={agreed}
                onAgreedChange={(v) => {
                  setAgreed(v);
                  payErrors.clearKeys(['terms']);
                }}
                onEditItems={() => router.push('/cart')}
                errors={payErrors.errors}
                paymentAlert={paymentAlert}
                onBack={goBack}
                onSubmit={handleSubmit}
                submitting={submitting}
                payDisabled={payDisabled}
                total={total}
              />
            )}
          </div>

          {/* ============ RIGHT SIDEBAR ============ */}
          <CheckoutSummaryAside
            lines={lines}
            subtotal={subtotal}
            shipping={shipping}
            total={total}
            memberName={memberName}
            memberTier={memberTier}
          />
        </div>

        {/* Mobile buybar */}
        <CheckoutMobileBuybar
          step={step}
          total={total}
          submitting={submitting}
          nextDisabled={nextDisabled}
          payDisabled={payDisabled}
          onNext={goNext}
          onSubmit={handleSubmit}
        />
      </main>
      <HomeFooter />
    </div>
  );
}
