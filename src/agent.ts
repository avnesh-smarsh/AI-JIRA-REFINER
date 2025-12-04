import { MCPManager } from "./mcpClient";

export class RefinementAgent {
    constructor(private mcp: MCPManager) {}

    async processTicket(ticketId: string): Promise<string> {
        let log = `Analyzing Ticket: ${ticketId}...\n`;

        // 1. Fetch Ticket Details (Try 'jira' server, fallback to 'mock')
        // In a real setup, you'd use the 'jira' server.
        const server = this.mcp.getClientNames().includes('jira') ? 'jira' : 'mock';
        
        const ticketResult: any = await this.mcp.callTool(server, "get_issue", { issueId: ticketId });
        const ticketData = JSON.parse(ticketResult.content[0].text);
        
        log += `Found Ticket: "${ticketData.summary}"\n`;

        // 2. Extract Keywords for Search
        const keywords = ticketData.summary.split(" ").filter((w: string) => w.length > 3);
        const searchTerm = keywords[0] || "service";

        // 3. Search Repos & Docs (Parallel)
        log += `Searching contexts for "${searchTerm}"...\n`;
        
        const [repos, docs] = await Promise.all([
            this.mcp.callTool(server, "search_repositories", { query: searchTerm }),
            this.mcp.callTool(server, "search_confluence", { query: searchTerm })
        ]);

        // Fix: Cast 'repos' to 'any' to access .content without TS errors
        const repoResult = repos as any; 
        const repoList = JSON.parse(repoResult.content[0].text);
        
        // 4. Synthesize (Simulated LLM Call)
        // In production, you would send `ticketData`, `repoList`, and `docs` to OpenAI/Claude here.
        
        return this.generateMockLLMResponse(ticketData, repoList, log);
    }

    private generateMockLLMResponse(ticket: any, repos: any[], log: string): string {
        return `
# [Refined] ${ticket.summary}

> **Agent Status:**
> ${log.replace(/\n/g, "<br>")}

## 1. Prerequisites & Access
* **Tools:** Node.js v18, Docker, AWS CLI
* **Repositories:** ${repos.map((r: any) => `  * [${r.name}](${r.url}) - *${r.description}*`).join("\n")}
* **Access Required:** Read/Write access to \`${repos[0]?.name || 'repo'}\`

## 2. Problem Description
${ticket.description}

**Business Value:** Enhances system stability by addressing technical debt in the search service.

## 3. Technical Implementation
* **Current Behavior:** The service currently uses an outdated configuration found in \`src/config.ts\`.
* **Proposed Changes:**
    1. Update \`package.json\` dependencies.
    2. Refactor the \`QueryBuilder\` class in \`${repos[0]?.name}\`.
    3. Add unit tests covering edge cases.

## 4. Acceptance Criteria
### Functional
* [ ] User can execute search with new parameters.
* [ ] API latency remains under 200ms.

### Non-Functional
* [ ] Unit tests pass with >80% coverage.
* [ ] README.md updated with new build instructions.
`;
    }
}