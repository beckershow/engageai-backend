import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const titles = [
    'Comunicação Assertiva no Trabalho',
    'Bem-Estar e Saúde Mental',
    'Inglês para Negócios — Básico',
    'Excel Avançado para Análise de Dados',
  ]

  for (const title of titles) {
    const result = await prisma.training.updateMany({
      where: { title, deletedAt: null },
      data: { creatorId: '2' },
    })
    console.log(`Updated ${result.count} row(s) for: ${title}`)
  }

  // Verify
  const trainings = await prisma.training.findMany({
    where: { deletedAt: null },
    select: { title: true, creatorId: true },
    orderBy: { createdAt: 'desc' },
  })
  console.log('\nAll active trainings:')
  trainings.forEach(t => console.log(`  [creatorId=${t.creatorId}] ${t.title}`))

  await prisma.$disconnect()
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
