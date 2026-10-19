CREATE TABLE "CodingProject" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CodingProject_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CodingFile" (
  "id" TEXT NOT NULL, "projectId" TEXT NOT NULL, "path" TEXT NOT NULL,
  "content" TEXT NOT NULL, "revision" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CodingFile_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CodingRun" (
  "id" TEXT NOT NULL, "projectId" TEXT NOT NULL, "requestId" TEXT NOT NULL,
  "prompt" TEXT NOT NULL, "modelId" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'running',
  "summary" TEXT NOT NULL DEFAULT '', "actions" JSONB NOT NULL DEFAULT '[]', "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CodingRun_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CodingCommand" (
  "id" TEXT NOT NULL, "projectId" TEXT NOT NULL, "requestId" TEXT NOT NULL,
  "program" TEXT NOT NULL, "args" JSONB NOT NULL, "status" TEXT NOT NULL DEFAULT 'queued',
  "output" TEXT NOT NULL DEFAULT '', "exitCode" INTEGER, "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CodingCommand_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CodingProject_userId_updatedAt_idx" ON "CodingProject"("userId", "updatedAt");
CREATE UNIQUE INDEX "CodingFile_projectId_path_key" ON "CodingFile"("projectId", "path");
CREATE UNIQUE INDEX "CodingRun_projectId_requestId_key" ON "CodingRun"("projectId", "requestId");
CREATE INDEX "CodingRun_projectId_createdAt_idx" ON "CodingRun"("projectId", "createdAt");
CREATE UNIQUE INDEX "CodingCommand_projectId_requestId_key" ON "CodingCommand"("projectId", "requestId");
CREATE INDEX "CodingCommand_projectId_createdAt_idx" ON "CodingCommand"("projectId", "createdAt");
ALTER TABLE "CodingProject" ADD CONSTRAINT "CodingProject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CodingFile" ADD CONSTRAINT "CodingFile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CodingProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CodingRun" ADD CONSTRAINT "CodingRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CodingProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CodingCommand" ADD CONSTRAINT "CodingCommand_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CodingProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
