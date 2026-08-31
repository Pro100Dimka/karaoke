export default function getDataByFields(values) {
  function fields(object, ancestors = new Set()) {
    if (!object || typeof object !== "object" || ancestors.has(object)) return [];
    const visited = new Set([...ancestors, object]);
    return Object.keys(object).flatMap((key) => {
      const value = Array.isArray(object[key]) ? object[key][0] : object[key];
      const nested =
        value && Object.getPrototypeOf(value) === Object.prototype ? fields(value, visited) : [];
      return nested.length ? nested.map((path) => `${key}.${path}`) : key;
    });
  }
  return fields(values).join(",");
}
