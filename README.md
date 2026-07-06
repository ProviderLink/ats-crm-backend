# ats-crm-backend

Unified backend for the ATS and CRM platform.

## Prerequisites

- Node.js >= 20
- pnpm >= 10
- MongoDB

## Setup

```bash
pnpm install
cp .env.example .env   # then fill in your environment variables
pnpm dev
```

## Scripts

| Command           | Description                              |
| ----------------- | ---------------------------------------- |
| `pnpm dev`        | Start development server with hot reload |
| `pnpm build`      | Compile TypeScript                       |
| `pnpm start`      | Run production build                     |
| `pnpm seed:admin` | Seed admin user                          |
| `pnpm seed:demo`  | Seed demo data                           |

## Environment Variables

See `.env.example` for all required environment variables.

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express
- **Database**: MongoDB (Mongoose)
- **Auth**: JWT (access + refresh tokens)
- **Email**: Resend
- **File Storage**: Cloudinary
- **Realtime**: Socket.IO
- **Validation**: Zod
