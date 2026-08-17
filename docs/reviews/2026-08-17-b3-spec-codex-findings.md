# B3 規格 · Codex 對抗審查 findings(關卡1)

- **日期**:2026-08-17 00:2x(`date` 實跑 `2026-08-17 00:43:49 CST`;交叉源 `git log -1 --format=%ad` ⇒ `2026-08-17 00:25:42 +0800`)
- **審查對象**:`docs/specs/2026-08-16-m4b-e8b-b3-spec.md`(B3 = session payload 帶身分 `sub` + `v:2`)
- **審查者**:codex `gpt-5.6-sol` / `model_reasoning_effort=xhigh` / `-s read-only` / main session
- **核對基準**(codex 自報):`pcm-products` HEAD **`fba62d35`**;報價單 `origin/main` **`482bec5`**。全程唯讀。
- **verdict**:🔴 **FAIL — 21 條 must-fix、0 條 nit**
- **由來**:B3 規格 §7 誠實揭露第 3 條自陳「**本片尚未經對抗審查**」(動 auth ⇒ 鐵則 12②)⇒ B 窗送審。

> 🔴 **引用限定(先讀這段再引用任何一條)**
> ① 這是 **codex 獨立模型**輪次,**不是** Fable 讀碼複查 —— 與 `V-020` 是不同性質的證據,不要混用。
> ② 它審的是**規格**不是實作;規格改了不等於 code 對了。
> ③ **`0 條 nit` 不是「其餘都很好」** —— 我在 prompt 裡明文寫了「不設總條數上限、不要自己先過濾」,
>    而它回的條目**沒有一條標 nit**。這代表**它沒有進入挑細節的階段**,不代表細節沒問題。
>    數法(本檔內,可重跑):
>    `grep -c '\`must-fix\`' docs/reviews/2026-08-17-b3-spec-codex-findings.md` ⇒ **21**
>    `grep -c '\`nit\`'      docs/reviews/2026-08-17-b3-spec-codex-findings.md` ⇒ **0**
>    (同一支 grep 換個詞就有東西 ⇒ 那個 0 是量出來的,不是「我沒找到」。)

---

## 🔴 這份審查最該被看見的一條(不是編號第 1,是影響最大)

**`F-2` 指出 B3 規格的【範圍】超出了已批准的母 plan**:
規格把 B3 擴成「兩個 repo 的 session 型別」,而已批准的
`docs/specs/2026-08-16-m4b-e8b-real-auth-line-plan-v4.md:165-168` 把 **admin 收端放在 B5**。
⇒ **照這份規格施工會跨越 B4/B5 的 checkpoint。**

📎 為什麼把它拉到最前面:其他 20 條是「這個設計有洞」,**這一條是「這份設計不該由這一片做」**。
先折它,底下有好幾條(`F-10`/`F-13`/`F-14`/`F-15`)的歸屬會跟著變。

---

## FINDINGS(逐條原文,未改寫、未過濾)

### 拓樸與範圍

1. `b3-spec.md:83-103`;`PCM報價單-V2/app/api/sso/authorize/route.ts:48-64`;`apps/admin/src/app/api/sso/callback/route.ts:63-77`
   報價單 cookie 不會交給 admin validator;「新報價單＋舊 admin ⇒ v2 被硬拒」不會發生,整張混版表與部署順序建立在**錯誤拓樸**上。`must-fix`
2. `b3-spec.md:7`;`real-auth-line-plan-v4.md:165-168`
   規格把 B3 擴成兩個 repo 的 session 型別,但已批准母 plan 把 admin 收端放在 B5;照規格施工會跨越 B4/B5 checkpoint。`must-fix`
3. `b3-spec.md:87-103`;`PCM報價單-V2/middleware.ts:56-75`
   既有報價單 v1 cookie 送進新報價單 validator 的結果**沒寫**;接受時 sliding refresh 會保留 `v:1` 並持續延長,拒絕時則全員登出。`must-fix`

### 舊 actor cookie 與開關(這一族是「現況缺陷」不只是規格缺漏)

4. `b3-spec.md:94-100`;`authorize.ts:28-34`;`actor.ts:32-34`
   開關關閉＋v1 session＋既有 `pcm_admin_actor=sean` ⇒ session 沒有身分,卻由**另一顆自選 cookie** 補成 `actorId=sean` 並通過寫入。`must-fix`
5. `b3-spec.md:94-102`;`actor-actions.ts:27-35`
   v2 user／fallback 遇到舊 actor cookie 且開關關閉或 rollback ⇒ 稽核可能記成**先前自選的人**,fallback 也可能取得寫入能力;規格沒定清除與優先序。`must-fix`
12. `b3-spec.md:94-100`
   正式切換後若 `ADMIN_REQUIRE_REAL_IDENTITY` 遺失、拼錯或值無效,規格沒有 fail-closed 語意;**一次 env 漂移即可無聲恢復自選身分**。`must-fix`

### 未知 key / 型別混淆

6. `b3-spec.md:42-48,94-95`;`session.ts:107-117`
   合法簽章的 `{v:1,...,sub:{kind:'user',staff_id:'sean'}}` 仍會通過;下游若以 `sub` 是否存在判身分,就能把 **v1 升格成具名 session**。`must-fix`
7. `b3-spec.md:55-63` *(原文於審查輸出,與 8 同段落族)*  `must-fix`
8. `b3-spec.md:55-63`
   若 runtime 只驗已知欄,`{kind:'fallback',staff_id:'sean'}` 也可通過;任何以 `staff_id` 存在與否分流的消費端都可能把 **fallback 升格**,必須拒絕巢狀未知 key。`must-fix`

### 白名單歸屬 / 映射缺列

9. `b3-spec.md:65-66,114-116,144-155`
   驗收要求拒絕白名單外 `staff_id`,後文卻禁止 admin 持有白名單;施工者只能複製 DB CHECK 或無法完成驗收,**執行位置未定**。`must-fix`
10. `b3-spec.md:77-79`
   個人密碼驗證成功但映射查無／逾時 ⇒ 正確安全結果應是**登入失敗**;規格反稱登入失敗「不能接受」,卻未禁止改簽成 fallback 或採用 client 傳入的 `staff_id`。`must-fix`
11. `b3-spec.md:30-48,83-103`;`PCM報價單-V2/app/api/sso/exchange/route.ts:66-71`
   `v:2` 只版本化兩站各自的 cookie,**沒有版本化真正跨 repo 的 SSO response**;B4/B5 混版仍可忽略 `sub` 並靜默退回無身分語意。`must-fix`

### 🔴 「已經實作好了」那組宣稱被打掉(B 窗自己複驗時漏掉的那半)

13. `b3-spec.md:157-171`;`actor.ts:32-34`
   「B5 需要的東西已實作」**講大了**:目前 `resolveStaff()` 收到的是 `ACTOR_COOKIE`,v2 只有 `session.sub` 而無 actor cookie 時**仍解析不到人**。`must-fix`
14. `b3-spec.md:157-171`;`apps/admin/src/proxy.ts:38-50`
   已停用員工持有效 session 存取一般頁面 ⇒ proxy **只驗 HMAC session、完全沒跑 `resolveStaff()`**,所以「讀取閘已滿足」不成立。`must-fix`
15. `b3-spec.md:144-152,199-207`
   若讀取閘一律要求 `resolveStaff(sub.staff_id)`,fallback 因無 `staff_id` 而連唯讀都進不去;若跳過又沿用 actor cookie,則可能寫入,**規格缺 read/write 矩陣**。`must-fix`

### fail-closed 的兩個世界長得一樣

16. `b3-spec.md:194-207`;`staff-repository.ts:25-33`;`staff.ts:25-43`
   停用／查無、連錯空資料庫、成功回空陣列、DB 例外**最後都印成 `null`**;安全拒絕與整間公司授權服務壞掉會得到**同一個綠**。`must-fix`
17. `b3-spec.md:192-193`;`proxy.ts:39-40`
   「本片不引入新成本」**不實**:目前全站讀取閘沒有 staff 查詢,B5 接上後每個頁面都新增 DB 相依性;proxy 載入 server adapter 的 runtime 相容性亦未確認。`must-fix`

### TOCTOU / 停用不生效 / auth_time

18. `b3-spec.md:144-171`;`authorize.ts:29-34`
   `resolveStaff()` 與實際寫入是**兩次分離操作**;員工在檢查成功後、RPC 寫入前被停用 ⇒ 該次寫入仍會成功,**並非宣稱的「每次用時確認現在有效」**。`must-fix`
19. `b3-spec.md:149-168`;`PCM報價單-V2/middleware.ts:64-75`
   只停用 Supabase Auth 帳號**不會撤銷既有自製 HMAC session**;它仍可 sliding refresh、繼續使用報價單並簽新 SSO code,規格缺雙系統停用或 per-user 撤銷契約。`must-fix`
20. `b3-spec.md:134-136`;`PCM報價單-V2/app/api/sso/authorize/route.ts:17-19,61-62`;`middleware.ts:64-75`
   23 小時前登入的 session 剛被滑動刷新 ⇒ `iat` 變成現在、SSO 又把它命名為 `auth_time`;任何「近期重新驗證」或登入時間稽核都會得到**假近期**。`must-fix`
21. `b3-spec.md:61-63,107-117`;`PCM報價單-V2/app/api/admin/2fa/enroll/confirm/route.ts:87-90`
   規格**未盤點所有發證點**;首次 TOTP 綁定會重新呼叫 `buildPayload()`,若未同步帶回原 `sub`,就會**擦掉身分或簽出非法 v2**。`must-fix`

---

## ✅ 打不破項目(codex 自己標的,逐字保留)

> 🔴 **這一段比 findings 更容易被跳過,而它記的是「哪些地方已經站得住」。**
> 本輪 codex 標為打不破的有 **3** 項。數法(本檔內,可重跑):
> `grep -c '^  「這一項我試過打不破' docs/reviews/2026-08-17-b3-spec-codex-findings.md` ⇒ **3**
> 🔴 **`^  「` 那個錨點不是裝飾** —— 不加它(直接 `grep -c '這一項我試過打不破'`)會回 **4**,
> 多出來的第 4 個**是這條數法自己那一行**。**偵測字串自命中**,我落筆當下就踩了一次,留痕不刪。
> 正向對照:同檔 `grep -c '\`must-fix\`'` ⇒ 21 ⇒ 兩個數字來自同一份輸出、可互相參照。
> ⚠️ **「打不破」是【這一輪、這個模型、這些方法】打不破,不是「安全」。**

- `PCM報價單-V2/lib/session.ts:110`;`apps/admin/src/lib/session/session.ts:110`
  「這一項我試過打不破:兩支現行舊 validator 都逐字要求 `v===1`,所以各自收到本系統的 v2 cookie 時確實會拒絕。」
- `PCM報價單-V2/lib/session.ts:95-100,142-156`;`session.ts:95-100,141-153`
  「這一項我試過打不破:未重簽就竄改 `sub` 會破壞 HMAC,且兩邊都是先驗簽章再解析 payload;未知 key 的洞只存在於『合法簽發但語意混淆』的世界。」
- `actor.ts:32-34`;`staff.ts:16-22,25-43`
  「這一項我試過打不破:§7.1 引用的真實行號吻合,現有 actor-cookie 路徑確實會過濾 `is_active`、未知值回 `null`、DB throw 回空陣列;**假的是『B5/session/read gate 已完成』這個擴大宣稱**。」

---

## 🔴 B 窗自陳:我先前的複驗結論錯了一半,在此撤回

**2026-08-17 00:2x 我向窗陣報告過**:
> 「`resolveStaff` 只有兩個呼叫端、都在 session 層 ⇒ **(b) 沒有被繞過**,B3 spec §7.1 的宣稱成立。」

**後半撤回。** 被 `F-13`/`F-14` 打掉,而 codex 的「打不破」第三項把病因寫得最準:
**行號吻合是真的,假的是那個擴大宣稱。**

🔴 **病根是我量錯了東西,不是我漏看一個檔**:
```
我問的  :誰呼叫 resolveStaff?有沒有人繞過它?        ⇒ 答案確實是「沒有人繞過」
該問的  :該走它的那些路徑,有沒有走它?               ⇒ proxy.ts:38-50 讀取閘【從來不呼叫它】
```
**一條從來不呼叫它的路徑,在「呼叫端清單」裡是看不見的。**
⇒ 判別句:**我這支 grep 的分母,是「用它的人」還是「該用它的人」?**

---

## 未確認(codex 自標,不要當成已驗)

- **B1-b / B2 是否已 apply 到真實報價單資料庫** —— codex 本 session 無 production migration ledger 查詢能力,
  repo 只能證明目前存在草稿,**不能代替正式庫讀回**。
  📌 補充(B 窗):`B-554-STOP` §「機器可讀段」`applied_to_any_real_db: false` ⇒ **未 apply**,與此一致。

## 折況(🔴 這一段描述的是**世界的狀態**,不是本檔的內容 ⇒ 每次有人折就會過期,**改的人要順手更新這裡**)

**2026-08-17 傍晚 · B 窗被指派折 5 條**(`#9` / `#10` / `#13` / `#14` / `#15`,主視窗指派)。
🔴 **實際結果:折掉 3 條(`#10`/`#13`/`#14`),`#9` 未折,`#15` 部分折。**
判定來源 = **codex R2 對抗審查**(`gpt-5.6-sol`,`-s read-only`,2026-08-17 傍晚,審的是折法本身)
⇒ **verdict FAIL,4 must-fix + 3 nit,全部已回折進 spec。**
📎 **值得記的形狀**:R1 的 21 條裡,`#9` 我「折」的時候把**執行時機**寫錯了 ——
**折 finding 這個動作本身,會產生新的 must-fix**,而它讀起來像進度。

| # | 判定 | 折在哪(`docs/specs/2026-08-16-m4b-e8b-b3-spec.md`) | 折法一句 |
|---|---|---|---|
| `#9` | 🔴 **未折** | §3 表下方 ⛔ 區塊 + §6 第 6 格已標【未決】 | 第一版寫「綁定白名單在**簽發時**由 CHECK 執行」⇒ **錯,`SELECT` 不重跑 `CHECK`**。已更正成「CHECK 只在**寫入映射列**時擋」,而 §6 第 6 格因此**沒有 runtime 執行者** ⇒ 要它真的擋就得另定應用層驗法(會複製清單)⇒ **取捨歸 plan 層,本條記為未折** |
| `#10` | ✅ **已折** | §4 新增「不能接受的主詞是營運狀態」區塊 | 拆兩層:**runtime = 映射查無/逾時 ⇒ 該次登入失敗,是正確結果**;**排程 = 不希望營運進入那個狀態,所以順序硬**。並**明文禁止**三條變通(改簽 fallback / 用 client 傳入 `staff_id` / DB 逾時暫時放行),且**明寫該禁止清單非窮舉** |
| `#13` | ✅ **已折** | §7.1 開頭 ⛔ 區塊 | 撤回「已經實作好了」;**非測試原始碼**的呼叫端只有 `actor.ts:35`(吃 `ACTOR_COOKIE`)與 `actor-actions.ts:24`,**沒有一處吃 `session.sub`**(⚠️「非測試原始碼」≠「正式部署產物」,後者未確認) |
| `#14` | ✅ **已折** | §7.1 開頭 ⛔ 區塊 + 「(b) 的代價」第 1 條 | 讀取閘 `proxy.ts:39-50` 只做 `verifySession`,**零 `resolveStaff`**(數法 `grep -c resolveStaff apps/admin/src/proxy.ts` ⇒ **0**;正向對照 `verifySession` ⇒ **2**,⚠️ 該 2 = import + 呼叫兩筆**文字**命中,runtime 呼叫只有一處);R2 改記為**未關閉** |
| `#15` | ⚠️ **部分折** | §7.1 新增 **read / write 矩陣** + 驗收表第 6/7/8 格 + **涵蓋證明**小節 | 語意洞已折(fallback **可讀不可寫**、**不得沿用 `ACTOR_COOKIE`**、攔截點在**寫入端**);🔴 **涵蓋洞**由 codex R2 補上:一格行為測試證不了「所有寫入端」⇒ 追加**結構要求**(寫入全走 `authorizeAdminMutation()`)+ 可重跑數法。**現況量到 `'use server'` 19 支中恰一支未經該閘 = `actor-actions.ts`(正是設 `ACTOR_COOKIE` 那支)**;route handler 那 2 支已逐支定性 = **SSO `start`/`callback`,依定義未登入可達 ⇒ 明文排除**(codex R2 `NEW-MF1`:第一版沒寫排除條款,**照字面會鎖死登入**);⚠️ **第三個面(server component 直接寫入)未量** ⇒ 仍**未宣稱全涵蓋** ⇒ **本條記為部分折** |

**順帶更正(不算折,只更正事實半邊)**:`#17`「本片不引入新成本」不實 —— 「現況已經如此」只對寫入/選人那條路成立,
讀取閘現在零 staff 查詢 ⇒ B5 接上是**新成本**。🔴 **`#17` 形式上仍未折**(要不要因此改設計是 plan 層決定);
`#17` 後半「proxy 載入 server adapter 的 runtime 相容性未確認」**B 窗也未查證**,已在 spec 內標明缺哪一道。

### 🔴 R3(換角度)新開的兩條 —— **B 窗沒折,理由不是懶,是它們卡在 `#2`**

R3 用四個新角度(假設審查 / 施工者行為 / 更正是否誤導 / 內部矛盾)產出 **8 must-fix + 2 nit**,
**其中 8 條已折進 spec**(逐條留痕在 spec 內、標了 `codex R3`)。**未折的兩條都是【範圍題】**:

| 新條 | 內容 | 為什麼 B 窗不折 |
|---|---|---|
| **R3-a** | §6 表**只有第 1-3 格補了 B3/B5 主詞,第 4-7 格仍無主詞** ⇒ 施工者可能在 B3 去改 admin validator、或拿錯 repo 的綠燈驗收 | 補主詞 = **決定每一格屬於哪一片**,而那正是 `#2`(範圍越界)要決定的事。**先補主詞等於替 `#2` 拍板。** |
| **R3-b** | §5 說 B3 **不動 `amr`** 所以本片不觸發;§6 第 8 格卻把 amr 一致性列為 **B3 必過部署閘**,且 §5-B 逐字說 **B3 最可能引入新 amr 值** ⇒ **同一份檔兩個答案** | 同上:「第 8 格屬不屬於 B3」就是範圍題。⚠️ 而第 8 格**今天剛被 V 窗 R1 改過**(量法改比 Set)⇒ **動它要先跟 V 窗對齊,不是 B 窗單方面** |

🔴 **停在這裡是照規矩,不是收工**:輪次紀律說「**某輪的 finding 都在同一層打轉 = 方向問題,
整理決策題往上送,而不是繼續折衝**」。R3 剩下的兩條**都落在 `#2` 這一層** ⇒ **送上去。**

**決策題(給 plan 層 / Sean)**:
> **Q**:B3 spec 的範圍要不要照 `#2` 縮回母 plan 的邊界(admin 收端 = B5)?
> **甲** 縮 —— §6 第 1-3 格與第 8 格、§7.1 整節搬去 B5 spec,B3 只留報價單側。
> **乙** 不縮 —— B3 spec 明文擴權涵蓋兩端,並同步更新母 plan `:165-168` 的切法。
> ⇒ **兩案都會改變 R3-a / R3-b 的答案,所以它們現在無解,不是漏做。**

## 尚未做的事(明寫,不要讀成已完成)

- **21 條中,已折 3 條(`#10`/`#13`/`#14`)、部分折 1 條(`#15`)、其餘 17 條未折(含 `#9`)。**
  數法(本檔內,可重跑,與檔頭 §引用限定 同一支):
  `grep -c '\`must-fix\`' docs/reviews/2026-08-17-b3-spec-codex-findings.md` ⇒ **21**(**分母**);
  **判定逐條就是上表**(⚠️ 「已折」本身**沒有機械標記可數** —— 只能讀上表,這是本檔的已知限制)。
  🔴 **不要把「B 窗被指派 5 條」讀成「折掉 5 條」** —— 那正是本輪 codex 抓到的其中兩條 must-fix。
- 🔴 **`#2`(範圍越界)未折,而它是折序的頭** —— `#13`/`#14`/`#15` 修的都是 **B5 讀取閘**的內容,
  **B 窗這 5 條只更正了事實,沒有決定這些內容留在 B3 spec 還是搬去 B5 spec。** 那是 plan 層的決定。
- **本檔不改 B3 規格本身** —— 規格要不要照 `#2` 縮回 B4/B5 邊界,是 plan 層的決定。
