import * as vscode from "vscode"
import { WebSocket } from "ws"
import { GhostTextServer } from "./server.ts"

const PACKAGE_NAME  = "ghosttext";

interface Config {
    serverPort: number;
}

interface GhostTextData {
    title: string,
    url: string,
    syntax: string,
    text: string,
    selections: { start: number, end: number }[]
}

let server: GhostTextServer | null = null;

export async function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async ev => {
            if (ev.affectsConfiguration(PACKAGE_NAME)) {
                if (server) {
                    await server.close();
                }
                server = await startServer();
            }
        })
    );

    server = await startServer();
};

async function startServer() {
    const config = vscode.workspace.getConfiguration(PACKAGE_NAME) as unknown as Config;
    return await GhostTextServer.listen(config.serverPort, socket => new GhostTextConnection(socket));
}

export async function deactivate() {
    if (server) {
        await server.close();
        server = null;
    }
};

class GhostTextConnection {
    private readonly socket: WebSocket;
    private editor: vscode.TextEditor | null = null;
    private progress: { close: () => void } | null = null;
    private readonly disposables: vscode.Disposable[] = [];
    private messageQueue = Promise.resolve();
    private enterLocalEdit = 0;
    private closing: boolean = false;

    constructor(socket: WebSocket){
        this.socket = socket;

        this.socket.on("message", data => {
            this.messageQueue = this.messageQueue
                .then(() => this.onMessage(data.toString()))
                .catch(err => console.error("Failed to process message", err));
        });

        this.socket.on("close", () => this.close());

        this.addDisposable(
            vscode.workspace.onDidCloseTextDocument(doc => {
                if (!this.editor || doc !== this.editor.document) {
                    return;
                }
                this.close();
            })
        );

        this.addDisposable(
            vscode.workspace.onDidChangeTextDocument(async ev => {
                if (!this.editor || ev.document !== this.editor.document) {
                    return;
                }
                if (this.enterLocalEdit !== 0) {
                    return;
                }
                const text = this.editor.document.getText();
                const selections = this.editor.selections.map(selection => ({
                    start: ev.document.offsetAt(selection.start),
                    end: ev.document.offsetAt(selection.end),
                }));

                // empty doc change event fires before close. Work around race.
                setTimeout(() => {
                    if (!this.closing) {
                        this.send(text, selections);
                    }
                }, 50);
            })
        );
    }

    private addDisposable(disposable: vscode.Disposable) {
        if (this.closing) {
            disposable.dispose();
        } else {
            this.disposables.push(disposable);
        }
    }

    private close() {
        this.closing = true;
        for (const disposable of this.disposables.splice(0)) {
            disposable.dispose();
        }
        if (this.socket.readyState !== this.socket.CLOSED) {
            this.socket.close();
        }
        if (this.progress) {
            this.progress.close();
            this.progress = null;
        }
        if (this.editor) {
            void this.closeDocument().catch(err => console.error("Failed to close editor", err));
            this.editor = null;
        }
    }

    private async onMessage(payload: string) {
        if (this.closing) {
            return;
        }
        const data = JSON.parse(payload.toString()) as GhostTextData;
        if (!this.editor) {
            await this.onFirstMessage(data);
        }
        this.enterLocalEdit++;
        try {
            await this.updateDocument(data.text, data.selections || []);
        } finally {
            this.enterLocalEdit--;
        }
    }

    private async onFirstMessage(data: GhostTextData) {
        const document = await vscode.workspace.openTextDocument({
            "language": "markdown",
            "content": data.text,
        });

        this.editor = await vscode.window.showTextDocument(document, {
            preview: true,
            preserveFocus: false,
        });

        if (this.closing) {
            this.close();
            return;
        }

        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: data.title + "\n" + data.url,
            cancellable: true
        }, async (_, token) => {
            return new Promise<void>((resolve) => {
                if (this.closing) {
                    resolve();
                } else {
                    this.progress = { close: resolve };
                    this.addDisposable(token.onCancellationRequested(() => this.close()));
                }
            });
        });
    }

    private async updateDocument(text: string, selections: {start: number, end: number}[]) {
        if (!this.editor || this.editor.document.isClosed) {
            return;
        }
        const editor = this.editor;
        await editor.edit(edit => {
            const range = new vscode.Range(
                editor.document.positionAt(0),
                editor.document.positionAt(editor.document.getText().length),
            );
            edit.replace(range, text);
        });
        if (selections.length) {
            editor.selections = selections.map(selection => new vscode.Selection(
                editor.document.positionAt(selection.start),
                editor.document.positionAt(selection.end),
            ));
        }
    }

    private async closeDocument() {
        if (!this.editor) {
            return;
        }
        const editor = this.editor;
        if (editor.document.isClosed) {
            return;
        }
        await editor.edit(edit => {
            const range = new vscode.Range(
                editor.document.positionAt(0),
                editor.document.positionAt(editor.document.getText().length),
            );
            edit.delete(range);
        });
        await vscode.window.showTextDocument(editor.document, { preview: true, preserveFocus: false });
        await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    }

    private send(text: string, selections: { start: number, end: number }[]) {
        if (this.socket) {
            this.socket.send(JSON.stringify({ text, selections }));
        }
    }
}
