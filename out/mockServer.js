"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const server = new index_js_1.Server({
    name: "mock-data-server",
    version: "1.0.0",
}, { capabilities: { tools: {} } });
server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "get_issue",
                description: "Fetch Jira issue details",
                inputSchema: {
                    type: "object",
                    properties: { issueId: { type: "string" } }
                }
            },
            {
                name: "search_repositories",
                description: "Search GitHub Repos",
                inputSchema: {
                    type: "object",
                    properties: { query: { type: "string" } }
                }
            },
            {
                name: "search_confluence",
                description: "Search Confluence pages",
                inputSchema: { type: "object", properties: { query: { type: "string" } } }
            }
        ]
    };
});
server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    if (name === "get_issue") {
        // Mock Jira Data
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        key: args.issueId,
                        summary: "Refactor Search Service for high latency",
                        description: "The search service is taking >2s for results. We need to optimize the query builder.",
                        status: "Open"
                    })
                }]
        };
    }
    if (name === "search_repositories") {
        // Mock GitHub Data
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify([
                        { name: "search-service-api", url: "https://github.com/org/search-service", description: "Main API for search" },
                        { name: "common-utils", url: "https://github.com/org/common-utils", description: "Shared libraries" }
                    ])
                }]
        };
    }
    return { content: [{ type: "text", text: "Unknown tool" }] };
});
const transport = new stdio_js_1.StdioServerTransport();
// ... imports and server setup ...
// WRAP THIS LOGIC IN AN ASYNC FUNCTION
async function runServer() {
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
    console.error("Mock Jira MCP Server running on stdio...");
}
runServer().catch((err) => {
    console.error("Fatal error running mock server:", err);
});
//# sourceMappingURL=mockServer.js.map