const path = require("path");
const getConfig = require("metro-bundler-config-yarn-workspaces");
const config = getConfig(__dirname);
const old = config.getProjectRoots.bind(config);
config.getProjectRoots = function(...args) {
  const roots = old(...args);
  roots[0] = path.resolve(roots[0], "..", "..");
  return roots.filter(root => !root.endsWith("node_modules"));
};
module.exports = config;
