"""Versioned profile catalogue; agronomy assumptions are data, never UI constants."""

from pathlib import Path

from .schemas import Profile

PROFILE_DIRECTORY = Path(__file__).parent / "data" / "profiles"


def get_profiles() -> list[Profile]:
    return [
        Profile.model_validate_json(path.read_text(encoding="utf-8"))
        for path in sorted(PROFILE_DIRECTORY.glob("*.json"))
    ]


def get_profile(profile_id: str) -> Profile:
    for profile in get_profiles():
        if profile.id == profile_id:
            return profile
    raise ValueError(f"Unknown profile: {profile_id}")
