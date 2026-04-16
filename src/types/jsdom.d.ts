declare module 'jsdom' {
  export class JSDOM {
    window: Window &
      typeof globalThis & {
        close(): void;
      };
    constructor(html?: string, options?: { url?: string });
  }
}
