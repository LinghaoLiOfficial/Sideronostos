from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator

Topic = Literal["soil_water", "crop", "rotation"]
AccessScope = Literal[
    "full_text", "web_snapshot", "abstract_only", "bibliographic_only", "product_help"
]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class SourceSpec(Contract):
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,80}$")
    title: str = Field(min_length=1, max_length=500)
    url: HttpUrl
    doi: str | None = None
    reader_file: str
    asset_group: Literal["library", "prepared"] = "library"
    locator_type: Literal["pdf_page", "section"] = "pdf_page"
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    access_scope: AccessScope
    allowed_pages: list[int] = Field(default_factory=list)
    topics: list[Topic] = Field(min_length=1)
    regions: list[str] = Field(min_length=1)
    crops: list[str] = Field(default_factory=list)
    product: str | None = None
    product_version: str | None = None
    year: int | None = None
    limitations: list[str] = Field(min_length=1)
    disposition: Literal["include", "excluded"] = "include"
    exclusion_reason: str | None = None

    @model_validator(mode="after")
    def scope(self) -> Self:
        if self.access_scope in ("abstract_only", "bibliographic_only") and not self.allowed_pages:
            raise ValueError("Restricted access requires reviewed allowed_pages")
        if any(p < 1 for p in self.allowed_pages) or len(set(self.allowed_pages)) != len(
            self.allowed_pages
        ):
            raise ValueError("Pages must be unique, positive PDF page numbers")
        if self.disposition == "excluded" and not self.exclusion_reason:
            raise ValueError("Excluded source requires a reason")
        return self


class ChunkSpec(Contract):
    id: str
    source_id: str
    page: int
    ordinal: int
    text: str
    text_sha256: str
    access_scope: AccessScope


class ClaimSpec(Contract):
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,100}$")
    source_id: str
    statement: str = Field(min_length=10, max_length=1600)
    evidence_chunk_ids: list[str] = Field(min_length=1)
    applicability: list[str] = Field(min_length=1)
    limitations: list[str] = Field(min_length=1)
    topics: list[Topic] = Field(min_length=1)
    stance: Literal["supports", "qualifies", "counterevidence", "definition"] = "qualifies"
    executable_parameter: bool = False

    @model_validator(mode="after")
    def no_automatic_parameter(self) -> Self:
        if self.executable_parameter:
            raise ValueError("Knowledge claims are not executable agronomy parameters")
        return self
