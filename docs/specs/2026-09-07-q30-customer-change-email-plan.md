# Q30 乙 · 讓客人改 Email —— plan(鐵則 8,只寫 plan 不動碼)

> **這一份是 plan,不是實作。** 依鐵則 8:跨 3+ 檔 / 動共用元件 / 影響資料 ⇒ 先提 plan 等 Sean 批。
>
> **來源**:Sean **2026-09-06 23:55 答 `Q30 乙`** —— 逐字派工是
> 「派 account 寫 plan(**改 email 流程 + 驗證信 + 通知收件人規則**,鐵則 8)」
> (艦隊表 `現在誰在做什麼-20260906.md:401`)。線【信】`-mail` 的 `⟦f3-RECIPIENTBIND1⟧`
> 核查需求併進本 plan(同檔 `:478-479`,主視窗 B 2026-09-07 00:43 轉)。
>
> **作者**:線【帳號】`account`,2026-09-07 03:5x。**尚未經任何審查。**

---

## 0. 一句話

今天客人**改不了**自己的 Email(帳號頁那一格是 `disabled`),而**正因為改不了**,
好幾個「信會寄到舊地址」的缺口今天是閉著的。
⇒ 📌 **這一片的本體不是「加一個輸入框」,是【把那些缺口先關起來】。**

---

## 1. 今天的事實(全部量過,附座標)

### 1.1 有三個「Email」,而它們是三個不同的東西

| 是什麼 | 住哪 | 今天會不會變 |
|---|---|---|
| **登入用的** | `auth.users.email`(Supabase Auth) | **會** —— 客人在 Supabase 那邊改得動 |
| **客戶資料上的** | `customers.email` | ❌ **不會** —— 註冊那一刻寫進去之後,**沒有任何一條路會更新它** |
| **那一張單要寄去哪** | `orders.notification_email` | ❌ **不會** —— TS 全樹**零**更新路徑 |

🔬 座標(`⟦b4-RECIPLIVEVALUE⟧` 板列已量,本 plan 未重量,**標明繼承**):
· `customers.email` 唯一寫入點 = `handle_new_auth_user()` 掛 `AFTER INSERT ON auth.users`
  (`20260523034911_init_customers_and_subtables.sql:293`)—— **只有 INSERT**
· `customers` 上的 trigger 恰 1 支(`customers_set_updated_at`,`BEFORE UPDATE`,同檔 `:262-263`)
· 應用碼唯一的 `.update()` 在 `SupabaseCustomerAdapter.ts:269`,
  簽名 `Partial<Pick<Customer, name / phone / birthday / gender>>` ⇒ **`email` 不在裡面**
· 該檔 `:207` 逐字「update patch 只寫 name / phone / birthday」,`:208` 記著 DB GRANT 是
  `UPDATE (name, phone, birthday, updated_at)` ⇒ **連授權都沒有**

### 1.2 帳號頁那一格今天是鎖的(本 plan 當場核)

`apps/storefront/src/components/account/tabs/ProfileTab.tsx` —— Email 那個 `<input>` 帶 **`disabled`**,
LINE 客人另給 placeholder「LINE 帳號登入,無 Email」。

### 1.3 寄信時「收件人」與「內容」是**兩個時點**

· **收件人凍結在排信那一刻**(寫進 `email_outbox` 那一列的 `recipient_email`)
· **內容在寄送當下重讀**(`loadPaidContext` / `loadShippedContext` / `isBankOrderStillMailable`,
  每一發都鍵在 `job.orderId`)
🔴 **而只有匯款單那一種會因為不同步而拒寄** ——
`packages/use-cases/src/sweep-email-outbox.ts:1665` 逐字
`job.recipientEmail !== mailable.currentRecipientEmail`,任一不同就標終態不寄。
🛑 **付款信 / 出貨信 / 更正單號信【沒有這道比對】**(全檔 `recipientEmail` 只出現在
`:1665` 與 `:1902` 兩處 —— 本 plan 當場 grep 複核)。

### 1.4 🔴🔴 所以真正的因果是這一句

> **今天信不會寄錯,不是因為我們擋住了,是因為【那個值不會變】。**
> ⇒ **Q30 乙一落地,那個值就開始會變** ⇒ 1.3 那三種信立刻變成活的洩漏路徑,
> ⇒ 而**沒有任何東西會叫**。

---

## 2. 要改什麼(三片,順序是硬的)

### 🔴 片 1 ·【擋門】把新鮮度比對擴到三種信 —— **必須先上**

**改哪**:`packages/use-cases/src/sweep-email-outbox.ts`
**改成**:`order_paid` / `order_shipped` / `shipment_tracking_corrected` 三種 job 在寄送前,
把 `job.recipientEmail` 與**現在的**收件人比一次;不同 ⇒ **不寄**、標自己的終態碼。

🔵 **形狀照抄匯款單那一道**(`:1665`),理由逐字沿用它自己的註解:
「**不寄,而不是【用新值寄】**」—— 用新值寄等於在寄送當下重算一封信的內容,
而那封信的字面是 Sean 逐字核可、由整串 `toBe` 鎖著的。

🛑 **而它繼承匯款單那道的已知缺口,要明寫**:
標了終態之後那張單**再也排不進來**(pending view 的 anti-join 是 status-agnostic、
鍵在 `order_id + event_type`)⇒ **改 `dedup_key` 救不了**。
⇒ 📌 **所以片 1 的驗收要含「被擋下來的那封,誰去補寄」** —— 這是 Sean 要決定的(見 §4 Q-A)。

**為什麼它必須排第一**:反過來的話,片 3 上線到片 1 上線之間,
**每一封付款信與出貨信都可能寄到舊地址**,而沒有東西會叫。

### 片 2 ·【同步】`auth.users.email` 改了 ⇒ `customers.email` 跟著改

**改哪**:一支新 migration —— `handle_new_auth_user()` 旁邊補一個
`AFTER UPDATE OF email ON auth.users` 的 trigger,把新值寫進 `customers.email`。

🔴 **兩個必須先答的**(§4 Q-B):
① Supabase 的 email 變更是**兩段式**(舊信箱與新信箱各收一封確認信),
   `auth.users.email` 要**兩邊都確認完**才變 ⇒ 同步點取「它真的變了」那一刻是對的。
② `email_change` 這個 type 在 `SupabaseAuthAdapter.ts:107` 的註解裡**已經被提到**,
   ⇒ **重寄確認信那條路已經存在**,不必新造。

### 片 3 ·【UI】帳號頁那一格解鎖 + 驗證信

**改哪**:`ProfileTab.tsx`(拿掉 `disabled`、加一顆「改 Email」)+ 一支 server action 走
`supabase.auth.updateUser({ email })`。
🔴 **LINE 客人這條要另外想**:他們的 `email` 是合成假信箱、頁面上顯示 `''`
⇒ 對他們「改 Email」的語意是【第一次設定】不是【更改】(§4 Q-C)。

---

## 3. 通知收件人規則(Sean 點名要的那一項)

**今天的規則不動**(`resolve-notification-recipient.ts` 檔頭,Sean 2026-08-18 `Q-W5-3` 甲):
① 結帳頁客人自己填的 → ② session `user.email` → ③ 收件地址的 email。

🔴 **本片只加一條,而它是【時點】那一條**:

> **每一張單的 `orders.notification_email` 是那一張單的合約 —— 改 Email【不回頭改舊單】。**

**為什麼**:
· 那個欄位就是「這張單當時說要寄去哪」;回頭改它 = 改一份已成立的紀錄
· 而**新的信要寄到新地址** —— 那由片 1 的比對達成:舊快照與現值不同 ⇒ 不寄舊的 ⇒ 重排一封新的
⚠️ **代價要明寫**:客人改了 Email 之後,**舊單的信不會自己重寄到新地址**;
  他要的話得請客服。這一格要不要做,是 §4 Q-A 的一部分。

---

## 4. 要 Sean 拍板的(三題,選項互斥、每題 2 個)

```
Q-A:片 1 把一封信擋下來之後(收件人變了 ⇒ 舊快照那封不寄), 那封信怎麼辦?
A: 甲 = 自動重排一封新的寄到新地址(要多做「重排」那一段, 而它會碰 pending view 的 anti-join)
   乙 = 就不寄了, 後台看得到「因為改了信箱而沒寄出」的清單, 客服手動處理

Q-B:客人改 Email 的時候, 舊信箱要不要也收一封通知?
A: 甲 = 要(舊信箱收「你的帳號 Email 被改成 X」)—— 帳號被盜時舊信箱主人會發現
   乙 = 不要, 只有新信箱收確認信 —— 少一封信, 而帳號被盜就沒有人會知道

Q-C:LINE 登入的客人, 帳號頁那一格要長怎樣?
A: 甲 = 給他一個「設定 Email」(他本來沒有真信箱, 設了之後通知信才寄得到他)
   乙 = 這一片先不做 LINE 客人, 那一格維持現在的「LINE 帳號登入, 無 Email」
```

---

## 5. 影響面與 rollback(鐵則 8 要求)

**碰到的檔**(預估;片 1 / 2 / 3 分別 commit)
· 片 1:`packages/use-cases/src/sweep-email-outbox.ts` + 它的測試 + port 型別(要多回一個現值)
· 片 2:一支新 migration(`auth.users` 的 AFTER UPDATE trigger)
· 片 3:`ProfileTab.tsx` + 一支 server action + `SupabaseAuthAdapter`

**rollback**
· 片 1 = 純 TS,revert 那顆即可(而 revert 之後那三種信又回到「不比對」)
· 片 2 = migration,附 `DROP TRIGGER` 還原檔;**不動任何既有列**
· 片 3 = 純前端 + action,revert 那顆 ⇒ 那一格變回 `disabled`

**鐵則 12**:片 2 動 schema、片 3 動 auth ⇒ **兩片都要 codex 對抗審查,不降級**。
片 1 動的是「錢的信會不會寄出去」⇒ 一併算高風險。

---

## 6. 這份 plan 沒做什麼(照實寫)

· **一行碼都沒動。**
· §1.1 的座標**繼承自 `⟦b4-RECIPLIVEVALUE⟧` 板列**(`-15` 量、`-f3` 複驗),
  本 plan **只當場複核了兩件**:`sweep-email-outbox.ts` 的 `recipientEmail` 只有兩處、
  `ProfileTab.tsx` 的 Email input 帶 `disabled`。其餘未重量。
· **沒有跑過任何一條真實寄信路徑。**
· Supabase Auth 的 email 變更流程細節(兩段式確認的確切行為)**未查官方文件** ⇒ 片 2 動工前要查。
· 正式庫上「有幾個客人的 `auth.users.email` 與 `customers.email` 已經不一樣」**未量** ——
  📌 **那個數字決定片 2 上線當天會同步幾筆**,動工前要用唯讀跑一次。

---

> 🔴 **[2026-09-07 22:5x `-auth` 唯讀量測 —— 兩句, 給要做這一片的人]**
> **① 板上【查無對應的實作列】, 而顧客站今天【連入口都沒有】** ——
>    `apps/storefront/src/app/account/profile/actions.ts` 收的欄只有 `phone` / `birthday` / `gender`。
>    (標題含「改 Email / 改信箱」的板列 ⇒ **0**;🟢 正對照 標題含「取消」⇒ **30** · ⚪ 負對照 ⇒ **0**。)
> **② 🔴 而【客服也改不了】—— 後台那支對映 `packages/adapters/src/supabase/mappers/customer.ts:161-173`
>    型別上就寫死那四欄(name / phone / birthday / gender)。**
>    🛑 **⇒ 讀這份 plan 的人會預設「在做完之前, 客服可以手動處理」—— 那個預設今天不成立,
>      而在本段之前它沒有寫在任何地方。**
> 📌 詳見板列 `⟦b4-RECIPLIVEVALUE⟧`(含四條路各自的尺與正負對照、以及射程外三項)。
