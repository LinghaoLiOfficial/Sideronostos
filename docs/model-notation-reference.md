# 轮作优化模型符号表

| 符号 | 含义 |
|---|---|
| $f \in \mathcal{F}$ | 田块集合；每块田有边界、面积、地形和农户标识。 |
| $c \in \mathcal{C}$ | 作物/功能类型集合，例如粮食作物、豆科、饲草或覆盖作物。 |
| $k \in \mathcal{K}_f$ | 对田块 $f$ 生成的候选种植周期集合。 |
| $t \in \mathcal{T}$ | 离散时间桶，首版通常为周。 |
| $s(k),\,e(k)$ | 候选周期 $k$ 的播种日与预计收获/终止日。 |
| $\mathcal{S}$ | 天气和价格情景集合；可先采用历史年份或典型干旱/常年/湿润情景。 |

## 候选种植周期

候选周期 $k$ 至少包含：

$$
k = \bigl(c(k),\,s(k),\,e(k),\,v(k),\,q(k)\bigr),
$$

其中：

- $c(k)$ 为作物；
- $s(k)$ 和 $e(k)$ 为播种与收获/终止日期；
- $v(k)$ 为品种或品种参数版本；
- $q(k)$ 为管理目的，例如籽粒、青贮、饲草或覆盖作物终止。

周期的占用时长为：

$$
d_k = e(k)-s(k).
$$

占用时长允许随作物、品种、日期和环境情景变化。

## 周期选择变量

对候选周期 $k$ 定义二元变量：

$$
x_{fk} =
\begin{cases}
1, & \text{田块 } f \text{ 选择候选周期 } k,\\
0, & \text{否则。}
\end{cases}
$$

若使用情景决策，可增加 $x_{fks}$，但需区分播种前可用信息与播种后才观测到的信息，避免未来信息泄漏。

另外定义：

- $u_{ft}\in\{0,1\}$：田块 $f$ 在时间桶 $t$ 是否被某个作物周期占用；
- $z_{fkk'}\in\{0,1\}$：周期 $k'$ 是否紧接在周期 $k$ 之后；
- $w_{ft}\ge 0$：田块或区域在时间桶 $t$ 的灌溉或水资源使用量；
- $q_{fks}\ge 0$：候选周期在情景 $s$ 下的产量或收益变量，仅在线性化需要时使用。

## 同一田块不能同时占用

占用指示参数定义为：

$$
a_{fkt}
=
\begin{cases}
1, & s(k)\le t\le e(k)+r(k),\\
0, & \text{否则。}
\end{cases}
$$

其中，$r(k)$ 表示候选周期 $k$ 收获或终止后的换茬、整地或缓冲时间。因此，占用区间不仅包括作物生长期，也包括下一次种植前不能安排其他周期的管理时间。

令 $a_{fkt}=1$，当且仅当候选周期 $k$ 在时间桶 $t$ 对田块 $f$ 有占用。则：

$$
u_{ft}
=
\sum_{k\in\mathcal{K}_f} a_{fkt}x_{fk},
\qquad
u_{ft}\le 1,
\qquad
\forall f\in\mathcal{F},\;t\in\mathcal{T}.
$$

合并后可直接写为：

$$
\sum_{k\in\mathcal{K}_f}a_{fkt}x_{fk}\le1,
\qquad
\forall f\in\mathcal{F},\;t\in\mathcal{T}.
$$

#### 2. 同科作物间隔约束

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

## 基于积温计算成熟日期

如果成熟期由积温决定，通常先求候选周期的预计收获日期 $e(k)$，再计算周期长度 $d_k$：

$$
d_k=e(k)-s(k).
$$

对候选播种日期 $s(k)$，逐日累加作物 $c$ 的有效积温。当累计积温第一次达到成熟阈值 $G_c$ 时，该日期被作为预计收获日：

$$
e(k)
=
\min\left\{
h\ge s(k):
\sum_{d=s(k)}^{h}GDD_{c,d}\ge G_c
\right\}.
$$

其中 $G_c$ 是作物 $c$ 的成熟积温阈值，$GDD_{c,d}$ 是作物 $c$ 在日期 $d$ 的有效积温。

### 每日有效积温

设日最高气温为 $T^{\max}_d$，日最低气温为 $T^{\min}_d$，作物最低生长温度为 $T^{base}_c$，作物高温截断温度为 $T^{upper}_c$。先对日温度进行上下限截断：

$$
\widehat{T}^{\max}_{c,d}
=
\min\left(T^{\max}_d,T^{upper}_c\right),
\qquad
\widehat{T}^{\min}_{c,d}
=
\max\left(T^{\min}_d,T^{base}_c\right).
$$

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

因此，每日有效积温定义为：

$$
GDD_{c,d}
=
\max\left(
0,\,
\widehat{T}^{mean}_{c,d}-T^{base}_c
\right).
$$

在较简单的实现中，也可以直接使用：

$$
GDD_{c,d}
=
\max\left(
0,\,
\min\left(T^{mean}_d,T^{upper}_c\right)-T^{base}_c
\right).
$$

### 计算示例

假设某作物的参数为：

$$
T^{base}_c=10^\circ\mathrm{C},
\qquad
T^{upper}_c=30^\circ\mathrm{C},
\qquad
G_c=1000^\circ\mathrm{C}\cdot\mathrm{day}.
$$

若某日平均气温为 $18^\circ\mathrm{C}$，则：

$$
GDD_{c,d}=18-10=8^\circ\mathrm{C}\cdot\mathrm{day}.
$$

从播种日开始累计：

$$
CGDD_c(s(k),h)
=
\sum_{d=s(k)}^{h}GDD_{c,d}.
$$

当累计值第一次满足：

$$
CGDD_c(s(k),h)\ge1000,
$$

该日 $h$ 就是预计收获日期 $e(k)$。

### 与 MILP 的关系

积温计算通常在 MILP 之前完成。对每个候选作物、田块、播种日期和天气情景，先计算：

$$
\left(
s(k),\,
e(k),\,
d_k,\,
a_{fkt}
\right).
$$

随后，MILP 使用这些预先计算的参数选择候选周期 $k$。这样可以避免在 MILP 内直接处理“累计温度达到阈值”这一非线性或逻辑条件。

如果存在多个天气情景 $s\in\mathcal{S}$，可以得到情景相关的收获日期：

$$
e(k,s)
=
\min\left\{
h\ge s(k):
\sum_{d=s(k)}^{h}GDD_{c,d,s}\ge G_c
\right\}.
$$

播种前只能使用当时可获得的气象信息，不能使用事后才知道的真实温度序列，否则会产生未来信息泄漏。

## 水资源约束

### 1. 水资源使用变量

令 $w_{ft}\ge 0$ 表示田块 $f$ 在时间桶 $t$ 的灌溉用水量，单位可以是 $\mathrm{m^3}$、$\mathrm{mm}$ 或单位面积水深。必须在整个模型中统一单位。

若使用单位面积水深，田块实际用水量可写为：

$$
W_{ft}=A_f\,w_{ft},
$$

其中 $A_f$ 是田块面积。

### 2. 候选周期的需水量

对候选周期 $k$，令 $q_{fkt}$ 表示其在时间桶 $t$ 的单位面积净灌溉需求。若候选周期未被选择，则不产生用水；因此总灌溉需求为：

$$
\sum_{k\in\mathcal{K}_f}q_{fkt}x_{fk}.
$$

如果允许模型决定实际灌溉量，可以使用约束：

$$
w_{ft}
\ge
\sum_{k\in\mathcal{K}_f}q_{fkt}x_{fk},
\qquad
\forall f\in\mathcal{F},\;t\in\mathcal{T}.
$$

如果 $q_{fkt}$ 已经是候选周期的固定灌溉方案，也可以直接把它写入资源约束，不单独定义 $w_{ft}$。

### 3. 区域或灌溉系统容量约束

设 $W^{\max}_{rt}$ 是区域、灌溉渠或水库 $r$ 在时间桶 $t$ 的可用水量，$F_r$ 是属于资源系统 $r$ 的田块集合，则：

$$
\sum_{f\in F_r}A_f w_{ft}
\le
W^{\max}_{rt},
\qquad
\forall r,\;t.
$$

如果 $w_{ft}$ 已经采用田块实际用水量而不是单位面积水深，则不需要乘以 $A_f$：

$$
\sum_{f\in F_r}w_{ft}
\le
W^{\max}_{rt}.
$$

### 4. 水量平衡

候选周期的净灌溉需求可以由作物蒸散、降雨和土壤水分共同估计：

$$
q_{fkt}
=
\max\left(
0,\,
ET_{fkt}
-P_{ft}
-\Delta SM_{ft}
-I^{natural}_{ft}
\right),
$$

其中：

- $ET_{fkt}$：候选周期的作物蒸散需求；
- $P_{ft}$：有效降雨；
- $\Delta SM_{ft}$：可利用土壤水分变化；
- $I^{natural}_{ft}$：其他自然或已有补水；
- $q_{fkt}$：仍需要由灌溉补充的水量。

因为 $\max(\cdot)$ 不是线性表达，首版通常在候选周期生成阶段预先计算 $q_{fkt}$，再把它作为 MILP 常数参数。若必须在 MILP 内计算，可引入非负变量 $q_{fkt}$ 和辅助变量，并使用线性化约束。

### 5. 土壤水分库存形式

如果需要显式追踪根区水分，可以定义 $M_{ft}$ 为时间桶末的可利用土壤水分：

$$
M_{f,t+1}
=
M_{ft}
+P^{eff}_{ft}
+w_{ft}
-ET_{fkt}
-R_{ft},
$$

其中 $P^{eff}_{ft}$ 是有效降雨，$R_{ft}$ 是径流、深层渗漏或其他损失。

土壤水分必须满足上下限：

$$
M_f^{\min}
\le
M_{ft}
\le
M_f^{\max},
\qquad
\forall f,t.
$$

为避免没有作物时仍错误扣除蒸散，可将候选周期蒸散写成：

$$
ET_{ft}
=
\sum_{k\in\mathcal{K}_f}ET_{fkt}x_{fk}.
$$

这样水量平衡保持线性。

### 6. 情景水资源约束

若天气和供水存在情景 $s\in\mathcal{S}$，可令 $q_{fkts}$ 和 $W^{\max}_{rts}$ 表示情景相关的需水量和可用水量。若要求每个情景都可行，则：

$$
\sum_{f\in F_r}A_f w_{fts}
\le
W^{\max}_{rts},
\qquad
\forall r,t,s.
$$

候选周期的选择可以保持情景无关：

$$
x_{fk}\in\{0,1\},
$$

而灌溉量 $w_{fts}$ 随情景调整。这表示播种决策在情景发生前作出，天气发生后再调整灌溉。

### 7. 水资源软约束

如果硬水量上限可能导致模型无解，可以加入非负违约变量 $\xi_{rts}\ge0$：

$$
\sum_{f\in F_r}A_f w_{fts}
\le
W^{\max}_{rts}+\xi_{rts}.
$$

在目标函数中对违约量施加惩罚：

$$
\max\;
Z
-\rho_w\sum_{r,t,s}\xi_{rts},
\qquad
\rho_w>0.
$$

$\xi_{rts}$ 不表示水资源真的增加，而表示方案需要额外取水、削减灌溉或接受缺水风险。输出中必须显示该违约量。

### 8. 与 NASA 数据的关系

候选周期的水量参数可以综合以下数据：

- GPM：降雨量和连续无雨日；
- SMAP SPL4SMGP：表层与根区土壤水分；
- ECOSTRESS L3T JET：实际蒸散发；
- NASA POWER：参考蒸散 $ET0$、温度、湿度、风和辐射；
- HLS 和 MODIS：植被生长状态与胁迫校验。

这些数据用于估计 $q_{fkt}$、$M_{ft}$ 和风险参数，不能直接替代田间灌溉计量。区域尺度 SMAP、GPM 和 POWER 还应保留原生空间尺度和不确定度。
