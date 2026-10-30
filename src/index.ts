#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getIpoDetails, listIpos, resolveSlug, searchIpos } from "./ipoji.js";

const server = new McpServer({
  name: "ipoji-mcp-server",
  version: "0.1.0",
});

const json = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

const ipoInput = z
  .string()
  .min(2)
  .describe('Company name (e.g. "BLS Polymers") or IPO Ji slug (e.g. "bls-polymers-ipo")');

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
