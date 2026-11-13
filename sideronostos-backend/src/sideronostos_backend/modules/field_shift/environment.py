"""NASA POWER history with strict quality checks and an explicitly synthetic fallback.

Reference ET uses FAO56 equations 21 and 52, with Ra converted from MJ/m²/day
to equivalent evaporation (0.408). Monthly mean temperatures approximate daily
Hargreaves; this is not measured ET or a calibrated irrigation schedule.
"""

import calendar
import hashlib
import json
import math
from datetime import UTC, date, datetime
from typing import Any
from urllib.parse import urlencode

import httpx

from .schemas import Environment, EnvironmentMonth, Evidence

POWER_URL = "https://power.larc.nasa.gov/api/temporal/daily/point"
FAO_URL = "https://www.fao.org/4/x0490e/x0490e07.htm"
METHOD_VERSION = "monthly-hargreaves-v1"


def _validate_location(latitude: float, longitude: float, year: int) -> None:
    if not (math.isfinite(latitude) and -90 <= latitude <= 90):
        raise ValueError("Latitude must be finite and between -90 and 90")
    if not (math.isfinite(longitude) and -180 <= longitude <= 180):
        raise ValueError("Longitude must be finite and between -180 and 180")
    if (
        isinstance(year, bool)
        or not isinstance(year, int)
        or not 1981 <= year < datetime.now(UTC).year
    ):
        raise ValueError("Reference year must be a completed year since 1981")


def estimate_reference_et(
    month: int, tmin: float, tmax: float, latitude: float, year: int
) -> float:
    """Monthly estimated reference ET in mm, using monthly temperature means."""
    if not all(math.isfinite(v) for v in (tmin, tmax, latitude)):
        raise ValueError("Temperature and latitude must be finite")
    if not -90 <= latitude <= 90 or tmax < tmin or not 1 <= month <= 12:
        raise ValueError("Invalid latitude, month or temperature range")
    phi = math.radians(latitude)
    total = 0.0
    for day in range(1, calendar.monthrange(year, month)[1] + 1):
        julian = date(year, month, day).timetuple().tm_yday
        dr = 1 + 0.033 * math.cos(2 * math.pi / 365 * julian)
        declination = 0.409 * math.sin(2 * math.pi / 365 * julian - 1.39)
        sunset = math.acos(max(-1.0, min(1.0, -math.tan(phi) * math.tan(declination))))
        ra = (
            (24 * 60 / math.pi)
            * 0.0820
            * dr
            * (
                sunset * math.sin(phi) * math.sin(declination)
                + math.cos(phi) * math.cos(declination) * math.sin(sunset)
            )
        )
        total += max(0.0, 0.0023 * ((tmin + tmax) / 2 + 17.8) * math.sqrt(tmax - tmin) * ra * 0.408)
    return round(total, 3)


def _parameters(latitude: float, longitude: float, year: int) -> dict[str, str]:
    return {
        "parameters": "T2M_MAX,T2M_MIN,PRECTOTCORR",
        "community": "AG",
        "longitude": str(longitude),
        "latitude": str(latitude),
        "start": f"{year}0101",
        "end": f"{year}1231",
        "format": "JSON",
        "time-standard": "UTC",
    }


def _number(value: Any, *, low: float, high: float, fill: float) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if not math.isfinite(value) or value == fill or not low <= value <= high:
        return None
    return float(value)


def _fingerprint(
    months: list[EnvironmentMonth], latitude: float, longitude: float, year: int, mode: str
) -> str:
    payload = {
        "months": [m.model_dump() for m in months],
        "latitude": latitude,
        "longitude": longitude,
        "year": year,
        "mode": mode,
        "method": METHOD_VERSION,
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def _method_evidence() -> Evidence:
    return Evidence(
        id="climate-reference-et",
        title="FAO56：参考蒸散估算方法",
        url=FAO_URL,
        kind="estimate",
        detail="月均最低/最高气温与纬度用于 Hargreaves 估算；Ra 按逐日天文辐射计算并乘 0.408。"
        "尚未按当地气候校准，不等于 NASA 实测蒸散。方法版本：" + METHOD_VERSION,
    )


def aggregate_power(
    payload: dict[str, Any], latitude: float, longitude: float, reference_year: int
) -> Environment:
    _validate_location(latitude, longitude, reference_year)
    try:
        header = payload["header"]
        if (
            header["start"] != f"{reference_year}0101"
            or header["end"] != f"{reference_year}1231"
            or header["time_standard"] != "UTC"
        ):
            raise ValueError("POWER response date/time mismatch")
        coordinates = payload["geometry"]["coordinates"]
        if not isinstance(coordinates, list) or len(coordinates) < 2:
            raise ValueError("POWER response coordinates must contain longitude and latitude")
        provider_lon, provider_lat = coordinates[:2]
        if any(
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(value)
            for value in (provider_lon, provider_lat)
        ):
            raise ValueError("POWER response coordinates must be finite numbers")
        if not -180 <= provider_lon <= 180 or not -90 <= provider_lat <= 90:
            raise ValueError("POWER response coordinates are out of range")
        if abs(provider_lon - longitude) > 0.0001 or abs(provider_lat - latitude) > 0.0001:
            raise ValueError("POWER response location mismatch")
        for key, unit in (("T2M_MIN", "C"), ("T2M_MAX", "C"), ("PRECTOTCORR", "mm/day")):
            if payload["parameters"][key]["units"] != unit:
                raise ValueError("POWER response units mismatch")
        values = payload["properties"]["parameter"]
        tmin_values, tmax_values, rain_values = (
            values[k] for k in ("T2M_MIN", "T2M_MAX", "PRECTOTCORR")
        )
        if not all(isinstance(v, dict) for v in (tmin_values, tmax_values, rain_values)):
            raise ValueError("POWER daily values must be date-keyed objects")
        fill = float(header.get("fill_value", -999))
    except (KeyError, TypeError, IndexError) as exc:
        raise ValueError("POWER response has an invalid contract") from exc
    months = []
    for month in range(1, 13):
        expected = calendar.monthrange(reference_year, month)[1]
        lows, highs, rains = [], [], []
        valid_days = 0
        for day in range(1, expected + 1):
            key = date(reference_year, month, day).strftime("%Y%m%d")
            low = _number(tmin_values.get(key), low=-100, high=70, fill=fill)
            high = _number(tmax_values.get(key), low=-100, high=70, fill=fill)
            rain = _number(rain_values.get(key), low=0, high=2000, fill=fill)
            if low is not None and high is not None and high < low:
                low, high = None, None
            if low is not None:
                lows.append(low)
            if high is not None:
                highs.append(high)
            if rain is not None:
                rains.append(rain)
            valid_days += int(low is not None and high is not None and rain is not None)
        tmin = round(sum(lows) / expected, 3) if len(lows) == expected else None
        tmax = round(sum(highs) / expected, 3) if len(highs) == expected else None
        et = (
            estimate_reference_et(month, tmin, tmax, latitude, reference_year)
            if tmin is not None and tmax is not None
            else None
        )
        months.append(
            EnvironmentMonth(
                month=month,
                rainfall_mm=round(sum(rains), 3) if len(rains) == expected else None,
                tmin_c=tmin,
                tmax_c=tmax,
                reference_et_mm=et,
                valid_days=valid_days,
                expected_days=expected,
            )
        )
    if not any(m.valid_days for m in months):
        raise ValueError("POWER response contains no usable weather days")
    source_url = f"{POWER_URL}?{urlencode(_parameters(latitude, longitude, reference_year))}"
    limitations = [
        f"{reference_year} 年历史参考数据，只代表该年；不是未来天气预报，也不是多年气候常值。",
        "NASA POWER 气象数据来自区域再分析，约 0.5° × 0.625°，不能代表田块内的土壤或微气候实测。",
        "参考蒸散由月均温度近似估算，尚未当地校准；不包含土壤蓄水、径流、灌溉效率或作物逐阶段系数。",
        "未接入田块土壤检测、卫星植被时序或实际产量记录。",
    ]
    missing = [str(m.month) for m in months if m.valid_days != m.expected_days]
    if missing:
        limitations.append(
            "缺测或无效日期所在月份："
            + "、".join(missing)
            + "；相关月指标保持未知，不插值、不补零。"
        )
    return Environment(
        status="live",
        source_name="NASA POWER · 历史气象",
        source_url=source_url,
        reference_year=reference_year,
        fetched_at=datetime.now(UTC),
        spatial_resolution="气象再分析约 0.5° × 0.625°（非田块分辨率）",
        months=months,
        limitations=limitations,
        evidence=[
            Evidence(
                id="nasa-power-history",
                title=f"NASA POWER {reference_year} 年历史日值",
                url=source_url,
                kind="observation",
                detail=(
                    "T2M_MIN/T2M_MAX（°C）月平均；PRECTOTCORR（mm/day）按完整 UTC 月求和。"
                    "来源为区域再分析。"
                ),
            ),
            _method_evidence(),
        ],
        fingerprint=_fingerprint(months, latitude, longitude, reference_year, "live"),
    )


def demo_environment(
    latitude: float, longitude: float, reference_year: int, reason: str
) -> Environment:
    """A named teaching scenario, never a fallback claim about the requested field."""
    rain = (30, 35, 50, 70, 95, 110, 100, 90, 70, 55, 40, 30)
    lows = (-6, -4, 1, 6, 12, 17, 19, 18, 13, 7, 1, -4)
    months = [
        EnvironmentMonth(
            month=m,
            rainfall_mm=rain[m - 1],
            tmin_c=lows[m - 1],
            tmax_c=lows[m - 1] + 10,
            reference_et_mm=estimate_reference_et(
                m, lows[m - 1], lows[m - 1] + 10, latitude, reference_year
            ),
            valid_days=0,
            expected_days=calendar.monthrange(reference_year, m)[1],
        )
        for m in range(1, 13)
    ]
    return Environment(
        status="demo",
        source_name="合成教学气候 · 非观测",
        source_url=None,
        reference_year=reference_year,
        fetched_at=None,
        spatial_resolution="不适用（合成数据）",
        months=months,
        limitations=[
            "NASA POWER 暂不可用（"
            + reason
            + "）；现使用公开说明的合成教学气候。可点击刷新重新获取。",
            "这组温带月度数值不代表当前位置，也不代表真实历史或未来气候。有效观测日数为 0。",
            "示例参考蒸散按所填纬度计算天文辐射，但输入的月温度和雨量仍是人工假设。",
            "所有基于此气候的方案均为演示。温度/雨量/作物参数需要当地数据校准后才能用于农事决策。",
            "未接入土壤检测、实际产量或田块植被观测；不预测收益或土壤改善幅度。",
        ],
        evidence=[
            Evidence(
                id="synthetic-climate",
                title="合成教学气候 v1",
                url=None,
                kind="demonstration",
                detail="人工设定的 12 个月温度与降水，仅用于演示流程；不是 NASA 数据。",
            ),
            _method_evidence(),
        ],
        fingerprint=_fingerprint(months, latitude, longitude, reference_year, "demo"),
    )


async def fetch_environment(
    latitude: float,
    longitude: float,
    reference_year: int = 2025,
    *,
    client: httpx.AsyncClient | None = None,
) -> Environment:
    _validate_location(latitude, longitude, reference_year)

    async def request(active: httpx.AsyncClient) -> Environment:
        response = await active.get(
            POWER_URL, params=_parameters(latitude, longitude, reference_year)
        )
        response.raise_for_status()
        return aggregate_power(response.json(), latitude, longitude, reference_year)

    try:
        if client is not None:
            return await request(client)
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(12, connect=4), follow_redirects=True
        ) as active:
            return await request(active)
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        reason = "连接超时" if isinstance(exc, httpx.TimeoutException) else "服务或数据质量检查失败"
        return demo_environment(latitude, longitude, reference_year, reason)
