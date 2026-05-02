export {};

declare global {
  interface Error {
    cause?: unknown;
  }
}
