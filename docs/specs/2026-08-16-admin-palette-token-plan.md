# 後台「直接寫 Tailwind 調色盤色」收斂 plan(鐵則 8,等批才動手)

> **狀態**:未動手。本檔是 plan,不是紀錄。
> **提出**:A 窗(BMW M 線),2026-08-16。worktree `/Users/sean_1/pcm-bmw-m`,分支 `bmw-m-headline`。
> **為什麼要 plan**:跨 **17 支檔** ⇒ 命中鐵則 8「跨 3+ 檔」。

---

## 0. 🔴 先更正條目的數字 —— **原條目的兩個數字彼此不自洽**

設計參照標記與 backlog 寫的是「**70 處直接寫 Tailwind 調色盤色(13 檔)**」。
**我重數了,以本次數法為準**:

```
數法（逐種形狀合併後【去重】，排除 *.test.*）:
  PAL='(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|
        cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}'
  grep -rnE "(bg|text|border|ring|from|to|via|fill|stroke|shadow|outline|divide|accent|caret|decoration)-$PAL" \
    apps/admin/src --include='*.tsx' --include='*.ts' | grep -v '\.test\.'
⇒ 39 行 / 17 檔
```

| | 原條目 | 實測 |
|---|---|---|
| 處數 | 70 | **39 行**(其中 1 行是註解 ⇒ **38 行真 code**) |
| 檔數 | 13 | **17** |

🔴 **兩個數字不能用同一種誤差解釋**:
- **處數變少**(70→39)⇒ 像是原本**未去重**(同一行同時有 `bg-` 與 `text-` 被算兩次)。
  分形狀未去重的和是 `26+38+14+0+1 = 79`,去重後 39 ⇒ 約一半是同行重複。
- **檔數變多**(13→17)⇒ **那個方向與上面相反** ⇒ **不是同一個誤差**。

⚠️ **「70 是怎麼來的」是我的推測,標未確認** —— 我沒有原作者的數法。
**但「兩個數字彼此不自洽」是可驗的事實**,而它比推測重要:
**原條目的數字不可信,不要拿它當驗收基準。**

---

## 1. 🔴 逐行分類的**結果**(不是方法)

主視窗要求分三堆。**分完之後結論改變了這片的性質**,先講結論:

**數法(三條都可重跑;`$ALL` = §0 那條 grep 的輸出)**:
```
總計          echo "$ALL" | wc -l                              => 39
丁 註解行     echo "$ALL" | grep -c '設計參照 §5'               => 1
丙 分類色     echo "$ALL" | grep -c 'notes-timeline.tsx:4'      => 2
甲 語意色     39 − 1 − 2 − 乙                                   => 36
乙 純裝飾     逐行讀完 38 行真 code，一行都不是純裝飾           => 0（人工判讀，非機械）
```

| 堆 | 行數 | 說明 |
|---|---|---|
| **甲 語意色**(成功/警告/危險) | **36** | 狀態回饋:警告、錯誤、成功 |
| **乙 純裝飾** | **0** | 🔴 逐行讀完沒有一行是純裝飾 —— **這是人工判讀,不是機械數的** |
| **丙 說不清的(分類色)** | **2** | 見下 |
| **丁 非 code(註解)** | **1** | `order-status-axes.ts` 搜 `設計參照 §5` |

🔴 **我第一版把丙類寫成 3、甲類寫成 35 —— 錯了**:我把「同檔 `internal` 那筆」算進丙,
而**它吃 `bg-muted`、根本不在調色盤命中裡**。⇒ **我在描述一個不在清單上的東西。**
**修法**:分類的每一堆都要能用一條命令從同一份輸出撈出來,撈不出來的就是我腦補的。

**色系分佈(真 code 38 行)**:`amber 25 / red 5 / emerald 5 / green 2 / sky 1`
(數法:`echo "$ALL" | grep -c -- "-<色>-"`)
⚠️ **這 5 個數字加起來是 38,而甲類是 36** —— 差的 2 就是丙類那兩行
(`emerald` 有 1 行、`sky` 有 1 行落在丙)⇒ **甲類的色系分佈是 `amber 25 / red 5 / emerald 4 / green 2`**。
🔴 **兩個分類軸(色系 / 語意堆)不能直接相加對帳** —— 我第一版就是這樣寫的,自己對不起來。

### 甲 · 語意色 36 行 —— **可機械收斂**

三種角色、字面高度重複:
```
警告 amber   border-amber-500/30 bg-amber-500/5 text-amber-700     ← 出現 4 次以上
             border-amber-300  bg-amber-50  text-amber-900         ← 出現 4 次以上
             text-amber-700 / text-amber-800                       ← 單獨用
危險 red     bg-red-50 text-red-800 / text-red-700
成功 green   border-green-500/30 bg-green-500/5 text-green-700
     emerald border-emerald-300 bg-emerald-50 text-emerald-900 / bg-emerald-100 text-emerald-800
```
🔴 **`green` 與 `emerald` 混用**(2 vs 5)—— 同一個「成功」語意用了兩個色系。
**那本身就是這片要修的東西**,不是新增的問題。

### 丙 · 說不清的 2 行 —— **這一堆決定這片能不能做**

```
components/orders/notes-timeline.tsx  搜 NOTE_TYPE_BADGE
  contact_log:        bg-sky-100  text-sky-800       ← 聯絡紀錄
  customer_notified:  bg-emerald-200 text-emerald-900 ← 已告知客人
⚠️ 第三類 `internal` 吃 `bg-muted`（已經是 token）⇒ **它不在這 39 行裡，本片不動它**。
```
**為什麼說不清**:這兩個不是「成功/警告/危險」,是**分類色** —— 用顏色區分備註類型。
`sky` 不代表「資訊」,它代表「聯絡紀錄」。
⇒ **要不要收成 token,取決於「後台要不要有一組分類色」**,而那是**設計決策**。
📎 依據 OD:`index.html` 搜 `訂單備註:三類要分得出來` ——
OD 明文用三種顏色分這三類,**而 OD 用的是它自己的色**(不是 Tailwind 調色盤)。

---

## 2. 🔴 分類完的結論:**這片可以做,而且該拆兩片**

主視窗定的判準是「說不清的那堆很小 ⇒ 可分兩片;很大 ⇒ 本質是設計決策、該併進 demo brief」。
**實測 2 行 / 1 支檔**(且同一個常數表裡)⇒ **很小** ⇒ **拆兩片**。

```
片一（機械、可先做）  甲類 36 行 收成語意 token
片二（要 Sean 拍板）  丙類 2 行 —— 後台要不要有一組「分類色」，併進 demo brief 一起問
```

---

## 3. 片一要做什麼

**新增三組語意 token**(對映到既有 `--destructive` 那一族的形狀,寫在 `globals.css` `:root`):
```
--warn / --warn-fg / --warn-border      ← 收 amber 25 行
--danger-soft / --danger-soft-fg        ← 收 red 5 行（--destructive 已存在，這是它的淡底版）
--success / --success-fg / --success-border ← 收 green 2 + emerald 4 = 6 行，順便把兩個色系收成一個
                                              （emerald 總共 5 行，其中 1 行在丙類、本片不動）
```
⚠️ **值從哪來**:🔴 **不是我挑** —— OD `overview-desktop-bmw-m.html` 有 `--danger` / `--success`
(搜 `--danger`),先照搬;OD 沒有的(warn)**列為決策題給 Sean**,不自己選。

**驗收條件(每條可 yes/no)**:
1. 上面那條 `grep` ⇒ 甲類 36 行歸零(**丙類 2 + 註解 1 保留 ⇒ 總數 3**)
2. 新 token 全數進 `design-tokens.test.ts` 的**對比實算**配對表(該檔有一格釘涵蓋率)
3. 每一組 token 至少一個消費端,**零「宣告在、消費端 0」**(動效 token 那個坑)
4. 三綠 `--force` `0 cached` + 全測綠
5. 🔴 **真瀏覽器 computed value 覆核**:改前改後各量一次那三組色的實際 rgb,**逐字寫進 commit**
   —— 這族全是「員工要靠顏色判斷狀態」的東西,**只驗字面不夠**

## 4. 預期影響面

- **看得到的**:警告框、錯誤訊息、成功徽章的顏色會**微調**(從 Tailwind 調色盤換成我方 token)。
- 🔴 **看不到但要注意**:`amber-700` 與新的 `--warn-fg` **不會逐像素相同** ⇒
  **對比會變** ⇒ 驗收條件 2 那道實算守門是承重的,不是形式。
- **不影響**:狀態膠囊(已吃 `.cap-*`)、未收款紅框、`--destructive` 既有消費端。

## 5. Rollback

單一 commit、純樣式、零 schema/API ⇒ `git revert <sha>` 完全復原。
**唯一不可逆風險**:Sean 看了覺得新的警告色不夠醒目 —— 那是視覺取捨,revert 成本一顆 commit。

## 6. 我需要的批准

**片一**:一句「可以做」+ **warn 那組的值**(OD 沒有,需要他挑或授權我照 `--destructive` 的形狀推)。
**片二**:不要現在批,**併進 demo brief 一起問**。

## 7. 誠實缺口

- **「70」怎麼來的我沒查出來**,只證明了它與「13 檔」彼此不自洽。原作者若有數法,以他的為準。
- **我沒有量過改動前後的實際對比值** —— 那是片一施工時要做的,plan 階段只列成驗收條件。
- **OD 的 `--danger` / `--success` 我只確認存在,沒有逐一比對它們與我方 amber/red/emerald 的距離**
  ⇒ 「照搬 OD 值」可能造成比我預期更大的視覺變化。
