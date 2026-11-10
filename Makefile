# Shortcuts over `pnpm bench` and the quality gates; `make` alone lists them.
# NAME is an event (drivers/NAME/), ARGS extra options for bench, e.g. ARGS="--only codex".
SHELL := bash
.DEFAULT_GOAL := help
NAME  ?=
ARGS  ?=

need-name = @[[ -n "$(NAME)" ]] || { echo "set NAME=<event>, e.g. make $@ NAME=r1-medium"; exit 2; }

.PHONY: help install dev gates format build race golden tokens car clean

help: ## list the targets
	@grep -hE '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | sed -E 's/:.*## /\t/' | expand -t 10

install: ## install dependencies
	pnpm install

dev: ## replay viewer on http://localhost:5173/
	pnpm --filter @bench/viewer dev

gates: ## lint, typecheck, tests with coverage, determinism, viewer build
	pnpm lint && pnpm typecheck && pnpm coverage && pnpm determinism && pnpm --filter @bench/viewer build

format: ## biome format --write
	pnpm format

build: ## one driver per model in models.json -> drivers/NAME/
	$(need-name)
	pnpm -s bench build $(NAME) $(ARGS)

race: ## drivers/NAME/ on every circuit, or on TRACK -> results/races/<track>/NAME/
	$(need-name)
	pnpm bench race $(NAME) $(if $(TRACK),--track $(TRACK))

golden: ## regenerate the golden hashes after a physics change (then bump SIM_VERSION)
	UPDATE_GOLDEN=1 pnpm vitest run packages/sim/test/golden.test.ts

tokens: ## regenerate packages/ui tokens.gen.css and tokens.gen.ts from tokens.json
	pnpm tsx scripts/gen-tokens.ts

car: ## regenerate the viewer's car mesh from cars/sources/
	pnpm tsx scripts/import-car.ts

clean: ## remove coverage and the viewer build; never results/ or drivers/
	rm -rf coverage apps/viewer/dist
