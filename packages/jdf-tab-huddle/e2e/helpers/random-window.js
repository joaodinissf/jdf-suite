// Random windows for comparing Huddle up's planned version with the step-by-
// step one, shared by the unit tests (against a fake tab strip) and the e2e
// tests (in real Chrome). Each window is a list of tab specs in strip order:
// { url, pinned?, groupId?, splitViewId? }, with groups kept together and
// splits only between neighbours that Chrome allows to split.

// A small deterministic random source, so a failing window can be rebuilt.
export function seeded(seed) {
  let x = seed;
  return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
}

// A random window: a few pinned tabs, then ungrouped tabs and groups in
// runs, addresses drawn from a small set so there are duplicates, and some
// neighbours already split.
export function randomWindow(seed) {
  const rnd = seeded(seed);
  const pick = (n) => Math.floor(rnd() * n);
  const url = () => `https://${'abcdef'[pick(6)]}.test/${pick(4)}`;
  const spec = [];
  const pinned = pick(3);
  for (let i = 0; i < pinned; i++) spec.push({ url: url(), pinned: true });
  const runs = 1 + pick(4);
  for (let r = 0; r < runs; r++) {
    const groupId = pick(3) === 0 ? -1 : 10 + pick(3);
    const length = 1 + pick(5);
    for (let i = 0; i < length; i++) spec.push({ url: url(), groupId });
  }
  // Chrome keeps a group's tabs together, so merge any group split in two.
  const ordered = [...spec.filter(t => t.pinned), ...spec.filter(t => !t.pinned && (t.groupId ?? -1) === -1)];
  for (const g of [...new Set(spec.map(t => t.groupId).filter(g => g !== undefined && g !== -1))]) {
    ordered.push(...spec.filter(t => t.groupId === g));
  }
  if (pick(2)) ordered.push(...ordered.splice(pinned, pick(3)));   // a few ungrouped tabs end up after the groups
  let split = 1;
  for (let i = 0; i + 1 < ordered.length; i++) {
    const [a, b] = [ordered[i], ordered[i + 1]];
    if (pick(3) === 0 && !!a.pinned === !!b.pinned && (a.groupId ?? -1) === (b.groupId ?? -1)) {
      a.splitViewId = b.splitViewId = split++;
      i++;
    }
  }
  return ordered;
}

