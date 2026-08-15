# `#26` 員工帳號與權限 — 查證報告(B 窗夜跑,零 code、**不設計**)

> 交辦 = `主-B-015-DISPATCH`。零寫入(兩 repo `git status --porcelain` 皆 0)。
> 報價單只讀 **`origin/main`**;🔴 **正本在 mac mini、本機 clone 落後,這條缺口照留。未 ssh**(本機讀得完)。
> 🔴 **最重要的一句先講**:這題**不是從零開始的查證** —— Sean 已拍過 **14 題**、
> codex 關卡1 已跑到 **R2 FAIL / 34 must-fix / plan 判定不可施工需重寫**。**本報告的價值在指出它卡在哪,不是重做那份功課。**

## §1 我們這側:三個東西,沒有一個是身分

| 東西 | 實際 | 證據 |
|---|---|---|
| 操作者 | **使用者自己從下拉挑的 cookie** | `session/actor.ts:5-7` 逐字「actor 以 cookie 承載、內容來自使用者自行選擇。**這不是登入 / 授權邊界**」 |
| `staff` 表 | `id / label / is_manager / is_active` + 兩個時戳,**沒有密碼欄、沒有任何 auth 關聯** | `20260726120000_m4b_e8a1_staff_table.sql:12-24` 逐欄 |
| `is_manager` | 🔴 **零權限效果** —— 全 repo 非型別命中只有一處,是表格顯示 `? '是' : '否'` | `staff-table.tsx:38`;數法 `grep -rn "is_manager\|isManager" apps packages` 排除 `.test.` 後過濾 `if/&&/throw/guard/require` ⇒ 只剩該行 |

⇒ **admin 這側沒有「權限分級」這個機制**,只有一個會顯示在表格上的布林欄。
而 `actor` cookie 的值**會成為 `admin_audit_log.actor`**(`lib/audit/repository.ts:24`)⇒ **稽核軌記的是自陳身分。**

## §2 報價單那側:登入就是一個環境變數

- **密碼**:`app/api/admin/login/route.ts:136` 逐字 `const expected = process.env.ADMIN_PASSWORD;`
  ⇒ **全公司一組、沒有使用者表**。`admin_users` 在 `supabase/**` **零命中**(E8-B 未開工,與 memory 記載一致)。
- **2FA 的資料模型**:`totp_devices` 有 `label` / `created_by` / `last_used_at` / `last_used_ip`,**但沒有 `user_id`**;
  登入邏輯逐字「驗 TOTP(**任一裝置**)」(`login/route.ts:22`)⇒ **裝置是複數、身分是單數**。
- **2FA 的開關是單例表**:`auth_state` 定義為 `id boolean DEFAULT true` + `CHECK (id)` ⇒ **一列**,
  `require_2fa` / `token_version` / `totp_lockdown_until` 全是**全域**。
- **`login_attempts` 只記 `ip / ua / stage / outcome`** —— **沒有裝置 id、沒有人**。

🔴 **而且 2FA 現在是關的**:`STATUS.md:7` 逐字「**TOTP 實查為關閉狀態** —— `auth_state.require_2fa=false`、
`totp_devices` 0 列、`recovery_codes` 0 列」(來源 memory `project_quote-2fa-deployed-but-dormant`,
2026-07-27 對 production 實查)。⚠️ **那是 18 天前的實查,今天的值我沒查**(§6-2)。
⇒ **「要不要動 2FA」這題現在比想像中輕:沒有裝置要遷移、沒有人在用。**

## §3 `amr` / `auth_time` 能不能拿來認人?**不能,而且是設計上就不能**
`session.ts:18` 的 `AdminSessionAmr = 'pwd' | 'totp' | 'bootstrap' | 'recovery'` ——
**`amr` 說的是「用哪種方式通過」,不是「誰通過」**;`auth_time` 是時戳。
`session.ts:12` 逐字「報價單=共用密碼登入,SSO 只帶認證(amr/auth_time)、**無 per-user 身分**。SSO=認證,不是身分綁定」。
⇒ **這條路封死,不是漏接。**

## §4 「要讓每個員工有自己的帳號」要動哪裡 —— 已知範圍(不是我新估的)
memory `project_m4b-real-auth-line-decisions` 記載並經我對現況複驗:
**跨 2 個 repo + 2 台機器**(報價單正本在 mac mini)。原估「動 4 處」**已被 codex 關卡1 證實是低估** ——
真正的攔路虎是「報價單的整套 2FA 是**全公司一組**、不是**每人一份**」。
codex 具體抓到的形狀(我引 memory、**未自行複驗那三條 RPC**):
`regenerate_recovery_codes` 會刪**全公司**未用備用碼 / `disable_device_safe` 鎖算全公司裝置 /
`totp_lockdown_until` 全域 ⇒ 灌單一帳號可鎖死全員。
🔴 **Sean 的收束**:`Q5=A 第一期只做 email+密碼、完全不碰 TOTP`,2FA per-user 化另立 **E8-C 第二期**
⇒ 上面那三條 **在第一期全部 moot**。**這是這題目前最省事的事實。**

## §5 中間路(交辦第 4 題)—— 🔴 **Sean 已經評估過並否決了那條**
最自然的中間路是「用 TOTP 裝置當身分」。**`Q5=B` 逐字「TOTP 裝置=身分 方案作廢 —— 裝置有共用、認不出人」。**
我另外從資料面確認它確實不可行:`totp_devices` 無 `user_id`、`login_attempts` 不記裝置 id
⇒ **就算想事後推,資料也沒留。** 而 2FA 現在 0 裝置(§2)⇒ **連可推的樣本都不存在。**
**還剩的中間路只有一種**:維持自選 picker,但**在 UI 上停止讓它看起來像身分**
(例如把稽核欄位文案從「操作者」改成「自陳操作者」)。**零工程、零機制**,只誠實化。
⚠️ **我沒有把它列成建議** —— 那是文案與產品判斷,`#26` 的實質缺口不會因此變小。

## §6 鐵則 12 與 Sean 必須拍的
**鐵則 12② 權限 = 必然命中**(auth、session、SSO 邊界);⑤對外不可回收 = 若走 email 帳號要寄邀請信則是。
**Sean 要拍的(全部是既有拍板,我逐條開檔驗過還算不算數)**:
- **`Q2=A` 共用密碼保留當備援 —— 仍成立、未被推翻**,且被 `§7-Q1=A` 收緊為「備援進來**兩邊都唯讀**」。
- **`Q1'=A` 施工序 = 先 E10 訂單閉環、E8-B 押後 —— 仍是現行序**(`STATUS.md:5` 逐字,且 Sean 在得知資安顧慮後**二次確認**)。
- **未決的只有一件**:`#26` 要不要在 `#20/#22` 這條商品線之前插隊。**這是排序題,不是設計題。**

## §7 誠實缺口
1. **零執行** —— 沒查任何 DB、沒跑測試;§2 的 schema 全來自 `origin/main` 的 migration 檔。
2. 🔴 **「2FA 是關的」是 2026-07-27 的實查(18 天前)**,今天的 `require_2fa` / 裝置數**我沒查**(要 production 連線)。
   若這 18 天內有人開了 2FA,§2 末那句「比想像中輕」就不成立。
3. **codex 那 34 個 must-fix 我沒自己複驗** —— §4 引的三條 RPC 形狀是**轉述 memory**,我沒開報價單那三支函式本體。
4. **mac mini 正本未讀** —— `admin_users` 零命中只證明 `origin/main` 沒有,不證明那邊沒有半成品。
5. **我沒盤 `#26` 要幾片** —— memory 記 codex 判「plan v3 不可施工、需重寫」,**重寫後幾片是未知**,我不用舊片數。
