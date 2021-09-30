import * as http from 'http';
import WebSocket from 'ws';
import { EventEmitter } from 'events'

let httpServer: http.Server | null = null;

class GhostTextConnection extends EventEmitter {

    private socket: WebSocket | null;

    constructor(socket: WebSocket){
        super();

        socket.on('message', (data) => {
            this.emit('data', JSON.parse(data.toString()));
        });

        socket.on('close', () => {
            this.close();
            this.emit('close');
        });

        this.socket = socket;
    }

    close() {
        if (this.socket) {
            const c = this.socket;
            this.socket = null;
            c.close();
        }

    }

    send(text: string, selections: {start: number, end: number}[]) {
        if (this.socket) {
            this.socket.send(JSON.stringify({
                title: '',
                text:  text,
                syntax: '',
                selections: selections
            }));
        }
    }
}

interface GhostTextData {
    text: string,
    selections: {start: number, end: number}[]
    title: string,
    url: string,
    syntax: string,
}

interface GhostTextConnection {
    on(event: 'data', cb: (data: GhostTextData) => void): this,
    on(event: 'close', cb: () => void): this,
}

export const close = async () => {
    return new Promise<void>(r => {
        if (httpServer) {
            httpServer.close(r);
            httpServer = null;
        } else {
            r();
        }
    })
}

export const listen = (serverPort: number, handler: (conn: GhostTextConnection) => void) => {
    httpServer = http.createServer((req, res) => {
        const wsServer = new WebSocket.Server({ port: 0 });
        wsServer.on('connection', (socket: WebSocket) => {
            const conn = new GhostTextConnection(socket);
            handler(conn);
        });

        wsServer.on('listening', () => {
            const addr = wsServer.address();
            if (typeof addr === 'string') {
                res.writeHead(500, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({ error: "uanble listen port" }));
                return;
            }
            res.writeHead(200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({
                ProtocolVersion: 1,
                WebSocketPort: addr.port
            }));
        });
    });

    httpServer.on('error', (err: any) => {
        if ((err.code === 'EADDRINUSE') && (err.syscall === 'listen')) {
            console.log(err.message);
        } else {
            throw err;
        }
    });

    httpServer.listen(serverPort);
}
