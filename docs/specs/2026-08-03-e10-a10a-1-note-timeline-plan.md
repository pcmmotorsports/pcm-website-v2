# A10a-1 訂單備註時間軸 — 純邏輯模組 plan(2026-08-03 凌晨夜跑)

> **片型 = 標準片 / L1**(A10a 本體是「需拍板/需肉眼」片;本子片只做**不需要 Sean 在場**的純函式半邊,
> 拆片授權 = Sean 08-03 拍板 Q1=A 三線夜跑,落檔 memory `project_m4b-night-triple-line-0803-decisions`)。
> 不命中鐵則 12(零錢/零權限/零 schema/零平台設定/零對外/未動 packages/ui);
> 不命中鐵則 8(2 個新檔 + 本 plan,零 schema/API/共用元件)。

## §1 範圍

**做**:`apps/admin/src/lib/orders/note-timeline.ts`(純函式,無 server-only、無 `@/`)+ 同名測試。
四件事:①時間軸列 view model(seq/標籤/日期顯示/更正標記)②更正鏈 walker(visited + 深度上限)
③ `customerNotified` 三態描述 ④「更正不可撤回」UI 文案常數。

**不做(白天、Sean 在場)**:頁面接線、表單、confirm 對話框、時間軸新舊排序方向(品味題)、
所有文案定稿 —— 本片文案全部標「🔴 暫定、待 Sean」,**鎖的是三態/標記的結構,不是字**。

## §2 契約(逐條對照一手來源,附 檔案:行號)

| # | 契約 | 來源 |
|---|---|---|
| C1 | 被更正的列標「已更正」、**不是不顯示** | migration `20260729030000:171-172` |
| C2 | 更正不可撤回;A←B←C 裡 C 更正 B 不會讓 A 復活;誤更正有效告知的唯一正解 = 重登一筆新 `customer_notified`,**這句要進 A10a UI 文案** | migration `:179-184`;線 plan `2026-08-02-e10-notes-line-plan.md:153-154`(~~:152-154~~ R1 nit4 更正:`:152` 是負測兩方向那條) |
| C3 | 更正鏈**可以成環**(單一多列 INSERT 於 owner 路徑實測可達)⇒ 走鏈必帶 visited + 深度上限 | migration `:186-195`(~~:185-190~~ R1 nit3 更正:結論句在 `:191`、visited 交辦在 `:195`);A9d2-1 plan §8 債7 |
| C4 | `customerNotified: boolean \| null`,`null` = 無法判定,**不得 `?? false`** | `packages/domain/src/order/types.ts:483-489`;A9d2-1 plan §8 債5 |
| C5 | 一筆最多被更正一次(partial unique)⇒ 已被更正列 disable 更正入口 | migration `:154-158`(~~:150-158~~ R1 nit5 更正:`:150-152` 是無關的 notified_idx);母 plan F6 |
| C6 | `notes` 已由 mapper 排好序(三層全序),消費端**不重排** | `types.ts:477-481`(權威實作 `mappers/order-notes.ts` `compareNotes`) |
| C7 | note_type 三值 / channel 五值;internal ⇒ channel/occurredAt 恆 null | `types.ts:394,400,414-417`;值域 CHECK `:87-88,129-130`;**配對規則權威 = `:116-127`**(R1 nit6 補:`contact_fields_required` + `internal_fields_absent`,值域 CHECK 不管配對) |
| C8 | 日期顯示慣例 = Asia/Taipei、`YYYY-MM-DD HH:mm` | 復用 `order-detail-view.ts:38-47` `formatOrderDateTime` |

## §3 設計要點(只列有理由的)

- **seq 依輸入序 1 起編**;輸入亂序就照亂序輸出(排序權威在 mapper,這裡重排 = 兩套排序漂移)。
- `corrects.targetSeq: number \| null` —— 目標被截斷掉時回 `null`,UI 顯示「不在已載入範圍」;
  反向 `correctedBySeq` 同理。🔴 `corrected` 旗標**以 domain 值為權威**、不在本模組重推導
  (mapper 已算過;重推導 = 第二真相源)。
- **walker 回 `{ chainIds, stop }`**,`stop ∈ end/missing/cycle/depth` —— 環是資料腐壞訊號,
  要**可見**(UI 才能顯示異常),不是靜默截斷。深度上限走參數(預設 200),
  理由:visited 已保證終止 ⇒ 預設值下 `depth` 分支構造不出負測,**用參數讓它可構造**
  (`feedback_unconstructible-negative-test-means-noop-guard`)。
- 日期解析失敗(DB 腐壞)⇒ **原字面返回**,不顯示 `Invalid Date`。
- 截斷文案用 `entries.length` 實數,不 import `ORDER_NOTES_EMBED_LIMIT`(截斷時載入數=上限,
  實數即上限;import 反而讓 apps/admin 綁 adapter 內部常數)。
- 時區判別力:測試檔頂 `process.env.TZ = 'UTC'`(2026-08-03 node 實測:UTC env 下
  未釘 timeZone 的輸出 `16:30` vs 釘 Asia/Taipei 的 `00:30` 分岔)⇒ G10 在本機(Taipei)也殺得掉。

## §4 驗收 = 突變 manifest(**21 格**;還原用檔案備份、不用 git checkout;R1 折入後 17→21)

| 格 | 突變 | 指定紅點 |
|---|---|---|
| G1 | seq 改 0 起編 | T-seq |
| G2 | entries 按 id **升冪**重排 | T-order(🔴 R1 MF1:原兩列反序向量對**降冪**重排零判別力 —— 降冪恰等於輸入序 ⇒ 改三列非單調 id `[mm,zz,aa]`,升降冪都 ≠ 輸入序) |
| G2b | entries 按 id **降冪**重排(MF1 的補格) | T-order(同上向量;紅點含 [G2]) |
| G3 | canCorrect 恆 true | T-canCorrect |
| G4 | corrected 改由「correctsNoteId 非 null」推導(方向混淆) | T-directions(更正者列 corrected=false、被更正列=true 同時斷言) |
| G5 | correctedBySeq 查表移除 | T-correctedBy |
| G6 | 缺目標時 targetSeq 回 0 | T-missing-target(`toBe(null)` 嚴格) |
| G7 | internal 的 channelLabel 給值 | T-internal |
| G8 | body trim | T-verbatim(前導空白 + 🏍️) |
| G9 | occurredAtDisplay 誤接 createdAt | T-fields(兩欄餵不同時刻) |
| G10 | formatter 掉 timeZone | T-tz(TZ=UTC;`…T16:30Z` → `-16 00:30`) |
| G11 | NaN 守門移除 | T-invalid-date(原字面 vs `Invalid Date`) |
| G12 | 三態 null 走 `?? false` | T-tristate(null 態 ≠ false 態) |
| G13 | truncated 不透傳 | T-truncated |
| G14 | walker 移除 visited | T-cycle(互指兩列;斷言 `stop==='cycle'`,突變後變 `depth`) |
| G15 | walker 移除深度閘 | T-depth(maxDepth=1 傳參;突變後變 `end`) |
| G16 | 標籤表兩值改相同 | T-label-unique |
| G17 | 起點不在集合回 `end` | T-start-missing(斷言 `missing`) |
| G18 | raw `noteType` 硬編碼 `'internal'`(R1 nit8 補 raw enum 透傳後的守門) | [G9] 測試的 `'contact_log'` 斷言(與 [G7] 的 `'internal'` 成對,硬編碼必死一邊) |
| G19 | raw `channel` 硬編碼 `null` | [G9] 測試的 `'phone'` 斷言(與 [G7] 的 `null` 成對) |
| G20 | `note-form.ts` 的 `NOTE_TYPES` 砍掉一值(跨檔清單漂移;突變落在 note-form.ts) | [G20] 集合相等測試(R1 nit11) |

基準線先證綠才跑突變(S3b-1 教訓);G14 的可觀察性靠「環在深度閘前被抓」⇒ 移除 visited 不會掛死、只會改 stop 值。
🔴 21/21 全紅實跑紀錄(末次 2026-08-03 01:1x,R2 折入後重跑;還原 byte-equal、末基準線復綠):
G1-G17 各紅指定格;G2b 紅 [G1]-[G6](module 層 fixture 被重排的連鎖,含指定格 [G2]);
G18/G19 紅 [G9](= plan 記載的設計位置;harness 的「指定格」heuristic 只認同名格,故印警示 —— 非假綠);
G20 紅 [G20]。🔴 G20 是**單檔量測**(R2 N2:harness 只跑本測試檔;該突變在完整套件下另會紅
note-form.test.ts 的值域測試,紅得更多、判別力不受影響)。harness 已修 R2 N1(「red 為空」原判 ok
→ 改印未擷取警示);末次全輸出存 scratchpad `a10a1-mutants-final-run.log`(session 產物、不進 repo)。
G10 的 TZ 前提已自證(測試內斷言 `resolvedOptions().timeZone === 'UTC'`,R1 nit2)。

## §5 誠實邊界

- **零呼叫端**:本片收工後員工仍看不到時間軸,27 項驗收貢獻 0(A10a 白天半片才接線)。
- 文案全部暫定;三態結構與「已更正」標記結構是本片鎖死的,字是 Sean 的。
- walker 的 `cycle` 在**應用路徑構造不出來**(A6 RPC 單列 INSERT),測試用手捏 fixture 構造 ——
  這是防「owner/superuser 手寫入」的資料腐壞,不宣稱應用層會發生。
- 排序方向(新在上/舊在上)未定,seq 與結構兩個方向都成立。
- 🔴 `truncated=true` 時 `seq` 是相對編號、會隨新備註漂移(R1 nit9)—— UI 不得當永久單號;永久識別只有 `id`。
- walker 深度閘在生產路徑**不可達**(visited + notes≤200 已擋;R1 nit7)—— 它是縱深護欄,code 註解已寫明。
- 「lint 綠」只覆蓋 source 檔:`*.test.ts` 被 root eslint config ignore(R1 nit12 實測;既有行為、非本片引入)。

## §6 審查紀錄

- 關卡1:標準片,照 SOP 跳 codex。
- 關卡2 R1(opus code-reviewer,fresh context)= **FAIL:1 must-fix + 11 nit,逐條親驗、駁回 0、已全折**。
  MF1 = G2 向量對降冪重排零判別力(兩列反序向量的降冪恰等於輸入序)⇒ 改三列非單調 + 補 G2b 格。
  nit 最值錢的三條:座標錯 4 處(:185-190/:152-154/:150-158/漏 :116-127 —— A9d2-1 同型病根再現,
  開檔重取);view model 原本丟掉 raw enum(白天篩選只能反推中文字串,零呼叫端=現在補最便宜);
  文案錨點 `toContain('恢復')` 擋不住語意反轉(改 `/不會[^。]*恢復/`)。
  另 R1 自行撤回一條 must-fix 候選:「截斷會讓 corrected 說謊」—— 經查 created_at=DB now() + DESC 載入
  ⇒ 載入集合對更正關係向上封閉,不成立。
- 關卡2 R2 確認輪(同審查者續脈絡)= **PASS:12/12 真修、假修 0**;另抓 1 個位移 + 4 條新 nit,已全清:
  🔴 位移 = 舊座標 `:185-190` 的**第 5 個出現點**(test `:218` 註解)R1 修法沒掃到 ——
  「只修碰過的行」同型復發(hook 守的是 spec/PRD,test 註解不在其射程);§6 上一條的「全部開檔重取」
  在 R2 前其實多說了一格,特此更正。N1 harness「red 為空判 ok」已修;N2 G20 單檔量測已註記;
  N3 test 檔頭 17→21 已改;N4 STATUS 7 欄同 commit 補上。
- 輪次紀律:R2 PASS(含 nit)⇒ 修完收工,不開 R3(00-work-rules §5)。
