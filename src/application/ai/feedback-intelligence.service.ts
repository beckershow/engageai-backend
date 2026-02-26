import { env } from '../../config/env.js'
import { prisma } from '../../infrastructure/database/prisma.client.js'

export interface FeedbackAnalysisResult {
    sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'CONSTRUCTIVE'
    intensity: number // 1-10
    categories: string[]
    summary: string
    suggestedActions: string[]
    reasoning: string
}

export class FeedbackIntelligenceService {
    private static MODEL = 'gpt-4o-mini'

    /**
     * Analisa um feedback individual usando IA
     */
    static async analyzeFeedback(content: string): Promise<FeedbackAnalysisResult | null> {
        if (!content || content.length < 10) return null

        try {
            const systemPrompt = `
Você é um analista de RH especializado em cultura organizacional e feedback 360.
Analise o feedback fornecido e extraia métricas estruturadas.

Sentimentos possíveis:
- POSITIVE: Reconhecimento, elogio, motivação.
- NEGATIVE: Reclamação pura, crítica não construtiva (raro em ambiente profissional, mas possível).
- NEUTRAL: Informação factual, sem carga emocional clara.
- CONSTRUCTIVE: Aponta pontos de melhoria com foco em crescimento.

Categorias Sugeridas (mas não limitadas a):
"Comunicação", "Processos", "Liderança", "Técnico", "Soft Skills", "Pontualidade", "Proatividade", "Trabalho em Equipe".

Responda APENAS em JSON no seguinte formato:
{
  "sentiment": "POSITIVE" | "NEGATIVE" | "NEUTRAL" | "CONSTRUCTIVE",
  "intensity": número de 1 a 10,
  "categories": ["Categoria1", "Categoria2"],
  "summary": "Resumo executivo de 1 frase",
  "suggestedActions": ["Ação sugerida 1", "Ação sugerida 2"],
  "reasoning": "Breve explicação do porquê desta classificação"
}
`.trim()

            const res = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${env.OPENAI_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: this.MODEL,
                    temperature: 0.3,
                    response_format: { type: 'json_object' },
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: `Analise o seguinte feedback:\n\n"${content}"` },
                    ],
                }),
            })

            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                console.error('[AI Feedback] OpenAI Error:', err)
                return null
            }

            const json = await res.json() as any
            const analysisContent = json?.choices?.[0]?.message?.content
            if (!analysisContent) return null

            const parsed = JSON.parse(analysisContent) as FeedbackAnalysisResult
            return parsed
        } catch (error) {
            console.error('[AI Feedback] Analysis failed:', error)
            return null
        }
    }

    /**
     * Processa e persiste a análise de um feedback no banco
     */
    static async processAndPersist(feedbackId: string): Promise<void> {
        const feedback = await prisma.feedback.findUnique({
            where: { id: feedbackId },
            select: { content: true }
        })

        if (!feedback) return

        const analysis = await this.analyzeFeedback(feedback.content)
        if (!analysis) return

        await prisma.feedback.update({
            where: { id: feedbackId },
            data: {
                sentiment: analysis.sentiment,
                intensity: analysis.intensity,
                categories: analysis.categories,
                aiAnalysis: analysis as any,
            }
        })
    }

    /**
     * Gera insights holísticos (preditivos e prescritivos) para um time
     */
    static async generateTeamInsights(teamIds: string[], days = 30): Promise<any> {
        const since = new Date()
        since.setDate(since.getDate() - days)

        const feedbacks = await prisma.feedback.findMany({
            where: {
                OR: [{ fromUserId: { in: teamIds } }, { toUserId: { in: teamIds } }],
                createdAt: { gte: since },
                status: 'aprovado'
            },
            select: { content: true, sentiment: true, categories: true }
        })

        if (feedbacks.length < 3) {
            return {
                message: "Dados insuficientes para gerar insights inteligentes. Continue enviando feedbacks!",
                risks: [],
                suggestions: []
            }
        }

        // Preparar resumo p/ IA
        const summaryData = feedbacks.map(f => ({
            s: f.sentiment,
            c: f.categories,
            t: f.content.substring(0, 100)
        }))

        try {
            const systemPrompt = `
Você é um estrategista de People Analytics e Psicólogo Organizacional.
Analise os dados agregados de feedback de um time e gere insights PREDITIVOS (o que pode acontecer) e PRESCRITIVOS (o que fazer).

Responda APENAS em JSON:
{
  "climaGeral": "Resumo do clima atual",
  "preditivo": [
    {"risco": "Nome do risco", "probabilidade": "Alta/Media/Baixa", "descricao": "Por que existe esse risco?"}
  ],
  "prescritivo": [
    {"acao": "O que fazer", "objetivo": "Para que serve", "prioridade": "Urgente/Importante/Desejável"}
  ],
  "pontosFortes": ["Ponto 1", "Ponto 2"],
  "alertaDesengajamento": boolean
}
`.trim()

            const res = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${env.OPENAI_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: this.MODEL,
                    temperature: 0.5,
                    response_format: { type: 'json_object' },
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: `Dados dos feedbacks dos últimos ${days} dias:\n${JSON.stringify(summaryData)}` },
                    ],
                }),
            })

            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                console.error('[AI Insights] OpenAI Error:', err)
                return null
            }

            const json = await res.json() as any
            const content = json?.choices?.[0]?.message?.content
            return JSON.parse(content || '{}')
        } catch (error) {
            console.error('[AI Insights] Failed:', error)
            return null
        }
    }

    /**
     * Sugere conteúdo para um feedback ou solicitação baseado em uma intenção livre
     */
    static async suggestFeedbackContent(intention: string, type: 'feedback' | 'request'): Promise<string | null> {
        if (!intention || intention.length < 3) return null

        try {
            const systemPrompt = `
Você é um assistente de escrita de feedbacks corporativos e solicitações.
Sua missão é transformar uma intenção bruta em uma mensagem profissional, empática e clara.

Se o tipo for "feedback": Gere um texto de reconhecimento ou feedback construtivo.
Se o tipo for "request": Gere um texto solicitando feedback de forma humilde e focada em crescimento.

Regras:
- O tom deve ser profissional e acolhedor.
- Não use placeholders como "[Nome]".
- Vá direto ao ponto.
- Responda apenas com o texto da mensagem sugerida.
`.trim()

            const res = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${env.OPENAI_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: this.MODEL,
                    temperature: 0.7,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: `Intenção: "${intention}"\nTipo: ${type === 'feedback' ? 'Feedback/Reconhecimento' : 'Solicitação de Feedback'}` },
                    ],
                }),
            })

            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                console.error('[AI Suggestion] OpenAI Error:', err)
                return null
            }

            const json = await res.json() as any
            const suggestion = json?.choices?.[0]?.message?.content?.trim()
            if (!suggestion) {
                console.warn('[AI Suggestion] Empty suggestion returned')
                return null
            }
            return suggestion
        } catch (error) {
            console.error('[AI Suggestion] Failed:', error)
            return null
        }
    }
}
