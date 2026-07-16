# CURRENT HANDOFF — pcm-website-v2

> 這是下一個 Codex 或 Claude session 的唯一當次交接入口。長期規則看 `docs/ops/AI_CONTRACT.md`,專案進度以根目錄 `STATUS.md` 為準(已同 commit 對齊)。
> 當次快照全文:`docs/handoff/2026-07-16-m4a-wallet-close-production-push-kickoff.md`(客戶線至儲值金編輯全收工上 production;新雙視窗開工依據)。

## 交接資訊

- Updated: 2026-07-16 傍晚,Asia/Taipei
- Agent: 值班審查台(Fable);客戶線四片審畢代推+正式站 FF
- Branch / HEAD: `dev` = `origin/dev` = `origin/main`(本 commit;前一 feature=`afea2b7` 儲值金編輯)
- DB: migrations 至 `20260716210000` **全 apply**;`admin_adjust_wallet` prod 交易模擬全 PASS(26 攻擊樣本零寫入、零留痕)

## 目前目標

**M-4a 第一期收口**。客戶線:列表 ✅ → 明細-a `30659b8` ✅ → 明細-b `675b949` ✅ → 儲值金編輯 `afea2b7` ✅(硬閘全程走完、已上 production)。**剩最後一片=tier 編輯(🔴 高風險件#3)**,之後 ②Email 通知片 ③最新商品 ④小件穿插。

## 🔴 下一個最小動作

1. **執行視窗**:tier 編輯偵察 pass → plan 丟 `pcm-tools/review-inbox/`(`m4a-tier-edit-plan.md`)過關卡1 才動工;step-up 門檻在 plan 內給 Sean 拍。順手欠帳三件見快照 §3(backlog 去重條目/adapter docstring 一行/皆下一片一併)。
2. **審查視窗**:重掛雙哨兵(inbox+commit;隨 session 死必重掛),硬閘規格接 tier plan。
3. **Sean 開站驗收(累積)**:①admin 客戶明細五區塊+儲值金加值/扣款實操 ②正式站 `/products` 年份卡片。

## 流程紀律(沿用;細節+worktree 代推慣例=快照 §5)

- 寫審分離:執行視窗寫+code-reviewer 每片+值班台審代推+鐵則 8/12 觸發 codex 第三眼(每 diff 上限 2 輪)。
- 執行 session 不 push;動 schema commit 壓住等 db push+驗欄;dev:main 恆 Sean 明說;拍板即落檔+跨視窗 directive 單。

## Working tree ownership(凍結、勿混入 commit)

- `.gitignore`(pre-existing modified、歷來刻意不 stage)
- untracked 凍結:`admin-orders.png`、`mobile-*.png`、`docs/handoff/2026-07-1*.md` 其餘 kickoff/report 群、`docs/reviews/2026-07-16-m4a-v-line-packet.md`、`docs/specs/2026-07-1*`、`docs/superpowers/`
- 接手不得 reset/stash/刪除或混成同一 commit。

## 安全邊界

- 不讀不輸出 `.env*`、service role、TapPay/LINE secret、客戶個資實值。
- migration db push=Sean 操作;經銷價不進非 admin client;金額整數;車種鐵律零猜;audit 不可繞。

## 相關入口

- 當次快照:`docs/handoff/2026-07-16-m4a-wallet-close-production-push-kickoff.md`
- 儲值金編輯真權威:`pcm-tools/review-inbox/m4a-wallet-edit-plan.md`+`.verdict.md`+`m4a-wallet-edit-done.verdict.md`(最終、含 prod 模擬結果)
- memory `project_wallet-deposit-taiwan-legal-hold`(Q1/Q2/D1/D2 拍板全紀錄)
- Email plan:`docs/handoff/2026-07-13-email-notification-slice-plan.md` / tier 前置分析:`2026-07-13-issue-215-tier-server-auth-plan.md`
