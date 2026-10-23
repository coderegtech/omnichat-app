export {};
declare global {
  interface Window {
    omnichatDesktop?: {
      platform: string;
      pickProjectFolder: () => Promise<string|null>;
      openProjectFolder: (path: string) => Promise<boolean>;
      saveText: (input: { name: string; content: string; format: 'markdown' | 'json' }) => Promise<boolean>;
      notify: (input: { title: string; body: string }) => Promise<boolean>;
      setLaunchOnStartup: (value: boolean) => Promise<boolean>;
      openExternal: (url: string) => Promise<boolean>;
      onNewChat: (listener: () => void) => () => void;
    };
  }
}
