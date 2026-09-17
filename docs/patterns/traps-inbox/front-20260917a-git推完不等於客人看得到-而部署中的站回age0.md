## `git push` 完成 ≠ 客人看得到 —— 而部署中的站回 `age: 0` / `cache MISS`〔安靜〕

**線** `front` 2026-09-17 13:41 · FF main 之後的上線驗收 · **自述(這一次它真的擋下了一發)**

### 事情

主視窗 13:41:15 推完 main,給我線上那顆 sha `f1a1d43eb`,並說「顧客站上線」。
那句話**是真的** —— `git rev-parse origin/main` 確實是它。

而我照驗收腳本檔頭那道閘,去拿**Vercel 實際在服務的那顆**:

```
dpl_3SY5DAMf9M9gR83gev6a6uNwy138 · target=production · sha=f1a1d43eb · 🔴 state=BUILDING
dpl_GSZ5yHwRsckdBRfwfz4DzDnF58o1 · target=production · sha=539483d2c · state=READY  ← 在服務的是這顆
```

🔴 **git 那一端推完了,而客人拿到的還是舊版。** 兩個讀數都是真的,**而只有一個是「客人現在看到的」**。

而同一時刻打首頁的 header 長這樣:
```
age: 0
x-vercel-cache: MISS
```
📌 **看起來是全新的回應 —— 而它服務的是舊版。**
`age` 與 `cache` 講的是「這一發有沒有走快取」,**跟版本無關**。

實際時間差:推完 13:41:15 → `readyState=READY` 13:42:50 ⇒ **95 秒**。
在那 95 秒裡跑驗收,三格會全部顯示「沒生效」⇒ 然後有人去查一個不存在的 bug。

### 🎯 母題

**「我做完了」與「它到了」是兩個不同的系統回答的,而我們習慣只問前一個** ——
因為推完的人**手上就有那個答案**,而部署完成要另外去問別人。
🔴 而快取 header 會**主動給你一個看起來像答案的東西**(`age: 0`),讓你覺得不用再問。

### ✅ 可機械執行

> **量線上行為之前,先拿【部署平台說 READY 的那顆】,不是 git 那一端的 sha。**
> 三步,順序不能換:

```bash
# ① 部署平台:那顆 target=production 的 readyState 是不是 READY
#    (Vercel MCP get_deployment / list_deployments;看 readyState 與 alias 有沒有正式域名)
# ② 修法在不在那顆裡 —— 逐顆核,不要核「最新的那顆」
git merge-base --is-ancestor <修法commit> <READY那顆的sha> && echo 在裡面
# ③ 兩關都過,才跑驗收
```

🛑 **不得用下列任何一個當「新版本上線了」的證據**:
```
age: 0          x-vercel-cache: MISS        剛剛才推完
頁面秒開         我重新整理過了               git rev-parse origin/main 是新的
```

🔵 **而「行為變了」可以當【看一眼的時機】,不能當結論** ——
我這一次是用 `curl /index.html` 是否回 308 當輪詢條件,**回 308 之後仍然去問 Vercel 拿 READY 才開跑**。

### 📎 鄰居
- canonical「`age:0` / cache MISS 不等於新版本 —— 推完要等部署真的完成再量」
  (2026-09-16 同一頁 02:16 量 0/9、02:27 量 9/9)—— 🔵 **同族,而本條補的是【95 秒的實測值】與
  「兩個讀數都是真的」那一層**:0916 那次是自己量早了,這次是**別人給了一個真的 sha,而它不是客人看到的那顆**。
- canonical「前後量測要有對照組,否則把環境漂移當成自己的成果」—— 同一片驗收的另一半。

### ⚠️ 這一條證不到什麼
- 95 秒是**這一顆**的建置時間,不是通則。下一次可能 3 分鐘。⇒ **不要把它寫成 sleep 95。**
- 我**沒有**驗過 Vercel 的 `readyState=READY` 到「全球每個 region 都換版」之間還有沒有落差。
  這一次只有 `sin1` 一個 region(`regions: ["sin1"]`)⇒ **多 region 的站本條射程未知。**
