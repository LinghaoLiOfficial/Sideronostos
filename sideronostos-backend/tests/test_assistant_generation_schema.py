import pytest
from pydantic import ValidationError

from sideronostos_backend.modules.farm_assistant import schemas


def payload(text):
    return {
        "paragraphs": [{"text": text, "evidence_ids": ["F1"]}],
        "actions": [],
        "needs_clarification": False,
    }


def test_provider_output_schema_accepts_server_placeholders_but_not_literal_numbers_or_markup():
    valid = schemas.GenerationAnswer.model_validate(payload("估算投入为 {{F1}}。"))
    assert valid.paragraphs[0].text == "估算投入为 {{F1}}。"
    for text in [
        "估算投入为 999 USD。",
        "2027 年有投入。",
        "来自 [K1]。",
        "<script>run()</script>",
    ]:
        with pytest.raises(ValidationError):
            schemas.GenerationAnswer.model_validate(payload(text))


def test_request_schema_only_accepts_fact_placeholders_visible_in_this_context():
    schema = schemas.generation_schema(["F7", "F12"])
    assert schema.model_validate(payload("估算投入为 {{F7}}。")).paragraphs
    for text in ["估算投入为 {{F1}}。", "日期为 {{F120}}。"]:
        with pytest.raises(ValidationError):
            schema.model_validate(payload(text))
    no_facts = schemas.generation_schema([])
    assert no_facts.model_validate(payload("暂时没有可用的估算。")).paragraphs
    with pytest.raises(ValidationError):
        no_facts.model_validate(payload("估算投入为 {{F7}}。"))


@pytest.mark.parametrize("text", ["年份是 ٢٠٢٧。", "用水为 १२३。", "预算为 𝟙𝟚。"])
def test_unicode_decimal_digits_cannot_bypass_server_fact_binding(text):
    for schema in [schemas.GenerationAnswer, schemas.generation_schema(["F1"])]:
        with pytest.raises(ValidationError):
            schema.model_validate(payload(text))


def test_request_schema_rejects_malformed_and_unavailable_citation_ids():
    schema = schemas.generation_schema(["F7"], ["F7", "F8", "K2"])
    for citation in ["F44  ,", 'F44","F45', "K99", "F1", " F7"]:
        data = payload("这是模型估计。")
        data["paragraphs"][0]["evidence_ids"] = [citation]
        with pytest.raises(ValidationError):
            schema.model_validate(data)
    data = payload("估算值是 {{F7}}；计算状态仍需核对。")
    data["paragraphs"][0]["evidence_ids"] = ["K2", "F8"]
    assert schema.model_validate(data).paragraphs
    data["paragraphs"][0]["evidence_ids"] = []
    assert schema.model_validate(data).paragraphs


def test_empty_request_has_no_citation_ids_but_can_refuse_without_evidence():
    schema = schemas.generation_schema([], [])
    data = payload("我不能透露密钥。")
    data["paragraphs"][0]["evidence_ids"] = []
    assert schema.model_validate(data).paragraphs
    data["paragraphs"][0]["evidence_ids"] = ["K1"]
    with pytest.raises(ValidationError):
        schema.model_validate(data)
