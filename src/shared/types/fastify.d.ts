import type { UserRole } from '@prisma/client'

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      id: string
      email: string
      role: UserRole
      nome: string
    }
    user: {
      id: string
      email: string
      role: UserRole
      nome: string
    }
  }
}
