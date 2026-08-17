# 推送前攻擊面掃描 —— 2026-08-17 那一輪的結果 + 可重跑工具

- **窗**:E(資安稽核,唯讀)　**日期**:2026-08-17　**基準**:`git diff origin/dev...dev`(🔴 **三個點**)
- **工具**:`scripts/pre-push-attack-surface-sweep.sh`(本輪之後做成的;`--selftest` 是它唯一的判別力)
- 🔴 **為什麼要有這件**:`dev` = `pcm-admin` 的 **production** ⇒ **推了就上線**。而「逐顆正確性」有 V 窗在做,**沒有人在問「這一整包碰到了哪些面」**。

## 問的問題只有一個

> **這一包改變了什麼安全面?**

**不是**「這顆對不對」(那是 V 窗)。

## 本輪結果(**落筆當下** 258 顆 / 160 檔;⚠️ 顆數隨 dev 前進漂移,引用要帶時點 —— reviewer 複跑時已是 259)

| 類 | 命中檔 | 本體非註解行 | 判定 |
|---|---|---|---|
| 1 auth / 權限邊界 | 7 | **0** | 🟢 **不 gate** —— 四支 `session/*.ts` **只改註解**;另 3 檔是 `.md` |
| 2 錢 | 37 | **240** | 🟡 要讀 ⇒ **已讀,見下** |
| 3 平台設定 | 1 | 3 | 🟡 `package.json` 加一條 lint-staged selftest(開發期工具) |
| 4 對外可見 | 16 | 292 | 🟡 全在**後台列印面**;寄信/法律頁/storefront API **零命中** |
| 5 新建 DB 物件 | **0** | — | 🟢 **零 migration**(兩支 `.sql` 在 `docs/specs/` 是草稿) |
| 6 祕密字面 | **0** | — | 🟢 含正向對照(餵假 JWT ⇒ 命中 1) |

### 類 2 的 240 行:兩支 adapter 的分頁,**都逐條核過五準則,全過**

`SupabaseWalletAdapter`(儲值金帳目)/ `SupabaseOrderAdapter`(列印品項):
```
頁大小 < db-max-rows（200 < 1000）✅   .range() 兩端皆含 ✅
中途失敗 throw 不 break ✅             count 不當終止判準 ✅
排序帶唯一鍵（.order('id')）✅
```
🔴 **兩支都 fail-closed,而且理由寫在 code 裡**:
- Wallet:`count === null` ⇒ throw,逐字「沒有 N 就不回傳一份看起來完整的一頁」
- Order:達 `MAX_PAGES` ⇒ throw,逐字「**不回傳部分結果 —— 部分結果會讓紙上少列品項而紙看起來完全正常**」
⇒ **正是 Sean 08-17 拍的 Q2 甲。**
🟡 **`SupabaseOrderAdapter` 這片解掉的是【列印那一條路】,不是整條 `ORDER_ITEMS_EMBED_LIMIT`**(🔴 **code-reviewer must-fix #7 更正我原本的過度宣稱**):

```
✅ 列印品項  listOrderItemsForPrint ⇒ 分頁 + 上限 10,000 + 超過 throw（本片新增）
🔴 訂單明細  findAdminOrderDetail   ⇒ 【仍被 ORDER_ITEMS_EMBED_LIMIT = 200 夾住】
             SupabaseOrderAdapter.ts:847  .limit(ORDER_ITEMS_EMBED_LIMIT, …)
             觸及時翻成 itemsTruncated；常數仍活著
```
⚠️ **我原本寫「實質解掉了」是錯的** —— 那句會**關掉下一個人的尋找動作**,而 Sean 的業務事實(一張單可能到 200 品項、判定用 `>=`)**對明細那條路仍然成立**。原句劃掉留痕:~~實質解掉了 `ORDER_ITEMS_EMBED_LIMIT = 200`~~
⚠️ `limit` 不可被操控:`WALLET_LEDGER_PAGE_SIZE = 20` 寫死;`walletPage` 經 `parsePage` 驗證(**整數 ≥ 1,否則回 1**)⇒ offset 不可能為負。

## 🔴 結論

**沒有找到應該在推之前修的東西。**
⚠️ **口徑**:查的是「碰到哪些面」,**不是逐顆正確性**。**未查**:前端 XSS/CSRF、依賴鏈、Edge Functions、業務邏輯正確性 —— **與 `2026-08-16` 那份的「仍沒查」同一份清單,這一包沒有改變那個清單。**

## 🔴 做工具時,工具自己踩了三個坑(留著,因為都是同族)

1. **第一個對照組沒有判別力**:類 5 我先用 `^supabase/` 當對照 ⇒ **它也是 0** ⇒ 證明不了任何事。改用 `^docs/=49` / `^apps/=77` 才成立。**對照組本身要先被對照。**
2. **未跳脫的 `.`**:`grep -c ".env"` 報 1 命中 ⇒ 實際是 `environment-values-….md`。**根本沒有 `.env` 檔。** ⇒ selftest 世界 C 就是在守這一條。
3. **工具第一版會【永遠回 3】**:幾乎每包都碰 `order|payment` ⇒ 只看檔名的話它一直叫,而**一直叫的守門會被關掉**。⇒ 改成**數本體非註解行**,並**排除 `.md` 與測試檔** —— 沒排除的話,**本窗自己的 `docs/security/*auth*.md` 會被算成「授權被動過」143 行**,而四支真的 auth `.ts` 全是 0。

📎 第 3 條是本工具能用的原因:**它現在會對「只改註解的 auth 檔」保持安靜**,所以它叫的時候才有意義。

---

## 🔴 工具本身:**R1 = FAIL,未 commit,不要拿去用**

`scripts/pre-push-attack-surface-sweep.sh` 已寫出來並在工作樹,**但 code-reviewer(opus, fresh context)實跑後給 7 條 must-fix,我【沒有】commit 它。**

**三條「工具自壞卻回 `rc=0`」的實測路徑**(這是最嚴重的失敗模式,正好是它宣稱要防的):
```
① 檔名含空白  for _f in $_files 未加引號 ⇒ per-file diff 撈 0 行 ⇒ 判「攻擊面未變」
② CJK 檔名    --name-only 的 core.quotePath 轉義後餵回去撈不到 ⇒ 同上
③ TS 私有欄位 排除式把 `#field` 當註解 ⇒ 只加一行 `#newBackdoor = true;` ⇒ 本體 0 行
共同放大器:subst_lines 用 2>/dev/null 且不看 exit status ⇒ 該層零自壞偵測
```
🔴🔴 **而最該記的是第 5 條**:檔頭寫「`--selftest` 是它唯一的判別力、它壞掉時唯一會叫的就是 selftest」—— **那句是假的**。selftest grep 的是 pattern 的**複本**,**從不呼叫 `scan()` / `subst_lines()`**。reviewer 把主 pattern 換成 `ZZZNEVERMATCH` ⇒ **selftest 仍印「全過」rc=0**。
⇒ **前四條 bug 能活下來,正是因為它們全在 selftest 的分母外。**
📌 **這是今天同一族的第五次,而這次是我親手做的**:我寫了一個守門,**宣稱它的判別力來自 selftest,而那個 selftest 測的是別的東西**。

**最小修法(reviewer 給,未實作)**:用 `--pathspec-from-file=-` 取代整個 per-file 迴圈(一次 git、零 word-splitting)+ `-c core.quotePath=false`;**selftest 改成呼叫 `scan`/`subst_lines` 本尊**。

⚠️ **在那之前,這支不可當守門用。本節上方那份【手工】掃描結果不受影響** —— 它是我逐條人工查的,不是這支跑的。
