"""Route conversation and shipped product instructions before evidence retrieval.

Only complete social messages bypass factual answering. Product help describes the
existing controls; neither route executes an action or invents farm records.
"""

# ruff: noqa: E501 -- keep bilingual farmer-facing copy and regexes intact.

import hashlib
import re
from dataclasses import dataclass
from typing import Any, Literal


@dataclass(frozen=True)
class DialogueRoute:
    kind: Literal["conversation", "product_help", "evidence"]
    paragraphs: tuple[str, ...] = ()
    topic: str = ""
    needs_clarification: bool = False


BOT_NAMES = {
    "field-guide": ("Field guide", "地块助手"),
    "remote-water": ("Water specialist", "水分助手"),
    "remote-soil": ("Soil specialist", "土壤助手"),
    "remote-weather": ("Weather specialist", "天气助手"),
    "local-knowledge-guide": ("Local knowledge guide", "本地知识助手"),
    "rotation-guide": ("Rotation guide", "轮作助手"),
}

CAPABILITIES = {
    "field-guide": (
        "I can explain field setup and the saved field records available in this conversation. "
        "To create or update a field, open Use module tools and choose the relevant operation; "
        "the form asks for the details it needs.",
        "我可以说明地块填写步骤，并解释当前对话中可用的地块记录。"
        "要创建或修改地块，请打开“使用模块工具”并选择对应操作，表单会提示需要填写的信息。",
    ),
    "remote-water": (
        "I can explain published surface soil moisture, historical rainfall and reference "
        "evapotranspiration for a selected area. Use module tools to find available layers "
        "and observations; a missing reading remains unavailable.",
        "我可以解释选区内已发布的表层土壤湿度、历史降雨和参考蒸散资料。"
        "打开“使用模块工具”可以查询可用图层和观测；缺失的读数仍无法提供。",
    ),
    "remote-soil": (
        "I can explain published SMAP surface soil moisture for a selected area and its "
        "limits. Use module tools to open a supported layer or find an observation. "
        "These surface readings do not establish root-zone moisture.",
        "我可以解释选区内已发布的 SMAP 表层土壤湿度及其局限。"
        "打开“使用模块工具”可以查看支持的图层或查询观测。表层读数不能确定根区湿度。",
    ),
    "remote-weather": (
        "I can explain published historical rainfall and reference evapotranspiration for "
        "a selected area and date range. Use module tools to find an observation. "
        "This assistant does not provide a future weather forecast.",
        "我可以解释指定选区和时间范围内已发布的历史降雨与参考蒸散资料。"
        "打开“使用模块工具”可以查询观测。本助手不提供未来天气预报。",
    ),
    "local-knowledge-guide": (
        "I can answer questions from the available local knowledge sources and show their "
        "references. Local prices and varieties in this demo are examples. "
        "This module currently has no operational tools.",
        "我可以依据可用的本地知识资料回答问题，并展示来源。"
        "演示中的本地价格与品种是示例。本模块目前没有业务操作工具。",
    ),
    "rotation-guide": (
        "I can explain rotation planning, saved plans and their trade-offs using the "
        "available evidence. Open Use module tools to choose a planning operation and "
        "provide its required inputs; a calculation needs its own confirmed result.",
        "我可以依据可用资料说明轮作规划步骤、存档方案及其取舍。"
        "打开“使用模块工具”可选择规划操作并填写必要信息；计算结果以服务端确认的结果为准。",
    ),
}

FIELD_SETUP = (
    (
        "To add a field, have its name, area in hectares, latitude and longitude, soil "
        "texture, irrigation availability, and a parameter profile ready. The profile "
        "provides the crop settings used by the planner.",
        "Planting history and a field boundary can be added later. If the soil texture "
        "is unknown, choose Unknown.",
        "Open Use module tools → Create field, fill in those details, and choose Continue "
        "action. After the server confirms creation, Open result takes you to the saved field.",
    ),
    (
        "添加地块时，请准备名称、以公顷计的面积、位置经纬度、土壤质地、是否具备灌溉条件，"
        "并选择资料配置。配置提供规划所用的作物参数。",
        "种植历史和地块边界可以稍后补充；不清楚土壤质地时，可以选择“未知”。",
        "打开“使用模块工具”→“创建地块”，填写这些信息并点击“继续操作”。"
        "服务端确认创建成功后，“打开结果”会带你查看保存的地块。",
    ),
)


# These replies describe product controls and evidence limits. They are useful in
# the offline demo even when no farmer record has been saved. A selected record or
# map area still goes through the evidence pipeline for actual values.
FARMER_HELP: dict[str, tuple[tuple[str, str], ...]] = {
    "field-guide": (
        (
            "I can start with your saved fields and planting history. To add a field, open Use module tools → Create field. What name, area, location, soil texture, irrigation status and parameter profile should I use? I will only call it created after the server confirms it and provides the field link.",
            "可以先从已保存的地块和种植历史入手。要新增地块，请打开“使用模块工具”→“创建地块”。这块地叫什么、面积多大、位置在哪里、土壤质地和灌溉条件如何、选用哪个参数配置？服务端确认并给出地块链接后，才能算创建成功。",
        ),
        (
            "I cannot identify the north field or its past crop from that description alone. Which saved field do you mean? Open its planting history to check the recorded crop; if last year's beans are missing, you can add a verified history entry with the field tools.",
            "仅凭“北边那块地”，我还不能确定是哪块地，也不能推断去年种了什么。你说的是账户中的哪块地？可以先打开它的种植历史核对；如果豆类记录缺失，再用地块工具补录确认过的历史。",
        ),
        (
            "I can help correct a saved field, but I need to know which one and confirm the area you supplied before changing it. Open Use module tools → Update field, select the field and enter the corrected area. Which field should be changed? I will give you the saved field link only after the update succeeds.",
            "可以修改已保存地块的面积，但需要先确认是哪块地和正确面积。打开“使用模块工具”→“更新地块”，选择地块并填写修正后的面积。要改哪块地？更新成功后我会给出保存后的地块链接。",
        ),
    ),
    "remote-water": (
        (
            "A blue patch may represent a published regional surface observation, depending on the active layer. It is not a watering instruction or tomorrow's forecast. Before deciding on irrigation, check conditions in the field. Which map layer, area and observation date are you looking at?",
            "蓝色区域代表已发布的区域表层观测，不能单独决定明天是否浇水，也不是天气预报。灌溉前还要核对田间情况。你圈的是哪片区域、哪天的观测？有已发布图层时可以打开核对。",
        ),
        (
            "I cannot call the selected area dry or wet without its published reading. Which map selection and time period should I check? Use the water layer or observation tool to see the value and source.",
            "没有这片区域的已发布读数，我不能直接判断偏干还是偏湿。请告诉我地图选区和想看的时间；可以用水分图层或观测工具查看数值与来源。",
        ),
        (
            "The water map summarizes a broad observation area; one dusty corner can differ from the mapped average. Use a ground check for that corner. If you want me to inspect the map evidence, which area and date are shown?",
            "水分地图反映较大范围的观测，地里一角的情况可能与区域平均不同。那一角仍需要实地核查。若要核对图层，请告诉我选区和日期。",
        ),
    ),
    "remote-soil": (
        (
            "This is SMAP surface soil moisture over a broad area, not a measurement at crop root depth. The map cannot establish root-zone conditions. If you want to inspect a particular reading, share the selected area and observation date.",
            "这是 SMAP 对较大范围的表层土壤湿度观测，不是作物根部深度的读数。地图不能确定根区情况。若要核对某条读数，请提供选区和观测日期。",
        ),
        (
            "A pale map color alone cannot tell you how much to irrigate. The layer represents regional surface moisture, not root-zone water demand. Check soil conditions in the field before setting an amount. Which map area and date are you seeing?",
            "不能只凭地图颜色决定浇水量。图层反映区域表层湿度，不等于根区需水量；定量灌溉前请核对田间土壤情况。你看到的是哪个选区、哪天的图？",
        ),
        (
            "I can look for the latest published surface moisture reading, but I need to locate the south pasture first. Please select it on the map or give its saved area, then use the observation tool. I will report the date, value and source only if a reading exists.",
            "可以查找最新已发布的表层湿度读数，但需要先定位南边牧场。请在地图上选中它，或提供已保存的区域，再用观测工具查询。只有存在读数时，我才会给出日期、数值和来源。",
        ),
    ),
    "remote-weather": (
        (
            "I only have published historical rainfall and reference evapotranspiration here, so I cannot say whether it will rain next Tuesday. Check a current local forecast before moving hay. If useful, tell me your area and a past period to review its historical rainfall.",
            "这里提供的是已发布的历史降雨和参考蒸散资料，不能判断下周二会不会下雨。搬运干草前请查看当地最新预报。若想看历史情况，请告诉我区域和过去的时间段。",
        ),
        (
            "I can check published historical rainfall, but I need the field or map area and which year's August you mean. Once an observation is available, I can give its amount, period and source; I cannot infer a total from the month alone.",
            "可以查询已发布的历史降雨，但请先告诉我是哪块地或地图选区，以及所问月份属于哪个年份。有观测结果后，我会给出雨量、时段和来源；仅凭月份不能推断雨量。",
        ),
        (
            "Reference evapotranspiration describes atmospheric evaporative demand under reference conditions. It is not a pivot pump setting or a direct crop irrigation amount. A practical irrigation decision also needs crop, soil and field measurements. Would you like to inspect the published reference evapotranspiration for a selected area and period?",
            "参考蒸散描述参考条件下的大气蒸发需求，不是喷灌设备的泵水设定，也不等于作物灌溉量。实际决策还需要作物、土壤和田间实测信息。要查看某个选区和时段已发布的参考蒸散吗？",
        ),
    ),
    "rotation-guide": (
        (
            "I can help prepare a rotation run. Open Use module tools → Create planning run after choosing your saved fields. Which fields, planting history and planning dates should it use, and what constraints matter to you? Please also confirm whether the demo crop and weather assumptions are suitable for comparison. A plan exists only after the calculation succeeds; then I can link its result.",
            "可以一起准备轮作计算。先选择已保存的地块，再打开“使用模块工具”→“创建规划任务”。请告诉我地块、种植历史、规划时段，以及重要的限制条件；也请确认演示作物和天气假设是否适合用于比较。计算成功后才会有可打开的方案结果。",
        ),
        (
            "I cannot tell why the last calculation stopped without its run. Which saved run do you mean? Open that run's status and diagnostics first. If it failed because of temporary execution, retry the same run; if inputs need changing, edit the planning form and submit a new calculation. I will confirm the new result only after the server does.",
            "没有指定上次的任务，我不能判断卡在何处。请告诉我是哪次计算，先打开它的状态和诊断。如果是临时运行故障，可重试原任务；如果需要改输入，请修改规划表单并提交新的计算。服务端确认后我才能报告新结果。",
        ),
        (
            "The top-ranked plan does not guarantee profit. Its ranking depends on the model's inputs, assumptions and available data, while your actual costs, yields and prices can differ. If you share a completed plan, I can walk through its assumptions and trade-offs with you.",
            "排名靠前的方案不保证收益。排名取决于模型输入、假设和现有数据，实际成本、产量与价格可能不同。若你提供已完成的方案，我可以一起核对假设和取舍。",
        ),
    ),
    "local-knowledge-guide": (
        (
            "I cannot choose a current corn variety for your farm from this demo's example knowledge. What region are you in, and what are your soil and growing conditions? We would need a verified local extension or variety-trial source before recommending one.",
            "不能只凭演示知识资料为你的农场选定当前玉米品种。请告诉我地区、土壤和生长条件；推荐前还需要核对当地农技部门或品种试验的可靠资料。",
        ),
        (
            "I do not have a verified current soybean price or a sale forecast, so I cannot estimate your autumn proceeds. What region and market do you sell into? With a current price source and your expected sale quantity, we could make a labelled estimate.",
            "我没有经过核实的当前大豆价格或秋季售价预测，因此不能直接估算收入。你在哪个地区、通过哪个市场销售？有可靠的现价来源和预计销售量后，才能做注明假设的估算。",
        ),
        (
            "I cannot confirm whether spraying by your creek is legal or safe without your jurisdiction and the exact product label. Where is the farm, and which product are you considering? Check the label and your local regulator or extension service before spraying.",
            "没有农场所在地的法规和具体产品标签，我不能确认溪边喷药是否合法或安全。农场在哪里，打算用什么产品？喷施前请核对标签及当地主管部门或农技服务的要求。",
        ),
    ),
}


GENERAL_FOLLOW_UP = {
    "field-guide": (
        "Which field should we start with, or would you like to add one? For a new field, a name, location and area are a good start.",
        "先看哪块地，还是要新增一块？如果要建档，先告诉我地块名称、位置和面积；种植历史可以随后核对。",
    ),
    "remote-water": (
        "Which map area, date and indicator should I check: surface moisture, rainfall or reference evapotranspiration?",
        "要查看地图上的哪片区域、哪段时间，以及表层湿度、雨量还是参考蒸散？",
    ),
    "remote-soil": (
        "Which map area and observation date should I check?",
        "要查看哪片区域和哪天的表层湿度？",
    ),
    "remote-weather": (
        "Which area and past date range should I check?",
        "要查看哪个区域、哪段过去的时间？",
    ),
    "rotation-guide": (
        "Which saved fields, crop history, planting period and constraints should the run use? Should I use the demo crop and weather assumptions for comparison?",
        "要规划账户里的哪几块地？请告诉我已有种植历史、计划种植时段和你在意的资源限制；演示作物和天气假设可以用于比较吗？",
    ),
    "local-knowledge-guide": (
        "Which crop, region or local topic should I check?",
        "你想查哪种作物、哪个地区或什么本地问题？",
    ),
}


def route_message(question: str, context: dict[str, Any]) -> DialogueRoute:
    text = " ".join(question.casefold().split()).strip(" .,!?:;。！？，：；")
    bot = context.get("bot_id", "rotation-guide")
    zh = context.get("language") == "zh"
    if re.fullmatch(
        r"(?:hi|hello|hey)(?: there)?|good (?:morning|afternoon|evening)|你好|您好|嗨|早上好", text
    ):
        name = BOT_NAMES.get(bot, BOT_NAMES["rotation-guide"])[int(zh)]
        return DialogueRoute(
            "conversation",
            (
                f"你好！我是你的{name}。今天想处理什么事情？"
                if zh
                else f"Hi! I’m your {name}. What would you like to work on today?",
            ),
        )
    if re.fullmatch(r"thanks(?: a lot)?|thank you(?: very much)?|谢谢(?:你)?|多谢", text):
        return DialogueRoute(
            "conversation",
            (
                "不客气！接下来还想了解什么？"
                if zh
                else "You’re welcome! What would you like to work on next?",
            ),
        )
    if re.fullmatch(
        r"what can you (?:do(?: for me)?|help(?: me)? with)|how can you help(?: me)?|"
        r"who are you|你(?:是谁|能做什么|可以做什么|能帮我做什么)|有什么功能",
        text,
    ) or re.search(
        r"new here|what can you actually help|first time here|先不填.*表|需要.{0,8}告诉你什么",
        text,
    ):
        follow_up = GENERAL_FOLLOW_UP.get(bot, GENERAL_FOLLOW_UP["rotation-guide"])[int(zh)]
        return DialogueRoute(
            "product_help",
            (CAPABILITIES.get(bot, CAPABILITIES["rotation-guide"])[int(zh)], follow_up),
            "capabilities",
        )

    def help_topic(index: int, *, clarify: bool = True) -> DialogueRoute:
        return DialogueRoute(
            "product_help",
            (FARMER_HELP[bot][index][int(zh)],),
            f"farmer_{bot}_{index}",
            clarify,
        )

    if bot == "field-guide":
        if re.search(
            r"(?:field|地块).{0,45}(?:area|面积).{0,25}(?:wrong|fix|change|修改|改)", text
        ) or re.search(r"(?:fix|change|改|修改).{0,30}(?:area|面积)", text):
            return help_topic(2)
        if re.search(r"(?:北边|north).{0,50}(?:种过|种了|history|planted|crop)", text):
            return help_topic(1)
        if re.search(r"(?:field|地块).{0,60}(?:add it|add this|create it|帮我加|帮我建)", text):
            return help_topic(0)
    if context.get("preset") == "field_management" and re.search(
        r"\b(?:creat(?:e|ing)|add(?:ing)?|register(?:ing)?|set(?:ting)? up|sav(?:e|ing))\s+"
        r"(?:(?:a|an|the|my|another|new|owned)\s+){0,3}field\b|"
        r"(?:新建|创建|添加|登记|新增|保存)(?:我的|一个|新)?地块|"
        r"地块.{0,12}(?:需要.{0,8}(?:信息|资料)|怎么(?:创建|添加|登记))",
        text,
    ):
        return DialogueRoute("product_help", FIELD_SETUP[int(zh)], "field_setup")
    if bot == "remote-water":
        if re.search(r"(?:map|地图).{0,45}(?:smooth|dusty|光滑|干裂|一角)", text) or re.search(
            r"(?:smooth|dusty).{0,45}(?:map|field)", text
        ):
            return help_topic(2, clarify=False)
        if re.search(
            r"(?:water|浇水|灌溉).{0,50}(?:tomorrow|明天|should|该|要)", text
        ) or re.search(r"(?:should|该|要).{0,30}(?:water|浇水|灌溉)", text):
            return help_topic(0)
        if not context.get("selection") and re.search(
            r"(?:dry|wet|偏干|偏湿|湿度).{0,30}(?:area|patch|地|片|吗|？|\?)|(?:area|patch|地|片).{0,40}(?:dry|wet|偏干|偏湿)",
            text,
        ):
            return help_topic(1)
    if bot == "remote-soil":
        if re.search(
            r"(?:root|根区|根部).{0,50}(?:surface|表层|moisture|湿度)|(?:surface|表层).{0,50}(?:root|根区|根部)",
            text,
        ):
            return help_topic(0, clarify=False)
        if re.search(
            r"(?:浇|灌|irrigat|water).{0,30}(?:毫米|mm|多少|how much)|(?:颜色|color).{0,35}(?:浇|灌|irrigat)",
            text,
        ):
            return help_topic(1)
        if not context.get("selection") and re.search(
            r"(?:latest|最新).{0,45}(?:soil|moisture|湿度)|(?:soil|moisture|湿度).{0,45}(?:latest|最新)",
            text,
        ):
            return help_topic(2)
    if bot == "remote-weather":
        if re.search(
            r"(?:next|tomorrow|下周|明天|未来).{0,45}(?:rain|雨|forecast|预报)|(?:rain|雨).{0,45}(?:next|tomorrow|下周|明天|未来)",
            text,
        ):
            return help_topic(0, clarify=False)
        if not context.get("selection") and re.search(
            r"(?:八月|august).{0,45}(?:rain|雨)|(?:rain|雨).{0,45}(?:八月|august)", text
        ):
            return help_topic(1)
        if re.search(
            r"(?:et.?zero|et0|蒸散).{0,65}(?:pump|pivot|irrigat|浇|灌|泵)|(?:pump|pivot|浇|灌|泵).{0,65}(?:et.?zero|et0|蒸散)",
            text,
        ):
            return help_topic(2, clarify=False)
    if bot == "rotation-guide":
        if re.search(
            r"(?:profit|收益|利润).{0,45}(?:guarantee|保证|一定)|(?:guarantee|保证|一定).{0,45}(?:profit|收益|利润)",
            text,
        ):
            return help_topic(2, clarify=False)
        if not context.get("run") and re.search(
            r"(?:上回|上次|last).{0,80}(?:没出来|失败|卡住|retry|再跑|failed|stopped|error)|(?:retry|再跑).{0,55}(?:run|计算)",
            text,
        ):
            return help_topic(1)
        if re.search(
            r"(?:plan|规划|轮作).{0,50}(?:next season|下季|下一季|two fields|两块地)|(?:next season|下季|下一季).{0,45}(?:plan|规划|轮作)",
            text,
        ):
            return help_topic(0)
    if bot == "local-knowledge-guide":
        if re.search(
            r"(?:variety|品种).{0,40}(?:corn|玉米|plant|种)|(?:corn|玉米).{0,40}(?:variety|品种)",
            text,
        ):
            return help_topic(0)
        if re.search(
            r"(?:大豆|soybean).{0,50}(?:卖|价格|多少钱|price|earn)|(?:今年|秋天|autumn|fall).{0,50}(?:大豆|soybean)",
            text,
        ):
            return help_topic(1)
        if re.search(
            r"(?:spray|喷药|喷施).{0,55}(?:creek|溪|河|allowed|合法)|(?:creek|溪|河).{0,55}(?:spray|喷药|喷施)",
            text,
        ):
            return help_topic(2)
    return DialogueRoute("evidence")


def product_evidence(route: DialogueRoute) -> dict[str, Any]:
    excerpt = "\n\n".join(route.paragraphs)
    path = (
        "sideronostos-backend/src/sideronostos_backend/modules/field_shift/schemas.py"
        if route.topic == "field_setup"
        else "docs/integration/agent-capabilities.md"
    )
    return {
        "id": "K1",
        "source": {
            "id": "MODULEHELP",
            "title": "Field creation requirements"
            if route.topic == "field_setup"
            else "Assistant capabilities",
            "url": "https://github.com/LinghaoLiOfficial/Sideronostos/blob/"
            "feat/agent-bot-catalog-integration/" + path,
            "access_scope": "product_help",
            "regions": ["product documentation"],
            "limitations": ["Product instructions, not evidence about a farmer's field."],
            "sha256": hashlib.sha256(excerpt.encode()).hexdigest(),
        },
        "excerpt": excerpt,
        "claims": [],
        "retrieval_mode": "product_help",
    }
