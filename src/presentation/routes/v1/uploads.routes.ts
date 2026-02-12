import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../middlewares/authenticate.js'
import { authorize } from '../../middlewares/authorize.js'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { env } from '../../../config/env.js'

function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_')
}

export async function uploadsRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /uploads (gestor+) - multipart upload via backend
  fastify.post('/', {
    preHandler: [authenticate, authorize(['gestor'])],
    schema: { tags: ['Uploads'], summary: 'Upload file (gestor+)' },
  }, async (request, reply) => {
    if (!request.isMultipart()) {
      return reply.code(400).send({
        error: { code: 'BAD_REQUEST', message: 'Expected multipart/form-data', statusCode: 400 },
      })
    }

    const file = await request.file()
    if (!file) {
      return reply.code(400).send({
        error: { code: 'BAD_REQUEST', message: 'File is required', statusCode: 400 },
      })
    }

    const safeName = sanitizeFilename(file.filename)
    const key = `trainings/${request.user.id}/${Date.now()}-${safeName}`

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

    await r2Client.send(new PutObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: key,
      Body: file.file,
      ContentType: file.mimetype || 'application/octet-stream',
    }))

    return reply.send({ data: { key, filename: file.filename } })
  })
}
