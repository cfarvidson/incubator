/**
 * The value after `flag` in argv, or null when the flag is absent. A missing or
 * flag-like value throws, carrying the caller's listing of valid names.
 */
export function flagValue(argv: string[], flag: string, listing: string): string | null {
  const index = argv.indexOf(flag);
  if (index === -1) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`${flag} requires a profile name. ${listing}`);
  return value;
}
