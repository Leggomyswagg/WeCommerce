# Implementation Quickstart

## 1) Install dependencies

```bash
npm install
```

## 2) Configure environment

```bash
cp .env.example .env
```

Fill in:
- `SHOPIFY_STORE_DOMAIN`
- `SHOPIFY_ACCESS_TOKEN`
- `STRIPE_SECRET_KEY`

## 3) Run apps

```bash
npm run dev:web
npm run dev:api
npm run dev:workers
```

## 4) Validate

- Web: `http://localhost:3000/health`
- API: `http://localhost:4000/health`

## 5) Push to GitHub

```bash
git remote add origin https://github.com/<you>/<repo>.git
git branch -M main
git push -u origin main
```
