/** Transport errors may include provider URLs whose path/query contains credentials. */
export function safeText(text: string): string {
  return text.replace(/https?:\/\/[^\s"'<>)]*/g, (url) =>
    /^https:\/\/bscscan\.com\/(?:tx|address)\/0x[0-9a-fA-F]+$/.test(url)
      ? url
      : "[source URL omitted]",
  );
}

/** JSON output shares exactly the same integer serialization for MCP and the CLI. */
export function outputJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "bigint" ? item.toString() : typeof item === "string" ? safeText(item) : item,
  );
}
