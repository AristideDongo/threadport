import { window, type LogOutputChannel } from 'vscode';

let channel: LogOutputChannel | undefined;

/** The "ThreadPort" output channel; attach its content to bug reports (see SUPPORT.md). */
export function log(): LogOutputChannel {
  channel ??= window.createOutputChannel('ThreadPort', { log: true });
  return channel;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Logs a failure with its stack and returns the message to show the user. */
export function report(error: unknown, action: string): string {
  log().error(`${action} failed`, error instanceof Error ? error : new Error(String(error)));
  return errorMessage(error);
}
