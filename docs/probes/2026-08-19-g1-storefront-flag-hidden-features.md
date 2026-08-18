# 顧客站有沒有「寫完了而被旗標關著」的功能 —— 2026-08-19 G1

> 起因:另一個窗在**後台**找到至少三個(稽核紀錄頁 9,065 bytes + 測試都寫好 ⇒ 那頁 404;
> 退款入口功能 + 六道閘都寫好 ⇒ 按鈕不出現;結帳通知信四層契約)。
> 🔴 **而它們在畫面上與「還沒做」長得一模一樣。** ⇒ 顧客站有沒有同款,沒有人查過。
> **純讀。沒有動 `turbo.json`、沒有跑 build、沒有改任何旗標。**

## ⓪ 🔴 先講尺的洞(不要把這張表當全集)
```
我掃的字集:`process.env.<NAME>` 後接 `=== '1' | === 'true' | !== 'true' | !== 'false'`
           + env 名字含 ENABLED|FLAG|FEATURE|DISABLE|BYPASS|OVERRIDE
🔴 掃不到的（我【證明過它們今天不存在】，不是憑推測）:
   `!== 'false'`  ⇒ 0     `=== "true"`（雙引號）⇒ 0
   `Boolean(process.env…` ⇒ 0     `process.env[` （computed）⇒ 0     `flags.` ⇒ 0
🔴 而仍然掃不到、**也沒被證明不存在**的:從 **DB** 讀的開關、從 **設定物件** 讀的開關、
   在 **Vercel 面板** 上存在而 code 裡沒有對應字面的
⇒ **本表是下界。**
正向對照（尺是活的）:`process.env.` 在 `apps/storefront/src` 非測試檔 ⇒ **31 命中**
```

## ① 顧客站的旗標:**5 個**(分母見 ⓪ 的限定)

| 旗標 | 關掉什麼 | 客人看得見? | 寫完了嗎(判準=有沒有測試) | `turbo.json` build env 白名單 |
|---|---|---|---|---|
| `CHECKOUT_NOTIFICATION_EMAIL_ENABLED` | 結帳頁的「通知信箱」欄 + server 端 schema 選擇 | 🔴 **是**(結帳頁) | **像寫完了**:3 支引用檔,**其中 2 支是測試**(`checkout/page.test.tsx`、`notification-email-gate.test.ts`) | 🔴 **不在** |
| `TAPPAY_3DS_ENABLED` | 3DS live 路徑 | 🔴 **是**(刷卡) | 4 支引用檔 / 1 支測試。⚠️ **而檔頭自己寫「本片僅引入,charge-actions 分岔在 3DS-6 才消費」** ⇒ **不是「寫完被關著」,是「還沒接完」** | 在 |
| `CRON_SWEEPER_ENABLED` | 對帳掃描器 cron | 否(背景) | 5 支引用檔 / 1 支測試 | 在 |
| `ANOMALY_ALERT_ENABLED` | 異常告警 cron | 否(**收件人是我們自己人**) | 3 支引用檔 / 1 支測試 | 在 |
| `PCM_DEV_TIER_OVERRIDE` | 開發用會員等級覆寫 | 否(dev only) | 3 支引用檔 / 1 支測試 | — |

## ② 🔴 結論:**顧客站沒有「寫完了而被關著」的功能** —— 而理由要講清楚
```
唯一同時滿足【客人看得見】+【看起來寫完了】的是 `CHECKOUT_NOTIFICATION_EMAIL_ENABLED`
⚠️ 而它與後台那三個**不同**:後台那三個是【整頁 404 / 按鈕不出現】=功能整塊消失；
   這一個只是**結帳頁少一個欄位**（通知信箱），而**訂單信本身另有一條線在做**（B-4/B-5）
⇒ 我**不主張**它是「寫完被關著」——它比較像**還在滾動上線的一段**。
🔴 而 `TAPPAY_3DS_ENABLED` 檔頭逐字說「僅引入、3DS-6 才消費」⇒ **明確不是**那一族。
```
📌 **本表的正確讀法**:**在我掃得到的字集裡,顧客站沒有同款的「隱形完成品」。**
**不是**「顧客站沒有隱形完成品」—— 那兩句差一個限定,而限定要跟著這個結論走。

## ③ 主視窗要我順帶驗的那格:**`turbo.json` 白名單少一個,而影響為零**
```
後台窗的判斷:「那兩頁是 force-dynamic ⇒ 大概不影響」
🔴 我在 storefront 這邊【逐個開檔驗】那個判斷成不成立:
   `CHECKOUT_NOTIFICATION_EMAIL_ENABLED` 的消費端只有兩個
     apps/storefront/src/app/checkout/page.tsx:52     ⇒ `export const dynamic = 'force-dynamic'`（:37）
     apps/storefront/src/app/checkout/charge-actions.ts:133 ⇒ **server action**（本來就 runtime）
   ⇒ **沒有任何 SSG/ISR 頁讀這個旗標** ⇒ 那個判斷在 storefront 這邊【也成立】
```
⚠️ 而**它不是零代價**:`turbo.json` 的 `env` 管的是 **build 快取的失效**,不是 runtime 可用性
⇒ **改這個旗標不會讓 turbo 認為 build 需要重跑** —— 對 force-dynamic 消費端無害,
**而哪天有人在 SSG 頁讀它,那一刻它會安靜地送出舊值**。⇒ **值得補進白名單,而不急。**
🔴 **我沒有動 `turbo.json`**(那是鐵則 12④ 平台設定)。

## ④ 我沒做/沒查的
```
· 沒有讀正式站的 env 值 —— **正式站那一欄本表【留白】**（只有 Sean 看得到）
· 沒有跑 build、沒有改任何旗標
· 沒有查 Vercel 面板上有沒有 code 裡沒有字面的旗標
· 「寫完了嗎」的判準是【有沒有測試】—— 那是**代理指標**，不是「功能真的可用」
```
