# Codex Review Packet — 多品牌試點寫入 gate 群(#266/#260/#261 + V1 生命週期補強)

```
Codex Review Packet

Mode:        唯讀審查,不要修改檔案。
Repo:        /Users/sean_1/pcm-website-v2(branch dev)
Slice / 目標: 把 gbracing + bonamici 安全寫入 prod 商城 DB 並納入每日自動同步,前置補齊兩批 gate:
             批次一(已 commit 004fe49):#266 handle 正規化 / #260 描述保留現值分批 upsert / #261 分類 null 硬 gate。
             批次二(本 packet 主體、staged):V1 生命週期補強 —— 修 2026-07-05 雙跨模型審查
             (fable adversarial + codex CLI round1)全交集 must-fix:
             ① 變體級對賬(孤兒=群在、變體 sku 從來源消失 → 殘留可下單凍結舊價;
                差集偵測+dry-run 報告+安全閘〔源空硬 abort/>10% abort/--allow-large-delist 顯式放行〕+
                寫入模式硬刪〔order_items.variant_id FK ON DELETE SET NULL、歷史不破〕;
                刪除序=products upsert 後、variants upsert 前;spec 模擬排除已排刪孤兒〔F3 防同步永久卡死〕)
             ② 每日排程 rpm-sync.yml 改多供應商 matrix [rpm, gbracing, bonamici]
                (fail-fast:false 跨家不耦合、max-parallel:1 序列寫)
             ③ cncracing writeAllowed=false runtime 硬擋(「僅乾跑」不再只是註解)
             ④ stale 註解修正 + 測試 2 檔 12 測 + 審查報告落檔
內容分級:    L1(管線行為;商品內容本身由報價單庫治理)
重大改動判定: 是(鐵則 8:跨 3+ 檔 + 動 CI workflow;鐵則 12:動 order/pricing 鄰接的寫入管線)。
             處置:workflow matrix 推上 origin 前不生效 = Sean push 即批准;晨間簡報含完整 plan。
目前狀態:    branch dev / origin/dev=ed1409b(已推)/ 本 slice staged 未 commit
Changed files(staged、11 檔 +444/−38):
  scripts/rpm-reconcile.ts        — V1 變體級對賬:classifyVariantOrphans(純)/computeVariantOrphans/applyVariantDelete/報告
  scripts/rpm-delta.ts            — simulateSpecCollisions 抽純函數 + deletedSkus 排除(F3)
  scripts/rpm-import.ts           — writeAllowed 最早硬擋 + 孤兒 gate 編排 + 寫入序(products→刪孤兒→variants)
  scripts/supplier-config.ts      — writeAllowed 欄(rpm/gb/bo=true、cnc=false)
  scripts/rpm-preflight.ts        — stale 註解修正(#261 已落地)
  scripts/rpm-transform.ts        — stale 註解修正(#260 已修)
  scripts/rpm-reconcile.test.ts   — 新:孤兒分類 7 測(差集/scope/首載免疫/源空 abort/比例閘/bypass)
  scripts/rpm-delta.test.ts       — 新:spec 模擬 5 測(C3 撞/F3 卡死/F3 修法/re-upsert/新品)
  scripts/supplier-config.test.ts — writeAllowed 斷言 4 家
  .github/workflows/rpm-sync.yml  — 多供應商 matrix
  docs/reviews/2026-07-05-multibrand-lifecycle-adversarial-audit.md — 新:雙跨模型審查報告落檔
已跑驗證:    typecheck 7/7 綠 + scripts tsc 綠 / lint 10/10 + scripts eslint 綠 / build 1/1 綠
             完整 vitest 158 檔 1729 全綠(原 156/1717、+2 檔 +12 測)
             乾跑實證(全量 dry-run × 3):
               rpm      1117 群/8983 變體、0 變價 0 新增 0 誤刪(零回歸)+ 🔴 抓到 1 真孤兒
                        YAMT07-06-G-T(prod 現存 8984 vs 來源 8983;下次寫入將刪=授權偏離、非靜默)
               gbracing 942 群/942 變體、全 gate 綠、0 孤兒(首載天然免疫)
               bonamici 1252 群/1710 變體、全 gate 綠、0 孤兒
             code-reviewer(Claude subagent)+ codex CLI round2 複審:見 STATUS/commit body(進行中→結果折入)
相關規則摘錄: 鐵則 3(前後台同步)、6(檔案上限:rpm-import 373<400 警戒帶備註)、8(重大改動先 plan
             ——workflow 推前不生效+晨間簡報=plan 呈遞)、11(三綠+字面 vs 事實)、12(本 packet)。
             Server 鐵則:經銷價 price_store 恆 null 全鏈未觸、金額整數、view 物理排除敏感欄。
             不變式 1(軟下架隔離):變體硬刪 scope supplier_slug 貫穿 + parent-in-source 差集判定。
想請 Codex 重點看:
  1. 變體硬刪安全:差集邏輯(parent 在本次 source 才判孤兒)有無誤刪路徑;安全閘 fail-closed?
  2. F3 排除:simulateSpecCollisions 排除已排刪孤兒,會否漏報「真撞」(兩新 sku 同 spec 仍須撞)?
  3. workflow matrix:per-supplier 隔離、一家 abort 不拖垮別家、secrets 零洩漏?
  4. 該補的 backlog:無交易寫入窗、合法大下架無乾淨放行路徑、告警面弱(LINE)、
     來源清空描述不傳播(#260 ②語意待 Sean)。
Claude Code 自評: 可 commit(雙審 PASS 後);--confirm-write 首寫另候 Sean 晨間拍板
             (Q1=A N°02 gate 與「直接上架」矛盾 = Sean 決策題,依其「沒有決策問題才上架」自設條件 HOLD)。
```
