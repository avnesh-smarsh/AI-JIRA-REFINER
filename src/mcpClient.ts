import * as vscode from 'vscode';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export class MCPManager {
    private clients: Map<string, Client> = new Map();

    async connectAll() {
        const config = vscode.workspace.getConfiguration('jiraRefiner');
        const servers = config.get<Record<string, { command: string, args: string[] }>>('mcpServers') || {};

        for (const [name, cfg] of Object.entries(servers)) {
            try {
                // If connecting to the internal mock server, resolve the path
                const cmd = cfg.command === "node" && cfg.args[0].includes("mockServer.js") 
                    ? "node" 
                    : cfg.command;
                
                // Fix path for internal mock server execution context
                const args = cfg.args.map(arg => 
                    arg.includes("mockServer.js") ? __dirname + "/mockServer.js" : arg
                );

                const transport = new StdioClientTransport({
                    command: cmd,
                    args: args
                });

                const client = new Client({ name: "jira-refiner-client", version: "1.0.0" }, { capabilities: {} });
                await client.connect(transport);
                this.clients.set(name, client);
                console.log(`✅ Connected to MCP Server: ${name}`);
            } catch (e) {
                console.error(`❌ Failed to connect to ${name}:`, e);
            }
        }
    }

    async callTool(serverName: string, toolName: string, args: any) {
        const client = this.clients.get(serverName);
        if (!client) throw new Error(`Server ${serverName} not connected.`);
        
        return await client.callTool({
            name: toolName,
            arguments: args
        });
    }

    getClientNames() {
        return Array.from(this.clients.keys());
    }
}