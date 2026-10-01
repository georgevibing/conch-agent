/// <reference types="vite/client" />

declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}

/** What the code says about itself, read by `reference/plugin.ts`. */
declare module 'virtual:conch-reference' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- a file of ambient modules can't import at the top
  const reference: import('../reference/types').Reference;
  export default reference;
}
