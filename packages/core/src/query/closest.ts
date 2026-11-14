// Levenshtein distance. The row is filled in place: every cell needs the one before it.
export const editDistance = (left: string, right: string): number => {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = row[j] ?? 0;
      const substitution = diagonal + (left[i - 1] === right[j - 1] ? 0 : 1);
      row[j] = Math.min(above + 1, (row[j - 1] ?? 0) + 1, substitution);
      diagonal = above;
    }
  }
  return row[right.length] ?? 0;
};

// A third of the name may be wrong, and always at least two characters.
export const isClose = (distance: number, name: string): boolean =>
  distance <= Math.max(2, Math.floor(name.length / 3));

export interface Ranked<Item> {
  readonly item: Item;
  readonly distance: number;
}

// Closest first; the sort is stable, so equally distant items keep their order.
export const rankByDistance = <Item>(
  items: readonly Item[],
  distanceOf: (item: Item) => number,
): readonly Ranked<Item>[] =>
  items
    .map((item) => ({ item, distance: distanceOf(item) }))
    .toSorted((left, right) => left.distance - right.distance);
