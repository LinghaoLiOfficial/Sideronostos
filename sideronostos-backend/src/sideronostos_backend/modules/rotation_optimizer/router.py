import csv
import io
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import Field, StringConstraints
from sqlalchemy.ext.asyncio import AsyncSession

from ..agri_data.service import AgriDataService
from ..auth.dependencies import AuthPrincipal, require_verified_user
from ..database.session import get_session
from .profiles import list_profiles
from .requests import PreflightRequest, RunRequest
from .schemas import Contract
from .service import RotationService
from .settings import get_rotation_settings
from .v3.inputs import PlanningDraft
from .v3.inputs import RunRequest as DailyRunRequest
from .v3.profiles import list_profiles as list_v3_profiles
from .v3.service import readiness as v3_readiness

router = APIRouter(prefix="/rotation-optimizer", tags=["rotation-optimizer"])
User = Annotated[AuthPrincipal, Depends(require_verified_user)]
Session = Annotated[AsyncSession, Depends(get_session)]


class SaveRequest(Contract):
    run_id: str = Field(min_length=1, max_length=100)
    option_id: str = Field(min_length=1, max_length=80)
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
    notes: str = Field(default="", max_length=5000)


class CompareRequest(Contract):
    first_run_id: str
    second_run_id: str
    first_option_id: str
    second_option_id: str


@router.get("/profiles")
async def profiles(user: User) -> dict[str, Any]:
    return {
        "items": list_profiles(),
        "default_profile_id": get_rotation_settings().default_profile_id,
    }


@router.get("/data-releases")
async def data_releases(user: User, session: Session) -> dict[str, Any]:
    return {"items": await AgriDataService().nasa_releases(session, user.id)}


@router.get("/data-releases/{release_id}")
async def data_release(release_id: str, user: User, session: Session) -> dict[str, Any]:
    return await AgriDataService().nasa_release(session, user.id, release_id)


@router.post("/preflight")
async def preflight(body: PreflightRequest, user: User, session: Session) -> dict[str, Any]:
    return await RotationService().preflight(session, user.id, body)


@router.get("/data-releases/{release_id}/availability")
async def data_release_availability(
    release_id: str, user: User, session: Session
) -> dict[str, Any]:
    release = await AgriDataService().nasa_release(session, user.id, release_id)
    return {
        "id": release["id"],
        "model_usable": release["model_usable"],
        "start": release["start"],
        "end": release["end"],
        "bounds": release["bounds"],
        "products": release["products"],
        "evidence_only": release["evidence_only"],
    }


@router.get("/v3/profiles")
async def daily_profiles(user: User) -> dict[str, Any]:
    return {"items": list_v3_profiles()}


@router.post("/v3/readiness")
async def daily_readiness(
    body: PlanningDraft,
    user: User,
    session: Session,
    workspace_owner: Annotated[str | None, Header(alias="X-Workspace-Owner")] = None,
) -> dict[str, Any]:
    if workspace_owner is not None and workspace_owner != user.id:
        raise HTTPException(409, "Workspace account changed; reload the current account")
    return await v3_readiness(session, user.id, body)


@router.post("/v3/runs", status_code=202)
async def create_daily(
    body: DailyRunRequest,
    user: User,
    session: Session,
    workspace_owner: Annotated[str | None, Header(alias="X-Workspace-Owner")] = None,
) -> dict[str, Any]:
    if workspace_owner is not None and workspace_owner != user.id:
        raise HTTPException(409, "Workspace account changed; reload the current account")
    return await RotationService().create_run(session, user.id, body)


@router.post("/runs", status_code=202)
async def create(body: RunRequest, user: User, session: Session) -> dict[str, Any]:
    return await RotationService().create_run(session, user.id, body)


@router.get("/runs")
async def runs(user: User, session: Session) -> dict[str, Any]:
    return {"items": await RotationService().list_runs(session, user.id)}


@router.get("/runs/{run_id}")
async def get(run_id: str, user: User, session: Session) -> dict[str, Any]:
    return await RotationService().get_run(session, user.id, run_id)


@router.get("/runs/{run_id}/export")
async def export(run_id: str, user: User, session: Session) -> dict[str, Any]:
    return await RotationService().get_run(session, user.id, run_id, evidence=True)


@router.get("/runs/{run_id}/export.csv")
async def export_csv(run_id: str, user: User, session: Session) -> Response:
    run = await RotationService().get_run(session, user.id, run_id, evidence=True)
    stream = io.StringIO()
    columns = (
        "run_id",
        "option_id",
        "field_id",
        "crop_id",
        "family",
        "sow_date",
        "harvest_date",
        "occupied_until",
        "water_gap_mm",
        "data_release_id",
        "data_release_sha256",
        "warning",
    )
    writer = csv.DictWriter(stream, fieldnames=columns)
    writer.writeheader()
    result = run.get("result") or {}
    for option in [*(result.get("options") or []), result.get("baseline")]:
        if not option:
            continue
        for season in option.get("seasons", []):
            writer.writerow(
                {
                    **{key: season.get(key) for key in columns if key in season},
                    "run_id": run["id"],
                    "option_id": option["id"],
                    "data_release_id": run["provenance"].get("data_release_id"),
                    "data_release_sha256": run["provenance"].get("data_release_sha256"),
                    "warning": "Historical engineering benchmark; not future planting advice",
                }
            )
    return Response(
        stream.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="rotation-{run_id}.csv"'},
    )


@router.post("/runs/{run_id}/cancel")
async def cancel(run_id: str, user: User, session: Session) -> dict[str, Any]:
    return await RotationService().cancel_run(session, user.id, run_id)


@router.post("/runs/{run_id}/retry", status_code=202)
async def retry(run_id: str, user: User, session: Session) -> dict[str, Any]:
    return await RotationService().retry_run(session, user.id, run_id)


@router.post("/plans", status_code=201)
async def save(body: SaveRequest, user: User, session: Session) -> dict[str, Any]:
    return await RotationService().save_plan(
        session, user.id, body.run_id, body.option_id, body.title.strip(), body.notes
    )


@router.get("/plans")
async def plans(user: User, session: Session) -> dict[str, Any]:
    return {"items": await RotationService().list_plans(session, user.id)}


@router.get("/plans/{plan_id}")
async def plan(plan_id: str, user: User, session: Session) -> dict[str, Any]:
    return await RotationService().get_plan(session, user.id, plan_id)


@router.post("/compare")
async def compare(body: CompareRequest, user: User, session: Session) -> dict[str, Any]:
    a = await RotationService().get_run(session, user.id, body.first_run_id)
    b = await RotationService().get_run(session, user.id, body.second_run_id)
    version_a = a["request"].get("model_version", "rotation-milp-v2.0")
    version_b = b["request"].get("model_version", "rotation-milp-v2.0")
    if version_a != version_b:
        raise HTTPException(422, "Compare results from the same model version")
    if a["id"] == b["id"]:
        raise HTTPException(422, "Select two different completed runs")

    def field_identity(run: dict[str, Any]) -> list[tuple[str, int]]:
        return sorted((f["id"], f["version"]) for f in run["field_snapshots"])

    if (
        field_identity(a) != field_identity(b)
        or any(a["request"][k] != b["request"][k] for k in ("start", "end", "profile_id"))
        or a["provenance"]["weather_sha256"] != b["provenance"]["weather_sha256"]
        or a["provenance"].get("profile_sha256") != b["provenance"].get("profile_sha256")
    ):
        raise HTTPException(
            422, "Runs need matching field versions, horizon, profile and weather release"
        )
    if a["status"] in ("pending", "running", "cancelled", "failed", "timeout_no_solution") or b[
        "status"
    ] in ("pending", "running", "cancelled", "failed", "timeout_no_solution"):
        raise HTTPException(422, "Both runs need completed calculated results")
    choices = []
    for run, option_id in [(a, body.first_option_id), (b, body.second_option_id)]:
        result = run["result"] or {}
        options = [*result.get("options", []), result.get("baseline")]
        option = next((o for o in options if o and o["id"] == option_id), None)
        if option is None or not option.get("complete", True):
            raise HTTPException(422, "Select a complete calculated option in each run")
        choices.append(option)
    daily = version_a == "rotation-milp-v3.0"
    before, after = [o["verification"]["metrics" if daily else "totals"] for o in choices]
    definitions = [
        o.get("objective_definition", run["result"].get("objective_definition", {}))
        for o, run in zip(choices, (a, b), strict=True)
    ]
    weights = [
        definition.get("weights", run["request"]["weights"])
        for definition, run in zip(definitions, (a, b), strict=True)
    ]
    scale_key = "scales" if daily else "references"

    return {
        "first_run_id": a["id"],
        "second_run_id": b["id"],
        "first_option_id": body.first_option_id,
        "second_option_id": body.second_option_id,
        "delta": {
            k: after[k] - before[k] if before[k] is not None and after[k] is not None else None
            for k in before
        },
        "unavailable_metrics": [k for k in before if before[k] is None or after[k] is None],
        "model_version": version_a,
        "input_changes": {
            k: {"before": a["request"][k], "after": b["request"][k]}
            for k in a["request"]
            if k != "idempotency_key" and a["request"][k] != b["request"][k]
        },
        "score_comparable": weights[0] == weights[1]
        and definitions[0].get(scale_key) == definitions[1].get(scale_key),
        "interpretation": (
            "second minus first; estimates under their respective scenarios, not measured outcomes"
        ),
    }
