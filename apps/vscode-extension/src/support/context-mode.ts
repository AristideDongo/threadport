import type { ContextMode } from '../../../../src/domain/model.js';

export interface InspectedSetting<T> {
  readonly globalValue?: T | undefined;
  readonly workspaceValue?: T | undefined;
  readonly workspaceFolderValue?: T | undefined;
}

const modes: readonly ContextMode[] = ['minimal', 'standard', 'deep', 'full'];

/**
 * An explicit `threadport.context.mode` setting wins; otherwise the project's `.threadport/config.json`
 * default applies, so the CLI and the extension agree unless the user overrides VS Code on purpose.
 */
export function resolveContextMode(
  setting: InspectedSetting<string> | undefined,
  projectDefault: ContextMode,
): ContextMode {
  const explicit = setting?.workspaceFolderValue ?? setting?.workspaceValue ?? setting?.globalValue;
  return modes.find((mode) => mode === explicit) ?? projectDefault;
}
