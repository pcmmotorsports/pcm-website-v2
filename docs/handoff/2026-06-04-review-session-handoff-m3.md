# 交接:審查 session 換手 → 下一棒 M-3 結帳(2026-06-04)

> 本檔給下一個 session 起手用。上一棒(本審查 session、寫審分離 ROLE=A)做完賣場內容 v2 PRD 審查線 + LINE CTA/Header 真機 fix 兩審 + 設計 doc/backlog 對齊 v2 + 跨側協調結案。
> **本 session 哨兵(Monitor `b0avhjlft`)已 TaskStop;下一棒若續審必重 arm(見 §5)。**

---

## 0. 起手綠的定義

```
git branch --show-current        # = dev
git rev-parse --short HEAD dev
git status --porcelain           # 工作樹乾淨
git rev-list --left-right --count origin/dev...dev
```
預期(交接時):**dev 領先 origin/dev 12 個未推 commit**(本輪 + LINE CTA/Header 等並行線、Sean 暫不推)、工作樹乾淨。這是 Sean 手動推 checkpoint 的常態,不是不綠。

---

## 1. 並行 session 地圖 + 現況

- **本審查 session**(收尾):賣場 v2 PRD 審查 + 網站側對齊 docs + LINE CTA/Header fix 審。commit:`7b51234`/`da321b6`/`bac3270`/`18bd8c6`(content-model + reviews)+ STATUS/handoff。
- **報價單 session**(已結案、不在本 repo):v2 PRD pipeline 規劃完成、已 push quote repo main(`37e4db5`/`c751ba3`/`304975b`)。網站側對應工作記 backlog #212,等執行 session 動 P0/P7。
- **執行/設計線**(Sean 主導):LINE CTA(`ce36e50`+`4988438`)、Header SSR fix(`7bdbdd4`)、多品牌範本 doc(`beee50d`)皆在 dev、皆審 PASS。

**守則**:主樹 `/Users/sean_1/pcm-website-v2` 多方並行 → commit 一律精準 pathspec、別 `git add .`/`-A`、commit 後 `git status --porcelain` 驗(對齊 memory `feedback_concurrent-session-git-index-contamination`)。

---

## 2. 本輪已完成 + 已審(PASS)

- **賣場內容 v2 PRD 對抗審查**(workflow `w7jl8441m`、35 agents):30 findings、**0 blocker**、1 refuted。記錄 `docs/reviews/2026-06-04-v2prd-website-review.md`。
- **網站側對齊 PRD v2**:設計 doc `docs/specs/2026-06-03-storefront-content-model-design.md` 加 superseded banner + 標題改三叉 deterministic(取代「標題主車型」、Sean 拍 A);backlog **#209** 權威指針 B→v2;新增 **#212**(跨庫消費鏈 5 斷點 + 去 RPM 化前置 + contract-drift + ② 下架權威 + reconcile 缺席判定 nuance)。
- **跨側三項協調結案**:① description 同步「之後再推翻」② 下架權威=來源側單一裁判(view 投影 delisted_at、網站鏡射)③ 標題後門已修。
- **LINE CTA**:`ce36e50` 初版(懸浮 CTA、deep link 預填、車種鐵律零車款字串)+ `4988438` 真機 fix(window.open→原生 `<a>` 修 popup 擋、`@`→`%40` encode、小圓鈕避 buybar)→ 兩審 PASS、車種鐵律零退化。
- **Header SSR UA fix `7bdbdd4`**:修 iPhone 卡桌機 header(layout server UA 經 MobileContext 下傳、hydration-safe)→ 審 PASS(獨立重驗、concur `0801eb9`)。
- **多品牌範本 doc `beee50d`**:N°02 各別客製方向 C、車種鐵律有帶、與 #212/#209 不撞車 → 順掃 PASS。
- 末次 fresh 三綠基線:**typecheck 7/7 + lint 10/10 + build 1/1 + vitest 82 檔 553 測全綠**。

---

## 3. 🎯 下一個正式待審 = M-3 結帳 / 訂單 / 金流

**現況**:M-3 = 0 進度。站內**無法成交**——無 `/checkout` route、購物車只存 localStorage、「立即購買」不導結帳、無 orders 表。內容/CTA 做再好,站內成交 = 0(LINE 詢價 `ce36e50` 是現況唯一真實成交管道)。

**會觸發的鐵則(審查重點)**:
- **鐵則 8**(schema/API):會建 `orders`/`order_items` 表 + `/checkout` route + 結帳 API → 動手前必先 plan 等 Sean 批。
- **鐵則 12**(紅線):order/payment/pricing/金額——金額用整數或 Decimal 禁 number 浮點;經銷價絕不傳一般會員瀏覽器;server 端重新驗會員 tier 不信 client。
- **鐵則 12 → 必跑 codex K2**(若 OpenAI quota 恢復〔約 7/2〕或 Sean 貼 web Codex;quota 未回走 Claude fresh-context fallback 對抗審 2 輪,如 S5)。

**審查姿態**:fresh-context 重驗、不信報告字面;親跑三綠(動金額路徑跑完整 vitest);逐條核字面 vs 事實;manifest 同步;鐵則 12 經銷價洩漏雙 grep(static + live rendered-HTML,如 16c-4c)。

---

## 4. 其他 in-flight / parked

- **賣場內容 pipeline(P2)**:報價單側已產 v2 PRD + 合約 + roadmap。施工序 P0 砍鎖修 + P7 下架(一體先行)→ P1 schema → P2 範本引擎 → pilot(RPM+一個無原文家)→ 放量。網站側工作見 **#212**(跨庫 5 斷點 / 去 RPM 化 / contract-drift),綁報價單 pipeline P1/P5 落地後啟動。記憶 `project_storefront-content-model-design`(已更新 v2)。
- **OD 商品頁改造線**:見 STATUS 附屬區 + memory `project_od-redesign-phase-a-done-od12-fitments-deferred`(OD-12d/OD-13 已做、od-redesign 領先 dev、待 Sean 真機驗+merge)。
- **真機驗教訓**:memory `reference_pcm-mobile-device-verify-dev-vs-prod`——真機驗「互動」必用 production build(dev bundle 真機 hydration 慢到卡死 onClick);**測試綠 ≠ 真機過**(LINE CTA/Header 兩 bug 都測試全綠卻真機 fail)。
- backlog:#202 wallet HOLD(台灣儲值法規)、#210 <5% 靜默截斷、#211 fitments 字串正規化、#209/#212 賣場內容。

---

## 5. 哨兵 arm(下一棒若續審必做)

baseline = 起手 `git rev-parse --short dev`。Monitor persistent 盯**全本地 heads**(`for-each-ref refs/heads/`、grep 新行)——dev + 任何新 worktree 分支都涵蓋。每新 commit fresh-context `git show` 審不可變快照、findings 寫對應 review-log、只 FAIL 才 `PushNotification`。法見 memory `reference_sentinel-auto-review-pipeline`。**本 session 哨兵 `b0avhjlft` 已 TaskStop、務必重 arm。**

命令(沿用本輪、全 heads 掃描版):
```
R=/Users/sean_1/pcm-website-v2
snap() { git -C "$R" for-each-ref --format='%(refname:short)=%(objectname:short)' refs/heads/ | sort; }
prev=$(snap); echo "SENTINEL_ARMED heads: $(printf '%s' "$prev" | tr '\n' ' ')"
while true; do sleep 20; cur=$(snap) || continue
  if [ "$cur" != "$prev" ]; then printf '%s\n' "$cur" | grep -vxF "$prev" | while IFS= read -r l; do
    [ -n "$l" ] && echo "NEW_COMMIT $l :: $(git -C "$R" log -1 --format='%s' "${l#*=}" 2>/dev/null)"; done; prev="$cur"; fi; done
```

---

## 6. push 狀態

dev 領先 origin/dev 12 個、**全未 push**(Sean 暫不上線/手動推 = review checkpoint)。下一棒**不代推**、不主動 offer push(memory `feedback_push-is-sean-manual-do-not-offer`)。

---

## 7. 關鍵文件 + 記憶

- v2 PRD 審查記錄:`docs/reviews/2026-06-04-v2prd-website-review.md`
- 設計 doc(已 superseded):`docs/specs/2026-06-03-storefront-content-model-design.md`
- 多品牌範本 doc:`docs/specs/2026-06-04-product-page-template-design.md`
- backlog:`docs/phase-1-backlog.md`(#209/#212)
- 報價單 PRD v2(他 repo):`/Users/sean_1/API大量上架/PCM報價單-V2/docs/PRD-storefront-content-pipeline-v2-2026-06-04.md`
- 記憶:`project_storefront-content-model-design`(v2 已更新)、`project_product-page-template-multibrand`、`reference_pcm-mobile-device-verify-dev-vs-prod`、`reference_sentinel-auto-review-pipeline`、`feedback_execution-review-session-split`、`feedback_concurrent-session-git-index-contamination`、`feedback_push-is-sean-manual-do-not-offer`。

— END —
