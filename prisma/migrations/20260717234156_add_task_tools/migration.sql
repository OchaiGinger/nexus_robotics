-- CreateTable
CREATE TABLE "Action" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "atomIndex" INTEGER NOT NULL,
    "atomType" TEXT NOT NULL,
    "pair" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Action_pkey" PRIMARY KEY ("id")
);
