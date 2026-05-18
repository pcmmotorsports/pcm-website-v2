/**
 * Mock category tree(零件分類巢狀)— 字面從 design-reference/data/products.js L73-157 直接搬
 * FilterSide / FilterTop / FilterDrawer 的「零件分類」樹用、d2 接 Supabase category 真資料時 fallback
 *
 * 內容分級 L2(分類偶爾季度調整)— hardcode 可接受、待 Phase 2 後台 category CRUD 取代(backlog #147)
 */

export type MockCategorySub = {
  id: string;
  name: string;
  count: number;
};

export type MockCategory = {
  id: string;
  name: string;
  count: number;
  children: MockCategorySub[];
};

export const MOCK_CATEGORIES: MockCategory[] = [
  { id: 'agency', name: '代理配件', count: 639, children: [
    { id: 'bonamici-line', name: 'BONAMICI RACING', count: 45 },
    { id: 'cnc-line', name: 'CNC RACING', count: 52 },
    { id: 'dbk-line', name: 'DBK SPECIAL PARTS', count: 28 },
    { id: 'eazi-line', name: 'EAZI-GRIP', count: 36 },
    { id: 'evotech-line', name: 'EVOTECH PERFORMANCE', count: 68 },
    { id: 'extreme-line', name: 'EXTREME COMPONENTS', count: 34 },
    { id: 'front3d-line', name: 'FRONT 3D', count: 18 },
    { id: 'gb-line', name: 'GB RACING', count: 42 },
    { id: 'gilles-line', name: 'GILLES TOOLING', count: 56 },
    { id: 'kineo-line', name: 'KINEO', count: 22 },
    { id: 'lightech-line', name: 'LIGHTECH', count: 74 },
    { id: 'materya-line', name: 'MATERYA', count: 24 },
    { id: 'motogadget-line', name: 'MOTOGADGET', count: 32 },
    { id: 'rpm-line', name: 'RPM CARBON', count: 38 },
    { id: 'samco-line', name: 'SAMCO SPORT', count: 44 },
    { id: 'wrs-line', name: 'WRS', count: 26 },
  ]},
  { id: 'body-protection', name: '車身防護', count: 142, children: [
    { id: 'engine-cover', name: '引擎護蓋', count: 38 },
    { id: 'frame-slider', name: '車架防倒球', count: 24 },
    { id: 'axle-slider', name: '輪軸防摔塊', count: 18 },
    { id: 'crash-bar', name: '防倒側架', count: 14 },
    { id: 'tank-pad', name: '油箱貼片', count: 12 },
    { id: 'fender', name: '土除 / 前後土除', count: 20 },
    { id: 'cover', name: '車身護板', count: 16 },
  ]},
  { id: 'wheels', name: '輪框', count: 24, children: [
    { id: 'forged', name: '鍛造輪框', count: 12 },
    { id: 'carbon-wheel', name: '碳纖輪框', count: 6 },
    { id: 'wheel-accessory', name: '氣嘴 / 平衡塊', count: 6 },
  ]},
  { id: 'exhaust', name: '排氣管', count: 58, children: [
    { id: 'full-system', name: '全段排氣', count: 18 },
    { id: 'slip-on', name: '尾段 / Slip-On', count: 22 },
    { id: 'mid-pipe', name: '中段', count: 10 },
    { id: 'db-killer', name: '消音塞 / 配件', count: 8 },
  ]},
  { id: 'track', name: '賽道用精品', count: 72, children: [
    { id: 'rearset', name: '腳踏後移', count: 24 },
    { id: 'quickshifter', name: '快排系統', count: 14 },
    { id: 'race-bodywork', name: '賽道整流罩', count: 12 },
    { id: 'steering-damper', name: '方向舵', count: 10 },
    { id: 'fuel-cap', name: '競技油箱蓋', count: 12 },
  ]},
  { id: 'suspension', name: '懸吊系統', count: 38, children: [
    { id: 'front-fork', name: '前叉', count: 14 },
    { id: 'rear-shock', name: '後避震', count: 18 },
    { id: 'linkage', name: '連桿 / 加高器', count: 6 },
  ]},
  { id: 'carbon', name: '碳纖維', count: 54, children: [
    { id: 'carbon-fender', name: '碳纖土除', count: 12 },
    { id: 'carbon-panel', name: '碳纖飾板', count: 18 },
    { id: 'carbon-tank', name: '碳纖油箱罩', count: 10 },
    { id: 'carbon-heat', name: '碳纖排氣防燙', count: 8 },
    { id: 'carbon-other', name: '其他碳纖部品', count: 6 },
  ]},
  { id: 'oem', name: '原廠零件', count: 220, children: [
    { id: 'oem-jp', name: '日系原廠', count: 90 },
    { id: 'oem-eu', name: '歐系原廠 (BMW/DUCATI)', count: 82 },
    { id: 'oem-thai', name: '泰規 / 印尼規', count: 28 },
    { id: 'oem-kit', name: '原廠精品套件', count: 20 },
  ]},
  { id: 'brake', name: '制動系統', count: 56, children: [
    { id: 'caliper', name: '卡鉗', count: 14 },
    { id: 'disc', name: '碟盤', count: 18 },
    { id: 'pad', name: '來令片', count: 16 },
    { id: 'hose', name: '金屬油管', count: 8 },
  ]},
  { id: 'consumable', name: '耗材零件工具', count: 94, children: [
    { id: 'oil', name: '機油 / 齒輪油', count: 22 },
    { id: 'filter', name: '機油芯 / 空濾', count: 18 },
    { id: 'spark', name: '火星塞', count: 8 },
    { id: 'chain', name: '鏈條 / 齒盤', count: 16 },
    { id: 'tools', name: '工具 / 保養用品', count: 30 },
  ]},
  { id: 'bling', name: '車身改裝精品', count: 88, children: [
    { id: 'mirror', name: '後視鏡', count: 18 },
    { id: 'led', name: 'LED 方向燈', count: 14 },
    { id: 'tail-tidy', name: '尾架整理器', count: 22 },
    { id: 'lever', name: '拉桿 / 可調式拉桿', count: 18 },
    { id: 'key', name: '鑰匙蓋 / 油箱蓋', count: 16 },
  ]},
];
