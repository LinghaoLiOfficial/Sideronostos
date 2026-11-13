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

# Rotation v2: explicit offline preparation and read-only verification.
# See ../ROTATION_V2.md. ARGS are the underlying CLI arguments.
.PHONY: prepare-knowledge prepare-data eval-assistant check-optimizer check-rotation
prepare-knowledge:
	uv run python -m sideronostos_backend.modules.knowledge.cli $(ARGS)
prepare-data:
	uv run python -m sideronostos_backend.modules.agri_data.cli $(ARGS)
eval-assistant:
	uv run python -m sideronostos_backend.modules.farm_assistant.evaluation.run $(ARGS)
check-optimizer:
	uv run pytest -q tests/test_rotation_candidates.py tests/test_rotation_milp.py tests/test_rotation_profiles.py tests/test_rotation_requests.py
check-rotation:
	uv run ruff check src/sideronostos_backend/modules/knowledge src/sideronostos_backend/modules/agri_data src/sideronostos_backend/modules/rotation_optimizer src/sideronostos_backend/modules/farm_assistant
	uv run mypy src/sideronostos_backend/modules/knowledge src/sideronostos_backend/modules/agri_data src/sideronostos_backend/modules/rotation_optimizer src/sideronostos_backend/modules/farm_assistant
	uv run pytest -q

# Reads archived files only; never calls a model, embeddings or the database.
.PHONY: replay-assistant
replay-assistant:
	.venv/bin/python -m sideronostos_backend.modules.farm_assistant.evaluation.replay $(ARGS)
