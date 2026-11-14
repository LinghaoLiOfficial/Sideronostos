# Farmer dialogue evaluation: six bots

Date: 2026-11-14. Branch: `feat/agent-bot-catalog-integration`.

## Scope and verdict

The frozen suite contains 36 natural farmer questions: two general questions per bot, three specialist questions per bot, and one evidence-path question per bot. All were sent sequentially through the local HTTP assistant handlers with a synthetic verified farmer and dedicated PostgreSQL test database. The model and product-help release were mock; this is a first-turn suitability evaluation, not a production-model or completed-operation evaluation.

Baseline before the backend changes: all 30 original questions returned an off-topic excerpt or the same generic missing-context reply. A first concurrent attempt hit the per-owner two-in-flight limit (24 HTTP 429 responses); the runner was corrected to send one farmer turn at a time.

Final: 36/36 replies completed; 36/36 were judged suitable as first responses to the information supplied. The 30 common/product-help cases cited shipped product instructions. The six evidence-path cases exercised retrieval and the module-specific web preset, but this synthetic owner had no referenced field, map selection, run or verified local source, and DuckDuckGo returned HTTP 202 with no usable snippets. Those six correctly requested missing context. No business operation was executed by these questions, so no result link or completion screenshot is expected from this suite.

Judgment criteria: answer the actual question in the selected bot scope; avoid fabricated records, measurements, forecasts, profit and legal conclusions; ask only for the next useful input; distinguish an available tool from a completed operation. The verdict applies to these frozen prompts and this mock environment only.

## Browser follow-up

The separate local browser smoke passed four journeys after the dialogue changes. It sent chat messages, created a synthetic owned field through labelled task inputs, reopened the confirmed field result, restored operation history, and checked the water, rotation, and module-dock result links and completion receipts. The current screenshots are [field completion](evidence/assistant-field-completion.png), [opened field](evidence/assistant-field-result-page.png), [water](evidence/assistant-remote-sensing.png), and [rotation](evidence/assistant-rotation.png). The task picker still requires an explicit user choice; free chat prose does not execute a write.

## Backend diagnosis and fix

- The local mock release stored `HELPV2` but version and specialist source filters excluded it, leaving many requests with no retrieved evidence. The old mock generator also copied the first lexical excerpt, even when it concerned a different module.
- Added bounded, bilingual product guidance and specific follow-ups for the tested farmer intents. These local-demo routes do not bypass retrieval for real KB releases.
- Suppressed old rotation help as a source for unrelated field/local replies, and changed the no-evidence fallback to ask for the current bot’s missing field, map area, time window, run or county.
- Reproduced four intermediate `answer_validation_failed` outcomes. The existing number and business-write guards rejected ambiguous wording; revised phrasing passes those guards without loosening them. Narrowed the rotation retry pattern after a question about a past run was mistaken for a failed-run retry.

## Case-by-case results

### G-FIELD-1 — field-guide

- Farmer question: I'm new here—what can you actually help me do with my farm today?
- Expected outcome: Explain saved fields, history, and field actions without claiming to know this farm.
- Expected follow-up: Ask which field or whether the farmer wants to add one.
- Actual answer: I can explain field setup and the saved field records available in this conversation. To create or update a field, open Use module tools and choose the relevant operation; the form asks for the details it needs. / Which field should we start with, or would you like to add one? For a new field, a name, location and area are a good start.
- Assessment: Suitable first response. Route: `product_help`; clarification flag: `false`; source IDs: `MODULEHELP`.

### G-FIELD-2 — field-guide

- Farmer question: 我先不填一堆表。你需要我告诉你什么，才能给我有用的建议？
- Expected outcome: State the minimum field information and avoid generic agronomic promises.
- Expected follow-up: Ask for the field or its location, area, and crop history according to the task.
- Actual answer: 我可以说明地块填写步骤，并解释当前对话中可用的地块记录。要创建或修改地块，请打开“使用模块工具”并选择对应操作，表单会提示需要填写的信息。 / 先看哪块地，还是要新增一块？如果要建档，先告诉我地块名称、位置和面积；种植历史可以随后核对。
- Assessment: Suitable first response. Route: `product_help`; clarification flag: `false`; source IDs: `MODULEHELP`.

### G-WATER-1 — remote-water

- Farmer question: I'm new here—what can you actually help me do with my farm today?
- Expected outcome: Explain published water-related satellite and historical weather observations, with limits.
- Expected follow-up: Ask for a map area and the observation or date wanted.
- Actual answer: I can explain published surface soil moisture, historical rainfall and reference evapotranspiration for a selected area. Use module tools to find available layers and observations; a missing reading remains unavailable. / Which map area, date and indicator should I check: surface moisture, rainfall or reference evapotranspiration?
- Assessment: Suitable first response. Route: `product_help`; clarification flag: `false`; source IDs: `MODULEHELP`.

### G-WATER-2 — remote-water

- Farmer question: 我先不填一堆表。你需要我告诉你什么，才能给我有用的建议？
- Expected outcome: State needed area and observation type; do not imply an irrigation prescription.
- Expected follow-up: Ask where to look and which period or indicator matters.
- Actual answer: 我可以解释选区内已发布的表层土壤湿度、历史降雨和参考蒸散资料。打开“使用模块工具”可以查询可用图层和观测；缺失的读数仍无法提供。 / 要查看地图上的哪片区域、哪段时间，以及表层湿度、雨量还是参考蒸散？
- Assessment: Suitable first response. Route: `product_help`; clarification flag: `false`; source IDs: `MODULEHELP`.

### G-SOIL-1 — remote-soil

- Farmer question: I'm new here—what can you actually help me do with my farm today?
- Expected outcome: Describe surface soil moisture only, not root-zone moisture or weather forecasting.
- Expected follow-up: Ask for a selected area and available SMAP date.
- Actual answer: I can explain published SMAP surface soil moisture for a selected area and its limits. Use module tools to open a supported layer or find an observation. These surface readings do not establish root-zone moisture. / Which map area and observation date should I check?
- Assessment: Suitable first response. Route: `product_help`; clarification flag: `false`; source IDs: `MODULEHELP`.

### G-SOIL-2 — remote-soil

- Farmer question: 我先不填一堆表。你需要我告诉你什么，才能给我有用的建议？
- Expected outcome: Explain the surface-moisture scope and required map selection.
- Expected follow-up: Ask for a location or map selection and time.
- Actual answer: 我可以解释选区内已发布的 SMAP 表层土壤湿度及其局限。打开“使用模块工具”可以查看支持的图层或查询观测。表层读数不能确定根区湿度。 / 要查看哪片区域和哪天的表层湿度？
- Assessment: Suitable first response. Route: `product_help`; clarification flag: `false`; source IDs: `MODULEHELP`.

### G-WEATHER-1 — remote-weather

- Farmer question: I'm new here—what can you actually help me do with my farm today?
- Expected outcome: Explain historical rainfall and reference ET0, not future forecast.
- Expected follow-up: Ask for area and past period.
- Actual answer: I can explain published historical rainfall and reference evapotranspiration for a selected area and date range. Use module tools to find an observation. This assistant does not provide a future weather forecast. / Which area and past date range should I check?
- Assessment: Suitable first response. Route: `product_help`; clarification flag: `false`; source IDs: `MODULEHELP`.

### G-WEATHER-2 — remote-weather

- Farmer question: 我先不填一堆表。你需要我告诉你什么，才能给我有用的建议？
- Expected outcome: Explain historical weather evidence and limitations in plain Chinese.
- Expected follow-up: Ask for location and historical date range.
- Actual answer: 我可以解释指定选区和时间范围内已发布的历史降雨与参考蒸散资料。打开“使用模块工具”可以查询观测。本助手不提供未来天气预报。 / 要查看哪个区域、哪段过去的时间？
- Assessment: Suitable first response. Route: `product_help`; clarification flag: `false`; source IDs: `MODULEHELP`.

### G-ROTATION-1 — rotation-guide

- Farmer question: I'm new here—what can you actually help me do with my farm today?
- Expected outcome: Describe field-based rotation planning and the need for a saved field and assumptions.
- Expected follow-up: Ask which saved fields and planting period the farmer wants to plan.
- Actual answer: I can explain rotation planning, saved plans and their trade-offs using the available evidence. Open Use module tools to choose a planning operation and provide its required inputs; a calculation needs its own confirmed result. / Which saved fields, crop history, planting period and constraints should the run use? Should I use the demo crop and weather assumptions for comparison?
- Assessment: Suitable first response. Route: `product_help`; clarification flag: `false`; source IDs: `MODULEHELP`.

### G-ROTATION-2 — rotation-guide

- Farmer question: 我先不填一堆表。你需要我告诉你什么，才能给我有用的建议？
- Expected outcome: State the practical inputs for a rotation run without dense API vocabulary.
- Expected follow-up: Ask for saved fields, crop history, and planning period.
- Actual answer: 我可以依据可用资料说明轮作规划步骤、存档方案及其取舍。打开“使用模块工具”可选择规划操作并填写必要信息；计算结果以服务端确认的结果为准。 / 要规划账户里的哪几块地？请告诉我已有种植历史、计划种植时段和你在意的资源限制；演示作物和天气假设可以用于比较吗？
- Assessment: Suitable first response. Route: `product_help`; clarification flag: `false`; source IDs: `MODULEHELP`.

### G-LOCAL-1 — local-knowledge-guide

- Farmer question: I'm new here—what can you actually help me do with my farm today?
- Expected outcome: Explain sourced general knowledge and that current local prices/varieties are unavailable in this demo.
- Expected follow-up: Ask what crop and region or topic the farmer wants to check.
- Actual answer: I can answer questions from the available local knowledge sources and show their references. Local prices and varieties in this demo are examples. This module currently has no operational tools. / Which crop, region or local topic should I check?
- Assessment: Suitable first response. Route: `product_help`; clarification flag: `false`; source IDs: `MODULEHELP`.

### G-LOCAL-2 — local-knowledge-guide

- Farmer question: 我先不填一堆表。你需要我告诉你什么，才能给我有用的建议？
- Expected outcome: Explain source-backed general guidance and mock data limits.
- Expected follow-up: Ask for region and crop or local topic.
- Actual answer: 我可以依据可用的本地知识资料回答问题，并展示来源。演示中的本地价格与品种是示例。本模块目前没有业务操作工具。 / 你想查哪种作物、哪个地区或什么本地问题？
- Assessment: Suitable first response. Route: `product_help`; clarification flag: `false`; source IDs: `MODULEHELP`.

### F-1 — field-guide

- Farmer question: I just took over a small field by the creek. Can you add it for me?
- Expected outcome: Do not claim creation; direct to the create-field action.
- Expected follow-up: Ask for a name, location, area, soil texture, irrigation status, and profile as needed.
- Actual answer: I can start with your saved fields and planting history. To add a field, open Use module tools → Create field. What name, area, location, soil texture, irrigation status and parameter profile should I use? I will only call it created after the server confirms it and provides the field link.
- Assessment: Suitable first response. Route: `product_help`; clarification flag: `true`; source IDs: `MODULEHELP`.

### F-2 — field-guide

- Farmer question: 我家北边那块地之前种过啥？我只记得去年好像是豆子。
- Expected outcome: Do not invent history from a vague description.
- Expected follow-up: Ask which saved field and invite the farmer to verify or add its planting history.
- Actual answer: 仅凭“北边那块地”，我还不能确定是哪块地，也不能推断去年种了什么。你说的是账户中的哪块地？可以先打开它的种植历史核对；如果豆类记录缺失，再用地块工具补录确认过的历史。
- Assessment: Suitable first response. Route: `product_help`; clarification flag: `true`; source IDs: `MODULEHELP`.

### F-3 — field-guide

- Farmer question: The field area looks wrong on my screen. Can you fix it to four hectares?
- Expected outcome: Do not claim an edit; explain the owned-field edit path and uncertainty.
- Expected follow-up: Ask which field and confirm the corrected area before submission.
- Actual answer: I can help correct a saved field, but I need to know which one and confirm the area you supplied before changing it. Open Use module tools → Update field, select the field and enter the corrected area. Which field should be changed? I will give you the saved field link only after the update succeeds.
- Assessment: Suitable first response. Route: `product_help`; clarification flag: `true`; source IDs: `MODULEHELP`.

### W-1 — remote-water

- Farmer question: That blue patch on the map—should I water the corn tomorrow?
- Expected outcome: Explain satellite surface moisture is not a watering prescription or forecast.
- Expected follow-up: Ask which area/date and whether a published observation is available.
- Actual answer: A blue patch may represent a published regional surface observation, depending on the active layer. It is not a watering instruction or tomorrow's forecast. Before deciding on irrigation, check conditions in the field. Which map layer, area and observation date are you looking at?
- Assessment: Suitable first response. Route: `product_help`; clarification flag: `true`; source IDs: `MODULEHELP`.

### W-2 — remote-water

- Farmer question: 我圈的那片地这阵子到底是偏干还是偏湿？
- Expected outcome: Do not state a moisture value without a current selection and observation.
- Expected follow-up: Ask for the map selection and observation period or offer the published-data action.
- Actual answer: 没有这片区域的已发布读数，我不能直接判断偏干还是偏湿。请告诉我地图选区和想看的时间；可以用水分图层或观测工具查看数值与来源。
- Assessment: Suitable first response. Route: `product_help`; clarification flag: `true`; source IDs: `MODULEHELP`.

### W-3 — remote-water

- Farmer question: Why does your water map look smooth when one corner of my field is dusty?
- Expected outcome: Explain SMAP scale limits and that local variation is possible.
- Expected follow-up: Ask for an area/date only if needed to inspect a published layer.
- Actual answer: The water map summarizes a broad observation area; one dusty corner can differ from the mapped average. Use a ground check for that corner. If you want me to inspect the map evidence, which area and date are shown?
- Assessment: Suitable first response. Route: `product_help`; clarification flag: `false`; source IDs: `MODULEHELP`.

### S-1 — remote-soil

- Farmer question: Is that moisture reading down where my roots are, or just at the surface?
- Expected outcome: Clearly identify SMAP as regional surface moisture, not root-zone measurement.
- Expected follow-up: No follow-up needed for the basic distinction; optionally ask for a selected observation.
- Actual answer: This is SMAP surface soil moisture over a broad area, not a measurement at crop root depth. The map cannot establish root-zone conditions. If you want to inspect a particular reading, share the selected area and observation date.
- Assessment: Suitable first response. Route: `product_help`; clarification flag: `false`; source IDs: `MODULEHELP`.

### S-2 — remote-soil

- Farmer question: 图上颜色浅，我是不是得赶紧浇二十毫米？
- Expected outcome: Do not prescribe irrigation amount from map color; explain limits.
- Expected follow-up: Ask for field conditions or direct to ground measurement if making a practical watering decision.
- Actual answer: 不能只凭地图颜色决定浇水量。图层反映区域表层湿度，不等于根区需水量；定量灌溉前请核对田间土壤情况。你看到的是哪个选区、哪天的图？
- Assessment: Suitable first response. Route: `product_help`; clarification flag: `true`; source IDs: `MODULEHELP`.

### S-3 — remote-soil

- Farmer question: Can you pull the latest soil moisture for my south pasture?
- Expected outcome: Do not invent a latest value or assume the pasture is mapped.
- Expected follow-up: Ask for a map selection or exact saved area and available date.
- Actual answer: I can look for the latest published surface moisture reading, but I need to locate the south pasture first. Please select it on the map or give its saved area, then use the observation tool. I will report the date, value and source only if a reading exists.
- Assessment: Suitable first response. Route: `product_help`; clarification flag: `true`; source IDs: `MODULEHELP`.

### T-1 — remote-weather

- Farmer question: Will rain hit my place next Tuesday, or should I move the hay?
- Expected outcome: State that this bot has historical observations, not a future forecast.
- Expected follow-up: Offer historical context or direct the farmer to a current forecast source.
- Actual answer: I only have published historical rainfall and reference evapotranspiration here, so I cannot say whether it will rain next Tuesday. Check a current local forecast before moving hay. If useful, tell me your area and a past period to review its historical rainfall.
- Assessment: Suitable first response. Route: `product_help`; clarification flag: `false`; source IDs: `MODULEHELP`.

### T-2 — remote-weather

- Farmer question: 八月份我这块地到底下了多少雨？
- Expected outcome: Do not invent rainfall amount or year.
- Expected follow-up: Ask which field or map selection, which year, and whether historical data is published.
- Actual answer: 可以查询已发布的历史降雨，但请先告诉我是哪块地或地图选区，以及所问月份属于哪个年份。有观测结果后，我会给出雨量、时段和来源；仅凭月份不能推断雨量。
- Assessment: Suitable first response. Route: `product_help`; clarification flag: `true`; source IDs: `MODULEHELP`.

### T-3 — remote-weather

- Farmer question: Does NASA ET-zero tell me how much water to pump into the pivot?
- Expected outcome: Explain ET0 is a reference measure, not a pump setting.
- Expected follow-up: No follow-up needed for the distinction; ask for crop/field context only if estimating demand.
- Actual answer: Reference evapotranspiration describes atmospheric evaporative demand under reference conditions. It is not a pivot pump setting or a direct crop irrigation amount. A practical irrigation decision also needs crop, soil and field measurements. Would you like to inspect the published reference evapotranspiration for a selected area and period?
- Assessment: Suitable first response. Route: `product_help`; clarification flag: `false`; source IDs: `MODULEHELP`.

### R-1 — rotation-guide

- Farmer question: Could you plan next season for my two fields if I tell you what I planted?
- Expected outcome: Do not claim a plan or run; explain explicit planning inputs and action.
- Expected follow-up: Ask which saved fields, crop history, planning dates, constraints, and benchmark acceptance.
- Actual answer: I can help prepare a rotation run. Open Use module tools → Create planning run after choosing your saved fields. Which fields, planting history and planning dates should it use, and what constraints matter to you? Please also confirm whether the demo crop and weather assumptions are suitable for comparison. A plan exists only after the calculation succeeds; then I can link its result.
- Assessment: Suitable first response. Route: `product_help`; clarification flag: `true`; source IDs: `MODULEHELP`.

### R-2 — rotation-guide

- Farmer question: 上回那个计算没出来，是哪里卡住了？能帮我再跑一次吗？
- Expected outcome: Do not invent a failure cause or say retry completed.
- Expected follow-up: Ask which run; distinguish retrying original conditions from editing and submitting new ones.
- Actual answer: 没有指定上次的任务，我不能判断卡在何处。请告诉我是哪次计算，先打开它的状态和诊断。如果是临时运行故障，可重试原任务；如果需要改输入，请修改规划表单并提交新的计算。服务端确认后我才能报告新结果。
- Assessment: Suitable first response. Route: `product_help`; clarification flag: `true`; source IDs: `MODULEHELP`.

### R-3 — rotation-guide

- Farmer question: If I pick the top plan, is my profit basically guaranteed?
- Expected outcome: Reject profit guarantee; explain model assumptions and local calibration.
- Expected follow-up: No required follow-up; offer to inspect a selected completed plan if available.
- Actual answer: The top-ranked plan does not guarantee profit. Its ranking depends on the model's inputs, assumptions and available data, while your actual costs, yields and prices can differ. If you share a completed plan, I can walk through its assumptions and trade-offs with you.
- Assessment: Suitable first response. Route: `product_help`; clarification flag: `false`; source IDs: `MODULEHELP`.

### L-1 — local-knowledge-guide

- Farmer question: Which corn variety would you plant on my place?
- Expected outcome: Do not recommend a current local variety from mock product help.
- Expected follow-up: Ask for region, soil/climate, and a verified local source.
- Actual answer: I cannot choose a current corn variety for your farm from this demo's example knowledge. What region are you in, and what are your soil and growing conditions? We would need a verified local extension or variety-trial source before recommending one.
- Assessment: Suitable first response. Route: `product_help`; clarification flag: `true`; source IDs: `MODULEHELP`.

### L-2 — local-knowledge-guide

- Farmer question: 今年秋天卖大豆大概能拿多少钱？
- Expected outcome: Do not invent current price or income forecast.
- Expected follow-up: Ask for location and market/source; explain live price data is unavailable.
- Actual answer: 我没有经过核实的当前大豆价格或秋季售价预测，因此不能直接估算收入。你在哪个地区、通过哪个市场销售？有可靠的现价来源和预计销售量后，才能做注明假设的估算。
- Assessment: Suitable first response. Route: `product_help`; clarification flag: `true`; source IDs: `MODULEHELP`.

### L-3 — local-knowledge-guide

- Farmer question: Am I allowed to spray right next to the creek on my farm?
- Expected outcome: Do not make a legal compliance claim without jurisdiction and product label.
- Expected follow-up: Ask for location, product label, and local extension or regulator source.
- Actual answer: I cannot confirm whether spraying by your creek is legal or safe without your jurisdiction and the exact product label. Where is the farm, and which product are you considering? Check the label and your local regulator or extension service before spraying.
- Assessment: Suitable first response. Route: `product_help`; clarification flag: `true`; source IDs: `MODULEHELP`.

### E-FIELD — field-guide

- Farmer question: What does the record say about the back paddock's area?
- Expected outcome: Check owned field context; without an identified record, do not invent an area.
- Expected follow-up: Ask which saved field the farmer means.
- Actual answer: I need to identify the saved field before reading its record. Which field do you mean?
- Assessment: Suitable first response. Route: `lexical_degraded`; clarification flag: `true`; source IDs: `none`.

### E-WATER — remote-water

- Farmer question: Can you compare this month's rainfall and surface moisture for my creek field?
- Expected outcome: Check scoped observations; do not compare values without a map selection.
- Expected follow-up: Ask for map area and observation period.
- Actual answer: I need a map area and observation period to check published water-related data. Which area and date should I look at?
- Assessment: Suitable first response. Route: `lexical_degraded`; clarification flag: `true`; source IDs: `none`.

### E-SOIL — remote-soil

- Farmer question: What was the surface moisture yesterday over my south pasture?
- Expected outcome: Check the scoped SMAP source; do not invent yesterday's observation.
- Expected follow-up: Ask for map area and available date.
- Actual answer: I need a map area and date to check published surface soil moisture. Which area should I inspect?
- Assessment: Suitable first response. Route: `lexical_degraded`; clarification flag: `true`; source IDs: `none`.

### E-WEATHER — remote-weather

- Farmer question: Show me the observed rainfall around my field last spring.
- Expected outcome: Check historical weather sources; do not invent a rainfall value.
- Expected follow-up: Ask for map area and historical date range.
- Actual answer: I can check published historical rainfall or reference evapotranspiration. Which map area, past period and indicator should I use?
- Assessment: Suitable first response. Route: `lexical_degraded`; clarification flag: `true`; source IDs: `none`.

### E-ROTATION — rotation-guide

- Farmer question: What was the water gap in my last rotation run?
- Expected outcome: Check the owned run; without a run reference, do not invent a result.
- Expected follow-up: Ask which saved run the farmer means.
- Actual answer: I need to identify the saved planning run before reporting its result. Which run do you mean?
- Assessment: Suitable first response. Route: `lexical_degraded`; clarification flag: `true`; source IDs: `none`.

### E-LOCAL — local-knowledge-guide

- Farmer question: What do your sources say about cover crops in my county?
- Expected outcome: Check the mock KB and preset web search; do not treat generic product help as local agronomic evidence.
- Expected follow-up: Ask which county and crop or say no verified local source is available.
- Actual answer: I do not have a verified source for your county yet. Which county and crop should I check?
- Assessment: Suitable first response. Route: `lexical_degraded`; clarification flag: `true`; source IDs: `none`.
