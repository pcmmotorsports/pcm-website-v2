/**
 * Mock brand catalog — 字面從 design-reference/data/products.js @ 25d3a2a 直接搬(M-1-04-mini-slice 修:25d3a2a 加 5 新 brands rizoma/akrapovic/brembo/ohlins/termignoni + premium_extra_pct;mock 不對齊、d2 已走 Supabase、mock d1 era artifact 未來廢)
 * BrandIndex section 用、d2 接 SupabaseBrandAdapter(M-1-14 / Phase 2)時 fallback
 */

export type MockBrand = {
  id: string;
  name: string;
  count: number;
  country: string;
  tagline: string;
  since: number;
  hero: string;
  logo: string;
  logoBg: string;
  heroText?: string;
};

export const MOCK_BRANDS: MockBrand[] = [
  { id: 'bonamici', name: 'BONAMICI RACING', count: 45, country: 'IT', tagline: '頂尖賽事改裝組件', since: 2005, hero: '#fff5e0', logo: 'assets/brand-logos/bonamici.webp', logoBg: 'transparent', heroText: 'dark' },
  { id: 'cnc-racing', name: 'CNC RACING', count: 52, country: 'IT', tagline: '極致切削美學', since: 2008, hero: '#fbe7b3', logo: 'assets/brand-logos/cnc-racing.avif', logoBg: 'transparent', heroText: 'dark' },
  { id: 'dbk', name: 'DBK SPECIAL PARTS', count: 28, country: 'IT', tagline: '義式細節的改裝靈魂', since: 2008, hero: '#ffe9e1', logo: 'assets/brand-logos/dbk.webp', logoBg: 'transparent', heroText: 'dark' },
  { id: 'eazi-grip', name: 'EAZI-GRIP', count: 36, country: 'UK', tagline: '極致操控:油箱止滑專家', since: 2011, hero: '#e2e6ec', logo: 'assets/brand-logos/eazi-grip.webp', logoBg: 'transparent', heroText: 'dark' },
  { id: 'evotech', name: 'EVOTECH PERFORMANCE', count: 68, country: 'UK', tagline: '英式硬核防護與極簡設計', since: 2003, hero: '#1a1a1a', logo: 'assets/logos/evotech-performance.png', logoBg: 'transparent' },
  { id: 'extreme', name: 'EXTREME COMPONENTS', count: 34, country: 'IT', tagline: '競技級碳纖維與賽道件', since: 2004, hero: '#fde7a8', logo: 'assets/brand-logos/extreme.png', logoBg: 'transparent', heroText: 'dark' },
  { id: 'front3d', name: 'FRONT 3D', count: 18, country: 'ES', tagline: '3D 列印創新改裝件', since: 2015, hero: '#0c1838', logo: 'assets/brand-logos/front3d.avif', logoBg: 'transparent' },
  { id: 'gb-racing', name: 'GB RACING', count: 42, country: 'UK', tagline: '引擎守護者:賽道規格防護', since: 2007, hero: '#1a0606', logo: 'assets/brand-logos/gb-racing.png', logoBg: 'transparent' },
  { id: 'gilles', name: 'GILLES TOOLING', count: 56, country: 'LU', tagline: '盧森堡精密控制系統', since: 2000, hero: '#d8e6f5', logo: 'assets/brand-logos/gilles.svg', logoBg: 'transparent', heroText: 'dark' },
  { id: 'kineo', name: 'KINEO', count: 22, country: 'IT', tagline: '手工鍛造鋼絲輪框的巔峰', since: 2009, hero: '#ecdcb8', logo: 'assets/brand-logos/kineo.png', logoBg: 'transparent', heroText: 'dark' },
  { id: 'lightech', name: 'LIGHTECH', count: 74, country: 'IT', tagline: '義式賽道工藝精品', since: 1997, hero: '#f7eab8', logo: 'assets/brand-logos/lightech.png', logoBg: 'transparent', heroText: 'dark' },
  { id: 'materya', name: 'MATERYA', count: 24, country: 'IT', tagline: '數位美學的極致體現', since: 2018, hero: '#0a0e1a', logo: 'assets/brand-logos/materya.webp', logoBg: 'transparent' },
  { id: 'motogadget', name: 'MOTOGADGET', count: 32, country: 'DE', tagline: '德系極簡電系工藝', since: 2004, hero: '#dde0e6', logo: 'assets/brand-logos/motogadget.svg', logoBg: 'transparent', heroText: 'dark' },
  { id: 'rizoma', name: 'RIZOMA', count: 38, country: 'IT', tagline: '米蘭 CNC 削切的工藝精品', since: 2000, hero: '#0a0a0a', logo: 'assets/brand-logos/rizoma.webp', logoBg: 'transparent' },
  { id: 'rpm-carbon', name: 'RPM CARBON', count: 38, country: 'TH', tagline: '頂級真空碳纖維專家', since: 2010, hero: '#1c0a0a', logo: 'assets/brand-logos/rpm-carbon.avif', logoBg: 'transparent' },
  { id: 'samco', name: 'SAMCO SPORT', count: 44, country: 'UK', tagline: '全球防爆水管領導品牌', since: 1990, hero: '#cee0f5', logo: 'assets/brand-logos/samco.svg', logoBg: 'transparent', heroText: 'dark' },
  { id: 'wrs', name: 'WRS', count: 26, country: 'IT', tagline: '頂級風鏡:冠軍視野', since: 2008, hero: '#ffffff', logo: 'assets/logos/wrs.png', logoBg: 'transparent', heroText: 'dark' },
];
