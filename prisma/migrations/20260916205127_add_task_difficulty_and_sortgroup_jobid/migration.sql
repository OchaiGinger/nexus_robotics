/*
  Warnings:

  - A unique constraint covering the columns `[jobId,order]` on the table `SortGroup` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `jobId` to the `SortGroup` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "SortGroup" ADD COLUMN     "jobId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "difficulty" INTEGER;

-- CreateIndex
CREATE INDEX "SortGroup_jobId_idx" ON "SortGroup"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "SortGroup_jobId_order_key" ON "SortGroup"("jobId", "order");
