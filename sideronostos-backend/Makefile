.DEFAULT_GOAL := dev
.PHONY: dev dev-workflow dev-ai dev-identity dev-saas dev-full gradio lang-dev migrate check infra-up infra-down infra-status infra-reset smoke

export PYTHONPATH := $(CURDIR)/src$(if $(PYTHONPATH),:$(PYTHONPATH))
# Let uv select this project's .venv even when PyCharm's terminal inherited
# an activated environment from a different checkout.
unexport VIRTUAL_ENV

dev:
	uv sync --extra workflow --extra ai --extra identity --extra saas --extra full
	uv run python -m sideronostos_backend.dev dev
dev-workflow:
	uv sync --extra workflow --extra ai --extra identity --extra saas --extra full
	APP_PROFILE=workflow uv run python -m sideronostos_backend.dev dev
dev-ai:
	uv sync --extra workflow --extra ai --extra identity --extra saas --extra full
	APP_PROFILE=ai uv run python -m sideronostos_backend.dev dev
dev-identity:
	uv sync --extra workflow --extra ai --extra identity --extra saas --extra full
	APP_PROFILE=identity uv run python -m sideronostos_backend.dev dev
dev-saas:
	uv sync --extra workflow --extra ai --extra identity --extra saas --extra full
	APP_PROFILE=saas uv run python -m sideronostos_backend.dev dev
dev-full:
	uv sync --extra workflow --extra ai --extra identity --extra saas --extra full
	APP_PROFILE=full uv run python -m sideronostos_backend.dev dev
gradio:
	uv run python -m sideronostos_backend.gradio_app
lang-dev:
	uv run langgraph dev --config langgraph.json --host 127.0.0.1 --port 8123
migrate:
	uv run python -m alembic upgrade head
infra-up:
	uv run python -m sideronostos_backend.dev infra-up
infra-down:
	uv run python -m sideronostos_backend.dev infra-down
infra-status:
	uv run python -m sideronostos_backend.dev infra-status
infra-reset:
	uv run python -m sideronostos_backend.dev infra-reset
check:
	uv sync --extra workflow --extra ai --extra identity --extra saas --extra full
	uv run python -m ruff format .
	uv run python -m ruff check .
	uv run python -m mypy src
	uv run python -m pytest
smoke:
	uv run python -m sideronostos_backend.dev smoke

# Explicit preparation and verification commands; ARGS pass through to the CLI.
.PHONY: prepare-knowledge
prepare-knowledge:
	uv run python -m sideronostos_backend.modules.knowledge.cli $(ARGS)
.PHONY: prepare-data
prepare-data:
	uv run python -m sideronostos_backend.modules.agri_data.cli $(ARGS)
.PHONY: check-optimizer
check-optimizer:
	uv run pytest -q tests/test_rotation_candidates.py tests/test_rotation_milp.py tests/test_rotation_profiles.py tests/test_rotation_requests.py
