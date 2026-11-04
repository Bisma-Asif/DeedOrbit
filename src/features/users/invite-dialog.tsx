import { useEffect, useState, type FormEvent } from "react"
import { Copy, Mail, UserPlus } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ApiError, usersApi, type RoleSummary } from "@/lib/api"
import { formatDateTime } from "@/lib/format"

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

type Errors = Partial<Record<"email" | "fullName" | "roleId", string>>

export type InviteDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  roles: RoleSummary[]
  onInvited: () => void
}

/**
 * Creates a pending membership and an invitation token.
 *
 * There is no mail service yet, so when the server is running with
 * `DEEDORBIT_EXPOSE_RESET_TOKEN=1` it returns the invite token and this dialog
 * surfaces it for manual delivery. That branch is labelled plainly rather than
 * hidden, so nobody mistakes it for a working email path.
 */
export function InviteDialog({
  open,
  onOpenChange,
  roles,
  onInvited,
}: InviteDialogProps) {
  const [email, setEmail] = useState("")
  const [fullName, setFullName] = useState("")
  const [jobTitle, setJobTitle] = useState("")
  const [roleId, setRoleId] = useState("")
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [submitted, setSubmitted] = useState(false)
  const [pending, setPending] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [issued, setIssued] = useState<{
    email: string
    roleLabel: string
    token: string
    expiresAt: string
  } | null>(null)
  const [copied, setCopied] = useState(false)

  // Default to the least-privileged assignable role, so an admin has to opt in
  // to more access rather than out of it.
  useEffect(() => {
    if (open && !roleId && roles.length > 0) {
      setRoleId(roles[roles.length - 1].id)
    }
  }, [open, roleId, roles])

  useEffect(() => {
    if (!open) {
      setEmail("")
      setFullName("")
      setJobTitle("")
      setRoleId("")
      setTouched({})
      setSubmitted(false)
      setFormError(null)
      setFieldErrors({})
      setIssued(null)
      setCopied(false)
    }
  }, [open])

  const errors: Errors = {
    email: !email.trim()
      ? "Work email is required."
      : !EMAIL_PATTERN.test(email.trim())
        ? "Enter a valid work email address."
        : fieldErrors.email,
    fullName:
      fullName.trim().length < 2
        ? "Enter the member's name."
        : fieldErrors.fullName,
    roleId: !roleId ? "Choose a role." : fieldErrors.roleId,
  }

  const showError = (key: keyof Errors) =>
    Boolean(errors[key]) && (touched[key] || submitted)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitted(true)
    setFormError(null)
    setFieldErrors({})
    if (Object.values(errors).some(Boolean) || roles.length === 0) return

    setPending(true)
    try {
      const result = await usersApi.invite({
        email: email.trim().toLowerCase(),
        fullName: fullName.trim(),
        roleId: roleId as RoleSummary["id"],
        ...(jobTitle.trim() ? { jobTitle: jobTitle.trim() } : {}),
      })
      const roleLabel =
        roles.find((role) => role.id === roleId)?.label ?? "Assigned role"
      setIssued({
        email: email.trim().toLowerCase(),
        roleLabel,
        token: result.invitation.devInviteToken ?? "",
        expiresAt: result.invitation.expiresAt,
      })
      onInvited()
    } catch (caught) {
      if (caught instanceof ApiError) {
        setFormError(caught.message)
        setFieldErrors(caught.fields)
      } else {
        setFormError("The invitation could not be created.")
      }
    } finally {
      setPending(false)
    }
  }

  async function copyToken() {
    if (!issued) return
    try {
      await navigator.clipboard.writeText(issued.token)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {issued ? (
          <>
            <DialogHeader>
              <DialogTitle>Invitation created</DialogTitle>
              <DialogDescription asChild>
                <div className="text-[12.5px] leading-5">
                  {issued.email} now holds a pending {issued.roleLabel}{" "}
                  membership in this workspace. They cannot sign in until the
                  invitation is accepted.
                </div>
              </DialogDescription>
            </DialogHeader>

            {issued.token ? (
              <Alert variant="pending">
                <Mail size={15} />
                <div className="flex-1">
                  <AlertTitle>No mail service is connected</AlertTitle>
                  <AlertDescription asChild>
                    <div className="space-y-2">
                      <p>
                        The server returned the invitation token because it is
                        running with token exposure enabled. Send this to the
                        new member; it expires{" "}
                        {formatDateTime(issued.expiresAt)}.
                      </p>
                      <div className="flex items-center gap-2">
                        <code className="min-w-0 flex-1 truncate rounded border border-border bg-card px-2 py-1 font-mono text-[11px]">
                          {issued.token}
                        </code>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={copyToken}
                        >
                          <Copy size={12} /> {copied ? "Copied" : "Copy"}
                        </Button>
                      </div>
                    </div>
                  </AlertDescription>
                </div>
              </Alert>
            ) : (
              <Alert>
                <Mail size={15} />
                <AlertDescription>
                  An invitation email has been queued. It expires{" "}
                  {formatDateTime(issued.expiresAt)}.
                </AlertDescription>
              </Alert>
            )}

            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <DialogHeader>
              <DialogTitle>Invite a member</DialogTitle>
              <DialogDescription asChild>
                <div className="text-[12.5px] leading-5">
                  Creates a pending membership in this workspace. The invitation
                  expires in 72 hours unless reissued.
                </div>
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-4 py-1">
              {formError ? (
                <Alert variant="danger">
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              ) : null}

              <Field
                label="Work email"
                htmlFor="invite-email"
                required
                error={showError("email") ? errors.email : undefined}
              >
                <Input
                  id="invite-email"
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="name@organisation.com"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value)
                    setFormError(null)
                  }}
                  onBlur={() =>
                    setTouched((current) => ({ ...current, email: true }))
                  }
                />
              </Field>

              <Field
                label="Full name"
                htmlFor="invite-name"
                required
                error={showError("fullName") ? errors.fullName : undefined}
              >
                <Input
                  id="invite-name"
                  autoComplete="off"
                  placeholder="Amina Rahman"
                  value={fullName}
                  onChange={(event) => {
                    setFullName(event.target.value)
                    setFormError(null)
                  }}
                  onBlur={() =>
                    setTouched((current) => ({ ...current, fullName: true }))
                  }
                />
              </Field>

              <Field
                label="Job title"
                htmlFor="invite-title"
                hint="Optional. Shown on the member list and in the audit trail."
              >
                <Input
                  id="invite-title"
                  autoComplete="off"
                  placeholder="Sales consultant"
                  value={jobTitle}
                  onChange={(event) => setJobTitle(event.target.value)}
                />
              </Field>

              <Field
                label="Role"
                htmlFor="invite-role"
                required
                error={showError("roleId") ? errors.roleId : undefined}
                hint="You can only assign roles at or below your own level."
              >
                <Select value={roleId} onValueChange={setRoleId}>
                  <SelectTrigger id="invite-role" className="w-full">
                    <SelectValue placeholder="Choose a role" />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((role) => (
                      <SelectItem key={role.id} value={role.id}>
                        {role.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending || roles.length === 0}>
                <UserPlus size={13} />{" "}
                {pending ? "Creating…" : "Create invitation"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
