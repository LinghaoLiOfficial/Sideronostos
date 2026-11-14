"""Pure calculations for the non-AppEEARS analysis path."""

from datetime import date, timedelta

from sideronostos_backend.modules.agri_data.acquisition.analysis import aggregate_weather


def test_weather_aggregation_reports_gaps_without_filling_them() -> None:
    start, end = date(2022, 1, 1), date(2022, 1, 31)
    power_rows = [
        {
            "date": (start + timedelta(days=offset)).isoformat(),
            "tmin_c": "0",
            "tmax_c": "10",
            "et0_mm": "1",
        }
        for offset in range(31)
        if offset != 4
    ]
    gpm_rows = [
        {
            "date": (start + timedelta(days=offset)).isoformat(),
            "longitude": longitude,
            "latitude": "42.0",
            "rain_mm": "2",
        }
        for offset in range(31)
        if offset != 9
        for longitude in (-93.55, -93.45)
    ]

    monthly, annual, coverage = aggregate_weather(power_rows, gpm_rows, start, end)

    assert monthly[0]["power_days"] == 30
    assert monthly[0]["gpm_days"] == 30
    assert monthly[0]["tmean_c"] == 5
    assert monthly[0]["et0_mm"] is None
    assert monthly[0]["rain_mm"] is None
    assert annual[0]["rain_mm"] is None
    assert coverage["gpm_cells_per_day"] == 2
    assert coverage["gpm_days_with_full_grid"] == 30


def test_weather_aggregation_uses_spatial_mean_per_gpm_day() -> None:
    day = date(2022, 1, 1)
    power_rows = [{"date": day.isoformat(), "tmin_c": "2", "tmax_c": "8", "et0_mm": "3"}]
    gpm_rows = [
        {"date": day.isoformat(), "longitude": str(index), "latitude": "42", "rain_mm": str(value)}
        for index, value in enumerate((1, 3))
    ]

    monthly, _, _ = aggregate_weather(power_rows, gpm_rows, day, day)

    assert monthly[0]["rain_mm"] == 2
    assert monthly[0]["rain_minus_et0_mm"] == -1
