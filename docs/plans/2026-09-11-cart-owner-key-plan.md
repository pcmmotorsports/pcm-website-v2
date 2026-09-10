# Plan · 購物車繼承那個洞 —— 第三把 key 記「上一個主人是誰」

> **作者** 窗 B `pcm-website-v2-1f`(2026-09-11)· **狀態** 等 Sean 批(鐵則 8:`CartContext` 是共用元件)
> **紅線** 本檔只寫 plan。**批了才改碼。** 目前零改碼、零 push。

---

## 0 · 給 Sean 的三句話

**現在的狀況**:車行共用一台電腦。A 加了一車、**按登出**走人 ⇒ 車會清掉,這個已經做好了(2026-08-23 有人開真瀏覽器跑過一遍)。

**還沒解的**:A **沒有按登出**,而他的登入狀態自己過期了(隔天早上開機、改過密碼、或後台把他踢掉)。
隔天 B 坐下來登入 ⇒ **B 看到的是 A 的車。**

**為什麼現在的程式救不了**:它認的是「主人**換了**」。A 的登入自己死掉,在程式眼裡不是換人 —— 是「本來就沒人,現在有人」,而那跟「回頭客早上開電腦」長得一模一樣。

---

## 1 · 要你決定的三題

```
Q1: 這個洞怎麼修?
A: 甲 丙案 —— 在瀏覽器多記一格「上次這台車是誰的」, 只改 1 支檔、不碰資料庫(推薦)
   乙 乙案 —— 車整個搬進資料庫、綁在帳號上, 四個洞全關, 而要開新表、動權限、改 5 支以上

Q2: 訪客的車要不要一起丟?
    (客人沒登入先逛先加, 加了三件才去登入 —— 那台車現在會留著)
A: 甲 留著 —— 不動現在這條動線, 客人加完直接結帳(推薦)
   乙 丟掉 —— 一登入就清空, 最安全, 而客人剛加的三件會不見

Q3: 上線那一天, 大家已經在車上的東西要不要留?
A: 甲 留著 —— 上線當下沒有人有那格新資料, 全部視同「不知道」, 不動它(推薦)
   乙 全部清空 —— 最乾淨, 而所有回頭客那天會被倒車
```

**我三題都推薦甲。** Q2 那題**不是技術問題是產品問題** —— 我判「留著」的理由只是「不要改變現在客人的體驗」,那要你點頭。

---

## 2 · 現況(量到的,不是推的)

### 2-a 車存在哪
```
apps/storefront/src/contexts/CartContext.tsx:76  const STORAGE_KEY = 'pcm-cart-mock-v2'      ← 品項
apps/storefront/src/contexts/CartContext.tsx:77  const SESSION_KEY = 'pcm-cart-session-v1'   ← 結帳去重子
```
**零 cookie · 零 DB · 零 server。** 全 repo 動這兩把 key 的**只有 `CartContext.tsx`**
(另一個命中是 `e2e/cart-unavailable.spec.ts:47` 的測試常數)。⚪ 負對照 現造 key ⇒ 0。

### 2-b 現在換人清車怎麼運作(已經做好、已上線)
```
app/layout.tsx:183        await supabase.auth.getUser()
app/layout.tsx:~207       有人 ⇒ cartOwnerId = user.id · 確定沒 cookie ⇒ null · 不確定 ⇒ undefined
app/layout.tsx:214        <CartProvider serverOwnerId={cartOwnerId}>
CartContext.tsx:367       const ownerId = serverOwnerId
CartContext.tsx:372-401   useEffect([ownerId]) ⇒ A→null(登出) / A→B(換人) 才 setItems([]) + setCartSessionId(null)
```
**真瀏覽器證人**(`CartContext.test.tsx:19` 逐字):
「訪客 4 件 → 登甲留著 → 重整留著 → **換乙清空** → **按登出鈕清空**,**2026-08-23 實跑過**」。

### 2-c 為什麼 `null → A` 刻意不清(這條不要改)
`CartContext.tsx:330-333` 逐字:
> **承重的理由是 `INITIAL_SESSION`**:每次開頁 `prevOwnerRef` 都從 `null` 起步,而訂閱當下就 emit
> `INITIAL_SESSION` 帶回登入者 ⇒ **每一次重整都是 `null → A`** ⇒ 清它 = **每個回頭客每次開頁被倒車**。
> 這條與動線假設無關,是機制逼出來的,**沒有第二種寫法**。

🛑 **⇒ 本 plan 不動這一格。** 丙案是在**掛載那一刻比對存下來的主人**,不是把 `null → A` 改成要清。

### 2-d 碼自己列的四個洞,而只有 ① 是本 plan 要關的
```
🔴 ① session 在沒有分頁開著時死掉(過期 / 遠端 revoke / 改密碼)
     ⇒ 隔天 ownerId=null、A 的車還在 storage ⇒ B 登入走 null → B ⇒ 繼承 A 的車    ← 本 plan 關這個
⚠️ ② 前一人全程訪客沒登入 ⇒ 下一人登入繼承訪客車                                  ← 丙關不掉
🟢 ③ A 沒登出就走人 ⇒ ownerId 從頭到尾沒變 ⇒ 這段不會觸發                          ← 丙關不掉, 而那是對的
⚠️ ④ cookie 還在而 session 真的過期 ⇒ layout 判 undefined ⇒ 車留著                ← 丙關不掉(刻意)
```
🛑 **③ 為什麼不修 —— 引碼裡原句,不要重新發明**(`CartContext.tsx:344-347` 逐字):
> **A 沒有登出就走人**:下一個人坐下來時 A 還登著,`ownerId` 從頭到尾沒變過 ⇒ 這段**不會觸發**,
> 而那是對的 —— 它守的是「主人換了」,不是「坐在椅子上的人換了」,**後者在瀏覽器裡量不到**。
> ⚠️ 寫進來的理由:不寫,它每隔一陣子就會被當成 bug 重報一次。

📌 **而 ③ 真正的問題比車大**:此時 B 是**用 A 的帳號**在操作後台/前台。那是 session 存活期的題,不是購物車的題。

---

## 3 · 丙案:改什麼

### 3-a 動幾支
```
production   1 支   apps/storefront/src/contexts/CartContext.tsx
測試         1 支   apps/storefront/src/contexts/CartContext.test.tsx(加一個 describe)
CSS          0 支   ← 鐵則 5:本 slice 沒有任何 CSS 變更, 明寫
DB           0       零 migration · 零 RLS · 零 GRANT
server       0       零 route · 零 action · 零 adapter
```

### 3-b 加什麼
1. 第三把 key(**與既有兩把並列,不動它們**):
   ```ts
   const OWNER_KEY = 'pcm-cart-owner-v1';   // 這台瀏覽器上一次記到的車主人
   ```
2. `readOwner(): string | null | undefined` / `writeOwner(id: string | null | undefined)`
   —— **形狀照既有的 `readSessionId` / `writeSessionId`**(同樣 try/catch 靜默失敗、同樣 SSR 早退)。
   `undefined` = **key 不存在**(升級當天 / 隱私模式)⇒ 與「不知道」同義。
3. **掛載時比對一次**(放在既有 hydrate effect 內,`setItems(restored)` **之前**):
   ```
   存的主人 stored, 現在的主人 ownerId
   ┌────────────────────────────────────────────────────────────┐
   │ stored 是字串 且 ownerId 是字串 且 兩者不同  ⇒ 🔴 丟車      │
   │ stored 是字串 且 ownerId === null            ⇒ 🔴 丟車      │  ← A 的車 + 現在沒人登入
   │ ownerId === undefined(這次沒讀到)          ⇒ 🟢 什麼都不做 │  ← 與既有 effect 同一條三態紀律
   │ stored === undefined(key 不存在, 升級當天)  ⇒ 🟢 留著       │  ← Q3 甲
   │ stored === null(訪客車)                    ⇒ 🟢 留著       │  ← Q2 甲, 產品決定
   │ stored === ownerId                          ⇒ 🟢 留著       │
   └────────────────────────────────────────────────────────────┘
   丟車 = 品項與去重子【一起】丟(理由同既有 effect:去重子不該跟著新的人跑)
   ```
4. **寫入時機**:既有那支持久化 effect 旁邊加一支 `useEffect([ownerId, isHydrated])`
   ⇒ `isHydrated && ownerId !== undefined` 才 `writeOwner(ownerId)`。
   🛑 **`undefined` 不得寫進去** —— 寫了會把「A 的車」降級成「不知道誰的車」,下一次就比不出來。

### 3-c 🔴 順序是硬的
既有兩支 effect 的宣告順序 = hydrate(`[]`)在前、owner 比對(`[ownerId]`)在後,React 照宣告順序跑。
**丙案的比對必須在 hydrate effect 裡面、`setItems(restored)` 之前** ——
放在後面會先把 A 的車放進 state、再清掉,中間那一幀客人**看得到 A 的車閃一下**。

---

## 4 · 🔴 對自己用一次那句判別句

> **「如果這件事做好了,它會長成什麼字?那個字在我的尺裡嗎?」**
> (出處:`CartContext.tsx:313-320` —— 那支檔自己寫的,而我 2026-09-11 就是栽在它上面:
> 我拿板上那把 `userId` 尺去問「換人清車做了沒」,而真正的修法用的字是 `ownerId` ⇒ **修好前印 0、修好後也印 0**。)

**丙案做好了會長成這些字**,每一個都要進測試,**不是只進碼**:
```
OWNER_KEY / 'pcm-cart-owner-v1'      ← key 本身
readOwner / writeOwner                ← 兩支函式
```
📌 **⇒ 下一個人問「這件事做了沒」,`grep -c "pcm-cart-owner-v1"` 在修好前是 0、修好後是 ≥2(碼 + 測試)。**
**那把尺分得開兩個世界 —— 這是本 plan 對自己的驗收條件之一。**

---

## 5 · 驗收(兩個世界 + 突變 + 負對照)

```
世界①(該丟)  存 'user-A' · 現在 'user-B'      ⇒ 品項 0 · 去重子 null
世界②(該丟)  存 'user-A' · 現在 null          ⇒ 品項 0 · 去重子 null
世界③(該留)  存 null(訪客車)· 現在 'user-A'  ⇒ 品項不變          ← Q2 甲的守門
世界④(該留)  key 不存在 · 現在 'user-A'        ⇒ 品項不變          ← Q3 甲的守門
世界⑤(該留)  存 'user-A' · 現在 undefined      ⇒ 品項不變 · 且 OWNER_KEY 一個字都沒被改寫
世界⑥(該留)  存 'user-A' · 現在 'user-A'       ⇒ 品項不變
突變        把「丟車」那一行拿掉 ⇒ 世界①② 必須紅, 世界③④⑤⑥ 必須綠
突變        把 undefined 那一格改成「當 null 處理」 ⇒ 世界⑤ 必須紅
⚪ 負對照    現造 key 'pcm-cart-owner-zzq9' ⇒ 全 repo 0 命中
```
🛑 **世界⑤ 的第二半(`OWNER_KEY` 沒被改寫)一定要驗** —— 少了它,「不知道就別動」會被寫成「不知道就寫 null」,
而那個錯**在畫面上與正確版一模一樣**,只有下一次登入才會發作。

**三綠**:`TURBO_FORCE=1 pnpm typecheck` + `lint`;動 `.tsx` ⇒ 加 `build`。

---

## 6 · 丙 vs 乙(成本差在哪,給 Sean 看得懂的版本)

| | 丙(推薦) | 乙 |
|---|---|---|
| 改幾支 production 檔 | **1** | 5 以上(新表 + RLS + port + adapter + Provider 改寫) |
| 碰資料庫 | **不碰** | 開新表、動權限、要 migration、要你貼正式庫 |
| 關掉幾個洞 | ①(車行那個) | ①②③④ 全關 |
| 客人斷網時 | 車照常在(存在瀏覽器) | 要處理「連不上 server 時車怎麼辦」 |
| 會逼出新的產品決定 | 只有 Q2 那一題 | **多一題**:訪客車遇上帳號裡已經有的車,兩台要合併還是覆蓋 |
| 出錯的代價 | 客人的車被多清一次(看得見、客人會講) | 車寫錯人 / 讀不到(要查 DB 才知道) |
| 鐵則 | 8(共用元件)⇒ 本 plan | 8 + 12③(schema/migration)⇒ 還要 codex 唯讀審一輪 |

🔵 **而丙不擋乙**:丙是在瀏覽器裡多記一格,乙那天要做,把這一格連同它的理由一起搬進去即可。
檔頭 `CartContext.tsx:13` 逐字已經留了那條路:「M-3 接真後端時、本 Provider 內部從 localStorage 換 API、`useCart()` 介面不變、調用端零修改」。

---

## 7 · 🛑 丙關不掉什麼(照實寫,不要讀成全解)

```
🛑 ② 前一人【全程訪客】沒登入 ⇒ 下一人登入繼承訪客車
     成因:訪客車存的主人是 null, 而「上一個訪客」與「這一個訪客」在瀏覽器裡【原理上分不出】
     ⇒ 選 Q2 乙(訪客車一律丟)才關得掉, 而代價是「先逛先加再登入」那條動線斷掉
🛑 ③ A 沒登出就走人 ⇒ ownerId 沒變 ⇒ 不觸發(見 §2-d,碼裡明寫這是對的)
🛑 ④ cookie 在而 session 過期 ⇒ layout 判 undefined ⇒ 車留著
     方向是刻意的:「不倒別人的車」比「多清一次」便宜
```

---

## 8 · 本 plan 證不到什麼

```
① 我【沒有】開真瀏覽器重演 ①那個洞 —— 我信的是 CartContext.tsx:335-338 那段碼自己寫的清單
   加上 :372-401 的邏輯推導(prevOwnerRef 從 null 起步 ⇒ null → B ⇒ 不清)。
   🔴 而那是推的, 不是量的。要它變成量到的, 得造一次「session 在關著分頁時死掉」。
② 洞 ②④ 我沒有各造一次, 我核的是它們與碼一致。
③ §3 那個「1 支檔」是我讀碼估的, 我沒有寫過那段碼。
④ 乙案那一欄的成本是我估的, 沒有人做過設計。
```

---

## 9 · Rollback

丙案的 rollback 是**刪掉那一格比對 + 停止寫 `OWNER_KEY`**(revert 一顆 commit)。
瀏覽器裡殘留的 `pcm-cart-owner-v1` 沒有人讀 ⇒ **無害**,不必寫清除碼。
🛑 **既有兩把 key 的序列化契約一個位元都沒動** ⇒ 回退不會讓任何人的車讀不出來。

### 為什麼不 bump `pcm-cart-mock-v2` → `v3`(Q2 的技術面)
bump 版本 = **把所有人現在的車丟掉**(舊 key 沒有人讀了)。
而丙案要的資訊住在**另一把 key**,既有那把的**格式一個字都沒改** ⇒ **沒有理由 bump**。
📌 **bump 是「格式變了」的訊號,不是「行為變了」的訊號。** 拿它當後者用,代價是全站倒車。
