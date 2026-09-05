# plan · ⟦f3-SHIPPDF1⟧ P-2 —— 後台的 `.pdf` 路由 + 那兩張紙

> 線【出貨】`-ship` 2026-09-06。**標準片**(動後台訂單 UI ⇒ code-reviewer;**不碰鐵則 12 六類**)。
> 主視窗 `-f8` 2026-09-06 起手指示:先解析 OD 真權威、查無要寫分母、驗收用兩個世界。
> **本檔零 diff。**

---

## 1. 🔴 鐵則 1 真權威解析 —— **稿裡沒有「下載」這個動作**(查無, 帶分母)

| 問題 | 答案 | 量法(可單發重跑) |
|---|---|---|
| 出貨單/揀貨單的視覺真權威在哪 | OD `pcm-print-docs` 的 `contract.md` + `shipping-picking-doc-a4.html` | 磁碟 `ls …/projects` ⇒ **12** 個專案 |
| 🔴 而 `pcm-524f` 裡也有一份 | **兩份逐字相同**(`diff` ⇒ 零差異)⇒ 同一份稿的兩個副本 | `diff pcm-524f/REF-出貨列印-合約-20260816.md pcm-print-docs/contract.md` |
| 稿裡有沒有「下載」這個動作 | ❌ **沒有** | `下載` **0** · `download` **0** · `按鈕` **0** |
| 🟢 正對照(尺會動嗎) | `列印` **4** · `出貨` **14** | 同上兩支檔 |
| ⚪ 負對照 | 現造字 `zzq9never` **0** | 同上 |

⇒ 📌 **稿涵蓋的是「這張紙長什麼樣」, 不是「怎麼把它變成一個檔」。**
⇒ ✅ **所以 P-2 的視覺面【不需要新稿】** —— 它印的是**同一張紙**;新增的是一條路由與一顆鈕。
⇒ 🛑 **而那顆鈕長什麼樣【稿裡沒有】** ⇒ 那是一個要 Sean 或 Design 決定的視覺題, **不是我能自己畫的**。
   ⚠️ 本片**先不做鈕** —— 先做路由(能用網址拿到檔), 鈕另議。**這是刻意的縮範圍, 寫在這裡。**

### ⚠️ 而 `list_projects` 這一半我沒做到
OD daemon 沒開(`cannot reach the Open Design daemon at 127.0.0.1:7456`)⇒ **只有磁碟那一半的數字**。
鐵則 1 要求兩邊對一次 ⇒ 📌 **這一格是缺口, 不是通過**。要補就 `pnpm tools-dev` 起 daemon 再數一次。

---

## 2. 現況(當場量)

```
後台那兩張紙   apps/admin/src/app/print/orders/[id]/picking/page.tsx
               apps/admin/src/app/print/orders/[id]/shipping/[shipmentId]/page.tsx
產 PDF 的能力  @pcm/pdf(P-1 抽出來的)—— 後台今天【還沒有】用它
後台登入閘     proxy.ts:84 matcher '/((?!_next/static|_next/image|favicon.ico).*)'
               ⇒ 全站 fail-closed, 而 `/print/...` 已被涵蓋(那一頁的檔頭逐字寫著)
```

## 3. 要做什麼

```
① 一條 `/print/orders/[id]/shipping/[shipmentId].pdf` 的 route(回 application/pdf)
   · 它【不去 goto 自己的網址】—— 沿用顧客站那條路的決定:拿資料 → 自己 render → 餵 chromium
     🔴 理由不是效能:goto 要把 session cookie 轉發進 headless Chrome
② 後台這一側的字型與版面 CSS 怎麼進去 —— 🛑 **這一格是本片最可能踩雷的地方**(見 §4)
③ 兩個世界的測試(見 §5)
🛑 ④【不做】那顆鈕 —— 稿裡沒有, 而視覺不是我的域
🛑 ⑤【不做】揀貨單那張 —— 一次一張;出貨單先走通, 揀貨單照抄
```

## 4. 🔴🔴 本片最大的風險 —— **它與 P-1 那個是同一個**

顧客站那條路踩過:**本機好、線上每個中文是方框, 而 HTTP 200、三綠全綠**。
而後台這一側**要重踩一次**, 因為:
```
· 字型是 require.resolve 找的 ⇒ 解析起點是【呼叫它的那支檔】⇒ 後台是另一個 app
· Next 的檔案追蹤從 route 出發 ⇒ 後台那條 route 是一條【全新的】路
· 顧客站今天靠的是 next.config.ts 的四條 root .pnpm glob —— 而**後台的 next.config 沒有那四條**
  ⇒ 📌 **P-1 的量測明說了:那 215 筆字型是 glob 供應的, 不是 require.resolve 帶進來的。**
  ⇒ 🎯 **所以後台這條路【預設就是壞的】** —— 不是可能, 是量得出來的預期。
```
⇒ ✅ 本片一定要**在後台的 `next.config.ts` 補上同一組 glob**, 並**照抄那支 tracing 守門**。
⇒ ⚠️ 而拉丁那支(`@fontsource/noto-sans`)**在顧客站也沒有 glob**(`⟦ship-PRINTCARONNOTBUNDLED⟧`)
   ⇒ 🛑 **後台補的時候要把它一起補** —— 否則我會在新的一側**複製一個已知的洞**。

## 5. 驗收條件

```
① 兩個世界(主視窗指定):
   有權限   ⇒ 回 200 且前四位元組是 %PDF
   沒權限   ⇒ 拿不到(導 /start 或 4xx)—— 而【不是】回一份 PDF
   🔴 第二格用【真的沒有 cookie】那一發, 不是靠讀 proxy.ts 的字面推論
② tracing 守門:後台那條 route 的 .nft.json 裡, 兩支字型套件【各自】的檔數 = 磁碟實數
   ⇒ 🔴 兩支都要問(顧客站只問了一支, 而那正是 PRINTCARONNOTBUNDLED)
③ 三綠 + 全套連跑兩發比四個數
```
🛑 **而三條都答不出「那張紙上的中文是字」** —— 那要真部署後有人打開看一眼(同 P-3 §二)。

## 6. rollback / 影響面

```
· 新增一條 route + 後台 next.config 加 glob ⇒ 刪掉即可, 不動既有列印頁
· 🔵 沒有不可逆的格子:不寄信、不寫 DB、不改客人看得到的東西
· ⚠️ 而它會讓後台多一個 ~160 MB 的 function(P-3 量到的量級)
  ⇒ 其餘 23 個 function 不受影響(成本是 per-function)
```

## 7. 🛑 我沒做什麼

```
· 一行碼都沒寫, 零 diff
· 沒有跑 list_projects(daemon 沒開)⇒ 鐵則 1 的兩邊對數只做到一半
· 沒有量後台那條 route 加上去之後的實際體積 —— 那要先寫出來才量得到
· 沒有決定那顆鈕 —— 稿裡沒有, 而視覺不是我的域
```
