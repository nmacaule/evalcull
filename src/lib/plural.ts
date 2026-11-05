/**
 * A count with its noun phrase (owner Q3, 4 Nov 2026): the singular form for
 * exactly 1, the plural for 0 and every other count, the number in en-US
 * grouping as PRD §2.8 writes it ("2,000").
 */

export function countPhrase(n: number, one: string, many: string): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}
