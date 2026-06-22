# SESSION HANDOFF — 2026-06-22 M-3 3DS 放棄交易「放行重買」方向探索 → 卡 TapPay 確認

> 一句話結果:Sean 拍板「乙」方向(客人關閉 3D 頁放棄 → **馬上放行重買**,而非現行「卡住顯處理中」)。但 **codex K1 對抗審查跑 2 輪皆 FAIL** —— 所有「放行」設計(盲放 / 取消訊號放 / 計時放)撞**同一面牆**:repo 正確把放棄的 3DS 視為「可能稍後 late-success(被扣款)」的非終態,太早 markFailed/放行 = 雙扣或幽靈扣款風險。**整個功能 BLOCKED 在一個 TapPay 書面確認上**(放棄/取消的 3DS 之後還能不能被扣?)。給 TapPay 的 4 題信已寫好(見 §4),Sean 寄出拿到回覆才解鎖。
> 環境:PCM 主 repo `/Users/sean_1/pcm-website-v2` · dev · 本 session = **審查方(寫審分離 ROLE=A、唯讀)**。
> **本次無 commit、無 push、無 DB、無部署足跡。** 產物只有 1 份未 commit 的設計 doc + 記憶 + 本 handoff。
> 接手先讀:① 本檔 ② `docs/specs/2026-06-22-m3-3ds-abandoned-reorder-refund-design.md`(§6 codex r1 / §7 修正版 / §8 r2 結論 + §8.1 TapPay 信) ③ 記憶 `project_m3-3ds-abandoned-reorder-refund-direction`。

## 1. 起因(這趟怎麼來的)

審查 session 陪 Sean 跑 sandbox 3DS E2E 時挖出真問題:
- 客人開啟 3D 驗證頁 → **中途關掉 / 不輸 OTP / 放著** → 訂單卡在「處理中」。
- dedup(`cart_session_id`)**無 TTL**,同一個 cart 永久被擋 → 客人**無法重買**,前端一直跳「付款中」。
- 孤兒未付訂單在會員列表累積。

Sean 要的體驗:**客人放棄後,購物車還在,點重新付款就能馬上再刷一次成功**,不要卡住。

## 2. Sean 拍板方向 =「乙」+ 地基事實

**「乙」:** 讓客人**馬上重買、不卡住** + 放行前打 TapPay 查「舊的付了沒」(付了→擋並顯既有單;沒付→放行)+ **極少數撞重複 → 後台退款**。退款/取消訂單**放後台做**(後台尚未開工、可後補;網站未上線、退款不急)。

**TapPay 事實(Sean 親自確認、業主經驗):**
- 客人**沒完成 3D 驗證 = 銀行不授權 = 完全不扣款**(放棄的 3DS 是空殼)。← 這是「乙」自認安全的地基。
- 退款**當下能取消授權**,但客人**卡片約一週**才看到(銀行作業)。

**Sean 最新補充想法(待驗證):** 改成「**視窗移轉**(非開新視窗)做 3D;客人取消 → 跳回購物車頁」,Sean 直覺這樣**保證不重複扣款**、很多廠商這樣做。← 這個直覺正是 §3 待 codex 第 5 點攻擊的核心假設。

## 3. 為什麼卡住 —— codex K1 兩輪 FAIL 的那面牆

設計 doc 演進:§1 盲放 pending → §7 修正版(取消訊號 → 查 Record → 確認 not-charged 才 markFailed 放行)。

**codex K1 round-1 FAIL**(5 must-fix)→ 折入改成 §7 → **round-2 仍 FAIL**。兩輪撞**同一面牆**:

> **「客人放棄/按取消的 3DS,之後還能不能 late-success(被授權扣款)?」這件事,從 server 端分不出來。**
> - repo 正確把 `record_status=4 PENDING` 當**非終態**(可能稍後變 0 AUTH / 1 OK)。
> - 「客人按取消」這個前端訊號,**不足以推翻** late-success 的可能性(取消的同一瞬間其實剛完成 OTP、Record 還沒反映 → 查到 not-charged → 若據此 markFailed → 之後真的扣了 → 訂單已 failed = **幽靈扣款 / 重刷雙扣**)。
> - markFailed=4 還會**切斷 webhook 對帳**(notify route 用 active attempt 存在當閘,attempt 轉 failed → 退出 active 集 → 後到的成功通知被當孤兒 drop)。

codex r2 逐字結論:「**取消訊號不足以推翻 late-success 保守;`record_status=4` 不應 markFailed,除非 TapPay 證明它在該情境下是終態。**」

**這不是設計沒做好,是一個我們還沒問到 TapPay 的事實。每個「放行」設計都會撞它 → 停止迭代放行設計。**

被否決的旁支(別重提):Gemini「15 分鐘 TTL 自動放行」(15 分是猜的、無文件、等同已暫停的 S4 縮窗、開雙扣縫);E1「付款後才建單」(破壞 WAL/鎖/對帳錨)。

## 4. 唯一解鎖 = 給 TapPay 的 4 題信(Sean 寄出)

```
主旨:Pay by Prime 3D 驗證未完成交易的後續狀態詢問

您好,我們使用 Pay by Prime + three_domain_secure=true(3D 驗證)。
想確認以下幾點,以正確處理客人中途放棄的情況:

1. 客人取得 payment_url、被導到 3D 驗證頁後,若「未完成驗證」
  (關閉頁面 / 點取消 / 放著不管),這筆交易之後「還有沒有可能」
   被授權或扣款?(例如客人稍後回到該頁完成 OTP)
   還是一旦放棄/關閉就「永久作廢、不可能再扣款」?

2. 若會作廢:大約多久後作廢(timeout)?這段期間用 Record API
   查到的 record_status 是多少?作廢後會變成什麼(例如 5 CANCEL)?

3. 商家端有沒有 API 可以「主動讓這筆未完成的交易作廢」
  (讓它確定不可能再被扣款)?

4. record_status=4(PENDING)的交易,是否可能稍後變成
   0(AUTH)或 1(OK)?在什麼情況下會?

謝謝!
```

**TapPay 回覆後兩條岔路:**
- 答「放棄/取消後**永久作廢、不可能再扣**」(或提供 §第 3 題的主動作廢 API)→ **§7「取消 → 查 Record → markFailed → 放行」成立**,客人取消就能乾淨重刷。此時走正規 plan → codex K1 → 執行 → 審查。
- 答「**還可能稍後扣款**」或不確認 → **維持現在保守 hold(安全)** + 後台退款收尾。放行重買功能不做或大幅縮限。

## 5. 可獨立先做的安全快贏(不卡 TapPay)

**§3 = 會員列表藏 unpaid 孤兒訂單 + `create_order` reuse(同 cart 重試不堆新孤兒)** —— **codex 確認與那面牆無關、安全**,可獨立先做。
- 解決「訂單卡一堆空單」的視覺問題。
- 動到 `create_order` RPC / migration → 屬鐵則 8/12,走正規流程:plan → codex K1 → 執行 session(worktree 寫審分離)→ 審查 → Sean merge。
- 與「放行重買」解耦:先做這個,客人體驗先改善一半(至少列表乾淨、不堆單),放行那半等 TapPay。

## 6. 後台 backlog(後台開工後)

- **退款 / 取消訂單 admin 工具**:`TapPayChargeAdapter.refund()` 目前是 stub(`throw '未實作(Phase 2)'`,L211-214)。「乙」的「極少數重複 → 後台退款」靠它。後台尚未開始 → 計畫書放後台製作那邊。
- 疑似重複單 → 人工確認後退款(Sean 要放後台、非自動)。

## 7. 檔案 / 狀態足跡

| 產物 | 狀態 |
|---|---|
| `docs/specs/2026-06-22-m3-3ds-abandoned-reorder-refund-design.md` | **未 commit**(審查 session 不 commit;Sean 決定要不要入 git) |
| 記憶 `project_m3-3ds-abandoned-reorder-refund-direction.md` | 已更新(乙方向 + TapPay 事實 + codex r1/r2 FAIL + gating fact + §3 可獨立) |
| 本 handoff | 新增、未 commit |
| code / DB / 部署 | **零改動**(純探索 + 唯讀審查) |

**HEAD=dev=origin/dev=`046f34e`(前一條 3DS-7 收尾 handoff 的終態)、tree 僅多上述未追蹤 .md。**

## 8. 下一步(接手 / Sean)

1. **Sean**:把 §4 的信寄給 TapPay 客服/業務,拿回覆。
2. **拿到回覆後**:依 §4 兩條岔路決定「放行重買」做不做、怎麼做;重開 session 把 TapPay 答案補進設計 doc §8,再走正規 plan。
3. **不卡 TapPay 可平行先做**:§3(藏孤兒單 + create_order reuse)走正規 plan → codex → 執行 → 審查。
4. **後台開工後**:退款 admin 工具(§6)。

**現狀「卡住顯處理中」是安全的、prod 結帳仍 flag-gated 零真流量,不急。球在 TapPay 那邊。**

— END —
