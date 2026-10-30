#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "ipoji-mcp-server",
  version: "0.1.0",
});

// Example tool — replace with real Ipoji tools.
server.registerTool(
  "ping",
  {
    title: "Ping",
    description: "Check that the Ipoji MCP server is reachable. Echoes back the given message.",
    inputSchema: { message: z.string().optional().describe("Text to echo back") },
  },
  async ({ message }) => ({
    content: [{ type: "text", text: `pong${message ? `: ${message}` : ""}` }],
  }),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout carries the protocol, so log to stderr only.
  console.error("ipoji-mcp-server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
