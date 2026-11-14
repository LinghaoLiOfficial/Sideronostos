# NASA 数据自动获取与三年轮作回测管线

本实现为离线 CLI，只读取真实 NASA 服务和 Earthdata 文件，不在后端 API、数据库或前端地图中增加功能。默认研究区是 Iowa `42.0°N, 93.5°W` 附近四个合成田块；它们仅用于工程验收，不是地籍边界或种植建议。

## 安装与入口

```bash
cd sideronostos-backend
uv sync --extra nasa --extra optimizer --group dev
uv run sideronostos_nasa auth-check
```

认证只从用户的 Earthdata `.netrc` 读取。日志、配置和 `run-manifest.json` 都不保存用户名、密码或 token。默认输出位于被 Git 忽略的 `data/nasa/iowa-2022-2024/`。

## 命令

```bash
uv run sideronostos_nasa generate-aoi
uv run sideronostos_nasa audit
uv run sideronostos_nasa plan
uv run sideronostos_nasa analyze
uv run sideronostos_nasa fetch
uv run sideronostos_nasa fetch --completed-only
uv run sideronostos_nasa prepare
uv run sideronostos_nasa optimize
uv run sideronostos_nasa run-all
```

- `audit` 实时查询 CMR 和 AppEEARS 产品支持，生成 `audit/availability.json`。
- `plan` 检查 12 GiB 总上限、各产品子预算和至少 50 GiB 剩余空间。
- 各产品额度总和不超过 12 GiB；AppEEARS 全部任务完成后，先汇总所有 bundle 文件清单再下载，超限会在任何 bundle 文件写入前失败。
- `fetch` 真实获取 POWER、GPM、SMAP、HLS、ECOSTRESS V002、SRTM 和 GRACE。AppEEARS 可用 `--submit-only` 只提交任务，稍后重复执行以恢复。
- `fetch --completed-only` 只下载当前已经完成的 AppEEARS 任务，不等待 `pending` 或 `processing` 任务；下载保留 bundle 相对目录，并严格校验 `file_size` 与 `sha256`。运行此命令前不要让另一个 `fetch` 同时写同一目录。
- `prepare` 完成 QA、月/年聚合和 EPSG:4326 COG；POWER 保持 CSV 和点 GeoJSON。
- `optimize` 使用 POWER 温湿风压辐射、GPM 降水和 SRTM 高程，分别回测 2022、2022–2023、2022–2024。
- `analyze` 只读已获取的 POWER、GPM、SRTM、GRACE，在 `analysis/non-appeears/` 生成年度/月度统计、CSV/JSON 和离线 HTML 图表；不访问或读取 AppEEARS 文件，也不改写采集清单、图层清单或优化结果，可在 `fetch` 运行期间执行。
- 分析报告把 POWER ET0 与 GPM 降水之差作为气候背景指标，不当作灌溉需水；GPM 0.1° 和 GRACE 约 3° mascon 不解释为单田块观测。SRTM 地形图叠加的是合成田块边界。

可以用 `fetch --products power gpm` 只执行部分产品。所有下载和任务都是幂等的；HTTP 文件先写 `.part`，完成后原子改名。由 `earthaccess` 管理的 SRTM/GRACE 下载采用 SDK 的恢复机制，随后计算 SHA-256。

## 数据语义

| 产品 | 获取路径 | 进入 MILP | 图层语义 |
|---|---|---|---|
| POWER | Temporal Daily Point API | 温度、露点、风、气压、辐射 | 点 GeoJSON，不插值为栅格 |
| GPM IMERG Final Daily V07 | CMR + GES DISC OPeNDAP **DAP4** AOI 子集 | 替代 POWER 降水 | 0.1° 年累计和异常 COG |
| SMAP SPL4SMGP.008 | AppEEARS 四田块中心点 | 证据/校验 | 月根区水分，明确 9 km 支撑尺度 |
| HLS L30/S30 V2.0 | AppEEARS AOI | 证据/校验 | Fmask 后月 NDVI/NDMI，30 m |
| ECOSTRESS V002 | AppEEARS AOI | 证据/校验 | 稀疏 LST/ET；不插值，不混用 V003 |
| SRTMGL1.003 | Earthdata 小型瓦片 | AOI 平均高程进入 FAO-56 ET0 | 高程、坡度、坡向 COG |
| GRACE/GRACE-FO Mascon | PO.DAAC NetCDF | 证据/情景背景 | 全球年平均异常；不得解释为田块水量 |

SMAP 月有效率低于 70% 时保持缺失；HLS 没有通过 Fmask 的月保持缺失；ECOSTRESS 不设连续性要求；GRACE 缺月不外推。POWER 或 GPM 任一天缺失都会阻止相应期限求解，不补零、不静默插值。

### GPM 的 DAP4 注意事项

IMERG Final 文件包含 DAP2 无法表示的 `Int8` 变量。若直接把 CMR 返回的 `https://opendap...nc4` URL 交给 PyDAP，服务会返回 HTTP 400，并提示切换 DAP4；这不是 Earthdata 审批失败。采集器会保留官方 URL，但在 PyDAP 内部将 scheme 改为 `dap4://`，并只读取 `precipitation` 的 AOI 子集。若出现 HTTP 403，才表示账号仍未批准 GES DISC 应用条款。

## 验收

纯计算测试不模拟 NASA 响应：

```bash
uv run ruff check src/sideronostos_backend/modules/agri_data/acquisition tests/test_nasa_acquisition.py
uv run mypy src/sideronostos_backend/modules/agri_data/acquisition
uv run pytest tests/test_nasa_acquisition.py
```

联网验收必须使用真实 Earthdata 会话运行 `auth-check`、`audit`、`plan` 和 `fetch`。最终检查 `run-manifest.json` 的 collection/granule、URL、大小和 SHA-256，以及 `layers/layer-manifest.json` 的 CRS、bounds、nodata 和 overviews。
