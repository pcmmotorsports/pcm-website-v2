'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FREE_SHIPPING_THRESHOLD } from '@pcm/domain';
import type { CustomerAddress } from '@pcm/domain';
import {
  addAddressAction,
  updateAddressAction,
  deleteAddressAction,
} from '@/app/account/address/actions';
import { InlineAddressForm, type InlineAddressInitial } from '@/components/account/InlineAddressForm';
import { INVOICE_FIELDS_HIDDEN } from '@/lib/invoice-visibility';

export type CheckoutStep1Props = {
  addresses: CustomerAddress[];
  shippingAddrId: string | undefined;
  onShippingAddressChange: (addressId: string) => void;
  shipping: number;
  /** 🔴 補差額商品整車結帳:配送區顯「補款專用・免運」而非宅配(對齊 store→0 免運、不誤導客人)。 */
  balancePaymentCheckout: boolean;
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
  balancePaymentCheckout,
  notificationEmailEnabled,
  notificationEmail,
  notificationEmailError,
  onNotificationEmailChange,
  onBack,
  onNext,
  nextDisabled,
}: CheckoutStep1Props) {
  const router = useRouter();
  // 單一 inline 表單狀態,形狀對齊 `AddressTab`(同時只開一個:新增 or 編輯某一筆)。
  const [addrEdit, setAddrEdit] = useState<InlineAddressInitial | null>(null);
  const [, startTransition] = useTransition();

  // 🔴 存檔成功的收尾由**本層**做(元件續存),不是表單自己 —— 理由與 `AddressTab` 同,
  //   見 `InlineAddressForm` 的 `onSaved` 註解(P-205-STOP ③「新增後不刷新」)。
  //   結帳頁多一件事:**新增成功要自動選中那筆**(主視窗裁定)——客人在結帳頁按新增,
  //   多半就是要用那張;`shippingAddrId` 是 `CheckoutView` 的 lazy init state,
  //   重讀清單不會讓它自己指過去,所以要靠 action 回傳的 `id`(編輯不回 id ⇒ 維持原選取)。
  const handleSaved = (result: { id?: string }) => {
    setAddrEdit(null);
    if (result.id) onShippingAddressChange(result.id);
    router.refresh();
  };

  // 🔴 結帳頁**獨有**的邊界(會員中心沒有「當前選中」的概念):刪掉的若正是選中那張,
  //   `shippingAddrId` 會指向一個不存在的 id ⇒ 下一步的 `nextDisabled` 仍是 false、
  //   卻帶著一個查無的地址往結帳走。落回「其餘地址裡的預設/第一張」;都沒了就清空
  //   (`CheckoutView` 的 `nextDisabled` 會擋住下一步,客人被迫先新增一張)。
  const handleDelete = (id: string) => {
    if (!confirm('確定要刪除這筆地址?')) return;
    startTransition(async () => {
      const result = await deleteAddressAction(id);
      if (!result.ok) return; // 失敗不刷新、卡片留著(不偽裝成功,對齊 AddressTab)
      if (id === shippingAddrId) {
        const rest = addresses.filter((a) => a.id !== id);
        const fallback = rest.find((a) => a.isDefault)?.id ?? rest[0]?.id;
        onShippingAddressChange(fallback ?? '');
      }
      router.refresh();
    });
  };

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
              {/* 🔴 Sean:就地改、不把客人帶離購物車。這兩顆在 <label> 內 ⇒ 點它們會連帶觸發
                  label 的 radio 選取 —— `preventDefault` 擋掉(客人是要改這張,不是要選它)。 */}
              <span className="co-addr-actions">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    setAddrEdit(addrEdit?.id === address.id ? null : address);
                  }}
                >
                  修改
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    handleDelete(address.id);
                  }}
                >
                  刪除
                </button>
              </span>
            </label>
          ))}
          {addrEdit?.id && (
            <div className="co-addr-form" role="group" aria-label="編輯地址">
              <InlineAddressForm
                addr={addrEdit}
                onClose={() => setAddrEdit(null)}
                // id 綁 closure(對齊 AddressTab 的既有做法:表單保持 generic、action 由呼叫端帶 id)
                onSubmit={(input) => updateAddressAction(addrEdit.id!, input)}
                onSaved={handleSaved}
              />
            </div>
          )}
          {/* ~~到會員中心新增 / 管理收件地址(<Link>,會把客人帶離結帳)~~ → 就地新增 */}
          <button
            type="button"
            className="co-addr-add"
            onClick={() => setAddrEdit({ isDefault: addresses.length === 0 })}
          >
            ＋ 新增收件人地址
          </button>
          {addrEdit && !addrEdit.id && (
            <div className="co-addr-form" role="group" aria-label="新增地址">
              <InlineAddressForm
                addr={addrEdit}
                onClose={() => setAddrEdit(null)}
                onSubmit={addAddressAction}
                onSaved={handleSaved}
              />
            </div>
          )}
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
                <div className="co-ship-label">{balancePaymentCheckout ? '補款專用' : '貨運宅配'}</div>
                <div className="co-ship-meta">{shipping === 0 ? '免運' : `NT$ ${shipping}`}</div>
              </div>
              <div className="co-ship-desc">
                {/* 🔴 #291(Sean 07-24 拍 Q2=A):加「出貨後」,與 /terms 第 7 條的訂貨 2-12 週分清楚(2026-08-18 更正條號:原寫「第 10 條」,實際在第 7 條「商品交付」,legal-content.ts:129/133;第 10 條是退貨與契約解除權) */}
                {balancePaymentCheckout
                  ? '補差額 / 運費差額付款專用,免運費'
                  : `滿 NT$ ${FREE_SHIPPING_THRESHOLD.toLocaleString()} 免運,出貨後 1-3 個工作天送達`}
              </div>
            </div>
          </label>
        </div>
      </section>

      <div className="co-actions">
        <button className="btn-outline co-btn-back" onClick={onBack}>← 返回購物車</button>
        <button className="btn-primary co-btn-next" onClick={onNext} disabled={nextDisabled}>
          {/* 字面跟著發票顯示狀態走(理由同 CheckoutStepIndicator 的 STEPS 註解)。 */}
          下一步:{INVOICE_FIELDS_HIDDEN ? '付款' : '發票與付款'} <span>→</span>
        </button>
      </div>
    </>
  );
}
