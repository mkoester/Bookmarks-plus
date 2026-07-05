// Pure geometry helper for pointer-based list reordering. Given the pointer's
// Y coordinate and the vertical midpoints of the list rows (in top-to-bottom
// order), returns the index to insert *before* (0..rows.length): the number of
// rows whose midpoint the pointer has already passed. DOM-free so it's unit
// tested directly; the options page feeds it live getBoundingClientRect values.
export function insertionIndexForY(pointerY: number, midpoints: number[]): number {
  return midpoints.filter((mid) => pointerY > mid).length;
}
