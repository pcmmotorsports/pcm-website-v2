'use client';

import Link from 'next/link';
import { FREE_SHIPPING_THRESHOLD } from '@pcm/domain';
import type { CustomerAddress } from '@pcm/domain';

export type CheckoutStep1Props = {
  addresses: CustomerAddress[];
  shippingAddrId: string | undefined;
  onShippingAddressChange: (addressId: string) => void;
  shipping: number;
  notificationEmailEnabled: boolean;
  notificationEmail: string;
  notificationEmailError: string | null;
  onNotificationEmailChange: (value: string) => void;
  onBack: () => void;
  onNext: () => void;
  nextDisabled: boolean;
};

export function CheckoutStep1({
  addresses,
  shippingAddrId,
  onShippingAddressChange,
  shipping,
  notificationEmailEnabled,
  notificationEmail,
  notificationEmailError,
  onNotificationEmailChange,
  onBack,
  onNext,
  nextDisabled,
}: CheckoutStep1Props) {
  return (
    <>
      <section className="co-section">
        <div className="co-section-head">
          <div className="ap-mono">N°01 · DELIVERY ADDRESS</div>
          <h2>收件資料</h2>
        </div>
        <div className="co-addr-list">
          {addresses.map((address) => (
            <label key={address.id} className={`co-addr ${shippingAddrId === address.id ? 'is-on' : ''}`}>
              <input
                type="radio"
                name="addr"
                checked={shippingAddrId === address.id}
                onChange={() => onShippingAddressChange(address.id)}
              />
              <span className="co-addr-radio" />
              <div className="co-addr-body">
                <div className="co-addr-row">
                  <span className="co-addr-name">{address.name}</span>
                  <span className="co-addr-phone">{address.phone}</span>
                  {address.isDefault && <span className="co-addr-tag ap-mono">DEFAULT</span>}
                </div>
                <div className="co-addr-line">{address.line}</div>
              </div>
            </label>
          ))}
          <Link href="/account" className="co-addr-add">
            ＋ 到會員中心新增 / 管理收件地址
          </Link>
        </div>

        {notificationEmailEnabled && (
          <label className="auth-field co-notification-email" htmlFor="checkout-notification-email">
            <span>Email</span>
            <input
              id="checkout-notification-email"
              name="notificationEmail"
              type="email"
              aria-label="Email"
              inputMode="email"
              autoComplete="email"
              value={notificationEmail}
              aria-invalid={notificationEmailError ? 'true' : undefined}
              aria-describedby="checkout-notification-email-hint"
              onChange={(event) => onNotificationEmailChange(event.target.value)}
            />
            <small id="checkout-notification-email-hint" className="co-field-hint">
              此信箱也可能用於信用卡付款驗證
            </small>
            {notificationEmailError && (
              <span className="auth-field-err" role="alert">
                {notificationEmailError}
              </span>
            )}
          </label>
        )}
      </section>

      <section className="co-section">
        <div className="co-section-head">
          <div className="ap-mono">N°02 · SHIPPING METHOD</div>
          <h2>配送方式</h2>
        </div>
        <div className="co-ship-grid">
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
        <button className="btn-outline co-btn-back" onClick={onBack}>← 返回購物車</button>
        <button className="btn-primary co-btn-next" onClick={onNext} disabled={nextDisabled}>
          下一步:付款方式 <span>→</span>
        </button>
      </div>
    </>
  );
}
