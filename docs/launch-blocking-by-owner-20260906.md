# 擋上線 102 列 · 按【誰欄】分堆(2026-09-06 · `tidy` 重產)

> ⛔ ~~上一版是 **83 列**(擋 83 的時候產的)~~ ⇒ ✅ **本版 102 列**,基準 `32045d1ea`。
> **為什麼從 83 變 102**:Sean 2026-09-06 親口「我怕有漏」⇒ 補判 `parked` 91 + `standing` 3
> ⇒ **20 個擋藏在「刻意先不做」那一堆裡(佔全部的 19%)**。
> 📌 **「刻意先不做」與「不擋上線」是兩件事,而 `parked` 這個態只記錄前者。**
> 
> 🔴 **這一份是派工用的,不是給 Sean 讀的** —— 白話版 `docs/launch-status-20260906.md`。
> 現值當場跑 `bash scripts/launch-blocking-count.sh`(本份是快照,板子還在動)。
> **每列只給錨 + 一句,不抄整列** —— 用錨去找:`bash scripts/board-row-by-anchor.sh '<錨>'`。
> ⚠️ 錨欄是 `#編號` / `:行號` 的,是那 194 個【錨欄無錨】的列之一 ⇒ 用那個編號找,**不要跨樹用行號**。
> 🛑 **未派工前先跑 `python3 scripts/what-happened-to.py <錨>`** —— 2026-09-06 一夜實錘:
>    `#868`(寄信那半早已接上)與 `⟦b4-RESTORE2⟧`(兩半都不對)**都比板上寫的輕**。

## 🔴🔴 派工最該先看的一格:**102 個擋裡,68 列不在任何一條線手上**

```
(誰欄看不出窗) 31   ← 誰欄有字, 而它不是窗名(是理由/證據/已作廢的舊窗名)
待派           25
等 Sean        12   ← 要的是【端他一個字】, 派人過去沒用
---- 以上 68 列 ----
mail 9 · account 6 · ship 5 · auth 4 · db 4 · tidy 3 · front 2 · 報價單 1  = 34 列有窗
驗算 31+25+12+34 = 102 ✅
```
🎯 **兩個數不可互換**:**56 = 缺人**(31+25, 要的是派工)· **68 = 今晚不會有人動它**。
📌 而那 **31** 列最毒:**它們的誰欄不是空的** ⇒ 在畫面上與「有人負責」長得一樣。
⚠️ **上一版是 48 / 53,本版是 56 / 68** —— 補判 parked 之後兩個數都變大,**不要引用舊值**。

## (誰欄看不出窗)(31 列)

| 錨 | 態 | 擋的理由 | 一句 |
|---|---|---|---|
| `⟦b4-PAIDTHENOVERPAID⟧` | doing | ⟨擋(tidy 判 ①③)⟩ | 已付款的單被多匯一次 —— 而它今天零觀眾 |
| `⟦b4-NCPCRONRACE⟧` | open | ⟨擋(tidy 判 ①③)⟩ | 逾期 cron 先鎖住那張單, 收款才落帳 最後變成「已取消而錢在裡面」 |
| `⟦b4-NCPCANCELROLLBACK⟧` | open | ⟨擋(tidy 判 ①)⟩ | 重算撞上 statement timeout 時, 客人那筆收款會【跟著回滾】—— 而那是本片自己宣稱不會發生的 |
| `⟦b4-BANKCARDRACE⟧` | doing | ⟨擋(tidy 判 ①③)⟩ | 兩個分頁:我取消完之後,另一個交易才建出同一台車的匯款單 —— 這一發掃不到它 |
| `—` | open | ⟨擋(tidy 判 ④)⟩ | ACL 漂移守門裝上了,而【路⑤ dashboard / SQL Editor 手動改權限】仍然完全沒有人守 |
| `②` | parked | ⟨擋(tidy 判 ⑥)⟩ | 有人可灌爆通知信箱 |
| `#858` | open | ⟨擋(tidy 判 ①)⟩ | 手動建訂單(客人匯款那條路)—— 2026-08-26 拆號:本列是【觀察條目】,實作那一片在 #939(本檔  |
| `⟦f3-ALLOWLISTMANUAL1⟧` | open | ⟨擋(tidy 判 ⑥)⟩ | 白名單是手寫的 —— 有排程在跑而沒有人在看,不會有任何訊號 |
| `—` | open | ⟨擋(tidy 判 ④)⟩ | 我們的回退方案是 222 段從來沒有人執行過的註解 |
| `—` | open | ⟨擋(tidy 判 ④)⟩ | 「回退指令在半夜是 20ms, 在上班時間是一個不動的游標」 |
| `—` | open | ⟨擋(tidy 判 ④)⟩ | 稽核紀錄會說一句不真的話 —— 它記「管理者 A 做的」, 而事發當下 A 已經不是管理者(查核與寫入不在同一個 |
| `⟦0e-PROBENOSCHED⟧` | open | ⟨擋(tidy 判 ⑥)⟩ | scripts/probe-schema-exposure.sh 沒有排程 —— 規格說「由人或排程跑」, 而  |
| `⟦b4-ANOMCLAIM1⟧` | parked | ⟨擋(tidy 判 ③)⟩ | 兩個人同時按下同一筆雙扣異常的「認領」—— 而兩個人都以為自己在退那筆錢 |
| `⟦0b-TYPESNOTREGEN⟧` | open | ⟨擋(tidy 判 ⑥)⟩ | database.types.ts 自 20260902030000 apply 之後【沒有人重生成過】 pcm |
| `—` | open | ⟨擋(tidy 判 ③)⟩ | 他答了退款畫面那個數字要「顯示函式一起改」(B, 貴的那一邊)—— 而板上沒有列 ⟦b9-REFUNDNUM1⟧ |
| `⟦f3-AUTOREFUND2⟧` | open | ⟨擋(tidy 判 ①)⟩ | 已收款單取消要【自動開待退款】—— Sean 2026-08-27 拍甲; 而落地零次 2026-09-02 已 |
| `⟦f3-RPCOWNER1⟧` | open | ⟨擋(tidy 判 ④)⟩ | 金流 RPC 的歸屬只到「某個有後台密碼的人」 |
| `⟦15-SHIPGATE-F1⟧` | parked | ⟨擋(tidy 判 ⑥)⟩ | 停線期間的出貨信會把死信告警的訊號1【永久推成非零】 那個告警從此不會再叫 |
| `⟦b4-PARTPAIDNOCANCEL1⟧` | open | ⟨擋(tidy 判 ①)⟩ | 收了訂金的匯款單【會變成不能取消】—— 而今天它可以。這是一個【上線會製造出來的】缺陷,不是現存的 |
| `⟦f3-ADPNARROWER1⟧` | open | ⟨擋(tidy 判 ④)⟩ | 那道被當成「根治」的 ALTER DEFAULT PRIVILEGES,射程比報的窄一格 |
| `⟦f3-RECIPIENTBIND1⟧` | open | ⟨擋(tidy 判 ⑤)⟩ | 寄件信箱與信件內容沒有「同一張單」的不變式 —— 而換成 HTML 會把洩漏面放大一個量級 |
| `⟦f3-PAIDCANCELRACE1⟧` | open | ⟨擋(tidy 判 ⑤)⟩ | 取消狀態只讀一次 讀完之後才被取消的單,照樣收到「付款成功」 |
| `⟦c7-LEDGERGATEREFUSES⟧` | open | ⟨擋(tidy 判 ③)⟩ | Sean 退了現金給客人,而系統【不讓他記】—— 那道閘擋下的是【紀錄】,而錢早就離開了 |
| `⟦b4-EMAILTRIAGE⟧` | open | ⟨擋(tidy 判 ④⑤)⟩ | 標籤列:寄信路徑 52 條 codex findings 的逐條複核正本 —— 板上只開兩條,其餘 10 條的落 |
| `⟦b4-RESENDNOTIMEOUT⟧` | parked | ⟨擋(tidy 判 ⑤)⟩ | 寄信的 fetch 沒有任何 timeout 一封卡住,同批 49 封白燒重試額度、整批進死信 |
| `⟦b4-RESEND409⟧` | open | ⟨擋(tidy 判 ⑤)⟩ | 同一把冪等 key 配不同 payload Resend 回 409,而它【不是去重】 —— 重試一路燒到死信, |
| `⟦b4-MANREFUNDNOOWNER⟧` | open | ⟨擋(tidy 判 ③)⟩ | 人工退款之後,那張訂單仍然顯示【已付款】—— 而 Sean 本人明早開後台就會看到 |
| `⟦b4-PAYCONCUR1⟧` | open | ⟨擋(tidy 判 ③ —— 🔴 同 ⟦5b-REPORTEDNOTLANDED1⟧ 的形狀:本列主旨是流程反思, 而擋來自內嵌事實(併發收款觸發器競態算錯金額, 拋棄式 PG 實測過;修法 NONCARDPAID1 未上線 ⇒ 現況是活的))⟩ | 同一張單兩筆收款同時進來 實收 1000 的單停在「部分付款」 員工打電話去要一筆【已經收到】的錢 |
| `⟦b4-RECIPLIVEVALUE⟧` | open | ⟨擋(tidy 判 ⑤)⟩ | customers.email 是【註冊那一刻的化石】—— 沒有任何一條路會更新它 信寄到客人已經不看的舊地址  |
| `⟦front-PDPTAXONOMYEMPTY⟧` | open | ⟨擋(tidy 判 ⑤)⟩ | 商品詳情頁的「適用車款」會【整區空掉】, 而頁面回 200、畫面不說 |
| `⟦search-TAXONOMYTIMEOUT⟧` | open | ⟨擋(tidy 判 ⑤)⟩ | 車款查詢會逾時, 而它【靜默降級】—— 客人拿到一份殘缺的車款下拉, 畫面不會說 |

## 待派(25 列)

| 錨 | 態 | 擋的理由 | 一句 |
|---|---|---|---|
| `⟦b4-BANKDUPPERCART⟧` | open | ⟨擋(tidy 判 ①)⟩ | 同一個 cart 可以建出兩張匯款單, 而今天沒有任何東西擋 |
| `⟦b9-Q15GAP⟧` | parked | ⟨擋(tidy 判 ④)⟩ | service_role 讀不到 40 張 45 張開了 RLS 的表 —— 而唯一補過的那一張【被撤下了】 那 |
| `⟦f3-FWBYPASSORDER⟧` | open | ⟨擋(tidy 判 ⑥)⟩ | 未來在 Vercel 防火牆加規則時, 它【必須排在放行規則的下面】—— 而沒有任何東西會提醒你 |
| `—` | open | ⟨擋(tidy 判 ⑥)⟩ | 心跳白名單今天對得上, 而【那個零不能被讀成「已經驗過了」】 ⟦b4-CRONWL1⟧ |
| `#64` | parked | ⟨擋(tidy 判 ⑤)⟩ | 客人拿不到發票 |
| `⟦b9-ENUMWATCH⟧` | open | ⟨擋(tidy 判 ④⑥)⟩ | 稽核紀錄寫進去了, 而【沒有任何告警器在讀它】—— 而那正是 ⟦b4-ENUM3⟧ 原本的病 |
| `⟦b9-SRVMIN⟧` | open | ⟨擋(tidy 判 ④)⟩ | 那幾道持有的【範圍】是不是最小 —— 今天沒有人量過 |
| `⟦b4-MGRENV1⟧` | open | ⟨擋(tidy 判 ④⑥)⟩ | 後台所有 manager 閘的效力綁在一顆 env 上, 而那顆拿掉時它們會【放行】—— 而值讀不到、三綠全綠 |
| `⟦c7-ACLGATEANCHOR⟧` | open | ⟨擋(tidy 判 ⑥)⟩ | ACL 守門的錨認【八碼】, 而它自己印給人看的說明寫「版本號」—— 而 migration 版本號是十四碼 |
| `⟦b4-TESTACCT1⟧` | open | ⟨擋(tidy 判 ③)⟩ | 正式站 auth 裡還躺著一個測試帳號 —— 而【它有沒有被算進任何數字】沒有人知道 |
| `—` | parked | ⟨擋(tidy 判 ⑥ —— 🔵 Sean 裁「Phase 2」是【延後】, 而延後不等於【接受殘餘風險】;判準⑥是他自己的尺, 金流失敗零監控直接命中。要改成不擋, 要的是他一句「接受」)⟩ | 客人刷不出卡,我們這邊不會響 |
| `⟦b4-CANCELRACE1⟧` | open | ⟨擋(tidy 判 ①③)⟩ | 查「有沒有出貨」與「取消並退款」不在同一個交易 —— 中間那一瞬間有人按出貨, 錢就白退了 |
| `⟦b4-PARTCANCEL1⟧` | open | ⟨擋(tidy 判 ①③)⟩ | 【部分取消】收了的錢, 今天起【仍然】零紀錄 —— 而整單取消那一半已經修好了 |
| `—` | parked | ⟨擋(tidy 判 ⑤⑥)⟩ | 等時機:有新訂單進來之後(現在 orders=0 這把尺沒有材料) —— 寄信死人開關的訊號 4:訂單已 pai |
| `#530 / #872` | open | ⟨擋(tidy 判 ⑥)⟩ | 那道 migration 守門寫好了、沒接線,而且從來沒有正確過 已接線(40cb0486,.husky/mig |
| `⟦b4-REPLAY1⟧` | open | ⟨擋(tidy 判 ⑥)⟩ | supabase/migrations/ 從零 apply 重現不了正式庫 |
| `**Sean**` | open | ⟨擋(tidy 判 ①⑥)⟩ | 那封每日告警叫的是一件後台做不到的事,已叫 15 天 |
| `⟦b4-WITHHELD1⟧` | open | ⟨擋(tidy 判 ②③⑥)⟩ | 「該刪而沒刪」那張清單今天【只活在一行 log 裡】—— 而它是一張會長的清單 |
| `⟦b4-FITSYNC1⟧` | open | ⟨擋(tidy 判 ⑥)⟩ | 車款搜尋的資料停在 08-26 2026-08-31 -f7 實查:已恢復 —— 而「零告警」那半一個字都沒變 |
| `⟦b4-CAPRACE1⟧` | open | ⟨擋(tidy 判 ③)⟩ | 這張表的閘在防一件它防不到的事 —— 而「修好它」會讓帳變得更錯 |
| `#903` | open | ⟨擋(tidy 判 ④)⟩ | B5-a 的 rollback 是紙上約束 |
| `⟦5b-REPORTEDNOTLANDED1⟧` | open | ⟨擋(tidy 判 ③ —— 🔴 本列【主旨是流程教訓】, 擋來自它內嵌的一個具體事實:wallet ledger entry_date 用 current_date、修法 20260829180000 未 applied ⇒ 記帳日期錯誤仍在 production。判的是那個事實, 不是那篇反思)⟩ | 一句「已回報、已立 backlog」如果不帶錨, 它不是交接 —— 它是一個【關掉下一個人尋找動作】的免責 |
| `⟦5b-AUDITGRANTEXPIRY⟧` | open | ⟨擋(tidy 判 ④)⟩ | 稽核表那個 SELECT 權限的「到期日」【不是一個日期, 是一個事件】—— 而那個事件可能已經發生了, 而沒有 |
| `⟦f3-REDNEEDSEXIT⟧` | open | ⟨擋(tidy 判 ⑥)⟩ | 紅字要有【出口】與【觀眾】—— 事前擋的觀眾一定在現場(他被擋了);事後紅的觀眾可能永遠不來 |
| `⟦0a-CARDCANCELNOREFUND⟧` | open | ⟨擋(tidy 判 ①③)⟩ | 取消一張刷卡單, 今天【沒有任何東西】會【自動】去退那筆錢( 2026-09-05 訂正:退款的鈕【是有的】 — |

## 等 Sean(12 列)

| 錨 | 態 | 擋的理由 | 一句 |
|---|---|---|---|
| `⟦01-DEFINERPATH67⟧` | parked | ⟨擋(tidy 判 ④)⟩ | 67 支既有 migration 的 SECURITY DEFINER 沒有把 search_path 釘成空字 |
| `⟦b4-ALERTENV⟧` | open | ⟨擋(tidy 判 ⑥)⟩ | ANOMALY_ALERT_ENABLED 今天是什麼值,沒有人重量過( 「沒有人查過」 2026-08-30  |
| `—` | parked | ⟨擋(tidy 判 ③)⟩ | 代購品項的單價【沒有任何含稅保證】—— 而錯的錢會配一個全綠的守門 ⟦b4-PURCHTAX1⟧ |
| `⟦b9-ACLDRIFT5⟧` | open | ⟨擋(tidy 判 ④)⟩ | ACL 漂移守門裝上了,而【路⑤ dashboard / SQL Editor 手動改權限】仍然完全沒有人守 |
| `⟦b4-TAPPAYDIRECT⟧` | parked | ⟨擋(tidy 判 ③)⟩ | 在 TapPay 後台直接退款這條路,不經過我們的系統 —— 而我們要不要知道,是 Sean 的決定 |
| `⟦b4-REFUNDAUTHZ⟧` | parked | ⟨擋(tidy 判 ③)⟩ | 改一個員工的資料要【管理者】;而發一筆退款只要【登入】—— 那是要不要,不是該不該 |
| `⟦f3-TAPPAYNORATELIMIT1⟧` | open | ⟨擋(tidy 判 ①)⟩ | TapPay 通知端點沒有限流 —— 兩個結構性障礙今天都拆了 |
| `總帳無號` | parked | ⟨擋(tidy 判 ⑥)⟩ | OWASP Core Ruleset 拿不到 —— Enterprise 專屬 |
| `—` | doing | ⟨擋(tidy 判 ②)⟩ | 手動建單的品項規格(line_spec)沒有畫面入口 快照永遠是 {} 且補不回來 補在應用層的東西, DB 那 |
| `#299` | open | ⟨擋(tidy 判 ④)⟩ | 整張正式資料表不在版控裡 是【三張】,全在同一條 fitments 管線上(2026-08-30 盤點;舊字面留 |
| `⟦b4-PFEREPLAY1⟧` | parked | ⟨擋(tidy 判 ④)⟩ | 「從零重放」還是做不到 —— 而補版控那支的【版號比第一個讀它的人晚兩個月】 |
| `⟦b9-SHIPUI⟧` | parked | ⟨擋(tidy 判 ⑤)⟩ | 顧客站進度軸「已出貨」上線, 而它帶著兩個【客人看得到】的已知缺陷 —— 兩條都要 Sean 拍 |

## mail(9 列)

| 錨 | 態 | 擋的理由 | 一句 |
|---|---|---|---|
| `⟦b4-BANKNOEMAIL⟧` | open | ⟨擋(tidy 判 ⑤)⟩ | 選了匯款的客人, 【一封信都收不到】—— 而他要匯去哪只寫在一頁他得自己走回去的畫面上 |
| `⟦b4-NOSENTBODY⟧` | standing | ⟨擋(tidy 判 ⑥)⟩ | 客人說「你們寄給我的帳號是錯的」—— 而客服【調不出他當時收到的那封信】 |
| `⟦b4-BANKCHARGESCARD⟧` | open | ⟨擋(tidy 判 ①)⟩ | 翻開匯款開關的那一刻, 系統會拿客人的卡去扣一張【匯款單】的錢 |
| `—` | open | ⟨擋(tidy 判 ⑥)⟩ | 6 支 pg_cron 可能安靜停了,而其中兩支在金流路徑上 —— 沒有人會抱怨,因為沒有客人看得到 |
| `⟦f3-ALERTSAMELINE1⟧` | open | ⟨擋(tidy 判 ⑥)⟩ | 告警器與它要監控的排程走【同一條線】—— 那條線壞掉,兩個一起停,沒有人會叫 |
| `⟦b4-MAILRENDER1⟧` | open | ⟨擋(tidy 判 ⑤ —— 而這是 11 個擋裡最不確定的一個:它是「沒驗過」不是「已知會錯」)⟩ | 那封付款成功信【沒有任何一格是在真的信箱裡看過的】—— 而它現在有版面了, 所以看起來像做完了 |
| `⟦b4-INVOICE5PCT⟧` | doing | ⟨擋(tidy 判 ①③)⟩ | 手動建單加【開發票】勾選欄:勾了單價 +5%, 沒勾不加(Sean 2026-09-04 本人提的新規格) |
| `⟦b4-DEALERSIGNUPUNSEEN⟧` | open | ⟨擋(tidy 判 ③⑤)⟩ | 經銷會員登錄那條路【沒有人驗收過】—— 而說這句話的是 Sean 本人 |
| `⟦b4-CANCELMAILMIXEDRAIL⟧` | open | ⟨擋(tidy 判 ⑤)⟩ | 卡 + 現金混合退款的取消單【系統不寄】, 要人工寄 —— 而今天沒有任何東西會提醒人工去寄 |

## account(6 列)

| 錨 | 態 | 擋的理由 | 一句 |
|---|---|---|---|
| `⟦b4-CARDPENDINGWINDOW⟧` | doing | ⟨擋(tidy 判 ①③)⟩ | 刷卡【進行中】那段窗口:客人另開分頁建匯款單, 守門看不到 兩張單仍同時活著 |
| `⟦b4-TAXSURFACES⟧` | open | ⟨擋(tidy 判 ③)⟩ | 會對客人顯示那五個金額的地方是【五個】, 而 spec 與板子都只寫了兩個 |
| `⟦b4-PRICECOPYTAX⟧` | doing | ⟨擋(tidy 判 ①③)⟩ | 建單畫面逐字教員工「單價填【含稅】」—— 而 ⟦b4-INVOICE5PCT⟧ 第 9 步會讓這句話變成【錯的】 |
| `⟦b4-TAXADMINSURFACES⟧` | open | ⟨擋(tidy 判 ③)⟩ | 後台那兩個金額面在有稅時四個數加不起來 —— 而 CSV 的欄名逐字寫著「可直接加總」 |
| `⟦acct-LOGOUTTESTBLIND⟧` | open | ⟨擋(tidy 判 ⑥)⟩ | 一格名字叫「登出」的測試, 而它測的世界裡【沒有登出】—— 而它綠著 |
| `⟦supply-BRANDFILTERZERO⟧` | parked | ⟨擋(tidy 判 ⑤)⟩ | 顧客站品牌目錄頁曾經一次印「0 件商品 · 找不到符合條件的商品」, 而同一時間伺服器回的 HTML 是「723 |

## ship(5 列)

| 錨 | 態 | 擋的理由 | 一句 |
|---|---|---|---|
| `⟦5b-SHIPPEDNUMNOTRECORDED1⟧` | open | ⟨擋(tidy 判 ⑤)⟩ | 我們沒有存下「那封出貨信實際寄了哪個號碼」 一個競態下客人會永久拿著錯號碼, 而沒有東西會叫 |
| `⟦ship-HCTACTIVATION⟧` | open | ⟨擋(tidy 判 ②)⟩ | 只開 env 不等於上線 —— 而傳輸層做完之後, 沒有任何一份受審的文件在管「誰按下第一箱」 |
| `⟦ship-HCTUNKNOWNREAD⟧` | open | ⟨擋(tidy 判 ②)⟩ | 乙型:新竹【回了】而我們讀不懂 —— 那箱一樣卡在 unknown, 而成因與甲型完全不同 |
| `⟦ship-HCTLABEL⟧` | open | ⟨擋(tidy 判 ②)⟩ | 新竹的貨號我們拿得到了, 而【那張要貼在箱子上的紙】今天沒有人印得出來 2026-09-06 起印得出來了(片  |
| `⟦ship-HCTLABELCAPTURE⟧` | open | ⟨擋(tidy 判 ②)⟩ | 那張標籤圖【現在就會被存下來】—— 而我們一箱都還沒送過, 所以庫裡是空的 |

## auth(4 列)

| 錨 | 態 | 擋的理由 | 一句 |
|---|---|---|---|
| `⟦b9-SRVCONSUMERGAP⟧` | parked | ⟨擋(tidy 判 ④)⟩ | service_role 消費者盤點還有四個沒補的洞 —— 而每一個的偏向都是【少報會壞的】 |
| `⟦b9-ZEROPOLICYSEAM⟧` | parked | ⟨擋(tidy 判 ⑥)⟩ | 兩支「應為零 policy」的漂移偵測器, 在 20260904270000 貼下去那一刻就已經不成立 —— 而 |
| `⟦b4-SEQACL1⟧` | parked | ⟨擋(tidy 判 ④)⟩ | 正式庫有 4 支 sequence 讓 anon 可以 nextval / setval —— 而 RLS 管不 |
| `⟦search-LOGFLOOD⟧` | open | ⟨擋(tidy 判 ⑥ · 近 ④ —— 作者明言殘餘風險未經 Sean 拍板接受, codex R2 仍 FAIL)⟩ | 搜尋語料表可以被灌 —— 而我只把攻擊面【降低】, 沒有消掉 |

## db(4 列)

| 錨 | 態 | 擋的理由 | 一句 |
|---|---|---|---|
| `⟦b4-REFUND10016⟧` | open | ⟨擋(tidy 判 ①③)⟩ | 同一張單、同一個碼、隔 10 天卡了兩次 —— 而中間有人查過、寫下來了 <br> [2026-09-01 12 |
| `⟦b4-REFUNDID1⟧` | open | ⟨擋(tidy 判 ①③)⟩ | 退款 ID 在傳遞途中被丟掉 |
| `⟦db-MERGEBLINDGATE⟧` | open | ⟨擋(tidy 判 ⑥)⟩ | git merge 不跑 pre-commit 掛在那裡的每一道閘, 對【合併帶進來的】那一半是盲的 |
| `⟦db-DOGBLINDBRANCH⟧` | doing | ⟨擋(tidy 判 ⑥)⟩ | 部署時序閘的「0 pending」有兩個世界, 而它們印同一行字 —— 其中一個放行的正是這道閘存在的理由 |

## tidy(3 列)

| 錨 | 態 | 擋的理由 | 一句 |
|---|---|---|---|
| `⟦b9-PROBESCHED⟧` | open | ⟨擋(tidy 判 ⑥)⟩ | 那支曝露探針【沒有人在定期跑它】—— 它只在有人想到的時候跑一次 |
| `⟦b4-2FAOWNER1⟧` | open | ⟨擋(tidy 判 ④)⟩ | 2FA 蓋好了,但沒有「這支手機是誰的」 |
| `BL-37` | open | ⟨擋(tidy 判 ②)⟩ | 部件講錯／方向講反(15 筆; 2026-08-25 線 4 補跨 repo 座標:/Users/sean_1/ |

## front(2 列)

| 錨 | 態 | 擋的理由 | 一句 |
|---|---|---|---|
| `⟦b4-SIG4ERRORS⟧` | open | ⟨擋(tidy 判 ⑥)⟩ | 訊號4 的 errors 桶【持續失敗】那一種,本片不會叫 |
| `—` | open | ⟨擋(tidy 判 ④)⟩ | storefront 有 5 道 service_role 受控例外,而其中 4 道說不出是誰批的 |

## 報價單(1 列)

| 錨 | 態 | 擋的理由 | 一句 |
|---|---|---|---|
| `⟦b4-QUOTE2FA1⟧` | open | ⟨擋(tidy 判 ④)⟩ | 報價單 2FA【裝好了而關著】—— 而那是後台前面唯一一道門(現值 34 天沒量;原標題:報價單那邊 2FA 現 |

