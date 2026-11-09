# Shortcuts for the dev loop. Every target wraps a pnpm script;
# `make` alone lists them. Variables: NAME (event / build name), TRACK, ONLY, JOBS, TIMEOUT.
SHELL := bash
.DEFAULT_GOAL := help

NAME    ?=
TRACK   ?= barcelona
ONLY    ?=
JOBS    ?=
TIMEOUT ?=

BUILD_OPTS := $(if $(ONLY),--only $(ONLY)) $(if $(JOBS),--jobs $(JOBS)) $(if $(TIMEOUT),--timeout $(TIMEOUT))
need-name = @[[ -n "$(NAME)" ]] || { echo "set NAME=<name>, e.g. make $@ NAME=gp-1"; exit 2; }

.PHONY: help install dev lint format typecheck test coverage determinism tokens viewer-build gates \
	tracks golden plausibility demo serve build-check build event reproduce qualify leaderboard clean

help: ## list the targets
	@grep -hE '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | sed -E 's/:.*## /\t/' | expand -t 16

## --- setup and viewer
install: ## install dependencies
	pnpm install

dev: ## 3D replay viewer on http://localhost:5173/
	pnpm --filter @bench/viewer dev

## --- quality gates
lint: ## biome check
	pnpm lint

format: ## biome format --write
	pnpm format

typecheck: ## tsc for the packages and the viewer
	pnpm typecheck

test: ## vitest, no coverage
	pnpm test

coverage: ## vitest with the 90% coverage thresholds
	pnpm coverage

determinism: ## same session in two processes, same hash
	pnpm determinism

tokens: ## regenerate packages/ui tokens.gen.css and tokens.gen.ts from tokens.json
	pnpm tsx scripts/gen-tokens.ts

viewer-build: ## production build of the viewer
	pnpm --filter @bench/viewer build

gates: lint typecheck coverage determinism viewer-build ## every gate, as before calling work done

## --- simulator data
tracks: ## regenerate the real circuits from tracks/sources/
	pnpm tsx scripts/import-tracks.ts

golden: ## regenerate the golden hashes (after physics changes; then bump SIM_VERSION)
	UPDATE_GOLDEN=1 pnpm vitest run packages/sim/test/golden.test.ts

plausibility: ## vehicle targets: top speed, braking g, lateral g, 0-100
	pnpm tsx scripts/plausibility.ts

demo: ## regenerate results/demo
	pnpm tsx scripts/demo-replay.ts

## --- building drivers and racing
serve: ## practice service on :8787 (build starts its own if none runs)
	pnpm bench serve --port 8787

build-check: ## check sandbox and CLIs without running a model (NAME=)
	$(need-name)
	pnpm -s build-drivers $(NAME) --check $(BUILD_OPTS)

build: ## one driver per models.json entry -> drivers/NAME/ (NAME= [ONLY= JOBS= TIMEOUT=])
	$(need-name)
	pnpm -s build-drivers $(NAME) $(BUILD_OPTS)

event: ## flying lap of drivers/NAME/ on its event circuit (NAME=)
	$(need-name)
	pnpm bench event run $(NAME)

reproduce: ## re-run an event and check every state hash (NAME=)
	$(need-name)
	pnpm bench event reproduce $(NAME)

qualify: ## flying lap of drivers/NAME/* on any circuit (NAME= [TRACK=])
	$(need-name)
	pnpm bench qualify drivers/$(NAME)/*/driver.js --track $(TRACK) \
		--out results/qualify/$(NAME)-$(TRACK)

leaderboard: ## aggregate every event under results/
	pnpm bench leaderboard results

clean: ## remove build outputs (coverage, viewer dist); never results/ or drivers/
	rm -rf coverage apps/viewer/dist
