import pytest

from sideronostos_backend.modules.agri_data.schemas import SelectionInput, validate_geometry


def test_point_is_a_point_not_an_invented_field_boundary():
    result = validate_geometry({"type": "Point", "coordinates": [-93.5, 42]})
    assert result["area_ha"] is None
    assert result["center"] == [-93.5, 42]


@pytest.mark.parametrize(
    "geometry",
    [
        {"type": "Point", "coordinates": [181, 42]},
        {"type": "Point", "coordinates": [True, 42]},
        {"type": "Polygon", "coordinates": [[[0, 0], [1, 1], [0, 1], [1, 0], [0, 0]]]},
        {"type": "Polygon", "coordinates": [[[179, 0], [-179, 0], [-179, 1], [179, 0]]]},
        {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1]]]},
    ],
)
def test_invalid_geometry_is_rejected_before_storage(geometry):
    with pytest.raises(ValueError):
        validate_geometry(geometry)


def test_selection_forbids_forged_owner_and_explicit_viewport_is_polygon():
    with pytest.raises(ValueError):
        SelectionInput(
            kind="point",
            revision=1,
            geometry={"type": "Point", "coordinates": [0, 0]},
            owner_user_id="other",
        )
    with pytest.raises(ValueError):
        SelectionInput(
            kind="viewport", revision=1, geometry={"type": "Point", "coordinates": [0, 0]}
        )
    polygon = {
        "type": "Polygon",
        "coordinates": [[[-93.5, 42], [-93.49, 42], [-93.49, 42.01], [-93.5, 42.01], [-93.5, 42]]],
    }
    result = validate_geometry(polygon)
    assert 90 < result["area_ha"] < 95
