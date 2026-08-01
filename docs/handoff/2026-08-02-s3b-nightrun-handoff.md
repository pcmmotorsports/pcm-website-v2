# S3b-2 / S3b-3 夜跑交接(2026-08-02 凌晨寫)

> **接手入口。開工前整份讀完。** 上游 = `docs/handoff/2026-08-01-supplier-master-handoff.md`(S1a-S3a 那五片)。
> 片級 plan = `docs/specs/2026-08-01-e10-supplier-s3b-settings-page-plan.md` **v3**(三片拆法、驗收、誠實邊界)。

---

## §0 🔴🔴 排程歸屬 —— 開視窗第一件事讀這段

**05:00 的自動開跑由「Sean 08-02 凌晨新開的那個視窗」持有,也就是讀到這份檔的你。**

- **前一個視窗(寫這份交接的那個)沒有排任何排程,也不會排。**
- 你是**唯一**一份。**不要因為「重複排的成本低」就再排一份** ——
  那句話已在 2026-08-01 深夜被推翻:同一個 cron 排在兩個視窗,兩個 agent 都真的對同一筆
  sandbox 交易送出退款,六元被吃掉四元、1 元無法歸屬。落檔 memory
  `feedback_duplicate-cron-double-fires-external-writes`。
- 🔴 **本次夜跑不含任何對外寫入**(不 push / 不碰正式站 / 不跑 migration)⇒ 風險等級低於那次事故,
  但**兩個視窗同時改同一批檔會撞 git index**(memory `project_parallel-sessions-shared-git-index-collision`、
  `feedback_concurrent-session-git-index-contamination`:曾經 `--amend` 改到別人的 commit)。
- **開工前先 `git log -1` 與 `git status --porcelain` 與本檔 §1 比對;不符 = 停下回報,不是調參數繼續。**

---

## §1 起點(以當場 git 為準,本檔不寫死未推數)

```bash
cd /Users/sean_1/pcm-website-v2 && git branch --show-current && git status --porcelain && git log --oneline -3
```

預期:branch=`dev`、工作樹乾淨、HEAD = `d7fe3b9`
(`feat(admin): S3b-1 供應商寫入面 createSupplier/updateSupplier + 四層防線 [M-4b]`)。
未推數用 `git rev-list --count origin/dev..HEAD` 當場取。

**另有一個視窗在做前台(`apps/storefront/src/**`)。**
我的領域 = `apps/admin/`、`docs/specs/2026-08-01-e10-supplier-*`、`docs/handoff/2026-08-02-s3b-*`。
一律 `git add <精確路徑>`,**禁 `git add .` / `-A`**;`--amend` 前先 `git log -1` 確認 HEAD 是自己那筆。
`STATUS.md` 與 `docs/handoff/CURRENT.md` 是真衝突點,改之前先 `git status` 確認對方沒動。

---

## §2 已完成:S3b-1 寫入面(`d7fe3b9`)

| 檔 | 行數 | 內容 |
|---|---|---|
| `apps/admin/src/lib/supplier-form.ts` | 166 | 三個純解析器 + `rpcTrim`(O(n) 索引掃描)+ 31 碼位空白集 |
| `apps/admin/src/lib/supplier-form.test.ts` | 266 | 36 綠 |
| `apps/admin/src/lib/supplier-repository.ts` | 190 | `listSupplierRows` + `createSupplier` + `updateSupplier` + `SupplierCallerBugError` |
| `apps/admin/src/lib/supplier-repository.test.ts` | **369** | 29 綠。🔴 **已進 >300 硬警戒** |

**驗證**:三綠 + 完整套件 **284 檔 3562 passed + 1 todo**;本片 65 綠;
**突變 15 格**各紅在指定斷言,其中 **4 格的判官是 tsc(TS2578)不是 vitest**。

**契約債①(id 弄丟 ⇒ 靜默降級成新增 ⇒ 一筆刪不掉的垃圾列)已做成四層**,
每層在 `supplier-repository.ts:39-50` 明文寫了**擋不住什麼**:

| 層 | 擋得住 | 擋不住 |
|---|---|---|
| 解析器 uuid 形狀閘 | 缺欄位 / 空字串 / 非 uuid | 合法但**指向別家**的 uuid |
| 型別分流(`id?: never` / `id` 必填 / patch 聯集) | 弄丟 id、create 當 update 用、**spread 帶進 id** | `as any` |
| runtime 閘 | `as any` 繞過來的 id 與空 patch | 刻意傳錯的合法 id |
| 回傳碼窮盡收斂 | RPC 漂移、`CREATED` 出現在改名路徑 | 🔴 **走到這裡垃圾列已經寫進去了 = 偵測不是預防** |

---

## §3 Sean 2026-08-02 凌晨三拍板(逐字落檔 memory `project_m4b-supplier-master-decisions`)

- **Q1=A** 夜跑吃「把供應商設定頁做完」= **S3b-2 + S3b-3**。
  🔴 **知情前提**:今晚不管跑哪片,早上 27 項驗收**都還是 2/27**。夜跑的期待是「白天他能看的東西變多」。
- **Q2=A** 撞到**已停用**的同名供應商時:**顯示訊息 + 清單自動定位到那一列並標記,員工自己按該列的「啟用」**。
  未採「跳確認框直接啟用」⇒ **啟用是要員工自己按的動作,系統不代按。**
- **Q3=C** 改名**不填原因**(`p_note` 一律 null)⇒ **現有 code 就是這樣,零改動**。
  連帶:`supplier-form.ts` 檔頭記的「note 鏡像規則」契約債**繼續休眠**。

早先已拍板(v3 §7):**D1=B** 自寫過濾(非原生 `datalist`)/ **D2=A** 母 plan 驗收 16 後半移交 A10b /
**D3=B** 真瀏覽器只按可還原的動作。

---

## §4 S3b-2:action 面(先做這片)

**產物**

| 檔 | 新/改 | 內容 |
|---|---|---|
| `apps/admin/src/lib/supplier-actions.ts` | 新 | 三個 server action |
| `apps/admin/src/lib/supplier-actions.test.ts` | 新 | — |
| `apps/admin/src/lib/supplier-result-messages.ts` | 新 | `?r=` 對應文案 |
| `apps/admin/src/lib/supplier-write.test.ts` | 🔴 **新(拆檔)** | 把 S3b-1 的寫入面測試從 `supplier-repository.test.ts`(369 行)搬過來 |

🔴 **先拆檔再加測試** —— `supplier-repository.test.ts` 只剩 31 行就破鐵則 6 的 400。
拆的時候**逐條搬、不改內容**,搬完兩檔各自跑一次確認總數不變(29 綠拆成兩份加起來還是 29)。

**形狀照 `apps/admin/src/lib/staff-actions.ts`**(已上線樣板):
①`authorizeAdminMutation()` 授權閘 → ②解析 → ③呼叫 repository → ④PRG redirect。
🔴 **本片沒有稽核 code** —— RPC 同交易寫 `admin_audit_log`(`20260801160000:227`/`:284`)
⇒ 沒有 staff 那種 `audit_failed` 狀態,也沒有「主資料成功但稽核失敗」的窗口。

**結果碼**(plan §3.7):`created` / `saved` / `nochange` / `duplicate` / `notfound` / `invalid` / `denied` / `bug` / `error`

🔴 **錯誤分流是本片的重點,不要全部收斂成 `error`**:

| 情況 | 結果碼 | 訊息要點 |
|---|---|---|
| `SupplierCallerBugError` | **`bug`** | 「系統偵測到異常,**可能已多出一筆供應商**,請通知維護者」 |
| 一般 DB error | `error` | 「儲存失敗,請稍後再試」 |
| `DUPLICATE_LABEL`(新增) | `duplicate` + **`&q=<剝過空白的 label>`** | 見 §5 的 Q2=A 定位行為 |
| `NOT_FOUND` | `notfound` | 「找不到該供應商」 |
| 解析失敗 | `invalid` | **RPC 零呼叫** |
| 授權失敗 | `denied` | **RPC 零呼叫** |

**驗收(逐條可 yes/no)**

1. 三個 action 各自:`authorizeAdminMutation()` 回 null ⇒ `denied` 且 **repository 零呼叫**。
2. 解析失敗 ⇒ `invalid` 且 **repository 零呼叫**。
3. `SupplierCallerBugError` ⇒ `bug`,**且與一般 error 分得開**(突變:把 catch 合併成一個 ⇒ 轉紅)。
4. 新增撞名 ⇒ redirect 含 `r=duplicate` **且**含 `q=` 剝過空白的 label;`q` 超過 100 字元 ⇒ **不帶** `q`。
5. 每個成功路徑呼叫 `revalidatePath('/settings/suppliers')`。
6. redirect 目標是**寫死的站內常數**,無 `return_to` 參數面(釘成測試,不是靠「照抄 staff 沒問題」)。
7. 未知的 `?r=` 值 ⇒ banner 不顯示任何東西。
8. 三綠 + 完整套件全綠 + 逐檔 ≤400。

---

## §5 S3b-3:UI 面

**產物**:`app/settings/suppliers/page.tsx` / `components/settings/supplier-table.tsx` /
`supplier-edit-row.tsx` / `supplier-create-form.tsx`(`'use client'`)/
`lib/supplier-candidates.ts`(**純函式**)+ 其測試 / `supplier-table.test.tsx` /
`lib/supplier.ts` 加共用排序 / `components/layout/app-sidebar.tsx` 加一行 nav。

🔴 **共用排序(交接檔明文要求,不要複製 collator)**:
`sortSuppliersByLabel()` 為唯一 export 的排序入口,`listSuppliers()` 與新的
`listSuppliersForSettings()`(全部列含停用)都吃它。驗收要**行為層 + 結構層兩條**:
兩支各用中英混排亂序向量釘住順序,**外加**斷言 `apps/admin/src` 全樹 `new Intl.Collator` 恰 1 處。

🔴 **`loadFailed` 時不渲染新增表單**(**刻意偏離 staff 樣板** —— `staff/page.tsx:47-55` 是會渲染的)。
理由:名單載不出來 ⇒ 員工看不到「這家已經有了」⇒ 建一筆**永久**垃圾列(供應商不可刪除)。
驗收要配突變(把新增表單移到條件式外面 ⇒ 轉紅)。

🔴 **Q2=A 的定位行為**:頁面讀 `?q=`,用**同一支** `filterSupplierCandidates` 把清單過濾到那一列並標記,
該列的「啟用」按鈕就在原處(**不代按**)。`q` 只當過濾字串,**永不直接渲染成文字**。

🔴 **候選提示含已停用的列**且標「(已停用)」—— 這是契約債②的**送出前**防線。

**驗收 16(D1=B 的測法,plan v3 §5 已寫死 16a-16h)**:
`Webike` ⇒ 恰 3 筆 / `zzzz` ⇒ 0 筆 / 大小寫不敏感 / 前後空白不影響 / 含停用候選 /
空 query ⇒ 全部 / 突變(改成前綴比對、偷加 `is_active` 過濾)/ 元件層一條釘住「真的接到那支純函式」。

**改名表單旁必須有一行員工看得到的小字**:「改名後,過去所有採購紀錄都會顯示新名字」
(母 plan §6:243-245,Sean Q1=A 知情選擇 —— 不能只寫在 plan 裡)。

---

## §6 🔴 夜跑紀律(無人值守時自己遵守)

- **不 push**(Sean 手動)。**不對正式站寫入。不跑 migration。不動 `.env*`。**
- **審查 NO-GO 不自行放行**;同一件事最多重試 2 輪,第 2 輪仍失敗 ⇒ 停下整理決策題。
- 命中鐵則 12 ⇒ code-reviewer + codex 關卡2 都跑,**不降級**(S3b-2 命中②權限)。
- **修法含 disable / skip / ignore / 繞過 ⇒ 停下回報**,不屬自己可拍的板。
- 🔴 **突變前先確認基準線是綠的** —— S3b-1 踩過:第一輪突變顯示「typecheck 紅」,
  查下去發現基準線本來就紅(測試檔兩個型別錯),整輪結論作廢重跑。**基準線沒先驗證,突變數字一文不值。**
- 🔴 **`git commit` 不准加 `--no-verify`**(hook 會擋,而且擋得對)。
- **真瀏覽器驗收留白天**,不排夜裡(D3=B 要當著 Sean 的面跑)。

## §7 早上要交出的東西

1. 每片的 commit(含 STATUS 7 欄同 commit)。
2. 一份收尾報告:做了什麼 / 三綠與突變實測數字 / **沒做到什麼** / 白天需要 Sean 看的清單。
3. 🔴 **不得寫「端到端已驗證」** —— 新增那條路的接線只有 mock 背書,真瀏覽器沒跑過新增。
4. 未推 N 筆,等 Sean 手動推。

— END —
