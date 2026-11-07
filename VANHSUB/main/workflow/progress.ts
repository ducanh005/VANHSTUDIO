/** One reporter per node attempt; only a successful terminal event may reach 100. */
export function createNodeProgressReporter(report: (percent: number) => void, initial = 10): (percent: number) => void {
  let highest = initial;
  return percent => {
    if (!Number.isFinite(percent)) return;
    highest = Math.max(highest, Math.min(99, Math.max(0, percent)));
    report(highest);
  };
}
