// brand-focus.ts — 首頁 N°05「本月聚焦」的覆蓋層資料(D5e-1 建殼;D5e-2 搬滿 20 家,2026-08-05)
//
// 🔴 **這份檔只服務首頁 N°05 一個版位**,不是品牌頁的資料(Open Design
//    `pcm-home-redesign/brand-focus-data.js` 檔頭逐字)。品牌頁的唯一資料來源仍是
//    `brand-content.ts`。這裡放的是「首頁要多講的那一點點」,其餘一律從 `BRAND_CONTENT` 取。
//
// 真權威 = OD `pcm-home-redesign/brand-focus-data.js` + `N05-FOCUS-HANDOFF.md`(第二版)。
// 鐵則 1 例外 = 2026-08-03 Sean 拍 Q1=B(本線真權威在 Open Design)。
// ⚠️ 型別名對照:handoff 那邊叫 `BrandFocusCopy`,本檔叫 `BrandFocusOverlay`(同一個東西;
//    D5e-1 已定名、外部有引用,改名純製造斷鏈 ⇒ 保留現名,主視窗 C-104-A §二 #2 同此裁示)。
//
// 欄位契約(逐字照 OD `brand-focus-data.js` 檔頭,D5e-2 搬 20 家時零改形):
//   title → 一句鉤子。品牌名由版位另外顯示,標題**不重複寫品牌名**
//   photo → 產品／工藝特寫。刻意**不用** `brand.band`(那張是品牌頁的 hero),
//           首頁與品牌頁看到不同的照片,點進去才有「還有別的」的感覺
//   facts → 三則 [標籤, 值]。值一律取自 `BRAND_CONTENT` 該品牌的 facts,
//           不自行增列標籤、不改寫值。**沒有說明句** —— 說明句留在品牌頁
//   body  → 選填。不填就用 `BRAND_CONTENT` 的 `lede`,同一句話不維護兩份
//           (20 家裡只有 EVOTECH 與 GB RACING 兩家有,OD 檔頭逐字)
//
// 🔴 **每家上方的 `鉤子出處:` 註解是逐字搬來的,不要刪**(OD handoff §十逐字「不要編任何數字」)。
//    鉤子若要改字,先看那行出處還成不成立。其中兩家是 OD 端刻意降階過的:
//    DBK(原稿「創始元老」查無佐證 → 降為「是這家做出名的」)、
//    EAZI-GRIP(原稿「減輕 50%」查無來源 → 改成不含量化的說法)。**不要「加強」回去。**
//
// 🔴 **標點 = 全形**(2026-08-05 Sean 拍板,**推翻**舊規則;權威 = OD `N05-FOCUS-HANDOFF.md` §七)。
//    中文文案的逗號、冒號、分號、括號一律全形 —— `，：；（）。、`
//    判準:**前一個字是中文才全形**;英數字後面維持半形(`Pontyclun, South Wales`、
//    `mo.unit, mo.view` 是英文語境,全形會很怪)。資產路徑、HTML 標籤與實體、
//    規格數字(`2mm-12mm`、`7075-T6`)一律不動。
//    ⚠️ **搬過去時不要「順手修正」回半形**;守門在 `brand-focus-data.test.ts`。
//
// 🔴🔴 **LIGHTECH 的 Racing 值與 `brand-content.ts` 差一對括號,那是刻意的**:
//    本檔 = `（2026 SYNC SPEEDRS）`(全形,照新規則),`brand-content.ts` = `(2026 SYNC SPEEDRS)`(半形)。
//    OD 端已全面套用全形,而 `brand-content.ts` **這片不准動**(handoff §十 + 驗收第 12 條:
//    「除了新增 `wallTagline` 外一個字都沒動」)⇒ 兩邊在這一顆上必然不一致,直到全站標點遷移那片。
//    ⇒ 「facts 值取自 BRAND_CONTENT」那條守門**以 CJK 括號寬度正規化後比對**,並單獨釘住這一顆,
//      不是放寬成抽樣。細節見 `brand-focus-data.test.ts`。
//
// ⚠️ `body` 與 `title` 走 `BrandRichString`(白名單 `<strong>` / `<br>` / `&amp;`),
//    渲染端一律過 `BrandRichText`,**絕不 dangerouslySetInnerHTML**。
//    (目前 20 家的字面都不含標記,但型別維持不變 —— 哪天加了才不用回頭改渲染端。)
//
// 🔴 **內容分級 L2**(鐵則 9):首頁文案、季 1-3 次的變動頻率,hardcode 可但要有 backlog。
//    對照 `data/brand-content.ts` 同款標記;後台 CRUD 屬 backlog #271(信任狀/文案後台化)。

import type { BrandRichString } from './brand-content-types';

/** 一則事實:[標籤, 值]。刻意比 `BrandFact` 少一欄 —— 說明句留在品牌頁。 */
export type BrandFocusFact = readonly [label: string, value: string];

/** 首頁版位的覆蓋層。沒有的欄位由 `resolveBrandFocus` 從 `BRAND_CONTENT` 退。 */
export type BrandFocusOverlay = {
  title: BrandRichString;
  photo: string;
  /**
   * 恰好三則。**寫成定長三元組而不是陣列**(D5e-1 R2 nit;OD handoff 指定的也是三元組):
   * 一次貼 20 家,漏填一則的話陣列型別在編譯期完全看不出來。
   * (D5e-2 落地後這條仍承重:未來加第 21 家時漏填一樣是編譯期紅。)
   */
  facts: readonly [BrandFocusFact, BrandFocusFact, BrandFocusFact];
  /** 選填。不填就用 `BRAND_CONTENT` 的 `lede`。 */
  body?: BrandRichString;
};

/**
 * 20 家全員。鍵順序 = OD 檔的順序(照 slug 字母序),**但輪播順序不看這個** ——
 * 輪播吃 `BRAND_CONTENT[].focus.order`(`lib/brand-focus.ts` 的 `resolveBrandFocus`)。
 *
 * 🔴 D5e-1 的 `BRAND_FOCUS_PIN` 已於本片移除:它的存在理由是「20 家文案沒齊之前別讓輪播轉」,
 *    那個理由現在消失了。要單獨預覽某一家改用網址 `?focus=<slug>`(`app/page.tsx` 接的),
 *    不必改 code、Sean 自己就能驗。
 */
export const BRAND_FOCUS: Readonly<Record<string, BrandFocusOverlay>> = {
  // AKRAPOVIČ — 鉤子出處:自有鈦合金鑄造廠與冶金實驗室 · brand-content-data.js 既有事實
  'akrapovic': {
    title: '鈦合金從熔煉到焊道，都在自己的廠裡。',
    photo: 'assets/brands-prod/akrapovic/muffler.jpg',
    facts: [
      ['Founded', '1991 年'],
      ['Made in', '斯洛維尼亞'],
      ['Material', '鈦合金 · 碳纖維'],
    ],
  },
  // BONAMICI RACING — 鉤子出處:Sean 定稿 · 事實:加工老師傅 Luciano Bonamici,兒子 Riccardo 與 Enrico 承接
  'bonamici': {
    title: '父親的車床，兒子拿去做腳踏後移。',
    photo: 'assets/brands-prod/bonamici/rearset.jpg',
    facts: [
      ['Made in', '義大利 Otricoli'],
      ['Material', '航太級鋁合金'],
      ['Products', '腳踏後移 · 拉桿 · 防護'],
    ],
  },
  // CNC RACING — 鉤子出處:Sean 定稿 · 事實:1995 年起家於金飾機具,2008 年轉向機車部品
  'cnc-racing': {
    title: '同一批車床，以前做金飾，現在切離合器蓋。',
    photo: 'assets/brands-prod/cnc-racing/clutch.jpg',
    facts: [
      ['Founded', '1995 年'],
      ['Made in', '義大利 托斯卡尼 阿雷佐'],
      ['Material', '7075-T6 航太鋁 · 鈦合金'],
    ],
  },
  // DBK SPECIAL PARTS — 鉤子出處:motovationusa.com/ducabike-dbk-special-parts:widely known for their clear clutch covers
  'dbk': {
    title: '透明離合器蓋，是這家做出名的。',
    photo: 'assets/brands-prod/dbk/led-clutch.jpg',
    facts: [
      ['Founded', '2009 年'],
      ['Made in', '義大利'],
      ['Products', '引擎 · 腳踏 · 防護'],
    ],
  },
  // EAZI-GRIP — 鉤子出處:eazi-grip.com:膝部貼住油箱可減少肩腕壓力與 arm pump
  'eazi-grip': {
    title: '一對油箱止滑貼，手腕就不用一直撐著。',
    photo: 'assets/brands-prod/eazi-grip/tank-grip.jpg',
    facts: [
      ['Made in', '英國'],
      ['Material', '止滑貼 · 車身保護膜'],
      ['Genuine', '官方經銷識別'],
    ],
  },
  // EBC BRAKES — 鉤子出處:ebcbrakesdirect.com:Double-H 不含鐵粉,避免鏽蝕時來令片與碟盤沾黏
  'ebc': {
    title: '來令片不加鐵粉，才不會鏽在碟盤上。',
    photo: 'assets/brands-prod/ebc/disc.jpg',
    facts: [
      ['Made in', '英國／美國自有工廠'],
      ['Material', '有機 · 燒結配方'],
      ['Products', '煞車皮 · 機車碟盤'],
    ],
  },
  // EVOTECH PERFORMANCE — 鉤子出處:Sean 指定角度 · 「不做通用件」出自 brand-content-data.js lede;護網震動磨損為產業通則,未點名任何品牌
  'evotech': {
    title: '護網裝不對，反而會磨到水箱。',
    photo: 'assets/brands-prod/evotech/radiator-guard.jpg',
    body: '水箱護網要擋的不只是碎石。厚度與固定方式沒算好，護網會跟著震，反而磨傷水箱。EVOTECH 為特定車型單獨開發，不做通用件。',
    facts: [
      ['Founded', '2003 年'],
      ['Made in', '英國 英格蘭 林肯郡 Alford'],
      ['Racing', 'BSB · WSBK 車隊供應 · 曼島 TT'],
    ],
  },
  // EXTREME COMPONENTS — 鉤子出處:extreme-components.com 官方新聞 791:developed inside the wind tunnel to guarantee the best aerodynamic penetration。照片為官方 GP EVO 護弓產品圖,已墊白邊成 16:11
  'extreme': {
    title: '護弓的形狀，是在風洞裡吹出來的。',
    photo: 'assets/brands-prod/extreme/lever-guard.jpg',
    facts: [
      ['Founded', '逾十年'],
      ['Material', 'Ergal 7075 T6 · 預浸布複材'],
      ['Use', '賽道取向'],
    ],
  },
  // FRONT 3D — 鉤子出處:front3d.com:逐車款對應的工業 3D 列印件
  'front3d': {
    title: '3D 列印一開，冷門車款也有專屬擾流。',
    photo: 'assets/brands-prod/front3d/winglets.jpg',
    facts: [
      ['Made in', '西班牙'],
      ['Design', '工程設計出身'],
      ['Products', '擾流翼 · 側翼 · 車身件'],
    ],
  },
  // GB RACING — 鉤子出處:motodracing.com + alpharacing.com:二次護蓋防止摔車漏油與砂石侵入,厚度 2mm-12mm,GB Racing 於 2009 取得 FIM 認證
  'gb-racing': {
    title: '摔車的時候，先破的是這一層。',
    photo: 'assets/brands-prod/gb-racing/engine-cover.jpg',
    body: '賽會要求引擎外殼再加一層護蓋，為的是摔車滑行時機油不要灑在賽道上。這一層直接鎖在原廠外殼外面，依部位從 2mm 到 12mm 厚，由它承受磨耗。',
    facts: [
      ['Founded', '2007 年'],
      ['Approval', 'FIM 核准 · 自 2009'],
      ['Racing', 'MotoGP · WorldSBK · BSB'],
    ],
  },
  // GILLES TOOLING — 鉤子出處:eicma.it:創辦人 Gerhard Gilles 賽車十年後自製第一組可調腳踏
  'gilles': {
    title: '騎了十年賽車，受不了市售腳踏，乾脆自己做。',
    photo: 'assets/brands-prod/gilles/panigale-v4s.jpg',
    facts: [
      ['Founded', '2000 年'],
      ['Made in', '盧森堡 Grevenmacher'],
      ['Approval', 'TÜV · KBA · ISO 9001'],
    ],
  },
  // K-SPEED — 鉤子出處:Sean 定稿 · 事實:k-speed.com Diabolus 系列以消光黑為基調
  'k-speed': {
    title: '全車黑化，是這家泰國廠的招牌。',
    photo: 'assets/brands-prod/k-speed/royal-enfield.jpg',
    facts: [
      ['Founded', '2002 年'],
      ['Models', 'Honda · Royal Enfield · Triumph · BMW 等'],
      ['Service', 'Full Custom'],
    ],
  },
  // KINEO — 鉤子出處:Sean 定稿 · 事實:kineoshop.com 輪轂為 7000 系鍛造、輪框 billet CNC,鋼絲頭與輪軸平行不鑽穿孔(國際專利)
  'kineo': {
    title: '鋼絲框用鍛造輪圈的標準做，才跑得了無內胎。',
    photo: 'assets/brands-prod/kineo/hub-spokes.jpg',
    facts: [
      ['Made in', '義大利'],
      ['Material', '鋼絲框 · 整組輪組'],
      ['Fitment', '車型專用規格'],
    ],
  },
  // LIGHTECH — 鉤子出處:speedmania.it:創辦人 Fabrizio Furlan 為前 SBK 車手,家族 Torneria Piave 加工廠
  'lightech': {
    title: '一位前 SBK 車手，把家族車床廠接了下來。',
    photo: 'assets/brands-prod/lightech/tankcap-gold.jpg',
    facts: [
      ['Founded', '1997 年'],
      ['Material', 'Ergal 航太鋁 · 鈦合金'],
      ['Racing', 'WSBK · Moto2 技術支援（2026 SYNC SPEEDRS）'],
    ],
  },
  // MATERYA — 鉤子出處:materya.shop/about-me:Mirco Sapio 自發想、繪製、塑形到實現一手完成
  'materya': {
    title: '一個工業設計師，從畫圖到成品自己做完。',
    photo: 'assets/brands-prod/materya/flyscreen.jpg',
    facts: [
      ['Made in', '義大利 米蘭'],
      ['Material', '射出成型 · 碳纖維 · 3D 列印'],
      ['Products', '風鏡 · 儀表蓋 · 賽道牌照板'],
    ],
  },
  // MOTOGADGET — 鉤子出處:motogadget.com:motoscope 為 LED 數位儀表,mo.view 為無鏡片後視鏡
  'motogadget': {
    title: '後視鏡沒有鏡片，儀表沒有指針。',
    photo: 'assets/brands-prod/motogadget/motoscope.jpg',
    facts: [
      ['Founded', '2000 年'],
      ['Tech', 'mo.unit · mo.view'],
      ['Approval', 'ECE 核准'],
    ],
  },
  // RIZOMA — 鉤子出處:motorcyclepowersportsnews.com:2001 年一位車友來找後視鏡,兄弟倆做了鏡座才有這家公司
  'rizoma': {
    title: '第一件產品，是幫一位車友做的後視鏡。',
    photo: 'assets/brands-prod/rizoma/stealth-mirror.jpg',
    facts: [
      ['Founded', '2001 年'],
      ['Made in', '義大利 米蘭近郊 Ferno'],
      ['Material', '金屬加工與表面處理'],
    ],
  },
  // RPM CARBON — 鉤子出處:rpmcarbon.com/pages/about-us:PrePreg DryCarbon 高壓釜壓製、車型專用直上件
  'rpm-carbon': {
    title: '碳纖維外觀件，不用切割也不用打孔。',
    photo: 'assets/brands-prod/rpm-carbon/craft-weave.jpg',
    facts: [
      ['Founded', '2018 年'],
      ['Made in', '泰國'],
      ['Material', 'PrePreg DryCarbon · Autoclave 壓製'],
    ],
  },
  // SAMCO SPORT — 鉤子出處:samcosport.com:Hand made and tested in our own UK factory,廠址 Pontyclun, South Wales
  'samco': {
    title: '每一條矽膠水管，都在南威爾斯用手捲成。',
    photo: 'assets/brands-prod/samco/colours.jpg',
    facts: [
      ['Founded', '1990 年'],
      ['Made in', '英國 威爾斯 Pontyclun'],
      ['Material', '高性能矽膠 · 多層補強手工疊層'],
    ],
  },
  // WRS — 鉤子出處:wrsusa.com:WRS 為 Pramac Ducati MotoGP 技術供應商,PMMA 與世界賽用料相同
  'wrs': {
    title: '風鏡用的壓克力，跟 MotoGP 場上同一種。',
    photo: 'assets/brands-prod/wrs/motogp-screen.jpg',
    facts: [
      ['Made in', '義大利 Cattolica'],
      ['Material', 'PMMA Plexiglas'],
      ['Racing', 'MotoGP · WorldSBK 廠隊供應'],
    ],
  },
};
