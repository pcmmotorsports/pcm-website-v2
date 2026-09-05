// 🔴🔴 **把字型【帶在紙上】, 不要靠按下列印的那台機器有。**(⟦ship-PRINTNOFONT1⟧ / ⟦ship-PRINTCARON1⟧)
//
// ══ 病徵長什麼樣 —— 而它【不是】一個空白 ══════════════════════════════════
// 真 PDF 量到的(playwright chromium, 2026-09-04):
//   · 這台 Mac 現況        ⇒ **`FontFile=0`** —— 這張紙一支字型都沒帶, 全靠對方機器上有
//   · 一台沒有那些字型的機器 ⇒ `CAAAAA+Times-Roman | DAAAAA+STSongti-TC-Regular`
// 🛑 **Chromium 不會留白, 它會【換一種字】** ⇒ 症狀是整張紙變了個樣子, **不是壞掉**。
// 🎯 ⇒ 📌 **一個降級成「仍然可讀、只是醜」的失敗, 比壞掉更難被發現 —— 它不觸發任何人的求助動作。**
//    (同一間公司的兩份文件:顧客站對帳單把字帶在身上, 後台這兩張紙靠對方的機器有。)
//
// ══ 為什麼【不是】照抄顧客站 `statement-pdf.ts` 的 `fontPkgDir()` / `readFont()` ══
// 🔴 **那兩張紙不是同一種機制** —— 而那一套解的病, 這條路上不存在:
//   · 顧客站對帳單 = **伺服器裡的無頭 chromium**(serverless 函式)⇒ 執行時要自己去磁碟撈
//     位元組 base64 塞進 HTML ⇒ 所以才需要候選鏈 + 讀不到回 null。
//   · 後台這兩張紙 = **員工自己的瀏覽器**開 Next 頁面按 Cmd+P ⇒ 走一般靜態資源管線,
//     `@font-face` 由打包器發出、瀏覽器自己抓。
// ⇒ 🛑 在這裡裝那一套 = 在一個沒有那個病的地方裝一條繞道, 而它會被下一個人當成必要的。
//
// ══ 只 import 400 / 700, 而【不動】`--pd-mono` ══════════════════════════════
// 🔵 `--pd-body` 與 `--pd-disp` 的字體鏈裡本來就有 `'Noto Sans TC'`(print-a4.css :285-287)
//    ⇒ 這兩行 import 讓那個名字**解析得到**, 不必改 CSS 一個字。
// 🛑 **`--pd-mono` 刻意不補** —— 量到它只裝數字與拉丁(`.pd-sku` 料號 / `.pd-num` 金額 /
//    `.pd-cu` 網址;`.pd-contbar th b` 裡是單號, 而「訂單」「箱號」在 `<b>` **外面**)。
//    ⇒ 📌 把 Noto 塞進 mono 鏈 = **拿字型問題換來數字欄位對不齊** —— 那是另一種壞掉。
//
// ⚠️ **這是一個看得見的改變**:這台 Mac 上原本吃 PingFang TC, 現在吃 Noto Sans TC。
//    🔵 **那正是目的** —— 兩台機器印出來要是同一張紙。
//
// ⛔ ~~**未驗:實體印表機。** 還缺的那一道檢查是「拿一台真的印表機印一張出來, 看
//    `AKRAPOVIČ` 的 `Č` 是不是一個字」—— 我量到的是**瀏覽器產的 PDF**, 而
//    印表機驅動有自己的一層字型處理, 我沒有印表機可以量它。~~
// 🔵 **2026-09-05 Sean 拍 `Q-品牌拼法 = 乙`(照現況無撇)⇒ `Č` 不再出現在任何品牌名裡。**
//    ⇒ 上面那一段**留著不刪**:它記著當初為什麼要處理雙字形, 而**成因消失不等於那個機制不存在**
//      —— 下一個帶附加符號的品牌上架時它會原樣回來。
//    🛑 **而「未驗實體印表機」那一格【今天仍然未驗】** —— 拍板讓那個輸入不見了,
//       **沒有讓那道檢查被做過**。兩者不同, 不要把這一句讀成「驗過了」。
//    📎 板列 `⟦ship-STMTCARON1⟧` 已標 done(**成因消失, 不是修好**);
//       守門在 `apps/storefront/src/data/brand-content.test.ts`(品牌名一律 ASCII, 帶正負對照與分母)。
// 🔴 **兩個套件, 而順序的意義在 CSS 那邊**(`print-a4.css` 的 `--pd-body` 註解):
//    `noto-sans` = 拉丁, `noto-sans-tc` = 中日韓。
//    ⟦ship-PRINTCARON1⟧:TC 那支的 woff2 **沒有 `Č` / `Š` 的字形**, 而它的 `unicode-range`
//    **宣告了那個範圍** ⇒ 🛑 **宣告不是保證** ⇒ **拉丁那支要【在鏈上】才接得住**
//    (⛔ ~~「要排在前面才接得住」~~ ⇒ 2026-09-04 當場量:順序錯時 `Č` 仍由 NotoSans 畫;
//     順序守的是**同一個字裡不要有兩種字形**, 見 `print-a4.css` 那段訂正)。
import '@fontsource/noto-sans/400.css';
import '@fontsource/noto-sans/700.css';
import '@fontsource/noto-sans-tc/400.css';
import '@fontsource/noto-sans-tc/700.css';

import './print-a4.css';

// `/print/...` 這段路由的 layout,**存在的唯一理由是把 `print-a4.css` 載進來**。
//
// 🔴 **為什麼需要一個 layout 而不是在兩支 `page.tsx` 各 import 一次**:
//    `@page` 沒有選擇器、侷限不了 ⇒ 只能靠「哪些路由會載入這支 CSS」來侷限它。
//    各自 import 的話**下一張紙會忘記加**,而忘記的症狀是「那張紙印出來不是 A4」——
//    沒有任何東西會紅。放 layout ⇒ 這段路由底下新增的紙**自動吃到**。
//
// ⚠️ **本檔刻意不畫任何東西**(直接回 `children`):紙上的結構全在
//    `components/print/*-doc.tsx`,這裡多包一層 div 會多一個沒人知道存在的版面節點。
export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return children;
}
