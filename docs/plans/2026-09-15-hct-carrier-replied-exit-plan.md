# 2026-09-15 · 新竹「送出結果未知」乙型箱的出口 + QueryEDELNO 真打驗證 —— plan

> 窗 B。來源:主視窗派工(Sean 19:1x「甲 = 要, 先寫計畫; 真的打新竹那一發, 會先問你」)。
> 對應板列 `docs/launch-todo.md:2425` ⟦ship-HCTUNKNOWNREAD⟧(本日唯讀盤點判 🟡)。
> **本檔只是 plan,零碼改動。** 碰對外 API(新竹)+ 出貨狀態 ⇒ 鐵則 8 + 12,等批。

## 0. 白話

- 按「送新竹」之後,如果我們讀不懂新竹回的東西,那一箱會卡在「送出結果未知」。
- 卡住有兩種:
  - **甲型**:新竹可能根本沒收到。今天有出口:打電話確認後「放回草稿」重送。
  - **乙型**:新竹確定回過話,只是我們看不懂。**今天畫面上沒有任何出口**,只有一行紅字叫員工不要重送。
- 其實程式裡**已經有**「問新竹這張單有沒有貨號」的查詢(QueryEDELNO):查到貨號就補記成「已送出」,不會多出一張單。
- 但它藏在「送新竹」那顆鈕後面,而那顆鈕旁邊寫著「要真的叫新竹來收貨才按這顆」,跟上面的紅字互相打架 ⇒ 沒有人會去按。
- 而且這支查詢**從來沒有對新竹真的打過一發**,我們不知道它讀回來的「查無此單」可不可信。
- **本 plan 做兩件事**:
  1. 給卡住的箱一顆明說的「向新竹查詢貨號」鈕。
  2. 在 Sean 同意之後,用一箱已知的單真的查一發,驗證查詢讀得對。
- **今天有沒有人被卡**:正式庫 2026-09-15 唯讀,卡在「送出結果未知」的箱 **0**。

## 1. 現況(每一格有出處)

| # | 事實 | 出處 |
|---|---|---|
| 1 | 甲/乙判型:`unknownReason.flowReason` 是 `soap_fault` / `epino_mismatch` / `row_count_*` / `unrecognised_success_*` / `unrecognised_query_*` ⇒ 乙型;其餘或挖不到 ⇒ 甲型 | `apps/admin/src/lib/shipping/hct-unknown-kind.ts:25-81` |
| 2 | 卡住提示只對甲型給「放回草稿」鈕;乙型只印紅字 +「(查詢功能未接:新竹傳輸方式待確認)」 | `apps/admin/src/components/orders/shipment-hct-unknown-notice.tsx:38-51` |
| 3 | 那句「查詢功能未接」**已過期**:傳輸已改 SOAP,第一箱 2026-09-10 12:08 真的送成功 | `hct-client.ts` 的 `soapCall`;`docs/runbooks/hct-first-shipment-activation.md:156` |
| 4 | **既有查詢路**:在 unknown 箱上按「送新竹」 ⇒ `decideSubmit('unknown')` = `query_first`,絕不重送 | `apps/admin/src/lib/shipping/hct-submit-flow.ts:48-53` |
| 5 | 查到 ⇒ `recovered` ⇒ 寫 `submitted` + 新竹貨號;查無 / 看不懂 ⇒ `needs_human`,不動狀態 | `hct-submit-flow.ts:112-128`;`shipment-submit-hct-action.ts:368-379` |
| 6 | 既有路被 `HCT_SUBMIT_ENABLED` 擋在查詢之前 ⇒ 只開查詢開關時,卡住的箱連問都問不到 | `shipment-submit-hct-action.ts:174-177` |
| 7 | 「送新竹」鈕旁邊的字是「(已/還沒)標出貨。要真的叫新竹來收貨才按這顆」 ⇒ 與卡住提示的「不要重送」相反 | `apps/admin/src/components/orders/shipment-hct-submit-button.tsx:126` |
| 8 | 查詢本體:`HCT_QUERY_ENABLED` 不是 `'true'` ⇒ `disabled`;只有 `ErrMsg` 含「查無」才叫 `not_found`,其餘一律 `unknown` | `hct-client.ts:65`、`:404-436` |
| 9 | 🔴 **QueryEDELNO 從沒真打過**:信封是量過的,payload 形狀是推的;包錯時也可能被讀成「查無」 | `hct-client.ts:415-421` |
| 10 | 甲型「放回草稿」前也會先查(查到就拒絕放回、改記 submitted) | `shipment-actions.ts` `resetHctUnknownToDraftAction`(commit `3d48f5c6f`) |
| 11 | `unknown ⇒ submitted` 是資料庫允許的「補記」,不是重送 | `supabase/migrations/20260904170000_m4b_hct_record_submit_result.sql:155-165` |
| 12 | 補記成 submitted 時 `hct_submitted_at` **不重蓋**(留原本送出那一刻)⇒ 隔天救回的箱不會被當成「今天送的」,重取標籤的同日判斷仍然正確 | `supabase/migrations/20260914080000_m4b_hct_record_label_raw.sql:62-65` |
| 13 | 放回草稿的資料庫閘②只看 `raw -> 'placeholder' = true`;寫 unknown 原因的窄門是**合併**、保留 `placeholder` ⇒ **乙型箱在資料庫層過得了閘②,擋它的只有畫面** | `20260905320000_m4b_hct_reset_unknown_to_draft.sql:156`;`20260908020000_…:51` |
| 14 | 正式環境 pcm-admin 有 `HCT_QUERY_ENABLED`、`HCT_SUBMIT_ENABLED` 這兩個變數(**只看名稱,值未讀**) | `vercel env ls production`(`apps/admin`,2026-09-15) |

## 2. 正式庫現況(唯讀,2026-09-15)

- 未作廢新竹箱:`submitted` 1 箱(`S9FC6P`,有新竹貨號,`hct_submitted_at` 為 NULL),`unknown` **0** 箱,`draft` 0 箱。
- 輸出:`~/pcm-mailbox/readonly-0915-three/hct-state.out`、`hct-submitted-box.out`。

## 3. 設計

### 3.1 為什麼不直接叫員工按「送新竹」

- 既有查詢路是對的(#4 #5),但入口錯了:
  - 字面叫人「要真的叫新竹來收貨才按」(#7),卡住的箱不該被這樣描述。
  - 它綁著 `HCT_SUBMIT_ENABLED`(#6):哪天為了止血把送單關掉,卡住的箱也跟著救不了。
  - 它還會跑一整段送單前置(截斷確認、備註組裝),跟「只是問一下」無關。
- ⇒ 要一條**只查不送**的窄路,判準與寫法**共用**既有那一份(不寫第二份)。

### 3.2 片 A · 「向新竹查詢貨號」鈕(TS only,無 migration)

1. **新 server action `queryHctUnknownAction({ shipmentId })`**(放 `shipment-submit-hct-action.ts` 旁,或自己一檔):
   - `authorizeAdminMutation` ⇒ 讀箱 ⇒ 作廢拒 ⇒ **狀態必須是 `unknown`**,否則拒(已送出的箱走核對,見片 B)。
   - `readHctDepsFromEnv` 缺 ⇒ `disabled`;**只看 `HCT_QUERY_ENABLED`**(`queryEdelno` 內建),不看 `HCT_SUBMIT_ENABLED`。
   - 呼叫既有 `queryEdelno(deps, shipmentReference)`。
   - `found` ⇒ 與 #5 **同一段寫法**:`recordHctSubmit(submitted, edelno, raw)`。抽成一支共用函式,讓「送新竹」的 recovered 分支與本鈕呼叫同一份。
   - `not_found` / `unknown` ⇒ 不動任何狀態;回給人看的話依甲/乙分開(見 3.3)。
   - 稽核:`auditLog('shipment.hct_query_unknown', …)` attempt / ok / fail。
2. **卡住提示改版**(`shipment-hct-unknown-notice.tsx`):
   - 甲、乙兩型都顯示「向新竹查詢貨號」鈕。
   - 拿掉過期的「查詢功能未接」那句(#3)。
   - 甲型的「放回草稿」鈕照舊(它自己也會先查,#10)。
3. **「送新竹」鈕在 unknown 箱上的字**:改成「這一箱送出結果未知 —— 請用上面的『向新竹查詢貨號』」,並不再顯示那顆鈕(避免兩個入口)。
   - ⚠️ 這一條改的是既有鈕的顯示條件,列在 §6 讓 Sean 看。
4. 測試:
   - action:五種結果(found / not_found / unknown / disabled / 狀態不是 unknown)各一格;found 時確認走共用寫法。
   - 提示:甲型兩顆鈕、乙型只有查詢鈕、非 unknown 什麼都不畫。

### 3.3 查無時對人說什麼

| 型 | 查到 | 查無 | 查不到答案 |
|---|---|---|---|
| 甲 | 「新竹有這張單(貨號 X),已記成已送出,直接印標籤」 | 「新竹查無。**查詢還沒驗證過**,請照 runbook 打電話確認後再決定要不要放回草稿」 | 「沒拿到答案,不要重送,稍後再查」 |
| 乙 | 同上 | 「新竹查無,但新竹**曾經回過話** ⇒ 不自動處理,請打電話給新竹確認」 | 同上 |

- 片 B 驗證通過之前,「查無」一律加「查詢還沒驗證過」這半句(#9)。

### 3.4 片 B · QueryEDELNO 真打一發(🔴 要 Sean 同意才執行)

目的:證明我們送出的查詢 payload 形狀對,而且讀得出「查到」與「查無」兩種答案。

- **正對照**:查 `S9FC6P`(正式庫已送成功、有貨號)。期望 `found`,且貨號 = 庫裡 `hct_request_id`。
- **負對照**:查一個**格式合法、我們從沒送過**的訂單編號(執行當下唯讀確認 `shipments` 沒有這個編號)。期望 `not_found`(`ErrMsg` 含「查無」)。
- 兩發都是**唯讀查詢**,不建單、不改新竹那邊任何東西;我們這邊**零 DB 寫入**,只留稽核 log。
- **怎麼打**(不新增 `scripts/`、不把新竹帳密拉到本機):
  - 片 B 帶一支**管理者限定**的臨時核對 action(`probeHctQueryAction`),只收上面兩個編號之一,另外受一顆新開關 `HCT_QUERY_PROBE_ENABLED` 管。
  - 在後台出貨清單頁放一個只在開關為 `'true'` 時出現的入口。
- **執行步驟**:
  1. Sean 同意(Q3)。
  2. Sean 在 pcm-admin 正式環境把 `HCT_QUERY_ENABLED` 與 `HCT_QUERY_PROBE_ENABLED` 設成 `true`,redeploy。
  3. 管理者按正對照 ⇒ 記下畫面結果。
  4. 管理者按負對照 ⇒ 記下畫面結果。
  5. Sean 把 `HCT_QUERY_PROBE_ENABLED` 關掉。
  6. 窗把讀數寫進 `hct-client.ts:415-421` 那段註解與板列,並拿掉片 A 那半句「查詢還沒驗證過」;臨時 action 與入口在下一顆 commit 刪掉。
- **判讀**:
  - 正對照 `found` 且貨號相符 + 負對照 `not_found` ⇒ 驗證通過。
  - 任一不符(`success=N` 帶沒見過的 `ErrMsg`、`unknown`、貨號不同)⇒ **停**,不上片 A 的「查無」文案,回報原文(不含帳密)。

## 4. 範圍

- 片 A:`shipment-submit-hct-action.ts`(抽出 recovered 共用寫法)、新 action、`shipment-hct-unknown-notice.tsx`、`shipment-hct-submit-button.tsx`(unknown 時的字與顯示)、`order-shipments.ts` / `shipment-repository.ts`(若提示要多一個「乙型」旗標)、對應測試、runbook `hct-unknown-stuck-manual-reset.md` 補「先按查詢」一步。
- 片 B:臨時 `probeHctQueryAction` + 入口 + 開關;驗證完刪除。
- **不動**:任何 migration、`admin_hct_reset_unknown_to_draft`、`queryEdelno` 本體、甲型的放回草稿流程。

## 5. 影響 / rollback

- 客人:無直接影響;卡住的箱查到貨號後可以照常印標籤、叫車。
- 員工:卡住的箱多一顆明說的查詢鈕;「送新竹」鈕不再出現在卡住的箱上。
- 新竹:片 A 只在員工按鈕時查;片 B 兩發唯讀查詢。
- rollback:TS 還原該 commit;開關關掉即回到今天的行為(`disabled`)。無資料要還原(found 的補記是真實事實,不需要撤)。

## 6. 要批的

```
Q1:卡住的箱加一顆「向新竹查詢貨號」(只查不送、只看查詢開關),甲乙兩型都給?
A:  甲 做(推薦)| 乙 先不做:乙型繼續只有紅字,要救得靠 Sean 改資料庫
```

```
Q2:乙型箱查無、而且打電話向新竹確認沒有這張單 ⇒ 要不要也給「放回草稿」?
    (資料庫那一層今天就擋不住它,#13;擋住的只有畫面)
A:  甲 先不給(推薦):等片 B 驗證過查詢、再看真的發生幾次
  | 乙 給:查無 + 電話證詞兩者都有才出現,理由欄必填
```

```
Q3:真的對新竹打兩發唯讀查詢(已送成功的 S9FC6P 一發 + 從沒送過的編號一發), 驗證查詢讀得對?
A:  甲 同意(推薦):照 §3.4 步驟, 需要你在 Vercel 開兩個開關
  | 乙 先不打:片 A 的「查無」一律標「查詢還沒驗證過」
```

## 7. 驗收

- 片 A:typecheck / lint / build + 相關 vitest;本機後台造一箱甲型、一箱乙型,截圖兩種提示(新竹開關在本機一律 `disabled`,只驗畫面與 `disabled` 那句)。
- 片 A 是對外 API + 出貨狀態 ⇒ 高風險審查一輪(codex 額度用完期間走 adversarial-reviewer,註明缺 codex)。
- 片 B:第 3.4 的兩格讀數原樣記錄。

## 8. 估時

- 片 A:~45 分(action + 提示 + 鈕 + 測試)+ 審查。
- 片 B:~30 分寫臨時入口;真打由 Sean 排時間。

## 9. 範圍外

- 自動定期查詢卡住的箱(排程)。
- 已送成功箱的一般「核對新竹貨號」功能(片 B 的臨時入口驗證完就刪)。
- 新竹「查無」兩個世界(真的沒進去 / 查詢與建單不同步)的分辨 —— 規格沒給,本 plan 不假裝能分。
