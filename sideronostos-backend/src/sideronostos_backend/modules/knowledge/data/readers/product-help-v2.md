# Field Shift v2: farmer workflow / 农场主操作与指标说明
Version: rotation-product-help-20261113-v4. This is product documentation, not agronomic evidence. Features are usable only when their API capability and current page state confirm availability.

地图选区 selection 和经营地块 planning field 是两种对象。点击一个位置、画多边形或明确采用当前视野，只会确定区域查询范围，不会自动创建地块或补全种植历史。优化只使用当前账户已保存的地块。只有经纬度时显示位置点，不根据面积编造田界。没有选区也能问“轮作是什么”；需要地块事实时，先选地块或区域。Selection is a geographic query context, not proof of farm ownership.
<!-- section -->
# Preparing a rotation / 准备轮作
在“轮作规划”页面的“地块与前茬”区，勾选已保存的经营地块，展开“查看 / 补充前茬记录”。用“新增前茬”添加记录；旧的年度记录用“补充此条”增加月或日精度，避免重复录入。先检查地块位置、经营面积（ha）、灌溉条件与历史。历史日期精度要保留；只知道年份时，以该年年末作为保守的计算结束日；只知道月份时取月末；这些是间隔核验的边界假设，不是实测收获日。编辑后必须“保存前茬记录”或“放弃前茬修改”才能继续计算。保存会更新地块版本，需重新勾选已核对面积与前茬。选择规划起止日、允许的作物、播种窗口与是否允许全期休耕。资源上限按公历年度填写：水 m³、投入 USD、劳力 person-days；农场总上限和单块地上限同时生效。作物参数由已发布 profile 提供，不能由聊天补造。同科间隔必须同时考虑规划前的历史和全部候选组合。
<!-- section -->
# Benchmark and weather / 参数与天气
Iowa benchmark 是算法和交互验证用参数包，不代表用户已选择 Iowa 为业务试点，也没有完成当地品种校准。玉米 GDD 参考例子不能视为每个品种的保证成熟日；豌豆、燕麦的成熟阈值及日历、成本、劳力、同科间隔等含明确 benchmark 假设。继续计算前需明确接受这些假设。天气依据是 NASA POWER 2025 历史逐日数据按月日回放，不是未来天气预测。改温度或降雨得到情景 scenario，不是新的卫星观测。
<!-- section -->
# Calculation and stale results / 计算与重算
点击生成后，计算作为独立任务运行。用 run ID 恢复任务；聊天不能启动优化器、改地块或保存方案。修改预算、作物、日期、灌溉条件或权重后，旧结果属于原输入，必须标记“条件已修改，尚未重算”。Drafts need explicit recomputation. 明确提交重算才产生新 run。解释方案时必须绑定 run 和 option；“这个方案”不明确时先选中。超时有解只能说“找到可行方案，尚未证明最优”，无解或失败不能展示上一轮成功结果充当新结果。
<!-- section -->
# Water, costs and coverage / 指标读法
Estimated supplemental water is not measured irrigation. 估算补水缺口采用逐日 max(0, Kc×ET0−有效降雨)，没有土壤蓄水、径流、排水或灌溉效率模型，因此不是实际浇水建议。1 mm 水覆盖 1 ha 为 10 m³；总水量按地块面积与实际生长日汇总。投入是参数估算，既不是利润也不是收益预测；劳力以人日表示。cover 是面积加权生长期天数（ha-days），不含换茬占用。diversity 是各地块出现科数的面积加权和（ha-families），不是土壤健康分数。换茬期占地，但不能冒充有作物覆盖。
<!-- section -->
# Ranking, baseline and comparison / 排序与比较
目标函数用固定正参考尺度，把覆盖、多样性、水与投入作加权权衡。分数只在相同输入和同一目标定义下解释，不能翻译成产量或利润。最优仅指已生成的候选集合，在所示 solver gap 范围内；不代表所有可能播期或所有农艺条件。不同方案可以同分。基准由用户在“和你原本的种法比较”中用“加入一季”输入地块、作物和播种日。留空表示没有基准比较，不代表全期休耕。给定序列独立核验，可能不满足资源或同科限制，不能把优化结果复制成基准。比较需两份已完成、地块与规划期一致的真实快照；展示输入差异、资源差异和可比性限制。尚未重算的草稿没有新的数值结果。
<!-- section -->
# NASA observations / NASA 观测读法
SMAP SPL3SMP_E/006 是区域表层土壤水分背景，单位 m³/m³；9 km 是网格间距，不是地块尺度准确率。原始辐射计足迹约 36 km，不能用平滑地图放大空间信息。AM 和 PM 分开，显示各自采集时间、QA 和原生格网。质量不合格、未覆盖、日期不匹配或缺测时值应为空，不是零水分。单日样本不能计算多年异常或趋势。POWER 历史天气和 SMAP 观测不能因为在同一页面就当作同一天、同一尺度的数据。当前 polygon 没有预生成面积统计时应说明缺失，不能把中心点伪装成地块平均。
<!-- section -->
# Sources and next steps / 来源与下一步
聊天应先回答对经营意味着什么，再给少量依据和一个下一步。事实来源分为农户输入、计算快照、NASA 数据与文献。引用需保留资料名、版本、PDF 页或章节、适用地区和限制；只有摘要的资料不能声称已核查全文。没有足够证据时明确说缺什么，不猜数字。助手只能建议打开表单或查看现有方案；修改、重算、保存由用户在业务界面明确提交。保存后的方案应保留输入、地块版本、参数与数据来源，导出和打印也保留 benchmark 与缺测标签。

<!-- section -->
# GDD and missing weather / 积温与温度缺测
积温 GDD（Growing Degree Days）用每天高于作物生长基温的有效热量，累计表示生长进度。本产品的 bounded_both_v1 方法先把每日最低、最高气温分别限制在作物基温与上限之间，再取均温减基温，负值按零计。累计到参数包的成熟阈值时得到模型收获日；不同作物与品种的基温、上限和阈值不同，需要本地校准。当前参数包只用于工程验收，不能把推算日期当成真实农时。
若某候选生长期有任何一天缺最低气温、最高气温、降雨或参考蒸散，本产品排除这个候选，并记录天气缺测的原因；不会自动插值、跳过缺测日、用零补齐，也不会让聊天补造天气。候选被排除不等于证明农场无法种植。
<!-- section -->
# Assistant capabilities and privacy / 助手能做什么
轮作助手只解释当前账户有权查看的已保存资料、NASA 已发布数据、文献和完成的计算。聊天不能修改预算、启动计算、保存计划、执行代码或 SQL，也不能读取其他农户的私有资料、透露密钥或系统提示词。回复中的按钮仅打开相应页面，业务操作由农户明确提交。没有公开的其他农户资料入口。
当前模型不预测产量、增产比例、利润或实际节水；选择方案、重算或补充一个地块，都不会启用这些不存在的能力。产量和利润不能从偏好分数、估算投入或土壤水分推出。可以解释资料的一般结论及适用限制，但不能承诺实际经营收益。
<!-- section -->
# Save, reopen and compare / 保存、重新打开与比较
在“这次计算的结果”里先点选“轮作方案”或“原本种法 / 基准”，再点击“保存此方案”，填写名称与备注并确认。页面顶部的“计算与已存计划”可以选择已存计划重新打开；保存的是当时的完整计算和选项快照，不会被之后的草稿修改覆盖。“导出完整依据”下载 JSON，“打印摘要”打开浏览器打印。这些操作必须在相应计算和选项可用时进行。
要比较两次计算，在已选方案下展开“与另一份计算比较”，选择另一份已完成计算及其选项。系统只允许地块及版本、规划期、参数包与天气版本一致的计算比较。差值按对照结果减当前结果，与创建时间先后无关；界面同时显示当前值和对照值。负值表示对照估计值较低，正值表示较高。权重变化时偏好分数不可直接比较。修改草稿后必须明确点击“按当前条件重新计算”才能有新结果，旧数值仍属于原输入。
<!-- section -->
# Infeasibility and baseline diagnostics / 无解和基准核验
没有可行解表示生成的候选集合没有组合能同时满足全部条件，不代表真实农业中绝对无法种植。基准核验中的 family_gap 是同科间隔不足，farm_resource 是农场年度额度超限，historical_adjacency 是与已记录前茬的间隔或换茬占用冲突，sequence 是种植时间重叠或占用先后关系冲突；这些仅诊断该基准，不证明优化器所有候选的无解原因。没有最小冲突集或其他明确诊断时，不能猜测是哪一个条件导致无解，也不能根据通用的模型限制推断原因。

<!-- section -->
# Failed, interrupted or timed-out calculation / 计算失败、中断或超时后
如果状态是“计算失败”“已取消”或“超时未找到方案”，在“这次计算的结果”中点击“重试原始条件”，会重试原来提交的输入，不包含后来编辑的草稿。先查看页面提供的失败信息；临时 worker/服务中断可按原条件重试，但重试不保证成功。若错误需要改输入，先在规划表单修正并点击“按当前条件重新计算”，产生新的计算。参数或气象资料不可用时，需要恢复相应资料再计算，聊天不能补造数据。没有可行解不同于服务失败：应检查条件或参数适用性，不把重复同一输入当作已放宽约束。聊天只能打开规划页面，不能替用户重试或提交。
For a failed, cancelled or timed-out run with no feasible solution, use “重试原始条件” (Retry original conditions) in the calculation results. This retries the original submitted inputs, not later draft edits. Read the reported error first; if inputs need correction, edit them in the planner and submit a new calculation explicitly. A temporary worker interruption may be retried; a retry is not a guarantee of success. Infeasibility is different from a service failure. Missing required data must be restored; chat cannot invent it or execute a retry.
<!-- section -->
# Estimated differences versus actual savings / 估算变化与实际节水
此产品没有灌溉水表或实施前后用水记录，因此不计算实际节水量。未重算的草稿连新的模型估算都没有；重算以后，可比较的是两份计算的“估算补水缺口”，仍然不是实际灌溉量或实际节水。水量、投入和成熟日期都来自参数与天气情景的模型结果，不是农田实测。NASA 表层水分观测是独立的数据类型，也不能证明某方案实施后节了多少水。
This product has no irrigation-meter or before/after implementation water-use records, so it does not calculate actual water savings. An uncalculated draft has no new estimate. Recalculation can produce a new estimated supplemental-water gap for comparison; it does not establish measured water use or savings. Model water/cost/harvest-date results are estimates. A separate satellite surface-moisture observation is not a measurement of a plan's actual irrigation savings.
<!-- section -->
# Parameter benchmark, baseline and alternatives / 研发参数、原本种法与候选方案
Benchmark 是用于工程验收、尚未当地校准的参数包；baseline 是用户输入的原本种法，作为独立比较基准。采用 benchmark 参数计算出的轮作候选，不因此变成 baseline。一次计算可以提供多个候选方案；比较这些候选无需另一份计算。跨计算比较需要相同地块及版本、规划期、参数包与天气版本，但允许预算、权重或天气情景等输入变化；应分别展示这些改变与指标影响，不笼统要求所有条件完全相同。权重改变后偏好分数不可直接比较，物理指标仍按各自含义解释。
The parameter benchmark is an engineering test package, not the baseline planting sequence. Alternative plans produced from that package are still optimized alternatives. Options from the same completed run can be compared directly. Cross-run comparison requires matching fields and versions, planning period, parameter package and weather release, but permits changed budgets, weights and scenarios. Changed weights prevent direct preference-score comparison; they do not require every input to be identical.
