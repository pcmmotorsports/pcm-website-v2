# 顧客站客人動線 smoke —— 一份「照著走就得到同一組數字」的清單

> **這份檔在什麼情況下會【變成假的】**
> ① 有人改了 `/api/search` 的回傳形狀 ⇒ §2 的量法失效(而它會【印 0】,看起來像搜尋壞了);
> ② 有人改了目錄排序或商品數 ⇒ §3 的期望值過期(而**期望值本來就會漂,見下面那條紅字**);
> ③ 供應商上架 / `supplier-config.ts` 的 `writeAllowed` 翻動 ⇒ §6 那幾家的泛白狀態變;
> ④ Sean 推翻 `C-31-A` 或 `Q28①` ⇒ §5、§6 整段的「這是刻意的」不再成立。
> ⇒ 四個都不是時間到期,是**別人動了東西**,而**沒有機制會叫**。

> 🔴🔴 **每一格寫的是【怎麼量】,不是【量到多少】。**
> 數字會漂,而**一份寫死數字的清單會在漂掉的那天把對的世界判成錯的**。
> 今晚的實測值集中放在 §9 附註,**帶著量測時刻**,只當「上次長這樣」用,不當判準。

> 🛑 **這不是自動化測試,而且刻意不是。** 它要**真瀏覽器 + 線上 production**,
> 那不是 CI 跑得動的東西。⇒ 這是一份**人照著走**的清單。

---

## §0 開始之前(兩格,少一格後面全部白做)

```
① 目標一律是 production:https://shop.pcmmotorsports.com
   🛑 不要本機、不要 dev preview —— 客人碰的是 production。
② 🔴 .playwright-mcp/ 是【全窗共用】的 ⇒ 每一發 evaluate 自帶 location.href 回核。
   實錘(2026-09-03):本窗第一次點搜尋框, 畫面跳到 /login?next=%2Faccount,
   重做一次沒再發生 ⇒ 極可能是別窗的頁。**沒有那一格回核, 我會報一個不存在的缺陷。**
```

**每一發的最小形狀**(照抄):

```js
() => ({ href: location.href, /* ...你要量的東西... */ })
```

---

## §1 不要當缺陷報的四件(先讀,免得重新發現一次)

| 現象 | 它是什麼 | 來源 |
|---|---|---|
| DBK / Kineo / RIZOMA / WRS 四家品牌磚**泛白、點不動** | **Sean 2026-08-04 拍板**,2026-09-03 又重申「乙 不改」 | `~/pcm-mailbox/C-31-A.md:6-7` |
| 打**裸** `/products` 而網址自己變成 `?vehicle=…` | **Sean 2026-08-08 批 Q28① 四題全 A**,第 2 題逐字就是這個 | `~/pcm-mailbox/D-226-A.md:8`(拍板標題)與 `:11`(那一條逐字) |
| 商品頁**沒有庫存狀態** | **Sean 2026-09-03 拍乙**:PCM 是接單才下訂,有沒有貨本來就不是我們答得出來的 | 主視窗-87 轉述 |
| 目錄第一頁價格擠在高價區 | 排序拍板「中高價位優先」 | memory `project_*` 0827 那批 |

---

## §2 搜尋(🔴 這一格今天是紅的)

**怎麼量**(在站上任一頁的 console / evaluate):

```js
async () => { const out={href:location.href,rows:[]};
  for (const q of ['rpm rsv4','rpm','RSV4','排氣管','zzqnotathing9']) {
    const r=await fetch('/api/search?q='+encodeURIComponent(q));
    const j=await r.json().catch(()=>null);
    out.rows.push({q, status:r.status, items:j?.items?.length ?? null});
  } return out; }
```

**判準(兩個世界要印不同的東西)**:

- 🟢 **單詞**(`rpm` / `RSV4` / `排氣管`)⇒ `items` **非 0**
- 🔴 **兩個詞**(`rpm rsv4`)⇒ 今天 `items` **= 0** ——
  而**它與亂碼 `zzqnotathing9` 的 0 是同一個畫面、同一句文案**
- 🟢 **負對照**:亂碼 ⇒ 0(尺不是對什麼都印 0)

🛑 **`items` 的長度是【上限】不是筆數** —— 今天六個完全不同的查詢都回同一個數。
⇒ **不要把它讀成「搜到 N 筆」**。回應裡有一個叫 `total` 的欄位,而它今天裝的是 `null`。

📌 **根因不用重查**:走 ILIKE 子字串比對、**無分詞**(`6fb55245` 的 commit body 逐字)。
線 `-mail` 2026-09-03 在修(`docs/specs/2026-09-03-storefront-search-multiword-sku-plan.md`)。

---

## §3 目錄

```js
() => ({ href: location.href,
  cards: document.querySelectorAll('a[href*="/products/"]').length,
  countText: (document.body.innerText.match(/[\d,]+\s*件商品/)||[null])[0] })
```

- 期望:`countText` 是一個**萬位數**、`cards` 是**一頁的張數**(兩者本來就不同,不要當成不一致)
- 🟢 **負對照**:`/products?category=zzq-not-a-category` ⇒ 期望 `countText` **變小或 0**;
  若它與無篩選時**同一個數**,那表示篩選沒生效(而畫面看起來完全正常)

---

## §4 商品頁

```js
() => { const t=document.body.innerText; const btn=s=>[...document.querySelectorAll('button')].find(b=>b.innerText.includes(s));
  return { href: location.href, h1: document.querySelector('h1')?.innerText,
    prices: (t.match(/NT\$\s*[\d,]+/g)||[]).slice(0,3),
    addDisabled: btn('加入購物車')?.disabled, buyDisabled: btn('立即購買')?.disabled }; }
```

- 期望:`h1` 有值、`prices` 非空、兩顆鈕 `disabled` 皆 **false**
- 🛑 **庫存狀態查無是【正常的】** —— 見 §1 第三列。**不要開缺陷單。**
- ⚠️ **「立即購買」那顆本清單刻意不按** —— 沒有人量過它會不會直接送單。
  要測它請先找到一個**可以安全丟棄的帳號**,不要用真帳號在 production 按。

---

## §5 加入購物車 → 購物車

**加入之後兩個世界都要問**:

```js
async () => { await new Promise(r=>setTimeout(r,1200));
  return { href: location.href,
    toast: document.querySelector('[role="status"],[role="alert"],[class*="toast"]')?.innerText.trim(),
    headerBadge: [...document.querySelectorAll('header *')].map(e=>e.textContent.trim()).filter(x=>/^\d+$/.test(x))[0] }; }
```

- 期望:`toast` 出現**且** `headerBadge` 同時變 ——
  🔴 **兩個都要問**:只問 toast 的話,「toast 出現而車其實沒加進去」那個世界也會過。

**購物車頁**:期望看得到品名 / 料號 / 顏色 / 適用車款 / 數量 / 移除 / 小計 / 運費 / 總計。
🟢 **負對照**:空購物車時期望**看不到**「總計」。

---

## §6 選車黏著(⚠️ 這是刻意的,而它有三個訊號)

**兩個世界,一發一發來**:

```js
// 世界 A:先讓鏡有車
//   走 /products?vehicle=yamaha%3Ayzf-r6, 等 2.5 秒, 確認 sessionStorage 有值
// 世界 B:然後打【裸】 /products
async () => { await new Promise(r=>setTimeout(r,3000));
  return { href: location.href,
    urlRewritten: location.href !== 'https://shop.pcmmotorsports.com/products',
    mirror: !!sessionStorage.getItem('pcm.vehicle.v1'),
    h1: document.querySelector('h1')?.innerText,
    count: (document.body.innerText.match(/[\d,]+\s*件商品/)||[null])[0] }; }
```

- **鏡有車**:網址**自己改寫**成 `?vehicle=…` · `h1` 變**車名** · 件數**變少**
- 🟢 **負對照**(`sessionStorage.removeItem('pcm.vehicle.v1')` 後重打裸網址):
  網址**維持裸的** · `h1` 回「全部商品」· 件數回**萬位數**
- 🔴 **兩個世界印不同的東西才算量到了。** 只跑其中一個 ⇒ 證不出任何事。

📌 **三個訊號都在**(網址列 / `h1` / 「清除車輛」鈕)⇒ 「客人不知道自己在篩」**不成立**。

---

## §7 結帳(走到門口為止)

- 期望:按「前往結帳」⇒ 導到 `/login?next=%2Fcheckout`,而頁上有一句解釋 + 購物車徽章仍在
- 🛑 **不要建帳號、不要送單、不要付款。**
- ⚠️ **⇒ 因此登入牆之後的一切(結帳頁本身 / 金流 / 地址 / 運費計算)這份清單【沒有涵蓋】。**
  **那不是「驗過了」,是「沒走到」。** 要涵蓋它需要一個可丟棄帳號 + Sean 授權。

---

## §8 手機(390×844)

```js
() => { const small=[]; document.querySelectorAll('a,button,input,[role="button"]').forEach(e=>{
    if(e.offsetParent===null) return; const r=e.getBoundingClientRect();
    if(r.width>0&&r.height>0&&(r.width<44||r.height<44)) small.push({t:(e.innerText||'').trim().slice(0,18)||e.getAttribute('aria-label'),w:Math.round(r.width),h:Math.round(r.height)}); });
  return { href: location.href, vw: innerWidth,
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth+1,
    under44: small.length, worst: small.sort((a,b)=>a.w*a.h-b.w*b.h).slice(0,5),
    pageHeight: document.documentElement.scrollHeight }; }
```

- 🟢 **正對照**:header 那四顆(選單 / 搜尋 / 首頁 / 購物車)期望**全部 44×44**
  ⇒ 📌 **這個站知道 44 這個數字** ⇒ 量到別處小於 44 時,那是**沒蓋到**不是「他們不在乎」
- 期望 `horizontalOverflow` **false**(桌機與手機都是)
- 購物車頁另量:結帳鈕的 `visibleWithoutScroll`(`rect.bottom <= innerHeight`)

---

## §9 附註:2026-09-03 02:0x–02:3x 的實測值(**只當「上次長這樣」,不是判準**)

| 格 | 當時量到 |
|---|---|
| §2 兩詞搜尋 | `rpm rsv4` ⇒ 0 · `rsv4 rpm` ⇒ 0 · 單詞皆非 0 · 亂碼 ⇒ 0 · 非 0 者一律回 8(= 上限) |
| §3 目錄 | 22,245 件商品 / 一頁 50 張卡 |
| §4 商品頁 | `samco-hus-9`:NT$ 13,800、19 個顏色、兩顆鈕皆未 disabled、庫存字面 7 個全 0 命中 |
| §5 加入購物車 | toast「已加入購物車 · 車上共 1 件」+ 徽章同時變 1 |
| §6 選車黏著 | 鏡有車 ⇒ 403 件 / `h1` = Yamaha YZF-R6;清掉鏡 ⇒ 22,245 件 / `h1` = 全部商品 |
| §8 手機 | 45 個目標 < 44px;最小 = 主視覺輪播點 **34×3**;購物車 1 件時 `scrollHeight` **2096** vs `innerHeight` 844 |

🔴 **這張表在你讀到的時候很可能已經過期。** 用它來對照「差很多嗎」,**不要用它當通過標準**。

---

## §10 這份清單【沒有涵蓋】什麼(先讀,免得把它當成全部)

- 登入牆之後的一切(見 §7)
- 「立即購買」那顆鈕(見 §4)
- 會員中心 / 訂單查詢 / 退換貨 / 安裝預約 / 合作店家
- 付款信與出貨信的**實際內容**(那要真的完成一筆交易)
- ⛔ ~~🔴 **全站連結是否都通** —— 本清單走的是**一條動線**,不是一次連結普查。~~
  **⇒ 2026-09-03 補進來了,見 §11**(那一節由線 `-account` 量)。
  🔵 而原句那半仍然成立、留著:**「動線走得完」不蘊含「沒有死連結」** —— 兩者是兩件事,
  §11 也只涵蓋**它自己列出的那幾頁**,不是全站爬。

---

## §11 連結普查(線 `-account` 2026-09-03;**寫怎麼量,不寫量到多少**)

> 🎯 這一節與 §2–§9 **是兩件事**:那些走的是**一條動線**,這一節問的是**這一頁上每一個點得下去的地方到不到得了**。

### 11-a 怎麼量(三條規矩,少一條這一節就沒有判別力)

```js
// 在要普查的那一頁的 console / evaluate 跑。
// 🔴 規矩一:href 從【畫面上抄】—— 用 querySelectorAll,不要自己打網址(理由見 11-c)
async () => {
  const seen = new Map();
  for (const a of document.querySelectorAll('a[href]')) {
    const h = a.getAttribute('href');
    if (!h || h.startsWith('http') || h.startsWith('mailto') || h.startsWith('tel')) continue;
    const clean = h.split('#')[0];
    if (clean && !seen.has(clean)) seen.set(clean, (a.textContent||'').trim().slice(0,14));
  }
  const bad = []; let ok = 0;
  for (const [href, label] of seen) {
    try { const r = await fetch(href, { redirect: 'manual' });
          r.status === 200 ? ok++ : bad.push({ href, label, status: r.status }); }
    catch (e) { bad.push({ href, label, status: 'ERR' }); }
  }
  // 🔵 規矩二:每一頁都跑一發負對照 —— 它必須回 404
  let neg = null;
  try { neg = (await fetch('/zzqprb-not-a-page', { redirect: 'manual' })).status; } catch (e) {}
  return { total: seen.size, ok, bad, negControl: neg };
}
```

**規矩三:`307 → /login` 不算死連結。** `/account` 這種未登入被擋的路徑,`redirect:'manual'`
下會回 `status 0`(opaqueredirect);拿 `curl -o /dev/null -w '%{http_code} %{redirect_url}'` 打它
會看到 `307 → /login?next=…` ⇒ **那是對的行為**,把它算成壞的就會每一頁都多報一筆。

### 11-b 掃哪幾頁(**這一節只涵蓋這些,不是全站爬**)

```
第一層  /
第二層  /products/<任一商品>  ·  /brands/<任一品牌>  ·  /products  ·  /brands  ·  /stores
```
🛑 **沒掃的**:每一個品牌頁、每一張商品卡、頁尾深層、外部連結(`http…` 被上面那段刻意排掉)。
⇒ **要說「全站沒有死連結」,這一節【不夠】。**

### 11-c 🔴🔴 那四個假 404 —— **這不是缺陷紀錄,是【尺的失效模式】**

> **下一個人會用同一把壞尺,而這一節救的正是他。**

我第一輪從導覽列的**中文名**推英文路徑去打,四個全 404 —— 而**站是好的,壞的是我的網址**:

| 我推的 | 結果 | 而真正的 `href` 是 |
|---|---|---|
| `/new` | 404 | `/products?filter=new` |
| `/partners` | 404 | `/stores` |
| `/shipping-returns` | 404 | `/info/shipping` |
| `/contact` | 404 | 頁尾那個是**外部連結**,被 `startsWith('http')` 那行刻意排掉了 |

📌 **判別句(逐字帶走)**:
> **要斷言「某頁不存在」之前,那個網址必須是【從畫面上抄下來的】,不是【從名字推出來的】。**

🎯 而它的毒在於:**404 是一個看起來就是答案的回應**,不是一個錯誤 ⇒ 四筆假 404 讀起來像四個真缺陷。
🔵 **同族**:`docs/patterns/zsh-and-bash-traps.md` 那條「`2>/dev/null` 把『我問錯了』變成『答案是 0』」——
**兩者都是【我問錯了】被回了一個合法的值。**

### 11-d 這一節證不到什麼

- 只涵蓋 11-b 那幾頁的連結,**不是全站爬**。
- 只驗**到得了**(HTTP 200),**不驗那一頁的內容對不對**。
- 「即將上線」的空殼頁(`/install` · `/stores`)在這把尺下**是 200 ⇒ 算通** ——
  🛑 **「連結會通」與「那一頁有東西」是兩件事**,而這一節只答前者。
- 值不寫在這裡(照 §9 慣例)⇒ 要「上次長這樣」去 §9;**這一節的用途是【怎麼量】。**
