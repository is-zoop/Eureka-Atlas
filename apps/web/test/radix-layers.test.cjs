/* eslint-disable @typescript-eslint/no-require-imports -- Verify the installed dependency graph with Node. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");

const fromPackage = (name, parent = require) => createRequire(parent.resolve(name));
const dialog = fromPackage("@radix-ui/react-dialog");
const layers = [
  ["Popover", fromPackage("@radix-ui/react-popover")],
  ["DropdownMenu", fromPackage("@radix-ui/react-menu", fromPackage("@radix-ui/react-dropdown-menu"))],
  ["Tooltip", fromPackage("@radix-ui/react-tooltip")],
];

// Separate copies keep separate layer registries and focus stacks. A Dialog then
// treats a portalled Combobox menu as outside and blocks clicks or steals focus.
for (const dependency of ["@radix-ui/react-dismissable-layer", "@radix-ui/react-focus-scope"]) {
  test(`portalled controls share Dialog's ${dependency} instance`, () => {
    for (const [name, resolveFrom] of layers) {
      assert.equal(resolveFrom.resolve(dependency), dialog.resolve(dependency),
        `${name} and Dialog must share ${dependency}; align Radix releases instead of disabling modal protection`);
    }
  });
}
