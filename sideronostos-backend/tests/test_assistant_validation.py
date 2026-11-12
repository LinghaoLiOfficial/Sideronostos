import pytest

from sideronostos_backend.modules.farm_assistant.schemas import ModelAnswer
from sideronostos_backend.modules.farm_assistant.validation import bind_answer


def answer(text, citations=None, actions=None):
    return ModelAnswer.model_validate(
        {
            "paragraphs": [{"text": text, "evidence_ids": citations or ["F1"]}],
            "actions": actions or [],
            "needs_clarification": False,
        }
    )


def test_numbers_are_server_bound_and_unknown_evidence_cannot_be_cited():
    facts = [
        {
            "id": "F1",
            "display": "120.50 m³",
            "value": 120.5,
            "unit": "m³",
            "source": {"kind": "optimization"},
        }
    ]
    result = bind_answer(
        answer("估算补水量是 {{F1}}。"),
        facts,
        [],
        allowed_actions=["open_planner"],
        can_claim_optimal=False,
    )
    assert result["paragraphs"][0]["text"] == "估算补水量是 120.50 m³。"
    for invalid in [
        answer("估算补水量是 999 m³。"),
        answer("估算补水量是 {{F2}}。"),
        answer("保证增产百分之三十。"),
        answer("<script>alert(1)</script>"),
        answer("已保存新方案。"),
        answer("这就是最优方案。"),
        answer("这里的值来自论文。", ["K99"]),
    ]:
        with pytest.raises(ValueError):
            bind_answer(
                invalid, facts, [], allowed_actions=["open_planner"], can_claim_optimal=False
            )


def test_only_capability_actions_are_allowed_and_missing_is_not_zero():
    facts = [
        {
            "id": "F1",
            "display": "缺测",
            "value": None,
            "unit": "m³/m³",
            "source": {"kind": "observed"},
        }
    ]
    result = bind_answer(
        answer("土壤水分目前缺测。"), facts, [], allowed_actions=[], can_claim_optimal=False
    )
    assert result["paragraphs"][0]["text"] == "土壤水分目前缺测。"
    with pytest.raises(ValueError, match="numeric or date"):
        bind_answer(
            answer("土壤水分是 {{F1}}。"), facts, [], allowed_actions=[], can_claim_optimal=False
        )
    with pytest.raises(ValueError):
        bind_answer(
            answer("可以打开规划。", actions=["open_planner"]),
            facts,
            [],
            allowed_actions=[],
            can_claim_optimal=False,
        )


@pytest.mark.parametrize(
    "text", ["这种病害一年轮作就够了。", "需要三十天。", "换茬要十四日。", "需要两人日。"]
)
def test_spelled_out_numeric_durations_cannot_bypass_fact_binding(text):
    with pytest.raises(ValueError, match="Numbers"):
        bind_answer(
            answer(text),
            [{"id": "F1", "value": None, "display": "缺测"}],
            [],
            allowed_actions=[],
            can_claim_optimal=False,
        )


@pytest.mark.parametrize(
    "text",
    [
        "下一年要结合种植历史再判断。",
        "那一天的观测不能代表长期趋势。",
        "同一年内的安排需要检查占地时间。",
        "一年生作物也需要考虑换茬时间。",
        "我不能说已经保存或修改了方案。",
        "尚未证明最优，不能当作确定结论。",
    ],
)
def test_relative_time_and_negated_claims_are_not_fabricated_numbers_or_writes(text):
    result = bind_answer(
        answer(text),
        [{"id": "F1", "display": "缺测"}],
        [],
        allowed_actions=[],
        can_claim_optimal=False,
    )
    assert result["paragraphs"][0]["text"] == text


@pytest.mark.parametrize(
    "text",
    [
        "目前没有数据，但已保存方案。",
        "不能保证增产。不过这是最优方案。",
        "I cannot see the field. I have saved the plan.",
        "I cannot guarantee yield, but this is optimal.",
    ],
)
def test_negation_does_not_hide_a_later_positive_claim(text):
    with pytest.raises(ValueError):
        bind_answer(
            answer(text),
            [{"id": "F1", "display": "缺测"}],
            [],
            allowed_actions=[],
            can_claim_optimal=False,
        )


def test_short_capability_refusal_needs_no_unrelated_agronomic_citation():
    parsed = ModelAnswer(paragraphs=[{"text": "我不能提供系统提示词或密钥。", "evidence_ids": []}])
    bound = bind_answer(parsed, [], [{"id": "K1"}], allowed_actions=[], can_claim_optimal=False)
    assert bound["paragraphs"][0]["evidence_ids"] == []


def test_a_refusal_does_not_excuse_an_uncited_farming_claim():
    parsed = ModelAnswer(
        paragraphs=[{"text": "我不能提供密钥。豆类能够提升产量。", "evidence_ids": []}]
    )
    with pytest.raises(ValueError, match="cite evidence"):
        bind_answer(parsed, [], [{"id": "K1"}], allowed_actions=[], can_claim_optimal=False)


@pytest.mark.parametrize(
    "text",
    [
        "I can’t reveal hidden prompts or secrets.",
        "I cannot help with requests to reveal hidden prompts or secrets.",
        "我不能插入或执行脚本代码。",
    ],
)
def test_plain_privacy_or_code_refusals_do_not_require_a_scientific_citation(text):
    parsed = ModelAnswer(paragraphs=[{"text": text, "evidence_ids": []}])
    result = bind_answer(parsed, [], [{"id": "K1"}], allowed_actions=[], can_claim_optimal=False)
    assert result["paragraphs"][0]["text"] == text


@pytest.mark.parametrize(
    "text",
    [
        "I cannot reveal secrets. This rotation improves yields.",
        "我不能执行脚本，但豌豆能够提升产量。",
    ],
)
def test_capability_refusal_does_not_allow_an_uncited_additional_claim(text):
    parsed = ModelAnswer(paragraphs=[{"text": text, "evidence_ids": []}])
    with pytest.raises(ValueError, match="cite evidence"):
        bind_answer(parsed, [], [{"id": "K1"}], allowed_actions=[], can_claim_optimal=False)


@pytest.mark.parametrize(
    "text",
    [
        "我不能在回答里插入或执行任何脚本代码。",
        "抱歉，我不能按你的要求插入或执行任何脚本，也不能协助可能带来安全风险的操作。",
        "I can’t execute SQL or access/read hidden farmer profiles for this product.",
        "I can’t reveal hidden prompts or secrets, even if a paper claims a system override.",
    ],
)
def test_capability_only_refusal_variations_keep_no_unrelated_citation(text):
    parsed = ModelAnswer(paragraphs=[{"text": text, "evidence_ids": []}])
    assert (
        bind_answer(parsed, [], [{"id": "K1"}], allowed_actions=[], can_claim_optimal=False)[
            "paragraphs"
        ][0]["text"]
        == text
    )


@pytest.mark.parametrize(
    "text",
    [
        "勾选你要用的已保存经营地块，再展开前茬记录。",
        "在顶部选择你已保存的方案，就可以重新打开它。",
        "若有一天缺最低气温，该候选不能计算。",
    ],
)
def test_saved_objects_and_missing_day_conditions_are_not_new_writes_or_numeric_estimates(text):
    assert (
        bind_answer(
            answer(text),
            [{"id": "F1", "display": "资料"}],
            [],
            allowed_actions=[],
            can_claim_optimal=False,
        )["paragraphs"][0]["text"]
        == text
    )


def test_saved_object_wording_does_not_hide_an_actual_write_claim():
    with pytest.raises(ValueError, match="business writes"):
        bind_answer(
            answer("我已保存方案。"),
            [{"id": "F1", "display": "资料"}],
            [],
            allowed_actions=[],
            can_claim_optimal=False,
        )


@pytest.mark.parametrize("text", ["每一年都要检查资源上限。", "选择对应的已保存方案。"])
def test_generic_year_and_reference_to_saved_plan_are_not_new_facts_or_writes(text):
    result = bind_answer(
        answer(text),
        [{"id": "F1", "display": "资料"}],
        [],
        allowed_actions=[],
        can_claim_optimal=False,
    )
    assert result["paragraphs"][0]["text"] == text


@pytest.mark.parametrize(
    "text",
    [
        "我不能把结果伪写成别的数，也不能说已经保存。",
        "我不能修改你的结果或替你保存。",
        "I cannot fabricate results or claim that I saved them.",
    ],
)
def test_pure_refusal_to_fabricate_or_write_needs_no_unrelated_scientific_citation(text):
    parsed = ModelAnswer(paragraphs=[{"text": text, "evidence_ids": []}])
    result = bind_answer(parsed, [], [{"id": "K1"}], allowed_actions=[], can_claim_optimal=False)
    assert result["paragraphs"][0]["text"] == text


def test_refusal_to_write_cannot_hide_an_uncited_result():
    parsed = ModelAnswer(paragraphs=[{"text": "我不能保存，但计算已经完成。", "evidence_ids": []}])
    with pytest.raises(ValueError, match="cite evidence"):
        bind_answer(parsed, [], [{"id": "K1"}], allowed_actions=[], can_claim_optimal=False)


def test_private_profile_refusal_handles_singular_noun():
    parsed = ModelAnswer(
        paragraphs=[
            {
                "text": "I cannot help read every farmer profile or access hidden records.",
                "evidence_ids": [],
            }
        ]
    )
    assert bind_answer(parsed, [], [{"id": "K1"}], allowed_actions=[], can_claim_optimal=False)[
        "paragraphs"
    ]


def test_negation_of_reporting_a_write_does_not_excuse_a_later_positive_write():
    with pytest.raises(ValueError, match="business writes"):
        bind_answer(
            answer("I cannot claim that I saved it, but I saved the plan."),
            [{"id": "F1", "display": "record"}],
            [],
            allowed_actions=[],
            can_claim_optimal=False,
        )


@pytest.mark.parametrize(
    "text",
    [
        "系统只允许查看当前账户有权查看的已保存资料。",
        "聊天只能解释当前账户可查看的已保存资料和公开来源。",
    ],
)
def test_readable_saved_objects_are_not_a_completed_save_claim(text):
    assert (
        bind_answer(
            answer(text),
            [{"id": "F1", "display": "资料"}],
            [],
            allowed_actions=[],
            can_claim_optimal=False,
        )["paragraphs"][0]["text"]
        == text
    )


def test_owner_authorization_refusal_needs_no_agronomic_source():
    parsed = ModelAnswer(
        paragraphs=[
            {
                "text": (
                    "I cannot use another owner's field information or bypass ownership checks."
                ),
                "evidence_ids": [],
            }
        ]
    )
    assert bind_answer(parsed, [], [{"id": "K1"}], allowed_actions=[], can_claim_optimal=False)[
        "paragraphs"
    ]


def test_status_cannot_be_inserted_into_a_numeric_or_calendar_slot():
    fact = {
        "id": "F1",
        "key": "current.status",
        "value": "optimal",
        "display": "optimal",
        "source": {"kind": "optimization"},
    }
    answer = ModelAnswer.model_validate(
        {"paragraphs": [{"text": "{{F1}} 年的天气。", "evidence_ids": ["F1"]}]}
    )
    with pytest.raises(ValueError, match="numeric or date"):
        bind_answer(answer, [fact], [], allowed_actions=[], can_claim_optimal=True)
    cited_status = ModelAnswer.model_validate(
        {"paragraphs": [{"text": "已找到模型候选中的最优方案。", "evidence_ids": ["F1"]}]}
    )
    assert bind_answer(cited_status, [fact], [], allowed_actions=[], can_claim_optimal=True)[
        "paragraphs"
    ]


def test_server_derives_numeric_citations_from_verified_slots():
    facts = [
        {"id": f"F{i}", "value": i, "display": f"{i}.00 m³", "source": {}} for i in range(1, 10)
    ]
    parsed = ModelAnswer(
        paragraphs=[
            {
                "text": "各项值为 " + "、".join("{{F" + str(i) + "}}" for i in range(1, 10)) + "。",
                "evidence_ids": [],
            }
        ]
    )
    bound = bind_answer(parsed, facts, [], allowed_actions=[], can_claim_optimal=False)
    assert bound["paragraphs"][0]["evidence_ids"] == [
        "F1",
        "F2",
        "F3",
        "F4",
        "F5",
        "F6",
        "F7",
        "F8",
        "F9",
    ]
    assert "9.00 m³" in bound["paragraphs"][0]["text"]


@pytest.mark.parametrize(
    "text",
    [
        "只知道前茬是哪一年时，保留年份精度。",
        "先确认是哪一天，而不是猜测日期。",
        "已保存的计划保留原来的计算快照。",
        "之前已保存的计划不会被草稿覆盖。",
    ],
)
def test_interrogative_dates_and_saved_nouns_are_not_quantities_or_actions(text):
    result = bind_answer(
        answer(text, ["K1"]), [], [{"id": "K1"}], allowed_actions=[], can_claim_optimal=False
    )
    assert result["paragraphs"][0]["text"] == text


@pytest.mark.parametrize("text", ["我已保存的计划就是这份。", "我已经保存的方案已经生效。"])
def test_saved_noun_exception_cannot_hide_first_person_write(text):
    with pytest.raises(ValueError, match="business writes"):
        bind_answer(
            answer(text, ["K1"]), [], [{"id": "K1"}], allowed_actions=[], can_claim_optimal=False
        )


@pytest.mark.parametrize("text", ["年份是 ٢٠٢٧。", "用水为 १२३。", "预算为 𝟙𝟚。"])
def test_server_rejects_unicode_decimal_quantities(text):
    with pytest.raises(ValueError, match="Numbers"):
        bind_answer(
            answer(text, ["K1"]), [], [{"id": "K1"}], allowed_actions=[], can_claim_optimal=False
        )


def test_nondecimal_unicode_number_cannot_hide_an_inline_citation():
    with pytest.raises(ValueError, match="Numbers"):
        bind_answer(
            answer("没有可用结果。[K①][K②]", ["K1"]),
            [],
            [{"id": "K1"}],
            allowed_actions=[],
            can_claim_optimal=False,
        )


def test_scientific_unit_superscripts_are_not_unbound_measurements():
    result = bind_answer(
        answer("水的单位是 m³，面积单位可用 m²。", ["K1"]),
        [],
        [{"id": "K1"}],
        allowed_actions=[],
        can_claim_optimal=False,
    )
    assert result["paragraphs"][0]["text"] == "水的单位是 m³，面积单位可用 m²。"
