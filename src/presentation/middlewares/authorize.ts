import type { FastifyRequest, FastifyReply } from 'fastify'
import type { UserRole } from '@prisma/client'
import { ForbiddenError } from '../../shared/errors/app-error.js'

// Role hierarchy: colaborador < gestor < super_admin
const ROLE_HIERARCHY: Record<UserRole, number> = {
  colaborador: 1,
  gestor: 2,
  super_admin: 3,
}

/**
 * Middleware factory for RBAC.
 * authorize(['gestor', 'super_admin']) — user must have at least gestor level
 * authorize(['super_admin']) — only super_admin
 */
export function authorize(allowedRoles: UserRole[]) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const userRole = request.user.role
    const userLevel = ROLE_HIERARCHY[userRole] ?? 0

    const allowed = allowedRoles.some(role => {
      return userLevel >= ROLE_HIERARCHY[role]
    })

    if (!allowed) {
      throw new ForbiddenError(`Access denied. Required roles: ${allowedRoles.join(', ')}`)
    }
  }
}

/**
 * Check if user is at least a gestor
 */
export function isAtLeastGestor(role: UserRole): boolean {
  return ROLE_HIERARCHY[role] >= ROLE_HIERARCHY.gestor
}

/**
 * Check if user is super_admin
 */
export function isSuperAdmin(role: UserRole): boolean {
  return role === 'super_admin'
}
