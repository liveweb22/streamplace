#!/usr/bin/env node

/**
 * This is a hacky script I wrote really fast to scan all the package.json files and Dockerfiles
 * and do a cursory check that the dependency heiarachy makes some kind of basic sense. Doesn't
 * make any particularly strong guarantees but will catch basic problems sometimes.
 */

/* eslint-disable no-console */

const fs = require("fs");
const path = require("path");
const packages = fs.readdirSync(path.resolve(__dirname, "..", "packages"));
const prefix = "stream.place";
const depcheck = require("depcheck");
const { execSync } = require("child_process");

const FIX = process.argv[2] === "--fix";

let failed = false;
const graph = {};
const dirs = {};
const allDockerDeps = {};
for (const pkgName of packages) {
  graph[pkgName] = [];
  const pkgDir = path.resolve(__dirname, "..", "packages", pkgName);
  dirs[pkgName] = pkgDir;
  const pkg = JSON.parse(fs.readFileSync(path.resolve(pkgDir, "package.json")));
  const pkgDeps = new Set(
    [
      ...Object.keys(pkg.dependencies || []),
      ...Object.keys(pkg.devDependencies || [])
    ].filter(dep => packages.includes(dep))
  );
  graph[pkgName] = [...pkgDeps];
  let dockerfile;
  try {
    dockerfile = fs.readFileSync(path.resolve(pkgDir, "Dockerfile"), "utf8");
  } catch (e) {
    if (e.code !== "ENOENT") {
      throw e;
    }
    continue;
  }
  const re = new RegExp(`${prefix}/([a-z-]+)`);
  allDockerDeps[pkgName] = new Set();
  dockerfile.split("\n").forEach(line => {
    const results = re.exec(line);
    if (results) {
      allDockerDeps[pkgName].add(results[1]);
    }
  });
}

for (const pkgName of packages) {
  const pkgDeps = graph[pkgName];
  const dockerDeps = allDockerDeps[pkgName];
  if (!dockerDeps) {
    continue;
  }
  let failedLocal = false;
  let str = "\n";
  str += `${pkgName}\n`;
  str += [...pkgDeps]
    .map(dep => {
      if (dockerDeps.has(dep)) {
        return `  ✅  Dockerfile has ${prefix}/${dep}`;
      } else {
        failed = true;
        failedLocal = true;
        return `  ⛔️  Dockerfile is missing ${prefix}/${dep}`;
      }
    })
    .join("\n");
  str += "\n";
  str += [...dockerDeps]
    .map(dep => {
      if (pkgDeps.includes(dep)) {
        return `  ✅  package.json has ${dep}`;
      } else {
        if (FIX) {
          execSync(`yarn add ${dep}`, {
            cwd: path.resolve(__dirname, "..", "packages", pkgName)
          });
        } else {
          failed = true;
          failedLocal = true;
        }
        return `  ⛔️  package.json is missing ${dep}`;
      }
    })
    .join("\n");

  if (failedLocal) {
    console.log(str);
  }
}

const dotFile = `
  digraph streamplace {
    ${Object.entries(graph)
      .map(([pkgName, deps]) =>
        deps.map(dep => `    "${dep}" -> "${pkgName}";`).join("\n")
      )
      .join("\n")}
  }
`;

fs.writeFileSync(path.resolve(__dirname, "..", "dependencies.dot"), dotFile);

(async () => {
  for (const pkgName of packages) {
    const unused = await new Promise((resolve, reject) =>
      depcheck(
        dirs[pkgName],
        {
          ignoreDirs: ["dist", "build", "node_modules"]
        },
        resolve
      )
    );
    Object.keys(unused.missing).forEach(missingDep => {
      failed = true;
      console.log(`⛔️ ${pkgName} is missing ${missingDep}`);
    });
    // most unused dependencies are for docker deps and stuff but we do care about some
    const IMPORTANT_UNUSED = ["sp-configuration", "sp-streams"];
    IMPORTANT_UNUSED.forEach(dep => {
      if (
        unused.dependencies.includes(dep) ||
        unused.devDependencies.includes(dep)
      ) {
        failed = true;
        console.log(`⛔️ ${pkgName} has unnecessary ${dep}`);
        console.log(path.resolve(dirs[pkgName], "package.json"));
      }
    });
  }
  process.exit(failed ? 1 : 0);
})();
