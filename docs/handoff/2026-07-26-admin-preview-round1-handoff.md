# SESSION HANDOFF — 2026-07-26 後台畫面預覽交付 + Sean 首輪驗收全數折入 + E11 積木第一片

> **一句話結果**:全後台畫面預覽 artifact 交付並經 **Sean 五輪驗收 + Codex/Fable 雙審查**,39 個畫面、**十四項拍板全數折入**;順手做完 **E11 積木第一片**(唯一動到程式的一片);新竹物流兩份 API 文件親讀落檔。
> **環境**:`pcm-website-v2` · branch `dev` · 無 DB 變更 · 非 auto mode。
> **push 狀態**:🔴 **當場查**:`git log --oneline origin/dev..HEAD`。本 session 尾聲 Sean 明示「其他先 commit push」⇒ 已推;但**任何寫死的數字都會過期**。
> **接手先讀**:本檔 → 畫面預覽 artifact(下方連結)→ `docs/specs/2026-07-25-admin-backend-rebuild-spec.md` **§0a** → memory `project_m4b-admin-preview-decisions`。

---

## 1. 交付物

| 產物 | 路徑 | 說明 |
|---|---|---|
| **畫面預覽 artifact** | `docs/specs/2026-07-26-admin-backend-preview.html`(2269 行) | 🔴 **原網址已失效**(07-26 第二輪實測:list+WebFetch 皆查無,原因不明)→ **現行網址=`https://claude.ai/code/artifact/2061fa03-5626-4aaa-b172-f818eb0e21e8`**(07-26 第二輪 session 重發布並持有;要改=改本檔再 republish 同路徑,或從其他 session 帶 `url` 參數) |
| **新竹物流 API 參考** | `docs/reference/hct-logistics-api-reference.md` | 兩份官方 PDF 全文親讀後的整理 + 未確認清單 |
| **E11 積木** | `apps/admin/src/components/shared/admin-data-table.tsx` + `.test.tsx` | 唯一動到程式的一片 |
| **拍板 memory** | `project_m4b-admin-preview-decisions` / `reference_hct-logistics-api` | 已登 MEMORY.md |

**畫面數 39**(實測 `grep -c 'class="wf '` = 34 桌機框 + `grep -c 'class="phone '` = 5 手機框)。
🔴 **不要相信本檔寫死的數字,要用就當場 grep**——本 session 內此數字從 24→29→34→38→39 變過四次。

---

## 2. Sean 十四項拍板(接手不得重問;全文見 memory `project_m4b-admin-preview-decisions`)

Q1=A 選單五組 + 匯率係數改放報表 · Q2=A/Q9=A 列表欄位保留車種品牌、順序改 Sean 習慣 · Q3=B 匯款差額允許記 · **N6=圖片跨商品共用做媒體庫** · Q5=B 供應商延後 · Q6 運費兩口徑(零錢櫃現金 vs 銀行匯款) · Q10=A 砍存成檢視 + 報表換帳齡 · **Q11=A 已付款可取消** · 取消後未退款可復原 · 多單作業 0/A/B 都做 C 砍 · Toast 5 秒 · 快遞三選(新竹串 API) · 前台也要有密碼重設 · 報表「已收款未出貨」單獨拉一格。

🔴 **兩個最容易被後續 session 誤用的事實**:
1. **訂單量預期 1-300 筆**(不是現況 34 筆)⇒ 任何以「量小所以不用做」為由的設計判斷一律失效。
2. **N6 不是 Q4** —— 圖片共用這題在既有 plan 的編號是 **N6**;`Q4` 是內容發布模型。本 session 一度誤稱 Q4,已在規格 §6 加註警告。

---

## 3. 🔴 三條「查證後推翻原判斷」的紀錄(接手照抄前先看)

| # | 我原本說 | 事實 | 證據 |
|---|---|---|---|
| 1 | 訂單明細「缺車種」是新功能 | **列表早就有車種欄**(逐品項直出);缺的是**明細的資料契約** | `AdminOrderDetailItem`(`packages/domain/src/order/types.ts:360`)無 `brand`/`vehicle`;`AdminOrderLine` 兩者皆有 |
| 2 | 「後台能取消訂單,只是原因是自由文字」 | **後台完全沒有取消的按鈕或寫入路徑** | `grep 取消訂單/cancelOrder/cancelled_at 寫入 apps/admin/src` 零命中 |
| 3 | 「新竹標籤不用自己排版」 | **只對一半** —— 有兩條路;走「自己畫」要照規格排版 + 多叫一支 API + **送新竹資訊處審核** | 標籤規格 PDF 全 30 頁即為此而寫 |

另有一條我自己造成的引用失效:artifact 頁尾曾寫 `customers-table.tsx:44-50`,但同 session 的 E11-1 重構把該檔改掉了 ⇒ 已改 `11-55`。**動了被文件引用的檔案,要回頭改引用。**

---

## 4. E11 積木第一片(唯一動到程式的)

**`<AdminDataTable>`** — 欄位定義驅動,桌機 `<table>` / 手機(<768px)轉卡片。`customers-table.tsx` 為第一個消費端。

- **「桌機外觀零變更」是實測**:一次性 parity 測試把 HEAD 版實作原封貼回同資料渲染比對,**桌機 `<table>` outerHTML 逐字元相同、空狀態 innerHTML 逐字元相同**(3/3;證明後即刪、不入 commit)
- **誠實邊界**:外框 class 外加 `hidden … md:block` ⇒ **手機不再顯示桌機表格、改顯卡片**。這是本片要的功能,不在「零變更」宣稱範圍內
- **驗證**:smoke test 6 條;三綠 typecheck 8/8 · lint 10/10 · build 2/2;full test **253 檔 2951 passed + 1 todo**(前片 252/2945)
- 🔴 **流程缺口(未補)**:**未跑 code-reviewer subagent**(SOP ⑥ 標準片要求)。本 session 前段有「不得呼叫 Agent 工具」的環境層指示、Sean 不在線無法裁決 ⇒ 未擅自繞過,改以 parity 實測 + smoke test 代替。**要補跑請下個 session 指示。**(Sean 後段明示要 Codex+Fable 審預覽,那是對 artifact 的審查、不涵蓋這支 code)
- 🔴 **已知天花板**(元件內 `ponytail:` 註解已標):桌機列與手機卡各渲染一次 cell = 兩份 DOM。**日後接 `orders-table.tsx` 會產出重複 `<form>`**(`ItemWorkflowStatusCell` 是包 `<form action>` 的 Server Component,巢狀 `WorkflowStatusSelect` 才是 client 元件;2026-07-26 補審更正用語,風險本身不變)⇒ 屆時須改單一 markup + CSS reflow,或讓互動欄只出現在單一槽位

---

## 5. Codex + Fable 雙審查結果(Sean 交辦,審查方向=實際操作便利度)

**兩邊獨立重疊命中 5 條**(重疊=可信度高),全部折入:缺跨單搜尋 / B 案假設未證實 / 供應商單號與預計到貨日全份零欄位 / 「整張單全到齊才能出」對跨供應商代購是災難 / 「同客戶」不等於可併寄。
**Fable 獨有 3 條**:總覽首頁的 `selectActorAction`(稽核 log 的 actor 來源)在新選單架構中無安置位置會被靜默弄丟 / 取消訂單整項漏畫 / 桌機版今日待辦漏畫。
**Codex 獨有 1 條**:退貨只能看不能操作。

審查另建議砍三項,Sean 已裁:砍 2.7-C ✅ / 砍存成檢視 ✅ / 報表換帳齡 ✅。

---

## 6. DB / 部署 / 外部足跡

**零 migration、零 DB 寫入、零 flag 變更、未動 `.env*`。**
外部唯讀操作:讀新竹物流兩份公開 PDF(firecrawl scrape)、`codex exec -s read-only`。
🔴 **但 push 有部署效果**:`dev` = **pcm-admin 的 production 分支** ⇒ 本次含一支 code commit(`AdminDataTable` + `customers-table` 重構),推上去 **admin 會重新部署**,客戶列表換成新元件(桌機逐字元相同、手機新增卡片)。storefront 看 `main`、不受影響。

---

## 7. 開放項

### 🔴 A. 需 Sean 親自做

| 項目 | 說明 |
|---|---|
| **向新竹站所申請 API 帳號** | 查貨與出貨是**兩張不同申請表**,找配合站所的電腦負責人。**沒有帳號無法實作出貨串接** |
| 1 元商品真刷 smoke | carry-over 自 RF2a-0,仍未做 |
| 確認月報表運費摘要格 | ✅ **已解**(Q6:兩個口徑),本列可撤 |

### ⏳ B. 接手可做

**施工序不變:E11 後台 UI 積木 → E8 員工帳號權限 → E10 訂單閉環。**

1. **E11 第二片**:🔴 **不建議直接接 `orders-table.tsx`**(rowSpan 同單分組 + 帶 `<form>` 的 client 狀態欄,會撞 §4 的雙渲染天花板)。較安全=等商品列表這種新頁,或先補 `<AdminDataTable>` 的 rowSpan/互動槽支援。另可做 `<AdminForm>`(主側兩欄 + sticky 儲存列 + 雙層錯誤)
2. **E8 員工帳號權限**:`apps/admin/src/lib/staff.ts:3` 名單寫死 = 上線硬前置
3. **前台密碼重設鏈**(跨 repo 到 storefront):🔴 **後台「寄密碼重設信」的硬前置** —— 前台 `/forgot-password` 與 `/reset-password` 未做之前後台按鈕不得上線

### 📌 C. 尚未定案(實作前必須先決定)

1. **一張訂單分批出貨時的訂單編號後綴規則** —— 新竹「同一 `esdate` 內訂單編號不可重複」,而 §2.6 支援先出現貨 ⇒ **同日出兩批會撞**。未定
2. 新竹兩份 PDF 檔名皆 `_V1` 但內頁版本各為 `ver 2.0` / `V2.42`,**是否為最新版未確認**;申請時應索取當期文件
3. 「虛擬帳戶強制金額相符」來自 **Sean 確認、非查證銀行文件**;串接前仍應對規格
4. 報表是否把「已收款未出貨」再細分(Sean 已拍要拉一格,細分粒度未談)

---

## 8. 收尾自檢

- ✅ `git status` clean、無 `.env*`/大檔/`.DS_Store` 殘檔
- ✅ 三綠 + full test 全綠(E11 片;其餘 commit 為純 docs 不觸發)
- ✅ 拍板全數落 memory(非只留 commit body)
- ✅ 兩處我寫錯的現況已更正並在 commit body 說明,未靜默改掉
- ⚠️ **未跑 code-reviewer subagent**(見 §4,原因與代償已記)
- ⚠️ graphify 未刷:本 session code 變更僅 `apps/admin` 兩檔,handoff skill 標準為「動過 code 才刷」;**接手若要刷圖請自行判斷**

---

## 相關檔案

- **畫面預覽**:`docs/specs/2026-07-26-admin-backend-preview.html` → https://claude.ai/code/artifact/2061fa03-5626-4aaa-b172-f818eb0e21e8(原 f8f18cd5 網址已失效、07-26 重發布)
- **新竹物流 API**:`docs/reference/hct-logistics-api-reference.md`
- **主規格**:`docs/specs/2026-07-25-admin-backend-rebuild-spec.md`(🔴 先讀 §0a;§6 的 N6 已於本 session 改為已拍板、§4-7 Toast 已改 5 秒)
- **前一份 handoff**:`docs/handoff/2026-07-26-admin-backend-spec-handoff.md`
- **memory**:`project_m4b-admin-preview-decisions` / `reference_hct-logistics-api` / `project_admin-backend-staff-ready-goal`
