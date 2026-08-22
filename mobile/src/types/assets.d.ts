/**
 * Ambient declarations for Metro asset imports.
 *
 * Metro turns `import x from "./sound.mp3"` into an asset id (a number);
 * TypeScript needs to be told that, or every asset import is an error.
 */

declare module "*.mp3" {
  const asset: number;
  export default asset;
}

declare module "*.png" {
  const asset: number;
  export default asset;
}

declare module "*.jpg" {
  const asset: number;
  export default asset;
}
