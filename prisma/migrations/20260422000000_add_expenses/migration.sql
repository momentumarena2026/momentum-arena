-- CreateEnum
CREATE TYPE "ExpenseOptionField" AS ENUM ('PAYMENT_TYPE', 'DONE_BY', 'VENDOR', 'SPENT_TYPE', 'TO_NAME');

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "paymentType" TEXT NOT NULL,
    "doneBy" TEXT NOT NULL,
    "toName" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "spentType" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByAdminId" TEXT,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseOption" (
    "id" TEXT NOT NULL,
    "field" "ExpenseOptionField" NOT NULL,
    "label" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Expense_date_idx" ON "Expense"("date");

-- CreateIndex
CREATE INDEX "Expense_spentType_idx" ON "Expense"("spentType");

-- CreateIndex
CREATE INDEX "Expense_doneBy_idx" ON "Expense"("doneBy");

-- CreateIndex
CREATE INDEX "Expense_vendor_idx" ON "Expense"("vendor");

-- CreateIndex
CREATE INDEX "Expense_paymentType_idx" ON "Expense"("paymentType");

-- CreateIndex
CREATE INDEX "ExpenseOption_field_isActive_idx" ON "ExpenseOption"("field", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseOption_field_label_key" ON "ExpenseOption"("field", "label");

-- CreateTable
CREATE TABLE "ExpenseEditHistory" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "adminId" TEXT,
    "adminUsername" TEXT,
    "editType" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseEditHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExpenseEditHistory_expenseId_idx" ON "ExpenseEditHistory"("expenseId");

-- CreateIndex
CREATE INDEX "ExpenseEditHistory_createdAt_idx" ON "ExpenseEditHistory"("createdAt");

-- AddForeignKey
ALTER TABLE "ExpenseEditHistory" ADD CONSTRAINT "ExpenseEditHistory_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;
