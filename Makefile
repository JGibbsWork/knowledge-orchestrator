.PHONY: dev build start lint typecheck clean docker-build docker-up docker-down install

# Development
dev:
	pnpm dev

# Build
build:
	pnpm build

# Start production
start:
	pnpm start

# Linting and type checking
lint:
	pnpm lint

lint-fix:
	pnpm lint:fix

typecheck:
	pnpm typecheck

# Package management
install:
	pnpm install

# Clean
clean:
	rm -rf dist node_modules

# Docker
docker-build:
	docker build -t ko-service .

docker-up:
	docker-compose up --build

docker-down:
	docker-compose down

# Health check
health:
	curl -f http://localhost:3000/health