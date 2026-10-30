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

| Tool   | Description                              |
| ------ | ---------------------------------------- |
| `ping` | Health check; echoes back an optional message. |

Add new tools in `src/index.ts` with `server.registerTool(...)`.
