import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { env } from '../../config/env.js'

const r2Client = new S3Client({
  region: env.R2_REGION,
  endpoint: env.R2_ENDPOINT,
  forcePathStyle: true,
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
})

export async function createUploadUrl(params: {
  key: string
  contentType: string
}) {
  const command = new PutObjectCommand({
    Bucket: env.R2_BUCKET,
    Key: params.key,
    ContentType: params.contentType,
  })

  const uploadUrl = await getSignedUrl(r2Client, command, { expiresIn: 60 })
  return { uploadUrl }
}

async function streamToBuffer(stream: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    stream.on('data', (chunk: Buffer) => chunks.push(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(Buffer.concat(chunks)))
  })
}

export async function readObjectText(key: string, maxBytes = 200_000): Promise<string | null> {
  const command = new GetObjectCommand({
    Bucket: env.R2_BUCKET,
    Key: key,
  })

  const result = await r2Client.send(command)
  const body = result.Body
  if (!body) return null

  const buffer = await streamToBuffer(body)
  const slice = buffer.subarray(0, maxBytes)

  // Basic binary detection: if contains null byte, skip
  if (slice.includes(0)) return null

  return slice.toString('utf-8')
}
