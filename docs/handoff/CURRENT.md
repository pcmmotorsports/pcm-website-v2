# CURRENT HANDOFF — pcm-website-v2

> 這是下一個 Codex 或 Claude session 的唯一當次交接入口。長期規則看 `docs/ops/AI_CONTRACT.md`,專案進度以根目錄 `STATUS.md` 為準(已刷新)。
> 前次快照:`docs/handoff/2026-07-16-m4a-wallet-edit-kickoff.md`(儲值金編輯片骨架、已照做收工)。

## 交接資訊

- Updated: 2026-07-16 傍晚,Asia/Taipei
- Agent: M-4a 執行視窗(Fable);儲值金編輯片 code 收工
- Branch / HEAD: `dev`=本 commit(**壓住不推**;前序 `675b949`=origin/dev;`origin/main`=`b6c97fd` production)
- DB: migrations 檔至 `20260716210000`(**新增、未 apply=硬閘**);live 仍在 `20260716200000`

## 目前目標

**M-4a 第一期收口**。客戶線第 4 片=**儲值金編輯 ✅ code 收工**(admin_adjust_wallet owner RPC+明細頁加值/扣款表單;Sean Q1=B/Q2=A 已落實)。審鏈=關卡1 PASS→code-reviewer R1 PASS→codex 關卡2 兩輪(R1 2 findings 修畢;R2 2 findings=`E'\v'` 字面陷阱已修+D1 落 STATUS 已補;硬上限不跑 R3、v_ws 斷言入交易模擬清單 5c 由值班台覆核)。三綠+build admin+full vitest 217 檔 2322 綠。

## 🔴 下一個最小動作(部署硬閘、順序不可換)

1. **Sean 拍 STATUS 待決策①D1**(double-submit 防護層級;推薦 A)+②D2(上界;可同拍)。
2. D1 拍後 Sean `db push 20260716210000`(若 D2=B 先改 migration 一行)。
3. 值班台驗:函式在/ACL/交易模擬(migration L186 起斷言清單,含 5b Unicode 空白+5c v_ws 字面正確性=備註首尾字母 v 保留)→ PASS 才放行代推本 commit。
4. 續行:tier 編輯片(🔴 高風險件#3、先 plan 過關卡1)。
5. Sean 開站驗收(累積):①admin 客戶明細五區塊+儲值金加值/扣款實操 ②正式站 `/products` 年份卡片。

## 流程紀律(沿用)

- 寫審分離:執行視窗寫 + code-reviewer 每片 + 值班台審代推 + 鐵則 8/12 觸發 codex 第三眼。
- 執行 session 不 push;動 schema commit 壓住;dev:main 恆 Sean 明說。

## Working tree ownership(凍結、勿混入 commit)

- `.gitignore`(pre-existing modified、歷來刻意不 stage)
- untracked 凍結:`admin-orders.png`、`mobile-*.png`、`docs/handoff/2026-07-1*.md` 其餘 kickoff/report 群、`docs/reviews/2026-07-16-m4a-v-line-packet.md`、`docs/specs/2026-07-1*`、`docs/superpowers/`
- 本檔+`2026-07-16-m4a-wallet-edit-kickoff.md` 已折入本 commit(慣例)。
- 接手不得 reset/stash/刪除或混成同一 commit。

## 安全邊界

- 不讀不輸出 `.env*`、service role、TapPay/LINE secret、客戶個資實值。
- migration db push=Sean 操作;不動 production env/deploy;經銷價不進非 admin client;金額整數;車種鐵律零猜。

## 相關入口

- 本片真權威:`pcm-tools/review-inbox/m4a-wallet-edit-plan.md`+`.verdict.md`(關卡1)、done 單=`m4a-wallet-edit-done.md`
- migration:`supabase/migrations/20260716210000_m4a_admin_adjust_wallet_rpc.sql`(檔尾=值班台模擬斷言清單)
- memory `project_wallet-deposit-taiwan-legal-hold`(Q1/Q2 拍板)
- `STATUS.md`(已刷新;待決策①D1②D2)/ `docs/ops/AI_CONTRACT.md`
