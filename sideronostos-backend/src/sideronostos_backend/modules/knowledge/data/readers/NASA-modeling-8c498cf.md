# 轮作策略优化 MILP 数学模型

## 第一部分：模型基础

### 索引集合定义

| 符号 | 含义 |
|---|---|
| $t \in \mathcal{T}$ | 以日为单位的离散时间 |
| $f \in \mathcal{F}$ | 田块集合 |
| $c \in \mathcal{C}$ | 作物类型集合 |
| $k \in \mathcal{K}_f$ | 对田块 $f$ 生成的候选种植方案集合 |
| $\ell \in \mathcal{L}$ | 农机设备类型集合 |
| $p \in \mathcal{P}$ | 种子采购和农产品销售的离散期间集合 |
| $r \in \mathcal{R}$ | 农场水源、灌溉分区或供水系统集合 |

### 候选方案定义

候选种植方案 $k$ 是田块 $f$ 的一个具体种植选项，由作物类型、播种日期和收获或终止日构成，供 MILP 模型选择。
具体定义：

$$
k = \bigl(c(k),\,s(k),\,e(k)\bigr) .
$$

其中：

- $c(k)$ 为 $k$ 的作物类型；
- $s(k)$ 为 $k$ 的播种日期；
- $e(k)$ 为 $k$ 的收获/终止日期；

### 播种窗口和田块适宜性筛选

积温能够估计作物在给定播种日期下是否可以达到成熟，但不能单独保证该作物适合在田块 $f$ 种植。对每个候选方案定义以下二元参数：

$$
\sigma^{\mathrm{sow}}_{fk},
\qquad
\sigma^{\mathrm{soil}}_{fk},
\qquad
\sigma^{\mathrm{terrain}}_{fk},
\qquad
\sigma^{\mathrm{climate}}_{fk}
\in\{0,1\}.
$$

其中：

- $\sigma^{\mathrm{sow}}_{fk}=1$ 表示 $s(k)$ 位于当地农艺播种窗口内；
- $\sigma^{\mathrm{soil}}_{fk}=1$ 表示田块的土壤质地、有效土层深度、pH、排水和盐分条件满足作物要求；
- $\sigma^{\mathrm{terrain}}_{fk}=1$ 表示坡度、坡向、低洼积水和机械通行条件满足要求；
- $\sigma^{\mathrm{climate}}_{fk}=1$ 表示候选生长期内的霜冻、极端高温、降雨和光周期风险没有超过农户或农艺专家设定的硬阈值。

综合适宜性参数为：

$$
\chi_{fk}
=
\sigma^{\mathrm{sow}}_{fk}
\sigma^{\mathrm{soil}}_{fk}
\sigma^{\mathrm{terrain}}_{fk}
\sigma^{\mathrm{climate}}_{fk}.
$$

上述乘积只用于求解前计算参数 $\chi_{fk}$，不会作为 Gurobi 中的非线性表达式。候选方案必须满足：

$$
x_{fk}\le\chi_{fk},
\qquad
\forall f\in\mathcal F,\;k\in\mathcal K_f.
$$

播种窗口和作物需求由当地作物日历、农户和农艺专家提供；土壤属性来自本地土壤检测或可信土壤数据库；坡度和地形风险可由 SRTM 或 NASADEM 辅助估计；温度、降雨和霜冻风险可由 NASA POWER、GPM 等历史数据辅助估计。NASA 数据只提供环境证据，不能替代当地农艺适宜性确认。

筛选后必须保证每块田至少保留一个由农户确认的基准候选方案：

$$
\sum_{k\in\mathcal K_f}\chi_{fk}\ge1,
\qquad
\forall f\in\mathcal F.
$$

若该条件不成立，应在建立 MILP 前报告输入冲突并修正候选方案，不将必然无解的模型提交给 Gurobi。

### 有向候选方案对定义

定义 $\mathcal{A}_f$ 为田块 $f$ 上时间可衔接的有向候选方案对集合：

$$
\mathcal{A}_f=
\left\{
(k,k')\in\mathcal{K}_f\times\mathcal{K}_f:
s(k')\ge e(k)+r(k)+1
\right\}.
$$

其中：

- $k$ 为相对前个候选方案；
- $k'$ 为相对后个候选方案；

## 第二部分：参数估计

### 作物成熟期估计

积温可以推断成熟期，是因为作物的发育速度通常与温度有关：在适宜温度范围内，温度较高时，作物从出苗、开花到籽粒成熟等阶段往往推进得更快；温度较低时则较慢。积温把每天的有效热量累加起来，用一个累计量近似表示作物已经完成了多少发育进程。

若成熟期由积温决定，先求候选种植方案的预计收获/终止日期 $e(k)$，再计算成熟期 $d_k$：

$$
d_k = e(k) - s(k) + 1 .
$$

对播种日期 $s(k)$，逐日累加作物 $c$ 的有效积温。当累计积温第一次达到成熟阈值 $G_c$ 时，该日期被作为预计收获日期：

$$
e(k)
=
\min\left\{
h\ge s(k):
\sum_{d=s(k)}^{h}GDD_{c,d}\ge G_c
\right\}.
$$

其中：

- $G_c$ 是作物 $c$ 的成熟积温阈值；
- $GDD_{c,d}$ 是作物 $c$ 在日期 $d$ 的有效积温；

#### 日温度上下限截断

设日最高气温为 $T^{\max}_d$，日最低气温为 $T^{\min}_d$，作物最低生长温度为 $T^{base}_c$，作物有效温度上限为 $T^{upper}_c$（℃）。先对日温度进行上下限截断：

$$
\widehat{T}^{\max}_{c,d}
=
\min\left(T^{\max}_d,T^{upper}_c\right),
\qquad
\widehat{T}^{\min}_{c,d}
=
\max\left(T^{\min}_d,T^{base}_c\right).
$$

#### 日平均温度

截断后的日平均温度为：

$$
\widehat{T}^{mean}_{c,d}
=
\frac{
\widehat{T}^{\max}_{c,d}
+
\widehat{T}^{\min}_{c,d}
}{2}.
$$

每日有效积温为：

$$
GDD_{c,d}
=
\max\left(
0,\,
\widehat{T}^{mean}_{c,d}-T^{base}_c
\right).
$$

### 田块净灌溉需水量估计

田块净灌溉需水量表示：在利用有效降雨和根区已有土壤水分后，为使作物缺水程度不超过允许范围，需要实际补充到作物根区的水深。

田块 $f$ 采用候选种植方案 $k$ 时在 $t$ 的单位面积净灌溉需水量（$\mathrm{mm/day}$）为：

$$
q_{fkt}
=
\begin{cases}
NIR_{fkt}, & s(k)\le t\le e(k),\\
0, & t<s(k)\ \text{或}\ t>e(k).
\end{cases}
$$

#### 参考蒸散量

参考蒸散量 $ET0_{ft}$ 表示第 $t$ 日的气象条件下产生的基础蒸散需求，采用 FAO-56 Penman--Monteith 公式计算：

$$
ET0_{ft}
=
\frac{
0.408\Delta_t(R_{n,ft}-G_{ft})
+
\gamma
\dfrac{900}{T_{ft}+273}
u_{2,ft}(e_{s,ft}-e_{a,ft})
}{
\Delta_t+\gamma(1+0.34u_{2,ft})
}.
$$

其中：

- $\Delta_t$ 为饱和水汽压曲线斜率；
- $R_{n,ft}$ 为地表净辐射；
- $G_{ft}$ 为土壤热通量；
- $\gamma$ 为湿度计常数；
- $T_{ft}$ 为日平均气温；
- $u_{2,ft}$ 为 $2\,\mathrm{m}$ 高度处的风速；
- $e_{s,ft}-e_{a,ft}$ 为饱和水汽压差；

#### 作物蒸散量

参考蒸散量描述的是标准参考作物。候选方案 $k$ 作物的实际需水特征通过作物系数 $K_{c(k),t}$ 表示：

$$
ET_{c,fkt}
=
K_{c(k),t}ET0_{ft}.
$$

其中，$ET_{c,fkt}$ 是作物蒸散需求（$\mathrm{mm/day}$）。作物系数应随作物的生育阶段变化：

$$
K_{c(k),t}
=
\begin{cases}
K_{c(k)}^{ini}, & t\in D_k^{ini},\\
K_{c(k)}^{dev}(t), & t\in D_k^{dev},\\
K_{c(k)}^{mid}, & t\in D_k^{mid},\\
K_{c(k)}^{late}(t), & t\in D_k^{late}.
\end{cases}
$$

其中，日期集合依次表示初始期、生长发育期、生育中期和成熟后期。

#### 有效降雨量

总降雨并不都会留在作物根区。设 $t$ 时间的田块 $f$ 的总降雨量为 $P_{ft}$，则有效降雨量可估计为：

$$
P^{eff}_{ft}
=
\eta^P_{ft}P_{ft},
\qquad
0\le \eta^P_{ft}\le 1.
$$

其中，$\eta^P_{ft}$ 是有效降雨比例。

#### 根区可利用水量和允许缺水量

根区总有效水量 $TAW_{fkt}$ 表示从田间持水量下降到永久萎蔫点的过程中，作物根系理论上能够利用的水量：

$$
TAW_{fkt}
=
1000
\left(
\theta_f^{FC}-\theta_f^{WP}
\right)
Z_{r,kt}.
$$

其中：

- $\theta_f^{FC}$ 为田块 $f$ 的田间持水量；
- $\theta_f^{WP}$ 为田块 $f$ 的永久萎蔫点；
- $Z_{r,kt}$ 为候选方案 $k$ 所种作物在第 $t$ 日的根系深度（$\mathrm{m}$）；
- 系数 $1000$ 用于将水深从 $\mathrm{m}$ 换算为 $\mathrm{mm}$。

不能等到全部有效水量耗尽后再灌溉，因此定义允许消耗水量：

$$
RAW_{fkt}
=
p_{c(k),t}TAW_{fkt},
$$

其中，$p_{c(k),t}$ 是作物在第 $t$ 日可以承受的土壤水分消耗比例。当根区累计缺水量超过 $RAW_{fkt}$ 时，作物可能出现超过允许程度的水分胁迫。

#### 逐日更新根区缺水量

设 $D_{fkt}$ 为第 $t$ 日完成必要灌溉后，根区相对于田间持水量的缺水量。首先计算灌溉前的根区缺水量：

$$
\widetilde D_{fkt}
=
\max
\left\{
0,\,
D_{fk,t-1}
+ET_{c,fkt}
-P^{eff}_{ft}
\right\},
$$

其中，初始值 $D_{fk,s(k)-1}$ 由播种前的土壤含水量估计。

为了使灌溉后的根区缺水量不超过允许消耗水量 $RAW_{fkt}$，第 $t$ 日所需的最小净灌溉水深为：

$$
NIR_{fkt}
=
\max
\left\{
0,\,
\widetilde D_{fkt}-RAW_{fkt}
\right\}.
$$

随后更新当日灌溉后的根区缺水量：

$$
D_{fkt}
=
\widetilde D_{fkt}-q_{fkt}.
$$

## 第三部分：决策变量与目标函数

### 决策变量定义

#### 候选方案选择变量

对候选种植方案 $k$ 定义抉择二元变量 $x_{fk}$：

$$
x_{fk} =
\begin{cases}
1, & \text{田块 } f \text{ 选择候选种植方案 } k,\\
0, & \text{否则.}
\end{cases}
$$

#### 占用状态变量

对每个 $(k,k')\in\mathcal{A}_f$，定义相邻关系二元变量 $y_{fkk'}$：

$$
y_{fkk'}=
\begin{cases}
1, & \text{在田块 }f\text{ 的所选序列中, }k'\text{ 紧接在 }k\text{ 之后},\\
0, & \text{否则.}
\end{cases}
$$

为表示每块田轮作序列的起点和终点，另外定义虚拟起点变量和虚拟终点变量：

$$
y_{f0k},\,y_{fkT}\in\{0,1\}.
$$

其中：

- $y_{f0k}=1$ 表示候选种植方案 $k$ 是田块 $f$ 的首个方案；
- $y_{fkT}=1$ 表示候选种植方案 $k$ 是田块 $f$ 的末个方案。

#### 灌溉用水变量

令 $w_{ft}\ge 0$ 表示田块 $f$ 在时间 $t$ 的灌溉用水量，表征单位面积水深（$\mathrm{mm}$）。

田块实际用水量为：

$$
W_{ft}=A_f\,w_{ft} .
$$

其中：

- $A_f$ 为 $f$ 的田块面积；

#### 经营资源缺口变量

为避免设备、种子或市场容量不足时直接导致整个 MILP 无解，引入以下非负连续变量：

$$
u^{\mathrm{machine}}_{\ell t}\ge0,
\qquad
u^{\mathrm{seed}}_{cp}\ge0,
\qquad
u^{\mathrm{market}}_{cp}\ge0,
\qquad
u^{\mathrm{water}}_{rt}\ge0,
\qquad
u^{\mathrm{bare}}_f\ge0.
$$

其中：

- $u^{\mathrm{machine}}_{\ell t}$ 表示第 $t$ 日超出自有设备 $\ell$ 作业能力、需要通过租赁、外包或加班补足的设备工时；
- $u^{\mathrm{seed}}_{cp}$ 表示期间 $p$ 内作物 $c$ 超出已确认种子库存、需要追加采购的种子数量；
- $u^{\mathrm{market}}_{cp}$ 表示期间 $p$ 内作物 $c$ 超出常规市场消纳能力的预计产量，需要通过新增订单、折价销售、储存或其他渠道处理；
- $u^{\mathrm{water}}_{rt}$ 表示第 $t$ 日超出水源或灌溉系统 $r$ 常规可供水量的额外取水或缺水量；
- $u^{\mathrm{bare}}_f$ 表示田块 $f$ 超出允许裸地天数的部分。

这些变量不是可以忽略的误差。只要其取值大于零，输出方案就必须同时显示缺口数值、补救方式和对应数据来源，供农户确认后才能实施。

### 目标函数定义

轮作策略同时考虑经济收益、灌溉用水、轮作组合效益、土壤健康贡献、气候风险和裸地时间。由于各目标的单位和数量级不同，先分别定义子目标，再进行归一化加权。

#### 最大化净经济收益

定义：

- $Y_{fk}$：田块 $f$ 采用候选种植方案 $k$ 时的单位面积预期产量；
- $v_{c(k)}$：作物 $c(k)$ 的单位产品价格；
- $C_{fk}$：候选种植方案 $k$ 的单位面积种植成本；
- $\pi_{fk}$：候选种植方案 $k$ 的单位面积预期净收益。

单位面积预期净收益为：

$$
\pi_{fk}
=
v_{c(k)}Y_{fk}-C_{fk}.
$$

总净经济收益为：

$$
Z^{\mathrm{profit}}
=
\sum_{f\in\mathcal F}
\sum_{k\in\mathcal K_f}
A_f\pi_{fk}x_{fk}.
$$

对应的经济目标为：

$$
\max Z^{\mathrm{profit}}.
$$

为避免重复计算，如果灌溉成本需要单独计入，则 $C_{fk}$ 中不应再包含同一部分灌溉用水成本。

#### 最小化灌溉用水量

根据前述定义，$w_{ft}$ 是田块 $f$ 在第 $t$ 日的单位面积灌溉水深，$A_fw_{ft}$ 是该田块当日的灌溉用水量。因此，规划期内的总灌溉用水量为：

$$
Z^{\mathrm{water}}
=
\sum_{f\in\mathcal F}
\sum_{t\in\mathcal T}
A_fw_{ft}.
$$

对应的节水目标为：

$$
\min Z^{\mathrm{water}}.
$$

该目标会惩罚不必要的灌溉量。结合田块灌溉用水约束，求得的 $w_{ft}$ 会趋向于满足所选种植方案净灌溉需求的最小可行值。

#### 最大化轮作组合效益

仅禁止同种或同科作物过早复种，只能保证轮作方案满足最低要求。为了进一步优先选择具有良好农艺互补性的前后茬组合，定义：

$$
\rho_{fkk'}
$$

为田块 $f$ 上候选种植方案 $k$ 与后续方案 $k'$ 的轮作组合效益评分。该评分可综合反映：

- 病虫害寄主周期阻断效果；
- 前茬对后茬的特定促进或抑制效应；
- 前后茬衔接的农艺适宜性；
- 只有在相邻顺序确定后才能识别的组合效应。

固氮、有机质、根系和侵蚀贡献在后续土壤健康指标中单独计算，不再重复计入 $\rho_{fkk'}$。

轮作组合总效益为：

$$
Z^{\mathrm{rotation}}
=
\sum_{f\in\mathcal F}
\sum_{(k,k')\in\mathcal A_f}
\rho_{fkk'}y_{fkk'}.
$$

对应的轮作目标为：

$$
\max Z^{\mathrm{rotation}}.
$$

$\rho_{fkk'}$ 是预先给定的参数，不是决策变量。若暂时缺少可靠的轮作组合评分，可令 $\lambda_{\mathrm{rotation}}=0$，但仍分别保留能够可靠估计的收益、用水、土壤健康、气候风险和裸地指标。

#### 土壤健康贡献指标

为避免把不同农业作用全部压缩在轮作组合评分 $\rho_{fkk'}$ 中，分别为候选方案定义以下经过统一尺度处理的指标参数：

- $h^{\mathrm{N}}_{fk}$：固氮或氮素循环贡献；
- $h^{\mathrm{OM}}_{fk}$：作物残体和有机质投入贡献；
- $h^{\mathrm{root}}_{fk}$：深根或根系多样性贡献；
- $h^{\mathrm{erosion}}_{fk}$：降低土壤侵蚀的贡献。

定义非负权重 $\alpha_{\mathrm N}$、$\alpha_{\mathrm{OM}}$、$\alpha_{\mathrm{root}}$ 和 $\alpha_{\mathrm{erosion}}$，且满足：

$$
\alpha_{\mathrm N}
+\alpha_{\mathrm{OM}}
+\alpha_{\mathrm{root}}
+\alpha_{\mathrm{erosion}}
=1.
$$

候选方案的土壤健康贡献评分为：

$$
h^{\mathrm{soil}}_{fk}
=
\alpha_{\mathrm N}h^{\mathrm N}_{fk}
+
\alpha_{\mathrm{OM}}h^{\mathrm{OM}}_{fk}
+
\alpha_{\mathrm{root}}h^{\mathrm{root}}_{fk}
+
\alpha_{\mathrm{erosion}}h^{\mathrm{erosion}}_{fk}.
$$

整个轮作方案的土壤健康贡献指标为：

$$
Z^{\mathrm{soil}}
=
\sum_{f\in\mathcal F}
\sum_{k\in\mathcal K_f}
A_fh^{\mathrm{soil}}_{fk}x_{fk}.
$$

该指标用于比较方案的潜在贡献，不应解释为土壤有机质、土壤碳或产量一定增加。参数应优先来自本地田间记录、农艺资料和专家规则，HLS/MODIS 植被覆盖、SRTM/NASADEM 坡度等 NASA 数据仅作为覆盖和侵蚀背景证据。

#### 气候韧性与风险指标

对候选方案定义以下非负风险参数：

- $r^{\mathrm{drought}}_{fk}$：干旱和根区水分不足风险；
- $r^{\mathrm{heat}}_{fk}$：高温和热浪风险；
- $r^{\mathrm{frost}}_{fk}$：霜冻风险；
- $r^{\mathrm{excess}}_{fk}$：极端降雨、积水或侵蚀风险。

定义非负权重 $\beta_{\mathrm{drought}}$、$\beta_{\mathrm{heat}}$、$\beta_{\mathrm{frost}}$ 和 $\beta_{\mathrm{excess}}$，且满足：

$$
\beta_{\mathrm{drought}}
+\beta_{\mathrm{heat}}
+\beta_{\mathrm{frost}}
+\beta_{\mathrm{excess}}
=1.
$$

候选方案的综合气候风险为：

$$
r^{\mathrm{climate}}_{fk}
=
\beta_{\mathrm{drought}}r^{\mathrm{drought}}_{fk}
+
\beta_{\mathrm{heat}}r^{\mathrm{heat}}_{fk}
+
\beta_{\mathrm{frost}}r^{\mathrm{frost}}_{fk}
+
\beta_{\mathrm{excess}}r^{\mathrm{excess}}_{fk}.
$$

整个轮作方案的气候风险指标为：

$$
Z^{\mathrm{risk}}
=
\sum_{f\in\mathcal F}
\sum_{k\in\mathcal K_f}
A_fr^{\mathrm{climate}}_{fk}x_{fk}.
$$

该指标越小表示历史气候条件下的暴露风险越低。干旱风险可参考 SMAP 和 GPM，热害与霜冻风险可参考 NASA POWER，极端降雨风险可参考 GPM，地形积水和侵蚀背景可参考 SRTM 或 NASADEM。所有阈值仍需由当地作物品种参数和农艺专家确认。

#### 裸地时间指标

定义覆盖参数 $b_{fkt}$：

$$
b_{fkt}
=
\begin{cases}
1, & \text{候选方案 }k\text{ 在第 }t\text{ 日为田块 }f\text{ 提供有效地表覆盖},\\
0, & \text{否则}.
\end{cases}
$$

覆盖参数必须满足：

$$
b_{fkt}\le a_{fkt},
\qquad
\forall f\in\mathcal F,\;k\in\mathcal K_f,\;t\in\mathcal T.
$$

$b_{fkt}$ 只表示作物冠层、残茬或覆盖作物产生的实际覆盖，不应直接等同于包含换茬期的占用参数 $a_{fkt}$。由于同一田块同一日期最多选择一个候选方案，第 $t$ 日田块 $f$ 是否裸地可表示为：

$$
1-
\sum_{k\in\mathcal K_f}
b_{fkt}x_{fk}.
$$

规划期总裸地面积天数为：

$$
Z^{\mathrm{bare}}
=
\sum_{f\in\mathcal F}
\sum_{t\in\mathcal T}
A_f
\left(
1-
\sum_{k\in\mathcal K_f}
b_{fkt}x_{fk}
\right).
$$

$Z^{\mathrm{bare}}$ 越小表示田块暴露时间越短。该指标不会禁止合理的换茬期，而是使不同轮作方案的裸地暴露程度可以被单独比较。

#### 目标归一化

各子目标的单位和数量级不同，不能直接相加。因此，为六个目标分别定义正常数尺度：

$$
S^{\mathrm{profit}}>0,
\qquad
S^{\mathrm{water}}>0,
\qquad
S^{\mathrm{rotation}}>0,
\qquad
S^{\mathrm{soil}}>0,
\qquad
S^{\mathrm{risk}}>0,
\qquad
S^{\mathrm{bare}}>0,
$$

这些常数分别作为各指标的尺度常数。归一化后的子目标为：

$$
\widehat Z^{\mathrm{profit}}
=
\frac{Z^{\mathrm{profit}}}{S^{\mathrm{profit}}},
$$

$$
\widehat Z^{\mathrm{water}}
=
\frac{Z^{\mathrm{water}}}{S^{\mathrm{water}}},
$$

$$
\widehat Z^{\mathrm{rotation}}
=
\frac{Z^{\mathrm{rotation}}}{S^{\mathrm{rotation}}}.
$$

$$
\widehat Z^{\mathrm{soil}}
=
\frac{Z^{\mathrm{soil}}}{S^{\mathrm{soil}}},
\qquad
\widehat Z^{\mathrm{risk}}
=
\frac{Z^{\mathrm{risk}}}{S^{\mathrm{risk}}}.
$$

$$
\widehat Z^{\mathrm{bare}}
=
\frac{Z^{\mathrm{bare}}}{S^{\mathrm{bare}}}.
$$

尺度常数可以采用各子目标单独优化得到的最优值、历史规划值或管理者设定的参考上界。灌溉用水尺度也可以根据预计算的每日需水参数设置为：

$$
S^{\mathrm{water}}
=
\sum_{f\in\mathcal F}
\sum_{t\in\mathcal T}
A_f
\max_{k\in\mathcal K_f}
q_{fkt}.
$$

现有约束只规定了 $w_{ft}$ 的需求下界，没有人为设置无实际意义的用水上界。因此，不通过“最大化 $w_{ft}$”计算归一化范围，以免产生无界问题。若某个子目标在所有可行方案中恒为零或暂不采用，则应从综合目标中删除，而不是令对应尺度常数为零。

#### 多目标加权目标函数

定义经济收益、灌溉用水、轮作组合、土壤健康、气候风险和裸地时间的目标权重。为保证 $w_{ft}$ 始终受到节水目标的惩罚，取 $\lambda_{\mathrm{water}}>0$，其余权重非负，并满足：

$$
\lambda_{\mathrm{profit}}\ge0,
\qquad
\lambda_{\mathrm{water}}>0,
\qquad
\lambda_{\mathrm{rotation}}\ge0,
\qquad
\lambda_{\mathrm{soil}}\ge0,
\qquad
\lambda_{\mathrm{risk}}\ge0,
\qquad
\lambda_{\mathrm{bare}}\ge0,
$$

$$
\lambda_{\mathrm{profit}}
+
\lambda_{\mathrm{water}}
+
\lambda_{\mathrm{rotation}}
+
\lambda_{\mathrm{soil}}
+
\lambda_{\mathrm{risk}}
+
\lambda_{\mathrm{bare}}
=1.
$$

最终的多目标优化函数为：

$$
\max Z
=
\lambda_{\mathrm{profit}}
\widehat Z^{\mathrm{profit}}
-
\lambda_{\mathrm{water}}
\widehat Z^{\mathrm{water}}
+
\lambda_{\mathrm{rotation}}
\widehat Z^{\mathrm{rotation}}
+
\lambda_{\mathrm{soil}}
\widehat Z^{\mathrm{soil}}
-
\lambda_{\mathrm{risk}}
\widehat Z^{\mathrm{risk}}
-
\lambda_{\mathrm{bare}}
\widehat Z^{\mathrm{bare}}.
$$

其中，经济收益、轮作组合效益和土壤健康贡献需要最大化，灌溉用水、气候风险和裸地时间需要最小化，因此后三类成本指标在最大化目标中使用负号。各权重反映农户对收益、节水、轮作、土壤健康、风险和覆盖的相对偏好。

为了分析不同目标之间的权衡关系，使用多组权重重复求解，并比较得到的 Pareto 非支配方案。

#### 经营资源缺口优先级目标

定义以下严格为正的单位缺口代价：

- $\kappa^{\mathrm{machine}}_{\ell t}$：补充一单位设备工时的租赁、外包或加班代价；
- $\kappa^{\mathrm{seed}}_{cp}$：追加采购一单位种子的代价；
- $\kappa^{\mathrm{market}}_{cp}$：处理一单位超额产量的折价、储存或渠道拓展代价；
- $\kappa^{\mathrm{water}}_{rt}$：补充一单位额外供水或承担缺水的代价；
- $\kappa^{\mathrm{bare}}_f$：田块每超过一天允许裸地时间的风险代价。

经营资源总缺口代价为：

$$
Z^{\mathrm{gap}}
=
\sum_{\ell\in\mathcal L}
\sum_{t\in\mathcal T}
\kappa^{\mathrm{machine}}_{\ell t}
u^{\mathrm{machine}}_{\ell t}
+
\sum_{c\in\mathcal C}
\sum_{p\in\mathcal P}
\kappa^{\mathrm{seed}}_{cp}
u^{\mathrm{seed}}_{cp}
+
\sum_{c\in\mathcal C}
\sum_{p\in\mathcal P}
\kappa^{\mathrm{market}}_{cp}
u^{\mathrm{market}}_{cp}
+
\sum_{r\in\mathcal R}
\sum_{t\in\mathcal T}
\kappa^{\mathrm{water}}_{rt}
u^{\mathrm{water}}_{rt}
+
\sum_{f\in\mathcal F}
\kappa^{\mathrm{bare}}_f
u^{\mathrm{bare}}_f.
$$

为避免模型为了提高收益而主动制造资源缺口，采用分层多目标：

1. 第一优先级：

$$
\min Z^{\mathrm{gap}};
$$

2. 第二优先级：在保持第一优先级最优值的条件下，优化前述收益、节水、轮作、土壤健康、气候风险和裸地时间综合目标：

$$
\max Z.
$$

如果存在不需要额外设备、追加种子、超额市场消纳、额外供水或超限裸地的方案，第一优先级会使所有缺口变量等于零，此时软容量约束与硬容量约束具有相同效果。如果不存在零缺口方案，模型仍可返回缺口最小的诊断方案，而不是直接无解；该方案只有在农户和当地专家确认所报告的租赁、采购、销售、供水和覆盖补救措施可行后，才能作为可实施建议。

## 第四部分：约束条件

### 约束条件定义

#### 1. 田块时空占用约束

$a_{fkt}$ 表示候选种植方案 $k$ 是否在时间 $t$ 占用田块 $f$，具体定义为：

$$
a_{fkt} =
\begin{cases}
1, & s(k)\le t\le e(k)+r(k),
\\0, & \text{否则.}
\end{cases}
$$

同一田块同一时间最多被一个方案占用：

$$
\sum_{k\in\mathcal{K}_f}a_{fkt}x_{fk}\le1,
\qquad
\forall f\in\mathcal{F},\;t\in\mathcal{T}.
$$

其中：

- $r(k)$ 为 $k$ 的换茬时间；

#### 2. 相邻作物流平衡约束

为表示序列的起点和终点，引入虚拟起点 $0$ 与虚拟终点 $T$。

本模型不允许任何田块在整个规划期内完全休耕，因此候选方案生成阶段必须保证：

$$
\mathcal K_f\ne\varnothing,
\qquad
\forall f\in\mathcal F.
$$

每块田至少选择一个候选种植方案：

$$
\sum_{k\in\mathcal K_f}x_{fk}\ge1,
\qquad
\forall f\in\mathcal F.
$$

每块田的所选方案必须形成一条而不是多条彼此独立的轮作序列，因此每块田恰有一个首方案和一个末方案：

$$
\sum_{k\in\mathcal K_f}y_{f0k}=1,
\qquad
\forall f\in\mathcal F,
$$

$$
\sum_{k\in\mathcal K_f}y_{fkT}=1,
\qquad
\forall f\in\mathcal F.
$$

每个被选方案恰有一个前驱：

$$
y_{f0k}
+
\sum_{i:(i,k)\in\mathcal{A}_f}y_{fik}
=x_{fk},
\qquad \forall f\in\mathcal{F},\;k\in\mathcal{K}_f.
$$

每个被选方案恰有一个后继：

$$
y_{fkT}
+
\sum_{j:(k,j)\in\mathcal{A}_f}y_{fkj}
=x_{fk},
\qquad \forall f\in\mathcal{F},\;k\in\mathcal{K}_f.
$$

#### 3. 同科作物时间间隔约束

连续两个种植方案不能是同一种作物：

$$
y_{fkk'}=0,
\qquad
\forall f\in\mathcal{F},\;(k,k')\in\mathcal{A}_f
\text{ 且 }c(k)=c(k').
$$

定义：

- $g(c)$ 为作物 $c$ 所属的科；
- $L_g$ 为科 $g$ 的最小轮作间隔天数。

对于同一田块 $f$ 上的两个候选种植方案 $k,k'\in\mathcal K_f$，
若 $k$ 在 $k'$ 之前，且二者属于同一科，则要求：

$$
s(k') \ge e(k)+r(k)+L_{g(c(k))}+1.
$$

预先定义违反同科间隔要求的候选方案对集合：

$$
\mathcal E_f^{\mathrm{family}}
=
\left\{
(k,k')\in\mathcal K_f\times\mathcal K_f:
\begin{array}{l}
g(c(k))=g(c(k')),\\
e(k)<s(k'),\\
s(k')<e(k)+r(k)+L_{g(c(k))}+1
\end{array}
\right\}.
$$

对于每一对冲突方案，加入互斥约束：

$$
x_{fk}+x_{fk'}\le1,
\qquad
\forall f\in\mathcal F,\;
(k,k')\in\mathcal E_f^{\mathrm{family}}.
$$

#### 4. 田块灌溉用水约束

实际灌溉量至少要满足被选方案的净灌溉需求，同时不能过量灌溉：

$$
w_{ft}
\ge
\sum_{k\in\mathcal{K}_f} q_{fkt}x_{fk}.
$$

并在目标函数中惩罚 $w_{ft}$。

#### 5. 农场总供水能力约束

定义：

- $\mathcal F_r\subseteq\mathcal F$：由水源或灌溉系统 $r$ 供水的田块集合；
- $W^{\max}_{rt}$：水源或灌溉系统 $r$ 在第 $t$ 日能够提供的净灌溉水量，单位为 $\mathrm{m^3}$。

当 $A_f$ 的单位为 $\mathrm{ha}$、$w_{ft}$ 的单位为 $\mathrm{mm}$ 时，农场总供水能力约束为：

$$
\sum_{f\in\mathcal F_r}
10A_fw_{ft}
\le
W^{\max}_{rt}
+u^{\mathrm{water}}_{rt},
\qquad
\forall r\in\mathcal R,\;t\in\mathcal T.
$$

系数 $10$ 来自换算关系 $1\,\mathrm{mm}\times1\,\mathrm{ha}=10\,\mathrm{m^3}$。$W^{\max}_{rt}$ 必须与 $w_{ft}$ 采用相同的净水量口径；若提供的是渠首取水量，应先考虑输水和田间灌溉效率后再换算。$u^{\mathrm{water}}_{rt}>0$ 表示需要额外取水、调水或接受缺水风险，必须在输出中明确报告。

#### 6. 设备作业能力约束

定义：

- $m_{fk\ell t}$：田块 $f$ 采用候选方案 $k$ 时，在第 $t$ 日对设备 $\ell$ 的单位面积作业工时需求；
- $H^{\max}_{\ell t}$：农户在第 $t$ 日可使用的设备 $\ell$ 总工时，包括自有设备和已经确认的常规服务能力。

设备作业能力约束为：

$$
\sum_{f\in\mathcal F}
\sum_{k\in\mathcal K_f}
A_fm_{fk\ell t}x_{fk}
\le
H^{\max}_{\ell t}
+u^{\mathrm{machine}}_{\ell t},
\qquad
\forall \ell\in\mathcal L,\;t\in\mathcal T.
$$

$m_{fk\ell t}$ 只在播种、田间作业或收获等实际需要该设备的日期取正值，其余日期取零。$H^{\max}_{\ell t}$ 和可租赁、可外包的补救方式由农户或当地农机服务方提供。

#### 7. 种子供应约束

定义：

- $b^{\mathrm{seed}}_{fk}$：田块 $f$ 采用候选方案 $k$ 时的单位面积种子需求量；
- $S^{\max}_{cp}$：供应商确认的作物 $c$ 在采购或播种期间 $p$ 可正常供应的种子数量。

种子供应约束为：

$$
\sum_{f\in\mathcal F}
\sum_{\substack{k\in\mathcal K_f:\\
c(k)=c,\;s(k)\in p}}
A_fb^{\mathrm{seed}}_{fk}x_{fk}
\le
S^{\max}_{cp}
+u^{\mathrm{seed}}_{cp},
\qquad
\forall c\in\mathcal C,\;p\in\mathcal P.
$$

其中，$u^{\mathrm{seed}}_{cp}>0$ 表示需要在正常供应量之外追加采购，而不是凭空增加种子库存。追加采购量和供应商确认结果必须在模型输出中列出。

#### 8. 市场消纳能力约束

定义：

- $Y_{fk}$：田块 $f$ 采用候选方案 $k$ 时的单位面积预计产量；
- $D^{\max}_{cp}$：当地市场、合同订单及农户自用渠道在销售期间 $p$ 对作物 $c$ 的常规最大消纳量。

市场消纳能力约束为：

$$
\sum_{f\in\mathcal F}
\sum_{\substack{k\in\mathcal K_f:\\
c(k)=c,\;e(k)\in p}}
A_fY_{fk}x_{fk}
\le
D^{\max}_{cp}
+u^{\mathrm{market}}_{cp},
\qquad
\forall c\in\mathcal C,\;p\in\mathcal P.
$$

其中，$u^{\mathrm{market}}_{cp}>0$ 表示预计产量超过常规销售或自用能力，需要新增订单、折价销售、储存、加工或其他渠道处理。由于市场容量存在不确定性，该缺口必须作为风险提示展示，不能被解释为已经落实的销售渠道。

#### 9. 裸地时间与覆盖约束

设 $B_f^{\max}$ 为规划期内田块 $f$ 允许的最大裸地天数。该参数应由农户和农艺专家根据换茬需要、侵蚀风险和覆盖作物管理要求确定。裸地时间约束为：

$$
\sum_{t\in\mathcal T}
\left(
1-
\sum_{k\in\mathcal K_f}
b_{fkt}x_{fk}
\right)
\le
B_f^{\max}+u^{\mathrm{bare}}_f,
\qquad
\forall f\in\mathcal F.
$$

该约束允许必要的播种、收获和换茬空档，但限制规划期内累计裸地暴露。$u^{\mathrm{bare}}_f>0$ 表示裸地天数超过农户设定上限，必须在结果中作为侵蚀和土壤退化风险提示。若缺少可靠的 $B_f^{\max}$，首版可只最小化 $Z^{\mathrm{bare}}$ 并暂不启用该上限约束。

#### 10. 候选方案可行性保护

农户明确禁止的作物、物理上无法使用且不能租赁或外包的设备，以及供应商确认完全无法获得的品种，应在生成 $\mathcal K_f$ 时直接排除，不使用缺口变量掩盖绝对不可行性。

过滤完成后必须检查：

$$
\mathcal K_f\ne\varnothing,
\qquad
\forall f\in\mathcal F.
$$

每块田应至少保留一个由农户确认的现有轮作或基准候选方案。若某块田过滤后没有候选方案，系统应在建立 Gurobi 模型之前报告具体输入冲突并要求修正，而不是提交一个必然无解的 MILP。设备工时、常规种子供应、市场容量、供水能力或允许裸地时间等可以通过租赁、追加采购、新增销售渠道、调水或覆盖管理补救的问题，才使用上述缺口变量表示。

## 第五部分：求解方法

### MILP 模型求解

当前模型可以使用 Gurobi 求解。积温累计、成熟日期搜索、净灌溉需水量计算、经营资源参数整理和目标尺度计算均在 MILP 求解前完成；Gurobi 只接收预计算参数、线性目标函数和线性约束。

#### 1. 求解前参数预处理

求解前依次完成：

1. 根据积温计算不同作物和播种日期对应的预计收获日期 $e(k)$；
2. 为每块田生成候选方案集合 $\mathcal K_f$；
3. 根据播种窗口、土壤、地形和历史气候风险计算 $\chi_{fk}$，过滤绝对不适宜方案；
4. 计算占用参数 $a_{fkt}$、覆盖参数 $b_{fkt}$ 和逐日净灌溉需水参数 $q_{fkt}$；
5. 生成可衔接方案对集合 $\mathcal A_f$ 和同科间隔冲突集合 $\mathcal E_f^{\mathrm{family}}$；
6. 根据供水方和灌溉记录整理 $\mathcal F_r$ 与 $W^{\max}_{rt}$；
7. 根据农户和农机服务方数据计算 $m_{fk\ell t}$ 与 $H^{\max}_{\ell t}$；
8. 根据播种量和供应商数据计算 $b^{\mathrm{seed}}_{fk}$ 与 $S^{\max}_{cp}$；
9. 根据预计产量和当地市场数据计算 $Y_{fk}$ 与 $D^{\max}_{cp}$；
10. 计算 $h^{\mathrm{soil}}_{fk}$、$r^{\mathrm{climate}}_{fk}$ 和允许裸地天数 $B_f^{\max}$；
11. 检查每个 $\mathcal K_f$ 非空且包含农户确认的基准方案；
12. 计算 $\pi_{fk}$、$\rho_{fkk'}$、缺口单位代价 $\kappa$ 和目标尺度常数 $S^j$。

完成预处理后，上述适宜性、资源、覆盖、土壤健康、气候风险、收益和目标尺度数据对 Gurobi 而言均为已知常数。

#### 2. Gurobi 模型构建

在 Gurobi 中创建：

- 二元变量 $x_{fk}$；
- 二元变量 $y_{fkk'}$、$y_{f0k}$ 和 $y_{fkT}$；
- 非负连续变量 $w_{ft}$；
- 非负连续缺口变量 $u^{\mathrm{machine}}_{\ell t}$、$u^{\mathrm{seed}}_{cp}$、$u^{\mathrm{market}}_{cp}$、$u^{\mathrm{water}}_{rt}$ 和 $u^{\mathrm{bare}}_f$。

随后添加候选适宜性、田块时空占用、非完全休耕、单一轮作序列、同科间隔、田块灌溉用水、农场总供水、设备能力、种子供应、市场消纳和裸地时间约束。

#### 3. 分层多目标求解

使用 Gurobi 分层多目标功能：

1. 第一优先级最小化 $Z^{\mathrm{gap}}$；
2. 第二优先级在不恶化第一优先级最优值的条件下最大化归一化综合目标 $Z$。

若 Gurobi 模型统一设置为最大化方向，则第一优先级在实现中写为最大化 $-Z^{\mathrm{gap}}$，第二优先级仍为最大化 $Z$。

针对多组收益、节水、轮作、土壤健康、气候风险和裸地时间权重重复第二层求解，可得到不同的 Pareto 权衡方案。每个输出方案必须同时报告全部缺口变量及六项原始指标；只有缺口为零或补救措施已经获得农户、供应商和当地专家确认的方案，才能标记为可实施。

#### 4. Gurobi 使用的主要方法

Gurobi 可自动使用：

- LP 松弛；
- 分支定界；
- 分支切割；
- 割平面；
- 可行解启发式搜索；
- 最优性间隙控制。

模型规模主要取决于候选方案数量和候选方案对数量。候选衔接关系在最坏情况下可达到 $O(|\mathcal K_f|^2)$，因此应在预处理阶段删除明显不可行、被支配或农艺上无意义的候选方案与衔接关系。


