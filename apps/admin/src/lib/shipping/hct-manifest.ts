// hct-manifest.ts — 新竹「託運總表」的排版資料(⟦ship-HCTAPI⟧ 片 E,**只做排版那半**)。
//
// 🔴🔴 **本檔【零網路、零 env、零 DB、零時間判斷】。**
//    ⇒ 它把一批出貨單算成「總表上的列 + 合計」, 不管什麼時候印、誰去印。
//
// 🛑🛑 **本檔【不得】出現任何時限判斷 —— 連 TODO 都不寫預設值。**
//    規格第 8 頁的 `TransReport` 說明欄逐字有「當日確認出貨時(18時前上傳)」,
//    🔴 **而「誰在什麼時候按、沒趕上會怎樣」是【營運題】** —— 它是他公司怎麼運作,
//    我們**沒有任何來源答得出來** ⇒ 主視窗端 Sean, 不在本片。
//    ⇒ 📌 **而一個寫了預設值的 TODO, 下一個人會把它當成已經拍過的** ——
//      所以這裡連 `// TODO: 預設 18:00` 都不寫。**這一段就是那個空位的說明。**
//
// 📎 **來源**:`新竹物流API服務說明 V1` **第 9 頁**逐字:
//    「●總表列印 除列印標籤外, 仍需列印出貨總表(**一式二份**), 供現場交接貨件使用」
//    而欄位是**那一頁的樣張圖**上讀出來的。
//    🛑 **而那張圖很小** —— 我讀得出欄位名與合計列的形狀, **讀不出任何尺寸、字級、欄寬**。
//    ⇒ 🔴 **所以本檔【只定義資料】, 不定義版面尺寸** ——
//      尺寸留給 CSS, 而**校準要一次真的印**, 而我沒有印表機(片 D 同一格限制)。

/** 總表上的一列 = 一張出貨單。欄位名照第 9 頁樣張, 不翻譯。 */
export type ManifestRow = {
  /** 委託號碼 = 新竹貨號(送成功才有)。🔴 沒有它的單**不該出現在總表上**, 見 `buildHctManifest`。 */
  edelno: string;
  /** 到著站(新竹回的) */
  arrivalStation: string;
  /** 收貨人代號 —— ⚠️ 我們沒有這一欄(見 `buildHctManifest` 的註解) */
  consigneeCode: string;
  /** 收貨人名稱 */
  consigneeName: string;
  /** 件數 */
  pieces: number;
  /** 重量(公斤) */
  weightKg: number;
  /** 收貨人電話 1 */
  phone1: string;
  /** 收貨人電話 2 */
  phone2: string;
  /** 傳票區分 */
  invoiceType: string;
  /** 代收貨款 */
  codAmount: number;
  /** 報值金額 */
  declaredValue: number;
  /** 收貨人地址(樣張上排在委託號碼底下那一行) */
  address: string;
  /** 備註(同上,第二行) */
  note: string;
};

/**
 * 合計 —— 🔴 **而它是【對帳用】的, 不是裝飾。**
 *
 * 🎯 司機拿著這張紙**當場點貨**:總筆數與總件數對不上, 他就不會簽。
 * ⇒ 📌 **所以這兩個數算錯的後果不是「表格難看」, 是【交接停在現場】** ——
 *   而那時候貨已經在他車上旁邊了。
 */
export type ManifestTotals = { totalOrders: number; totalPieces: number };

export type HctManifest = {
  rows: ManifestRow[];
  totals: ManifestTotals;
  /**
   * 🔴 **一式二份** —— 規格第 9 頁**逐字**。
   * 🛑 而它**不是**「印兩次」的實作細節, 它是**規格要求**:一份給司機、一份我們留存。
   *    ⇒ 所以它是資料的一部分, 讓版面層讀得到, 而不是某個人記得要按兩次列印。
   */
  copies: 2;
  /** 被排除在總表之外的單 + 為什麼(呼叫端要讓人看得到)。 */
  excluded: { shipmentRef: string; reason: string }[];
};

export type ManifestInput = {
  shipmentRef: string;
  /** 新竹貨號;`null` = 這張還沒送成功。 */
  edelno: string | null;
  arrivalStation: string;
  consigneeName: string;
  phone1: string;
  phone2?: string;
  address: string;
  note?: string;
  pieces: number;
};

/**
 * 重量:**固定 `2`**(Sean 2026-09-04 逐字 `甲 對 —— 我都填 5, 沒在量        ⇒ 你填入2吧`)。
 *
 * ⚠️ **而他附的樣張 PDF 五張標籤【逐張印「重 5」】** —— 那是**他過去的實務**, **不是拍板值**。
 * 🛑 **兩個數都留著** —— 下一個看到樣張的人會想把 2「修正」成 5, 而他每一步都做對了。
 * 🔵 **而這裡刻意【不 import 片 A 的常數】**:總表與託運單是**兩張紙**,
 *    哪天其中一張要改, 共用一個常數會讓另一張**安靜地跟著改**。
 *    ⇒ 而兩邊各有一格測試釘住字面 ⇒ 它們不一致時**會紅**, 不會安靜。
 */
export const MANIFEST_WEIGHT_KG = 2;

/** 傳票區分 `11 元付`(同上,Sean 2026-09-04 逐字「商品種類 11元付、一般小物」的前半)。 */
export const MANIFEST_INVOICE_TYPE = '11';

/**
 * 一批出貨單 → 一張託運總表。
 *
 * 🔴🔴 **沒有新竹貨號的單【不進總表】, 而它要被【列出來】不是被丟掉。**
 *    🎯 總表是**交接憑證** —— 一張沒有貨號的單, 司機收不了。
 *    ⇒ 🛑 而**安靜地少一列**與**明白地列出來**, 對員工是完全不同的兩件事:
 *      前者他**點不出來**(他不知道本來該有幾張), 後者他知道**哪一張還沒好**。
 *    ⇒ 📌 這與片 D 那條同一句:**壞掉的那一格要說話, 不得靜靜空白。**
 */
export function buildHctManifest(inputs: ManifestInput[]): HctManifest {
  const rows: ManifestRow[] = [];
  const excluded: { shipmentRef: string; reason: string }[] = [];

  for (const i of inputs) {
    if (i.edelno === null || i.edelno.trim() === '') {
      excluded.push({
        shipmentRef: i.shipmentRef,
        reason: '還沒拿到新竹貨號 —— 這張單司機收不了, 要先送出成功才會出現在總表上。',
      });
      continue;
    }
    if (!Number.isInteger(i.pieces) || i.pieces < 1) {
      // 🔴 件數壞掉**不能靜靜當 0** —— 合計是對帳用的, 而一個少算的合計會讓司機簽下一個錯的數。
      excluded.push({
        shipmentRef: i.shipmentRef,
        reason: `件數不是 >= 1 的整數(${String(i.pieces)})—— 合計是對帳用的, 不能拿一個壞掉的數去湊。`,
      });
      continue;
    }
    rows.push({
      edelno: i.edelno,
      arrivalStation: i.arrivalStation,
      // ⚠️ **收貨人代號:我們沒有這一欄。** 樣張上它是空的, 而規格沒說它必填。
      //    🛑 所以這裡留空**不是漏做, 是我們真的沒有** —— 而填一個我們編的值比留空糟。
      consigneeCode: '',
      consigneeName: i.consigneeName,
      pieces: i.pieces,
      weightKg: MANIFEST_WEIGHT_KG,
      phone1: i.phone1,
      phone2: i.phone2 ?? '',
      invoiceType: MANIFEST_INVOICE_TYPE,
      // ⚠️ 代收貨款 / 報值金額:我們線上先付、不報值 ⇒ 都是 0。
      //    🔵 那是**現況**不是拍板 —— 哪天有貨到付款, 這兩格要重新問。
      codAmount: 0,
      declaredValue: 0,
      address: i.address,
      note: i.note ?? '',
    });
  }

  return {
    rows,
    totals: {
      totalOrders: rows.length,
      // 🔴 **總件數是【加起來】的, 不是列數** —— 一張單可以有多件。
      //    📌 而那正是這兩個數要分開印的理由:樣張上「總筆數」與「總件數」是兩行。
      totalPieces: rows.reduce((n, r) => n + r.pieces, 0),
    },
    copies: 2,
    excluded,
  };
}
