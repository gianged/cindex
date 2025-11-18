/**
 * Malformed JavaScript file for testing fallback parsing
 * Contains intentional syntax errors
 */

// Missing closing brace
function badFunction() {
  console.log('This function is missing a closing brace');
  if (true) {
    return 'incomplete';
  // Missing closing brace here

// Unclosed string
const str = "This string is not closed properly;

// Invalid syntax
const obj = {
  key: value that doesn't exist,
  another: 123,
};

// Missing parenthesis
function anotherBad(arg {
  return arg;
}

// This should still be parseable with fallback
function validFunction() {
  return 'I am valid';
}

// Random syntax error
const x = ;

// Export statement (partially valid)
export { validFunction };
