-- AlterTable: JWT session revocation via sessionVersion (ADR-0002)
ALTER TABLE "users" ADD COLUMN "session_version" INTEGER NOT NULL DEFAULT 0;
