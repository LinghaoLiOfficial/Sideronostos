# Field Shift：使用 NASA 数据适应农场

> 页面内容整理自 NASA Space Apps Challenge 2026 挑战页面的 Details 与 Resources 标签。页面检查日期：2026-11-13。以下保留数据集原名与原始链接；说明为页面内容的中文整理，外部链接指向的数据和文档不属于本页正文。

- 挑战页面：[Field Shift: Adapting Farms with NASA Data](https://www.spaceappschallenge.org/2026/challenges/adapting-farms-with-nasa-data/?tab=resources)
- 活动：2026 NASA Space Apps Challenge
- 难度标签：Advanced、Intermediate
- 主题：Arts & Multimedia、Earth Science、Software
- 挑战视频：[2026 Challenge | Field Shift: Adapting Farms with NASA Data](https://www.youtube.com/watch?v=cF0U2WXsM7o)
- 页面图片说明：内华达州农民 Denise Moyle 站在苜蓿田中。

## 挑战简介

全球农民正面对不断变化的气温、降雨模式、水资源短缺、极端天气和土壤健康下降。上述压力使农户难以选择既能保护田地、节约用水，又能支持长期韧性的轮作方案。请创建一个决策支持工具，结合 NASA 地球观测、本地土壤信息、作物特性和农民优先事项，帮助农民探索可能改善土壤健康、适应环境变化的轮作策略。

## 背景

许多地区的气温在变化、降雨越来越难以预测，土壤健康也在下降。缺水、侵蚀、养分耗竭和极端天气进一步增加了不确定性。将新作物加入轮作并不简单：某种作物在一个地方可能改善土壤健康，在另一个地方却可能耗水过多、引入病害、与本地市场不匹配，或不适合当地生长季。

本挑战部分受到多代农耕经验启发：一些家庭经历过这样的种植季，如果当时有更好的工具追踪环境变化，或许就能更早发现更健康、更有韧性的轮作选择。NASA 长期环境数据如今为理解本地种植条件提供了新途径，空间信息（SI）技术也为把这些数据转化为实用、方便农民理解的洞见创造了机会。

## 目标

可将 NASA 地球观测与本地农业信息结合，开发应用、模型、交互地图或其他决策支持工具，帮助农民探索可能改善土壤健康、增强对天气和水文变化韧性的轮作选择。

可考虑的数据包括 SMAP、ECOSTRESS、GPM、Landsat、MODIS、NASA POWER、GRACE/GRACE-FO、SRTM 或其他 NASA 高程产品。可据此分析气温、热胁迫、降雨、土壤湿度、蒸发、霜冻风险、极端降水、植被胁迫和长期水资源趋势。也可纳入本地土壤信息、作物特性与农民优先事项，例如用水量、饲草价值、固氮潜力、减少侵蚀、提升有机质或市场适配度。

工具可以标出田地通常裸露的时期、现有作物更易受胁迫的季节，或有助于打断虫害周期、降低用水需求、改善入渗或增加补充收入的轮作机会。至少比较三种轮作策略（包括现行轮作）。对每种策略说明推荐理由、支持证据、可能收益、信息缺口，以及需要农民或农业专家本地审查的风险。

工具应支持决策，而不取代农民判断或本地农业专业知识。

## 可考虑的方向

以下是可选方向，并非强制要求。

### 理解环境条件与数据

- 探索气温、土壤湿度、降雨、蒸发和植被胁迫变化与作物脆弱性、土壤健康之间的关系。
- 考虑解释蒸散发、土壤湿度异常、植被指数（如 NDVI）、霜冻风险和水量平衡指标等科学术语。
- 说明卫星观测与地面测量的差别，以及结合两者如何提高准确性。

### 空间信息、建模与数据融合

- 可比较不同空间信息或统计方法，以识别历史气候和土壤条件中的模式。
- 可利用空间信息识别季节转换、裸地期，或现有作物胁迫加重的时期。
- 解释模型如何处理不确定性，以及哪些结果需要本地专业知识验证。
- 可通过降采样、聚合或重采样，将空间和时间分辨率不同的数据协调到共同分析网格。协调 SMAP 土壤湿度、ECOSTRESS 地表温度、GPM 降水、Landsat/MODIS 植被指数、GEDI 生物量和土壤数据，有助于形成连贯、可解释的轮作策略比较特征。

### 轮作策略探索

- 比较轮作方案在养分循环、侵蚀风险、有机质贡献、打断虫害周期、用水、饲草潜力和市场因素上的差异。
- 可将轮作设想与农民优先事项相匹配，例如节水、增加补充收入或改善土壤结构。
- 简要说明固氮作物、覆盖作物、深根作物或耐旱作物如何贡献长期土壤健康。

### 地理空间制图与可视化

- 可使用交互地图探索长期土壤湿度、热浪或水储量下降等时间趋势。
- 可视化田块脆弱性，例如侵蚀风险区、缺水热点和易霜冻区域。
- 可选用时间线、数据叠加对比，或用于调整降雨/气温情景的滑块。

### 以农民为中心的设计

- 让技术或地理空间经验有限的农民也能容易理解工具。
- 可允许农民输入自己的优先事项或限制条件，如可用水量、设备限制或市场偏好。
- 提醒用户工具用于支持而非替代本地专业知识，并突出尤其需要人工判断的部分。

## 资源

> NASA 不为任何非美国政府实体背书，也不对非美国政府网站所含信息负责。访问非美国政府网站时，参赛者须遵守该网站各自的数据使用规定。挑战页面提示，活动开始前可能还会增加资源。

### NASA 数据与资源

| 数据源 | 页面说明 | 链接 |
|---|---|---|
| Soil Moisture Active Passive（SMAP） | 全球表层土壤湿度和冻融状态测量，每 2–3 天采集一次。土壤湿度可帮助识别干旱胁迫、水分可用性、入渗潜力和作物早期胁迫信号；可用于评估改善用水效率、土壤状况或抗旱能力的轮作作物。 | [Earthdata：SMAP](https://earthdata.nasa.gov/data/platforms/space-based-platforms/smap) |
| Global Precipitation Measurement（GPM）与 IMERG | GPM 任务及 IMERG 产品提供全球降水率和累计降水估计，可用于评估降雨可靠性、强风暴频率、侵蚀风险、土壤水分输入及田间湿度的长期趋势。IMERG 可用于不同降水情景下的轮作比较；Worldview 的 IMERG 图层可直接下载为高分辨率图像。 | [GPM 数据](https://gpm.nasa.gov/data) |
| Landsat、MODIS、VIIRS：反射率、NDVI 与植被指数 | Landsat（30 米）以及 MODIS/VIIRS（250–1000 米）提供校正反射率、NDVI、植被指数及植物胁迫、裸地和季节变化指标，可用于绘制作物长势、追踪季节转换、发现高胁迫期并可视化比较轮作方案。 | [Landsat / EarthExplorer](https://earthexplorer.usgs.gov/)；[MODIS 产品](https://lpdaac.usgs.gov/products/)；[VIIRS 搜索](https://search.earthdata.nasa.gov/search?q=VIIRS) |
| NASA POWER：农业气候与气象数据 | 提供易于获取、广泛用于农业的太阳能、气象和气候数据，包括温度、湿度、辐射及衍生指标，可帮助估算作物用水、生长季条件、霜冻风险及潜在轮作作物的气候适宜性。 | [NASA POWER](https://power.larc.nasa.gov/) |
| Shuttle Radar Topography Mission（SRTM） | 全球高程数据适用于分析坡度、径流、侵蚀风险、水流和地形导致的胁迫。地形模式可帮助判断哪些轮作作物可能改善入渗、减少侵蚀或稳定坡地土壤。 | [Earthdata：SRTM](https://earthdata.nasa.gov/data/instruments/srtm) |
| ECOSTRESS | 以较高空间分辨率测量地表温度（LST）和蒸散发（ET），可用于发现植物胁迫热点、热暴露、浅根作物脆弱性和作物需水情况；有助于识别现有作物脆弱性上升的时期，并绘制田块微气候差异。 | [ECOSTRESS 数据](https://ecostress.jpl.nasa.gov/data) |
| USDA Ag Data Commons | 开放农业数据涵盖土壤、作物、气候、土地管理、物候、水质和生态条件，可补充 NASA 卫星观测的地面与农业背景。可整合本地作物信息、土壤属性测量、管理实践和田块级农业研究，使空间信息工具将环境指标与实际农场约束和轮作情况对应起来。 | [Ag Data Commons](https://nal.usda.gov/services/agdatacommons) |
| Web Soil Survey（WSS） | USDA 自然资源保护局（NRCS）维护的美国官方土壤数据，包含详细土壤图、土壤属性、排水分类、侵蚀风险、水文等级和土地利用适宜性。可查询有机质、质地、入渗和压实风险等田块特征；与 NASA 地球观测结合，可提高土壤健康和作物适宜性解读的本地准确度。 | [Web Soil Survey](https://websoilsurvey.nrcs.usda.gov/app/) |
| Cropland Data Layer（CDL）：CropScape | USDA CDL 提供美国年度、高分辨率（30 米）农田分类，识别玉米、大豆、棉花、小麦、苜蓿等作物。可考察现有轮作、追踪季节变化、识别裸地、评估作物适宜性，并将本地种植模式与 NASA 环境观测比较；也可作为带有真实农业生产标签的空间信息模型输入。 | [CropScape](https://nassgeodata.gmu.edu/CropScape/) |
| PRISM 气候数据 | 俄勒冈州立大学 PRISM 提供美国高质量气候数据，包括日、月和 30 年气候常值，以及降水、气温、露点、霜冻/冻结日期等。数据考虑地形影响，可为本地农场提供气候背景，用于评估长期气候趋势、使轮作策略与本地温度和降雨历史相匹配，并验证 NASA 卫星胁迫指标。 | [PRISM](https://prism.oregonstate.edu/) |
| USDA NRCS SSURGO / STATSGO2 | 土壤数据：田块尺度的 SSURGO 与区域尺度的 STATSGO2 提供质地、有机质、排水等级、水文土壤组、侵蚀风险因子、限制层和持水能力等属性。它们可补充 NASA 观测，用于本地化评估土壤健康、侵蚀潜力、入渗动态和作物适宜性，使空间信息模型给出更贴合农学实际的轮作建议。 | [NRCS 土壤数据](https://nrcs.usda.gov/resources/data-and-reports/soils) |
| National Agriculture Imagery Program（NAIP） | 通常在美国生长季获取、分辨率约 1 米的高分辨率航空影像，可用于绘制田块边界、发现裸土期、观察作物生长、监测土地管理变化并精细评估植被覆盖。可训练需要近距离细节的空间信息模型，或验证 NASA 地球观测发现的作物与土壤状况模式。 | [NAIP](https://naip-usdaonline.hub.arcgis.com/) |
| USGS National Land Cover Database（NLCD） | 提供覆盖美国多个年代、30 米分辨率的土地覆盖和土地利用分类，可识别农田、牧场、森林、水体、湿地和开发区等周边环境。可为影响微气候、水资源、侵蚀和虫害动态的景观特征提供背景，也可长期分析土地覆盖变化与农场脆弱性的关系。 | [NLCD](https://usgs.gov/centers/eros/science/national-land-cover-database) |
| NLDAS / GLDAS：陆面数据同化系统 | 融合卫星与地面气象观测，生成温度、降水、土壤湿度、蒸散发代理量、辐射等格点数据，时间分辨率可达亚日尺度。可研究干旱发生、湿度亏缺、生长季转换和环境胁迫；与 NASA 任务数据结合可提供连续时间序列特征。页面建议在 Earthdata Search 中搜索“NLDAS”或“GLDAS”。 | [NASA Earthdata](https://earthdata.nasa.gov/) |
| FAO Global Agro-Ecological Zones（GAEZ） | 提供数十种作物的全球农业气候适宜性图层，以及土壤限制、水资源可用性、产量潜力和土地生产力评估。可用于评估拟议轮作作物与本地气候、土壤的匹配度，并从全球农学角度比较多个轮作情景。 | [FAO GAEZ](https://gaez.fao.org/) |
| CoCoRaHS | 北美社区众包的逐日雨雪观测，可用于验证卫星降雨估计（如 IMERG）、发现影响特定田块的局地极端降雨，并提高水分胁迫或灌溉时机预测的模型精度。 | [CoCoRaHS 地图](https://cocorahs.org/Maps) |
| USGS National Water Information Systems（NWIS） | 提供地下水位、流量、河流水位和水质的长期记录，可评估灌溉用水、识别水文胁迫、了解下游侵蚀风险，并将 NASA 观测到的水分状况与原位观测对照。 | [NWIS](https://waterdata.usgs.gov/nwis) |
| USDA AMS Market News | 发布农产品和畜产品的商品价格、需求趋势和市场状况，可帮助判断拟议轮作作物在本地或区域是否有可行市场，这是评估轮作时以农民需求为中心的重要约束。 | [USDA Market News](https://ams.usda.gov/market-news) |
| USDA NASS QuickStats | 提供县级和州级农业统计数据，包括产量、种植面积、生产历史和作物频率，可用于按历史表现校准模型、比较轮作可能性并探索长期农业趋势。 | [QuickStats](https://quickstats.nass.usda.gov/) |
| OpenET | 为美国西部各州提供由卫星驱动模型生成的田块尺度蒸散发估计，可评估作物需水、灌溉时机、用水效率并识别热或水分胁迫田块。其 ET 信息可补充 ECOSTRESS 和 NASA POWER。 | [OpenET](https://openetdata.org/) |
| USFS LANDFIRE | 提供美国范围内的植被类型、植被状况、燃料模型和景观特征，可用于理解本地生态系统、多年生植被、林木与作物相互作用，以及影响微气候、水流、侵蚀和生物多样性的景观因素。 | [LANDFIRE](https://landfire.gov/) |
| Global Ecosystem Dynamics Investigation（GEDI） | 通过高分辨率激光测量森林结构，包括冠层高度、叶面积指数和地上生物量。可用 GEDI Level-4 生物量产品了解农业景观周边植被密度、冠层胁迫和长期生态变化。GEDI 对较高植被区域最有效；其生物量和冠层指标可提供周边土地覆盖结构背景，并与 SMAP、Landsat、MODIS 植被指标互补。 | [GEDI 数据](https://gedi.umd.edu/data) |

### 空间机构合作伙伴资源

#### ESA（欧洲空间局）

| 数据源 | 页面说明 | 链接 |
|---|---|---|
| Copernicus Sentinel-2 | 免费提供 10–20 米多光谱影像，重访频率较高。其红边、近红外（NIR）和短波红外（SWIR）波段适合计算 NDVI/EVI、绘制裸土、检测作物胁迫并进行生长季精细监测。较高空间分辨率可补充 Landsat 与 MODIS。 | [Copernicus Data Space](https://dataspace.copernicus.eu/) |
| ERA5：ECMWF 再分析 | 全球再分析数据，提供逐小时气温、降水、风、湿度、土壤温度和辐射等变量。当地气象站稀少时可用于填补背景信息，分析长期气候趋势、构建空间信息模型的时间特征，并用连续气候序列为 NASA 地球观测提供背景。 | [ERA5 单层数据集](https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels?tab=overview) |

## 页面页脚信息

页面公告：Space Apps Connect 已开放，页面邀请用户到 [Space Apps Connect（GitHub）](https://github.com/nasa/spaceapps)参与讨论。页面还提供 Explore the Hackathon 导航入口。

站点导航包括 [About Us](https://www.spaceappschallenge.org/about/)、[Awards](https://www.spaceappschallenge.org/awards/)、[Participant FAQs](https://www.spaceappschallenge.org/resources/participant-faqs/)、[Participant Guides](https://www.spaceappschallenge.org/resources/)、[2026 NASA Space Apps Challenge](https://www.spaceappschallenge.org/2026/) 和 [2026 Challenges](https://www.spaceappschallenge.org/2026/challenges/)。页面提供 Join the Challenge 入口，指向[本挑战团队页](https://www.spaceappschallenge.org/2026/challenges/adapting-farms-with-nasa-data/?tab=teams)。

NASA Space Apps 由 NASA [科学任务理事会](https://science.nasa.gov/)资助，并通过合同与 [Booz Allen Hamilton](https://boozallen.com/)、[Mindgrub](https://mindgrub.com/) 和 [SecondMuse](https://secondmuse.com/) 合作。页面版权标注为 ©2026 NASA，并提供 [隐私政策](https://www.nasa.gov/about/highlights/HP_Privacy.html)、[法律信息](https://www.spaceappschallenge.org/legal/)、[联系方式](https://www.spaceappschallenge.org/contact-us/) 和 [Space Apps 资源页](https://www.spaceappschallenge.org/resources/)链接。

页面的“Connect with #SpaceApps”社交链接：[Facebook](https://www.facebook.com/spaceappschallenge)、[X/Twitter](https://twitter.com/spaceapps)、[Instagram](https://www.instagram.com/nasa_spaceapps) 和 [YouTube](https://www.youtube.com/nasaspaceappschallenge)。
