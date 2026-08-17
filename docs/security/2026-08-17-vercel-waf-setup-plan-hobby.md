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
- **graduate(觀察後)**:把 Then 從 Log 改成 **429**(回「太多請求」),不要用 Deny(429 對這支比較誠實,app 本來就會 fail-safe 成「不顯示件數」)。

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

---

## #607 / #5 重估(用今天的實際讀數)

- **#607(型錄端點全域節流)**:**升級為量到的**。原本是「委派 Vercel WAF、repo 內驗不到」;現在 Sean 讀出 **firewall 整個沒開、Custom Rules = 0** ⇒ **那個被委派的對象【不存在】** ⇒ tappay-notify / facet-counts **確實沒有任何全域限流**,只剩 per-process `MAX_CONCURRENT_FANOUTS=3`(平台多開實例即失效)。這正是「份量在結構不在數字」的兌現,而現在連「有沒有」都量到了。**修法=上面規則 1(Hobby 唯一那條 rate-limit)。**
- **#5(tappay-notify,金流)** —— 🔴 **正本在 `section1-unverified-items-round2` §5,本檔只留一行摘要**(避免兩處狀態分岔):`TAPPAY_3DS_ENABLED=true`(prod,違反 `route.ts:17-18` 設計不變量)+ `CRON_SWEEPER_ENABLED` 在 prod **不存在**(a4 Vercel CLI `vercel env ls production`,分母 39)⇒ 結算兜底 `settle-sweep` 200 no-op(`route.ts:105` 預設 false)⇒ **雙分支窮舉:pg_cron 活不活都是「沒掃描」** ⇒ 3DS 付款缺最終結算保證。**等級 HIGH-結構(頻率未量、不拉滿)**;修法=排 sweeper(設 `CRON_SWEEPER_ENABLED='true'`)或關 `TAPPAY_3DS_ENABLED`,拍板題。**WAF 規則 2(只 Log)不解決它。**(我早先誤查 `vercel.json` 當分母,已在 §5 正本留痕改正 —— 排程器 2026-07-23 已搬 pg_cron。)

## 口徑

Hobby 上限與功能可用性量自 **Vercel 官方文件**(URL 附於各處,2026-08-17 查證);firewall 現況量自 **Sean 2026-08-17 Dashboard 讀出**。**我們不替 Sean 點 firewall**(平台設定、鐵則 12④);每條規則附「你點完我們從外面驗」但 WAF 驗法打的是 app 端點、不是我手上的 Supabase anon key。
