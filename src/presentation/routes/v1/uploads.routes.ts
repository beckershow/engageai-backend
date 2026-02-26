import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../middlewares/authenticate.js'
import { authorize } from '../../middlewares/authorize.js'
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { Readable } from 'node:stream'
import { env } from '../../../config/env.js'
import { processImage } from '../../../infrastructure/media/image.processor.js'

function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function buildR2Client() {
  return new S3Client({
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
}

export async function uploadsRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /uploads/* — proxy público para servir imagens armazenadas no R2
  fastify.get('/*', {
    schema: { tags: ['Uploads'], summary: 'Serve imagem do R2 via proxy' },
  }, async (request, reply) => {
    const key = (request.params as { '*': string })['*']
    if (!key) {
      return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'Key é obrigatória', statusCode: 400 } })
    }

    try {
      const r2Client = buildR2Client()
      const command = new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key })
      const response = await r2Client.send(command)

      reply.header('Content-Type', response.ContentType ?? 'image/jpeg')
      reply.header('Cache-Control', 'public, max-age=31536000, immutable')

      // Transmite o stream diretamente para a resposta
      return reply.send(Readable.from(response.Body as any))
    } catch (err: any) {
      if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Imagem não encontrada', statusCode: 404 } })
      }
      throw err
    }
  })

  // POST /uploads?folder=trainings (gestor+) - multipart upload via backend com compressão de imagem
  fastify.post('/', {
    preHandler: [authenticate, authorize(['gestor'])],
    schema: {
      tags: ['Uploads'],
      summary: 'Upload de imagem com compressão automática (gestor+)',
      querystring: {
        type: 'object',
        properties: {
          folder: { type: 'string', description: 'Pasta no R2 (default: trainings)' },
        },
      },
    },
  }, async (request, reply) => {
    if (!request.isMultipart()) {
      return reply.code(400).send({
        error: { code: 'BAD_REQUEST', message: 'Expected multipart/form-data', statusCode: 400 },
      })
    }

    const file = await request.file()
    if (!file) {
      return reply.code(400).send({
        error: { code: 'BAD_REQUEST', message: 'Arquivo é obrigatório', statusCode: 400 },
      })
    }

    // Ler o buffer completo
    const chunks: Buffer[] = []
    for await (const chunk of file.file) {
      chunks.push(chunk)
    }
    const rawBuffer = Buffer.concat(chunks)

    // Processar (validar tipo/tamanho e comprimir)
    const processed = await processImage(rawBuffer, file.mimetype)

    // Determinar pasta de destino
    const query = request.query as { folder?: string }
    const folder = query.folder?.replace(/[^a-zA-Z0-9_-]/g, '') || 'trainings'

    const safeName = sanitizeFilename(file.filename).replace(/\.[^.]+$/, '')
    const key = `${folder}/${request.user.id}/${Date.now()}-${safeName}.${processed.extension}`

    const r2Client = buildR2Client()

    await r2Client.send(new PutObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: key,
      Body: processed.buffer,
      ContentType: processed.mimetype,
    }))

    return reply.send({ data: { key, filename: file.filename } })
  })
}
