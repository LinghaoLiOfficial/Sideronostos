#!/usr/bin/env python3
"""Visualize one GRACE Level-2 GSM spherical-harmonic solution."""

from __future__ import annotations

import argparse
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

import matplotlib
import numpy as np
import pyshtools as pysh
from matplotlib.colors import LogNorm, SymLogNorm

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402


HEADER_END = "# End of YAML header"


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
class GraceSolution:
    product_id: str
    title: str
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


def parse_solution(input_path: Path) -> GraceSolution:
    if not input_path.is_file():
        raise FileNotFoundError(f"Input SHM file does not exist: {input_path}")
    text = input_path.read_text(encoding="ascii")
    if HEADER_END not in text:
        raise ValueError(f"Missing header terminator: {HEADER_END}")
    header, record_text = text.split(HEADER_END, maxsplit=1)

    max_degree = int(header_scalar(header, "degree"))
    max_order = int(header_scalar(header, "order"))
    if max_degree < 2 or max_order != max_degree:
        raise ValueError(
            f"Expected equal degree/order of at least 2, got {max_degree}/{max_order}"
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
        for degree in range(2, max_degree + 1)
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

    return GraceSolution(
        product_id=header_scalar(header, "product_id"),
        title=header_scalar(header, "title"),
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


def synthesize(solution: GraceSolution, lmax: int) -> np.ndarray:
    if lmax < 2 or lmax > solution.max_degree:
        raise ValueError(
            f"lmax must be between 2 and {solution.max_degree}, got {lmax}"
        )
    harmonics = pysh.SHCoeffs.from_array(
        solution.coefficients[:, : lmax + 1, : lmax + 1],
        errors=solution.errors[:, : lmax + 1, : lmax + 1],
        error_kind="formal, uncalibrated",
        normalization="4pi",
        csphase=1,
        lmax=lmax,
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
    order = np.argsort(wrapped_longitudes)
    data = data[:, order]
    if not np.all(np.isfinite(data)) or np.ptp(data) == 0:
        raise ValueError("Spherical-harmonic synthesis produced an invalid or empty grid")
    return data


def combined_matrix(values: np.ndarray, lmax: int) -> np.ma.MaskedArray:
    matrix = np.full((lmax + 1, 2 * lmax + 1), np.nan, dtype=np.float64)
    center = lmax
    for degree in range(2, lmax + 1):
        for order in range(degree + 1):
            matrix[degree, center + order] = values[0, degree, order]
            if order > 0:
                matrix[degree, center - order] = values[1, degree, order]
    return np.ma.masked_invalid(matrix)


def degree_rms(values: np.ndarray, lmax: int) -> np.ndarray:
    result = np.full(lmax + 1, np.nan, dtype=np.float64)
    for degree in range(2, lmax + 1):
        power = np.sum(values[:, degree, : degree + 1] ** 2)
        result[degree] = np.sqrt(power / (2 * degree + 1))
    return result


def report(solution: GraceSolution, lmax: int, field: np.ndarray) -> None:
    flags = Counter(record.flags for record in solution.records)
    coefficients = np.concatenate(
        (
            np.abs(solution.coefficients[0][solution.coefficients[0] != 0]),
            np.abs(solution.coefficients[1][solution.coefficients[1] != 0]),
        )
    )
    errors = np.concatenate(
        (
            solution.errors[0][solution.errors[0] != 0],
            solution.errors[1][solution.errors[1] != 0],
        )
    )
    p02, median, p98 = np.percentile(field, [2, 50, 98])
    print(f"Title: {solution.title}")
    print(f"Product: {solution.product_id}")
    print(f"Coverage: {solution.coverage_start} to {solution.coverage_end}")
    print(f"Coefficient epoch: {solution.epoch_start} to {solution.epoch_stop}")
    print(f"Degree/order: {solution.max_degree}/{solution.max_order}; synthesized lmax={lmax}")
    print(f"Normalization: {solution.normalization} (Pyshtools 4pi, csphase=1)")
    print(f"GM: {solution.earth_gravity_param:.10e} m^3/s^2")
    print(f"Reference radius: {solution.reference_radius:.7e} m")
    print(f"Coefficient records: {len(solution.records):,}")
    print("Solution flags: " + ", ".join(f"{key}={value:,}" for key, value in sorted(flags.items())))
    print(
        f"Nonzero |coefficient|: n={coefficients.size:,}, "
        f"range={coefficients.min():.6e} to {coefficients.max():.6e}"
    )
    print(
        f"Nonzero formal sigma (uncalibrated): n={errors.size:,}, "
        f"range={errors.min():.6e} to {errors.max():.6e}"
    )
    print(
        f"Synthesized dimensionless field: shape={field.shape}, "
        f"min={field.min():.6e}, mean={field.mean():.6e}, median={median:.6e}, "
        f"p02={p02:.6e}, p98={p98:.6e}, max={field.max():.6e}"
    )


def render(
    solution: GraceSolution, lmax: int, field: np.ndarray, output_path: Path
) -> None:
    coefficients = combined_matrix(solution.coefficients, lmax)
    formal_errors = combined_matrix(solution.errors, lmax)
    coefficient_nonzero = np.abs(coefficients.compressed())
    coefficient_nonzero = coefficient_nonzero[coefficient_nonzero > 0]
    error_nonzero = formal_errors.compressed()
    error_nonzero = error_nonzero[error_nonzero > 0]
    if coefficient_nonzero.size == 0 or error_nonzero.size == 0:
        raise ValueError("No nonzero coefficients or formal errors to plot")

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
        title=f"Dimensionless spherical-harmonic synthesis (degree 2-{lmax})",
        xlabel="Longitude (degrees)",
        ylabel="Latitude (degrees)",
        xticks=np.arange(-180, 181, 60),
        yticks=np.arange(-90, 91, 30),
    )
    figure.colorbar(
        field_image,
        ax=axes[0, 0],
        label="Dimensionless synthesized field",
        extend="both",
        shrink=0.86,
    )
    axes[0, 0].text(
        0.01,
        0.02,
        "Raw coefficient synthesis; not gravity acceleration or equivalent water height",
        transform=axes[0, 0].transAxes,
        fontsize=8.5,
        bbox={"facecolor": "white", "alpha": 0.78, "edgecolor": "none"},
    )

    coefficient_limit = float(np.max(coefficient_nonzero))
    linthresh = max(float(np.min(coefficient_nonzero)) * 10.0, 1e-12)
    coefficient_image = axes[0, 1].imshow(
        coefficients,
        extent=(-lmax - 0.5, lmax + 0.5, lmax + 0.5, -0.5),
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
        title="Signed fully normalized coefficients",
        xlabel="Signed order (negative: S, nonnegative: C)",
        ylabel="Degree",
    )
    coefficient_ticks = [
        value
        for value in (-1e-4, -1e-6, -1e-8, 0.0, 1e-8, 1e-6, 1e-4)
        if abs(value) <= coefficient_limit
    ]
    figure.colorbar(
        coefficient_image,
        ax=axes[0, 1],
        label="Coefficient value (symmetric log scale)",
        ticks=coefficient_ticks,
        shrink=0.86,
    )

    error_image = axes[1, 0].imshow(
        formal_errors,
        extent=(-lmax - 0.5, lmax + 0.5, lmax + 0.5, -0.5),
        interpolation="nearest",
        aspect="auto",
        cmap="viridis",
        norm=LogNorm(
            vmin=float(np.percentile(error_nonzero, 1)),
            vmax=float(np.percentile(error_nonzero, 99)),
        ),
    )
    axes[1, 0].set(
        title="Formal coefficient standard deviations (uncalibrated)",
        xlabel="Signed order (negative: S, nonnegative: C)",
        ylabel="Degree",
    )
    figure.colorbar(
        error_image,
        ax=axes[1, 0],
        label="Formal standard deviation (log scale)",
        extend="both",
        shrink=0.86,
    )

    degrees = np.arange(2, lmax + 1)
    coefficient_rms = degree_rms(solution.coefficients, lmax)[2:]
    error_rms = degree_rms(solution.errors, lmax)[2:]
    axes[1, 1].plot(
        degrees, coefficient_rms, color="#1d4ed8", linewidth=1.8, label="Coefficient RMS"
    )
    axes[1, 1].plot(
        degrees,
        error_rms,
        color="#dc2626",
        linewidth=1.8,
        label="Formal sigma RMS (uncalibrated)",
    )
    axes[1, 1].set(
        title="Degree-wise RMS amplitude",
        xlabel="Spherical-harmonic degree",
        ylabel="Dimensionless RMS amplitude",
        yscale="log",
        xlim=(2, lmax),
    )
    axes[1, 1].grid(True, which="both", alpha=0.22)
    axes[1, 1].legend(frameon=False)

    coverage_start = solution.coverage_start.split("T", maxsplit=1)[0]
    coverage_end = solution.coverage_end.split("T", maxsplit=1)[0]
    figure.suptitle(
        f"GRACE JPL RL06 Level-2 GSM - spherical-harmonic coefficient diagnostics\n"
        f"{coverage_start} to {coverage_end} | degree/order {solution.max_degree} | "
        f"fully normalized",
        fontsize=15,
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(output_path, dpi=180, bbox_inches="tight", facecolor="white")
    plt.close(figure)
    print(f"Saved visualization: {output_path}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="Input GRACE GSM SHM file")
    parser.add_argument("--output", type=Path, required=True, help="Output PNG path")
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
        field = synthesize(solution, lmax)
        report(solution, lmax, field)
        render(solution, lmax, field, args.output)
    except (OSError, UnicodeError, ValueError) as error:
        raise SystemExit(f"Error: {error}") from error


if __name__ == "__main__":
    main()
