'use client';

// CheckoutView.tsx — 結帳頁 client 殼(M-3-S2-b2-e1)
//
// 直接搬 design-reference/components/CheckoutPage.jsx(L163-694、鐵則 1 字面)。
// e1 範圍:結帳殼 + 3 步指示器 + Step1(收件地址選擇 + 配送方式)+ 右側訂單摘要 + mobile buybar。
//   Step2(發票 / 付款)= e2、Step3(確認 / 建單)= e3,本片渲染 placeholder。
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

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FREE_SHIPPING_THRESHOLD } from '@pcm/domain';
import type { CustomerAddress, MemberTier } from '@pcm/domain';
import { Header } from '@/components/Header';
import { HomeFooter } from '@/components/HomeFooter';
import { TierBadge } from '@/components/TierBadge';
import { CheckoutStep2, type InvoiceDraft } from '@/components/CheckoutStep2';
import { CheckoutStep3 } from '@/components/CheckoutStep3';
import { CheckoutSuccess } from '@/components/CheckoutSuccess';
import { useResolvedCart } from '@/hooks/useResolvedCart';
import { usePlaceOrder } from '@/hooks/usePlaceOrder';

const STEPS = [
  { n: 1, l: '收件資料' },
  { n: 2, l: '付款方式' },
  { n: 3, l: '確認訂單' },
] as const;

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
};

export function CheckoutView({ addresses, memberName, memberTier }: CheckoutViewProps) {
  const router = useRouter();
  const cart = useResolvedCart('home');
  const placeOrder = usePlaceOrder();

  const [step, setStep] = useState(1);
  const [shippingAddrId, setShippingAddrId] = useState<string | undefined>(
    () => addresses.find((a) => a.isDefault)?.id ?? addresses[0]?.id,
  );
  // 配送方式:Q1=A 僅 home(後端 white-list 仍含 store、UI 暫不開合作店家取貨);
  // useResolvedCart('home') 直接用字面、運費鏡像走 home。

  // 發票:state 提升至此(跨步驟存活、e3 送出時讀);Step2 UI 在 CheckoutStep2、Step3 複查在 CheckoutStep3。
  // 從選中地址自動帶入、使用者可手動覆寫的 effect 對齊 design L72-76。
  const [invoice, setInvoice] = useState<InvoiceDraft>(DEFAULT_INVOICE);
  const [invoiceOverride, setInvoiceOverride] = useState(false);
  useEffect(() => {
    if (invoiceOverride) return;
    const addr = addresses.find((a) => a.id === shippingAddrId);
    if (addr?.invoice) setInvoice({ ...DEFAULT_INVOICE, ...addr.invoice });
  }, [shippingAddrId, addresses, invoiceOverride]);

  // 同意條款(Step3)。
  const [agreed, setAgreed] = useState(false);

  const goNext = () => setStep((s) => Math.min(3, s + 1));
  const goBack = () => setStep((s) => Math.max(1, s - 1));

  // 送出建單(e3b 接線;對齊 design submitOrder L121-141 的 `if (!agreed) return` 守門 + processing 態)。
  // placeOrderAction:server getUser 守門 + CheckoutInput.parse + 購物車線獨立 zod → create_order RPC
  //   建未付款單(Q2=A);成功 → 清車 + 結帳頁內最小成功狀態(Q-e3=A)。真卡零接、prime token 留階段②。
  // shippingMethod 釘 'home'(Q1=A;後端白名單仍含 store);身分不從此送、由 RPC auth.uid() 零信任重查。
  const submitting = placeOrder.state.status === 'submitting';
  const handleSubmit = () => {
    if (!agreed || submitting) return;
    void placeOrder.submit({ addressId: shippingAddrId, shippingMethod: 'home', invoice });
  };

  // 建單成功 → 結帳頁內最小成功狀態(優先於 loading/empty;clear() 後 cart 轉 empty 不可蓋掉成功)。
  if (placeOrder.state.status === 'success') {
    return <CheckoutSuccess displayId={placeOrder.state.displayId} />;
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

        {/* Step indicator */}
        <div className="co-steps">
          {STEPS.map((s) => {
            const state = step > s.n ? 'is-done' : step === s.n ? 'is-active' : '';
            return (
              <button
                key={s.n}
                className={`co-step ${state}`}
                onClick={() => { if (step > s.n) setStep(s.n); }}
                disabled={step < s.n}
              >
                <span className="co-step-num">{state === 'is-done' ? '✓' : String(s.n).padStart(2, '0')}</span>
                <span className="co-step-label">{s.l}</span>
              </button>
            );
          })}
        </div>

        <div className="co-layout">
          {/* ============ LEFT MAIN ============ */}
          <div className="co-body">

            {/* ===== STEP 1: 收件資料 + 配送方式 ===== */}
            {step === 1 && (
              <>
                <section className="co-section">
                  <div className="co-section-head">
                    <div className="ap-mono">N°01 · DELIVERY ADDRESS</div>
                    <h2>收件資料</h2>
                  </div>
                  <div className="co-addr-list">
                    {addresses.map((a) => (
                      <label key={a.id} className={`co-addr ${shippingAddrId === a.id ? 'is-on' : ''}`}>
                        <input
                          type="radio"
                          name="addr"
                          checked={shippingAddrId === a.id}
                          onChange={() => setShippingAddrId(a.id)}
                        />
                        <span className="co-addr-radio" />
                        <div className="co-addr-body">
                          <div className="co-addr-row">
                            <span className="co-addr-name">{a.name}</span>
                            <span className="co-addr-phone">{a.phone}</span>
                            {a.isDefault && <span className="co-addr-tag ap-mono">DEFAULT</span>}
                          </div>
                          <div className="co-addr-line">{a.line}</div>
                        </div>
                      </label>
                    ))}
                    {/* 新增地址延後(e1 偏離):連會員中心管理收件地址(單一 CRUD 源) */}
                    <Link href="/account" className="co-addr-add">
                      ＋ 到會員中心新增 / 管理收件地址
                    </Link>
                  </div>
                </section>

                <section className="co-section">
                  <div className="co-section-head">
                    <div className="ap-mono">N°02 · SHIPPING METHOD</div>
                    <h2>配送方式</h2>
                  </div>
                  <div className="co-ship-grid">
                    {/* Q1=A 僅宅配 home(合作店家取貨延後) */}
                    <label className="co-ship is-on">
                      <input type="radio" name="ship" checked readOnly />
                      <span className="co-ship-radio" />
                      <div className="co-ship-body">
                        <div className="co-ship-head-row">
                          <div className="co-ship-label">貨運宅配</div>
                          <div className="co-ship-meta">{shipping === 0 ? '免運' : `NT$ ${shipping}`}</div>
                        </div>
                        <div className="co-ship-desc">
                          滿 NT$ {FREE_SHIPPING_THRESHOLD.toLocaleString()} 免運,1-3 個工作天送達
                        </div>
                      </div>
                    </label>
                  </div>
                </section>

                <div className="co-actions">
                  <button className="btn-outline co-btn-back" onClick={() => router.push('/cart')}>← 返回購物車</button>
                  <button className="btn-primary co-btn-next" onClick={goNext} disabled={nextDisabled}>
                    下一步:付款方式 <span>→</span>
                  </button>
                </div>
              </>
            )}

            {/* ===== STEP 2: 發票 + 付款方式(e2)===== */}
            {step === 2 && (
              <>
                <CheckoutStep2
                  invoice={invoice}
                  setInvoice={setInvoice}
                  invoiceOverride={invoiceOverride}
                  setInvoiceOverride={setInvoiceOverride}
                />
                <div className="co-actions">
                  <button className="btn-outline co-btn-back" onClick={goBack}>← 上一步</button>
                  <button className="btn-primary co-btn-next" onClick={goNext}>
                    下一步:確認訂單 <span>→</span>
                  </button>
                </div>
              </>
            )}

            {/* ===== STEP 3: 確認訂單(e3a UI;送出建單 e3b 接)===== */}
            {step === 3 && (
              <>
                <CheckoutStep3
                  currentAddr={addresses.find((a) => a.id === shippingAddrId)}
                  shippingLabel="貨運宅配"
                  invoice={invoice}
                  lines={lines}
                  agreed={agreed}
                  onAgreedChange={setAgreed}
                  onEditAddress={() => setStep(1)}
                  onEditStep2={() => setStep(2)}
                  onEditItems={() => router.push('/cart')}
                />
                {placeOrder.state.status === 'error' && (
                  <p className="co-submit-error" role="alert">
                    {placeOrder.state.message}
                  </p>
                )}
                <div className="co-actions">
                  <button className="btn-outline co-btn-back" onClick={goBack} disabled={submitting}>← 上一步</button>
                  <button
                    className="btn-primary co-btn-pay"
                    disabled={!agreed || submitting}
                    onClick={handleSubmit}
                  >
                    {submitting ? '處理中…' : <>確認付款 NT$ {total.toLocaleString()} <span>→</span></>}
                  </button>
                </div>
              </>
            )}
          </div>

          {/* ============ RIGHT SIDEBAR ============ */}
          <aside className="co-aside">
            <div className="co-summary">
              <div className="co-summary-head">
                <div className="ap-mono">ORDER SUMMARY</div>
              </div>

              <div className="co-summary-items">
                {lines.map(({ item, resolved: line, lineTotal }) => (
                  <div key={`${item.productId}-${item.variantId ?? ''}`} className="co-summary-item">
                    <span className="co-summary-item-qty">{item.qty}×</span>
                    <span className="co-summary-item-name">{line.name}</span>
                    <span className="co-summary-item-price">NT$ {lineTotal.toLocaleString()}</span>
                  </div>
                ))}
              </div>

              <div className="co-summary-lines">
                <div className="co-line"><span>商品小計</span><span>NT$ {subtotal.toLocaleString()}</span></div>
                <div className="co-line"><span>運費</span><span>{shipping === 0 ? '免運' : `NT$ ${shipping}`}</span></div>
              </div>

              <div className="co-grand">
                <span>應付總額</span>
                <span className="co-grand-val">NT$ {total.toLocaleString()}</span>
              </div>

              {/* Member info */}
              <div className="co-member-block">
                <div className="ap-mono co-member-label">MEMBER</div>
                <div className="co-member-row">
                  <div className="co-member-name">{memberName}</div>
                  <TierBadge tier={memberTier} size="sm" />
                </div>
                {memberTier === 'general' && (
                  <Link href="/account" className="co-member-upgrade">
                    升級店家會員 · 享更多優惠 →
                  </Link>
                )}
              </div>

              <div className="co-perks">
                <div><span>✓</span> 滿 NT$ {FREE_SHIPPING_THRESHOLD.toLocaleString()} 宅配免運</div>
                <div><span>✓</span> 原廠正品保固</div>
                <div><span>✓</span> TapPay PCI-DSS 安全加密</div>
              </div>
            </div>
          </aside>
        </div>

        {/* Mobile buybar */}
        <div className="co-mobile-buybar">
          <div className="co-mobile-buybar-info">
            <div className="ap-mono">{step === 3 ? '應付總額' : '目前金額'}</div>
            <div className="co-mobile-buybar-price">NT$ {total.toLocaleString()}</div>
          </div>
          {step < 3 ? (
            <button className="btn-primary co-mobile-buybar-btn" onClick={goNext} disabled={nextDisabled}>
              下一步 <span>→</span>
            </button>
          ) : (
            <button
              className="btn-primary co-mobile-buybar-btn"
              onClick={handleSubmit}
              disabled={!agreed || submitting}
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
