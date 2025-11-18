/**
 * Large TypeScript file (>5000 lines)
 * Used to test structure-only indexing
 */

// This file simulates a large codebase file
// In a real scenario, this would be auto-generated code or a large module

export const LARGE_FILE_MARKER = true;

// Function 1
export function processData1(input: string): string {
  return input.toUpperCase();
}

// Function 2
export function processData2(input: string): string {
  return input.toLowerCase();
}

// Repeat similar patterns to reach 6000+ lines
$(for i in {1..600}; do
  echo ""
  echo "// Auto-generated function $i"
  echo "export function generatedFunction$i(arg: any): any {"
  echo "  // This is a generated function for testing large files"
  echo "  // Cyclomatic complexity: simple function"
  echo "  if (arg === null) {"
  echo "    return null;"
  echo "  }"
  echo "  return arg;"
  echo "}"
done)

// End of large file
export const END_MARKER = true;
