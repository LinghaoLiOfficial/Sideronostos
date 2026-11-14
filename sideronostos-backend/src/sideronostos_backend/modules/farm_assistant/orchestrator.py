"""Resolve farmer chat into registered business tools and durable confirmations."""

from __future__ import annotations

import json
import re
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .chat_workflow import _details
from .models import AssistantAction, AssistantMessage, utcnow
from .module_tools import (
    ModuleOperationRequest,
    ModuleOperationService,
    ModuleTool,
    ModuleToolExecutor,
)

ACTIVE = ("needs_input", "awaiting_confirmation")
READ_ONLY_POST = frozenset({
    "preflight_rotation_optimizer_preflight_post",
    "daily_readiness_rotation_optimizer_v3_readiness_post",
    "compare_rotation_optimizer_compare_post",
})
CONFIRM = re.compile(
    r"^(?:yes[, ]*)?(?:confirm|go ahead|do it|proceed)"
    r"(?: this operation)?[.! ]*$|^确认(?:执行)?[。! ]*$",
    re.I,
)
DECLINE = re.compile(
    r"^(?:cancel|stop|no(?:,?\s+(?:do\s+not|don't)\s+"
    r"(?:do|run|create)\s+it)?|取消|不要执行)[.!。 ]*$",
    re.I,
)
REQUEST = re.compile(
    r"^(?:(?:please|can you|could you|would you)\s+)*"
    r"(?:show|list|find|get|check|open|create|add|save|update|edit|cancel|retry|"
    r"export|download|run|compare|sync|generate)\b|"
    r"^(?:请|帮我|查看|列出|查询|创建|新增|保存|修改|取消|重试|导出|比较|运行|生成)",
    re.I,
)
STOPWORDS = {
    "my",
    "the",
    "a",
    "an",
    "me",
    "please",
    "can",
    "you",
    "could",
    "would",
    "saved",
    "all",
    "available",
    "this",
    "for",
    "to",
    "with",
    "of",
    "and",
    "it",
}
SYNONYMS = {
    "show": "list",
    "find": "list",
    "see": "list",
    "add": "create",
    "new": "create",
    "edit": "update",
    "download": "export",
    "generate": "create",
    "查看": "list",
    "列出": "list",
    "新增": "create",
    "修改": "update",
    "导出": "export",
}


def _tokens(value: str) -> set[str]:
    words = re.findall(r"[a-z0-9]+|[\u4e00-\u9fff]+", value.casefold())
    return {SYNONYMS.get(word, word).removesuffix("s") for word in words if word not in STOPWORDS}


def choose_tool(question: str, tools: list[ModuleTool]) -> ModuleTool | None:
    """Offline planner: exact registered IDs or clear imperative title matches."""
    clauses = [part.strip() for part in re.split(r"[.!?;,]+", question) if part.strip()]
    clause = next(
        (
            part
            for part in reversed(clauses)
            if REQUEST.search(part) or any(tool.operation_id in part for tool in tools)
        ),
        "",
    )
    if re.search(r"\b(?:do\s+not|don't|not)\s+(?:run|create|update|call|execute)\b", clause, re.I):
        return None
    direct = [tool for tool in tools if tool.operation_id in clause]
    if len(direct) == 1:
        return direct[0]
    if not REQUEST.search(clause):
        return None
    if re.search(r"\b(?:satellite|remote sensing)\b.*\blayers?\b", clause, re.I):
        return next(
            (tool for tool in tools if tool.operation_id == "layers_agri_data_layers_get"),
            None,
        )
    if re.search(r"\bcrop\s+profiles?\b", clause, re.I) and re.search(
        r"\brotation\b", clause, re.I
    ):
        return next(
            (
                tool for tool in tools
                if tool.operation_id == "profiles_rotation_optimizer_profiles_get"
            ),
            None,
        )
    if re.search(r"\b(?:save|create|mark|pin)\b.*\b(?:point|spot)\b.*\bmap\b", clause, re.I):
        return next(
            (
                tool for tool in tools
                if tool.operation_id == "create_selection_agri_data_selections_post"
            ),
            None,
        )
    if re.search(r"\b(?:rainfall|rain|weather|moisture)\b", clause, re.I) and re.search(
        r"\b(?:facts?|readings?|amount)\b", clause, re.I
    ):
        return next(
            (
                tool for tool in tools
                if tool.operation_id == "facts_agri_data_selections__selection_id__facts_get"
            ),
            None,
        )
    chinese_routes = (
        (r"(?:列出|查看|查询).{0,12}(?:我的|已保存)?地块", "list_fields_field_shift_fields_get"),
        (r"(?:列出|查看|查询).{0,12}(?:我的)?农场", "list_farms_field_shift_farms_get"),
        (r"(?:列出|查看|查询).{0,12}(?:卫星|遥感|地图)?图层", "layers_agri_data_layers_get"),
        (
            r"(?:列出|查看|查询).{0,12}(?:轮作|作物).{0,8}(?:配置|参数)",
            "profiles_rotation_optimizer_profiles_get",
        ),
        (
            r"(?:列出|查看|查询).{0,12}(?:我的)?轮作(?:任务|计算)",
            "runs_rotation_optimizer_runs_get",
        ),
        (r"(?:修改|更新).{0,20}地块", "update_field_field_shift_fields__field_id__patch"),
    )
    for pattern, operation_id in chinese_routes:
        if re.search(pattern, clause):
            return next((tool for tool in tools if tool.operation_id == operation_id), None)
    requested = _tokens(clause)
    ranked: list[tuple[int, ModuleTool]] = []
    for tool in tools:
        title = _tokens(tool.title)
        action = _tokens(
            tool.operation_id.split("_field_shift_")[0]
            .split("_agri_data_")[0]
            .split("_rotation_optimizer_")[0]
        )
        score = len(requested & title) * 2 + len(requested & action)
        if (
            "list" in requested
            and tool.method == "GET"
            and ("list" in title or "{" not in tool.path)
        ):
            score += 2
        if "get" in requested and tool.method == "GET" and "{" in tool.path:
            score += 2
        if "create" in requested and tool.method == "POST" and "create" in title:
            score += 2
        if "profile" in title and re.search(r"\bprofiles?\b", clause, re.I):
            score += 3
        if "daily" in title and "daily" not in requested:
            score -= 3
        if score >= 4:
            ranked.append((score, tool))
    ranked.sort(key=lambda pair: pair[0], reverse=True)
    if not ranked or (len(ranked) > 1 and ranked[0][0] == ranked[1][0]):
        return None
    return ranked[0][1]


def choose_read_bundle(question: str, tools: list[ModuleTool]) -> list[ModuleTool]:
    """The offline planner recognizes a small, explicit cross-domain read bundle."""
    if not REQUEST.search(question.strip()) or not re.search(r"\band\b|和", question, re.I):
        return []
    if re.search(r"\b(?:do\s+not|don't|not)\s+(?:show|list|run)\b|不要", question, re.I):
        return []
    patterns = (
        (r"\bfields?\b|地块", "list_fields_field_shift_fields_get"),
        (r"\b(?:satellite|map)?\s*layers?\b|图层", "layers_agri_data_layers_get"),
        (r"\b(?:crop|rotation)\s+profiles?\b|(?:轮作|作物).{0,8}(?:配置|参数)",
         "profiles_rotation_optimizer_profiles_get"),
        (r"\brotation\s+runs?\b|轮作任务", "runs_rotation_optimizer_runs_get"),
    )
    selected = []
    for pattern, operation_id in patterns:
        if re.search(pattern, question, re.I):
            tool = next((item for item in tools if item.operation_id == operation_id), None)
            if tool is not None and tool.method == "GET" and not tool.path_parameters:
                selected.append(tool)
    return selected if len({item.domain for item in selected}) > 1 else []


def _supplied(question: str, tool: ModuleTool, context: dict[str, Any]) -> dict[str, Any]:
    supplied: dict[str, Any] = {"path_params": {}, "query_params": {}, "body": None}
    start = question.find("{")
    if start >= 0:
        try:
            parsed = json.loads(question[start:])
        except ValueError:
            parsed = None
        if isinstance(parsed, dict):
            if set(parsed) & {"body", "path_params", "query_params"}:
                for key in supplied:
                    if key in parsed:
                        supplied[key] = parsed[key]
            elif tool.body_schema is not None:
                supplied["body"] = parsed
    selected_field: dict[str, Any] | None = None
    for key in tool.path_parameters:
        match = re.search(rf"\b{re.escape(key)}\s*(?:=|:|is)\s*([a-zA-Z0-9-]+)", question, re.I)
        if match:
            supplied["path_params"][key] = match.group(1)
        elif key == "field_id":
            fields = context.get("fields") or []
            matches = [field for field in fields if field["name"].casefold() in question.casefold()]
            if len(matches) == 1:
                supplied["path_params"][key] = matches[0]["id"]
                selected_field = matches[0]
            elif len(fields) == 1 and re.search(r"\b(?:my|this)\s+field\b", question, re.I):
                supplied["path_params"][key] = fields[0]["id"]
                selected_field = fields[0]
        elif key in {"run_id", "plan_id", "analysis_id", "selection_id"}:
            reference = context.get("reference", {})
            value = (
                (reference.get("selection") or {}).get("id")
                if key == "selection_id" else reference.get(key)
            )
            if value:
                supplied["path_params"][key] = value
    if tool.operation_id.startswith("create_selection_") and supplied["body"] is None:
        latitude = re.search(r"\blatitude\s*(?:=|:|is)?\s*(-?\d+(?:\.\d+)?)", question, re.I)
        longitude = re.search(r"\blongitude\s*(?:=|:|is)?\s*(-?\d+(?:\.\d+)?)", question, re.I)
        if latitude and longitude:
            supplied["body"] = {
                "kind": "point",
                "revision": context.get("reference", {}).get("revision", 1),
                "geometry": {
                    "type": "Point",
                    "coordinates": [float(longitude.group(1)), float(latitude.group(1))],
                },
            }
    if tool.path.endswith("/facts") and not supplied["query_params"]:
        dates = re.findall(r"\b\d{4}-\d{2}-\d{2}\b", question)
        if len(dates) == 2:
            supplied["query_params"] = {"start": dates[0], "end": dates[1]}
    if tool.operation_id.startswith("create_field_") and supplied["body"] is None:
        details = _details(question)
        if details:
            supplied["body"] = details
    if tool.operation_id.startswith("update_field_") and selected_field is not None:
        current = {
            key: value for key, value in selected_field.items() if key not in {"id", "version"}
        }
        current["expected_version"] = selected_field["version"]
        supplied["body"] = {**current, **_details(question), **(supplied["body"] or {})}
    return supplied


def _merge(current: dict[str, Any], new: dict[str, Any]) -> dict[str, Any]:
    return {
        "path_params": {**current.get("path_params", {}), **new.get("path_params", {})},
        "query_params": {**current.get("query_params", {}), **new.get("query_params", {})},
        "body": (
            {**(current.get("body") or {}), **new["body"]}
            if isinstance(new.get("body"), dict)
            and isinstance(current.get("body"), (dict, type(None)))
            else new["body"]
            if new.get("body") is not None
            else current.get("body")
        ),
    }


def _reply(
    flow: AssistantAction,
    text: str,
    *,
    title: str,
    outcome: dict[str, Any] | None = None,
    missing: list[str] | None = None,
) -> dict[str, Any]:
    status = flow.status
    href = (outcome or {}).get("href")
    task = {
        "id": flow.id,
        "status": status,
        "operation_id": flow.arguments["operation_id"],
        "title": title,
        "missing_inputs": missing or [],
        "summary": flow.arguments["payload"] if status == "awaiting_confirmation" else None,
        "href": href,
        "result_page_url": (
            f"/si/multi-agent/results/{flow.id}?conversation={flow.conversation_id}"
            if status == "completed"
            else None
        ),
        "preview_url": (
            f"/farm-assistant/conversations/{flow.conversation_id}/previews/{flow.id}"
            if status == "completed"
            else None
        ),
        "refresh_url": (
            f"/farm-assistant/conversations/{flow.conversation_id}/workflows/{flow.id}/refresh"
            if status == "pending"
            else None
        ),
        "execution": outcome,
    }
    return {
        "paragraphs": [{"text": text, "evidence_ids": []}],
        "facts": [],
        "citations": [],
        "actions": [],
        "needs_clarification": status in ACTIVE,
        "retrieval_mode": "registered_tool",
        "task": task,
    }


def _farmer_outcome_text(
    tool: ModuleTool, outcome: dict[str, Any], language: str, question: str = ""
) -> str:
    data = outcome.get("result")
    if outcome.get("status") != "succeeded" or not isinstance(data, dict):
        return str(outcome.get("text", ""))
    if tool.operation_id.startswith("facts_"):
        facts = data.get("facts")
        if not isinstance(facts, list) or not facts:
            return (
                "所选位置和时段没有已发布的观测值。可打开结果页面核对数据覆盖范围。"
                if language == "zh" else
                "I found no published observation for this selected area and period. "
                "Open the result page to check data coverage."
            )
        requested_metric = (
            "rainfall_total" if re.search(r"\brain(?:fall)?\b|降雨|降水", question, re.I)
            else "surface_soil_moisture" if re.search(r"\bmoisture\b|土壤水分", question, re.I)
            else None
        )
        relevant = [fact for fact in facts if fact.get("metric") == requested_metric]
        selected = (relevant or facts)[:3]
        labels = {
            "rainfall_total": ("历史降雨量", "historical rainfall"),
            "reference_et0_total": ("参考蒸散量", "reference evapotranspiration"),
            "surface_soil_moisture": ("地表土壤水分", "surface soil moisture"),
        }
        readings = []
        release_ids = {
            str((fact.get("source") or {}).get("release_id"))
            for fact in selected
            if (fact.get("source") or {}).get("release_id")
        }
        for fact in selected:
            metric = str(fact.get("metric", "observation"))
            label = labels.get(metric, (metric, metric))[0 if language == "zh" else 1]
            period = fact.get("period") or {}
            start, end = period.get("start"), period.get("end")
            when = start if start == end else f"{start} to {end}" if start and end else ""
            value = fact.get("value")
            source_id = (fact.get("source") or {}).get("release_id")
            source_label = f" [{source_id}]" if len(release_ids) > 1 and source_id else ""
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                amount = f"{value:g} {fact.get('unit', '')}".strip()
                reading = f"{when}: {label} {amount}" if when else f"{label} {amount}"
                readings.append(reading + source_label)
            else:
                incomplete = f"{label} data are incomplete"
                reading = f"{when}: {incomplete}" if when else incomplete
                readings.append(reading + source_label)
        synthetic = any(
            str(fact.get("source_kind", "")).startswith("synthetic_test")
            for fact in selected
        )
        multiple = len(release_ids) > 1
        if language == "zh":
            caveat = (
                "这是合成测试数据，并非实时 NASA 观测。"
                if synthetic else "请按来源核对其空间与时间覆盖范围。"
            )
            details = "；".join(readings)
            comparison = "这里有两份发布数据，请先核对采用哪份数据。" if multiple else ""
            return (
                f"所选位置的已发布资料显示：{details}。"
                f"{comparison}{caveat}可打开结果页面查看来源。"
            )
        caveat = (
            "This is synthetic test data, not a live NASA observation. "
            if synthetic else "Check the source's spatial and time coverage. "
        )
        comparison = (
            "These two releases should be checked before choosing a dataset. "
            if multiple else ""
        )
        return (
            f"The published record for this map point shows {'; '.join(readings)}. "
            f"{comparison}{caveat}Open the result page to review the source."
        )
    items = data.get("items")
    if not isinstance(items, list):
        return str(outcome.get("text", ""))
    if not items:
        empty_labels = (
            "saved fields" if tool.operation_id.startswith("list_fields_")
            else "published satellite layers" if tool.operation_id.startswith("layers_")
            else "rotation calculations" if tool.operation_id.startswith("runs_")
            else "records"
        )
        if language == "zh":
            zh_empty = {
                "saved fields": "已保存地块",
                "published satellite layers": "已发布卫星图层",
                "rotation calculations": "轮作计算任务",
                "records": "相关记录",
            }[empty_labels]
            return f"当前账户还没有{zh_empty}。可打开结果页面核对。"
        return f"I found no {empty_labels} in this account yet. Open the result page to check."
    labels: list[str] = []
    seen: set[str] = set()
    for item in items[:5]:
        if isinstance(item, dict):
            label = item.get("name") or item.get("title") or item.get("product") or item.get("id")
        else:
            label = item
        if label is not None:
            rendered = str(label)[:80]
            if rendered in seen and isinstance(item, dict) and item.get("id"):
                rendered += f" ({str(item['id'])[:60]})"
            labels.append(rendered)
            seen.add(str(label)[:80])
    if not labels:
        return str(outcome.get("text", ""))
    if language == "zh":
        zh_nouns = {
            "list_fields_": "地块",
            "list_farms_": "农场",
            "layers_": "图层",
            "runs_": "轮作任务",
            "profiles_": "参数配置",
            "daily_profiles_": "参数配置",
        }
        noun = next(
            (label for prefix, label in zh_nouns.items() if tool.operation_id.startswith(prefix)),
            "结果",
        )
        return f"已查到 {len(items)} 项{noun}：{'、'.join(labels)}。可打开结果页面核对。"
    noun = re.sub(r"^(?:list|show|get)\s+", "", tool.title, flags=re.I).lower()
    if len(items) == 1 and noun.endswith("s"):
        noun = noun[:-1]
    return (
        f"I found {len(items)} {noun}: {', '.join(labels)}. "
        "Open the result page to check the details."
    )


def _input_prompt(tool: ModuleTool, missing: list[str], language: str) -> str:
    key = missing[0].removeprefix("body.")
    names = {
        "field_id": "which saved field you mean",
        "profile_id": "the crop and weather settings profile",
        "field_ids": "the fields to include",
        "kind": "the map selection type and area",
        "geometry": "the mapped area",
        "start_date": "the starting date",
        "end_date": "the ending date",
    }
    action = (
        "start a rotation calculation" if tool.domain == "rotation" and tool.method == "POST"
        else "save a map selection" if tool.domain == "remote_sensing" and tool.method == "POST"
        else "update the field" if tool.domain == "field_management" and tool.method == "PATCH"
        else tool.title.lower()
    )
    if language == "zh":
        zh_names = {
            "field_id": "要操作的已保存地块",
            "profile_id": "作物与天气参数配置",
            "field_ids": "要纳入计算的地块",
            "kind": "地图选区类型和位置",
            "geometry": "地图选区范围",
            "start_date": "开始日期",
            "end_date": "结束日期",
        }
        return f"请补充{zh_names.get(key, key.replace('_', ' '))}；也可以一次告诉我其他相关信息。"
    return (
        f"To {action}, please tell me {names.get(key, key.replace('_', ' '))}. "
        "You can add the other details in the same message."
    )


async def handle_module_chat(
    session: AsyncSession,
    message_id: str,
    app: FastAPI,
    headers: dict[str, str],
    cookies: dict[str, str],
) -> dict[str, Any] | None:
    message = await session.get(AssistantMessage, message_id)
    if message is None:
        return None
    bot_id = message.context_snapshot.get("bot_id")
    preset = message.context_snapshot.get("preset")
    language = message.context_snapshot.get("language", "en")
    if not isinstance(preset, str):
        return None
    if bot_id == "local-knowledge-guide":
        return None
    executor = ModuleToolExecutor(app)
    tools = executor.tools_for(preset)
    flow = await session.scalar(
        select(AssistantAction)
        .where(
            AssistantAction.conversation_id == message.conversation_id,
            AssistantAction.owner_user_id == message.owner_user_id,
            AssistantAction.action == "chat.module.operation",
            AssistantAction.status.in_(ACTIVE),
        )
        .order_by(AssistantAction.created_at.desc())
        .limit(1)
        .with_for_update()
    )
    question = message.text.strip()
    if flow is None:
        if preset == "general":
            bundle = choose_read_bundle(question, tools)
            if bundle:
                replies = []
                for index, item in enumerate(bundle):
                    step = AssistantAction(
                        id=str(uuid4()),
                        conversation_id=message.conversation_id,
                        owner_user_id=message.owner_user_id,
                        idempotency_key=f"chat-bundle-{message.id}-{index}",
                        action="chat.module.operation",
                        status="needs_input",
                        outcome=None,
                        arguments={
                            "operation_id": item.operation_id,
                            "title": item.title,
                            "payload": {"path_params": {}, "query_params": {}, "body": None},
                        },
                        audit_events=[{"at": utcnow().isoformat(), "status": "started"}],
                    )
                    session.add(step)
                    replies.append(await _execute(
                        session, step, item, app, headers, cookies, preset, language
                    ))
                return {
                    "paragraphs": [
                        paragraph for reply in replies for paragraph in reply["paragraphs"]
                    ],
                    "facts": [], "citations": [], "actions": [],
                    "needs_clarification": False, "retrieval_mode": "registered_tool_bundle",
                    "tasks": [reply["task"] for reply in replies],
                }
        tool = choose_tool(question, tools)
        if tool is None:
            return None
        flow = AssistantAction(
            id=str(uuid4()),
            conversation_id=message.conversation_id,
            owner_user_id=message.owner_user_id,
            idempotency_key=f"chat-tool-{message.id}",
            action="chat.module.operation",
            status="needs_input",
            outcome=None,
            arguments={
                "operation_id": tool.operation_id,
                "title": tool.title,
                "payload": {"path_params": {}, "query_params": {}, "body": None},
            },
            audit_events=[{"at": utcnow().isoformat(), "status": "started"}],
        )
        session.add(flow)
    else:
        tool = next(
            (
                candidate
                for candidate in tools
                if candidate.operation_id == flow.arguments.get("operation_id")
            ),
            None,
        )
        if tool is None:
            return None
        if DECLINE.fullmatch(question):
            flow.status = "cancelled"
            flow.updated_at = utcnow()
            await session.commit()
            return _reply(
                flow,
                "已取消这项操作，没有保存新改动。"
                if language == "zh" else "Okay, I cancelled that request. No new change was made.",
                title=tool.title,
            )
        if flow.status == "awaiting_confirmation" and CONFIRM.fullmatch(question):
            return await _execute(session, flow, tool, app, headers, cookies, preset, language)

    context = message.context_snapshot
    if "selection_id" in tool.path_parameters and re.search(
        r"\b(?:this|that|the selected)\s+(?:point|spot|area|selection)\b", question, re.I
    ):
        reference = dict(context.get("reference") or {})
        if not reference.get("selection"):
            prior = (
                await session.scalars(
                    select(AssistantAction)
                    .where(
                        AssistantAction.conversation_id == message.conversation_id,
                        AssistantAction.owner_user_id == message.owner_user_id,
                        AssistantAction.action == "chat.module.operation",
                        AssistantAction.status == "completed",
                    )
                    .order_by(AssistantAction.updated_at.desc())
                    .limit(10)
                )
            ).all()
            saved = next(
                (
                    item for row in prior
                    if row.arguments.get("operation_id", "").startswith("create_selection_")
                    for item in [(row.outcome or {}).get("result")]
                    if isinstance(item, dict) and isinstance(item.get("id"), str)
                ),
                None,
            )
            if saved:
                reference["selection"] = {"id": saved["id"]}
                context = {**context, "reference": reference}
    payload = _merge(flow.arguments["payload"], _supplied(question, tool, context))
    if "idempotency_key" in tool.required_body_parameters:
        body = payload["body"] if isinstance(payload["body"], dict) else {}
        payload["body"] = {**body, "idempotency_key": f"agent-{flow.id}"}
    flow.arguments = {"operation_id": tool.operation_id, "title": tool.title, "payload": payload}
    missing = executor.missing_inputs(
        tool.operation_id,
        preset,
        path_params=payload["path_params"],
        query_params=payload["query_params"],
        body=payload["body"],
    )
    if missing:
        flow.status = "needs_input"
        flow.updated_at = utcnow()
        await session.commit()
        return _reply(
            flow,
            _input_prompt(tool, missing, language),
            title=tool.title,
            missing=missing,
        )
    if tool.method != "GET" and tool.operation_id not in READ_ONLY_POST:
        flow.status = "awaiting_confirmation"
        flow.updated_at = utcnow()
        await session.commit()
        return _reply(
            flow,
            "我已整理下方将执行的具体内容，请确认后再保存。"
            if language == "zh" else
            f"I can {tool.title.lower()} using the details shown below. "
            "Please confirm before I make this change.",
            title=tool.title,
        )
    return await _execute(session, flow, tool, app, headers, cookies, preset, language, question)


async def _execute(
    session: AsyncSession,
    flow: AssistantAction,
    tool: ModuleTool,
    app: FastAPI,
    headers: dict[str, str],
    cookies: dict[str, str],
    preset: str,
    language: str,
    question: str = "",
) -> dict[str, Any]:
    payload = flow.arguments["payload"]
    flow.status = "executing"
    flow.updated_at = utcnow()
    await session.commit()
    outcome = await ModuleOperationService().execute(
        session,
        app,
        flow.owner_user_id,
        flow.conversation_id,
        ModuleOperationRequest(
            operation_id=tool.operation_id,
            path_params=payload["path_params"],
            query_params=payload["query_params"],
            body=payload["body"],
            idempotency_key=f"chat-exec-{flow.id}",
        ),
        headers=headers,
        cookies=cookies,
    )
    flow.status = "completed" if outcome.status == "succeeded" else outcome.status
    flow.outcome = outcome.model_dump(mode="json")
    flow.audit_events = [*flow.audit_events, {"at": utcnow().isoformat(), "status": flow.status}]
    flow.updated_at = utcnow()
    await session.commit()
    return _reply(
        flow,
        _farmer_outcome_text(tool, flow.outcome, language, question),
        title=tool.title,
        outcome=flow.outcome,
    )


async def refresh_module_workflow(
    session: AsyncSession,
    owner_user_id: str,
    conversation_id: str,
    workflow_id: str,
    app: FastAPI,
    headers: dict[str, str],
    cookies: dict[str, str],
) -> dict[str, Any]:
    """Verify an accepted rotation job through its existing owner-scoped GET API."""
    flow = await session.scalar(
        select(AssistantAction)
        .where(
            AssistantAction.id == workflow_id,
            AssistantAction.conversation_id == conversation_id,
            AssistantAction.owner_user_id == owner_user_id,
            AssistantAction.action == "chat.module.operation",
        )
        .with_for_update()
    )
    if flow is None or flow.status not in {"pending", "completed", "failed"}:
        raise HTTPException(404, "Workflow not found")
    outcome = dict(flow.outcome or {})
    tool_id = flow.arguments.get("operation_id", "")
    if flow.status == "pending":
        executor = ModuleToolExecutor(app)
        tool = executor._tools.get(tool_id)
        result = outcome.get("result")
        run_id = result.get("id") if isinstance(result, dict) else None
        if (
            tool is None
            or tool.domain != "rotation"
            or tool.method != "POST"
            or not isinstance(run_id, str)
        ):
            raise HTTPException(422, "This workflow has no registered status check")
        status_tool = next(
            (
                item for item in executor.tools_for("rotation")
                if item.method == "GET" and item.path == "/rotation-optimizer/runs/{run_id}"
            ),
            None,
        )
        if status_tool is None:
            raise HTTPException(422, "The rotation status API is unavailable")
        checked = await executor.execute(
            operation_id=status_tool.operation_id,
            domain="rotation",
            path_params={"run_id": run_id},
            query_params={},
            body=None,
            headers=headers,
            cookies=cookies,
        )
        if not checked.succeeded or not isinstance(checked.data, dict):
            raise HTTPException(502, "The business job status could not be verified")
        business_status = checked.data.get("status")
        if business_status in {
            "completed", "complete", "succeeded", "optimal", "feasible", "infeasible"
        }:
            flow.status = "completed"
            computed = checked.data.get("result")
            options = (computed.get("options") or []) if isinstance(computed, dict) else []
            selected = next(
                (
                    option.get("id") for option in options
                    if isinstance(option, dict) and option.get("feasible")
                ),
                None,
            )
            if (
                isinstance(selected, str)
                and re.fullmatch(r"[A-Za-z0-9_-]{1,80}", selected)
                and outcome.get("href") == f"/field-shift/rotation?run={run_id}"
            ):
                outcome["href"] += f"&option={selected}"
        elif business_status in {"failed", "cancelled", "timeout_no_solution"}:
            flow.status = "failed"
        outcome.update(
            status="succeeded" if flow.status == "completed" else flow.status,
            result=checked.data,
            status_code=checked.status_code,
            content_type=checked.content_type,
        )
        flow.outcome = outcome
        flow.updated_at = utcnow()
        flow.audit_events = [*flow.audit_events, {
            "at": flow.updated_at.isoformat(), "status": business_status or "unknown"
        }]
        await session.commit()
    return _reply(flow, "", title=flow.arguments.get("title", tool_id), outcome=outcome)["task"]
