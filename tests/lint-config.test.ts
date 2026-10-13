import assert from "node:assert/strict";
import test from "node:test";
import { ESLint } from "eslint";

const eslint = new ESLint();

test("lint rejects unsafe explicit any types in application source", async () => {
  const [result] = await eslint.lintText("const value: any = 1; export default value;\n", { filePath: "lib/lint-fixture.ts" });
  assert.ok(result.messages.some(message => message.ruleId === "@typescript-eslint/no-explicit-any" && message.severity === 2));
});

test("lint catches conditional React hooks", async () => {
  const [result] = await eslint.lintText(`import { useState } from "react";
export default function Example({ enabled }: { enabled: boolean }) {
  if (enabled) { const [value] = useState(0); return <p>{value}</p>; }
  return <p>Hazır</p>;
}
`, { filePath: "components/lint-fixture.tsx" });
  assert.ok(result.messages.some(message => message.ruleId === "react-hooks/rules-of-hooks" && message.severity === 2));
});

test("lint excludes generated artifacts while keeping application source enabled", async () => {
  assert.equal(await eslint.isPathIgnored(".next/generated.ts"), true);
  assert.equal(await eslint.isPathIgnored("test-results/report.js"), true);
  assert.equal(await eslint.isPathIgnored("components/workspace.tsx"), false);
});
