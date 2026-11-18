import { spawn } from 'node:child_process';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  /** Called for each complete stdout line, as it arrives. */
  onLine?: (line: string) => void;
  timeoutMs?: number;
  /** Stops the command (SIGTERM) when aborted; the promise still resolves with its exit code. */
  signal?: AbortSignal;
}

/** Runs a command and collects its output. Rejects only when the binary cannot be started. */
export function run(command: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let pending = '';
    const timer = options.timeoutMs === undefined ? null : setTimeout(() => child.kill('SIGTERM'), options.timeoutMs);
    options.signal?.addEventListener('abort', () => child.kill('SIGTERM'), { once: true });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (options.onLine === undefined) {
        return;
      }
      pending += chunk;
      const lines = pending.split(/\r?\n|\r/);
      pending = lines.pop() ?? '';
      for (const line of lines) {
        options.onLine(line);
      }
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (timer !== null) {
        clearTimeout(timer);
      }
      reject(error.code === 'ENOENT' ? new Error(`"${command}" was not found; install it or set YTDLP_PATH`) : error);
    });
    child.on('close', (code) => {
      if (timer !== null) {
        clearTimeout(timer);
      }
      if (pending !== '' && options.onLine !== undefined) {
        options.onLine(pending);
      }
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/** Last "ERROR:" line of yt-dlp's stderr, or its last line. */
export function lastError(stderr: string): string {
  const lines = stderr.split('\n').map((line) => line.trim()).filter((line) => line !== '');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith('ERROR:')) {
      return lines[i].slice('ERROR:'.length).trim();
    }
  }
  return lines.length > 0 ? lines[lines.length - 1] : 'unknown error';
}
