# 轮作决策支持：定向文献综述与数据来源

## 1. 目的与方法

本综述围绕 [`docs/Problem.md`](../../docs/Problem.md) 的目标，考察如何组合 NASA 环境观测与本地土壤信息、作物特性和农户优先事项，支持解释性的轮作策略比较。综述重点不是寻找一个通用“最佳轮作”，而是总结研究问题、决策尺度、数据证据、验证方法和迁移边界。

**检索日期：2026-11-09。** 使用实际浏览器检索 Google 学术相关结果、出版社/开放论文页面，并通过 Crossref 与 OpenAlex 核对 DOI、作者、出版年和开放获取元数据。检索词组合包括 `crop rotation`、`crop diversification`、`cropping systems`、`decision support`、`soil health`、`multi-objective optimization`、`remote sensing`、`farmer preferences`。采用定向抽样而非穷尽系统综述：先取高相关综述和综合分析，再纳入可代表五个研究方向的方法与案例。

证据标记：

- **全文核读**：浏览器可读公开全文；提取内容限于该文报告的数据与方法。
- **摘要/元数据核验**：核对出版社摘要、DOI 和索引元数据；未见全文的字段标为“摘要未说明”，不作推断。
- **数据产品论文**：用于说明数据产品的变量、尺度或不确定性，不视为轮作效果实证。

## 2. 研究问题与综合发现

| 方向 | 文献综述问题 | 目前证据给出的回答 | 对本项目的含义 |
|---|---|---|---|
| 环境与作物脆弱性 | 如何识别热/水分胁迫、作物受天气影响和有利种植窗口？ | 长期田间试验和多点综合分析表明，轮作多样性可缓冲不利天气或降低气候诱发的产量损失；遥感可提供作物长势代理，但产量和作物身份需要地面/农场数据校准。 | NASA 数据用于环境风险与观测特征；按作物、地块和生育阶段解释，不将区域像元当作田块实测。 |
| 土壤健康与轮作效益 | 作物多样化/覆盖作物对碳、养分、侵蚀、产量和水质有什么影响？ | Meta 分析总体报告正向效应，但响应依赖多样化实践、土壤、气候和管理；碳变化通常需要多年观测，不能由单季 NDVI 或 SMAP 直接推出。 | 将“预期效益”与“本地已验证效益”分开；需要土壤基线、管理和长期试验/复测。 |
| 作物适宜性与轮作约束 | 如何构造候选作物和有效轮作序列？ | 轮作生成工具和作物模型显示，序列需要同时编码作物日历、资源/劳力、前茬效应及系统边界；简单按单作物适宜性排序会漏掉序列依赖。 | 建地区化作物参数库与禁忌/兼容规则，保留参数来源和不确定性。 |
| 策略模拟与优化 | 如何比较至少三个策略及多目标权衡？ | DSS 文献采用数学规划、模拟、规则和多准则评价；收益、环境效益、劳动投入可能冲突，权重与约束不能由模型暗中替用户决定。 | 同时展示现有轮作和两个备选方案，报告目标分项、硬约束、假设及敏感性。 |
| 农户偏好与应用验证 | 如何确保建议符合农场目标且实际可行？ | 采用研究说明风险态度、时间偏好、信息/设备/劳力和制度约束影响多样化采纳；DSS 是否有用不仅取决于算法，也取决于共同设计、可理解性与信任。 | 农户输入应是模型正式输入，不是遥感推断；专家/农户审阅属于验证而非装饰性访谈。 |

## 3. 核心文献证据矩阵

### 3.1 综合证据、土壤与长期试验

| # | 文献及证据层级 | 具体问题、地点/尺度与方法 | 数据来源及获取 | 验证、发现与局限 |
|---|---|---|---|---|
| 1 | Tamburini et al. (2020), *Science Advances*；[DOI](https://doi.org/10.1126/sciadv.aba1715)；摘要/元数据核验 | 农业多样化对生物多样性、授粉、害虫控制、养分循环、土壤肥力和水调节的综合效应；全球综述/综合分析。 | 汇总既有同行评审实证研究；原始数据来自不同研究和实验，需从论文补充材料/引用研究逐项追溯；非单一可下载数据集。 | 适合作为多功能性证据，不是某一农场的轮作处方；各实践和生态区异质性明显。 |
| 2 | Beillouin et al. (2021), *Global Change Biology*；[DOI](https://doi.org/10.1111/gcb.15747)；摘要/元数据核验 | 量化不同农业多样化实践的生态系统服务效应；综合 95 项 meta-analysis、5,156 个实验、84 个实验年、120 种作物、85 个国家及逾 54,500 对观测。 | 二次综合分析；数据为既有 meta-analysis 的统计结果，不是新采集的农户地块数据。 | 报告作物生产中位效应 +14%、非栽培生物多样性 +24%，但效果随轮作、覆盖作物、间作、农林复合等实践不同；二次证据继承原研究偏差，不能将总效应套用于本地。 |
| 3 | Bowles et al. (2020), *One Earth*；[DOI](https://doi.org/10.1016/j.oneear.2020.02.007)；摘要/元数据核验 | 北美长期轮作试验中，增加轮作多样性是否提升对不利生长条件的韧性；研究比较既有长期田间试验的产量与天气响应。 | 多个长期实验站的作物产量、轮作处理和当地天气记录；摘要/索引未充分披露本文最终纳入站点数、字段版本和公开下载链接，需全文及补充材料复核。 | 研究设计比单个遥感样例更接近“天气×轮作×产量”；站点处理和气候梯度覆盖有限，结论仍需本地验证。 |
| 4 | Poeplau & Don (2015), *Agriculture, Ecosystems & Environment*；[DOI](https://doi.org/10.1016/j.agee.2014.10.024)；摘要/元数据核验 | 覆盖作物种植能否增加农田土壤碳储量；全球发表田间试验的 meta-analysis。 | 汇总覆盖作物与对照的土壤有机碳测量；原始数据来自论文/试验，不是 SoilGrids 类网格产品。 | 适合支持覆盖作物长期碳收益方向；土层深度、年限和气候差异会影响估计，不能直接替代本地碳复测。 |
| 5 | Abdalla et al. (2019), *Global Change Biology*；[DOI](https://doi.org/10.1111/gcb.14644)；摘要/元数据核验 | 覆盖作物对氮淋失、净温室气体平衡和后茬产量的影响；批判性综述。 | 汇总不同地区田间试验的氮、水、温室气体和产量测量；原始研究需按地区/管理条件追溯。 | 强调效益取决于气候、覆盖作物类型、终止管理和后茬；不适合用单一方向性分数代表“覆盖作物必然改善”。 |
| 6 | Davis et al. (2012), *PLOS ONE*；[DOI/开放全文](https://doi.org/10.1371/journal.pone.0047149)；**全文核读** | 美国爱荷华州 Boone County 9 ha Marsden Farm，2003–2011 比较 2 年玉米–大豆、3 年含小谷物/红三叶草、4 年含小谷物/苜蓿的产量、利润、投入和环境表现；随机完全区组、4 个重复、36 个处理地块。 | 田间试验的地块产量、杂草种子/生物量、肥料/农药、劳动与能源日志；距试验约 1 km 气象站月温度和降水；经济分析为试验成本收益核算。开放补充材料含处理、气象、投入和方法。 | 2003–2011 多样化系统玉米/大豆产量相当或较高，合成氮和除草剂更低，利润总体相近；劳动投入增加。因轮作与管理（肥料、粪肥、除草方式）同时变化，不能把差异全因果归于轮作长度；单站点不代表全球农场。 |
| 7 | Gaudin et al. (2015), *PLOS ONE*；[DOI/开放全文](https://doi.org/10.1371/journal.pone.0113261)；摘要/元数据核验 | 轮作多样性是否稳定产量并缓冲天气变率；加拿大安大略省长期田间试验/作物生产系统尺度。 | 轮作试验产量时间序列与同期天气变率；摘要支持长期试验类型，详细站点、作物处理与观测期应据全文提取。 | 对“不同天气下的产量稳定性”有直接相关性；局地长期试验的土壤和管理环境限制外推。 |
| 8 | Yang et al. (2024), *Nature Communications*；[DOI/开放全文入口](https://doi.org/10.1038/s41467-023-44464-9)；摘要/元数据核验 | 华北平原六年田间试验，比较传统小麦–玉米与引入甘薯、花生、大豆的轮作，对等价产量、温室气体、土壤健康和收入的影响。 | 田间产量、土壤理化/生物指标、温室气体与经济数据；摘要未确认数据存储仓库、坐标精度或具体地块样本数，需全文/数据声明复核。 | 摘要报告等价产量最高提升 38%、N₂O 降低 39%、系统温室气体平衡改善 88%、土壤有机碳库存提升 8%、综合土壤健康指标提升 45%；六年单地区试验，不能视作全球参数。 |
| 9 | Costa et al. (2024), *Global Change Biology*；[DOI](https://doi.org/10.1111/gcb.17298)；摘要/元数据核验 | 多地点轮作多样性是否缓解气候导致的谷物减产；跨地点长期试验综合分析。 | 各地长期试验的轮作、谷物产量与气候数据；摘要未充分说明样本数和全部来源，需全文确认。 | 与 NASA 天气/遥感特征构造“气候暴露×管理×结果”假设相关；站点试验不等同于全球遥感像元因果识别。 |

### 3.2 作物模型、决策支持与优化

| # | 文献及证据层级 | 具体问题、地点/尺度与方法 | 数据来源及获取 | 验证、发现与局限 |
|---|---|---|---|---|
| 10 | Dury et al. (2011), *Agronomy for Sustainable Development*；[DOI](https://doi.org/10.1007/s13593-011-0037-x)；摘要/元数据核验 | 综述支持 cropping plan 和 crop rotation 的模型；比较形式化决策模型及其空间/时间尺度和目标。 | 综述既有模型研究；不是独立农场数据集。 | 适合建立方法分类和决策支持边界；发表较早，需与新一代数字农业及共同设计研究互补。 |
| 11 | Dogliotti et al. (2003), *European Journal of Agronomy*；[DOI](https://doi.org/10.1016/S1161-0301(02)00047-3)；开放仓储全文入口：[WUR](https://research.wur.nl/en/publications/rotat-a-tool-for-systematically-generating-crop-rotations)；元数据核验 | ROTAT 如何系统生成可行作物序列；模型把作物轮作知识转为序列构造工具。 | 作物需求、季节与轮作规则等知识输入；工具不是自动产生或验证真实农场观测。精确参数与案例需读全文。 | 证明“候选策略生成”可以与“策略评分”分层；规则完整性和地区适配是关键限制。 |
| 12 | Groot et al. (2012), *Agricultural Systems*；[DOI](https://doi.org/10.1016/j.agsy.2012.03.012)；摘要/元数据核验 | 多目标优化如何用于农业系统设计与权衡；系统/农场规划尺度。 | 农业系统模型或规划输入中的资源、产量、经济和环境指标；摘要未核明数据集清单和案例细节。 | 为 Pareto/多目标比较提供方法依据；目标权重、边界和模型假设需显式呈现，最优解不是唯一农户偏好。 |
| 13 | Liang et al. (2023), *Sustainable Production and Consumption*；[DOI](https://doi.org/10.1016/j.spc.2023.07.018)；开放获取状态经 OpenAlex 核验；摘要/元数据层 | 提出设计多样化轮作以改善可持续性的系统方法并示范应用。 | 作物/轮作设计与可持续性指标；摘要级元数据未显示完整参数、案例字段和验证样本，需全文复核。 | 可用于构造替代序列候选；项目需要确认该方法的地区、输入要求和能否表达设备/市场硬约束。 |
| 14 | Schöning et al. (2023), *Smart Agricultural Technology*；[DOI](https://doi.org/10.1016/j.atech.2022.100086)；摘要/元数据核验 | 综述轮作和管理工具是否适用于不同类型农户、当前工具状态和可及性。 | 对现有工具/研究的综述，非单一原始农场数据。 | 直接提示工具适用性、信息门槛与农户差异要纳入设计；不能将存在 DSS 等同于农户采用或田间有效。 |
| 15 | Rose et al. (2016), *Agricultural Systems*；[DOI](https://doi.org/10.1016/j.agsy.2016.09.009)；开放稿入口经 OpenAlex 核验；摘要/元数据层 | 农业决策支持工具如何被有效设计和交付；跨农业 DSS 研究。 | 综述/概念综合，关注工具开发与交付证据，不是轮作效应数据集。 | 支持以用户需求、工作流程、可信度和共同设计评估工具；未提供 Field Shift 专属的轮作参数。 |

### 3.3 农户偏好、遥感与土壤数据产品

| # | 文献及证据层级 | 具体问题、地点/尺度与方法 | 数据来源及获取 | 验证、发现与局限 |
|---|---|---|---|---|
| 16 | Sarwosri & Mußhoff (2020), *Journal of International Development*；[DOI](https://doi.org/10.1002/jid.3483)；摘要/元数据核验 | 风险态度和时间偏好是否影响小农户作物多样化；农户决策尺度。 | 农户调查/选择实验类证据（具体国家、样本量和工具在本次摘要元数据中未充分披露，需全文复核）。 | 说明偏好和风险选择可能影响采纳；不得把群体调查估计当作某一农户偏好。 |
| 17 | Zhang et al. (2025), *Land*；[DOI/开放全文](https://doi.org/10.3390/land14010158)；摘要/元数据核验 | 使用结构方程模型研究中国黑龙江农户轮作意向与行为。 | 农户问卷变量及自报/行为数据；样本数、抽样框、量表和微观数据开放性应在全文与数据声明确认。 | 可提供中国农户层面偏好和行为变量范例；横截面问卷和结构方程路径不等于试验因果效果，迁移至其他地区需重估。 |
| 18 | Lobell et al. (2015), *Remote Sensing of Environment*；[DOI](https://doi.org/10.1016/j.rse.2015.04.021)；摘要/元数据核验 | 卫星观测能否规模化估算作物产量；美国农田尺度遥感制图方法。 | 卫星遥感时序、田块/县级产量统计和作物掩膜等；具体遥感传感器、空间尺度与验证拆分需全文核对。 | 说明卫星需与地面产量标签配对训练/验证；产量模型不能直接给出作物轮作因果效益。 |
| 19 | de Sousa et al. (2021), *SOIL*；[DOI/开放全文](https://doi.org/10.5194/soil-7-217-2021)；数据产品论文 | SoilGrids 2.0 如何提供全球土壤属性及空间不确定性。 | 全球土壤剖面观测和环境协变量建模；官方土壤栅格、深度层与不确定性产品可从 [SoilGrids](https://www.isric.org/explore/soilgrids) 获取。 | 可用于缺少实测时的先验/背景层；模型预测不等于田间化验，需结合不确定性和本地土壤样本。 |

> 当前表格包括 **19 篇**。其中全文核读的实证研究较少，摘要/元数据型条目已明确标记。发表元数据核验不意味着本轮已阅读相应全文；在进一步实施策略参数化前，建议优先补读相关开放全文、补充材料和数据声明。

## 4. 研究中使用的数据与本项目建议来源

区分“论文实际使用的数据”与“项目可选来源”十分重要。论文里的现场数据不能因变量相似而被当作公开产品，本表的项目来源是推荐的补充入口，并不表示上述文献都使用了它们。

| 数据类别 | 研究常见数据/变量 | 本项目可获取来源 | 获取方式、可访问性与局限 |
|---|---|---|---|
| 环境与水热条件 | 气温、降水、辐射、蒸散、土壤水分、热胁迫、植被状态 | 已列 NASA 数据：SMAP、GPM、ECOSTRESS、HLS/Landsat、MODIS、POWER、GRACE；NASA CMR / Earthdata Search | Earthdata 注册可下载部分产品；按研究区、变量和时期裁剪。卫星分辨率和云/缺测限制不等于田块实测。 |
| 土壤剖面/基础属性 | 土壤质地、pH、有机碳/有机质、总氮、CEC、容重、排水、有效持水量及深度 | 全球：[ISRIC SoilGrids](https://www.isric.org/explore/soilgrids)；美国：[USDA Soil Data Access](https://sdmdataaccess.nrcs.usda.gov/) / SSURGO、gSSURGO；其他地区国家土壤调查 | 下载或空间服务查询；保留预测/地图单元、土层深度、属性定义及不确定度。土壤图斑组分需按面积权重汇总，全球产品需本地检测校准。 |
| 作物生育期/种植日历 | 作物和地区的播种、开花、收获窗口、季长、气候适宜度 | [FAO Crop Calendar](https://cropcalendar.apps.fao.org/)；国家农业部门、地方农技推广/大学 Extension、农户经营记录 | FAO 日历可按地区与作物查询；本地推广资料/农户记录用于修正品种、海拔、灌溉和播期差异。需记录地区版本和适用季节。 |
| 作物生理与水分参数 | 生育阶段、根深、作物系数 Kc、需水量、温度阈值、耐旱/涝/寒性 | FAO-56 [ET 与 Kc 指南](https://www.fao.org/4/x0490e/x0490e00.htm)；当地作物模型参数库、试验站/Extension、品种登记与栽培指南 | FAO-56 提供参考框架而非所有作物品种的本地参数；参数应按品种、土壤、管理和地区记录来源/范围。 |
| 种植身份及历史 | 逐年作物、品种、地块边界、播收期、覆盖作物/休耕、轮作顺序 | 首选农户/农场管理记录和地块上传；美国 [USDA Cropland Data Layer](https://www.nass.usda.gov/Research_and_Science/Cropland/SARS1a.php)；全球辅助分类 [ESA WorldCereal](https://developers.google.com/earth-engine/datasets/catalog/ESA_WorldCereal_2021_MODELS_v100) | 农户确认优先于遥感分类；CDL 等地区产品有分类误差，年度覆盖与类别体系因国家/年份而异。Field boundaries 对地块决策不可缺。 |
| 轮作顺序/病虫害规则 | 同科连作间隔、寄主关系、前茬效应、固氮、覆盖作物终止、残茬管理 | 地方轮作指南、大学 Extension、国家植保部门；[EPPO Global Database](https://gd.eppo.int/) 可查害物与寄主信息；由农业专家审核的结构化规则库 | 公共资料常为建议文本而不是机器可用 API；应保存规则适用地区、作物分类、来源和专家核验状态。 |
| 投入、产量与经营结果 | 产量/品质、肥料/农药/灌溉投入、机械作业、成本、劳力、收入 | 农户农场账本、合作社/试验站长期试验；美国可参考 USDA NASS/ARMS 公布的聚合统计 | 微观农场账本通常私有，必须取得农户授权并做最小化收集；区域统计适合作基准，不应伪装成地块真值。 |
| 市场与可行性 | 收购渠道、价格、需求、运输成本、合同/保险、设备和劳力能力 | 当地批发市场、合作社/收购商、政府市场信息；美国 [USDA AMS Market News](https://www.ams.usda.gov/market-news)；直接询问农户 | 报价并非农场实际净收益；需记录价格日期、等级、地区、交易方式及运输/投入成本。设备、合同等约束通常要农户输入。 |
| 农户目标与偏好 | 节水、现金流、饲料、市场、土壤改良、风险偏好、可接受劳力/资本 | 产品内结构化访谈/问卷或农户共同设计工作坊 | 属于项目需要采集的原始用户输入，不存在可替代的遥感数据集；权重可由用户调整，硬约束应与偏好分开。 |
| 结果与验证标签 | 土壤复测、收成、用水、经济回报、病害、模型建议是否采用/执行 | 农户自愿记录、土壤实验室、农业试验站、地方专家田间核验 | 预测验证应使用独立年份/地块或外部站点；同一数据训练和评价会高估泛化能力。 |

## 5. 对 Field Shift 的研究切入点

### 最小研究问题

建议将首版研究问题限定为：

> 在某一试点地区和明确作物体系内，结合历史水热/植被胁迫、土壤基础属性、作物日历与农户硬约束，能否筛出可执行的两种替代轮作，并以透明指标比较它们相对现有轮作的潜在节水、土壤改良、生产/经济和管理权衡？

这是决策支持问题，不是仅凭卫星证明轮作改变了土壤健康或提高了产量的因果问题。

### 最小补充数据组合

1. **决策单元**：一个试点区、若干真实地块边界；每个地块至少有当前轮作/作物、播收季节和灌溉条件。尽可能补 3–5 年历史，缺失年份显式编码。
2. **土壤**：试点可用土壤调查/SoilGrids 作为背景，至少收集土层、质地、pH、有机碳/有机质、排水或有效持水量中的可用项；有检测报告时优先校准。保存测量深度和日期。
3. **作物知识库**：首版限定 5–10 种候选作物；每种至少有当地播收窗口、季长、需水/根系特征、固氮/饲用/覆盖潜力和适用来源；不可确认的值设为未知/范围，不填造精确值。
4. **轮作规则**：建立作物科属、同科间隔、宿主病虫害、收获—下茬窗口、覆盖作物终止和设备兼容的硬约束/警告规则，并由当地农艺人员审阅。
5. **偏好与经营约束**：由农户选择目标优先级，并填写灌溉额度、设备、劳力、预算、市场渠道、不可接受作物；明确哪些为硬约束、哪些为可调权重。
6. **环境特征**：使用已有 NASA 时间序列构造季节性热/水分/降水/植被异常与观测质量特征，避免把不同时间窗口误当成同日观测。将粗分辨率数据作为背景证据并标出尺度。
7. **比较输出**：为每个地块形成“现有轮作＋2 个可行备选”；呈现目标分项、适宜季节、证据来源、收益/风险、数据缺口及需人工复核事项。

### 可迁移的方法与不可作出的主张

- **可迁移**：长期实验的多指标评估思路；meta-analysis 的异质性提醒；模型生成候选序列与多目标排序分离；遥感与地面产量/土壤标签联合验证；农户共同设计。
- **当前数据不足以支持**：准确预测某田块下一年产量；给出确定的氮固定公斤数或有机碳增量；断言某轮作可降低特定病虫害；计算真实净收益；将 SMAP/GPM/POWER 的区域尺度信息声称为田间实测。
- **因果证据要求**：如果后续要声称“推荐轮作导致产量/土壤改善”，需长期、重复、多点对照试验或具有可信反事实的观察性研究设计；现有 NASA 时序本身不能建立该因果关系。

## 6. 文献质量与下一步精读顺序

本文件是**定向综述，不是系统综述**：没有按预注册协议穷尽所有数据库，也没有对所有纳入研究进行风险偏倚评分。部分 DOI、作者和出版年由 Crossref/OpenAlex 核验，但方法/数据细节只在全文可读时才提取。

实施前建议依次精读：

1. Davis et al. (2012) 与 Yang et al. (2024)：提取试验处理、农艺管理、土壤/经济结果和补充数据表，作为三方案多指标结构参考。
2. Bowles et al. (2020)、Gaudin et al. (2015)、Costa et al. (2024)：核实长期站点、天气变量、轮作多样性定义和统计验证，避免泛化摘要结论。
3. Dogliotti et al. (2003)、Dury et al. (2011)、Groot et al. (2012)、Liang et al. (2023)：提取轮作生成所需规则、决策变量、目标函数和约束形式。
4. Sarwosri & Mußhoff (2020)、Zhang et al. (2025)、Rose et al. (2016)：核实问卷/偏好变量、用户参与方式和 DSS 评价指标。
5. Beillouin et al. (2021)、Tamburini et al. (2020)、Poeplau & Don (2015)、Abdalla et al. (2019)：按“轮作 vs 其他多样化实践”、土层深度和年限拆分效应，避免直接搬用总体均值。

## 7. 参考文献

1. Abdalla, M., Hastings, A., Cheng, K., Qian, Y., Chadwick, D. R., Espenberg, M., Truu, J., Rees, R. M., & Smith, P. (2019). A critical review of the impacts of cover crops on nitrogen leaching, net greenhouse gas balance and crop productivity. *Global Change Biology*. https://doi.org/10.1111/gcb.14644
2. Beillouin, D., Ben-Ari, T., Malézieux, E., Seufert, V., & Makowski, D. (2021). Positive but variable effects of crop diversification on biodiversity and ecosystem services. *Global Change Biology*. https://doi.org/10.1111/gcb.15747
3. Bowles, T. M., Mooshammer, M., Socolar, Y., Calderón, F., Cavigelli, M. A., Culman, S. W., Deen, W., Drury, C. F., Garcia y Garcia, A., Gaudin, A. C. M., Harkcom, W. S., Lehman, R. M., Osborne, S. L., Robertson, G. P., Salerno, J., Schmer, M. R., Strock, J., & Grandy, A. S. (2020). Long-Term Evidence Shows that Crop-Rotation Diversification Increases Agricultural Resilience to Adverse Growing Conditions in North America. *One Earth*. https://doi.org/10.1016/j.oneear.2020.02.007
4. Costa, A., Bommarco, R., Smith, M. E., Bowles, T. M., Gaudin, A. C. M., Watson, C. A., et al. (2024). Crop rotational diversity can mitigate climate-induced grain yield losses. *Global Change Biology*. https://doi.org/10.1111/gcb.17298
5. Davis, A. S., Hill, J. D., Chase, C. A., Johanns, A. M., & Liebman, M. (2012). Increasing Cropping System Diversity Balances Productivity, Profitability and Environmental Health. *PLOS ONE, 7*(10), e47149. https://doi.org/10.1371/journal.pone.0047149
6. Dogliotti, S., Rossing, W. A. H., & van Ittersum, M. K. (2003). ROTAT, a tool for systematically generating crop rotations. *European Journal of Agronomy*. https://doi.org/10.1016/S1161-0301(02)00047-3
7. Dury, J., Schaller, N., Garcia, F., Reynaud, A., & Bergez, J.-E. (2011). Models to support cropping plan and crop rotation decisions. A review. *Agronomy for Sustainable Development*. https://doi.org/10.1007/s13593-011-0037-x
8. Gaudin, A. C. M., Tolhurst, T. N., Ker, A. P., Janovicek, K. J., Tortora, C., Martin, R. C., & Deen, W. (2015). Increasing Crop Diversity Mitigates Weather Variations and Improves Yield Stability. *PLOS ONE, 10*(2), e0113261. https://doi.org/10.1371/journal.pone.0113261
9. Groot, J. C. J., Oomen, G. J. M., & Rossing, W. A. H. (2012). Multi-objective optimization and design of farming systems. *Agricultural Systems*. https://doi.org/10.1016/j.agsy.2012.03.012
10. de Sousa, L. M., Poggio, L., Batjes, N. H., Heuvelink, G. B. M., Kempen, B., Ribeiro, E., & Rossiter, D. G. (2021). SoilGrids 2.0: producing soil information for the globe with quantified spatial uncertainty. *SOIL, 7*, 217–240. https://doi.org/10.5194/soil-7-217-2021
11. Liang, Z., Zhan, X., Cheng, J., Ma, B., Cong, W.-F., Zhang, C., Zhang, F. S., van der Werf, W., & Groot, J. C. J. (2023). Designing diversified crop rotations to advance sustainability: A method and an application. *Sustainable Production and Consumption*. https://doi.org/10.1016/j.spc.2023.07.018
12. Lobell, D. B., Thau, D., Seifert, C., Engle, E., & Little, B. (2015). A scalable satellite-based crop yield mapper. *Remote Sensing of Environment*. https://doi.org/10.1016/j.rse.2015.04.021
13. Poeplau, C., & Don, A. (2015). Carbon sequestration in agricultural soils via cultivation of cover crops – A meta-analysis. *Agriculture, Ecosystems & Environment*. https://doi.org/10.1016/j.agee.2014.10.024
14. Rose, D. C., Sutherland, W. J., Parker, C., Lobley, M., Winter, M., Morris, C., Twining, S., Ffoulkes, C., Amano, T., & Dicks, L. V. (2016). Decision support tools for agriculture: Towards effective design and delivery. *Agricultural Systems*. https://doi.org/10.1016/j.agsy.2016.09.009
15. Sarwosri, A. W., & Mußhoff, O. (2020). Are Risk Attitudes and Time Preferences Crucial Factors for Crop Diversification by Smallholder Farmers? *Journal of International Development*. https://doi.org/10.1002/jid.3483
16. Schöning, A., Wachter, S., & Trautz, D. (2023). Crop rotation and management tools for every farmer? *Smart Agricultural Technology*. https://doi.org/10.1016/j.atech.2022.100086
17. Tamburini, G., Bommarco, R., Wanger, T. C., Kremen, C., van der Heijden, M. G. A., Liebman, M., & Hallin, S. (2020). Agricultural diversification promotes multiple ecosystem services without compromising yield. *Science Advances, 6*(45), eaba1715. https://doi.org/10.1126/sciadv.aba1715
18. Yang, X., Xiong, J., Du, T., Ju, X., Gan, Y., Li, S., Xia, L., Shen, Y., Pacenka, S., Steenhuis, T. S., Siddique, K. H. M., Kang, S., & Butterbach-Bahl, K. (2024). Diversifying crop rotation increases food production, reduces net greenhouse gas emissions and improves soil health. *Nature Communications, 15*. https://doi.org/10.1038/s41467-023-44464-9
19. Zhang, R., Du, G., Faye, B., & Liu, H. (2025). Analysis of Farmers’ Crop Rotation Intention and Behavior Using Structural Equation Modeling: Evidence from Heilongjiang Province, China. *Land, 14*(1), 158. https://doi.org/10.3390/land14010158

### 访问与核验记录

- **PLOS 全文**：Davis et al. (2012) 在浏览器中可读全文及补充材料索引；本文提取了站点、处理、重复、数据日志、气象站和统计模型信息。
- **开放全文/数据产品入口**：SoilGrids 2.0、Gaudin et al.、Yang et al.、NASA/FAO/USDA 官方入口列于正文；部分出版社实际可访问性会因网络/地区变化。
- **Crossref/OpenAlex 元数据**：其余论文使用 DOI、出版年份、作者和 OA 状态交叉核对。OA 标记只表示索引中存在开放稿入口，不保证本文已逐篇全文阅读。
- 本轮没有下载大型科学数据、没有进行系统性偏倚评价，也没有把论文报告的跨地区平均效应当作项目模型的直接参数。
