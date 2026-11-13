# NASA 地球科学数据集与 API 接口

面向 Field Shift 九项目标特征的最终取舍、产品去重和多尺度融合方案见 [`data-source-selection.md`](data-source-selection.md)。本页是候选产品目录，不表示所有产品都应同时入模。

## 数据来源
- https://search.earthdata.nasa.gov/
- https://data.nasa.gov/
- https://api.nasa.gov/

## 科学数据集

| 数据系列 | 产品与版本 | 类型 | 主要含义、用途与术语 | 官方链接 |
|---|---|---|---|---|
| SMAP | `SPL3SMP_E` V006 | 数据集 | **表层土壤湿度**，9 km 网格、逐日合成。适合跟踪表层土壤干湿变化。EASE‑Grid 是等面积网格。 | [集合详情](https://search.earthdata.nasa.gov/search/granules/collection-details?p=C2938664763-NSIDC_CPRD) |
| SMAP | `SPL4SMGP` V008 | 数据集 | **表层和根区土壤湿度**，9 km 网格、每 3 小时。通过数据同化将卫星观测融入陆面模型，可分析作物根系所在土层的水分变化。 | [集合检索](https://search.earthdata.nasa.gov/search?q=SPL4SMGP) |
| ECOSTRESS | `ECO_L2T_LSTE` V003 | 数据集 | **地表温度与发射率**，70 m、过境时刻观测。LST 是地表温度，发射率描述地表发射热辐射的能力。适合分析城市热岛和地块间的热差异。 | [产品详情](https://doi.org/10.5067/ECOSTRESS/ECO_L2T_LSTE.003) |
| ECOSTRESS | `ECO_L3T_JET` V003 | 数据集 | **瞬时和白天蒸散发**，70 m。ET 包括地表蒸发和植物蒸腾，可用于分析农田耗水和地块间的蒸散差异。 | [集合详情](https://search.earthdata.nasa.gov/search/granules/collection-details?p=C4057232489-LPCLOUD) |
| GPM | `GPM_3IMERGHHE` V07 · Early | 数据集 | **半小时降水**，0.1° 网格，约 4 小时延迟。IMERG 是多卫星融合降水产品，Early 用于快速跟踪降雨。 | [Early 集合检索](https://search.earthdata.nasa.gov/search?q=GPM_3IMERGHHE) |
| GPM | `GPM_3IMERGHHL` V07 · Late | 数据集 | **半小时降水**，0.1° 网格，约 14 小时延迟。Late 可纳入更多到达较晚的观测，适合当天或次日分析。 | [Late 集合检索](https://search.earthdata.nasa.gov/search?q=GPM_3IMERGHHL) |
| GPM | `GPM_3IMERGHH` V07 · Final | 数据集 | **半小时降水**，0.1° 网格。Final 纳入月度雨量计分析，通常在观测月份后约 3.5 个月发布，适合回溯暴雨过程。 | [半小时 Final 集合](https://search.earthdata.nasa.gov/search/granules/collection-details?p=C2723754847-GES_DISC) |
| GPM | `GPM_3IMERGDF` V07 · Final | 数据集 | **逐日降水**，0.1° 网格。适合比较日尺度降雨、计算连续干湿日或匹配逐日水文数据。 | [逐日 Final 集合检索](https://search.earthdata.nasa.gov/search?q=GPM_3IMERGDF) |
| GPM | `GPM_3IMERGM` V07 · Final | 数据集 | **月尺度降水**，0.1° 网格。适合分析季节分布和月际异常。计算月累计量前，查看变量单位以区分降水率和累计量。 | [月度 Final 集合](https://search.earthdata.nasa.gov/search/granules/collection-details?p=C2723754851-GES_DISC) |
| Landsat／HLS | `HLSL30` V2.0 | 数据集 | **Landsat 8/9 的 30 m 地表反射率**。HLS 对 Landsat 和 Sentinel‑2 数据进行协调处理，便于构建跨卫星的植被和地表变化时间序列。 | [HLSL30 集合详情](https://search.earthdata.nasa.gov/search/granules/collection-details?p=C2021957657-LPCLOUD) |
| Sentinel‑2／HLS | `HLSS30` V2.0 | 数据集 | **Sentinel‑2 的 30 m 地表反射率**。与 HLSL30 配套使用，可增加同一区域的可用观测日期。 | [HLSS30 集合检索](https://search.earthdata.nasa.gov/search?q=HLSS30) |
| Landsat／USGS | Landsat 8–9 Collection 2 Level‑2 | 数据集 | **逐景地表反射率（SR）和地表温度（ST）**。适合按具体过境日期选取影像。在 EarthExplorer 的 Data Sets → Landsat → Landsat Collection 2 Level‑2 下选取。 | [USGS EarthExplorer](https://earthexplorer.usgs.gov/) |
| MODIS／Terra | `MOD13Q1` V061 | 数据集 | **植被指数**，250 m、16 天合成。NDVI 是归一化植被指数，EVI 是增强植被指数，可用于跟踪植被绿度和生长季变化。 | [集合详情](https://search.earthdata.nasa.gov/search/granules/collection-details?p=C1748066515-LPCLOUD) |
| MODIS／Terra | `MOD11A2` V061 | 数据集 | **地表温度与发射率**，1 km、8 天合成，包含昼间和夜间地表温度，适合分析区域地表热环境。 | [集合详情](https://search.earthdata.nasa.gov/search/granules/collection-details?p=C2269056084-LPCLOUD) |
| MODIS／Terra + Aqua | `MCD43A4` V061 | 数据集 | **方向校正地表反射率**，500 m、逐日发布，每期使用 16 天观测。BRDF 描述反射率随照明和观测角度的变化。产品将观测角度归一到天底方向，便于跨日期比较。 | [集合检索](https://search.earthdata.nasa.gov/search?q=MCD43A4) |
| NASA POWER | Prediction Of Worldwide Energy Resources | 数据集目录 | **气象和太阳辐射时间序列**，包括小时、日、月和气候态。目录提供数据说明和服务入口，实际取数使用下表的 POWER API。 | [NASA 开放数据目录条目](https://data.nasa.gov/dataset/prediction-of-worldwide-energy-resources-power) |
| GRACE | `GRACE_GSM_L2_GRAV_JPL_RL06` | 数据集 | **GRACE 的 JPL Level‑2 重力场球谐系数**。球谐系数用于表达地球重力场，适合自行处理重力变化并反演质量变化。 | [GRACE 产品详情](https://podaac.jpl.nasa.gov/dataset/GRACE_GSM_L2_GRAV_JPL_RL06) |
| GRACE‑FO | `GRACEFO_L2_JPL_MONTHLY_0063` | 数据集 | **GRACE 后续任务的月度重力场球谐系数**，JPL Release 6.3。适合延续重力场分析。 | [GRACE‑FO 产品详情](https://podaac.jpl.nasa.gov/dataset/GRACEFO_L2_JPL_MONTHLY_0063) |
| GRACE + GRACE‑FO | JPL Mascon CRI `RL06.3Mv04` | 数据集 | **跨任务月度等效水厚异常**，可分析流域总水储量相对参考均值的变化。Mascon 是估计质量变化的区域单元，CRI 减少沿海陆地和海洋之间的信号混叠。独立估计单元约 3°，两任务交接期有缺测。 | [Mascon CRI 集合详情](https://search.earthdata.nasa.gov/search/granules/collection-details?p=C3195527175-POCLOUD) |
| SRTM | `SRTMGL1` V003 | 数据集 | **雷达数字高程模型（DEM）**，1 弧秒、约 30 m，覆盖约 60°N–56°S。可用于计算坡度、划分流域和分析地形。 | [SRTM 集合详情](https://search.earthdata.nasa.gov/search/granules/collection-details?p=C2763266360-LPCLOUD) |
| NASADEM | `NASADEM_HGT` V001 | 数据集 | **SRTM 重处理高程**，1 弧秒、约 30 m。可用于采用重处理 SRTM 高程的地形分析。 | [NASADEM 集合检索](https://search.earthdata.nasa.gov/search?q=NASADEM_HGT) |
| ASTER | `ASTGTM` V003 | 数据集 | **光学立体影像生成的全球 DEM**，1 弧秒、约 30 m。可与雷达高程对照，也可查询 SRTM 覆盖以外的区域。 | [ASTER GDEM 集合详情](https://search.earthdata.nasa.gov/search/granules/collection-details?p=C1711961296-LPCLOUD) |

## API 接口

| 对应数据系列 | 接口 | 类型 | 主要含义、用途与术语 | 官方链接 |
|---|---|---|---|---|
| NASA POWER | Daily Point API | API · 科学数据取数 | 按经纬度、日期和变量返回逐日数值。`T2M` 是 2 m 气温，`ALLSKY_SFC_SW_DWN` 是全天空条件下地表向下短波辐照量。示例返回新加坡坐标 2024 年 1 月 1–3 日的 JSON 数据。 | [浏览器实测的 JSON 请求](https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M,ALLSKY_SFC_SW_DWN&community=RE&longitude=103.8198&latitude=1.3521&start=20240101&end=20240103&format=JSON) |
| NASA POWER | Daily API 参数文档 | API · 文档 | 查看逐日查询支持的空间范围、参数和输出格式，用于构建取数请求。 | [Daily API 文档](https://power.larc.nasa.gov/docs/services/api/temporal/daily/) |
| Earthdata 多个系列 | CMR Search API | API · 元数据检索 | CMR 是 NASA 的通用元数据仓库。Collection 是产品集合，Granule 是集合中的具体文件或观测单元。可批量查询产品版本、文件清单和访问链接。 | [CMR Search API 文档](https://cmr.earthdata.nasa.gov/search/site/docs/search/api.html) |
| Earthdata 多个影像系列 | GIBS | API · 地图影像浏览 | GIBS 提供地图影像图层。WMTS 提供地图瓦片，WMS 按请求范围返回地图图像。适合预览和地图叠加。定量分析使用科学数据集中的变量文件。 | [NASA API 门户的 GIBS 条目](https://api.nasa.gov/#gibs) |
