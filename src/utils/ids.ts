export const createId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for older browsers
  const rand = Math.random().toString(36).slice(2);
  const time = Date.now().toString(36);
  return `${time}-${rand}`;
};
