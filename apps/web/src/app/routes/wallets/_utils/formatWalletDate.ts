const walletDateFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
});

export function formatWalletDate(timestamp: string): string {
  return walletDateFormatter.format(new Date(timestamp));
}
