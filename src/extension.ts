import * as vscode from 'vscode';
import { SidebarProvider } from './sidebarProvider';

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "jira-refiner" is now active!');

    try {
        const sidebarProvider = new SidebarProvider(context.extensionUri);
        // Register the webview view provider for the contributed view id.
        // Use retainContextWhenHidden to keep state while hidden and add logging for diagnostics.
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(
                "jiraRefinerView",
                sidebarProvider,
                { webviewOptions: { retainContextWhenHidden: true } }
            )
        );
        console.log('SidebarProvider registered successfully.');
    } catch (e) {
        console.error('Failed to activate Jira Refiner:', e);
        vscode.window.showErrorMessage('Jira Refiner failed to load. Check console for details.');
    }
}

export function deactivate() {}