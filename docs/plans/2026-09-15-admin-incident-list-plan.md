# 2026-09-15 · 後台看得到事故紀錄(pcm_incident)—— plan

> 設計窗。來源:`~/pcm-mailbox/稽核-ecommerce-cia-20260915.md` **P2-7**;Sean 逐字「依照建議」= 先寫計畫。主視窗 pcm-website-v2-b7 派工。
> **本檔只是 plan,零碼、零 migration。** 碰新 DB 函式 + GRANT(權限)+ 後台頁 ⇒ 鐵則 8 + 12,等批。
> 事實由設計窗 2026-09-15 親讀 repo 核對;正式庫只唯讀。
> 🔴 **UI 還沒對 OD `pcm-524f` 稿**:2026-09-15 三次連 OD daemon(`127.0.0.1:7456`)都連不上。§4-C 的畫面照既有「操作紀錄」頁寫,**開工前再開 OD 對稿**,稿上有就照稿(Sean Q2 = 甲)。
> 🔁 **R2 版(2026-09-15)**:專案版 adversarial-reviewer(opus)R1 必修 2 條 + 小問題 7 條已改進本檔,改動處標 `[R1]`。codex 缺席到 09-20,本 plan 只有這一路審查。
> ✅ **R2 PASS**(同一位審查員):兩條必修確認關閉;R2 小問題 4 條已照改,標 `[R2]`(`:214` 格數、`nav-items.test.ts` 不動、`]::text[]` 與裸 CREATE、標籤表鍵加引號)。

## 1. 白話

- 系統有一張「小事故表」:凡是**被刻意吞掉的失敗**(例如刷卡全額退款後自動取消沒做成、LINE 轉發失敗)都會記一筆。
- 今天這些事故**只會變成數字**:每天 09:00 / 21:00 的異常告警信和 LINE 會寫「某某事故 N 筆」。
- **後台完全看不到是哪幾張單、什麼錯。** 員工要處理,只能叫工程查資料庫。
- 本 plan:後台加一頁「事故紀錄」,列出最近的事故:什麼時間、哪一種、哪一張單(可以點進訂單)、錯誤訊息。
- ✅ **Sean 2026-09-15 拍板**(主視窗轉述逐字「都可以看」):能登入後台的員工都看得到列表與全文,不加管理者閘。

## 2. 查到的事實

| # | 事實 | 出處 |
|---|---|---|
| 1 | 表 `public.pcm_incident(id bigserial, kind text, subject_id uuid, detail text, created_at timestamptz, resolved_at timestamptz)`;部分索引 `(kind, created_at DESC) WHERE resolved_at IS NULL` | `supabase/migrations/20260905290000_m4b_pending_refund_open_failure_incident.sql:116-134` |
| 2 | RLS 開、**0 條 policy**;table 與 sequence 對 `PUBLIC / anon / authenticated / service_role / payment_confirmer` **全部 REVOKE** ⇒ 連 `service_role` 都讀不到 | 同檔 `:137-161` |
| 3 | 唯讀角色也讀不到(`has_table_privilege = f`) | 2026-09-15 唯讀實查 |
| 4 | 唯一讀取口 `get_pcm_incident_health()`:只回 `open_total`、`open_by_kind`、`oldest_open_at`;**不回單筆、不回 detail / subject_id**。EXECUTE 給 `service_role`,`[R1]` 後來另有 migration 追加給 `payment_confirmer` | 同檔 `:192-214`;`20260906970000:77`(`[R1]` 審查指出) |
| 5 | `kind` 封閉集,最新 6 種:`pending_refund_open_failed` / `refund_over_total` / `auto_cancel_skipped` / `auto_cancel_failed` / `line_forward_failed` / `auto_cancel_live_shipment` | `20260916010000_m4b_p01_auto_cancel_split_by_shipment_state.sql:67`(`supabase/APPLIED.tsv:672`) |
| 6 | `[R1]` **`detail` 實際內容**(逐寫入點):`pending_refund_open_failed` = SQLERRM(只有訊息本身,不含 DETAIL 的 key 值);`auto_cancel_failed` = SQLSTATE + 前 200 字訊息(`admin_cancel_order` 丟的是固定字串);`auto_cancel_skipped` / `auto_cancel_live_shipment` = 固定中文指示 + 箱子的 shipment_reference;`refund_over_total` = 三個金額;`line_forward_failed` = `http_503 x4 events=<webhookEventId…>`,截 500 字。**沒有客人姓名、email、電話、token** | `20260905290000:296-298`、`20260916010000:157,172,214-220,230`、`20260905440000:361-364`、`20260914100000:64`、`apps/storefront/src/lib/line/forward-webhook.ts:90`(審查 R1 逐點讀;設計窗未逐行重讀,**吻合但未證實**,開工第一步抽核) |
| 7 | `resolved_at` 欄位存在,但**全樹沒有任何地方寫它**(`[R1]` `rg "UPDATE public.pcm_incident\|pcm_incident SET"` 零命中) | 審查 R1;`20260907140000:278-284` 同記 |
| 8 | 正式庫事故筆數:**唯讀角色讀不到,沒量到**(不是 0) | 同 #3 |
| 9 | 最接近的既有頁:「操作紀錄」`/settings/audit`:server component、`LIMIT = 50`、讀取失敗顯示錯誤區塊不顯示空白 | `apps/admin/src/app/settings/audit/page.tsx:83-116`、`:169` |
| 10 | 操作紀錄的讀法:`getAdminAuditLogReader()` 用 service client + 具名欄位,錯誤 throw 不吞 | `apps/admin/src/lib/orders/order-repository.ts:88-101` |
| 11 | 側欄:`SETTINGS_GROUP_ITEMS` 目前最後一項是「匯率」`fx`;`AUDIT_NAV_ITEM`(操作紀錄)另外接在整份清單最後。項目必須寫成一行(`app-sidebar.test.ts:74` 用 regex 抽字面) | `apps/admin/src/components/layout/nav-items.ts:66-73`、`:124` |
| 12 | `[R1]` 側欄有三支測試會因為加一項而紅:`app-sidebar.test.ts:120-155` 整份清單 `toEqual`;`nav-items.test.ts:25` 釘「最後一個是 audit」;`app-sidebar-rail.test.tsx:138` 釘「設定群組最後一個是操作紀錄」 | 設計窗逐行核對 |
| 13 | `[R1]` 後台登入閘:`apps/admin/src/proxy.ts` matcher 涵蓋全部路徑、驗簽過的登入票 ⇒ `/settings/incidents` 自動在閘內 | `proxy.ts:41-43`、`:84`(審查 R1) |
| 14 | `[R1]` 權限漂移摘要 `pcm_acl_digest()`:把 `public` 每一支函式 × `anon / authenticated / service_role / payment_confirmer` 的 EXECUTE 都算進去,**沒有排除新函式** ⇒ 新建與 DROP 都會讓摘要變 | `20260909060000_m4b_acldrift5_clear_approval_and_add_pcm_readonly.sql:136-143`(設計窗逐行核對) |
| 15 | `[R1]` commit 前靜態檢查 `scripts/migration-static-checks.sh` 第 ③ 關:可授權新物件數 > migration 內 `v_functions text[]` 斷言清單長度 ⇒ 擋 commit;範本 `DO $post$` | `scripts/migration-static-checks.sh:681-730`;`20260914100000_m4b_pcm_incident_kind_add_line_forward_failed.sql:74-80` |
| 16 | `[R1]` 型別:`createSupabaseServiceClient()` 回 `SupabaseClient<Database>`,`database.types.ts` 沒有新函式 ⇒ `.rpc('admin_list_pcm_incidents')` 過不了 typecheck;既有 `as never` + 測試釘函式名的前例 | `packages/adapters/src/supabase/client.ts:87`;`apps/admin/src/lib/payment/manual-refund-read.ts:166-169`(審查 R1) |
| 17 | repo 內沒有事故頁設計稿;admin 側 0 個測試碰 `pcm_incident` | grep `design-reference/`、`apps/admin` |

## 3. 關鍵限制

- 🔴 **後台不能直接 `.from('pcm_incident')`**(#2,`service_role` 被收掉,會回 `42501`)⇒ **新開一支 SECURITY DEFINER 函式當門**,照 `get_pcm_incident_health()` 的窄門寫法。**不加 policy、不 GRANT SELECT**。
- `[R1]` 登入閘的真實邊界:`proxy.ts` 只驗簽過的票;`is_active` 只在 SSO 簽票時查(`apps/admin/src/app/api/sso/callback/route.ts:193-199`),票 15 分鐘、SSO 鏈上限 12 小時(`:184-191`)⇒ **被停用的員工在票過期前仍看得到**。這是後台每一頁都有的邊界,不是本 plan 造成的;本頁不另加查詢。

## 4. 做法

### 4-A DB:一支讀取函式(schema + 權限)
- `public.admin_list_pcm_incidents(p_limit integer, p_open_only boolean)` RETURNS TABLE `(id bigint, kind text, subject_id uuid, detail text, created_at timestamptz, resolved_at timestamptz)`
  - `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''`,owner `postgres`
  - `[R1]` NULL 寫死:`p_limit` NULL ⇒ 50;`p_open_only` NULL ⇒ true。`p_limit` 夾 1..200。**不讓 NULL 靜靜回 0 列**(那長得和「沒有事故」一樣)。
  - `ORDER BY created_at DESC, id DESC`
  - `[R1]` 索引:既有部分索引是 `(kind, created_at DESC)`,不能直接排 `created_at`;事故列很少,不另建索引(寫明是刻意)。
- ACL:`REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role, payment_confirmer`;`GRANT EXECUTE … TO service_role`。`pcm_readonly` 不給。照 `docs/patterns/revoking-function-execute-in-supabase.md`。
- `[R1]` **migration 自帶後置閘 `DO $post$`**(形狀抄 `20260914100000:74-80`):
  - `v_functions text[] := ARRAY['public.admin_list_pcm_incidents(integer, boolean)']::text[]`(靜態檢查 ③ 數的就是它)。`[R2]` **結尾一定要寫 `]::text[]`**:`scripts/migration-static-checks.sh:713-717` 的 awk 讀到 `]::text[]` 才停;少了 cast 會一路讀到檔尾、把後面每個單引號字串都算進清單 ⇒ 永遠判「列得夠」⇒ ③ 等於沒檢查。
  - `[R2]` 函式用**裸 `CREATE FUNCTION`**,不寫 `OR REPLACE`(規則①;理由見 `20260905290000:164` 註解)。
  - `has_function_privilege`:`anon / authenticated / payment_confirmer / pcm_readonly` 全 `f`,`service_role` = `t`
  - pattern 文件 §3.5「枚舉切得過去的角色」查詢回零列(`revoking-function-execute-in-supabase.md:308-323`)
  - 任一條不成立 ⇒ `RAISE EXCEPTION` ⇒ 整支不 COMMIT
- `[R1]` **貼板必附一步**:貼完當批跑 `pcm_acl_approve_latest`(Sean 0914 拍甲「貼完順手跑」,理由寫版本號),否則每日 ACL 摘要會因新函式轉紅(#14)。

### 4-B 後台讀取層
- `apps/admin/src/lib/incidents/incident-repository.ts`:照 `getAdminAuditLogReader()`(#10)形狀,錯誤 throw。
- `[R1]` 型別:`.rpc('admin_list_pcm_incidents' as never, …)` + 一格測試逐字釘函式名與參數名(前例 #16);**不改共用的 `database.types.ts`**(那會把影響面擴到 packages)。
- `kind` 中文標籤表 `INCIDENT_KIND_LABEL: Record<IncidentKind, string>`。
- `[R1]` 標籤表的守門**不另寫 SQL 解析碼**:在既有 `packages/adapters/src/payment/incident-kind-two-truths.test.ts` 加第三把尺,重用它的 `sqlKinds()`,讀 admin 標籤表原始碼抽鍵比對 ⇒ DB 加第 7 種而標籤表沒加會紅。
  `[R2]` ⚠️ 既有的 TS 抽法(`:87`)只抓單引號字串,而 `Record` 的鍵通常不加引號、值又是中文 ⇒ 直接套會抽到 0 個、這把尺沒接上。⇒ **標籤表的鍵一律寫單引號**(`'pending_refund_open_failed': '補開待退款失敗'`),並加一格「抽到恰 6 個」的前提斷言(照該檔 `:93-97` 的形狀)。
- `[R1]` `subject_id` 對照(審查 R1 逐寫入點讀,開工第一步抽核):

  | kind | 標籤(草擬) | `subject_id` | 畫面 |
  |---|---|---|---|
  | `pending_refund_open_failed` | 補開待退款失敗 | 訂單 id | 連到訂單 |
  | `refund_over_total` | 退款超過訂單總額 | 訂單 id | 連到訂單 |
  | `auto_cancel_skipped` | 自動取消略過 | 訂單 id | 連到訂單 |
  | `auto_cancel_failed` | 自動取消失敗 | 訂單 id | 連到訂單 |
  | `auto_cancel_live_shipment` | 自動取消遇到已出貨 | 訂單 id | 連到訂單 |
  | `line_forward_failed` | LINE 轉發失敗 | 固定 NULL | 印「—」 |

### 4-C 後台頁
- 路由 `/settings/incidents`。
- `[R1]` 側欄位置寫死:**`SETTINGS_GROUP_ITEMS` 最後一格**(「匯率」之後;「操作紀錄」仍接在整份清單最後,兩支「操作紀錄最後」的測試照舊成立)。一行字面:`{ key: 'incidents', label: '事故紀錄', icon: …, href: '/settings/incidents' }`(icon 開工時從既有集挑)。
- 版面(OD 稿未對,先照「操作紀錄」頁):
  - 「未處理」(預設)/「全部」切換。
  - 表格欄:時間 · 種類 · 訂單(可點;NULL 印「—」)· 錯誤訊息(預設收合,點開看全文)。
  - 最近 50 筆。
  - 讀取失敗:錯誤區塊(同 #9),**不顯示「沒有事故」**。
  - 0 筆:「目前沒有未處理的事故」。
- 權限:照 Sean 拍板,**不呼叫 `resolveManagePermission`**;沿用後台登入閘(#13)。

### 4-D 不在本 plan(另議)
- 「標記已處理」(寫 `resolved_at`)。🔴 寫下去之後告警信數字會跟著變少(告警只數未解決,#4)⇒ 另外拍板、也要寫操作紀錄。
- 事故保存期限 / 清理。

### 4-E 改動檔清單
- DB:`supabase/migrations/<新版本號>_m4b_admin_list_pcm_incidents.sql`、`supabase/rollbacks/<同版本號>-rollback.sql`
- 後台:`apps/admin/src/lib/incidents/incident-repository.ts`(+ test)、`apps/admin/src/lib/incidents/incident-kind-label.ts`、`apps/admin/src/app/settings/incidents/page.tsx`(+ test)、`apps/admin/src/components/layout/nav-items.ts`
- `[R1]` 必改的既有測試:`apps/admin/src/components/layout/app-sidebar.test.ts`(`:120-155` 整份清單期望值加一列)、`app-sidebar-rail.test.tsx`(`[R2]` **`:214` `rail-count-slot` 的 `12` 改 `13`** —— 軌上格數,檔內 `:212-213` 註解逐字寫明「加一格就要有人回來看一眼」;這是清單內容變了,不是放寬守門)
- `[R2]` 不動、確認綠:`nav-items.test.ts:25`(新項目排在 audit 前面,「最後一個是 audit」照舊成立)、`app-sidebar-rail.test.tsx:138`(「設定群組最後一個是操作紀錄」照舊成立)
- `[R1]` `packages/adapters/src/payment/incident-kind-two-truths.test.ts`(第三把尺)

## 5. 影響

- 客人:無。
- 員工:後台多一頁,能登入後台的都看得到(含錯誤全文;#6 沒有客人個資)。
- 資料庫:多一支只讀函式;表本身權限一個字都不改。
- 每日 ACL 摘要:新函式會進摘要 ⇒ 貼板當批跑 `pcm_acl_approve_latest`。
- 告警信 / LINE:不變。

## 6. Rollback

- 後台:revert 一顆 commit(頁面 + 側欄 + repository + 三支測試)。
- DB:`DROP FUNCTION public.admin_list_pcm_incidents(integer, boolean)`;`[R1]` **DROP 之後同批跑 `pcm_acl_approve_latest`**(摘要會因少一支函式再變一次)。表與既有函式沒動。
- 順序:先退後台、再退函式。

## 7. 驗收

1. 拋棄式 PG(`~/pcm-mailbox/schema-dump-20260915/up.sh`,先照版本號順序套貼板 178–184):造 6 種 kind 各 1 筆(1 筆已 resolved)⇒ `p_open_only = true` 回 5、`false` 回 6;最新在上;`p_limit` 0 → 1、999 → 200;`[R1]` `p_limit` NULL → 回最多 50、`p_open_only` NULL → 只回未解決。
2. `[R1]` ACL 由 migration 自己的 `DO $post$` 斷言證(紅就不 COMMIT);另外手動複驗一次:**表本身**對 `service_role` 直接 select 仍 `42501`。
3. `[R1]` `incident-kind-two-truths.test.ts` 第三把尺:6 種一致;故意在標籤表少一種 ⇒ 紅。
4. 本機後台(`scripts/admin-probe`,不碰正式庫):造事故列,開 `/settings/incidents` 肉眼看;管理者 / 非管理者兩個身分都看得到全文;把函式改名 ⇒ 頁面顯示讀取失敗區塊,不是「沒有事故」。
5. `[R1]` 側欄:`app-sidebar.test.ts` 整份清單期望值加一列、`[R2]` `app-sidebar-rail.test.tsx:214` 12 → 13;`nav-items.test.ts` 不動。三支都綠。
6. `[R1]` 開工第一步:抽核 #6 與 §4-B 對照表至少 3 個寫入點(含 `line_forward_failed` 的 NULL)。
- 三綠;`[R1]` codex 缺席到 09-20 ⇒ 實作完再過一輪專案版 adversarial-reviewer。

## 8. 要批的

> ✅ **2026-09-15 已答**(主視窗轉述):Q1 =「都可以看」;Q2 = 甲(先找 OD 稿,沒有照操作紀錄頁)。「標記已處理」不做。
> 以下保留原題作為決策軌跡。

```
Q1:事故紀錄誰看得到?
A:  甲 只有管理者 | 乙 所有員工看得到列表, 錯誤全文只有管理者能展開 | 丙 所有員工都能看全部
    ⇒ Sean:都可以看

Q2:畫面要等 OD 稿嗎?
A:  甲 先開 OD 找稿, 沒有再照「操作紀錄」頁(⇒ Sean 選甲) | 乙 不找稿
```

## 9. 估時與上線順序

- 抽核 ~20 分;migration + 後置閘 + 拋棄式 PG ~50 分;後台 repository + 頁面 + 側欄 + 三支既有測試 ~70 分;本機肉眼 ~15 分。拆兩片(DB 一片、後台一片)。
- `[R1]` **上線順序**:DB 那片的 migration 先貼正式庫、`supabase/APPLIED.tsv` 那一列與 migration 檔一起 commit,**後台那片才合進 dev**(dev = 後台 production;碼先上會讀到不存在的函式 ⇒ 頁面顯示讀取失敗)。貼完同批跑 `pcm_acl_approve_latest`。
