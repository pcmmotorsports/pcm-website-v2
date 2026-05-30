'use client';

// AddressTab.tsx — 會員中心「收件地址」分頁(g-1a stub → g-5a 唯讀列表 → g-5b 新增表單 → g-5c 編輯/刪除)
//
// 字面從 design-reference/components/AccountPages.jsx address tab(L624-660)直接搬(鐵則 1、不翻譯):
// - .acc-section + .acc-section-head h2「收件地址」+ .acc-add「＋ 新增地址」鈕(design L628)
// - .acc-address 容器 + addresses.map → .acc-addr 卡(.acc-addr-tag 預設標籤 / -name / -phone / -line)
// - .acc-addr-actions「編輯 / 刪除」鈕(design L638-641):編輯 toggle 開該卡 inline 編輯表單、刪除接 deleteAddressAction
// - 空清單 → design 字面「尚未新增地址 — 新增後結帳可直接帶入。」(.acc-empty、design L651)
// - InlineAddressForm 顯於對應位置:編輯模式接在該卡後(design L645-648)、新增模式於清單底部(design L653-657)
//
// 單一 inline 表單狀態(對齊 design addrEdit、L347/L628/L639/L646/L655):
// - addrEdit = null → 表單全關;無 id → 新增模式(清單底部);有 id → 編輯該筆(該卡後)。
// - 同一時間只開一個表單(新增 or 編輯):新 state 覆蓋舊 state、天然互斥(對齊 design 單一 addrEdit)。
//
// g-5c 接 e-2a session-write(InlineAddressForm onSubmit prop 可重用):
// - 新增 → addAddressAction(g-5b);編輯 → (input) => updateAddressAction(a.id, input)(id 綁 parent closure、對齊 InlineAddressForm 註解設計)
// - 刪除 → deleteAddressAction(a.id) → ok 後 router.refresh()〔g-4c pattern、重讀 page server component 即時刷新清單〕
// - **設預設無獨立鈕**(design 卡片只有編輯/刪除、已 grep 確認):改預設靠編輯表單「設為預設地址」勾選 → updateAddress 內建 swap;
//   setDefaultAddress use-case 本 UI 不接、不硬塞按鈕。
// - **絕不搬 design localStorage mock 地址**(只渲染真 addresses prop)
//
// 對應 backlog:#198(company 統編 DB CHECK ^\d{8}$、Consider、獨立 migration slice)。
import { Fragment, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { CustomerAddress } from '@pcm/domain';
import { InlineAddressForm, type InlineAddressInitial } from '@/components/account/InlineAddressForm';
import {
  addAddressAction,
  updateAddressAction,
  deleteAddressAction,
} from '@/app/account/address/actions';

export type AddressTabProps = {
  addresses: CustomerAddress[];
  // 新增表單預填收件人姓名(會員姓名、對齊 design L628;AccountView 傳 profile.name)。
  defaultName: string;
};

export function AddressTab({ addresses, defaultName }: AddressTabProps) {
  // 單一 inline 表單狀態(對齊 design addrEdit):null=全關 / 無 id=新增 / 有 id=編輯該筆。
  const [addrEdit, setAddrEdit] = useState<InlineAddressInitial | null>(null);
  const router = useRouter();
  const [, startTransition] = useTransition();

  // 刪除:design L362-363 deleteAddress 內 confirm('確定要刪除這筆地址？')確認後刪、直接搬(L640 刪除鈕呼叫 handler);
  // 接 deleteAddressAction(ownership 由 use-case + RLS 守);ok 才 router.refresh()(清單即時刷新);
  // 失敗時 design 無刪除錯誤 UI、不刷新留卡片(graceful、不偽裝成功)。
  const handleDelete = (id: string) => {
    // 同步、user gesture 內彈確認(對齊 design L363 原字面);取消即不刪。
    if (!confirm('確定要刪除這筆地址？')) return;
    startTransition(async () => {
      const result = await deleteAddressAction(id);
      if (result.ok) {
        router.refresh();
      }
    });
  };

  return (
    <div className="acc-section" data-tab="address">
      <div className="acc-section-head">
        <h2>收件地址</h2>
        <button
          className="acc-add"
          onClick={() => setAddrEdit({ isDefault: addresses.length === 0, name: defaultName })}
        >
          ＋ 新增地址
        </button>
      </div>
      <div className="acc-address">
        {addresses.map((a) => (
          <Fragment key={a.id}>
            <div className="acc-addr">
              {a.isDefault && <div className="acc-addr-tag">預設</div>}
              <div className="acc-addr-name">{a.name}</div>
              <div className="acc-addr-phone">{a.phone}</div>
              <div className="acc-addr-line">{a.line}</div>
              <div className="acc-addr-actions">
                {/* 編輯 toggle:點開該卡編輯表單;再點同卡收合(對齊 design L639 setAddrEdit toggle) */}
                <button onClick={() => setAddrEdit(addrEdit?.id === a.id ? null : a)}>編輯</button>
                <button onClick={() => handleDelete(a.id)}>刪除</button>
              </div>
            </div>
            {addrEdit?.id === a.id && (
              <div
                className="acc-inline-form"
                ref={(el) => el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}
              >
                <InlineAddressForm
                  addr={addrEdit}
                  onClose={() => setAddrEdit(null)}
                  // id 綁 parent closure(對齊 InlineAddressForm 註解設計:form 保持 generic、action 由 parent 帶 id)。
                  onSubmit={(input) => updateAddressAction(a.id, input)}
                />
              </div>
            )}
          </Fragment>
        ))}
        {addresses.length === 0 && (
          <div className="acc-empty">尚未新增地址 — 新增後結帳可直接帶入。</div>
        )}
        {addrEdit && !addrEdit.id && (
          <div
            className="acc-inline-form"
            ref={(el) => el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}
          >
            <InlineAddressForm
              addr={addrEdit}
              onClose={() => setAddrEdit(null)}
              onSubmit={addAddressAction}
            />
          </div>
        )}
      </div>
    </div>
  );
}
