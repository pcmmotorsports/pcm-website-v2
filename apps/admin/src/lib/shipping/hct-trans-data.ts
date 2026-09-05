// hct-trans-data.ts — 一張出貨單 → 新竹 `TransData` 的欄位(⟦ship-HCTAPI⟧ 片 A)。
//
// 🔴🔴 **本檔【零網路、零 env、零 DB】** —— 它只做「我方資料 → 新竹欄位」這一個轉換。
//    ⇒ 打不打得出去、關不關著、寫不寫進 DB, 全部**不在本檔**(片 B / C)。
//    📌 **這一刀是刻意的**:這條線最需要被釘死的一半是**欄位對不對**,
//      而那一半**完全靠單元測試**就驗得完 —— 不必等帳密、不必等 Sean、不必打新竹。
//
// 🛑 **本檔【不送出任何東西】。** 它回一個純物件。
//    ⇒ 送出那一步(鐵則 12⑤ 對外不可回收)在片 B, 而它預設是關的。
//
// 📎 **規格來源**:Sean 2026-09-04 給的 `新竹物流API服務說明 V1`(內頁版本 2022/12/30 ver 2.0)
//    **第 10 頁** `2.2.2 傳入託運資料 (TransData)` 的欄位表。
//    ⚠️ **本檔的欄位名與長度是照那一頁抄的**;規格改版 ⇒ 本檔要重抄, 不是猜。

import type { RecipientSnapshot } from './recipient';

/**
 * 🔴 **重量:固定值 `2`。而【兩個數字都要看得到】。**
 *
 * · **Sean 2026-09-04 下午拍板, 原話逐字**:`甲 對 —— 我都填 5, 沒在量        ⇒ 你填入2吧`
 *   ⇒ ✅ **要寫進碼的是 `2`。**
 * · ⚠️ **而他同一天附的樣張 PDF, 五張標籤【逐張印「重 5」】** —— 那是**他過去的實務**, **不是拍板值**。
 *
 * 🛑 **⇒ 下一個看到樣張的人會想把 `2`「修正」成 `5`, 而他每一步都做對了。**
 *    📌 所以那個 5 寫在這裡, 不是寫在別的地方 —— **他要在改它的那一刻撞到這段話。**
 *
 * 🔵 **為什麼是常數而不是欄位**:全 repo 沒有任何重量來源 ——
 *    schema 欄位定義 0(🟢 正對照 `quantity` 欄 20)· 匯入端 0 支檔(🟢 正對照 `sku` 63 支)·
 *    正式庫三張 jsonb 的 key 全掃 0 列(🟢 正對照 `color` 33,805;分母 58,669 個變體)。
 *    ⇒ 而 Sean 拍「不用量」⇒ 這是**營運決定**, 不是我們省事。
 *
 * ⚠️ **仍未量(不因為那一拍而消失)**:①新竹對填錯重量怎麼計費 / 會不會退件 —— **規格沒寫**
 *    ②`eqamt` 給 0 或空會不會被拒 ⇒ **要實打才知道, 而實打要 Sean 另外批。**
 */
export const HCT_DEFAULT_WEIGHT = '2';

/**
 * 傳票類別 `11 元付` —— Sean 2026-09-04 逐字 `商品種類 11元付、一般小物`。
 * ⚠️ **他把兩個答案寫在一句裡**:`11元付` 落在**傳票類別**那一格, `一般` 落在**類型**那一格。
 * 📎 規格第 10 頁 `eprdct 傳票類別 Char(2) 預設為月結 11(到付 21、現收 31)`。
 */
export const HCT_INVOICE_TYPE = '11';

/**
 * 商品種類 `001 一般` —— Sean 2026-09-04 逐字「一般小物」。
 * 📎 規格第 10 頁 `eprdcl2 商品種類 Char(3) (001 一般;003 冷凍;008 冷藏) 預設為 001`。
 */
export const HCT_PRODUCT_KIND = '001';

/**
 * 🔴 **新竹的欄位長度上限(規格第 10 頁逐字), 而【我們這邊一個 max 都沒有】。**
 *
 * `packages/schemas/src/index.ts` 的 `AddressInput`:`name` / `phone` / `line` 三欄
 * 只有 `.trim().min(1)`, **沒有 `.max()`** ⇒ 一個很長的地址會直接撞到新竹的 `Char(100)`。
 *
 * 🎯 **而這個 repo 已經被同一類咬過一次** —— 同一支 schema 的註解逐字記著:
 *    「LINE 合成信箱 64 字元**恆超 TapPay 40 上限** ⇒ 3DS 啟動被拒」。
 *    ⇒ 📌 **對方的欄位比我們短, 而我們這邊沒有東西會叫。**
 */
export const HCT_MAX = { name: 40, phone: 15, address: 100, orderNo: 30, remark: 100 } as const;

/** `TransData` 的必填六欄 + 我方會填的選填欄(規格第 10 頁的欄位名, 一個字都沒改)。 */
export type HctTransDataFields = {
  /** 訂單編號 Char(30) · 必要欄位 */
  epino: string;
  /** 收貨人名稱 Char(40) · 必要欄位 */
  ercsig: string;
  /** 收貨人電話 1 Char(15) · 必要欄位 */
  ertel1: string;
  /** 收貨人地址 Char(100) · 必要欄位 */
  eraddr: string;
  /** 件數 Char(4) · 必要欄位(最小為 1) */
  ejamt: string;
  /** 重量 Char(5) · 必要欄位(小數進位到整數) */
  eqamt: string;
  /** 傳票類別 Char(2) · 預設月結 11 */
  eprdct: string;
  /** 商品種類 Char(3) · 預設 001 一般 */
  eprdcl2: string;
  /** 備註 Char(100) */
  emark: string;
};

/** `shipments_reference_format` 這條 DB CHECK 的**同一份字面**(建表 migration
 *  `20260805170000_m4b_e10_b2_s1a1_shipments.sql:98-99`)。字母表已排除 0/O/1/I/L/A/E/U。
 *  🔴 **兩處各有一份而不是共用一份, 是刻意的**:DB 那道擋的是寫進表, 這一道擋的是送出去 ——
 *     兩個不同的邊界, 而一份共用常數會讓「其中一邊被改鬆」變成無聲的。
 *  ⚠️ ⛔ ~~而上面那句在【沒有一致性測試】的情況下效果剛好相反~~(codex R1 nit)——
 *     兩份各自漂移**才是**無聲的。✅ 已補:`hct-trans-data.test.ts` 有一格**去讀那支 migration**,
 *     把 SQL 裡的字面與這一行逐字比。⇒ 📌 **「刻意兩份」只有在有那一格的時候才成立。** */
const SHIPMENT_REFERENCE_RE = /^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$/;

export type BuildHctTransDataInput = {
  /**
   * 新竹的 `epino`(訂單編號)—— 🔴🔴 **餵的是【箱號】`shipment_reference`, 不是訂單的 `displayId`。**
   *
   * ⛔ ~~我方單號, 形如 `PCM-2026-0001`~~ —— **那個 docstring 是假的**(2026-09-06 ⟦ship-EPINOUNIQUE⟧
   *    當場核 `shipment-actions.ts` 那一行 —— **改名前**逐字是 `displayId: row.shipmentReference`,
   *    本片改名後是 `shipmentReference: row.shipmentReference`。⚠️ 引用舊字面時要標「改名前」,
   *    否則下一個人 grep 不到而以為我寫錯了。)
   *    而**參數名、docstring、測試 fixture 三個都指向錯的那個值**:
   *    `hct-trans-data.test.ts` 餵的是 `'PCM-2026-0001'`, 而正式碼餵的是 6 碼箱號。
   *
   * 🔴🔴🔴 **而下面那道格式閘【擋不住這件事】—— 這一句是 codex R1 逼出來的, 我當場開檔複驗**:
   *    `orders_display_id_format` 這條 CHECK 在 `20260729010000_m4b_e10_d0_display_id_expand.sql:76-79`
   *    被放寬成 **同時接受** `^PCM-[0-9]{4}-[0-9]{4,}$` **與** `^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$`,
   *    而 `20260730120100` 讓建單真的改用那個 6 碼產號器
   *    ⇒ 🛑 **今天的新訂單編號與箱號【同一個字母表、同一個長度】——【字串上分不出來】。**
   *    ⇒ ⛔ 我原本寫「傳訂單 `displayId` 進來會當場 throw」 —— **那句只對【舊格式】成立**,
   *      而我自己的測試餵的正好是舊格式 `'PCM-2026-0001'` ⇒ 📌 **fixture 供應了真實世界不再送的東西,
   *      所以那一格是綠的。** 同一個坑我今晚才寫進 `guard-and-instrument-traps.md`。
   *    ⇒ ✅ **格式閘保留, 但它的宣稱收窄成:擋畸形值**(空字串 / 小寫 / 長度不對 / 含被排除的字母)。
   *      **擋不住「一個合法的新式訂單編號」** —— 那要另一道, 見下。
   *
   * 🛑🛑 **為什麼這件事有牙齒 —— 新竹官方 `API服務說明 ver 2.0` P.8 逐字**:
   *    `訂單編號 -> 同一個 ESDATE 不可重複`
   *    `新竹貨號+訂單編號 -> 當日重複上傳, 視同更正資料內容`
   *    ⇒ 🎯 **一張訂單可以有很多箱**(`shipments` 表刻意沒有 `order_id`, 一箱可含多張訂單)
   *      ⇒ 若哪天有人「照名字把它修好」、真的傳訂單 `displayId` 進來,
   *      **同一天出兩箱 = 同一個 epino 兩發** ⇒ 撞那條線, 而更糟的分支是
   *      **被當成更正 ⇒ 第一箱的託運資料被第二箱蓋掉, 而我們畫面上兩箱都在。**
   *    ⇒ 📌 **那個錯誤【看起來像在修 bug】** —— 而**字串層沒有任何東西分得出來**
   *      ⇒ 🎯 **唯一擋得住它的是【值的來源】**:這一欄只能來自 `shipments` 那一列。
   *      ✅ 今天的保護是 `shipment-actions.ts` 那一行從 DB 讀出來的 row,
   *        而**釘住那一行的是 `shipment-actions.test.ts` 的原始碼斷言那一格**(這一片新增)。
   *      ⚠️ **那一格是【源碼層】不是行為層** —— 它答得出「那一行有沒有被改」,
   *        答不出「執行時真的送了什麼」。**射程照實寫, 不要當它是行為驗證。**
   *
   * ✅ **不可重複那條線的一半今天由 DB 守著**:`shipments_reference_unique UNIQUE (shipment_reference)`
   *    (同一支建表 migration `:100`, 並有 `:319` 的後檢查點名它)⇒ **兩列不會共用同一個箱號**。
   * ⚠️ ⛔ ~~⇒ 比新竹要的「同日不可重複」與「100 天不可重複」都嚴~~ —— **那句寫寬了**(codex R1):
   *    · UNIQUE 管的是**兩列**, 而**同一列可以被送第二次**(人工把 `unknown` 推回 `draft` 之後)
   *      ⇒ 同一天同一個 `epino` 再送一發 —— 那在新竹的規格裡是「當日重複上傳, 視同更正」。
   *      🔵 **而那個行為是【對的】**:那就是同一箱, 更正它自己。**不是本片要擋的東西。**
   *    · 「100 天不可重複」管的是**新竹配的 `edelno`(貨號)**, 不是我們的箱號 ⇒ 那條線不在我們手上。
   * ⇒ 📌 **本片仍然不需要新的 migration** —— 而理由收窄成上面那一句, 不是原本那句。
   */
  shipmentReference: string;
  recipient: RecipientSnapshot;
  /** 這一箱掛了幾個品項 ⇒ 件數。 */
  itemCount: number;
  /** 出貨單上的備註(可空)。 */
  note?: string;
};

/**
 * 🔴 **截斷, 而【截斷這件事本身要被看見】。**
 *
 * 為什麼不是「太長就拒絕」:🎯 **拒絕的代價落在客人身上**(他的單出不去),
 * 而截斷的代價落在**地址的最後幾個字**上 —— 而新竹的司機看的是前面那幾段。
 * 🛑 **而我不替它決定**:本函式**同時回傳被截斷的欄位清單**(`truncated`),
 *    呼叫端(片 B / UI)要把它**印在員工按下去之前看得到的地方**。
 *    ⇒ 📌 **一個安靜的截斷, 與一個沒有截斷的世界, 在送出那一刻印同一個畫面。**
 *
 * ⚠️ **長度用 UTF-16 code unit 數(`String.length`), 而規格寫的是 `Char(N)`** ——
 *    🔴 **那兩個【不一定是同一件事】**:新竹若用 Big5 計算位元組, 一個中文字是 **2**,
 *    而 `'台'.length === 1`。⇒ 🛑 **本函式在「純中文地址」上可能【放行一個對方會截的字串】。**
 *    ⇒ ✅ **這一格【明寫為未確認】** —— 要知道只有兩條路:①問新竹 ②實打一個 100 字的地址看回什麼。
 *    ⇒ 而**規格第 23 頁逐字提過 Big5**(「傳入中文需使用 Big5 編碼」, 限 URL 介接方式)
 *      ⇒ 📌 **那句話讓「Char(N) 可能是位元組」這個懷疑【有依據】, 而不是我在猜。**
 */
function clip(v: string, max: number): string {
  return v.length <= max ? v : v.slice(0, max);
}

export type BuildHctTransDataResult = {
  fields: HctTransDataFields;
  /** 哪幾欄被截斷了(空陣列 = 沒有)。呼叫端要讓員工在送出前看見。 */
  truncated: (keyof HctTransDataFields)[];
};

/**
 * 一張出貨單 → `TransData` 欄位。**純函式:同樣的輸入永遠回同樣的東西。**
 *
 * 🛑 **它不驗「這張單該不該出」** —— 那由既有的 `cancelShipmentWarning` / `toRecipientSnapshot` 管。
 *    本函式假設呼叫端已經拿到一個**合法的** `RecipientSnapshot`(那個型別的存在理由就是這個)。
 */
export function buildHctTransData(input: BuildHctTransDataInput): BuildHctTransDataResult {
  // 🔴🔴 **`epino` 的格式閘 —— 這一片(⟦ship-EPINOUNIQUE⟧)的全部產出就是它。**
  //    形狀**逐字照本檔既有的兩道**(件數下限 / 件數上限):**不把錯的輸入夾成合法的請求。**
  //    ⇒ 傳訂單 `displayId`(`PCM-2026-0001`)進來會**當場 throw**, 而不是安靜地送出去。
  //    ⚠️ 射程:它擋的是**形狀**, 不是「這個箱號真的存在」—— 後者由 DB 的 UNIQUE 與呼叫端負責。
  if (!SHIPMENT_REFERENCE_RE.test(input.shipmentReference)) {
    // 🔴 **訊息要寫給【按鈕的人】看, 不是寫給改碼的人看**(code-reviewer R3 Minor):
    //    這個 throw 會經 `shipment-actions.ts` 的 `toMessage(e)` **直接印在後台員工的畫面上**。
    //    ⇒ 一句他做得了的事 + 一個給值班的定位字串;**為什麼**寫在上面那段註解裡, 不進訊息。
    throw new Error(
      `這箱的箱號格式不對, 不能送新竹(收到 ${JSON.stringify(input.shipmentReference)})—— ` +
        '這不是你操作錯, 請回報並附這行字。[epino/shipment_reference]',
    );
  }

  const truncated: (keyof HctTransDataFields)[] = [];
  const take = (v: string, max: number, key: keyof HctTransDataFields): string => {
    const out = clip(v, max);
    if (out !== v) truncated.push(key);
    return out;
  };

  // 🔴 件數最小為 1(規格第 10 頁逐字「必要欄位(最小為 1)」)。
  //    ⚠️ 而 `itemCount` 為 0 或負數**不是**「這箱沒東西」—— 那是呼叫端算錯了。
  //    本函式**不吞它**:夾到 1 會讓一個錯的輸入變成一個合法的請求, 而那正是最難查的那種。
  if (!Number.isInteger(input.itemCount) || input.itemCount < 1) {
    throw new Error(
      `buildHctTransData: 件數必須是 >= 1 的整數, 收到 ${String(input.itemCount)} —— ` +
        '這不是「這箱沒東西」, 是呼叫端算錯了。夾到 1 會讓一個錯的輸入變成一個合法的請求。',
    );
  }

  // 🔴🔴 **上限也要擋, 而理由與上面那一格【逐字同構】**(2026-09-05 補;
  //    抓到它的是 `hct-trans-data-pdf-conformance.test.ts`, 那支檔把 PDF 第 13 頁的欄位表釘住)。
  //    規格逐字 `ejamt 件數 Char(4)` ⇒ 最多 4 位 ⇒ 上限 9999。
  // 🛑 **這一欄【原本沒有任何東西在擋】** —— 其餘五個必要欄位都走 `take(..., HCT_MAX.x)`,
  //    只有 `ejamt` 是裸的 `String(input.itemCount)`。
  // 🎯 **而這裡【不能用 take() 截斷】** —— 截一個數字比超長更糟:
  //    `12345` 截成 `'1234'` 是一個**合法而安靜的錯數量**, 新竹會照 1234 件收,
  //    而**沒有任何東西會叫**。⇒ 📌 與上面同一條原則:**不把錯的輸入夾成合法的。**
  // ⚠️ **今天在真實資料上到不了**(一張訂單不會有 10000 件)⇒ 這是【規格違反】不是【今天的 bug】。
  if (input.itemCount > 9999) {
    throw new Error(
      `buildHctTransData: 件數 ${String(input.itemCount)} 超過規格上限 9999(PDF 第 13 頁 ejamt Char(4))—— ` +
        '本函式不截斷它:截成 4 位會把一個錯的數量變成一個合法的請求, 而新竹會照那個錯的數量收。',
    );
  }

  return {
    fields: {
      // 🔵 `take` 留著而**今天它的截斷分支到不了**(6 碼 < 30)—— 刻意不改成裸值:
      //    上面那道格式閘哪天被放寬時, 這裡仍然是最後一層。**而「到不了」寫在這裡, 不要當它有守到。**
      epino: take(input.shipmentReference, HCT_MAX.orderNo, 'epino'),
      ercsig: take(input.recipient.name, HCT_MAX.name, 'ercsig'),
      ertel1: take(input.recipient.phone, HCT_MAX.phone, 'ertel1'),
      eraddr: take(input.recipient.line, HCT_MAX.address, 'eraddr'),
      ejamt: String(input.itemCount),
      eqamt: HCT_DEFAULT_WEIGHT,
      eprdct: HCT_INVOICE_TYPE,
      eprdcl2: HCT_PRODUCT_KIND,
      emark: take(input.note ?? '', HCT_MAX.remark, 'emark'),
    },
    truncated,
  };
}
