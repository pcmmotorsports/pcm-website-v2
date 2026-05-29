'use client';

// AddressTab.tsx — 會員中心「收件地址」分頁(g-1a stub → g-5a 唯讀列表 → g-5b 新增表單)
//
// 字面從 design-reference/components/AccountPages.jsx address tab(L624-660)直接搬(鐵則 1、不翻譯):
// - .acc-section + .acc-section-head h2「收件地址」+ .acc-add「＋ 新增地址」鈕(design L628)
// - .acc-address 容器 + addresses.map → .acc-addr 卡(.acc-addr-tag 預設標籤 / -name / -phone / -line)
// - 空清單 → design 字面「尚未新增地址 — 新增後結帳可直接帶入。」(.acc-empty、design L651)
// - 新增模式 InlineAddressForm 顯於 .acc-address 底部(design L653-657、.acc-inline-form 包)
//
// g-5b 新增表單(本片接寫入):
// - 「＋ 新增地址」鈕 → 開 InlineAddressForm new 模式(addr.isDefault = addresses.length===0、對齊 design L628)
//   + 預填 name = defaultName(會員姓名、對齊 design L628 `name: user.name || ''`;AccountView 傳 profile.name)
// - 表單接 addAddressAction(onSubmit prop);成功 router.refresh()〔清單即時刷新〕+ onClose()〔收合〕
// - **編輯/刪除鈕仍不渲染**(design L638-641 .acc-addr-actions 留 g-5c;g-5b 只接新增)
// - **絕不搬 design localStorage mock 地址**(只渲染真 addresses prop)
//
// 對應 backlog:#198(company 統編 DB CHECK ^\d{8}$、Consider、獨立 migration slice);g-5b 接 e-2a addAddress、編輯/刪除/設預設留 g-5c。
import { useState } from 'react';
import type { CustomerAddress } from '@pcm/domain';
import { InlineAddressForm } from '@/components/account/InlineAddressForm';
import { addAddressAction } from '@/app/account/address/actions';

export type AddressTabProps = {
  addresses: CustomerAddress[];
  // 新增表單預填收件人姓名(會員姓名、對齊 design L628;AccountView 傳 profile.name)。
  defaultName: string;
};

export function AddressTab({ addresses, defaultName }: AddressTabProps) {
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="acc-section" data-tab="address">
      <div className="acc-section-head">
        <h2>收件地址</h2>
        <button className="acc-add" onClick={() => setShowForm(true)}>
          ＋ 新增地址
        </button>
      </div>
      <div className="acc-address">
        {addresses.map((a) => (
          <div className="acc-addr" key={a.id}>
            {a.isDefault && <div className="acc-addr-tag">預設</div>}
            <div className="acc-addr-name">{a.name}</div>
            <div className="acc-addr-phone">{a.phone}</div>
            <div className="acc-addr-line">{a.line}</div>
          </div>
        ))}
        {addresses.length === 0 && (
          <div className="acc-empty">尚未新增地址 — 新增後結帳可直接帶入。</div>
        )}
        {showForm && (
          <div className="acc-inline-form">
            <InlineAddressForm
              addr={{ isDefault: addresses.length === 0, name: defaultName }}
              onClose={() => setShowForm(false)}
              onSubmit={addAddressAction}
            />
          </div>
        )}
      </div>
    </div>
  );
}
