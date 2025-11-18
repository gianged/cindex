/**
 * Mock for chalk to avoid ESM import issues in Jest
 */

const mockChalk = (text) => text;
mockChalk.red = (text) => text;
mockChalk.green = (text) => text;
mockChalk.yellow = (text) => text;
mockChalk.blue = (text) => text;
mockChalk.magenta = (text) => text;
mockChalk.cyan = (text) => text;
mockChalk.white = (text) => text;
mockChalk.gray = (text) => text;
mockChalk.bold = (text) => text;
mockChalk.dim = (text) => text;

module.exports = mockChalk;
module.exports.default = mockChalk;
