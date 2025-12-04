"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SidebarProvider = void 0;
const agent_1 = require("./agent");
const mcpClient_1 = require("./mcpClient");
class SidebarProvider {
    _extensionUri;
    _view;
    mcpManager;
    constructor(_extensionUri) {
        this._extensionUri = _extensionUri;
        this.mcpManager = new mcpClient_1.MCPManager();
        this.mcpManager.connectAll(); // Connect on startup
    }
    resolveWebviewView(webviewView, _context, _token) {
        console.log('resolveWebviewView called for jiraRefinerView');
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this._getHtmlForWebview();
        webviewView.webview.onDidReceiveMessage(async (data) => {
            if (data.type === "refineTicket") {
                try {
                    // 1. Instantiate Agent
                    const agent = new agent_1.RefinementAgent(this.mcpManager);
                    // 2. Run Process
                    const result = await agent.processTicket(data.value);
                    // 3. Send back result
                    webviewView.webview.postMessage({ type: "result", value: result });
                }
                catch (e) {
                    webviewView.webview.postMessage({ type: "result", value: `Error: ${e.message}` });
                }
            }
        });
    }
    _getHtmlForWebview() {
        return `<!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: sans-serif; padding: 10px; color: var(--vscode-foreground); }
            button { background: var(--vscode-button-background); color: white; border: none; padding: 8px; width: 100%; cursor: pointer; }
            input { width: 100%; padding: 8px; margin-bottom: 10px; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); }
            #output { margin-top: 20px; white-space: pre-wrap; font-family: monospace; font-size: 0.9em; border-top: 1px solid #444; padding-top: 10px; }
          </style>
        </head>
        <body>
          <h3>Jira Refiner</h3>
          <p>Enter Ticket ID to auto-refine:</p>
          <input type="text" id="ticketInput" placeholder="e.g. PROJ-123" />
          <button id="refineBtn">Refine Ticket</button>
          <div id="loader" style="display:none; margin-top:10px;">🧠 Agents are thinking...</div>
          <div id="output"></div>

          <script>
            const vscode = acquireVsCodeApi();
            document.getElementById('refineBtn').addEventListener('click', () => {
                const id = document.getElementById('ticketInput').value;
                if(!id) return;
                document.getElementById('loader').style.display = 'block';
                document.getElementById('output').innerText = "";
                vscode.postMessage({ type: 'refineTicket', value: id });
            });

            window.addEventListener('message', event => {
                const message = event.data;
                if (message.type === 'result') {
                    document.getElementById('loader').style.display = 'none';
                    document.getElementById('output').innerText = message.value;
                }
            });
          </script>
        </body>
      </html>`;
    }
}
exports.SidebarProvider = SidebarProvider;
//# sourceMappingURL=sidebarProvider.js.map