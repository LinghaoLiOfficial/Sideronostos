import re
from datetime import date
from typing import Annotated, Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, create_model, model_validator

Identifier = Annotated[str, Field(min_length=1, max_length=100)]
Language = Literal["zh", "en"]
Detail = Literal["brief", "detailed"]
Action = Literal["open_planner", "edit_conditions", "choose_field", "view_sources"]
Intent = Literal["learn", "explain_current", "guide", "compare_runs", "what_if_request"]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class SelectionRef(Contract):
    id: Identifier
    revision: int = Field(strict=True, ge=1)


class FieldRef(Contract):
    id: Identifier
    expected_version: int = Field(strict=True, ge=1)


class DateWindow(Contract):
    start: date
    end: date

    @model_validator(mode="after")
    def ordered(self) -> Self:
        if not 0 <= (self.end - self.start).days <= 1095:
            raise ValueError("Date window must be ordered and at most three years")
        return self


class DraftSummary(Contract):
    dirty: bool = False
    changed_fields: list[
        Literal[
            "dates",
            "crops",
            "sowing_windows",
            "farm_limits",
            "field_limits",
            "weights",
            "scenario",
            "baseline",
            "fields",
        ]
    ] = Field(default_factory=list, max_length=10)


class ContextRef(Contract):
    revision: int = Field(strict=True, ge=1)
    page: Literal["map", "rotation", "v1"]
    selection: SelectionRef | None = None
    dates: DateWindow | None = None
    fields: list[FieldRef] = Field(default_factory=list, max_length=10)
    run_id: Identifier | None = None
    option_id: Identifier | None = None
    compare_run_id: Identifier | None = None
    compare_option_id: Identifier | None = None
    analysis_id: Identifier | None = None
    draft: DraftSummary = Field(default_factory=DraftSummary)

    @model_validator(mode="after")
    def relations(self) -> Self:
        if self.run_id and self.analysis_id:
            raise ValueError("Choose a v1 analysis or a versioned optimization run")
        if self.option_id and not (self.run_id or self.analysis_id):
            raise ValueError("Option requires its run or analysis")
        if self.compare_run_id and (
            not self.run_id or not self.option_id or not self.compare_option_id
        ):
            raise ValueError("Comparison requires explicit options in two runs")
        if self.compare_option_id and not self.compare_run_id:
            raise ValueError("Comparison option requires a run")
        if len({f.id for f in self.fields}) != len(self.fields):
            raise ValueError("Duplicate field context")
        return self


class ConversationCreate(Contract):
    preset: Literal["rotation"] = "rotation"
    language: Language = "zh"
    detail: Detail = "brief"


class MessageCreate(Contract):
    client_message_id: str = Field(min_length=8, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
    context: ContextRef


class Paragraph(Contract):
    text: str = Field(min_length=1, max_length=1200)
    evidence_ids: list[str] = Field(default_factory=list, max_length=8)


class ModelAnswer(Contract):
    paragraphs: list[Paragraph] = Field(min_length=1, max_length=5)
    actions: list[Action] = Field(default_factory=list, max_length=2)
    needs_clarification: bool = False


class GenerationParagraph(Contract):
    # Sent to the provider's strict structured-output decoder as well as checked
    # locally. Stored/rendered answers still use Paragraph, which contains values.
    text: str = Field(
        min_length=1,
        max_length=1200,
        pattern=r"^(?:[^\d{}<>]|\{\{F[0-9]+\}\})+$",
        description=(
            "Farmer-friendly prose. Numbers and dates only as provided {{F...}} "
            "placeholders. No inline citation IDs or markup."
        ),
    )
    evidence_ids: list[str] = Field(default_factory=list, max_length=8)


class GenerationAnswer(Contract):
    paragraphs: list[GenerationParagraph] = Field(min_length=1, max_length=5)
    actions: list[Action] = Field(default_factory=list, max_length=2)
    needs_clarification: bool = False


def fact_is_renderable(fact: dict[str, Any]) -> bool:
    """Only quantities and calendar values may occupy a numeric output slot.

    Categorical statuses and unavailable values remain citable evidence, but must
    be explained in prose rather than mistaken for a year or a measured quantity.
    """
    value = fact.get("value")
    return (isinstance(value, (int, float)) and not isinstance(value, bool)) or (
        isinstance(value, str)
        and re.fullmatch(r"[0-9]{4}(?:-[0-9]{2}-[0-9]{2})?", value) is not None
    )


def generation_schema(fact_ids: list[str]) -> type[BaseModel]:
    """Constrain numeric slots to facts actually visible in this request.

    Empty contexts cannot produce placeholders. Binding still checks source IDs,
    meaning and permissions after decoding; the schema does not establish support.
    """
    alternatives = "|".join(re.escape("{{" + fid + "}}") for fid in sorted(set(fact_ids)))
    pattern = r"^(?:[^\d{}<>]" + ("|" + alternatives if alternatives else "") + r")+$"
    paragraph_type = create_model(
        "ContextGenerationParagraph",
        __base__=GenerationParagraph,
        text=(str, Field(min_length=1, max_length=1200, pattern=pattern)),
    )
    return create_model(
        "ContextGenerationAnswer",
        __base__=GenerationAnswer,
        paragraphs=(list[paragraph_type], Field(min_length=1, max_length=5)),  # type: ignore[valid-type]
    )


class PreferenceInput(Contract):
    language: Language = "zh"
    detail: Detail = "brief"
