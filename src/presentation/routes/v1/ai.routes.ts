import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import say from 'say'
import { authenticate } from '../../middlewares/authenticate.js'
import { authorize } from '../../middlewares/authorize.js'
import { env } from '../../../config/env.js'
import { prisma } from '../../../infrastructure/database/prisma.client.js'
import { readObjectText, uploadObject, createDownloadUrl } from '../../../infrastructure/storage/r2.client.js'

const OpenAiPayloadSchema = z.object({
  objective: z.string().min(10),
  context: z.string().optional(),
})

const TrainingQuestionsSchema = z.object({
  objective: z.string().min(10),
  content: z.string().min(20),
  fileUrls: z.array(z.string()).optional(),
  summaryPercent: z.number().int().min(0).max(100).optional(),
  quantidade: z.number().int().min(1).max(20).default(5),
  tipoResposta: z.enum(['multipla-escolha', 'descritiva', 'checkbox']).default('multipla-escolha'),
  dificuldade: z.enum(['iniciante', 'intermediario', 'avancado']).default('intermediario'),
})

const TrainingSummarySchema = z.object({
  content: z.string().optional().default(''),
  fileUrls: z.array(z.string()).optional(),
  summaryPercent: z.number().int().min(1).max(100),
  objective: z.string().optional(),
})

const TrainingSummaryAudioSchema = z.object({
  summaryText: z.string().min(10),
})

const execFileAsync = promisify(execFile)

async function exportSpeechToAudio(text: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'engageai-tts-'))
  const wavPath = path.join(dir, 'summary.wav')

  await new Promise<void>((resolve, reject) => {
    say.export(text, undefined, 1.0, wavPath, (err) => {
      if (err) return reject(err)
      resolve()
    })
  })

  try {
    const mp3Path = path.join(dir, 'summary.mp3')
    await execFileAsync('ffmpeg', ['-y', '-i', wavPath, '-codec:a', 'libmp3lame', '-q:a', '4', mp3Path])
    const mp3Buffer = await fs.readFile(mp3Path)
    return { buffer: mp3Buffer, contentType: 'audio/mpeg', ext: 'mp3' }
  } catch {
    const wavBuffer = await fs.readFile(wavPath)
    return { buffer: wavBuffer, contentType: 'audio/wav', ext: 'wav' }
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

function buildPrompt(objective: string, context?: string) {
  const ctx = context?.trim()
  return [
    'Objetivo do treinamento:',
    objective.trim(),
    ctx ? `Contexto adicional:\n${ctx}` : '',
  ].filter(Boolean).join('\n\n')
}

const MODEL = 'gpt-4o-mini'
const PRICE_INPUT_PER_1M = 0.15
const PRICE_OUTPUT_PER_1M = 0.6
const CACHE_TTL_HOURS = 24

function hashRequest(payload: unknown) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

async function readCache(userId: string, purpose: string, requestHash: string) {
  return prisma.aiCache.findFirst({
    where: {
      userId,
      purpose,
      model: MODEL,
      requestHash,
      expiresAt: { gt: new Date() },
    },
  })
}

async function writeCache(userId: string, purpose: string, requestHash: string, response: unknown) {
  const expiresAt = new Date(Date.now() + CACHE_TTL_HOURS * 60 * 60 * 1000)
  await prisma.aiCache.upsert({
    where: { userId_purpose_model_requestHash: { userId, purpose, model: MODEL, requestHash } },
    create: { userId, purpose, model: MODEL, requestHash, response, expiresAt },
    update: { response, expiresAt },
  })
}

async function logUsage(userId: string, purpose: string, usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }, cached = false) {
  const promptTokens = usage?.prompt_tokens ?? 0
  const completionTokens = usage?.completion_tokens ?? 0
  const totalTokens = usage?.total_tokens ?? promptTokens + completionTokens
  const costUsd = cached
    ? 0
    : (promptTokens * PRICE_INPUT_PER_1M + completionTokens * PRICE_OUTPUT_PER_1M) / 1_000_000

  await prisma.aiUsageLog.create({
    data: {
      userId,
      purpose,
      model: MODEL,
      promptTokens,
      completionTokens,
      totalTokens,
      costUsd,
      cached,
    },
  })
}

export async function aiRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /ai/training-assist (gestor+)
  fastify.post('/training-assist', {
    preHandler: [authenticate, authorize(['gestor'])],
    schema: { tags: ['AI'], summary: 'Suggest training title/description (gestor+)' },
  }, async (request, reply) => {
    const body = OpenAiPayloadSchema.parse(request.body)
    const requestHash = hashRequest({ ...body, promptVersion: 'v2-sum-plain' })

    const cached = await readCache(request.user.id, 'training-assist', requestHash)
    if (cached) {
      await logUsage(request.user.id, 'training-assist', undefined, true)
      return reply.send({ data: cached.response })
    }

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.7,
        max_tokens: 200,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'Você é um assistente de RH. Gere um título e uma descrição em pt-BR para um treinamento. Responda apenas JSON com as chaves "title" e "description". Título <= 80 caracteres, descrição <= 300 caracteres.',
          },
          {
            role: 'user',
            content: buildPrompt(body.objective, body.context),
          },
        ],
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return reply.code(502).send({
        error: {
          code: 'OPENAI_ERROR',
          message: err?.error?.message || 'Failed to generate suggestion',
          statusCode: 502,
        },
      })
    }

    const json = await res.json()
    const content = json?.choices?.[0]?.message?.content
    if (!content) {
      return reply.code(502).send({
        error: {
          code: 'OPENAI_EMPTY_RESPONSE',
          message: 'AI response was empty',
          statusCode: 502,
        },
      })
    }

    let parsed: { title?: string; description?: string }
    try {
      parsed = JSON.parse(content)
    } catch {
      return reply.code(502).send({
        error: {
          code: 'OPENAI_INVALID_JSON',
          message: 'AI response is not valid JSON',
          statusCode: 502,
        },
      })
    }

    const data = {
      title: parsed.title ?? '',
      description: parsed.description ?? '',
    }

    await writeCache(request.user.id, 'training-assist', requestHash, data)
    await logUsage(request.user.id, 'training-assist', json?.usage, false)

    return reply.send({ data })
  })

  // POST /ai/training-questions (gestor+)
  fastify.post('/training-questions', {
    preHandler: [authenticate, authorize(['gestor'])],
    schema: { tags: ['AI'], summary: 'Generate training questions (gestor+)' },
  }, async (request, reply) => {
    const body = TrainingQuestionsSchema.parse(request.body)
    const requestHash = hashRequest(body)

    const cached = await readCache(request.user.id, 'training-questions', requestHash)
    if (cached) {
      await logUsage(request.user.id, 'training-questions', undefined, true)
      return reply.send({ data: cached.response })
    }

    const system = [
      'Você é um especialista em educação corporativa.',
      'Gere questões em pt-BR a partir do conteúdo fornecido.',
      'Se summaryPercent estiver presente, primeiro faça um resumo do conteúdo para esse percentual e use o resumo para gerar as questões.',
      'Retorne JSON com a chave "questions": lista de questões.',
      'Cada questão deve ter: "pergunta", "tipo", "tiposResposta", "alternativas", "alternativaCorreta".',
      'Se o tipo for "descritiva", use "alternativas": [] e "alternativaCorreta": null.',
      'Se o tipo for "multipla-escolha", forneça 4 alternativas e "alternativaCorreta" com o índice correto.',
      'Use tipos válidos: "multipla-escolha", "descritiva", "checkbox".',
    ].join(' ')

    const fileContents: string[] = []
    if (body.fileUrls && body.fileUrls.length > 0) {
      for (const key of body.fileUrls) {
        try {
          const text = await readObjectText(key)
          if (text && text.trim().length > 0) {
            fileContents.push(`Arquivo ${key}:\n${text}`)
          }
        } catch {}
      }
    }

    const user = [
      `Objetivo: ${body.objective}`,
      `Dificuldade: ${body.dificuldade}`,
      `Quantidade: ${body.quantidade}`,
      `TipoResposta: ${body.tipoResposta}`,
      body.summaryPercent !== undefined ? `ResumoPercentual: ${body.summaryPercent}%` : '',
      body.fileUrls && body.fileUrls.length > 0 ? `Arquivos (keys):\n${body.fileUrls.join('\n')}` : '',
      'Conteúdo:',
      body.content,
      fileContents.length > 0 ? `\n\nConteúdo extraído dos arquivos:\n${fileContents.join('\n\n')}` : '',
    ].join('\n')

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.5,
        max_tokens: 800,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'training_questions',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                questions: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      pergunta: { type: 'string' },
                      tipo: { type: 'string', enum: ['multipla-escolha', 'descritiva', 'checkbox'] },
                      tiposResposta: {
                        type: 'array',
                        items: { type: 'string', enum: ['multipla-escolha', 'descritiva', 'checkbox'] },
                      },
                      alternativas: { type: 'array', items: { type: 'string' } },
                      alternativaCorreta: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
                    },
                    required: ['pergunta', 'tipo', 'tiposResposta', 'alternativas', 'alternativaCorreta'],
                  },
                },
              },
              required: ['questions'],
            },
          },
        },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return reply.code(502).send({
        error: {
          code: 'OPENAI_ERROR',
          message: err?.error?.message || 'Failed to generate questions',
          statusCode: 502,
        },
      })
    }

    const json = await res.json()
    const content = json?.choices?.[0]?.message?.content
    if (!content) {
      return reply.code(502).send({
        error: {
          code: 'OPENAI_EMPTY_RESPONSE',
          message: 'AI response was empty',
          statusCode: 502,
        },
      })
    }

    let parsed: { questions?: any[] }
    try {
      parsed = JSON.parse(content)
    } catch {
      return reply.code(502).send({
        error: {
          code: 'OPENAI_INVALID_JSON',
          message: 'AI response is not valid JSON',
          statusCode: 502,
        },
      })
    }

    const questions = Array.isArray(parsed.questions) ? parsed.questions : []
    if (questions.length === 0) {
      return reply.code(502).send({
        error: {
          code: 'OPENAI_EMPTY_QUESTIONS',
          message: 'AI returned no questions. Provide more content and try again.',
          statusCode: 502,
        },
      })
    }
    await writeCache(request.user.id, 'training-questions', requestHash, { questions })
    await logUsage(request.user.id, 'training-questions', json?.usage, false)

    return reply.send({ data: { questions } })
  })

  // POST /ai/training-summary (gestor+)
  fastify.post('/training-summary', {
    preHandler: [authenticate, authorize(['gestor'])],
    schema: { tags: ['AI'], summary: 'Generate training summary preview (gestor+)' },
  }, async (request, reply) => {
    const body = TrainingSummarySchema.parse(request.body)
    const requestHash = hashRequest(body)

    const cached = await readCache(request.user.id, 'training-summary', requestHash)
    if (cached) {
      await logUsage(request.user.id, 'training-summary', undefined, true)
      return reply.send({ data: cached.response })
    }

    const hasContent = body.content && body.content.trim().length >= 10
    const hasFiles = body.fileUrls && body.fileUrls.length > 0
    if (!hasContent && !hasFiles) {
      return reply.code(400).send({
        error: {
          code: 'AI_CONTENT_REQUIRED',
          message: 'Provide content text or fileUrls',
          statusCode: 400,
        },
      })
    }

    const fileContents: string[] = []
    if (hasFiles) {
      for (const key of body.fileUrls || []) {
        try {
          const text = await readObjectText(key)
          if (text && text.trim().length > 0) {
            fileContents.push(`Arquivo ${key}:\n${text}`)
          }
        } catch {}
      }
    }

      const system = [
        'Você é um sumarizador estrito.',
        `Reduza o texto para aproximadamente ${body.summaryPercent}% do tamanho original.`,
        'Escreva somente o conteúdo resumido, sem comentar o texto, sem avaliar, sem contextualizar.',
        "PROIBIDO: frases meta como 'O documento...', 'O texto...', 'Este conteúdo...', 'Trata-se...', 'Aborda...', 'Contém...', 'Menciona...', 'Discute...'.",
        'Comece o resumo diretamente com informação do conteúdo (sem introdução).',
        'Não use listas, tópicos, marcadores, títulos ou seções. Apenas um parágrafo coeso.',
        'Reescreva com suas palavras, sem copiar trechos longos.',
        'Responda SOMENTE com JSON válido no formato: {"summary":"..."}',
      ].join(' ')

      const texto = [
        body.content?.trim() || '',
        fileContents.length > 0 ? `\n\nConteúdo extraído dos arquivos:\n${fileContents.join('\n\n')}` : '',
      ].filter(Boolean).join('\n')

      const user = [
        body.objective ? `Objetivo: ${body.objective}` : '',
        `ResumoPercentual: ${body.summaryPercent}%`,
        body.fileUrls && body.fileUrls.length > 0 ? `Arquivos (keys):\n${body.fileUrls.join('\n')}` : '',
        'Resuma APENAS o texto abaixo.',
        '',
        '<texto>',
        texto,
        '</texto>',
      ].filter(Boolean).join('\n')

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.3,
        max_tokens: 800,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return reply.code(502).send({
        error: {
          code: 'OPENAI_ERROR',
          message: err?.error?.message || 'Failed to generate summary',
          statusCode: 502,
        },
      })
    }

    const json = await res.json()
    const content = json?.choices?.[0]?.message?.content
    if (!content) {
      return reply.code(502).send({
        error: {
          code: 'OPENAI_EMPTY_RESPONSE',
          message: 'AI response was empty',
          statusCode: 502,
        },
      })
    }

    let parsed: { summary?: string }
    try {
      parsed = JSON.parse(content)
    } catch {
      return reply.code(502).send({
        error: {
          code: 'OPENAI_INVALID_JSON',
          message: 'AI response is not valid JSON',
          statusCode: 502,
        },
      })
    }

    const summary = parsed.summary?.trim()
    if (!summary) {
      return reply.code(502).send({
        error: {
          code: 'OPENAI_EMPTY_SUMMARY',
          message: 'AI returned no summary. Provide more content and try again.',
          statusCode: 502,
        },
      })
    }

    const data = { summary }
    await writeCache(request.user.id, 'training-summary', requestHash, data)
    await logUsage(request.user.id, 'training-summary', json?.usage, false)

    return reply.send({ data })
  })

  // POST /ai/training-summary-audio (gestor+)
  fastify.post('/training-summary-audio', {
    preHandler: [authenticate, authorize(['gestor'])],
    schema: { tags: ['AI'], summary: 'Generate training summary audio (gestor+)' },
  }, async (request, reply) => {
    const body = TrainingSummaryAudioSchema.parse(request.body)

    try {
      const audio = await exportSpeechToAudio(body.summaryText.trim())
      const key = `trainings/${request.user.id}/summary-audio/${Date.now()}.${audio.ext}`
      await uploadObject({ key, contentType: audio.contentType, body: audio.buffer })
      const { downloadUrl } = await createDownloadUrl({ key, expiresIn: 3600 })

      return reply.send({ data: { key, url: downloadUrl } })
    } catch (error: any) {
      return reply.code(502).send({
        error: {
          code: 'AUDIO_GENERATION_FAILED',
          message: error?.message || 'Failed to generate summary audio',
          statusCode: 502,
        },
      })
    }
  })
}
