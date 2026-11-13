#!/usr/bin/env python3
"""Visualize one GRACE-FO Level-2 GAA atmospheric de-aliasing solution."""

from __future__ import annotations

import argparse
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

import matplotlib
import numpy as np
import pyshtools as pysh
from matplotlib.colors import SymLogNorm

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402


HEADER_END = "# End of YAML header"
DEFAULT_LMIN = 2


@dataclass(frozen=True)
class CoefficientRecord:
    degree: int
    order: int
    clm: float
    slm: float
    clm_sigma: float
    slm_sigma: float
    epoch_start: str
    epoch_stop: str
    flags: str


@dataclass(frozen=True)
class GaaSolution:
    product_id: str
    title: str
    summary: str
    product_version: str
    coverage_start: str
    coverage_end: str
    epoch_start: str
    epoch_stop: str
    normalization: str
    earth_gravity_param: float
    reference_radius: float
    max_degree: int
    max_order: int
    records: tuple[CoefficientRecord, ...]
    coefficients: np.ndarray
    errors: np.ndarray


def header_scalar(header: str, key: str) -> str:
    match = re.search(rf"^\s*{re.escape(key)}\s*:\s*(.*?)\s*$", header, re.MULTILINE)
    if not match or not match.group(1):
        raise ValueError(f"Missing header value: {key}")
    return match.group(1)


def nested_numeric_value(header: str, section: str) -> float:
    match = re.search(
        rf"^\s*{re.escape(section)}\s*:\s*$.*?^\s+value\s*:\s*([-+0-9.eE]+)\s*$",
        header,
        re.MULTILINE | re.DOTALL,
    )
    if not match:
        raise ValueError(f"Missing numeric header section: {section}")
    return float(match.group(1))


def parse_record(line: str, line_number: int) -> CoefficientRecord:
    fields = line.split()
    if len(fields) < 10 or fields[0] != "GRCOF2":
        raise ValueError(f"Malformed GRCOF2 record at line {line_number}")
    try:
        record = CoefficientRecord(
            degree=int(fields[1]),
            order=int(fields[2]),
            clm=float(fields[3]),
            slm=float(fields[4]),
            clm_sigma=float(fields[5]),
            slm_sigma=float(fields[6]),
            epoch_start=fields[7],
            epoch_stop=fields[8],
            flags=fields[9],
        )
    except ValueError as error:
        raise ValueError(f"Invalid GRCOF2 value at line {line_number}: {error}") from error
    numeric = np.array(
        [record.clm, record.slm, record.clm_sigma, record.slm_sigma], dtype=float
    )
    if not np.all(np.isfinite(numeric)):
        raise ValueError(f"Non-finite GRCOF2 value at line {line_number}")
    if record.clm_sigma < 0 or record.slm_sigma < 0:
        raise ValueError(f"Negative formal standard deviation at line {line_number}")
    if not re.fullmatch(r"[yn]{4}", record.flags):
        raise ValueError(f"Invalid solution flags at line {line_number}: {record.flags}")
    return record


def parse_solution(input_path: Path) -> GaaSolution:
    if not input_path.is_file():
        raise FileNotFoundError(f"Input SHM file does not exist: {input_path}")
    text = input_path.read_text(encoding="ascii")
    if HEADER_END not in text:
        raise ValueError(f"Missing header terminator: {HEADER_END}")
    header, record_text = text.split(HEADER_END, maxsplit=1)

    max_degree = int(header_scalar(header, "degree"))
    max_order = int(header_scalar(header, "order"))
    if max_degree < DEFAULT_LMIN or max_order != max_degree:
        raise ValueError(
            f"Expected equal degree/order of at least {DEFAULT_LMIN}, "
            f"got {max_degree}/{max_order}"
        )
    normalization = header_scalar(header, "normalization")
    if normalization.lower() != "fully normalized":
        raise ValueError(f"Unsupported normalization: {normalization}")

    records = tuple(
        parse_record(line, line_number)
        for line_number, line in enumerate(record_text.splitlines(), start=1)
        if line.strip()
    )
    expected_indices = {
        (degree, order)
        for degree in range(max_degree + 1)
        for order in range(degree + 1)
    }
    actual_indices = [(record.degree, record.order) for record in records]
    duplicates = [index for index, count in Counter(actual_indices).items() if count > 1]
    if duplicates:
        raise ValueError(f"Duplicate degree/order record(s): {duplicates[:5]}")
    actual_index_set = set(actual_indices)
    missing = sorted(expected_indices - actual_index_set)
    unexpected = sorted(actual_index_set - expected_indices)
    if missing or unexpected:
        details = []
        if missing:
            details.append(f"missing {len(missing)} record(s), first={missing[:5]}")
        if unexpected:
            details.append(f"unexpected {len(unexpected)} record(s), first={unexpected[:5]}")
        raise ValueError("Incomplete coefficient grid: " + "; ".join(details))

    epochs = {(record.epoch_start, record.epoch_stop) for record in records}
    if len(epochs) != 1:
        raise ValueError(f"Inconsistent coefficient epochs: {sorted(epochs)}")
    epoch_start, epoch_stop = next(iter(epochs))

    coefficients = np.zeros((2, max_degree + 1, max_degree + 1), dtype=np.float64)
    errors = np.zeros_like(coefficients)
    for record in records:
        coefficients[0, record.degree, record.order] = record.clm
        coefficients[1, record.degree, record.order] = record.slm
        errors[0, record.degree, record.order] = record.clm_sigma
        errors[1, record.degree, record.order] = record.slm_sigma

    product_id = header_scalar(header, "product_id")
    if product_id != "GAA-2":
        raise ValueError(f"Expected GAA-2 product, got {product_id}")
    return GaaSolution(
        product_id=product_id,
        title=header_scalar(header, "title"),
        summary=header_scalar(header, "summary"),
        product_version=header_scalar(header, "product_version"),
        coverage_start=header_scalar(header, "time_coverage_start"),
        coverage_end=header_scalar(header, "time_coverage_end"),
        epoch_start=epoch_start,
        epoch_stop=epoch_stop,
        normalization=normalization,
        earth_gravity_param=nested_numeric_value(header, "earth_gravity_param"),
        reference_radius=nested_numeric_value(header, "mean_equator_radius"),
        max_degree=max_degree,
        max_order=max_order,
        records=records,
        coefficients=coefficients,
        errors=errors,
    )


def validate_degree_range(solution: GaaSolution, lmin: int, lmax: int) -> None:
    if lmin < DEFAULT_LMIN:
        raise ValueError(
            f"lmin must be at least {DEFAULT_LMIN}; degree 0/1 are excluded from "
            "JPL Level-2 processing"
        )
    if lmax > solution.max_degree:
        raise ValueError(f"lmax must not exceed {solution.max_degree}, got {lmax}")
    if lmin > lmax:
        raise ValueError(f"lmin must not exceed lmax, got {lmin}>{lmax}")


def selected_coefficients(
    solution: GaaSolution, lmin: int, lmax: int
) -> np.ndarray:
    coefficients = solution.coefficients.copy()
    coefficients[:, :lmin, :] = 0.0
    coefficients[:, lmax + 1 :, :] = 0.0
    return coefficients


def synthesize(solution: GaaSolution, lmin: int, lmax: int) -> np.ndarray:
    validate_degree_range(solution, lmin, lmax)
    coefficients = selected_coefficients(solution, lmin, lmax)
    harmonics = pysh.SHCoeffs.from_array(
        coefficients,
        normalization="4pi",
        csphase=1,
        lmax=solution.max_degree,
        units="dimensionless",
        name=solution.product_id,
    )
    grid = harmonics.expand(grid="DH2", lmax=lmax, lmax_calc=lmax, extend=True)
    data = np.asarray(grid.data, dtype=np.float64)
    longitudes = np.asarray(grid.lons(), dtype=np.float64)
    if data.shape[1] != longitudes.size:
        raise ValueError("Synthesized grid longitude dimension mismatch")
    if np.isclose(longitudes[-1], 360.0):
        data = data[:, :-1]
        longitudes = longitudes[:-1]
    wrapped_longitudes = (longitudes + 180.0) % 360.0 - 180.0
    data = data[:, np.argsort(wrapped_longitudes)]
    if not np.all(np.isfinite(data)) or np.ptp(data) == 0:
        raise ValueError("Spherical-harmonic synthesis produced an invalid or empty grid")
    return data


def combined_matrix(
    values: np.ndarray, lmin: int, lmax: int
) -> np.ma.MaskedArray:
    matrix = np.full((lmax - lmin + 1, 2 * lmax + 1), np.nan, dtype=np.float64)
    center = lmax
    for degree in range(lmin, lmax + 1):
        row = degree - lmin
        for order in range(degree + 1):
            matrix[row, center + order] = values[0, degree, order]
            if order > 0:
                matrix[row, center - order] = values[1, degree, order]
    return np.ma.masked_invalid(matrix)


def spectral_components(
    coefficients: np.ndarray, lmin: int, lmax: int
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    degrees = np.arange(lmin, lmax + 1)
    total = np.empty(degrees.size, dtype=np.float64)
    zonal = np.empty_like(total)
    nonzonal = np.empty_like(total)
    power = np.empty_like(total)
    for index, degree in enumerate(degrees):
        denominator = 2 * degree + 1
        total_power = float(
            np.sum(coefficients[:, degree, : degree + 1] ** 2, dtype=np.float64)
        )
        zonal_power = float(coefficients[0, degree, 0] ** 2)
        power[index] = total_power
        total[index] = np.sqrt(total_power / denominator)
        zonal[index] = np.sqrt(zonal_power / denominator)
        nonzonal[index] = np.sqrt(max(total_power - zonal_power, 0.0) / denominator)
    return total, zonal, nonzonal, power


def frequency_bands(lmin: int, lmax: int) -> list[tuple[int, int]]:
    proposed = ((lmin, min(20, lmax)), (max(lmin, 21), min(60, lmax)), (max(lmin, 61), lmax))
    return [(low, high) for low, high in proposed if low <= high]


def band_statistics(
    coefficients: np.ndarray, lmin: int, lmax: int
) -> tuple[list[str], np.ndarray, np.ndarray]:
    _, _, _, degree_power = spectral_components(coefficients, lmin, lmax)
    total_power = float(np.sum(degree_power))
    if total_power <= 0:
        raise ValueError("Selected coefficients have zero spectral power")
    labels: list[str] = []
    rms_values: list[float] = []
    cumulative: list[float] = []
    for low, high in frequency_bands(lmin, lmax):
        degree_slice = slice(low - lmin, high - lmin + 1)
        band_power = float(np.sum(degree_power[degree_slice]))
        coefficient_count = sum(2 * degree + 1 for degree in range(low, high + 1))
        labels.append(f"{low}-{high}")
        rms_values.append(np.sqrt(band_power / coefficient_count))
        cumulative.append(float(np.sum(degree_power[: high - lmin + 1])) / total_power)
    return labels, np.asarray(rms_values), np.asarray(cumulative)


def report(solution: GaaSolution, lmin: int, lmax: int, field: np.ndarray) -> None:
    flags = Counter(record.flags for record in solution.records)
    coefficient_values = np.concatenate(
        (
            np.abs(solution.coefficients[0][solution.coefficients[0] != 0]),
            np.abs(solution.coefficients[1][solution.coefficients[1] != 0]),
        )
    )
    nonzero_errors = int(np.count_nonzero(solution.errors))
    excluded = [record for record in solution.records if record.degree < DEFAULT_LMIN]
    labels, band_rms, cumulative = band_statistics(
        solution.coefficients, lmin, lmax
    )
    p02, median, p98 = np.percentile(field, [2, 50, 98])

    print(f"Title: {solution.title}")
    print(f"Product: {solution.product_id}; version={solution.product_version}")
    print(f"Coverage: {solution.coverage_start} to {solution.coverage_end}")
    print(f"Coefficient epoch: {solution.epoch_start} to {solution.epoch_stop}")
    print(
        f"File degree/order: {solution.max_degree}/{solution.max_order}; "
        f"synthesized range={lmin}-{lmax}"
    )
    print(f"Normalization: {solution.normalization} (Pyshtools 4pi, csphase=1)")
    print(f"GM: {solution.earth_gravity_param:.10e} m^3/s^2")
    print(f"Reference radius: {solution.reference_radius:.7e} m")
    print(f"Coefficient records: {len(solution.records):,}")
    print("Solution flags: " + ", ".join(f"{key}={value:,}" for key, value in sorted(flags.items())))
    print(
        "Degree 0/1 records excluded from synthesis: "
        + "; ".join(
            f"({record.degree},{record.order}) C={record.clm:.6e}, S={record.slm:.6e}"
            for record in excluded
        )
    )
    print(
        f"Nonzero |coefficient|: n={coefficient_values.size:,}, "
        f"range={coefficient_values.min():.6e} to {coefficient_values.max():.6e}"
    )
    print(
        f"Formal standard deviations: nonzero={nonzero_errors:,}; "
        "all-zero values are treated as unavailable, not zero uncertainty"
    )
    for label, rms_value, fraction in zip(labels, band_rms, cumulative, strict=True):
        print(
            f"Degree band {label}: RMS={rms_value:.6e}; "
            f"cumulative spectral power={fraction * 100.0:.3f}%"
        )
    print(
        f"Synthesized dimensionless field: shape={field.shape}, "
        f"min={field.min():.6e}, mean={field.mean():.6e}, median={median:.6e}, "
        f"p02={p02:.6e}, p98={p98:.6e}, max={field.max():.6e}"
    )


def render(
    solution: GaaSolution,
    lmin: int,
    lmax: int,
    field: np.ndarray,
    output_path: Path,
) -> None:
    selected = selected_coefficients(solution, lmin, lmax)
    matrix = combined_matrix(selected, lmin, lmax)
    nonzero = np.abs(matrix.compressed())
    nonzero = nonzero[nonzero > 0]
    if nonzero.size == 0:
        raise ValueError("No nonzero coefficients to plot")
    total_rms, zonal_rms, nonzonal_rms, _ = spectral_components(
        selected, lmin, lmax
    )
    labels, band_rms, cumulative = band_statistics(selected, lmin, lmax)
    degrees = np.arange(lmin, lmax + 1)

    figure, axes = plt.subplots(2, 2, figsize=(16, 10.5), layout="constrained")

    field_limit = float(np.percentile(np.abs(field), 98))
    if field_limit == 0:
        field_limit = float(np.max(np.abs(field)))
    field_image = axes[0, 0].imshow(
        field,
        extent=(-180, 180, -90, 90),
        origin="upper",
        interpolation="nearest",
        aspect="auto",
        cmap="RdBu_r",
        vmin=-field_limit,
        vmax=field_limit,
    )
    axes[0, 0].set(
        title=f"Non-tidal atmospheric anomaly synthesis (degree {lmin}-{lmax})",
        xlabel="Longitude (degrees)",
        ylabel="Latitude (degrees)",
        xticks=np.arange(-180, 181, 60),
        yticks=np.arange(-90, 91, 30),
    )
    figure.colorbar(
        field_image,
        ax=axes[0, 0],
        label="Dimensionless atmospheric geopotential contribution",
        extend="both",
        shrink=0.86,
    )
    axes[0, 0].text(
        0.01,
        0.02,
        "Relative to 2003-2014 mean; not GSM or equivalent water height",
        transform=axes[0, 0].transAxes,
        fontsize=8.5,
        bbox={"facecolor": "white", "alpha": 0.78, "edgecolor": "none"},
    )

    coefficient_limit = float(np.max(nonzero))
    linthresh = max(float(np.percentile(nonzero, 1)), 1e-18)
    matrix_image = axes[0, 1].imshow(
        matrix,
        extent=(-lmax - 0.5, lmax + 0.5, lmax + 0.5, lmin - 0.5),
        interpolation="nearest",
        aspect="auto",
        cmap="coolwarm",
        norm=SymLogNorm(
            linthresh=linthresh,
            linscale=1.0,
            vmin=-coefficient_limit,
            vmax=coefficient_limit,
            base=10,
        ),
    )
    axes[0, 1].set(
        title="Signed fully normalized GAA coefficients",
        xlabel="Signed order (negative: S, nonnegative: C)",
        ylabel="Degree",
    )
    coefficient_ticks = [
        value
        for value in (-1e-10, -1e-12, -1e-14, 0.0, 1e-14, 1e-12, 1e-10)
        if abs(value) <= coefficient_limit
    ]
    figure.colorbar(
        matrix_image,
        ax=axes[0, 1],
        label="Coefficient value (symmetric log scale)",
        ticks=coefficient_ticks,
        shrink=0.86,
    )

    axes[1, 0].plot(degrees, total_rms, color="#1d4ed8", linewidth=1.8, label="Total RMS")
    axes[1, 0].plot(degrees, zonal_rms, color="#dc2626", linewidth=1.4, label="Zonal RMS")
    axes[1, 0].plot(
        degrees, nonzonal_rms, color="#059669", linewidth=1.4, label="Non-zonal RMS"
    )
    axes[1, 0].set(
        title="Degree-wise coefficient spectrum",
        xlabel="Spherical-harmonic degree",
        ylabel="Dimensionless RMS amplitude",
        xlim=(lmin, lmax),
        yscale="log",
    )
    axes[1, 0].grid(True, which="both", alpha=0.22)
    axes[1, 0].legend(frameon=False)

    positions = np.arange(len(labels))
    axes[1, 1].bar(positions, band_rms, color=("#2563eb", "#0d9488", "#7c3aed")[: len(labels)])
    axes[1, 1].set(
        title="Degree-band contribution",
        xlabel="Degree band",
        ylabel="Band RMS amplitude",
        xticks=positions,
        xticklabels=labels,
        yscale="log",
    )
    axes[1, 1].grid(axis="y", which="both", alpha=0.22)
    cumulative_axis = axes[1, 1].twinx()
    cumulative_axis.plot(
        positions,
        cumulative * 100.0,
        color="#ea580c",
        marker="o",
        linewidth=1.8,
        label="Cumulative spectral power",
    )
    cumulative_axis.set_ylabel("Cumulative spectral power (%)", color="#ea580c")
    cumulative_axis.set_ylim(0, 105)
    cumulative_axis.tick_params(axis="y", colors="#ea580c")
    cumulative_axis.legend(loc="lower right", frameon=False)
    for position, fraction in zip(positions, cumulative, strict=True):
        cumulative_axis.annotate(
            f"{fraction * 100.0:.2f}%",
            (position, fraction * 100.0),
            xytext=(0, 7),
            textcoords="offset points",
            ha="center",
            color="#9a3412",
            fontsize=8.5,
        )

    coverage_start = solution.coverage_start.split("T", maxsplit=1)[0]
    coverage_end = solution.coverage_end.split("T", maxsplit=1)[0]
    figure.suptitle(
        f"GRACE-FO JPL RL{solution.product_version} GAA-2 - non-tidal atmospheric de-aliasing field\n"
        f"{coverage_start} to {coverage_end} | degree {lmin}-{lmax} | fully normalized",
        fontsize=15,
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(output_path, dpi=180, bbox_inches="tight", facecolor="white")
    plt.close(figure)
    print(f"Saved visualization: {output_path}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="Input GRACE-FO GAA SHM file")
    parser.add_argument("--output", type=Path, required=True, help="Output PNG path")
    parser.add_argument(
        "--lmin",
        type=int,
        default=DEFAULT_LMIN,
        help="Minimum synthesis degree (default: 2)",
    )
    parser.add_argument(
        "--lmax",
        type=int,
        default=None,
        help="Maximum synthesis degree (default: file maximum)",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    try:
        solution = parse_solution(args.input)
        lmax = solution.max_degree if args.lmax is None else args.lmax
        validate_degree_range(solution, args.lmin, lmax)
        field = synthesize(solution, args.lmin, lmax)
        report(solution, args.lmin, lmax, field)
        render(solution, args.lmin, lmax, field, args.output)
    except (OSError, UnicodeError, ValueError) as error:
        raise SystemExit(f"Error: {error}") from error


if __name__ == "__main__":
    main()
