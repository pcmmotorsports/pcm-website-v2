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
//
// ②-④b 成交流程(取代 e3b 純建單;本檔走 useChargePayment 刷卡整鏈):
//   付款方式選項 body 插 TapPay 安全卡欄(paymentSlot;卡資料零進 React state、useTapPayCard
//   只在 step===2 啟用 setup)→ 確認付款 = getPrime → useChargePayment.submit(chargePaymentAction:
//   server cardholder 組裝 → 建單 → findTotal → 鎖 → charge → confirm)→ 結果映 UI:
//   paid / processing / unknown(action throw 回應遺失層、可能已扣款、審查側 BLOCKER 修)→
//   CheckoutSuccess 終態(processing/unknown 帶勿重複付款文案);error / wait / in_flight
//   → 留頁顯示訊息(wait = 誠實未扣款請稍候、in_flight = 另筆進行中);canGetPrime gate 雙鈕 disabled。
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
import { CheckoutSuccess } from '@/components/CheckoutSuccess';
import { CheckoutRedirecting } from '@/components/CheckoutRedirecting';
import { CheckoutSummaryAside } from '@/components/CheckoutSummaryAside';
import { TapPayCardFields } from '@/components/TapPayCardFields';
import { useResolvedCart } from '@/hooks/useResolvedCart';
import { useChargePayment } from '@/hooks/useChargePayment';
import { useTapPayCard } from '@/hooks/useTapPayCard';
import { confirmProceedIfInflight } from '@/lib/payment/inflight-marker';

// 發票草稿預設(對齊 design defaultInvoice L69、CheckoutInput.invoice zod);
// 模組層常數(穩定參照)避免進 effect deps。
const DEFAULT_INVOICE: InvoiceDraft = {
  type: 'personal',
  carrier: '',
  title: '',
  taxId: '',
  donateCode: '',
};

export type CheckoutViewProps = {
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
  addresses,
  memberName,
  memberTier,
  notificationEmailEnabled,
  initialNotificationEmail,
}: CheckoutViewProps) {
  const router = useRouter();
  const cart = useResolvedCart('home');
  const charge = useChargePayment();

  const [step, setStep] = useState<CheckoutStep>(1);
  const [shippingAddrId, setShippingAddrId] = useState<string | undefined>(
    () => addresses.find((a) => a.isDefault)?.id ?? addresses[0]?.id,
  );
  const [notificationEmail, setNotificationEmail] = useState(initialNotificationEmail);
  const [notificationEmailError, setNotificationEmailError] = useState<string | null>(null);
  // 配送方式:Q1=A 僅 home(後端 white-list 仍含 store、UI 暫不開合作店家取貨);
  // useResolvedCart('home') 直接用字面、運費鏡像走 home。

  // 發票:state 提升至此(跨步驟存活、送出時讀);發票 UI 在 CheckoutStep2(U2b 起唯一節點、無 readonly 複查)。
  // 從選中地址自動帶入、使用者可手動覆寫的 effect 對齊 design L72-76。
  const [invoice, setInvoice] = useState<InvoiceDraft>(DEFAULT_INVOICE);
  const [invoiceOverride, setInvoiceOverride] = useState(false);
  useEffect(() => {
    if (invoiceOverride) return;
    const addr = addresses.find((a) => a.id === shippingAddrId);
    if (addr?.invoice) setInvoice({ ...DEFAULT_INVOICE, ...addr.invoice });
  }, [shippingAddrId, addresses, invoiceOverride]);

  // 同意條款(Step 2 底部)。
  const [agreed, setAgreed] = useState(false);

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

  // ②-④b 刷卡送出(對齊 design submitOrder `if (!agreed) return` 守門 + processing 態):
  // TapPay 卡欄只在 step===2 啟用(U1:卡欄所在步驟由 3 改 2;setup 需容器在 DOM);getPrime 成功才呼 chargePaymentAction
  // (六態契約見 useChargePayment)。🔴 雙擊防線:primeBusyRef 同步原子鎖(state 版 re-render 前
  // 擋不住同一輪連點、getPrime 會重複呼;codex 關卡2 r1)→ getPrime 全程只進一次;
  // 終態(paid/processing、submit 回 true)**不釋放**(r2:終態 render 前的空窗也不得再進
  // getPrime;畫面隨即切 CheckoutSuccess)。primeBusy state 只負責 UI disabled 鏡像。
  // shippingMethod 釘 'home'(Q1=A);身分/金額零 client(RPC auth.uid() + findTotal read-back)。
  const tappay = useTapPayCard(step === 2);
  const primeBusyRef = useRef(false);
  const [primeBusy, setPrimeBusy] = useState(false);
  const [primeError, setPrimeError] = useState<string | null>(null);
  const submitting = charge.state.status === 'submitting' || primeBusy;
  const payDisabled = !agreed || submitting || !tappay.canGetPrime;
  const handleSubmit = async () => {
    if (payDisabled || primeBusyRef.current) return;
    if (!confirmProceedIfInflight()) return; // 🔴 P3:另開分頁防呆軟提醒(取消則不送出;後端 preflight 才是雙扣真防線)
    primeBusyRef.current = true;
    setPrimeBusy(true);
    setPrimeError(null);
    let terminal = false;
    try {
      const prime = await tappay.getPrime();
      if (!prime) {
        setPrimeError('卡片資訊驗證失敗,請確認卡號 / 有效期 / CVV 後重試');
        return;
      }
      terminal = await charge.submit({
        addressId: shippingAddrId,
        shippingMethod: 'home',
        invoice,
        prime,
        agreed,
        ...(notificationEmailEnabled ? { notificationEmail } : {}),
      });
    } finally {
      if (!terminal) {
        primeBusyRef.current = false;
        setPrimeBusy(false);
      }
    }
  };
  // 留頁訊息(getPrime 失敗 / error 可重試 / wait 請稍候 / in_flight 另筆進行中)。
  const stayMessage =
    primeError ??
    (charge.state.status === 'error' ||
      charge.state.status === 'wait' ||
      charge.state.status === 'in_flight'
      ? charge.state.message
      : null);

  // 終態(優先於 loading/empty;clear() 後 cart 轉 empty 不可蓋掉終態)。
  if (charge.state.status === 'paid') {
    return <CheckoutSuccess displayId={charge.state.displayId} />;
  }
  if (charge.state.status === 'processing') {
    return (
      <CheckoutSuccess
        displayId={charge.state.displayId}
        variant="processing"
        message={charge.state.message}
      />
    );
  }
  // unknown(②-④ fix、審查側 BLOCKER):action throw = 回應遺失層、可能已扣款 → 終態勿重複
  // 付款(無單號;hook 已清車 + 持鎖、不可重送)。
  if (charge.state.status === 'unknown') {
    return <CheckoutSuccess variant="unknown" message={charge.state.message} />;
  }
  // 🔴 3DS-6b(flag on 3DS 啟動成功):整頁導向 TapPay payment_url(導向副作用封裝於 CheckoutRedirecting
  //   的 useEffect、render 期不副作用;付款狀態非終態、不清車)。
  if (charge.state.status === 'redirect') {
    return <CheckoutRedirecting redirectUrl={charge.state.redirectUrl} />;
  }

  if (cart.status === 'loading') {
    return (
      <div data-screen-label="Checkout" className="co-page">
        <Header currentPage="checkout" />
        <div className="cart-loading">載入結帳資料…</div>
        <HomeFooter />
      </div>
    );
  }

  // 空車不進結帳(對齊 design 假設「有商品」;導回購物車)。
  if (cart.status === 'empty') {
    return (
      <div data-screen-label="Checkout" className="co-page">
        <Header currentPage="checkout" />
        <div className="cart-empty">
          <h2>購物車是空的</h2>
          <p>先挑選部品再來結帳吧。</p>
          <button className="btn-primary" onClick={() => router.push('/products')}>繼續購物</button>
        </div>
        <HomeFooter />
      </div>
    );
  }

  const { lines, subtotal, shipping, total } = cart;
  const nextDisabled = step === 1 && !shippingAddrId;

  return (
    <div data-screen-label="Checkout" className="co-page">
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
        <CheckoutStepIndicator step={step} onStepChange={setStep} />

        <div className="co-layout">
          {/* ============ LEFT MAIN ============ */}
          <div className="co-body">

            {/* ===== STEP 1: 收件資料 + 配送方式 ===== */}
            {step === 1 && (
              <CheckoutStep1
                addresses={addresses}
                shippingAddrId={shippingAddrId}
                onShippingAddressChange={setShippingAddrId}
                shipping={shipping}
                notificationEmailEnabled={notificationEmailEnabled}
                notificationEmail={notificationEmail}
                notificationEmailError={notificationEmailError}
                onNotificationEmailChange={(value) => {
                  setNotificationEmail(value);
                  setNotificationEmailError(null);
                }}
                onBack={() => router.push('/cart')}
                onNext={goNext}
                nextDisabled={nextDisabled}
              />
            )}

            {/* ===== STEP 2: 收件摘要 + 發票 + 付款 + 商品 + 條款(U2b 起單一元件)===== */}
            {step === 2 && (
              <>
                <CheckoutStep2
                  currentAddr={addresses.find((a) => a.id === shippingAddrId)}
                  shippingLabel="貨運宅配"
                  onEditAddress={() => setStep(1)}
                  invoice={invoice}
                  setInvoice={setInvoice}
                  invoiceOverride={invoiceOverride}
                  setInvoiceOverride={setInvoiceOverride}
                  paymentSlot={
                    <TapPayCardFields ready={tappay.ready} fieldStatus={tappay.fieldStatus} />
                  }
                  lines={lines}
                  agreed={agreed}
                  onAgreedChange={setAgreed}
                  onEditItems={() => router.push('/cart')}
                />
                {stayMessage && (
                  <p className="co-submit-error" role="alert">
                    {stayMessage}
                  </p>
                )}
                <div className="co-actions">
                  <button className="btn-outline co-btn-back" onClick={goBack} disabled={submitting}>← 上一步</button>
                  <button
                    className="btn-primary co-btn-pay"
                    disabled={payDisabled}
                    onClick={handleSubmit}
                  >
                    {submitting ? '處理中…' : <>確認付款 NT$ {total.toLocaleString()} <span>→</span></>}
                  </button>
                </div>
              </>
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
        <div className="co-mobile-buybar">
          <div className="co-mobile-buybar-info">
            <div className="ap-mono">{step === 2 ? '應付總額' : '目前金額'}</div>
            <div className="co-mobile-buybar-price">NT$ {total.toLocaleString()}</div>
          </div>
          {step === 1 ? (
            <button className="btn-primary co-mobile-buybar-btn" onClick={goNext} disabled={nextDisabled}>
              下一步 <span>→</span>
            </button>
          ) : (
            <button
              className="btn-primary co-mobile-buybar-btn"
              onClick={handleSubmit}
              disabled={payDisabled}
            >
              {submitting ? '處理中…' : '確認付款'}
            </button>
          )}
        </div>
      </main>
      <HomeFooter />
    </div>
  );
}
