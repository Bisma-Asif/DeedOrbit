import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

import { Badge } from "@/components/ui/badge"

import { Button } from "@/components/ui/button"

import type { CustomerSaveResult } from "@/lib/leads-api"

import { orDash } from "@/lib/format"

import { navigate } from "@/lib/router"

import { formatPkPhone } from "@shared/customer-entry"

/**
 * What a customer save answered, shown where the officer is still looking at the form.
 *
 * The route never refuses a save over a duplicate and never refuses one over a birthday
 * that makes the buyer fifteen, so the answer has to carry both back to the desk rather than
 * raise them as failures. That also means they cannot be a toast: a toast outlives neither a
 * dialog that closed nor the officer's attention, and the whole value of the notice is that
 * they read it *before* moving on to the booking.
 */

export interface CustomerSaveResultNoticeProps {
  result: CustomerSaveResult

  /** Offered only when leaving the form is the right next step — a dialog, not a profile. */

  onOpenRecord?: () => void
}

export function CustomerSaveResultNotice({
  result,

  onOpenRecord,
}: CustomerSaveResultNoticeProps) {
  const { customer, duplicates, warnings, changedCount } = result

  const headline =
    changedCount === undefined
      ? `Entered by hand. ${customer.name} is now in this workspace.`
      : changedCount === 0
        ? "Saved. Nothing on the record changed, so no edit was added to its history."
        : `Edited by hand. ${changedCount} field${
            changedCount === 1 ? "" : "s"
          } changed, and the history says who typed them and when.`

  return (
    <div className="flex flex-col gap-2.5">
      <Alert variant="neutral">
        <AlertDescription>{headline}</AlertDescription>
      </Alert>

      {warnings.map((warning) => (
        <Alert key={warning} variant="pending">
          <AlertDescription>{warning}</AlertDescription>
        </Alert>
      ))}

      {duplicates.length > 0 && (
        <Alert variant="pending">
          <AlertTitle>
            {duplicates.length === 1
              ? "Another record already carries this detail"
              : `${duplicates.length} other records already carry this detail`}
          </AlertTitle>
          <AlertDescription asChild>
            <ul className="mt-1 flex flex-col gap-1.5">
              {duplicates.map((duplicate) => (
                <li
                  key={duplicate.id}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1"
                >
                  <button
                    type="button"
                    className="text-foreground underline underline-offset-2"
                    onClick={() => navigate(`/customers/${duplicate.id}`)}
                  >
                    {duplicate.name}
                  </button>
                  <span className="tabular-nums">
                    {orDash(formatPkPhone(duplicate.phone) ?? duplicate.phone)}
                  </span>
                  {duplicate.cnicMasked && (
                    <span className="tabular-nums">{duplicate.cnicMasked}</span>
                  )}
                  <Badge variant="outline">{duplicate.reason}</Badge>
                </li>
              ))}
            </ul>
          </AlertDescription>
          <p className="mt-1 text-[11.5px] leading-4 text-muted-foreground">
            Nothing was refused: both files stand. Only you can tell whether
            they are the same buyer — a husband and wife booking together share
            a number, and a name spelled a second way usually is the same
            person.
          </p>
        </Alert>
      )}

      {onOpenRecord && (
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={onOpenRecord}
        >
          Open the record
        </Button>
      )}
    </div>
  )
}
