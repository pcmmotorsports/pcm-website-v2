# 上線前必關清單(第一張真實訂單進來之前)

> **建立**:2026-08-17 E 窗(資安稽核,唯讀)。**主視窗指派、Sean 業務前提觸發。**
> **狀態**:活文件。**每加一條都要附「怎麼驗它已補齊」,而且那個驗法要是可執行的。**

---

## ⓪ 🔴 這份檔為什麼存在(先讀這段,不然你會把它當成又一份 backlog)

Sean 2026-08-17 逐字:

```
現在沒有正式的訂單，都還沒對外開放使用，所有都是我們自己測試的。
```

這句話是**下面每一條的嚴重度分母**。它成立的時候:曝露面**是真的**(服務公開可達),
但**可被偷走的錢 = 0、可被弄壞的真實訂單 = 0**。

🔴🔴 **而這句話的【射程】必須跟著它走(2026-08-17 夜補,因為它差點被套錯範圍)**:
```
涵蓋    pcm-website-v2 的顧客站（storefront + admin）——「還沒對外開放」講的是這個
不涵蓋  🔴 報價單系統（另一個 repo，對【車行】在用的工具）
        證據:完整且打磨過的車行「複製連結」UX、為真實流量設的 LINE 通知冷卻、
             fetcher 2026-07-31 搬到 mac mini【繼續跑】、repo 開發到 2026-08-13
        ⇒ 詳見 docs/security/2026-08-17-quote-app-layer-route-inventory.md 附錄 B
        ⚠️ 口徑:證據強烈指向【活的】，但未取得使用量的直接證據（業務表被鎖）
```
⇒ **報價單的發現不屬於本清單** —— 本清單的分母是「顧客站還沒開放」,**那個分母對報價單不成立**。
🔴 **教訓寫在這裡而不是別處:一句業務前提被引用時,要標它的射程。**
**「結論對而射程錯」在今晚出現過多次,而這一次差點發生在本檔的第一段。**

🔴🔴 **而這句話過期的那一天,repo 裡不會有任何東西變紅。**

- 不會有測試紅。 沒有一格測試在斷言「還沒對外開放」。
- 不會有 grep 命中。 這是**世界的狀態**,不是**檔案的內容**(判別句見 memory `feedback_status-file-fixed-fields-hide-stale-claims`)。
- 不會有人通知。 第一張真實訂單不會發公告。

⇒ **這份清單就是那個訊號。** 它的價值不在條目本身(條目都另有正本),
在於**它把「一句會過期的業務前提」變成一個要被讀的載體**。

### 🔴 編號 ≠ 優先序(先看這格)
編號只是**落檔順序**。**照嚴重度與「多快會發生」排,順序是**:
```
最近  ⑦ PCM_DEV_TIER_OVERRIDE / pcm-tier cookie
      └ 失效事件是【我們自己排定的工作】(M-2-08 接真經銷價)，不是「上線那天」⇒ 比其他條都近
其次  ① TAPPAY_3DS_ENABLED 前置未達 → ② #622 灌 inbox（② 實質綁在 ① 上）
      ⑤ sweeper 靜默死亡 → ⑥ settled 寫入未行使
再次  ③ E683-1 → ④ E686-1 → ⑨ ADMIN_DEV_BYPASS（皆已有 plan 或已驗，等施工/回歸）
參考  ⑧ cron 旗標現值（轉述待親驗）／⑩ 已掃過乾淨的三面
```

### 什麼時候要讀這份檔(觸發條件,任一成立)
```
· 準備對外開放 / 開放 prod 結帳
· 設定 TapPay backend_notify_url
· 第一張【非我方測試】的訂單進來
· 有人問「我們可以上線了嗎」
```

### 怎麼用
每一條都有四格:**成立條件 / 今天為何還好 / 上線那天為何嚴重 / 怎麼驗它已補齊**。
🔴 **「怎麼驗它已補齊」那格必須是可執行的,而且要能在【補齊】與【沒補齊】兩個世界印出不同的東西。**
印不出不同的東西 ⇒ 那不是驗法,那是一句話。

---

## ① 🔴 `TAPPAY_3DS_ENABLED` 已開,而它自己的 BLOCKER 前置未達成

**成立條件**:`docs/specs/2026-06-14-m3-3ds-2-webhook-route-plan.md:176` 是一個 `- [ ]` **未打勾**的 BLOCKER,逐字:

> 🔴 **BLOCKER — Vercel Firewall/WAF** 對 `/api/checkout/tappay-notify/*` 限流已設 …
> **未設 → 不得設 backend_notify_url / 不得開 `TAPPAY_3DS_ENABLED` / 不得開放 prod 結帳**

**量到的事實**:
- `TAPPAY_3DS_ENABLED` = `true`。
  ⚠️ **來源屬性:Sean 回報 → 主視窗轉述。我方未親眼看 Vercel 面板 ⇒ 標「回報,未取證」。**
- 三條 WAF 規則**實測全在 `log` 模式**(E 窗 2026-08-17 25 發實測)。
  🔴 **`log` 是觀察,不是限流。** ⇒ 那個框**是真的沒打勾**,不是沒人去打勾。

**今天為何還好**:沒有真實訂單、沒對外開放 ⇒ 灌進來也灌不到錢。
**上線那天為何嚴重**:這條 BLOCKER 的原文理由就是「inbox 膨脹 + settleCharge/Record 出站放大 的**唯一 app 前防線**」。前防線不在,而後面就是錢。

**怎麼驗它已補齊(兩個世界印不同的東西)**:
```
對 /api/checkout/tappay-notify/<任意錯 secret> 連續送 25 發，看【回應來自哪一層】：
  · 未補齊（log 模式）⇒ 400，body 是 app 的 JSON
  · 已補齊（deny/限流）⇒ 403，Vercel 邊緣純文字 + hnd1:: request id
🔴 判別器是【來自哪一層】，不是狀態碼本身。
🔴 而且要在【同一輪】收到兩種，才排除「IP 被永久封鎖」這個混淆
   （E 窗 2026-08-17 實測:11 分鐘後再送 1 發仍為 400 ⇒ 排除掉了）。
```
⚠️ **實測推翻過方案書**:被擋回的是 **`403` 不是 `429`** ⇒ 呼叫端若只認 429,會把它歸成權限錯。
📄 正本:`docs/security/2026-08-17-vercel-waf-setup-plan-hobby.md` §W-b / §W-c(**那段 Deny 窗已關閉、不可復量,§W-c 是唯一記錄**)

---

## ② `#622` tappay-notify 灌 inbox 的路徑仍開著

**成立條件(A ∧ B ∧ C)**:A secret 洩漏 ∧ B 知道真實 order UUID ∧ C 該單有 active attempt。
**今天為何還好**:B 與 C **今天幾乎不成立** —— 沒有真實訂單、沒有人在結帳。
🔴 **上線那天為何嚴重**:**B 與 C 會自己變成立**(有訂單就有 UUID、有人結帳就有 attempt)
⇒ **三道閘自己塌成一道**,只剩 A。而 A 是 secret,**失效是單點、不可預警**。

**怎麼驗它已補齊**:本條的「補齊」= ① 或 丙(IP allowlist)其中之一落地。
丙已由 Sean 結案(「tappay 我沒有 ip 可以索取」)⇒ **實質上綁在 ① 上**,不要當成兩條各自會被解掉。
📄 `docs/phase-1-backlog.md` `#622`

---

## ③ `E683-1` 新建的表**出生就自帶** `anon` 權限(含 `TRUNCATE`)

**成立條件**:新表出生即帶 `anon` = `Dxtm`(含 **TRUNCATE**);**repo 內零 `GRANT` 字面可掃、三綠不紅**。
🔴 **這不是 Sean 關掉的那個「Automatically expose new tables」開關** —— 關掉之後 `anon=Dxtm` **仍在**(實測)。
**今天為何還好**:表裡目前沒有真實資料。
**上線那天為何嚴重**:`TRUNCATE` **不受 RLS 管** ⇒ RLS 寫得再好都擋不住;而它是**每一張新表**的預設,不是某一張表的疏漏。

**怎麼驗它已補齊**:plan 已批(Sean 2026-08-17)、施工指派 B 窗。
🔴 驗收**必須先跑負向對照**:**該綠的餵一發必須綠、該紅的餵一發必須紅**;兩發都表演得出來才看斷言。
⚠️ **`has_table_privilege` 看不到欄級授權**(E 窗 2026-08-17 實測少報 2 vs 實際 3)⇒ **驗收查詢一律用欄級版**。
📄 `docs/specs/2026-08-17-e683-default-privileges-plan.md`(框架=**顯式宣告成目標狀態**,不是照抄報價單庫)

---

## ④ `E686-1` `net` 兩表對 `anon` 全 DML + `TRUNCATE`、RLS 關

**成立條件**:`net` schema 兩表對 `anon` 開放全 DML 與 `TRUNCATE`,RLS 未開。**兩庫皆驗。**
**今天為何還好**:`net._http_response` 是 6h TTL 的暫存,今天裡面只有我們自己的巡邏紀錄。
**上線那天為何嚴重**:那兩張表是 **sweeper 與告警的證據來源**。
🔴 **能被清空的證據來源 = 事後查不出發生過什麼**,而這正是出事那天唯一能回頭看的東西。

**怎麼驗它已補齊**:守門規格 + 探針規格已落檔;主視窗指派 B 窗施工。
📄 `docs/security/2026-08-17-e686-net-table-write-exposure-guard-spec.md`

---

## ⑤ sweeper 靜默死亡:**沒有任何東西會告訴你它死了**(`#231` ③)

**成立條件**:
1. 🔴 **告警的觸發條件全部要靠 sweeper【活著】才成立** ⇒ sweeper 死掉 ⇒ 沒東西達 ceiling ⇒ 計數停在 `0` ⇒ **不告警**。
   **死掉的 sweeper,在正好用來報告它的那個計數器上產生沉默。**
2. 告警與被監控者**共用同一支 migration / wrapper / vault secret**(`20260723120000…:128-133`)。
**今天為何還好**:sweeper 死了也沒有真錢卡住。
**上線那天為何嚴重**:sweeper 是「最終結算保證」。它靜默死掉 = **客人付了款、單沒標已付,而沒有人會知道**。

**怎麼驗它已補齊**:心跳表甲′(單列三值 `last_success_at` / `last_failure_at` / `consecutive_failures`)落地後,
**把 sweeper 停掉一輪,心跳表必須看得出來** —— 停掉那一輪與正常那一輪要印不同的值。
⚠️ 「Sean 的每小時雲端巡邏 routine 與被監控者零共用基礎設施」是**主視窗轉述,我未親讀 ⇒ 未確認**。**這條在驗收時要自己讀一次。**
📄 `docs/specs/2026-08-17-sweeper-heartbeat-plan.md`(Sean 2026-08-17 已批)/ `docs/phase-1-backlog.md` `#231`
🔴 落地時**把 `#231` ③ 一起收掉,不要開第二個真相**。

---

## ⑥ `settled` 寫入路徑**未被行使、未確認**

**口徑鐵線(逐字照抄,不要改寫)**:

> **掃描→認領→處理→退避全鏈已閉環;`settled` 寫入路徑【未被行使、未確認】。**

🔴 **不得寫成「3DS 結算兜底已驗證」** —— 那正是 Sean 最在意、而剛好沒走到的那一步。
**今天為何還好**:沒有真實結算要落地。
**上線那天為何嚴重**:那是**錢最後真的被記成「已付」的那一步**。前面全綠不代表這一步會動。

**怎麼驗它已補齊**:要有一筆**真的走到 `settled` 寫入**的紀錄,不是「前面幾步都過了所以它應該會過」。
📄 `docs/security/2026-08-17-section1-unverified-items-round2.md` §5-b / §5-c / §5-d

---


---

# 🔴 V 窗反向盤點併入(2026-08-17 夜;**canonical 是本檔,不要在別處開第二份**)

> 併入原則:V 窗的原字保留,**我方只補「四格」與排序**。
> ⚠️ 下面 `RB-2` 的旗標現值標著「**轉述、待親驗**」—— **Sean 給了值不等於已查證**,不要在併入時升級它。

## ⑦ 🔴🔴 `PCM_DEV_TIER_OVERRIDE` + `pcm-tier` cookie(🔴 **本檔最近的一條 —— 見檔頭優先序**)

**🔴 為什麼它排在 ① 前面的位置討論**:其他每一條的失效事件都是「**上線那天**」,
而這一條的失效事件是 **`M-2-08` 接真 tier-aware pricing 讀真 `price_store` 的那一刻**
—— 那是**我們自己排定的工作**,不是外部事件。⇒ **它比其他條都近。**

**成立條件(今天安全靠兩個前提【疊】著)**
```
(a) PCM_DEV_TIER_OVERRIDE production 預設關（apps/storefront/src/lib/tier.ts:48-52）
(b) 就算開了，read 路徑走 products_public view 物理排除 price_store，
    mapper 對 store/premiumStore 恆回 dummy 0（tier.ts JSDoc :30-38 自述）
```
🔴 **兩個前提裡只要 (b) 失效,(a) 就變成唯一防線,而 (a) 是一個環境變數。**

**附帶更硬的一格(我方當場複量,不是轉述)**
```
apps/storefront/src/lib/tier.ts:53
  const rawTier = tierOverride ?? cookieStore.get('pcm-tier')?.value ?? 'general';
:32 JSDoc 逐字「pcm-tier cookie 是 client 可偽造的
     （訪客自設 document.cookie='pcm-tier=store' 即被當經銷會員）」
:51 逐字「H-1(#215)…M-2-08 接真經銷價前須改為 server 端認證查 customers.tier。
     本行現狀未改、只釘樁。」
🔴 全樹零 server writer（數法:`git grep -n 'pcm-tier' apps/storefront/src | grep -i set` ⇒ 空,rc=1）
   ⇒ 沒有任何 server 端在寫這個 cookie ⇒ 它【只】會是 client 給的值
```

**今天為何還好**:讀不到真經銷價(前提 b);且沒有真實訂單。
**那天為何嚴重**:`tier.ts` JSDoc **自己標了升級後的嚴重度** ——「**一般會員偽造即得真經銷價**」。
這正是鐵則(經銷價絕不傳到一般會員瀏覽器)要守的東西。

**怎麼驗它已補齊(🔴 驗法是「換掉了沒」,不是「關掉了沒」)**
```
✅ 該驗:M-2-08 的 tier 解析有沒有換成【server 端 getUser() + 查 customers.tier】
❌ 不該驗:PCM_DEV_TIER_OVERRIDE 是不是關著
   —— 關著只證明今天沒開，不證明明天接真價格時這條路被堵上了
兩個世界會不同的值:帶 ?tier=store（或偽造 cookie）取回的 JSON 裡
   price_store 欄位是【不存在/0】還是【真價格】
```

## ⑧ 三個 cron 旗標的認證面(`RB-2`)

**V 窗量到的**:認證本身**扎實** —— `CRON_SECRET` Bearer + `timingSafeEqual` + `<32` 長度 fail-closed。
⚠️ **旗標現值(`ANOMALY_ALERT` / `CRON_SWEEPER` / `CHECKOUT_NOTIFICATION_EMAIL` 皆 `true`)
= Sean 回報 → 主視窗轉述 → 我方【未親眼看 Vercel 面板】⇒ 標「轉述,待親驗」。**
🔴 **不要因為 Sean 給了值就把這格寫成已查證。**
**還要對照的**:`CRON_SWEEPER_ENABLED=true` 要對上 **4a migration 是否已 apply**
—— 旗標開著而 migration 沒 apply,是另一個「兩個世界長得一樣」的組合。
**怎麼驗**:見 ⑤ 的心跳表 —— **心跳表落地後,旗標的真假由行為證明,不必再靠回報。**

## ⑨ `ADMIN_DEV_BYPASS`(`RB-3`)

**安全靠什麼**:🔴 **靠 `NODE_ENV !== 'production'` 前綴,不是靠「旗標沒設」。**
**我方當場複量(2/2 兩處都帶前綴)**:
```
apps/admin/src/lib/session/authorize.ts:18
apps/admin/src/proxy.ts:18
  process.env.NODE_ENV !== 'production' && process.env.ADMIN_DEV_BYPASS === '1'
數法:`git grep -n 'ADMIN_DEV_BYPASS' apps` ⇒ 兩處判定式，其餘為註解/測試
```
**怎麼驗它沒退化**:**守那個前綴不被拿掉**(不是守旗標的值)。
⇒ 這一條**適合做成守門測試**:`proxy.test.ts:27` 已有一格在擋測試環境外洩,**同型可擴到前綴本身**。

## ⑩ 🔴 已掃過、乾淨的三面(**列在這裡是為了下一個人分得出「掃過沒事」與「沒掃」**)

```
RB-Z1  anon / public GRANT           零命中（附分母與 pattern，見 V 窗原檔）
RB-Z2  對外 webhook 驗證              零命中
RB-Z3  規模上限                       零命中
```
🔴 **`RB-Z3` 的分類是這份清單的核心價值,原字保留**:
```
靠機制擋   refund / recovery 全套 —— 今天空庫也擋得住
靠沒資料   ORDER_ITEMS_EMBED_LIMIT = 200 —— 今天擋得住，【只因為今天沒資料】
```
⇒ **「靠沒資料」那一類,就是這份清單存在的理由** —— 它們在有資料的那天同時失效,
而 **repo 裡不會有任何東西變紅**。
📎 與 memory `project_0817-order-line-item-ceiling-is-200` 同一件事(Sean 業務事實:一張訂單品項可能到 200)
⇒ **`ORDER_ITEMS_EMBED_LIMIT = 200` 且判定用 `>=` ⇒ 正常業務上緣就是斷點**,不是未來風險。

---

## ⑪ 🔴 LINE cohort **目前零送達管道**(政策寫雙管道,這群人實際是零)

**成立條件**
```
Email  合成假信箱 ⇒ SupabaseEmailOutboxAdapter.ts:198 gate ⇒ status='skipped_no_real_email'
       ⇒ 不進 due、不呼 Resend（IEmailOutbox.ts:166 逐字「落表佔位但不進 due、不呼 Resend」）
簡訊    全樹零實作（V 窗量，字集 sms|簡訊|mitake|every8d|kotsms|twsms|三竹|twilio|nexmo|vonage；
        正向對照拿 resend 餵 ⇒ 命中 ResendEmailSenderAdapter.ts ⇒ 量具是活的）
LINE    推播機器存在但【收件人是 Sean 固定 userId、零 PII 告警格式】，不是客人管道
```
🔴 **而政策 `docs/patterns/pcm-specific.md:381` 寫的是「Line(主) + Email(fallback)」**
⇒ **政策寫雙管道,這群人實際是零管道。** 這是**政策與現實的落差**,不是實作 bug。

**今天為何還好**:沒有真實訂單 ⇒ 沒有出貨通知要送。
🔴 **上線那天為何嚴重**:Sean 已拍 `Q-C5`＝丙(**出貨單不印追蹤碼,只走簡訊／Email**)
⇒ **對這群人,紙上沒有、Email 沒有、LINE 沒有** ⇒ **他們拿不到追蹤碼,而我們不會知道。**

**怎麼驗它已補齊(兩個世界不同的值)**
```
拿一個 LINE cohort 測試帳號下一單並出貨：
  未補齊 ⇒ email_outbox 該列 status='skipped_no_real_email'，且無任何其他送達紀錄
  已補齊 ⇒ 有一筆【推播成功】紀錄（LINE push 2xx）或等價的送達證據
🔴 不可以用「後台顯示已通知」當驗法 —— 那是我們自己寫的字，不是送達。
```
📄 規格:`docs/specs/2026-08-17-line-push-to-customers-feasibility-spec.md`

> 🔴🔴 **更正(2026-08-17 深夜)。原文照留:**
> 「🔴 該規格 §2-b 有一個**硬 blocker**:LINE Login 的 `sub` 與 Messaging API 的 userId
> **是否同一命名空間**(取決於兩個 channel 在不在同一 Provider)⇒ **未確認,且我讀不到 Console。**」
> **那個 blocker 判錯了,而真正的更硬。** 依據＝Sean 2026-08-17 B8 逐字:
> 「登入網站跟加入line 好友是不同東西…除非客人有先發訊息給官方帳號過,不然永遠不知道客人line id」

🔴 **真正的 blocker**:我們手上的是 **Login 的 `sub`**,**不是可推播的 Messaging userId** ——
**那是兩個不同的東西,不是同一個值的兩種寫法。**
```
真正的前提鏈:客人點網站上的 LINE 連結 → 加官方帳號好友 → 主動發一則訊息
             → 我們才拿得到那個人的可推播 id
```
⇒ 🔴 **就算兩個 channel 同 Provider 也救不了這條路** ——
   缺的不是命名空間對得上,是**那個人從來沒把自己交給官方帳號**。
⇒ 🔴 **本條(⑪ LINE cohort 零送達管道)的嚴重度不變、但【修法方向整個換掉】**:
   原本以為是「確認一個設定」,實際是「**要客人做三個動作**」的產品/轉換率工程。
⇒ ⚠️ **可推播人數 = 未量,且很可能是 0**(沒有人被要求做過那三個動作)。

---

## ⑫ 🔴 LINE channel access token 的爆炸半徑(**不是資料外洩,是冒名發訊**)

**成立條件**:單一 channel access token,server-only(`LineAlertNotifierAdapter.ts:16` `import 'server-only'`)。
✅ **現在就做對的一格**:錯誤訊息明文規定不含 token(`:55` 逐字「絕不含 token / 對象 id」)。

🔴 **洩漏後可做什麼**:以**官方帳號身分**對任何已加好友的用戶推播
⇒ **爆炸半徑 = 我們全部的 LINE 客人,而且是以我們的名義**。
⇒ **釣魚訊息掛我們的官方帳號發出去,客人無法分辨。**
**今天為何還好**:目前只推給 Sean 自己,且客人推播尚未實作。
**上線那天為何嚴重**:客人推播一上線,這個 token 就從「告警管道」變成「對全體客戶的發話權」。

**怎麼驗它已補齊**
```
① token 存放位置與權限（我未讀 env、也不該讀）⇒ 要有權限的人回答
② 有沒有輪換程序，以及【輪換後舊 token 是否立即失效】
   🔴 兩個世界不同的值:拿舊 token 打一發 push ⇒ 已輪換應回 401，仍回 2xx 就是沒失效
③ 🔴 洩漏偵測:官方帳號有沒有「非我方伺服器發出的推播」的可見性？
   —— 這一格我方判斷【做不到】(LINE 不提供發送來源 IP 稽核) ⇒ **未確認,需查官方文件**
```
⚠️ ③ 標「我方判斷、未查證」——**不要當成已確認的限制。**

---

## ⑬ 這份清單**不查**什麼(落地時就寫,不是事後補)

```
· 前端 XSS / CSRF          —— 未查，不在本清單分母
· 依賴鏈漏洞（package-lock）—— 未查
· Edge Functions / 第三方整合 —— 未查
· 業務邏輯正確性            —— 不是本窗職責
```
⇒ **上面四類今天是「沒查過」,不是「查過沒事」。** 上線前要有人把它們接走,
否則這份清單全部打勾的那天,會被讀成「安全都確認了」——**而那句話會是假的。**

---

## ⑭ 維護

- 每加一條:**四格寫齊**(成立條件 / 今天為何還好 / 上線那天為何嚴重 / 怎麼驗它已補齊)。
- 🔴 **打勾要附證據**(命令 + 看到的輸出),不是把 `[ ]` 改成 `[x]`。
- 🔴 **不要在這份檔裡寫「已接受風險」** —— 寫「這條路仍開著,成立條件是 …」,讓下一個人自己判。
