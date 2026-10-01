-- CreateTable
CREATE TABLE "ReportJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'PENDING',
    "ordersBulkOpId" TEXT,
    "productsBulkOpId" TEXT,
    "resultFileUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "ReportJob_shop_createdAt_idx" ON "ReportJob"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "ReportJob_stage_idx" ON "ReportJob"("stage");
