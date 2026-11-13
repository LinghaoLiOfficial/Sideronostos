import re
from typing import Any

from .schemas import Intent


def classify(question: str, context: dict[str, Any]) -> Intent:
    text = question.casefold()
    if re.search(
        r"哪里|怎么填|如何保存|单位|如何选择|how (?:do|can) i|where (?:do|can)|how to|"
        r"(?:计算|任务).{0,20}(?:失败|中断|报错|超时).{0,12}(?:怎么办|如何|怎么)|"
        r"(?:calculation|job|run).{0,25}(?:fails?|error|interrupted).{0,35}(?:retry|restart)|"
        r"(?:what can i do|what should i do).{0,40}(?:calculation|job|error)",
        text,
    ):
        return "guide"
    if re.search(
        r"修改|改小|重算|减少|降低预算|what if|recalculat|change.*(?:budget|rain|water)", text
    ) and not context.get("comparison"):
        return "what_if_request"
    if context.get("comparison") or re.search(r"两次|两个 run|between.*runs|compare.*runs", text):
        return "compare_runs"
    if re.search(
        r"轮作是什么|为什么.*(?:不同科|轮换|间隔)|什么是|what is|why.*rotation|can.*guarantee", text
    ):
        return "learn"
    if context.get("run") or context.get("v1_analysis") or context.get("selection"):
        return "explain_current"
    if re.search(r"这个方案|这里|this (?:plan|field)|当前方案", text):
        return "explain_current"
    return "learn"


def retrieval_sources(question: str, intent: Intent) -> list[str] | None:
    if intent in ("guide", "what_if_request") or re.search(r"积温|\bgdd\b", question, re.I):
        return ["HELPV2"]
    return None


def retrieval_query(question: str) -> str:
    """Bridge farmer vocabulary to related English terms in the released library.

    This expands retrieval only; it never changes the user's question or adds facts.
    No source IDs, result expectations or evaluation-case IDs are embedded here.
    """
    if re.search(r"争水|竞争.{0,6}水|水分.{0,6}竞争|耗尽.{0,6}水", question):
        crop = "legume " if re.search(r"豆科|豆类", question) else ""
        return (
            question
            + " "
            + crop
            + "cover crop soil water depletion water competition subsequent crop"
        )
    return question
