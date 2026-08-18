# 商品同步的擁有權:誰蓋得掉員工改的東西(**純讀,不動 code**)

> 2026-08-19T03:12 CST(`date` 實跑) · G5
> 🔴 **結論先講:交辦時的框法(「一個保護欄位,若寫入端不讀它就是裝飾」)【不成立】** ——
> 真正的保護不在那個欄位,而且**比欄位強**。細節在 §1。

---

## §1 Q1:`listing_set_by` 真的有生效嗎 ⇒ **問題問錯了,而答案比預期好**

### 先講量到的
```
git grep 'listing_set_by' -- scripts/          ⇒ 🔴 零命中
逐支查 rpm-transform / rpm-reconcile / rpm-import / rpm-load / rpm-delta ⇒ 全部 0
```
**照交辦的框法,到這裡就會下結論:「寫入端不讀它 ⇒ 它是裝飾」。而那是錯的。**

### 🔴 為什麼錯:同步端不讀它,是因為**它根本不再寫上下架那一欄**
`scripts/rpm-reconcile.ts:7-13` 逐字:
```
原 applyDelist(寫 delisted_at=now)→ markSourceMissing(寫 source_missing_at=now)
⇒ **delisted_at 從此不由本管線寫入**
- 上架/下架:**本管線完全不碰** delisted_at(rpm-transform 也不再鏡射來源值)
```
**而那不只是註解,有測試守著**:
```
scripts/rpm-reconcile.test.ts:110 逐字
  「🔴 驗收 3(負測):來源消失 → 寫 source_missing_at,**完全不碰 delisted_at**」
:115  expect(payload).toEqual({ source_missing_at: '…' })   ← exact-shape 斷言
:120  正向對照也在(冪等過濾條件)
⇒ 🔴 管線若哪天又開始寫 delisted_at,**那一格會紅**
```

### ⇒ 所以真正的形狀是
```
❌ 不是:「同步會蓋,而我們加一個旗標叫它別蓋」(那種保護要靠寫入端記得看)
✅ 而是:「**上下架這件事整個不再是管線的業務**」
   ⇒ listing_set_by 是【誰設的】的紀錄,給畫面顯示與篩選用,不是給管線看的閘
⇒ 🔴 後者比前者強:旗標可以被忘記檢查,而【不寫那一欄】沒有東西可以忘
```
📌 **判別句(可搬走)**:問「這個保護欄位寫入端讀不讀」之前,先問
**「寫入端還有沒有在寫那一欄?」** —— 不寫了的話,那個欄位本來就不是閘。

### ⚠️ 而這一格仍有一件我答不出來的
```
上面證的是【上下架】那一欄。而商品頁那句話講的是「哪些欄位會被覆蓋」——
其他欄位(標題 / 描述 / 價格 / 圖)同步【的確會蓋】,而它們沒有 *_set_by
⇒ 🔴 所以「員工改了會不會被蓋掉」這題,**上下架已解,其餘未解**
⇒ 缺的那一道檢查:**逐欄查 rpm-import 的 upsert payload 含哪些欄**,我沒做完
```

---

## §2 Q2:「依供應商而定」有沒有地圖 ⇒ ✅ **有,而且那句話是準的**

`scripts/supplier-config.ts`(346 行)每家一組設定,**其中有欄位層級的開關**:
```
supplierSlug / brandSlug / handlePrefix
🔴 syncDescription: boolean        ← 這一家的「描述」要不要被同步蓋
🔴 syncInstallResources: boolean   ← 安裝資源要不要蓋
   appendManualFilename / categoryStrategy / variantImages
🔴 writeAllowed: boolean           ← 這一家到底寫不寫(rpm-import:144 逐字
                                     「writeAllowed=false ⇒ Phase 3 放量拍板前僅乾跑」)
實例:rpm 那家 syncDescription: false
```
⇒ **商品頁那句「哪些欄位會被覆蓋,依供應商而定」是【準確的】,不是含糊其辭。**
⇒ 而**同步腳本裡零 per-supplier 分支**(`git grep 'supplierSlug ===' -- scripts/rpm-*.ts` ⇒ 零命中)
   —— 差異全部走設定,不走 if。**那是好的形狀。**
📎 供應商清單見 `.github/workflows/rpm-sync.yml:72` 的 matrix(rpm / gbracing / bonamici / cncracing /
   evotech / eazigrip / samco / motogadget / front3d / materya / ebc / akrapovic / lightech …)。

---

## §3 Q3:上架 runbook 有沒有寫「同步會覆蓋什麼」⇒ 🔴 **沒有。零命中。**
```
grep -iE '覆蓋|蓋掉|同步.*寫|會被改' docs/runbooks/supplier-storefront-onboarding.md ⇒ 0
```
⇒ 🔴 **那是缺口**:上架一家新供應商的人,**在 runbook 裡看不到「這家的哪些欄會被每天蓋掉」**
—— 而那正是他要在 `supplier-config.ts` 裡做的決定。
⇒ 而地圖(`supplier-config.ts`)存在 ⇒ **這一格不是「要做研究」,是「要把既有的地圖指過去」。**

---

## §4 Q4:正確形狀有哪些選項(**只列,不推薦**)

```
甲 維持現狀:欄位層級的開關寫在 supplier-config.ts
   代價 每加一個「員工可改而不該被蓋」的欄,就要加一個開關 ⇒ 設定會長
   而它今天已經在用,且【零 per-supplier 分支】的形狀是乾淨的

乙 每欄一個 *_set_by(交辦提到的那個)
   代價 🔴 那是【每一欄都要一個閘,而每一個閘都要寫入端記得看】
        —— 正是 §1 證明比較弱的那一種形狀
   而它的好處是【逐列】而不是【逐供應商】:同一家的 A 商品員工改過、B 沒有

丙 不分欄,改成「這一列被員工碰過就整列不同步」
   代價 最粗,而最不會出錯;而員工改一個錯字就讓整列停止同步

丁 把「同步不寫」的範圍再擴大(照上下架那條路)
   ⇒ 哪些欄根本不該由管線寫,就從 payload 拿掉
   代價 要逐欄拍板「這欄歸誰」,而那是產品決定不是技術決定
```
🔴 **我不推薦** —— 那是 plan 層的事,而**四個選項的分界是「逐供應商 / 逐列 / 逐欄」三種粒度**,
選哪一種要先知道「員工實際上都在改什麼」。
📎 而那份資料**可能已經有人在查**:`docs/reviews/2026-08-19-product-edit-what-staff-actually-changes.md` 存在。

---

## §5 我沒做的(明寫)
```
· 🔴 沒有逐欄查 rpm-import 的 upsert payload ⇒ 「標題/描述/價格/圖會不會蓋掉員工的改動」未解
· 沒有讀 OD 設計稿(另一個窗在讀)
· 沒有動 code、沒有碰 supplier-config.ts、沒有碰 runbook
· ⚠️ 20,341 這個數字是【交辦轉述】,我沒有量(我沒有 DB access)
```

## §6 📎 那條新命令的第一次真實使用(順帶回報)
```
MARK 掃 listing_set_by ⇒ 🔴 零命中(而該欄在 1 支 migration 有 6 行)
⇒ 判讀:那個欄位【沒有】伴隨「拍板 / 刻意不修 / 要 Sean」這類裁決語言
⇒ 而它是對的 —— 因為那支 migration 的拍板寫在【檔頭的 Sean 拍板清單】,不在欄位旁邊
⚠️ 所以這一次它「零命中」不是失敗,而**我差點把零命中讀成「沒有裁決」** ——
   實際上檔頭 :6-8 有七條 Sean 拍板。⇒ **那條命令的射程限「與主題同一行」,再次證實。**
```

— G5
