# chain5 2×2 驗收證據(a207be42 / dev 052c72b3「#618 候選4 收成」的那個 0/3)

> 收割窗 merge body 那句「下一任若要引用『修好了』,請先向 T 線要那個 0/3」的回答就是本目錄。
> 12 支 `.txt` = 當晚 vitest 完整輸出(副檔名刻意非 `.log`,`.gitignore:49` 有全域 `*.log`)。

## 一句話結論

改寫前形狀(async factory + importActual)在 race+冷快取下 2/3 run 命中(=harness 活著的正向對照);
兩種改寫後形狀(sync+字面 / top-level await vi.hoisted)同條件 0/3。「跑起來綠」不算數,這個前後對照才算。

## 格子與數字(每格逐支列,量法在下)

| 形狀 | race+冷 ×3 run | race+暖 ×1 run | serial 兩格 |
|---|---|---|---|
| old(改寫前:async factory+importActual) | **2/3 命中**(run1、run2 各 1 發 THREW requireEnv;run3 乾淨) | 0/1 | serial+冷 0/3、serial+暖 0/1(chain3 探針階段量的,同形狀) |
| sync(order-shipments 改寫後形) | **0/3** | 0/1 | 🔴 未跑(見誠實邊界) |
| hoist(shipment-launcher 改寫後形) | **0/3** | 0/1 | 🔴 未跑(見誠實邊界) |

- 每 run = 50 發 `vi.resetModules()` 重複首解析;race=同 tick `Promise.all` 雙路徑 import;
  冷=每 run 前 `rm -rf node_modules/.vite/vitest`。
- 命中判準=run 內任一發:被測模組拿到真 dep(THREW requireEnv)/ 投影常數錯值 / 掛住。

## 量法(可對本目錄檔案重跑)

```sh
for f in docs/probes/2026-08-17-chain5-2x2-acceptance/chain5-*.txt; do
  printf '%s failed=%s threw=%s\n' "$f" "$(grep -cE 'Tests .* failed' "$f")" "$(grep -c THREW "$f")"
done
```

落筆當下輸出:old-1/old-2 各 failed=1 threw=1,其餘 10 支全 0。

## 誠實邊界

- 「2×2」的完整四格只對【old 形】齊(serial 兩格在 chain3 探針階段跑的);兩個新形只跑了
  race 列(冷×3、暖×1)——**race+冷正是唯一量到過命中的格**,新形在該格 0/3 即為
  「改寫關掉了那扇窗」的證據;新形的 serial 格未跑,屬「從未見過命中的格」的省略,標明不假裝。
- 探針=拋棄式檔鏡射三種 mock 形狀(跑完已刪);不是對真檔跑的——真檔改寫後 35 格綠+
  drift-pin 負測(真值 500→501 紅)在 a207be42 body。
- 非決定性本身:old race+冷 run3 也乾淨(2/3 不是 3/3)——0/3 的解讀是「同條件下打不出來」,
  不是「不可能」;樣本各 3 run。

## 檔案對照

chain5-old-{1,2,3,warm}.txt / chain5-sync-{1,2,3,warm}.txt / chain5-hoist-{1,2,3,warm}.txt
(-1..-3=race+冷三 run;-warm=race+暖一 run)

## 附:那 23 支「刻意不動」的分類(2026-08-18 凌晨補;主視窗指示寫進本檔、不另開載體)

分母修正自首:清單初版 24 支——多塞了 line/callback/route.test.ts(async factory 但零
await,從不在真 await 25 裡),對帳抓到,正確=25−已修 2=23。

**判準(可重跑)**:堆①=檔內有「同 tick 雙路徑首解析」形=`grep -c "Promise\.all"` 或
`grep -cE "(const|let) [A-Za-z_]+ *= *import\("` 任一 >0;依據=本目錄 old 形唯一命中
條件(race=同 tick Promise.all 雙路徑;serial await 實測 0/3)。
**結果:23/23 兩 grep 全 0 ⇒ 堆①=0、堆②=23。堆②=「今天量不到」,不是「不受影響」。**

**🔴 原判準只涵蓋【檔內】。跨檔那條路(兩支乖檔同 worker 併發首解析同一模組)另行量過,
結論=在本 repo 現行設定下【不存在】**:
- vitest.config.ts 無 pool/poolOptions/isolate/fileParallelism/maxWorkers 任何鍵
  (數法=`grep -nE "pool|isolate|fileParallelism|maxWorkers" vitest.config.ts` ⇒ 0 行)。
- 實驗(chain6,拋棄式已刪):共享模組於初始化時 appendFile 自記 pid;兩支測試檔
  static import 它;installed vitest 4.1.5 預設下跑兩檔 ⇒ **2 次 init、2 個不同 pid**;
  加 `--no-file-parallelism`(強制不並行)⇒ **仍 2 次 init、2 個不同 pid**。
  ⇒ 每支測試檔各自一個 fork 行程,跨檔連【行程】都不共享,module cache 無從共享。
  兩個世界印不同的東西:若共享,該檔只會有 1 行 init;量到 2 行。
- 這同時解釋 chain4(跨檔構造 0/20)為何打不出來。
- ⚠️ 條件式結論:掛在「現行設定無覆寫」上;未來若有人設 isolate:false 或
  pool threads singleThread,本節作廢、23 支要重分。
- 🔴 野生 31fa9b7e 的併發源仍未定——跨檔共享被排除後,搜尋空間再縮一格
  (剩:單檔內 runner 自身的解析交錯、與 optimizer 中途重 bundle 一類 runner 內部路徑)。
