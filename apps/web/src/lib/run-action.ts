import { toast } from "sonner"
import { describeMatrixError } from "@nexspeak/core/matrix/errors"

/** Runs a Matrix action in the background and shows a toast if it fails. */
export function runAction(action: Promise<unknown>, fallback: string): void {
  action.catch((error: unknown) => toast.error(describeMatrixError(error, fallback)))
}
