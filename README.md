# ipoji-mcp-server

MCP (Model Context Protocol) server for Ipoji, written in TypeScript and served over stdio.

## Setup

```bash
npm install
npm run build
```

## Run

```bash
npm start          # runs dist/index.js on stdio
npm run inspect    # opens the MCP Inspector against the built server
```

## Use with Claude Code

```bash
claude mcp add ipoji -- node /Users/akhil/ipoji-mcp-server/dist/index.js
```

## Tools

All data is read from IPO Ji's public pages (www.ipoji.com). Pages are cached for 5 minutes and the IPO sitemap for 1 hour.

| Tool                | Input                          | Returns |
| ------------------- | ------------------------------ | ------- |
| `list_ipos`         | `status?` (current / upcoming / listed), `board?` (mainboard / sme) | IPOs with dates, price band, lot size, subscription, issue size, expected premium, and listing date/price for listed ones |
| `get_ipo_status`    | `ipo` (company name or slug)   | Current stage (Live, Closed, Allotment Out, Listed…) plus the open / close / allotment / listing timeline and key facts |
| `get_ipo_allotment` | `ipo` (company name or slug)   | Whether allotment is out, allotment and listing dates, registrar, and links to check allotment on the registrar, BSE, NSE and IPO Ji |
| `search_ipos`       | `query`                        | Matching IPO slugs, for when a name resolves to the wrong IPO |

`get_ipo_allotment` does not check an individual application. That needs a PAN on the registrar's site or a logged-in IPO Ji account.

The parsing lives in `src/ipoji.ts` and depends on IPO Ji's HTML, so it will need updating if the site's markup changes.
