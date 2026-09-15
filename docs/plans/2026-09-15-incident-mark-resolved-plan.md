# 2026-09-15 · 後台事故紀錄頁加「標記已處理」—— plan

> 設計窗。主視窗 pcm-website-v2-b7 派工;Sean 逐字「甲 = 要, 先寫計畫給你看」。
> 前一片:`docs/plans/2026-09-15-admin-incident-list-plan.md`(P2-7,已上線,當時刻意不做這顆)。
> 鐵則 8(schema + 權限 + 稽核)⇒ 本檔批了才開工。只寫 plan,不寫碼、不寫 migration。

---

## 1. 白話

- 現在事故只要進來一筆,**永遠不會消失**:沒有任何地方能把它標成「處理完了」。
- 所以 Sean 每天早晚兩封告警信、LINE 早報都會一直叫,**就算事情早就處理好了**。叫久了就沒人看,真的新事故會被淹掉。
- 這片做的事:事故紀錄頁每一筆加一顆「標記已處理」,按的時候寫一句做了什麼;按完那筆就不算進告警。
- 誰按的、什麼時候、寫了什麼,會進「操作紀錄」,事故頁上也看得到。
- **錯了會怎樣**:按錯 ⇒ 那筆從告警消失。有幾種事故系統之後會自己再記一筆(問題還在的話),有幾種不會 ⇒ 所以要有「取消已處理」(Q3)。
- **要 Sean 答 3 題**(§8):誰能按、要不要必填說明、要不要能取消。

## 2. 查到的事實

| # | 事實 | 出處 |
|---|---|---|
| 1 | 表 `public.pcm_incident(id bigserial, kind, subject_id uuid, detail, created_at, resolved_at)`;**沒有**「誰處理 / 處理說明」欄 | `20260905290000:120-129` |
| 2 | 表對 PUBLIC / anon / authenticated / service_role / payment_confirmer 全部 REVOKE ALL;RLS 開、0 條 policy;寫只走 definer `pcm_incident_log()`,讀只走 definer 函式 | `20260905290000:137-161` |
| 3 | `resolved_at` 全 repo **沒有寫入端**(其他 3 處 `SET resolved_at` 是另一張表 `payment_double_charge_anomalies`) | `20260907140000:278-284`;本次 grep 非註解 `FROM public.pcm_incident` 只有讀與去重 |
| 4 | 正式庫 2026-09-15 18:3x 事故 **0 筆** | 主視窗管理帳號強制唯讀量(轉述,本窗未親量) |
| 5 | `get_pcm_incident_health()` 回 `open_total` / `open_by_kind` / `oldest_open_at`,**三個都只數 `resolved_at IS NULL`** | `20260905290000:193-205` |
| 6 | 告警信:`pcmIncidentOpenTotal > 0` 就進 `shouldAlert`(一天兩班 UTC 01:00 / 13:00) | `packages/use-cases/src/check-anomaly-alerts.ts:3138` |
| 7 | 告警信事故段文字寫死「目前沒有已處理的寫入口」「累計不是此刻還壞的張數」 | `check-anomaly-alerts.ts:1815-1826` |
| 8 | LINE 早報:`open_total − line_forward_failed > 0` ⇒「錢」;`line_forward_failed > 0` ⇒「LINE」 | `packages/use-cases/src/owner-line-digest.ts:94-98` |
| 9 | 後台讀取:`admin_list_pcm_incidents(p_limit, p_open_only)` RETURNS TABLE 6 欄,EXECUTE 只給 service_role | `20260916040000:48-72` |
| 10 | 事故頁檔頭寫明「不做標記已處理」 | `apps/admin/src/app/settings/incidents/page.tsx:13` |
| 11 | 後台兩道既有授權閘:`authorizeAdminMutation()`(在職員工)、`authorizeManagerMutation()`(在職 + `is_manager`) | `apps/admin/src/lib/session/authorize.ts:31`、`:99`;`staff.ts:206` |
| 12 | 管理者閘**也寫在 DB 那一層**的成例:RPC 內查 `staff.is_active AND is_manager`,不是 ⇒ `RAISE '無權執行此操作'`。理由:後台 key 是 service_role,PostgREST 直打不經 TS 閘 | `20260915040000:7-8`;`20260915180000:132-143` |
| 13 | 稽核表 `admin_audit_log(actor, action, target, before, after, reason, request_id, source_app)`;BEFORE INSERT trigger 補 `actor_label` / `actor_is_manager` 當下快照 | `20260712210000:43-59`;`20260914110000:6-12` |
| 14 | RPC 同交易寫稽核的成例:`admin_upsert_supplier`(p_actor + p_request_id,稽核同交易) | `20260915180000:49-260`;`apps/admin/src/lib/supplier-actions.ts:24-27` |
| 15 | 操作紀錄頁動作中文字典 `AUDIT_ACTION_LABEL`(**沒有分母守門**,漏了不會紅);target 前綴字典 `TARGET_HREF` / `TARGET_LABEL`,格式 `<entity>:<id>` | `apps/admin/src/lib/audit/audit-list-view.ts:43`、`:168-186` |
| 16 | 🔴 actor 是否為「真登入身分」取決於 `ADMIN_REQUIRE_REAL_IDENTITY`;旗標關著時 actor 是自選 cookie ⇒ 冒名過得了閘 | `staff.ts` `isActiveManager` docstring「路二」;`supplier-actions.ts:29-30`。**正式站旗標值:未確認** |

### 2-1 八種事故:誰寫、會不會「標了已處理之後又被寫一筆」

去重條件逐支讀最新一代。「會再寫」= 問題還在、而系統下一次又走到那一行 ⇒ 新開一筆未處理(舊的那筆維持已處理)。

| kind | 寫入點(最新一代) | 去重 | 標已處理後,問題還在時 |
|---|---|---|---|
| `pending_refund_open_failed` | `pcm_noncard_settle_recompute` `20260916060000:221` | **無**(每次失敗都寫) | 下一次重算又失敗 ⇒ 再寫(標之前本來就會一直疊) |
| `refund_over_total` | `pcm_sync_order_refund_payment_status` `20260914060000:236-246` | 同單同 kind `resolved_at IS NULL` 就不寫 | 那張單**下一次有退款動作**時 ⇒ 再寫一筆;沒有新動作就不會 |
| `auto_cancel_skipped` | `pcm_auto_cancel_on_full_card_refund` `20260916010000:153-200`(4 處) | 同上;另「需要手動聯絡客人」而舊列沒寫過那句 ⇒ 補寫 | 下一次同步走到同一分支 ⇒ 再寫 |
| `auto_cancel_failed` | 同函式 `:217-222` | 同上 | 下一次同步再失敗 ⇒ 再寫 |
| `auto_cancel_live_shipment` | 同函式 `:226-231` | 同上 | 單已取消 ⇒ 函式開頭就 return(`cancelled_at IS NOT NULL`,`:108-109`)⇒ **不會再寫** |
| `line_forward_failed` | `pcm_incident_log_line_forward_failed` `20260914100000:64`,`subject_id` NULL | **無** | 每次轉發失敗都寫(與標不標無關) |
| `settle_recompute_failed` | `pcm_noncard_settle_recompute` `20260916060000:376-381` | 同單同 kind `resolved_at IS NULL` | 🔴 重試排程**每 10 分鐘**重算 ⇒ 還壞著的話 **10 分鐘內就再寫一筆** |
| `settle_retry_gave_up` | `pcm_settle_retry_sweep` `20260916060000:505-513` | 同上,且只在**新蓋一個放棄章**時寫 | 放棄章 24 小時後拿掉重數,再放棄一次 ⇒ 再寫 |

⇒ 📌 **重點**:`settle_recompute_failed` 這種「沒修好就先按」會在 10 分鐘內冒回來 —— 那是對的方向(沒修好就不該安靜)。
⇒ 🔴 **反方向才危險**:`refund_over_total`、`auto_cancel_live_shipment`、`line_forward_failed` 按下去之後**系統不會自己叫回來**。按錯就靜音 ⇒ Q3「取消已處理」的理由。
⇒ 既有去重全部已經帶 `resolved_at IS NULL`(`20260907140000` 當年就是為了今天這顆鈕補的)⇒ **寫入端一行都不用改**。

## 3. 關鍵限制

- 表對每個角色都隱形(#2)⇒ 寫入只能是 SECURITY DEFINER 函式,不能 `.from('pcm_incident').update()`。
- 加欄 = `ALTER TABLE` 拿 ACCESS EXCLUSIVE。這張表的寫入端在**收款 / 退款的交易裡**(#2-1)⇒ 貼的那一刻若卡鎖,收款交易會等。表只有個位數列 ⇒ 鎖握很短;照 0915 拍板「鎖表的板避開客人多的時段」,`lock_timeout 5s`。
- 告警信與 LINE 早報的**判斷邏輯不用改**(#5–#8 本來就只數未處理);只改信裡那兩句寫死的「沒有寫入口」(#7)。

## 4. 做法

### 4-A DB(一支 migration)

**① 表加兩欄 + 一條一致性 CHECK**
- `resolved_by text`(staff id,與 `admin_audit_log.actor` 同形)、`resolution_note text`
- `CHECK ((resolved_at IS NULL) = (resolved_by IS NULL))`(Q2 甲時再加 `AND (resolved_at IS NULL) = (resolution_note IS NULL)`)
- 現有列全是 `resolved_at IS NULL`(#3)⇒ CHECK 驗證不會失敗;前置閘仍逐列驗「沒有任何 `resolved_at IS NOT NULL`」,有就停(有人手動 UPDATE 過)。
- 不加 GRANT(維持 #2 全隱形)。

**② 標記已處理:`public.admin_resolve_pcm_incident(p_id bigint, p_actor text, p_request_id text, p_note text) RETURNS jsonb`**
- SECURITY DEFINER、`SET search_path = ''`、OWNER postgres;REVOKE ALL FROM PUBLIC / anon / authenticated / payment_confirmer;**GRANT EXECUTE 只給 service_role**。
- 順序:參數檢查(actor / request_id 非空、長度、控制字元,抄 `20260915180000:119-155`)→ **身分閘**(Q1:甲 = `staff.is_active AND is_manager`;乙 = `is_active`)不過 ⇒ `RAISE '無權執行此操作'` → 說明檢查(Q2)→ `SELECT … FOR UPDATE` 鎖那一列 → 找不到 ⇒ 回 `{"result":"not_found"}` → **已經是已處理 ⇒ 回 `{"result":"already"}`,不寫第二筆稽核**(重按冪等)→ `UPDATE SET resolved_at = now(), resolved_by = v_actor, resolution_note = v_note` → 同交易 `INSERT admin_audit_log(action 'incident.resolve', target 'incident:<id>', before {resolved_at:null}, after {resolved_at, resolved_by}, reason = 說明)` → 回 `{"result":"resolved"}`。
- 不驗「問題真的修好了沒」:八種各有各的判準,做不完;靠 #2-1 那些「會再寫」的自己冒回來。

**③ 取消已處理(Q3 甲才做):`public.admin_reopen_pcm_incident(p_id bigint, p_actor text, p_request_id text, p_reason text) RETURNS jsonb`**
- 同權限、同身分閘、原因必填。
- 🔴 **同單同 kind 已經有另一筆未處理 ⇒ 拒絕,回 `{"result":"superseded"}`**(系統已經重寫過一筆,再打開會變兩筆同一件事、告警多算)。`line_forward_failed`(subject NULL)不適用這條。
- 清 `resolved_at / resolved_by / resolution_note` 三欄 → 稽核 `incident.reopen`(before 帶舊的處理人與說明,因為欄位被清掉之後只剩稽核留得住)。

**④ 讀取函式換一代:`admin_list_pcm_incidents` 多回 `resolved_by`、`resolution_note`**
- RETURNS TABLE 改形狀 ⇒ `CREATE OR REPLACE` 做不到,要同交易 `DROP FUNCTION` + 裸 `CREATE` + ACL 逐字搬(`20260916040000` 那組)。
- 本體其餘逐字不動。

**⑤ 前置 / 後置閘**:照 `20260916040000` 同形(owner / secdef / search_path;anon / authenticated / payment_confirmer / pcm_readonly 無 EXECUTE、service_role 有;§3.5 anon 枚舉零列;表仍無任何欄位權限)。後置閘另實打:不存在的 actor ⇒ `無權執行此操作`;Q1 甲時非管理者 ⇒ 同句。

### 4-B 後台

- `apps/admin/src/lib/incidents/incident-repository.ts`:`IncidentRow` 多 `resolvedBy` / `resolutionNote`;新增 `resolveIncident()`(與 Q3 甲的 `reopenIncident()`),`.rpc(... as never)`,錯誤分流:`無權執行此操作` ⇒ denied、其餘 DB error ⇒ error;回傳 `result` 不認得 ⇒ throw(不當成功)。
- 新檔 `apps/admin/src/lib/incidents/incident-actions.ts`(`'use server'`):形狀抄 `supplier-actions.ts` —— 授權閘(Q1 甲 `authorizeManagerMutation` / 乙 `authorizeAdminMutation`)→ 解析 → repository → PRG `redirect('/settings/incidents?r=<code>')`,redirect 目標寫死。**稽核在 RPC 同交易,action 裡沒有稽核碼**(同 supplier)。
- 事故頁 `page.tsx`:
  - 未處理那一列:錯誤訊息 `<details>` 裡加一個小表單(說明輸入框 + 「標記已處理」鈕)。Q1 甲時,非管理者看不到表單(只看);判斷走既有 `resolve-manage-permission.ts`(讀取不擋,Sean「都可以看」不變)。
  - 已處理那一列:狀態欄顯示「已處理 · 誰 · 時間」,說明放 `<details>`;Q3 甲時旁邊一顆「取消已處理」(同樣要寫原因)。
  - 頁首 `?r=` 結果訊息(已標記 / 已經是已處理 / 無權 / 找不到 / 已有新的一筆,不必重開 / 失敗請再試)。
  - 檔頭第 13 行那句「不做」改成指向本 plan。
  - 表單下方固定一句:「問題還在的話,有些種類系統下一次碰到會再記一筆。」
- 操作紀錄頁:`AUDIT_ACTION_LABEL` 加 `'incident.resolve': '標記事故已處理'`(與 `'incident.reopen': '取消事故已處理'`);`TARGET_LABEL` 加 `incident: '事故紀錄'`、`TARGET_HREF` 加 `incident: () => '/settings/incidents?all=1'`(沒有單筆頁)。
- 沒有 OD 稿 ⇒ 版面照「操作紀錄」頁與既有 `note-delete-form.tsx` 的小表單(Sean P2-7 Q2 甲:沒稿照既有頁)。

### 4-C 告警信文字

- `check-anomaly-alerts.ts:1815-1826`:拿掉「目前沒有已處理的寫入口」;改成「處理完到後台『事故紀錄』按已處理,就不再算進這裡」。`settle_*` 那兩句的「累計」語意改寫成「沒按已處理之前會一直算」。
- `:1804` 下一步那行加上 `/settings/incidents`。
- LINE 早報 `owner-line-digest.ts`:邏輯不動。

### 4-D 不在本 plan

- 一次標多筆 / 整種標完(正式庫 0 筆,#4)。`line_forward_failed` 沒有去重,將來若一次累積很多再議。
- 自動判斷「問題真的修好了」然後自己結案。
- 讓事故消失前先檢查那張單的現況。

### 4-E 改動檔清單

- `supabase/migrations/<版本>_m4b_incident_mark_resolved.sql` + `supabase/rollbacks/<版本>-rollback.sql`
- `apps/admin/src/lib/incidents/incident-repository.ts`(+ test)
- `apps/admin/src/lib/incidents/incident-actions.ts`(新,+ test)
- `apps/admin/src/app/settings/incidents/page.tsx`(+ `page.test.tsx`)
- `apps/admin/src/lib/audit/audit-list-view.ts`(+ test)
- `packages/use-cases/src/check-anomaly-alerts.ts`(+ 相關 test 的字面)

## 5. 影響

- 客人:無。
- 員工:事故頁多一顆鈕(Q1 決定誰看得到鈕);看的權限不變。
- Sean:按了已處理的那筆,當天起不再進告警信與 LINE 早報;操作紀錄多兩種動作。
- 收款 / 退款:寫入端零改動;貼板那一刻 `ALTER TABLE` 可能讓收款交易最多等 5 秒(§3)⇒ 避開客人多的時段貼。
- ACL:新增 2(或 1)支 public 函式 + 讀取函式換一代 ⇒ 貼完照 0914 拍板跑 `pcm_acl_approve_latest`(p_note 帶版本號)。
- 部署順序:新 `.rpc(` 名稱 + 讀取函式多兩欄 ⇒ **板先貼、APPLIED.tsv 同顆,程式才合 dev**(舊碼配新函式:多出來的欄不影響;新碼配舊函式:形狀檢查會 throw ⇒ 整頁讀取失敗)。

## 6. Rollback

1. 先退程式(revert 後台那顆 commit):鈕消失,頁回到只讀。
2. 再跑 rollback 檔(同交易):DROP 兩支寫入函式 → 讀取函式 DROP + 按 `20260916040000` 原樣重建 + ACL → DROP CHECK → DROP 兩欄。
3. 🔴 **退回不會把已處理的事故改回未處理**:`resolved_at` 是原本就有的欄,留著值;被標過的仍不進告警。要全部打開 ⇒ 另寫一句 UPDATE,不放進 rollback(不猜意圖)。
4. 誰按過、寫了什麼:欄位丟掉後仍在 `admin_audit_log`。

## 7. 驗收

1. 拋棄式 PG(`~/pcm-mailbox/schema-dump-20260915/up.sh`,依版本號套到 188):
   - 八種各造 1 筆 ⇒ 標 1 筆 ⇒ `get_pcm_incident_health().open_total` 少 1、`open_by_kind` 那種少 1;`admin_list_pcm_incidents(50, true)` 不含它、`false` 含它且帶 `resolved_by` / `resolution_note`。
   - 重按同一筆 ⇒ `already`,`admin_audit_log` 仍只有 1 筆。
   - 不存在的 actor、停用員工 ⇒ `無權執行此操作`;Q1 甲時非管理者同句;Q2 甲時空說明 ⇒ 擋。
   - 不存在的 id ⇒ `not_found`。
   - 🔴 重寫互動實測兩種:`settle_recompute_failed`(標了 ⇒ 再讓重算失敗 ⇒ 新開一筆)、`refund_over_total`(標了 ⇒ 再叫一次同步 ⇒ 新開一筆)。
   - Q3 甲:取消已處理 ⇒ 回到未處理、稽核 `incident.reopen` 的 before 帶舊處理人;已有同單同 kind 新列 ⇒ `superseded` 且不動。
   - CHECK:手動只填 `resolved_at` 不填 `resolved_by` ⇒ 被擋。
   - ACL 後置閘全過;rollback 後函式與欄位都不在、讀取函式回到 6 欄、再重貼一次 OK。
2. 本機後台(`scripts/admin-probe`):管理者 / 非管理者兩個身分各走一次;標完頁面訊息對、狀態欄變、操作紀錄頁出現中文動作與「事故紀錄」連結。
3. 告警信:`check-anomaly-alerts` 相關測試改字面後全綠;信件文字不再出現「沒有已處理的寫入口」。
4. 三綠 + 動到的測試檔;codex 缺席到 09-20 ⇒ DB 片與後台片各過一輪專案版 adversarial-reviewer。
5. 上線後:正式庫目前 0 筆 ⇒ 沒有東西可按;等下一筆事故出現時 Sean 走一次「看 → 處理 → 按已處理 → 下一封告警信不再列」。

## 8. 要批的

```
Q1:誰能按「標記已處理」?(看的權限不變:員工都看得到)
A:  甲 只有管理者(DB 與後台兩層都擋)(推薦)
    乙 所有在職員工
    ⇒ 推甲的理由:按一下就讓那筆從你的告警信消失,而八種裡有六種跟錢有關。
       跟「改品項金額只有管理者能改」同一條線(0914 Q1 甲)。
    ⚠️ 兩個選項都一樣:actor 是不是真登入的人,看 ADMIN_REQUIRE_REAL_IDENTITY(正式站目前值未確認)。

Q2:按的時候要不要必填「做了什麼」?
A:  甲 必填(推薦)
    乙 可以不寫
    ⇒ 推甲的理由:這句是事後唯一知道「當時怎麼處理的」的地方;事故本身只寫錯在哪, 不寫怎麼修。

Q3:按錯了能不能「取消已處理」?
A:  甲 可以, 同樣的人才能按、要寫原因;系統已經重記一筆新的就不讓開(推薦)
    乙 先不做, 按錯找維護者用 SQL 改
    ⇒ 推甲的理由:「退款超過訂單總額」「LINE 轉發失敗」這幾種按下去之後系統不會自己叫回來(§2-1)
       ⇒ 按錯就等於永遠靜音。
```

## 9. 估時與上線順序

- migration + 前置 / 後置閘 + rollback + 拋棄式 PG 驗收 ~90 分;後台片 ~60 分;告警文字 ~15 分;兩輪審查 ~40 分。
- 順序:DB 片 commit → 審 → 後台片 + 告警文字 commit → 審 → 回報主視窗 → **避開客人多的時段貼板** → 跑 `pcm_acl_approve_latest` → APPLIED.tsv 同顆 → 程式合 dev。
