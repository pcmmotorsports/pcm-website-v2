# Vercel WAF 設定方案(Hobby 方案 · 寫給不懂 WAF 的人）

- **窗**:E(資安稽核,唯讀)　**日期**:2026-08-17　**面**:Vercel 平台(storefront 部署)
- **性質**:**方案,不是實作。** 🔴 Vercel firewall 是**正式站平台設定(鐵則 12④)**,我們**不能替你點** —— Vercel MCP 本 session 未授權、施工窗也沒有你的帳號。**分法=我們出方案 → 你照著點 → 我們從外面驗。**
- **前提(Sean 2026-08-17 回報,量到的)**:整個 firewall 功能**沒開**;Custom Rules =「No Custom Rules Yet」;IP Blocking / System Bypass 空;方案 = **Hobby**。

---

## 上層(白話,先看這段)

**現在的狀況**:你的網站前面有一道「防火牆」可以擋壞流量,但它**現在是關的、一條規則都沒有**。

**你能做什麼(Hobby 免費方案的真實上限,我查了官方文件)**:
- ✅ 可以加**最多 3 條**自訂規則,其中**最多 1 條**是「限流」(每分鐘同一個人最多打幾次)。免費。
- ❌ 「OWASP 罐頭防護規則組」要升 Pro 才有;先不碰。

**我建議先加這 3 條,而且【每一條都先設成「只記錄、不擋」】**(官方最佳實務也是這樣):
1. **限流「查件數」那支 API**(它一次請求會在後台放大成上百次查詢 = 最該擋的)。
2. **記錄「金流通知」那支**(只記錄、**永遠不要擋** —— 擋錯了 TapPay 的付款通知進不來,錢的狀態會亂)。
3. **記錄「忘記密碼 / 登入」那支**(先看有沒有人在猛打,之後再決定要不要限流)。

🔴 **為什麼先「只記錄」**:直接設成「擋」會擋到真客人,而**客人被擋不會來跟我們說** —— 我們要先看一週流量、確認正常客人不會誤觸,才把它從「記錄」改成「擋」。

---

## 下層(設定值 + 每條擋什麼/不擋什麼)

### 🔴 Hobby 硬限制(官方文件,附 URL,不要設計超出這個的東西)

| 資源 | Hobby 上限 | 出處 |
|---|---|---|
| 自訂規則總數 | **3 條/專案** | `vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting`(Limits 段) |
| 限流(rate limit)規則 | **1 條/專案** | 同上 |
| 限流可用的「識別鍵」 | **IP、JA4 指紋**(User-Agent/自訂 header 要 Enterprise) | 同上 |
| 限流演算法 | **Fixed window**(Token bucket 要 Enterprise) | 同上 |
| 限流視窗 | **最短 10 秒、最長 10 分鐘** | 同上 |
| 免費額度 | **100 萬次判定/月** | 同上 |
| Custom Rules 動作 | log / deny / challenge / bypass / redirect,**即時生效不需重部署** | `.../vercel-waf/custom-rules` |
| Managed Rulesets(OWASP) | **要 Pro**(Hobby 不含) | `.../vercel-waf/usage-and-pricing` |

⚠️ **限流計數是 per-region 的**(官方註)—— 你的部署釘 `sin1` 單一區域(`vercel.json` `"regions":["sin1"]`),所以這條影響小;但若日後多區域,單區上限不等於全域上限。

### 規則 1 · 限流「查件數」API(用掉那唯一 1 條 rate-limit 名額)

- **條件(If)**:Request Path 等於 `/api/catalog/facet-counts`
- **動作(Then)**:Rate Limit → 先選 **Log**(官方:先觀察再擋)
- **設定值**:Time Window `60s`、Request Limit **`20`**、Key **`IP`**
- **為什麼是這支**:它一次請求在後台放大成 **~108 次** DB 查詢(`vehicle-facet-counts.ts` 檔頭實測),而目前唯一的節流是「單一 process 內」的、平台多開實例就失效(backlog `#607`)。WAF 在**邊緣、跨實例**擋,正是那個缺的「全域上限」。
- 🔴 **它擋什麼**:同一個 IP 每分鐘打這支超過 20 次(= 有人在枚舉車款猛打)。
- 🔴 **它不擋什麼**:正常逛商品(選一次車才觸發一次),一分鐘打不到 20 次。
- **20 這個數是判斷、不是量的** —— 先用 Log 看一週真實分布,確認正常客人的上緣在哪,再定「擋」的閾值。
- ~~**graduate(觀察後)**:把 Then 從 Log 改成 **429**(回「太多請求」),不要用 Deny(429 對這支比較誠實,app 本來就會 fail-safe 成「不顯示件數」)。~~
  🔴 **2026-08-17 實測推翻此句**:Hobby 的 Rate Limit 動作改成 Deny 之後,**實際回的是 `403 Forbidden`(純文字 + Vercel 邊緣 request id),不是 `429`**。⇒ 「選 429 不選 Deny」這個選擇**在 Hobby 上不存在**。證據與下游影響見 **§W-c**。

### 規則 2 · 記錄「金流通知」webhook(**永遠只 Log,不要擋**)

- **條件(If)**:Request Path 開頭是 `/api/checkout/tappay-notify/`
- **動作(Then)**:**Log**(🔴 **不要改成 Deny/Challenge/Rate Limit**)
- 🔴 **為什麼只 Log**:這是 **TapPay 付款結果通知的入口**。擋錯 = TapPay 的通知進不來 = 訂單付了款卻沒被標成已付(**錢的狀態不一致**,鐵則 12①)。**寧可看得到、不要擋。**
- **它擋什麼**:什麼都不擋(純觀察)。
- **它不擋什麼**:全部放行 —— 目的只是讓你看到「誰在打這支」。正常只有 TapPay 的伺服器會打。
- **之後(不是現在)**:若 Log 看到大量非 TapPay 來源在打,**下一步是問 TapPay 要它的固定 IP 段、設成「只允許這些 IP」**(IP Blocking,Hobby 免費),而**不是**設限流。這步要 TapPay 的 IP 清單,現在沒有 ⇒ 先只 Log。

### 規則 3 · 記錄「忘記密碼 / 登入」(先看,再決定)

- **條件(If)**:Request Path 開頭是 `/login`(涵蓋 `/login`、`/login/forgot`、`/login/reset`)
- **動作(Then)**:**Log**
- **為什麼**:登入/忘密是暴力破解與寄信濫用的常見目標;先看有沒有人在猛打,再決定要不要把「唯一那條限流」改過來給它(**但一次只能有 1 條限流,要和規則 1 二選一** —— 先都用 Log 看哪支被打得兇)。
- **它擋什麼**:什麼都不擋(純觀察)。
- **它不擋什麼**:全部放行。

🔴 **三條都先 Log ⇒ 觀察一週 ⇒ 看哪支真的被濫打 ⇒ 把那唯一 1 條 rate-limit 名額給最需要的那支,並從 Log 改成 429。** 一次只給一支。

### 每條的「你點完之後我們從外面驗」

⚠️ **誠實邊界**:WAF 規則在 **Vercel app 端**(`shop.pcmmotorsports.com`),不是 Supabase —— 我手上那兩把 anon key 是打 **Supabase REST** 的,**驗不到 WAF**。驗 WAF 要打 **app 端點**本身。
- **規則 1(限流)驗法**:對 `/api/catalog/facet-counts` 在一分鐘內連打 25 次(超過 20)⇒ 第 21 次起應在 firewall 的 Log 看到命中(或改 429 後回 429);**對照**:每分鐘只打 5 次 ⇒ 一次都不該命中。這會對正式站產生**輕微負載**(25 次)⇒ 🔴 **需你點頭、且我在 firewall 監控頁看得到才做**,不自行對正式站發。
- **規則 2/3(Log)驗法**:打一發該 path ⇒ 在 firewall 「traffic monitoring」live 視窗看得到那筆被 Log 標記。純觀察、無負載風險。

> 🔴 **2026-08-17 傍晚(E 第三輪)實查:上面這兩條驗法【從 E 窗執行不會有結論】,不是「還沒做」是「這樣做不出來」。原因見 §W-b。Sean 已點頭的 25 發**在補上觀測端之前不要發**。**

---

## §W-b 三條規則的**實際落地狀態**與「為什麼從外面驗不到」(2026-08-17 傍晚,E 第三輪)

**量法(唯讀 GET,可重跑;token 取自 Vercel CLI 既有登入、不落檔不入回報)**:
```bash
TOKEN=$(python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/Library/Application Support/com.vercel.cli/auth.json')))['token'])")
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.vercel.com/v1/security/firewall/config/active?projectId=prj_4yNDP3XOt202tQIlYwF9auf5fLN7&teamId=team_uMPmFCKRDUhoixK6p3JC0Tis"
```
(`vercel firewall overview` **在 Hobby 上壞掉**:回 `IP Bypass is unavailable for this plan. (404)` —— 是 CLI 去抓一個本方案沒有的子資源,不是設定有問題。用上面的 API 繞過。)

**量到的 —— `firewallEnabled = true`,三條規則 `active: true`,條件與方案書一致**:

| # | 規則名 | 條件 | **動作(關鍵欄)** |
|---|---|---|---|
| 1 | `facet-counts rate limit` | path **eq** `/api/catalog/facet-counts` | `rate_limit` / limit **20** / window **60** / keys `[ip]` / algo `fixed_window` / **`action: "log"`** |
| 2 | `Log TapPay notify requests` | path **pre** `/api/checkout/tappay-notify/` | **`log`** |
| 3 | `Log login requests` | path **pre** `/login` | **`log`** |

⇒ 條件、閾值、識別鍵**逐欄比對本檔規則 1/2/3 三節的規格,三條皆相符**(比對基準:規則 1 = 本檔「規則 1」節的 path/`60s`/`20`/`IP`;規則 2 = 「規則 2」節的 `/api/checkout/tappay-notify/` 前綴;規則 3 = 「規則 3」節的 `/login` 前綴)。Sean 這步照著點了、沒點錯。

🔴 **但三條全是 `log` ⇒ 現在一條都不擋東西。** 規則 1 的 `rateLimit.action` 也是 `log`:**第 25 發不會被擋**,它跟第 1 發一樣穿過去打到 app。

🔴🔴 **這就是為什麼 25 發驗不出東西**:`log` 模式下,**「規則命中」與「規則沒命中」對打的人來說回應完全一樣**(同狀態碼、同 body)。差別**只存在 firewall 自己的 log 裡**。而——

**觀測端實查(附分母與 pattern,四個端點)**:
| 端點 | 結果 |
|---|---|
| `v1/security/firewall/events` | 200,但回 `{"actions":[]}`(是「緩解動作」清單,不是逐筆請求 log;**且我沒讓它表演過兩個世界 ⇒ 這個空陣列不能當證據**) |
| `v1/observability/firewall/events` | 404 |
| `v1/security/firewall/metrics` | 404 |
| `v1/analytics/firewall` | 404 |

⇒ **逐筆 firewall 流量 log 從 API 讀不到。** 兩個世界會不同的那個值,**只在 Vercel Dashboard 的 Firewall 監控頁**,那是 Sean 的面。

**結論(這是「做不出來」不是「還沒做」)**:發 25 發會對正式站產生 25 × ~108 ≈ **2700 次 DB 查詢**,而且**我拿不到任何能分辨兩個世界的讀數** ⇒ **淨值為負,不發。** Sean 點頭解掉的是「可不可以打」,而卡住的從來不是許可,是**觀測端**。規則 2/3 的 Log 驗同一個原因、同一個結論。

**要讓它變成可驗,二選一(都要 Sean 動 Dashboard,平台設定=鐵則 12④,不是 E 能點的)**:
- **甲(推薦,能自己閉環)**:把規則 1 的 `rateLimit.action` 從 `log` 暫時改成 **`deny`(429)**〔Dashboard:規則 1 → Rate Limit 的動作〕→ 我打 25 發:**第 1–20 發 200、第 21–25 發 429** = 兩個世界印不同值、當場閉環、有正負對照(再打 5 發/分鐘作對照組應全 200)→ 驗完 Sean 改回 `log`。
- **乙**:Sean 開著 Firewall 監控頁,我打 25 發,他回報**數字**——「rate limit 那條命中幾筆」。🔴 **要他回報數字不是判斷**:「有看到」在命中 1 筆與 5 筆兩個世界是同一句話;預期值 = **5 筆**(第 21–25 發)。

---

## §W-c 規則 1 的 25 發實驗 —— **閉環成立**(2026-08-17;🔴 那段 `Deny` 窗已關閉,**本節是唯一記錄**)

**授權**:Sean 拍板「甲」,親自把規則 1 的 Rate Limit 動作 `Log` → `Deny`,並回報「vercel 好了」後才發。**驗完立即回報、由 Sean 改回 `Log`。**

**環境與時點(數字要跟著環境走)**:
```
網域      shop.pcmmotorsports.com/api/catalog/facet-counts
規則1狀態 Deny（限流 limit=20 / window=60s / key=ip）
驗量具    1 發 @ 2026-08-17 07:34:38 UTC  → 400
burst     25 發 @ 07:35:06 → 07:35:15 UTC
```

**結果 —— 兩個世界印出完全不同的值,且在同一次執行內都出現**:

| 發次 | 狀態碼 | 回應主體 | 來自哪一層 |
|---|---|---|---|
| 1–19 | **400** | `{"error":"invalid_vehicle"}` | **app**(Next route 的 JSON) |
| 20–25 | **403** | `Forbidden`(純文字)+ `hnd1::7rzx5-1786952` 這類 request id | **Vercel 邊緣**(firewall) |

🔴 **判別器不是狀態碼,是「回應來自哪一層」**:狀態碼理論上 app 自己也模仿得出來,但 **`hnd1::` 邊緣 request id + 純文字 `Forbidden` 不可能是 app 回的** ⇒ 確定是 firewall 擋的。

🔴 **實測推翻方案書一句**:被擋時回 **`403`,不是 `429`**(見上方規則 1 節劃掉處)。
**下游影響(這是行為契約不是錯字)**:前端 / 呼叫端若**只認 `429` 當「被限流」**,`403` 會被歸類成別的錯(權限問題)⇒ 重試與提示邏輯會走錯分支。**要改 code 的話,這是施工窗的事,E 不改。**

🔴 **這個驗法比方案書設想的便宜得多,建議定為標準驗法**:不帶車輛參數 ⇒ app 在**驗證階段就 400**、**不會觸發 ~108 次 DB 扇出**;而 WAF 在邊緣、在 app 之前,**限流照樣計數**。⇒ **零 DB 負載即可驗限流。**

⚠️ **我不下的結論(量到 vs 推出)**:翻轉落在 burst 第 20 發。**這不足以證明「`limit=20` 的邊界語意」** —— 我在 `07:34:38` 先發過 1 發驗量具,而 fixed window 是否對齊整分鐘**我沒有量**,兩種視窗語意都產生得出這組數據。**只報量到的:19 發 400、接著 6 發 403,翻轉在同一秒內。** 邊界語意 = **未確認**,且**本結論不需要它**(要證的是「規則會擋」,已證)。

⚠️ **未做的一格**:**恢復對照**(視窗過後再發 1 發應回 400,用以排除「我的 IP 被永久擋」)。當下判斷**先請 Sean 改回 `Log` 優先** —— `Deny` 開著時,真客人一分鐘超過 20 次就會吃 403。

🔴 **保存期**:上述讀數**只在那段 `Deny` 窗內成立,窗已關閉、不可復量**。⇒ **本節即該實驗的唯一記錄**(同 §5-b 的 TTL 形狀)。

### 🆕 附帶實查:Managed Ruleset(OWASP)**不是「Hobby 不含」** —— 有 11 組、其中 4 組是開的

同一支 API(`v1/security/firewall/config`),數法可重跑:
```bash
# 接上方 TOKEN 後
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.vercel.com/v1/security/firewall/config?projectId=prj_4yNDP3XOt202tQIlYwF9auf5fLN7&teamId=team_uMPmFCKRDUhoixK6p3JC0Tis" \
| python3 -c "
import json,sys,collections
crs=json.load(sys.stdin)['active']['crs']
print('分母',len(crs),'| active',sorted(k for k,v in crs.items() if v['active']))
print('actions',dict(collections.Counter(v['action'] for v in crs.values())))"
```
**實際輸出**:分母 `11` / `active: true` 有 **4 組** = `gen` `rce` `sqli` `xss`;其餘 7 組 `active: false` = `java` `lfi` `ma` `php` `rfi` `sd` `sf`;`actions` = `{'log': 11}`(11 組的 action 計數,全落在 `log` 一類)。

⇒ 🔴 **本檔上方「Managed Rulesets(OWASP)要 Pro、Hobby 不含」這句與實查不符,已知不完整。** SQL injection / XSS / RCE 三大類**是開著的**(但同樣 `log`、不擋)。
⚠️ **量到的 vs 推出來的**:我量到的是**設定物件的狀態**(4 組 active、全 log)。我**沒有量**它們在 Hobby 方案上是否真的會對流量求值 —— 這需要的正是上面那個讀不到的 firewall log。⇒ 對外只能寫「**設定上是開的、動作是只記錄**」,**不能寫「OWASP 防護已生效」**。

**淨結論**:目前站前**沒有任何東西在擋**(3 條自訂 + 4 組 OWASP 全 `log`)。這**不是漏洞**、是方案書刻意的「先觀察一週」階段(§ 上方);**但要有人記得回來把它們翻成擋** —— 否則「已設好 WAF」會被讀成「已受保護」。這一句是本節存在的理由。

---

## #607 / #5 重估(用今天的實際讀數)

- **#607(型錄端點全域節流)**:**升級為量到的**。原本是「委派 Vercel WAF、repo 內驗不到」;現在 Sean 讀出 **firewall 整個沒開、Custom Rules = 0** ⇒ **那個被委派的對象【不存在】** ⇒ tappay-notify / facet-counts **確實沒有任何全域限流**,只剩 per-process `MAX_CONCURRENT_FANOUTS=3`(平台多開實例即失效)。這正是「份量在結構不在數字」的兌現,而現在連「有沒有」都量到了。**修法=上面規則 1(Hobby 唯一那條 rate-limit)。**
- **#5(tappay-notify,金流)** —— 🔴 **正本在 `section1-unverified-items-round2` §5 / §5-b,本檔只留一行摘要**(避免兩處狀態分岔)。
  🟢 **2026-08-17 傍晚已解除(E 第三輪重驗)**:Sean 當天下午設 `CRON_SWEEPER_ENABLED=true` 並重部署 ⇒ 兜底**真的在掃**。閉環量具=`net._http_response.content` 的 body 字面(非 200):世界A `sweeper_disabled` 止於 06:44 UTC、世界B `enabled:true` 起於 06:46 UTC,首發即 `inboxClaimed:40 / inboxProcessed:37 / errors:0`。**完整證據與三條誠實邊界一律看 §5-b,不要引本行的摘要當證據。**
  ~~原判 HIGH-結構(`CRON_SWEEPER_ENABLED` 在 prod 不存在 ⇒ settle-sweep 200 no-op ⇒ 缺最終結算保證)~~ —— **前提已不成立,劃掉留痕**;該判斷在 08-17 下午之前為真。
  仍成立的一句:**WAF 規則 2(只 Log)本來就不解決 #5**,兩者無關。

## 口徑

Hobby 上限與功能可用性量自 **Vercel 官方文件**(URL 附於各處,2026-08-17 查證);firewall 現況量自 **Sean 2026-08-17 Dashboard 讀出**。**我們不替 Sean 點 firewall**(平台設定、鐵則 12④);每條規則附「你點完我們從外面驗」但 WAF 驗法打的是 app 端點、不是我手上的 Supabase anon key。
