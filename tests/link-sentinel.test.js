describe("Extension", () => {
  test("manifest_version is 3", () => { const m = require("../manifest.json"); expect(m.manifest_version).toBe(3); });
  test("has name", () => { const m = require("../manifest.json"); expect(m.name).toBeDefined(); });
  test("has version", () => { const m = require("../manifest.json"); expect(m.version).toBeDefined(); });
});
