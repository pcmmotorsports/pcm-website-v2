# 結帳頁收件地址 inline 化 + 「新增後不刷新」同源評估 · plan(等回核)

> 派工=`D-240-A` ②。Sean:填收件資料時 (a) 既有地址右側加「修改/刪除」、**當前頁面**直接改;
> (b) 底部入口改「新增收件人地址」、也在**當前頁面**新增。目的=不把客人帶離購物車、保住購買慾。
> 併評估 P 掃測 A 級「`/account` 新增後不刷新」(`P-205-STOP` ③)。

## §1 片型

| 項 | 判定 |
|---|---|
| 片型 | **標準片以上**(動結帳動線 + 表單 + 資料寫入路徑)|
| 內容分級 | L1 |
| 鐵則 8 | ✅ **命中**(跨 3+ 檔)⇒ 本檔即 plan |
| 鐵則 12 | ⚠️ **要你裁**:結帳頁 = 金流動線的一部分,但本片**不碰 order/payment/pricing**,只碰
`customer_addresses` 的既有 CRUD(不新增 mutation、不動 schema、不動金額)。我判**未命中**六類硬清單,
但「結帳頁」三個字容易讓人直覺歸類 ⇒ **列出來讓你裁**,不自評免審。 |

## §2 現況實查(全部主對話親自開檔)

| # | 事實 | 位置 |
|---|---|---|
| A | 結帳頁的地址區是**唯讀 radio 清單**,唯一出口是 `<Link href="/account">`「＋ 到會員中心新增 / 管理收件地址」——**點了就離開結帳** | `CheckoutStep1.tsx:45-67` |
| B | 結帳頁地址由 server 讀好傳 props(`force-dynamic`、`getAddressRepo().listByCustomer`、失敗退空陣列不 500)| `app/checkout/page.tsx:25,64-67` |
| C | 會員中心那套 CRUD **已經完整**:`addAddressAction` / `updateAddressAction` / `deleteAddressAction`,五道信任邊界(getUser / safeParse / use-case 用 user.id / RLS / DB CHECK)| `app/account/address/actions.ts:58,111,162` |
| D | 表單元件 `InlineAddressForm` **已經是可重用形狀**:`onSubmit` 由呼叫端注入(新增傳 add、編輯傳綁好 id 的 update)| `InlineAddressForm.tsx:40` |
| E | 三個 action **都沒有 `revalidatePath`/`revalidateTag`**;刷新一律靠呼叫端 `router.refresh()` | 同 C(grep 零命中)|

⇒ **結帳頁要的東西幾乎都有了**:action 可直接複用、表單元件本來就設計成可重用。
本片主要是「把會員中心那組 inline 表單搬到結帳頁掛起來」+ 結帳頁自己的狀態協調。

## §3 🔴 「新增後不刷新」:同源,但**根因我證不了**

### 3-1 P 掃測的原始症狀(`P-205-STOP` ③ 逐字)

> 填表存檔、彈窗關閉,清單仍顯示「尚未新增」;重新整理後資料確實在…
> **對照組:兩處的「刪除」動作都正常即時刷新,只有「新增」路徑漏。**

### 3-2 我查到的**結構差異**(這是事實,已驗)

| 路徑 | `startTransition` 在哪 | 之後做什麼 |
|---|---|---|
| **刪除**(正常)| **父層** `AddressTab.tsx:61`(不會被 unmount)| `router.refresh()`,元件續存 |
| **新增/編輯**(壞)| **子層** `InlineAddressForm.tsx:68`(表單自己)| `router.refresh(); onClose();` ⇒ `onClose` 讓父層 `setAddrEdit(null)`、**把發起 transition 的元件 unmount 掉** |

`VehiclesTab` / `InlineVehicleForm` 是**同一個形狀**(`InlineVehicleForm.tsx:150` 同樣是
`router.refresh(); onClose();`)⇒ 對得上 P 掃測「兩處同形狀復現」。

### 3-3 ⚠️ 但我**不宣稱**這就是根因

上表是**結構差異**,不是因果證明。要證成「unmount 取消了 refresh」需要真瀏覽器 + 真登入 + 真 DB,
而**本 worktree 沒有 env、跑不起登入流程** ⇒ 我做不到。

**可反駁的預測**(給有環境的人一分鐘內證偽/證實):
把 `InlineAddressForm` 的 `router.refresh()` 移到 `onClose()` **之後**、或改由父層在 `onSubmit`
回 ok 時自己 refresh(與刪除路徑同形)⇒ **若症狀消失,根因成立;若沒消失,我這條推論就是錯的**,
要改查別的方向(例如 RSC payload 快取、或 `useTransition` 與 router 的互動)。

### 3-4 建議:**同片解,但分兩個 commit**

- 本片會把 `InlineAddressForm` 掛到結帳頁 ⇒ **同一個 bug 會跟著複製到結帳頁**。不先解,
  等於在結帳動線上新種一個「存了但看不到」——那比在會員中心更傷(客人以為沒存成功、重填)。
- 但根因未證實 ⇒ **先出一個只動刷新時序的小 commit**、請 Sean 或 P 窗驗一次症狀是否消失,
  **確認了再做結帳頁那半**。否則我等於把一個沒驗過的修法直接鋪到金流動線上。

## §4 要改什麼(結帳頁那半;§3 確認後才動)

1. `CheckoutStep1.tsx`:地址卡右側加「修改 / 刪除」;底部 `<Link>` 換成「＋ 新增收件人地址」按鈕
   (**移除導頁**),點開 `InlineAddressForm`(新增模式)。
2. 掛載狀態:比照 `AddressTab` 的單一 `addrEdit` state(同時只開一個表單、天然互斥)。
3. 三個 action **原樣複用**、不新增 mutation、不動 schema。
4. 刷新:結帳頁是 `force-dynamic`,`router.refresh()` 會重跑 `page.tsx` 重讀 addresses
   —— 但要吃到 §3 的修法(否則同一個 bug 複製過來)。
5. 🔴 **刪除的邊界**:結帳頁刪掉的若是**當前選中**的那張地址,`shippingAddrId` 會指向不存在的 id
   ⇒ 要落回預設/第一張,或清空並擋下一步。**這是結帳頁獨有、會員中心沒有的格**,必須有守門。

## §5 影響面

- `CheckoutStep1.tsx`(結帳步驟一)、`CheckoutView`(狀態下傳)、可能 `checkout.css`(卡片右側動作區)
- `InlineAddressForm`(共用;若 §3 修時序,**會員中心那兩個分頁一起受影響**)
- **不動**:`charge-actions`、任何金額/訂單/付款路徑、`customer_addresses` schema

## §6 驗收(每條配只紅自己的突變;§3 確認後補完)

1. 結帳頁點「修改」⇒ 就地開表單、**不導頁**(突變:改回 `<Link>` ⇒ 只紅這條)
2. 存檔成功 ⇒ 清單即時更新(§3 那條的回歸格)
3. 🔴 刪除當前選中的地址 ⇒ `shippingAddrId` 不得指向已刪除的 id(結帳頁獨有格)
4. 新增成功 ⇒ 新地址出現在清單、且**不自動選中**(或自動選中——**這條要 Sean 拍**,見 §7)
5. 未登入 / action 失敗 ⇒ 錯誤就地顯示、不把客人踢出結帳
6. 會員中心那兩個分頁行為不回歸(共用元件改動的反向守門)

## §7 🔴 待拍板(兩題)

1. **鐵則 12 歸類**(§1):結帳頁但不碰錢,我判未命中、**列出來讓你裁**,不自評免審。
2. **新增地址後要不要自動選中它?** 客人在結帳頁按「新增」多半就是要用那張 ⇒ 我傾向**自動選中**;
   但那是產品決定(也可能他只是先建檔)⇒ 你或 Sean 拍。

## §8 Rollback

結帳頁那半:`git revert` 即回到「導去會員中心」的舊行為,零資料面。
§3 的刷新時序修法:單點改動、可獨立 revert。

— site-redesign 窗,2026-08-08
