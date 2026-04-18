-- Cache for documents that are expensive to render and served at public
-- URLs (pricing pdf today, cafe menu later). A cron regenerates rows in
-- place; the public route streams bytes back.

CREATE TABLE IF NOT EXISTS "CachedDocument" (
  "id"          TEXT        NOT NULL,
  "content"     BYTEA       NOT NULL,
  "mimeType"    TEXT        NOT NULL DEFAULT 'application/pdf',
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CachedDocument_pkey" PRIMARY KEY ("id")
);
