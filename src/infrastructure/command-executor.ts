import { spawn } from 'node:child_process';
import type { CommandExecutor, CommandResult } from '../application/ports.js';

export class LocalCommandExecutor implements CommandExecutor {
  execute(command: string, args: string[], cwd: string): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd, env: process.env, stdio: ['inherit', 'pipe', 'pipe'] });
      let output = '';
      const collect = (chunk: Buffer, target: NodeJS.WriteStream): void => {
        target.write(chunk);
        if (output.length < 20_000) output += chunk.toString('utf8').slice(0, 20_000 - output.length);
      };
      child.stdout.on('data', (chunk: Buffer) => collect(chunk, process.stdout));
      child.stderr.on('data', (chunk: Buffer) => collect(chunk, process.stderr));
      child.once('error', reject);
      child.once('close', (code) => resolve({ code: code ?? 1, output }));
    });
  }
}
