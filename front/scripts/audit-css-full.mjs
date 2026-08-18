import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import process from "node:process";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";

const ROOT = process.cwd();
const SRC = resolve(ROOT, "src");
const REPORTS = resolve(ROOT, "reports");
const REPORT = resolve(REPORTS, "css-audit.json");
const CONFIG = resolve(ROOT, "css-audit.config.json");

const DEFAULT_CONFIG = {
  ignoreClasses: ["active", "disabled", "error", "loading", "open", "selected", "visible"],
  ignoreClassPatterns: ["^cosmic-", "^karaoke-atmosphere-", "^cosmic-variant-"],
  ignoreSelectors: [],
  generatedClassPrefixes: [],
  allowedImportantSelectors: [],
  allowedDuplicateSelectors: [],
  allowedZIndexes: [0, 1, 2, 5, 10, 20, 30, 40, 50, 100, 1000],
  allowedBreakpoints: [480, 600, 700, 768, 900, 1000, 1200, 1280, 1440],
  maxSelectorSpecificity: 40,
  maxSelectorDepth: 5,
  maxFileLines: 2000,
  repeatedValueMinimum: 4,
  strictRules: ["invalid-css", "transition-all", "javascript-url", "extreme-z-index"]
};

const SOURCE_EXTENSIONS = [".js", ".jsx", ".ts", ".tsx"];
const CSS_EXTENSIONS = [".css"];

const COLOR_PATTERN = /(?:#[\da-f]{3,8}\b|rgba?\([^)]+\)|hsla?\([^)]+\)|color-mix\([^)]+\))/gi;
const SIZE_PATTERN = /(?<![\w-])-?(?:\d*\.)?\d+(?:px|rem|em|vh|vw|vmin|vmax|ch|ex)\b/gi;

const CLASS_PATTERNS = [
  /\bclassName\s*=\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g,
  /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/g
];

const CLASS_METHOD_PATTERNS = [
  /classList\.(?:add|remove|toggle|contains)\s*\(\s*["'`]([^"'`]+)["'`]/g,
  /getElementsByClassName\s*\(\s*["'`]([^"'`]+)["'`]/g
];

const QUERY_SELECTOR_PATTERN = /querySelector(?:All)?\s*\(\s*["'`]([^"'`]+)["'`]/g;

const DYNAMIC_CLASS_PATTERN = /["'`]([a-zA-Z_][\w-]*(?:--[a-zA-Z0-9_-]+)+)["'`]/g;

const TOKENS = [
  [COLOR_PATTERN, "color-token-candidate"],
  [SIZE_PATTERN, "size-token-candidate"]
];

const relativePath = (file) => relative(ROOT, file).replaceAll("\\", "/");
const selectorDepth = (selector) => selector.split(/\s+|>|\+|~/).filter(Boolean).length;
const normalizeValue = (value) =>
  String(value)
    .replace(/\s*!important\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

const exists = async (file) =>
  access(file).then(
    () => true,
    () => false
  );

const pushMap = (map, key, value) => map.set(key, [...(map.get(key) ?? []), value]);

const locationOf = (node, file, extra = {}) => ({
  file,
  line: node.source?.start?.line,
  column: node.source?.start?.column,
  ...extra
});

const createIssue =
  (issues) =>
  (rule, message, data = {}) =>
    issues.push({ rule, severity: "warning", message, ...data });

const runChecks = (checks, issue, data) =>
  checks.forEach(
    ([match, rule, message, severity = "warning", extra = {}]) =>
      match && issue(rule, message, { severity, ...data, ...extra })
  );

const collectMatches = (source, patterns, callback) =>
  patterns.forEach((pattern) => [...source.matchAll(pattern)].forEach(callback));

const splitClasses = (value) =>
  String(value)
    .replace(/\$\{[^}]*\}/g, " ")
    .split(/\s+/)
    .filter((item) => item && !/[{}$]/.test(item));

const walk = async (directory, extensions) =>
  (
    await Promise.all(
      (await readdir(directory, { withFileTypes: true })).map(async (entry) => {
        const file = join(directory, entry.name);
        if (entry.isDirectory()) return walk(file, extensions);
        return extensions.includes(extname(entry.name).toLowerCase()) ? [file] : [];
      })
    )
  ).flat();

const loadConfig = async () => {
  if (!(await exists(CONFIG))) return DEFAULT_CONFIG;

  try {
    const config = JSON.parse(await readFile(CONFIG, "utf8"));

    return {
      ...DEFAULT_CONFIG,
      ...config,
      ignoreClasses: [...DEFAULT_CONFIG.ignoreClasses, ...(config.ignoreClasses ?? [])],
      ignoreClassPatterns: [
        ...DEFAULT_CONFIG.ignoreClassPatterns,
        ...(config.ignoreClassPatterns ?? [])
      ]
    };
  } catch (error) {
    console.warn(`Не удалось прочитать css-audit.config.json: ${error.message}`);
    return DEFAULT_CONFIG;
  }
};

const collectClasses = (source, file, usage, dynamicFragments) => {
  collectMatches(source, CLASS_PATTERNS, (match) => {
    const value = match[1] ?? match[2] ?? match[3] ?? "";
    splitClasses(value).forEach((name) => pushMap(usage, name, { file }));
    if (value.includes("${")) dynamicFragments.add(value);
  });

  collectMatches(source, CLASS_METHOD_PATTERNS, (match) =>
    splitClasses(match[1]).forEach((name) => pushMap(usage, name, { file }))
  );

  for (const [, selector] of source.matchAll(QUERY_SELECTOR_PATTERN))
    for (const [, name] of selector.matchAll(/\.([a-zA-Z_][\w-]*)/g))
      pushMap(usage, name, { file });

  for (const [, name] of source.matchAll(DYNAMIC_CLASS_PATTERN)) pushMap(usage, name, { file });
};

const selectorClasses = (selector) => {
  const classes = [];

  try {
    selectorParser((root) => root.walkClasses((node) => classes.push(node.value))).processSync(
      selector
    );
  } catch {
    classes.push(...[...selector.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map((match) => match[1]));
  }

  return classes;
};

const selectorSpecificity = (selector) => {
  let ids = 0;
  let classes = 0;
  let elements = 0;

  try {
    selectorParser((root) =>
      root.walk((node) => {
        if (node.type === "id") ids++;
        else if (["class", "attribute", "pseudo"].includes(node.type)) {
          if (
            node.type === "pseudo" &&
            ["::before", "::after", "::first-letter", "::first-line"].includes(node.value)
          )
            elements++;
          else classes++;
        } else if (node.type === "tag") elements++;
      })
    ).processSync(selector);
  } catch {
    ids = (selector.match(/#[\w-]+/g) ?? []).length;
    classes = (selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
    elements = (selector.match(/(?:^|[\s>+~])([a-z][\w-]*)/gi) ?? []).length;
  }

  return { ids, classes, elements, score: ids * 100 + classes * 10 + elements };
};

const atRuleContext = (node) => {
  const context = [];

  for (let current = node.parent; current; current = current.parent)
    if (current.type === "atrule")
      context.unshift(`@${current.name}${current.params ? ` ${current.params}` : ""}`);

  return context.join(" > ");
};

const ignoredClass = (name, config) =>
  config.ignoreClasses.includes(name) ||
  config.ignoreClassPatterns.some((pattern) => new RegExp(pattern).test(name));

const dynamicClassBase = (name) =>
  name.includes("--")
    ? name.slice(0, name.indexOf("--") + 2)
    : name.includes("-")
      ? name.slice(0, name.lastIndexOf("-") + 1)
      : name;

const couldBeDynamic = (name, fragments, config) => {
  if (config.generatedClassPrefixes.some((prefix) => name.startsWith(prefix))) return true;

  const base = dynamicClassBase(name);

  return [...fragments].some((fragment) => {
    const parts = fragment
      .split(/\$\{[^}]*\}/)
      .map((part) => part.trim())
      .filter(Boolean);
    return parts.some((part) => name.includes(part)) || Boolean(base && fragment.includes(base));
  });
};

const registerValue = (map, property, value, location) => {
  const normalized = normalizeValue(value);
  if (!normalized || normalized.startsWith("var(")) return;

  const key = `${property}:${normalized}`;
  const entry = map.get(key) ?? { property, value: normalized, locations: [] };

  entry.locations.push(location);
  map.set(key, entry);
};

const registerTokens = (value, map, location) =>
  TOKENS.forEach(([pattern, type]) =>
    (value.match(pattern) ?? []).forEach((token) =>
      registerValue(map, type, token.toLowerCase(), location)
    )
  );

const breakpointFrom = (params) =>
  Number(params.match(/(?:max|min)-width\s*:\s*(\d+(?:\.\d+)?)px/i)?.[1]) || null;

const parseZIndex = (value) => {
  const normalized = normalizeValue(value);
  return /^-?\d+$/.test(normalized) ? Number(normalized) : null;
};

const sortIssues = (issues) => {
  const order = { error: 0, warning: 1, info: 2 };

  return issues.sort(
    (a, b) =>
      (order[a.severity] ?? 99) - (order[b.severity] ?? 99) ||
      String(a.file).localeCompare(String(b.file)) ||
      (a.line ?? 0) - (b.line ?? 0)
  );
};

const countIssues = (issues) =>
  issues.reduce(
    (counts, { severity }) => {
      if (severity in counts) counts[severity]++;
      return counts;
    },
    { error: 0, warning: 0, info: 0 }
  );

const buildDuplicates = (definitions) =>
  [...definitions]
    .filter(([, locations]) => locations.length > 1)
    .map(([selector, locations]) => ({
      selector: locations[0]?.selector ?? selector,
      context: locations[0]?.context ?? "",
      count: locations.length,
      locations
    }))
    .sort((a, b) => b.count - a.count);

const buildRepeated = (values, minimum) =>
  [...values.values()]
    .filter(({ locations }) => locations.length >= minimum)
    .sort((a, b) => b.locations.length - a.locations.length);

const main = async () => {
  const config = await loadConfig();
  const [cssFiles, sourceFiles] = await Promise.all([
    walk(SRC, CSS_EXTENSIONS),
    walk(SRC, SOURCE_EXTENSIONS)
  ]);

  const sourceUsage = new Map();
  const dynamicFragments = new Set();

  await Promise.all(
    sourceFiles.map(async (file) =>
      collectClasses(
        await readFile(file, "utf8"),
        relativePath(file),
        sourceUsage,
        dynamicFragments
      )
    )
  );

  const issues = [];
  const issue = createIssue(issues);
  const selectors = new Map();
  const classes = new Map();
  const repeatedValues = new Map();
  const breakpoints = new Map();
  const fileStats = [];

  for (const filePath of cssFiles) {
    const file = relativePath(filePath);
    const source = await readFile(filePath, "utf8");
    const lines = source.split(/\r?\n/).length;

    fileStats.push({ file, lines, bytes: Buffer.byteLength(source) });

    if (lines > config.maxFileLines)
      issue("large-css-file", `CSS-файл содержит ${lines} строк.`, {
        file,
        line: 1,
        details: { recommendedMaximum: config.maxFileLines }
      });

    let root;

    try {
      root = postcss.parse(source, { from: filePath });
    } catch (error) {
      issue("invalid-css", error.reason ?? error.message, {
        severity: "error",
        file,
        line: error.line,
        column: error.column
      });
      continue;
    }

    root.walkAtRules("media", (rule) => {
      const breakpoint = breakpointFrom(rule.params);
      if (breakpoint == null) return;

      const line = rule.source?.start?.line;

      pushMap(breakpoints, breakpoint, { file, line });

      if (!config.allowedBreakpoints.includes(breakpoint))
        issue("nonstandard-breakpoint", `Использован нестандартный breakpoint ${breakpoint}px.`, {
          file,
          line,
          value: `${breakpoint}px`
        });
    });

    root.walkRules((rule) => {
      for (const rawSelector of rule.selectors ?? [rule.selector]) {
        const selector = rawSelector.trim();
        if (!selector) continue;

        const context = atRuleContext(rule);
        const location = locationOf(rule, file, { context, selector });

        pushMap(selectors, context ? `${context} :: ${selector}` : selector, location);

        selectorClasses(selector).forEach((name) => pushMap(classes, name, location));

        const specificity = selectorSpecificity(selector);
        const depth = selectorDepth(selector);

        runChecks(
          [
            [
              specificity.score > config.maxSelectorSpecificity,
              "high-specificity",
              `Высокая специфичность селектора: ${specificity.score}.`,
              "warning",
              { details: specificity }
            ],
            [depth > config.maxSelectorDepth, "deep-selector", `Глубина селектора: ${depth}.`],
            [
              /#[-_a-zA-Z][\w-]*/.test(selector),
              "id-selector",
              "CSS использует ID-селектор.",
              "info"
            ]
          ],
          issue,
          { file, line: location.line, selector }
        );
      }

      const declarations = new Map();

      rule.walkDecls((declaration) => {
        const property = declaration.prop.toLowerCase();
        const { value } = declaration;
        const normalized = normalizeValue(value);
        const location = locationOf(declaration, file, { selector: rule.selector });

        pushMap(declarations, property, { value: normalized, location });
        registerValue(repeatedValues, property, normalized, location);

        const data = {
          file,
          line: location.line,
          selector: rule.selector,
          property,
          value
        };

        runChecks(
          [
            [
              declaration.important && !config.allowedImportantSelectors.includes(rule.selector),
              "important",
              "Использован !important."
            ],
            [
              property === "transition" && /(?:^|\s|,)all(?:\s|,|$)/i.test(normalized),
              "transition-all",
              "transition: all может вызывать непредсказуемые анимации.",
              "error"
            ],
            [
              /url\(\s*["']?\s*javascript:/i.test(value),
              "javascript-url",
              "Обнаружен javascript: URL внутри CSS.",
              "error"
            ],
            [
              property === "writing-mode" && /vertical/i.test(value),
              "vertical-writing-mode",
              "Вертикальный writing-mode требует ручной визуальной проверки."
            ],
            [
              ["width", "min-width", "max-width"].includes(property) &&
                /\b(?:fit-content|min-content|max-content)\b/i.test(value),
              "intrinsic-width",
              "Intrinsic width может схлопывать flex/grid-элементы."
            ]
          ],
          issue,
          data
        );

        if (property === "z-index") {
          const zIndex = parseZIndex(value);

          if (zIndex != null && !config.allowedZIndexes.includes(zIndex)) {
            const extreme = Math.abs(zIndex) >= 10000;

            issue(
              extreme ? "extreme-z-index" : "nonstandard-z-index",
              `Нестандартный z-index: ${zIndex}.`,
              { severity: extreme ? "error" : "warning", ...data }
            );
          }
        }

        registerTokens(value, repeatedValues, location);
      });

      for (const [property, values] of declarations)
        if (new Set(values.map(({ value }) => value)).size > 1)
          issue(
            "conflicting-declarations",
            `Свойство ${property} объявлено несколько раз с разными значениями в одном блоке.`,
            {
              file,
              line: rule.source?.start?.line,
              selector: rule.selector,
              property,
              details: values
            }
          );
    });
  }

  for (const [selector, locations] of selectors)
    if (locations.length > 1 && !config.allowedDuplicateSelectors.includes(selector))
      issue("duplicate-selector", `Селектор объявлен ${locations.length} раз.`, {
        file: locations[0].file,
        line: locations[0].line,
        selector,
        details: locations
      });

  const unusedClasses = [];
  const dynamicClassCandidates = [];

  for (const [className, locations] of classes) {
    if (ignoredClass(className, config) || sourceUsage.has(className)) continue;

    const entry = { className, locations };

    if (couldBeDynamic(className, dynamicFragments, config)) {
      dynamicClassCandidates.push(entry);
      continue;
    }

    unusedClasses.push(entry);

    issue("unused-class-candidate", `Класс .${className} не найден в статическом исходном коде.`, {
      severity: "info",
      file: locations[0]?.file,
      line: locations[0]?.line,
      selector: `.${className}`,
      details: locations
    });
  }

  const repeatedValueReport = buildRepeated(repeatedValues, config.repeatedValueMinimum);
  const duplicateSelectors = buildDuplicates(selectors);
  const counts = countIssues(issues);

  const report = {
    generatedAt: new Date().toISOString(),
    root: ROOT,
    summary: {
      cssFiles: cssFiles.length,
      sourceFiles: sourceFiles.length,
      selectors: selectors.size,
      classesDefined: classes.size,
      classesUsed: sourceUsage.size,
      unusedClassCandidates: unusedClasses.length,
      dynamicClassCandidates: dynamicClassCandidates.length,
      duplicateSelectors: duplicateSelectors.length,
      repeatedValues: repeatedValueReport.length,
      breakpoints: breakpoints.size,
      issues: issues.length,
      errors: counts.error,
      warnings: counts.warning,
      info: counts.info
    },
    fileStats: fileStats.toSorted((a, b) => b.lines - a.lines),
    breakpoints: [...breakpoints]
      .map(([value, locations]) => ({ value, count: locations.length, locations }))
      .toSorted((a, b) => a.value - b.value),
    unusedClasses,
    dynamicClassCandidates,
    duplicateSelectors,
    repeatedValues: repeatedValueReport,
    issues: sortIssues(issues)
  };

  await mkdir(REPORTS, { recursive: true });
  await writeFile(REPORT, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const { summary } = report;

  console.log(
    [
      "",
      "CSS FULL AUDIT",
      "==============",
      ["CSS files", summary.cssFiles],
      ["Selectors", summary.selectors],
      ["Classes defined", summary.classesDefined],
      ["Unused class candidates", summary.unusedClassCandidates],
      ["Dynamic class candidates", summary.dynamicClassCandidates],
      ["Duplicate selectors", summary.duplicateSelectors],
      ["Repeated value groups", summary.repeatedValues],
      ["Errors", summary.errors],
      ["Warnings", summary.warnings],
      ["Info", summary.info]
    ]
      .map((item) => (Array.isArray(item) ? `${item[0]}: ${item[1]}` : item))
      .join("\n") + `\n\nReport: ${relativePath(REPORT)}`
  );

  const topIssues = report.issues.filter(({ severity }) => severity !== "info").slice(0, 30);

  if (topIssues.length)
    console.log(
      "\nTop issues:\n" +
        topIssues
          .map((issue) => {
            const location = [issue.file, issue.line].filter(Boolean).join(":");
            return `- [${issue.severity}] ${issue.rule} ${
              location ? `(${location}) ` : ""
            }${issue.message}`;
          })
          .join("\n")
    );

  if (process.argv.includes("--strict")) {
    const strictIssues = report.issues.filter(
      ({ severity, rule }) => severity === "error" || config.strictRules.includes(rule)
    );

    if (strictIssues.length) {
      console.error(`\nStrict CSS audit failed: ${strictIssues.length} issue(s).`);
      process.exitCode = 1;
    }
  }
};

main().catch((error) => {
  console.error("CSS audit failed:", error);
  process.exitCode = 1;
});
