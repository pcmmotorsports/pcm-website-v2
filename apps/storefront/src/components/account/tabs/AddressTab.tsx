// AddressTab.tsx — 會員中心「收件地址」分頁(g-1a stub → g-5a 唯讀列表;寫入留 g-5b/g-5c)
//
// 字面從 design-reference/components/AccountPages.jsx address tab(L624-660)直接搬(鐵則 1、不翻譯):
// - .acc-section + .acc-section-head h2「收件地址」(沿用 OrdersTab/FavoritesTab 殼 pattern)
// - .acc-address 容器 + addresses.map → .acc-addr 卡(.acc-addr-tag 預設標籤〔a.isDefault〕/ .acc-addr-name /
//   .acc-addr-phone / .acc-addr-line);CustomerAddress.{name,phone,line,isDefault} 逐欄對齊 design a.{...}
// - 空清單 → design 字面「尚未新增地址 — 新增後結帳可直接帶入。」(.acc-empty、design L651)
//
// g-5a 唯讀地基(只渲染 server 傳入的真 addresses prop):
// - **不渲染** design L628 .acc-add「＋ 新增地址」鈕 + L638-641 .acc-addr-actions「編輯/刪除」鈕 + InlineAddressForm
//   (寫入互動:新增/編輯/刪除留 g-5b、設預設留 g-5c;g-5a 先不渲染 action 鈕、避免 dead button)
// - **絕不搬 design mock 地址**(design 用 localStorage pcm-addresses mock;本檔只渲染真 addresses prop)
// - .acc-address 容器 design 無 CSS 規則(plain div、卡片 block flow 堆疊)、g-5a 不發明(鐵則 1)
//
// 對應 backlog:無新條(g-5a 讀地基、g-5b/c 接寫入)。
import type { CustomerAddress } from '@pcm/domain';

export type AddressTabProps = {
  addresses: CustomerAddress[];
};

export function AddressTab({ addresses }: AddressTabProps) {
  return (
    <div className="acc-section" data-tab="address">
      <div className="acc-section-head">
        <h2>收件地址</h2>
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
      </div>
    </div>
  );
}
