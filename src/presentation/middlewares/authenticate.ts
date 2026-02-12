import type { FastifyRequest, FastifyReply } from 'fastify'
import { UnauthorizedError } from '../../shared/errors/app-error.js'

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify()
  } catch {
    throw new UnauthorizedError('Invalid or expired token')
  }
}
