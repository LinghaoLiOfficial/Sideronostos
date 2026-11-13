"""Scientific QA and map lookup contracts; tiny arrays are synthetic test fixtures."""

import numpy as np
import pytest

from sideronostos_backend.modules.agri_data.adapters.smap_l3 import (
    cell_index,
    moisture_rgba,
    observation_time,
    recommended_mask,
)


def test_quality_requires_range_finite_and_recommended_flags():
    water = np.array([0.2, 0.3, 0.2, 0.1, -9999, 0.51, np.nan, 0.02, 0.50])
    quality = np.array([0, 8, 1, 4, 0, 8, 0, 0, 8])
    assert recommended_mask(water, quality).tolist() == [
        True,
        True,
        False,
        False,
        False,
        False,
        False,
        True,
        True,
    ]


def test_native_cell_lookup_does_not_claim_outside_grid():
    x = np.array([-15.0, -5.0, 5.0, 15.0])
    y = np.array([15.0, 5.0, -5.0, -15.0])
    assert cell_index(x, y, 0.1, -0.1) == (2, 2)
    assert cell_index(x, y, -19.9, 19.9) == (0, 0)
    assert cell_index(x, y, 21, 0) is None
    assert cell_index(x, y, float("nan"), 0) is None


def test_rgba_keeps_missing_cells_transparent_and_values_unmodified():
    values = np.array([[0.02, np.nan], [0.50, 0.26]])
    colors = moisture_rgba(values)
    assert colors.shape == (2, 2, 4)
    assert colors[0, 1, 3] == 0 and colors[0, 0, 3] > 0
    assert colors[1, 0].tolist() != colors[0, 0].tolist()
    assert np.isnan(values[0, 1])


def test_smap_time_uses_noon_epoch_not_midnight():
    assert observation_time(0) == "2000-01-01T12:00:00+00:00"
    assert observation_time(-9999) is None
    assert observation_time(float("nan")) is None
    with pytest.raises(ValueError):
        recommended_mask(np.zeros((2, 2)), np.zeros(3))


def test_grid_coordinates_recover_missing_scan_lines_without_filling_moisture():
    from sideronostos_backend.modules.agri_data.adapters.smap_l3 import INVERSE, grid_centers

    xs = np.array([-15000.0, -5000.0, 5000.0, 15000.0])
    ys = np.array([15000.0, 5000.0, -5000.0, -15000.0])
    lon, lat = INVERSE.transform(*np.meshgrid(xs, ys))
    lat[1, :] = -9999
    lon[:, 2] = -9999
    gx, gy = grid_centers(lat, lon)
    np.testing.assert_allclose(gx, xs, atol=0.001)
    np.testing.assert_allclose(gy, ys, atol=0.001)
