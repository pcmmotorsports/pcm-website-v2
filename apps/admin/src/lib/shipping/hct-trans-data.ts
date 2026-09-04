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

export type BuildHctTransDataInput = {
  /** 我方單號, 形如 `PCM-2026-0001`。 */
  displayId: string;
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

  return {
    fields: {
      epino: take(input.displayId, HCT_MAX.orderNo, 'epino'),
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
