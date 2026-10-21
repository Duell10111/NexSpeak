"use client"

import { useId, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useMatrixClient } from '@/hooks/useMatrixClient'
import { useTranslation } from '@/hooks/useTranslation'
import { describeMatrixError } from '@nexspeak/core/matrix/errors'
import { endPoll, voteInPoll } from '@nexspeak/core/matrix/polls'
import type { MatrixMessage } from '@nexspeak/core/matrix/types'

/** No subscriptions or network requests per poll: the room timeline supplies its derived state. */
export function PollMessage({ message }: { message: MatrixMessage }) {
  const { t } = useTranslation()
  const { client, isCryptoReady } = useMatrixClient()
  const poll = message.poll!
  const inputName = useId()
  const ownKey = poll.ownAnswers.join('\0')
  const [selection, setSelection] = useState<{ ownKey: string; answers: string[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const selected = selection?.ownKey === ownKey ? selection.answers : poll.ownAnswers
  const showResults = poll.disclosed || poll.ended
  const enabled = Boolean(client && message.status === 'sent' && !poll.ended && (!message.event.isEncrypted() || isCryptoReady))
  const changed = [...selected].sort().join('\0') !== [...poll.ownAnswers].sort().join('\0')
  const act = async (end: boolean) => {
    if (!client || busy) return
    setBusy(true)
    try {
      if (end) await endPoll(client, message.roomId, message.event, t('poll.ended'))
      else await voteInPoll(client, message.roomId, message.event, selected)
      setSelection(null)
    } catch (error) {
      toast.error(describeMatrixError(error, t('poll.actionFailed')))
    } finally { setBusy(false) }
  }
  return (
    <section className="mt-1 max-w-md whitespace-normal rounded-lg border border-border bg-secondary p-3" aria-label={t('poll.label')} data-testid="poll">
      <h3 className="mb-1 break-words font-semibold">{poll.question}</h3>
      <p className="mb-3 text-xs text-muted-foreground">{poll.ended ? t('poll.ended') : poll.maxSelections > 1 ? t('poll.chooseMultiple', { count: poll.maxSelections }) : t('poll.chooseOne')}</p>
      <fieldset disabled={!enabled || busy} className="grid gap-2">
        <legend className="sr-only">{poll.question}</legend>
        {poll.answers.map((answer) => (
          <label key={answer.id} className="relative flex cursor-pointer items-center gap-2 overflow-hidden rounded border border-border p-2 text-sm has-disabled:cursor-default">
            {showResults && <span aria-hidden className="absolute inset-y-0 left-0 bg-primary/15" style={{ width: `${poll.voters ? 100 * answer.votes / poll.voters : 0}%` }} />}
            <input type={poll.maxSelections === 1 ? 'radio' : 'checkbox'} name={inputName} checked={selected.includes(answer.id)} onChange={() => {
              const answers = poll.maxSelections === 1 ? [answer.id] : selected.includes(answer.id) ? selected.filter((id) => id !== answer.id) : selected.length < poll.maxSelections ? [...selected, answer.id] : selected
              setSelection({ ownKey, answers })
            }} className="relative shrink-0" />
            <span className="relative min-w-0 flex-1 break-words">{answer.text}</span>
            {showResults && <span className="relative shrink-0 text-xs text-muted-foreground">{answer.votes === 1 ? t('poll.oneVote') : t('poll.answerVotes', { count: answer.votes })}</span>}
          </label>
        ))}
      </fieldset>
      <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">{showResults ? poll.voters === 1 ? t('poll.oneVoter') : t('poll.voters', { count: poll.voters }) : t('poll.resultsHidden')}</p>
      {!poll.ended && <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" disabled={!enabled || busy || !selected.length || !changed} onClick={() => void act(false)}>{poll.ownAnswers.length ? t('poll.changeVote') : t('poll.vote')}</Button>
        {poll.canEnd && <Button size="sm" variant="outline" disabled={!enabled || busy} onClick={() => void act(true)}>{t('poll.end')}</Button>}
      </div>}
    </section>
  )
}
