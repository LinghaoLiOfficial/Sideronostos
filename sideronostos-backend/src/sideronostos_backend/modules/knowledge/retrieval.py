"""Bilingual lexical terms and deterministic reciprocal rank fusion."""

import logging
import re
from collections import defaultdict

import jieba  # type: ignore[import-untyped]

jieba.setLogLevel(logging.ERROR)
STOP_WORDS = frozenset(
    (
        "the a an and or is are of to in for with what how why can does do "
        "我 的 了 是 和 与 怎么 什么 为什么 请"
    ).split()
)


def tokenize(text: str) -> list[str]:
    # Only word tokens enter the parameterized websearch query; raw query operators are discarded.
    terms = [token.casefold() for token in jieba.cut(text[:200000], HMM=False)]
    return [
        token
        for token in terms
        if re.fullmatch(r"[\w\u3400-\u9fff]+", token)
        and token not in STOP_WORDS
        and not token.isdecimal()
    ]


def fuse_rankings(*rankings: list[str], limit: int = 8) -> list[str]:
    scores: dict[str, float] = defaultdict(float)
    for ranking in rankings:
        for rank, identifier in enumerate(dict.fromkeys(ranking), 1):
            scores[identifier] += 1.0 / (60 + rank)
    return sorted(scores, key=lambda item: (-scores[item], item))[:limit]
