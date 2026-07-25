# M-1-13f Tabs Decision Packet

> **給 claude.ai 協助 Sean 做拍板決策用。**
> Sean 是 PCM 業務老闆、不寫程式、需要白話 + 業務語言評估三個拍板題。
> 你(claude.ai)的回應 Sean 會貼回 Claude Code(我)、我再按拍板執行。
> 本檔自帶所有必要上下文、你不需要 repo 存取。

---

## 一、Sean 是誰 / 我是誰

- **Sean**:PCM Motorsports 業務老闆。不寫程式、不看 git diff、不操作 dashboard 之外的 CLI。只拍板、看肉眼驗收。
- **Claude Code(我)**:在 Sean 本地電腦 repo 內操作的 agent。負責寫 code、跑 commit、跑測試。
- **Claude.ai(你)**:這次 Sean 把上下文丟給你、協助評估三個拍板題。

Sean 的決策原則:
- 兩層報告(白話 + 技術)
- Multi-select 選項(2-4 個)、禁開放式問題
- 「看不懂」觸發白話模式
- 容易改變主意(不質疑、對齊新方向)

---

## 二、Phase 1 大背景

**PCM Motorsports** 是 Sean 家的機車改裝零件電商。第一版網站(舊)有問題、現在用 Phase 1 重做。

**Phase 1 目標**:把 design 真權威字面直接上架、後台支撐 design、不做 9 大藍圖(那是 Phase 2)、前後台同步小步前進。

**design 真權威**:`design-reference/` submodule、是 Sean 在 Claude Design 做好的視覺成品(.jsx + .css)、Claude Code 必須 1:1 直接搬、不翻譯、不憑記憶。

**已完成里程碑**:
- M-0 ✅(基礎建設)
- M-1-01~12 ✅(首頁 / 列表頁 / 篩選器 / Header / Footer 等)
- M-1-13a~d ✅(商品詳細頁骨架 / breadcrumb / Gallery)
- M-1-13e-pre-1/2/3 ✅(tier helper / availability mapper / ProductCard 沒貨徽章移除)
- M-1-13e-a ✅(ProductInfo 補 pd-price-block + Buy row + Services + Mobile sticky bar)
- M-1-13e-b ✅(CartContext + useCart hook + 兩處 addToCart 接真實作 + Codex review 3 finding 全處理)
- **M-1-13e-b-2 ✅(剛剛完成、已 push):Header 紅點數字從寫死 4 改成跟真實 cart 同步**

**剩下還沒做**:
- **M-1-13f Tabs** ← 本次決策
- M-1-13g Related + Toast + Responsive(商品頁最後一段)
- M-1-14 Customer schema(會員資料表)
- M-1-15 LoginPage / RegisterPage
- M-1-16 200 SKU 種子(接 Supabase 真資料、解決現在的 mock 問題)

---

## 三、本次決策 — M-1-13f Tabs

### 要做什麼(白話)

商品詳細頁加 4 個分頁(對齊 design 真權威字面):

```
[商品介紹] [規格與相容性] [安裝須知] [保固與退換]
─────────────────────────────────────────────────
（點哪個就顯哪個的內容）
```

4 個分頁內容:
- **商品介紹**:廠商文案 + 5 條 features bullet
- **規格與相容性**:8 行規格表(品牌 / 型號 / 分類 / 材質 / 表面處理 / 重量 / 產地 / 適用車款)
- **安裝須知**:難度 / 工時 / 工具 + 4 步安裝步驟 + 「預約安裝」按鈕
- **保固與退換**:原廠保固 / 退換貨政策 / 聯絡我們 3 段

### 順手做一件事

ProductInfo 元件(商品資訊區、左右兩欄裡的右欄)已經 **341 行**、再加東西就破 400 行硬上限。

順帶把裡面的「服務區」(滿額免運 / 專業安裝 / 原廠保固 / LINE 諮詢 4 個小 icon)拆成獨立元件 `ProductServices`、ProductInfo 縮回 ~280 行回安全區。

(上輪 Codex AI review 已經提醒過要拆。)

---

## 四、design 真權威字面(quote、不要翻譯)

來自 `design-reference/components/ProductPage.jsx` L382-453:

```jsx
<section className="pd-tabs-section">
  <div className="pd-tabs">
    {[['description', '商品介紹'], ['specs', '規格與相容性'], ['install', '安裝須知'], ['warranty', '保固與退換']].map(([k, l]) => (
      <button key={k} className={`pd-tab ${tab === k ? 'is-active' : ''}`} onClick={() => setTab(k)}>{l}</button>
    ))}
  </div>

  <div className="pd-tab-body">
    {tab === 'description' && (
      <div className="pd-tab-pane">
        <div className="pd-desc-lead">
          {product.brand} 的 <em>{product.name}</em>,為 <strong>{product.fits}</strong> 專屬開發。
        </div>
        <p>採用航太級鋁合金 CNC 一體成型,表面經陽極處理後手工拋光,對應原廠螺絲孔位,無需修改車身結構即可完成安裝...</p>
        <p>每一件出廠前皆經過 3 道品管檢測,包含尺寸精度、表面處理附著力、以及螺紋扭力測試...</p>
        <ul className="pd-desc-features">
          <li>航太級 7075-T6 鋁合金 CNC 精密加工</li>
          <li>Hard Anodized 硬陽極處理,耐腐蝕耐磨</li>
          <li>對應原廠螺絲孔位,Plug &amp; Play</li>
          <li>包含安裝螺絲與扭力建議值說明書</li>
          <li>義大利原廠保固 24 個月</li>
        </ul>
      </div>
    )}
    {tab === 'specs' && (
      <div className="pd-tab-pane">
        <table className="pd-specs-table">
          <tbody>
            <tr><th>品牌</th><td>{product.brand}</td></tr>
            <tr><th>產品型號</th><td>PCM-{String(product.id).padStart(5, '0')}</td></tr>
            <tr><th>商品分類</th><td>{product.category}</td></tr>
            <tr><th>材質</th><td>航太級鋁合金 7075-T6 / CNC 加工</td></tr>
            <tr><th>表面處理</th><td>Hard Anodized 硬陽極</td></tr>
            <tr><th>重量</th><td>約 320g (單件)</td></tr>
            <tr><th>產地</th><td>義大利</td></tr>
            <tr><th>適用車款</th><td>{product.fits || '通用款'}</td></tr>
          </tbody>
        </table>
      </div>
    )}
    {tab === 'install' && (
      <div className="pd-tab-pane">
        <p><strong>安裝難度:</strong>★★☆☆☆(建議專業技師)</p>
        <p><strong>預估工時:</strong>30 – 45 分鐘</p>
        <p><strong>所需工具:</strong>T25 星型扳手、4mm/5mm 內六角扳手、扭力扳手</p>
        <div className="pd-install-steps">
          <div className="pd-install-step"><span>01</span><p>將車輛停放於水平地面,使用車邊架固定。</p></div>
          <div className="pd-install-step"><span>02</span><p>拆除原廠零件,保留原廠螺絲以備後用。</p></div>
          <div className="pd-install-step"><span>03</span><p>將新品對齊孔位裝上,螺絲依序分段鎖緊。</p></div>
          <div className="pd-install-step"><span>04</span><p>使用扭力扳手以 22 N·m 扭力完成最終鎖付。</p></div>
        </div>
        <div className="pd-install-cta">
          <div>
            <div className="pd-install-cta-title">需要專業安裝?</div>
            <div className="pd-install-cta-desc">全台 9 家合作店家,可直接預約安裝</div>
          </div>
          <button className="pd-install-btn" onClick={() => onNav('install')}>預約安裝 →</button>
        </div>
      </div>
    )}
    {tab === 'warranty' && (
      <div className="pd-tab-pane">
        <h4>原廠保固</h4>
        <p>本商品由 {product.brand} 原廠授權代理,提供 <strong>24 個月</strong> 保固服務...</p>
        <h4>退換貨政策</h4>
        <p>收到商品後 <strong>7 日內</strong>,商品保持全新狀態且包裝完整,可辦理退貨退款...</p>
        <h4>聯絡我們</h4>
        <p>LINE ID:<strong>@pcm-motorsports</strong> · 客服時間:週一–週六 10:00–20:00</p>
      </div>
    )}
  </div>
</section>
```

---

## 五、相關鐵則摘錄(claude.ai 評估三題的依據)

### 鐵則 1:design 是成品、直接搬、不翻譯
- design-reference 真權威、不憑記憶
- 字面 1:1 搬、不過早抽象

### 鐵則 4:Slice 15-45 分鐘可中斷
- 每個 slice 體積必須在 15-45 分鐘內完成 + Sean 可肉眼驗
- 超過 → 拆

### 鐵則 6:檔案大小硬上限
- 元件檔 >400 行必須拆
- 元件檔 >300 行硬警戒
- 目前 ProductInfo.tsx = 341 行(警戒)

### 鐵則 8:重大改動前先提 plan 等批准
- 跨 3 個以上檔案 / 動共用元件 / 動 schema → 重大
- 必先 plan、Sean 批准才執行

### 鐵則 9:內容分級 L1 / L2 / L3
- L1 = 每年 0-1 次變動 → hardcode 可
- L2 = 每季 1-3 次 → hardcode + backlog
- L3 = 每週多次 → **必須**後台 CRUD、發現 L3 立即停 slice 寫 PRD

⚠️ **本刀 L3 警示**:tab 內容(規格 / 安裝步驟 / 保固政策)真實業務每個 SKU 不同 + 廠商會頻繁更新 → 嚴格說屬 L3。

**但**:Phase 1 既定路線是「tab 結構先用 design 字面 mock 上架 → M-1-16 接 Supabase 種子 → 之後補後台 PRD」、NORTHSTAR 早就規劃好了。所以本刀**不在這個點停**寫 PRD、但 commit 會明確揭示這個遺留。

### 鐵則 12:重大改動 / 進度結束產 Codex Review Packet
- 重大改動 / 動 schema / pricing / security → 必跑 Codex AI 唯讀審查
- 本刀:動共用元件 ProductInfo + 新建 2 檔 → 命中
- **但**:純前台 mock 內容、無 schema / pricing / security → Sean 可拍板走例外跳過

---

## 六、storefront 現況數字

| 檔案 | 現在行數 | 13f 之後預估 | 評估 |
|---|---|---|---|
| ProductInfo.tsx | 341(警戒) | ~280(拆 ProductServices 後) | 回綠 |
| ProductPage.tsx | 257 | ~265 | 安全 |
| ProductTabs.tsx | 不存在 | ~230(新建) | <300 安全 |
| ProductServices.tsx | 不存在 | ~70(新建) | <200 安全 |
| Header.tsx | 152 | 152 | 安全 |
| CartContext.tsx | 167 | 167 | 安全 |

---

## 七、三個拍板題

### Q1:scope 拆法?(關係到鐵則 4「15-45 分鐘可中斷」)

| 選項 | 內容 | 估時 | 風險 |
|---|---|---|---|
| A | 一刀完整做完(ProductTabs + ProductServices 拆 + test) | **45-60 分** | 可能破鐵則 4 上限 |
| **B(我建議)** | 拆 2 小刀:13f-1 先拆 ProductServices(15-20 分純整理)+ 13f-2 加 ProductTabs(30-40 分新功能) | 各 15-20 / 30-40 分 | 對齊鐵則 4、兩刀各自獨立驗收 |
| C | 只加 tabs、ProductServices 拆推延 | 30-40 分 | ProductInfo 留警戒、之後撞 400 線再拆 |

**Claude Code 推薦 B**:對齊鐵則 4「可中斷」、Sean 中途可隨時喊停、每刀獨立驗收。

### Q2:tab 內容寫法?(關係到鐵則 1「直接搬」)

| 選項 | 內容 | 評估 |
|---|---|---|
| **A(我建議)** | 對齊 design 字面、長文案 / 規格表 / 安裝步驟 / 保固政策全 hardcoded 寫進 ProductTabs.tsx | 對齊鐵則 1「直接搬」、Phase 1 本來就是 mock、M-1-16 接 Supabase 再換 |
| B | tab 結構搬、內容抽到 data 檔(像 `data/tab-content.ts`) | 過早抽象、L3 真要後台時又得改一次、額外維護負擔 |

**Claude Code 推薦 A**。

### Q3:commit 前要不要請 Codex(第二個 AI)審?(關係到鐵則 12)

| 選項 | 內容 | 時程影響 |
|---|---|---|
| **A(我建議)** | 跳過(純前台 + 無敏感邏輯 + 結構單一拆元件、走鐵則 12 例外) | 0 |
| B | 跑 Codex review(動共用元件 ProductInfo 保守為上) | +10-15 分鐘 |

**Claude Code 推薦 A**:本刀無 schema / pricing / security 風險、純前台 mock、Codex 對這種 diff 通常找不到實質 finding(上輪 13e-b 找到的 P1/P2 都是 state schema / API 層、不在本刀範圍)。

---

## 八、Claude Code 整體建議

**Q1=B / Q2=A / Q3=A**

理由:
- B 對齊鐵則 4「可中斷」、各刀有獨立驗收價值、Sean 可中途調整方向
- A 對齊鐵則 1「直接搬」、不過早抽象(M-1-16 才會接 Supabase、抽 data 檔此刻無收益)
- A 跳 Codex、本刀低風險、節省 10-15 分鐘

---

## 九、給 Claude.ai 的提問框架

請以業務角度評估這三題、幫 Sean 做最後拍板。重點考慮:

1. **時程**:Sean 今天還想做多少?(分 2 刀的話、13f-1 + 13f-2 共 ~60 分、可能跨 session;一刀做完 45-60 分可能今天就完。)
2. **L3 警示**:tab 內容真實業務屬 L3(廠商會頻繁編輯)、Phase 1 走 mock + M-1-16 種子是既定路線、但**業務上 Sean 是否仍想在 M-1-16 前就做後台?**(這會推翻原路線、影響整個 Phase 1 排程)
3. **Codex 跳 vs 跑**:上輪 13e-b 跑 Codex 找到實質 finding(P1 / P2)、本刀風險評估真的可以跳嗎?

請回覆格式:

```
Q1: A / B / C(理由 1-2 句)
Q2: A / B(理由 1-2 句)
Q3: A / B(理由 1-2 句)
(可選)整體建議 / 警示 / 補充
```

Sean 會把你的回覆貼回 Claude Code(我)、我按拍板執行。
