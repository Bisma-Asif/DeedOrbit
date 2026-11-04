/**
 * "Ask DeedOrbit" — a plain-language question box over the workspace's own data.
 *
 * The panel is a chat: type a question, get a text answer plus the rows behind
 * it. Nothing here decides what the caller may see — that is the endpoint's job.
 * The route is already gated on `assistant.view` by the app shell, and every
 * answer carries its own permission verdict, so a question about a module the
 * role cannot open comes back as a refusal rendered inline rather than a thrown
 * error. History is kept in component state only: a refresh clears the thread,
 * and no conversation is stored against the tenant.
 */

import { useEffect, useRef, useState } from "react"

import { Lock, Send, Sparkles } from "lucide-react"

import { PageHeader } from "@/components/page-header"

import { brand } from "@/config/brand"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { Badge } from "@/components/ui/badge"

import { Button } from "@/components/ui/button"

import { Card, CardContent } from "@/components/ui/card"

import { EmptyState } from "@/components/empty-state"

import { ScrollArea } from "@/components/ui/scroll-area"

import { Textarea } from "@/components/ui/textarea"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

import { ApiError } from "@/lib/api"

import { assistantApi } from "@/lib/assistant-api"

import { formatCurrency, formatDate, formatNumber } from "@/lib/format"

import {
  ASSISTANT_INTENTS,
  MAX_QUESTION_LENGTH,
  type AssistantColumn,
  type AssistantReply,
} from "@shared/assistant"

/** One turn of the thread. A user line or an assistant answer, never both. */

interface UserTurn {
  role: "user"

  text: string
}

interface AssistantTurn {
  role: "assistant"

  reply?: AssistantReply

  error?: string
}

type Turn = UserTurn | AssistantTurn

/** Money-bearing columns are formatted as currency; counts as plain numbers. */

const MONEY_KEYS = new Set(["outstanding", "amount"])

const COUNT_KEYS = new Set(["daysOverdue", "count"])

function renderCell(
  column: AssistantColumn,

  value: string | number | null,

  currency: string,
): string {
  if (value === null || value === undefined) return "—"

  if (typeof value === "number") {
    if (MONEY_KEYS.has(column.key))
      return formatCurrency(value, currency, { maximumFractionDigits: 0 })

    if (COUNT_KEYS.has(column.key)) return formatNumber(value)
  }

  return String(value)
}

function AnswerTable({ reply }: { reply: AssistantReply }) {
  return (
    <div className="mt-2.5 overflow-hidden rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            {reply.columns.map((column) => (
              <TableHead
                key={column.key}
                className={column.numeric ? "text-right" : undefined}
              >
                {column.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {reply.rows.map((row, index) => (
            <TableRow key={index}>
              {reply.columns.map((column) => (
                <TableCell
                  key={column.key}
                  className={
                    column.numeric
                      ? "text-right tabular-nums whitespace-nowrap"
                      : undefined
                  }
                >
                  {renderCell(column, row[column.key], reply.currency)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function AssistantBubble({ turn }: { turn: AssistantTurn }) {
  if (turn.error) {
    return (
      <Alert variant="danger">
        <Lock />

        <AlertDescription>{turn.error}</AlertDescription>
      </Alert>
    )
  }

  const reply = turn.reply

  if (!reply) return null

  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-xs">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border border-success-border bg-success-subtle text-success">
          <Sparkles size={14} />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-[13px] leading-5 text-foreground">
            {reply.answer}
          </p>

          {reply.permitted && reply.intentId && (
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <Badge variant="neutral">{reply.intentLabel}</Badge>

              <span>As of {formatDate(reply.asOf)}</span>

              {reply.truncated && (
                <span>
                  Showing {reply.rows.length} of {reply.matchedCount}
                </span>
              )}
            </div>
          )}

          {!reply.permitted && reply.intentId && (
            <Alert variant="pending" className="mt-2.5">
              <Lock />

              <AlertDescription>
                Permission is what is missing here, not the data. Open the
                module directly once your role is granted it.
              </AlertDescription>
            </Alert>
          )}

          {reply.permitted && reply.rows.length > 0 && (
            <AnswerTable reply={reply} />
          )}

          {reply.intentId === null && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {reply.examples.slice(0, 3).map((example) => (
                <Badge key={example} variant="outline">
                  {example}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function AssistantPage() {
  const [turns, setTurns] = useState<Turn[]>([])

  const [question, setQuestion] = useState("")

  const [sending, setSending] = useState(false)

  const bottomRef = useRef<HTMLDivElement>(null)

  const examples = ASSISTANT_INTENTS.flatMap((intent) => intent.examples)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" })
  }, [turns, sending])

  async function send(ask: string) {
    const trimmed = ask.trim()

    if (!trimmed || sending) return

    setSending(true)

    setQuestion("")

    setTurns((current) => [...current, { role: "user", text: trimmed }])

    try {
      const reply = await assistantApi.ask(trimmed)

      setTurns((current) => [...current, { role: "assistant", reply }])
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : "Could not reach the assistant. Try again."

      setTurns((current) => [...current, { role: "assistant", error: message }])
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <PageHeader
        title={`Ask ${brand.name}`}
        description="Ask a plain-language question about your workspace. Answers are read live from your own tenant's records and only ever show figures your role can already open."
      />

      <Card className="flex min-h-0 flex-1 flex-col">
        <CardContent className="flex min-h-0 flex-1 flex-col gap-3 p-0">
          <ScrollArea className="min-h-0 flex-1 px-4 py-4">
            {turns.length === 0 ? (
              <EmptyState
                icon={Sparkles}
                title="Ask about your workspace"
                description="Try one of these to start. The assistant answers about overdue payments for now."
                size="md"
                className="min-h-0"
              />
            ) : (
              <div className="flex flex-col gap-3">
                {turns.map((turn, index) =>
                  turn.role === "user" ? (
                    <div key={index} className="flex justify-end">
                      <p className="max-w-[85%] rounded-lg bg-primary px-3 py-2 text-[13px] leading-5 text-primary-foreground shadow-xs">
                        {turn.text}
                      </p>
                    </div>
                  ) : (
                    <div key={index} className="flex justify-start">
                      <div className="w-full max-w-[92%]">
                        <AssistantBubble turn={turn} />
                      </div>
                    </div>
                  ),
                )}

                {sending && (
                  <p className="pl-1 text-[12px] text-muted-foreground">
                    Thinking…
                  </p>
                )}

                <div ref={bottomRef} />
              </div>
            )}

            {turns.length === 0 && (
              <div className="mx-auto mt-4 flex max-w-2xl flex-wrap justify-center gap-1.5">
                {examples.slice(0, 6).map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => void send(example)}
                    className="rounded-full border border-border-strong bg-card px-3 py-1 text-[12px] text-secondary-foreground transition-colors hover:bg-muted"
                  >
                    {example}
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>

          <div className="border-t border-border p-3">
            <div className="flex items-end gap-2">
              <Textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault()

                    void send(question)
                  }
                }}
                placeholder="e.g. Which units are overdue over 60 days?"
                rows={2}
                maxLength={MAX_QUESTION_LENGTH}
                className="max-h-40 min-h-11 resize-none"
              />

              <Button
                type="button"
                onClick={() => void send(question)}
                disabled={sending || question.trim().length === 0}
                className="h-11 shrink-0"
              >
                <Send size={15} />
                Ask
              </Button>
            </div>

            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Answers cover overdue payments for now. Press Enter to ask,
              Shift+Enter for a new line.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
