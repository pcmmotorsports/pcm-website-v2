'use client';

import { ACCOUNT_TAB_IDS, NAV, type AccountTabId } from './account-nav';

// AccountView.tsx — 會員中心 client 殼(g-1a 建、g-2 接 overview/orders 真資料、g-4a 加 profile prop)
//
// 直接搬 design-reference/components/AccountPages.jsx AccountPage 殼(acc-head L432-442 + acc-nav 7-tab
// L445-464)。薄 router(codex 關卡1 finding-6):依 tab state 渲染對應 tab component(g-1a = stub、
// g-2~g-7 各填真內容、各自獨立檔不撐爆鐵則 6)。
//
// - tab 切換 client setState(對齊 design setTab),而**初值由 `?tab=` 決定**。
//   🔴 **2026-08-27:`deep-link ?tab=` 從「留 M-3+」變成【現在做】,而那【不是推翻拍板】。**
//   舊字面:~~「deep-link ?tab= 留 M-3+」~~。原拍板逐字(`docs/archive/2026-07-25-docs-cleanup/
//   handoff/2026-05-27-g-1-plan.md:9`):
//     「**決策2=A**(分頁純 client setState 對齊 design setTab、deep-link `?tab=` 留 M-3+
//       **真有消費者再補**)」
//   ⇒ 押後的條件寫的是【真有消費者】,而 `OrderDetailView.tsx:147` 那顆返回鈕
//     (`#240`,2026-08-23 上線)**就是第一個消費者** ⇒ 條件在 08-23 那天就成立了。
//   📌 **一個押後決定把自己的解鎖條件寫進了註解 —— 而條件成立那天,沒有人回來看。**
//   ⇒ 提前做的授權:Sean 2026-08-27 拍 **B**(跳整頁保留、只修「回不來」)。
// - 登出走 app/account/actions.ts logoutAction server action(非 client 直接 signOut;finding-4)。
// - user.displayEmail 由 server page.tsx 過濾 LINE 合成 email 後傳入(line.ts 為 server-only、
//   不可在 client 端 import,故過濾在 server 完成、本檔只渲染 displayEmail;codex k1 round2 M-r2-1)。
//   - displayName / avatar fallback 也用 displayEmail、不用 raw email(codex round2 M-r2-2:防 name 空時洩 raw)。
//   - displayEmail 空字串 → acc-email 整段不 render(LINE 用戶常見)、UI 不留空白行。
// - route adaptation:Header / HomeFooter(對齊 storefront 慣例、非 design 的 onNav prop)。
//
// g-2(plan v2):
// - 新 stats prop:tier / walletBalance / orderCount(server 傳入、forward 給 OverviewTab)
// - 新 featured prop:fetchFeaturedProducts() 結果(perf/P3 起函式釘 general 不收 tier;server 傳入、forward 給 OverviewTab)
// - OrdersTab 暫不接 prop(真用戶 0 筆訂單 = 空狀態、純 view、M-3 真接訂單時再加 prop)
// - g-3~g-7 各 tab 仍 stub(本 slice 不動其他 5 tab、.acc-stub class 保留)
//
// g-4a(Sean Q4=A、2026-05-28):
// - 新 profile prop:{ name, phone, birthday }(page.tsx 從 customers SoT 算好傳入)
// - displayName / avatarChar 改用 profile.name 為主(原 user.name)、表達 Q4=A SoT 意圖
//   (page.tsx 已把 user.name 與 profile.name 設成同值;改用 profile.name 是語義清楚、非行為變更)
// - profile prop forward 給 ProfileTab(g-4a stub 接 prop 但暫不渲染、g-4b form 真用)
//
// g-4b(Sean Q2-1=b、2026-05-28):
// - ProfileTab 換真 form(接 updateProfileAction)、額外 forward user.displayEmail 給 ProfileTab Email 欄
//   (LINE 用戶 displayEmail='' → ProfileTab 顯替代字面「LINE 帳號登入,無 Email」、不可編輯)
//
// g-5a(2026-05-29):
// - 新 addresses prop:CustomerAddress[](page.tsx getAddressRepo→listByCustomer 算好傳入)
// - forward 給 AddressTab 渲染地址清單 + g-5b defaultName 預填(g-5b 接新增表單;編輯/刪除/設預設留 g-5c)
//
// g-6a(2026-05-31):
// - 新 vehicles prop:CustomerVehicle[](page.tsx getVehicleRepo→listByCustomer 算好傳入)
// - forward 給 VehiclesTab 唯讀渲染愛車清單(g-6b 接新增表單;編輯/刪除/設主車留 g-6c)

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Header } from '@/components/Header';
import { HomeFooter } from '@/components/HomeFooter';
import { logoutAction } from '@/app/account/actions';
import { OverviewTab } from '@/components/account/tabs/OverviewTab';
import { OrdersTab } from '@/components/account/tabs/OrdersTab';
import { WalletTab } from '@/components/account/tabs/WalletTab';
import { FavoritesTab } from '@/components/account/tabs/FavoritesTab';
import { VehiclesTab } from '@/components/account/tabs/VehiclesTab';
import { AddressTab } from '@/components/account/tabs/AddressTab';
import { ProfileTab } from '@/components/account/tabs/ProfileTab';
import type { MemberTier, CustomerAddress, CustomerVehicle, OrderListItem, FavoriteListItem , WalletLedgerEntry } from '@pcm/domain';
import type { FeaturedResult } from '@/lib/products';
import type { MockMotoBrand } from '@/data/mock-moto-brands';

export type AccountUser = { name: string; displayEmail: string };
export type AccountStats = { tier: MemberTier; walletBalance: number; orderCount: number };
// g-4a:profile 三欄(form 用 string、空值 ''、不用 null;page.tsx 已 null→'' 還原)
export type AccountProfile = {
  name: string;
  phone: string;
  birthday: string;
  /**
   * 性別代碼(`''` = 未選)。**送的是代碼、顯示的是中文** ——
   * 對應表 `@pcm/schemas` 的 `GENDER_LABEL`,與註冊表單用的是同一份。
   * 🔵 而那一致性是刻意的:同一個客人在註冊時看過那顆下拉,
   *    兩處用不同的字會讓他以為是兩件事。
   */
  gender: string;
};

// 7 tab 的 id / label 字面對齊 design AccountPages.jsx L447-453,**本批未動**。
// 🔶 第4批 R1 9-2(Sean 2026-08-05「優化整體字體、圖示、比例」):
//    icon 由幾何字元 `◉ □ ◈ ♡ ◎ ▸ ✎` 改 **inline SVG**,規格與殼(header / mobile-tabbar)
//    完全一致:`viewBox="0 0 24 24"` / `fill="none"` / `stroke="currentColor"` /
//    `stroke-width="1.6"` / `stroke-linecap="round"` / 顯示 18×18。
//    🔴 幾何字元的問題不是「不好看」而是**每個字元的字體覆蓋率與基線都不同** ——
//    `◈` `▸` 這種在部分系統字體裡沒有、會 fallback 到別支字體或顯示成豆腐,
//    而且七顆的視覺大小完全不一致(`♡` 明顯比 `□` 大一圈)。
//    path 字面逐字搬自設計稿 `account-page.html` 的 NAV 陣列(grep `const NAV =`;不引行號)
//    —— **`vehicles` 那一筆除外**,見下方 Q2=A 申報。`vehicles` 與 tabbar「找車」
//    是**同一支** path(刻意的,不要各畫各的)。
//    🔴 查證更正(2026-08-07):原註解另外宣稱 `profile` 與 header 會員鈕也是同一支——
//    實查是假的,兩邊 circle cy(7 vs 8)與身體弧線公式(header 用弧線 arc、這裡用三次貝茲)
//    從來就不同,只是視覺上都是「頭圓+肩弧」看起來像。未強制對齊(不在本次 Q2=A 範圍),
//    對應測試已把「同一支」的錯誤宣稱改成純字面鎖定,不再假稱跨檔同支。
//    ⚠️ **R2 補**:這條的病根與 `vehicles` **完全同形** —— OD 交接單 icon 表的同一行,
//    文字同時宣稱「vehicles=機車、與 tabbar 同一支」與「profile=人像、與 header 同一支」,
//    而 OD 自己的落地稿兩處都對不上。⇒ **兩條一起進 OD 回饋包**,不只報 vehicles 那條。
//    ⚠️ 另外:「會員/個人資料」這顆人像 icon 全站有**三種**不同字面(header 會員鈕 / 本檔 profile /
//    MobileTabBar「會員」),要不要統一不在本次射程,已列回饋包供 Sean 裁。
//
// 🔴 2026-08-07 Sean 拍板 Q2=A(**對 OD 稿的偏離,申報如下**):
//    機車零件站的選車/愛車圖示統一用重機;`vehicles` 的 path 改複用 MobileTabBar「找車」那支
//    (不自畫新 icon)。三處同批換:本檔 + `CascadeFilterTop.tsx` + `GarageChips.tsx`。
//    ⚠️ **OD 稿的該顆 SVG 畫的是汽車** ⇒ 這是 Sean 口頭覆蓋設計稿,**已列 OD 回饋包請 OD 同步**。
//    ⚠️ 但 OD 交接單 `account-page-handoff.md` 的 icon 表**文字寫的是「vehicles=機車、與 tabbar
//    『找車』同一支」**(grep `vehicles`)—— 也就是 OD 自己的文字說明與落地 SVG 互相矛盾,
//    Sean 的口頭與那份文字說明其實同向。回饋包一併把這條矛盾回報給 OD。


export type AccountViewProps = {
  /**
   * 首屏要亮哪一個分頁 —— 由 server 端從 `?tab=` 解出來(`app/account/page.tsx`)。
   * 🔴 **在 server 解、不在 client 解**:client 解的話首屏會先畫總覽再跳,客人看得到那一下。
   *    (`cf` 規格 §3 把「首屏閃動」列為未量 —— 我選了不會閃的那一邊,而不是量它。)
   * ⚠️ **不合法的值在 server 被丟成 `undefined`**(`page.tsx` 的 `tabFromSearchParams`),
 *    而收斂成 `'overview'` 的是**下面那個預設參數**,不是 server。
 *    🔴 所以這個 prop 的值域是【七個之一 or `undefined`】——**不是「一定是七個之一」**。
 *    (code-reviewer 2026-08-27 訂正我原本那句;`page.test.tsx` 有兩格正是斷言 `undefined`。)
   */
  initialTab?: AccountTabId;
  user: AccountUser;
  stats: AccountStats;
  /**
   * 儲值金明細(#202 解凍第一片)。**server 已排好序(新到舊)**,本層只 forward。
   * 🔴 `walletEntriesFailed` 與 `walletEntries: []` 是兩件事 —— 前者「讀不到」、後者「真的沒交易」。
   *    合成一種 ⇒ 讀取壞掉時畫面會對客人說「尚無交易紀錄」。
   */
  walletEntries: readonly WalletLedgerEntry[];
  walletEntriesFailed: boolean;
  /** 明細總筆數(`null` = 沒拿到)。🔴 沒有它,「N 筆」會是這一頁的筆數假扮成總筆數。 */
  walletEntryTotal: number | null;
  /** 🔴 餘額沒讀到 —— 與 `walletBalance === 0` 是兩件事。 */
  walletBalanceFailed: boolean;
  featured: FeaturedResult;
  profile: AccountProfile;
  // g-5a:收件地址清單(page.tsx getAddressRepo→listByCustomer 算好傳入;forward 給 AddressTab 唯讀渲染)
  addresses: CustomerAddress[];
  // g-6a:愛車清單(page.tsx getVehicleRepo→listByCustomer 算好傳入;forward 給 VehiclesTab 唯讀渲染)
  vehicles: CustomerVehicle[];
  /** V-1c++:車型字典(page.tsx fetchVehicleTaxonomy 直傳;forward 給 VehiclesTab 雙下拉) */
  vehicleBrands?: MockMotoBrand[];
  // M-3:訂單摘要清單(page.tsx getOrderRepo→listSummariesByCustomer 算好傳入;forward 給 OrdersTab 全列 +
  // OverviewTab 最近訂單 slice(0,2)。orderCount 與此同源、Q5=A 一致)
  orders: OrderListItem[];
  // M-4b #191:收藏清單(page.tsx getFavoritesRepo→listByCustomer 算好傳入;forward 給 FavoritesTab)
  favorites: FavoriteListItem[];
  /** 🔴 讀取失敗(≠ 沒有收藏)。兩者必須印不同的畫面 —— `MAIN-035 ①-1`。 */
  favoritesFailed?: boolean;
};

export function AccountView({ initialTab = 'overview', user, stats, featured, profile, addresses, vehicles, vehicleBrands, orders, favorites, favoritesFailed, walletEntries, walletEntriesFailed, walletEntryTotal, walletBalanceFailed }: AccountViewProps) {
  const [tab, setTab] = useState<AccountTabId>(initialTab);

  /**
   * 🔴🔴 **回退時把 `?tab=` 讀回來(code-reviewer 2026-08-27 must-fix,而它是真瀏覽器量到的)。**
   *
   *    我原本只在 server 讀一次當初值 ⇒ **客人真正會走的那條路是壞的**:
   *    ```
   *    無參數進 /account(server 給 undefined ⇒ 總覽)
   *      → 點側欄「訂單記錄」(client setState + replaceState ⇒ 網址變 ?tab=orders)
   *      → 點進明細(client 導覽)
   *      → 瀏覽器上一頁
   *    ⇒ 實測:網址是 /account?tab=orders,而【畫面亮總覽】
   *    ```
   *    成因:回退走的是 **router cache 裡那份 payload**,而那份是「無參數」那次 server render
   *    的結果 ⇒ `initialTab` 仍是 `undefined`,元件不 remount、`useState` 初值不重讀。
   *    🔴 **而我第一次量的世界 C 是【先 server render 過 `?tab=orders`】的那條** ——
   *       兩條路在畫面上長得一樣,而只有一條是客人真的會走的。
   *       📌 **我量到「C 修好了」,而我量的是另一個 C。**
   *
   * ⇒ 修法照 Next 官方那條(`node_modules/next/dist/docs/01-app/01-getting-started/
   *   04-linking-and-navigating.md:345-365`):**`?tab=` 是真相,不是只當初值。**
   * ⚠️ 而這也順帶修掉 code-reviewer nit 11 那個「網址說謊」——
   *    頁首 / 底部的會員鈕 `push('/account')` 之後,這裡會把 tab 拉回總覽。
   */
  const searchParams = useSearchParams();
  const tabFromUrl = searchParams.get('tab');
  useEffect(() => {
    // 🔴 不合法或缺席 ⇒ 收斂成總覽(Sean 2026-08-27 Q1 拍甲:安靜,不報錯)。
    const next = ACCOUNT_TAB_IDS.includes(tabFromUrl as AccountTabId)
      ? (tabFromUrl as AccountTabId)
      : 'overview';
    setTab(next);
  }, [tabFromUrl]);

  /**
   * 切分頁時把 `?tab=` 寫回網址(Sean 2026-08-27 `Q2` 拍甲 = 要跟著變)。
   *
   * 🔴 **這不是偏好,它決定修得完不完整**:只讀不寫的話,客人從明細按【瀏覽器上一頁】
   *    仍會落在總覽 —— 因為那一筆歷史紀錄的網址是 `/account`(沒有參數)。
   *    ⇒ `cf` probe 的「世界 C」要修好,這一段是必要條件。
   * 🔴 **用 `replaceState` 不用 `pushState`**:每點一次分頁就多一筆歷史,客人要按七次上一頁
   *    才離得開會員中心。`replaceState` 只改當前那一筆 ⇒ 上一頁回來時讀得到,而歷史不變長。
   * ⚠️ **不走 `router.replace`** —— 🔴 **而這是【推論】不是我量到的**(code-reviewer 訂正):
   *    我量到的只有「`replaceState` 這樣寫,三個世界都對」。「`router.replace` 會多一次
   *    server round-trip」我**沒有量過**。要改用它之前先量,不要引用這一句當理由。
   * 📎 官方對「改 query 而不重取」的示範:`node_modules/next/dist/docs/01-app/
   *    01-getting-started/04-linking-and-navigating.md:345-365`(從 `useSearchParams` 帶著走)。
   */
  /**
   * ⚠️ **一個【改動前就有、而改動後開始說謊】的行為**(code-reviewer 2026-08-27 nit,我沒修):
   *    停在 `/account?tab=wallet` 時點頁首 / 底部的「會員」鈕 ⇒ `push('/account')`,
   *    而 `AccountView` **不 remount** ⇒ `useState(initialTab)` 不重讀
   *    ⇒ **網址變回 `/account`,而畫面停在儲值金。**
   * 🔴 改動前也是這個行為(非回歸)—— 而**改動前網址從來不說話,現在它會說錯話**。
   *    ⇒ 要修得靠 `useEffect` 跟著 `searchParams` 走,而那會把「網址是唯一真相」這個
   *      更大的決定提前 ⇒ ~~**不在本片射程**(Sean 拍的是「只修回不來」)。**標明,未修。**~~
   * 🔴🔴 **2026-08-27 訂正(主視窗,線1 停工後):上面這一整段【已經不成立】——**
   *    `:171-177` 那個 `useEffect(…, [tabFromUrl])` **就是**它說「要修得靠」的那個東西,
   *    而它已經在這支檔裡了 ⇒ 點會員鈕 `push('/account')` ⇒ `tabFromUrl` 變 `null`
   *    ⇒ `next = 'overview'` ⇒ `setTab('overview')` ⇒ **網址與畫面一致,那個 nit 已修。**
   *    ✅ 而 `:166-167` 那一段自己也寫著「順帶修掉 code-reviewer nit 11」⇒ **同一支檔裡兩段話相反。**
   * 📌 **⇒ 而這正是同日剛立的那條**(`docs/patterns/guard-and-instrument-traps.md`
   *    「局部修正會【提高】未修正部分的可信度」的 2026-08-27 擴充):
   *    **訂正的人是最不可能再去看另一段的人 —— 他剛剛才逐字讀完他改的那一段。**
   *    ⇒ 舊句照 repo 慣例劃線保留,不靜靜刪掉。
   */
  const selectTab = (next: AccountTabId) => {
    setTab(next);
    if (typeof window === 'undefined') return;
    // 🔴 **帶著其他 query 一起走,不要整串重寫**(code-reviewer 2026-08-27 nit):
    //    原版寫死 `/account?tab=x` ⇒ 哪天有 `?from=email` / `?next=`,**點一下分頁就沒了**,
    //    而畫面看起來完全正常。用 `URLSearchParams` 只動 `tab` 這一個鍵。
    const params = new URLSearchParams(window.location.search);
    if (next === 'overview') params.delete('tab');
    else params.set('tab', next);
    const qs = params.toString();
    window.history.replaceState(null, '', qs ? `/account?${qs}` : '/account');
  };

  // g-4a Q4=A:displayName / avatarChar 用 profile.name(customers.name SoT)為主、displayEmail 退化、
  // 'PCM 會員' 最終 fallback(防 LINE 合成 email 洩 H1 / avatar;page.tsx 已把 user.name 設為同值)
  const displayName = profile.name || user.displayEmail || 'PCM 會員';
  const avatarChar = (profile.name || user.displayEmail || 'P').charAt(0).toUpperCase();

  // overview 內「最近訂單」「儲值金」CTA 跳 tab(對齊 design L488/L501 setTab 行為)
  const jumpToOrders = () => selectTab('orders');
  const jumpToWallet = () => selectTab('wallet');

  return (
    <div data-screen-label="Account" className="ap-page">
      <Header currentPage="account" />
      <main className="acc-main">
        <div className="acc-head">
          <div className="acc-avatar">{avatarChar}</div>
          <div>
            <div className="ap-mono">會員中心</div>
            <h1>Hi, {displayName}</h1>
            {user.displayEmail && <div className="acc-email">{user.displayEmail}</div>}
          </div>
          <div className="acc-head-actions">
            <form action={logoutAction}>
              <button type="submit" className="acc-logout">登出</button>
            </form>
          </div>
        </div>

        <div className="acc-layout">
          <aside className="acc-nav">
            {NAV.map((t) => (
              <button
                key={t.id}
                className={tab === t.id ? 'is-active' : ''}
                onClick={() => selectTab(t.id)}
              >
                {/* 🔶 R1 9-2:`dangerouslySetInnerHTML` 用在**本檔內寫死的常數**上,
                    沒有任何使用者輸入路徑(`NAV` 是 `as const`、不從 props / DB 來)。
                    這是為了不用把七顆 icon 各拆成一個元件;`aria-hidden` 因為旁邊
                    `.acc-nav-label` 已經有文字,圖示對讀屏是純裝飾。 */}
                <span className="acc-nav-icon" aria-hidden="true">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    dangerouslySetInnerHTML={{ __html: t.path }}
                  />
                </span>
                <span>{t.label}</span>
              </button>
            ))}
          </aside>

          <div className="acc-body">
            {tab === 'overview' && (
              <OverviewTab
                stats={stats}
                balanceFailed={walletBalanceFailed}
                featured={featured}
                recentOrders={orders.slice(0, 2)}
                onJumpToOrders={jumpToOrders}
                onJumpToWallet={jumpToWallet}
              />
            )}
            {tab === 'orders' && <OrdersTab orders={orders} />}
            {tab === 'wallet' && (
              <WalletTab
                balance={stats.walletBalance}
                entries={walletEntries}
                loadFailed={walletEntriesFailed}
                total={walletEntryTotal}
                balanceFailed={walletBalanceFailed}
              />
            )}
            {tab === 'favorites' && <FavoritesTab favorites={favorites} loadFailed={favoritesFailed} />}
            {tab === 'vehicles' && <VehiclesTab vehicles={vehicles} vehicleBrands={vehicleBrands} />}
            {tab === 'address' && <AddressTab addresses={addresses} defaultName={profile.name} />}
            {tab === 'profile' && <ProfileTab profile={profile} email={user.displayEmail} />}
          </div>
        </div>
      </main>
      <HomeFooter />
    </div>
  );
}
