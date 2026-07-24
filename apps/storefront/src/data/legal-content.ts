// data/legal-content.ts — 服務條款 / 隱私政策 對外文字(#291、L1)
//
// 🔴 內容來源 = `docs/specs/2026-07-23-pcm-legal-terms-privacy-draft.md`(依台灣官方法源起草:
//   零售業網路交易定型化契約應記載/不得記載事項、消保法 18/19/19-2 + 通訊交易解除權合理例外情事
//   適用準則、個資法第 8 條)。**Sean 2026-07-24 核准發布**(#291 核准矩陣=Sean 必要、律師選配;
//   本次未經律師簽核,誠實記錄於此)。
// 🔴 **不得**從 `design-reference/components/LegalPage.jsx` 取材 —— 該檔是草稿、含假聯絡資訊與
//   與 PCM 政策衝突的條文(見 lib/legal/terms-version.ts 檔頭)。
// 🔴 事實(公司登記資訊、負責人、退貨政策、訂貨時程、客製品範圍)由 Sean 2026-07-23 提供。
// 🔴 草稿中以「標記給 Sean/律師」「L1 實作註」開頭的段落 = 內部註記、**非對外文字**,已剝除;
//   第 4 條原括號內的內部架構說明(Phase 1 對帳現況)亦不對外揭露,只保留法律上的成立時點。
//
// 內容分級 = **L1**(年 0-1 次異動)→ hardcode + 本檔為單一真相,對齊 `data/rpm-policies.ts` 慣例。
// 🔴 條款文字實質改版時:除改本檔外,**必須**同步 bump `lib/legal/terms-version.ts` 的
//   `CURRENT_TERMS_VERSION` **與** `legal_terms_versions` migration seed(FK 來源)——
//   兩者不同步會讓「同意紀錄指向的版本」與「客人實際讀到的內容」對不上。
//   ⇒ 已由 `legal-content-hash.test.ts` 機制化守門(改字沒 bump 就紅),不靠人記得。
//
// ⚠️ **第 10 條(鑑賞期)= Sean 2026-07-24 拍板 B、與 Claude 查證結論相反**,不是疏漏:
//   Claude 查證(準則第 2 條 + 行政院總說明附表)結論為「代購不在 7 款例外內;且立法說明明文
//   排除『依現有顏色或規格中加以指定或選擇者』」→ 建議只對真客製品逐項標示(選項 D)。
//   Sean 三度確認選 B(全站主張排除、風險自負)。決定與完整法源見
//   memory `project_seven-day-withdrawal-stance-decision`。**要改口徑先問 Sean、不要自行「修正」回來。**

import {
  LEGAL_NAME,
  LEGAL_NAME_EN,
  TAX_ID,
  LEGAL_REPRESENTATIVE,
  CONTACT_PHONE_DISPLAY,
  CONTACT_EMAIL,
  STORE_ADDRESS,
  OPENING_HOURS,
} from '@/lib/site-config';
import { LINE_OA_ID } from '@/lib/line-cta';

// 🔴 聯絡 / 登記資訊一律從 SSoT 衍生、**不在本檔硬寫**(#291 驗收條件:「聯絡資訊取自 site-config SSoT」)。
//   理由:硬寫會在 Sean 換電話 / 換地址時靜默漂移 —— 而法律頁印錯聯絡方式是實質瑕疵。
const ADDRESS_LINE = `${STORE_ADDRESS.postalCode} ${STORE_ADDRESS.region}${STORE_ADDRESS.locality}${STORE_ADDRESS.street}`;
/** 英→中星期(營業日顯示用;SSoT `OPENING_HOURS.days` 存英文)。 */
const ZH_DAY: Record<string, string> = {
  Sunday: '日',
  Monday: '一',
  Tuesday: '二',
  Wednesday: '三',
  Thursday: '四',
  Friday: '五',
  Saturday: '六',
};
const WEEK_ORDER = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/**
 * 營業日字串:連續 → 「週一至週六」;不連續 → 「週一、週三、週五」。
 * 🔴 連續性**實際判斷**、不假設 —— Sean 若改成只開平日或跳日,這裡自動跟著對,
 *    不會像寫死「週一至週六」那樣靜默說謊。
 */
const OPEN_DAYS_LABEL = (() => {
  const days = [...OPENING_HOURS.days];
  if (days.length === 0) return '';
  const idx = days.map((d) => WEEK_ORDER.indexOf(d)).sort((a, b) => a - b);
  const contiguous = idx.every((v, i) => i === 0 || v === (idx[i - 1] ?? -99) + 1);
  const zh = (i: number) => `週${ZH_DAY[WEEK_ORDER[i] ?? ''] ?? ''}`;
  if (days.length === 1) return zh(idx[0] ?? 0);
  return contiguous
    ? `${zh(idx[0] ?? 0)}至${zh(idx[idx.length - 1] ?? 0)}`
    : idx.map((i) => zh(i)).join('、');
})();
const SERVICE_HOURS = `營業時間 ${OPEN_DAYS_LABEL} ${OPENING_HOURS.opens}–${OPENING_HOURS.closes}`;
/** 客服三管道(多條條文重複引用 → 抽一份,避免各自寫分歧版本)。 */
const SUPPORT_CHANNELS = `客服 LINE ${LINE_OA_ID} / 電話 ${CONTACT_PHONE_DISPLAY} / 信箱 ${CONTACT_EMAIL}`;

/** 一個段落區塊:標題 + 內文段落 + 條列(三者皆選填,依內容需要)。 */
export type LegalSection = {
  heading: string;
  paragraphs?: string[];
  items?: string[];
};

/** 頁面顯示的最後更新日(非 CURRENT_TERMS_VERSION;後者是同意紀錄用的版本鍵)。 */
export const LEGAL_LAST_UPDATED = '2026-07-24';

export const TERMS_SECTIONS: LegalSection[] = [
  {
    heading: '契約審閱',
    paragraphs: [
      '本條款於您下單前即公開於本網站,供您完整審閱;您於結帳時勾選「我已閱讀並同意」後始得送出訂單。契約之成立時點另依第 4 條(送出訂單為要約,本公司承諾時契約始成立)。本公司不以任何條款使您拋棄合理審閱期間之權利。',
    ],
  },
  {
    heading: '第 1 條 企業經營者資訊',
    paragraphs: [`本網站由${LEGAL_NAME}(英文 ${LEGAL_NAME_EN},以下簡稱「本公司」)經營。`],
    items: [
      `統一編號:${TAX_ID}`,
      `負責人:${LEGAL_REPRESENTATIVE}`,
      `營業地址:${ADDRESS_LINE}`,
      `客服電話:${CONTACT_PHONE_DISPLAY}(${SERVICE_HOURS})`,
      `客服信箱:${CONTACT_EMAIL}`,
      `客服 LINE:${LINE_OA_ID}`,
    ],
  },
  {
    heading: '第 2 條 契約解釋原則',
    paragraphs: ['本條款如有疑義,應為有利於消費者之解釋。'],
  },
  {
    heading: '第 3 條 商品資訊',
    paragraphs: [
      '交易頁面所呈現之商品名稱、價格、內容、規格、型號、適用車型等資訊,均為契約之一部分。',
    ],
  },
  {
    heading: '第 4 條 契約成立與表示方法',
    paragraphs: [
      '消費者於本網站下單,以電子文件為表示方法。消費者送出訂單為要約,本公司於出貨或提供付款完成確認時始為承諾、契約成立。',
    ],
  },
  {
    heading: '第 5 條 確認機制',
    paragraphs: [
      '本公司於消費者訂立契約前,於結帳頁提供商品種類、數量、價格及其他重要事項之確認機制;消費者確認無誤後始送出訂單。契約成立後本公司確實履行。',
    ],
  },
  {
    heading: '第 6 條 訂購數量上限',
    paragraphs: [
      '單一商品之訂購數量若逾本網站標示上限,本公司僅依上限出貨,其餘部分不成立契約。',
    ],
  },
  {
    heading: '第 7 條 商品交付',
    items: [
      '交付方式:快遞配送。',
      '交付地:台灣本島(離島與海外另議)。',
      '出貨時程:本賣場商品於接單後向原廠或供應商訂購,一般約 2–12 週(視商品與原廠供貨狀況而定);實際時程以商品頁標示或客服告知為準。',
    ],
  },
  {
    heading: '第 8 條 付款方式',
    items: [
      '本網站付款採信用卡(TapPay 金流,VISA / Mastercard / JCB / AE),並經 3D 驗證完成授權。',
      '卡片資訊由 TapPay 依 PCI-DSS 規範處理,本公司不儲存您的完整卡號。',
      '本網站不涉及小額信貸或其他債權債務關係。',
    ],
  },
  {
    heading: '第 9 條 運費',
    paragraphs: ['運費之計算與負擔方式於結帳頁明確標示;未標示者由本公司負擔。'],
  },
  {
    heading: '第 10 條 退貨與契約解除權',
    items: [
      '商品性質:本賣場商品以接單後依您指定之車型、規格或需求,向國外原廠或供應商個別訂購之客製化委任代購為原則;實際供貨方式與交期以各商品頁標示或客服告知為準。',
      '鑑賞期(合理例外之事前告知):依「通訊交易解除權合理例外情事適用準則」第 2 條第 2 款,依消費者要求所為之客製化給付,排除消費者保護法第 19 條第 1 項七日解除權之適用。本公司就前述客製化委任代購商品主張本項排除,並以本條款之公開及商品頁揭露作為該準則第 2 條所定之事前告知。鑑賞期之目的在於確認商品是否符合需求,非商品之試用期;請於下單前確認車型與規格。',
      '瑕疵擔保(不受前項排除影響):商品若有瑕疵、與您訂購之內容不符、運送途中毀損或數量短缺,您仍得依民法第 354 條以下規定主張瑕疵擔保,請求修補、更換、減少價金或解除契約。此項權利為法律所賦予,不因前項鑑賞期之排除而受影響。',
      '瑕疵之通知與處理:請於收受商品後儘速檢查,並於發現瑕疵後即時通知本公司並提供照片等佐證。經確認屬本公司出貨錯誤、運送毀損或原廠品質責任者,退回運費由本公司負擔,並依您之選擇辦理更換或退款。',
      '非瑕疵之退換貨:商品無瑕疵而您因個人因素(如購買後改變心意、車輛已出售、與他款比較後改買其他品項)申請退換者,不在前述瑕疵擔保範圍內;若經本公司個案同意受理,所生之來回運費、國際運費、關稅及金流手續費由您負擔。',
      '退款方式與時程:經本公司確認應退款者,於確認之次日起 15 日內依原付款管道退還已支付之價金;信用卡退刷之實際入帳時間依發卡銀行作業程序而定。',
      `退貨聯絡窗口:${SUPPORT_CHANNELS}。`,
    ],
  },
  {
    heading: '第 11 條 個人資料保護',
    paragraphs: [
      '本公司蒐集、處理及利用您的個人資料,悉依個人資料保護法及本網站隱私政策辦理。',
    ],
  },
  {
    heading: '第 12 條 帳號密碼之保管與冒用',
    paragraphs: [
      '請妥善保管您的帳號密碼。本公司知悉您的帳號遭第三人冒用時,將立即暫停該帳號之交易處理及後續利用,並協助處理。',
    ],
  },
  {
    heading: '第 13 條 系統安全',
    paragraphs: [
      '本公司確保交易電腦系統具備一般可合理期待之安全性;本網站採 HTTPS 加密傳輸,金流由 TapPay 處理。',
    ],
  },
  {
    heading: '第 14 條 消費爭議處理',
    paragraphs: [
      `如有消費爭議,您可透過${SUPPORT_CHANNELS} 提出申訴;本公司將於合理期間內回覆處理。您亦得依法向消費者保護團體或主管機關申訴。`,
    ],
  },
  {
    heading: '第 15 條 準據法與管轄',
    paragraphs: [
      '本條款以中華民國法律為準據法。因本契約所生爭議,雙方同意不排除消費者依消保法第 47 條或民事訴訟法第 436-9 條之小額訴訟管轄法院之權利。',
    ],
  },
];

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    heading: '一、蒐集機構',
    paragraphs: [`${LEGAL_NAME}(統一編號 ${TAX_ID};聯絡方式同服務條款第 1 條)。`],
  },
  {
    heading: '二、蒐集目的',
    paragraphs: [
      '會員註冊與管理、訂單處理與出貨、金流付款與對帳、客戶服務與售後、退換貨處理、依法令保存交易紀錄、經您同意之行銷通知。',
    ],
  },
  {
    heading: '三、蒐集之個人資料類別',
    paragraphs: [
      '姓名、聯絡電話、電子郵件、收件地址、訂單與交易紀錄、會員帳號資訊。',
      '付款卡片資訊由 TapPay 金流依 PCI-DSS 處理,本公司不儲存您的完整卡號。',
    ],
  },
  {
    heading: '四、利用之期間、地區、對象及方式',
    items: [
      '期間:自您註冊或交易起,至蒐集目的消失或依法令保存期限屆滿為止。',
      '地區:中華民國境內為主;涉物流或金流服務商之必要範圍。',
      '對象:本公司及為履行服務所必要之第三方(如金流業者 TapPay、物流業者)。',
      '方式:於前述目的與法令範圍內,以自動化或非自動化方式處理利用。',
    ],
  },
  {
    heading: '五、您得行使之權利及方式',
    paragraphs: [
      `依個資法第 3 條,您得就本公司保有之您的個人資料,請求查詢或閱覽、製給複製本、補充或更正、停止蒐集處理利用、刪除。行使方式:${SUPPORT_CHANNELS}。`,
    ],
  },
  {
    heading: '六、不提供個人資料之影響',
    paragraphs: [
      '您得自由選擇是否提供個人資料;惟若不提供訂單處理所必要之資料(如姓名、聯絡方式、收件地址),本公司將無法完成您的訂購、付款、出貨與售後服務。',
    ],
  },
  {
    heading: '七、Cookie 與第三方服務',
    paragraphs: [
      '本網站使用 Cookie 維持您的登入狀態;購物車內容、已選車輛與購物工作階段識別碼儲存於您瀏覽器的本機儲存空間(localStorage),您可自行透過瀏覽器清除。',
      '前述本機資料在下列情形會傳送至本公司伺服器:(一)頁面載入時,為向您顯示最新價格與供貨狀態,系統會將購物車內的商品識別碼送至伺服器查詢;(二)您按下結帳送出訂單時,會將商品、數量、您所選擇的車輛資訊及工作階段識別碼隨該筆訂單送出,作為建立訂單、防止重複扣款與後續客服查詢之用。',
      '金流由 TapPay、物流由配合之物流商處理,各依其隱私政策辦理。',
    ],
  },
  {
    heading: '八、資料安全',
    paragraphs: ['本網站以 HTTPS 加密傳輸,並採合理之技術與管理措施保護您的個人資料。'],
  },
  {
    heading: '九、政策修訂',
    paragraphs: ['本政策修訂時將公告於本網站,並更新版本日期。'],
  },
];

/**
 * 一份法律文件的完整對外表述:頁面標題、副標、SEO 描述、條文。
 * 🔴 `description` 也是**對外文字** —— 它進 `<meta name="description">`,
 *   客人在 Google 搜尋摘要與社群分享卡片上讀得到,和條文一樣會被援引。
 *   放進本結構(而非各 route 檔各寫一份)才進得了 hash、才守得住。
 */
export type LegalDoc = {
  /** canonical payload 的文件別前綴(穩定值,改動 = 換 hash)。 */
  key: 'TERMS' | 'PRIVACY';
  title: string;
  subtitle: string;
  description: string;
  sections: LegalSection[];
};

/**
 * 法律頁的**版面固定字**(麵包屑、標籤、瀏覽器分頁標題後綴)。
 *
 * 🔴 為什麼這些也要住在這裡、而不是寫死在元件/route 裡:
 *   它們同樣是客人在法律頁上讀到的字,寫死在別處 = 不進 `canonicalLegalPayload()`
 *   = 可以被改而 `CURRENT_TERMS_CONTENT_HASH` 不變,「hash 涵蓋客人讀到的全部文字」的宣稱就破了。
 *   (codex 關卡2 must-fix #2 實際抓到:`首頁`、`最後更新:`、`— PCM Motorsports` 三處都在涵蓋範圍外。)
 */
export const LEGAL_UI_STRINGS = {
  /** 麵包屑第一段(連往首頁)。 */
  breadcrumbHome: '首頁',
  /** 頁尾「最後更新」列的標籤(後接 LEGAL_LAST_UPDATED)。 */
  lastUpdatedLabel: '最後更新:',
  /** 瀏覽器分頁標題 = `${doc.title}${titleSuffix}`。 */
  titleSuffix: ' — PCM Motorsports',
} as const;

export const TERMS_DOC: LegalDoc = {
  key: 'TERMS',
  title: '服務條款',
  subtitle: '網路交易定型化契約條款',
  // 🔴 這裡**不寫**七日解除權相關字眼:第 10 條主張排除(Sean 拍板 B),
  //    SEO 描述若宣告「提供七日解除權」即與條文相反、且是客人與搜尋引擎最先讀到的一句。
  description:
    'PCM Motorsports(派達有限公司)網路交易服務條款:企業經營者資訊、契約成立、商品交付、付款方式、退貨與契約解除權、瑕疵擔保與消費爭議處理。',
  sections: TERMS_SECTIONS,
};

export const PRIVACY_DOC: LegalDoc = {
  key: 'PRIVACY',
  title: '隱私政策',
  subtitle: '個人資料蒐集、處理及利用告知',
  description:
    'PCM Motorsports(派達有限公司)隱私政策:個人資料之蒐集機構、目的、類別、利用期間與對象、您得行使之權利,以及 Cookie 與第三方服務說明。',
  sections: PRIVACY_SECTIONS,
};

/**
 * 對外法律文字的 **canonical 序列化**(= `legal_terms_versions.content_hash` 的雜湊來源)。
 *
 * 🔴 為什麼不直接雜湊本檔原始碼:檔案含註解、import、衍生邏輯 —— 改一個註解就換 hash,
 *   但客人讀到的字一個都沒變。content_hash 要回答的是「客人當時同意的是**哪一份文字**」,
 *   所以只序列化**真的會呈現給客人的字**:分頁標題(含後綴)/ 頁面標題 / 副標 / SEO 描述 /
 *   麵包屑與最後更新標籤 / 章節標題 / 內文段 / 條列 + 最後更新日。
 *   ⚠️ 涵蓋範圍是這個機制的成敗關鍵 —— 漏收一段,那段就能被改而 hash 不動、守門形同虛設。
 *   `legal-content-hash.test.ts` 逐項比對「LegalDocPage / route 實際輸出的每個欄位」vs 本函式收了什麼,
 *   且斷言的是**帶文件別與欄位型別的完整 canonical 行**(非整包 `toContain` —— 後者會被
 *   「同一句話剛好出現在別的條文裡」矇混過去,codex 關卡2 must-fix #3 實際抓到此假綠路徑)。
 *
 * 🔴 由 SSoT 衍生的值(電話、地址、統編、營業時間)已內嵌在條文字串裡 → 一併進 hash。
 *   這是**刻意**的:換電話 = 客人讀到的條款內容真的變了,理應換版本。
 *   ⇒ 改了任何對外文字(含 SSoT 聯絡資訊)而未 bump 版本,
 *     `legal-content-hash.test.ts` 會紅,逼你走完「migration seed → db push → bump」三步。
 *
 * 格式刻意用 `\t` 分隔的逐行文字(非 JSON):diff 時人眼看得懂差在哪一條。
 * 欄位序 = 文件別 / 章節序 / 種類 / 文字;種類 =
 *   B 麵包屑首段、U 最後更新日、X 最後更新標籤、
 *   M 分頁標題(含後綴)、T 頁標題、S 副標、D SEO 描述、
 *   H 章節標題、P 內文、L 條列。
 */
export function canonicalLegalPayload(): string {
  const serialize = (doc: LegalDoc): string[] => [
    `${doc.key}\t0\tM\t${doc.title}${LEGAL_UI_STRINGS.titleSuffix}`,
    `${doc.key}\t0\tT\t${doc.title}`,
    `${doc.key}\t0\tS\t${doc.subtitle}`,
    `${doc.key}\t0\tD\t${doc.description}`,
    ...doc.sections.flatMap((section, i) => [
      `${doc.key}\t${i + 1}\tH\t${section.heading}`,
      ...(section.paragraphs ?? []).map((p) => `${doc.key}\t${i + 1}\tP\t${p}`),
      ...(section.items ?? []).map((item) => `${doc.key}\t${i + 1}\tL\t${item}`),
    ]),
  ];

  return [
    `META\t0\tU\t${LEGAL_LAST_UPDATED}`,
    `META\t0\tX\t${LEGAL_UI_STRINGS.lastUpdatedLabel}`,
    `META\t0\tB\t${LEGAL_UI_STRINGS.breadcrumbHome}`,
    ...serialize(TERMS_DOC),
    ...serialize(PRIVACY_DOC),
    '',
  ].join('\n');
}
