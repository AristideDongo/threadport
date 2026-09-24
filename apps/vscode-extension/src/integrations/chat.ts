import {
  LanguageModelChatMessage,
  ThemeIcon,
  chat,
  l10n,
  type CancellationToken,
  type ChatRequest,
  type ChatResponseStream,
  type Disposable,
} from 'vscode';
import type { ProjectRuntimes } from '../bootstrap/project-runtimes.js';
import { currentFolder } from '../status-bar/session-status.js';

/**
 * `@threadport` answers from the active session: `/context` shows the redacted context pack, `/handoff` a
 * sourced handoff draft, and any other question goes to the selected model grounded in that context.
 */
export function registerChatParticipant(projects: ProjectRuntimes): Disposable {
  const participant = chat.createChatParticipant(
    'threadport.chat',
    async (request: ChatRequest, _context, stream: ChatResponseStream, token: CancellationToken) => {
      const folder = currentFolder(projects);
      const runtime = folder ? projects.get(folder) : null;
      if (!folder || !runtime?.app.active()) {
        stream.markdown(l10n.t('Open or create an active ThreadPort session first.'));
        stream.button({ command: 'threadport.newSession', title: l10n.t('New Session') });
        return;
      }
      if (request.command === 'handoff') {
        stream.markdown(runtime.app.handoffDraft());
        stream.button({ command: 'threadport.draftHandoff', title: l10n.t('Review and save handoff') });
        return;
      }
      const context = projects.context(folder);
      if (request.command === 'context' || !request.prompt.trim()) {
        stream.markdown(context);
        return;
      }
      const messages = [
        LanguageModelChatMessage.User(
          `You help a developer continue a task tracked by ThreadPort. Answer from this session context and say when it does not contain the answer.\n\n${context}`,
        ),
        LanguageModelChatMessage.User(request.prompt),
      ];
      const response = await request.model.sendRequest(messages, {}, token);
      for await (const fragment of response.text) stream.markdown(fragment);
    },
  );
  participant.iconPath = new ThemeIcon('hubot');
  return participant;
}
