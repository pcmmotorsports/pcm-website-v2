# 2026-08-13 夜跑交接 — 四窗全收工、`#452` 已上正式庫

> 主視窗十四代寫給**夜跑新視窗(含新主視窗)**。Sean 2026-08-13 深夜決定全部換新視窗。
> **這是唯一入口**;各窗自己的交接信在 `~/pcm-mailbox/`(檔名見各節)。

---

## §0 開工前三分鐘先確認

```bash
cd /Users/sean_1/pcm-website-v2 && git branch --show-current && git log --oneline -6 && git status --porcelain
```
預期:branch=`dev`、最新一顆是 STATUS/backlog 那顆、工作區乾淨。
`git log origin/dev..HEAD | wc -l` ≈ **28**(全部未 push,**等 Sean 手動推**)。

🔴 **不要自己 push。** 那是 Sean 的 review checkpoint。

---

## §1 四條線的狀態(全部已 merge 入 dev)

| 線 | 產出 | merge commit | 狀態 |
|---|---|---|---|
| **B** `#376` 撞號重編號 | `#308`/`#342`/`#343` 三組各改一條(→`#453`/`#454`/`#455`)、18 處行級改號、`#456` 立案 | `2f91a7b3` | ✅ 收工,worktree `/Users/sean_1/pcm-backlog-renumber` 可回收 |
| **S** OD 詳情線四片 | 備註搬家+三類分色+收合 / 客人 id 資料線 / 取數抽共用 / **面板客人卡入口** | `9fec15ce` | ✅ 收工,交接信 `S-213-STOP.md` |
| **D** `#452` 採購作廢 | 片 2a-1 schema + 兩處守門述詞 + harness + 回退 runbook | 已 merge,台帳 `6bcba338` | ✅ **已 apply 正式庫**,交接信 `D-704`~`D-705-STOP.md` |
| **E** 訂單列表 | L2 雙 markup 收斂 / L0 `shipped_quantity` 進投影 | `6f371758` | ⚠️ **L1 `f745e04e` 停在 branch 上未 merge**,交接信 `E-381-HANDOFF.md`(85 行,**必讀**) |

### E 線唯一的未 merge 顆
`f745e04e`(L1 狀態八值純函式,兩個新檔、零既有檔改動、零 UI)在 worktree
`/Users/sean_1/pcm-od-list`、branch `od-order-list`,**已 rebase 到 `6f371758` 之上、三綠在新 base 重跑過**。
⇒ 新視窗可直接 merge,或先做 L3 再一起。

---

## §2 `#452` 已上正式庫 — 下一片開工前必讀

**apply 於 2026-08-13 深夜**(Sean 當面按)。sha256 `6781c355…` 已登 `APPLIED.tsv`。

- **現況**:`order_item_procurement` 有 `voided_at` / `void_reason` 兩欄(**全表為 NULL**)、
  業務鍵已從表約束換成**同名 partial unique index**、A2b1 與 A4a 兩處 `sum(allocated_quantity)`
  各加 `AND voided_at IS NULL`(**恆真**,因為沒有 writer)。
- 🔴 **2a-2(void/unvoid RPC)開工前必須先解的 must-fix**(D 窗自己抓、R2 逐字核過):
  A2b1 的早退條件是 `NEW.allocated_quantity <= OLD.allocated_quantity`,而作廢/取消作廢**不動 alloc**
  ⇒ **守門根本不跑**。情境:A 家 3 件作廢 → B 家補 3 件(合法)→ **unvoid A 家** ⇒ 有效額度 6 件而品項只有 3 件。
  ⚠️ **`void` 與 `unvoid` 兩支都不能依賴 A2b1**(R2 補的第三面,原本只想到 unvoid)。
- **回退**:`docs/runbooks/2026-08-13-452-procurement-void-rollback.md` + `scripts/452-down.sql`
  (**已負向演練**:先刪欄再還原函式會炸 `column p.voided_at does not exist`)。
  🔴 **順序承重:先還原兩支函式,才可以刪欄。**
- **尚未做**:W7 收據重跑(本片落檔使 `TS_NOW` 前移 ⇒ `scripts/w7-coverage.sh` 的收據 `ts` 過期)。
  ⚠️ 那不是故障,是**設計好的過期偵測**;重跑指令 `bash scripts/w7-coverage.sh record all`
  (該腳本 `:364` 逐字「**慢,apply preflight 的本分**」)。

---

## §3 各窗「只在對話裡、沒落檔」的判斷 — **全部在信箱**

🔴 **這是本次交接最容易漏的部分。** 各窗自己盤出來的:

- **E 窗:`E-381-HANDOFF.md` §4 十條**(含 L2 視覺代價 +10.4% 與 §0-B 拍板衝突 / `#466` 熱區做法 /
  `#470` 突變靶缺口 / **一次 `vitest` exit 1 未查明**)
- **D 窗:`D-705-STOP.md`**(含 `COMMIT` 窗口的處置、三句話的界、CS-5 誤引留成警告)
- **S 窗:`S-213-STOP.md`**(含 `#469` 判不修的三條理由、真瀏覽器量不到的那一面)

**沒落檔的等於不存在;落了檔但沒人知道在哪,實務上一樣。** ⇒ 上面三個檔名就是索引。

---

## §4 新增的 backlog:`#457`–`#470` 十四條(已落檔,零撞號實測)

下一個可用號 = **`#471`**。發號前實查:
```bash
grep -oE '^### #[0-9]+[a-z]*\.' docs/phase-1-backlog.md | sed -E 's/### #([0-9]+)([a-z]*)\./\1 \2/' | sort -k1,1n | tail -3
```
⚠️ **不要用 `sort -t'#' -k2 -n`** —— 那條在 macOS BSD sort 上是壞的(實跑吐 `#95-#99`)。

其中 **`#466` 已完成**(觸控熱區),其餘十三條未開工。
🔴 **`#461` 守的是錢**(`sweep-settlements` 的 reason 碼守門沒有數量保證,現況是「今天剛好對」不是「被守住」)。

---

## §5 今天定下來的紀律(對夜跑直接有用)

1. 🔴 **子窗有一條主視窗攔不住的直達通道** —— 每個窗都是獨立 session、Sean 就是它的使用者,
   它的回覆**直接顯示在他眼前**。⇒ **凡是會顯示出來的因果句/判定句/數字,出處自己標**
   (「這是我推的」/「這是審查抓的」/「這是我量的、未經第二人驗」)。
2. **`【可逐字轉】` 四段式**:內容 + 出處與強度 + **使用條件** + 責任歸屬。
   主視窗看到就整段複製、不重寫(**改寫成更好懂**那一步今天出錯兩次)。
3. **衝突時以誰為準**:事實層(數字/指令/`檔案:行號`/有沒有被驗過)**以現場的窗為準**;
   判斷層(要不要現在講/多重要/排哪個停點)**以主視窗為準**。
4. **主視窗收到任何 STOP/完工回報,回信必含「下一步做什麼」或「停著等什麼」二選一。**
   沒有這句 = 回覆不算完成,窗可以直接回一句「下一步?」催。
5. **窗:超過 40 分鐘沒對外訊息就發一句進度**(不等做完)。
   **主視窗:每次要回覆 Sean 前掃一次信箱 mtime,超過 30 分沒動靜的窗主動敲。**
   🔴 兩條是**冗餘不是重複**,而且**承重的是主視窗那條**(死掉的窗發不出進度)——
   **別讓「兩條都有了」變成兩邊都鬆手。**
6. **落 STOP 之後到收到裁決之前,被審檔案一個字都不動**(今天踩過:審查中改檔 ⇒
   零留痕檢查誤判成審查器留痕 + findings 行號對不上)。

---

## §6 今天四窗共通的病(新視窗第一天就會遇到)

1. **「補了守門」≠「那件事被守住」** —— 今天四次:S 窗兩條斷言實測是 no-op、
   主視窗給的修法理由實測是 no-op、E 窗新加的 4 格守門對兩種真實破壞全綠。
   ⇒ **加完守門用突變證明它會紅**,而且**先確認突變真的落在目標行**。
2. **fixture / 前提沒構造對,格子照樣印通過** —— 四次:兩欄設成相等、stub 表本來就有那個欄、
   `walletEntries` 設空陣列(整段路徑不渲染)、突變指令沒加 `/g` 只改到第一處。
3. **改了一處,舊字面留著** —— 五次,最毒的一次在 migration 檔頭給 Sean 的那三句話裡
   (舊句「它**只是**…**兩個**新欄位」抵銷了剛補上的「三件事」= **框架過期比資訊過期更毒**)。
4. **假的「做不到 / 構造不出來」** —— 主視窗一次(「RPC 拿不到 TapPay Record」,
   證的是「RPC 自己打不了 HTTP」)、E 窗一次(「構造不出巢狀內嵌」,實際該表有兩條 FK 指向 orders)。
   🔴 **判準:證據句的主詞與結論句的主詞不一樣時,停下來。**
5. **量具讀錯值會偽裝成守門失效**(D 窗同族六次)、**turbo `FULL TURBO` 可能是別的 worktree 跑的**
   (主視窗一次)⇒ 合併/收帳後的三綠**直接跑工具繞開 turbo**,或至少讀 log 確認執行路徑。

---

## §7 環境與工具現況

- **新 hook**(2026-08-13 加):`~/.claude/hooks/block-git-add-all.js` 擋 `git add -A` / `git add .`
  (16 格正負測全綠;含 `git -C <path> add -A` 這個變體)。⇒ **一律具名 add。**
- **信箱** `~/pcm-mailbox/`;位址檔 `.main-socket` / `.e-socket` … **每次重開都會過期**
  (pid 會換、sessionId 不換)⇒ 反查法:`grep -l "<sessionId>" ~/.claude/sessions/*.json`。
- **worktree**:`pcm-od-list`(E,有未 merge 的 L1)/ `pcm-od-detail`(S,已 merge 可回收)/
  `pcm-procure-undo`(D,已 merge 可回收)/ `pcm-backlog-renumber`(B,已 merge 可回收)。
- **codex**:`codex exec -m gpt-5.6-sol -s read-only "$(cat prompt.txt)" < /dev/null > out.txt 2>&1`
  ⚠️ **`< /dev/null` 不可省**(省了會睡死,而且外觀與「正在深度思考」相同)。

---

## §8 給新主視窗的一句

今天四個窗**每一個都至少一次自己回頭抓到自己的錯**,而主視窗自己的七個錯**全部由外部抓到、零次自己回頭發現** ——
差別不是能力,是**有沒有一個固定的回頭時機**(E 窗的是「commit body 定稿前把每個字面值重量一次」)。

⇒ **建議新主視窗立一條自己的**:**送出裁決信 / 寫進 plan / 寫進 STATUS 之前,字面值重量一次。**
