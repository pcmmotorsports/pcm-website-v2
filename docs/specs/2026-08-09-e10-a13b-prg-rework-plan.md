# M-4b E10 · A13b 表單 PRG 整頁化 plan **v3**(換路)

> E 窗 · worktree `/Users/sean_1/pcm-cancel-ui` · branch `cancel-ui` · 基底 **`07dc69fc`**(v2 寫 `76c27011` 已過期;其間 `order-detail.tsx` 被改過)
> 主視窗裁決:`E-012-A` **Q1=A**(PRG 整頁化)+ 三條約束;**C 永久否決**;B 備而不用。`E-014-A` Q1=A / Q2=A。
> 前情:`E-011-STOP`(停手理由與四輪實測)、`E-013-STOP`(v1 進度)。
>
> 🔴 **審查狀態**:關卡1 **R1 判 v1 FAIL / 15 MF** → v2 折入 → 關卡1 **R2 判 v2 FAIL / 13 MF + 1 nit**(2026-08-09,零留痕已驗)。
> 本 v3 = 逐條折入 R2,**13 條逐條處置見 §8**。R2 的三條「動手前須拍板」已抽成 §7 決策題,**未回覆前不開工**。
> ⚠️ v3 本身未再經審查;主視窗過目後若判需 R3,由主視窗指定。

---

## §0 v3 推翻 v2 的三件事(先講,免得又照 v2 字面動手)

1. 🔴 **v2 §2-3③ 的 `full_confirm`(只在點了「整單取消」時才渲染的一次性欄)在 v2 的形狀下做不出來。**
   「點了才渲染」需要 client state,和同一份 plan 的「零 client state」互斥;而且 bfcache 復原的是**整個 DOM**、
   動態插入的欄一樣會回來,自造 POST 更是直接補一顆就好。
   ⇒ v3 改用**兩支獨立 form**(§2-3),`full_confirm` 整個概念刪除。**待 §7 Q1 拍板。**
2. 🔴 **v2 §1「失敗導頁 → 讀 `r`/`rt` → 查帳本」把兩種不同的失敗混成一種。**
   實查:`?r=` 是訂單明細頁**唯一共用的一顆參數**,由既有 `ResultBanner` 消費
   (`apps/admin/src/components/orders/result-banner.tsx:18-58`,map 裡已經有 `invalid`/`denied`/`error`/`not_found`)。
   ⇒ v3 把六碼切成兩類(§1a):**未送出類**只是一則文案、**沿用既有 ResultBanner**、不需要 `rt`、不需要查帳本;
   **已送出結果不明類**才帶 `rt` 並走帳本核對面板。rt 與帳本的暴露面因此縮到只剩兩顆碼。
3. 🔴 **v2 §1「失敗導頁用 replace ⇒ 上一頁也重播不了」是未實測的斷言。**
   實查 Next `16.2.6` / React `19.2.6`(`apps/admin/package.json:20-23`)。
   enhanced(有 JS)action 與 progressive(無 JS,303 Location)兩條路徑的 history 語意**不同**,plan 不得預先宣稱。
   ⇒ v3 不再把「重播不了」寫進驗收;改成**重播也只能看到帳本的真話**(§1b),history 行為列為 D2 的實測項。

## §1 目標形狀(v3)

### §1a 結果碼分兩類(這是 v3 最重要的結構改動)

| 類 | 碼 | 帶 `rt`? | 誰消費 | 顯示依據 |
|---|---|---|---|---|
| **A 未送出**(RPC 從未被呼叫) | `order_cancel_denied` / `order_cancel_invalid` / `order_cancel_ineligible` | ❌ 不帶 | 既有 `ResultBanner`(登錄新碼) | 靜態文案。**沒有事實要核對**——RPC 沒被呼叫過是 action 自己知道的事 |
| **B 已送出、結果不明** | `order_cancel_retry` / `order_cancel_error` | ✅ 帶 | **新**帳本核對面板 | 🔴 **一律由帳本 classifier 產出**(§1c);URL 只決定「要不要顯示這個面板、要對哪一顆 token」 |
| **成功** | `order_cancelled` | ❌ | 既有 `ResultBanner`(登錄新碼) | 靜態文案 |

🔴 **碼一律 namespaced**(R1 finding 10):既有 map 已佔用 `invalid`/`denied`/`error`/`not_found`/`saved`/`noop`/`conflict`,
**零碰撞由測試釘死**(D1 驗收:新碼集合 ∩ 既有碼集合 = ∅,且新增任何一顆未 namespaced 的碼會讓測試轉紅)。

### §1b 其餘各面

| 面 | v2 | **v3** |
|---|---|---|
| 成功 | `redirect(detail?r=order_cancelled)` | 不變(碼改 namespaced) |
| 失敗 | `redirect(detail?r=<碼>&rt=<token>)` | 🔴 **只有 B 類帶 `rt`**;A 類只帶 `r` |
| 導頁目標 | 讀 client 送的 orderId | 🔴 **授權後才跑的 envelope parser** 取 `order_id` 並驗(uuid + 該單本 actor 看得到);驗不過 → `/orders`。完整 parser 失敗只回 `{ok:false}`、拿不到 orderId(`cancel-actions.ts:107-137` 實查)⇒ envelope 是必要的、不是可選 |
| history | 宣稱 replace ⇒ 重播不了 | 🔴 **不宣稱**。用 replace(能生效就生效),但**安全論證不靠它**:重播/重整只會重跑 §1c 的帳本核對,看到的永遠是帳本的真話 |
| canonical 清除 | 「看過即清除」 | 保留,但**降級為 UX**(不再是安全前提)。清除機制 client/server 兩案在 D5 第一動實測後挑 |
| 表單狀態 | 零 client state | 不變 |
| 面板位置 | 頁層、資格閘外 | 不變(關單後義務 5 的比對仍要在) |

### §1c 帳本 classifier(取代 v2 的「先查帳本」四個字)

`rt` + 帳本 → **五分類窮舉**(R2 finding 6;`packages/adapters/src/supabase/mappers/order-cancellations.ts:115-143` 實查:
`cancellations: null` = 沒讀到、`[]` = 真的沒被取消過、`cancellationsTruncated = rows.length >= LIMIT`):

| 分類 | 條件 | 對員工說 |
|---|---|---|
| `unreadable` | `cancellations === null` | 「查不到取消紀錄(讀取失敗),**不代表沒送出**,請重新整理後再確認」 |
| `match_same_actor` | 找到 `idempotencyKey === rt` 且 `actor` = 本人 | 「你剛才那筆**已經寫進去了**」 |
| `match_other_actor` | 找到但 actor 不同 | 「找到相符紀錄,但登記人不是你,請與同事確認」 |
| `miss_truncated` | 沒找到 **且** `cancellationsTruncated` | 🔴 「**可能在沒列出的那批**裡,無法斷定」(義務 5 的第三分支) |
| `miss_complete` | 沒找到 且未截斷 | 「這筆**沒有寫進去**,可以重送」 |

🔴 **fail-closed**:`rt` 缺失 / 非 uuid / B 類碼但拿不到帳本 ⇒ 一律 `unreadable` 文案,**不得**當成「沒失敗」而把表單開回去。
🔴 **偽造 URL 的上限**:持舊 token 的人組 `r=order_cancel_retry&rt=<舊>` 只能讓自己看到 `match_*`——那是帳本裡本來就有的真話。
⚠️ 殘餘:**關聯洩漏**(有 token 的人能確認那筆存在);對象是已登入後台使用者,收在此。

## §2 三條約束的落地(v3;逐條對 `E-012-A`)

1. **跨片走關卡1**:R1(v1)FAIL/15、R2(v2)FAIL/13,零留痕均已驗。v3 為 R2 的折入版。
2. 🔴 **URL 只帶碼不帶內容**(`E-014-A` 改寫後紀律逐字):①值單獨不可行使 ②看過即清除 ③不含業務內容。
   query **只准** `r`(結果碼)與 `rt`(uuid);金額/品名/數量/說明一律不進。
   🔴 **用詞統一**(R2 nit):`rt` = **request token**(非授權性一次性識別碼);原紀律講的「token 不進 URL」指的是**授權性 token**,兩者不同物。
   `cancel-action-state.ts` 那段「不要把 token 塞 URL」的過期註解在 D2 同片改掉。
3. 🔴 **失敗後不得默默退回整單** —— v2 的三道疊加第③道已被推翻(§0-1),v3 改成**形狀上不存在那條路**:

   **兩支獨立 form**(§7 Q1 待拍):
   - **部分取消 form**:`<input type="hidden" name="cancel_mode" value="partial">` + 品項勾選 + 原因。
     **這支表單裡沒有任何控制項的值可以變成 `full`** —— 沒有 radio 可被 autofill/bfcache 勾回去;
     hidden input 不屬於瀏覽器表單狀態復原的範圍(D6 真瀏覽器負測要釘死這句)。
   - **整單取消 form**:`<input type="hidden" name="cancel_mode" value="full">` + 原因;**不含任何品項欄**。
   - 兩支各自的送出鈕文字 = 員工按的那顆決定送什麼,不存在「以為在 A 卻送出 B」。
   - 原因 `<select>` 兩支都是 `<option value=''>請選擇</option>` + `required`
     (沒有空 placeholder 時瀏覽器會自動選第一個 ⇒「重選」根本沒發生)。
   - **附帶解掉 v2 C5**:「切回 full 時怎麼排除殘留 `cancel_item`」這題消失——整單那支 form 裡本來就沒有品項欄。
   - server 端不變:`cancel-form.ts:172-182` 現況「`full` 卻帶品項 ⇒ `{ok:false}`」保留為第二道。
   - 🔴 **驗收 = 真瀏覽器負測**(§7 Q2):失敗一次 → 返回(斷言 `pageshow.persisted === true`,否則等於沒測到 bfcache)
     → 再送 → 斷言 POST body 的 `cancel_mode` **不是** `full`。突變驗:把兩支 form 併回單一 radio 形狀 → 該測試必須轉紅。
     🔴 **沒有這條真瀏覽器負測,約束 3 就只能宣稱、不能主張**(codex 逐字;jsdom 不算)。

## §3 拆片(v3;全部 15-45 分鐘,C1 的 60m 違反鐵則 4 已重切)

> 排序原則(R2 finding 8):**未完成的模式不得曝光** ⇒ 接線(D6)排最後;在那之前整條功能是暗的
> (實查:`order-detail.tsx` 目前**完全沒有** cancel 表單的接線,只有已取消狀態的顯示 `:250/:319-325`)。
> 每片自己可驗收、不靠下一片才成立。

| # | 片 | 內容 | 驗收(可 yes/no) | 估時 |
|---|---|---|---|---|
| **D1** | 結果碼登錄 | 六顆 namespaced 碼常數 + A 類三碼與 `order_cancelled` 進既有 `ResultBanner` MESSAGES | ①新碼 ∩ 既有碼 = ∅ 的守門測試 ②拿掉 namespace 前綴 → 該測試轉紅 ③A 類三碼與成功碼各有文案 | 30m |
| **D2** | PRG action 改造 | `cancel-actions.ts` 失敗改 `redirect`;**授權後 envelope parser** 取可信 `order_id`;`cancel-action-state.ts` 的 state 型別退場;過期註解同片改 | ①六碼各導到對的出口 ②envelope 驗不過 / `denied` → `/orders` ③🔴 `revalidatePath` 拋錯**仍必導頁**(用會拋的 redirect mock 驗它沒被 catch) ④授權閘仍是第一動(既有 landmine 測試不得被弱化) ⑤**實測記錄**:Next 16.2.6 兩條路徑(有/無 JS)的 history 行為 | 40m |
| **D3** | 帳本 classifier(純函式) | §1c 五分類 | 五格各一測 + fail-closed 三格(rt 缺 / 非 uuid / 帳本 null);突變:拿掉 `truncated` 判斷 → `miss_truncated` 那格轉紅 | 35m |
| **D4** | 兩支表單元件 | §2-3 的整單 form / 部分 form,零 client state | ①兩支各自 hidden `cancel_mode` 值正確 ②部分那支**零 radio、零 name=cancel_mode 的可編輯控制項**(原始碼層守門)③整單那支零品項欄 ④select 有空 placeholder + required | 40m |
| **D5** | 帳本核對面板 + canonical 清除 | 吃 D3 的 classifier 結果算文案;清除機制 client/server **第一動先實測兩案再挑** | ①五分類各自文案正確 ②B 類碼但拿不到帳本 → `unreadable`、**表單不開回去** ③清除後重整不再出現面板 | 35m |
| **D6** | 接線 + 真瀏覽器負測 | 掛 `CancelReviewSection` + 兩支 form 進 `order-detail.tsx`;頁層讀 `r`/`rt`;面板掛**資格閘之外**;§2-3 的 bfcache 負測 | ①RPC 關單後面板仍在 ②真瀏覽器負測綠 ③突變(併回單一 radio)→ 轉紅 | 45m + Q2 基建未知 |

🔴 **D6 的真瀏覽器負測是本線唯一可主張「不會誤送整單取消」的證據**,基建成本未知 ⇒ **§7 Q2 待拍**。
估時合計 D1-D5 = 180m(可獨立完成),D6 = 45m + 基建。

🔴 **內容分級(鐵則 9)**:新增的失敗文案與結果碼 = **L1**(年 0-1 次改、hardcode 可),不需後台 CRUD。
**片型**:全部 **高風險**(鐵則 12 ①錢,送出 `admin_cancel_order`),對抗審查不降級。

## §4 已裁事項(`E-014-A`)

**Q1 = A(rt 進 URL)** —— 三前提落地在 §2-2、暴露面在 v3 已縮到只有 B 類兩碼(§1a)。
**Q2 = A(失敗後全部不保留、一律重填)** + 空值起始 + required(§2-3)。
⚠️ B 案(flash cookie)為避一個小暴露面要引進整套儲存 + 過期語意 = 在正要去風險的片上加故障面(主視窗理由,同意)。

## §5 三視角 / rollback / 紅線

- 擴充性:失敗路徑不必想「怎麼把勾選帶回來」——不帶回、叫他重選。
- 可維護性:狀態單一來源(URL → server → props),沒有 client/DOM 兩份會分岔的真相;兩支 form 讓「模式」變成結構事實而非狀態值。
- 追蹤性:失敗碼與 request token 進 server log;`rt` 讓 log 與帳本對得起來。
- rollback 逆序 **D6→D5→D4→D3→D2→D1**(R2 nit:v2 漏列 C5);**D2 與 D4 不可只 revert 一支**(action 簽章與表單形狀互相依賴)。
- 紅線:不 push、不動 STATUS/CURRENT、不 apply migration、不碰 `.env*`、精準 add。
- 🔴 **不得為了讓測試變綠而弱化斷言**(`E-011-STOP` §2);D6 的真瀏覽器負測配突變驗。

## §6 誠實邊界(v3;v2 的四條全部重寫過)

1. **PRG + `revalidatePath` 在 Next 16.2.6 上的實際互動未實測** ⇒ D2 第一動是最小實測,證不出來回頭改 plan。
2. **history 語意(replace / 無 JS 303)未實測** ⇒ D2 記錄實測結果;**在此之前 plan 不宣稱任何 history 保證**,安全論證不掛在它上面(§1b)。
3. **canonical 清除是本線第一次做的機制**,repo 內無同款前例 ⇒ D5 第一動先實測 client / server 兩案再挑。
4. 🔴 **真瀏覽器負測本窗沒做過,且 admin 沒有 playwright 基建**——實查:`apps/admin/package.json:6-11` 只有 dev/build/start/lint/typecheck;
   playwright 只在 `apps/storefront`(`package.json:13-14,31` + `playwright.config.ts`)。
   admin 的登入面是報價單站 SSO / 共用密碼(`STATUS.md:7`)⇒ **e2e 要先解決「怎麼帶著有效 session 進 admin」**。**成本未知,§7 Q2 待拍。**
5. **多分頁重複部分取消擋不住**:換一顆新 token 送同一份 payload,剩餘量夠就會真的再扣一次
   (實查:`cancel-actions.ts:113-124` 逐字已寫明,**這是現況、不是 PRG 帶來的新洞**)。帳本事後查證不能阻止第二筆。**§7 Q3。**

## §7 動手前必須先回的三題(R2 明列「不得留給施工時臨場決定」)

```
Q1: 約束 3(失敗後不得默默退回整單)的落地形狀?
A: 兩支獨立 form(整單一支/部分一支,各自 hidden cancel_mode,整單那支沒有品項欄也沒有 radio)
   —— 形狀上不存在「值被復原成 full」那條路,順帶解掉 v2 C5 的殘留欄問題  ← 推薦
B: 維持單一 form + 一次性 full_confirm nonce(server 綁定、可消耗)—— 多一套 nonce 儲存與過期語意
C: 整單取消改走第二步確認頁(獨立路由)—— 最安全,但多一個畫面、Sean 沒看過
```
```
Q2: 真瀏覽器負測(D6)的基建怎麼走?admin 目前沒有 playwright,且登入是 SSO/共用密碼
A: 先花 30 分鐘做可行性探針(本機起 admin + 能否注入有效 session),結果回報後再定 D6 形狀  ← 推薦
B: 用 MCP 真瀏覽器人工跑一次並存成腳本(證據是真的,但不進 CI、突變驗要人工重跑)
C: D1-D5 先收,D6 另立片排到基建就緒後(期間功能維持不接線、不曝光)
```
```
Q3: 多分頁重複部分取消(§6-5,換 token 送同一 payload 會真的再扣一次)
A: 誠實認列為殘餘風險、不在本線處理(現況本來如此,PRG 沒有讓它變壞)  ← 推薦
B: 本線加跨 token 的原子防線(動 RPC / DB = 範圍擴張,要另外提 plan)
   ⚠️ 這題碰錢,主視窗若判需 Sean 拍板請直接轉呈
```

## §8 關卡1 R2 對帳(FAIL · 13 must-fix + 1 nit,逐條處置)

| # | R2 finding | 處置 |
|---|---|---|
| 1 | §7 的 ✅ 灌水:1/4/6/8/10/11/13/14 其實沒閉合 | ✅ v3 §8 重寫;**其中 1(賽跑)與 6(history)降級為誠實邊界 §6-2/§6-5,不再宣稱閉合** |
| 2 | 多分頁各持 token、部分取消會成功兩次 | ✅ §6-5 認列 + §7 Q3 上呈(不再假裝帳本能擋) |
| 3 | parser 只看 `cancel_mode=full`;C1 manifest 漏 `cancel-form.ts` | ✅ 實查屬實(`cancel-form.ts:172-182`)。v3 改兩支 form 後**不需要動 parser**;現況「full 帶品項 ⇒ 拒」保留為第二道(§2-3) |
| 4 | `full_confirm`「點了才渲染」與零 client state 互斥、bfcache 連 DOM 一起復原 | ✅ §0-1 推翻、整個概念刪除;改兩支 form(§7 Q1) |
| 5 | 帳本證明不了 `r=retry/rejected/error`,舊 token + 偽造碼仍能說錯話 | ✅ §1a 把碼切兩類:B 類只有兩顆且**文案一律由 §1c classifier 產出**,URL 只決定「顯不顯示、對哪顆 token」 |
| 6 | 有效 uuid 查無有四種成因,C4 三分支不足且排在 C2 之後 | ✅ §1c **五分類窮舉**(含 unreadable / truncated+miss / complete+miss / same-actor / other-actor),併進 **D3**、排在面板 D5 之前 |
| 7 | Next 16.2.6 無 JS 路徑只送 303、忽略 replace ⇒「重播不了」非閉合 | ✅ §0-3 撤回宣稱;§1b 改「重播只會看到帳本的真話」;history 行為列 D2 實測項(§6-2) |
| 8 | C1 估 60m 違反鐵則 4;C1-C5 連續假綠中間態 | ✅ §3 重切成 **D1-D6 全部 30-45m**;接線排最後、未完成模式不曝光 |
| 9 | 完整 parser 失敗拿不到可信 orderId 決定導向 | ✅ §1b + **D2 的授權後 envelope parser**;既有 landmine 測試(授權閘第一動)不得弱化 |
| 10 | `order_cancelled` 未註冊於既有 banner;導 `/orders` 的碼沒有消費者 | ✅ 實查屬實(`result-banner.tsx:18-58`)。**D1 專片**登錄 A 類三碼 + 成功碼,並釘死與既有碼零碰撞 |
| 11 | C5 只說「要排除殘留欄」沒選機制 | ✅ 兩支 form 讓這題消失(§2-3);C5 不再存在 |
| 12 | 沒有 playwright 基建;`goBack()` 可能走網路重載仍綠 | ✅ §6-4 誠實列出實查結果;§2-3 驗收加 **`pageshow.persisted === true` 斷言**;基建路線 §7 Q2 待拍 |
| 13 | 基底 `76c27011` 過期;`cancel-section.tsx` 不存在卻寫「整支重寫」 | ✅ 檔頭改 `07dc69fc`;D4 是**新增**不是重寫(前代兩支 untracked 舊表單已 `rm`) |
| nit | request token / 授權 token 用詞混用;rollback 漏 C5 | ✅ §2-2 統一用詞;§5 rollback 列全六片 |
