# 旗標清單:哪些「做完的功能」現在是關著的(2026-08-19 03:3x CST,G3)

> **為什麼有這一份**:走完 12 站之後浮出一個形狀 ——
> **至少三個已經寫完的功能被旗標關著,而畫面上看起來就是「沒做」。**
> 而對 Sean,「還沒做」與「做完了但沒開」**剩餘工時差一個數量級**。
>
> 🔴 **這一份只有左邊幾欄。最右邊那欄(正式站現在是開是關)只有他看得到。**

## 效度限定

```
量的是   repo 工作樹(HEAD 附近)+ 本機兩支 .env.local 的【鍵存在與否】(只數行、不印值)
時間     2026-08-19 03:30–03:38 CST(`date` 實跑)
🔴 沒有量到 正式站(Vercel Production)的任何一個值 —— 那需要面板,在 Sean 手上
掃法     `grep -rhoE "process\\.env\\.[A-Z0-9_]+ === '(1|true)'" apps/*/src packages/*/src`
         + 以 `ENABLED|FLAG|_ON` 再掃一次(兩個詞表的聯集)
⚠️ **分母限定**:這是【這兩個 pattern 掃得到的】旗標。
   寫成別的形狀(`!== 'false'`、讀進物件、從 DB 讀)的開關**掃不到** ⇒ 這張表是**下界,不是全集**。
```

---

# 🔴 第一件事:**這些旗標不共用同一個約定**

| 旗標 | 它認的字面 | 打錯會怎樣 |
|---|---|---|
| `AUDIT_UI_ENABLED` | **`1`** | 設成 `true` ⇒ **靜默無效** |
| `REFUND_UI_ENABLED` | **`1`** | 設成 `true` ⇒ **靜默無效** |
| `TAPPAY_3DS_ENABLED` | **`true`** | 設成 `1` ⇒ **靜默無效** |
| `CHECKOUT_NOTIFICATION_EMAIL_ENABLED` | **`true`** | 設成 `1` ⇒ **靜默無效** |
| `ANOMALY_ALERT_ENABLED` | **`true`** | 同上 |
| `CRON_SWEEPER_ENABLED` | **`true`** | 同上 |

```
出處(逐支開檔):
  apps/admin/src/lib/audit/audit-ui-flag.ts:29-30            === '1'
  apps/admin/src/lib/payment/refund-ui-flag.ts:22            === '1'
  apps/storefront/src/lib/payment/three-ds-flag.ts:30        === 'true'
  apps/storefront/src/lib/email/notification-email-gate.ts:7 === 'true'
  apps/storefront/src/app/api/cron/anomaly-alert/route.ts:113  !== 'true'
  apps/storefront/src/app/api/cron/settle-sweep/route.ts       !== 'true'(同款寫法)
```
🔴 **兩種約定混用,而打錯的症狀是【什麼都沒發生】** ——
沒有錯誤、沒有紅、沒有 log。**設定的人會以為自己開了。**

---

# 第二件事:表

| 旗標 | 它關掉的東西 | 本機有沒有設 | 在 `turbo.json` build env 白名單裡? | 正式站 |
|---|---|---|---|---|
| `AUDIT_UI_ENABLED` | **稽核紀錄整頁**(`/settings/audit` ⇒ 404)+ 側欄那一項 | ❌ 兩支都 0 | 🔴 **不在** | **Sean 填** |
| `REFUND_UI_ENABLED` | **訂單頁的退款區塊**(整塊不渲染) | ❌ 兩支都 0 | 🔴 **不在** | **Sean 填** |
| `CHECKOUT_NOTIFICATION_EMAIL_ENABLED` | 結帳通知信的四層契約(UI/client/schema) | ❌ 兩支都 0 | 🔴 **不在** | **Sean 填** |
| `TAPPAY_3DS_ENABLED` | 結帳走 3DS 那條路 | ✅ storefront 有 | ✅ 在 | **Sean 填**(見下) |
| `ANOMALY_ALERT_ENABLED` | 雙扣告警 cron(關 ⇒ 200 no-op) | ✅ storefront 有 | ✅ 在 | **Sean 填** |
| `CRON_SWEEPER_ENABLED` | settle-sweep cron(關 ⇒ 200 no-op) | ❌ 0 | ✅ 在 | **Sean 填** |
| `PCM_DEV_TIER_OVERRIDE` | 開發用的會員等級覆寫 | ❌ 0 | ✅ 在 | 開發用,正式站應為關 |
| `ADMIN_DEV_BYPASS` | **後台登入閘(只在非 production 生效)** | 我開著才進得去後台 | 不需要 | 只在 dev 有效 |

## 已經寫完、而被關著的三個(這是本份的重點)
```
稽核頁    apps/admin/src/app/settings/audit/page.tsx  9,065 bytes + page.test.tsx 9,140 bytes
          ⇒ 頁與測試都寫完了,而 /settings/audit 是 404
退款區塊  RefundSection + 六道 refund-entry-gate.ts:41-51 都寫完了,而訂單頁上沒有那一塊
結帳通知信 四層契約寫完了(gate 檔自陳「只有明確字面 true 才同步打開」)
```
⇒ **它們在畫面上與「還沒做」長得一模一樣。**

---

# 🔴 第三件事:三個旗標**不在 `turbo.json` 的 build env 白名單裡**

```
turbo.json 的形狀:頂層只有 $schema 與 tasks;沒有 globalEnv;
  tasks.build.env 共 26 個(清單可重跑:
  `python3 -c "import json,io;print('\\n'.join(sorted(json.load(io.open('turbo.json'))['tasks']['build']['env'])))"`)
而 AUDIT_UI_ENABLED / REFUND_UI_ENABLED / CHECKOUT_NOTIFICATION_EMAIL_ENABLED **都不在那 26 個裡**
```

## ⚠️ 而我**不宣稱這一定會壞** —— 條件寫清楚,讓下一個人自己判

```
✅ 我查到的:那兩頁都是 `export const dynamic = 'force-dynamic'`
   (apps/admin/src/app/settings/audit/page.tsx、apps/admin/src/app/orders/[id]/page.tsx)
   ⇒ 旗標是【runtime】讀的,而 runtime 的 env 在 Vercel 上是平台直接給的,不經過 turbo
   ⇒ **就這兩頁而言,少列大概不會讓它讀不到值**
🔴 而我也查到一個【同款事故真的發生過】的前例:
   PROGRESS.md(2026-07-02 那筆)逐字:「① `turbo.json` 缺 `env` 白名單 → Turbo 2.x strict 擋 server env(commit `718cd8a`)」
   ⇒ **這一類真的擋過一次正式站。**
⚠️ 另一個仍然成立的成本(與 runtime 無關):turbo 的 `env` 也是**快取雜湊**的輸入 ——
   沒列進去 ⇒ 改那個旗標**不會讓 build 快取失效**。
```
**⇒ 我的建議(而它便宜到不需要爭論)**:把那三個補進 `tasks.build.env`。
**⇒ 而更重要的是那句預測**:
```
🔴 Sean 在 Vercel 把 AUDIT_UI_ENABLED 設成 1 之後,若那一頁【仍然 404】,
   **第一個要看的就是這一格**(以及上面那個 '1' vs 'true' 的字面)。
```

---

# 🔴 第四件事:一個 code 自己寫著的坑(不是我發現的,是我讀到的)

`apps/admin/src/components/layout/app-sidebar.tsx:26-34` 檔頭逐字記著一次實測:
```
在 client component 裡呼叫旗標函式會拿到 `undefined`,
**不會報錯、不會紅,只會靜默把入口關掉** —— 症狀是「功能做完了但員工看不到」,而三綠全綠。
(實測:同一行在 client 產物編成 `t.default.env.AUDIT_UI_ENABLED`,server 產物編成 `process.env.…`
 ⇒ 瀏覽器端拿不到這個變數。)
```
⇒ 📌 **這正是本份要講的那件事,而它已經被寫在 code 裡了** ——
只是**沒有人把它整理成一張清單給決策的人看**。

---

# 這一份沒有答到的

```
1. 🔴 正式站每一個旗標現在是開是關 —— 需要 Vercel 面板,只有 Sean 看得到
2. 這張表是【下界】:只涵蓋兩個 grep pattern 掃得到的形狀
3. `TAPPAY_3DS_ENABLED` 在正式站的值:`STATUS.md:34` 自陳那是
   「Sean 本人回報 → 主視窗轉 → 落檔」,**沒有人親眼看過面板** ⇒ 二手,標未確認
4. 把三個旗標補進 turbo.json 之後會不會有別的影響 —— **我沒有改、沒有跑 build**(那要提 plan)
5. 有沒有「從 DB 讀」或「寫成別的形狀」的開關 —— 未掃
```
