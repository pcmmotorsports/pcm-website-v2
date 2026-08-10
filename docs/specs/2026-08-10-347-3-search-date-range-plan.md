
# #347-3 搜尋日期範圍(片級 plan v1.1 — 主視窗 2026-08-10 已核三題與切片,回覆 `D-411-Q`)

> 承 347-1(RPC)/ 2a(adapter)/ 2b(UI,`d80e4823`)。Q14=A 拍板逐字:
> 「搜尋加日期範圍、**未選預設近半年**」(`docs/specs/2026-08-09-admin-completion-wave-plan.md:12`)。
> 片型 = **高風險不降級**(動 `admin_search_orders` 簽章 ⇒ 鐵則 12 ③)。內容分級 = **L1**。
> 🔴 夜跑規則④:**migration 寫好留 pending,今晚不 apply**。

## 0. 為什麼這片存在(不是「多一個篩選器」)

`docs/specs/2026-08-09-347-2a-keyword-search-adapter-plan.md:135` 已經寫死了問題:RPC **先取全域最新 100 筆命中,才與其他篩選取交集**
⇒ `truncated=true` 時,真正要找的單可能整張落在那 100 筆之外、畫面顯示 0 筆。
那份 plan 當時的結論是「本片的正確作法是把語意寫死 + 讓提示無條件出現,**不能靠把其他篩選下推進 RPC 解決**
—— 那要動 RPC 簽章,而 Q14 已拍板日期參數隨 347-3」。

⇒ **本片就是那個「下推」**:把日期範圍推進 RPC,讓那 100 筆的取樣窗口從「全歷史最新 100」
變成「這段期間內最新 100」。這才是 Q14 的實質效果,不只是 UI 多一個下拉。

## 1. 🔴 三個要先決定的事(我的判斷 + 理由,請主視窗核)

### 1-1 「未選預設近半年」的預設值**落在哪一層**

**推薦 = adapter 層**(不是 RPC、也不是 UI)。

- **不放 RPC**:RPC 的 `p_from IS NULL` 應該老實表示「不限期間」。把預設塞進 DB 函式 =
  同一支函式對「沒給」與「明確要全部」**做不出區分**,而那是日後對帳/匯出會需要的能力。
- **不放 UI**:UI 只負責「使用者選了什麼」。放這裡的話,任何非 UI 呼叫端(未來的匯出、API)
  都會**沉默地拿到全歷史**,而 Q14 的意圖是「預設就該收窄」。
- **放 adapter**:它是唯一同時知道「呼叫端沒給」與「該怎麼收窄」的地方,而且**只有一個落點**。
  ⚠️ 誠實代價:adapter 有預設值 ⇒ 「我沒給日期」與「我要近半年」在 adapter 之上不可分辨。
  要「真的全部」得**顯式給一個很早的 `from`**。這條寫進型別註解。

### 1-2 日期軸吃 `orders.created_at` 還是別的時間

**推薦 = `created_at`(下單時間)**,理由:列表的日期欄(`formatOrderListDate`)顯示的就是它,
篩選與畫面上看得到的數字**是同一個量**。用付款時間或出貨時間會出現「篩了 8 月卻列出 7 月的單」。

### 1-3 舊簽章要不要留

**推薦 = DROP 舊的、只留新的**(照 A8a2 的既有前例:`DROP 5 參 + CREATE 6 參`)。
🔴 理由是 **GRANT 綁精確簽章**:留兩個 overload ⇒ PostgREST 依參數名挑,挑錯就是 404/42501,
而那個錯誤長得像「搜尋壞了」不像「挑錯 overload」。adapter 那支窄介面 cast 的檔頭已經記過同一個坑。

## 2. 建議切片(本 plan 只請批 3a;3b/3c 隨後)

| 片 | 做什麼 | 對外可見 | 風險 |
|---|---|---|---|
| **347-3a** | migration:`admin_search_orders` 加 `p_from`/`p_to`(DROP 舊 + CREATE 新 + 重 GRANT + REVOKE PUBLIC)| 🔴 **呼叫端已存在**(見下) | **高**(鐵則 12 ③;**留 pending 不 apply**)|
| **347-3b** | domain `AdminOrderFilter.createdFrom/createdTo` + port 型別 + adapter 傳參 + **近半年預設** | 無(零產出者) | 中 |
| **347-3c** | UI 日期範圍下拉(近一個月/三個月/半年/一年/自訂)+ 落進 350 殼 | **是** | 中 |

### 🔴 3a 不是「零呼叫端」—— 我 v1 寫錯了(codex 關卡1 must-fix)

v1 那格寫「對外可見=無(零呼叫端)」是**假的**:正式 adapter
(`packages/adapters/src/supabase/SupabaseOrderAdapter.ts`)**現在就在呼叫同名 RPC**。
⇒ 3a apply 的**當下**,線上那支 adapter 就開始依賴一條我沒驗過的相容性:
「送 `{p_query, p_limit}`、省略兩個有 `DEFAULT` 的新參數,PostgREST 仍然找得到這支函式」。
(codex 唯讀查正式庫確認 PostgREST 允許省略具預設值的參數;但**本機是 vanilla PG、沒有 PostgREST**
 ⇒ 這條**在本機一格都測不到**。)
⇒ **列成收割時的真站 smoke 硬項**:apply 之後、3b 之前,用現行 adapter 打一次關鍵字搜尋,
確認**還搜得到**(不是 404、不是空)。這是 3a 唯一沒有本機證據的面。

🔴 這筆屬 `feedback_assert-scope-only-after-reading-source-file` 家族:
我宣稱「零呼叫端」時**沒有去開 adapter 看它現在呼叫誰**,只憑「`filter.keyword` 零產出者」推論
—— 但那兩件事不是同一件(產出者是 UI 那一端,呼叫者是 adapter 這一端)。已進 commit body 認列。

🔴 **3a 與 3b 之間有 apply 停點**:migration 未 apply 前 3b 上線 ⇒ PostgREST 404
⇒ **整個訂單列表進錯誤態**(不只搜尋壞掉),與 A10c1/D0 同族。
這條**必須**照 memory `feedback_app-layer-must-not-ship-before-migration-apply`:
3b 要嘛等 apply、要嘛掛 flag。**本 plan 選「等 apply」**——旗標會多一條要維護的分支,而這片不趕。

## 3. 3a 的驗收(其餘片隨後出)

1. 新簽章存在、**舊簽章不存在**(`pg_proc` 查 `pronargs`,不是數 migration 的 CREATE 敘述
   —— memory `reference_count-objects-from-catalog-not-create-statements` 記過這條)。
2. `service_role` 有 EXECUTE、**PUBLIC 沒有**(REVOKE 後查 `pg_proc.proacl`;
   🔴 `proacl IS NULL` 要**先擋**,否則 `aclexplode(NULL)` 零列 ⇒ 斷言恆真
   —— 今晚 B 窗 `MAIN-003-A` 才被同一條打回,不重蹈)。
3. `p_from IS NULL AND p_to IS NULL` ⇒ **篩選結果與現況相同**(不限期間;harness 第 1 組用「與省略參數的回傳逐字比對」實測)。
4. `p_from > p_to` ⇒ 回零筆、不擲錯(使用者可以打出這種輸入)。
5. 日期邊界:**半開區間 `[p_from, p_to)`** —— `p_from` 含、`p_to` **不含**。
   ⚠️ v1 這格原本寫「`p_to` 含當天」,與 migration 的 `<` 矛盾(codex 關卡1 抓到)。
   對 UI 的意思是:員工選的「結束日 8/10」要**含整天** ⇒ 3b 送 `p_to = 2026-08-11T00:00+08:00`(下一個台北午夜)。
6. `statement_timeout` 引用既有實量值,不重量。

## 4. 不做什麼

- 不動 2b 的 cookie 載體、不動 keyword 正規化、不動列表其他六軸。
- **不 apply**(夜跑規則④)。
- 不做匯出 / 對帳用的「真的全部」入口(§1-1 的誠實代價,記債)。

## 5. rollback

3a:單一 migration,rollback = 反向 migration(DROP 新 + CREATE 舊簽章)。
🔴 **未 apply 之前 rollback = 直接 revert commit**,沒有 DB 狀態要收。
