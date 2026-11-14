import pytest
from fastapi import FastAPI, Request
from pydantic import BaseModel

from sideronostos_backend.core.application import create_app as create_product_app
from sideronostos_backend.modules.farm_assistant.module_tools import ModuleToolExecutor


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


def test_product_openapi_catalog_covers_every_operation_in_the_three_operational_modules():
    executor = ModuleToolExecutor(create_product_app())
    counts = {domain: len(executor.tools_for(domain)) for domain in (
        "field_management", "remote_sensing", "rotation", "local_agriculture"
    )}
    assert counts == {
        "field_management": 14,
        "remote_sensing": 6,
        "rotation": 19,
        "local_agriculture": 0,
    }
    assert all(
        tool.title
        for domain in ("field_management", "remote_sensing", "rotation")
        for tool in executor.tools_for(domain)
    )
    assert all(tool.body_schema is None or isinstance(tool.body_schema, dict)
               for domain in ("field_management", "remote_sensing", "rotation")
               for tool in executor.tools_for(domain))


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
                        [] if kind == "array" else {} if kind == "object"
                        else False if kind == "boolean" else 1 if kind in {"integer", "number"}
                        else "sample"
                    )
            path_params = {name: "1" for name in tool.path_parameters}
            query_params = {name: "sample" for name in tool.required_query_parameters}
            assert executor.missing_inputs(
                tool.operation_id, domain,
                path_params=path_params, query_params=query_params, body=body,
            ) == []
            result = await executor.execute(
                operation_id=tool.operation_id, domain=domain,
                path_params=path_params, query_params=query_params,
                body=body, headers={}, cookies={},
            )
            assert result.status_code == 200, tool.operation_id
            assert result.data["method"] == tool.method
            assert result.data["path"].startswith(tool.path.split("{")[0])
            observed.append(tool.operation_id)
    assert len(observed) == 39
