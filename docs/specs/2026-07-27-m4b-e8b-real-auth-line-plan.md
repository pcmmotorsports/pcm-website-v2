# M-4b E8-B「報價單端真認證線」slice plan v3

> **一句話**:讓每個員工有自己的帳號密碼,後台從「你自己說你是誰」變成「系統知道你是誰」。
> **狀態**:✅ **Sean 六題已全數拍板(§0)、範圍已確認顯著大於 07-26 的「動 4 處」估計**(見 §1.5、§9)。**零 code、零 migration、零 DB。**
> 🔴 **本檔是「這一條線」的 plan,不是整個後台的規劃。** Sean 2026-07-27 指示:完整後台規劃由 **2026-07-28 20:00 後的新 session 用 Fable 主導**,入口 = `docs/handoff/2026-07-27-admin-full-planning-handoff.md`。**本 session 到此停止,不進實作。**
> **片型**:🔴 **高風險片** —— 鐵則 12 ②權限 + ③DB 結構。對抗審查不降級。
> **跨 repo**:主要改動在 `/Users/sean_1/API大量上架/PCM報價單-V2`(以下稱**報價單**),`pcm-website-v2/apps/admin`(稱 **admin**)吃結果。
> **審查狀態**:codex 關卡1 R1(`gpt-5.6-sol` xhigh、`-s read-only`、零留痕已驗)= **FAIL、17 must-fix**。本 v2 已折入可自行決定者;需 Sean 拍板者列 §7。對帳表 = §9。
> 拍板全表 = memory `project_m4b-real-auth-line-decisions`。

---

## §0 Sean 拍板總表(接手不得重問)

| 題 | 拍板 | 日期 |
|---|---|---|
| Q1 | **B** 身分來自報價單(不在 admin 端另建一套帳號) | 07-26 |
| Q5 | **B** 🔴「TOTP 裝置=身分」方案**作廢**(裝置有共用、認不出人) | 07-26 |
| Q7 | **A** 帳號 + 密碼登入;**TOTP 只在未記住的新裝置才要**(日常免開 app) | 07-26 |
| Q8 | **A** 初始密碼由 **Sean 指定**(非員工自助註冊) | 07-26 |
| Q1' | **A** 開工做這條線(勝過 E10 訂單閉環) | 07-27 |
| Q2' | **A** 共用密碼 **保留當備援**,真認證上線後不停用 | 07-27 |
| **§7-Q6** | **A** 照 B0-B10 **一路做完才上線**,中間不部署 | 07-27 |
| **§7-Q1** | **A** 備援密碼進來 **兩邊都唯讀**(admin + 報價單) | 07-27 |
| **§7-Q5** | **A** 2FA 管理權限 **只有 `sean`**(裝置/備用碼/2FA 開關/強制重登) | 07-27 |
| **§7-Q2** | **A** 既有 TOTP 裝置與備用碼 **全歸 `sean`**,另兩人上線時各自綁 | 07-27 |
| **§7-Q3** | **C** 帳號 = **email**(🔴 推翻 Claude 推薦的 A) | 07-27 |
| **§7-Q4** | **A** 首次登入 **強制改密碼**(Sean 先答 B、聽完殘留風險後同日改 **A**) | 07-27 |
| 分工 | Codex `gpt-5.6-sol` 寫、Claude 審 + 二審;**規劃改由 Fable 主導**(Sean 07-27 晚間指示) | 07-27 |

---

## §1 現況(全部主對話親讀、附檔案:行號)

### 1.1 進後台的真實路徑

```
員工 → 報價單站登入(全公司共用一組密碼 + TOTP) → SSO 跳 admin → 自己從下拉挑一個名字
```

| 事實 | 證據 |
|---|---|
| 密碼是**單一環境變數**、全公司共用一組 | `報價單/app/api/admin/login/route.ts:136` 逐字 `const expected = process.env.ADMIN_PASSWORD` |
| 密碼比對 | 同檔 `:174` `safeEqualHex(await adminToken(provided), await adminToken(expected))` |
| **repo 內未宣告任何 users 表** | `報價單/supabase/migrations/` 全樹 `create table` 清單(43 張)無 user/account 表。⚠️ **這只證明 repo 未宣告,不證明 production 無漂移**(codex F11;實查列 §8) |
| SSO 授權碼**只記 amr / auth_time** | `報價單/app/api/sso/authorize/route.ts:58-64` insert 欄位列 |
| exchange **只回 amr / auth_time** | `報價單/app/api/sso/exchange/route.ts:66` `.select('amr, auth_time')`、`:71` |
| admin session payload **刻意不帶身分** | `admin/src/lib/session/session.ts:11-12` 逐字 |
| 操作者是**使用者自己挑的** | `admin/src/lib/session/actor.ts:6-7` 逐字:「這**不是**登入 / 授權邊界」 |
| **「記住裝置」機制不存在** | 報價單全樹 grep `記住`/`remember`/`trusted`:命中全是 `ipAddress()` 變數名與一則 UI 註解,**零 trusted-device 實作** |

### 1.2 後果(一句話)

**任何進得了後台的人,都能挑「sean」去操作**,系統不擋、`admin_audit_log` 照寫該名字。稽核軌現在是裝飾、不是證據。

### 1.3 已經在的地基

報價單 B庫 `dllwkkfanaebrsuyuedy`:`auth_state`(singleton)/ `totp_devices` / `recovery_codes` / `login_attempts` + `login_rate_buckets` / `sso_codes`。
admin A庫 `bmpnplmnldofgaohnaok`:`public.staff`(E8-A1,三列)。

### 1.4 admin 端連動面(graphify BFS depth=2,78 節點 + 主對話複驗)

🔴 **v1 寫錯、v2 更正(codex F1,已親驗)**:v1 稱「`authorizeAdminMutation()` 是所有寫入的閘」—— **不成立**。
- 走共用閘的:`staff-actions.ts`(3 處)、`customers/tier-actions.ts`、`customers/wallet-actions.ts`、`orders/order-actions.ts`(2 處)
- **不走、自己拼三道檢查的**:`orders/status-option-actions.ts`(`:46`/`:52`/`:57` 與 `:126`/`:130`/`:133` 各自 `verifySession` + `isAllowedOrigin` + `getSessionActor`)
⇒ **改身分來源時,這條路徑會被漏掉**。v1 也漏列 `staff-actions.ts`(E8-A2 自己的寫入端)。

### 1.5 🔴🔴 本輪最重要的發現:報價單的整套 2FA 是「全公司一組」,不是「每人一份」

codex 獨立指出、主對話逐條親驗證實:

| 項目 | 實查證據 | 做個人帳號後會怎樣 |
|---|---|---|
| `totp_devices` **無使用者欄** | `20260611_auth_2fa_schema.sql` 該表 14 欄全列已讀:`id/label/secret/algo/digits/period_seconds/status/created_at/activated_at/last_used_at/last_used_ip/disabled_at/created_by` —— **沒有 user_id** | 任何人的 TOTP 可以搭配**另一個人的密碼**完成登入 |
| `recovery_codes` **無使用者欄** | 同檔該表 7 欄全列已讀,無 user_id | 同上,備用碼跨人可用 |
| `auth_state.last_consumed_step` **是全域單值** | 同檔 `:28` 逐字註解:「**全域 TOTP 防重放 (任一裝置消費同 step → 拒)**」;消費邏輯 `lib/twofa.ts:77-79` | 🔴 **員工 A 用掉某個 30 秒窗,員工 B 同一窗的合法 TOTP 會被判重放、登不進去** —— 上線第一天就會爆 |
| 2FA 管理 API 全域 | `app/api/admin/2fa/{devices,enroll,recovery,status,toggle,force-relogin}` | 一般員工可停用別人的裝置、重產全公司備用碼、關掉 2FA、強制全員重登 |

**⇒ 這不是「加個 users 表」,是整層認證資料模型從單租戶改成多使用者。** 07-26 記的「要動 4 處」是低估。

---

## §2 目標與非目標

**目標**:①每人有自己的帳密 ②登入後系統知道他是誰 ③admin 操作者不再自選、稽核軌變真證據 ④TOTP 只在沒記住的新裝置擋一次。

**非目標**:員工自助註冊(Q8=A)/ 兩級以上角色矩陣(N2=B)/ 忘記密碼自助重設(先由 Sean 重設)/ SSO 給第三方。

---

## §3 架構決策

### D1 身分鍵 = `staff_id`,跨兩個 Supabase 專案靠 payload 傳遞、不靠 join

報價單在 B庫、staff 表在 A庫,**兩庫不能 join**。報價單新 `admin_users` 帶 `staff_id`,值逐字元等於 A庫 `public.staff.id`。此值經 `sso_codes` → exchange → admin session 傳遞,**admin 端收到後仍要用 `resolveStaff()` 查 A庫白名單**,不信任外部傳入值。

🔴 **staff id 不能改**:`admin_audit_log.actor` 是 text 欄、27 筆歷史列全部引用。改 id = 稽核軌全變孤兒。

**🆕 折入 codex F3/F8**:`resolveStaff()` 必須擋在**簽發時**與**每次讀取閘**,不能只擋 mutation —— 否則「已停用的員工」仍持有效 12 小時 session、照樣讀得到整個後台。

### D2 session payload 加身分欄(v1 的 rollback 斷言寫錯,已更正)

🔴 **v1 錯誤(codex F9)**:v1 稱「revert 回去會再登出一次」。實查 `報價單/lib/session.ts:107-118` 的 `isPayload()` **只檢查必需欄、容許額外欄** ⇒ revert 舊 validator 後,**帶 uid 的新 cookie 仍然有效**,只是 uid 被忽略 —— 等於**靜默退回無身分語意**,比「再登出一次」危險得多。

**修正做法**:身分欄的驗證要綁在**版本欄**上(`v: 1` → `v: 2`),舊 validator 見 `v=2` 直接 reject。這樣 revert 是「乾淨地全部失效」,不是「靜默降級」。

### D3 🔴 Q2=A 備援共用密碼 —— v1 的 D2/D3 互相矛盾,已重新設計

🔴 **v1 邏輯錯誤(codex F2)**:v1 同時說「uid 必填」和「備援 session 的 uid=null」—— 兩者不能並存。

**v2 做法**:payload 加的是 `sub`(subject),**必填、但有兩種形狀**:
- `{ kind: 'user', staff_id: 'sean' }` — 個人帳號登入
- `{ kind: 'fallback' }` — 共用密碼備援登入,**沒有 staff_id**

⇒ 「沒有身分的 session」在型別上不存在;「備援」是一種**明示的身分種類**,不是身分的缺席。

**備援的權限(§7-Q1 待拍)**,本 plan 預設:
- admin 端:**唯讀**。所有寫入(共用閘 + `status-option-actions` 那條自拼路徑,兩邊都要)一律擋
- 🆕 **報價單端也要擋**(codex F5):備援 session 在報價單自己的寫入功能也應唯讀,否則洞只補了一半
- 畫面固定橫幅:「你正用備援密碼登入,只能查看、不能修改。請改用個人帳號。」
- 備援登入寫 `login_attempts` + 觸發告警(有人用備援 = 異常,不該安靜發生)

### D4 「記住裝置」是全新子系統(v1 已標,v2 補重放設計)

新表 `trusted_devices`(綁 `admin_users.id`、device token 的 hash、`expires_at`、`last_used_at`、`user_agent`)。
🆕 **折入 codex F7**:必須含 ①**token 每次使用後原子旋轉** ②**reuse detection**(舊 token 再次出現 = 已遭竊,撤銷整條裝置鏈並告警)③cookie 安全屬性(`__Host-`/`HttpOnly`/`Secure`/`SameSite`)④**改密碼或改 TOTP 時撤銷該使用者全部裝置**。
記住裝置 ≠ 登入狀態:登出不該讓裝置變陌生。

### D5 既有 TOTP / 備用碼的歸屬與遷移(§7-Q2)

`totp_devices`、`recovery_codes` 需加 `user_id`;`auth_state.last_consumed_step` 需從全域單值**搬進 per-user**(§1.5,不搬則多員工互相踢)。既有裝置預設全歸 `sean`。

### D6 🆕 legacy cookie 的 fail-open 路徑(codex F3,v1 完全漏掉)

`報價單/app/api/admin/login/route.ts:116-133` `issueSession()`:當 `SESSION_SECRET`/`EDGE_CONFIG` 缺、且 `amr === ['pwd']` 時,**退回 legacy cookie**(`:127-131`)。legacy cookie **無 amr、無版本、無身分**。
⇒ 真認證線上線後,這條路仍能發出一張沒有身分的通行證。**必須在本線內關掉或改造**,否則整條線可被繞過。

### D7 🆕 密碼儲存方案(codex F10,v1 完全沒寫)

必須先定死,否則實作者可能把快速 hash 甚至明碼放進 migration:
- 慢速 KDF(argon2id 或 bcrypt,cost 參數寫進規格)
- **dummy hash 常數時間比對**:查無帳號時仍跑一次 KDF,防帳號枚舉
- 初始密碼(Q8=A Sean 指定)的**安全注入方式** —— 🔴 **不得寫進 migration 檔**(migration 進 git)
- 首次登入是否強制改密碼(§7-Q4)

### D8 🆕 帳號維度限速(codex F11)

現有 `login_rate_buckets` 只有 per-IP 與全域。加帳號後可用分散 IP 猜單一帳號 ⇒ 需加 per-account 桶,且「查無帳號」與「密碼錯」的回應時間與訊息必須一致。

---

## §4 拆片(v2,已按 codex F6/F13 補上遺漏的順序依賴)

| 片 | 內容 | repo | 風險 |
|---|---|---|---|
| **B0** | 規格凍結 + **production schema 實查**(§8 未驗項)+ 報價單側交接 | docs | 低 |
| **B1** | `admin_users` 表 + KDF 方案(D7)+ per-account 限速(D8)+ ACL/RLS deny-all | 報價單 | 🔴 DB |
| **B2** | 🆕 **2FA 資料模型 per-user 化**:`totp_devices`/`recovery_codes` 加 `user_id`、`last_consumed_step` 搬 per-user、既有資料歸 `sean`(D5) | 報價單 | 🔴 DB |
| **B3** | 登入認人:`login/route.ts` 改查 `admin_users`;備援分支(D3);**關掉 legacy fail-open**(D6);LoginForm 加帳號欄 | 報價單 | 🔴 auth |
| **B4** | `session.ts` payload 加 `sub` + 版本 `v:2`(D2/D3) | 報價單 | 🔴 auth |
| **B5** | 記住裝置子系統(D4:表 + 旋轉 + reuse detection + 撤銷) | 報價單 | 🔴 auth |
| **B6** | 🆕 **2FA 管理 API 權限收緊**(§1.5 末列:誰能停用別人裝置/重產備用碼/關 2FA/強制全員重登) | 報價單 | 🔴 權限 |
| **B7** | SSO 兩端帶身分:`sso_codes` **expand/contract 加選填欄**(F14)+ `authorize` 寫入 + `exchange` 回傳 | 報價單 | 🔴 DB + auth |
| **B8** | admin 端吃身分:`AdminSessionPayload` + callback + `actor.ts` 改讀 session;**`resolveStaff` 進讀取閘**(D1) | admin | 🔴 auth |
| **B9** | admin 端移除自選下拉;**兩條授權路徑都改**(共用閘 + `status-option-actions`,§1.4);備援唯讀橫幅 | admin | 🔴 權限 |
| **B10** | 端到端驗收(§4b 負向清單) | 兩邊 | — |

🔴 **上線順序硬依賴(v1 只寫了一半)**:B1→B2→B3(帳號存在才能認人;2FA 沒 per-user 化就先開個人帳號 = 員工互相踢)→ B4(先認人再改 payload,否則簽出無身分 session)→ B7→B8→B9。
🔴 **B9 之前 admin 不得部署成「下拉沒了但身分還沒到」的中間態** —— 那會讓後台當場沒人能寫入。前置條件寫成可執行檢查(實際打一次 exchange、確認回應含 staff_id),不靠記得。

### §4b 驗收負向清單(折入 codex F17;v1 只有「三個帳號各登一次」)

跨帳號 TOTP / 跨帳號備用碼 / 舊 cookie / legacy cookie / 備援嘗試寫入 / 已停用帳號仍持 session / trusted-token 重放 / SSO code 重放 / 混版部署(admin 新、報價單舊)/ rollback 後的行為 —— **每項都要有一個會紅的測試**。

---

## §5 預期影響面(v2 補齊)

- **報價單**:`lib/session.ts`(Edge middleware 與 Node route 共用 ⇒ **runtime-neutral 硬規則不得破**:只用 `crypto.subtle`、不 import `node:crypto`、不 top-level await)、`app/api/admin/login/route.ts`、`app/api/sso/{authorize,exchange}/route.ts`、🆕 `lib/twofa.ts`、🆕 `lib/auth-server.ts`、🆕 `middleware.ts`、🆕 `components/LoginForm.tsx`、🆕 `app/api/admin/2fa/*`(6 個子路由)、🆕 SecurityPanel UI;新 migration ×3-4。
- **admin**:`lib/session/{session,actor,actor-actions,authorize}.ts`、`app/api/sso/callback/route.ts`、`app/page.tsx`、`lib/audit/context.ts`、🆕 `lib/staff-actions.ts`、🆕 `lib/orders/status-option-actions.ts`。
- **人**:上線當天全員重登一次;之後每人用自己的帳密。
- **DB**:報價單 B庫 +2 表(`admin_users`、`trusted_devices`)、3 張既有表加欄;admin A庫 **零 schema 變更**。

## §6 Rollback(v2 更正)

- 🔴 **migration 不能靠 git revert 回復**(codex F14):revert 檔案不會移除已套用的 schema。⇒ **一律 expand/contract**:新欄先加成**選填**、舊寫入端照樣能跑,兩端都上線後才收緊。`sso_codes` 直接加必填欄會讓舊 `authorize` 當場 insert 失敗。
- 🔴 **payload 加欄的 revert 陷阱見 D2** —— 靠 `v:2` 版本欄擋,不靠「舊 validator 會 reject」的錯誤假設。
- **最危險中間態**:B9 已部署但 B7/B8 沒到位 ⇒ 後台所有寫入 fail-closed 擋死。
- **備援**:`ADMIN_PASSWORD` 全程保留(Q2=A)⇒ 整條線壞掉時 Sean 仍進得去(唯讀,D3)。

---

## §7 ✅ 六題已於 2026-07-27 全數拍板(見 §0;以下為衍生的技術含意)

### 7.1 Q3=C「帳號用 email」的衍生設計

`admin_users` 需**兩個識別碼、職責分離**:

| 欄 | 角色 | 可變性 |
|---|---|---|
| `email` | **登入識別碼**(人輸入的) | 可改(換信箱不該換身分) |
| `staff_id` | **稽核鍵**,逐字元等於 A庫 `public.staff.id` | 🔴 **永不可改**(`admin_audit_log.actor` 27 筆已引用) |

⇒ email 是「門把」、staff_id 是「身分證」。這其實比 Q3=A 乾淨:換信箱不會動到稽核軌。
🔴 **連動 D8**:email 當帳號 ⇒ 枚舉風險升高(email 好猜)。「查無帳號」與「密碼錯」的**回應訊息、HTTP 狀態、回應時間**三者都必須一致(dummy hash 常數時間比對)。
🔴 email 需正規化(小寫 + trim)後才比對與建唯一索引,否則 `Sean@…` 與 `sean@…` 會變兩個帳號。

### 7.2 Q4=A「首次登入強制改密碼」—— 稽核軌可信度的關鍵一環

**過程紀錄**:Sean 先答 **B**(不強制),Claude 提出殘留風險後,Sean 同日改為 **A**。
🔴 **為什麼這條重要**:Q8=A 表示 Sean 指定初始密碼。若不強制改,**Sean 就永遠知道每個人的密碼** ⇒ 稽核軌上「`staff_1` 做的」無法排除是 Sean 用其帳號做的 —— 而「稽核軌變成真證據」正是本線的目標之一。**Q4=A 讓初始密碼在第一次登入後就失效,稽核軌才真的指向本人。**

**B1 因此多的工作**:
- `admin_users.must_change_password` boolean(seed 時為 `true`)
- 強制改密碼的**攔截點必須在所有入口之前** —— 包含 SSO `authorize`。🔴 否則員工可以跳過改密碼頁直接走 SSO 進 admin,強制形同虛設
- 改密碼成功 → 旗標轉 false + **撤銷該使用者全部 trusted device**(D4)+ 旋轉 session
- 新密碼強度規則(長度下限;不做複雜度規則,對三人團隊是負擔不是安全)

### 7.3 Q5=A「只有 sean 能管 2FA」的落點

2FA 管理 API 在**報價單 B庫**,而 `staff.is_manager` 在 **admin A庫** ⇒ 跨庫拿不到。
⇒ 報價單 `admin_users` 需自己的 `is_owner` 旗標,**只有 `sean` 那列為 true**,且比照 A庫 staff 表做法:**欄級 REVOKE、不給一般路徑改**。
涵蓋的六個路由:`app/api/admin/2fa/{devices,enroll,recovery,status,toggle,force-relogin}`。

### 7.4 🔴 Q6=A「一路做完才上線」的**未解設計題**(留給明天的規劃 session)

11 片、跨兩個 repo、中間不部署 —— 但**報價單的分支是 `main`、Sean 一推就是正式站**。
⇒ 必須先決定承載方式,三個候選(明天要選一個):
- **(a) 長期 feature branch**:乾淨,但 11 片期間報價單其他工作要避開或不斷 rebase
- **(b) 全部藏在 flag 後面**:可持續推 main,但認證有 flag = 多一條可被誤開的路徑,且 flag 本身要防護
- **(c) 兩者混合**:DB migration 走 expand(可先上、無行為)、行為改動走 flag

🔴 **這題沒答之前不要開始寫 code** —— 選錯會導致做到第 7 片才發現沒地方放。

---

## §8 誠實邊界

- §1 所有現況斷言皆附檔案:行號,**均為主對話親讀**;codex 指出的 §1.4 錯誤已更正。
- 🔴 **未查證(codex F16,必須在 B0 補)**:①報價單 B庫 **production** 是否與 repo migration 一致(repo grep 只證明 repo 未宣告)②`auth_state.require_2fa` 的**現值**(會實際改變 rollout 路徑)③A庫 `staff` 三列與 `admin_audit_log` 27 筆為 E8-A1 當時的實查,本輪未複查。
- **本 v2 尚未經 codex R2 複審**。plan 層審查上限 2 輪,R2 留待 Sean 拍完 §7 再跑(現在跑會審到一份還有 6 個開放決策的東西)。

---

## §9 codex 關卡1 R1 對帳表(17 must-fix)

| # | codex 指控 | 主對話裁定 | 處置 |
|---|---|---|---|
| F1 | `authorizeAdminMutation` 不是所有寫入的閘;漏 `staff-actions` | ✅ **成立**(親驗 `status-option-actions.ts:46/52/57`) | §1.4 更正、§4 B9、§5 |
| F2 | D2「uid 必填」與 D3「備援 uid=null」矛盾 | ✅ **成立**(邏輯錯誤) | D3 重新設計為 `sub` 兩形狀 |
| F3 | 漏 legacy cookie 雙讀 / fail-open | ✅ **成立**(親驗 `login/route.ts:127-131`) | 新增 D6、B3 |
| F4 | `totp_devices`/`recovery_codes` 無使用者歸屬 | ✅ **成立**(親讀兩表全欄) | §1.5、D5、新增 B2 |
| F5 | `last_consumed_step` 全域 → 多員工互踢 | ✅ **成立**(親讀 `:28` 註解逐字 + `twofa.ts:77-79`) | §1.5、B2 |
| F6 | 2FA 管理 API 全域、權限未定 | ✅ **成立** | §1.5、新增 B6、§7-Q5 |
| F7 | trusted-device 無重放設計 | ✅ **成立** | D4 補旋轉/reuse detection/撤銷 |
| F8 | `resolveStaff` 未進讀取閘 | ✅ **成立** | D1 補 |
| F9 | cookie rollback 斷言與實檔不符 | ✅ **成立**(親驗 `isPayload` 容許額外欄) | D2 改用 `v:2` |
| F10 | 缺密碼儲存 / KDF / 防枚舉方案 | ✅ **成立** | 新增 D7 |
| F11 | 缺帳號維度限速 | ✅ **成立** | 新增 D8 |
| F12 | 備援「唯讀」只講 admin、漏報價單端 | ✅ **成立** | D3 補 |
| F13 | 拆片順序漏 B2/B3 與登入 UI | ✅ **成立** | §4 順序重寫 |
| F14 | migration 不能靠 git revert;`sso_codes` 加必填欄會斷 | ✅ **成立** | §6 改 expand/contract |
| F15 | 跨 repo 停用/撤銷契約缺 | ✅ **成立** | D1 補(仍需 B0 設計) |
| F16 | production 斷言超出證據 | ✅ **成立** | §1.1 加註、§8 列未驗項 |
| F17 | 驗收只有正向三帳號 | ✅ **成立** | 新增 §4b 負向清單 |

**駁回:0 條。** 17 條全部成立 —— 這是 v1 的品質訊號,不是 codex 過度嚴格。
