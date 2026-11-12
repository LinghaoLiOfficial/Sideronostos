from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import AuthPrincipal, require_verified_user
from ..database.session import get_session
from .schemas import SelectionInput
from .service import AgriDataService

router = APIRouter(prefix="/agri-data", tags=["agri-data"])
User = Annotated[AuthPrincipal, Depends(require_verified_user)]
Session = Annotated[AsyncSession, Depends(get_session)]


@router.post("/selections", status_code=201)
async def create_selection(body: SelectionInput, user: User, session: Session) -> dict[str, Any]:
    return await AgriDataService().create_selection(session, user.id, body)


@router.get("/selections/{selection_id}")
async def get_selection(selection_id: str, user: User, session: Session) -> dict[str, Any]:
    return await AgriDataService().get_selection(session, user.id, selection_id)


@router.get("/selections/{selection_id}/facts")
async def facts(
    selection_id: str,
    user: User,
    session: Session,
    start: date | None = None,
    end: date | None = None,
    expected_revision: int | None = None,
) -> dict[str, Any]:
    return await AgriDataService().facts(
        session, user.id, selection_id, start=start, end=end, expected_revision=expected_revision
    )


@router.get("/layers")
async def layers(user: User, session: Session) -> dict[str, Any]:
    return {"items": await AgriDataService().layers(session, user.id)}


@router.get("/layers/{layer_id}/manifest")
async def manifest(layer_id: str, user: User, session: Session) -> dict[str, Any]:
    return await AgriDataService().layer_manifest(session, user.id, layer_id)


@router.get("/layers/{layer_id}/tiles/{z}/{x}/{y}")
async def tile(layer_id: str, z: int, x: int, y: int, user: User, session: Session) -> Response:
    data = await AgriDataService().tile(session, user.id, layer_id, z, x, y)
    return Response(
        data, media_type="image/png", headers={"Cache-Control": "private, max-age=3600"}
    )
