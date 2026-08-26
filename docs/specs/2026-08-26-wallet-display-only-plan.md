# Plan · 儲值金「只顯示」(`#202` 解凍第一片)—— **鐵則 8,等批;零 code**

> 產出者:施工窗 `pcm-website-v2-1d`(線 4),2026-08-26。派工 = 主視窗 `pcm-website-v2-96`。
> 上游盤點 = [2026-08-26-wallet-unfreeze-recon.md](2026-08-26-wallet-unfreeze-recon.md)(本檔不重複它)。
>
> 🔴 **本檔零 code、零 schema、零設計。它是一份要被批准的 plan,不是動工許可。**

---

## §0 Sean 的話(逐字,不重打)

> 「**甲 只顯示餘額和明細**」
> 「**法規我確定了,解凍,但是之後再做,現在先顯示就好**」
> 「**等網站上線後再補**」

🔴 **而 `#202` 的 hold 解除,依據【未載明】** —— 他沒說是怎麼確定的。
⇒ 本 plan 一律寫「**Sean 拍板解凍**」。
⇒ 🔴 **不得寫「已合規」「法規已釐清」** —— 那兩句我們沒有證據,
   而**一個關於法規的宣稱寫錯了,下一個人不會回頭查**。

---

## §1 🔴 先講一件會改變這一片大小的事:**餘額那半已經在跑了**

我開檔查的,不是讀文件:
```
apps/storefront/src/app/account/page.tsx:66  逐字
  .select('name, phone, birthday, tier, wallet_balance')
:90  逐字   walletBalance = customerRow.wallet_balance;
:165 逐字   stats={{ tier, walletBalance, orderCount: orders.length }}
AccountView.tsx:57 逐字
  export type AccountStats = { tier: MemberTier; walletBalance: number; orderCount: number };
量法 grep -rl 'walletBalance' apps/storefront/src ⇒ 7 支 · 負對照 'walletZzzBalance' ⇒ 0
```
⇒ 🔴 **「顯示餘額」需要的資料【已經送到畫面上了】,而且已經給 OverviewTab 用了。**
⇒ **所以這一片真正缺的只有兩樣**:
```
① 明細(ledger)的讀取 —— 現在【零】, 沒有任何一條路撈 customer_wallet_ledger
② WalletTab 本身 —— 現在是 11 行的 stub
   WalletTab.tsx 全文只有「儲值金服務尚未開放。」一句
```

---

## §2 資料怎麼來 —— **這一格是安全的核心,而它是結構性的不是檢查性的**

主視窗指示逐字:「跨會員讀取要走 server 端重新檢查身分,**不信任 client 送的 member id**」。
✅ **這一條在本片【天生成立】,而理由比「我們會檢查」更強:客人的 id 從來沒有經過 client。**

```
① 頁面守門  account/page.tsx:10-11 逐字
   「用 getUser()(向 auth server 驗 JWT、非可偽造的 getSession)→ 無 user 就 redirect('/login')」
② RLS 守門  20260523034911_init_customers_and_subtables.sql:209-211 逐字
   CREATE POLICY wallet_select_own ON customer_wallet_ledger
     FOR SELECT TO authenticated
     USING (auth.uid() = customer_user_id);
```
⇒ **客人是誰由 `auth.uid()` 決定(來自已驗證的 JWT),不是任何一個傳進來的參數。**
⇒ **就算有人傳一個別人的 id,SQL 撈不到那些列。**

### 🔴 2-a 而這一片有【一個】會把上面整段作廢的做法,寫在這裡當禁令
```
🔴 不得使用 SupabaseWalletAdapter。
   理由(不是我判的, 是檔案自己寫的):
   account/page.tsx:18-19 逐字
     「不繞 SupabaseWalletAdapter(後者強制 service_role writeClient ctor、
       storefront 不允許注入 service_role)」
   ⇒ service_role 是 BYPASSRLS ⇒ 一旦注進 storefront, §2 那兩道守門【同時失效】
   ⇒ 而畫面看起來一模一樣。
⇒ ✅ 正解:沿用本頁既有的 createServerSupabaseClient 直查 ledger(與 :66 那一發同一個 client)。
```
**量到的現況**:`grep -rl 'SupabaseWalletAdapter' apps/storefront/src` ⇒ **2 支,而兩支都是【寫著「不要用它」的註解】**,零實際使用(負對照 `SupabaseZzzWalletAdapter` ⇒ 0)。
📌 **那個 2 又是「數到宣告不做的註解」** —— 與盤點 §3-a 同一個坑,這裡標出來免得下一個人誤讀。

---

## §3 design 怎麼畫的 —— **鐵則 1:我開了檔,沒憑記憶**

`design-reference/components/WalletTab.jsx`(**231 行**)。它畫了**四塊**:
```
① 餘額卡  .wal-balance-card  ── CURRENT BALANCE + NT$ 數字 + 「可用於下單折抵 · 永久有效」
                              + 【立即儲值】鈕 + 【查看交易紀錄】鈕
② 等級卡  .wal-tier-card     ── TierBadge / TierUpgradePath /「進階會員由 PCM 後台手動設定」
③ 交易紀錄 .wal-tx-section    ── 每列:日期 · 說明 · ±金額 · 【餘額】
④ 儲值 Modal DepositModal    ── 金額預設鈕 / 自訂 / TapPay 或 ATM / 確認儲值
```

### 🔴 3-a **而 Sean 的「只顯示」與 design 直接衝突,三處。我不自己裁。**

```
衝突一 ✅ **已答**(Sean 2026-08-26 `q5=乙`)
       ①的【立即儲值】鈕 + ④整個 DepositModal ⇒ 這一片【不做】(他說「之後再補」)
       ⇒ 而餘額卡右半邊那個洞 ⇒ 🔴 **放一句灰字提示(例:儲值功能即將開放), 不留白。**
       ⚠️ **那句話怎麼寫是他的品味題, 本檔不寫死** —— 只定「要有一句灰字」這個形狀。
       ⚠️ 而 recon §-1 記著他說「等網站上線後再補」⇒ **灰字不得承諾時程**
          (現行 stub 逐字是「儲值金服務尚未開放。」, 而 WalletTab.tsx:2-3 註解自己寫著
           「不寫『即將推出』(法規 hold、未承諾時程)」)
       ⇒ 🔴 **那條舊註解的理由【已經不成立】了**(法規那格 Sean 拍了解凍)——
          但「不承諾時程」這件事**仍然成立**, 理由換成他自己說的「之後再補 / 上線後再補」。
          ⇒ **端文案給他時要附這一句, 不要讓他以為可以寫「即將推出」。**
衝突二 ②等級卡在不在這一片
       ⇒ design 的分頁標題逐字是「**儲值金 · 會員等級**」= 這個分頁本來就是兩件事
       ⇒ 而 Sean 說的是「只顯示餘額和明細」—— **他有沒有把等級卡算進去, 我不知道**
衝突三 ⬇️ **已改判:這一格【不是設計題,是 bug 題】** —— 主視窗 `-96` 2026-08-26 裁,見 §3-b。
       🔴 ③每一列右下角的【餘額 NT$ X】—— **我們的資料表算不出來**
       design WalletTab.jsx 逐字   <div className="wal-tx-bal">餘額 NT$ {tx.balance...}</div>
       而 migration :100-107 的欄只有  entry_date · entry_type · amount(signed) · note · related_order_id
       ⇒ **沒有「當時餘額」這一欄** ⇒ 要嘛前端累加算, 要嘛不顯示那一行
       ⇒ 🔴 而【累加算】有一個坑:它要從第一筆開始加, 而列表是分頁的
         ⇒ **翻到第二頁時, 那一欄算出來的數字會是錯的, 而它看起來完全正常。**
```

### 🔴🔴 3-b **禁令:不得用前端累加算「當時餘額」**

主視窗 `-96` 2026-08-26 裁,逐字:
> 「分頁的餘額欄要從第一筆累加,而列表分頁 ⇒ 第二頁會靜默算錯」—— **這格不是設計題,是 bug 題。**
> **不得用前端累加**,要嘛後端給 running balance,要嘛不顯示那一欄。

```
🔴 禁止  前端拿當頁的幾筆 amount 累加出「當時餘額」
   為什麼:累加要從【第一筆】開始, 而畫面上只有【當頁】那幾筆
   ⇒ 第一頁碰巧會對(它就是從第一筆開始的)⇒ 🔴 **測試與肉眼驗都會過**
   ⇒ 第二頁起全錯, 而錯出來的仍然是一個格式正確、遞增合理的金額
   ⇒ **沒有任何一格會紅。** 這正是「錯的那次和對的那次長得一樣」

✅ 只有兩條路, 二選一, 由 Sean / Design 定要不要顯示那一欄:
   (甲) 後端算 running balance —— SQL 視窗函式 SUM(amount) OVER (... ORDER BY ...)
        ⚠️ 它要對【該客人的全部列】排序後累加, 不是對當頁
        ⚠️ 而排序要帶唯一鍵(docs/patterns/pagination-loop-review.md 第五條)——
           entry_date 是 date 不是 timestamp, 同一天多筆會漂
   (乙) 不顯示那一欄 —— 與 design 有差, 而【差在哪要寫進交件, 不是默默拿掉】
```
⚠️ **而我沒有實作也沒有量過** —— 上面兩條是路,不是結論。**(甲) 的成本我沒估。**

⚠️ **`related_order_id` 那一欄 migration 註記 Phase 1 留 null** ⇒ 明細列上的「訂單 PCM-… 折抵」
**目前只能靠 `note` 的文字**,點不進訂單。design 也只顯示文字,**一致,不是缺口**。

---

## §4 這一片會動哪些檔 —— 🔴 **而它【不是我的檔案面】**

```
apps/storefront/src/components/account/tabs/WalletTab.tsx   stub → 真的畫面
apps/storefront/src/app/account/page.tsx                    加一發 ledger 查詢 + 傳 prop
apps/storefront/src/components/account/AccountView.tsx      forward 新 prop
(+ 對應 *.test.tsx)
```
```
我的面(佇列 §0 逐字)= apps/admin/src/app/customers/** · app/page.tsx
                      · components/dashboard/** · lib/dashboard/**
```
⇒ 🔴 **四支全部在 `apps/storefront`,一支都不在我的面上。**
⇒ **本 plan 可以由我寫(plan 不是動工),而實作要主視窗劃面。** 我不自己認領。

---

## §5 守門與紀律(開工那一片要遵守的,先寫死)

```
· 鐵則 3  前後台同步 ⇒ 後台那半【已經在跑】(Sean 07-16 拍的)⇒ 本片不需要補後台
· 鐵則 11 三綠 TURBO_FORCE=1;動 .tsx ⇒ 要加 build;測試連跑兩發比【檔數 / 測項數 / 紅的格數】
· 鐵則 12① 錢 ⇒ 🔴 **實作那一片 commit 前要跑 codex 對抗審查,由做那片的窗自己跑**
  ⚠️ 而【本檔這一顆 commit 是零 code 的 plan】⇒ 鐵則 12 講的是「高風險【改動】」
     ⇒ 我判本顆不觸發, 而**若主視窗要 plan 也過一輪, 說一聲我照跑**(§7 列成待確認)
· Server 端鐵則 金額用整數 ⇒ ✅ 天生成立:wallet_balance / ledger.amount 兩欄逐字都是 `integer`
  (migration :21 · :104)⇒ 全程整數, 不碰浮點
· 鐵則 9 分級 ⇒ **L1**(顯示既有資料, 沒有任何內容要維護)
```

---

## §6 🔴 順帶撈到的一格:**migration 的 COMMENT 與它自己的 schema 打架**

```
同一支檔 20260523034911_init_customers_and_subtables.sql
  :21  逐字  wallet_balance  integer NOT NULL DEFAULT 0,  -- Q1=B:trigger 同步、authenticated 不可直寫
  :119 逐字  「balance = SUM via customer_wallet_balance view、**不存欄位避免 drift**」
```
⇒ **`:119` 的 COMMENT 說不存欄位,而 `:21` 就是那個欄位。**
⇒ 🔴 **這不是本片要修的東西,而它會誤導下一個人**(COMMENT 是很多人查 schema 的第一站)。
⇒ **列出來給主視窗,不自己改** —— 改 migration 的 COMMENT 是動已 apply 的檔,不屬我可拍的板。

---

## §7 這份 plan 沒有定的(逐條)

```
7-1 ✅ **已答**(`q5=乙` 放灰字, 不留白)。**而那句灰字的【措辭】仍是他的品味題**,
    且 🔴 **不得承諾時程**(理由見 §3-a 衝突一)⇒ 端文案時要附那一句
7-2 🔴 等級卡(design ②)在不在「只顯示」的範圍內 —— **Sean 說的是「餘額和明細」**, 沒提等級
7-3 🔴 每一列的「當時餘額」**顯不顯示** —— Sean / Design 的題。
    ✅ **而「怎麼算」已經不是開放題了**:主視窗已裁【禁止前端累加】,見 §3-b,只剩甲/乙兩條路。
    ⚠️ 而**甲(後端 running balance)的成本我沒估**
7-4 ⚠️ 明細要不要分頁 / 一頁幾筆 —— 沒定。而它與 7-3 綁在一起
7-5 ⚠️ 本 plan 這一顆(零 code)要不要也跑 codex —— 我判不觸發, 等主視窗一句話
7-6 🔴 **我沒有量「現在有幾個客人的 wallet_balance 不是 0」** —— 沒有正式庫權限
    ⇒ 所以「做出來之後客人會看到什麼」我答不出來(**可能全部是 0, 而畫面就是那句「尚無交易紀錄」**)
    ⚠️ 而有一個【轉述且未確認】的鄰近數字:`2026-08-16-customer-filters-four-fields-plan.md:15`
       逐字「客戶總數 11、全部是自己測試用…⇒ 真實客戶 0」—— **那不是儲值金的數字**, 只是同一族的量級
7-7 我沒有逐行讀 design 的 CSS(`.wal-*` 那族在哪支 css、有沒有被 storefront 搬過)—— **沒查**
```

📎 上游 [盤點](2026-08-26-wallet-unfreeze-recon.md) · `docs/phase-1-backlog.md:5946`(`#202`)·
`design-reference/components/WalletTab.jsx`(231 行)·
`apps/storefront/src/app/account/page.tsx:10-11 / :18-19 / :66 / :90 / :165` ·
`supabase/migrations/20260523034911_init_customers_and_subtables.sql:21 / :100-107 / :119 / :209-211`
