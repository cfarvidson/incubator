/**
 * The value after `flag` in argv, or null when the flag is absent. A missing or
 * flag-like value throws `missingValueError`.
 */
export function flagValue(argv: string[], flag: string, missingValueError: string): string | null {
  const index = argv.indexOf(flag);
  if (index === -1) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) throw new Error(missingValueError);
  return value;
}
