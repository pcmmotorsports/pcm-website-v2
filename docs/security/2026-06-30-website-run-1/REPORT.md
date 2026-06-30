# PCM 安全輕掃 L1 — #241 結帳同意條款 server 驗 + 同意紀錄

> 日期:2026-06-30 / repo:pcm-website-v2 / 層級:**L1 輕掃**(單 session 順序、非全站深掃)
> 觸發:slice 收尾命中敏感檔(migration / payment / RLS·GRANT / auth)→ 自動 L1。
> **誠實邊界**:本次 = L1 輕掃,只掃本 slice 攻擊面 + PCM 專屬攻擊類 + Obvious-things;**非全站完整滲透**(全站深掃 = L3、里程碑時跑)。

## 上層白話(給 Sean)

這次改的是「結帳同意條款」的安全補強(#241):客人沒勾同意也能刷卡的洞,前端早就擋了鈕,但**後台沒檢查** —— 有人繞過畫面直接打後台就能無同意成交。這次補上後台驗證 + 把「誰、何時、用哪個 IP/裝置、同意哪版條款」記成一筆不外洩的紀錄(供日後爭議舉證)。

**輕掃結論:乾淨,0 個新漏洞。** 駭客最可能下手的幾條路我都試過、都堵死:
- 偷看別人的同意紀錄(含 IP)→ 那張表對所有人(含系統角色)完全鎖死,程式也沒有任何讀它的路徑。
- 繞過同意直接刷卡 → 後台嚴格擋(只認 boolean true,字串/數字/物件都擋),且擋在「動到錢/建單之前」。
- 偷塞經銷價/成本進新資料 → 新表根本沒有價格欄,金額照舊用整數不用浮點。
- 把客人 IP 印進 log → 沒有,全程零 log。

這片之前已經過 4 道審查(Gemini + Codex 兩關 + 兩個 PCM 審查代理),本次 L1 是最後一道收尾確認。

## 下層技術(L1 攻擊類逐項)

| PCM 攻擊類 | 結果 | 證據 |
|---|---|---|
| 經銷價/成本洩漏 | ✅ 無 | 兩新表零 price/cost/price_by_tier 欄;create_order 取價 executable 逐字同 #214a(general-only);grep 命中的 `price_store` 為**既有 spec 黑名單防線**(migration:219、正面項) |
| 金額 float | ✅ 無 | 無新金額欄;沿用 integer/bigint + 溢位閘(executable 未漂移) |
| 會員 tier 偽造 | ✅ N/A | 本片不動 tier;`agreed` 為 consent 布林、不參與身分/算價;身分仍 `auth.uid()` server 權威 |
| RLS/GRANT default-grant 陷阱 | ✅ 無 | `service_role` 顯式 REVOKE 於 `legal_terms_versions`(:44)/`order_legal_consents`(:71)/create_order 8-param(:305);DO assert 驗 consent 表 grants=0 |
| SECDEF search_path | ✅ 硬化 | create_order `SET search_path = ''`(:88)保留;`relforcerowsecurity=false` assert 保證 owner 寫得進零 policy 表 |
| PII(IP/UA)外洩 | ✅ 隔離 | `order_legal_consents` RLS 啟用 + 零 policy + REVOKE ALL(含 service_role);零 `.from(order_legal_consents)` app 讀路徑;IP/UA 零 console/logger;generic catch 零原始 error 透傳 |
| client bundle 洩漏 | ✅ 無 | `terms-version.ts` 僅 `'use server'` charge-actions import(不入 client bundle);consent/IP 流向僅 placeOrderInput→mapper→RPC |
| agreed 不信任 client | ✅ | charge-actions `raw.agreed !== true`(嚴格、讀未 parse raw)、置於所有付款/建單/settle 副作用前;flag-on/off 負測斷言 7 函式全未呼 |
| 原子性(無單漏 consent / 扣款無單) | ✅ | consent INSERT 與 orders INSERT 同 SECDEF transaction;失敗整單 rollback;charge 在 create_order 之後 |

**Obvious-things**:本 slice 無新公開 route / 無 CORS·cookie·header 變更 / 新讀 header(IP/UA)僅 server action 內、不回應 client。

## Findings

**0 新 finding。** 既有可接受 NIT(深審期間已 triage、非本 L1 新增):
- F1(NIT):terms version + content_hash 雙處(`terms-version.ts` + migration seed)手動同步 bump;已用雙處 callout 緩解、無自動斷言。可接受、條款改版時注意。
- F2(NIT):`legal_terms_versions` 公開 SELECT —— 設計(version/hash 非 PII、FK 檢查需要)。無 PII。
- F3(deploy gate、非 code 缺陷):db push 後須 `generate_typescript_types` 重生兩表 Row 型別。
- 🔴 sequencing(deploy gate):code 期待 8-param、live 仍 5-param 未 push → **db push 在先、才驗 checkout**(prod 未部署 = 零影響)。

## 本次未涵蓋(誠實)
L1 輕掃只掃本 slice 攻擊面 + PCM 攻擊類 + Obvious-things。**未做**:全站 IDOR/枚舉重掃、依賴 CVE、其他子系統。全站深掃 = L3(里程碑/上線前)。

## 既往守門(本片信任度)
本片在 L1 前已過:Gemini 第二意見(scope/設計)+ codex 關卡1(FAIL→9 finding 全修)+ codex 關卡2(9 驗修對、zero-regression 乾淨)+ code-reviewer(PASS-WITH-NITS)+ adversarial-reviewer(PASS-WITH-NITS、6 攻擊向量全擊退)+ migration MCP `BEGIN..ROLLBACK` 零留痕全 PASS + 三綠 + 完整 vitest 1507。L1 為收尾確認,結論一致。

— END L1 —
