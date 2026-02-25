declare module 'say' {
  type ExportCallback = (err?: Error | null) => void

  function _export(
    text: string,
    voice: string | undefined,
    speed: number | undefined,
    filename: string,
    callback: ExportCallback,
  ): void

  export { _export as export }
}
