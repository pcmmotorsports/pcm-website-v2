# M-4a V 線執行 session 交接(2026-07-16)

> 接班入口以 `docs/handoff/CURRENT.md` 為準;本檔=當次詳細快照。長期規則看 `docs/ops/AI_CONTRACT.md`,進度以 `STATUS.md` 為準。

## 1. 一句話現況

M-4a V 線(車款帶入鏈)本 session 把值班台佇列四片 **V-2c / V-2e / V-2d / V-3a** 全落地,**已由值班台代推 origin/dev(=`7652d1e`)**。但 Codex V 線盲審 FAIL 丟回 **6 個 must-fix(V-2h 批)**,**dev:main gate 卡在這 6 條清零前**。V-3a 金流欄的兩支 migration **尚待 Sean db push** 才真正生效。

## 2. 本 session 做完 + push 狀態

| 片 | commit | 內容 | 值班台裁決 |
|---|---|---|---|
| V-2c | `26b3d8e` | 選車 context 鏡過期修:URL `?vehicle=` 恆第一真相 | PASS、已推 |
| V-2e | `241f57b` | 購物車車款不符→紅膠囊「可能不適用」(重用 §7) | PASS、已推 |
| V-2d | `74535fe` | 手機 UX 批②③④(愛車捲條/PDP 收合/收鍵盤/16px 防縮放) | PASS、已推 |
| V-3a | `7652d1e` | order_items.vehicle_snapshot 硬閘(兩 migration + TS 全鏈) | PASS(獨立交易模擬八案)、已推 |

- **git 狀態**:本地 `dev` = origin/dev = `7652d1e`(0 ahead / 0 behind)。**沒有任何 commit 等我或執行 session 推。**
- **距 origin/main**:dev 領先 main 10 個 commit(`0011f87..7652d1e`),**未 merge**;dev:main 由 Sean 手動,gate 見 §3。

## 3. 🔴 待辦(下個執行 session,依值班台裁定優先序)

### 3.1 V-3a migration 落地(Sean 操作 + 值班台驗)— 與程式解耦、可先行
- **Sean 終端機 db push 兩支、依序**:`20260716180000`(加欄+CHECK)→ `20260716190000`(create_order 白名單重組)。指令在 V-3a done 的值班台回覆;`.env.local` 需暫移(CLI 讀檔坑,見 memory `reference_supabase-cli-reads-env-local-blocker`)。
- **值班台驗 live**:欄存在 + CHECK + 新 functiondef 含 vehicle 段 + ACL 全等。
- ⚠️ **現況安全但未生效**:程式已推 origin/dev,但 live `create_order` 仍是基底 20260630120000 版;舊 RPC 對多餘 `vehicle` 鍵是**白名單重建自動忽略=不炸、但也不存**。migration apply 前 vehicle_snapshot 恆 NULL。
- ⚠️ **本 session Supabase MCP 已斷線**,無法親查 live 是否已 apply;下個 session 需重連 MCP 才能驗 live 狀態,勿憑本檔假設「未 apply」。

### 3.2 V-2h 批 = Codex 6 must-fix(**dev:main 硬 gate**)
單=`review-inbox/m4a-codex-vline-findings.md`(值班台已 triage、逐條裁修法)。優先序:
1. **MF-1(最重)slug 碰撞誤判 ✓**:`vehicle-taxonomy.ts` uniqueId 對撞 slug 加序號(`mt-09`/`mt-09-2`),`fitment-match.ts` 重新 slugify 丟序號 → 選 `MT 09` 商品是另一台 `MT-09` → 誤判適用。**修法(值班台裁)**:checkFitment 介面改吃 `brandName/modelName` 字面,內部用 vehicle-match 既有 NFKC 精確比對,**廢 slugify 橋接**;slug 只留 URL/id。→ **動共用比對核心 = §7 不降級對抗審 + full vitest**(消費端 PFC / cartVehicleFitStatus + 測試)。
2. **MF-2** parseVehicleFromUrl 三態 absent/invalid/resolved;invalid 不讀舊鏡、顯「重新選車」。
3. **MF-3** 同頁 URL 車款變更不重判(mount-only 留舊值)→ 以 useSearchParams 衍生 key 重同步。**URL 回寫方式(replaceState vs router,有 RSC refetch 取捨)先出短 plan 送關卡1。**
4. **MF-4** 手機 sticky buybar 加購不帶車款 → 抽共用 cart line 建構函式,ProductInfo + mobile buybar 同用。⚠️ **改點在 `ProductPage.tsx:100`,而該檔剛好 = 400 行(鐵則 6 硬上限)→ 動此檔前必先拆**(值班台已同意「下次動此檔的 slice 必先拆」)。
5. **MF-5** garage 投影加 isPrimary + 自動預填(只補未填、不覆蓋 search 帶入;search > 唯一台/primary)。
6. **MF-6** CheckoutStep3 逐品項顯 `item.vehicle`(重用 formatCartVehicle、display-only)。
- nit-7(matchFitmentYear「byte 等價」措辭更正)/ nit-8(ARIA combobox 模型)/ nit-9(packet 快照重產)併本批。

### 3.3 之後(佇列不變)
- **V-2f** 會員頁溢出 + 全站 RWD 掃修 → **V-2g** 大圖雙指縮放(單=`review-inbox/m4a-v2f-*` / `m4a-v2g-*`)。
- **V-3b** admin 列表車款欄(吃 V-3a 落欄後、display-only 例行審)。

## 4. 流程與紀律(接班務必遵守)

- **執行 session 不 push**。值班台(Fable, review-inbox 15s 輪詢)審 done 單後代推 origin/dev。
- 完工 commit 後寫 done 報告丟 `review-inbox/m4a-<slice>-done.md`。
- **dev:main gate**:6 must-fix 清零 + 值班台重驗 +(必要時 codex round2)才由 Sean 手動 FF;現 FF 會連帶推別 session 混批(見 STATUS Blocker)。
- 每片走 9 步 SOP:三綠 + code-reviewer(一輪制)+ manifest sync + STATUS 7 欄同 commit。
- 動 checkFitment / matchFitmentYear 等共用 → **full vitest**(memory `feedback_run-full-vitest-after-shared-component-change`)。
- MF-1 是資料正確性對抗驗證(車款誤判)→ **不降級審**。

## 5. Working tree 殘檔(凍結、非本 session 產物)

`.gitignore`(pre-existing modified、歷來刻意不 stage)+ 多個 untracked `docs/handoff/*.md` 與 `*.png`。**全程未納入任何 commit**,維持原樣、勿清。

## 6. 地圖 / 未動項

- **graphify 未刷**:V 線施工中(V-2h 未清、dev:main 未解)= 非 milestone 收尾,依 07-10 拍板「milestone/每日收工一次」故跳過。需要可主動要求刷。
- 真權威 spec:`docs/specs/2026-07-15-order-item-vehicle-capture-design.md` v0.2(§3 vehicle_snapshot、§7 保守比對)。

— M-4a 執行 session（Claude Code）
