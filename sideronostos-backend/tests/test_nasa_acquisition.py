"""Pure acquisition-contract tests; NASA provider responses are never mocked."""

import hashlib
import json
from datetime import date
from pathlib import Path

import pytest
from pyproj import Transformer
from shapely.geometry import shape
from shapely.ops import transform

from sideronostos_backend.modules.agri_data.acquisition.appeears import (
    bundle_target_path,
    task_payloads,
)
from sideronostos_backend.modules.agri_data.acquisition.budget import (
    BudgetExceeded,
    StorageBudget,
)
from sideronostos_backend.modules.agri_data.acquisition.config import PipelineConfig
from sideronostos_backend.modules.agri_data.acquisition.geometry import generate_fields
from sideronostos_backend.modules.agri_data.acquisition.gpm import _dap4_url
from sideronostos_backend.modules.agri_data.acquisition.manifest import RunManifest, safe_url


def test_appeears_same_name_different_content_is_task_scoped(tmp_path: Path) -> None:
    output = tmp_path / "hls"
    output.mkdir()
    original = output / "README.md"
    original.write_bytes(b"bundle one")
    first_sha = hashlib.sha256(b"bundle one").hexdigest()
    second_sha = hashlib.sha256(b"bundle two").hexdigest()

    assert (
        bundle_target_path(
            output,
            task_id="task-one",
            file_name="README.md",
            file_id="file-one",
            expected_sha256=first_sha,
        )
        == original
    )
    collision = bundle_target_path(
        output,
        task_id="task-two",
        file_name="README.md",
        file_id="file-two",
        expected_sha256=second_sha,
    )
    assert collision == output / "_task_bundles/task-two/file-two/README.md"
    assert original.read_bytes() == b"bundle one"

    collision.parent.mkdir(parents=True)
    collision.write_bytes(b"bundle two")
    assert (
        bundle_target_path(
            output,
            task_id="task-two",
            file_name="README.md",
            file_id="file-two",
            expected_sha256=second_sha,
        )
        == collision
    )


def test_iowa_fields_are_non_overlapping_32_hectare_polygons() -> None:
    payload = generate_fields()
    polygons = [shape(feature["geometry"]) for feature in payload["features"]]
    to_local = Transformer.from_crs("EPSG:4326", "EPSG:26915", always_xy=True).transform
    assert len(polygons) == 4
    assert all(polygon.is_valid for polygon in polygons)
    assert all(31.9 <= transform(to_local, polygon).area / 10_000 <= 32.1 for polygon in polygons)
    assert all(polygons[i].intersection(polygons[j]).area == 0 for i in range(4) for j in range(i))


def test_fixed_window_has_1096_days(tmp_path: Path) -> None:
    config = PipelineConfig(root=tmp_path)
    assert config.start == date(2022, 1, 1)
    assert config.end == date(2024, 12, 31)
    assert config.expected_days == 1096
    assert sum(config.product_budgets.values()) <= config.hard_limit_bytes


def test_budget_fails_before_hard_limit_is_exceeded(tmp_path: Path) -> None:
    root = tmp_path / "run"
    (root / "raw" / "power").mkdir(parents=True)
    (root / "raw" / "power" / "existing").write_bytes(b"1234")
    budget = StorageBudget(
        root=root,
        hard_limit_bytes=10,
        min_free_bytes=0,
        product_limits={"power": 10},
    )
    with pytest.raises(BudgetExceeded, match="hard limit"):
        budget.check(additional_bytes=7, product="power")


def test_manifest_is_idempotent_and_redacts_url_userinfo(tmp_path: Path) -> None:
    path = tmp_path / "run-manifest.json"
    manifest = RunManifest(path, config={"credentials": "suppressed"})
    record = {"key": "one", "url": "https://user:secret@example.test/file?x=1"}
    manifest.add(record)
    manifest.add(record)
    payload = json.loads(path.read_text())
    assert len(payload["records"]) == 1
    assert payload["records"][0]["url"] == "https://example.test/file?x=1"
    assert "secret" not in path.read_text()
    assert safe_url(record["url"]) == "https://example.test/file?x=1"


def test_manifest_drops_presigned_object_credentials() -> None:
    url = "https://example.test/file?version=1&X-Amz-Credential=key&X-Amz-Signature=secret"
    assert safe_url(url) == "https://example.test/file?version=1"


def test_gpm_url_uses_dap4_for_int8_product_variables() -> None:
    assert _dap4_url("https://opendap.example/granule.nc4") == "dap4://opendap.example/granule.nc4"
    with pytest.raises(ValueError, match="HTTPS"):
        _dap4_url("http://opendap.example/granule.nc4")


def test_appeears_tasks_are_partitioned_within_service_limits(tmp_path: Path) -> None:
    fields = generate_fields()
    tasks = task_payloads(PipelineConfig(root=tmp_path), fields)
    assert tasks["smap"]["params"]["dates"] == [
        {"startDate": "01-01-2022", "endDate": "12-31-2024"}
    ]
    assert tasks["hls-l30-2022"]["params"]["dates"] == [
        {"startDate": "01-01-2022", "endDate": "12-31-2022"}
    ]
    assert tasks["ecostress-et-2024-q4"]["params"]["dates"] == [
        {"startDate": "10-01-2024", "endDate": "12-31-2024"}
    ]
    assert len(tasks) == 37
