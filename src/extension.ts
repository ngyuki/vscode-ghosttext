import * as vscode from 'vscode'
import * as server from './server'

async function updateDocument(document: vscode.TextDocument, text: string, selections: {start: number, end: number}[]) {
    if (!document.isClosed) {
        const editor = await vscode.window.showTextDocument(document);
        await editor.edit(editBuilder => {
            const range = new vscode.Range(
                new vscode.Position(0, 0),
                document.lineAt(document.lineCount - 1).range.end
            );
            editBuilder.replace(range, text);
        });
        if (selections.length) {
            editor.selections = selections.map(selection => new vscode.Selection(
                document.positionAt(selection.start),
                document.positionAt(selection.end),
            ));
        }
    }
}

/**
* function showProgress(title: string, onCancellationRequested: () => void): Promise<{done: () => void}> {
*     return new Promise(r => {
*         const options = {
*             location: vscode.ProgressLocation.Notification,
*             title: title,
*             cancellable: true
*         };
*         vscode.window.withProgress(options, async (_, token) => new Promise(done => {
*                 token.onCancellationRequested(onCancellationRequested)
*                 r({done: done as () => {}});
*         }));
*     });
* }
*/

async function closeDocument(document: vscode.TextDocument) {
    if (!document.isClosed) {
        await updateDocument(document, '', []);
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    }
}

export const activate = (context: vscode.ExtensionContext) => {
    console.log('extension activate');

    server.listen(conn => {
        console.log('connected');

        const disposables: vscode.Disposable[] = [];
        let document: vscode.TextDocument | null = null;
        let enterLocalEdit = 0;

        conn.on('data', async (data) => {
            console.log('receive data');

            if (!document) {
                document = await vscode.workspace.openTextDocument({
                    'language': 'markdown',
                    'content': data.text,
                });

                /**
                * const progress = await showProgress(
                *     data.title + "\n" + data.url,
                *     () => {
                *         console.log('progress canceled');
                *         cleanup();
                *     }
                * );
                */

                const cleanup = () => {
                    disposables.forEach(d => d.dispose());
                    conn.close();
                    if (document) {
                        closeDocument(document);
                    }
                    /**
                    * progress.done();
                    */
                }

                conn.on('close', () => {
                    console.log('connection close');
                    cleanup();
                });

                disposables.push(
                    vscode.workspace.onDidCloseTextDocument(doc => {
                        if (doc === document && doc.isClosed) {
                            console.log('document close');
                            cleanup();
                        }
                    })
                );

                disposables.push(
                    vscode.workspace.onDidChangeTextDocument(async event => {
                        if(event.document === document) {
                            if (enterLocalEdit === 0) {
                                const text = event.document.getText();
                                const editor = await vscode.window.showTextDocument(event.document);
                                const selections = editor.selections.map(selection => ({
                                    start: event.document.offsetAt(selection.start),
                                    end: event.document.offsetAt(selection.end),
                                }));
                                conn.send(text, selections);
                            }
                        }
                    })
                );
            }

            enterLocalEdit++;
            try {
                await updateDocument(document, data.text, data.selections || []);
            } finally {
                enterLocalEdit--;
            }
        });
    });
};

export const deactivate = () => {
    server.close();
};
