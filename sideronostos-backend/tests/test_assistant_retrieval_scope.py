from sideronostos_backend.modules.farm_assistant import intents


def test_product_algorithm_questions_use_the_implemented_method_not_arbitrary_agronomy():
    assert intents.retrieval_sources("什么是积温 GDD？缺温度怎么办？", "learn") == ["HELPV2"]
    assert intents.retrieval_sources("水、预算和劳力的单位分别是什么？", "guide") == ["HELPV2"]
    assert intents.retrieval_sources("SMAP 能看清小块田吗？", "learn") is None
    assert intents.retrieval_sources("豆科前茬会影响后茬吗？", "learn") is None


def test_water_competition_expansion_preserves_unrelated_queries():
    from sideronostos_backend.modules.farm_assistant.intents import retrieval_query

    for question in ["豆科会不会和后茬争水？", "覆盖作物会竞争土壤水分吗？"]:
        query = retrieval_query(question)
        assert (
            query.startswith(question)
            and "soil water depletion" in query
            and "subsequent crop" in query
        )
    assert retrieval_query("在哪里填前茬？") == "在哪里填前茬？"
    assert retrieval_query("当前方案投入是多少？") == "当前方案投入是多少？"


def test_failed_calculation_questions_retrieve_product_recovery_steps():
    for question in [
        "What can I do when calculation fails?",
        "The job was interrupted; how should I retry it?",
        "计算失败了怎么办？",
        "任务中断后怎么重试？",
    ]:
        intent = intents.classify(question, {"run": {"status": "failed"}})
        assert intent == "guide"
        assert intents.retrieval_sources(question, intent) == ["HELPV2"]
    assert intents.classify("Why did my crop fail?", {}) == "learn"
