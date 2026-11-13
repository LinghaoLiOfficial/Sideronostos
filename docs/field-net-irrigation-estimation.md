# 第二部分：参数估计

## 田块净灌溉需水量估计

田块净灌溉需水量表示为在考虑作物蒸散、有效降雨及根区土壤可供水量后，为避免不可接受的水分胁迫，需要实际补充到作物根区的水量。

对田块 $f$、候选种植方案 $k$、日期 $d$ 和天气情景 $\omega$，日净灌溉需水量为：

$$
NIR_{f,k,d,\omega}
\quad
\left(\mathrm{mm/day}\right).
$$

候选方案的累计净灌溉需水量为：

$$
NIR_{f,k,\omega}
=
\sum_{d=s(k)}^{e(k)}
NIR_{f,k,d,\omega}.
$$

### 1. 参考蒸散量

参考蒸散量 $ET0_{f,d,\omega}$ 描述标准参考作物在给定气象条件下的大气蒸发需求。使用 FAO-56 Penman--Monteith 公式计算：

$$
ET0_{f,d,\omega}
=
\frac{
0.408\Delta_d(R_{n,d}-G_d)
+
\gamma
\dfrac{900}{T_d+273}
u_{2,d}(e_{s,d}-e_{a,d})
}{
\Delta_d+\gamma(1+0.34u_{2,d})
}.
$$

其中：

- $\Delta_d$：饱和水汽压曲线斜率；
- $R_{n,d}$：地表净辐射；
- $G_d$：土壤热通量；
- $\gamma$：湿度计常数；
- $T_d$：$2\,\mathrm{m}$ 高度日平均气温；
- $u_{2,d}$：$2\,\mathrm{m}$ 高度风速；
- $e_{s,d}-e_{a,d}$：饱和水汽压差。

### 2. 作物蒸散量

作物蒸散需求由参考蒸散量与作物系数估计：

$$
ET_{c,f,k,d,\omega}
=
K_{c,k,d}\,
ET0_{f,d,\omega}.
$$

其中 $K_{c,k,d}$ 应随作物生育阶段变化：

$$
K_{c,k,d}
=
\begin{cases}
K_c^{ini}, & d\in D_k^{ini},\\
K_c^{dev}(d), & d\in D_k^{dev},\\
K_c^{mid}, & d\in D_k^{mid},\\
K_c^{late}(d), & d\in D_k^{late}.
\end{cases}
$$

### 3. 有效降雨量

并非所有降雨都能进入根区并被作物利用。设总降雨为 $P_{f,d,\omega}$，有效降雨为：

$$
P^{eff}_{f,d,\omega}
=
\eta^P_{f,d,\omega}P_{f,d,\omega},
\qquad
0\le\eta^P_{f,d,\omega}\le1.
$$

更详细地，可写为：

$$
P^{eff}_{f,d,\omega}
=
P_{f,d,\omega}
-RO_{f,d,\omega}
-DP^P_{f,d,\omega},
$$

其中 $RO$ 是地表径流，$DP^P$ 是降雨引起的深层渗漏。

### 4. 根区土壤水量平衡

设 $S_{f,k,d,\omega}$ 为日期 $d$ 结束时根区可利用土壤水储量，则：

$$
S_{f,k,d,\omega}
=
S_{f,k,d-1,\omega}
+
P^{eff}_{f,d,\omega}
+
I^{net}_{f,k,d,\omega}
+
CR_{f,d,\omega}
-
ET_{a,f,k,d,\omega}
-
L^{other}_{f,d,\omega}.
$$

其中 $I^{net}$ 是进入根区的净灌溉量，$CR$ 是毛管上升补给，$ET_a$ 是实际蒸散，$L^{other}$ 是未包含在有效降雨定义中的其他根区损失。由于 $P^{eff}$ 已扣除了降雨径流和降雨引起的深层渗漏，水量平衡中不能再次扣除同一部分。

根区总有效水量为：

$$
TAW_{f,k,d}
=
1000
\left(
\theta_f^{FC}-\theta_f^{WP}
\right)
Z_{r,k,d},
$$

其中 $\theta_f^{FC}$ 是田间持水量，$\theta_f^{WP}$ 是永久萎蔫点，$Z_{r,k,d}$ 是根系深度，单位为 $\mathrm{m}$。

允许消耗水量为：

$$
RAW_{f,k,d}
=
p_{c,k,d}TAW_{f,k,d},
$$

其中 $p_{c,k,d}$ 是作物允许消耗比例。

### 5. 日净灌溉需水量

设 $A^{soil}_{f,k,d,\omega}$ 为日初、尚未计入当日降雨前，根区可无胁迫提供的土壤水，$CR_{f,d,\omega}$ 为其他地下补给，则：

$$
NIR_{f,k,d,\omega}
=
\max
\left\{
0,\,
ET_{c,f,k,d,\omega}
-
P^{eff}_{f,d,\omega}
-
A^{soil}_{f,k,d,\omega}
-
CR_{f,d,\omega}
\right\}.
$$

若忽略毛管上升，可简化为：

$$
NIR_{f,k,d,\omega}
=
\max
\left\{
0,\,
ET_{c,f,k,d,\omega}
-
P^{eff}_{f,d,\omega}
-
A^{soil}_{f,k,d,\omega}
\right\}.
$$

$A^{soil}$ 必须通过逐日根区水量平衡更新，不能每天重复使用相同的初始土壤水量。

### 6. 按 MILP 时间桶聚合

若 MILP 以周为时间桶 $t$，则：

$$
q_{f,k,t,\omega}
=
\sum_{d\in D_t\cap[s(k),e(k)]}
NIR_{f,k,d,\omega},
$$

其中 $D_t$ 是时间桶 $t$ 包含的日期集合。

候选周期总净灌溉需水量为：

$$
Q^{net}_{f,k,\omega}
=
\sum_{t\in\mathcal T}q_{f,k,t,\omega}
=
\sum_{d=s(k)}^{e(k)}
NIR_{f,k,d,\omega}.
$$

因此，$q_{f,k,t,\omega}$ 是候选周期生成阶段预先计算的参数，而不是决策变量。

### 7. 净灌溉量、毛灌溉量与取水量

若田间灌溉效率为 $\eta_f^{irr}$，则田间入口毛灌溉需求为：

$$
GIR_{f,k,t,\omega}
=
\frac{q_{f,k,t,\omega}}{\eta_f^{irr}},
\qquad
0<\eta_f^{irr}\le1.
$$

若还需考虑输水效率 $\eta_r^{conv}$，则渠首或水源取水需求为：

$$
DIV_{f,k,t,\omega}
=
\frac{
q_{f,k,t,\omega}
}{
\eta_f^{irr}\eta_r^{conv}
}.
$$

三者含义不同：

- $NIR$：进入根区的净灌溉需水量；
- $GIR$：田间入口所需的毛灌溉水量；
- $DIV$：水源或渠首需要提供的取水量。

### 8. 水深与体积换算

当水深单位为 $\mathrm{mm}$、田块面积单位为 $\mathrm{ha}$ 时：

$$
1\ \mathrm{mm}\times1\ \mathrm{ha}
=
10\ \mathrm{m^3}.
$$

因此：

$$
V^{net}_{f,k,t,\omega}
=
10A_fq_{f,k,t,\omega},
$$

其中 $A_f$ 的单位为 $\mathrm{ha}$，$V^{net}$ 的单位为 $\mathrm{m^3}$。

