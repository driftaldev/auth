-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('critical', 'high', 'medium', 'low');

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "model" VARCHAR(100) NOT NULL,
    "total_tokens" INTEGER,
    "lines_of_code_reviewed" INTEGER,
    "review_duration_ms" INTEGER,
    "repository_name" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_issues" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "review_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "file_path" TEXT NOT NULL,
    "line_number" INTEGER,
    "description" TEXT,
    "suggestion" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_profiles_email_idx" ON "user_profiles"("email");

-- CreateIndex
CREATE INDEX "usage_logs_user_id_idx" ON "usage_logs"("user_id");

-- CreateIndex
CREATE INDEX "usage_logs_created_at_idx" ON "usage_logs"("created_at");

-- CreateIndex
CREATE INDEX "usage_logs_model_idx" ON "usage_logs"("model");

-- CreateIndex
CREATE INDEX "usage_logs_email_idx" ON "usage_logs"("email");

-- CreateIndex
CREATE INDEX "usage_logs_repository_name_idx" ON "usage_logs"("repository_name");

-- CreateIndex
CREATE INDEX "usage_logs_email_created_at_idx" ON "usage_logs"("email", "created_at" DESC);

-- CreateIndex
CREATE INDEX "usage_logs_user_id_created_at_idx" ON "usage_logs"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "review_issues_review_id_idx" ON "review_issues"("review_id");

-- CreateIndex
CREATE INDEX "review_issues_severity_idx" ON "review_issues"("severity");

-- CreateIndex
CREATE INDEX "review_issues_file_path_idx" ON "review_issues"("file_path");

-- CreateIndex
CREATE INDEX "review_issues_created_at_idx" ON "review_issues"("created_at");

-- CreateIndex
CREATE INDEX "review_issues_review_id_severity_idx" ON "review_issues"("review_id", "severity");

-- AddForeignKey
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_issues" ADD CONSTRAINT "review_issues_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "usage_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
