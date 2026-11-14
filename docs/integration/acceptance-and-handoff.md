# Field Shift v3：验收与交接

状态：工程链路可运行，整体目标尚未验收完成。真实试点尚未选择；实时 AI 语义验收
已恢复 provider 访问，但开发集语义质量尚未通过。本文件描述当前边界，不替代最终验收结论。
实施基线为 `main / 8c498cf`，工作分支为 `codex/fields-bot-model-v3`。
当前前端回归 317 / 317 通过，production build 和本次变更 ESLint 通过；后端本轮完整回归为 554 / 554，Ruff 与无缓存 mypy 通过。
未推送、合并远端或部署；现有应用数据库没有被本次工程验收迁移或填入测试资料。

## A. 工程基准怎么使用

本次运行验证使用独立的 `sideronostos_fields_v3_journey_test` 数据库、
`fields-v3-journey` Temporal 队列，以及本地 production-mode 前端和 API。
前端 `http://localhost:3040/fields`，API `http://localhost:8040`。
这些是本机验收服务，不是公开站点；账号凭证和服务密钥不保存在本交接文档。
后端、数据库、任务分发器和 worker 均须运行。环境准备与常规启动命令见
[后端 README](../../sideronostos-backend/README.md)、[前端 README](../../sideronostos-frontend/README.md)。

1. 在 `/fields` 登录后绘制或导入农场，选择条带/网格分割并核对边界。
   匿名绘图仍是本机草稿；登录后的“复制匿名农场”是显式复制，不会自动认领共享浏览器数据。
2. 确认分割后逐块填写土壤质地、是否能够灌溉和已知前茬，保存到账户。
   “边界已确认”“已同步”“资料足够计算”是三个不同状态。
   返回列表核对总地块数；未上传的边界仍只能从原设备或导出文件取得。
3. 打开“轮作规划”，明确勾选本次参与计算的地块。最多 10 块；地图可生成更多边界，
   计算不会静默截取前 10 块。分批时，跨批共享水源/设备额度必须由使用者重新分配。
4. 核对规划日期、作物、每块地的田间条件和前茬目录。仅知年份就保留年份精度；
   可用“补充此条”确认当前作物目录，不需要假装知道某一天收获。
   地块更新后须明确采用新版本并重新确认；保存前茬后也会增加地块版本。
5. 填写资料来源、适用地区/时间、质量和确认状态，再关联到各项参数。
   演示时才使用“仅为演示：填入缺少的工程假设”，并阅读及接受工程限制。
   该按钮不把假设改为实测，也不修改已保存地块。
6. 对水源、每类设备逐项勾选覆盖地块，核对净/毛供水口径、通常每天可用量和日期例外。
   补充每期种子与市场容量、可补救资源的成本/条件、原定种法和六项偏好。
   新加地块必须重新核对资源归属，不能假定自动获得已有设备。
7. “检查资料”通过后才可提交。readiness 只证明资料足以尝试计算；候选筛选或硬约束
   仍可能导致失败。失败页面保留原因，未知值不会填成零。
8. 比较基准和实际找到的备选，先看硬约束及资源缺口，再看六项原始指标。
   “模型最优”不代表可以实施；有正缺口的方案必须按诊断方案理解。
   不同权重的综合分数不直接排名，未启用指标显示“未计算”。
9. 保存方案后，下载可取得包含当时地块、来源、参数和天气的完整快照；打印摘要展示主要结果。
   返回地图仍绑定同一方案。修改今天的地块资料不会改写已保存方案。
10. 地图临时 AOI 与经营边界分开。GIBS 日期、科学观测日期、规划日期各自独立。
    实际准备的科学图层可以解释区域观测；空白/QA 拒绝不等于田块水分为零。
    地图搜索/卫星底图还取决于 MapTiler 配置，缺配置时显示备用底图及明确提示。

助手保留会话、折叠、陪伴和语音输入组件。方案数字由确定性计算和服务端证据提供，
助手不修改农场、不预订资源、不通过聊天生成一套未经计算的新结果。
**新知识库已在隔离验收库激活，真实调用已恢复；Nano 及 Mini 候选的开发评测仍有语义遗漏，不能演示成已完成 AI 验收。**

## B. 真实农场需要准备什么

当前只有 Iowa 工程参数包及相应历史天气基准；它不是已选试点，也不是地区推荐。
[外部数据需求表](../NASA-modeling-external-data-requirements.md)与
[数据适用性评估](../field-shift-model-data-assessment.md)是资料清单的依据。

| 责任方 / 资料 | 要交付的内容 | 当前已具备 | 当前真实农场缺口 |
|---|---|---|---|
| 农户 / 农场 GIS | 边界、面积、地块关系、规划期、灌溉事实、已知精度的历史和原定种法 | 地图录入、几何复核、版本、来源与历史精度契约 | 未选择实际农场；工程账号记录不能转作真实历史 |
| 农艺与品种专家 | 品种/科属、播期、GDD 配方及匹配成熟阈值、周转/同科间隔、Kc、根深、耗水比例、适宜性阈值 | 可发布、校验、散列并冻结的地区参数包 | 现有值为工程假设，需当地试验/资料校准 |
| 土壤检测与田间核对 | FC/WP、有效深度、pH、盐度、排水、坡度/坡向/地形、设备通行 | 单位、范围、来源、适用性检查和录入表单 | 无真实检测；SMAP 不能替代 FC/WP 或田内水分 |
| 气象资料负责人 | 同地区完整气象、单位、QA、时区与日界线、变量/日期覆盖和原始来源 | 365 天 NASA POWER 原始驱动与 FAO-56 历史回放；明确 UTC 近似 | 无当地农业日校准；真实包必须使用验证后的本地日资料 |
| 农户 / 供水与设备服务方 | 水源映射、权属/额度、净毛口径、效率、日供水与设备工时、停供/检修例外 | 按农场和实际作业日共享核算、缺口与补救来源 | 无实际配额或设备确认；环境水文不能替代供给事实 |
| 农户 / 种子商 / 买方 | 品种播量、分期确认库存、产量情景、订单/储存/加工容量 | 种子与市场分期约束、来源和补救成本 | 未获得真实库存、合同、价格、成本和产量校准 |
| 农户与专家 | 覆盖定义、裸地上限、轮作/土壤/风险代理分数与权重、目标尺度 | 六项指标、显式禁用可选目标、来源与尺度检查 | 无当地评分确认与敏感性审阅；代理分数不是实测改善 |

接入顺序：先确定地区/作物/时间 → 按表补齐真实资料 → 准备有版本的天气与作物参数包 →
导入农场并填写来源 → readiness → 候选与独立校验 → 比较/敏感性核对 →
由农户与农艺人员确认实际条件。不要以添加更多卫星目录代替这些步骤。

参数包位于 `rotation_optimizer/v3/data/profiles/*.json`，通过 `profiles.py` 统一校验。
`locally_calibrated` 包禁止包含工程假设来源，并要求 `require_local_daily`；当前工程包
使用显式 `utc_daily_proxy_v1`。现阶段 UI 填写的是经营资料；新增地区参数/科学发布
需要通过维护端数据准备流程，尚无面向农户的参数包发布后台。
数据契约、天气变量和接口见 [model-v3-data-contract.md](model-v3-data-contract.md)。

当前水分方案是逐候选独立从萎蔫点开始的保守假设，并对新增根区体积作显式亏缺处理。
它没有实现跨季连续土壤水量传递。真实采用时必须审阅其适用性；若要求实测初始水分或
连续跨季模型，应发布新的水量配方和对应验证，不能只把现有工程包改名为已校准。

## 文件变更与迁移

| 文件组 | 实际作用 |
|---|---|
| `features/fields/{fields-workspace,field-map,fields-shell,field-completion-panel,workspace-sync-panel,fields-evidence-panel}` | 保留 MapLibre/TerraDraw 地图；加入账户同步、资料/规划入口、独立 AOI 和科学事实 |
| `features/fields/{storage,owned-workspace,farm-sync,local-copy,use-owned-workspace,use-fields-context,use-map-focus,science-raster}`、`types/workspace.ts` | 账号隔离、显式迁移、持久重试、冲突保留、共享上下文、镜头与科学栅格 |
| `components/rotation/{use-workspace-navigation,use-science-queries,use-rotation-snapshots,use-workspace-session,assistant-context,workspace}` | 统一导航、所有权/版本、日期和保存快照；规划页不再挂第二套地图 |
| `components/rotation/daily-*`、`use-daily-planning`、`rotation-timeline`、`lib/api/daily*` | v3 有来源草稿、资料检查、经营条件、结果/比较、保存和历史时间轴 |
| `field-form`、`history-editor`、`planner-form`、`results`、`assistant-dock` | 复用现有录入/助手，并按版本分派结果；不删除旧 v1/v2 视图 |
| `field_shift/{models,schemas,service,router,farm_schemas,farm_service}`、`foundation_0017_farms.py` | 农场与分割关系、几何核对、批量逐项结果、幂等收据、版本和所有权 |
| `rotation_optimizer/v3/*`、父级 `service/execution/router/comparison` | 新模型、来源准备、求解、独立验证、冻结任务与版本兼容 |
| `farm_assistant/{context,daily_evidence,facts,model_view,prompts,validation,pipeline,intents,schemas}` | 将已验证事实投影给 bot，约束数字、来源、诊断状态与允许动作 |
| `knowledge` 清单/reader/检索范围、`farm_assistant/evaluation` | 版本化知识与固定新案例；准备完成，不等于实时语义质量通过 |
| `agri_data`、auth 返回路径、`app/field-shift/map/page.tsx` | 图层元数据/所有权、受限的登录返回路径、保留参数的旧地图跳转 |

逐文件增改清单见 [changed-files.json](../../output/evidence/fields-bot-v3/changed-files.json)；测试与证据文件也列入，
不以生成文件数量作为完成度。原有品牌/根首页、旧 v1/v2 模型核心、bot 语音组件、
图形分割算法和大多数外部数据适配器继续复用。

数据库迁移和浏览器非破坏性迁移见 [farm-sync-contract.md](farm-sync-contract.md)。
上线前须在目标环境按正常备份/迁移流程执行 Alembic；本任务没有执行上线。
新知识库只有完整嵌入、激活和语义评测通过后才能用于新模型质量验收。
不得覆盖原始知识发布或旧方案快照，也不要复用工程数据库作为实际农场数据库。

## 数学要求到实现与验证

以下模块均指 `sideronostos-backend/src/sideronostos_backend/modules/rotation_optimizer/v3/`；
验证文件位于 `sideronostos-backend/tests/`。各自结论受上文工程参数边界限制。

| 最新规格要求 | 当前实现 | 可复核验证 |
|---|---|---|
| 适宜性、逐日候选、作物/品种及成熟日 | `profiles.py`、`prepare.py`、`science.py` | `test_rotation_v3_profiles.py`、`test_rotation_v3_prepare.py`、`test_rotation_v3_science.py` |
| 日期闭区间、周转、单一路径、相邻规则和所有候选对同科间隔 | `model.py`、`milp.py`、`verify.py` | `test_rotation_v3_model.py`、`test_rotation_v3_solver.py`；两田枚举与实际 Gurobi 对照 |
| FAO-56、Kc、有效雨、根区/TAW/RAW/净灌溉、初始水量 | `weather.py`、`science.py`、`scientific_verify.py`，复用 `agri_data/recipes.py` | `test_rotation_v3_weather.py`、`test_rotation_v3_science.py`、`test_rotation_v3_scientific_verify.py`；真实 POWER 驱动和破坏轨迹拒绝 |
| 日水源和设备、分期种子/市场、裸地 | `inputs.py`、`preflight.py`、`prepare.py`、`model.py`、`milp.py` | 五类资源缺口、硬限制、日界线/归属与单位测试；双田共享资源实际任务 |
| 六个原始指标、尺度、权重、优先最小缺口 | `contracts.py`、`model.py`、`milp.py`、`solver.py`、`verify.py` | 枚举优先级、null/0 区分、实际零缺口与 30 条供水缺口方案；跨权重比较不排名 |
| 农场/地块/来源/参数/天气冻结，取消/超时与上限 | 父级 `service.py`、`execution.py` 与 v3 `service.py`、`solver.py` | `test_rotation_v3_persistence.py`、`test_rotation_v3_execution.py`；真实重启、保存快照逐字段相等 |
| 有来源 readiness 与不可默补参数 | `readiness.py`、`preflight.py`、`profiles.py`、`service.py` | `test_rotation_v3_readiness.py`、`test_rotation_v3_preflight.py`、API 缺参数/单位/地区/质量阻断 |

仍未实现的连续跨季水量模型已按目标要求显式披露；不能把独立候选的保守初始条件解释成连续模拟。
算法能检查冻结输入，不替代地区校准、经营资源核实或农艺人员判断。

## 当前验收矩阵

下面“已验证”均限定在所列证据范围；整体完成仍取决于所有必需项。

| 目标条款 | 当前状态与直接证据 | 未覆盖的边界 |
|---|---|---|
| §1 分支/文件计划/保护既有工作 | 本地分支；实施计划与 Git 基线；没有远端操作 | 不是发布验收 |
| §2 文档口径 | `model-v3-core.md`、源码 `science/model/milp/verify`；科学与枚举测试 | 地区参数尚无实地校准 |
| §3 农场、地块、几何、迁移 | `test_farm_sync.py`、storage/owned-workspace 回归、迁移往返 JSON；实际多地块与账号证据 | 完整农场分割历史/协作管理按目标允许后置 |
| §3 幂等/部分成功/冲突 | 原响应丢失后精确重试；真实混合批次和显式版本审阅；成功兄弟地块未重复更新 | 浏览器故障注入仅为受控本机实验 |
| §4 共用导航、日期、旧地图迁移 | science-map-parity、map-migration-and-plan-export、生产重启、保存快照测试 | 无 MapTiler 配置时仍用已说明的备用底图 |
| §4 账号/草稿/迟到结果 | A→B→A 隔离；生产 readiness 延迟回包取消；组件晚回包回归 | 真实延迟选区回包在切地后被取消；见 `selection-race-and-immutable-context.json` |
| §4 旧结果/助手输入能力 | 旧 v1/v2 真实记录的当前 production UI 只读回放、API/任务回归；语音控件及浏览器能力检测 | 回放不证明 API 所有权；由独立 DB 回归覆盖。未采集用户麦克风，不声明转写准确率 |
| §5 科学预处理与约束 | v3 science/prepare/independent verify；两田枚举 oracle；实际 Gurobi/Temporal 与天气 | 全局连续播期空间未穷举；采样范围和上限明确保留 |
| §5 六指标/分层/诊断/超时 | 原始指标、全部五类资源缺口测试、禁止软化硬限制、真实小 deadline/无许可测试 | 实际农场可实施性不能由 solver 最优性证明 |
| §6 科学数据与 readiness | 实际 POWER 与 SMAP 发布、QA/pixel 对应、缺参数/来源/地域阻断、null 与 0 回归 | 缺失卫星产品没有被伪造为已准备 |
| §6 bot 证据、来源、版本与拒绝写入 | deterministic/真实 DB 回归；v5 冻结上下文与七项 owner/version gates | 已有真实 v17/v18 开发报告；召回改善，但来源蕴含/完整性验收未通过 |
| §7 桌面/移动端完整工程流程 | 单田和双田 compare/save/reopen、诊断补救、打印/导出、生产重启截图 | 真实 AI 问答质量仍待通过；页面测试账号登录被自动审批拒绝，已请求明确授权 |
| §7 零缺口、诊断、硬失败 | 实际运行样本与独立测试；缺方案时明确说明，不凑数 | 基准不代表选定试点 |
| §8 使用/数据/迁移/变更说明 | 本文及模型/同步/助手契约、固定证据目录 | 文件级交接已整理；实时 AI 开发报告已归档；整体通过结论仍待完整语义、回归及页面验收 |

AI 下一步严格依照 [evaluation/README.md](../../sideronostos-backend/src/sideronostos_backend/modules/farm_assistant/evaluation/README.md)：
provider 与发布完整性已恢复 → 解决开发集语义问题 → 已暴露回归 →
语义审阅 → 受保护案例。当前 13 个开发案例已有输出，13 个保留案例尚未运行；旧评测分数/期望保持不变。
本轮过程与成本见 `ai-development-recovery-checkpoint.json`；Mini 仅为进程内评测候选，生产模型配置仍为 Nano。
不能通过放宽期望、生成假向量或跳过受保护案例来宣称达标。
