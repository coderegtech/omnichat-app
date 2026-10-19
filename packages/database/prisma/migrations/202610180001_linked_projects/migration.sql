ALTER TABLE "CodingProject" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'imported';
ALTER TABLE "CodingProject" ADD COLUMN "localPath" TEXT;
ALTER TABLE "CodingProject" ADD COLUMN "localManifest" JSONB NOT NULL DEFAULT '{}';
CREATE UNIQUE INDEX "CodingProject_localPath_key" ON "CodingProject"("localPath");
