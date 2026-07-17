CREATE TYPE "ContactImportStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED');

CREATE TYPE "ContactImportLogStatus" AS ENUM ('IMPORTED', 'SKIPPED', 'FAILED');

CREATE TYPE "ContactImportDuplicateBehavior" AS ENUM ('SKIP', 'UPDATE');

CREATE TABLE "contact_imports" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "uploaded_by" TEXT NOT NULL,
  "original_filename" TEXT NOT NULL,
  "stored_filename" TEXT NOT NULL,
  "storage_path" TEXT,
  "total_rows" INTEGER NOT NULL,
  "imported_rows" INTEGER NOT NULL,
  "skipped_rows" INTEGER NOT NULL DEFAULT 0,
  "failed_rows" INTEGER NOT NULL,
  "status" "ContactImportStatus" NOT NULL,
  "duplicate_behavior" "ContactImportDuplicateBehavior" NOT NULL DEFAULT 'SKIP',
  "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "contact_imports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contact_import_logs" (
  "id" TEXT NOT NULL,
  "import_id" TEXT NOT NULL,
  "row_number" INTEGER NOT NULL,
  "name" TEXT,
  "phone" TEXT,
  "status" "ContactImportLogStatus" NOT NULL,
  "error_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "contact_import_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "contact_imports_workspace_id_uploaded_at_idx"
ON "contact_imports"("workspace_id", "uploaded_at");

CREATE INDEX "contact_imports_uploaded_by_uploaded_at_idx"
ON "contact_imports"("uploaded_by", "uploaded_at");

CREATE INDEX "contact_import_logs_import_id_row_number_idx"
ON "contact_import_logs"("import_id", "row_number");

CREATE INDEX "contact_import_logs_status_created_at_idx"
ON "contact_import_logs"("status", "created_at");

ALTER TABLE "contact_imports"
ADD CONSTRAINT "contact_imports_workspace_id_fkey"
FOREIGN KEY ("workspace_id") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contact_imports"
ADD CONSTRAINT "contact_imports_uploaded_by_fkey"
FOREIGN KEY ("uploaded_by") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contact_import_logs"
ADD CONSTRAINT "contact_import_logs_import_id_fkey"
FOREIGN KEY ("import_id") REFERENCES "contact_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
