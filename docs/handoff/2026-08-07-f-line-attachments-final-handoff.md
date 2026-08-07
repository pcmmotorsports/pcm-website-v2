# 交接給網站側:官方文件 / 影片 / 聲音的正名(報價單側已完工)

> 來源:報價單施工窗(F 線)· 到:pcm-website-v2 主視窗 · 日期:2026-08-07(Sean 轉貼,主視窗逐字落檔)
> 🔴 **本檔=合約 v5 口徑,推翻先前 v4 的 type_id 對照規則**(v4 記錄在 memory `project_product-attachments-relocation-line`,已標過期)。
> 本檔是自足的,不必先讀其他檔;細節查報價單 repo `docs/STOREFRONT_CATALOG_CONTRACT.md` v5(真身在 mac mini,本機 clone 讀前必 fetch)。

## 0. 一句話

報價單側全部完成、已上正式庫。你們照 doc_type 給中文名就好,其他都不用管。

## 1. 這件事在解什麼

賣場商品頁的說明書標籤原本按數量硬編(normalizeManuals:1 份叫「安裝說明書」,多份叫「安裝說明書 1…N」),與內容無關。akrapovic 平均每群 4.8 份、最多 12 份 → 客人看到 8 個「安裝說明書」,其中只有 1 份真的是。這不是缺欄位,是錯誤標示。

## 2. 你們要做的事(就這一件)

storefront_catalog_v 第 29 欄 pdf_docs:

```json
[
  {"doc_type": "install",       "type_id": 90,   "url": "https://…/xxx.pdf"},
  {"doc_type": "parts_diagram", "type_id": 87,   "url": "https://…/yyy.pdf"},
  {"doc_type": "other",         "type_id": 106,  "url": "https://…/zzz.pdf"},
  {"doc_type": "install",       "type_id": null, "url": "https://…/1198 2007-2013.pdf"}
]
```

| doc_type | 中文名 |
|---|---|
| install | 安裝說明書 |
| parts_diagram | 零件分解圖 |
| other | 文件 |

🔴 **只看 doc_type。不要看 type_id、不要自己解析檔名、不要沿用舊的按數量編號。**

type_id 只有 akrapovic 有值,其餘全是 null。它留著只是給你們做細部排序,拿它判斷文件種類會讓五家七千多份說明書全變成通稱,比現在更糟。

過渡期寫法:`const kind = doc.doc_type ?? "install";` —— 不要把「沒有 doc_type」當成缺資料而整列 reject。

## 3. 顯示分組(Sean 拍板)

| 區域 | 放什麼 |
|---|---|
| 主要區 | doc_type == "install"、doc_type == "parts_diagram" |
| 收合區「文件」 | doc_type == "other" |
| 收合區最後一項 | type_id == 110(多國語言合訂本,62-74 頁) |

同一類多份怎麼區分:gbracing / evotech 接檔名(例:「安裝說明書(1198 2007-2013)」),因為它們的多份是不同車款的同一種文件。🔴 **akrapovic 不要接檔名** —— 它的檔名是 GUID,會變成「文件(ffdd4e47-…)」。

## 4. 影片與聲音

- **影片(video_urls)**:統一叫「安裝/示範影片」,多支加編號。不要從檔名生成名字 —— 五家的影片不是亂碼 hash 就是純 YouTube/Vimeo 連結,沒有可翻譯的東西。
- **排氣聲(sound_clips,[{title, url}])**:只有 akrapovic,364 群。title 是英文原文未翻譯,中文化你們做(原廠排氣 / 含消音塞 / 不含消音塞)。⚠️ 分隔符逗號分號並存、約 4% 沒有標題。檔案 645 個 .wav + 252 個 .mp3,WAV 很大,**不要 autoplay/preload**。

## 5. 🔴 時間差:合約已改、資料未到

doc_type 要等各家 fetcher 下次跑過才會出現。2026-08-07 21:00 實查:akrapovic 的 635 列仍沒有 doc_type,其餘五家的 pdf_docs 還是 null。

**生效 = 2026-08-08 03:30 排程跑完之後。** 在那之前可以寫 code 但測不到 doc_type,照 §2 的 `?? "install"` 就會維持現狀。

## 6. 🔴 這不是只有 akrapovic —— 全站 19,248 群 / 50,687 列

| 供應商 | 商品群 | 有文件 | 多份(會被錯標) | 有影片 | 有聲音 |
|---|---|---|---|---|---|
| lightech | 4,566 | 2,019 | 50 | 0 | 0 |
| evotech | 3,532 | 862 | 73 | 1,458 | 0 |
| cncracing | 1,983 | 1,011 | 103 | 55 | 0 |
| eazigrip | 1,687 | 0 | 0 | 0 | 0 |
| samco | 1,403 | 0 | 0 | 0 | 0 |
| rpm | 1,118 | 0 | 0 | 0 | 0 |
| kspeed | 960 | 0 | 0 | 57 | 0 |
| gbracing | 944 | 726 | 150 | 0 | 0 |
| motogadget | 913 | 0 | 0 | 0 | 0 |
| extreme | 667 | 0 | 0 | 0 | 0 |
| akrapovic | 648 | 635 | 572 | 0 | 364 |
| bonamici | 592 | 431 | 0 | 16 | 0 |
| front3d | 112 | 0 | 0 | 0 | 0 |
| ebc | 68 | 0 | 0 | 45 | 0 |
| materya | 55 | 0 | 0 | 0 | 0 |
| **合計** | **19,248** | **5,684** | **948** | **1,631** | **364** |

⚠️ **不要只做 akrapovic** —— 會被錯標的 948 群裡它只佔 572。gbracing 那 150 群現在也是「安裝說明書 1、2、3」,而且它的多份是不同車款,客人根本挑不出自己那台。

- 完全沒附件的 7 家(eazigrip / samco / rpm / motogadget / extreme / front3d / materya,合計 5,554 群):pdf_docs 是 null,請確保走現行邏輯、輸出 byte 不變。
- ebc 的文件是**刻意不給客人的**(fetchers/ebc.py:19 明寫),它只有影片。不要去「修」。
- bonamici 每群只有 1 份,不會標錯,但有 431 群會拿到 doc_type。

## 7. 你們要注意的

- 網站 products 表要加 sound_clips,走「欄 + GRANT + products_public view append」三件套。
- 🔴 **附件欄變 null 時不可以寫成空陣列**。你們現行 importer 會寫 manuals=[],那等於一次官方 API 暫時失敗就清光客人的全部說明書。這三欄會因官方詳情 API 暫時掛掉而整批變 null、隔天自癒。⇒ **來源為 null 時不要覆蓋既有值。**
- pdf_docs 的 URL 串與 pdf_urls **完全相等(建構上必然)**。兩欄擇一,**絕對不要合併** —— 合併會讓每份文件出現兩次。

## 8. 報價單側的驗證(供你們判斷可信度)

- migration 套用前跑交易模擬並 ROLLBACK 驗零留痕;套用後既有 28 欄 md5 逐位相同(50,687 列)、anon 實讀無 42501。
- akrapovic 回填已實跑並事前/事後對帳:四價與中文欄位逐位未動、蝦皮總和 24,241,800 未動。
- pytest 2029 綠。
- 四輪對抗審查(opus ×2 + codex 換角度 + Fable 終審):2 blocker + 20 餘條 must-fix 全折入,其中三次是「前一輪宣稱修好、其實沒修好」。
- 全鏈路巡檢四線平行:爬蟲線寫比對腳本實測 15 家 51,475 列 0 行為差異;報價單 app 三綠全過;LINE 線抓到一個破口已修。
- ⚠️ 空庫重建演練未跑(Mac mini 無 Homebrew/PostgreSQL,Sean 拍板跳過並記錄)。
