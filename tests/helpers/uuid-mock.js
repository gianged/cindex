/**
 * Mock for uuid to avoid ESM import issues in Jest
 */

const v4 = () => '00000000-0000-4000-8000-000000000000';

module.exports = { v4 };
module.exports.default = { v4 };
