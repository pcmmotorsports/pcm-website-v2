# A10a-3:訂單備註表單 + 更正入口(sub-slice plan)

> M-4b E10 備註線最後一哩(A6 RPC ✅ → A9d2-1 action ✅ → A10a-1 純邏輯 ✅ → A10a-2 唯讀時間軸 ✅ → **本片**)。
> 完成後員工可在明細頁寫入第一筆備註,27 項驗收第 3 項轉綠。
> 範圍批准鏈:08-02 拍板 A(備註線三片)+ 08-03 早 Sean「先push 後繼續做」(A10a-3 內容已在回報中描述)。
> 🔴 誠實標注(R1 N10):**本 plan 檔本身未經 Sean 逐字批准**,依上述線級批准與口頭 go 推進;
> 鐵則 8 的補償 = 收工回報明列改動面 + Sean 肉眼驗收後才算收。
> 片型 = **標準片**(接寫入 action、跨 4 檔;不命中鐵則 12 六類 —— 非錢/權限/schema/平台/對外/packages-ui)。

## §1 要改什麼 / 為什麼

| 檔 | 動作 | 內容 |
|---|---|---|
| `apps/admin/src/components/orders/note-compose-form.tsx` | 新增 | client 表單:`useActionState(appendOrderNoteAction)`、型別分流 UI、datetime→帶偏移 ISO、更正模式 + confirm |
| `apps/admin/src/components/orders/notes-timeline.tsx` | 編輯 | 每列「更正」入口(`?correct=<id>#note-compose` Link;`canCorrect=false` 列 disable) |
| `apps/admin/src/components/orders/order-detail.tsx` | 編輯 | server 渲染期產 token(Q2=C)、解析 correctTarget、掛表單 |
| `apps/admin/src/app/orders/[id]/page.tsx` | 編輯 | 讀 `?correct` searchParam(uuid 閘)下傳 |

Rollback:純 UI 層、無 schema/env 改動 → revert commit 即回 A10a-2 狀態(唯讀時間軸不受影響)。

## §2 七條契約債(A9d2-1 plan §8)逐條落點

| 債 | 本片落點 |
|---|---|
| ① token hidden input;失敗沿用 `state.requestToken`;產生點不落快取層 | idle 態 token 由 **server component 渲染期**產(`generateNoteRequestToken`、`note-action-state.ts:52-54`;頁層 force-dynamic `page.tsx:15`、元件層零快取);hidden value = `state.status==='failed' ? state.requestToken : (bfcache 重產 ?? serverToken)`;**不用** `lib/request-id.ts`。⚠️ 保證面 = **同 URL 重渲染**(失敗 revalidate 不 remount、token 續存);跨導航(取消更正/重整/換頁)不保 token 連續 —— 與 `error` 訊息叫員工重整的既有行為同類,非新增失敗類別(R2-N2) |
| ② occurredAt 帶偏移 ISO | `datetime-local` 無 name、**受控**(state);hidden `occurred_at` 由同一 state 於渲染期以 `new Date(local).toISOString()`(browser 本地時區→Z)換算 —— 可見/送出兩值結構上不可能分岔(R2-N4 同步);NaN → 空字串(交給解析器擋) |
| ③ 端到端雙擊「只留一筆」 | UI 層:`isPending` disable submit(jsdom 只能測「disabled 按鈕吃不到後續 click」;兩次原生 click 都落在 re-render 前的真雙擊窗口 jsdom 測不到 —— R1 N9 對齊);**真保證 = A6 token 冪等(已突變釘死)**;E2E 實測 = §5 Sean 正式站驗收步驟 |
| ④ bfcache 返回後 token 重產 | `pageshow` 且 `event.persisted` → client 重產 token(誠實代價:此路徑 token 為 client 產;Q2=C 已明文承認繞過畫面者本就可自選,server 權威只保 honest path)。失敗態不受影響(仍沿用 state 那把 = R2-2) |
| ⑤ `customerNotified` null → 無法判定 | A10a-2 已落(`describeCustomerNotified`);本片不再碰 |
| ⑥ 已被更正列 disable + 送出前 confirm 不可撤回 | timeline 列:`canCorrect=false` → disabled button(已更正 badge 同列說明原因;R1 N2);表單更正模式 onSubmit `window.confirm`(含節錄 + `CORRECTION_IRREVOCABLE_NOTICE` 全文;R1 N5);🔴 R1 MF1:更正模式 radio 初值 = **被更正列的原型別**(預設 internal 會把告知紀錄的更正靜默寫成 internal ⇒ `customerNotified` 翻 false 且不可撤回),key 綁目標 id 保初值新鮮;🔴 R1 MF2:`?correct` 解析不到(並行 session 已更正/截斷後返回)→ **顯示警告「送出的會是新備註」**,不靜默降級;RPC `ALREADY_CORRECTED`/`CORRECTS_NOT_FOUND` 為第二道 |
| ⑦ 更正鏈 visited+深度上限 | A10a-1 已落(`walkCorrectionChain`);本片顯示不走鏈(雙向標記已足),不新增消費端 |

## §3 互動設計(暫定、待 Sean 肉眼)

- 表單 = 時間軸下方獨立卡片(anchor `#note-compose`)。型別三選(radio):內部備註(預設)/ 聯絡紀錄 / 已告知客人;非 internal 才顯示聯絡管道(5 選)+ 聯絡時間(`datetime-local`、required)。
- 更正模式(`?correct=<id>`):卡片頂顯示「正在更正 #N・型別・內容節錄」+ 不可撤回告知 + 「取消更正」連結(回乾淨 URL);hidden `corrects_note_id`。
- 失敗:destructive alert 顯示 `state.message`;body 為 uncontrolled textarea(client transition 下 DOM 自然保留;`defaultValue` 帶 `state.body`)。⚠️ **無 JS / hydration 前送出路徑未驗證**(R1 N3):該路徑下 confirm 閘與 datetime 換算不執行,安全底=解析器 fail-closed + RPC 第二道,體驗未測、不宣稱。
- 成功:action 端 PRG → `?r=note_added` banner(已註冊 `result-banner.tsx:20`)。
- 🔴 全部中文字面 = 暫定稿,Sean 肉眼後定案(結構鎖、字不鎖)。

## §4 測試矩陣(jsdom smoke;語意層在 A9d2-1/A10a-1 各自測過、不重測)

1. 預設 internal:無 channel/時間欄;hidden token = serverToken;hidden `order_id` 正確。
2. 切 contact_log:channel + datetime 出現且 required;切回 internal 消失。
3. datetime 換算:測試檔**釘 TZ=Asia/Taipei + 前提自斷言**(R1 MF3:UTC CI 下 epoch 等值對「local 當 UTC 解析」突變恆真),斷言 hidden = 台北 14:30 的 UTC 字面(06:30Z)。
4. 更正模式:告知文案在、hidden `corrects_note_id` 在、取消連結 href 對。
5. confirm gate:mock confirm=false → action 零呼叫;true → 呼叫一次;confirm 內容含節錄;非更正不問。
6. 失敗 state:mock action 回 failed → message 顯示 + token 沿用(hidden 值不變)。
7. pending:mock action 懸置 → 按鈕 disabled、後續 click 不加 dispatch 次數。
8. pageshow persisted → hidden token 換新;非 persisted 不換。
9. MF1:更正 `customer_notified` 列 → radio 初值 = 原型別、管道/時間欄在場。
10. MF2:`correctionMissing` → 警告「送出的會是新備註」、無 corrects hidden。
11. timeline:canCorrect 列有更正 Link(href 含 id)、corrected 列為 disabled button。

## §5 驗收(Sean、正式站;寫入路徑受 verifySession 限、S3b-3 前例)

⚠️ `order_notes` **append-only、測試筆永久留存** → 目標訂單由 Sean 指定(建議用內部備註型別,對客零可見)。
1. 寫一筆內部備註 → 出現在時間軸 + `備註已新增` banner。
2. **雙擊送出 → 只留一筆**(債③)。
3. 成功後按返回鍵再送一筆(改字)→ 正常寫入、不得撞「系統狀態異常」(債④)。
4. 寫一筆聯絡紀錄(管道+時間)→ 時間軸顯示的聯絡時間 = 你填的台北時間(債②)。
   時間欄用**鍵盤逐段輸入 + 退格改時間**,確認段落不被吃掉(R2-N3:受控 datetime-local 在真瀏覽器的逐段輸入 jsdom 測不到)。
5. 對第 1 筆按更正 → confirm 出現不可撤回全文 → 送出 → 原列標「已更正」且更正入口消失(債⑥)。
6. 文案定稿(全部暫定字面)。

## §6 審查紀錄

- **opus code-reviewer R1 = FAIL(3 must-fix + 10 nit)**,逐條主對話親驗、駁回 0、全折入:
  - MF1 更正不繼承原型別 → 告知紀錄的更正靜默寫成 internal、`customerNotified` 翻 false 不可撤回 ⇒ `CorrectTarget.noteType` + radio 初值 + key remount。
  - MF2 `?correct` 解析不到靜默降級成新增(真實可達:並行 session 已更正/截斷後返回)⇒ `correctionMissing` 警告。
  - MF3 時區斷言在 UTC CI 恆真(審查者實跑證明)⇒ 測試釘 TZ=Asia/Taipei + 前提自斷言 + 釘死期望字面 `06:30:00.000Z`。
  - nit N1-N10:aria-label 蓋可見 label / disabled span→button / full-reload 未驗證標注 / 非 secure context fallback(主對話 10000/10000 + 審查者 20 萬次過 UUID_RE)/ confirm 帶節錄 / UTF-16 註解 / 去重複 buildNoteTimeline / datetime 受控化 / 債③ 字面對齊 / 批准鏈誠實標注。
- **R2 = PASS(0 must-fix + 4 nit)**,審查者親跑 TZ=UTC 全套 49 檔 591 綠(證 TZ 釘住不污染兄弟檔);4 nit 全折:R2-N1 `canCorrectNote()` 單一定義點 / R2-N2 債① 保證面字面(§2 已補)/ R2-N3 進 §5 驗收步驟 4 / R2-N4 債② 字面同步。
- 三綠:typecheck 8/8 + lint 10/10 + admin build 綠;admin 套件 49 檔 591 passed + 1 todo(收工重跑於 commit 前)。
