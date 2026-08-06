function normalizeFolderName(value) {
  return String(value || "")
    .toLocaleLowerCase("ru")
    .replace(/[^a-zа-яё0-9]+/giu, "")
    .trim();
}

function findMatchingSongFolder(entries, requestedValues) {
  const requestedNames = requestedValues.map(normalizeFolderName).filter(Boolean);
  if (requestedNames.length === 0) return null;

  const directories = entries
    .filter((entry) => entry?.isDirectory?.())
    .map((entry) => ({ entry, normalizedName: normalizeFolderName(entry.name) }))
    .filter(({ normalizedName }) => normalizedName);

  const exact = directories.find(({ normalizedName }) =>
    requestedNames.includes(normalizedName)
  );
  if (exact) return exact.entry;

  const partial = directories.filter(({ normalizedName }) =>
    requestedNames.some(
      (requested) =>
        normalizedName.includes(requested) || requested.includes(normalizedName)
    )
  );
  return partial.length === 1 ? partial[0].entry : null;
}

module.exports = { findMatchingSongFolder, normalizeFolderName };
