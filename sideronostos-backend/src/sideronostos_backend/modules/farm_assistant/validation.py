"""Server-owned number binding and source/action validation before any answer is shown."""

import re
import unicodedata
from typing import Any

from .schemas import ModelAnswer, fact_is_renderable

PLACEHOLDER = re.compile(r"\{\{(F\d+)\}\}")
NUMERIC = re.compile(
    r"\d|百分之|[零〇一二两三四五六七八九十百千万]+(?:成|倍|吨|公顷|亩|毫米|立方米|公里|年|月|天|日|小时|人日|元|美元|摄氏度)"
)


def affirmed(pattern: str, text: str) -> bool:
    # A negation in a different sentence or before a contrast cannot excuse a claim.
    clauses = re.split(
        r"[。！？!?；;\n]|(?<![0-9])\.(?:\s|$)|但是|不过|然而|但|\bbut\b|\bhowever\b",
        text,
        flags=re.I,
    )
    for clause in clauses:
        for match in re.finditer(pattern, clause, re.I):
            prefix = clause[max(0, match.start() - 24) : match.start()].lower()
            negated_report = re.search(
                r"(?:cannot|can.t|won.t|不能|无法|不会)[^。.!?;；]{0,80}"
                r"(?:claim|say|声称|说)(?: that)?\s*$",
                clause[: match.start()],
                re.I,
            )
            if not negated_report and not re.search(
                r"不能|没有|尚未|并未|未|不要|不是|不代表|不保证|无法|不可|拒绝|"
                r"\bnot\b|\bnever\b|\bcannot\b|can.t|don.t|\bno\b",
                prefix,
            ):
                return True
    return False


def pure_capability_refusal(text: str) -> bool:
    # Only a narrow capability-only refusal may omit citations. Mixed farming
    # claims still need evidence, even when the paragraph starts with a refusal.
    if not re.search(
        r"密钥|提示词|脚本|代码|数据库|私有|结果|保存|修改|伪写|其他(?:用户|农户|账户)|"
        r"\bsql\b|scripts?|prompts?|secrets?|credentials|profiles?|API keys?|"
        r"fabricate|results?|save|ownership checks|another owner",
        text,
        re.I,
    ):
        return False
    # No uncited agronomic or numerical assertion can be hidden in a refusal.
    if re.search(
        r"产量|增产|利润|土壤|轮作|灌溉|豌豆|豆类|yield|profit|soil|water|crop", text, re.I
    ):
        return False
    parts = [
        p.strip()
        for p in re.split(
            r"[。.!！？?；;]|但是|不过|然而|但|\bbut\b|\bhowever\b",
            text,
            flags=re.I,
        )
        if p.strip()
    ]
    return bool(parts) and all(
        re.match(
            r"(?:抱歉[，, ]*|Sorry[, ]+)?(?:我|我们)?(?:不能|无法|不会)|"
            r"I (?:cannot|can['’]t|won['’]t)\b",
            p,
            re.I,
        )
        for p in parts
    )


def has_unbound_number(text: str) -> bool:
    # Relative dates and the botanical adjective 'annual' are not quantities.
    text = re.sub(r"[上下同这那每哪]一(?:年|月|天|日)|一年生", "", text)
    text = re.sub(r"(?:若|如果).{0,18}(?:有|任何|任意)一天(?=缺|没有|未)", "", text)
    # Superscripts in metric units express dimensions, not supplied quantities.
    # Other numeric symbols (for example circled citation digits) cannot evade
    # binding merely because they are not decimal digits.
    text = re.sub(r"(?<=m)[²³]", "", text)
    return bool(NUMERIC.search(text)) or any(unicodedata.category(ch) == "No" for ch in text)


def bind_answer(
    answer: ModelAnswer,
    facts: list[dict[str, Any]],
    knowledge: list[dict[str, Any]],
    *,
    allowed_actions: list[str],
    can_claim_optimal: bool,
) -> dict[str, Any]:
    values = {f["id"]: f for f in facts}
    sources = {k["id"] for k in knowledge} | set(values)
    if not set(answer.actions) <= set(allowed_actions):
        raise ValueError("Action not available in this context")
    paragraphs = []
    for paragraph in answer.paragraphs:
        raw = paragraph.text
        refs = PLACEHOLDER.findall(raw)
        if not set(refs) <= values.keys():
            raise ValueError("Unknown numeric fact reference")
        if any(not fact_is_renderable(values[ref]) for ref in refs):
            raise ValueError("Placeholder requires a numeric or date fact")
        # A validated slot already names its source fact unambiguously. Derive
        # its citation here instead of asking the model to repeat the same ID.
        evidence_ids = list(dict.fromkeys([*paragraph.evidence_ids, *refs]))
        if not set(paragraph.evidence_ids) <= sources:
            raise ValueError("Unknown evidence reference")
        if (
            sources
            and not evidence_ids
            and not answer.needs_clarification
            and not pure_capability_refusal(raw)
        ):
            raise ValueError("Factual paragraphs must cite evidence")
        remainder = PLACEHOLDER.sub("", raw)
        if has_unbound_number(remainder):
            raise ValueError("Numbers must come from server-bound facts")
        if re.search(r"<[^>]*>|https?://|javascript:|\{\{|\}\}", remainder, re.I):
            raise ValueError("Unexpected markup, URL or placeholder")
        if affirmed(
            r"(?:我|我们|助手)(?:现在|刚刚|刚才|今天)?已(?:经)?(?:保存|修改|重算|运行|执行)",
            remainder,
        ):
            raise ValueError("Assistant cannot claim business writes")
        write_claim_text = re.sub(
            r"已(?:经)?保存的(?:经营地块|地块|方案|计划|记录|资料)", "", remainder
        )
        write_claim_text = re.sub(
            r"(?:(?:选择|勾选|查看|打开)(?:你要用的|对应的|你|用户的|农户的|的)?|你)"
            r"已保存的?(?:经营地块|地块|方案|计划|记录|资料)",
            "",
            write_claim_text,
        )
        if affirmed(
            r"已(?:经)?(?:保存|修改|重算|运行|执行)|"
            r"I (?:have )?(?:saved|updated|changed|executed|ran)",
            write_claim_text,
        ):
            raise ValueError("Assistant cannot claim business writes")
        if affirmed(
            r"保证.{0,10}(?:增产|利润|收益)|guarantee(?:d)?\s+(?:higher\s+)?(?:yield|profit)",
            remainder,
        ):
            raise ValueError("Unsupported agricultural guarantee")
        if any(
            f.get("source", {}).get("model_version") == "rotation-milp-v3.0"
            and f["source"].get("implementation_ready") is False
            for f in facts
        ) and affirmed(
            r"已具备实施条件|可直接实施|可以直接实施|ready to implement|ready for implementation",
            remainder,
        ):
            raise ValueError("Unsupported farm implementation readiness claim")
        if not can_claim_optimal and affirmed(r"最优|\boptimal\b", remainder):
            raise ValueError("Unsupported optimality claim")
        rendered = PLACEHOLDER.sub(lambda m: str(values[m.group(1)]["display"]), raw)
        paragraphs.append({"text": rendered, "evidence_ids": evidence_ids})
    return {
        "paragraphs": paragraphs,
        "actions": list(dict.fromkeys(answer.actions)),
        "needs_clarification": answer.needs_clarification,
    }
