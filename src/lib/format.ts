export function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Signed cash-flow tally: withdrawn − deposited */
export function formatSignedUsd(amount: number): string {
  const formatted = formatUsd(Math.abs(amount));
  if (amount > 0) return `+${formatted}`;
  if (amount < 0) return `-${formatted}`;
  return formatted;
}

export function getCashFlowTally(deposited: number, withdrawn: number) {
  const net = withdrawn - deposited;
  let label = "Even — deposited and withdrawn match";
  if (net > 0) label = "Withdrew more than deposited";
  if (net < 0) label = "Deposited more than withdrawn";
  return { net, label, formatted: formatSignedUsd(net) };
}
