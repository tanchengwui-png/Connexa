import { existsSync, readFileSync } from "node:fs";
import { extname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

function resolveSourcePath(basePath) {
  const extension = extname(basePath);
  const candidates = extension
    ? existsSync(basePath)
      ? [basePath]
      : extension === ".js"
        ? [`${basePath.slice(0, -3)}.ts`, `${basePath.slice(0, -3)}.tsx`]
        : []
    : [
        `${basePath}.ts`,
        `${basePath}.tsx`,
        `${basePath}.js`,
        `${basePath}.mjs`,
        resolvePath(basePath, "index.ts"),
        resolvePath(basePath, "index.tsx"),
        resolvePath(basePath, "index.js")
      ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const sourcePath = resolveSourcePath(resolvePath(repoRoot, specifier.slice(2)));
    if (sourcePath) return { url: pathToFileURL(sourcePath).href, shortCircuit: true };
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    const requestedUrl = new URL(specifier, context.parentURL);
    if (requestedUrl.pathname.includes("/node_modules/")) {
      return nextResolve(specifier, context);
    }
    const sourcePath = resolveSourcePath(fileURLToPath(new URL(specifier, context.parentURL)));
    if (sourcePath) return { url: pathToFileURL(sourcePath).href, shortCircuit: true };
  }
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (specifier.startsWith("next/") && !specifier.endsWith(".js")) {
      return nextResolve(`${specifier}.js`, context);
    }
    throw error;
  }
}

export async function load(url, context, nextLoad) {
  if (url.startsWith("file:") && /\.tsx?$/.test(new URL(url).pathname)) {
    const source = readFileSync(fileURLToPath(url), "utf8");
    const output = ts.transpileModule(source, {
      compilerOptions: {
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        target: ts.ScriptTarget.ES2022
      },
      fileName: fileURLToPath(url)
    });
    return { format: "module", source: output.outputText, shortCircuit: true };
  }
  return nextLoad(url, context);
}
