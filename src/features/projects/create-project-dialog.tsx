import { useEffect, useState } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useSave } from "@/features/organization/use-save"
import { projectsApi } from "@/lib/projects-api"
import { navigate } from "@/lib/router"
import {
  ProjectFormFields,
  emptyProjectForm,
  formToInput,
  validateProjectForm,
  type ProjectFormErrors,
  type ProjectFormValues,
} from "@/features/projects/project-form"

/**
 * Creates a project and opens it.
 *
 * A newly created project has nowhere useful to send the user except its own
 * detail page, so this navigates there on success rather than closing and
 * leaving them on a list whose row they would have to find. The list reloads on
 * remount anyway, so going straight in loses nothing.
 *
 * The form is reset only when the dialog opens, not when it closes, so a
 * half-entered project survives a stray Escape.
 */
export function CreateProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [values, setValues] = useState<ProjectFormValues>(emptyProjectForm)
  const [clientErrors, setClientErrors] = useState<ProjectFormErrors>({})
  const save = useSave()

  useEffect(() => {
    if (open) {
      setValues(emptyProjectForm())
      setClientErrors({})
      save.clear()
    }
    // `save` is recreated on every render, so depending on it would reset the
    // form continuously. Opening the dialog is the only trigger that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function patch(next: Partial<ProjectFormValues>) {
    setValues((current) => ({ ...current, ...next }))
    // Typing over a rejected value clears its message, so a user who has fixed
    // the problem is not still looking at the old complaint.
    setClientErrors((current) => {
      const next = { ...current }
      for (const key of Object.keys(next)) delete next[key]
      return next
    })
  }

  async function submit() {
    const invalid = validateProjectForm(values)
    setClientErrors(invalid)
    if (Object.keys(invalid).length > 0) return

    await save.run(async () => {
      const { project } = await projectsApi.create(formToInput(values))

      onOpenChange(false)
      navigate(`/projects/${project.id}`)
    })
  }

  // The server's field errors are spread last so they win: it is the authority,
  // and the client pre-check cannot know that a name is already taken.
  const errors = { ...clientErrors, ...save.fields }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            A project is the development itself. Units are published to
            inventory from it once it exists.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3.5 py-1">
          {save.error && (
            <Alert variant="danger">
              <AlertDescription>{save.error}</AlertDescription>
            </Alert>
          )}

          <ProjectFormFields
            values={values}
            onChange={patch}
            errors={errors}
            compact
            idPrefix="new-project"
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={save.saving}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={save.saving}>
            {save.saving ? "Creating…" : "Create project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
