declare module 'say' {
  type ExportCallback = (err?: Error | null) => void

  export function export(
    text: string,
    voice: string | undefined,
    speed: number | undefined,
    filename: string,
    callback: ExportCallback,
  ): void
}
