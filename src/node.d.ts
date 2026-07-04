// Minimal Node.js type declarations for this project

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: string): string;
  export function readdirSync(path: string): string[];
  export function writeFileSync(path: string, data: string): void;
  export function existsSync(path: string): boolean;
  export function watchFile(path: string, callback: (curr: any, prev: any) => void): void;
  export function statSync(path: string): { mtimeMs: number };
}

declare module 'node:path' {
  export function join(...paths: string[]): string;
  export function resolve(...paths: string[]): string;
  export function dirname(path: string): string;
  export function basename(path: string, ext?: string): string;
  export function extname(path: string): string;
}

declare module 'node:url' {
  export function fileURLToPath(url: string): string;
}

declare module 'node:http' {
  export interface IncomingMessage {
    url?: string;
    method?: string;
    headers: Record<string, string | string[] | undefined>;
    on(event: string, callback: (...args: any[]) => void): this;
  }
  export interface ServerResponse {
    writeHead(statusCode: number, headers?: Record<string, string>): this;
    end(data?: string | Buffer): this;
    write(data: string | Buffer): boolean;
    setHeader(name: string, value: string): this;
  }
  export function createServer(
    handler: (req: IncomingMessage, res: ServerResponse) => void
  ): { listen(port: number, callback?: () => void): void };
}

declare module 'node:readline' {
  export interface Interface {
    on(event: string, callback: (...args: any[]) => void): this;
    close(): void;
    prompt(): void;
  }
  export function createInterface(options: {
    input: any;
    output: any;
    terminal?: boolean;
  }): Interface;
}

declare var console: {
  log(...args: any[]): void;
  error(...args: any[]): void;
  warn(...args: any[]): void;
};

declare var process: {
  cwd(): string;
  exit(code?: number): void;
  argv: string[];
  stdin: any;
  stdout: any;
  env: Record<string, string | undefined>;
  uptime(): number;
};

declare var Buffer: {
  from(str: string, encoding?: string): any;
};

declare function setTimeout(callback: (...args: any[]) => void, ms: number): any;
declare function setInterval(callback: (...args: any[]) => void, ms: number): any;
declare function clearInterval(id: any): void;
declare function clearTimeout(id: any): void;

interface ImportMeta {
  url: string;
}
