import * as http from "node:http";
import { WebSocket, WebSocketServer } from "ws"

export class GhostTextServer {
    private server: http.Server;
    private wss: WebSocketServer;

    static async listen(serverPort: number, handler: (socket: WebSocket) => void) {
        return new Promise<GhostTextServer>((resolve, reject) => {
            const server = http.createServer();
            const wss = new WebSocketServer({ server });

            const obj = new GhostTextServer(server, wss);
            let done = false;

            server.on("error", err => {
                if (!done) {
                    done = true;
                    reject(err);
                }
                void obj.close();
            });

            wss.on("error", err => {
                if (!done) {
                    done = true;
                    reject(err);
                }
                void obj.close();
            });

            server.on("listening", () => {
                if (!done) {
                    done = true;
                    resolve(obj);
                }
            });

            server.on("request", (_, res) => {
                res.writeHead(200, {
                    "Content-Type": "application/json"
                });
                return res.end(JSON.stringify({
                    ProtocolVersion: 1,
                    WebSocketPort: serverPort,
                }));
            });

            wss.on("connection", socket => handler(socket));

            server.listen(serverPort, "127.0.0.1");
        });
    }

    private constructor(server: http.Server, wss: WebSocketServer){
        this.server = server;
        this.wss = wss;
    }

    async close() {
        return Promise.all([
            new Promise<void>((resolve, reject) => {
                for (const client of this.wss.clients) {
                    client.terminate();
                }
                this.wss.close(err => err ? reject(err) : resolve());
            }),
            new Promise<void>((resolve, reject) => {
                if (this.server.listening) {
                    this.server.close(err => err ? reject(err) : resolve());
                } else {
                    resolve();
                }
            }),
        ]).catch(err => console.error("Failed to close server", err));
    };
}
