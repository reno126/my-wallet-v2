export interface TransactionOrderKey {
  readonly id: string;
  readonly transactionDate: string;
  readonly createdAt: Date;
}

export function compareTransactions(left: TransactionOrderKey, right: TransactionOrderKey): number {
  if (left.transactionDate !== right.transactionDate) {
    return left.transactionDate < right.transactionDate ? -1 : 1;
  }
  const creationDifference = left.createdAt.getTime() - right.createdAt.getTime();
  if (creationDifference !== 0) {
    return creationDifference;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}
