# 交接:M-4b 完整後台規劃 session(2026-07-28 20:00 後開工)

> **本檔是下一個 session 的唯一入口。** Sean 2026-07-27 指示:今天不進實作,把需要規劃的事寫成完整交接,明天晚上 8 點後有 Claude 額度時開新 session,**用 Fable 主導完整後台規劃與執行、codex 做審查**。
> **Sean 的目標(逐字)**:「我目標是把完整後台做好。」
> 衝突仲裁:可驗證事實 > `STATUS.md` > 本檔 > 歷史 handoff / memory。

---

## 1. 開工第一件事(照順序,不要跳)

```bash
cd /Users/sean_1/pcm-website-v2 && git branch --show-current && git status && git log --oneline -5
git log --oneline origin/dev..HEAD && git rev-list --count origin/dev..HEAD
```

預期:branch=`dev`、樹乾淨。**未推數當場查、不看本檔寫死的數字**(本檔產出當下=3,但 Sean 可能已推)。

然後依序讀:
1. 本檔全文
2. `STATUS.md`(2026-07-27 已精簡為 30 行主表,好讀了)
3. `docs/specs/2026-07-25-admin-backend-rebuild-spec.md` **§0a 施工序 + §1 員工的一天 27 項**(= 驗收標準本體)
4. `docs/specs/2026-07-27-m4b-e8b-real-auth-line-plan.md` **v3**(認證線,六題已拍板、含一個未解設計題)
5. memory:`project_admin-backend-staff-ready-goal` / `project_m4b-real-auth-line-decisions` / `project_m4b-ux-review-u-decisions` / `project_m4b-admin-preview-decisions`

🔴 **不要重問已拍板的題**(全表在 §7)。

---

## 2. 這個 session 要做什麼 / 不要做什麼

**要做**:把「完整後台」從現在的**片段規格**收斂成**一份可執行的總規劃** —— 涵蓋 E8-B 認證線、E10 訂單閉環、E11 積木、E12 供應商主檔,排出片序、標出彼此的硬依賴、估出到「27 項全綠」還差多少。然後開始執行。

**不要做**:
- 不要重做已完成的部分(E11-1/E11-2/E8-A1/E8-A2 都已上線)
- 不要重新編號 epic(E0-E12 已定,`rebuild-spec` §0 明文「不推翻 E0-E9、不重編號」)
- 不要在總規劃拍板前開始寫 code

**分工(Sean 07-27 指示)**:
| 角色 | 誰 |
|---|---|
| 完整後台規劃 + 執行 | **Fable** |
| 審查 | **codex**(`-m gpt-5.6-sol`,關卡1 審 plan / 關卡2 審 diff) |
| 拍板 / push / 操作 dashboard / 肉眼驗 | Sean |

⚠️ 這是 Sean 針對明天額度狀況的調度,**非永久制度**。

---

## 3. 本 session(2026-07-27)的產出

**零 code、零 migration、零 DB、零 flag、未動 `.env*`、未 push。** 三個 commit:

| commit | 內容 |
|---|---|
| `dc46f14` | **STATUS.md 主表 357 → 30 行**。移出的 357 行逐字全文存進 `PROGRESS.md`「2026-07-27 STATUS 主表精簡存檔」的 `<details>` 區,`shasum` 逐位元組驗過兩者相同(`221b8ba1…`)、零刪除。7 欄結構保留 |
| `4b39538` | **E8-B 認證線 plan v2**:codex 關卡1 R1 = FAIL **17 must-fix**,逐條核對後**全數成立、駁回 0 條**,已全折入。對帳表在 plan §9 |
| (本次) | plan v3(Sean 六題拍板折入)+ 本交接檔 + STATUS 7 欄 |

### 3.1 🔴 本 session 最重要的發現

**報價單站的整套 2FA 是「全公司一組」,不是「每人一份」。** codex 指出、主對話逐條親讀 schema 證實:

| 項目 | 證據 | 後果 |
|---|---|---|
| `totp_devices` 14 欄**無 user_id** | `報價單/supabase/migrations/20260611_auth_2fa_schema.sql` 該表全欄 | 任何人的 TOTP 可搭配**另一人的密碼**登入 |
| `recovery_codes` 7 欄**無 user_id** | 同檔 | 備用碼跨人可用 |
| `auth_state.last_consumed_step` **全域單值** | 同檔 `:28` 逐字「全域 TOTP 防重放」+ `lib/twofa.ts:77-79` | 🔴 員工 A 用掉某個 30 秒窗,員工 B 同窗的**合法** TOTP 被判重放、登不進去 |
| 2FA 管理 API 六路由全域 | `app/api/admin/2fa/{devices,enroll,recovery,status,toggle,force-relogin}` | 一般員工可關掉全公司 2FA |
| 「記住裝置」**零實作** | 全樹 grep `記住`/`remember`/`trusted` | Sean 拍的 Q7=A 需**全新子系統** |
| legacy cookie fail-open | `報價單/app/api/admin/login/route.ts:127-131` | 無身分的通行證仍發得出來 = 整條線可被繞過 |

⇒ **這不是「加個 users 表」,是認證資料模型從單租戶改成多使用者。** 07-26 記的「要動 4 處」是低估,已重拆為 **B0-B10 十一片**。

### 3.2 主對話 v1 自己寫錯、v2 已更正的三處(供明天引以為戒)

1. 寫「`authorizeAdminMutation` 是所有寫入的閘」—— **錯**。`apps/admin/src/lib/orders/status-option-actions.ts` 自己拼三道檢查、繞過共用閘(`:46`/`:52`/`:57` 與 `:126`/`:130`/`:133`);且漏列 `staff-actions.ts`
2. 寫「session payload 加欄後 rollback 會再登出一次」—— **錯**。`報價單/lib/session.ts:107-118` 的 `isPayload()` **只檢必需欄、容許額外欄** ⇒ revert 舊 validator 後新 cookie **仍有效、身分被靜默忽略**,比登出危險。改用 `v:2` 版本欄擋
3. 同時寫「身分必填」與「備援登入身分為空」—— **自相矛盾**。改為 `sub` 兩形狀(`{kind:'user',staff_id}` / `{kind:'fallback'}`)

---

## 4. 完整後台的範圍全圖

### 4.1 驗收標準(唯一)

`rebuild-spec` **§1「員工的一天」27 項**,最近一次實查 = **✅2 / ⚠️6 / ❌19**(fresh read-back 實測值,初版誤寫 3/6/18)。
北極星(Sean 逐字):「可以完整上線給員工使用,操作,修改網站。而且他們不是工程師」。

🔴 **N5 的附條件**:Sean 同意訂單域可先做,但逐字要求「**做到目標狀態**」= §1 清單全綠才算數,**不接受做一半**。

### 4.2 Epic 現況

| Epic | 內容 | 狀態 |
|---|---|---|
| E0-E9 | 搜尋 / 客戶累計消費 / 內容發布合約 / 圖片上傳 / 首頁媒體 / 權威鎖 / 同步商品後台 / 手動商品 / AI 改商品 / 後台強化 / 品牌落地頁 | 規劃在 `docs/specs/2026-07-25-site-wide-gap-and-admin-platform-plan.md` v3;**除 E8 外皆未開工** |
| **E8** 員工帳號與權限 | A1 staff 進 DB ✅ / A2 員工管理頁 ✅ / **B 真認證 = plan v3 就緒未開工** | 🔧 進行中 |
| **E10** 訂單閉環 | 計數器 / 退款退貨 UI / 快遞單號 / 備註 / 手動建單 / 匯款確認 / 改單 | ❌ 未開工,**三個前置未清**(§5) |
| **E11** 後台 UI 積木 | DataTable ✅(E11-1)/ Form ✅(E11-2)/ **Modal ❌** / toast ❌ / **E11-3 rowSpan+互動槽 ❌** | 🔧 一半 |
| **E12** 供應商主檔 | suppliers 表 + 供應商商品價目表 | ❌ 未開工;**N9 是否這期做 = Sean 仍未拍** |
| E13/E14 會計線 | — | ⏸️ Sean 拍 **Q3=C 整條延後**,研究已完成不必重查 |

### 4.3 施工序(Sean 07-25/26 定)

**E11 積木 → E8 員工權限 → E10 訂單閉環** →(員工能上工後才回頭)E13/E14。

🔴 **明天要重新評估這個序**:E8-B 從「一片」變成「十一片、跨兩 repo、中間不上線」,而 E10 對 27 項的貢獻最大。**序可能要改,但改序要 Sean 拍板**(§8-Q1)。

---

## 5. E10 動工前必清的三個前置(不可跳)

1. **C1 同日分批出貨的訂單編號後綴規則未定** —— 新竹物流**同日訂單編號不可重複**,分批出貨會撞。細節 `docs/reference/hct-logistics-api-reference.md`
2. 🔴 **`create_order` 已實證不可用於手動建單** —— `:284` `auth.uid` 為 NULL 直接 exception;`:356`/`:360` 品項必須是既有 catalog 變體。⇒ **需另開 admin 專用 RPC**,不能沿用
3. **schema 要吃三個 U 案**:U1 包裹表(一單多包裹)/ U2 改單改全部 / U3 多筆匯款

另:🔴 **Sean 待辦(擋 E10 出貨串接)**= 向新竹站所電腦負責人申請 API 帳號,**查貨與出貨是兩張不同的申請表**。

---

## 6. E8-B 認證線的交接狀態

- **plan v3 已就緒**:`docs/specs/2026-07-27-m4b-e8b-real-auth-line-plan.md`,含 §1 現況(全部附檔案:行號、主對話親讀)、§3 八項架構決策、§4 B0-B10 拆片與硬順序、§4b 驗收負向清單、§6 rollback、§9 codex 17 findings 對帳表
- **codex 關卡1 R1 已跑**(FAIL 17、全折入);**R2 尚未跑** —— 刻意留到六題拍完之後,免得審一份還有開放決策的東西。**明天應先跑 R2**
- 🔴 **一個未解設計題(plan §7.4)**:Q6=A「一路做完才上線」+ 報價單分支是 `main`(推即正式站)⇒ 11 片期間東西放哪?候選 (a) 長期 feature branch (b) 全藏 flag 後 (c) 混合(migration 走 expand 可先上、行為走 flag)。**這題沒答不要開始寫 code** —— 選錯會做到第 7 片才發現沒地方放

---

## 7. Sean 拍板總表(接手不得重問)

### 7.1 E8-B 認證線(六題,2026-07-26 + 07-27)

| 題 | 拍板 |
|---|---|
| Q1 | **B** 身分來自報價單,不在 admin 另建帳號 |
| Q5 | **B** 🔴「TOTP 裝置=身分」方案**作廢**(裝置有共用) |
| Q7 | **A** 帳號+密碼登入;TOTP **只在未記住的新裝置**才要 |
| Q8 | **A** 初始密碼由 **Sean 指定** |
| §7-Q6 | **A** 照 B0-B10 **一路做完才上線**,中間不部署 |
| §7-Q1 | **A** 備援共用密碼進來 **兩邊都唯讀**(admin + 報價單) |
| §7-Q5 | **A** 2FA 管理權限 **只有 `sean`** |
| §7-Q2 | **A** 既有 TOTP 裝置與備用碼 **全歸 `sean`** |
| §7-Q3 | **C** 帳號 = **email**(🔴 推翻 Claude 推薦的 A) |
| §7-Q4 | **A** 首次登入 **強制改密碼**(Sean 先答 B、聽完殘留風險後同日改 A) |
| 07-27 | **A** 共用密碼 `ADMIN_PASSWORD` **保留當備援**、不停用 |

🔴 **Q4=A 是稽核軌可信度的關鍵**:Q8=A 表示 Sean 指定初始密碼;若不強制改,Sean 永遠知道每個人的密碼 ⇒ 稽核軌上「`staff_1` 做的」無法排除是 Sean 做的,而「稽核軌變真證據」正是本線目標。**衍生工作見 plan §7.2** —— 其中最容易漏的一條:**強制改密碼的攔截點必須在所有入口之前、包含 SSO `authorize`**,否則員工可跳過改密碼頁直接走 SSO 進 admin。

### 7.2 後台大方向(2026-07-25/26)

N1 員工見經銷價、不見成本 / **N2=B 兩級角色**(成本是唯一分界線 ⇒ 免 RBAC 矩陣)/ N4=A 先做積木 / N5 訂單可先做但須 27 項全綠 / **Q3=C 會計線整條延後** / 成本走逐訂單品項快照 / **匯率與加成係數兩者都要快照** / 項目下拉受控 + 說明自由文字 / 401 由記帳士報、後台不自產。

### 7.3 UX 第二輪 U1-U7(2026-07-26,全數定案)

U1/U3/U5/U7=A;**U2=A** 改版「改全部 + 直改極簡」;**U4=A + 通道定案:LINE OA 推播給兩位員工 + 每日彙整 Email,Chrome 推播不做**;**U6=A** 改版「只做告知義務、不設期限」。全文 `docs/specs/2026-07-26-admin-ux-operability-review.md` §7。

### 7.4 畫面預覽十四項(2026-07-26)

memory `project_m4b-admin-preview-decisions`。重點:訂單量預期 **1-300 筆**(「量小所以不用做」的判斷一律失效)/ 已付款可取消 + 未退款可復原 / **圖庫題號=N6 不是 Q4** / 運費兩口徑(零錢櫃 vs 匯款)/ **前台忘記密碼是死連結 = 後台寄信按鈕的硬前置**。
artifact 現行網址 = `https://claude.ai/code/artifact/2061fa03-5626-4aaa-b172-f818eb0e21e8`(舊 `f8f18cd5` 已失效)。

---

## 8. 需 Sean 拍板(明天開工時問,別現在問)

- **Q1 施工序**:E8-B 變成 11 片跨兩 repo 之後,還是「E11→E8→E10」嗎?還是先把 E10 做完(對 27 項貢獻最大、不跨 repo)再回來做認證?
- **Q2 N9 供應商主檔(E12)這期做不做** —— 07-26 問過但未拍
- **Q3 E8-B 的承載方式**(plan §7.4 的 a/b/c)—— 這題也可由規劃 session 自己判後報備

---

## 9. 🔴 陷阱清單(踩過的,不要再踩)

| 陷阱 | 內容 |
|---|---|
| **Codex 拿「沙箱限制」遮真失敗** | E8-A2 實錘:它回報「admin build 因沙箱禁綁 port,1/2」,主對話實跑是 **0/2** —— 真因是 `'use server'` 檔 export 了常數物件。**它說「因環境限制未驗證」一律當「未知」,不等於「驗了會過」;build 一定要主對話自跑** |
| **Codex 預設模型不是 sol** | `-m gpt-5.6-sol` **必須顯式帶**(預設 terra);沙箱禁 socket ⇒ **它的測試數字不可信**,主對話自跑 |
| **突變測試假綠** | 必須先 `grep` 驗「替換真的發生」(殘留為 0),否則會把**無效突變**誤判成假綠。E8-A2 犯過一次 |
| **審查者給的外部事實也會錯** | #296 實錘:codex R1 誤把 WPT 同步 commit 當 Chromium 行為變更,主對話照抄進錢面註解;R2 自更正、主對話親讀 Blink 原始碼才定案。**錢/權限的論證要一手來源** |
| **staff seed id 逐字元不可改** | `sean`/`staff_1`/`staff_2`;`admin_audit_log.actor` 是 text 欄、27 筆已引用。不給 DELETE;`sean` 是 break-glass 永不可停用 |
| **`dev` = pcm-admin 正式站** | push 即部署。storefront 才看 `main` |
| **並行 session 共用 git index** | 每 `add` 立即 commit、一律帶 pathspec;**`--amend` 前必 `git log -1` 確認 HEAD 是自己那筆** |
| **報價單 `lib/session.ts` 是 runtime-neutral** | Edge middleware 與 Node route 共用 ⇒ 只用 `crypto.subtle`、**不 import `node:crypto`**、不 top-level await。破了整站 500 |
| **migration 不能靠 git revert 回復** | 一律 expand/contract:新欄先加成選填、兩端都上線才收緊。`sso_codes` 直接加必填欄會讓舊 `authorize` 當場 insert 失敗 |
| **正式 schema 用 `db push`、別用 MCP `apply_migration`** | MCP 會以當下時鐘重新編號 ⇒ 版本漂移 ⇒ `db push` 全面罷工(07-25 實錘) |
| **送對抗審查前必先凍結版本** | 審查期間改受審檔 = 判定沒對象(#296 實錘,codex 列 must-fix) |

---

## 10. 誠實邊界與未查證項

- 本 session **零 code / 零 migration / 零 DB / 零 flag / 未動 `.env*` / 未 push**;依鐵則 11,docs-only 不觸發三綠(未跑,不是跑了沒過)
- **E8-B plan 尚未經 codex R2 複審**(刻意,見 §6)
- 🔴 **plan §8 列的三項未查證,B0 必須補**:
  1. 報價單 B庫 **production** 是否與 repo migration 一致(repo grep 只證明 repo 未宣告 users 表,**不證明 production 無漂移**)
  2. `auth_state.require_2fa` 的**現值**(會實際改變 rollout 路徑)
  3. A庫 `staff` 三列與 `admin_audit_log` 27 筆為 E8-A1 當時實查,**本輪未複查**
- graphify 地圖含 **E8-A1 之前的舊節點**(`STAFF [staff.ts:15]`,hardcode 名單早已移除)⇒ 明天若要用地圖判連動面,**先刷圖**(🔴 必 `dedup=False`、刷前備份,見 memory `reference_graphify-update-dedup-fuzzy-eats-nodes`)

---

## 11. Git 狀態

- branch `dev`、樹乾淨、**未 push**(數量當場查 `git rev-list --count origin/dev..HEAD`,本檔產出當下=3)
- 🔴 **不自動 push、不主動提議 push** —— Sean 手動推 = review checkpoint
- 本 session 三個 commit 全為 docs;**`dev` 一推 pcm-admin 就重新部署**,但本次零程式碼變更 ⇒ 跑的是同一份 code

— END —
