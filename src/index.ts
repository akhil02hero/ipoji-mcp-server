#!/usr/bin/env node
/**
 * IPO Ji MCP server.
 *
 * Gives AI assistants such as Claude tools to look up Indian IPOs:
 * list IPOs, check an IPO's status and dates, and get allotment info.
 * The data comes from www.ipoji.com (see ipoji.ts).
 *
 * The server talks to the assistant over stdin/stdout (the "stdio" transport):
 * the assistant starts this program and sends it requests as JSON lines.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getIpoDetails, listIpos, resolveSlug, searchIpos } from "./ipoji.js";

const server = new McpServer({
  name: "ipoji-mcp-server",
  version: "0.1.0",
});

// Wraps a tool's result as formatted JSON text, the shape MCP expects a tool to return.
const json = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

// The "which IPO?" input shared by get_ipo_status and get_ipo_allotment.
const ipoInput = z
  .string()
  .min(2)
  .describe('Company name (e.g. "BLS Polymers") or IPO Ji slug (e.g. "bls-polymers-ipo")');

// Each tool below has a description that the assistant reads to decide when to
// use it. readOnlyHint says the tool changes nothing; openWorldHint says it
// reaches out to an outside website.

// list_ipos: IPOs shown on the IPO Ji homepage.
server.registerTool(
  "list_ipos",
  {
    title: "List IPOs",
    description:
      "List current, upcoming or recently listed IPOs on IPO Ji with dates, price band, lot size, subscription, issue size and expected premium (GMP).",
    inputSchema: {
      status: z.enum(["current", "upcoming", "listed"]).optional().describe("Filter by stage; omit for all"),
      board: z.enum(["mainboard", "sme"]).optional().describe("Filter by board; omit for both"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ status, board }) => json(await listIpos({ status, board })),
);

// search_ipos: find the right IPO when a company name is ambiguous.
server.registerTool(
  "search_ipos",
  {
    title: "Search IPOs",
    description: "Find IPO Ji slugs for a company name. Use when get_ipo_status picks the wrong IPO.",
    inputSchema: { query: z.string().min(2).describe("Company name or part of it") },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ query }) => json(await searchIpos(query)),
);

// get_ipo_status: where an IPO is in its life cycle and its key dates.
server.registerTool(
  "get_ipo_status",
  {
    title: "Get IPO status",
    description:
      "Current stage of an IPO (e.g. Live, Closed, Allotment Out, Listed) and its timeline: open, close, allotment and listing dates with whether each is completed or upcoming. Also returns price band, lot size, exchanges and registrar.",
    inputSchema: { ipo: ipoInput },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ ipo }) => {
    const d = await getIpoDetails(await resolveSlug(ipo));
    return json({
      name: d.name,
      fullName: d.fullName,
      slug: d.slug,
      board: d.board,
      status: d.status,
      timeline: d.timeline,
      facts: d.facts,
      url: d.detailsUrl,
    });
  },
);

// get_ipo_allotment: whether allotment is out and where to check your own result.
server.registerTool(
  "get_ipo_allotment",
  {
    title: "Get IPO allotment info",
    description:
      "Allotment info for an IPO: whether allotment is out, the allotment and listing dates, the registrar, and links to check your own allotment (registrar, BSE, NSE, IPO Ji). Does not check an individual application; that needs PAN on the registrar or a logged-in IPO Ji account.",
    inputSchema: { ipo: ipoInput },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ ipo }) => {
    const d = await getIpoDetails(await resolveSlug(ipo));
    // Finds a timeline step by the start of its label, e.g. "Allotment" -> "Allotment Date".
    const step = (label: string) => d.timeline.find((s) => s.label.startsWith(label)) ?? null;
    const allotment = step("Allotment");
    return json({
      name: d.name,
      slug: d.slug,
      status: d.status,
      allotmentOut: allotment?.state === "Completed",
      allotmentDate: allotment?.date ?? null,
      listingDate: step("Listing")?.date ?? null,
      summary: d.summary,
      registrar: d.registrar,
      checkAllotmentAt: {
        ipoji: d.allotmentUrl,
        registrar: d.registrar.url,
        bse: d.exchangeCheckLinks.bse,
        nse: d.exchangeCheckLinks.nse,
      },
    });
  },
);

// Starts the server and waits for requests on stdin.
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is reserved for messages to the assistant, so any log
  // output must go to stderr (console.error), never console.log.
  console.error("ipoji-mcp-server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
