# Gemini 第三眼審查 — M-3 3DS 乙路退款版金流系統流程(2026-06-24)

> **方法**:Gemini CLI(`--approval-mode plan` 唯讀、零留痕已驗)對 canonical plan v9(`docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md`)全文 + 現行 storefront 結帳/購物車 UX 事實 + PCM 業務約束做兩輪審查(Pass A 正確性/資安/操作、Pass B 客戶端 UX);findings 再經 Claude 11-agent fresh-context triage 對照真實 plan + code 逐條驗證接地。
>
> **定位**:Gemini = 廣度第三眼、**非正確性背書**(PCM 規矩 `feedback_gemini-breadth-third-eye`);本檔為「已 triage 接地版」,Gemini 未看到 plan 已有設計的誤報已過濾。
>
> **觸發**:Sean 要求「請 gemini 檢查系統流程正確性、是否與世界大間購物網站金流設計比較後無資安/操作問題,尤其客戶端 UX」。

---

## 1. 一句話結論

Gemini 把這套 3DS 放棄交易 / 雙扣防護流程從正確性、資安、操作、UX 四面掃過,**沒抓到任何「會錯扣錢、會洩經銷價、會卡死訂單」的真破口**。9 條 finding:4 條是對既有設計的肯定或已建檔、5 條是 partial 殘餘小缺口,其中**只有 1 條(主動告警)真值得在開放真實結帳前補**,其餘為 UX 文案 / 報表便利可延後。triage 另挖到 1 條比 Gemini 更該優先的真缺口(#241)。**結論:後端可照計畫往下開工,不阻擋;UX 與告警類放在「prod 開放結帳前」這道關卡補齊即可。** Gemini 可上線判斷 = 有條件 YES。

## 2. Gemini 確認的優點(防禦縱深 / 設計贏過劣質電商)

- **「放棄不清車、立即可重買」被 Gemini 點名「巧妙避險」**:選 `released` 狀態 + 立即重刷建新單,而非 Stripe 式同 PaymentIntent 多 Attempt —— 因為 TapPay **沒有主動殺 pending 3D 的端點**(plan 附錄 A),是務實取捨非疏漏。late-success 由 `released` 留對帳集自動 `markCharged` 捕捉,杜絕舊 3DS 非同步回呼變幽靈扣款。
- **防雙扣縱深成立**:owner-only claim CAS(平行只一人能退)+ fail-closed(退款結果不明 → 維持 `refunding`、寫稽核 event、進人工、不得再退)+ append-only event 表(軌跡全留)+ cart session dedup key(成交才換 key、模糊態保留 key)。
- **資料層權限「甚至比許多大廠內部子系統還嚴苛保守」**:`payment_confirmer` 零 table 權限只走 SECDEF RPC、`search_path=''`、兩表 RLS zero-policy、event 表不給 UPDATE/DELETE —— 單人/小團隊情境下極佳防禦縱深,大幅防提權/IDOR/竄改。
- **不誤判 failed**:`record_unreachable` 的 pending 被當「可能已扣款」處理,不會把可能收了錢的單錯標失敗。

## 3. 真新增、值得做的(new-actionable)

### 上線前必補(1 條)

**[A5] 雙扣 anomaly 缺「主動推播告警」這條腿 — 真實嚴重度:中 → backlog #250**
- 偵測與資料事件齊全(`released→charged` 同交易建 anomaly §4 R1b1c),報表也定義 SLA/責任人欄(§7 W1),**但整份 plan grep 不到任何 email/Line/Slack 推播**。W1 是 pull-based(「有空才查報表」),§14 step45 監控指上線後 flag-rollback 運維,非雙扣客訴黃金期的營運推播。雙扣發生時 Sean 不會被通知。
- 建議:open anomaly 出現 / refunding 卡逾 SLA → 自動發 email/Line/Slack。實作沿用既有 settle-sweep cron pattern,**不必動 RPC 安全層**。Sean 決策題:報表 only vs 報表+推播(傾向 +推播)。
- 守則:Sean 決策、Claude 不自宣接受。罕見雙扣窗 + 上線前全程 flag=false → **非「今天改 code」,是「開 `TAPPAY_3DS_ENABLED=true` 前該補的營運就緒項」**,折入 anomaly/refund PRD(§14 step11-12)。

### 可延後 backlog(2 條,均 partial-gap、low,併入 #250)

- **[A1] refunding 卡住缺自動時間告警**:plan SLA 是「報表欄 + 人工 queue」(pull),無「refunding 卡 >2h 主動 push」→ 與 A5 同一條 cron 合併。**明確否決** Gemini「把 auto-refund API 提前」= 與 §0 Q1 拍板衝突,為罕見路徑提前自動化是反決策過度投資。
- **[A2] stuck record 缺一張固定查詢**:plan 的非終態+持續對帳已消除真「幽靈/卡死」(released 是 continue-retry 非 terminal),但 W1 報表嚴格只列 `status='open'`,不涵蓋 `released_manual_review_at` / 連續 `record_unreachable` / 12h 孤兒這些死卡列;plan 只寫成欄位/旗標、未指定誰用什麼介面看見 → W1 同片加一條 owner-run 固定 SQL,**不新增表、不動 RLS**。

## 4. 其實計畫/程式已涵蓋的(讓 Sean 安心)

| Finding | Gemini 擔心 | 真相 | 出處 |
|---|---|---|---|
| **A3** 訂單碎片化 | 跳號/廢單累積/報表失真 | 已建檔已實作:會員側已藏 unpaid 孤兒(commit `ff79534`,`SupabaseOrderAdapter.ts` `.neq unpaid`);治本=#249、admin/CS 清理=#225 | #249 / #225 / plan §2.3 |
| **A4** 冪等取捨 | 「放棄即 released、重刷建新單」有無隱患 | Gemini 自己標「巧妙避險」=正面肯定,非缺口;為此而生的 late-success/雙扣明確化整套 §2.2/§2.5/§2.6/§7 | plan §2.1-2.6、§10.10-10.11 |
| **B2** popup 被擋 | 使用者卡死胡同 | 已涵蓋:§6.4 整頁 fallback(`window.location.assign`)+ backlog #239 逐字對應(預解安全陷阱:button onClick、token 零入 DOM) | plan §6.4、#239、`CheckoutRedirecting.tsx` |
| **B5** 焦慮文案生硬直譯 | 後端六態被生硬直譯嚇客人 | 假設與事實不符:現行文案已客服口吻防雙扣(`charge-actions.ts` MESSAGES、FAILED「已被扣款請保留單號聯繫客服」),callback 已內建「不斷言已收款」反恐慌守則 | plan §13 D3、`charge-actions.ts`、`callback/page.tsx` |

**partial 殘餘小缺口(已處理但有尾巴,均 low、可延後)**:
- **B1 手機/popup 返回橫幅**:安撫四要素前三者已在 callback 落地頁交付;唯一未排=「橫幅顯示在 /cart 頂端而非 callback 頁」UI 落點偏好(CartView 無 inbound notice slot)。design-reference 無此橫幅、要做須走 §9 A3 business override → 併 §13 D3 待決,不升嚴重度。
- **B3 條款 Modal**:屬實但非 canonical plan 範圍;`href="#"` 是 design-reference 本身寫法(忠實搬運)→ backlog #235。**真正上線前要補的是緊鄰的 #241(同意 checkbox 未勾仍可刷卡 + 無 server 驗,法律舉證缺口)** → 上線前精力放 #241,條款 Modal 維持 P2。
- **B4 購物車信任 icon**:基礎已在(`line.fits` 適用車型逐行 + 「原廠正品/國際空運入台」信任區塊);Gemini 建議的新增 icon 是 design-reference 未定義視覺 → 依鐵則 1 + 「Sean 掌舵視覺設計」屬 Sean/Claude Design 職責,施工 session 不主動加;記轉換優化候選。

## 5. 上線前必補 清單(prod 開放結帳前 gate、非阻擋後端開工)

1. **[A5 / #250 — 中]** open/refunding anomaly 主動推播告警(email/Line/Slack),沿用 settle-sweep cron;Sean 決策:報表 only vs 報表+推播。→ 折入 W1/anomaly PRD 上線就緒 gate。
2. **[#241 — 高]** 結帳「同意條款 checkbox 未勾仍可付款 + 無 server 端驗」= 法律舉證缺口 + 違反「不信任 client」鐵則 → 上線前精力優先(B3 條款 Modal 連結反而可延後)。
3. **[A1/A2 合併入 #250 — 低]** refunding 逾 SLA 告警 + stuck record 固定查詢(同 cron/SQL pattern)。
4. **[UX 文案 D3 — 低]** A1/A2/A3 三事件 + fallback 焦慮文案、B1 /cart 橫幅落點、B5 六態客服口吻改寫稿、B2 手動 CTA 文案 → 全歸 §13 D3,等 A1/A2/A3 實作時 Sean 一次拍板(避免現在改字面又被 D3 推翻)。
5. **[B5 文案分流設計點 — 低]** 文案須依 settle outcome 分流:`released-failure`/`record_unreachable` 等 hold 態寫「請稍候不要重下」,成功 release 後寫「鼓勵立即重買」,兩者語意相反 → 記入 PRD。

## 6. 不阻擋當前進度

這 9 條 finding **沒有一條阻擋現在 R1a1 開工**(真錢後端先做):
- 全功能上線前全程 `flag=false`(§14 step41-44),現在零真實刷卡流量 → 孤兒堆積/雙扣告警都不是當前 production 風險。
- 唯一「中」嚴重度的 A5 綁「開 flag 那一刻」、不是「今天的 code」;A1/A2 同 cron 可一起做。
- UX/文案(B1/B3/B4/B5/D3)全是 L2 文案層,plan 本來就刻意延後到 §14 後段由 Sean 拍板。
- 唯一獨立於 3DS 的真合規項是 #241,但它也 gate 在「開放結帳前」、不擋後端真錢 R1a1。

---

## 附錄 A — Gemini Pass A 原文(正確性/資安/操作)

【整體評價】這個金流設計在資料庫層級的併發控制(CAS、Row Locks)與權限隔離(SECURITY DEFINER、Zero-policy RLS)上展現極高工程水準,防禦縱深甚至超越許多中型電商的預設實作。面對 TapPay 缺乏「即時取消未請款 3D 授權」API 的現實限制,採用「釋放鎖定(Released)+ 允許立即重刷 + 嚴格的遲延成功(late-success)捕獲與雙扣對帳」是極具務實精神的架構妥協,絕對具備上線的技術基底。

【關鍵風險】
- 高 | 退款人機切換的狀態不一致風險(§7):退款需人工跳出系統去 TapPay Dashboard 執行,「人機邊界」無法被程式絕對鎖死(退款成功忘了回系統 resolve、或 Dashboard 手抖點兩次)。建議:refunding 卡超過 2 小時告警 + 自動退款 API 提前。
- 中 | TapPay Record API 回應遺失導致永久卡死(幽靈化)(§2.2/§8):需確保營運端有明確介面/報表看見 record_unreachable / needs_manual_review=true 死卡。
- 低 | 訂單號因重刷快速消耗與碎化(§2.3):建議定期 unpaid 廢單清理排程,或會員/客服後台完全過濾隱藏。

【與大廠的具體差距】狀態機與重試(大廠同 PaymentIntent 重試不換 Order ID;本計畫放棄即 released、重刷建新單較笨重但乾淨隔離=巧妙避險)/ 防呆與自動化閉環(大廠退款全 API 自動,本計畫依賴人工 Dashboard=最明顯斷層)/ 資料庫權限設計甚至比許多大廠內部子系統還嚴苛保守(優秀防禦縱深)。

【可上線判斷】有條件 YES。條件:① 完全遵照 §14 的 45 步 Rollout Gate;② 營運端對 status=open / status=refunding 異常建主動推播通知(不能只靠查報表);③ 自動退款 API 盡速排入近期 Roadmap。

## 附錄 B — Gemini Pass B 原文(客戶端 UX)

【整體 UX 評價】三步驟結帳 + 「放棄後保留購物車、立即重刷」的防錯設計,大幅超越台灣許多「3D 驗證一失敗就清空購物車」的劣質電商,非常適合高單價重機改裝品。但過度嚴謹的系統狀態機若直接轉成生硬前台提示,極易在「最後一哩路」引發買家恐慌、客服爆線,必須用高溫度文案與視覺安撫包裝。

【會傷轉換率/最該修的點】
- 高 | 手機版 3D 跳轉與回傳的「視覺斷層」:導回購物車時頁面頂端強力顯示橫幅(銀行驗證未完成、尚未扣款、購物車已保留、隨時可重新結帳)。
- 高 | 彈窗被攔截死胡同:CheckoutRedirecting 要有 fallback CTA「如果視窗沒自動開啟,請點此繼續前往銀行驗證」。
- 中 | 假條款(no-op)引發信任危機:上線前至少放簡易真實條款、用 Modal 呈現、禁跳轉離開 /checkout。
- 中 | 購物車缺車友最在乎的信任標籤:加「適用車型保障/100%規格核對」icon。

【文案具體改寫建議】(降焦慮、防重複點擊;原文→建議)
- processing:「銀行正在連線確認中!請稍候,系統將自動更新結果。為避免重複扣款,請先不要關閉視窗或點上一頁。」
- unknown:「銀行回應暫時塞車了。請放心,我們正在後台努力與銀行對帳中!為避免雙重扣款,請先不要重新下單。可稍候至會員中心查看,或聯繫客服。」
- wait:「發卡銀行暫時拒絕了這筆交易(可能額度或安全管控)。系統將暫停 10 分鐘。建議:1. 稍後換卡重試 2. 致電銀行開通後再結帳。」
- in_flight:「您有一筆付款正在驗證中!為保護您的錢包避免重複扣款,請先完成前一筆。若剛關閉銀行視窗,約等 10 分鐘後即可重新結帳。」
- 離開事件(取消/關閉):「驗證似乎已中斷。別擔心,商品還在購物車裡!準備好時隨時可重新結帳。」

【Phase 1 上線前的 UX】必補:3DS 過場頁防呆按鈕 / 手機跳轉回原頁 Toast 提示 / 基礎條款 Modal / 套用文案改寫。可延後:會員中心訂單詳情頁 / 結帳頁 inline 新增地址 / 前台自動退款進度顯示。

> 註(triage 校正):上述「必補」中,popup 防呆按鈕 plan §6.4 已 auto-redirect 涵蓋(B2);手機橫幅/文案改寫歸 §13 D3 延後由 Sean 拍板;條款真正優先項是 #241(server 驗)非 Modal 視覺。詳見本檔 §4-§5。

— END —
