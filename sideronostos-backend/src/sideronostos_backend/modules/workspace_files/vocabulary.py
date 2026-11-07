from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

PartOfSpeech = Literal[
    "名词", "动词", "形容词", "副词", "代词", "数词", "量词",
    "介词", "连词", "助词", "冠词", "感叹词", "其他",
]


class VocabularyObject(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")

    @field_validator("*", mode="after")
    @classmethod
    def nonempty_text(cls, value: Any) -> Any:
        if isinstance(value, str) and not value.strip():
            raise ValueError("Text must not be blank")
        return value


class VocabularyExample(VocabularyObject):
    id: str = Field(min_length=1)
    text: str = Field(min_length=1)


class VocabularySense(VocabularyObject):
    id: str = Field(min_length=1)
    definition: str = Field(min_length=1)
    partOfSpeech: PartOfSpeech
    examples: list[VocabularyExample]


class VocabularyEntry(VocabularyObject):
    id: str = Field(min_length=1)
    word: str = Field(min_length=1)
    senses: list[VocabularySense]


class VocabularyDocument(VocabularyObject):
    version: Literal[1]
    entries: list[VocabularyEntry]

    @field_validator("version", mode="before")
    @classmethod
    def integer_version(cls, value: Any) -> int:
        if type(value) is not int:
            raise ValueError("Version must be an integer")
        return value

    @model_validator(mode="after")
    def unique_ids(self) -> Self:
        ids = []
        for entry in self.entries:
            ids.append(entry.id)
            for sense in entry.senses:
                ids.append(sense.id)
                ids.extend(example.id for example in sense.examples)
        if len(ids) != len(set(ids)):
            raise ValueError("IDs must be unique")
        return self


def valid_vocabulary_document(content: dict[str, Any]) -> bool:
    try:
        VocabularyDocument.model_validate(content)
    except ValidationError:
        return False
    return True
