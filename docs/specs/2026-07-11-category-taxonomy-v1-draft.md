# 報價單↔網站分類一致化 — 分類定稿 v1.2(2026-07-11 Sean 拍板)

> 2026-07-11。狀態:**分類體系已定稿(v1.2);程式未動,實作前仍走鐵則 8 提 plan**。
> 拍板背景(同日 Sean 四拍板,詳 memory `project_category-taxonomy-unification-2026-07-11`):
> Q1=A 報價單當唯一大腦 / Q2=A 兩層樹+台灣口語 / Q3=A 草案先行 / Q4=A 車型軸另開計畫。

## 1. 為什麼重整(一段話)

兩邊分類已漂移(B 庫 17 大類含「避震系統」無「碳纖維部品」;網站 17 類相反),且現行大類是倉管視角:「操控部品」12,037 筆、「引擎部品」14,788 筆(其中 13,471 筆其實是 samco 防爆水管)——客人視角等於沒分類。競品實查(Webike TW/蝦皮/REYS/RPM-Motor/RevZilla)顯示:排氣/煞車/懸吊每站獨立成類;台灣消費者用口語零件名(拉桿/短牌架/防摔球/止滑貼)搜尋,不用系統學名。

## 2. 設計原則(草案 v1 依據)

1. **台灣口語優先**:子類名採台灣騎士慣用詞(短牌架、腳踏後移、防爆水管、油箱止滑貼、來令片、駐車球)。
2. **業界鐵三角獨立**:排氣系統、煞車系統、懸吊(與車架)各自成大類,即使目前量小。
3. **精品主力不埋雜項**:PCM 定位近本土精品站(REYS/RPM-Motor),拉桿、腳踏後移、車身防護、精品螺絲各自成類/子類,不塞「操控部品」大水桶。
4. **材質 vs 部位衝突規則**:碳纖維「車殼/整流罩/護蓋」歸碳纖維部品(客人確實用材質找);功能性碳件(碳纖拉桿護弓、碳纖腳踏翅膀)歸功能類。
5. **每商品單一主類**(沿用現行單 category 模型,不做多重歸類)。

## 3. 新分類樹(14 大類 / 50 子類;數字=映射腳本自動計算)

拍板選項寫「10-12 大類」,實作草案收在 14:多出的 2 個是「精品螺絲與五金」(5,340 筆,lightech 螺絲 4,346 筆是現行「操控部品」大水桶主因,值得獨立)與「四輪 ATV/UTV」(客群不同)。若要壓回 12:候選=「懸吊與車架」併入「把手與拉桿」改稱操控、「保護貼膜」併入「騎士配件」——不建議,理由見 §5 Q2。
| 新大類 | 商品數 | 子類(商品數) |
|---|---:|---|
| **碳纖維部品** | 9,728 | 碳纖維土除 ≈1,000、油箱罩與側蓋 ≈2,020、尾殼與單座蓋 ≈756、整流罩與下導流 ≈750、車頭罩與大燈罩 ≈590、儀表與風鏡外蓋 ≈527、定風翼與擾流 ≈525、鏈條蓋與齒盤護蓋 ≈653、引擎與排氣護蓋 ≈880、車台護蓋 ≈376、腳踏翅膀 ≈319、進氣與水箱導管 ≈440、其他碳纖維飾件 ≈892 |
| **腳踏後移與傳動** | 1,578 | 腳踏後移組 1,059、齒盤與傳動 256、鏈條調整器 209、腳踏配件 43、鏈條護蓋 11 |
| **拉桿與把手** | 2,471 | 煞車離合器拉桿 ≈1,200、握把與平衡端子 ≈454、拉桿護弓 349、把手與分離把 285、手把開關與週邊 183 |
| **排氣系統** | 730 | 尾段排氣管(Slip-On) 279、全段排氣管 216、頭段與中段 96、排氣管配件 63、隔熱罩與防燙蓋 34、觸媒轉換器 24、消音塞 18 |
| **止滑貼與保護膜** | 5,142 | 油箱止滑貼 3,011、儀表保護貼 850、車身保護膜(犀牛皮) 839、保護貼套裝組合 442 |
| **引擎與冷卻** | 14,714 | 防爆水管組 13,165、水管束環 671、離合器機構與分泵 ≈278、離合器外蓋 ≈272、機油孔蓋 168、引擎精品件 160 |
| **車身防護與防摔** | 2,353 | 車身防倒球與滑塊 1,064、引擎護蓋與護桿 567、輪軸防倒球 243、車架護蓋與孔塞 231、水箱護網 204、儀表護蓋 44 |
| **精品螺絲與螺帽** | 5,340 | 精品螺絲組 5,120、精品螺帽 220 |
| **煞車系統** | 584 | 油杯與油杯蓋 ≈379、煞車皮(來令片) 112、卡鉗護蓋與散熱導風罩 75、煞車碟盤 ≈18 |
| **懸吊與車架** | 359 | 車架與前叉部品 256、三角台 68、避震器 29、輪圈 6 |
| **燈具與電子** | 1,044 | 電裝與線材 ≈604、方向燈 246、儀表與控制器 ≈90、尾燈 56、大燈與護網 48 |
| **外觀與後視鏡** | 3,201 | 短牌架 1,653、端子後照鏡 604、油箱蓋 335、土除與外觀飾蓋 201、風鏡與定風翼 196、座椅與坐墊 171、後照鏡蓋與配件 41 |
| **騎士用品與配件** | 2,139 | 手機架與導航支架 1,229、駐車架與駐車球 309、其他配件(待細分) 234、攝影機支架 151、騎士服飾 112、精品小物 58、行李與包袋 46 |
| **四輪 ATV/UTV** | 460 | 防爆水管組 437、水管束環 23 |

合計 49,843 筆(=B 庫 storefront_catalog_v 全量,2026-07-11 快照);未映射 0 筆。

### 附錄:每子類來源對照(原廠分類 → 新子類)

#### 碳纖維部品(9,728)

| 子類 | 來源(供應商 / 原廠分類 / 舊大類 / 筆數) |
|---|---|
| **碳纖維土除**(≈1,000) | rpm+lightech+cnc / 品名關鍵字規則(29 組) / 舊:車殼外觀 / 9,728 |
| **油箱罩與側蓋**(≈2,020) | rpm+lightech+cnc / 品名關鍵字規則(29 組) / 舊:車殼外觀 / 9,728 |
| **尾殼與單座蓋**(≈756) | rpm+lightech+cnc / 品名關鍵字規則(29 組) / 舊:車殼外觀 / 9,728 |
| **整流罩與下導流**(≈750) | rpm+lightech+cnc / 品名關鍵字規則(29 組) / 舊:車殼外觀 / 9,728 |
| **車頭罩與大燈罩**(≈590) | rpm+lightech+cnc / 品名關鍵字規則(29 組) / 舊:車殼外觀 / 9,728 |
| **儀表與風鏡外蓋**(≈527) | rpm+lightech+cnc / 品名關鍵字規則(29 組) / 舊:車殼外觀 / 9,728 |
| **定風翼與擾流**(≈525) | rpm+lightech+cnc / 品名關鍵字規則(29 組) / 舊:車殼外觀 / 9,728 |
| **鏈條蓋與齒盤護蓋**(≈653) | rpm+lightech+cnc / 品名關鍵字規則(29 組) / 舊:車殼外觀 / 9,728 |
| **引擎與排氣護蓋**(≈880) | rpm+lightech+cnc / 品名關鍵字規則(29 組) / 舊:車殼外觀 / 9,728 |
| **車台護蓋**(≈376) | rpm+lightech+cnc / 品名關鍵字規則(29 組) / 舊:車殼外觀 / 9,728 |
| **腳踏翅膀**(≈319) | rpm+lightech+cnc / 品名關鍵字規則(29 組) / 舊:車殼外觀 / 9,728 |
| **進氣與水箱導管**(≈440) | rpm+lightech+cnc / 品名關鍵字規則(29 組) / 舊:車殼外觀 / 9,728 |
| **其他碳纖維飾件**(≈892) | rpm+lightech+cnc / 品名關鍵字規則(29 組) / 舊:車殼外觀 / 9,728 |

#### 腳踏後移與傳動(1,578)

| 子類 | 來源(供應商 / 原廠分類 / 舊大類 / 筆數) |
|---|---|
| **腳踏後移組**(1,059) | lightech / Rear Sets(腳踏後移) / 舊:操控部品 / 615<br>cncracing / Rearsets(腳踏後移組) / 舊:操控部品 / 246<br>bonamici / Rearsets(腳踏後移組) / 舊:操控部品 / 80<br>bonamici / Carbon accessories for rearsets / 舊:操控部品 / 48<br>bonamici / Rearsets spare parts / 舊:操控部品 / 40<br>bonamici / Rearsets accessories / 舊:操控部品 / 22<br>bonamici / rearsets spare parts / 舊:操控部品 / 8 |
| **齒盤與傳動**(256) | cncracing / Transmission(傳動齒盤組) / 舊:傳動齒比 / 252<br>lightech / Transmission(傳動) / 舊:傳動齒比 / 4 |
| **鏈條調整器**(209) | lightech / Chain Adjusters(鏈條調整器) / 舊:操控部品 / 126<br>bonamici / Chain Adjusters(鏈條調整器) / 舊:操控部品 / 83 |
| **腳踏配件**(43) | evotech / Footrest Blanking Plates / 舊:操控部品 / 30<br>akrapovic / Adventure Footpeg Set / 舊:操控部品 / 9<br>evotech / Toe Guards / 舊:操控部品 / 2<br>front3d / Heel Protector / 舊:操控部品 / 2 |
| **鏈條護蓋**(11) | gbracing / CHAIN GUARDS(鏈條護蓋) / 舊:操控部品 / 8<br>front3d / Sproket Guard / 舊:操控部品 / 2<br>front3d / Racing Sproket Guard / 舊:操控部品 / 1 |

#### 拉桿與把手(2,471)

| 子類 | 來源(供應商 / 原廠分類 / 舊大類 / 筆數) |
|---|---|
| **煞車離合器拉桿**(≈1,200) | cncracing / Clutch-brake levers(煞車與離合器拉桿) / 舊:操控部品 / 401<br>evotech / Brake/Clutch Levers / 舊:操控部品 / 351<br>lightech / Brake and Clutch Levers(煞車/離合器拉桿) / 舊:操控部品 / 253<br>bonamici / Brake And Clutch Levers(煞車與離合器拉桿) / 舊:操控部品 / 36<br>cncracing / Clutch-brake levers / 舊:操控部品 / 36<br>bonamici / Brake Levers With Remote Adjuster(煞車拉桿（含遠端調整）) / 舊:操控部品 / 34<br>bonamici / Brake Levers(煞車拉桿) / 舊:操控部品 / 25<br>bonamici / Clutch Levers(離合器拉桿) / 舊:操控部品 / 21<br>bonamici / Remote Adjuster(遠端調整器) / 舊:操控部品 / 13<br>bonamici / Complete Clutch Levers(離合器拉桿總成) / 舊:操控部品 / 10<br>lightech / Lever(拉桿) / 舊:操控部品 / 6<br>bonamici / Remote adjuster spare parts / 舊:操控部品 / 2<br>kspeed / Brake 品名含拉桿 / 舊:煞車系統 / 12 |
| **握把與平衡端子**(≈454) | lightech / Handlebar Balancers(平衡端子) / 舊:操控部品 / 289<br>evotech / Bar End Weights / 舊:操控部品 / 122<br>kspeed / Handgrip(握把套) / 舊:操控部品 / 34<br>motogadget / Handlebar Accessories / 舊:騎士好物 / 8<br>kspeed / Brake 品名含握把 / 舊:煞車系統 / 1 |
| **拉桿護弓**(349) | evotech / Brake / Clutch Protectors / 舊:操控部品 / 132<br>lightech / Lever Protections(拉桿護弓) / 舊:操控部品 / 111<br>gbracing / BRAKE & CLUTCH LEVER GUARDS(拉桿護弓) / 舊:操控部品 / 58<br>bonamici / Lever Protections(拉桿護弓) / 舊:操控部品 / 32<br>evotech / Hand Guard Protectors / 舊:操控部品 / 14<br>bonamici / Lever protections spare parts / 舊:操控部品 / 1<br>bonamici / Carbon lever protection / 舊:操控部品 / 1 |
| **把手與分離把**(285) | cncracing / Handlebars(把手與分離把) / 舊:操控部品 / 160<br>kspeed / Handlebar(把手) / 舊:操控部品 / 44<br>lightech / Handlebar Clip-ons(分離把) / 舊:操控部品 / 35<br>bonamici / Clip-ons(分離式把手) / 舊:操控部品 / 30<br>evotech / Handle Bar Risers / 舊:操控部品 / 11<br>bonamici / Clip-ons spare parts / 舊:操控部品 / 4<br>cncracing / Handlebars / 舊:操控部品 / 1 |
| **手把開關與週邊**(183) | motogadget / (NULL) / 舊:操控部品 / 94<br>cncracing / Handlebar Switches(手把開關) / 舊:電子系統 / 38<br>cncracing / Handlebar Switches / 舊:電子系統 / 31<br>kspeed / Switch(開關) / 舊:電子系統 / 20 |

#### 排氣系統(730)

| 子類 | 來源(供應商 / 原廠分類 / 舊大類 / 筆數) |
|---|---|
| **尾段排氣管(Slip-On)**(279) | akrapovic / Slip-On Line / 舊:排氣系統 / 256<br>akrapovic / Slip-On Line Track Day / 舊:排氣系統 / 3<br>akrapovic / Slip-On Line GSX-R 600 / 舊:排氣系統 / 2<br>akrapovic / Slip-On Line Integra / 舊:排氣系統 / 2<br>akrapovic / Slip-On Line Gilera / 舊:排氣系統 / 2<br>akrapovic / Slip-On Line GSX-R 600 11- / 舊:排氣系統 / 2<br>akrapovic / Slip-On Line K 1200 R / 舊:排氣系統 / 1<br>akrapovic / Slip-On Line WR 450 F / 舊:排氣系統 / 1<br>akrapovic / Slip-On Line MT-03 / 舊:排氣系統 / 1<br>akrapovic / Slip-On Line R 1200 GS / 舊:排氣系統 / 1<br>akrapovic / Slip-On Line CBR 1000 RR ABS / 舊:排氣系統 / 1<br>akrapovic / Slip-On Line MBK / 舊:排氣系統 / 1<br>akrapovic / Slip-On Line 06-08 / 舊:排氣系統 / 1<br>akrapovic / Slip-On Line GT / 舊:排氣系統 / 1<br>akrapovic / Slip-On Track day Link pipe/Collector / 舊:排氣系統 / 1<br>akrapovic / Slip-On Line 1098 / 1098S / 舊:排氣系統 / 1<br>akrapovic / Slip-On Line 700 / 舊:排氣系統 / 1<br>akrapovic / Slip-On Line RSV4 / 舊:排氣系統 / 1 |
| **全段排氣管**(216) | akrapovic / Racing Line / 舊:排氣系統 / 87<br>kspeed / Exhaust(排氣管) / 舊:排氣系統 / 77<br>akrapovic / Evolution Line / 舊:排氣系統 / 43<br>akrapovic / Racing Line - for Adventure Sports / 舊:排氣系統 / 2<br>akrapovic / Racing Line MT-03 / 舊:排氣系統 / 2<br>akrapovic / Evolution Line KIT / 舊:排氣系統 / 1<br>akrapovic / Evolution Header / 舊:排氣系統 / 1<br>akrapovic / Open Line Nightrod / 舊:排氣系統 / 1<br>akrapovic / EVO KIT Track day Link pipe / 舊:排氣系統 / 1<br>akrapovic / Racing Line MT-07 / 舊:排氣系統 / 1 |
| **頭段與中段**(96) | akrapovic / Optional Header / 舊:排氣系統 / 59<br>akrapovic / Optional Link Pipe / 舊:排氣系統 / 10<br>akrapovic / Link Pipe / 舊:排氣系統 / 8<br>akrapovic / Optional Link Pipe/Collector / 舊:排氣系統 / 5<br>akrapovic / Optional header / 舊:排氣系統 / 4<br>akrapovic / Track Day Link Pipe / 舊:排氣系統 / 3<br>akrapovic / Optional Header - for Adventure Sports / 舊:排氣系統 / 2<br>akrapovic / Track day Link pipe/Collector / 舊:排氣系統 / 2<br>akrapovic / Track Day Link Pipe/Collector / 舊:排氣系統 / 2<br>akrapovic / Optional Collector / 舊:排氣系統 / 1 |
| **排氣管配件**(63) | evotech / Exhaust Hangers / 舊:排氣系統 / 28<br>akrapovic / Muffler bracket / 舊:排氣系統 / 12<br>akrapovic / Muffler Bracket / 舊:排氣系統 / 5<br>akrapovic / Fitting Kit / 舊:排氣系統 / 2<br>akrapovic / Fitting Kit for mounting on Triumph Daytona 660 / 舊:排氣系統 / 1<br>akrapovic / Fitting Kit for mounting on Yamaha Tracer 9 / GT / GT+ MY 2021-23 / 舊:排氣系統 / 1<br>akrapovic / Fitting Kit for mounting on Yamaha MT-09/FZ-09 MY 2024-2026 / 舊:排氣系統 / 1<br>akrapovic / Track Day Fitting  Kit / 舊:排氣系統 / 1<br>akrapovic / Fitting Kit for mounting on Triumph Trident 660 / 舊:排氣系統 / 1<br>akrapovic / Reassembly Set / 舊:排氣系統 / 1<br>akrapovic / Fitting Kit for mounting on Triumph Tiger Sport 660 / 舊:排氣系統 / 1<br>akrapovic / Optional muffler bracket for racing subframe / 舊:排氣系統 / 1<br>akrapovic / Saddle bag lift kit FLSTC / 舊:排氣系統 / 1<br>akrapovic / Fitting Kit for mounting on Yamaha MT-09/FZ-09 MY 2021-2023 / 舊:排氣系統 / 1<br>akrapovic / Valve system / 舊:排氣系統 / 1<br>akrapovic / Fitting Kit for mounting on Yamaha Tracer 9 / GT / GT+ MY 2024 / 舊:排氣系統 / 1<br>akrapovic / Muffler bracket with Muffler clamp / 舊:排氣系統 / 1<br>akrapovic / Shock absorber bracket / 舊:排氣系統 / 1<br>akrapovic / Spark Arrester Set / 舊:排氣系統 / 1<br>akrapovic / Passenger footrest fitting kit / 舊:排氣系統 / 1 |
| **隔熱罩與防燙蓋**(34) | akrapovic / Heat Shield / 舊:排氣系統 / 33<br>akrapovic / Heat Shield Set / 舊:排氣系統 / 1 |
| **觸媒轉換器**(24) | akrapovic / Catalytic converter / 舊:排氣系統 / 19<br>akrapovic / Catalytic converter Set / 舊:排氣系統 / 3<br>akrapovic / Catalytic converter S / 舊:排氣系統 / 2 |
| **消音塞**(18) | akrapovic / Optional Noise Damper / 舊:排氣系統 / 11<br>akrapovic / Optional noise damper / 舊:排氣系統 / 4<br>akrapovic / Optional Noise damper / 舊:排氣系統 / 1<br>akrapovic / Optional Noise Damper Set / 舊:排氣系統 / 1<br>akrapovic / Noise damper / 舊:排氣系統 / 1 |

#### 止滑貼與保護膜(5,142)

| 子類 | 來源(供應商 / 原廠分類 / 舊大類 / 筆數) |
|---|---|
| **油箱止滑貼**(3,011) | eazigrip / Tank Grips(油箱止滑貼) / 舊:周邊配件 / 2,722<br>eazigrip / Wrap Around Tank Grips(環繞式油箱貼) / 舊:周邊配件 / 201<br>eazigrip / Centre Tank Pads(油箱中央墊) / 舊:周邊配件 / 88 |
| **儀表保護貼**(850) | eazigrip / Dashboard Protectors(儀表板保護貼) / 舊:車殼外觀 / 850 |
| **車身保護膜(犀牛皮)**(839) | eazigrip / Stone Chip Protection(防石擊保護貼) / 舊:周邊配件 / 553<br>eazigrip / Scuff Guard(防刮護板) / 舊:周邊配件 / 142<br>eazigrip / Tank PPF(油箱透明保護膜) / 舊:周邊配件 / 116<br>eazigrip / Pannier Protection Kits(邊箱保護貼組) / 舊:周邊配件 / 28 |
| **保護貼套裝組合**(442) | eazigrip / Bundles(套裝組合) / 舊:周邊配件 / 442 |

#### 引擎與冷卻(14,714)

| 子類 | 來源(供應商 / 原廠分類 / 舊大類 / 筆數) |
|---|---|
| **防爆水管組**(13,165) | samco / hose_kit(水管組) / 舊:引擎部品 / 13,034<br>eazigrip / Silicone Hose Kits(矽膠水管組) / 舊:引擎部品 / 131 |
| **水管束環**(671) | samco / clamp_kit(束環套件) / 舊:周邊配件 / 671 |
| **離合器機構與分泵**(≈278) | cncracing+lightech / Clutch 其餘(壓板/彈簧/摩擦片/分泵/滑動套組) / 舊:引擎部品 / 275<br>kspeed / Brake 品名含Takegawa 離合器組件 / 舊:煞車系統 / 3 |
| **離合器外蓋**(≈272) | cncracing+lightech / Clutch 品名含外蓋/護蓋 / 舊:引擎部品 / 272 |
| **機油孔蓋**(168) | lightech / Engine Oil Filler Caps(機油孔蓋) / 舊:引擎部品 / 98<br>bonamici / Oil Caps(機油孔蓋) / 舊:引擎部品 / 70 |
| **引擎精品件**(160) | cncracing / Engine(引擎部品) / 舊:引擎部品 / 160 |

#### 車身防護與防摔(2,353)

| 子類 | 來源(供應商 / 原廠分類 / 舊大類 / 筆數) |
|---|---|
| **車身防倒球與滑塊**(1,064) | lightech / Protections(防護配備) / 舊:操控部品 / 402<br>cncracing / Protectors(車身防護) / 舊:操控部品 / 350<br>gbracing / BULLET FRAME SLIDERS(車身防倒球) / 舊:操控部品 / 131<br>evotech / Crash Protection / 舊:操控部品 / 102<br>kspeed / Protector(防護配件) / 舊:操控部品 / 45<br>gbracing / XL BULLET FRAME SLIDERS(車身防倒球) / 舊:操控部品 / 17<br>gbracing / CRASH MUSHROOM FRAME SLIDERS(車身防倒球) / 舊:操控部品 / 15<br>cncracing / Protectors / 舊:操控部品 / 1<br>lightech / Accessories And Spare Parts for Protections(防護用品的配件和備件) / 舊:操控部品 / 1 |
| **引擎護蓋與護桿**(567) | gbracing / ENGINE PROTECTION(引擎護蓋) / 舊:引擎部品 / 455<br>bonamici / Engine Protections(引擎護蓋) / 舊:引擎部品 / 77<br>evotech / Engine Guards / 舊:引擎部品 / 30<br>bonamici / Engine protections / 舊:引擎部品 / 2<br>akrapovic / Protection Bar Set / 舊:操控部品 / 1<br>akrapovic / Upper Protection Bar Set / 舊:操控部品 / 1<br>akrapovic / Lower Protection Bar Set / 舊:操控部品 / 1 |
| **輪軸防倒球**(243) | evotech / Spindle Bobbins / 舊:操控部品 / 187<br>gbracing / SPINDLE PROTECTORS(輪軸防倒球) / 舊:操控部品 / 56 |
| **車架護蓋與孔塞**(231) | cncracing / Frame caps(車架孔塞) / 舊:車架 / 227<br>gbracing / FRAME PROTECTORS(車台護蓋) / 舊:操控部品 / 4 |
| **水箱護網**(204) | evotech / Radiator Guards / 舊:引擎部品 / 183<br>lightech / Radiator Guards(水箱護網) / 舊:操控部品 / 21 |
| **儀表護蓋**(44) | bonamici / Dashboard Protections(儀表護蓋) / 舊:車殼外觀 / 23<br>materya / Dashboard Cover(儀表外蓋) / 舊:車殼外觀 / 15<br>gbracing / DASH PROTECTORS(儀表護蓋) / 舊:車殼外觀 / 4<br>bonamici / Dashboard protections spare parts / 舊:車殼外觀 / 2 |

#### 精品螺絲與螺帽(5,340)

| 子類 | 來源(供應商 / 原廠分類 / 舊大類 / 筆數) |
|---|---|
| **精品螺絲組**(5,120) | lightech / Bolts(螺絲) / 舊:操控部品 / 4,346<br>cncracing / Screw kit(螺絲組) / 舊:操控部品 / 574<br>gbracing / BOLTS & WASHERS(螺絲/墊片) / 舊:操控部品 / 85<br>evotech / Bolt / 舊:操控部品 / 76<br>evotech / Caliper Bolt / 舊:操控部品 / 34<br>cncracing / Screw kit / 舊:操控部品 / 3<br>materya / Windshield screws(風鏡螺絲) / 舊:操控部品 / 2 |
| **精品螺帽**(220) | cncracing / Nuts(螺帽) / 舊:操控部品 / 119<br>lightech / Special Nuts(特殊螺帽) / 舊:操控部品 / 101 |

#### 煞車系統(584)

| 子類 | 來源(供應商 / 原廠分類 / 舊大類 / 筆數) |
|---|---|
| **油杯與油杯蓋**(≈379) | cncracing / Fluid reservoirs(油杯) / 舊:煞車系統 / 210<br>lightech / Brake and Clutch Fluid Tank Caps(油杯蓋) / 舊:煞車系統 / 101<br>lightech / Fluid Tank for Brake and Clutch(油杯) / 舊:煞車系統 / 22<br>bonamici / Fluid Reservoirs(油杯) / 舊:煞車系統 / 16<br>bonamici / Fluid resevoirs / 舊:煞車系統 / 8<br>cncracing / Fluid reservoirs / 舊:煞車系統 / 3<br>bonamici / Brake fluid accessories / 舊:煞車系統 / 1<br>bonamici / Rear Fluid Reservoirs Accessories(後油杯配件) / 舊:煞車系統 / 1<br>kspeed / Brake 品名含總泵護蓋/泵蓋/油杯蓋 / 舊:煞車系統 / 17 |
| **煞車皮(來令片)**(112) | ebc / brake_pads(煞車皮) / 舊:煞車系統 / 112 |
| **卡鉗護蓋與散熱導風罩**(75) | front3d / Brake Cooler(卡鉗散熱進氣風罩) / 舊:煞車系統 / 26<br>evotech / Caliper Guards / 舊:煞車系統 / 15<br>front3d / GP Brake Cooler(GP卡鉗散熱進氣風罩) / 舊:煞車系統 / 12<br>front3d / Axial Brake Cooler(卡鉗散熱進氣風罩) / 舊:煞車系統 / 7<br>front3d / Radial Brake Cooler(卡鉗散熱進氣風罩) / 舊:煞車系統 / 7<br>front3d / Dual Brake Cooler(雙卡鉗散熱進氣風罩) / 舊:煞車系統 / 6<br>front3d / Smooth Brake Coller / 舊:煞車系統 / 1<br>front3d / Rear Brake Cooler(卡鉗散熱進氣風罩) / 舊:煞車系統 / 1 |
| **煞車碟盤**(≈18) | kspeed / Brake 品名含碟盤 / 舊:煞車系統 / 18 |

#### 懸吊與車架(359)

| 子類 | 來源(供應商 / 原廠分類 / 舊大類 / 筆數) |
|---|---|
| **車架與前叉部品**(256) | cncracing / Chassis(車架前叉部品) / 舊:車架 / 238<br>cncracing / Chassis / 舊:車架 / 18 |
| **三角台**(68) | bonamici / Triple Clamps(三角台) / 舊:操控部品 / 68 |
| **避震器**(29) | kspeed / Shock Absorber(避震器) / 舊:避震系統 / 29 |
| **輪圈**(6) | kspeed / Wheel(輪圈) / 舊:操控部品 / 6 |

#### 燈具與電子(1,044)

| 子類 | 來源(供應商 / 原廠分類 / 舊大類 / 筆數) |
|---|---|
| **電裝與線材**(≈604) | motogadget / (NULL) / 舊:騎士好物 / 495<br>motogadget / (NULL) / 舊:電子系統 / 169<br>evotech / Rectifier / 舊:電子系統 / 11<br>evotech / Wire Connector / 舊:電子系統 / 9<br>cncracing / Electronics(電子部品) / 舊:操控部品 / 3<br>cncracing / Electronics / 舊:電子系統 / 3<br>evotech / USB Charger / 舊:電子系統 / 2<br>cncracing / Electronics(電子部品) / 舊:引擎部品 / 1<br>cncracing / Electronics(電子部品) / 舊:電子系統 / 1 |
| **方向燈**(246) | kspeed / Turn signal(方向燈) / 舊:燈具方向燈 / 77<br>evotech / Indicator / 舊:燈具方向燈 / 59<br>lightech / Led Turn Signals and Rear Lights(LED方向燈和尾燈) / 舊:燈具方向燈 / 47<br>motogadget / (NULL) / 舊:燈具方向燈 / 39<br>cncracing / Turn indicators(方向燈) / 舊:燈具方向燈 / 24 |
| **儀表與控制器**(≈90) | motogadget / 品名含 motoscope/儀表/控制盒/繼電器 / 舊:騎士好物/電子系統 / 90 |
| **尾燈**(56) | kspeed / Taillight(尾燈) / 舊:燈具方向燈 / 56 |
| **大燈與護網**(48) | kspeed / Headlight(大燈) / 舊:燈具方向燈 / 33<br>evotech / Headlight Guards / 舊:燈具方向燈 / 15 |

#### 外觀與後視鏡(3,201)

| 子類 | 來源(供應商 / 原廠分類 / 舊大類 / 筆數) |
|---|---|
| **短牌架**(1,653) | lightech / License Plate Holders(短牌架) / 舊:操控部品 / 1,453<br>evotech / Tail Tidies / 舊:車殼外觀 / 167<br>cncracing / Plate holder(牌照架) / 舊:操控部品 / 29<br>front3d / License Plate Holder 2 / 舊:操控部品 / 2<br>cncracing / Plate holder / 舊:操控部品 / 1<br>front3d / License Plate Holder / 舊:操控部品 / 1 |
| **端子後照鏡**(604) | lightech / Mirrors and Mirror Block-Off Plates(後照鏡/後照鏡蓋) / 舊:後視鏡 / 130<br>motogadget / (NULL) / 舊:後視鏡 / 91<br>kspeed / Mirror(後照鏡) / 舊:後視鏡 / 87<br>evotech / Bar End Mirrors / 舊:後視鏡 / 80<br>evotech / Bar End Mirrors / Brake Protector / 舊:後視鏡 / 71<br>evotech / Bar End Mirrors / Brake and Clutch Protector Kit / 舊:後視鏡 / 70<br>cncracing / Mirrors(後照鏡) / 舊:後視鏡 / 53<br>cncracing / Mirrors / 舊:後視鏡 / 22 |
| **油箱蓋**(335) | lightech / Fuel Tank Caps(油箱蓋) / 舊:車殼外觀 / 138<br>bonamici / Tank Cap(油箱蓋) / 舊:車殼外觀 / 136<br>cncracing / Fuel tank caps(油箱蓋) / 舊:車殼外觀 / 61 |
| **土除與外觀飾蓋**(201) | kspeed / Cover(外觀件) / 舊:車殼外觀 / 143<br>kspeed / Fender(土除) / 舊:車殼外觀 / 29<br>materya / Track Days Plate(賽道日大燈罩) / 舊:車殼外觀 / 8<br>materya / Tank Tabs(油箱鎖點蓋板) / 舊:車殼外觀 / 8<br>kspeed / Pan Panel(側蓋) / 舊:車殼外觀 / 7<br>materya / Headlight Cover(大燈罩) / 舊:車殼外觀 / 2<br>akrapovic / Mudguard / 舊:排氣系統 / 1<br>front3d / Tail Extension(單座尾蓋) / 舊:車殼外觀 / 1<br>materya / Headlight Caps(大燈孔蓋) / 舊:車殼外觀 / 1<br>materya / Headlight cover(大燈罩) / 舊:車殼外觀 / 1 |
| **風鏡與定風翼**(196) | evotech / Fly Screen / 舊:車殼外觀 / 44<br>cncracing / Windscreens(風鏡) / 舊:車殼外觀 / 40<br>materya / Flyscreen(小風鏡) / 舊:車殼外觀 / 29<br>kspeed / Windshield(風鏡) / 舊:車殼外觀 / 24<br>front3d / Side Wings(側定風翼) / 舊:車殼外觀 / 12<br>front3d / Front Spoiler(前下擾流板) / 舊:車殼外觀 / 6<br>materya / FlyScreen(小風鏡) / 舊:車殼外觀 / 6<br>front3d / Double Side Wings(雙側定風翼) / 舊:車殼外觀 / 4<br>front3d / Universal Fork Winglets(前叉定風翼) / 舊:車殼外觀 / 4<br>front3d / Winglets(定風翼) / 舊:車殼外觀 / 4<br>materya / Winglets(定風翼) / 舊:車殼外觀 / 4<br>materya / Wings Blanking Caps(定風翼移除飾蓋) / 舊:車殼外觀 / 4<br>front3d / Tail Fins(尾翼) / 舊:車殼外觀 / 3<br>front3d / Windscreen / 舊:車殼外觀 / 2<br>materya / Front Winglets(前定風翼) / 舊:車殼外觀 / 2<br>materya / Front Winglet(前定風翼 下巴) / 舊:車殼外觀 / 2<br>front3d / Front Spoiler 2(前下擾流板) / 舊:車殼外觀 / 1<br>front3d / Side Wings 2.0(側定風翼) / 舊:車殼外觀 / 1<br>front3d / (NULL)(尾翼) / 舊:車殼外觀 / 1<br>front3d / Fork Winglets V1(前叉定風翼) / 舊:車殼外觀 / 1<br>materya / Windshield(風鏡) / 舊:車殼外觀 / 1<br>materya / Side Winglets(側定風翼) / 舊:車殼外觀 / 1 |
| **座椅與坐墊**(171) | kspeed / Seat(座椅) / 舊:車殼外觀 / 150<br>cncracing / Seat cover(坐墊皮套) / 舊:車殼外觀 / 17<br>materya / Seat Cover(單座蓋) / 舊:車殼外觀 / 3<br>evotech / Seat Cover / 舊:周邊配件 / 1 |
| **後照鏡蓋與配件**(41) | bonamici / Block Mirrors(後照鏡蓋) / 舊:後視鏡 / 18<br>evotech / Mirror Blanking Plates / 舊:後視鏡 / 8<br>evotech / Mirror Extensions / 舊:後視鏡 / 7<br>evotech / Mirror Spare / 舊:後視鏡 / 5<br>lightech / Mirror Caps(後照鏡蓋) / 舊:後視鏡 / 3 |

#### 騎士用品與配件(2,139)

| 子類 | 來源(供應商 / 原廠分類 / 舊大類 / 筆數) |
|---|---|
| **手機架與導航支架**(1,229) | evotech / Sat Nav Handle Bar Version / 舊:周邊配件 / 573<br>evotech / Sat Nav Mounts / 舊:周邊配件 / 510<br>evotech / Sat Nav Top Yoke Mount / 舊:周邊配件 / 98<br>evotech / Quadlock / 舊:周邊配件 / 40<br>evotech / Peak Design / 舊:周邊配件 / 8 |
| **駐車架與駐車球**(309) | cncracing / Garage(保養工具與腳架) / 舊:駐車架 / 89<br>bonamici / Swing Arm Spools(駐車球) / 舊:操控部品 / 82<br>lightech / Stands(駐車架) / 舊:駐車架 / 49<br>lightech / Swingarm Spools(駐車球) / 舊:操控部品 / 32<br>evotech / Paddock Stand bobbins / 舊:駐車架 / 23<br>gbracing / PADDOCK STAND BOBBINS(駐車球) / 舊:駐車架 / 14<br>lightech / Paddock Equipment(賽道裝備) / 舊:駐車架 / 11<br>evotech / Side Stand Extension Plate / 舊:駐車架 / 7<br>lightech / Carbon Stands(碳纖維駐車架) / 舊:駐車架 / 2 |
| **其他配件(待細分)**(234) | evotech / Accessories / 舊:周邊配件 / 147<br>kspeed / Others(其他) / 舊:周邊配件 / 72<br>lightech / Accessories(配件) / 舊:周邊配件 / 14<br>gbracing / ACCESSORIES(配件) / 舊:周邊配件 / 1 |
| **攝影機支架**(151) | evotech / Action Camera Mount / 舊:周邊配件 / 150<br>gbracing / FIXED MOUNTS(運動攝影機架) / 舊:周邊配件 / 1 |
| **騎士服飾**(112) | gbracing / CLOTHING & ACCESSORIES(衣物與週邊) / 舊:服飾配備 / 55<br>gbracing / (NULL) / 舊:服飾配備 / 23<br>lightech / Knee Sliders(膝蓋滑塊) / 舊:騎士好物 / 17<br>evotech / Clothing / 舊:服飾配備 / 5<br>evotech / T-Shirt / 舊:服飾配備 / 5<br>gbracing / FIRE SAFETY CLOTHING(防火衣物) / 舊:服飾配備 / 3<br>evotech / Bobble hat / 舊:服飾配備 / 2<br>gbracing / (NULL) / 舊:操控部品 / 2 |
| **精品小物**(58) | lightech / Merchandising(商品銷售) / 舊:騎士好物 / 14<br>gbracing / STICKERS & VOUCHERS(貼紙與宣傳物品) / 舊:騎士好物 / 11<br>lightech / Stickers(貼紙) / 舊:周邊配件 / 10<br>bonamici / Merchandising(周邊商品) / 舊:騎士好物 / 8<br>cncracing / Gadget(精品小物) / 舊:騎士好物 / 8<br>bonamici / Marketing Material(行銷素材) / 舊:騎士好物 / 2<br>bonamici / Customization / 舊:騎士好物 / 2<br>cncracing / Apparel(服飾配件) / 舊:騎士好物 / 1<br>gbracing / GBRACING UPGRADED PRODUCT LOGO(引擎護蓋 Logo 貼) / 舊:騎士好物 / 1<br>materya / (NULL)(煞車油杯套) / 舊:騎士好物 / 1 |
| **行李與包袋**(46) | evotech / Pannier/Topbox Mounting Brackets / 舊:行李箱包 / 26<br>motogadget / tank straps / 舊:騎士好物 / 7<br>motogadget / Bags / 舊:騎士好物 / 7<br>kspeed / Rear Luggage(後貨架) / 舊:行李箱包 / 4<br>motogadget / Backpack / 舊:騎士好物 / 2 |

#### 四輪 ATV/UTV(460)

| 子類 | 來源(供應商 / 原廠分類 / 舊大類 / 筆數) |
|---|---|
| **防爆水管組**(437) | samco / hose_kit(水管組) / 舊:四輪 ATV/UTV / 437 |
| **水管束環**(23) | samco / clamp_kit(束環套件) / 舊:四輪 ATV/UTV / 23 |
## 4. 已知資料尾巴(不擋草案拍板,實作時處理)

| 尾巴 | 規模 | 處理方式 |
|---|---:|---|
| rpm 碳纖維車殼一鍋(原廠分類只有 1 值) | 8,975 | 放量後用品名關鍵字拆(土除/油箱罩/側蓋/內裝板…),v1 先整批「碳纖維車殼與整流罩」 |
| motogadget 原廠分類 97% 空值 | 888 | v1 先依現行大類 fallback 進「電裝與線材」等;後續品名關鍵字細分(m.unit/方向燈/後視鏡/握把) |
| evotech Accessories / kspeed Others / lightech·gbracing Accessories 雜包 | ~234 | 進「其他配件(待細分)」,後續品名細分 |
| materya Flyscreen/FlyScreen 大小寫重複 | 35 | 映射時已合併;報價單側 categorizer 實作時做 normalize |
| akrapovic 71 種長尾值 | 638 | 已用 regex 規則收斂成 7 子類(映射腳本 AKRA_RULES) |

## 5. 拍板後的實作影響面(預告,動工前仍走鐵則 8 提 plan)

- **報價單 repo**(`/Users/sean_1/API大量上架/PCM報價單-V2`):
  1. `lib/product_categorizer.py` 改產出新 14 大類 + 新增子類欄位(建議 mapping 落 DB 表而非續寫死在 code,降低日後調整成本——此為決策點之一);
  2. `major_category_def` 表改 14 類;`storefront_catalog_v` 增子類欄;回填腳本重跑;
  3. **報價單系統自身篩選器同步變 14 類**(連動面,Sean 已知)。
- **網站 repo**(本 repo):
  1. 砍手抄 seed(`20260703120000_p0b_seed_16_major_categories.sql` 體系),`categories` 改由同步管線從 B 庫帶(兩層);
  2. 前端 `buildCategoryTree` 已支援兩層樹,UI 幾乎免改;匯入腳本 `resolveIdOrNull` 對照邏輯改吃新欄位;
  3. RPM「fixed 碳纖維部品」策略改走統一 classify。
- **風險**:歸類切換瞬間商品 URL/篩選狀態變動;建議切換走一次性 migration+同步重跑,選離峰。rollback=保留舊 major_category 欄位不刪,切回 view 舊欄即可。

## 6. 待 Sean 拍板(看完視覺化對照表後)

- Q1 大類數:A. 14 類照案(推薦)B. 壓 12(併懸吊、併貼膜)C. 其他調整(逐類講)。
- Q2 大類命名逐類確認:特別是「引擎與冷卻」「外觀與後視鏡」「騎士配件與精品」三個合併類的名字。
- Q3 mapping 落點:A. DB 對照表(調分類=改資料,推薦)B. 續寫 Python code(現狀模式)。
- Q4 子類粒度:50 個是否 OK、哪些要再併/再拆。

— 草案 v1 完 —
## 7. v1.1 增補(2026-07-11 同日;Sean 拍板 A=四補丁點全做細部設計+用詞總審)

### 7.1 用詞修訂(客人秒懂原則)

| 舊名 | 新名 | 理由 |
|---|---|---|
| 保護貼膜 | 止滑貼與保護膜 | 主力商品(油箱止滑貼 3,011)進類名 |
| 精品螺絲與五金 | 精品螺絲與螺帽 | 「五金」像五金行;內容就是螺絲+螺帽 |
| 把手與拉桿 | 拉桿與把手 | 拉桿量大且是搜尋主詞,排前 |
| 車身防護 | 車身防護與防摔 | 「防摔」是台灣騎士的搜尋詞 |
| 騎士配件與精品 | 騎士用品與配件 | 「騎士用品」=Webike 等站既有慣用詞 |
| 子類:車身保護膜與防刮貼 | 車身保護膜(犀牛皮) | 台灣通稱犀牛皮 |
| 子類:水管束環套件 | 水管束環 | 精簡 |
| 子類:引擎部品 | 引擎精品件 | 與大類名區隔(正時蓋等 CNC 精品) |
| 子類:車身外觀件 | 土除與外觀飾蓋 | 具體化 |

### 7.2 四補丁點細分設計(品名關鍵字=純程式規則,非 AI;每日自動跑;沒接住→落兜底桶+日報)

**① rpm+lightech+cnc 碳纖維(9,728 筆)→ 13 部位子類**:29 組關鍵字實測覆蓋 97.6%、漏網 216 筆(8-16 筆小雜項+用字變體「鍊/鏈」等)入「其他碳纖維飾件」。子類與估計筆數見 §3 樹表(≈ 標記)。
**② cnc+lightech 離合器(547 筆)→ 2 子類**:離合器外蓋 ≈272(關鍵字:外蓋/護蓋)/離合器機構與分泵 ≈275(壓板/彈簧/摩擦片/分泵/從缸/輔助缸/滑動);8 關鍵字覆蓋 94.3%、漏網 30 筆人工歸類。
**③ motogadget(912 筆)→ 打散到既有類**(關鍵字桶實測):騎士服飾 ≈201(Dryzone/Stormrider 等外套車褲——重要發現:這家一半不是電子件)/握把與把手座 ≈136→拉桿與把手/包袋油箱包 ≈91→行李與包袋/儀表與控制器 ≈90(motoscope+控制盒,新子類)/後視鏡 ≈88(已在 v1)/線材 ≈65 留電裝/手機架 ≈53/方向燈 ≈36(已在 v1)/皮件小物 ≈35→精品小物/開關 ≈28→手把開關;漏網 ≈181(貼膜/鎖具/手電筒/磁鐵等單件雜物)→精品小物。
**④ 雜物桶(~233 筆)清運**:lightech Accessories 14 筆全清(拉桿 5/排氣飾蓋 4/坐墊靠背 4/隔熱 1);kspeed Others 72 筆=Diabolus 系列按零件性質打散(大燈/腳踏/三角台/搖臂/油箱蓋/輪圈)+服飾 4;evotech Accessories 147 筆=保護貼 ≈25→止滑貼與保護膜、三角台夾頭 ≈10→懸吊與車架、燈具 4、車庫工具+貼紙 ≈10→精品小物,長尾 ≈98 留「其他配件」兜底。

### 7.3 實作守則(補丁層)

- 規則優先序:原廠分類對照表 → 品名關鍵字 → 兜底桶;每日同步輸出「未接住筆數」一行日報,量大再補規則。
- 子類 <20-30 筆不成類(側欄噪音);兩層深度上限(07-11 Sean 認可原則)。
- ≈ 估計值在實作時以規則實跑精算,對帳:各大類加總須=B 庫全量。

### 7.4 v1.1 三題拍板結果(07-11 Sean:「依照建議」)

- 用詞修訂 9 條:照案。
- 碳纖 13 子類粒度:OK。
- motogadget 騎士服飾 ≈201 筆:打散進「騎士用品與配件>騎士服飾」。

### 7.5 v1.2 修訂(同日 Sean 拍板)

- kspeed Brake(51 筆)品名實查後拆五路(Sean 澄清:只有油杯蓋部分併入):總泵護蓋/泵蓋/油杯蓋 ≈17→油杯與油杯蓋(≈379)、煞車碟盤 ≈18→新子類「煞車碟盤」(僅 18 筆低於成類門檻,但語意必要且未來 EBC 等可長)、拉桿 ≈12→煞車離合器拉桿、Takegawa 離合器件 ≈3→離合器機構與分泵、握把 1→握把與平衡端子;移除「煞車配件」子類。
- 大類順序改「想買的排前面」:碳纖維部品 > 腳踏後移與傳動 > 拉桿與把手 > 排氣系統 > 止滑貼與保護膜 > 引擎與冷卻 > 車身防護與防摔 > 精品螺絲與螺帽 > 煞車系統 > 懸吊與車架 > 燈具與電子 > 外觀與後視鏡 > 騎士用品與配件 > 四輪 ATV/UTV。此順序=網站側欄 sort_order 依據。

### 7.6 定稿確認+煞車類預留(07-11 Sean 拍板)

- 「煞車碟盤」子類保留(現 ≈18 筆);Sean 明示未來會進**卡鉗、總泵**——煞車系統預留「煞車卡鉗」「煞車總泵」子類位(進貨時再開,目前不建空類)。
- 至此 v1.2 分類體系全數定稿:14 大類 / 77 子類,順序=§7.5;下一步=實作 plan(鐵則 8,動報價單 categorizer+對照表落 DB+網站同步)。

— v1.1/v1.2 增補完(定稿)—
