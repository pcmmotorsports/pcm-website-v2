# 2026-09-15 · 後台看得到事故紀錄(pcm_incident)—— plan

> 設計窗。來源:`~/pcm-mailbox/稽核-ecommerce-cia-20260915.md` **P2-7**;Sean 逐字「依照建議」= 先寫計畫。主視窗 pcm-website-v2-b7 派工。
> **本檔只是 plan,零碼、零 migration。** 碰新 DB 函式 + GRANT(權限)+ 後台頁 ⇒ 鐵則 8 + 12,等批。
> 事實由設計窗 2026-09-15 親讀 repo 核對;正式庫只唯讀。
> 🔴 **UI 還沒對 OD `pcm-524f` 稿**:2026-09-15 兩次連 OD daemon(`127.0.0.1:7456`)都連不上。§4-C 的畫面是照既有「操作紀錄」頁的樣子寫的,**開工前一定要先開 OD 對稿**,稿上有就照稿。

## 1. 白話

- 系統有一張「小事故表」:凡是**被刻意吞掉的失敗**(例如刷卡全額退款後自動取消沒做成、LINE 轉發失敗)都會記一筆。
- 今天這些事故**只會變成數字**:每天 09:00 / 21:00 的異常告警信和 LINE 會寫「某某事故 N 筆」。
- **後台完全看不到是哪幾張單、什麼錯。** 員工要處理,只能叫工程查資料庫。
- 本 plan:後台加一頁「事故紀錄」,列出最近的事故:什麼時間、哪一種、哪一張單(可以點進訂單)、錯誤訊息。

## 2. 查到的事實

| # | 事實 | 出處 |
|---|---|---|
| 1 | 表 `public.pcm_incident(id bigserial, kind text, subject_id uuid, detail text, created_at timestamptz, resolved_at timestamptz)`;部分索引 `(kind, created_at DESC) WHERE resolved_at IS NULL` | `20260905290000_m4b_pending_refund_open_failure_incident.sql:116-134` |
| 2 | RLS 開、**0 條 policy**;table 與 sequence 對 `PUBLIC / anon / authenticated / service_role / payment_confirmer` **全部 REVOKE** ⇒ 連 `service_role` 都讀不到 | 同檔 `:137-161` |
| 3 | 唯讀角色也讀不到(`has_table_privilege = f`);另有 after-check 擋 `pcm_readonly` 被授權 | 2026-09-15 唯讀實查;`20260906380000_m4b_pcm_readonly_column_grants.sql:196-207`(小幫手讀,設計窗未逐行重讀) |
| 4 | 唯一讀取口 `get_pcm_incident_health()`:只回 `open_total`、`open_by_kind`(各 kind 筆數)、`oldest_open_at`;**不回任何單筆、不回 detail / subject_id**;EXECUTE 只給 `service_role` | 同檔 `:192-214` |
| 5 | `kind` 封閉集,最新 6 種:`pending_refund_open_failed` / `refund_over_total` / `auto_cancel_skipped` / `auto_cancel_failed` / `line_forward_failed` / `auto_cancel_live_shipment` | `20260916010000_m4b_p01_auto_cancel_split_by_shipment_state.sql:67`(`APPLIED.tsv:672`) |
| 6 | `detail` = 寫入時的原始字串(多半是 `SQLERRM`),截 2000 字 ⇒ **內容是資料庫錯誤訊息,可能含內部欄位名、數值** | 同 #1 檔 `:176-178` |
| 7 | `resolved_at` 欄位存在,但**repo 裡沒有任何地方寫它**(沒有「已處理」流程) | 小幫手 grep;設計窗未全樹重搜,**吻合但未證實** |
| 8 | 正式庫事故筆數:**唯讀角色讀不到,沒量到**(不是 0) | 同 #3 |
| 9 | 最接近的既有頁:後台「操作紀錄」`/settings/audit`:server component、`LIMIT = 50`、讀取失敗顯示錯誤區塊不顯示空白、另查管理者身分 | `apps/admin/src/app/settings/audit/page.tsx:83-116`、`:169` |
| 10 | 操作紀錄的讀法:`getAdminAuditLogReader()` 用 service client + 具名欄位 select,錯誤 throw 不吞 | `apps/admin/src/lib/orders/order-repository.ts:88-101` |
| 11 | 側欄項目:`AUDIT_NAV_ITEM = { key: 'audit', label: '操作紀錄', icon: 'clock', href: '/settings/audit' }`;**必須寫成一行**,`app-sidebar.test.ts` 用 regex 抽字面 | `apps/admin/src/components/layout/nav-items.ts:118-124` |
| 12 | 管理者判斷:`resolveManagePermission(logTag)` ⇒ `'yes' / 'no' / 'unknown'`(`is_active && is_manager`) | `apps/admin/src/lib/session/resolve-manage-permission.ts` |
| 13 | repo 內沒有任何事故頁的設計稿;admin 側 0 個測試碰 `pcm_incident` | 小幫手 grep `design-reference/`、`apps/admin` |

## 3. 關鍵限制

- 🔴 **後台不能直接 `.from('pcm_incident')`**:事實 #2,`service_role` 被收掉,會回 `42501`。
  ⇒ **一定要新開一支 SECURITY DEFINER 函式當門**,照 `get_pcm_incident_health()` 的窄門寫法。**不加 policy、不 GRANT SELECT**:那會打開一條直接讀表的路,也會讓 #3 的 after-check 那一族斷言失去意義。
- 🔴 `detail` 是資料庫錯誤原文(#6)⇒ **誰能看**要先定(Q1)。

## 4. 做法

### 4-A DB:一支讀取函式(schema + 權限)
- `public.admin_list_pcm_incidents(p_limit integer, p_open_only boolean)` RETURNS TABLE `(id bigint, kind text, subject_id uuid, detail text, created_at timestamptz, resolved_at timestamptz)`
  - `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''`
  - `p_limit` 夾在 1..200;`ORDER BY created_at DESC, id DESC`
  - `p_open_only = true` 只回 `resolved_at IS NULL`(走既有部分索引)
- ACL:`REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role, payment_confirmer`;`GRANT EXECUTE … TO service_role`。**`pcm_readonly` 不給**。
- 新物件照 `docs/patterns/revoking-function-execute-in-supabase.md` 做。

### 4-B 後台讀取層
- `apps/admin/src/lib/incidents/incident-repository.ts`:照 `getAdminAuditLogReader()`(#10)的形狀,`.rpc('admin_list_pcm_incidents', { p_limit, p_open_only })`,錯誤 throw。
- `kind` 中文標籤表 `INCIDENT_KIND_LABEL: Record<IncidentKind, string>`,型別的值域與 CHECK 那 6 種一一對應;加一格測試對 migration 的 CHECK 字面(比照既有 `packages/adapters/src/payment/incident-kind-two-truths.test.ts` 的做法)⇒ **DB 加第 7 種而標籤表沒加會紅**。

  | kind | 標籤(草擬) | `subject_id` 是什麼 |
  |---|---|---|
  | `pending_refund_open_failed` | 補開待退款失敗 | 訂單 |
  | `refund_over_total` | 退款超過訂單總額 | 🔴 **待開工時逐一核對寫入點** |
  | `auto_cancel_skipped` | 自動取消略過 | 訂單(待核) |
  | `auto_cancel_failed` | 自動取消失敗 | 訂單(待核) |
  | `auto_cancel_live_shipment` | 自動取消遇到已出貨 | 訂單(待核) |
  | `line_forward_failed` | LINE 轉發失敗 | 🔴 可能是 NULL(待核) |

  ⇒ 只有核對確定是訂單 id 的 kind 才畫「查看訂單」連結;其餘只印原值。**不猜。**

### 4-C 後台頁
- 路由 `/settings/incidents`,側欄加 `{ key: 'incidents', label: '事故紀錄', icon: …, href: '/settings/incidents' }`(一行、放在「操作紀錄」旁邊;icon 開工時從既有 icon 集挑)。
- 版面(🔴 OD 稿未對,先照「操作紀錄」頁):
  - 上方兩個切換:「未處理」(預設)/「全部」。
  - 表格欄:時間 · 種類(中文標籤)· 訂單(可點)· 錯誤訊息(預設收合,點開看全文)。
  - 筆數:最近 50 筆,與操作紀錄同一個上限。
  - 讀取失敗:顯示錯誤區塊(同 #9),**不顯示「沒有事故」** —— 那兩件事長得一樣就會騙人。
  - 0 筆:顯示「目前沒有未處理的事故」。
- 權限依 Q1。

### 4-D 不在本 plan(另議)
- 「標記已處理」按鈕(寫 `resolved_at`)。🔴 寫下去之後,**每天兩次的告警信數字會跟著變少**(告警只數 `resolved_at IS NULL`,#4)⇒ 等於員工可以讓告警閉嘴,要另外拍板,也要寫操作紀錄。
- 事故保存期限 / 清理。

## 5. 影響

- 客人:無。
- 員工:後台多一頁;依 Q1 決定誰看得到。
- 資料庫:多一支只讀函式;表本身權限**一個字都不改**。
- 告警信 / LINE:不變(本 plan 不寫 `resolved_at`)。

## 6. Rollback

- 後台:revert 一顆 commit(頁面 + 側欄 + repository)。
- DB:`DROP FUNCTION public.admin_list_pcm_incidents(integer, boolean)`;表與既有函式沒動,不需要其他步驟。
- 順序:先退後台、再退函式(反過來的話頁面會先變成讀取失敗區塊,不會壞站,但不好看)。

## 7. 驗收

1. 拋棄式 PG:造 6 種 kind 各 1 筆(其中 1 筆已 resolved)⇒ `p_open_only = true` 回 5 筆、`false` 回 6 筆;排序最新在上;`p_limit = 0` 夾成 1、`999` 夾成 200。
2. ACL:`anon / authenticated / pcm_readonly / payment_confirmer` 呼叫 ⇒ 權限錯誤;`service_role` 可以。**表本身**對 `service_role` 仍是 0 權限(直接 select 仍 `42501`)。
3. 標籤表測試:對 CHECK 字面 6 種一致;故意在測試裡多塞一種 ⇒ 紅。
4. 本機後台(`scripts/admin-probe`,不碰正式庫):造事故列,開 `/settings/incidents` 肉眼看;管理者 / 非管理者兩個身分各看一次(依 Q1 的結果);把函式改名 ⇒ 頁面顯示讀取失敗區塊,不是「沒有事故」。
5. 側欄測試 `app-sidebar.test.ts` 綠(新項目被 regex 抽到)。
- 三綠;codex 一輪(權限 + 新 SECURITY DEFINER)。

## 8. 要批的

```
Q1:事故紀錄誰看得到?
A:  甲 只有管理者(推薦):錯誤訊息是資料庫原文;非管理者點側欄看到「需要管理者權限」
  | 乙 所有員工看得到列表, 錯誤全文只有管理者能展開
  | 丙 所有員工都能看全部

Q2:畫面要等 OD 稿嗎?
A:  甲 先開 OD pcm-524f 找稿, 有稿照稿;沒有稿再照「操作紀錄」頁的樣子做(推薦)
  | 乙 不找稿, 直接照「操作紀錄」頁的樣子做
```

## 9. 估時

`subject_id` 逐 kind 核對 ~20 分;migration + ACL 驗 ~40 分;後台 repository + 頁面 + 側欄 + 測試 ~60 分;本機肉眼 ~15 分;codex 一輪另計。拆兩片(DB 一片、後台一片)。
