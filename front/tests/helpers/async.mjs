export const deferred = () => Promise.withResolvers();
export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
