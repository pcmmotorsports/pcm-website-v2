# Q5 獨立分析:可取消量公式 vs shipped(2026-08-07,fable fresh context)

> 背景:master plan §5.2 工作項 2 開工前置「先取得主視窗另委的獨立分析結論(B-31-A ②)」。前兩輪分析(B 窗×2、主視窗×1)全被證偽,本輪 fresh context 只餵事實面。結論=**公式不改**;W3b 條件片撤銷(B-170-A)。

## 四小題結論(全文=分析代理原文)

1. **現行公式**(`20260805100000` 錨=`可取消量守門`):增量 ≤ `quantity − instock − cancelled`;instock=Σ receipts 真相表直讀;**不讀 shipped**;整單取消=任一到貨即拒。
2. **S2b 後取消已出貨品項**:已出貨必有到貨 ⇒ instock ≥ shipped ⇒ 公式右邊已扣掉出貨部分 ⇒ **RPC 步 8 直接拒,走不到 CHECK**;C9/C6′=backstop。「instock<shipped 的已提交狀態」在 trigger 通電下構造不出來(刪 receipts 當場 23514)。唯一殘洞=break-glass 不照單一交易程序拆跑=既有誠實邊界。
3. **不改的員工代價**=僅訊息層:拒絕訊息不會說「其中 N 件已到貨/出貨要走退貨」——08-05 拍板已知代價,屬 writer RPC 片訊息層射程。
4. **若改=重複扣**:quantity=10、到貨 6、出貨 4 ⇒ 正確可取消 4,改式後 0。與 master plan `:421-425`「它就是正確式」+`:600-602` 終案(Sean 08-05 Q1=A/Q2=A)字面一致。連鎖面(若硬改):新增 shipments↔order_items 交叉鎖面、40P01 重分析;冪等語意不變;UI 自算處查無(未窮舉,標未確認)。

## 效力
- 「shipped 恆為 0」不得再當理由(前提失效);正確理由=**instock 已涵蓋 shipped**。
- 本檔清償 master plan 開工前置;動公式=推翻 08-05 拍板,需 Sean。
