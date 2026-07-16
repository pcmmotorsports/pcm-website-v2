# CURRENT HANDOFF — pcm-website-v2

> 這是下一個 Codex 或 Claude session 的唯一當次交接入口。長期規則看 `docs/ops/AI_CONTRACT.md`，專案進度仍以根目錄 `STATUS.md` 為準。
> 當次詳細快照：`docs/handoff/2026-07-16-m4a-vline-session-handoff.md`。

## 交接資訊

- Updated: 2026-07-16，Asia/Taipei
- Agent: Claude Code（M-4a V 線執行 session、Opus）
- Mode: 執行模式，值班台（Fable, review-inbox）代推 + 對抗審查在線
- Branch / HEAD: `dev` / 本 commit（V-2h/MF-1）；起點 `7652d1e`
- Remote: 本 commit 壓住不推，等值班台審 done 單代推
- dev vs origin/main: 領先 origin/main（`57ee31a`）；**dev:main gate = V-2h 6 must-fix 清零 + Sean 明說,你不碰 dev:main**

## 目前目標

M-4a V 線（車款帶入鏈）。本 session 收完值班台佇列四片 V-2c/V-2e/V-2d/V-3a，全 PASS 已推 origin/dev。續行 = V-2h（Codex 6 must-fix）→ V-2f/V-2g → V-3b。

## 已確認事實

- 四片已推 origin/dev：`26b3d8e`(V-2c) / `241f57b`(V-2e) / `74535fe`(V-2d) / `7652d1e`(V-3a)，值班台逐片 PASS（V-3a 過獨立 prod 交易模擬八案）。
- Codex V 線盲審 FAIL → **6 must-fix（V-2h 批）**，單在 `review-inbox/m4a-codex-vline-findings.md`（值班台已 triage 逐條裁修法）。
- V-3a 兩支 migration（`20260716180000`、`20260716190000`）**已由 Sean db push 上 prod、值班台雙驗完成**；origin/dev=`7652d1e` 含 V-3a code=功能已活，不需任何 db 動作。
- **V-2h/MF-1 已完工（本 commit）**：`checkFitment` 改吃名稱字面 + NFKC 精確比對、廢 slugify 橋接（消 slug 碰撞假 ✓）；三綠 + full vitest 213 檔 2263 綠（+4 碰撞/NFKC 對抗樣本）+ code-reviewer R1 PASS。續行 = MF-2…MF-6 + nits。

## 🔴 下一個最小動作（依值班台裁定優先序）

1. **V-2h 批 = 6 must-fix（dev:main 硬 gate）**：~~MF-1 slug 碰撞誤判 ✓（改 checkFitment 吃名稱字面+NFKC）✅ 本 commit~~ → **MF-2 URL 三態**（parseVehicleFromUrl absent/invalid/resolved、invalid 不讀舊鏡顯重選）→ MF-3 同頁 URL 重判（**先短 plan 送關卡1**）→ MF-4 手機 buybar 帶車款（⚠️ `ProductPage.tsx` 已 400 行=鐵則6 硬上限,**動前必先拆**）→ MF-5 garage isPrimary 預填 → MF-6 CheckoutStep3 顯車款；nit-7/8/9 併批。
2. 全清 → 值班台重驗 +（必要時 codex round2）→ 才解 **dev:main gate**（Sean 手動 FF；現 FF 會連帶推別 session 混批,見 STATUS Blocker）。
3. 之後：V-2f 會員頁+全站 RWD → V-2g 大圖雙指縮放 → V-3b admin 列表車款欄（吃 V-3a 落欄）。

## 流程紀律

- **執行 session 不 push**；值班台審 done 單（`review-inbox/m4a-<slice>-done.md`）後代推。
- 每片 9 步 SOP：三綠 + code-reviewer（一輪制）+ manifest sync + STATUS 7 欄同 commit。
- 動 checkFitment/matchFitmentYear 共用核心 → full vitest；MF-1 屬資料正確性 → 不降級審。

## Working tree ownership（凍結、勿混入 commit）

- `.gitignore`（pre-existing modified、歷來刻意不 stage）
- untracked（凍結、勿混入 code commit）：`admin-orders.png`、`mobile-*.png`、其餘 `docs/handoff/2026-07-1*.md` kickoff/report、`docs/reviews/2026-07-16-m4a-v-line-packet.md`、`docs/specs/2026-07-1*`、`docs/superpowers/`
- 本 session 交接檔（`CURRENT.md` + `docs/handoff/2026-07-16-m4a-vline-session-handoff.md`）已依 kickoff 指示折入首個 slice commit（V-2h/MF-1）。
- 接手不得 reset/stash/刪除或混成同一 commit。

## 安全邊界

- 不讀、不輸出 `.env*`、Supabase service role、TapPay／LINE secret、客戶訂單與個資。
- 不動 production env、deploy、merge 或 push；migration db push = Sean 操作。
- 不碰 design-reference；動前台元件先 grep design 真權威字面。

## 相關入口

- `STATUS.md`
- `docs/handoff/2026-07-16-m4a-vline-session-handoff.md`（當次詳細）
- `review-inbox/m4a-codex-vline-findings.md`（V-2h 6 must-fix）
- `docs/specs/2026-07-15-order-item-vehicle-capture-design.md`（V-3/§7 真權威）
- `docs/ops/AI_CONTRACT.md`
