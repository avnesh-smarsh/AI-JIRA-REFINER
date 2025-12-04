"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MCPManager = void 0;
const vscode = __importStar(require("vscode"));
const index_js_1 = require("@modelcontextprotocol/sdk/client/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/client/stdio.js");
class MCPManager {
    clients = new Map();
    async connectAll() {
        const config = vscode.workspace.getConfiguration('jiraRefiner');
        const servers = config.get('mcpServers') || {};
        for (const [name, cfg] of Object.entries(servers)) {
            try {
                // If connecting to the internal mock server, resolve the path
                const cmd = cfg.command === "node" && cfg.args[0].includes("mockServer.js")
                    ? "node"
                    : cfg.command;
                // Fix path for internal mock server execution context
                const args = cfg.args.map(arg => arg.includes("mockServer.js") ? __dirname + "/mockServer.js" : arg);
                const transport = new stdio_js_1.StdioClientTransport({
                    command: cmd,
                    args: args
                });
                const client = new index_js_1.Client({ name: "jira-refiner-client", version: "1.0.0" }, { capabilities: {} });
                await client.connect(transport);
                this.clients.set(name, client);
                console.log(`✅ Connected to MCP Server: ${name}`);
            }
            catch (e) {
                console.error(`❌ Failed to connect to ${name}:`, e);
            }
        }
    }
    async callTool(serverName, toolName, args) {
        const client = this.clients.get(serverName);
        if (!client)
            throw new Error(`Server ${serverName} not connected.`);
        return await client.callTool({
            name: toolName,
            arguments: args
        });
    }
    getClientNames() {
        return Array.from(this.clients.keys());
    }
}
exports.MCPManager = MCPManager;
//# sourceMappingURL=mcpClient.js.map