import pytest
from fastapi import FastAPI, Request, Response
from pydantic import BaseModel

from sideronostos_backend.core.application import create_app as create_product_app
from sideronostos_backend.modules.farm_assistant.module_tools import ModuleToolExecutor
from sideronostos_backend.modules.farm_assistant.orchestrator import (
    _farmer_outcome_text,
    choose_tool,
)


class FieldInput(BaseModel):
    name: str


def create_app():
    app = FastAPI()

    @app.get("/field-shift/fields/{field_id}", operation_id="get_field")
    async def get_field(field_id: str):
        return {"id": field_id, "name": "North field"}

    @app.post("/field-shift/fields", operation_id="create_field")
    async def create_field(body: FieldInput):
        return {"id": "field-1", "name": body.name}

    @app.get("/agri-data/layers", operation_id="list_layers")
    async def list_layers():
        return {"items": ["layer-1"]}

    @app.post("/rotation-optimizer/runs", operation_id="create_run")
    async def create_run():
        return {"id": "run-1"}

    @app.get("/unrelated/private", operation_id="unrelated")
    async def unrelated():
        return {"secret": True}

    return app


@pytest.mark.asyncio
async def test_module_tools_are_catalogued_by_domain_and_execute_only_registered_api_routes():
    app = create_app()
    executor = ModuleToolExecutor(app)

    assert {tool.operation_id for tool in executor.tools_for("field_management")} == {
        "get_field",
        "create_field",
    }
    assert {tool.operation_id for tool in executor.tools_for("remote_sensing")} == {"list_layers"}
    assert {tool.operation_id for tool in executor.tools_for("rotation")} == {"create_run"}
    assert executor.tools_for("local_agriculture") == []
    assert {tool.operation_id for tool in executor.tools_for("general")} == {
        "get_field",
        "create_field",
        "list_layers",
        "create_run",
    }

    result = await executor.execute(
        operation_id="get_field",
        domain="field_management",
        path_params={"field_id": "field-1"},
        query_params={},
        body=None,
        headers={},
        cookies={},
    )
    assert result.status_code == 200
    assert result.data == {"id": "field-1", "name": "North field"}
    assert result.href == "/field-shift?field=field-1&step=field"


@pytest.mark.asyncio
async def test_module_tool_executor_rejects_unknown_routes_and_missing_path_parameters():
    executor = ModuleToolExecutor(create_app())

    with pytest.raises(ValueError, match="not available"):
        await executor.execute(
            operation_id="unrelated",
            domain="field_management",
            path_params={},
            query_params={},
            body=None,
            headers={},
            cookies={},
        )

    with pytest.raises(ValueError, match="Missing path parameters"):
        await executor.execute(
            operation_id="get_field",
            domain="field_management",
            path_params={},
            query_params={},
            body=None,
            headers={},
            cookies={},
        )


@pytest.mark.asyncio
async def test_registered_image_tool_preserves_the_real_png_result():
    app = FastAPI()
    image = b"\x89PNG\r\n\x1a\n" + b"tile"

    @app.get("/agri-data/layers/{layer_id}/tiles/{z}/{x}/{y}", operation_id="tile")
    async def tile(layer_id: str, z: int, x: int, y: int):
        return Response(content=image, media_type="image/png")

    result = await ModuleToolExecutor(app).execute(
        operation_id="tile",
        domain="remote_sensing",
        path_params={"layer_id": "sample", "z": 1, "x": 2, "y": 3},
        query_params={},
        body=None,
        headers={},
        cookies={},
    )
    assert result.content_type.startswith("image/png")
    assert result.data == {"image_base64": "iVBORw0KGgp0aWxl"}


def test_product_openapi_catalog_covers_every_operation_in_the_three_operational_modules():
    executor = ModuleToolExecutor(create_product_app())
    counts = {
        domain: len(executor.tools_for(domain))
        for domain in ("field_management", "remote_sensing", "rotation", "local_agriculture")
    }
    assert counts == {
        "field_management": 14,
        "remote_sensing": 6,
        "rotation": 19,
        "local_agriculture": 0,
    }
    assert len(executor.tools_for("general")) == 39
    assert all(
        tool.title
        for domain in ("field_management", "remote_sensing", "rotation")
        for tool in executor.tools_for(domain)
    )
    assert all(
        tool.body_schema is None or isinstance(tool.body_schema, dict)
        for domain in ("field_management", "remote_sensing", "rotation")
        for tool in executor.tools_for(domain)
    )


def test_offline_tool_planner_honors_action_clauses_and_negation():
    tools = ModuleToolExecutor(create_product_app()).tools_for("general")
    assert choose_tool("What is soil moisture?", tools) is None
    assert choose_tool("Do not run create_field_field_shift_fields_post", tools) is None
    selected = choose_tool(
        "I don't want soil analysis. Please update North field area to 5 hectares.", tools
    )
    assert selected is not None
    assert selected.operation_id == "update_field_field_shift_fields__field_id__patch"
    assert choose_tool(
        "Could you show the satellite layers we have around the farm?", tools
    ).operation_id == "layers_agri_data_layers_get"
    assert choose_tool(
        "Please list the crop profiles I can use for a rotation plan.", tools
    ).operation_id == "profiles_rotation_optimizer_profiles_get"
    rotation = ModuleToolExecutor(create_product_app()).tools_for("rotation")
    assert choose_tool("Please list the crop profiles I can plan with.", rotation).operation_id == (
        "profiles_rotation_optimizer_profiles_get"
    )
    assert choose_tool(
        "Please create a new rotation run for next season.", rotation
    ).operation_id == ("create_rotation_optimizer_runs_post")


def test_field_list_reply_uses_a_farmer_readable_singular_label():
    tool = next(
        item for item in ModuleToolExecutor(create_product_app()).tools_for("field_management")
        if item.operation_id == "list_fields_field_shift_fields_get"
    )
    answer = _farmer_outcome_text(
        tool,
        {"status": "succeeded", "result": {"items": [{"name": "West meadow"}]}},
        "en",
    )
    assert answer.startswith("I found 1 field: West meadow.")
    zh_answer = _farmer_outcome_text(
        tool,
        {"status": "succeeded", "result": {"items": [{"name": "西边地块"}]}},
        "zh",
    )
    assert zh_answer.startswith("已查到 1 项地块：西边地块。")
    empty = _farmer_outcome_text(
        tool, {"status": "succeeded", "result": {"items": []}}, "en"
    )
    assert empty.startswith("I found no saved fields")


def test_chinese_farmer_requests_select_only_tools_allowed_to_the_bot():
    executor = ModuleToolExecutor(create_product_app())
    assert choose_tool("请列出我的地块", executor.tools_for("field_management")).operation_id == (
        "list_fields_field_shift_fields_get"
    )
    assert choose_tool("请查看卫星图层", executor.tools_for("remote_sensing")).operation_id == (
        "layers_agri_data_layers_get"
    )
    assert choose_tool("请列出我的轮作任务", executor.tools_for("rotation")).operation_id == (
        "runs_rotation_optimizer_runs_get"
    )
    assert choose_tool("请列出我的地块", executor.tools_for("rotation")) is None


@pytest.mark.asyncio
async def test_every_registered_operation_dispatches_with_its_openapi_input_shape_offline():
    """Exercise all 39 transport contracts; business responses are simulated."""
    product = create_product_app()
    stub = FastAPI()

    @stub.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    async def accepted(request: Request, path: str):
        return {"method": request.method, "path": "/" + path}

    stub.openapi = product.openapi  # type: ignore[method-assign]
    executor = ModuleToolExecutor(stub)
    observed = []
    for domain in ("field_management", "remote_sensing", "rotation"):
        for tool in executor.tools_for(domain):
            props = (tool.body_schema or {}).get("properties", {})
            body = None
            if tool.body_schema is not None:
                body = {}
                for name in tool.required_body_parameters:
                    shape = props.get(name, {})
                    kind = shape.get("type")
                    body[name] = (
                        []
                        if kind == "array"
                        else {}
                        if kind == "object"
                        else False
                        if kind == "boolean"
                        else 1
                        if kind in {"integer", "number"}
                        else "sample"
                    )
            path_params = {name: "1" for name in tool.path_parameters}
            query_params = {name: "sample" for name in tool.required_query_parameters}
            assert (
                executor.missing_inputs(
                    tool.operation_id,
                    domain,
                    path_params=path_params,
                    query_params=query_params,
                    body=body,
                )
                == []
            )
            result = await executor.execute(
                operation_id=tool.operation_id,
                domain=domain,
                path_params=path_params,
                query_params=query_params,
                body=body,
                headers={},
                cookies={},
            )
            assert result.status_code == 200, tool.operation_id
            assert result.data["method"] == tool.method
            assert result.data["path"].startswith(tool.path.split("{")[0])
            observed.append(tool.operation_id)
    assert len(observed) == 39
