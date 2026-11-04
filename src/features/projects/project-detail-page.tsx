import { useEffect, useState, type ReactNode } from "react"
import {
  ArrowLeft,
  Building2,
  Boxes,
  CalendarClock,
  Check,
  FileText,
  Layers,
  Save,
} from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EmptyState } from "@/components/empty-state"
import { PageHeader } from "@/components/page-header"
import { useSave } from "@/features/organization/use-save"
import { ProjectStatusBadge } from "@/features/projects/project-status-badge"
import { ProjectStructurePanel } from "@/features/projects/project-structure-panel"
import { InventoryPanel } from "@/features/projects/inventory-panel"
import { DocumentSection } from "@/features/documents/document-section"
import {
  ProjectFormFields,
  formToInput,
  projectFormUnchanged,
  projectToForm,
  type ProjectFormErrors,
  type ProjectFormValues,
} from "@/features/projects/project-form"
import { formatDate, formatDateTime, formatNumber, orDash } from "@/lib/format"
import { projectsApi } from "@/lib/projects-api"
import { navigate } from "@/lib/router"
import { useAsyncResource } from "@/lib/use-async-resource"
import { OWNERSHIP_LABELS, PROJECT_TYPE_LABELS } from "@shared/projects"

/**
 * The project detail page.
 *
 * Four tabs. `Structure` is the editable hierarchy of blocks, sectors, and floors
 * and lives in `project-structure-panel.tsx`. `Inventory` is the units for sale and
 * lives in `inventory-panel.tsx`; every unit names a structure node, so the two tabs
 * are dependent — a project with no structure has nowhere to put a unit, and the
 * inventory tab says so rather than offering a form the server would refuse.
 *
 * The Settings tab edits through the same form as the create dialog and sends a
 * full save, because the two screens own the same record and a partial PATCH
 * here would only create a second shape to reason about. The server remains the
 * authority on every field either way.
 */

// Named props interfaces rather than inline literals: `oxfmt` strips the
// separators between members of a single-line object type, so
// `{ label: string; children: ReactNode }` on one line becomes a syntax error.
interface FactProps {
  label: string
  children: ReactNode
}

interface MaybeFactProps {
  label: string
  value: string | null
}

/** A labelled value in the overview grid. A dash means the field is unset. */
function Fact({ label, children }: FactProps) {
  return (
    <div className="min-w-0">
      <p className="text-[10.5px] font-semibold tracking-[0.07em] text-muted-foreground uppercase">
        {label}
      </p>
      <div className="mt-1 text-[13px] leading-5 text-foreground">
        {children}
      </div>
    </div>
  )
}

/** An optional fact. Renders the dash rather than an empty box. */
function MaybeFact({ label, value }: MaybeFactProps) {
  return (
    <Fact label={label}>
      {value ? (
        <span className="tabular-nums">{value}</span>
      ) : (
        <span className="text-muted-foreground/60">{orDash(null)}</span>
      )}
    </Fact>
  )
}

export function ProjectDetailPage({ projectId }: { projectId: string }) {
  const { data, loading, error, reload } = useAsyncResource((signal) =>
    projectsApi.read(projectId, signal),
  )

  const project = data?.project ?? null
  const canEdit = data?.canEdit ?? false

  // The form's own copy, so a reload never discards an edit in progress while a
  // move to a different project cannot leave the previous one's values up.
  const [values, setValues] = useState<ProjectFormValues | null>(null)
  const save = useSave()

  useEffect(() => {
    if (project) setValues(projectToForm(project))
  }, [project])

  /** The stored record as the form sees it, i.e. the discard/save baseline. */
  const baseline = project ? projectToForm(project) : null
  const unchanged =
    baseline === null || values === null
      ? true
      : projectFormUnchanged(baseline, values)

  function patch(next: Partial<ProjectFormValues>) {
    setValues((current) => (current ? { ...current, ...next } : current))
    // Editing clears a stale rejection, so a user who has just fixed the problem
    // is not still looking at the old complaint.
    save.clear()
  }

  async function submit() {
    if (!values) return

    await save.run(async () => {
      await projectsApi.update(projectId, formToInput(values))
      await reload()
    })
  }

  function discard() {
    if (baseline) setValues(baseline)
    save.clear()
  }

  const header = (
    <PageHeader
      scope={
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 h-6 px-2 text-[11.5px]"
          onClick={() => navigate("/projects")}
        >
          <ArrowLeft size={12} />
          Projects
        </Button>
      }
      title={project?.name ?? "Project"}
      description={project?.developer}
      actions={project ? <ProjectStatusBadge status={project.status} /> : null}
    />
  )

  if (!project) {
    return (
      <div className="flex flex-col gap-4">
        {header}

        {error ? (
          <Alert variant="danger">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : (
          <Card>
            <CardContent className="py-2">
              <EmptyState
                icon={Building2}
                title={loading ? "Loading…" : "Project not found"}
                description={
                  loading
                    ? undefined
                    : "It may have been removed, or it belongs to another workspace."
                }
                action={
                  loading ? undefined : (
                    <Button
                      variant="outline"
                      onClick={() => navigate("/projects")}
                    >
                      Back to projects
                    </Button>
                  )
                }
              />
            </CardContent>
          </Card>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {header}

      <Tabs defaultValue="overview" className="flex flex-col gap-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="structure">
            <Layers size={13} />
            Structure
          </TabsTrigger>
          <TabsTrigger value="inventory">
            <Boxes size={13} />
            Inventory
          </TabsTrigger>
          <TabsTrigger value="documents">
            <FileText size={13} />
            Documents
          </TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="flex flex-col gap-3">
            <Card>
              <CardHeader>
                <CardTitle>At a glance</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-x-6 gap-y-4 px-4 py-3.5 sm:grid-cols-2 lg:grid-cols-3">
                <Fact label="Developer">{project.developer}</Fact>
                <Fact label="Location">{project.location}</Fact>
                <Fact label="Status">
                  <ProjectStatusBadge status={project.status} />
                </Fact>
                <Fact label="Reference">
                  {project.code ? (
                    <span className="font-mono text-[12.5px]">
                      {project.code}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/60">
                      {orDash(null)}
                    </span>
                  )}
                </Fact>
                <MaybeFact
                  label="Project type"
                  value={
                    project.projectType
                      ? PROJECT_TYPE_LABELS[project.projectType]
                      : null
                  }
                />
                <MaybeFact
                  label="Ownership"
                  value={
                    project.ownershipType
                      ? OWNERSHIP_LABELS[project.ownershipType]
                      : null
                  }
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Schedule</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-x-6 gap-y-4 px-4 py-3.5 sm:grid-cols-3">
                <Fact label="Launch date">
                  {project.launchDate ? (
                    <span className="flex items-center gap-1.5 tabular-nums">
                      <CalendarClock
                        size={13}
                        className="text-muted-foreground"
                      />
                      {formatDate(project.launchDate)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/60">
                      {orDash(null)}
                    </span>
                  )}
                </Fact>
                <MaybeFact
                  label="Handover date"
                  value={
                    project.handoverDate
                      ? formatDate(project.handoverDate)
                      : null
                  }
                />
                <MaybeFact
                  label="Planned units"
                  value={
                    project.plannedUnits === null
                      ? null
                      : formatNumber(project.plannedUnits)
                  }
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Commercial</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 px-4 py-3.5">
                <Fact label="Payment terms">
                  {project.paymentTerms ? (
                    <p className="max-w-2xl leading-6">
                      {project.paymentTerms}
                    </p>
                  ) : (
                    <span className="text-muted-foreground/60">
                      {orDash(null)}
                    </span>
                  )}
                </Fact>

                <Separator />

                <Fact label="Description">
                  {project.description ? (
                    <p className="max-w-2xl leading-6">{project.description}</p>
                  ) : (
                    <span className="text-muted-foreground/60">
                      {orDash(null)}
                    </span>
                  )}
                </Fact>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Record</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-x-6 gap-y-4 px-4 py-3.5 sm:grid-cols-3">
                <Fact label="Project ID">
                  <span className="font-mono text-[12px] text-muted-foreground">
                    {project.id}
                  </span>
                </Fact>
                <MaybeFact
                  label="Created"
                  value={formatDateTime(project.createdAt)}
                />
                <MaybeFact
                  label="Last updated"
                  value={formatDateTime(project.updatedAt)}
                />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="structure">
          <ProjectStructurePanel
            projectId={project.id}
            projectName={project.name}
          />
        </TabsContent>

        <TabsContent value="inventory">
          <InventoryPanel projectId={project.id} projectName={project.name} />
        </TabsContent>

        <TabsContent value="documents">
          <Card>
            <CardHeader>
              <CardTitle>Project documents</CardTitle>
            </CardHeader>
            <CardContent className="px-4 py-4">
              <DocumentSection entityType="project" entityId={project.id} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings">
          <Card>
            <CardHeader>
              <CardTitle>Project settings</CardTitle>
            </CardHeader>
            <CardContent className="px-4 py-3.5">
              {!canEdit ? (
                <EmptyState
                  icon={Building2}
                  size="sm"
                  title="Read only"
                  description="Your role can open this project but not change it."
                />
              ) : (
                <div className="flex flex-col gap-3.5">
                  {save.error && (
                    <Alert variant="danger">
                      <AlertDescription>{save.error}</AlertDescription>
                    </Alert>
                  )}

                  {save.saved && (
                    <Alert variant="success">
                      <AlertDescription>Changes saved.</AlertDescription>
                    </Alert>
                  )}

                  {values && (
                    <ProjectFormFields
                      values={values}
                      onChange={patch}
                      errors={save.fields as ProjectFormErrors}
                      idPrefix="project-settings"
                    />
                  )}

                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={discard}
                      disabled={save.saving || unchanged}
                    >
                      Discard
                    </Button>
                    <Button
                      onClick={submit}
                      disabled={save.saving || unchanged}
                    >
                      {save.saving ? (
                        <>
                          <Save size={13} />
                          Saving…
                        </>
                      ) : save.saved ? (
                        <>
                          <Check size={13} />
                          Saved
                        </>
                      ) : (
                        <>
                          <Save size={13} />
                          Save changes
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
