# Plan:寄給客人的信統一成付款成功信的版型 + logo 連回官網 + 取消理由改客人用語

> 2026-09-12 · 施工窗 A(pcm-website-v2-5a)· 樹 `~/pcm-shop` 分支 `agent/shop-2`
> 起因:Sean 09-12 02:1x 看了四封信,逐字「兩個取消內容豐富度不一,這幾封 email 都要更有質感、資訊內容要一樣,比照付款成功通知那樣美觀,都要加上 https://www.pcmmotorsports.com/ 網址連結,或在 PCM logo 做超連結」。
> **本檔只是 plan,未改碼。** 寄信 = 鐵則 12 ⇒ 實作後二審。

## 0. 白話

- **現在**:7 種寄給客人的信,只有「付款成功」有漂亮的排版。另外 6 種都是純文字,而且有的有 LINE、有公司資訊,有的沒有。
- **改完**:7 封都用付款成功信那一套外框:最上面是 PCM logo(點了連到 https://www.pcmmotorsports.com/),然後是內容、「到會員中心查看訂單」按鈕、LINE、公司資訊頁尾。每封信的純文字版照舊一起送(收不到排版的信箱看純文字)。
- **取消理由**:員工在後台打的字不再原樣寄給客人。
- **錯了會怎樣**:最壞是某封信排版跑掉,內容還在(純文字那份照舊)。有一個上線當下的風險寫在第 6 節。
- **要 Sean 做的**:批這份 plan,加上回答第 7 節兩題。

## 1. 盤點:寄給客人的信(全部走同一條管線)

全部由一支 cron `apps/storefront/src/app/api/cron/email-sweep/route.ts` 排信、寄信,寄件商是 Resend(`packages/adapters/src/email/ResendEmailSenderAdapter.ts:99`)。主旨在 `packages/adapters/src/email/order-email-assembly.ts`,內文在 `packages/use-cases/src/sweep-email-outbox.ts`。

| # | 信 | 排信點 `email-sweep/route.ts` | 內文函式 | 格式 | logo | 會員中心連結 | LINE | 公司頁尾 | 金額 |
|---|---|---|---|---|---|---|---|---|---|
| ① | 付款成功(基準) | :502 | `paid-email-html.ts:288` + 純文字 `sweep-email-outbox.ts:666` | **HTML + 純文字** | 有,**沒連結** | 有(按鈕) | 有 | 有 | 完整明細 |
| ② | ATM 匯款單成立 | :909 | `sweep-email-outbox.ts:611` | 純文字 | 無 | 有(網址) | 有 | 只有 LINE | 總額 / 已收 / 應付 + 帳號 |
| ③ | 未付款取消 | :565 | `sweep-email-outbox.ts:926` | 純文字 | 無 | 只有一句話 | **無** | **只印「PCM重機零件販售」** | 不印(刻意,不能提退款) |
| ④ | 刷卡全額退款後取消 | :775 | `sweep-email-outbox.ts:973` | 純文字 | 無 | 有(網址) | 有 | 有 | 退款額(全額才印) |
| ⑤ | 部分退款 | :839 | `sweep-email-outbox.ts:1048` | 純文字 | 無 | 有 | 有 | 有 | 退款額 |
| ⑥ | 出貨通知 | :666 | `sweep-email-outbox.ts:1109` | 純文字 | 無 | 只有一句話 | 無 | 只印店名 | 不印(品項清單) |
| ⑦ | 貨運單號更正 | :715 | `sweep-email-outbox.ts:2276` | 純文字 | 無 | 無 | 無 | 無 | 不印 |

⇒ Sean 說的「③④ 同一種信、豐富度不一樣」屬實:③ 缺連結、LINE、公司頁尾(`sweep-email-outbox.ts:951`),④ 都有(`:1016-1021`)。
出處:上表由 Explore(sonnet)盤點;①③④ 的函式、logo 常數、取消理由那幾行我開檔核過,②⑤⑥⑦ 的行號**吻合但未逐一開檔證實**。

不在 repo、不做:Supabase Auth 的忘記密碼 / 註冊驗證信(Supabase 後台範本)⇒ 第 7 節只列成一個選項。

## 2. 統一版型

- **外框從 ① 抽出來共用**:把 `renderPaidEmailHtml`(`packages/use-cases/src/paid-email-html.ts:288`)的頁首(logo)、按鈕、LINE 聯絡段、公司頁尾抽成一支 `renderCustomerEmailShell({ 標題, 預覽文字, 內文 HTML, 按鈕網址 })`,放在同一支檔。① 改成呼叫它。
  - **驗收:① 抽完之後,除了 logo 多一個 `<a>`,輸出要逐字不變**(改前改後各 render 一次比 diff)。
- **②~⑦ 各加一支 HTML 內文**,放在新檔 `packages/use-cases/src/customer-email-html.ts`(`paid-email-html.ts` 已 671 行,鐵則 6)。字面沿用各自純文字版已經在用的常數(`order-email-copy.ts`),**不重寫文案**,只換成排版。
- **設計來源**:只有 ① 有設計稿(OD `email-order-paid-A.html`,不在 repo)。②~⑦ 沒有稿 ⇒ 照鐵則 1 直接沿用 ① 的外框與樣式常數,不另外畫。
- **寄出**:`sweep-email-outbox.ts` 目前只有 ① 會帶 `html`(`:2047-2052`)。改成每一種都帶(寄件 adapter 本來就吃 `html`,`ResendEmailSenderAdapter.ts:420-434`)。
- **純文字備援:要,而且本來就有**:7 封都已經有純文字版,照舊跟 HTML 一起送。有的信箱不顯示 HTML,或客人開了純文字模式,那時看的就是這一份。純文字版同步補齊 ③⑥⑦ 缺的 LINE 與公司頁尾(與 HTML 資訊一致)。

## 3. Logo 連結

- 每封信最上面的 logo 包 `<a href="https://www.pcmmotorsports.com/">`,**寫死 www**(Sean 指定的網址,不走環境變數)。
- Logo 圖本身沿用 `PCM_EMAIL_LOGO_URL = 'https://www.pcmmotorsports.com/pcm-logo.png'`(`paid-email-html.ts:116`,已經是 www、不是 shop)。該常數旁的註解寫著:這張圖在官網專案與顧客站的同一路徑各放一份,所以換網域那天不會斷。**今天通不通未驗**,實作時 curl 一次附輸出。
- **會員中心按鈕照舊跟 `NEXT_PUBLIC_SITE_URL`**(`paid-email-html.ts:120-146` 寫了為什麼跟 logo 方向相反:訂單頁只有顧客站有)。⇒ 🔴 **換 www 那天這個 env 要一起改成 www**,否則新信的按鈕還是 shop。實作前核對換網域 runbook 有沒有這一條,沒有就補一行。

## 4. 每封信的資訊欄位對齊

| 欄位 | ① | ② | ③ | ④ | ⑤ | ⑥ | ⑦ |
|---|---|---|---|---|---|---|---|
| logo(連 www) | ✅ | 新增 | 新增 | 新增 | 新增 | 新增 | 新增 |
| 訂單編號 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 會員中心按鈕 | ✅ | 改按鈕 | **新增** | 改按鈕 | 改按鈕 | **新增** | **新增** |
| LINE | ✅ | ✅ | **新增** | ✅ | ✅ | **新增** | **新增** |
| 公司頁尾 | ✅ | **新增** | **新增** | ✅ | ✅ | **新增** | **新增** |
| 金額 | 明細 | 應付 + 帳號 | **照舊不印** | 全額才印 | 退款額 | **照舊不印** | 不印 |

「照舊不印」的理由都寫在各自函式的註解裡,是既有的拍板或刻意設計(③ 不能讓客人以為有退款:`order-email-copy.ts:210-217`,已開檔核;⑥ 出貨信不印金額),本片不推翻。
按鈕的通則照 ① 的寫法:沒有網址(env 沒設)⇒ 整顆不印,不印連到空網址的按鈕。

## 5. 取消理由改成客人用語

**病灶**(已開檔核):
- 後台「標記取消」那顆鈕把原因碼寫死成 `other`,說明寫死成「款項已全額退還,收尾把訂單標記為取消」(`apps/admin/src/lib/orders/cancel-actions.ts:382-383`)。
- DB 取消函式遇到 `other`,就把那段說明原樣存進 `orders.cancelled_reason`(`supabase/migrations/20260830020000_m4b_e10_cancel_reason_neutral.sql:155-175`)。
- 信件讀 `cancelled_reason` 原樣印出來(③ `sweep-email-outbox.ts:939-949`、④ `:989-1000`),只整理了格式(`sanitizeCustomerFacingReason`,`order-email-copy.ts:280`),**不管內容**。
- 會員中心訂單頁**已經不印**這個欄位,理由正是同一件事(`apps/storefront/src/components/account/OrderDetailView.tsx:822`)⇒ 信件跟它不一致。

**做法(推薦,第 7 節 Q1 乙)**:信裡**只印 6 句固定的客人用語**,其他一律不印。
- 那 6 句就是 DB 對 6 個原因碼的對應(`20260830020000_…:156-161`):「依您要求取消」「商品供貨中斷,已為您取消」「交期無法配合,已為您取消」「重複訂單,已為您取消」「訂單已取消,詳情請洽客服」(兩個碼共用這句)。
- `cancelled_reason` 不在這 6 句裡 ⇒ 那一定是員工自己打的字(`other`)⇒ **不印**。④ 本來就有「已全額退回」那句(`:1010-1013`),③ 本來就有「這張訂單尚未付款，不會有任何款項產生。」那句(`order-email-copy.ts:216-217`) ⇒ 少了理由,信還是完整的。
- 6 句在 TS 裡要有一份白名單 ⇒ 加一格測試,直接讀那支 migration 的 CASE,兩邊不一致就紅,防止以後有人改了 DB 文案而信件這邊沒跟上。
- **不動 DB、不動後台**:後台那段字留在 `cancelled_reason` 給員工看,只是不再寄給客人。

## 6. 風險

1. 🔴 **上線當下正在重試的信會永遠寄不出去**:Resend 的冪等鑰匙 = `<信的種類>/<outbox 編號>`(`ResendEmailSenderAdapter.ts:298`),24 小時內同一把鑰匙內容不同 ⇒ 回 `invalid_idempotent_request`,重試永遠不會成功(`:270`)。上線前已經送過一次(失敗而重試中)的 ②~⑦,上線後會多一份 HTML ⇒ 內容不同 ⇒ 撞這個錯。
   做法:只對「還沒送過 Resend 的信」加 HTML,重試中的照舊純文字寄完。判斷用哪個欄位,實作時確認(**未確認**)。
2. 信件 HTML 在各家信箱(Gmail / Outlook / Apple Mail)長相不同。① 已經上線,抽外框只換內文,風險比從零畫小。**要 Sean 用自己的信箱收一輪 7 封看**(實作時用本機寄測試信,不碰正式客人)。
3. ⑥ 出貨信、⑦ 單號更正以前都沒有連結,現在多了按鈕與 LINE ⇒ 等於信裡多了對外連結。Sean 這次的指示涵蓋這件事(「都要加上網址連結」)。

## 7. 要 Sean 答的

```
Q1: 取消信裡的「取消理由」要怎麼處理?
A: 甲 完全不印 —— 跟會員中心訂單頁一樣。信裡只說「訂單已取消」,加上退款或未扣款那句。
   乙 只印 6 句固定的客人用語(例:「商品供貨中斷,已為您取消」),員工自己打的字一律不印。
   推薦:乙。客人知道為什麼被取消,而員工打的字絕對不會寄出去。

Q2: Supabase 的忘記密碼 / 註冊驗證信(不在我們的程式裡)要不要也換成同一套外框?
A: 甲 這次不做 —— 先做我們自己寄的 7 封。
   乙 要 —— 我產出一份 HTML,由 Sean 貼到 Supabase 後台的範本(Authentication → Email Templates)。
   推薦:甲。先把訂單信做完;Auth 信要 Sean 手動貼,另外排。
```

## 8. 做的時候的驗收

- ① 抽外框前後逐字 diff:只多一個 logo `<a>`。
- 7 封各 render 一次 HTML 存檔,附截圖給 Sean 看(品味題給實體版本,不用文字描述)。
- 每封 HTML:logo `<a href>` = `https://www.pcmmotorsports.com/`、有 LINE、有公司頁尾、有訂單編號;③⑥ 不出現金額。
- 取消理由:員工字(例:「款項已全額退還,收尾把訂單標記為取消」)⇒ ③④ 的 HTML 與純文字都**不含**;6 句固定用語 ⇒ 會印。
- 6 句白名單 ⇔ migration CASE 一致的測試格,外加突變(改一個字就紅)。
- 三綠 + 跑 `sweep-email-outbox.test.ts`、`paid-email-html` 相關測試、新檔測試。
- 鐵則 12:寄信 ⇒ Fable 5.1 二審(09-15 codex 回來後換回 codex)。
- **做完 = Sean 自己的信箱收到 7 封、看過。**
