from sideronostos_backend.modules.workspace_files.router import (
    FileCreate,
    _default_mindmap,
    _valid_file_content,
    _valid_gantt_snapshot,
)


def test_default_mindmap_uses_file_name_as_root_topic() -> None:
    document = _default_mindmap("产品路线图")

    assert document["tree"]["nodes"]["root"]["text"] == "产品路线图"


def test_gantt_snapshot_requires_task_and_edge_arrays() -> None:
    assert _valid_gantt_snapshot({"taskData": [], "edgeData": []})
    assert not _valid_gantt_snapshot({"taskData": []})
    assert not _valid_gantt_snapshot({"taskData": {}, "edgeData": []})


def test_workspace_file_types_include_gantt_projects() -> None:
    assert FileCreate(name="Roadmap", type="gantt").type == "gantt"


def test_file_content_validation_is_type_specific() -> None:
    assert _valid_file_content("mindmap", {"version": 2, "tree": {}})
    assert not _valid_file_content("mindmap", {"taskData": [], "edgeData": []})
    assert _valid_file_content("gantt", {"taskData": [], "edgeData": []})
    assert not _valid_file_content("gantt", {"version": 2, "tree": {}})
    assert not _valid_file_content("markdown", {"taskData": [], "edgeData": []})
