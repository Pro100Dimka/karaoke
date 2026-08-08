export function openingTags(source, tagName) {
  const tags = [];
  const prefix = tagName ? `<${tagName}` : "<";
  for (
    let start = source.indexOf(prefix);
    start >= 0;
    start = source.indexOf(prefix, start + 1)
  ) {
    if (!tagName && !/[A-Za-z]/.test(source[start + 1] ?? "")) continue;
    let quote = null;
    let braces = 0;
    for (let index = start + prefix.length; index < source.length; index += 1) {
      const char = source[index];
      if (quote) {
        if (char === quote && source[index - 1] !== "\\") quote = null;
      } else if (char === '"' || char === "'") quote = char;
      else if (char === "{") braces += 1;
      else if (char === "}") braces = Math.max(0, braces - 1);
      else if (char === ">" && braces === 0) {
        tags.push(source.slice(start, index + 1));
        start = index;
        break;
      }
    }
  }
  return tags;
}

export function duplicateAttributes(tag) {
  let braces = 0;
  let quote = null;
  let body = "";
  for (let index = 0; index < tag.length; index += 1) {
    const character = tag[index];
    if (quote) {
      if (character === quote && tag[index - 1] !== "\\") quote = null;
      if (braces === 0) body += character;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      if (braces === 0) body += character;
    } else if (character === "{") {
      braces += 1;
      if (braces === 1) body += " ";
    } else if (character === "}") {
      braces = Math.max(0, braces - 1);
    } else if (braces === 0) {
      body += character;
    }
  }
  body = body.replace(/^<\S+/, "").replace(/\/?\s*>$/, "");
  const names = [
    ...body.matchAll(/(?:^|\s)([A-Za-z_:][\w:.-]*)\s*(?==|\s|$)/g)
  ].map((match) => match[1]);
  return [
    ...new Set(names.filter((name, index) => names.indexOf(name) !== index))
  ];
}

export function importedAndDeclaredNames(source) {
  const names = new Set(["Fragment"]);
  for (const statement of source.matchAll(
    /import[\s\S]*?from\s+["'][^"']+["'];?/g
  )) {
    const text = statement[0];
    const defaultImport = text.match(/^import\s+([A-Z]\w*)/);
    if (defaultImport) names.add(defaultImport[1]);
    const named = text.match(/\{([\s\S]*?)\}/);
    if (named)
      for (const part of named[1].split(",")) {
        const alias = part
          .trim()
          .split(/\s+as\s+/)
          .at(-1)
          ?.trim();
        if (alias) names.add(alias);
      }
  }
  for (const pattern of [
    /(?:function|class)\s+([A-Z]\w*)/g,
    /const\s+([A-Z]\w*)\s*=/g
  ]) {
    for (const match of source.matchAll(pattern)) names.add(match[1]);
  }
  for (const destructuring of source.matchAll(
    /\{([^{}]*?)\}|\(\s*\[([^\]]+)\]\s*\)\s*=>/g
  )) {
    for (const token of (destructuring[1] ?? destructuring[2]).matchAll(
      /\b([A-Z]\w*)\b/g
    ))
      names.add(token[1]);
  }
  return names;
}
