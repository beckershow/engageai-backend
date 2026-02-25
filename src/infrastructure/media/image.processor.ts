import sharp from 'sharp'
import { AppError } from '../../shared/errors/app-error.js'

const ALLOWED_MIMETYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_SIZE_BYTES = 20 * 1024 * 1024 // 20MB

export interface ProcessedImage {
  buffer: Buffer
  mimetype: string
  extension: string
}

/**
 * Valida e comprime uma imagem.
 * Reutilizável em qualquer rota que aceite uploads de imagem.
 *
 * @param buffer  - Buffer do arquivo recebido
 * @param mimetype - MIME type declarado pelo cliente
 * @returns ProcessedImage com buffer comprimido, mimetype e extensão
 * @throws AppError em caso de tipo inválido ou arquivo muito grande
 */
export async function processImage(buffer: Buffer, mimetype: string): Promise<ProcessedImage> {
  // Validar tipo
  const normalizedMime = mimetype.toLowerCase()
  if (!ALLOWED_MIMETYPES.includes(normalizedMime)) {
    throw new AppError(
      `Tipo de arquivo não permitido: "${mimetype}". Use JPG, JPEG, PNG ou WEBP.`,
      400,
      'INVALID_FILE_TYPE',
    )
  }

  // Validar tamanho
  if (buffer.length > MAX_SIZE_BYTES) {
    const sizeMB = (buffer.length / (1024 * 1024)).toFixed(1)
    throw new AppError(
      `Arquivo muito grande: ${sizeMB}MB. O limite é 20MB.`,
      400,
      'FILE_TOO_LARGE',
    )
  }

  // Comprimir conforme o formato
  let compressedBuffer: Buffer
  let outputMimetype: string
  let extension: string

  if (normalizedMime === 'image/png') {
    compressedBuffer = await sharp(buffer)
      .png({ compressionLevel: 8, adaptiveFiltering: true })
      .toBuffer()
    outputMimetype = 'image/png'
    extension = 'png'
  } else if (normalizedMime === 'image/webp') {
    compressedBuffer = await sharp(buffer)
      .webp({ quality: 80 })
      .toBuffer()
    outputMimetype = 'image/webp'
    extension = 'webp'
  } else {
    // image/jpeg (inclui .jpg e .jpeg)
    compressedBuffer = await sharp(buffer)
      .jpeg({ quality: 80, progressive: true })
      .toBuffer()
    outputMimetype = 'image/jpeg'
    extension = 'jpg'
  }

  return { buffer: compressedBuffer, mimetype: outputMimetype, extension }
}
