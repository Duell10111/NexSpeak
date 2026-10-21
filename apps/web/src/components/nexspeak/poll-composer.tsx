"use client"

import { useState } from 'react'
import { toast } from 'sonner'
import { X } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useTranslation } from '@/hooks/useTranslation'
import { describeMatrixError } from '@nexspeak/core/matrix/errors'
import type { PollDraft } from '@nexspeak/core/matrix/polls'

export function PollComposer({ onClose, onCreate }: { onClose: () => void; onCreate: (draft: PollDraft) => Promise<unknown> }) {
  const { t } = useTranslation()
  const [question, setQuestion] = useState('')
  const [answers, setAnswers] = useState(['', ''])
  const [multiple, setMultiple] = useState(false)
  const [disclosed, setDisclosed] = useState(true)
  const [sending, setSending] = useState(false)
  const valid = question.trim() && answers.every((answer) => answer.trim())
  const submit = async () => {
    if (!valid || sending) return
    setSending(true)
    try {
      await onCreate({ question, answers, multiple, disclosed })
      onClose()
    } catch (error) {
      toast.error(describeMatrixError(error, t('poll.createFailed')))
    } finally { setSending(false) }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !sending && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('poll.create')}</DialogTitle>
          <DialogDescription>{t('poll.description')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => { event.preventDefault(); void submit() }} className="grid gap-4">
          <label className="grid gap-1 text-sm font-medium">
            {t('poll.question')}
            <Input value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={1000} required disabled={sending} />
          </label>
          <div className="grid gap-2">
            {answers.map((answer, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input aria-label={t('poll.answer', { number: index + 1 })} value={answer} onChange={(event) => setAnswers(answers.map((old, position) => position === index ? event.target.value : old))} maxLength={500} required disabled={sending} />
                {answers.length > 2 && <button type="button" aria-label={t('poll.removeAnswer', { number: index + 1 })} disabled={sending} onClick={() => setAnswers(answers.filter((_, position) => position !== index))} className="rounded p-1 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>}
              </div>
            ))}
            <Button type="button" variant="outline" disabled={answers.length >= 20 || sending} onClick={() => setAnswers([...answers, ''])}>{t('poll.addAnswer')}</Button>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={multiple} disabled={sending} onChange={(event) => setMultiple(event.target.checked)} />{t('poll.multiple')}</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!disclosed} disabled={sending} onChange={(event) => setDisclosed(!event.target.checked)} />{t('poll.hideResults')}</label>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={sending} onClick={onClose}>{t('common.cancel')}</Button>
            <Button type="submit" disabled={!valid || sending}>{t('poll.create')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
