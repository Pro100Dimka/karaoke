import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import process from "node:process";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";

const PROJECT_ROOT = process.cwd();
const SRC_ROOT = resolve(PROJECT_ROOT, "src");
const REPORTS_ROOT = resolve(PROJECT_ROOT, "reports");
const REPORT_PATH = resolve(REPORTS_ROOT, "css-audit.json");
const CONFIG_PATH = resolve(PROJECT_ROOT, "css-audit.config.json");

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);
const CSS_EXTENSIONS = new Set([".css"]);

const DEFAULT_CONFIG = {
  ignoreClasses: [
    "active",
    "disabled",
    "error",
    "loading",
    "open",
    "selected",
    "visible"
  ],
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
  strictRules: [
    "invalid-css",
    "transition-all",
    "javascript-url",
    "extreme-z-index"
  ]
};

const COLOR_PATTERN =
  /(?:#[\da-f]{3,8}\b|rgba?\([^)]+\)|hsla?\([^)]+\)|color-mix\([^)]+\))/gi;

const SIZE_PATTERN =
  /(?<![\w-])-?(?:\d*\.)?\d+(?:px|rem|em|vh|vw|vmin|vmax|ch|ex)\b/gi;

const CLASS_NAME_ATTRIBUTE_PATTERN =
  /\bclassName\s*=\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g;

const CLASS_ATTRIBUTE_PATTERN = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

const CLASS_LIST_PATTERN =
  /classList\.(?:add|remove|toggle|contains)\s*\(\s*["'`]([^"'`]+)["'`]/g;

const GET_BY_CLASS_PATTERN =
  /getElementsByClassName\s*\(\s*["'`]([^"'`]+)["'`]/g;

const QUERY_SELECTOR_PATTERN =
  /querySelector(?:All)?\s*\(\s*["'`]([^"'`]+)["'`]/g;

const PROPERTY_GROUPS = {
  colors: new Set([
    "color",
    "background",
    "background-color",
    "border-color",
    "outline-color",
    "box-shadow",
    "text-shadow",
    "fill",
    "stroke"
  ]),
  spacing: new Set([
    "gap",
    "row-gap",
    "column-gap",
    "margin",
    "margin-top",
    "margin-right",
    "margin-bottom",
    "margin-left",
    "padding",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left"
  ]),
  typography: new Set([
    "font",
    "font-family",
    "font-size",
    "font-weight",
    "line-height",
    "letter-spacing"
  ]),
  radius: new Set(["border-radius"]),
  shadow: new Set(["box-shadow", "text-shadow"]),
  transition: new Set([
    "transition",
    "transition-property",
    "transition-duration",
    "transition-timing-function"
  ]),
  zIndex: new Set(["z-index"])
};

function createIssue({
  rule,
  severity = "warning",
  message,
  file,
  line,
  column,
  selector,
  property,
  value,
  details
}) {
  return {
    rule,
    severity,
    message,
    file,
    line,
    column,
    selector,
    property,
    value,
    details
  };
}

async function pathExists(path) {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

async function loadConfig() {
  if (!(await pathExists(CONFIG_PATH))) {
    return DEFAULT_CONFIG;
  }

  try {
    const source = await readFile(CONFIG_PATH, "utf8");
    const config = JSON.parse(source);

    return {
      ...DEFAULT_CONFIG,
      ...config,
      ignoreClasses: [
        ...DEFAULT_CONFIG.ignoreClasses,
        ...(config.ignoreClasses ?? [])
      ],
      ignoreClassPatterns: [
        ...DEFAULT_CONFIG.ignoreClassPatterns,
        ...(config.ignoreClassPatterns ?? [])
      ]
    };
  } catch (error) {
    console.warn(
      `Не удалось прочитать css-audit.config.json: ${error.message}`
    );

    return DEFAULT_CONFIG;
  }
}

async function walk(directory, extensions) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await walk(path, extensions)));
    } else if (extensions.has(extname(entry.name).toLowerCase())) {
      files.push(path);
    }
  }

  return files;
}

function normalizeFile(path) {
  return relative(PROJECT_ROOT, path).replaceAll("\\", "/");
}

function addUsage(map, key, location) {
  if (!map.has(key)) {
    map.set(key, []);
  }

  map.get(key).push(location);
}

function splitClasses(value) {
  return String(value)
    .replace(/\$\{[^}]*\}/g, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(
      (item) =>
        item &&
        !item.includes("{") &&
        !item.includes("}") &&
        !item.includes("$")
    );
}

function collectClassesFromSource(source, file, usage, dynamicFragments) {
  const collectAttributeMatches = (pattern) => {
    for (const match of source.matchAll(pattern)) {
      const value = match[1] ?? match[2] ?? match[3] ?? "";

      for (const className of splitClasses(value)) {
        addUsage(usage, className, { file });
      }

      if (value.includes("${")) {
        dynamicFragments.add(value);
      }
    }
  };

  collectAttributeMatches(CLASS_NAME_ATTRIBUTE_PATTERN);
  collectAttributeMatches(CLASS_ATTRIBUTE_PATTERN);

  for (const match of source.matchAll(CLASS_LIST_PATTERN)) {
    for (const className of splitClasses(match[1])) {
      addUsage(usage, className, { file });
    }
  }

  for (const match of source.matchAll(GET_BY_CLASS_PATTERN)) {
    for (const className of splitClasses(match[1])) {
      addUsage(usage, className, { file });
    }
  }

  for (const match of source.matchAll(QUERY_SELECTOR_PATTERN)) {
    const selector = match[1];

    for (const classMatch of selector.matchAll(/\.([a-zA-Z_][\w-]*)/g)) {
      addUsage(usage, classMatch[1], { file });
    }
  }

  for (const match of source.matchAll(
    /["'`]([a-zA-Z_][\w-]*(?:--[a-zA-Z0-9_-]+)+)["'`]/g
  )) {
    addUsage(usage, match[1], { file });
  }
}

function getSelectorClasses(selector) {
  const classes = [];

  try {
    selectorParser((root) => {
      root.walkClasses((node) => {
        classes.push(node.value);
      });
    }).processSync(selector);
  } catch {
    for (const match of selector.matchAll(/\.([a-zA-Z_][\w-]*)/g)) {
      classes.push(match[1]);
    }
  }

  return classes;
}

function getSelectorSpecificity(selector) {
  let ids = 0;
  let classes = 0;
  let elements = 0;

  try {
    selectorParser((root) => {
      root.walk((node) => {
        if (node.type === "id") {
          ids += 1;
        } else if (["class", "attribute", "pseudo"].includes(node.type)) {
          if (
            node.type !== "pseudo" ||
            !["::before", "::after", "::first-letter", "::first-line"].includes(
              node.value
            )
          ) {
            classes += 1;
          } else {
            elements += 1;
          }
        } else if (node.type === "tag") {
          elements += 1;
        }
      });
    }).processSync(selector);
  } catch {
    ids = (selector.match(/#[\w-]+/g) ?? []).length;
    classes = (selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? [])
      .length;
    elements = (selector.match(/(?:^|[\s>+~])([a-z][\w-]*)/gi) ?? []).length;
  }

  return {
    ids,
    classes,
    elements,
    score: ids * 100 + classes * 10 + elements
  };
}

function getSelectorDepth(selector) {
  return selector.split(/\s+|>|\+|~/).filter(Boolean).length;
}

function getAtRuleContext(node) {
  const context = [];
  let current = node.parent;

  while (current) {
    if (current.type === "atrule") {
      context.unshift(
        `@${current.name}${current.params ? ` ${current.params}` : ""}`
      );
    }

    current = current.parent;
  }

  return context.join(" > ");
}

function isIgnoredClass(className, config) {
  if (config.ignoreClasses.includes(className)) {
    return true;
  }

  return config.ignoreClassPatterns.some((pattern) =>
    new RegExp(pattern).test(className)
  );
}

function getDynamicClassBase(className) {
  if (className.includes("--")) {
    return className.slice(0, className.indexOf("--") + 2);
  }
  if (className.includes("-")) {
    return className.slice(0, className.lastIndexOf("-") + 1);
  }
  return className;
}

function couldBeDynamic(className, dynamicFragments, config) {
  if (
    config.generatedClassPrefixes.some((prefix) => className.startsWith(prefix))
  ) {
    return true;
  }

  const base = getDynamicClassBase(className);

  return [...dynamicFragments].some((fragment) => {
    const staticParts = fragment
      .split(/\$\{[^}]*\}/)
      .map((part) => part.trim())
      .filter(Boolean);

    return (
      staticParts.some((part) => className.includes(part)) ||
      Boolean(base && fragment.includes(base))
    );
  });
}

function normalizeValue(value) {
  return String(value)
    .replace(/\s*!important\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function registerRepeatedValue(map, property, value, location) {
  const normalized = normalizeValue(value);

  if (!normalized || normalized.startsWith("var(")) {
    return;
  }

  const key = `${property}:${normalized}`;

  if (!map.has(key)) {
    map.set(key, {
      property,
      value: normalized,
      locations: []
    });
  }

  map.get(key).locations.push(location);
}

function extractBreakpoint(params) {
  const match = params.match(/(?:max|min)-width\s*:\s*(\d+(?:\.\d+)?)px/i);

  return match ? Number(match[1]) : null;
}

function hasJavaScriptUrl(value) {
  return /url\(\s*["']?\s*javascript:/i.test(value);
}

function parseZIndex(value) {
  const normalized = normalizeValue(value);

  if (!/^-?\d+$/.test(normalized)) {
    return null;
  }

  return Number(normalized);
}

function sortIssues(issues) {
  const order = {
    error: 0,
    warning: 1,
    info: 2
  };

  return issues.sort((a, b) => {
    const severityDifference =
      (order[a.severity] ?? 99) - (order[b.severity] ?? 99);

    if (severityDifference !== 0) {
      return severityDifference;
    }

    return (
      String(a.file).localeCompare(String(b.file)) ||
      (a.line ?? 0) - (b.line ?? 0)
    );
  });
}

async function main() {
  const config = await loadConfig();

  const [cssFiles, sourceFiles] = await Promise.all([
    walk(SRC_ROOT, CSS_EXTENSIONS),
    walk(SRC_ROOT, SOURCE_EXTENSIONS)
  ]);

  const sourceClassUsage = new Map();
  const dynamicFragments = new Set();

  for (const filePath of sourceFiles) {
    const source = await readFile(filePath, "utf8");

    collectClassesFromSource(
      source,
      normalizeFile(filePath),
      sourceClassUsage,
      dynamicFragments
    );
  }

  const issues = [];
  const selectorDefinitions = new Map();
  const classDefinitions = new Map();
  const repeatedValues = new Map();
  const propertyValueCounts = new Map();
  const mediaBreakpoints = new Map();
  const fileStats = [];

  for (const filePath of cssFiles) {
    const file = normalizeFile(filePath);
    const source = await readFile(filePath, "utf8");
    const lines = source.split(/\r?\n/).length;

    fileStats.push({
      file,
      lines,
      bytes: Buffer.byteLength(source, "utf8")
    });

    if (lines > config.maxFileLines) {
      issues.push(
        createIssue({
          rule: "large-css-file",
          severity: "warning",
          message: `CSS-файл содержит ${lines} строк.`,
          file,
          line: 1,
          details: {
            recommendedMaximum: config.maxFileLines
          }
        })
      );
    }

    let root;

    try {
      root = postcss.parse(source, { from: filePath });
    } catch (error) {
      issues.push(
        createIssue({
          rule: "invalid-css",
          severity: "error",
          message: error.reason ?? error.message,
          file,
          line: error.line,
          column: error.column
        })
      );

      continue;
    }

    root.walkAtRules("media", (rule) => {
      const breakpoint = extractBreakpoint(rule.params);

      if (breakpoint == null) {
        return;
      }

      addUsage(mediaBreakpoints, breakpoint, {
        file,
        line: rule.source?.start?.line
      });

      if (!config.allowedBreakpoints.includes(breakpoint)) {
        issues.push(
          createIssue({
            rule: "nonstandard-breakpoint",
            severity: "warning",
            message: `Использован нестандартный breakpoint ${breakpoint}px.`,
            file,
            line: rule.source?.start?.line,
            value: `${breakpoint}px`
          })
        );
      }
    });

    root.walkRules((rule) => {
      const selectors = rule.selectors ?? [rule.selector];

      for (const selector of selectors) {
        const normalizedSelector = selector.trim();

        if (!normalizedSelector) {
          continue;
        }

        const context = getAtRuleContext(rule);
        const location = {
          file,
          line: rule.source?.start?.line,
          column: rule.source?.start?.column,
          context,
          selector: normalizedSelector
        };
        const selectorKey = context
          ? `${context} :: ${normalizedSelector}`
          : normalizedSelector;

        addUsage(selectorDefinitions, selectorKey, location);

        for (const className of getSelectorClasses(normalizedSelector)) {
          addUsage(classDefinitions, className, {
            ...location,
            selector: normalizedSelector
          });
        }

        const specificity = getSelectorSpecificity(normalizedSelector);
        const depth = getSelectorDepth(normalizedSelector);

        if (specificity.score > config.maxSelectorSpecificity) {
          issues.push(
            createIssue({
              rule: "high-specificity",
              severity: "warning",
              message: `Высокая специфичность селектора: ${specificity.score}.`,
              file,
              line: location.line,
              selector: normalizedSelector,
              details: specificity
            })
          );
        }

        if (depth > config.maxSelectorDepth) {
          issues.push(
            createIssue({
              rule: "deep-selector",
              severity: "warning",
              message: `Глубина селектора: ${depth}.`,
              file,
              line: location.line,
              selector: normalizedSelector
            })
          );
        }

        if (/#[-_a-zA-Z][\w-]*/.test(normalizedSelector)) {
          issues.push(
            createIssue({
              rule: "id-selector",
              severity: "info",
              message: "CSS использует ID-селектор.",
              file,
              line: location.line,
              selector: normalizedSelector
            })
          );
        }
      }

      const declarationsByProperty = new Map();

      rule.walkDecls((declaration) => {
        const property = declaration.prop.toLowerCase();
        const { value } = declaration;
        const normalizedValue = normalizeValue(value);
        const location = {
          file,
          line: declaration.source?.start?.line,
          column: declaration.source?.start?.column,
          selector: rule.selector
        };

        if (!declarationsByProperty.has(property)) {
          declarationsByProperty.set(property, []);
        }

        declarationsByProperty.get(property).push({
          value: normalizedValue,
          location
        });

        registerRepeatedValue(
          repeatedValues,
          property,
          normalizedValue,
          location
        );

        const propertyValueKey = `${property}:${normalizedValue}`;
        propertyValueCounts.set(
          propertyValueKey,
          (propertyValueCounts.get(propertyValueKey) ?? 0) + 1
        );

        if (
          declaration.important &&
          !config.allowedImportantSelectors.includes(rule.selector)
        ) {
          issues.push(
            createIssue({
              rule: "important",
              severity: "warning",
              message: "Использован !important.",
              file,
              line: location.line,
              selector: rule.selector,
              property,
              value
            })
          );
        }

        if (
          property === "transition" &&
          /(?:^|\s|,)all(?:\s|,|$)/i.test(normalizedValue)
        ) {
          issues.push(
            createIssue({
              rule: "transition-all",
              severity: "error",
              message:
                "transition: all может вызывать непредсказуемые анимации.",
              file,
              line: location.line,
              selector: rule.selector,
              property,
              value
            })
          );
        }

        if (hasJavaScriptUrl(value)) {
          issues.push(
            createIssue({
              rule: "javascript-url",
              severity: "error",
              message: "Обнаружен javascript: URL внутри CSS.",
              file,
              line: location.line,
              selector: rule.selector,
              property,
              value
            })
          );
        }

        if (property === "z-index") {
          const zIndex = parseZIndex(value);

          if (zIndex != null && !config.allowedZIndexes.includes(zIndex)) {
            issues.push(
              createIssue({
                rule:
                  Math.abs(zIndex) >= 10000
                    ? "extreme-z-index"
                    : "nonstandard-z-index",
                severity: Math.abs(zIndex) >= 10000 ? "error" : "warning",
                message: `Нестандартный z-index: ${zIndex}.`,
                file,
                line: location.line,
                selector: rule.selector,
                property,
                value
              })
            );
          }
        }

        if (property === "writing-mode" && /vertical/i.test(value)) {
          issues.push(
            createIssue({
              rule: "vertical-writing-mode",
              severity: "warning",
              message:
                "Вертикальный writing-mode требует ручной визуальной проверки.",
              file,
              line: location.line,
              selector: rule.selector,
              property,
              value
            })
          );
        }

        if (
          ["width", "min-width", "max-width"].includes(property) &&
          /\b(?:fit-content|min-content|max-content)\b/i.test(value)
        ) {
          issues.push(
            createIssue({
              rule: "intrinsic-width",
              severity: "warning",
              message: "Intrinsic width может схлопывать flex/grid-элементы.",
              file,
              line: location.line,
              selector: rule.selector,
              property,
              value
            })
          );
        }

        for (const color of value.match(COLOR_PATTERN) ?? []) {
          registerRepeatedValue(
            repeatedValues,
            "color-token-candidate",
            color.toLowerCase(),
            location
          );
        }

        for (const size of value.match(SIZE_PATTERN) ?? []) {
          registerRepeatedValue(
            repeatedValues,
            "size-token-candidate",
            size.toLowerCase(),
            location
          );
        }
      });

      for (const [property, declarations] of declarationsByProperty) {
        const uniqueValues = [
          ...new Set(declarations.map((item) => item.value))
        ];

        if (uniqueValues.length > 1) {
          issues.push(
            createIssue({
              rule: "conflicting-declarations",
              severity: "warning",
              message:
                `Свойство ${property} объявлено несколько раз ` +
                `с разными значениями в одном блоке.`,
              file,
              line: rule.source?.start?.line,
              selector: rule.selector,
              property,
              details: declarations
            })
          );
        }
      }
    });
  }

  for (const [selector, locations] of selectorDefinitions) {
    if (
      locations.length > 1 &&
      !config.allowedDuplicateSelectors.includes(selector)
    ) {
      issues.push(
        createIssue({
          rule: "duplicate-selector",
          severity: "warning",
          message: `Селектор объявлен ${locations.length} раз.`,
          file: locations[0].file,
          line: locations[0].line,
          selector,
          details: locations
        })
      );
    }
  }

  const unusedClasses = [];
  const dynamicClassCandidates = [];

  for (const [className, locations] of classDefinitions) {
    if (isIgnoredClass(className, config)) {
      continue;
    }

    if (sourceClassUsage.has(className)) {
      continue;
    }

    if (couldBeDynamic(className, dynamicFragments, config)) {
      dynamicClassCandidates.push({
        className,
        locations
      });

      continue;
    }

    unusedClasses.push({
      className,
      locations
    });

    issues.push(
      createIssue({
        rule: "unused-class-candidate",
        severity: "info",
        message: `Класс .${className} не найден в статическом исходном коде.`,
        file: locations[0]?.file,
        line: locations[0]?.line,
        selector: `.${className}`,
        details: locations
      })
    );
  }

  const repeatedValueReport = [...repeatedValues.values()]
    .filter((entry) => entry.locations.length >= config.repeatedValueMinimum)
    .sort((a, b) => b.locations.length - a.locations.length);

  const duplicateSelectors = [...selectorDefinitions.entries()]
    .filter(([, locations]) => locations.length > 1)
    .map(([selectorKey, locations]) => ({
      selector: locations[0]?.selector ?? selectorKey,
      context: locations[0]?.context ?? "",
      count: locations.length,
      locations
    }))
    .sort((a, b) => b.count - a.count);

  const issueCounts = issues.reduce(
    (counts, { severity }) => {
      if (Object.hasOwn(counts, severity)) counts[severity] += 1;
      return counts;
    },
    { error: 0, warning: 0, info: 0 }
  );

  const report = {
    generatedAt: new Date().toISOString(),
    root: PROJECT_ROOT,
    summary: {
      cssFiles: cssFiles.length,
      sourceFiles: sourceFiles.length,
      selectors: selectorDefinitions.size,
      classesDefined: classDefinitions.size,
      classesUsed: sourceClassUsage.size,
      unusedClassCandidates: unusedClasses.length,
      dynamicClassCandidates: dynamicClassCandidates.length,
      duplicateSelectors: duplicateSelectors.length,
      repeatedValues: repeatedValueReport.length,
      breakpoints: mediaBreakpoints.size,
      issues: issues.length,
      errors: issueCounts.error,
      warnings: issueCounts.warning,
      info: issueCounts.info
    },
    fileStats: fileStats.sort((a, b) => b.lines - a.lines),
    breakpoints: [...mediaBreakpoints.entries()]
      .map(([value, locations]) => ({
        value,
        count: locations.length,
        locations
      }))
      .sort((a, b) => a.value - b.value),
    unusedClasses,
    dynamicClassCandidates,
    duplicateSelectors,
    repeatedValues: repeatedValueReport,
    issues: sortIssues(issues)
  };

  await mkdir(REPORTS_ROOT, { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log("\nCSS FULL AUDIT");
  console.log("==============");
  console.log(`CSS files: ${report.summary.cssFiles}`);
  console.log(`Selectors: ${report.summary.selectors}`);
  console.log(`Classes defined: ${report.summary.classesDefined}`);
  console.log(
    `Unused class candidates: ${report.summary.unusedClassCandidates}`
  );
  console.log(
    `Dynamic class candidates: ${report.summary.dynamicClassCandidates}`
  );
  console.log(`Duplicate selectors: ${report.summary.duplicateSelectors}`);
  console.log(`Repeated value groups: ${report.summary.repeatedValues}`);
  console.log(`Errors: ${report.summary.errors}`);
  console.log(`Warnings: ${report.summary.warnings}`);
  console.log(`Info: ${report.summary.info}`);
  console.log(`\nReport: ${normalizeFile(REPORT_PATH)}`);

  const topIssues = report.issues
    .filter((issue) => issue.severity !== "info")
    .slice(0, 30);

  if (topIssues.length > 0) {
    console.log("\nTop issues:");

    for (const issue of topIssues) {
      const location = [issue.file, issue.line].filter(Boolean).join(":");

      console.log(
        `- [${issue.severity}] ${issue.rule} ` +
          `${location ? `(${location}) ` : ""}${issue.message}`
      );
    }
  }

  const strict = process.argv.includes("--strict");

  if (strict) {
    const strictIssues = report.issues.filter(
      (issue) =>
        issue.severity === "error" || config.strictRules.includes(issue.rule)
    );

    if (strictIssues.length > 0) {
      console.error(
        `\nStrict CSS audit failed: ${strictIssues.length} issue(s).`
      );
      process.exitCode = 1;
    }
  }
}

main().catch((error) => {
  console.error("CSS audit failed:");
  console.error(error);
  process.exitCode = 1;
});
