export {};

declare global {
  interface WebMCPTool {
    name: string;
    title?: string;
    description: string;
    inputSchema: object;
    annotations?: {
      readOnlyHint?: boolean;
      untrustedContentHint?: boolean;
    };
    execute(input: unknown): unknown;
  }

  interface WebMCPModelContext {
    registerTool(
      tool: WebMCPTool,
      options?: { signal?: AbortSignal },
    ): void | Promise<void>;
  }

  interface Document {
    readonly modelContext?: WebMCPModelContext;
  }
}
