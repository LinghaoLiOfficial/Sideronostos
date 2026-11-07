from copy import deepcopy
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException

from sideronostos_backend.modules.workspace_files import router


def document():
    return {"version": 1, "entries": [{"id": "word", "word": "run", "senses": [
        {"id": "sense", "definition": "跑步", "partOfSpeech": "动词", "examples": [
            {"id": "example", "text": "I run every day."}
        ]}
    ]}]}


def test_vocabulary_type_and_empty_and_complete_documents():
    assert router.FileCreate(name="词汇库", type="vocabulary").type == "vocabulary"
    assert router._valid_file_content("vocabulary", {"version": 1, "entries": []})
    assert router._valid_file_content("vocabulary", document())
    assert router._valid_file_content("vocabulary", {"version": 1, "entries": [
        {"id": "word", "word": "run", "senses": []}
    ]})
    value = document()
    value["entries"][0]["senses"][0]["examples"] = []
    assert router._valid_file_content("vocabulary", value)
    assert not router._valid_file_content("mindmap", document())
    assert not router._valid_file_content("vocabulary", {"version": 2, "tree": {}})


@pytest.mark.parametrize("change", [
    lambda d: d.update(version=True),
    lambda d: d.update(version=2),
    lambda d: d.update(entries={}),
    lambda d: d["entries"][0].update(word="  "),
    lambda d: d["entries"][0].update(id=""),
    lambda d: d["entries"][0].update(senses=None),
    lambda d: d["entries"][0]["senses"][0].update(definition=""),
    lambda d: d["entries"][0]["senses"][0].update(partOfSpeech="自定义"),
    lambda d: d["entries"][0]["senses"][0].update(examples="sentence"),
    lambda d: d["entries"][0]["senses"][0]["examples"][0].update(text=1),
    lambda d: d["entries"][0]["senses"][0]["examples"][0].update(text="\n"),
    lambda d: d["entries"][0]["senses"][0]["examples"][0].update(id="word"),
])
def test_rejects_invalid_vocabulary_content(change):
    value = deepcopy(document())
    change(value)
    assert not router._valid_file_content("vocabulary", value)


@pytest.mark.asyncio
@pytest.mark.parametrize("organization", ["personal-1", "group-1"])
async def test_create_and_save_vocabulary_in_each_file_space(monkeypatch, organization):
    permission = AsyncMock()
    monkeypatch.setattr(router, "_permission", permission)
    monkeypatch.setattr(router, "record_audit", AsyncMock())
    session = Mock(commit=AsyncMock(), refresh=AsyncMock(), scalar=AsyncMock())
    user = SimpleNamespace(id="user-1")
    now = datetime.now(UTC)

    def add(item):
        item.id = "file-1"
        item.created_at = item.updated_at = now
        session.scalar.return_value = item

    session.add.side_effect = add
    created = await router.create_file(organization, router.FileCreate(name="  词汇库  ", type="vocabulary"), user, session)
    assert created["name"] == "词汇库"
    assert created["content"] == {"version": 1, "entries": []}
    permission.assert_awaited_with(session, user, organization, "workspace_files:write")
    updated = await router.update_file(organization, "file-1", router.FilePatch(content=document()), user, session)
    assert updated["content"] == document()
    fetched = await router.get_file(organization, "file-1", user, session)
    assert fetched["content"] == document()
    permission.assert_awaited_with(session, user, organization, "workspace_files:read")
    with pytest.raises(HTTPException) as error:
        await router.update_file(organization, "file-1", router.FilePatch(content={"version": 1}), user, session)
    assert error.value.status_code == 422
    assert session.scalar.return_value.content == document()


@pytest.mark.asyncio
async def test_file_lookup_is_scoped_to_organization_and_permissions(monkeypatch):
    permission = AsyncMock()
    monkeypatch.setattr(router, "_permission", permission)
    session = Mock(scalar=AsyncMock(return_value=None))
    user = SimpleNamespace(id="user-1")
    with pytest.raises(HTTPException) as error:
        await router.get_file("other-group", "file-1", user, session)
    assert error.value.status_code == 404
    query = session.scalar.call_args.args[0]
    params = query.compile().params
    assert "other-group" in params.values()
    assert "file-1" in params.values()
    assert "deleted_at IS NULL" in str(query)
    session.scalar.reset_mock()
    permission.side_effect = HTTPException(status_code=403, detail="Permission denied")
    with pytest.raises(HTTPException) as error:
        await router.get_file("other-group", "file-1", user, session)
    assert error.value.status_code == 403
    session.scalar.assert_not_awaited()
