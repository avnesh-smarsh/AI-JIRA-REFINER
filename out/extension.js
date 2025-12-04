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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const sidebarProvider_1 = require("./sidebarProvider");
function activate(context) {
    console.log('Congratulations, your extension "jira-refiner" is now active!');
    try {
        const sidebarProvider = new sidebarProvider_1.SidebarProvider(context.extensionUri);
        // Register the webview view provider for the contributed view id.
        // Use retainContextWhenHidden to keep state while hidden and add logging for diagnostics.
        context.subscriptions.push(vscode.window.registerWebviewViewProvider("jiraRefinerView", sidebarProvider, { webviewOptions: { retainContextWhenHidden: true } }));
        console.log('SidebarProvider registered successfully.');
    }
    catch (e) {
        console.error('Failed to activate Jira Refiner:', e);
        vscode.window.showErrorMessage('Jira Refiner failed to load. Check console for details.');
    }
}
function deactivate() { }
//# sourceMappingURL=extension.js.map