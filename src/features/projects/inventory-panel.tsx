/**
 * The Inventory tab — the units for sale inside one project.
 *
 * A unit is the thing a buyer is actually quoted, so this tab is a table rather than
 * a tree: the structure tab answers "what is this development made of", and this one
 * answers "what is there to sell, at what price, and in what state". Rows are sorted
 * by unit code because that is the identifier used in correspondence with a client.
 *
 * Decisions worth stating, because each of them is a choice rather than a default:
 *
 *  * A unit must name a structure node, and the server enforces it. The panel
 *    therefore has a case the structure tab does not: a project with no structure
 *    yet cannot have units, so it says so and points at the Structure tab instead of
 *    offering an "Add unit" button that would be refused on submit.
 *
 *  * The totals come from the server rather than being summed from the rows on
 *    screen. They sit above a table that is filtered client-side, so a panel that
 *    counted its own visible rows would show a different number every time someone
 *    typed in the search box, and a total that moves when you search is a total
 *    nobody trusts.
 *
 *  * Two value figures, not one. `openValue` covers units not yet sold, which is what
 *    "what is this project still worth" means. `totalValue` adds the drafts, whose
 *    prices are stated but not yet offered. Collapsing them into a single "value"
 *    would have to pick one meaning and be wrong about the other.
 *
 *  * Attributes are a flexible key/value list rather than fixed columns, because the
 *    set differs per unit type: bedrooms on an apartment, road frontage on a plot, a
 *    private pool on a villa. The editor sends the whole set on every save, which is
 *    what makes removing a tag expressible at all.
 *
 * Every write goes through the server and reloads the list. Nothing is applied
 * optimistically: the counts above the table would otherwise disagree with the rows
 * underneath them until the reload landed, and a total that disagrees with the table
 * it sits above is worse than a short wait.
 */

import { useEffect, useMemo, useState } from "react"

import {
  Boxes,
  BookOpenCheck,
  Building2,
  FileText,
  History,
  MapPin,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  Upload,
  Video,
  X,
} from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { useOrganizationSettings } from "@/features/organization/use-organization"

import type { QuotationTenant } from "@/features/projects/quotation-document"

import { UnitQuotationsDialog } from "@/features/projects/unit-quotations-dialog"

import { UnitImportDialog } from "@/features/projects/unit-import-dialog"

import {
  ActiveFilterChips,
  UnitCategoryCards,
  type ActiveFilterChip,
} from "@/features/projects/unit-category-cards"

import {
  EMPTY_CLASSIFICATION,
  FULL_DETAIL_FIELDS,
  FormSectionHeading,
  UnitBasicsFields,
  UnitDetailFields,
  UnitLocationFields,
  UnitMediaFields,
  classificationFromCategory,
  classificationInput,
  draftSquareFeet,
  draftVisibleFields,
  type UnitClassificationDraft,
} from "@/features/projects/unit-classification-fields"

import { BookingFormDialog } from "@/features/bookings/booking-form-dialog"

import { DocumentSection } from "@/features/documents/document-section"

import { BOOKABLE_UNIT_STATUS_KEYS } from "@shared/bookings"

import { navigate } from "@/lib/router"

import { Badge, type BadgeVariant } from "@/components/ui/badge"

import { Button } from "@/components/ui/button"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

import { Input } from "@/components/ui/input"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import {
  DataTable,
  TableFilter,
  type DataTableColumn,
} from "@/components/data-table"

import { EmptyState } from "@/components/empty-state"

import { Field, FieldGrid } from "@/components/field"

import { SavedViewControls } from "@/components/saved-view-controls"

import { StatCard } from "@/components/stat-card"

import { useSave } from "@/features/organization/use-save"

import {
  formatCurrency,
  formatCurrencyCompact,
  formatDateTime,
  formatNumber,
  orDash,
} from "@/lib/format"

import {
  filterUnits,
  projectInventoryApi,
  statusTiles,
  unitSearchText,
  unitStatusApi,
  type UnitFilters,
  type UnitStatusListResponse,
  type UnitStatusView,
  type UnitStructureOption,
  type UnitView,
} from "@/lib/project-inventory-api"

import {
  inventoryCategoriesApi,
  labelForKey,
  optionChoices,
  optionsOf,
} from "@/lib/inventory-categories-api"

import type { InventoryOptionsResponse } from "@/lib/inventory-categories-api"

import { useAsyncResource } from "@/lib/use-async-resource"

import { useSession } from "@/lib/session-context"

import { tenantFromSession } from "@/lib/workspace"

import {
  BUILT_IN_UNIT_STATUSES,
  UNIT_ATTRIBUTE_KEY_MAX,
  UNIT_ATTRIBUTE_MAX,
  UNIT_ATTRIBUTE_VALUE_MAX,
  UNIT_CODE_MAX,
  UNIT_LOCATION_MAX,
  UNIT_PRICE_MAX,
  UNIT_STATUS_LABEL_MAX,
  UNIT_STATUS_MAX,
  UNIT_STATUS_NOTE_MAX,
  UNIT_STATUS_TONE_HINTS,
  UNIT_STATUS_TONE_LABELS,
  UNIT_STATUS_TONES,
  UNIT_TYPE_LABELS,
  UNIT_TYPES,
  calculateUnitPriceBreakdown,
  isUnitType,
  type UnitAttribute,
  type UnitPricingConfig,
  type UnitStatusTone,
  type UnitType,
} from "@shared/inventory"

const GRID_TONE_STYLES: Record<UnitStatusTone, string> = {
  neutral: "border-border bg-muted/70",
  outline: "border-border bg-background",
  success: "border-emerald-500/30 bg-emerald-500/8",
  warning: "border-amber-500/30 bg-amber-500/8",
  info: "border-sky-500/30 bg-sky-500/8",
  danger: "border-red-500/30 bg-red-500/8",
}

/** "All" in a filter select arrives as an empty string, which is what is stored. */

interface InventoryPanelProps {
  projectId: string

  projectName: string
}

/**
 * Status colour, as a badge variant.
 *
 * The tone now travels with the status rather than being looked up here, so a custom
 * status a tenant added is coloured the way they chose instead of falling out of a
 * lookup table that only knows the built-ins. The one translation is `warning` to
 * `pending`, which are the same amber tokens under the name the badge component has
 * always used.
 *
 * None of these are danger states — a sold unit is a success, not a problem — so
 * nothing here uses the muted red the palette reserves for overdue and destructive
 * things. Reserved is amber because it is a commitment waiting on a signature, and
 * sold is grey because the money is already in and there is nothing left to act on.
 */

const TONE_VARIANT: Record<UnitStatusTone, BadgeVariant> = {
  neutral: "neutral",

  outline: "outline",

  success: "success",

  warning: "pending",

  info: "info",

  danger: "danger",
}

/**
 * The status a new unit is listed in.
 *
 * Read from the built-in seeds rather than hardcoded, so the default the form starts
 * on and the default the server falls back to cannot drift apart. Available, because
 * that is the state a freshly listed unit is in, and a create form that made the user
 * pick would be asking a question with one right answer.
 */

const DEFAULT_STATUS_KEY =
  BUILT_IN_UNIT_STATUSES.find((status) => status.key === "available")?.key ??
  "available"

/**
 * Which dialog is open, and what it is working on.
 *
 * Each variant is its own interface rather than one inline union, because `oxfmt`
 * collapses the separators inside a single-line object type.
 */

interface ClosedEditor {
  mode: "closed"
}

interface CreateEditor {
  mode: "create"

  /** Pre-selected node when the dialog was opened from a filtered view. */

  structureNodeId: string | null
}

interface EditEditor {
  mode: "edit"

  unit: UnitView
}

interface DeleteEditor {
  mode: "delete"

  unit: UnitView
}

type EditorState = ClosedEditor | CreateEditor | EditEditor | DeleteEditor

/** The fields the dialog collects, before they become a request body. */

interface UnitFormValues {
  unitCode: string

  unitType: UnitType | ""

  structureNodeId: string

  sizeSqft: string

  basePrice: string

  pricing: UnitPricingConfig

  /** A key into the tenant's vocabulary, never a literal from a fixed list. */

  status: string

  /** Why the status moved. Recorded on the trail, ignored unless it did. */

  statusNote: string

  location: string

  attributes: UnitAttribute[]

  /**
   * The property category block. Its own draft type, because every control is typed
   * text until submit; `classificationInput` turns it into the write payload.
   */

  classification: UnitClassificationDraft
}

/** The same form once the required fields are known to be present. */

interface CompleteUnitForm extends UnitFormValues {
  unitType: UnitType
}

/** One editable attribute row. `rowId` exists only to keep React's keys stable. */

interface AttributeDraft {
  rowId: string

  key: string

  value: string
}

interface UnitFormErrors {
  unitCode?: string

  unitType?: string

  structureNodeId?: string

  sizeSqft?: string

  basePrice?: string

  status?: string

  statusNote?: string

  location?: string

  attributes?: string
}

/** Which panel-level overlay is open, alongside the unit dialogs. */

interface ClosedOverlay {
  mode: "closed"
}

interface StatusesOverlay {
  mode: "statuses"
}

interface HistoryOverlay {
  mode: "history"

  unit: UnitView
}

/**
 * One unit's quotation trail.
 *
 * A read like the status history: every role that can see the unit can ask what
 * it has been offered at. The issue button inside it is what `canEdit` gates.
 */
interface QuotationsOverlay {
  mode: "quotations"

  unit: UnitView
}

type OverlayState = ClosedOverlay | StatusesOverlay | HistoryOverlay | QuotationsOverlay

let attributeRowCounter = 0

/** A row id that is never sent anywhere. */

function nextRowId(): string {
  attributeRowCounter += 1

  return `attr-${attributeRowCounter}`
}

function toDrafts(attributes: readonly UnitAttribute[]): AttributeDraft[] {
  return attributes.map((attribute) => ({
    rowId: nextRowId(),

    key: attribute.key,

    value: attribute.value,
  }))
}

/**
 * Rows the server will accept.
 *
 * A row with both halves blank is dropped rather than sent, because a half-filled
 * repeater row is an accident and the server would reject the whole unit for it. A
 * row with a value and no name is left in place: that is a mistake the user can see
 * and fix, and silently discarding it would look like the editor threw the value
 * away.
 */

function draftAttributes(drafts: readonly AttributeDraft[]): UnitAttribute[] {
  const collected: UnitAttribute[] = []

  for (const draft of drafts) {
    const key = draft.key.trim()

    const value = draft.value.trim()

    if (key === "" && value === "") continue

    collected.push({ key, value })
  }

  return collected
}

/**
 * The filter keys this panel owns, in the order a reader should see them.
 *
 * One list rather than scattered string literals, because "Clear all" has to empty every
 * filter and a key it misses is a chip that comes straight back.
 */
const FILTER_KEYS = [
  "type",
  "status",
  "node",
  "ptype",
  "stype",
  "usage",
  "furn",
  "mode",
  "poss",
  "minPrice",
  "maxPrice",
] as const

/** What each key is called in the chips, matching the control that sets it. */
const FILTER_LABELS: Record<string, string> = {
  type: "Family",

  status: "Status",

  node: "Located in",

  ptype: "Property type",

  stype: "Sub-type",

  usage: "Usage",

  furn: "Furnishing",

  mode: "Payment mode",

  poss: "Possession",

  minPrice: "Min price",

  maxPrice: "Max price",
}

/** A price filter, or null when the box is empty or holds something unparseable. */
function priceFilter(value: string | undefined): number | null {
  if (value === undefined || value === "") return null

  const parsed = Number(value)

  return Number.isFinite(parsed) ? parsed : null
}

/**
 * The chips for the filters that are actually doing something.
 *
 * Named from the workspace's own vocabulary — "Corner Shop", not `corner_shop` — and
 * falling back to the raw key when an option has been deleted, so a saved view built on
 * a retired option shows what it is still filtering by instead of disappearing.
 */
function buildFilterChips(
  filters: Record<string, string>,
  active: UnitFilters,
  statuses: readonly UnitStatusView[],
  vocabulary: InventoryOptionsResponse | null,
  structureOptions: readonly UnitStructureOption[],
  currency: string,
): ActiveFilterChip[] {
  const chips: ActiveFilterChip[] = []

  if (active.unitType) {
    chips.push({
      key: "type",

      label: FILTER_LABELS.type,

      value: UNIT_TYPE_LABELS[active.unitType],
    })
  }

  if (active.status) {
    chips.push({
      key: "status",

      label: FILTER_LABELS.status,

      value:
        statuses.find((status) => status.key === active.status)?.label ??
        active.status,
    })
  }

  if (active.structureNodeId) {
    chips.push({
      key: "node",

      label: FILTER_LABELS.node,

      value:
        structureOptions
          .find((option) => option.id === active.structureNodeId)
          ?.path.join(" / ") ?? active.structureNodeId,
    })
  }

  const categoryChips: Array<{
    key: string
    kind: Parameters<typeof optionsOf>[1]
    value: string | null | undefined
  }> = [
    {
      key: "ptype",

      kind: "property_type",

      value: active.propertyTypeKey,
    },

    {
      key: "stype",

      kind: "property_subtype",

      value: active.subtypeKey,
    },

    {
      key: "usage",

      kind: "usage_category",

      value: active.usageKey,
    },

    {
      key: "furn",

      kind: "furnishing",

      value: active.furnishingKey,
    },

    {
      key: "mode",

      kind: "sale_mode",

      value: active.saleModeKey,
    },

    {
      key: "poss",

      kind: "possession_status",

      value: active.possessionKey,
    },
  ]

  for (const entry of categoryChips) {
    if (
      entry.value === null ||
      entry.value === undefined ||
      !filters[entry.key]
    ) {
      continue
    }

    chips.push({
      key: entry.key,

      label: FILTER_LABELS[entry.key],

      value:
        labelForKey(optionsOf(vocabulary, entry.kind), entry.value) ??
        entry.value,
    })
  }

  const money = (key: string, value: number | null | undefined) => {
    if (value === null || value === undefined || filters[key] === undefined)
      return

    chips.push({
      key,

      label: FILTER_LABELS[key],

      value: formatCurrency(value, currency, { maximumFractionDigits: 0 }),
    })
  }

  money("minPrice", active.minPrice)

  money("maxPrice", active.maxPrice)

  return chips
}

/**
 * A unit is only sendable once the fields the schema requires are filled in.
 *
 * Written as a guard rather than a plain boolean so the submit handler gets the same
 * answer the disabled button already used, instead of re-asserting the required
 * fields at the call site. Size and price are checked for presence only: whether
 * they are in range is the server's answer, and it is a better one.
 *
 * A property type is required alongside them: it answers `unit_type`, the usage
 * category and the size conversion, so a unit saved without one is a unit every other
 * screen has to guess about.
 */

function unitReady(values: UnitFormValues): values is CompleteUnitForm {
  return (
    values.unitCode !== "" &&
    values.unitType !== "" &&
    values.structureNodeId !== "" &&
    values.sizeSqft !== "" &&
    values.basePrice !== "" &&
    values.classification.propertyType !== ""
  )
}

export function InventoryPanel({
  projectId,

  projectName,
}: InventoryPanelProps) {
  const units = useAsyncResource((signal) =>
    projectInventoryApi.list(projectId, signal),
  )

  const structure = useAsyncResource((signal) =>
    projectInventoryApi.structure(projectId, signal),
  )

  /**
   * The workspace's status vocabulary, fetched alongside the units.
   *
   * Separate from the list response because it belongs to the workspace rather than to
   * this project: the same list configures every project, and it is managed as
   * configuration. Both are reloaded together after a change, so a status retired in
   * the manager cannot leave a stale option in a picker.
   */

  const vocabulary = useAsyncResource((signal) => unitStatusApi.list(signal))

  /**
   * The workspace's property-category vocabulary — the nine dropdown lists.
   *
   * Fetched here rather than per dialog because four things need it at once: the filter
   * chips, the unit form's pickers, the grid's type labels and the retire warnings.
   * One request fills all of them, and a unit's own labels still arrive resolved inside
   * `unit.category`, so a slow vocabulary never leaves a table row blank.
   */

  const categories = useAsyncResource((signal) =>
    inventoryCategoriesApi.list(signal),
  )

  const save = useSave()

  const [editor, setEditor] = useState<EditorState>({ mode: "closed" })

  const [overlay, setOverlay] = useState<OverlayState>({ mode: "closed" })

  const [importOpen, setImportOpen] = useState(false)

  const [viewMode, setViewMode] = useState<"table" | "grid">("table")

  const [selectedUnit, setSelectedUnit] = useState<UnitView | null>(null)

  // The unit whose booking form is open, launched from the unit sheet. Kept
  // separate from `selectedUnit` so closing the form returns to the grid, not the
  // sheet, and so a stale sheet cannot reopen behind the form.
  const [bookingUnit, setBookingUnit] = useState<UnitView | null>(null)

  const [gridFilters, setGridFilters] = useState({
    block: "",
    floor: "",
    status: "",
    minPrice: "",
    maxPrice: "",
  })

  const [busyId, setBusyId] = useState<string | null>(null)

  const [filters, setFilters] = useState<Record<string, string>>({})

  const [savedViewReset, setSavedViewReset] = useState(0)

  function applySavedView(state: string) {
    const parsed = JSON.parse(state) as Record<string, string>

    setFilters(parsed)

    setSavedViewReset((token) => token + 1)
  }

  const canEdit = units.data?.canEdit ?? false

  /**
   * Moving a unit between statuses is a separate right from editing one, and the panel
   * shapes the control on it rather than letting the request fail.
   */

  const canChangeStatus = units.data?.canChangeStatus ?? false

  const canManageStatuses = vocabulary.data?.canManage ?? false

  const statuses = vocabulary.data?.statuses ?? []

  const categoryVocabulary = categories.data

  const options = structure.data?.options ?? []

  const currency = units.data?.currency ?? "AED"

  /**
   * The letterhead block for a printed quotation, from the session's tenant and
   * — when this role can read them — the organization settings.
   *
   * Deliberately never fetched eagerly for a print the user may not want: it is
   * built here so the document can print the workspace's real identity, and every
   * field the role cannot see arrives as null, which the document renders as a
   * dash rather than inventing an address or a registration number.
   */

  const session = useSession()

  const organization = useOrganizationSettings(session.can("settings", "view"))

  const quotationTenant: QuotationTenant = useMemo(() => {
    const data = session.data

    const tenant = data === null ? null : tenantFromSession(data)

    const settings = organization.data?.settings

    const address = settings
      ? [
          settings.addressLine1,
          settings.addressLine2,
          settings.city,
          settings.stateRegion,
          settings.postalCode,
          settings.countryCode,
        ]
          .filter((part) => part !== null && part !== "")
          .join(", ")
      : ""

    return {
      name: tenant?.name ?? "",
      legalName: settings?.legalName ?? tenant?.legalName ?? null,
      address: address === "" ? null : address,
      phone: settings?.phone ?? null,
      email: settings?.collectionsEmail ?? null,
      registrationNumber: settings?.registrationNumber ?? null,
    }
  }, [session.data, session, organization.data])

  /**
   * Node id to path, for the structure filter.
   *
   * Built once from the options the server already resolved, so filtering to a tower
   * is a lookup rather than a walk back up the tree for every row.
   */

  const pathsById = useMemo(() => {
    const map = new Map<string, readonly string[]>()

    for (const option of options) map.set(option.id, option.path)

    return map
  }, [options])

  /**
   * The panel's filters, as the shape `filterUnits` reads.
   *
   * Built once and shared by the row filter, the active-chip list and the count beside
   * "Clear filters", because three places deciding what "filtered" means is how a
   * control ends up lying about the table it sits above.
   *
   * Keys are compared, not labels: a saved view called "Available Shops" has to keep
   * meaning the same thing after somebody renames the option in Settings.
   */

  const unitFilters = useMemo<UnitFilters>(
    () => ({
      unitType: isUnitType(filters.type) ? filters.type : null,

      // A key rather than a membership test against a fixed list: the vocabulary is

      // data, and a filter for a status this workspace has is always valid.

      status: filters.status || null,

      structureNodeId: filters.node ?? null,

      propertyTypeKey: filters.ptype || null,

      subtypeKey: filters.stype || null,

      usageKey: filters.usage || null,

      furnishingKey: filters.furn || null,

      saleModeKey: filters.mode || null,

      possessionKey: filters.poss || null,

      minPrice: priceFilter(filters.minPrice),

      maxPrice: priceFilter(filters.maxPrice),
    }),

    [filters],
  )

  const activeChips = useMemo<ActiveFilterChip[]>(
    () =>
      buildFilterChips(
        filters,

        unitFilters,

        statuses,

        categoryVocabulary,

        options,

        currency,
      ),

    [filters, unitFilters, statuses, categoryVocabulary, options, currency],
  )

  function clearAllFilters() {
    for (const key of FILTER_KEYS) setFilter(key, "")
  }

  const rows = useMemo(() => {
    const all = units.data?.units ?? []

    return filterUnits(
      all,

      unitFilters,

      (nodeId) => pathsById.get(nodeId) ?? [],
    )
  }, [units.data, unitFilters, pathsById])

  const blockOptions = useMemo(() => {
    const values = new Set(
      rows
        .map((unit) => unit.structurePath[0] ?? "")
        .filter((value) => value !== ""),
    )

    return Array.from(values).sort((left, right) => left.localeCompare(right))
  }, [rows])

  const floorOptions = useMemo(() => {
    const values = new Set(
      rows
        .map((unit) => unit.structurePath.at(-1) ?? "")
        .filter((value) => value !== ""),
    )

    return Array.from(values).sort((left, right) => left.localeCompare(right))
  }, [rows])

  const gridVisibleUnits = useMemo(() => {
    return rows.filter((unit) => {
      const block = unit.structurePath[0] ?? ""
      const floor = unit.structurePath.at(-1) ?? ""

      if (gridFilters.block && block !== gridFilters.block) return false

      if (gridFilters.floor && floor !== gridFilters.floor) return false

      if (gridFilters.status && unit.status !== gridFilters.status) return false

      if (gridFilters.minPrice !== "") {
        const minimum = Number(gridFilters.minPrice)

        if (!Number.isFinite(minimum) || unit.basePrice < minimum) return false
      }

      if (gridFilters.maxPrice !== "") {
        const maximum = Number(gridFilters.maxPrice)

        if (!Number.isFinite(maximum) || unit.basePrice > maximum) return false
      }

      return true
    })
  }, [gridFilters, rows])

  const groupedGridUnits = useMemo(() => {
    const groups = new Map<string, Map<string, UnitView[]>>()

    for (const unit of gridVisibleUnits) {
      const block = unit.structurePath[0] ?? "Unassigned"
      const floor = unit.structurePath.at(-1) ?? "Unassigned"

      if (!groups.has(block)) groups.set(block, new Map())

      const floorGroups = groups.get(block)!

      if (!floorGroups.has(floor)) floorGroups.set(floor, [])

      floorGroups.get(floor)!.push(unit)
    }

    return Array.from(groups.entries())
      .map(([block, floorGroups]) => ({
        block,
        floors: Array.from(floorGroups.entries())
          .map(([floor, units]) => ({
            floor,
            units: [...units].sort((left, right) =>
              left.unitCode.localeCompare(right.unitCode),
            ),
          }))
          .sort((left, right) => left.floor.localeCompare(right.floor)),
      }))
      .sort((left, right) => left.block.localeCompare(right.block))
  }, [gridVisibleUnits])

  function setGridFilter(key: keyof typeof gridFilters, value: string) {
    setGridFilters((current) => ({
      ...current,
      [key]: value === "__all" ? "" : value,
    }))
  }

  function clearGridFilters() {
    setGridFilters({
      block: "",
      floor: "",
      status: "",
      minPrice: "",
      maxPrice: "",
    })
  }

  /**
   * Reloads both halves of the screen.
   *
   * The units carry counts and resolved labels, the vocabulary carries the options, and
   * retiring a status changes both. Reloading only one leaves the other telling a
   * story that is no longer true.
   */

  async function reloadAll() {
    await Promise.all([
      units.reload(),

      vocabulary.reload(),

      // The category cards and the chips name their options from this, and a rename in
      // Settings would otherwise leave the table quoting the old word.

      categories.reload(),
    ])
  }

  function setFilter(key: string, value: string) {
    setFilters((current) => {
      const next = { ...current }

      // The table's "All" option arrives as an empty string; storing that keeps the

      // record free of dead keys instead of accumulating "type": "".

      if (value === "") delete next[key]
      else next[key] = value

      return next
    })
  }

  async function remove(unit: UnitView) {
    setBusyId(unit.id)

    const removed = await save.run(async () => {
      await projectInventoryApi.remove(projectId, unit.id)

      await units.reload()
    })

    setBusyId(null)

    // Only close once the unit is gone. A refusal — a permission that changed, a

    // session that ended — belongs next to the confirmation the user is still

    // looking at, not on a card behind a dialog that vanished.

    if (removed) setEditor({ mode: "closed" })
  }

  // --- render ---------------------------------------------------------------

  if (units.error) {
    return (
      <Alert variant="danger">
        <AlertDescription>{units.error}</AlertDescription>
      </Alert>
    )
  }

  /**
   * The units are readable but the structure is not, so the editor cannot offer
   * somewhere to put a unit. Said plainly instead of showing an "Add unit" button
   * whose every submission would be refused.
   */

  if (structure.error) {
    return (
      <Alert variant="danger">
        <AlertDescription>{structure.error}</AlertDescription>
      </Alert>
    )
  }

  const totals = units.data?.totals

  const listed = units.data?.units ?? []

  const columns: Array<DataTableColumn<UnitView>> = [
    {
      key: "unitCode",

      header: "Unit",

      width: "15rem",

      sortValue: (row) => row.unitCode,

      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{row.unitCode}</p>

          {/* The set fields the classification made relevant, as one line. A shop row
              gets "2 bath · 1 parking", an apartment gets its bedrooms, and a plot gets
              nothing — which is the honest reading of a bare piece of land. */}
          {row.category.detailSummary.length > 0 ? (
            <p className="truncate text-[11px] text-muted-foreground">
              {row.category.detailSummary.join(" · ")}
            </p>
          ) : null}

          {/* Attribute chips under the code. A unit's distinguishing facts are its
              code and what distinguishes it from its neighbours, and both belong in
              the same glance. */}
          {row.attributes.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {row.attributes.slice(0, 3).map((attribute) => (
                <Badge
                  key={attribute.key}
                  variant="outline"
                  className="text-[10.5px] font-normal"
                >
                  {attribute.key}: {attribute.value}
                </Badge>
              ))}

              {row.attributes.length > 3 ? (
                <Badge
                  variant="outline"
                  className="text-[10.5px] font-normal"
                  title={row.attributes

                    .slice(3)

                    .map((attribute) => `${attribute.key}: ${attribute.value}`)

                    .join(", ")}
                >
                  +{row.attributes.length - 3}
                </Badge>
              ) : null}
            </div>
          ) : null}
        </div>
      ),
    },

    {
      key: "unitType",

      header: "Property type",

      width: "11rem",

      // Sorts on the word the workspace chose, not the stored key: the column reads as
      // a list of kinds of property, and `corner_shop` before `flat` is not an order
      // anybody can check.

      sortValue: (row) => row.category.propertyTypeLabel ?? row.unitType ?? "",

      cell: (row) => {
        const category = row.category

        return (
          <div className="min-w-0">
            <p className="truncate text-[13px] text-foreground">
              {category.propertyTypeLabel ??
                (row.unitType ? UNIT_TYPE_LABELS[row.unitType] : "—")}
            </p>

            {/* The coarse family still matters — it is what dealers are scoped to and
                what the reports group by — so it is shown rather than hidden. */}
            <p className="truncate text-[11px] text-muted-foreground">
              {[
                category.subtypeLabel,
                category.usageLabel,
                row.unitType ? UNIT_TYPE_LABELS[row.unitType] : null,
              ]
                .filter((part) => part !== null && part !== "")
                .join(" · ") || "—"}
            </p>
          </div>
        )
      },
    },

    {
      key: "structurePath",

      header: "Located in",

      width: "13rem",

      sortValue: (row) => row.structurePath.join(" / "),

      cell: (row) => (
        <span className="truncate text-muted-foreground">
          {row.structurePath.length > 0 ? row.structurePath.join(" / ") : "—"}
        </span>
      ),
    },

    {
      key: "location",

      header: "Location / facing",

      width: "13rem",

      sortValue: (row) => row.location ?? "",

      cell: (row) => <span className="truncate">{orDash(row.location)}</span>,
    },

    {
      key: "sizeSqft",

      header: "Size",

      width: "7.5rem",

      align: "right",

      sortValue: (row) => row.sizeSqft,

      // The size the unit was sold in, with the square feet beneath it. Every other
      // screen in the product reads `sizeSqft`, so it is shown too rather than replaced.
      cell: (row) => (
        <div className="min-w-0 text-right">
          <p className="tabular-nums text-[13px]">
            {row.category.sizeDisplay ?? `${formatNumber(row.sizeSqft)} sq ft`}
          </p>

          {row.category.sizeDisplay !== null ? (
            <p className="text-[11px] tabular-nums text-muted-foreground">
              {formatNumber(row.sizeSqft)} sq ft
            </p>
          ) : null}
        </div>
      ),
    },

    {
      key: "basePrice",

      header: "Base price",

      width: "9rem",

      align: "right",

      sortValue: (row) => row.basePrice,

      cell: (row) => (
        <span className="tabular-nums">
          {formatCurrency(row.basePrice, currency, {
            maximumFractionDigits: 0,
          })}
        </span>
      ),
    },

    {
      key: "status",

      header: "Status",

      width: "8rem",

      // Sorts on the label rather than the key: "Available" belongs before "Booked" in

      // a column of words, and sorting on the stored key would order the table by an

      // internal value nobody in this workspace ever sees.

      sortValue: (row) => row.statusLabel,

      cell: (row) => (
        <Badge variant={TONE_VARIANT[row.statusTone]} className="text-[10.5px]">
          {row.statusLabel}
        </Badge>
      ),
    },

    {
      // Present for readers too, not only for editors: the status trail is a read, and

      // the role that can see a unit is exactly the role that should be able to ask how

      // it got to where it is. Edit and Delete stay hidden without `inventory.edit`,

      // because offering a control whose every submission would be refused is worse than

      // not offering it.

      key: "actions",

      header: "",

      width: "3rem",

      align: "right" as const,

      cell: (row: UnitView) => {
        const busy = busyId === row.id

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-6 shrink-0 text-muted-foreground"
                aria-label={`Actions for ${row.unitCode}`}
                disabled={busy}
              >
                <MoreHorizontal size={14} />
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem
                onSelect={() => setOverlay({ mode: "history", unit: row })}
              >
                <History size={13} />
                Status history
              </DropdownMenuItem>

              {/* A read, like the status trail: what a unit has been offered at
                  belongs to anybody who can see the unit, and the create it
                  hosts is the dialog's own gate on `canEdit`. */}
              <DropdownMenuItem
                onSelect={() => setOverlay({ mode: "quotations", unit: row })}
              >
                <FileText size={13} />
                Quotations
              </DropdownMenuItem>

              {canEdit && (
                <>
                  <DropdownMenuSeparator />

                  <DropdownMenuItem
                    onSelect={() => setEditor({ mode: "edit", unit: row })}
                  >
                    <Pencil size={13} />
                    Edit unit
                  </DropdownMenuItem>

                  <DropdownMenuSeparator />

                  <DropdownMenuItem
                    variant="danger"
                    onSelect={() => setEditor({ mode: "delete", unit: row })}
                  >
                    <Trash2 size={13} />
                    Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ]

  /**
   * No structure means no units, because a unit cannot say where it is.
   *
   * Only true when the structure actually came back empty. A failed request must not
   * claim the project has no structure — that would send the user to the Structure tab
   * to add a node that may already be there, and would hide their units behind a
   * message about a different thing.
   */

  const blockedByStructure = structure.data !== null && options.length === 0

  return (
    <div className="flex flex-col gap-3">
      {totals && (
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-5">
          <StatCard
            label="Units"
            value={formatNumber(totals.total)}
            hint={`${formatCurrencyCompact(totals.totalValue, currency)} listed`}
          />

          {/* The status tiles are the ones that move. Which statuses appear is decided
              by `statusTiles` from the counts, so a workspace that has never used
              "Cancelled" does not spend three quarters of a tile row on a zero, and one
              that invented "Under Offer" gets it counted beside the built-ins.

              The hint is the share of the project's units, which is what a reader
              actually asks of a number on a tile: is this a rounding error or most of
              the stock. A status nothing holds says so in words rather than
              "0% of units", which reads like a bug. */}
          {statusTiles(statuses, totals, 3).map((status) => {
            const count = totals.byStatus[status.key] ?? 0

            const share =
              totals.total > 0 ? Math.round((count / totals.total) * 100) : 0

            return (
              <StatCard
                key={status.id}
                label={status.label}
                value={formatNumber(count)}
                hint={
                  count === 0 ? "No units in this status" : `${share}% of units`
                }
              />
            )
          })}

          <StatCard
            label="Open value"
            value={formatCurrencyCompact(totals.openValue, currency)}
            hint={`${formatCurrencyCompact(totals.totalValue, currency)} incl. drafts`}
          />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Inventory</CardTitle>

          <CardDescription>
            {listed.length === 0
              ? `The units for sale in ${projectName}.`
              : `${formatNumber(listed.length)} ${
                  listed.length === 1 ? "unit" : "units"
                } in ${projectName}.`}
          </CardDescription>

          {/* The button is absent rather than disabled when there is nowhere to put a
              unit: a control that cannot work should not be offered, and the card
              below explains why in words. */}
          {/* Each button is gated on its own right rather than on the other's: the
              vocabulary belongs to the workspace and has nothing to do with whether
              this project has a structure to attach units to. */}
          <div className="-mt-0.5 flex items-center gap-1.5 self-start">
            <div className="flex items-center rounded-md border border-border bg-muted/20 p-0.5">
              <Button
                size="sm"
                variant={viewMode === "table" ? "default" : "ghost"}
                onClick={() => setViewMode("table")}
                className="h-7"
              >
                Table
              </Button>

              <Button
                size="sm"
                variant={viewMode === "grid" ? "default" : "ghost"}
                onClick={() => setViewMode("grid")}
                className="h-7"
              >
                Grid
              </Button>
            </div>

            {(canEdit || canManageStatuses) && (
              <>
                {canManageStatuses && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setOverlay({ mode: "statuses" })}
                  >
                    Manage statuses
                  </Button>
                )}

                {canEdit && !blockedByStructure && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setImportOpen(true)}
                  >
                    <Upload size={13} />
                    Import
                  </Button>
                )}

                {canEdit && !blockedByStructure && (
                  <Button
                    size="sm"
                    onClick={() =>
                      setEditor({ mode: "create", structureNodeId: null })
                    }
                  >
                    <Plus size={13} />
                    Add unit
                  </Button>
                )}
              </>
            )}
          </div>
        </CardHeader>

        <CardContent className="px-0 py-0">
          {save.error && (
            <div className="px-4 pb-3">
              <Alert variant="danger">
                <AlertDescription>{save.error}</AlertDescription>
              </Alert>
            </div>
          )}

          {blockedByStructure ? (
            <EmptyState
              icon={Building2}
              title="No structure to attach units to"
              description={
                canEdit
                  ? `Add at least one block, sector, or floor on the Structure tab. Every unit has to say where it sits, so units cannot be recorded until there is somewhere to put them.`
                  : "Nothing has been recorded for this project's structure yet, so there is nowhere for its units to sit."
              }
            />
          ) : listed.length === 0 ? (
            <EmptyState
              icon={Boxes}
              title="No units published"
              description={
                canEdit
                  ? `Add the plots, apartments, shops, offices, and villas in ${projectName}. Each unit records its code, type, size, price, and any attributes that set it apart.`
                  : "Nothing has been published to inventory from this project yet."
              }
              action={
                canEdit ? (
                  <Button
                    size="sm"
                    onClick={() =>
                      setEditor({ mode: "create", structureNodeId: null })
                    }
                  >
                    <Plus size={13} />
                    Add the first unit
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              {/* The category cards are the chips: one click narrows the table to that
                  property type, and the number on the card is counted over the same rows
                  the table is showing. */}
              {units.data !== null && (
                <UnitCategoryCards
                  groups={units.data.categories}
                  total={totals?.total ?? listed.length}
                  currency={currency}
                  selectedKey={filters.ptype ?? ""}
                  onSelect={(key) => setFilter("ptype", key)}
                />
              )}

              <ActiveFilterChips
                chips={activeChips}
                onRemove={(key) => setFilter(key, "")}
                onClearAll={clearAllFilters}
              />

              {viewMode === "table" ? (
                <DataTable
                  columns={columns}
                  rows={rows}
                  rowKey={(row) => row.id}
                  getRowSearchText={unitSearchText}
                  initialSort={{ key: "unitCode", direction: "asc" }}
                  pageSize={25}
                  pageSizeOptions={[25, 50, 100]}
                  filters={filters}
                  resetToken={savedViewReset}
                  onFilterChange={setFilter}
                  toolbar={
                    <SavedViewControls
                      scope="inventory"
                      serialize={() => JSON.stringify(filters)}
                      onApply={applySavedView}
                    />
                  }
                  loading={units.loading}
                  stickyHeader
                  maxHeight="34rem"
                  caption={`Units in ${projectName}`}
                  filterBar={
                    <>
                      <TableFilter
                        label="Property type"
                        value={filters.ptype ?? ""}
                        placeholder="All property types"
                        options={optionChoices(
                          optionsOf(categoryVocabulary, "property_type"),
                        )}
                        onValueChange={(value) => {
                          // A variant belongs to one type, so retyping the type has to drop
                          // the variant that was chosen under the old one.
                          setFilter("ptype", value)

                          setFilter("stype", "")
                        }}
                      />

                      {filters.ptype ? (
                        <TableFilter
                          label="Sub-type"
                          value={filters.stype ?? ""}
                          placeholder="All variants"
                          options={optionChoices(
                            optionsOf(
                              categoryVocabulary,
                              "property_subtype",
                            ).filter(
                              (option) => option.parentKey === filters.ptype,
                            ),
                          )}
                          onValueChange={(value) => setFilter("stype", value)}
                        />
                      ) : null}

                      <TableFilter
                        label="Usage"
                        value={filters.usage ?? ""}
                        placeholder="Any usage"
                        options={optionChoices(
                          optionsOf(categoryVocabulary, "usage_category"),
                        )}
                        onValueChange={(value) => setFilter("usage", value)}
                      />

                      <TableFilter
                        label="Furnishing"
                        value={filters.furn ?? ""}
                        placeholder="Any furnishing"
                        options={optionChoices(
                          optionsOf(categoryVocabulary, "furnishing"),
                        )}
                        onValueChange={(value) => setFilter("furn", value)}
                      />

                      <TableFilter
                        label="Payment"
                        value={filters.mode ?? ""}
                        placeholder="Any mode"
                        options={optionChoices(
                          optionsOf(categoryVocabulary, "sale_mode"),
                        )}
                        onValueChange={(value) => setFilter("mode", value)}
                      />

                      <TableFilter
                        label="Possession"
                        value={filters.poss ?? ""}
                        placeholder="Any possession"
                        options={optionChoices(
                          optionsOf(categoryVocabulary, "possession_status"),
                        )}
                        onValueChange={(value) => setFilter("poss", value)}
                      />

                      <div className="flex items-center gap-1.5 rounded-md border border-border bg-muted/20 px-2 py-1">
                        <span className="text-[11px] font-medium text-muted-foreground">
                          Price
                        </span>

                        <Input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          step={1000}
                          value={filters.minPrice ?? ""}
                          placeholder="Min"
                          aria-label="Minimum base price"
                          className="h-7 w-24 border-0 bg-transparent px-0 text-[12px] shadow-none"
                          onChange={(event) =>
                            setFilter("minPrice", event.target.value)
                          }
                        />

                        <span className="text-[11px] text-muted-foreground">
                          –
                        </span>

                        <Input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          step={1000}
                          value={filters.maxPrice ?? ""}
                          placeholder="Max"
                          aria-label="Maximum base price"
                          className="h-7 w-24 border-0 bg-transparent px-0 text-[12px] shadow-none"
                          onChange={(event) =>
                            setFilter("maxPrice", event.target.value)
                          }
                        />
                      </div>

                      <TableFilter
                        label="Family"
                        value={filters.type ?? ""}
                        placeholder="All families"
                        options={UNIT_TYPES.map((type) => ({
                          value: type,

                          label: UNIT_TYPE_LABELS[type],
                        }))}
                        onValueChange={(value) => setFilter("type", value)}
                      />

                      <TableFilter
                        label="Status"
                        value={filters.status ?? ""}
                        placeholder="All statuses"
                        options={statuses.map((status) => ({
                          value: status.key,

                          label: status.label,
                        }))}
                        onValueChange={(value) => setFilter("status", value)}
                      />

                      <TableFilter
                        label="Structure"
                        value={filters.node ?? ""}
                        placeholder="Whole project"
                        options={options.map((option) => ({
                          value: option.id,

                          label: option.path.join(" / "),
                        }))}
                        onValueChange={(value) => setFilter("node", value)}
                      />
                    </>
                  }
                />
              ) : (
                <div className="flex flex-col gap-4 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <TableFilter
                      label="Property type"
                      value={filters.ptype ?? ""}
                      placeholder="All property types"
                      options={optionChoices(
                        optionsOf(categoryVocabulary, "property_type"),
                      )}
                      onValueChange={(value) => setFilter("ptype", value)}
                    />

                    <TableFilter
                      label="Block"
                      value={gridFilters.block || "__all"}
                      placeholder="All blocks"
                      options={blockOptions.map((block) => ({
                        value: block,
                        label: block,
                      }))}
                      onValueChange={(value) => setGridFilter("block", value)}
                    />

                    <TableFilter
                      label="Floor"
                      value={gridFilters.floor || "__all"}
                      placeholder="All floors"
                      options={floorOptions.map((floor) => ({
                        value: floor,
                        label: floor,
                      }))}
                      onValueChange={(value) => setGridFilter("floor", value)}
                    />

                    <TableFilter
                      label="Status"
                      value={gridFilters.status || "__all"}
                      placeholder="All statuses"
                      options={statuses.map((status) => ({
                        value: status.key,
                        label: status.label,
                      }))}
                      onValueChange={(value) => setGridFilter("status", value)}
                    />

                    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-2 py-1.5">
                      <span className="text-[11px] font-medium text-muted-foreground">
                        Price
                      </span>

                      <Input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={1000}
                        value={gridFilters.minPrice}
                        placeholder="Min"
                        className="h-8 w-20 border-0 bg-transparent px-0 text-[12px] shadow-none"
                        onChange={(event) =>
                          setGridFilters((current) => ({
                            ...current,
                            minPrice: event.target.value,
                          }))
                        }
                      />

                      <span className="text-[11px] text-muted-foreground">
                        –
                      </span>

                      <Input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={1000}
                        value={gridFilters.maxPrice}
                        placeholder="Max"
                        className="h-8 w-20 border-0 bg-transparent px-0 text-[12px] shadow-none"
                        onChange={(event) =>
                          setGridFilters((current) => ({
                            ...current,
                            maxPrice: event.target.value,
                          }))
                        }
                      />
                    </div>

                    {(gridFilters.block ||
                      gridFilters.floor ||
                      gridFilters.status ||
                      gridFilters.minPrice ||
                      gridFilters.maxPrice) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={clearGridFilters}
                      >
                        Clear
                      </Button>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {statuses.map((status) => (
                      <Badge
                        key={status.id}
                        variant={TONE_VARIANT[status.tone]}
                        className="text-[10.5px]"
                      >
                        {status.label}
                      </Badge>
                    ))}
                  </div>

                  {gridVisibleUnits.length === 0 ? (
                    <EmptyState
                      icon={Boxes}
                      title="No units match the grid filters"
                      description="Try another block, floor, status, or price range."
                    />
                  ) : (
                    <div className="space-y-4">
                      {groupedGridUnits.map(({ block, floors }) => (
                        <div
                          key={block}
                          className="rounded-lg border border-border bg-card-subtle/40 p-3"
                        >
                          <div className="mb-3 flex items-center justify-between">
                            <span className="text-[11.5px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                              {block}
                            </span>

                            <span className="text-[11px] text-muted-foreground">
                              {floors.reduce(
                                (accumulator, floor) =>
                                  accumulator + floor.units.length,
                                0,
                              )}{" "}
                              units
                            </span>
                          </div>

                          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                            {floors.map(({ floor, units }) => (
                              <div
                                key={`${block}-${floor}`}
                                className="rounded-md border border-border/80 bg-muted/20 p-2.5"
                              >
                                <div className="mb-2 flex items-center justify-between">
                                  <span className="text-[10.5px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                                    {floor}
                                  </span>

                                  <span className="text-[10.5px] text-muted-foreground">
                                    {units.length}
                                  </span>
                                </div>

                                <div className="space-y-2">
                                  {units.map((unit) => (
                                    <button
                                      key={unit.id}
                                      type="button"
                                      onClick={() => setSelectedUnit(unit)}
                                      className={`w-full rounded-md border px-2.5 py-2 text-left transition-colors hover:border-foreground/20 hover:bg-muted/30 ${GRID_TONE_STYLES[unit.statusTone]}`}
                                    >
                                      <div className="mb-1 flex items-center justify-between gap-2">
                                        <span className="truncate text-[12px] font-medium text-foreground">
                                          {unit.unitCode}
                                        </span>

                                        <Badge
                                          variant={
                                            TONE_VARIANT[unit.statusTone]
                                          }
                                          className="text-[9.5px]"
                                        >
                                          {unit.statusLabel}
                                        </Badge>
                                      </div>

                                      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                                        <span>
                                          {unit.category.propertyTypeLabel ??
                                            (unit.unitType
                                              ? UNIT_TYPE_LABELS[unit.unitType]
                                              : "Unit")}
                                        </span>

                                        <span className="tabular-nums font-medium text-foreground">
                                          {formatCurrency(
                                            unit.basePrice,
                                            currency,
                                            {
                                              maximumFractionDigits: 0,
                                            },
                                          )}
                                        </span>
                                      </div>

                                      {/* The grid is the view a salesperson opens on a phone
                                      before a viewing, so the size and the rooms are
                                      stated in the words they would use — "4.5 Marla",
                                      "3 bed · 2 bath" — not a bare square-foot figure. */}
                                      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10.5px] text-muted-foreground">
                                        <span>
                                          {unit.category.sizeDisplay ??
                                            `${formatNumber(unit.sizeSqft)} sq ft`}
                                        </span>

                                        {unit.category.detailSummary.length >
                                        0 ? (
                                          <>
                                            <span aria-hidden="true">·</span>

                                            <span className="truncate">
                                              {unit.category.detailSummary.join(
                                                " · ",
                                              )}
                                            </span>
                                          </>
                                        ) : null}
                                      </div>

                                      <p className="mt-1 truncate text-[10.5px] text-muted-foreground">
                                        {orDash(unit.location)}
                                      </p>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <UnitGridSheet
        unit={selectedUnit}
        currency={currency}
        statuses={statuses}
        canChangeStatus={canChangeStatus}
        canEdit={canEdit}
        canBook={session.can("bookings", "create")}
        save={save}
        onClose={() => setSelectedUnit(null)}
        onOpenQuotations={(unit) => {
          setSelectedUnit(null)

          setOverlay({ mode: "quotations", unit })
        }}
        onBook={(unit) => {
          setSelectedUnit(null)

          setBookingUnit(unit)
        }}
        onStatusChange={async (unitId, nextStatus, note) => {
          const changed = await save.run(async () => {
            await projectInventoryApi.update(projectId, unitId, {
              status: nextStatus,
              statusNote: note,
            })

            await reloadAll()
          })

          if (changed) setSelectedUnit(null)
        }}
      />

      {/* Two separate sentences because the two refusals are separate. A role that can
          edit but not move statuses should not be told it "cannot change" this
          inventory when it is looking at a fully editable table. */}
      {!canEdit && (
        <p className="px-1 text-[11.5px] text-muted-foreground">
          Read only. Your role can see this inventory but not change it.
        </p>
      )}

      {canEdit && !canChangeStatus && (
        <p className="px-1 text-[11.5px] text-muted-foreground">
          Your role can edit units but not change their status. Ask a tenant
          admin to adjust the role if units need to be moved between statuses.
        </p>
      )}

      <UnitDialog
        editor={editor}
        options={options}
        currency={currency}
        vocabulary={categoryVocabulary}
        save={save}
        onClose={() => {
          save.clear()

          setEditor({ mode: "closed" })
        }}
        onCreate={async (values) => {
          const created = await save.run(async () => {
            await projectInventoryApi.create(projectId, {
              unitCode: values.unitCode,

              unitType: values.unitType,

              structureNodeId: values.structureNodeId,

              sizeSqft: Number(values.sizeSqft),

              basePrice: Number(values.basePrice),

              status: values.status,

              location: values.location,

              attributes: values.attributes,

              // The category block goes whole. An editor that sent only the fields it
              // rendered could never clear one, and re-typing a unit as a Flat would
              // leave a Villa's four bedrooms behind.

              ...classificationInput(values.classification),
            })

            await reloadAll()
          })

          // The unit is in the table now, so the dialog has done its job.

          if (created) {
            save.clear()

            setEditor({ mode: "closed" })
          }
        }}
        onEdit={async (unitId, values) => {
          const updated = await save.run(async () => {
            await projectInventoryApi.update(projectId, unitId, {
              unitCode: values.unitCode,

              unitType: values.unitType,

              structureNodeId: values.structureNodeId,

              sizeSqft: Number(values.sizeSqft),

              basePrice: Number(values.basePrice),

              status: values.status,

              statusNote: values.statusNote,

              location: values.location,

              attributes: values.attributes,

              ...classificationInput(values.classification),
            })

            await reloadAll()
          })

          if (updated) {
            save.clear()

            setEditor({ mode: "closed" })
          }
        }}
        onDelete={remove}
        statuses={statuses}
        canChangeStatus={canChangeStatus}
      />

      <StatusManagerDialog
        overlay={overlay}
        vocabulary={vocabulary}
        save={save}
        onClose={() => {
          save.clear()

          setOverlay({ mode: "closed" })
        }}
        onChanged={reloadAll}
      />

      <UnitHistoryDialog
        overlay={overlay}
        projectId={projectId}
        onClose={() => setOverlay({ mode: "closed" })}
      />

      <UnitQuotationsDialog
        unit={overlay.mode === "quotations" ? overlay.unit : null}
        projectId={projectId}
        projectName={projectName}
        currency={currency}
        canEdit={canEdit}
        canReadLeads={session.can("leads", "view")}
        canReadCustomers={session.can("customers", "view")}
        tenant={quotationTenant}
        onClose={() => setOverlay({ mode: "closed" })}
      />

      {/* Bulk import. Held outside the editor state because a user may want to look at
          the failure report while the table behind them already shows what landed. */}
      <UnitImportDialog
        open={importOpen}
        projectId={projectId}
        projectName={projectName}
        onClose={() => setImportOpen(false)}
        onImported={reloadAll}
      />

      {/* Booking launched from a unit sheet. The unit is preselected; the customer
          is always chosen in the form, since a booking without a real customer is
          not a booking. Success navigates to the booking just made. */}
      {bookingUnit && (
        <BookingFormDialog
          open
          currency={currency}
          prefill={{
            projectId,
            unitId: bookingUnit.id,
            unitCode: bookingUnit.unitCode,
          }}
          onClose={() => setBookingUnit(null)}
          onCreated={(result) => {
            setBookingUnit(null)

            if ("booking" in result) {
              navigate(`/bookings/${result.booking.id}`)
            } else {
              navigate("/approvals")
            }
          }}
        />
      )}
    </div>
  )
}

interface UnitGridSheetProps {
  unit: UnitView | null

  currency: string

  statuses: readonly UnitStatusView[]

  canChangeStatus: boolean

  /** The right the quotation create needs; the trail itself is a plain read. */

  canEdit: boolean

  /** `bookings.create` — whether this role may book a unit from the sheet. */

  canBook: boolean

  save: ReturnType<typeof useSave>

  onClose: () => void

  /** Hands the unit to the panel's quotation trail, closing the sheet. */

  onOpenQuotations: (unit: UnitView) => void

  /** Opens the booking form with this unit preselected, closing the sheet. */

  onBook: (unit: UnitView) => void

  onStatusChange: (
    unitId: string,
    nextStatus: string,
    note: string,
  ) => Promise<void>
}

function UnitGridSheet({
  unit,
  currency,
  statuses,
  canChangeStatus,
  canEdit,
  canBook,
  save,
  onClose,
  onOpenQuotations,
  onBook,
  onStatusChange,
}: UnitGridSheetProps) {
  const [status, setStatus] = useState(unit?.status ?? "")

  useEffect(() => {
    if (unit) setStatus(unit.status)
  }, [unit])

  if (!unit) return null

  const selectedStatus = statuses.find((entry) => entry.key === status)

  return (
    <Sheet
      open={unit !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader className="border-b border-border px-4 py-3">
          <SheetTitle>{unit.unitCode}</SheetTitle>
          <SheetDescription>
            {unit.structurePath.length > 0
              ? unit.structurePath.join(" / ")
              : "Unit overview"}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 overflow-y-auto px-4 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-border bg-muted/20 p-2.5">
              <p className="text-[10.5px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                Property type
              </p>
              <p className="mt-1 text-[13px] text-foreground">
                {unit.category.propertyTypeLabel ??
                  (unit.unitType ? UNIT_TYPE_LABELS[unit.unitType] : "—")}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {unit.category.subtypeLabel !== null
                  ? `${unit.category.subtypeLabel} · `
                  : ""}
                {unit.unitType ? UNIT_TYPE_LABELS[unit.unitType] : "No family"}
              </p>
            </div>

            <div className="rounded-md border border-border bg-muted/20 p-2.5">
              <p className="text-[10.5px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                Size
              </p>
              <p className="mt-1 text-[13px] text-foreground tabular-nums">
                {unit.category.sizeDisplay ??
                  `${formatNumber(unit.sizeSqft)} sq ft`}
              </p>
              {unit.category.sizeDisplay !== null ? (
                <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                  {formatNumber(unit.sizeSqft)} sq ft
                </p>
              ) : null}
            </div>
          </div>

          <div className="rounded-md border border-border bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-muted-foreground">
                Current status
              </span>

              <Badge variant={TONE_VARIANT[unit.statusTone]}>
                {unit.statusLabel}
              </Badge>
            </div>

            <div className="mt-2 flex items-center justify-between gap-2 text-[12px] text-muted-foreground">
              <span>Base price</span>
              <span className="tabular-nums font-medium text-foreground">
                {formatCurrency(unit.basePrice, currency, {
                  maximumFractionDigits: 0,
                })}
              </span>
            </div>

            <div className="mt-1 flex items-center justify-between gap-2 text-[12px] text-muted-foreground">
              <span>Final price</span>
              <span className="tabular-nums font-medium text-foreground">
                {formatCurrency(unit.priceBreakdown.finalPrice, currency, {
                  maximumFractionDigits: 0,
                })}
              </span>
            </div>
          </div>

          <div className="rounded-md border border-border bg-muted/20 p-3">
            <p className="text-[11px] font-medium text-muted-foreground">
              Location / facing
            </p>
            <p className="mt-1 text-[13px] text-foreground">
              {orDash(unit.location)}
            </p>
          </div>

          {/* The classification block, and the one rule it changes: a lump-sum unit is
              sold outright, so a booking of it is taken without a payment plan. Saying it
              here is what stops a desk booking one and then hunting for a plan that the
              form never offers. */}
          {categoryFacts(unit).length > 0 ||
          unit.category.ownershipNotes !== null ||
          !unit.category.allowsInstallments ? (
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <p className="text-[11px] font-medium text-muted-foreground">
                Classification
              </p>

              <div className="mt-2 grid gap-y-1.5 text-[12px]">
                {categoryFacts(unit).map((fact) => (
                  <div
                    key={fact.label}
                    className="flex items-baseline justify-between gap-2"
                  >
                    <span className="text-muted-foreground">{fact.label}</span>
                    <span className="text-right text-foreground">
                      {fact.value}
                    </span>
                  </div>
                ))}
              </div>

              {!unit.category.allowsInstallments ? (
                <p className="mt-2 text-[11.5px] leading-4 text-foreground">
                  Lump sum only — a booking of this unit is taken without a
                  payment plan.
                </p>
              ) : null}

              {unit.category.ownershipNotes !== null ? (
                <p className="mt-2 border-t border-border pt-2 text-[11.5px] leading-4 text-muted-foreground">
                  {unit.category.ownershipNotes}
                </p>
              ) : null}
            </div>
          ) : null}

          {/* The detail fields this type makes relevant, already turned into a line by
              the server — a shop is never shown an empty "Bedrooms —" row. */}
          {unit.category.detailSummary.length > 0 ||
          unit.category.amenities.length > 0 ? (
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <p className="text-[11px] font-medium text-muted-foreground">
                Property details
              </p>

              {unit.category.detailSummary.length > 0 ? (
                <p className="mt-1 text-[12.5px] text-foreground">
                  {unit.category.detailSummary.join(" · ")}
                </p>
              ) : null}

              {unit.category.amenities.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {unit.category.amenities.map((amenity) => (
                    <Badge
                      key={`${unit.id}-${amenity}`}
                      variant="outline"
                      className="text-[10.5px]"
                    >
                      {amenity}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="rounded-md border border-border bg-muted/20 p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <MapPin size={12} />
              Address
            </p>

            <p className="mt-1 text-[13px] text-foreground">
              {orDash(unit.category.address)}
            </p>

            {unit.category.areaCity !== null ? (
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                {unit.category.areaCity}
              </p>
            ) : null}

            {unit.category.latitude !== null &&
            unit.category.longitude !== null ? (
              <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                {unit.category.latitude.toFixed(5)},{" "}
                {unit.category.longitude.toFixed(5)}
              </p>
            ) : null}

            {unit.category.description !== null ? (
              <p className="mt-1.5 text-[12px] leading-5 text-muted-foreground">
                {unit.category.description}
              </p>
            ) : null}
          </div>

          {unit.category.media.length > 0 ? (
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <p className="text-[11px] font-medium text-muted-foreground">
                Photos &amp; media
              </p>

              <div className="mt-2 flex flex-wrap gap-1.5">
                {unit.category.media.map((item) => (
                  <a
                    key={item.id}
                    href={item.href}
                    target="_blank"
                    rel="noreferrer"
                    title={item.label ?? item.kind}
                    className="overflow-hidden rounded-md border border-border bg-card"
                  >
                    {item.kind === "photo" ? (
                      <img
                        src={item.href}
                        alt={item.label ?? unit.unitCode}
                        className="size-16 object-cover"
                      />
                    ) : (
                      <span className="flex items-center gap-1.5 px-2 py-1.5 text-[11.5px] text-foreground">
                        {item.kind === "video" ? (
                          <Video size={12} className="text-muted-foreground" />
                        ) : (
                          <FileText
                            size={12}
                            className="text-muted-foreground"
                          />
                        )}
                        {item.label ??
                          (item.kind === "video" ? "Video" : "Floor plan")}
                      </span>
                    )}
                  </a>
                ))}
              </div>
            </div>
          ) : null}

          {/* The quotations entry. The count of quotes lives behind the trail
              rather than in the list response, so this says what opens, never
              how many — a zero here would have to be a guess. */}
          <div className="rounded-md border border-border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-medium text-muted-foreground">
                Quotations
              </p>

              <Badge variant="outline">
                {canEdit ? "Read & issue" : "Read only"}
              </Badge>
            </div>

            <p className="mt-1 text-[11.5px] leading-4 text-muted-foreground">
              Every price offer made on this unit, ready to print as a PDF for a
              lead or a customer.
            </p>

            <Button
              variant="outline"
              size="sm"
              className="mt-2 w-full"
              onClick={() => onOpenQuotations(unit)}
            >
              <FileText size={12} />
              Open quotation history
            </Button>
          </div>

          {/* The booking entry. Only offered to a role that may create a booking,
              and only for a unit in a status a booking can be made from; a sold or
              already-booked unit says why the button is not there. */}
          {canBook && (
            <div className="rounded-md border border-border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-medium text-muted-foreground">
                  Booking
                </p>

                <Badge variant="outline">
                  {BOOKABLE_UNIT_STATUS_KEYS.includes(unit.status)
                    ? "Can be booked"
                    : "Not bookable"}
                </Badge>
              </div>

              <p className="mt-1 text-[11.5px] leading-4 text-muted-foreground">
                Commit this unit to a customer. Booking it moves the unit to
                Booked.
              </p>

              {BOOKABLE_UNIT_STATUS_KEYS.includes(unit.status) ? (
                <Button
                  size="sm"
                  className="mt-2 w-full"
                  onClick={() => onBook(unit)}
                >
                  <BookOpenCheck size={12} />
                  Book unit
                </Button>
              ) : (
                <p className="mt-2 text-[11.5px] text-muted-foreground">
                  A unit that is {unit.statusLabel.toLowerCase()} cannot be
                  booked.
                </p>
              )}
            </div>
          )}

          <div className="rounded-md border border-border bg-muted/20 p-3">
            <p className="text-[11px] font-medium text-muted-foreground">
              Attributes
            </p>

            {unit.attributes.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {unit.attributes.map((attribute) => (
                  <Badge key={`${unit.id}-${attribute.key}`} variant="outline">
                    {attribute.key}: {attribute.value}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-[12px] text-muted-foreground">
                No attributes recorded.
              </p>
            )}
          </div>

          {canChangeStatus ? (
            <div className="rounded-md border border-border bg-card p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-muted-foreground">
                  Update status
                </span>

                {selectedStatus && (
                  <Badge variant={TONE_VARIANT[selectedStatus.tone]}>
                    {selectedStatus.label}
                  </Badge>
                )}
              </div>

              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger aria-label="Unit status">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>

                <SelectContent>
                  {statuses.map((entry) => (
                    <SelectItem key={entry.id} value={entry.key}>
                      {entry.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                className="mt-3 w-full"
                onClick={() => onStatusChange(unit.id, status, "")}
                disabled={save.saving || status === unit.status}
              >
                {save.saving ? "Saving…" : "Save status"}
              </Button>
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-border bg-muted/10 p-3 text-[11.5px] text-muted-foreground">
              Your role can view this unit but cannot change its status.
            </div>
          )}

          <div className="rounded-md border border-border bg-card p-3">
            <p className="mb-2 text-[11px] font-medium text-muted-foreground">
              Documents
            </p>

            <DocumentSection entityType="unit" entityId={unit.id} />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

// --- Dialog -----------------------------------------------------------------

interface UnitDialogProps {
  editor: EditorState

  options: readonly UnitStructureOption[]

  /**
   * The workspace's property-category vocabulary.
   *
   * Needed by the form rather than the table: the resolved labels for a saved unit
   * already ride inside `unit.category`, but a type the user has just picked and not
   * yet saved has no server answer, and the field visibility has to be decided from the
   * same shared function the server uses.
   */

  vocabulary: InventoryOptionsResponse | null

  /** The workspace's live statuses, in the order they should be offered. */

  statuses: readonly UnitStatusView[]

  /**
   * Whether this role may move a unit between statuses.
   *
   * Passed rather than read from a context so the form can show the current status
   * without a picker, instead of offering a control that would be refused.
   */

  canChangeStatus: boolean

  /** From the list response, so a price is never labelled with a guessed symbol. */

  currency: string

  save: ReturnType<typeof useSave>

  onClose: () => void

  onCreate: (values: CompleteUnitForm) => Promise<void>

  onEdit: (unitId: string, values: CompleteUnitForm) => Promise<void>

  onDelete: (unit: UnitView) => Promise<void>
}

/**
 * One dialog serving create, edit, and delete.
 *
 * Create and edit share a body on purpose. They collect the same seven fields, and an
 * editor that quietly dropped the type or the size on the way in would let someone
 * change a villa's price and accidentally retype it as a plot.
 */

function UnitDialog({
  editor,

  options,

  vocabulary,

  statuses,

  canChangeStatus,

  currency,

  save,

  onClose,

  onCreate,

  onEdit,

  onDelete,
}: UnitDialogProps) {
  const unit =
    editor.mode === "edit" || editor.mode === "delete" ? editor.unit : null

  /**
   * Identifies what the dialog is editing, so the body remounts when it changes
   * rather than being patched.
   *
   * The fields hold local state seeded from the unit being edited, and re-seeding them
   * in place is the render-phase-setState pattern, which cannot also clear the
   * previous unit's errors without calling into another hook mid-render. A `key` makes
   * the fresh state correct on the first paint, so there is no flash of the previous
   * unit's values.
   */

  const seed =
    editor.mode === "closed"
      ? "closed"
      : editor.mode === "create"
        ? `create:${editor.structureNodeId ?? "any"}`
        : `${editor.mode}:${editor.unit.id}`

  const title =
    editor.mode === "create"
      ? "Add a unit"
      : editor.mode === "edit"
        ? `Edit ${editor.unit.unitCode}`
        : "Delete unit"

  const description =
    editor.mode === "create"
      ? "A unit is one thing for sale: a plot, an apartment, a shop, an office, or a villa."
      : editor.mode === "edit"
        ? "Changing the structure moves this unit to another part of the development."
        : "Deleting a unit also deletes its attributes, and this cannot be undone."

  return (
    <Dialog
      open={editor.mode !== "closed"}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {editor.mode === "delete" && unit ? (
          <DeleteUnitBody
            key={seed}
            unit={unit}
            currency={currency}
            save={save}
            onClose={onClose}
            onDelete={onDelete}
          />
        ) : (
          <UnitFormBody
            key={seed}
            unit={editor.mode === "edit" ? editor.unit : null}
            initialNodeId={
              editor.mode === "create" ? editor.structureNodeId : null
            }
            options={options}
            vocabulary={vocabulary}
            statuses={statuses}
            canChangeStatus={canChangeStatus}
            currency={currency}
            save={save}
            onClose={onClose}
            onCreate={onCreate}
            onEdit={onEdit}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

interface UnitFormBodyProps {
  unit: UnitView | null

  initialNodeId: string | null

  options: readonly UnitStructureOption[]

  /** The nine category lists, or null while they are still loading. */

  vocabulary: InventoryOptionsResponse | null

  /** The workspace's live statuses, in the order they should be offered. */

  statuses: readonly UnitStatusView[]

  /** Whether this role may move the unit between statuses. */

  canChangeStatus: boolean

  /** From the list response, so the price hint names the unit's own currency. */

  currency: string

  save: ReturnType<typeof useSave>

  onClose: () => void

  onCreate: (values: CompleteUnitForm) => Promise<void>

  onEdit: (unitId: string, values: CompleteUnitForm) => Promise<void>
}

function UnitFormBody({
  unit,

  initialNodeId,

  options,

  vocabulary,

  statuses,

  canChangeStatus,

  currency,

  save,

  onClose,

  onCreate,

  onEdit,
}: UnitFormBodyProps) {
  const [unitCode, setUnitCode] = useState(unit?.unitCode ?? "")

  /**
   * The property category block, seeded from the unit's stored classification.
   *
   * Seeded from the resolved keys rather than the labels, so editing a unit sitting on a
   * renamed option does not silently move it to whatever row now spells the old word.
   */

  const [classification, setClassification] = useState<UnitClassificationDraft>(
    () =>
      unit === null
        ? EMPTY_CLASSIFICATION
        : classificationFromCategory(unit.category),
  )

  function updateClassification(patch: Partial<UnitClassificationDraft>) {
    setClassification((current) => ({ ...current, ...patch }))

    // A save that has been refused is stale the moment anything in the block changes —
    // most of all when the server refused a value inside this very block.
    if (Object.keys(patch).length > 0) save.clear()
  }

  /**
   * The coarse family, derived from the chosen property type.
   *
   * Every other screen in the product counts by `unit_type` — dealer scopes, reports,
   * the legacy columns — so it still has an answer, but a person picking "Corner Shop"
   * should not also have to know that a shop is commercial. It is asked for out loud
   * only when the chosen type does not name a family, which happens for a property type
   * an admin added without one.
   */

  const [manualUnitType, setManualUnitType] = useState<UnitType | "">(
    unit?.unitType ?? "",
  )

  const propertyTypeOption =
    vocabulary === null
      ? undefined
      : optionsOf(vocabulary, "property_type").find(
          (option) => option.key === classification.propertyType,
        )

  const derivedUnitType: UnitType | "" = propertyTypeOption?.legacyType ?? ""

  const showFamilyField =
    classification.propertyType !== "" && derivedUnitType === ""

  const unitType: UnitType | "" =
    derivedUnitType === "" ? manualUnitType : derivedUnitType

  const [nodeId, setNodeId] = useState(
    unit?.structureNodeId ?? initialNodeId ?? "",
  )

  /**
   * The size in square feet, derived from the typed size and the tenant's factor.
   *
   * Never typed directly: `4.5 Marla` is what a dealer says on the phone, and a form
   * that asked for both would have two answers to the same question.
   */

  const sizeSqft = draftSquareFeet(classification, vocabulary)

  const visibleFields = draftVisibleFields(
    classification,

    vocabulary,

    unit?.category.visibleFields ?? FULL_DETAIL_FIELDS,
  )

  const [basePrice, setBasePrice] = useState(unit ? String(unit.basePrice) : "")

  const [pricePerSqft, setPricePerSqft] = useState(
    unit?.pricing?.pricePerSqft ?? 0,
  )

  const [developmentCharge, setDevelopmentCharge] = useState(
    unit?.pricing?.developmentCharge ?? 0,
  )

  const [cornerPremium, setCornerPremium] = useState(
    unit?.pricing?.cornerPremium ?? 0,
  )

  const [parkFacingPremium, setParkFacingPremium] = useState(
    unit?.pricing?.parkFacingPremium ?? 0,
  )

  const [floorPremium, setFloorPremium] = useState(
    unit?.pricing?.floorPremium ?? 0,
  )

  const [discount, setDiscount] = useState(unit?.pricing?.discount ?? 0)

  const [status, setStatus] = useState<string>(
    unit?.status ?? DEFAULT_STATUS_KEY,
  )

  // The reason only appears once the status has actually moved, and the server only

  // records it then too. Collecting it against an unchanged status would be asking for

  // a justification for something that did not happen.

  const [statusNote, setStatusNote] = useState("")

  const [location, setLocation] = useState(unit?.location ?? "")

  const [drafts, setDrafts] = useState<AttributeDraft[]>(() =>
    toDrafts(unit?.attributes ?? []),
  )

  const errors = save.fields as UnitFormErrors

  const isEdit = unit !== null

  /**
   * Suggestions for a new attribute name.
   *
   * Offered rather than imposed: the attribute bag is deliberately open, so these are
   * the ones this product has seen asked for, not a closed list. A value that is not
   * among them is still perfectly valid and the field accepts it.
   */

  const attributeSuggestions = [
    "Bedrooms",

    "Bathrooms",

    "View",

    "Corner unit",

    "Parking",

    "Private pool",

    "Road frontage",

    "Balcony",
  ]

  function patchDraft(rowId: string, patch: Partial<AttributeDraft>) {
    setDrafts((current) =>
      current.map((draft) =>
        draft.rowId === rowId ? { ...draft, ...patch } : draft,
      ),
    )
  }

  const atAttributeLimit = drafts.length >= UNIT_ATTRIBUTE_MAX

  // One completeness check, written as a type guard so the same `canSubmit` that

  // decides whether the button is live also proves the payload is fillable.

  const pricing: UnitPricingConfig = {
    pricePerSqft: Number(pricePerSqft || 0),
    developmentCharge: Number(developmentCharge || 0),
    cornerPremium: Number(cornerPremium || 0),
    parkFacingPremium: Number(parkFacingPremium || 0),
    floorPremium: Number(floorPremium || 0),
    discount: Number(discount || 0),
  }

  const priceBreakdown = calculateUnitPriceBreakdown({
    sizeSqft: sizeSqft ?? 0,
    basePrice: Number(basePrice || 0),
    pricing,
  })

  const values: UnitFormValues = {
    unitCode: unitCode.trim(),

    unitType,

    structureNodeId: nodeId,

    sizeSqft: sizeSqft === null ? "" : String(sizeSqft),

    basePrice: basePrice.trim(),

    pricing,

    status,

    statusNote: statusNote.trim(),

    location: location.trim(),

    attributes: draftAttributes(drafts),

    classification,
  }

  const canSubmit = unitReady(values)

  /**
   * Whether the status is actually moving, and whether this form is even allowed to
   * say so.
   *
   * A role without `inventory.change_status` keeps the unit where it is: on create that
   * means listing it as Available, on edit it means sending the status it already has,
   * which the server reads as "not changing this" and therefore does not check. Sending
   * the stored value rather than omitting the field keeps one code path for both roles,
   * and a role that gains the permission later starts working with no further change.
   */

  const statusChanged = isEdit && unit !== null && status !== unit.status

  const statusLocked = !canChangeStatus

  const effectiveStatus = statusLocked
    ? (unit?.status ?? DEFAULT_STATUS_KEY)
    : status

  const currentStatusLabel =
    statuses.find((entry) => entry.key === effectiveStatus)?.label ??
    unit?.statusLabel ??
    effectiveStatus

  return (
    <>
      <div className="max-h-[60vh] overflow-y-auto pr-0.5">
        <FormSectionHeading
          title="Basic"
          note="What this unit is. The property type decides the fields below it."
        />

        <FieldGrid className="mt-3">
          <Field
            label="Unit code"
            htmlFor="unit-code"
            required
            error={errors.unitCode}
            hint="How this unit is named on a plan and in correspondence."
          >
            <Input
              id="unit-code"
              value={unitCode}
              maxLength={UNIT_CODE_MAX}
              autoComplete="off"
              placeholder="A-1201"
              className="font-mono"
              onChange={(event) => setUnitCode(event.target.value)}
            />
          </Field>

          {/* The coarse family is normally answered by the property type itself; this
              only appears for a custom type an admin added without one, so a unit never
              reaches the reports and dealer scopes with nothing to count by. */}
          {showFamilyField ? (
            <Field
              label="Family"
              htmlFor="unit-type"
              required
              error={errors.unitType}
              hint="This property type has no family of its own. Choose the one it is counted under."
            >
              <Select
                value={manualUnitType}
                onValueChange={(value) => setManualUnitType(value as UnitType)}
              >
                <SelectTrigger id="unit-type" aria-label="Family">
                  <SelectValue placeholder="Choose a family" />
                </SelectTrigger>

                <SelectContent>
                  {UNIT_TYPES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {UNIT_TYPE_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
        </FieldGrid>

        <UnitBasicsFields
          draft={classification}
          update={updateClassification}
          vocabulary={vocabulary}
          errors={save.fields}
        />

        <div className="mt-3.5">
          <Field
            label="Located in"
            htmlFor="unit-node"
            required
            error={errors.structureNodeId}
            hint="Where in the development this unit sits."
          >
            <Select value={nodeId} onValueChange={setNodeId}>
              <SelectTrigger id="unit-node" aria-label="Located in">
                <SelectValue placeholder="Choose a block, sector, or floor" />
              </SelectTrigger>

              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.path.join(" / ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <FieldGrid className="mt-3.5">
          {statusLocked ? (
            /* A read-only row rather than a disabled select. A disabled control still
               looks like something that could be changed and asks the user to try, and
               this one cannot be — so it says what the status is and why it is staying
               that way. */

            <Field
              label="Status"
              htmlFor="unit-status"
              error={errors.status}
              hint={
                unit
                  ? `Fixed at ${currentStatusLabel}. Your role cannot move a unit between statuses.`
                  : `New units are listed as ${currentStatusLabel}. Your role cannot set a status.`
              }
            >
              <div
                id="unit-status"
                className="flex h-8 items-center rounded-md border border-input bg-muted/40 px-2.5"
                aria-label="Status"
              >
                <Badge
                  variant={
                    TONE_VARIANT[
                      statuses.find((entry) => entry.key === effectiveStatus)
                        ?.tone ??
                        unit?.statusTone ??
                        "neutral"
                    ]
                  }
                  className="text-[10.5px]"
                >
                  {currentStatusLabel}
                </Badge>
              </div>
            </Field>
          ) : (
            <Field
              label="Status"
              htmlFor="unit-status"
              error={errors.status}
              hint="Where this unit sits in the sales lifecycle."
            >
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger id="unit-status" aria-label="Status">
                  <SelectValue />
                </SelectTrigger>

                <SelectContent>
                  {statuses.map((option) => (
                    <SelectItem key={option.id} value={option.key}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        </FieldGrid>

        {/* Only once the status has actually moved, because that is the only time it
            means anything. Optional, and deliberately so: the trail's job is to record
            who and when, and the reason is there for the moves where it matters. */}
        {statusChanged && (
          <div className="mt-3.5">
            <Field
              label="Why did the status change?"
              htmlFor="unit-status-note"
              error={errors.statusNote}
              hint="Optional. Recorded against this move on the unit's status history."
            >
              <Input
                id="unit-status-note"
                value={statusNote}
                maxLength={UNIT_STATUS_NOTE_MAX}
                autoComplete="off"
                placeholder="Buyer's lawyer delayed the deposit"
                onChange={(event) => setStatusNote(event.target.value)}
              />
            </Field>
          </div>
        )}

        <FormSectionHeading
          title="Pricing"
          note={
            sizeSqft === null
              ? "Size the price is worked out from is still missing — set it in Basic."
              : `Charges and premiums below work from ${formatNumber(sizeSqft)} sq ft.`
          }
        />

        <FieldGrid className="mt-3">
          <Field
            label="Base price"
            htmlFor="unit-price"
            required
            error={errors.basePrice}
            // The unit's currency, not a hardcoded one: the list and the stats beside this

            // form both label amounts with it, and "dirhams" would misdescribe a

            // workspace that books in anything else.

            hint={`Whole ${currency}. No decimals.`}
          >
            <Input
              id="unit-price"
              type="number"
              inputMode="numeric"
              min={0}
              max={UNIT_PRICE_MAX}
              step={1}
              value={basePrice}
              placeholder="2450000"
              onChange={(event) => setBasePrice(event.target.value)}
            />
          </Field>
        </FieldGrid>

        <div className="mt-3.5 rounded-md border border-border bg-card-subtle/40 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div>
              <h3 className="text-[13px] font-medium text-foreground">
                Pricing configuration
              </h3>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                Price starts from base price and adds charges, then subtracts
                any discount.
              </p>
            </div>
            <span className="text-[11px] text-muted-foreground">
              {formatCurrency(priceBreakdown.finalPrice, currency, {
                maximumFractionDigits: 0,
              })}
            </span>
          </div>

          <FieldGrid>
            <Field
              label="Price / sqft"
              htmlFor="unit-price-per-sqft"
              hint="Optional size-based rate."
            >
              <Input
                id="unit-price-per-sqft"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={pricePerSqft}
                onChange={(event) =>
                  setPricePerSqft(Number(event.target.value))
                }
              />
            </Field>

            <Field
              label="Development charge"
              htmlFor="unit-development-charge"
              hint="Optional project charge."
            >
              <Input
                id="unit-development-charge"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={developmentCharge}
                onChange={(event) =>
                  setDevelopmentCharge(Number(event.target.value))
                }
              />
            </Field>
          </FieldGrid>

          <FieldGrid className="mt-3">
            <Field
              label="Corner premium"
              htmlFor="unit-corner-premium"
              hint="Optional premium."
            >
              <Input
                id="unit-corner-premium"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={cornerPremium}
                onChange={(event) =>
                  setCornerPremium(Number(event.target.value))
                }
              />
            </Field>

            <Field
              label="Park-facing premium"
              htmlFor="unit-park-facing-premium"
              hint="Optional premium."
            >
              <Input
                id="unit-park-facing-premium"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={parkFacingPremium}
                onChange={(event) =>
                  setParkFacingPremium(Number(event.target.value))
                }
              />
            </Field>
          </FieldGrid>

          <FieldGrid className="mt-3">
            <Field
              label="Floor premium"
              htmlFor="unit-floor-premium"
              hint="Optional premium."
            >
              <Input
                id="unit-floor-premium"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={floorPremium}
                onChange={(event) =>
                  setFloorPremium(Number(event.target.value))
                }
              />
            </Field>

            <Field
              label="Discount"
              htmlFor="unit-pricing-discount"
              hint="Optional reduction."
            >
              <Input
                id="unit-pricing-discount"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={discount}
                onChange={(event) => setDiscount(Number(event.target.value))}
              />
            </Field>
          </FieldGrid>

          <div className="mt-3 rounded-md border border-border bg-muted/30 p-2.5">
            <div className="grid gap-2 text-[12px] text-muted-foreground">
              <div className="flex items-center justify-between">
                <span>Base price</span>
                <span className="font-medium text-foreground">
                  {formatCurrency(priceBreakdown.basePrice, currency, {
                    maximumFractionDigits: 0,
                  })}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span>Development charge</span>
                <span className="font-medium text-foreground">
                  {formatCurrency(priceBreakdown.developmentCharge, currency, {
                    maximumFractionDigits: 0,
                  })}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span>Corner premium</span>
                <span className="font-medium text-foreground">
                  {formatCurrency(priceBreakdown.cornerPremium, currency, {
                    maximumFractionDigits: 0,
                  })}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span>Park-facing premium</span>
                <span className="font-medium text-foreground">
                  {formatCurrency(priceBreakdown.parkFacingPremium, currency, {
                    maximumFractionDigits: 0,
                  })}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span>Floor premium</span>
                <span className="font-medium text-foreground">
                  {formatCurrency(priceBreakdown.floorPremium, currency, {
                    maximumFractionDigits: 0,
                  })}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span>Discount</span>
                <span className="font-medium text-foreground">
                  -
                  {formatCurrency(priceBreakdown.discount, currency, {
                    maximumFractionDigits: 0,
                  })}
                </span>
              </div>

              <div className="mt-1 flex items-center justify-between border-t border-border pt-2 text-[12.5px] font-medium text-foreground">
                <span>Final price</span>
                <span>
                  {formatCurrency(priceBreakdown.finalPrice, currency, {
                    maximumFractionDigits: 0,
                  })}
                </span>
              </div>
            </div>
          </div>
        </div>

        <FormSectionHeading
          title="Details"
          note="Only the fields this property type makes sense for — a shop is never asked for bedrooms."
        />

        <UnitDetailFields
          draft={classification}
          update={updateClassification}
          vocabulary={vocabulary}
          errors={save.fields}
          visible={visibleFields}
        />

        {/* Attributes. A labelled block rather than a Field, because it is a list of
            pairs and there is no single input for `htmlFor` to point at. */}
        <div className="mt-4">
          <div className="flex items-baseline justify-between gap-2">
            <label
              htmlFor="unit-attribute-key-0"
              className="text-[13px] font-medium text-foreground"
            >
              Attributes
            </label>

            <span className="text-[11.5px] text-muted-foreground">
              Optional. Up to {UNIT_ATTRIBUTE_MAX}.
            </span>
          </div>

          <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
            Whatever sets this unit apart — bedrooms, view, corner unit. Names
            are yours to choose; a name cannot be used twice on the same unit.
          </p>

          {errors.attributes && (
            <div className="mt-2">
              <Alert variant="danger">
                <AlertDescription>{errors.attributes}</AlertDescription>
              </Alert>
            </div>
          )}

          <div className="mt-2.5 flex flex-col gap-2">
            {drafts.map((draft, index) => (
              <div key={draft.rowId} className="flex items-start gap-2">
                <Input
                  id={`unit-attribute-key-${index}`}
                  value={draft.key}
                  maxLength={UNIT_ATTRIBUTE_KEY_MAX}
                  autoComplete="off"
                  placeholder="Bedrooms"
                  aria-label={`Attribute ${index + 1} name`}
                  className="flex-1"
                  onChange={(event) =>
                    patchDraft(draft.rowId, { key: event.target.value })
                  }
                />

                <Input
                  value={draft.value}
                  maxLength={UNIT_ATTRIBUTE_VALUE_MAX}
                  autoComplete="off"
                  placeholder="3"
                  aria-label={`Attribute ${index + 1} value`}
                  className="flex-1"
                  onChange={(event) =>
                    patchDraft(draft.rowId, { value: event.target.value })
                  }
                />

                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-8 shrink-0 text-muted-foreground"
                  aria-label={`Remove attribute ${index + 1}`}
                  onClick={() =>
                    setDrafts((current) =>
                      current.filter((row) => row.rowId !== draft.rowId),
                    )
                  }
                >
                  <X size={14} />
                </Button>
              </div>
            ))}
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={atAttributeLimit}
              onClick={() =>
                setDrafts((current) => [
                  ...current,

                  { rowId: nextRowId(), key: "", value: "" },
                ])
              }
            >
              <Plus size={13} />
              Add attribute
            </Button>

            {/* Suggestions, offered as one-click fills. */}
            {drafts.length === 0 &&
              attributeSuggestions.slice(0, 4).map((suggestion) => (
                <Button
                  key={suggestion}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() =>
                    setDrafts([
                      { rowId: nextRowId(), key: suggestion, value: "" },
                    ])
                  }
                >
                  {suggestion}
                </Button>
              ))}
          </div>

          {atAttributeLimit && (
            <p className="mt-1.5 text-[11.5px] text-warning">
              {UNIT_ATTRIBUTE_MAX} attributes is the limit for one unit. Remove
              one to add another.
            </p>
          )}
        </div>

        <FormSectionHeading
          title="Location"
          note="Where a buyer would find it. Optional — a dash beats an invented address."
        />

        <div className="mt-3">
          <Field
            label="Location / facing"
            htmlFor="unit-location"
            error={errors.location}
            hint="The short line the sales desk uses. Leave blank rather than inventing one."
          >
            <Input
              id="unit-location"
              value={location}
              maxLength={UNIT_LOCATION_MAX}
              autoComplete="off"
              placeholder="North-facing, podium level"
              onChange={(event) => setLocation(event.target.value)}
            />
          </Field>
        </div>

        <UnitLocationFields
          draft={classification}
          update={updateClassification}
          vocabulary={vocabulary}
          errors={save.fields}
        />

        <FormSectionHeading
          title="Media"
          note="Photos, a floor plan, and a video link. One photo is the main one."
        />

        <UnitMediaFields
          draft={classification}
          update={updateClassification}
          vocabulary={vocabulary}
          errors={save.fields}
        />
      </div>

      {save.error && (
        <div className="mt-3">
          <Alert variant="danger">
            <AlertDescription>{save.error}</AlertDescription>
          </Alert>
        </div>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={save.saving}>
          Cancel
        </Button>

        <Button
          disabled={save.saving || !canSubmit}
          onClick={() => {
            if (!canSubmit) return

            void (isEdit && unit ? onEdit(unit.id, values) : onCreate(values))
          }}
        >
          {save.saving ? "Saving…" : isEdit ? "Save changes" : "Add unit"}
        </Button>
      </DialogFooter>
    </>
  )
}

interface DeleteUnitBodyProps {
  unit: UnitView

  currency: string

  save: ReturnType<typeof useSave>

  onClose: () => void

  onDelete: (unit: UnitView) => Promise<void>
}

function DeleteUnitBody({
  unit,

  currency,

  save,

  onClose,

  onDelete,
}: DeleteUnitBodyProps) {
  return (
    <>
      <div className="flex items-start gap-2 rounded-md border border-danger-border bg-danger-subtle px-3 py-2.5">
        <Trash2 size={14} className="mt-0.5 shrink-0 text-danger" />
        <p className="text-[13px] text-danger">
          Delete <span className="font-medium">{unit.unitCode}</span>
          {unit.unitType
            ? ` (${UNIT_TYPE_LABELS[unit.unitType].toLowerCase()})`
            : ""}{" "}
          from this project
          {unit.basePrice > 0 ? (
            <>
              {" "}
              — listed at{" "}
              {formatCurrency(unit.basePrice, currency, {
                maximumFractionDigits: 0,
              })}
            </>
          ) : null}
          ? Its attributes go with it, and this cannot be undone.
        </p>
      </div>

      {unit.status === "sold" && (
        <div className="mt-3">
          <Alert variant="pending">
            <AlertDescription>
              This unit is marked sold. Deleting it removes the record of a
              completed sale rather than merely taking it off the market.
            </AlertDescription>
          </Alert>
        </div>
      )}

      {save.error && (
        <div className="mt-3">
          <Alert variant="danger">
            <AlertDescription>{save.error}</AlertDescription>
          </Alert>
        </div>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={save.saving}>
          Cancel
        </Button>

        <Button
          variant="danger"
          disabled={save.saving}
          onClick={() => {
            void onDelete(unit)
          }}
        >
          {save.saving ? "Deleting…" : "Delete unit"}
        </Button>
      </DialogFooter>
    </>
  )
}

/** One label/value line in the unit sheet. */
interface SheetFact {
  label: string

  value: string
}

/**
 * The classification lines for the unit sheet, in the order a reader asks for them.
 *
 * Labels come from the unit itself rather than from the current vocabulary: the server
 * resolves each key against the row that was live when the unit was saved, so a property
 * type renamed last week still reads correctly beside a unit that has not been touched.
 * A line with no answer is dropped rather than shown as a dash, because these are
 * optional classifications and a sheet of dashes is noise.
 */
function categoryFacts(unit: UnitView): SheetFact[] {
  const category = unit.category

  const candidates: SheetFact[] = [
    { label: "Usage", value: category.usageLabel ?? "" },

    { label: "Furnishing", value: category.furnishingLabel ?? "" },

    { label: "Payment mode", value: category.saleModeLabel ?? "" },

    { label: "Possession", value: category.possessionLabel ?? "" },

    { label: "Ownership", value: category.ownershipLabel ?? "" },
  ]

  return candidates.filter((fact) => fact.value !== "")
}

// --- Status vocabulary manager -----------------------------------------------

/**
 * The "Manage statuses" dialog: add a status, recolour or rename one of your own, and
 * retire one that is no longer used.
 *
 * It lives in the Inventory tab rather than under Settings on purpose. A status is
 * meaningless in isolation - "what can this workspace call its own states" is only
 * interesting next to the units those states apply to - and this is the one screen that
 * shows both.
 *
 * Built-in statuses are listed and not editable. That is enforced by the server rather
 * than by disabling the controls here, because a disabled button does not explain
 * itself: this states why the row has no controls, so nobody files a bug about a button
 * that was never there.
 */

interface StatusManagerDialogProps {
  overlay: OverlayState

  vocabulary: ReturnType<typeof useAsyncResource<UnitStatusListResponse>>

  save: ReturnType<typeof useSave>

  onClose: () => void

  /** Reloads the panel's units and vocabulary after the vocabulary itself changed. */

  onChanged: () => Promise<void>
}

function StatusManagerDialog({
  overlay,

  vocabulary,

  save,

  onClose,

  onChanged,
}: StatusManagerDialogProps) {
  const [label, setLabel] = useState("")

  const [tone, setTone] = useState<UnitStatusTone>("info")

  /** The custom status currently being renamed, so only one row edits at a time. */

  const [renamingId, setRenamingId] = useState<string | null>(null)

  const [draftLabel, setDraftLabel] = useState("")

  const open = overlay.mode === "statuses"

  const statuses = vocabulary.data?.statuses ?? []

  const retired = vocabulary.data?.archived ?? []

  const unitCounts = vocabulary.data?.unitCounts ?? {}

  // Counted together because the server does: a retired status still occupies its slot

  // in the vocabulary, so offering the slot it would leave is a promise the next save

  // would break.

  const used = statuses.length + retired.length

  const atLimit = used >= UNIT_STATUS_MAX

  const errors = save.fields as {
    label?: string

    tone?: string
  }

  /** Which form was submitted last, so a label error lands on that form only. */

  const [lastAttempt, setLastAttempt] = useState<"add" | "rename">("add")

  /** The rename and add forms both validate `label`; only one may show the message. */

  function labelError(form: "add" | "rename") {
    return lastAttempt === form ? errors.label : undefined
  }

  async function add() {
    setLastAttempt("add")

    const added = await save.run(async () => {
      await unitStatusApi.create({ label: label.trim(), tone })

      await onChanged()
    })

    if (added) {
      setLabel("")

      setTone("info")
    }
  }

  async function rename() {
    if (!renamingId) return

    setLastAttempt("rename")

    const saved = await save.run(async () => {
      await unitStatusApi.update(renamingId, { label: draftLabel.trim() })

      await onChanged()
    })

    if (saved) setRenamingId(null)
  }

  async function recolour(statusId: string, nextTone: UnitStatusTone) {
    await save.run(async () => {
      await unitStatusApi.update(statusId, { tone: nextTone })

      await onChanged()
    })
  }

  async function retire(status: UnitStatusView) {
    await save.run(async () => {
      await unitStatusApi.update(status.id, { isArchived: true })

      await onChanged()
    })
  }

  async function restore(status: UnitStatusView) {
    await save.run(async () => {
      await unitStatusApi.update(status.id, { isArchived: false })

      await onChanged()
    })
  }

  function startRenaming(status: UnitStatusView) {
    setRenamingId(status.id)

    setDraftLabel(status.label)
  }

  /** How many units hold a status, which is what tells an admin what a change touches. */

  function usageText(held: number) {
    return held === 0
      ? "Not used by any unit"
      : `${formatNumber(held)} ${
          held === 1 ? "unit" : "units"
        } across this workspace`
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Manage statuses</DialogTitle>

          <DialogDescription>
            The states a unit can be in across this workspace. Built-in statuses
            are fixed; your own can be renamed, recoloured, and retired.
          </DialogDescription>
        </DialogHeader>

        {vocabulary.error && (
          <Alert variant="danger">
            <AlertDescription>{vocabulary.error}</AlertDescription>
          </Alert>
        )}

        {save.error && (
          <Alert variant="danger">
            <AlertDescription>{save.error}</AlertDescription>
          </Alert>
        )}

        <div className="max-h-[52vh] overflow-y-auto">
          <div className="flex flex-col gap-1.5">
            {statuses.map((status) => {
              const held = unitCounts[status.key] ?? 0

              return (
                <div
                  key={status.id}
                  className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-2"
                >
                  {renamingId === status.id ? (
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <Input
                        id={`rename-status-${status.id}`}
                        value={draftLabel}
                        maxLength={UNIT_STATUS_LABEL_MAX}
                        autoComplete="off"
                        autoFocus
                        aria-label="New name"
                        disabled={save.saving}
                        onChange={(event) => setDraftLabel(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault()

                            void rename()
                          }

                          if (event.key === "Escape") setRenamingId(null)
                        }}
                      />

                      {labelError("rename") && (
                        <p className="text-[11.5px] leading-4 font-medium text-danger">
                          {labelError("rename")}
                        </p>
                      )}
                    </div>
                  ) : (
                    <Badge
                      variant={TONE_VARIANT[status.tone]}
                      className="shrink-0 text-[10.5px]"
                    >
                      {status.label}
                    </Badge>
                  )}

                  {renamingId !== status.id && (
                    <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted-foreground">
                      {usageText(held)}
                    </span>
                  )}

                  {renamingId === status.id ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground"
                        disabled={save.saving}
                        onClick={() => setRenamingId(null)}
                      >
                        Cancel
                      </Button>

                      <Button
                        size="sm"
                        disabled={
                          save.saving ||
                          draftLabel.trim() === "" ||
                          draftLabel.trim() === status.label
                        }
                        onClick={() => {
                          void rename()
                        }}
                      >
                        {save.saving ? "Saving…" : "Save"}
                      </Button>
                    </div>
                  ) : status.isBuiltin ? (
                    <span className="shrink-0 text-[11px] text-muted-foreground/70">
                      Built in
                    </span>
                  ) : (
                    <div className="flex shrink-0 items-center gap-1">
                      {/* Six tones is a closed set, so they are offered as swatches
                          rather than another select: the choice is which colour, and a
                          colour is faster to pick than to read about. */}
                      {UNIT_STATUS_TONES.map((option) => (
                        <button
                          key={option}
                          type="button"
                          aria-label={`Make ${status.label} ${UNIT_STATUS_TONE_LABELS[option]}`}
                          aria-pressed={status.tone === option}
                          disabled={save.saving}
                          onClick={() => {
                            void recolour(status.id, option)
                          }}
                          className={`size-3.5 rounded-full border disabled:opacity-50 ${
                            TONE_SWATCH[option]
                          } ${
                            status.tone === option
                              ? "ring-2 ring-ring ring-offset-1 ring-offset-card"
                              : ""
                          }`}
                        />
                      ))}

                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground"
                        disabled={save.saving}
                        onClick={() => startRenaming(status)}
                      >
                        Rename
                      </Button>

                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground"
                        disabled={save.saving}
                        onClick={() => {
                          void retire(status)
                        }}
                      >
                        Retire
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {retired.length > 0 && (
            <div className="mt-3.5">
              <p className="text-[13px] font-medium text-foreground">Retired</p>

              <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                Hidden from every picker, so no unit can be moved into one.
                Units already in a retired status keep it, and restoring puts it
                back in front of everyone.
              </p>

              <div className="mt-1.5 flex flex-col gap-1.5">
                {retired.map((status) => (
                  <div
                    key={status.id}
                    className="flex items-center gap-2 rounded-md border border-dashed border-border bg-card px-2.5 py-2"
                  >
                    <Badge
                      variant={TONE_VARIANT[status.tone]}
                      className="shrink-0 text-[10.5px]"
                    >
                      {status.label}
                    </Badge>

                    <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted-foreground">
                      {usageText(unitCounts[status.key] ?? 0)}
                    </span>

                    <Button
                      size="sm"
                      variant="ghost"
                      className="shrink-0 text-muted-foreground"
                      disabled={save.saving}
                      onClick={() => {
                        void restore(status)
                      }}
                    >
                      Restore
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-3.5 rounded-md border border-border bg-muted/30 p-3">
            <p className="text-[13px] font-medium text-foreground">
              Add a status
            </p>

            <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
              For a state your sales process has and this one does not — under
              offer, exchanged, handed over. {UNIT_STATUS_MAX - used}{" "}
              {UNIT_STATUS_MAX - used === 1 ? "slot" : "slots"} left.
            </p>

            <div className="mt-2.5 flex flex-col gap-2">
              <Field
                label="Name"
                htmlFor="new-status-label"
                error={labelError("add")}
              >
                <Input
                  id="new-status-label"
                  value={label}
                  maxLength={UNIT_STATUS_LABEL_MAX}
                  autoComplete="off"
                  placeholder="Under offer"
                  disabled={atLimit}
                  onChange={(event) => setLabel(event.target.value)}
                />
              </Field>

              <Field
                label="Colour"
                htmlFor="new-status-tone"
                error={errors.tone}
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  {UNIT_STATUS_TONES.map((option) => (
                    <button
                      key={option}
                      type="button"
                      disabled={atLimit}
                      aria-label={UNIT_STATUS_TONE_LABELS[option]}
                      aria-pressed={tone === option}
                      title={UNIT_STATUS_TONE_HINTS[option]}
                      onClick={() => setTone(option)}
                      className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] disabled:opacity-50 ${
                        tone === option
                          ? "border-foreground/25 bg-accent text-foreground"
                          : "border-border bg-card text-muted-foreground"
                      }`}
                    >
                      <span
                        className={`size-2.5 rounded-full border ${TONE_SWATCH[option]}`}
                      />

                      {UNIT_STATUS_TONE_LABELS[option]}
                    </button>
                  ))}
                </div>
              </Field>

              <p className="text-[11.5px] text-muted-foreground">
                {UNIT_STATUS_TONE_HINTS[tone]}
              </p>

              <Button
                size="sm"
                className="self-start"
                disabled={save.saving || atLimit || label.trim() === ""}
                onClick={() => {
                  void add()
                }}
              >
                {save.saving ? "Adding…" : "Add status"}
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The dot each tone swatch is drawn with, so the picker shows the real colour. */

const TONE_SWATCH: Record<UnitStatusTone, string> = {
  neutral: "border-border-strong bg-muted-foreground/40",
  outline: "border-border-strong bg-card",
  success: "border-success-border bg-success",
  warning: "border-warning-border bg-warning",
  info: "border-info-border bg-info",
  danger: "border-danger-border bg-danger",
}

// --- Status history ----------------------------------------------------------

interface UnitHistoryDialogProps {
  overlay: OverlayState

  projectId: string

  onClose: () => void
}

/**
 * One unit's status trail.
 *
 * Reads rather than writes, so it is offered to every role that can see the unit and
 * gated on nothing else. The creation entry appears as its own row with no starting
 * status, which is the honest shape: the unit did not come from somewhere, it was
 * published.
 */
function UnitHistoryDialog({
  overlay,

  projectId,

  onClose,
}: UnitHistoryDialogProps) {
  const unit = overlay.mode === "history" ? overlay.unit : null

  /**
   * Keyed on the unit id so opening another unit's trail re-runs the request rather
   * than showing the previous unit's history for the moment before the fetch lands.
   */

  const history = useAsyncResource(
    (signal) =>
      projectInventoryApi.unitStatusHistory(projectId, unit?.id ?? "", signal),

    unit !== null,
  )

  const entries = history.data?.entries ?? []

  return (
    <Dialog
      open={unit !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {unit ? `Status history — ${unit.unitCode}` : "Status history"}
          </DialogTitle>

          <DialogDescription>
            Every move this unit has made, newest first.
          </DialogDescription>
        </DialogHeader>

        {history.error && (
          <Alert variant="danger">
            <AlertDescription>{history.error}</AlertDescription>
          </Alert>
        )}

        {history.loading && (
          <p className="text-[12px] text-muted-foreground">Loading…</p>
        )}

        {!history.loading && entries.length === 0 && !history.error && (
          <p className="text-[12px] text-muted-foreground">
            Nothing recorded yet.
          </p>
        )}

        <div className="max-h-[56vh] overflow-y-auto">
          <ol className="flex flex-col gap-0">
            {entries.map((entry, index) => (
              <li
                key={entry.id}
                className="flex gap-3 border-l border-border pb-3 pl-4 last:border-l-0 last:pb-0"
              >
                <div className="-ml-[21px] flex flex-col items-center">
                  <span className="mt-1 size-2 rounded-full bg-border-strong" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {entry.fromStatusLabel !== null && (
                      <>
                        <Badge
                          variant={
                            TONE_VARIANT[entry.fromStatusTone ?? "neutral"]
                          }
                          className="text-[10.5px]"
                        >
                          {entry.fromStatusLabel}
                        </Badge>

                        <span className="text-[11.5px] text-muted-foreground">
                          &rarr;
                        </span>
                      </>
                    )}

                    <Badge
                      variant={TONE_VARIANT[entry.toStatusTone]}
                      className="text-[10.5px]"
                    >
                      {entry.toStatusLabel}
                    </Badge>

                    {index === 0 && entry.fromStatus === null && (
                      <span className="text-[11.5px] text-muted-foreground">
                        when it was published
                      </span>
                    )}
                  </div>

                  <p className="mt-1 text-[11.5px] text-muted-foreground">
                    {entry.source === "system"
                      ? "Moved automatically"
                      : (entry.changedByName ??
                        "Moved by a user whose account was removed")}
                    {" — "}
                    {formatDateTime(entry.changedAt)}
                  </p>

                  {entry.note && (
                    <p className="mt-1 text-[12px] leading-5 text-foreground/85">
                      {entry.note}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>

          {history.data?.truncated && (
            <p className="mt-2 text-[11.5px] text-muted-foreground">
              Older changes exist and are not shown.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
