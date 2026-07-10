/** 工具入参 schema 是否值得渲染折叠:非空对象 → true;null/undefined/非对象/空对象 → false。 */
export function hasToolParams(parameters: unknown): boolean {
  return parameters != null && typeof parameters === 'object'
    && Object.keys(parameters as object).length > 0
}
